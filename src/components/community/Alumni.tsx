"use client";
import { useMemo, useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field, Loading, Modal, Stat, fmtDate } from "@/components/ui";

type Alumnus = { id: string; full_name: string; graduation_year: number | null; last_class: string | null; email: string | null; phone: string | null; occupation: string | null; employer: string | null;
  further_study: string | null; city: string | null; country: string | null; mentor: boolean; consent_contact: boolean; status: string; source: string; created_at: string; linkedin?: string | null; notes?: string | null; user_id?: string | null };
type Data = { items: Alumnus[]; join_link: string | null; stats: { total: number; pending: number; mentors: number; reachable: number; graduates: number } };

/** Former students: directory, sign-ups to confirm, mentors, and the contact log. */
export default function Alumni() {
  const { data, error, reload } = useApi<Data>("/api/community/alumni");
  const [q, setQ] = useState("");
  const [year, setYear] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Alumnus> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const years = useMemo(() => [...new Set((data?.items ?? []).map(a => a.graduation_year).filter(Boolean))].sort((a, b) => b! - a!), [data]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const act = async (body: Record<string, unknown>, ok: (d: any) => string) => {
    const r = await send("/api/community/alumni", body);
    setMsg({ ok: r.ok, text: r.ok ? ok(r.data) : r.error ?? "failed" });
    reload();
  };
  const ql = q.trim().toLowerCase();
  const items = data.items.filter(a => (!year || String(a.graduation_year) === year) && (!ql || [a.full_name, a.occupation, a.employer, a.further_study, a.city, a.email].some(x => (x ?? "").toLowerCase().includes(ql))));
  const pending = items.filter(a => a.status === "pending");
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Alumni" value={data.stats.total} hint={`${data.stats.graduates} graduated students on record`} />
        <Stat label="Waiting to confirm" value={data.stats.pending} tone={data.stats.pending ? "warn" : undefined} />
        <Stat label="Willing to mentor" value={data.stats.mentors} tone="good" />
        <Stat label="Can be contacted" value={data.stats.reachable} />
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, job, university, city" aria-label="Search alumni" />
        <select className="input w-auto" value={year} onChange={e => setYear(e.target.value)} aria-label="Year"><option value="">All years</option>{years.map(y => <option key={y} value={String(y)}>{y}</option>)}</select>
        <span className="flex-1" />
        <button className="btn btn-outline" onClick={() => act({ action: "import_graduates" }, d => d.added ? `Added ${d.added} graduated student${d.added === 1 ? "" : "s"}.` : "Every graduated student is already listed.")}>Add graduated students</button>
        <button className="btn btn-primary" onClick={() => setEdit({ mentor: false, consent_contact: true })}>Add alumnus</button>
      </div>
      {data.join_link && (
        <p className="rounded-lg bg-slate-50 p-2 text-xs">Sign-up link to share with former students: <code className="select-all">{data.join_link}</code>
          <button className="ml-2 text-brand-700" onClick={() => navigator.clipboard?.writeText(data.join_link!)}>Copy</button></p>
      )}
      {pending.length > 0 && (
        <section className="card border-amber-300 p-3">
          <h3 className="mb-1 font-semibold text-amber-800">New sign-ups to confirm ({pending.length})</h3>
          <ul className="divide-y divide-slate-100">{pending.map(a => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 py-1"><span className="flex-1">{a.full_name} · class of {a.graduation_year ?? "?"} {a.last_class ? `(${a.last_class})` : ""} <span className="text-xs text-slate-500">{a.email}</span></span>
              <button className="btn btn-success px-2 py-1 text-xs" onClick={() => act({ action: "status", id: a.id, status: "active" }, () => "Confirmed.")}>Confirm</button>
              <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "status", id: a.id, status: "archived" }, () => "Archived.")}>Not ours</button></li>
          ))}</ul>
        </section>
      )}
      {!items.length ? <Empty>No alumni yet. Add graduated students or share the sign-up link.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full"><thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Name</th><th className="p-2">Year</th><th className="p-2">Now</th><th className="p-2">Where</th><th className="p-2">Contact</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{items.filter(a => a.status !== "pending").map(a => (
              <tr key={a.id} className={"cursor-pointer hover:bg-slate-50 " + (a.status === "archived" ? "text-slate-400" : "")} onClick={() => setOpen(a.id)}>
                <td className="p-2 font-medium">{a.full_name} {a.mentor && <Badge tone="green">mentor</Badge>}</td>
                <td className="p-2">{a.graduation_year ?? "—"}<span className="block text-xs text-slate-500">{a.last_class ?? ""}</span></td>
                <td className="p-2">{[a.occupation, a.employer].filter(Boolean).join(" at ") || a.further_study || "—"}</td>
                <td className="p-2">{[a.city, a.country].filter(Boolean).join(", ") || "—"}</td>
                <td className="p-2 text-xs">{a.consent_contact ? (a.email ?? a.phone ?? "—") : <span className="text-slate-400">unsubscribed</span>}</td>
              </tr>
            ))}</tbody></table>
        </div>
      )}
      <Modal open={Boolean(open)} onClose={() => { setOpen(null); reload(); }} title="Alumnus" wide>
        {open && <AlumnusView id={open} onEdit={a => { setOpen(null); setEdit(a); }} onDeleted={() => { setOpen(null); reload(); }} />}
      </Modal>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit alumnus" : "Add alumnus"} wide>
        {edit && <AlumnusForm a={edit} onDone={() => { setEdit(null); reload(); }} />}
      </Modal>
    </div>
  );
}

