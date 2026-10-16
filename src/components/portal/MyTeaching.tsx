"use client";
import Link from "next/link";
import { fmtDate } from "@/components/ui";
import { useOfflineApi, OfflineNote } from "@/components/offline";
import DayPlan from "@/components/portal/DayPlan";
import type { Slot, TeacherTask } from "@/lib/portal";

type Today = {
  date: string; plan: Slot[]; tasks: TeacherTask[];
  classes: { class_group_id: string; class_name: string; subject: string }[];
  form_classes: { id: string; name: string }[];
};

const TOOLS = [
  { href: "/school/attendance?tab=lessons", label: "Registers" },
  { href: "/school/results", label: "Gradebook" },
  { href: "/school/homework", label: "Homework" },
  { href: "/school/lesson-notes", label: "Lesson plans" },
  { href: "/school/schemes", label: "Schemes of work" },
  { href: "/school/learning", label: "Lessons & content" },
  { href: "/school/inbox", label: "Parent messages" },
  { href: "/calendar", label: "Calendar" }
];

/** A teacher's day: what to do next, today's lessons with registers, and their classes. */
export default function MyTeaching({ compact = false }: { compact?: boolean }) {
  const { data, offlineAt, reload } = useOfflineApi<Today>("/api/teacher/today");
  if (!data) return null;
  const hasTeaching = data.plan.some(s => s.lesson) || data.classes.length > 0 || data.form_classes.length > 0;
  if (compact && !hasTeaching && !data.tasks.length) return null;
  return (
    <>
    <OfflineNote at={offlineAt} onRetry={reload} />
    <section className="mb-8 grid gap-4 lg:grid-cols-5">
      <div className="card p-4 lg:col-span-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Today’s lessons</h2>
          <span className="text-xs text-slate-500">{fmtDate(data.date)}</span>
        </div>
        <DayPlan plan={data.plan} teacher />
      </div>
      <div className="space-y-4 lg:col-span-2">
        <div className="card p-4">
          <h2 className="mb-2 font-semibold">To do</h2>
          {!data.tasks.length ? <p className="text-sm text-emerald-700">All caught up.</p> : (
            <ul className="space-y-1.5 text-sm">
              {data.tasks.map((t, i) => (
                <li key={i}>
                  <Link href={t.href} className={`flex items-center justify-between rounded-lg border px-3 py-2 hover:border-brand-300 ${t.urgent ? "border-rose-200 bg-rose-50/60" : "border-slate-200"}`}>
                    <span>{t.label}</span><span aria-hidden>→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!compact && (
          <div className="card p-4">
            <h2 className="mb-2 font-semibold">My classes</h2>
            {data.form_classes.length > 0 && <p className="mb-2 text-sm">Form tutor: <b>{data.form_classes.map(c => c.name).join(", ")}</b></p>}
            {!data.classes.length ? <p className="text-sm text-slate-500">No subjects are assigned to you yet.</p> : (
              <ul className="flex flex-wrap gap-1.5 text-xs">
                {data.classes.map(c => <li key={`${c.class_group_id}-${c.subject}`} className="rounded-full bg-slate-100 px-2.5 py-1">{c.class_name} · {c.subject}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="card p-4">
          <h2 className="mb-2 font-semibold">Go to</h2>
          <div className="grid grid-cols-2 gap-1.5 text-sm">
            {TOOLS.map(t => <Link key={t.href} href={t.href} className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-brand-300">{t.label}</Link>)}
          </div>
        </div>
      </div>
    </section>
    </>
  );
}
