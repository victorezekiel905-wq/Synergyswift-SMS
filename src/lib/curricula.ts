/**
 * Curriculum frameworks a school can adopt, alone or mixed (for example a
 * British primary with a Nigerian secondary). Each stage lists its classes,
 * usual subjects and a grading template. Pure data and helpers, unit tested.
 */

export type Band = { grade: string; min_score: number; max_score: number; remark: string; grade_point?: number | null };
export type GradingTemplate = { key: string; name: string; pass_mark: number; template: "nigerian" | "british" | "american"; show_position: boolean;
  components: { name: string; max_score: number; weight: number }[]; bands: Band[] };
export type Stage = { key: string; name: string; kind: "nursery" | "primary" | "secondary" | "sixth_form"; levels: string[]; subjects: string[]; grading: string; exam?: string };
export type Framework = { key: string; name: string; summary: string; stages: Stage[] };

const step = (rows: [string, number, number, string, number?][]): Band[] => rows.map(([grade, min, max, remark, gp]) => ({ grade, min_score: min, max_score: max, remark, grade_point: gp ?? null }));
const CA_EXAM = [{ name: "CA 1", max_score: 20, weight: 20 }, { name: "CA 2", max_score: 20, weight: 20 }, { name: "Exam", max_score: 60, weight: 60 }];

export const GRADING: Record<string, GradingTemplate> = {
  waec: { key: "waec", name: "WAEC / NECO (A1–F9)", pass_mark: 40, template: "nigerian", show_position: true, components: CA_EXAM, bands: step([
    ["A1", 75, 100, "Excellent", 5], ["B2", 70, 74.99, "Very good", 4.5], ["B3", 65, 69.99, "Good", 4], ["C4", 60, 64.99, "Credit", 3.5], ["C5", 55, 59.99, "Credit", 3],
    ["C6", 50, 54.99, "Credit", 2.5], ["D7", 45, 49.99, "Pass", 2], ["E8", 40, 44.99, "Pass", 1], ["F9", 0, 39.99, "Fail", 0]]) },
  bece: { key: "bece", name: "BECE / basic (A–F)", pass_mark: 40, template: "nigerian", show_position: true, components: CA_EXAM, bands: step([
    ["A", 70, 100, "Distinction"], ["B", 60, 69.99, "Upper credit"], ["C", 50, 59.99, "Lower credit"], ["D", 45, 49.99, "Pass"], ["E", 40, 44.99, "Weak pass"], ["F", 0, 39.99, "Fail"]]) },
  ng_early: { key: "ng_early", name: "Nursery (developmental)", pass_mark: 40, template: "nigerian", show_position: false,
    components: [{ name: "Classwork", max_score: 40, weight: 40 }, { name: "End of term", max_score: 60, weight: 60 }], bands: step([
    ["A", 80, 100, "Excellent"], ["B", 65, 79.99, "Very good"], ["C", 50, 64.99, "Good"], ["D", 40, 49.99, "Fair"], ["E", 0, 39.99, "Needs support"]]) },
  eyfs: { key: "eyfs", name: "EYFS (Emerging / Expected / Exceeding)", pass_mark: 50, template: "british", show_position: false,
    components: [{ name: "Observation", max_score: 100, weight: 100 }], bands: step([["Exceeding", 80, 100, "Beyond the early learning goal"], ["Expected", 50, 79.99, "Meeting the early learning goal"], ["Emerging", 0, 49.99, "Not yet at the expected level"]]) },
  uk_progress: { key: "uk_progress", name: "Key Stages 1–3 (working towards / expected / greater depth)", pass_mark: 60, template: "british", show_position: false,
    components: [{ name: "Classwork", max_score: 40, weight: 40 }, { name: "Assessment", max_score: 60, weight: 60 }], bands: step([
    ["Greater depth", 85, 100, "Working at greater depth"], ["Expected", 60, 84.99, "Working at the expected standard"], ["Working towards", 40, 59.99, "Working towards the expected standard"], ["Below", 0, 39.99, "Working below the expected standard"]]) },
  gcse: { key: "gcse", name: "GCSE (9–1)", pass_mark: 40, template: "british", show_position: false,
    components: [{ name: "Coursework", max_score: 30, weight: 30 }, { name: "Exam", max_score: 70, weight: 70 }], bands: step([
    ["9", 90, 100, "Exceptional"], ["8", 80, 89.99, "Excellent"], ["7", 70, 79.99, "Very good"], ["6", 60, 69.99, "Good"], ["5", 50, 59.99, "Strong pass"], ["4", 40, 49.99, "Standard pass"],
    ["3", 30, 39.99, "Below pass"], ["2", 20, 29.99, "Weak"], ["1", 10, 19.99, "Very weak"], ["U", 0, 9.99, "Ungraded"]]) },
  igcse: { key: "igcse", name: "IGCSE (A*–G)", pass_mark: 60, template: "british", show_position: false,
    components: [{ name: "Coursework", max_score: 30, weight: 30 }, { name: "Exam", max_score: 70, weight: 70 }], bands: step([
    ["A*", 90, 100, "Outstanding"], ["A", 80, 89.99, "Excellent"], ["B", 70, 79.99, "Very good"], ["C", 60, 69.99, "Good"], ["D", 50, 59.99, "Satisfactory"],
    ["E", 40, 49.99, "Weak"], ["F", 30, 39.99, "Poor"], ["G", 20, 29.99, "Very poor"], ["U", 0, 19.99, "Ungraded"]]) },
  a_level: { key: "a_level", name: "AS & A Level (A*–E)", pass_mark: 40, template: "british", show_position: false,
    components: [{ name: "Coursework", max_score: 20, weight: 20 }, { name: "Exam", max_score: 80, weight: 80 }], bands: step([
    ["A*", 90, 100, "Outstanding"], ["A", 80, 89.99, "Excellent"], ["B", 70, 79.99, "Very good"], ["C", 60, 69.99, "Good"], ["D", 50, 59.99, "Satisfactory"], ["E", 40, 49.99, "Pass"], ["U", 0, 39.99, "Ungraded"]]) },
  us_letter: { key: "us_letter", name: "US letter grades with GPA (A–F)", pass_mark: 65, template: "american", show_position: false,
    components: [{ name: "Classwork", max_score: 30, weight: 30 }, { name: "Tests", max_score: 30, weight: 30 }, { name: "Final", max_score: 40, weight: 40 }], bands: step([
    ["A+", 97, 100, "Excellent", 4], ["A", 93, 96.99, "Excellent", 4], ["A-", 90, 92.99, "Excellent", 3.7], ["B+", 87, 89.99, "Good", 3.3], ["B", 83, 86.99, "Good", 3], ["B-", 80, 82.99, "Good", 2.7],
    ["C+", 77, 79.99, "Satisfactory", 2.3], ["C", 73, 76.99, "Satisfactory", 2], ["C-", 70, 72.99, "Satisfactory", 1.7], ["D+", 67, 69.99, "Passing", 1.3], ["D", 65, 66.99, "Passing", 1], ["F", 0, 64.99, "Failing", 0]]) },
  us_elementary: { key: "us_elementary", name: "US elementary (standards-based 4–1)", pass_mark: 50, template: "american", show_position: false,
    components: [{ name: "Classwork", max_score: 50, weight: 50 }, { name: "Assessments", max_score: 50, weight: 50 }], bands: step([
    ["4", 85, 100, "Exceeds the standard"], ["3", 70, 84.99, "Meets the standard"], ["2", 50, 69.99, "Approaching the standard"], ["1", 0, 49.99, "Beginning"]]) }
};

