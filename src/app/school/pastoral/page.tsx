"use client";
import { useEffect, useState } from "react";
import { useApi, Page, PageHeader, Tabs } from "@/components/ui";
import { Safeguarding, Counselling, Wellbeing, PastoralSettings } from "@/components/pastoral/Care";

type Tab = "safeguarding" | "counselling" | "wellbeing" | "settings";

export default function PastoralPage() {
  const { data, reload } = useApi<{ dsl: boolean; counsellor: boolean; admin: boolean; settings: any; unacknowledged: number; new_referrals: number; checkins_to_follow_up: number }>("/api/pastoral?view=overview");
  const [tab, setTab] = useState<Tab>("safeguarding");
  const [concern, setConcern] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("concern")) { setConcern(q.get("concern")); setTab("safeguarding"); }
    const t = q.get("tab") as Tab | null;
    if (t) setTab(t);
  }, []);
  const tabs: { id: Tab; label: string }[] = [
    { id: "safeguarding", label: `Safeguarding${data?.unacknowledged ? ` (${data.unacknowledged} new)` : ""}` },
    { id: "counselling", label: `Counselling${data?.new_referrals ? ` (${data.new_referrals})` : ""}` },
    { id: "wellbeing", label: `Wellbeing${data?.checkins_to_follow_up ? ` (${data.checkins_to_follow_up})` : ""}` },
    ...(data?.admin ? [{ id: "settings" as Tab, label: "Settings" }] : [])
  ];
  return (
    <Page wide>
      <PageHeader eyebrow="Pastoral" title="Pastoral care" subtitle="Report safeguarding concerns to the team that handles them, refer students to counselling, and follow up students who say they are struggling. Confidential records are seen only by the people who need them, and every opening is logged." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "safeguarding" && <Safeguarding initial={concern} />}
      {tab === "counselling" && <Counselling />}
      {tab === "wellbeing" && <Wellbeing admin={Boolean(data?.admin)} />}
      {tab === "settings" && data && <PastoralSettings settings={data.settings} onSaved={reload} />}
    </Page>
  );
}
