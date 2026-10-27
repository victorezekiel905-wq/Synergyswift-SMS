"use client";
import { useApi, Page, Alert, Loading } from "@/components/ui";
import Transcript from "@/components/results/Transcript";

/** A student's own transcript (phase 14o): readable now, downloadable once the school releases it. */
export default function MyTranscript() {
  const { data, error } = useApi<{ student_id: string }>("/api/student/portfolio");
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  return <Transcript studentId={data.student_id} family />;
}
