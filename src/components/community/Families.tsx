"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field, Loading, Modal, Stat, fmtDate, money } from "@/components/ui";
import type { FamilySummary, SegmentRules } from "@/lib/community";
import { npsCategory } from "@/lib/community";
import Tickets from "./Tickets";

type ListData = {
  items: FamilySummary[]; total: number; families: number; currency: string; classes: { id: string; name: string; level: string | null }[];
  overview: { families: number; high_risk: number; medium_risk: number; nps: number | null; nps_responses: number; owing: number; open_tickets: number; opted_out: number };
};
const RISK_TONE = { high: "red", medium: "amber", low: "green" } as const;

export function npsBadge(score: number | null) {
  const c = npsCategory(score);
  if (!c) return <span className="text-xs text-slate-400">—</span>;
  return <Badge tone={c === "promoter" ? "green" : c === "passive" ? "slate" : "red"}>{score}</Badge>;
}

/** Filter controls for family segments, shared with the segment editor. */
export function RulesEditor({ rules, onChange, classes }: { rules: SegmentRules; onChange: (r: SegmentRules) => void; classes: { id: string; name: string }[] }) {
  const toggle = <K extends keyof SegmentRules>(k: K, v: string) => {
    const cur = (rules[k] as string[] | undefined) ?? [];
    const next = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v];
    onChange({ ...rules, [k]: next.length ? next : undefined });
  };
  const chip = (k: keyof SegmentRules, v: string, label: string) => {
    const on = ((rules[k] as string[] | undefined) ?? []).includes(v);
    return <button type="button" key={v} onClick={() => toggle(k, v)} aria-pressed={on} className={"rounded-full border px-2 py-0.5 text-xs " + (on ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600")}>{label}</button>;
  };
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <Field label="Classes">
        <select className="input" multiple size={4} value={rules.class_group_ids ?? []} onChange={e => onChange({ ...rules, class_group_ids: [...e.target.selectedOptions].map(o => o.value).filter(Boolean) })}>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <div className="space-y-2">
        <div><span className="label">Retention risk</span><div className="flex flex-wrap gap-1">{(["high", "medium", "low"] as const).map(v => chip("risk", v, v))}</div></div>
        <div><span className="label">NPS</span><div className="flex flex-wrap gap-1">{chip("nps", "promoter", "Promoters")}{chip("nps", "passive", "Passives")}{chip("nps", "detractor", "Detractors")}{chip("nps", "none", "Not answered")}</div></div>
        <div><span className="label">Re-enrolment</span><div className="flex flex-wrap gap-1">{chip("reenrolment", "returning", "Returning")}{chip("reenrolment", "undecided", "Undecided")}{chip("reenrolment", "not_returning", "Not returning")}{chip("reenrolment", "no_response", "No answer")}</div></div>
      </div>
      <Field label="Owes at least"><input className="input" type="number" min={0} value={rules.min_balance ?? ""} onChange={e => onChange({ ...rules, min_balance: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      <Field label="Reachable by">
        <select className="input" value={rules.channel ?? ""} onChange={e => onChange({ ...rules, channel: (e.target.value || null) as SegmentRules["channel"] })}><option value="">Any</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></select>
      </Field>
      <div className="flex flex-wrap gap-3 sm:col-span-2">
        {([["overdue", "Has overdue fees"], ["open_ticket", "Has an open complaint"], ["referrers", "Has referred a family"]] as const).map(([k, l]) => (
          <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={Boolean(rules[k])} onChange={e => onChange({ ...rules, [k]: e.target.checked || undefined })} /> {l}</label>
        ))}
        <label className="flex items-center gap-1">At least <input className="input w-16" type="number" min={1} max={20} value={rules.min_children ?? ""} onChange={e => onChange({ ...rules, min_children: e.target.value === "" ? null : Number(e.target.value) })} /> children</label>
      </div>
    </div>
  );
}

/** Every current family with NPS, balance, complaints, re-enrolment and a retention flag; click for the 360° profile. */
export default function Families({ segments, openId }: { segments: { id: string; name: string }[]; openId?: string | null }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const [rules, setRules] = useState<SegmentRules>({});
  const [segment, setSegment] = useState("");
  const [filters, setFilters] = useState(false);
  const [open, setOpen] = useState<string | null>(openId ?? null);
  const url = `/api/community/families?q=${encodeURIComponent(query)}${segment ? `&segment=${segment}` : ""}${Object.keys(rules).length ? `&rules=${encodeURIComponent(JSON.stringify(rules))}` : ""}`;
  const { data, error } = useApi<ListData>(url);
  const [saveName, setSaveName] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const o = data.overview;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Families" value={o.families} />
        <Stat label="Net Promoter Score" value={o.nps === null ? "—" : o.nps} hint={`${o.nps_responses} families answered`} tone={o.nps === null ? undefined : o.nps >= 30 ? "good" : o.nps < 0 ? "bad" : "warn"} />
        <Stat label="At risk of leaving" value={o.high_risk} hint={`${o.medium_risk} more to watch`} tone={o.high_risk ? "bad" : "good"} />
        <Stat label="Owing fees" value={o.owing} />
        <Stat label="Open complaints" value={o.open_tickets} tone={o.open_tickets ? "warn" : undefined} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" value={q} onChange={e => setQ(e.target.value)} placeholder="Search parent, child, phone or email" aria-label="Search families" />
        <select className="input w-auto" value={segment} onChange={e => setSegment(e.target.value)} aria-label="Segment"><option value="">All families</option>{segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <button className="btn btn-outline" onClick={() => setFilters(!filters)} aria-expanded={filters}>Filters{Object.keys(rules).length ? ` (${Object.keys(rules).length})` : ""}</button>
        <span className="text-sm text-slate-500">{data.total} of {data.families}</span>
      </div>
      {filters && (
        <div className="card space-y-3 p-4">
          <RulesEditor rules={rules} onChange={setRules} classes={data.classes} />
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <button className="btn btn-outline" onClick={() => setRules({})}>Clear</button>
            <span className="flex-1" />
            <input className="input w-56" value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="Name this segment" aria-label="Segment name" />
            <button className="btn btn-primary" disabled={saveName.trim().length < 2 || !Object.keys(rules).length} onClick={async () => {
              const r = await send("/api/community/segments", { action: "save", name: saveName.trim(), rules });
              setSaved(r.ok ? `Saved "${saveName.trim()}". Use it for campaigns and surveys.` : r.error);
            }}>Save as segment</button>
          </div>
          {saved && <p className="text-xs text-slate-600" role="status">{saved}</p>}
        </div>
      )}
      {!data.items.length ? <Empty>No families match.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
              <th className="p-2">Family</th><th className="p-2">Children</th><th className="p-2">Risk</th><th className="p-2">NPS</th><th className="p-2 text-right">Balance</th><th className="p-2">Complaints</th><th className="p-2">Next session</th><th className="p-2">Last contact</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">{data.items.map(f => (
              <tr key={f.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(f.id)}>
                <td className="p-2 font-medium">{f.full_name}{f.marketing_opt_out && <span className="ml-1 text-xs text-slate-400">(no campaigns)</span>}<span className="block text-xs font-normal text-slate-500">{f.phone ?? f.email ?? "no contact"}</span></td>
                <td className="p-2">{f.children.map(c => <span key={c.id} className="block">{c.name} <span className="text-xs text-slate-500">{c.class_name ?? ""}</span></span>)}</td>
                <td className="p-2"><Badge tone={RISK_TONE[f.risk.level]}>{f.risk.level}</Badge>{f.risk.reasons[0] && <span className="block max-w-48 text-xs text-slate-500">{f.risk.reasons[0]}</span>}</td>
                <td className="p-2">{npsBadge(f.last_nps)}</td>
                <td className={"p-2 text-right tabular-nums " + (f.overdue_invoices ? "text-rose-700" : "")}>{f.balance ? money(f.balance, data.currency) : "—"}</td>
                <td className="p-2">{f.open_tickets ? <Badge tone={f.breached_tickets ? "red" : "amber"}>{f.open_tickets} open</Badge> : "—"}</td>
                <td className="p-2 text-xs">{f.reenrolment ? f.reenrolment.replace("_", " ") : "—"}</td>
                <td className="p-2 text-xs text-slate-500">{f.last_contact_at ? fmtDate(f.last_contact_at) : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title="Family" wide>
        {open && <FamilyProfile id={open} currency={data.currency} />}
      </Modal>
    </div>
  );
}

type Profile = {
  guardian: { id: string; full_name: string; email: string | null; phone: string | null; whatsapp_phone: string | null; language: string | null; notify_email: boolean; notify_whatsapp: boolean; notify_sms: boolean; marketing_opt_out: boolean; referral_code: string | null; created_at: string; user_id: string | null };
  summary: FamilySummary | null;
  children: { id: string; name: string; admission_no: string; status: string; photo_url: string | null; class_name: string | null; relation: string; latest_average: number | null }[];
  co_guardians: { id: string; full_name: string; phone: string | null; email: string | null; relation: string }[];
  invoices: { id: string; invoice_no: string; title: string; status: string; total: number; amount_paid: number; due_date: string | null }[];
  tickets: { id: string; ticket_no: string; subject: string; status: string; created_at: string }[];
  rewards: { id: string; kind: string; amount: number; status: string }[];
  timeline: { at: string; type: string; title: string; detail?: string | null; tone?: string }[];
};
const TYPE_ICON: Record<string, string> = { ticket: "🎫", message: "💬", survey: "📊", payment: "💳", meeting: "🤝", reenrolment: "🔁", event: "📅", referral: "🎁", sent: "✉️", result: "📄", call: "📞", note: "📝", visit: "🏫", email: "✉️", sms: "📱", whatsapp: "💬", retention: "⚠️", other: "•" };

/** 360° view of one family: children, fees, complaints, survey answers, messages, meetings, referrals and every logged contact. */
export function FamilyProfile({ id, currency }: { id: string; currency: string }) {
  const { data, error, reload } = useApi<Profile>(`/api/community/families?id=${id}`);
  const [log, setLog] = useState({ kind: "call", body: "", follow_up_at: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [ticket, setTicket] = useState(false);
  const types = useMemo(() => [...new Set((data?.timeline ?? []).map(t => t.type))], [data]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const g = data.guardian, s = data.summary;
  const tl = data.timeline.filter(t => !filter || t.type === filter);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{g.full_name}</h3>
          <p className="text-slate-600">{[g.phone, g.email].filter(Boolean).join(" · ") || "No contact details"}</p>
          <p className="text-xs text-slate-500">Prefers {[g.notify_email && "email", g.notify_whatsapp && "WhatsApp", g.notify_sms && "SMS"].filter(Boolean).join(", ") || "no channel"}{g.language ? ` · language: ${g.language}` : ""} · {g.user_id ? "uses the parent app" : "uses the private link"} · with the school since {fmtDate(g.created_at)}</p>
        </div>
        {s && <div className="text-right"><Badge tone={RISK_TONE[s.risk.level]}>{s.risk.level} retention risk ({s.risk.score})</Badge>{s.risk.reasons.map(r => <p key={r} className="text-xs text-slate-500">{r}</p>)}</div>}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Balance" value={s?.balance ? money(s.balance, currency) : "—"} tone={s?.overdue_invoices ? "bad" : undefined} hint={s?.overdue_invoices ? `${s.overdue_invoices} overdue` : undefined} />
        <Stat label="Last NPS" value={s?.last_nps ?? "—"} tone={s?.last_nps == null ? undefined : s.last_nps >= 9 ? "good" : s.last_nps <= 6 ? "bad" : undefined} />
        <Stat label="Attendance (30 days)" value={s?.attendance_rate == null ? "—" : `${Math.round(s.attendance_rate * 100)}%`} />
        <Stat label="Referrals" value={s?.referrals ?? 0} hint={data.rewards.length ? `${data.rewards.length} reward${data.rewards.length === 1 ? "" : "s"}` : undefined} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-lg border border-slate-200 p-3">
          <h4 className="mb-1 font-semibold">Children</h4>
          <ul className="space-y-1">{data.children.map(c => (
            <li key={c.id} className="flex items-center justify-between gap-2"><span>{c.name} <span className="text-xs text-slate-500">{c.admission_no} · {c.class_name ?? "no class"} · {c.relation}</span></span>
              <span className="text-xs">{c.status !== "active" ? <Badge tone="slate">{c.status}</Badge> : c.latest_average !== null ? `avg ${c.latest_average}%` : ""}</span></li>
          ))}</ul>
          {data.co_guardians.length > 0 && <p className="mt-2 text-xs text-slate-500">Other guardians: {data.co_guardians.map(c => `${c.full_name} (${c.relation}${c.phone ? `, ${c.phone}` : ""})`).join("; ")}</p>}
        </section>
        <section className="rounded-lg border border-slate-200 p-3">
          <h4 className="mb-1 font-semibold">Fees</h4>
          {!data.invoices.length ? <p className="text-slate-500">No invoices.</p> : <ul className="space-y-1">{data.invoices.slice(0, 6).map(i => (
            <li key={i.id} className="flex justify-between gap-2"><span>{i.title} <span className="font-mono text-xs text-slate-400">{i.invoice_no}</span></span>
              <span className="tabular-nums">{money(Number(i.total) - Number(i.amount_paid), currency)} <Badge tone={i.status === "paid" ? "green" : i.due_date && i.due_date < new Date().toISOString().slice(0, 10) ? "red" : "amber"}>{i.status.replace("_", " ")}</Badge></span></li>
          ))}</ul>}
        </section>
      </div>
      <section className="rounded-lg border border-slate-200 p-3">
        <h4 className="mb-2 font-semibold">Log a contact</h4>
        {msg && <div className="mb-2"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
        <form className="flex flex-wrap items-end gap-2" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/community/families", { action: "log", guardian_id: g.id, kind: log.kind, body: log.body, follow_up_at: log.follow_up_at ? new Date(log.follow_up_at).toISOString() : null });
          setMsg({ ok: r.ok, text: r.ok ? "Logged." : r.error ?? "failed" });
          if (r.ok) { setLog({ kind: log.kind, body: "", follow_up_at: "" }); reload(); }
        }}>
          <select className="input w-auto" value={log.kind} onChange={e => setLog({ ...log, kind: e.target.value })} aria-label="Kind">{["call", "meeting", "visit", "email", "whatsapp", "sms", "note", "retention"].map(k => <option key={k}>{k}</option>)}</select>
          <input className="input min-w-64 flex-1" value={log.body} onChange={e => setLog({ ...log, body: e.target.value })} placeholder="What was discussed" required maxLength={4000} />
          <label className="text-xs">Follow up<input className="input" type="datetime-local" value={log.follow_up_at} onChange={e => setLog({ ...log, follow_up_at: e.target.value })} /></label>
          <button className="btn btn-primary">Log</button>
          <button type="button" className="btn btn-outline" onClick={() => setTicket(true)}>Log a complaint</button>
          <label className="ml-auto flex items-center gap-1 text-xs"><input type="checkbox" checked={!g.marketing_opt_out} onChange={async e => { await send("/api/community/families", { action: "opt_out", guardian_id: g.id, opt_out: !e.target.checked }); reload(); }} /> Receives campaigns</label>
        </form>
      </section>
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h4 className="font-semibold">History</h4>
          <select className="input w-auto py-1 text-xs" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter history"><option value="">Everything</option>{types.map(t => <option key={t} value={t}>{t}</option>)}</select>
        </div>
        {!tl.length ? <Empty>Nothing recorded yet.</Empty> : (
          <ol className="relative space-y-2 border-l border-slate-200 pl-4">{tl.map((t, i) => (
            <li key={i}>
              <span aria-hidden className="absolute -left-2.5 text-sm">{TYPE_ICON[t.type] ?? "•"}</span>
              <p className={t.tone === "red" ? "text-rose-700" : t.tone === "green" ? "text-emerald-700" : t.tone === "amber" ? "text-amber-800" : ""}>{t.title}</p>
              {t.detail && <p className="whitespace-pre-wrap text-xs text-slate-500">{t.detail}</p>}
              <p className="text-[11px] text-slate-400">{fmtDate(t.at, true)}</p>
            </li>
          ))}</ol>
        )}
      </section>
      <Modal open={ticket} onClose={() => { setTicket(false); reload(); }} title="Complaints and requests" wide>
        {ticket && <Tickets guardian={{ id: g.id, name: g.full_name, children: data.children.filter(c => c.status === "active").map(c => ({ id: c.id, name: c.name })) }} />}
      </Modal>
    </div>
  );
}
