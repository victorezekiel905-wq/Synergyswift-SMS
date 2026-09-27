"use client";
import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Alert, Badge, statusTone, Field, fmtDate, fmtTime, Modal, Loading } from "@/components/ui";
import { LANGUAGES } from "@/lib/languages";
import QrCode from "@/components/QrCode";

type Guardian = { id: string; full_name: string; email: string | null; phone: string | null; whatsapp_phone: string | null; notify_email: boolean; notify_whatsapp: boolean; notify_sms?: boolean; language?: string | null; user_id: string | null };
type Detail = {
  student: Record<string, any> & { class_groups: { id: string; name: string } | null };
  guardians: { relation: string; is_primary: boolean; can_pickup: boolean; guardians: Guardian }[];
  gate_events: { id: string; direction: string; method: string; late: boolean; at: string; note: string | null }[];
  report_cards: { id: string; average: number | null; position: number | null; class_size: number | null; status: string; access_token: string; terms: { name: string; academic_sessions: { name: string } | null } | null }[];
  loans: { id: string; due_at: string; returned_at: string | null; library_books: { title: string } | null }[];
};

export default function StudentDetail(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { data, error, reload } = useApi<Detail>(`/api/sims/students/${params.id}`);
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[] }>("/api/school/structure");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [edit, setEdit] = useState<Record<string, any> | null>(null);
  const [addG, setAddG] = useState(false);
  const [card, setCard] = useState(false);
  useEffect(() => { if (data) setEdit({ ...data.student, class_group_id: data.student.class_group_id ?? "" }); }, [data]);

  async function guardianAction(body: Record<string, unknown>, ok: string) {
    const r = await send("/api/sims/guardians", body);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) reload();
  }
  async function saveStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const keys = ["admission_no", "first_name", "last_name", "other_names", "gender", "date_of_birth", "class_group_id", "photo_url", "address", "medical_notes", "status"];
    const r = await send(`/api/sims/students/${params.id}`, Object.fromEntries(keys.map(k => [k, edit[k] ?? null])), "PATCH");
    setMsg({ ok: r.ok, text: r.ok ? "Saved." : r.error ?? "failed" });
    if (r.ok) reload();
  }
  async function createLogin() {
    const email = prompt("Student email for their login (used for exams and results):");
    if (!email) return;
    const r = await send(`/api/sims/students/${params.id}`, { action: "create_login", email });
    setMsg({ ok: r.ok, text: r.ok ? `Invitation sent to ${email}.` : r.error ?? "failed" });
    if (r.ok) reload();
  }

  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data || !edit) return <Page><Loading /></Page>;
  const s = data.student;
  const bind = (k: string) => ({ value: edit[k] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setEdit({ ...edit, [k]: e.target.value }) });

  return (
    <Page wide>
      <Link href="/school/students" className="text-sm text-brand-700 hover:underline">← Students</Link>
      <PageHeader title={`${s.first_name} ${s.other_names ?? ""} ${s.last_name}`} subtitle={`${s.admission_no} · ${s.class_groups?.name ?? "No class"}`}
        actions={<>
          <Badge tone={statusTone(s.status)}>{s.status}</Badge>
          <HousePicker studentId={s.id} houseId={s.house_id ?? null} onChange={reload} />
          <button className="btn btn-outline" onClick={() => setCard(true)}>ID card / QR</button>
          {!s.user_id && <button className="btn btn-outline" onClick={createLogin}>Create student login</button>}
          <a className="btn btn-outline" href={`/api/sims/students/${s.id}/export`} title="Everything held about this student, for a data access request">Export data</a>
        </>} />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}

      <div className="grid gap-5 xl:grid-cols-3">
        <form onSubmit={saveStudent} className="card grid gap-3 p-5 sm:grid-cols-2 xl:col-span-2">
          <h2 className="font-semibold sm:col-span-2">Record</h2>
          <Field label="Admission no"><input className="input" {...bind("admission_no")} /></Field>
          <Field label="Class"><select className="input" {...bind("class_group_id")}><option value="">—</option>{(structure?.class_groups ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
          <Field label="First name"><input className="input" {...bind("first_name")} /></Field>
          <Field label="Last name"><input className="input" {...bind("last_name")} /></Field>
          <Field label="Other names"><input className="input" {...bind("other_names")} /></Field>
          <Field label="Gender"><select className="input" {...bind("gender")}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></Field>
          <Field label="Date of birth"><input className="input" type="date" {...bind("date_of_birth")} /></Field>
          <Field label="Status"><select className="input" {...bind("status")}><option>active</option><option>graduated</option><option>withdrawn</option><option>suspended</option></select></Field>
          <Field label="Photo URL"><input className="input" {...bind("photo_url")} /></Field>
          <Field label="Address"><input className="input" {...bind("address")} /></Field>
          <div className="sm:col-span-2"><Field label="Medical notes (visible to staff only)"><textarea className="input h-20" {...bind("medical_notes")} /></Field></div>
          <div className="sm:col-span-2"><button className="btn btn-primary">Save record</button></div>
        </form>

        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Parents & guardians</h2><button className="btn btn-ghost text-xs" onClick={() => setAddG(true)}>+ Add</button></div>
          {!data.guardians.length && <Alert tone="amber">No guardians. Parents will not receive results or alerts.</Alert>}
          <ul className="space-y-3">
            {data.guardians.map(({ guardians: g, relation, can_pickup, is_primary }) => (
              <li key={g.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <p className="font-medium">{g.full_name} <span className="text-xs text-slate-500">({relation}{is_primary ? ", primary" : ""})</span></p>
                <p className="text-xs text-slate-600">{g.whatsapp_phone || g.phone || "no phone"} · {g.email || "no email"}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone={g.notify_whatsapp && (g.phone || g.whatsapp_phone) ? "green" : "slate"}>WhatsApp {g.notify_whatsapp ? "on" : "off"}</Badge>
                  <Badge tone={g.notify_email && g.email ? "green" : "slate"}>Email {g.notify_email ? "on" : "off"}</Badge>
                  <button type="button" onClick={() => guardianAction({ action: "update", guardian_id: g.id, guardian: { notify_sms: !g.notify_sms } }, g.notify_sms ? "SMS turned off" : "SMS turned on")}>
                    <Badge tone={g.notify_sms ? "green" : "slate"}>SMS {g.notify_sms ? "on" : "off"}</Badge></button>
                  <select className="rounded border border-slate-200 bg-white px-1 text-xs" value={g.language ?? ""} aria-label={`Language for ${g.full_name}`}
                    onChange={e => guardianAction({ action: "update", guardian_id: g.id, guardian: { language: e.target.value || null } }, "Language saved")}>
                    <option value="">School language</option>{Object.entries(LANGUAGES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
                  <Badge tone={can_pickup ? "blue" : "red"}>{can_pickup ? "may collect" : "may not collect"}</Badge>
                  {g.user_id && <Badge tone="violet">has login</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => guardianAction({ action: "send_portal_link", guardian_id: g.id }, "Portal link sent")}>Send portal link</button>
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => confirm("Issue a new link? The old one stops working.") && guardianAction({ action: "send_portal_link", guardian_id: g.id, rotate: true }, "New link sent")}>New link</button>
                  {!g.user_id && g.email && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => guardianAction({ action: "create_login", guardian_id: g.id }, "Parent login invitation sent")}>Create login</button>}
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => guardianAction({ action: "link_flags", student_id: s.id, guardian_id: g.id, can_pickup: !can_pickup }, "Pickup permission updated")}>{can_pickup ? "Block pickup" : "Allow pickup"}</button>
                  <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => confirm(`Unlink ${g.full_name}?`) && guardianAction({ action: "unlink", student_id: s.id, guardian_id: g.id }, "Unlinked")}>Unlink</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Recent sign-ins</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {data.gate_events.map(e => <li key={e.id} className="flex justify-between py-1.5"><span><Badge tone={e.direction === "in" ? "green" : "slate"}>{e.direction}</Badge> {e.late && <Badge tone="amber">late</Badge>} <span className="text-xs text-slate-500">{e.method}</span></span><span className="text-xs text-slate-500">{fmtDate(e.at)} {fmtTime(e.at)}</span></li>)}
            {!data.gate_events.length && <li className="py-2 text-slate-500">None yet.</li>}
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Report cards</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {data.report_cards.map(r => <li key={r.id} className="flex items-center justify-between py-1.5"><span>{r.terms?.name} {r.terms?.academic_sessions?.name}</span><span className="flex items-center gap-2"><span className="tabular-nums">{r.average ?? "—"}%</span><Badge tone={statusTone(r.status)}>{r.status}</Badge><a className="text-xs text-brand-700 hover:underline" href={`/r/${r.access_token}`} target="_blank" rel="noreferrer">view</a></span></li>)}
            {!data.report_cards.length && <li className="py-2 text-slate-500">None yet.</li>}
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Library</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {data.loans.map(l => <li key={l.id} className="flex justify-between py-1.5"><span>{l.library_books?.title}</span><span className="text-xs text-slate-500">{l.returned_at ? `returned ${fmtDate(l.returned_at)}` : `due ${fmtDate(l.due_at)}`}</span></li>)}
            {!data.loans.length && <li className="py-2 text-slate-500">No loans.</li>}
          </ul>
        </section>
      </div>

      <AddGuardian open={addG} onClose={() => setAddG(false)} onSave={async (g) => { await guardianAction({ action: "add", student_id: s.id, guardian: g }, "Guardian added"); setAddG(false); }} />
      <Modal open={card} onClose={() => setCard(false)} title="ID card">
        <div className="mx-auto w-72 rounded-xl border-2 border-slate-800 p-4 text-center print:border-black">
          <p className="text-xs font-bold uppercase tracking-wide">Student ID</p>
          <p className="mt-1 text-lg font-bold">{s.first_name} {s.last_name}</p>
          <p className="text-xs text-slate-600">{s.admission_no} · {s.class_groups?.name ?? ""}</p>
          <div className="mt-3 flex justify-center"><QrCode value={`EDU:${s.card_code}`} size={180} /></div>
          <p className="mt-2 text-[10px] text-slate-500">Scan at the gate to sign in and out</p>
        </div>
        <div className="mt-4 flex justify-center"><button className="btn btn-primary" onClick={() => window.print()}>Print</button></div>
      </Modal>
    </Page>
  );
}

function AddGuardian({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (g: Record<string, unknown>) => void }) {
  const [g, setG] = useState({ full_name: "", phone: "", email: "", relation: "father", can_pickup: true });
  return (
    <Modal open={open} onClose={onClose} title="Add guardian">
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); onSave({ ...g, phone: g.phone || null, email: g.email || null }); setG({ full_name: "", phone: "", email: "", relation: "father", can_pickup: true }); }}>
        <Field label="Full name"><input className="input" required value={g.full_name} onChange={e => setG({ ...g, full_name: e.target.value })} /></Field>
        <Field label="WhatsApp / phone"><input className="input" value={g.phone} onChange={e => setG({ ...g, phone: e.target.value })} /></Field>
        <Field label="Email"><input className="input" type="email" value={g.email} onChange={e => setG({ ...g, email: e.target.value })} /></Field>
        <Field label="Relationship"><select className="input" value={g.relation} onChange={e => setG({ ...g, relation: e.target.value })}><option>father</option><option>mother</option><option>guardian</option><option>grandparent</option><option>sibling</option><option>driver</option><option>other</option></select></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={g.can_pickup} onChange={e => setG({ ...g, can_pickup: e.target.checked })} /> Allowed to collect the child</label>
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary">Add</button></div>
      </form>
    </Modal>
  );
}

function HousePicker({ studentId, houseId, onChange }: { studentId: string; houseId: string | null; onChange: () => void }) {
  const { data } = useApi<{ houses: { id: string; name: string }[] }>("/api/behaviour");
  if (!data?.houses.length) return null;
  return (
    <select className="input w-auto py-1 text-xs" value={houseId ?? ""} aria-label="House"
      onChange={async e => { await send("/api/behaviour", { action: "assign_houses", student_ids: [studentId], house_id: e.target.value || null }); onChange(); }}>
      <option value="">No house</option>{data.houses.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
    </select>
  );
}
