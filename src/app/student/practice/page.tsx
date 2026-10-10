"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Empty, Field, Badge, Loading, fmtDate } from "@/components/ui";
import QuestionView, { type PublicQuestion } from "@/components/exams/QuestionView";

type Subject = { id: string; name: string; count: number; exam_bodies: string[]; years: number[]; topics: string[] };
type History = { id: string; filters: { exam_body: string | null; exam_year: number | null; topic: string | null }; score: number; max_score: number; started_at: string; finished_at: string | null; questions: number };
type Feedback = { points: number; max: number; correct: boolean; answer: string; explanation: string | null; score: number; max_score: number };

/** Past-question practice: pick a subject (and optionally exam, year, topic), answer, and see the right answer at once. */
export default function PracticePage() {
  const { data, error, reload } = useApi<{ subjects: Subject[]; history: History[] }>("/api/student/practice");
  const [f, setF] = useState({ subject_id: "", exam_body: "", exam_year: "", topic: "", count: "20" });
  const [run, setRun] = useState<{ id: string; questions: PublicQuestion[] } | null>(null);
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [err, setErr] = useState<string | null>(null);
  const subject = data?.subjects.find(s => s.id === f.subject_id);

  async function start() {
    setErr(null);
    const r = await send<{ session_id: string; questions: PublicQuestion[] }>("/api/student/practice", {
      action: "start", subject_id: f.subject_id, exam_body: f.exam_body || null, exam_year: f.exam_year ? Number(f.exam_year) : null, topic: f.topic || null, count: Number(f.count)
    });
    if (!r.ok) return setErr(r.error);
    setRun({ id: r.data.session_id, questions: r.data.questions }); setI(0); setAnswers({}); setFeedback({});
  }
  async function check(q: PublicQuestion) {
    const r = await send<Feedback>("/api/student/practice", { action: "answer", session_id: run!.id, question_id: q.id, response: answers[q.id] ?? null });
    if (!r.ok) return setErr(r.error);
    setFeedback({ ...feedback, [q.id]: r.data });
  }
  async function finish() {
    await send("/api/student/practice", { action: "finish", session_id: run!.id });
    setRun(null); reload();
  }

  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;

  if (run) {
    const q = run.questions[i];
    const fb = feedback[q.id];
    const done = Object.keys(feedback).length;
    const last = Object.values(feedback).at(-1);
    return (
      <Page>
        <PageHeader eyebrow="Practice" title={`Question ${i + 1} of ${run.questions.length}`}
          subtitle={`${done} answered · score ${last ? `${Math.round(last.score * 100) / 100} / ${last.max_score}` : "0"}`}
          actions={<button className="btn btn-ghost" onClick={finish}>Finish</button>} />
        <div className="card p-5">
          <QuestionView q={q} value={answers[q.id]} onChange={v => !fb && setAnswers({ ...answers, [q.id]: v })} disabled={Boolean(fb)} spellcheck />
          {fb && (
            <div className={"mt-4 rounded-lg p-3 text-sm " + (fb.correct ? "bg-emerald-50 text-emerald-900" : fb.points > 0 ? "bg-amber-50 text-amber-900" : "bg-rose-50 text-rose-900")} role="status">
              <p className="font-semibold">{fb.correct ? "Correct!" : fb.points > 0 ? `Partly right: ${fb.points} of ${fb.max}` : "Not quite."}</p>
              {!fb.correct && fb.answer && <p className="mt-1">Answer: <b>{fb.answer}</b></p>}
              {fb.explanation && <p className="mt-1 whitespace-pre-wrap">{fb.explanation}</p>}
            </div>
          )}
          {err && <div className="mt-3"><Alert>{err}</Alert></div>}
          <div className="mt-4 flex flex-wrap justify-between gap-2">
            <button className="btn btn-ghost" disabled={i === 0} onClick={() => setI(i - 1)}>← Back</button>
            {!fb ? <button className="btn btn-primary" onClick={() => check(q)}>Check answer</button>
              : i < run.questions.length - 1 ? <button className="btn btn-primary" onClick={() => setI(i + 1)}>Next question →</button>
                : <button className="btn btn-success" onClick={finish}>See my score</button>}
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader eyebrow="Practice" title="Past questions"
        subtitle="Practise past WAEC, NECO, JAMB, BECE and school questions. You see the right answer straight after each question. Practice scores do not count towards your results." />
      {!data.subjects.length ? <Empty>Your teachers have not opened any questions for practice yet.</Empty> : (
        <div className="card grid gap-3 p-5 sm:grid-cols-2">
          <Field label="Subject"><select className="input" value={f.subject_id} onChange={e => setF({ ...f, subject_id: e.target.value, exam_body: "", exam_year: "", topic: "" })}>
            <option value="">Choose…</option>{data.subjects.map(s => <option key={s.id} value={s.id}>{s.name} ({s.count})</option>)}</select></Field>
          <Field label="Exam"><select className="input" value={f.exam_body} onChange={e => setF({ ...f, exam_body: e.target.value })} disabled={!subject}>
            <option value="">Any</option>{(subject?.exam_bodies ?? []).map(b => <option key={b}>{b}</option>)}</select></Field>
          <Field label="Year"><select className="input" value={f.exam_year} onChange={e => setF({ ...f, exam_year: e.target.value })} disabled={!subject}>
            <option value="">Any</option>{(subject?.years ?? []).map(y => <option key={y}>{y}</option>)}</select></Field>
          <Field label="Topic"><select className="input" value={f.topic} onChange={e => setF({ ...f, topic: e.target.value })} disabled={!subject}>
            <option value="">Any</option>{(subject?.topics ?? []).map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Number of questions"><select className="input" value={f.count} onChange={e => setF({ ...f, count: e.target.value })}>{[10, 20, 40, 60].map(n => <option key={n}>{n}</option>)}</select></Field>
          <div className="flex items-end"><button className="btn btn-primary w-full" disabled={!f.subject_id} onClick={start}>Start practice</button></div>
          {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
        </div>
      )}
      {data.history.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">Recent practice</h2>
          <ul className="card divide-y divide-slate-100 text-sm">
            {data.history.map(h => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 p-3">
                <span>{fmtDate(h.started_at, true)}</span>
                {h.filters.exam_body && <Badge tone="blue">{h.filters.exam_body}{h.filters.exam_year ? ` ${h.filters.exam_year}` : ""}</Badge>}
                {h.filters.topic && <Badge tone="violet">{h.filters.topic}</Badge>}
                <span className="ml-auto font-semibold tabular-nums">{Math.round(Number(h.score) * 100) / 100} / {Number(h.max_score)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}
