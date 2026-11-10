"use client";
import { useState } from "react";
import { useApi, send, Alert, Loading, money, fmtDate, fmtTime } from "@/components/ui";
import { eventText, type ShopEvent } from "@/components/student/MyShop";
import { formatBuyCode, type ShopStatus } from "@/lib/tuck-shop";

type Child = { student_id: string; name: string; status: ShopStatus; events: ShopEvent[];
  analysis: { total: number; buys: number; average: number; categories: { category: string; amount: number }[]; days: { day: string; amount: number }[] } };
const withToken = (u: string, token?: string) => (token ? `${u}${u.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : u);

/** For parents: each child's tuck shop (buys left, a buy code to send to the class teacher, spending by category and day). */
export default function ParentShop({ token }: { token?: string }) {
  const { data, error, reload } = useApi<{ currency: string; timezone?: string; children: Child[] }>(withToken("/api/family/shop", token));
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return null;
  if (!data) return <Loading />;
  if (!data.children.length) return null;
  const cur = data.currency;
  const at = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, ...(data.timezone ? { timeZone: data.timezone } : {}) }).format(new Date(iso)) : "");
  async function make(c: Child, toTeacher: boolean) {
    setBusy(c.student_id + toTeacher);
    const r = await send<{ code: string; sent: { to: string } | null }>("/api/family/shop", { token, student_id: c.student_id, send_to_teacher: toTeacher }, "POST", { quiet: true });
    setBusy(null);
    setMsg({ ...msg, [c.student_id]: r.ok
      ? { ok: true, text: r.data.sent ? `Code ${formatBuyCode(r.data.code)} sent to the ${r.data.sent.to} to give ${c.name.split(" ")[0]}.` : `${c.name.split(" ")[0]}'s buy code: ${formatBuyCode(r.data.code)}. It works once, today only.` }
      : { ok: false, text: r.error ?? "Please try again." } });
    if (r.ok) reload();
  }
  return (
    <section className="space-y-4">
      <h3 className="font-semibold">Tuck shop</h3>
      {data.children.map(c => {
        const s = c.status, max = Math.max(1, ...c.analysis.days.map(d => d.amount)), catMax = Math.max(1, ...c.analysis.categories.map(x => x.amount));
        return (
          <div key={c.student_id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <b className="mr-auto">{c.name}</b>
              <span className="text-sm text-slate-600">{s.left} of {s.max} buy{s.max === 1 ? "" : "s"} left today{s.next_at ? ` · next from ${at(s.next_at)}` : ""}</span>
            </div>
            {s.code
              ? <p className="mt-2 text-sm">Today&apos;s buy code: <b className="font-mono text-lg tracking-widest">{formatBuyCode(s.code)}</b> <span className="text-slate-500">(works once{s.code_expires ? `, until ${at(s.code_expires)}` : ""})</span></p>
              : <div className="mt-2 flex flex-wrap gap-2">
                  <button className="btn btn-outline text-sm" disabled={busy !== null} onClick={() => make(c, false)}>{busy === c.student_id + "false" ? "Making…" : "Make a buy code"}</button>
                  <button className="btn btn-primary text-sm" disabled={busy !== null} onClick={() => make(c, true)}>{busy === c.student_id + "true" ? "Sending…" : "Make code and send to class teacher"}</button>
                </div>}
            {msg[c.student_id] && <p role="status" className={"mt-2 text-sm " + (msg[c.student_id].ok ? "text-emerald-700" : "text-rose-700")}>{msg[c.student_id].text}</p>}
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Last 30 days: {money(c.analysis.total, cur)} in {c.analysis.buys} buy{c.analysis.buys === 1 ? "" : "s"}</p>
                <ul className="mt-1 space-y-1 text-sm">{c.analysis.categories.map(x => (
                  <li key={x.category}><div className="flex justify-between"><span>{x.category}</span><span className="tabular-nums">{money(x.amount, cur)}</span></div>
                    <div className="h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-brand-600" style={{ width: `${(x.amount / catMax) * 100}%` }} /></div></li>))}</ul>
              </div>
              {c.analysis.days.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">By day</p>
                  <div className="mt-1 flex h-20 items-end gap-1" role="img" aria-label="Spending by day">{c.analysis.days.slice(-14).map(d => (
                    <div key={d.day} title={`${fmtDate(d.day)}: ${money(d.amount, cur)}`} className="flex-1 rounded-t bg-brand-500" style={{ height: `${Math.max(4, (d.amount / max) * 100)}%` }} />))}</div>
                </div>
              )}
            </div>
            {c.events.length > 0 && (
              <details className="mt-3 text-sm"><summary className="cursor-pointer text-brand-700">What happened</summary>
                <ul className="mt-1 divide-y divide-slate-100">{c.events.slice(0, 10).map(e => (
                  <li key={e.id} className={"py-1 " + (e.kind === "refused" || e.kind === "exhausted" ? "text-rose-700" : "")}>{eventText(e, cur, c.name.split(" ")[0])}<span className="block text-xs text-slate-500">{fmtDate(e.at)} {fmtTime(e.at)}</span></li>))}</ul>
              </details>
            )}
          </div>
        );
      })}
      {error && <Alert>{error}</Alert>}
    </section>
  );
}
