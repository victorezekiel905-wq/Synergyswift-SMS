"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, Loading } from "@/components/ui";
import { STAGE_LABEL, type Stage } from "@/lib/crm";

type Step = { delay_hours: number; channel: "email" | "sms" | "whatsapp" | "task"; subject: string | null; body: string };
type Seq = { id: string; name: string; stage: Stage; active: boolean; admission_sequence_steps: (Step & { position: number })[]; running: number; finished: number };
const CHANNEL: Record<Step["channel"], string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp", task: "Task for the owner" };
const STAGES: Stage[] = ["enquiry", "tour_booked", "applied", "assessed", "offered", "accepted"];

const delayText = (h: number) => (h === 0 ? "straight away" : h % 24 === 0 ? `after ${h / 24} day${h === 24 ? "" : "s"}` : `after ${h} hour${h === 1 ? "" : "s"}`);

/** Automatic follow-ups: each sequence starts when a family enters a stage and stops when they move on. */
export default function FollowUps() {
  const { data, error, reload } = useApi<Seq[]>("/api/crm/sequences");
  const [edit, setEdit] = useState<Partial<Seq> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (body: Record<string, unknown>, ok: string) => { const r = await send("/api/crm/sequences", body); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) reload(); return r.ok; };
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Messages go by email, SMS or WhatsApp to families who agreed to be contacted; tasks remind the family&apos;s owner to call. A sequence stops as soon as the family moves to another stage. Use {"{parent}"}, {"{child}"}, {"{school}"} and {"{level}"} in the text.</p>
      <div className="flex gap-2">
        <button className="btn btn-primary" onClick={() => setEdit({ stage: "enquiry", active: true, admission_sequence_steps: [{ position: 1, delay_hours: 0, channel: "email", subject: "", body: "" }] })}>+ New sequence</button>
        {!data.length && <button className="btn btn-outline" onClick={() => act({ action: "seed" }, "Starter sequences added. Edit the wording to suit your school.")}>Add starter sequences</button>}
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!data.length ? <Empty>No follow-up sequences yet.</Empty> : (
        <div className="grid gap-3 lg:grid-cols-2">{data.map(s => (
          <section key={s.id} className="card p-4">
            <div className="flex items-center gap-2"><p className="flex-1 font-semibold">{s.name}</p><Badge tone="blue">on {STAGE_LABEL[s.stage]}</Badge>{!s.active && <Badge>paused</Badge>}</div>
            <ol className="mt-2 space-y-1 text-sm">{s.admission_sequence_steps.map(st => (
              <li key={st.position} className="flex gap-2"><span className="w-28 shrink-0 text-xs text-slate-500">{delayText(st.delay_hours)}</span><span className="text-xs font-semibold">{CHANNEL[st.channel]}</span><span className="truncate text-slate-600">{st.subject || st.body}</span></li>
            ))}</ol>
            <p className="mt-2 text-xs text-slate-500">{s.running} families in progress · {s.finished} finished</p>
            <div className="mt-2 flex gap-1">
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(s)}>Edit</button>
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act({ action: "toggle", id: s.id, active: !s.active }, s.active ? "Paused." : "Resumed.")}>{s.active ? "Pause" : "Resume"}</button>
              <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => confirm(`Delete ${s.name}?`) && act({ action: "delete", id: s.id }, "Deleted.")}>Delete</button>
            </div>
          </section>
        ))}</div>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit sequence" : "New sequence"} wide>
        {edit && <SeqForm seq={edit} onSave={async body => { if (await act({ action: "save", ...body }, "Saved.")) setEdit(null); }} />}
      </Modal>
    </div>
  );
}

function SeqForm({ seq, onSave }: { seq: Partial<Seq>; onSave: (b: Record<string, unknown>) => void }) {
  const [name, setName] = useState(seq.name ?? "");
  const [stage, setStage] = useState<Stage>(seq.stage ?? "enquiry");
  const [active, setActive] = useState(seq.active !== false);
  const [steps, setSteps] = useState<Step[]>((seq.admission_sequence_steps ?? []).map(({ delay_hours, channel, subject, body }) => ({ delay_hours, channel, subject, body })));
  const set = (i: number, k: keyof Step, v: string | number) => setSteps(steps.map((s, j) => j === i ? { ...s, [k]: v } : s));
  return (
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); onSave({ id: seq.id, name, stage, active, steps: steps.map(s => ({ ...s, delay_hours: Number(s.delay_hours), subject: s.subject || null })) }); }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><input className="input" required value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Starts when a family enters"><select className="input" value={stage} onChange={e => setStage(e.target.value as Stage)}>{STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active</label>
      </div>
      {steps.map((s, i) => (
        <div key={i} className="rounded-lg border border-slate-200 p-3">
          <div className="grid gap-2 sm:grid-cols-[140px_180px_1fr_auto]">
            <Field label={i === 0 ? "Wait (hours) after entering" : "Wait (hours) after the last step"}><input className="input" type="number" min={0} max={2160} value={s.delay_hours} onChange={e => set(i, "delay_hours", e.target.value)} /></Field>
            <Field label="Send as"><select className="input" value={s.channel} onChange={e => set(i, "channel", e.target.value)}>{(Object.keys(CHANNEL) as Step["channel"][]).map(c => <option key={c} value={c}>{CHANNEL[c]}</option>)}</select></Field>
            {s.channel === "email" ? <Field label="Subject"><input className="input" value={s.subject ?? ""} onChange={e => set(i, "subject", e.target.value)} /></Field> : <div />}
            <button type="button" className="btn btn-ghost self-end text-rose-600" disabled={steps.length < 2} onClick={() => setSteps(steps.filter((_, j) => j !== i))} aria-label="Remove step">×</button>
          </div>
          <Field label={s.channel === "task" ? "What the owner should do" : "Message"}><textarea className="input h-16" required value={s.body} onChange={e => set(i, "body", e.target.value)} /></Field>
        </div>
      ))}
      <button type="button" className="btn btn-ghost text-xs" disabled={steps.length >= 12} onClick={() => setSteps([...steps, { delay_hours: 48, channel: "whatsapp", subject: null, body: "" }])}>+ Add step</button>
      <p className="text-xs text-slate-500">WhatsApp messages to families who have not written to you in the last 24 hours use the approved template WHATSAPP_TPL_ADMISSION_NOTE (see docs/MESSAGING.md).</p>
      <div className="flex justify-end"><button className="btn btn-primary">Save sequence</button></div>
    </form>
  );
}
