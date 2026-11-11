"use client";
import { useEffect, useRef, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Empty, Field, Tabs, Stat, money, fmtTime, fmtDate } from "@/components/ui";
import { byCategory, receipt, pauseSale, MAX_PAUSED, formatBuyCode, cleanBuyCode, type PausedSale } from "@/lib/tuck-shop";

type Item = { id: string; name: string; price: number; category: string | null; active: boolean; stock: number | null; stock_alert: number | null; barcode?: string | null };
type Settings = { shop_purchases_per_day?: number; shop_gap_minutes?: number; shop_code_windows?: string; shop_selling_windows?: string; shop_daily_cap?: number | null; shop_require_code?: boolean;
  shop_notify_each_purchase?: boolean; shop_parent_topup?: boolean };
type Overview = { currency: string; timezone?: string; items: Item[]; devices: { id: string; name: string; location: string | null; last_seen_at: string | null }[];
  settings: Settings; selling_open?: boolean; can_settings: boolean; can_credit: boolean; today: { sales: number; takings: number } };
type Child = { id: string; name: string; photo_url: string | null; class_name: string | null };
type Sale = { total: number; reference: string; lines: { name: string; qty: number; price: number }[]; exhausted: boolean; left_today: number;
  student: { id: string; name: string; photo_url: string | null; admission_no: string | null; class_name: string | null } };
type Tab = "sale" | "stock" | "activity" | "wallets" | "settings";

export default function ShopPage() {
  const ov = useApi<Overview>("/api/shop");
  const [tab, setTab] = useState<Tab>("sale");
  const cur = ov.data?.currency ?? "NGN";
  return (
    <Page wide>
      <PageHeader eyebrow="Cashless" title="Tuck shop & wallets"
        subtitle="Tick what the student is buying, then take their one-time buy code or fingerprint: the money leaves their wallet at once and the family is told. Students and parents make codes within the school's rules." />
      {ov.error && <Alert>{ov.error}</Alert>}
      {ov.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 print:hidden">
          <Stat label="Sales today" value={ov.data.today.sales} />
          <Stat label="Takings today" value={money(ov.data.today.takings, cur)} />
          <Stat label="Low on stock" value={ov.data.items.filter(i => i.stock !== null && i.stock_alert !== null && i.stock <= i.stock_alert).length} />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "sale", label: "Quick sale" }, { id: "stock", label: "Stock & prices" }, { id: "activity", label: "Activity" },
        ...(ov.data?.can_credit ? [{ id: "wallets" as const, label: "Wallets" }] : []), ...(ov.data?.can_settings ? [{ id: "settings" as const, label: "Rules" }] : [])]} />
      {tab === "sale" && ov.data && <QuickSale ov={ov.data} reload={ov.reload} />}
      {tab === "stock" && <Stock currency={cur} reload={ov.reload} />}
      {tab === "activity" && <Activity currency={cur} showBalance={Boolean(ov.data?.can_credit)} />}
      {tab === "wallets" && ov.data && <Wallets currency={cur} />}
      {tab === "settings" && ov.data && <Rules s={ov.data.settings} reload={ov.reload} />}
    </Page>
  );
}

const PAUSE_KEY = "ss-shop-paused";
const loadPaused = (): PausedSale[] => { try { return JSON.parse(localStorage.getItem(PAUSE_KEY) ?? "[]"); } catch { return []; } };
const savePaused = (p: PausedSale[]) => { try { localStorage.setItem(PAUSE_KEY, JSON.stringify(p)); } catch { /* storage off: kept for this page */ } };

