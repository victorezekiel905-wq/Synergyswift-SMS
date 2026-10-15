import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny, type Ctx } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { studentName } from "@/lib/school";
import { earns, statsFrom, STARTER_BADGES, type BadgeRule } from "@/lib/lms";

export const dynamic = "force-dynamic";

/** Points, streak and badges for one student; automatic badges they have earned are awarded as they are looked at. */
async function progressFor(svc: any, tenantId: string, studentId: string) {
  const since = new Date(Date.now() - 400 * 86400_000).toISOString().slice(0, 10);
  const [{ data: activity }, { data: badges }, { data: mine }] = await Promise.all([
    svc.from("learning_activity").select("kind,points,on_date").eq("student_id", studentId).gte("on_date", since).limit(10000),
    svc.from("badges").select("id,name,description,emoji,rule,active").eq("tenant_id", tenantId).eq("active", true).order("name"),
    svc.from("student_badges").select("badge_id,awarded_at,reason,users:awarded_by(full_name)").eq("student_id", studentId)
  ]);
  const stats = statsFrom(activity ?? []);
  const have = new Set((mine ?? []).map((b: any) => b.badge_id));
  const fresh = (badges ?? []).filter((b: any) => b.rule && !have.has(b.id) && earns(b.rule as BadgeRule, stats));
  if (fresh.length) await svc.from("student_badges").upsert(fresh.map((b: any) => ({ tenant_id: tenantId, badge_id: b.id, student_id: studentId, reason: "Earned" })), { onConflict: "badge_id,student_id", ignoreDuplicates: true });
  const earned = new Map<string, any>((mine ?? []).map((b: any) => [b.badge_id, b]));
  for (const b of fresh) earned.set(b.id, { badge_id: b.id, awarded_at: new Date().toISOString(), reason: "Earned" });
  // Last 14 school-week days of activity, for a small chart.
  const days: { date: string; points: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    days.push({ date: d, points: (activity ?? []).filter((a: any) => a.on_date === d).reduce((s: number, a: any) => s + a.points, 0) });
  }
  return {
    stats, days, new_badges: fresh.map((b: any) => b.name),
    badges: (badges ?? []).map((b: any) => {
      const e = earned.get(b.id);
      const rule = b.rule as BadgeRule | null;
      return { id: b.id, name: b.name, description: b.description, emoji: b.emoji, automatic: Boolean(rule), earned_at: e?.awarded_at ?? null, reason: e?.reason ?? null, by: e?.users?.full_name ?? null,
        progress: rule && !e ? Math.min(1, (stats[rule.type] ?? 0) / rule.threshold) : null };
    })
  };
}

