"use client";
import { useMemo, useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, Loading } from "@/components/ui";
import QuestionEditor, { blankQuestion, TYPE_LABELS, type EditorQuestion, type QType } from "@/components/exams/QuestionEditor";

export type BankQuestion = EditorQuestion & {
  id: string; subject_id: string | null; level: string | null; topic: string | null; difficulty: string | null; bloom: string | null;
  exam_body: string | null; exam_year: number | null; explanation: string | null; practice: boolean; times_used: number;
  subjects: { name: string } | null;
};
type Facets = { topics: string[]; exam_bodies: string[]; years: number[]; levels: string[] };
export type BankFilters = { subject_id: string; topic: string; difficulty: string; bloom: string; exam_body: string; exam_year: string; type: string; level: string; search: string; practice: string };

export const EMPTY_FILTERS: BankFilters = { subject_id: "", topic: "", difficulty: "", bloom: "", exam_body: "", exam_year: "", type: "", level: "", search: "", practice: "" };
export const DIFFICULTIES = ["easy", "medium", "hard"];
export const BLOOMS = ["remember", "understand", "apply", "analyse", "evaluate", "create"];
export const EXAM_BODIES = ["WAEC", "NECO", "JAMB", "BECE", "NCEE", "IGCSE", "A Level", "Checkpoint", "SAT", "AP", "Internal"];

type Meta = { subject_id: string; level: string; topic: string; difficulty: string; bloom: string; exam_body: string; exam_year: string; explanation: string; practice: boolean };
const metaOf = (q?: Partial<BankQuestion>): Meta => ({
  subject_id: q?.subject_id ?? "", level: q?.level ?? "", topic: q?.topic ?? "", difficulty: q?.difficulty ?? "", bloom: q?.bloom ?? "",
  exam_body: q?.exam_body ?? "", exam_year: q?.exam_year ? String(q.exam_year) : "", explanation: q?.explanation ?? "", practice: Boolean(q?.practice)
});

function query(f: BankFilters, offset: number) {
  const p = new URLSearchParams({ facets: "1", limit: "50", offset: String(offset) });
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  return `/api/question-bank?${p}`;
}

/**
 * Question bank list with filters. In "manage" mode teachers add, edit, import
 * and delete; in "pick" mode they tick questions and hand them to onPick.
 */
