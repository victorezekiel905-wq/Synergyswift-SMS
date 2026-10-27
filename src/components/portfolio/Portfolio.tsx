"use client";
import { useState } from "react";
import { send, Alert, Badge, Empty, fmtDate } from "@/components/ui";

export type Achievement = { id: string; kind: string; title: string; description?: string | null; level?: string | null; award?: string | null; issuer?: string | null;
  achieved_on: string; status?: string; source?: string; photo: string | null; link_url?: string | null };
export type Work = { id: string; title: string; kind: string; description: string | null; link_url: string | null; subject: string | null; created_at: string; image: string | null };
export type Cert = { id: string; title: string; issued_on: string; verify_token: string };
export type TargetRow = { id: string; kind: string; target: number | null; description: string | null; status: string; set_by_kind: string; subject: string | null; term: string | null; current: number | null; met: boolean | null };
export type Share = { id: string; url: string; achievement_id: string | null; created_at: string; expires_at: string; views: number; state: "live" | "revoked" | "expired" };

const LEVEL: Record<string, string> = { class: "Class", school: "School", local: "Local", state: "State", national: "National", international: "International" };

/** Achievements with photos, approved work and certificates (phase 14o): the portfolio dashboard. */
export function PortfolioView({ achievements, work = [], certificates = [], onShare }: { achievements: Achievement[]; work?: Work[]; certificates?: Cert[]; onShare?: (achievementId: string) => void }) {
  if (!achievements.length && !work.length && !certificates.length) return <Empty>Nothing in the portfolio yet.</Empty>;
  return (
    <div className="space-y-6">
      {achievements.length > 0 && <section>
        <h3 className="mb-2 font-semibold">Achievements</h3>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{achievements.map(a => (
          <li key={a.id} className="card overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {a.photo && <img src={a.photo} alt="" className="h-40 w-full object-cover" />}
            <div className="p-3 text-sm">
              <p className="font-semibold">{a.title}{a.award ? <span className="font-normal text-slate-600">: {a.award}</span> : null}</p>
              <p className="text-xs text-slate-500">{[a.level ? LEVEL[a.level] ?? a.level : null, a.issuer, fmtDate(a.achieved_on)].filter(Boolean).join(" · ")}</p>
              {a.description && <p className="mt-1 text-slate-700">{a.description}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {a.status === "pending" && <Badge tone="amber">waiting for a teacher to verify</Badge>}
                {a.status === "rejected" && <Badge tone="red">not verified</Badge>}
                {a.status === "verified" && a.source === "student" && <Badge tone="green">verified by the school</Badge>}
                {a.link_url && <a className="text-xs text-brand-700 underline" href={a.link_url} target="_blank" rel="noreferrer">Link</a>}
                {onShare && (a.status ?? "verified") === "verified" && <button className="ml-auto text-xs text-brand-700 underline" onClick={() => onShare(a.id)}>Share this</button>}
              </div>
            </div>
          </li>))}</ul>
      </section>}
      {work.length > 0 && <section>
        <h3 className="mb-2 font-semibold">Work</h3>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{work.map(w => (
          <li key={w.id} className="card overflow-hidden text-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {w.image && <img src={w.image} alt="" className="h-36 w-full object-cover" />}
            <div className="p-3"><p className="font-medium">{w.link_url ? <a className="text-brand-700 hover:underline" href={w.link_url} target="_blank" rel="noreferrer">{w.title}</a> : w.title}</p>
              <p className="text-xs text-slate-500">{w.subject ?? w.kind} · {fmtDate(w.created_at)}</p>{w.description && <p className="mt-1 text-slate-700">{w.description}</p>}</div>
          </li>))}</ul>
      </section>}
      {certificates.length > 0 && <section>
        <h3 className="mb-2 font-semibold">Certificates</h3>
        <ul className="space-y-1 text-sm">{certificates.map(c => <li key={c.id}><a className="text-brand-700 hover:underline" href={`/v/${c.verify_token}`} target="_blank" rel="noreferrer">{c.title}</a> <span className="text-xs text-slate-500">{fmtDate(c.issued_on)} · can be checked online</span></li>)}</ul>
      </section>}
    </div>
  );
}

const KIND: Record<string, string> = { average: "Term average", subject_score: "Subject score", attendance: "Attendance", personal: "Personal goal" };

/** Targets with where the student stands (phase 14o). `onAdd` adds a personal goal. */
export function Targets({ targets, onAdd, onStatus }: { targets: TargetRow[]; onAdd?: (description: string) => Promise<boolean>; onStatus?: (id: string, status: string) => void }) {
  const [d, setD] = useState("");
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">Targets</h3>
      {!targets.length ? <p className="text-sm text-slate-500">No targets yet.</p> : <ul className="space-y-2 text-sm">{targets.map(t => (
        <li key={t.id} className="card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <b className="mr-auto">{KIND[t.kind] ?? t.kind}{t.subject ? `: ${t.subject}` : ""}{t.term ? <span className="font-normal text-slate-500"> · {t.term}</span> : null}</b>
            {t.status !== "active" ? <Badge tone={t.status === "met" ? "green" : "slate"}>{t.status}</Badge> : t.met === true ? <Badge tone="green">on target</Badge> : t.met === false ? <Badge tone="amber">not there yet</Badge> : null}
          </div>
          {t.description && <p className="text-slate-700">{t.description}</p>}
          {t.target !== null && <div className="mt-2">
            <div className="flex justify-between text-xs text-slate-500"><span>Now: {t.current ?? "no result yet"}{t.kind === "attendance" && t.current !== null ? "%" : ""}</span><span>Target: {t.target}{t.kind === "attendance" ? "%" : ""}</span></div>
            <div className="relative mt-1 h-2 rounded-full bg-slate-100">
              <div className={"h-full rounded-full " + (t.met ? "bg-emerald-600" : "bg-brand-700")} style={{ width: `${Math.min(100, Math.max(0, t.current ?? 0))}%` }} />
              <div className="absolute -top-1 h-4 w-0.5 bg-slate-900" style={{ left: `${Math.min(100, t.target)}%` }} aria-hidden />
            </div></div>}
          {onStatus && t.kind === "personal" && t.status === "active" && <button className="mt-1 text-xs text-brand-700 underline" onClick={() => onStatus(t.id, "met")}>I did it</button>}
        </li>))}</ul>}
      {onAdd && <form className="flex gap-2" onSubmit={async e => { e.preventDefault(); if (await onAdd(d)) setD(""); }}>
        <input className="input" value={d} onChange={e => setD(e.target.value)} placeholder="Add a personal goal, e.g. read two books this term" maxLength={300} />
        <button className="btn btn-outline" disabled={d.trim().length < 3}>Add</button></form>}
    </section>
  );
}

