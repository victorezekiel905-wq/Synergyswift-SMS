import Link from "next/link";
import { Icon } from "@/components/ui";
import { DEFAULT_PLANS } from "@/lib/saas";
import { SiteHeader, SiteFooter, SectionTitle } from "@/components/site/SiteChrome";
import { BrandDial } from "@/components/site/BrandDial";
import { ExamPicture, LessonPicture, PhonePicture } from "@/components/site/Pictures";

type IconName = Parameters<typeof Icon>[0]["name"];

const OFFICES: { icon: IconName; title: string; text: string; items: string[] }[] = [
  { icon: "people", title: "Front office", text: "From the first enquiry to the first day.", items: ["Enquiries and follow-ups", "Online applications and form fees", "Entrance tests, interviews, offers", "Visitors and pickup codes"] },
  { icon: "book", title: "Classroom", text: "Less paperwork, more teaching.", items: ["Registers that work offline", "Timetables, cover and lesson notes", "Homework and marking", "Live lessons and class games"] },
  { icon: "ticket", title: "Exams", text: "Computer-based tests you can trust.", items: ["23 question types, 17 subject tools", "Safe Exam Browser lock per paper", "Hall check-in and invigilation", "Result PINs and scratch cards"] },
  { icon: "card", title: "Bursary", text: "Every naira accounted for.", items: ["Invoices, instalments, discounts", "Paystack, Flutterwave and Remita", "Debtor follow-up and promises to pay", "Payroll with PAYE, pension, NHF"] },
  { icon: "hand", title: "Welfare and safety", text: "Know where every child is.", items: ["Gate sign-in and school buses", "Sick bay, medicines, allergies", "Safeguarding and special needs", "Boarding and exeat"] },
  { icon: "chart", title: "Leadership", text: "The whole school at a glance.", items: ["Report cards and transcripts", "Attendance and fees, live", "Reports across a group of schools", "Inspection packs and the census"] }
];

const DAY: [string, string, string][] = [
  ["07:42", "At the gate", "Ada scans in. Her mother gets a WhatsApp message."],
  ["08:05", "Registers", "Every class marked by ten past eight, even offline."],
  ["10:20", "A live lesson", "The class answers on phones; guests join with a code."],
  ["13:00", "A test", "Marked as soon as it ends, straight into the markbook."],
  ["15:10", "Fees", "A parent pays online; the receipt and the books update."],
  ["17:00", "The head's view", "Attendance, fees and results for the day, on one page."]
];

const PRINCIPLES: [string, string][] = [
  ["Exact", "Marks, money and minutes add up to the last kobo and the last child. Every change is recorded: who, what and when."],
  ["Calm", "One clear screen for each job. The thing you need is the obvious thing on the page."],
  ["Dependable", "Built for slow connections and busy mornings. Registers work offline; exams hold up on results day."]
];

const TRUST: { icon: IconName; title: string; text: string }[] = [
  { icon: "lock", title: "Walled off by school", text: "Each school's records are kept apart from every other school's, down to the database." },
  { icon: "note", title: "Every change recorded", text: "Grades, fees, registers and settings all keep their history." },
  { icon: "user", title: "The right people only", text: "Roles per job, two-step sign-in and approved devices for staff." },
  { icon: "check", title: "Data protection", text: "Built to the Nigeria Data Protection Act 2023, with consent and data requests handled in the app." }
];

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

