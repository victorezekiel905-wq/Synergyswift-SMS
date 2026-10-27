"use client";
import { useApi, Page, PageHeader, Alert, Loading, Empty } from "@/components/ui";
import FamilyPlan from "@/components/sen/FamilyPlan";

/** A student's own support plan, in plain words (phase 14h). */
export default function StudentSupport() {
  const { data, error } = useApi<{ children: { id: string; name: string }[] }>("/api/sen/family");
  const me = data?.children[0]?.id ?? null;
  return (
    <Page>
      <PageHeader eyebrow="My school" title="My support plan" subtitle="Your targets, how you're doing, and a place to tell your teachers what helps." />
      {error ? <Alert>{error}</Alert> : !data ? <Loading /> : !me ? <Empty>You don&apos;t have a support plan at the moment.</Empty> : <FamilyPlan studentId={me} />}
    </Page>
  );
}
