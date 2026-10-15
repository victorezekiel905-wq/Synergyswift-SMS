"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Badge, Loading, localDate } from "@/components/ui";

type Status = "present" | "absent" | "late" | "excused";
type Lesson = { id: string; class_group_id: string; period_id: string; room: string | null; cover: boolean; taken: boolean; subjects: { name: string } | null; class_groups: { name: string } | null;
  timetable_periods: { name: string; starts_at: string; ends_at: string } | null };
type Reg = { lesson: Lesson; date: string; can_mark: boolean; taken: boolean; students: { id: string; admission_no: string; first_name: string; last_name: string;
  mark: { status: Status; note: string | null } | null; morning: Status | null; leave: string | null }[] };
const NEXT: Record<Status, Status> = { present: "absent", absent: "late", late: "excused", excused: "present" };
const TONE: Record<Status, string> = { present: "bg-emerald-600", absent: "bg-rose-600", late: "bg-amber-500", excused: "bg-slate-500" };

/** A teacher's lessons for a day, each with its own register. */
export default function LessonRegisters() {
  const [date, setDate] = useState(localDate());
  const { data, reload } = useApi<{ lessons: Lesson[] }>(`/api/attendance/lessons?date=${date}`, [date]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-auto" type="date" value={date} max={localDate()} onChange={e => { setDate(e.target.value); setOpen(null); }} aria-label="Date" />
        <p className="text-slate-600">Your lessons that day, including any you are covering. Children marked absent who were in school that morning are flagged to their parents.</p>
      </div>
      {!data ? <Loading /> : !data.lessons.length ? <Empty>No lessons on your timetable that day.</Empty> : (
        <ul className="space-y-2">{data.lessons.map(l => (
          <li key={l.id + (l.cover ? "c" : "")} className="card p-3">
            <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(open === l.id ? null : l.id)}>
              <span className="w-24 text-xs text-slate-500">{l.timetable_periods?.name}<br />{l.timetable_periods?.starts_at.slice(0, 5)}–{l.timetable_periods?.ends_at.slice(0, 5)}</span>
              <span className="mr-auto"><b>{l.class_groups?.name}</b> {l.subjects?.name}{l.room ? <span className="text-xs text-slate-500"> · {l.room}</span> : null}</span>
              {l.cover && <Badge tone="violet">cover</Badge>}<Badge tone={l.taken ? "green" : "amber"}>{l.taken ? "taken" : "to take"}</Badge>
            </button>
            {open === l.id && <Register entryId={l.id} date={date} onSaved={reload} />}
          </li>))}</ul>
      )}
    </div>
  );
}

function Register({ entryId, date, onSaved }: { entryId: string; date: string; onSaved: () => void }) {
  const { data } = useApi<Reg>(`/api/attendance/lessons?entry_id=${entryId}&date=${date}`, [entryId, date]);
  const [marks, setMarks] = useState<Record<string, Status> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading />;
  // Start from saved marks, else from the morning register (absent in the morning stays absent; agreed absences are excused).
  const m = marks ?? Object.fromEntries(data.students.map(s => [s.id, s.mark?.status ?? (s.leave ? "excused" : s.morning === "absent" || s.morning === "excused" ? s.morning : "present")])) as Record<string, Status>;
  const counts = Object.values(m).reduce((a, s) => ({ ...a, [s]: (a[s] ?? 0) + 1 }), {} as Record<string, number>);
  return (
    <div className="mt-3 space-y-2">
      {!data.can_mark && <Alert tone="amber">You can see this register but only the lesson&apos;s teacher, its cover teacher, the form teacher or an admin can mark it.</Alert>}
      <p className="text-xs text-slate-500">Tap a name to change: present → absent → late → excused. {counts.absent ?? 0} absent, {counts.late ?? 0} late.</p>
      <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">{data.students.map(s => (
        <li key={s.id}><button disabled={!data.can_mark} onClick={() => setMarks({ ...m, [s.id]: NEXT[m[s.id]] })} className="flex w-full items-center gap-2 rounded border border-slate-200 p-2 text-left disabled:opacity-70">
          <span className={`h-3 w-3 shrink-0 rounded-full ${TONE[m[s.id]]}`} aria-hidden /><span className="flex-1">{s.last_name}, {s.first_name}</span>
          <span className="text-xs text-slate-500">{m[s.id]}{s.morning === "absent" ? " · away this morning" : ""}{s.leave ? " · agreed absence" : ""}</span>
        </button></li>))}</ul>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {data.can_mark && <button className="btn btn-primary" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await send<{ saved: number; parents_told: number }>("/api/attendance/lessons", { entry_id: entryId, date, entries: data.students.map(s => ({ student_id: s.id, status: m[s.id] })) });
        setBusy(false);
        setMsg({ ok: r.ok, text: r.ok ? `Saved.${r.data.parents_told ? ` ${r.data.parents_told} parent${r.data.parents_told === 1 ? " was" : "s were"} told their child missed the lesson.` : ""}` : r.error ?? "failed" });
        if (r.ok) onSaved();
      }}>{busy ? "Saving…" : data.taken ? "Update register" : "Save register"}</button>}
    </div>
  );
}
