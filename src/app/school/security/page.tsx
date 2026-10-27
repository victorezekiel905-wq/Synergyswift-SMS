"use client";
import { useEffect, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Field, Loading, fmtDate } from "@/components/ui";

type S = {
  require_mfa: string; password_min_length: number; password_require_mixed_case: boolean; password_require_number: boolean; password_require_symbol: boolean;
  password_max_age_days: number; password_policy_scope: "staff" | "all"; session_idle_minutes: number; session_max_hours: number;
  staff_access_mode: "off" | "ip" | "device" | "ip_or_device"; staff_access_roles: "all_staff" | "except_admins"; staff_ip_allowlist: string[];
  sso_policy: "optional" | "required_staff"; sso_domains: string[]; sso_auto_join: boolean; allow_phone_login: boolean; audit_retention_days: number;
};
type Device = { id: string; user_id: string; label: string | null; last_ip: string | null; status: string; last_seen_at: string; created_at: string; users: { full_name: string; role: string } | null };
type Data = {
  settings: Partial<S>; devices: Device[]; staff: { id: string; full_name: string; role: string }[];
  here: { ip: string | null; ip_allowed: boolean; device_status: string | null; sso_session: boolean };
  available: { sms: boolean; sso: string[] };
};

/** Sign-in and access rules for the whole school. */
export default function SecurityPage() {
  const { data, error, reload } = useApi<Data>("/api/school/security");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await send("/api/school/security", body);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (r.ok) reload();
    return r.ok;
  };
  const s = data.settings;
  return (
    <Page>
      <PageHeader eyebrow="Administration" title="Security & sign-in"
        subtitle="How staff, parents and students sign in, how long sessions last, and where staff pages may be opened. Changes apply within a minute." />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <div className="space-y-5">
        <PasswordRules s={s} act={act} />
        <Section title="Two-factor sign-in" hint="A code from an authenticator app as well as the password.">
          <MfaForm value={s.require_mfa ?? "off"} act={act} />
        </Section>
        <SessionRules s={s} act={act} />
        <SsoRules s={s} available={data.available.sso} sso={data.here.sso_session} act={act} />
        <Section title="Sign in with a phone code" hint={data.available.sms ? "Staff and parents can sign in with a 6-digit code sent by SMS to the number on their record." : "Needs an SMS provider on the server (see the setup guide)."}>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.allow_phone_login !== false} disabled={!data.available.sms}
            onChange={e => act({ action: "phone", allow: e.target.checked }, e.target.checked ? "Phone sign-in is on." : "Phone sign-in is off.")} /> Allow phone sign-in for this school</label>
        </Section>
        <AccessRules s={s} here={data.here} act={act} />
        <Devices devices={data.devices} act={act} />
        <Section title="Sign someone out everywhere" hint="For a lost phone or a member of staff who has left. They must sign in again on every device.">
          <SignOutUser staff={data.staff} act={act} />
        </Section>
        <Section title="Change history" hint="How long the record of every create, edit and delete is kept.">
          <Retention days={s.audit_retention_days ?? 730} act={act} />
        </Section>
        <SupportVisits />
      </div>
    </Page>
  );
}

/** Every time Synergy Swift support opened your school (phase 14k): who, why and for how long. */
function SupportVisits() {
  const { data } = useApi<{ sessions: { id: string; started_by_name: string; reason: string; starts_at: string; expires_at: string; ended_at: string | null }[] }>("/api/school/support-sessions");
  return (
    <Section title="Synergy Swift support visits" hint="Our support team can only open your school for up to an hour at a time, with a reason, as a separate account named Synergy Swift support. Every visit is listed here and everything done is in the change history.">
      {!data?.sessions.length ? <p className="text-sm text-slate-500">No support visits.</p> : <ul className="space-y-2 text-sm">{data.sessions.map(v => (
        <li key={v.id}><b>{v.started_by_name}</b> · {fmtDate(v.starts_at, true)} to {fmtDate(v.ended_at ?? v.expires_at, true)}<span className="block text-slate-600">{v.reason}</span></li>))}</ul>}
    </Section>
  );
}

type Act = (body: Record<string, unknown>, ok: string) => Promise<boolean>;

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3 p-5">
      <div><h2 className="font-semibold">{title}</h2>{hint && <p className="text-sm text-slate-600">{hint}</p>}</div>
      {children}
    </section>
  );
}

