"use client";
import { useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field, Loading, Modal, fmtDate } from "@/components/ui";
import { CERT_LABEL, CERT_KINDS, type CertKind } from "@/lib/sis";
import { Targets, type TargetRow } from "@/components/portfolio/Portfolio";

type Achievement = { id: string; kind: string; title: string; description: string | null; level: string; award: string | null; achieved_on: string; shared_with_family: boolean; recorded_by: string; users: { full_name: string } | null;
  status?: string; source?: string; photo?: string | null };
type Item = { id: string; title: string; description: string | null; kind: string; path: string | null; link_url: string | null; status: string; feedback: string | null; shared_with_family: boolean; created_at: string; subjects: { name: string } | null; users: { full_name: string } | null };
type Cert = { id: string; kind: CertKind; serial_no: string; title: string; issued_on: string; status: string; verify_token: string; revoked_reason: string | null };
type Data = { achievements: Achievement[]; portfolio: Item[]; certificates: Cert[]; subjects: { id: string; name: string }[]; me: string;
  transcript_allowed?: boolean; transcript_allowed_at?: string | null; can_release?: boolean };
export const ACH_KIND: Record<string, string> = { academic: "Academic", sports: "Sports", arts: "Arts", leadership: "Leadership / position", service: "Service", competition: "Competition", attendance: "Attendance", character: "Character", other: "Other" };
const LEVELS = ["class", "school", "local", "state", "national", "international"];

