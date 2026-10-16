"use client";
import { useState } from "react";
import { useApi, Alert, Empty, Loading, Badge } from "@/components/ui";
import type { VaResult } from "@/lib/insights";

type Data = { terms: { id: string; label: string }[]; term_id: string; previous: string | null; by: string; pairs: number; groups: VaResult[]; subjects: { subject: string; n: number; slope: number; r2: number }[] };

const SIGNAL = { above: ["green", "above expected"], below: ["red", "below expected"], in_line: ["slate", "in line"], too_few: ["amber", "too few to judge"] } as const;

/** Progress against what students' starting points predicted, by teacher or class. */
export default function ValueAdded() {
  const [term, setTerm] = useState("");
  const [by, setBy] = useState("teacher");
  const { data, error } = useApi<Data>(`/api/insights?view=value_added&by=${by}${term ? `&term_id=${term}` : ""}`);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const span = Math.max(10, ...data.groups.map(g => Math.max(Math.abs(g.low ?? g.va ?? 0), Math.abs(g.high ?? g.va ?? 0))));
  const x = (v: number) => 50 + (v / span) * 50;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Term<select className="input mt-1" value={term || data.term_id} onChange={e => setTerm(e.target.value)}>{data.terms.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
        <label className="text-sm">By<select className="input mt-1" value={by} onChange={e => setBy(e.target.value)}><option value="teacher">Teacher</option><option value="class">Class</option></select></label>
      </div>
      <p className="text-sm text-slate-600">
        Each student’s score is compared with what students who started from the same score {data.previous ? <>in <b>{data.previous}</b></> : "last term"} got in the same subject across the school.
        The figure is the average difference, in marks. A group is marked above or below only when the whole 95% range sits on one side of zero and there are at least 10 scores, so small or mixed groups are not judged.
        Use it to start a conversation, never on its own for decisions about staff.
      </p>
      {!data.previous ? <Empty>Value added needs results from the term before this one.</Empty> : !data.groups.length ? <Empty>No students have results in both terms yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-2 text-left">{by === "teacher" ? "Teacher" : "Class"}</th><th className="p-2">Scores</th><th className="p-2">Value added</th><th className="w-64 p-2">Range (95%)</th><th className="p-2">Reading</th></tr></thead>
            <tbody>{data.groups.map(g => (
              <tr key={g.key} className="border-t border-slate-100">
                <td className="p-2 font-medium">{g.label}</td>
                <td className="p-2 text-center tabular-nums">{g.n}</td>
                <td className={`p-2 text-center font-semibold tabular-nums ${(g.va ?? 0) > 0 ? "text-emerald-700" : (g.va ?? 0) < 0 ? "text-rose-700" : ""}`}>{g.va === null ? "—" : `${g.va > 0 ? "+" : ""}${g.va}`}</td>
                <td className="p-2">
                  <svg viewBox="0 0 100 10" className="h-3 w-full" aria-hidden>
                    <line x1="50" x2="50" y1="0" y2="10" stroke="#94a3b8" strokeWidth="0.5" />
                    {g.low !== null && g.high !== null && <line x1={x(g.low)} x2={x(g.high)} y1="5" y2="5" stroke="#1d5ddb" strokeWidth="2" />}
                    {g.va !== null && <circle cx={x(g.va)} cy="5" r="2" fill="#1d5ddb" />}
                  </svg>
                  <div className="text-center text-[10px] text-slate-500">{g.low !== null ? `${g.low} to ${g.high}` : ""}</div>
                </td>
                <td className="p-2 text-center"><Badge tone={SIGNAL[g.signal][0]}>{SIGNAL[g.signal][1]}</Badge></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {data.subjects.length > 0 && (
        <details className="text-sm"><summary className="cursor-pointer text-slate-600">How well last term predicts this term, by subject</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">{data.subjects.map(s => <li key={s.subject}>{s.subject}: {s.n} students, each mark last term ≈ {s.slope} this term (fit {Math.round(s.r2 * 100)}%)</li>)}</ul>
        </details>
      )}
    </div>
  );
}