const NG_PRIMARY = ["English Studies", "Mathematics", "Basic Science and Technology", "Religion and National Values", "Cultural and Creative Arts", "Pre-vocational Studies",
  "Nigerian Language", "French", "History", "Physical and Health Education", "Computer Studies"];
const NG_JSS = ["English Language", "Mathematics", "Basic Science", "Basic Technology", "Computer Studies", "Social Studies", "Civic Education", "Security Education",
  "Christian Religious Studies", "Islamic Studies", "Agricultural Science", "Home Economics", "Business Studies", "Cultural and Creative Arts", "French", "History",
  "Physical and Health Education", "Nigerian Language"];
const NG_SSS = ["English Language", "Mathematics", "Civic Education", "Biology", "Chemistry", "Physics", "Further Mathematics", "Agricultural Science", "Economics",
  "Government", "Literature in English", "Geography", "Christian Religious Studies", "Islamic Studies", "Commerce", "Financial Accounting", "Data Processing",
  "Computer Studies", "Technical Drawing", "Visual Arts", "French", "Nigerian Language"];
const UK_PRIMARY = ["English", "Mathematics", "Science", "Computing", "History", "Geography", "Art and Design", "Design and Technology", "Music", "Physical Education",
  "Religious Education", "PSHE", "French"];
const UK_KS3 = [...UK_PRIMARY, "Citizenship"];
const GCSE = ["English Language", "English Literature", "Mathematics", "Combined Science", "Biology", "Chemistry", "Physics", "Computer Science", "History",
  "Geography", "French", "Spanish", "Religious Studies", "Business", "Economics", "Art and Design", "Music", "Physical Education", "Design and Technology"];
