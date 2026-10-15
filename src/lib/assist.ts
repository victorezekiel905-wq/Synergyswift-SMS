/**
 * Drafting and translation service for staff (lesson notes, report
 * comments, notices) and families (translated messages).
 *
 * Output is schema-validated JSON, so the app never has to scrape free text.
 * Staff always review a draft before anything is saved or published; drafted
 * lesson notes are flagged `drafted` and go through the normal approval flow.
 * Product copy never describes how drafts are produced.
 *
 * Requires ANTHROPIC_API_KEY on the server. When it is missing the drafting
 * buttons are hidden and messages are sent untranslated.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { languageName } from "./languages";

export const AI_MODEL = "claude-opus-5-5";

export function assistConfigured(): boolean {
  const k = process.env.ANTHROPIC_API_KEY;
  return Boolean(k && !k.includes("replace"));
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!assistConfigured()) throw new Error("Drafting is not available on this server.");
  client ??= new Anthropic();
  return client;
}

// Server-side refusal fallback: if a request is declined by a safety
// classifier, the API re-runs it on Anthropic's recommended fallback model.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class DraftDeclined extends Error {}

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
      output_config: { effort: "medium", format: zodOutputFormat(LessonNoteSchema) },
      system:
        "You write lesson notes for school teachers. Notes must be accurate, age-appropriate, practical for a real classroom with limited resources, " +
        "and aligned with the stated curriculum. Use clear, simple English. Include concrete examples relevant to the students' country and daily life." +
        " Write as the school or the teacher would. Never mention how the text was produced, and never refer to yourself, to software, to assistants or to automation.",
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
  if (response.stop_reason === "refusal") throw new DraftDeclined("This lesson note could not be drafted. Please rephrase the topic.");
  if (!response.parsed_output) throw new Error("The draft could not be completed. Please try again.");
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
        "Do not repeat the same sentence across students." +
        " Write as the school or the teacher would. Never mention how the text was produced, and never refer to yourself, to software, to assistants or to automation.",
      messages: [{
        role: "user",
        content: `Term: ${p.termLabel}. Pass mark: ${p.passMark}%.\nStudents (JSON):\n${JSON.stringify(p.students)}\nReturn one comment per student_id.`
      }],
      fallbacks: "default"
    },
    { headers: { "anthropic-beta": FALLBACK_BETA } }
  );
  if (response.stop_reason === "refusal") throw new DraftDeclined("These comments could not be drafted. Please write them by hand.");
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
        "Return one translation per input, in the same order. Output only the translations, with no notes about them.",
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
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: zodOutputFormat(NoticeSchema) },
      system:
        `You write notices from ${p.schoolName} to parents. Use plain, ${p.tone ?? "friendly"} English that reads well on a phone. ` +
        "Keep it under 150 words, lead with what parents need to know or do, and include any date, time, place or cost given. " +
        "Never invent facts that were not given; leave a clear [placeholder] instead. The title is at most 8 words." +
        " Write as the school or the teacher would. Never mention how the text was produced, and never refer to yourself, to software, to assistants or to automation.",
      messages: [{ role: "user", content: p.instruction }],
      fallbacks: "default"
    },
    { headers: { "anthropic-beta": FALLBACK_BETA } }
  );
  if (response.stop_reason === "refusal") throw new DraftDeclined("This notice could not be drafted. Please rephrase it.");
  if (!response.parsed_output) throw new Error("The draft could not be completed. Please try again.");
  return { title: response.parsed_output.title.slice(0, 120), body: response.parsed_output.body.slice(0, 3000) };
}

/** Maps service errors to messages staff can act on. */
export function assistErrorMessage(e: unknown): { message: string; status: number } {
  if (e instanceof DraftDeclined) return { message: e.message, status: 422 };
  if (e instanceof Anthropic.RateLimitError) return { message: "Drafting is busy. Please try again in a minute.", status: 429 };
  if (e instanceof Anthropic.AuthenticationError) return { message: "Drafting is not available right now. Please contact your administrator.", status: 503 };
  if (e instanceof Anthropic.APIError) return { message: "Drafting did not finish. Please try again.", status: 502 };
  return { message: (e as Error).message, status: 400 };
}

// ---------------- learning (phase 6) ----------------

/** Feedback drafts, quizzes and the study helper use the same model as the rest. */
export const LEARNING_MODEL = AI_MODEL;

