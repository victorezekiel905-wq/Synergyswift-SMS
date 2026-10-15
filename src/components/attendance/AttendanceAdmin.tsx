"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Badge, Field, Loading, Stat, fmtDate, localDate } from "@/components/ui";

const KIND: Record<string, string> = { sick: "Illness", medical: "Medical appointment", family: "Family matter", religious: "Religious observance", bereavement: "Bereavement", travel: "Travel", other: "Other" };

// ---------------- parents' absence requests ----------------

type Req = { id: string; student_id: string; kind: string; starts_on: string; ends_on: string; reason: string; status: string; decision_note: string | null; created_at: string; can_decide: boolean;
  students: { first_name: string; last_name: string; class_groups: { name: string } | null } | null; guardians: { full_name: string; phone: string | null } | null; decider: { full_name: string } | null };

export function AbsenceRequests() {
  const [all, setAll] = useState(false);
  const { data, reload } = useApi<{ items: Req[] }>(`/api/attendance/requests${all ? "?all=1" : ""}`, [all]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const decide = async (r: Req, approve: boolean) => {
    const res = await send<{ marked: number }>("/api/attendance/requests", { id: r.id, approve, note: notes[r.id] || null });
    setMsg({ ok: res.ok, text: res.ok ? (approve ? `Agreed. ${res.data.marked} school day${res.data.marked === 1 ? "" : "s"} marked as excused, and the parent was told.` : "Not agreed. The parent was told.") : res.error ?? "failed" });
    if (res.ok) reload();
  };
  return (
    <div className="space-y-3 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Show decided requests (60 days)</label>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!data ? <Loading /> : !data.items.length ? <Empty>No requests {all ? "" : "waiting"}.</Empty> : (
        <ul className="space-y-2">{data.items.map(r => (
          <li key={r.id} className="card space-y-1 p-3">
            <div className="flex flex-wrap items-center gap-2"><b className="mr-auto">{r.students?.first_name} {r.students?.last_name} <span className="font-normal text-slate-500">{r.students?.class_groups?.name}</span></b>
              <Badge tone={r.status === "approved" ? "green" : r.status === "declined" ? "red" : r.status === "pending" ? "amber" : "slate"}>{r.status}</Badge></div>
            <p>{KIND[r.kind]}: {fmtDate(r.starts_on)}{r.ends_on !== r.starts_on ? ` to ${fmtDate(r.ends_on)}` : ""}</p>
            <p className="text-slate-600">{r.reason}</p>
            <p className="text-xs text-slate-500">From {r.guardians?.full_name}{r.guardians?.phone ? ` (${r.guardians.phone})` : ""} · {fmtDate(r.created_at, true)}{r.decider ? ` · decided by ${r.decider.full_name}` : ""}{r.decision_note ? ` · “${r.decision_note}”` : ""}</p>
            {r.status === "pending" && (r.can_decide ? (
              <div className="flex flex-wrap gap-2">
                <input className="input flex-1" value={notes[r.id] ?? ""} onChange={e => setNotes({ ...notes, [r.id]: e.target.value })} placeholder="Note for the parent (optional)" maxLength={500} aria-label="Note for the parent" />
                <button className="btn btn-primary" onClick={() => decide(r, true)}>Agree</button><button className="btn btn-outline" onClick={() => decide(r, false)}>Do not agree</button>
              </div>) : <p className="text-xs text-slate-500">The form teacher or an admin decides this one.</p>)}
          </li>))}</ul>
      )}
    </div>
  );
}

// ---------------- staff ----------------

type StaffRow = { id: string; name: string; staff_no: string; department: string | null; status: string; first_in: string | null; last_out: string | null; minutes: number; open: boolean; note: string | null; methods: string[] };
const tm = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

