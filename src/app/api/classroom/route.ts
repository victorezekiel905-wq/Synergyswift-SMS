import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireCtx, readJson, jsonError, ROLES, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { pointTotals } from "@/lib/accounts";

/**
 * Classroom points. GET without a class: the classes this teacher has (form
 * class, subject classes, classes they were added to; every class for
 * admins). GET ?class_group_id=: its students, skills and points this week.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "classroom");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const cg = new URL(req.url).searchParams.get("class_group_id");
  const svc = createServiceClient();
  const admin = hasAny(ctx, ROLES.admin);
  if (!cg) {
    const [{ data: all }, { data: offers }, { data: team }] = await Promise.all([
      svc.from("class_groups").select("id,name,level,form_teacher_id").eq("tenant_id", tid).order("name"),
      svc.from("subject_offerings").select("class_group_id,subjects(name)").eq("tenant_id", tid).eq("teacher_id", ctx.userId),
      svc.from("class_staff").select("class_group_id").eq("tenant_id", tid).eq("user_id", ctx.userId)
    ]);
    const mine = new Set<string>([...(offers ?? []).map((o: { class_group_id: string }) => o.class_group_id), ...(team ?? []).map((t: { class_group_id: string }) => t.class_group_id)]);
    const classes = (all ?? []).filter((c: { id: string; form_teacher_id: string | null }) => admin || c.form_teacher_id === ctx.userId || mine.has(c.id))
      .map((c: { id: string; name: string; level: string | null; form_teacher_id: string | null }) => ({ id: c.id, name: c.name, level: c.level, form: c.form_teacher_id === ctx.userId,
        subjects: (offers ?? []).filter((o: any) => o.class_group_id === c.id).map((o: any) => o.subjects?.name).filter(Boolean) }));
    return NextResponse.json({ classes });
  }
  const { data: allowed } = await ctx.sb.rpc("teaches_class", { p_class: cg, p_privilege: null });
  if (!allowed && !admin) return jsonError("this is not one of your classes", 403);
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ data: students }, { data: skills }, { data: events }, { data: settings }] = await Promise.all([
    svc.from("students").select("id,first_name,last_name,photo_url").eq("tenant_id", tid).eq("class_group_id", cg).eq("status", "active").order("first_name"),
    svc.from("point_skills").select("id,name,kind,points,icon,active,position").eq("tenant_id", tid).order("position"),
    svc.from("point_events").select("id,student_id,skill_name,points,note,given_by,batch_id,created_at").eq("tenant_id", tid).eq("class_group_id", cg).gte("created_at", since).order("created_at", { ascending: false }).limit(2000),
    svc.from("tenant_settings").select("points_allow_needs_work").eq("tenant_id", tid).maybeSingle()
  ]);
  const totals = pointTotals(events ?? []);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayTotals = pointTotals((events ?? []).filter((e: { created_at: string }) => new Date(e.created_at) >= today));
  const allowNeedsWork = settings?.points_allow_needs_work !== false;
  return NextResponse.json({
    students: (students ?? []).map((s: { id: string; first_name: string; last_name: string; photo_url: string | null }) => ({ ...s, week: totals.byStudent.get(s.id)?.net ?? 0, today: todayTotals.byStudent.get(s.id)?.net ?? 0 })),
    skills: (skills ?? []).filter((k: { active: boolean; kind: string }) => k.active && (allowNeedsWork || k.kind === "positive")),
    all_skills: admin ? skills ?? [] : undefined,
    recent: (events ?? []).slice(0, 30),
    class_week: totals.classNet, positive_share: totals.positiveShare, allow_needs_work: allowNeedsWork, me: ctx.userId
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("give"), class_group_id: z.string().uuid(), student_ids: z.array(z.string().uuid()).min(1).max(80), skill_id: z.string().uuid(), note: z.string().trim().max(200).nullish() }),
  z.object({ action: z.literal("undo"), batch_id: z.string().uuid() }),
  z.object({ action: z.literal("skill"), id: z.string().uuid().optional(), name: z.string().trim().min(2).max(40), kind: z.enum(["positive", "needs_work"]),
    points: z.number().int().min(-5).max(5).refine(n => n !== 0, "points cannot be 0"), icon: z.string().max(16).default("star"), active: z.boolean().default(true) }),
  z.object({ action: z.literal("settings"), points_allow_needs_work: z.boolean() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "classroom");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.action === "give") {
    const { data: skill } = await ctx.sb.from("point_skills").select("id,name,kind,points,active").eq("tenant_id", tid).eq("id", b.skill_id).maybeSingle();
    if (!skill || !skill.active) return jsonError("that skill is not available");
    if (skill.kind === "needs_work") {
      const { data: s } = await ctx.sb.from("tenant_settings").select("points_allow_needs_work").eq("tenant_id", tid).maybeSingle();
      if (s?.points_allow_needs_work === false) return jsonError("your school only gives positive points");
    }
    const batch = randomUUID();
    const rows = [...new Set(b.student_ids)].map(id => ({ tenant_id: tid, student_id: id, class_group_id: b.class_group_id, skill_id: skill.id, skill_name: skill.name, points: skill.points, note: b.note ?? null, given_by: ctx.userId, batch_id: batch }));
    // RLS checks the teacher teaches this class with the points privilege and the students are in it.
    const { error } = await ctx.sb.from("point_events").insert(rows);
    if (error) return jsonError(error.message.includes("row-level security") ? "you cannot give points in this class" : error.message, 403);
    return NextResponse.json({ ok: true, batch_id: batch, given: rows.length, points: skill.points, skill: skill.name });
  }
  if (b.action === "undo") {
    const { data, error } = await ctx.sb.from("point_events").delete().eq("tenant_id", tid).eq("batch_id", b.batch_id).select("id");
    if (error) return jsonError(error.message);
    if (!data?.length) return jsonError("too late to undo (15 minutes), or not yours");
    return NextResponse.json({ ok: true, removed: data.length });
  }
  if (!hasAny(ctx, ROLES.admin)) return jsonError("only school admins change skills and settings", 403);
  if (b.action === "settings") {
    const { error } = await ctx.sb.from("tenant_settings").update({ points_allow_needs_work: b.points_allow_needs_work }).eq("tenant_id", tid);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if ((b.kind === "positive") !== (b.points > 0)) return jsonError("positive skills add points; needs-work skills take them away");
  const row = { tenant_id: tid, name: b.name, kind: b.kind, points: b.points, icon: b.icon, active: b.active };
  const { error } = b.id ? await ctx.sb.from("point_skills").update(row).eq("tenant_id", tid).eq("id", b.id) : await ctx.sb.from("point_skills").insert(row);
  if (error) return jsonError(error.message.includes("duplicate") ? "a skill with that name already exists" : error.message);
  return NextResponse.json({ ok: true });
}
