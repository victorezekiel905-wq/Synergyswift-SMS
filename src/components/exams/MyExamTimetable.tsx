"use client";
import { useApi, Badge, fmtDate } from "@/components/ui";

type SessionDef = { label: string; start: string };
type Data = {
  series: { id: string; name: string; sessions: SessionDef[] }[];
  papers: { id: string; series_id: string; title: string; duration_minutes: number; slot_date: string | null; slot_session: number | null; hall: string | null; seat: string | null }[];
  duties: { series_id: string; slot_date: string; slot_session: number; hall: string | null; chief: boolean }[];
};

/** A student's published exam timetable with hall and seat, or a teacher's invigilation duties. Renders nothing when there are none. */
export default function MyExamTimetable() {
  const { data } = useApi<Data>("/api/exam-planner/mine");
  if (!data || (!data.papers.length && !data.duties.length)) return null;
  const sess = (seriesId: string, i: number | null) => data.series.find(s => s.id === seriesId)?.sessions?.[i ?? 0];
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold">{data.papers.length ? "Exam timetable" : "My invigilation duties"}</h2>
      <ul className="card divide-y divide-slate-100 text-sm">
        {data.papers.map(p => {
          const s = sess(p.series_id, p.slot_session);
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-2 p-3">
              <span className="w-48 text-slate-600">{p.slot_date ? `${fmtDate(p.slot_date)} · ${s?.label ?? ""} ${s?.start ?? ""}` : "Date to be confirmed"}</span>
              <span className="font-medium">{p.title}</span>
              <span className="text-xs text-slate-500">{p.duration_minutes} min</span>
              {p.seat && <span className="ml-auto"><Badge tone="blue">{p.hall} · seat {p.seat}</Badge></span>}
            </li>
          );
        })}
        {data.duties.map((d, i) => {
          const s = sess(d.series_id, d.slot_session);
          return (
            <li key={i} className="flex flex-wrap items-center gap-2 p-3">
              <span className="w-48 text-slate-600">{fmtDate(d.slot_date)} · {s?.label ?? ""} {s?.start ?? ""}</span>
              <span className="font-medium">{d.hall}</span>
              {d.chief && <Badge tone="blue">chief invigilator</Badge>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
