"use client";
import { useEffect, useState } from "react";
import { ChevronsUp, Flag, Heart, HeartCrack, Scissors, Shield, Sparkles, Trophy } from "lucide-react";
import { Critter } from "@/live/components/live/Critter";
import { isMe, type Viewer } from "@/live/components/live/Leaderboard";
import { cn, LOCALE } from "@/live/lib/utils";
import { Burst } from "./Celebrate";
import { POWERUP, type GameState, type PowerUp, type TeamScore } from "./types";

const POWER_ICON: Record<PowerUp, typeof Shield> = { double: ChevronsUp, shield: Shield, fifty: Scissors };
const POWER_TILE: Record<PowerUp, string> = { double: "bg-tile-star text-ink-950", shield: "bg-tile-bolt text-white", fifty: "bg-tile-hex text-white" };

/** Survival lives as hearts; lost ones stay as outlines so the count is readable at a glance. */
export function Lives({ lives, max, className }: { lives: number | null | undefined; max: number; className?: string }) {
  if (lives == null) return null;
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} role="img" aria-label={`${lives} of ${max} lives left`}>
      {Array.from({ length: max }, (_, i) => i < lives
        ? <Heart key={i} className="h-4 w-4 text-tile-heart" fill="currentColor" strokeWidth={0} aria-hidden />
        : <Heart key={i} className="h-4 w-4 text-ink-300" aria-hidden />)}
    </span>
  );
}

export function PowerUpIcon({ kind, className }: { kind: PowerUp; className?: string }) {
  const I = POWER_ICON[kind];
  return <I className={className} aria-hidden />;
}

/** The power-ups a player holds. Tapping one uses it on the current question. */
export function PowerUpBar({ held, active, onUse, disabled, canFifty }: {
  held: PowerUp[]; active: PowerUp | null; onUse: (p: PowerUp) => void; disabled?: boolean; canFifty: boolean;
}) {
  if (!held.length && !active) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Your power-ups">
      {active && (
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold ring-2 ring-ink-950 ring-offset-1", POWER_TILE[active])}>
          <PowerUpIcon kind={active} className="h-4 w-4" />{POWERUP[active].name} is on
        </span>
      )}
      {held.map((p, i) => {
        const off = disabled || !!active || (p === "fifty" && !canFifty);
        return (
          <button key={`${p}-${i}`} type="button" disabled={off} onClick={() => onUse(p)}
            title={p === "fifty" && !canFifty ? "50:50 works on multiple-choice questions" : POWERUP[p].text}
            className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold shadow-[inset_0_-3px_0_rgb(0_0_0/0.2)] transition",
              POWER_TILE[p], off ? "opacity-40" : "hover:brightness-110 active:translate-y-px")}>
            <PowerUpIcon kind={p} className="h-4 w-4" />{POWERUP[p].name}
          </button>
        );
      })}
    </div>
  );
}

/** The race: one lane per runner, each right answer a step towards the flag. */
export function RaceTrack({ runners, total, me, teams, dark = false }: {
  runners: NonNullable<GameState["race"]>; total: number; me?: Viewer; teams?: TeamScore[] | null; dark?: boolean;
}) {
  if (!runners.length) return null;
  const color = (team: string | null) => teams?.find((t) => t.team_id === team)?.color;
  return (
    <ol className={cn("space-y-1.5 rounded-2xl p-3 sm:p-4", dark ? "bg-white/[0.06]" : "bg-ink-950 text-white")} aria-label="Race track">
      {runners.map((r) => {
        const pct = Math.min(100, (r.steps / Math.max(total, 1)) * 100);
        const mine = isMe(r, me);
        return (
          <li key={r.key} className="flex items-center gap-3" aria-label={`${r.name}: ${r.steps} of ${total}`}>
            <span className={cn("w-24 shrink-0 truncate text-right text-sm font-semibold sm:w-32", mine && "text-accent-400")}>{r.name}</span>
            <div className="relative h-9 flex-1 rounded-full bg-white/10">
              <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
                style={{ width: `${pct}%`, background: color(r.team_id) ?? (mine ? "rgb(198 238 58 / 0.55)" : "rgb(255 255 255 / 0.16)") }} />
              <span className="absolute top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-ink-900 ring-2 ring-white/30 transition-[left] duration-700 ease-out"
                style={{ left: `clamp(1.125rem, ${pct}%, calc(100% - 1.125rem))` }}>
                <Critter name={r.avatar} className="h-7 w-7" />
              </span>
            </div>
            <Flag className={cn("h-5 w-5 shrink-0", r.steps >= total ? "text-accent-400" : "text-white/40")} aria-hidden />
          </li>
        );
      })}
    </ol>
  );
}

