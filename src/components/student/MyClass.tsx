"use client";
import Link from "next/link";
import { useApi } from "@/components/ui";

type Data = { first_name: string; admission_no: string | null;
  class: { name: string; level: string | null; class_teacher: string | null; size: number | null; subjects: { subject: string; teacher: string | null }[] } | null };

/** The student's own class at the top of their page, with the way into their analysis. */
export default function MyClass() {
  const { data } = useApi<Data>("/api/student/class");
  if (!data) return null;
  const c = data.class;
  return (
    <section className="card mb-6 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <p className="text-[13px] text-slate-500">My class</p>
          <h2 className="text-xl font-semibold">{c ? c.name : "Not in a class yet"}</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {c ? [c.class_teacher ? `Class teacher: ${c.class_teacher}` : null, c.size ? `${c.size} students` : null, data.admission_no ? `Admission no. ${data.admission_no}` : null].filter(Boolean).join(" · ")
              : "The school puts you in your class; it shows here straight away."}
          </p>
        </div>
        <Link href="/student/analysis" className="btn btn-primary">My analysis</Link>
      </div>
      {c && c.subjects.length > 0 && (
        <ul className="mt-4 grid gap-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {c.subjects.map(s => (
            <li key={s.subject} className="rounded-lg border border-slate-200 px-3 py-2"><b>{s.subject}</b>{s.teacher && <span className="block text-xs text-slate-500">{s.teacher}</span>}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
