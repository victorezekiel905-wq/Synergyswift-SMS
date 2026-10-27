"use client";
import { useState } from "react";
import { Page, PageHeader } from "@/components/ui";
import PlatformNav from "@/components/platform/PlatformNav";
import PlanPicker, { emptyChoice } from "@/components/platform/PlanPicker";
import ModulesEditor, { draftFrom } from "@/components/platform/ModulesEditor";
import { DEFAULT_PLANS, DEFAULT_GROUP_PRICES, resolveModules, planModules } from "@/lib/saas";

/** Sample platform screens (plan picker, module switches) for reviewing the design. Preview builds only. */
export default function PlatformPreview() {
  const [choice, setChoice] = useState({ ...emptyChoice(1), plan_code: "essentials", add_on_groups: ["exams" as const] });
  const rows = resolveModules(planModules(["core", "learning", "exams", "money"]), [{ module: "library", mode: "off" }, { module: "ai", mode: "on", expires_at: "2026-12-31T23:59:59Z" }]).rows;
  const [draft, setDraft] = useState(draftFrom(rows));
  if (process.env.NEXT_PUBLIC_DESIGN_PREVIEW !== "1") return <p className="p-8">Not available.</p>;
  return (
    <Page wide>
      <PlatformNav />
      <PageHeader eyebrow="Synergy Swift platform" title="Greenfield College" subtitle="Preview of the plan and module screens" />
      <section className="card mb-5 p-5" id="plan"><PlanPicker plans={DEFAULT_PLANS.map(p => ({ ...p, active: true }))} groupPrices={DEFAULT_GROUP_PRICES} value={choice} onChange={c => setChoice(c as typeof choice)} students={212} /></section>
      <section className="card p-5" id="modules"><ModulesEditor rows={rows} draft={draft} setDraft={setDraft} /></section>
    </Page>
  );
}
