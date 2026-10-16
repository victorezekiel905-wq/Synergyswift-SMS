"use client";
import { Page, PageHeader } from "@/components/ui";
import MyTeaching from "@/components/portal/MyTeaching";
import NoticeBoard from "@/components/comms/NoticeBoard";
import ToSign from "@/components/ToSign";

/** The teacher portal home: today's lessons and registers, what to do next, and every teaching tool one tap away. */
export default function TeacherHome() {
  return (
    <Page>
      <PageHeader eyebrow="Teacher" title="My teaching day" subtitle="Registers, marking, score sheets, lesson plans and parent messages in one place." />
      <ToSign />
      <NoticeBoard />
      <MyTeaching />
    </Page>
  );
}
