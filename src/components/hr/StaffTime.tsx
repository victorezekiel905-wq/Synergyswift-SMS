"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useApi, send, Tabs, Alert, Empty, Loading, Modal, Field, Badge, Stat, fmtDate, fmtTime, money } from "@/components/ui";

type Shift = { id: string; name: string; starts_at: string; ends_at: string; days: number[]; grace_minutes: number; early_leave_minutes: number; campus: string | null; works_holidays: boolean; active: boolean };
type Day = { date: string; shift: string; campus: string | null; status: string; in: string | null; out: string | null; late_minutes: number; early_minutes: number; late_excused: boolean; early_excused: boolean };
type Summary = { scheduled: number; present: number; late: number; late_excused: number; late_minutes: number; early: number; early_excused: number; absent: number; leave: number; holiday: number };
type Req = { id: string; staff_id?: string; kind: string; on_date: string; at_time: string | null; direction: string | null; reason: string; status: string; decision_note: string | null; created_at: string; staff?: { full_name: string; department: string | null } | null };
type Rules = { late_deduction_mode: "off" | "per_late" | "per_minute"; late_deduction_amount: number; late_free_per_month: number; early_counts_as_late: boolean; absence_deduction: boolean };

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KIND = { late_arrival: "I'll be late", early_departure: "Leaving early", missed_clock: "Missed a clock-in" } as Record<string, string>;
const STATUS: Record<string, { label: string; tone: "green" | "amber" | "red" | "slate" | "blue" }> = {
  present: { label: "On time", tone: "green" }, late: { label: "Late", tone: "amber" }, absent: { label: "Absent", tone: "red" }, not_in_yet: { label: "Not in yet", tone: "red" },
  upcoming: { label: "Not started", tone: "slate" }, leave: { label: "On leave", tone: "blue" }, holiday: { label: "Holiday", tone: "slate" }
};
const hm = (t: string) => t.slice(0, 5);
const shiftLabel = (s: Shift) => `${hm(s.starts_at)}–${hm(s.ends_at)}${s.ends_at <= s.starts_at ? " (overnight)" : ""} · ${s.days.map(d => DAYS[d]).join(" ")}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);

type View = "me" | "team" | "shifts" | "month" | "rules";

/** HR → Time & shifts (phase 14i-1). */
export function StaffTime({ isHr }: { isHr: boolean }) {
  const team = useApi<{ requests: Req[]; pending: number }>("/api/hr/time?view=team");
  const decider = isHr || (team.data?.requests.length ?? 0) > 0;
  const tabs: { id: View; label: string }[] = [
    { id: "me", label: "My time" },
    ...(decider ? [{ id: "team" as View, label: `Requests${team.data?.pending ? ` (${team.data.pending})` : ""}` }] : []),
    ...(isHr ? [{ id: "shifts" as View, label: "Shifts" }, { id: "month" as View, label: "Month report" }, { id: "rules" as View, label: "Rules & clock-in" }] : [])
  ];
  const [view, setView] = useState<View>("me");
  return (
    <div className="space-y-4">
      <Tabs value={view} onChange={setView} tabs={tabs} />
      {view === "me" && <MyTime />}
      {view === "team" && <Team data={team.data} error={team.error} reload={team.reload} />}
      {view === "shifts" && <Shifts />}
      {view === "month" && <Month />}
      {view === "rules" && <RulesForm />}
    </div>
  );
}

function MyTime() {
  const [period, setPeriod] = useState(thisMonth());
  const { data, error, reload } = useApi<{ staff: { full_name: string } | null; today: string; shifts: { id: string; starts_on: string; ends_on: string | null; shift: Shift | null }[]; days: Day[]; summary: Summary; requests: Req[] }>(`/api/hr/time?view=me&period=${period}`, [period]);
  const [form, setForm] = useState<{ kind: string; on_date: string; at_time: string; direction: string; reason: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  if (!data.staff) return <Empty>Your account is not linked to a staff record. Ask HR to link it.</Empty>;
  const submit = async () => {
    if (!form) return;
    const r = await send("/api/hr/time", { action: "request", kind: form.kind, on_date: form.on_date, at_time: form.at_time || null, direction: form.kind === "missed_clock" ? form.direction : null, reason: form.reason });
    setMsg({ ok: r.ok, text: r.ok ? "Sent to your line manager." : r.error ?? "failed" });
    if (r.ok) { setForm(null); reload(); }
  };
  const s = data.summary;
  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <section className="card p-4">
        <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto font-semibold">My shifts</h3>
          <button className="btn btn-outline" onClick={() => setForm({ kind: "late_arrival", on_date: data.today, at_time: "", direction: "in", reason: "" })}>Tell my manager…</button></div>
        {!data.shifts.length ? <p className="mt-2 text-sm text-slate-600">You have no shift yet. HR sets shifts; until then the school&apos;s usual start time applies.</p> : (
          <ul className="mt-2 space-y-1 text-sm">{data.shifts.map(a => a.shift && <li key={a.id}><b>{a.shift.name}</b> {shiftLabel(a.shift)}{a.shift.campus ? ` · ${a.shift.campus}` : ""}
            <span className="text-slate-500"> (grace {a.shift.grace_minutes} min){a.ends_on ? ` until ${fmtDate(a.ends_on)}` : ""}</span></li>)}</ul>)}
      </section>
      <div className="flex items-center gap-2"><h3 className="mr-auto font-semibold">My month</h3><input className="input w-auto" type="month" value={period} max={thisMonth()} onChange={e => setPeriod(e.target.value || thisMonth())} aria-label="Month" /></div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Days on shift" value={s.scheduled} /><Stat label="Late" value={s.late} hint={s.late_excused ? `${s.late_excused} more excused` : undefined} tone={s.late ? "warn" : undefined} />
        <Stat label="Left early" value={s.early} tone={s.early ? "warn" : undefined} /><Stat label="Absent" value={s.absent} tone={s.absent ? "bad" : undefined} />
      </div>
      {data.days.length > 0 && <div className="card overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Day</th><th className="p-2">Shift</th><th className="p-2">In</th><th className="p-2">Out</th><th className="p-2">Status</th></tr></thead>
        <tbody>{data.days.map((d, i) => <DayRow key={d.date + i} d={d} />)}</tbody></table></div>}
      <section className="card p-4">
        <h3 className="font-semibold">My requests</h3>
        {!data.requests.length ? <p className="mt-1 text-sm text-slate-500">None yet.</p> : <ul className="mt-2 space-y-2 text-sm">{data.requests.map(r => (
          <li key={r.id} className="flex flex-wrap items-center gap-2"><span className="mr-auto">{KIND[r.kind]} · {fmtDate(r.on_date)}{r.at_time ? ` at ${hm(r.at_time)}` : ""} · <span className="text-slate-600">{r.reason}</span>
            {r.decision_note && <span className="block text-xs text-slate-500">Reply: {r.decision_note}</span>}</span>
            <Badge tone={r.status === "approved" ? "green" : r.status === "declined" ? "red" : r.status === "pending" ? "amber" : "slate"}>{r.status}</Badge>
            {r.status === "pending" && <button className="text-xs text-slate-600 underline" onClick={async () => { const x = await send("/api/hr/time", { action: "cancel", id: r.id }); if (x.ok) reload(); else setMsg({ ok: false, text: x.error ?? "failed" }); }}>Cancel</button>}
          </li>))}</ul>}
      </section>
      <Modal open={Boolean(form)} onClose={() => setForm(null)} title="Tell my manager">
        {form && <div className="space-y-3">
          <Field label="What"><select className="input" value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
            <option value="late_arrival">I will be late</option><option value="early_departure">I need to leave early</option><option value="missed_clock">I forgot to clock in or out</option></select></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Day"><input className="input" type="date" value={form.on_date} onChange={e => setForm({ ...form, on_date: e.target.value })} /></Field>
            <Field label={form.kind === "late_arrival" ? "Expected arrival" : form.kind === "early_departure" ? "Leaving at" : "Time"}><input className="input" type="time" value={form.at_time} onChange={e => setForm({ ...form, at_time: e.target.value })} /></Field>
          </div>
          {form.kind === "missed_clock" && <Field label="I missed"><select className="input" value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })}><option value="in">signing in</option><option value="out">signing out</option></select></Field>}
          <Field label="Reason"><textarea className="input" rows={3} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} maxLength={1000} /></Field>
          <p className="hint">Approved late arrivals and early departures do not count against you. An approved missed clock-in adds the record.</p>
          <button className="btn btn-primary" disabled={form.reason.trim().length < 3 || (form.kind === "missed_clock" && !form.at_time)} onClick={submit}>Send</button>
        </div>}
      </Modal>
    </div>
  );
}

function DayRow({ d, name }: { d: Day; name?: string }) {
  const st = STATUS[d.status] ?? { label: d.status, tone: "slate" as const };
  return (
    <tr className="border-t border-slate-100">
      <td className="p-2 whitespace-nowrap">{name ?? fmtDate(d.date)}</td><td className="p-2 text-slate-600">{d.shift}{d.campus ? ` · ${d.campus}` : ""}</td>
      <td className="p-2 tabular-nums">{d.in ? fmtTime(d.in) : "—"}</td><td className="p-2 tabular-nums">{d.out ? fmtTime(d.out) : "—"}</td>
      <td className="p-2"><Badge tone={st.tone}>{st.label}</Badge>{d.late_minutes > 0 && <span className="ml-1 text-xs text-slate-500">{d.late_minutes} min{d.late_excused ? ", excused" : ""}</span>}
        {d.early_minutes > 0 && <span className="ml-1 text-xs text-amber-800">left {d.early_minutes} min early{d.early_excused ? " (excused)" : ""}</span>}</td>
    </tr>
  );
}

function Team({ data, error, reload }: { data: { requests: Req[] } | null; error: string | null; reload: () => void }) {
  const [note, setNote] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const decide = async (id: string, approve: boolean) => {
    const r = await send("/api/hr/time", { action: "decide", id, approve, note: note[id] || null });
    setMsg(r.ok ? null : r.error ?? "failed");
    if (r.ok) reload();
  };
  const pending = data.requests.filter(r => r.status === "pending"), rest = data.requests.filter(r => r.status !== "pending").slice(0, 30);
  return (
    <div className="space-y-4">
      {msg && <Alert>{msg}</Alert>}
      {!pending.length ? <Empty>No requests waiting.</Empty> : <div className="space-y-2">{pending.map(r => (
        <div key={r.id} className="card p-4 text-sm">
          <p><b>{r.staff?.full_name}</b>{r.staff?.department ? <span className="text-slate-500"> · {r.staff.department}</span> : null}: {KIND[r.kind]} on {fmtDate(r.on_date)}{r.at_time ? ` at ${hm(r.at_time)}` : ""}{r.kind === "missed_clock" ? ` (signing ${r.direction})` : ""}</p>
          <p className="mt-1 text-slate-700">{r.reason}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className="input flex-1" placeholder="Reply (optional)" value={note[r.id] ?? ""} onChange={e => setNote({ ...note, [r.id]: e.target.value })} maxLength={500} />
            <button className="btn btn-primary" onClick={() => decide(r.id, true)}>Approve</button>
            <button className="btn btn-ghost border border-slate-300" onClick={() => decide(r.id, false)}>Decline</button>
          </div>
        </div>))}</div>}
      {rest.length > 0 && <details className="card p-4 text-sm"><summary className="cursor-pointer font-medium">Recent decisions</summary>
        <ul className="mt-2 space-y-1">{rest.map(r => <li key={r.id}>{r.staff?.full_name}: {KIND[r.kind]}, {fmtDate(r.on_date)} · <Badge tone={r.status === "approved" ? "green" : "slate"}>{r.status}</Badge></li>)}</ul></details>}
    </div>
  );
}

type ShiftData = { ready: boolean; shifts: Shift[]; campuses: string[]; staff: { id: string; full_name: string; department: string | null }[]; today: string;
  assignments: { id: string; staff_id: string; shift_id: string; starts_on: string; ends_on: string | null; name: string }[] };
const blankShift = { name: "", starts_at: "07:30", ends_at: "16:00", days: [1, 2, 3, 4, 5], grace_minutes: 10, early_leave_minutes: 15, campus: "", works_holidays: false, active: true };

function Shifts() {
  const { data, error, reload } = useApi<ShiftData>("/api/hr/time?view=shifts");
  const [edit, setEdit] = useState<(typeof blankShift & { id?: string }) | null>(null);
  const [assign, setAssign] = useState<{ shift_id: string; staff_ids: string[]; starts_on: string; ends_on: string; q: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const byShift = useMemo(() => {
    const m = new Map<string, ShiftData["assignments"]>();
    for (const a of data?.assignments ?? []) m.set(a.shift_id, [...(m.get(a.shift_id) ?? []), a]);
    return m;
  }, [data]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  if (!data.ready) return <Alert tone="amber">Shifts need this month&apos;s database update. Ask your Synergy Swift contact to run it.</Alert>;
  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await send<any>("/api/hr/time", body);
    const clashes = r.ok && r.data?.clashes?.length ? ` ${r.data.clashes.length} not given it: ${r.data.clashes.map((c: any) => `${c.name} (${c.error})`).join("; ")}` : "";
    setMsg({ ok: r.ok && !clashes, text: r.ok ? ok + (r.data?.assigned !== undefined ? ` ${r.data.assigned} assigned.` : "") + clashes : r.error ?? "failed" });
    if (r.ok) reload();
    return r.ok;
  };
  const unassigned = data.staff.filter(s => !data.assignments.some(a => a.staff_id === s.id));
  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.ok ? "green" : "amber"}>{msg.text}</Alert>}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={() => setEdit({ ...blankShift })}>New shift</button>
        {unassigned.length > 0 && <button className="btn btn-outline" onClick={() => act({ action: "standard" }, "Done.")}>Give the {unassigned.length} without a shift the standard school day</button>}
      </div>
      {!data.shifts.length ? <Empty>No shifts yet. Start with the standard school day, then add others (evening, night security, boarding).</Empty> : data.shifts.map(s => {
        const people = byShift.get(s.id) ?? [];
        return (
          <section key={s.id} className={"card p-4 " + (s.active ? "" : "opacity-60")}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{s.name}</h3><span className="text-sm text-slate-600">{shiftLabel(s)}{s.campus ? ` · ${s.campus}` : ""}</span>
              {!s.active && <Badge>off</Badge>}{s.works_holidays && <Badge tone="blue">works holidays</Badge>}
              <span className="ml-auto flex gap-2">
                <button className="btn btn-outline" onClick={() => setAssign({ shift_id: s.id, staff_ids: [], starts_on: data.today, ends_on: "", q: "" })}>Assign staff</button>
                <button className="btn btn-ghost" onClick={() => setEdit({ ...s, campus: s.campus ?? "", starts_at: hm(s.starts_at), ends_at: hm(s.ends_at) })}>Edit</button>
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">Late after {s.grace_minutes} min · early if leaving more than {s.early_leave_minutes} min before the end</p>
            {people.length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5 text-sm">{people.map(a => (
              <li key={a.id} className="rounded-full border border-slate-200 px-2.5 py-1">{a.name}{a.ends_on ? ` (to ${fmtDate(a.ends_on)})` : ""}
                <button className="ml-1 text-xs text-slate-500 hover:text-red-700" aria-label={`Take ${a.name} off this shift`} onClick={() => act({ action: "end_assignment", id: a.id, ends_on: data.today }, `${a.name} is off this shift from today.`)}>✕</button></li>))}</ul>}
          </section>
        );
      })}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit shift" : "New shift"}>
        {edit && <div className="space-y-3">
          <Field label="Name"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. School day, Night security" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts"><input className="input" type="time" value={edit.starts_at} onChange={e => setEdit({ ...edit, starts_at: e.target.value })} /></Field>
            <Field label="Ends" hint="Earlier than the start = overnight"><input className="input" type="time" value={edit.ends_at} onChange={e => setEdit({ ...edit, ends_at: e.target.value })} /></Field>
            <Field label="Late after (minutes)"><input className="input" type="number" min={0} max={120} value={edit.grace_minutes} onChange={e => setEdit({ ...edit, grace_minutes: Number(e.target.value) })} /></Field>
            <Field label="Early if leaving more than (minutes before the end)"><input className="input" type="number" min={0} max={240} value={edit.early_leave_minutes} onChange={e => setEdit({ ...edit, early_leave_minutes: Number(e.target.value) })} /></Field>
          </div>
          <fieldset><legend className="label">Days</legend><div className="flex flex-wrap gap-1.5">{[1, 2, 3, 4, 5, 6, 7].map(d => (
            <button key={d} type="button" onClick={() => setEdit({ ...edit, days: edit.days.includes(d) ? edit.days.filter(x => x !== d) : [...edit.days, d] })}
              className={"rounded-full border px-3 py-1 text-sm " + (edit.days.includes(d) ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300")}>{DAYS[d]}</button>))}</div></fieldset>
          {data.campuses.length > 0 && <Field label="Campus"><select className="input" value={edit.campus} onChange={e => setEdit({ ...edit, campus: e.target.value })}><option value="">—</option>{data.campuses.map(c => <option key={c}>{c}</option>)}</select></Field>}
          <label className="flex items-center gap-2"><input type="checkbox" checked={edit.works_holidays} onChange={e => setEdit({ ...edit, works_holidays: e.target.checked })} /> Runs on school holidays too (security, boarding)</label>
          {edit.id && <label className="flex items-center gap-2"><input type="checkbox" checked={edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })} /> In use</label>}
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={edit.name.trim().length < 2 || !edit.days.length} onClick={async () => { if (await act({ action: "save_shift", ...edit, campus: edit.campus || null }, "Shift saved.")) setEdit(null); }}>Save</button>
            {edit.id && !byShift.get(edit.id)?.length && <button className="btn btn-ghost text-red-700" onClick={async () => { if (await act({ action: "delete_shift", id: edit.id }, "Shift deleted.")) setEdit(null); }}>Delete</button>}
          </div>
        </div>}
      </Modal>
      <Modal open={Boolean(assign)} onClose={() => setAssign(null)} title="Assign staff to the shift" wide>
        {assign && <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="From"><input className="input" type="date" value={assign.starts_on} onChange={e => setAssign({ ...assign, starts_on: e.target.value })} /></Field>
            <Field label="Until (optional)"><input className="input" type="date" value={assign.ends_on} onChange={e => setAssign({ ...assign, ends_on: e.target.value })} /></Field>
            <Field label="Find"><input className="input" value={assign.q} onChange={e => setAssign({ ...assign, q: e.target.value })} placeholder="Name or department" /></Field>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">{data.staff.filter(s => !assign.q || `${s.full_name} ${s.department ?? ""}`.toLowerCase().includes(assign.q.toLowerCase())).map(s => (
            <label key={s.id} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-0"><input type="checkbox" checked={assign.staff_ids.includes(s.id)}
              onChange={e => setAssign({ ...assign, staff_ids: e.target.checked ? [...assign.staff_ids, s.id] : assign.staff_ids.filter(x => x !== s.id) })} />
              {s.full_name}<span className="text-xs text-slate-500">{s.department ?? ""}</span></label>))}</div>
          <p className="hint">Someone already on a shift whose hours overlap on the same day is not given this one; you&apos;ll see who.</p>
          <button className="btn btn-primary" disabled={!assign.staff_ids.length} onClick={async () => { if (await act({ action: "assign", shift_id: assign.shift_id, staff_ids: assign.staff_ids, starts_on: assign.starts_on, ends_on: assign.ends_on || null }, "Saved.")) setAssign(null); }}>
            Assign {assign.staff_ids.length || ""}</button>
        </div>}
      </Modal>
    </div>
  );
}

type MonthRow = Summary & { id: string; name: string; staff_no: string; department: string | null; campus: string | null; deduction: number; unpaid_days: number };

function Month() {
  const [period, setPeriod] = useState(thisMonth());
  const { data, error } = useApi<{ period: string; through: string; rules: Rules; rows: MonthRow[] }>(`/api/hr/time?view=month&period=${period}`, [period]);
  const [sort, setSort] = useState<"name" | "late" | "absent">("late");
  if (error) return <Alert>{error}</Alert>;
  const rows = [...(data?.rows ?? [])].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "late" ? (b.late + b.early) - (a.late + a.early) : b.absent - a.absent);
  const charging = data && (data.rules.late_deduction_mode !== "off" || data.rules.absence_deduction);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-auto" type="month" value={period} max={thisMonth()} onChange={e => setPeriod(e.target.value || thisMonth())} aria-label="Month" />
        <select className="input w-auto" value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Sort"><option value="late">Most late first</option><option value="absent">Most absent first</option><option value="name">By name</option></select>
        <a className="btn btn-outline ml-auto" href={`/api/hr/time?view=month&period=${period}&format=csv`}>Download CSV</a>
      </div>
      {!data ? <Loading /> : !rows.length ? <Empty>No one has a shift in this month yet. Shifts are set under Shifts.</Empty> : (<>
        <p className="text-slate-600">Up to {fmtDate(data.through)}. {charging ? "Payroll deducts as shown under Rules & clock-in." : "Payroll deductions are off; this is for information."}</p>
        <div className="card overflow-x-auto"><table className="w-full">
          <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Staff</th><th className="p-2">On shift</th><th className="p-2">Late</th><th className="p-2">Left early</th><th className="p-2">Absent</th><th className="p-2">Leave</th>{charging && <th className="p-2">Deduction</th>}</tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="p-2">{r.name} <span className="text-xs text-slate-500">{r.staff_no}{r.department ? ` · ${r.department}` : ""}{r.campus ? ` · ${r.campus}` : ""}</span></td>
              <td className="p-2">{r.scheduled}</td>
              <td className="p-2">{r.late ? <b className="text-amber-800">{r.late}</b> : 0}{r.late_minutes ? <span className="text-xs text-slate-500"> ({r.late_minutes} min)</span> : null}{r.late_excused ? <span className="text-xs text-emerald-700"> +{r.late_excused} excused</span> : null}</td>
              <td className="p-2">{r.early}</td><td className="p-2">{r.absent ? <b className="text-red-700">{r.absent}</b> : 0}</td><td className="p-2">{r.leave}</td>
              {charging && <td className="p-2">{r.deduction ? money(r.deduction) : "—"}{r.unpaid_days ? <span className="block text-xs text-slate-500">+ {r.unpaid_days} unpaid day{r.unpaid_days === 1 ? "" : "s"}</span> : null}</td>}
            </tr>))}</tbody></table></div>
      </>)}
    </div>
  );
}

function RulesForm() {
  const { data, error, reload } = useApi<{ rules: Rules; campuses: string[]; staff_self_clock: string; has_geofence: boolean; ready: boolean }>("/api/hr/time?view=rules");
  const [f, setF] = useState<(Rules & { staff_self_clock: string; campuses: string }) | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const cur = f ?? { ...data.rules, staff_self_clock: data.staff_self_clock, campuses: data.campuses.join(", ") };
  const save = async () => {
    const r = await send("/api/hr/time", { action: "save_rules", ...cur, late_deduction_amount: Number(cur.late_deduction_amount) || 0, late_free_per_month: Number(cur.late_free_per_month) || 0,
      campuses: cur.campuses.split(",").map(c => c.trim()).filter(Boolean) });
    setMsg({ ok: r.ok, text: r.ok ? "Saved." : r.error ?? "failed" });
    if (r.ok) { setF(null); reload(); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {msg && <div className="lg:col-span-2"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {!data.ready && <div className="lg:col-span-2"><Alert tone="amber">These settings need this month&apos;s database update.</Alert></div>}
      <section className="card space-y-3 p-4">
        <h3 className="font-semibold">Payroll and lateness</h3>
        <Field label="Deduct for lateness"><select className="input" value={cur.late_deduction_mode} onChange={e => setF({ ...cur, late_deduction_mode: e.target.value as Rules["late_deduction_mode"] })}>
          <option value="off">No (report only)</option><option value="per_late">A fixed amount for each late arrival</option><option value="per_minute">An amount for each minute late</option></select></Field>
        {cur.late_deduction_mode !== "off" && <div className="grid gap-3 sm:grid-cols-2">
          <Field label={cur.late_deduction_mode === "per_late" ? "₦ per late arrival" : "₦ per minute"}><input className="input" type="number" min={0} value={cur.late_deduction_amount} onChange={e => setF({ ...cur, late_deduction_amount: Number(e.target.value) })} /></Field>
          <Field label="Free lates each month"><input className="input" type="number" min={0} max={31} value={cur.late_free_per_month} onChange={e => setF({ ...cur, late_free_per_month: Number(e.target.value) })} /></Field>
        </div>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={cur.early_counts_as_late} onChange={e => setF({ ...cur, early_counts_as_late: e.target.checked })} /> Leaving early counts like a late arrival</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={cur.absence_deduction} onChange={e => setF({ ...cur, absence_deduction: e.target.checked })} /> Unexcused absent days are unpaid (a day&apos;s basic pay)</label>
        <p className="hint">Approved requests, leave and school holidays never count. Deductions show on the payslip as their own lines.</p>
      </section>
      <section className="card space-y-3 p-4">
        <h3 className="font-semibold">Clocking in from a phone</h3>
        <Field label="Staff may sign in from their phone"><select className="input" value={cur.staff_self_clock} onChange={e => setF({ ...cur, staff_self_clock: e.target.value })}>
          <option value="auto">By the entrance code, or inside the school grounds{data.has_geofence ? "" : " (anywhere: no school grounds set)"}</option>
          <option value="qr">Only by scanning the entrance code</option>
          <option value="geofence">Only inside the school grounds (location)</option>
          <option value="qr_or_geofence">By the entrance code or inside the grounds</option>
          <option value="qr_and_geofence">By the entrance code and inside the grounds (strictest)</option></select></Field>
        <p className="hint">The entrance code changes every 30 seconds, so a photo sent to someone at home stops working. Show it on a tablet or TV at the entrance.</p>
        <Link className="btn btn-outline w-fit" href="/school/gate/clock-code">Show the entrance code</Link>
        <Field label="Campuses" hint="Comma-separated, e.g. Main, Annex. Each screen at an entrance picks its campus."><input className="input" value={cur.campuses} onChange={e => setF({ ...cur, campuses: e.target.value })} /></Field>
      </section>
      <div className="lg:col-span-2"><button className="btn btn-primary" onClick={save} disabled={!f}>Save</button></div>
    </div>
  );
}