const A_LEVEL = ["Mathematics", "Further Mathematics", "Biology", "Chemistry", "Physics", "Computer Science", "Economics", "Business", "English Literature",
  "History", "Geography", "Psychology", "Sociology", "Government and Politics", "French", "Art and Design"];
const US_ELEM = ["English Language Arts", "Mathematics", "Science", "Social Studies", "Art", "Music", "Physical Education", "Health", "Technology"];
const US_MIDDLE = ["English Language Arts", "Mathematics", "Science", "Social Studies", "World Language", "Art", "Music", "Physical Education", "Health", "Technology"];
const US_HIGH = ["English", "Algebra I", "Geometry", "Algebra II", "Pre-Calculus", "Calculus", "Biology", "Chemistry", "Physics", "World History", "US History",
  "Government", "Economics", "Spanish", "French", "Computer Science", "Art", "Music", "Physical Education", "Health"];

export const FRAMEWORKS: Framework[] = [
  { key: "nigeria", name: "Nigerian (UBE, BECE, WAEC / NECO)", summary: "Nursery, Primary 1–6, JSS 1–3 (BECE) and SS 1–3 (WAEC / NECO) under the national curriculum.", stages: [
    { key: "ng_nursery", name: "Nursery", kind: "nursery", levels: ["Pre-Nursery", "Nursery 1", "Nursery 2"], grading: "ng_early",
      subjects: ["Literacy", "Numeracy", "Basic Science", "Social Habits", "Health Habits", "Rhymes and Music", "Creative Arts", "Physical Development"] },
    { key: "ng_primary", name: "Primary", kind: "primary", levels: ["Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6"], grading: "bece", subjects: NG_PRIMARY, exam: "Common Entrance" },
    { key: "ng_jss", name: "Junior Secondary", kind: "secondary", levels: ["JSS 1", "JSS 2", "JSS 3"], grading: "bece", subjects: NG_JSS, exam: "BECE" },
    { key: "ng_sss", name: "Senior Secondary", kind: "secondary", levels: ["SS 1", "SS 2", "SS 3"], grading: "waec", subjects: NG_SSS, exam: "WAEC / NECO / JAMB" }
  ] },
  { key: "uk", name: "British National Curriculum (EYFS, Key Stages 1–4, A Level)", summary: "Nursery and Reception (EYFS), Years 1–6 (KS1–2), Years 7–9 (KS3), GCSE in Years 10–11 and A Level in Years 12–13.", stages: [
    { key: "uk_eyfs", name: "Early Years (EYFS)", kind: "nursery", levels: ["Nursery", "Reception"], grading: "eyfs",
      subjects: ["Communication and Language", "Personal, Social and Emotional Development", "Physical Development", "Literacy", "Mathematics", "Understanding the World", "Expressive Arts and Design"] },
    { key: "uk_ks1", name: "Key Stage 1", kind: "primary", levels: ["Year 1", "Year 2"], grading: "uk_progress", subjects: UK_PRIMARY.filter(s => s !== "French") },
    { key: "uk_ks2", name: "Key Stage 2", kind: "primary", levels: ["Year 3", "Year 4", "Year 5", "Year 6"], grading: "uk_progress", subjects: UK_PRIMARY, exam: "SATs" },
    { key: "uk_ks3", name: "Key Stage 3", kind: "secondary", levels: ["Year 7", "Year 8", "Year 9"], grading: "uk_progress", subjects: UK_KS3 },
    { key: "uk_ks4", name: "Key Stage 4 (GCSE)", kind: "secondary", levels: ["Year 10", "Year 11"], grading: "gcse", subjects: GCSE, exam: "GCSE" },
    { key: "uk_ks5", name: "Sixth Form (A Level)", kind: "sixth_form", levels: ["Year 12", "Year 13"], grading: "a_level", subjects: A_LEVEL, exam: "A Level" }
  ] },
  { key: "cambridge", name: "Cambridge International (Primary, Lower Secondary, IGCSE, AS & A Level)", summary: "Cambridge Primary Stages 1–6, Lower Secondary 7–9, IGCSE in Years 10–11 and AS & A Level in Years 12–13.", stages: [
    { key: "cam_primary", name: "Cambridge Primary", kind: "primary", levels: ["Stage 1", "Stage 2", "Stage 3", "Stage 4", "Stage 5", "Stage 6"], grading: "uk_progress",
      subjects: ["English", "Mathematics", "Science", "Computing", "Digital Literacy", "Global Perspectives", "Art and Design", "Music", "Physical Education", "Wellbeing", "French"], exam: "Primary Checkpoint" },
    { key: "cam_lower", name: "Cambridge Lower Secondary", kind: "secondary", levels: ["Stage 7", "Stage 8", "Stage 9"], grading: "uk_progress",
      subjects: ["English", "Mathematics", "Science", "Computing", "Digital Literacy", "Global Perspectives", "Art and Design", "Music", "Physical Education", "Wellbeing", "French"], exam: "Lower Secondary Checkpoint" },
    { key: "cam_igcse", name: "Cambridge IGCSE", kind: "secondary", levels: ["Year 10", "Year 11"], grading: "igcse", subjects: GCSE.map(s => (s === "Combined Science" ? "Co-ordinated Sciences" : s)), exam: "IGCSE" },
    { key: "cam_alevel", name: "Cambridge AS & A Level", kind: "sixth_form", levels: ["Year 12 (AS)", "Year 13 (A2)"], grading: "a_level", subjects: A_LEVEL, exam: "AS & A Level" }
  ] },
  { key: "american", name: "American (Pre-K to Grade 12, high school diploma)", summary: "Pre-K and Kindergarten, Grades 1–5 elementary, 6–8 middle school and 9–12 high school with GPA.", stages: [
    { key: "us_early", name: "Early Childhood", kind: "nursery", levels: ["Pre-K", "Kindergarten"], grading: "us_elementary",
      subjects: ["Literacy", "Mathematics", "Science", "Social Studies", "Social-Emotional Learning", "Art", "Music", "Physical Education"] },
    { key: "us_elem", name: "Elementary School", kind: "primary", levels: ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"], grading: "us_elementary", subjects: US_ELEM },
    { key: "us_middle", name: "Middle School", kind: "secondary", levels: ["Grade 6", "Grade 7", "Grade 8"], grading: "us_letter", subjects: US_MIDDLE },
    { key: "us_high", name: "High School", kind: "secondary", levels: ["Grade 9", "Grade 10", "Grade 11", "Grade 12"], grading: "us_letter", subjects: US_HIGH, exam: "SAT / ACT / AP" }
  ] }
];

export function framework(key: string | null | undefined) { return FRAMEWORKS.find(f => f.key === key) ?? null; }
export function stage(key: string | null | undefined) {
  for (const f of FRAMEWORKS) { const s = f.stages.find(x => x.key === key); if (s) return { framework: f, stage: s }; }
  return null;
}
/** Human name of a stage or framework key, for labels. */
export function curriculumLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  const s = stage(key);
  return s ? `${s.framework.name.split(" (")[0]}: ${s.stage.name}` : framework(key)?.name ?? key;
}

