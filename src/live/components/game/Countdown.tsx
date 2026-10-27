"use client";
import { useEffect, useRef } from "react";
import { useNow } from "@/live/lib/hooks";
import { cn } from "@/live/lib/utils";

/**
 * Countdown driven by server timestamps corrected for clock skew. onDone fires once
 * when it reaches zero, so screens fetch the reveal then instead of on the next poll.
 */
export function Countdown({ endsAt, serverNow, fetchedAt, total, className, onDone }: {
  endsAt: string | null; serverNow: string; fetchedAt: number; total: number; className?: string; onDone?: () => void;
}) {
  const now = useNow(250);
  const skew = new Date(serverNow).getTime() - fetchedAt;
  const left = endsAt ? Math.max(0, (new Date(endsAt).getTime() - (now + skew)) / 1000) : null;
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (endsAt && total > 0 && left === 0 && fired.current !== endsAt) { fired.current = endsAt; onDone?.(); }
  }, [endsAt, total, left, onDone]);
  if (!endsAt || left == null) return null;
  if (total === 0) return <p className={cn("text-sm font-medium text-ink-600", className)}>No timer: take your time and think it through.</p>;
  const frac = Math.min(1, left / total);
  return (
    <div className={cn("flex items-center gap-3", className)} aria-live="off">
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-ink-200">
        <div className={cn("h-full rounded-full transition-[width] duration-200", frac < 0.25 ? "bg-rose-500" : "bg-brand-500")} style={{ width: `${frac * 100}%` }} />
      </div>
      <span className="w-10 text-right font-mono text-lg font-bold tabular-nums">{Math.ceil(left)}</span>
    </div>
  );
}
