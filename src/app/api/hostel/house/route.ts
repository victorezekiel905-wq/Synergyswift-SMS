import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { studentName, appUrl } from "@/lib/school";
import { localParts, zonedToUtc } from "@/lib/attendance";
import { startingRoll, rollSummary, mealHeadcount } from "@/lib/boarding";
import { tellStaff } from "@/lib/hr-server";

export const dynamic = "force-dynamic";

const STUDENT = "first_name,last_name,other_names,admission_no,class_groups(name)";

/** Boarders of a house (or all houses) with their rooms. */
type Boarder = { student_id: string; name: string; room: string; class: string | null; hostel_id: string };
async function boarders(sb: any, tid: string, hostelId: string | null): Promise<Boarder[]> {
  let q = sb.from("hostel_allocations").select(`student_id,bed_label,hostel_rooms!inner(name,hostel_id),students(${STUDENT})`).eq("tenant_id", tid).is("ended_at", null);
  if (hostelId) q = q.eq("hostel_rooms.hostel_id", hostelId);
  const { data } = await q.limit(5000);
  return (data ?? []).map((a: any) => ({ student_id: a.student_id, name: studentName(a.students), room: `${a.hostel_rooms?.name ?? ""}${a.bed_label ? `/${a.bed_label}` : ""}`, class: a.students?.class_groups?.name ?? null, hostel_id: a.hostel_rooms?.hostel_id }));
}

