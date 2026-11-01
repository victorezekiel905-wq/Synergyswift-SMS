import { describe, it, expect } from "vitest";
import { earlyYearsSettings, checkEyScale, areaSummary, EY_FRAMEWORKS, EY_SCALE_PRESETS, DEFAULT_EY_OPTIONS } from "@/lib/early-years";
import { GRADING_PRESETS, STAGES, addNumberedPart, bandGaps, classStage, checkPreset } from "@/lib/grading-presets";
import { compileClassResults } from "@/lib/results";
import { computeClassResults, midtermParts } from "@/lib/grading";
import { commentInputFor } from "@/lib/comment-input";
import { GRADING } from "@/lib/curricula";

/**
 * A tiny in-memory Supabase: enough of the query builder for compiling report
 * cards (select / eq / in / order / range / maybeSingle / upsert). Embedded
 * relations are stored on the rows already.
 */
function fakeDb(tables: Record<string, any[]>) {
  const writes: Record<string, any[]> = {};
  const from = (t: string) => {
    let rows = [...(tables[t] ?? [])];
    const q: any = {
      select: () => q, order: () => q, limit: () => q,
      eq: (k: string, v: unknown) => { rows = rows.filter(r => r[k] === v); return q; },
      neq: (k: string, v: unknown) => { rows = rows.filter(r => r[k] !== v); return q; },
      in: (k: string, vs: unknown[]) => { rows = rows.filter(r => vs.includes(r[k])); return q; },
      gte: () => q, lte: () => q,
      range: async (a: number, b: number) => ({ data: rows.slice(a, b + 1), error: null }),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      upsert: async (r: any[]) => { (writes[t] ??= []).push(...r); return { error: null }; },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok)
    };
    return q;
  };
  return { sb: { from }, writes };
}

const T = "t1", TERM = "term1", CG = "nursery1";
function school(extra: Record<string, any[]> = {}) {
  return fakeDb({
    class_groups: [{ id: CG, tenant_id: T, name: "Nursery 1 Red", level: "Nursery 1", scheme_id: "ey", form_teacher_id: null, users: { full_name: "Mrs Ade" } }],
    grading_schemes: [{ id: "ey", tenant_id: T, name: "Preschool", template: "early_years", pass_mark: 0, decimals: 0, show_position: false, show_class_average: false,
      cumulative_mode: "none", is_default: false, grade_bands: [], grading_components: [] }],
    students: [
      { id: "s1", tenant_id: T, class_group_id: CG, status: "active", first_name: "Tobi", last_name: "Ade", other_names: null, admission_no: "2026/0001" },
      { id: "s2", tenant_id: T, class_group_id: CG, status: "active", first_name: "Amara", last_name: "Eze", other_names: null, admission_no: "2026/0002" }
    ],
    terms: [{ id: TERM, tenant_id: T, session_id: "ses", position: 1, starts_on: null, ends_on: null, next_term_begins: "2027-01-06", name: "First Term", academic_sessions: { name: "2026-2027" } }],
    early_years_areas: [{ id: "a1", tenant_id: T, name: "Literacy", position: 0 }, { id: "a2", tenant_id: T, name: "Mathematics", position: 1 }],
    early_years_items: [
      { id: "i1", tenant_id: T, area_id: "a1", text: "Recognises letter sounds", position: 0 },
      { id: "i2", tenant_id: T, area_id: "a1", text: "Writes own name", position: 1 },
      { id: "i3", tenant_id: T, area_id: "a2", text: "Counts to 10", position: 0 }
    ],
    tenant_settings: [{ tenant_id: T, early_years: { scale: EY_SCALE_PRESETS[0].scale, options: { ...DEFAULT_EY_OPTIONS, show_attendance: false } } }],
    early_years_ratings: [
      { tenant_id: T, term_id: TERM, student_id: "s1", item_id: "i1", rating: 3 },
      { tenant_id: T, term_id: TERM, student_id: "s1", item_id: "i2", rating: 2 },
      { tenant_id: T, term_id: TERM, student_id: "s1", item_id: "i3", rating: 1 }
    ],
    early_years_comments: [{ tenant_id: T, term_id: TERM, student_id: "s1", area_id: "a1", comment: "Tobi loves story time." }],
    report_cards: [],
    ...extra
  });
}

