"use client";
import { use, useState } from "react";
import { useApi, Loading, Alert, fmtDate } from "@/components/ui";

type Data = {
  student: { name: string; admission_no: string; date_of_birth: string | null; gender: string | null; photo_url: string | null; class_name: string | null };
  school: { school_name?: string; motto?: string; address?: string; logo_url?: string; brand_color?: string; principal_name?: string; principal_signature_url?: string; stamp_url?: string } | null;
  sessions: { id: string; name: string; terms: { id: string; name: string }[]; subjects: { subject: string; totals: Record<string, { total: number | null; grade: string | null }>; session_average: number | null }[]; term_averages: Record<string, number | null>; session_average: number | null }[];
  overall_average: number | null; published_only: boolean; generated_at: string;
};

/** Printable academic transcript across every session the student has results for. */
export default function TranscriptPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const [published, setPublished] = useState(true);
  const { data, error } = useApi<Data>(`/api/results/transcript?student_id=${id}${published ? "&published=1" : ""}`, [published]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const sc = data.school ?? {};
  const color = /^#[0-9a-f]{6}$/i.test(sc.brand_color ?? "") ? sc.brand_color! : "#2f4f8f";
  const cell = "border border-slate-300 p-1";
  return (
    <main className="mx-auto max-w-4xl bg-white p-6 text-slate-900 print:p-0">
      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} /> Only published results (for an official copy)</label>
        <button className="btn btn-primary ml-auto" onClick={() => window.print()}>Print / save as PDF</button>
      </div>
      <header className="flex items-center gap-4 border-b-4 pb-3" style={{ borderColor: color }}>
        {sc.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sc.logo_url} alt="" className="h-16 w-16 object-contain" />
        )}
        <div className="flex-1 text-center">
          <h1 className="text-xl font-bold uppercase" style={{ color }}>{sc.school_name}</h1>
          {sc.address && <p className="text-xs text-slate-600">{sc.address}</p>}
          <p className="mt-1 text-sm font-bold uppercase tracking-widest">Academic transcript</p>
        </div>
        {data.student.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.student.photo_url} alt="" className="h-16 w-16 rounded object-cover" />
        )}
      </header>
      <section className="mt-3 grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
        <p><span className="text-xs uppercase text-slate-500">Name: </span><b>{data.student.name}</b></p>
        <p><span className="text-xs uppercase text-slate-500">Admission no: </span><b>{data.student.admission_no}</b></p>
        <p><span className="text-xs uppercase text-slate-500">Date of birth: </span><b>{data.student.date_of_birth ? fmtDate(data.student.date_of_birth) : "—"}</b></p>
        <p><span className="text-xs uppercase text-slate-500">Current class: </span><b>{data.student.class_name ?? "—"}</b></p>
      </section>
      {!data.sessions.length && <p className="mt-6 text-sm text-slate-500">No {data.published_only ? "published " : ""}results yet.</p>}
      {data.sessions.map(s => (
        <section key={s.id} className="mt-5 break-inside-avoid">
          <h2 className="mb-1 font-bold">{s.name} session</h2>
          <table className="w-full border-collapse text-xs">
            <thead><tr className="bg-slate-100"><th className={cell + " text-left"}>Subject</th>{s.terms.map(t => <th key={t.id} className={cell}>{t.name}</th>)}<th className={cell}>Session average</th></tr></thead>
            <tbody>
              {s.subjects.map(r => (
                <tr key={r.subject}><td className={cell}>{r.subject}</td>
                  {s.terms.map(t => <td key={t.id} className={cell + " text-center tabular-nums"}>{r.totals[t.id]?.total ?? "—"}{r.totals[t.id]?.grade ? <span className="ml-1 text-[10px] text-slate-500">{r.totals[t.id]?.grade}</span> : null}</td>)}
                  <td className={cell + " text-center font-semibold"}>{r.session_average ?? "—"}</td></tr>
              ))}
              <tr className="bg-slate-50 font-semibold"><td className={cell}>Term average</td>{s.terms.map(t => <td key={t.id} className={cell + " text-center"}>{s.term_averages[t.id] ?? "—"}</td>)}<td className={cell + " text-center"}>{s.session_average ?? "—"}</td></tr>
            </tbody>
          </table>
        </section>
      ))}
      <section className="mt-6 flex flex-wrap items-end justify-between gap-6 text-sm">
        <p>Overall average: <b>{data.overall_average ?? "—"}</b></p>
        <div className="text-center">
          <div className="flex items-end justify-center gap-3">
            {sc.principal_signature_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sc.principal_signature_url} alt="Principal's signature" className="h-10 object-contain" />
            )}
            {sc.stamp_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sc.stamp_url} alt="School stamp" className="h-14 w-14 object-contain opacity-80" />
            )}
          </div>
          <p className="border-t border-slate-400 pt-1 text-xs">{sc.principal_name ?? "Principal"}</p>
        </div>
      </section>
      <p className="mt-4 text-[10px] text-slate-500">Issued {fmtDate(data.generated_at, true)}{data.published_only ? " from published report cards" : " (includes unpublished results: not an official copy)"}.</p>
    </main>
  );
}
