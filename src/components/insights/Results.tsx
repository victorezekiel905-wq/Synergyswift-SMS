"use client";
import { useState } from "react";
import { useApi, Alert, Empty, Loading, Modal, Stat } from "@/components/ui";
import { BandBar, BandKey, heat } from "./Charts";
import type { GroupStat } from "@/lib/insights";

type Data = {
  terms: { id: string; label: string }[]; term_id: string | null; by: string; scope: "mine" | "school"; pass_mark: number;
  classes: { id: string; name: string }[];
  overall: GroupStat | null; stats: GroupStat[];
  cross: { rows: { key: string; label: string }[]; cols: { key: string; label: string }[]; cell: Record<string, { n: number; mean: number }> };
};
type History = { student: { id: string; name: string; admission_no: string; class_name: string | null }; history: { term: string; average: number | null; position: number | null; class_size: number | null; subjects: { subject_id: string; subject: string; total: number | null; grade: string | null }[] }[] };

const GROUPINGS = [
  { id: "class", label: "Class" }, { id: "subject", label: "Subject" }, { id: "teacher", label: "Teacher" },
  { id: "level", label: "Year group (cohort)" }, { id: "gender", label: "Boys and girls" }, { id: "student", label: "Student" }
];

/** Results by class, subject, teacher, year group, sex or student, with a subject-by-class grid. */
export default function Results() {
  const [term, setTerm] = useState("");
  const [by, setBy] = useState("class");
  const [cg, setCg] = useState("");
  const [student, setStudent] = useState<string | null>(null);
  const q = new URLSearchParams({ view: "academic", by, ...(term ? { term_id: term } : {}), ...(cg ? { class_group_id: cg } : {}) });
  const { data, error, loading } = useApi<Data>(`/api/insights?${q}`);
  const hist = useApi<History>(student ? `/api/insights?view=student&student_id=${student}` : null);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  if (!data.terms?.length) return <Empty>No terms are set up yet.</Empty>;
  const o = data.overall;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Term<select className="input mt-1" value={term || data.term_id || ""} onChange={e => setTerm(e.target.value)}>{data.terms.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
        <label className="text-sm">Group by<select className="input mt-1" value={by} onChange={e => setBy(e.target.value)}>{GROUPINGS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
        <label className="text-sm">Class<select className="input mt-1" value={cg} onChange={e => setCg(e.target.value)}><option value="">All classes</option>{data.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        {loading && <span className="text-xs text-slate-500">Updating…</span>}
        {data.scope === "mine" && <span className="text-xs text-slate-500">Showing the classes and subjects you teach, and your form class.</span>}
      </div>
      {!o ? <Empty>No results have been worked out for this term yet. Compile results under Results &amp; report cards first.</Empty> : <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Average score" value={o.mean ?? "—"} hint={`median ${o.median ?? "—"}`} />
          <Stat label="Pass rate" value={o.pass_rate === null ? "—" : `${o.pass_rate}%`} hint={`pass mark ${data.pass_mark}`} tone={(o.pass_rate ?? 0) >= 80 ? "good" : (o.pass_rate ?? 0) >= 60 ? "warn" : "bad"} />
          <Stat label="Students" value={o.students} />
          <Stat label="Subject scores" value={o.n} />
        </div>
        <section className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>
              <th className="p-2 text-left">{GROUPINGS.find(g => g.id === by)?.label}</th><th className="p-2">Scores</th><th className="p-2">Average</th><th className="p-2">Median</th><th className="p-2">Spread (sd)</th><th className="p-2">Pass rate</th><th className="w-48 p-2 text-left">Grade spread</th>
            </tr></thead>
            <tbody>{data.stats.map(s => (
              <tr key={s.key} className="border-t border-slate-100">
                <td className="p-2">{by === "student" ? <button className="font-medium text-brand-700 hover:underline" onClick={() => setStudent(s.key)}>{s.label}</button> : <span className="font-medium">{s.label}</span>}</td>
                <td className="p-2 text-center tabular-nums">{s.n}</td>
                <td className={`p-2 text-center font-semibold tabular-nums ${heat(s.mean)}`}>{s.mean ?? "—"}</td>
                <td className="p-2 text-center tabular-nums">{s.median ?? "—"}</td>
                <td className="p-2 text-center tabular-nums">{s.sd ?? "—"}</td>
                <td className="p-2 text-center tabular-nums">{s.pass_rate === null ? "—" : `${s.pass_rate}%`}</td>
                <td className="p-2"><BandBar bands={s.bands} /></td>
              </tr>))}</tbody>
          </table>
          <div className="border-t border-slate-100 p-2"><BandKey bands={Object.keys(o.bands)} /></div>
        </section>
        {data.cross.rows.length > 0 && data.cross.cols.length > 1 && (
          <section>
            <h3 className="mb-2 font-semibold">Average by subject and {cg ? "student" : "class"}</h3>
            <div className="card overflow-x-auto">
              <table className="text-xs">
                <thead className="bg-slate-50"><tr><th className="sticky left-0 bg-slate-50 p-2 text-left">Subject</th>{data.cross.cols.map(c => <th key={c.key} className="whitespace-nowrap p-2">{c.label}</th>)}</tr></thead>
                <tbody>{data.cross.rows.map(r => (
                  <tr key={r.key} className="border-t border-slate-100">
                    <td className="sticky left-0 whitespace-nowrap bg-white p-2 font-medium">{r.label}</td>
                    {data.cross.cols.map(c => { const v = data.cross.cell[`${r.key}|${c.key}`]; return <td key={c.key} className={`p-2 text-center tabular-nums ${heat(v?.mean)}`} title={v ? `${v.n} score${v.n === 1 ? "" : "s"}` : ""}>{v?.mean ?? ""}</td>; })}
                  </tr>))}</tbody>
              </table>
            </div>
          </section>
        )}
      </>}
      <Modal open={Boolean(student)} onClose={() => setStudent(null)} title={hist.data?.student.name ?? "Student"} wide>
        {hist.error && <Alert>{hist.error}</Alert>}
        {!hist.data ? <Loading /> : <StudentHistory h={hist.data} />}
      </Modal>
    </div>
  );
}

function StudentHistory({ h }: { h: History }) {
  if (!h.history.length) return <Empty>No report cards yet.</Empty>;
  const subjects = [...new Map(h.history.flatMap(t => t.subjects.map(s => [s.subject_id, s.subject] as const))).entries()];
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">{h.student.admission_no} · {h.student.class_name ?? ""}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50"><tr><th className="p-2 text-left">Subject</th>{h.history.map(t => <th key={t.term} className="whitespace-nowrap p-2">{t.term}</th>)}</tr></thead>
          <tbody>
            {subjects.map(([id, name]) => (
              <tr key={id} className="border-t border-slate-100"><td className="p-2 font-medium">{name}</td>
                {h.history.map(t => { const s = t.subjects.find(x => x.subject_id === id); return <td key={t.term} className={`p-2 text-center tabular-nums ${heat(s?.total)}`}>{s?.total ?? ""}{s?.grade ? ` ${s.grade}` : ""}</td>; })}
              </tr>))}
            <tr className="border-t-2 border-slate-200 font-semibold"><td className="p-2">Average</td>{h.history.map(t => <td key={t.term} className="p-2 text-center">{t.average ?? "—"}{t.position ? <div className="text-[10px] font-normal text-slate-500">{t.position} of {t.class_size}</div> : null}</td>)}</tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