/** Private links to the portfolio dashboard (phase 14o): whoever has the link can see it until it expires or is stopped. */
export function ShareLinks({ shares, api, extra = {}, onChange }: { shares: Share[]; api: string; extra?: Record<string, unknown>; onChange: () => void }) {
  const [days, setDays] = useState(90);
  const [made, setMade] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const live = shares.filter(s => s.state === "live");
  const create = async () => {
    const r = await send<{ url: string }>(api, { ...extra, action: "share", days });
    if (!r.ok) return setErr(r.error);
    setErr(null); setMade(r.data.url); onChange();
  };
  return (
    <section className="space-y-2 text-sm">
      <h3 className="font-semibold">Share the portfolio</h3>
      <p className="text-slate-600">Make a private link to send to a scholarship panel, a new school or family. It shows verified achievements, approved work and certificates, with the first name only, and stops working when it expires or you stop it.</p>
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Link lasts"><option value={7}>1 week</option><option value={30}>1 month</option><option value={90}>3 months</option><option value={365}>1 year</option></select>
        <button className="btn btn-primary" onClick={create}>Make a link</button>
      </div>
      {err && <Alert>{err}</Alert>}
      {made && <div className="flex gap-2"><input className="input font-mono text-xs" readOnly value={made} onFocus={e => e.target.select()} />
        <button className="btn btn-outline" onClick={() => navigator.clipboard?.writeText(made)}>Copy</button></div>}
      {live.length > 0 && <ul className="space-y-1">{live.map(s => (
        <li key={s.id} className="flex flex-wrap items-center gap-2"><span className="mr-auto truncate font-mono text-xs">{s.url}</span>
          <span className="text-xs text-slate-500">{s.achievement_id ? "one achievement · " : ""}{s.views} view{s.views === 1 ? "" : "s"} · until {fmtDate(s.expires_at)}</span>
          <button className="text-xs text-red-700 underline" onClick={async () => { await send(api, { ...extra, action: "revoke", id: s.id }); onChange(); }}>Stop</button></li>))}</ul>}
    </section>
  );
}
