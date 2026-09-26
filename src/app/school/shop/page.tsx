"use client";
import { useRef, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Empty, Field, Tabs, Stat, money, fmtTime, fmtDate } from "@/components/ui";

type Item = { id: string; name: string; price: number; category: string | null; active: boolean };
type Overview = { currency: string; can_credit: boolean; items: Item[];
  today: { takings: number; sales: number; topups: number; recent: { id: string; kind: string; amount: number; description: string | null; at: string; student: string }[] } };
type Tx = { id: string; kind: string; amount: number; balance_after: number | null; description: string | null; status: string; created_at: string };
type Card = { currency: string; allergies: string | null;
  student: { id: string; name: string; admission_no: string; photo_url: string | null; class_name: string | null };
  wallet: { balance: number; daily_limit: number | null; low_balance_alert: number | null; frozen: boolean; spent_today: number; has_wallet: boolean; transactions: Tx[] } };
type Tab = "till" | "items" | "wallets";

export default function ShopPage() {
  const ov = useApi<Overview>("/api/wallet");
  const [tab, setTab] = useState<Tab>("till");
  const cur = ov.data?.currency ?? "NGN";
  return (
    <Page wide>
      <PageHeader eyebrow="Cashless" title="Tuck shop & wallets"
        subtitle="Pupils pay with their ID card, so no cash changes hands. Parents top up online, set a daily limit and see every purchase." />
      {ov.error && <Alert>{ov.error}</Alert>}
      {ov.data && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <Stat label="Sales today" value={ov.data.today.sales} />
          <Stat label="Takings today" value={money(ov.data.today.takings, cur)} />
          <Stat label="Top-ups today" value={money(ov.data.today.topups, cur)} />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "till", label: "Till" }, { id: "items", label: "Items & prices" }, ...(ov.data?.can_credit ? [{ id: "wallets" as const, label: "Wallets" }] : [])]} />
      {tab === "till" && ov.data && <Till ov={ov.data} reload={ov.reload} />}
      {tab === "items" && ov.data && <Items items={ov.data.items} currency={cur} reload={ov.reload} />}
      {tab === "wallets" && ov.data && <Wallets currency={cur} />}
    </Page>
  );
}

function StudentCard({ c }: { c: Card }) {
  const cur = c.currency, w = c.wallet;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {c.student.photo_url ? <img src={c.student.photo_url} alt="" className="h-16 w-16 rounded-lg object-cover" /> : <div className="grid h-16 w-16 place-items-center rounded-lg bg-slate-100 text-xl font-bold text-slate-400">{c.student.name[0]}</div>}
        <div className="mr-auto">
          <p className="font-semibold">{c.student.name}</p>
          <p className="text-xs text-slate-500">{c.student.admission_no} · {c.student.class_name ?? "No class"}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums">{money(w.balance, cur)}</p>
          <p className="text-xs text-slate-500">spent today {money(w.spent_today, cur)}{w.daily_limit != null ? ` of ${money(w.daily_limit, cur)}` : ""}</p>
        </div>
      </div>
      {c.allergies && <div role="alert" className="rounded-lg border-2 border-rose-400 bg-rose-50 p-2 text-sm font-semibold text-rose-800">⚠ Allergies: {c.allergies}</div>}
      {w.frozen && <Alert>This wallet is frozen. Do not sell.</Alert>}
      {!w.has_wallet && <Alert tone="amber">No money in this wallet yet.</Alert>}
    </div>
  );
}

