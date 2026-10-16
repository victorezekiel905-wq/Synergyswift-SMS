"use client";
import { useApi, Badge, fmtDate, fmtTime, money } from "@/components/ui";
import DayPlan from "@/components/portal/DayPlan";
import type { Slot, HomeworkItem, FeeSummary } from "@/lib/portal";

type Today = {
  linked: boolean; date: string; plan: Slot[]; homework: HomeworkItem[];
  loans: { id: string; title: string; due_at: string; overdue: boolean }[];
  fees: FeeSummary | null;
  attendance: { rate: number | null; absences: number; late: number; days: number };
};

const HW_TONE = { overdue: "red", due_today: "amber", due: "slate", submitted: "blue", marked: "green" } as const;
const HW_LABEL = { overdue: "overdue", due_today: "due today", due: "due", submitted: "handed in", marked: "marked" } as const;

/** The top of the student portal: today's lessons, homework, books, fees and attendance in one place. */
export default function MyDay() {
  const { data } = useApi<Today>("/api/student/today");
  if (!data?.linked) return null;
  const a = data.attendance;
  return (
    <section className="mb-8 grid gap-4 lg:grid-cols-5">
      <div className="card p-4 lg:col-span-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Today</h2>
          <span className="text-xs text-slate-500">{fmtDate(data.date)}</span>
        </div>
        <DayPlan plan={data.plan} />
      </div>
      <div className="space-y-4 lg:col-span-2">
        <div className="card p-4">
          <h2 className="mb-2 font-semibold">Homework</h2>
          {!data.homework.length ? <p className="text-sm text-slate-500">Nothing set in the last three weeks.</p> : (
            <ul className="space-y-1.5 text-sm">
              {data.homework.slice(0, 8).map(h => (
                <li key={h.id} className="flex items-start justify-between gap-2">
                  <span className="min-w-0"><b>{h.title}</b><br /><span className="text-xs text-slate-500">{h.subject ?? ""}{h.subject ? " · " : ""}{h.state === "marked" && h.score !== null ? `score ${h.score}` : `due ${fmtDate(h.due_at)} ${fmtTime(h.due_at)}`}</span></span>
                  <Badge tone={HW_TONE[h.state]}>{HW_LABEL[h.state]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="card p-3">
            <p className="text-xs uppercase text-slate-500">Attendance this term</p>
            <p className={`text-xl font-bold ${a.rate !== null && a.rate < 90 ? "text-amber-600" : ""}`}>{a.rate === null ? "—" : `${a.rate}%`}</p>
            <p className="text-xs text-slate-500">{a.absences} absent · {a.late} late</p>
          </div>
          {data.fees && (
            <div className="card p-3">
              <p className="text-xs uppercase text-slate-500">School fees</p>
              <p className={`text-xl font-bold ${data.fees.overdue > 0 ? "text-rose-600" : data.fees.owed > 0 ? "text-amber-600" : "text-emerald-600"}`}>{data.fees.owed > 0 ? money(data.fees.owed) : "Paid"}</p>
              <p className="text-xs text-slate-500">{data.fees.overdue > 0 ? `${money(data.fees.overdue)} past due` : data.fees.next_due ? `next due ${fmtDate(data.fees.next_due)}` : data.fees.invoices ? "nothing outstanding" : "no bills yet"}</p>
            </div>
          )}
        </div>
        {data.loans.length > 0 && (
          <div className="card p-4">
            <h2 className="mb-2 font-semibold">Library books</h2>
            <ul className="space-y-1 text-sm">
              {data.loans.map(l => <li key={l.id} className={l.overdue ? "text-rose-600" : ""}>{l.title}: {l.overdue ? "overdue since" : "due"} {fmtDate(l.due_at)}</li>)}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
