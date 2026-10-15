import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { localParts } from "@/lib/attendance";
import { weightedScore, cpdSummary, leaveYear, DEFAULT_CRITERIA, type Criterion } from "@/lib/hr";
import { tellStaff } from "@/lib/hr-server";

export const dynamic = "force-dynamic";

/**
 * Staff development: appraisal cycles, appraisals (self-review, the reviewer's review, goals,
 * acknowledgement), lesson observations to acknowledge, and CPD.
 * GET ?view=appraisals[&cycle=]   cycles and the appraisals the user can see (theirs, the ones they review, all for HR)
 * GET ?view=appraisal&id=         one appraisal with its review, observations and CPD in the cycle
 * GET ?view=cpd[&staff=]          CPD log with hours against the target (HR: &staff= anyone, or a summary of everyone)
 * GET ?view=observations          the user's lesson observations, to acknowledge
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const view = u.get("view") ?? "appraisals";
  const tid = ctx.tenant.id, sb = ctx.sb, svc = createServiceClient(), hr = hasAny(ctx, ROLES.hr);
  const today = localParts(new Date(), ctx.tenant.timezone).date;
  const { data: me } = await sb.from("staff").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();

  if (view === "appraisals") {
    const [{ data: cycles }, { data: rows }] = await Promise.all([
      sb.from("appraisal_cycles").select("id,name,starts_on,ends_on,status,criteria,self_review").eq("tenant_id", tid).order("starts_on", { ascending: false }),
      (() => { let q = sb.from("appraisals").select("id,cycle_id,staff_id,reviewer_id,status,self_submitted_at,completed_at,staff(full_name,department,position)").eq("tenant_id", tid);
        if (u.get("cycle")) q = q.eq("cycle_id", u.get("cycle")!);
        return q.order("created_at", { ascending: false }).limit(1000); })()
    ]);
    const reviewerIds = [...new Set((rows ?? []).map((r: any) => r.reviewer_id).filter(Boolean))];
    const { data: names } = reviewerIds.length ? await svc.from("users").select("id,full_name").eq("tenant_id", tid).in("id", reviewerIds) : { data: [] };
    const nameBy = new Map((names ?? []).map((n: any) => [n.id, n.full_name]));
    const { data: reviews } = hr && rows?.length ? await sb.from("appraisal_reviews").select("appraisal_id,overall,recommendation,submitted_at").in("appraisal_id", rows.map((r: any) => r.id)) : { data: [] };
    const revBy = new Map((reviews ?? []).map((r: any) => [r.appraisal_id, r]));
    const people = hr ? (await svc.from("users").select("id,full_name").eq("tenant_id", tid).eq("active", true).neq("role", "parent").neq("role", "student").order("full_name")).data ?? [] : [];
    const staff = hr ? (await sb.from("staff").select("id,full_name,line_manager_id,status").eq("tenant_id", tid).neq("status", "exited").order("full_name")).data ?? [] : [];
    return NextResponse.json({ hr, me: me?.id ?? null, user: ctx.userId, cycles: cycles ?? [], people, staff, default_criteria: DEFAULT_CRITERIA,
      appraisals: (rows ?? []).map((r: any) => ({ ...r, reviewer_name: nameBy.get(r.reviewer_id) ?? null, mine: r.staff_id === me?.id, reviewing: r.reviewer_id === ctx.userId,
        review: hr ? revBy.get(r.id) ?? null : undefined })) });
  }

  if (view === "appraisal") {
    const { data: a } = await sb.from("appraisals").select("*,staff(full_name,position,department),appraisal_cycles(name,starts_on,ends_on,criteria,self_review,status)")
      .eq("tenant_id", tid).eq("id", u.get("id") ?? "").maybeSingle();
    if (!a) return jsonError("not found", 404);
    const { data: review } = await sb.from("appraisal_reviews").select("*").eq("appraisal_id", a.id).maybeSingle();
    const c = a.appraisal_cycles as any;
    const [{ data: obs }, { data: cpd }, { data: reviewer }] = await Promise.all([
      svc.from("qa_observations").select("id,observed_on,total,max_total,strengths,improvements,acknowledged_at,teacher_response,subjects(name),class_groups(name)").eq("tenant_id", tid).eq("staff_id", a.staff_id)
        .gte("observed_on", c.starts_on).lte("observed_on", c.ends_on).order("observed_on"),
      svc.from("cpd_activities").select("title,kind,hours,status,starts_on,verified_at").eq("tenant_id", tid).eq("staff_id", a.staff_id).gte("starts_on", c.starts_on).lte("starts_on", c.ends_on).order("starts_on"),
      a.reviewer_id ? svc.from("users").select("full_name").eq("id", a.reviewer_id).maybeSingle() : Promise.resolve({ data: null })
    ]);
    const criteria = (c.criteria?.length ? c.criteria : DEFAULT_CRITERIA) as Criterion[];
    return NextResponse.json({ appraisal: { ...a, reviewer_name: reviewer?.full_name ?? null }, review: review ?? null, criteria,
      self_overall: weightedScore(criteria, a.self_scores ?? {}), review_overall: review ? weightedScore(criteria, review.scores ?? {}) : null,
      observations: obs ?? [], cpd: cpd ?? [], cpd_hours: Math.round((cpd ?? []).filter((x: any) => x.status === "completed").reduce((s: number, x: any) => s + Number(x.hours), 0) * 10) / 10,
      role: { hr, self: a.staff_id === me?.id, reviewer: a.reviewer_id === ctx.userId } });
  }

  if (view === "cpd") {
    const { data: hs } = await svc.from("hr_settings").select("cpd_target_hours,leave_year_start_month").eq("tenant_id", tid).maybeSingle();
    const target = Number(hs?.cpd_target_hours ?? 20);
    const yr = leaveYear(today, hs?.leave_year_start_month ?? 1);
    const staffId = u.get("staff") ?? me?.id ?? null;
    if (hr && u.get("summary") === "1") {
      const [{ data: staff }, { data: all }] = await Promise.all([
        sb.from("staff").select("id,full_name,department").eq("tenant_id", tid).neq("status", "exited").order("full_name"),
        sb.from("cpd_activities").select("staff_id,hours,status,starts_on,verified_at").eq("tenant_id", tid).gte("starts_on", yr.from).lte("starts_on", yr.to)
      ]);
      return NextResponse.json({ target, year: yr, summary: (staff ?? []).map((s: any) => ({ ...s, ...cpdSummary((all ?? []).filter((x: any) => x.staff_id === s.id), target, yr.from, yr.to) })) });
    }
    if (!staffId) return NextResponse.json({ target, year: yr, items: [], summary: cpdSummary([], target, yr.from, yr.to), can_verify: hr, staff_id: null });
    if (!hr && staffId !== me?.id) return jsonError("forbidden", 403);
    const { data: items } = await sb.from("cpd_activities").select("*").eq("tenant_id", tid).eq("staff_id", staffId).order("starts_on", { ascending: false });
    return NextResponse.json({ target, year: yr, items: items ?? [], summary: cpdSummary(items ?? [], target, yr.from, yr.to), can_verify: hr, staff_id: staffId });
  }

  if (view === "observations") {
    if (!me) return NextResponse.json({ observations: [] });
    const { data } = await sb.from("qa_observations").select("id,observed_on,scores,total,max_total,strengths,improvements,action_plan,follow_up_on,acknowledged_at,teacher_response,subjects(name),class_groups(name),qa_checklists(name,criteria)")
      .eq("tenant_id", tid).eq("staff_id", me.id).order("observed_on", { ascending: false }).limit(50);
    return NextResponse.json({ observations: data ?? [] });
  }
  return jsonError("unknown view", 404);
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = (n: number) => z.string().trim().max(n).nullish().transform(v => v || null);
const scores = z.record(z.string().max(40), z.number().int().min(1).max(5).nullable()).refine(o => Object.keys(o).length <= 40, "too many scores");
const Goal = z.object({ text: z.string().trim().min(1).max(300), measure: z.string().trim().max(200).nullish(), due_on: date.nullish(), status: z.enum(["open", "met", "partly", "not_met"]).default("open") });
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_cycle"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(120), starts_on: date, ends_on: date, self_review: z.boolean().default(true),
    criteria: z.array(z.object({ id: z.string().regex(/^[a-z0-9_]{1,40}$/), label: z.string().trim().min(1).max(120), weight: z.number().min(0).max(100) })).min(1).max(20) }),
  z.object({ action: z.literal("cycle_status"), id: z.string().uuid(), status: z.enum(["draft", "open", "closed"]) }),
  z.object({ action: z.literal("assign"), cycle_id: z.string().uuid(), staff_ids: z.array(z.string().uuid()).min(1).max(500), reviewer: z.union([z.literal("line_manager"), z.string().uuid()]) }),
  z.object({ action: z.literal("set_reviewer"), id: z.string().uuid(), reviewer_id: z.string().uuid() }),
  z.object({ action: z.literal("delete_appraisal"), id: z.string().uuid() }),
  z.object({ action: z.literal("self_review"), id: z.string().uuid(), scores, comments: opt(4000), submit: z.boolean().default(false) }),
  z.object({ action: z.literal("save_review"), appraisal_id: z.string().uuid(), scores, strengths: opt(4000), development: opt(4000),
    recommendation: z.enum(["confirm", "promote", "increment", "support_plan", "none"]).nullish(), submit: z.boolean().default(false) }),
  z.object({ action: z.literal("set_goals"), id: z.string().uuid(), goals: z.array(Goal).max(15) }),
  z.object({ action: z.literal("share"), id: z.string().uuid() }),
  z.object({ action: z.literal("acknowledge"), id: z.string().uuid(), comment: opt(2000) }),
  z.object({ action: z.literal("complete"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_cpd"), id: z.string().uuid().optional(), staff_id: z.string().uuid().optional(), title: z.string().trim().min(1).max(200), provider: opt(160),
    kind: z.enum(["workshop", "course", "conference", "in_house", "online", "mentoring", "reading", "other"]), starts_on: date, ends_on: date.nullish().or(z.literal("")).transform(v => v || null),
    hours: z.number().positive().max(1000), cost: z.number().min(0).max(1e10).nullish(), document_id: z.string().uuid().nullish(), status: z.enum(["planned", "completed"]), reflection: opt(4000) }),
  z.object({ action: z.literal("verify_cpd"), id: z.string().uuid(), verified: z.boolean() }),
  z.object({ action: z.literal("delete_cpd"), id: z.string().uuid() }),
  z.object({ action: z.literal("group_cpd"), staff_ids: z.array(z.string().uuid()).min(1).max(500), title: z.string().trim().min(1).max(200), provider: opt(160),
    kind: z.enum(["workshop", "course", "conference", "in_house", "online", "mentoring", "reading", "other"]), starts_on: date, hours: z.number().positive().max(1000) }),
  z.object({ action: z.literal("cpd_target"), cpd_target_hours: z.number().min(0).max(1000), leave_year_start_month: z.number().int().min(1).max(12) }),
  z.object({ action: z.literal("ack_observation"), id: z.string().uuid(), response: opt(2000) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, sb = ctx.sb, svc = createServiceClient(), hr = hasAny(ctx, ROLES.hr), base = appUrl(req);
  const hrOnly = ["save_cycle", "cycle_status", "assign", "set_reviewer", "delete_appraisal", "complete", "verify_cpd", "group_cpd", "cpd_target"];
  if (hrOnly.includes(b.action) && !hr) return jsonError("only HR can do that", 403);
  const fail = (m: string) => jsonError(m.includes("row-level security") ? "you cannot change that" : m.replace(/^.*?ERROR: /, ""));
  const myStaff = async () => (await sb.from("staff").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle()).data?.id as string | undefined;

  switch (b.action) {
    case "save_cycle": {
      if (b.ends_on < b.starts_on) return jsonError("the cycle ends before it starts");
      const { action: _a, id, ...row } = b;
      const { data, error } = id ? await sb.from("appraisal_cycles").update(row).eq("tenant_id", tid).eq("id", id).select("id").maybeSingle()
        : await sb.from("appraisal_cycles").insert({ ...row, tenant_id: tid, created_by: ctx.userId }).select("id").single();
      if (error) return fail(error.message.includes("duplicate") ? "a cycle with that name exists" : error.message);
      return NextResponse.json({ id: data?.id });
    }
    case "cycle_status": {
      const { error } = await sb.from("appraisal_cycles").update({ status: b.status }).eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "assign": {
      const { data: c } = await sb.from("appraisal_cycles").select("id,name,self_review,status").eq("tenant_id", tid).eq("id", b.cycle_id).maybeSingle();
      if (!c) return jsonError("cycle not found", 404);
      if (c.status === "closed") return jsonError("this cycle is closed");
      if (c.status === "draft") await sb.from("appraisal_cycles").update({ status: "open" }).eq("id", c.id);   // staff can see it once they are in it
      const { data: staff } = await svc.from("staff").select("id,user_id,line_manager_id").eq("tenant_id", tid).in("id", b.staff_ids);
      const { data: mgrs } = await svc.from("staff").select("id,user_id").eq("tenant_id", tid).in("id", (staff ?? []).map((s: any) => s.line_manager_id).filter(Boolean));
      const mgrUser = new Map((mgrs ?? []).map((m: any) => [m.id, m.user_id]));
      const rows = (staff ?? []).map((s: any) => {
        const reviewer = b.reviewer === "line_manager" ? mgrUser.get(s.line_manager_id) ?? null : b.reviewer;
        return { tenant_id: tid, cycle_id: c.id, staff_id: s.id, reviewer_id: reviewer === s.user_id ? null : reviewer, status: c.self_review ? "self_review" : "review" };
      });
      const { data: made, error } = await sb.from("appraisals").upsert(rows, { onConflict: "cycle_id,staff_id", ignoreDuplicates: true }).select("id,staff_id,reviewer_id");
      if (error) return fail(error.message);
      const users = (staff ?? []).filter((s: any) => (made ?? []).some((m: any) => m.staff_id === s.id)).map((s: any) => s.user_id);
      if (c.self_review) await tellStaff(svc, tid, users, "appraisal", `Appraisal: ${c.name}`, `Your appraisal for ${c.name} has started. Please complete your self-review.`, `${base}/school/hr?tab=development`);
      await tellStaff(svc, tid, [...new Set((made ?? []).map((m: any) => m.reviewer_id).filter(Boolean))] as string[], "appraisal", `Appraisals to review: ${c.name}`,
        "You have been asked to review colleagues in this appraisal cycle.", `${base}/school/hr?tab=development`);
      return NextResponse.json({ created: made?.length ?? 0, without_reviewer: rows.filter((r: any) => !r.reviewer_id).length });
    }
    case "set_reviewer": {
      const { error } = await sb.from("appraisals").update({ reviewer_id: b.reviewer_id }).eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "delete_appraisal": {
      const { error } = await sb.from("appraisals").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "self_review": {
      const patch: Record<string, unknown> = { self_scores: b.scores, self_comments: b.comments };
      if (b.submit) patch.status = "review";
      const { data, error } = await sb.from("appraisals").update(patch).eq("tenant_id", tid).eq("id", b.id).select("reviewer_id,staff(full_name)").maybeSingle();
      if (error) return fail(error.message);
      if (!data) return jsonError("not found", 404);
      if (b.submit && data.reviewer_id) await tellStaff(svc, tid, [data.reviewer_id], "appraisal", "Self-review ready", `${(data as any).staff?.full_name ?? "A colleague"} has sent their self-review.`, `${base}/school/hr?tab=development`, b.id);
      return NextResponse.json({ ok: true });
    }
    case "save_review": {
      const { data: a } = await sb.from("appraisals").select("id,status,cycle_id,appraisal_cycles(criteria)").eq("tenant_id", tid).eq("id", b.appraisal_id).maybeSingle();
      if (!a) return jsonError("not found", 404);
      const criteria = ((a.appraisal_cycles as any)?.criteria?.length ? (a.appraisal_cycles as any).criteria : DEFAULT_CRITERIA) as Criterion[];
      const overall = weightedScore(criteria, b.scores);
      if (b.submit && criteria.some(c => typeof b.scores[c.id] !== "number")) return jsonError("score every area before finishing the review");
      const { error } = await sb.from("appraisal_reviews").upsert({ appraisal_id: a.id, tenant_id: tid, scores: b.scores, overall, strengths: b.strengths, development: b.development,
        recommendation: b.recommendation ?? null, ...(b.submit ? { submitted_at: new Date().toISOString() } : {}) }, { onConflict: "appraisal_id" });
      if (error) return fail(error.message);
      if (b.submit && a.status === "self_review") await sb.from("appraisals").update({ status: "review" }).eq("id", a.id);
      return NextResponse.json({ ok: true, overall });
    }
    case "set_goals": {
      const { error } = await sb.from("appraisals").update({ goals: b.goals }).eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "share": {
      const { data, error } = await sb.from("appraisals").update({ status: "discussion" }).eq("tenant_id", tid).eq("id", b.id).select("staff(user_id)").maybeSingle();
      if (error) return fail(error.message);
      if (!data) return jsonError("not found", 404);
      const uid = (data as any).staff?.user_id;
      if (uid) await tellStaff(svc, tid, [uid], "appraisal", "Your appraisal review", "Your reviewer has shared their review. Read it, talk it through, then add your comment and acknowledge it.", `${base}/school/hr?tab=development`, b.id);
      return NextResponse.json({ ok: true });
    }
    case "acknowledge": {
      const { error } = await sb.from("appraisals").update({ staff_comment: b.comment, status: "completed" }).eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "complete": {
      const { error } = await sb.from("appraisals").update({ status: "completed" }).eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "save_cpd": {
      const { action: _a, id, staff_id, ...row } = b;
      const sid = staff_id ?? (await myStaff());
      if (!sid) return jsonError("no staff record is linked to your account", 404);
      if (!hr && sid !== (await myStaff())) return jsonError("forbidden", 403);
      const { data, error } = id ? await sb.from("cpd_activities").update(row).eq("tenant_id", tid).eq("id", id).select("id").maybeSingle()
        : await sb.from("cpd_activities").insert({ ...row, staff_id: sid, tenant_id: tid }).select("id").single();
      if (error) return fail(error.message);
      return data ? NextResponse.json({ id: data.id }) : jsonError("not found", 404);
    }
    case "verify_cpd": {
      const { error } = await sb.from("cpd_activities").update({ verified_at: b.verified ? new Date().toISOString() : null }).eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "delete_cpd": {
      const { data, error } = await sb.from("cpd_activities").delete().eq("tenant_id", tid).eq("id", b.id).select("id");
      if (error) return fail(error.message);
      return data?.length ? NextResponse.json({ ok: true }) : jsonError("not found", 404);
    }
    case "group_cpd": {
      const { action: _a, staff_ids, ...row } = b;
      const now = new Date().toISOString();
      const { error } = await sb.from("cpd_activities").insert(staff_ids.map(id => ({ ...row, staff_id: id, tenant_id: tid, status: "completed", verified_at: now })));
      return error ? fail(error.message) : NextResponse.json({ created: staff_ids.length });
    }
    case "cpd_target": {
      const { action: _a, ...row } = b;
      const { error } = await sb.from("hr_settings").upsert({ ...row, tenant_id: tid, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "ack_observation": {
      const { error } = await sb.rpc("acknowledge_observation", { p_id: b.id, p_response: b.response });
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
  }
}