function Till({ ov, reload }: { ov: Overview; reload: () => void }) {
  const [scan, setScan] = useState("");
  const [card, setCard] = useState<Card | null>(null);
  const [basket, setBasket] = useState<Record<string, number>>({});
  const [custom, setCustom] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const cur = ov.currency;
  const active = ov.items.filter(i => i.active);
  const total = Object.entries(basket).reduce((a, [id, q]) => a + q * Number(active.find(i => i.id === id)?.price ?? 0), 0) || Number(custom || 0);
  const cats = [...new Set(active.map(i => i.category ?? "Other"))];

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    if (!scan.trim()) return;
    setMsg(null);
    const r = await fetch(`/api/wallet?scan=${encodeURIComponent(scan.trim())}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setCard(null); setMsg({ ok: false, text: j.error ?? "not found" }); }
    else { setCard(j); setBasket({}); setCustom(""); }
    setScan("");
  }
  async function charge() {
    if (!card) return;
    setBusy(true);
    const items = Object.entries(basket).filter(([, q]) => q > 0).map(([id, qty]) => ({ id, qty }));
    const r = await send<{ total: number; balance: number }>("/api/wallet", { action: "charge", student_id: card.student.id, items, amount: items.length ? null : Number(custom) || null });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "failed" }); return; }
    setMsg({ ok: true, text: `Charged ${money(r.data.total, cur)} to ${card.student.name}. New balance ${money(r.data.balance, cur)}.` });
    setCard(null); setBasket({}); setCustom(""); reload();
    scanRef.current?.focus();
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr,24rem]">
      <div className="space-y-4">
        <form onSubmit={lookup} className="card flex gap-2 p-4">
          <input ref={scanRef} className="input flex-1" autoFocus value={scan} onChange={e => setScan(e.target.value)} placeholder="Scan the ID card or type the admission number" aria-label="Card or admission number" />
          <button className="btn btn-primary">Find</button>
        </form>
        {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
        {card && <div className="card p-4"><StudentCard c={card} /></div>}
        {card && !card.wallet.frozen && (
          <div className="card p-4">
            {!active.length ? <p className="text-sm text-slate-500">No items yet. Add them under Items & prices, or enter an amount.</p> : cats.map(cat => (
              <div key={cat} className="mb-3">
                <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{cat}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{active.filter(i => (i.category ?? "Other") === cat).map(i => (
                  <button key={i.id} className="rounded-lg border border-slate-200 p-2 text-left text-sm hover:border-brand-400" onClick={() => { setCustom(""); setBasket(b => ({ ...b, [i.id]: (b[i.id] ?? 0) + 1 })); }}>
                    <b className="block truncate">{i.name}</b><span className="text-xs text-slate-500">{money(i.price, cur)}</span>{basket[i.id] ? <Badge tone="blue">×{basket[i.id]}</Badge> : null}
                  </button>))}</div>
              </div>))}
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="Or enter an amount"><input className="input w-36" type="number" min="0" step="0.01" value={custom} onChange={e => { setBasket({}); setCustom(e.target.value); }} /></Field>
              <button className="btn btn-ghost" onClick={() => { setBasket({}); setCustom(""); }}>Clear</button>
              <button className="btn btn-primary ml-auto text-base" disabled={busy || !(total > 0)} onClick={charge}>Charge {money(total, cur)}</button>
            </div>
          </div>
        )}
      </div>
      <section className="card h-fit p-4">
        <h2 className="mb-2 font-semibold">Today</h2>
        {!ov.today.recent.length ? <Empty>No sales yet today.</Empty> : (
          <ul className="divide-y divide-slate-100 text-sm">{ov.today.recent.map(s => (
            <li key={s.id} className="flex justify-between gap-2 py-1.5"><span className="truncate">{s.student}<span className="block truncate text-xs text-slate-500">{s.description} · {fmtTime(s.at)}</span></span>
              <b className={`tabular-nums ${s.amount < 0 ? "" : "text-emerald-700"}`}>{money(s.amount, ov.currency)}</b></li>))}</ul>
        )}
      </section>
    </div>
  );
}

function Items({ items, currency, reload }: { items: Item[]; currency: string; reload: () => void }) {
  const blank = { id: "", name: "", price: "", category: "", active: true };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr,20rem]">
      <section className="card p-4">
        {!items.length ? <Empty>No items yet.</Empty> : (
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th>Item</th><th>Category</th><th className="text-right">Price</th><th /></tr></thead>
            <tbody>{items.map(i => <tr key={i.id} className={`border-t border-slate-100 ${i.active ? "" : "opacity-50"}`}><td className="py-1.5">{i.name}</td><td>{i.category}</td>
              <td className="text-right tabular-nums">{money(i.price, currency)}</td>
              <td className="text-right"><button className="text-xs text-brand-700" onClick={() => setF({ id: i.id, name: i.name, price: String(i.price), category: i.category ?? "", active: i.active })}>Edit</button></td></tr>)}</tbody></table>
        )}
      </section>
      <form className="card h-fit space-y-2 p-4" onSubmit={async e => {
        e.preventDefault();
        const r = await send("/api/wallet", { action: "save_item", id: f.id || undefined, name: f.name, price: Number(f.price), category: f.category || null, active: f.active });
        if (!r.ok) return setErr(r.error);
        setErr(null); setF(blank); reload();
      }}>
        <h2 className="font-semibold">{f.id ? "Edit item" : "Add an item"}</h2>
        <Field label="Name"><input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Price"><input className="input" type="number" min="0" step="0.01" required value={f.price} onChange={e => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="Category"><input className="input" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} placeholder="Snacks, Drinks…" /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> For sale</label>
        {err && <Alert>{err}</Alert>}
        <div className="flex gap-2"><button className="btn btn-primary flex-1">Save</button>{f.id && <button type="button" className="btn btn-ghost" onClick={() => setF(blank)}>Cancel</button>}</div>
      </form>
    </div>
  );
}

function Wallets({ currency }: { currency: string }) {
  const [q, setQ] = useState("");
  const hits = useApi<{ id: string; first_name: string; last_name: string; admission_no: string }[]>(q.trim().length >= 2 ? `/api/sims/students?limit=10&q=${encodeURIComponent(q.trim())}` : null, [q]);
  const [sid, setSid] = useState<string | null>(null);
  const card = useApi<Card>(sid ? `/api/wallet?student=${sid}` : null, [sid]);
  const [credit, setCredit] = useState({ amount: "", method: "cash", kind: "topup", reference: "", note: "" });
  const [limits, setLimits] = useState<{ daily: string; low: string; frozen: boolean } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const w = card.data?.wallet;
  const lim = limits ?? (w ? { daily: w.daily_limit?.toString() ?? "", low: w.low_balance_alert?.toString() ?? "", frozen: w.frozen } : null);
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem,1fr]">
      <section className="card h-fit p-4">
        <Field label="Find a student"><input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Name or admission number" /></Field>
        <ul className="mt-2 text-sm">{(hits.data ?? []).map(s => <li key={s.id}><button className={`w-full rounded px-2 py-1 text-left hover:bg-slate-100 ${sid === s.id ? "bg-brand-50" : ""}`} onClick={() => { setSid(s.id); setLimits(null); setMsg(null); }}>{s.first_name} {s.last_name} <span className="text-xs text-slate-500">{s.admission_no}</span></button></li>)}</ul>
      </section>
      {card.data && w && lim && (
        <div className="space-y-4">
          <div className="card p-4"><StudentCard c={card.data} /></div>
          {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
          <div className="grid gap-4 md:grid-cols-2">
            <form className="card space-y-2 p-4" onSubmit={async e => {
              e.preventDefault();
              const r = await send("/api/wallet", { action: "credit", student_id: sid, amount: Number(credit.amount), method: credit.method, kind: credit.kind, reference: credit.reference || null, note: credit.note || null });
              setMsg({ ok: r.ok, text: r.ok ? "Recorded. The parents have been told." : r.error ?? "failed" });
              if (r.ok) { setCredit({ ...credit, amount: "", reference: "", note: "" }); card.reload(); }
            }}>
              <h3 className="font-semibold">Add money</h3>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Amount"><input className="input" type="number" min="0.01" step="0.01" required value={credit.amount} onChange={e => setCredit({ ...credit, amount: e.target.value })} /></Field>
                <Field label="Type"><select className="input" value={credit.kind} onChange={e => setCredit({ ...credit, kind: e.target.value })}><option value="topup">Top-up</option><option value="refund">Refund</option></select></Field>
                <Field label="Paid by"><select className="input" value={credit.method} onChange={e => setCredit({ ...credit, method: e.target.value })}><option value="cash">Cash</option><option value="transfer">Transfer</option><option value="pos">POS</option></select></Field>
                <Field label="Reference"><input className="input" value={credit.reference} onChange={e => setCredit({ ...credit, reference: e.target.value })} placeholder="Optional" /></Field>
              </div>
              <Field label="Note"><input className="input" value={credit.note} onChange={e => setCredit({ ...credit, note: e.target.value })} /></Field>
              <button className="btn btn-primary w-full">Record</button>
            </form>
            <form className="card space-y-2 p-4" onSubmit={async e => {
              e.preventDefault();
              const r = await send("/api/wallet", { action: "settings", student_id: sid, daily_limit: lim.daily === "" ? null : Number(lim.daily), low_balance_alert: lim.low === "" ? null : Number(lim.low), frozen: lim.frozen });
              setMsg({ ok: r.ok, text: r.ok ? "Settings saved." : r.error ?? "failed" });
              if (r.ok) { setLimits(null); card.reload(); }
            }}>
              <h3 className="font-semibold">Limits</h3>
              <Field label="Daily spending limit" hint="Empty = no limit. Parents can also set this."><input className="input" type="number" min="0" value={lim.daily} onChange={e => setLimits({ ...lim, daily: e.target.value })} /></Field>
              <Field label="Tell parents when the balance falls below"><input className="input" type="number" min="0" value={lim.low} onChange={e => setLimits({ ...lim, low: e.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={lim.frozen} onChange={e => setLimits({ ...lim, frozen: e.target.checked })} /> Freeze (lost card)</label>
              <button className="btn btn-primary w-full">Save</button>
            </form>
          </div>
          <section className="card p-4">
            <h3 className="mb-2 font-semibold">History</h3>
            {!w.transactions.length ? <Empty>No transactions.</Empty> : (
              <table className="w-full text-sm"><tbody>{w.transactions.map(t => <tr key={t.id} className="border-t border-slate-100">
                <td className="py-1.5">{fmtDate(t.created_at)} {fmtTime(t.created_at)}</td><td>{t.description}{t.status === "pending" ? " (pending)" : ""}</td>
                <td className={`text-right tabular-nums ${Number(t.amount) > 0 ? "text-emerald-700" : ""}`}>{money(t.amount, currency)}</td>
                <td className="text-right tabular-nums text-slate-500">{t.balance_after != null ? money(t.balance_after, currency) : ""}</td></tr>)}</tbody></table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
