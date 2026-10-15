"use client";
import { useMemo, useState } from "react";
import { useApi, Page, PageHeader, Alert, Badge, Empty, Field, Loading, Modal, fmtDate } from "@/components/ui";
import { CERT_KINDS, CERT_LABEL, type CertKind } from "@/lib/sis";
import { IssueCertificate } from "@/components/sis/Achievements";

type Data = {
  items: { id: string; kind: CertKind; serial_no: string; title: string; issued_on: string; status: string; verify_token: string; revoked_reason: string | null; student: string }[];
  classes: { id: string; name: string }[];
  students: { id: string; name: string; admission_no: string; class_group_id: string | null; status: string }[];
};

/** Every certificate issued, and issuing them for a whole class at once (attendance awards, completion, participation …). */
export default function CertificatesPage() {
  const [kind, setKind] = useState("");
  const { data, error, reload } = useApi<Data>(`/api/certificates${kind ? `?kind=${kind}` : ""}`);
  const [msg, setMsg] = useState<string | null>(null);
  const [pick, setPick] = useState<{ cls: string; ids: string[]; left: boolean }>({ cls: "", ids: [], left: false });
  const [issue, setIssue] = useState<CertKind | null>(null);
  const [q, setQ] = useState("");
  const pool = useMemo(() => (data?.students ?? []).filter(s => (pick.left ? s.status !== "active" : s.status === "active") && (!pick.cls || s.class_group_id === pick.cls)), [data, pick.cls, pick.left]);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const items = data.items.filter(c => !q || `${c.student} ${c.serial_no} ${c.title}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Page wide>
      <PageHeader eyebrow="Records" title="Certificates"
        subtitle="Awards, attendance and completion certificates, transfer certificates and testimonials. Each is numbered and signed, with a QR code anyone can scan to check it is genuine." />
      {msg && <div className="mb-4"><Alert tone="green">{msg}</Alert></div>}
      <section className="card mb-5 space-y-3 p-4 text-sm">
        <h2 className="font-semibold">Issue to several students</h2>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Students"><select className="input" value={pick.left ? "left" : "current"} onChange={e => setPick({ cls: "", ids: [], left: e.target.value === "left" })}><option value="current">Current students</option><option value="left">Students who have left</option></select></Field>
          {!pick.left && <Field label="Class"><select className="input" value={pick.cls} onChange={e => setPick({ ...pick, cls: e.target.value, ids: [] })}><option value="">All classes</option>{data.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
          <button className="btn btn-outline" onClick={() => setPick({ ...pick, ids: pool.map(s => s.id) })}>Select all {pool.length}</button>
          <button className="btn btn-ghost" onClick={() => setPick({ ...pick, ids: [] })}>Clear</button>
        </div>
        <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto">{pool.map(s => {
          const on = pick.ids.includes(s.id);
          return <button key={s.id} type="button" aria-pressed={on} onClick={() => setPick({ ...pick, ids: on ? pick.ids.filter(x => x !== s.id) : [...pick.ids, s.id] })}
            className={"rounded-full border px-2 py-0.5 text-xs " + (on ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300")}>{s.name}</button>;
        })}</div>
        <div className="flex flex-wrap gap-2">{CERT_KINDS.map(k => <button key={k} className="btn btn-outline px-2 py-1 text-xs" disabled={!pick.ids.length} onClick={() => setIssue(k)}>{CERT_LABEL[k]}</button>)}</div>
        <p className="text-xs text-slate-500">For one student with an edited wording, use the student&apos;s page (Achievements &amp; certificates).</p>
      </section>
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="input w-auto" value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind"><option value="">All kinds</option>{CERT_KINDS.map(k => <option key={k} value={k}>{CERT_LABEL[k]}</option>)}</select>
        <input className="input max-w-xs" value={q} onChange={e => setQ(e.target.value)} placeholder="Search student, number or title" aria-label="Search" />
      </div>
      {!items.length ? <Empty>No certificates yet.</Empty> : (
        <ul className="card divide-y divide-slate-100 text-sm">{items.map(c => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 p-3">
            <span className="flex-1"><a className="font-medium text-brand-700 hover:underline" href={`/v/${c.verify_token}`} target="_blank" rel="noreferrer">{c.title}</a> · {c.student}
              <span className="block text-xs text-slate-500">{CERT_LABEL[c.kind]} · No. {c.serial_no} · {fmtDate(c.issued_on)}{c.revoked_reason ? ` · revoked: ${c.revoked_reason}` : ""}</span></span>
            <Badge tone={c.status === "issued" ? "green" : "red"}>{c.status}</Badge>
          </li>
        ))}</ul>
      )}
      <Modal open={Boolean(issue)} onClose={() => setIssue(null)} title={`Issue ${issue ? CERT_LABEL[issue].toLowerCase() : ""}s`} wide>
        {issue && <IssueCertificate studentIds={pick.ids} kind={issue} onDone={t => { setIssue(null); setMsg(t); setPick({ ...pick, ids: [] }); reload(); }} />}
      </Modal>
    </Page>
  );
}
