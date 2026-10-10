/**
 * Item analysis for a sat exam. Pure functions, unit tested.
 *
 *  - Difficulty (p): mean fraction of the marks earned on the item (0 = nobody
 *    got it, 1 = everybody did). Ideal range is roughly 0.3–0.9.
 *  - Discrimination (D): p in the top 27% of the class minus p in the bottom
 *    27%, ranked by overall percentage. Below 0.2 is weak; below 0 usually
 *    means the answer key is wrong or the question is ambiguous.
 *  - Point-biserial: correlation between the item score and the rest of the
 *    paper (the item itself excluded).
 *  - Distractors: how often each option was chosen, split by top and bottom
 *    group. A wrong option that attracts the top group is worth a look.
 *  - Reliability: Cronbach's alpha (KR-20 for right/wrong items) over students
 *    who were given every item (pools are skipped).
 */
import type { Question } from "./engine";

export type AnalysisAttempt = {
  id: string;
  marks: Record<string, { points: number | null; max: number }>;
  answers: Record<string, unknown>;
  question_order?: string[] | null;
};

export type ItemStats = {
  question_id: string; position: number; type: string; topic: string | null; bloom: string | null; difficulty_tag: string | null;
  n: number; p: number | null; discrimination: number | null; point_biserial: number | null;
  distractors: { option_id: string; text: string; correct: boolean; count: number; upper: number; lower: number }[] | null;
  common_wrong: { answer: string; count: number }[] | null;
  flags: string[];
};

export type ExamAnalysis = {
  students: number; mean: number | null; median: number | null; sd: number | null; highest: number | null; lowest: number | null;
  reliability: number | null; reliability_note: string | null;
  items: ItemStats[];
  by_topic: { topic: string; items: number; p: number }[];
  by_bloom: { bloom: string; items: number; p: number }[];
  distribution: { band: string; count: number }[];
};

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r3 = (n: number) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);
const r1 = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

function variance(xs: number[]) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
}

function correlation(xs: number[], ys: number[]) {
  if (xs.length < 3) return NaN;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

const normAnswer = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 80);