export function StaffAttendance() {
  const [date, setDate] = useState(localDate());
  const { data, error } = useApi<{ start: string; rows: StaffRow[]; summary: Record<string, number> }>(`/api/attendance/staff?date=${date}`, [date]);
  const [filter, setFilter] = useState("");
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-auto" type="date" value={date} max={localDate()} onChange={e => setDate(e.target.value)} aria-label="Date" />
        <select className="input w-auto" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Show"><option value="">Everyone</option><option value="late">Late</option><option value="absent">Absent</option><option value="on_leave">On leave or away</option></select>
        <a className="btn btn-outline" href={`/api/attendance/staff?date=${date}&format=csv`}>Download CSV</a>
      </div>
      {error && <Alert>{error}</Alert>}
      {data && <>
        <div className="grid gap-2 sm:grid-cols-4"><Stat label="Present" value={data.summary.present} /><Stat label={`Late (after ${data.start})`} value={data.summary.late} tone={data.summary.late ? "warn" : undefined} />
          <Stat label="Absent" value={data.summary.absent} tone={data.summary.absent ? "bad" : undefined} /><Stat label="On leave or away" value={data.summary.on_leave} /></div>
        <div className="card overflow-x-auto"><table className="w-full">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Staff</th><th className="p-2">Status</th><th className="p-2">In</th><th className="p-2">Out</th><th className="p-2">Hours</th><th className="p-2">How</th></tr></thead>
          <tbody>{data.rows.filter(r => !filter || (filter === "on_leave" ? ["on_leave", "away"].includes(r.status) : r.status === filter)).map(r => (
            <tr key={r.id} className="border-t border-slate-100"><td className="p-2">{r.name} <span className="text-xs text-slate-500">{r.staff_no}{r.department ? ` · ${r.department}` : ""}</span></td>
              <td className="p-2"><Badge tone={r.status === "present" ? "green" : r.status === "late" ? "amber" : r.status === "absent" ? "red" : "slate"}>{r.status.replace("_", " ")}</Badge>{r.note && <span className="block text-xs text-slate-500">{r.note}</span>}</td>
              <td className="p-2">{tm(r.first_in)}</td><td className="p-2">{r.open ? "still in" : tm(r.last_out)}</td><td className="p-2">{r.minutes ? (r.minutes / 60).toFixed(1) : "—"}</td>
              <td className="p-2 text-xs text-slate-500">{r.methods.join(", ")}</td></tr>))}</tbody></table></div>
        <p className="text-xs text-slate-500">Staff clock in at the gate kiosk (ID card or RFID card), on a fingerprint or face-recognition machine, or with self check-in on their phone at school. Set the start times under Machines &amp; cards → Attendance settings.</p>
      </>}
    </div>
  );
}

// ---------------- analytics ----------------

type Analytics = { from: string; to: string; threshold: number; overall: { rate: number | null; days: number; absent: number; late: number }; change: number | null;
  trend: { date: string; rate: number; marked: number }[]; weekdays: { day: number; rate: number }[]; classes: { id: string; name: string; rate: number | null; days: number }[];
  chronic: { student_id: string; name: string; class_name: string | null; rate: number; absent: number; late: number; days: number; severe: boolean }[];
  lateness: { student_id: string; name: string; class_name: string | null; late: number }[]; missed_lessons: { student_id: string; name: string; class_name: string | null; lessons: number }[];
  unmarked_today: { id: string; name: string; form_teacher: string | null }[] };
