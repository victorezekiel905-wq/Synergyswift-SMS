"use client";
import { useEffect, useState } from "react";
import { Page, PageHeader, Tabs, Alert } from "@/components/ui";
import { StudentPaths, StudentContent, StudentOnline, LiteModeToggle } from "@/components/student/StudentLearning";

type TabId = "paths" | "content" | "online";

export default function MyLearning() {
  const [tab, setTab] = useState<TabId>("paths");
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("tab");
    if (t === "paths" || t === "content" || t === "online") setTab(t);
    if (q.get("notice")) setNotice(q.get("notice"));
  }, []);
  return (
    <Page wide>
      <PageHeader eyebrow="Student" title="My learning" subtitle="Learning paths from your teachers, interactive lessons and online classes."
        actions={<LiteModeToggle />} />
      {notice && <Alert tone="amber">{notice}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "paths", label: "Learning paths" }, { id: "content", label: "Interactive lessons" }, { id: "online", label: "Online classes" }]} />
      {tab === "paths" && <StudentPaths />}
      {tab === "content" && <StudentContent />}
      {tab === "online" && <StudentOnline />}
    </Page>
  );
}
