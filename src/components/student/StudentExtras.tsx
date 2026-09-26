"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Badge, fmtDate } from "@/components/ui";

type Hw = { id: string; title: string; instructions: string | null; attachment_url: string | null; due_at: string; max_score: number | null; allow_late: boolean;
  subjects: { name: string } | null; submission: { submitted_at: string; late: boolean; score: number | null; feedback: string | null } | null };

/** Student homework list with in-browser submission. */
export function StudentHomework() {
  const { data, error, reload } = useApi<Hw[]>("/api/homework");
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert tone="amber">{error}</Alert>;
  if (!data?.length) return <Empty>No homework right now.</Empty>;
  return (
    <ul className="space-y-2">{data.map(h => {
      const overdue = new Date(h.due_at) < new Date();
      return (
        <li key={h.id} className="card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span><b>{h.title}</b> <span className="text-slate-500">{h.subjects?.name}</span><br /><span className="text-xs text-slate-500">Due {fmtDate(h.due_at, true)}</span></span>
            {h.submission ? <Badge tone="green">{h.submission.score !== null ? `Marked: ${h.submission.score}${h.max_score ? `/${h.max_score}` : ""}` : "Handed in"}</Badge>
              : overdue ? <Badge tone="red">Overdue</Badge> : <Badge tone="amber">To do</Badge>}
          </div>
          {h.submission?.feedback && <p className="mt-2 rounded bg-emerald-50 p-2 text-xs">Feedback: {h.submission.feedback}</p>}
          <button className="mt-2 text-xs text-brand-700 underline" onClick={() => { setOpen(open === h.id ? null : h.id); setText(""); setMsg(null); }}>{open === h.id ? "Close" : h.submission ? "View / resubmit" : "Open"}</button>
          {open === h.id && (
            <div className="mt-2 space-y-2">
              {h.instructions && <p className="whitespace-pre-wrap rounded bg-slate-50 p-2">{h.instructions}</p>}
              {h.attachment_url && <a className="text-xs text-brand-700 underline" href={h.attachment_url} target="_blank" rel="noreferrer">Open attachment</a>}
              {h.submission?.score == null && (!overdue || h.allow_late) ? (
                <form onSubmit={async e => { e.preventDefault(); const r = await send("/api/homework", { action: "submit", homework_id: h.id, body: text });
                  setMsg({ ok: r.ok, text: r.ok ? (r.data.late ? "Handed in late." : "Handed in.") : r.error ?? "failed" }); if (r.ok) reload(); }}>
                  <textarea className="input h-32" required value={text} onChange={e => setText(e.target.value)} placeholder="Type your answer" aria-label="Your answer" />
                  <button className="btn btn-primary mt-2">Hand in</button>
                </form>
              ) : null}
              {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
            </div>
          )}
        </li>
      );
    })}</ul>
  );
}

type Period = { id: string; name: string; starts_at: string; ends_at: string; is_break: boolean };
type Entry = { day: number; period_id: string; subjects: { name: string } | null; users: { full_name: string } | null; room: string | null };

/** The student's class timetable (read-only). */
export function StudentTimetable() {
  const { data } = useApi<{ periods: Period[]; entries: Entry[] }>("/api/timetable");
  if (!data?.periods?.length || !data.entries?.length) return <Empty>Your timetable has not been published yet.</Empty>;
  const days = [1, 2, 3, 4, 5];
  const today = new Date().getDay();
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs">
        <thead className="bg-slate-50"><tr><th className="p-2 text-left">Period</th>{["Mon", "Tue", "Wed", "Thu", "Fri"].map((d, i) => <th key={d} className={"p-2 " + (days[i] === today ? "text-brand-700" : "")}>{d}</th>)}</tr></thead>
        <tbody>{data.periods.map(p => (
          <tr key={p.id} className={"border-t border-slate-100 " + (p.is_break ? "bg-slate-50" : "")}>
            <td className="p-2"><b>{p.name}</b><div className="text-slate-400">{p.starts_at.slice(0, 5)}</div></td>
            {days.map(d => { const e = data.entries.find(x => x.day === d && x.period_id === p.id); return (
              <td key={d} className={"p-1 text-center " + (d === today ? "bg-brand-50/50" : "")}>{p.is_break ? <span className="text-slate-400">{p.name}</span> : e ? <><b>{e.subjects?.name}</b><div className="text-[10px] text-slate-500">{e.users?.full_name}</div></> : null}</td>); })}
          </tr>))}</tbody>
      </table>
    </div>
  );
}
