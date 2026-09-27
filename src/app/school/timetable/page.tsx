"use client";
import { useEffect, useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Field, rolesOf, type Me, Loading, Icon } from "@/components/ui";

type Period = { id: string; name: string; starts_at: string; ends_at: string; is_break: boolean; position: number };
type Entry = { id: string; class_group_id: string; day: number; period_id: string; subject_id: string | null; teacher_id: string | null; room: string | null; locked: boolean;
  subjects: { name: string } | null; class_groups: { name: string } | null; users: { full_name: string } | null };
type Offering = { id: string; class_group_id: string; subject_id: string; teacher_id: string | null; periods_per_week: number; subjects: { name: string } | null; class_groups: { name: string } | null; users: { full_name: string } | null };
const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function TimetablePage() {
  const { data: me } = useApi<Me>("/api/me");
  const admin = ["school_admin", "principal", "platform_admin"].some(r => rolesOf(me).has(r));
  const [tab, setTab] = useState<"class" | "mine" | "load" | "periods">("class");
  const tabs = [{ id: "class" as const, label: "Class timetables" }, { id: "mine" as const, label: "My timetable" }, ...(admin ? [{ id: "load" as const, label: "Weekly load & generate" }, { id: "periods" as const, label: "School day" }] : [])];
  return (
    <Page wide>
      <PageHeader eyebrow="Academics" title="Timetable" subtitle="Build the school timetable automatically from each subject's weekly periods, then adjust by hand. Teacher and room clashes are blocked." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "class" && <ClassView admin={admin} />}
      {tab === "mine" && <Grid url="/api/timetable?teacher_id=me" showClass />}
      {tab === "load" && <Load />}
      {tab === "periods" && <Periods />}
    </Page>
  );
}

function Grid({ url, editable, cg, showClass }: { url: string; editable?: boolean; cg?: string; showClass?: boolean }) {
  const { data, reload } = useApi<{ periods: Period[]; entries: Entry[] }>(url, [url]);
  const { data: structure } = useApi<{ subjects: { id: string; name: string }[]; offerings: { class_group_id: string; subject_id: string }[] }>(editable ? "/api/school/structure" : null);
  const [err, setErr] = useState<string | null>(null);
  if (!data) return <Loading />;
  if (!data.periods.length) return <Empty>The school day has not been set up yet.</Empty>;
  const days = [1, 2, 3, 4, 5, ...(data.entries.some(e => e.day >= 6) ? [6] : [])];
  const at = (d: number, p: string) => data.entries.find(e => e.day === d && e.period_id === p);
  const offered = (structure?.offerings ?? []).filter(o => o.class_group_id === cg).map(o => o.subject_id);
  const subjects = (structure?.subjects ?? []).filter(s => !offered.length || offered.includes(s.id));
  return (
    <div>
      {err && <div className="mb-2"><Alert>{err}</Alert></div>}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-2 text-left">Period</th>{days.map(d => <th key={d} className="p-2">{DAYS[d]}</th>)}</tr></thead>
          <tbody>{data.periods.map(p => (
            <tr key={p.id} className={"border-t border-slate-100 " + (p.is_break ? "bg-slate-50" : "")}>
              <td className="whitespace-nowrap p-2 text-xs"><b>{p.name}</b><div className="text-slate-400">{p.starts_at.slice(0, 5)}–{p.ends_at.slice(0, 5)}</div></td>
              {days.map(d => {
                if (p.is_break) return <td key={d} className="p-2 text-center text-xs text-slate-400">{p.name}</td>;
                const e = at(d, p.id);
                return (
                  <td key={d} className="p-1 text-center align-top">
                    {editable ? (
                      <select className={"w-full rounded border px-1 py-1 text-xs " + (e ? "border-brand-200 bg-brand-50" : "border-slate-200")} value={e?.subject_id ?? ""} aria-label={`${DAYS[d]} ${p.name}`}
                        onChange={async ev => { setErr(null); const r = await send("/api/timetable", { action: "set_cell", class_group_id: cg, day: d, period_id: p.id, subject_id: ev.target.value || null }); if (!r.ok) setErr(r.error); reload(); }}>
                        <option value="">—</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    ) : e ? <div className="rounded bg-brand-50 px-1 py-1"><p className="text-xs font-semibold">{e.subjects?.name}</p><p className="text-[10px] text-slate-500">{showClass ? e.class_groups?.name : e.users?.full_name}{e.room ? ` · ${e.room}` : ""}</p></div> : null}
                    {editable && e && <p className="mt-0.5 truncate text-[10px] text-slate-500">{e.users?.full_name ?? "no teacher"}{e.locked ? " · fixed" : ""}</p>}
                  </td>
                );
              })}
            </tr>))}</tbody>
        </table>
      </div>
      <button className="btn btn-ghost mt-2 text-xs" onClick={() => window.print()}>Print</button>
    </div>
  );
}

function ClassView({ admin }: { admin: boolean }) {
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[] }>("/api/school/structure");
  const [cg, setCg] = useState("");
  useEffect(() => { if (!cg && structure?.class_groups[0]) setCg(structure.class_groups[0].id); }, [structure, cg]);
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <select className="input w-auto" value={cg} onChange={e => setCg(e.target.value)} aria-label="Class">{(structure?.class_groups ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        {admin && <span className="text-xs text-slate-500">Pick a subject in any cell to fix it. Fixed cells stay when you regenerate.</span>}
      </div>
      {cg && <Grid key={cg} url={`/api/timetable?class_group_id=${cg}`} editable={admin} cg={cg} />}
    </div>
  );
}

