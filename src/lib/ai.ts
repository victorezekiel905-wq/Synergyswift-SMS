/**
 * The one door to AI for the whole platform (phase 14p). Every feature asks for
 * JSON that matches a zod schema, so the app never scrapes free text.
 *
 * Provider: Google Gemini (GEMINI_API_KEY, optional GEMINI_MODEL and, for the
 * heavier jobs, GEMINI_MODEL_PRO). A server that only has ANTHROPIC_API_KEY
 * keeps working on Claude until a Gemini key is added.
 *
 * Each request is counted in ai_usage against the school (and person) the
 * request is for, and refused once the school has used its monthly allowance
 * (tenant_settings.ai_monthly_limit, else AI_MONTHLY_LIMIT, else 3,000).
 * AI is for teachers and school staff only: students and parents can't
 * generate anything (translating a parent's message for the school is the one
 * exception, and it counts only against the school's total). The allowance is
 * split evenly across the school's staff so the shares fit inside it. School
 * admins and the principal are not held to a share (they draft for the whole
 * school, e.g. principal's comments); scheduled jobs count only against the
 * school's total.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { currentRequest } from "./request-actor";

export type AiProvider = "gemini" | "anthropic";
export type AiTurn = { role: "user" | "model"; text: string };
export type AiFile = { mimeType: string; base64: string };

/** Something to tell the person plainly (not set up, busy, allowance used, broken answer). */
export class AiUnavailable extends Error {
  constructor(message: string, readonly status = 503) { super(message); }
}
/** The model would not write this (safety filters). */
export class AiDeclined extends Error {}

const usable = (k: string | undefined) => Boolean(k?.trim() && !k.includes("replace"));

export function aiProvider(): AiProvider | null {
  if (usable(process.env.GEMINI_API_KEY)) return "gemini";
  if (usable(process.env.ANTHROPIC_API_KEY)) return "anthropic";
  return null;
}
export const aiConfigured = () => aiProvider() !== null;

/** Whether this school may use AI: the server has a key and the school has the AI module. */
export function aiAllowed(ctx: { tenant: { modules?: Record<string, boolean> | null } }): boolean {
  return aiConfigured() && ctx.tenant.modules?.ai !== false;
}

export function geminiModel(quality: "fast" | "best" = "fast"): string {
  const fast = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  return quality === "best" ? process.env.GEMINI_MODEL_PRO?.trim() || fast : fast;
}
const CLAUDE_MODEL = "claude-opus-5-5";

export type JsonRequest<S extends z.ZodType> = {
  /** Short name for the usage log, e.g. "report_comments". */
  task: string;
  system: string;
  /** One user message, or a conversation (turns). */
  prompt?: string;
  turns?: AiTurn[];
  files?: AiFile[];
  schema: S;
  temperature?: number;
  maxTokens?: number;
  quality?: "fast" | "best";
  timeoutMs?: number;
  /** Who to count the request against when there is no signed-in request (scheduled jobs). */
  tenantId?: string | null;
  userId?: string | null;
};

type Raw = { text: string; model: string; inputTokens: number; outputTokens: number };

// ---------------- allowance and usage ----------------

const DEFAULT_MONTHLY = () => Number(process.env.AI_MONTHLY_LIMIT) > 0 ? Number(process.env.AI_MONTHLY_LIMIT) : 3000;
const seen = new Map<string, { used: number; limit: number; off: boolean; staff: number; at: number }>();
const mine = new Map<string, { used: number; kind: "staff" | "family" | "free"; at: number }>();

/** Each staff member's share of a school's monthly allowance: an even split, so the shares add up to at most the total. */
export function staffShare(limit: number, staff: number): number {
  return staff > 0 ? Math.max(1, Math.floor(limit / staff)) : limit;
}
/** Tasks a student's or parent's action may start (school communication, not generating content). */
const FAMILY_TASKS = new Set(["translate"]);
const UNCAPPED = new Set(["school_admin", "principal", "platform_admin"]);
const monthStart = () => { const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); return d.toISOString(); };

async function service() {
  const { createServiceClient } = await import("./supabase/service");
  return createServiceClient();
}

