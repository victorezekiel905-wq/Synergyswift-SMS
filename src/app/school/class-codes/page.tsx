"use client";
import { useState } from "react";
import { Page, PageHeader, Tabs } from "@/components/ui";
import ClassCodes, { type CodeMode } from "@/components/onboarding/ClassCodes";

/**
 * Teaching → My class codes: a class teacher's own class, with the class's shared sign-up code,
 * students waiting to be confirmed, each student's own sign-up code and each child's code for
 * parents. Subject teachers see nothing here.
 */
export default function MyClassCodesPage() {
  const [mode, setMode] = useState<CodeMode>("students");
  return (
    <Page wide>
      <PageHeader eyebrow="Teaching" title="My class codes"
        subtitle="For the class you are class teacher of. Share the class code with your students and confirm each one who signs up with it. Give each family their child's code so they can add the child to their page. Keep codes private." />
      <Tabs value={mode} onChange={setMode} tabs={[{ id: "students", label: "Students" }, { id: "parents", label: "Parents" }]} />
      <div className="mt-4"><ClassCodes mode={mode} /></div>
    </Page>
  );
}
