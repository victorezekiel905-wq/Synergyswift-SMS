"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Field, Badge, Modal, fmtDate } from "@/components/ui";
import { ClassPicker } from "@/components/learning/ContentLibrary";

type Opt = { id: string; name: string };
type Lesson = { id: string; title: string; provider: string; join_url?: string; passcode: string | null; starts_at: string; duration_min: number; status: string; created_by: string;
  window: "upcoming" | "open" | "ended"; class_groups: { name: string } | null; subjects: { name: string } | null };
export const PROVIDER: Record<string, string> = { zoom: "Zoom", meet: "Google Meet", teams: "Microsoft Teams", other: "Online" };

/** Staff: schedule Zoom, Google Meet or Teams lessons for classes and see who joined. */
export default function OnlineLessons({ classes, subjects }: { classes: Opt[]; subjects: Opt[] }) {
  const [past, setPast] = useState(false);
  const { data, reload } = useApi<{ items: Lesson[]; zoom: { connected: boolean; own: boolean }; admin: boolean; me: string }>(`/api/online-lessons${past ? "?past=1" : ""}`, [past]);
  const [f, setF] = useState({ class_group_ids: [] as string[], subject_id: "", title: "", date: "", time: "", duration_min: 40, use_zoom: false, join_url: "", passcode: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [joins, setJoins] = useState<string | null>(null);
  const [zoomForm, setZoomForm] = useState(false);
  const act = async (b: Record<string, unknown>, ok: string) => { const r = await send("/api/online-lessons", b); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) reload(); return r.ok; };
  return (
    <div className="space-y-4 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <form className="card grid gap-2 p-4 sm:grid-cols-4" onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        const ok = await act({ action: "create", class_group_ids: f.class_group_ids, subject_id: f.subject_id || null, title: f.title, starts_at: new Date(`${f.date}T${f.time}`).toISOString(),
          duration_min: Number(f.duration_min), use_zoom: f.use_zoom, join_url: f.use_zoom ? null : f.join_url, passcode: f.passcode || null }, "Scheduled. Students see it on My learning, and can join from 15 minutes before.");
        setBusy(false);
        if (ok) setF({ ...f, title: "", join_url: "", passcode: "" });
      }}>
        <h2 className="font-semibold sm:col-span-4">Schedule an online lesson</h2>
        <div className="sm:col-span-2"><Field label="Title"><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required minLength={2} maxLength={160} /></Field></div>
        <Field label="Subject"><select className="input" value={f.subject_id} onChange={e => setF({ ...f, subject_id: e.target.value })}><option value="">—</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Minutes"><input className="input" type="number" min={5} max={600} value={f.duration_min} onChange={e => setF({ ...f, duration_min: Number(e.target.value) })} /></Field>
        <Field label="Date"><input className="input" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} required /></Field>
        <Field label="Start"><input className="input" type="time" value={f.time} onChange={e => setF({ ...f, time: e.target.value })} required /></Field>
        <div className="sm:col-span-2"><Field label="Classes"><ClassPicker classes={classes} value={f.class_group_ids} onChange={v => setF({ ...f, class_group_ids: v })} /></Field></div>
        <div className="space-y-2 sm:col-span-4">
          {data?.zoom.connected && <label className="flex items-center gap-2"><input type="checkbox" checked={f.use_zoom} onChange={e => setF({ ...f, use_zoom: e.target.checked })} /> Create the Zoom meeting for me (waiting room on, students muted on entry)</label>}
          {!f.use_zoom && <div className="grid gap-2 sm:grid-cols-4"><div className="sm:col-span-3"><Field label="Meeting link from Zoom, Google Meet or Teams"><input className="input" type="url" value={f.join_url} onChange={e => setF({ ...f, join_url: e.target.value })} required placeholder="https://meet.google.com/…" /></Field></div>
            <Field label="Passcode (if any)"><input className="input" value={f.passcode} onChange={e => setF({ ...f, passcode: e.target.value })} maxLength={60} /></Field></div>}
        </div>
        <div className="sm:col-span-4"><button className="btn btn-primary" disabled={busy || !f.class_group_ids.length}>{busy ? "Scheduling…" : "Schedule"}</button></div>
      </form>

      <section className="card space-y-2 p-4">
        <div className="flex items-center gap-2"><h2 className="mr-auto font-semibold">{past ? "Past lessons (60 days)" : "Coming up"}</h2>
          <button className="text-xs text-brand-700" onClick={() => setPast(!past)}>{past ? "Show coming up" : "Show past lessons"}</button></div>
        {!data ? null : !data.items.length ? <Empty>Nothing here.</Empty> : (
          <ul className="divide-y divide-slate-100">{data.items.map(l => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="mr-auto"><b>{l.title}</b> <Badge tone="blue">{PROVIDER[l.provider]}</Badge>{l.status === "cancelled" && <Badge tone="red">cancelled</Badge>}
                <span className="block text-xs text-slate-500">{l.class_groups?.name}{l.subjects ? ` · ${l.subjects.name}` : ""} · {fmtDate(l.starts_at, true)} · {l.duration_min} min{l.passcode ? ` · passcode ${l.passcode}` : ""}</span></div>
              {l.status !== "cancelled" && l.window !== "ended" && <a className="btn btn-primary px-2 py-1 text-xs" href={`/api/online-lessons/join?id=${l.id}`} target="_blank" rel="noreferrer">{l.created_by === data.me && l.provider === "zoom" ? "Start" : "Open"}</a>}
              <button className="text-xs text-brand-700" onClick={() => setJoins(l.id)}>Who joined</button>
              {l.status !== "cancelled" && l.window !== "ended" && (l.created_by === data.me || data.admin) && <button className="text-xs text-rose-600" onClick={() => confirm("Cancel this lesson?") && act({ action: "cancel", id: l.id }, "Cancelled.")}>Cancel</button>}
            </li>))}</ul>
        )}
      </section>

      {data?.admin && (
        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Zoom</h2>
          <p className="text-slate-600">{data.zoom.connected ? (data.zoom.own ? "Connected to your school's Zoom account." : "Using the platform's Zoom account.") : "Not connected. Teachers can still paste meeting links."}</p>
          {!zoomForm ? <div className="flex gap-2"><button className="btn btn-outline" onClick={() => setZoomForm(true)}>{data.zoom.own ? "Change Zoom account" : "Connect your Zoom account"}</button>
            {data.zoom.own && <button className="btn btn-ghost text-rose-600" onClick={() => confirm("Disconnect Zoom?") && act({ action: "zoom_disconnect" }, "Disconnected.")}>Disconnect</button>}</div>
            : <ZoomForm onDone={ok => { setZoomForm(false); if (ok) { setMsg({ ok: true, text: "Zoom connected." }); reload(); } }} />}
        </section>
      )}
      <Modal open={Boolean(joins)} onClose={() => setJoins(null)} title="Who joined">{joins && <Joins id={joins} />}</Modal>
    </div>
  );
}

