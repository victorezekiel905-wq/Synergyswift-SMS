"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Empty, Modal, Field, Badge, fmtDate, money, rolesOf, type Me } from "@/components/ui";

type Ev = { id: string; title: string; description: string | null; kind: string; starts_at: string; ends_at: string | null; location: string | null; requires_consent: boolean; fee: number; capacity: number | null; yes: number; no: number };

export default function EventsPage() {
  const { data: me } = useApi<Me>("/api/me");
  const admin = ["school_admin", "principal", "platform_admin"].some(r => rolesOf(me).has(r));
  const { data, error, reload } = useApi<Ev[]>("/api/events");
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[] }>("/api/school/structure");
  const { data: settings } = useApi<{ settings: { currency?: string } }>("/api/school/settings");
  const cur = settings?.settings?.currency ?? "NGN";
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const upcoming = (data ?? []).filter(e => new Date(e.starts_at) >= new Date(Date.now() - 86400_000));
  return (
    <Page wide>
      <PageHeader eyebrow="Calendar" title="Events, trips & clubs"
        subtitle="Publish an event and every parent gets it on WhatsApp. Trips can ask for consent and collect the fee online in the same step."
        actions={admin ? <button className="btn btn-primary" onClick={() => setOpen(true)}>+ New event</button> : undefined} />
      {error && <Alert>{error}</Alert>}
      {!upcoming.length ? <Empty>No upcoming events.</Empty> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{upcoming.map(e => (
          <div key={e.id} className="card p-4">
            <div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{e.title}</p><p className="text-sm text-slate-500">{fmtDate(e.starts_at, true)}{e.location ? ` · ${e.location}` : ""}</p></div><Badge tone="violet">{e.kind}</Badge></div>
            {e.description && <p className="mt-2 line-clamp-3 text-sm">{e.description}</p>}
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {e.fee > 0 && <Badge tone="amber">{money(e.fee, cur)}</Badge>}
              {e.requires_consent && <><Badge tone="green">{e.yes} yes</Badge><Badge tone="red">{e.no} no</Badge></>}
              {e.capacity && <Badge>{e.capacity} places</Badge>}
            </div>
            {e.requires_consent && <button className="btn btn-ghost mt-2 px-2 py-1 text-xs" onClick={() => setView(e.id)}>Consent list</button>}
          </div>))}</div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New event" wide>
        <NewEvent groups={structure?.class_groups ?? []} onDone={() => { setOpen(false); reload(); }} />
      </Modal>
      <Modal open={Boolean(view)} onClose={() => setView(null)} title="Responses" wide>{view && <Responses id={view} />}</Modal>
    </Page>
  );
}

function NewEvent({ groups, onDone }: { groups: { id: string; name: string }[]; onDone: () => void }) {
  const [f, setF] = useState({ title: "", description: "", kind: "event", starts: "", ends: "", location: "", classes: [] as string[], requires_consent: false, fee: "", capacity: "", respond_by: "", notify: true });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/events", { action: "create", title: f.title, description: f.description || null, kind: f.kind, starts_at: new Date(f.starts).toISOString(),
        ends_at: f.ends ? new Date(f.ends).toISOString() : null, location: f.location || null, class_group_ids: f.classes, requires_consent: f.requires_consent,
        fee: f.fee ? Number(f.fee) : 0, capacity: f.capacity ? Number(f.capacity) : null, respond_by: f.respond_by ? new Date(f.respond_by).toISOString() : null, notify: f.notify });
      if (!r.ok) return setErr(r.error);
      onDone();
    }}>
      <div className="sm:col-span-2"><Field label="Title"><input className="input" required value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field></div>
      <Field label="Type"><select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{["event", "trip", "club", "meeting", "exam", "holiday"].map(k => <option key={k}>{k}</option>)}</select></Field>
      <Field label="Location"><input className="input" value={f.location} onChange={e => setF({ ...f, location: e.target.value })} /></Field>
      <Field label="Starts"><input className="input" type="datetime-local" required value={f.starts} onChange={e => setF({ ...f, starts: e.target.value })} /></Field>
      <Field label="Ends"><input className="input" type="datetime-local" value={f.ends} onChange={e => setF({ ...f, ends: e.target.value })} /></Field>
      <div className="sm:col-span-2"><Field label="Details"><textarea className="input h-24" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field></div>
      <fieldset className="sm:col-span-2"><legend className="label">For (none = whole school)</legend><div className="flex flex-wrap gap-2">{groups.map(g => (
        <label key={g.id} className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-sm"><input type="checkbox" checked={f.classes.includes(g.id)} onChange={e => setF({ ...f, classes: e.target.checked ? [...f.classes, g.id] : f.classes.filter(x => x !== g.id) })} />{g.name}</label>))}</div></fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requires_consent} onChange={e => setF({ ...f, requires_consent: e.target.checked })} /> Parents must give consent</label>
      <Field label="Cost per student (0 = free)"><input className="input" type="number" min={0} step="any" value={f.fee} onChange={e => setF({ ...f, fee: e.target.value })} /></Field>
      <Field label="Places (optional)"><input className="input" type="number" min={1} value={f.capacity} onChange={e => setF({ ...f, capacity: e.target.value })} /></Field>
      <Field label="Respond by"><input className="input" type="datetime-local" value={f.respond_by} onChange={e => setF({ ...f, respond_by: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.notify} onChange={e => setF({ ...f, notify: e.target.checked })} /> Send to parents now (WhatsApp and email)</label>
      {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
      <div className="flex justify-end sm:col-span-2"><button className="btn btn-primary">Publish event</button></div>
    </form>
  );
}

function Responses({ id }: { id: string }) {
  const { data } = useApi<{ event: Ev; responses: any[] }>(`/api/events?id=${id}`, [id]);
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Student</th><th>Class</th><th>Consent</th><th>Payment</th><th>Note</th></tr></thead>
      <tbody>{data.responses.map((r: any) => <tr key={r.student_id} className="border-t border-slate-100"><td className="py-1.5">{r.students?.first_name} {r.students?.last_name}</td><td>{r.students?.class_groups?.name}</td>
        <td><Badge tone={r.consent ? "green" : "red"}>{r.consent ? "yes" : "no"}</Badge></td><td>{r.fee_invoices ? <Badge tone={r.fee_invoices.status === "paid" ? "green" : "amber"}>{r.fee_invoices.status}</Badge> : "—"}</td><td className="text-xs">{r.note}</td></tr>)}</tbody></table>
  );
}
