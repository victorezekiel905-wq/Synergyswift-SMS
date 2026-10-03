"use client";
import { useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApi, send, Page, PageHeader, Badge, statusTone, Alert, Field, Tabs, Stat, Empty, fmtDate, Loading } from "@/components/ui";
import { LANGUAGES } from "@/lib/languages";

const MODULES: [string, string][] = [
  ["lms", "LMS (lessons, live class, challenges)"], ["sims", "Student information"], ["results", "Results & report cards"],
  ["exams", "Secure exams"], ["gate", "Sign in / out"], ["pickup", "Pickup codes"], ["library", "Library"],
  ["requisitions", "Requisitions"], ["hr", "HR & leave"], ["qa", "Quality assurance"], ["messaging", "Email, WhatsApp & SMS broadcasts"],
  ["inbox", "Parent-staff messaging"], ["fees", "Fees & online payments"], ["wallet", "Cashless wallet & tuck shop"],
  ["payroll", "Payroll"], ["inventory", "Accounts, stock & assets"], ["admissions", "Admissions"],
  ["attendance", "Class register"], ["behaviour", "Behaviour & houses"], ["homework", "Homework"], ["health", "Health & sick bay"],
  ["events", "Events & consent"], ["meetings", "Parent meetings"], ["timetable", "Timetable"], ["cover", "Staff cover"],
  ["transport", "School buses & live tracking"], ["hostel", "Boarding & exeat"], ["visitors", "Visitors"],
  ["lesson_notes", "Lesson notes"], ["analytics", "Early warning"]
];

const ROLE_LABELS: Record<string, string> = {
  school_admin: "School admin", principal: "Principal", teacher: "Teacher", it_admin: "IT admin", bursar: "Bursar", librarian: "Librarian",
  hr_manager: "HR manager", qa_officer: "QA officer", gate_officer: "Gate officer", transport_officer: "Transport officer",
  hostel_warden: "Hostel warden", nurse: "Nurse", admissions_officer: "Admissions officer", cashier: "Cashier"
};

type Account = { id: string; email: string; full_name: string; role: string; extra_roles: string[] | null; active: boolean; created_at: string };
type Tenant = { id: string; name: string; slug: string; status: string; status_message: string | null; modules: Record<string, boolean>; student_limit: number | null;
  timezone: string; country: string | null; contact_email: string | null; public_slug: string | null; created_at: string };
type Detail = {
  tenant: Tenant; settings: Record<string, any>; admins: Account[]; staff: Account[];
  family_logins: { students: number; parents: number };
  delivery_7d: Record<string, number>;
  audit: { id: string; action: string; ts: string; meta: Record<string, unknown> }[];
};
type Tab = "overview" | "settings" | "staff" | "modules" | "history";

export default function TenantDetail(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { data, error, reload } = useApi<Detail>(`/api/platform/tenants/${params.id}`);
  const [tab, setTab] = useState<Tab>("overview");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function patch(body: Record<string, unknown>, okText: string) {
    const r = await send(`/api/platform/tenants/${params.id}`, body, "PATCH");
    setMsg({ ok: r.ok, text: r.ok ? okText : r.error ?? "failed" });
    if (r.ok) reload();
    return r.ok;
  }
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const t = data.tenant;

  return (
    <Page wide>
      <Link href="/platform" className="text-sm text-brand-700 hover:underline">← All schools</Link>
      <PageHeader title={t.name} subtitle={`${t.slug} · created ${fmtDate(t.created_at)} · ${t.timezone}`}
        actions={<Badge tone={statusTone(t.status)}>{t.status === "active" ? "Active" : t.status === "paused" ? "Paused" : "Suspended"}</Badge>} />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "overview", label: "Overview" }, { id: "settings", label: "Settings" },
        { id: "staff", label: `Staff & admins (${data.staff.length})` }, { id: "modules", label: "Modules" }, { id: "history", label: "History" }
      ]} />
      {tab === "overview" && <Overview data={data} patch={patch} />}
      {tab === "settings" && <Settings data={data} patch={patch} />}
      {tab === "staff" && <Staff data={data} patch={patch} />}
      {tab === "modules" && <Modules t={t} patch={patch} />}
      {tab === "history" && <History data={data} />}
    </Page>
  );
}

