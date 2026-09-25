import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { validateQuestion, countBlanks } from "@/lib/exams/engine";
import { randomToken } from "@/lib/crypto";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const { data: exam } = await ctx.sb.from("exams").select("*").eq("tenant_id", ctx.tenant.id).eq("id", params.id).maybeSingle();
  if (!exam) return jsonError("not found", 404);
  const { data: questions } = await ctx.sb.from("exam_questions").select("*").eq("exam_id", params.id).order("position");
  return NextResponse.json({ exam, questions: questions ?? [] });
}

const iso = z.string().datetime({ offset: true }).nullish().or(z.literal(""));
const Patch = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  instructions: z.string().max(10000).nullish(),
  subject_id: z.string().uuid().nullish().or(z.literal("")),
  class_group_id: z.string().uuid().nullish().or(z.literal("")),
  term_id: z.string().uuid().nullish().or(z.literal("")),
  component_id: z.string().uuid().nullish().or(z.literal("")),
  duration_minutes: z.number().int().min(1).max(600).optional(),
  opens_at: iso, closes_at: iso,
  status: z.enum(["draft", "published", "closed"]).optional(),
  regenerate_code: z.boolean().optional(),
  settings: z.object({
    shuffle_questions: z.boolean(), shuffle_options: z.boolean(), require_fullscreen: z.boolean(),
    block_copy_paste: z.boolean(), violation_limit: z.number().int().min(1).max(50),
    show_score_after_submit: z.boolean(), allow_review: z.boolean(), require_seb: z.boolean(),
    seb_browser_keys: z.array(z.string().trim().max(128)).max(10), seb_config_keys: z.array(z.string().trim().max(128)).max(10),
    quit_password: z.string().max(64).optional(), allow_spellcheck: z.boolean(), allow_calculator: z.boolean().optional()
  }).partial().optional()
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Patch.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { data: exam } = await ctx.sb.from("exams").select("id,settings,status").eq("tenant_id", ctx.tenant.id).eq("id", params.id).maybeSingle();
  if (!exam) return jsonError("not found", 404);
  const { regenerate_code, settings, ...rest } = parsed.data;
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(rest)) fields[k] = v === "" ? null : v;
  if (settings) fields.settings = { ...exam.settings, ...settings };
  if (regenerate_code) fields.access_code = randomToken(3).toUpperCase();

  if (rest.status === "published") {
    const { data: qs } = await ctx.sb.from("exam_questions").select("type,prompt,points,data,answer").eq("exam_id", params.id);
    if (!qs?.length) return jsonError("add at least one question before publishing");
    const bad = qs.map((q: any, i: number) => ({ i, p: validateQuestion(q) })).filter((x: any) => x.p.length);
    if (bad.length) return jsonError(`Question ${bad[0].i + 1}: ${bad[0].p.join(" ")}`);
    const s = (fields.settings ?? exam.settings) as any;
    if (s.require_seb && !(s.seb_config_keys?.length || s.seb_browser_keys?.length)) {
      // allowed (falls back to user-agent check) but make it explicit in the response
      fields.settings = { ...s, seb_ua_only: true };
    }
  }
  const { error } = await ctx.sb.from("exams").update(fields).eq("tenant_id", ctx.tenant.id).eq("id", params.id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const { count } = await ctx.sb.from("exam_attempts").select("id", { count: "exact", head: true }).eq("exam_id", params.id);
  if ((count ?? 0) > 0) return jsonError("students have already sat this exam; close it instead of deleting");
  const { error } = await ctx.sb.from("exams").delete().eq("tenant_id", ctx.tenant.id).eq("id", params.id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}

const QuestionBody = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(["mcq_single", "mcq_multi", "true_false", "short_answer", "numeric", "fill_blanks", "matching", "ordering", "hotspot", "essay", "code", "file_upload"]),
  prompt: z.string().trim().min(1).max(20000),
  media_url: z.string().trim().url().nullish().or(z.literal("")),
  section: z.string().trim().max(80).nullish(),
  points: z.number().min(0).max(1000),
  data: z.record(z.any()).default({}),
  answer: z.record(z.any()).default({})
});

/** POST: upsert a question. PUT: { order: [ids] } reorder. DELETE: ?question_id= */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = QuestionBody.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const q = parsed.data;
  const { data: exam } = await ctx.sb.from("exams").select("id").eq("tenant_id", ctx.tenant.id).eq("id", params.id).maybeSingle();
  if (!exam) return jsonError("exam not found", 404);
  if (q.type === "fill_blanks" && (q.answer.blanks ?? []).length !== countBlanks(q.data.text ?? "")) {
    // derive accepted answers from [[a|b]] markers when the client did not send them
    const blanks: string[][] = [];
    String(q.data.text ?? "").replace(/\[\[([^\]]*)\]\]/g, (_m, inner: string) => { blanks.push(inner.split("|").map(s => s.trim()).filter(Boolean)); return ""; });
    q.answer = { ...q.answer, blanks };
  }
  const problems = validateQuestion(q);
  if (problems.length) return jsonError(problems.join(" "));
  const row = { ...q, media_url: q.media_url || null, exam_id: params.id };
  if (q.id) {
    const { error } = await ctx.sb.from("exam_questions").update(row).eq("exam_id", params.id).eq("id", q.id);
    return error ? jsonError(error.message) : NextResponse.json({ id: q.id });
  }
  const { data: last } = await ctx.sb.from("exam_questions").select("position").eq("exam_id", params.id).order("position", { ascending: false }).limit(1);
  const { data, error } = await ctx.sb.from("exam_questions").insert({ ...row, position: (last?.[0]?.position ?? 0) + 1 }).select("id").single();
  return error ? jsonError(error.message) : NextResponse.json(data, { status: 201 });
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const { order } = await readJson<{ order?: string[] }>(req);
  if (!Array.isArray(order)) return jsonError("order required");
  for (let i = 0; i < order.length; i++) {
    await ctx.sb.from("exam_questions").update({ position: i + 1 }).eq("exam_id", params.id).eq("id", order[i]);
  }
  return NextResponse.json({ ok: true });
}
