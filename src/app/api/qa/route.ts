import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { currentTerm, startOfTodayIso } from "@/lib/school";

/**
 * Quality assurance: lesson-observation checklists, observations, and live
 * school-health indicators computed from real data (score-entry completion,
 * staff punctuality, overdue library loans, pending approvals, message delivery).
 */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "qa");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  const [checklists, observations] = await Promise.all([
    sb.from("qa_checklists").select("*").eq("tenant_id", tid).order("created_at"),
    sb.from("qa_observations").select("*,staff(full_name),subjects(name),class_groups(name),observer:users!qa_observations_observer_id_fkey(full_name)")
      .eq("tenant_id", tid).order("observed_on", { ascending: false }).limit(200)
  ]);

  // ---- indicators ----
  const term = await currentTerm(sb, tid);
  let scoreCompletion: { class_group: string; subject: string; entered: number; expected: number }[] = [];
  if (term) {
    const [{ data: offerings }, { data: students }, { data: comps }, { data: scores }] = await Promise.all([
      sb.from("subject_offerings").select("class_group_id,subject_id,class_groups(name),subjects(name)").eq("tenant_id", tid),
      sb.from("students").select("id,class_group_id").eq("tenant_id", tid).eq("status", "active"),
      sb.from("grading_schemes").select("is_default,grading_components(id)").eq("tenant_id", tid).eq("is_default", true).limit(1),
      sb.from("score_entries").select("student_id,subject_id").eq("tenant_id", tid).eq("term_id", term.id).limit(200000)
    ]);
    const nComp = comps?.[0]?.grading_components?.length ?? 1;
    const perClass: Record<string, number> = {};
    const studentClass = new Map<string, string>();
    for (const s of students ?? []) { if (s.class_group_id) { perClass[s.class_group_id] = (perClass[s.class_group_id] ?? 0) + 1; studentClass.set(s.id, s.class_group_id); } }
    const entered: Record<string, number> = {};
    for (const e of scores ?? []) {
      const cg = studentClass.get(e.student_id);
      if (cg) entered[`${cg}:${e.subject_id}`] = (entered[`${cg}:${e.subject_id}`] ?? 0) + 1;
    }
    scoreCompletion = (offerings ?? []).map((o: any) => ({
      class_group: o.class_groups?.name, subject: o.subjects?.name,
      entered: entered[`${o.class_group_id}:${o.subject_id}`] ?? 0,
      expected: (perClass[o.class_group_id] ?? 0) * nComp
    })).filter((x: any) => x.expected > 0).sort((a: any, b: any) => a.entered / a.expected - b.entered / b.expected);
  }

  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [staffIn, overdue, pendingReq, pendingLeave, outbox] = await Promise.all([
    sb.from("gate_events").select("late").eq("tenant_id", tid).eq("person_type", "staff").eq("direction", "in").gte("at", since30).limit(20000),
    sb.from("library_loans").select("id", { count: "exact", head: true }).eq("tenant_id", tid).is("returned_at", null).lt("due_at", new Date().toISOString()),
    sb.from("requisitions").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("status", "submitted"),
    sb.from("leave_requests").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("status", "pending"),
    sb.from("message_outbox").select("status").eq("tenant_id", tid).gte("created_at", since30).limit(20000)
  ]);
  const ins = staffIn.data ?? [];
  const msgs = outbox.data ?? [];
  const todayStart = startOfTodayIso(ctx.tenant.timezone);
  const { count: studentsToday } = await sb.from("gate_events").select("id", { count: "exact", head: true })
    .eq("tenant_id", tid).eq("person_type", "student").eq("direction", "in").gte("at", todayStart);

  return NextResponse.json({
    checklists: checklists.data ?? [],
    observations: observations.data ?? [],
    indicators: {
      term: term ? `${term.name} ${term.academic_sessions?.name ?? ""}` : null,
      score_completion: scoreCompletion,
      staff_punctuality_30d: ins.length ? Math.round((ins.filter((x: any) => !x.late).length / ins.length) * 100) : null,
      student_signins_today: studentsToday ?? 0,
      overdue_library_loans: overdue.count ?? 0,
      pending_requisitions: pendingReq.count ?? 0,
      pending_leave: pendingLeave.count ?? 0,
      message_delivery_30d: msgs.length ? {
        total: msgs.length,
        sent: msgs.filter((m: any) => m.status === "sent").length,
        failed: msgs.filter((m: any) => m.status === "failed").length,
        skipped: msgs.filter((m: any) => m.status === "skipped").length
      } : null
    }
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_checklist"), id: z.string().uuid().optional(), name: z.string().trim().min(2).max(120),
    criteria: z.array(z.object({ id: z.string().min(1).max(20), label: z.string().trim().min(2).max(200), max: z.number().int().min(1).max(10) })).min(1).max(40) }),
  z.object({ action: z.literal("observe"), checklist_id: z.string().uuid(), staff_id: z.string().uuid(),
    subject_id: z.string().uuid().nullish(), class_group_id: z.string().uuid().nullish(),
    observed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), scores: z.record(z.number().min(0)),
    strengths: z.string().trim().max(2000).nullish(), improvements: z.string().trim().max(2000).nullish(),
    action_plan: z.string().trim().max(2000).nullish(), follow_up_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.qa, "qa");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.action === "save_checklist") {
    const row = { tenant_id: tid, name: b.name, criteria: b.criteria };
    const { data, error } = b.id
      ? await ctx.sb.from("qa_checklists").update(row).eq("tenant_id", tid).eq("id", b.id).select("id").single()
      : await ctx.sb.from("qa_checklists").insert(row).select("id").single();
    return error ? jsonError(error.message) : NextResponse.json(data);
  }
  const { data: cl } = await ctx.sb.from("qa_checklists").select("criteria").eq("tenant_id", tid).eq("id", b.checklist_id).maybeSingle();
  if (!cl) return jsonError("checklist not found", 404);
  let total = 0, max = 0;
  const clean: Record<string, number> = {};
  for (const c of cl.criteria as { id: string; max: number }[]) {
    const v = Math.min(Math.max(Number(b.scores[c.id] ?? 0), 0), c.max);
    clean[c.id] = v; total += v; max += c.max;
  }
  const { data, error } = await ctx.sb.from("qa_observations").insert({
    tenant_id: tid, checklist_id: b.checklist_id, observer_id: ctx.userId, staff_id: b.staff_id,
    subject_id: b.subject_id ?? null, class_group_id: b.class_group_id ?? null, observed_on: b.observed_on,
    scores: clean, total, max_total: max, strengths: b.strengths ?? null, improvements: b.improvements ?? null,
    action_plan: b.action_plan ?? null, follow_up_on: b.follow_up_on || null
  }).select("id").single();
  return error ? jsonError(error.message) : NextResponse.json(data, { status: 201 });
}
