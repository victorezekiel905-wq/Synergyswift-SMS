"use client";
import { useEffect, useRef, useState } from "react";
import { useApi, send, Alert, Empty, Badge, Field, Loading, fmtDate } from "@/components/ui";
import PeoplePicker, { type Person } from "@/components/comms/PeoplePicker";

type Thread = { id: string; subject: string; status: string; student_unread: number; staff_unread: number; last_message_at: string; student: string; class_name: string | null; teacher: string };
type Msg = { id: string; sender_kind: "staff" | "student"; body: string; flagged: boolean; created_at: string };

/** Teacher-student conversations: for staff (role "staff") or a student (role "student"). */
export default function StudentThreads({ role }: { role: "staff" | "student" }) {
  const list = useApi<{ enabled: boolean; hours: { from: string; to: string }; teachers: { id: string; name: string; role: string }[]; items: Thread[] }>("/api/student-messages");
  const [open, setOpen] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => { const t = new URLSearchParams(window.location.search).get("t"); if (t) setOpen(t); }, []);
  if (!list.data) return <Loading />;
  const d = list.data;
  if (!d.enabled) return <Empty>Messaging between teachers and students is switched off for this school.</Empty>;
  return (
    <div className="grid gap-3 text-sm md:grid-cols-[18rem,1fr]">
      <aside className="space-y-2">
        <button className="btn btn-primary w-full" onClick={() => { setStarting(true); setOpen(null); }}>{role === "staff" ? "+ Message a student" : "+ Message a teacher"}</button>
        <p className="text-xs text-slate-500">{role === "staff" ? `You can write to students you teach, on school days between ${d.hours.from} and ${d.hours.to}.` : "You can write to your own teachers."} Messages are kept and can be read by the school&apos;s safeguarding staff{role === "student" ? " and your parents" : " and the student's parents"}.</p>
        {!d.items.length ? <Empty>No conversations yet.</Empty> : <ul className="space-y-1">{d.items.map(t => {
          const unread = role === "staff" ? t.staff_unread : t.student_unread;
          return <li key={t.id}><button className={"w-full rounded px-2 py-1.5 text-left " + (open === t.id ? "bg-brand-50" : "hover:bg-slate-50")} onClick={() => { setOpen(t.id); setStarting(false); }}>
            <span className="flex items-center gap-1"><b className="mr-auto truncate">{role === "staff" ? t.student : t.teacher}</b>{unread > 0 && <Badge tone="red">{unread}</Badge>}{t.status === "closed" && <Badge tone="slate">closed</Badge>}</span>
            <span className="block truncate text-xs text-slate-500">{t.subject}{role === "staff" && t.class_name ? ` · ${t.class_name}` : ""} · {fmtDate(t.last_message_at)}</span></button></li>;
        })}</ul>}
      </aside>
      <section className="card min-h-[24rem] p-3">
        {starting ? <Start role={role} teachers={d.teachers} onDone={id => { setStarting(false); list.reload(); if (id) setOpen(id); }} />
          : open ? <Conversation id={open} role={role} onChange={list.reload} /> : <p className="text-slate-400">Choose a conversation.</p>}
      </section>
    </div>
  );
}

function Start({ role, teachers, onDone }: { role: "staff" | "student"; teachers: { id: string; name: string; role: string }[]; onDone: (id?: string) => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [teacher, setTeacher] = useState("");
  const [f, setF] = useState({ subject: "", body: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-2" onSubmit={async e => {
      e.preventDefault();
      const r = await send<{ id: string }>("/api/student-messages", { action: "start", student_id: role === "staff" ? people[0]?.id : null, staff_user_id: role === "student" ? teacher : null, ...f });
      if (!r.ok) return setErr(r.error);
      onDone(r.data.id);
    }}>
      {err && <Alert>{err}</Alert>}
      {role === "staff" ? <Field label="Student"><PeoplePicker value={people.slice(0, 1)} onChange={p => setPeople(p.slice(-1))} types={["Student"]} placeholder="Search for a student you teach" /></Field>
        : <Field label="Teacher"><select className="input" value={teacher} onChange={e => setTeacher(e.target.value)} required><option value="">Choose…</option>{teachers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.role})</option>)}</select></Field>}
      <Field label="Subject"><input className="input" value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} required maxLength={160} /></Field>
      <Field label="Message"><textarea className="input min-h-28" value={f.body} onChange={e => setF({ ...f, body: e.target.value })} required maxLength={4000} /></Field>
      <div className="flex gap-2"><button className="btn btn-primary" disabled={role === "staff" ? !people.length : !teacher}>Send</button><button type="button" className="btn btn-ghost" onClick={() => onDone()}>Cancel</button></div>
    </form>
  );
}

function Conversation({ id, role, onChange }: { id: string; role: "staff" | "student"; onChange: () => void }) {
  const { data, reload } = useApi<{ thread: { subject: string; status: string; student: string; teacher: string }; messages: Msg[]; can_write: boolean; settings: { from: string; to: string } }>(`/api/student-messages?id=${id}`, [id]);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  // Scroll to the newest message and refresh the list (unread counts) when a conversation loads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); onChange(); }, [data]);
  if (!data) return <Loading />;
  const mine = (m: Msg) => m.sender_kind === role;
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2"><b className="mr-auto">{data.thread.subject}</b><span className="text-xs text-slate-500">{data.thread.teacher} · {data.thread.student}</span>
        {role === "staff" && data.thread.status === "open" && <button className="text-xs text-slate-500" onClick={async () => { await send("/api/student-messages", { action: "close", thread_id: id }); reload(); onChange(); }}>Close</button>}</div>
      <div className="flex-1 space-y-2 overflow-y-auto">{data.messages.map(m => (
        <div key={m.id} className={"max-w-[85%] rounded-lg p-2 " + (mine(m) ? "ml-auto bg-brand-50" : "bg-slate-50")}>
          <p className="whitespace-pre-wrap">{m.body}</p><p className="text-[10px] text-slate-500">{fmtDate(m.created_at, true)}{m.flagged && role === "staff" ? " · flagged for review" : ""}</p></div>))}<div ref={end} /></div>
      {err && <Alert>{err}</Alert>}
      {data.can_write ? (
        <form className="mt-2 flex gap-2" onSubmit={async e => { e.preventDefault(); const r = await send("/api/student-messages", { action: "send", thread_id: id, body: text }); if (!r.ok) return setErr(r.error); setErr(null); setText(""); reload(); }}>
          <textarea className="input min-h-12 flex-1" value={text} onChange={e => setText(e.target.value)} required maxLength={4000} aria-label="Message" />
          <button className="btn btn-primary">Send</button>
        </form>) : <p className="mt-2 text-xs text-slate-500">{data.thread.status === "closed" ? "This conversation is closed." : "You can read this conversation."}</p>}
    </div>
  );
}
