"use client";
import { useEffect, useState } from "react";
import { useApi, Page, PageHeader, Tabs } from "@/components/ui";
import ContentLibrary from "@/components/learning/ContentLibrary";
import PathsAdmin from "@/components/learning/PathsAdmin";
import OnlineLessons from "@/components/learning/OnlineLessons";
import TutorAdmin from "@/components/learning/TutorAdmin";

type TabId = "paths" | "content" | "online" | "tutor";

export default function LearningPage() {
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[]; subjects: { id: string; name: string }[] }>("/api/school/structure?mine=1");
  const [tab, setTab] = useState<TabId>("paths");
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "paths" || t === "content" || t === "online" || t === "tutor") setTab(t);
  }, []);
  const classes = structure?.class_groups ?? [], subjects = structure?.subjects ?? [];
  return (
    <Page wide>
      <PageHeader eyebrow="Teaching" title="Learning library"
        subtitle="Learning paths for each class, interactive content (SCORM, xAPI, H5P), online lessons on Zoom, Google Meet or Teams, and the students' study helper." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "paths", label: "Learning paths" }, { id: "content", label: "Content library" }, { id: "online", label: "Online lessons" }, { id: "tutor", label: "Study helper" }]} />
      {tab === "paths" && <PathsAdmin classes={classes} subjects={subjects} />}
      {tab === "content" && <ContentLibrary classes={classes} subjects={subjects} />}
      {tab === "online" && <OnlineLessons classes={classes} subjects={subjects} />}
      {tab === "tutor" && <TutorAdmin />}
    </Page>
  );
}
