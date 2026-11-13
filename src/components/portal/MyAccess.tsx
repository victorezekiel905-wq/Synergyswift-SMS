"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi, Badge } from "@/components/ui";
import type { NavGroup } from "@/lib/nav";
import type { MyClass } from "@/lib/my-access";

type Access = {
  name: string; staff_no: string | null; position: string | null;
  roles: { key: string; label: string }[];
  custom_role: { name: string; adds: string[]; takes_away: string[] } | null;
  areas: NavGroup[]; classes: MyClass[]; subjects: string[];
};

/**
 * A member of staff's own dashboard panel: their roles, the classes they were given (form teacher,
 * subjects, class team privileges) and every area their privileges open, with the pages in it.
 */
export default function MyAccess({ showClasses = true }: { showClasses?: boolean }) {
  const { data, error } = useApi<Access>("/api/staff/my-access");
  const [all, setAll] = useState(false);
  if (error) return null;
  if (!data) return <section className="card mb-6 h-28 animate-pulse p-5" aria-label="Loading your access" />;
  const pages = data.areas.reduce((n, g) => n + g.links.length, 0);
  const areas = all ? data.areas : data.areas.slice(0, 6);
  return (
    <div className="mb-8 space-y-4">
      <section className="card p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-base font-semibold">My role and access</h2>
          {data.staff_no && <span className="text-xs text-slate-500">ID {data.staff_no}{data.position ? ` · ${data.position}` : ""}</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.roles.map((r, i) => <Badge key={r.key} tone={i === 0 ? "blue" : "slate"}>{r.label}</Badge>)}
          {data.custom_role && <Badge tone="violet">{data.custom_role.name}</Badge>}
        </div>
        {data.custom_role && (data.custom_role.adds.length > 0 || data.custom_role.takes_away.length > 0) && (
          <p className="mt-2 text-xs text-slate-500">
            {data.custom_role.adds.length > 0 && <>Your school role adds: {data.custom_role.adds.join(", ")}. </>}
            {data.custom_role.takes_away.length > 0 && <>Not included: {data.custom_role.takes_away.join(", ")}.</>}
          </p>
        )}
        {data.subjects.length > 0 && <p className="mt-3 text-sm text-slate-700">Subjects you teach: <b>{data.subjects.join(", ")}</b></p>}
        <p className="mt-3 text-sm text-slate-600">Your privileges open {pages} page{pages === 1 ? "" : "s"} in {data.areas.length} area{data.areas.length === 1 ? "" : "s"}:</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map(g => (
            <div key={g.id} className="rounded-lg border border-slate-200 p-3">
              <p className="text-[13px] font-semibold text-slate-800">{g.title}</p>
              <ul className="mt-1.5 space-y-1 text-sm">
                {g.links.map(l => (
                  <li key={l.href}><Link href={l.href} className="text-brand-700 hover:underline">{l.label}</Link>{l.hint && <span className="text-xs text-slate-500"> · {l.hint}</span>}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {data.areas.length > 6 && <button className="btn btn-ghost mt-2 text-xs" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${data.areas.length} areas`}</button>}
      </section>

      {showClasses && (
        <section className="card p-5">
          <h2 className="text-base font-semibold">My classes</h2>
          {!data.classes.length ? (
            <p className="mt-2 text-sm text-slate-500">No classes are assigned to you yet. The school office puts you in classes under Onboarding or Class teams; they show here straight away.</p>
          ) : (
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.classes.map(c => (
                <li key={c.class_group_id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center gap-2">
                    <p className="mr-auto font-semibold">{c.name}</p>
                    {c.form && <Badge tone="green">Class teacher</Badge>}
                  </div>
                  {c.subjects.length > 0 && <p className="mt-1 text-sm text-slate-700">{c.subjects.join(", ")}</p>}
                  {c.team.map((t, i) => (
                    <p key={i} className="mt-1 text-xs text-slate-600">
                      Class team ({t.role.replace(/_/g, " ")}{t.subject ? `, ${t.subject}` : ""}){t.privileges.length ? `: ${t.privileges.join(", ")}` : ""}
                    </p>
                  ))}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <Link href={`/school/attendance?class=${c.class_group_id}`} className="text-brand-700 hover:underline">Register</Link>
                    {c.subjects.length > 0 && <Link href="/school/results" className="text-brand-700 hover:underline">Scores</Link>}
                    {c.subjects.length > 0 && <Link href="/school/homework" className="text-brand-700 hover:underline">Homework</Link>}
                    {c.form && <Link href="/school/class-codes" className="text-brand-700 hover:underline">Class codes</Link>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
