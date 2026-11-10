import { describe, expect, it } from "vitest";
import { attendanceSummary, cardSubjects, subjectChanges, termTrend, homeworkStats, testScores, childNotes } from "@/lib/analysis-student";
import { classSubjectAverages, studentsNeedingHelp, areaOf, activitySummary } from "@/lib/analysis-staff";

describe("a child's analysis", () => {
  it("attendance: rate, absences by weekday, month by month", () => {
    const marks = [
      { date: "2026-10-05", status: "absent" },   // Monday
      { date: "2026-10-06", status: "present" },
      { date: "2026-10-12", status: "absent" },   // Monday
      { date: "2026-10-13", status: "late" },
      { date: "2026-11-02", status: "absent" },   // Monday
      { date: "2026-11-03", status: "present" }
    ];
    const a = attendanceSummary(marks);
    expect(a).toMatchObject({ days: 6, rate: 50, absent: 3, late: 1 });
    expect(a.absent_weekdays).toEqual([{ key: "Monday", count: 3 }]);
    expect(a.by_month).toEqual([{ month: "2026-10", rate: 50, marked: 4 }, { month: "2026-11", rate: 50, marked: 2 }]);
  });

  it("results: only what is on a published card, highest first, with change since last term", () => {
    const now = cardSubjects({ subjects: [
      { subject_id: "m", subject: "Mathematics", total: 72, grade: "B", class_average: 61, position: 4 },
      { subject_id: "e", subject: "English", total: 48, grade: "D", class_average: 55 },
      { subject_id: "x", subject: "Not taken", total: null }
    ] });
    expect(now.map(s => [s.subject, s.score])).toEqual([["Mathematics", 72], ["English", 48]]);
    const before = cardSubjects({ subjects: [{ subject_id: "m", subject: "Mathematics", total: 65 }, { subject_id: "e", subject: "English", total: 60 }] });
    expect(subjectChanges(now, before)).toEqual([{ subject_id: "m", change: 7 }, { subject_id: "e", change: -12 }]);
    expect(cardSubjects(null)).toEqual([]);
  });

  it("results: term averages in term order", () => {
    const terms = [{ id: "t2", name: "Second Term", starts_on: "2026-01-10" }, { id: "t1", name: "First Term", starts_on: "2025-09-10" }];
    const trend = termTrend([{ term_id: "t2", average: "61.25", position: 3, class_size: 30, status: "published" }, { term_id: "t1", average: 55, position: 8, class_size: 30, status: "published" }], terms);
    expect(trend.map(t => [t.term, t.average])).toEqual([["First Term", 55], ["Second Term", 61.3]]);
  });

  it("homework: handed in, late, missing and per subject", () => {
    const now = "2026-11-10T12:00:00Z";
    const work = [
      { id: "1", due_at: "2026-11-01T00:00:00Z", subject: "Maths", max_score: 10 },
      { id: "2", due_at: "2026-11-03T00:00:00Z", subject: "Maths", max_score: 10 },
      { id: "3", due_at: "2026-11-05T00:00:00Z", subject: "English", max_score: null },
      { id: "4", due_at: "2026-11-20T00:00:00Z", subject: "English", max_score: 20 }
    ];
    const subs = [{ homework_id: "1", submitted_at: "2026-10-31T10:00:00Z", late: false, score: 8 }, { homework_id: "3", submitted_at: "2026-11-06T10:00:00Z", late: true, score: null }];
    const h = homeworkStats(work, subs, now);
    expect(h).toMatchObject({ set: 4, handed_in: 2, on_time: 1, late: 1, missing: 1, still_due: 1, completion: 66.7, average_mark: 80 });
    expect(h.by_subject.map(s => [s.key, s.count])).toEqual([["Maths", 50], ["English", 50]]);
  });

  it("tests: percentages, newest first", () => {
    const t = testScores([{ title: "Quiz 1", at: "2026-10-01", score: 15, max: 20 }, { title: "Quiz 2", at: "2026-11-01", score: 9, max: 10 }, { title: "Not marked", at: "2026-11-02", score: null, max: 10 }]);
    expect(t).toMatchObject({ count: 2, average: 82.5 });
    expect(t.recent[0]).toMatchObject({ title: "Quiz 2", percent: 90 });
  });

  it("notes are worded for the parent or for the student, worst first", () => {
    const facts = {
      attendance: { rate: 86, absent: 7, late: 6, absent_weekdays: [{ key: "Friday", count: 5 }] },
      results: { trend: [{ average: 64 }, { average: 57 }], weakest: { subject: "Physics", score: 38 }, strongest: { subject: "English", score: 81 }, falling: [{ subject: "Physics", change: -12 }] },
      homework: { missing: 3, completion: 70, late: 1 },
      fees: { overdue: 1 }
    };
    const parent = childNotes(facts, { forParent: true, name: "Ada" });
    expect(parent[0]!.tone).toBe("bad");
    expect(parent.map(n => n.text)).toEqual(expect.arrayContaining([
      "Ada's attendance is 86% (7 days absent). Under 90% makes it hard to keep up.",
      "Most absences are on Fridays (5 of 7).",
      "Ada's average fell by 7 points since last term (57%).",
      "Physics needs the most help (38).",
      "Some school fees are past the due date."
    ]));
    const student = childNotes(facts, { forParent: false, name: "Ada" });
    expect(student.some(n => n.text.startsWith("Your attendance is 86%"))).toBe(true);
    expect(student.some(n => /fees/.test(n.text))).toBe(false);          // fees are for parents
    expect(parent[parent.length - 1]!.tone).toBe("good");
  });
});

