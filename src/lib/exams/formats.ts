/**
 * Mock-exam presets in the shape of national and international papers.
 * They are starting points: question counts and timings follow the usual
 * structure of each paper and every value can be edited after the exam is
 * created. Each section draws its questions at random from the question bank
 * (filtered by subject and, when available, by the exam body's past questions).
 */
export type FormatSection = {
  name: string;
  count: number;                      // questions each student gets
  types: string[];                    // question types to draw
  points: number;                     // marks per question
  subjectSlot?: number;               // multi-subject papers (JAMB): which chosen subject this section uses
};
export type ExamFormat = {
  id: string; label: string; exam_body: string; duration_minutes: number;
  subjects: number;                   // how many subjects the teacher picks
  fixedFirstSubject?: string;         // e.g. JAMB: Use of English is compulsory
  sections: FormatSection[];
  instructions: string;
  settings: Record<string, unknown>;
};

const OBJ = ["mcq_single"];
const THEORY = ["essay", "short_answer", "numeric", "math", "file_upload"];

export const EXAM_FORMATS: ExamFormat[] = [
  {
    id: "jamb_utme", label: "JAMB UTME (CBT, 4 subjects)", exam_body: "JAMB", duration_minutes: 120, subjects: 4, fixedFirstSubject: "English",
    sections: [
      { name: "Use of English", count: 60, types: OBJ, points: 100 / 60, subjectSlot: 0 },
      { name: "Subject 2", count: 40, types: OBJ, points: 2.5, subjectSlot: 1 },
      { name: "Subject 3", count: 40, types: OBJ, points: 2.5, subjectSlot: 2 },
      { name: "Subject 4", count: 40, types: OBJ, points: 2.5, subjectSlot: 3 }
    ],
    instructions: "Answer all 180 questions. Use of English has 60 questions; each other subject has 40. Each subject is scored out of 100, for a total of 400. You have 2 hours.",
    settings: { shuffle_questions: false, shuffle_options: true, allow_calculator: true, show_score_after_submit: true }
  },
  {
    id: "waec_obj", label: "WAEC SSCE Paper 1 (objectives)", exam_body: "WAEC", duration_minutes: 60, subjects: 1,
    sections: [{ name: "Objectives", count: 50, types: OBJ, points: 1 }],
    instructions: "Answer all 50 questions. Each question has four options, A to D. Choose the correct one.",
    settings: { shuffle_questions: true, shuffle_options: true }
  },
  {
    id: "waec_full", label: "WAEC SSCE (objectives + theory)", exam_body: "WAEC", duration_minutes: 180, subjects: 1,
    sections: [
      { name: "Paper 1: Objectives", count: 50, types: OBJ, points: 1 },
      { name: "Paper 2: Theory", count: 6, types: THEORY, points: 10 }
    ],
    instructions: "Paper 1: answer all 50 objective questions. Paper 2: answer the theory questions in full, showing all working.",
    settings: { shuffle_options: true }
  },
  {
    id: "neco_obj", label: "NECO SSCE Paper 1 (objectives)", exam_body: "NECO", duration_minutes: 60, subjects: 1,
    sections: [{ name: "Objectives", count: 60, types: OBJ, points: 1 }],
    instructions: "Answer all 60 questions. Choose the correct option for each.",
    settings: { shuffle_questions: true, shuffle_options: true }
  },
  {
    id: "bece", label: "BECE (Junior WAEC)", exam_body: "BECE", duration_minutes: 120, subjects: 1,
    sections: [
      { name: "Section A: Objectives", count: 50, types: OBJ, points: 1 },
      { name: "Section B: Theory", count: 5, types: THEORY, points: 10 }
    ],
    instructions: "Section A: answer all objective questions. Section B: answer the theory questions.",
    settings: { shuffle_options: true }
  },
  {
    id: "ncee", label: "Common Entrance (NCEE)", exam_body: "NCEE", duration_minutes: 120, subjects: 1,
    sections: [{ name: "Objectives", count: 60, types: OBJ, points: 1 }],
    instructions: "Answer all the questions.",
    settings: { shuffle_questions: true, shuffle_options: true }
  },
  {
    id: "igcse_mcq", label: "IGCSE multiple-choice paper", exam_body: "IGCSE", duration_minutes: 45, subjects: 1,
    sections: [{ name: "Multiple choice", count: 40, types: OBJ, points: 1 }],
    instructions: "Answer all 40 questions. There are four possible answers for each question.",
    settings: { shuffle_options: true }
  },
  {
    id: "igcse_structured", label: "IGCSE structured / theory paper", exam_body: "IGCSE", duration_minutes: 75, subjects: 1,
    sections: [{ name: "Structured questions", count: 8, types: [...THEORY, "fill_blanks", "matching", "mcq_multi"], points: 10 }],
    instructions: "Answer all questions in the spaces provided. Show your working.",
    settings: {}
  },
  {
    id: "a_level", label: "A Level paper", exam_body: "A Level", duration_minutes: 120, subjects: 1,
    sections: [{ name: "Questions", count: 8, types: THEORY, points: 10 }],
    instructions: "Answer all questions. Show your working and give answers to an appropriate degree of accuracy.",
    settings: {}
  },
  {
    id: "sat_math", label: "SAT-style Math section", exam_body: "SAT", duration_minutes: 70, subjects: 1,
    sections: [
      { name: "Multiple choice", count: 33, types: OBJ, points: 1 },
      { name: "Student-produced response", count: 11, types: ["numeric", "math", "short_answer"], points: 1 }
    ],
    instructions: "Answer every question. Some questions ask you to enter your own answer.",
    settings: { allow_calculator: true, shuffle_options: true }
  }
];

export function formatById(id: string) {
  return EXAM_FORMATS.find(f => f.id === id) ?? null;
}