function AlumnusView({ id, onEdit, onDeleted }: { id: string; onEdit: (a: Alumnus) => void; onDeleted: () => void }) {
  const { data, reload } = useApi<{ alumnus: Alumnus & { update_link: string }; log: { id: string; kind: string; body: string; occurred_at: string; users: { full_name: string } | null }[] }>(`/api/community/alumni?id=${id}`);
  const [log, setLog] = useState({ kind: "call", body: "" });
  if (!data) return <Loading />;
  const a = data.alumnus;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <div><h3 className="text-lg font-semibold">{a.full_name}</h3>
          <p className="text-slate-600">Class of {a.graduation_year ?? "?"}{a.last_class ? ` · ${a.last_class}` : ""} · {[a.occupation, a.employer].filter(Boolean).join(" at ")}{a.further_study ? ` · ${a.further_study}` : ""}</p>
          <p className="text-slate-600">{[a.email, a.phone, [a.city, a.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}{a.linkedin && <> · <a className="text-brand-700" href={a.linkedin} target="_blank" rel="noreferrer">LinkedIn</a></>}</p>
          {a.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{a.notes}</p>}</div>
        <div className="flex gap-2"><button className="btn btn-outline" onClick={() => onEdit(a)}>Edit</button>
          <button className="btn btn-outline text-rose-700" onClick={async () => { if (!confirm(`Remove ${a.full_name}?`)) return; const r = await send("/api/community/alumni", { action: "delete", id }); if (r.ok) onDeleted(); else alert(r.error); }}>Remove</button></div>
      </div>
      <p className="rounded bg-slate-50 p-2 text-xs">Private link for {a.full_name.split(" ")[0]} to update their details: <code className="select-all">{a.update_link}</code></p>
      {a.user_id ? <p className="text-xs text-emerald-700">Has an alumni sign-in.</p> : a.email && a.status === "active" && (
        <button className="btn btn-outline px-2 py-1 text-xs" onClick={async () => { const r = await send("/api/community/alumni", { action: "invite", id }); alert(r.ok ? "Invitation sent." : r.error); reload(); }}>Invite to the alumni page</button>
      )}
      <form className="flex flex-wrap gap-2" onSubmit={async e => { e.preventDefault(); const r = await send("/api/community/alumni", { action: "log", id, ...log }); if (r.ok) { setLog({ ...log, body: "" }); reload(); } }}>
        <select className="input w-auto" value={log.kind} onChange={e => setLog({ ...log, kind: e.target.value })} aria-label="Kind">{["call", "meeting", "email", "visit", "note", "other"].map(k => <option key={k}>{k}</option>)}</select>
        <input className="input flex-1" value={log.body} onChange={e => setLog({ ...log, body: e.target.value })} placeholder="e.g. Agreed to speak at careers day" required maxLength={4000} />
        <button className="btn btn-primary">Log</button>
      </form>
      <ul className="space-y-1">{data.log.map(l => <li key={l.id}><b className="capitalize">{l.kind}</b> {l.body} <span className="text-xs text-slate-400">{l.users?.full_name ?? ""} · {fmtDate(l.occurred_at, true)}</span></li>)}</ul>
    </div>
  );
}

function AlumnusForm({ a, onDone }: { a: Partial<Alumnus>; onDone: () => void }) {
  const [f, setF] = useState<Partial<Alumnus>>(a);
  const [err, setErr] = useState<string | null>(null);
  const txt = (k: keyof Alumnus, label: string, type = "text") => <Field label={label}><input className="input" type={type} value={(f[k] as string | number | null | undefined) ?? ""} onChange={e => setF({ ...f, [k]: type === "number" ? (e.target.value ? Number(e.target.value) : null) : e.target.value })} /></Field>;
  return (
    <form className="space-y-3 text-sm" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/community/alumni", { action: "save", id: f.id || null, full_name: f.full_name, graduation_year: f.graduation_year ?? null, last_class: f.last_class || null, email: f.email || "",
        phone: f.phone || null, occupation: f.occupation || null, employer: f.employer || null, further_study: f.further_study || null, city: f.city || null, country: f.country || null,
        linkedin: f.linkedin || "", mentor: Boolean(f.mentor), consent_contact: f.consent_contact !== false, notes: f.notes || null });
      if (r.ok) onDone(); else setErr(r.error);
    }}>
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        {txt("full_name", "Full name")}{txt("graduation_year", "Year left", "number")}{txt("last_class", "Last class")}
        {txt("email", "Email", "email")}{txt("phone", "Phone")}{txt("linkedin", "LinkedIn link", "url")}
        {txt("occupation", "Job")}{txt("employer", "Employer")}{txt("further_study", "University / course")}
        {txt("city", "City")}{txt("country", "Country")}
      </div>
      <Field label="Notes"><textarea className="input min-h-16" value={f.notes ?? ""} onChange={e => setF({ ...f, notes: e.target.value })} maxLength={2000} /></Field>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1"><input type="checkbox" checked={Boolean(f.mentor)} onChange={e => setF({ ...f, mentor: e.target.checked })} /> Willing to mentor students</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={f.consent_contact !== false} onChange={e => setF({ ...f, consent_contact: e.target.checked })} /> Happy to hear from the school</label>
      </div>
      <button className="btn btn-primary">Save</button>
    </form>
  );
}
