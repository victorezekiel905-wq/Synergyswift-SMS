"use client";
import { useEffect, useState } from "react";
import { Page, PageHeader, Tabs, Alert } from "@/components/ui";
import { StudentPaths, StudentContent, StudentOnline, TutorChat, LiteModeToggle } from "@/components/student/StudentLearning";

type TabId = "paths" | "content" | "online" | "tutor";
type Ask = { kind: "homework" | "step"; ref_id: string; title: string };

export default function MyLearning() {
  const [tab, setTab] = useState<TabId>("paths");
  const [notice, setNotice] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("tab");
    if (t === "paths" || t === "content" || t === "online" || t === "tutor") setTab(t);
    if (q.get("notice")) setNotice(q.get("notice"));
    const hw = q.get("homework");
    if (hw && /^[0-9a-f-]{36}$/i.test(hw)) { setAsk({ kind: "homework", ref_id: hw, title: q.get("title") ?? "your homework" }); setTab("tutor"); }
  }, []);
  return (
    <Page wide>
      <PageHeader eyebrow="Student" title="My learning" subtitle="Learning paths from your teachers, interactive lessons, online classes and the study helper."
        actions={<LiteModeToggle />} />
      {notice && <Alert tone="amber">{notice}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "paths", label: "Learning paths" }, { id: "content", label: "Interactive lessons" }, { id: "online", label: "Online classes" }, { id: "tutor", label: "Study helper" }]} />
      {tab === "paths" && <StudentPaths onAsk={c => { setAsk(c); setTab("tutor"); }} />}
      {tab === "content" && <StudentContent />}
      {tab === "online" && <StudentOnline />}
      {tab === "tutor" && <TutorChat start={ask} />}
    </Page>
  );
}
