"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Alert, Badge, Stat, Loading, Modal, Field, fmtDate } from "@/components/ui";
import PlatformNav from "@/components/platform/PlatformNav";

type Centre = {
  revenue: { mrr: number; arr: number; past_due_mrr: number; trial_mrr: number; new_mrr_30: number; churned_mrr_30: number; renewing_60_mrr: number;
    counts: { paying: number; trial: number; past_due: number; suspended: number; cancelled: number }; by_plan: { plan: string; schools: number; mrr: number }[] };
  cash: { last_30: number; last_365: number };
  schools: { total: number; active: number; suspended: number; paused: number; new_30: number };
  adoption: { key: string; label: string; group: string; enabled: number; used: number | null }[];
  health: { ok: boolean; issues: string[]; outbox_queued: number; outbox_oldest_min: number | null; outbox_failed_24: number; webhooks_failed_24: number; cron_minutes_ago: number | null; db_bytes: number; accounts: number };
  activity: { students: number; staff: number; staff_active_pct: number;
    most: { id: string; name: string; actions_30: number; users_30: number; students: number }[];
    quiet: { id: string; name: string; actions_30: number; actions_prev_30: number; last_action_at: string | null; students: number }[] };
};
type Session = { id: string; tenant_id: string; school: string | null; started_by_name: string; reason: string; role: string; starts_at: string; expires_at: string; ended_at: string | null; live: boolean };

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const mb = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);

