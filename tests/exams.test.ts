import { describe, it, expect } from "vitest";
import {
  markQuestion, markAttempt, toPublicQuestion, buildAttemptLayout, validateQuestion,
  parseFillBlanks, countBlanks, type Question
} from "@/lib/exams/engine";
import { verifySeb, buildSebConfig, sebLaunchUrl } from "@/lib/exams/seb";
import { sha256hex } from "@/lib/crypto";

const q = (type: Question["type"], data: any, answer: any, points = 2): Question =>
  ({ id: type, type, prompt: "Q", points, data, answer });

const opts = [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }];

describe("markQuestion", () => {
  it("mcq_single", () => {
    const m = q("mcq_single", { options: opts }, { correct: "b" });
    expect(markQuestion(m, "b").points).toBe(2);
    expect(markQuestion(m, "a").points).toBe(0);
    expect(markQuestion(m, undefined).points).toBe(0);
  });
  it("mcq_multi all-or-nothing and partial", () => {
    const strict = q("mcq_multi", { options: opts }, { correct: ["a", "c"] }, 4);
    expect(markQuestion(strict, ["c", "a"]).points).toBe(4);
    expect(markQuestion(strict, ["a"]).points).toBe(0);
    const partial = q("mcq_multi", { options: opts }, { correct: ["a", "c"], partial: true }, 4);
    expect(markQuestion(partial, ["a"]).points).toBe(2);
    expect(markQuestion(partial, ["a", "b"]).points).toBe(0);  // wrong pick cancels a right one
    expect(markQuestion(partial, ["b"]).points).toBe(0);       // never negative
  });
  it("true_false accepts booleans and strings", () => {
    const m = q("true_false", {}, { correct: false });
    expect(markQuestion(m, false).points).toBe(2);
    expect(markQuestion(m, "false").points).toBe(2);
    expect(markQuestion(m, true).points).toBe(0);
  });
  it("short_answer normalises case and spacing", () => {
    const m = q("short_answer", {}, { accepted: ["Abuja", "F.C.T. Abuja"] });
    expect(markQuestion(m, "  abuja ").points).toBe(2);
    expect(markQuestion(m, "f.c.t.   abuja").points).toBe(2);
    expect(markQuestion(m, "Lagos").points).toBe(0);
    const cs = q("short_answer", {}, { accepted: ["NaCl"], case_sensitive: true });
    expect(markQuestion(cs, "nacl").points).toBe(0);
  });
  it("numeric with tolerance", () => {
    const m = q("numeric", {}, { value: 3.14, tolerance: 0.01 });
    expect(markQuestion(m, "3.15").points).toBe(2);
    expect(markQuestion(m, 3.2).points).toBe(0);
    expect(markQuestion(m, "abc").points).toBe(0);
    expect(markQuestion(q("numeric", {}, { value: 1000 }), "1,000").points).toBe(2);
  });
  it("fill_blanks gives proportional credit", () => {
    const { data, answer } = parseFillBlanks("Water is [[H2O|h2o]] and salt is [[NaCl]].");
    const m = q("fill_blanks", data, answer, 4);
    expect(markQuestion(m, ["h2o", "nacl"]).points).toBe(4);
    expect(markQuestion(m, ["h2o", "x"]).points).toBe(2);
  });
  it("matching and ordering", () => {
    const mt = q("matching", { left: [{ id: "1" }, { id: "2" }], right: [{ id: "x" }, { id: "y" }] }, { pairs: { "1": "x", "2": "y" } });
    expect(markQuestion(mt, { "1": "x", "2": "y" }).points).toBe(2);
    expect(markQuestion(mt, { "1": "x", "2": "x" }).points).toBe(1);
    const od = q("ordering", { items: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] }, { order: ["a", "b", "c", "d"] }, 4);
    expect(markQuestion(od, ["a", "b", "d", "c"]).points).toBe(2);
    const strictOd = q("ordering", od.data, { order: ["a", "b", "c", "d"], partial: false }, 4);
    expect(markQuestion(strictOd, ["a", "b", "d", "c"]).points).toBe(0);
  });
  it("hotspot hits a region", () => {
    const m = q("hotspot", { image_url: "x.png" }, { regions: [{ x: 10, y: 10, w: 20, h: 20 }] });
    expect(markQuestion(m, { x: 15, y: 29 }).points).toBe(2);
    expect(markQuestion(m, { x: 50, y: 50 }).points).toBe(0);
  });
  it("essays wait for a teacher unless blank", () => {
    const m = q("essay", {}, {});
    expect(markQuestion(m, "An answer").points).toBeNull();
    expect(markQuestion(m, "").points).toBe(0);
  });
});

describe("markAttempt", () => {
  const qs = [
    { ...q("mcq_single", { options: opts }, { correct: "a" }), id: "q1" },
    { ...q("essay", {}, {}, 10), id: "q2" }
  ];
  it("totals auto marks and counts pending manual marks", () => {
    const r = markAttempt(qs, { q1: "a", q2: "essay text" });
    expect(r).toMatchObject({ auto_score: 2, total_score: 2, max_score: 12, pending: 1 });
  });
  it("keeps teacher overrides when re-marking", () => {
    const first = markAttempt(qs, { q1: "a", q2: "essay text" });
    const withTeacher = { ...first.marks, q2: { points: 7, max: 10, auto: false } };
    const r = markAttempt(qs, { q1: "a", q2: "essay text" }, withTeacher);
    expect(r).toMatchObject({ total_score: 9, pending: 0 });
  });
});

