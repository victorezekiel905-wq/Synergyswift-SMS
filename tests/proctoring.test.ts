import { describe, it, expect } from "vitest";
import { clientIp, ipAllowed, isValidIpRule, normalizeIp } from "@/lib/net";
import { analyseExam, type AnalysisAttempt } from "@/lib/exams/analysis";
import type { Question } from "@/lib/exams/engine";

describe("client IP", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("uses the address the trusted proxy saw, not a forged leftmost entry", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.1.1.1, 41.58.10.7" }), 1)).toBe("41.58.10.7");
    expect(clientIp(h({ "x-forwarded-for": "41.58.10.7" }), 1)).toBe("41.58.10.7");
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 41.58.10.7, 10.0.0.2" }), 2)).toBe("41.58.10.7");
    expect(clientIp(h({ "x-real-ip": "41.58.10.7" }))).toBe("41.58.10.7");
    expect(clientIp(h({}))).toBeNull();
  });
  it("normalises ports and mapped addresses", () => {
    expect(normalizeIp("::ffff:41.58.10.7")).toBe("41.58.10.7");
    expect(normalizeIp("41.58.10.7:5432")).toBe("41.58.10.7");
    expect(normalizeIp("[2c0f:f5c0::1]:443")).toBe("2c0f:f5c0::1");
  });
});

describe("network allow-list", () => {
  it("allows everyone when empty", () => {
    expect(ipAllowed("8.8.8.8", [])).toBe(true);
    expect(ipAllowed(null, undefined)).toBe(true);
  });
  it("matches exact IPv4 and CIDR ranges", () => {
    expect(ipAllowed("41.58.10.7", ["41.58.10.7"])).toBe(true);
    expect(ipAllowed("41.58.200.1", ["41.58.0.0/16"])).toBe(true);
    expect(ipAllowed("41.59.0.1", ["41.58.0.0/16"])).toBe(false);
    expect(ipAllowed("10.0.0.5", ["0.0.0.0/0"])).toBe(true);
    expect(ipAllowed(null, ["41.58.0.0/16"])).toBe(false);
  });
  it("matches IPv6 ranges and never mixes families", () => {
    expect(ipAllowed("2c0f:f5c0:1::9", ["2c0f:f5c0::/32"])).toBe(true);
    expect(ipAllowed("2c0f:f5c1::9", ["2c0f:f5c0::/32"])).toBe(false);
    expect(ipAllowed("41.58.10.7", ["::/0"])).toBe(false);
    expect(ipAllowed("::ffff:41.58.10.7", ["41.58.10.0/24"])).toBe(true);
  });
  it("validates rules", () => {
    expect(isValidIpRule("41.58.0.0/16")).toBe(true);
    expect(isValidIpRule("2c0f:f5c0::/32")).toBe(true);
    expect(isValidIpRule("41.58.0.0/33")).toBe(false);
    expect(isValidIpRule("300.1.1.1")).toBe(false);
    expect(isValidIpRule("school wifi")).toBe(false);
  });
});

describe("item analysis", () => {
  const opts = [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }];
  const qs: (Question & { topic?: string })[] = [
    { id: "q1", type: "mcq_single", prompt: "Good item", points: 1, data: { options: opts }, answer: { correct: "a" }, topic: "Algebra" },
    { id: "q2", type: "mcq_single", prompt: "Wrong key", points: 1, data: { options: opts }, answer: { correct: "b" }, topic: "Algebra" },
    { id: "q3", type: "true_false", prompt: "Easy", points: 1, data: {}, answer: { correct: true }, topic: "Geometry" },
    { id: "q4", type: "short_answer", prompt: "Capital", points: 2, data: {}, answer: { accepted: ["abuja"] } }
  ];
  // Ten students: strong ones get q1 right but pick "c" on q2 (the real answer); weak ones pick "b".
  const attempts: AnalysisAttempt[] = Array.from({ length: 10 }, (_, i) => {
    const strong = i < 5;
    return {
      id: `s${i}`,
      answers: { q1: strong ? "a" : "c", q2: strong ? "c" : "b", q3: true, q4: strong ? "Abuja" : "Lagos" },
      marks: {
        q1: { points: strong ? 1 : 0, max: 1 }, q2: { points: strong ? 0 : 1, max: 1 },
        q3: { points: 1, max: 1 }, q4: { points: strong ? 2 : 0, max: 2 }
      }
    };
  });
  const a = analyseExam(qs, attempts);
  it("computes difficulty and discrimination", () => {
    const q1 = a.items.find(x => x.question_id === "q1")!;
    expect(q1.p).toBe(0.5);
    expect(q1.discrimination).toBe(1);
    expect(q1.flags).toEqual([`option "B" is never chosen`]);
  });
  it("flags a probable wrong answer key", () => {
    const q2 = a.items.find(x => x.question_id === "q2")!;
    expect(q2.discrimination).toBe(-1);
    expect(q2.flags.join()).toContain("negative discrimination");
    expect(q2.flags.join()).toContain(`option "C" attracts strong students`);
    expect(q2.distractors!.find(d => d.option_id === "c")!.upper).toBe(3);
  });
  it("flags very easy items and lists common wrong answers", () => {
    expect(a.items.find(x => x.question_id === "q3")!.flags).toContain("very easy");
    expect(a.items.find(x => x.question_id === "q4")!.common_wrong).toEqual([{ answer: "lagos", count: 5 }]);
  });
  it("summarises the paper", () => {
    expect(a.students).toBe(10);
    expect(a.distribution.reduce((s, d) => s + d.count, 0)).toBe(10);
    expect(a.by_topic.map(t => t.topic).sort()).toEqual(["Algebra", "Geometry"]);
    expect(a.reliability).not.toBeNull();
  });
  it("skips reliability when students sat different pooled questions", () => {
    const pooled = attempts.map((x, i) => ({ ...x, question_order: i % 2 ? ["q1", "q3", "q4"] : ["q2", "q3", "q4"] }));
    const r = analyseExam(qs, pooled);
    expect(r.reliability).toBeNull();
    expect(r.items.find(x => x.question_id === "q1")!.n).toBe(5);
  });
});
