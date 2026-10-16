"use client";
import { useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field, Loading, Modal, fmtDate, money } from "@/components/ui";

type Partner = { id: string; name: string; kind: string; category: string | null; status: string; contact_name: string | null; email: string | null; phone: string | null; website: string | null; address: string | null;
  contract_start: string | null; contract_end: string | null; contract_value: number | null; rating: number | null; tags: string[]; notes: string | null; renewal?: "due" | "expired" | null };
const KINDS = ["vendor", "supplier", "partner", "sponsor", "ngo", "government", "media", "other"];

/** Vendors, suppliers, sponsors and partner organisations with contracts, ratings, contacts and spend. */
export default function Partners() {
  const { data, error, reload } = useApi<{ items: Partner[]; currency: string }>("/api/community/partners");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Partner> | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const ql = q.trim().toLowerCase();
  const items = data.items.filter(p => (!kind || p.kind === kind) && (!ql || [p.name, p.category, p.contact_name, ...p.tags].some(x => (x ?? "").toLowerCase().includes(ql))));
  const renewals = data.items.filter(p => p.renewal && p.status === "active");
  return (
    <div className="space-y-4 text-sm">
      {renewals.length > 0 && <Alert tone="amber">Contracts to review: {renewals.map(p => `${p.name} (${p.renewal === "expired" ? "ended" : "ends"} ${fmtDate(p.contract_end)})`).join(" · ")}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, category, contact, tag" aria-label="Search partners" />
        <select className="input w-auto" value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind"><option value="">All kinds</option>{KINDS.map(k => <option key={k}>{k}</option>)}</select>
        <span className="flex-1" />
        <button className="btn btn-primary" onClick={() => setEdit({ kind: "vendor", status: "active", tags: [] })}>Add</button>
      </div>
      {!items.length ? <Empty>No partners or vendors yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full"><thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Name</th><th className="p-2">Kind</th><th className="p-2">Contact</th><th className="p-2">Contract</th><th className="p-2">Rating</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{items.map(p => (
              <tr key={p.id} className={"cursor-pointer hover:bg-slate-50 " + (p.status === "inactive" ? "text-slate-400" : "")} onClick={() => setOpen(p.id)}>
                <td className="p-2 font-medium">{p.name}{p.status === "prospect" && <> <Badge tone="violet">prospect</Badge></>}<span className="block text-xs font-normal text-slate-500">{p.tags.join(", ")}</span></td>
                <td className="p-2 capitalize">{p.kind}<span className="block text-xs text-slate-500">{p.category ?? ""}</span></td>
                <td className="p-2">{p.contact_name ?? "—"}<span className="block text-xs text-slate-500">{p.phone ?? p.email ?? ""}</span></td>
                <td className="p-2 text-xs">{p.contract_end ? <>to {fmtDate(p.contract_end)} {p.renewal && <Badge tone={p.renewal === "expired" ? "red" : "amber"}>{p.renewal === "expired" ? "ended" : "renew soon"}</Badge>}</> : "—"}{p.contract_value ? <span className="block">{money(p.contract_value, data.currency)}</span> : null}</td>
                <td className="p-2">{p.rating ? "★".repeat(p.rating) : "—"}</td>
              </tr>
            ))}</tbody></table>
        </div>
      )}
      <Modal open={Boolean(open)} onClose={() => { setOpen(null); reload(); }} title="Partner" wide>
        {open && <PartnerView id={open} currency={data.currency} onEdit={p => { setOpen(null); setEdit(p); }} onDeleted={() => { setOpen(null); reload(); }} />}
      </Modal>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit" : "Add partner or vendor"} wide>
        {edit && <PartnerForm p={edit} onDone={() => { setEdit(null); reload(); }} />}
      </Modal>
    </div>
  );
}

