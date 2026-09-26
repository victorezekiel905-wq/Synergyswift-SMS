/**
 * Early-warning risk score (0–100) with the reasons behind it, so staff can
 * act on something concrete. Pure and unit-tested.
 *
 * Factor                      Max points
 * Attendance below 90%            30
 * Average near or below pass      25
 * Average falling vs last term    15
 * Failing subjects                15
 * Negative behaviour (30 days)    10
 * Missing homework (30 days)       5
 */
export type RiskInput = {
  attendanceRate: number | null;       // 0–1 over recent school days
  average: number | null;              // current term average (0–100)
  previousAverage: number | null;      // last term average
  failingSubjects: number;
  passMark: number;
  negativePoints: number;              // absolute value of negative behaviour points
  missingHomework: number;
};

export type RiskFactor = { factor: string; points: number; detail: string };
export type Risk = { score: number; level: "low" | "medium" | "high"; factors: RiskFactor[] };

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function riskScore(i: RiskInput): Risk {
  const factors: RiskFactor[] = [];
  if (i.attendanceRate !== null && i.attendanceRate < 0.9) {
    const pts = Math.round(clamp((0.9 - i.attendanceRate) / 0.3, 0, 1) * 30);
    if (pts) factors.push({ factor: "attendance", points: pts, detail: `Attendance ${Math.round(i.attendanceRate * 100)}%` });
  }
  if (i.average !== null && i.average < i.passMark + 10) {
    const pts = Math.round(clamp((i.passMark + 10 - i.average) / 25, 0, 1) * 25);
    if (pts) factors.push({ factor: "low_average", points: pts, detail: `Average ${i.average}% (pass mark ${i.passMark}%)` });
  }
  if (i.average !== null && i.previousAverage !== null && i.previousAverage - i.average >= 5) {
    const drop = i.previousAverage - i.average;
    const pts = Math.round(clamp(drop / 20, 0, 1) * 15);
    if (pts) factors.push({ factor: "falling", points: pts, detail: `Down ${Math.round(drop * 10) / 10} points from last term` });
  }
  if (i.failingSubjects > 0) factors.push({ factor: "failing_subjects", points: Math.min(15, i.failingSubjects * 5), detail: `${i.failingSubjects} subject${i.failingSubjects === 1 ? "" : "s"} below pass mark` });
  if (i.negativePoints > 0) factors.push({ factor: "behaviour", points: Math.min(10, Math.round(i.negativePoints)), detail: `${i.negativePoints} negative behaviour points in 30 days` });
  if (i.missingHomework > 0) factors.push({ factor: "homework", points: Math.min(5, Math.ceil(i.missingHomework * 1.5)), detail: `${i.missingHomework} homework not submitted` });
  const score = clamp(factors.reduce((a, f) => a + f.points, 0), 0, 100);
  return { score, level: score >= 50 ? "high" : score >= 25 ? "medium" : "low", factors: factors.sort((a, b) => b.points - a.points) };
}
