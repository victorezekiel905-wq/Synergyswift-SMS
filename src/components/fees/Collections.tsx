"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Loading, Modal, Field, Badge, Stat, fmtDate, money } from "@/components/ui";

type Family = { guardian_id: string; name: string; phone: string | null; email: string | null; children: { id: string; name: string; class_name: string | null }[];
  balance: number; oldest_due: string | null; days_overdue: number; pay_token: string | null; level: number; level_label: string; next_action_at: string | null; case_note: string | null;
  last_contact: { at: string; kind: string; body: string } | null; promise: { id: string; amount: number; promised_by: string } | null;
  promises: { id: string; amount: number; promised_by: string; status: string; paid: number }[]; next: { label: string; level: number; urgent: boolean } };

const LEVELS = ["No action yet", "Reminded", "Bursar has called", "Principal's letter", "Final notice"];

/** Fee collections (phase 14g-2): who owes, promises to pay, the last contact and the next step. */
export default function Collections() {
  const { data, error, reload } = useApi<{ families: Family[]; total: number; currency: string }>("/api/fees/collections");
  const [open, setOpen] = useState<Family | null>(null);
  const [filter, setFilter] = useState<"all" | "urgent" | "promises" | "broken">("all");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const cur = data.currency;
  const list = data.families.filter(f => (filter === "all" || (filter === "urgent" && f.next.urgent) || (filter === "promises" && f.promise) || (filter === "broken" && f.promises.some(p => p.status === "broken")))
    && (!q || `${f.name} ${f.children.map(c => c.name).join(" ")} ${f.phone ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const remind = async (f: Family) => {
    const r = await send<{ messages_queued: number }>("/api/fees/collections", { action: "remind", guardian_id: f.guardian_id });
    setMsg({ ok: r.ok, text: r.ok ? `Reminder sent to ${f.name}.` : r.error ?? "failed" });
    if (r.ok) reload();
  };
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Owed by families" value={money(data.total, cur)} tone={data.total ? "bad" : "good"} />
        <Stat label="Families" value={data.families.length} />
        <Stat label="Need action now" value={data.families.filter(f => f.next.urgent).length} tone="warn" />
        <Stat label="Open promises" value={`${data.families.filter(f => f.promise).length} · ${money(data.families.reduce((s, f) => s + (f.promise?.amount ?? 0), 0), cur)}`} />
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        {([["all", "Everyone"], ["urgent", "Need action now"], ["promises", "Promised to pay"], ["broken", "Broke a promise"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={"rounded-full border px-3 py-1 " + (filter === k ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white")}>{l}</button>))}
        <input className="input ml-auto w-64" placeholder="Find a family, child or phone" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a family" />
      </div>
      {!list.length ? <Empty>{data.families.length ? "No family matches." : "No family owes anything. Well done."}</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Family</th><th className="p-2 text-right">Owes</th><th className="p-2">Overdue</th><th className="p-2">Promise</th><th className="p-2">Last contact</th><th className="p-2">Next step</th><th className="p-2" /></tr></thead>
            <tbody className="divide-y divide-slate-100">{list.map(f => (
              <tr key={f.guardian_id} className="align-top">
                <td className="p-2"><button className="font-medium text-brand-700 hover:underline" onClick={() => setOpen(f)}>{f.name}</button>
                  <p className="text-xs text-slate-500">{f.children.map(c => `${c.name}${c.class_name ? ` (${c.class_name})` : ""}`).join(", ")}</p></td>
                <td className="p-2 text-right font-semibold tabular-nums">{money(f.balance, cur)}</td>
                <td className="p-2">{f.days_overdue ? <span className={f.days_overdue > 60 ? "font-semibold text-rose-700" : ""}>{f.days_overdue} days</span> : <span className="text-slate-400">not yet</span>}
                  <p className="text-xs text-slate-500">{f.level_label}</p></td>
                <td className="p-2">{f.promise ? <span>{money(f.promise.amount, cur)} by {fmtDate(f.promise.promised_by)}</span> : f.promises.some(p => p.status === "broken") ? <Badge tone="red">broken</Badge> : <span className="text-slate-400">—</span>}</td>
                <td className="p-2 text-xs">{f.last_contact ? <>{fmtDate(f.last_contact.at)} · {f.last_contact.kind}<p className="line-clamp-1 text-slate-500">{f.last_contact.body}</p></> : <span className="text-slate-400">never</span>}</td>
                <td className="p-2"><span className={f.next.urgent ? "font-semibold text-rose-700" : ""}>{f.next.label}</span></td>
                <td className="p-2 text-right whitespace-nowrap">
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => remind(f)}>Remind</button>
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(f)}>Open</button>
                </td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open ? `${open.name}: fees` : ""} wide>
        {open && <FamilyCase f={open} currency={cur} onDone={text => { setMsg({ ok: true, text }); reload(); setOpen(null); }} />}
      </Modal>
    </div>
  );
}

function FamilyCase({ f, currency, onDone }: { f: Family; currency: string; onDone: (text: string) => void }) {
  const [contact, setContact] = useState({ kind: "call", body: "", follow: "" });
  const [promise, setPromise] = useState({ amount: String(f.balance), by: "", note: "" });
  const [level, setLevel] = useState(f.level);
  const [note, setNote] = useState("");
  const [drafting, setDrafting] = useState(false);
  async function draft() {
    setDrafting(true); setErr(null);
    const r = await send<{ message: string }>("/api/ai/draft", { kind: "fee_reminder", guardian_id: f.guardian_id });
    setDrafting(false);
    if (!r.ok) return setErr(r.error ?? "failed");
    setNote(r.data.message);
  }
  const [err, setErr] = useState<string | null>(null);
  const go = async (body: Record<string, unknown>, text: string) => {
    setErr(null);
    const r = await send("/api/fees/collections", body);
    if (!r.ok) return setErr(r.error ?? "failed");
    onDone(text);
  };
  const wa = f.phone ? `https://wa.me/${f.phone.replace(/[^0-9]/g, "").replace(/^0/, "234")}` : null;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1"><p className="text-lg font-semibold">{money(f.balance, currency)} owed{f.days_overdue ? `, ${f.days_overdue} days overdue` : ""}</p>
          <p className="text-slate-600">{f.children.map(c => c.name).join(", ")} · {[f.phone, f.email].filter(Boolean).join(" · ")}</p>
          <p className="mt-1 font-medium">{f.next.label}</p></div>
        <div className="flex flex-wrap gap-1.5">
          {f.phone && <a className="btn btn-ghost no-underline" href={`tel:${f.phone}`}>Call</a>}
          {wa && <a className="btn btn-ghost no-underline" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
          {f.pay_token && <a className="btn btn-ghost no-underline" href={`/pay/${f.pay_token}`} target="_blank" rel="noreferrer">Payment page</a>}
        </div>
      </div>
      {err && <Alert>{err}</Alert>}
      <section className="card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Reminder message</h3>
          <button className="btn btn-outline px-2.5 py-1 text-xs" disabled={drafting} onClick={draft}>{drafting ? "Writing…" : "Write it for me"}</button>
        </div>
        <textarea className="input mt-2" rows={3} maxLength={1200} value={note} onChange={e => setNote(e.target.value)}
          placeholder="Leave empty for the standard reminder, write your own, or press Write it for me for wording that fits this family's situation." />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-slate-500">Sent by WhatsApp, text or email, with the payment link added below it.</p>
          <button className="btn btn-primary" onClick={() => go({ action: "remind", guardian_id: f.guardian_id, message: note.trim() || null }, "Reminder sent.")}>Send reminder</button>
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-3">
          <h3 className="font-semibold">Log a contact</h3>
          <select className="input mt-2" value={contact.kind} onChange={e => setContact({ ...contact, kind: e.target.value })} aria-label="Kind">
            {["call", "whatsapp", "sms", "email", "meeting", "visit", "note"].map(k => <option key={k} value={k}>{k[0]!.toUpperCase() + k.slice(1)}</option>)}</select>
          <textarea className="input mt-2" rows={3} value={contact.body} onChange={e => setContact({ ...contact, body: e.target.value })} placeholder="What was said" />
          <Field label="Follow up on (optional)"><input className="input" type="date" value={contact.follow} onChange={e => setContact({ ...contact, follow: e.target.value })} /></Field>
          <button className="btn btn-primary mt-2" disabled={!contact.body.trim()} onClick={() => go({ action: "contact", guardian_id: f.guardian_id, kind: contact.kind, body: contact.body,
            follow_up_at: contact.follow ? new Date(`${contact.follow}T09:00:00`).toISOString() : null }, "Contact logged.")}>Save</button>
        </section>
        <section className="card p-3">
          <h3 className="font-semibold">Promise to pay</h3>
          {f.promise && <p className="mt-1 text-slate-600">Open: {money(f.promise.amount, currency)} by {fmtDate(f.promise.promised_by)} <button className="text-xs text-rose-700 underline" onClick={() => go({ action: "cancel_promise", id: f.promise!.id }, "Promise cancelled.")}>cancel</button></p>}
          <Field label="Amount"><input className="input" type="number" min={1} value={promise.amount} onChange={e => setPromise({ ...promise, amount: e.target.value })} /></Field>
          <Field label="By"><input className="input" type="date" value={promise.by} onChange={e => setPromise({ ...promise, by: e.target.value })} /></Field>
          <input className="input mt-2" value={promise.note} onChange={e => setPromise({ ...promise, note: e.target.value })} placeholder="Note (optional)" />
          <button className="btn btn-primary mt-2" disabled={!promise.by || !(Number(promise.amount) > 0)} onClick={() => go({ action: "promise", guardian_id: f.guardian_id, amount: Number(promise.amount),
            promised_by: promise.by, student_ids: f.children.map(c => c.id), note: promise.note || null }, "Promise recorded. It is checked against payments every day.")}>Record promise</button>
          {f.promises.length > 0 && <ul className="mt-2 space-y-1 text-xs text-slate-600">{f.promises.map(p => <li key={p.id}>{money(p.amount, currency)} by {fmtDate(p.promised_by)}: <b>{p.status}</b>{p.paid ? ` (${money(p.paid, currency)} paid)` : ""}</li>)}</ul>}
        </section>
        <section className="card p-3">
          <h3 className="font-semibold">Escalation</h3>
          <div className="mt-2 space-y-1">{LEVELS.map((l, i) => (
            <label key={l} className="flex items-center gap-2"><input type="radio" name="level" checked={level === i} onChange={() => setLevel(i)} />{l}</label>))}</div>
          <button className="btn btn-primary mt-2" disabled={level === f.level} onClick={() => go({ action: "level", guardian_id: f.guardian_id, level }, "Escalation updated.")}>Save</button>
          <p className="mt-2 text-xs text-slate-500">Reminders before and after due dates, and late fees, still go out automatically from Fees settings.</p>
        </section>
      </div>
    </div>
  );
}
