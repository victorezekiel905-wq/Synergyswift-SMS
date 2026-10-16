"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Tabs, Alert, Badge, Empty, Field, Loading, fmtDate, rolesOf, type Me } from "@/components/ui";
import { CHECKS, type Framework, type DocAlert } from "@/lib/compliance";

type Doc = { id: string; family_id: string; version: number; title: string; category: string; description: string | null; path: string | null; visibility: string; status: string;
  approved_at: string | null; review_due_on: string | null; expires_on: string | null; issued_by: string | null; reference_no: string | null; tags: string[]; requires_ack: boolean; updated_at: string; users: { full_name: string } | null };
type Library = { manager: boolean; documents: Doc[]; my_acks: { document_id: string; acknowledged_at: string }[]; acks: Record<string, number>; staff_count: number; alerts: DocAlert[] };
type Tab = "library" | "read" | "scr" | "inspection";
const CATS = ["policy", "certificate", "inspection", "minutes", "risk_assessment", "procedure", "report", "plan", "other"];
const label = (s: string) => s.replace(/_/g, " ");

export default function CompliancePage() {
  const me = useApi<Me>("/api/me");
  const roles = rolesOf(me.data);
  const hr = ["hr_manager", "school_admin", "principal", "platform_admin"].some(r => roles.has(r));
  const [tab, setTab] = useState<Tab>("library");
  useEffect(() => { const t = new URLSearchParams(window.location.search).get("tab"); if (t && ["library", "read", "scr", "inspection"].includes(t)) setTab(t as Tab); }, []);
  const tabs = [{ id: "library" as const, label: "Document library" }, { id: "read" as const, label: "Policies to read" }, ...(hr ? [{ id: "scr" as const, label: "Single central record" }] : []), { id: "inspection" as const, label: "Inspection readiness" }];
  return (
    <Page wide>
      <PageHeader eyebrow="Compliance" title="Policies, certificates & inspections" subtitle="Keep every policy and certificate current, know who has read what, keep the single central record, and get ready for inspection." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === "library" && <LibraryTab />}
        {tab === "read" && <ReadTab />}
        {tab === "scr" && hr && <ScrTab />}
        {tab === "inspection" && <InspectionTab />}
      </div>
    </Page>
  );
}

