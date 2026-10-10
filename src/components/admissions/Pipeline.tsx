"use client";
import { useMemo, useState } from "react";
import { useApi, send, Alert, Badge, Field, Modal, Loading } from "@/components/ui";
import { STAGES, STAGE_LABEL, SOURCES, SOURCE_LABEL, type Stage } from "@/lib/crm";

export type LeadCard = {
  id: string; stage: Stage; parent_name: string; email: string | null; phone: string | null; child_name: string | null; applying_for: string | null; intake: string | null;
  source: string; owner_id: string | null; score: number; next_follow_up_at: string | null; last_contact_at: string | null; application_id: string | null; created_at: string; updated_at: string; lost_reason: string | null;
};
export type LeadsData = { leads: LeadCard[]; staff: { id: string; full_name: string }[]; tasks: { id: string; lead_id: string; body: string; due_at: string; assigned_to: string | null }[]; me: string };

const STAGE_TONE: Record<Stage, string> = { enquiry: "border-slate-300", tour_booked: "border-sky-300", applied: "border-indigo-300", assessed: "border-violet-300", offered: "border-amber-300", accepted: "border-emerald-300", enrolled: "border-emerald-500", lost: "border-rose-300" };
export const scoreTone = (s: number) => (s >= 60 ? "green" : s >= 30 ? "amber" : "slate") as "green" | "amber" | "slate";

/**
 * Kanban board of every open family, Enquiry → Enrolled / Lost. Drag a card
 * to move it (stages after "Applied" follow the application, so those cards
 * open the family instead). Filters for owner and source, and quick add.
 */
