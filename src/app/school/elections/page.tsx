"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Empty, Loading, Badge, Modal, Field, Stat, fmtDate } from "@/components/ui";
import { CandidateFace, ElectionResults, type Results } from "@/components/elections/Ballot";

type Election = { id: string; title: string; kind: string; description: string | null; audience: "students" | "parents" | "staff" | "everyone"; class_group_ids: string[] | null;
  one_per_family: boolean; allow_kiosk: boolean; live_results: boolean; publish_to_voters: boolean; status: "draft" | "open" | "closed" | "published"; opens_at: string | null; closes_at: string | null };
type Row = Election & { election_posts: { count: number }[]; election_candidates: { count: number }[] };
type Post = { id: string; title: string; description: string | null; seats: number; position: number };
type Cand = { id: string; post_id: string; name: string; student_id: string | null; photo_url: string | null; manifesto: string | null; position: number };
type Turnout = { eligible: number; voted: number; online: number; kiosk: number; by_class: { class: string; voted: number }[] };
type Detail = { election: Election; posts: Post[]; candidates: Cand[]; turnout: Turnout | null; results: Results | null; officer: boolean };

const KIND: Record<string, string> = { prefects: "Prefects", pta: "PTA", class_rep: "Class representatives", house: "House captains", staff: "Staff", other: "Other" };
const WHO: Record<string, string> = { students: "Students", parents: "Parents", staff: "Staff", everyone: "Everyone" };
const STATUS: Record<string, { label: string; tone: "slate" | "green" | "amber" | "blue" }> = {
  draft: { label: "Draft", tone: "slate" }, open: { label: "Voting", tone: "green" }, closed: { label: "Closed", tone: "amber" }, published: { label: "Published", tone: "blue" } };
const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");
const toIso = (v: string) => (v ? new Date(v).toISOString() : null);

/** Elections & voting (phase 14f): officers run elections; teachers open a voting tablet for their class. */
export default function ElectionsPage() {
  const { data, error, reload } = useApi<{ elections: Row[]; classes: { id: string; name: string }[]; officer: boolean }>("/api/elections");
  const [id, setId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Election> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (!id && data?.elections.length) setId(data.elections[0]!.id); }, [data, id]);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  return (
    <Page wide>
      <PageHeader eyebrow="Students & welfare" title="Elections & voting"
        subtitle="Prefects, PTA, class reps and more: a secret ballot, one vote each, voting online or on a teacher's tablet, live turnout and results you publish when ready." />
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-2">
          {data.officer && <button className="btn btn-primary w-full" onClick={() => setEdit({ kind: "prefects", audience: "students", allow_kiosk: true, publish_to_voters: true })}>+ New election</button>}
          {!data.elections.length ? <Empty>No elections yet.</Empty> : data.elections.map(e => (
            <button key={e.id} onClick={() => { setId(e.id); setMsg(null); }} className={"card block w-full p-3 text-left " + (e.id === id ? "ring-2 ring-brand-600" : "hover:border-slate-400")}>
              <span className="flex items-start justify-between gap-2"><span className="font-semibold">{e.title}</span><Badge tone={STATUS[e.status]!.tone}>{STATUS[e.status]!.label}</Badge></span>
              <span className="mt-1 block text-xs text-slate-500">{KIND[e.kind]} · {WHO[e.audience]} · {e.election_posts[0]?.count ?? 0} posts, {e.election_candidates[0]?.count ?? 0} candidates</span>
            </button>))}
          <Link href="/vote" className="block text-center text-sm text-brand-700 underline">Elections I can vote in</Link>
        </aside>
        <div>{id ? <ElectionDetail key={id} id={id} classes={data.classes} onEdit={setEdit} onChanged={(text, ok = true) => { setMsg({ ok, text }); reload(); }} /> : <Empty>Choose an election.</Empty>}</div>
      </div>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit election" : "New election"} wide>
        {edit && <ElectionForm e={edit} classes={data.classes} onCancel={() => setEdit(null)} onSaved={(saved, text) => { setEdit(null); setId(saved.id); setMsg({ ok: true, text }); reload(); }} />}
      </Modal>
    </Page>
  );
}

