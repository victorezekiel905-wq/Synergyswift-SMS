"use client";
import { useApi, Icon } from "@/components/ui";

type Data = {
  student: { id: string; name: string };
  stats: { streak: number; points: number; homework: number; practice: number; forum: number };
  days: { date: string; points: number }[];
  new_badges: string[];
  badges: { id: string; name: string; description: string | null; emoji: string; automatic: boolean; earned_at: string | null; reason: string | null; by: string | null; progress: number | null }[];
};

/** Points, learning streak and badges (the signed-in student's own, or a child's for a parent). */
export default function MyProgress({ studentId, compact }: { studentId?: string; compact?: boolean }) {
  const { data } = useApi<Data>(`/api/learning/progress${studentId ? `?student_id=${studentId}` : ""}`);
  if (!data) return null;
  const max = Math.max(1, ...data.days.map(d => d.points));
  const earned = data.badges.filter(b => b.earned_at);
  const next = data.badges.filter(b => !b.earned_at && b.automatic).sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0)).slice(0, 3);
  return (
    <section className={compact ? "space-y-2 text-sm" : "card mb-8 space-y-3 p-4 text-sm"}>
      {!compact && <h2 className="text-lg font-semibold">My progress</h2>}
      {data.new_badges.length > 0 && <p className="rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-emerald-900">New badge{data.new_badges.length > 1 ? "s" : ""}: <b>{data.new_badges.join(", ")}</b></p>}
      <div className="flex flex-wrap items-end gap-6">
        <div><p className="flex items-center gap-1.5 text-3xl font-semibold tabular-nums"><Icon name={data.stats.streak > 0 ? "flame" : "moon"} className={"h-6 w-6 " + (data.stats.streak > 0 ? "text-amber-600" : "text-slate-400")} />{data.stats.streak}</p><p className="text-xs text-slate-500">school-day streak</p></div>
        <div><p className="text-3xl font-bold">{data.stats.points}</p><p className="text-xs text-slate-500">learning points</p></div>
        <div className="flex h-12 items-end gap-0.5" role="img" aria-label="Points in the last two weeks">
          {data.days.map(d => <span key={d.date} title={`${d.date}: ${d.points}`} className="w-2 rounded-t bg-brand-500" style={{ height: `${Math.max(2, (d.points / max) * 48)}px`, opacity: d.points ? 1 : 0.2 }} />)}
        </div>
      </div>
      {earned.length > 0 && <div className="flex flex-wrap gap-2">{earned.map(b => <span key={b.id} className="rounded-full bg-slate-100 px-2 py-1 text-xs" title={`${b.description ?? ""}${b.by ? ` · from ${b.by}` : ""}${b.reason && b.reason !== "Earned" ? `: ${b.reason}` : ""}`}>{b.emoji} {b.name}</span>)}</div>}
      {next.length > 0 && (
        <ul className="space-y-1">{next.map(b => (
          <li key={b.id} className="flex items-center gap-2 text-xs"><span className="w-40 truncate">{b.emoji} {b.name}</span>
            <span className="h-2 flex-1 overflow-hidden rounded bg-slate-100"><span className="block h-2 bg-brand-500" style={{ width: `${Math.round((b.progress ?? 0) * 100)}%` }} /></span>
            <span className="w-10 text-right text-slate-500">{Math.round((b.progress ?? 0) * 100)}%</span></li>
        ))}</ul>
      )}
    </section>
  );
}
