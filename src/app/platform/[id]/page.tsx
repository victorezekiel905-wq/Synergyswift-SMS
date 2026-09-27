"use client";
import { useState, use } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Badge, statusTone, Alert, Field, fmtDate, Loading } from "@/components/ui";

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

type Detail = {
  tenant: { id: string; name: string; slug: string; status: string; modules: Record<string, boolean>; student_limit: number | null; timezone: string; contact_email: string | null; created_at: string };
  admins: { id: string; email: string; full_name: string; role: string; active: boolean }[];
  delivery_7d: Record<string, number>;
  audit: { id: string; action: string; ts: string; meta: Record<string, unknown> }[];
};

export default function TenantDetail(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { data, error, reload } = useApi<Detail>(`/api/platform/tenants/${params.id}`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [admin, setAdmin] = useState({ full_name: "", email: "" });

  async function patch(body: Record<string, unknown>, okText: string) {
    const r = await send(`/api/platform/tenants/${params.id}`, body, "PATCH");
    setMsg({ ok: r.ok, text: r.ok ? okText : r.error ?? "failed" });
    if (r.ok) reload();
  }
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const t = data.tenant;

  return (
    <Page>
      <Link href="/platform" className="text-sm text-brand-700 hover:underline">← All schools</Link>
      <PageHeader title={t.name} subtitle={`${t.slug} · created ${fmtDate(t.created_at)} · ${t.timezone}`}
        actions={<>
          <Badge tone={statusTone(t.status)}>{t.status}</Badge>
          {t.status === "active"
            ? <button className="btn btn-danger" onClick={() => confirm(`Suspend ${t.name}? Every user in this school loses access until you reactivate it.`) && patch({ status: "suspended" }, "School suspended")}>Suspend</button>
            : <button className="btn btn-primary" onClick={() => patch({ status: "active" }, "School reactivated")}>Reactivate</button>}
        </>} />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Modules</h2>
          <p className="mb-3 text-xs text-slate-500">Disabled modules disappear from the school&apos;s navigation and their APIs refuse requests.</p>
          <div className="space-y-2">
            {MODULES.map(([k, label]) => (
              <label key={k} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm">
                <span>{label}</span>
                <input type="checkbox" className="h-4 w-4" checked={t.modules?.[k] !== false}
                  onChange={e => patch({ modules: { ...t.modules, [k]: e.target.checked } }, "Modules updated")} />
              </label>
            ))}
          </div>
        </section>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">Plan limits</h2>
            <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem("limit") as HTMLInputElement).value; patch({ student_limit: v ? Number(v) : null }, "Limit saved"); }}>
              <Field label="Active student limit (blank = unlimited)"><input name="limit" className="input" type="number" min={1} defaultValue={t.student_limit ?? ""} /></Field>
              <button className="btn btn-primary">Save</button>
            </form>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 font-semibold">School administrators</h2>
            <ul className="mb-3 divide-y divide-slate-100 text-sm">
              {data.admins.map(a => <li key={a.id} className="flex justify-between py-2"><span>{a.full_name} <span className="text-slate-500">{a.email}</span></span><Badge tone={a.active ? "green" : "red"}>{a.role.replace("_", " ")}</Badge></li>)}
              {!data.admins.length && <li className="py-2 text-slate-500">No admins yet.</li>}
            </ul>
            <form className="grid grid-cols-1 gap-2 sm:grid-cols-3" onSubmit={e => { e.preventDefault(); patch({ add_admin: admin }, `Invitation sent to ${admin.email}`); setAdmin({ full_name: "", email: "" }); }}>
              <input className="input" placeholder="Full name" required value={admin.full_name} onChange={e => setAdmin({ ...admin, full_name: e.target.value })} aria-label="Admin full name" />
              <input className="input" placeholder="Email" type="email" required value={admin.email} onChange={e => setAdmin({ ...admin, email: e.target.value })} aria-label="Admin email" />
              <button className="btn btn-primary">Invite admin</button>
            </form>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 font-semibold">Message delivery (7 days)</h2>
            {Object.keys(data.delivery_7d).length === 0 ? <p className="text-sm text-slate-500">No messages yet.</p> : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.delivery_7d).map(([k, v]) => <Badge key={k} tone={statusTone(k.split(":")[1])}>{k.replace(":", " · ")}: {v}</Badge>)}
              </div>
            )}
          </section>
        </div>
      </div>

      <section className="card mt-5 p-5">
        <h2 className="mb-3 font-semibold">Platform audit (hidden from the school)</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {data.audit.map(a => <li key={a.id} className="flex justify-between gap-3 py-2"><span className="font-mono text-xs">{a.action}</span><span className="truncate text-xs text-slate-500">{JSON.stringify(a.meta)}</span><span className="whitespace-nowrap text-xs text-slate-500">{fmtDate(a.ts, true)}</span></li>)}
          {!data.audit.length && <li className="py-2 text-slate-500">Nothing yet.</li>}
        </ul>
      </section>
    </Page>
  );
}