/** Awards and positions, pieces of work, and certificates for one student. */
export default function Achievements({ studentId, admin }: { studentId: string; admin: boolean }) {
  const { data, error, reload } = useApi<Data>(`/api/sis/${studentId}/achievements`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [a, setA] = useState({ kind: "academic", title: "", award: "", level: "school", achieved_on: new Date().toISOString().slice(0, 10), description: "", shared_with_family: true });
  const [work, setWork] = useState({ title: "", kind: "work", subject_id: "", link_url: "", description: "" });
  const [cert, setCert] = useState<{ kind: CertKind; achievement_id?: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await send(`/api/sis/${studentId}/achievements`, body);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) reload();
    return r.ok;
  };
  const pending = data.portfolio.filter(p => p.status === "submitted");
  const toVerify = data.achievements.filter(x => x.status === "pending");
  return (
    <div className="space-y-5 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <section className="card flex flex-wrap items-center gap-3 p-3">
        <div className="mr-auto"><h3 className="font-semibold">Transcript</h3>
          <p className="text-slate-600">{data.transcript_allowed ? `Released${data.transcript_allowed_at ? ` on ${fmtDate(data.transcript_allowed_at)}` : ""}: the student and parents can download and print it.` : "Not released: the student and parents can read it but not download or print it (for example while fees are outstanding)."}</p></div>
        <a className="btn btn-ghost" href={`/school/students/${studentId}/transcript`} target="_blank" rel="noreferrer">View</a>
        {data.can_release && <button className={"btn " + (data.transcript_allowed ? "btn-ghost border border-slate-300" : "btn-primary")}
          onClick={() => act({ action: "transcript", allowed: !data.transcript_allowed }, data.transcript_allowed ? "Transcript held back." : "Transcript released.")}>{data.transcript_allowed ? "Hold back" : "Release transcript"}</button>}
      </section>
      {toVerify.length > 0 && <section className="space-y-2">
        <h3 className="font-semibold">Added by the student <Badge tone="amber">{toVerify.length} to verify</Badge></h3>
        <ul className="grid gap-2 sm:grid-cols-2">{toVerify.map(x => (
          <li key={x.id} className="card overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {x.photo && <img src={x.photo} alt="" className="h-36 w-full object-cover" />}
            <div className="p-3"><p><b>{x.title}</b>{x.award ? ` · ${x.award}` : ""} <Badge>{ACH_KIND[x.kind] ?? x.kind}</Badge></p>
              <p className="text-xs text-slate-500">{x.level} · {fmtDate(x.achieved_on)}</p>
              <div className="mt-2 flex gap-2"><button className="btn btn-primary px-3 py-1 text-xs" onClick={() => act({ action: "verify_achievement", id: x.id, approve: true }, "Verified: it now shows on the shared portfolio.")}>Verify</button>
                <button className="btn btn-ghost border border-slate-300 px-3 py-1 text-xs" onClick={() => act({ action: "verify_achievement", id: x.id, approve: false }, "Marked as not verified.")}>Not verified</button></div></div>
          </li>))}</ul>
      </section>}
      <StaffTargets studentId={studentId} subjects={data.subjects} />
      <section className="space-y-2">
        <h3 className="font-semibold">Achievements and positions</h3>
        <form className="card grid gap-2 p-3 sm:grid-cols-6" onSubmit={async e => {
          e.preventDefault();
          if (await act({ action: "achievement", ...a, award: a.award || null, description: a.description || null }, "Achievement recorded.")) setA({ ...a, title: "", award: "", description: "" });
        }}>
          <select className="input" value={a.kind} onChange={e => setA({ ...a, kind: e.target.value })} aria-label="Kind">{Object.entries(ACH_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input className="input sm:col-span-2" value={a.title} onChange={e => setA({ ...a, title: e.target.value })} placeholder={a.kind === "leadership" ? "e.g. Head Girl" : "e.g. Inter-house sports, 100 m"} required aria-label="Title" />
          <input className="input" value={a.award} onChange={e => setA({ ...a, award: e.target.value })} placeholder="Award / place" aria-label="Award" />
          <select className="input" value={a.level} onChange={e => setA({ ...a, level: e.target.value })} aria-label="Level">{LEVELS.map(l => <option key={l}>{l}</option>)}</select>
          <input className="input" type="date" value={a.achieved_on} onChange={e => setA({ ...a, achieved_on: e.target.value })} aria-label="Date" />
          <input className="input sm:col-span-4" value={a.description} onChange={e => setA({ ...a, description: e.target.value })} placeholder="What for (optional)" aria-label="Description" />
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={a.shared_with_family} onChange={e => setA({ ...a, shared_with_family: e.target.checked })} /> Family sees it</label>
          <button className="btn btn-primary">Add</button>
        </form>
        {!data.achievements.filter(x => x.status !== "pending").length ? <Empty>Nothing recorded yet.</Empty> : (
          <ul className="card divide-y divide-slate-100">{data.achievements.filter(x => x.status !== "pending").map(x => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {x.photo && <img src={x.photo} alt="" className="h-12 w-12 rounded object-cover" />}
              <span className="min-w-56 flex-1"><b>{x.title}</b>{x.award ? ` · ${x.award}` : ""} <Badge>{ACH_KIND[x.kind] ?? x.kind}</Badge>{x.level !== "school" && <Badge tone="violet">{x.level}</Badge>}
                {x.source === "student" && <Badge tone={x.status === "rejected" ? "red" : "green"}>{x.status === "rejected" ? "not verified" : "added by the student, verified"}</Badge>}
                <span className="block text-xs text-slate-500">{fmtDate(x.achieved_on)}{x.users ? ` · recorded by ${x.users.full_name}` : ""}{x.description ? ` · ${x.description}` : ""}{x.shared_with_family ? "" : " · staff only"}</span></span>
              {admin && <button className="text-xs text-brand-700" onClick={() => setCert({ kind: x.kind === "attendance" ? "attendance" : "award", achievement_id: x.id })}>Certificate</button>}
              {(admin || x.recorded_by === data.me) && <button className="text-xs text-rose-600" onClick={() => confirm("Delete this achievement?") && act({ action: "delete_achievement", id: x.id }, "Deleted.")}>Delete</button>}
            </li>
          ))}</ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Portfolio {pending.length > 0 && <Badge tone="amber">{pending.length} waiting for a teacher</Badge>}</h3>
        <form className="card grid gap-2 p-3 sm:grid-cols-6" onSubmit={async e => {
          e.preventDefault();
          const file = (e.currentTarget.elements.namedItem("file") as HTMLInputElement).files?.[0];
          if (file) {
            const fd = new FormData();
            fd.set("file", file); fd.set("title", work.title); fd.set("kind", work.kind); fd.set("subject_id", work.subject_id); fd.set("description", work.description);
            const r = await fetch(`/api/sis/${studentId}/achievements`, { method: "POST", body: fd });
            const j = await r.json().catch(() => ({}));
            setMsg({ ok: r.ok, text: r.ok ? "Added to the portfolio." : j.error ?? "upload failed" });
            if (r.ok) { reload(); (e.target as HTMLFormElement).reset(); setWork({ ...work, title: "", description: "", link_url: "" }); }
          } else if (work.link_url) {
            if (await act({ action: "link", title: work.title, kind: work.kind, subject_id: work.subject_id || null, link_url: work.link_url, description: work.description || null }, "Added to the portfolio.")) setWork({ ...work, title: "", description: "", link_url: "" });
          } else setMsg({ ok: false, text: "Choose a file or paste a link." });
        }}>
          <input className="input sm:col-span-2" value={work.title} onChange={e => setWork({ ...work, title: e.target.value })} placeholder="Title, e.g. Science fair project" required aria-label="Title" />
          <select className="input" value={work.kind} onChange={e => setWork({ ...work, kind: e.target.value })} aria-label="Kind">{["work", "project", "artwork", "writing", "photo", "video", "audio", "other"].map(k => <option key={k}>{k}</option>)}</select>
          <select className="input" value={work.subject_id} onChange={e => setWork({ ...work, subject_id: e.target.value })} aria-label="Subject"><option value="">Subject</option>{data.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <input className="input sm:col-span-2" name="file" type="file" aria-label="File (PDF, photo, video, audio, Word, PowerPoint; up to 25 MB)" />
          <input className="input sm:col-span-3" value={work.link_url} onChange={e => setWork({ ...work, link_url: e.target.value })} placeholder="…or a link (https://)" aria-label="Link" />
          <input className="input sm:col-span-2" value={work.description} onChange={e => setWork({ ...work, description: e.target.value })} placeholder="Note" aria-label="Note" />
          <button className="btn btn-outline">Add</button>
        </form>
        {!data.portfolio.length ? <Empty>No work in the portfolio yet. Students can add their own from their page; it waits here for a teacher.</Empty> : (
          <ul className="grid gap-2 sm:grid-cols-2">{data.portfolio.map(p => (
            <li key={p.id} className="card p-3">
              <p className="font-medium">{p.path ? <a className="text-brand-700 hover:underline" href={`/api/sis/${studentId}/achievements?open=${p.id}`} target="_blank" rel="noreferrer">{p.title}</a>
                : p.link_url ? <a className="text-brand-700 hover:underline" href={p.link_url} target="_blank" rel="noreferrer">{p.title}</a> : p.title}
                {p.status !== "approved" && <Badge tone={p.status === "submitted" ? "amber" : "red"}>{p.status === "submitted" ? "waiting" : "returned"}</Badge>}</p>
              <p className="text-xs text-slate-500">{p.kind}{p.subjects ? ` · ${p.subjects.name}` : ""} · {fmtDate(p.created_at)}{p.users ? ` · ${p.users.full_name}` : ""}</p>
              {p.description && <p className="text-xs">{p.description}</p>}
              {p.feedback && <p className="text-xs text-slate-600">Feedback: {p.feedback}</p>}
              <div className="mt-1 flex gap-2 text-xs">
                {p.status === "submitted" && <><button className="text-emerald-700" onClick={() => act({ action: "review", id: p.id, status: "approved" }, "Approved.")}>Approve</button>
                  <button className="text-amber-800" onClick={() => { const fb = prompt("What should the student change?"); if (fb) act({ action: "review", id: p.id, status: "returned", feedback: fb }, "Returned with feedback."); }}>Return</button></>}
                <button className="text-rose-600" onClick={() => confirm("Delete this item?") && act({ action: "delete_item", id: p.id }, "Deleted.")}>Delete</button>
              </div>
            </li>
          ))}</ul>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center"><h3 className="mr-auto font-semibold">Certificates</h3>
          {admin && <select className="input w-auto py-1 text-xs" value="" onChange={e => e.target.value && setCert({ kind: e.target.value as CertKind })} aria-label="Issue a certificate"><option value="">Issue a certificate…</option>{CERT_KINDS.map(k => <option key={k} value={k}>{CERT_LABEL[k]}</option>)}</select>}</div>
        {!data.certificates.length ? <Empty>No certificates issued.</Empty> : (
          <ul className="card divide-y divide-slate-100">{data.certificates.map(c => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 p-3">
              <span className="flex-1"><a className="font-medium text-brand-700 hover:underline" href={`/v/${c.verify_token}`} target="_blank" rel="noreferrer">{c.title}</a>
                <span className="block text-xs text-slate-500">{CERT_LABEL[c.kind]} · No. {c.serial_no} · {fmtDate(c.issued_on)}{c.revoked_reason ? ` · revoked: ${c.revoked_reason}` : ""}</span></span>
              <Badge tone={c.status === "issued" ? "green" : "red"}>{c.status}</Badge>
              {admin && c.status === "issued" && <button className="text-xs text-rose-600" onClick={async () => { const reason = prompt("Why is this certificate being revoked?"); if (!reason) return; const r = await send("/api/certificates", { action: "revoke", id: c.id, reason }); setMsg({ ok: r.ok, text: r.ok ? "Revoked. Its check page now says so." : r.error ?? "failed" }); reload(); }}>Revoke</button>}
            </li>
          ))}</ul>
        )}
      </section>
      <Modal open={Boolean(cert)} onClose={() => setCert(null)} title="Issue a certificate" wide>
        {cert && <IssueCertificate studentIds={[studentId]} kind={cert.kind} achievementId={cert.achievement_id} onDone={t => { setCert(null); setMsg({ ok: true, text: t }); reload(); }} />}
      </Modal>
    </div>
  );
}

/** Preview the wording from the record, edit it, then issue. With several students, each gets their own wording. */
export function IssueCertificate({ studentIds, kind: initialKind, achievementId, onDone }: { studentIds: string[]; kind: CertKind; achievementId?: string; onDone: (t: string) => void }) {
  const [kind, setKind] = useState<CertKind>(initialKind);
  const [f, setF] = useState({ title: "", remarks: "", conduct: "", period: "", signer_name: "", signer_title: "Principal", issued_on: new Date().toISOString().slice(0, 10), shared: true });
  const [preview, setPreview] = useState<{ title: string; body: string; warnings: string[] } | null>(null);
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const single = studentIds.length === 1;
  const common = () => ({ kind, title: f.title || null, remarks: f.remarks || null, conduct: f.conduct || null, period: f.period || null, achievement_id: achievementId ?? null });
  const loadPreview = async () => {
    setErr(null);
    const r = await send<{ title: string; body: string; warnings: string[] }>("/api/certificates", { action: "preview", student_id: studentIds[0], ...common() });
    if (!r.ok) { setErr(r.error); return; }
    setPreview(r.data); setBody(r.data.body);
  };
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Kind"><select className="input" value={kind} onChange={e => { setKind(e.target.value as CertKind); setPreview(null); }}>{CERT_KINDS.map(k => <option key={k} value={k}>{CERT_LABEL[k]}</option>)}</select></Field>
        <Field label="Title (optional)"><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder={CERT_LABEL[kind]} /></Field>
        <Field label="Date"><input className="input" type="date" value={f.issued_on} onChange={e => setF({ ...f, issued_on: e.target.value })} /></Field>
        {["transfer", "testimonial"].includes(kind) && <Field label="Conduct"><input className="input" value={f.conduct} onChange={e => setF({ ...f, conduct: e.target.value })} placeholder="e.g. Excellent" /></Field>}
        {kind === "attendance" && <Field label="Period"><input className="input" value={f.period} onChange={e => setF({ ...f, period: e.target.value })} placeholder="e.g. the 2025/2026 session" /></Field>}
        <Field label="Signed by"><input className="input" value={f.signer_name} onChange={e => setF({ ...f, signer_name: e.target.value })} placeholder="The principal's name (default)" /></Field>
        <Field label="Their title"><input className="input" value={f.signer_title} onChange={e => setF({ ...f, signer_title: e.target.value })} /></Field>
      </div>
      <Field label={kind === "participation" ? "Event" : kind === "award" ? "What for" : "Remarks"}><textarea className="input min-h-16" value={f.remarks} onChange={e => setF({ ...f, remarks: e.target.value })} maxLength={2000} /></Field>
      <label className="flex items-center gap-2"><input type="checkbox" checked={f.shared} onChange={e => setF({ ...f, shared: e.target.checked })} /> Family can see and print it</label>
      {err && <Alert>{err}</Alert>}
      {single && (
        <>
          <button className="btn btn-outline" onClick={loadPreview}>Preview the wording</button>
          {preview && (
            <div className="space-y-2">
              {preview.warnings.map(w => <Alert key={w} tone="amber">{w}</Alert>)}
              <p className="font-semibold">{f.title || preview.title}</p>
              <textarea className="input min-h-48 font-serif" value={body} onChange={e => setBody(e.target.value)} aria-label="Certificate wording" />
            </div>
          )}
        </>
      )}
      {!single && <p className="text-slate-600">{studentIds.length} certificates will be issued, each worded from that student&apos;s own record.</p>}
      <button className="btn btn-primary" disabled={busy || (single && !preview)} onClick={async () => {
        setBusy(true);
        const r = await send<{ issued: { verify_token: string }[] }>("/api/certificates", { action: "issue", student_ids: studentIds, ...common(), body: single ? body : null,
          issued_on: f.issued_on, signer_name: f.signer_name || null, signer_title: f.signer_title || null, shared: f.shared });
        setBusy(false);
        if (!r.ok) { setErr(r.error); return; }
        if (single) window.open(`/v/${r.data.issued[0].verify_token}`, "_blank");
        onDone(`Issued ${r.data.issued.length} certificate${r.data.issued.length === 1 ? "" : "s"}.`);
      }}>{busy ? "Issuing…" : single ? "Issue and open to print" : `Issue ${studentIds.length} certificates`}</button>
    </div>
  );
}

/** Targets for the student (phase 14o): staff set term average, subject score or attendance targets; the student and parents add personal goals. */
function StaffTargets({ studentId, subjects }: { studentId: string; subjects: { id: string; name: string }[] }) {
  const { data, reload } = useApi<{ targets: TargetRow[] }>(`/api/targets?student=${studentId}`);
  const [t, setT] = useState({ kind: "average", target: "60", subject_id: "", description: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <section className="space-y-2">
      <Targets targets={data?.targets ?? []} />
      <form className="card grid gap-2 p-3 sm:grid-cols-6" onSubmit={async e => {
        e.preventDefault();
        const r = await send("/api/targets", { action: "student", student_id: studentId, kind: t.kind, target: t.kind === "personal" ? null : Number(t.target), subject_id: t.kind === "subject_score" ? t.subject_id || null : null, description: t.description || null });
        setErr(r.ok ? null : r.error);
        if (r.ok) { setT({ ...t, description: "" }); reload(); }
      }}>
        <select className="input" value={t.kind} onChange={e => setT({ ...t, kind: e.target.value })} aria-label="Target"><option value="average">Term average</option><option value="subject_score">Subject score</option><option value="attendance">Attendance %</option><option value="personal">Other goal</option></select>
        {t.kind === "subject_score" && <select className="input" value={t.subject_id} onChange={e => setT({ ...t, subject_id: e.target.value })} aria-label="Subject"><option value="">Subject…</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        {t.kind !== "personal" && <input className="input" type="number" min={0} max={100} value={t.target} onChange={e => setT({ ...t, target: e.target.value })} aria-label="Target figure" />}
        <input className="input sm:col-span-2" value={t.description} onChange={e => setT({ ...t, description: e.target.value })} placeholder="Note (optional)" maxLength={300} aria-label="Note" />
        <button className="btn btn-outline">Set target</button>
      </form>
      {err && <Alert>{err}</Alert>}
    </section>
  );
}
