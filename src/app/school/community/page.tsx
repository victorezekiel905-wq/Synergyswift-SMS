"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi, Page, PageHeader, Tabs, Loading, rolesOf, type Me } from "@/components/ui";
import Families from "@/components/community/Families";
import Tickets from "@/components/community/Tickets";
import Surveys from "@/components/community/Surveys";
import Campaigns from "@/components/community/Campaigns";
import Retention from "@/components/community/Retention";
import Referrals from "@/components/community/Referrals";
import Alumni from "@/components/community/Alumni";
import Partners from "@/components/community/Partners";
import Fundraising from "@/components/community/Fundraising";

type Tab = "families" | "tickets" | "surveys" | "campaigns" | "retention" | "referrals" | "alumni" | "fundraising" | "partners";

export default function CommunityPage() {
  return <Suspense fallback={<Loading />}><Community /></Suspense>;
}

/** Parent and community CRM: every family's story in one place, complaints, NPS, campaigns, re-enrolment, referrals, alumni and partners. */
function Community() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: me } = useApi<Me>("/api/me");
  const { data: segs } = useApi<{ items: { id: string; name: string }[] }>(me && ["school_admin", "principal", "platform_admin"].some(r => rolesOf(me).has(r)) ? "/api/community/segments" : null);
  const admin = ["school_admin", "principal", "platform_admin"].some(r => rolesOf(me).has(r));
  const [picked, setTab] = useState<Tab>((params.get("tab") as Tab) || "families");
  // The bursar works the referral rewards and vendors only.
  const all: { id: Tab; label: string }[] = [
    { id: "families", label: "Families" }, { id: "tickets", label: "Complaints & requests" }, { id: "surveys", label: "Surveys & NPS" },
    { id: "campaigns", label: "Campaigns" }, { id: "retention", label: "Re-enrolment & retention" }, { id: "referrals", label: "Referrals" },
    { id: "alumni", label: "Alumni" }, { id: "fundraising", label: "Fundraising" }, { id: "partners", label: "Partners & vendors" }];
  const tabs = me && !admin ? all.filter(t => t.id === "referrals" || t.id === "partners" || t.id === "fundraising") : all;
  const tab = tabs.some(t => t.id === picked) ? picked : tabs[0].id;
  if (!me) return <Loading />;
  return (
    <Page wide>
      <PageHeader eyebrow="Relationships" title="Families & community"
        subtitle="Know every family: a 360° view of their children, fees, messages, complaints and survey answers. Spot families likely to leave, ask about next session, reward referrals, and stay in touch with alumni and partners." />
      <Tabs value={tab} onChange={t => { setTab(t); router.replace(`/school/community?tab=${t}`); }} tabs={tabs} />
      {tab === "families" && <Families segments={segs?.items ?? []} openId={params.get("family")} />}
      {tab === "tickets" && <Tickets openId={params.get("ticket")} />}
      {tab === "surveys" && <Surveys />}
      {tab === "campaigns" && <Campaigns />}
      {tab === "retention" && <Retention />}
      {tab === "referrals" && <Referrals admin={admin} />}
      {tab === "alumni" && <Alumni />}
      {tab === "fundraising" && <Fundraising />}
      {tab === "partners" && <Partners />}
    </Page>
  );
}
