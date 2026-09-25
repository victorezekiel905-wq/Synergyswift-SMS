"use client";
import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Modal, Field, Badge, statusTone, fmtTime } from "@/components/ui";
import QuestionEditor, { blankQuestion, TYPE_LABELS, type EditorQuestion, type QType } from "@/components/exams/QuestionEditor";
import QuestionView from "@/components/exams/QuestionView";

type Exam = {
  id: string; title: string; instructions: string | null; status: string; duration_minutes: number; opens_at: string | null; closes_at: string | null;
  access_code: string; class_group_id: string | null; subject_id: string | null; term_id: string | null; component_id: string | null; results_released: boolean;
  settings: Record<string, any>;
};
type Question = EditorQuestion & { id: string; position: number };
type Tab = "questions" | "settings" | "monitor" | "marking";

export default function ExamWorkspace({ params }: { params: { id: string } }) {
  const { data, error, reload } = useApi<{ exam: Exam; questions: Question[] }>(`/api/exams/${params.id}`);
  const [tab, setTab] = useState<Tab>("questions");
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><p className="text-sm text-slate-500">Loading…</p></Page>;
  const { exam, questions } = data;
  const total = questions.reduce((a, q) => a + Number(q.points), 0);
  return (
    <Page wide>
      <Link href="/exams" className="text-sm text-brand-700 hover:underline">← Exams</Link>
      <PageHeader title={exam.title} subtitle={`${questions.length} questions · ${total} marks · ${exam.duration_minutes} minutes · code ${exam.access_code}`}
        actions={<><Badge tone={statusTone(exam.status)}>{exam.status}</Badge>{exam.results_released && <Badge tone="violet">results released</Badge>}</>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "questions", label: "Questions" }, { id: "settings", label: "Settings & publish" }, { id: "monitor", label: "Live monitor" }, { id: "marking", label: "Marking & results" }]} />
      {tab === "questions" && <Questions exam={exam} questions={questions} reload={reload} />}
      {tab === "settings" && <Settings exam={exam} reload={reload} />}
      {tab === "monitor" && <Monitor examId={exam.id} />}
      {tab === "marking" && <Marking exam={exam} reload={reload} />}
    </Page>
  );
}

