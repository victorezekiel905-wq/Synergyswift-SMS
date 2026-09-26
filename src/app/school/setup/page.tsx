"use client";
import { useEffect, useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Field, Badge, Empty } from "@/components/ui";

type Tab = "profile" | "academic" | "grading" | "classes";

export default function SetupPage() {
  const [tab, setTab] = useState<Tab>("profile");
  return (
    <Page wide>
      <PageHeader eyebrow="Administration" title="School setup" subtitle="Branding, calendar, your own grading rules, classes and subjects. Only school admins can change these." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "profile", label: "Profile & notifications" }, { id: "academic", label: "Sessions & terms" },
        { id: "grading", label: "Grading" }, { id: "classes", label: "Classes & subjects" }]} />
      {tab === "profile" && <Profile />}
      {tab === "academic" && <Academic />}
      {tab === "grading" && <Grading />}
      {tab === "classes" && <Classes />}
    </Page>
  );
}

function useFlash() {
  const [m, setM] = useState<{ ok: boolean; text: string } | null>(null);
  const node = m ? <div className="mb-4"><Alert tone={m.ok ? "green" : "red"}>{m.text}</Alert></div> : null;
  return { flash: (ok: boolean, text: string) => setM({ ok, text }), node };
}

/* ---------------- Profile ---------------- */
function Profile() {
  const { data } = useApi<{ settings: Record<string, any> }>("/api/school/settings");
  const [s, setS] = useState<Record<string, any>>({});
  const { flash, node } = useFlash();
  useEffect(() => { if (data) setS(data.settings); }, [data]);
  const text = (k: string) => ({ value: s[k] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setS({ ...s, [k]: e.target.value }) });
  const num = (k: string) => ({ value: s[k] ?? "", type: "number", onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value === "" ? null : Number(e.target.value) }) });
  const bool = (k: string) => ({ checked: s[k] !== false, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.checked }) });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const keys = ["school_name", "motto", "address", "phone", "email", "logo_url", "principal_name", "brand_color", "sender_name", "reply_to_email",
      "notify_gate_events", "notify_results", "staff_start_time", "student_start_time", "geofence_lat", "geofence_lng", "geofence_radius_m",
      "library_loan_days", "library_fine_per_day", "currency", "pickup_code_ttl_min", "exam_violation_limit", "sms_mode"];
    const body = Object.fromEntries(keys.filter(k => s[k] !== undefined).map(k => [k, typeof s[k] === "string" && /time$/.test(k) ? s[k].slice(0, 5) : s[k]]));
    const r = await send("/api/school/settings", body, "PUT");
    flash(r.ok, r.ok ? "Settings saved." : r.error ?? "Save failed");
  }
  function useMyLocation() {
    navigator.geolocation?.getCurrentPosition(p => setS(x => ({ ...x, geofence_lat: +p.coords.latitude.toFixed(6), geofence_lng: +p.coords.longitude.toFixed(6), geofence_radius_m: x.geofence_radius_m ?? 200 })),
      () => flash(false, "Location permission was denied."));
  }
  return (
    <form onSubmit={save} className="space-y-5">
      {node}
      <section className="card grid gap-4 p-5 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">School identity (shown on report cards, emails and WhatsApp)</h2>
        <Field label="School name"><input className="input" {...text("school_name")} /></Field>
        <Field label="Motto"><input className="input" {...text("motto")} /></Field>
        <Field label="Address"><input className="input" {...text("address")} /></Field>
        <Field label="Phone"><input className="input" {...text("phone")} /></Field>
        <Field label="Email"><input className="input" type="email" {...text("email")} /></Field>
        <Field label="Logo URL" hint="Public https image URL."><input className="input" {...text("logo_url")} /></Field>
        <Field label="Principal / head teacher"><input className="input" {...text("principal_name")} /></Field>
        <Field label="Brand colour"><input className="input h-10" type="color" value={s.brand_color ?? "#1d5ddb"} onChange={e => setS({ ...s, brand_color: e.target.value })} /></Field>
        <Field label="Message sender name"><input className="input" {...text("sender_name")} /></Field>
        <Field label="Reply-to email for parents"><input className="input" type="email" {...text("reply_to_email")} /></Field>
      </section>
      <section className="card grid gap-4 p-5 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">Parent notifications</h2>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...bool("notify_gate_events")} /> Tell parents when their child signs in and out</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...bool("notify_results")} /> Send results by email and WhatsApp when published</label>
        <Field label="Pickup code validity (minutes)"><input className="input" min={10} max={1440} {...num("pickup_code_ttl_min")} /></Field>
        <Field label="SMS" hint="Fallback: send an SMS when a WhatsApp message cannot be delivered. Always: send SMS as well as WhatsApp."><select className="input" value={s.sms_mode ?? "fallback"} onChange={e => setS({ ...s, sms_mode: e.target.value })}><option value="fallback">Fallback when WhatsApp fails</option><option value="always">Always send SMS too</option><option value="off">Never send SMS</option></select></Field>
      </section>
      <section className="card grid gap-4 p-5 md:grid-cols-3">
        <h2 className="font-semibold md:col-span-3">Attendance</h2>
        <Field label="Students late after"><input className="input" type="time" value={(s.student_start_time ?? "07:45").slice(0, 5)} onChange={e => setS({ ...s, student_start_time: e.target.value })} /></Field>
        <Field label="Staff late after"><input className="input" type="time" value={(s.staff_start_time ?? "08:00").slice(0, 5)} onChange={e => setS({ ...s, staff_start_time: e.target.value })} /></Field>
        <div />
        <Field label="Staff self sign-in: latitude"><input className="input" step="any" {...num("geofence_lat")} /></Field>
        <Field label="Longitude"><input className="input" step="any" {...num("geofence_lng")} /></Field>
        <Field label="Radius (metres)" hint="Leave blank to allow sign-in from anywhere."><input className="input" {...num("geofence_radius_m")} /></Field>
        <div className="md:col-span-3"><button type="button" className="btn btn-ghost text-xs" onClick={useMyLocation}>Use my current location as the school</button></div>
      </section>
      <section className="card grid gap-4 p-5 md:grid-cols-4">
        <h2 className="font-semibold md:col-span-4">Library & exams</h2>
        <Field label="Loan period (days)"><input className="input" min={1} {...num("library_loan_days")} /></Field>
        <Field label="Fine per overdue day"><input className="input" min={0} step="any" {...num("library_fine_per_day")} /></Field>
        <Field label="Currency"><input className="input" {...text("currency")} /></Field>
        <Field label="Default exam violation limit" hint="Exam locks after this many integrity violations."><input className="input" min={1} {...num("exam_violation_limit")} /></Field>
      </section>
      <button className="btn btn-primary">Save settings</button>
    </form>
  );
}

