"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, money, fmtDate, localDate } from "@/components/ui";

type Float = { id: string; name: string; custodian_id: string | null; imprest: number; balance: number; active: boolean; users: { full_name: string } | null };
type Move = { id: string; float_id: string; kind: "topup" | "spend" | "return" | "adjust"; amount: number; on_date: string; note: string | null; expense_id: string | null; category: string | null; payee: string | null; has_receipt: boolean };
type Data = { finance: boolean; me: string; currency: string; floats: Float[]; moves: Move[]; counts: { id: string; float_id: string; counted: number; expected: number; note: string | null; counted_at: string }[]; staff: { user_id: string; full_name: string }[] };

const KIND: Record<Move["kind"], string> = { topup: "Top-up", spend: "Spent", return: "Returned to bank", adjust: "Count difference" };
const CATS = ["Supplies", "Transport", "Refreshments", "Repairs", "Postage", "Cleaning", "Printing", "Other"];

/** Petty cash floats: the custodian records spends (with receipts) and counts; the bursary tops up, returns and reconciles. */
export function PettyCash() {
  const { data, error, reload } = useApi<Data>("/api/accounts?view=petty");
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Float> | null>(null);
  const [act, setAct] = useState<{ kind: "spend" | "topup" | "return" | "count"; float: Float } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const cur = data.currency;
  const floats = data.floats;
  const current = floats.find(f => f.id === sel) ?? floats[0] ?? null;
  const moves = data.moves.filter(m => m.float_id === current?.id);
  const counts = data.counts.filter(c => c.float_id === current?.id);
  const close = () => { setAct(null); setErr(null); };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Each float is cash held by one person for small purchases. Spends are recorded with a receipt and show as expenses; top it back up to its set amount (the imprest) when it runs low, and count the cash now and then.</p>
      {note && <Alert tone="green">{note}</Alert>}
      {data.finance && <button className="btn btn-primary" onClick={() => setEdit({ imprest: 0, active: true, custodian_id: null })}>+ New float</button>}
      {!floats.length ? <Empty>{data.finance ? "No petty cash floats yet." : "You do not look after a petty cash float."}</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {floats.map(f => {
            const low = f.imprest > 0 && f.balance < f.imprest * 0.25;
            return (
              <button key={f.id} onClick={() => setSel(f.id)} className={"card p-4 text-left " + (current?.id === f.id ? "ring-2 ring-brand-500" : "")}>
                <div className="flex items-start justify-between gap-2"><p className="font-semibold">{f.name}</p>{!f.active && <Badge>closed</Badge>}{low && f.active && <Badge tone="amber">low</Badge>}</div>
                <p className="text-xs text-slate-500">Custodian: {f.users?.full_name ?? "—"}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{money(f.balance, cur)}</p>
                {f.imprest > 0 && <div className="mt-1 h-1.5 rounded bg-slate-100"><div className={"h-1.5 rounded " + (low ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, Math.max(0, (f.balance / f.imprest) * 100))}%` }} /></div>}
                {f.imprest > 0 && <p className="mt-1 text-xs text-slate-500">of {money(f.imprest, cur)} imprest</p>}
              </button>
            );
          })}
        </div>
      )}

      {current && (
        <section className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-semibold">{current.name}</h2>
            {current.active && (data.finance || current.custodian_id === data.me) && <button className="btn btn-primary" onClick={() => setAct({ kind: "spend", float: current })}>Record a spend</button>}
            {(data.finance || current.custodian_id === data.me) && <button className="btn btn-outline" onClick={() => setAct({ kind: "count", float: current })}>Count the cash</button>}
            {data.finance && current.active && <button className="btn btn-outline" onClick={() => setAct({ kind: "topup", float: current })}>Top up</button>}
            {data.finance && current.balance > 0 && <button className="btn btn-ghost" onClick={() => setAct({ kind: "return", float: current })}>Return to bank</button>}
            {data.finance && <button className="btn btn-ghost" onClick={() => setEdit(current)}>Edit</button>}
          </div>
          {!moves.length ? <Empty>Nothing recorded yet.</Empty> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Date</th><th className="p-2">What</th><th className="p-2">Details</th><th className="p-2 text-right">In</th><th className="p-2 text-right">Out</th><th className="p-2" /></tr></thead>
              <tbody>{moves.map(m => {
                const inflow = m.kind === "topup" || (m.kind === "adjust" && m.amount > 0);
                return (
                  <tr key={m.id} className="border-t border-slate-100"><td className="p-2 whitespace-nowrap">{fmtDate(m.on_date)}</td><td className="p-2">{KIND[m.kind]}{m.category ? <span className="text-slate-500"> · {m.category}</span> : null}</td>
                    <td className="p-2">{m.note}{m.payee ? <span className="text-slate-500"> ({m.payee})</span> : null}</td>
                    <td className="p-2 text-right tabular-nums text-emerald-700">{inflow ? money(Math.abs(m.amount), cur) : ""}</td>
                    <td className="p-2 text-right tabular-nums text-rose-700">{!inflow ? money(Math.abs(m.amount), cur) : ""}</td>
                    <td className="p-2 text-right">{m.has_receipt && data.finance && m.expense_id && <a className="text-xs text-brand-700 underline" href={`/api/accounts?receipt=${m.expense_id}`} target="_blank" rel="noreferrer">Receipt</a>}</td></tr>
                );
              })}</tbody></table></div>
          )}
          {counts.length > 0 && (
            <div><h3 className="mb-1 text-sm font-semibold">Cash counts</h3>
              <ul className="space-y-1 text-xs">{counts.slice(0, 10).map(c => {
                const d = Math.round((c.counted - c.expected) * 100) / 100;
                return <li key={c.id}>{fmtDate(c.counted_at, true)}: counted {money(c.counted, cur)}, expected {money(c.expected, cur)} {d === 0 ? <Badge tone="green">agrees</Badge> : <Badge tone={d < 0 ? "red" : "amber"}>{d < 0 ? `short ${money(-d, cur)}` : `over ${money(d, cur)}`}</Badge>}{c.note ? ` · ${c.note}` : ""}</li>;
              })}</ul></div>
          )}
        </section>
      )}

      <Modal open={Boolean(edit)} onClose={() => { setEdit(null); setErr(null); }} title={edit?.id ? "Edit float" : "New petty cash float"}>
        {edit && <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/accounts", { action: "save_float", id: edit.id, name: edit.name, custodian_id: edit.custodian_id || null, imprest: Number(edit.imprest || 0), active: edit.active !== false });
          if (!r.ok) return setErr(r.error);
          setEdit(null); setErr(null); reload();
        }}>
          <Field label="Name"><input className="input" required maxLength={80} placeholder="e.g. Front office" value={edit.name ?? ""} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Custodian" hint="The member of staff who holds the cash and records spends."><select className="input" value={edit.custodian_id ?? ""} onChange={e => setEdit({ ...edit, custodian_id: e.target.value || null })}>
            <option value="">—</option>{data.staff.map(s => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}</select></Field>
          <Field label="Imprest (amount to top back up to)"><input className="input" type="number" min={0} step="any" value={edit.imprest ?? 0} onChange={e => setEdit({ ...edit, imprest: Number(e.target.value) })} /></Field>
          {edit.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active !== false} onChange={e => setEdit({ ...edit, active: e.target.checked })} />In use (untick to close the float)</label>}
          <p className="text-xs text-slate-500">Put money in with a top-up once the float is saved.</p>
          {err && <Alert>{err}</Alert>}
          <button className="btn btn-primary w-full">Save</button>
        </form>}
      </Modal>

      <Modal open={act?.kind === "spend"} onClose={close} title={act ? `Spend from ${act.float.name}` : ""}>
        {act?.kind === "spend" && <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("float_id", act.float.id);
          const r = await fetch("/api/accounts/spend", { method: "POST", body: fd });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) return setErr(j.error ?? "Could not save");
          close(); setNote("Spend recorded."); reload();
        }}>
          <Field label="Amount"><input className="input" name="amount" type="number" min={0.01} max={act.float.balance} step="any" required /></Field>
          <Field label="Date"><input className="input" name="on_date" type="date" defaultValue={localDate()} required /></Field>
          <Field label="Category"><input className="input" name="category" list="petty-cats" required defaultValue="Supplies" /></Field>
          <datalist id="petty-cats">{CATS.map(c => <option key={c} value={c} />)}</datalist>
          <Field label="Paid to"><input className="input" name="payee" maxLength={120} /></Field>
          <div className="sm:col-span-2"><Field label="What it was for"><input className="input" name="description" required maxLength={200} /></Field></div>
          <div className="sm:col-span-2"><Field label="Receipt (photo or PDF, up to 5 MB)"><input className="input" name="receipt" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" /></Field></div>
          <p className="text-xs text-slate-500 sm:col-span-2">Available: {money(act.float.balance, data.currency)}</p>
          {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
          <button className="btn btn-primary sm:col-span-2">Save spend</button>
        </form>}
      </Modal>

      <Modal open={act?.kind === "topup" || act?.kind === "return"} onClose={close} title={act ? `${act.kind === "topup" ? "Top up" : "Return to bank from"} ${act.float.name}` : ""}>
        {act && (act.kind === "topup" || act.kind === "return") && <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const r = await send("/api/accounts", { action: "float_move", float_id: act.float.id, kind: act.kind, amount: Number(fd.get("amount")), on_date: String(fd.get("on_date")), note: String(fd.get("note") || "") || null });
          if (!r.ok) return setErr(r.error);
          close(); reload();
        }}>
          <Field label="Amount" hint={act.kind === "topup" && act.float.imprest > act.float.balance ? `Topping up to the imprest needs ${money(act.float.imprest - act.float.balance, data.currency)}.` : undefined}>
            <input className="input" name="amount" type="number" min={0.01} step="any" required max={act.kind === "return" ? act.float.balance : undefined}
              defaultValue={act.kind === "topup" ? Math.max(0, Math.round((act.float.imprest - act.float.balance) * 100) / 100) || "" : act.float.balance} /></Field>
          <Field label="Date"><input className="input" name="on_date" type="date" defaultValue={localDate()} required /></Field>
          <Field label="Note"><input className="input" name="note" maxLength={200} placeholder={act.kind === "topup" ? "e.g. cheque 001234" : ""} /></Field>
          {err && <Alert>{err}</Alert>}
          <button className="btn btn-primary w-full">Save</button>
        </form>}
      </Modal>

      <Modal open={act?.kind === "count"} onClose={close} title={act ? `Count the cash in ${act.float.name}` : ""}>
        {act?.kind === "count" && <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const r = await send<{ difference: number; adjusted: boolean }>("/api/accounts", { action: "count_float", float_id: act.float.id, counted: Number(fd.get("counted")), note: String(fd.get("note") || "") || null, adjust: fd.get("adjust") === "on" });
          if (!r.ok) return setErr(r.error);
          const d = r.data.difference;
          close(); setNote(d === 0 ? "The cash agrees with the records." : `The cash is ${d < 0 ? "short" : "over"} by ${money(Math.abs(d), data.currency)}${r.data.adjusted ? "; the difference has been booked." : "."}`); reload();
        }}>
          <Field label="Cash counted"><input className="input" name="counted" type="number" min={0} step="any" required autoFocus /></Field>
          <Field label="Note"><input className="input" name="note" maxLength={200} /></Field>
          {data.finance && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="adjust" />Book any difference to cash over and short</label>}
          {err && <Alert>{err}</Alert>}
          <button className="btn btn-primary w-full">Save count</button>
        </form>}
      </Modal>
    </div>
  );
}
