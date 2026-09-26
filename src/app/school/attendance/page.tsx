"use client";
import { useEffect, useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Field, Badge } from "@/components/ui";

type Status = "present" | "absent" | "late" | "excused";
type Register = { date: string; taken: boolean; students: { id: string; admission_no: string; first_name: string; last_name: string; photo_url: string | null;
  mark: { status: Status; reason: string | null } | null; signed_in_at_gate: boolean }[] };
type Report = { from: string; to: string; students: { id: string; admission_no: string; first_name: string; last_name: string; present: number; absent: number; late: number; excused: number; days: number; rate: number | null }[] };

const COLORS: Record<Status, string> = { present: "bg-emerald-600", absent: "bg-rose-600", late: "bg-amber-500", excused: "bg-slate-500" };

export default function AttendancePage() {
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[] }>("/api/school/structure");
  const [cg, setCg] = useState("");
  const [tab, setTab] = useState<"register" | "report">("register");
  useEffect(() => { if (!cg && structure?.class_groups[0]) setCg(structure.class_groups[0].id); }, [structure, cg]);
  return (
    <Page wide>
      <PageHeader eyebrow="Attendance" title="Class register"
        subtitle="Take the morning register in seconds. Everyone starts as present (or from the gate sign-in); tap the exceptions. Parents of absent and late students are told immediately."
        actions={<select className="input w-auto" value={cg} onChange={e => setCg(e.target.value)} aria-label="Class">{(structure?.class_groups ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "register", label: "Register" }, { id: "report", label: "Attendance report" }]} />
      {cg && tab === "register" && <RegisterView cg={cg} />}
      {cg && tab === "report" && <ReportView cg={cg} />}
    </Page>
  );
}

function RegisterView({ cg }: { cg: string }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const { data, error, reload } = useApi<Register>(`/api/attendance?class_group_id=${cg}&date=${date}`, [cg, date]);
  const [marks, setMarks] = useState<Record<string, { status: Status; reason: string }>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    // Default: the saved mark, else present if they signed in at the gate (or if the gate is not used), else absent.
    const anyGate = data.students.some(s => s.signed_in_at_gate);
    setMarks(Object.fromEntries(data.students.map(s => [s.id, { status: s.mark?.status ?? (anyGate && !s.signed_in_at_gate ? "absent" : "present"), reason: s.mark?.reason ?? "" }])));
    setMsg(null);
  }, [data]);
  const counts = Object.values(marks).reduce((a, m) => ({ ...a, [m.status]: (a[m.status] ?? 0) + 1 }), {} as Record<string, number>);
  async function save() {
    setBusy(true);
    const r = await send("/api/attendance", { class_group_id: cg, date, entries: Object.entries(marks).map(([student_id, m]) => ({ student_id, status: m.status, reason: m.reason || null })) });
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? `Register saved.${r.data.messages_queued ? ` ${r.data.messages_queued} parent messages sent.` : ""}` : r.error ?? "failed" });
    if (r.ok) reload();
  }
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Date"><input className="input" type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={e => setDate(e.target.value)} /></Field>
        <div className="flex gap-2 pb-2 text-sm">{(["present", "late", "absent", "excused"] as Status[]).map(s => <Badge key={s} tone={s === "present" ? "green" : s === "absent" ? "red" : s === "late" ? "amber" : "slate"}>{counts[s] ?? 0} {s}</Badge>)}</div>
        <button className="btn btn-primary ml-auto" disabled={busy || !data?.students.length} onClick={save}>{busy ? "Saving…" : data?.taken ? "Update register" : "Save register"}</button>
      </div>
      {error && <Alert>{error}</Alert>}
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {!data?.students.length ? <Empty>No students in this class.</Empty> : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {data.students.map(s => {
            const m = marks[s.id] ?? { status: "present", reason: "" };
            return (
              <div key={s.id} className="card flex flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {s.photo_url ? <img src={s.photo_url} alt="" className="h-9 w-9 rounded-full object-cover" /> : <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-500">{s.first_name[0]}</div>}
                  <div className="flex-1"><p className="text-sm font-medium">{s.last_name}, {s.first_name}</p><p className="text-xs text-slate-400">{s.admission_no}{s.signed_in_at_gate ? " · signed in at gate" : ""}</p></div>
                </div>
                <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label={`${s.first_name} attendance`}>
                  {(["present", "late", "absent", "excused"] as Status[]).map(st => (
                    <button key={st} role="radio" aria-checked={m.status === st} onClick={() => setMarks({ ...marks, [s.id]: { ...m, status: st } })}
                      className={"rounded px-1 py-1.5 text-xs font-semibold capitalize " + (m.status === st ? `${COLORS[st]} text-white` : "bg-slate-100 text-slate-600")}>{st}</button>
                  ))}
                </div>
                {m.status !== "present" && <input className="input py-1 text-xs" placeholder="Reason (optional, shared with parents)" value={m.reason} onChange={e => setMarks({ ...marks, [s.id]: { ...m, reason: e.target.value } })} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReportView({ cg }: { cg: string }) {
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });
  const { data } = useApi<Report>(`/api/attendance?class_group_id=${cg}&from=${range.from}&to=${range.to}`, [cg, range.from, range.to]);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="From"><input className="input" type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="To"><input className="input" type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></Field>
        <a className="btn btn-ghost border border-slate-200" href={`/api/attendance?class_group_id=${cg}&from=${range.from}&to=${range.to}&format=csv`}>CSV</a>
      </div>
      {!data?.students.length ? <Empty>No data.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Student</th><th className="p-2 text-right">Present</th><th className="p-2 text-right">Late</th><th className="p-2 text-right">Absent</th><th className="p-2 text-right">Excused</th><th className="p-2 text-right">Attendance</th></tr></thead>
          <tbody>{[...data.students].sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101)).map(s => (
            <tr key={s.id} className="border-t border-slate-100"><td className="p-2">{s.last_name}, {s.first_name}</td><td className="p-2 text-right">{s.present}</td><td className="p-2 text-right">{s.late}</td><td className="p-2 text-right">{s.absent}</td><td className="p-2 text-right">{s.excused}</td>
              <td className={"p-2 text-right font-semibold " + (s.rate !== null && s.rate < 90 ? "text-rose-600" : "")}>{s.rate === null ? "—" : `${s.rate}%`}</td></tr>))}</tbody></table></div>
      )}
    </div>
  );
}
