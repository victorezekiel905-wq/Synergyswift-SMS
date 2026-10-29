"use client";
import Link from "next/link";
import { CHAPTERS } from "@/components/site/tour-chapters";
import { FEATURES } from "@/lib/features";

/**
 * The mock-up guide on /guide: every "Take a tour" screen, shown as it ends,
 * beside its steps in order and what it gives the school. Grouped by the
 * areas of the Features page.
 */
const all = () => true;

/** How many screens there are (the chapters live in client code). */
export const ScreenCount = () => <>{CHAPTERS.length}</>;

export function GuideScreens() {
  let n = 0;
  return (
    <>
      {FEATURES.map((g, gi) => {
        const chapters = CHAPTERS.filter(c => c.group === g.id);
        return (
          <section key={g.id} id={g.id} className="scroll-mt-20 border-t border-slate-200 py-12">
            <p className="font-mono text-[12px] text-brass-700">Area {gi + 1} of {FEATURES.length} · {chapters.length} screen{chapters.length === 1 ? "" : "s"}</p>
            <h3 className="mt-1 font-serif text-[26px] font-semibold leading-tight text-navy">{g.title}</h3>
            <p className="mt-2 max-w-2xl text-slate-600">{g.intro} <Link href={`/features#${g.id}`} className="text-navy">The features in this area</Link></p>
            {chapters.map(c => {
              n++;
              return (
                <article key={c.id} id={`screen-${c.id}`} className="grid scroll-mt-20 items-start gap-6 border-b border-dashed border-slate-200 py-8 last:border-b-0 lg:grid-cols-[1.25fr_1fr] lg:gap-8">
                  <figure className="min-w-0 overflow-hidden rounded-xl border border-slate-300 bg-white shadow-overlay">
                    <div className="flex h-8 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3" aria-hidden>
                      <span className="flex gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-300" /><span className="h-2 w-2 rounded-full bg-slate-300" /><span className="h-2 w-2 rounded-full bg-slate-300" /></span>
                      <span className="ml-2 truncate rounded bg-white px-2 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-200">app.synergyswift.ng/{c.path}</span>
                    </div>
                    <div className="overflow-x-auto"><div className="min-w-[340px] p-4 sm:p-5"><c.Scene done={all} step={c.steps.length - 1} /></div></div>
                  </figure>
                  <div className="min-w-0">
                    <p className="font-mono text-[12px] text-brass-700">Screen {n} of {CHAPTERS.length} · {c.area} menu</p>
                    <h4 className="mt-1 font-serif text-[21px] font-semibold text-navy">{c.title}</h4>
                    <ol className="mt-3 space-y-2.5">
                      {c.steps.map((s, i) => (
                        <li key={i} className="grid grid-cols-[26px_1fr] gap-2.5 text-[14.5px] leading-relaxed text-slate-800">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-navy font-mono text-[12px] text-navy">{i + 1}</span>{s.say}
                        </li>
                      ))}
                    </ol>
                    <div className="mt-4 rounded-md bg-brass-100 px-4 py-3">
                      <p className="font-mono text-[11px] uppercase tracking-wide text-brass-700">What it gives the school</p>
                      <p className="mt-0.5 font-serif text-[16px] font-medium leading-snug text-navy">{c.benefit}</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
