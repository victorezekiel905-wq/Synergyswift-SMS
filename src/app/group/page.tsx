"use client";
import { useApi, Page, PageHeader, Alert, Empty, Stat, money } from "@/components/ui";

type School = { id: string; name: string; status: string; term: string | null; students: number; staff: number;
  fees: { billed: number; paid: number; outstanding: number; collection_rate: number | null }; collected_30d: number; attendance_30d: number | null; average_score: number | null };

/** Proprietor console: every branch side by side. */
export default function GroupPage() {
  const { data, error } = useApi<{ groups: { id: string; name: string }[]; schools: School[] }>("/api/group");
  if (error) return <Page><Alert>{error === "not found" ? "You do not have access to a school group." : error}</Alert></Page>;
  if (!data) return <Page><p className="text-sm text-slate-500">Loading…</p></Page>;
  const t = data.schools.reduce((a, s) => ({ students: a.students + s.students, staff: a.staff + s.staff, billed: a.billed + s.fees.billed, paid: a.paid + s.fees.paid, c30: a.c30 + s.collected_30d }),
    { students: 0, staff: 0, billed: 0, paid: 0, c30: 0 });
  return (
    <Page wide>
      <PageHeader eyebrow={data.groups.map(g => g.name).join(", ")} title="All branches" subtitle="Live numbers across your schools: enrolment, fees, attendance and results." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Schools" value={data.schools.length} /><Stat label="Students" value={t.students} /><Stat label="Staff" value={t.staff} />
        <Stat label="Fees collected this term" value={money(t.paid)} hint={`of ${money(t.billed)}`} /><Stat label="Collected (30 days)" value={money(t.c30)} tone="good" />
      </div>
      {!data.schools.length ? <Empty>No schools in this group yet.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">School</th><th className="p-2 text-right">Students</th><th className="p-2 text-right">Staff</th><th className="p-2 text-right">Fee collection</th><th className="p-2 text-right">Outstanding</th><th className="p-2 text-right">Attendance (30d)</th><th className="p-2 text-right">Average score</th></tr></thead>
          <tbody>{data.schools.map(s => (
            <tr key={s.id} className="border-t border-slate-100"><td className="p-2 font-medium">{s.name}<div className="text-xs text-slate-400">{s.term ?? "no current term"}{s.status !== "active" ? " · suspended" : ""}</div></td>
              <td className="p-2 text-right tabular-nums">{s.students}</td><td className="p-2 text-right tabular-nums">{s.staff}</td>
              <td className={"p-2 text-right tabular-nums " + (s.fees.collection_rate !== null && s.fees.collection_rate < 60 ? "text-rose-600" : "")}>{s.fees.collection_rate === null ? "—" : `${s.fees.collection_rate}%`}</td>
              <td className="p-2 text-right tabular-nums">{money(s.fees.outstanding)}</td>
              <td className={"p-2 text-right tabular-nums " + (s.attendance_30d !== null && s.attendance_30d < 90 ? "text-amber-600" : "")}>{s.attendance_30d === null ? "—" : `${s.attendance_30d}%`}</td>
              <td className="p-2 text-right tabular-nums">{s.average_score ?? "—"}</td></tr>))}</tbody></table></div>
      )}
    </Page>
  );
}
