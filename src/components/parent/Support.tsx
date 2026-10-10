"use client";
import { useState } from "react";
import { send, Alert, Badge, Empty, Field, fmtDate, statusTone } from "@/components/ui";
import { CATEGORY_LABEL, REASON_LABEL, REENROL_REASONS, STATUS_LABEL, TICKET_CATEGORIES, type TicketStatus } from "@/lib/community";

export type SupportData = {
  tickets: { ticket_no: string; kind: string; subject: string; status: TicketStatus; created_at: string; updated_at: string; token: string }[];
  surveys: { title: string; token: string }[];
  reenrolment: null | { round: { id: string; title: string; message: string | null; deadline: string | null }; children: { id: string; name: string; intent: string | null; reason: string | null; note: string | null }[] };
};
type Kid = { id: string; name: string };
type Post = (body: Record<string, unknown>) => Promise<{ ok: boolean; data: any; error: string | null }>;

const post = (token?: string): Post => body => send("/api/family", { ...body, token });

/** "Will your child return next session?" Shown at the top of the portal until every child has an answer. */
export function ReenrolCard({ data, token, onChange }: { data: NonNullable<SupportData["reenrolment"]>; token?: string; onChange: () => void }) {
  const [choice, setChoice] = useState<Record<string, { intent: string; reason: string; note: string }>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const pending = data.children.filter(c => !c.intent);
  if (!pending.length && !editing) {
    return (
      <section id="reenrol" className="card mb-4 p-4 text-sm">
        <p><b>{data.round.title}:</b> thank you, we have your answer{data.children.length > 1 ? "s" : ""}. {data.children.map(c => `${c.name.split(" ")[0]}: ${c.intent?.replace("_", " ")}`).join(" · ")}
          <button className="ml-2 text-xs text-brand-700" onClick={() => setEditing(true)}>Change</button></p>
      </section>
    );
  }
  const list = editing ? data.children : pending;
  return (
    <section id="reenrol" className="card mb-4 border-brand-300 p-4 text-sm">
      <h2 className="text-base font-semibold">{data.round.title}: will your child{list.length > 1 ? "ren" : ""} return?</h2>
      <p className="text-slate-600">It helps us plan classes and places.{data.round.deadline ? ` Please answer by ${fmtDate(data.round.deadline)}.` : ""}</p>
      {data.round.message && <p className="mt-1 whitespace-pre-wrap text-slate-600">{data.round.message}</p>}
      {msg && <div className="mt-2"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <ul className="mt-3 space-y-3">{list.map(c => {
        const v = choice[c.id] ?? { intent: c.intent ?? "", reason: c.reason ?? "", note: c.note ?? "" };
        const set = (p: Partial<typeof v>) => setChoice({ ...choice, [c.id]: { ...v, ...p } });
        return (
          <li key={c.id} className="rounded-lg border border-slate-200 p-3">
            <p className="font-medium">{c.name}</p>
            <div className="mt-1 flex flex-wrap gap-3" role="radiogroup" aria-label={`Will ${c.name} return?`}>
              {[["returning", "Yes, returning"], ["undecided", "Not sure yet"], ["not_returning", "No, leaving"]].map(([k, l]) => (
                <label key={k} className="flex items-center gap-1"><input type="radio" name={`re-${c.id}`} checked={v.intent === k} onChange={() => set({ intent: k })} /> {l}</label>
              ))}
            </div>
            {v.intent === "not_returning" && (
              <Field label="May we ask why?"><select className="input" value={v.reason} onChange={e => set({ reason: e.target.value })}><option value="">Choose a reason</option>{REENROL_REASONS.map(r => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}</select></Field>
            )}
            {v.intent && v.intent !== "returning" && <input className="input mt-2" value={v.note} onChange={e => set({ note: e.target.value })} placeholder="Anything we could do to help? (optional)" maxLength={500} aria-label="Comment" />}
            <button className="btn btn-primary mt-2 px-3 py-1 text-xs" disabled={!v.intent || (v.intent === "not_returning" && !v.reason)} onClick={async () => {
              const r = await post(token)({ action: "reenrol", round_id: data.round.id, student_id: c.id, intent: v.intent, reason: v.reason || null, note: v.note || null });
              setMsg({ ok: r.ok, text: r.ok ? `Thank you. We have noted ${c.name.split(" ")[0]}'s answer.` : r.error ?? "failed" });
              if (r.ok) { setEditing(false); onChange(); }
            }}>Send answer</button>
          </li>
        );
      })}</ul>
    </section>
  );
}

/** Survey invitations waiting for an answer. */
export function SurveyPrompt({ surveys }: { surveys: SupportData["surveys"] }) {
  if (!surveys.length) return null;
  return (
    <section className="card mb-4 border-violet-200 bg-violet-50 p-3 text-sm">
      {surveys.map(s => <p key={s.token}>We would value your views: <a className="font-semibold text-brand-700 hover:underline" href={`/s/${s.token}`}>{s.title}</a> (about two minutes)</p>)}
    </section>
  );
}

/** Raise a complaint or request and follow the ones already raised. */
export function SupportTab({ data, kids, token, onChange }: { data: SupportData; kids: Kid[]; token?: string; onChange: () => void }) {
  const [f, setF] = useState({ kind: "complaint", category: "other", student_id: "", subject: "", body: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4 text-sm">
      <form className="space-y-2 rounded-lg border border-slate-200 p-3" onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        const r = await post(token)({ action: "ticket", ...f, student_id: f.student_id || null });
        setBusy(false);
        setMsg({ ok: r.ok, text: r.ok ? `Thank you. Your reference is ${r.data.ticket_no}. We will reply soon.` : r.error ?? "failed" });
        if (r.ok) { setF({ ...f, subject: "", body: "" }); onChange(); }
      }}>
        <p className="font-semibold">Raise a concern or request</p>
        <p className="text-xs text-slate-500">It goes straight to the school office, and you can follow every reply here.</p>
        {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Type"><select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="complaint">Complaint</option><option value="request">Request</option><option value="enquiry">Question</option><option value="feedback">Feedback or praise</option></select></Field>
          <Field label="About"><select className="input" value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{TICKET_CATEGORIES.filter(c => c !== "admissions").map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></Field>
          {kids.length > 1 && <Field label="Child"><select className="input" value={f.student_id} onChange={e => setF({ ...f, student_id: e.target.value })}><option value="">All my children</option>{kids.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Field>}
        </div>
        <Field label="Subject"><input className="input" value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} required minLength={3} maxLength={160} /></Field>
        <Field label="Details"><textarea className="input min-h-24" value={f.body} onChange={e => setF({ ...f, body: e.target.value })} required minLength={5} maxLength={3000} /></Field>
        {["safety", "bullying", "health"].includes(f.category) && <p className="text-xs text-amber-800">This will be treated as high priority. If a child is in danger right now, call the school.</p>}
        <button className="btn btn-primary" disabled={busy}>Send</button>
      </form>
      {!data.tickets.length ? <Empty>You have not raised anything yet.</Empty> : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">{data.tickets.map(t => (
          <li key={t.token} className="flex flex-wrap items-center gap-2 p-3">
            <a className="flex-1 font-medium text-brand-700 hover:underline" href={`/t/${t.token}`}>{t.subject}</a>
            <span className="font-mono text-xs text-slate-400">{t.ticket_no}</span>
            <Badge tone={statusTone(t.status === "resolved" ? "approved" : t.status === "open" ? "pending" : t.status)}>{STATUS_LABEL[t.status]}</Badge>
            <span className="text-xs text-slate-500">{fmtDate(t.updated_at ?? t.created_at)}</span>
          </li>
        ))}</ul>
      )}
    </div>
  );
}
