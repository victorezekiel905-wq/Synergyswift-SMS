"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Empty, Field, fmtDate } from "@/components/ui";

type Period = { id: string; name: string; starts_at: string; ends_at: string; position: number };
type Suggestion = { id: string; name: string; coversThisWeek: number; teacher: boolean };
type Lesson = { entry_id: string; period: Period | null; class_name: string; subject: string | null; room: string | null; teacher: string; teacher_id: string;
  cover: { id: string; user_id: string; name: string; note: string | null } | null; suggestions: Suggestion[] };
type Absence = { id: string; user_id: string; name: string; reason: string | null; from: string; to: string; source: "absence" | "leave" };
type AdminView = { date: string; day: number; is_admin: true; absences: Absence[]; staff: { id: string; name: string }[]; lessons: Lesson[] };
type MyCover = { id: string; date: string; note: string | null; timetable_entries: { room: string | null; class_groups: { name: string } | null; subjects: { name: string } | null } | null;
  timetable_periods: { name: string; starts_at: string; ends_at: string } | null; absent: { full_name: string } | null };
type TeacherView = { date: string; is_admin: false; my_cover: MyCover[] };

const t5 = (t?: string | null) => (t ?? "").slice(0, 5);

export default function CoverPage() {
  const [date, setDate] = useState("");
  const { data, error, reload } = useApi<AdminView | TeacherView>(`/api/cover${date ? `?date=${date}` : ""}`, [date]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await send("/api/cover", body);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) reload();
  };

  return (
    <Page wide>
      <PageHeader eyebrow="Staffing" title="Cover"
        subtitle="When a teacher is away, see every lesson that needs cover and who is free to take it. Nobody is suggested if they are teaching, away, or already covering that period."
        actions={<input className="input w-auto" type="date" value={date || data?.date || ""} onChange={e => setDate(e.target.value)} aria-label="Date" />} />
      {error && <Alert>{error}</Alert>}
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {data && !data.is_admin && <MyCoverList items={data.my_cover} />}
      {data && data.is_admin && (
        <div className="grid gap-4 xl:grid-cols-[20rem,1fr]">
          <Absences view={data} act={act} />
          <section className="card p-4">
            <h2 className="mb-2 font-semibold">Lessons needing cover on {fmtDate(data.date)}</h2>
            {data.day > 5 ? <Empty>No lessons at the weekend.</Empty> : !data.lessons.length ? <Empty>No lessons need cover. Add an absence to see what is affected.</Empty> : (
              <ul className="divide-y divide-slate-100">{data.lessons.map(l => (
                <li key={l.entry_id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <div className="w-40">
                    <b>{l.period?.name ?? "Period"}</b> <span className="text-xs text-slate-500">{t5(l.period?.starts_at)}–{t5(l.period?.ends_at)}</span>
                    <p className="text-xs text-slate-500">{l.class_name} · {l.subject ?? "Lesson"}{l.room ? ` · ${l.room}` : ""}</p>
                  </div>
                  <span className="text-xs text-slate-500">for {l.teacher}</span>
                  <div className="ml-auto flex items-center gap-2">
                    {l.cover ? (<>
                      <Badge tone="green">{l.cover.name}</Badge>
                      <button className="text-xs text-rose-600" onClick={() => act({ action: "unassign", id: l.cover!.id }, "Cover removed.")}>Remove</button>
                    </>) : (
                      <select className="input w-60" defaultValue="" aria-label="Choose cover"
                        onChange={e => e.target.value && act({ action: "assign", date: data.date, timetable_entry_id: l.entry_id, cover_user_id: e.target.value }, "Cover set. The teacher has been told.")}>
                        <option value="">Choose who covers…</option>
                        {l.suggestions.map(s => <option key={s.id} value={s.id}>{s.name}{s.teacher ? "" : " (non-teaching)"} · {s.coversThisWeek} this week</option>)}
                      </select>
                    )}
                  </div>
                </li>))}</ul>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}

function Absences({ view, act }: { view: AdminView; act: (b: Record<string, unknown>, ok: string) => Promise<void> }) {
  const [f, setF] = useState({ user_id: "", starts_on: view.date, ends_on: view.date, reason: "" });
  return (
    <section className="card h-fit space-y-3 p-4">
      <h2 className="font-semibold">Away on {fmtDate(view.date)}</h2>
      {!view.absences.length ? <p className="text-sm text-slate-500">Nobody is recorded as away.</p> : (
        <ul className="space-y-1 text-sm">{view.absences.map(a => (
          <li key={`${a.source}-${a.id}`} className="flex items-center justify-between gap-2">
            <span>{a.name}<span className="block text-xs text-slate-500">{a.reason ?? "Absent"}{a.from !== a.to ? ` · ${fmtDate(a.from)}–${fmtDate(a.to)}` : ""}</span></span>
            {a.source === "absence" ? <button className="text-xs text-rose-600" onClick={() => act({ action: "delete_absence", id: a.id }, "Absence removed.")}>Remove</button> : <Badge>approved leave</Badge>}
          </li>))}</ul>
      )}
      <form className="space-y-2 border-t border-slate-100 pt-3" onSubmit={e => { e.preventDefault(); act({ action: "add_absence", ...f, reason: f.reason || null }, "Absence recorded."); }}>
        <Field label="Record an absence"><select className="input" required value={f.user_id} onChange={e => setF({ ...f, user_id: e.target.value })}>
          <option value="">Choose staff…</option>{view.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="From"><input className="input" type="date" required value={f.starts_on} onChange={e => setF({ ...f, starts_on: e.target.value })} /></Field>
          <Field label="To"><input className="input" type="date" required value={f.ends_on} onChange={e => setF({ ...f, ends_on: e.target.value })} /></Field>
        </div>
        <Field label="Reason"><input className="input" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} placeholder="Sick, training, family…" /></Field>
        <button className="btn btn-primary w-full">Add</button>
      </form>
      <p className="text-xs text-slate-500">Approved leave from HR appears here automatically.</p>
    </section>
  );
}

function MyCoverList({ items }: { items: MyCover[] }) {
  return (
    <section className="card p-4">
      <h2 className="mb-2 font-semibold">My cover this week</h2>
      {!items.length ? <Empty>You have no cover lessons.</Empty> : (
        <ul className="divide-y divide-slate-100 text-sm">{items.map(c => (
          <li key={c.id} className="py-2"><b>{fmtDate(c.date)}, {c.timetable_periods?.name}</b> <span className="text-xs text-slate-500">{t5(c.timetable_periods?.starts_at)}–{t5(c.timetable_periods?.ends_at)}</span>
            <p>{c.timetable_entries?.subjects?.name ?? "Lesson"} with {c.timetable_entries?.class_groups?.name}{c.timetable_entries?.room ? ` in ${c.timetable_entries.room}` : ""}, for {c.absent?.full_name ?? "an absent colleague"}</p>
            {c.note && <p className="text-xs text-slate-500">{c.note}</p>}</li>))}</ul>
      )}
    </section>
  );
}
