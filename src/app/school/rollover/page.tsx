"use client";
import { useEffect, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Empty } from "@/components/ui";

type Cls = { id: string; name: string; level: string | null; suggested: string | null; students: { id: string; name: string; admission_no: string; average: number | null }[] };

/** Year-end promotion in one screen: every class, where it goes next, and who repeats. */
export default function RolloverPage() {
  const { data, error, reload } = useApi<{ pass_mark: number; classes: Cls[] }>("/api/rollover");
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [repeat, setRepeat] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    setMoves(Object.fromEntries(data.classes.map(c => [c.id, c.suggested ?? "stay"])));
    setRepeat(new Set());
  }, [data]);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><p className="text-sm text-slate-500">Loading…</p></Page>;
  const total = data.classes.reduce((a, c) => a + c.students.length, 0);
  async function run() {
    if (!confirm(`Promote ${total - repeat.size} students and keep ${repeat.size} in their class? This cannot be undone automatically.`)) return;
    setBusy(true);
    const r = await send("/api/rollover", { moves: Object.entries(moves).map(([from, to]) => ({ from, to })), repeat_student_ids: [...repeat], confirm: true });
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? `Done: ${r.data.promoted} promoted, ${r.data.graduated} graduated, ${r.data.repeating} repeating.` : r.error ?? "failed" });
    if (r.ok) reload();
  }
  return (
    <Page wide>
      <PageHeader eyebrow="End of session" title="Promote students"
        subtitle={`Choose where each class goes next. Students below the pass mark (${data.pass_mark}%) are highlighted; tick anyone who should repeat. Do this after publishing the final term's results.`}
        actions={<button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? "Promoting…" : "Promote everyone"}</button>} />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {!data.classes.length ? <Empty>No classes.</Empty> : (
        <div className="space-y-3">{data.classes.map(c => (
          <section key={c.id} className="card p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{c.name}</h2><span className="text-sm text-slate-500">{c.students.length} students →</span>
              <select className="input w-auto" value={moves[c.id] ?? "stay"} onChange={e => setMoves({ ...moves, [c.id]: e.target.value })} aria-label={`${c.name} next class`}>
                <option value="stay">Stay in {c.name}</option><option value="graduate">Graduate (leave school)</option>
                {data.classes.filter(x => x.id !== c.id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-1.5">{c.students.map(s => {
              const low = s.average !== null && s.average < data.pass_mark;
              return (
                <label key={s.id} className={"flex items-center gap-1 rounded border px-2 py-1 text-xs " + (repeat.has(s.id) ? "border-rose-400 bg-rose-50" : low ? "border-amber-300 bg-amber-50" : "border-slate-200")}>
                  <input type="checkbox" checked={repeat.has(s.id)} onChange={e => { const n = new Set(repeat); e.target.checked ? n.add(s.id) : n.delete(s.id); setRepeat(n); }} aria-label={`${s.name} repeats`} />
                  {s.name} <span className="text-slate-400">{s.average ?? "—"}</span>
                </label>
              );
            })}</div>
            <p className="mt-1 text-[11px] text-slate-500">Ticked students repeat {c.name}.</p>
          </section>))}</div>
      )}
    </Page>
  );
}
