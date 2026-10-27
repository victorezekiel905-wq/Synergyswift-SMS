"use client";
import { useCallback, useEffect, useState } from "react";
import { Countdown } from "@/live/components/game/Countdown";
import { GoalBar } from "@/live/components/game/GoalBar";
import { OptionShape } from "@/live/components/game/Shape";
import { Lives, RaceTrack, TeamBars } from "@/live/components/game/GameBits";
import { CalendarClock, Lock, LockOpen, Pencil, X } from "lucide-react";
import { BADGE, MODES, OPTION_COLORS, type GameState, type Leaderboard } from "@/live/components/game/types";
import { GlyphField, Podium } from "@/live/components/game/Celebrate";
import { Critter } from "@/live/components/live/Critter";
import { RichText } from "@/live/components/RichText";
import { Alert, Badge, Button, Card, useToast, useDialog } from "@/live/components/ui";
import { useRpc } from "@/live/lib/hooks";
import { useSignedUrl } from "@/live/lib/media";
import { useTeacherPresence } from "@/live/lib/teacher-presence";
import { useSignal } from "@/live/lib/realtime";
import { errorText, rpc } from "@/live/lib/rpc";
import { cn, formatDate, formatDateTime } from "@/live/lib/utils";

const KIND_NOTE: Record<string, string> = {
  fill_blank: "Students type the missing words.", matching: "Students match the pairs.",
  ordering: "Students put the items in order.", categorize: "Students sort the items into groups."
};

