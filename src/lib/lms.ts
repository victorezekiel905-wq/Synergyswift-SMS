/**
 * Learning management rules: late penalties, resubmission, originality,
 * streaks and badges, scheme-of-work coverage, forum language. Pure, unit tested.
 */

// ---------------- assignments ----------------

/** Whole or part days late (any time after the deadline counts as a day). */
export function daysLate(dueAt: string, submittedAt: string): number {
  const ms = Date.parse(submittedAt) - Date.parse(dueAt);
  return ms <= 0 ? 0 : Math.ceil(ms / 86400_000);
}

export function latePenalty(p: { dueAt: string; submittedAt: string; pctPerDay: number; maxPct: number }): { days: number; pct: number } {
  const days = daysLate(p.dueAt, p.submittedAt);
  return { days, pct: Math.min(Math.max(0, p.maxPct), Math.max(0, p.pctPerDay) * days) };
}

/** The mark after the late penalty, rounded to one decimal place. */
export function penalisedScore(raw: number | null, penaltyPct: number): number | null {
  if (raw === null || raw === undefined) return null;
  return Math.round(raw * (1 - penaltyPct / 100) * 10) / 10;
}

export type SubmitCheck = { ok: true; attempt: number } | { ok: false; reason: string };
/** Whether a student may (re)submit now. */
export function canSubmit(hw: { due_at: string; allow_late: boolean; allow_resubmit: boolean; max_attempts: number },
  sub: { attempt: number; status: string } | null, now = new Date()): SubmitCheck {
  const late = now.getTime() > Date.parse(hw.due_at);
  if (!sub) return late && !hw.allow_late ? { ok: false, reason: "the deadline has passed" } : { ok: true, attempt: 1 };
  if (sub.status === "returned") {
    // A teacher sent it back: the student may always try again within the attempt limit.
    return sub.attempt < hw.max_attempts ? { ok: true, attempt: sub.attempt + 1 } : { ok: false, reason: "no attempts left" };
  }
  if (sub.status === "marked") return { ok: false, reason: "this homework has already been marked" };
  if (!hw.allow_resubmit) return { ok: false, reason: "you have already handed this in" };
  if (late && !hw.allow_late) return { ok: false, reason: "the deadline has passed" };
  return sub.attempt < hw.max_attempts ? { ok: true, attempt: sub.attempt + 1 } : { ok: false, reason: "no attempts left" };
}

// ---------------- originality ----------------

export function words(text: string): string[] {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
}

/** Sets of n-word phrases ("shingles"). */
export function shingles(text: string, n = 5): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

/**
 * How much of `a` also appears in `b` (share of a's 5-word phrases found in b),
 * and the longest shared passages. Short answers are not compared.
 */
export function overlap(a: string, b: string, n = 5): { share: number; passages: string[] } {
  const wa = words(a);
  if (wa.length < 25) return { share: 0, passages: [] };
  const sb = shingles(b, n);
  if (!sb.size) return { share: 0, passages: [] };
  const hits: boolean[] = [];
  for (let i = 0; i + n <= wa.length; i++) hits.push(sb.has(wa.slice(i, i + n).join(" ")));
  const share = hits.length ? hits.filter(Boolean).length / hits.length : 0;
  // Join neighbouring hits into passages.
  const passages: string[] = [];
  let start = -1;
  for (let i = 0; i <= hits.length; i++) {
    if (i < hits.length && hits[i]) { if (start < 0) start = i; }
    else if (start >= 0) { passages.push(wa.slice(start, i - 1 + n).join(" ")); start = -1; }
  }
  return { share: Math.round(share * 1000) / 1000, passages: passages.sort((x, y) => y.length - x.length).slice(0, 3) };
}

export type StyleProfile = { words: number; sentence_len: number; word_len: number; variety: number; long_words: number };
/** A few measurable habits of a writer. */
export function styleProfile(text: string): StyleProfile {
  const w = words(text);
  const sentences = text.split(/[.!?]+(?:\s|$)/).map(s => s.trim()).filter(s => words(s).length > 0);
  const sample = w.slice(0, 400);
  return {
    words: w.length,
    sentence_len: sentences.length ? Math.round((w.length / sentences.length) * 10) / 10 : 0,
    word_len: w.length ? Math.round((w.reduce((a, x) => a + x.length, 0) / w.length) * 100) / 100 : 0,
    variety: sample.length ? Math.round((new Set(sample).size / sample.length) * 100) / 100 : 0,
    long_words: w.length ? Math.round((w.filter(x => x.length >= 9).length / w.length) * 1000) / 1000 : 0
  };
}

/**
 * How far this piece's style is from the student's own earlier work, 0 (same
 * habits) to 1 (very different). Needs at least two earlier pieces of 80+ words.
 * A sudden change is a reason to talk to the student, never proof of anything.
 */