const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function AttendanceAnalytics({ classes }: { classes: { id: string; name: string }[] }) {
  const [cg, setCg] = useState("");
  const [days, setDays] = useState(30);
  const from = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const { data } = useApi<Analytics>(`/api/attendance/analytics?from=${from}${cg ? `&class_group_id=${cg}` : ""}`, [cg, days]);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <select className="input w-auto" value={cg} onChange={e => setCg(e.target.value)} aria-label="Class"><option value="">Whole school</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className="input w-auto" value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Period"><option value={14}>Last 2 weeks</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={180}>Last 6 months</option></select>
      </div>
      {!data ? <Loading /> : <>
        {data.unmarked_today.length > 0 && <Alert tone="amber">Registers not yet taken today: {data.unmarked_today.map(c => `${c.name}${c.form_teacher ? ` (${c.form_teacher})` : ""}`).join(", ")}.</Alert>}
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat label="Attendance" value={data.overall.rate !== null ? `${data.overall.rate}%` : "—"} hint={data.change !== null ? `${data.change >= 0 ? "▲" : "▼"} ${Math.abs(data.change)} points over the period` : undefined}
            tone={data.overall.rate !== null && data.overall.rate < data.threshold ? "bad" : "good"} />
          <Stat label={`Below ${data.threshold}%`} value={data.chronic.length} hint={`${data.chronic.filter(c => c.severe).length} below 80%`} tone={data.chronic.length ? "warn" : undefined} />
          <Stat label="Late arrivals" value={data.overall.late} /><Stat label="Days missed" value={data.overall.absent} />
        </div>
        {data.trend.length > 1 && (
          <section className="card p-4"><h3 className="mb-2 font-semibold">Daily attendance</h3>
            <div className="flex h-28 items-end gap-px" role="img" aria-label="Daily attendance rate">{data.trend.map(t => (
              <div key={t.date} title={`${fmtDate(t.date)}: ${t.rate}% of ${t.marked}`} className={`flex-1 rounded-t ${t.rate < data.threshold ? "bg-amber-400" : "bg-emerald-500"}`} style={{ height: `${Math.max(4, t.rate - 50) * 2}%` }} />))}</div>
            <p className="mt-1 text-xs text-slate-500">{fmtDate(data.from)} to {fmtDate(data.to)}. Bars start at 50%; amber is below {data.threshold}%.</p>
          </section>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card p-4"><h3 className="mb-2 font-semibold">By day of the week</h3>
            <ul className="space-y-1">{data.weekdays.map(w => <li key={w.day} className="flex items-center gap-2"><span className="w-10">{DAY[w.day]}</span><div className="h-2 flex-1 rounded bg-slate-100"><div className="h-2 rounded bg-brand-500" style={{ width: `${w.rate}%` }} /></div><span className="w-12 text-right">{w.rate}%</span></li>)}</ul></section>
          {!cg && <section className="card p-4"><h3 className="mb-2 font-semibold">By class (lowest first)</h3>
            <ul className="space-y-1">{data.classes.slice(0, 12).map(c => <li key={c.id} className="flex justify-between"><span>{c.name}</span><span className={c.rate !== null && c.rate < data.threshold ? "text-amber-700" : ""}>{c.rate}%</span></li>)}</ul></section>}
        </div>
        <section className="card p-4"><h3 className="mb-2 font-semibold">Persistent absence (below {data.threshold}%)</h3>
          {!data.chronic.length ? <Empty>No one.</Empty> : <table className="w-full text-xs"><thead className="text-left text-slate-500"><tr><th className="p-1">Student</th><th className="p-1">Class</th><th className="p-1">Attendance</th><th className="p-1">Days missed</th><th className="p-1">Late</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{data.chronic.map(c => <tr key={c.student_id}><td className="p-1">{c.name}</td><td className="p-1">{c.class_name}</td><td className="p-1"><Badge tone={c.severe ? "red" : "amber"}>{c.rate}%</Badge></td><td className="p-1">{c.absent} of {c.days}</td><td className="p-1">{c.late}</td></tr>)}</tbody></table>}
          <p className="mt-1 text-xs text-slate-500">Change the threshold under Attendance settings. These students also appear on Early warning.</p></section>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card p-4"><h3 className="mb-2 font-semibold">Often late (5+ times)</h3>{!data.lateness.length ? <Empty>No one.</Empty> : <ul>{data.lateness.map(l => <li key={l.student_id}>{l.name} <span className="text-xs text-slate-500">{l.class_name}</span> · {l.late}</li>)}</ul>}</section>
          <section className="card p-4"><h3 className="mb-2 font-semibold">Missed lessons while in school (3+)</h3>{!data.missed_lessons.length ? <Empty>No one.</Empty> : <ul>{data.missed_lessons.map(l => <li key={l.student_id}>{l.name} <span className="text-xs text-slate-500">{l.class_name}</span> · {l.lessons}</li>)}</ul>}</section>
        </div>
      </>}
    </div>
  );
}

// ---------------- clocking machines and cards ----------------

type Device = { id: string; name: string; kind: string; serial: string | null; location: string | null; mode: string; active: boolean; last_seen_at: string | null; last_error: string | null };
type Ident = { id: string; person_type: string; kind: string; value: string; students: { first_name: string; last_name: string; admission_no: string } | null; staff: { full_name: string; staff_no: string } | null };

export function DevicesAndCards() {
  const [q, setQ] = useState("");
  const { data, reload, error } = useApi<{ devices: Device[]; identifiers: Ident[]; push_url: string; webhook_url: string }>(`/api/attendance/devices${q ? `?q=${encodeURIComponent(q)}` : ""}`, [q]);
  const [dev, setDev] = useState({ name: "", kind: "zkteco", serial: "", location: "", mode: "auto" });
  const [id, setId] = useState({ person: "", kind: "card", value: "" });
  const [csv, setCsv] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (b: Record<string, unknown>, ok: string) => { const r = await send<any>("/api/attendance/devices", b); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) reload(); return r; };
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  return (
    <div className="space-y-4 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {key && <Alert tone="amber">Device key (shown once, copy it into the device or system now): <code className="break-all">{key}</code></Alert>}
      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">Clocking machines</h2>
        <p className="text-slate-600">Fingerprint and face-recognition machines that use the ZKTeco push (ADMS / Cloud Server) setting send check-ins here directly: in the machine&apos;s <b>Comm → Cloud Server</b> settings, enter this site&apos;s address with HTTPS, then register its serial number below. Other systems can post check-ins to <code className="break-all">{data.webhook_url}</code> with their device key.</p>
        {!data.devices.length ? <Empty>No machines yet.</Empty> : <ul className="divide-y divide-slate-100">{data.devices.map(d => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="mr-auto"><b>{d.name}</b> <span className="text-xs text-slate-500">{d.kind === "zkteco" ? `ZKTeco ${d.serial}` : "Webhook"}{d.location ? ` · ${d.location}` : ""} · {d.mode === "auto" ? "in and out" : `${d.mode} only`}</span>
              <span className="block text-xs text-slate-500">{d.last_seen_at ? `Last contact ${fmtDate(d.last_seen_at, true)}` : "Not heard from yet"}{d.last_error ? ` · ${d.last_error}` : ""}</span></span>
            <Badge tone={d.active ? "green" : "slate"}>{d.active ? "on" : "off"}</Badge>
            <button className="text-xs text-brand-700" onClick={() => act({ action: "update_device", id: d.id, name: d.name, location: d.location, mode: d.mode, active: !d.active }, d.active ? "Switched off." : "Switched on.")}>{d.active ? "Switch off" : "Switch on"}</button>
            {d.kind === "webhook" && <button className="text-xs text-brand-700" onClick={async () => { const r = await act({ action: "new_key", id: d.id }, "New key made; the old one no longer works."); if (r.ok) setKey(r.data.key); }}>New key</button>}
            <button className="text-xs text-rose-600" onClick={() => confirm("Remove this machine?") && act({ action: "delete_device", id: d.id }, "Removed.")}>Remove</button>
          </li>))}</ul>}
        <form className="grid gap-2 sm:grid-cols-5" onSubmit={async e => { e.preventDefault(); const r = await act({ action: "add_device", ...dev, serial: dev.kind === "zkteco" ? dev.serial : null, location: dev.location || null }, "Machine added."); if (r.ok) { setKey(r.data.key ?? null); setDev({ ...dev, name: "", serial: "" }); } }}>
          <Field label="Name"><input className="input" value={dev.name} onChange={e => setDev({ ...dev, name: e.target.value })} required minLength={2} placeholder="Main gate" /></Field>
          <Field label="Type"><select className="input" value={dev.kind} onChange={e => setDev({ ...dev, kind: e.target.value })}><option value="zkteco">ZKTeco (push)</option><option value="webhook">Other (webhook)</option></select></Field>
          {dev.kind === "zkteco" ? <Field label="Serial number"><input className="input" value={dev.serial} onChange={e => setDev({ ...dev, serial: e.target.value })} required /></Field> : <div />}
          <Field label="Counts as"><select className="input" value={dev.mode} onChange={e => setDev({ ...dev, mode: e.target.value })}><option value="auto">In and out</option><option value="in">Arrivals only</option><option value="out">Departures only</option></select></Field>
          <div className="flex items-end"><button className="btn btn-primary w-full">Add machine</button></div>
        </form>
      </section>
      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">Cards and user numbers</h2>
        <p className="text-slate-600">Link an RFID card number (read at the gate kiosk with a card reader) or a machine user number to a student&apos;s admission number or a staff number. Enrol fingerprints and faces on the machine itself under that user number.</p>
        <form className="grid gap-2 sm:grid-cols-4" onSubmit={async e => { e.preventDefault(); if ((await act({ action: "add_identifier", ...id }, "Linked.")).ok) setId({ ...id, value: "" }); }}>
          <Field label="Admission or staff number"><input className="input" value={id.person} onChange={e => setId({ ...id, person: e.target.value })} required /></Field>
          <Field label="Type"><select className="input" value={id.kind} onChange={e => setId({ ...id, kind: e.target.value })}><option value="card">RFID card number</option><option value="device_pin">Machine user number</option></select></Field>
          <Field label="Number"><input className="input" value={id.value} onChange={e => setId({ ...id, value: e.target.value })} required maxLength={64} /></Field>
          <div className="flex items-end"><button className="btn btn-primary w-full">Link</button></div>
        </form>
        <details><summary className="cursor-pointer text-brand-700">Import many from a spreadsheet</summary>
          <p className="mt-1 text-xs text-slate-500">CSV with columns <code>number</code> (admission or staff number), <code>card</code> and/or <code>device_pin</code>.</p>
          <textarea className="input mt-1 min-h-24 font-mono text-xs" value={csv} onChange={e => setCsv(e.target.value)} placeholder={"number,card,device_pin\n2019/014,0004512345,1014"} aria-label="CSV" />
          <button className="btn btn-outline mt-1" disabled={!csv.trim()} onClick={async () => { const r = await act({ action: "import_identifiers", csv }, "Imported."); if (r.ok) { setMsg({ ok: true, text: `${r.data.added} linked.${r.data.problems.length ? ` Problems: ${r.data.problems.join("; ")}` : ""}` }); setCsv(""); } }}>Import</button>
        </details>
        <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search card or user numbers" aria-label="Search" />
        {!data.identifiers.length ? <Empty>None linked yet.</Empty> : <ul className="divide-y divide-slate-100">{data.identifiers.map(x => (
          <li key={x.id} className="flex items-center gap-2 py-1"><span className="w-40 font-mono text-xs">{x.value}</span><Badge tone="slate">{x.kind === "card" ? "card" : "machine"}</Badge>
            <span className="flex-1">{x.students ? `${x.students.first_name} ${x.students.last_name} (${x.students.admission_no})` : x.staff ? `${x.staff.full_name} (${x.staff.staff_no})` : ""}</span>
            <button className="text-xs text-rose-600" onClick={() => act({ action: "delete_identifier", id: x.id }, "Removed.")}>Remove</button></li>))}</ul>}
      </section>
    </div>
  );
}

