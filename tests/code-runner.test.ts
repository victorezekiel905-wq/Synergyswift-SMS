import { describe, it, expect } from "vitest";
import { runJavaScript, gradeCode, normalizeOutput } from "@/lib/exams/code-runner";

describe("JavaScript sandbox", () => {
  it("runs code with input and captures printed output", async () => {
    const r = await runJavaScript("const [a, b] = input.split(' ').map(Number); console.log(a + b);", "2 3");
    expect(r.ok).toBe(true);
    expect(r.output.trim()).toBe("5");
  });
  it("reads input line by line", async () => {
    const r = await runJavaScript("let l, s = 0; while ((l = readLine()) !== null) s += Number(l); print(s);", "1\n2\n3");
    expect(r.output.trim()).toBe("6");
  });
  it("stops infinite loops", async () => {
    const r = await runJavaScript("while (true) {}", "", 300);
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
  });
  it("has no access to Node or the network", async () => {
    for (const code of ["require('fs')", "process.exit(1)", "fetch('https://example.com')", "globalThis.process.env"]) {
      const r = await runJavaScript(code, "");
      expect(r.ok).toBe(false);
    }
  });
  it("reports syntax errors", async () => {
    const r = await runJavaScript("function (", "");
    expect(r.error).toMatch(/SyntaxError/);
  });
  it("caps runaway memory", async () => {
    const r = await runJavaScript("const a = []; while (true) a.push('x'.repeat(100000));", "", 3000);
    expect(r.ok).toBe(false);
  });
});

describe("grading", () => {
  const tests = [
    { input: "2 3", expected: "5" }, { input: "10 -4", expected: "6\n" }, { input: "0 0", expected: "0", hidden: true }
  ];
  it("awards a share per passed test and hides hidden expectations", async () => {
    const good = await gradeCode("javascript", "const [a,b]=input.split(' ').map(Number);console.log(a+b)", tests, 6);
    expect(good.points).toBe(6);
    expect(good.outcomes[2].expected).toBeNull();
    const wrong = await gradeCode("javascript", "const [a,b]=input.split(' ').map(Number);console.log(a*b)", tests, 6);
    expect(wrong.passed).toBe(1);
    expect(wrong.points).toBe(2);
  });
  it("ignores trailing spaces and final newlines", () => {
    expect(normalizeOutput("5  \n\n")).toBe(normalizeOutput("5"));
    expect(normalizeOutput("a\r\nb")).toBe("a\nb");
  });
});

import { toPublicQuestion, markAttempt, type Question } from "@/lib/exams/engine";
import { markCodeQuestions } from "@/lib/exams/server";

describe("code questions in exams", () => {
  const q: Question = { id: "c1", type: "code", prompt: "Add two numbers", points: 4, data: { language: "javascript", starter: "" },
    answer: { reference: "x", tests: [{ input: "1 2", expected: "3" }, { input: "5 5", expected: "10", hidden: true }] } };
  it("shows students only the visible tests", () => {
    const pub = toPublicQuestion(q) as any;
    expect(pub.data.examples).toEqual([{ input: "1 2", expected: "3" }]);
    expect(JSON.stringify(pub)).not.toContain("10");
    expect(pub.answer).toBeUndefined();
  });
  it("keeps runner marks when the attempt is re-marked", () => {
    const r = markAttempt([q], { c1: "code" }, { c1: { points: 2, max: 4, auto: true, runner: true } });
    expect(r.marks.c1.points).toBe(2);
    expect(r.pending).toBe(0);
  });
  it("marks a submitted attempt by running the tests (pending placeholder from markQuestion)", async () => {
    let saved: any = null;
    const svc = { from: () => ({ update: (row: any) => { saved = row; const chain: any = { eq: () => chain, in: () => chain, select: () => chain, maybeSingle: async () => ({ data: { ...row, id: "a1" } }) }; return chain; } }) };
    const attempt = { id: "a1", status: "submitted", question_order: [], answers: { c1: "const [a,b]=input.split(' ').map(Number);console.log(a+b)" }, marks: { c1: { points: null, max: 4, auto: false } } };
    const out = await markCodeQuestions(svc, attempt, [q]);
    expect(saved.marks.c1).toMatchObject({ points: 4, runner: true });
    expect(out.status).toBe("graded");
  });
});