/** Refuses when the school doesn't have the AI module or has used this month's allowance. Never blocks when they can't be read. */
async function checkAllowance(tenantId: string | null, userId: string | null, task: string) {
  if (!tenantId) return;
  let entry = seen.get(tenantId);
  if (!entry || Date.now() - entry.at > 60_000) {
    try {
      const svc = await service();
      const [{ data: used }, { data: st }, { data: t }, { count: staff }] = await Promise.all([
        svc.rpc("ai_requests_this_month", { p_tenant: tenantId }),
        svc.from("tenant_settings").select("*").eq("tenant_id", tenantId).maybeSingle(),
        svc.from("tenants").select("modules").eq("id", tenantId).maybeSingle(),
        svc.from("users").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("active", true).not("role", "in", "(student,parent)")
      ]);
      const own = (st as { ai_monthly_limit?: number | null } | null)?.ai_monthly_limit;
      const off = (t as { modules?: Record<string, boolean> | null } | null)?.modules?.ai === false;
      entry = { used: Number(used ?? 0), limit: typeof own === "number" ? own : DEFAULT_MONTHLY(), off, staff: staff ?? 0, at: Date.now() };
      seen.set(tenantId, entry);
    } catch { return; }
  }
  if (entry.off) throw new AiUnavailable("AI isn't part of your school's plan. Your Synergy Swift account manager can add it.", 403);
  if (entry.used >= entry.limit) {
    throw new AiUnavailable("Your school has used this month's AI allowance. It renews on the 1st; your Synergy Swift account manager can raise it.", 429);
  }
  if (!userId) return;
  // This person's share of the school's allowance.
  const key = `${tenantId}:${userId}`;
  let me = mine.get(key);
  if (!me || Date.now() - me.at > 60_000) {
    try {
      const svc = await service();
      const [{ data: u }, { count }] = await Promise.all([
        svc.from("users").select("role,extra_roles").eq("id", userId).maybeSingle(),
        svc.from("ai_usage").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("user_id", userId).gte("at", monthStart())
      ]);
      const roles = [u?.role, ...((u?.extra_roles as string[] | null) ?? [])].filter(Boolean) as string[];
      const kind = roles.some(r => UNCAPPED.has(r)) ? "free" : roles.every(r => r === "student" || r === "parent") ? "family" : "staff";
      me = { used: count ?? 0, kind, at: Date.now() };
      mine.set(key, me);
    } catch { return; }
  }
  if (me.kind === "free") return;
  if (me.kind === "family") {
    if (FAMILY_TASKS.has(task)) return;
    throw new AiUnavailable("AI tools are for teachers and school staff.", 403);
  }
  const share = staffShare(entry.limit, entry.staff);
  if (me.used >= share) {
    throw new AiUnavailable(`You've used your share of the school's AI for this month (${share} requests). It renews on the 1st; your school admin can ask for a bigger allowance.`, 429);
  }
}

/** A person's share and use this month, for the school's AI page. */
export async function allowanceFor(svc: any, tenantId: string, limit: number) {
  const { count } = await svc.from("users").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("active", true).not("role", "in", "(student,parent)");
  const staff = count ?? 0;
  return { staff, share: staffShare(limit, staff) };
}

async function recordUsage(row: { tenantId: string | null; userId: string | null; task: string; provider: AiProvider; model: string; inputTokens: number; outputTokens: number; ok: boolean }) {
  if (row.tenantId) {
    const e = seen.get(row.tenantId); if (e) e.used++;
    const m = row.userId ? mine.get(`${row.tenantId}:${row.userId}`) : undefined; if (m) m.used++;
  }
  try {
    const svc = await service();
    await svc.from("ai_usage").insert({ tenant_id: row.tenantId, user_id: row.userId, task: row.task.slice(0, 60), provider: row.provider,
      model: row.model, input_tokens: row.inputTokens, output_tokens: row.outputTokens, ok: row.ok });
  } catch { /* usage logging never breaks the feature */ }
}

// ---------------- Gemini ----------------

/** JSON Schema for Gemini's responseJsonSchema (zod's output minus the $schema marker). */
export function geminiSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

type GeminiReply = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { message?: string; status?: string };
};

const BLOCKED = /SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII|RECITATION|IMAGE_SAFETY/;