export function GameHost({ gameId, school, sessionId }: { gameId: string; school: string; sessionId?: string | null }) {
  // A game run from a live lesson keeps that lesson open while the teacher hosts it.
  useTeacherPresence(sessionId);
  const toast = useToast();
  const dialog = useDialog();
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const state = useRpc<GameState>("game_state", { p_game: gameId }, [gameId], { intervalMs: 10000 });
  const board = useRpc<Leaderboard>("game_leaderboard", { p_game: gameId, p_limit: 50 }, [gameId, state.data?.status, state.data?.current_index]);
  useSignal(`game:${gameId}`, ["state", "players"], () => { void state.reload(); void board.reload(); }, { debounceMs: 100, minGapMs: 1000 });
  useEffect(() => setFetchedAt(Date.now()), [state.data?.server_now]);
  // Time's up: the server closes the question after a 1.5 s grace; show the reveal then, not at the next poll.
  const onTimeUp = useCallback(() => { window.setTimeout(() => { void state.reload(); void board.reload(); }, 1700); }, [state, board]);
  const g = state.data;

  async function control(action: string) {
    try { await rpc("game_control", { p_game: gameId, p_action: action }); await state.reload(); await board.reload(); }
    catch (e) { toast(errorText(e), "error"); }
  }
  async function moderate(player: string, action: "rename" | "remove") {
    const name = action === "rename" ? await dialog.ask({ title: "Rename player", label: "New display name", maxLength: 20, confirmLabel: "Rename" }) : null;
    if (action === "rename" && !name) return;
    if (action === "remove" && !(await dialog.confirm({ title: "Remove this player?", body: "They're taken out of this game.", tone: "danger", confirmLabel: "Remove" }))) return;
    try { await rpc("game_moderate_player", { p_player: player, p_action: action, p_name: name }); void state.reload(); }
    catch (e) { toast(errorText(e), "error"); }
  }

  if (state.error && !g) return <div className="page"><Alert tone="error">{state.error}</Alert></div>;
  if (!g) return <div className="page text-sm text-ink-500">Loading game…</div>;
  const q = g.question;
  const self = g.mode === "self_paced";
  const survival = g.mode === "survival";
  const live = g.status === "question" || g.status === "review";
  const tiles = q && (q.kind === "mcq" || q.kind === "true_false" || q.kind === "multi_select");

  return (
    <div className="page space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[13px] font-semibold text-ink-500">Quiz game <Badge tone="gray">{MODES[g.mode].name}</Badge></p>
          <h1 className="text-2xl font-bold">{g.title}</h1>
        </div>
        <div className="flex items-center gap-4">
          {g.status !== "ended" && <div className="text-center"><p className="text-[11px] font-semibold text-ink-500">Join code</p><p className="font-mono text-3xl font-extrabold tracking-[0.2em] text-brand-700">{g.join_code}</p></div>}
          <div className="text-center"><p className="text-[11px] font-semibold text-ink-500">Players</p><p className="font-display text-2xl font-bold">{g.players}</p></div>
          {survival && g.alive != null && g.status !== "lobby" && <div className="text-center"><p className="text-[11px] font-semibold text-ink-500">Still in</p><p className="font-display text-2xl font-bold text-tile-heart">{g.alive}</p></div>}
          {!!g.flags && <Badge tone="amber" className="self-center">{g.flags} pattern flag(s)</Badge>}
          {g.status !== "ended" && (
            <Button variant={g.settings.locked ? "ink" : "secondary"} aria-pressed={!!g.settings.locked}
              title={g.settings.locked ? "No one new can join. Players already in stay in." : "Stop anyone else joining with the code"}
              onClick={() => control(g.settings.locked ? "unlock" : "lock")}>
              {g.settings.locked ? <Lock className="h-4 w-4" aria-hidden /> : <LockOpen className="h-4 w-4" aria-hidden />}
              {g.settings.locked ? "Game locked" : "Lock game"}
            </Button>
          )}
        </div>
      </div>

      {g.status === "lobby" && (
        <Card title="Lobby" actions={<Button size="lg" disabled={!g.players} onClick={() => control("start")}>Start game</Button>}>
          <p className="mb-1 text-sm text-ink-600">{MODES[g.mode].text}</p>
          <p className="mb-3 text-sm text-ink-500">Students join at <strong>Live lessons → Join with a code</strong> (/live/student/join) with code <strong className="font-mono">{g.join_code}</strong>{sessionId ? ", or straight from the lesson." : "."}</p>
          <Roster g={g} onModerate={moderate} />
        </Card>
      )}

      {self && g.status === "open" && (
        <Card title="Self-paced game" actions={<div className="flex gap-2">
          <Button variant="secondary" onClick={() => control("extend")}><CalendarClock className="h-4 w-4" aria-hidden />One more day</Button>
          <Button variant="ghost" onClick={async () => { if (await dialog.confirm({ title: "Close the game now?", body: "Final scores and badges go to everyone who played.", tone: "danger", confirmLabel: "Close game" })) await control("end"); }}>Close now</Button>
        </div>}>
          <p className="mb-3 text-sm text-ink-600">Open until <strong>{g.closes_at ? formatDateTime(g.closes_at) : "you close it"}</strong>. Students play at their own pace; nothing to run from here.</p>
          <table className="table"><thead><tr><th>Player</th><th>Progress</th><th>Score</th><th /></tr></thead>
            <tbody>{(g.roster ?? []).map((p) => (
              <tr key={p.player_id}><td><span className="flex items-center gap-2"><Critter name={p.avatar} className="h-5 w-5" />{p.name}{p.guest && <Badge tone="gray">guest</Badge>}</span></td>
                <td><div className="flex items-center gap-2"><div className="h-2 w-28 overflow-hidden rounded-full bg-ink-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(p.progress / Math.max(g.total, 1)) * 100}%` }} /></div>
                  <span className="text-xs tabular-nums text-ink-600">{p.progress}/{g.total}{p.finished && " ✓"}</span></div></td>
                <td className="tabular-nums">{p.score}</td>
                <td className="text-right"><button className="text-xs text-rose-700 hover:underline" onClick={() => moderate(p.player_id, "remove")}>Remove</button></td></tr>
            ))}</tbody></table>
          {!g.roster?.length && <p className="text-sm text-ink-500">Nobody has started yet.</p>}
        </Card>
      )}

      {g.settings.class_goal && g.status !== "lobby" && <GoalBar gameId={gameId} refreshKey={`${g.status}-${g.current_index}-${g.answered}`} />}

      {live && q && (
        <Card>
          <div className="mb-3 flex items-center justify-between text-sm text-ink-500"><span>Question {g.current_index + 1} of {g.total}</span><span>{g.answered}/{survival ? g.alive ?? g.players : g.players} answered</span></div>
          <RichText text={q.prompt} className="text-2xl font-bold text-ink-900" />
          <QuestionPicture media={q.media} />
          {g.status === "question" && <Countdown className="my-4" endsAt={g.question_ends_at} serverNow={g.server_now} fetchedAt={fetchedAt} total={g.settings.question_seconds} onDone={onTimeUp} />}
          {tiles ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {q.options.map((o, i) => {
                const correct = g.review?.correct_option_ids.includes(o.id);
                const count = g.review?.distribution[o.id] ?? 0;
                return (
                  <div key={o.id} className={cn("flex items-center justify-between rounded-xl px-5 py-4 text-lg font-semibold", OPTION_COLORS[i % OPTION_COLORS.length], g.status === "review" && !correct && "opacity-40")}>
                    <span className="flex items-center gap-3"><OptionShape i={i} />{o.label}{correct && <span className="sr-only"> (correct)</span>}</span>{g.status === "review" && <span className="rounded-full bg-black/20 px-2 text-sm">{count}</span>}
                  </div>
                );
              })}
            </div>
          ) : <p className="mt-3 text-sm text-ink-600">{KIND_NOTE[q.kind] ?? "Students answer on their screens."}</p>}
          {g.status === "review" && g.review?.right != null && <p className="mt-3 font-semibold text-ink-800">{g.review.right} of {g.answered} got it right.</p>}
          {g.review?.explanation && <Alert tone="info">{g.review.explanation}</Alert>}
          {survival && g.status === "question" && <div className="mt-4"><Roster g={g} compact /></div>}
          <div className="mt-5 flex justify-end gap-2">
            {g.status === "question" && <Button variant="secondary" onClick={() => control("close")}>Close answers</Button>}
            <Button onClick={() => control("next")}>{g.current_index + 1 >= g.total && g.status === "review" ? "Finish" : "Next question"}</Button>
          </div>
        </Card>
      )}

      {g.race && g.race.length > 0 && g.status !== "lobby" && <RaceTrack runners={g.race} total={g.total} teams={g.teams} />}
      {g.teams && g.teams.length > 0 && g.status !== "lobby" && <Card title="Team battle"><TeamBars teams={g.teams} /><p className="mt-2 text-xs text-ink-500">Scored by each team&apos;s average per player, so bigger teams have no advantage.</p></Card>}

      {(g.status === "review" || g.status === "ended" || (self && g.status === "open")) && board.data && !(g.settings.class_goal && g.status === "review") &&
        <Standings board={board.data} ended={g.status === "ended"} school={school} title={g.title} certificates={g.settings.certificates} survival={survival} lives={g.settings.lives ?? 3} />}

      {g.status !== "ended" && g.status !== "lobby" && !self && <div className="text-right"><Button variant="ghost" onClick={async () => { if (await dialog.confirm({ title: "End the game now?", body: "Final scores and badges go to everyone who played.", tone: "danger", confirmLabel: "End game" })) await control("end"); }}>End game</Button></div>}
    </div>
  );
}

