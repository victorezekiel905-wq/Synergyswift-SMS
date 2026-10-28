import Link from "next/link";
import { SiteHeader, SiteFooter, SectionTitle } from "@/components/site/SiteChrome";
import { Tour } from "@/components/site/Tour";

export const metadata = { title: "How it works · Synergy Swift", description: "Watch a school run on Synergy Swift, from onboarding to the head's weekly report." };

/** The whole system, played out step by step. */
export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader current="/how-it-works" />
      <main>
        <section className="border-b border-slate-200 bg-paper">
          <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-8 sm:pt-20">
            <SectionTitle label="How it works" title="Watch a school run on Synergy Swift."
              text="Seven steps, from the day a school joins to the head's weekly report. It plays by itself; pick any step to jump to it, or pause and go one beat at a time." />
            <div className="mt-12"><Tour /></div>
          </div>
        </section>
        <section className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-3">
          {[
            ["Have an onboarding code?", "Set up your school now. The code works once and lasts 20 minutes.", "/onboard", "Onboard your school"],
            ["Want to see it with your school?", "A 30-minute walk-through for the proprietor, the head and the bursar.", "/demo", "Book a walk-through"],
            ["In a lesson right now?", "Enter the code on the projector. No account needed.", "/live/join", "Join a class as a guest"]
          ].map(([t, d, href, cta]) => (
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
