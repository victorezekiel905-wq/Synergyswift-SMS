"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Loading, Modal, Field, Badge, Stat, Tabs, fmtDate } from "@/components/ui";
import PlatformNav from "@/components/platform/PlatformNav";
import { SalesBrief, WeeklySummary, type Brief, type Summary } from "@/components/platform/SalesAi";
import { quote, bandFor, bandLabel, naira, MODULE_GROUPS, type ModuleGroup, type PlanDef } from "@/lib/saas";
import { ONBOARDING, SOURCES, SOURCE_LABEL, STAGES, stageLabel, type Stage } from "@/lib/sales";

type Lead = { id: string; school_name: string; contact_name: string | null; contact_role: string | null; phone: string | null; email: string | null; city: string | null; state: string | null;
  students_estimate: number | null; source: (typeof SOURCES)[number]; stage: Stage; owner_id: string | null; next_action: string | null; next_action_at: string | null; demo_at: string | null;
  package_code: string | null; value_estimate: number | null; score: number; lost_reason: string | null; tenant_id: string | null; needs: string | null; created_at: string; last_activity_at?: string | null; ai_brief?: Brief | null };
type Plan = { code: string; name: string; groups: string[]; prices: number[] | null };
type Data = { leads: Lead[]; plans: Plan[]; group_prices: Record<string, number[]>; team: { user_id: string; email: string | null; role: string }[];
  ai?: { available: boolean; summary: Summary | null };
  stats: { open: number; pipeline: number; weighted: number; won_this_month: number; won_value_this_month: number; due_today: number } };
type Customer = { tenant_id: string; name: string; status: string; students: number; staff: number; staff_signed_in_30: number; plan_name: string | null; period_end: string | null; sub_status: string | null;
  health: { score: number; risk: "low" | "medium" | "high"; reasons: string[] }; onboarding: string[] };

const OPEN: Stage[] = ["new", "contacted", "demo_booked", "demo_done", "trial", "proposal"];
const RISK = { low: { label: "Healthy", tone: "green" }, medium: { label: "Watch", tone: "amber" }, high: { label: "At risk", tone: "red" } } as const;

