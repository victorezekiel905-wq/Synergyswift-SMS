"use client";
import Entrance from "@/components/admissions/Entrance";

/**
 * The Entrance exams screen for reviewing the design (the screenshot script supplies
 * sample data for its API). Only available in builds made with NEXT_PUBLIC_DESIGN_PREVIEW=1.
 */
export default function EntrancePreview() {
  if (process.env.NEXT_PUBLIC_DESIGN_PREVIEW !== "1") return <p className="p-8">Not available.</p>;
  return (
    <div className="min-h-screen bg-canvas p-4 sm:p-6">
      <h1 className="mb-4 text-[26px] font-serif font-semibold tracking-[-0.01em]">Admissions: Entrance exams</h1>
      <Entrance onOpenLead={() => {}} />
    </div>
  );
}
