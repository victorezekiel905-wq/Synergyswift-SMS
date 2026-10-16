"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApi, Loading, Alert, fmtDate } from "@/components/ui";

type SessionDef = { label: string; start: string; minutes: number };
type Data = {
  series: { id: string; name: string; starts_on: string; ends_on: string; sessions: SessionDef[] };
  halls: { id: string; name: string }[];
  papers: { id: string; title: string; class_group_ids: string[]; duration_minutes: number; slot_date: string | null; slot_session: number | null }[];
  class_groups: { id: string; name: string }[];
  seats: { paper_id: string; hall_id: string; student_id: string; row: number; col: number; label: string; name: string; admission_no: string | null; class_group_id: string | null }[];
  duties: { slot_date: string; slot_session: number; hall_id: string; staff_user_id: string; chief: boolean; name: string }[];
};
type View = "timetable" | "seating" | "door" | "roster";

export default function PrintPage() {
  return <Suspense fallback={<Loading />}><PrintInner /></Suspense>;
}

/** Printable exam-period documents: class timetables, seating plans, door lists and the invigilation roster. */
function PrintInner() {
  const id = useSearchParams().get("series") ?? "";
  const { data, error } = useApi<Data>(id ? `/api/exam-planner?series_id=${id}` : null);
  const [view, setView] = useState<View>("timetable");
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const s = data.series;
  const slot = (d: string | null, i: number | null) => d ? `${fmtDate(d)} · ${s.sessions[i ?? 0]?.label ?? ""} ${s.sessions[i ?? 0]?.start ?? ""}` : "—";
  const hall = new Map(data.halls.map(h => [h.id, h.name]));
  const paper = new Map(data.papers.map(p => [p.id, p]));
  const placed = data.papers.filter(p => p.slot_date).sort((a, b) => `${a.slot_date}${a.slot_session}`.localeCompare(`${b.slot_date}${b.slot_session}`));
  const slotKeys = [...new Set(placed.map(p => `${p.slot_date}#${p.slot_session ?? 0}`))];

  return (
    <main className="mx-auto max-w-5xl bg-white p-6 text-slate-900 print:p-0">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        {(["timetable", "seating", "door", "roster"] as View[]).map(v => (
          <button key={v} className={"btn " + (view === v ? "btn-primary" : "btn-ghost")} onClick={() => setView(v)}>
            {{ timetable: "Class timetables", seating: "Seating plans", door: "Door lists", roster: "Invigilation roster" }[v]}
          </button>
        ))}
        <button className="btn btn-outline ml-auto" onClick={() => window.print()}>Print / save as PDF</button>
      </div>

      {view === "timetable" && data.class_groups.filter(g => placed.some(p => p.class_group_ids.includes(g.id))).map(g => (
        <section key={g.id} className="mb-8 break-after-page">
          <h1 className="text-[22px] font-serif font-semibold tracking-[-0.01em]">{s.name}: {g.name}</h1>
          <p className="mb-3 text-sm text-slate-600">{fmtDate(s.starts_on)} – {fmtDate(s.ends_on)}</p>
          <table className="w-full border-collapse text-sm">
            <thead><tr className="bg-slate-100"><th className="border border-slate-300 p-1.5 text-left">Date and time</th><th className="border border-slate-300 p-1.5 text-left">Paper</th><th className="border border-slate-300 p-1.5">Minutes</th></tr></thead>
            <tbody>{placed.filter(p => p.class_group_ids.includes(g.id)).map(p => (
              <tr key={p.id}><td className="border border-slate-300 p-1.5">{slot(p.slot_date, p.slot_session)}</td><td className="border border-slate-300 p-1.5">{p.title}</td><td className="border border-slate-300 p-1.5 text-center">{p.duration_minutes}</td></tr>
            ))}</tbody>
          </table>
        </section>
      ))}

      {view === "seating" && slotKeys.flatMap(k => {
        const [d, i] = k.split("#");
        const seats = data.seats.filter(x => { const p = paper.get(x.paper_id); return p && `${p.slot_date}#${p.slot_session ?? 0}` === k; });
        return [...new Set(seats.map(x => x.hall_id))].map(h => {
          const inHall = seats.filter(x => x.hall_id === h);
          const rows = Math.max(...inHall.map(x => x.row)) + 1, cols = Math.max(...inHall.map(x => x.col)) + 1;
          const at = new Map(inHall.map(x => [`${x.row}|${x.col}`, x]));
          return (
            <section key={`${k}${h}`} className="mb-8 break-after-page">
              <h1 className="text-lg font-bold">{hall.get(h)}: {slot(d, Number(i))}</h1>
              <p className="mb-2 text-xs text-slate-600">{[...new Set(inHall.map(x => paper.get(x.paper_id)?.title))].join(" · ")} · {inHall.length} candidates · FRONT</p>
              <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                {Array.from({ length: rows * cols }, (_, n) => {
                  const x = at.get(`${Math.floor(n / cols)}|${n % cols}`);
                  return <div key={n} className="min-h-[40px] border border-slate-300 p-0.5 text-[9px] leading-tight">{x && <><b>{x.label}</b><br />{x.name}<br /><i>{paper.get(x.paper_id)?.title}</i></>}</div>;
                })}
              </div>
            </section>
          );
        });
      })}

      {view === "door" && slotKeys.map(k => {
        const [d, i] = k.split("#");
        const seats = data.seats.filter(x => { const p = paper.get(x.paper_id); return p && `${p.slot_date}#${p.slot_session ?? 0}` === k; }).sort((a, b) => a.name.localeCompare(b.name));
        return (
          <section key={k} className="mb-8 break-after-page">
            <h1 className="text-lg font-bold">Where to sit: {slot(d, Number(i))}</h1>
            <table className="mt-2 w-full border-collapse text-xs">
              <thead><tr className="bg-slate-100"><th className="border border-slate-300 p-1 text-left">Student</th><th className="border border-slate-300 p-1">Adm. no</th><th className="border border-slate-300 p-1 text-left">Paper</th><th className="border border-slate-300 p-1 text-left">Hall</th><th className="border border-slate-300 p-1">Seat</th></tr></thead>
              <tbody>{seats.map(x => <tr key={x.student_id + x.paper_id}><td className="border border-slate-300 p-1">{x.name}</td><td className="border border-slate-300 p-1 text-center">{x.admission_no}</td><td className="border border-slate-300 p-1">{paper.get(x.paper_id)?.title}</td><td className="border border-slate-300 p-1">{hall.get(x.hall_id)}</td><td className="border border-slate-300 p-1 text-center font-bold">{x.label}</td></tr>)}</tbody>
            </table>
          </section>
        );
      })}

      {view === "roster" && (
        <section>
          <h1 className="text-[22px] font-serif font-semibold tracking-[-0.01em]">{s.name}: invigilation roster</h1>
          <table className="mt-3 w-full border-collapse text-sm">
            <thead><tr className="bg-slate-100"><th className="border border-slate-300 p-1.5 text-left">Session</th><th className="border border-slate-300 p-1.5 text-left">Hall</th><th className="border border-slate-300 p-1.5 text-left">Invigilators (chief first)</th></tr></thead>
            <tbody>{[...new Set(data.duties.map(d => `${d.slot_date}#${d.slot_session}#${d.hall_id}`))].sort().map(k => {
              const [d, i, h] = k.split("#");
              const ds = data.duties.filter(x => x.slot_date === d && String(x.slot_session) === i && x.hall_id === h).sort((a, b) => Number(b.chief) - Number(a.chief));
              return <tr key={k}><td className="border border-slate-300 p-1.5">{slot(d, Number(i))}</td><td className="border border-slate-300 p-1.5">{hall.get(h)}</td><td className="border border-slate-300 p-1.5">{ds.map(x => x.name).join(", ")}</td></tr>;
            })}</tbody>
          </table>
        </section>
      )}
    </main>
  );
}