function QuestionPicture({ media }: { media: { url?: string; media_path?: string; alt?: string } | undefined }) {
  const signed = useSignedUrl(media?.media_path);
  const src = signed ?? media?.url;
  return src ? <img src={src} alt={media?.alt ?? ""} className="mt-3 max-h-72 rounded-lg border border-ink-200" /> : null;
}

function Roster({ g, onModerate, compact }: { g: GameState; onModerate?: (player: string, action: "rename" | "remove") => void; compact?: boolean }) {
  const players = g.roster ?? [];
  if (!players.length) return <p className="text-sm text-ink-500">Waiting for players…</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {players.map((p) => (
        <span key={p.player_id} className={cn("inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white py-1 pl-1.5 pr-1 text-sm font-medium text-ink-900", p.out && "opacity-45", compact && "pr-3")} title={p.full_name}>
          <Critter name={p.avatar} className="h-5 w-5" />
          {p.name}{p.guest && <span className="text-[11px] text-ink-500">guest</span>}
          {g.mode === "survival" && <Lives lives={p.lives} max={g.settings.lives ?? 3} className="ml-1" />}
          {onModerate && <>
            <button className="grid h-6 w-6 place-items-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-900" aria-label={`Rename ${p.name}`} onClick={() => onModerate(p.player_id, "rename")}><Pencil className="h-3 w-3" aria-hidden /></button>
            <button className="grid h-6 w-6 place-items-center rounded-full text-rose-700 hover:bg-rose-50" aria-label={`Remove ${p.name}`} onClick={() => onModerate(p.player_id, "remove")}><X className="h-3.5 w-3.5" aria-hidden /></button>
          </>}
        </span>
      ))}
    </div>
  );
}