function QuickSale({ ov, reload }: { ov: Overview; reload: () => void }) {
  const cur = ov.currency;
  const [basket, setBasket] = useState<Record<string, number>>({});
  const [paused, setPaused] = useState<PausedSale[]>([]);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Sale | null>(null);
  const [finger, setFinger] = useState<{ device: string; since: string } | null>(null);
  const [device, setDevice] = useState(ov.devices[0]?.id ?? "");
  // The child the code (or finger) belongs to, shown before paying: name, photo, class. Never the balance.
  const [child, setChild] = useState<{ who: Child; pay: Record<string, unknown> } | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const lookedUp = useRef("");
  useEffect(() => { setPaused(loadPaused()); }, []);
  const groups = byCategory(ov.items);
  const r = receipt(basket, ov.items);
  const add = (id: string, d: number) => { setDone(null); setMsg(null); setBasket(b => { const n = Math.max(0, (b[id] ?? 0) + d); const c = { ...b }; if (n) c[id] = n; else delete c[id]; return c; }); };

  async function pay(body: Record<string, unknown>) {
    if (!r.lines.length) { setMsg({ ok: false, text: "Tick what the student is buying first." }); return; }
    setBusy(true); setMsg(null);
    const res = await send<Sale>("/api/shop", { action: "sell", items: r.lines.map(l => ({ id: l.id, qty: l.qty })), ...body }, "POST", { quiet: true });
    setBusy(false); setFinger(null);
    if (!res.ok) { setMsg({ ok: false, text: res.error ?? "The sale didn't go through." }); return; }
    setDone(res.data); setBasket({}); setCode(""); setChild(null); lookedUp.current = ""; reload();
  }

  // Six characters typed: show whose code it is.
  async function lookup(raw: string) {
    const c = cleanBuyCode(raw);
    if (c.length !== 6 || lookedUp.current === c) return;
    lookedUp.current = c;
    setBusy(true); setMsg(null);
    const res = await send<{ child: Child }>("/api/shop", { action: "lookup", code: c }, "POST", { quiet: true });
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: res.error ?? "That code is not right." }); setChild(null); return; }
    setChild({ who: res.data.child, pay: { method: "code", code: c } });
  }
  const clearChild = () => { setChild(null); setCode(""); lookedUp.current = ""; setTimeout(() => codeRef.current?.focus(), 30); };

  // Fingerprint: wait (up to a minute) for the student's finger on the shop machine, then pay.
  useEffect(() => {
    if (!finger) return;
    let stop = false;
    const end = Date.now() + 60_000;
    const tick = async () => {
      if (stop) return;
      if (Date.now() > end) { setFinger(null); setMsg({ ok: false, text: "No finger was scanned. Try again, or ask for the buy code." }); return; }
      const res = await fetch(`/api/shop?view=scan&device=${finger.device}&since=${encodeURIComponent(finger.since)}`).then(x => x.json()).catch(() => null);
      if (stop) return;
      if (res?.scan) { stop = true; setFinger(null); setChild({ who: res.scan.student, pay: { method: "fingerprint", scan_id: res.scan.id } }); return; }
      setTimeout(tick, 1200);
    };
    tick();
    return () => { stop = true; };
  }, [finger]); // eslint-disable-line react-hooks/exhaustive-deps

  function pause() {
    const label = (typeof window !== "undefined" ? window.prompt("A note to recognise this sale (optional), e.g. 'boy in red cap':", "") : "") ?? "";
    const p = pauseSale(paused, { label: label.trim() || `Sale ${paused.length + 1}`, basket });
    if (!p.ok) { setMsg({ ok: false, text: p.error }); return; }
    setPaused(p.paused); savePaused(p.paused); setBasket({}); setCode(""); setChild(null); lookedUp.current = ""; setMsg({ ok: true, text: "Sale put on hold. Serve the next student." });
  }
  function resume(id: string) {
    if (r.lines.length && !window.confirm("Replace the sale on screen? Put it on hold first if you need it.")) return;
    const p = paused.find(x => x.id === id);
    if (!p) return;
    const rest = paused.filter(x => x.id !== id);
    setPaused(rest); savePaused(rest); setBasket(p.basket); setDone(null); setMsg(null);
    setTimeout(() => codeRef.current?.focus(), 50);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr,26rem]">
      <section className="card p-4 print:hidden">
        {!groups.length ? <Empty>No items yet. Add them under Stock & prices.</Empty> : groups.map(g => (
          <div key={g.category} className="mb-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.category}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{g.items.map(i => {
              const q = basket[i.id] ?? 0, out = i.stock !== null && i.stock <= 0;
              return (
                <div key={i.id} className={"rounded-lg border p-2 text-sm " + (q ? "border-brand-500 bg-brand-50" : "border-slate-200") + (out ? " opacity-50" : "")}>
                  <button type="button" className="w-full text-left" disabled={out} onClick={() => add(i.id, 1)} aria-pressed={q > 0}>
                    <span className="flex items-center gap-1.5"><input type="checkbox" readOnly checked={q > 0} tabIndex={-1} aria-hidden /><b className="truncate">{i.name}</b></span>
                    <span className="block text-xs text-slate-500">{money(i.price, cur)}{i.stock !== null ? ` · ${i.stock} left` : ""}{out ? " · out of stock" : ""}</span>
                  </button>
                  {q > 0 && <div className="mt-1 flex items-center gap-2"><button className="btn btn-ghost px-2 py-0.5" onClick={() => add(i.id, -1)} aria-label={`One less ${i.name}`}>−</button>
                    <b className="tabular-nums">{q}</b><button className="btn btn-ghost px-2 py-0.5" onClick={() => add(i.id, 1)} aria-label={`One more ${i.name}`}>+</button></div>}
                </div>
              );
            })}</div>
          </div>
        ))}
      </section>

      <div className="space-y-3">
        <section className="card p-4" aria-live="polite">
          {done ? (
            <div className="space-y-2 text-sm">
              <Alert tone="green">Paid. {money(done.total, cur)} left {done.student.name}&apos;s wallet.</Alert>
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {done.student.photo_url ? <img src={done.student.photo_url} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <div className="grid h-12 w-12 place-items-center rounded-lg bg-slate-100 font-bold text-slate-400">{done.student.name[0]}</div>}
                <div><b>{done.student.name}</b><span className="block text-xs text-slate-500">{[done.student.admission_no, done.student.class_name].filter(Boolean).join(" · ")}</span></div>
              </div>
              <table className="w-full"><tbody>{done.lines.map((l, k) => <tr key={k}><td>{l.qty}× {l.name}</td><td className="text-right tabular-nums">{money(l.qty * l.price, cur)}</td></tr>)}
                <tr className="border-t font-bold"><td>Total</td><td className="text-right tabular-nums">{money(done.total, cur)}</td></tr></tbody></table>
              <p className="text-xs text-slate-500">Receipt {done.reference} · {fmtTime(new Date().toISOString())}{done.exhausted ? " · wallet now empty (family told)" : ""}</p>
              <div className="flex gap-2 print:hidden"><button className="btn btn-outline" onClick={() => window.print()}>Print receipt</button><button className="btn btn-primary ml-auto" onClick={() => setDone(null)}>Next student</button></div>
            </div>
          ) : (
            <>
              <h2 className="mb-2 font-semibold">Receipt</h2>
              {!r.lines.length ? <p className="text-sm text-slate-500">Tick what the student is buying.</p> : (
                <table className="w-full text-sm"><tbody>{r.lines.map(l => <tr key={l.id}><td className="py-0.5">{l.qty}× {l.name}</td><td className="text-right tabular-nums">{money(l.amount, cur)}</td></tr>)}
                  <tr className="border-t text-base font-bold"><td className="pt-1">Total</td><td className="pt-1 text-right tabular-nums">{money(r.total, cur)}</td></tr></tbody></table>
              )}
              {ov.selling_open === false && <div className="mt-3"><Alert tone="amber">The shop is closed now. Selling times: {ov.settings.shop_selling_windows}.</Alert></div>}
              {msg && <div className="mt-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
              {child ? (
                <div className="mt-3 space-y-3 rounded-lg border-2 border-brand-500 bg-brand-50/40 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Is this the child in front of you?</p>
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {child.who.photo_url ? <img src={child.who.photo_url} alt="" className="h-20 w-20 rounded-lg object-cover" /> : <div className="grid h-20 w-20 place-items-center rounded-lg bg-white text-2xl font-bold text-slate-400">{child.who.name[0]}</div>}
                    <div><p className="text-lg font-semibold">{child.who.name}</p><p className="text-sm text-slate-600">{child.who.class_name ?? "No class"}</p></div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-primary flex-1 text-base" disabled={busy || !r.lines.length} onClick={() => pay(child.pay)}>{busy ? "Paying…" : `Pay ${money(r.total, cur)}`}</button>
                    <button className="btn btn-ghost" disabled={busy} onClick={clearChild}>Not this child</button>
                  </div>
                </div>
              ) : (
                <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); void lookup(code); }}>
                  <input ref={codeRef} className="input flex-1 text-center font-mono text-2xl uppercase tracking-[0.3em]" maxLength={7} placeholder="7K3-PX9" autoComplete="off" spellCheck={false} inputMode="text"
                    value={code} onChange={e => { const v = formatBuyCode(e.target.value); setCode(v); if (cleanBuyCode(v).length === 6) void lookup(v); else lookedUp.current = ""; }}
                    aria-label="Student's buy code" disabled={busy || !r.lines.length || ov.selling_open === false} />
                  <button className="btn btn-primary" disabled={busy || !r.lines.length || cleanBuyCode(code).length !== 6}>{busy ? "Checking…" : "Find"}</button>
                </form>
              )}
              {!child && ov.devices.length > 0 && (
                <div className="mt-2 flex gap-2">
                  {ov.devices.length > 1 && <select className="input" value={device} onChange={e => setDevice(e.target.value)} aria-label="Fingerprint machine">{ov.devices.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
                  <button className="btn btn-outline flex-1" disabled={busy || !r.lines.length || Boolean(finger)} onClick={() => { setMsg(null); setFinger({ device, since: new Date(Date.now() - 2000).toISOString() }); }}>
                    {finger ? "Waiting for the finger…" : "Pay by fingerprint"}</button>
                  {finger && <button className="btn btn-ghost" onClick={() => setFinger(null)}>Stop</button>}
                </div>
              )}
              {!child && ov.settings.shop_require_code === false && (
                <form className="mt-2 flex gap-2" onSubmit={async e => {
                  e.preventDefault();
                  const el = e.currentTarget.elements.namedItem("card") as HTMLInputElement;
                  const res = await fetch(`/api/wallet?scan=${encodeURIComponent(el.value.trim())}`).then(x => x.json().then(j => ({ ok: x.ok, j }))).catch(() => null);
                  if (!res?.ok) { setMsg({ ok: false, text: res?.j?.error ?? "No student found for that card." }); return; }
                  el.value = "";
                  await pay({ method: "card", student_id: res.j.student.id });
                }}>
                  <input name="card" className="input flex-1" placeholder="Or scan the ID card" aria-label="ID card or admission number" disabled={busy || !r.lines.length} />
                  <button className="btn btn-outline" disabled={busy || !r.lines.length}>Card</button>
                </form>
              )}
              <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                <button className="btn btn-outline" disabled={!r.lines.length || paused.length >= MAX_PAUSED} onClick={pause} title={`Up to ${MAX_PAUSED} sales can be on hold`}>Pause sale</button>
                <button className="btn btn-ghost" disabled={!r.lines.length} onClick={() => { setBasket({}); setCode(""); setChild(null); lookedUp.current = ""; setMsg(null); }}>New sale</button>
              </div>
            </>
          )}
        </section>
        {paused.length > 0 && (
          <section className="card p-4 print:hidden">
            <h3 className="mb-2 text-sm font-semibold">On hold ({paused.length} of {MAX_PAUSED})</h3>
            <ul className="space-y-2 text-sm">{paused.map(p => { const pr = receipt(p.basket, ov.items); return (
              <li key={p.id} className="flex items-center gap-2"><span className="mr-auto"><b>{p.label}</b><span className="block text-xs text-slate-500">{pr.lines.map(l => `${l.qty}× ${l.name}`).join(", ")} · {money(pr.total, cur)} · {fmtTime(p.at)}</span></span>
                <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => resume(p.id)}>Continue</button>
                <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => { const rest = paused.filter(x => x.id !== p.id); setPaused(rest); savePaused(rest); }}>Drop</button></li>); })}</ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Stock({ currency, reload }: { currency: string; reload: () => void }) {
  const { data, reload: again } = useApi<{ items: Item[]; moves: { id: number; item_id: string; change: number; reason: string; note: string | null; created_at: string; by: string | null }[] }>("/api/shop?view=stock");
  const blank = { id: "", name: "", price: "", category: "", active: true, track: true, stock: "", stock_alert: "" };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const refresh = () => { again(); reload(); };
  const items = data?.items ?? [];
  const name = (id: string) => items.find(i => i.id === id)?.name ?? "";
  async function restock(i: Item) {
    const v = window.prompt(`How many ${i.name} came in? (a minus number takes some off)`, "");
    if (!v || !Number.isInteger(Number(v)) || Number(v) === 0) return;
    const r = await send<{ stock: number }>("/api/shop", { action: "stock", item_id: i.id, change: Number(v), reason: Number(v) > 0 ? "restock" : "count" });
    setMsg({ ok: r.ok, text: r.ok ? `${i.name}: ${r.data.stock} in stock now.` : r.error ?? "failed" });
    if (r.ok) refresh();
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr,22rem]">
      <section className="card p-4">
        {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
        {!items.length ? <Empty>No items yet. Add your products: name, category (Biscuits, Sweets, Pastry, Drinks…), price and stock.</Empty> : byCategory(items).map(g => (
          <div key={g.category} className="mb-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.category}</p>
            <table className="w-full text-sm"><tbody>{g.items.map(i => { const low = i.stock !== null && i.stock_alert !== null && i.stock <= i.stock_alert; return (
              <tr key={i.id} className={"border-t border-slate-100 " + (i.active ? "" : "opacity-50")}>
                <td className="py-1.5">{i.name}{!i.active && <span className="text-xs text-slate-500"> (not for sale)</span>}</td>
                <td className="text-right tabular-nums">{money(i.price, currency)}</td>
                <td className="w-28 text-right">{i.stock === null ? <span className="text-xs text-slate-400">not counted</span> : <span className={low ? "font-semibold text-rose-600" : ""}>{i.stock} left{low ? " · low" : ""}</span>}</td>
                <td className="w-40 text-right"><div className="flex justify-end gap-1">
                  {i.stock !== null && <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => restock(i)}>Restock</button>}
                  <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setF({ id: i.id, name: i.name, price: String(i.price), category: i.category ?? "", active: i.active, track: i.stock !== null, stock: i.stock === null ? "" : String(i.stock), stock_alert: i.stock_alert === null ? "" : String(i.stock_alert) })}>Edit</button>
                </div></td></tr>); })}</tbody></table>
          </div>
        ))}
        {(data?.moves ?? []).length > 0 && (
          <details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold">Stock changes</summary>
            <ul className="mt-2 divide-y divide-slate-100">{data!.moves.slice(0, 40).map(m => (
              <li key={m.id} className="flex justify-between gap-2 py-1"><span>{name(m.item_id)} · {m.reason}{m.note ? ` · ${m.note}` : ""}<span className="block text-xs text-slate-500">{fmtDate(m.created_at)} {fmtTime(m.created_at)}{m.by ? ` · ${m.by}` : ""}</span></span>
                <b className={"tabular-nums " + (m.change > 0 ? "text-emerald-700" : "")}>{m.change > 0 ? `+${m.change}` : m.change}</b></li>))}</ul></details>
        )}
      </section>
      <form className="card h-fit space-y-2 p-4" onSubmit={async e => {
        e.preventDefault();
        const r = await send("/api/shop", { action: "save_item", id: f.id || undefined, name: f.name, price: Number(f.price), category: f.category || null, active: f.active,
          stock: f.track ? Number(f.stock || 0) : null, stock_alert: f.track && f.stock_alert !== "" ? Number(f.stock_alert) : null });
        setMsg({ ok: r.ok, text: r.ok ? `${f.name} saved.` : r.error ?? "failed" });
        if (r.ok) { setF(blank); refresh(); }
      }}>
        <h2 className="font-semibold">{f.id ? "Edit item" : "Add an item"}</h2>
        <Field label="Name"><input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="e.g. Digestive biscuit" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Category"><input className="input" list="shop-cats" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} placeholder="Biscuits" /></Field>
          <Field label="Price"><input className="input" type="number" min="0" step="0.01" required value={f.price} onChange={e => setF({ ...f, price: e.target.value })} /></Field>
        </div>
        <datalist id="shop-cats">{[...new Set(["Biscuits", "Sweets", "Pastry", "Drinks", "Snacks", "Stationery", ...items.map(i => i.category ?? "").filter(Boolean)])].map(c => <option key={c} value={c} />)}</datalist>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.track} onChange={e => setF({ ...f, track: e.target.checked })} /> Count the stock</label>
        {f.track && <div className="grid grid-cols-2 gap-2">
          <Field label={f.id ? "In stock now" : "Opening stock"}><input className="input" type="number" min="0" step="1" value={f.stock} onChange={e => setF({ ...f, stock: e.target.value })} /></Field>
          <Field label="Warn me at"><input className="input" type="number" min="0" step="1" value={f.stock_alert} onChange={e => setF({ ...f, stock_alert: e.target.value })} placeholder="e.g. 5" /></Field>
        </div>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> For sale</label>
        <div className="flex gap-2"><button className="btn btn-primary flex-1">Save</button>{f.id && <button type="button" className="btn btn-ghost" onClick={() => setF(blank)}>Cancel</button>}</div>
      </form>
    </div>
  );
}

