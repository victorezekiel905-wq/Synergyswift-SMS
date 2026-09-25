"use client";
import Link from "next/link";
import { useApi, Page, PageHeader, Alert, Empty, Badge, statusTone, fmtDate } from "@/components/ui";

type Exam = { id: string; title: string; subject: string | null; duration_minutes: number; opens_at: string | null; closes_at: string | null; window: string; require_seb: boolean; attempt_status: string | null; score: { total: number; max: number } | null };
type Result = { id: string; term: string; class_name: string; average: number | null; position: number | null; class_size: number | null; published_at: string; access_token: string };

export default function StudentHome() {
  const exams = useApi<Exam[]>("/api/student/exams");
  const results = useApi<Result[]>("/api/student/results");
  return (
    <Page>
      <PageHeader eyebrow="Student" title="My exams & results" />
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Exams</h2>
        {exams.error && <Alert tone="amber">{exams.error}</Alert>}
        {exams.data && !exams.data.length && <Empty>No exams for you right now.</Empty>}
        <div className="grid gap-3 sm:grid-cols-2">
          {(exams.data ?? []).map(e => (
            <div key={e.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-semibold">{e.title}</p><p className="text-xs text-slate-500">{e.subject ?? ""} · {e.duration_minutes} min{e.require_seb ? " · Safe Exam Browser" : ""}</p></div>
                <Badge tone={e.attempt_status ? statusTone(e.attempt_status) : e.window === "open" ? "green" : "slate"}>{e.attempt_status?.replace("_", " ") ?? e.window.replace("_", " ")}</Badge>
              </div>
              <p className="mt-2 text-xs text-slate-500">{e.opens_at ? `Opens ${fmtDate(e.opens_at, true)}` : ""}{e.closes_at ? ` · closes ${fmtDate(e.closes_at, true)}` : ""}</p>
              {e.score && <p className="mt-2 font-semibold">Score: {e.score.total} / {e.score.max}</p>}
              {(!e.attempt_status || ["in_progress", "locked"].includes(e.attempt_status)) && e.window === "open" &&
                <Link href={`/exam/${e.id}`} className="btn btn-primary mt-3 w-full">{e.attempt_status ? "Resume" : "Open exam"}</Link>}
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Report cards</h2>
        {results.error && <Alert tone="amber">{results.error}</Alert>}
        {results.data && !results.data.length && <Empty>No published results yet.</Empty>}
        <ul className="space-y-2">
          {(results.data ?? []).map(r => (
            <li key={r.id} className="card flex items-center justify-between p-4">
              <div><p className="font-semibold">{r.term}</p><p className="text-sm text-slate-500">{r.class_name} · average {r.average ?? "—"}%{r.position ? ` · position ${r.position} of ${r.class_size}` : ""}</p></div>
              <a className="btn btn-primary" href={`/r/${r.access_token}`} target="_blank" rel="noreferrer">View</a>
            </li>
          ))}
        </ul>
      </section>
    </Page>
  );
}