type Patch = (body: Record<string, unknown>, okText: string) => Promise<boolean>;

function StatusControl({ t, patch }: { t: Tenant; patch: Patch }) {
  const [message, setMessage] = useState(t.status_message ?? "");
  const closed = t.status !== "active";
  return (
    <section className="card space-y-3 p-5">
      <h2 className="font-semibold">Status</h2>
      <p className="text-sm text-slate-600">
        {t.status === "active" && "The school is open. Everyone can sign in."}
        {t.status === "paused" && "Paused: nobody in this school can sign in or open a parent link until you restart it. No data is lost."}
        {t.status === "suspended" && "Suspended: the school is locked, for example for non-payment or a breach of terms. No data is lost."}
      </p>
      <Field label="Message shown to the school's users while closed" hint="For example: Closed for the holidays, back on 6 January.">
        <input className="input" maxLength={300} value={message} onChange={e => setMessage(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        {t.status !== "paused" && <button className="btn btn-outline" onClick={() => confirm(`Pause ${t.name}? Every user loses access until you restart it.`) && patch({ status: "paused", status_message: message || null }, "School paused")}>Pause</button>}
        {t.status !== "suspended" && <button className="btn btn-danger" onClick={() => confirm(`Suspend ${t.name}? Every user loses access until you restart it.`) && patch({ status: "suspended", status_message: message || null }, "School suspended")}>Suspend</button>}
        {closed && <button className="btn btn-primary" onClick={() => patch({ status: "active" }, "School restarted. Everyone can sign in again.")}>Restart</button>}
        {closed && message !== (t.status_message ?? "") && <button className="btn btn-outline" onClick={() => patch({ status_message: message || null }, "Message updated")}>Save message</button>}
      </div>
    </section>
  );
}

function Overview({ data, patch }: { data: Detail; patch: Patch }) {
  const t = data.tenant;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Staff accounts" value={data.staff.length} />
        <Stat label="Admins" value={data.admins.filter(a => a.active).length} tone={data.admins.some(a => a.active) ? undefined : "bad"} hint={data.admins.some(a => a.active) ? undefined : "No active admin"} />
        <Stat label="Student logins" value={data.family_logins.students} />
        <Stat label="Parent logins" value={data.family_logins.parents} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <StatusControl key={`${t.status}-${t.status_message}`} t={t} patch={patch} />
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Plan limits</h2>
          <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem("limit") as HTMLInputElement).value; patch({ student_limit: v ? Number(v) : null }, "Limit saved"); }}>
            <Field label="Active student limit (blank = unlimited)"><input name="limit" className="input" type="number" min={1} defaultValue={t.student_limit ?? ""} /></Field>
            <button className="btn btn-primary">Save</button>
          </form>
          <h2 className="mb-2 mt-5 font-semibold">Message delivery (7 days)</h2>
          {Object.keys(data.delivery_7d).length === 0 ? <p className="text-sm text-slate-500">No messages yet.</p> : (
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.delivery_7d).map(([k, v]) => <Badge key={k} tone={statusTone(k.split(":")[1])}>{k.replace(":", " · ")}: {v}</Badge>)}
            </div>
          )}
        </section>
      </div>
      <DeleteSchool t={t} />
    </div>
  );
}

