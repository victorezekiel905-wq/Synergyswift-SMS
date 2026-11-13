"use client";
import { useEffect, useState } from "react";
import GuardianPortal, { postTo } from "@/components/parent/GuardianPortal";
import MyExamTimetable from "@/components/exams/MyExamTimetable";
import ReferralCard from "@/components/parent/ReferralCard";
import ToSign from "@/components/ToSign";
import AskTheSchool from "@/components/parent/AskTheSchool";
import AddChild from "@/components/parent/AddChild";
import { Page, PageHeader, Loading, type Me } from "@/components/ui";

/**
 * Logged-in parent portal: children, live sign-in status, results, exam timetables, referral link and pickup codes.
 * A parent who has just signed up has no child yet: they see only "Add a child". The first child's code
 * joins them to that child's school, and the school's name, logo and the child's pages appear.
 */
export default function ParentPage() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { fetch("/api/me").then(r => r.json()).then(setMe).catch(() => setMe({} as Me)); }, []);
  if (!me) return <Page><Loading /></Page>;
  if (me.new_parent) {
    const first = me.new_parent.full_name.trim().split(/\s+/)[0];
    return (
      <Page>
        <PageHeader eyebrow="Parent" title={first ? `Welcome, ${first}` : "Welcome"}
          subtitle="Your account is ready. Add your child with the child's code from the school: their school, results, attendance, fees and analysis then show here." />
        <AddChild first />
        <p className="mt-4 text-sm text-slate-500">No code yet? Ask your child&apos;s class teacher or the school office for your child&apos;s code. Each child has their own code; add more children the same way.</p>
      </Page>
    );
  }
  return (
    <>
      <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-6"><ToSign title="Forms waiting for your signature" /><MyExamTimetable /></div>
      <GuardianPortal mode="session" api="/api/parent/overview" act={(b) => postTo("/api/pickup", b)} />
      <div className="mx-auto max-w-5xl space-y-4 px-4 pb-6 sm:px-6"><AddChild /><ReferralCard /></div>
      <AskTheSchool />
    </>
  );
}
