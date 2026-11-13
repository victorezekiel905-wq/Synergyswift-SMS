"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Page, PageHeader, Tabs } from "@/components/ui";
import StaffOnboarding from "@/components/onboarding/StaffOnboarding";
import ClassCodes from "@/components/onboarding/ClassCodes";

type Tab = "staff" | "students" | "parents";

/**
 * School office → Onboarding: everyone the school brings onto the platform, in one place.
 * Staff: add them and choose how they sign in. Students: each student's sign-up code, class by
 * class. Parents: each child's parent code, which parents type to add the child to their page.
 */
export default function OnboardingPage() {
  const [tab, setTab] = useState<Tab>("staff");
  useEffect(() => { const t = new URLSearchParams(window.location.search).get("tab"); if (t === "students" || t === "parents" || t === "staff") setTab(t); }, []);
  const pick = (t: Tab) => { setTab(t); const u = new URL(window.location.href); u.searchParams.set("tab", t); u.searchParams.delete("focus"); window.history.replaceState(null, "", u); };
  return (
    <Page wide>
      <PageHeader eyebrow="School office" title="Onboarding"
        subtitle="Bring staff, students and parents onto the platform. Each student signs up with their own sign-up code. Parents sign up freely with no code, then add each child with that child's code. Only you and the class teacher see a class's details."
        actions={<><Link href="/school/students" className="btn btn-outline text-xs">Add students and parents</Link><Link href="/school/account-codes" className="btn btn-ghost text-xs">All codes &amp; logins</Link></>} />
      <Tabs value={tab} onChange={pick} tabs={[{ id: "staff", label: "Staff onboarding" }, { id: "students", label: "Student onboarding" }, { id: "parents", label: "Parent onboarding" }]} />
      <div className="mt-4">
        {tab === "staff" && <StaffOnboarding />}
        {tab === "students" && <ClassCodes mode="students" />}
        {tab === "parents" && <ClassCodes mode="parents" />}
      </div>
    </Page>
  );
}
