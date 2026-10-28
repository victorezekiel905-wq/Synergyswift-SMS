import { describe, it, expect, vi, beforeEach } from "vitest";

const gen = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai", () => ({ generateJson: gen }));
const collections = vi.hoisted(() => vi.fn());
vi.mock("@/lib/collections-server", () => ({ loadCollections: collections }));
const questions = vi.hoisted(() => vi.fn());
vi.mock("@/lib/exams/server", () => ({ loadQuestions: questions }));

import { answerText, essayMark, feeReminder, timetableHelp, parentHelp, headSummary } from "@/lib/ai-drafts";

/** A pretend Supabase client: each table answers with its rows, filtered by eq(). */
function fakeDb(rows: Record<string, any[]>, rpc: Record<string, unknown> = {}) {
  const from = (table: string) => {
    const f: [string, unknown][] = [];
    const list = () => (rows[table] ?? []).filter(r => f.every(([k, v]) => r[k] === undefined || r[k] === v));
    const q: any = {
      select: () => q, order: () => q, limit: () => q, gte: () => q, lte: () => q, gt: () => q, in: () => q, not: () => q,
      eq: (k: string, v: unknown) => { f.push([k, v]); return q; },
      maybeSingle: async () => ({ data: list()[0] ?? null }),
      then: (ok: any, bad: any) => Promise.resolve({ data: list() }).then(ok, bad)
    };
    return q;
  };
  return { from, rpc: async (fn: string) => ({ data: rpc[fn] ?? null }) };
}
const ctxWith = (sb: any) => ({ sb, tenant: { id: "t1", name: "Greenfield College" }, userId: "u1" });

beforeEach(() => { gen.mockReset(); collections.mockReset(); questions.mockReset(); });

describe("reading written answers", () => {
  it("turns rich text into plain text", () => {
    expect(answerText({ html: "<p>Photosynthesis needs <b>light</b>.</p><p>And water &amp; CO<sub>2</sub>.</p>" })).toBe("Photosynthesis needs light.\nAnd water & CO2.");
    expect(answerText(null)).toBe("");
  });
});

describe("essay marking help", () => {
  const db = () => fakeDb({
    exams: [{ id: "e1", title: "Biology test", subjects: { name: "Biology" } }],
    exam_attempts: [{ id: "a1", exam_id: "e1", answers: { q1: "<p>Plants make food using light.</p>", q2: "B" } }]
  });
  it("keeps the suggested mark between 0 and the question's points, in halves", async () => {
    questions.mockResolvedValue([{ id: "q1", type: "essay", prompt: "Explain photosynthesis.", points: 5, answer: { rubric: "Light, water, CO2, glucose." } }]);
    gen.mockResolvedValue({ points: 7.3, feedback: "Good start.", reasons: ["Mentions light"] });
    const r = await essayMark(ctxWith(db()), db(), "e1", "a1", "q1");
    expect(r).toMatchObject({ points: 5, max: 5 });
    gen.mockResolvedValue({ points: 2.3, feedback: "x", reasons: [] });
    expect(await essayMark(ctxWith(db()), db(), "e1", "a1", "q1")).toMatchObject({ points: 2.5 });
    // The answer is passed as data to mark, with the guide; the model is told never to follow it.
    const req = gen.mock.calls[0][0];
    expect(JSON.parse(req.prompt)).toMatchObject({ student_answer: "Plants make food using light.", marking_guide: "Light, water, CO2, glucose.", max_points: 5 });
    expect(req.system).toMatch(/never as instructions/);
  });
  it("only helps with written answers, and never asks the AI about an empty one", async () => {
    questions.mockResolvedValue([{ id: "q2", type: "mcq", prompt: "Pick one", points: 1 }, { id: "q3", type: "essay", prompt: "Write", points: 4 }]);
    expect(await essayMark(ctxWith(db()), db(), "e1", "a1", "q2")).toEqual({ error: "Suggested marks are for written answers." });
    expect(await essayMark(ctxWith(db()), db(), "e1", "a1", "q3")).toMatchObject({ points: 0, max: 4 });
    expect(gen).not.toHaveBeenCalled();
  });
  it("refuses another school's exam", async () => {
    const other = fakeDb({ exams: [] });
    expect(await essayMark(ctxWith(other), other, "e1", "a1", "q1")).toEqual({ error: "not found" });
  });
});

