import "server-only";
import { createHash, createHmac, createCipheriv, randomBytes } from "node:crypto";
import { toPublicQuestion, type Question } from "./engine";

/**
 * Server side of the shared exam paper (see paper.ts): the per-exam key and the encrypted file.
 *
 * The key is derived from a server secret and the exam id, so every server instance agrees on it
 * without storing anything. It is given to a student only when they start the exam (or reload an
 * exam in progress): before that, the downloaded file cannot be read.
 */
function secret(): string {
  const s = process.env.EXAM_PAPER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CRON_SECRET;
  if (!s) throw new Error("no server secret for exam papers");
  return s;
}

export function paperKey(examId: string): Buffer {
  return createHmac("sha256", secret()).update(`exam-paper:v1:${examId}`).digest();
}

type Built = { version: string; file: Buffer; key: string; at: number };
const built = new Map<string, Built>();

/**
 * The encrypted paper for an exam's current questions. The version changes whenever a question (or the
 * key) changes, so a device holding an old copy fetches the new one. Kept in memory: one build per change.
 */
export function buildPaper(examId: string, questions: Question[]): Built {
  const key = paperKey(examId);
  const json = JSON.stringify(questions.map(q => toPublicQuestion(q)));
  const version = createHash("sha256").update(json).update(createHash("sha256").update(key).digest()).digest("hex").slice(0, 16);
  const id = `${examId}:${version}`;
  const hit = built.get(id);
  if (hit) return hit;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const file = Buffer.concat([iv, c.update(json, "utf8"), c.final(), c.getAuthTag()]);
  const b: Built = { version, file, key: key.toString("base64"), at: Date.now() };
  built.set(id, b);
  if (built.size > 200) { const oldest = [...built.entries()].sort((x, y) => x[1].at - y[1].at)[0]; if (oldest) built.delete(oldest[0]); }
  return b;
}

export const paperUrl = (examId: string, version: string) => `/exam-paper/${examId}/${version}.bin`;
