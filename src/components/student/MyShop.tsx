"use client";
import { useState } from "react";
import { useApi, send, Alert, Badge, money, fmtDate, fmtTime } from "@/components/ui";
import type { ShopStatus } from "@/lib/tuck-shop";

export type ShopEvent = { id: number; kind: string; amount: number | null; detail: Record<string, any>; at: string; student: string | null; by: string | null };
type Tx = { id: string; kind: string; amount: number; balance_after: number | null; description: string | null; method: string | null; status: string; created_at: string };
type Data = { currency: string; timezone?: string; status: ShopStatus; history: Tx[]; events: ShopEvent[]; analysis: { total: number; buys: number } };

const REASON: Record<string, string> = {
  over_limit: "over the daily limit", not_enough: "not enough money", empty: "the wallet was empty", bought_max: "bought enough times today already",
  wait: "too soon after the last buy", frozen: "the wallet is frozen", out_of_stock: "out of stock"
};

/** One line of shop activity, in words (student and parent views). */
export function eventText(e: ShopEvent, cur: string, who = "You"): string {
  switch (e.kind) {
    case "purchase": return `${who === "You" ? "You" : who} bought ${(e.detail.items ?? []).map((l: any) => `${l.qty}× ${l.name}`).join(", ") || "an item"}: ${money(e.amount, cur)}. Balance ${money(e.detail.balance, cur)}.`;
    case "refused": return `A buy of ${money(e.amount, cur)} was refused: ${REASON[e.detail.reason] ?? "not allowed"}.`;
    case "exhausted": return `${who === "You" ? "Your" : `${who}'s`} wallet is empty now.`;
    case "topup": return `${money(e.amount, cur)} was added to the wallet. Balance ${money(e.detail.balance, cur)}.`;
    case "code": return `A buy code was made${e.detail.made_as === "parent" ? " by a parent" : ""}.`;
    default: return e.kind;
  }
}

/** The student's tuck shop on their dashboard: money, buys left, their one-time buy code, history. */
export default function MyShop() {
  const { data, error, reload } = useApi<Data>("/api/shop/me");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return null;           // no shop module, or not a student record: say nothing
  if (!data) return null;
  const s = data.status, cur = data.currency;
  const tz = data.timezone;
  const at = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, ...(tz ? { timeZone: tz } : {}) }).format(new Date(iso)) : "");
  return (
    <section className="card mb-8 p-5" id="shop">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold">Tuck shop</h2>
          <p className="text-sm text-slate-600">{s.left} of {s.max} buy{s.max === 1 ? "" : "s"} left today{s.cap !== null ? ` · ${money(s.cap_left, cur)} left to spend today` : ""}{s.next_at ? ` · next buy from ${at(s.next_at)}` : ""}</p>
        </div>
        <div className="text-right"><p className="text-xs text-slate-500">Balance</p><p className="text-2xl font-bold tabular-nums">{money(s.balance, cur)}</p>{s.frozen && <Badge tone="red">frozen</Badge>}</div>
      </div>

      <div className="mt-4 rounded-lg border-2 border-dashed border-slate-300 p-4 text-center">
        {s.code ? (
          <>
            <p className="text-xs uppercase tracking-wide text-slate-500">Your buy code</p>
            <p className="my-1 font-mono text-5xl font-bold tracking-[0.3em] text-navy" aria-live="polite">{s.code}</p>
            <p className="text-xs text-slate-500">Tell it to the seller. It works once, today only{s.code_expires ? ` (until ${at(s.code_expires)})` : ""}.</p>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600">Make a one-time code when you are ready to buy{s.windows ? ` (codes can be made at ${s.windows})` : ""}.</p>
            <button className="btn btn-primary mt-3" disabled={busy} onClick={async () => {
              setBusy(true); setMsg(null);
              const r = await send<{ code: string }>("/api/shop/me", {}, "POST", { quiet: true });
              setBusy(false);
              if (!r.ok) setMsg({ ok: false, text: r.error ?? "Please try again." }); else reload();
            }}>{busy ? "Making…" : "Make my buy code"}</button>
          </>
        )}
        {msg && <p role="status" className={"mt-2 text-sm " + (msg.ok ? "text-emerald-700" : "text-rose-700")}>{msg.text}</p>}
      </div>

      {data.events.length > 0 && (
        <details className="mt-4" open>
          <summary className="cursor-pointer text-sm font-semibold">What happened</summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">{data.events.slice(0, 8).map(e => (
            <li key={e.id} className={"py-1.5 " + (e.kind === "refused" || e.kind === "exhausted" ? "text-rose-700" : "")}>{eventText(e, cur)}<span className="block text-xs text-slate-500">{fmtDate(e.at)} {fmtTime(e.at)}</span></li>))}</ul>
        </details>
      )}
      {data.history.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold">History (last 30 days: {data.analysis.buys} buy{data.analysis.buys === 1 ? "" : "s"}, {money(data.analysis.total, cur)})</summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">{data.history.map(t => (
            <li key={t.id} className="flex justify-between gap-2 py-1.5"><span className="truncate">{t.description ?? t.kind}<span className="block text-xs text-slate-500">{fmtDate(t.created_at)} {fmtTime(t.created_at)}{t.method === "fingerprint" ? " · fingerprint" : t.method === "code" ? " · code" : ""}</span></span>
              <b className={`tabular-nums ${Number(t.amount) > 0 ? "text-emerald-700" : ""}`}>{money(t.amount, cur)}</b></li>))}</ul>
        </details>
      )}
      {error && <Alert>{error}</Alert>}
    </section>
  );
}