function ElectionDetail({ id, classes, onEdit, onChanged }: { id: string; classes: { id: string; name: string }[]; onEdit: (e: Election) => void; onChanged: (text: string, ok?: boolean) => void }) {
  const { data, error, reload } = useApi<Detail>(`/api/elections?id=${id}`, [id]);
  const [post, setPost] = useState<Partial<Post> | null>(null);
  const [cand, setCand] = useState<Partial<Cand> | null>(null);
  const [kioskClass, setKioskClass] = useState("");
  // Live turnout while voting is open.
  useEffect(() => { if (data?.election.status !== "open") return; const t = setInterval(reload, 15000); return () => clearInterval(t); }, [data?.election.status, reload]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const e = data.election;
  const draft = e.status === "draft";
  const act = async (body: Record<string, unknown>, ok: (d: any) => string) => {
    const r = await send("/api/elections", body);
    onChanged(r.ok ? ok(r.data) : r.error ?? "failed", r.ok);
    if (r.ok) reload();
    return r.ok;
  };
  const pct = data.turnout && data.turnout.eligible ? Math.round((data.turnout.voted / data.turnout.eligible) * 100) : null;
  const inScope = classes.filter(c => !e.class_group_ids?.length || e.class_group_ids.includes(c.id));
  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1">
            <p className="text-lg font-semibold">{e.title} <Badge tone={STATUS[e.status]!.tone}>{STATUS[e.status]!.label}</Badge></p>
            <p className="text-sm text-slate-600">{KIND[e.kind]} · voters: {WHO[e.audience]}{e.class_group_ids?.length ? ` in ${e.class_group_ids.length} class${e.class_group_ids.length === 1 ? "" : "es"}` : ", whole school"}{e.one_per_family ? " · one vote per family" : ""}</p>
            <p className="text-xs text-slate-500">{e.opens_at ? `Opens ${fmtDate(e.opens_at, true)}` : "Opens when you open it"} · {e.closes_at ? `closes ${fmtDate(e.closes_at, true)}` : "closes when you close it"}{e.live_results ? " · live results for officers" : ""}</p>
          </div>
          {data.officer && <div className="flex flex-wrap gap-1.5">
            <button className="btn btn-ghost" onClick={() => onEdit(e)}>Edit</button>
            {draft && <button className="btn btn-primary" onClick={() => confirm("Open voting? Voters are told, and the ballot paper can't change once votes are cast.") &&
              act({ action: "open", id: e.id }, d => `Voting is open. ${d.messages_queued ? `${d.messages_queued} message(s) on their way to voters.` : ""}`)}>Open voting</button>}
            {e.status === "open" && <button className="btn btn-primary" onClick={() => confirm("Close voting now?") && act({ action: "close", id: e.id }, () => "Voting closed. Check the results, then publish them.")}>Close voting</button>}
            {e.status === "closed" && <button className="btn btn-primary" onClick={() => confirm(e.publish_to_voters ? "Publish the results to voters?" : "Mark the results as published? (Voters don't see them for this election.)") &&
              act({ action: "publish", id: e.id }, () => "Results published.")}>Publish results</button>}
            {draft && <button className="btn btn-ghost text-rose-700" onClick={() => confirm("Delete this draft election?") && act({ action: "delete", id: e.id }, () => "Deleted.")}>Delete</button>}
          </div>}
        </div>
        {e.status === "open" && e.allow_kiosk && ["students", "everyone"].includes(e.audience) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-3 text-sm">
            <span className="font-medium">Voting tablet:</span>
            <select className="input w-auto py-1" value={kioskClass} onChange={ev => setKioskClass(ev.target.value)} aria-label="Class for the voting tablet">
              <option value="">Choose a class…</option>{inScope.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <Link className={"btn btn-primary py-1 no-underline " + (kioskClass ? "" : "pointer-events-none opacity-50")} href={`/school/elections/${e.id}/kiosk?class=${kioskClass}`}>Open the tablet screen</Link>
            <span className="text-xs text-slate-500">Students vote on your device; you see who has voted, never how.</span>
          </div>
        )}
      </section>

      {data.turnout && e.status !== "draft" && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Can vote" value={data.turnout.eligible} />
          <Stat label="Voted" value={`${data.turnout.voted}${pct !== null ? ` (${pct}%)` : ""}`} tone={pct !== null && pct >= 50 ? "good" : undefined} />
          <Stat label="Online" value={data.turnout.online} />
          <Stat label="On a tablet" value={data.turnout.kiosk} />
        </section>
      )}
      {data.turnout && data.turnout.by_class.length > 0 && (
        <section className="card p-4"><h3 className="font-semibold">Turnout by class</h3>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-3">{data.turnout.by_class.map(c => <li key={c.class} className="flex justify-between rounded bg-slate-50 px-2 py-1"><span>{c.class}</span><b className="tabular-nums">{c.voted}</b></li>)}</ul>
        </section>
      )}

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Ballot paper</h3>
          {data.officer && draft && <button className="btn btn-ghost" onClick={() => setPost({ seats: 1, position: data.posts.length + 1 })}>+ Post</button>}
        </div>
        {!draft && <p className="mt-1 text-xs text-slate-500">The ballot paper is fixed once voting opens.</p>}
        {!data.posts.length ? <p className="mt-2 text-sm text-slate-500">Add the posts (for example, Head girl, 1 seat; Games captains, 2 seats), then their candidates.</p> : (
          <div className="mt-3 space-y-4">{data.posts.map(p => (
            <div key={p.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="flex-1 font-semibold">{p.title} <span className="text-xs font-normal text-slate-500">{p.seats === 1 ? "1 seat" : `${p.seats} seats`}</span></p>
                {data.officer && draft && <>
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setCand({ post_id: p.id, position: data.candidates.filter(c => c.post_id === p.id).length + 1 })}>+ Candidate</button>
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setPost(p)}>Edit</button>
                  <button className="btn btn-ghost px-2 py-1 text-xs text-rose-700" onClick={() => confirm(`Remove ${p.title} and its candidates?`) && act({ action: "delete_post", id: p.id }, () => "Post removed.")}>Remove</button>
                </>}
              </div>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">{data.candidates.filter(c => c.post_id === p.id).map(c => (
                <li key={c.id} className="flex items-center gap-3 rounded-lg bg-slate-50 p-2">
                  <CandidateFace c={c} />
                  <span className="min-w-0 flex-1"><span className="block font-medium">{c.name}</span>{c.manifesto && <span className="line-clamp-1 text-xs text-slate-500">{c.manifesto}</span>}</span>
                  {data.officer && draft && <span className="flex gap-1">
                    <button className="text-xs text-brand-700 underline" onClick={() => setCand(c)}>Edit</button>
                    <button className="text-xs text-rose-700 underline" onClick={() => confirm(`Remove ${c.name}?`) && act({ action: "delete_candidate", id: c.id }, () => "Candidate removed.")}>Remove</button>
                  </span>}
                </li>))}
                {!data.candidates.some(c => c.post_id === p.id) && <li className="text-sm text-amber-700">No candidates yet.</li>}
              </ul>
            </div>))}</div>
        )}
      </section>

      {data.results ? <section><h3 className="mb-2 font-semibold">{e.status === "open" ? "Live results (officers only)" : "Results"}</h3><ElectionResults r={data.results} /></section>
        : e.status !== "draft" && data.officer && <p className="text-sm text-slate-500">Results appear here when voting closes{e.live_results ? "" : " (turn on live results to watch them during voting)"}.</p>}

      <Modal open={Boolean(post)} onClose={() => setPost(null)} title={post?.id ? "Edit post" : "New post"}>
        {post && <PostForm p={post} electionId={e.id} onDone={text => { setPost(null); onChanged(text); reload(); }} />}
      </Modal>
      <Modal open={Boolean(cand)} onClose={() => setCand(null)} title={cand?.id ? "Edit candidate" : "New candidate"}>
        {cand && <CandidateForm c={cand} electionId={e.id} onDone={text => { setCand(null); onChanged(text); reload(); }} />}
      </Modal>
    </div>
  );
}