export default function Pipeline({ onOpen }: { onOpen: (id: string) => void }) {
  const [owner, setOwner] = useState("");
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const qs = new URLSearchParams({ ...(owner ? { owner } : {}), ...(source ? { source } : {}), ...(search ? { search } : {}) }).toString();
  const { data, error, reload } = useApi<LeadsData>(`/api/crm/leads${qs ? `?${qs}` : ""}`, [qs]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [lostFor, setLostFor] = useState<LeadCard | null>(null);
  const staffName = useMemo(() => new Map((data?.staff ?? []).map(s => [s.id, s.full_name])), [data]);

  async function move(lead: LeadCard, stage: Stage) {
    setDragging(null);
    if (lead.stage === stage) return;
    if (stage === "lost") return setLostFor(lead);
    if (lead.application_id && !["enquiry", "tour_booked"].includes(stage)) { setMsg("This family has an application: change its status under Applications and the board follows."); onOpen(lead.id); return; }
    if (!lead.application_id && ["assessed", "offered", "accepted", "enrolled"].includes(stage)) { setMsg("Start an application for this family first (open the card)."); onOpen(lead.id); return; }
    if (stage === "applied") { onOpen(lead.id); setMsg("Open the family and press Start application."); return; }
    const r = await send("/api/crm/leads", { action: "stage", id: lead.id, stage });
    if (!r.ok) setMsg(r.error); else { setMsg(null); reload(); }
  }

  const overdue = (l: LeadCard) => l.next_follow_up_at && new Date(l.next_follow_up_at) < new Date() && !["enrolled", "lost"].includes(l.stage);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <input className="input max-w-xs" placeholder="Search name, phone or email" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search leads" />
        <select className="input w-auto" value={owner} onChange={e => setOwner(e.target.value)} aria-label="Owner"><option value="">Everyone</option><option value="me">Mine</option>{(data?.staff ?? []).map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>
        <select className="input w-auto" value={source} onChange={e => setSource(e.target.value)} aria-label="Source"><option value="">All sources</option>{SOURCES.map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</select>
        <button className="btn btn-primary ml-auto" onClick={() => setAdding(true)}>+ Add enquiry</button>
      </div>
      {error && <Alert>{error}</Alert>}
      {msg && <Alert tone="amber">{msg}</Alert>}
      {!data ? <Loading /> : (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {STAGES.map(stage => {
            const cards = data.leads.filter(l => l.stage === stage).sort((a, b) => b.score - a.score);
            return (
              <section key={stage} className={"flex w-64 shrink-0 flex-col rounded-lg border-t-4 bg-slate-50 " + STAGE_TONE[stage]}
                onDragOver={e => e.preventDefault()} onDrop={() => { const l = data.leads.find(x => x.id === dragging); if (l) move(l, stage); }} aria-label={STAGE_LABEL[stage]}>
                <header className="flex items-center justify-between px-3 py-2 text-sm font-semibold"><span>{STAGE_LABEL[stage]}</span><span className="text-xs text-slate-500">{cards.length}</span></header>
                <ul className="flex-1 space-y-2 px-2 pb-2">
                  {cards.slice(0, 80).map(l => (
                    <li key={l.id} draggable onDragStart={() => setDragging(l.id)} onDragEnd={() => setDragging(null)}
                      className={"cursor-grab rounded-md border bg-white p-2 text-sm shadow-sm hover:border-brand-400 " + (dragging === l.id ? "opacity-50" : "")}>
                      <button className="block w-full text-left" onClick={() => onOpen(l.id)}>
                        <div className="flex items-start justify-between gap-1"><span className="font-medium">{l.parent_name}</span><Badge tone={scoreTone(l.score)}>{l.score}</Badge></div>
                        <p className="text-xs text-slate-500">{[l.child_name, l.applying_for].filter(Boolean).join(" · ") || "No child details yet"}</p>
                        <p className="mt-1 flex flex-wrap gap-1 text-[11px] text-slate-500">
                          <span>{SOURCE_LABEL[l.source as keyof typeof SOURCE_LABEL] ?? l.source}</span>
                          {l.owner_id && <span>· {staffName.get(l.owner_id)?.split(" ")[0]}</span>}
                          {overdue(l) && <span className="font-semibold text-rose-600">· follow-up overdue</span>}
                          {stage === "lost" && l.lost_reason && <span>· {l.lost_reason}</span>}
                        </p>
                      </button>
                      {/* Keyboard and touch alternative to dragging */}
                      <select className="mt-1 w-full rounded border border-slate-200 text-[11px]" value={l.stage} aria-label={`Move ${l.parent_name}`} onChange={e => move(l, e.target.value as Stage)}>
                        {STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                      </select>
                    </li>
                  ))}
                  {cards.length > 80 && <li className="px-1 text-xs text-slate-500">+{cards.length - 80} more (use search)</li>}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add an enquiry" wide>
        {adding && <AddLead staff={data?.staff ?? []} onDone={id => { setAdding(false); reload(); onOpen(id); }} />}
      </Modal>
      <Modal open={Boolean(lostFor)} onClose={() => setLostFor(null)} title="Why did the family not go ahead?">
        {lostFor && <LostForm onSave={async reason => { const r = await send("/api/crm/leads", { action: "stage", id: lostFor.id, stage: "lost", note: reason }); setLostFor(null); if (!r.ok) setMsg(r.error); reload(); }} />}
      </Modal>
    </div>
  );
}

export function LostForm({ onSave }: { onSave: (reason: string) => void }) {
  const reasons = ["Fees too high", "Chose another school", "Distance / transport", "No place available", "Did not meet entry requirements", "Moved away", "No response"];
  const [r, setR] = useState("");
  return (
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (r.trim()) onSave(r.trim()); }}>
      <div className="flex flex-wrap gap-2">{reasons.map(x => <button type="button" key={x} className={"rounded-full border px-3 py-1 text-sm " + (r === x ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200")} onClick={() => setR(x)}>{x}</button>)}</div>
      <Field label="Reason"><input className="input" value={r} onChange={e => setR(e.target.value)} required /></Field>
      <div className="flex justify-end"><button className="btn btn-danger">Mark as lost</button></div>
    </form>
  );
}

function AddLead({ staff, onDone }: { staff: { id: string; full_name: string }[]; onDone: (id: string) => void }) {
  const blank = { parent_name: "", phone: "", email: "", child_name: "", child_dob: "", applying_for: "", intake: "", source: "walk_in", notes: "", owner_id: "", referral_code: "" };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const bind = (k: keyof typeof blank) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <form className="grid gap-3 sm:grid-cols-3" onSubmit={async e => {
      e.preventDefault();
      if (!f.phone && !f.email) return setErr("Add a phone number or an email.");
      const r = await send<{ id: string; merged: boolean }>("/api/crm/leads", { action: "create", ...f });
      if (!r.ok) return setErr(r.error);
      onDone(r.data.id);
    }}>
      <Field label="Parent's name"><input className="input" required {...bind("parent_name")} /></Field>
      <Field label="Phone / WhatsApp"><input className="input" {...bind("phone")} /></Field>
      <Field label="Email"><input className="input" type="email" {...bind("email")} /></Field>
      <Field label="Child's name"><input className="input" {...bind("child_name")} /></Field>
      <Field label="Child's date of birth"><input className="input" type="date" {...bind("child_dob")} /></Field>
      <Field label="Class wanted"><input className="input" {...bind("applying_for")} placeholder="JSS1" /></Field>
      <Field label="Intake"><input className="input" {...bind("intake")} placeholder="September 2027" /></Field>
      <Field label="How they reached us"><select className="input" {...bind("source")}>{SOURCES.map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</select></Field>
      <Field label="Owner"><select className="input" {...bind("owner_id")}><option value="">Me</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
      {f.source === "referral" && <Field label="Referral code (if given)"><input className="input uppercase" {...bind("referral_code")} /></Field>}
      <div className="sm:col-span-3"><Field label="Notes"><textarea className="input h-20" {...bind("notes")} placeholder="What they asked about, siblings, budget, start date…" /></Field></div>
      {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
      <p className="text-xs text-slate-500 sm:col-span-2">If this family already has an open enquiry (same phone or email), it is added to that one instead of making a duplicate.</p>
      <div className="flex justify-end"><button className="btn btn-primary">Add enquiry</button></div>
    </form>
  );
}

