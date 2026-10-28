/**
 * Ready-made assessment patterns a school can start from in School setup →
 * Grading. Every part stays editable: the school sets its own tests, CA, CAT,
 * projects and exams, with its own marks, weights and grade bands.
 */
type Band = { grade: string; min_score: number; max_score: number; remark: string | null; grade_point: number | null };
type Part = { name: string; max_score: number; weight: number; midterm?: boolean };
export type GradingPreset = { id: string; name: string; hint: string; template: "nigerian" | "british" | "american"; pass_mark: number; parts: Part[]; bands: Band[] };

const band = (grade: string, min: number, max: number, remark: string | null, gp: number | null = null): Band => ({ grade, min_score: min, max_score: max, remark, grade_point: gp });

export const GRADING_PRESETS: GradingPreset[] = [
  { id: "ng-secondary", name: "Nigeria secondary (A1–F9)", hint: "Two CAs and a test (40) plus the exam (60), graded like WAEC.", template: "nigerian", pass_mark: 40,
    parts: [{ name: "CA 1", max_score: 10, weight: 10, midterm: true }, { name: "CA 2", max_score: 10, weight: 10 }, { name: "Test", max_score: 20, weight: 20, midterm: true }, { name: "Exam", max_score: 60, weight: 60 }],
    bands: [band("A1", 75, 100, "Excellent", 1), band("B2", 70, 74.99, "Very good", 2), band("B3", 65, 69.99, "Good", 3), band("C4", 60, 64.99, "Credit", 4), band("C5", 55, 59.99, "Credit", 5),
      band("C6", 50, 54.99, "Credit", 6), band("D7", 45, 49.99, "Pass", 7), band("E8", 40, 44.99, "Pass", 8), band("F9", 0, 39.99, "Fail", 9)] },
  { id: "ng-primary", name: "Nigeria primary (A–F)", hint: "Continuous assessment (40) and the exam (60).", template: "nigerian", pass_mark: 40,
    parts: [{ name: "CA 1", max_score: 20, weight: 20, midterm: true }, { name: "CA 2", max_score: 20, weight: 20 }, { name: "Exam", max_score: 60, weight: 60 }],
    bands: [band("A", 70, 100, "Excellent"), band("B", 60, 69.99, "Very good"), band("C", 50, 59.99, "Good"), band("D", 45, 49.99, "Fair"), band("E", 40, 44.99, "Poor"), band("F", 0, 39.99, "Fail")] },
  { id: "cat-exam", name: "CAT and exam", hint: "Two continuous assessment tests (30) and the end-of-term exam (70).", template: "nigerian", pass_mark: 40,
    parts: [{ name: "CAT 1", max_score: 15, weight: 15, midterm: true }, { name: "CAT 2", max_score: 15, weight: 15 }, { name: "Exam", max_score: 70, weight: 70 }],
    bands: [band("A", 80, 100, "Excellent"), band("B", 65, 79.99, "Very good"), band("C", 50, 64.99, "Good"), band("D", 40, 49.99, "Pass"), band("E", 0, 39.99, "Fail")] },
  { id: "uk-gcse", name: "British (GCSE 9–1)", hint: "Coursework (40) and the exam (60), graded 9 to 1.", template: "british", pass_mark: 40,
    parts: [{ name: "Coursework", max_score: 40, weight: 40, midterm: true }, { name: "Exam", max_score: 60, weight: 60 }],
    bands: [band("9", 90, 100, "Exceptional"), band("8", 80, 89.99, "Excellent"), band("7", 70, 79.99, "Strong"), band("6", 60, 69.99, "Good"), band("5", 50, 59.99, "Strong pass"),
      band("4", 40, 49.99, "Standard pass"), band("3", 30, 39.99, "Below pass"), band("2", 20, 29.99, "Weak"), band("1", 10, 19.99, "Very weak"), band("U", 0, 9.99, "Ungraded")] },
  { id: "us-gpa", name: "American (A–F, GPA 4.0)", hint: "Homework, quizzes, tests, projects and a final exam, with grade points.", template: "american", pass_mark: 65,
    parts: [{ name: "Homework", max_score: 10, weight: 10 }, { name: "Quizzes", max_score: 15, weight: 15, midterm: true }, { name: "Tests", max_score: 25, weight: 25, midterm: true }, { name: "Projects", max_score: 10, weight: 10 }, { name: "Final exam", max_score: 40, weight: 40 }],
    bands: [band("A", 93, 100, "Excellent", 4), band("A-", 90, 92.99, "Excellent", 3.7), band("B+", 87, 89.99, "Very good", 3.3), band("B", 83, 86.99, "Good", 3), band("B-", 80, 82.99, "Good", 2.7),
      band("C+", 77, 79.99, "Satisfactory", 2.3), band("C", 73, 76.99, "Satisfactory", 2), band("C-", 70, 72.99, "Satisfactory", 1.7), band("D+", 67, 69.99, "Passing", 1.3), band("D", 65, 66.99, "Passing", 1), band("F", 0, 64.99, "Failing", 0)] }
];

/** Parts must add up to 100 and the bands must cover 0 to 100 without gaps or overlaps. */
export function checkPreset(p: GradingPreset): string[] {
  const issues: string[] = [];
  const total = p.parts.reduce((n, x) => n + x.weight, 0);
  if (Math.abs(total - 100) > 0.001) issues.push(`${p.id}: parts add up to ${total}`);
  const b = [...p.bands].sort((x, y) => x.min_score - y.min_score);
  if (b[0].min_score !== 0) issues.push(`${p.id}: bands start at ${b[0].min_score}`);
  if (b[b.length - 1].max_score !== 100) issues.push(`${p.id}: bands end at ${b[b.length - 1].max_score}`);
  for (let i = 1; i < b.length; i++) if (Math.abs(b[i].min_score - b[i - 1].max_score - 0.01) > 0.001) issues.push(`${p.id}: gap or overlap before ${b[i].grade}`);
  return issues;
}