function PasswordRules({ s, act }: { s: Partial<S>; act: Act }) {
  const [f, setF] = useState({ min_length: s.password_min_length ?? 8, require_mixed_case: Boolean(s.password_require_mixed_case), require_number: s.password_require_number !== false,
    require_symbol: Boolean(s.password_require_symbol), max_age_days: s.password_max_age_days ?? 0, scope: s.password_policy_scope ?? "staff" });
  return (
    <Section title="Password rules" hint="Applied whenever someone sets or changes a password. Common passwords and passwords containing the person's name or email are always refused.">
      <form className="grid gap-3 sm:grid-cols-3" onSubmit={e => { e.preventDefault(); act({ action: "password", ...f }, "Password rules saved."); }}>
        <Field label="Minimum length"><input className="input" type="number" min={8} max={64} value={f.min_length} onChange={e => setF({ ...f, min_length: Number(e.target.value) })} /></Field>
        <Field label="Change every" hint="0 = never expires"><div className="flex items-center gap-2"><input className="input" type="number" min={0} max={730} value={f.max_age_days} onChange={e => setF({ ...f, max_age_days: Number(e.target.value) })} /><span className="text-sm">days</span></div></Field>
        <Field label="Expiry applies to"><select className="input" value={f.scope} onChange={e => setF({ ...f, scope: e.target.value as "staff" | "all" })}><option value="staff">Staff only</option><option value="all">Everyone, including parents</option></select></Field>
        <div className="flex flex-wrap gap-4 text-sm sm:col-span-3">
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.require_number} onChange={e => setF({ ...f, require_number: e.target.checked })} /> Needs a number</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.require_mixed_case} onChange={e => setF({ ...f, require_mixed_case: e.target.checked })} /> Needs capital and small letters</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.require_symbol} onChange={e => setF({ ...f, require_symbol: e.target.checked })} /> Needs a symbol</label>
        </div>
        <div><button className="btn btn-primary">Save</button></div>
      </form>
    </Section>
  );
}

function MfaForm({ value, act }: { value: string; act: Act }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); act({ action: "mfa", require_mfa: v }, "Two-factor rule saved."); }}>
      <Field label="Required for"><select className="input" value={v} onChange={e => setV(e.target.value)}>
        <option value="off">Nobody (optional)</option><option value="admins">Admins, bursar, HR and IT</option><option value="staff">All staff</option></select></Field>
      <button className="btn btn-primary">Save</button>
    </form>
  );
}

function SessionRules({ s, act }: { s: Partial<S>; act: Act }) {
  const [f, setF] = useState({ idle_minutes: s.session_idle_minutes ?? 0, max_hours: s.session_max_hours ?? 0 });
  return (
    <Section title="Sessions" hint="For shared staff-room computers: sign staff out when they walk away, and make everyone sign in again after a set time. Applies to staff.">
      <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); act({ action: "sessions", ...f }, "Session rules saved."); }}>
        <Field label="Sign out after inactivity" hint="minutes, 0 = never"><input className="input w-32" type="number" min={0} max={720} value={f.idle_minutes} onChange={e => setF({ ...f, idle_minutes: Number(e.target.value) })} /></Field>
        <Field label="Sign in again after" hint="hours, 0 = no limit"><input className="input w-32" type="number" min={0} max={720} value={f.max_hours} onChange={e => setF({ ...f, max_hours: Number(e.target.value) })} /></Field>
        <button className="btn btn-primary">Save</button>
      </form>
    </Section>
  );
}

function SsoRules({ s, available, sso, act }: { s: Partial<S>; available: string[]; sso: boolean; act: Act }) {
  const [f, setF] = useState({ policy: s.sso_policy ?? "optional", domains: (s.sso_domains ?? []).join(", "), auto_join: Boolean(s.sso_auto_join) });
  const names = available.map(p => (p === "azure" ? "Microsoft 365" : p === "google" ? "Google Workspace" : p)).join(" and ");
  return (
    <Section title="Google Workspace and Microsoft 365" hint={available.length ? `Available on this server: ${names}.` : "Not set up on this server yet: the platform owner enables the providers in Supabase and lists them in NEXT_PUBLIC_SSO_PROVIDERS."}>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); act({ action: "sso", policy: f.policy, domains: f.domains.split(/[,\s]+/).filter(Boolean), auto_join: f.auto_join }, "Single sign-on saved."); }}>
        <Field label="Staff sign-in"><select className="input" value={f.policy} disabled={!available.length} onChange={e => setF({ ...f, policy: e.target.value as S["sso_policy"] })}>
          <option value="optional">Password or single sign-on</option><option value="required_staff">Staff must use single sign-on</option></select></Field>
        <Field label="Your school email domains" hint="e.g. myschool.edu.ng"><input className="input" value={f.domains} onChange={e => setF({ ...f, domains: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.auto_join} onChange={e => setF({ ...f, auto_join: e.target.checked })} />
          Let staff with a school email join by signing in with it. Their account waits for an admin to approve it and set their role in HR.</label>
        {f.policy === "required_staff" && !sso && <p className="text-xs text-amber-800 sm:col-span-2">You signed in with a password. Sign in with Google or Microsoft first, then require it.</p>}
        <div><button className="btn btn-primary">Save</button></div>
      </form>
    </Section>
  );
}

