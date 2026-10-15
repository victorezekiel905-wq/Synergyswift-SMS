"use client";
import { useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field, Loading, fmtDate } from "@/components/ui";

type Doc = { id: string; kind: string; name: string; size: number | null; notes: string | null; shared_with_family: boolean; confidential: boolean; created_at: string; users: { full_name: string } | null };
type Data = { items: Doc[]; from_application: { application_no: string; documents: { id: string; kind: string; name: string; uploaded_at: string }[] } | null; can_manage: boolean };
export const DOC_KIND: Record<string, string> = {
  birth_certificate: "Birth certificate", passport_photo: "Passport photo", previous_report: "Previous school report", transfer_letter: "Transfer letter", medical: "Medical",
  immunisation: "Immunisation record", id_document: "ID document", court_order: "Court order", sen_report: "SEN / specialist report", certificate: "Certificate", agreement: "Signed agreement", other: "Other"
};
const kb = (n: number | null) => (n ? (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.round(n / 1000)} KB`) : "");

/** A student's papers: uploaded privately, opened with short-lived links, some shared with the family. */
export default function Documents({ studentId }: { studentId: string }) {
  const { data, error, reload } = useApi<Data>(`/api/sis/${studentId}/documents`);
  const [kind, setKind] = useState("birth_certificate");
  const [notes, setNotes] = useState("");
  const [shared, setShared] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const say = (ok: boolean, text: string) => { setMsg({ ok, text }); if (ok) reload(); };
  const have = new Set(data.items.map(d => d.name));
  return (
    <div className="space-y-4 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {data.can_manage && (
        <form className="card grid gap-3 p-4 sm:grid-cols-4" onSubmit={async e => {
          e.preventDefault();
          const file = (e.currentTarget.elements.namedItem("file") as HTMLInputElement).files?.[0];
          if (!file) return;
          const fd = new FormData();
          fd.set("file", file); fd.set("kind", kind); fd.set("notes", notes); fd.set("shared", String(shared));
          setBusy(true);
          const r = await fetch(`/api/sis/${studentId}/documents`, { method: "POST", body: fd });
          const j = await r.json().catch(() => ({}));
          setBusy(false);
          say(r.ok, r.ok ? "Uploaded." : j.error ?? "upload failed");
          if (r.ok) { (e.target as HTMLFormElement).reset(); setNotes(""); }
        }}>
          <Field label="What is it?"><select className="input" value={kind} onChange={e => setKind(e.target.value)}>{Object.entries(DOC_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="File" hint="PDF or photo, up to 10 MB"><input className="input" name="file" type="file" accept="application/pdf,image/*" required /></Field>
          <Field label="Note"><input className="input" value={notes} onChange={e => setNotes(e.target.value)} maxLength={300} /></Field>
          <div className="flex flex-col justify-end gap-2">
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} disabled={["court_order", "sen_report", "medical"].includes(kind)} /> Family can see it</label>
            <button className="btn btn-primary" disabled={busy}>{busy ? "Uploading…" : "Upload"}</button>
          </div>
          <p className="text-xs text-slate-500 sm:col-span-4">Medical, SEN reports and court orders are confidential: only admins, counsellors and the nurse can open them.</p>
        </form>
      )}
      {!data.items.length ? <Empty>No documents yet.</Empty> : (
        <ul className="card divide-y divide-slate-100">{data.items.map(d => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 p-3">
            <span className="min-w-56 flex-1"><a className="font-medium text-brand-700 hover:underline" href={`/api/sis/${studentId}/documents?open=${d.id}`} target="_blank" rel="noreferrer">{d.name}</a>
              <span className="block text-xs text-slate-500">{DOC_KIND[d.kind] ?? d.kind} · {kb(d.size)} · {fmtDate(d.created_at)}{d.users ? ` · ${d.users.full_name}` : ""}{d.notes ? ` · ${d.notes}` : ""}</span></span>
            {d.confidential && <Badge tone="red">confidential</Badge>}
            {d.shared_with_family && <Badge tone="green">family can see</Badge>}
            {data.can_manage && !d.confidential && <button className="text-xs text-brand-700" onClick={async () => { const r = await send(`/api/sis/${studentId}/documents`, { id: d.id, shared_with_family: !d.shared_with_family }, "PATCH"); say(r.ok, r.ok ? "Updated." : r.error ?? "failed"); }}>{d.shared_with_family ? "Hide from family" : "Share with family"}</button>}
            {data.can_manage && <button className="text-xs text-rose-600" onClick={async () => { if (!confirm(`Delete ${d.name}?`)) return; const r = await send(`/api/sis/${studentId}/documents?doc=${d.id}`, undefined, "DELETE"); say(r.ok, r.ok ? "Deleted." : r.error ?? "only admins can delete documents"); }}>Delete</button>}
          </li>
        ))}</ul>
      )}
      {data.from_application && data.from_application.documents.length > 0 && (
        <section className="card p-4">
          <h3 className="mb-1 font-semibold">From the admissions application {data.from_application.application_no}</h3>
          <ul className="space-y-1">{data.from_application.documents.map(d => (
            <li key={d.id} className="flex items-center gap-2"><span className="flex-1">{d.name} <span className="text-xs text-slate-500">{DOC_KIND[d.kind] ?? d.kind}</span></span>
              {have.has(d.name) ? <Badge tone="green">on file</Badge> : <button className="text-xs text-brand-700" onClick={async () => { const r = await send(`/api/sis/${studentId}/documents`, { copy_application_document: d.id }); say(r.ok, r.ok ? "Added to the student's documents." : r.error ?? "failed"); }}>Keep on file</button>}</li>
          ))}</ul>
        </section>
      )}
    </div>
  );
}
