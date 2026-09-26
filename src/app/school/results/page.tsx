"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Badge, statusTone, Empty, Field, Modal } from "@/components/ui";

type Session = { id: string; name: string; terms: { id: string; name: string; is_current: boolean }[] };
type Structure = {
  class_groups: { id: string; name: string; form_teacher_id: string | null }[];
  subjects: { id: string; name: string }[];
  offerings: { class_group_id: string; subject_id: string; teacher_id: string | null }[];
};
type Sheet = {
  scheme: { name: string; components: { id: string; name: string; max_score: number; weight: number }[]; bands: { grade: string; min_score: number }[]; pass_mark: number };
  students: { id: string; admission_no: string; first_name: string; last_name: string; other_names: string | null }[];
  scores: Record<string, Record<string, number | null>>;
  can_edit: boolean;
};
type Card = {
  id: string; student_id: string; total: number | null; average: number | null; position: number | null; class_size: number | null;
  status: string; teacher_comment: string | null; principal_comment: string | null; access_token: string;
  data: { student_name: string; admission_no: string; subjects: { subject_id: string; subject: string; total: number | null; grade: string | null; complete: boolean }[] };
};

export default function ResultsPage() {
  const { data: sessions } = useApi<Session[]>("/api/school/academic");
  const { data: structure } = useApi<Structure>("/api/school/structure");
  const { data: me } = useApi<{ profile: { id: string; role: string; extra_roles: string[] } | null }>("/api/me");
  const [termId, setTermId] = useState("");
  const [cg, setCg] = useState("");
  const [tab, setTab] = useState<"scores" | "traits" | "cards">("scores");

  useEffect(() => {
    if (termId || !sessions) return;
    const cur = sessions.flatMap(s => s.terms).find(t => t.is_current) ?? sessions[0]?.terms[0];
    if (cur) setTermId(cur.id);
  }, [sessions, termId]);
  useEffect(() => { if (!cg && structure?.class_groups[0]) setCg(structure.class_groups[0].id); }, [structure, cg]);

  const roles = new Set([me?.profile?.role, ...(me?.profile?.extra_roles ?? [])]);
  const isAdmin = ["school_admin", "principal", "platform_admin"].some(r => roles.has(r));

  return (
    <Page wide>
      <PageHeader eyebrow="Results" title="Scores & report cards"
        subtitle="Teachers enter scores for the subjects they teach. The form teacher or an admin compiles report cards. An admin publishes them, and parents get them on WhatsApp and email right away." />
      <div className="mb-5 flex flex-wrap gap-3">
        <Field label="Term">
          <select className="input min-w-[220px]" value={termId} onChange={e => setTermId(e.target.value)}>
            {(sessions ?? []).map(s => <optgroup key={s.id} label={s.name}>{s.terms.map(t => <option key={t.id} value={t.id}>{t.name} {s.name}{t.is_current ? " (current)" : ""}</option>)}</optgroup>)}
          </select>
        </Field>
        <Field label="Class">
          <select className="input min-w-[180px]" value={cg} onChange={e => setCg(e.target.value)}>
            {(structure?.class_groups ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </Field>
      </div>
      {!sessions?.length && sessions && <Alert tone="amber">Create an academic session under School setup first.</Alert>}
      {termId && cg && (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: "scores", label: "Score entry" }, { id: "traits", label: "Character & skills" }, { id: "cards", label: "Report cards & publishing" }]} />
          {tab === "traits" && <Traits termId={termId} cg={cg} isAdmin={isAdmin} />}
          {tab === "scores" && <ScoreEntry termId={termId} cg={cg} structure={structure} myId={me?.profile?.id} isAdmin={isAdmin} />}
          {tab === "cards" && <ReportCards termId={termId} cg={cg} isAdmin={isAdmin} isFormTeacher={structure?.class_groups.find(g => g.id === cg)?.form_teacher_id === me?.profile?.id} />}
        </>
      )}
    </Page>
  );
}