// ---------------- settings ----------------

export function AttendanceSettings() {
  const { data, reload } = useApi<{ chronic_absence_pct: number; school_weekdays: number[]; lesson_absence_alerts: boolean; student_start_time: string; staff_start_time: string }>("/api/attendance/settings");
  const [f, setF] = useState<typeof data>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const cur = f ?? data;
  if (!cur) return null;
  return (
    <form className="card grid gap-3 p-4 text-sm sm:grid-cols-2" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/attendance/settings", { ...cur, student_start_time: cur.student_start_time.slice(0, 5), staff_start_time: cur.staff_start_time.slice(0, 5) });
      setMsg({ ok: r.ok, text: r.ok ? "Saved." : r.error ?? "failed" });
      if (r.ok) { setF(null); reload(); }
    }}>
      <h2 className="font-semibold sm:col-span-2">Attendance settings</h2>
      {msg && <div className="sm:col-span-2"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <Field label="Students are late after"><input className="input" type="time" value={cur.student_start_time.slice(0, 5)} onChange={e => setF({ ...cur, student_start_time: e.target.value })} /></Field>
      <Field label="Staff are late after"><input className="input" type="time" value={cur.staff_start_time.slice(0, 5)} onChange={e => setF({ ...cur, staff_start_time: e.target.value })} /></Field>
      <Field label="Persistent absence below (%)" hint="90% is the usual measure"><input className="input" type="number" min={50} max={100} value={cur.chronic_absence_pct} onChange={e => setF({ ...cur, chronic_absence_pct: Number(e.target.value) })} /></Field>
      <Field label="School days"><div className="flex flex-wrap gap-2 pt-1">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
        <label key={d} className="flex items-center gap-1"><input type="checkbox" checked={cur.school_weekdays.includes(i + 1)} onChange={e => setF({ ...cur, school_weekdays: e.target.checked ? [...cur.school_weekdays, i + 1] : cur.school_weekdays.filter(x => x !== i + 1) })} />{d}</label>))}</div></Field>
      <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={cur.lesson_absence_alerts} onChange={e => setF({ ...cur, lesson_absence_alerts: e.target.checked })} /> Tell parents when a child who was in school misses a lesson</label>
      <div className="sm:col-span-2"><button className="btn btn-primary">Save</button></div>
    </form>
  );
}
