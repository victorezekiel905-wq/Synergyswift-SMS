"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Modal, Field, Badge, Stat, fmtDate } from "@/components/ui";

type Row = { id: string; name: string; admission_no: string; class_name: string | null; score: number; level: "low" | "medium" | "high"; factors: { factor: string; points: number; detail: string }[] };
type Intervention = { id: string; student_id: string; reason: string; plan: string | null; status: string; review_on: string | null; outcome: string | null; created_at: string;
  students: { first_name: string; last_name: string; class_groups: { name: string } | null }; owner: { full_name: string } | null };

export default function AnalyticsPage() {
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[] }>("/api/school/structure");
  const [cg, setCg] = useState("");
  const { data, error, reload } = useApi<{ term: string | null; summary: { high: number; medium: number; low: number }; students: Row[]; interventions: Intervention[] }>(`/api/analytics${cg ? `?class_group_id=${cg}` : ""}`, [cg]);
  const [tab, setTab] = useState<"risk" | "plans">("risk");
  const [plan, setPlan] = useState<Row | null>(null);
  const [level, setLevel] = useState<"high" | "medium" | "all">("high");
  const list = (data?.students ?? []).filter(s => level === "all" || s.level === level || (level === "medium" && s.level === "high"));
  const open = (data?.interventions ?? []).filter(i => i.status === "open");
  return (
    <Page wide>
      <PageHeader eyebrow="Early warning" title="Students who need support"
        subtitle="A risk score from attendance, results, their direction of travel, behaviour and missing homework, with the reasons shown. Act early with a support plan."
        actions={<select className="input w-auto" value={cg} onChange={e => setCg(e.target.value)} aria-label="Class"><option value="">Whole school</option>{(structure?.class_groups ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>} />
      {error && <Alert>{error}</Alert>}
      {data && <div className="mb-5 grid grid-cols-3 gap-3"><Stat label="High risk" value={data.summary.high} tone={data.summary.high ? "bad" : "good"} /><Stat label="Medium risk" value={data.summary.medium} tone={data.summary.medium ? "warn" : undefined} /><Stat label="Open support plans" value={open.length} /></div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "risk", label: "Risk list" }, { id: "plans", label: "Support plans" }]} />
      {tab === "risk" && (
        <>
          <div className="mb-3 flex gap-2">{(["high", "medium", "all"] as const).map(l => <button key={l} className={"btn " + (level === l ? "btn-primary" : "btn-ghost border border-slate-200")} onClick={() => setLevel(l)}>{l === "medium" ? "Medium and high" : l === "all" ? "Everyone" : "High"}</button>)}</div>
          {!list.length ? <Empty>No students at this level. </Empty> : (
            <div className="card overflow-x-auto"><table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Student</th><th className="p-2">Class</th><th className="p-2 text-center">Risk</th><th className="p-2">Why</th><th className="p-2" /></tr></thead>
              <tbody>{list.map(s => {
                const hasPlan = open.some(i => i.student_id === s.id);
                return (
                  <tr key={s.id} className="border-t border-slate-100 align-top"><td className="p-2 font-medium">{s.name}<div className="text-xs text-slate-400">{s.admission_no}</div></td><td className="p-2">{s.class_name}</td>
                    <td className="p-2 text-center"><span className={"inline-block min-w-[3rem] rounded px-2 py-1 font-bold text-white " + (s.level === "high" ? "bg-rose-600" : s.level === "medium" ? "bg-amber-500" : "bg-emerald-600")}>{s.score}</span></td>
                    <td className="p-2 text-xs">{s.factors.map(f => <div key={f.factor}>• {f.detail}</div>)}</td>
                    <td className="p-2 text-right">{hasPlan ? <Badge tone="blue">plan open</Badge> : <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setPlan(s)}>Start support plan</button>}</td></tr>
                );
              })}</tbody></table></div>
          )}
        </>
      )}
      {tab === "plans" && (!data?.interventions.length ? <Empty>No support plans yet.</Empty> : (
        <div className="space-y-2">{data.interventions.map(i => (
          <div key={i.id} className="card p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><span><b>{i.students.first_name} {i.students.last_name}</b> ({i.students.class_groups?.name}) · owner {i.owner?.full_name ?? "—"} · opened {fmtDate(i.created_at)}{i.review_on ? ` · review ${fmtDate(i.review_on)}` : ""}</span>
              <Badge tone={i.status === "open" ? "amber" : "green"}>{i.status}</Badge></div>
            <p className="mt-1"><b>Why:</b> {i.reason}</p>{i.plan && <p><b>Plan:</b> {i.plan}</p>}{i.outcome && <p><b>Outcome:</b> {i.outcome}</p>}
            {i.status === "open" && <button className="btn btn-ghost mt-2 px-2 py-1 text-xs" onClick={async () => { const o = prompt("Outcome"); if (o) { await send("/api/analytics", { action: "close", id: i.id, outcome: o }); reload(); } }}>Close plan</button>}
          </div>))}</div>
      ))}
      <Modal open={Boolean(plan)} onClose={() => setPlan(null)} title={`Support plan: ${plan?.name ?? ""}`}>
        {plan && <PlanForm row={plan} onDone={() => { setPlan(null); reload(); setTab("plans"); }} />}
      </Modal>
    </Page>
  );
}

function PlanForm({ row, onDone }: { row: Row; onDone: () => void }) {
  const [f, setF] = useState({ reason: row.factors.map(x => x.detail).join("; "), plan: "", review_on: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-3" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/analytics", { action: "open", student_id: row.id, reason: f.reason, plan: f.plan || null, review_on: f.review_on || null });
      if (!r.ok) return setErr(r.error);
      onDone();
    }}>
      <Field label="Concern"><textarea className="input h-20" required value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
      <Field label="Plan (who does what, by when)"><textarea className="input h-28" value={f.plan} onChange={e => setF({ ...f, plan: e.target.value })} placeholder="e.g. Weekly check-in with form teacher; extra maths lessons Tue/Thu; call parents on Friday" /></Field>
      <Field label="Review on"><input className="input" type="date" value={f.review_on} onChange={e => setF({ ...f, review_on: e.target.value })} /></Field>
      {err && <Alert>{err}</Alert>}
      <button className="btn btn-primary w-full">Start plan</button>
    </form>
  );
}
