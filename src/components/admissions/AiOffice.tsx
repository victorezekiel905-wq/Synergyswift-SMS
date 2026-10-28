"use client";
import { useState } from "react";
import { send, Alert, Badge, fmtDate } from "@/components/ui";

/** Phase 14p: the AI admissions office on a family, and the applicant summary for the panel. */

type FamilyBrief = { summary: string; temperature: "hot" | "warm" | "cold"; missing: string[]; next_step: string; next_step_in_days: number; reply: { subject: string; body: string }; at: string };
const TEMP = { hot: { label: "Keen", tone: "green" }, warm: { label: "Interested", tone: "amber" }, cold: { label: "Gone quiet", tone: "slate" } } as const;

export function FamilyBriefPanel({ leadId, brief: initial, canMessage, onChanged }: { leadId: string; brief: FamilyBrief | null; canMessage: boolean; onChanged: () => void }) {
  const [brief, setBrief] = useState<FamilyBrief | null>(initial);
  const [reply, setReply] = useState(initial?.reply ?? { subject: "", body: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function ask() {
    setBusy("brief"); setMsg(null);
    const r = await send<{ brief: FamilyBrief }>("/api/crm/leads", { action: "ai_brief", id: leadId });
    setBusy(null);
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "failed" });
    setBrief(r.data.brief); setReply(r.data.brief.reply);
  }
  async function sendIt() {
    if (!confirm("Send this message to the family now?")) return;
    setBusy("send");
    const r = await send("/api/crm/leads", { action: "ai_send", id: leadId, subject: reply.subject, body: reply.body });
    setBusy(null);
    setMsg({ ok: r.ok, text: r.ok ? "Sent to the family and logged." : r.error ?? "failed" });
    if (r.ok) onChanged();
  }
  return (
    <section className="rounded-lg border border-brand-200 bg-brand-50/40 p-3" aria-label="Admissions office assistant">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Admissions assistant</p>
        <button className="btn btn-outline px-3 py-1 text-xs" disabled={busy !== null} onClick={ask}>{busy === "brief" ? "Reading the file…" : brief ? "Refresh" : "Brief me and draft a reply"}</button>
      </div>
      {msg && <div className="mt-2"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {!brief ? <p className="mt-1 text-slate-600">Reads the enquiry, messages and application, tells you what the family still has to do, and drafts a reply in the school&apos;s voice.</p> : (
        <div className="mt-2 space-y-2">
          <p className="flex flex-wrap items-center gap-2"><Badge tone={TEMP[brief.temperature].tone}>{TEMP[brief.temperature].label}</Badge><span className="text-xs text-slate-500">{fmtDate(brief.at, true)}</span></p>
          <p>{brief.summary}</p>
          {brief.missing.length > 0 && <p><b>Still to do:</b> {brief.missing.join(" · ")}</p>}
          <p><b>Next step{brief.next_step_in_days ? ` (in ${brief.next_step_in_days} day${brief.next_step_in_days === 1 ? "" : "s"})` : " (today)"}:</b> {brief.next_step}</p>
          {canMessage && <>
            <input className="input" value={reply.subject} onChange={e => setReply({ ...reply, subject: e.target.value })} aria-label="Subject" />
            <textarea className="input h-32" value={reply.body} onChange={e => setReply({ ...reply, body: e.target.value })} aria-label="Reply to the family" />
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(reply.body)}>Copy</button>
              <button className="btn btn-primary" disabled={busy !== null || reply.body.length < 5 || reply.subject.length < 2} onClick={sendIt}>{busy === "send" ? "Sending…" : "Send to the family"}</button>
            </div>
            <p className="text-xs text-slate-500">Goes by email and WhatsApp (or SMS), whichever the family has. Edit anything first.</p>
          </>}
        </div>
      )}
    </section>
  );
}

type Summary = { summary: string; strengths: string[]; concerns: string[]; suggestion: string; reason: string; at: string };
const SUGGEST: Record<string, string> = { offer: "Offer", interview: "Interview first", waitlist: "Waiting list", regret: "Regret", need_more_information: "Need more information" };

export function ApplicantSummaryPanel({ appId, saved, onChanged }: { appId: string; saved: string | null; onChanged: () => void }) {
  const [s, setS] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true); setErr(null);
    const r = await send<{ summary: Summary }>("/api/admissions", { action: "ai_summary", id: appId });
    setBusy(false);
    if (!r.ok) return setErr(r.error ?? "failed");
    setS(r.data.summary); onChanged();
  }
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">Summary for the panel</p>
        <button className="btn btn-outline px-3 py-1 text-xs" disabled={busy} onClick={run}>{busy ? "Reading…" : s || saved ? "Refresh" : "Summarise this applicant"}</button>
      </div>
      {err && <div className="mt-2"><Alert>{err}</Alert></div>}
      {s ? (
        <div className="mt-2 space-y-1">
          <p>{s.summary}</p>
          {s.strengths.length > 0 && <p><b>Strengths:</b> {s.strengths.join("; ")}</p>}
          {s.concerns.length > 0 && <p><b>Concerns:</b> {s.concerns.join("; ")}</p>}
          <p><Badge tone="blue">{SUGGEST[s.suggestion] ?? s.suggestion}</Badge> <span className="text-slate-700">{s.reason}</span></p>
          <p className="text-xs text-slate-500">A suggestion from the test, report and interview on file. The panel decides.</p>
        </div>
      ) : saved ? <p className="mt-2 whitespace-pre-wrap">{saved}</p> : <p className="mt-1 text-slate-600">Reads the entrance test, report score, interview notes and documents and suggests a decision with its reason.</p>}
    </div>
  );
}