const FeedbackSchema = z.object({
  feedback: z.string(),
  strengths: z.array(z.string()),
  next_steps: z.array(z.string()),
  suggested_score: z.number().nullable(),
  note_for_teacher: z.string()
});
export type FeedbackDraft = z.infer<typeof FeedbackSchema>;

/**
 * A draft of feedback on one student's homework for the teacher to edit. Only
 * the task and the answer are sent: no name or other personal details.
 */
export async function draftFeedback(p: { subject: string | null; level: string | null; task: string; answer: string; maxScore: number | null; teacherNotes?: string | null }): Promise<FeedbackDraft> {
  const response = await anthropic().messages.parse(
    {
      model: LEARNING_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: zodOutputFormat(FeedbackSchema) },
      system:
        "You help teachers write feedback on school homework. Feedback speaks directly to the student in two to four short, kind, specific sentences, " +
        "says what was done well, and gives one or two clear next steps. Judge only what is in the answer. " +
        "Suggest a score only when a maximum is given and the task makes the standard clear; otherwise return null. " +
        "Use note_for_teacher for anything the teacher should check (for example, an answer that does not address the task)." +
        " Write as the teacher would. Never mention how the text was produced, and never refer to yourself, to software, to assistants or to automation.",
      messages: [{
        role: "user",
        content: [
          p.subject ? `Subject: ${p.subject}` : "",
          p.level ? `Class: ${p.level}` : "",
          `Task:\n${p.task.slice(0, 8000)}`,
          p.maxScore != null ? `Maximum score: ${p.maxScore}` : "No score is given for this task.",
          p.teacherNotes ? `Teacher's marking notes: ${p.teacherNotes.slice(0, 2000)}` : "",
          `Student's answer:\n${p.answer.slice(0, 30000)}`
        ].filter(Boolean).join("\n\n")
      }],
      fallbacks: "default"
    },
    { headers: { "anthropic-beta": FALLBACK_BETA } }
  );
  if (response.stop_reason === "refusal") throw new DraftDeclined("Feedback for this answer could not be drafted. Please write it yourself.");
  if (!response.parsed_output) throw new Error("The draft could not be completed. Please try again.");
  const out = response.parsed_output;
  const cap = p.maxScore ?? null;
  return { ...out, suggested_score: cap === null || out.suggested_score === null ? null : Math.max(0, Math.min(cap, out.suggested_score)) };
}

// ---------------- quiz generation ----------------

const QuizSchema = z.object({
  questions: z.array(z.object({
    type: z.enum(["mcq_single", "true_false", "short_answer", "numeric"]),
    prompt: z.string(),
    options: z.array(z.string()),
    correct_option: z.number().nullable(),
    correct_true: z.boolean().nullable(),
    accepted_answers: z.array(z.string()),
    numeric_answer: z.number().nullable(),
    tolerance: z.number().nullable(),
    unit: z.string().nullable(),
    explanation: z.string(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    bloom: z.enum(["remember", "understand", "apply", "analyse", "evaluate", "create"]),
    objective: z.string().nullable()
  }))
});
export type GeneratedQuestion = z.infer<typeof QuizSchema>["questions"][number];

/**
 * Practice or quiz questions on a topic for a teacher to review before saving
 * to the question bank. Objectives and source notes are optional.
 */
export async function generateQuiz(p: { subject: string; level: string; topic: string; count: number; types: string[]; difficulty: "mixed" | "easy" | "medium" | "hard";
  objectives?: string[]; source?: string | null; curriculum?: string | null; country?: string | null }): Promise<GeneratedQuestion[]> {
  const response = await anthropic().messages.parse(
    {
      model: LEARNING_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: zodOutputFormat(QuizSchema) },
      system:
        "You write school quiz questions for teachers to review. Every question must have exactly one defensible correct answer, be answerable from what the class is expected to know, " +
        "and suit the stated class level and curriculum. Vary what is tested and avoid giving answers away in the wording. Use plain text: write maths as you would type it (x^2, 3/4, sqrt(2)). " +
        "For mcq_single give four options and the 0-based index of the correct one; for true_false set correct_true; for short_answer list every acceptable answer (short words or phrases); " +
        "for numeric give the number, a sensible tolerance and the unit (or null). Leave the fields a type does not use as empty lists or null. " +
        "Each explanation says in one or two sentences why the answer is right, for a student who got it wrong. When objectives are given, set objective to the one the question tests.",
      messages: [{
        role: "user",
        content: [
          `Subject: ${p.subject}`, `Class level: ${p.level}`, `Topic: ${p.topic}`,
          p.curriculum ? `Curriculum: ${p.curriculum}` : "", p.country ? `Country: ${p.country}` : "",
          `Write ${Math.min(20, Math.max(1, p.count))} questions. Allowed types: ${p.types.join(", ")}. Difficulty: ${p.difficulty === "mixed" ? "a mix of easy, medium and hard" : p.difficulty}.`,
          p.objectives?.length ? `Curriculum objectives to cover:\n${p.objectives.map(o => `- ${o}`).join("\n")}` : "",
          p.source ? `Base the questions on these lesson notes:\n${p.source.slice(0, 30000)}` : ""
        ].filter(Boolean).join("\n\n")
      }],
      fallbacks: "default"
    },
    { headers: { "anthropic-beta": FALLBACK_BETA } }
  );
  if (response.stop_reason === "refusal") throw new DraftDeclined("Questions for this topic could not be drafted. Try rewording the topic.");
  if (!response.parsed_output) throw new Error("The questions could not be completed. Please try again.");
  return response.parsed_output.questions.filter(q => p.types.includes(q.type));
}