function ZoomForm({ onDone }: { onDone: (ok: boolean) => void }) {
  const [f, setF] = useState({ account_id: "", client_id: "", client_secret: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="grid gap-2 sm:grid-cols-3" onSubmit={async e => { e.preventDefault(); const r = await send("/api/online-lessons", { action: "zoom_keys", ...f }); if (!r.ok) return setErr(r.error); onDone(true); }}>
      <p className="text-xs text-slate-500 sm:col-span-3">In the Zoom App Marketplace, create a <b>Server-to-Server OAuth</b> app with the scopes <code>meeting:write:meeting:admin</code> and <code>meeting:read:meeting:admin</code> (or <code>meeting:write:admin</code>), then copy its three keys here. They are checked with Zoom and kept on the server only.</p>
      {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
      <Field label="Account ID"><input className="input" value={f.account_id} onChange={e => setF({ ...f, account_id: e.target.value })} required /></Field>
      <Field label="Client ID"><input className="input" value={f.client_id} onChange={e => setF({ ...f, client_id: e.target.value })} required /></Field>
      <Field label="Client secret"><input className="input" type="password" value={f.client_secret} onChange={e => setF({ ...f, client_secret: e.target.value })} required autoComplete="off" /></Field>
      <div className="flex gap-2 sm:col-span-3"><button className="btn btn-primary">Check and save</button><button type="button" className="btn btn-ghost" onClick={() => onDone(false)}>Cancel</button></div>
    </form>
  );
}

function Joins({ id }: { id: string }) {
  const { data } = useApi<{ students: { id: string; first_name: string; last_name: string }[]; joins: { student_id: string; joined_at: string }[] }>(`/api/online-lessons?id=${id}`);
  if (!data) return null;
  const at = new Map(data.joins.map(j => [j.student_id, j.joined_at]));
  return (
    <div className="text-sm">
      <p className="mb-2">{at.size} of {data.students.length} joined through the app.</p>
      <ul className="grid gap-1 sm:grid-cols-2">{data.students.map(s => <li key={s.id} className={at.has(s.id) ? "" : "text-slate-400"}>{at.has(s.id) ? "✓" : "·"} {s.first_name} {s.last_name}{at.has(s.id) && <span className="text-xs text-slate-500"> {fmtDate(at.get(s.id)!, true)}</span>}</li>)}</ul>
    </div>
  );
}
