"use client";
import { useEffect, useRef, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Field, Loading, Empty, Tabs, Icon, fmtDate } from "@/components/ui";
import { makeGroups } from "@/lib/classroom";

type Cls = { id: string; name: string; level: string | null; form: boolean; subjects: string[] };
type Student = { id: string; first_name: string; last_name: string; photo_url: string | null; week: number; today: number };
type Skill = { id: string; name: string; kind: "positive" | "needs_work"; points: number; icon: string; active: boolean; position: number };
type Board = { students: Student[]; skills: Skill[]; all_skills?: Skill[]; recent: { id: string; student_id: string; skill_name: string; points: number; batch_id: string; given_by: string; created_at: string }[]; class_week: number; positive_share: number | null; allow_needs_work: boolean; me: string };
type Post = { id: string; body: string | null; author: string; created_at: string; photos: string[]; likes: number; liked: boolean; can_delete: boolean };

const ICON_OK = new Set(["star", "hand", "flame", "people", "medal", "cap", "alert", "note", "x", "check", "chat", "chart", "send", "party", "moon"]);

/** Classroom: points for skills, the class story for parents, and class tools. */
export default function ClassroomPage() {
  const { data: mine } = useApi<{ classes: Cls[] }>("/api/classroom");
  const [cls, setCls] = useState<string>("");
  const [tab, setTab] = useState<"points" | "story" | "tools" | "targets">("points");
  useEffect(() => { if (!cls && mine?.classes?.length) setCls(mine.classes[0].id); }, [mine, cls]);
  if (!mine) return <Page><Loading /></Page>;
  const current = mine.classes.find(c => c.id === cls);
  return (
    <Page wide>
      <PageHeader eyebrow="Teaching" title="Classroom" subtitle="Give points for skills, share the class story with parents, and run the class with simple tools."
        actions={mine.classes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {cls && <SebLock key={cls} classId={cls} />}
            <select className="input w-auto" value={cls} onChange={e => setCls(e.target.value)} aria-label="Class">
              {mine.classes.map(c => <option key={c.id} value={c.id}>{c.name}{c.form ? " (form class)" : ""}</option>)}
            </select>
          </div>
        )} />
      {!mine.classes.length ? <Empty>You have no classes yet. A school admin adds you to classes under Class teams &amp; accounts.</Empty> : (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: "points", label: "Points" }, { id: "story", label: "Class story" }, { id: "tools", label: "Class tools" }, { id: "targets", label: "Class targets" }]} />
          {cls && tab === "points" && <PointsBoard key={cls} classId={cls} />}
          {cls && tab === "story" && <Story key={cls} classId={cls} className={current?.name ?? ""} />}
          {cls && tab === "tools" && <Tools key={cls} classId={cls} />}
          {cls && tab === "targets" && <ClassTargets key={cls} classId={cls} />}
        </>
      )}
    </Page>
  );
}

