"use client";
import Link from "next/link";
import { Badge, Empty } from "@/components/ui";
import type { Slot } from "@/lib/portal";

/** The day's periods: what is on now, what is next, and (for teachers) whether the register is taken. */
export default function DayPlan({ plan, teacher = false }: { plan: Slot[]; teacher?: boolean }) {
  const lessons = plan.filter(s => s.lesson);
  if (!plan.length) return <Empty>The timetable has not been set up yet.</Empty>;
  if (!lessons.length) return <Empty>No lessons today.</Empty>;
  return (
    <ol className="divide-y divide-slate-100">
      {plan.map(s => {
        if (s.period.is_break) return <li key={s.period.id} className="py-1.5 text-center text-xs text-slate-400">{s.period.name} · {s.period.starts_at.slice(0, 5)}</li>;
        if (!s.lesson) return teacher ? <li key={s.period.id} className="flex gap-3 py-2 text-sm text-slate-400"><span className="w-12 tabular-nums">{s.period.starts_at.slice(0, 5)}</span>Free</li> : null;
        const l = s.lesson;
        const tone = s.state === "now" ? "bg-brand-50 ring-1 ring-brand-200" : s.state === "next" ? "bg-amber-50/60" : "";
        return (
          <li key={s.period.id} className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm ${tone} ${s.state === "done" ? "opacity-60" : ""}`}>
            <span className="w-12 shrink-0 tabular-nums text-slate-500">{s.period.starts_at.slice(0, 5)}</span>
            <span className="min-w-0 flex-1">
              <b>{l.subject ?? "Lesson"}</b>
              <span className="text-slate-500">{teacher ? ` · ${l.class_name ?? ""}` : l.teacher ? ` · ${l.teacher}` : ""}{l.room ? ` · ${l.room}` : ""}</span>
              {l.cover && <span className="ml-1"><Badge tone="violet">cover</Badge></span>}
            </span>
            {s.state === "now" && <Badge tone="blue">now</Badge>}
            {s.state === "next" && <Badge tone="amber">next</Badge>}
            {teacher && (s.state === "done" || s.state === "now") && (
              l.register_taken ? <Badge tone="green">register taken</Badge>
                : <Link href="/school/attendance?tab=lessons" className="btn btn-primary px-2 py-1 text-xs">Take register</Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}
