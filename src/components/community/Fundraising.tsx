"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Loading, Modal, Field, Badge, Stat, fmtDate, money } from "@/components/ui";

type Campaign = { id: string; title: string; slug: string; purpose: string | null; goal: number | null; starts_on: string | null; ends_on: string | null; status: "draft" | "open" | "closed";
  show_donors: boolean; show_raised: boolean; cover_url: string | null; raised: number; pledged: number; donors: number; public_url: string | null };
type Gift = { id: string; donor_name: string; email: string | null; phone: string | null; amount: number; kind: string; status: string; method: string; anonymous: boolean; message: string | null;
  receipt_no: string | null; pledge_due: string | null; paid_at: string | null; created_at: string };

/** Fundraising (phase 14g-2): appeals, online giving, gifts and pledges recorded at the school, donors. */
export default function Fundraising() {
  const { data, error, reload } = useApi<{ campaigns: Campaign[]; currency: string; has_public_address: boolean }>("/api/fundraising");
  const [edit, setEdit] = useState<Partial<Campaign> | null>(null);
  const [open, setOpen] = useState<Campaign | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const cur = data.currency;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" onClick={() => setEdit({ status: "draft", show_donors: true, show_raised: true })}>+ New appeal</button>
        {!data.has_public_address && <span className="text-xs text-amber-800">Set the school&apos;s web address (Admissions → Setup) to get a public giving page.</span>}
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!data.campaigns.length ? <Empty>No appeals yet. Raise money for a new lab, a bus, scholarships or a building fund: parents, alumni and friends give online or at the school.</Empty> : (
        <div className="grid gap-3 lg:grid-cols-2">{data.campaigns.map(c => {
          const pct = c.goal ? Math.min(100, Math.round((c.raised / c.goal) * 100)) : null;
          return (
            <section key={c.id} className="card p-4">
              <div className="flex items-start justify-between gap-2"><p className="text-base font-semibold">{c.title}</p><Badge tone={c.status === "open" ? "green" : c.status === "draft" ? "slate" : "amber"}>{c.status}</Badge></div>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{money(c.raised, cur)}{c.goal ? <span className="text-sm font-normal text-slate-500"> of {money(c.goal, cur)}</span> : null}</p>
              {pct !== null && <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} /></div>}
              <p className="mt-2 text-xs text-slate-500">{c.donors} donor{c.donors === 1 ? "" : "s"}{c.pledged ? ` · ${money(c.pledged, cur)} pledged, not yet paid` : ""}{c.ends_on ? ` · ends ${fmtDate(c.ends_on)}` : ""}</p>
              {c.public_url && c.status !== "draft" && <p className="mt-1 text-xs">Giving page: <a className="text-brand-700 underline" href={c.public_url} target="_blank" rel="noreferrer">{c.public_url}</a></p>}
              <div className="mt-3 flex gap-1.5">
                <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(c)}>Gifts & donors</button>
                <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(c)}>Edit</button>
              </div>
            </section>
          );
        })}</div>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit appeal" : "New appeal"}>
        {edit && <CampaignForm c={edit} onDone={text => { setEdit(null); setMsg({ ok: true, text }); reload(); }} />}
      </Modal>
      <Modal open={Boolean(open)} onClose={() => { setOpen(null); reload(); }} title={open ? open.title : ""} wide>
        {open && <Gifts c={open} currency={cur} />}
      </Modal>
    </div>
  );
}

function CampaignForm({ c, onDone }: { c: Partial<Campaign>; onDone: (text: string) => void }) {
  const [f, setF] = useState(c);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Field label="Title"><input className="input" value={f.title ?? ""} onChange={e => setF({ ...f, title: e.target.value })} placeholder="New science laboratory" /></Field>
      <Field label="What it is for"><textarea className="input" rows={4} value={f.purpose ?? ""} onChange={e => setF({ ...f, purpose: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Goal (optional)"><input className="input" type="number" min={1} value={f.goal ?? ""} onChange={e => setF({ ...f, goal: e.target.value ? Number(e.target.value) : null })} /></Field>
        <Field label="Starts"><input className="input" type="date" value={f.starts_on ?? ""} onChange={e => setF({ ...f, starts_on: e.target.value || null })} /></Field>
        <Field label="Ends"><input className="input" type="date" value={f.ends_on ?? ""} onChange={e => setF({ ...f, ends_on: e.target.value || null })} /></Field>
      </div>
      <Field label="Status"><select className="input" value={f.status} onChange={e => setF({ ...f, status: e.target.value as Campaign["status"] })}>
        <option value="draft">Draft (not public)</option><option value="open">Open for giving</option><option value="closed">Closed</option></select></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.show_raised !== false} onChange={e => setF({ ...f, show_raised: e.target.checked })} />Show the amount raised on the giving page</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.show_donors !== false} onChange={e => setF({ ...f, show_donors: e.target.checked })} />Show donors&apos; names (never those who give anonymously)</label>
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end"><button className="btn btn-primary" onClick={async () => {
        const r = await send("/api/fundraising", { action: "save_campaign", id: f.id ?? null, title: f.title ?? "", purpose: f.purpose || null, goal: f.goal ?? null, starts_on: f.starts_on ?? null,
          ends_on: f.ends_on ?? null, status: f.status ?? "draft", show_donors: f.show_donors !== false, show_raised: f.show_raised !== false, cover_url: f.cover_url || null });
        if (!r.ok) return setErr(r.error ?? "failed");
        onDone("Appeal saved.");
      }}>Save</button></div>
    </div>
  );
}

