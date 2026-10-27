import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { buildAttemptLayout, toPublicQuestion, markAttempt, questionsForAttempt, type Question, type Mark } from "@/lib/exams/engine";
import { loadQuestions, markCodeQuestions, GRACE_MS, VIOLATION_KINDS } from "@/lib/exams/server";
import { refreshScore } from "@/lib/admissions-crm";
import { examTools } from "@/lib/exams/tools";

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

function windowState(at: any): "not_open" | "open" | "closed" {
  const now = Date.now();
  if (at.opens_at && now < new Date(at.opens_at).getTime()) return "not_open";
  if (at.closes_at && now > new Date(at.closes_at).getTime()) return "closed";
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
  const info = { title: at.exams?.title, instructions: at.exams?.instructions, duration_minutes: at.exams?.duration_minutes, child: at.applications?.first_name,
    window: windowState(at), opens_at: at.opens_at, closes_at: at.closes_at, status: at.status, school: { name: s?.school_name ?? at.applications?.tenants?.name, logo_url: s?.logo_url, brand_color: s?.brand_color },
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
  z.object({ action: z.literal("event"), kind: z.string().max(40) })
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
    if (windowState(at) !== "open") return jsonError(windowState(at) === "not_open" ? "this test has not opened yet" : "this test has closed", 403);
    if (!questions.length) return jsonError("the school has not finished setting this test", 409);
    const s = at.exams?.settings ?? {};
    const layout = buildAttemptLayout(questions, { shuffleQuestions: Boolean(s.shuffle_questions), shuffleOptions: s.shuffle_options !== false, draw: s.draw });
    let deadline = new Date(Date.now() + Number(at.exams?.duration_minutes ?? 60) * 60_000);
    if (at.closes_at && deadline > new Date(at.closes_at)) deadline = new Date(at.closes_at);
    await svc.from("entrance_attempts").update({ status: "in_progress", started_at: new Date().toISOString(), deadline_at: deadline.toISOString(),
      question_order: layout.question_order, option_orders: layout.option_orders }).eq("id", at.id).eq("status", "assigned");
    return NextResponse.json({ ok: true }, { status: 201 });
  }
  if (at.status !== "in_progress") return jsonError("this entrance test is not in progress", 409);
  if (b.action === "event") {
    if (VIOLATION_KINDS.has(b.kind.replace(/[^a-z_]/g, ""))) await svc.from("entrance_attempts").update({ violations: Number(at.violations ?? 0) + 1 }).eq("id", at.id);
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
