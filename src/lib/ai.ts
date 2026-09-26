/**
 * AI assistance for teachers, powered by Claude.
 *
 *  - Lesson notes aligned to the school's curriculum (e.g. NERDC in Nigeria)
 *  - Report-card comments written from each student's actual results
 *
 * Output is schema-validated JSON (structured outputs), so the app never has
 * to scrape free text. Teachers always review before anything is saved or
 * published: AI drafts are marked `ai_generated` and go through the normal
 * approval flow.
 *
 * Requires ANTHROPIC_API_KEY on the server. When it is missing, callers get a
 * clear "not configured" error instead of a silent failure.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { languageName } from "./languages";

export const AI_MODEL = "claude-opus-5";

export function aiConfigured(): boolean {
  const k = process.env.ANTHROPIC_API_KEY;
  return Boolean(k && !k.includes("replace"));
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!aiConfigured()) throw new Error("AI assistance is not configured on this server (ANTHROPIC_API_KEY)");
  client ??= new Anthropic();
  return client;
}

// Server-side refusal fallback: if a request is declined by a safety
// classifier, the API re-runs it on Anthropic's recommended fallback model.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class AiRefusal extends Error {}

const LessonNoteSchema = z.object({
  topic: z.string(),
  duration_minutes: z.number(),
  objectives: z.array(z.string()),
  prior_knowledge: z.string(),
  materials: z.array(z.string()),
  introduction: z.string(),
  steps: z.array(z.object({ title: z.string(), teacher_activity: z.string(), student_activity: z.string(), minutes: z.number() })),
  evaluation_questions: z.array(z.string()),
  assignment: z.string(),
  differentiation: z.string(),
  summary: z.string()
});
export type LessonNote = z.infer<typeof LessonNoteSchema>;

export async function generateLessonNote(p: {
  subject: string; level: string; topic: string; week?: number | null; durationMinutes?: number | null;
  curriculum?: string | null; notes?: string | null; country?: string | null;
}): Promise<LessonNote> {
  const response = await anthropic().messages.parse(
    {
      model: AI_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: zodOutputFormat(LessonNoteSchema) },
      system:
        "You write lesson notes for school teachers. Notes must be accurate, age-appropriate, practical for a real classroom with limited resources, " +
        "and aligned with the stated curriculum. Use clear, simple English. Include concrete examples relevant to the students' country and daily life.",
      messages: [{
        role: "user",
        content: [
          `Subject: ${p.subject}`,
          `Class / level: ${p.level}`,
          `Topic: ${p.topic}`,
          p.week ? `Week of term: ${p.week}` : "",
          `Lesson length: ${p.durationMinutes ?? 40} minutes`,
          `Curriculum: ${p.curriculum ?? "the national curriculum"}`,
          p.country ? `Country: ${p.country}` : "",
          p.notes ? `Teacher's notes: ${p.notes}` : "",
          "Write the complete lesson note. Step minutes should add up to the lesson length."
        ].filter(Boolean).join("\n")
      }],
      fallbacks: "default"
    },
    { headers: { "anthropic-beta": FALLBACK_BETA } }
  );
  if (response.stop_reason === "refusal") throw new AiRefusal("The AI declined to write this lesson note. Please rephrase the topic.");
  if (!response.parsed_output) throw new Error("The AI response could not be read; please try again.");
  return response.parsed_output;
}

/** Plain-text rendering of a generated note for the lesson-note editor. */
export function lessonNoteToText(n: LessonNote): string {
  const list = (xs: string[]) => xs.map(x => `- ${x}`).join("\n");
  return [
    `TOPIC: ${n.topic}`, `DURATION: ${n.duration_minutes} minutes`, "",
    "OBJECTIVES\nBy the end of the lesson, students should be able to:", list(n.objectives), "",
    "PREVIOUS KNOWLEDGE", n.prior_knowledge, "",
    "INSTRUCTIONAL MATERIALS", list(n.materials), "",
    "INTRODUCTION", n.introduction, "",
    "PRESENTATION",
    n.steps.map((s, i) => `Step ${i + 1}: ${s.title} (${s.minutes} min)\nTeacher: ${s.teacher_activity}\nStudents: ${s.student_activity}`).join("\n\n"), "",
    "EVALUATION", n.evaluation_questions.map((q, i) => `${i + 1}. ${q}`).join("\n"), "",
    "SUPPORT AND EXTENSION", n.differentiation, "",
    "SUMMARY", n.summary, "",
    "ASSIGNMENT", n.assignment
  ].join("\n");
}

const CommentsSchema = z.object({
  comments: z.array(z.object({ student_id: z.string(), comment: z.string() }))
});

export type CommentInput = {
  student_id: string; first_name: string; average: number | null; position: number | null; class_size: number;
  strongest: string[]; weakest: string[]; attendance_rate: number | null; trend: "up" | "down" | "steady" | "new";
};