function ElectionForm({ e, classes, onCancel, onSaved }: { e: Partial<Election>; classes: { id: string; name: string }[]; onCancel: () => void; onSaved: (e: Election, text: string) => void }) {
  const [f, setF] = useState<Partial<Election>>(e);
  const [err, setErr] = useState<string | null>(null);
  const fixed = Boolean(e.id) && e.status !== "draft";
  async function save() {
    setErr(null);
    const r = await send<{ election: Election }>("/api/elections", { action: "save", id: f.id ?? null, title: f.title ?? "", kind: f.kind ?? "other", description: f.description ?? null,
      audience: f.audience ?? "students", class_group_ids: f.class_group_ids ?? null, one_per_family: Boolean(f.one_per_family), allow_kiosk: f.allow_kiosk !== false,
      live_results: Boolean(f.live_results), publish_to_voters: f.publish_to_voters !== false, opens_at: f.opens_at ?? null, closes_at: f.closes_at ?? null });
    if (!r.ok) return setErr(r.error ?? "failed");
    onSaved(r.data.election, e.id ? "Saved." : "Election created. Add its posts and candidates, then open voting.");
  }
  const chosen = new Set(f.class_group_ids ?? []);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title"><input className="input" value={f.title ?? ""} onChange={ev => setF({ ...f, title: ev.target.value })} placeholder="Prefects 2027" /></Field>
        <Field label="Kind"><select className="input" value={f.kind} onChange={ev => setF({ ...f, kind: ev.target.value, ...(ev.target.value === "pta" ? { audience: "parents", one_per_family: true } : {}) })}>
          {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </div>
      <Field label="About this election (optional)"><textarea className="input" rows={3} value={f.description ?? ""} onChange={ev => setF({ ...f, description: ev.target.value })} /></Field>
      <fieldset className="grid gap-3 sm:grid-cols-2" disabled={fixed}>
        <Field label="Who votes" hint={fixed ? "Fixed once voting has started" : undefined}><select className="input" value={f.audience} onChange={ev => setF({ ...f, audience: ev.target.value as Election["audience"] })}>
          {Object.entries(WHO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        {["parents", "everyone"].includes(f.audience ?? "") && <label className="flex items-start gap-2 self-end text-sm"><input type="checkbox" className="mt-0.5" checked={Boolean(f.one_per_family)} onChange={ev => setF({ ...f, one_per_family: ev.target.checked })} />
          <span>One vote per family (the first parent of a family to vote)</span></label>}
        {f.audience !== "staff" && <div className="sm:col-span-2">
          <p className="label">Classes</p><p className="hint">None ticked: the whole school. Parents vote for the classes their children are in.</p>
          <div className="mt-1 flex flex-wrap gap-1.5">{classes.map(c => (
            <label key={c.id} className={"cursor-pointer rounded-full border px-2.5 py-1 text-xs " + (chosen.has(c.id) ? "border-brand-700 bg-brand-50 text-brand-800" : "border-slate-300")}>
              <input type="checkbox" className="sr-only" checked={chosen.has(c.id)} onChange={() => { const n = new Set(chosen); n.has(c.id) ? n.delete(c.id) : n.add(c.id); setF({ ...f, class_group_ids: [...n] }); }} />{c.name}</label>))}</div>
        </div>}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Voting opens (optional)"><input className="input" type="datetime-local" value={local(f.opens_at ?? null)} onChange={ev => setF({ ...f, opens_at: toIso(ev.target.value) })} /></Field>
        <Field label="Voting closes (optional)"><input className="input" type="datetime-local" value={local(f.closes_at ?? null)} onChange={ev => setF({ ...f, closes_at: toIso(ev.target.value) })} /></Field>
      </div>
      <div className="space-y-2 text-sm">
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={f.allow_kiosk !== false} onChange={ev => setF({ ...f, allow_kiosk: ev.target.checked })} /><span>Teachers can run a voting tablet for their class</span></label>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={Boolean(f.live_results)} onChange={ev => setF({ ...f, live_results: ev.target.checked })} /><span>Officers see live results while voting is open</span></label>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={f.publish_to_voters !== false} onChange={ev => setF({ ...f, publish_to_voters: ev.target.checked })} /><span>Voters see the results when you publish them</span></label>
      </div>
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={onCancel}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></div>
    </div>
  );
}

function PostForm({ p, electionId, onDone }: { p: Partial<Post>; electionId: string; onDone: (text: string) => void }) {
  const [f, setF] = useState(p);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Field label="Post"><input className="input" value={f.title ?? ""} onChange={ev => setF({ ...f, title: ev.target.value })} placeholder="Head girl" /></Field>
      <Field label="Seats" hint="How many are elected"><input className="input" type="number" min={1} max={50} value={f.seats ?? 1} onChange={ev => setF({ ...f, seats: Number(ev.target.value) })} /></Field>
      <Field label="Description (optional)"><input className="input" value={f.description ?? ""} onChange={ev => setF({ ...f, description: ev.target.value })} /></Field>
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end"><button className="btn btn-primary" onClick={async () => {
        const r = await send("/api/elections", { action: "save_post", election_id: electionId, id: f.id ?? null, title: f.title ?? "", seats: f.seats ?? 1, description: f.description || null, position: f.position ?? 0 });
        if (!r.ok) return setErr(r.error ?? "failed");
        onDone("Post saved.");
      }}>Save</button></div>
    </div>
  );
}

