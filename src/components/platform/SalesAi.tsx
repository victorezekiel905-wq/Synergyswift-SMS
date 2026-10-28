"use client";
import { useState } from "react";
import { send, Alert, Badge, fmtDate } from "@/components/ui";

/** Phase 14p: the AI sales manager on a lead, and the weekly pipeline summary. */

export type Brief = {
  summary: string; temperature: "hot" | "warm" | "cold"; next_step: string; next_step_in_days: number;
  talking_points: string[]; risks: string[]; suggested_plan: string | null;
  message: { channel: "email" | "whatsapp"; subject: string | null; body: string }; at: string;
};
export type Summary = {
  headline: string; focus: { school: string; why: string; action: string }[]; at_risk_customers: { school: string; why: string; action: string }[];
  forecast: string; coaching: string; at: string;
};
const TEMP = { hot: { label: "Hot", tone: "red" }, warm: { label: "Warm", tone: "amber" }, cold: { label: "Cold", tone: "slate" } } as const;

const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/[^0-9]/g, "").replace(/^0/, "234")}?text=${encodeURIComponent(text)}`;

export function SalesBrief({ lead, plans, available, onChanged }: {
  lead: { id: string; phone: string | null; email: string | null; ai_brief?: Brief | null };
  plans: { code: string; name: string }[]; available: boolean; onChanged: () => void;
}) {
  const [brief, setBrief] = useState<Brief | null>(lead.ai_brief ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraft] = useState({ subject: lead.ai_brief?.message.subject ?? "", body: lead.ai_brief?.message.body ?? "" });

  async function ask() {
    setBusy("brief"); setMsg(null);
    const r = await send<{ brief: Brief }>("/api/platform/sales", { action: "ai_brief", lead_id: lead.id });
    setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "failed" });
    setBrief(r.data.brief);
    setDraft({ subject: r.data.brief.message.subject ?? "", body: r.data.brief.message.body });
    onChanged();
  }
  async function apply() {
    setBusy("apply");
    const r = await send("/api/platform/sales", { action: "ai_apply", lead_id: lead.id });
    setBusy(null);
    setMsg({ ok: r.ok, text: r.ok ? "Next step added to the lead." : r.error ?? "failed" });
    if (r.ok) onChanged();
  }
  async function email() {
    if (!confirm(`Send this email to ${lead.email}?`)) return;
    setBusy("email");
    const r = await send("/api/platform/sales", { action: "send_email", lead_id: lead.id, subject: draft.subject, body: draft.body });
    setBusy(null);
    setMsg({ ok: r.ok, text: r.ok ? "Email sent and logged." : r.error ?? "failed" });
    if (r.ok) onChanged();
  }

  if (!available) return null;
  return (
    <section className="card border-brand-200 bg-brand-50/40 p-4" aria-label="AI sales manager">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">AI sales manager</h3>
        <button className="btn btn-outline" disabled={busy !== null} onClick={ask}>{busy === "brief" ? "Thinking…" : brief ? "Refresh the brief" : "Brief me on this school"}</button>
      </div>
      {msg && <div className="mt-2"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {!brief ? <p className="mt-2 text-sm text-slate-600">Reads the history, quotes and needs, then tells you where the deal stands, the next step, what to say, and drafts the message.</p> : (
        <div className="mt-3 space-y-3 text-sm">
          <p className="flex flex-wrap items-center gap-2"><Badge tone={TEMP[brief.temperature].tone}>{TEMP[brief.temperature].label}</Badge>
            {brief.suggested_plan && <Badge tone="blue">Offer: {plans.find(p => p.code === brief.suggested_plan)?.name ?? brief.suggested_plan}</Badge>}
            <span className="text-xs text-slate-500">Briefed {fmtDate(brief.at, true)}</span></p>
          <p>{brief.summary}</p>
          <div className="rounded-lg bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next step · {brief.next_step_in_days === 0 ? "today" : `in ${brief.next_step_in_days} day${brief.next_step_in_days === 1 ? "" : "s"}`}</p>
            <p className="mt-1 font-medium">{brief.next_step}</p>
            <button className="btn btn-ghost mt-1 px-2 py-1 text-xs" disabled={busy !== null} onClick={apply}>Add as the lead&apos;s next step</button>
          </div>
          {brief.talking_points.length > 0 && <div><p className="font-medium">Talking points</p><ul className="ml-5 list-disc text-slate-700">{brief.talking_points.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
          {brief.risks.length > 0 && <div><p className="font-medium">Watch out for</p><ul className="ml-5 list-disc text-slate-700">{brief.risks.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
          <div>
            <p className="font-medium">Drafted {brief.message.channel === "whatsapp" ? "WhatsApp message" : "email"} <span className="font-normal text-slate-500">(edit before sending)</span></p>
            {brief.message.channel === "email" && <input className="input mt-1" value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value })} aria-label="Subject" />}
            <textarea className="input mt-1" rows={6} value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} aria-label="Message" />
            <div className="mt-2 flex flex-wrap gap-2">
              {lead.email && <button className="btn btn-primary" disabled={busy !== null || draft.body.length < 5 || draft.subject.length < 2} onClick={email}>{busy === "email" ? "Sending…" : "Send email"}</button>}
              {lead.phone && <a className="btn btn-outline no-underline" href={waLink(lead.phone, draft.body)} target="_blank" rel="noreferrer">Open in WhatsApp</a>}
              <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(draft.body)}>Copy</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function WeeklySummary({ summary, available, onChanged }: { summary: Summary | null; available: boolean; onChanged: () => void }) {
  const [s, setS] = useState<Summary | null>(summary);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!available) return null;
  async function write() {
    setBusy(true); setErr(null);
    const r = await send<{ summary: Summary }>("/api/platform/sales", { action: "ai_summary" });
    setBusy(false);
    if (!r.ok) return setErr(r.error ?? "failed");
    setS(r.data.summary); onChanged();
  }
  const list = (xs: { school: string; why: string; action: string }[]) => (
    <ul className="mt-1 space-y-1.5">{xs.map((x, i) => <li key={i}><b>{x.school}</b>: {x.why} <span className="text-brand-800">→ {x.action}</span></li>)}</ul>
  );
  return (
    <details className="card mb-4 p-4" open={Boolean(s)}>
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">This week, from the AI sales manager{s ? <span className="ml-2 text-xs font-normal text-slate-500">{fmtDate(s.at, true)}</span> : null}</span>
        <button className="btn btn-outline" disabled={busy} onClick={e => { e.preventDefault(); write(); }}>{busy ? "Writing…" : s ? "Write it again" : "Write this week's summary"}</button>
      </summary>
      {err && <div className="mt-2"><Alert>{err}</Alert></div>}
      {!s ? <p className="mt-2 text-sm text-slate-600">Every Monday morning it reads the whole pipeline and your customers&apos; health, and emails the team the deals to work, the schools at risk and a forecast.</p> : (
        <div className="mt-3 grid gap-4 text-sm lg:grid-cols-2">
          <div><p className="text-base font-medium">{s.headline}</p><p className="mt-2 font-medium">Work these this week</p>{list(s.focus)}</div>
          <div>
            {s.at_risk_customers.length > 0 && <><p className="font-medium">Customers at risk</p>{list(s.at_risk_customers)}</>}
            <p className="mt-2"><b>Forecast:</b> {s.forecast}</p>
            <p className="mt-1"><b>Coaching:</b> {s.coaching}</p>
          </div>
        </div>
      )}
    </details>
  );
}
