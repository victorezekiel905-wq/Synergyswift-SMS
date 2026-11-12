"use client";
import { useState } from "react";
import { Page, PageHeader, Tabs } from "@/components/ui";
import ClassCodes, { type CodeMode } from "@/components/onboarding/ClassCodes";

/**
 * Teaching → My class codes: a class teacher's own class, with each student's sign-up code and
 * each child's parent code to hand to the family. Subject teachers see nothing here.
 */
export default function MyClassCodesPage() {
  const [mode, setMode] = useState<CodeMode>("parents");
  return (
    <Page wide>
      <PageHeader eyebrow="Teaching" title="My class codes"
        subtitle="For the class you are class teacher of. Give each family their child's parent code so they can add the child to their page, and each student their own sign-up code. Keep them private: students and subject teachers cannot see them." />
      <Tabs value={mode} onChange={setMode} tabs={[{ id: "parents", label: "Parent codes" }, { id: "students", label: "Student sign-up codes" }]} />
      <div className="mt-4"><ClassCodes mode={mode} /></div>
    </Page>
  );
}
