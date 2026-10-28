import Link from "next/link";
import { Monogram } from "@/components/AppShell";
import { Icon } from "@/components/ui";
import { DEFAULT_PLANS } from "@/lib/saas";

type IconName = Parameters<typeof Icon>[0]["name"];

const OFFICES: { icon: IconName; title: string; text: string; items: string[] }[] = [
  { icon: "people", title: "Front office", text: "From the first enquiry to the first day.", items: ["Enquiries and follow-ups", "Online applications and form fees", "Entrance tests, interviews, offers", "Visitors and pickup codes"] },
  { icon: "book", title: "Classroom", text: "Less paperwork, more teaching.", items: ["Registers that work offline", "Timetables, cover and lesson notes", "Homework and marking", "Live lessons and class games"] },
  { icon: "ticket", title: "Exams", text: "Computer-based tests you can trust.", items: ["23 question types, 17 subject tools", "Safe Exam Browser lock per paper", "Hall check-in and invigilation", "Result PINs and scratch cards"] },
  { icon: "card", title: "Bursary", text: "Every naira accounted for.", items: ["Invoices, instalments, discounts", "Paystack, Flutterwave and Remita", "Debtor follow-up and promises to pay", "Payroll with PAYE, pension, NHF"] },
  { icon: "hand", title: "Welfare and safety", text: "Know where every child is.", items: ["Gate sign-in and school buses", "Sick bay, medicines, allergies", "Safeguarding and special needs", "Boarding and exeat"] },
  { icon: "chart", title: "Leadership", text: "The whole school at a glance.", items: ["Report cards and transcripts", "Attendance and fees, live", "Reports across a group of schools", "Inspection packs and the census"] }
];

const LOCAL = [
  "Parents hear on WhatsApp, SMS, email or the app, in the way they prefer, and in their own language.",
  "Payroll follows the Nigeria Tax Act 2025; fees take the payment methods families already use.",
  "Registers, the parent app and exams keep working on slow or patchy connections.",
  "Inspection checklists for MoE / SUBEB, BSO, COBIS and Cambridge centres.",
  "The annual school census is worked out from your own records."
];

const TRUST: { icon: IconName; title: string; text: string }[] = [
  { icon: "lock", title: "Walled off by school", text: "Each school's records are kept apart from every other school's, down to the database." },
  { icon: "note", title: "Every change recorded", text: "Who changed what, and when: grades, fees, registers, settings." },
  { icon: "user", title: "The right people only", text: "Roles and permissions per job, two-step sign-in and approved devices for staff." },
  { icon: "check", title: "Data protection", text: "Built to the Nigeria Data Protection Act 2023, with consent and data requests handled in the app." }
];

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

