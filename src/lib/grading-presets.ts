/**
 * Ready-made assessment patterns a school can start from in Results → Grading
 * systems. Every part stays editable: the school sets its own tests, CA, CAT,
 * projects and exams, with its own marks, weights and grade bands. Preschool has
 * no marks; it uses the early-years checklist (src/lib/early-years.ts).
 */
type Band = { grade: string; min_score: number; max_score: number; remark: string | null; grade_point: number | null };
type Part = { name: string; max_score: number; weight: number; midterm?: boolean };
export type SchoolStage = "preschool" | "primary" | "secondary" | "sixth_form";
export type GradingPreset = { id: string; name: string; hint: string; template: "nigerian" | "british" | "american"; pass_mark: number; parts: Part[]; bands: Band[]; stages: SchoolStage[] };

export const STAGES: { id: SchoolStage; label: string; hint: string }[] = [
  { id: "preschool", label: "Preschool", hint: "Nursery, Reception, Kindergarten" },
  { id: "primary", label: "Primary", hint: "Primary 1–6, Years 1–6, Grades 1–5" },
  { id: "secondary", label: "Secondary", hint: "JSS and SS, Years 7–11, IGCSE" },
  { id: "sixth_form", label: "Sixth form", hint: "A Level, Years 12–13" }
];

const KIND_STAGE: Record<string, SchoolStage> = { nursery: "preschool", primary: "primary", secondary: "secondary", sixth_form: "sixth_form" };

/** Which stage a class belongs to: its section first, then what its name says. */
export function classStage(name: string, sectionKind?: string | null): SchoolStage | null {
  if (sectionKind && KIND_STAGE[sectionKind]) return KIND_STAGE[sectionKind];
  const n = name.toLowerCase();
  if (/nursery|reception|kindergarten|\bkg\b|pre-?k|creche|crèche|playgroup|pre-?school|toddler|\beyfs\b/.test(n)) return "preschool";
  if (/sixth|a ?level|year 1[23]\b|\bas\b|\ba2\b/.test(n)) return "sixth_form";
  if (/\bjss|\bss ?[1-3]\b|\bsss|year ([7-9]|1[01])\b|grade ([6-9]|1[0-2])\b|igcse|gcse|secondary|stage [7-9]\b/.test(n)) return "secondary";
  if (/primary|basic [1-6]\b|year [1-6]\b|grade [1-5]\b|\bp ?[1-6]\b|stage [1-6]\b/.test(n)) return "primary";
  return null;
}

const band = (grade: string, min: number, max: number, remark: string | null, gp: number | null = null): Band => ({ grade, min_score: min, max_score: max, remark, grade_point: gp });