async function callGemini(r: JsonRequest<z.ZodType>, strict: boolean): Promise<Raw> {
  const key = process.env.GEMINI_API_KEY!.trim();
  const model = geminiModel(r.quality);
  const parts = (text: string, withFiles: boolean) => [
    ...(withFiles ? (r.files ?? []).map(f => ({ inlineData: { mimeType: f.mimeType, data: f.base64 } })) : []),
    { text }
  ];
  const contents = r.turns?.length
    ? r.turns.map((t, i) => ({ role: t.role, parts: parts(t.text, i === 0) }))
    : [{ role: "user", parts: parts(r.prompt ?? "", true) }];
  const schema = geminiSchema(r.schema);
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json", temperature: r.temperature ?? 0.7, maxOutputTokens: r.maxTokens ?? 16384
  };
  let system = r.system;
  if (strict) generationConfig.responseJsonSchema = schema;
  else system += `\n\nReply with JSON only, matching this JSON Schema exactly:\n${JSON.stringify(schema)}`;
  const body = JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig });

  // Google AI Studio keys use the Gemini API; Vertex AI "express" keys use Vertex. Try both.
  const endpoints = [
    { url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, headers: { "x-goog-api-key": key } as Record<string, string> },
    { url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(key)}`, headers: {} as Record<string, string> }
  ];
  let problem = "";
  for (const ep of endpoints) {
    let res: Response;
    try {
      res = await fetch(ep.url, { method: "POST", headers: { "Content-Type": "application/json", ...ep.headers }, body, signal: AbortSignal.timeout(r.timeoutMs ?? 120_000) });
    } catch (e) {
      problem = (e as Error).name === "TimeoutError" ? "timeout" : "network";
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as GeminiReply;
    if (res.status === 429) throw new AiUnavailable("The AI is busy right now. Try again in a minute.", 429);
    if (!res.ok) {
      problem = `${res.status} ${data.error?.status ?? ""} ${data.error?.message ?? ""}`;
      if (res.status === 400 && strict && /responseJsonSchema|response_json_schema|schema/i.test(problem)) throw new SchemaRejected();
      continue;
    }
    if (data.promptFeedback?.blockReason) throw new AiDeclined("The AI would not write this. Try wording it differently.");
    const cand = data.candidates?.[0];
    if (cand?.finishReason && BLOCKED.test(cand.finishReason)) throw new AiDeclined("The AI would not write this. Try wording it differently.");
    if (cand?.finishReason === "MAX_TOKENS") throw new AiUnavailable("That was too much to write in one go. Ask for less and try again.", 422);
    const text = (cand?.content?.parts ?? []).filter(p => !p.thought).map(p => p.text ?? "").join("");
    const u = data.usageMetadata ?? {};
    return { text, model, inputTokens: u.promptTokenCount ?? 0, outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
  }
  console.error("[ai] Gemini failed:", problem.slice(0, 300));
  if (/API_KEY_INVALID|API key not valid|PERMISSION_DENIED|UNAUTHENTICATED|^40[13]/.test(problem)) {
    throw new AiUnavailable("The site's Gemini API key was refused. Ask your Synergy Swift administrator to check it.");
  }
  if (/^404/.test(problem)) throw new AiUnavailable("The Gemini model set for this site wasn't found. Ask your administrator to check GEMINI_MODEL.");
  throw new AiUnavailable("Couldn't reach the AI just now. Try again in a minute.", 502);
}
class SchemaRejected extends Error {}

// ---------------- Claude (until a Gemini key is added) ----------------

let claude: Anthropic | null = null;
async function callClaude(r: JsonRequest<z.ZodType>): Promise<{ raw: Raw; parsed: unknown }> {
  claude ??= new Anthropic();
  const docs = (r.files ?? []).filter(f => f.mimeType === "application/pdf")
    .map(f => ({ type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: f.base64 } }));
  const turns = r.turns?.length ? r.turns : [{ role: "user" as const, text: r.prompt ?? "" }];
  const messages = turns.map((t, i) => ({
    role: t.role === "user" ? "user" as const : "assistant" as const,
    content: i === 0 && docs.length ? [...docs, { type: "text" as const, text: t.text }] : t.text
  }));
  try {
    const res = await claude.messages.parse(
      {
        model: CLAUDE_MODEL, max_tokens: Math.max(r.maxTokens ?? 16000, 4000), thinking: { type: "adaptive" },
        output_config: { effort: r.quality === "best" ? "high" : "medium", format: zodOutputFormat(r.schema as never) },
        system: r.system, messages, fallbacks: "default"
      } as never,
      { headers: { "anthropic-beta": "server-side-fallback-2026-07-01" } }
    ) as unknown as { stop_reason: string; parsed_output: unknown; usage?: { input_tokens?: number; output_tokens?: number } };
    if (res.stop_reason === "refusal") throw new AiDeclined("The AI would not write this. Try wording it differently.");
    if (res.stop_reason === "max_tokens") throw new AiUnavailable("That was too much to write in one go. Ask for less and try again.", 422);
    return { raw: { text: "", model: CLAUDE_MODEL, inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 }, parsed: res.parsed_output };
  } catch (e) {
    if (e instanceof AiDeclined || e instanceof AiUnavailable) throw e;
    if (e instanceof Anthropic.RateLimitError) throw new AiUnavailable("The AI is busy right now. Try again in a minute.", 429);
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiUnavailable("The site's AI key was refused. Ask your Synergy Swift administrator to check it.");
    if (e instanceof Anthropic.APIError) throw new AiUnavailable("The AI did not finish. Please try again.", 502);
    throw e;
  }
}

// ---------------- the one call ----------------

/** Pulls the JSON object out of a reply, even if it came wrapped in a code fence. */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* fall through */ } }
  return undefined;
}

/** Asks the AI for JSON matching `schema`. Throws AiUnavailable / AiDeclined for things to tell the person. */
export async function generateJson<S extends z.ZodType>(r: JsonRequest<S>): Promise<z.infer<S>> {
  const provider = aiProvider();
  if (!provider) throw new AiUnavailable("AI isn't set up on this site yet. Ask your Synergy Swift administrator to add a Gemini API key.");
  const req = currentRequest();
  const tenantId = r.tenantId !== undefined ? r.tenantId : req.tenantId;
  const userId = r.userId !== undefined ? r.userId : req.userId;
  await checkAllowance(tenantId, userId, r.task);
  const log = (model: string, inTok: number, outTok: number, ok: boolean) =>
    recordUsage({ tenantId, userId: r.userId !== undefined ? r.userId : req.userId, task: r.task, provider, model, inputTokens: inTok, outputTokens: outTok, ok });

  if (provider === "anthropic") {
    try {
      const { raw, parsed } = await callClaude(r);
      const ok = r.schema.safeParse(parsed);
      await log(raw.model, raw.inputTokens, raw.outputTokens, ok.success);
      if (!ok.success) throw new AiUnavailable("The AI's answer came back in an unexpected form. Try again.", 502);
      return ok.data;
    } catch (e) { if (!(e instanceof AiUnavailable)) await log(CLAUDE_MODEL, 0, 0, false); throw e; }
  }

  let strict = true, inTok = 0, outTok = 0, model = geminiModel(r.quality);
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: Raw;
    try { raw = await callGemini(r, strict); }
    catch (e) {
      if (e instanceof SchemaRejected) { strict = false; attempt--; continue; }
      await log(model, inTok, outTok, false);
      throw e;
    }
    inTok += raw.inputTokens; outTok += raw.outputTokens; model = raw.model;
    const ok = r.schema.safeParse(extractJson(raw.text));
    if (ok.success) { await log(model, inTok, outTok, true); return ok.data; }
  }
  await log(model, inTok, outTok, false);
  throw new AiUnavailable("The AI's answer came back in an unexpected form. Try again.", 502);
}

/** Maps AI errors to a message and HTTP status for API routes. */
export function aiErrorMessage(e: unknown): { message: string; status: number } {
  if (e instanceof AiDeclined) return { message: e.message, status: 422 };
  if (e instanceof AiUnavailable) return { message: e.message, status: e.status };
  return { message: (e as Error)?.message ?? "Something went wrong.", status: 400 };
}

/** Test hook: forget cached allowances. */
export function resetAiAllowanceCache() { seen.clear(); mine.clear(); }