type Event = { id: number; kind: string; amount: number | null; detail: Record<string, any>; at: string; student: string | null; by: string | null };
const REASONS: Record<string, string> = { over_limit: "over the daily limit", not_enough: "not enough money", empty: "empty wallet", bought_max: "bought enough today", wait: "too soon after the last buy",
  frozen: "wallet frozen", out_of_stock: "out of stock", not_for_sale: "item not for sale" };

/** `showBalance`: admins see the balance after each buy; sellers never do. */
function Activity({ currency, showBalance }: { currency: string; showBalance: boolean }) {
  const { data, reload } = useApi<{ events: Event[] }>("/api/shop?view=activity");
  const [only, setOnly] = useState("");
  useEffect(() => { const t = setInterval(reload, 15_000); return () => clearInterval(t); }, [reload]);
  const list = (data?.events ?? []).filter(e => !only || e.kind === only);
  const text = (e: Event) => {
    switch (e.kind) {
      case "purchase": return `${e.student} bought ${(e.detail.items ?? []).map((l: any) => `${l.qty}× ${l.name}`).join(", ") || "an item"} (${e.detail.method})${showBalance && e.detail.balance != null ? ` · balance ${money(e.detail.balance, currency)}` : ""}`;
      case "refused": return `${e.student ?? "A student"}: refused, ${REASONS[e.detail.reason] ?? e.detail.reason}`;
      case "bad_code": return "A wrong or used code was typed";
      case "exhausted": return `${e.student}'s wallet is empty (family told)`;
      case "topup": return `${money(e.amount, currency)} added to ${e.student}'s wallet`;
      case "code": return `${e.student}: buy code made${e.detail.made_as === "parent" ? " by a parent" : ""}`;
      case "restock": return `Restock: ${e.detail.change} ${e.detail.item} (now ${e.detail.stock})`;
      case "low_stock": return `Low stock: ${e.detail.item}, ${e.detail.stock} left (warn at ${e.detail.alert}). Admins told.`;
      case "seller_alert": return `Many wrong codes typed (${e.detail.wrong_codes} in ${e.detail.minutes} minutes). Admins told.`;
      default: return e.kind;
    }
  };
  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={only} onChange={e => setOnly(e.target.value)} aria-label="Show">
          <option value="">Everything</option><option value="purchase">Sales</option><option value="refused">Refused</option><option value="exhausted">Empty wallets</option>
          <option value="topup">Money added</option><option value="code">Codes made</option><option value="bad_code">Wrong codes</option><option value="restock">Restocks</option><option value="low_stock">Low stock</option></select>
        <span className="text-xs text-slate-500">Updates every 15 seconds.</span>
      </div>
      {!list.length ? <Empty>Nothing yet.</Empty> : (
        <ul className="divide-y divide-slate-100 text-sm">{list.map(e => (
          <li key={e.id} className="flex justify-between gap-3 py-1.5">
            <span className={e.kind === "refused" || e.kind === "bad_code" || e.kind === "exhausted" || e.kind === "low_stock" || e.kind === "seller_alert" ? "text-rose-700" : ""}>{text(e)}<span className="block text-xs text-slate-500">{fmtDate(e.at)} {fmtTime(e.at)}{e.by ? ` · ${e.by}` : ""}</span></span>
            {e.amount !== null && e.kind !== "exhausted" && <b className={"shrink-0 tabular-nums " + (e.kind === "topup" ? "text-emerald-700" : "")}>{money(e.amount, currency)}</b>}
          </li>))}</ul>
      )}
    </section>
  );
}

