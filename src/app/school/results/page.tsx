"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Badge, statusTone, Empty, Field, Modal, Loading, fmtDate } from "@/components/ui";
import { subjectTotal, gradeFor as bandFor, round } from "@/lib/grading";
import { DEFAULT_SCALE, SCALE_PRESETS, TRAIT_PRESETS, areaTitle, scaleKey, type ScaleItem } from "@/lib/traits";

type Session = { id: string; name: string; terms: { id: string; name: string; is_current: boolean }[] };
type Structure = {
  class_groups: { id: string; name: string; form_teacher_id: string | null }[];
  subjects: { id: string; name: string; department_id?: string | null }[];
  offerings: { class_group_id: string; subject_id: string; teacher_id: string | null }[];
  departments?: { id: string; name: string; head_user_id: string | null }[];
};
type Sheet = {
  scheme: { name: string; components: { id: string; name: string; max_score: number; weight: number }[]; bands: { grade: string; min_score: number; max_score: number }[]; pass_mark: number; decimals: number };
  students: { id: string; admission_no: string; first_name: string; last_name: string; other_names: string | null }[];
  scores: Record<string, Record<string, number | null>>;
  can_edit: boolean;
  teaches: boolean; moderation: boolean; locked: boolean;
  sheet: { status: string; note?: string | null };
};
type SheetStatus = { subject_id: string; subject: string; status: string; note: string | null; i_teach: boolean; i_am_hod: boolean; history: { action: string; note: string | null; at: string; by: string | null }[] };
const SHEET_LABEL: Record<string, string> = { draft: "Not submitted", submitted: "Waiting for head of department", hod_approved: "Waiting for principal", approved: "Approved", returned: "Returned for correction" };
const SHEET_TONE: Record<string, "slate" | "amber" | "blue" | "green" | "red"> = { draft: "slate", submitted: "amber", hod_approved: "blue", approved: "green", returned: "red" };
type Card = {
  id: string; student_id: string; total: number | null; average: number | null; position: number | null; class_size: number | null;
  status: string; teacher_comment: string | null; principal_comment: string | null; access_token: string;
  data: { student_name: string; admission_no: string; subjects: { subject_id: string; subject: string; total: number | null; grade: string | null; complete: boolean }[] };
};

export default function ResultsPage() {
  const { data: sessions } = useApi<Session[]>("/api/school/academic");
  const { data: structure } = useApi<Structure>("/api/school/structure");
  const { data: me } = useApi<{ profile: { id: string; role: string; extra_roles: string[] } | null }>("/api/me");
  const [termId, setTermId] = useState("");
  const [cg, setCg] = useState("");
  const [tab, setTab] = useState<"scores" | "traits" | "cards" | "approvals">("scores");

  useEffect(() => {
    if (termId || !sessions) return;
    const cur = sessions.flatMap(s => s.terms).find(t => t.is_current) ?? sessions[0]?.terms[0];
    if (cur) setTermId(cur.id);
  }, [sessions, termId]);
  useEffect(() => { if (!cg && structure?.class_groups[0]) setCg(structure.class_groups[0].id); }, [structure, cg]);

  const roles = new Set([me?.profile?.role, ...(me?.profile?.extra_roles ?? [])]);
  const isAdmin = ["school_admin", "principal", "platform_admin"].some(r => roles.has(r));

  return (
    <Page wide>
      <PageHeader eyebrow="Results" title="Scores & report cards"
        subtitle="Teachers enter scores for the subjects they teach. The form teacher or an admin compiles report cards. An admin publishes them, and parents get them on WhatsApp and email right away." />
      <div className="mb-5 flex flex-wrap gap-3">
        <Field label="Term">
          <select className="input min-w-[220px]" value={termId} onChange={e => setTermId(e.target.value)}>
            {(sessions ?? []).map(s => <optgroup key={s.id} label={s.name}>{s.terms.map(t => <option key={t.id} value={t.id}>{t.name} {s.name}{t.is_current ? " (current)" : ""}</option>)}</optgroup>)}
          </select>
        </Field>
        <Field label="Class">
          <select className="input min-w-[180px]" value={cg} onChange={e => setCg(e.target.value)}>
            {(structure?.class_groups ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
      </div>
      {!sessions?.length && sessions && <Alert tone="amber">Create an academic session under School setup first.</Alert>}
      {termId && cg && (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: "scores", label: "Score entry" }, { id: "traits", label: "Character & skills" }, { id: "approvals", label: "Approvals" }, { id: "cards", label: "Report cards & publishing" }]} />
          {tab === "approvals" && <Approvals termId={termId} cg={cg} />}
          {tab === "traits" && <Traits termId={termId} cg={cg} isAdmin={isAdmin} />}
          {tab === "scores" && <ScoreEntry termId={termId} cg={cg} structure={structure} myId={me?.profile?.id} isAdmin={isAdmin} />}
          {tab === "cards" && <ReportCards termId={termId} cg={cg} isAdmin={isAdmin} isFormTeacher={structure?.class_groups.find(g => g.id === cg)?.form_teacher_id === me?.profile?.id} />}
        </>
      )}
    </Page>
  );
}

