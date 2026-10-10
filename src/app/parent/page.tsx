"use client";
import GuardianPortal, { postTo } from "@/components/parent/GuardianPortal";
import MyExamTimetable from "@/components/exams/MyExamTimetable";

/** Logged-in parent portal: children, live sign-in status, results, exam timetables and pickup codes. */
export default function ParentPage() {
  return (
    <>
      <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-6"><MyExamTimetable /></div>
      <GuardianPortal mode="session" api="/api/parent/overview" act={(b) => postTo("/api/pickup", b)} />
    </>
  );
}
