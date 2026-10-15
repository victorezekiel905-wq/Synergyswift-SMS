"use client";
import { useState } from "react";
import { send, Alert, Badge, Empty, fmtDate } from "@/components/ui";
import { CERT_LABEL, PROGRESS, type CertKind } from "@/lib/sis";
import MyProgress from "@/components/student/MyProgress";

export type RecordsData = {
  achievements: { id: string; student_id: string; kind: string; title: string; award: string | null; level: string; achieved_on: string }[];
  certificates: { id: string; student_id: string; kind: CertKind; title: string; serial_no: string; issued_on: string; verify_token: string }[];
  portfolio: { id: string; student_id: string; title: string; kind: string; description: string | null; link_url: string | null; has_file: boolean; feedback: string | null; created_at: string; subjects: { name: string } | null }[];
  documents: { id: string; student_id: string; kind: string; name: string; created_at: string }[];
  plans: { id: string; student_id: string; title: string; starts_on: string; review_on: string | null; student_voice: string | null; parent_views: string | null; parent_agreed_at: string | null;
    iep_targets: { target: string; strategies: string | null; success_criteria: string | null; progress: string }[] }[];
};
type Kid = { id: string; name: string };

/** Each child's achievements, certificates, work, shared papers and support plan. */
export default function Records({ data, kids, token, onChange }: { data: RecordsData; kids: Kid[]; token?: string; onChange: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [views, setViews] = useState<Record<string, string>>({});
  const open = async (kind: "document" | "portfolio", id: string) => {
    const r = await send<{ url: string }>("/api/family", { action: "open_file", kind, id, token });
    if (r.ok) window.open(r.data.url, "_blank"); else setMsg({ ok: false, text: r.error ?? "could not open the file" });
  };
  const any = data.achievements.length + data.certificates.length + data.portfolio.length + data.documents.length + data.plans.length;
  if (!any && token) return <Empty>Achievements, certificates and work from school will appear here.</Empty>;
  return (
    <div className="space-y-5 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {kids.map(k => {
        const a = data.achievements.filter(x => x.student_id === k.id), c = data.certificates.filter(x => x.student_id === k.id), p = data.portfolio.filter(x => x.student_id === k.id);
        const d = data.documents.filter(x => x.student_id === k.id), plans = data.plans.filter(x => x.student_id === k.id);
        if (token && !a.length && !c.length && !p.length && !d.length && !plans.length) return null;
        return (
          <section key={k.id} className="space-y-3">
            <h3 className="font-semibold">{k.name}</h3>
            {!token && <MyProgress studentId={k.id} compact />}
            {plans.map(pl => (
              <div key={pl.id} className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
                <p className="font-medium">{pl.title} <span className="text-xs font-normal text-slate-500">from {fmtDate(pl.starts_on)}{pl.review_on ? ` · next review ${fmtDate(pl.review_on)}` : ""}</span></p>
                <ul className="mt-2 space-y-1">{pl.iep_targets.map((t, i) => (
                  <li key={i}><b>{t.target}</b> <Badge tone={t.progress === "achieved" ? "green" : t.progress === "secure" ? "blue" : "slate"}>{PROGRESS[t.progress]}</Badge>
                    {t.strategies && <span className="block text-xs text-slate-600">How we help: {t.strategies}</span>}</li>
                ))}</ul>
                {pl.parent_agreed_at ? <p className="mt-2 text-xs text-emerald-700">You agreed to this plan on {fmtDate(pl.parent_agreed_at)}. Thank you.</p> : (
                  <div className="mt-2 space-y-1">
                    <textarea className="input min-h-16" value={views[pl.id] ?? ""} onChange={e => setViews({ ...views, [pl.id]: e.target.value })} placeholder="Anything you would like the school to know or change (optional)" maxLength={2000} aria-label="Your views" />
                    <button className="btn btn-primary px-3 py-1 text-xs" onClick={async () => {
                      const r = await send("/api/family", { action: "iep_agree", iep_id: pl.id, views: views[pl.id] || null, token });
                      setMsg({ ok: r.ok, text: r.ok ? "Thank you. The school has your agreement and views." : r.error ?? "failed" });
                      if (r.ok) onChange();
                    }}>I have read this plan and agree</button>
                  </div>
                )}
              </div>
            ))}
            {c.length > 0 && <div><p className="text-xs font-semibold uppercase text-slate-500">Certificates</p>
              <ul>{c.map(x => <li key={x.id}><a className="text-brand-700 hover:underline" href={`/v/${x.verify_token}`} target="_blank" rel="noreferrer">{x.title}</a> <span className="text-xs text-slate-500">{CERT_LABEL[x.kind]} · {fmtDate(x.issued_on)}</span></li>)}</ul></div>}
            {a.length > 0 && <div><p className="text-xs font-semibold uppercase text-slate-500">Achievements</p>
              <ul>{a.map(x => <li key={x.id}>{x.title}{x.award ? `: ${x.award}` : ""} <span className="text-xs text-slate-500">{fmtDate(x.achieved_on)}{x.level !== "school" ? ` · ${x.level}` : ""}</span></li>)}</ul></div>}
            {p.length > 0 && <div><p className="text-xs font-semibold uppercase text-slate-500">Work</p>
              <ul className="grid gap-1 sm:grid-cols-2">{p.map(x => (
                <li key={x.id}>{x.has_file ? <button className="text-left text-brand-700 hover:underline" onClick={() => open("portfolio", x.id)}>{x.title}</button>
                  : x.link_url ? <a className="text-brand-700 hover:underline" href={x.link_url} target="_blank" rel="noreferrer">{x.title}</a> : x.title}
                  <span className="text-xs text-slate-500"> {x.subjects?.name ?? x.kind} · {fmtDate(x.created_at)}</span>{x.feedback && <span className="block text-xs text-slate-600">Teacher: {x.feedback}</span>}</li>
              ))}</ul></div>}
            {d.length > 0 && <div><p className="text-xs font-semibold uppercase text-slate-500">Documents</p>
              <ul>{d.map(x => <li key={x.id}><button className="text-brand-700 hover:underline" onClick={() => open("document", x.id)}>{x.name}</button> <span className="text-xs text-slate-500">{fmtDate(x.created_at)}</span></li>)}</ul></div>}
          </section>
        );
      })}
    </div>
  );
}