/** The platform's sales CRM and customer health (phase 14g-1). */
export default function Sales() {
  const [tab, setTab] = useState<"pipeline" | "customers">("pipeline");
  const { data, error, reload } = useApi<Data>("/api/platform/sales");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  if (error) return <Page wide><PlatformNav /><Alert>{error}</Alert></Page>;
  if (!data) return <Page wide><PlatformNav /><Loading /></Page>;
  const s = data.stats;
  const shown = data.leads.filter(l => !q || `${l.school_name} ${l.contact_name ?? ""} ${l.city ?? ""} ${l.state ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Page wide>
      <PlatformNav />
      <PageHeader eyebrow="Synergy Swift platform" title="Sales & customers" subtitle="Prospect schools from first contact to live, quotes from your price list, and which customers need attention before renewal." />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Open deals" value={s.open} />
        <Stat label="Pipeline a year" value={naira(s.pipeline)} />
        <Stat label="Weighted" value={naira(s.weighted)} hint="value × chance of closing" />
        <Stat label="Won this month" value={`${s.won_this_month} · ${naira(s.won_value_this_month)}`} tone={s.won_this_month ? "good" : undefined} />
        <Stat label="Follow-ups due" value={s.due_today} tone={s.due_today ? "warn" : undefined} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "pipeline", label: "Pipeline" }, { id: "customers", label: "Customers & renewals" }]} />
      {tab === "pipeline" ? (<>
        <WeeklySummary summary={data.ai?.summary ?? null} available={Boolean(data.ai?.available)} onChanged={reload} />
        <div className="mb-3 flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => setAdding(true)}>+ New lead</button>
          <input className="input w-64" placeholder="Find a school, contact or city" value={q} onChange={e => setQ(e.target.value)} aria-label="Find a lead" />
          <Link href="/demo" target="_blank" className="ml-auto self-center text-sm text-brand-700 underline">Website demo form</Link>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2" aria-label="Pipeline by stage">
          {OPEN.map(st => {
            const col = shown.filter(l => l.stage === st).sort((a, b) => b.score - a.score);
            return (
              <section key={st} className="w-64 shrink-0 rounded-xl bg-slate-100/70 p-2">
                <p className="px-1 pb-2 text-xs font-semibold text-slate-600"><span className="block">{stageLabel(st)}</span>
                  <span className="block font-normal text-slate-500">{col.length} · {naira(col.reduce((a, l) => a + Number(l.value_estimate ?? 0), 0))}</span></p>
                <ul className="space-y-2">{col.map(l => (
                  <li key={l.id}><button onClick={() => setOpen(l.id)} className="card block w-full p-3 text-left hover:border-slate-400">
                    <span className="flex items-start justify-between gap-2"><span className="font-semibold leading-tight">{l.school_name}</span>
                      <span title="Lead score" className={"rounded px-1.5 text-xs font-bold tabular-nums " + (l.score >= 70 ? "bg-emerald-100 text-emerald-800" : l.score >= 40 ? "bg-amber-100 text-amber-900" : "bg-slate-200 text-slate-700")}>{l.score}</span></span>
                    <span className="mt-1 block text-xs text-slate-500">{[l.city, l.state].filter(Boolean).join(", ")}{l.students_estimate ? ` · ${l.students_estimate} students` : ""}</span>
                    {l.value_estimate ? <span className="block text-xs font-medium text-slate-700">{naira(Number(l.value_estimate))} a year</span> : null}
                    {l.next_action_at && <span className={"mt-1 block text-xs " + (new Date(l.next_action_at) < new Date() ? "font-semibold text-rose-700" : "text-slate-500")}>{l.next_action ?? "Next step"} · {fmtDate(l.next_action_at)}</span>}
                  </button></li>))}</ul>
              </section>
            );
          })}
        </div>
        <details className="mt-4"><summary className="cursor-pointer text-sm text-slate-600">Won and lost ({shown.filter(l => ["won", "lost"].includes(l.stage)).length})</summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-3">{shown.filter(l => ["won", "lost"].includes(l.stage)).map(l => (
            <li key={l.id}><button onClick={() => setOpen(l.id)} className="card flex w-full items-center justify-between p-3 text-left"><span>{l.school_name}</span><Badge tone={l.stage === "won" ? "green" : "slate"}>{stageLabel(l.stage)}</Badge></button></li>))}</ul>
        </details>
      </>) : <Customers />}
      <Modal open={adding} onClose={() => setAdding(false)} title="New lead" wide>
        {adding && <LeadForm team={data.team} onDone={id => { setAdding(false); reload(); if (id) setOpen(id); }} />}
      </Modal>
      <Modal open={Boolean(open)} onClose={() => { setOpen(null); reload(); }} title="Prospect school" wide>
        {open && <LeadDrawer id={open} data={data} onChanged={reload} />}
      </Modal>
    </Page>
  );
}

function LeadForm({ lead, team, onDone }: { lead?: Lead; team: Data["team"]; onDone: (id?: string) => void }) {
  const [f, setF] = useState<Partial<Lead>>(lead ?? { source: "referral" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof Lead) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function save() {
    const r = await send<{ lead: Lead }>("/api/platform/sales", { action: "save_lead", id: lead?.id ?? null, school_name: f.school_name ?? "", contact_name: f.contact_name || null, contact_role: f.contact_role || null,
      phone: f.phone || null, email: f.email || null, city: f.city || null, state: f.state || null, students_estimate: f.students_estimate ? Number(f.students_estimate) : null,
      source: f.source ?? "other", owner_id: f.owner_id || null, needs: f.needs || null, value_estimate: f.value_estimate ? Number(f.value_estimate) : null });
    if (!r.ok) return setErr(r.error ?? "failed");
    onDone(r.data.lead.id);
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="School"><input className="input" value={f.school_name ?? ""} onChange={set("school_name")} /></Field>
        <Field label="Students (about)"><input className="input" type="number" min={0} value={f.students_estimate ?? ""} onChange={set("students_estimate")} /></Field>
        <Field label="Contact"><input className="input" value={f.contact_name ?? ""} onChange={set("contact_name")} /></Field>
        <Field label="Role"><input className="input" value={f.contact_role ?? ""} onChange={set("contact_role")} placeholder="Proprietor, principal…" /></Field>
        <Field label="Phone"><input className="input" value={f.phone ?? ""} onChange={set("phone")} /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email ?? ""} onChange={set("email")} /></Field>
        <Field label="City"><input className="input" value={f.city ?? ""} onChange={set("city")} /></Field>
        <Field label="State"><input className="input" value={f.state ?? ""} onChange={set("state")} /></Field>
        <Field label="Source"><select className="input" value={f.source} onChange={set("source")}>{SOURCES.map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</select></Field>
        <Field label="Owner"><select className="input" value={f.owner_id ?? ""} onChange={set("owner_id")}><option value="">Me</option>{team.map(t => <option key={t.user_id} value={t.user_id}>{t.email ?? t.user_id.slice(0, 8)}</option>)}</select></Field>
      </div>
      <Field label="Needs / notes"><textarea className="input" rows={3} value={f.needs ?? ""} onChange={set("needs")} /></Field>
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end"><button className="btn btn-primary" onClick={save}>Save</button></div>
    </div>
  );
}

function LeadDrawer({ id, data, onChanged }: { id: string; data: Data; onChanged: () => void }) {
  const { data: d, error, reload } = useApi<{ lead: Lead; activities: { id: string; kind: string; body: string; actor_id: string | null; at: string }[];
    quotes: { id: string; number: string; plan_code: string; band: number | null; students: number; annual: number; status: string; valid_until: string; lines: { label: string; amount: number }[]; cycle: string }[] }>(`/api/platform/sales?lead=${id}`, [id]);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState({ kind: "call", body: "", next_action: "", next_action_at: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [qf, setQf] = useState({ plan_code: data.plans[0]?.code ?? "growth", students: "", add_on_groups: [] as string[], cycle: "annual", discount_pct: "0", custom_annual: "" });
  const who = (uid: string | null) => data.team.find(t => t.user_id === uid)?.email ?? "Synergy Swift";
  const plan = data.plans.find(p => p.code === qf.plan_code);
  const preview = useMemo(() => {
    const n = Number(qf.students || d?.lead.students_estimate || 0);
    if (!plan || !n) return null;
    return quote({ plan: plan as Pick<PlanDef, "name" | "groups" | "prices">, band: bandFor(n), addOns: qf.add_on_groups as ModuleGroup[], cycle: qf.cycle as "annual" | "termly",
      groupPrices: data.group_prices, discountPct: Number(qf.discount_pct || 0), customAnnual: qf.custom_annual ? Number(qf.custom_annual) : null });
  }, [plan, qf, d?.lead.students_estimate, data.group_prices]);
  if (error) return <Alert>{error}</Alert>;
  if (!d) return <Loading />;
  const l = d.lead;
  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await send("/api/platform/sales", body);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) { reload(); onChanged(); }
    return r.ok;
  };
  if (editing) return <LeadForm lead={l} team={data.team} onDone={() => { setEditing(false); reload(); onChanged(); }} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <p className="text-xl font-semibold">{l.school_name} <Badge tone={l.stage === "won" ? "green" : l.stage === "lost" ? "slate" : "blue"}>{stageLabel(l.stage)}</Badge></p>
          <p className="text-sm text-slate-600">{[l.contact_name, l.contact_role].filter(Boolean).join(", ")} · {[l.phone, l.email].filter(Boolean).join(" · ")}</p>
          <p className="text-xs text-slate-500">{[l.city, l.state].filter(Boolean).join(", ")}{l.students_estimate ? ` · ${l.students_estimate} students (${bandLabel(bandFor(l.students_estimate)).toLowerCase()})` : ""} · {SOURCE_LABEL[l.source]} · score {l.score}</p>
          {l.needs && <p className="mt-1 text-sm text-slate-700">{l.needs}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button className="btn btn-ghost" onClick={() => setEditing(true)}>Edit</button>
          {l.phone && <a className="btn btn-ghost no-underline" href={`https://wa.me/${l.phone.replace(/[^0-9]/g, "").replace(/^0/, "234")}`} target="_blank" rel="noreferrer">WhatsApp</a>}
          {l.tenant_id ? <Link className="btn btn-primary no-underline" href={`/platform/${l.tenant_id}`}>Open the school</Link>
            : <Link className="btn btn-primary no-underline" href={`/platform/new?lead=${l.id}`}>Create the school</Link>}
          {!l.tenant_id && <Link className="btn btn-outline no-underline" href={`/platform/codes?lead=${l.id}&school=${encodeURIComponent(l.school_name)}`}>Send a school code</Link>}
        </div>
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Stage">
        {STAGES.map(s => <button key={s.key} disabled={s.key === l.stage} onClick={async () => {
          const reason = s.key === "lost" ? prompt("Why was this school lost? (price, chose another system, not ready…)") : null;
          if (s.key === "lost" && !reason) return;
          await act({ action: "stage", lead_id: l.id, stage: s.key, lost_reason: reason }, `Moved to ${s.label}.`);
        }} className={"rounded-full border px-3 py-1 text-xs " + (s.key === l.stage ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 hover:border-slate-500")}>{s.label}</button>)}
      </div>
      {l.lost_reason && <p className="text-sm text-slate-600">Lost: {l.lost_reason}</p>}
      {!["won", "lost"].includes(l.stage) && <SalesBrief key={l.id} lead={l} plans={data.plans} available={Boolean(data.ai?.available)} onChanged={() => { reload(); onChanged(); }} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h3 className="font-semibold">Log a contact</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr]">
            <select className="input" value={note.kind} onChange={e => setNote({ ...note, kind: e.target.value })} aria-label="Kind">
              {["call", "whatsapp", "email", "meeting", "demo", "note"].map(k => <option key={k} value={k}>{k === "demo" ? "Demo given" : k[0]!.toUpperCase() + k.slice(1)}</option>)}</select>
            <input className="input" value={note.body} onChange={e => setNote({ ...note, body: e.target.value })} placeholder="What happened" />
            <input className="input" value={note.next_action} onChange={e => setNote({ ...note, next_action: e.target.value })} placeholder="Next step" aria-label="Next step" />
            <input className="input" type="date" value={note.next_action_at} onChange={e => setNote({ ...note, next_action_at: e.target.value })} aria-label="Next step date" />
          </div>
          <button className="btn btn-primary mt-2" disabled={!note.body.trim()} onClick={async () => {
            if (await act({ action: "activity", lead_id: l.id, kind: note.kind, body: note.body, next_action: note.next_action || null,
              next_action_at: note.next_action_at ? new Date(`${note.next_action_at}T09:00:00`).toISOString() : null }, "Logged.")) setNote({ kind: "call", body: "", next_action: "", next_action_at: "" });
          }}>Log</button>
          <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto text-sm">{d.activities.map(a => (
            <li key={a.id} className="border-l-2 border-slate-200 pl-3"><p>{a.body}</p><p className="text-xs text-slate-500">{a.kind} · {who(a.actor_id)} · {fmtDate(a.at, true)}</p></li>))}</ul>
        </section>

        <section className="card p-4">
          <h3 className="font-semibold">Quote</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="Plan"><select className="input" value={qf.plan_code} onChange={e => setQf({ ...qf, plan_code: e.target.value })}>{data.plans.map(p => <option key={p.code} value={p.code}>{p.name}</option>)}</select></Field>
            <Field label="Students"><input className="input" type="number" min={1} value={qf.students} placeholder={String(l.students_estimate ?? "")} onChange={e => setQf({ ...qf, students: e.target.value })} /></Field>
            <Field label="Billing"><select className="input" value={qf.cycle} onChange={e => setQf({ ...qf, cycle: e.target.value })}><option value="annual">Yearly</option><option value="termly">Termly (+10%)</option></select></Field>
            <Field label="Discount %"><input className="input" type="number" min={0} max={100} value={qf.discount_pct} onChange={e => setQf({ ...qf, discount_pct: e.target.value })} /></Field>
          </div>
          <p className="label mt-2">Add-ons</p>
          <div className="flex flex-wrap gap-1.5">{MODULE_GROUPS.filter(g => !plan?.groups.includes(g.key)).map(g => (
            <label key={g.key} className={"cursor-pointer rounded-full border px-2.5 py-1 text-xs " + (qf.add_on_groups.includes(g.key) ? "border-brand-700 bg-brand-50" : "border-slate-300")}>
              <input type="checkbox" className="sr-only" checked={qf.add_on_groups.includes(g.key)} onChange={() => setQf({ ...qf, add_on_groups: qf.add_on_groups.includes(g.key) ? qf.add_on_groups.filter(x => x !== g.key) : [...qf.add_on_groups, g.key] })} />{g.label}</label>))}</div>
          {preview && (preview.annual === null ? <p className="mt-2 text-sm text-amber-800">Above the top size band: agree a yearly price.</p> : (
            <ul className="mt-3 space-y-1 text-sm">{preview.lines.map((x, i) => <li key={i} className="flex justify-between"><span>{x.label}</span><span className="tabular-nums">{naira(x.amount)}</span></li>)}
              <li className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Per year</span><span className="tabular-nums">{naira(preview.annual)}</span></li></ul>))}
          {preview?.annual === null && <Field label="Agreed price a year (₦)"><input className="input" type="number" min={0} value={qf.custom_annual} onChange={e => setQf({ ...qf, custom_annual: e.target.value })} /></Field>}
          <button className="btn btn-primary mt-2" onClick={() => act({ action: "quote", lead_id: l.id, plan_code: qf.plan_code, students: Number(qf.students || l.students_estimate || 0),
            add_on_groups: qf.add_on_groups, cycle: qf.cycle, discount_pct: Number(qf.discount_pct || 0), custom_annual: qf.custom_annual ? Number(qf.custom_annual) : null }, "Quote saved.")}>Save quote</button>
          <ul className="mt-3 space-y-2">{d.quotes.map(qq => (
            <li key={qq.id} className="rounded-lg border border-slate-200 p-2 text-sm">
              <p className="flex flex-wrap items-center justify-between gap-2"><b>{qq.number}</b><span>{naira(Number(qq.annual))} a year</span><Badge tone={qq.status === "accepted" ? "green" : qq.status === "declined" ? "red" : qq.status === "sent" ? "blue" : "slate"}>{qq.status}</Badge></p>
              <p className="text-xs text-slate-500">{data.plans.find(p => p.code === qq.plan_code)?.name ?? qq.plan_code} · {qq.students} students · valid until {fmtDate(qq.valid_until)}</p>
              {qq.status !== "accepted" && qq.status !== "declined" && <div className="mt-1 flex gap-2 text-xs">
                <button className="text-brand-700 underline" onClick={() => act({ action: "quote_status", quote_id: qq.id, status: "sent", email: true }, "Quote emailed.")}>Email it</button>
                <button className="text-emerald-700 underline" onClick={() => act({ action: "quote_status", quote_id: qq.id, status: "accepted" }, "Accepted: create the school next.")}>Accepted</button>
                <button className="text-rose-700 underline" onClick={() => act({ action: "quote_status", quote_id: qq.id, status: "declined" }, "Declined.")}>Declined</button>
              </div>}
            </li>))}</ul>
        </section>
      </div>
    </div>
  );
}

function Customers() {
  const [fresh, setFresh] = useState(0);
  const { data, error, reload } = useApi<{ customers: Customer[]; counted_at: string | null }>(`/api/platform/sales?view=customers${fresh ? `&fresh=1&n=${fresh}` : ""}`, [fresh]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const soon = data.customers.filter(c => c.period_end && new Date(c.period_end).getTime() - Date.now() < 60 * 86_400_000 && new Date(c.period_end) > new Date());
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Schools" value={data.customers.length} />
        <Stat label="At risk" value={data.customers.filter(c => c.health.risk === "high").length} tone="bad" />
        <Stat label="Watch" value={data.customers.filter(c => c.health.risk === "medium").length} tone="warn" />
        <Stat label="Renewing in 60 days" value={soon.length} />
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">School</th><th className="p-2">Health</th><th className="p-2">Why</th><th className="p-2">Renews</th><th className="p-2">Onboarding</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{data.customers.map(c => (
            <tr key={c.tenant_id} className="align-top">
              <td className="p-2"><Link href={`/platform/${c.tenant_id}`} className="font-medium">{c.name}</Link><p className="text-xs text-slate-500">{c.plan_name ?? "No plan"} · {c.students} students · {c.staff_signed_in_30}/{c.staff} staff active</p></td>
              <td className="p-2"><Badge tone={RISK[c.health.risk].tone}>{RISK[c.health.risk].label}</Badge><p className="mt-1 text-xs tabular-nums text-slate-600">{c.health.score}/100</p></td>
              <td className="p-2 text-xs text-slate-700">{c.health.reasons.length ? c.health.reasons.join(" · ") : "All good"}</td>
              <td className="p-2 text-xs">{c.period_end ? fmtDate(c.period_end) : "—"}</td>
              <td className="p-2"><div className="flex gap-1">{ONBOARDING.map(s => {
                const on = c.onboarding.includes(s.key);
                return <button key={s.key} title={`${s.label}: ${s.hint}${on ? " (done)" : ""}`} aria-label={`${s.label}${on ? ", done" : ""}`} aria-pressed={on}
                  onClick={async () => { await send("/api/platform/sales", { action: "onboarding", tenant_id: c.tenant_id, step: s.key, done: !on }); reload(); }}
                  className={"h-3 w-6 rounded-full " + (on ? "bg-brand-600" : "bg-slate-200 hover:bg-slate-300")} />;
              })}</div><p className="mt-1 text-[11px] text-slate-500">{c.onboarding.length}/{ONBOARDING.length} steps</p></td>
            </tr>))}</tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Figures counted {data.counted_at ? fmtDate(data.counted_at, true) : "now"} (kept for up to 6 hours). <button className="text-brand-700 underline" onClick={() => setFresh(fresh + 1)}>Count again now</button></p>
      <p className="text-xs text-slate-500">Onboarding steps tick themselves from what the school does (students in, staff signing in, parents signed up, daily use); click to tick or untick by hand.</p>
    </div>
  );
}