function DeleteSchool({ t }: { t: Tenant }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = t.status !== "active";
  return (
    <section className="card border-rose-200 p-5">
      <h2 className="font-semibold text-rose-700">Delete this school</h2>
      <p className="mt-1 text-sm text-slate-600">Permanently removes the school, all of its records and every staff, parent and student sign-in. This cannot be undone. Pause or suspend the school first.</p>
      {open && (
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={async e => {
          e.preventDefault();
          if (!confirm(`Delete ${t.name} and all of its data for ever?`)) return;
          setBusy(true); setErr(null);
          const r = await send<{ accounts_removed: number }>(`/api/platform/tenants/${t.id}`, { confirm_name: name }, "DELETE");
          setBusy(false);
          if (!r.ok) return setErr(r.error);
          router.push("/platform");
        }}>
          <Field label={`Type ${t.name} to confirm`}><input className="input w-72" value={name} onChange={e => setName(e.target.value)} autoComplete="off" /></Field>
          <button className="btn btn-danger" disabled={busy || name.trim().toLowerCase() !== t.name.trim().toLowerCase()}>{busy ? "Deleting…" : "Delete school"}</button>
        </form>
      )}
      {err && <div className="mt-3"><Alert>{err}</Alert></div>}
    </section>
  );
}

type F = { key: string; label: string; kind?: "text" | "number" | "bool" | "time" | "select" | "area" | "color"; options?: [string, string][]; hint?: string; tenant?: boolean };
const SECTIONS: { title: string; fields: F[] }[] = [
  { title: "School", fields: [
    { key: "name", label: "Name on the platform", tenant: true }, { key: "school_name", label: "Name on report cards and messages" },
    { key: "motto", label: "Motto" }, { key: "principal_name", label: "Principal" }, { key: "address", label: "Address", kind: "area" },
    { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "contact_email", label: "Platform contact email", tenant: true },
    { key: "logo_url", label: "Logo URL" }, { key: "brand_color", label: "Brand colour", kind: "color" },
    { key: "public_slug", label: "Admissions web address", hint: "Letters, numbers and hyphens: /apply/your-school", tenant: true }
  ] },
  { title: "Region", fields: [
    { key: "country", label: "Country", tenant: true }, { key: "timezone", label: "Time zone", hint: "e.g. Africa/Lagos", tenant: true },
    { key: "currency", label: "Currency", hint: "e.g. NGN, KES, GHS, USD" },
    { key: "default_language", label: "School language", kind: "select", options: Object.entries(LANGUAGES) }
  ] },
  { title: "Messages", fields: [
    { key: "sender_name", label: "Sender name" }, { key: "reply_to_email", label: "Reply-to email" },
    { key: "notify_results", label: "Send results to parents when published", kind: "bool" },
    { key: "notify_gate_events", label: "Tell parents about sign-in and sign-out", kind: "bool" },
    { key: "sms_mode", label: "SMS", kind: "select", options: [["fallback", "Fallback when WhatsApp fails"], ["always", "Always send SMS too"], ["off", "Never send SMS"]] }
  ] },
  { title: "Security", fields: [
    { key: "require_mfa", label: "Two-factor sign-in", kind: "select", options: [["off", "Optional for everyone"], ["admins", "Required for admins, bursars and HR"], ["staff", "Required for all staff"]],
      hint: "Staff without an authenticator app are asked to set one up at their next sign-in." }
  ] },
  { title: "School day", fields: [
    { key: "staff_start_time", label: "Staff start time", kind: "time" }, { key: "student_start_time", label: "Student start time", kind: "time" },
    { key: "pickup_code_ttl_min", label: "Pickup code valid for (minutes)", kind: "number" },
    { key: "exam_violation_limit", label: "Exam lock after violations", kind: "number" },
    { key: "library_loan_days", label: "Library loan (days)", kind: "number" }, { key: "library_fine_per_day", label: "Library fine per day", kind: "number" }
  ] },
  { title: "Fees", fields: [
    { key: "payment_provider", label: "Online payments", kind: "select", options: [["", "Off"], ["paystack", "Paystack"], ["flutterwave", "Flutterwave"]] },
    { key: "payment_subaccount", label: "Settlement subaccount code" }, { key: "bank_details", label: "Bank details shown on invoices", kind: "area" },
    { key: "withhold_results_for_debtors", label: "Hold back results until fees are paid", kind: "bool" }
  ] },
  { title: "Admissions", fields: [
    { key: "admissions_open", label: "Admissions open", kind: "bool" }, { key: "application_fee", label: "Application fee", kind: "number" },
    { key: "admissions_intro", label: "Introduction on the application form", kind: "area" }
  ] }
];

