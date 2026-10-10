"use client";
import { useEffect, useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field, Loading, Modal, Stat, fmtDate } from "@/components/ui";
import { CATEGORY_LABEL, STATUS_LABEL, TICKET_CATEGORIES, PRIORITIES, type TicketStatus } from "@/lib/community";

type Clock = { state: "met" | "breached" | "running" | "late"; minutes: number };
type Sla = { respond: Clock; resolve: Clock; breached: boolean };
type Row = {
  id: string; ticket_no: string; kind: string; category: keyof typeof CATEGORY_LABEL; priority: string; channel: string; subject: string; status: TicketStatus;
  assigned_to: string | null; created_at: string; escalation_level: number; satisfaction: number | null; sla: Sla;
  guardians: { full_name: string } | null; students: { first_name: string; last_name: string } | null; assignee: { full_name: string } | null;
};
type ListData = {
  items: Row[]; staff: { id: string; full_name: string; role: string }[]; admin: boolean; me: string;
  sla: Record<string, { respond: number; resolve: number }>;
  stats: null | { total: number; open: number; responded_in_time: number; responded: number; resolved_in_time: number; resolved: number; avg_resolve_hours: number | null; satisfaction: number | null; rated: number; by_category: [string, number][] };
};

const PRIORITY_TONE: Record<string, "slate" | "blue" | "amber" | "red"> = { low: "slate", normal: "blue", high: "amber", urgent: "red" };
const dur = (m: number) => m >= 1440 ? `${Math.round(m / 144) / 10}d` : m >= 60 ? `${Math.round(m / 6) / 10}h` : `${m}m`;

export function SlaBadge({ sla, status }: { sla: Sla; status: string }) {
  if (["resolved", "closed"].includes(status)) return sla.resolve.state === "late" ? <Badge tone="amber">resolved late</Badge> : <Badge tone="green">on time</Badge>;
  if (sla.resolve.state === "breached") return <Badge tone="red">overdue {dur(sla.resolve.minutes)}</Badge>;
  if (sla.respond.state === "breached") return <Badge tone="red">no reply {dur(sla.respond.minutes)}</Badge>;
  if (sla.respond.state === "running") return <Badge tone={sla.respond.minutes < 120 ? "amber" : "slate"}>reply in {dur(sla.respond.minutes)}</Badge>;
  return <Badge tone={sla.resolve.minutes < 240 ? "amber" : "slate"}>due in {dur(sla.resolve.minutes)}</Badge>;
}

