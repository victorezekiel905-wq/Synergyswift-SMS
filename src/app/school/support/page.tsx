"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Page, PageHeader, Loading } from "@/components/ui";
import Tickets from "@/components/community/Tickets";

export default function SupportPage() {
  return <Suspense fallback={<Loading />}><Support /></Suspense>;
}

/** Complaints and requests desk for every member of staff: the tickets they raised or handle. */
function Support() {
  const params = useSearchParams();
  return (
    <Page wide>
      <PageHeader eyebrow="Families" title="Complaints & requests"
        subtitle="Log calls and walk-ins, reply to families, and resolve within the promised time. Overdue tickets are escalated to the principal automatically." />
      <Tickets openId={params.get("ticket")} />
    </Page>
  );
}
