import Link from "next/link";
import { SiteHeader, SiteFooter, SectionTitle } from "@/components/site/SiteChrome";
import { GuideScreens, ScreenCount } from "@/components/site/GuideScreens";
import { CAPABILITIES } from "@/lib/capabilities";
import { FEATURES } from "@/lib/features";

export const metadata = { title: "Product guide · Synergy Swift", description: "The complete list of what Synergy Swift does for a school, and a step-by-step guide to its screens." };

/** The complete list, then the mock-up guide: every tour screen with its steps. For schools and investors. */
export default function GuidePage() {
  const count = CAPABILITIES.reduce((n, s) => n + s.items.length, 0);
  const features = FEATURES.reduce((n, g) => n + g.items.length, 0);
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader current="/guide" />
      <main>
        <section className="border-b border-slate-200 bg-paper">
          <div className="mx-auto flex max-w-6xl flex-col justify-between gap-8 px-5 pb-12 pt-14 sm:px-8 sm:pt-20 lg:flex-row lg:items-end">
            <SectionTitle label="Product guide" title="Everything Synergy Swift does for a school."
              text="The complete list, from the gate to the report card, then a guide to the screens themselves: what to press, in order, and what each part gives the school." />
            <dl className="flex gap-8">
              {([[count, "things it does"], [features, `features in ${FEATURES.length} areas`], [<ScreenCount key="s" />, "guided screens"]] as const).map(([v, l]) => (
                <div key={l} className="flex flex-col-reverse"><dt className="text-[12.5px] text-slate-500">{l}</dt><dd className="font-serif text-[34px] font-semibold tabular-nums text-navy">{v}</dd></div>
              ))}
            </dl>
          </div>
        </section>

        <section id="list" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
            <p className="font-mono text-[12px] text-brass-700">Part 1</p>
            <h2 className="mt-1 font-serif text-[30px] font-semibold text-navy">The complete list</h2>
            <p className="mt-2 max-w-2xl text-slate-600">Every capability, grouped the way a school runs. Numbers run straight through, so any item can be referred to by its number.</p>
            <nav aria-label="List sections" className="mt-6 flex flex-wrap gap-2">
              {CAPABILITIES.map(s => <a key={s.letter} href={`#list-${s.letter.toLowerCase()}`} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[13px] text-slate-700 no-underline hover:border-navy hover:text-navy">{s.letter}. {s.title}</a>)}
            </nav>
            <div className="mt-10 gap-11 md:columns-2">
              {CAPABILITIES.map(s => (
                <section key={s.letter} id={`list-${s.letter.toLowerCase()}`} className="mb-8 scroll-mt-20 break-inside-avoid">
                  <h3 className="flex items-baseline gap-2.5 border-b border-slate-200 pb-2 font-serif text-[19px] font-semibold text-navy"><span className="font-mono text-[13px] font-normal text-brass-700">{s.letter}</span>{s.title}</h3>
                  <ol>
                    {s.items.map(i => (
                      <li key={i.n} className="grid grid-cols-[2.2em_1fr] gap-1 border-b border-dotted border-slate-200 py-1.5 text-[14.5px] leading-relaxed last:border-b-0">
                        <span className="font-mono text-[12px] leading-[1.9] tabular-nums text-slate-400">{i.n}</span>
                        <div>
                          {i.lead && <strong className="font-semibold text-navy">{i.lead}{i.text ? ": " : "."}</strong>}{i.text}
                          {i.more && <ul className="mt-1 list-disc pl-5 text-slate-600">{i.more.map(m => <li key={m}>{m}</li>)}</ul>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          </div>
        </section>

        <section id="guide" className="scroll-mt-20 bg-canvas">
          <div className="mx-auto max-w-6xl px-5 pt-14 sm:px-8">
            <p className="font-mono text-[12px] text-brass-700">Part 2</p>
            <h2 className="mt-1 font-serif text-[30px] font-semibold text-navy">Mock-up guide</h2>
            <p className="mt-2 max-w-2xl text-slate-600">Each screen is the one in <Link href="/tour" className="text-navy">Take a tour</Link>, shown at the end of its walk-through. Follow the numbered steps to do the same in the app. The school, names and figures are sample data.</p>
            <nav aria-label="Guide areas" className="mb-10 mt-6 flex flex-wrap gap-2">
              {FEATURES.map(g => <a key={g.id} href={`#${g.id}`} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[13px] text-slate-700 no-underline hover:border-navy hover:text-navy">{g.title}</a>)}
            </nav>
            <GuideScreens />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
