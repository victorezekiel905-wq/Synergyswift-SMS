"use client";
import { useState } from "react";
import { useApi, Page, PageHeader, Alert, Empty, Stat, money, Loading } from "@/components/ui";

type School = { id: string; name: string; status: string; term: string | null; students: number; staff: number; currency: string;
  fees: { billed: number; paid: number; outstanding: number; collection_rate: number | null }; collected_30d: number; attendance_30d: number | null; average_score: number | null;
  pass_rate?: number | null; staff_on_time?: number | null; applications_90d?: number; admitted_90d?: number };
type SortKey = "name" | "students" | "collection" | "outstanding" | "attendance" | "average" | "pass" | "staff" | "admissions";
const KEY: Record<SortKey, (s: School) => number | string> = {
  name: s => s.name, students: s => s.students, collection: s => s.fees.collection_rate ?? -1, outstanding: s => s.fees.outstanding, attendance: s => s.attendance_30d ?? -1,
  average: s => s.average_score ?? -1, pass: s => s.pass_rate ?? -1, staff: s => s.staff_on_time ?? -1, admissions: s => s.admitted_90d ?? 0
};

/** Proprietor console: every branch side by side. */
export default function GroupPage() {
  const { data, error } = useApi<{ groups: { id: string; name: string }[]; schools: School[] }>("/api/group");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });
  if (error) return <Page><Alert>{error === "not found" ? "You do not have access to a school group." : error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const t = data.schools.reduce((a, s) => ({ students: a.students + s.students, staff: a.staff + s.staff, billed: a.billed + s.fees.billed, paid: a.paid + s.fees.paid, c30: a.c30 + s.collected_30d }),
    { students: 0, staff: 0, billed: 0, paid: 0, c30: 0 });
  // Money only adds up across branches that use the same currency.
  const currencies = [...new Set(data.schools.map(s => s.currency))];
  const cur = currencies.length === 1 ? currencies[0] : null;
  return (
    <Page wide>
      <PageHeader eyebrow={data.groups.map(g => g.name).join(", ")} title="All branches" subtitle="Live numbers across your schools: enrolment, fees, attendance and results." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Schools" value={data.schools.length} /><Stat label="Students" value={t.students} /><Stat label="Staff" value={t.staff} />
        <Stat label="Fees collected this term" value={cur ? money(t.paid, cur) : "per branch"} hint={cur ? `of ${money(t.billed, cur)}` : `branches use ${currencies.join(", ")}`} /><Stat label="Collected (30 days)" value={cur ? money(t.c30, cur) : "per branch"} tone="good" />
      </div>
      {!data.schools.length ? <Empty>No schools in this group yet.</Empty> : (<>
        <div className="mb-2 flex justify-end"><a className="btn btn-outline" href="/api/group?format=csv">Download CSV</a></div>
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr>{([["name", "School", false], ["students", "Students", true], ["staff", "Staff on time (30d)", true], ["collection", "Fee collection", true], ["outstanding", "Outstanding", true],
            ["attendance", "Attendance (30d)", true], ["average", "Average score", true], ["pass", "Pass rate", true], ["admissions", "Offered places (90d)", true]] as [SortKey, string, boolean][]).map(([k, label, right]) => (
            <th key={k} className={"p-2 " + (right ? "text-right" : "")} aria-sort={sort.key === k ? (sort.desc ? "descending" : "ascending") : undefined}>
              <button className="hover:text-slate-900" onClick={() => setSort({ key: k, desc: sort.key === k ? !sort.desc : k !== "name" && k !== "outstanding" })}>{label}{sort.key === k ? (sort.desc ? " ↓" : " ↑") : ""}</button></th>))}</tr></thead>
          <tbody>{[...data.schools].sort((a, b) => { const x = KEY[sort.key](a), y = KEY[sort.key](b); const c = typeof x === "string" ? x.localeCompare(String(y)) : (x as number) - (y as number); return sort.desc ? -c : c; }).map(s => (
            <tr key={s.id} className="border-t border-slate-100"><td className="p-2 font-medium">{s.name}<div className="text-xs text-slate-400">{s.term ?? "no current term"}{s.status !== "active" ? " · suspended" : ""}</div></td>
              <td className="p-2 text-right tabular-nums">{s.students}</td><td className="p-2 text-right tabular-nums">{s.staff_on_time == null ? "—" : `${s.staff_on_time}%`}<span className="block text-xs text-slate-400">{s.staff} staff</span></td>
              <td className={"p-2 text-right tabular-nums " + (s.fees.collection_rate !== null && s.fees.collection_rate < 60 ? "text-rose-600" : "")}>{s.fees.collection_rate === null ? "—" : `${s.fees.collection_rate}%`}</td>
              <td className="p-2 text-right tabular-nums">{money(s.fees.outstanding, s.currency)}</td>
              <td className={"p-2 text-right tabular-nums " + (s.attendance_30d !== null && s.attendance_30d < 90 ? "text-amber-600" : "")}>{s.attendance_30d === null ? "—" : `${s.attendance_30d}%`}</td>
              <td className="p-2 text-right tabular-nums">{s.average_score ?? "—"}</td>
              <td className={"p-2 text-right tabular-nums " + (s.pass_rate != null && s.pass_rate < 70 ? "text-amber-600" : "")}>{s.pass_rate == null ? "—" : `${s.pass_rate}%`}</td>
              <td className="p-2 text-right tabular-nums">{s.admitted_90d ?? 0}<span className="block text-xs text-slate-400">of {s.applications_90d ?? 0} applications</span></td></tr>))}</tbody></table></div>
        <p className="mt-2 text-xs text-slate-500">Click a heading to rank the branches. Pass rate: students whose term average is 50 or more. Staff on time: sign-ins before their start time.</p>
      </>)}
    </Page>
  );
}