/** Team battle: average per player (the score) with the team's total underneath. */
export function TeamBars({ teams, dark = false }: { teams: TeamScore[]; dark?: boolean }) {
  const top = Math.max(1, ...teams.map((t) => t.score));
  return (
    <ul className="space-y-2" aria-label="Team scores">
      {teams.map((t, i) => (
        <li key={t.team_id} className="flex items-center gap-3">
          <span className={cn("flex w-32 shrink-0 items-center gap-1 truncate text-sm font-bold", dark ? "text-white" : "text-ink-900")}>{i === 0 && t.score > 0 && <Trophy className="h-4 w-4 shrink-0 text-tile-star" aria-label="Leading" />}<span className="truncate">{t.name}</span></span>
          <div className={cn("h-7 flex-1 overflow-hidden rounded-full", dark ? "bg-white/10" : "bg-ink-100")}>
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(t.score / top) * 100}%`, background: t.color }} />
          </div>
          <span className="w-28 shrink-0 text-right">
            <span className={cn("block font-display font-extrabold tabular-nums", dark ? "text-white" : "text-ink-900")}>{t.score.toLocaleString(LOCALE)}</span>
            <span className={cn("block text-[11px]", dark ? "text-ink-300" : "text-ink-500")}>avg · {t.members} players</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export type Moment = { kind: "streak" | "powerup" | "comeback" | "out" | "shield" | "finish"; text: string; power?: PowerUp };

/** A short full-screen moment: a streak, a power-up earned, a comeback, being knocked out. */
export function MomentOverlay({ moment, onDone }: { moment: Moment | null; onDone: () => void }) {
  const [shown, setShown] = useState<Moment | null>(null);
  useEffect(() => {
    if (!moment) return;
    setShown(moment);
    const t = window.setTimeout(() => { setShown(null); onDone(); }, 2200);
    return () => window.clearTimeout(t);
  }, [moment, onDone]);
  if (!shown) return null;
  const bad = shown.kind === "out";
  return (
    <div role="status" className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-ink-950/60 px-6 backdrop-blur-[2px]">
      <div className={cn("relative w-full max-w-sm animate-pop overflow-hidden rounded-3xl p-7 text-center text-white shadow-overlay",
        bad ? "bg-rose-700" : shown.kind === "powerup" && shown.power ? POWER_TILE[shown.power] : "bg-ink-900")}>
        {!bad && <Burst />}
        <span className="relative mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/20" aria-hidden>
          {bad ? <HeartCrack className="h-9 w-9" /> : shown.power ? <PowerUpIcon kind={shown.power} className="h-9 w-9" /> : <Sparkles className="h-9 w-9" />}
        </span>
        <p className="relative mt-3 font-display text-3xl font-extrabold tracking-tight">{shown.text}</p>
        {shown.power && <p className="relative mt-1 text-sm font-semibold opacity-90">{POWERUP[shown.power].text}</p>}
      </div>
    </div>
  );
}

/** Streak milestones worth a moment. */
export function streakMoment(streak: number): Moment | null {
  if (streak === 3) return { kind: "streak", text: "3 in a row!" };
  if (streak === 5) return { kind: "streak", text: "5 in a row! On fire" };
  if (streak === 10) return { kind: "streak", text: "10 in a row! Unstoppable" };
  return null;
}