function LibraryTab() {
  const { data, error, reload } = useApi<Library>("/api/compliance");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cat, setCat] = useState("");
  const [newVersionOf, setNewVersionOf] = useState<Doc | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  async function act(body: Record<string, unknown>, ok: string) {
    const r = await send("/api/compliance", body);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) reload();
  }
  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (newVersionOf) fd.set("family_id", newVersionOf.family_id);
    ["requires_ack", "approve"].forEach(k => fd.set(k, fd.get(k) ? "true" : "false"));
    setBusy(true);
    const r = await fetch("/api/compliance", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? `Saved${j.version > 1 ? ` as version ${j.version}` : ""}.` : j.error ?? "failed" });
    if (r.ok) { (e.target as HTMLFormElement).reset(); setNewVersionOf(null); reload(); }
  }
  const docs = data.documents.filter(d => !cat || d.category === cat);
  return (
    <div className="space-y-5">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {data.alerts.length > 0 && (
        <section className="card border-amber-200 bg-amber-50/50 p-4 text-sm">
          <h2 className="mb-2 font-semibold">Needs attention</h2>
          <ul className="space-y-1">{data.alerts.map(a => (
            <li key={`${a.id}${a.kind}`}><b>{a.title}</b>: {a.kind === "review_overdue" ? `review overdue since ${fmtDate(a.date)}` : a.kind === "review_soon" ? `review due ${fmtDate(a.date)}` : a.kind === "expired" ? `expired ${fmtDate(a.date)}` : `expires ${fmtDate(a.date)}`}</li>))}</ul>
        </section>
      )}
      {data.manager && (
        <form onSubmit={upload} className="card space-y-3 p-4 text-sm">
          <h2 className="font-semibold">{newVersionOf ? `New version of “${newVersionOf.title}”` : "Add a document"}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Title"><input name="title" className="input" defaultValue={newVersionOf?.title ?? ""} key={newVersionOf?.id ?? "new"} required /></Field>
            <Field label="Category"><select name="category" className="input" defaultValue={newVersionOf?.category ?? "policy"} key={`c${newVersionOf?.id}`}>{CATS.map(c => <option key={c} value={c}>{label(c)}</option>)}</select></Field>
            <Field label="Who can see it"><select name="visibility" className="input" defaultValue={newVersionOf?.visibility ?? "staff"} key={`v${newVersionOf?.id}`}><option value="leaders">Leaders only</option><option value="staff">All staff</option><option value="parents">Staff and parents</option></select></Field>
            <Field label="File (PDF, Word, Excel, image; 20 MB)"><input name="file" type="file" className="input" /></Field>
            <Field label="Next review (policies)"><input name="review_due_on" type="date" className="input" /></Field>
            <Field label="Expires (certificates)"><input name="expires_on" type="date" className="input" /></Field>
            <Field label="Issued by"><input name="issued_by" className="input" defaultValue={newVersionOf?.issued_by ?? ""} key={`i${newVersionOf?.id}`} /></Field>
            <Field label="Reference no."><input name="reference_no" className="input" /></Field>
          </div>
          <Field label="Tags (comma separated, e.g. safeguarding, fire)"><input name="tags" className="input" defaultValue={newVersionOf?.tags.join(", ") ?? ""} key={`t${newVersionOf?.id}`} /></Field>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2"><input type="checkbox" name="requires_ack" defaultChecked={newVersionOf?.requires_ack ?? false} key={`r${newVersionOf?.id}`} /> Staff must read and confirm</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="approve" /> Approve now (admins)</label>
          </div>
          <div className="flex gap-2"><button className="btn btn-primary" disabled={busy}>{busy ? "Uploading…" : "Save"}</button>{newVersionOf && <button type="button" className="btn btn-ghost" onClick={() => setNewVersionOf(null)}>Cancel</button>}</div>
        </form>
      )}
      <div className="flex flex-wrap gap-1.5">{["", ...CATS].map(c => <button key={c} onClick={() => setCat(c)} className={`rounded-full border px-2.5 py-1 text-xs capitalize ${cat === c ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>{c ? label(c) : "All"}</button>)}</div>
      {!docs.length ? <Empty>No documents yet.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-2 text-left">Document</th><th className="p-2 text-left">Category</th><th className="p-2">Status</th><th className="p-2">Review / expiry</th>{data.manager && <th className="p-2">Read by</th>}<th className="p-2"></th></tr></thead>
          <tbody>{docs.map(d => (
            <tr key={d.id} className={`border-t border-slate-100 ${d.status === "superseded" ? "text-slate-400" : ""}`}>
              <td className="p-2"><span className="font-medium">{d.title}</span> <span className="text-xs text-slate-500">v{d.version}{d.visibility !== "staff" ? ` · ${d.visibility === "leaders" ? "leaders only" : "parents can see"}` : ""}</span>
                {d.issued_by && <div className="text-xs text-slate-500">{d.issued_by}{d.reference_no ? ` · ${d.reference_no}` : ""}</div>}</td>
              <td className="p-2 capitalize">{label(d.category)}</td>
              <td className="p-2 text-center"><Badge tone={d.status === "approved" ? "green" : d.status === "draft" ? "amber" : "slate"}>{d.status}</Badge></td>
              <td className="p-2 text-center text-xs">{d.review_due_on ? `review ${fmtDate(d.review_due_on)}` : ""}{d.expires_on ? `expires ${fmtDate(d.expires_on)}` : ""}</td>
              {data.manager && <td className="p-2 text-center text-xs">{d.requires_ack && d.status === "approved" ? `${data.acks[d.id] ?? 0} of ${data.staff_count}` : ""}</td>}
              <td className="p-2 text-right text-xs"><span className="flex flex-wrap justify-end gap-2">
                {d.path && <a className="text-brand-700 hover:underline" href={`/api/compliance?file=${d.id}`} target="_blank" rel="noreferrer">Open</a>}
                {data.manager && d.status === "draft" && <button className="text-brand-700 hover:underline" onClick={() => act({ action: "approve", id: d.id }, "Approved.")}>Approve</button>}
                {data.manager && d.status === "approved" && <button className="text-brand-700 hover:underline" onClick={() => { setNewVersionOf(d); window.scrollTo({ top: 0, behavior: "smooth" }); }}>New version</button>}
                {data.manager && d.status === "approved" && <button className="text-slate-600 hover:underline" onClick={() => act({ action: "archive", id: d.id }, "Archived.")}>Archive</button>}
                {data.manager && d.status === "draft" && <button className="text-rose-600 hover:underline" onClick={() => confirm("Delete this draft?") && act({ action: "delete_draft", id: d.id }, "Deleted.")}>Delete</button>}
              </span></td>
            </tr>))}</tbody></table></div>
      )}
    </div>
  );
}

function ReadTab() {
  const { data, reload } = useApi<Library>("/api/compliance");
  if (!data) return <Loading />;
  const done = new Map(data.my_acks.map(a => [a.document_id, a.acknowledged_at]));
  const todo = data.documents.filter(d => d.requires_ack && d.status === "approved");
  if (!todo.length) return <Empty>No policies need your confirmation.</Empty>;
  return (
    <ul className="space-y-2">{todo.map(d => (
      <li key={d.id} className="card flex flex-wrap items-center gap-3 p-3 text-sm">
        <span className="flex-1"><b>{d.title}</b> <span className="text-xs text-slate-500">version {d.version}</span></span>
        {d.path && <a className="text-brand-700 underline" href={`/api/compliance?file=${d.id}`} target="_blank" rel="noreferrer">Read</a>}
        {done.has(d.id) ? <Badge tone="green">confirmed {fmtDate(done.get(d.id)!)}</Badge>
          : <button className="btn btn-primary px-3 py-1 text-xs" onClick={async () => { const r = await send("/api/compliance", { action: "acknowledge", id: d.id }); if (r.ok) reload(); }}>I have read and understood it</button>}
      </li>))}</ul>
  );
}

type Scr = { matrix: { staff_id: string; name: string; cells: Record<string, string>; complete: boolean; gaps: string[] }[]; staff: { id: string; full_name: string }[];
  checks: { id: string; staff_id: string; kind: string; outcome: string; checked_on: string | null; expires_on: string | null; reference_no: string | null; notes: string | null; users: { full_name: string } | null }[] };
const CELL: Record<string, [string, string]> = { clear: ["bg-emerald-100 text-emerald-800", "✓"], expired: ["bg-rose-100 text-rose-800", "expired"], pending: ["bg-amber-100 text-amber-800", "pending"],
  concern: ["bg-rose-200 text-rose-900", "concern"], missing: ["bg-slate-100 text-slate-500", "—"], not_required: ["bg-slate-50 text-slate-400", "n/a"] };

function ScrTab() {
  const { data, error, reload } = useApi<Scr>("/api/compliance?view=scr");
  const [form, setForm] = useState({ staff_id: "", kind: "police_check", outcome: "clear", checked_on: "", expires_on: "", reference_no: "", notes: "" });
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const complete = data.matrix.filter(m => m.complete).length;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{complete} of {data.matrix.length} staff have every required check recorded and clear. <button className="text-brand-700 underline" onClick={() => window.print()}>Print the record</button></p>
      <div className="card overflow-x-auto"><table className="w-full text-xs">
        <thead className="bg-slate-50"><tr><th className="p-2 text-left">Staff</th>{CHECKS.map(c => <th key={c.kind} className="p-2">{c.label}{c.required ? "" : "*"}</th>)}</tr></thead>
        <tbody>{data.matrix.map(m => (
          <tr key={m.staff_id} className="border-t border-slate-100"><td className="p-2"><button className="font-medium hover:underline" onClick={() => setForm({ ...form, staff_id: m.staff_id })}>{m.name}</button>{!m.complete && <div className="text-[10px] text-rose-600">missing: {m.gaps.join(", ")}</div>}</td>
            {CHECKS.map(c => { const [cls, txt] = CELL[m.cells[c.kind]] ?? CELL.missing; return <td key={c.kind} className="p-1 text-center"><span className={`inline-block rounded px-1.5 py-0.5 ${cls}`}>{txt}</span></td>; })}
          </tr>))}</tbody></table>
        <p className="p-2 text-[10px] text-slate-500">* not needed for everyone (e.g. overseas checks only for staff who lived abroad).</p></div>
      <section className="card space-y-3 p-4 text-sm print:hidden">
        <h2 className="font-semibold">Record a check</h2>
        {msg && <Alert tone="green">{msg}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Staff"><select className="input" value={form.staff_id} onChange={e => setForm({ ...form, staff_id: e.target.value })}><option value="">Choose…</option>{data.staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
          <Field label="Check"><select className="input" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{CHECKS.map(c => <option key={c.kind} value={c.kind}>{c.label}</option>)}</select></Field>
          <Field label="Outcome"><select className="input" value={form.outcome} onChange={e => setForm({ ...form, outcome: e.target.value })}><option value="clear">Clear</option><option value="pending">Pending</option><option value="concern">Concern (see notes)</option><option value="not_required">Not required</option></select></Field>
          <Field label="Checked on"><input type="date" className="input" value={form.checked_on} onChange={e => setForm({ ...form, checked_on: e.target.value })} /></Field>
          <Field label="Valid until"><input type="date" className="input" value={form.expires_on} onChange={e => setForm({ ...form, expires_on: e.target.value })} /></Field>
          <Field label="Reference / certificate no."><input className="input" value={form.reference_no} onChange={e => setForm({ ...form, reference_no: e.target.value })} /></Field>
          <Field label="Notes"><input className="input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
        <button className="btn btn-primary" disabled={!form.staff_id} onClick={async () => { const r = await send("/api/compliance", { action: "save_check", ...form }); setMsg(r.ok ? "Check recorded." : r.error); if (r.ok) reload(); }}>Save check</button>
        {form.staff_id && (
          <ul className="divide-y divide-slate-100 text-xs">{data.checks.filter(c => c.staff_id === form.staff_id).map(c => (
            <li key={c.id} className="flex flex-wrap gap-2 py-1"><span className="w-36">{CHECKS.find(x => x.kind === c.kind)?.label ?? c.kind}</span><span>{c.outcome}</span><span>{c.checked_on ? fmtDate(c.checked_on) : ""}{c.expires_on ? ` → ${fmtDate(c.expires_on)}` : ""}</span>
              <span className="text-slate-500">{c.reference_no ?? ""} {c.users ? `· by ${c.users.full_name}` : ""} {c.notes ?? ""}</span>
              <button className="ml-auto text-rose-600" onClick={async () => { if (confirm("Delete this check?")) { await send("/api/compliance", { action: "delete_check", id: c.id }); reload(); } }}>delete</button></li>))}</ul>
        )}
      </section>
    </div>
  );
}

type Insp = { manager: boolean; me: string; chosen: string[]; frameworks: (Framework & { readiness: { applicable: number; met: number; in_progress: number; pct: number | null; areas: { id: string; pct: number | null; met: number; applicable: number }[] } })[];
  progress: { framework: string; requirement_key: string; status: string; owner_id: string | null; notes: string | null; document_ids: string[]; review_on: string | null }[];
  documents: { id: string; title: string; status: string }[]; staff: { id: string; full_name: string }[] };
const ST: Record<string, ["green" | "amber" | "slate" | "blue", string]> = { met: ["green", "met"], in_progress: ["amber", "in progress"], not_started: ["slate", "not started"], not_applicable: ["blue", "not applicable"] };

function InspectionTab() {
  const { data, error, reload } = useApi<Insp>("/api/compliance?view=inspection");
  const [fw, setFw] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState({ status: "not_started", owner_id: "", notes: "", document_ids: [] as string[], review_on: "" });
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const shown = data.frameworks.filter(f => !data.chosen.length || data.chosen.includes(f.id));
  const f = shown.find(x => x.id === fw) ?? shown[0];
  const prog = (key: string) => data.progress.find(p => p.framework === f?.id && p.requirement_key === key);
  const docName = (id: string) => data.documents.find(d => d.id === id)?.title ?? "document";
  const canEdit = (key: string) => data.manager || prog(key)?.owner_id === data.me;
  return (
    <div className="space-y-4">
      {data.manager && (
        <details className="card p-3 text-sm print:hidden"><summary className="cursor-pointer font-medium">Which frameworks does the school follow?</summary>
          <div className="mt-2 flex flex-wrap gap-3">{data.frameworks.map(x => (
            <label key={x.id} className="flex items-center gap-2"><input type="checkbox" checked={data.chosen.includes(x.id)} onChange={async e => {
              const ids = e.target.checked ? [...data.chosen, x.id] : data.chosen.filter(i => i !== x.id); await send("/api/compliance", { action: "set_frameworks", ids }); reload(); }} />{x.name}</label>))}</div>
        </details>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 print:hidden">{shown.map(x => (
        <button key={x.id} onClick={() => setFw(x.id)} className={`card p-3 text-left ${f?.id === x.id ? "ring-2 ring-brand-300" : ""}`}>
          <p className="text-xs uppercase text-slate-500">{x.short}</p><p className="text-2xl font-bold">{x.readiness.pct ?? 0}%</p><p className="text-xs text-slate-500">{x.readiness.met} of {x.readiness.applicable} met</p>
        </button>))}</div>
      {f && <>
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">{f.name}</h2><button className="btn btn-outline px-2 py-1 text-xs print:hidden" onClick={() => window.print()}>Print inspection pack</button></div>
        <p className="text-sm text-slate-600">{f.note} These lists summarise the published framework to help organise evidence. Check them against the current official documents.</p>
        {f.areas.map(a => { const r = f.readiness.areas.find(x => x.id === a.id); return (
          <section key={a.id} className="card break-inside-avoid">
            <div className="flex items-center justify-between border-b border-slate-100 p-3"><h3 className="font-semibold">{a.title}</h3><span className="text-xs text-slate-500">{r?.met ?? 0} of {r?.applicable ?? 0} met</span></div>
            <ul className="divide-y divide-slate-100">{a.items.map(i => { const p = prog(i.key); const [tone, txt] = ST[p?.status ?? "not_started"]; return (
              <li key={i.key} className="p-3 text-sm">
                <div className="flex flex-wrap items-start gap-2">
                  <span className="flex-1"><b>{i.text}</b><br /><span className="text-xs text-slate-500">Evidence: {i.evidence}{i.href ? <> · <Link className="text-brand-700 underline print:no-underline" href={i.href}>open</Link></> : null}</span></span>
                  <Badge tone={tone}>{txt}</Badge>
                  {canEdit(i.key) && <button className="text-xs text-brand-700 hover:underline print:hidden" onClick={() => { setEdit(edit === i.key ? null : i.key); setDraft({ status: p?.status ?? "not_started", owner_id: p?.owner_id ?? "", notes: p?.notes ?? "", document_ids: p?.document_ids ?? [], review_on: p?.review_on ?? "" }); }}>{edit === i.key ? "Close" : "Update"}</button>}
                </div>
                {(p?.notes || p?.document_ids?.length || p?.owner_id) && edit !== i.key && (
                  <p className="mt-1 text-xs text-slate-600">{p.owner_id ? `Owner: ${data.staff.find(s => s.id === p.owner_id)?.full_name ?? ""}. ` : ""}{p.notes ?? ""}{p.document_ids?.length ? ` Documents: ${p.document_ids.map(docName).join(", ")}.` : ""}</p>
                )}
                {edit === i.key && (
                  <div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2 print:hidden">
                    <Field label="Status"><select className="input" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v[1]}</option>)}</select></Field>
                    <Field label="Owner"><select className="input" value={draft.owner_id} disabled={!data.manager} onChange={e => setDraft({ ...draft, owner_id: e.target.value })}><option value="">—</option>{data.staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
                    <Field label="Notes"><textarea className="input" rows={2} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></Field>
                    <Field label="Supporting documents"><select multiple className="input h-24" value={draft.document_ids} onChange={e => setDraft({ ...draft, document_ids: [...e.target.selectedOptions].map(o => o.value) })}>{data.documents.map(d => <option key={d.id} value={d.id}>{d.title}{d.status === "draft" ? " (draft)" : ""}</option>)}</select></Field>
                    <Field label="Look at it again on"><input type="date" className="input" value={draft.review_on} onChange={e => setDraft({ ...draft, review_on: e.target.value })} /></Field>
                    <div className="flex items-end"><button className="btn btn-primary" onClick={async () => { const r = await send("/api/compliance", { action: "save_progress", framework: f.id, requirement_key: i.key, ...draft, owner_id: draft.owner_id || null }); if (r.ok) { setEdit(null); reload(); } }}>Save</button></div>
                  </div>
                )}
              </li>); })}</ul>
          </section>); })}
      </>}
    </div>
  );
}
