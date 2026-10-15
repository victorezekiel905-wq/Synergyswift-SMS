"use client";
import { useEffect, useState } from "react";
import { useApi, send, Alert, Empty, Field, Badge, Modal, fmtDate } from "@/components/ui";
import RichText from "@/components/content/RichText";

type Conv = { id: string; title: string; concern: string | null; concern_at: string | null; reviewed_at: string | null; updated_at: string; subjects: { name: string } | null;
  students: { first_name: string; last_name: string; class_groups?: { name: string } | null } | null };

/** The study helper: switch it on, set the daily limit, and follow up conversations that raised a concern. */
export default function TutorAdmin() {
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const { data, reload } = useApi<{ items: Conv[]; settings: { enabled: boolean; switchedOn: boolean; limit: number; available: boolean }; admin: boolean }>(`/api/tutor${flaggedOnly ? "?flagged=1" : ""}`, [flaggedOnly]);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ enabled: boolean; daily_limit: number } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("conversation");
    if (id) setOpen(id);
  }, []);
  if (!data) return null;
  const s = data.settings;
  const f = form ?? { enabled: s.switchedOn, daily_limit: s.limit };
  const open_concerns = data.items.filter(c => c.concern && !c.reviewed_at);
  return (
    <div className="space-y-4 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!s.available && <Alert tone="amber">The study helper needs ANTHROPIC_API_KEY on the server.</Alert>}
      {data.admin && (
        <form className="card flex flex-wrap items-end gap-3 p-4" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/tutor", { action: "settings", ...f });
          setMsg({ ok: r.ok, text: r.ok ? (f.enabled ? "The study helper is on for students." : "The study helper is off.") : r.error ?? "failed" });
          if (r.ok) { setForm(null); reload(); }
        }}>
          <div className="mr-auto max-w-xl"><h2 className="font-semibold">Study helper for students</h2>
            <p className="text-xs text-slate-500">Students ask questions about their work and get hints and explanations, not homework answers. Students are told it is an AI helper and that their teachers and parents can read the chats. If a student writes something that suggests they are unsafe or very upset, counsellors, the principal and their form teacher are alerted.</p></div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.enabled} onChange={e => setForm({ ...f, enabled: e.target.checked })} /> Switched on</label>
          <Field label="Questions per student per day"><input className="input w-24" type="number" min={1} max={500} value={f.daily_limit} onChange={e => setForm({ ...f, daily_limit: Number(e.target.value) })} /></Field>
          <button className="btn btn-primary">Save</button>
        </form>
      )}
      {open_concerns.length > 0 && <Alert tone="amber">{open_concerns.length} conversation{open_concerns.length === 1 ? "" : "s"} raised a concern and {open_concerns.length === 1 ? "has" : "have"} not been followed up yet.</Alert>}
      <section className="card space-y-2 p-4">
        <div className="flex items-center gap-2"><h2 className="mr-auto font-semibold">{flaggedOnly ? "Conversations with a concern" : "This week's conversations"}</h2>
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={flaggedOnly} onChange={e => setFlaggedOnly(e.target.checked)} /> Concerns only</label></div>
        {!data.items.length ? <Empty>None.</Empty> : (
          <ul className="divide-y divide-slate-100">{data.items.map(c => (
            <li key={c.id}><button className="flex w-full items-center gap-2 py-2 text-left" onClick={() => setOpen(c.id)}>
              <span className="mr-auto"><b>{c.students ? `${c.students.first_name} ${c.students.last_name}` : "Student"}</b> <span className="text-slate-600">{c.title}</span>
                <span className="block text-xs text-slate-500">{c.students?.class_groups?.name ?? ""}{c.subjects ? ` · ${c.subjects.name}` : ""} · {fmtDate(c.updated_at, true)}</span></span>
              {c.concern && <Badge tone={c.concern === "safety" ? "red" : "amber"}>{c.concern}{c.reviewed_at ? " · followed up" : ""}</Badge>}
            </button></li>))}</ul>
        )}
      </section>
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title="Conversation" wide>
        {open && <Conversation id={open} onReviewed={() => { setOpen(null); reload(); }} />}
      </Modal>
    </div>
  );
}

export function Conversation({ id, onReviewed }: { id: string; onReviewed?: () => void }) {
  const { data, error } = useApi<{ conversation: Conv & { context: { kind?: string; title?: string } }; messages: { id: number; role: string; content: string; created_at: string }[] }>(`/api/tutor?id=${id}`, [id]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const c = data.conversation;
  return (
    <div className="space-y-3 text-sm">
      <p><b>{c.title}</b>{c.context?.title ? <span className="text-slate-500"> · from {c.context.kind} “{c.context.title}”</span> : null}</p>
      {c.concern && <Alert tone={c.concern === "safety" ? "red" : "amber"}>This conversation raised a {c.concern} concern on {fmtDate(c.concern_at, true)}.{c.reviewed_at ? ` Followed up ${fmtDate(c.reviewed_at, true)}.` : ""}</Alert>}
      <ol className="max-h-[60vh] space-y-2 overflow-y-auto">{data.messages.map(m => (
        <li key={m.id} className={"rounded-lg p-2 " + (m.role === "student" ? "ml-8 bg-brand-50" : "mr-8 bg-slate-50")}>
          <span className="block text-xs text-slate-500">{m.role === "student" ? "Student" : "Study helper"} · {fmtDate(m.created_at, true)}</span>
          {m.role === "student" ? <p className="whitespace-pre-wrap">{m.content}</p> : <RichText text={m.content} />}
        </li>))}</ol>
      {onReviewed && c.concern && !c.reviewed_at && <button className="btn btn-primary" onClick={async () => { const r = await send("/api/tutor", { action: "review", id }); if (r.ok) onReviewed(); }}>Mark as followed up</button>}
    </div>
  );
}