/** The public home page. Signed-in visitors are taken to their dashboard by the app shell. */
export default function Home() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <Monogram />
            <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight">Synergy Swift</span>
          </Link>
          <nav aria-label="On this page" className="hidden items-center gap-6 text-[13px] text-slate-600 lg:flex">
            <a href="#offices" className="hover:text-slate-900">Product</a>
            <a href="#exams" className="hover:text-slate-900">Exams</a>
            <a href="#learning" className="hover:text-slate-900">Teaching</a>
            <a href="#families" className="hover:text-slate-900">Families</a>
            <a href="#pricing" className="hover:text-slate-900">Pricing</a>
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Link href="/login" className="btn btn-ghost px-2.5 text-[13px] sm:px-3.5">Sign in</Link>
            <Link href="/demo" className="btn btn-primary px-3 text-[13px] sm:px-3.5">Book a demo</Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden border-b border-slate-200 bg-canvas">
          <div className="mx-auto grid max-w-6xl gap-14 px-5 pb-20 pt-16 sm:px-8 sm:pt-24 lg:grid-cols-[1.05fr_1fr] lg:items-center">
            <div>
              <p className="text-sm text-slate-500">School management and learning, built in Nigeria</p>
              <h1 className="mt-4 font-serif text-[40px] font-semibold leading-[1.06] tracking-[-0.02em] sm:text-[58px]">
                The whole school day, in one calm system.
              </h1>
              <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-slate-600">
                Admissions, registers, exams, results, fees, staff and the parent app share one set of records. Teachers spend less time on paperwork,
                the bursary sees every payment, and parents always know how their child is doing.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link href="/demo" className="btn btn-primary px-5 py-2.5 text-[15px]">Book a demo</Link>
                <Link href="/signup" className="btn btn-outline bg-white px-5 py-2.5 text-[15px]">Set up your school</Link>
              </div>
              <ul className="mt-10 grid gap-2.5 text-sm text-slate-600 sm:grid-cols-2">
                {["One record for every child", "Works on slow connections", "WhatsApp, SMS and email built in", "Your data stays your school's"].map(t => (
                  <li key={t} className="flex items-center gap-2"><Icon name="check" className="h-4 w-4 text-brand-700" />{t}</li>
                ))}
              </ul>
            </div>
            <HeroPicture />
          </div>
        </section>

        {/* Facts */}
        <section aria-label="In numbers" className="border-b border-slate-200">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 divide-slate-200 px-5 sm:px-8 lg:grid-cols-4 lg:divide-x">
            {[["6", "offices on one record", "front office to the head's desk"], ["23", "exam question types", "with a locked exam browser"], ["4", "ways to reach parents", "WhatsApp, SMS, email, app"], ["3", "payment gateways", "Paystack, Flutterwave, Remita"]].map(([n, l, h]) => (
              <div key={l} className="py-8 lg:px-8 lg:first:pl-0">
                <dt className="sr-only">{l}</dt>
                <dd><span className="font-serif text-4xl font-semibold tabular-nums">{n}</span>
                  <span className="mt-1 block text-sm font-medium text-slate-800">{l}</span>
                  <span className="block text-[13px] text-slate-500">{h}</span></dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Offices */}
        <section id="offices" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24 sm:px-8">
          <div className="max-w-2xl">
            <h2 className="font-serif text-[32px] font-semibold leading-tight tracking-[-0.01em]">Every office in the school, working from the same page.</h2>
            <p className="mt-4 leading-relaxed text-slate-600">A child is entered once. The register, the exam hall, the bursary, the sick bay and the report card all see the same child, so nothing is typed twice and nothing goes missing between offices.</p>
          </div>
          <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
            {OFFICES.map(o => (
              <article key={o.title} className="bg-white p-7">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-brand-700"><Icon name={o.icon} className="h-5 w-5" /></span>
                <h3 className="mt-5 text-[17px] font-semibold">{o.title}</h3>
                <p className="mt-1 text-sm text-slate-500">{o.text}</p>
                <ul className="mt-4 space-y-2 text-[14px] text-slate-700">
                  {o.items.map(i => <li key={i} className="flex gap-2.5"><span aria-hidden className="mt-[9px] h-px w-3 shrink-0 bg-slate-400" />{i}</li>)}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* Exams */}
        <Feature id="exams" eyebrow="Exams" title="Computer-based tests that hold up on results day."
          text="Set papers with 23 question types and subject tools, from chemistry equations to maths working. Lock a paper to the Safe Exam Browser with one switch, check candidates into the hall, and publish results families open with a PIN."
          points={["Marking done for you, with moderation for written answers", "Extra time and special arrangements per candidate", "Entrance exams for applicants, online or at your centre"]}
          picture={<ExamPicture />} />

        {/* Teaching */}
        <Feature id="learning" flip eyebrow="Teaching" title="Lessons the class actually joins in."
          text="Teachers present on the projector while students answer on their phones. Quizzes become team battles and races; points and class stories bring the class together, and every answer lands in the teacher's markbook."
          points={["Live lessons with polls, questions and drawing", "Five game modes, from team battles to homework races", "Class points and a class story parents can follow"]}
          picture={<LessonPicture />} />

        {/* Families */}
        <Feature id="families" eyebrow="Families" title="Parents see what matters, the moment it happens."
          text="One page for every child: arrival at the gate, the register, homework, results, fees and the bus. Messages arrive on WhatsApp or by text when the parent prefers it, in their own language."
          points={["Pay fees online and get the receipt at once", "Report cards and transcripts on the phone", "Two-way messages with the class teacher"]}
          picture={<PhonePicture />} />

        {/* Local */}
        <section className="border-y border-slate-200 bg-canvas">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_2fr]">
            <h2 className="font-serif text-[30px] font-semibold leading-tight tracking-[-0.01em]">Made for how schools here work.</h2>
            <ul className="space-y-4">
              {LOCAL.map(l => (
                <li key={l} className="flex gap-4 text-[15px] leading-relaxed text-slate-700">
                  <span aria-hidden className="mt-[11px] h-px w-5 shrink-0 bg-brand-600" />{l}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Trust */}
        <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <h2 className="max-w-2xl font-serif text-[30px] font-semibold leading-tight tracking-[-0.01em]">Children&apos;s records deserve care. We built for it from the first line.</h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map(t => (
              <div key={t.title}>
                <Icon name={t.icon} className="h-5 w-5 text-brand-700" />
                <h3 className="mt-4 font-semibold">{t.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-slate-600">{t.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-20 border-t border-slate-200 bg-canvas">
          <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
            <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <div className="max-w-xl">
                <h2 className="font-serif text-[30px] font-semibold leading-tight tracking-[-0.01em]">One yearly price, set by the size of your school.</h2>
                <p className="mt-3 leading-relaxed text-slate-600">Priced by the number of students. Staff and parents are free. Prices below are for schools of up to 100 students; we send an exact quote for yours.</p>
              </div>
              <Link href="/demo" className="btn btn-outline self-start bg-white px-5 py-2.5 lg:self-auto">Get a quote</Link>
            </div>
            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {DEFAULT_PLANS.filter(p => (p.prices?.[0] ?? 0) > 0).slice(0, 3).map((p, i) => (
                <article key={p.code} className={`flex flex-col rounded-xl border bg-white p-7 ${i === 2 ? "border-brand-700 ring-1 ring-brand-700" : "border-slate-200"}`}>
                  <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{p.name}</h3>{i === 2 && <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-600/20">Most chosen</span>}</div>
                  <p className="mt-2 min-h-[48px] text-sm leading-relaxed text-slate-600">{p.blurb}</p>
                  <p className="mt-6"><span className="text-[13px] text-slate-500">from </span><span className="font-serif text-3xl font-semibold tabular-nums">{naira((p.prices ?? [0])[0]!)}</span><span className="text-[13px] text-slate-500"> a year</span></p>
                  <Link href="/demo" className={`btn mt-6 justify-center py-2.5 ${i === 2 ? "btn-primary" : "btn-outline"}`}>Talk to us</Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Close */}
        <section className="bg-brand-700 text-white">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-5 py-20 sm:px-8 lg:flex-row lg:items-center">
            <div>
              <h2 className="font-serif text-[32px] font-semibold leading-tight tracking-[-0.01em]">See it with your own school&apos;s timetable.</h2>
              <p className="mt-3 max-w-xl leading-relaxed text-white/75">A 30-minute walk-through for the proprietor, the head and the bursar. We set up a trial with your classes and fees so everyone sees their own work in it.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/demo" className="btn bg-white px-5 py-2.5 text-[15px] text-brand-800 hover:bg-white/90">Book a demo</Link>
              <Link href="/signup" className="btn border border-white/40 px-5 py-2.5 text-[15px] text-white hover:bg-white/10">Set up your school</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 text-[13px] sm:px-8 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <span className="flex items-center gap-2 text-[15px] font-semibold"><Monogram size="h-6 w-6" /> Synergy Swift</span>
            <p className="mt-3 max-w-xs leading-relaxed text-slate-500">School management and learning for primary and secondary schools.</p>
          </div>
          <FooterCol title="Product" links={[["#offices", "Overview"], ["#exams", "Exams"], ["#learning", "Teaching"], ["#families", "Families"], ["#pricing", "Pricing"]]} />
          <FooterCol title="Schools" links={[["/login", "Sign in"], ["/signup", "Set up your school"], ["/demo", "Book a demo"]]} />
          <FooterCol title="Students and parents" links={[["/student/join", "Join a class"], ["/login", "Parent sign-in"]]} />
        </div>
        <div className="border-t border-slate-200">
          <p className="mx-auto max-w-6xl px-5 py-6 text-[12px] text-slate-500 sm:px-8">© {new Date().getFullYear()} Synergy Swift Technologies Limited</p>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="font-medium text-slate-900">{title}</p>
      <ul className="mt-3 space-y-2 text-slate-500">{links.map(([href, label]) => <li key={label}><Link href={href} className="hover:text-slate-900">{label}</Link></li>)}</ul>
    </div>
  );
}

function Feature({ id, eyebrow, title, text, points, picture, flip }: { id: string; eyebrow: string; title: string; text: string; points: string[]; picture: React.ReactNode; flip?: boolean }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-slate-200">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-24 sm:px-8 lg:grid-cols-2">
        <div className={flip ? "lg:order-2" : ""}>
          <p className="text-sm text-slate-500">{eyebrow}</p>
          <h2 className="mt-3 font-serif text-[30px] font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
          <p className="mt-4 leading-relaxed text-slate-600">{text}</p>
          <ul className="mt-6 space-y-3 text-[15px] text-slate-700">
            {points.map(p => <li key={p} className="flex gap-3"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />{p}</li>)}
          </ul>
        </div>
        <div className={flip ? "lg:order-1" : ""}>{picture}</div>
      </div>
    </section>
  );
}

/* ---------- pictures, drawn with the app's own parts (no stock art) ---------- */

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop">
      <div className="flex h-9 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3.5">
        <Monogram size="h-4 w-4" solid /><span className="text-[11px] font-medium text-slate-600">{title}</span>
      </div>
      {children}
    </div>
  );
}

function HeroPicture() {
  const tiles = [["Attendance today", "96.4%", "12 absent"], ["Fees collected", "78%", "₦41.2m of ₦52.8m"], ["Registers taken", "38 / 38", "by 8:10"], ["Applications", "64", "9 this week"]];
  const rows = [["JSS1 Gold", "Mrs Adeyemi", "7:58"], ["JSS2 Blue", "Mr Okafor", "8:02"], ["SS1 Science", "Ms Bello", "8:05"], ["SS2 Arts", "Mr Danjuma", "due"]];
  return (
    <div className="lg:pl-4" aria-label="The school overview" role="img">
      <Frame title="Greenfield College · School overview">
        <div className="p-5">
          <p className="text-[11px] text-slate-500">First Term 2026/2027</p>
          <p className="font-serif text-lg font-semibold">Good morning, Mrs Okonkwo</p>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {tiles.map(([l, v, h]) => (
              <div key={l} className="rounded-md border border-slate-200 px-3 py-2.5">
                <p className="text-[10px] text-slate-500">{l}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">{v}</p>
                <p className="text-[10px] text-slate-500">{h}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 overflow-hidden rounded-md border border-slate-200">
            <div className="grid grid-cols-3 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500"><span>Class</span><span>Form tutor</span><span className="text-right">Register</span></div>
            {rows.map(([c, t, s]) => (
              <div key={c} className="grid grid-cols-3 border-t border-slate-100 px-3 py-1.5 text-[11px]">
                <span className="font-medium">{c}</span><span className="text-slate-600">{t}</span>
                <span className={`text-right tabular-nums ${s === "due" ? "font-medium text-amber-700" : "text-slate-500"}`}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </Frame>
    </div>
  );
}

function ExamPicture() {
  return (
    <Frame title="Mathematics · JSS2 · Second test">
      <div className="p-6">
        <div className="flex items-center justify-between text-[11px]">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Question 7 of 30</span>
          <span className="flex items-center gap-1.5 text-slate-600"><Icon name="lock" className="h-3.5 w-3.5 text-brand-700" />Locked to the exam browser</span>
          <span className="font-medium tabular-nums">24:18</span>
        </div>
        <p className="mt-5 text-[15px] font-medium leading-relaxed">A trader buys 12 crates of eggs at ₦4,500 each and sells them for ₦63,000. What is the profit as a percentage of the cost?</p>
        <div className="mt-4 space-y-2">
          {["12.5%", "16.7%", "14.3%", "20%"].map((o, i) => (
            <div key={o} className={`flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-sm ${i === 1 ? "border-brand-700 bg-brand-50/60" : "border-slate-200"}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${i === 1 ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 text-slate-500"}`}>{"ABCD"[i]}</span>{o}
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-1">
          {Array.from({ length: 30 }, (_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i < 6 ? "bg-brand-600" : i === 6 ? "bg-brand-300" : "bg-slate-200"}`} />)}
        </div>
      </div>
    </Frame>
  );
}

function LessonPicture() {
  const teams = [["Blue House", 86], ["Gold House", 72], ["Green House", 64], ["Red House", 51]] as const;
  return (
    <Frame title="Live lesson · Photosynthesis · SS1">
      <div className="grid gap-0 sm:grid-cols-[1.3fr_1fr]">
        <div className="border-b border-slate-200 p-6 sm:border-b-0 sm:border-r">
          <p className="text-[11px] text-slate-500">Slide 6 of 14 · 31 students joined</p>
          <p className="mt-3 font-serif text-xl font-semibold leading-snug">Which gas do plants take in for photosynthesis?</p>
          <div className="mt-5 space-y-2.5">
            {[["Carbon dioxide", 74], ["Oxygen", 16], ["Nitrogen", 10]].map(([l, v]) => (
              <div key={l as string}>
                <div className="flex justify-between text-[12px]"><span>{l}</span><span className="tabular-nums text-slate-500">{v}%</span></div>
                <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${v}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="p-6">
          <p className="text-[11px] text-slate-500">Team battle</p>
          <ol className="mt-3 space-y-2.5">
            {teams.map(([t, v], i) => (
              <li key={t} className="flex items-center gap-3 text-[13px]">
                <span className="w-4 text-right tabular-nums text-slate-400">{i + 1}</span>
                <span className="flex-1"><span className="font-medium">{t}</span><span className="mt-1 block h-1.5 rounded-full bg-slate-100"><span className="block h-1.5 rounded-full bg-slate-700" style={{ width: `${v}%` }} /></span></span>
                <span className="w-8 text-right tabular-nums text-slate-600">{v}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Frame>
  );
}

function PhonePicture() {
  const items: [string, string, string][] = [
    ["7:52", "Arrived at school", "Main gate"],
    ["10:15", "Mathematics homework set", "Due Thursday"],
    ["13:40", "Second test result", "Mathematics 84 / 100"],
    ["15:05", "Boarded the school bus", "Route 3, Lekki"]
  ];
  return (
    <div className="mx-auto w-full max-w-[320px] rounded-[34px] border border-slate-300 bg-white p-3 shadow-pop" role="img" aria-label="The parent app on a phone">
      <div className="rounded-[26px] bg-canvas px-4 pb-5 pt-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold text-white">AO</span>
          <div><p className="text-sm font-semibold">Ada Okonkwo</p><p className="text-[11px] text-slate-500">JSS2 Blue · Greenfield College</p></div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[["98%", "attendance"], ["78.4", "average"], ["₦0", "owing"]].map(([v, l]) => (
            <div key={l} className="rounded-lg bg-white py-2"><p className="text-sm font-semibold tabular-nums">{v}</p><p className="text-[10px] text-slate-500">{l}</p></div>
          ))}
        </div>
        <p className="mt-5 text-[11px] font-medium text-slate-500">Today</p>
        <ol className="mt-2 space-y-2">
          {items.map(([t, a, b]) => (
            <li key={t} className="flex gap-3 rounded-lg bg-white p-2.5">
              <span className="w-9 shrink-0 text-[10px] tabular-nums text-slate-500">{t}</span>
              <span><span className="block text-[12px] font-medium">{a}</span><span className="block text-[10px] text-slate-500">{b}</span></span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