export function styleShift(current: string, earlier: string[]): { score: number; notes: string[] } | null {
  const prev = earlier.map(styleProfile).filter(p => p.words >= 80);
  const cur = styleProfile(current);
  if (prev.length < 2 || cur.words < 80) return null;
  const mean = (k: keyof StyleProfile) => prev.reduce((a, p) => a + p[k], 0) / prev.length;
  const notes: string[] = [];
  const parts: number[] = [];
  const cmp = (k: keyof StyleProfile, label: string, scale: number) => {
    const m = mean(k);
    if (!m) return;
    const rel = Math.abs(cur[k] - m) / m;
    parts.push(Math.min(1, rel / scale));
    if (rel >= scale) notes.push(`${label} ${cur[k] > m ? "much higher" : "much lower"} than usual (${cur[k]} vs about ${Math.round(m * 100) / 100})`);
  };
  cmp("sentence_len", "Sentence length", 0.6);
  cmp("word_len", "Word length", 0.2);
  cmp("variety", "Vocabulary variety", 0.3);
  cmp("long_words", "Share of long words", 0.8);
  return { score: Math.round((parts.reduce((a, x) => a + x, 0) / Math.max(1, parts.length)) * 100) / 100, notes };
}

// ---------------- streaks, points, badges ----------------

export const POINTS: Record<string, number> = { homework: 10, practice: 5, content: 5, path_step: 8, forum: 2, lesson: 3, exam: 10, tutor: 1 };

const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
/** Consecutive school days (Monday to Friday) with learning activity, counting back from today or the last school day. */
export function streak(dates: string[], today = new Date().toISOString().slice(0, 10)): number {
  const have = new Set(dates);
  const d = new Date(`${today}T12:00:00Z`);
  // Today does not break a streak before the student has done anything today.
  if (!have.has(today)) d.setUTCDate(d.getUTCDate() - 1);
  let n = 0;
  for (let i = 0; i < 400; i++) {
    if (isWeekend(d)) { d.setUTCDate(d.getUTCDate() - 1); continue; }
    const key = d.toISOString().slice(0, 10);
    if (!have.has(key)) break;
    n++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return n;
}

export type BadgeRule = { type: "streak" | "points" | "homework" | "practice" | "forum"; threshold: number };
export type LearnerStats = { streak: number; points: number; homework: number; practice: number; forum: number };
export function earns(rule: BadgeRule | null | undefined, s: LearnerStats): boolean {
  if (!rule || !(rule.threshold > 0)) return false;
  return (s[rule.type] ?? 0) >= rule.threshold;
}
export function statsFrom(activity: { kind: string; points: number; on_date: string }[], today?: string): LearnerStats {
  const count = (k: string) => activity.filter(a => a.kind === k).length;
  return { streak: streak(activity.map(a => a.on_date), today), points: activity.reduce((a, x) => a + x.points, 0), homework: count("homework"), practice: count("practice"), forum: count("forum") };
}

export const STARTER_BADGES: { name: string; emoji: string; description: string; rule: BadgeRule | null }[] = [
  { name: "On a roll", emoji: "🔥", description: "Learned something five school days in a row", rule: { type: "streak", threshold: 5 } },
  { name: "Unstoppable", emoji: "⚡", description: "A twenty-day learning streak", rule: { type: "streak", threshold: 20 } },
  { name: "Homework hero", emoji: "📚", description: "Handed in 20 pieces of homework", rule: { type: "homework", threshold: 20 } },
  { name: "Practice makes perfect", emoji: "🎯", description: "Finished 25 practice sessions", rule: { type: "practice", threshold: 25 } },
  { name: "Helpful voice", emoji: "💬", description: "Posted 15 times in class discussions", rule: { type: "forum", threshold: 15 } },
  { name: "Century", emoji: "💯", description: "Earned 100 learning points", rule: { type: "points", threshold: 100 } },
  { name: "Star of the week", emoji: "⭐", description: "Chosen by a teacher", rule: null }
];

// ---------------- schemes of work ----------------

/** For each objective: how many weeks plan it, and whether one has been taught. */
export function objectiveCoverage(objectiveIds: string[], weeks: { objective_ids: string[]; status: string }[]) {
  const out = objectiveIds.map(id => {
    const ws = weeks.filter(w => w.objective_ids.includes(id));
    return { id, planned: ws.length, taught: ws.some(w => w.status === "taught") };
  });
  return { items: out, planned: out.filter(o => o.planned > 0).length, taught: out.filter(o => o.taught).length, total: out.length };
}

// ---------------- forums ----------------

// Words students may not post. Kept short and obvious; staff moderate everything else.
const BLOCKED = ["fuck", "shit", "bitch", "bastard", "cunt", "dick", "pussy", "asshole", "nigger", "faggot", "whore", "slut", "motherfucker", "olodo", "mumu", "ashawo", "werey"];
export function languageProblem(text: string): string | null {
  const w = new Set(words(text));
  const hit = BLOCKED.find(b => w.has(b) || text.toLowerCase().includes(b + "ing"));
  return hit ? "please keep the discussion respectful" : null;
}