export function analyseExam(questions: (Question & { topic?: string | null; bloom?: string | null; difficulty?: string | null })[], attempts: AnalysisAttempt[]): ExamAnalysis {
  // Item fraction per student, only for questions the student was given and that are marked.
  const given = (a: AnalysisAttempt, qid: string) => !a.question_order?.length || a.question_order.includes(qid);
  const frac = (a: AnalysisAttempt, qid: string): number | null => {
    const m = a.marks?.[qid];
    if (!given(a, qid) || !m || m.points === null || m.points === undefined || !m.max) return null;
    return Math.max(0, Math.min(1, Number(m.points) / Number(m.max)));
  };
  const pct = new Map<string, number>();
  for (const a of attempts) {
    let got = 0, max = 0;
    for (const q of questions) {
      const m = a.marks?.[q.id];
      if (!given(a, q.id) || !m || m.points === null || m.points === undefined) continue;
      got += Number(m.points); max += Number(m.max);
    }
    if (max > 0) pct.set(a.id, (got / max) * 100);
  }
  const scored = attempts.filter(a => pct.has(a.id)).sort((x, y) => pct.get(y.id)! - pct.get(x.id)!);
  const k = Math.max(1, Math.round(scored.length * 0.27));
  const upper = new Set(scored.slice(0, k).map(a => a.id));
  const lower = new Set(scored.slice(-k).map(a => a.id));
  const groupsUsable = scored.length >= 6;

  const items: ItemStats[] = questions.map((q, idx) => {
    const rows = scored.map(a => ({ a, f: frac(a, q.id) })).filter((r): r is { a: AnalysisAttempt; f: number } => r.f !== null);
    const p = mean(rows.map(r => r.f));
    const pu = mean(rows.filter(r => upper.has(r.a.id)).map(r => r.f));
    const pl = mean(rows.filter(r => lower.has(r.a.id)).map(r => r.f));
    const D = groupsUsable ? pu - pl : NaN;
    // Rest-of-paper score: overall percentage with this item's contribution removed.
    const rest = rows.map(r => {
      const m = r.a.marks[q.id];
      let got = 0, max = 0;
      for (const qq of questions) {
        const mm = r.a.marks?.[qq.id];
        if (qq.id === q.id || !given(r.a, qq.id) || !mm || mm.points === null || mm.points === undefined) continue;
        got += Number(mm.points); max += Number(mm.max);
      }
      return { f: r.f, rest: max ? got / max : 0, m };
    });
    const pb = correlation(rest.map(x => x.f), rest.map(x => x.rest));

    let distractors: ItemStats["distractors"] = null;
    if (q.type === "mcq_single" || q.type === "true_false") {
      const options: { id: string; text: string }[] = q.type === "true_false"
        ? [{ id: "true", text: "True" }, { id: "false", text: "False" }]
        : (q.data?.options ?? []);
      const correct = q.type === "true_false" ? String(Boolean(q.answer?.correct)) : q.answer?.correct;
      distractors = [...options, { id: "", text: "(no answer)" }].map(o => {
        const chose = (a: AnalysisAttempt) => {
          const v = a.answers?.[q.id];
          const s = v === undefined || v === null || v === "" ? "" : String(v);
          return s === o.id;
        };
        const who = rows.map(r => r.a).filter(chose);
        return { option_id: o.id, text: o.text, correct: o.id === correct, count: who.length, upper: who.filter(a => upper.has(a.id)).length, lower: who.filter(a => lower.has(a.id)).length };
      }).filter(d => d.option_id !== "" || d.count > 0);
    }
    let common_wrong: ItemStats["common_wrong"] = null;
    if (["short_answer", "numeric", "math"].includes(q.type)) {
      const counts = new Map<string, number>();
      for (const r of rows) if (r.f < 1) { const s = normAnswer(r.a.answers?.[q.id]); if (s) counts.set(s, (counts.get(s) ?? 0) + 1); }
      common_wrong = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([answer, count]) => ({ answer, count }));
    }

    const flags: string[] = [];
    if (rows.length >= 5) {
      if (p < 0.3) flags.push("very hard");
      if (p > 0.9) flags.push("very easy");
    }
    if (Number.isFinite(D)) {
      if (D < 0) flags.push("negative discrimination: check the answer key");
      else if (D < 0.2) flags.push("weak discrimination");
    }
    if (distractors) {
      for (const d of distractors) {
        if (!d.correct && d.option_id && groupsUsable && d.upper > d.lower && d.upper >= 2) flags.push(`option "${d.text}" attracts strong students`);
        if (!d.correct && d.option_id && rows.length >= 10 && d.count === 0) flags.push(`option "${d.text}" is never chosen`);
      }
    }
    return {
      question_id: q.id, position: idx + 1, type: q.type, topic: q.topic ?? null, bloom: q.bloom ?? null, difficulty_tag: q.difficulty ?? null,
      n: rows.length, p: r3(p), discrimination: r3(D), point_biserial: r3(pb), distractors, common_wrong, flags
    };
  });

  // Reliability over students who were given every item (Cronbach's alpha; equals KR-20 for 0/1 items).
  let reliability: number | null = null, reliability_note: string | null = null;
  const full = scored.filter(a => questions.every(q => frac(a, q.id) !== null));
  if (questions.length < 2) reliability_note = "Needs at least two questions.";
  else if (full.length < 5) reliability_note = full.length < scored.length ? "Not available: students sat different questions (pools) or marking is unfinished." : "Needs at least five complete submissions.";
  else {
    const itemVars = questions.map(q => variance(full.map(a => frac(a, q.id)! * Number(q.points))));
    const totals = full.map(a => questions.reduce((s, q) => s + frac(a, q.id)! * Number(q.points), 0));
    const tv = variance(totals);
    const kq = questions.length;
    reliability = tv > 0 ? r3((kq / (kq - 1)) * (1 - itemVars.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) / tv)) : null;
  }

  const scores = scored.map(a => pct.get(a.id)!).sort((a, b) => a - b);
  const median = scores.length ? (scores.length % 2 ? scores[(scores.length - 1) / 2] : (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2) : NaN;
  const group = (key: "topic" | "bloom") => {
    const m = new Map<string, number[]>();
    for (const it of items) { const k2 = it[key]; if (k2 && it.p !== null) m.set(k2, [...(m.get(k2) ?? []), it.p]); }
    return [...m].map(([name, ps]) => ({ name, items: ps.length, p: r3(mean(ps))! })).sort((a, b) => a.p - b.p);
  };
  const bands = ["0–39", "40–49", "50–59", "60–69", "70–79", "80–100"];
  const bandOf = (s: number) => (s < 40 ? 0 : s < 50 ? 1 : s < 60 ? 2 : s < 70 ? 3 : s < 80 ? 4 : 5);
  const distribution = bands.map((band, i) => ({ band, count: scores.filter(s => bandOf(s) === i).length }));

  return {
    students: scored.length, mean: r1(mean(scores)), median: r1(median), sd: r1(Math.sqrt(variance(scores))),
    highest: scores.length ? r1(scores[scores.length - 1]) : null, lowest: scores.length ? r1(scores[0]) : null,
    reliability, reliability_note, items,
    by_topic: group("topic").map(g => ({ topic: g.name, items: g.items, p: g.p })),
    by_bloom: group("bloom").map(g => ({ bloom: g.name, items: g.items, p: g.p })),
    distribution
  };
}