function Standings({ board, ended, school, title, certificates, survival, lives }: { board: Leaderboard; ended: boolean; school: string; title: string; certificates: boolean; survival: boolean; lives: number }) {
  const podium = board.top.slice(0, 3);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {ended && podium.length > 0 && (
        <div className="relative overflow-hidden rounded-[14px] bg-ink-950 px-4 pb-0 pt-8 text-white lg:col-span-2">
          <GlyphField opacity={0.35} />
          <h2 className="relative mb-6 text-center font-display text-3xl font-extrabold">Podium</h2>
          <div className="relative"><Podium entries={podium.map((p) => ({ key: p.key, name: p.name, avatar: p.avatar, score: p.score, rank: p.rank }))} /></div>
        </div>
      )}
      <Card title="Leaderboard" pad={false}>
        <table className="table"><thead><tr><th>#</th><th>Player</th><th>Score</th><th>Correct</th><th>Best streak</th>{survival && <th>Lives</th>}{ended && <th>Badges</th>}</tr></thead>
          <tbody>{board.top.map((p) => (
            <tr key={p.key} className={cn(p.out && "text-ink-400")}><td className="font-bold">{p.rank}</td>
              <td><span className="flex items-center gap-2"><Critter name={p.avatar} className="h-5 w-5" />{p.name}{p.guest && <Badge tone="gray">guest</Badge>}</span></td>
              <td className="tabular-nums">{p.score}</td><td>{p.correct}</td><td>{p.streak}</td>
              {survival && <td>{p.out ? "Out" : <Lives lives={p.lives} max={lives} />}</td>}
              {ended && <td className="text-xs">{p.badges.map((b) => BADGE[b] ?? b).join(" · ")}</td>}</tr>
          ))}</tbody></table>
      </Card>
      {ended && certificates && (
        <Card title="Certificates">
          <p className="mb-3 text-sm text-ink-500">Print certificates for the podium and badge winners.</p>
          <Button variant="secondary" onClick={() => {
            // Same-origin blank window we write into ourselves (noopener would return null).
            const w = window.open("", "_blank", "width=900,height=700");
            if (!w) return;
            const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
            w.document.write(`<title>Certificates</title><style>body{font-family:system-ui;margin:0}.c{page-break-after:always;border:12px double #151411;margin:24px;padding:48px;text-align:center}h1{font-size:40px;margin:0 0 8px}p{font-size:20px}</style>` +
              board.top.filter((p) => p.badges.length).map((p) => `<div class="c"><p>${esc(school)}</p><h1>Certificate of Achievement</h1><p>awarded to</p><h2 style="font-size:34px">${esc(p.name)}</h2><p>${p.badges.map((b) => esc(BADGE[b] ?? b)).join(" · ")}</p><p>in the game "${esc(title)}", with ${p.score} points</p><p>${formatDate(new Date().toISOString())}</p></div>`).join(""));
            w.document.close(); w.print();
          }}>Print certificates</Button>
        </Card>
      )}
    </div>
  );
}
