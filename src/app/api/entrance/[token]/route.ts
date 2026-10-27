import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { buildAttemptLayout, toPublicQuestion, markAttempt, questionsForAttempt, type Question, type Mark } from "@/lib/exams/engine";
import { loadQuestions, markCodeQuestions, GRACE_MS, VIOLATION_KINDS } from "@/lib/exams/server";
import { refreshScore } from "@/lib/admissions-crm";
import { examTools } from "@/lib/exams/tools";
import { absoluteRequestUrl, verifySeb } from "@/lib/exams/seb";
import { sectionScores } from "@/lib/entrance";

export const dynamic = "force-dynamic";

/**
 * Online entrance test for an applicant, reached from a private link (no
 * account needed). Uses the same questions, shuffling and marking as school
 * exams; the score goes onto the application.
 */
async function load(token: string) {
  if (!/^[0-9a-f]{36}$/i.test(token)) return null;
  const svc = createServiceClient();
  const { data: at } = await svc.from("entrance_attempts").select("*,exams(id,title,instructions,duration_minutes,settings,status),applications(id,tenant_id,first_name,last_name,lead_id,status,tenants(status,name))").eq("token", token).maybeSingle();
  if (!at || (at as any).applications?.tenants?.status !== "active") return null;
  return { svc, at: at as any };
}

/**
 * The sitting and intake (phase 14e). Read separately so tests keep working on a database
 * without migration 20260101006200 (the columns are then simply missing).
 */
async function setting(svc: any, at: any): Promise<{ sitting: any | null; plan: any | null }> {
  const [{ data: sitting }, { data: app }] = await Promise.all([
    at.sitting_id ? svc.from("entrance_sittings").select("*").eq("id", at.sitting_id).maybeSingle() : Promise.resolve({ data: null }),
    svc.from("applications").select("entrance_plan_id").eq("id", at.application_id).maybeSingle()
  ]);
  const { data: plan } = app?.entrance_plan_id ? await svc.from("entrance_plans").select("*").eq("id", app.entrance_plan_id).maybeSingle() : { data: null };
  return { sitting: sitting ?? null, plan: plan ?? null };
}

/** At a centre, the test can be started from 30 minutes before the sitting until it ends. */
function windowState(at: any, sitting: any | null = null): "not_open" | "open" | "closed" {
  const now = Date.now();
  const opens = sitting?.kind === "centre" ? new Date(sitting.starts_at).getTime() - 30 * 60_000 : at.opens_at ? new Date(at.opens_at).getTime() : null;
  const closes = sitting?.kind === "centre" ? new Date(sitting.ends_at).getTime() : at.closes_at ? new Date(at.closes_at).getTime() : null;
  if (opens && now < opens) return "not_open";
  if (closes && now > closes) return "closed";
  return "open";
}

