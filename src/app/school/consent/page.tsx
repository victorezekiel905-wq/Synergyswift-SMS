"use client";
import { useEffect, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Field, Loading, Modal } from "@/components/ui";

type Purpose = { id: string; key: string; title: string; description: string; per_child: boolean; required: boolean; version: number; active: boolean; position: number };
type Cov = { id: string; title: string; per_child: boolean; required: boolean; total: number; granted: number; declined: number; outdated: number; missing: number };
type Data = {
  purposes: Purpose[]; privacy_notice: string; privacy_notice_version: number; coverage: Cov[];
  list: { id: string; name: string; admission_no: string; class_name: string | null; state: string }[] | null;
  child: { id: string; name: string; items: { purpose_id: string; title: string; state: string }[] } | null;
  students: { id: string; name: string; admission_no: string }[];
};
const TONE: Record<string, "green" | "red" | "amber" | "slate"> = { granted: "green", declined: "red", outdated: "amber", missing: "slate" };

/** The permissions the school asks families for, who has answered, and the privacy notice. */
export default function ConsentPage() {
  const [purpose, setPurpose] = useState("");
  const [student, setStudent] = useState("");
  const { data, error, reload } = useApi<Data>(`/api/consent?${new URLSearchParams({ ...(purpose ? { purpose } : {}), ...(student ? { student } : {}) })}`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [edit, setEdit] = useState<Partial<Purpose> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { if (data && notice === null) setNotice(data.privacy_notice); }, [data, notice]);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await send<any>("/api/consent", body);
    setMsg({ ok: r.ok, text: r.ok ? (r.data?.reasked ? `${ok} The wording changed, so families will be asked again.` : ok) : r.error ?? "failed" });
    if (r.ok) reload();
    return r.ok;
  };
  const found = q.trim().length >= 2 ? data.students.filter(s => `${s.name} ${s.admission_no}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
  return (
    <Page wide>
      <PageHeader eyebrow="Administration" title="Consent & privacy"
        subtitle="What families agree to, for each child: kept as a dated record of who answered, how and to which wording (Nigeria's NDPA 2023 and GDPR). Parents answer in their portal and can change their minds at any time." />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <section className="card mb-5 overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Permission</th><th className="p-2 text-right">Yes</th><th className="p-2 text-right">No</th><th className="p-2 text-right">Needs answer</th><th className="p-2" /></tr></thead>
          <tbody className="divide-y divide-slate-100">{data.coverage.map(c => (
            <tr key={c.id}>
              <td className="p-2"><b>{c.title}</b> {c.required && <Badge>needed</Badge>}<span className="block text-xs text-slate-500">{c.per_child ? `${c.total} children` : `${c.total} families`}</span></td>
              <td className="p-2 text-right tabular-nums text-emerald-700">{c.granted}</td>
              <td className="p-2 text-right tabular-nums text-rose-700">{c.declined}</td>
              <td className="p-2 text-right tabular-nums text-amber-700">{c.missing + c.outdated}</td>
              <td className="p-2 text-right">{c.per_child && <button className="text-xs text-brand-700" onClick={() => setPurpose(purpose === c.id ? "" : c.id)}>{purpose === c.id ? "Hide list" : "Children"}</button>}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
      {data.list && (
        <section className="card mb-5 p-4 text-sm">
          <h2 className="mb-2 font-semibold">{data.coverage.find(c => c.id === purpose)?.title}</h2>
          <ul className="grid max-h-96 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{data.list.map(s => (
            <li key={s.id} className="flex items-center gap-2"><Badge tone={TONE[s.state]}>{s.state === "granted" ? "yes" : s.state === "declined" ? "no" : "?"}</Badge> {s.name} <span className="text-xs text-slate-500">{s.class_name ?? ""}</span></li>
          ))}</ul>
          <button className="mt-2 text-xs text-brand-700" onClick={() => window.print()}>Print this list</button>
        </section>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-3 p-4 text-sm">
          <div className="flex items-center"><h2 className="mr-auto font-semibold">Permissions you ask for</h2><button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setEdit({ title: "", description: "", per_child: true, required: false, active: true, position: data.purposes.length + 1 })}>Add</button></div>
          <ul className="divide-y divide-slate-100">{data.purposes.map(p => (
            <li key={p.id} className={"py-2 " + (p.active ? "" : "opacity-50")}>
              <p className="flex items-center gap-2"><b className="flex-1">{p.title}</b><span className="text-xs text-slate-500">v{p.version}{p.per_child ? " · per child" : " · per family"}{p.active ? "" : " · off"}</span>
                <button className="text-xs text-brand-700" onClick={() => setEdit(p)}>Edit</button></p>
              <p className="text-xs text-slate-600">{p.description}</p>
            </li>
          ))}</ul>
        </section>
        <section className="card space-y-3 p-4 text-sm">
          <h2 className="font-semibold">Record a paper form or phone answer</h2>
          <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a child by name or admission number" aria-label="Find a child" />
          {found.length > 0 && <ul>{found.map(s => <li key={s.id}><button className="text-brand-700" onClick={() => { setStudent(s.id); setQ(""); }}>{s.name} <span className="text-xs text-slate-500">{s.admission_no}</span></button></li>)}</ul>}
          {data.child && (
            <div>
              <p className="mb-1 font-medium">{data.child.name}</p>
              <ul className="space-y-1">{data.child.items.map(i => (
                <li key={i.purpose_id} className="flex flex-wrap items-center gap-2"><span className="flex-1">{i.title}</span><Badge tone={TONE[i.state]}>{i.state}</Badge>
                  <button className="text-xs text-emerald-700" onClick={() => act({ action: "record", purpose_id: i.purpose_id, student_id: data.child!.id, granted: true, method: "paper" }, "Recorded: yes (paper form).")}>Yes</button>
                  <button className="text-xs text-rose-700" onClick={() => act({ action: "record", purpose_id: i.purpose_id, student_id: data.child!.id, granted: false, method: "paper" }, "Recorded: no (paper form).")}>No</button></li>
              ))}</ul>
            </div>
          )}
          <h2 className="pt-2 font-semibold">Privacy notice</h2>
          <p className="text-xs text-slate-600">Shown to parents beside the permissions. Say what you collect, why, who you share it with, how long you keep it, and how to ask for a copy or a correction.</p>
          <textarea className="input min-h-40 text-xs" value={notice ?? ""} onChange={e => setNotice(e.target.value)} maxLength={20000} aria-label="Privacy notice" />
          <button className="btn btn-primary" onClick={() => act({ action: "notice", text: notice ?? "" }, "Privacy notice saved.")}>Save notice</button>
        </section>
      </div>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit permission" : "Add permission"}>
        {edit && (
          <form className="space-y-3 text-sm" onSubmit={async e => { e.preventDefault(); if (await act({ action: "purpose", id: edit.id ?? null, title: edit.title, description: edit.description ?? "", per_child: Boolean(edit.per_child), required: Boolean(edit.required), active: edit.active !== false, position: edit.position ?? 0 }, "Saved.")) setEdit(null); }}>
            <Field label="Title"><input className="input" value={edit.title ?? ""} onChange={e => setEdit({ ...edit, title: e.target.value })} required minLength={2} maxLength={120} /></Field>
            <Field label="What families agree to" hint="Changing the wording asks every family again."><textarea className="input min-h-24" value={edit.description ?? ""} onChange={e => setEdit({ ...edit, description: e.target.value })} maxLength={2000} /></Field>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1"><input type="checkbox" checked={Boolean(edit.per_child)} onChange={e => setEdit({ ...edit, per_child: e.target.checked })} disabled={Boolean(edit.id)} /> Ask for each child</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={Boolean(edit.required)} onChange={e => setEdit({ ...edit, required: e.target.checked })} /> Needed to run the child&apos;s place (acknowledge only)</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={edit.active !== false} onChange={e => setEdit({ ...edit, active: e.target.checked })} /> Asked</label>
            </div>
            <button className="btn btn-primary">Save</button>
          </form>
        )}
      </Modal>
    </Page>
  );
}
