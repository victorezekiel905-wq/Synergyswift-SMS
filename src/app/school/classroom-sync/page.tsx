"use client";
import { useEffect, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Empty, Loading, fmtDate } from "@/components/ui";

type Prov = "google" | "microsoft";
type Data = {
  configured: Record<Prov, boolean>;
  connections: { provider: Prov; account_email: string | null }[];
  classes: { class_group_id: string; class_name: string; subject_id: string | null; subject: string | null }[];
  links: { id: string; class_group_id: string; subject_id: string | null; provider: Prov; external_id: string; external_name: string | null; external_url: string | null }[];
  homework: { id: string; title: string; due_at: string; class_group_id: string; class_groups: { name: string } | null; subjects: { name: string } | null;
    homework_external: { provider: Prov; external_url: string | null; pushed_at: string; grades_pulled_at: string | null }[] }[];
  notes: { id: string; topic: string; week: number | null; onenote_url: string | null; subjects: { name: string } | null; class_groups: { name: string } | null }[];
};
const NAME: Record<Prov, string> = { google: "Google Classroom", microsoft: "Microsoft Teams" };

/** Google Classroom and Microsoft Teams: connect, link classes, send homework, bring marks back; lesson notes to OneNote. */
export default function ClassroomSync() {
  const { data, error, reload } = useApi<Data>("/api/classroom-sync");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [courses, setCourses] = useState<Partial<Record<Prov, { id: string; name: string; url: string | null }[]>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    if (u.get("connected")) setMsg({ ok: true, text: `${NAME[u.get("connected") as Prov] ?? "Account"} connected.` });
    if (u.get("error")) setMsg({ ok: false, text: u.get("error")! });
  }, []);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const connected = (p: Prov) => data.connections.find(c => c.provider === p);
  async function act(body: Record<string, unknown>, ok: (d: any) => string, key?: string) {
    setBusy(key ?? null);
    const r = await send("/api/classroom-sync", body);
    setBusy(null);
    setMsg({ ok: r.ok, text: r.ok ? ok(r.data) : r.error ?? "failed" });
    if (r.ok) reload();
  }
  async function loadCourses(p: Prov) {
    const r = await fetch(`/api/classroom-sync?courses=${p}`).then(x => x.json());
    if (r.error) setMsg({ ok: false, text: r.error }); else setCourses({ ...courses, [p]: r.courses });
  }
  const provs = (["google", "microsoft"] as Prov[]).filter(p => data.configured[p]);

  return (
    <Page wide>
      <PageHeader eyebrow="Teaching" title="Google Classroom & Microsoft Teams" subtitle="Keep using Classroom or Teams with your classes: send homework across in one click and bring the marks back into the school system." />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {!provs.length && <Alert tone="amber">Neither Google nor Microsoft is set up on the server yet. An administrator adds the app details (see the going-live checklist), then this page lights up.</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        {provs.map(p => { const c = connected(p); return (
          <section key={p} className="card space-y-2 p-4 text-sm">
            <div className="flex items-center gap-2"><h2 className="font-semibold">{NAME[p]}{p === "microsoft" ? " and OneNote" : ""}</h2><Badge tone={c ? "green" : "slate"}>{c ? "connected" : "not connected"}</Badge></div>
            {c ? <>
              <p className="text-slate-600">Signed in as {c.account_email ?? "your account"}.</p>
              <div className="flex gap-2"><button className="btn btn-outline px-2 py-1 text-xs" onClick={() => loadCourses(p)}>Show my {p === "google" ? "courses" : "classes"}</button>
                <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act({ action: "disconnect", provider: p }, () => "Disconnected.")}>Disconnect</button></div>
            </> : <a className="btn btn-primary inline-block" href={`/api/connect/${p}`}>Connect my {p === "google" ? "Google" : "Microsoft"} school account</a>}
          </section>); })}
      </div>

      {provs.some(p => connected(p)) && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">Link your classes</h2>
          {!data.classes.length ? <Empty>No classes are assigned to you.</Empty> : (
            <div className="card overflow-x-auto"><table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-2 text-left">Class</th>{provs.filter(p => connected(p)).map(p => <th key={p} className="p-2 text-left">{NAME[p]}</th>)}</tr></thead>
              <tbody>{data.classes.map(c => (
                <tr key={`${c.class_group_id}-${c.subject_id}`} className="border-t border-slate-100">
                  <td className="p-2">{c.class_name}{c.subject ? ` · ${c.subject}` : " (form class)"}</td>
                  {provs.filter(p => connected(p)).map(p => {
                    const l = data.links.find(x => x.provider === p && x.class_group_id === c.class_group_id && (x.subject_id ?? null) === (c.subject_id ?? null));
                    return (
                      <td key={p} className="p-2">
                        {l ? <span className="flex items-center gap-2">{l.external_url ? <a className="text-brand-700 underline" href={l.external_url} target="_blank" rel="noreferrer">{l.external_name ?? l.external_id}</a> : (l.external_name ?? l.external_id)}
                          <button className="text-xs text-rose-600" onClick={() => act({ action: "unlink", id: l.id }, () => "Unlinked.")}>unlink</button></span>
                          : courses[p] ? (
                            <select className="input" defaultValue="" onChange={e => { const x = courses[p]!.find(k => k.id === e.target.value); if (x) act({ action: "link_class", provider: p, class_group_id: c.class_group_id, subject_id: c.subject_id, external_id: x.id, external_name: x.name, external_url: x.url }, () => "Linked."); }}>
                              <option value="">Choose…</option>{courses[p]!.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                            </select>
                          ) : <span className="text-xs text-slate-400">press “Show my {p === "google" ? "courses" : "classes"}”</span>}
                      </td>);
                  })}
                </tr>))}</tbody></table></div>
          )}
        </section>
      )}

      {provs.some(p => connected(p)) && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">Homework</h2>
          {!data.homework.length ? <Empty>No recent homework for your classes.</Empty> : (
            <ul className="space-y-2">{data.homework.map(h => (
              <li key={h.id} className="card flex flex-wrap items-center gap-2 p-3 text-sm">
                <span className="font-medium">{h.title}</span><span className="text-xs text-slate-500">{h.class_groups?.name}{h.subjects ? ` · ${h.subjects.name}` : ""} · due {fmtDate(h.due_at, true)}</span>
                <span className="ml-auto flex flex-wrap gap-2">
                  {provs.filter(p => connected(p)).map(p => { const ext = h.homework_external.find(x => x.provider === p); return ext ? (
                    <span key={p} className="flex items-center gap-2 text-xs">
                      {ext.external_url ? <a className="text-brand-700 underline" href={ext.external_url} target="_blank" rel="noreferrer">On {NAME[p]}</a> : `On ${NAME[p]}`}
                      <button className="btn btn-outline px-2 py-1 text-xs" disabled={busy === `${h.id}${p}`} onClick={() => act({ action: "pull_grades", provider: p, homework_id: h.id },
                        d => `${d.saved} mark${d.saved === 1 ? "" : "s"} brought back${d.kept ? `, ${d.kept} left as another teacher marked them` : ""}${d.unmatched?.length ? `; no student found for ${d.unmatched.join(", ")}` : ""}.`, `${h.id}${p}`)}>
                        {busy === `${h.id}${p}` ? "Fetching…" : ext.grades_pulled_at ? "Fetch marks again" : "Bring marks back"}</button>
                    </span>) : (
                    <button key={p} className="btn btn-outline px-2 py-1 text-xs" disabled={busy === `${h.id}${p}`} onClick={() => act({ action: "push_homework", provider: p, homework_id: h.id }, () => `Sent to ${NAME[p]}.`, `${h.id}${p}`)}>Send to {NAME[p]}</button>); })}
                </span>
              </li>))}</ul>
          )}
          <p className="mt-2 text-xs text-slate-500">Marks are matched to students by their school email address. Marks another teacher entered are left alone.</p>
        </section>
      )}

      {connected("microsoft") && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">Lesson notes to OneNote</h2>
          {!data.notes.length ? <Empty>You have no lesson notes yet.</Empty> : (
            <ul className="card divide-y divide-slate-100">{data.notes.map(n => (
              <li key={n.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <span className="flex-1">{n.topic}<span className="text-xs text-slate-500">{[n.subjects?.name, n.class_groups?.name, n.week ? `week ${n.week}` : null].filter(Boolean).map(x => ` · ${x}`).join("")}</span></span>
                {n.onenote_url && <a className="text-xs text-brand-700 underline" href={n.onenote_url} target="_blank" rel="noreferrer">Open in OneNote</a>}
                <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "onenote", lesson_note_id: n.id }, () => "Sent to your OneNote.")}>{n.onenote_url ? "Send again" : "Send to OneNote"}</button>
              </li>))}</ul>
          )}
        </section>
      )}
    </Page>
  );
}
