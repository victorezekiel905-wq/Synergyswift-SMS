import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { validateQuestion, parseFillBlanks, QUESTION_TYPES } from "@/lib/exams/engine";
import { parseCsv } from "@/lib/school";

const TYPES = QUESTION_TYPES.map(t => t.type) as [string, ...string[]];
const DIFFICULTY = ["easy", "medium", "hard"] as const;
const BLOOM = ["remember", "understand", "apply", "analyse", "evaluate", "create"] as const;

/** Search the bank. ?facets=1 also returns the topics, exam bodies and years in use. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const p = (k: string) => u.searchParams.get(k) || null;
  let q = ctx.sb.from("question_bank")
    .select("id,subject_id,level,topic,difficulty,bloom,exam_body,exam_year,type,prompt,media_url,points,data,answer,explanation,practice,times_used,created_by,created_at,subjects(name)", { count: "exact" })
    .eq("tenant_id", ctx.tenant.id);
  for (const k of ["subject_id", "difficulty", "bloom", "exam_body", "type", "level"]) if (p(k)) q = q.eq(k, p(k));
  if (p("topic")) q = q.ilike("topic", p("topic")!);
  if (p("exam_year")) q = q.eq("exam_year", Number(p("exam_year")));
  if (p("practice")) q = q.eq("practice", p("practice") === "1");
  if (p("search")) q = q.ilike("prompt", `%${p("search")!.replace(/[%_]/g, "")}%`);
  const limit = Math.min(Number(p("limit") ?? 50), 200), offset = Math.max(Number(p("offset") ?? 0), 0);
  const { data, error, count } = await q.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (error) return jsonError(error.message);
  let facets = null;
  if (p("facets")) {
    const { data: f } = await ctx.sb.from("question_bank").select("topic,exam_body,exam_year,level").eq("tenant_id", ctx.tenant.id).limit(5000);
    const uniq = (k: string) => [...new Set((f ?? []).map((r: any) => r[k]).filter((v: unknown) => v !== null && v !== ""))].sort();
    facets = { topics: uniq("topic"), exam_bodies: uniq("exam_body"), years: uniq("exam_year").reverse(), levels: uniq("level") };
  }
  return NextResponse.json({ questions: data ?? [], total: count ?? 0, facets });
}

const Meta = {
  subject_id: z.string().uuid().nullish().or(z.literal("")),
  level: z.string().trim().max(40).nullish(),
  topic: z.string().trim().max(120).nullish(),
  difficulty: z.enum(DIFFICULTY).nullish().or(z.literal("")),
  bloom: z.enum(BLOOM).nullish().or(z.literal("")),
  exam_body: z.string().trim().max(40).nullish(),
  exam_year: z.number().int().min(1950).max(2100).nullish(),
  explanation: z.string().max(5000).nullish(),
  practice: z.boolean().optional()
};
const Question = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(TYPES),
  prompt: z.string().trim().min(1).max(20000),
  media_url: z.string().trim().url().nullish().or(z.literal("")),
  points: z.number().min(0).max(1000),
  data: z.record(z.any()).default({}),
  answer: z.record(z.any()).default({}),
  ...Meta
});
const Import = z.object({ action: z.literal("import"), csv: z.string().max(5_000_000), defaults: z.object(Meta).partial().default({}) });

const clean = (v: unknown) => (v === "" || v === undefined ? null : v);

/** POST a question to add or update it, or { action: "import", csv } for many at once. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const body = await readJson<Record<string, unknown>>(req);
  if (body?.action === "import") return importCsv(ctx, body);
  const parsed = Question.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const q = parsed.data;
  if (q.type === "fill_blanks") q.answer = { ...q.answer, ...parseFillBlanks(String(q.data.text ?? "")).answer };
  const problems = validateQuestion(q as any);
  if (problems.length) return jsonError(problems.join(" "));
  const row: Record<string, unknown> = {
    type: q.type, prompt: q.prompt, media_url: clean(q.media_url), points: q.points, data: q.data, answer: q.answer,
    subject_id: clean(q.subject_id), level: clean(q.level), topic: clean(q.topic), difficulty: clean(q.difficulty), bloom: clean(q.bloom),
    exam_body: clean(q.exam_body), exam_year: q.exam_year ?? null, explanation: clean(q.explanation), practice: Boolean(q.practice),
    updated_at: new Date().toISOString()
  };
  if (q.id) {
    const { data, error } = await ctx.sb.from("question_bank").update(row).eq("tenant_id", ctx.tenant.id).eq("id", q.id).select("id").maybeSingle();
    if (error) return jsonError(error.message);
    if (!data) return jsonError("only the teacher who added this question, or an admin, can change it", 403);
    return NextResponse.json({ id: data.id });
  }
  const { data, error } = await ctx.sb.from("question_bank").insert({ ...row, tenant_id: ctx.tenant.id, created_by: ctx.userId }).select("id").single();
  return error ? jsonError(error.message) : NextResponse.json(data, { status: 201 });
}

/**
 * Spreadsheet import (CSV saved from Excel or Google Sheets). Columns, any order:
 *   question, a, b, c, d, e, answer, type, points, topic, difficulty, bloom,
 *   exam_body, year, level, explanation
 * Objective questions: options in a–e and the answer as a letter ("C").
 * Several correct letters ("A,C") make a multi-answer question. Without options
 * the answer is a short answer; "true"/"false" makes a true/false question.
 */