/** Class-wide Safe Exam Browser lock for live lessons: every new lesson in the class starts locked. */
function SebLock({ classId }: { classId: string }) {
  const { data, reload } = useApi<{ available: boolean; require_seb: boolean }>(`/api/swift/seb/class?class_id=${classId}`, [classId]);
  const [err, setErr] = useState<string | null>(null);
  if (!data?.available) return null;
  const on = data.require_seb;
  return (
    <span className="flex items-center gap-2 text-sm" title={err ?? "When locked, students can only join this class's live lessons in Safe Exam Browser."}>
      <span className="text-slate-600">Live lessons</span>
      <button type="button" role="switch" aria-checked={on} onClick={async () => { const r = await send("/api/swift/seb/class", { class_id: classId, on: !on }); setErr(r.ok ? null : r.error); reload(); }}
        className={"rounded-full border px-3 py-1 text-xs font-semibold " + (on ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white text-slate-700")}>
        {on ? "Locked to Safe Exam Browser" : "Unlocked"}
      </button>
    </span>
  );
}

function Avatar({ s, size = "h-12 w-12" }: { s: { first_name: string; last_name: string; photo_url: string | null }; size?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return s.photo_url ? <img src={s.photo_url} alt="" className={`${size} rounded-full object-cover`} />
    : <span className={`${size} grid place-items-center rounded-full bg-brand-50 font-semibold text-brand-800`}>{s.first_name[0]}{s.last_name[0]}</span>;
}

function PointsBoard({ classId }: { classId: string }) {
  const { data, reload } = useApi<Board>(`/api/classroom?class_group_id=${classId}`, [classId]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ text: string; batch: string; good: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (!data) return <Loading />;
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const give = async (skill: Skill) => {
    if (!picked.size) return setErr("Choose one or more students first (or Whole class).");
    setErr(null);
    const r = await send<{ batch_id: string; given: number; points: number; skill: string }>("/api/classroom", { action: "give", class_group_id: classId, student_ids: [...picked], skill_id: skill.id, note: note || null });
    if (!r.ok) return setErr(r.error);
    const names = data.students.filter(s => picked.has(s.id)).map(s => s.first_name);
    setToast({ text: `${skill.points > 0 ? "+" : ""}${skill.points} ${skill.name} for ${names.length > 3 ? `${names.length} students` : names.join(", ")}`, batch: r.data.batch_id, good: skill.points > 0 });
    setPicked(new Set()); setNote(""); reload();
  };
  const undo = async () => { if (!toast) return; const r = await send("/api/classroom", { action: "undo", batch_id: toast.batch }); setToast(null); if (!r.ok) setErr(r.error); reload(); };
  const positive = data.skills.filter(k => k.kind === "positive"), needs = data.skills.filter(k => k.kind === "needs_work");
  return (
    <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <button className="btn btn-outline px-3 py-1" onClick={() => setPicked(new Set(data.students.map(s => s.id)))}>Whole class</button>
          <button className="btn btn-ghost px-3 py-1" onClick={() => { const s = data.students[Math.floor(Math.random() * data.students.length)]; if (s) setPicked(new Set([s.id])); }}>Random student</button>
          {picked.size > 0 && <button className="btn btn-ghost px-3 py-1" onClick={() => setPicked(new Set())}>Clear ({picked.size})</button>}
          <span className="ml-auto text-slate-600">Class this week: <b className={data.class_week >= 0 ? "text-emerald-700" : "text-rose-700"}>{data.class_week > 0 ? "+" : ""}{data.class_week}</b>{data.positive_share !== null && <> · {data.positive_share}% positive</>}</span>
        </div>
        {!data.students.length ? <Empty>No students in this class.</Empty> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 2xl:grid-cols-6">
            {data.students.map(s => {
              const on = picked.has(s.id);
              return (
                <button key={s.id} type="button" onClick={() => toggle(s.id)} aria-pressed={on}
                  className={"flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition " + (on ? "border-brand-600 bg-brand-50 ring-2 ring-brand-600" : "border-slate-200 bg-white hover:border-slate-300")}>
                  <Avatar s={s} />
                  <span className="text-sm font-medium leading-tight">{s.first_name}<br /><span className="text-xs font-normal text-slate-500">{s.last_name}</span></span>
                  <span className={"rounded-full px-2 text-xs font-semibold tabular-nums " + (s.week > 0 ? "bg-emerald-50 text-emerald-700" : s.week < 0 ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-500")}>{s.week > 0 ? "+" : ""}{s.week} this week</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      <aside className="space-y-4">
        {err && <Alert>{err}</Alert>}
        {toast && (
          <div className={"flex items-center gap-2 rounded-lg border p-3 text-sm " + (toast.good ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")} role="status">
            <span className="flex-1">{toast.text}</span><button className="font-semibold underline" onClick={undo}>Undo</button>
          </div>
        )}
        <div className="card p-4">
          <p className="mb-2 text-sm font-semibold">Give a point {picked.size ? <span className="font-normal text-slate-500">to {picked.size} selected</span> : null}</p>
          <div className="grid grid-cols-2 gap-2">
            {positive.map(k => (
              <button key={k.id} type="button" onClick={() => give(k)} className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2 py-2 text-left text-sm hover:bg-emerald-100">
                <Icon name={(ICON_OK.has(k.icon) ? k.icon : "star") as "star"} className="h-4 w-4 text-emerald-700" /><span className="flex-1 leading-tight">{k.name}</span><b className="text-emerald-700">+{k.points}</b>
              </button>
            ))}
          </div>
          {data.allow_needs_work && needs.length > 0 && (
            <>
              <p className="mb-2 mt-4 text-sm font-semibold">Needs work</p>
              <div className="grid grid-cols-2 gap-2">
                {needs.map(k => (
                  <button key={k.id} type="button" onClick={() => give(k)} className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-2 py-2 text-left text-sm hover:bg-rose-100">
                    <Icon name={(ICON_OK.has(k.icon) ? k.icon : "alert") as "alert"} className="h-4 w-4 text-rose-700" /><span className="flex-1 leading-tight">{k.name}</span><b className="text-rose-700">{k.points}</b>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="mt-3"><Field label="Note for parents (optional)"><input className="input" maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="Helped a classmate with fractions" /></Field></div>
        </div>
        <div className="card p-4">
          <p className="mb-2 text-sm font-semibold">Recent</p>
          {!data.recent.length ? <p className="text-sm text-slate-500">No points yet this week.</p> : (
            <ul className="space-y-1 text-sm">
              {data.recent.slice(0, 12).map(e => {
                const s = data.students.find(x => x.id === e.student_id);
                return <li key={e.id} className="flex justify-between gap-2"><span>{s ? `${s.first_name} ${s.last_name[0]}.` : "—"} · {e.skill_name}</span><span className={e.points > 0 ? "text-emerald-700" : "text-rose-700"}>{e.points > 0 ? "+" : ""}{e.points}</span></li>;
              })}
            </ul>
          )}
        </div>
        {data.all_skills && <SkillsAdmin skills={data.all_skills} allowNeedsWork={data.allow_needs_work} onSaved={reload} />}
      </aside>
    </div>
  );
}

function SkillsAdmin({ skills, allowNeedsWork, onSaved }: { skills: Skill[]; allowNeedsWork: boolean; onSaved: () => void }) {
  const [f, setF] = useState({ name: "", kind: "positive" as "positive" | "needs_work", points: 1 });
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <details className="card p-4 text-sm">
      <summary className="cursor-pointer font-semibold">School skills (admins)</summary>
      <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={allowNeedsWork} onChange={async e => { await send("/api/classroom", { action: "settings", points_allow_needs_work: e.target.checked }); onSaved(); }} /> Allow &ldquo;needs work&rdquo; points</label>
      <ul className="mt-3 space-y-1">
        {skills.map(k => (
          <li key={k.id} className="flex items-center gap-2">
            <span className={"flex-1 " + (k.active ? "" : "text-slate-400 line-through")}>{k.name} <span className={k.points > 0 ? "text-emerald-700" : "text-rose-700"}>{k.points > 0 ? "+" : ""}{k.points}</span></span>
            <button className="text-xs text-brand-700 hover:underline" onClick={async () => { await send("/api/classroom", { action: "skill", id: k.id, name: k.name, kind: k.kind, points: k.points, icon: k.icon, active: !k.active }); onSaved(); }}>{k.active ? "Hide" : "Show"}</button>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-[1fr_auto_70px] gap-2">
        <input className="input py-1" placeholder="New skill" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        <select className="input w-auto py-1" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as "positive", points: e.target.value === "positive" ? 1 : -1 })}><option value="positive">Positive</option><option value="needs_work">Needs work</option></select>
        <input className="input py-1" type="number" min={f.kind === "positive" ? 1 : -5} max={f.kind === "positive" ? 5 : -1} value={f.points} onChange={e => setF({ ...f, points: Number(e.target.value) })} />
      </div>
      <button className="btn btn-outline mt-2 px-3 py-1" onClick={async () => { const r = await send("/api/classroom", { action: "skill", ...f, icon: f.kind === "positive" ? "star" : "alert" }); setMsg(r.ok ? "Added." : r.error); if (r.ok) { setF({ name: "", kind: "positive", points: 1 }); onSaved(); } }}>Add skill</button>
      {msg && <p className="mt-1 text-xs text-slate-600">{msg}</p>}
    </details>
  );
}

function Story({ classId, className }: { classId: string; className: string }) {
  const { data, reload } = useApi<{ posts: Post[] }>(`/api/classroom/story?class_group_id=${classId}`, [classId]);
  const { data: board } = useApi<Board>(`/api/classroom?class_group_id=${classId}`, [classId]);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [tagged, setTagged] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  async function post() {
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.set("class_group_id", classId); fd.set("body", body);
    files.forEach(f => fd.append("photos", f)); tagged.forEach(t => fd.append("tagged", t));
    const r = await fetch("/api/classroom/story", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Could not post.");
    setBody(""); setFiles([]); setTagged(new Set()); if (fileRef.current) fileRef.current.value = ""; reload();
  }
  return (
    <div className="mt-4 grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
      <section className="card h-fit space-y-3 p-4">
        <p className="font-semibold">Share with {className} parents</p>
        <textarea className="input h-28" maxLength={2000} value={body} onChange={e => setBody(e.target.value)} placeholder="What did the class do today?" />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" multiple onChange={e => setFiles([...(e.target.files ?? [])].slice(0, 6))} className="text-sm" aria-label="Photos" />
        {files.length > 0 && board && (
          <div>
            <p className="mb-1 text-xs text-slate-600">Tick every child in the photos. Only children whose parents agreed to photos can be shown.</p>
            <div className="flex max-h-40 flex-wrap gap-1 overflow-auto">
              {board.students.map(s => <button key={s.id} type="button" onClick={() => setTagged(t => { const n = new Set(t); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}
                className={"rounded-full border px-2 py-0.5 text-xs " + (tagged.has(s.id) ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300")}>{s.first_name} {s.last_name[0]}.</button>)}
            </div>
          </div>
        )}
        {err && <Alert>{err}</Alert>}
        <button className="btn btn-primary" disabled={busy || (!body.trim() && !files.length)} onClick={post}>{busy ? "Posting…" : "Post"}</button>
      </section>
      <section className="space-y-3">
        {!data ? <Loading /> : !data.posts.length ? <Empty>No posts yet. Parents see posts on their phone the moment you share them.</Empty> : data.posts.map(p => (
          <article key={p.id} className="card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm"><b>{p.author}</b><span className="text-slate-500">{fmtDate(p.created_at)}</span>
              {p.can_delete && <button className="ml-auto text-xs text-rose-700 hover:underline" onClick={async () => { await send(`/api/classroom/story?id=${p.id}`, undefined, "DELETE"); reload(); }}>Delete</button>}</div>
            {p.body && <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{p.body}</p>}
            {p.photos.length > 0 && <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">{p.photos.map((u, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={u} alt="" className="aspect-square w-full rounded-lg object-cover" />
            ))}</div>}
            <p className="mt-2 text-xs text-slate-500">{p.likes} {p.likes === 1 ? "like" : "likes"}</p>
          </article>
        ))}
      </section>
    </div>
  );
}

function Tools({ classId }: { classId: string }) {
  const { data } = useApi<Board>(`/api/classroom?class_group_id=${classId}`, [classId]);
  const [pick, setPick] = useState<Student | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [n, setN] = useState(4);
  const [groups, setGroups] = useState<Student[][]>([]);
  if (!data) return <Loading />;
  const spin = () => {
    if (!data.students.length) return;
    setSpinning(true);
    let k = 0;
    const t = setInterval(() => {
      setPick(data.students[Math.floor(Math.random() * data.students.length)]);
      if (++k > 14) { clearInterval(t); setSpinning(false); }
    }, 70);
  };
  return (
    <div className="mt-4 grid gap-5 lg:grid-cols-2">
      <section className="card p-5 text-center">
        <p className="mb-3 font-semibold">Random student</p>
        <div className="mx-auto mb-3 grid h-32 place-items-center">{pick ? <div className="flex flex-col items-center gap-2"><Avatar s={pick} size="h-16 w-16" /><span className={"text-2xl font-semibold " + (spinning ? "text-slate-400" : "")}>{pick.first_name} {pick.last_name}</span></div> : <span className="text-slate-400">Press the button</span>}</div>
        <button className="btn btn-primary" onClick={spin} disabled={spinning}>Pick someone</button>
      </section>
      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2"><p className="flex-1 font-semibold">Group maker</p>
          <label className="text-sm">Groups <input className="input ml-1 inline w-16 py-1" type="number" min={2} max={20} value={n} onChange={e => setN(Number(e.target.value))} /></label>
          <button className="btn btn-outline px-3 py-1" onClick={() => setGroups(makeGroups(data.students, n))}>Make groups</button></div>
        <div className="grid gap-2 sm:grid-cols-2">{groups.map((g, i) => <div key={i} className="rounded-lg border border-slate-200 p-2 text-sm"><p className="mb-1 font-semibold">Group {i + 1}</p>{g.map(s => <p key={s.id}>{s.first_name} {s.last_name}</p>)}</div>)}</div>
      </section>
      <Timer />
      <NoiseMeter />
    </div>
  );
}

function Timer() {
  const [secs, setSecs] = useState(300);
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (left === null || left <= 0) return;
    const t = setTimeout(() => setLeft(l => (l === null ? null : l - 1)), 1000);
    return () => clearTimeout(t);
  }, [left]);
  const show = left ?? secs;
  return (
    <section className="card p-5 text-center">
      <p className="mb-2 font-semibold">Timer</p>
      <p className={"font-mono text-6xl font-bold tabular-nums " + (left === 0 ? "text-rose-600" : "")}>{String(Math.floor(show / 60)).padStart(2, "0")}:{String(show % 60).padStart(2, "0")}</p>
      {left === 0 && <p className="mt-1 font-semibold text-rose-600">Time is up</p>}
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {[60, 180, 300, 600].map(s => <button key={s} className="btn btn-ghost border border-slate-200 px-3 py-1" onClick={() => { setSecs(s); setLeft(null); }}>{s / 60} min</button>)}
        <button className="btn btn-primary px-4 py-1" onClick={() => setLeft(left && left > 0 ? null : secs)}>{left && left > 0 ? "Stop" : "Start"}</button>
      </div>
    </section>
  );
}

function NoiseMeter() {
  const [level, setLevel] = useState(0);
  const [on, setOn] = useState(false);
  const [limit, setLimit] = useState(60);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ac = new AudioContext();
      const an = ac.createAnalyser(); an.fftSize = 512;
      ac.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let raf = 0;
      const tick = () => { an.getByteTimeDomainData(buf); let sum = 0; for (const v of buf) sum += (v - 128) ** 2; setLevel(Math.min(100, Math.round(Math.sqrt(sum / buf.length) * 4))); raf = requestAnimationFrame(tick); };
      tick();
      stop.current = () => { cancelAnimationFrame(raf); stream.getTracks().forEach(t => t.stop()); ac.close(); };
      setOn(true);
    } catch { alert("Allow the microphone to use the noise meter."); }
  }
  const loud = level > limit;
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center gap-2"><p className="flex-1 font-semibold">Noise meter</p>
        <button className="btn btn-outline px-3 py-1" onClick={() => { if (on) { stop.current?.(); setOn(false); setLevel(0); } else start(); }}>{on ? "Stop" : "Start"}</button></div>
      <div className="h-8 overflow-hidden rounded-full bg-slate-100"><div className={"h-full transition-all " + (loud ? "bg-rose-500" : level > limit * 0.7 ? "bg-amber-400" : "bg-emerald-500")} style={{ width: `${level}%` }} /></div>
      <p className={"mt-2 text-center text-lg font-semibold " + (loud ? "text-rose-600" : "text-emerald-700")}>{on ? (loud ? "Too loud" : "Good working noise") : "Off"}</p>
      <label className="mt-2 flex items-center gap-2 text-sm">Limit <input type="range" min={20} max={95} value={limit} onChange={e => setLimit(Number(e.target.value))} className="flex-1" /></label>
      <p className="mt-1 text-xs text-slate-500">Sound is measured on this device only. Nothing is recorded or sent.</p>
    </section>
  );
}

type ClassTarget = { id: string; kind: string; target: number | null; description: string | null; created_at: string; terms: { name: string } | null };
const CLASS_KIND: Record<string, string> = { average: "Class average", attendance: "Attendance %", pass_rate: "Pass rate %", other: "Other goal" };

/** Targets for the whole class (phase 14o): students and parents of the class see them too. */
function ClassTargets({ classId }: { classId: string }) {
  const { data, reload } = useApi<{ targets: ClassTarget[] }>(`/api/targets?class=${classId}`, [classId]);
  const [t, setT] = useState({ kind: "average", target: "65", description: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-3 text-sm">
      <form className="card grid gap-2 p-3 sm:grid-cols-5" onSubmit={async e => {
        e.preventDefault();
        const r = await send("/api/targets", { action: "class", class_group_id: classId, kind: t.kind, target: t.kind === "other" ? null : Number(t.target), description: t.description || null });
        setErr(r.ok ? null : r.error);
        if (r.ok) { setT({ ...t, description: "" }); reload(); }
      }}>
        <select className="input" value={t.kind} onChange={e => setT({ ...t, kind: e.target.value })} aria-label="Target">{Object.entries(CLASS_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {t.kind !== "other" && <input className="input" type="number" min={0} max={100} value={t.target} onChange={e => setT({ ...t, target: e.target.value })} aria-label="Target figure" />}
        <input className="input sm:col-span-2" value={t.description} onChange={e => setT({ ...t, description: e.target.value })} placeholder="e.g. Everyone reads for 20 minutes a day" maxLength={300} aria-label="Note" />
        <button className="btn btn-primary">Set target</button>
      </form>
      {err && <Alert>{err}</Alert>}
      {!data?.targets.length ? <Empty>No class targets yet.</Empty> : <ul className="space-y-2">{data.targets.map(x => (
        <li key={x.id} className="card flex flex-wrap items-center gap-2 p-3"><b className="mr-auto">{CLASS_KIND[x.kind] ?? x.kind}{x.target !== null ? `: ${x.target}` : ""}{x.description ? <span className="font-normal text-slate-600"> · {x.description}</span> : null}</b>
          <span className="text-xs text-slate-500">{fmtDate(x.created_at)}</span>
          <button className="text-xs text-rose-600" onClick={async () => { await send("/api/targets", { action: "delete", id: x.id, class: true }); reload(); }}>Remove</button></li>))}</ul>}
    </div>
  );
}