function ScoreEntry({ termId, cg, structure, myId, isAdmin }: { termId: string; cg: string; structure: Structure | null; myId?: string; isAdmin: boolean }) {
  const offered = (structure?.offerings ?? []).filter(o => o.class_group_id === cg);
  const subjects = (structure?.subjects ?? []).filter(s => !offered.length || offered.some(o => o.subject_id === s.id));
  // Heads of department may open their department's sheets read-only to review them.
  const hodOf = new Set((structure?.departments ?? []).filter(d => d.head_user_id === myId).map(d => d.id));
  const mine = subjects.filter(s => isAdmin || offered.some(o => o.subject_id === s.id && o.teacher_id === myId) || structure?.class_groups.find(g => g.id === cg)?.form_teacher_id === myId
    || (s.department_id && hodOf.has(s.department_id)));
  const [subject, setSubject] = useState("");
  const mineKey = mine.map(s => s.id).join(",");
  useEffect(() => {
    const ids = mineKey ? mineKey.split(",") : [];
    if (!ids.includes(subject)) setSubject(ids[0] ?? "");
  }, [mineKey, subject]);
  const { data, error, reload } = useApi<Sheet>(subject ? `/api/results/scores?term_id=${termId}&class_group_id=${cg}&subject_id=${subject}` : null, [termId, cg, subject]);
  const [grid, setGrid] = useState<Record<string, Record<string, string>>>({});
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(false);

  useEffect(() => {
    if (!data) return;
    const g: Record<string, Record<string, string>> = {};
    for (const s of data.students) {
      g[s.id] = {};
      for (const c of data.scheme.components) { const v = data.scores[s.id]?.[c.id]; g[s.id][c.id] = v === null || v === undefined ? "" : String(v); }
    }
    setGrid(g); setDirty(false); setMsg(null);
  }, [data]);

  const comps = data?.scheme.components ?? [];
  // Same arithmetic and rounding as the compiled report card.
  const totalFor = (sid: string) => {
    const scores = Object.fromEntries(comps.map(c => { const v = grid[sid]?.[c.id] ?? ""; return [c.id, v === "" ? null : Number(v)]; }));
    const { total } = subjectTotal(scores, comps, 4);
    return total === null ? null : round(total, data?.scheme.decimals ?? 1);
  };
  const gradeFor = (t: number | null) => bandFor(t, data?.scheme.bands ?? [])?.grade ?? "";
  const invalid = (c: { max_score: number }, v: string) => v !== "" && (isNaN(Number(v)) || Number(v) < 0 || Number(v) > c.max_score);
  const hasInvalid = data ? data.students.some(s => comps.some(c => invalid(c, grid[s.id]?.[c.id] ?? ""))) : false;

  async function moderate(action: "submit") {
    if (dirty && !confirm("You have unsaved scores. Submit without them?")) return;
    const r = await send("/api/results/moderation", { term_id: termId, class_group_id: cg, subject_id: subject, action });
    setMsg({ ok: r.ok, text: r.ok ? "Submitted for approval. The scores are locked until they are approved or returned." : r.error ?? "failed" });
    if (r.ok) reload();
  }

  async function save() {
    if (!data) return;
    setBusy(true);
    const entries = data.students.flatMap(s => comps.map(c => {
      const v = grid[s.id]?.[c.id] ?? "";
      return { student_id: s.id, component_id: c.id, score: v === "" ? null : Number(v) };
    })).filter(e => {
      const orig = data.scores[e.student_id]?.[e.component_id];
      return (orig ?? null) !== e.score;
    });
    const r = await send("/api/results/scores", { term_id: termId, class_group_id: cg, subject_id: subject, entries }, "PUT");
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? `Saved ${r.data.saved} scores${r.data.cleared ? `, cleared ${r.data.cleared}` : ""}.` : r.error ?? "failed" });
    if (r.ok) reload();
  }

  // Enter moves down the column like a spreadsheet.
  function onKey(e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const next = document.querySelector<HTMLInputElement>(`[data-cell="${row + 1}-${col}"]`);
    next?.focus(); next?.select();
  }

  if (!subjects.length) return <Empty>No subjects are offered in this class yet. Set them up under School setup → Classes & subjects.</Empty>;
  if (!mine.length) return <Empty>You are not assigned to teach any subject in this class.</Empty>;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Subject">
          <select className="input min-w-[200px]" value={subject} onChange={e => { if (!dirty || confirm("Discard unsaved scores?")) setSubject(e.target.value); }}>
            {mine.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        {data && <p className="pb-2 text-xs text-slate-500">Scheme: {data.scheme.name}. {comps.map(c => `${c.name} /${c.max_score} (${c.weight}%)`).join(" · ")}</p>}
        <div className="ml-auto flex gap-2 pb-0.5">
          <button className="btn btn-ghost" onClick={() => { if (!dirty || confirm("Discard unsaved scores?")) setNotes(n => !n); }}>{notes ? "Back to scores" : "Comments & targets"}</button>
          {dirty && <span className="self-center text-xs text-amber-600">Unsaved changes</span>}
          {!notes && <button className="btn btn-primary" onClick={save} disabled={!dirty || busy || hasInvalid || !data?.can_edit}>{busy ? "Saving…" : "Save scores"}</button>}
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {data?.moderation && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <span>Approval:</span><Badge tone={SHEET_TONE[data.sheet.status] ?? "slate"}>{SHEET_LABEL[data.sheet.status] ?? data.sheet.status}</Badge>
          {data.sheet.status === "returned" && data.sheet.note && <span className="text-rose-700">“{data.sheet.note}”</span>}
          {data.teaches && ["draft", "returned"].includes(data.sheet.status) && <button className="btn btn-outline ml-auto" disabled={!data.students.length} onClick={() => moderate("submit")}>Submit for approval</button>}
        </div>
      )}
      {data && data.locked && !data.can_edit && <div className="mb-3"><Alert tone="blue">These scores have been submitted and are locked. The head of department or principal can return them for correction.</Alert></div>}
      {data && !data.can_edit && !data.locked && <div className="mb-3"><Alert tone="amber">View only: you are not the subject teacher for this class.</Alert></div>}
      {data && notes && <SubjectNotes termId={termId} cg={cg} subject={subject} students={data.students} canEdit={data.teaches} bands={data.scheme.bands} />}
      {data && !notes && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[13px] text-slate-500">
              <tr><th className="p-2">#</th><th className="p-2">Student</th>{comps.map(c => <th key={c.id} className="p-2 text-center">{c.name}<div className="font-normal normal-case">/ {c.max_score}</div></th>)}<th className="p-2 text-center">Total</th><th className="p-2 text-center">Grade</th></tr>
            </thead>
            <tbody>
              {data.students.map((s, i) => {
                const t = totalFor(s.id);
                return (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="p-2 text-xs text-slate-400">{i + 1}</td>
                    <td className="p-2"><span className="font-medium">{s.last_name}, {s.first_name}</span> <span className="text-xs text-slate-400">{s.admission_no}</span></td>
                    {comps.map((c, j) => {
                      const v = grid[s.id]?.[c.id] ?? "";
                      return (
                        <td key={c.id} className="p-1 text-center">
                          <input data-cell={`${i}-${j}`} inputMode="decimal" disabled={!data.can_edit} aria-label={`${s.first_name} ${c.name}`}
                            className={"w-20 rounded border px-2 py-1 text-center tabular-nums " + (invalid(c, v) ? "border-rose-400 bg-rose-50" : "border-slate-300")}
                            value={v} onKeyDown={e => onKey(e, i, j)}
                            onChange={e => { setGrid(g => ({ ...g, [s.id]: { ...g[s.id], [c.id]: e.target.value.trim() } })); setDirty(true); }} />
                        </td>
                      );
                    })}
                    <td className="p-2 text-center font-semibold tabular-nums">{t ?? "—"}</td>
                    <td className="p-2 text-center font-semibold">{gradeFor(t)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!data.students.length && <p className="p-4 text-sm text-slate-500">No active students in this class.</p>}
        </div>
      )}
    </div>
  );
}

function Approvals({ termId, cg }: { termId: string; cg: string }) {
  const queue = useApi<{ moderation: boolean; is_admin: boolean; is_hod: boolean; queue: { id: string; class_group_id: string; subject_id: string; status: string; class_name: string; subject: string; submitted_by: string | null; submitted_at: string; my_step: "hod" | "final" }[] }>(`/api/results/moderation?term_id=${termId}&queue=1`, [termId]);
  const cls = useApi<{ moderation: boolean; is_admin: boolean; sheets: SheetStatus[] }>(`/api/results/moderation?term_id=${termId}&class_group_id=${cg}`, [termId, cg]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  async function act(classId: string, subjectId: string, action: string, needNote = false, hint = "") {
    let note: string | null = null;
    if (needNote) { note = prompt(hint || "What needs correcting?"); if (!note) return; }
    const r = await send("/api/results/moderation", { term_id: termId, class_group_id: classId, subject_id: subjectId, action, note });
    setMsg({ ok: r.ok, text: r.ok ? "Done." : r.error ?? "failed" });
    queue.reload(); cls.reload();
  }
  if (queue.data && !queue.data.moderation) return <Empty>Score approval is off. An admin can turn it on under School setup → Departments &amp; approval.</Empty>;
  return (
    <div className="space-y-5">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <section>
        <h3 className="mb-2 font-semibold">Waiting for you</h3>
        {!queue.data ? <Loading /> : !queue.data.queue.length ? <Empty>{queue.data.is_admin || queue.data.is_hod ? "Nothing waiting for your approval this term." : "Only heads of department and the principal approve scores."}</Empty> : (
          <ul className="card divide-y divide-slate-100 text-sm">
            {queue.data.queue.map(q => (
              <li key={q.id} className="flex flex-wrap items-center gap-2 p-3">
                <span className="font-medium">{q.class_name} · {q.subject}</span>
                <Badge tone={SHEET_TONE[q.status]}>{SHEET_LABEL[q.status]}</Badge>
                <span className="text-xs text-slate-500">{q.submitted_by ? `by ${q.submitted_by}` : ""}</span>
                <span className="ml-auto flex gap-1">
                  {q.my_step === "hod"
                    ? <button className="btn btn-success px-2 py-1 text-xs" onClick={() => act(q.class_group_id, q.subject_id, "hod_approve")}>Approve</button>
                    : <button className="btn btn-success px-2 py-1 text-xs" onClick={() => q.status === "submitted" ? act(q.class_group_id, q.subject_id, "approve", true, "The head of department has not approved these yet. Why approve now?") : act(q.class_group_id, q.subject_id, "approve")}>Final approval</button>}
                  <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => act(q.class_group_id, q.subject_id, "return", true)}>Return</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-slate-500">Open Score entry for the class and subject to read the scores before approving.</p>
      </section>
      <section>
        <h3 className="mb-2 font-semibold">This class</h3>
        {!cls.data ? <Loading /> : !cls.data.sheets.length ? <Empty>No subjects are set up for this class.</Empty> : (
          <ul className="card divide-y divide-slate-100 text-sm">
            {cls.data.sheets.map(s => (
              <li key={s.subject_id} className="p-3">
                <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === s.subject_id ? null : s.subject_id)}>
                  <span className="font-medium">{s.subject}</span><Badge tone={SHEET_TONE[s.status]}>{SHEET_LABEL[s.status]}</Badge>
                  {s.note && s.status === "returned" && <span className="text-xs text-rose-700">“{s.note}”</span>}
                  {cls.data!.is_admin && s.status === "approved" && <span className="ml-auto"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={e => { e.stopPropagation(); act(cg, s.subject_id, "return", true, "Why reopen these approved scores?"); }}>Reopen</button></span>}
                </button>
                {open === s.subject_id && (s.history.length ? (
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-600">{s.history.map((h, i) => <li key={i}>{fmtDate(h.at, true)} · {h.by ?? "someone"} · {h.action.replace("_", " ")}{h.note ? `: ${h.note}` : ""}</li>)}</ul>
                ) : <p className="mt-2 text-xs text-slate-500">No activity yet.</p>)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type Note = { comment: string; effort: string; target_grade: string; predicted_grade: string };

/** Per-subject report comments, effort, target and predicted grades (printed on British-style cards). */
function SubjectNotes({ termId, cg, subject, students, canEdit, bands }: { termId: string; cg: string; subject: string; students: Sheet["students"]; canEdit: boolean; bands: { grade: string }[] }) {
  const { data, reload } = useApi<{ notes: Record<string, Partial<Note>> }>(`/api/results/subject-comments?term_id=${termId}&class_group_id=${cg}&subject_id=${subject}`, [termId, cg, subject]);
  const [rows, setRows] = useState<Record<string, Note>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!data) return;
    setRows(Object.fromEntries(students.map(s => { const n = data.notes[s.id] ?? {}; return [s.id, { comment: n.comment ?? "", effort: n.effort ?? "", target_grade: n.target_grade ?? "", predicted_grade: n.predicted_grade ?? "" }]; })));
  }, [data, students]);
  const set = (id: string, k: keyof Note, v: string) => setRows(r => ({ ...r, [id]: { ...r[id], [k]: v } }));
  async function save() {
    const r = await send("/api/results/subject-comments", { term_id: termId, subject_id: subject, notes: students.map(s => ({ student_id: s.id, ...rows[s.id] })) }, "PUT");
    setMsg({ ok: r.ok, text: r.ok ? "Saved. Recompile report cards to include them." : r.error ?? "failed" });
    if (r.ok) reload();
  }
  if (!data) return <Loading />;
  const grades = bands.map(b => b.grade);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Effort uses 1 (excellent) to 4 (cause for concern). Leave <i>Predicted</i> blank to let the system forecast it from the student&apos;s results so far.</p>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Student</th><th className="p-2">Comment</th><th className="p-2">Effort</th><th className="p-2">Target</th><th className="p-2">Predicted</th></tr></thead>
          <tbody>{students.map(s => (
            <tr key={s.id} className="border-t border-slate-100">
              <td className="whitespace-nowrap p-2 font-medium">{s.last_name}, {s.first_name}</td>
              <td className="p-1"><input className="input py-1" disabled={!canEdit} maxLength={600} value={rows[s.id]?.comment ?? ""} onChange={e => set(s.id, "comment", e.target.value)} aria-label={`Comment for ${s.first_name}`} /></td>
              <td className="p-1"><select className="input w-20 py-1" disabled={!canEdit} value={rows[s.id]?.effort ?? ""} onChange={e => set(s.id, "effort", e.target.value)} aria-label={`Effort for ${s.first_name}`}><option value="">—</option>{["1", "2", "3", "4"].map(x => <option key={x}>{x}</option>)}</select></td>
              <td className="p-1"><select className="input w-24 py-1" disabled={!canEdit} value={rows[s.id]?.target_grade ?? ""} onChange={e => set(s.id, "target_grade", e.target.value)} aria-label={`Target for ${s.first_name}`}><option value="">—</option>{grades.map(g => <option key={g}>{g}</option>)}</select></td>
              <td className="p-1"><select className="input w-24 py-1" disabled={!canEdit} value={rows[s.id]?.predicted_grade ?? ""} onChange={e => set(s.id, "predicted_grade", e.target.value)} aria-label={`Predicted grade for ${s.first_name}`}><option value="">Auto</option>{grades.map(g => <option key={g}>{g}</option>)}</select></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {canEdit && <div className="flex justify-end"><button className="btn btn-primary" onClick={save}>Save comments &amp; targets</button></div>}
    </div>
  );
}

function ReportCards({ termId, cg, isAdmin, isFormTeacher }: { termId: string; cg: string; isAdmin: boolean; isFormTeacher: boolean }) {
  const [kind, setKind] = useState<"term" | "midterm">("term");
  const { data, error, reload } = useApi<Card[]>(`/api/results/report-cards?term_id=${termId}&class_group_id=${cg}&kind=${kind}`, [termId, cg, kind]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Card | null>(null);
  const [style, setStyle] = useState<{ tone: string; length: string; overwrite: boolean }>({ tone: "warm", length: "short", overwrite: false });
  const subjects = useMemo(() => {
    const out: { id: string; name: string }[] = [];
    for (const c of data ?? []) for (const s of c.data?.subjects ?? []) if (!out.some(x => x.id === s.subject_id)) out.push({ id: s.subject_id, name: s.subject });
    return out;
  }, [data]);

  async function compile(force = false) {
    setBusy("compile");
    const r = await send("/api/results/compute", { term_id: termId, class_group_id: cg, force, kind });
    setBusy(null);
    setMsg({ ok: r.ok, text: r.ok ? `Compiled ${r.data.computed} report cards${r.data.skipped_published ? ` (${r.data.skipped_published} already published were kept)` : ""}.` : r.error ?? "failed" });
    if (r.ok) reload();
  }
  async function publish(resend = false) {
    const draft = (data ?? []).filter(c => c.status === "draft" || c.status === "approved").length;
    if (!confirm(resend ? "Send the published results to parents again?" : `Publish ${draft} report cards and send them to parents by WhatsApp and email now?`)) return;
    setBusy("publish");
    const r = await send("/api/results/publish", { term_id: termId, class_group_id: cg, resend, kind });
    setBusy(null);
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "failed" }); return; }
    const d = r.data;
    const del = d.delivery ? ` Delivered now: ${d.delivery.sent}. Retrying: ${d.delivery.retry}. Failed: ${d.delivery.failed}. Not configured: ${d.delivery.skipped}.` : "";
    const missing = d.students_without_contacts?.length ? ` No contact on file for: ${d.students_without_contacts.join(", ")}.` : "";
    setMsg({ ok: true, text: `Published ${d.published}. ${d.messages_queued} messages queued.${del}${missing}` });
    reload();
  }
  async function draftComments(role: "form_teacher" | "principal") {
    setBusy("draft_" + role);
    if (style.overwrite && !confirm("Rewrite every unpublished comment in this class, including ones already written?")) { setBusy(null); return; }
    const r = await send("/api/results/draft-comments", { term_id: termId, class_group_id: cg, role, kind, tone: style.tone, length: style.length, overwrite: style.overwrite });
    setBusy(null);
    setMsg({ ok: r.ok, text: r.ok ? `Drafted ${r.data.drafted} comments${r.data.note ? ` (${r.data.note})` : ""}. Read and edit them before publishing.` : r.error ?? "failed" });
    if (r.ok) reload();
  }
  /** A fresh draft for one student, shown in the form and saved only when the teacher saves. */
  async function writeOne(card: Card, role: "form_teacher" | "principal"): Promise<string | null> {
    const r = await send("/api/results/draft-comments", { term_id: termId, class_group_id: cg, role, kind, tone: style.tone, length: style.length, student_id: card.student_id, preview: true });
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "failed" }); return null; }
    return r.data.comments?.[card.student_id] ?? null;
  }
  async function patch(id: string, body: Record<string, unknown>) {
    const r = await send("/api/results/report-cards", { id, ...body }, "PATCH");
    if (!r.ok) setMsg({ ok: false, text: r.error ?? "failed" });
    reload();
  }

  const incomplete = (data ?? []).filter(c => c.data?.subjects?.some(s => s.total !== null && !s.complete)).length;
  const printUrl = (view: string) => `/school/results/print?term=${termId}&class=${cg}&kind=${kind}&view=${view}`;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5" role="group" aria-label="Report type">
          {(["term", "midterm"] as const).map(k => <button key={k} className={"rounded-md px-3 py-1 text-sm " + (kind === k ? "bg-brand-600 text-white" : "text-slate-600")} onClick={() => setKind(k)} aria-pressed={kind === k}>{k === "term" ? "End of term" : "Mid-term"}</button>)}
        </div>
        {data && data.length > 0 && <>
          <a className="btn btn-ghost text-xs" href={printUrl("cards")} target="_blank" rel="noreferrer">Print all cards (PDF)</a>
          <a className="btn btn-ghost text-xs" href={printUrl("broadsheet")} target="_blank" rel="noreferrer">Broadsheet</a>
          <a className="btn btn-ghost text-xs" href={printUrl("master")} target="_blank" rel="noreferrer">Master score sheet</a>
        </>}
      </div>
      {kind === "midterm" && <p className="mb-3 text-xs text-slate-500">Mid-term reports use only the assessments ticked as mid-term under School setup → Grading.</p>}
      <div className="mb-4 flex flex-wrap gap-2">
        {(isAdmin || isFormTeacher) && <button className="btn btn-outline" disabled={busy !== null} onClick={() => compile(false)}>{busy === "compile" ? "Compiling…" : "Compile report cards"}</button>}
        {isAdmin && <button className="btn btn-outline" disabled={busy !== null} onClick={() => confirm("Recompute published report cards too? Parents will see the new figures on their link.") && compile(true)}>Recompute all</button>}
        {isAdmin && <button className="btn btn-primary" disabled={busy !== null || !data?.length} onClick={() => publish(false)}>{busy === "publish" ? "Publishing and sending…" : "Publish & send to parents"}</button>}
        {isAdmin && <button className="btn btn-ghost" disabled={busy !== null} onClick={() => publish(true)}>Resend</button>}
        {(isAdmin || isFormTeacher) && <button className="btn btn-outline" disabled={busy !== null || !data?.length} onClick={() => draftComments("form_teacher")}>{busy === "draft_form_teacher" ? "Drafting comments…" : "Draft teacher comments"}</button>}
        {isAdmin && <button className="btn btn-outline" disabled={busy !== null || !data?.length} onClick={() => draftComments("principal")}>{busy === "draft_principal" ? "Drafting comments…" : "Draft principal comments"}</button>}
        <a className="btn btn-ghost ml-auto" href={`/api/results/report-cards?term_id=${termId}&class_group_id=${cg}&kind=${kind}&format=csv`}>Download broadsheet (CSV)</a>
      </div>
      {(isAdmin || isFormTeacher) && (data?.length ?? 0) > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <span className="font-medium text-slate-700">Comment style</span>
          <select className="input w-auto py-1 text-sm" aria-label="Tone" value={style.tone} onChange={e => setStyle({ ...style, tone: e.target.value })}>
            <option value="warm">Warm</option><option value="formal">Formal</option><option value="encouraging">Encouraging</option><option value="firm">Firm</option>
          </select>
          <select className="input w-auto py-1 text-sm" aria-label="Length" value={style.length} onChange={e => setStyle({ ...style, length: e.target.value })}>
            <option value="short">Short (1–2 sentences)</option><option value="medium">Longer (2–3 sentences)</option>
          </select>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={style.overwrite} onChange={e => setStyle({ ...style, overwrite: e.target.checked })} /> Rewrite comments already written</label>
          <span className="text-xs text-slate-500">Each comment uses the student&apos;s own subjects, progress since last term, attendance and conduct ratings.</span>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {incomplete > 0 && <div className="mb-3"><Alert tone="amber">{incomplete} students have subjects with missing components (for example no exam score yet). Check before publishing.</Alert></div>}
      {!data?.length ? <Empty>No report cards yet. Enter scores, then compile.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[13px] text-slate-500">
              <tr><th className="p-2">Pos</th><th className="p-2">Student</th>{subjects.map(s => <th key={s.id} className="p-2 text-center">{s.name}</th>)}<th className="p-2 text-center">Avg</th><th className="p-2">Status</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {data.map(c => {
                const by = new Map(c.data.subjects.map(s => [s.subject_id, s]));
                return (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="p-2 font-semibold tabular-nums">{c.position ?? "—"}</td>
                    <td className="p-2"><span className="font-medium">{c.data.student_name}</span> <span className="text-xs text-slate-400">{c.data.admission_no}</span></td>
                    {subjects.map(s => { const r = by.get(s.id); return <td key={s.id} className={"p-2 text-center tabular-nums " + (r && !r.complete && r.total !== null ? "text-amber-600" : "")}>{r?.total ?? "—"}<span className="ml-1 text-xs text-slate-500">{r?.grade ?? ""}</span></td>; })}
                    <td className="p-2 text-center font-semibold tabular-nums">{c.average ?? "—"}</td>
                    <td className="p-2"><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
                    <td className="whitespace-nowrap p-2 text-right">
                      {(isAdmin || (isFormTeacher && c.status !== "published")) && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(c)}>Comments</button>}
                      <a className="btn btn-ghost px-2 py-1 text-xs" href={`/r/${c.access_token}`} target="_blank" rel="noreferrer">Preview</a>
                      {isAdmin && c.status !== "published" && (c.status === "withheld"
                        ? <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => patch(c.id, { status: "draft" })}>Release hold</button>
                        : <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => patch(c.id, { status: "withheld" })}>Withhold</button>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Comments: ${editing?.data.student_name ?? ""}`}>
        {editing && <CommentForm card={editing} isAdmin={isAdmin} draft={(role) => writeOne(editing, role)} onSave={async (b) => { await patch(editing.id, b); setEditing(null); }} />}
      </Modal>
    </div>
  );
}

function CommentForm({ card, isAdmin, onSave, draft }: { card: Card; isAdmin: boolean; onSave: (b: Record<string, unknown>) => void; draft: (role: "form_teacher" | "principal") => Promise<string | null> }) {
  const [t, setT] = useState(card.teacher_comment ?? "");
  const [p, setP] = useState(card.principal_comment ?? "");
  const [writing, setWriting] = useState<string | null>(null);
  const write = async (role: "form_teacher" | "principal") => {
    setWriting(role);
    const text = await draft(role);
    setWriting(null);
    if (text) (role === "principal" ? setP : setT)(text);
  };
  const writeBtn = (role: "form_teacher" | "principal") => (
    <button type="button" className="btn btn-ghost px-2 py-1 text-xs" disabled={writing !== null} onClick={() => write(role)}>{writing === role ? "Writing…" : "Write for me"}</button>
  );
  return (
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); onSave(isAdmin ? { teacher_comment: t, principal_comment: p } : { teacher_comment: t }); }}>
      <div className="flex justify-end -mb-2">{writeBtn("form_teacher")}</div>
      <Field label="Form teacher's comment"><textarea className="input h-24" value={t} onChange={e => setT(e.target.value)} maxLength={600} /></Field>
      <CommentBankPicker role="form_teacher" average={card.average} name={card.data.student_name} onPick={setT} isAdmin={isAdmin} />
      {isAdmin && <div className="flex justify-end -mb-2">{writeBtn("principal")}</div>}
      {isAdmin && <Field label="Principal's comment"><textarea className="input h-24" value={p} onChange={e => setP(e.target.value)} maxLength={600} /></Field>}
      {isAdmin && <CommentBankPicker role="principal" average={card.average} name={card.data.student_name} onPick={setP} isAdmin={isAdmin} />}
      <div className="flex justify-end"><button className="btn btn-primary">Save</button></div>
    </form>
  );
}

type BankComment = { id: string; role: string; min_average: number | null; max_average: number | null; text: string; fits: boolean; mine: boolean };

/** Comment bank suggestions for a report card; matching ones (by average) first. Staff can add their own. */
function CommentBankPicker({ role, average, name, onPick, isAdmin }: { role: "form_teacher" | "principal"; average: number | null; name: string; onPick: (t: string) => void; isAdmin: boolean }) {
  const { data, reload } = useApi<BankComment[]>(`/api/results/comment-bank?role=${role}${average !== null ? `&average=${average}` : ""}`, [role, average]);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ text: "", min: "", max: "" });
  const first = String(name ?? "").split(" ")[0] || "The student";
  const fill = (text: string) => text.replace(/\{name\}/g, first);
  async function add() {
    const r = await send("/api/results/comment-bank", { action: "save", role, text: f.text, min_average: f.min === "" ? null : Number(f.min), max_average: f.max === "" ? null : Number(f.max) });
    if (r.ok) { setAdding(false); setF({ text: "", min: "", max: "" }); reload(); }
  }
  const list = (data ?? []).slice(0, 8);
  return (
    <div className="rounded-lg bg-slate-50 p-2 text-xs">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-semibold text-slate-600">Comment bank</span>
        <button type="button" className="text-brand-700 hover:underline" onClick={() => setAdding(a => !a)}>{adding ? "Cancel" : "+ Add"}</button>
        {isAdmin && data && !data.length && <button type="button" className="text-brand-700 hover:underline" onClick={async () => { await send("/api/results/comment-bank", { action: "seed" }); reload(); }}>Add starter comments</button>}
      </div>
      {adding && (
        <div className="mb-2 space-y-1">
          <input className="input py-1 text-xs" placeholder="Comment. Write {name} for the student's first name." value={f.text} onChange={e => setF({ ...f, text: e.target.value })} aria-label="New bank comment" />
          <div className="flex items-center gap-1">For averages from <input className="input w-16 py-1 text-xs" type="number" value={f.min} onChange={e => setF({ ...f, min: e.target.value })} aria-label="From average" /> to <input className="input w-16 py-1 text-xs" type="number" value={f.max} onChange={e => setF({ ...f, max: e.target.value })} aria-label="To average" />
            <button type="button" className="btn btn-primary ml-auto px-2 py-1 text-xs" disabled={f.text.trim().length < 2} onClick={add}>Save</button></div>
        </div>
      )}
      {!list.length ? <p className="text-slate-500">No saved comments yet.</p> : (
        <ul className="space-y-1">{list.map(c => (
          <li key={c.id}><button type="button" className={"w-full rounded px-2 py-1 text-left hover:bg-white " + (c.fits ? "text-slate-800" : "text-slate-400")} onClick={() => onPick(fill(c.text))} title={c.min_average !== null || c.max_average !== null ? `Averages ${c.min_average ?? 0}–${c.max_average ?? 100}` : "Any average"}>{fill(c.text)}</button></li>
        ))}</ul>
      )}
    </div>
  );
}

type TraitData = { traits: { id: string; domain: string; name: string }[]; students?: { id: string; first_name: string; last_name: string; admission_no: string }[];
  ratings?: { student_id: string; trait_id: string; rating: number }[]; scale?: ScaleItem[] };

/** The school's own ratings of the whole child: its areas, its scale (migration 8400). */
function Traits({ termId, cg, isAdmin }: { termId: string; cg: string; isAdmin: boolean }) {
  const { data, reload } = useApi<TraitData>(`/api/traits?term_id=${termId}&class_group_id=${cg}`, [termId, cg]);
  const [grid, setGrid] = useState<Record<string, number | null>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [setup, setSetup] = useState(false);
  useEffect(() => {
    if (!data) return;
    setGrid(Object.fromEntries((data.ratings ?? []).map(r => [`${r.student_id}|${r.trait_id}`, r.rating])));
  }, [data]);
  if (!data) return <Loading />;
  const scale = data.scale ?? DEFAULT_SCALE;
  async function save() {
    const ratings = Object.entries(grid).map(([k, rating]) => { const [student_id, trait_id] = k.split("|"); return { student_id, trait_id, rating }; });
    const r = await send("/api/traits", { action: "rate", term_id: termId, ratings });
    setMsg({ ok: r.ok, text: r.ok ? `Saved ${r.data.saved} ratings. Recompile report cards to include them.` : r.error ?? "failed" });
  }
  const act = async (body: Record<string, unknown>, ok: string) => { const r = await send("/api/traits", body); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) reload(); };
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Rate each student on the school&apos;s scale ({scaleKey(scale)}). These print on the report card under each area.</p>
        <div className="flex gap-2">{isAdmin && <button className="btn btn-outline" onClick={() => setSetup(!setup)}>Areas and scale</button>}{data.traits.length > 0 && <button className="btn btn-primary" onClick={save}>Save ratings</button>}</div>
      </div>
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {isAdmin && (setup || !data.traits.length) && <TraitSetup data={data} scale={scale} act={act} />}
      {!isAdmin && !data.traits.length && <Empty>Your school admin chooses what is rated on the report card.</Empty>}
      {data.traits.length > 0 && (
        <div className="card overflow-x-auto"><table className="w-full text-xs">
          <thead className="bg-slate-50"><tr><th className="p-2 text-left">Student</th>{data.traits.map(t => <th key={t.id} className="p-1" title={areaTitle(t.domain)}><span className="block text-[10px] font-normal text-slate-400">{areaTitle(t.domain)}</span><span className="block max-w-[90px] truncate">{t.name}</span></th>)}</tr></thead>
          <tbody>{(data.students ?? []).map(s => (
            <tr key={s.id} className="border-t border-slate-100"><td className="whitespace-nowrap p-2 text-sm">{s.last_name}, {s.first_name}</td>
              {data.traits.map(t => { const k = `${s.id}|${t.id}`; return (
                <td key={t.id} className="p-1 text-center"><select className="rounded border border-slate-300 px-1 py-0.5" value={grid[k] ?? ""} aria-label={`${s.first_name} ${t.name}`}
                  onChange={e => setGrid({ ...grid, [k]: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{scale.map(p => <option key={p.value} value={p.value} title={p.label}>{p.short}</option>)}</select></td>); })}
            </tr>))}</tbody></table></div>
      )}
    </div>
  );
}

/** Admins: which areas the report card rates, and the scale it uses. */
function TraitSetup({ data, scale, act }: { data: TraitData; scale: ScaleItem[]; act: (b: Record<string, unknown>, ok: string) => Promise<void> }) {
  const [area, setArea] = useState({ name: "", items: "" });
  const [custom, setCustom] = useState(scale.map(p => `${p.short} = ${p.label}`).join("\n"));
  const have = [...new Set(data.traits.map(t => t.domain))];
  return (
    <section className="card mb-4 grid gap-5 p-4 text-sm lg:grid-cols-2">
      <div>
        <h3 className="font-semibold">Areas on the report card</h3>
        {!have.length && <p className="mt-1 text-slate-600">Nothing is rated yet. Add the areas your school reports on.</p>}
        <ul className="mt-2 space-y-1">{have.map(d => <li key={d}><b>{areaTitle(d)}</b>: <span className="text-slate-600">{data.traits.filter(t => t.domain === d).map(t => t.name).join(", ")}</span>
          <button className="ml-2 text-xs text-rose-700 underline" onClick={() => { if (confirm(`Remove ${areaTitle(d)} and its ratings?`)) act({ action: "save_traits", traits: data.traits.filter(t => t.domain !== d) }, `${areaTitle(d)} removed.`); }}>remove</button></li>)}</ul>
        <p className="mt-3 text-slate-600">Add a ready area:</p>
        <div className="mt-1 flex flex-wrap gap-1.5">{TRAIT_PRESETS.filter(p => !have.includes(p.domain)).map(p => <button key={p.domain} className="btn btn-outline px-2.5 py-1 text-xs" onClick={() => act({ action: "add_area", preset: p.domain }, `${p.title} added.`)}>+ {p.title}</button>)}</div>
        <p className="mt-3 text-slate-600">Or your own area, e.g. &quot;Clubs&quot;, with one item per line:</p>
        <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
          <input className="input" placeholder="Area name" maxLength={40} value={area.name} onChange={e => setArea({ ...area, name: e.target.value })} aria-label="Area name" />
          <textarea className="input" rows={2} placeholder={"Football\nChess club"} value={area.items} onChange={e => setArea({ ...area, items: e.target.value })} aria-label="Items in the area" />
          <button className="btn btn-primary self-start" disabled={area.name.trim().length < 2 || !area.items.trim()} onClick={() => act({ action: "save_traits", traits: [...data.traits,
            ...area.items.split("\n").map(x => x.trim()).filter(Boolean).slice(0, 20).map(name => ({ domain: area.name.trim(), name }))] }, `${area.name.trim()} added.`).then(() => setArea({ name: "", items: "" }))}>Add</button>
        </div>
      </div>
      <div>
        <h3 className="font-semibold">Rating scale</h3>
        <p className="mt-1 text-slate-600">Best first. Each line: the mark on the report card, then what it means.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{SCALE_PRESETS.map(p => <button key={p.name} className="btn btn-outline px-2.5 py-1 text-xs" onClick={() => setCustom(p.scale.map(x => `${x.short} = ${x.label}`).join("\n"))}>{p.name}</button>)}</div>
        <textarea className="input mt-2 font-mono" rows={6} value={custom} onChange={e => setCustom(e.target.value)} aria-label="Rating scale" />
        <button className="btn btn-primary mt-2" onClick={() => {
          const lines = custom.split("\n").map(l => l.trim()).filter(Boolean).slice(0, 10);
          const items = lines.map((l, i) => { const [short, ...rest] = l.split("="); return { value: lines.length - i, short: short.trim().slice(0, 4), label: (rest.join("=").trim() || short.trim()).slice(0, 40) }; });
          act({ action: "save_scale", scale: items }, "Scale saved.");
        }}>Save scale</button>
      </div>
    </section>
  );
}
