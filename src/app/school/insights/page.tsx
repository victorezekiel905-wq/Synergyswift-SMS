"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApi, Page, PageHeader, Tabs, Alert, Loading } from "@/components/ui";
import Results from "@/components/insights/Results";
import ValueAdded from "@/components/insights/ValueAdded";
import { FinanceDashboard, AdmissionsDashboard } from "@/components/insights/MoneyAdmissions";
import Census from "@/components/insights/Census";

type Access = { academic: boolean; value_added: boolean; finance: boolean; admissions: boolean; census: boolean };
type Tab = "results" | "value" | "finance" | "admissions" | "census";

/** Analytics and government returns, each part shown to the people who may see it. */
export default function InsightsPage() {
  const { data, error } = useApi<{ access: Access }>("/api/insights?view=access");
  const [tab, setTab] = useState<Tab | null>(null);
  const a = data?.access;
  const tabs = useMemo(() => !a ? [] : [
    ...(a.academic ? [{ id: "results" as const, label: "Results" }] : []),
    ...(a.value_added ? [{ id: "value" as const, label: "Value added" }] : []),
    ...(a.finance ? [{ id: "finance" as const, label: "Fees" }] : []),
    ...(a.admissions ? [{ id: "admissions" as const, label: "Admissions" }] : []),
    ...(a.census ? [{ id: "census" as const, label: "Government returns" }] : [])
  ], [a]);
  useEffect(() => {
    if (!tabs.length || tab) return;
    const want = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    setTab(tabs.some(t => t.id === want) ? want : tabs[0].id);
  }, [tabs, tab]);
  return (
    <Page wide>
      <PageHeader eyebrow="Analytics" title="Insights & returns"
        subtitle="Results by class, subject, teacher and year group; value added; fees and admissions over the year; the annual school census."
        actions={<Link href="/school/analytics" className="btn btn-outline text-xs">Early warning →</Link>} />
      {error && <Alert>{error}</Alert>}
      {!data ? <Loading /> : !tabs.length ? <Alert tone="amber">There is nothing here for your role.</Alert> : (
        <>
          <Tabs tabs={tabs} value={tab ?? tabs[0].id} onChange={setTab} />
          <div className="mt-4">
            {tab === "results" && <Results />}
            {tab === "value" && <ValueAdded />}
            {tab === "finance" && <FinanceDashboard />}
            {tab === "admissions" && <AdmissionsDashboard />}
            {tab === "census" && <Census />}
          </div>
        </>
      )}
    </Page>
  );
}
