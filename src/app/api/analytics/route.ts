import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { riskScore } from "@/lib/risk";
import { currentTerm, studentName } from "@/lib/school";

/**
 * Early warning: a risk score for every active student (optionally one class),
 * built from the last 30 days of attendance, behaviour and homework plus the
 * latest compiled results. Also returns open intervention plans.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "analytics");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const cg = new URL(req.url).searchParams.get("class_group_id");
  let sq = ctx.sb.from("students").select("id,admission_no,first_name,last_name,other_names,class_group_id,class_groups(name)").eq("tenant_id", tid).eq("status", "active");
  if (cg) sq = sq.eq("class_group_id", cg);
  const { data: students } = await sq.limit(5000);
  const ids = (students ?? []).map((s: any) => s.id);
  if (!ids.length) return NextResponse.json({ students: [], interventions: [], term: null });

  const term = await currentTerm(ctx.sb, tid);
  const since = new Date(Date.now() - 30 * 86400_000);
  const chunk = <T,>(arr: T[], n = 400) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  const att: any[] = [], beh: any[] = [], cards: any[] = [];
  for (const part of chunk(ids)) {
    const [a, b, c] = await Promise.all([
      ctx.sb.from("class_attendance").select("student_id,status").eq("tenant_id", tid).in("student_id", part).gte("date", since.toISOString().slice(0, 10)).limit(50000),
      ctx.sb.from("behaviour_records").select("student_id,points").eq("tenant_id", tid).eq("kind", "negative").in("student_id", part).gte("occurred_at", since.toISOString()).limit(50000),
      ctx.sb.from("report_cards").select("student_id,term_id,average,computed_at,data").eq("tenant_id", tid).in("student_id", part).order("computed_at", { ascending: false }).limit(20000)
    ]);
    att.push(...(a.data ?? [])); beh.push(...(b.data ?? [])); cards.push(...(c.data ?? []));
  }
  const classIds = [...new Set((students ?? []).map((s: any) => s.class_group_id).filter(Boolean))];
  const { data: hw } = classIds.length ? await ctx.sb.from("homework").select("id,class_group_id").eq("tenant_id", tid).in("class_group_id", classIds)
    .gte("due_at", since.toISOString()).lte("due_at", new Date().toISOString()) : { data: [] };
  const { data: subs } = (hw ?? []).length ? await ctx.sb.from("homework_submissions").select("homework_id,student_id").in("homework_id", (hw ?? []).map((h: any) => h.id)) : { data: [] };
  const submitted = new Set((subs ?? []).map((s: any) => `${s.homework_id}|${s.student_id}`));
  const { data: scheme } = await ctx.sb.from("grading_schemes").select("pass_mark").eq("tenant_id", tid).eq("is_default", true).maybeSingle();
  const passMark = Number(scheme?.pass_mark ?? 40);

  const rows = (students ?? []).map((s: any) => {
    const a = att.filter(x => x.student_id === s.id);
    const present = a.filter(x => x.status === "present" || x.status === "late").length;
    const myCards = cards.filter(c => c.student_id === s.id);
    const cur = myCards.find(c => term && c.term_id === term.id) ?? myCards[0];
    const prev = myCards.find(c => c !== cur);
    const failing = (cur?.data?.subjects ?? []).filter((x: any) => x.total !== null && x.total < (cur?.data?.scheme?.pass_mark ?? passMark)).length;
    const neg = beh.filter(x => x.student_id === s.id).reduce((t, x) => t + Math.abs(Number(x.points)), 0);
    const missing = (hw ?? []).filter((h: any) => h.class_group_id === s.class_group_id && !submitted.has(`${h.id}|${s.id}`)).length;
    const r = riskScore({
      attendanceRate: a.length ? present / a.length : null,
      average: cur?.average === null || cur?.average === undefined ? null : Number(cur.average),
      previousAverage: prev?.average === null || prev?.average === undefined ? null : Number(prev.average),
      failingSubjects: failing, passMark, negativePoints: neg, missingHomework: missing
    });
    return { id: s.id, name: studentName(s), admission_no: s.admission_no, class_name: s.class_groups?.name ?? null, ...r };
  }).sort((x: any, y: any) => y.score - x.score);

  const { data: interventions } = await ctx.sb.from("student_interventions").select("*,students(first_name,last_name,other_names,class_groups(name)),owner:users!student_interventions_owner_id_fkey(full_name)")
    .eq("tenant_id", tid).order("created_at", { ascending: false }).limit(300);
  return NextResponse.json({
    term: term ? `${term.name} ${term.academic_sessions?.name ?? ""}`.trim() : null,
    summary: { high: rows.filter((r: any) => r.level === "high").length, medium: rows.filter((r: any) => r.level === "medium").length, low: rows.filter((r: any) => r.level === "low").length },
    students: rows, interventions: interventions ?? []
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), student_id: z.string().uuid(), reason: z.string().trim().min(3).max(500), plan: z.string().trim().max(3000).nullish(),
    owner_id: z.string().uuid().nullish(), review_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }),
  z.object({ action: z.literal("update"), id: z.string().uuid(), plan: z.string().trim().max(3000).nullish(), review_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }),
  z.object({ action: z.literal("close"), id: z.string().uuid(), outcome: z.string().trim().min(2).max(2000) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "analytics");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.action === "open") {
    const { action: _a, ...row } = b;
    const { data, error } = await ctx.sb.from("student_interventions").insert({ ...row, owner_id: row.owner_id ?? ctx.userId, tenant_id: tid, created_by: ctx.userId }).select("id").single();
    return error ? jsonError(error.message) : NextResponse.json(data, { status: 201 });
  }
  if (b.action === "update") {
    const { error } = await ctx.sb.from("student_interventions").update({ plan: b.plan ?? null, review_on: b.review_on ?? null }).eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  const { error } = await ctx.sb.from("student_interventions").update({ status: "closed", outcome: b.outcome, closed_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}
