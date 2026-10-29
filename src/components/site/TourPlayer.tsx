"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import type { Done } from "@/components/site/tour-scenes";
import { CHAPTERS, GROUPS } from "@/components/site/tour-chapters";

/**
 * "Take a tour": the whole system played like a screen recording. A cursor moves
 * to each button in a mock of the app and clicks it; the screen answers as the real
 * one does; a caption says what is happening and, at the end of each chapter, what
 * it gives the school. Play, pause, jump to a chapter, or use the keyboard
 * (space, arrow keys). With reduced motion it starts paused.
 */
const MOVE_MS = 900;     // cursor travel, then the click
const STEP_MS = 2600;    // one step in all
const END_MS = 3200;     // the benefit card at the end of a chapter

const SIDEBAR = ["Home", "Students", "Attendance", "Teaching", "Exams", "Results", "Fees", "Office", "Safety", "Families", "Settings"];
const totalSteps = CHAPTERS.reduce((n, c) => n + c.steps.length + 1, 0);
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
const TOTAL_MS = CHAPTERS.reduce((n, c) => n + c.steps.length * STEP_MS + END_MS, 0);

export function TourPlayer() {
  const [ch, setCh] = useState(0);
  const [s, setS] = useState(0);              // step index; steps.length = the benefit card
  const [clicked, setClicked] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [cursor, setCursor] = useState({ x: 70, y: 70 });
  const stage = useRef<HTMLDivElement>(null);
  const C = CHAPTERS[ch];
  const atEnd = s >= C.steps.length;
  const step = C.steps[Math.min(s, C.steps.length - 1)];

  useEffect(() => { if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setPlaying(false); }, []);
  useEffect(() => { document.querySelector<HTMLElement>('nav[aria-label="Chapters"] [aria-current="step"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [ch]);

  // Move the cursor to this step's target.
  useLayoutEffect(() => {
    if (atEnd || !stage.current) return;
    const el = stage.current.querySelector<HTMLElement>(`[data-tour="${step.at}"]`);
    if (!el) return;
    const a = stage.current.getBoundingClientRect(), b = el.getBoundingClientRect();
    setCursor({ x: b.left - a.left + Math.min(b.width / 2, 60), y: b.top - a.top + b.height / 2 });
  }, [ch, s, atEnd, step.at]);

  const go = useCallback((c: number, st = 0) => { setCh((c + CHAPTERS.length) % CHAPTERS.length); setS(st); setClicked(false); }, []);
  const next = useCallback(() => { if (s < C.steps.length) { setS(s + 1); setClicked(false); } else go(ch + 1); }, [s, C.steps.length, ch, go]);
  const prev = useCallback(() => { if (s > 0) { setS(s - 1); setClicked(true); } else if (ch > 0) go(ch - 1, CHAPTERS[ch - 1].steps.length); }, [s, ch, go]);

  useEffect(() => {
    if (!playing) return;
    if (atEnd) { const t = setTimeout(next, END_MS); return () => clearTimeout(t); }
    if (!clicked) { const t = setTimeout(() => setClicked(true), MOVE_MS); return () => clearTimeout(t); }
    const t = setTimeout(next, STEP_MS - MOVE_MS);
    return () => clearTimeout(t);
  }, [playing, atEnd, clicked, next]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key === " ") { e.preventDefault(); setPlaying(p => !p); }
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [next, prev]);

  // Where we are on the whole timeline, like a video.
  const before = CHAPTERS.slice(0, ch).reduce((n, c) => n + c.steps.length * STEP_MS + END_MS, 0);
  const elapsed = before + Math.min(s, C.steps.length) * STEP_MS + (clicked && !atEnd ? MOVE_MS : 0);
  const done: Done = n => s > n || (s === n && clicked);

  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div>
          {/* The "screen" */}
          <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-overlay">
            <div className="flex h-9 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3.5">
              <span className="flex gap-1.5" aria-hidden><span className="h-2.5 w-2.5 rounded-full bg-slate-300" /><span className="h-2.5 w-2.5 rounded-full bg-slate-300" /><span className="h-2.5 w-2.5 rounded-full bg-slate-300" /></span>
              <span className="ml-2 truncate rounded bg-white px-2 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-200">app.synergyswift.ng/{C.path}</span>
            </div>
            <div ref={stage} className="relative grid min-h-[430px] grid-cols-[150px_1fr] max-sm:grid-cols-1" aria-live="off">
              <aside className="border-r border-slate-200 bg-slate-50/70 p-3 max-sm:hidden">
                <div className="mb-4 flex items-center gap-2"><BrandMark className="h-6 w-6" /><span className="truncate text-[12px] font-semibold">Greenfield College</span></div>
                <ul className="space-y-0.5 text-[12px]">
                  {SIDEBAR.map(m => <li key={m} className={`rounded px-2 py-1.5 ${m === C.area ? "bg-white font-medium text-navy ring-1 ring-slate-200" : "text-slate-600"}`}>{m}</li>)}
                </ul>
              </aside>
              <div className="min-w-0 p-4 sm:p-5" key={ch}>
                <div className="ss-rise"><C.Scene done={done} step={s} /></div>
              </div>
              {/* The cursor and its click */}
              {!atEnd && (
                <div aria-hidden className="pointer-events-none absolute left-0 top-0 z-20 transition-transform duration-[850ms] ease-[cubic-bezier(.4,0,.2,1)]" style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}>
                  {clicked && <span key={`${ch}-${s}`} className="tour-click absolute -left-4 -top-4 h-8 w-8 rounded-full border-2 border-brass-500" />}
                  <svg width="22" height="22" viewBox="0 0 22 22" className="-translate-x-[3px] -translate-y-[2px] drop-shadow"><path d="M3 2l15 8.5-6.6 1.6L8.5 19z" fill="#1b2d55" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" /></svg>
                </div>
              )}
              {/* What it gives the school, at the end of each chapter */}
              {atEnd && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-navy/85 p-6">
                  <div className="ss-rise max-w-md text-center text-white">
                    <p className="font-mono text-[12px] text-brass-300">What it gives your school</p>
                    <p className="mt-3 font-serif text-[24px] font-semibold leading-snug">{C.benefit}</p>
                    <p className="mt-3 text-sm text-white/70">Next: {CHAPTERS[(ch + 1) % CHAPTERS.length].title}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Caption and controls, like a video player */}
          <div className="mt-4">
            <p className="min-h-[52px] text-[15.5px] leading-relaxed text-slate-800" aria-live="polite">
              <span className="mr-2 font-mono text-[12px] text-brass-700">{ch + 1}.{Math.min(s + 1, C.steps.length)}</span>
              {atEnd ? C.benefit : step.say}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <button type="button" className="btn h-9 w-9 bg-navy p-0 text-white hover:bg-brand-900" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>
                {playing ? <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z" fill="currentColor" /></svg>
                  : <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M4.5 2.5v11l9-5.5z" fill="currentColor" /></svg>}
              </button>
              <button type="button" className="btn btn-outline h-9 w-9 p-0" onClick={prev} aria-label="Back one step"><svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg></button>
              <button type="button" className="btn btn-outline h-9 w-9 p-0" onClick={next} aria-label="Forward one step"><svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg></button>
              <div className="relative h-1.5 flex-1 rounded-full bg-slate-200" role="slider" aria-label="Tour position" aria-valuemin={0} aria-valuemax={totalSteps} aria-valuenow={Math.round((elapsed / TOTAL_MS) * totalSteps)}>
                <div className="absolute inset-y-0 left-0 rounded-full bg-brass-500 transition-[width] duration-700" style={{ width: `${(elapsed / TOTAL_MS) * 100}%` }} />
                {/* One marker per area (eight), so they stay big enough to tap; the chapter list jumps to any chapter. */}
                {GROUPS.map(g => {
                  const i = CHAPTERS.findIndex(c => c.group === g.id);
                  if (i < 0) return null;
                  const at = CHAPTERS.slice(0, i).reduce((n, x) => n + x.steps.length * STEP_MS + END_MS, 0) / TOTAL_MS;
                  return <button key={g.id} type="button" title={g.title} aria-label={`Jump to ${g.title}`} onClick={() => go(i)} className="absolute -top-[5px] h-4 w-2.5 -translate-x-1/2 rounded-sm bg-slate-400 hover:bg-navy" style={{ left: `${at * 100}%` }} />;
                })}
              </div>
              <span className="w-[88px] text-right font-mono text-[12px] tabular-nums text-slate-500">{mmss(elapsed)} / {mmss(TOTAL_MS)}</span>
            </div>
          </div>
        </div>

        {/* Chapters, by area, as on the Features page */}
        <nav aria-label="Chapters" className="-mx-5 overflow-x-auto px-5 lg:mx-0 lg:max-h-[620px] lg:overflow-y-auto lg:px-0 lg:pr-1">
          <ol className="flex gap-2 lg:block lg:space-y-3">
            {GROUPS.map(g => (
              <li key={g.id} className="contents lg:block">
                <p className="hidden px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400 lg:block">{g.title}</p>
                <ol className="contents lg:block lg:space-y-0.5">
                  {CHAPTERS.map((c, i) => c.group !== g.id ? null : (
                    <li key={c.id} className="shrink-0">
                      <button type="button" onClick={() => go(i)} aria-current={i === ch ? "step" : undefined}
                        className={`flex w-full items-baseline gap-2.5 rounded-lg border px-3 py-1.5 text-left text-[13px] ${i === ch ? "border-navy bg-white font-medium text-navy" : "border-transparent text-slate-600 hover:bg-white"}`}>
                        <span className={`font-mono text-[11px] tabular-nums ${i === ch ? "text-brass-700" : "text-slate-400"}`}>{String(i + 1).padStart(2, "0")}</span>
                        <span className="whitespace-nowrap lg:whitespace-normal">{c.title}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </nav>
      </div>
    </div>
  );
}
