"use client";
import { useRef, useState } from "react";
import { send, Page, PageHeader, Alert, fmtTime } from "@/components/ui";

type Verified = {
  pickup_id: string; expires_at: string; guardian: string; collector: string; delegate_phone: string | null;
  student: { name: string; photo_url: string | null; class_name: string | null };
};

/** Gate officer checks a parent's 6-digit pickup code, confirms the child's face, then releases. */
export default function PickupDesk() {
  const [code, setCode] = useState("");
  const [v, setV] = useState<Verified | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null); setV(null);
    const r = await send<Verified>("/api/pickup", { action: "verify", code });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "Invalid code" }); return; }
    setV(r.data);
  }
  async function release() {
    if (!v) return;
    setBusy(true);
    const r = await send("/api/pickup", { action: "release", pickup_id: v.pickup_id });
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? `${v.student.name} released to ${v.collector}. Parents notified.` : r.error ?? "failed" });
    setV(null); setCode(""); ref.current?.focus();
  }

  return (
    <Page>
      <PageHeader eyebrow="Safe pickup" title="Pickup desk"
        subtitle="Parents generate a one-time 6-digit code in their portal or WhatsApp link. Check the code, confirm the child, then release. Parents are notified instantly." />
      <form onSubmit={verify} className="card flex max-w-xl gap-2 p-5">
        <input ref={ref} autoFocus className="input py-3 text-center font-mono text-3xl tracking-[0.5em]" inputMode="numeric" maxLength={6}
          value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" aria-label="Pickup code" />
        <button className="btn btn-primary px-6" disabled={busy || code.length !== 6}>Check</button>
      </form>
      <div className="mt-4 max-w-xl">{msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}</div>
      {v && (
        <section className="card mt-4 max-w-xl p-5">
          <div className="flex items-center gap-4">
            {v.student.photo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={v.student.photo_url} alt="" className="h-28 w-28 rounded-lg object-cover" />
              : <div className="grid h-28 w-28 place-items-center rounded-lg bg-slate-100 text-4xl font-bold text-slate-500">{v.student.name[0]}</div>}
            <div>
              <p className="text-2xl font-bold">{v.student.name}</p>
              <p className="text-slate-600">{v.student.class_name}</p>
              <p className="mt-2 text-sm">Collector: <b>{v.collector}</b>{v.delegate_phone ? ` (${v.delegate_phone})` : ""}</p>
              <p className="text-sm text-slate-500">Authorised by {v.guardian} · valid until {fmtTime(v.expires_at)}</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-amber-700">Confirm the child recognises the collector. If anything is wrong, do not release and call the parent.</p>
          <div className="mt-4 flex gap-2">
            <button className="btn btn-primary flex-1 py-3" disabled={busy} onClick={release}>Release child</button>
            <button className="btn btn-ghost flex-1 border border-slate-200" onClick={() => { setV(null); setCode(""); }}>Cancel</button>
          </div>
        </section>
      )}
    </Page>
  );
}