describe("toPublicQuestion never leaks answers", () => {
  it("strips keys for every type", () => {
    const { data, answer } = parseFillBlanks("Capital: [[Abuja]]");
    const all: Question[] = [
      q("mcq_single", { options: opts }, { correct: "a" }),
      q("short_answer", {}, { accepted: ["secret"] }),
      q("fill_blanks", data, answer),
      q("matching", { left: [{ id: "1", text: "L" }], right: [{ id: "x", text: "R" }] }, { pairs: { "1": "x" } }),
      q("hotspot", { image_url: "i.png" }, { regions: [{ x: 1, y: 1, w: 1, h: 1 }] })
    ];
    for (const item of all) {
      const pub = JSON.stringify(toPublicQuestion(item));
      expect(pub).not.toContain("secret");
      expect(pub).not.toContain("Abuja");
      expect(pub).not.toContain("regions");
      expect(pub).not.toContain("pairs");
      expect(pub).not.toContain("correct");
    }
    expect(countBlanks("a [[x]] b [[y|z]]")).toBe(2);
  });
});

describe("buildAttemptLayout", () => {
  it("never shows ordering items in the correct order", () => {
    const od: Question = { id: "o", type: "ordering", prompt: "", points: 1, data: { items: [{ id: "1" }, { id: "2" }] }, answer: {} };
    for (let i = 0; i < 50; i++) {
      expect(buildAttemptLayout([od], {}).option_orders.o).toEqual(["2", "1"]);
    }
  });
  it("keeps question order unless shuffling is on", () => {
    const qs = ["a", "b", "c"].map(id => ({ id, type: "essay", prompt: "", points: 1, data: {}, answer: {} } as Question));
    expect(buildAttemptLayout(qs, {}).question_order).toEqual(["a", "b", "c"]);
    expect([...buildAttemptLayout(qs, { shuffleQuestions: true }).question_order].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("validateQuestion", () => {
  it("flags missing answer keys", () => {
    expect(validateQuestion({ type: "mcq_single", prompt: "x", points: 1, data: { options: opts }, answer: {} }))
      .toContain("Mark the correct option.");
    expect(validateQuestion({ type: "mcq_single", prompt: "x", points: 1, data: { options: opts }, answer: { correct: "a" } })).toEqual([]);
  });
});

describe("Safe Exam Browser", () => {
  const url = "https://school.example.com/api/student/exams/1/start";
  it("verifies config-key and browser-exam-key hashes", () => {
    const h = new Headers({ "x-safeexambrowser-configkeyhash": sha256hex(url + "CK1") });
    expect(verifySeb(url, h, { require_seb: true, seb_config_keys: ["CK1"] }).ok).toBe(true);
    expect(verifySeb(url, h, { require_seb: true, seb_config_keys: ["OTHER"] }).ok).toBe(false);
    const h2 = new Headers({ "x-safeexambrowser-requesthash": sha256hex(url + "BEK") });
    expect(verifySeb(url, h2, { require_seb: true, seb_browser_keys: ["BEK"] })).toMatchObject({ ok: true, level: "hash" });
  });
  it("falls back to the SEB user agent when no keys are set", () => {
    expect(verifySeb(url, new Headers({ "user-agent": "Mozilla/5.0 SEB/3.7.1" }), { require_seb: true }).ok).toBe(true);
    expect(verifySeb(url, new Headers({ "user-agent": "Mozilla/5.0 Chrome/126" }), { require_seb: true }).ok).toBe(false);
    expect(verifySeb(url, new Headers(), { require_seb: false }).ok).toBe(true);
  });
  it("builds a config file and launch link", () => {
    const xml = buildSebConfig({ startUrl: "https://a.b/x?y=1&z=2", quitUrl: "https://a.b/q", title: "T", quit_password: "pw" });
    expect(xml).toContain("<key>startURL</key>");
    expect(xml).toContain("x?y=1&amp;z=2");
    expect(xml).toContain(sha256hex("pw"));
    expect(sebLaunchUrl("https://a.b/c.seb")).toBe("sebs://a.b/c.seb");
  });
});

import { evaluate } from "@/components/exams/Calculator";

describe("exam calculator", () => {
  it("evaluates safely with precedence and functions", () => {
    expect(evaluate("2+3*4")).toBe(14);
    expect(evaluate("(2+3)*4")).toBe(20);
    expect(evaluate("2^3^2")).toBe(512);
    expect(evaluate("sqrt(16)+abs(-2)")).toBe(6);
    expect(evaluate("2(3+1)")).toBe(8);
    expect(Math.round(evaluate("sin(30)") * 1000) / 1000).toBe(0.5);
    expect(() => evaluate("alert(1)")).toThrow();
    expect(() => evaluate("1/0")).toThrow();
  });
});
