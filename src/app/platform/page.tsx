"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Badge, statusTone, Empty, Alert, Modal, Field, fmtDate } from "@/components/ui";

type Tenant = {
  id: string; name: string; slug: string; status: string; country: string | null; created_at: string;
  student_limit: number | null; stats: { users: number; students: number; staff: number; messages_30d: number; exams: number };
};

export default function PlatformPage() {
  const { data, error, loading, reload } = useApi<Tenant[]>("/api/platform/tenants");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = (data ?? []).filter(t => !q || `${t.name} ${t.slug}`.toLowerCase().includes(q.toLowerCase()));
  const totals = (data ?? []).reduce((a, t) => ({ students: a.students + t.stats.students, staff: a.staff + t.stats.staff, msgs: a.msgs + t.stats.messages_30d }), { students: 0, staff: 0, msgs: 0 });

  return (
    <Page wide>
      <PageHeader eyebrow="Platform console" title="Schools (tenants)"
        subtitle="Only platform administrators can see this page. Schools cannot see each other, the platform console, or that other schools exist."
        actions={<button className="btn btn-primary" onClick={() => setOpen(true)}>+ New school</button>} />
      {error && <Alert>{error}</Alert>}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card p-4"><p className="text-xs uppercase text-slate-500">Schools</p><p className="text-2xl font-bold">{data?.length ?? "…"}</p></div>
        <div className="card p-4"><p className="text-xs uppercase text-slate-500">Active students</p><p className="text-2xl font-bold">{totals.students}</p></div>
        <div className="card p-4"><p className="text-xs uppercase text-slate-500">Staff</p><p className="text-2xl font-bold">{totals.staff}</p></div>
        <div className="card p-4"><p className="text-xs uppercase text-slate-500">Messages sent (30 days)</p><p className="text-2xl font-bold">{totals.msgs}</p></div>
      </div>
      <input className="input mb-3 max-w-sm" placeholder="Search schools" value={q} onChange={e => setQ(e.target.value)} aria-label="Search schools" />
      {loading && !data ? <p className="text-sm text-slate-500">Loading…</p> : list.length === 0 ? <Empty>No schools yet. Create the first one.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-3">School</th><th className="p-3">Status</th><th className="p-3 text-right">Students</th><th className="p-3 text-right">Staff</th><th className="p-3 text-right">Users</th><th className="p-3 text-right">Msgs 30d</th><th className="p-3">Created</th></tr>
            </thead>
            <tbody>
              {list.map(t => (
                <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3"><Link className="font-semibold text-brand-700 hover:underline" href={`/platform/${t.id}`}>{t.name}</Link><div className="text-xs text-slate-500">{t.slug}{t.country ? ` · ${t.country}` : ""}</div></td>
                  <td className="p-3"><Badge tone={statusTone(t.status)}>{t.status}</Badge></td>
                  <td className="p-3 text-right tabular-nums">{t.stats.students}{t.student_limit ? <span className="text-slate-400"> / {t.student_limit}</span> : null}</td>
                  <td className="p-3 text-right tabular-nums">{t.stats.staff}</td>
                  <td className="p-3 text-right tabular-nums">{t.stats.users}</td>
                  <td className="p-3 text-right tabular-nums">{t.stats.messages_30d}</td>
                  <td className="p-3 text-slate-500">{fmtDate(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreateTenant open={open} onClose={() => setOpen(false)} onCreated={() => { setOpen(false); reload(); }} />
    </Page>
  );
}

function CreateTenant({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ name: "", slug: "", country: "Nigeria", timezone: "Africa/Lagos", admin_name: "", admin_email: "", student_limit: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setF(p => ({ ...p, [k]: v, ...(k === "name" && !p.slug ? {} : {}) }));
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const slug = f.slug || f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    const r = await send("/api/platform/tenants", { ...f, slug, student_limit: f.student_limit ? Number(f.student_limit) : null });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setF({ name: "", slug: "", country: "Nigeria", timezone: "Africa/Lagos", admin_name: "", admin_email: "", student_limit: "" });
    onCreated();
  }
  return (
    <Modal open={open} onClose={onClose} title="New school">
      <form onSubmit={submit} className="space-y-3">
        <Field label="School name"><input className="input" required value={f.name} onChange={set("name")} /></Field>
        <Field label="Slug" hint="Internal identifier. Leave blank to derive from the name."><input className="input" value={f.slug} onChange={set("slug")} placeholder="green-hills-academy" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Country"><input className="input" value={f.country} onChange={set("country")} /></Field>
          <Field label="Time zone"><input className="input" value={f.timezone} onChange={set("timezone")} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First admin name"><input className="input" required value={f.admin_name} onChange={set("admin_name")} /></Field>
          <Field label="First admin email"><input className="input" type="email" required value={f.admin_email} onChange={set("admin_email")} /></Field>
        </div>
        <Field label="Student limit (optional)"><input className="input" type="number" min={1} value={f.student_limit} onChange={set("student_limit")} /></Field>
        <p className="text-xs text-slate-500">The admin receives an invitation email branded with the school name. A default grading scheme is created, and the school can change it.</p>
        {err && <Alert>{err}</Alert>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? "Creating…" : "Create school"}</button></div>
      </form>
    </Modal>
  );
}