async function studentFor(ctx: Ctx, svc: any, requested: string | null) {
  if (ctx.roles.has("student")) return (await svc.from("students").select("id,first_name,last_name,other_names").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle()).data;
  if (!requested) return null;
  if (hasAny(ctx, ROLES.staff)) return (await svc.from("students").select("id,first_name,last_name,other_names").eq("tenant_id", ctx.tenant.id).eq("id", requested).maybeSingle()).data;
  if (ctx.roles.has("parent")) {
    const { data: g } = await svc.from("guardians").select("id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
    const { data: link } = g ? await svc.from("student_guardians").select("students(id,first_name,last_name,other_names)").eq("guardian_id", g.id).eq("student_id", requested).maybeSingle() : { data: null };
    return (link as any)?.students ?? null;
  }
  return null;
}

/**
 * ?student_id= (staff, parents) or the signed-in student: points, streak, badges.
 * ?list=badges (staff): the school's badges. ?class_group_id= (staff): the class at a glance.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx();
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const u = new URL(req.url).searchParams;
  const tid = ctx.tenant.id;
  if (u.get("list") === "badges") {
    if (!hasAny(ctx, ROLES.staff)) return jsonError("forbidden", 403);
    const { data } = await svc.from("badges").select("id,name,description,emoji,rule,active,student_badges(count)").eq("tenant_id", tid).order("name");
    return NextResponse.json({ items: data ?? [], admin: hasAny(ctx, ROLES.admin) });
  }
  const cls = u.get("class_group_id");
  if (cls) {
    if (!hasAny(ctx, ROLES.staff)) return jsonError("forbidden", 403);
    const { data: students } = await svc.from("students").select("id,first_name,last_name,other_names").eq("tenant_id", tid).eq("class_group_id", cls).eq("status", "active").order("first_name");
    const ids = (students ?? []).map((s: any) => s.id);
    const since = new Date(Date.now() - 400 * 86400_000).toISOString().slice(0, 10);
    const [{ data: act }, { data: earned }] = ids.length ? await Promise.all([
      svc.from("learning_activity").select("student_id,kind,points,on_date").in("student_id", ids).gte("on_date", since).limit(50000),
      svc.from("student_badges").select("student_id,badges(emoji,name)").in("student_id", ids)
    ]) : [{ data: [] }, { data: [] }];
    return NextResponse.json({ students: (students ?? []).map((s: any) => ({ id: s.id, name: studentName(s), ...statsFrom((act ?? []).filter((a: any) => a.student_id === s.id)),
      badges: (earned ?? []).filter((b: any) => b.student_id === s.id).map((b: any) => b.badges) })) });
  }
  const st = await studentFor(ctx, svc, u.get("student_id"));
  if (!st) return jsonError("student not found", 404);
  return NextResponse.json({ student: { id: st.id, name: studentName(st) }, ...(await progressFor(svc, tid, st.id)) });
}

const Rule = z.object({ type: z.enum(["streak", "points", "homework", "practice", "forum"]), threshold: z.number().int().min(1).max(10000) });
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("starter") }),
  z.object({ action: z.literal("save"), id: z.string().uuid().nullish(), name: z.string().trim().min(2).max(60), description: z.string().trim().max(200).nullish(), emoji: z.string().trim().min(1).max(8), rule: Rule.nullable(), active: z.boolean().default(true) }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("award"), badge_id: z.string().uuid(), student_ids: z.array(z.string().uuid()).min(1).max(200), reason: z.string().trim().max(200).nullish() }),
  z.object({ action: z.literal("revoke"), badge_id: z.string().uuid(), student_id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  switch (b.action) {
    case "starter": {
      const { error } = await sb.from("badges").upsert(STARTER_BADGES.map(x => ({ ...x, tenant_id: tid })), { onConflict: "tenant_id,name", ignoreDuplicates: true });
      return error ? jsonError(/row-level/.test(error.message) ? "only school admins manage badges" : error.message) : NextResponse.json({ ok: true });
    }
    case "save": {
      const row = { tenant_id: tid, name: b.name, description: b.description ?? null, emoji: b.emoji, rule: b.rule, active: b.active };
      const { error } = b.id ? await sb.from("badges").update(row).eq("tenant_id", tid).eq("id", b.id) : await sb.from("badges").insert(row);
      return error ? jsonError(/row-level/.test(error.message) ? "only school admins manage badges" : error.message) : NextResponse.json({ ok: true });
    }
    case "delete": {
      const { error } = await sb.from("badges").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "award": {
      const { data: ok } = await sb.from("students").select("id").eq("tenant_id", tid).in("id", b.student_ids);
      const rows = (ok ?? []).map((s: any) => ({ tenant_id: tid, badge_id: b.badge_id, student_id: s.id, awarded_by: ctx.userId, reason: b.reason ?? null }));
      const { error } = await sb.from("student_badges").upsert(rows, { onConflict: "badge_id,student_id", ignoreDuplicates: true });
      return error ? jsonError(/row-level/.test(error.message) ? "this badge is earned automatically and cannot be handed out" : error.message) : NextResponse.json({ ok: true, awarded: rows.length });
    }
    case "revoke": {
      const { error } = await sb.from("student_badges").delete().eq("tenant_id", tid).eq("badge_id", b.badge_id).eq("student_id", b.student_id);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
  }
}
