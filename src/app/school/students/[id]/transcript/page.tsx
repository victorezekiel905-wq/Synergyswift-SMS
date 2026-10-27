"use client";
import { use } from "react";
import Transcript from "@/components/results/Transcript";

/** Printable academic transcript for staff. */
export default function TranscriptPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  return <Transcript studentId={id} />;
}
