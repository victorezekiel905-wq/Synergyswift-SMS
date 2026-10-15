"use client";
import { Page, PageHeader } from "@/components/ui";
import StudentThreads from "@/components/comms/StudentThreads";

export default function StaffStudentMessages() {
  return (
    <Page wide>
      <PageHeader eyebrow="Communication" title="Messages with students" subtitle="Private conversations with students you teach, kept and visible to the school's safeguarding staff and the student's parents." />
      <StudentThreads role="staff" />
    </Page>
  );
}