describe("a member of staff's analysis", () => {
  it("averages per class and subject, and how many are below the pass mark", () => {
    const classOf = new Map([["s1", "1A"], ["s2", "1A"], ["s3", "1B"]]);
    const scores = [
      { student_id: "s1", subject_id: "m", score: 20 }, { student_id: "s1", subject_id: "m", score: 50 },   // 70
      { student_id: "s2", subject_id: "m", score: 30 },                                                      // 30
      { student_id: "s3", subject_id: "m", score: 80 },
      { student_id: "s3", subject_id: "e", score: 90 }                                                       // not this teacher's
    ];
    expect(classSubjectAverages(scores, classOf, [{ class_group_id: "1A", subject_id: "m" }, { class_group_id: "1B", subject_id: "m" }])).toEqual([
      { class_group_id: "1A", subject_id: "m", students: 2, average: 50, below_pass: 1 },
      { class_group_id: "1B", subject_id: "m", students: 1, average: 80, below_pass: 0 }
    ]);
  });
  it("finds students who need help, worst first", () => {
    const students = [{ id: "a", name: "Ada", class_name: "1A" }, { id: "b", name: "Bayo", class_name: "1A" }, { id: "c", name: "Chi", class_name: "1A" }];
    const att = new Map([["a", { marked: 20, present: 15 }], ["b", { marked: 20, present: 19 }], ["c", { marked: 3, present: 0 }]]);
    const low = new Map([["b", ["Maths"]], ["a", ["English", "Physics"]]]);
    const help = studentsNeedingHelp(students, att, low);
    expect(help.map(h => h.name)).toEqual(["Ada", "Bayo"]);              // Chi: too few marks to judge
    expect(help[0]!.reasons).toEqual(["attendance 75%", "low marks in English, Physics"]);
  });
  it("sorts the school's activity into areas and roles", () => {
    expect(areaOf("fees.payment_recorded")).toBe("Money");
    expect(areaOf("staff.onboarded")).toBe("Staff & HR");
    expect(areaOf("settings.updated")).toBe("Settings & data");
    expect(areaOf("something.new")).toBe("Other");
    const roleOf = new Map([["u1", "teacher"], ["u2", "bursar"]]);
    const s = activitySummary([
      { action: "attendance.marked", actor_id: "u1", ts: "2026-11-09T09:00:00Z" },
      { action: "homework.set", actor_id: "u1", ts: "2026-11-10T09:00:00Z" },
      { action: "fees.payment_recorded", actor_id: "u2", ts: "2026-11-10T10:00:00Z" },
      { action: "cron.ran", actor_id: null, ts: "2026-11-10T10:00:00Z" }
    ], roleOf, ["2026-11-09", "2026-11-10"], ts => ts.slice(0, 10));
    expect(s).toMatchObject({ actions: 4, people: 2 });
    expect(s.by_role[0]).toEqual({ key: "teacher", count: 2 });
    expect(s.by_day).toEqual([{ date: "2026-11-09", count: 1 }, { date: "2026-11-10", count: 3 }]);
  });
});
