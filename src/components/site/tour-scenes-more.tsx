"use client";
/**
 * The rest of "Take a tour": a chapter for every feature on the Features page
 * that the first twelve chapters (tour-scenes.tsx) do not show. Same rules: `at`
 * names what the cursor clicks; done(n) says whether step n's click happened.
 */
import { show, H, B, Tag, Box, Bar, type Chapter } from "@/components/site/tour-scenes";

const Row = ({ at, children, on = true, hi }: { at?: string; children: React.ReactNode; on?: boolean; hi?: boolean }) => (
  <div data-tour={at} className={`flex items-center justify-between gap-2 border-t border-slate-100 py-1.5 text-[12px] first:border-t-0 ${hi ? "rounded bg-brand-50 px-1" : ""} ${show(on)}`}>{children}</div>
);
const Note = ({ on, children, tone = "slate" }: { on: boolean; children: React.ReactNode; tone?: "slate" | "green" | "amber" }) => (
  <p className={`mt-2 rounded-md p-2 text-[11.5px] ${tone === "green" ? "bg-emerald-50 text-emerald-900" : tone === "amber" ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700"} ${show(on)}`}>{children}</p>
);

export const MORE: Chapter[] = [
  // ---------------- Students and the school office ----------------
  { id: "records", group: "core", features: ["Student records"], title: "Student records", area: "Students", path: "school/students/ada-okonkwo",
    benefit: "One record for every child: the register, the bursary, the sick bay and the report card all see the same child.",
    steps: [{ at: "ada", say: "Students → open Ada Okonkwo. Everything about her is on one page." }, { at: "medical", say: "Medical: allergies and medicines, seen by the sick bay and on trips." }, { at: "docs", say: "Documents: birth certificate and past reports, kept safely." }],
    Scene: ({ done }) => (<div>
      <H sub="1,240 students">Students</H>
      <Box><Row at="ada" hi={done(0)}><span><b>Ada Okonkwo</b> · JSS2 Blue</span><span className="text-slate-500">GFC/2024/0112</span></Row><Row><span>Chidi Musa · JSS2 Blue</span></Row><Row><span>Tobi Adeyemi · JSS1 Gold</span></Row></Box>
      <Box className={`mt-2 ${show(done(0))}`}><div className="flex gap-1 text-[12px]">{["Profile", "Guardians", "Medical", "Documents"].map(t => <span key={t} data-tour={t === "Medical" ? "medical" : t === "Documents" ? "docs" : undefined}
        className={`rounded px-2 py-0.5 ${(t === "Medical" && done(1) && !done(2)) || (t === "Documents" && done(2)) ? "bg-navy text-white" : "text-slate-600"}`}>{t}</span>)}</div>
        <Note on={done(1) && !done(2)} tone="amber">Allergy: peanuts · Inhaler in the sick bay</Note><Note on={done(2)}>Birth certificate.pdf · JSS1 report card.pdf</Note></Box>
    </div>) },
  { id: "timetable", group: "core", features: ["Timetable"], title: "Timetable", area: "Teaching", path: "school/timetable",
    benefit: "Days of puzzle work become minutes, with no clashes.",
    steps: [{ at: "generate", say: "Generate: every class placed around rooms, teacher availability and doubles." }, { at: "lock", say: "Lock a lesson you want to keep where it is." }, { at: "fixes", say: "Anything that would not fit? Suggest fixes explains why and what to change." }],
    Scene: ({ done }) => (<div>
      <div className="mb-2 flex gap-2"><B at="generate" primary>Generate</B><B at="fixes">Suggest fixes</B></div>
      <Box><div className="grid grid-cols-6 gap-1 text-center text-[10.5px]">{["", "Mon", "Tue", "Wed", "Thu", "Fri"].map(d => <span key={d} className="font-medium text-slate-500">{d}</span>)}
        {["1", "2", "3"].map(p => [<span key={p} className="text-slate-400">P{p}</span>, ...["Maths", "English", "Biology", "Maths", "French"].map((x, i) => (
          <span key={p + i} data-tour={p === "1" && i === 0 ? "lock" : undefined} className={`rounded px-1 py-1 transition-all ${done(0) ? "bg-brand-50" : "bg-slate-50 text-transparent"} ${p === "1" && i === 0 && done(1) ? "ring-2 ring-brass-500" : ""}`}>{done(0) ? (p === "2" ? ["English", "Maths", "Chemistry", "Civic", "PE"][i] : x) : "·"}</span>))])}</div></Box>
      <Note on={done(2)}>JSS3 Further Maths ×2 did not fit: Mr Ade has 34 periods for 35 slots. Give one class to a second teacher.</Note>
    </div>) },
  { id: "events", group: "core", features: ["Events and consent"], title: "Events and consent", area: "Students", path: "school/events",
    benefit: "No lost paper slips, and you always know who is on the bus.",
    steps: [{ at: "new", say: "New event: a trip to the National Museum, with a ₦5,000 fee." }, { at: "send", say: "Ask for consent. Parents answer and pay in the app, WhatsApp or by link." }, { at: "replies", say: "Replies come in; the trip roster builds itself." }],
    Scene: ({ done }) => (<div><H sub="Trips, events and consent">Events</H>
      <div className="mb-2 flex gap-2"><B at="new" primary>+ New event</B><B at="send">Ask parents</B></div>
      <Box className={show(done(0))}><p className="text-[12px] font-medium">JSS2 trip · National Museum, Lagos · Fri 14 Nov</p><p className="text-[11px] text-slate-500">Fee ₦5,000 · leaves 8:30am, back 3pm</p>
        <div data-tour="replies" className="mt-2 text-[11.5px]">{done(1) ? <>Consent: <b>{done(2) ? "28" : "0"}</b> yes · <b>{done(2) ? "1" : "0"}</b> no · {done(2) ? "3" : "32"} waiting</> : "Not sent yet"}</div>
        <div className="mt-1"><Bar v={done(2) ? 87 : 0} /></div></Box>
    </div>) },
  { id: "behaviour", group: "core", features: ["Behaviour and houses"], title: "Behaviour and houses", area: "Students", path: "school/behaviour",
    benefit: "A fair, visible record that parents can follow.",
    steps: [{ at: "merit", say: "A merit for Ada for helping a classmate: Blue House gains a point." }, { at: "incident", say: "Log an incident with what happened and who saw it." }, { at: "detention", say: "Set a detention; the parent is told and it shows on the record." }],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><div className="flex justify-between"><p className="text-[12px] font-medium">Ada Okonkwo</p><B at="merit">+ Merit</B></div>
        <div className="mt-2 text-[11px] text-slate-500">House points</div>{([["Blue", done(0) ? 413 : 412], ["Gold", 398], ["Red", 371]] as const).map(([h, v]) => <div key={h} className="mt-1 text-[11.5px]"><div className="flex justify-between"><span>{h}</span><span>{v}</span></div><Bar v={v / 5} /></div>)}</Box>
      <Box><div className="flex justify-between"><p className="text-[12px] font-medium">Chidi Musa</p><B at="incident">Log incident</B></div>
        <Note on={done(1)}>Disrupting class, SS1 Chemistry, seen by Mr Ade.</Note>
        <div className="mt-2"><B at="detention">Set detention</B></div><Note on={done(2)} tone="amber">Detention Tue 3:15pm · parent told on WhatsApp</Note></Box>
    </div>) },
  { id: "cover", group: "core", features: ["Staff cover"], title: "Staff cover", area: "Teaching", path: "school/cover",
    benefit: "Every class is covered before the bell.",
    steps: [{ at: "find", say: "Mr Ade is on approved leave today. Find cover for his lessons." }, { at: "bello", say: "Free teachers are suggested, fairest first." }, { at: "assign", say: "Assign: Mrs Bello is told, and the timetable updates." }],
    Scene: ({ done }) => (<div><H sub="Today · 3 lessons need cover">Staff cover</H>
      <Box><Row><span>P2 · SS1 Maths · Mr Ade (leave)</span><B at="find">Find cover</B></Row><Row><span>P4 · JSS3 Maths · Mr Ade</span><Tag>waiting</Tag></Row></Box>
      <Box className={`mt-2 ${show(done(0))}`}><Row at="bello" hi={done(1)}><span><b>Mrs Bello</b> · free P2 · 1 cover this week</span><B at="assign" primary>{done(2) ? "Assigned" : "Assign"}</B></Row><Row><span>Mr Musa · free P2 · 3 covers this week</span></Row></Box>
    </div>) },
  { id: "observations", group: "core", features: ["Lesson observations"], title: "Lesson observations", area: "Teaching", path: "school/qa",
    benefit: "Better teaching, with evidence ready for appraisals.",
    steps: [{ at: "observe", say: "Observe a lesson with the school's own checklist." }, { at: "score", say: "Score each point and note strengths and next steps." }, { at: "reply", say: "The teacher reads it and replies; it feeds their appraisal." }],
    Scene: ({ done }) => (<div><div className="mb-2"><B at="observe" primary>Observe Mrs Bello · JSS2 English</B></div>
      <Box className={show(done(0))}>{["Clear lesson objective", "Pupils engaged", "Checks understanding"].map((c, i) => <Row key={c} at={i === 1 ? "score" : undefined}><span>{c}</span><span className="tabular-nums">{done(1) ? ["4", "5", "3"][i] : "–"} / 5</span></Row>)}
        <Note on={done(1)}>Strength: lively questioning. Next: check understanding before moving on.</Note>
        <div className="mt-2"><B at="reply">Teacher&apos;s reply</B></div><Note on={done(2)} tone="green">&quot;Thank you. I&apos;ll use exit tickets next week.&quot;</Note></Box>
    </div>) },
  // ---------------- Results ----------------
  { id: "effort", group: "results", features: ["Effort, conduct and co-curricular grades"], title: "Effort and co-curricular grades", area: "Results", path: "school/results",
    benefit: "Report cards that describe the whole child, in your school's own words.",
    steps: [{ at: "scale", say: "Areas and scale: choose your scale, here A to E." }, { at: "area", say: "Add your own areas, like Co-curricular with Football and Chess club." }, { at: "rate", say: "Teachers rate each child; it prints under each area on the report card." }],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><p className="text-[11px] text-slate-500">Rating scale</p><div className="mt-1 flex flex-wrap gap-1"><B at="scale" pressed={done(0)}>A to E</B><span className="text-[11px] text-slate-400">1 to 5 · 1 to 10 · your own</span></div>
        <p className="mt-2 text-[11px] text-slate-500">Areas</p><p className="text-[12px]">Character · Skills · Effort{done(1) && " · Co-curricular"}</p><div className="mt-1"><B at="area">+ Add an area</B></div></Box>
      <Box className={show(done(1))}><p className="text-[11px] text-slate-500">Co-curricular · Ada Okonkwo</p>
        <Row><span>Football</span><span data-tour="rate" className="font-semibold">{done(2) ? "A" : "—"}</span></Row><Row><span>Chess club</span><span className="font-semibold">{done(2) ? "B" : "—"}</span></Row>
        <Note on={done(2)}>A Excellent · B Very good · C Good · D Fair · E Poor</Note></Box>
    </div>) },
  { id: "pins", group: "results", features: ["Result PINs and scratch cards"], title: "Result PINs and scratch cards", area: "Results", path: "school/result-pins",
    benefit: "Secure results for families, and income for the school.",
    steps: [{ at: "make", say: "Make 400 result PINs for this term." }, { at: "print", say: "Print them as scratch cards to sell or give out." }, { at: "check", say: "A parent enters the PIN online, or by USSD on a basic phone, and sees the result." }],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><div className="flex gap-2"><B at="make" primary>Make PINs</B><B at="print">Print cards</B></div><p className={`mt-2 text-[12px] ${show(done(0))}`}>400 PINs · First term · up to 5 uses each</p>
        <div className={`mt-2 grid grid-cols-2 gap-1 ${show(done(1))}`}>{["SN 000231", "SN 000232"].map(x => <span key={x} className="rounded border border-dashed border-slate-300 p-1.5 text-center font-mono text-[10.5px]">{x}<br />•••• ••••</span>)}</div></Box>
      <Box at="check" className={show(done(1))}><p className="text-[11px] text-slate-500">Results checker</p><p className="mt-1 font-mono text-[12px]">PIN 4821-3907</p><Note on={done(2)} tone="green">Ada Okonkwo · First term · average 84.2, 1st of 32</Note></Box>
    </div>) },
  // ---------------- Exams ----------------
  { id: "marking", group: "exams", features: ["Marking"], title: "Marking written answers", area: "Exams", path: "exams/biology-test/marking",
    benefit: "Hours of marking saved every week, with the teacher always deciding.",
    steps: [{ at: "suggest", say: "Objective answers are marked already. For an essay, press Suggest a mark." }, { at: "why", say: "A mark against your marking guide, with the reasons." }, { at: "points", say: "The teacher agrees or changes it, then saves." }],
    Scene: ({ done }) => (<Box><p className="text-[11px] text-slate-500">Q12 · Essay · 10 marks</p><p className="mt-1 text-[12px]">&quot;Explain how plants make food.&quot;</p>
      <p className="mt-1 rounded bg-slate-50 p-2 text-[11.5px] italic">Plants use sunlight, water and carbon dioxide to make glucose in the leaves…</p>
      <div className="mt-2 flex items-center gap-2"><span data-tour="points" className="rounded border border-slate-300 px-2 py-1 font-mono text-[12px]">{done(2) ? "8" : done(0) ? "7" : "–"} / 10</span><B at="suggest">Suggest a mark</B></div>
      <ul data-tour="why" className={`mt-2 list-disc pl-4 text-[11.5px] text-slate-700 ${show(done(1))}`}><li>Names all three inputs and the product.</li><li>Does not mention chlorophyll.</li></ul></Box>) },
  { id: "office", group: "exams", features: ["Exam office"], title: "Exam office", area: "Exams", path: "school/exams-office",
    benefit: "Calm, organised exam weeks, with every candidate accounted for.",
    steps: [{ at: "checkin", say: "At the hall door, check candidates in with their card or code." }, { at: "board", say: "The live board shows who has started, finished, or is missing, in every hall." }, { at: "approve", say: "Approve an extra-time request; the paper adjusts itself." }],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><p className="text-[11px] text-slate-500">Hall A · WAEC mock Maths</p><div className="mt-2"><B at="checkin" primary>Check in</B></div><p className={`mt-2 text-[12px] ${show(done(0))}`}>Ada Okonkwo · seat 14 · checked in 8:52</p></Box>
      <Box at="board"><p className="text-[11px] text-slate-500">Live board</p><p className="text-[12px]">Started {done(1) ? 118 : 0} · Finished {done(1) ? 4 : 0} · Missing {done(1) ? 2 : 0}</p>
        <div className="mt-2 flex items-center justify-between text-[12px]"><span>Extra time: Tobi (SEN, +25%)</span><B at="approve">{done(2) ? "Approved" : "Approve"}</B></div></Box>
    </div>) },
  { id: "entrance", group: "exams", features: ["Entrance exams"], title: "Entrance exams", area: "Exams", path: "school/admissions/entrance",
    benefit: "Admit the right students, faster and more fairly.",
    steps: [{ at: "sitting", say: "Applicants are seated automatically once the form fee is paid, online or at your centre." }, { at: "scores", say: "Tests mark themselves; scores join interview and past reports." }, { at: "offer", say: "Send offers down the merit list; the rest go on the waiting list." }],
    Scene: ({ done }) => (<Box><div className="flex justify-between"><p className="text-[12px] font-medium">JSS1 entrance · Sat 15 Nov</p><span data-tour="sitting"><Tag tone={done(0) ? "green" : "slate"}>{done(0) ? "84 seated" : "planning"}</Tag></span></div>
      <div data-tour="scores">{([["Tobi Adeyemi", 88], ["Ifeoma Nwosu", 81], ["Daniel Ojo", 64]] as const).map(([n, v], i) => <Row key={n} on={done(1)}><span>{i + 1}. {n}</span><span className="tabular-nums">{v}%</span></Row>)}</div>
      <div className="mt-2"><B at="offer" primary>{done(2) ? "Offers sent to the top 60" : "Send offers"}</B></div></Box>) },
  // ---------------- Teaching and learning ----------------
  { id: "online", group: "learning", features: ["Online learning"], title: "Online learning", area: "Teaching", path: "school/learning",
    benefit: "Learning that survives a closure or a bad network.",
    steps: [{ at: "path", say: "Build a learning path: videos, readings, quizzes, in order." }, { at: "lesson", say: "Students work through it at their pace; you see progress." }, { at: "offline", say: "Save for offline: it works on a weak connection and syncs later." }],
    Scene: ({ done }) => (<Box><div className="flex justify-between"><p className="text-[12px] font-medium">Fractions · JSS1</p><B at="path" primary>+ Add step</B></div>
      {["Video: what is a fraction?", "Reading: equal parts", "Quiz: 10 questions"].map((x, i) => <Row key={x} at={i === 1 ? "lesson" : undefined} on={done(0) || i < 2}><span>{i + 1}. {x}</span><span className="text-slate-500">{done(1) ? ["31/32 done", "24/32", "12/32"][i] : ""}</span></Row>)}
      <div className="mt-2"><B at="offline">Save for offline</B></div><Note on={done(2)} tone="green">Saved on this phone · syncs when back online</Note></Box>) },
  { id: "points", group: "learning", features: ["Classroom points and class story"], title: "Classroom points and class story", area: "Teaching", path: "school/classroom",
    benefit: "Families see the good things every week, not only problems.",
    steps: [{ at: "give", say: "Give Ada a point for Teamwork from the projector or your phone." }, { at: "post", say: "Post a photo to the class story; parents see it (only children with photo consent)." }, { at: "weekly", say: "On Friday each family gets the week: points, attendance, homework, and something to praise." }],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><div className="flex flex-wrap gap-1">{["Teamwork", "Effort", "Kindness"].map(s => <B key={s} at={s === "Teamwork" ? "give" : undefined} pressed={s === "Teamwork" && done(0)}>+ {s}</B>)}</div>
        <p className={`mt-2 text-[12px] ${show(done(0))}`}>Ada Okonkwo · 14 points this week</p><div className="mt-2"><B at="post">Post to class story</B></div>
        <Note on={done(1)}>Photo: science fair models · 3 likes</Note></Box>
      <Box at="weekly" className={show(done(1))}><p className="text-[11px] text-slate-500">Friday · to Mrs Okonkwo</p><p className={`mt-1 text-[11.5px] ${show(done(2))}`}>Ada: 14 points (Teamwork) · 5 of 5 days · homework 3 of 3. To praise at home: teamwork.</p></Box>
    </div>) },
  { id: "library", group: "learning", features: ["Library and e-books"], title: "Library and e-books", area: "Teaching", path: "school/library",
    benefit: "Reading for every child, on any device, at no cost for the free collection.",
    steps: [{ at: "free", say: "Add the free collection: classic novels, inspirational books, textbooks and learning sites." }, { at: "read", say: "Students read online…" }, { at: "download", say: "…or download to read offline. Printed books are lent by barcode." }],
    Scene: ({ done }) => (<div><div className="mb-2"><B at="free" primary>{done(0) ? "78 free titles added" : "Add the free collection (78)"}</B></div>
      <div className={`grid gap-2 sm:grid-cols-2 ${show(done(0))}`}>{[["Treasure Island", "Junior secondary · Public domain"], ["Biology 2e", "SS3 and A level · CC BY-NC-SA"]].map(([t, d], i) => (
        <Box key={t}><p className="text-[12px] font-semibold">{t}</p><p className="text-[10.5px] text-slate-500">{d}</p><div className="mt-1.5 flex gap-1"><B at={i === 0 ? "read" : undefined} primary>Read</B><B at={i === 0 ? "download" : undefined}>Download</B></div></Box>))}</div>
    </div>) },
  { id: "portfolio", group: "learning", features: ["Portfolios and achievements"], title: "Portfolios and achievements", area: "Students", path: "student/portfolio",
    benefit: "A record of growth beyond grades, ready for scholarships and next schools.",
    steps: [{ at: "add", say: "Ada adds an achievement with a photo: 2nd place, state science fair." }, { at: "verify", say: "A teacher verifies it." }, { at: "share", say: "Share the portfolio as a private link." }],
    Scene: ({ done }) => (<Box><div className="flex justify-between"><p className="text-[12px] font-medium">Ada&apos;s portfolio</p><B at="add" primary>+ Achievement</B></div>
      <Row on={done(0)}><span>2nd place · Lagos State Science Fair</span><span data-tour="verify">{done(1) ? <Tag tone="green">Verified</Tag> : <Tag>waiting</Tag>}</span></Row>
      <Row><span>Spelling bee · class winner</span><Tag tone="green">Verified</Tag></Row>
      <div className="mt-2"><B at="share">Share link</B></div><Note on={done(2)}>synergyswift.ng/p/8f3c… · valid 90 days</Note></Box>) },
  // ---------------- Fees and finance ----------------
  { id: "collections", group: "money", features: ["Collections"], title: "Fee collections", area: "Fees", path: "school/fees/collections",
    benefit: "Firm, polite follow-up that brings money in.",
    steps: [{ at: "family", say: "Collections: who owes, how long, and the next step for each family." }, { at: "write", say: "Write it for me drafts a reminder that fits this family's situation." }, { at: "promise", say: "Record a promise to pay; it is checked against payments every day." }],
    Scene: ({ done }) => (<div><Box><Row at="family" hi={done(0)}><span><b>Mrs Okafor</b> · ₦85,000 · 43 days</span><span className="text-rose-700">Call: promise broken</span></Row><Row><span>Mr Bello · ₦40,000 · 12 days</span><span>Remind</span></Row></Box>
      <Box className={`mt-2 ${show(done(0))}`}><div className="flex justify-between"><p className="text-[11px] text-slate-500">Reminder message</p><B at="write">Write it for me</B></div>
        <p className={`mt-1 text-[11.5px] ${show(done(1))}`}>&quot;Dear Mrs Okafor, Chidi&apos;s fees balance is ₦85,000. We would be grateful to agree a date with you this week…&quot;</p>
        <div className="mt-2"><B at="promise">Record promise</B></div><Note on={done(2)} tone="green">₦85,000 promised by 15 Nov</Note></Box>
    </div>) },
  { id: "accounts", group: "money", features: ["Accounts and buying"], title: "Accounts and buying", area: "Office", path: "school/finance",
    benefit: "Clean books and no surprise spending.",
    steps: [{ at: "req", say: "A teacher requests lab supplies." }, { at: "approve", say: "The head approves; above the limit, a second approver signs too." }, { at: "po", say: "A purchase order goes out; on delivery, stock and the ledger update." }],
    Scene: ({ done }) => (<Box><Row at="req"><span>Requisition · Lab supplies · ₦240,000</span><Tag tone={done(1) ? "green" : "amber"}>{done(1) ? "approved ×2" : "waiting"}</Tag></Row>
      <div className="mt-2 flex gap-2"><B at="approve" primary>Approve</B><B at="po">Raise PO</B></div>
      <Note on={done(2)}>PO-0412 to Science Direct Ltd · received · Ledger: Lab expenses +₦240,000</Note></Box>) },
  { id: "hr", group: "money", features: ["HR and payroll"], title: "HR and payroll", area: "Office", path: "school/payroll",
    benefit: "Staff paid right and on time, with tax and pension done for you.",
    steps: [{ at: "leave", say: "Approve Mrs Bello's leave; cover is arranged." }, { at: "run", say: "Run October payroll: PAYE, pension and NHF worked out." }, { at: "send", say: "Payslips go to every staff member." }],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><p className="text-[11px] text-slate-500">Leave</p><Row><span>Mrs Bello · 3–5 Nov</span><B at="leave">{done(0) ? "Approved" : "Approve"}</B></Row></Box>
      <Box><div className="flex justify-between"><p className="text-[12px] font-medium">October payroll</p><B at="run" primary>Run</B></div>
        <div className={show(done(1))}><Row><span>Gross</span><span>₦18.4m</span></Row><Row><span>PAYE · Pension · NHF</span><span>₦2.9m</span></Row><Row><span>Net to 64 staff</span><span>₦15.5m</span></Row></div>
        <div className="mt-2"><B at="send">Send payslips</B></div></Box>
    </div>) },
  // ---------------- Safety and welfare ----------------
  { id: "bus", group: "safety", features: ["School bus"], title: "School bus", area: "Safety", path: "school/transport",
    benefit: "Parents stop worrying about the journey.",
    steps: [{ at: "board", say: "The bus attendant marks Ada boarded at her stop." }, { at: "parent", say: "Her mother sees it, with the bus on the map." }, { at: "alert", say: "If a child boarded but never reached school, staff are alerted at once." }],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><p className="text-[11px] text-slate-500">Route 3 · Lekki · morning</p><Row><span>Ada Okonkwo · Admiralty Way</span><B at="board">{done(0) ? "Boarded 7:05" : "Boarded"}</B></Row><Row><span>Tobi Adeyemi · Chevron</span><Tag>next stop</Tag></Row></Box>
      <Box at="parent" className={show(done(0))}><p className="text-[11px] text-slate-500">Parent app</p><p className="text-[12px]">Ada boarded at 7:05 · bus 6 min from school</p>
        <div data-tour="alert"><Note on={done(2)} tone="amber">Check: Daniel Ojo boarded at 6:58 but is not in school.</Note></div></Box>
    </div>) },
  { id: "boarding", group: "safety", features: ["Boarding and exeat"], title: "Boarding and exeat", area: "Safety", path: "school/hostel",
    benefit: "Every boarder accounted for, every night.",
    steps: [{ at: "roll", say: "Evening roll call in the boarding house." }, { at: "exeat", say: "An exeat request goes to the parent to approve, in the app or by USSD." }, { at: "late", say: "If a boarder isn't back on time, the house is alerted." }],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><div className="flex justify-between"><p className="text-[12px] font-medium">Kings House · roll call</p><B at="roll" primary>Start</B></div><p className={`mt-1 text-[12px] ${show(done(0))}`}>46 present · 2 on exeat · 0 missing</p></Box>
      <Box><Row at="exeat"><span>Exeat · Ada · Fri–Sun</span><Tag tone={done(1) ? "green" : "amber"}>{done(1) ? "parent approved" : "with parent"}</Tag></Row>
        <div data-tour="late"><Note on={done(2)} tone="amber">Late: Tobi due back 6pm Sunday, not signed in.</Note></div></Box>
    </div>) },
  { id: "health", group: "safety", features: ["Health and safeguarding"], title: "Health and safeguarding", area: "Safety", path: "school/health",
    benefit: "Care that is recorded and followed up, and children kept safe.",
    steps: [{ at: "visit", say: "Sick bay: Ada has a headache; the nurse records the visit and medicine given." }, { at: "parent", say: "Her parent is told." }, { at: "concern", say: "A safeguarding concern goes straight to the lead, and escalates if not seen." }],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><div className="flex justify-between"><p className="text-[12px] font-medium">Sick bay</p><B at="visit" primary>+ Visit</B></div><p className={`mt-1 text-[12px] ${show(done(0))}`}>Ada · headache · paracetamol 500mg 11:20 · back to class</p>
        <div data-tour="parent"><Note on={done(1)}>Mrs Okonkwo told on WhatsApp</Note></div></Box>
      <Box><div className="flex justify-between"><p className="text-[12px] font-medium">Safeguarding</p><B at="concern">Raise concern</B></div><Note on={done(2)} tone="amber">Sent to the designated lead · escalates to the principal in 2 hours</Note></Box>
    </div>) },
  { id: "visitors", group: "safety", features: ["Visitors"], title: "Visitors", area: "Safety", path: "school/visitors",
    benefit: "You always know who is on site.",
    steps: [{ at: "sign", say: "A visitor signs in at reception with who they are seeing." }, { at: "badge", say: "A badge prints; the host is told they have arrived." }, { at: "out", say: "Signed out on leaving. Fire roll call includes visitors." }],
    Scene: ({ done }) => (<Box><div className="flex justify-between"><p className="text-[12px] font-medium">Reception</p><B at="sign" primary>Sign in visitor</B></div>
      <Row on={done(0)}><span>Mr Eze · meeting the principal · 10:05</span><span data-tour="badge"><Tag tone={done(1) ? "navy" : "slate"}>{done(1) ? "badge V-031" : "…"}</Tag></span></Row>
      <div className="mt-2"><B at="out">{done(2) ? "Signed out 10:50" : "Sign out"}</B></div></Box>) },
  // ---------------- Families ----------------
  { id: "messages", group: "families", features: ["Messages in their way"], title: "Messages and notices", area: "Families", path: "school/messages",
    benefit: "Messages that are actually read, in the parent's own language.",
    steps: [{ at: "compose", say: "Write a notice to JSS2 parents." }, { at: "channels", say: "It goes the way each parent prefers: WhatsApp, SMS, email or the app, translated where needed." }, { at: "receipts", say: "Read receipts show who has seen it." }],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><div className="flex justify-between"><p className="text-[12px] font-medium">New notice</p><B at="compose" primary>Write</B></div><p className={`mt-1 text-[12px] ${show(done(0))}`}>Mid-term break: school closes Thursday at 1pm.</p></Box>
      <Box at="channels" className={show(done(0))}><p className="text-[11px] text-slate-500">Sending to 214 families</p><p className="text-[12px]">WhatsApp 142 · SMS 48 · Email 24{done(1) ? " · 31 in Yoruba, 12 in Hausa" : ""}</p>
        <div data-tour="receipts" className="mt-2 text-[11.5px]">{done(2) ? <>Read by <b>196</b> of 214</> : ""}</div>{done(2) && <Bar v={92} />}</Box>
    </div>) },
  { id: "elections", group: "families", features: ["Elections"], title: "Elections", area: "Students", path: "school/elections",
    benefit: "Trusted results in minutes, with every vote secret.",
    steps: [{ at: "create", say: "Set up the prefect election: posts, candidates and who may vote." }, { at: "kiosk", say: "Students vote on their phones or a kiosk tablet; one vote each, secret." }, { at: "results", say: "Results the moment voting closes." }],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><div className="flex justify-between"><p className="text-[12px] font-medium">Head girl</p><B at="create" primary>Set up</B></div>{["Ada Okonkwo", "Ifeoma Nwosu"].map(n => <Row key={n} on={done(0)}><span>{n}</span></Row>)}</Box>
      <Box at="kiosk" className={show(done(0))}><p className="text-[11px] text-slate-500">Turnout</p><Bar v={done(1) ? 86 : 0} /><p className="mt-1 text-[12px]">{done(1) ? "512 of 596 voted" : ""}</p>
        <div className="mt-2"><B at="results">Results</B></div><Note on={done(2)} tone="green">Ada Okonkwo elected · 301 votes</Note></Box>
    </div>) },
  // ---------------- Leadership ----------------
  { id: "reports", group: "leadership", features: ["Reports and returns"], title: "Reports and returns", area: "Home", path: "school/reports",
    benefit: "Inspection-ready all year, with no spreadsheets to rebuild.",
    steps: [{ at: "dataset", say: "Report builder: attendance by class, this term." }, { at: "schedule", say: "Email it to the heads every Monday." }, { at: "census", say: "The annual school census is worked out from your records." }],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><p className="text-[11px] text-slate-500">Report builder</p><div className="mt-1"><B at="dataset">Attendance by class</B></div><div className={show(done(0))}>{["JSS1 96%", "JSS2 94%", "SS1 89%"].map(x => <Row key={x}><span>{x}</span></Row>)}</div>
        <div className="mt-2"><B at="schedule">Schedule</B></div><Note on={done(1)}>Every Monday 7am to 4 heads</Note></Box>
      <Box><div className="flex justify-between"><p className="text-[12px] font-medium">Government returns</p><B at="census" primary>Census</B></div><Note on={done(2)} tone="green">2026 census: 1,240 pupils, 64 staff, 32 classrooms, ready to submit</Note></Box>
    </div>) },
  { id: "security", group: "leadership", features: ["Roles and security"], title: "Roles and security", area: "Settings", path: "school/roles",
    benefit: "Children's records stay safe, and everyone sees only what their job needs.",
    steps: [{ at: "role", say: "Create a role: Head of department." }, { at: "priv", say: "Choose what it may see and do, privilege by privilege." }, { at: "mfa", say: "Require two-step sign-in for staff; every change is recorded." }],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><div className="flex justify-between"><p className="text-[12px] font-medium">Roles</p><B at="role" primary>+ Role</B></div><div className={show(done(0))}><p className="mt-1 text-[12px] font-medium">Head of department</p>
        <div data-tour="priv">{["See department results", "Approve scores", "See fees"].map((p, i) => <Row key={p}><span>{p}</span><span>{done(1) ? (i < 2 ? "✓" : "–") : ""}</span></Row>)}</div></div></Box>
      <Box><div className="flex items-center justify-between text-[12px]"><span>Two-step sign-in for staff</span><span data-tour="mfa" className={`h-5 w-9 rounded-full p-0.5 transition-colors ${done(2) ? "bg-navy" : "bg-slate-300"}`}><span className={`block h-4 w-4 rounded-full bg-white transition-transform ${done(2) ? "translate-x-4" : ""}`} /></span></div>
        <Note on={done(2)}>Change history: Mrs Okonkwo turned on two-step sign-in · 10:42</Note></Box>
    </div>) },
  { id: "ai", group: "leadership", features: ["AI assistant"], title: "AI assistant", area: "Teaching", path: "school/lesson-notes",
    benefit: "Hours back for teaching, with staff checking every draft.",
    steps: [{ at: "note", say: "Write for me: a lesson note on fractions for JSS1." }, { at: "slides", say: "Slides from the topic, with pictures, ready for the projector." }, { at: "edit", say: "The teacher edits and saves; nothing goes out unchecked." }],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><div className="flex justify-between"><p className="text-[12px] font-medium">Lesson note · Fractions</p><B at="note">Write for me</B></div>
        <p className={`mt-1 text-[11.5px] ${show(done(0))}`}>Objectives: pupils can name, compare and add simple fractions. Starter: share a loaf among 4…</p></Box>
      <Box><div className="flex justify-between"><p className="text-[12px] font-medium">Slides</p><B at="slides">Make slides</B></div>
        <div className={`mt-1 grid grid-cols-3 gap-1 ${show(done(1))}`}>{["What is a fraction?", "Equal parts", "Try it"].map(x => <span key={x} className="rounded bg-brand-50 p-1.5 text-[10px]">{x}</span>)}</div>
        <div className="mt-2"><B at="edit" primary>{done(2) ? "Saved" : "Edit and save"}</B></div></Box>
    </div>) },
  { id: "groups", group: "leadership", features: ["Groups of schools"], title: "Groups of schools", area: "Home", path: "group",
    benefit: "One view of every school for the proprietor.",
    steps: [{ at: "group", say: "A proprietor with three schools sees them side by side." }, { at: "compare", say: "Compare attendance, fees and results across the group." }, { at: "drill", say: "Open any school to see the detail." }],
    Scene: ({ done }) => (<Box at="group"><p className="text-[12px] font-medium">Greenfield Group · 3 schools</p>
      {([["Greenfield College", "96%", "78%", "74.1"], ["Greenfield Primary", "97%", "84%", "—"], ["Greenfield Abuja", "91%", "61%", "69.8"]] as const).map(([n, a, f, r], i) => (
        <Row key={n} at={i === 2 ? "drill" : undefined} hi={i === 2 && done(2)}><span>{n}</span><span className="tabular-nums text-slate-600">{done(1) ? `${a} · fees ${f} · avg ${r}` : ""}</span></Row>))}
      <div className="mt-2"><B at="compare">Compare</B></div></Box>) }
];
