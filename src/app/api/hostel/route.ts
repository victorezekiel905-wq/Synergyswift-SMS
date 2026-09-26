import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyGuardians } from "@/lib/notify";
import { exeatUpdate } from "@/lib/messaging/notices";
import { formatInZone } from "@/lib/messaging/outbox";
import { studentName } from "@/lib/school";

/** Hostels with rooms and occupants, plus exeat requests. */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "hostel");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const [{ data: hostels }, { data: allocations }, { data: exeats }] = await Promise.all([
    ctx.sb.from("hostels").select("*,users(full_name),hostel_rooms(id,name,capacity)").eq("tenant_id", tid).order("name"),
    ctx.sb.from("hostel_allocations").select("id,room_id,student_id,bed_label,allocated_at,students(first_name,last_name,other_names,admission_no,class_groups(name))").eq("tenant_id", tid).is("ended_at", null),
    ctx.sb.from("exeat_requests").select("*,students(first_name,last_name,other_names,admission_no,class_groups(name)),guardians(full_name,phone)").eq("tenant_id", tid)
      .in("status", ["pending", "approved", "out"]).order("leave_at")
  ]);
  return NextResponse.json({
    hostels: (hostels ?? []).map((h: any) => ({ ...h, hostel_rooms: (h.hostel_rooms ?? []).map((r: any) => ({ ...r, occupants: (allocations ?? []).filter((a: any) => a.room_id === r.id).map((a: any) => ({ ...a, name: studentName(a.students) })) })) })),
    exeats: (exeats ?? []).map((e: any) => ({ ...e, name: studentName(e.students) })),
    can_manage: hasAny(ctx, ROLES.hostel)
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_hostel"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(60), gender: z.enum(["male", "female", "mixed"]).nullish(), warden_id: z.string().uuid().nullish() }),
  z.object({ action: z.literal("save_room"), id: z.string().uuid().optional(), hostel_id: z.string().uuid(), name: z.string().trim().min(1).max(40), capacity: z.number().int().min(1).max(100) }),
  z.object({ action: z.literal("allocate"), room_id: z.string().uuid(), student_id: z.string().uuid(), bed_label: z.string().trim().max(20).nullish() }),
  z.object({ action: z.literal("vacate"), allocation_id: z.string().uuid() }),
  z.object({ action: z.literal("exeat_create"), student_id: z.string().uuid(), reason: z.string().trim().min(3).max(300), leave_at: z.string().datetime({ offset: true }),
    return_by: z.string().datetime({ offset: true }), collector_name: z.string().trim().max(120).nullish() }),
  z.object({ action: z.literal("exeat_decide"), id: z.string().uuid(), decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal("exeat_out"), id: z.string().uuid() }),
  z.object({ action: z.literal("exeat_return"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.hostel, "hostel");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  const svc = createServiceClient();

  switch (b.action) {
    case "save_hostel": {
      const { action: _a, id, ...row } = b;
      const { error } = id ? await sb.from("hostels").update(row).eq("tenant_id", tid).eq("id", id) : await sb.from("hostels").insert({ ...row, tenant_id: tid });
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "save_room": {
      const { action: _a, id, ...row } = b;
      const { error } = id ? await sb.from("hostel_rooms").update(row).eq("tenant_id", tid).eq("id", id) : await sb.from("hostel_rooms").insert({ ...row, tenant_id: tid });
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "allocate": {
      const { data: room } = await sb.from("hostel_rooms").select("capacity,hostels(gender)").eq("tenant_id", tid).eq("id", b.room_id).maybeSingle();
      if (!room) return jsonError("room not found", 404);
      const { count } = await sb.from("hostel_allocations").select("id", { count: "exact", head: true }).eq("room_id", b.room_id).is("ended_at", null);
      if ((count ?? 0) >= room.capacity) return jsonError("this room is full");
      const { data: st } = await sb.from("students").select("gender").eq("tenant_id", tid).eq("id", b.student_id).maybeSingle();
      const hg = (room as any).hostels?.gender;
      if (hg && hg !== "mixed" && st?.gender && st.gender !== hg) return jsonError(`this is a ${hg} hostel`);
      await sb.from("hostel_allocations").update({ ended_at: new Date().toISOString() }).eq("tenant_id", tid).eq("student_id", b.student_id).is("ended_at", null);
      const { error } = await sb.from("hostel_allocations").insert({ tenant_id: tid, room_id: b.room_id, student_id: b.student_id, bed_label: b.bed_label ?? null });
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "vacate": {
      const { error } = await sb.from("hostel_allocations").update({ ended_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.allocation_id);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "exeat_create": {
      const { data, error } = await svc.from("exeat_requests").insert({ tenant_id: tid, student_id: b.student_id, requested_by: "staff", reason: b.reason,
        leave_at: b.leave_at, return_by: b.return_by, collector_name: b.collector_name ?? null, status: "approved", decided_by: ctx.userId, decided_at: new Date().toISOString() }).select("id").single();
      if (error) return jsonError(error.message);
      await tell(svc, tid, data.id, "approved", ctx.tenant.timezone, ctx.userId);
      return NextResponse.json(data, { status: 201 });
    }
    case "exeat_decide": {
      const { data, error } = await svc.from("exeat_requests").update({ status: b.decision, decided_by: ctx.userId, decided_at: new Date().toISOString(), decision_note: b.note ?? null })
        .eq("tenant_id", tid).eq("id", b.id).eq("status", "pending").select("id").maybeSingle();
      if (error) return jsonError(error.message);
      if (!data) return jsonError("this request has already been decided", 409);
      await tell(svc, tid, b.id, b.decision, ctx.tenant.timezone, ctx.userId, b.note);
      return NextResponse.json({ ok: true });
    }
    case "exeat_out": case "exeat_return": {
      const out = b.action === "exeat_out";
      const { data, error } = await svc.from("exeat_requests").update(out ? { status: "out", checked_out_at: new Date().toISOString() } : { status: "returned", returned_at: new Date().toISOString() })
        .eq("tenant_id", tid).eq("id", b.id).eq("status", out ? "approved" : "out").select("id").maybeSingle();
      if (error) return jsonError(error.message);
      if (!data) return jsonError(out ? "only approved exeats can be checked out" : "this student is not signed out", 409);
      await tell(svc, tid, b.id, out ? "out" : "returned", ctx.tenant.timezone, ctx.userId);
      return NextResponse.json({ ok: true });
    }
  }
}

async function tell(svc: any, tid: string, exeatId: string, status: string, tz: string, by: string, note?: string | null) {
  const { data: e } = await svc.from("exeat_requests").select("student_id,leave_at,return_by,students(first_name,last_name,other_names)").eq("id", exeatId).maybeSingle();
  if (!e) return;
  const f = (d: string) => { const x = formatInZone(new Date(d), tz); return `${x.date} ${x.time}`; };
  const when = status === "out" || status === "returned" ? f(new Date().toISOString()) : `${f(e.leave_at)} to ${f(e.return_by)}`;
  await notifyGuardians(svc, { tenantId: tid, studentIds: [e.student_id], kind: "exeat", refId: exeatId, createdBy: by,
    build: (brand, g) => exeatUpdate(brand, { guardianName: g.full_name, studentName: studentName(e.students), status, when, note }) });
}
