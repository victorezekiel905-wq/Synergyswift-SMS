"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi, send, Page, PageHeader, Alert, Badge, Empty, Field, Loading, Modal, fmtDate } from "@/components/ui";
import RichText from "@/components/content/RichText";

export default function ForumsPage() {
  return <Suspense fallback={<Loading />}><Forums /></Suspense>;
}

/** Class and school discussions. Students post in their class's forum and school-wide ones; staff moderate. */
function Forums() {
  const p = useSearchParams();
  const thread = p.get("thread"), forum = p.get("forum");
  return (
    <Page>
      {thread ? <ThreadView id={thread} /> : forum ? <ForumView id={forum} /> : <ForumList />}
    </Page>
  );
}

const who = (u: { full_name: string; role: string } | null) => u ? `${u.full_name}${u.role !== "student" ? " (staff)" : ""}` : "Former member";

function ForumList() {
  const { data, error, reload } = useApi<{ forums: { id: string; kind: string; title: string; description: string | null; locked: boolean; class_groups: { name: string } | null; subjects: { name: string } | null; forum_threads: { count: number }[] }[];
    reports: { id: string; reason: string; created_at: string; post_id: string | null; thread_id: string | null; forum_posts: { body: string; thread_id: string } | null; forum_threads: { title: string } | null; users: { full_name: string } | null }[]; staff: boolean }>("/api/forums");
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[]; subjects: { id: string; name: string }[] }>(data?.staff ? "/api/school/structure?mine=1" : null);
  const [create, setCreate] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  return (
    <>
      <PageHeader eyebrow="Learning" title="Discussions" subtitle={data.staff ? "Class and school discussion forums. Students post in their own class's forum; you can pin, close and hide anything." : "Ask questions and help each other. Be kind: teachers read everything here."}
        actions={data.staff ? <>
          <button className="btn btn-outline" onClick={async () => { const r = await send<{ created: number }>("/api/forums", { action: "class_forums" }); setMsg(r.ok ? (r.data.created ? `Created ${r.data.created} class forum${r.data.created === 1 ? "" : "s"}.` : "Your classes already have forums.") : r.error); reload(); }}>Forums for my classes</button>
          <button className="btn btn-primary" onClick={() => setCreate(true)}>New forum</button></> : undefined} />
      {msg && <div className="mb-3"><Alert tone="green">{msg}</Alert></div>}
      {data.staff && data.reports.length > 0 && (
        <section className="card mb-4 border-amber-300 p-3 text-sm">
          <h2 className="mb-1 font-semibold text-amber-800">Reported posts ({data.reports.length})</h2>
          <ul className="space-y-1">{data.reports.map(r => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <Link className="flex-1 text-brand-700 hover:underline" href={`/forums?thread=${r.forum_posts?.thread_id ?? r.thread_id}`}>{r.forum_threads?.title ?? (r.forum_posts?.body ?? "").slice(0, 80)}</Link>
              <span className="text-xs text-slate-500">“{r.reason}” · {r.users?.full_name} · {fmtDate(r.created_at, true)}</span>
              <button className="text-xs text-brand-700" onClick={async () => { await send("/api/forums", { action: "resolve_report", id: r.id }); reload(); }}>Dismiss</button>
            </li>
          ))}</ul>
        </section>
      )}
      {!data.forums.length ? <Empty>{data.staff ? "No forums yet. Create one for each class with “Forums for my classes”." : "No discussions yet."}</Empty> : (
        <ul className="card divide-y divide-slate-100">{data.forums.map(f => (
          <li key={f.id}><Link className="flex items-center gap-3 p-3 hover:bg-slate-50" href={`/forums?forum=${f.id}`}>
            <span className="flex-1"><b>{f.title}</b> {f.locked && <Badge>closed</Badge>}<span className="block text-xs text-slate-500">{f.kind === "class" ? f.class_groups?.name : f.kind === "staff" ? "Staff only" : "Whole school"}{f.subjects ? ` · ${f.subjects.name}` : ""}{f.description ? ` · ${f.description}` : ""}</span></span>
            <span className="text-xs text-slate-500">{f.forum_threads?.[0]?.count ?? 0} topics</span>
          </Link></li>
        ))}</ul>
      )}
      <Modal open={create} onClose={() => setCreate(false)} title="New forum">
        {create && <NewForum structure={structure ?? { class_groups: [], subjects: [] }} onDone={() => { setCreate(false); reload(); }} />}
      </Modal>
    </>
  );
}

