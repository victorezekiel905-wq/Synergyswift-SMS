"use client";
import { useState } from "react";
import { Check, Lock } from "lucide-react";
import { Critter } from "@/live/components/live/Critter";
import { AVATARS, RARITY, type Rarity } from "@/live/components/live/avatars";
import { Alert, useToast } from "@/live/components/ui";
import { useRpc } from "@/live/lib/hooks";
import { errorText, rpc } from "@/live/lib/rpc";
import { cn, LOCALE } from "@/live/lib/utils";

export type Mine = {
  xp: number; level: number; chosen: string | null;
  characters: { key: string; unlock_xp: number; rarity: Rarity; unlocked: boolean; unlocked_at: string | null }[];
  next: { key: string; unlock_xp: number; to_go: number } | null;
};

/** sample: fixed data for the design preview (no database). */
export function CharacterCollection({ sample }: { sample?: Mine } = {}) {
  const toast = useToast();
  const mine = useRpc<Mine>("my_characters", {}, [], { enabled: !sample });
  const [busy, setBusy] = useState<string | null>(null);
  const m = sample ?? mine.data;
  if (mine.error && !m) return <Alert tone="error">{mine.error}</Alert>;
  if (!m) return <p className="text-sm text-ink-500">Loading your characters…</p>;
  const got = m.characters.filter((c) => c.unlocked).length;
  // Progress from the last unlock to the next one.
  const prev = Math.max(0, ...m.characters.filter((c) => c.unlock_xp <= m.xp).map((c) => c.unlock_xp));
  const pct = m.next ? Math.min(100, ((m.xp - prev) / Math.max(1, m.next.unlock_xp - prev)) * 100) : 100;

  async function choose(key: string) {
    setBusy(key);
    try { await rpc("choose_character", { p_key: key }); await mine.reload(); toast(`You play as the ${AVATARS[key]} now.`, "success"); }
    catch (e) { toast(errorText(e), "error"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 rounded-2xl bg-ink-950 p-5 text-white sm:grid-cols-[auto_1fr] sm:items-center">
        <span className="grid h-20 w-20 place-items-center rounded-2xl bg-white/10"><Critter name={m.chosen} className="h-16 w-16" /></span>
        <div>
          <p className="text-sm text-ink-300">Level {m.level} · {got} of {m.characters.length} collected</p>
          <p className="font-display text-3xl font-extrabold tabular-nums text-accent-400">{m.xp.toLocaleString(LOCALE)} XP</p>
          {m.next ? (
            <>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-accent-400" style={{ width: `${pct}%` }} /></div>
              <p className="mt-1.5 text-sm text-ink-300">{m.next.to_go.toLocaleString(LOCALE)} XP to unlock the {AVATARS[m.next.key]}</p>
            </>
          ) : <p className="mt-1 text-sm text-ink-300">You have every character. Legendary!</p>}
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {m.characters.map((c) => {
          const chosen = m.chosen === c.key;
          return (
            <li key={c.key}>
              <button type="button" disabled={!c.unlocked || chosen || busy !== null} onClick={() => choose(c.key)}
                aria-pressed={chosen} aria-label={c.unlocked ? `${AVATARS[c.key]}${chosen ? ", playing as" : ", choose"}` : `${AVATARS[c.key]}, locked: ${c.unlock_xp} XP`}
                className={cn("relative flex w-full flex-col items-center rounded-2xl border bg-white p-4 text-center transition",
                  c.unlocked ? "border-ink-200 hover:border-ink-400" : "border-dashed border-ink-200 bg-ink-50",
                  chosen && "border-ink-900 ring-2 ring-ink-900")}>
                <span className={cn("grid h-20 w-20 place-items-center rounded-2xl ring-2", c.unlocked ? RARITY[c.rarity].ring : "ring-transparent")}>
                  <Critter name={c.key} className={cn("h-16 w-16", !c.unlocked && "opacity-25 grayscale")} />
                </span>
                {!c.unlocked && <Lock className="absolute right-3 top-3 h-4 w-4 text-ink-400" aria-hidden />}
                {chosen && <Check className="absolute right-3 top-3 h-5 w-5 text-emerald-700" aria-hidden />}
                <span className="mt-2 font-display font-bold text-ink-900">{AVATARS[c.key]}</span>
                <span className="text-xs text-ink-500">{RARITY[c.rarity].name}{c.unlocked ? (chosen ? " · playing as" : "") : ` · ${c.unlock_xp.toLocaleString(LOCALE)} XP`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
