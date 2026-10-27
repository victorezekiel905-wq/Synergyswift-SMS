"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Field, Loading, Modal, Empty } from "@/components/ui";
import { moduleLabel } from "@/lib/saas";

type Role = { id: string; name: string; description: string | null; grants: string[]; deny_modules: string[]; deny_permissions: string[] };
type Staff = { id: string; full_name: string; email: string; role: string; extra_roles: string[] | null; custom_role_id: string | null; active: boolean };
type Data = { roles: Role[]; staff: Staff[]; assignable_roles: string[]; modules: string[]; permissions: { key: string; label: string }[] };

const ROLE_LABELS: Record<string, string> = {
  school_admin: "School admin", principal: "Principal", teacher: "Teacher", it_admin: "IT admin", bursar: "Bursar", librarian: "Librarian",
  hr_manager: "HR manager", qa_officer: "QA officer", gate_officer: "Gate officer", transport_officer: "Transport officer",
  hostel_warden: "Hostel warden", nurse: "Nurse", admissions_officer: "Admissions officer", cashier: "Cashier", counsellor: "Counsellor"
};
const blank: Omit<Role, "id"> & { id?: string } = { name: "", description: "", grants: [], deny_modules: [], deny_permissions: [] };

/**
 * Roles and privileges inside the school: build roles such as "Exams officer"
 * or "Head of section" from the standard ones, take away parts of the system
 * or particular actions, and give them to staff.
 */
export default function RolesPage() {
  const { data, error, reload } = useApi<Data>("/api/school/roles");
  const [edit, setEdit] = useState<typeof blank | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState("");
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const roleName = (id: string | null) => data.roles.find(r => r.id === id)?.name;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const staff = data.staff.filter(s => !q || `${s.full_name} ${s.email}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Page wide>
      <PageHeader eyebrow="Settings" title="Roles and privileges" subtitle="Make your own roles from the standard ones, take away parts of the system or particular actions, and give them to staff."
        actions={<button className="btn btn-primary" onClick={() => setEdit({ ...blank })}>+ New role</button>} />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <section className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.roles.length === 0 && <div className="md:col-span-3"><Empty>No custom roles yet. For example, an &ldquo;Exams officer&rdquo; who is a teacher plus quality assurance, but cannot publish results.</Empty></div>}
        {data.roles.map(r => (
          <div key={r.id} className="card p-4 text-sm">
            <div className="mb-1 flex items-center gap-2"><p className="flex-1 font-semibold">{r.name}</p><button className="text-xs text-brand-700 hover:underline" onClick={() => setEdit({ ...r })}>Edit</button></div>
            {r.description && <p className="mb-2 text-slate-600">{r.description}</p>}
            <p><span className="text-slate-500">Adds:</span> {r.grants.length ? r.grants.map(g => ROLE_LABELS[g] ?? g).join(", ") : "nothing"}</p>
            {r.deny_modules.length > 0 && <p><span className="text-slate-500">Hides:</span> {r.deny_modules.map(moduleLabel).join(", ")}</p>}
            {r.deny_permissions.length > 0 && <p><span className="text-slate-500">Cannot:</span> {r.deny_permissions.map(p => data.permissions.find(x => x.key === p)?.label.toLowerCase() ?? p).join("; ")}</p>}
            <p className="mt-2 text-xs text-slate-500">{data.staff.filter(s => s.custom_role_id === r.id).length} staff</p>
          </div>
        ))}
      </section>
      <section className="card p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="flex-1 font-semibold">Staff</h2><input className="input max-w-xs" placeholder="Search staff" value={q} onChange={e => setQ(e.target.value)} aria-label="Search staff" /></div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Name</th><th>Standard role</th><th>Custom role</th></tr></thead>
          <tbody>
            {staff.map(s => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="py-2">{s.full_name}<span className="block text-xs text-slate-500">{s.email}</span></td>
                <td>{ROLE_LABELS[s.role] ?? s.role}{(s.extra_roles ?? []).length > 0 && <span className="text-xs text-slate-500"> + {(s.extra_roles ?? []).map(r => ROLE_LABELS[r] ?? r).join(", ")}</span>}{!s.active && <Badge tone="slate">inactive</Badge>}</td>
                <td>
                  <select className="input w-52 py-1" value={s.custom_role_id ?? ""} aria-label={`Custom role for ${s.full_name}`} onChange={async e => {
                    const r = await send("/api/school/roles", { user_id: s.id, custom_role_id: e.target.value || null }, "PATCH");
                    setMsg({ ok: r.ok, text: r.ok ? `${s.full_name}: ${roleName(e.target.value || null) ?? "no custom role"}` : r.error ?? "failed" });
                    if (r.ok) reload();
                  }}>
                    <option value="">None</option>{data.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? `Edit ${edit.name}` : "New role"} wide>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="Exams officer" /></Field>
              <Field label="What it is for (optional)"><input className="input" value={edit.description ?? ""} onChange={e => setEdit({ ...edit, description: e.target.value })} /></Field>
            </div>
            <div>
              <p className="label">Adds these standard roles</p>
              <div className="grid gap-1.5 sm:grid-cols-3">{data.assignable_roles.map(r => <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.grants.includes(r)} onChange={() => setEdit({ ...edit, grants: toggle(edit.grants, r) })} /> {ROLE_LABELS[r] ?? r}</label>)}</div>
            </div>
            <div>
              <p className="label">Hides these parts of the system</p>
              <div className="grid gap-1.5 sm:grid-cols-3">{data.modules.map(m => <label key={m} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.deny_modules.includes(m)} onChange={() => setEdit({ ...edit, deny_modules: toggle(edit.deny_modules, m) })} /> {moduleLabel(m)}</label>)}</div>
            </div>
            <div>
              <p className="label">Cannot do these, even with a role that normally can</p>
              <div className="grid gap-1.5 sm:grid-cols-2">{data.permissions.map(p => <label key={p.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.deny_permissions.includes(p.key)} onChange={() => setEdit({ ...edit, deny_permissions: toggle(edit.deny_permissions, p.key) })} /> {p.label}</label>)}</div>
            </div>
            <div className="flex justify-between gap-2">
              {edit.id ? <button className="btn btn-ghost text-rose-700" onClick={async () => { const r = await send(`/api/school/roles?id=${edit.id}`, undefined, "DELETE"); setMsg({ ok: r.ok, text: r.ok ? "Role deleted; its staff keep their standard roles." : r.error ?? "failed" }); setEdit(null); if (r.ok) reload(); }}>Delete role</button> : <span />}
              <div className="flex gap-2"><button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={async () => { const r = await send("/api/school/roles", { ...edit, description: edit.description || null }); setMsg({ ok: r.ok, text: r.ok ? "Role saved. It applies the next time each person loads a page." : r.error ?? "failed" }); if (r.ok) { setEdit(null); reload(); } }}>Save role</button></div>
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}