/* ---------- Questions ---------- */
function Questions({ exam, questions, reload }: { exam: Exam; questions: Question[]; reload: () => void }) {
  const [editing, setEditing] = useState<EditorQuestion | null>(null);
  const [preview, setPreview] = useState<Question | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const locked = exam.status !== "draft";
  async function save(q: EditorQuestion) {
    const r = await send(`/api/exams/${exam.id}`, q);
    if (!r.ok) return r.error;
    setEditing(null); reload(); return null;
  }
  async function remove(q: Question) {
    if (!confirm("Delete this question?")) return;
    const r = await fetch(`/api/exams/${exam.id}/questions/${q.id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setMsg(j.error ?? "failed");
    reload();
  }
  async function move(i: number, d: number) {
    const order = questions.map(q => q.id);
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    await send(`/api/exams/${exam.id}`, { order }, "PUT");
    reload();
  }
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_280px]">
      <div className="space-y-3">
        {locked && <Alert tone="amber">This exam is {exam.status}. You can still fix typos, but adding or removing questions after students start is blocked.</Alert>}
        {msg && <Alert>{msg}</Alert>}
        {!questions.length && <Empty>No questions yet. Pick a question type on the right.</Empty>}
        {questions.map((q, i) => (
          <div key={q.id} className="card p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
              <Badge>{TYPE_LABELS[q.type]}</Badge>
              {q.section && <Badge tone="violet">{q.section}</Badge>}
              <span className="text-sm text-slate-500">{q.points} marks</span>
              <div className="ml-auto flex gap-1">
                <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setPreview(q)}>Preview</button>
                <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(q)}>Edit</button>
                <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => remove(q)}>Delete</button>
              </div>
            </div>
            <p className="line-clamp-3 whitespace-pre-wrap text-sm">{q.prompt}</p>
          </div>
        ))}
      </div>
      <aside className="card h-fit p-4">
        <p className="mb-2 text-sm font-semibold">Add a question</p>
        <div className="grid gap-1">
          {(Object.keys(TYPE_LABELS) as QType[]).map(t => (
            <button key={t} className="btn btn-ghost justify-start border border-slate-200 text-left text-xs" onClick={() => setEditing(blankQuestion(t))}>{TYPE_LABELS[t]}</button>
          ))}
        </div>
      </aside>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? "Edit question" : "New question"} wide>
        {editing && <QuestionEditor key={editing.id ?? editing.type} initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
      </Modal>
      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title="Student preview" wide>
        {preview && <PreviewQuestion q={preview} />}
      </Modal>
    </div>
  );
}

function PreviewQuestion({ q }: { q: Question }) {
  const [v, setV] = useState<any>(null);
  let data = q.data;
  if (q.type === "fill_blanks") { let i = 0; data = { text: String(q.data.text ?? "").replace(/\[\[[^\]]*\]\]/g, () => `[[${++i}]]`) }; }
  return <QuestionView q={{ id: q.id, type: q.type, prompt: q.prompt, points: q.points, media_url: q.media_url ?? null, section: q.section ?? null, data }} value={v} onChange={setV} />;
}

/* ---------- Settings ---------- */
function toLocal(v: string | null) {
  if (!v) return "";
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Settings({ exam, reload }: { exam: Exam; reload: () => void }) {
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[]; subjects: { id: string; name: string }[] }>("/api/school/structure");
  const { data: sessions } = useApi<{ id: string; name: string; terms: { id: string; name: string }[] }[]>("/api/school/academic");
  const { data: schemes } = useApi<{ id: string; name: string; grading_components: { id: string; name: string }[] }[]>("/api/school/grading");
  const [e, setE] = useState<Exam>(exam);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setE(exam), [exam]);
  const s = e.settings ?? {};
  const setS = (k: string, v: unknown) => setE({ ...e, settings: { ...s, [k]: v } });

  async function save(extra: Record<string, unknown> = {}, ok = "Saved.") {
    const r = await send(`/api/exams/${exam.id}`, {
      title: e.title, instructions: e.instructions, duration_minutes: Number(e.duration_minutes),
      class_group_id: e.class_group_id || null, subject_id: e.subject_id || null, term_id: e.term_id || null, component_id: e.component_id || null,
      opens_at: e.opens_at ? new Date(e.opens_at).toISOString() : null, closes_at: e.closes_at ? new Date(e.closes_at).toISOString() : null,
      settings: {
        shuffle_questions: Boolean(s.shuffle_questions), shuffle_options: s.shuffle_options !== false, require_fullscreen: s.require_fullscreen !== false,
        block_copy_paste: s.block_copy_paste !== false, violation_limit: Number(s.violation_limit ?? 3), show_score_after_submit: Boolean(s.show_score_after_submit),
        allow_review: Boolean(s.allow_review), require_seb: Boolean(s.require_seb), allow_spellcheck: Boolean(s.allow_spellcheck), allow_calculator: Boolean(s.allow_calculator),
        seb_browser_keys: (s.seb_browser_keys ?? []).filter(Boolean), seb_config_keys: (s.seb_config_keys ?? []).filter(Boolean), quit_password: s.quit_password ?? ""
      },
      ...extra
    }, "PATCH");
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) reload();
  }
  const cfgUrl = typeof window !== "undefined" ? `${window.location.origin}/api/exams/${exam.id}/seb` : "";
  const studentUrl = typeof window !== "undefined" ? `${window.location.origin}/exam/${exam.id}` : "";
  const comps = (schemes ?? []).flatMap(sc => sc.grading_components.map(c => ({ id: c.id, name: `${sc.name}: ${c.name}` })));
  const check = (k: string, label: string, dflt = false) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s[k] === undefined ? dflt : Boolean(s[k])} onChange={ev => setS(k, ev.target.checked)} /> {label}</label>
  );

  return (
    <div className="space-y-5">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <section className="card grid gap-3 p-5 md:grid-cols-3">
        <div className="md:col-span-2"><Field label="Title"><input className="input" value={e.title} onChange={ev => setE({ ...e, title: ev.target.value })} /></Field></div>
        <Field label="Duration (minutes)"><input className="input" type="number" min={1} value={e.duration_minutes} onChange={ev => setE({ ...e, duration_minutes: Number(ev.target.value) })} /></Field>
        <div className="md:col-span-3"><Field label="Instructions shown before starting"><textarea className="input h-24" value={e.instructions ?? ""} onChange={ev => setE({ ...e, instructions: ev.target.value })} /></Field></div>
        <Field label="Opens"><input className="input" type="datetime-local" value={toLocal(e.opens_at)} onChange={ev => setE({ ...e, opens_at: ev.target.value || null })} /></Field>
        <Field label="Closes" hint="Late starters get only the time left before this."><input className="input" type="datetime-local" value={toLocal(e.closes_at)} onChange={ev => setE({ ...e, closes_at: ev.target.value || null })} /></Field>
        <Field label="Class"><select className="input" value={e.class_group_id ?? ""} onChange={ev => setE({ ...e, class_group_id: ev.target.value })}><option value="">All students</option>{(structure?.class_groups ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      </section>

      <section className="card grid gap-3 p-5 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">Integrity</h2>
        {check("require_fullscreen", "Require full screen (leaving counts as a violation)", true)}
        {check("block_copy_paste", "Block copy, paste and right-click", true)}
        {check("shuffle_questions", "Shuffle question order per student")}
        {check("shuffle_options", "Shuffle answer options per student", true)}
        {check("allow_spellcheck", "Allow browser spell-check")}
        {check("allow_calculator", "Show on-screen calculator")}
        <Field label="Lock the exam after this many violations" hint="A locked student waits for you to unlock them in the live monitor.">
          <input className="input max-w-[120px]" type="number" min={1} max={50} value={s.violation_limit ?? 3} onChange={ev => setS("violation_limit", Number(ev.target.value))} />
        </Field>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Safe Exam Browser</h2>
        {check("require_seb", "Require Safe Exam Browser (students cannot start in a normal browser)")}
        {s.require_seb && (
          <div className="space-y-3 rounded-lg bg-slate-50 p-3 text-sm">
            <ol className="list-decimal space-y-1 pl-5 text-slate-700">
              <li>Download the configuration: <a className="font-medium text-brand-700 underline" href={`/api/exams/${exam.id}/seb`}>exam.seb</a> (students can also open <span className="font-mono text-xs">{cfgUrl.replace(/^http/, "seb")}</span>).</li>
              <li>Open it in the SEB Config Tool, copy the <b>Config Key</b> and paste it below. This makes the check cryptographic.</li>
              <li>Without a key the server falls back to detecting the SEB browser signature, which is weaker.</li>
            </ol>
            <Field label="Config Keys (one per line)"><textarea className="input h-16 font-mono text-xs" value={(s.seb_config_keys ?? []).join("\n")} onChange={ev => setS("seb_config_keys", ev.target.value.split("\n").map(x => x.trim()))} /></Field>
            <Field label="Browser Exam Keys (optional, one per line)"><textarea className="input h-16 font-mono text-xs" value={(s.seb_browser_keys ?? []).join("\n")} onChange={ev => setS("seb_browser_keys", ev.target.value.split("\n").map(x => x.trim()))} /></Field>
            <Field label="Quit password (for invigilators)"><input className="input max-w-xs" value={s.quit_password ?? ""} onChange={ev => setS("quit_password", ev.target.value)} /></Field>
          </div>
        )}
      </section>

      <section className="card grid gap-3 p-5 md:grid-cols-3">
        <h2 className="font-semibold md:col-span-3">Results</h2>
        {check("show_score_after_submit", "Show the score right after submitting (when fully auto-marked)")}
        {check("allow_review", "Let students review marks per question after release")}
        <div />
        <Field label="Subject"><select className="input" value={e.subject_id ?? ""} onChange={ev => setE({ ...e, subject_id: ev.target.value })}><option value="">—</option>{(structure?.subjects ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        <Field label="Term (for report cards)"><select className="input" value={e.term_id ?? ""} onChange={ev => setE({ ...e, term_id: ev.target.value })}><option value="">—</option>{(sessions ?? []).flatMap(se => se.terms.map(t => <option key={t.id} value={t.id}>{t.name} {se.name}</option>))}</select></Field>
        <Field label="Counts as component"><select className="input" value={e.component_id ?? ""} onChange={ev => setE({ ...e, component_id: ev.target.value })}><option value="">—</option>{comps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" onClick={() => save()}>Save settings</button>
        {exam.status === "draft" && <button className="btn btn-primary bg-emerald-600 hover:bg-emerald-700" onClick={() => save({ status: "published" }, "Published. Students can now start with the exam code.")}>Publish exam</button>}
        {exam.status === "published" && <button className="btn btn-danger" onClick={() => confirm("Close the exam? Students still writing will be submitted when their time ends.") && save({ status: "closed" }, "Exam closed.")}>Close exam</button>}
        {exam.status !== "draft" && <button className="btn btn-ghost" onClick={() => save({ status: "draft" }, "Back to draft.")}>Unpublish</button>}
        <button className="btn btn-ghost" onClick={() => save({ regenerate_code: true }, "New exam code generated.")}>New exam code</button>
        <span className="text-sm text-slate-500">Students go to <span className="font-mono">{studentUrl}</span> and enter code <b className="font-mono">{exam.access_code}</b></span>
      </div>
    </div>
  );
}

/* ---------- Monitor ---------- */
type Attempt = {
  id: string; name: string; admission_no: string | null; status: string; started_at: string; deadline_at: string; submitted_at: string | null; last_seen_at: string;
  violations: number; seb_verified: boolean; extra_minutes: number; answered: number; total_questions: number; total_score: number | null; max_score: number | null;
  pending_manual: number; answers: Record<string, any>; marks: Record<string, { points: number | null; max: number; auto: boolean; feedback?: string }>;
  events: { kind: string; at: string; meta: Record<string, unknown> }[];
};

function Monitor({ examId }: { examId: string }) {
  const { data, reload } = useApi<{ attempts: Attempt[] }>(`/api/exams/${examId}/attempts`);
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => { reload(); setNow(Date.now()); }, 5000); return () => clearInterval(t); }, [reload]);
  async function act(attempt_id: string, action: string, extra: Record<string, unknown> = {}) {
    await send(`/api/exams/${examId}/attempts`, { action, attempt_id, ...extra }, "PATCH");
    reload();
  }
  const list = data?.attempts ?? [];
  const counts = { writing: list.filter(a => a.status === "in_progress").length, locked: list.filter(a => a.status === "locked").length, done: list.filter(a => ["submitted", "graded"].includes(a.status)).length };
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <Badge tone="amber">{counts.writing} writing</Badge><Badge tone="red">{counts.locked} locked</Badge><Badge tone="green">{counts.done} submitted</Badge>
        <span className="text-xs text-slate-500">Refreshes every 5 seconds.</span>
      </div>
      {!list.length ? <Empty>Nobody has started yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Student</th><th className="p-2">Status</th><th className="p-2">Progress</th><th className="p-2">Time left</th><th className="p-2">Violations</th><th className="p-2">Last seen</th><th className="p-2" /></tr></thead>
            <tbody>
              {list.map(a => {
                const left = Math.max(0, new Date(a.deadline_at).getTime() - now);
                const stale = a.status === "in_progress" && now - new Date(a.last_seen_at).getTime() > 60_000;
                return (
                  <Fragment key={a.id}>
                    <tr className={"border-t border-slate-100 " + (a.status === "locked" ? "bg-rose-50" : "")}>
                      <td className="p-2"><button className="font-medium text-brand-700 hover:underline" onClick={() => setOpen(open === a.id ? null : a.id)}>{a.name}</button><div className="text-xs text-slate-400">{a.admission_no}{a.seb_verified ? " · SEB ✓" : ""}</div></td>
                      <td className="p-2"><Badge tone={statusTone(a.status)}>{a.status.replace("_", " ")}</Badge></td>
                      <td className="p-2 tabular-nums">{a.answered}/{a.total_questions}</td>
                      <td className="p-2 tabular-nums">{["in_progress", "locked"].includes(a.status) ? `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}` : "—"}</td>
                      <td className={"p-2 tabular-nums " + (a.violations ? "font-semibold text-rose-600" : "")}>{a.violations}</td>
                      <td className={"p-2 text-xs " + (stale ? "text-amber-600" : "text-slate-500")}>{fmtTime(a.last_seen_at)}{stale ? " (offline?)" : ""}</td>
                      <td className="whitespace-nowrap p-2 text-right">
                        {a.status === "locked" && <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => act(a.id, "unlock")}>Unlock</button>}
                        {["in_progress", "locked"].includes(a.status) && <>
                          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act(a.id, "extend", { minutes: 10 })}>+10 min</button>
                          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => confirm(`Submit ${a.name}'s exam now?`) && act(a.id, "force_submit")}>Submit</button>
                        </>}
                        {["submitted", "graded"].includes(a.status) && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => { const m = prompt("Reopen for how many minutes?", "10"); if (m) act(a.id, "reopen", { minutes: Number(m) }); }}>Reopen</button>}
                        <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => confirm(`Delete ${a.name}'s attempt so they can start again? Their answers are lost.`) && act(a.id, "reset")}>Reset</button>
                      </td>
                    </tr>
                    {open === a.id && (
                      <tr><td colSpan={7} className="bg-slate-50 p-3">
                        <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Activity</p>
                        <ul className="grid gap-x-6 text-xs sm:grid-cols-2">
                          {a.events.map((ev, i) => <li key={i} className={["blur", "visibility_hidden", "fullscreen_exit", "copy", "paste", "devtools", "context_menu", "print", "locked", "multiple_screens"].includes(ev.kind) ? "text-rose-600" : "text-slate-600"}>{fmtTime(ev.at)} · {ev.kind.replace(/_/g, " ")}</li>)}
                        </ul>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------- Marking ---------- */
function Marking({ exam, reload: reloadExam }: { exam: Exam; reload: () => void }) {
  const { data, reload } = useApi<{ attempts: Attempt[]; questions: Question[] }>(`/api/exams/${exam.id}/attempts`);
  const [sel, setSel] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, { points: string; feedback: string }>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const attempt = data?.attempts.find(a => a.id === sel);
  useEffect(() => {
    if (!attempt) return;
    setMarks(Object.fromEntries(Object.entries(attempt.marks ?? {}).map(([k, m]) => [k, { points: m.points === null ? "" : String(m.points), feedback: m.feedback ?? "" }])));
  }, [sel, attempt?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveMarks() {
    if (!attempt || !data) return;
    const changed: Record<string, { points: number; feedback?: string }> = {};
    for (const q of data.questions) {
      const m = marks[q.id]; const orig = attempt.marks?.[q.id];
      if (!m || m.points === "") continue;
      if (orig && String(orig.points) === m.points && (orig.feedback ?? "") === m.feedback) continue;
      changed[q.id] = { points: Number(m.points), feedback: m.feedback || undefined };
    }
    const r = await send(`/api/exams/${exam.id}/attempts`, { action: "grade", attempt_id: attempt.id, marks: changed }, "PATCH");
    setMsg({ ok: r.ok, text: r.ok ? `Saved. Total ${r.data.total_score}${r.data.pending ? `, ${r.data.pending} questions still to mark` : ""}.` : r.error ?? "failed" });
    reload();
  }
  async function release(push: boolean) {
    const r = await send(`/api/exams/${exam.id}/release`, { push_to_results: push, release: true });
    setMsg({ ok: r.ok, text: r.ok ? `Results released to students.${push ? ` ${r.data.pushed} scores pushed to the report-card score sheet.` : ""}${r.data.still_running ? ` ${r.data.still_running} students are still writing.` : ""}` : r.error ?? "failed" });
    if (r.ok) { reload(); reloadExam(); }
  }
  const list = (data?.attempts ?? []).filter(a => ["submitted", "graded"].includes(a.status));
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={() => release(false)}>Release results to students</button>
        <button className="btn btn-ghost border border-slate-200" onClick={() => confirm("Push every graded score into the term score sheet for the chosen component?") && release(true)}>Release and push to report cards</button>
        <a className="btn btn-ghost ml-auto" href={`/api/exams/${exam.id}/attempts?format=csv`}>Download marks (CSV)</a>
      </div>
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <ul className="card h-fit divide-y divide-slate-100 text-sm">
          {list.map(a => (
            <li key={a.id}><button onClick={() => setSel(a.id)} className={"flex w-full items-center justify-between p-3 text-left " + (sel === a.id ? "bg-brand-50" : "hover:bg-slate-50")}>
              <span>{a.name}</span>
              <span className="text-xs">{a.pending_manual ? <Badge tone="amber">{a.pending_manual} to mark</Badge> : <span className="tabular-nums">{a.total_score}/{a.max_score}</span>}</span>
            </button></li>
          ))}
          {!list.length && <li className="p-3 text-slate-500">No submissions yet.</li>}
        </ul>
        {attempt && data ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{attempt.name}</h3><span className="text-lg font-bold tabular-nums">{attempt.total_score ?? "—"} / {attempt.max_score}</span></div>
            {data.questions.map((q, i) => {
              const m = attempt.marks?.[q.id];
              let pubData = q.data;
              if (q.type === "fill_blanks") { let k = 0; pubData = { text: String(q.data.text ?? "").replace(/\[\[[^\]]*\]\]/g, () => `[[${++k}]]`) }; }
              const ans = attempt.answers?.[q.id];
              return (
                <div key={q.id} className="card p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs"><b>Q{i + 1}</b><Badge>{TYPE_LABELS[q.type]}</Badge>{m?.auto === false && <Badge tone="violet">teacher mark</Badge>}</div>
                  {q.type === "file_upload"
                    ? <p className="text-sm">{q.prompt}<br />{ans?.path ? <a className="text-brand-700 underline" href={`/api/exams/${exam.id}/file?path=${encodeURIComponent(ans.path)}`} target="_blank" rel="noreferrer">Open {ans.name}</a> : <i>No file</i>}</p>
                    : <QuestionView q={{ id: q.id, type: q.type, prompt: q.prompt, points: q.points, media_url: q.media_url ?? null, section: null, data: pubData }} value={ans} onChange={() => {}} disabled />}
                  {(q.answer?.rubric || q.answer?.reference) && <p className="mt-2 whitespace-pre-wrap rounded bg-amber-50 p-2 text-xs text-amber-900"><b>Marking guide:</b> {q.answer.rubric || q.answer.reference}</p>}
                  <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                    <Field label={`Points (max ${q.points})`}><input className={"input w-24 " + (m?.points === null ? "border-amber-400 bg-amber-50" : "")} type="number" min={0} max={q.points} step="any"
                      value={marks[q.id]?.points ?? ""} onChange={e => setMarks({ ...marks, [q.id]: { points: e.target.value, feedback: marks[q.id]?.feedback ?? "" } })} /></Field>
                    <div className="min-w-[240px] flex-1"><Field label="Feedback"><input className="input" value={marks[q.id]?.feedback ?? ""} onChange={e => setMarks({ ...marks, [q.id]: { points: marks[q.id]?.points ?? "", feedback: e.target.value } })} /></Field></div>
                  </div>
                </div>
              );
            })}
            <button className="btn btn-primary" onClick={saveMarks}>Save marks</button>
          </div>
        ) : <Empty>Select a submission to mark.</Empty>}
      </div>
    </div>
  );
}
