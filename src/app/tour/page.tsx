import Link from "next/link";
import { SiteHeader, SiteFooter, SectionTitle } from "@/components/site/SiteChrome";
import { TourPlayer } from "@/components/site/TourPlayer";

export const metadata = { title: "Take a tour · Synergy Swift", description: "Watch Synergy Swift being used, click by click: setup, classes, admissions, registers, live lessons, exams, results, fees, safety, parents and the head's view." };

/** The whole system, played like a screen recording. */
export default function TourPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader current="/tour" />
      <main>
        <section className="border-b border-slate-200 bg-paper">
          <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-8 sm:pt-20">
            <SectionTitle label="Take a tour" title="Watch a school run on Synergy Swift."
              text="Forty short chapters covering everything the system does, played like a screen recording: what to click, what happens, and what it gives your school. Pause any time, step through, or jump to a chapter." />
            <div className="mt-10"><TourPlayer /></div>
          </div>
        </section>
        <section className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-3">
          {([
            ["Ready to start?", "Sign up with the onboarding code from Synergy Swift. It works once, for 20 minutes.", "/onboard", "Sign up your school"],
            ["See every feature", "Everything the system does, in eight areas.", "/features", "Features"],
            ["In a lesson right now?", "Enter the code on the projector. No account needed.", "/live/join", "Join a class as a guest"]
          ] as const).map(([t, d, href, cta]) => (
            <div key={href} className="border-t border-navy pt-5">
              <h2 className="font-serif text-xl font-semibold text-navy">{t}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-600">{d}</p>
              <Link href={href} className="mt-4 inline-block text-[14px] font-medium text-navy">{cta} →</Link>
            </div>
          ))}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
