"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Field, Badge, localDate } from "@/components/ui";

type Status = "present" | "absent" | "late" | "excused";
type Register = { date: string; taken: boolean; students: { id: string; admission_no: string; first_name: string; last_name: string; photo_url: string | null;
  mark: { status: Status; reason: string | null } | null; signed_in_at_gate: boolean }[] };
type Report = { from: string; to: string; students: { id: string; admission_no: string; first_name: string; last_name: string; present: number; absent: number; late: number; excused: number; days: number; rate: number | null }[] };

const COLORS: Record<Status, string> = { present: "bg-emerald-600", absent: "bg-rose-600", late: "bg-amber-500", excused: "bg-slate-500" };

// Offline register: the class list is kept on this device, and a register
// saved without a connection waits here until it can be sent.
type Entry = { student_id: string; status: Status; reason: string | null };
type Queued = { cg: string; date: string; entries: Entry[]; at: string };
const QUEUE = "educlass:register-queue";
const local = {
  get<T>(k: string, fallback: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } }
};
const isNetworkError = (e: string | null) => !navigator.onLine || /fetch|network|load failed|offline/i.test(e ?? "");

export default function AttendancePage() {
  const { data: live } = useApi<{ class_groups: { id: string; name: string }[] }>("/api/school/structure");
  const [cachedStructure, setCachedStructure] = useState<{ class_groups: { id: string; name: string }[] } | null>(null);
  useEffect(() => { if (live) local.set("educlass:structure", live); else setCachedStructure(local.get("educlass:structure", null)); }, [live]);
  const structure = live ?? cachedStructure;
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
  const [date, setDate] = useState(() => localDate());
  const { data: fresh, error, reload } = useApi<Register>(`/api/attendance?class_group_id=${cg}&date=${date}`, [cg, date]);
  const [offlineCopy, setOfflineCopy] = useState<Register | null>(null);
  const rosterKey = `educlass:register:${cg}`;
  useEffect(() => {
    if (fresh) { local.set(rosterKey, { ...fresh, students: fresh.students.map(s => ({ ...s, mark: null, signed_in_at_gate: false })) }); setOfflineCopy(null); }
    else if (error) setOfflineCopy(local.get<Register | null>(rosterKey, null));
  }, [fresh, error, rosterKey]);
  const data = useMemo(() => fresh ?? (offlineCopy ? { ...offlineCopy, date, taken: false } : null), [fresh, offlineCopy, date]);
  const [marks, setMarks] = useState<Record<string, { status: Status; reason: string }>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(0);

  // Send registers saved while offline, as soon as the connection is back.
  const flush = useCallback(async () => {
    const queue = local.get<Queued[]>(QUEUE, []);
    setPending(queue.length);
    if (!queue.length || !navigator.onLine) return;
    const left: Queued[] = [];
    let sent = 0, rejected = 0;
    for (const q of queue) {
      try {
        const res = await fetch("/api/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ class_group_id: q.cg, date: q.date, entries: q.entries }) });
        if (res.ok) sent++; else if (res.status >= 500 || res.status === 401) left.push(q); else rejected++;
      } catch { left.push(q); }
    }
    local.set(QUEUE, left);
    setPending(left.length);
    if (sent || rejected) setMsg({ ok: !rejected, text: `${sent} register${sent === 1 ? "" : "s"} saved offline ${sent === 1 ? "has" : "have"} now been sent.${rejected ? ` ${rejected} could not be accepted; please take ${rejected === 1 ? "it" : "them"} again.` : ""}` });
  }, []);
  useEffect(() => {
    flush();
    window.addEventListener("online", flush);
    const t = setInterval(flush, 60_000);
    return () => { window.removeEventListener("online", flush); clearInterval(t); };
  }, [flush]);
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
    const entries: Entry[] = Object.entries(marks).map(([student_id, m]) => ({ student_id, status: m.status, reason: m.reason || null }));
    const r = navigator.onLine ? await send("/api/attendance", { class_group_id: cg, date, entries }) : { ok: false, data: {} as any, error: "offline" };
    setBusy(false);
    if (!r.ok && isNetworkError(r.error)) {
      const queue = local.get<Queued[]>(QUEUE, []).filter(q => !(q.cg === cg && q.date === date));
      local.set(QUEUE, [...queue, { cg, date, entries, at: new Date().toISOString() }]);
      setPending(queue.length + 1);
      setMsg({ ok: true, text: "No connection. The register is saved on this device and will be sent automatically when you are back online." });
      return;
    }
    setMsg({ ok: r.ok, text: r.ok ? `Register saved.${r.data.messages_queued ? ` ${r.data.messages_queued} parent messages sent.` : ""}` : r.error ?? "failed" });
    if (r.ok) reload();
  }
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Date"><input className="input" type="date" value={date} max={localDate()} onChange={e => setDate(e.target.value)} /></Field>
        <div className="flex gap-2 pb-2 text-sm">{(["present", "late", "absent", "excused"] as Status[]).map(s => <Badge key={s} tone={s === "present" ? "green" : s === "absent" ? "red" : s === "late" ? "amber" : "slate"}>{counts[s] ?? 0} {s}</Badge>)}</div>
        <button className="btn btn-primary ml-auto" disabled={busy || !data?.students.length} onClick={save}>{busy ? "Saving…" : data?.taken ? "Update register" : "Save register"}</button>
      </div>
      {error && !offlineCopy && <Alert>{error}</Alert>}
      {offlineCopy && !fresh && <div className="mb-3"><Alert tone="amber">You are offline. This is the class list saved on this device; the register will be sent when you reconnect.</Alert></div>}
      {pending > 0 && <div className="mb-3"><Alert tone="blue">{pending} register{pending === 1 ? "" : "s"} waiting to be sent from this device.</Alert></div>}
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
  const [range, setRange] = useState(() => ({ from: localDate(30), to: localDate() }));
  const { data } = useApi<Report>(`/api/attendance?class_group_id=${cg}&from=${range.from}&to=${range.to}`, [cg, range.from, range.to]);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field label="From"><input className="input" type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="To"><input className="input" type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></Field>
        <a className="btn btn-outline" href={`/api/attendance?class_group_id=${cg}&from=${range.from}&to=${range.to}&format=csv`}>CSV</a>
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