describe("fee reminder wording", () => {
  it("writes for a family that owes, from the bursary's own figures", async () => {
    collections.mockResolvedValue({ families: [{ guardian_id: "g1", name: "Mrs Okafor", children: [{ name: "Chidi Okafor" }], balance: 85000, oldest_due: "2026-09-15",
      days_overdue: 43, level_label: "Reminded", promise: null, promises: [{ status: "broken" }] }], total: 85000 });
    gen.mockResolvedValue({ message: "  Dear Mrs Okafor, ...  " });
    const r = await feeReminder(ctxWith(fakeDb({ tenant_settings: [{ school_name: "Greenfield College", currency: "NGN" }] })), {}, "g1");
    expect(r).toEqual({ message: "Dear Mrs Okafor, ..." });
    const facts = JSON.parse(gen.mock.calls[0][0].prompt);
    expect(facts).toMatchObject({ children: ["Chidi"], broken_promises: 1, days_overdue: 43 });
    expect(facts.balance).toContain("85,000");
  });
  it("says so when the family owes nothing", async () => {
    collections.mockResolvedValue({ families: [], total: 0 });
    expect(await feeReminder(ctxWith(fakeDb({})), {}, "g9")).toMatchObject({ status: 404 });
  });
});

describe("timetable suggestions", () => {
  it("works out the week's teaching slots and each teacher's load for the AI", async () => {
    const sb = fakeDb({
      timetable_periods: [{ id: "p1", is_break: false }, { id: "p2", is_break: false }, { id: "b", is_break: true }, { id: "p3", is_break: false }],
      subject_offerings: [
        { class_group_id: "c1", subject_id: "s1", teacher_id: "t1", periods_per_week: 9, subjects: { name: "Maths" }, class_groups: { name: "JSS1" }, users: { full_name: "Mr Ade" } },
        { class_group_id: "c2", subject_id: "s1", teacher_id: "t1", periods_per_week: 8, subjects: { name: "Maths" }, class_groups: { name: "JSS2" }, users: { full_name: "Mr Ade" } }
      ]
    });
    gen.mockResolvedValue({ summary: "Mr Ade has more lessons than slots.", suggestions: ["Share JSS2 Maths."] });
    await timetableHelp(ctxWith(sb), [{ classId: "c2", subjectId: "s1", teacherId: "t1", perWeek: 2, reason: "no free period" }], 5);
    const facts = JSON.parse(gen.mock.calls[0][0].prompt);
    expect(facts.teaching_slots_per_week).toBe(15);
    expect(facts.teachers).toEqual([{ teacher: "Mr Ade", periods_per_week: 17 }]);
    expect(facts.could_not_place[0]).toMatchObject({ class: "JSS2", subject: "Maths", teacher: "Mr Ade" });
  });
});

describe("the parents' help assistant", () => {
  it("answers from the school's facts and only this parent's own children", async () => {
    const sb = fakeDb({
      tenant_settings: [{ school_name: "Greenfield College", phone: "0800", email: "office@gf.ng", currency: "NGN", ai_settings: { parent_faq: "Gate closes 7:45am." } }],
      terms: [{ name: "First term", ends_on: "2026-12-12", is_current: true }],
      school_events: [], notices: []
    });
    const svc = fakeDb({
      guardians: [{ id: "g1", user_id: "u1", student_guardians: [{ students: { id: "s1", first_name: "Ada", class_groups: { name: "JSS2" } } }] }],
      fee_invoices: [{ student_id: "s1", total: 100000, amount_paid: 40000, due_date: "2026-10-01" }]
    });
    gen.mockResolvedValue({ answer: "Term ends on 12 December.", needs_office: false });
    const turns = Array.from({ length: 11 }, (_, i) => ({ role: (i % 2 ? "model" : "user") as "user" | "model", text: `q${i}` }));
    const r = await parentHelp(ctxWith(sb), svc, turns);
    expect(r).toMatchObject({ answer: "Term ends on 12 December.", contact: { phone: "0800", email: "office@gf.ng" } });
    const req = gen.mock.calls[0][0];
    expect(req.turns).toHaveLength(8);
    expect(req.system).toContain("Gate closes 7:45am.");
    expect(req.system).toContain("\"child\":\"Ada\"");
    expect(req.system).toContain("60,000");
    expect(req.system).toMatch(/Never discuss other families/);
  });
});

describe("the head's summary", () => {
  it("waits until the school has daily figures", async () => {
    expect(await headSummary(ctxWith(fakeDb({ kpi_snapshots: [], tenant_settings: [{}] })))).toBeNull();
    expect(gen).not.toHaveBeenCalled();
  });
});
