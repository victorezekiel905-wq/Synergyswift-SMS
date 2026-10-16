"use client";
import { useApi } from "@/components/ui";

type Link = { id: string; title: string; lti_tools: { name: string } | null; subjects: { name: string } | null; homework: { title: string } | null;
  my_score: { score_given: number | null; score_maximum: number | null; grading_progress: string } | null };

/** Learning tools added to the student's class, opened without another password. */
export default function MyTools() {
  const { data } = useApi<{ links: Link[] }>("/api/lti/manage");
  if (!data?.links?.length) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold">Learning tools</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {data.links.map(l => (
          <a key={l.id} href={`/api/lti/launch/${l.id}`} target="_blank" rel="noreferrer" className="card block p-4 transition hover:border-brand-300">
            <p className="font-semibold">{l.title}</p>
            <p className="text-xs text-slate-500">{l.lti_tools?.name}{l.subjects ? ` · ${l.subjects.name}` : ""}{l.homework ? ` · counts for “${l.homework.title}”` : ""}</p>
            {l.my_score?.score_given != null && <p className="mt-1 text-sm">Your score: <b>{l.my_score.score_given}{l.my_score.score_maximum ? ` / ${l.my_score.score_maximum}` : ""}</b></p>}
          </a>
        ))}
      </div>
    </section>
  );
}