/** The welcome page. Signed-in visitors are taken to their dashboard by the app shell. */
export default function Home() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader current="/" />
      <main>
        {/* Welcome */}
        <section className="border-b border-slate-200 bg-paper">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 pb-16 pt-14 sm:px-8 sm:pt-20 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:gap-16 lg:pb-24">
            <div>
              <p className="ss-rise flex items-center gap-3 text-[13px] text-brass-700"><span aria-hidden className="h-px w-6 bg-current" />School management and learning, built in Nigeria</p>
              <h1 className="ss-rise mt-5 font-serif text-[42px] font-semibold leading-[1.04] tracking-[-0.025em] text-navy sm:text-[60px]" style={{ ["--d" as string]: ".08s" }}>
                Every part of the school, in step.
              </h1>
              <p className="ss-rise mt-6 max-w-xl text-[17px] leading-relaxed text-slate-600" style={{ ["--d" as string]: ".16s" }}>
                Admissions, registers, lessons, exams, results, fees and the parent app all work from one record. Teachers stop re-typing,
                the bursary sees every payment, and parents know how their child is doing, the moment it happens.
              </p>
              <div className="ss-rise mt-9 flex flex-wrap gap-3" style={{ ["--d" as string]: ".24s" }}>
                <Link href="/onboard" className="btn bg-navy px-5 py-2.5 text-[15px] text-white no-underline hover:bg-brand-900">Onboard your school</Link>
                <Link href="/how-it-works" className="btn btn-outline px-5 py-2.5 text-[15px] no-underline">
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-brass-600" aria-hidden><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg>See how it works
                </Link>
              </div>
              {/* Students: straight into a lesson, no account. Works without JavaScript. */}
              <form action="/live/join" method="get" className="ss-rise mt-10 max-w-md rounded-lg border border-slate-200 bg-white p-3" style={{ ["--d" as string]: ".32s" }}>
                <label htmlFor="guest-code" className="block px-1 text-[12.5px] text-slate-500">Joining a lesson? Enter the code on your teacher&apos;s screen. No account needed.</label>
                <div className="mt-2 flex gap-2">
                  <input id="guest-code" name="code" required inputMode="text" autoComplete="off" autoCapitalize="characters" maxLength={10} pattern="[A-Za-z0-9 -]{6,10}" title="The 6 to 8 letters or numbers on your teacher’s screen"
                    placeholder="123456" className="input font-mono uppercase tracking-[0.2em]" />
                  <button className="btn shrink-0 bg-navy px-4 text-white hover:bg-brand-900">Join as a guest</button>
                </div>
              </form>
            </div>
            <BrandDial className="mx-auto w-full max-w-[460px] lg:max-w-none" />
          </div>
        </section>

        {/* Measures */}
        <section aria-label="In numbers" className="border-b border-slate-200">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 divide-slate-200 px-5 sm:px-8 lg:grid-cols-4 lg:divide-x">
            {[["6", "offices on one record", "front office to the head's desk"], ["23", "exam question types", "with a locked exam browser"], ["4", "ways to reach parents", "WhatsApp, SMS, email, app"], ["3", "payment gateways", "Paystack, Flutterwave, Remita"]].map(([n, l, h]) => (
              <div key={l} className="py-8 lg:px-8 lg:first:pl-0">
                <dt className="sr-only">{l}</dt>
                <dd><span className="font-serif text-4xl font-semibold tabular-nums text-navy">{n}</span>
                  <span className="mt-1 block text-sm font-medium text-slate-800">{l}</span>
                  <span className="block text-[13px] text-slate-500">{h}</span></dd>
              </div>
            ))}
          </dl>
        </section>

        {/* What it does */}
        <section id="product" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24 sm:px-8">
          <SectionTitle label="What it does" title="One record. Six offices. Nothing typed twice."
            text="A child is entered once. The register, the exam hall, the bursary, the sick bay and the report card all see the same child, so nothing goes missing between offices." />
          <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
            {OFFICES.map((o, i) => (
              <article key={o.title} className="bg-white p-7">
                <div className="flex items-center justify-between">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-navy"><Icon name={o.icon} className="h-5 w-5" /></span>
                  <span className="font-mono text-[11px] text-slate-400">0{i + 1}</span>
                </div>
                <h3 className="mt-5 text-[17px] font-semibold text-navy">{o.title}</h3>
                <p className="mt-1 text-sm text-slate-500">{o.text}</p>
                <ul className="mt-4 space-y-2 text-[14px] text-slate-700">
                  {o.items.map(t => <li key={t} className="flex gap-2.5"><span aria-hidden className="mt-[9px] h-px w-3 shrink-0 bg-brass-500" />{t}</li>)}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* A day */}
        <section className="bg-navy text-white">
          <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
            <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
              <SectionTitle onDark label="A day at school" title="From the gate at dawn to the head's desk at five." />
              <Link href="/how-it-works" className="btn self-start border border-white/30 px-5 py-2.5 text-white no-underline hover:bg-white/10 lg:self-auto">Watch the whole tour</Link>
            </div>
            <ol className="relative mt-16 grid gap-10 sm:grid-cols-2 lg:grid-cols-6 lg:gap-6">
              <span aria-hidden className="absolute left-0 right-0 top-[5px] hidden h-px bg-white/20 lg:block" />
              {DAY.map(([t, title, text]) => (
                <li key={t} className="relative">
                  <span aria-hidden className="block h-[11px] w-[11px] rounded-full border border-brass-300 bg-navy" />
                  <p className="mt-5 font-mono text-[13px] tabular-nums text-brass-300">{t}</p>
                  <p className="mt-1.5 font-medium">{title}</p>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/65">{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <Feature id="exams" label="Exams" title="Computer-based tests that hold up on results day."
          text="Set papers with 23 question types and subject tools, from chemistry equations to maths working. Lock a paper to the Safe Exam Browser with one switch, check candidates into the hall, and publish results families open with a PIN."
          points={["Marking done for you, with moderation for written answers", "Extra time and special arrangements per candidate", "Entrance exams for applicants, online or at your centre"]}
          picture={<ExamPicture />} />
        <Feature id="learning" flip label="Teaching" title="Lessons the class actually joins in."
          text="Teachers present on the projector while students answer on their phones, signed in or as guests with a code. Quizzes become team battles and races, and every answer lands in the teacher's markbook."
          points={["Live lessons with polls, questions and drawing", "Five game modes, from team battles to homework races", "Class points and a class story parents can follow"]}
          picture={<LessonPicture />} />
        <Feature id="families" label="Families" title="Parents see what matters, the moment it happens."
          text="One page for every child: arrival at the gate, the register, homework, results, fees and the bus. Messages arrive on WhatsApp or by text when the parent prefers it, in their own language."
          points={["Pay fees online and get the receipt at once", "Report cards and transcripts on the phone", "Two-way messages with the class teacher"]}
          picture={<PhonePicture />} />

        {/* The brand */}
        <section className="border-y border-slate-200 bg-paper">
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-24 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/synergy-swift-seal.svg" alt="The Synergy Swift seal" width={512} height={512} className="mx-auto w-full max-w-[340px]" />
            <div>
              <SectionTitle label="How we build it" title="Made with the care of an instrument."
                text="The seal goes on every report card, transcript and certificate the system prints. We hold the software behind it to the same standard." />
              <dl className="mt-10 grid gap-8 sm:grid-cols-3">
                {PRINCIPLES.map(([t, d], i) => (
                  <div key={t} className="border-t border-navy pt-4">
                    <dt className="flex items-baseline gap-2 font-serif text-xl font-semibold text-navy"><span className="font-mono text-[11px] font-normal text-brass-700">0{i + 1}</span>{t}</dt>
                    <dd className="mt-2 text-[14px] leading-relaxed text-slate-600">{d}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* Trust */}
        <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <SectionTitle label="Safety" title="Children's records deserve care. We built for it from the first line." />
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map(t => (
              <div key={t.title}>
                <Icon name={t.icon} className="h-5 w-5 text-navy" />
                <h3 className="mt-4 font-semibold text-navy">{t.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-slate-600">{t.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-20 border-t border-slate-200 bg-canvas">
          <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
            <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <SectionTitle label="Pricing" title="One yearly price, set by the size of your school."
                text="Priced by the number of students. Staff and parents are free. Prices below are for schools of up to 100 students; we send an exact quote for yours." />
              <Link href="/demo" className="btn btn-outline self-start bg-white px-5 py-2.5 no-underline lg:self-auto">Get a quote</Link>
            </div>
            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {DEFAULT_PLANS.filter(p => (p.prices?.[0] ?? 0) > 0).slice(0, 3).map((p, i) => (
                <article key={p.code} className={`flex flex-col rounded-xl border bg-white p-7 ${i === 2 ? "border-navy ring-1 ring-navy" : "border-slate-200"}`}>
                  <div className="flex items-center justify-between"><h3 className="text-lg font-semibold text-navy">{p.name}</h3>{i === 2 && <span className="rounded-full bg-brass-100 px-2.5 py-0.5 text-xs font-medium text-brass-700 ring-1 ring-inset ring-brass-500/30">Most chosen</span>}</div>
                  <p className="mt-2 min-h-[48px] text-sm leading-relaxed text-slate-600">{p.blurb}</p>
                  <p className="mt-6"><span className="text-[13px] text-slate-500">from </span><span className="font-serif text-3xl font-semibold tabular-nums text-navy">{naira((p.prices ?? [0])[0]!)}</span><span className="text-[13px] text-slate-500"> a year</span></p>
                  <Link href="/demo" className={`btn mt-6 justify-center py-2.5 no-underline ${i === 2 ? "bg-navy text-white hover:bg-brand-900" : "btn-outline"}`}>Talk to us</Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Close */}
        <section className="bg-navy text-white">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-5 py-20 sm:px-8 lg:flex-row lg:items-center">
            <div>
              <h2 className="font-serif text-[32px] font-semibold leading-tight tracking-[-0.015em]">Ready when your school is.</h2>
              <p className="mt-3 max-w-xl leading-relaxed text-white/70">Have an onboarding code from us? Set up your school now; it takes about five minutes. No code yet? Book a 30-minute walk-through and we will set up a trial with your own classes and fees.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/onboard" className="btn bg-white px-5 py-2.5 text-[15px] text-navy no-underline hover:bg-white/90">Onboard your school</Link>
              <Link href="/demo" className="btn border border-white/35 px-5 py-2.5 text-[15px] text-white no-underline hover:bg-white/10">Book a walk-through</Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function Feature({ id, label, title, text, points, picture, flip }: { id: string; label: string; title: string; text: string; points: string[]; picture: React.ReactNode; flip?: boolean }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-slate-200">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-24 sm:px-8 lg:grid-cols-2">
        <div className={flip ? "lg:order-2" : ""}>
          <SectionTitle label={label} title={title} text={text} />
          <ul className="mt-6 space-y-3 text-[15px] text-slate-700">
            {points.map(p => <li key={p} className="flex gap-3"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-navy" />{p}</li>)}
          </ul>
        </div>
        <div className={flip ? "lg:order-1" : ""}>{picture}</div>
      </div>
    </section>
  );
}
