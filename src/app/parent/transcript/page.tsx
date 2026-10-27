"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loading, Page, Empty } from "@/components/ui";
import Transcript from "@/components/results/Transcript";

export default function ParentTranscriptPage() {
  return <Suspense fallback={<Loading />}><ParentTranscript /></Suspense>;
}

/** A child's transcript for a parent (phase 14o): readable now, downloadable once the school releases it. */
function ParentTranscript() {
  const student = useSearchParams().get("student");
  return student ? <Transcript studentId={student} family /> : <Page><Empty>Choose a child from Portfolio &amp; transcript.</Empty></Page>;
}
