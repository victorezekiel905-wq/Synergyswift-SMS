"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Alert, Empty, Modal, Field, Badge, statusTone, Loading } from "@/components/ui";

type Student = {
  id: string; admission_no: string; first_name: string; last_name: string; other_names: string | null; status: string;
  class_groups: { name: string } | null; user_id: string | null;
  student_guardians: { guardians: { id: string; full_name: string; phone: string | null; email: string | null } | null }[];
};
type Structure = { class_groups: { id: string; name: string }[] };

export default function StudentsPage() {
  const [q, setQ] = useState("");
  const [cg, setCg] = useState("");
  const [status, setStatus] = useState("active");
  const params = new URLSearchParams({ q, status, ...(cg ? { class_group_id: cg } : {}) });
  const { data, error, loading, reload } = useApi<Student[]>(`/api/sims/students?${params}`, [q, cg, status]);
  const { data: structure } = useApi<Structure>("/api/school/structure");
  const [add, setAdd] = useState(false);
  const [imp, setImp] = useState(false);

  return (
    <Page wide>
      <PageHeader eyebrow="Student information" title="Students & parents"
        subtitle="Every student record, their guardians and how parents are reached. Guardians get results, sign-in alerts and pickup codes on WhatsApp and email."
        actions={<><button className="btn btn-outline" onClick={() => setImp(true)}>Import CSV</button><button className="btn btn-primary" onClick={() => setAdd(true)}>+ Add student</button></>} />
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search name or admission no" value={q} onChange={e => setQ(e.target.value)} aria-label="Search students" />
        <select className="input max-w-[200px]" value={cg} onChange={e => setCg(e.target.value)} aria-label="Class">
          <option value="">All classes</option>
          {(structure?.class_groups ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select className="input max-w-[160px]" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
          <option value="active">Active</option><option value="graduated">Graduated</option><option value="withdrawn">Withdrawn</option><option value="suspended">Suspended</option><option value="all">All</option>
        </select>
      </div>
      {error && <Alert>{error}</Alert>}
      {loading && !data ? <Loading /> : !data?.length ? <Empty>No students match.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-3">Adm. no</th><th className="p-3">Name</th><th className="p-3">Class</th><th className="p-3">Guardians</th><th className="p-3">Login</th><th className="p-3">Status</th></tr>
            </thead>
            <tbody>
              {data.map(s => (
                <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3 font-mono text-xs">{s.admission_no}</td>
                  <td className="p-3"><Link className="font-medium text-brand-700 hover:underline" href={`/school/students/${s.id}`}>{s.last_name}, {s.first_name} {s.other_names ?? ""}</Link></td>
                  <td className="p-3">{s.class_groups?.name ?? <span className="text-slate-400">—</span>}</td>
                  <td className="p-3 text-xs">{s.student_guardians.map(g => g.guardians?.full_name).filter(Boolean).join(", ") || <span className="text-amber-600">none — parents won&apos;t be notified</span>}</td>
                  <td className="p-3">{s.user_id ? <Badge tone="green">yes</Badge> : <Badge>no</Badge>}</td>
                  <td className="p-3"><Badge tone={statusTone(s.status)}>{s.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="p-3 text-xs text-slate-500">{data.length} students</p>
        </div>
      )}
      <AddStudent open={add} onClose={() => setAdd(false)} groups={structure?.class_groups ?? []} onDone={() => { setAdd(false); reload(); }} />
      <ImportStudents open={imp} onClose={() => setImp(false)} onDone={reload} />
    </Page>
  );
}

function AddStudent({ open, onClose, groups, onDone }: { open: boolean; onClose: () => void; groups: { id: string; name: string }[]; onDone: () => void }) {
  const blank = { admission_no: "", first_name: "", last_name: "", other_names: "", gender: "", date_of_birth: "", class_group_id: "",
    g_name: "", g_phone: "", g_email: "", g_relation: "mother" };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bind = (k: keyof typeof blank) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value }) });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const r = await send("/api/sims/students", {
      admission_no: f.admission_no, first_name: f.first_name, last_name: f.last_name, other_names: f.other_names || null,
      gender: f.gender || null, date_of_birth: f.date_of_birth || null, class_group_id: f.class_group_id || null,
      guardians: f.g_name ? [{ full_name: f.g_name, phone: f.g_phone || null, email: f.g_email || null, relation: f.g_relation, is_primary: true }] : []
    });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setF(blank); onDone();
  }
  return (
    <Modal open={open} onClose={onClose} title="Add student" wide>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <Field label="Admission number"><input className="input" required {...bind("admission_no")} /></Field>
        <Field label="First name"><input className="input" required {...bind("first_name")} /></Field>
        <Field label="Last name"><input className="input" required {...bind("last_name")} /></Field>
        <Field label="Other names"><input className="input" {...bind("other_names")} /></Field>
        <Field label="Gender"><select className="input" {...bind("gender")}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></Field>
        <Field label="Date of birth"><input className="input" type="date" {...bind("date_of_birth")} /></Field>
        <Field label="Class"><select className="input" {...bind("class_group_id")}><option value="">—</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        <h3 className="pt-2 text-sm font-semibold sm:col-span-3">Primary parent / guardian</h3>
        <Field label="Full name"><input className="input" {...bind("g_name")} /></Field>
        <Field label="WhatsApp / phone" hint="e.g. 08031234567 or +2348031234567"><input className="input" {...bind("g_phone")} /></Field>
        <Field label="Email"><input className="input" type="email" {...bind("g_email")} /></Field>
        <Field label="Relationship"><select className="input" {...bind("g_relation")}><option>mother</option><option>father</option><option>guardian</option><option>grandparent</option><option>sibling</option><option>other</option></select></Field>
        {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
        <div className="flex justify-end gap-2 sm:col-span-3"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save student"}</button></div>
      </form>
    </Modal>
  );
}

function ImportStudents({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState("");
  const [res, setRes] = useState<{ created: number; updated: number; guardians: number; errors: { row: number; error: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true); setErr(null); setRes(null);
    const r = await send("/api/sims/students/import", { csv });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    setRes(r.data); onDone();
  }
  return (
    <Modal open={open} onClose={onClose} title="Import students from CSV" wide>
      <p className="mb-2 text-sm text-slate-600">Columns: <code className="text-xs">admission_no, first_name, last_name, other_names, gender, date_of_birth, class, guardian_name, guardian_phone, guardian_email, guardian_relation</code>. Existing admission numbers are updated. Missing classes are created. Siblings with the same guardian phone share one guardian record.</p>
      <input type="file" accept=".csv,text/csv" className="mb-2 text-sm" aria-label="CSV file" onChange={async e => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
      <textarea className="input h-40 font-mono text-xs" value={csv} onChange={e => setCsv(e.target.value)} placeholder="…or paste CSV here" aria-label="CSV text" />
      {err && <div className="mt-2"><Alert>{err}</Alert></div>}
      {res && (
        <div className="mt-2 space-y-2">
          <Alert tone="green">Created {res.created}, updated {res.updated}, new guardians {res.guardians}.</Alert>
          {res.errors.length > 0 && <div className="max-h-40 overflow-y-auto rounded border border-rose-200 p-2 text-xs text-rose-700">{res.errors.map(e => <div key={e.row}>Row {e.row}: {e.error}</div>)}</div>}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2"><button className="btn btn-ghost" onClick={onClose}>Close</button><button className="btn btn-primary" disabled={!csv || busy} onClick={run}>{busy ? "Importing…" : "Import"}</button></div>
    </Modal>
  );
}