async function importCsv(ctx: any, body: unknown) {
  const parsed = Import.safeParse(body);
  if (!parsed.success) return jsonError("send the spreadsheet as CSV text");
  const rows = parseCsv(parsed.data.csv);
  if (!rows.length) return jsonError("the file has no rows");
  const d = parsed.data.defaults;
  const out: Record<string, unknown>[] = [];
  const problems: string[] = [];
  rows.forEach((raw, i) => {
    const r: Record<string, string> = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.trim().toLowerCase().replace(/\s+/g, "_"), String(v ?? "").trim()]));
    const prompt = r.question || r.prompt;
    if (!prompt) return;
    const letters = ["a", "b", "c", "d", "e"].filter(l => r[l] || r[`option_${l}`]);
    const options = letters.map(l => ({ id: l, text: r[l] || r[`option_${l}`] }));
    const ans = (r.answer || r.correct || "").trim();
    let type = r.type || "", data: Record<string, unknown> = {}, answer: Record<string, unknown> = {};
    if (options.length >= 2) {
      const correct = ans.toLowerCase().split(/[\s,;/]+/).filter(Boolean);
      type = type || (correct.length > 1 ? "mcq_multi" : "mcq_single");
      data = { options };
      answer = type === "mcq_multi" ? { correct, partial: true } : { correct: correct[0] };
    } else if (/^(true|false)$/i.test(ans) && (!type || type === "true_false")) {
      type = "true_false"; answer = { correct: /^true$/i.test(ans) };
    } else if (type === "math") {
      answer = { expression: ans };
    } else if (type === "numeric") {
      answer = { value: Number(ans), tolerance: Number(r.tolerance || 0) };
    } else if (type === "essay") {
      answer = { rubric: ans };
    } else {
      type = "short_answer"; data = { max_length: 200 }; answer = { accepted: ans.split("|").map(s => s.trim()).filter(Boolean), case_sensitive: false };
    }
    const q = { type, prompt, points: Number(r.points || 1), data, answer };
    const p = validateQuestion(q as any);
    if (p.length) { problems.push(`Row ${i + 2}: ${p.join(" ")}`); return; }
    const year = Number(r.year || r.exam_year || d.exam_year || NaN);
    const diff = (r.difficulty || d.difficulty || "").toLowerCase();
    const bloom = (r.bloom || d.bloom || "").toLowerCase().replace("analyze", "analyse");
    out.push({
      ...q, tenant_id: ctx.tenant.id, created_by: ctx.userId,
      subject_id: clean(d.subject_id), level: r.level || d.level || null, topic: r.topic || d.topic || null,
      difficulty: (DIFFICULTY as readonly string[]).includes(diff) ? diff : null,
      bloom: (BLOOM as readonly string[]).includes(bloom) ? bloom : null,
      exam_body: r.exam_body || r.exam || d.exam_body || null,
      exam_year: Number.isInteger(year) && year >= 1950 && year <= 2100 ? year : null,
      explanation: r.explanation || null, practice: d.practice ?? false
    });
  });
  if (!out.length) return jsonError(problems.length ? problems.slice(0, 10).join("\n") : "no questions found; the first row must be headings such as question, a, b, c, d, answer");
  for (let i = 0; i < out.length; i += 500) {
    const { error } = await ctx.sb.from("question_bank").insert(out.slice(i, i + 500));
    if (error) return jsonError(error.message);
  }
  return NextResponse.json({ imported: out.length, skipped: problems.length, problems: problems.slice(0, 20) });
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return jsonError("id required");
  const { data, error } = await ctx.sb.from("question_bank").delete().eq("tenant_id", ctx.tenant.id).eq("id", id).select("id");
  if (error) return jsonError(error.message);
  if (!data?.length) return jsonError("only the teacher who added this question, or an admin, can delete it", 403);
  return NextResponse.json({ ok: true });
}