/** The super admin centre (phase 14k). */
export default function CentrePage() {
  const { data, error } = useApi<Centre>("/api/platform/centre");
  if (error) return <Page wide><PlatformNav /><Alert>{error}</Alert></Page>;
  if (!data) return <Page wide><PlatformNav /><Loading /></Page>;
  const r = data.revenue;
  const maxPlan = Math.max(1, ...r.by_plan.map(p => p.mrr));
  const active = Math.max(1, data.schools.active);
  return (
    <Page wide>
      <PlatformNav />
      <PageHeader eyebrow="Synergy Swift platform" title="Overview" subtitle="Revenue, how schools use the modules they pay for, the health of the system, and support access. Only the Synergy Swift team sees this." />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Monthly recurring revenue" value={naira(r.mrr)} hint={`${r.counts.paying} paying school${r.counts.paying === 1 ? "" : "s"}`} />
        <Stat label="Annual run rate" value={naira(r.arr)} />
        <Stat label="Collected, last 30 days" value={naira(data.cash.last_30)} hint={`${naira(data.cash.last_365)} in 12 months`} />
        <Stat label="Overdue (monthly value)" value={naira(r.past_due_mrr)} hint={`${r.counts.past_due} school${r.counts.past_due === 1 ? "" : "s"} past due`} tone={r.past_due_mrr ? "warn" : undefined} />
        <Stat label="New, last 30 days" value={naira(r.new_mrr_30)} tone="good" />
        <Stat label="Lost, last 30 days" value={naira(r.churned_mrr_30)} tone={r.churned_mrr_30 ? "bad" : undefined} />
        <Stat label="Renewing in 60 days" value={naira(r.renewing_60_mrr)} />
        <Stat label="On trial" value={r.counts.trial} hint={`worth ${naira(r.trial_mrr)} a month if they convert`} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Monthly revenue by plan</h2>
          {!r.by_plan.length ? <p className="text-sm text-slate-500">No paying schools yet.</p> : <ul className="space-y-2 text-sm">{r.by_plan.map(p => (
            <li key={p.plan}><div className="flex justify-between"><span>{p.plan} <span className="text-slate-500">· {p.schools} school{p.schools === 1 ? "" : "s"}</span></span><b>{naira(p.mrr)}</b></div>
              <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-700" style={{ width: `${Math.round(100 * p.mrr / maxPlan)}%` }} /></div></li>))}</ul>}
        </section>
        <section className="card p-4">
          <div className="mb-3 flex items-center gap-2"><h2 className="mr-auto font-semibold">System health</h2><Badge tone={data.health.ok ? "green" : "amber"}>{data.health.ok ? "all normal" : "needs a look"}</Badge></div>
          {data.health.issues.map((i, k) => <p key={k} className="text-sm text-amber-800">{i}</p>)}
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Scheduler last ran</dt><dd>{data.health.cron_minutes_ago === null ? "never" : `${data.health.cron_minutes_ago} min ago`}</dd>
            <dt className="text-slate-500">Messages waiting</dt><dd>{data.health.outbox_queued}{data.health.outbox_oldest_min !== null ? ` (oldest ${data.health.outbox_oldest_min} min)` : ""}</dd>
            <dt className="text-slate-500">Messages failed (24 h)</dt><dd>{data.health.outbox_failed_24}</dd>
            <dt className="text-slate-500">Webhooks failed (24 h)</dt><dd>{data.health.webhooks_failed_24}</dd>
            <dt className="text-slate-500">Database size</dt><dd>{mb(data.health.db_bytes)}</dd>
            <dt className="text-slate-500">Accounts</dt><dd>{data.health.accounts.toLocaleString("en-NG")}</dd>
            <dt className="text-slate-500">Schools</dt><dd>{data.schools.active} active · {data.schools.suspended} suspended · {data.schools.paused} paused · {data.schools.new_30} new this month</dd>
          </dl>
        </section>
      </div>

      <section className="card mt-4 p-4">
        <h2 className="font-semibold">Module adoption</h2>
        <p className="mb-3 text-sm text-slate-600">Switched on in active schools, and used in the last 30 days (something was recorded in it). A big gap means schools pay for something they are not using: a training call or a churn risk.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-[13px] text-slate-500"><tr><th className="py-1.5">Module</th><th>Switched on</th><th>Used (30 days)</th><th className="w-1/3"></th></tr></thead>
          <tbody>{data.adoption.map(m => (
            <tr key={m.key} className="border-t border-slate-100"><td className="py-1.5">{m.label}</td><td>{m.enabled} <span className="text-slate-500">({Math.round(100 * m.enabled / active)}%)</span></td>
              <td>{m.used === null ? <span className="text-slate-400">not measured</span> : <>{m.used}{m.enabled ? <span className="text-slate-500"> ({Math.round(100 * m.used / Math.max(1, m.enabled))}% of those on)</span> : null}</>}</td>
              <td><div className="relative h-2 rounded-full bg-slate-100"><div className="absolute h-full rounded-full bg-slate-300" style={{ width: `${Math.round(100 * m.enabled / active)}%` }} />
                {m.used !== null && <div className="absolute h-full rounded-full bg-brand-700" style={{ width: `${Math.round(100 * m.used / active)}%` }} />}</div></td></tr>))}</tbody></table></div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="card p-4 text-sm">
          <h2 className="font-semibold">School activity</h2>
          <p className="mb-2 text-slate-600">{data.activity.students.toLocaleString("en-NG")} students and {data.activity.staff.toLocaleString("en-NG")} staff; {data.activity.staff_active_pct}% of staff signed in this month.</p>
          <h3 className="mt-2 text-[13px] font-medium text-slate-500">Most active</h3>
          <ul>{data.activity.most.map(s => <li key={s.id} className="flex justify-between py-0.5"><Link className="text-brand-800 hover:underline" href={`/platform/${s.id}`}>{s.name}</Link><span className="text-slate-600">{s.actions_30} actions · {s.users_30} people</span></li>)}</ul>
          <h3 className="mt-3 text-[13px] font-medium text-slate-500">Quietest (possible churn)</h3>
          <ul>{data.activity.quiet.map(s => <li key={s.id} className="flex justify-between py-0.5"><Link className="text-brand-800 hover:underline" href={`/platform/${s.id}`}>{s.name}</Link>
            <span className="text-slate-600">{s.actions_30} actions (was {s.actions_prev_30}){s.last_action_at ? ` · last ${fmtDate(s.last_action_at)}` : ""}</span></li>)}</ul>
        </section>
        <SupportAccess />
      </div>
    </Page>
  );
}

function SupportAccess() {
  const { data, reload } = useApi<{ sessions: Session[] }>("/api/platform/support");
  const { data: tenants } = useApi<{ id: string; name: string; status: string }[]>("/api/platform/tenants");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ tenant_id: "", reason: "", minutes: 30, role: "school_admin" });
  const [link, setLink] = useState<{ url: string | null; until: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const start = async () => {
    const r = await send<{ action_link: string | null; expires_at: string }>("/api/platform/support", { action: "start", ...f });
    if (!r.ok) return setErr(r.error);
    setErr(null); setLink({ url: r.data.action_link, until: r.data.expires_at }); reload();
  };
  return (
    <section className="card p-4 text-sm">
      <div className="flex items-center gap-2"><h2 className="mr-auto font-semibold">Support access</h2><button className="btn btn-primary" onClick={() => { setOpen(true); setLink(null); }}>Open a school</button></div>
      <p className="mt-1 text-slate-600">Instead of signing in as a real person: a separate &quot;Synergy Swift support&quot; account in one school for up to an hour, with a reason. Everything it does is recorded under that name, the school sees every visit, and it stops working when the time is up.</p>
      <ul className="mt-3 space-y-2">{(data?.sessions ?? []).slice(0, 12).map(s => (
        <li key={s.id} className="flex flex-wrap items-center gap-2"><span className="mr-auto"><b>{s.school}</b> · {s.started_by_name} · {fmtDate(s.starts_at, true)}<span className="block text-slate-500">{s.reason}</span></span>
          {s.live ? <><Badge tone="green">open until {new Date(s.expires_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Badge>
            <button className="btn btn-ghost border border-slate-300 px-3 py-1 text-xs" onClick={async () => { await send("/api/platform/support", { action: "end", id: s.id }); reload(); }}>End now</button></>
            : <Badge>ended</Badge>}</li>))}</ul>
      <Modal open={open} onClose={() => setOpen(false)} title="Open a school for support">
        {link ? (<div className="space-y-3">
          <Alert tone="green">Support access is open until {new Date(link.until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</Alert>
          <p>Open this one-time link in a <b>private window</b> so your own sign-in is not replaced:</p>
          {link.url ? <input className="input font-mono text-xs" readOnly value={link.url} onFocus={e => e.target.select()} /> : <Alert>No link was returned.</Alert>}
        </div>) : (<div className="space-y-3">
          <Field label="School"><select className="input" value={f.tenant_id} onChange={e => setF({ ...f, tenant_id: e.target.value })}><option value="">Choose…</option>
            {(tenants ?? []).filter(t => t.status === "active").map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Act as"><select className="input" value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>
              <option value="school_admin">School admin</option><option value="teacher">Teacher</option><option value="bursar">Bursar</option><option value="hr_manager">HR manager</option><option value="exam_officer">Exam officer</option></select></Field>
            <Field label="For"><select className="input" value={f.minutes} onChange={e => setF({ ...f, minutes: Number(e.target.value) })}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>1 hour</option></select></Field>
          </div>
          <Field label="Reason (the school sees this)"><textarea className="input" rows={3} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} placeholder="e.g. Ticket 1042: report cards not showing the class position" maxLength={500} /></Field>
          {err && <Alert>{err}</Alert>}
          <button className="btn btn-primary" disabled={!f.tenant_id || f.reason.trim().length < 10} onClick={start}>Open support access</button>
        </div>)}
      </Modal>
    </section>
  );
}