function ScoreEntry({ termId, cg, structure, myId, isAdmin }: { termId: string; cg: string; structure: Structure | null; myId?: string; isAdmin: boolean }) {
  const offered = (structure?.offerings ?? []).filter(o => o.class_group_id === cg);
  const subjects = (structure?.subjects ?? []).filter(s => !offered.length || offered.some(o => o.subject_id === s.id));
  const mine = subjects.filter(s => isAdmin || offered.some(o => o.subject_id === s.id && o.teacher_id === myId) || structure?.class_groups.find(g => g.id === cg)?.form_teacher_id === myId);
  const [subject, setSubject] = useState("");
  useEffect(() => { if (!mine.some(s => s.id === subject)) setSubject(mine[0]?.id ?? ""); /* eslint-disable-next-line */ }, [cg, structure]);
  const { data, error, reload } = useApi<Sheet>(subject ? `/api/results/scores?term_id=${termId}&class_group_id=${cg}&subject_id=${subject}` : null, [termId, cg, subject]);
  const [grid, setGrid] = useState<Record<string, Record<string, string>>>({});
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    const g: Record<string, Record<string, string>> = {};
    for (const s of data.students) {
      g[s.id] = {};
      for (const c of data.scheme.components) { const v = data.scores[s.id]?.[c.id]; g[s.id][c.id] = v === null || v === undefined ? "" : String(v); }
    }
    setGrid(g); setDirty(false); setMsg(null);
  }, [data]);

  const comps = data?.scheme.components ?? [];
  const totalFor = (sid: string) => {
    let t = 0, any = false;
    for (const c of comps) { const v = grid[sid]?.[c.id]; if (v !== "" && v !== undefined && !isNaN(Number(v))) { t += Math.min(Math.max(Number(v), 0), c.max_score) / c.max_score * c.weight; any = true; } }
    return any ? Math.round(t * 10) / 10 : null;
  };
  const gradeFor = (t: number | null) => t === null ? "" : [...(data?.scheme.bands ?? [])].sort((a, b) => b.min_score - a.min_score).find(b => t >= b.min_score)?.grade ?? "";
  const invalid = (c: { max_score: number }, v: string) => v !== "" && (isNaN(Number(v)) || Number(v) < 0 || Number(v) > c.max_score);
  const hasInvalid = data ? data.students.some(s => comps.some(c => invalid(c, grid[s.id]?.[c.id] ?? ""))) : false;

  async function save() {
    if (!data) return;
    setBusy(true);
    const entries = data.students.flatMap(s => comps.map(c => {
      const v = grid[s.id]?.[c.id] ?? "";
      return { student_id: s.id, component_id: c.id, score: v === "" ? null : Number(v) };
    })).filter(e => {
      const orig = data.scores[e.student_id]?.[e.component_id];
      return (orig ?? null) !== e.score;
    });
    const r = await send("/api/results/scores", { term_id: termId, class_group_id: cg, subject_id: subject, entries }, "PUT");
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? `Saved ${r.data.saved} scores${r.data.cleared ? `, cleared ${r.data.cleared}` : ""}.` : r.error ?? "failed" });
    if (r.ok) reload();
  }

  // Enter moves down the column like a spreadsheet.
  function onKey(e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const next = document.querySelector<HTMLInputElement>(`[data-cell="${row + 1}-${col}"]`);
    next?.focus(); next?.select();
  }

  if (!subjects.length) return <Empty>No subjects are offered in this class yet. Set them up under School setup → Classes & subjects.</Empty>;
  if (!mine.length) return <Empty>You are not assigned to teach any subject in this class.</Empty>;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Field label="Subject">
          <select className="input min-w-[200px]" value={subject} onChange={e => { if (!dirty || confirm("Discard unsaved scores?")) setSubject(e.target.value); }}>
            {mine.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        {data && <p className="pb-2 text-xs text-slate-500">Scheme: {data.scheme.name}. {comps.map(c => `${c.name} /${c.max_score} (${c.weight}%)`).join(" · ")}</p>}
        <div className="ml-auto flex gap-2 pb-0.5">
          {dirty && <span className="self-center text-xs text-amber-600">Unsaved changes</span>}
          <button className="btn btn-primary" onClick={save} disabled={!dirty || busy || hasInvalid || !data?.can_edit}>{busy ? "Saving…" : "Save scores"}</button>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {data && !data.can_edit && <div className="mb-3"><Alert tone="amber">View only: you are not the subject teacher for this class.</Alert></div>}
      {data && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">#</th><th className="p-2">Student</th>{comps.map(c => <th key={c.id} className="p-2 text-center">{c.name}<div className="font-normal normal-case">/ {c.max_score}</div></th>)}<th className="p-2 text-center">Total</th><th className="p-2 text-center">Grade</th></tr>
            </thead>
            <tbody>
              {data.students.map((s, i) => {
                const t = totalFor(s.id);
                return (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="p-2 text-xs text-slate-400">{i + 1}</td>
                    <td className="p-2"><span className="font-medium">{s.last_name}, {s.first_name}</span> <span className="text-xs text-slate-400">{s.admission_no}</span></td>
                    {comps.map((c, j) => {
                      const v = grid[s.id]?.[c.id] ?? "";
                      return (
                        <td key={c.id} className="p-1 text-center">
                          <input data-cell={`${i}-${j}`} inputMode="decimal" disabled={!data.can_edit} aria-label={`${s.first_name} ${c.name}`}
                            className={"w-20 rounded border px-2 py-1 text-center tabular-nums " + (invalid(c, v) ? "border-rose-400 bg-rose-50" : "border-slate-300")}
                            value={v} onKeyDown={e => onKey(e, i, j)}
                            onChange={e => { setGrid(g => ({ ...g, [s.id]: { ...g[s.id], [c.id]: e.target.value.trim() } })); setDirty(true); }} />
                        </td>
                      );
                    })}
                    <td className="p-2 text-center font-semibold tabular-nums">{t ?? "—"}</td>
                    <td className="p-2 text-center font-semibold">{gradeFor(t)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!data.students.length && <p className="p-4 text-sm text-slate-500">No active students in this class.</p>}
        </div>
      )}
    </div>
  );
}

function ReportCards({ termId, cg, isAdmin, isFormTeacher }: { termId: string; cg: string; isAdmin: boolean; isFormTeacher: boolean }) {
  const { data, error, reload } = useApi<Card[]>(`/api/results/report-cards?term_id=${termId}&class_group_id=${cg}`, [termId, cg]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Card | null>(null);
  const subjects = useMemo(() => {
    const out: { id: string; name: string }[] = [];
    for (const c of data ?? []) for (const s of c.data?.subjects ?? []) if (!out.some(x => x.id === s.subject_id)) out.push({ id: s.subject_id, name: s.subject });
    return out;
  }, [data]);

  async function compile(force = false) {
    setBusy("compile");
    const r = await send("/api/results/compute", { term_id: termId, class_group_id: cg, force });
    setBusy(null);
    setMsg({ ok: r.ok, text: r.ok ? `Compiled ${r.data.computed} report cards${r.data.skipped_published ? ` (${r.data.skipped_published} already published were kept)` : ""}.` : r.error ?? "failed" });
    if (r.ok) reload();
  }
  async function publish(resend = false) {
    const draft = (data ?? []).filter(c => c.status === "draft" || c.status === "approved").length;
    if (!confirm(resend ? "Send the published results to parents again?" : `Publish ${draft} report cards and send them to parents by WhatsApp and email now?`)) return;
    setBusy("publish");
    const r = await send("/api/results/publish", { term_id: termId, class_group_id: cg, resend });
    setBusy(null);
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "failed" }); return; }
    const d = r.data;
    const del = d.delivery ? ` Delivered now: ${d.delivery.sent}. Retrying: ${d.delivery.retry}. Failed: ${d.delivery.failed}. Not configured: ${d.delivery.skipped}.` : "";
    const missing = d.students_without_contacts?.length ? ` No contact on file for: ${d.students_without_contacts.join(", ")}.` : "";
    setMsg({ ok: true, text: `Published ${d.published}. ${d.messages_queued} messages queued.${del}${missing}` });
    reload();
  }
  async function aiComments(role: "form_teacher" | "principal") {
    setBusy("ai_" + role);
    const r = await send("/api/results/ai-comments", { term_id: termId, class_group_id: cg, role });
    setBusy(null);
    setMsg({ ok: r.ok, text: r.ok ? `Drafted ${r.data.drafted} comments${r.data.note ? ` (${r.data.note})` : ""}. Read and edit them before publishing.` : r.error ?? "failed" });
    if (r.ok) reload();
  }
  async function patch(id: string, body: Record<string, unknown>) {
    const r = await send("/api/results/report-cards", { id, ...body }, "PATCH");
    if (!r.ok) setMsg({ ok: false, text: r.error ?? "failed" });
    reload();
  }

  const incomplete = (data ?? []).filter(c => c.data?.subjects?.some(s => s.total !== null && !s.complete)).length;
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {(isAdmin || isFormTeacher) && <button className="btn btn-ghost border border-slate-200" disabled={busy !== null} onClick={() => compile(false)}>{busy === "compile" ? "Compiling…" : "Compile report cards"}</button>}
        {isAdmin && <button className="btn btn-ghost border border-slate-200" disabled={busy !== null} onClick={() => confirm("Recompute published report cards too? Parents will see the new figures on their link.") && compile(true)}>Recompute all</button>}
        {isAdmin && <button className="btn btn-primary" disabled={busy !== null || !data?.length} onClick={() => publish(false)}>{busy === "publish" ? "Publishing and sending…" : "Publish & send to parents"}</button>}
        {isAdmin && <button className="btn btn-ghost" disabled={busy !== null} onClick={() => publish(true)}>Resend</button>}
        {(isAdmin || isFormTeacher) && <button className="btn btn-ghost border border-violet-200 text-violet-800" disabled={busy !== null || !data?.length} onClick={() => aiComments("form_teacher")}>{busy === "ai_form_teacher" ? "Writing comments…" : "AI: draft teacher comments"}</button>}
        {isAdmin && <button className="btn btn-ghost border border-violet-200 text-violet-800" disabled={busy !== null || !data?.length} onClick={() => aiComments("principal")}>{busy === "ai_principal" ? "Writing comments…" : "AI: draft principal comments"}</button>}
        <a className="btn btn-ghost ml-auto" href={`/api/results/report-cards?term_id=${termId}&class_group_id=${cg}&format=csv`}>Download broadsheet (CSV)</a>
      </div>
      {error && <Alert>{error}</Alert>}
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {incomplete > 0 && <div className="mb-3"><Alert tone="amber">{incomplete} students have subjects with missing components (for example no exam score yet). Check before publishing.</Alert></div>}
      {!data?.length ? <Empty>No report cards yet. Enter scores, then compile.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Pos</th><th className="p-2">Student</th>{subjects.map(s => <th key={s.id} className="p-2 text-center">{s.name}</th>)}<th className="p-2 text-center">Avg</th><th className="p-2">Status</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {data.map(c => {
                const by = new Map(c.data.subjects.map(s => [s.subject_id, s]));
                return (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="p-2 font-semibold tabular-nums">{c.position ?? "—"}</td>
                    <td className="p-2"><span className="font-medium">{c.data.student_name}</span> <span className="text-xs text-slate-400">{c.data.admission_no}</span></td>
                    {subjects.map(s => { const r = by.get(s.id); return <td key={s.id} className={"p-2 text-center tabular-nums " + (r && !r.complete && r.total !== null ? "text-amber-600" : "")}>{r?.total ?? "—"}<span className="ml-1 text-xs text-slate-500">{r?.grade ?? ""}</span></td>; })}
                    <td className="p-2 text-center font-semibold tabular-nums">{c.average ?? "—"}</td>
                    <td className="p-2"><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
                    <td className="whitespace-nowrap p-2 text-right">
                      <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(c)}>Comments</button>
                      <a className="btn btn-ghost px-2 py-1 text-xs" href={`/r/${c.access_token}`} target="_blank" rel="noreferrer">Preview</a>
                      {isAdmin && c.status !== "published" && (c.status === "withheld"
                        ? <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => patch(c.id, { status: "draft" })}>Release hold</button>
                        : <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => patch(c.id, { status: "withheld" })}>Withhold</button>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={`Comments: ${editing?.data.student_name ?? ""}`}>
        {editing && <CommentForm card={editing} isAdmin={isAdmin} onSave={async (b) => { await patch(editing.id, b); setEditing(null); }} />}
      </Modal>
    </div>
  );
}

function CommentForm({ card, isAdmin, onSave }: { card: Card; isAdmin: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const [t, setT] = useState(card.teacher_comment ?? "");
  const [p, setP] = useState(card.principal_comment ?? "");
  return (
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); onSave(isAdmin ? { teacher_comment: t, principal_comment: p } : { teacher_comment: t }); }}>
      <Field label="Form teacher's comment"><textarea className="input h-24" value={t} onChange={e => setT(e.target.value)} maxLength={600} /></Field>
      {isAdmin && <Field label="Principal's comment"><textarea className="input h-24" value={p} onChange={e => setP(e.target.value)} maxLength={600} /></Field>}
      <div className="flex justify-end"><button className="btn btn-primary">Save</button></div>
    </form>
  );
}

type TraitData = { traits: { id: string; domain: string; name: string }[]; students?: { id: string; first_name: string; last_name: string; admission_no: string }[]; ratings?: { student_id: string; trait_id: string; rating: number }[] };

function Traits({ termId, cg, isAdmin }: { termId: string; cg: string; isAdmin: boolean }) {
  const { data, reload } = useApi<TraitData>(`/api/traits?term_id=${termId}&class_group_id=${cg}`, [termId, cg]);
  const [grid, setGrid] = useState<Record<string, number | null>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!data) return;
    setGrid(Object.fromEntries((data.ratings ?? []).map(r => [`${r.student_id}|${r.trait_id}`, r.rating])));
  }, [data]);
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!data.traits.length) return (
    <Empty>No character or skills traits set up.{isAdmin && <button className="btn btn-primary ml-2 text-xs" onClick={async () => { await send("/api/traits", { action: "seed_defaults" }); reload(); }}>Add the standard list</button>}</Empty>
  );
  async function save() {
    const ratings = Object.entries(grid).map(([k, rating]) => { const [student_id, trait_id] = k.split("|"); return { student_id, trait_id, rating }; });
    const r = await send("/api/traits", { action: "rate", term_id: termId, ratings });
    setMsg({ ok: r.ok, text: r.ok ? `Saved ${r.data.saved} ratings. Recompile report cards to include them.` : r.error ?? "failed" });
  }
  return (
    <div>
      <div className="mb-3 flex items-center justify-between"><p className="text-sm text-slate-600">Rate each student 1 (needs improvement) to 5 (excellent). These print on the report card.</p><button className="btn btn-primary" onClick={save}>Save ratings</button></div>
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <div className="card overflow-x-auto"><table className="w-full text-xs">
        <thead className="bg-slate-50"><tr><th className="p-2 text-left">Student</th>{data.traits.map(t => <th key={t.id} className="p-1" title={t.domain}><span className="block max-w-[80px] truncate">{t.name}</span></th>)}</tr></thead>
        <tbody>{(data.students ?? []).map(s => (
          <tr key={s.id} className="border-t border-slate-100"><td className="whitespace-nowrap p-2 text-sm">{s.last_name}, {s.first_name}</td>
            {data.traits.map(t => { const k = `${s.id}|${t.id}`; return (
              <td key={t.id} className="p-1 text-center"><select className="rounded border border-slate-300 px-1 py-0.5" value={grid[k] ?? ""} aria-label={`${s.first_name} ${t.name}`}
                onChange={e => setGrid({ ...grid, [k]: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n}</option>)}</select></td>); })}
          </tr>))}</tbody></table></div>
    </div>
  );
}