function Settings({ data, patch }: { data: Detail; patch: Patch }) {
  const initial = () => {
    const v: Record<string, any> = {};
    for (const s of SECTIONS) for (const f of s.fields) {
      const src = f.tenant ? (data.tenant as Record<string, any>)[f.key] : data.settings[f.key];
      // Parent notifications are on unless a school turned them off; other switches start off.
      if (f.kind === "bool") v[f.key] = typeof src === "boolean" ? src : f.key.startsWith("notify_");
      else if (f.kind === "time") v[f.key] = typeof src === "string" ? src.slice(0, 5) : "";
      else v[f.key] = src ?? "";
    }
    return v;
  };
  const [v, setV] = useState<Record<string, any>>(initial);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const tenant: Record<string, unknown> = {}, settings: Record<string, unknown> = {};
    for (const s of SECTIONS) for (const f of s.fields) {
      let val = v[f.key];
      if (f.kind === "number") val = val === "" || val === null ? undefined : Number(val);
      else if (f.kind === "time") val = val ? String(val).slice(0, 5) : undefined;
      else if (f.kind !== "bool" && typeof val === "string") val = val.trim();
      if (f.key === "payment_provider" && val === "") val = null;
      if (f.key === "brand_color" && !/^#[0-9a-fA-F]{6}$/.test(String(val ?? ""))) val = undefined;
      if (["default_language", "currency", "sms_mode", "require_mfa"].includes(f.key) && !val) val = undefined;
      if (f.key === "public_slug" && val === "") val = null;
      if (f.key === "timezone" && !val) val = undefined;
      if (val === undefined) continue;
      (f.tenant ? tenant : settings)[f.key] = val;
    }
    setBusy(true);
    await patch({ ...tenant, settings }, "Settings saved");
    setBusy(false);
  }

  const input = (f: F) => {
    const common = { id: f.key, value: v[f.key] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [f.key]: e.target.value }) };
    if (f.kind === "bool") return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(v[f.key])} onChange={e => setV({ ...v, [f.key]: e.target.checked })} />{f.label}</label>;
    if (f.kind === "select") return <Field label={f.label} hint={f.hint}><select className="input" {...common}>{f.options!.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>;
    if (f.kind === "area") return <Field label={f.label} hint={f.hint}><textarea className="input h-20" {...common} /></Field>;
    if (f.kind === "color") return <Field label={f.label}><div className="flex gap-2"><input type="color" className="h-10 w-12 cursor-pointer rounded border border-slate-300" value={/^#[0-9a-fA-F]{6}$/.test(v[f.key]) ? v[f.key] : "#1d5ddb"} onChange={e => setV({ ...v, [f.key]: e.target.value })} aria-label="Pick brand colour" /><input className="input" {...common} placeholder="#1d5ddb" /></div></Field>;
    return <Field label={f.label} hint={f.hint}><input className="input" type={f.kind === "number" ? "number" : f.kind === "time" ? "time" : "text"} step={f.kind === "number" ? "any" : undefined} {...common} /></Field>;
  };

  return (
    <form onSubmit={save} className="space-y-5">
      <Alert tone="blue">These are the same settings the school&apos;s admins see under School setup. Changes take effect immediately.</Alert>
      {SECTIONS.map(s => (
        <section key={s.title} className="card p-5">
          <h2 className="mb-3 font-semibold">{s.title}</h2>
          <div className="grid gap-3 md:grid-cols-2">{s.fields.map(f => <div key={f.key} className={f.kind === "area" ? "md:col-span-2" : ""}>{input(f)}</div>)}</div>
        </section>
      ))}
      <div className="sticky bottom-4 flex justify-end"><button className="btn btn-primary shadow-lg" disabled={busy}>{busy ? "Saving…" : "Save settings"}</button></div>
    </form>
  );
}

