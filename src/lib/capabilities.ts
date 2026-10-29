/**
 * The complete list of what Synergy Swift does, numbered straight through so any
 * item can be referred to by its number. Shown on /guide with the tour's screens.
 * `lead` is the item's name where it has one; `more` lists its parts.
 */
export type Capability = { n: number; lead?: string; text?: string; more?: string[] };
export type CapabilitySection = { letter: string; title: string; items: Capability[] };

export const CAPABILITIES: CapabilitySection[] = [
  { letter: "A", title: "Website and joining", items: [
    { n: 1, text: "Welcome page with the Synergy Swift logo drawn as an animated dial, plus a guest box for students to join a lesson." },
    { n: 2, text: "Menus: Features, Take a tour, Join a class, Sign in, Sign up." },
    { n: 3, text: "Features page listing all 42 features, each with what it gives the school." },
    { n: 4, text: "Take a tour: 40 video-style chapters with a moving cursor, play/pause, step, jump and keyboard controls." },
    { n: 5, text: "Join a lesson as a guest with only a code, no account needed." },
    { n: 6, text: "Sign up a school with a one-time onboarding code that works once and lasts 20 minutes." },
    { n: 7, text: "Book a walk-through (demo request form)." },
    { n: 8, text: "Student account sign-up with a class code." },
    { n: 9, text: "Confirmation emails sent through SendGrid, with a button that mail scanners can't use up." },
    { n: 10, text: "Forgot password, and \"send the confirmation again\"." },
    { n: 11, text: "Sign in with email, username (students), phone code, or school Google/Microsoft account." },
    { n: 12, text: "Two-step sign-in, approved devices, and school network rules." }
  ] },
  { letter: "B", title: "Platform console (the Synergy Swift team)", items: [
    { n: 13, text: "Create, pause, suspend and delete schools." },
    { n: 14, text: "Onboarding codes, each with a live 20-minute countdown." },
    { n: 15, text: "Sign-ups page: confirm, resend or remove any new account." },
    { n: 16, text: "Modules per school: on, off, or on until a date." },
    { n: 17, text: "Plans and prices, invoices, renewals, grace periods, and automatic pause for non-payment." },
    { n: 18, text: "Schools pay online by Paystack using a private pay link, with automatic receipts." },
    { n: 19, text: "Sales CRM with an AI sales manager: lead scores, follow-ups, quotes and the pipeline." },
    { n: 20, text: "Customer health, revenue figures, module use and system speed." },
    { n: 21, text: "Platform team roles (owner, admin, support) and time-limited support visits that schools can see." },
    { n: 22, text: "School groups for proprietors with several schools." }
  ] },
  { letter: "C", title: "Students and the school office", items: [
    { n: 23, lead: "Student records", text: "one record per child, with guardians, medical notes, documents and history." },
    { n: 24, lead: "Admissions to leaving", text: "admission numbers, class moves, transfers, and a leaving and clearance checklist." },
    { n: 25, lead: "Special needs (SEN)", text: "profiles, support plans (IEPs), extra time that flows into exams, and a home–school book with parents." },
    { n: 26, lead: "Classes", text: "admins create classes and assign teachers and students. Teachers see only their own classes; the school chooses which roles see all." },
    { n: 27, lead: "Automatic accounts", text: "students get logins and parents get invitations, without anyone doing it by hand." },
    { n: 28, lead: "Timetable", text: "generated automatically around rooms and teacher availability, with AI suggestions when lessons don't fit." },
    { n: 29, lead: "Calendar", text: "room bookings, a school calendar and a private calendar feed for phones." },
    { n: 30, lead: "Events and trips", text: "consent and payment, rosters, and alerts if a trip is late back." },
    { n: 31, lead: "Behaviour and houses", text: "merits, incidents, detentions and house points." },
    { n: 32, lead: "Staff cover", text: "finds and assigns cover when a teacher is away." },
    { n: 33, lead: "Lesson observations", text: "checklists, scores, and the teacher's reply." },
    { n: 34, lead: "School setup", text: "sessions, terms, departments, school dashboard customisation, and a full change history." }
  ] },
  { letter: "D", title: "Results and report cards", items: [
    { n: 35, lead: "The school's own assessment pattern", text: "Tests, CA, CAT, projects and exams, with its own marks and weights. Ready-made Nigerian, British and American patterns to start from." },
    { n: 36, lead: "Grade bands and positions", text: "the school's own bands, pass mark, positions, class averages and GPA." },
    { n: 37, lead: "Effort, conduct and co-curricular ratings", text: "the school's own areas and scale." },
    { n: 38, lead: "Score sheets", text: "approvals, compiling, AI-drafted comments with tone settings, and the principal's comments." },
    { n: 39, lead: "Report cards and transcripts", text: "printed with the school's seal and verifiable online." },
    { n: 40, lead: "Result PINs and scratch cards", text: "results opened online, or by USSD on a basic phone." },
    { n: 41, lead: "Exam results requests", text: "parents and students can ask for a resit, a late sitting or extra time." }
  ] },
  { letter: "E", title: "Exams and entrance", items: [
    { n: 42, lead: "Computer-based tests", text: "23 question types and 17 subject tools." },
    { n: 43, lead: "Exam security", text: "Safe Exam Browser lock, face checks, and answers saved even when the network drops." },
    { n: 44, lead: "Marking", text: "objective questions marked automatically; for essays, AI suggests a mark with reasons, and the teacher decides." },
    { n: 45, lead: "Paper import", text: "turn a PDF or Word exam paper into questions." },
    { n: 46, lead: "Exam office", text: "hall check-in, a live board of every hall, invigilation, cover, extra time and resits." },
    { n: 47, lead: "Entrance exams", text: "online or at the school's centre with seats and PINs, automatic marking, interviews, a merit list, offers, a waiting list and a results checker." }
  ] },
  { letter: "F", title: "Teaching and learning", items: [
    { n: 48, lead: "Live lessons", text: "the projector and students' phones together, with polls, drawing and 15 question types. Guests can join." },
    { n: 49, lead: "Live games", text: "five modes (classic, team battle, survival, race, homework), power-ups, characters to collect, and leaderboards." },
    { n: 50, lead: "AI slides", text: "made from a topic, with photos from Pixabay, and an \"Open in Canva\" button." },
    { n: 51, lead: "Homework", text: "set, collect and mark, with voice feedback, annotations and an originality check." },
    { n: 52, lead: "Class discussions", text: "a board for each class, for its teachers and students only." },
    { n: 53, lead: "Lesson notes and schemes of work", text: "AI drafts, then approval." },
    { n: 54, lead: "Online learning", text: "learning paths, SCORM/H5P/xAPI content, online classes with Zoom, breakout rooms and offline mode." },
    { n: 55, lead: "Classroom points and class story", text: "with a weekly report to parents every Friday." },
    { n: 56, lead: "Library", text: "barcode loans, reservations and fines, plus 78 free titles to read and download (novels, inspirational books, textbooks, and learning sites for the Nigerian, British and American curricula)." },
    { n: 57, lead: "Portfolios and achievements", text: "with photos, teacher verification and share links. Teachers have their own portfolios." },
    { n: 58, lead: "Targets", text: "for each student and for each class." },
    { n: 59, lead: "Study helper", text: "an AI tutor for students, if the school switches it on." },
    { n: 60, lead: "Early warning", text: "students falling behind are flagged, with the reasons." },
    { n: 61, lead: "Clubs and co-curricular activities", text: "sessions, attendance and competitions." }
  ] },
  { letter: "G", title: "Fees and finance", items: [
    { n: 62, lead: "Fees and invoices", text: "invoices, optional extras, discounts, scholarships (two people approve), instalments, late fees and automatic reminders." },
    { n: 63, lead: "Online payment", text: "Paystack, Flutterwave, Remita and Stripe, with receipts at once, bank transfer proof and statements." },
    { n: 64, lead: "Collections", text: "a debtors list by age, promises to pay, and reminders written for each family by AI." },
    { n: 65, lead: "Fundraising", text: "campaigns and donations." },
    { n: 66, lead: "Cashless wallet and tuck shop" },
    { n: 67, lead: "Accounts", text: "budgets, petty cash, the ledger, closing the books, and QuickBooks/Sage/Zoho exports." },
    { n: 68, lead: "Stock, assets and maintenance" },
    { n: 69, lead: "Buying", text: "requisitions, approvals, suppliers, quotes, purchase orders and receiving goods." },
    { n: 70, lead: "HR", text: "staff files, recruitment with a careers page and AI job adverts, onboarding and offboarding, and leave." },
    { n: 71, lead: "Staff time", text: "shifts, clock-in by QR code or phone, late and early rules, and their effect on pay." },
    { n: 72, lead: "Appraisals", text: "with AI drafts from the evidence, plus training records." },
    { n: 73, lead: "Payroll", text: "PAYE (Nigeria Tax Act 2025), pension, NHF and NHIS, staff loans and payslips." }
  ] },
  { letter: "H", title: "Safety and welfare", items: [
    { n: 74, lead: "Gate sign-in and sign-out", text: "cards, fingerprint, QR code or PIN, with parents told at once." },
    { n: 75, lead: "Pickup", text: "one-time pickup codes for a named collector, released at the gate kiosk with the child's photo." },
    { n: 76, lead: "School bus", text: "routes, boarded and dropped-off records, live position, and an alert if a child is missing." },
    { n: 77, lead: "Boarding", text: "exeat with the parent's approval (also by USSD), roll calls, late-return alerts, and menus and dining." },
    { n: 78, lead: "Health", text: "sick bay visits, medicines, allergies and immunisations." },
    { n: 79, lead: "Welfare", text: "counselling, safeguarding with escalation, wellbeing check-ins, and safe student messaging." },
    { n: 80, lead: "Visitors", text: "sign-in and badges." }
  ] },
  { letter: "I", title: "Families and communication", items: [
    { n: 81, lead: "Parent app", text: "every child on one page, Ask the school, fees, results, the bus and absences." },
    { n: 82, lead: "Messages", text: "sent by WhatsApp, SMS, email or app push, in the parent's own language, with read receipts and quiet hours." },
    { n: 83, lead: "Notices, newsletters and emergency alerts" },
    { n: 84, lead: "Two-way messages", text: "a shared WhatsApp inbox and parent–teacher meeting booking." },
    { n: 85, lead: "USSD for basic phones", more: ["results with a PIN", "fees balance", "attendance today", "the school bus", "a pickup code", "report an absence", "approve or decline an exeat"] },
    { n: 86, lead: "Admissions", text: "enquiries, online applications with form fees, and an AI admissions assistant that can reply and chase by itself." },
    { n: 87, lead: "Elections", text: "prefect and PTA, with a secret ballot, kiosk voting and live results." },
    { n: 88, lead: "Help desk, alumni pages and re-enrolment" }
  ] },
  { letter: "J", title: "Leadership, reports and connections", items: [
    { n: 89, lead: "Head's dashboard", text: "live figures, the weekly \"plain words\" AI summary, and a layout each school customises." },
    { n: 90, lead: "Insights", text: "results, value added, fees and admissions." },
    { n: 91, lead: "Report builder", text: "with scheduled email reports." },
    { n: 92, lead: "Government returns and the annual census" },
    { n: 93, lead: "Compliance", text: "policies, staff checks, inspection readiness (MoE/SUBEB, BSO, COBIS, Cambridge), consent records and e-signatures." },
    { n: 94, lead: "Roles and privileges", text: "custom roles, privilege by privilege." },
    { n: 95, lead: "AI assistant (staff)", more: ["writes: report comments, lesson notes, quizzes, slides, notices, appraisals, job adverts, support-plan targets, fee reminders", "checks: essay marks, timetable fixes", "summarises: the head's summary", "translates for parents", "runs on Gemini, with Groq and OpenRouter as backup, inside a monthly allowance per school"] },
    { n: 96, lead: "Connections", more: ["website feeds and embeds", "public API and webhooks", "Google Classroom and Microsoft Teams sync", "LTI learning tools"] },
    { n: 97, lead: "Groups of schools", text: "reports across every school a proprietor owns." },
    { n: 98, lead: "Mobile", text: "installable as an app, works offline, and has a lite mode for weak connections." },
    { n: 99, lead: "Data protection", text: "each school's records are kept apart, built to the Nigeria Data Protection Act 2023, with a change history on everything." }
  ] }
];
