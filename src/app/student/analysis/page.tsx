"use client";
import { useApi, Page, PageHeader, Alert, Loading } from "@/components/ui";
import StudentAnalysisView from "@/components/analysis/StudentAnalysisView";
import type { StudentAnalysis } from "@/lib/analysis-student-server";

/** Students: their own progress across the modules the school uses. */
export default function StudentAnalysisPage() {
  const { data, error } = useApi<{ currency: string; analysis: StudentAnalysis }>("/api/student/analysis");
  return (
    <Page wide>
      <PageHeader eyebrow="My school" title="My progress" subtitle="Your attendance, results, homework, tests, behaviour, learning, clubs and more, all in one place." />
      {error ? <Alert>{error}</Alert> : !data ? <Loading label="Bringing your figures together…" /> : <StudentAnalysisView a={data.analysis} currency={data.currency} forParent={false} />}
    </Page>
  );
}