function Rules({ s, reload }: { s: Settings; reload: () => void }) {
  const [f, setF] = useState({
    perDay: String(s.shop_purchases_per_day ?? 1), gap: String(s.shop_gap_minutes ?? 60), windows: s.shop_code_windows ?? "", selling: s.shop_selling_windows ?? "", cap: s.shop_daily_cap == null ? "" : String(s.shop_daily_cap),
    requireCode: s.shop_require_code !== false, notify: s.shop_notify_each_purchase !== false, parentTopup: Boolean(s.shop_parent_topup)
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form className="card max-w-2xl space-y-4 p-5" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/shop", { action: "settings", purchases_per_day: Number(f.perDay), gap_minutes: Number(f.gap), code_windows: f.windows.trim(), selling_windows: f.selling.trim(),
        daily_cap: f.cap === "" ? null : Number(f.cap), require_code: f.requireCode, notify_each_purchase: f.notify, parent_topup: f.parentTopup });
      setMsg({ ok: r.ok, text: r.ok ? "Saved. The rules apply to the next code and the next sale." : r.error ?? "failed" });
      if (r.ok) reload();
    }}>
      <h2 className="font-semibold">Tuck shop rules</h2>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Buys a day per student" hint="After the last one: 'wait till tomorrow'."><input className="input" type="number" min={1} max={20} required value={f.perDay} onChange={e => setF({ ...f, perDay: e.target.value })} /></Field>
        <Field label="Wait after a buy (minutes)" hint="Before the next code can be made, e.g. 60."><input className="input" type="number" min={0} max={600} required value={f.gap} onChange={e => setF({ ...f, gap: e.target.value })} /></Field>
        <Field label="Selling times" hint="Sellers can sell only then, e.g. 10:00-10:30, 12:30-13:15 (break times). Empty: any time."><input className="input" value={f.selling} onChange={e => setF({ ...f, selling: e.target.value })} placeholder="10:00-10:30, 12:30-13:15" /></Field>
        <Field label="Times codes can be made" hint="e.g. 09:45-10:30, 12:15-13:15. Empty: any time."><input className="input" value={f.windows} onChange={e => setF({ ...f, windows: e.target.value })} placeholder="10:00-10:30, 12:30-13:15" /></Field>
        <Field label="Most a student can spend a day" hint="For every student. Empty: no school limit (a parent's own limit still applies)."><input className="input" type="number" min={0} step="0.01" value={f.cap} onChange={e => setF({ ...f, cap: e.target.value })} /></Field>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={f.requireCode} onChange={e => setF({ ...f, requireCode: e.target.checked })} />
        <span><b>Buy code or fingerprint needed to pay</b><span className="block text-xs text-slate-500">Off: the ID card alone pays (on the old till).</span></span></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={f.notify} onChange={e => setF({ ...f, notify: e.target.checked })} />
        <span><b>Tell parents about every buy</b><span className="block text-xs text-slate-500">They are always told when the wallet is empty, and see every buy on their page.</span></span></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={f.parentTopup} onChange={e => setF({ ...f, parentTopup: e.target.checked })} />
        <span><b>Parents may top up online</b><span className="block text-xs text-slate-500">Off: only school admins add money to wallets.</span></span></label>
      <button className="btn btn-primary">Save rules</button>
      <p className="text-xs text-slate-500">Fingerprint: set a fingerprint machine to &quot;Tuck shop&quot; under Sign in / out → Devices. Students&apos; fingerprints are the ones already enrolled on your machines.</p>
    </form>
  );
}

