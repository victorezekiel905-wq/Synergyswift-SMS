"use client";
import GuardianPortal, { postTo } from "@/components/parent/GuardianPortal";
import MyExamTimetable from "@/components/exams/MyExamTimetable";
import ReferralCard from "@/components/parent/ReferralCard";
import ToSign from "@/components/ToSign";
import AskTheSchool from "@/components/parent/AskTheSchool";

/** Logged-in parent portal: children, live sign-in status, results, exam timetables, referral link and pickup codes. */
export default function ParentPage() {
  return (
    <>
      <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-6"><ToSign title="Forms waiting for your signature" /><MyExamTimetable /></div>
      <GuardianPortal mode="session" api="/api/parent/overview" act={(b) => postTo("/api/pickup", b)} />
      <div className="mx-auto max-w-5xl px-4 pb-6 sm:px-6"><ReferralCard /></div>
      <AskTheSchool />
    </>
  );
}
