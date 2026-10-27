/**
 * Entrance exam decisions (phase 14e). Pure functions: the weighted score, pass
 * marks, the merit list against the seats left, and the decision each candidate
 * gets. The dispatch job (entrance-server.ts) applies them and sends the letters.
 */

export type EntrancePlan = {
  test_weight: number; interview_weight: number; report_weight: number;
  pass_mark: number; section_pass_marks: Record<string, number>;
  borderline_band: number;
  /** Who is interviewed: nobody, the borderline (just under the pass mark), everyone who passed, or everyone. */
  interview_for: "none" | "borderline" | "passed" | "everyone";
  /** Waiting list length; 0 = no limit. */
  waitlist_size: number;
};

export type Candidate = {
  id: string;
  status: string;
  /** Entrance test, percent; null until it has been taken and marked. */
  test: number | null;
  /** Percent per question section, e.g. { Mathematics: 62, English: 48 }. */
  sections: Record<string, number>;
  interview: number | null;
  report: number | null;
  created_at: string;
};

export type Decision = "offer" | "interview" | "waitlist" | "regret";
export type Proposal = { id: string; decision: Decision | null; score: number | null; rank: number | null; reason: string; waitlist_position?: number };

/** Decided already: offers out and families who answered, or who left. Waitlisted candidates stay in the ranking. */
export const SETTLED = new Set(["offered", "accepted", "enrolled", "rejected", "withdrawn", "declined", "expired"]);

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The weighted score out of 100. Parts not in yet (an interview still to come) are left
 * out and the remaining weights scaled up, so the score is always on the same 0–100 scale.
 */
export function weightedScore(plan: Pick<EntrancePlan, "test_weight" | "interview_weight" | "report_weight">, c: Pick<Candidate, "test" | "interview" | "report">) {
  if (c.test === null || c.test === undefined) return { score: null as number | null, complete: false };
  const parts = [
    { w: plan.test_weight, v: c.test },
    { w: plan.interview_weight, v: c.interview },
    { w: plan.report_weight, v: c.report }
  ].filter(p => p.w > 0);
  const present = parts.filter(p => p.v !== null && p.v !== undefined);
  const weight = present.reduce((a, p) => a + p.w, 0);
  const score = weight ? r1(present.reduce((a, p) => a + p.w * Number(p.v), 0) / weight) : null;
  return { score, complete: present.length === parts.length };
}

/** Sections below their own pass mark (only sections the candidate was tested on). */
export function failedSections(plan: Pick<EntrancePlan, "section_pass_marks">, sections: Record<string, number>): string[] {
  return Object.entries(plan.section_pass_marks ?? {})
    .filter(([s, min]) => sections[s] !== undefined && sections[s] !== null && Number(sections[s]) < Number(min))
    .map(([s]) => s);
}

/**
 * The merit list and a decision for every candidate whose test is in:
 *  - below the pass mark (or a section pass mark), and not borderline: regret;
 *  - needing an interview that hasn't happened: interview;
 *  - passed: ranked by weighted score (then test score, then who applied first);
 *    the top `seatsLeft` get offers, the next ones the waiting list, the rest regret
 *    once the waiting list is full.
 * Waitlisted candidates are ranked again each time, so a seat freed by a decline or an
 * expired offer goes to the best candidate still waiting.
 */
