"use client";
import Collections from "@/components/fees/Collections";
import Fundraising from "@/components/community/Fundraising";

/**
 * Fee collections and fundraising for reviewing the design (the screenshot script supplies
 * sample data for their APIs). Only available in builds made with NEXT_PUBLIC_DESIGN_PREVIEW=1.
 */
export default function CollectionsPreview() {
  if (process.env.NEXT_PUBLIC_DESIGN_PREVIEW !== "1") return <p className="p-8">Not available.</p>;
  return (
    <div className="min-h-screen space-y-10 bg-canvas p-4 sm:p-6">
      <section id="collections"><h1 className="mb-4 text-[26px] font-serif font-semibold">Fees: Collections</h1><Collections /></section>
      <section id="fundraising"><h1 className="mb-4 text-[26px] font-serif font-semibold">Families & community: Fundraising</h1><Fundraising /></section>
    </div>
  );
}
