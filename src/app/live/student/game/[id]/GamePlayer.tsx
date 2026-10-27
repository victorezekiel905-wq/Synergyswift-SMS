"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Countdown } from "@/live/components/game/Countdown";
import { GoalBar } from "@/live/components/game/GoalBar";
import { AnswerResult, AnswerTiles, StreakChip } from "@/live/components/game/LiveGame";
import { Lives, MomentOverlay, PowerUpBar, RaceTrack, TeamBars, streakMoment, type Moment } from "@/live/components/game/GameBits";
import { BADGE, MODES, type GameState, type InstantResult, type Leaderboard, type PowerUp, type Reveal } from "@/live/components/game/types";
import { Prompt, QuestionInput, isAnswered, type Answer } from "@/live/components/activities/QuestionInput";
import { Critter } from "@/live/components/live/Critter";
import { isMe } from "@/live/components/live/Leaderboard";
import { useSupports } from "@/live/lib/supports";
import { Alert, Button, Card, Field, Input, useToast } from "@/live/components/ui";
import { useRpc } from "@/live/lib/hooks";
import { useSignal } from "@/live/lib/realtime";
import { ActionError, errorText, rpc } from "@/live/lib/rpc";
import type { PublicQuestion } from "@/live/lib/types";
import { cn, formatDateTime } from "@/live/lib/utils";

const TILE_KINDS = new Set(["mcq", "true_false", "multi_select"]);

