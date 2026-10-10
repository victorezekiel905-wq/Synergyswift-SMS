"use client";
import { use, useState } from "react";
import { useApi, send } from "@/components/ui";
import type { Question } from "@/lib/community";

type Data = { survey: { title: string; intro: string | null; questions: Question[]; anonymous: boolean }; answered: boolean; closed: boolean; name: string | null; school: { name: string; logo_url: string | null; brand_color: string | null } };

/** A family answers a survey from their private link. */
export default function SurveyPage(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const { data, error } = useApi<Data>(`/api/s/${token}`);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (error) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">{error}</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const color = data.school.brand_color ?? "#1d5ddb";
  const head = (
    <header className="mb-4 flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
        {data.school.logo_url && <img src={data.school.logo_url} alt="" className="h-10 w-10 rounded" />}
      <p className="font-semibold" style={{ color }}>{data.school.name}</p>
    </header>
  );
  if (done || data.answered) return <main className="mx-auto max-w-xl p-6">{head}<h1 className="text-xl font-bold">Thank you</h1><p className="mt-2 text-slate-600">{done ? "Your answers have been sent." : "You have already answered this survey."} We read every response.</p></main>;
  if (data.closed) return <main className="mx-auto max-w-xl p-6">{head}<h1 className="text-xl font-bold">{data.survey.title}</h1><p className="mt-2 text-slate-600">This survey has closed. Thank you.</p></main>;
  const set = (id: string, v: string | number) => setAnswers(a => ({ ...a, [id]: v }));
  return (
    <main className="mx-auto max-w-xl p-6">
      {head}
      <h1 className="text-2xl font-bold">{data.survey.title}</h1>
      {data.name && <p className="text-slate-600">For {data.name}</p>}
      {data.survey.intro && <p className="mt-2 whitespace-pre-wrap text-slate-700">{data.survey.intro}</p>}
      {data.survey.anonymous && <p className="mt-1 text-xs text-slate-500">Your answers are anonymous: the school cannot see who wrote them.</p>}
      <form className="mt-5 space-y-6" onSubmit={async e => {
        e.preventDefault();
        setBusy(true); setErr(null);
        const r = await send(`/api/s/${token}`, { answers });
        setBusy(false);
        if (r.ok) setDone(true); else setErr(r.error);
      }}>
        {data.survey.questions.map(q => (
          <fieldset key={q.id}>
            <legend className="mb-2 font-medium">{q.label}{q.required && <span className="text-rose-600"> *</span>}</legend>
            {q.type === "nps" && (
              <div>
                <div className="grid grid-cols-11 gap-1">{Array.from({ length: 11 }, (_, n) => (
                  <button key={n} type="button" aria-pressed={answers[q.id] === n} onClick={() => set(q.id, n)}
                    className={"rounded-md border py-2 text-sm font-semibold tabular-nums " + (answers[q.id] === n ? "border-transparent text-white" : "border-slate-300 text-slate-700")}
                    style={answers[q.id] === n ? { background: color } : undefined}>{n}</button>
                ))}</div>
                <div className="mt-1 flex justify-between text-xs text-slate-500"><span>Not at all likely</span><span>Extremely likely</span></div>
              </div>
            )}
            {q.type === "rating" && (
              <div className="flex gap-1" role="radiogroup">{[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" role="radio" aria-checked={answers[q.id] === n} aria-label={`${n} of 5`} onClick={() => set(q.id, n)}
                  className={"text-3xl " + (Number(answers[q.id] ?? 0) >= n ? "text-amber-400" : "text-slate-300")}>★</button>
              ))}</div>
            )}
            {q.type === "choice" && (
              <div className="space-y-1">{(q.options ?? []).map(o => (
                <label key={o} className="flex items-center gap-2"><input type="radio" name={q.id} checked={answers[q.id] === o} onChange={() => set(q.id, o)} /> {o}</label>
              ))}</div>
            )}
            {q.type === "text" && <textarea className="input min-h-20" value={String(answers[q.id] ?? "")} onChange={e => set(q.id, e.target.value)} maxLength={2000} aria-label={q.label} />}
          </fieldset>
        ))}
        {err && <p className="rounded bg-rose-50 p-2 text-sm text-rose-800" role="alert">{err}</p>}
        <button className="btn w-full text-white" style={{ background: color }} disabled={busy}>{busy ? "Sending…" : "Send answers"}</button>
      </form>
    </main>
  );
}
