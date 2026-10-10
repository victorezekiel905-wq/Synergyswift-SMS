"use client";
import { useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field, Loading, Modal, Stat, fmtDate, money, statusTone } from "@/components/ui";
import { REASON_LABEL, REENROL_REASONS, type FamilySummary } from "@/lib/community";
import { FamilyProfile, npsBadge } from "./Families";

type Round = { id: string; title: string; message: string | null; class_group_ids: string[]; deadline: string | null; status: string; created_at: string };
type Summary = { students: number; returning: number; not_returning: number; undecided: number; no_response: number; response_rate: number; reasons: Record<string, number> };
type Data = {
  rounds: Round[]; round: Round | null; classes: { id: string; name: string }[]; currency: string;
  detail: null | { summary: Summary; by_class: (Summary & { class_name: string })[]; students: { id: string; name: string; class_name: string | null; intent: string | null; reason: string | null; note: string | null; responded_at: string | null; by: string | null }[] };
  at_risk: FamilySummary[]; counts: { high: number; medium: number; families: number };
};
const INTENT_TONE: Record<string, "green" | "red" | "amber" | "slate"> = { returning: "green", not_returning: "red", undecided: "amber" };

/** Re-enrolment rounds ("will your child return?") and the families most likely to leave, with reasons. */
export default function Retention() {
  const [roundId, setRoundId] = useState<string | null>(null);
  const { data, error, reload } = useApi<Data>(`/api/community/retention${roundId ? `?round=${roundId}` : ""}`);
  const [edit, setEdit] = useState<Partial<Round> | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const act = async (body: Record<string, unknown>, ok: (d: any) => string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    const r = await send("/api/community/retention", body);
    setMsg({ ok: r.ok, text: r.ok ? ok(r.data) : r.error ?? "failed" });
    reload();
  };
  const r = data.round, d = data.detail;
  const students = (d?.students ?? []).filter(s => !filter || (filter === "none" ? !s.intent : s.intent === filter));
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="flex-1 font-semibold">Re-enrolment</h3>
          {data.rounds.length > 1 && <select className="input w-auto" value={r?.id ?? ""} onChange={e => setRoundId(e.target.value)} aria-label="Round">{data.rounds.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select>}
          <button className="btn btn-primary" onClick={() => setEdit({ title: "", message: "", class_group_ids: [], deadline: null })}>New round</button>
        </div>
        {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
        {!r ? <Empty>Ask families whether each child will return next session. Answers feed the retention flags below and help plan classes.</Empty> : (
          <div className="card space-y-3 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <p className="flex-1"><b>{r.title}</b> <Badge tone={statusTone(r.status === "open" ? "active" : r.status)}>{r.status}</Badge>
                <span className="block text-xs text-slate-500">{r.class_group_ids.length ? `${r.class_group_ids.length} classes` : "Every class"}{r.deadline ? ` · answer by ${fmtDate(r.deadline)}` : ""}</span></p>
              {r.status !== "open" && <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => act({ action: "open", id: r.id }, x => `Opened. Asked ${x.sent?.families ?? 0} families.`, "Open this round and ask every family now?")}>Open and ask families</button>}
              {r.status === "open" && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "remind", id: r.id }, x => `Reminded ${x.sent.families} famil${x.sent.families === 1 ? "y" : "ies"}.`)}>Remind non-responders</button>}
              {r.status === "open" && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "close", id: r.id }, () => "Closed.")}>Close</button>}
              <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setEdit(r)}>Edit</button>
              {r.status === "draft" && <button className="btn btn-outline px-2 py-1 text-xs text-rose-700" onClick={() => act({ action: "delete", id: r.id }, () => "Deleted.", "Delete this round?")}>Delete</button>}
            </div>
            {d && <>
              <div className="grid gap-3 sm:grid-cols-5">
                <Stat label="Answered" value={`${d.summary.response_rate}%`} hint={`${d.summary.students - d.summary.no_response} of ${d.summary.students}`} />
                <Stat label="Returning" value={d.summary.returning} tone="good" />
                <Stat label="Undecided" value={d.summary.undecided} tone={d.summary.undecided ? "warn" : undefined} />
                <Stat label="Not returning" value={d.summary.not_returning} tone={d.summary.not_returning ? "bad" : undefined} />
                <Stat label="No answer" value={d.summary.no_response} />
              </div>
              {Object.keys(d.summary.reasons).length > 0 && <p className="text-xs text-slate-600">Reasons for leaving: {Object.entries(d.summary.reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${REASON_LABEL[k as keyof typeof REASON_LABEL] ?? k} (${v})`).join(" · ")}</p>}
              <details><summary className="cursor-pointer text-xs font-medium">By class</summary>
                <table className="mt-2 w-full text-xs"><thead className="text-left text-slate-500"><tr><th>Class</th><th>Students</th><th>Returning</th><th>Undecided</th><th>Not returning</th><th>No answer</th></tr></thead>
                  <tbody>{d.by_class.map(c => <tr key={c.class_name}><td>{c.class_name}</td><td>{c.students}</td><td>{c.returning}</td><td>{c.undecided}</td><td>{c.not_returning}</td><td>{c.no_response}</td></tr>)}</tbody></table>
              </details>
              <div className="flex items-center gap-2"><span className="text-xs">Show</span>
                <select className="input w-auto py-1 text-xs" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter students"><option value="">Everyone</option><option value="not_returning">Not returning</option><option value="undecided">Undecided</option><option value="none">No answer</option><option value="returning">Returning</option></select></div>
              <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">{students.map(s => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-1">
                  <span className="flex-1">{s.name} <span className="text-xs text-slate-500">{s.class_name ?? ""}</span>{s.note && <span className="block text-xs text-slate-500">“{s.note}”</span>}</span>
                  {s.intent ? <Badge tone={INTENT_TONE[s.intent]}>{s.intent.replace("_", " ")}{s.reason ? `: ${REASON_LABEL[s.reason as keyof typeof REASON_LABEL] ?? s.reason}` : ""}</Badge> : <span className="text-xs text-slate-400">no answer</span>}
                  <select className="input w-auto py-0.5 text-xs" value="" aria-label={`Record answer for ${s.name}`} onChange={e => {
                    const [intent, reason] = e.target.value.split(":");
                    if (intent) act({ action: "record", id: r.id, student_id: s.id, intent, reason: reason || null }, () => `Recorded for ${s.name}.`);
                  }}>
                    <option value="">Record answer…</option><option value="returning">Returning</option><option value="undecided">Undecided</option>
                    {REENROL_REASONS.map(x => <option key={x} value={`not_returning:${x}`}>Not returning: {REASON_LABEL[x]}</option>)}
                  </select>
                </li>
              ))}</ul>
            </>}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">Families at risk of leaving <span className="text-sm font-normal text-slate-500">{data.counts.high} high · {data.counts.medium} medium of {data.counts.families}</span></h3>
        <p className="text-sm text-slate-600">Built from re-enrolment answers, survey scores, overdue fees, unresolved complaints, attendance and siblings who left. Call the family, log the call, and fix what you can.</p>
        {!data.at_risk.length ? <Empty>No families are flagged right now.</Empty> : (
          <ul className="card divide-y divide-slate-100 text-sm">{data.at_risk.map(f => (
            <li key={f.id} className="flex cursor-pointer flex-wrap items-center gap-3 p-3 hover:bg-slate-50" onClick={() => setFamily(f.id)}>
              <Badge tone={f.risk.level === "high" ? "red" : "amber"}>{f.risk.score}</Badge>
              <span className="min-w-48 flex-1"><b>{f.full_name}</b> <span className="text-xs text-slate-500">{f.children.map(c => c.name.split(" ")[0]).join(", ")}</span>
                <span className="block text-xs text-slate-600">{f.risk.reasons.join(" · ")}</span></span>
              <span className="text-xs">NPS {npsBadge(f.last_nps)}</span>
              {f.balance > 0 && <span className="text-xs tabular-nums">{money(f.balance, data.currency)}</span>}
              <span className="text-xs text-slate-500">{f.last_contact_at ? `last contact ${fmtDate(f.last_contact_at)}` : "no contact logged"}</span>
            </li>
          ))}</ul>
        )}
      </section>

      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit round" : "New re-enrolment round"}>
        {edit && <RoundEditor r={edit} classes={data.classes} onDone={id => { setEdit(null); setRoundId(id); reload(); }} />}
      </Modal>
      <Modal open={Boolean(family)} onClose={() => { setFamily(null); reload(); }} title="Family" wide>
        {family && <FamilyProfile id={family} currency={data.currency} />}
      </Modal>
    </div>
  );
}

function RoundEditor({ r, classes, onDone }: { r: Partial<Round>; classes: { id: string; name: string }[]; onDone: (id: string) => void }) {
  const [f, setF] = useState({ title: r.title ?? "", message: r.message ?? "", class_group_ids: r.class_group_ids ?? [], deadline: r.deadline ?? "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-3 text-sm" onSubmit={async e => {
      e.preventDefault();
      const res = await send<{ id: string }>("/api/community/retention", { action: "save", id: r.id ?? null, title: f.title, message: f.message || null, class_group_ids: f.class_group_ids, deadline: f.deadline || null });
      if (res.ok) onDone(res.data.id); else setErr(res.error);
    }}>
      {err && <Alert>{err}</Alert>}
      <Field label="Title" hint='e.g. "2027/2028 session"'><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required minLength={2} maxLength={120} /></Field>
      <Field label="Message to families (optional)"><textarea className="input min-h-20" value={f.message} onChange={e => setF({ ...f, message: e.target.value })} maxLength={1000} placeholder="e.g. Early-payment discount ends 30 June." /></Field>
      <Field label="Classes" hint="None selected = every class. Leave out final-year classes."><select className="input" multiple size={5} value={f.class_group_ids} onChange={e => setF({ ...f, class_group_ids: [...e.target.selectedOptions].map(o => o.value) })}>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Answer by"><input className="input" type="date" value={f.deadline} onChange={e => setF({ ...f, deadline: e.target.value })} /></Field>
      <button className="btn btn-primary">Save</button>
    </form>
  );
}
