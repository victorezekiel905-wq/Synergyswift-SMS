"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Empty, Field, Loading, Modal, fmtDate } from "@/components/ui";
import ToSign from "@/components/ToSign";

type Prog = { total: number; done: number; signed: number; declined: number; waiting: string[] };
type Req = { id: string; title: string; kind: string; rule: string; status: string; due_on: string | null; created_at: string; completed_at: string | null; users: { full_name: string } | null; progress: Prog };
type Data = { admin: boolean; requests: Req[]; classes: { id: string; name: string }[]; documents: { id: string; title: string }[] };
type Detail = { request: Req & { body: string; content_hash: string; school_documents: { title: string } | null };
  signers: { id: string; name: string; signer_type: string; status: string; child: string | null; signed_at: string | null; typed_name: string | null; signature_png: string | null; decline_reason: string | null }[];
  progress: Prog; audit: string[] };
type Staff = { users: { id: string; full_name: string; role: string }[] };

const STATUS: Record<string, "green" | "amber" | "red" | "slate" | "blue"> = { open: "amber", completed: "green", cancelled: "slate", signed: "green", viewed: "blue", pending: "amber", declined: "red", not_needed: "slate" };

/** E-signatures: send forms and contracts to staff, parents or outside people; follow who has signed; keep the signed copy with its audit trail. */
export default function SignaturesPage() {
  const { data, error, reload } = useApi<Data>("/api/esign");
  const staff = useApi<Staff>("/api/report-builder");
  const [form, setForm] = useState({ title: "", kind: "form", body: "", document_id: "", due_on: "", class_group_ids: [] as string[], staff_ids: [] as string[], ext_name: "", ext_email: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const detail = useApi<Detail>(open ? `/api/esign?id=${open}` : null);
  const [busy, setBusy] = useState(false);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const staffList = ((staff.data as any)?.staff ?? []) as { id: string; full_name: string }[];
  async function act(body: Record<string, unknown>, ok: (d: any) => string) {
    setBusy(true);
    const r = await send("/api/esign", body);
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? ok(r.data) : r.error ?? "failed" });
    if (r.ok) { reload(); if (open) detail.reload(); }
    return r;
  }
  return (
    <Page wide>
      <PageHeader eyebrow="Compliance" title="E-signatures" subtitle="Send forms, consents and contracts for signature by staff, parents or people outside the school, and keep the signed copy with its audit trail." />
      <ToSign />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-5">
        <section className="card space-y-3 p-4 text-sm lg:col-span-2">
          <h2 className="font-semibold">Send something to sign</h2>
          <Field label="Title"><input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Medical consent for the museum trip" /></Field>
          <Field label="Kind"><select className="input" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}><option value="form">Form</option><option value="consent">Consent</option><option value="contract">Contract</option><option value="policy">Policy</option><option value="other">Other</option></select></Field>
          <Field label="Text to sign"><textarea className="input" rows={6} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></Field>
          <Field label="…and/or attach a document from the library"><select className="input" value={form.document_id} onChange={e => setForm({ ...form, document_id: e.target.value })}><option value="">—</option>{data.documents.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></Field>
          <Field label="Sign by (optional)"><input type="date" className="input" value={form.due_on} onChange={e => setForm({ ...form, due_on: e.target.value })} /></Field>
          <Field label="Parents of these classes (one parent per child)"><select multiple className="input h-24" value={form.class_group_ids} onChange={e => setForm({ ...form, class_group_ids: [...e.target.selectedOptions].map(o => o.value) })}>{data.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Staff"><select multiple className="input h-24" value={form.staff_ids} onChange={e => setForm({ ...form, staff_ids: [...e.target.selectedOptions].map(o => o.value) })}>{staffList.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
          {data.admin && <div className="grid grid-cols-2 gap-2"><Field label="Someone outside (name)"><input className="input" value={form.ext_name} onChange={e => setForm({ ...form, ext_name: e.target.value })} /></Field><Field label="Their email"><input className="input" type="email" value={form.ext_email} onChange={e => setForm({ ...form, ext_email: e.target.value })} /></Field></div>}
          <p className="text-xs text-slate-500">Each person gets a private link by app notification, email or WhatsApp. What is sent cannot be edited afterwards: cancel and send again instead.</p>
          <button className="btn btn-primary" disabled={busy || form.title.trim().length < 2 || (!form.body.trim() && !form.document_id)} onClick={async () => {
            const r = await act({ action: "create", title: form.title, kind: form.kind, body: form.body, document_id: form.document_id || null, due_on: form.due_on || null,
              class_group_ids: form.class_group_ids, staff_ids: form.staff_ids, external: form.ext_name && form.ext_email ? [{ name: form.ext_name, email: form.ext_email }] : [] },
              d => `Sent to ${d.signers} ${d.signers === 1 ? "person" : "people"}.${d.noContact ? ` ${d.noContact} child${d.noContact === 1 ? " has" : "ren have"} no parent contact on record.` : ""}`);
            if (r.ok) setForm({ ...form, title: "", body: "", document_id: "", class_group_ids: [], staff_ids: [], ext_name: "", ext_email: "" });
          }}>{busy ? "Sending…" : "Send"}</button>
        </section>

        <section className="lg:col-span-3">
          <h2 className="mb-2 font-semibold">Sent</h2>
          {!data.requests.length ? <Empty>Nothing sent yet.</Empty> : (
            <ul className="space-y-2">{data.requests.map(r => (
              <li key={r.id} className="card p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <button className="font-medium hover:underline" onClick={() => setOpen(r.id)}>{r.title}</button>
                  <Badge tone={STATUS[r.status]}>{r.status}</Badge>
                  <span className="text-xs text-slate-500">{r.progress.done} of {r.progress.total} {r.rule === "any_per_child" ? "children" : "people"} done{r.progress.declined ? ` · ${r.progress.declined} declined` : ""} · sent {fmtDate(r.created_at)}{r.users ? ` by ${r.users.full_name}` : ""}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><div className="h-full bg-emerald-500" style={{ width: `${r.progress.total ? (r.progress.done / r.progress.total) * 100 : 0}%` }} /></div>
                {r.status === "open" && <div className="mt-2 flex gap-3 text-xs">
                  <button className="text-brand-700 hover:underline" onClick={() => act({ action: "remind", id: r.id }, d => `Reminded ${d.reminded}.`)}>Remind those waiting</button>
                  <button className="text-rose-600 hover:underline" onClick={() => confirm("Cancel this request? Signatures already given are kept.") && act({ action: "cancel", id: r.id }, () => "Cancelled.")}>Cancel</button>
                </div>}
              </li>))}</ul>
          )}
        </section>
      </div>

      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={detail.data?.request.title ?? "Request"} wide>
        {!detail.data ? <Loading /> : (
          <div className="space-y-4 text-sm">
            {detail.data.request.body && <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-slate-200 p-3">{detail.data.request.body}</div>}
            {detail.data.request.school_documents && <p>Attached: {detail.data.request.school_documents.title}</p>}
            <table className="w-full text-xs">
              <thead className="text-slate-500"><tr><th className="p-1 text-left">Signer</th><th className="p-1">Status</th><th className="p-1">Signed</th><th className="p-1">Signature</th></tr></thead>
              <tbody>{detail.data.signers.map(s => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="p-1">{s.name}{s.child ? ` (for ${s.child})` : ""} <span className="text-slate-400">{s.signer_type}</span></td>
                  <td className="p-1 text-center"><Badge tone={STATUS[s.status]}>{s.status.replace("_", " ")}</Badge>{s.decline_reason && <div className="text-[10px] text-rose-600">{s.decline_reason}</div>}</td>
                  <td className="p-1 text-center">{s.signed_at ? fmtDate(s.signed_at, true) : ""}</td>
                  <td className="p-1 text-center">{s.signature_png
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={s.signature_png} alt={`Signature of ${s.typed_name}`} className="mx-auto h-8" /> : s.typed_name ? <span className="italic">{s.typed_name}</span> : ""}</td>
                </tr>))}</tbody>
            </table>
            <div className="rounded bg-slate-50 p-3 font-mono text-[11px] leading-relaxed">{detail.data.audit.map((l, i) => <div key={i}>{l}</div>)}</div>
            <button className="btn btn-outline px-3 py-1 text-xs" onClick={() => window.print()}>Print signed copy</button>
          </div>
        )}
      </Modal>
    </Page>
  );
}
