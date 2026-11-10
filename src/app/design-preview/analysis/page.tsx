"use client";
import { Page, PageHeader, Empty } from "@/components/ui";
import StudentAnalysisView from "@/components/analysis/StudentAnalysisView";
import type { StudentAnalysis } from "@/lib/analysis-student-server";

/** A child's analysis with sample figures, for reviewing the design (NEXT_PUBLIC_DESIGN_PREVIEW=1 builds only). */
export default function AnalysisPreview() {
  if (process.env.NEXT_PUBLIC_DESIGN_PREVIEW !== "1") return <Page><Empty>Not available.</Empty></Page>;
  const a = {
    student: { id: "s", name: "Adaeze Okafor", first_name: "Adaeze", class_name: "JSS2 Gold" },
    term: { id: "t", name: "First Term 2026/2027", starts_on: "2026-09-14", ends_on: "2026-12-11" }, from: "2026-09-14", today: "2026-11-10", generated_at: "2026-11-10T09:00:00Z",
    attendance: { days: 40, rate: 92.5, absent: 3, late: 4, excused: 0, by_month: [{ month: "2026-09", rate: 100, marked: 12 }, { month: "2026-10", rate: 90, marked: 20 }, { month: "2026-11", rate: 87.5, marked: 8 }], absent_weekdays: [{ key: "Friday", count: 2 }, { key: "Monday", count: 1 }] },
    arrivals: { days: 38, late: 4 },
    results: { trend: [{ term_id: "a", term: "Second Term 25/26", average: 66.2, position: 6, class_size: 34 }, { term_id: "b", term: "Third Term 25/26", average: 61.4, position: 9, class_size: 34 }],
      term: "Third Term 25/26", subjects: [
        { subject_id: "1", subject: "English Language", score: 78, grade: "B2", class_average: 64, position: 4, change: 3 },
        { subject_id: "2", subject: "Basic Science", score: 71, grade: "B3", class_average: 60, position: 7, change: 1 },
        { subject_id: "3", subject: "Mathematics", score: 58, grade: "C5", class_average: 62, position: 15, change: -9 },
        { subject_id: "4", subject: "French", score: 39, grade: "F9", class_average: 51, position: 28, change: -6 }],
      strongest: { subject_id: "1", subject: "English Language", score: 78, grade: "B2", class_average: 64, position: 4 }, weakest: { subject_id: "4", subject: "French", score: 39, grade: "F9", class_average: 51, position: 28 },
      above_class_average: 2, falling: [{ subject: "Mathematics", change: -9 }] },
    tests: { exams: { count: 3, average: 71.7, recent: [{ title: "Maths CA 2", at: "2026-11-04", percent: 65 }, { title: "Basic Science quiz", at: "2026-10-21", percent: 80 }] }, practice: { count: 7, average: 68 , recent: [] } },
    homework: { set: 18, handed_in: 15, on_time: 13, late: 2, missing: 2, still_due: 1, completion: 88.2, average_mark: 74.5,
      by_subject: [{ key: "French", count: 60, set: 5, done: 3 }, { key: "Mathematics", count: 83.3, set: 6, done: 5 }, { key: "English Language", count: 100, set: 7, done: 7 }] },
    behaviour: { positive: 9, negative: 1, house_points: 14, class_points: 42, top_skills: [{ key: "Teamwork", count: 12 }, { key: "Participation", count: 9 }, { key: "Kindness", count: 5 }], needs_work: [{ key: "On task", count: 2 }] },
    learning: { steps_done: 24, steps_started: 26, step_average: 76, lessons_completed: 6, minutes: 142, online_lessons_joined: 4, active_days: 19, learning_points: 310 },
    activities: { clubs: ["Debate club", "Football"], competitions: 2, placed: 1, achievements: 3, recent: [{ title: "2nd place, inter-house spelling bee", on: "2026-10-30" }, { title: "Class prefect", on: "2026-09-20" }], badges: 4 },
    health: { visits: 2, by_reason: [{ key: "headache", count: 1 }, { key: "stomach ache", count: 1 }] },
    library: { borrowed_this_term: 4, read_all_time: 17, on_loan: 1, overdue: 0 },
    fees: { this_term: { billed: 285000, collected: 200000, outstanding: 85000, rate: 70.2, overdue_invoices: 0, overdue_amount: 0 }, all_time: { billed: 285000, collected: 200000, outstanding: 85000, rate: 70.2, overdue_invoices: 0, overdue_amount: 0 }, overdue: 0 },
    shop: { buys: 21, spent: 6300, by_category: [{ key: "Drinks", count: 2800 }, { key: "Pastry", count: 2100 }, { key: "Biscuits", count: 1400 }] },
    notes: [
      { tone: "warn", text: "Adaeze's attendance is 92.5%. Aim for 95% or more.", href: null },
      { tone: "warn", text: "2 pieces of homework past the due date and not handed in.", href: null },
      { tone: "warn", text: "Mathematics dropped 9 points since last term.", href: null },
      { tone: "warn", text: "French needs the most help (39).", href: null },
      { tone: "good", text: "Strongest subject: English Language (78).", href: null }
    ],
    unavailable: []
  } as unknown as StudentAnalysis;
  return (
    <Page wide>
      <PageHeader eyebrow="My children" title="Child analysis" subtitle="How each child is doing across the school." />
      <StudentAnalysisView a={a} currency="NGN" forParent />
    </Page>
  );
}
