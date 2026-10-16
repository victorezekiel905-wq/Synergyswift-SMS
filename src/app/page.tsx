import Link from "next/link";
import { Monogram } from "@/components/AppShell";

const AREAS: { title: string; text: string }[] = [
  { title: "Admissions", text: "Online applications, entrance tests, interviews and offer letters families sign on their phone." },
  { title: "Registers and timetables", text: "Morning and lesson registers that work offline, clash-free timetables and cover." },
  { title: "Results and report cards", text: "Score sheets with moderation, report cards with comments, transcripts and value added." },
  { title: "Fees and payments", text: "Invoices, instalments, Paystack, Flutterwave and Remita, receipts and debtor follow-up." },
  { title: "Teaching and learning", text: "Homework, lesson notes, schemes of work, online exams and outside learning tools." },
  { title: "Families", text: "One page for every child: attendance, homework, results, fees, the bus and messages." },
  { title: "Staff and payroll", text: "Records, leave, appraisals and payroll with PAYE, pension, NHF and payslips." },
  { title: "Welfare and compliance", text: "Safeguarding, health, policies, the single central record and inspection packs." }
];

const LOCAL = [
  "Parents hear on WhatsApp, SMS, email or the app, in the way they prefer.",
  "Payroll follows the Nigeria Tax Act 2025; fees take local payment methods.",
  "Registers and the portals keep working on slow or patchy connections.",
  "Inspection checklists for MoE / SUBEB, BSO, COBIS and Cambridge centres.",
  "The annual school census is worked out from your own records."
];

/** The public home page. Signed-in visitors are taken to their dashboard by the app shell. */
export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200/80">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <Monogram />
            <span className="whitespace-nowrap text-[15px] font-semibold tracking-tight">EduClass Fusion</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <Link href="/student/join" className="btn btn-ghost hidden text-[13px] sm:inline-flex">Join a class</Link>
            <Link href="/login" className="btn btn-ghost px-2.5 text-[13px] sm:px-3.5">Sign in</Link>
            <Link href="/signup" className="btn btn-primary px-3 text-[13px] sm:px-3.5"><span className="sm:hidden">Get started</span><span className="hidden sm:inline">Set up your school</span></Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-5 pb-16 pt-16 sm:px-8 sm:pt-24">
          <div className="max-w-3xl">
            <p className="text-sm text-slate-500">School management for primary and secondary schools</p>
            <h1 className="mt-4 font-serif text-[40px] font-semibold leading-[1.08] tracking-[-0.02em] text-slate-900 sm:text-[56px]">
              Run the whole school from one place.
            </h1>
            <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-slate-600">
              Admissions, registers, results, fees, staff and the parent app, in one system that is simple enough for every teacher
              and careful enough for the bursary, the head and the inspector.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/signup" className="btn btn-primary px-5 py-2.5 text-[15px]">Set up your school</Link>
              <Link href="/login" className="btn btn-outline px-5 py-2.5 text-[15px]">Sign in</Link>
            </div>
          </div>
        </section>

        <section aria-label="What the school overview looks like" className="mx-auto max-w-6xl px-5 sm:px-8">
          <Glimpse />
        </section>

        <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="grid gap-12 lg:grid-cols-[1fr_2fr]">
            <div>
              <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-[-0.01em]">What it covers</h2>
              <p className="mt-3 max-w-sm leading-relaxed text-slate-600">From the first enquiry to the last report card, each part shares the same records, so nothing is typed twice.</p>
            </div>
            <dl className="grid gap-x-10 sm:grid-cols-2">
              {AREAS.map(a => (
                <div key={a.title} className="border-t border-slate-200 py-5">
                  <dt className="font-medium text-slate-900">{a.title}</dt>
                  <dd className="mt-1.5 text-[15px] leading-relaxed text-slate-600 sm:text-sm">{a.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-canvas">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_2fr]">
            <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-[-0.01em]">Made for how schools here work</h2>
            <ul className="space-y-4">
              {LOCAL.map(l => (
                <li key={l} className="flex gap-4 text-[15px] leading-relaxed text-slate-700 sm:text-sm">
                  <span aria-hidden className="mt-[9px] h-px w-5 shrink-0 bg-brand-600" />{l}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-end">
            <div>
              <h2 className="font-serif text-[28px] font-semibold leading-tight tracking-[-0.01em]">Ready when your school is.</h2>
              <p className="mt-3 max-w-lg leading-relaxed text-slate-600">Set up your sessions, classes and fees, import your students, and invite staff and parents. Your data stays your school’s.</p>
            </div>
            <div className="flex gap-3">
              <Link href="/signup" className="btn btn-primary px-5 py-2.5">Set up your school</Link>
              <Link href="/login" className="btn btn-outline px-5 py-2.5">Sign in</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-[13px] text-slate-500 sm:px-8">
          <span className="flex items-center gap-2"><Monogram size="h-6 w-6 text-[13px]" /> EduClass Fusion</span>
          <span className="flex gap-5">
            <Link href="/login" className="hover:text-slate-800">Sign in</Link>
            <Link href="/student/join" className="hover:text-slate-800">Students: join a class</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

/** A still picture of the school overview, drawn with the app's own parts. */
function Glimpse() {
  const tiles = [["Attendance today", "96.4%", "12 absent"], ["Fees collected this term", "78%", "₦41.2m of ₦52.8m"], ["Registers taken", "100%", "38 of 38 classes"], ["Applications in progress", "64", "9 this week"]];
  const rows = [["JSS1 Gold", "Mrs Adeyemi", "taken 7:58"], ["JSS2 Blue", "Mr Okafor", "taken 8:02"], ["SS1 Science", "Ms Bello", "taken 8:05"], ["SS2 Arts", "Mr Danjuma", "due"]];
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-canvas shadow-pop">
      <div className="flex h-10 items-center gap-2 border-b border-slate-200 bg-white px-4">
        <Monogram size="h-5 w-5 text-[11px]" /><span className="text-xs font-medium text-slate-700">Greenfield College</span>
        <span className="ml-auto hidden h-6 w-44 rounded border border-slate-200 bg-slate-50 sm:block" />
      </div>
      <div className="flex">
        <div className="hidden w-44 shrink-0 space-y-1 border-r border-slate-200 bg-white p-3 md:block">
          {["Dashboard", "School overview", "Class register", "Results & report cards", "Fees", "Parent messages", "Staff & HR"].map((l, i) => (
            <div key={l} className={`rounded px-2 py-1.5 text-[11px] ${i === 1 ? "bg-slate-100 font-medium text-slate-900" : "text-slate-500"}`}>{l}</div>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-4 sm:p-6">
          <p className="text-[11px] text-slate-500">First Term 2026/2027</p>
          <p className="font-serif text-lg font-semibold">Greenfield College</p>
          <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {tiles.map(([l, v, h]) => (
              <div key={l} className="rounded-md border border-slate-200 bg-white px-3 py-2.5">
                <p className="text-[11px] text-slate-500">{l}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{v}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">{h}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 overflow-hidden rounded-md border border-slate-200 bg-white">
            <div className="grid grid-cols-3 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500"><span>Class</span><span>Form tutor</span><span className="text-right">Morning register</span></div>
            {rows.map(([c, t, s]) => (
              <div key={c} className="grid grid-cols-3 border-b border-slate-100 px-3 py-2 text-[11px] last:border-0">
                <span className="font-medium text-slate-800">{c}</span><span className="text-slate-600">{t}</span>
                <span className={`text-right ${s === "due" ? "text-amber-700" : "text-slate-500"}`}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
