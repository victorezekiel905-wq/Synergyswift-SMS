"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useApi, Loading, Page, Empty, Alert } from "@/components/ui";
import Transcript from "@/components/results/Transcript";
import TranscriptCode from "@/components/parent/TranscriptCode";

export default function ParentTranscriptPage() {
  return <Suspense fallback={<Loading />}><ParentTranscript /></Suspense>;
}

/**
 * A child's transcript for a parent: opened once with the code the school's admins made for this
 * child (migration 10100); downloadable once the school releases it.
 */
function ParentTranscript() {
  const student = useSearchParams().get("student");
  const { data, error, reload } = useApi<{ unlocked: boolean }>(student ? `/api/parent/transcript-code?student=${student}` : null, [student]);
  if (!student) return <Page><Empty>Choose a child from Portfolio &amp; transcript.</Empty></Page>;
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  if (!data.unlocked) return <Page><div className="mx-auto max-w-md"><TranscriptCode onUnlocked={reload} /></div></Page>;
  return <Transcript studentId={student} family />;
}
