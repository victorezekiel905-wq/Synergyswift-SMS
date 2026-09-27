"use client";
import { useEffect, useRef, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Empty, Field, Modal, fmtDate, fmtTime, Loading } from "@/components/ui";
import { languageName } from "@/lib/languages";

type Thread = { id: string; subject: string; status: string; unread: number; last_message_at: string; started_by: string; guardian: string; student: string; staff: string; mine: boolean };
type Msg = { id: string; mine: boolean; from_parent: boolean; sender: string; at: string; text: string; original: string | null; sent_as: string | null };
type Detail = { conversation: { id: string; subject: string; status: string; student: string; guardian: string; guardian_language: string | null }; messages: Msg[]; can_reply: boolean };
type StudentHit = { id: string; first_name: string; last_name: string; admission_no: string; class_groups: { name: string } | null; student_guardians: { guardians: { id: string; full_name: string } | null }[] };

export default function InboxPage() {
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const list = useApi<{ is_admin: boolean; threads: Thread[] }>(`/api/inbox${scope === "all" ? "?scope=all" : ""}`, [scope]);
  const [open, setOpen] = useState<string | null>(null);
  const detail = useApi<Detail>(open ? `/api/inbox?c=${open}` : null, [open]);
  const [reply, setReply] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [compose, setCompose] = useState(false);
  const [showOriginal, setShowOriginal] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const c = new URLSearchParams(window.location.search).get("c"); if (c) setOpen(c); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [detail.data]);
  // New replies appear without a refresh.
  const reloadList = list.reload, reloadDetail = detail.reload;
  useEffect(() => {
    const t = setInterval(() => { reloadList(); if (open) reloadDetail(); }, 20_000);
    return () => clearInterval(t);
  }, [open, reloadList, reloadDetail]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!open || !reply.trim()) return;
    const r = await send("/api/inbox", { action: "reply", conversation_id: open, body: reply.trim() });
    if (!r.ok) return setErr(r.error);
    setErr(null); setReply(""); detail.reload(); list.reload();
  }
  async function setStatus(action: "close" | "reopen") {
    if (!open) return;
    await send("/api/inbox", { action, conversation_id: open });
    detail.reload(); list.reload();
  }

  const threads = list.data?.threads ?? [];
  const d = detail.data;
  return (
    <Page wide>
      <PageHeader eyebrow="Parents" title="Parent messages"
        subtitle="Private two-way messages with families. Nobody's phone number is shared, messages cannot be edited or deleted, and each family reads in their own language."
        actions={<button className="btn btn-primary" onClick={() => setCompose(true)}>+ New message</button>} />
      {list.error && <Alert>{list.error}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[22rem,1fr]">
        <section className="card overflow-hidden">
          {list.data?.is_admin && (
            <div className="flex gap-1 border-b border-slate-100 p-2 text-xs">
              {(["mine", "all"] as const).map(s => <button key={s} className={`rounded px-2 py-1 ${scope === s ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-600"}`} onClick={() => setScope(s)}>
                {s === "mine" ? "Mine and school office" : "All threads (safeguarding)"}</button>)}
            </div>
          )}
          {!threads.length ? <div className="p-4"><Empty>No conversations yet.</Empty></div> : (
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">{threads.map(t => (
              <li key={t.id}>
                <button className={`w-full px-4 py-3 text-left text-sm hover:bg-slate-50 ${open === t.id ? "bg-brand-50" : ""}`} onClick={() => setOpen(t.id)}>
                  <span className="flex items-center gap-2"><b className="mr-auto truncate">{t.guardian}</b>{t.unread > 0 && <Badge tone="blue">{t.unread}</Badge>}{t.status === "closed" && <Badge>closed</Badge>}</span>
                  <span className="block truncate text-slate-700">{t.subject}</span>
                  <span className="block text-xs text-slate-500">{t.student}{!t.mine ? ` · ${t.staff}` : ""} · {fmtDate(t.last_message_at)}</span>
                </button>
              </li>))}</ul>
          )}
        </section>

        <section className="card flex min-h-[60vh] flex-col">
          {!open ? <div className="grid flex-1 place-items-center p-6 text-sm text-slate-500">Choose a conversation.</div> : !d ? <Loading /> : (
            <>
              <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
                <div className="mr-auto">
                  <h2 className="font-semibold">{d.conversation.subject}</h2>
                  <p className="text-xs text-slate-500">{d.conversation.guardian} · about {d.conversation.student}
                    {d.conversation.guardian_language ? ` · reads in ${languageName(d.conversation.guardian_language)}` : ""}</p>
                </div>
                {d.can_reply && <button className="btn btn-ghost text-xs" onClick={() => setStatus("close")}>Close</button>}
                {d.conversation.status === "closed" && list.data?.is_admin && <button className="btn btn-ghost text-xs" onClick={() => setStatus("reopen")}>Reopen</button>}
              </header>
              <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
                {d.messages.map(m => (
                  <div key={m.id} className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${m.from_parent ? "bg-slate-100" : "ml-auto bg-brand-600 text-white"}`}>
                    <p className={`text-[11px] ${m.from_parent ? "text-slate-500" : "text-white/80"}`}>{m.sender} · {fmtDate(m.at)} {fmtTime(m.at)}</p>
                    <p className="whitespace-pre-wrap">{showOriginal.has(m.id) && m.original ? m.original : m.text}</p>
                    {m.original && <button className="mt-1 text-[11px] underline" onClick={() => setShowOriginal(s => { const n = new Set(s); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })}>
                      {showOriginal.has(m.id) ? "Show translation" : "Translated · show original"}</button>}
                    {m.sent_as && <p className="mt-1 text-[11px] text-white/80">Sent to the parent in their language.</p>}
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              {d.can_reply ? (
                <form onSubmit={sendReply} className="border-t border-slate-100 p-3">
                  {err && <div className="mb-2"><Alert>{err}</Alert></div>}
                  <div className="flex gap-2">
                    <textarea className="input min-h-[3rem] flex-1" value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a reply" aria-label="Reply" maxLength={4000}
                      onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendReply(e); }} />
                    <button className="btn btn-primary self-end" disabled={!reply.trim()}>Send</button>
                  </div>
                </form>
              ) : <p className="border-t border-slate-100 p-3 text-xs text-slate-500">{d.conversation.status === "closed" ? "This conversation is closed." : "Only the member of staff in this conversation can reply."}</p>}
            </>
          )}
        </section>
      </div>
      <Compose open={compose} onClose={() => setCompose(false)} onSent={id => { setCompose(false); setOpen(id); list.reload(); }} />
    </Page>
  );
}

function Compose({ open, onClose, onSent }: { open: boolean; onClose: () => void; onSent: (id: string) => void }) {
  const [q, setQ] = useState("");
  const hits = useApi<StudentHit[]>(open && q.trim().length >= 2 ? `/api/sims/students?limit=15&q=${encodeURIComponent(q.trim())}` : null, [q, open]);
  const [student, setStudent] = useState<StudentHit | null>(null);
  const [guardian, setGuardian] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const guardians = (student?.student_guardians ?? []).map(g => g.guardians).filter(Boolean) as { id: string; full_name: string }[];
  return (
    <Modal open={open} onClose={onClose} title="New message to a family">
      <form className="space-y-3" onSubmit={async e => {
        e.preventDefault();
        if (!student || !guardian) return setErr("choose a student and a parent");
        const r = await send<{ id: string }>("/api/inbox", { action: "start", student_id: student.id, guardian_id: guardian, subject, body });
        if (!r.ok) return setErr(r.error);
        setErr(null); setStudent(null); setGuardian(""); setSubject(""); setBody(""); setQ("");
        onSent(r.data.id);
      }}>
        {!student ? (
          <Field label="Student">
            <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Type a name or admission number" autoFocus />
            <ul className="mt-1 max-h-48 overflow-y-auto text-sm">{(hits.data ?? []).map(s => (
              <li key={s.id}><button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-slate-100" onClick={() => { setStudent(s); const g = s.student_guardians.find(x => x.guardians); setGuardian(g?.guardians?.id ?? ""); }}>
                {s.first_name} {s.last_name} <span className="text-xs text-slate-500">{s.admission_no} · {s.class_groups?.name ?? ""}</span></button></li>))}</ul>
          </Field>
        ) : (
          <p className="text-sm">About <b>{student.first_name} {student.last_name}</b> <button type="button" className="text-xs text-brand-700 underline" onClick={() => setStudent(null)}>change</button></p>
        )}
        {student && (guardians.length ? (
          <Field label="Parent"><select className="input" value={guardian} onChange={e => setGuardian(e.target.value)}>{guardians.map(g => <option key={g.id} value={g.id}>{g.full_name}</option>)}</select></Field>
        ) : <Alert tone="amber">This student has no parent on record.</Alert>)}
        <Field label="Subject"><input className="input" required maxLength={160} value={subject} onChange={e => setSubject(e.target.value)} /></Field>
        <Field label="Message" hint="The parent is told by WhatsApp, email or app notification, and replies from their portal.">
          <textarea className="input min-h-[8rem]" required maxLength={4000} value={body} onChange={e => setBody(e.target.value)} /></Field>
        {err && <Alert>{err}</Alert>}
        <button className="btn btn-primary w-full" disabled={!student || !guardian}>Send</button>
      </form>
    </Modal>
  );
}