/**
 * Report-card comments for a whole class in one call. Only first names and
 * results are sent: no surnames, contact details or other personal data.
 */
export async function generateReportComments(p: { role: "form_teacher" | "principal"; termLabel: string; passMark: number; students: CommentInput[] }) {
  if (!p.students.length) return new Map<string, string>();
  const response = await anthropic().messages.parse(
    {
      model: AI_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: zodOutputFormat(CommentsSchema) },
      system:
        `You write ${p.role === "principal" ? "principal's" : "form teacher's"} comments for school report cards. Each comment is one or two sentences, ` +
        "specific to the student's results, warm and honest, and ends with one clear next step. Never mention other students, rankings of others, or anything not in the data. " +
        "Do not repeat the same sentence across students.",
      messages: [{
        role: "user",
        content: `Term: ${p.termLabel}. Pass mark: ${p.passMark}%.\nStudents (JSON):\n${JSON.stringify(p.students)}\nReturn one comment per student_id.`
      }],
      fallbacks: "default"
    },
    { headers: { "anthropic-beta": FALLBACK_BETA } }
  );
  if (response.stop_reason === "refusal") throw new AiRefusal("The AI declined to write these comments.");
  const out = new Map<string, string>();
  const valid = new Set(p.students.map(s => s.student_id));
  for (const c of response.parsed_output?.comments ?? []) if (valid.has(c.student_id)) out.set(c.student_id, c.comment.trim().slice(0, 600));
  return out;
}

const TranslationSchema = z.object({ translations: z.array(z.string()) });

/**
 * Translates school messages into a parent's home language (and parents'
 * replies back). Names, dates, amounts, codes and links are kept exactly.
 * Returns the inputs unchanged when the output does not line up.
 */
export async function translateTexts(p: { texts: string[]; target: string; source?: string | null }): Promise<string[]> {
  if (!p.texts.length) return [];
  const response = await anthropic().messages.parse(
    {
      model: AI_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: zodOutputFormat(TranslationSchema) },
      system:
        "You translate messages between a school and families. Translate faithfully and naturally, keeping the tone polite and warm. " +
        "Keep names, dates, times, amounts, codes, numbers and links exactly as written. Do not add or leave out anything. " +
        "Return one translation per input, in the same order.",
      messages: [{
        role: "user",
        content: `Translate from ${p.source ? languageName(p.source) : "the source language"} into ${languageName(p.target)}.\nInputs (JSON array):\n${JSON.stringify(p.texts)}`
      }],
      fallbacks: "default"
    },
    { headers: { "anthropic-beta": FALLBACK_BETA } }
  );
  const out = response.parsed_output?.translations;
  if (response.stop_reason === "refusal" || !out || out.length !== p.texts.length) return p.texts;
  return out.map((t, i) => t.trim() || p.texts[i]);
}

const NoticeSchema = z.object({ title: z.string(), body: z.string() });

/** Drafts a notice to parents from a short instruction. The sender edits it before sending. */
export async function draftNotice(p: { instruction: string; schoolName: string; tone?: "friendly" | "formal" | "urgent" }) {
  const response = await anthropic().messages.parse(
    {
      model: AI_MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: zodOutputFormat(NoticeSchema) },
      system:
        `You write notices from ${p.schoolName} to parents. Use plain, ${p.tone ?? "friendly"} English that reads well on a phone. ` +
        "Keep it under 150 words, lead with what parents need to know or do, and include any date, time, place or cost given. " +
        "Never invent facts that were not given; leave a clear [placeholder] instead. The title is at most 8 words.",
      messages: [{ role: "user", content: p.instruction }],
      fallbacks: "default"
    },
    { headers: { "anthropic-beta": FALLBACK_BETA } }
  );
  if (response.stop_reason === "refusal") throw new AiRefusal("The AI declined to draft this notice.");
  if (!response.parsed_output) throw new Error("The AI response could not be read; please try again.");
  return { title: response.parsed_output.title.slice(0, 120), body: response.parsed_output.body.slice(0, 3000) };
}

/** Maps SDK errors to messages a teacher can act on. */
export function aiErrorMessage(e: unknown): { message: string; status: number } {
  if (e instanceof AiRefusal) return { message: e.message, status: 422 };
  if (e instanceof Anthropic.RateLimitError) return { message: "The AI service is busy. Please try again in a minute.", status: 429 };
  if (e instanceof Anthropic.AuthenticationError) return { message: "AI assistance is misconfigured on the server.", status: 503 };
  if (e instanceof Anthropic.APIError) return { message: `AI service error (${e.status ?? "network"}). Please try again.`, status: 502 };
  return { message: (e as Error).message, status: 400 };
}