function Staff({ data, patch }: { data: Detail; patch: Patch }) {
  const [admin, setAdmin] = useState({ full_name: "", email: "", role: "school_admin" });
  const [q, setQ] = useState("");
  const list = data.staff.filter(s => !q || `${s.full_name} ${s.email} ${s.role}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Give admin access</h2>
        <p className="mb-3 text-sm text-slate-600">Invites a new person as an admin of this school. An existing staff member can be made an admin from the list below.</p>
        <form className="grid grid-cols-1 gap-2 sm:grid-cols-4" onSubmit={async e => { e.preventDefault(); if (await patch({ add_admin: admin }, `Invitation sent to ${admin.email}`)) setAdmin({ full_name: "", email: "", role: "school_admin" }); }}>
          <input className="input" placeholder="Full name" required value={admin.full_name} onChange={e => setAdmin({ ...admin, full_name: e.target.value })} aria-label="Full name" />
          <input className="input" placeholder="Email" type="email" required value={admin.email} onChange={e => setAdmin({ ...admin, email: e.target.value })} aria-label="Email" />
          <select className="input" value={admin.role} onChange={e => setAdmin({ ...admin, role: e.target.value })} aria-label="Role"><option value="school_admin">School admin</option><option value="principal">Principal</option></select>
          <button className="btn btn-primary">Invite</button>
        </form>
      </section>
      <section className="card p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">Staff accounts</h2>
          <input className="input w-64" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} aria-label="Search staff" />
        </div>
        {!list.length ? <Empty>No staff accounts.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-2">Name</th><th>Role</th><th>Access</th><th /></tr></thead>
            <tbody>{list.map(s => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="py-2">{s.full_name}<div className="text-xs text-slate-500">{s.email}</div></td>
                <td><select className="input w-48 py-1" value={s.role} aria-label={`Role for ${s.full_name}`}
                  onChange={e => patch({ user: { id: s.id, role: e.target.value } }, `${s.full_name} is now ${ROLE_LABELS[e.target.value] ?? e.target.value}`)}>
                  {Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  {!ROLE_LABELS[s.role] && <option value={s.role}>{s.role}</option>}</select></td>
                <td><Badge tone={s.active ? "green" : "red"}>{s.active ? "Active" : "Turned off"}</Badge></td>
                <td className="text-right">
                  <button type="button" className="btn btn-outline px-3 py-1 text-xs" onClick={() => patch({ user: { id: s.id, active: !s.active } }, s.active ? `${s.full_name} can no longer sign in` : `${s.full_name} can sign in again`)}>
                    {s.active ? "Turn off" : "Turn on"}</button>
                </td>
              </tr>))}</tbody></table></div>
        )}
        <p className="mt-3 text-xs text-slate-500">Students and parents are managed by the school. A school always keeps at least one active admin.</p>
      </section>
    </div>
  );
}

function Modules({ t, patch }: { t: Tenant; patch: Patch }) {
  return (
    <section className="card p-5">
      <p className="mb-3 text-sm text-slate-600">Turned-off modules disappear from the school&apos;s menus and their features refuse requests.</p>
      <div className="grid gap-2 md:grid-cols-2">
        {MODULES.map(([k, label]) => (
          <label key={k} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span>{label}</span>
            <input type="checkbox" className="h-4 w-4" checked={t.modules?.[k] !== false}
              onChange={e => patch({ modules: { ...t.modules, [k]: e.target.checked } }, `${label} ${e.target.checked ? "turned on" : "turned off"}`)} />
          </label>
        ))}
      </div>
    </section>
  );
}

function History({ data }: { data: Detail }) {
  return (
    <section className="card p-5">
      <h2 className="mb-3 font-semibold">Platform history (hidden from the school)</h2>
      {!data.audit.length ? <Empty>Nothing yet.</Empty> : (
        <ul className="divide-y divide-slate-100 text-sm">
          {data.audit.map(a => <li key={a.id} className="flex justify-between gap-3 py-2"><span className="font-mono text-xs">{a.action}</span><span className="truncate text-xs text-slate-500">{JSON.stringify(a.meta)}</span><span className="whitespace-nowrap text-xs text-slate-500">{fmtDate(a.ts, true)}</span></li>)}
        </ul>
      )}
    </section>
  );
}
