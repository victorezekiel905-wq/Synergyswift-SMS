import Link from "next/link";
import { requireRole, TEACHERS } from "@/live/lib/session";
import { Badge, Empty, PageHeader } from "@/live/components/ui";
import { formatDateTime } from "@/live/lib/utils";
import { MODES } from "@/live/components/game/types";
import type { GameMode } from "@/live/lib/types";

export const metadata = { title: "Quiz games" };

export default async function ChallengeList() {
  const { sb } = await requireRole(TEACHERS);
  const { data } = await sb.from("game_sessions").select("id,title,status,join_code,created_at,settings,closes_at,classes(name),game_players(count)").order("created_at", { ascending: false }).limit(50);
  const games = (data ?? []) as unknown as { id: string; title: string; status: string; join_code: string; created_at: string; settings: { mode?: GameMode }; closes_at: string | null; classes: { name: string } | null; game_players: { count: number }[] }[];
  return (
    <div className="page">
      <PageHeader eyebrow="Live lessons" title="Quiz games" subtitle="Classic, team battle, survival, race or self-paced homework games, with power-ups, streaks and comebacks. Points unlock characters."
        actions={<Link href="/live/teacher/challenge/new" className="btn btn-primary no-underline">New game</Link>} />
      {games.length === 0 ? <Empty title="No games yet">Turn any quiz into a game for the whole class, or set one as homework.</Empty> : (
        <div className="card overflow-hidden"><table className="table">
          <thead><tr><th>Game</th><th>Mode</th><th>Class</th><th>Players</th><th>Status</th><th>Created</th><th /></tr></thead>
          <tbody>{games.map((g) => (
            <tr key={g.id}><td className="font-medium">{g.title}</td><td className="text-ink-600">{MODES[g.settings?.mode ?? "classic"]?.name ?? "Classic"}{g.status === "open" && g.closes_at ? ` · until ${formatDateTime(g.closes_at)}` : ""}</td><td>{g.classes?.name}</td><td>{g.game_players[0]?.count ?? 0}</td>
              <td><Badge tone={g.status === "ended" ? "gray" : "green"}>{g.status === "ended" ? "ended" : `${g.status} · ${g.join_code}`}</Badge></td>
              <td className="text-ink-500">{formatDateTime(g.created_at)}</td>
              <td className="text-right"><Link href={`/live/teacher/challenge/${g.id}`} className="btn btn-secondary btn-sm no-underline">{g.status === "ended" ? "Results" : "Host"}</Link></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
