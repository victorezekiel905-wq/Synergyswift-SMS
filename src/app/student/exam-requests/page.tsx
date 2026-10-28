"use client";
import { Page, PageHeader } from "@/components/ui";
import FamilyExamRequests from "@/components/exams/FamilyExamRequests";

/** Asking the exams office for extra time, a late sitting, a resit or a special arrangement. */
export default function ExamRequestsPage() {
  return (
    <Page>
      <PageHeader title="Exam requests" subtitle="Ask for extra time, a late sitting, a resit or a special arrangement, and see the answer here." />
      <FamilyExamRequests who="student" />
    </Page>
  );
}
