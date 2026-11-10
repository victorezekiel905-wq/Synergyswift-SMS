"use client";
import { useMemo, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Field, Loading, Empty, Modal } from "@/components/ui";

type Row = { id: string; full_name: string; email: string | null; staff_no: string; position: string | null; created_at: string;
  subject_ids: string[]; has_account: boolean; role: string | null; code: string | null; classes: number; active: boolean | null };
type Data = { subjects: { id: string; name: string }[]; staff: Row[]; roles: string[] };
type Method = "code" | "invite" | "otp";

const METHODS: [Method, string, string][] = [
  ["code", "Sign-up code", "A code is emailed to them. They make their account at /join with the code, their email and a password."],
  ["invite", "Email invitation link", "A link goes to their email; they open it and set their password."],
  ["otp", "One-time password", "Their email becomes the username. They sign in with the one-time password and choose their own at once."]
];
const words = (r: string) => r.replace(/_/g, " ");
const blank = { full_name: "", email: "", staff_no: "", role: "teacher", subject_ids: [] as string[], method: "code" as Method };

/** Staff onboarding: email, subjects they teach, optional ID number, then their way in. Classes come next, in Class teams. */
export default function StaffOnboardingPage() {
  const { data, error, reload } = useApi<Data>("/api/school/staff-onboarding");
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ok: boolean; text: string; next?: boolean } | null>(null);
  const [filter, setFilter] = useState("");
  const [again, setAgain] = useState<Record<string, Method>>({});
  const [editing, setEditing] = useState<{ id: string; ids: string[] } | null>(null);
  const subjectName = useMemo(() => new Map((data?.subjects ?? []).map(s => [s.id, s.name])), [data]);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;

  const teacher = f.role === "teacher";
  const shown = data.subjects.filter(s => !filter || s.name.toLowerCase().includes(filter.toLowerCase()));
  const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setDone(null);
    const r = await send<{ message: string; access_error?: string }>("/api/school/staff-onboarding", {
      action: "onboard", full_name: f.full_name, email: f.email, staff_no: f.staff_no || null, role: f.role,
      subject_ids: f.subject_ids, method: f.method }, "POST", { quiet: true });
    setBusy(false);
    if (!r.ok) return setDone({ ok: false, text: r.error ?? "Please try again." });
    setDone({ ok: !r.data.access_error, text: r.data.message, next: !r.data.access_error });
    setF(blank); setFilter(""); reload();
  }
  async function resend(row: Row) {
    const method = again[row.id] ?? "code";
    const r = await send<{ message: string }>("/api/school/staff-onboarding", { action: "resend", staff_id: row.id, method, email: row.email }, "POST", { quiet: true });
    setDone({ ok: r.ok, text: r.ok ? r.data.message : r.error ?? "Please try again." });
    if (r.ok) reload();
  }
  async function saveSubjects() {
    if (!editing) return;
    const r = await send("/api/school/staff-onboarding", { action: "subjects", staff_id: editing.id, subject_ids: editing.ids }, "POST", { quiet: true });
    setDone({ ok: r.ok, text: r.ok ? "Subjects saved." : r.error ?? "Please try again." });
    if (r.ok) { setEditing(null); reload(); }
  }

  const waiting = data.staff.filter(s => !s.has_account), joined = data.staff.filter(s => s.has_account);
  return (
    <Page wide>
      <PageHeader eyebrow="School office" title="Staff onboarding" subtitle="Add a member of staff with their email and the subjects they teach, and choose how they sign in. Once they have signed up, put them in their classes under Class teams." />
      {done && <div className="mb-4" role="status"><Alert tone={done.ok ? "green" : "red"}>{done.text}{done.next && <> <a className="font-semibold underline" href="/school/class-teams">Next: put them in classes →</a></>}</Alert></div>}

      <form onSubmit={submit} className="card mb-6 space-y-4 p-5">
        <h2 className="font-semibold">Add staff</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Full name"><input className="input" required minLength={2} value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} /></Field>
          <Field label="Email"><input className="input" type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="name@example.com" /></Field>
          <Field label="ID number (optional)"><input className="input" value={f.staff_no} maxLength={40} onChange={e => setF({ ...f, staff_no: e.target.value })} placeholder="Made for you if left blank" /></Field>
        </div>
        <Field label="Role"><select className="input sm:max-w-xs" value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>{data.roles.map(r => <option key={r} value={r}>{words(r)}</option>)}</select></Field>

        <fieldset>
          <legend className="label">Subjects they teach {teacher ? "" : "(if any)"} <span className="font-normal text-slate-500">· tick as many as apply{f.subject_ids.length ? ` · ${f.subject_ids.length} chosen` : ""}</span></legend>
          {!data.subjects.length ? <p className="text-sm text-slate-500">No subjects yet. Add them under <a className="text-brand-700 underline" href="/school/setup">School setup</a>.</p> : <>
            {data.subjects.length > 12 && <input className="input mb-2 sm:max-w-xs" placeholder="Find a subject" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Find a subject" />}
            <div className="grid max-h-60 grid-cols-2 gap-1 overflow-auto rounded-md border border-slate-200 p-2 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map(s => (
                <label key={s.id} className={"flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm " + (f.subject_ids.includes(s.id) ? "bg-brand-50" : "")}>
                  <input type="checkbox" checked={f.subject_ids.includes(s.id)} onChange={() => setF({ ...f, subject_ids: toggle(f.subject_ids, s.id) })} />{s.name}
                </label>))}
            </div>
            {f.subject_ids.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{f.subject_ids.map(id => <Badge key={id}>{subjectName.get(id)}</Badge>)}</div>}
          </>}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="label">How do they sign in?</legend>
          <div className="grid gap-2 md:grid-cols-3">
            {METHODS.map(([v, label, hint]) => (
              <label key={v} className={"flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm " + (f.method === v ? "border-brand-500 bg-brand-50" : "border-slate-200")}>
                <input type="radio" name="method" className="mt-0.5" checked={f.method === v} onChange={() => setF({ ...f, method: v })} />
                <span><b>{label}</b><span className="block text-xs text-slate-600">{hint}</span></span>
              </label>))}
          </div>
        </fieldset>
        <div className="flex justify-end"><button className="btn btn-primary" disabled={busy}>{busy ? "Adding…" : f.method === "invite" ? "Add and send invitation" : f.method === "otp" ? "Add and make login" : "Add and send code"}</button></div>
      </form>

      <section className="card mb-6 p-5">
        <h2 className="mb-1 font-semibold">Waiting to sign up ({waiting.length})</h2>
        {!waiting.length ? <Empty>Nobody is waiting.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1.5">Staff</th><th>Subjects</th><th>Code</th><th className="text-right">Send again</th></tr></thead>
            <tbody>{waiting.map(s => (
              <tr key={s.id} className="border-t border-slate-100 align-top">
                <td className="py-2"><b>{s.full_name}</b><span className="block text-xs text-slate-500">{s.staff_no} · {s.email ?? "no email"}{s.role ? ` · ${words(s.role)}` : ""}</span></td>
                <td className="py-2"><Subjects row={s} names={subjectName} onEdit={() => setEditing({ id: s.id, ids: s.subject_ids })} /></td>
                <td className="py-2 font-mono">{s.code ?? "—"}</td>
                <td className="py-2 text-right"><div className="inline-flex gap-1">
                  <select className="input py-1 text-xs" aria-label={`How ${s.full_name} signs in`} value={again[s.id] ?? "code"} onChange={e => setAgain({ ...again, [s.id]: e.target.value as Method })}>
                    {METHODS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
                  <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => resend(s)}>Send</button>
                </div></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>

      <section className="card p-5">
        <div className="mb-1 flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">Signed up ({joined.length})</h2><a className="text-sm text-brand-700 hover:underline" href="/school/class-teams">Class teams →</a></div>
        {!joined.length ? <Empty>Nobody yet.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1.5">Staff</th><th>Subjects</th><th>Classes</th></tr></thead>
            <tbody>{joined.map(s => (
              <tr key={s.id} className="border-t border-slate-100 align-top">
                <td className="py-2"><b>{s.full_name}</b><span className="block text-xs text-slate-500">{s.staff_no} · {s.email ?? ""}{s.role ? ` · ${words(s.role)}` : ""}{s.active === false ? " · login disabled" : ""}</span></td>
                <td className="py-2"><Subjects row={s} names={subjectName} onEdit={() => setEditing({ id: s.id, ids: s.subject_ids })} /></td>
                <td className="py-2">{s.classes ? `${s.classes} class${s.classes === 1 ? "" : "es"}` : <a className="text-amber-700 hover:underline" href="/school/class-teams">Not in a class yet: add →</a>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Subjects ${data.staff.find(s => s.id === editing?.id)?.full_name ?? ""} teaches`}>
        {editing && <>
            <div className="grid max-h-72 grid-cols-2 gap-1 overflow-auto rounded-md border border-slate-200 p-2">
              {data.subjects.map(s => <label key={s.id} className="flex items-center gap-2 px-1 py-0.5 text-sm"><input type="checkbox" checked={editing.ids.includes(s.id)} onChange={() => setEditing({ ...editing, ids: toggle(editing.ids, s.id) })} />{s.name}</label>)}
            </div>
            <div className="mt-3 flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" onClick={saveSubjects}>Save</button></div>
        </>}
      </Modal>
    </Page>
  );
}

function Subjects({ row, names, onEdit }: { row: Row; names: Map<string, string>; onEdit: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {row.subject_ids.map(id => <Badge key={id}>{names.get(id) ?? "?"}</Badge>)}
      <button className="text-xs text-brand-700 hover:underline" onClick={onEdit}>{row.subject_ids.length ? "Change" : "Add subjects"}</button>
    </div>
  );
}