function NewForum({ structure, onDone }: { structure: { class_groups: { id: string; name: string }[]; subjects: { id: string; name: string }[] }; onDone: () => void }) {
  const [f, setF] = useState({ kind: "class", class_group_id: "", subject_id: "", title: "", description: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-3 text-sm" onSubmit={async e => { e.preventDefault(); const r = await send("/api/forums", { action: "create_forum", ...f, class_group_id: f.class_group_id || null, subject_id: f.subject_id || null, description: f.description || null }); if (r.ok) onDone(); else setErr(r.error); }}>
      {err && <Alert>{err}</Alert>}
      <Field label="For"><select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="class">One class</option><option value="school">The whole school</option><option value="staff">Staff only</option></select></Field>
      {f.kind === "class" && <Field label="Class"><select className="input" required value={f.class_group_id} onChange={e => setF({ ...f, class_group_id: e.target.value })}><option value="">—</option>{structure.class_groups.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
      <Field label="Subject (optional)"><select className="input" value={f.subject_id} onChange={e => setF({ ...f, subject_id: e.target.value })}><option value="">—</option>{structure.subjects.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Title"><input className="input" required value={f.title} onChange={e => setF({ ...f, title: e.target.value })} maxLength={120} /></Field>
      <Field label="Description"><input className="input" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} maxLength={500} /></Field>
      <button className="btn btn-primary">Create</button>
    </form>
  );
}

function ForumView({ id }: { id: string }) {
  const router = useRouter();
  const { data, error, reload } = useApi<{ forum: { id: string; title: string; description: string | null; locked: boolean; class_groups: { name: string } | null }; staff: boolean;
    threads: { id: string; title: string; pinned: boolean; locked: boolean; hidden: boolean; post_count: number; last_post_at: string; users: { full_name: string; role: string } | null }[] }>(`/api/forums?forum=${id}`);
  const [f, setF] = useState({ title: "", body: "" });
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  return (
    <>
      <Link href="/forums" className="text-sm text-brand-700 hover:underline">← Discussions</Link>
      <PageHeader title={data.forum.title} subtitle={data.forum.description ?? data.forum.class_groups?.name ?? undefined}
        actions={<>
          {data.staff && <button className="btn btn-outline" onClick={async () => { await send("/api/forums", { action: "lock_forum", id, locked: !data.forum.locked }); reload(); }}>{data.forum.locked ? "Reopen" : "Close"} forum</button>}
          {(!data.forum.locked || data.staff) && <button className="btn btn-primary" onClick={() => setOpen(true)}>New topic</button>}</>} />
      {!data.threads.length ? <Empty>No topics yet. Start one.</Empty> : (
        <ul className="card divide-y divide-slate-100">{data.threads.map(t => (
          <li key={t.id}><Link className={"flex items-center gap-3 p-3 hover:bg-slate-50 " + (t.hidden ? "opacity-50" : "")} href={`/forums?thread=${t.id}`}>
            <span className="flex-1">{t.pinned && <span className="mr-1.5"><Badge tone="blue">pinned</Badge></span>}<b>{t.title}</b> {t.locked && <Badge>closed</Badge>}{t.hidden && <Badge tone="red">hidden</Badge>}<span className="block text-xs text-slate-500">{who(t.users)} · {fmtDate(t.last_post_at, true)}</span></span>
            <span className="text-xs text-slate-500">{t.post_count} repl{t.post_count === 1 ? "y" : "ies"}</span>
          </Link></li>
        ))}</ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="New topic" wide>
        <form className="space-y-3 text-sm" onSubmit={async e => { e.preventDefault(); const r = await send<{ id: string }>("/api/forums", { action: "thread", forum_id: id, ...f }); if (r.ok) router.push(`/forums?thread=${r.data.id}`); else setErr(r.error); }}>
          {err && <Alert>{err}</Alert>}
          <Field label="Title"><input className="input" required value={f.title} onChange={e => setF({ ...f, title: e.target.value })} maxLength={160} /></Field>
          <Field label="Your question or idea" hint={String.raw`Maths: \(x^2\) or $$\frac{a}{b}$$. Code: three backticks.`}><textarea className="input min-h-32" required value={f.body} onChange={e => setF({ ...f, body: e.target.value })} maxLength={20000} /></Field>
          <button className="btn btn-primary">Post</button>
        </form>
      </Modal>
    </>
  );
}

function ThreadView({ id }: { id: string }) {
  const router = useRouter();
  const { data, error, reload } = useApi<{ thread: { id: string; title: string; body: string; pinned: boolean; locked: boolean; hidden: boolean; created_at: string; author_id: string; post_count: number; users: { full_name: string; role: string } | null; forums: { id: string; title: string; locked: boolean } };
    posts: { id: string; body: string; hidden: boolean; hidden_reason: string | null; edited_at: string | null; created_at: string; author_id: string; users: { full_name: string; role: string } | null }[]; staff: boolean; me: string }>(`/api/forums?thread=${id}`);
  const [reply, setReply] = useState("");
  const [edit, setEdit] = useState<{ id: string; body: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const t = data.thread;
  const act = async (b: Record<string, unknown>, ok?: string) => { const r = await send("/api/forums", b); setMsg(r.ok ? (ok ? { ok: true, text: ok } : null) : { ok: false, text: r.error ?? "failed" }); if (r.ok) reload(); return r.ok; };
  const closed = t.locked || t.forums.locked;
  return (
    <div className="space-y-4">
      <Link href={`/forums?forum=${t.forums.id}`} className="text-sm text-brand-700 hover:underline">← {t.forums.title}</Link>
      <header className="flex flex-wrap items-start gap-2">
        <h1 className="flex-1 font-serif text-2xl font-semibold">{t.title}{t.pinned && <span className="ml-2 align-middle"><Badge tone="blue">pinned</Badge></span>}</h1>
        {data.staff && <>
          <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "thread_flags", thread_id: id, pinned: !t.pinned })}>{t.pinned ? "Unpin" : "Pin"}</button>
          <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "thread_flags", thread_id: id, locked: !t.locked })}>{t.locked ? "Reopen" : "Close"}</button>
          <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "moderate", thread_id: id, hide: !t.hidden })}>{t.hidden ? "Show" : "Hide"}</button>
          <button className="btn btn-outline px-2 py-1 text-xs text-rose-700" onClick={async () => { if (confirm("Delete this topic and every reply?") && await act({ action: "delete_thread", thread_id: id })) router.push(`/forums?forum=${t.forums.id}`); }}>Delete</button></>}
      </header>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <article className="card p-4"><p className="mb-2 text-xs text-slate-500">{who(t.users)} · {fmtDate(t.created_at, true)}</p><RichText text={t.body} /></article>
      <ul className="space-y-2">{data.posts.map(p => (
        <li key={p.id} className={"card p-3 text-sm " + (p.hidden ? "border-rose-200 bg-rose-50/50" : "")}>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="flex-1">{who(p.users)} · {fmtDate(p.created_at, true)}{p.edited_at ? " · edited" : ""}</span>
            {p.hidden && <Badge tone="red">hidden{p.hidden_reason ? `: ${p.hidden_reason}` : ""}</Badge>}
            {p.author_id === data.me && !p.hidden && <button onClick={() => setEdit({ id: p.id, body: p.body })}>Edit</button>}
            {data.staff ? <button onClick={() => { const reason = p.hidden ? null : prompt("Why hide this post? (shown to staff)") ?? ""; if (p.hidden || reason !== null) act({ action: "moderate", post_id: p.id, hide: !p.hidden, reason }); }}>{p.hidden ? "Show" : "Hide"}</button>
              : p.author_id !== data.me && <button onClick={() => { const reason = prompt("What is wrong with this post?"); if (reason) act({ action: "report", post_id: p.id, reason }, "Thank you. A teacher will look at it."); }}>Report</button>}
          </div>
          {edit?.id === p.id ? (
            <form className="space-y-1" onSubmit={async e => { e.preventDefault(); if (await act({ action: "edit", post_id: p.id, body: edit.body })) setEdit(null); }}>
              <textarea className="input min-h-20" value={edit.body} onChange={e => setEdit({ ...edit, body: e.target.value })} aria-label="Edit post" />
              <div className="flex gap-2"><button className="btn btn-primary px-2 py-1 text-xs">Save</button><button type="button" className="text-xs" onClick={() => setEdit(null)}>Cancel</button></div>
            </form>
          ) : <RichText text={p.body} />}
        </li>
      ))}</ul>
      {closed && !data.staff ? <p className="text-sm text-slate-500">This discussion is closed.</p> : (
        <form className="space-y-2" onSubmit={async e => { e.preventDefault(); if (await act({ action: "reply", thread_id: id, body: reply })) setReply(""); }}>
          <textarea className="input min-h-24" value={reply} onChange={e => setReply(e.target.value)} placeholder="Write a reply" required maxLength={20000} aria-label="Reply" />
          <button className="btn btn-primary">Reply</button>
        </form>
      )}
    </div>
  );
}
