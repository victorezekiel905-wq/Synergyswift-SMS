"use client";
/**
 * The chapters of "Take a tour" (TourPlayer.tsx). Each is a small mock of the real
 * screen; `at` names the element the cursor clicks (data-tour), and done(n) says
 * whether step n's click has happened, so the screen changes as the real one does.
 */
export type Done = (n: number) => boolean;
type Step = { at: string; say: string };
export type Chapter = { id: string; title: string; area: string; path: string; benefit: string; steps: Step[]; Scene: (p: { done: Done; step: number }) => React.ReactElement };

const show = (on: boolean) => `transition-all duration-500 ${on ? "opacity-100 translate-y-0" : "pointer-events-none opacity-0 translate-y-1"}`;
const H = ({ children, sub }: { children: React.ReactNode; sub?: string }) => (
  <div className="mb-3"><p className="font-serif text-[18px] font-semibold text-navy">{children}</p>{sub && <p className="text-[12px] text-slate-500">{sub}</p>}</div>
);
const B = ({ at, children, primary, pressed }: { at: string; children: React.ReactNode; primary?: boolean; pressed?: boolean }) => (
  <span data-tour={at} className={`inline-flex items-center rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-300 ${primary ? "bg-navy text-white" : "border border-slate-300 bg-white text-slate-800"} ${pressed ? "ring-2 ring-brass-500/60" : ""}`}>{children}</span>
);
const Tag = ({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "navy" }) => (
  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10.5px] font-medium ${{ slate: "bg-slate-100 text-slate-600", green: "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-600/20", amber: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20", navy: "bg-navy text-white" }[tone]}`}>{children}</span>
);
const Box = ({ children, className = "", at }: { children: React.ReactNode; className?: string; at?: string }) => <div data-tour={at} className={`rounded-lg border border-slate-200 bg-white p-3 ${className}`}>{children}</div>;
const Bar = ({ v }: { v: number }) => <div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-navy transition-[width] duration-700" style={{ width: `${v}%` }} /></div>;

export const CHAPTERS: Chapter[] = [
  { id: "setup", title: "Set up your school", area: "Settings", path: "school/setup", benefit: "Your own assessment pattern and grading, set once, used everywhere.",
    steps: [
      { at: "tab-grading", say: "School setup → Grading. Every school assesses differently, so this is yours to decide." },
      { at: "pattern", say: "Start from a ready pattern: here, Nigerian secondary with two CAs, a test and the exam." },
      { at: "add-cat", say: "Add your own parts too, like a CAT, with its marks and weight." },
      { at: "save", say: "Save. Score sheets, report cards and positions all follow this pattern from now on." }
    ],
    Scene: ({ done }) => {
      const parts: [string, number, boolean][] = [["CA 1", 10, done(1)], ["CA 2", 10, done(1)], ["Test", 20, done(1)], ["CAT", 10, done(2)], ["Exam", done(2) ? 50 : 60, done(1)]];
      return (<div>
        <H sub="Classes, terms, grading and departments">School setup</H>
        <div className="mb-3 flex gap-1 text-[12px]">{["Terms", "Grading", "Classes", "Departments"].map(t => <span key={t} data-tour={t === "Grading" ? "tab-grading" : undefined} className={`rounded px-2.5 py-1 ${t === "Grading" && done(0) ? "bg-navy text-white" : "text-slate-600"}`}>{t}</span>)}</div>
        <div className={show(done(0))}>
          <Box className="mb-2"><div className="flex flex-wrap items-center gap-2 text-[12px]"><span className="text-slate-500">Start from:</span>
            <B at="pattern" pressed={done(1)}>Nigeria: CA + Test + Exam</B><span className="text-slate-400">British: Coursework + Exam</span><span className="text-slate-400">US: Quizzes, Tests, Final (GPA)</span></div></Box>
          <Box><table className="w-full text-[12px]"><thead className="text-left text-slate-500"><tr><th>Part</th><th>Marks</th><th /></tr></thead>
            <tbody>{parts.filter(([n, , on]) => n !== "CAT" || on).map(([n, m, on]) => <tr key={n} className={`border-t border-slate-100 ${show(on)}`}><td className="py-1">{n}</td><td className="tabular-nums">{m}</td><td /></tr>)}</tbody></table>
            <div className="mt-2 flex items-center justify-between"><B at="add-cat">+ Add a part</B><span className="text-[11px] text-slate-500">Total {done(1) ? 100 : 0}</span><B at="save" primary>{done(3) ? "Saved" : "Save"}</B></div></Box>
        </div>
      </div>);
    } },
  { id: "classes", title: "Classes, teachers, students", area: "Students", path: "school/class-teams", benefit: "Everyone sees only their own classes, so records stay private and screens stay simple.",
    steps: [
      { at: "new-class", say: "Class teams → New class. Admins create the classes." },
      { at: "add-teacher", say: "Add the teachers who teach it: Mrs Bello for English, Mr Ade for Maths." },
      { at: "add-students", say: "Add the students: 32 from the admissions list in one click." },
      { at: "privacy", say: "Teachers and students now see this class, and only their own classes. Admins see all." }
    ],
    Scene: ({ done }) => (<div>
      <H sub="Who teaches and learns in each class">Class teams</H>
      <div className="mb-2 flex gap-2"><B at="new-class" primary>+ New class</B></div>
      <Box className={show(done(0))}>
        <p className="font-semibold">JSS1 Gold</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 text-[12px]">
          <div><p className="text-slate-500">Teachers</p><B at="add-teacher">+ Add teacher</B>
            <ul className={`mt-1 space-y-0.5 ${show(done(1))}`}><li>Mrs Bello · English · form teacher</li><li>Mr Ade · Mathematics</li></ul></div>
          <div><p className="text-slate-500">Students</p><B at="add-students">+ Add students</B>
            <p className={`mt-1 ${show(done(2))}`}>32 students added</p></div>
        </div>
        <p data-tour="privacy" className={`mt-3 rounded bg-slate-50 p-2 text-[11.5px] text-slate-700 ${show(done(2))}`}>Only these teachers and students see JSS1 Gold&apos;s lessons, homework and discussions.</p>
      </Box>
    </div>) },
  { id: "admissions", title: "Admissions", area: "Students", path: "school/admissions", benefit: "Families hear back in minutes, and more enquiries become enrolments.",
    steps: [
      { at: "enquiry", say: "A parent enquired on the website last night. Open it." },
      { at: "draft", say: "The assistant has drafted a reply in the school's voice. Read it." },
      { at: "send", say: "Send. The family has its answer and the next step." },
      { at: "offer", say: "After the entrance test, one click issues the offer letter with the acceptance fee." }
    ],
    Scene: ({ done }) => (<div>
      <H sub="Enquiries, applications, tests and offers">Admissions</H>
      <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr]">
        <Box at="enquiry"><p className="text-[12px] font-medium">Mrs Adeyemi</p><p className="text-[11px] text-slate-500">JSS1 for Tobi · 10:42pm</p><Tag tone="amber">New</Tag></Box>
        <Box className={show(done(0))}><p className="text-[11px] text-slate-500">Reply</p>
          <p data-tour="draft" className="mt-1 text-[12px] leading-relaxed">Good morning Mrs Adeyemi, thank you for your interest in Greenfield College. JSS1 admission for September is open; the entrance test is on 14 November…</p>
          <div className="mt-2 flex gap-2"><B at="send" primary>{done(2) ? "Sent" : "Send"}</B><B at="offer">Issue offer</B></div>
          <p className={`mt-2 text-[11.5px] text-emerald-800 ${show(done(3))}`}>Offer sent: accept by 30 Nov, acceptance fee ₦50,000.</p></Box>
      </div>
    </div>) },
  { id: "gate", title: "Gate and registers", area: "Attendance", path: "school/gate", benefit: "Fast mornings, and certainty about who is in school.",
    steps: [
      { at: "card", say: "At the gate, Ada taps her card (or fingerprint, QR, or a PIN on the kiosk)." },
      { at: "notice", say: "Her mother gets a WhatsApp message straight away." },
      { at: "all-present", say: "In class, the teacher marks the register: all present…" },
      { at: "absent", say: "…then taps Chidi, who is absent. The office follows it up." }
    ],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><p className="text-[11px] text-slate-500">Main gate kiosk</p>
        <div data-tour="card" className="mt-2 flex h-16 items-center justify-center rounded-md border border-dashed border-slate-300 text-[12px] text-slate-500">{done(0) ? "Ada Okonkwo · in · 7:42" : "Tap card"}</div>
        <p data-tour="notice" className={`mt-2 rounded-md bg-slate-50 p-2 text-[11.5px] ${show(done(0))}`}><b className="text-emerald-800">WhatsApp</b> · Ada arrived at school at 7:42.</p></Box>
      <Box><p className="text-[11px] text-slate-500">Register · JSS2 Blue</p>
        <ul className="mt-1 space-y-1 text-[12px]">{["Ada Okonkwo", "Chidi Musa", "Tobi Adeyemi"].map(n => (
          <li key={n} data-tour={n === "Chidi Musa" ? "absent" : undefined} className="flex justify-between"><span>{n}</span>
            <Tag tone={n === "Chidi Musa" && done(3) ? "amber" : done(2) ? "green" : "slate"}>{n === "Chidi Musa" && done(3) ? "absent" : done(2) ? "present" : "–"}</Tag></li>))}</ul>
        <div className="mt-2"><B at="all-present">All present</B></div></Box>
    </div>) },
  { id: "live", title: "Live lessons and games", area: "Teaching", path: "live/teacher", benefit: "Every student takes part, and every answer lands in the markbook.",
    steps: [
      { at: "present", say: "Open a lesson and press Present. A join code appears on the projector." },
      { at: "joined", say: "Students join on their phones, signed in or as guests with just the code." },
      { at: "poll", say: "Ask a question. Answers come in live." },
      { at: "battle", say: "Turn it into a team battle. Scores go to the markbook." }
    ],
    Scene: ({ done }) => (<div>
      <H sub="Photosynthesis · SS1">Live lesson</H>
      <div className="mb-2 flex gap-2"><B at="present" primary>Present</B><B at="poll">Ask the class</B><B at="battle">Team battle</B></div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Box><p className="text-[11px] text-slate-500">Projector</p><p className="mt-1 text-center font-mono text-2xl font-semibold tracking-widest text-navy">{done(0) ? "482 107" : "· · ·"}</p>
          <p data-tour="joined" className="mt-1 text-center text-[11.5px] text-slate-600">{done(1) ? "31 joined (6 guests)" : done(0) ? "Waiting for students…" : ""}</p></Box>
        <Box className={show(done(2))}><p className="text-[12px] font-medium">Which gas do plants take in?</p>
          {([["Carbon dioxide", 74], ["Oxygen", 16], ["Nitrogen", 10]] as const).map(([l, v]) => <div key={l} className="mt-1.5 text-[11.5px]"><div className="flex justify-between"><span>{l}</span><span>{v}%</span></div><Bar v={done(2) ? v : 0} /></div>)}
          <p className={`mt-2 text-[11.5px] ${show(done(3))}`}>Blue House leads with 86 points</p></Box>
      </div>
    </div>) },
  { id: "discuss", title: "Homework and class discussion", area: "Teaching", path: "forums", benefit: "Learning carries on after the bell, in a safe space for each class.",
    steps: [
      { at: "set-hw", say: "Set homework for the class, due Thursday. Students and parents see it at once." },
      { at: "new-post", say: "Open the class discussion and ask a question." },
      { at: "reply", say: "A student replies from home." },
      { at: "pin", say: "The teacher pins the best answer. Only this class and its teachers can see the board." }
    ],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-[1fr_1.3fr]">
      <Box><p className="text-[11px] text-slate-500">Homework · JSS2 Blue</p><p className={`mt-1 text-[12px] ${show(done(0))}`}>Fractions worksheet · due Thu</p><div className="mt-2"><B at="set-hw" primary>Set homework</B></div></Box>
      <Box><div className="flex items-center justify-between"><p className="text-[11px] text-slate-500">JSS2 Blue discussion</p><B at="new-post">New post</B></div>
        <div className={`mt-2 rounded bg-slate-50 p-2 text-[12px] ${show(done(1))}`}><b>Mr Ade:</b> Why is ½ the same as 2/4?</div>
        <div data-tour="reply" className={`mt-1.5 rounded border p-2 text-[12px] ${done(3) ? "border-brass-500" : "border-slate-200"} ${show(done(2))}`}><b>Ada:</b> Because you multiply top and bottom by 2. {done(3) && <Tag tone="navy">Pinned</Tag>}</div>
        <div className="mt-2 text-right"><B at="pin">Pin answer</B></div></Box>
    </div>) },
  { id: "exams", title: "Secure exams", area: "Exams", path: "exams", benefit: "Fair exams that hold up on results day, marked the moment they end.",
    steps: [
      { at: "seb", say: "Lock the paper to the Safe Exam Browser with one switch." },
      { at: "publish", say: "Publish. Students sit it in the hall or at home with face checks." },
      { at: "answer", say: "Answers are saved as they go, even if the connection drops." },
      { at: "marked", say: "Submitted, and marked at once." }
    ],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><p className="font-medium text-[12px]">Mathematics · JSS2 · Second test</p>
        <div className="mt-2 flex items-center justify-between text-[12px]"><span>Safe Exam Browser lock</span><span data-tour="seb" className={`h-5 w-9 rounded-full p-0.5 transition-colors ${done(0) ? "bg-navy" : "bg-slate-300"}`}><span className={`block h-4 w-4 rounded-full bg-white transition-transform ${done(0) ? "translate-x-4" : ""}`} /></span></div>
        <div className="mt-3"><B at="publish" primary>{done(1) ? "Published" : "Publish"}</B></div></Box>
      <Box className={show(done(1))}><p className="text-[11px] text-slate-500">Question 7 of 30 · 24:18</p><p className="mt-1 text-[12px]">Profit on ₦54,000 sold for ₦63,000, as a percentage?</p>
        {["12.5%", "16.7%", "14.3%"].map((o, i) => <p key={o} data-tour={i === 1 ? "answer" : undefined} className={`mt-1 rounded border px-2 py-1 text-[12px] ${i === 1 && done(2) ? "border-navy bg-brand-50" : "border-slate-200"}`}>{o}</p>)}
        <p data-tour="marked" className={`mt-2 text-[12px] font-medium text-emerald-800 ${show(done(3))}`}>Submitted · 26/30 · marked</p></Box>
    </div>) },
  { id: "results", title: "Results and report cards", area: "Results", path: "school/results", benefit: "Results day without the late nights, and parents who see results the moment you publish.",
    steps: [
      { at: "compile", say: "Scores are in. Compile: totals, grades, positions and averages, your way." },
      { at: "comments", say: "Write for me drafts each comment from the child's scores, attendance and effort. The teacher edits." },
      { at: "effort", say: "Effort, conduct and co-curricular ratings use the school's own scale." },
      { at: "publish", say: "Publish. Parents open the report card with a result PIN, even on a basic phone." }
    ],
    Scene: ({ done }) => (<div>
      <H sub="JSS2 Blue · First term">Results</H>
      <div className="mb-2 flex flex-wrap gap-2"><B at="compile" primary>Compile</B><B at="comments">Write for me</B><B at="publish">Publish</B></div>
      <Box><table className="w-full text-[12px]"><thead className="text-left text-slate-500"><tr><th>Student</th><th>Average</th><th>Position</th></tr></thead>
        <tbody>{([["Ada Okonkwo", 84.2, "1st"], ["Tobi Adeyemi", 78.4, "2nd"], ["Chidi Musa", 71.0, "3rd"]] as const).map(([n, a, p]) => <tr key={n} className="border-t border-slate-100"><td className="py-1">{n}</td><td>{done(0) ? a : "–"}</td><td>{done(0) ? p : "–"}</td></tr>)}</tbody></table>
        <p className={`mt-2 rounded bg-slate-50 p-2 text-[11.5px] ${show(done(1))}`}>&quot;Ada is a focused and curious learner whose Mathematics has grown steadily this term…&quot;</p>
        <p data-tour="effort" className={`mt-1.5 text-[11.5px] ${show(done(2))}`}>Punctuality: Excellent · Neatness: Very good · Football: Good</p>
        <p className={`mt-1.5 ${show(done(3))}`}><Tag tone="green">Published</Tag></p></Box>
    </div>) },
  { id: "fees", title: "Fees", area: "Fees", path: "school/fees", benefit: "Money in sooner, with every naira accounted for.",
    steps: [
      { at: "generate", say: "Generate first-term invoices for every family, with discounts and the bus fee." },
      { at: "pay", say: "A parent pays on the phone with Paystack: card, transfer or USSD." },
      { at: "receipt", say: "The receipt goes out at once and the books update by themselves." },
      { at: "remind", say: "For those still owing, a polite reminder written for each family." }
    ],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><div className="flex items-center justify-between"><p className="text-[12px] font-medium">First term fees</p><B at="generate" primary>Generate invoices</B></div>
        <p className={`mt-2 text-[12px] ${show(done(0))}`}>412 invoices · ₦52.8m</p>
        <div className="mt-2 text-[11px] text-slate-500">Collected</div><Bar v={done(2) ? 78 : done(0) ? 72 : 0} />
        <div className="mt-2"><B at="remind">Remind families</B></div><p className={`mt-1 text-[11.5px] ${show(done(3))}`}>38 reminders written and sent</p></Box>
      <Box className={show(done(0))}><p className="text-[11px] text-slate-500">Parent&apos;s phone</p><p className="mt-1 text-[12px]">Ada Okonkwo · ₦185,000</p>
        <div className="mt-2"><B at="pay" primary>{done(1) ? "Paid" : "Pay with Paystack"}</B></div>
        <p data-tour="receipt" className={`mt-2 text-[11.5px] text-emerald-800 ${show(done(2))}`}>Receipt RCT-88104 sent</p></Box>
    </div>) },
  { id: "safety", title: "Pickup, bus and boarding", area: "Safety", path: "school/gate", benefit: "No child leaves with the wrong adult, and every boarder is accounted for.",
    steps: [
      { at: "code", say: "Uncle Tunde is collecting today. Mum makes a one-time pickup code in the app (or by USSD on a basic phone)." },
      { at: "kiosk", say: "At the gate, the code shows Ada's photo and who may collect her." },
      { at: "release", say: "Release. The code is used up and mum is told." },
      { at: "exeat", say: "Boarders' exeats need a parent's yes, also by USSD, and late returns raise an alert." }
    ],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><p className="text-[11px] text-slate-500">Parent app</p><div className="mt-2"><B at="code" primary>Pickup code for Uncle Tunde</B></div>
        <p className={`mt-2 font-mono text-xl font-semibold tracking-widest text-navy ${show(done(0))}`}>482-913</p>
        <div className="mt-2 border-t border-slate-100 pt-2 text-[12px]"><span className="text-slate-500">Exeat Fri–Sun · </span><B at="exeat">Approve</B>{done(3) && <Tag tone="green">Approved</Tag>}</div></Box>
      <Box at="kiosk" className={show(done(0))}><p className="text-[11px] text-slate-500">Gate · pickup</p>
        <div className={`mt-2 flex items-center gap-2 ${show(done(1))}`}><span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-[11px]">AO</span><span className="text-[12px]"><b>Ada Okonkwo</b><br />Collector: Tunde Okonkwo (uncle)</span></div>
        <div className="mt-2"><B at="release" primary>{done(2) ? "Released 3:12pm" : "Release"}</B></div></Box>
    </div>) },
  { id: "families", title: "Parents, on any phone", area: "Families", path: "parent", benefit: "Every family is reached, smartphone or not, and the office takes fewer calls.",
    steps: [
      { at: "child", say: "The parent app: every child on one page, arrival, homework, results, fees, the bus." },
      { at: "ask", say: "Ask the school answers everyday questions from what the school has published." },
      { at: "ussd", say: "No smartphone? Dial the Synergy Swift code." },
      { at: "ussd-2", say: "Choose Fees balance: the answer, and a payment link by SMS." }
    ],
    Scene: ({ done }) => (<div className="grid gap-2 sm:grid-cols-2">
      <Box><p className="text-[11px] text-slate-500">Parent app</p>
        <div data-tour="child" className="mt-1 rounded bg-slate-50 p-2 text-[12px]"><b>Ada · JSS2 Blue</b><br />In school since 7:42 · 98% attendance · ₦0 owing</div>
        <div className="mt-2"><B at="ask">Ask the school</B></div>
        <p className={`mt-2 rounded bg-slate-50 p-2 text-[11.5px] ${show(done(1))}`}><b>When does term end?</b> On Friday 12 December. Resumption is Monday 12 January.</p></Box>
      <div data-tour="ussd" className="mx-auto w-full max-w-[220px] rounded-2xl border-2 border-slate-400 bg-slate-100 p-3 font-mono text-[11.5px]">
        <div className="min-h-[120px] rounded bg-[#d9e4cf] p-2 text-slate-900">
          {done(3) ? <>Ada: fees balance ₦0.<br />Thank you.</> : done(2) ? <>Greenfield College<br />1. Results<br />2. Fees balance<br />3. Attendance today<br />4. School bus<br />5. Pickup code</> : <>*347*12#</>}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1 text-center">{["1", "2", "3", "4", "5", "6"].map(k => <span key={k} data-tour={k === "2" ? "ussd-2" : undefined} className="rounded bg-white py-0.5">{k}</span>)}</div>
      </div>
    </div>) },
  { id: "lead", title: "The head's view", area: "Home", path: "school", benefit: "Spot problems in days, not at the end of term, on a dashboard arranged your way.",
    steps: [
      { at: "tiles", say: "One page for the whole school: attendance, fees, registers, admissions, live." },
      { at: "summary", say: "Write my summary: the week in plain words, with what to act on." },
      { at: "customise", say: "Customise: choose what your dashboard shows, and in what order." },
      { at: "toggle", say: "Add Exams this week; hide what you don't use. It's saved for the school." }
    ],
    Scene: ({ done }) => (<div>
      <div className="mb-2 flex items-center justify-between"><H>Good evening, Mrs Okonkwo</H><B at="customise">Customise</B></div>
      <div data-tour="tiles" className="grid grid-cols-2 gap-2 sm:grid-cols-4">{([["Attendance", "96.4%"], ["Fees", "78%"], ["Registers", "38/38"], [done(3) ? "Exams this week" : "Applications", done(3) ? "4 papers" : "64"]] as const).map(([l, v]) => <Box key={l}><p className="text-[10.5px] text-slate-500">{l}</p><p className="text-[15px] font-semibold">{v}</p></Box>)}</div>
      <div className={`mt-2 rounded border border-slate-200 p-2 text-[11.5px] ${show(done(2))}`}><span className="text-slate-500">Show: </span>
        <span data-tour="toggle">☐ Applications → ☑ Exams this week</span> · ☑ Fees · ☑ Attendance</div>
      <Box className="mt-2"><div className="flex items-center justify-between"><p className="text-[12px] font-medium">This week in plain words</p><B at="summary">Write my summary</B></div>
        <ul className={`mt-1 space-y-0.5 text-[11.5px] ${show(done(1))}`}><li>• Attendance fell from 95% to 91% in SS2.</li><li>• Fees collected rose to 78%.</li><li>• Next: speak to SS2 form teachers on Monday.</li></ul></Box>
    </div>) }
];
