"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi, send, Page, PageHeader, Stat, Alert } from "@/components/ui";
import { SECTIONS, STATS, DEFAULT_LAYOUT, move, type Layout, type SectionId } from "@/lib/dashboard-layout";
import KpiBoard from "@/components/school/KpiBoard";
import HeadSummary from "@/components/school/HeadSummary";

type Overview = {
  school: string; term: string | null; roles: string[];
  counts: Record<string, number>;
};

const QUICK: { href: string; label: string; desc: string }[] = [
  { href: "/school/attendance", label: "Class register", desc: "Morning register; parents told about absences" },
  { href: "/school/results", label: "Results", desc: "Score sheets, report cards, publish to parents" },
  { href: "/school/fees", label: "Fees & payments", desc: "Invoices, online payment, receipts, reminders" },
  { href: "/school/analytics", label: "Early warning", desc: "Students who need support, with reasons" },
  { href: "/school/gate", label: "Sign in / out", desc: "Gate kiosk, today's log, staff sign-in" },
  { href: "/school/students", label: "Students & parents", desc: "Records, guardians, portal links, import" },
  { href: "/school/timetable", label: "Timetable", desc: "Auto-generated, clash-free" },
  { href: "/school/lesson-notes", label: "Lesson notes", desc: "Write or draft in seconds, then approve" },
  { href: "/exams", label: "Secure exams", desc: "Build, proctor and mark exams" },
  { href: "/school/admissions", label: "Admissions", desc: "Online applications to enrolment" },
  { href: "/school/events", label: "Events & trips", desc: "Consent and payment in one step" },
  { href: "/school/messages", label: "Messages", desc: "Broadcast to parents, delivery log" }
];

export default function SchoolHome() {
  const { data, error } = useApi<Overview>("/api/school/overview");
  const c = data?.counts ?? {};
  const { data: saved, reload: reloadLayout } = useApi<{ layout: Layout; can_edit: boolean }>("/api/school/dashboard");
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { if (saved) setLayout(saved.layout); }, [saved]);
  const isHead = data?.roles?.some(r => ["school_admin", "principal", "platform_admin"].includes(r));
  const tones: Record<string, "good" | "warn" | "bad" | undefined> = {
    students_on_site: "good", late_today: (c.late_today ?? 0) > 0 ? "warn" : undefined, pending_requisitions: (c.pending_requisitions ?? 0) > 0 ? "warn" : undefined,
    pending_leave: (c.pending_leave ?? 0) > 0 ? "warn" : undefined, failed_messages: (c.failed_messages ?? 0) > 0 ? "bad" : "good"
  };
  const hints: Record<string, string> = { students_on_site: "students signed in", staff_on_site: `of ${c.staff ?? 0} staff` };
  const section = (id: SectionId) => {
    if (id === "kpis") return <KpiBoard />;
    if (id === "summary") return isHead ? <HeadSummary /> : null;
    if (id === "now") return (<>
      <h2 className="mb-3 text-lg font-semibold">Right now</h2>
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {STATS.filter(([k]) => !layout.hidden_stats.includes(k)).map(([k, label]) => <Stat key={k} label={label} value={c[k] ?? "…"} hint={hints[k]} tone={tones[k]} />)}
      </div></>);
    return (<>
      <h2 className="mb-3 text-lg font-semibold">Go to</h2>
      <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK.filter(q => !layout.hidden_links.includes(q.href)).map(q => (
          <Link key={q.href} href={q.href} className="card block p-4 transition hover:border-brand-300 hover:shadow">
            <p className="font-semibold">{q.label}</p>
            <p className="mt-0.5 text-sm text-slate-500">{q.desc}</p>
          </Link>
        ))}
      </div></>);
  };
  return (
    <Page wide>
      <PageHeader eyebrow={data?.term ?? "No current term set"} title={data?.school ?? "School"}
        subtitle="Live numbers from sign-in, results, approvals and messaging."
        actions={saved?.can_edit && !editing ? <button className="btn btn-outline" onClick={() => { setEditing(true); setNote(null); }}>Customise</button> : undefined} />
      {error && <Alert>{error}</Alert>}
      {data && !data.term && (
        <div className="mb-5"><Alert tone="amber">No current term is set. Go to <Link className="font-semibold underline" href="/school/setup">School setup</Link> to create a session and mark a term as current.</Alert></div>
      )}
      {editing && saved && <Customise layout={layout} setLayout={setLayout} onSave={async () => {
        const r = await send("/api/school/dashboard", { layout });
        setNote(r.ok ? "Saved for the school." : r.error ?? "failed"); if (r.ok) { setEditing(false); reloadLayout(); }
      }} onCancel={() => { setLayout(saved.layout); setEditing(false); }} />}
      {note && <div className="mb-4"><Alert tone={note.startsWith("Saved") ? "green" : "red"}>{note}</Alert></div>}
      {layout.sections.map(id => <div key={id}>{section(id)}</div>)}
    </Page>
  );
}

/** Admins arrange the overview for the whole school: which panels, in what order, which tiles and shortcuts. */
function Customise({ layout, setLayout, onSave, onCancel }: { layout: Layout; setLayout: (l: Layout) => void; onSave: () => void; onCancel: () => void }) {
  const on = (id: SectionId) => layout.sections.includes(id);
  const toggle = (list: string[], k: string) => (list.includes(k) ? list.filter(x => x !== k) : [...list, k]);
  return (
    <section className="card mb-6 grid gap-6 p-5 text-sm lg:grid-cols-3">
      <div>
        <h2 className="font-semibold">Panels, in order</h2>
        <ul className="mt-2 space-y-1.5">
          {[...layout.sections, ...SECTIONS.map(x => x.id).filter(id => !on(id))].map(id => (
            <li key={id} className="flex items-center gap-2">
              <input type="checkbox" checked={on(id)} aria-label={SECTIONS.find(x => x.id === id)!.label}
                onChange={() => setLayout({ ...layout, sections: on(id) ? layout.sections.filter(x => x !== id) : [...layout.sections, id] })} />
              <span className="flex-1">{SECTIONS.find(x => x.id === id)!.label}</span>
              {on(id) && <><button className="btn btn-ghost px-1.5 py-0.5 text-xs" aria-label="Move up" onClick={() => setLayout({ ...layout, sections: move(layout.sections, id, -1) })}>↑</button>
                <button className="btn btn-ghost px-1.5 py-0.5 text-xs" aria-label="Move down" onClick={() => setLayout({ ...layout, sections: move(layout.sections, id, 1) })}>↓</button></>}
            </li>))}
        </ul>
      </div>
      <div>
        <h2 className="font-semibold">Right now tiles</h2>
        <div className="mt-2 grid grid-cols-2 gap-1">{STATS.map(([k, label]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" checked={!layout.hidden_stats.includes(k)}
          onChange={() => setLayout({ ...layout, hidden_stats: toggle(layout.hidden_stats, k) })} />{label}</label>)}</div>
      </div>
      <div>
        <h2 className="font-semibold">Shortcuts</h2>
        <div className="mt-2 grid grid-cols-2 gap-1">{QUICK.map(q => <label key={q.href} className="flex items-center gap-1.5"><input type="checkbox" checked={!layout.hidden_links.includes(q.href)}
          onChange={() => setLayout({ ...layout, hidden_links: toggle(layout.hidden_links, q.href) })} />{q.label}</label>)}</div>
      </div>
      <div className="flex gap-2 lg:col-span-3"><button className="btn btn-primary" onClick={onSave}>Save for the school</button><button className="btn btn-ghost" onClick={onCancel}>Cancel</button></div>
    </section>
  );
}