function PartnerView({ id, currency, onEdit, onDeleted }: { id: string; currency: string; onEdit: (p: Partner) => void; onDeleted: () => void }) {
  const { data, reload } = useApi<{ partner: Partner; log: { id: string; kind: string; body: string; occurred_at: string; follow_up_at: string | null; users: { full_name: string } | null }[]; spend: { id: string; description: string; amount: number; spent_on: string }[]; spend_total: number }>(`/api/community/partners?id=${id}`);
  const [log, setLog] = useState({ kind: "call", body: "" });
  if (!data) return <Loading />;
  const p = data.partner;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <div><h3 className="text-lg font-semibold">{p.name}</h3>
          <p className="text-slate-600 capitalize">{p.kind}{p.category ? ` · ${p.category}` : ""} · {p.status}</p>
          <p className="text-slate-600">{[p.contact_name, p.phone, p.email].filter(Boolean).join(" · ")}{p.website && <> · <a className="text-brand-700" href={p.website} target="_blank" rel="noreferrer">website</a></>}</p>
          {p.address && <p className="text-xs text-slate-500">{p.address}</p>}
          {(p.contract_start || p.contract_end) && <p className="text-xs">Contract {fmtDate(p.contract_start)} – {fmtDate(p.contract_end)}{p.contract_value ? ` · ${money(p.contract_value, currency)}` : ""}</p>}
          {p.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{p.notes}</p>}</div>
        <div className="flex gap-2"><button className="btn btn-outline" onClick={() => onEdit(p)}>Edit</button>
          <button className="btn btn-outline text-rose-700" onClick={async () => { if (!confirm(`Delete ${p.name}?`)) return; const r = await send("/api/community/partners", { action: "delete", id }); if (r.ok) onDeleted(); else alert(r.error); }}>Delete</button></div>
      </div>
      <section><h4 className="font-semibold">Spend <span className="font-normal text-slate-500">{money(data.spend_total, currency)}</span></h4>
        {!data.spend.length ? <p className="text-xs text-slate-500">No expenses recorded with this payee name.</p> : <ul className="max-h-40 overflow-y-auto text-xs">{data.spend.map(s => <li key={s.id} className="flex justify-between"><span>{fmtDate(s.spent_on)} · {s.description}</span><span>{money(s.amount, currency)}</span></li>)}</ul>}</section>
      <form className="flex flex-wrap gap-2" onSubmit={async e => { e.preventDefault(); const r = await send("/api/community/partners", { action: "log", id, ...log }); if (r.ok) { setLog({ ...log, body: "" }); reload(); } }}>
        <select className="input w-auto" value={log.kind} onChange={e => setLog({ ...log, kind: e.target.value })} aria-label="Kind">{["call", "meeting", "email", "visit", "note", "other"].map(k => <option key={k}>{k}</option>)}</select>
        <input className="input flex-1" value={log.body} onChange={e => setLog({ ...log, body: e.target.value })} placeholder="e.g. Negotiated 10% off uniforms for next term" required maxLength={4000} />
        <button className="btn btn-primary">Log</button>
      </form>
      <ul className="space-y-1">{data.log.map(l => <li key={l.id}><b className="capitalize">{l.kind}</b> {l.body} <span className="text-xs text-slate-400">{l.users?.full_name ?? ""} · {fmtDate(l.occurred_at, true)}</span></li>)}</ul>
    </div>
  );
}

function PartnerForm({ p, onDone }: { p: Partial<Partner>; onDone: () => void }) {
  const [f, setF] = useState<Partial<Partner>>(p);
  const [tags, setTags] = useState((p.tags ?? []).join(", "));
  const [err, setErr] = useState<string | null>(null);
  const txt = (k: keyof Partner, label: string, type = "text") => <Field label={label}><input className="input" type={type} value={(f[k] as string | number | null | undefined) ?? ""} onChange={e => setF({ ...f, [k]: type === "number" ? (e.target.value ? Number(e.target.value) : null) : e.target.value })} /></Field>;
  return (
    <form className="space-y-3 text-sm" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/community/partners", { action: "save", id: f.id || null, name: f.name, kind: f.kind, category: f.category || null, status: f.status, contact_name: f.contact_name || null,
        email: f.email || "", phone: f.phone || null, website: f.website || "", address: f.address || null, contract_start: f.contract_start || "", contract_end: f.contract_end || "",
        contract_value: f.contract_value ?? null, rating: f.rating ?? null, tags: tags.split(",").map(t => t.trim()).filter(Boolean), notes: f.notes || null });
      if (r.ok) onDone(); else setErr(r.error);
    }}>
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        {txt("name", "Name")}
        <Field label="Kind"><select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{KINDS.map(k => <option key={k}>{k}</option>)}</select></Field>
        <Field label="Status"><select className="input" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{["prospect", "active", "inactive"].map(k => <option key={k}>{k}</option>)}</select></Field>
        {txt("category", "Category (e.g. uniforms)")}{txt("contact_name", "Contact person")}{txt("phone", "Phone")}
        {txt("email", "Email", "email")}{txt("website", "Website", "url")}{txt("address", "Address")}
        {txt("contract_start", "Contract start", "date")}{txt("contract_end", "Contract end", "date")}{txt("contract_value", "Contract value", "number")}
        <Field label="Rating"><select className="input" value={f.rating ?? ""} onChange={e => setF({ ...f, rating: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{"★".repeat(n)}</option>)}</select></Field>
        <Field label="Tags" hint="Separated by commas."><input className="input" value={tags} onChange={e => setTags(e.target.value)} /></Field>
      </div>
      <Field label="Notes"><textarea className="input min-h-16" value={f.notes ?? ""} onChange={e => setF({ ...f, notes: e.target.value })} maxLength={4000} /></Field>
      <button className="btn btn-primary">Save</button>
    </form>
  );
}
