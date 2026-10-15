"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi, Page, PageHeader, Alert, Badge, Empty, Loading, Stat, fmtDate } from "@/components/ui";
import { SEN_NEEDS, ARRANGEMENTS } from "@/lib/sis";

type Item = { student_id: string; name: string; admission_no: string; class_name: string | null; status: string; areas: string[]; needs: string[]; extra_time_pct: number; arrangements: string[]; coordinator: string | null;
  plan: { id: string; title: string; review_on: string | null; review: string; total: number; on_track: number } | null };
type Data = { items: Item[]; summary: { total: number; monitoring: number; sen_support: number; ehcp: number; with_plan: number; reviews_due: number; by_area: { key: string; label: string; count: number }[] }; status_label: Record<string, string> };

/** Everyone on the SEN register, their plan and when it is reviewed, and exam arrangements to set up. */
export default function SenRegister() {
  const { data, error } = useApi<Data>("/api/sis/sen");
  const [area, setArea] = useState("");
  const [view, setView] = useState<"all" | "reviews" | "exams">("all");
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const s = data.summary;
  const items = data.items.filter(i => (!area || i.areas.includes(area)) && (view !== "reviews" || (i.plan && ["due_soon", "overdue"].includes(i.plan.review)))
    && (view !== "exams" || i.extra_time_pct > 0 || i.arrangements.length > 0));
  return (
    <Page wide>
      <PageHeader eyebrow="Pastoral" title="SEN register"
        subtitle="Children with special educational needs, their support plans and review dates, and exam access arrangements. Teachers see the children they teach whose profiles are shared with them." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="On the register" value={s.total} />
        <Stat label="Monitoring" value={s.monitoring} />
        <Stat label="SEN support" value={s.sen_support} />
        <Stat label="EHC plan / statement" value={s.ehcp} />
        <Stat label="Plan reviews due" value={s.reviews_due} tone={s.reviews_due ? "warn" : "good"} hint={`${s.with_plan} with a live plan`} />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <select className="input w-auto" value={view} onChange={e => setView(e.target.value as typeof view)} aria-label="Show"><option value="all">Everyone</option><option value="reviews">Reviews due</option><option value="exams">Exam arrangements</option></select>
        <select className="input w-auto" value={area} onChange={e => setArea(e.target.value)} aria-label="Area"><option value="">All areas</option>{s.by_area.map(a => <option key={a.key} value={a.key}>{a.label} ({a.count})</option>)}</select>
        {view === "exams" && <button className="btn btn-outline" onClick={() => window.print()}>Print for invigilators</button>}
      </div>
      {!items.length ? <Empty>No children match.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Student</th><th className="p-2">Status</th><th className="p-2">Needs</th><th className="p-2">Exams</th><th className="p-2">Plan</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{items.map(i => (
            <tr key={i.student_id}>
              <td className="p-2"><Link className="font-medium text-brand-700 hover:underline" href={`/school/students/${i.student_id}#sen`}>{i.name}</Link><span className="block text-xs text-slate-500">{i.admission_no} · {i.class_name ?? "no class"}</span></td>
              <td className="p-2"><Badge tone={i.status === "ehcp" ? "violet" : i.status === "sen_support" ? "amber" : "slate"}>{data.status_label[i.status]}</Badge>{i.coordinator && <span className="block text-xs text-slate-500">{i.coordinator}</span>}</td>
              <td className="p-2 text-xs">{i.needs.map(n => SEN_NEEDS[n] ?? n).join(", ") || "—"}</td>
              <td className="p-2 text-xs">{[i.extra_time_pct ? `${i.extra_time_pct}% extra time` : null, ...i.arrangements.map(a => ARRANGEMENTS[a] ?? a)].filter(Boolean).join(", ") || "—"}</td>
              <td className="p-2 text-xs">{i.plan ? <>{i.plan.title}<span className="block">{i.plan.on_track}/{i.plan.total} targets on track{i.plan.review_on ? ` · review ${fmtDate(i.plan.review_on)}` : ""}</span>
                {i.plan.review === "overdue" && <Badge tone="red">overdue</Badge>}{i.plan.review === "due_soon" && <Badge tone="amber">due soon</Badge>}</> : <span className="text-slate-400">No live plan</span>}</td>
            </tr>
          ))}</tbody></table></div>
      )}
    </Page>
  );
}