function Gifts({ c, currency }: { c: Campaign; currency: string }) {
  const { data, reload } = useApi<{ gifts?: Gift[] }>(`/api/fundraising?campaign=${c.id}`, [c.id]);
  const [g, setG] = useState({ donor_name: "", email: "", phone: "", amount: "", kind: "gift", method: "transfer", anonymous: false, pledge_due: "" });
  const [err, setErr] = useState<string | null>(null);
  const gifts = data?.gifts ?? [];
  const act = async (body: Record<string, unknown>) => { setErr(null); const r = await send("/api/fundraising", body); if (!r.ok) setErr(r.error ?? "failed"); else reload(); return r.ok; };
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-3 gap-3"><Stat label="Raised" value={money(c.raised, currency)} /><Stat label="Pledged" value={money(c.pledged, currency)} /><Stat label="Donors" value={c.donors} /></div>
      <section className="card p-3">
        <h3 className="font-semibold">Record a gift or pledge made at the school</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <input className="input" placeholder="Donor" value={g.donor_name} onChange={e => setG({ ...g, donor_name: e.target.value })} />
          <input className="input" placeholder="Email (for the thank-you)" value={g.email} onChange={e => setG({ ...g, email: e.target.value })} />
          <input className="input" placeholder="Phone" value={g.phone} onChange={e => setG({ ...g, phone: e.target.value })} />
          <input className="input" type="number" min={1} placeholder="Amount" value={g.amount} onChange={e => setG({ ...g, amount: e.target.value })} />
          <select className="input" value={g.kind} onChange={e => setG({ ...g, kind: e.target.value })}><option value="gift">Gift (paid)</option><option value="pledge">Pledge (to pay later)</option></select>
          <select className="input" value={g.method} onChange={e => setG({ ...g, method: e.target.value })}>{["transfer", "cash", "cheque", "pos"].map(m => <option key={m} value={m}>{m === "pos" ? "POS" : m[0]!.toUpperCase() + m.slice(1)}</option>)}</select>
          {g.kind === "pledge" && <input className="input" type="date" value={g.pledge_due} onChange={e => setG({ ...g, pledge_due: e.target.value })} aria-label="Pledge due" />}
          <label className="flex items-center gap-2"><input type="checkbox" checked={g.anonymous} onChange={e => setG({ ...g, anonymous: e.target.checked })} />Anonymous</label>
        </div>
        <button className="btn btn-primary mt-2" disabled={!g.donor_name.trim() || !(Number(g.amount) > 0)} onClick={async () => {
          if (await act({ action: "record", campaign_id: c.id, donor_name: g.donor_name, email: g.email || null, phone: g.phone || null, amount: Number(g.amount), kind: g.kind, method: g.method,
            anonymous: g.anonymous, pledge_due: g.pledge_due || null })) setG({ donor_name: "", email: "", phone: "", amount: "", kind: "gift", method: "transfer", anonymous: false, pledge_due: "" });
        }}>Record</button>
        {err && <div className="mt-2"><Alert>{err}</Alert></div>}
      </section>
      {!gifts.length ? <Empty>No gifts yet.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full">
          <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Donor</th><th className="p-2 text-right">Amount</th><th className="p-2">How</th><th className="p-2">Status</th><th className="p-2">Receipt</th><th className="p-2" /></tr></thead>
          <tbody className="divide-y divide-slate-100">{gifts.map(x => (
            <tr key={x.id}><td className="p-2">{x.donor_name}{x.anonymous && <span className="ml-1 text-xs text-slate-500">(anonymous)</span>}{x.message && <p className="text-xs text-slate-500">“{x.message}”</p>}</td>
              <td className="p-2 text-right tabular-nums">{money(x.amount, currency)}</td><td className="p-2">{x.method}</td>
              <td className="p-2"><Badge tone={x.status === "paid" ? "green" : x.status === "pledged" ? "amber" : "slate"}>{x.status}</Badge>{x.pledge_due && x.status === "pledged" ? <p className="text-xs text-slate-500">due {fmtDate(x.pledge_due)}</p> : null}</td>
              <td className="p-2 text-xs">{x.receipt_no ?? "—"}</td>
              <td className="p-2 text-right whitespace-nowrap">{x.status === "pledged" && <>
                <button className="text-xs text-emerald-700 underline" onClick={() => act({ action: "mark_paid", id: x.id, method: "transfer" })}>Paid</button>{" "}
                <button className="text-xs text-rose-700 underline" onClick={() => act({ action: "cancel", id: x.id })}>Cancel</button></>}</td></tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}