describe("preschool settings", () => {
  it("falls back to a three-point scale and the default report options", () => {
    const s = earlyYearsSettings(null);
    expect(s.scale.map(x => x.label)).toEqual(["Secure", "Developing", "Emerging"]);
    expect(s.options).toEqual(DEFAULT_EY_OPTIONS);
  });
  it("keeps the school's own scale (best first) and ignores junk", () => {
    const s = earlyYearsSettings({ early_years: { scale: [{ value: 1, short: "N", label: "Not yet" }, { value: 2, short: "Y", label: "Yes" }, { value: 99, label: "bad" }], options: { show_traits: true, nope: 1 } } });
    expect(s.scale.map(x => x.value)).toEqual([2, 1]);
    expect(s.options.show_traits).toBe(true);
    expect(s.options.area_comments).toBe(true);
  });
  it("checks a scale a school types in", () => {
    expect(checkEyScale(EY_SCALE_PRESETS[2].scale)).toEqual([]);
    expect(checkEyScale([{ value: 1, short: "A", label: "One" }])).toHaveLength(1);
    expect(checkEyScale([{ value: 1, short: "A", label: "One" }, { value: 1, short: "B", label: "Two" }]).join(" ")).toMatch(/own value/);
    for (const p of EY_SCALE_PRESETS) expect(checkEyScale(p.scale), p.name).toEqual([]);
  });
  it("ready-made checklists have areas, statements and no repeated area names", () => {
    for (const f of EY_FRAMEWORKS) {
      expect(f.areas.length, f.key).toBeGreaterThan(3);
      expect(new Set(f.areas.map(a => a.name.toLowerCase())).size).toBe(f.areas.length);
      for (const a of f.areas) expect(a.items.length, a.name).toBeGreaterThan(1);
    }
    expect(EY_FRAMEWORKS.find(f => f.key === "eyfs")!.areas).toHaveLength(7);
  });
  it("sums up an area by its most common rating, cautiously on a tie", () => {
    const scale = EY_SCALE_PRESETS[0].scale;
    expect(areaSummary(["a", "b", "c"], { a: 3, b: 3, c: 1 }, scale)).toMatchObject({ rated: 3, total: 3, typical: { label: "Secure" } });
    expect(areaSummary(["a", "b"], { a: 3, b: 1 }, scale).typical?.label).toBe("Emerging");
    expect(areaSummary(["a"], {}, scale)).toEqual({ rated: 0, total: 1, typical: null });
  });
});

describe("grading systems per stage", () => {
  it("every pattern is sound and says which stages it suits", () => {
    for (const p of GRADING_PRESETS) {
      expect(checkPreset(p), p.id).toEqual([]);
      expect(p.stages.length, p.id).toBeGreaterThan(0);
      expect(p.stages).not.toContain("preschool");
    }
    for (const s of STAGES.filter(s => s.id !== "preschool")) expect(GRADING_PRESETS.some(p => p.stages.includes(s.id)), s.id).toBe(true);
  });
  it("warns about gaps between grades, not about the usual .99 steps", () => {
    expect(bandGaps(GRADING_PRESETS[0].bands)).toEqual([]);
    expect(bandGaps([{ grade: "A", min_score: 70, max_score: 100 }, { grade: "F", min_score: 0, max_score: 49 }])[0]).toMatch(/49 to 70.*F/);
  });
  it("numbers repeated parts: CAT, then CAT 1 and CAT 2, then CAT 3", () => {
    const cat = { name: "CAT", max_score: 15, weight: 15 };
    let parts = addNumberedPart([{ name: "HW", max_score: 10, weight: 10 }], cat);
    expect(parts.map(p => p.name)).toEqual(["HW", "CAT"]);
    parts = addNumberedPart(parts, cat);
    expect(parts.map(p => p.name)).toEqual(["HW", "CAT 1", "CAT 2"]);
    parts = addNumberedPart(parts, cat);
    expect(parts.map(p => p.name)).toEqual(["HW", "CAT 1", "CAT 2", "CAT 3"]);
    // "CA" is not "CAT", and the marks and weights of earlier parts are kept.
    expect(addNumberedPart(parts, { name: "CA", max_score: 10, weight: 10 }).map(p => p.name)).toEqual(["HW", "CAT 1", "CAT 2", "CAT 3", "CA"]);
    expect(parts[0]).toMatchObject({ max_score: 10, weight: 10 });
    // A pattern's "CAT 1, CAT 2" carries on from 3.
    const preset = GRADING_PRESETS.find(p => p.id === "cat-exam")!.parts;
    expect(addNumberedPart(preset, { name: "CAT", max_score: 15, weight: 15 }).map(p => p.name)).toEqual(["CAT 1", "CAT 2", "Exam", "CAT 3"]);
  });
  it("puts each class in its stage, from its section or its name", () => {
    expect(classStage("Year 7 Red", "secondary")).toBe("secondary");
    expect(classStage("Blue room", "nursery")).toBe("preschool");
    expect(classStage("Nursery 2")).toBe("preschool");
    expect(classStage("Reception")).toBe("preschool");
    expect(classStage("Primary 4")).toBe("primary");
    expect(classStage("Year 3 Green")).toBe("primary");
    expect(classStage("JSS 2A")).toBe("secondary");
    expect(classStage("SS 3 Science")).toBe("secondary");
    expect(classStage("Year 11 Blue")).toBe("secondary");
    expect(classStage("Year 12 Red")).toBe("sixth_form");
    expect(classStage("Chess club")).toBeNull();
  });
  it("nursery stages from the curriculum planner use the preschool way", () => {
    expect(GRADING.eyfs.template).toBe("early_years");
    expect(GRADING.ng_early.template).toBe("early_years");
    expect(GRADING.waec.template).toBe("nigerian");
  });
});

