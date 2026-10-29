import Link from "next/link";
import { SiteHeader, SiteFooter, SectionTitle } from "@/components/site/SiteChrome";
import { FEATURES } from "@/lib/features";

export const metadata = { title: "Features · Synergy Swift", description: "Everything Synergy Swift does for a school: students, results, exams, teaching, fees, safety, families and leadership." };

/** Everything the system does, grouped as schools think about their work. */
export default function FeaturesPage() {
  const count = FEATURES.reduce((n, g) => n + g.items.length, 0);
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader current="/features" />
      <main>
        <section className="border-b border-slate-200 bg-paper">
          <div className="mx-auto max-w-6xl px-5 pb-12 pt-14 sm:px-8 sm:pt-20">
            <SectionTitle label="Features" title="Everything your school runs on, in one system."
              text={`${count} things Synergy Swift does, from the first enquiry to the last report card. Each one works from the same record, so nothing is typed twice.`} />
            <nav aria-label="Feature groups" className="mt-8 flex flex-wrap gap-2">
              {FEATURES.map(g => <a key={g.id} href={`#${g.id}`} className="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-[13px] text-slate-700 no-underline hover:border-navy hover:text-navy">{g.title}</a>)}
            </nav>
          </div>
        </section>
        {FEATURES.map((g, gi) => (
          <section key={g.id} id={g.id} className={`scroll-mt-20 border-b border-slate-200 ${gi % 2 ? "bg-canvas" : ""}`}>
            <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                <div>
                  <p className="font-mono text-[12px] text-brass-700">0{gi + 1}</p>
                  <h2 className="mt-1 font-serif text-[28px] font-semibold leading-tight tracking-[-0.015em] text-navy">{g.title}</h2>
                  <p className="mt-2 text-slate-600">{g.intro}</p>
                </div>
              </div>
              <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map(f => (
                  <article key={f.title} className="flex flex-col bg-white p-6">
                    <h3 className="text-[16px] font-semibold text-navy">{f.title}</h3>
                    <p className="mt-2 flex-1 text-[14px] leading-relaxed text-slate-600">{f.text}</p>
                    <p className="mt-4 flex gap-2 border-t border-slate-100 pt-3 text-[13px] text-slate-800"><span aria-hidden className="mt-[9px] h-px w-3 shrink-0 bg-brass-500" />{f.benefit}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        ))}
        <section className="bg-navy text-white">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-16 sm:px-8 lg:flex-row lg:items-center">
            <div>
              <h2 className="font-serif text-[30px] font-semibold leading-tight">See it working before you decide.</h2>
              <p className="mt-2 max-w-xl text-white/70">The tour clicks through every part of the system, the way your staff will use it.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/tour" className="btn bg-white px-5 py-2.5 text-[15px] text-navy no-underline hover:bg-white/90">Take a tour</Link>
              <Link href="/guide" className="btn border border-white/35 px-5 py-2.5 text-[15px] text-white no-underline hover:bg-white/10">Read the guide</Link>
              <Link href="/onboard" className="btn border border-white/35 px-5 py-2.5 text-[15px] text-white no-underline hover:bg-white/10">Sign up your school</Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
