import { describe, it, expect, vi, beforeAll } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { toPublicQuestion, buildAttemptLayout, type Question } from "@/lib/exams/engine";
import { applyLayout, decryptPaper, type PaperQuestion } from "@/lib/exams/paper";
import { buildPaper, paperUrl } from "@/lib/exams/paper-server";
import { cached } from "@/lib/exams/cache";

beforeAll(() => { process.env.EXAM_PAPER_SECRET = "test-secret"; });

const o = (...t: string[]) => t.map((text, i) => ({ id: `o${i}`, text }));
const questions: Question[] = [
  { id: "q1", type: "mcq_single", prompt: "Pick one", points: 1, data: { options: o("a", "b", "c", "d") }, answer: { correct: "o2" } },
  { id: "q2", type: "mcq_multi", prompt: "Pick some", points: 2, data: { options: o("a", "b", "c") }, answer: { correct: ["o0", "o2"] } },
  { id: "q3", type: "matching", prompt: "Match", points: 3, data: { left: o("x", "y"), right: o("1", "2", "3") }, answer: { pairs: { o0: "o1" } } },
  { id: "q4", type: "ordering", prompt: "Order", points: 2, data: { items: o("first", "second", "third") }, answer: { order: ["o0", "o1", "o2"] } },
  { id: "q5", type: "drag_drop", prompt: "Group", points: 2, data: { items: o("cat", "rose"), zones: [{ id: "z1", text: "Animal" }] }, answer: { placement: { o0: "z1" } } },
  { id: "q6", type: "label_image", prompt: "Label", points: 2, data: { image_url: "x.png", pins: [{ id: "p1", x: 1, y: 2 }], labels: o("eye", "ear") }, answer: { placement: { p1: "o0" } } },
  { id: "q7", type: "fill_blanks", prompt: "Fill", points: 1, data: { text: "Lagos is in [[Nigeria]]" }, answer: {} },
  { id: "q8", type: "essay", prompt: "Explain", points: 10, data: {}, answer: { rubric: "secret guide" } }
] as unknown as Question[];

describe("the shared exam paper", () => {
  it("a student's paper built on the device is exactly what the server would have sent", () => {
    const base = questions.map(q => toPublicQuestion(q)) as PaperQuestion[];
    for (let run = 0; run < 25; run++) {
      const layout = buildAttemptLayout(questions, { shuffleQuestions: true, shuffleOptions: true });
      const byId = new Map(questions.map(q => [q.id, q]));
      const server = layout.question_order.map(id => toPublicQuestion(byId.get(id)!, layout.option_orders[id]));
      expect(applyLayout(base, layout.question_order, layout.option_orders)).toEqual(server);
    }
  });
  it("never contains an answer or a marking guide", () => {
    const text = JSON.stringify(questions.map(q => toPublicQuestion(q)));
    expect(text).not.toMatch(/secret guide|"correct"|"pairs"|"placement"|Nigeria/);
  });
  it("is encrypted: it opens with the exam's key and not with another", async () => {
    const p = buildPaper("11111111-1111-1111-1111-111111111111", questions);
    const file = p.file.buffer.slice(p.file.byteOffset, p.file.byteOffset + p.file.byteLength) as ArrayBuffer;
    expect(new TextDecoder().decode(p.file)).not.toMatch(/Pick one/);
    const opened = await decryptPaper(file, p.key);
    expect(opened.map(q => q.id)).toEqual(questions.map(q => q.id));
    const other = buildPaper("22222222-2222-2222-2222-222222222222", questions);
    await expect(decryptPaper(file, other.key)).rejects.toThrow();
  });
  it("gets a new version (and address) when a question changes, and is built once per version", () => {
    const id = "33333333-3333-3333-3333-333333333333";
    const a = buildPaper(id, questions), again = buildPaper(id, questions);
    expect(again).toBe(a);
    const changed = buildPaper(id, questions.map(q => (q.id === "q1" ? { ...q, prompt: "Pick one (corrected)" } : q)) as Question[]);
    expect(changed.version).not.toBe(a.version);
    expect(paperUrl(id, a.version)).toMatch(/^\/exam-paper\/[0-9a-f-]{36}\/[0-9a-f]{16}\.bin$/);
  });
});

describe("the server asks once for a whole hall", () => {
  it("500 requests at the same moment share one lookup", async () => {
    let calls = 0;
    const load = async () => { calls++; await new Promise(r => setTimeout(r, 20)); return { id: "exam" }; };
    const all = await Promise.all(Array.from({ length: 500 }, () => cached("test:hall", 10_000, load)));
    expect(calls).toBe(1);
    expect(all.every(x => x.id === "exam")).toBe(true);
  });
  it("a failed lookup is not remembered", async () => {
    let n = 0;
    await expect(cached("test:fail", 10_000, async () => { n++; throw new Error("db down"); })).rejects.toThrow();
    await new Promise(r => setTimeout(r, 0));
    await cached("test:fail", 10_000, async () => { n++; return 1; });
    expect(n).toBe(2);
  });
});

describe("wiring", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  it("the paper address is kept out of the middleware, so Cloudflare can cache it", () => {
    expect(read("src/middleware.ts")).toMatch(/exam-paper\//);
    expect(read("src/app/exam-paper/[id]/[file]/route.ts")).toMatch(/public, max-age=31536000, immutable/);
  });
  it("the exam room downloads the paper early, saves straight to the database, and spreads its timing", () => {
    const room = read("src/app/exam/[id]/page.tsx");
    expect(room).toMatch(/exam_student_save/);
    expect(room).toMatch(/"x-have-paper"/);
    expect(room).toMatch(/jitter\(15_000\)/);
    expect(room).toMatch(/setInterval\(flush, timing\.current\.every\)/);
  });
});
