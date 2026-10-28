"use client";
import { useEffect, useState } from "react";
import { Frame } from "@/components/site/Pictures";

/**
 * "How it works": the whole system in seven short scenes, drawn with the app's
 * own parts. Each scene has four beats; it plays by itself and can be paused,
 * stepped or jumped. With reduced motion it starts paused on each scene's last beat.
 */
type Scene = (p: { ph: number }) => React.ReactElement;
const BEATS = 4;
const BEAT_MS = 1900;

const on = (shown: boolean) => `transition-all duration-500 ease-out ${shown ? "opacity-100 translate-y-0" : "pointer-events-none opacity-0 translate-y-1"}`;
const Tag = ({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "navy" | "brass" | "green" }) => {
  const t = { slate: "bg-slate-100 text-slate-600", navy: "bg-navy text-white", brass: "bg-brass-100 text-brass-700 ring-1 ring-inset ring-brass-500/30", green: "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-600/20" }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ${t}`}>{children}</span>;
};
const Check = () => <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Field = ({ label, value, shown }: { label: string; value: string; shown: boolean }) => (
  <div>
    <p className="text-[10.5px] text-slate-500">{label}</p>
    <div className="mt-1 h-8 rounded-md border border-slate-200 px-2.5 text-[12.5px] leading-8">
      <span className={`block overflow-hidden whitespace-nowrap transition-[max-width] duration-700 ease-out ${shown ? "max-w-full" : "max-w-0"}`}>{value}</span>
    </div>
  </div>
);
const Bar = ({ value, tone = "bg-navy" }: { value: number; tone?: string }) => (
  <div className="h-1.5 rounded-full bg-slate-100"><div className={`h-1.5 rounded-full ${tone} transition-[width] duration-700 ease-out`} style={{ width: `${value}%` }} /></div>
);

/* ---------------- the seven scenes ---------------- */

const Onboard: Scene = ({ ph }) => (
  <div className="grid gap-4 p-5 sm:grid-cols-2">
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-[10.5px] text-slate-500">Synergy Swift console · Onboarding codes</p>
      <p className="mt-2 text-[13px] font-medium">For Greenfield College</p>
      <p className="mt-3 rounded-md bg-paper px-3 py-2.5 text-center font-mono text-[15px] font-semibold tracking-wider text-navy">SSC-7KQM-H3XD-P9TA</p>
      <div className="mt-3 flex items-center justify-between text-[11.5px]">
        <span className="text-slate-500">Works once</span>
        {ph < 3 ? <span className="font-mono tabular-nums text-slate-700">expires in {["20:00", "19:41", "18:12"][ph]}</span> : <Tag tone="green">Used</Tag>}
      </div>
    </div>
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-[10.5px] text-slate-500">Onboard your school</p>
      {ph < 3 ? (
        <div className="mt-2 space-y-2.5">
          <Field label="Onboarding code" value="SSC-7KQM-H3XD-P9TA" shown={ph >= 1} />
          <Field label="School name" value="Greenfield College, Ibadan" shown={ph >= 2} />
          <Field label="Your name" value="Mrs Ngozi Okonkwo" shown={ph >= 2} />
        </div>
      ) : (
        <div className="mt-3 space-y-2 text-[12.5px]">
          <p className="font-serif text-[15px] font-semibold text-navy">Greenfield College is ready.</p>
          {["Admin account created", "Terms and grading set up", "Classes ready to add"].map(t => <p key={t} className="flex items-center gap-2"><Check />{t}</p>)}
        </div>
      )}
    </div>
  </div>
);

const ADMIT_COLS = ["Enquiry", "Applied", "Tested", "Offer"];
const ADMIT_CARDS: [string, string][][] = [
  [["Amaka Eze", "JSS1"], ["Musa Bello", "SS1"]],
  [["Ifeoma Nwosu", "JSS1"], ["Daniel Ojo", "JSS2"]],
  [["Halima Sani", "SS1"], ["Kunle Bakare", "JSS1"]],
  [["Esther Ibe", "JSS1"]]
];
const Admit: Scene = ({ ph }) => (
  <div className="p-5">
    <div className="relative grid grid-cols-4 gap-2">
      {ADMIT_COLS.map((c, i) => (
        <div key={c} className="min-h-[230px] rounded-lg bg-slate-50 p-2">
          <p className="flex items-center justify-between px-1 text-[10.5px] font-medium text-slate-600">{c}<span className="tabular-nums text-slate-400">{[14, 9, 6, 4][i] + (ph === i ? 1 : 0)}</span></p>
          <div className="mt-[52px] space-y-1.5">
            {ADMIT_CARDS[i].map(([n, k]) => (
              <div key={n} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px]"><span className="font-medium">{n}</span><span className="block text-[10px] text-slate-500">{k}</span></div>
            ))}
          </div>
        </div>
      ))}
      <div className="absolute top-[26px] rounded-md border border-navy bg-white px-2 py-1.5 text-[11px] shadow-pop transition-[left] duration-700 ease-in-out"
        style={{ left: `calc(${ph * 25}% + 4px)`, width: "calc(25% - 12px)" }}>
        <span className="font-medium text-navy">Tobi Adeyemi</span>
        <span className="block text-[10px] text-slate-500">{["JSS1 · from website", "Form fee paid", "Test: 78%", "Offer accepted"][ph]}</span>
      </div>
    </div>
  </div>
);

const Day: Scene = ({ ph }) => {
  const gate: [string, string][] = [["07:42", "Ada Okonkwo"], ["07:44", "Chidi Musa"], ["07:45", "Tobi Adeyemi"], ["07:49", "Zainab Bello"]];
  return (
    <div className="grid gap-4 p-5 sm:grid-cols-[1fr_1fr_0.9fr]">
      <div className="rounded-lg border border-slate-200 p-3.5">
        <p className="text-[10.5px] text-slate-500">Main gate · this morning</p>
        <ul className="mt-2 space-y-1.5">
          {gate.map(([t, n], i) => <li key={n} className={`flex justify-between text-[12px] ${on(i <= ph)}`}><span>{n}</span><span className="font-mono tabular-nums text-slate-500">{t}</span></li>)}
        </ul>
      </div>
      <div className="rounded-lg border border-slate-200 p-3.5">
        <p className="text-[10.5px] text-slate-500">Registers taken</p>
        <p className="mt-1 font-serif text-2xl font-semibold tabular-nums text-navy">{[4, 17, 31, 38][ph]} <span className="text-sm font-normal text-slate-400">/ 38</span></p>
        <div className="mt-2"><Bar value={[10, 45, 82, 100][ph]} /></div>
        <p className={`mt-3 text-[11.5px] text-slate-600 ${on(ph >= 3)}`}>All classes marked by 8:10. Three absences sent to the office.</p>
      </div>
      <div className="mx-auto w-full max-w-[200px] rounded-[22px] border border-slate-300 bg-paper p-2.5">
        <p className="text-center text-[10px] text-slate-500">Mrs Okonkwo&apos;s phone</p>
        <div className={`mt-2 rounded-xl rounded-tl-sm bg-white p-2.5 text-[11.5px] shadow-lift ${on(ph >= 1)}`}>
          <p className="text-[10px] font-medium text-emerald-800">WhatsApp · Greenfield College</p>
          <p className="mt-1">Ada arrived at school at 7:42.</p>
        </div>
        <div className={`mt-2 rounded-xl rounded-tl-sm bg-white p-2.5 text-[11.5px] shadow-lift ${on(ph >= 3)}`}>
          <p>Ada is present in JSS2 Blue.</p>
        </div>
      </div>
    </div>
  );
};

const Teach: Scene = ({ ph }) => {
  const poll: [string, number[]][] = [["Carbon dioxide", [0, 0, 52, 74]], ["Oxygen", [0, 0, 30, 16]], ["Nitrogen", [0, 0, 18, 10]]];
  return (
    <div className="grid gap-0 sm:grid-cols-[1.25fr_1fr]">
      <div className="border-b border-slate-200 p-5 sm:border-b-0 sm:border-r">
        <div className="flex items-center justify-between">
          <p className="text-[10.5px] text-slate-500">Projector · Photosynthesis · SS1</p>
          <span className="text-[11px] tabular-nums text-slate-600">{[0, 12, 27, 31][ph]} joined</span>
        </div>
        {ph === 0 ? (
          <div className="mt-6 text-center">
            <p className="text-[11px] text-slate-500">Open Join a class and enter</p>
            <p className="mt-1 font-mono text-4xl font-semibold tracking-[0.15em] text-navy">482 107</p>
          </div>
        ) : (
          <>
            <p className="mt-4 font-serif text-lg font-semibold leading-snug">Which gas do plants take in for photosynthesis?</p>
            <div className="mt-4 space-y-2.5">
              {poll.map(([l, v]) => (
                <div key={l}>
                  <div className="flex justify-between text-[11.5px]"><span>{l}</span><span className="tabular-nums text-slate-500">{v[ph]}%</span></div>
                  <div className="mt-1"><Bar value={v[ph]} /></div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="p-5">
        <p className="text-[10.5px] text-slate-500">{ph < 3 ? "Students joining" : "Team battle"}</p>
        {ph < 3 ? (
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {[["Ada O.", "signed in"], ["Guest: Kemi", "with the code"], ["Chidi M.", "signed in"], ["Guest: Femi", "with the code"]].map(([n, h], i) => (
              <li key={n} className={`flex justify-between ${on(ph >= 1 && i < ph * 2)}`}><span className="font-medium">{n}</span><span className="text-slate-500">{h}</span></li>
            ))}
          </ul>
        ) : (
          <ol className="mt-2 space-y-2">
            {([["Blue House", 86], ["Gold House", 72], ["Green House", 64]] as const).map(([t, v], i) => (
              <li key={t} className="text-[12px]"><div className="flex justify-between"><span><span className="mr-2 tabular-nums text-slate-400">{i + 1}</span>{t}</span><span className="tabular-nums">{v}</span></div><div className="mt-1"><Bar value={v} tone="bg-slate-700" /></div></li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
};

const Exam: Scene = ({ ph }) => (
  <div className="grid gap-4 p-5 sm:grid-cols-[1.2fr_1fr]">
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between text-[10.5px] text-slate-500"><span>Mathematics · JSS2 · Question 7 of 30</span><span className="font-mono tabular-nums text-slate-700">{["24:18", "23:02", "00:00", "00:00"][ph]}</span></div>
      <p className="mt-3 text-[12.5px] font-medium leading-relaxed">12 crates of eggs cost ₦4,500 each and sell for ₦63,000. What is the profit as a percentage of the cost?</p>
      <div className="mt-3 space-y-1.5">
        {["12.5%", "16.7%", "14.3%"].map((o, i) => {
          const picked = ph >= 1 && i === 1;
          return (
            <div key={o} className={`flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors duration-500 ${picked ? "border-navy bg-brand-50" : "border-slate-200"}`}>
              <span className={`flex h-4 w-4 items-center justify-center rounded-full border text-[9px] ${picked ? "border-navy bg-navy text-white" : "border-slate-300 text-slate-500"}`}>{"ABC"[i]}</span>{o}
              {picked && ph >= 2 && <span className="ml-auto"><Check /></span>}
            </div>
          );
        })}
      </div>
    </div>
    <div className="space-y-3">
      <div className={`rounded-lg border border-slate-200 p-3.5 ${on(ph >= 2)}`}>
        <p className="text-[10.5px] text-slate-500">Markbook · marked when the test ended</p>
        {[["Ada Okonkwo", 84], ["Chidi Musa", 77], ["Tobi Adeyemi", 91]].map(([n, s]) => (
          <p key={n as string} className="mt-1.5 flex justify-between text-[12px]"><span>{n}</span><span className="font-medium tabular-nums">{s}</span></p>
        ))}
      </div>
      <div className={`relative rounded-lg border border-slate-200 p-3.5 ${on(ph >= 3)}`}>
        <p className="font-serif text-[13px] font-semibold text-navy">Report card · First term</p>
        <p className="mt-1 text-[11.5px] text-slate-600">Ada Okonkwo · JSS2 Blue · Average 78.4</p>
        <span className="absolute right-3 top-3 rotate-[-6deg] rounded border border-brass-600 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-brass-700">PUBLISHED</span>
        <p className="mt-2 text-[11px] text-slate-500">Parents open it with a result PIN.</p>
      </div>
    </div>
  </div>
);

const Fees: Scene = ({ ph }) => (
  <div className="grid gap-4 p-5 sm:grid-cols-2">
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between"><p className="text-[10.5px] text-slate-500">Invoice INV-2026-0412 · Ada Okonkwo</p>{ph >= 2 ? <Tag tone="green">Paid</Tag> : <Tag>Due</Tag>}</div>
      {[["Tuition", "₦150,000"], ["Bus, route 3", "₦45,000"], ["Sibling discount", "−₦10,000"]].map(([l, v]) => (
        <p key={l} className="mt-2 flex justify-between text-[12px]"><span className="text-slate-600">{l}</span><span className="tabular-nums">{v}</span></p>
      ))}
      <p className="mt-3 flex justify-between border-t border-slate-200 pt-2 text-[13px] font-semibold"><span>Total</span><span className="tabular-nums">₦185,000</span></p>
      <div className={`mt-3 rounded-md py-2 text-center text-[12px] font-medium transition-colors duration-500 ${ph === 1 ? "bg-navy text-white" : ph >= 2 ? "bg-emerald-50 text-emerald-800" : "border border-slate-300 text-slate-700"}`}>
        {ph >= 2 ? "Receipt RCT-88104 sent" : ph === 1 ? "Paying with Paystack…" : "Pay online"}
      </div>
    </div>
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-[10.5px] text-slate-500">Bursary · fees collected this term</p>
        <p className="mt-1 font-serif text-2xl font-semibold tabular-nums text-navy">{ph >= 3 ? "78%" : "72%"}</p>
        <div className="mt-2"><Bar value={ph >= 3 ? 78 : 72} /></div>
      </div>
      <div className={`rounded-lg border border-slate-200 p-4 text-[12px] ${on(ph >= 3)}`}>
        <p className="text-[10.5px] text-slate-500">Books · posted by itself</p>
        <p className="mt-1.5 flex justify-between"><span>Bank (Paystack)</span><span className="tabular-nums">+₦185,000</span></p>
        <p className="mt-1 flex justify-between text-slate-600"><span>Fees receivable</span><span className="tabular-nums">−₦185,000</span></p>
      </div>
    </div>
  </div>
);

const Lead: Scene = ({ ph }) => {
  const tiles: [string, string, string][] = [["Attendance today", "96.4%", "12 absent"], ["Fees collected", "78%", "₦41.2m of ₦52.8m"], ["Registers", "38 / 38", "by 8:10"], ["Applications", "64", "9 this week"]];
  return (
    <div className="p-5">
      <p className="font-serif text-[15px] font-semibold text-navy">Good evening, Mrs Okonkwo</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(([l, v, h], i) => (
          <div key={l} className={`rounded-md border border-slate-200 px-3 py-2 ${on(i <= ph)}`}>
            <p className="text-[10px] text-slate-500">{l}</p><p className="text-[16px] font-semibold tabular-nums">{v}</p><p className="text-[10px] text-slate-500">{h}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <div className="rounded-md border border-slate-200 p-3">
          <p className="text-[10px] text-slate-500">Attendance, last 20 school days</p>
          <svg viewBox="0 0 200 50" preserveAspectRatio="none" className="mt-2 h-16 w-full" aria-hidden>
            {[12.5, 25, 37.5].map(y => <line key={y} x1="0" y1={y} x2="200" y2={y} stroke="#f1f5f9" vectorEffect="non-scaling-stroke" />)}
            <line x1="0" y1="49.5" x2="200" y2="49.5" stroke="#e2e8f0" vectorEffect="non-scaling-stroke" />
            <path d="M0 30 L10 26 L20 28 L30 22 L40 24 L50 18 L60 21 L70 16 L80 19 L90 14 L100 17 L110 12 L120 15 L130 11 L140 14 L150 9 L160 12 L170 8 L180 10 L190 7 L200 8"
              fill="none" stroke="#1b2d55" strokeWidth="1.5" vectorEffect="non-scaling-stroke" pathLength={1} strokeDasharray="1" strokeDashoffset={ph >= 1 ? 0 : 1} className="transition-[stroke-dashoffset] duration-[1400ms] ease-out" />
          </svg>
        </div>
        <div className="space-y-2">
          <p className={`rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900 ${on(ph >= 2)}`}>SS2 Arts: register missed twice this week.</p>
          <p className={`flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-[11.5px] ${on(ph >= 3)}`}><Check />Weekly summary sent to the proprietor.</p>
        </div>
      </div>
    </div>
  );
};

const CHAPTERS: { title: string; short: string; window: string; beats: [string, string, string, string]; Scene: Scene }[] = [
  { title: "Onboard the school", short: "A one-time code, then five minutes", window: "Onboarding", Scene: Onboard, beats: [
    "Synergy Swift makes a one-time onboarding code for the school. It lasts 20 minutes.",
    "The school opens Onboard your school and enters the code.",
    "They name the school and create the first admin account.",
    "The code is used up. The school is ready, with terms and grading set."] },
  { title: "Admit students", short: "Enquiry to enrolled, in one pipeline", window: "Admissions", Scene: Admit, beats: [
    "A parent enquires on the school website; it lands with the admissions office.",
    "They apply online and pay the form fee.",
    "Tobi sits the entrance test, which marks itself.",
    "An offer goes out. Once it is accepted, Tobi becomes a student with one record."] },
  { title: "Run the day", short: "Gate, registers and parents", window: "Today", Scene: Day, beats: [
    "Ada scans her card at the gate at 7:42.",
    "Her mother gets a WhatsApp message straight away.",
    "Teachers take registers; phones that are offline catch up later.",
    "By 8:10 every class is marked and absences go to the office."] },
  { title: "Teach live", short: "Phones in, guests welcome", window: "Live lesson", Scene: Teach, beats: [
    "The teacher starts a live lesson; a join code shows on the projector.",
    "Students join on their phones, signed in or as guests with the code.",
    "They answer, and the results build up as they go.",
    "Scores go to the markbook, and the class plays on as teams."] },
  { title: "Examine and report", short: "Locked tests, instant marking", window: "Exams and results", Scene: Exam, beats: [
    "Students sit a computer-based test, locked to the exam browser.",
    "Answers are saved as they go, even if the connection drops.",
    "Marking is done the moment the test ends.",
    "Report cards are published, and parents open them with a PIN."] },
  { title: "Collect fees", short: "Paid online, posted by itself", window: "Fees", Scene: Fees, beats: [
    "Each family gets its invoice, with discounts and instalments applied.",
    "A parent pays on the phone with Paystack, Flutterwave or Remita.",
    "The receipt arrives at once; there are no bank slips to chase.",
    "The bursary and the books update by themselves."] },
  { title: "Lead the school", short: "One page for the head", window: "School overview", Scene: Lead, beats: [
    "The head opens one page for the whole school.",
    "Attendance, fees and results are live, not last month's.",
    "Problems stand out early, like a class that keeps missing its register.",
    "A weekly summary goes to the proprietor by itself."] }
];

export function Tour() {
  const [ch, setCh] = useState(0);
  const [ph, setPh] = useState(0);
  const [playing, setPlaying] = useState(true);

  // Reduced motion: no autoplay; each scene shows its last beat.
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setPlaying(false); setPh(BEATS - 1); }
  }, []);
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      if (ph < BEATS - 1) setPh(ph + 1);
      else { setCh((ch + 1) % CHAPTERS.length); setPh(0); }
    }, ph === BEATS - 1 ? BEAT_MS * 1.5 : BEAT_MS);
    return () => clearTimeout(t);
  }, [playing, ch, ph]);

  const go = (c: number, p = 0) => { setCh((c + CHAPTERS.length) % CHAPTERS.length); setPh(p); };
  const step = (d: 1 | -1) => {
    const n = ph + d;
    if (n >= BEATS) go(ch + 1); else if (n < 0) go(ch - 1, BEATS - 1); else setPh(n);
  };
  const C = CHAPTERS[ch];

  return (
    <div className="grid gap-6 lg:grid-cols-[290px_1fr] lg:gap-10">
      <ol className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:block lg:space-y-1 lg:overflow-visible lg:px-0" aria-label="Steps">
        {CHAPTERS.map((c, i) => (
          <li key={c.title} className="shrink-0 lg:shrink">
            <button type="button" onClick={() => go(i)} aria-current={i === ch ? "step" : undefined}
              className={`relative w-full overflow-hidden rounded-lg border px-3.5 py-2.5 text-left transition-colors lg:py-3 ${i === ch ? "border-navy bg-white" : "border-transparent hover:bg-white"}`}>
              <span className="flex items-baseline gap-2.5">
                <span className={`font-mono text-[11px] tabular-nums ${i === ch ? "text-brass-700" : "text-slate-400"}`}>0{i + 1}</span>
                <span className={`whitespace-nowrap text-[13.5px] font-medium lg:whitespace-normal ${i === ch ? "text-navy" : "text-slate-600"}`}>{c.title}</span>
              </span>
              <span className="mt-0.5 hidden pl-[26px] text-[12px] text-slate-500 lg:block">{c.short}</span>
              {i === ch && <span aria-hidden className="absolute bottom-0 left-0 h-[2px] bg-brass-500 transition-[width] duration-500 ease-out" style={{ width: `${((ph + 1) / BEATS) * 100}%` }} />}
            </button>
          </li>
        ))}
      </ol>

      <div>
        <Frame title={`${C.window} · Greenfield College`}>
          <div className="flex min-h-[330px] items-center" key={ch}>
            <div className="ss-rise w-full"><C.Scene ph={ph} /></div>
          </div>
        </Frame>
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <p className="min-h-[48px] max-w-xl text-[15px] leading-relaxed text-slate-700" aria-live="polite">
            <span className="mr-2 font-mono text-[12px] tabular-nums text-brass-700">{ch + 1}.{ph + 1}</span>{C.beats[ph]}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" className="btn btn-outline h-9 w-9 p-0" onClick={() => step(-1)} aria-label="Previous">
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
            </button>
            <button type="button" className="btn h-9 bg-navy px-3.5 text-white hover:bg-brand-900" onClick={() => setPlaying(!playing)} aria-pressed={!playing}>
              {playing ? <><svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden><path d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z" fill="currentColor" /></svg>Pause</>
                : <><svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden><path d="M4.5 2.5v11l9-5.5z" fill="currentColor" /></svg>Play</>}
            </button>
            <button type="button" className="btn btn-outline h-9 w-9 p-0" onClick={() => step(1)} aria-label="Next">
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