export function proposeDecisions(plan: EntrancePlan, candidates: Candidate[], seatsLeft: number): Proposal[] {
  const out: Proposal[] = [];
  const passed: { c: Candidate; score: number }[] = [];
  for (const c of candidates) {
    if (SETTLED.has(c.status)) continue;
    const { score } = weightedScore(plan, c);
    if (score === null) { out.push({ id: c.id, decision: null, score: null, rank: null, reason: "Waiting for the entrance test" }); continue; }
    const failed = failedSections(plan, c.sections);
    const pass = score >= plan.pass_mark && failed.length === 0;
    const borderline = !pass && failed.length === 0 && score >= plan.pass_mark - plan.borderline_band;
    const wantsInterview = plan.interview_for === "everyone" || (plan.interview_for === "passed" && pass) || (plan.interview_for === "borderline" && borderline);
    if (wantsInterview && (c.interview === null || c.interview === undefined)) {
      out.push({ id: c.id, decision: "interview", score, rank: null, reason: borderline ? `Just under the pass mark (${score} against ${plan.pass_mark})` : "Interview before a decision" });
      continue;
    }
    if (!pass) {
      out.push({ id: c.id, decision: "regret", score, rank: null,
        reason: failed.length ? `Below the pass mark in ${failed.join(", ")}` : `Below the pass mark (${score} against ${plan.pass_mark})` });
      continue;
    }
    passed.push({ c, score });
  }
  passed.sort((a, b) => b.score - a.score || Number(b.c.test) - Number(a.c.test) || a.c.created_at.localeCompare(b.c.created_at));
  let seats = Math.max(0, Math.floor(seatsLeft));
  let position = 0;
  passed.forEach(({ c, score }, i) => {
    const rank = i + 1;
    if (seats > 0) { seats--; out.push({ id: c.id, decision: "offer", score, rank, reason: `Passed, ${ordinal(rank)} on the merit list` }); return; }
    if (!plan.waitlist_size || position < plan.waitlist_size) {
      position++;
      out.push({ id: c.id, decision: "waitlist", score, rank, waitlist_position: position, reason: `Passed; no seat yet, ${ordinal(position)} on the waiting list` });
      return;
    }
    out.push({ id: c.id, decision: "regret", score, rank, reason: "Passed, but all seats and the waiting list are full" });
  });
  return out;
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Percent per question section from an attempt's marks (questions without a section are left out). */
export function sectionScores(questions: { id: string; section?: string | null }[], marks: Record<string, { points: number | null; max: number }>) {
  const got = new Map<string, { p: number; m: number }>();
  for (const q of questions) {
    const mk = marks[q.id];
    if (!q.section || !mk || mk.points === null || mk.points === undefined) continue;
    const cur = got.get(q.section) ?? { p: 0, m: 0 };
    got.set(q.section, { p: cur.p + Number(mk.points), m: cur.m + Number(mk.max) });
  }
  return Object.fromEntries([...got].filter(([, v]) => v.m > 0).map(([s, v]) => [s, r1((v.p / v.m) * 100)]));
}

/** Candidate PINs for centre computers: 8 characters, no look-alikes (0/O, 1/I/L), shown as XXXX-XXXX. */
export const PIN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function formatPin(pin: string) { return `${pin.slice(0, 4)}-${pin.slice(4)}`; }
export function normalizePin(input: string) { return input.toUpperCase().replace(/[^A-Z0-9]/g, ""); }

export type AnalyticsApp = { status: string; source: string | null; previous_school: string | null; test: number | null; absent: boolean; proposed: Decision | null };

/**
 * Entrance analytics for an intake: how many sat, passed and joined; the spread of test
 * scores; how each feeder school and each source did; and the hardest questions.
 */
export function entranceAnalytics(apps: AnalyticsApp[], marks: Record<string, { points: number | null; max: number }>[], questions: { id: string; prompt: string }[], passMark: number) {
  const tested = apps.filter(a => a.test !== null);
  const joined = (a: AnalyticsApp) => ["accepted", "enrolled"].includes(a.status);
  const offered = (a: AnalyticsApp) => ["offered", "accepted", "enrolled"].includes(a.status);
  const avg = (xs: number[]) => xs.length ? r1(xs.reduce((s, x) => s + x, 0) / xs.length) : null;
  const group = (key: (a: AnalyticsApp) => string) => {
    const m = new Map<string, { label: string; n: number; scores: number[]; offered: number; joined: number }>();
    for (const a of apps) {
      const label = key(a), k = label.toLowerCase();
      const g = m.get(k) ?? { label, n: 0, scores: [], offered: 0, joined: 0 };
      g.n++; if (a.test !== null) g.scores.push(a.test); if (offered(a)) g.offered++; if (joined(a)) g.joined++;
      m.set(k, g);
    }
    return [...m.values()].map(g => ({ label: g.label, applicants: g.n, average: avg(g.scores), offered: g.offered, joined: g.joined }))
      .sort((x, y) => y.applicants - x.applicants || x.label.localeCompare(y.label));
  };
  const spread = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i === 9 ? 100 : i * 10 + 9, count: tested.filter(a => Math.min(9, Math.floor(Number(a.test) / 10)) === i).length }));
  const difficulty = questions.map(q => {
    let got = 0, max = 0, answered = 0;
    for (const m of marks) { const k = m[q.id]; if (!k || k.points === null || k.points === undefined) continue; got += Number(k.points); max += Number(k.max); answered++; }
    return { id: q.id, prompt: q.prompt.length > 90 ? `${q.prompt.slice(0, 87)}…` : q.prompt, answered, percent: max ? r1((got / max) * 100) : null };
  }).filter(q => q.answered > 0).sort((a, b) => Number(a.percent) - Number(b.percent));
  return {
    applicants: apps.length, tested: tested.length, absent: apps.filter(a => a.absent).length,
    passed: tested.filter(a => Number(a.test) >= passMark).length, offered: apps.filter(offered).length, joined: apps.filter(joined).length,
    average: avg(tested.map(a => Number(a.test))), spread,
    feeder_schools: group(a => (a.previous_school ?? "").trim() || "Not given"),
    sources: group(a => (a.source ?? "").replace(/_/g, " ") || "other"),
    hardest: difficulty.slice(0, 10), easiest: difficulty.slice(-5).reverse()
  };
}

/** Weights must add up to 100 and the test must count. */
export function weightsValid(p: Pick<EntrancePlan, "test_weight" | "interview_weight" | "report_weight">) {
  return p.test_weight > 0 && p.test_weight + p.interview_weight + p.report_weight === 100;
}
