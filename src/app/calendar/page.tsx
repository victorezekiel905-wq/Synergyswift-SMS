"use client";
import { useMemo, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Loading, fmtDate, localDate } from "@/components/ui";
import { KIND_LABEL, onDay, type CalItem, type CalKind } from "@/lib/calendar";

const TONE: Partial<Record<CalKind, string>> = { holiday: "bg-emerald-100 text-emerald-800", term: "bg-brand-100 text-brand-800", exam: "bg-rose-100 text-rose-800", lesson: "bg-slate-100 text-slate-700",
  homework: "bg-amber-100 text-amber-800", meeting: "bg-violet-100 text-violet-800", pta: "bg-violet-100 text-violet-800", cover: "bg-orange-100 text-orange-800", online: "bg-sky-100 text-sky-800" };
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Terms, holidays, events, exams, meetings, lessons and deadlines in one calendar, which can be added to Google or Outlook. */
export default function CalendarPage() {
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const first = `${month}-01`;
  // The grid starts on the Monday on or before the 1st and shows six weeks.
  const start = addDays(first, -((new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7));
  const end = addDays(start, 41);
  const { data } = useApi<{ items: CalItem[]; timezone: string }>(`/api/calendar?from=${start}&to=${end}`, [start]);
  const [day, setDay] = useState(localDate());
  const [hide, setHide] = useState<Set<CalKind>>(new Set());
  const items = useMemo(() => (data?.items ?? []).filter(i => !hide.has(i.kind)), [data, hide]);
  const kinds = [...new Set((data?.items ?? []).map(i => i.kind))];
  const shift = (n: number) => { const d = new Date(`${first}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  const tz = data?.timezone ?? "UTC";
  const todays = onDay(items, day, tz);
  return (
    <Page wide>
      <PageHeader eyebrow="School" title="Calendar" subtitle="Terms, holidays, events, exams, meetings, your lessons and deadlines. Add it to Google Calendar or Outlook to keep it on your phone."
        actions={<div className="flex items-center gap-1"><button className="btn btn-ghost" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <b className="w-36 text-center">{new Date(`${first}T12:00:00Z`).toLocaleDateString([], { month: "long", year: "numeric" })}</b>
          <button className="btn btn-ghost" onClick={() => shift(1)} aria-label="Next month">›</button><button className="btn btn-outline" onClick={() => { setMonth(localDate().slice(0, 7)); setDay(localDate()); }}>Today</button></div>} />
      {kinds.length > 1 && <div className="mb-3 flex flex-wrap gap-2 text-xs">{kinds.map(k => (
        <label key={k} className={`flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 ${TONE[k] ?? "bg-slate-100"}`}><input type="checkbox" checked={!hide.has(k)} onChange={e => { const n = new Set(hide); if (e.target.checked) n.delete(k); else n.add(k); setHide(n); }} />{KIND_LABEL[k]}</label>))}</div>}
      {!data ? <Loading /> : (
        <div className="grid gap-4 lg:grid-cols-[1fr,20rem]">
          <div className="card overflow-hidden">
            <div className="grid grid-cols-7 bg-slate-50 text-center text-xs font-semibold uppercase text-slate-500">{DOW.map(d => <div key={d} className="p-2">{d}</div>)}</div>
            <div className="grid grid-cols-7">{Array.from({ length: 42 }, (_, i) => addDays(start, i)).map(d => {
              const list = onDay(items, d, tz).filter(i => i.kind !== "lesson");
              const lessons = onDay(items, d, tz).filter(i => i.kind === "lesson").length;
              return (
                <button key={d} onClick={() => setDay(d)} className={"min-h-24 border-t border-l border-slate-100 p-1 text-left align-top text-xs " + (d.slice(0, 7) !== month ? "bg-slate-50/60 text-slate-400 " : "") + (d === day ? "ring-2 ring-inset ring-brand-400" : "")}>
                  <span className={"inline-block rounded-full px-1.5 " + (d === localDate() ? "bg-brand-600 text-white" : "")}>{Number(d.slice(8))}</span>
                  <ul className="mt-0.5 space-y-0.5">{list.slice(0, 3).map(i => <li key={i.id} className={`truncate rounded px-1 ${TONE[i.kind] ?? "bg-slate-100"}`} title={i.title}>{i.title}</li>)}</ul>
                  {list.length > 3 && <span className="text-[10px] text-slate-500">+{list.length - 3} more</span>}
                  {lessons > 0 && <span className="block text-[10px] text-slate-500">{lessons} lesson{lessons === 1 ? "" : "s"}</span>}
                </button>);
            })}</div>
          </div>
          <aside className="space-y-4">
            <section className="card space-y-2 p-4 text-sm">
              <h2 className="font-semibold">{fmtDate(day)}</h2>
              {!todays.length ? <p className="text-slate-500">Nothing on this day.</p> : <ul className="space-y-2">{todays.map(i => (
                <li key={i.id}><Badge tone="slate">{KIND_LABEL[i.kind]}</Badge> <b>{i.title}</b>
                  <span className="block text-xs text-slate-500">{i.allDay ? "All day" : `${time(i.start)}${i.end && i.end !== i.start ? `–${time(i.end)}` : ""}`}{i.location ? ` · ${i.location}` : ""}</span>
                  {i.description && <span className="block text-xs text-slate-600">{i.description}</span>}</li>))}</ul>}
            </section>
            <Subscribe />
          </aside>
        </div>
      )}
    </Page>
  );
}

function Subscribe() {
  const { data, reload } = useApi<{ feed: { created_at: string; last_used_at: string | null } | null }>("/api/calendar/feed");
  const [links, setLinks] = useState<{ url: string; webcal: string; google: string; outlook: string; office365: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section className="card space-y-2 p-4 text-sm">
      <h2 className="font-semibold">On your phone or computer</h2>
      <p className="text-slate-600">Add this calendar to Google Calendar, Outlook or your phone. It updates by itself (Google and Outlook check a few times a day).</p>
      {links ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <a className="btn btn-primary px-2 py-1 text-xs" href={links.google} target="_blank" rel="noreferrer">Add to Google Calendar</a>
            <a className="btn btn-outline px-2 py-1 text-xs" href={links.outlook} target="_blank" rel="noreferrer">Outlook.com</a>
            <a className="btn btn-outline px-2 py-1 text-xs" href={links.office365} target="_blank" rel="noreferrer">Microsoft 365</a>
            <a className="btn btn-outline px-2 py-1 text-xs" href={links.webcal}>iPhone / Mac</a>
          </div>
          <p className="text-xs text-slate-500">Or copy this private link into any calendar app (“subscribe from URL”). Keep it to yourself: anyone with it can see your calendar.</p>
          <input className="input font-mono text-xs" readOnly value={links.url} onFocus={e => e.target.select()} aria-label="Calendar link" />
        </div>
      ) : (
        <>
          {data?.feed && <p className="text-xs text-slate-500">You made a link on {fmtDate(data.feed.created_at)}{data.feed.last_used_at ? `; last read ${fmtDate(data.feed.last_used_at, true)}` : ""}. Making a new one stops the old link.</p>}
          <button className="btn btn-primary" onClick={async () => { const r = await send<typeof links>("/api/calendar/feed", {}); if (r.ok) { setLinks(r.data); reload(); } else setMsg(r.error); }}>{data?.feed ? "Make a new link" : "Get my calendar link"}</button>
          {data?.feed && <button className="btn btn-ghost text-rose-600" onClick={async () => { await send("/api/calendar/feed", undefined, "DELETE"); reload(); }}>Stop sharing</button>}
        </>
      )}
      {msg && <Alert>{msg}</Alert>}
    </section>
  );
}
