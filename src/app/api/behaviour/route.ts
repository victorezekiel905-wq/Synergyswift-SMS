import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { firedRules, type Rule } from "@/lib/behaviour";
import { notifyGuardians } from "@/lib/notify";
import { behaviourNote } from "@/lib/messaging/notices";
import { studentName } from "@/lib/school";

/** Categories, rules, houses with points, open actions and recent records (?student_id= for one student). */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "behaviour");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const sid = new URL(req.url).searchParams.get("student_id");
  let recQ = ctx.sb.from("behaviour_records").select("id,student_id,kind,points,note,occurred_at,behaviour_categories(name),students(first_name,last_name,other_names,class_groups(name)),recorder:users!behaviour_records_recorded_by_fkey(full_name)")
    .eq("tenant_id", tid).order("occurred_at", { ascending: false }).limit(200);
  if (sid) recQ = recQ.eq("student_id", sid);
  const since = new Date(Date.now() - 365 * 86400_000).toISOString();
  const [cats, rules, houses, actions, records, housePoints] = await Promise.all([
    ctx.sb.from("behaviour_categories").select("*").eq("tenant_id", tid).order("kind").order("name"),
    ctx.sb.from("behaviour_rules").select("*").eq("tenant_id", tid).order("name"),
    ctx.sb.from("houses").select("*").eq("tenant_id", tid).order("name"),
    ctx.sb.from("behaviour_actions").select("id,student_id,action,status,created_at,note,students(first_name,last_name,other_names,class_groups(name))").eq("tenant_id", tid).eq("status", "open").order("created_at", { ascending: false }).limit(200),
    recQ,
    ctx.sb.from("behaviour_records").select("points,students!inner(house_id)").eq("tenant_id", tid).gte("occurred_at", since).not("students.house_id", "is", null).limit(50000)
  ]);
  const totals: Record<string, number> = {};
  for (const r of housePoints.data ?? []) { const h = (r as any).students?.house_id; if (h) totals[h] = (totals[h] ?? 0) + Number(r.points); }
  return NextResponse.json({
    categories: cats.data ?? [], rules: rules.data ?? [], actions: actions.data ?? [], records: records.data ?? [],
    houses: (houses.data ?? []).map((h: any) => ({ ...h, points: totals[h.id] ?? 0 })).sort((a: any, b: any) => b.points - a.points)
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("record"), student_ids: z.array(z.string().uuid()).min(1).max(60), category_id: z.string().uuid(), note: z.string().trim().max(500).nullish() }),
  z.object({ action: z.literal("delete_record"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_category"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(60), kind: z.enum(["positive", "negative"]), points: z.number().int().min(-100).max(100), notify_parent: z.boolean().default(false) }),
  z.object({ action: z.literal("save_rule"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), kind: z.enum(["positive", "negative"]), measure: z.enum(["count", "points"]),
    threshold: z.number().int().min(1).max(1000), window_days: z.number().int().min(1).max(365), action_text: z.string().trim().min(2).max(120), notify_parent: z.boolean(), active: z.boolean().default(true) }),
  z.object({ action: z.literal("save_house"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ action: z.literal("assign_houses"), student_ids: z.array(z.string().uuid()).min(1).max(2000), house_id: z.string().uuid().nullable() }),
  z.object({ action: z.literal("resolve"), id: z.string().uuid(), status: z.enum(["done", "cancelled"]), note: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal("seed_defaults") })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "behaviour");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  const adminOnly = () => ROLES.admin.some(r => ctx.roles.has(r)) ? null : jsonError("only school admins can change behaviour settings", 403);

  if (b.action === "record") {
    const { data: cat } = await sb.from("behaviour_categories").select("*").eq("tenant_id", tid).eq("id", b.category_id).maybeSingle();
    if (!cat) return jsonError("category not found", 404);
    const svc = createServiceClient();
    const { data: rules } = await sb.from("behaviour_rules").select("*").eq("tenant_id", tid).eq("active", true);
    const now = new Date();
    const since = new Date(now.getTime() - 365 * 86400_000).toISOString();
    const fired: { student_id: string; rule: Rule }[] = [];
    for (const sid of b.student_ids) {
      const { data: past } = await sb.from("behaviour_records").select("kind,points,occurred_at").eq("tenant_id", tid).eq("student_id", sid).gte("occurred_at", since).limit(2000);
      const rec = { kind: cat.kind, points: cat.points, occurred_at: now.toISOString() };
      const { error } = await sb.from("behaviour_records").insert({ tenant_id: tid, student_id: sid, category_id: cat.id, kind: cat.kind, points: cat.points, note: b.note ?? null, recorded_by: ctx.userId });
      if (error) return jsonError(error.message);
      for (const r of firedRules((rules ?? []) as Rule[], past ?? [], rec, now)) fired.push({ student_id: sid, rule: r });
    }
    if (fired.length) {
      await svc.from("behaviour_actions").insert(fired.map(f => ({ tenant_id: tid, student_id: f.student_id, rule_id: f.rule.id, action: f.rule.action })));
    }
    // Parent messages: category-level notify, or a rule that fired with notify_parent.
    const notifyIds = new Set<string>([...(cat.notify_parent ? b.student_ids : []), ...fired.filter(f => f.rule.notify_parent).map(f => f.student_id)]);
    if (notifyIds.size) {
      const { data: studs } = await svc.from("students").select("id,first_name,last_name,other_names").in("id", [...notifyIds]);
      const names = new Map<string, string>((studs ?? []).map((s: any) => [s.id, studentName(s)] as [string, string]));
      for (const sid of notifyIds) {
        const rule = fired.find(f => f.student_id === sid && f.rule.notify_parent)?.rule;
        await notifyGuardians(svc, { tenantId: tid, studentIds: [sid], kind: "behaviour", createdBy: ctx.userId, budgetMs: 1500,
          build: (brand, g) => behaviourNote(brand, { guardianName: g.full_name, studentName: names.get(sid) ?? "Your child", kind: cat.kind,
            what: rule ? `${cat.name}. ${rule.action}` : cat.name, note: b.note ?? null }) });
      }
    }
    return NextResponse.json({ recorded: b.student_ids.length, actions_triggered: fired.length });
  }
  if (b.action === "delete_record") {
    const { error } = await sb.from("behaviour_records").delete().eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "resolve") {
    const { error } = await sb.from("behaviour_actions").update({ status: b.status, note: b.note ?? null, resolved_by: ctx.userId, resolved_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  const denied = adminOnly();
  if (denied) return denied;
  if (b.action === "save_category") {
    const points = b.kind === "negative" ? -Math.abs(b.points) : Math.abs(b.points);
    const row = { tenant_id: tid, name: b.name, kind: b.kind, points, notify_parent: b.notify_parent };
    const { error } = b.id ? await sb.from("behaviour_categories").update(row).eq("tenant_id", tid).eq("id", b.id) : await sb.from("behaviour_categories").insert(row);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "save_rule") {
    const row = { tenant_id: tid, name: b.name, kind: b.kind, measure: b.measure, threshold: b.threshold, window_days: b.window_days, action: b.action_text, notify_parent: b.notify_parent, active: b.active };
    const { error } = b.id ? await sb.from("behaviour_rules").update(row).eq("tenant_id", tid).eq("id", b.id) : await sb.from("behaviour_rules").insert(row);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "save_house") {
    const row = { tenant_id: tid, name: b.name, color: b.color };
    const { error } = b.id ? await sb.from("houses").update(row).eq("tenant_id", tid).eq("id", b.id) : await sb.from("houses").insert(row);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "assign_houses") {
    const { error } = await sb.from("students").update({ house_id: b.house_id }).eq("tenant_id", tid).in("id", b.student_ids);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  // seed_defaults: a sensible starting set any school can edit.
  const cats = [
    { name: "Excellent work", kind: "positive", points: 2, notify_parent: true }, { name: "Helping others", kind: "positive", points: 1, notify_parent: false },
    { name: "Leadership", kind: "positive", points: 3, notify_parent: true }, { name: "Late to class", kind: "negative", points: -1, notify_parent: false },
    { name: "No homework", kind: "negative", points: -1, notify_parent: false }, { name: "Disruption", kind: "negative", points: -2, notify_parent: false },
    { name: "Bullying", kind: "negative", points: -5, notify_parent: true }
  ];
  await sb.from("behaviour_categories").upsert(cats.map(c => ({ ...c, tenant_id: tid })), { onConflict: "tenant_id,name", ignoreDuplicates: true });
  const { count } = await sb.from("behaviour_rules").select("id", { count: "exact", head: true }).eq("tenant_id", tid);
  if (!count) {
    await sb.from("behaviour_rules").insert([
      { tenant_id: tid, name: "Repeated concerns", kind: "negative", measure: "count", threshold: 3, window_days: 14, action: "Detention and form-teacher call", notify_parent: true },
      { tenant_id: tid, name: "Star of the fortnight", kind: "positive", measure: "points", threshold: 10, window_days: 14, action: "Head teacher's commendation", notify_parent: true }
    ]);
  }
  return NextResponse.json({ ok: true });
}