/* ---------------- Academic ---------------- */
type Session = { id: string; name: string; is_current: boolean; terms: { id: string; name: string; is_current: boolean; starts_on: string | null; ends_on: string | null; next_term_begins: string | null }[] };
function Academic() {
  const { data, reload } = useApi<Session[]>("/api/school/academic");
  const [name, setName] = useState("");
  const [terms, setTerms] = useState("First Term, Second Term, Third Term");
  const { flash, node } = useFlash();
  async function act(body: Record<string, unknown>, ok: string) {
    const r = await send("/api/school/academic", body);
    flash(r.ok, r.ok ? ok : r.error ?? "failed");
    if (r.ok) reload();
  }
  return (
    <div className="space-y-5">
      {node}
      <form className="card flex flex-wrap items-end gap-3 p-5" onSubmit={e => { e.preventDefault(); act({ kind: "session", name, with_terms: terms.split(",").map(t => t.trim()).filter(Boolean) }, "Session created"); setName(""); }}>
        <Field label="New session"><input className="input" placeholder="2025/2026" value={name} onChange={e => setName(e.target.value)} required /></Field>
        <div className="min-w-[280px] flex-1"><Field label="Terms / semesters (comma separated)"><input className="input" value={terms} onChange={e => setTerms(e.target.value)} /></Field></div>
        <button className="btn btn-primary">Create</button>
      </form>
      {!data?.length ? <Empty>No sessions yet.</Empty> : data.map(s => (
        <section key={s.id} className="card p-5">
          <h3 className="mb-3 font-semibold">{s.name} {s.is_current && <Badge tone="green">current</Badge>}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-2">Term</th><th>Starts</th><th>Ends</th><th>Next term begins</th><th /></tr></thead>
              <tbody>
                {s.terms.map(t => <TermRow key={t.id} t={t} onSave={(b) => act({ kind: "update_term", term_id: t.id, ...b }, "Dates saved")} onCurrent={() => act({ kind: "set_current_term", term_id: t.id }, `${t.name} is now current`)} />)}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
function TermRow({ t, onSave, onCurrent }: { t: Session["terms"][number]; onSave: (b: Record<string, string | null>) => void; onCurrent: () => void }) {
  const [d, setD] = useState({ starts_on: t.starts_on ?? "", ends_on: t.ends_on ?? "", next_term_begins: t.next_term_begins ?? "" });
  const input = (k: keyof typeof d) => <input className="input py-1" type="date" value={d[k]} onChange={e => setD({ ...d, [k]: e.target.value })} aria-label={`${t.name} ${k}`} />;
  return (
    <tr className="border-t border-slate-100">
      <td className="py-2 font-medium">{t.name} {t.is_current && <Badge tone="green">current</Badge>}</td>
      <td className="pr-2">{input("starts_on")}</td><td className="pr-2">{input("ends_on")}</td><td className="pr-2">{input("next_term_begins")}</td>
      <td className="whitespace-nowrap py-2 text-right">
        <button className="btn btn-ghost text-xs" onClick={() => onSave({ starts_on: d.starts_on || null, ends_on: d.ends_on || null, next_term_begins: d.next_term_begins || null })}>Save dates</button>
        {!t.is_current && <button className="btn btn-ghost text-xs text-brand-700" onClick={onCurrent}>Make current</button>}
      </td>
    </tr>
  );
}

/* ---------------- Grading ---------------- */
type Scheme = {
  id?: string; name: string; is_default: boolean; pass_mark: number; show_position: boolean; show_class_average: boolean;
  cumulative_mode: string; decimals: number;
  grading_components?: { id?: string; name: string; max_score: number; weight: number }[];
  grade_bands?: { grade: string; min_score: number; max_score: number; remark: string | null; grade_point: number | null }[];
};
function Grading() {
  const { data, reload } = useApi<Scheme[]>("/api/school/grading");
  const [edit, setEdit] = useState<Scheme | null>(null);
  const { flash, node } = useFlash();
  useEffect(() => { if (data && !edit) setEdit(data[0] ?? null); /* eslint-disable-next-line */ }, [data]);

  async function save() {
    if (!edit) return;
    const r = await send("/api/school/grading", {
      id: edit.id, name: edit.name, is_default: edit.is_default, pass_mark: Number(edit.pass_mark), show_position: edit.show_position,
      show_class_average: edit.show_class_average, cumulative_mode: edit.cumulative_mode, decimals: Number(edit.decimals),
      components: (edit.grading_components ?? []).map(c => ({ ...c, max_score: Number(c.max_score), weight: Number(c.weight) })),
      bands: (edit.grade_bands ?? []).map(b => ({ ...b, min_score: Number(b.min_score), max_score: Number(b.max_score), grade_point: b.grade_point === null || (b.grade_point as unknown) === "" ? null : Number(b.grade_point) }))
    }, "PUT");
    flash(r.ok, r.ok ? "Grading scheme saved. Recompile results to apply it." : r.error ?? "failed");
    if (r.ok) { setEdit(null); reload(); }
  }
  const comps = edit?.grading_components ?? [];
  const bands = edit?.grade_bands ?? [];
  const weight = comps.reduce((a, c) => a + Number(c.weight || 0), 0);
  const setComp = (i: number, k: string, v: string) => setEdit(e => e && ({ ...e, grading_components: comps.map((c, j) => j === i ? { ...c, [k]: v } : c) }));
  const setBand = (i: number, k: string, v: string) => setEdit(e => e && ({ ...e, grade_bands: bands.map((b, j) => j === i ? { ...b, [k]: v } : b) }));

  return (
    <div className="space-y-5">
      {node}
      <div className="flex flex-wrap items-center gap-2">
        {(data ?? []).map(s => (
          <button key={s.id} className={"btn " + (edit?.id === s.id ? "btn-primary" : "btn-ghost border border-slate-200")} onClick={() => setEdit(s)}>
            {s.name} {s.is_default && "· default"}
          </button>
        ))}
        <button className="btn btn-ghost border border-dashed border-slate-300" onClick={() => setEdit({ name: "New scheme", is_default: false, pass_mark: 40, show_position: true, show_class_average: true, cumulative_mode: "average", decimals: 1, grading_components: [{ name: "Exam", max_score: 100, weight: 100 }], grade_bands: [{ grade: "A", min_score: 70, max_score: 100, remark: "Excellent", grade_point: 5 }, { grade: "F", min_score: 0, max_score: 69.99, remark: "Fail", grade_point: 0 }] })}>+ New scheme</button>
      </div>
      {edit && (
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="card space-y-4 p-5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Scheme name"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Pass mark (%)"><input className="input" type="number" value={edit.pass_mark} onChange={e => setEdit({ ...edit, pass_mark: e.target.value as unknown as number })} /></Field>
              <Field label="Decimal places"><input className="input" type="number" min={0} max={3} value={edit.decimals} onChange={e => setEdit({ ...edit, decimals: e.target.value as unknown as number })} /></Field>
              <Field label="Session result"><select className="input" value={edit.cumulative_mode} onChange={e => setEdit({ ...edit, cumulative_mode: e.target.value })}><option value="average">Average of terms</option><option value="none">No cumulative</option></select></Field>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={edit.is_default} onChange={e => setEdit({ ...edit, is_default: e.target.checked })} /> Default for classes without a scheme</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={edit.show_position} onChange={e => setEdit({ ...edit, show_position: e.target.checked })} /> Show positions</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={edit.show_class_average} onChange={e => setEdit({ ...edit, show_class_average: e.target.checked })} /> Show class average</label>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold">Assessment components</h3>
                <span className={"text-xs font-semibold " + (Math.abs(weight - 100) < 0.001 ? "text-emerald-600" : "text-rose-600")}>Weights total {weight}% (must be 100)</span>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500"><tr><th>Name</th><th>Max score</th><th>Weight %</th><th /></tr></thead>
                <tbody>
                  {comps.map((c, i) => (
                    <tr key={i}>
                      <td className="pr-2 py-1"><input className="input py-1" value={c.name} onChange={e => setComp(i, "name", e.target.value)} aria-label="Component name" /></td>
                      <td className="pr-2"><input className="input py-1" type="number" value={c.max_score} onChange={e => setComp(i, "max_score", e.target.value)} aria-label="Max score" /></td>
                      <td className="pr-2"><input className="input py-1" type="number" value={c.weight} onChange={e => setComp(i, "weight", e.target.value)} aria-label="Weight" /></td>
                      <td><button className="btn btn-ghost px-2 text-rose-600" onClick={() => setEdit({ ...edit, grading_components: comps.filter((_, j) => j !== i) })} aria-label="Remove component">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn btn-ghost mt-2 text-xs" onClick={() => setEdit({ ...edit, grading_components: [...comps, { name: `CA ${comps.length + 1}`, max_score: 10, weight: 10 }] })}>+ Add component</button>
              <p className="mt-2 text-xs text-slate-500">Each component can have any max score. Its contribution is score ÷ max × weight, so a 30-mark test worth 20% works as expected.</p>
            </div>
          </section>
          <section className="card p-5">
            <h3 className="mb-2 font-semibold">Grade bands</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th>Grade</th><th>From</th><th>To</th><th>Remark</th><th>Points</th><th /></tr></thead>
              <tbody>
                {bands.map((b, i) => (
                  <tr key={i}>
                    <td className="pr-1 py-1"><input className="input w-16 py-1" value={b.grade} onChange={e => setBand(i, "grade", e.target.value)} aria-label="Grade" /></td>
                    <td className="pr-1"><input className="input w-20 py-1" type="number" step="any" value={b.min_score} onChange={e => setBand(i, "min_score", e.target.value)} aria-label="From" /></td>
                    <td className="pr-1"><input className="input w-20 py-1" type="number" step="any" value={b.max_score} onChange={e => setBand(i, "max_score", e.target.value)} aria-label="To" /></td>
                    <td className="pr-1"><input className="input py-1" value={b.remark ?? ""} onChange={e => setBand(i, "remark", e.target.value)} aria-label="Remark" /></td>
                    <td className="pr-1"><input className="input w-16 py-1" type="number" step="any" value={b.grade_point ?? ""} onChange={e => setBand(i, "grade_point", e.target.value)} aria-label="Grade point" /></td>
                    <td><button className="btn btn-ghost px-2 text-rose-600" onClick={() => setEdit({ ...edit, grade_bands: bands.filter((_, j) => j !== i) })} aria-label="Remove band">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn btn-ghost mt-2 text-xs" onClick={() => setEdit({ ...edit, grade_bands: [...bands, { grade: "", min_score: 0, max_score: 0, remark: "", grade_point: null }] })}>+ Add band</button>
            <div className="mt-5 flex gap-2"><button className="btn btn-primary" onClick={save}>Save scheme</button></div>
          </section>
        </div>
      )}
    </div>
  );
}

/* ---------------- Classes & subjects ---------------- */
type Structure = {
  class_groups: { id: string; name: string; level: string | null; form_teacher_id: string | null; scheme_id: string | null; students: number }[];
  subjects: { id: string; name: string; code: string | null }[];
  offerings: { id: string; class_group_id: string; subject_id: string; teacher_id: string | null }[];
  staff: { id: string; full_name: string; role: string }[];
};
function Classes() {
  const { data, reload } = useApi<Structure>("/api/school/structure");
  const { data: schemes } = useApi<Scheme[]>("/api/school/grading");
  const [cg, setCg] = useState({ name: "", level: "" });
  const [subj, setSubj] = useState("");
  const [sel, setSel] = useState<string>("");
  const { flash, node } = useFlash();
  async function act(body: Record<string, unknown>, ok?: string) {
    const r = await send("/api/school/structure", body);
    if (!r.ok || ok) flash(r.ok, r.ok ? ok! : r.error ?? "failed");
    if (r.ok) reload();
  }
  const group = data?.class_groups.find(g => g.id === sel);
  const offered = (data?.offerings ?? []).filter(o => o.class_group_id === sel);
  const teachers = data?.staff ?? [];
  return (
    <div className="space-y-5">
      {node}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Classes</h2>
          <form className="mb-3 flex gap-2" onSubmit={e => { e.preventDefault(); act({ kind: "class_group", name: cg.name, level: cg.level || null }, "Class added"); setCg({ name: "", level: "" }); }}>
            <input className="input" placeholder="Class name, e.g. JSS1 Gold" value={cg.name} onChange={e => setCg({ ...cg, name: e.target.value })} required aria-label="Class name" />
            <input className="input w-32" placeholder="Level" value={cg.level} onChange={e => setCg({ ...cg, level: e.target.value })} aria-label="Level" />
            <button className="btn btn-primary">Add</button>
          </form>
          <ul className="divide-y divide-slate-100">
            {(data?.class_groups ?? []).map(g => (
              <li key={g.id}>
                <button onClick={() => setSel(g.id)} className={"flex w-full items-center justify-between px-2 py-2 text-left text-sm " + (sel === g.id ? "bg-brand-50" : "hover:bg-slate-50")}>
                  <span><span className="font-medium">{g.name}</span> <span className="text-slate-500">{g.level}</span></span>
                  <span className="text-xs text-slate-500">{g.students} students</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Subjects</h2>
          <form className="mb-3 flex gap-2" onSubmit={e => { e.preventDefault(); act({ kind: "subject", name: subj }, "Subject added"); setSubj(""); }}>
            <input className="input" placeholder="Subject name" value={subj} onChange={e => setSubj(e.target.value)} required aria-label="Subject name" />
            <button className="btn btn-primary">Add</button>
          </form>
          <div className="flex flex-wrap gap-2">
            {(data?.subjects ?? []).map(s => (
              <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-sm">
                {s.name}
                <button className="text-slate-400 hover:text-rose-600" aria-label={`Delete ${s.name}`} onClick={() => confirm(`Delete ${s.name}? Scores for it will be deleted too.`) && act({ kind: "delete", table: "subjects", id: s.id }, "Subject deleted")}>✕</button>
              </span>
            ))}
          </div>
        </section>
      </div>
      {group && (
        <section className="card p-5">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <h2 className="mr-auto text-lg font-semibold">{group.name}</h2>
            <Field label="Form teacher">
              <select className="input" value={group.form_teacher_id ?? ""} onChange={e => act({ kind: "class_group", id: group.id, name: group.name, level: group.level, scheme_id: group.scheme_id, form_teacher_id: e.target.value || null }, "Form teacher set")}>
                <option value="">— none —</option>
                {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </select>
            </Field>
            <Field label="Grading scheme">
              <select className="input" value={group.scheme_id ?? ""} onChange={e => act({ kind: "class_group", id: group.id, name: group.name, level: group.level, form_teacher_id: group.form_teacher_id, scheme_id: e.target.value || null }, "Scheme set")}>
                <option value="">School default</option>
                {(schemes ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <button className="btn btn-ghost border border-slate-200" onClick={() => act({ kind: "offer_all", class_group_id: group.id }, "All subjects added")}>Offer all subjects</button>
            <button className="btn btn-ghost text-rose-600" onClick={() => confirm(`Delete ${group.name}? Students stay but lose their class.`) && act({ kind: "delete", table: "class_groups", id: group.id }, "Class deleted").then(() => setSel(""))}>Delete class</button>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-2">Subject</th><th>Subject teacher (can enter scores)</th><th /></tr></thead>
            <tbody>
              {(data?.subjects ?? []).map(s => {
                const o = offered.find(x => x.subject_id === s.id);
                return (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="py-2">{s.name}</td>
                    <td>
                      {o ? (
                        <select className="input max-w-xs py-1" value={o.teacher_id ?? ""} aria-label={`${s.name} teacher`}
                          onChange={e => act({ kind: "offering", class_group_id: group.id, subject_id: s.id, teacher_id: e.target.value || null })}>
                          <option value="">— unassigned —</option>
                          {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                        </select>
                      ) : <span className="text-slate-400">not offered</span>}
                    </td>
                    <td className="text-right">
                      {o ? <button className="btn btn-ghost text-xs text-rose-600" onClick={() => act({ kind: "delete", table: "subject_offerings", id: o.id })}>Remove</button>
                        : <button className="btn btn-ghost text-xs" onClick={() => act({ kind: "offering", class_group_id: group.id, subject_id: s.id })}>Offer</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