export default function BankBrowser({ mode, subjects, onPick, initialFilters }: {
  mode: "manage" | "pick";
  subjects: { id: string; name: string }[];
  onPick?: (ids: string[]) => Promise<string | null>;
  initialFilters?: Partial<BankFilters>;
}) {
  const [f, setF] = useState<BankFilters>({ ...EMPTY_FILTERS, ...initialFilters });
  const [offset, setOffset] = useState(0);
  const { data, error, reload } = useApi<{ questions: BankQuestion[]; total: number; facets: Facets }>(query(f, offset), [JSON.stringify(f), offset]);
  const [editing, setEditing] = useState<{ q: EditorQuestion; meta: Meta } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const set = (k: keyof BankFilters, v: string) => { setF({ ...f, [k]: v }); setOffset(0); };
  const facets = data?.facets;

  async function save(q: EditorQuestion) {
    if (!editing) return null;
    const m = editing.meta;
    const r = await send("/api/question-bank", { ...q, ...m, exam_year: m.exam_year ? Number(m.exam_year) : null, difficulty: m.difficulty || null, bloom: m.bloom || null });
    if (!r.ok) return r.error;
    setEditing(null); reload(); return null;
  }
  async function remove(q: BankQuestion) {
    if (!confirm("Delete this question from the bank? Exams that already use it keep their copy.")) return;
    const r = await send(`/api/question-bank?id=${q.id}`, undefined, "DELETE");
    if (!r.ok) setMsg({ ok: false, text: r.error ?? "failed" });
    reload();
  }
  async function pick() {
    if (!onPick || !picked.size) return;
    const e = await onPick([...picked]);
    if (e) setMsg({ ok: false, text: e }); else setPicked(new Set());
  }

  return (
    <div className="space-y-3">
      <div className="card grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <input className="input lg:col-span-2" placeholder="Search question text" value={f.search} onChange={e => set("search", e.target.value)} aria-label="Search" />
        <select className="input" value={f.subject_id} onChange={e => set("subject_id", e.target.value)} aria-label="Subject"><option value="">All subjects</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select className="input" value={f.topic} onChange={e => set("topic", e.target.value)} aria-label="Topic"><option value="">All topics</option>{(facets?.topics ?? []).map(t => <option key={t}>{t}</option>)}</select>
        <select className="input" value={f.type} onChange={e => set("type", e.target.value)} aria-label="Type"><option value="">All types</option>{(Object.keys(TYPE_LABELS) as QType[]).map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</select>
        <select className="input" value={f.difficulty} onChange={e => set("difficulty", e.target.value)} aria-label="Difficulty"><option value="">Any difficulty</option>{DIFFICULTIES.map(d => <option key={d}>{d}</option>)}</select>
        <select className="input" value={f.bloom} onChange={e => set("bloom", e.target.value)} aria-label="Bloom's level"><option value="">Any Bloom&apos;s level</option>{BLOOMS.map(d => <option key={d}>{d}</option>)}</select>
        <select className="input" value={f.exam_body} onChange={e => set("exam_body", e.target.value)} aria-label="Exam body"><option value="">Any exam body</option>{[...new Set([...EXAM_BODIES, ...(facets?.exam_bodies ?? [])])].map(d => <option key={d}>{d}</option>)}</select>
        <select className="input" value={f.exam_year} onChange={e => set("exam_year", e.target.value)} aria-label="Year"><option value="">Any year</option>{(facets?.years ?? []).map(y => <option key={y}>{y}</option>)}</select>
        <select className="input" value={f.practice} onChange={e => set("practice", e.target.value)} aria-label="Practice"><option value="">Practice: any</option><option value="1">Open for practice</option><option value="0">Not for practice</option></select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">{data ? `${data.total} question${data.total === 1 ? "" : "s"}` : ""}</span>
        {mode === "manage" && <>
          <select className="input ml-auto w-auto" value="" onChange={e => e.target.value && setEditing({ q: blankQuestion(e.target.value as QType), meta: metaOf({ subject_id: f.subject_id, topic: f.topic, exam_body: f.exam_body }) })} aria-label="Add a question">
            <option value="">+ Add a question…</option>{(Object.keys(TYPE_LABELS) as QType[]).map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
          <button className="btn btn-outline" onClick={() => setImporting(true)}>Import from spreadsheet</button>
          <button className="btn btn-ghost" title="99 original practice questions for core subjects (not official past questions)" onClick={async () => {
            if (!confirm("Add the starter practice questions to Mathematics, English, Biology, Chemistry, Physics, Economics and Government (where your school has those subjects)? They are original practice questions, tagged \u201cSample\u201d, not official past questions.")) return;
            const r = await send<{ added: number; subjects: string[] }>("/api/question-bank", { action: "starter" });
            setMsg({ ok: r.ok, text: r.ok ? `Added ${r.data.added} starter questions to ${r.data.subjects.join(", ")}. Students can practise them now.` : r.error ?? "failed" });
            reload();
          }}>Add starter questions</button>
        </>}
        {mode === "pick" && <button className="btn btn-primary ml-auto" disabled={!picked.size} onClick={pick}>Add {picked.size || ""} to exam</button>}
      </div>
      {error && <Alert>{error}</Alert>}
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}

      {!data ? <Loading /> : !data.questions.length ? <Empty>No questions match. {mode === "manage" ? "Add one or import a spreadsheet of past questions." : ""}</Empty> : (
        <ul className="space-y-2">
          {data.questions.map(q => (
            <li key={q.id} className="card flex gap-3 p-3">
              {mode === "pick" && <input type="checkbox" className="mt-1" aria-label="Select question" checked={picked.has(q.id)}
                onChange={e => { const n = new Set(picked); if (e.target.checked) n.add(q.id); else n.delete(q.id); setPicked(n); }} />}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-1 text-xs">
                  <Badge>{TYPE_LABELS[q.type]}</Badge>
                  {q.subjects?.name && <Badge tone="blue">{q.subjects.name}</Badge>}
                  {q.topic && <Badge tone="violet">{q.topic}</Badge>}
                  {q.difficulty && <Badge tone={q.difficulty === "hard" ? "red" : q.difficulty === "easy" ? "green" : "amber"}>{q.difficulty}</Badge>}
                  {q.bloom && <Badge>{q.bloom}</Badge>}
                  {q.exam_body && <Badge tone="blue">{q.exam_body}{q.exam_year ? ` ${q.exam_year}` : ""}</Badge>}
                  {q.practice && <Badge tone="green">practice</Badge>}
                  <span className="text-slate-400">{q.points} mark{Number(q.points) === 1 ? "" : "s"} · used {q.times_used}×</span>
                </div>
                <p className="line-clamp-2 whitespace-pre-wrap text-sm">{q.prompt}</p>
              </div>
              {mode === "manage" && (
                <div className="flex shrink-0 items-start gap-1">
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEditing({ q, meta: metaOf(q) })}>Edit</button>
                  <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => remove(q)}>Delete</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && data.total > 50 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button className="btn btn-ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>← Previous</button>
          <span>{offset + 1}–{Math.min(offset + 50, data.total)} of {data.total}</span>
          <button className="btn btn-ghost" disabled={offset + 50 >= data.total} onClick={() => setOffset(offset + 50)}>Next →</button>
        </div>
      )}

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.q.id ? "Edit bank question" : "New bank question"} wide>
        {editing && <QuestionEditor key={editing.q.id ?? editing.q.type} initial={editing.q} onSave={save} onCancel={() => setEditing(null)}
          extra={<MetaFields meta={editing.meta} subjects={subjects} topics={facets?.topics ?? []} onChange={meta => setEditing({ ...editing, meta })} />} />}
      </Modal>
      <Modal open={importing} onClose={() => setImporting(false)} title="Import questions from a spreadsheet" wide>
        <ImportForm subjects={subjects} onDone={(text) => { setImporting(false); setMsg({ ok: true, text }); reload(); }} />
      </Modal>
    </div>
  );
}

function MetaFields({ meta, subjects, topics, onChange }: { meta: Meta; subjects: { id: string; name: string }[]; topics: string[]; onChange: (m: Meta) => void }) {
  const set = (k: keyof Meta, v: string | boolean) => onChange({ ...meta, [k]: v });
  return (
    <fieldset className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-4">
      <legend className="px-1 text-xs font-semibold uppercase text-slate-500">Bank details</legend>
      <Field label="Subject"><select className="input" value={meta.subject_id} onChange={e => set("subject_id", e.target.value)}><option value="">—</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Topic"><input className="input" list="bank-topics" value={meta.topic} onChange={e => set("topic", e.target.value)} placeholder="Quadratic equations" /><datalist id="bank-topics">{topics.map(t => <option key={t} value={t} />)}</datalist></Field>
      <Field label="Class level"><input className="input" value={meta.level} onChange={e => set("level", e.target.value)} placeholder="SS2 / Year 10" /></Field>
      <Field label="Difficulty"><select className="input" value={meta.difficulty} onChange={e => set("difficulty", e.target.value)}><option value="">—</option>{DIFFICULTIES.map(d => <option key={d}>{d}</option>)}</select></Field>
      <Field label="Bloom's level"><select className="input" value={meta.bloom} onChange={e => set("bloom", e.target.value)}><option value="">—</option>{BLOOMS.map(d => <option key={d}>{d}</option>)}</select></Field>
      <Field label="Past question: exam body"><input className="input" list="bank-bodies" value={meta.exam_body} onChange={e => set("exam_body", e.target.value)} /><datalist id="bank-bodies">{EXAM_BODIES.map(t => <option key={t} value={t} />)}</datalist></Field>
      <Field label="Year"><input className="input" type="number" min={1950} max={2100} value={meta.exam_year} onChange={e => set("exam_year", e.target.value)} /></Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={meta.practice} onChange={e => set("practice", e.target.checked)} /> Students can practise it</label>
      <div className="sm:col-span-4"><Field label="Explanation (shown after a practice answer)"><textarea className="input h-16" value={meta.explanation} onChange={e => set("explanation", e.target.value)} /></Field></div>
    </fieldset>
  );
}

function ImportForm({ subjects, onDone }: { subjects: { id: string; name: string }[]; onDone: (msg: string) => void }) {
  const [csv, setCsv] = useState("");
  const [d, setD] = useState({ subject_id: "", exam_body: "", exam_year: "", topic: "", practice: true });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => Math.max(0, csv.trim().split(/\r?\n/).length - 1), [csv]);
  async function go() {
    setBusy(true); setErr(null);
    const r = await send<{ imported: number; skipped: number; problems: string[] }>("/api/question-bank", {
      action: "import", csv, defaults: { subject_id: d.subject_id || null, exam_body: d.exam_body || null, exam_year: d.exam_year ? Number(d.exam_year) : null, topic: d.topic || null, practice: d.practice }
    });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    onDone(`Imported ${r.data.imported} questions.${r.data.skipped ? ` Skipped ${r.data.skipped}: ${r.data.problems.slice(0, 3).join(" ")}` : ""}`);
  }
  return (
    <div className="space-y-3 text-sm">
      <p>Save your sheet as <b>CSV</b> from Excel or Google Sheets. The first row holds the headings:</p>
      <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs">question, a, b, c, d, answer, topic, difficulty, year, explanation{"\n"}What is 7 × 8?, 54, 56, 58, 64, B, Multiplication, easy, 2019, 7 × 8 = 56</pre>
      <p className="text-slate-600">Answer with a letter for multiple choice (A,C for several), <i>true</i> or <i>false</i>, or the text for short answers (alternatives separated by |). Optional columns: <i>e</i>, <i>type</i> (math, numeric, essay), <i>points</i>, <i>bloom</i>, <i>exam_body</i>, <i>level</i>.</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Subject"><select className="input" value={d.subject_id} onChange={e => setD({ ...d, subject_id: e.target.value })}><option value="">—</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Exam body"><input className="input" list="bank-bodies-imp" value={d.exam_body} onChange={e => setD({ ...d, exam_body: e.target.value })} /><datalist id="bank-bodies-imp">{EXAM_BODIES.map(t => <option key={t} value={t} />)}</datalist></Field>
        <Field label="Year (if not in the file)"><input className="input" type="number" value={d.exam_year} onChange={e => setD({ ...d, exam_year: e.target.value })} /></Field>
        <Field label="Topic (if not in the file)"><input className="input" value={d.topic} onChange={e => setD({ ...d, topic: e.target.value })} /></Field>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={d.practice} onChange={e => setD({ ...d, practice: e.target.checked })} /> Open these questions for student practice</label>
      <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={async e => { const file = e.target.files?.[0]; if (file) setCsv(await file.text()); }} />
      <textarea className="input h-32 font-mono text-xs" value={csv} onChange={e => setCsv(e.target.value)} placeholder="…or paste the CSV here" aria-label="CSV text" />
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end"><button className="btn btn-primary" disabled={!rows || busy} onClick={go}>{busy ? "Importing…" : `Import ${rows || ""} rows`}</button></div>
    </div>
  );
}