describe("a subject's own parts", () => {
  const ca = { id: "ca", name: "CA", max_score: 40, weight: 40, position: 1, midterm: true }, exam = { id: "ex", name: "Exam", max_score: 60, weight: 60, position: 2 };
  const mathsParts = [
    { id: "c1", offering_id: "offM", name: "CAT 1", max_score: 20, weight: 10, position: 1, midterm: true },
    { id: "c2", offering_id: "offM", name: "CAT 2", max_score: 20, weight: 10, position: 2, midterm: true },
    { id: "hw", offering_id: "offM", name: "HW", max_score: 10, weight: 10, position: 3, midterm: false },
    { id: "ts", offering_id: "offM", name: "Test", max_score: 20, weight: 20, position: 4, midterm: true },
    { id: "me", offering_id: "offM", name: "Exam", max_score: 100, weight: 50, position: 5, midterm: false }
  ];
  const sc = (subject_id: string, component_id: string, score: number) => ({ id: `${subject_id}-${component_id}`, tenant_id: T, term_id: TERM, student_id: "s1", subject_id, component_id, score });
  const db = () => fakeDb({
    class_groups: [{ id: "c7", tenant_id: T, name: "Year 7 Red", level: "Year 7", scheme_id: "sch", form_teacher_id: null, users: null }],
    grading_schemes: [{ id: "sch", tenant_id: T, name: "Junior", template: "nigerian", pass_mark: 40, decimals: 1, show_position: true, show_class_average: true,
      cumulative_mode: "none", is_default: true, subject_parts: true, grade_bands: [{ grade: "A", min_score: 70, max_score: 100, remark: "Excellent", grade_point: null }, { grade: "F", min_score: 0, max_score: 69.99, remark: "Fail", grade_point: null }],
      grading_components: [ca, exam] }],
    subject_offerings: [{ id: "offM", tenant_id: T, class_group_id: "c7", subject_id: "maths", subjects: { id: "maths", name: "Mathematics" } },
      { id: "offE", tenant_id: T, class_group_id: "c7", subject_id: "eng", subjects: { id: "eng", name: "English" } }],
    grading_components: mathsParts,
    students: [{ id: "s1", tenant_id: T, class_group_id: "c7", status: "active", first_name: "Ada", last_name: "Obi", other_names: null, admission_no: "1" }],
    terms: [{ id: TERM, tenant_id: T, session_id: "ses", position: 1, starts_on: null, ends_on: null, next_term_begins: null, name: "First Term", academic_sessions: { name: "2026-2027" } }],
    // Maths: 18/20, 16/20, 9/10, 15/20, 70/100 → 9 + 8 + 9 + 15 + 35 = 76. English: 30/40, 45/60 → 30 + 45 = 75.
    score_entries: [sc("maths", "c1", 18), sc("maths", "c2", 16), sc("maths", "hw", 9), sc("maths", "ts", 15), sc("maths", "me", 70),
      sc("eng", "ca", 30), sc("eng", "ex", 45),
      sc("maths", "ca", 40)],   // an old mark on the school's part: Maths no longer uses it
    trait_definitions: [], tenant_settings: [{ tenant_id: T }], report_subject_comments: [], report_cards: []
  });

  it("totals each subject with its own parts, and the rest with the school's", async () => {
    const { sb, writes } = db();
    await compileClassResults(sb, T, TERM, "c7");
    const card = writes.report_cards[0];
    const maths = card.data.subjects.find((s: any) => s.subject_id === "maths"), eng = card.data.subjects.find((s: any) => s.subject_id === "eng");
    expect(maths.total).toBe(76);
    expect(maths.grade).toBe("A");
    expect(maths.own_parts.map((p: any) => p.name)).toEqual(["CAT 1", "CAT 2", "HW", "Test", "Exam"]);
    expect(maths.components).toEqual({ c1: 18, c2: 16, hw: 9, ts: 15, me: 70 });
    expect(eng.total).toBe(75);
    expect(eng.own_parts).toBeUndefined();
    expect(card.data.components.map((c: any) => c.name)).toEqual(["CA", "Exam"]);
    expect(card.average).toBe(75.5);
  });
  it("uses each subject's own mid-term parts on mid-term reports", async () => {
    const { sb, writes } = db();
    await compileClassResults(sb, T, TERM, "c7", { kind: "midterm" });
    const card = writes.report_cards[0];
    // Maths mid-term: CAT 1, CAT 2 and Test (10 + 10 + 20 = 40%) scaled to 100: (9 + 8 + 15) / 40 × 100 = 80.
    expect(card.data.subjects.find((s: any) => s.subject_id === "maths").total).toBe(80);
    // English mid-term: only CA counts: 30/40 = 75.
    expect(card.data.subjects.find((s: any) => s.subject_id === "eng").total).toBe(75);
  });
  it("the pure engine takes per-subject parts too", () => {
    const r = computeClassResults({ studentIds: ["s"], subjects: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
      scores: [{ student_id: "s", subject_id: "a", component_id: "x", score: 5 }, { student_id: "s", subject_id: "b", component_id: "ex", score: 30 }],
      scheme: { pass_mark: 40, decimals: 1, show_position: false, bands: [{ grade: "P", min_score: 0, max_score: 100 }], components: [exam] },
      partsFor: id => (id === "a" ? [{ id: "x", name: "X", max_score: 10, weight: 100 }] : null) });
    expect(r[0].subjects.map(s => s.total)).toEqual([50, 30]);   // A: 5/10 of 100%; B uses the school's Exam (30/60 of 60%)
    expect(midtermParts([ca, exam])).toEqual([{ ...ca, weight: 100 }]);
    expect(midtermParts([exam])).toBeNull();
  });
});