/** Complaints and requests desk: queue with SLA timers, the conversation, assignment and resolution. */
export default function Tickets({ openId, guardian }: { openId?: string | null; guardian?: { id: string; name: string; children: { id: string; name: string }[] } | null }) {
  const [view, setView] = useState("open");
  const [category, setCategory] = useState("");
  const { data, error, reload } = useApi<ListData>(`/api/community/tickets?view=${view}${category ? `&category=${category}` : ""}`);
  const [open, setOpen] = useState<string | null>(openId ?? null);
  const [creating, setCreating] = useState(Boolean(guardian));
  const [slaOpen, setSlaOpen] = useState(false);
  useEffect(() => { if (openId) setOpen(openId); }, [openId]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const s = data.stats;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  return (
    <div className="space-y-4">
      {s && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Open now" value={s.open} hint={`${s.total} in 90 days`} />
          <Stat label="Replied on time" value={pct(s.responded_in_time, s.responded)} tone={s.responded && s.responded_in_time / s.responded < 0.8 ? "warn" : "good"} />
          <Stat label="Resolved on time" value={pct(s.resolved_in_time, s.resolved)} tone={s.resolved && s.resolved_in_time / s.resolved < 0.8 ? "warn" : "good"} />
          <Stat label="Average time to resolve" value={s.avg_resolve_hours === null ? "—" : `${s.avg_resolve_hours}h`} />
          <Stat label="Family satisfaction" value={s.satisfaction === null ? "—" : `${s.satisfaction}/5`} hint={`${s.rated} rated`} tone={s.satisfaction !== null && s.satisfaction < 3.5 ? "warn" : undefined} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={view} onChange={e => setView(e.target.value)} aria-label="Show">
          <option value="open">Open</option><option value="mine">Assigned to me</option>{data.admin && <option value="unassigned">Unassigned</option>}
          <option value="done">Resolved and closed</option><option value="all">All</option>
        </select>
        <select className="input w-auto" value={category} onChange={e => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>{TICKET_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <span className="flex-1" />
        {data.admin && <button className="btn btn-outline" onClick={() => setSlaOpen(true)}>Response times</button>}
        <button className="btn btn-primary" onClick={() => setCreating(true)}>Log a complaint or request</button>
      </div>
      {!data.items.length ? <Empty>Nothing here. Families raise concerns from the parent portal; you can also log calls and walk-ins.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
              <th className="p-2">Ticket</th><th className="p-2">Family</th><th className="p-2">Category</th><th className="p-2">Priority</th><th className="p-2">Status</th><th className="p-2">Time</th><th className="p-2">Handled by</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">{data.items.map(t => (
              <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(t.id)}>
                <td className="p-2"><span className="font-mono text-xs text-slate-400">{t.ticket_no}</span><br /><span className="font-medium">{t.subject}</span></td>
                <td className="p-2">{t.guardians?.full_name ?? <span className="text-slate-400">—</span>}{t.students && <span className="block text-xs text-slate-500">{t.students.first_name} {t.students.last_name}</span>}</td>
                <td className="p-2">{CATEGORY_LABEL[t.category] ?? t.category}<span className="block text-xs text-slate-500">{t.kind} · {t.channel.replace("_", " ")}</span></td>
                <td className="p-2"><Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge></td>
                <td className="p-2">{STATUS_LABEL[t.status]}{t.satisfaction ? <span className="block text-xs text-slate-500">rated {t.satisfaction}/5</span> : null}</td>
                <td className="p-2"><SlaBadge sla={t.sla} status={t.status} /><span className="block text-xs text-slate-500">{fmtDate(t.created_at, true)}</span></td>
                <td className="p-2">{t.assignee?.full_name ?? <span className="text-amber-700">unassigned</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={Boolean(open)} onClose={() => { setOpen(null); reload(); }} title="Ticket" wide>
        {open && <TicketView id={open} staff={data.staff} onChanged={reload} />}
      </Modal>
      <Modal open={creating} onClose={() => setCreating(false)} title="Log a complaint or request" wide>
        <NewTicket staff={data.staff} admin={data.admin} me={data.me} guardian={guardian ?? null} onDone={id => { setCreating(false); reload(); setOpen(id); }} />
      </Modal>
      <Modal open={slaOpen} onClose={() => setSlaOpen(false)} title="Promised response times">
        <SlaSettings sla={data.sla} onDone={() => { setSlaOpen(false); reload(); }} />
      </Modal>
    </div>
  );
}

type Detail = {
  ticket: Row & { body: string; guardian_id: string | null; respond_due_at: string; resolve_due_at: string; first_response_at: string | null; resolved_at: string | null; satisfaction_note: string | null;
    guardians: { id: string; full_name: string; phone: string | null; email: string | null } | null; creator: { full_name: string } | null };
  messages: { id: string; author: string; body: string; internal: boolean; created_at: string; users: { full_name: string } | null }[];
  can_assign: boolean; me: string;
};

function TicketView({ id, staff, onChanged }: { id: string; staff: ListData["staff"]; onChanged: () => void }) {
  const { data, error, reload } = useApi<Detail>(`/api/community/tickets?id=${id}`);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const t = data.ticket;
  const act = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const r = await send("/api/community/tickets", { id, ...body });
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) { reload(); onChanged(); }
    return r.ok;
  };
  const done = ["resolved", "closed"].includes(t.status);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-slate-400">{t.ticket_no} · {t.kind} · via {t.channel.replace("_", " ")}{t.creator ? ` · logged by ${t.creator.full_name}` : ""}</p>
          <h3 className="text-lg font-semibold">{t.subject}</h3>
          {t.guardians && <p className="text-slate-600">{t.guardians.full_name}{t.guardians.phone ? ` · ${t.guardians.phone}` : ""}{t.guardians.email ? ` · ${t.guardians.email}` : ""}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2"><Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge><SlaBadge sla={t.sla} status={t.status} /><Badge>{STATUS_LABEL[t.status]}</Badge></div>
      </div>
      {t.escalation_level > 0 && !done && <Alert tone="amber">Escalated: {t.escalation_level === 2 ? "not resolved in the promised time" : "no reply in the promised time"}.</Alert>}
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Status">
          <select className="input" value={t.status} disabled={busy} onChange={e => act({ action: "status", status: e.target.value }, "Status updated.")}>
            {(Object.keys(STATUS_LABEL) as TicketStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select className="input" value={t.priority} disabled={busy} onChange={e => act({ action: "update", priority: e.target.value }, "Priority changed.")}>
            {PRIORITIES.map(p => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Handled by">
          <select className="input" value={t.assigned_to ?? ""} disabled={busy || !data.can_assign} onChange={e => act({ action: "assign", assigned_to: e.target.value || null }, "Assigned.")}>
            <option value="">Unassigned</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </Field>
      </div>
      <p className="text-xs text-slate-500">Reply due {fmtDate(t.respond_due_at, true)}{t.first_response_at ? ` (replied ${fmtDate(t.first_response_at, true)})` : ""} · resolve by {fmtDate(t.resolve_due_at, true)}{t.resolved_at ? ` (resolved ${fmtDate(t.resolved_at, true)})` : ""}</p>
      {t.satisfaction && <Alert tone={t.satisfaction >= 4 ? "green" : "amber"}>Family rated the outcome {t.satisfaction}/5{t.satisfaction_note ? `: “${t.satisfaction_note}”` : "."}</Alert>}
      <ol className="space-y-2">
        <li className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{t.guardians?.full_name ?? "Raised"} · {fmtDate(t.created_at, true)}</p><p className="whitespace-pre-wrap">{t.body}</p></li>
        {data.messages.map(m => (
          <li key={m.id} className={"rounded-lg p-3 " + (m.author === "system" ? "text-xs text-slate-500" : m.internal ? "border border-amber-200 bg-amber-50" : m.author === "family" ? "bg-slate-50" : "bg-brand-50")}>
            {m.author !== "system" && <p className="text-xs text-slate-500">{m.author === "family" ? (t.guardians?.full_name ?? "Family") : (m.users?.full_name ?? "Staff")}{m.internal ? " · internal note" : ""} · {fmtDate(m.created_at, true)}</p>}
            <p className="whitespace-pre-wrap">{m.body}{m.author === "system" ? ` · ${fmtDate(m.created_at, true)}` : ""}</p>
          </li>
        ))}
      </ol>
      {t.status !== "closed" && (
        <form className="space-y-2" onSubmit={async e => { e.preventDefault(); if (await act({ action: "reply", body: reply, internal }, internal ? "Note added." : "Reply sent to the family.")) setReply(""); }}>
          <textarea className="input min-h-24" value={reply} onChange={e => setReply(e.target.value)} placeholder={internal ? "Internal note (the family will not see this)" : t.guardian_id ? "Reply to the family" : "Add an update"} required maxLength={5000} />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} /> Internal note</label>
            <span className="flex-1" />
            <button className="btn btn-primary" disabled={busy || !reply.trim()}>{internal ? "Add note" : "Send reply"}</button>
          </div>
        </form>
      )}
      {!done && (
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="mb-1 font-medium">Resolve</p>
          <textarea className="input min-h-16" value={note} onChange={e => setNote(e.target.value)} placeholder="What was done (sent to the family with a request to rate the outcome)" maxLength={2000} />
          <button className="btn btn-success mt-2" disabled={busy} onClick={async () => { if (await act({ action: "status", status: "resolved", note: note.trim() || null }, "Resolved. The family has been asked to rate it.")) setNote(""); }}>Mark resolved</button>
        </div>
      )}
    </div>
  );
}

function NewTicket({ staff, admin, me, guardian, onDone }: { staff: ListData["staff"]; admin: boolean; me: string; guardian: { id: string; name: string; children: { id: string; name: string }[] } | null; onDone: (id: string) => void }) {
  const [f, setF] = useState({ kind: "complaint", category: "other", priority: "normal", channel: "phone", subject: "", body: "", assigned_to: admin ? "" : me, student_id: "", acknowledge: true });
  const [q, setQ] = useState("");
  const [family, setFamily] = useState<{ id: string; name: string; children: { id: string; name: string }[] } | null>(guardian);
  const { data: found } = useApi<{ items: { id: string; full_name: string; phone: string | null; children: { id: string; name: string }[] }[] }>(admin && !guardian && q.trim().length >= 2 ? `/api/community/families?q=${encodeURIComponent(q.trim())}` : null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setF(x => ({ ...x, [k]: v }));
  return (
    <form className="space-y-3 text-sm" onSubmit={async e => {
      e.preventDefault();
      const r = await send<{ id: string }>("/api/community/tickets", { action: "create", ...f, guardian_id: family?.id ?? null, student_id: f.student_id || null, assigned_to: f.assigned_to || null });
      if (r.ok) onDone(r.data.id); else setErr(r.error);
    }}>
      {err && <Alert>{err}</Alert>}
      {admin && !guardian && (
        <Field label="Family" hint="Optional. Search by parent or child name or phone.">
          {family ? <p className="flex items-center gap-2"><b>{family.name}</b><button type="button" className="text-xs text-brand-700" onClick={() => setFamily(null)}>change</button></p> : (
            <>
              <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search families" />
              {(found?.items ?? []).slice(0, 6).map(g => <button type="button" key={g.id} className="mt-1 block text-left text-brand-700 hover:underline" onClick={() => setFamily({ id: g.id, name: g.full_name, children: g.children })}>{g.full_name} <span className="text-xs text-slate-500">{g.children.map(c => c.name).join(", ")}</span></button>)}
            </>
          )}
        </Field>
      )}
      {guardian && <p>Family: <b>{guardian.name}</b></p>}
      {family && family.children.length > 0 && (
        <Field label="About which child?"><select className="input" value={f.student_id} onChange={e => set("student_id", e.target.value)}><option value="">The whole family</option>{family.children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Type"><select className="input" value={f.kind} onChange={e => set("kind", e.target.value)}>{["complaint", "request", "enquiry", "feedback"].map(k => <option key={k}>{k}</option>)}</select></Field>
        <Field label="Category"><select className="input" value={f.category} onChange={e => set("category", e.target.value)}>{TICKET_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></Field>
        <Field label="Priority"><select className="input" value={f.priority} onChange={e => set("priority", e.target.value)}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Received by"><select className="input" value={f.channel} onChange={e => set("channel", e.target.value)}>{[["phone", "Phone"], ["walk_in", "Walk-in"], ["email", "Email"], ["whatsapp", "WhatsApp"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      </div>
      <Field label="Subject"><input className="input" value={f.subject} onChange={e => set("subject", e.target.value)} required minLength={2} maxLength={160} /></Field>
      <Field label="What happened"><textarea className="input min-h-28" value={f.body} onChange={e => set("body", e.target.value)} required maxLength={5000} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Handled by">
          <select className="input" value={f.assigned_to} onChange={e => set("assigned_to", e.target.value)} disabled={!admin}>
            {admin && <option value="">Unassigned (admins are told)</option>}{staff.filter(s => admin || s.id === me).map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </Field>
        {family && <label className="mt-6 flex items-center gap-2"><input type="checkbox" checked={f.acknowledge} onChange={e => set("acknowledge", e.target.checked)} /> Send the family a reference number and tracking link</label>}
      </div>
      <button className="btn btn-primary">Log it</button>
    </form>
  );
}

function SlaSettings({ sla, onDone }: { sla: ListData["sla"]; onDone: () => void }) {
  const [v, setV] = useState(sla);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-3 text-sm" onSubmit={async e => { e.preventDefault(); const r = await send("/api/community/tickets", { action: "sla", sla: v }); if (r.ok) onDone(); else setErr(r.error); }}>
      <p className="text-slate-600">Hours from when a complaint is raised. Overdue tickets are escalated to the principal and admins automatically.</p>
      {err && <Alert>{err}</Alert>}
      <table className="w-full"><thead className="text-left text-xs text-slate-500"><tr><th>Priority</th><th>First reply within</th><th>Resolve within</th></tr></thead>
        <tbody>{PRIORITIES.map(p => (
          <tr key={p}><td className="py-1 capitalize">{p}</td>
            <td><input className="input w-24" type="number" min={1} max={2160} value={v[p].respond} onChange={e => setV({ ...v, [p]: { ...v[p], respond: Number(e.target.value) } })} aria-label={`${p} reply hours`} /> h</td>
            <td><input className="input w-24" type="number" min={1} max={2160} value={v[p].resolve} onChange={e => setV({ ...v, [p]: { ...v[p], resolve: Number(e.target.value) } })} aria-label={`${p} resolve hours`} /> h</td></tr>
        ))}</tbody></table>
      <button className="btn btn-primary">Save</button>
    </form>
  );
}
