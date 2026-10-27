"use client";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi, Page, PageHeader, Alert, Loading, Empty } from "@/components/ui";
import FamilyPlan from "@/components/sen/FamilyPlan";

export default function ParentSupportPage() {
  return <Suspense fallback={<Loading />}><ParentSupport /></Suspense>;
}

/** Support plans (SEN) for a parent's children (phase 14h). */
function ParentSupport() {
  const params = useSearchParams();
  const router = useRouter();
  const { data, error } = useApi<{ children: { id: string; name: string }[] }>("/api/sen/family");
  const chosen = params.get("student") ?? data?.children[0]?.id ?? null;
  return (
    <Page>
      <PageHeader eyebrow="My children" title="Support plans" subtitle="Your child's support plan, how each target is going, and a home–school book to keep in touch with the school." />
      {error ? <Alert>{error}</Alert> : !data ? <Loading /> : !data.children.length ? <Empty>None of your children has a support plan shared with you.</Empty> : (<>
        {data.children.length > 1 && <div className="mb-4 flex flex-wrap gap-2">{data.children.map(c => (
          <button key={c.id} onClick={() => router.replace(`/parent/support?student=${c.id}`)}
            className={"rounded-full border px-3 py-1.5 text-sm " + (c.id === chosen ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white")}>{c.name}</button>))}</div>}
        {chosen && <FamilyPlan key={chosen} studentId={chosen} />}
      </>)}
    </Page>
  );
}
