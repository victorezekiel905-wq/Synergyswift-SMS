"use client";
import { useEffect, useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field, fmtDate, fmtTime, money, Loading } from "@/components/ui";
import { LANGUAGES } from "@/lib/languages";

const withToken = (url: string, token?: string) => token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url;

// ---------------- Messages ----------------
type Thread = { id: string; subject: string; status: string; unread: number; last_message_at: string; student: string; with: string };
type Msg = { id: string; mine: boolean; sender: string; text: string; original: string | null; at: string };
type Inbox = { threads: Thread[]; messages: Msg[]; children: { id: string; name: string; teachers: { id: string; name: string; role: string }[] }[] };

/** Private two-way messages with the child's teachers and the school office. */
export function ParentMessages({ token }: { token?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, reload } = useApi<Inbox>(withToken(`/api/family/messages${open ? `?c=${open}` : ""}`, token), [open]);
  const [text, setText] = useState("");
  const [compose, setCompose] = useState(false);
  const [f, setF] = useState({ student_id: "", staff_user_id: "", subject: "", body: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [orig, setOrig] = useState<Set<string>>(new Set());
  useEffect(() => { const t = setInterval(reload, 30_000); return () => clearInterval(t); }, [reload]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const thread = data.threads.find(t => t.id === open);
  const kid = data.children.find(c => c.id === f.student_id) ?? data.children[0];

  if (open && thread) return (
    <div className="space-y-3">
      <button className="text-xs text-brand-700 underline" onClick={() => setOpen(null)}>← All messages</button>
      <p className="font-semibold">{thread.subject} <span className="text-xs font-normal text-slate-500">with {thread.with} · about {thread.student}</span></p>
      <div className="max-h-[50vh] space-y-2 overflow-y-auto">{data.messages.map(m => (
        <div key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.mine ? "ml-auto bg-brand-600 text-white" : "bg-slate-100"}`}>
          <p className={`text-[11px] ${m.mine ? "text-white/80" : "text-slate-500"}`}>{m.sender} · {fmtDate(m.at)} {fmtTime(m.at)}</p>
          <p className="whitespace-pre-wrap">{orig.has(m.id) && m.original ? m.original : m.text}</p>
          {m.original && <button className="text-[11px] underline" onClick={() => setOrig(s => { const n = new Set(s); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })}>{orig.has(m.id) ? "Show translation" : "Translated · show original"}</button>}
        </div>))}</div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {thread.status === "open" ? (
        <form className="flex gap-2" onSubmit={async e => {
          e.preventDefault();
          if (!text.trim()) return;
          const r = await send("/api/family/messages", { action: "reply", token, conversation_id: open, body: text.trim() });
          if (!r.ok) return setMsg({ ok: false, text: r.error ?? "failed" });
          setMsg(null); setText(""); reload();
        }}>
          <textarea className="input min-h-[2.75rem] flex-1" value={text} onChange={e => setText(e.target.value)} placeholder="Write a reply" aria-label="Reply" maxLength={4000} />
          <button className="btn btn-primary self-end" disabled={!text.trim()}>Send</button>
        </form>
      ) : <p className="text-xs text-slate-500">This conversation is closed. Start a new message if you need to.</p>}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><p className="mr-auto text-sm text-slate-600">Write to your child&apos;s teachers or the school office. Your phone number is never shared.</p>
        <button className="btn btn-primary px-3 py-1 text-xs" onClick={() => { setCompose(c => !c); setMsg(null); }}>{compose ? "Cancel" : "+ New message"}</button></div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {compose && kid && (
        <form className="space-y-2 rounded-lg border border-slate-200 p-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send<{ id: string }>("/api/family/messages", { action: "start", token, student_id: kid.id, staff_user_id: f.staff_user_id || null, subject: f.subject, body: f.body });
          if (!r.ok) return setMsg({ ok: false, text: r.error ?? "failed" });
          setCompose(false); setF({ student_id: "", staff_user_id: "", subject: "", body: "" }); setOpen(r.data.id);
        }}>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.children.length > 1 && <Field label="About"><select className="input" value={kid.id} onChange={e => setF({ ...f, student_id: e.target.value, staff_user_id: "" })}>{data.children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
            <Field label="To"><select className="input" value={f.staff_user_id} onChange={e => setF({ ...f, staff_user_id: e.target.value })}>
              <option value="">School office</option>{kid.teachers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.role})</option>)}</select></Field>
          </div>
          <Field label="Subject"><input className="input" required maxLength={160} value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} /></Field>
          <Field label="Message"><textarea className="input min-h-[6rem]" required maxLength={4000} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} /></Field>
          <button className="btn btn-primary w-full">Send</button>
        </form>
      )}
      {!data.threads.length ? <Empty>No messages yet.</Empty> : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">{data.threads.map(t => (
          <li key={t.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => setOpen(t.id)}>
            <span className="flex items-center gap-2"><b className="mr-auto truncate">{t.subject}</b>{t.unread > 0 && <Badge tone="blue">{t.unread} new</Badge>}{t.status === "closed" && <Badge>closed</Badge>}</span>
            <span className="text-xs text-slate-500">{t.with} · about {t.student} · {fmtDate(t.last_message_at)}</span></button></li>))}</ul>
      )}
    </div>
  );
}

// ---------------- Wallet ----------------
type Wallet = { student_id: string; balance: number; daily_limit: number | null; low_balance_alert: number | null; frozen: boolean;
  transactions: { id: string; kind: string; amount: number; description: string | null; status: string; created_at: string }[] };

/** Pocket money for the tuck shop and canteen: balance, top-up, limits and every purchase. */
export function ParentWallet({ token, kids }: { token?: string; kids: { id: string; name: string }[] }) {
  const { data, error, reload } = useApi<{ currency: string; online: boolean; wallets: Wallet[] }>(withToken("/api/family/wallet", token));
  const [amount, setAmount] = useState<Record<string, string>>({});
  const [limits, setLimits] = useState<Record<string, { daily: string; low: string; frozen: boolean }>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => { setResult(new URLSearchParams(window.location.search).get("wallet")); }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const cur = data.currency;
  const returnPath = token ? `/g/${token}` : "/parent";
  return (
    <div className="space-y-4">
      {result === "success" && <Alert tone="green">Top-up received. It may take a moment to show.</Alert>}
      {result === "failed" && <Alert>The top-up did not go through. You have not been charged.</Alert>}
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {data.wallets.map(w => {
        const name = kids.find(k => k.id === w.student_id)?.name ?? "";
        const l = limits[w.student_id] ?? { daily: w.daily_limit?.toString() ?? "", low: w.low_balance_alert?.toString() ?? "", frozen: w.frozen };
        return (
          <div key={w.student_id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center gap-2"><b className="mr-auto">{name}</b>{w.frozen && <Badge tone="red">frozen</Badge>}<span className="text-xl font-bold tabular-nums">{money(w.balance, cur)}</span></div>
            {data.online ? (
              <form className="mt-2 flex gap-2" onSubmit={async e => {
                e.preventDefault();
                const r = await send<{ url: string }>("/api/family/wallet", { action: "topup", token, student_id: w.student_id, amount: Number(amount[w.student_id]), return_path: returnPath });
                if (!r.ok) return setMsg({ ok: false, text: r.error ?? "failed" });
                window.location.href = r.data.url;
              }}>
                <input className="input w-36" type="number" min="1" step="1" required placeholder="Amount" value={amount[w.student_id] ?? ""} onChange={e => setAmount({ ...amount, [w.student_id]: e.target.value })} aria-label={`Top-up amount for ${name}`} />
                <button className="btn btn-primary">Top up</button>
              </form>
            ) : <p className="mt-1 text-xs text-slate-500">Top up at the school bursary.</p>}
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-brand-700">Limits and card</summary>
              <form className="mt-2 grid gap-2 sm:grid-cols-3" onSubmit={async e => {
                e.preventDefault();
                const r = await send("/api/family/wallet", { action: "settings", token, student_id: w.student_id, daily_limit: l.daily === "" ? null : Number(l.daily), low_balance_alert: l.low === "" ? null : Number(l.low), frozen: l.frozen });
                setMsg({ ok: r.ok, text: r.ok ? "Saved." : r.error ?? "failed" });
                if (r.ok) reload();
              }}>
                <Field label="Daily limit"><input className="input" type="number" min="0" placeholder="No limit" value={l.daily} onChange={e => setLimits({ ...limits, [w.student_id]: { ...l, daily: e.target.value } })} /></Field>
                <Field label="Alert me below"><input className="input" type="number" min="0" value={l.low} onChange={e => setLimits({ ...limits, [w.student_id]: { ...l, low: e.target.value } })} /></Field>
                <label className="flex items-center gap-2 self-end pb-2"><input type="checkbox" checked={l.frozen} onChange={e => setLimits({ ...limits, [w.student_id]: { ...l, frozen: e.target.checked } })} /> Freeze card (lost)</label>
                <button className="btn btn-primary sm:col-span-3">Save</button>
              </form>
            </details>
            {w.transactions.length > 0 && (
              <ul className="mt-2 divide-y divide-slate-100 text-sm">{w.transactions.slice(0, 10).map(t => (
                <li key={t.id} className="flex justify-between gap-2 py-1"><span className="truncate">{t.description ?? t.kind}{t.status === "pending" ? " (pending)" : ""}<span className="block text-xs text-slate-500">{fmtDate(t.created_at)} {fmtTime(t.created_at)}</span></span>
                  <span className={`tabular-nums ${Number(t.amount) > 0 ? "text-emerald-700" : ""}`}>{money(t.amount, cur)}</span></li>))}</ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Bus ----------------
type Bus = { student_id: string; route: string; vehicle: string | null; driver: string | null; driver_phone: string | null; stop: string | null;
  live: boolean; trip: string | null; position: { lat: number; lng: number; at: string } | null };

/** Where the bus is now. Uses an OpenStreetMap view; position is shared only during a trip. */
export function ParentBus({ token, kids }: { token?: string; kids: { id: string; name: string }[] }) {
  const { data, error, reload } = useApi<{ buses: Bus[] }>(withToken("/api/family/bus", token));
  useEffect(() => { const t = setInterval(reload, 20_000); return () => clearInterval(t); }, [reload]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  if (!data.buses.length) return <Empty>Your children are not on a school bus.</Empty>;
  return (
    <div className="space-y-4">{data.buses.map(b => {
      const p = b.position, d = 0.01;
      return (
        <div key={b.student_id} className="rounded-lg border border-slate-200 p-3 text-sm">
          <p><b>{kids.find(k => k.id === b.student_id)?.name}</b> · {b.route}{b.vehicle ? ` (${b.vehicle})` : ""}{b.stop ? ` · stop: ${b.stop}` : ""}</p>
          <p className="text-xs text-slate-500">Driver: {b.driver ?? "—"} {b.driver_phone ? <a className="text-brand-700" href={`tel:${b.driver_phone}`}>{b.driver_phone}</a> : null}</p>
          {p ? (<>
            <p className="mt-1">{b.live ? <Badge tone="green">Live · {b.trip} trip</Badge> : <Badge tone="amber">Last seen {fmtTime(p.at)}</Badge>}</p>
            <iframe title={`Map of the ${b.route} bus`} className="mt-2 h-56 w-full rounded border border-slate-200" loading="lazy"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${p.lng - d},${p.lat - d},${p.lng + d},${p.lat + d}&layer=mapnik&marker=${p.lat},${p.lng}`} />
          </>) : <p className="mt-1 text-xs text-slate-500">The bus is not on a trip right now.</p>}
        </div>
      );
    })}</div>
  );
}

