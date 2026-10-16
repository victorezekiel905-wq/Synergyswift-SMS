"use client";
import { fmtDate, money } from "@/components/ui";
import type { ChildGlance as Glance } from "@/lib/portal";

export type GlanceData = Glance & { next_homework: { title: string; subject: string | null; due_at: string } | null };

const attTone = (r: number | null) => (r === null ? "" : r >= 95 ? "text-emerald-600" : r >= 90 ? "text-amber-600" : "text-rose-600");

/** One child's attendance, homework and fees in a row of small figures. */
export function GlanceStrip({ g }: { g: GlanceData }) {
  return (
    <div className="grid grid-cols-3 gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3 text-center text-sm">
      <div>
        <p className="text-xs text-slate-500">Attendance this term</p>
        <p className={`font-bold ${attTone(g.attendance_rate)}`}>{g.attendance_rate === null ? "—" : `${g.attendance_rate}%`}</p>
        <p className="text-xs text-slate-500">{g.absences} absent · {g.late} late</p>
      </div>
      <div>
        <p className="text-xs text-slate-500">Homework</p>
        <p className={`font-bold ${g.homework_overdue ? "text-rose-600" : ""}`}>{g.homework_overdue ? `${g.homework_overdue} overdue` : `${g.homework_due_week} due this week`}</p>
        <p className="truncate text-xs text-slate-500" title={g.next_homework?.title}>{g.next_homework ? `next: ${g.next_homework.subject ?? g.next_homework.title}, ${fmtDate(g.next_homework.due_at)}` : "nothing due"}</p>
      </div>
      <div>
        <p className="text-xs text-slate-500">Fees</p>
        <p className={`font-bold ${g.overdue > 0 ? "text-rose-600" : g.owed > 0 ? "text-amber-600" : "text-emerald-600"}`}>{g.owed > 0 ? money(g.owed) : "Paid"}</p>
        <p className="text-xs text-slate-500">{g.overdue > 0 ? `${money(g.overdue)} past due` : g.owed > 0 ? "outstanding" : "nothing owed"}</p>
      </div>
    </div>
  );
}

/** All children side by side, for families with more than one child at the school. */
export function FamilySummary({ kids }: { kids: { id: string; name: string; class_name: string | null; on_site: boolean; glance?: GlanceData | null }[] }) {
  if (kids.length < 2) return null;
  const owed = kids.reduce((a, k) => a + (k.glance?.owed ?? 0), 0);
  return (
    <section className="card mb-5 overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr><th className="p-2 text-left">Child</th><th className="p-2">In school</th><th className="p-2">Attendance</th><th className="p-2">Homework</th><th className="p-2 text-right">Fees owed</th></tr>
        </thead>
        <tbody>
          {kids.map(k => (
            <tr key={k.id} className="border-t border-slate-100">
              <td className="p-2"><a href={`#child-${k.id}`} className="font-semibold hover:underline">{k.name}</a><div className="text-xs text-slate-500">{k.class_name ?? ""}</div></td>
              <td className="p-2 text-center">{k.on_site ? "Yes" : "No"}</td>
              <td className={`p-2 text-center font-semibold ${attTone(k.glance?.attendance_rate ?? null)}`}>{k.glance?.attendance_rate == null ? "—" : `${k.glance.attendance_rate}%`}</td>
              <td className="p-2 text-center">{k.glance ? (k.glance.homework_overdue ? <span className="text-rose-600">{k.glance.homework_overdue} overdue</span> : `${k.glance.homework_due_week} due`) : "—"}</td>
              <td className="p-2 text-right tabular-nums">{k.glance ? money(k.glance.owed) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t border-slate-200 font-semibold"><td className="p-2" colSpan={4}>Total owed</td><td className="p-2 text-right tabular-nums">{money(owed)}</td></tr></tfoot>
      </table>
    </section>
  );
}
