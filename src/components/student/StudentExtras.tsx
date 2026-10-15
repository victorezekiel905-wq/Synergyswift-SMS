"use client";
export { StudentHomework } from "./StudentHomework";
import { useState } from "react";
import { useApi, send, Alert, Empty, Badge, fmtDate } from "@/components/ui";


type Period = { id: string; name: string; starts_at: string; ends_at: string; is_break: boolean };
type Entry = { day: number; period_id: string; subjects: { name: string } | null; users: { full_name: string } | null; room: string | null };

/** The student's class timetable (read-only). */
export function StudentTimetable() {
  const { data } = useApi<{ periods: Period[]; entries: Entry[] }>("/api/timetable");
  if (!data?.periods?.length || !data.entries?.length) return <Empty>Your timetable has not been published yet.</Empty>;
  const days = [1, 2, 3, 4, 5];
  const today = new Date().getDay();
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs">
        <thead className="bg-slate-50"><tr><th className="p-2 text-left">Period</th>{["Mon", "Tue", "Wed", "Thu", "Fri"].map((d, i) => <th key={d} className={"p-2 " + (days[i] === today ? "text-brand-700" : "")}>{d}</th>)}</tr></thead>
        <tbody>{data.periods.map(p => (
          <tr key={p.id} className={"border-t border-slate-100 " + (p.is_break ? "bg-slate-50" : "")}>
            <td className="p-2"><b>{p.name}</b><div className="text-slate-400">{p.starts_at.slice(0, 5)}</div></td>
            {days.map(d => { const e = data.entries.find(x => x.day === d && x.period_id === p.id); return (
              <td key={d} className={"p-1 text-center " + (d === today ? "bg-brand-50/50" : "")}>{p.is_break ? <span className="text-slate-400">{p.name}</span> : e ? <><b>{e.subjects?.name}</b><div className="text-[10px] text-slate-500">{e.users?.full_name}</div></> : null}</td>); })}
          </tr>))}</tbody>
      </table>
    </div>
  );
}
