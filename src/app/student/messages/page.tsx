"use client";
import { Page, PageHeader } from "@/components/ui";
import StudentThreads from "@/components/comms/StudentThreads";

export default function StudentMessages() {
  return (
    <Page wide>
      <PageHeader eyebrow="Student" title="Messages with teachers" subtitle="Ask your teachers about your work. Your parents and the school's safeguarding staff can read these messages." />
      <StudentThreads role="student" />
    </Page>
  );
}
