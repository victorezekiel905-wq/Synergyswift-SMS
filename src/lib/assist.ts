/**
 * Drafting and translation service for staff (lesson notes, report
 * comments, notices) and families (translated messages).
 *
 * Output is schema-validated JSON, so the app never has to scrape free text.
 * Staff always review a draft before anything is saved or published; drafted
 * lesson notes are flagged `drafted` and go through the normal approval flow.
 * Product copy never describes how drafts are produced.
 *
 * Runs on Gemini through src/lib/ai.ts (GEMINI_API_KEY). When no AI key is
 * set the drafting buttons are hidden and messages are sent untranslated.
 */
import { z } from "zod/v4";
import { languageName } from "./languages";
import { generateJson, aiConfigured, aiErrorMessage, AiDeclined } from "./ai";

export const assistConfigured = aiConfigured;

/** Kept for older callers: a draft the AI would not write. */
export class DraftDeclined extends AiDeclined {}

const AS_SCHOOL = " Write as the school or the teacher would. Never mention how the text was produced, and never refer to yourself, to software, to assistants or to automation.";

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
  return generateJson({
    task: "lesson_note", schema: LessonNoteSchema, quality: "best", temperature: 0.6,
    system:
      "You write lesson notes for school teachers. Notes must be accurate, age-appropriate, practical for a real classroom with limited resources, " +
      "and aligned with the stated curriculum. Use clear, simple English. Include concrete examples relevant to the students' country and daily life." + AS_SCHOOL,
    prompt: [
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
  });
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

// ---------------- report-card comments ----------------

const CommentsSchema = z.object({
  comments: z.array(z.object({ student_id: z.string(), comment: z.string() }))
});

export type CommentInput = {
  student_id: string; first_name: string; average: number | null; position: number | null; class_size: number;
  strongest: string[]; weakest: string[]; attendance_rate: number | null; trend: "up" | "down" | "steady" | "new";
  /** For he/she; null writes the name or "they". */
  gender?: "male" | "female" | null;
  previous_average?: number | null;
  /** Subjects that rose or fell most since last term, e.g. "Mathematics +12". */
  movers?: string[];
  /** Character and skills ratings, e.g. "Punctuality 5/5". */
  traits?: string[];
  /** Teachers' effort grades and subject remarks, short. */
  effort?: string[];
  /** The form teacher's comment, when drafting the principal's (so the two don't repeat). */
  teacher_comment?: string | null;
};

export type CommentStyle = { tone?: "warm" | "formal" | "encouraging" | "firm"; length?: "short" | "medium"; signoff?: boolean };

const TONES: Record<NonNullable<CommentStyle["tone"]>, string> = {
  warm: "warm and caring, like a teacher who knows the child well",
  formal: "formal and measured, in the register of a traditional school report",
  encouraging: "upbeat and encouraging, celebrating effort and growth",
  firm: "honest and firm about what must change, while still respectful and hopeful"
};

/** Words and phrases that make report comments sound generic; the prompt bans them. */
export const STOCK_PHRASES = ["keep it up", "keep up the good work", "room for improvement", "can do better", "a pleasure to have",
  "good result", "fair result", "work harder", "more effort is needed", "excellent performance", "impressive"];

/** The system prompt for one batch of comments (exported for tests). */
export function commentSystem(role: "form_teacher" | "principal", style: CommentStyle = {}): string {
  const len = style.length === "medium" ? "two or three sentences (40–70 words)" : "one or two sentences (20–45 words)";
  return [
    `You write the ${role === "principal" ? "principal's" : "form teacher's"} comment on school report cards in Nigeria (British spelling).`,
    `Each comment is ${len}, ${TONES[style.tone ?? "warm"]}, and sounds like a real, experienced teacher wrote it about this one child.`,
    "Make every comment personal and specific: name at least one real subject from the data (a strength, a subject that improved, or one to work on),",
    "reflect the trend since last term when it is given, and mention attendance or conduct only when the data shows something worth saying.",
    "End with one clear, practical next step for the term ahead (what to do, not just \"work harder\").",
    "Use the student's first name once at most; use he/she from the gender given, or the name when no gender is given.",
    "Vary how comments open and how they are built so no two in the batch read alike. Never start two comments with the same word.",
    `Avoid stock phrases such as: ${STOCK_PHRASES.map(s => `"${s}"`).join(", ")}.`,
    "Never mention other students, class rankings of others, scores that are not in the data, or anything about family, health or behaviour that the data does not show.",
    "Do not invent facts. If the data is thin, keep the comment short and general but still kind and useful.",
    role === "principal"
      ? "The principal's comment is shorter and more decisive than the form teacher's, adds a different angle (overall standing, promotion readiness, a word to parents), and never repeats the form teacher's wording."
      : "",
    AS_SCHOOL.trim()
  ].filter(Boolean).join(" ");
}

/**
 * Report-card comments for a batch of students in one call. Only first names,
 * gender (for pronouns) and results are sent: no surnames, contact details or
 * other personal data.
 */
export async function generateReportComments(p: { role: "form_teacher" | "principal"; termLabel: string; passMark: number; students: CommentInput[]; style?: CommentStyle }) {
  if (!p.students.length) return new Map<string, string>();
  const res = await generateJson({
    task: "report_comments", schema: CommentsSchema, temperature: 0.9, maxTokens: 12000,
    system: commentSystem(p.role, p.style),
    prompt: `Term: ${p.termLabel}. Pass mark: ${p.passMark}%.\nStudents (JSON):\n${JSON.stringify(p.students)}\nReturn exactly one comment per student_id.`
  });
  const out = new Map<string, string>();
  const valid = new Set(p.students.map(s => s.student_id));
  for (const c of res.comments) if (valid.has(c.student_id) && c.comment.trim()) out.set(c.student_id, c.comment.trim().slice(0, 600));
  return out;
}

// ---------------- translation and notices ----------------

const TranslationSchema = z.object({ translations: z.array(z.string()) });

/**
 * Translates school messages into a parent's home language (and parents'
 * replies back). Names, dates, amounts, codes and links are kept exactly.
 * Returns the inputs unchanged when the output does not line up.
 */
export async function translateTexts(p: { texts: string[]; target: string; source?: string | null }): Promise<string[]> {
  if (!p.texts.length) return [];
  try {
    const res = await generateJson({
      task: "translate", schema: TranslationSchema, temperature: 0.2, maxTokens: 8000,
      system:
        "You translate messages between a school and families. Translate faithfully and naturally, keeping the tone polite and warm. " +
        "Keep names, dates, times, amounts, codes, numbers and links exactly as written. Do not add or leave out anything. " +
        "Return one translation per input, in the same order. Output only the translations, with no notes about them.",
      prompt: `Translate from ${p.source ? languageName(p.source) : "the source language"} into ${languageName(p.target)}.\nInputs (JSON array):\n${JSON.stringify(p.texts)}`
    });
    if (res.translations.length !== p.texts.length) return p.texts;
    return res.translations.map((t, i) => t.trim() || p.texts[i]);
  } catch (e) {
    if (e instanceof AiDeclined) return p.texts;
    throw e;
  }
}

const NoticeSchema = z.object({ title: z.string(), body: z.string() });

/** Drafts a notice to parents from a short instruction. The sender edits it before sending. */
export async function draftNotice(p: { instruction: string; schoolName: string; tone?: "friendly" | "formal" | "urgent" }) {
  const res = await generateJson({
    task: "notice", schema: NoticeSchema, temperature: 0.6, maxTokens: 4000,
    system:
      `You write notices from ${p.schoolName} to parents. Use plain, ${p.tone ?? "friendly"} English that reads well on a phone. ` +
      "Keep it under 150 words, lead with what parents need to know or do, and include any date, time, place or cost given. " +
      "Never invent facts that were not given; leave a clear [placeholder] instead. The title is at most 8 words." + AS_SCHOOL,
    prompt: p.instruction
  });
  return { title: res.title.slice(0, 120), body: res.body.slice(0, 3000) };
}

/** Maps service errors to messages staff can act on. */
export function assistErrorMessage(e: unknown): { message: string; status: number } {
  return aiErrorMessage(e);
}

// ---------------- learning (phase 6) ----------------

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
  const out = await generateJson({
    task: "homework_feedback", schema: FeedbackSchema, temperature: 0.5,
    system:
      "You help teachers write feedback on school homework. Feedback speaks directly to the student in two to four short, kind, specific sentences, " +
      "says what was done well, and gives one or two clear next steps. Judge only what is in the answer. " +
      "Suggest a score only when a maximum is given and the task makes the standard clear; otherwise return null. " +
      "Use note_for_teacher for anything the teacher should check (for example, an answer that does not address the task)." +
      " Write as the teacher would. Never mention how the text was produced, and never refer to yourself, to software, to assistants or to automation.",
    prompt: [
      p.subject ? `Subject: ${p.subject}` : "",
      p.level ? `Class: ${p.level}` : "",
      `Task:\n${p.task.slice(0, 8000)}`,
      p.maxScore != null ? `Maximum score: ${p.maxScore}` : "No score is given for this task.",
      p.teacherNotes ? `Teacher's marking notes: ${p.teacherNotes.slice(0, 2000)}` : "",
      `Student's answer:\n${p.answer.slice(0, 30000)}`
    ].filter(Boolean).join("\n\n")
  });
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
  const res = await generateJson({
    task: "quiz", schema: QuizSchema, quality: "best", temperature: 0.6,
    system:
      "You write school quiz questions for teachers to review. Every question must have exactly one defensible correct answer, be answerable from what the class is expected to know, " +
      "and suit the stated class level and curriculum. Vary what is tested and avoid giving answers away in the wording. Use plain text: write maths as you would type it (x^2, 3/4, sqrt(2)). " +
      "For mcq_single give four options and the 0-based index of the correct one; for true_false set correct_true; for short_answer list every acceptable answer (short words or phrases); " +
      "for numeric give the number, a sensible tolerance and the unit (or null). Leave the fields a type does not use as empty lists or null. " +
      "Each explanation says in one or two sentences why the answer is right, for a student who got it wrong. When objectives are given, set objective to the one the question tests.",
    prompt: [
      `Subject: ${p.subject}`, `Class level: ${p.level}`, `Topic: ${p.topic}`,
      p.curriculum ? `Curriculum: ${p.curriculum}` : "", p.country ? `Country: ${p.country}` : "",
      `Write ${Math.min(20, Math.max(1, p.count))} questions. Allowed types: ${p.types.join(", ")}. Difficulty: ${p.difficulty === "mixed" ? "a mix of easy, medium and hard" : p.difficulty}.`,
      p.objectives?.length ? `Curriculum objectives to cover:\n${p.objectives.map(o => `- ${o}`).join("\n")}` : "",
      p.source ? `Base the questions on these lesson notes:\n${p.source.slice(0, 30000)}` : ""
    ].filter(Boolean).join("\n\n")
  });
  return res.questions.filter(q => p.types.includes(q.type));
}

