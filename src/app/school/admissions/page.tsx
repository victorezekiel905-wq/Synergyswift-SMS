"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi, Page, PageHeader, Tabs, Modal, Loading, rolesOf, type Me } from "@/components/ui";
import Pipeline, { type LeadsData } from "@/components/admissions/Pipeline";
import LeadDrawer from "@/components/admissions/LeadDrawer";
import Applications from "@/components/admissions/Applications";
import Visits from "@/components/admissions/Visits";
import FollowUps from "@/components/admissions/FollowUps";
import Tasks from "@/components/admissions/Tasks";
import Analytics from "@/components/admissions/Analytics";
import Setup from "@/components/admissions/Setup";

type Tab = "pipeline" | "applications" | "visits" | "tasks" | "followups" | "analytics" | "setup";

export default function AdmissionsPage() {
  return <Suspense fallback={<Loading />}><Admissions /></Suspense>;
}

/** Admissions CRM: every family from first enquiry to enrolment. */
function Admissions() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: me } = useApi<Me>("/api/me");
  const { data: leads, reload } = useApi<LeadsData>("/api/crm/leads?owner=me");
  const { data: settings } = useApi<{ settings: { currency?: string } }>("/api/school/settings");
  const admin = ["school_admin", "principal", "platform_admin"].some(r => rolesOf(me).has(r));
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "pipeline");
  const [lead, setLead] = useState<string | null>(params.get("lead"));
  const [app, setApp] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => { const l = params.get("lead"); if (l) setLead(l); }, [params]);
  const openLead = (id: string) => { setLead(id); router.replace(`/school/admissions?tab=${tab}&lead=${id}`); };
  const closeLead = () => { setLead(null); router.replace(`/school/admissions?tab=${tab}`); };
  const myOpenTasks = (leads?.tasks ?? []).filter(t => t.assigned_to === leads?.me).length;
  return (
    <Page wide>
      <PageHeader eyebrow="Growth" title="Admissions"
        subtitle="Every family from first enquiry to enrolment: capture from your website, WhatsApp, ads, walk-ins and open days; automatic follow-ups; tours, entrance tests, offers signed online, and the numbers that show what works." />
      <Tabs value={tab} onChange={t => { setTab(t); router.replace(`/school/admissions?tab=${t}`); }} tabs={[
        { id: "pipeline", label: "Pipeline" }, { id: "applications", label: "Applications" }, { id: "visits", label: "Tours & open days" },
        { id: "tasks", label: `My tasks${myOpenTasks ? ` (${myOpenTasks})` : ""}` }, { id: "followups", label: "Follow-ups" }, { id: "analytics", label: "Analytics" }, { id: "setup", label: "Setup" }]} />
      <div key={version}>
        {tab === "pipeline" && <Pipeline onOpen={openLead} />}
        {tab === "applications" && <Applications admin={admin} openId={app} onOpenLead={openLead} />}
        {tab === "visits" && <Visits onOpenLead={openLead} />}
        {tab === "tasks" && <Tasks onOpenLead={openLead} mineOnly />}
        {tab === "followups" && <FollowUps />}
        {tab === "analytics" && <Analytics currency={settings?.settings?.currency ?? "NGN"} />}
        {tab === "setup" && <Setup />}
      </div>
      <Modal open={Boolean(lead)} onClose={closeLead} title="Family" wide>
        {lead && <LeadDrawer id={lead} staff={leads?.staff ?? []} onClose={closeLead} onChanged={() => { reload(); setVersion(v => v + 1); }}
          openApplication={id => { closeLead(); setApp(id); setTab("applications"); }} />}
      </Modal>
    </Page>
  );
}
