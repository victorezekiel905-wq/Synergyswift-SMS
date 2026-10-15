"use client";
import { useApi, Alert, Badge, Stat, fmtDate } from "@/components/ui";

type Data = { today: string; headcount: number; pending_leave: number;
  alerts: { kind: "contract" | "probation" | "qualification"; staff_id: string; staff_name: string; date: string; days: number; text: string }[];
  gaps: { staff_id: string; full_name: string; gaps: string[] }[];
  checklists: { id: string; staff_id: string; name: string; kind: string; staff_name: string; started_on: string; done: number; total: number; overdue: number }[];
  away: { name: string; leave_type: string; until: string }[];
  recruitment: Record<string, number> };

/** What needs HR's attention: contracts and probation ending, licences expiring, incomplete records, checklists, leave and recruitment. */
export function HrOverview({ onOpenStaff, onTab }: { onOpenStaff: (id: string) => void; onTab: (t: string) => void }) {
  const { data, error } = useApi<Data>("/api/hr/people?view=overview");
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const inPipeline = (data.recruitment.applied ?? 0) + (data.recruitment.shortlisted ?? 0) + (data.recruitment.interview ?? 0) + (data.recruitment.offer ?? 0);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Staff" value={data.headcount} />
        <button className="text-left" onClick={() => onTab("leave")}><Stat label="Leave to decide" value={data.pending_leave} tone={data.pending_leave ? "warn" : undefined} /></button>
        <Stat label="Away today" value={data.away.length} />
        <button className="text-left" onClick={() => onTab("recruitment")}><Stat label="Candidates in progress" value={inPipeline} hint={data.recruitment.applied ? `${data.recruitment.applied} new` : undefined} /></button>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Coming up (next 45 days)</h2>
          {!data.alerts.length ? <p className="text-sm text-slate-500">No contracts, probations or licences due.</p> : (
            <ul className="space-y-1.5 text-sm">{data.alerts.map((a, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <Badge tone={a.days < 0 ? "red" : a.days <= 14 ? "amber" : "slate"}>{a.kind}</Badge>
                <button className="font-medium text-brand-700 hover:underline" onClick={() => onOpenStaff(a.staff_id)}>{a.staff_name}</button>
                <span className="text-slate-600">{a.text}</span><span className="ml-auto text-xs text-slate-500">{fmtDate(a.date)}</span>
              </li>))}</ul>
          )}
        </section>
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Onboarding and offboarding</h2>
          {!data.checklists.length ? <p className="text-sm text-slate-500">Nothing under way.</p> : (
            <ul className="space-y-2 text-sm">{data.checklists.map(c => (
              <li key={c.id}>
                <div className="flex flex-wrap items-center gap-2"><Badge tone={c.kind === "onboarding" ? "blue" : "violet"}>{c.kind}</Badge>
                  <button className="font-medium text-brand-700 hover:underline" onClick={() => onOpenStaff(c.staff_id)}>{c.staff_name}</button>
                  <span className="text-xs text-slate-500">{c.done}/{c.total}</span>{c.overdue > 0 && <Badge tone="red">{c.overdue} overdue</Badge>}</div>
                <div className="mt-1 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-emerald-500" style={{ width: `${c.total ? (c.done / c.total) * 100 : 0}%` }} /></div>
              </li>))}</ul>
          )}
        </section>
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Incomplete records</h2>
          {!data.gaps.length ? <p className="text-sm text-slate-500">Every record is complete.</p> : (
            <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">{data.gaps.map(g => (
              <li key={g.staff_id}><button className="font-medium text-brand-700 hover:underline" onClick={() => onOpenStaff(g.staff_id)}>{g.full_name}</button> <span className="text-slate-500">— {g.gaps.join(", ")}</span></li>))}</ul>
          )}
        </section>
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Away today</h2>
          {!data.away.length ? <p className="text-sm text-slate-500">Everyone is in.</p> : (
            <ul className="space-y-1 text-sm">{data.away.map((a, i) => <li key={i}><span className="font-medium">{a.name}</span> <span className="capitalize text-slate-500">{a.leave_type}</span>, back after {fmtDate(a.until)}</li>)}</ul>
          )}
        </section>
      </div>
    </div>
  );
}