export const GRADING_PRESETS: GradingPreset[] = [
  { id: "ng-secondary", stages: ["secondary", "sixth_form"], name: "Nigeria secondary (A1–F9)", hint: "Two CAs and a test (40) plus the exam (60), graded like WAEC.", template: "nigerian", pass_mark: 40,
    parts: [{ name: "CA 1", max_score: 10, weight: 10, midterm: true }, { name: "CA 2", max_score: 10, weight: 10 }, { name: "Test", max_score: 20, weight: 20, midterm: true }, { name: "Exam", max_score: 60, weight: 60 }],
    bands: [band("A1", 75, 100, "Excellent", 1), band("B2", 70, 74.99, "Very good", 2), band("B3", 65, 69.99, "Good", 3), band("C4", 60, 64.99, "Credit", 4), band("C5", 55, 59.99, "Credit", 5),
      band("C6", 50, 54.99, "Credit", 6), band("D7", 45, 49.99, "Pass", 7), band("E8", 40, 44.99, "Pass", 8), band("F9", 0, 39.99, "Fail", 9)] },
  { id: "ng-primary", stages: ["primary", "secondary"], name: "Nigeria primary and JSS (A–F)", hint: "Continuous assessment (40) and the exam (60).", template: "nigerian", pass_mark: 40,
    parts: [{ name: "CA 1", max_score: 20, weight: 20, midterm: true }, { name: "CA 2", max_score: 20, weight: 20 }, { name: "Exam", max_score: 60, weight: 60 }],
    bands: [band("A", 70, 100, "Excellent"), band("B", 60, 69.99, "Very good"), band("C", 50, 59.99, "Good"), band("D", 45, 49.99, "Fair"), band("E", 40, 44.99, "Poor"), band("F", 0, 39.99, "Fail")] },
  { id: "cat-exam", stages: ["primary", "secondary", "sixth_form"], name: "CAT and exam", hint: "Two continuous assessment tests (30) and the end-of-term exam (70).", template: "nigerian", pass_mark: 40,
    parts: [{ name: "CAT 1", max_score: 15, weight: 15, midterm: true }, { name: "CAT 2", max_score: 15, weight: 15 }, { name: "Exam", max_score: 70, weight: 70 }],
    bands: [band("A", 80, 100, "Excellent"), band("B", 65, 79.99, "Very good"), band("C", 50, 64.99, "Good"), band("D", 40, 49.99, "Pass"), band("E", 0, 39.99, "Fail")] },
  { id: "uk-ks", stages: ["primary", "secondary"], name: "British Key Stages 1–3", hint: "Classwork (40) and assessments (60), reported as working towards, expected or greater depth.", template: "british", pass_mark: 60,
    parts: [{ name: "Classwork", max_score: 40, weight: 40, midterm: true }, { name: "Assessment", max_score: 60, weight: 60 }],
    bands: [band("Greater depth", 85, 100, "Working at greater depth"), band("Expected", 60, 84.99, "Working at the expected standard"),
      band("Working towards", 40, 59.99, "Working towards the expected standard"), band("Below", 0, 39.99, "Working below the expected standard")] },
  { id: "igcse", stages: ["secondary"], name: "Cambridge IGCSE (A*–G)", hint: "Coursework (30) and the exam (70), graded A* to G.", template: "british", pass_mark: 60,
    parts: [{ name: "Coursework", max_score: 30, weight: 30, midterm: true }, { name: "Exam", max_score: 70, weight: 70 }],
    bands: [band("A*", 90, 100, "Outstanding"), band("A", 80, 89.99, "Excellent"), band("B", 70, 79.99, "Very good"), band("C", 60, 69.99, "Good"), band("D", 50, 59.99, "Satisfactory"),
      band("E", 40, 49.99, "Weak"), band("F", 30, 39.99, "Poor"), band("G", 20, 29.99, "Very poor"), band("U", 0, 19.99, "Ungraded")] },
  { id: "a-level", stages: ["sixth_form"], name: "AS & A Level (A*–E)", hint: "Coursework (20) and the exam (80), graded A* to E.", template: "british", pass_mark: 40,
    parts: [{ name: "Coursework", max_score: 20, weight: 20, midterm: true }, { name: "Exam", max_score: 80, weight: 80 }],
    bands: [band("A*", 90, 100, "Outstanding"), band("A", 80, 89.99, "Excellent"), band("B", 70, 79.99, "Very good"), band("C", 60, 69.99, "Good"), band("D", 50, 59.99, "Satisfactory"),
      band("E", 40, 49.99, "Pass"), band("U", 0, 39.99, "Ungraded")] },
  { id: "us-elementary", stages: ["primary"], name: "American elementary (1–4)", hint: "Classwork and assessments, reported 4 (exceeds) to 1 (beginning).", template: "american", pass_mark: 50,
    parts: [{ name: "Classwork", max_score: 50, weight: 50, midterm: true }, { name: "Assessments", max_score: 50, weight: 50 }],
    bands: [band("4", 85, 100, "Exceeds the standard"), band("3", 70, 84.99, "Meets the standard"), band("2", 50, 69.99, "Approaching the standard"), band("1", 0, 49.99, "Beginning")] },
  { id: "uk-gcse", stages: ["secondary"], name: "British (GCSE 9–1)", hint: "Coursework (40) and the exam (60), graded 9 to 1.", template: "british", pass_mark: 40,
    parts: [{ name: "Coursework", max_score: 40, weight: 40, midterm: true }, { name: "Exam", max_score: 60, weight: 60 }],
    bands: [band("9", 90, 100, "Exceptional"), band("8", 80, 89.99, "Excellent"), band("7", 70, 79.99, "Strong"), band("6", 60, 69.99, "Good"), band("5", 50, 59.99, "Strong pass"),
      band("4", 40, 49.99, "Standard pass"), band("3", 30, 39.99, "Below pass"), band("2", 20, 29.99, "Weak"), band("1", 10, 19.99, "Very weak"), band("U", 0, 9.99, "Ungraded")] },
  { id: "us-gpa", stages: ["secondary", "sixth_form"], name: "American (A–F, GPA 4.0)", hint: "Homework, quizzes, tests, projects and a final exam, with grade points.", template: "american", pass_mark: 65,
    parts: [{ name: "Homework", max_score: 10, weight: 10 }, { name: "Quizzes", max_score: 15, weight: 15, midterm: true }, { name: "Tests", max_score: 25, weight: 25, midterm: true }, { name: "Projects", max_score: 10, weight: 10 }, { name: "Final exam", max_score: 40, weight: 40 }],
    bands: [band("A", 93, 100, "Excellent", 4), band("A-", 90, 92.99, "Excellent", 3.7), band("B+", 87, 89.99, "Very good", 3.3), band("B", 83, 86.99, "Good", 3), band("B-", 80, 82.99, "Good", 2.7),
      band("C+", 77, 79.99, "Satisfactory", 2.3), band("C", 73, 76.99, "Satisfactory", 2), band("C-", 70, 72.99, "Satisfactory", 1.7), band("D+", 67, 69.99, "Passing", 1.3), band("D", 65, 66.99, "Passing", 1), band("F", 0, 64.99, "Failing", 0)] }
];

/**
 * Gaps between grade bands. A score takes the band with the highest "from" at or
 * below it, so a score in a gap quietly gets the grade below: worth a warning.
 */
export function bandGaps(bands: { grade: string; min_score: number; max_score: number }[]): string[] {
  const b = [...bands].filter(x => Number.isFinite(x.min_score) && Number.isFinite(x.max_score)).sort((x, y) => x.min_score - y.min_score);
  const out: string[] = [];
  for (let i = 1; i < b.length; i++) {
    if (b[i].min_score - b[i - 1].max_score > 1.0001) out.push(`Nothing covers ${b[i - 1].max_score} to ${b[i].min_score}, so those scores get ${b[i - 1].grade}.`);
  }
  return out;
}

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
