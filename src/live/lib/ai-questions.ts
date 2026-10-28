import "server-only";
import * as z from "zod/v4";
import { generateJson, aiConfigured as sharedConfigured, AiUnavailable as SharedUnavailable, AiDeclined } from "@/lib/ai";
import { toImported } from "./ai-question-shape";
import type { ImportedQuestion } from "./question-import";

/*
 * "Write with AI": the AI drafts questions from a topic, pasted notes or a PDF.
 * They come back in the importer's own shape (ImportedQuestion), so the teacher
 * sees them in the same editable preview as pasted questions and nothing is added
 * until they choose to. Needs GEMINI_API_KEY on the server (src/lib/ai.ts).
 */

export const AI_KINDS = ["mcq", "multi_select", "true_false", "short", "fill_blank"] as const;
type AiKind = (typeof AI_KINDS)[number];

const Question = z.object({
  kind: z.enum(AI_KINDS),
  prompt: z.string().describe("The question. For fill_blank, mark each blank with ___ (three underscores)."),
  options: z.array(z.object({ label: z.string(), is_correct: z.boolean() }))
    .describe("mcq: 4 options, one correct. multi_select: 4-5 options, two or more correct. true_false: exactly True and False. short and fill_blank: empty."),
  answers: z.array(z.string()).describe("fill_blank: the answer for each blank, in order. short: one model answer. Otherwise empty."),
  explanation: z.string().describe("One or two sentences a student reads after answering: why the right answer is right."),
  topic: z.string().describe("A short topic name for progress reports, e.g. \"Fractions\" or \"Photosynthesis\".")
});
const Output = z.object({ questions: z.array(Question) });

export type AiSource = { topic?: string; text?: string; pdfBase64?: string };
export type AiRequest = { source: AiSource; level: string; subject?: string; count: number; kinds: AiKind[]; tenantId?: string; userId?: string };

export class AiUnavailable extends Error {}

export const aiConfigured = sharedConfigured;

const SYSTEM = `You write classroom questions for Synergy Swift, a live lesson and quiz platform used in schools in Nigeria and elsewhere.

Write questions a good teacher would be glad to use:
- Correct, unambiguous and checkable. Exactly the stated number of correct options. No trick wording, no "all of the above" or "none of the above".
- Pitched at the class level given. Use clear, simple English; use local, everyday contexts (names, money in naira, places) where a context helps.
- Wrong options are plausible: each reflects a real misconception, not a joke.
- Vary what is tested: recall, understanding and application, roughly in that order of frequency.
- When source material is given, base every question on it and stay inside it. Never invent facts beyond it.
- Keep each question short enough to read on a phone in a few seconds.`;

/** Drafts questions. Throws AiUnavailable for anything the teacher should be told plainly. */
export async function draftQuestions(req: AiRequest): Promise<ImportedQuestion[]> {
  if (!aiConfigured()) throw new AiUnavailable("AI question writing isn't set up on this site yet. Ask your Synergy Swift administrator to add a Gemini API key.");
  const kinds = req.kinds.length ? req.kinds : (["mcq", "true_false"] as AiKind[]);
  const brief = [
    `Write ${req.count} questions for ${req.level}${req.subject ? `, ${req.subject}` : ""}.`,
    `Use only these question types: ${kinds.join(", ")}. Mix them if more than one is allowed; most should be ${kinds[0]}.`,
    req.source.topic ? `Topic: ${req.source.topic}` : "",
    req.source.text ? `Base the questions on these notes:\n<notes>\n${req.source.text}\n</notes>` : "",
    req.source.pdfBase64 ? "Base the questions on the attached document." : ""
  ].filter(Boolean).join("\n\n");
  let out: z.infer<typeof Output>;
  try {
    out = await generateJson({ task: "live_questions", schema: Output, system: SYSTEM, prompt: brief, quality: "best", temperature: 0.6, maxTokens: 16000,
      files: req.source.pdfBase64 ? [{ mimeType: "application/pdf", base64: req.source.pdfBase64 }] : [],
      tenantId: req.tenantId ?? null, userId: req.userId ?? null });
  } catch (e) {
    if (e instanceof AiDeclined) throw new AiUnavailable("The AI declined to write questions from this material. Try a different topic or text.");
    if (e instanceof SharedUnavailable) throw new AiUnavailable(e.message);
    throw e;
  }
  return out.questions.filter((q) => kinds.includes(q.kind)).slice(0, req.count).map(toImported).filter((q): q is ImportedQuestion => q !== null);
}
