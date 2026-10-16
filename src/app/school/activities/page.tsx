"use client";
import { useEffect, useState } from "react";
import { Page, PageHeader, Tabs } from "@/components/ui";
import Clubs from "@/components/cocurricular/Clubs";
import Competitions from "@/components/cocurricular/Competitions";
import Trips from "@/components/cocurricular/Trips";

type Tab = "groups" | "competitions" | "trips";

export default function ActivitiesPage() {
  const [tab, setTab] = useState<Tab>("groups");
  const [trip, setTrip] = useState<string | null>(null);
  // Links in alerts open a tab (and a trip) directly.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("tab");
    if (t === "competitions" || t === "trips") setTab(t);
    setTrip(p.get("trip"));
  }, []);
  return (
    <Page wide>
      <PageHeader eyebrow="Co-curricular" title="Clubs, competitions & trips"
        subtitle="Clubs and teams with their members and attendance, competition results that go on each child's record, and trip rosters ticked out and back with parents told." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "groups", label: "Clubs & teams" }, { id: "competitions", label: "Competitions" }, { id: "trips", label: "Trips" }]} />
      {tab === "groups" && <Clubs />}
      {tab === "competitions" && <Competitions />}
      {tab === "trips" && <Trips initial={trip} />}
    </Page>
  );
}