describe("preschool report cards", () => {
  it("compile the checklist and comments: no scores, totals or positions", async () => {
    const { sb, writes } = school();
    const r = await compileClassResults(sb, T, TERM, CG);
    expect(r).toEqual({ computed: 2, skipped_published: 0 });
    const tobi = writes.report_cards.find(c => c.student_id === "s1");
    expect(tobi).toMatchObject({ total: null, average: null, position: null, class_size: 2, kind: "term" });
    expect(tobi.data.template).toBe("early_years");
    expect(tobi.data.subjects).toEqual([]);
    expect(tobi.data.term_label).toBe("First Term 2026-2027");
    expect(tobi.data.form_teacher).toBe("Mrs Ade");
    const lit = tobi.data.areas.find((a: any) => a.name === "Literacy");
    expect(lit.items).toEqual([{ text: "Recognises letter sounds", rating: 3 }, { text: "Writes own name", rating: 2 }]);
    expect(lit.comment).toBe("Tobi loves story time.");
    expect(tobi.data.days_present).toBeNull();
    const amara = writes.report_cards.find(c => c.student_id === "s2");
    expect(amara.data.areas.every((a: any) => a.items.every((i: any) => i.rating === null))).toBe(true);
  });
  it("leave published cards alone unless an admin forces it", async () => {
    const { sb, writes } = school({ report_cards: [{ id: "c1", tenant_id: T, term_id: TERM, kind: "term", student_id: "s1", status: "published" }] });
    const r = await compileClassResults(sb, T, TERM, CG);
    expect(r).toEqual({ computed: 1, skipped_published: 1 });
    expect(writes.report_cards.map(c => c.student_id)).toEqual(["s2"]);
  });
  it("refuse a mid-term report and an empty checklist, with a plain reason", async () => {
    await expect(compileClassResults(school().sb, T, TERM, CG, { kind: "midterm" })).rejects.toThrow(/one report each term/);
    await expect(compileClassResults(school({ early_years_areas: [] }).sb, T, TERM, CG)).rejects.toThrow(/Preschool settings/);
  });
  it("give the AI the child's strongest areas and a next step, not marks", async () => {
    const { sb, writes } = school();
    await compileClassResults(sb, T, TERM, CG);
    const card = writes.report_cards.find(c => c.student_id === "s1");
    const input = commentInputFor({ ...card, id: "x", status: "draft" }, null, "male", "form_teacher");
    expect(input.average).toBeNull();
    expect(input.position).toBeNull();
    expect(input.strongest[0]).toMatch(/^Literacy/);
    expect(input.strongest.join(" ")).not.toMatch(/\d{2}/);
  });
});