function CandidateForm({ c, electionId, onDone }: { c: Partial<Cand>; electionId: string; onDone: (text: string) => void }) {
  const [f, setF] = useState(c);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; first_name: string; last_name: string; photo_url: string | null; class_groups: { name: string } | null }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => { fetch(`/api/sims/students?q=${encodeURIComponent(q)}&limit=8`).then(r => r.json()).then(j => setFound(Array.isArray(j) ? j : [])).catch(() => setFound([])); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-3">
      <Field label="Find a student (optional)" hint="Or type any name below (for a parent or member of staff)">
        <input className="input" value={q} onChange={ev => setQ(ev.target.value)} placeholder="Start typing a name" />
      </Field>
      {found.length > 0 && <ul className="max-h-40 overflow-y-auto rounded border border-slate-200 text-sm">{found.map(s => (
        <li key={s.id}><button className="w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => { setF({ ...f, name: `${s.first_name} ${s.last_name}`, student_id: s.id, photo_url: s.photo_url ?? f.photo_url ?? null }); setQ(""); setFound([]); }}>
          {s.first_name} {s.last_name} <span className="text-xs text-slate-500">{s.class_groups?.name ?? ""}</span></button></li>))}</ul>}
      <Field label="Name on the ballot"><input className="input" value={f.name ?? ""} onChange={ev => setF({ ...f, name: ev.target.value })} /></Field>
      <Field label="Photo link (optional)"><input className="input" value={f.photo_url ?? ""} onChange={ev => setF({ ...f, photo_url: ev.target.value })} placeholder="https://…" /></Field>
      <Field label="Promises (optional)" hint="What voters read on the ballot"><textarea className="input" rows={4} maxLength={4000} value={f.manifesto ?? ""} onChange={ev => setF({ ...f, manifesto: ev.target.value })} /></Field>
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end"><button className="btn btn-primary" onClick={async () => {
        const r = await send("/api/elections", { action: "save_candidate", election_id: electionId, post_id: f.post_id, id: f.id ?? null, name: f.name ?? "", student_id: f.student_id ?? null,
          photo_url: f.photo_url || null, manifesto: f.manifesto || null, position: f.position ?? 0 });
        if (!r.ok) return setErr(r.error ?? "failed");
        onDone("Candidate saved.");
      }}>Save</button></div>
    </div>
  );
}