export function GamePlayer({ gameId }: { gameId: string }) {
  const toast = useToast();
  const state = useRpc<GameState>("game_state", { p_game: gameId }, [gameId], { intervalMs: 10000 });
  const g = state.data;
  const board = useRpc<Leaderboard>("game_leaderboard", { p_game: gameId, p_limit: 10 }, [gameId, g?.status, g?.current_index, g?.me?.progress]);
  // Phase changes are pushed; the slow poll is only a safety net.
  useSignal(`game:${gameId}`, ["state"], () => { void state.reload(); void board.reload(); }, { debounceMs: 50 });
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [value, setValue] = useState<Answer | undefined>(undefined);
  const [sent, setSent] = useState<number | null>(null);
  // A self-paced answer's result, with its question (the state has already moved on to the next one).
  const [done, setDone] = useState<{ r: InstantResult; q: PublicQuestion } | null>(null);
  const instant = done?.r ?? null;
  const [moment, setMoment] = useState<Moment | null>(null);
  const [nickname, setNickname] = useState("");
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef<number>(Date.now());
  // Calm mode (a private learning support): no rankings, just the student's own progress.
  const supports = useSupports();
  const calm = supports.calm_mode;
  const self = g?.mode === "self_paced";
  const index = self ? g?.question_index ?? -1 : g?.current_index ?? -1;
  const q = g?.question;

  useEffect(() => setFetchedAt(Date.now()), [g?.server_now]);
  useEffect(() => { shownAt.current = Date.now(); setValue(undefined); }, [index, q?.id]);

  // After the reveal: celebrate a streak, a power-up or a comeback; or say you're out.
  const revealSeen = useRef<string>("");
  useEffect(() => {
    if (!g?.me || g.status !== "review") return;
    const tag = `${g.current_index}`;
    if (revealSeen.current === tag) return;
    revealSeen.current = tag;
    if (g.me.out && g.mode === "survival") setMoment({ kind: "out", text: "Out of lives!" });
    else if (g.me.earned) setMoment({ kind: "powerup", text: "Power-up!", power: g.me.earned });
    else if (g.me.last?.comeback) setMoment({ kind: "comeback", text: "Comeback bonus!" });
    else if (g.me.last?.is_correct) setMoment(streakMoment(g.me.streak));
  }, [g?.status, g?.current_index, g?.me, g?.mode]);

  // When time runs out: host-paced games are closed by the server (after a short grace), so
  // fetch the reveal then; at your own pace, an unanswered question is sent as "no answer".
  const onTimeUp = useCallback(() => {
    if (self) { if (!instant) void answer({ timeout: true }); return; }
    window.setTimeout(() => { void state.reload(); void board.reload(); }, 1700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [self, instant, index]);

  async function join() {
    setJoinErr(null);
    try { await rpc("join_game_by_id", { p_game: gameId, p_nickname: nickname || null }); void state.reload(); }
    catch (e) { setJoinErr(errorText(e)); }
  }

  async function answer(choice: Record<string, unknown>) {
    if (!g || busy) return;
    setBusy(true);
    try {
      const r = await rpc<InstantResult | { accepted: true }>("game_answer", { p_game: gameId, p_index: index, p_choice: choice, p_client_elapsed_ms: Date.now() - shownAt.current });
      if ("is_correct" in r) {
        if (q) setDone({ r, q });
        if (r.out) setMoment({ kind: "out", text: "Out of lives!" });
        else if (r.earned) setMoment({ kind: "powerup", text: "Power-up!", power: r.earned });
        else if (r.comeback) setMoment({ kind: "comeback", text: "Comeback bonus!" });
        else if (r.is_correct) setMoment(streakMoment((g.me?.streak ?? 0) + 1));
      } else setSent(index);
      void state.reload();
    } catch (e) {
      if (e instanceof ActionError && /already answered/.test(e.message)) setSent(index);
      else toast(errorText(e), "error");
    } finally { setBusy(false); }
  }

  async function spendPowerup(p: PowerUp) {
    try { await rpc("game_use_powerup", { p_game: gameId, p_kind: p }); void state.reload(); }
    catch (e) { toast(errorText(e), "error"); }
  }

  if (state.error && !g) return <div className="page max-w-lg"><Alert tone="error">{state.error}</Alert></div>;
  if (!g) return <div className="page text-sm text-ink-500">Loading…</div>;

  if (!g.me && g.status !== "ended") {
    return (
      <div className="page max-w-md">
        <Card title={`Join "${g.title}"`}>
          <div className="space-y-3">
            <p className="text-sm text-ink-600"><strong>{MODES[g.mode].name}.</strong> {MODES[g.mode].text}</p>
            {self && g.closes_at && <p className="text-sm text-ink-600">Play any time before <strong>{formatDateTime(g.closes_at)}</strong>.</p>}
            {g.settings.display_mode === "nickname" && <Field label="Nickname" hint="2-20 letters or numbers. Your teacher can see your real name."><Input value={nickname} onChange={(e) => setNickname(e.target.value)} /></Field>}
            {joinErr && <Alert tone="error">{joinErr}</Alert>}
            <Button className="w-full" size="lg" onClick={join}>Join game</Button>
          </div>
        </Card>
      </div>
    );
  }

  const me = g.me;
  const answered = me?.answered || sent === index;
  const survival = g.mode === "survival";
  const viewer = me ? { key: me.key, name: me.name } : undefined;
  const asking = !!q && !!me && !me.out && !instant && ((g.status === "question" && !answered) || (self && g.status === "open" && !me.finished));
  const rightAnswer = (reveal: Reveal | undefined, question: PublicQuestion | undefined) => {
    if (!reveal || !question) return null;
    const i = question.options.findIndex((o) => reveal.correct_option_ids.includes(o.id));
    if (i >= 0) return { label: question.options[i]!.label, index: i };
    return null;
  };

  return (
    <div className="page max-w-2xl space-y-4">
      <MomentOverlay moment={moment} onDone={() => setMoment(null)} />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ink-500">{MODES[g.mode].name}{self && g.total ? ` · question ${Math.min((me?.progress ?? 0) + (instant ? 0 : 1), g.total)} of ${g.total}` : ""}</p>
          <h1 className="truncate text-lg font-bold">{g.title}</h1>
        </div>
        {me && (
          <div className="flex items-center gap-3 text-right">
            <div>
              <p className="flex items-center justify-end gap-1.5 text-xs text-ink-500"><Critter name={me.avatar} className="h-5 w-5" />{me.name}</p>
              <p className="font-display text-2xl font-extrabold tabular-nums">{me.score}</p>
              {survival && <Lives lives={me.lives} max={g.settings.lives ?? 3} />}
            </div>
          </div>
        )}
      </div>
      {me && me.streak > 1 && !me.out && <StreakChip streak={me.streak} />}

      {g.settings.class_goal && g.status !== "lobby" && <GoalBar gameId={gameId} refreshKey={`${g.status}-${g.current_index}`} />}

      {g.status === "lobby" && (
        <Card><div className="py-8 text-center">
          <Critter name={me?.avatar} className="mx-auto h-16 w-16 animate-pop" />
          <p className="mt-3 text-lg font-semibold">You&apos;re in! Waiting for your teacher to start…</p>
          <p className="mt-1 text-sm text-ink-500">{MODES[g.mode].text}</p>
        </div></Card>
      )}

      {me?.out && g.status !== "ended" && (
        <Card><div className="py-6 text-center">
          <p className="font-display text-2xl font-extrabold">You&apos;re out of lives</p>
          <p className="mt-1 text-ink-600">You scored <strong>{me.score}</strong>. {g.alive != null && <>{g.alive} still in: cheer them on!</>}</p>
        </div></Card>
      )}

      {asking && q && (
        <Card>
          {!self && <p className="mb-1 text-sm text-ink-500">Question {g.current_index + 1} of {g.total}</p>}
          <Prompt q={q} readAloud={supports.read_aloud ? "emphasis" : undefined} />
          <Countdown className="my-4" endsAt={g.question_ends_at} serverNow={g.server_now} fetchedAt={fetchedAt} total={g.settings.question_seconds} onDone={onTimeUp} />
          {g.settings.powerups !== false && me && (
            <div className="mb-3"><PowerUpBar held={me.powerups} active={me.active_powerup} onUse={spendPowerup} disabled={busy} canFifty={q.kind === "mcq" || q.kind === "multi_select"} /></div>
          )}
          {TILE_KINDS.has(q.kind) ? (
            <>
              <AnswerTiles options={q.options} disabled={busy}
                picked={q.kind === "multi_select" ? ((value?.option_ids as string[]) ?? []) : []}
                onPick={(id) => q.kind === "multi_select"
                  ? setValue((v) => { const cur = (v?.option_ids as string[]) ?? []; return { option_ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] }; })
                  : void answer({ option_id: id })} />
              {q.kind === "multi_select" && <Button className="mt-3 w-full" size="lg" loading={busy} disabled={!((value?.option_ids as string[]) ?? []).length} onClick={() => answer(value!)}>Submit</Button>}
            </>
          ) : (
            <div className="space-y-3">
              {/* Gap fill, matching, ordering and sorting use the same answer widgets as lessons. */}
              <QuestionInput q={q} value={value} onChange={setValue} disabled={busy} reasoning={false} />
              <Button className="w-full" size="lg" loading={busy} disabled={!isAnswered(q, value, { reasoning: false })} onClick={() => answer(value!)}>Submit</Button>
            </div>
          )}
        </Card>
      )}

      {g.status === "question" && answered && !me?.out && (
        <Card><p className="py-8 text-center text-lg font-semibold text-ink-800">Answer locked in. Waiting for the others…</p></Card>
      )}

      {instant && (
        <Card>
          <AnswerResult key={me?.progress} correct={instant.is_correct} title={instant.timeout ? "Time's up" : instant.is_correct ? "Correct!" : "Not this time"}
            points={instant.points} streak={instant.is_correct ? (me?.streak ?? 0) : 0} answer={instant.is_correct ? null : rightAnswer(instant.review, done?.q)}
            extras={[instant.comeback ? `+${instant.comeback} comeback` : "", instant.double ? `+${instant.double} double` : "", instant.shielded ? "Shield saved your streak" : ""].filter(Boolean).join(" · ") || undefined} />
          {!instant.is_correct && <KeyAnswer reveal={instant.review} q={done?.q} />}
          {instant.review.explanation && <p className="mt-4 rounded-xl bg-ink-50 p-4 text-[15px] leading-relaxed text-ink-800"><span className="font-semibold">Why: </span>{instant.review.explanation}</p>}
          <Button className="mt-4 w-full" size="lg" onClick={() => { setDone(null); void state.reload(); }}>{me?.finished || instant.out ? "See how you did" : "Next question"}</Button>
        </Card>
      )}

      {g.status === "review" && !me?.out && (
        <Card>
          {me?.last ? (
            <AnswerResult key={g.current_index} correct={me.last.is_correct} title={me.last.is_correct ? "Correct!" : "Not this time"}
              points={me.last.points} streak={me.streak} answer={rightAnswer(g.review, q)}
              extras={[me.last.comeback ? `+${me.last.comeback} comeback` : "", me.last.double ? `+${me.last.double} double` : ""].filter(Boolean).join(" · ") || undefined} />
          ) : <p className="text-center text-ink-500">No answer this round.</p>}
          {!me?.last?.is_correct && <KeyAnswer reveal={g.review} q={q} />}
          {g.review?.explanation && <p className="mt-4 rounded-xl bg-ink-50 p-4 text-[15px] leading-relaxed text-ink-800"><span className="font-semibold">Why: </span>{g.review.explanation}</p>}
        </Card>
      )}

      {self && me?.finished && !instant && g.status !== "ended" && (
        <Card title="You've finished">
          <p className="text-lg">You got <strong>{me.correct}</strong> of {g.total} right and scored <strong>{me.score}</strong> points.</p>
          <p className="mt-1 text-sm text-ink-500">The game closes {g.closes_at ? formatDateTime(g.closes_at) : "soon"}; the final board shows then.</p>
          <Link href="/live/student/characters" className="btn btn-secondary mt-3 no-underline">See your characters</Link>
        </Card>
      )}

      {g.race && g.race.length > 0 && !calm && <RaceTrack runners={g.race} total={g.total} me={viewer} teams={g.teams} />}
      {g.teams && g.teams.length > 0 && g.status !== "lobby" && !calm && <Card title="Teams"><TeamBars teams={g.teams} /></Card>}

      {board.data?.me && g.status === "ended" && (g.settings.class_goal || calm) && (
        <Card title="Your game">
          <p className="text-lg">You got <strong>{board.data.me.correct}</strong> of {g.total} right and scored <strong>{board.data.me.score}</strong> points.</p>
        </Card>
      )}

      {board.data && (g.status === "review" || g.status === "ended" || (self && me?.finished)) && !g.settings.class_goal && !calm && (
        <Card title={g.status === "ended" ? "Final results" : "Standings"}>
          {board.data.me && <p className="mb-3 text-lg">You are <strong>#{board.data.me.rank}</strong> of {board.data.players} with <strong>{board.data.me.score}</strong> points.</p>}
          {board.data.visible ? (
            <ol className="space-y-1">{board.data.top.map((p) => (
              <li key={p.key} className={cn("flex items-center justify-between gap-2 rounded-lg px-3 py-1.5", isMe(p, viewer) ? "bg-brand-50 font-semibold" : "", p.out && "text-ink-400")}>
                <span className="flex min-w-0 items-center gap-2"><span className="w-6 text-right tabular-nums">{p.rank}.</span><Critter name={p.avatar} className="h-5 w-5" /><span className="truncate">{p.name}</span>
                  {survival && <Lives lives={p.lives} max={g.settings.lives ?? 3} className="ml-1" />}</span>
                <span className="tabular-nums">{p.score}</span></li>
            ))}</ol>
          ) : <p className="text-sm text-ink-500">Your teacher has hidden the full leaderboard. Only you can see your position.</p>}
          {g.status === "ended" && !!board.data.me?.badges.length && (
            <div className="mt-4 flex flex-wrap gap-2">{board.data.me.badges.map((b) => <span key={b} className="badge bg-amber-100 text-amber-900">{BADGE[b] ?? b}</span>)}</div>
          )}
          {g.status === "ended" && <Link href="/live/student/characters" className="mt-4 inline-block text-sm font-semibold">Your points unlock characters →</Link>}
        </Card>
      )}
    </div>
  );
}

/** The right answer for typed and arranged questions (choices show it on their tile). */
function KeyAnswer({ reveal, q }: { reveal: Reveal | undefined; q: PublicQuestion | undefined }) {
  const key = reveal?.answer_key as { blanks?: string[][]; order?: string[] } | null | undefined;
  if (!key || !q) return null;
  const items = (q.config as { items?: { id: string; label: string }[] }).items ?? [];
  const text = key.blanks ? key.blanks.map((b) => b[0]).join(" · ")
    : key.order ? key.order.map((id) => items.find((i) => i.id === id)?.label ?? "").filter(Boolean).join(" → ") : null;
  if (!text) return null;
  return <p className="mt-3 rounded-xl border border-ink-200 p-3 text-center text-[15px]"><span className="font-semibold">The answer: </span>{text}</p>;
}
