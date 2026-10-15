"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Empty, Badge, Field, Loading, Modal, fmtDate } from "@/components/ui";

type Item = { id: string; source: "student" | "parent"; body: string; reason: string | null; at: string; reviewed_at: string | null; reviewer: string | null; from: string; about: string; thread_id: string };
type Data = { items: Item[]; settings: { enabled: boolean; from: string; to: string; parentsSee: boolean }; volume: { name: string; threads: number }[] };

/** For safeguarding leads: messages flagged for contact details, secrets, meeting requests or risk, and the rules for teacher-student messaging. */
export default function MessagingSafety() {
  const [all, setAll] = useState(false);
  const { data, reload, error } = useApi<Data>(`/api/messaging-safety${all ? "?all=1" : ""}`, [all]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [f, setF] = useState<Data["settings"] | null>(null);
  const [thread, setThread] = useState<string | null>(null);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  const s = f ?? data?.settings;
  return (
    <Page wide>
      <PageHeader eyebrow="Safeguarding" title="Messaging safety" subtitle="Messages between staff, students and parents are checked for phone numbers, private apps, requests to meet or keep secrets, and signs a child may be at risk. Flagged messages appear here and the safeguarding leads are alerted." />
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!data || !s ? <Loading /> : (
        <div className="grid gap-4 text-sm lg:grid-cols-[1fr,20rem]">
          <section className="card space-y-2 p-4">
            <div className="flex items-center"><h2 className="mr-auto font-semibold">{all ? "All flagged messages" : "Flagged, not yet reviewed"}</h2>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />Include reviewed</label></div>
            {!data.items.length ? <Empty>Nothing to review.</Empty> : <ul className="divide-y divide-slate-100">{data.items.map(i => (
              <li key={i.source + i.id} className="space-y-1 py-2">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={i.source === "student" ? "violet" : "blue"}>{i.source === "student" ? "teacher–student" : "parent"}</Badge>
                  <span className="mr-auto text-xs text-slate-500">{i.from} · {i.about} · {fmtDate(i.at, true)}</span>
                  {i.reviewed_at ? <Badge tone="green">reviewed{i.reviewer ? ` by ${i.reviewer}` : ""}</Badge>
                    : <button className="btn btn-outline px-2 py-0.5 text-xs" onClick={async () => { const r = await send("/api/messaging-safety", { action: "review", source: i.source, id: i.id }); setMsg({ ok: r.ok, text: r.ok ? "Marked as reviewed." : r.error ?? "failed" }); reload(); }}>Mark reviewed</button>}</div>
                <p className="whitespace-pre-wrap rounded bg-amber-50 p-2">{i.body}</p>
                <p className="text-xs text-amber-800">Mentions {i.reason}</p>
                {i.source === "student" && <button className="text-xs text-brand-700" onClick={() => setThread(i.thread_id)}>Read the whole conversation</button>}
              </li>))}</ul>}
          </section>
          <aside className="space-y-4">
            <form className="card space-y-2 p-4" onSubmit={async e => { e.preventDefault(); const r = await send("/api/messaging-safety", { action: "settings", enabled: s.enabled, from: s.from, to: s.to, parents_see: s.parentsSee });
              setMsg({ ok: r.ok, text: r.ok ? "Saved." : r.error ?? "failed" }); if (r.ok) { setF(null); reload(); } }}>
              <h2 className="font-semibold">Teacher–student messaging</h2>
              <label className="flex items-center gap-2"><input type="checkbox" checked={s.enabled} onChange={e => setF({ ...s, enabled: e.target.checked })} />Switched on</label>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Staff may write from"><input className="input" type="time" value={s.from} onChange={e => setF({ ...s, from: e.target.value })} /></Field>
                <Field label="Until"><input className="input" type="time" value={s.to} onChange={e => setF({ ...s, to: e.target.value })} /></Field>
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={s.parentsSee} onChange={e => setF({ ...s, parentsSee: e.target.checked })} />Parents can read their child&apos;s conversations</label>
              <p className="text-xs text-slate-500">Staff can write only to students they teach (counsellors and admins to any), on school days within these hours. Nothing can be edited or deleted. Students get app notifications, never emails.</p>
              <button className="btn btn-primary">Save</button>
            </form>
            <section className="card p-4"><h2 className="mb-1 font-semibold">Conversations in the last 30 days</h2>
              {!data.volume.length ? <Empty>None.</Empty> : <ul>{data.volume.map(v => <li key={v.name} className="flex justify-between"><span>{v.name}</span><span>{v.threads}</span></li>)}</ul>}</section>
          </aside>
        </div>
      )}
      <Modal open={Boolean(thread)} onClose={() => setThread(null)} title="Conversation" wide>{thread && <Thread id={thread} />}</Modal>
    </Page>
  );
}

function Thread({ id }: { id: string }) {
  const { data } = useApi<{ thread: { subject: string; student: string; teacher: string }; messages: { id: string; sender_kind: string; body: string; flagged: boolean; created_at: string }[] }>(`/api/student-messages?id=${id}`);
  if (!data) return <Loading />;
  return (
    <div className="space-y-2 text-sm"><p><b>{data.thread.subject}</b>: {data.thread.teacher} and {data.thread.student}</p>
      {data.messages.map(m => <div key={m.id} className={"rounded p-2 " + (m.flagged ? "bg-amber-50" : "bg-slate-50")}><p className="text-xs text-slate-500">{m.sender_kind === "staff" ? data.thread.teacher : data.thread.student} · {fmtDate(m.created_at, true)}</p><p className="whitespace-pre-wrap">{m.body}</p></div>)}</div>
  );
}