async function finish(svc: any, at: any, questions: Question[]) {
  if (["submitted", "graded"].includes(at.status)) return at;
  const given = questionsForAttempt(questions, at);
  const r = markAttempt(given, at.answers ?? {}, (at.marks ?? {}) as Record<string, Mark>);
  let { data: done } = await svc.from("entrance_attempts").update({ status: r.pending === 0 ? "graded" : "submitted", submitted_at: new Date().toISOString(),
    marks: r.marks, total_score: r.total_score, max_score: r.max_score }).eq("id", at.id).eq("status", "in_progress").select("*").maybeSingle();
  done = done ?? at;
  // Code answers are marked by running tests (same as school exams). markCodeQuestions writes exam_attempts, so re-mark here.
  const fake = { ...done, status: "submitted" };
  const svcProxy = { from: (t: string) => svc.from(t === "exam_attempts" ? "entrance_attempts" : t) };
  done = await markCodeQuestions(svcProxy, fake, questions);
  const pct = done.max_score ? Math.round((Number(done.total_score) / Number(done.max_score)) * 1000) / 10 : null;
  if ("section_scores" in done) await svc.from("entrance_attempts").update({ section_scores: sectionScores(given, (done.marks ?? {}) as Record<string, Mark>) }).eq("id", at.id);
  await svc.from("applications").update({ assessment_score: pct, updated_at: new Date().toISOString() }).eq("id", at.application_id);
  const app = at.applications;
  if (app?.lead_id) {
    await svc.from("lead_activities").insert({ tenant_id: at.tenant_id, lead_id: app.lead_id, kind: "system",
      body: `Entrance test "${at.exams?.title}" submitted: ${done.total_score}/${done.max_score}${pct !== null ? ` (${pct}%)` : ""}${done.status === "submitted" ? ", some answers to mark by hand" : ""}.` });
    await refreshScore(svc, at.tenant_id, app.lead_id);
  }
  return done;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const r = await load((await props.params).token);
  if (!r) return jsonError("This entrance test link is not valid.", 404);
  let { at } = r;
  const { svc } = r;
  const questions = await loadQuestions(svc, at.exam_id);
  if (at.status === "in_progress" && Date.now() > new Date(at.deadline_at).getTime() + GRACE_MS) at = await finish(svc, at, questions);
  const { data: s } = await svc.from("tenant_settings").select("school_name,logo_url,brand_color").eq("tenant_id", at.tenant_id).maybeSingle();
  const { sitting, plan } = await setting(svc, at);
  const centre = sitting?.kind === "centre" ? { name: sitting.centre, address: sitting.address, starts_at: sitting.starts_at, ends_at: sitting.ends_at, checked_in: Boolean(at.checked_in_at) } : null;
  const info = { title: at.exams?.title, instructions: at.exams?.instructions, duration_minutes: at.exams?.duration_minutes, child: at.applications?.first_name,
    window: windowState(at, sitting), opens_at: centre ? centre.starts_at : at.opens_at, closes_at: centre ? centre.ends_at : at.closes_at, status: at.status,
    centre, face_check: Boolean(plan?.face_check) && !centre, school: { name: s?.school_name ?? at.applications?.tenants?.name, logo_url: s?.logo_url, brand_color: s?.brand_color },
    tools: examTools(at.exams?.settings), reference_text: examTools(at.exams?.settings).includes("reference_sheet") ? (at.exams?.settings?.reference_text ?? null) : null };
  if (at.status !== "in_progress") return NextResponse.json({ info });
  const byId = new Map(questions.map(q => [q.id, q]));
  return NextResponse.json({ info, attempt: { deadline_at: at.deadline_at, server_now: new Date().toISOString(), answers: at.answers ?? {},
    questions: (at.question_order ?? []).map((id: string) => byId.get(id)).filter(Boolean).map((q: Question) => toPublicQuestion(q, at.option_orders?.[q.id])) } });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("save"), answers: z.record(z.any()) }),
  z.object({ action: z.literal("submit"), answers: z.record(z.any()).optional() }),
  z.object({ action: z.literal("event"), kind: z.string().max(40), meta: z.record(z.union([z.string().max(80), z.number()])).nullish() })
]);

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const r = await load((await props.params).token);
  if (!r) return jsonError("This entrance test link is not valid.", 404);
  const { svc } = r;
  let { at } = r;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("invalid request");
  const b = parsed.data;
  const questions = await loadQuestions(svc, at.exam_id);
  if (b.action === "start") {
    if (at.status === "in_progress") return NextResponse.json({ ok: true });
    if (at.status !== "assigned") return jsonError("this entrance test has already been taken", 409);
    const { sitting, plan } = await setting(svc, at);
    const state = windowState(at, sitting);
    if (state !== "open") return jsonError(state === "not_open" ? "this test has not opened yet" : "this test has closed", 403);
    if (sitting?.kind === "centre") {
      if (!at.checked_in_at) return jsonError(`This test is taken at ${sitting.centre}. Type the test PIN on the school's computer there.`, 403);
      if (plan?.seb_at_centre !== false) {
        const settings = at.exams?.settings ?? {};
        const check = verifySeb(absoluteRequestUrl(req), req.headers, { require_seb: true, seb_config_keys: settings.seb_config_keys, seb_browser_keys: settings.seb_browser_keys });
        if (!check.ok) {
          await svc.from("entrance_events").insert({ tenant_id: at.tenant_id, attempt_id: at.id, kind: "seb_refused", meta: { reason: check.reason } });
          return jsonError(check.reason ?? "This test must be taken in Safe Exam Browser.", 403);
        }
      }
    }
    if (!questions.length) return jsonError("the school has not finished setting this test", 409);
    const s = at.exams?.settings ?? {};
    const layout = buildAttemptLayout(questions, { shuffleQuestions: Boolean(s.shuffle_questions), shuffleOptions: s.shuffle_options !== false, draw: s.draw });
    let deadline = new Date(Date.now() + Number(at.exams?.duration_minutes ?? 60) * 60_000);
    const closes = sitting?.kind === "centre" ? sitting.ends_at : at.closes_at;
    if (closes && deadline > new Date(closes)) deadline = new Date(closes);
    await svc.from("entrance_attempts").update({ status: "in_progress", started_at: new Date().toISOString(), deadline_at: deadline.toISOString(),
      question_order: layout.question_order, option_orders: layout.option_orders }).eq("id", at.id).eq("status", "assigned");
    return NextResponse.json({ ok: true }, { status: 201 });
  }
  if (at.status !== "in_progress") return jsonError("this entrance test is not in progress", 409);
  if (b.action === "event") {
    const kind = b.kind.replace(/[^a-z_]/g, "");
    if (VIOLATION_KINDS.has(kind)) await svc.from("entrance_attempts").update({ violations: Number(at.violations ?? 0) + 1 }).eq("id", at.id);
    if (["no_face", "multiple_faces", "camera_off"].includes(kind) && "face_flags" in at) {
      await svc.from("entrance_attempts").update({ face_flags: Number(at.face_flags ?? 0) + 1 }).eq("id", at.id);
      await svc.from("entrance_events").insert({ tenant_id: at.tenant_id, attempt_id: at.id, kind, meta: b.meta ?? {} });
    }
    return NextResponse.json({ ok: true });
  }
  const late = Date.now() > new Date(at.deadline_at).getTime() + GRACE_MS;
  const valid = new Set(questionsForAttempt(questions, at).map(q => q.id));
  if (!late) {
    const merged = { ...(at.answers ?? {}) };
    for (const [k, v] of Object.entries(b.answers ?? {})) if (valid.has(k)) merged[k] = v;
    if (JSON.stringify(merged).length > 500_000) return jsonError("answers are too large", 413);
    await svc.from("entrance_attempts").update({ answers: merged }).eq("id", at.id);
    at = { ...at, answers: merged };
  }
  if (b.action === "submit" || late) {
    const done = await finish(svc, at, questions);
    return NextResponse.json({ status: done.status });
  }
  return NextResponse.json({ saved_at: new Date().toISOString() });
}
