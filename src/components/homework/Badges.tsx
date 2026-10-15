"use client";
import { useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field } from "@/components/ui";

type BadgeRow = { id: string; name: string; description: string | null; emoji: string; rule: { type: string; threshold: number } | null; active: boolean; student_badges: { count: number }[] };
const RULE_LABEL: Record<string, string> = { streak: "school-day streak of", points: "learning points reaching", homework: "pieces of homework handed in:", practice: "practice sessions finished:", forum: "discussion posts:" };

/** The school's badges, handing them out, and a class's points and streaks. */
export default function Badges({ classes }: { classes: { id: string; name: string }[] }) {
  const { data, reload } = useApi<{ items: BadgeRow[]; admin: boolean }>("/api/learning/progress?list=badges");
  const [cls, setCls] = useState("");
  const { data: overview, reload: reloadClass } = useApi<{ students: { id: string; name: string; streak: number; points: number; homework: number; badges: { emoji: string; name: string }[] }[] }>(cls ? `/api/learning/progress?class_group_id=${cls}` : null);
  const [award, setAward] = useState<{ badge: string; ids: string[]; reason: string }>({ badge: "", ids: [], reason: "" });
  const [edit, setEdit] = useState<{ id?: string; name: string; description: string; emoji: string; type: string; threshold: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!data) return null;
  const act = async (b: Record<string, unknown>, ok: string) => { const r = await send("/api/learning/progress", b); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) { reload(); reloadClass(); } return r.ok; };
  const manual = data.items.filter(b => !b.rule && b.active);
  return (
    <div className="space-y-4 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <section className="card space-y-2 p-4">
        <div className="flex items-center gap-2"><h2 className="mr-auto font-semibold">Badges</h2>
          {data.admin && !data.items.length && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "starter" }, "Starter badges added.")}>Add starter badges</button>}
          {data.admin && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setEdit({ name: "", description: "", emoji: "🏅", type: "", threshold: "" })}>New badge</button>}</div>
        {!data.items.length ? <Empty>No badges yet.</Empty> : (
          <ul className="grid gap-2 sm:grid-cols-2">{data.items.map(b => (
            <li key={b.id} className={"flex items-center gap-2 rounded border border-slate-200 p-2 " + (b.active ? "" : "opacity-50")}>
              <span className="text-2xl">{b.emoji}</span>
              <span className="flex-1"><b>{b.name}</b><span className="block text-xs text-slate-500">{b.rule ? `Automatic: ${RULE_LABEL[b.rule.type]} ${b.rule.threshold}` : "Given by staff"} · {b.student_badges?.[0]?.count ?? 0} earned</span></span>
              {data.admin && <button className="text-xs text-brand-700" onClick={() => setEdit({ id: b.id, name: b.name, description: b.description ?? "", emoji: b.emoji, type: b.rule?.type ?? "", threshold: b.rule ? String(b.rule.threshold) : "" })}>Edit</button>}
            </li>
          ))}</ul>
        )}
        {edit && (
          <form className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-4" onSubmit={async e => {
            e.preventDefault();
            if (await act({ action: "save", id: edit.id ?? null, name: edit.name, description: edit.description || null, emoji: edit.emoji, rule: edit.type ? { type: edit.type, threshold: Number(edit.threshold) } : null }, "Badge saved.")) setEdit(null);
          }}>
            <Field label="Emoji"><input className="input" value={edit.emoji} onChange={e => setEdit({ ...edit, emoji: e.target.value })} maxLength={8} required /></Field>
            <Field label="Name"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} required maxLength={60} /></Field>
            <Field label="Earned"><select className="input" value={edit.type} onChange={e => setEdit({ ...edit, type: e.target.value })}><option value="">Given by staff</option>{Object.entries(RULE_LABEL).map(([k, l]) => <option key={k} value={k}>Automatically: {l.replace(/[:\s]+of$|:$/, "")}</option>)}</select></Field>
            {edit.type && <Field label="When it reaches"><input className="input" type="number" min={1} value={edit.threshold} onChange={e => setEdit({ ...edit, threshold: e.target.value })} required /></Field>}
            <div className="sm:col-span-4"><Field label="Description"><input className="input" value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} maxLength={200} /></Field></div>
            <div className="flex gap-2"><button className="btn btn-primary">Save</button><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
              {edit.id && <button type="button" className="text-xs text-rose-600" onClick={async () => { if (confirm("Delete this badge?") && await act({ action: "delete", id: edit.id }, "Deleted.")) setEdit(null); }}>Delete</button>}</div>
          </form>
        )}
      </section>
      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">A class at a glance</h2>
        <select className="input w-auto" value={cls} onChange={e => { setCls(e.target.value); setAward({ ...award, ids: [] }); }} aria-label="Class"><option value="">Choose a class</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        {overview && (
          <>
            <table className="w-full text-xs"><thead className="text-left text-slate-500"><tr><th className="p-1" /><th className="p-1">Student</th><th className="p-1">Streak</th><th className="p-1">Points</th><th className="p-1">Homework</th><th className="p-1">Badges</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{[...overview.students].sort((a, b) => b.points - a.points).map(s => (
                <tr key={s.id}><td className="p-1"><input type="checkbox" checked={award.ids.includes(s.id)} onChange={e => setAward({ ...award, ids: e.target.checked ? [...award.ids, s.id] : award.ids.filter(x => x !== s.id) })} aria-label={`Select ${s.name}`} /></td>
                  <td className="p-1">{s.name}</td><td className="p-1">{s.streak ? `🔥 ${s.streak}` : "—"}</td><td className="p-1">{s.points}</td><td className="p-1">{s.homework}</td><td className="p-1">{s.badges.map(b => b.emoji).join(" ")}</td></tr>
              ))}</tbody></table>
            {manual.length > 0 && (
              <form className="flex flex-wrap items-end gap-2" onSubmit={async e => { e.preventDefault(); if (await act({ action: "award", badge_id: award.badge, student_ids: award.ids, reason: award.reason || null }, `Awarded to ${award.ids.length}.`)) setAward({ badge: "", ids: [], reason: "" }); }}>
                <select className="input w-auto" value={award.badge} onChange={e => setAward({ ...award, badge: e.target.value })} required aria-label="Badge"><option value="">Give a badge…</option>{manual.map(b => <option key={b.id} value={b.id}>{b.emoji} {b.name}</option>)}</select>
                <input className="input w-64" value={award.reason} onChange={e => setAward({ ...award, reason: e.target.value })} placeholder="What for (the family sees this)" maxLength={200} aria-label="Reason" />
                <button className="btn btn-primary" disabled={!award.ids.length}>Give to {award.ids.length || ""} selected</button>
                <Badge tone="slate">tick students in the table</Badge>
              </form>
            )}
          </>
        )}
      </section>
    </div>
  );
}