// ---------------- study tutor ----------------

const TutorSchema = z.object({ reply: z.string(), concern: z.enum(["none", "wellbeing", "safety"]), title: z.string() });
export type TutorTurn = { role: "student" | "tutor"; content: string };

/**
 * One reply from the study tutor. Students are told they are talking to an AI
 * study helper and that their teachers and parents can read the chat.
 */
export async function tutorReply(p: { level: string | null; subject: string | null; schoolName: string; context?: { kind: string; title: string; text: string } | null; history: TutorTurn[] }) {
  // The API needs turns to alternate, starting with the student.
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const t of p.history.slice(-24)) {
    const role = t.role === "student" ? "user" : "assistant";
    if (!turns.length && role === "assistant") continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n\n${t.content}`;
    else turns.push({ role, content: t.content.slice(0, 8000) });
  }
  const response = await anthropic().messages.parse(
    {
      model: LEARNING_MODEL,
      max_tokens: 6000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: zodOutputFormat(TutorSchema) },
      system:
        `You are the study helper for students at ${p.schoolName}${p.level ? `, talking with a student in ${p.level}` : ""}${p.subject ? ` about ${p.subject}` : ""}. ` +
        "The student knows you are an AI study helper and that their teachers and parents can read this chat. " +
        "Help them learn rather than doing the work for them: ask what they already know, give hints and the next step, explain ideas simply with short examples, and check understanding with a quick question. " +
        "When they are working on homework or a quiz, never give the final answers to those questions; work through a similar example instead. Once they have made a real attempt, you may confirm or correct it. " +
        "Keep replies short and friendly (usually under 150 words) and suited to their age. Write maths between $ signs (LaTeX) and code in fenced blocks. " +
        "Stay on school learning; kindly steer anything else back to their studies. Never ask for or encourage sharing personal details, photos or contact information, and never suggest meeting anyone. " +
        "If the student says they are being hurt, are in danger, are thinking about harming themselves, or someone is harming them, reply with warmth, tell them it matters, and urge them to talk to a trusted adult or the school counsellor today; set concern to \"safety\". " +
        "If they seem very upset, stressed, lonely or bullied, be kind, suggest talking to someone they trust at school, and set concern to \"wellbeing\". Otherwise set concern to \"none\". " +
        "Set title to a short name (two to six words) for what this conversation is about." +
        (p.context ? `\n\nThe student opened this chat from their ${p.context.kind} "${p.context.title}":\n${p.context.text.slice(0, 6000)}` : ""),
      messages: turns,
      fallbacks: "default"
    },
    { headers: { "anthropic-beta": FALLBACK_BETA } }
  );
  if (response.stop_reason === "refusal") {
    return { reply: "I can't help with that one. Let's get back to your school work, or talk to your teacher about it.", concern: "none" as const, title: "" };
  }
  if (!response.parsed_output) throw new Error("The study helper did not finish. Please try again.");
  return response.parsed_output;
}