function Load() {
  const { data, reload } = useApi<{ offerings: Offering[]; entries: Entry[] }>("/api/timetable");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const groups = [...new Set((data?.offerings ?? []).map(o => o.class_groups?.name ?? ""))].sort();
  const placed = (o: Offering) => (data?.entries ?? []).filter(e => e.class_group_id === o.class_group_id && e.subject_id === o.subject_id).length;
  async function generate() {
    if (!confirm("Regenerate the timetable for every class? Cells you fixed by hand are kept.")) return;
    setBusy(true);
    const r = await send("/api/timetable", { action: "generate", days, keep_locked: true });
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? `Placed ${r.data.placed} lessons.${r.data.unplaced.length ? ` Could not fit: ${r.data.unplaced.map((u: any) => `${u.subject} ×${u.perWeek}`).join(", ")}. Add periods or free up the teacher.` : " Everything fits with no clashes."}` : r.error ?? "failed" });
    reload();
  }
  if (!data?.offerings.length) return <Empty>Offer subjects to classes under School setup → Classes & subjects first.</Empty>;
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm font-medium">School days:</span>
        {[1, 2, 3, 4, 5, 6].map(d => <label key={d} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={days.includes(d)} onChange={e => setDays(e.target.checked ? [...days, d].sort() : days.filter(x => x !== d))} />{DAYS[d]}</label>)}
        <button className="btn btn-primary ml-auto" disabled={busy} onClick={generate}>{busy ? "Generating…" : "Generate timetable"}</button>
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {groups.map(gname => (
        <section key={gname} className="card p-4">
          <h3 className="mb-2 font-semibold">{gname}</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.offerings.filter(o => (o.class_groups?.name ?? "") === gname).map(o => (
            <div key={o.id} className="flex items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1.5 text-sm">
              <span>{o.subjects?.name}<span className="block text-xs text-slate-400">{o.users?.full_name ?? "no teacher"} · {placed(o)} placed</span></span>
              <input className="input w-16 py-1 text-center" type="number" min={0} max={20} defaultValue={o.periods_per_week} aria-label={`${o.subjects?.name} periods per week`}
                onBlur={async e => { if (Number(e.target.value) !== o.periods_per_week) { await send("/api/timetable", { action: "set_load", offering_id: o.id, periods_per_week: Number(e.target.value) }); reload(); } }} />
            </div>))}</div>
        </section>
      ))}
    </div>
  );
}

function Periods() {
  const { data, reload } = useApi<{ periods: Period[] }>("/api/timetable");
  const [rows, setRows] = useState<Omit<Period, "position">[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const list = rows ?? (data?.periods ?? []).map(p => ({ ...p, starts_at: p.starts_at.slice(0, 5), ends_at: p.ends_at.slice(0, 5) }));
  const starter = [["Period 1", "08:00", "08:40"], ["Period 2", "08:40", "09:20"], ["Period 3", "09:20", "10:00"], ["Short break", "10:00", "10:20"], ["Period 4", "10:20", "11:00"],
    ["Period 5", "11:00", "11:40"], ["Long break", "11:40", "12:20"], ["Period 6", "12:20", "13:00"], ["Period 7", "13:00", "13:40"], ["Period 8", "13:40", "14:20"]]
    .map(([name, s, e]) => ({ id: "", name, starts_at: s, ends_at: e, is_break: name.includes("break") }));
  const set = (i: number, k: string, v: unknown) => setRows(list.map((r, j) => j === i ? { ...r, [k]: v } : r));
  return (
    <div className="card max-w-2xl p-5">
      {!list.length && <button className="btn btn-ghost mb-3 border border-slate-200" onClick={() => setRows(starter)}>Start from a typical school day</button>}
      <div className="overflow-x-auto print:overflow-visible"><table className="w-full text-sm"><tbody>{list.map((p, i) => (
        <tr key={i}><td className="py-1 pr-2"><input className="input py-1" value={p.name} onChange={e => set(i, "name", e.target.value)} aria-label="Period name" /></td>
          <td className="pr-2"><input className="input py-1" type="time" value={p.starts_at} onChange={e => set(i, "starts_at", e.target.value)} aria-label="Starts" /></td>
          <td className="pr-2"><input className="input py-1" type="time" value={p.ends_at} onChange={e => set(i, "ends_at", e.target.value)} aria-label="Ends" /></td>
          <td className="pr-2"><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={p.is_break} onChange={e => set(i, "is_break", e.target.checked)} />Break</label></td>
          <td><button type="button" className="text-rose-600" onClick={() => setRows(list.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="x" className="h-4 w-4" /></button></td></tr>))}</tbody></table></div>
      <button className="btn btn-ghost mt-2 text-xs" onClick={() => setRows([...list, { id: "", name: `Period ${list.length + 1}`, starts_at: "14:20", ends_at: "15:00", is_break: false }])}>+ Add period</button>
      {msg && <div className="mt-2"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <div className="mt-3"><button className="btn btn-primary" onClick={async () => {
        const r = await send("/api/timetable", { action: "save_periods", periods: list.map(p => ({ id: p.id || undefined, name: p.name, starts_at: p.starts_at, ends_at: p.ends_at, is_break: p.is_break })) });
        setMsg({ ok: r.ok, text: r.ok ? "Saved." : r.error ?? "failed" }); if (r.ok) { setRows(null); reload(); }
      }}>Save school day</button></div>
    </div>
  );
}
