"use client";
import { useEffect, useState } from "react";
import { useApi, send, Alert, Badge, Field, fmtDate } from "@/components/ui";

/** Change password under the school's rules (also used when a password has expired). */
export function PasswordCard({ required, onChanged }: { required?: boolean; onChanged?: () => void }) {
  const { data, reload } = useApi<{ rules: string; days_left: number | null; needs_current: boolean }>("/api/account/password");
  const [f, setF] = useState({ current: "", pw: "", pw2: "", others: true });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section id="password" className="card space-y-3 p-5">
      <div className="flex items-center gap-2">
        <h2 className="mr-auto font-semibold">Password</h2>
        {data?.days_left != null && <Badge tone={data.days_left < 0 ? "red" : data.days_left <= 7 ? "amber" : "slate"}>{data.days_left < 0 ? "expired" : `expires in ${data.days_left} days`}</Badge>}
      </div>
      {required && <Alert tone="amber">Your password has expired. Choose a new one to continue.</Alert>}
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <form className="grid gap-3 sm:grid-cols-3" onSubmit={async e => {
        e.preventDefault();
        if (f.pw !== f.pw2) { setMsg({ ok: false, text: "The new passwords do not match." }); return; }
        setBusy(true);
        const r = await send("/api/account/password", { password: f.pw, current_password: f.current || undefined, sign_out_others: f.others });
        setBusy(false);
        setMsg({ ok: r.ok, text: r.ok ? "Password changed." : r.error ?? "failed" });
        if (r.ok) { setF({ current: "", pw: "", pw2: "", others: f.others }); reload(); onChanged?.(); }
      }}>
        {data?.needs_current && <Field label="Current password"><input className="input" type="password" autoComplete="current-password" value={f.current} onChange={e => setF({ ...f, current: e.target.value })} required /></Field>}
        <Field label="New password" hint={data?.rules}><input className="input" type="password" autoComplete="new-password" value={f.pw} onChange={e => setF({ ...f, pw: e.target.value })} required /></Field>
        <Field label="Confirm new password"><input className="input" type="password" autoComplete="new-password" value={f.pw2} onChange={e => setF({ ...f, pw2: e.target.value })} required /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={f.others} onChange={e => setF({ ...f, others: e.target.checked })} /> Sign out my other devices</label>
        <div className="sm:col-span-3"><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Change password"}</button></div>
      </form>
    </section>
  );
}

type Session = { id: string; created_at: string; updated_at: string | null; ip: string | null; device: string; current: boolean };

/** Where this account is signed in, with sign-out per device. */
export function SessionsCard() {
  const { data, error, reload } = useApi<{ sessions: Session[] }>("/api/account/sessions");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t); } }, [msg]);
  const end = async (body: Record<string, unknown>, ok: string) => { const r = await send("/api/account/sessions", body); setMsg(r.ok ? ok : r.error); reload(); };
  return (
    <section className="card space-y-3 p-5">
      <div className="flex items-center gap-2">
        <h2 className="mr-auto font-semibold">Signed-in devices</h2>
        {(data?.sessions.length ?? 0) > 1 && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => end({ others: true }, "Signed out everywhere else.")}>Sign out all other devices</button>}
      </div>
      {msg && <p className="text-sm text-slate-600" role="status">{msg}</p>}
      {error && <p className="text-sm text-slate-500">Device list unavailable: {error}</p>}
      <ul className="divide-y divide-slate-100 text-sm">{(data?.sessions ?? []).map(s => (
        <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
          <span className="flex-1">{s.device} {s.current && <Badge tone="green">this device</Badge>}
            <span className="block text-xs text-slate-500">signed in {fmtDate(s.created_at, true)}{s.updated_at ? ` · last active ${fmtDate(s.updated_at, true)}` : ""}{s.ip ? ` · ${s.ip}` : ""}</span></span>
          {!s.current && <button className="text-xs text-rose-600" onClick={() => end({ id: s.id }, "Signed out.")}>Sign out</button>}
        </li>
      ))}</ul>
    </section>
  );
}