// ---------------- Notifications and language ----------------
function keyBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

/** Turns on free app notifications on this phone or computer. */
export function NotificationsToggle({ token }: { token?: string }) {
  const [state, setState] = useState<"unknown" | "unsupported" | "on" | "off">("unknown");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setState("unsupported"); return; }
    navigator.serviceWorker.getRegistration().then(reg => reg?.pushManager.getSubscription()).then(s => setState(s ? "on" : "off")).catch(() => setState("off"));
  }, []);
  async function enable() {
    setMsg(null);
    try {
      const cfg = await fetch("/api/push").then(r => r.json());
      if (!cfg.configured || !cfg.public_key) { setMsg("App notifications are not set up by the school yet."); return; }
      if ((await Notification.requestPermission()) !== "granted") { setMsg("Notifications were blocked. Allow them in your browser settings."); return; }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.public_key) });
      const r = await send("/api/push", { action: "subscribe", token, subscription: sub.toJSON() });
      if (!r.ok) { setMsg(r.error); return; }
      setState("on");
    } catch (e) { setMsg((e as Error).message); }
  }
  async function disable() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) { await send("/api/push", { action: "unsubscribe", endpoint: sub.endpoint }); await sub.unsubscribe(); }
    setState("off");
  }
  if (state === "unsupported" || state === "unknown") return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="mr-auto">App notifications on this device: <b>{state === "on" ? "on" : "off"}</b></span>
      {state === "on" ? <button className="btn btn-outline px-3 py-1 text-xs" onClick={disable}>Turn off</button>
        : <button className="btn btn-primary px-3 py-1 text-xs" onClick={enable}>Turn on</button>}
      {msg && <p className="w-full text-xs text-rose-600">{msg}</p>}
    </div>
  );
}

/** The language school messages are translated into for this parent. */
export function LanguagePicker({ token, value }: { token?: string; value: string | null }) {
  const [lang, setLang] = useState(value ?? "");
  const [saved, setSaved] = useState(false);
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="mr-auto">Read school messages in</span>
      <select className="input w-auto py-1 text-sm" value={lang} onChange={async e => {
        setLang(e.target.value); setSaved(false);
        const r = await send("/api/family", { action: "language", token, language: e.target.value || null });
        setSaved(r.ok);
      }}>
        <option value="">The school&apos;s language</option>
        {Object.entries(LANGUAGES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>
      {saved && <span className="text-xs text-emerald-700">Saved</span>}
    </label>
  );
}