// ---------------- study tutor ----------------

const TutorSchema = z.object({ reply: z.string(), concern: z.enum(["none", "wellbeing", "safety"]), title: z.string() });
export type TutorTurn = { role: "student" | "tutor"; content: string };

/**
 * One reply from the study tutor. Students are told they are talking to an AI
 * study helper and that their teachers and parents can read the chat.
 */
export async function tutorReply(p: { level: string | null; subject: string | null; schoolName: string; context?: { kind: string; title: string; text: string } | null; history: TutorTurn[] }) {
  // Turns alternate, starting with the student.
  const turns: { role: "user" | "model"; text: string }[] = [];
  for (const t of p.history.slice(-24)) {
    const role = t.role === "student" ? "user" : "model";
    if (!turns.length && role === "model") continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.text += `\n\n${t.content}`;
    else turns.push({ role, text: t.content.slice(0, 8000) });
  }
  try {
    return await generateJson({
      task: "tutor", schema: TutorSchema, temperature: 0.6, maxTokens: 4000, turns,
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
        (p.context ? `\n\nThe student opened this chat from their ${p.context.kind} "${p.context.title}":\n${p.context.text.slice(0, 6000)}` : "")
    });
  } catch (e) {
    // A blocked message may be a child saying something worrying: flag it for staff rather than drop it.
    if (e instanceof AiDeclined) return { reply: "I can't help with that one here. If something is worrying you, please talk to a trusted adult or your school counsellor today. Otherwise, let's get back to your school work.", concern: "wellbeing" as const, title: "" };
    throw e;
  }
}