export type PlanInput = { stages: string[]; arms: string[]; existingClasses: string[]; existingSubjects: string[] };
export type Plan = {
  sections: { stage: string; name: string; kind: Stage["kind"] }[];
  classes: { stage: string; name: string; level: string }[];
  subjects: string[];                                          // new subjects to create
  offerings: { class: string; subject: string }[];
  grading: string[];                                           // grading template keys used
};

/**
 * What applying stages of one or more frameworks would create: a section per
 * stage, a class per level and arm, subjects and the subjects each class takes.
 * Names that already exist (any capitalisation) are reused, not duplicated.
 */
export function planCurriculum(p: PlanInput): Plan {
  const arms = p.arms.map(a => a.trim()).filter(Boolean);
  const haveClass = new Set(p.existingClasses.map(n => n.trim().toLowerCase()));
  const haveSubject = new Set(p.existingSubjects.map(n => n.trim().toLowerCase()));
  const plan: Plan = { sections: [], classes: [], subjects: [], offerings: [], grading: [] };
  const newSubjects = new Set<string>();
  for (const key of p.stages) {
    const st = stage(key);
    if (!st) continue;
    plan.sections.push({ stage: key, name: st.stage.name, kind: st.stage.kind });
    if (!plan.grading.includes(st.stage.grading)) plan.grading.push(st.stage.grading);
    for (const level of st.stage.levels) {
      for (const arm of arms.length ? arms : [""]) {
        const name = arm ? `${level} ${arm}` : level;
        if (!haveClass.has(name.toLowerCase())) plan.classes.push({ stage: key, name, level });
        for (const subject of st.stage.subjects) plan.offerings.push({ class: name, subject });
      }
    }
    for (const subject of st.stage.subjects) {
      const k = subject.toLowerCase();
      if (!haveSubject.has(k) && ![...newSubjects].some(s => s.toLowerCase() === k)) newSubjects.add(subject);
    }
  }
  plan.subjects = [...newSubjects];
  return plan;
}
