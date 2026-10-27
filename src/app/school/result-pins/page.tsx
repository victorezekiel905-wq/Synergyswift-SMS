"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Empty, Loading, Field, Badge, fmtDate, money } from "@/components/ui";
import QrCode from "@/components/QrCode";
import QRCode from "qrcode";

type Batch = { id: string; name: string; max_uses: number; price: number; pins: number; expires_on: string | null; created_at: string; term: string | null; used_pins: number; checks: number };
type Made = { batchId: string; pins: { serial: string; pin: string }[] };
const fmtPin = (p: string) => p.replace(/(\d{4})(?=\d)/g, "$1-");

/** Result-checker PINs (phase 14l): scratch cards parents use to see a published result without signing in. */
export default function ResultPinsPage() {
  const { data, error, reload } = useApi<{ ready: boolean; checker: string | null; batches: Batch[] }>("/api/results/pins");
  const { data: terms } = useApi<{ id: string; name: string; terms: { id: string; name: string }[] }[]>("/api/school/academic");
  const [f, setF] = useState({ name: "", term_id: "", count: 200, max_uses: 5, price: 0, expires_on: "" });
  const [made, setMade] = useState<(Made & { name: string }) | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [serial, setSerial] = useState("");
  const [found, setFound] = useState<any>(undefined);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const create = async () => {
    const r = await send<Made>("/api/results/pins", { action: "create", ...f, term_id: f.term_id || null, expires_on: f.expires_on || null });
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "failed" });
    setMade({ ...r.data, name: f.name }); setMsg(null); reload();
  };
  // Cards print from their own window, so nothing else on the page is printed.
  const printCards = async () => {
    if (!made) return;
    const qr = data?.checker ? await QRCode.toString(data.checker, { type: "svg", margin: 0, width: 64 }) : "";
    const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]!));
    const w = window.open("", "_blank");
    if (!w) return setMsg({ ok: false, text: "Allow pop-ups for this site to print the cards." });
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Result checker cards</title><style>body{font:12px system-ui,sans-serif;margin:12mm}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}.c{border:1px solid #94a3b8;border-radius:6px;padding:8px;break-inside:avoid}.p{font:600 15px ui-monospace,monospace;letter-spacing:2px;background:#e2e8f0;text-align:center;padding:6px;border-radius:4px;margin:6px 0}.s{color:#475569;font-size:10px}.q{display:flex;gap:6px;align-items:center}.q svg{width:48px;height:48px}</style></head><body><div class="g">${made.pins.map(p => `<div class="c"><b>Result checker card</b><div class="s">${esc(made.name)} · Serial ${p.serial}</div><div class="p">${fmtPin(p.pin)}</div><div class="q">${qr}<span class="s">${esc(data?.checker ?? "")}</span></div><div class="s">Enter the admission number and this PIN. Works for one student only.</div></div>`).join("")}</div><script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  };
  const csv = () => {
    if (!made) return;
    const body = "Serial,PIN\n" + made.pins.map(p => `${p.serial},${fmtPin(p.pin)}`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
    a.download = `result-pins-${made.name.replace(/\W+/g, "-")}.csv`;
    a.click();
  };
  if (made) return (
    <Page wide>
      <div className="mb-4 space-y-2">
        <Alert tone="amber">Print or download these {made.pins.length} PINs now. For safety they are stored only in scrambled form and cannot be shown again.</Alert>
        <div className="flex flex-wrap gap-2"><button className="btn btn-primary" onClick={printCards}>Print cards</button><button className="btn btn-outline" onClick={csv}>Download CSV</button>
          <button className="btn btn-ghost" onClick={() => setMade(null)}>Done</button></div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{made.pins.slice(0, 12).map(p => (
        <div key={p.serial} className="break-inside-avoid rounded-lg border border-slate-300 p-3 text-xs">
          <p className="font-semibold">Result checker card</p>
          <p className="text-slate-500">{made.name} · Serial {p.serial}</p>
          <p className="mt-2 rounded bg-slate-100 px-2 py-1.5 text-center font-mono text-sm tracking-widest">{fmtPin(p.pin)}</p>
          {data.checker && <div className="mt-2 flex items-center gap-2"><QrCode value={data.checker} size={56} /><span className="break-all text-[10px] text-slate-600">{data.checker.replace(/^https?:\/\//, "")}</span></div>}
          <p className="mt-1 text-[10px] text-slate-500">Enter the admission number and this PIN. Works for one student only.</p>
        </div>))}</div>
      {made.pins.length > 12 && <p className="mt-3 text-sm text-slate-500">Showing 12 of {made.pins.length}; all of them print.</p>}
    </Page>
  );
  return (
    <Page wide>
      <PageHeader eyebrow="Exams & results" title="Result checker PINs" subtitle="Scratch cards for parents to see a published result online without signing in. Each PIN works for one student, a set number of times." />
      {!data.ready && <Alert tone="amber">Result PINs need this month&apos;s database update.</Alert>}
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {data.checker && <p className="mb-4 text-sm">Parents check results at <a className="text-brand-700 underline" href={data.checker} target="_blank" rel="noreferrer">{data.checker}</a></p>}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="card p-4">
          <h2 className="mb-2 font-semibold">Batches</h2>
          {!data.batches.length ? <Empty>No PINs yet.</Empty> : <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-[13px] text-slate-500"><tr><th className="py-1.5">Batch</th><th>Term</th><th>PINs</th><th>Used</th><th>Checks</th><th>Price</th><th>Expires</th></tr></thead>
            <tbody>{data.batches.map(b => <tr key={b.id} className="border-t border-slate-100"><td className="py-1.5">{b.name}<span className="block text-xs text-slate-500">{fmtDate(b.created_at)} · {b.max_uses} uses each</span></td>
              <td>{b.term ?? "any"}</td><td>{b.pins}</td><td>{b.used_pins} <span className="text-slate-500">({Math.round(100 * b.used_pins / b.pins)}%)</span></td><td>{b.checks}</td><td>{b.price ? money(b.price) : "free"}</td><td>{b.expires_on ? fmtDate(b.expires_on) : "—"}</td></tr>)}</tbody></table></div>}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="mb-2 font-medium">Look up a card</h3>
            <div className="flex gap-2"><input className="input" value={serial} onChange={e => setSerial(e.target.value)} placeholder="Serial, e.g. GC-000123" />
              <button className="btn btn-outline" onClick={async () => { const r = await fetch(`/api/results/pins?serial=${encodeURIComponent(serial)}`); setFound((await r.json()).pin ?? null); }}>Find</button></div>
            {found === null && <p className="mt-2 text-sm text-slate-500">No card has that serial number.</p>}
            {found && <div className="mt-2 text-sm"><p><b>{found.serial}</b> · {found.result_pin_batches?.name} <Badge tone={found.status === "active" ? "green" : "slate"}>{found.status}</Badge></p>
              <p className="text-slate-600">Used {found.uses} of {found.result_pin_batches?.max_uses} times{found.students ? ` · for ${found.students.first_name} ${found.students.last_name} (${found.students.admission_no})` : " · not used yet"}{found.last_used_at ? ` · last ${fmtDate(found.last_used_at, true)}` : ""}</p>
              {found.status === "active" && <button className="mt-1 text-xs text-red-700 underline" onClick={async () => { const r = await send("/api/results/pins", { action: "void", serial: found.serial }); setMsg({ ok: r.ok, text: r.ok ? "Card cancelled." : r.error ?? "failed" }); if (r.ok) setFound({ ...found, status: "void" }); }}>Cancel this card (lost or stolen)</button>}</div>}
          </div>
        </section>
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Make a batch</h2>
          <Field label="Name"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="First term 2026/2027" /></Field>
          <Field label="Term" hint="Any term: the latest published result."><select className="input" value={f.term_id} onChange={e => setF({ ...f, term_id: e.target.value })}><option value="">Any term</option>
            {(terms ?? []).flatMap(s => s.terms.map(t => <option key={t.id} value={t.id}>{t.name} {s.name}</option>))}</select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="How many PINs"><input className="input" type="number" min={1} max={5000} value={f.count} onChange={e => setF({ ...f, count: Number(e.target.value) })} /></Field>
            <Field label="Uses per PIN"><input className="input" type="number" min={1} max={50} value={f.max_uses} onChange={e => setF({ ...f, max_uses: Number(e.target.value) })} /></Field>
            <Field label="Price per card (₦)"><input className="input" type="number" min={0} value={f.price} onChange={e => setF({ ...f, price: Number(e.target.value) })} /></Field>
            <Field label="Expires (optional)"><input className="input" type="date" value={f.expires_on} onChange={e => setF({ ...f, expires_on: e.target.value })} /></Field>
          </div>
          <button className="btn btn-primary" disabled={f.name.trim().length < 2 || f.count < 1} onClick={create}>Make {f.count} PINs</button>
        </section>
      </div>
    </Page>
  );
}