type Tx = { id: string; kind: string; amount: number; balance_after: number | null; description: string | null; status: string; created_at: string };
type Card = { currency: string; allergies: string | null; student: { id: string; name: string; admission_no: string; photo_url: string | null; class_name: string | null };
  wallet: { balance: number; daily_limit: number | null; low_balance_alert: number | null; frozen: boolean; spent_today: number; has_wallet: boolean; transactions: Tx[] } };

/** Admins add money to a student's wallet and set their limits. */
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
          <div className="card flex items-center gap-3 p-4">
            <div className="mr-auto"><b>{card.data.student.name}</b><span className="block text-xs text-slate-500">{card.data.student.admission_no} · {card.data.student.class_name ?? "No class"}</span></div>
            <div className="text-right"><p className="text-2xl font-bold tabular-nums">{money(w.balance, currency)}</p><p className="text-xs text-slate-500">spent today {money(w.spent_today, currency)}</p></div>
            {w.frozen && <Badge tone="red">frozen</Badge>}
          </div>
          {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
          <div className="grid gap-4 md:grid-cols-2">
            <form className="card space-y-2 p-4" onSubmit={async e => {
              e.preventDefault();
              const r = await send("/api/wallet", { action: "credit", student_id: sid, amount: Number(credit.amount), method: credit.method, kind: credit.kind, reference: credit.reference || null, note: credit.note || null });
              setMsg({ ok: r.ok, text: r.ok ? "Added. It shows on the student's dashboard and the parents have been told." : r.error ?? "failed" });
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
              <button className="btn btn-primary w-full">Add money</button>
            </form>
            <form className="card space-y-2 p-4" onSubmit={async e => {
              e.preventDefault();
              const r = await send("/api/wallet", { action: "settings", student_id: sid, daily_limit: lim.daily === "" ? null : Number(lim.daily), low_balance_alert: lim.low === "" ? null : Number(lim.low), frozen: lim.frozen });
              setMsg({ ok: r.ok, text: r.ok ? "Settings saved." : r.error ?? "failed" });
              if (r.ok) { setLimits(null); card.reload(); }
            }}>
              <h3 className="font-semibold">This student&apos;s limits</h3>
              <Field label="Daily spending limit" hint="Empty = only the school's limit. Parents can also set this."><input className="input" type="number" min="0" value={lim.daily} onChange={e => setLimits({ ...lim, daily: e.target.value })} /></Field>
              <Field label="Tell parents when the balance falls below"><input className="input" type="number" min="0" value={lim.low} onChange={e => setLimits({ ...lim, low: e.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={lim.frozen} onChange={e => setLimits({ ...lim, frozen: e.target.checked })} /> Freeze the wallet</label>
              <button className="btn btn-primary w-full">Save</button>
            </form>
          </div>
          <section className="card p-4">
            <h3 className="mb-2 font-semibold">History</h3>
            {!w.transactions.length ? <Empty>No transactions.</Empty> : (
              <div className="overflow-x-auto"><table className="w-full text-sm"><tbody>{w.transactions.map(t => <tr key={t.id} className="border-t border-slate-100">
                <td className="py-1.5">{fmtDate(t.created_at)} {fmtTime(t.created_at)}</td><td>{t.description}{t.status === "pending" ? " (pending)" : ""}</td>
                <td className={`text-right tabular-nums ${Number(t.amount) > 0 ? "text-emerald-700" : ""}`}>{money(t.amount, currency)}</td>
                <td className="text-right tabular-nums text-slate-500">{t.balance_after != null ? money(t.balance_after, currency) : ""}</td></tr>)}</tbody></table></div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