/**
 * Boarding house life.
 * GET ?view=roll&hostel=         the starting roll and recent roll calls
 * GET ?view=notes&student=       house-parent notes for a boarder
 * GET ?view=dining&date=&meal=   the week's menus, today's numbers and diets, and the dining register
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hostel");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const view = u.get("view") ?? "roll";
  const tid = ctx.tenant.id, sb = ctx.sb, tz = ctx.tenant.timezone;
  const today = localParts(new Date(), tz).date;

  if (view === "roll") {
    const hostelId = u.get("hostel");
    if (!hostelId) return jsonError("choose a house");
    const start = zonedToUtc(`${today}T00:00`, tz)?.toISOString() ?? `${today}T00:00:00Z`;
    const [list, { data: out }, { data: sick }, { data: calls }] = await Promise.all([
      boarders(sb, tid, hostelId),
      sb.from("exeat_requests").select("student_id").eq("tenant_id", tid).eq("status", "out"),
      createServiceClient().from("sickbay_visits").select("student_id").eq("tenant_id", tid).eq("outcome", "resting").is("left_at", null).gte("at", start),
      sb.from("boarding_roll_calls").select("id,kind,taken_at,note,taken_by,boarding_roll_marks(student_id,status,note)").eq("tenant_id", tid).eq("hostel_id", hostelId).order("taken_at", { ascending: false }).limit(14)
    ]);
    const names = new Map(list.map(b => [b.student_id, b.name]));
    return NextResponse.json({
      roll: startingRoll(list, new Set((out ?? []).map((e: any) => e.student_id)), new Set((sick ?? []).map((s: any) => s.student_id))),
      calls: (calls ?? []).map((c: any) => ({ id: c.id, kind: c.kind, taken_at: c.taken_at, note: c.note, summary: rollSummary(c.boarding_roll_marks ?? []),
        missing: (c.boarding_roll_marks ?? []).filter((m: any) => m.status === "absent").map((m: any) => names.get(m.student_id) ?? "?") }))
    });
  }

  if (view === "notes") {
    const sid = u.get("student");
    if (!sid) {
      const list = await boarders(sb, tid, u.get("hostel"));
      return NextResponse.json({ boarders: list });
    }
    const { data } = await sb.from("boarding_notes").select("id,kind,note,visible_to_parent,created_at,author_id").eq("tenant_id", tid).eq("student_id", sid).order("created_at", { ascending: false }).limit(100);
    const ids = [...new Set((data ?? []).map((n: any) => n.author_id).filter(Boolean))];
    const { data: names } = ids.length ? await createServiceClient().from("users").select("id,full_name").in("id", ids) : { data: [] };
    const nm = new Map((names ?? []).map((n: any) => [n.id, n.full_name]));
    return NextResponse.json({ me: ctx.userId, notes: (data ?? []).map((n: any) => ({ ...n, author: nm.get(n.author_id) ?? null })) });
  }

  if (view === "dining") {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(u.get("date") ?? "") ? u.get("date")! : today;
    const meal = ["breakfast", "lunch", "supper", "snack"].includes(u.get("meal") ?? "") ? u.get("meal")! : "lunch";
    const weekEnd = new Date(Date.parse(`${date}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
    const list = await boarders(sb, tid, null);
    const [{ data: menus }, { data: out }, { data: med }, { data: marks }] = await Promise.all([
      sb.from("meal_menus").select("id,hostel_id,on_date,meal,items,alternatives").eq("tenant_id", tid).gte("on_date", date).lte("on_date", weekEnd).order("on_date"),
      sb.from("exeat_requests").select("student_id").eq("tenant_id", tid).eq("status", "out"),
      createServiceClient().from("medical_profiles").select("student_id,dietary,allergies").eq("tenant_id", tid).in("student_id", list.map(b => b.student_id).slice(0, 2000)),
      sb.from("dining_marks").select("student_id,status").eq("tenant_id", tid).eq("on_date", date).eq("meal", meal)
    ]);
    const medBy = new Map((med ?? []).map((m: any) => [m.student_id, m]));
    const away = new Set<string>((out ?? []).map((e: any) => e.student_id));
    const head = mealHeadcount(list.map(b => ({ student_id: b.student_id, dietary: (medBy.get(b.student_id) as any)?.dietary ?? null, allergies: (medBy.get(b.student_id) as any)?.allergies ?? null })), away);
    const marked = new Map((marks ?? []).map((m: any) => [m.student_id, m.status]));
    return NextResponse.json({ date, meal, menus: menus ?? [], headcount: head, can_edit: hasAny(ctx, ROLES.hostel),
      register: list.filter(b => !away.has(b.student_id)).map(b => ({ ...b, status: marked.get(b.student_id) ?? null, special: Boolean((medBy.get(b.student_id) as any)?.dietary || (medBy.get(b.student_id) as any)?.allergies) }))
        .sort((a, b) => a.name.localeCompare(b.name)) });
  }
  return jsonError("unknown view", 404);
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const meal = z.enum(["breakfast", "lunch", "supper", "snack"]);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("take_roll"), hostel_id: z.string().uuid(), kind: z.enum(["morning", "evening", "night", "prep", "other"]), note: z.string().trim().max(500).nullish(),
    marks: z.array(z.object({ student_id: z.string().uuid(), status: z.enum(["present", "absent", "late", "exeat", "sick_bay", "excused"]), note: z.string().trim().max(200).nullish() })).min(1).max(2000) }),
  z.object({ action: z.literal("add_note"), student_id: z.string().uuid(), kind: z.enum(["general", "welfare", "behaviour", "health", "achievement", "contact"]), note: z.string().trim().min(2).max(4000), visible_to_parent: z.boolean().default(false) }),
  z.object({ action: z.literal("delete_note"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_menu"), hostel_id: z.string().uuid().nullish(), on_date: date, meal, items: z.string().trim().min(1).max(1000), alternatives: z.string().trim().max(500).nullish() }),
  z.object({ action: z.literal("copy_week"), from: date, to: date }),
  z.object({ action: z.literal("dining"), on_date: date, meal, student_ids: z.array(z.string().uuid()).min(1).max(2000), status: z.enum(["ate", "missed", "packed", "special"]) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.hostel, "hostel");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, sb = ctx.sb, svc = createServiceClient();
  const fail = (m: string) => jsonError(m.includes("row-level security") ? "you cannot do that" : m);

  switch (b.action) {
    case "take_roll": {
      const { data: call, error } = await sb.from("boarding_roll_calls").insert({ tenant_id: tid, hostel_id: b.hostel_id, kind: b.kind, note: b.note ?? null, taken_by: ctx.userId }).select("id").single();
      if (error) return fail(error.message);
      const ins = await sb.from("boarding_roll_marks").insert(b.marks.map(m => ({ roll_call_id: call.id, tenant_id: tid, student_id: m.student_id, status: m.status, note: m.note ?? null })));
      if (ins.error) return fail(ins.error.message);
      const missing = b.marks.filter(m => m.status === "absent");
      if (missing.length) {
        // A boarder unaccounted for is an emergency: the other house staff and the principal hear at once.
        const { data: studs } = await svc.from("students").select("id,first_name,last_name,other_names").in("id", missing.map(m => m.student_id));
        const { data: users } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", tid).eq("active", true);
        const to = (users ?? []).filter((u: any) => ["hostel_warden", "principal"].some(r => u.role === r || (u.extra_roles ?? []).includes(r))).map((u: any) => u.id).filter((id: string) => id !== ctx.userId);
        await tellStaff(svc, tid, to, "boarding_roll", `Missing at ${b.kind} roll call`, `Not accounted for: ${(studs ?? []).map((s: any) => studentName(s)).join(", ")}.`, `${appUrl(req)}/school/hostel`, call.id);
      }
      return NextResponse.json({ id: call.id, ...rollSummary(b.marks) }, { status: 201 });
    }
    case "add_note": {
      const { error } = await sb.from("boarding_notes").insert({ tenant_id: tid, student_id: b.student_id, kind: b.kind, note: b.note, visible_to_parent: b.visible_to_parent, author_id: ctx.userId });
      return error ? fail(error.message) : NextResponse.json({ ok: true }, { status: 201 });
    }
    case "delete_note": {
      const { data, error } = await sb.from("boarding_notes").delete().eq("tenant_id", tid).eq("id", b.id).select("id");
      if (error) return fail(error.message);
      return data?.length ? NextResponse.json({ ok: true }) : jsonError("only the author or an admin can delete a note", 403);
    }
    case "save_menu": {
      const row = { tenant_id: tid, hostel_id: b.hostel_id ?? null, on_date: b.on_date, meal: b.meal, items: b.items, alternatives: b.alternatives || null };
      const { data: existing } = await sb.from("meal_menus").select("id").eq("tenant_id", tid).eq("on_date", b.on_date).eq("meal", b.meal).filter("hostel_id", b.hostel_id ? "eq" : "is", b.hostel_id ?? null).maybeSingle();
      const { error } = existing ? await sb.from("meal_menus").update(row).eq("id", existing.id) : await sb.from("meal_menus").insert(row);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "copy_week": {
      const end = new Date(Date.parse(`${b.from}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
      const shift = Math.round((Date.parse(`${b.to}T00:00:00Z`) - Date.parse(`${b.from}T00:00:00Z`)) / 86_400_000);
      const { data: src } = await sb.from("meal_menus").select("hostel_id,on_date,meal,items,alternatives").eq("tenant_id", tid).gte("on_date", b.from).lte("on_date", end);
      let n = 0;
      for (const m of src ?? []) {
        const d = new Date(Date.parse(`${m.on_date}T00:00:00Z`) + shift * 86_400_000).toISOString().slice(0, 10);
        const { data: existing } = await sb.from("meal_menus").select("id").eq("tenant_id", tid).eq("on_date", d).eq("meal", m.meal).filter("hostel_id", m.hostel_id ? "eq" : "is", m.hostel_id ?? null).maybeSingle();
        if (existing) continue;
        const { error } = await sb.from("meal_menus").insert({ ...m, tenant_id: tid, on_date: d });
        if (!error) n++;
      }
      return NextResponse.json({ copied: n });
    }
    case "dining": {
      const { error } = await sb.from("dining_marks").upsert(b.student_ids.map(id => ({ tenant_id: tid, on_date: b.on_date, meal: b.meal, student_id: id, status: b.status, marked_by: ctx.userId, at: new Date().toISOString() })),
        { onConflict: "on_date,meal,student_id" });
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
  }
}

