"use client";
import { use } from "react";
import { useApi, fmtDate } from "@/components/ui";

type Data = { school: { name: string; logo_url: string | null; brand_color: string | null; address: string | null; email: string | null };
  jobs: { title: string; department: string | null; employment_type: string; location: string | null; salary_range: string | null; closes_on: string | null; token: string }[] };

const TYPE: Record<string, string> = { full_time: "Full time", part_time: "Part time", contract: "Contract", volunteer: "Volunteer" };

/** The school's careers page: open jobs, each with its own page to apply. */
export default function CareersPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = use(props.params);
  const { data, error } = useApi<Data>(`/api/careers/${slug}`);
  if (error) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">{error}</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const color = data.school.brand_color ?? "#2f4f8f";
  return (
    <main className="mx-auto max-w-3xl bg-white p-4 sm:p-8">
      <header className="mb-6 flex items-center gap-3 border-b-4 pb-3" style={{ borderColor: color }}>
        {data.school.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.school.logo_url} alt="" className="h-14 w-14 object-contain" />
        )}
        <div><h1 className="text-[22px] font-serif font-semibold tracking-[-0.01em]" style={{ color }}>Careers at {data.school.name}</h1>{data.school.address && <p className="text-sm text-slate-600">{data.school.address}</p>}</div>
      </header>
      {!data.jobs.length ? (
        <p className="rounded-lg bg-slate-50 p-4 text-slate-700">There are no vacancies at the moment. Please check again later{data.school.email ? <>, or send your CV to <a className="underline" href={`mailto:${data.school.email}`}>{data.school.email}</a></> : null}.</p>
      ) : (
        <ul className="space-y-3">{data.jobs.map(j => (
          <li key={j.token}>
            <a href={`/careers/${slug}/${j.token}`} className="block rounded-xl border border-slate-200 p-4 transition hover:border-slate-400 hover:shadow-sm">
              <p className="text-lg font-semibold" style={{ color }}>{j.title}</p>
              <p className="mt-1 text-sm text-slate-600">{[j.department, TYPE[j.employment_type], j.location, j.salary_range].filter(Boolean).join(" · ")}</p>
              {j.closes_on && <p className="mt-1 text-xs text-slate-500">Closes {fmtDate(j.closes_on)}</p>}
            </a>
          </li>))}</ul>
      )}
    </main>
  );
}