function AccessRules({ s, here, act }: { s: Partial<S>; here: Data["here"]; act: Act }) {
  const [f, setF] = useState({ mode: s.staff_access_mode ?? "off", roles: s.staff_access_roles ?? "except_admins", ips: (s.staff_ip_allowlist ?? []).join("\n") });
  return (
    <Section title="Where staff pages can be opened" hint="Limit staff to the school's network, to devices you approve, or either. Parents and students are never affected. Exams have their own network rule.">
      <p className="text-xs text-slate-500">You are on {here.ip ?? "an unknown address"}{(s.staff_ip_allowlist ?? []).length ? (here.ip_allowed ? ", which is on the school list" : ", which is not on the school list") : ""}. This device is {here.device_status ?? "not registered"}.</p>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); act({ action: "access", mode: f.mode, roles: f.roles, ip_allowlist: f.ips.split(/[\n,]+/).map(x => x.trim()).filter(Boolean) }, "Access rule saved."); }}>
        <Field label="Rule"><select className="input" value={f.mode} onChange={e => setF({ ...f, mode: e.target.value as S["staff_access_mode"] })}>
          <option value="off">No restriction</option><option value="ip">School network only</option><option value="device">Approved devices only</option><option value="ip_or_device">School network, or an approved device elsewhere</option></select></Field>
        <Field label="Applies to"><select className="input" value={f.roles} onChange={e => setF({ ...f, roles: e.target.value as S["staff_access_roles"] })}>
          <option value="except_admins">All staff except admins and the principal</option><option value="all_staff">All staff, admins too</option></select></Field>
        {f.mode !== "device" && f.mode !== "off" && (
          <Field label="School network addresses" hint="One per line: an address (41.58.10.7) or a range (41.58.0.0/16).">
            <textarea className="input min-h-24 font-mono text-xs" value={f.ips} onChange={e => setF({ ...f, ips: e.target.value })} />
            {here.ip && <button type="button" className="mt-1 text-xs text-brand-700" onClick={() => setF({ ...f, ips: [f.ips.trim(), here.ip].filter(Boolean).join("\n") })}>Add my current address</button>}
          </Field>
        )}
        {f.mode !== "off" && f.mode !== "ip" && <p className="text-xs text-slate-600 sm:col-span-2">New devices appear below as staff use them. Approve the ones you trust. Your current device is approved automatically when you save.</p>}
        <div><button className="btn btn-primary">Save</button></div>
      </form>
    </Section>
  );
}

function Devices({ devices, act }: { devices: Device[]; act: Act }) {
  if (!devices.length) return null;
  const pending = devices.filter(d => d.status === "pending");
  return (
    <Section title={`Staff devices${pending.length ? ` (${pending.length} waiting)` : ""}`} hint="Devices staff have used while the device rule was on.">
      <ul className="divide-y divide-slate-100 text-sm">{devices.map(d => (
        <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
          <span className="min-w-48 flex-1"><b>{d.users?.full_name ?? "Staff"}</b> · {d.label ?? "Device"}
            <span className="block text-xs text-slate-500">first seen {fmtDate(d.created_at, true)} · last {fmtDate(d.last_seen_at, true)}{d.last_ip ? ` · ${d.last_ip}` : ""}</span></span>
          <Badge tone={d.status === "approved" ? "green" : d.status === "pending" ? "amber" : "red"}>{d.status}</Badge>
          {d.status !== "approved" && <button className="btn btn-success px-2 py-1 text-xs" onClick={() => act({ action: "device", id: d.id, status: "approved" }, "Device approved.")}>Approve</button>}
          {d.status !== "revoked" && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "device", id: d.id, status: "revoked" }, "Device blocked.")}>Block</button>}
          <button className="text-xs text-slate-500" onClick={() => act({ action: "device", id: d.id, status: "delete" }, "Removed.")}>Remove</button>
        </li>
      ))}</ul>
    </Section>
  );
}

function SignOutUser({ staff, act }: { staff: Data["staff"]; act: Act }) {
  const [id, setId] = useState("");
  return (
    <div className="flex flex-wrap gap-2">
      <select className="input w-auto" value={id} onChange={e => setId(e.target.value)} aria-label="Member of staff"><option value="">Choose a member of staff</option>{staff.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
      <button className="btn btn-outline" disabled={!id} onClick={() => { const n = staff.find(u => u.id === id)?.full_name; if (confirm(`Sign ${n} out of every device?`)) act({ action: "sign_out_user", user_id: id }, `${n} has been signed out everywhere.`); }}>Sign out everywhere</button>
    </div>
  );
}

function Retention({ days, act }: { days: number; act: Act }) {
  const [d, setD] = useState(days);
  return (
    <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); act({ action: "retention", days: d }, "Saved."); }}>
      <Field label="Keep for"><div className="flex items-center gap-2"><input className="input w-28" type="number" min={30} max={3650} value={d} onChange={e => setD(Number(e.target.value))} /><span className="text-sm">days</span></div></Field>
      <button className="btn btn-primary">Save</button>
    </form>
  );
}
