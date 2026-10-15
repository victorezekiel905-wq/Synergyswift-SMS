import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { conferenceSlots } from "@/lib/communication";
import { notifyGuardians } from "@/lib/notify";
import { communityNote } from "@/lib/messaging/notices";
import { appUrl, studentName } from "@/lib/school";

export const dynamic = "force-dynamic";

/** Parent-teacher evenings; ?id= one evening's schedule for every teacher. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "meetings");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const { data: c } = await ctx.sb.from("pt_conferences").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!c) return jsonError("not found", 404);
    let q = ctx.sb.from("consultation_slots").select("id,staff_user_id,starts_at,ends_at,location,guardian_id,note,guardians(full_name,phone),students(first_name,last_name,other_names,class_groups(name)),users!consultation_slots_staff_user_id_fkey(full_name)")
      .eq("conference_id", id).order("starts_at");
    if (!hasAny(ctx, ROLES.admin)) q = q.eq("staff_user_id", ctx.userId);
    const { data: slots } = await q;
    return NextResponse.json({ conference: c, slots: (slots ?? []).map((s: any) => ({ ...s, student: s.students ? studentName(s.students) : null, class_name: s.students?.class_groups?.name ?? null })) });
  }
  const { data, error } = await ctx.sb.from("pt_conferences").select("id,title,date,starts_at,ends_at,slot_minutes,status,class_group_ids,staff_user_ids,booking_closes_at,consultation_slots(guardian_id)")
    .eq("tenant_id", tid).order("date", { ascending: false }).limit(50);
  if (error) return jsonError(error.message);
  return NextResponse.json({ admin: hasAny(ctx, ROLES.admin), items: (data ?? []).map((c: any) => ({ ...c, consultation_slots: undefined,
    slots: (c.consultation_slots ?? []).length, booked: (c.consultation_slots ?? []).filter((s: any) => s.guardian_id).length })) });
}

const time = z.string().regex(/^\d{2}:\d{2}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), title: z.string().trim().min(2).max(160), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start: time, end: time,
    slot_minutes: z.number().int().min(5).max(60).default(10), gap_minutes: z.number().int().min(0).max(30).default(0), location: z.string().trim().max(200).nullish(),
    class_group_ids: z.array(z.string().uuid()).min(1).max(100), staff_user_ids: z.array(z.string().uuid()).max(200).default([]),
    booking_closes_at: z.string().datetime({ offset: true }).nullish(), notify: z.boolean().default(true) }),
  z.object({ action: z.literal("close"), id: z.string().uuid() }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid(), reason: z.string().trim().max(300).nullish() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "meetings");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, sb = ctx.sb, svc = createServiceClient();
  if (b.action === "close") {
    const { error } = await sb.from("pt_conferences").update({ status: "closed" }).eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "cancel") {
    const { data: c } = await sb.from("pt_conferences").update({ status: "cancelled" }).eq("tenant_id", tid).eq("id", b.id).select("id,title,date").maybeSingle();
    if (!c) return jsonError("not found", 404);
    const { data: booked } = await svc.from("consultation_slots").select("student_id").eq("conference_id", c.id).not("student_id", "is", null);
    const kids: string[] = [...new Set<string>((booked ?? []).map((s: any) => s.student_id as string))];
    if (kids.length) await notifyGuardians(svc, { tenantId: tid, studentIds: kids, kind: "meeting", dedupeGuardians: true, refId: c.id,
      build: (brand, g) => communityNote(brand, { name: g.full_name, subject: `${c.title} is cancelled`, lines: [`${c.title} on ${c.date} has been cancelled.${b.reason ? ` ${b.reason}` : ""}`, "We will let you know the new date."] }) });
    await svc.from("consultation_slots").delete().eq("conference_id", c.id);
    return NextResponse.json({ ok: true, told: kids.length });
  }
  if (b.end <= b.start) return jsonError("the end time must be after the start time");
  // Teachers: those chosen, else everyone who teaches or is form teacher of the classes.
  let staff = b.staff_user_ids;
  if (!staff.length) {
    const [{ data: offers }, { data: forms }] = await Promise.all([
      sb.from("subject_offerings").select("teacher_id").eq("tenant_id", tid).in("class_group_id", b.class_group_ids).not("teacher_id", "is", null),
      sb.from("class_groups").select("form_teacher_id").eq("tenant_id", tid).in("id", b.class_group_ids).not("form_teacher_id", "is", null)
    ]);
    staff = [...new Set([...(offers ?? []).map((o: any) => o.teacher_id), ...(forms ?? []).map((f: any) => f.form_teacher_id)])] as string[];
  }
  if (!staff.length) return jsonError("no teachers are linked to those classes; choose the teachers");
  const times = conferenceSlots({ date: b.date, start: b.start, end: b.end, slotMinutes: b.slot_minutes, gapMinutes: b.gap_minutes, timeZone: ctx.tenant.timezone });
  if (!times.length) return jsonError("that time range makes no appointments");
  if (Date.parse(times[0].starts_at) < Date.now()) return jsonError("that evening has already started");
  const { data: c, error } = await sb.from("pt_conferences").insert({ tenant_id: tid, title: b.title, date: b.date, starts_at: b.start, ends_at: b.end, slot_minutes: b.slot_minutes, gap_minutes: b.gap_minutes,
    location: b.location ?? null, class_group_ids: b.class_group_ids, staff_user_ids: staff, booking_closes_at: b.booking_closes_at ?? times[0].starts_at, created_by: ctx.userId }).select("id").single();
  if (error) return jsonError(error.message);
  const rows = staff.flatMap(u => times.map(t => ({ tenant_id: tid, staff_user_id: u, conference_id: c.id, location: b.location ?? null, ...t })));
  for (let i = 0; i < rows.length; i += 1000) {
    const { error: e2 } = await svc.from("consultation_slots").insert(rows.slice(i, i + 1000));
    if (e2) return jsonError(`could not create the appointments: ${e2.message}`);
  }
  let told = 0;
  if (b.notify) {
    const { data: kids } = await svc.from("students").select("id").eq("tenant_id", tid).eq("status", "active").in("class_group_id", b.class_group_ids).limit(20000);
    const base = appUrl(req);
    const r = await notifyGuardians(svc, { tenantId: tid, studentIds: (kids ?? []).map((k: any) => k.id), kind: "meeting", dedupeGuardians: true, refId: c.id,
      build: (brand, g) => communityNote(brand, { name: g.full_name, subject: `Book your appointments: ${b.title}`,
        lines: [`${b.title} is on ${b.date}, ${b.start} to ${b.end}${b.location ? ` at ${b.location}` : ""}.`, `Book a ${b.slot_minutes}-minute appointment with each of your child's teachers in the parent portal (Meetings).`],
        link: g.user_id ? `${base}/parent#meetings` : g.portal_token ? `${base}/g/${g.portal_token}#meetings` : null, linkLabel: "Book now" }) });
    told = r.queued;
  }
  return NextResponse.json({ ok: true, id: c.id, teachers: staff.length, appointments: rows.length, messages: told }, { status: 201 });
}
