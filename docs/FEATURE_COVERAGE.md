# Feature coverage

Progress against the full school-platform specification (23 sections). Updated as each phase lands on the `full-spec` branch.

**Key:** ✅ built · 🟡 partly built (what is missing is noted) · ⬜ not built yet · 🔑 code built, needs your account or keys to switch on

Phases: **1** assessment and report cards (done) · **2** admissions CRM (done) · **3** parent and community CRM (done) · **4** core platform and security (done) · **5** SIS (done) · **6** learning management (done) · **7** attendance, timetable, calendar (done) · **8** communication (done) · **9** finance (done) · **10** HR and payroll (done) · **11** welfare, boarding, transport, library, inventory, co-curricular (done) · **12** portals and apps · **13** analytics, integrations, compliance · **14** Synergy Swift master requirements (October 2026): 14a exam question types and subject tools (done) · 14b plans, modules, super admin, privileges and billing (done) · 14c Synergy Swift name and navigation (done) · 14d SwiftCipher learning module, games and classroom management (done) · 14e entrance automation (done) · 14f elections (done) · 14g CRMs (done) · 14h SEN engagement (done) · 14i attendance, shifts and bus safety (done) · 14j exam extras (done) · 14k super admin centre (done) · 14l result PINs and group reports (done) · 14m 20,000-user test (done, see docs/LOAD_TEST_REPORT.md) · 14n proposal and MoU (done: Word and PDF in the "Synergy Swift Doc" folder; scripts/sales/build-docs.cjs) · 14o portfolios and transcripts (done).

## 7. Assessment and examinations (phase 1, done)

| Feature | Status |
|---|---|
| Question bank by subject, topic, difficulty, Bloom's level, level, exam body and year | ✅ |
| Question types: MCQ, multi-select, true/false, short answer, essay, matching, fill-in-the-gap, drag-and-drop, maths input, coding, numeric, ordering, hotspot, file upload | ✅ coding answers auto-marked by test cases: JavaScript built in; Python, Java, C, C++, C#, SQL 🔑 (Judge0) |
| CBT engine: randomised questions and options, per-student question pools, timers, auto-save, auto-marking | ✅ |
| Proctoring: Safe Exam Browser, tab-switch and focus detection, webcam snapshots with face checks in every modern browser, IP restriction | ✅ |
| Continuous assessment with weighted components | ✅ |
| Exam timetable generation, invigilation roster, seating plans, hall allocation | ✅ |
| Mock exams in WAEC, NECO, JAMB, BECE, NCEE, IGCSE, A Level and SAT shapes; past-question practice bank | ✅ 99 original starter practice questions included; official past questions are imported by each school |
| Moderation workflow: teacher → HOD → principal | ✅ |
| Item analysis: difficulty, discrimination, distractors, common wrong answers, reliability | ✅ |

## 8. Gradebook and report cards (phase 1, done)

| Feature | Status |
|---|---|
| Configurable gradebook: weighting, grade boundaries, comments bank | ✅ |
| Term and cumulative results, class and subject position, averages | ✅ |
| Nigerian, British and American report templates; principal and teacher comments; affective/psychomotor; attendance; next-term date | ✅ |
| Batch PDF (print the class as one PDF), digital signatures with QR verification, fee-gated parent access | ✅ |
| Transcripts, broadsheets, master score sheets | ✅ |
| Mid-term progress reports, predicted grades, target grades | ✅ |

## 1. Core platform and administration (phase 4, done)

| Feature | Status |
|---|---|
| Multi-school, separate branding, group dashboard for chains | ✅ (branches in different currencies are shown side by side, not added up) |
| Sessions, terms, classes, arms, houses | ✅ |
| Sections (Nursery, Primary, Secondary, Sixth form) as their own layer, with a head and a curriculum each | ✅ |
| Curriculum frameworks (Nigerian UBE/BECE/WAEC/NECO, British EYFS and KS1–KS5, Cambridge Primary to IGCSE and A Level, American Pre-K–12) and mixed setups: one step creates sections, classes and arms, usual subjects and matching grading schemes; a class may follow a different curriculum from its section | ✅ |
| Granular RBAC including HOD, form tutor, counsellor, alumni | ✅ counsellor (pastoral staff: behaviour, early warning, read-only health) and alumni (own alumni page only, no school data) |
| Settings: grading, report templates, timezone, currency, languages | ✅ currency chosen from a list (₦, GH₵, KSh, R, CFA, $, £, €) and used for every amount; Paystack schools are warned about currencies Paystack does not take. One currency per school; invoicing in a second currency is not built (Stripe charges in the school currency) |
| Audit logs for every create, edit and delete | ✅ change history on every table holding school data (except high-volume machine logs), with who, when, before and after; secrets never stored; server-side writes record the person they acted for; filters, record history, CSV download, retention setting |
| CSV/Excel import and export; migration tools | ✅ students, parents, staff (optionally with sign-in invitations), classes, subjects, who teaches what, opening fee balances, alumni and vendors; checked before importing, row-by-row problems, column names from other systems recognised; every one exportable to CSV or Excel in the same columns |
| Global search | ✅ Ctrl/⌘ K across students, staff, families, classes, invoices, complaints, enquiries, applications, alumni, partners and pages, limited to what each person may see |

## 2. Authentication and security (phase 4)

| Feature | Status |
|---|---|
| Email/password | ✅ |
| SSO with Google Workspace and Microsoft 365 | ✅ 🔑 sign-in buttons, "staff must use single sign-on" rule, and join-by-school-email with admin approval (providers are switched on in Supabase and listed in `NEXT_PUBLIC_SSO_PROVIDERS`) |
| Phone OTP sign-in | ✅ 🔑 6-digit code by SMS through the school platform's SMS provider, rate-limited, one account per number, then the usual second factor |
| Two-factor authentication | ✅ |
| Password policies, session management | ✅ length, character mix, common-password and name checks, expiry (staff or everyone); idle sign-out, maximum session length, signed-in devices with sign-out, admin "sign out everywhere" |
| Parent–child linking, sibling grouping | ✅ |
| NDPA/GDPR compliance, child-data consent records | ✅ permissions per child or family with versioned wording, answered in the parent portal or recorded from paper, coverage report and printable lists, privacy notice, consents in the data export |
| Encrypted storage, automated backups, uptime monitoring | ✅ 🔑 Supabase encrypts at rest and in transit and takes daily backups (point-in-time recovery on paid plans); `/api/status` for an uptime monitor |
| IP/device restrictions for exams and staff portals | ✅ staff limited to the school network, approved devices, or either; enforced in the database, so it also covers direct data access; admins can be exempt and cannot lock themselves out |

## 3. CRM: admissions and enquiries (phase 2, done)

| Feature | Status |
|---|---|
| Lead capture: website enquiry form (embeddable), WhatsApp click-to-chat, Facebook/Instagram ads (tracked links and lead webhook), walk-ins and calls (quick add), open-day registration, parent referral links | ✅ (Meta lead ads arrive through the webhook via Zapier, Make or Meta's integrations 🔑) |
| Kanban pipeline Enquiry → Tour booked → Applied → Assessed → Offer → Accepted → Enrolled / Lost, kept in step with applications | ✅ |
| Lead scoring and source / campaign tracking (UTM tags, referrers, referral codes), duplicate merging | ✅ |
| Follow-up automation: email, SMS and WhatsApp sequences by stage, staff tasks and reminders | ✅ (WhatsApp outside the 24-hour window needs the approved template 🔑) |
| Tour and open-day booking: slots with capacity, public booking, confirmations, calendar files, day-before reminders, attendance | ✅ |
| Online application forms: document upload (birth certificate, reports, passport photo), application fee paid online | ✅ (online payment needs Paystack or Flutterwave keys 🔑) |
| Entrance exams (online test from a private link) and interviews with notes and scores | ✅ |
| Offer letters from templates, e-signature acceptance (name, drawn signature, letter fingerprint, time, IP), acceptance fee online, expiry | ✅ |
| Waitlist with positions and places per level | ✅ |
| One-click conversion to student with parent records and siblings | ✅ |
| Admissions analytics: funnel, source and campaign conversion, cost per enquiry and per enrolment, staff response time and conversion, monthly trends, lost reasons | ✅ |

## 4. CRM: parent and community (phase 3, done)

| Feature | Status |
|---|---|
| 360° family profile: children, other guardians, fees, attendance, results, retention risk, and one timeline of messages, complaints, survey answers, payments, meetings, events, re-enrolment, referrals and everything sent | ✅ |
| Interaction history: calls, meetings, visits and notes logged by staff, with follow-up dates (families, alumni and partners) | ✅ |
| Complaints and requests with SLAs: raised from the parent portal or logged by staff, numbered, assigned, promised reply and resolve times per priority, automatic escalation to the principal, internal notes, a tracking link for the family, satisfaction rating when resolved, performance stats | ✅ |
| NPS and satisfaction surveys: question builder (NPS, ratings, multiple choice, written), sent by private link, reminders, anonymous option, results and monthly NPS trend; low scores create a follow-up ticket | ✅ |
| Segmentation: saved family segments by class, level, balance, overdue fees, NPS, retention risk, re-enrolment answer, open complaints, number of children, referrers, language and channel | ✅ |
| Re-enrolment rounds ("will your child return?") with reasons, reminders and per-class progress; retention risk score with reasons for every family | ✅ |
| Referral rewards: the school's standard reward earned automatically when a referred family enrols; approve and mark given; parents see their rewards | ✅ (fee discounts are applied to the next invoice by the bursar) |
| Alumni: import graduated students, public sign-up page, private self-update link, mentors, contact log | ✅ |
| Email/SMS campaigns and newsletters to families, segments, alumni or partners: sections with images and links, personalisation, preview, test send, scheduling, delivery numbers, one-click unsubscribe | ✅ (WhatsApp campaigns reach only people who messaged in the last 24 hours, as Meta requires) |
| Partner and vendor CRM: suppliers, sponsors and partners with contracts, renewal alerts, ratings, tags, contact log and spend from expenses | ✅ |

## 5. Student information system (phase 5, done)

| Feature | Status |
|---|---|
| Student profile, guardians, photo, documents | ✅ documents stored privately (birth certificate, reports, medical, court orders …), confidential ones limited to admins, counsellors and the nurse, some shared with the family, admissions papers kept on file in one click |
| Admission numbers, QR ID cards | ✅ |
| Promotion, transfers, withdrawals, graduation | ✅ enrolment history for every child (admitted, promoted, repeated, moved class, suspended, transferred, withdrawn, graduated, re-admitted); leaving with a clearance checklist (fees, library, boarding, wallet) that releases the bed, bus seat and sign-in; graduates join the alumni list |
| Behaviour, merits, house points | ✅ |
| SEN records and IEPs | ✅ SEN register with areas and needs, strategies shared with the child's teachers, exam access arrangements (extra time applied automatically to online exams), coordinators, support plans with targets owned by teachers, progress, reviews and parents' agreement in the portal |
| Portfolio, achievements, certificates | ✅ achievements and positions, portfolio work added by staff or by students (approved by a teacher), numbered certificates signed by the server with a QR check page, bulk issue for a class |
| Transfer certificates and testimonials | ✅ worded from the record (dates, last class, reason, conduct, fees, positions, achievements, attendance), editable before issuing, revocable |

## 6. Learning management (phase 6, done)

| Feature | Status |
|---|---|
| Lesson studio, slides, live class, games, homework, rubrics | ✅ |
| Lesson notes with approval | ✅ |
| Schemes of work with curriculum objective mapping | ✅ curriculum objectives per subject and level (added one by one or pasted from the curriculum), week-by-week schemes mapped to them, coverage showing what is planned, taught and missing, approval by the head of department, QA or the principal (never the author), copying to another term, lesson notes linked to a week |
| Content library incl. SCORM/xAPI, H5P | ✅ upload SCORM 1.2, SCORM 2004, xAPI (Tin Can), H5P or zipped web pages; packages run in a sandbox with no access to the school's session; SCORM progress, scores and time saved per student (resumes where they left off); a built-in xAPI record store; H5P state and results; results per package for staff |
| Authoring with LaTeX and code blocks | ✅ text slides, homework instructions and discussions take headings, lists, links, LaTeX maths (KaTeX) and highlighted code in 12 languages, always escaped; HTML embed slides now run in a sandbox |
| Learning paths with prerequisites | ✅ ordered steps (reading with maths and code, links, videos, interactive content, quizzes from the question bank, homework) with prerequisites (loops refused), published to classes; quizzes marked at once with explanations; content and homework steps tick themselves off; progress grid for teachers, progress for parents |
| Assignments: late penalties, resubmission | ✅ penalty per day late with a cap, resubmission with an attempt limit and every earlier attempt kept, "send back to improve", file uploads (PDF, Word, PowerPoint, images, audio, video), homework for chosen learning groups only |
| Inline annotation, voice/video feedback | ✅ comments on highlighted words in the answer and pins on uploaded images, recorded voice or video feedback, all shown to the student and family once the work is returned or marked |
| Plagiarism and AI-content checks | ✅ similarity against classmates' answers and the student's own earlier work, with the matching passages; a writing-style change check against the student's earlier work as the sign of outside or AI help. Both are labelled as prompts for a conversation, never proof |
| Discussion forums | ✅ class, school-wide and staff-room forums, threads and replies with maths and code, pinning, locking, hiding, reports from students, a language filter and a posting limit for students |
| Zoom, Google Meet, Teams | ✅ online lessons for one or more classes with a Meet, Teams or Zoom link, or the Zoom meeting created automatically (waiting room, muted entry) 🔑 school's own Zoom app or ZOOM_*; join opens 15 minutes early, who joined is recorded, teacher starts Zoom as host |
| Whiteboard, polls, breakout rooms, hand raise | ✅ breakout rooms in the live audio/video room: split at random with a time limit, move students, visit rooms, message every room, close and bring everyone back. Live rooms are now limited to the session's class (they were open to the whole school) |
| Differentiation, gamification (badges, streaks) | ✅ learning groups inside a class (support, core, extension) that homework can target; points for homework, practice and discussion, school-day streaks, automatic and teacher-given badges, a class overview, shown to students and parents |
| AI assistant: lesson plans, quiz generation, feedback, tutor bot | ✅ 🔑 (ANTHROPIC_API_KEY) lesson notes, report comments, homework feedback; quiz questions on a topic, matched to curriculum objectives or lesson notes, checked by the teacher before they reach the bank; a study helper for students (hints, not answers) that the school switches on, with a daily limit, chats readable by teachers and parents, and safety or wellbeing concerns sent to counsellors at once |
| Offline and low-bandwidth mode | ✅ interactive content kept on the device opens without a connection, and its progress is sent when the connection returns; lite mode (audio-only live classes, no animations); offline register; installable app |

## 9. Attendance (phase 7, done)

| Feature | Status |
|---|---|
| Daily and per-lesson register, by teacher app | ✅ morning register (works offline) and a register for every lesson on the teacher's timetable, including lessons they cover; starts from the morning register and agreed absences |
| QR, RFID, biometric or face-recognition check-in | ✅ QR ID cards and RFID cards at the gate kiosk (any USB card reader); fingerprint and face-recognition clocking machines through the ZKTeco push protocol (most machines sold locally) or a webhook for other systems; staff self check-in on their phone at school |
| Automatic parent alerts by SMS, WhatsApp or push for absence and lateness | ✅ absent or late on the register, gate sign-in and out, and a child who was in school but missed a lesson; WhatsApp, SMS, email and app notifications |
| Leave requests from parents, with approval | ✅ parents report an absence ahead or after (portal or WhatsApp link); the form teacher or an admin agrees or declines; agreed days are marked excused and the parent is told |
| Staff attendance and clock-in/out | ✅ daily staff sheet from the kiosk, cards, clocking machines or self check-in: first in, last out, hours, late, on leave, absent; CSV |
| Attendance analytics: chronic absence flags, trends | ✅ school and class rate, daily trend and direction, day-of-week pattern, persistent absence below the school's threshold (default 90%), frequent lateness, lessons missed while in school, registers not yet taken today |

## 10. Timetabling and calendar (phase 7, done)

| Feature | Status |
|---|---|
| Automatic timetable generator with constraints | ✅ periods and breaks, weekly loads, double periods (never across a break), teacher availability, rooms (labs, ICT suites for the subjects that need them; class home rooms), no teacher, class or room clashes, locked cells kept, and a reason for anything that cannot fit |
| Substitution/cover management | ✅ |
| School calendar: terms, holidays, events, exams, PTA meetings | ✅ one calendar for staff, students and parents: term dates, holidays, events, trips, PTA and parent meetings, published exam papers, online lessons, cover duties, room bookings, homework deadlines and (for teachers and students) weekly lessons |
| Room and facility booking | ✅ labs, halls, ICT suites and other rooms; day view with timetabled lessons; weekly repeats; no double booking (checked in the database); rooms that need an admin's approval |
| Personal calendars synced with Google and Outlook | ✅ a private calendar link per person for Google Calendar, Outlook.com, Microsoft 365 and phones; it updates itself; a new link stops the old one |

## 11. Communication (phase 8, done)

| Feature | Status |
|---|---|
| Announcements by school, section, class or individual | ✅ to the whole school, sections, classes or chosen students, families and staff; parents, students and/or staff (by role); personalised with each family's children's names; scheduled sending; a notice board on every portal |
| In-app messaging between teacher and parent and teacher and student, with safeguarding rules and monitoring | ✅ parent conversations (since v47) and now teacher–student conversations: only a student's own teachers, school days within set hours, no attachments, nothing edited or deleted, readable by safeguarding leads and (if the school allows) parents, students notified by app only; messages mentioning phone numbers, private apps, secrets, meeting up or risk are flagged and the safeguarding leads alerted; a monitoring page |
| SMS, email, WhatsApp Business API and push notifications | ✅ |
| Newsletters and circulars, with read receipts | ✅ newsletters (phase 3); circulars and announcements record who has read and who has confirmed, from the app or the link in any message, with one-tap reminders to the rest |
| Parent–teacher conference booking with time slots | ✅ teachers' own slots, and parent–teacher evenings: one form creates every teacher's appointments, invites the families, stops parents double-booking themselves, closes booking, prints each teacher's schedule |
| Emergency broadcast alerts | ✅ ready-made wording (closure, early dismissal, lockdown, weather, all clear), every channel including SMS whatever a parent's settings, "I received this" on every screen until confirmed, live confirmation count |
| Message templates and multi-language translation | ✅ saved templates with placeholders; translation into each family's home language |

## 12. Finance and fees (phase 9)

| Feature | Status |
|---|---|
| Fee structures by class, term, category and optional items | ✅ amounts per term for all classes, a class, a fee category (day, boarding, staff child …) or both, the most specific winning; optional extras (bus, lunch, clubs, uniform) charged only to the students given them, for one term or every term |
| Invoices, discounts, sibling discounts, scholarships, waivers | ✅ invoices in one step; discount rules (sibling from the nth child, staff children, a category) with the best one applied; scholarships, bursaries and waivers by percentage or amount on chosen fees, approved by a second person (changes need re-approval); manual lines still available |
| Online payments: Paystack, Flutterwave, Remita, bank transfer, USSD, card, Stripe | ✅ Paystack and Flutterwave (card, bank, USSD, transfer, QR) into the school's subaccount; Remita RRR (pay online or at a bank) 🔑; Stripe for cards from abroad 🔑; parents report bank transfers with proof and the bursary confirms; every payment re-checked with the provider |
| Installment plans and part-payments | ✅ plans (e.g. 50/25/25 with due dates) chosen when invoicing or per invoice; payments clear the earliest instalment first; part-payments |
| Automated reminders, late fees, defaulter lists | ✅ automatic reminders before the due date and every N days after; late fee (percentage and/or fixed) after a grace period, once per invoice or instalment; debtors list with ageing (current, 1–30, 31–60, 61–90, 90+ days), CSV |
| Receipts, statements of account, parent wallet | ✅ numbered receipts; statements with opening balance, running balance and totals (staff, and parents in their portal); wallet |
| Expense tracking, budgeting, petty cash | ✅ expenses by category with receipts; budgets per period (income by fee item, spending by category, payroll as Salaries) approved by a second person, with budget against actual and variance; petty cash floats with a custodian, imprest top-ups, spends with receipt photos, returns, cash counts and over/short adjustments |
| Accounting integration (QuickBooks, Sage, Zoho Books) and a general ledger | ✅ general ledger derived from invoices, payments, expenses, petty cash, approved payroll and the wallet, plus manual journals (balanced before posting, reversed rather than edited) and opening balances; editable chart of accounts with mappings for fee items, expense categories and payment methods; closing the books up to a date; journal files for QuickBooks Online, Sage 50 and Zoho Books imports (daily summary or every transaction) and the chart as CSV. A live connection to their APIs is not built: the files are imported by hand |
| Financial reports: collections, outstanding balances, revenue by class | ✅ income and expenditure, balance sheet, trial balance, account ledger; collections by day, method and class; billed, paid and outstanding by class and by fee item; debt ageing; budget against actual; all as CSV |

## 13. HR and payroll (phase 10)

| Feature | Status |
|---|---|
| Staff profiles, contracts, qualifications, documents | ✅ personal and statutory details (NIN, TIN, pension PFA and RSA PIN, NHF number, next of kin, emergency contact) seen only by the person and HR; line manager; documents (CV, ID, certificates, references kept from the person); contracts with probation and notice, accepted by the staff member; qualifications and licences (e.g. TRCN) added by staff and verified by HR, with expiry; alerts for contracts, probation and licences ending; a list of incomplete records |
| Recruitment: job postings, applicant tracking, interview scheduling | ✅ jobs on a public careers page (or staff-only), applications with a CV, stages from applied to hired with emails to the candidate, walk-ins and referrals added by HR, interviews (in person, video, phone) with a panel who each score alone, candidate tracking page and withdrawal, hiring creates the staff record, copies the CV and starts onboarding |
| Leave management and approvals | ✅ policies per type (days a year, paid or unpaid, carry-over, notice, supporting document), balances with carried-over days, half days, weekends and school holidays not counted, line manager recommends then HR decides, cover note, who is away by month, approved leave feeds the cover planner, notifications at each step |
| Payroll: salaries, allowances, deductions, PAYE, pension (RSA), NHF, payslips | ✅ pay grades and personal allowances (marked pensionable and taxable); PAYE by the Nigeria Tax Act 2025 bands (or the school's own, or a flat rate) after pension, NHF, NHIS and rent relief; pension staff and employer shares on basic + housing + transport; NHF, NHIS, NSITF and ITF; part-month pay for joiners and leavers; unpaid leave from leave policies; loans and salary advances (approved by a second person, repaid through payroll); two-person approval; payslips with employer contributions, staff told when ready; bank, PAYE (with TIN), pension (by PFA with RSA PIN), NHF and employer-cost schedules; payroll posts to the ledger. All rates are school settings 🔑 to confirm with a tax adviser |
| Staff appraisals, lesson observations, CPD tracking | ✅ appraisal cycles with weighted criteria; self-review, the line manager's (or chosen reviewer's) scores, strengths, areas to develop and recommendation, shared only at the discussion stage; goals; acknowledgement with the person's comment; observations and CPD in the cycle shown as evidence. Lesson observations (Quality assurance) acknowledged and answered by the teacher. CPD logged by staff with reflection, verified by HR, group training recorded at once, hours against a yearly target |
| Staff onboarding and offboarding checklists | ✅ templates (starter ones included) with tasks owned by HR, admin, IT, bursary, the line manager or the person, due dates from the start date, ticked only by the owner, progress and overdue items on the HR overview; recording someone as left ends their contract and can disable their login |

## 14. Student welfare and pastoral care (phase 11a)

| Feature | Status |
|---|---|
| Counselling records, confidential and role-restricted | ✅ referrals from any teacher (who sees only whether it was taken on); cases and session notes readable only by counsellors, or the safeguarding team when the counsellor shares the case; notes fixed after the day they are written; every opening of a case logged; kept out of the change history |
| Safeguarding / child-protection incident logging and escalation | ✅ any staff member reports a concern (category, urgency, the child's words) and the whole safeguarding team is alerted at once; the report is never rewritten; a chronology that cannot be edited (acknowledged, assigned, notes, calls with parents, meetings, external referrals); concerns not acknowledged in time (1 hour if critical, configurable otherwise) escalate to the principal and admins; closing needs an outcome; earlier concerns for the same child shown; access log |
| Behaviour management: incidents, detentions, interventions | ✅ points, rules and automatic follow-ups (before); incidents with everyone involved and their role, points for those responsible; detention, isolation and community-service sessions with a supervisor and capacity, parents told the date and time, served or missed; interventions (Early warning) |
| Health / sick bay: medical records, allergies, clinic visits, medication log, immunisations | ✅ medical profile with allergy severity, EpiPen and emergency care plan; visits with temperature, pulse and blood pressure, follow-up date and who is resting now, parents told; medication plans (times or when needed, parental consent) with today's round and a dose log that cannot be edited; immunisations with next-due dates and a due list |
| Wellbeing check-ins and mood surveys | ✅ daily student check-in (mood, feelings, a note, "I'd like to talk"), optionally without a name; check-ins that need a person go to the form teacher and counsellors at once; class and school mood with a daily trend and the feelings named most; followed up and recorded. Longer surveys use the survey tool (phase 3) |

## 15. Boarding (phase 11b)

| Feature | Status |
|---|---|
| Room and bed allocation | ✅ houses (boys, girls, mixed), rooms with beds, one bed per boarder, gender checked |
| Exeat / leave-out requests with parent approval | ✅ parents ask from their portal; the house or the student (from their portal) can ask too, and then a parent must agree in their portal before the child leaves; kinds (weekend, day, medical, family, holiday); sign out and back in with parents told; an alert to the house and the parents when a boarder is late back |
| Roll calls, house parent notes | ✅ roll calls per house (morning, prep, evening, lights out) starting from who is on exeat or in the sick bay, absent boarders alerting the house staff and principal at once; house notes by kind, some shared with the family in their portal |
| Meal plans and dining management | ✅ menus by day and meal with an alternative, copied week to week, shown to families; numbers to cook for and special diets and allergies from health records; a dining register |

## 16. Transport (phase 11b)

| Feature | Status |
|---|---|
| Routes, stops, vehicles, drivers | ✅ routes with stops and times; buses (insurance, roadworthiness, licence, service dates, status) and drivers (licence, medical, background check) with expiry warnings; a bus with lapsed insurance or roadworthiness, or in for repair, cannot start a trip |
| Live GPS bus tracking for parents | ✅ (v47) the attendant's phone shares the bus position; parents see it live |
| Pickup and drop-off alerts | ✅ scans on and off with parents told each time, and an alert as the bus nears their stop; at the end of a trip, children never scanned off are flagged to the attendant and the transport officer |
| Transport fee linkage | ✅ the route's bus fee is added to a rider's extras when they are put on a route (and removed when taken off), so it appears on their next invoices |

## 17. Library (phase 11c)

| Feature | Status |
|---|---|
| Catalogue (physical and e-books), ISBN/barcode scanning | ✅ print books, e-books, audiobooks, videos and links with covers, descriptions and subjects; scan an ISBN (USB scanner or the phone camera where the browser reads barcodes) to fill in details from Open Library; a library barcode for books without an ISBN; reader cards scanned at the desk |
| Borrowing, returns, reservations, fines | ✅ lend and return by scanning; a loan limit per student; renewals (none while someone is waiting); a reservation queue where a returned copy is held for the next reader, who is told, and lapses to the next if not collected; late fines per day begun, marked paid or waived; lost books charged at the book's price; overdue reminders to readers and (weekly) parents |
| E-library with digital resource access | ✅ files or links opened online by everyone, students and staff, or staff only; students reach the library and their loans from their menu |

## 18. Inventory and assets (phase 11d)

| Feature | Status |
|---|---|
| Asset register with maintenance schedules | ✅ tag, serial number, supplier, cost, location, who has it, condition, warranty; a service interval with the next date moved on by each service; services, repairs and inspections logged with cost and vendor; any member of staff reports a fault; due services and ending warranties listed |
| Store and stock management: uniforms, books, stationery | ✅ items with a size or colour, a barcode, cost and selling price; received, used and issued to a named student or member of staff; reorder levels with suggested quantities and value of stock |
| School shop / POS with student wallet payments | ✅ (v47) the till charges the student's wallet; now items scan by barcode and sell from stock, and a sale cannot sell what is not on the shelf |
| Procurement requests and approvals | ✅ requisitions from any staff member; above a set amount they are endorsed and then approved by the principal or an admin (different people, never the requester); suppliers and quotes (best one marked); purchase orders with lines into stock or the asset register; goods received in part or in full, closing the order and the requisition; payment recorded as an expense against the order |

## 19. Co-curricular (phase 11e)

| Feature | Status |
|---|---|
| Clubs, societies, sports teams: membership and attendance | ✅ clubs, societies, teams, choirs and bands with a lead and helpers, the classes they are open to and a number of places; students join themselves, ask to join (the lead accepts or declines) or are added by the lead; captains and other roles; a register for each meeting, training or match, with each member's attendance rate; a club fee goes onto members' invoices while they belong; leads run their group, while who leads it and its fee stay with admins; students and parents see their clubs |
| Events and competitions management | ✅ events as before; competitions (inter-house to international) with the team, venue and organiser; students entered by event with position, score or time and award; podium places and awards go on the child's achievements and portfolio automatically; results shown to the student and family |
| Excursions and trips: consent forms, payments, rosters | ✅ consent and payment online (v47); now the trip's departure, return, meeting point, staff going, risk assessment and emergency contact; the roster built from consent (paid only, or everyone who said yes) with each child's allergies, conditions and medication; children ticked out and back with parents told each time; staff and admins alerted if anyone is not back 30 minutes after the planned return; printable roster |

## 20. Portals and apps (phase 12a, 12b)

| Feature | Status |
|---|---|
| Student portal: timetable, assignments, results, lessons, library, fees view | ✅ `/student` opens on **Today**: the day's lessons with what is on now and next, homework (overdue, due today, handed in, marked with the score), attendance this term, library books with due dates, and their fees (what is owed, past due, next due date; the school can turn the fees view off). Below: notices, exams, report cards, progress, portfolio, clubs, exeats; lessons and content under **My learning** |
| Parent portal/app: all children in one view, results, attendance, fees, messages, bus tracking | ✅ one page for all children: a family table (in school now, attendance, homework, fees owed, family total) when there is more than one child, then each child with attendance this term, homework due or overdue, fees owed, sign-ins, results and report cards, library books and pickup codes; tabs for messages, fees and payment, wallet, live bus, events, meetings, learning, boarding, records and help. Works signed in or from the private WhatsApp link |
| Teacher portal/app: classes, register, gradebook, lesson plans, messages | ✅ `/teacher` (**My teaching day**, also on the dashboard): today's lessons including cover, with a "take register" button until each register is taken; a to-do list (registers, score sheets sent back or unfinished, homework to mark (urgent after a week), lesson notes sent back, unread parent messages); their classes and form class; one tap to registers, gradebook, homework, lesson plans, schemes of work, content, messages and calendar |
| Admin dashboard with KPIs | ✅ `/school` for heads and the bursary: attendance today, registers taken, fees collected this term, past-due fees, students and new joiners, staff on leave, behaviour incidents, admissions in progress, overdue books, stock to reorder; each with a 60-day trend line and change on the week; targets set by the school colour each figure (met, close, short). Figures are kept each afternoon after school |
| Mobile apps (iOS/Android) with push notifications | ✅ two routes. (1) The installable app (PWA), with an **Install** button or the iPhone steps, and push on Android, desktop and iPhone (iOS 16.4+). (2) Store apps through a Capacitor wrapper: `capacitor.config.json`, a start-up and offline page, a bridge that registers the phone with Firebase and opens the right page when a notification is tapped, and Firebase Cloud Messaging sending (Android, and iPhone through APNs). Every message that goes to web push also reaches the store apps. Signing out removes the device. Each person turns off groups of messages (never safety alerts) and sets quiet hours; app, WhatsApp and SMS messages wait until morning, email does not. Building, signing and submitting the store apps is a manual step (Android Studio, Xcode, store accounts): see `MOBILE_APPS.md` 🔑 |
| PWA support and offline caching | ✅ installable with home-screen shortcuts (My children, My teaching day, Register, My school), fast start from cached build files; the student, teacher and parent portals (and a parent's private link) open offline with the last copy saved on the device and a note saying when it was saved; offline register and offline lesson content as before. Saved copies belong to the signed-in person and are removed on sign-out or when someone else signs in |

## 21. Analytics and reporting (phase 13a, 13b, done)

| Feature | Status |
|---|---|
| Academic performance dashboards by student, class, subject, teacher and cohort | ✅ **Insights & returns → Results**: for any term, results grouped by class, subject, teacher, year group, boys and girls, or student. Each group shows average, median, spread, pass rate and grade spread, with a subject-by-class grid (subject-by-student within a class). Click a student for every subject across every term. Teachers see the classes and subjects they teach and their form class; leaders see the whole school |
| Early-warning system for at-risk students, combining attendance, grades and behaviour | ✅ (earlier phases) **Early warning**: a risk score from attendance, results and the change since last term, failing subjects, behaviour points and missing homework, with reasons and intervention plans |
| Teacher effectiveness and value-added analysis | ✅ **Value added** (leaders only): each student's score against what students with the same score last term got in the same subject across the school (one line per subject, so hard subjects do not count against their teachers), averaged by teacher or class with a 95% range; groups are marked above or below only when the range is clear of zero and there are at least 10 scores |
| Financial and admissions dashboards | ✅ **Fees**: billed and collected by month for a year, how families paid, collection by class this term (worst first), alongside the ledger reports and debtors. **Admissions**: applications and enrolments by month, by source with conversion, where applications stand, most-requested classes, alongside the admissions pipeline. Key numbers with trends are on the school overview (12a) |
| Custom report builder and scheduled report emails | ✅ **Report builder** (`/school/reports`): ten datasets (students, attendance, results by subject, report cards, fee invoices, payments, applications, staff, library loans, behaviour), each limited to the roles that may see it, with teachers' results limited to their classes. Choose the term, dates or class, then the columns, filters (is, contains, more/less than, blank…), grouping with totals (number, total, average, lowest, highest), sort and row limit. Run it, download it as CSV, save it privately or share it with colleagues. Email it daily, weekly or monthly at a chosen hour to staff of the school only (enforced in the database). Each run is as its author. Grouped reports carry their totals in the email; row-by-row reports send the count and a sign-in link. A 'Send now' button and a note when a send fails |
| Government/statutory returns (e.g. state ministry census data) | ✅ **Government returns**: the school's census details (school/EMIS code, state, LGA, ownership, type, location…); the annual school census worked out from records (enrolment by class and sex, ages, new entrants, repeaters, special needs, teaching and non-teaching staff by sex, teachers by highest qualification, TRCN registration, classrooms, pupil–teacher and pupil–classroom ratios); figures checked and corrected with a note, downloaded as a spreadsheet for the ministry's form or portal, then marked submitted with the ministry's reference. Once submitted it cannot be changed or deleted. Direct upload to a state portal is not built (each state differs) |

## 22. Integrations and extensibility (phase 13c–13e, done)

| Feature | Status |
|---|---|
| Google Classroom, Microsoft Teams/OneNote, Zoom | ✅ **Zoom** (6b: lessons created by the app). **Google Classroom & Teams** (`/school/classroom-sync`): each teacher connects their own Google or Microsoft school account (tokens kept on the server only, refreshed automatically, disconnect any time). They link each class (and subject) they teach to a Classroom course or Teams class, then send homework across in one click (title, instructions, due date, marks, attachment, a link back) and **bring the marks back** into the homework, matched by school email and scaled to its marks; marks another teacher entered are left alone, and unmatched emails are listed. **OneNote**: send a lesson note to the teacher's OneNote as a formatted page. Needs the school's Google Cloud and/or Microsoft Entra app details on the server 🔑 |
| Payment gateways, SMS gateways (Termii, Twilio), WhatsApp Business API | ✅ (earlier phases) Paystack and Flutterwave with school subaccounts, Remita and Stripe 🔑; SMS through Termii or Twilio with WhatsApp-to-SMS fallback; WhatsApp Business through Meta Cloud API or Twilio with approved templates; email through Resend or SendGrid. **Integrations → Connected services** shows which are set up |
| LTI 1.3 for third-party learning tools | ✅ the school system is an LTI 1.3 platform. **Learning tools** (`/school/tools`): admins register a tool (login and launch URLs, redirect URLs, the tool's JWKS address or key, custom parameters; whether names, emails and scores are shared) and get the details to give its makers (issuer, login URL, token URL, JWKS, client and deployment IDs). Teachers add a tool to the classes they teach, optionally to a page inside it and to a piece of homework. Students open it from **My school** with no extra password; the launch is signed (RS256), single-use and expires in five minutes, with roles (learner, instructor, administrator) and class. **Assignment and Grade Services**: tools get an access token with a signed request and send scores back. Teachers see them, and final scores tied to homework become the homework mark (scaled to the homework's marks) unless a teacher has marked it. Deep linking (picking content inside the tool) and names-and-roles rosters are not built |
| Public REST/GraphQL API and webhooks | ✅ **API keys** made by admins with chosen scopes (eleven, read-only except sending in applications), stored only as a hash, shown once, optional expiry, revocable, last-used shown; 120 requests a minute. **REST** at `/api/v1/<resource>` (students, classes, staff, attendance, results (published only), invoices, payments, applications (read and create), events, news) with paging and filters; the API's own description (OpenAPI 3.1) at `/api/v1`. **GraphQL** at `/api/v1/graphql` over the same resources (fields, aliases, arguments, variables; up to 5 resources per query; queries only). **Webhooks** for student created/updated, application created/status changed, payment received, invoice created, result published, news published: queued by the database itself, signed (HMAC-SHA256 with a timestamp), retried for about a day, turned off after 20 failures in a row, with a delivery log, retry, test and secret rotation; addresses must be public https sites |
| Website CMS integration so admissions forms and news feed into the school site | ✅ news posts written in the app (draft, publish, unpublish) and events ticked "show on website", served as JSON, RSS and a copy-and-paste widget (`embed.js`) for WordPress, Wix, Squarespace or plain HTML: latest news (click to read), upcoming events, and the admissions and enquiry forms in a frame that sizes itself. Applications can also arrive through the API from a site's own form. Other sites can frame only those two forms (all other pages refuse to be framed) |

## 23. Compliance and documents (phase 13f, 13g, done)

| Feature | Status |
|---|---|
| Document management for policies, certificates and inspection files | ✅ **Policies & compliance → Document library**: policies, certificates, inspection files, minutes, risk assessments, procedures, reports and plans kept privately (PDF, Word, Excel, images) with categories and tags. Versions: approving a new one retires the old. Approval is stamped with who and when. Each document is seen by leaders only, all staff, or staff and parents. Policies have review dates and certificates expiry dates; the owner (or the head) is reminded each week while one is due or expired. Policies can require staff to **read and confirm**, with a count of who has. Leaders, QA and HR manage the library |
| Inspection readiness (Ministry of Education/SUBEB, BSO/COBIS, Cambridge centre) | ✅ **Inspection readiness**: starter checklists for MoE/SUBEB minimum standards and statutory records, the eight parts of the BSO standards, COBIS accreditation areas and Cambridge exam-centre requirements. Each item has the evidence to show and a link to the part of the system that holds it. The school picks its frameworks; leaders and QA set each item's status, owner, notes, supporting documents and a date to look again (owners update their own items); readiness is shown overall and by area, and the whole framework prints as an **inspection pack**. **Single central record**: identity, right to work, qualifications, references, police and overseas checks, prohibition, medical fitness, safeguarding and first-aid training for every member of staff, with dates, references and who checked; gaps and expired checks stand out, and it prints. The checklists summarise the published frameworks; schools should check them against the current official documents |
| Consent management for photos, trips and data use | ✅ (phases 4 and v47) consent purposes with versions (photos inside school, photos on the website and social media, data use and more; schools add their own), per child or per family, required or optional; parents give or withdraw consent in their portal or link; staff record paper consents; a full history (who, when, how, version); coverage by purpose and class with who is missing or out of date; staff check which children may be photographed. Trip consent and payment in one step on events, with rosters built from consent |
| E-signatures for forms and contracts | ✅ **E-signatures** (`/school/signatures`): send a form, consent, policy or contract (written text and/or a document from the library) to staff, to the parents of chosen classes (one parent per child is enough) or, for admins and HR, to people outside the school. Each signer gets a private single-use link by app notification, email or WhatsApp and signs on any phone: typed full name, optional drawn signature, agreement to sign electronically. Time, IP address and device are recorded with a SHA-256 fingerprint of exactly what was signed. Signatures cannot be changed, a sent request cannot be edited (cancel and resend), and requests with signatures cannot be deleted. Signers may decline with a reason. Senders see progress, remind those waiting, and print the signed copy with its audit trail. HR sends a staff contract with **Send for e-signature**, and signing marks it accepted. Staff and parents see what is waiting for them on their home pages. (Admissions offer letters keep their own signing step.) Electronic signatures are generally recognised (e.g. Nigeria's Evidence Act 2011, s. 93; the UK Electronic Communications Act 2000); schools should take advice for documents that need a witness or a seal |

## 14a. Exam question types and subject tools (phase 14a, done)

| Feature | Status |
|---|---|
| 23 question types | ✅ the 14 above plus **grid** (several statements, same choices), **select words in a passage**, **label the diagram** (numbered points, shuffled labels), **plot points on a graph** (axes, grid step, snap, tolerance), **chemical equation** (any order of substances, checks balance and charge, half marks for the right substances with wrong numbers, optional state symbols), **rating scale**, **reading passage / case study** (no marks), **drawing or geometric construction** (pen, ruler lines showing length and angle, compass circles showing radius, rectangles, text, squared or graph paper or a background image) and **spoken answer** (recorded in the browser, played back when marking) |
| Numeric answers for physics and chemistry | ✅ tolerance as ± an amount or ± a percentage; required significant figures (right value, wrong s.f. = half marks); students may type 6.02 × 10^23, 6.02e23, 1,250 or add units |
| Audio and video in questions | ✅ an .mp3 or .mp4 link plays inside the question (listening tests, oral French) |
| Exam tools, switched on per exam | ✅ basic and scientific calculators (degrees/radians, inverse trig, logs, powers, roots, n!, nCr, nPr, memory, Ans), graph plotter, **four-figure tables** (logs, antilogs, squares, square roots, reciprocals, natural sines, cosines, tangents and their logs, with mean differences, laid out like the printed booklet), normal distribution table, **mathematical set** (ruler, protractor, 45° and 60°/30° set squares that move and turn on screen), maths formula sheet, maths symbols keyboard, **periodic table** (118 elements), chemistry data sheet (ions and valencies, reactivity series, electrode potentials, solubility rules, constants), physics constants, SI prefixes and formulae, unit converter, Yorùbá, Igbo, Hausa, French, Spanish and German characters, read aloud, larger text and high contrast, rough-work notepad and sketch pad (never sent or marked), and the teacher's own reference sheet |
| Subject presets | ✅ one click sets the usual tools for Mathematics, Further Maths, Physics, Chemistry, Biology/Agric, Basic Science, English, French and Nigerian languages, Accounting/Economics/Commerce, Geography/Technical drawing, Computer Studies and Primary/Common Entrance |
| Safe Exam Browser lock | ✅ a clear Locked / Unlocked switch on each exam |
| Tools in entrance tests | ✅ the same tools as the exam they use |
| Speed | ✅ each tool loads only when opened, so the exam page stays small |

## 14b. Plans, modules, super admin, privileges and billing (phase 14b, done)

| Feature | Status |
|---|---|
| Module catalogue in six groups (Core, Learning, Exams, Money, Safety, Engagement) | ✅ 36 modules, including the coming SwiftCipher live lessons, classroom management, elections, SEN and AI |
| Plans with module bundles and prices by school size | ✅ Essentials, Growth, Complete and Custom; yearly prices in naira for up to 100, 250, 500, 1,000 and 2,000 students; agreed prices above that; termly billing = a third of the year + 10%; add-on groups priced per size; discounts; all editable on **Plans & prices** |
| Super admin module switches: PLAN / ON / OFF per school, with end dates | ✅ effective state shown and checked ("Saving will switch ON … / OFF …") before saving; expired switches fall back to the plan automatically (hourly job) and are recorded; enforced by every API through `requireCtx`, not just the menus |
| Onboarding a school | ✅ five-step wizard: school and first admin (invited by email), plan and paid add-ons with the live price, module switches, staff roles the school may use, then one check before creating; the first invoice can go out at once |
| Adding and removing modules after a school starts | ✅ by changing the plan or add-ons, by switches, or by answering the school's own request (schools ask from **Subscription & modules**; the platform team is emailed, accepts or declines on **Billing & requests**, and the school is emailed back) |
| Create, suspend, pause, restart and delete schools | ✅ (delete is for the owner only; schools must be closed first and the name typed) |
| Billing | ✅ numbered invoices (SS-2026-00001), renewal invoice and email 14 days before a period ends, overdue after the end, the school paused with a clear message after the grace period, reopened the moment payment is recorded, end-at-period-end cancellation, one-off invoices, cancelling unpaid invoices; schools see and print their invoices and the bank details. Card payment through Paystack for platform invoices 🔑 later |
| Platform team: owner, admin, support | ✅ ekwuemevictor39@gmail.com is the owner automatically (now, or the moment that account is created) and cannot be removed or demoted; the owner adds admins (change and bill schools) and support (look only) by email |
| Privileges per school set by the platform | ✅ the staff roles each school may use; roles outside it stop working and cannot be given |
| Privileges inside a school set by its admins | ✅ **Roles & privileges**: custom roles that add standard roles, hide modules, and take away actions (publish results, publish/release exams, approve discounts, void payments, run payroll, withdraw students, change staff roles, send broadcasts, send admission offers), checked on the server; nobody can change their own role |
| Schools never know other schools exist | ✅ as before; the new tables are readable only inside each school (and by school admins), the platform tables not at all |
| Old billing stubs | ✅ removed: schools could previously write their own invoice rows |

## 14c. Synergy Swift name and easy navigation (phase 14c, done)

| Feature | Status |
|---|---|
| One name everywhere | ✅ Synergy Swift in the app, sign-in pages, browser tab, installable app, emails' calendar files, the school API, Safe Exam Browser files, LTI and webhooks; README and docs. Old website embed codes (`data-educlass`) keep working next to the new `data-synergyswift`; Render service ids keep their old names so the live services are not replaced |
| Eight areas in plain words instead of 80 links | ✅ Home, Teaching, Exams & results, Students & welfare, Safety & gate, Messages & families, Money, School office; only the area you are in is open, the rest show their name and how many pages they hold |
| Only what applies to you | ✅ links show only for your roles (including a custom role) and only for modules your school has |
| Plain labels | ✅ e.g. "Outside learning apps" (LTI), "Students who need help" (early warning), "Special needs (SEN)", "Cover for absent staff", "Requests to buy" |
| Pinned favourites | ✅ star any page to keep it at the top of the menu (per person, per device) |
| Quick search | ✅ Ctrl K (or the search button on phones) jumps to any page you can open |
| Phone bar | ✅ four everyday places by role (teacher: Today, Register, Homework, Parents; student: Today, Learn, Practice, Messages; parent: Children, Calendar, Account; office staff: Home, Students, Calendar, Messages) plus Menu |

## 14d-1. Class teams, automatic accounts and classroom points (phase 14d-1, done)

| Feature | Status |
|---|---|
| Admins add teachers to classes and set their privileges | ✅ **Class teams & accounts**: each class's form teacher and subject teachers, plus co-teachers, assistants and support staff (whole class or one subject) with switches for live lessons, points, class story, messaging parents and seeing results; checked by the database (`teaches_class`) |
| Students added to classes | ✅ classes come straight from the school's classes and subjects: no separate rosters or join codes |
| Student keys sent to parents automatically | ✅ every active student gets a username (admission number + school code) and a starting password; the details go to their parents by email, WhatsApp or SMS within minutes; the student must choose their own password at the first sign-in; admins can re-send a key (new starting password) |
| Parents invited automatically | ✅ parents with an email get an invitation to set a password; parents with only a phone get their private portal link (and can sign in with a code to their phone) |
| Sign in with a username | ✅ the sign-in box takes an email or a username |
| Classroom points (classroom management) | ✅ **Classroom**: tap students (or Whole class, or Random student) and a skill; positive and "needs work" skills set by the school (needs-work can be switched off); notes for parents; undo within 15 minutes; this week's totals per student and class |
| Class story for parents | ✅ text and up to 6 photos per post; children in photos must be ticked, and only those whose parents agreed to photos inside the school can be posted (the school can turn this rule off); parents see it in their portal and can like posts |
| Class tools | ✅ random student picker, group maker, timer, noise meter (sound measured on the device only) |
| Parents see points | ✅ each child's points this week and the latest class story in the parent portal (signed in or private link) |

## 14d-2. SwiftCipher's live lessons inside Synergy Swift (phase 14d-2, done)

| Feature | Status |
|---|---|
| SwiftCipher moved into Synergy Swift as the Live lessons module | ✅ its whole engine (lesson builder with slides and activities, live control room, Present view on the projector, student and guest join, Challenge games, question bank, media library, reports, lesson library, AI slides and questions 🔑) runs inside the app under **Teaching → Live lessons**; its database lives in its own `live` schema, generated from SwiftCipher by `scripts/port-swiftcipher.mjs` and its screens by `scripts/port-swiftcipher-ui.mjs` |
| One set of accounts and classes | ✅ schools, students, teachers, admins, classes, subject teachers, class members and co-teachers are copied into the engine automatically (triggers): no join codes for classes, no separate rosters, no second sign-in |
| Module switch enforced in the database | ✅ turning **Live lessons** off for a school (or closing the school) blocks it inside the engine itself |
| Safe Exam Browser lock for classes and lessons | ✅ a **Locked / Unlocked** switch on each class (every new live lesson in it starts locked) and on each running lesson (under More in the control room); a locked lesson refuses students in a normal browser at the database; students download the lesson's Safe Exam Browser file, sign in inside it and join; locking during a lesson sends students who are not in Safe Exam Browser back to the join screen. The school can add its Safe Exam Browser config keys for the stronger check |
| One name | ✅ every live-lesson screen says Synergy Swift |

## 14d-3. Quiz games rework (phase 14d-3, done)

| Feature | Status |
|---|---|
| Game modes | ✅ **Classic**; **Team battle** (teams scored by their average per player, so a bigger team never wins by size); **Survival** (1–5 lives; a wrong or missed answer costs one; survivors rank above anyone out); **Race** (each right answer is a step along a track shown to the class); **Self-paced** homework mode (no host: each student has their own question and clock until the closing time; the teacher can add a day or close it) |
| Power-ups | ✅ earned, never bought: every 3 right answers in a row gives one (up to 3 held): **Double** (next right answer scores double), **Shield** (next wrong or missed answer keeps the streak and the life), **50:50** (hides half the wrong choices for that player only); all applied by the database |
| Streaks and comebacks | ✅ streak bonus as before; a missed answer now ends a streak too; a right answer from the bottom half of the board gets +25% (up to +250) so nobody is out of it; new badges: 10-answer streak, survivor, comeback, winning team, finished every question |
| Celebrations | ✅ full-screen moments for streaks (3, 5, 10), a power-up earned, a comeback and being knocked out; points count up; podium at the end |
| Collectable characters linked to points | ✅ 16 characters (4 starters, then common, rare, epic, legendary) unlocked by XP; right answers in games now give XP (5 each plus podium bonus); the student is told when a character unlocks; **My characters** page to choose who to play as; locked characters can't be picked in the lesson lobby either |
| More question types in games | ✅ gap fill, matching, ordering and sorting play in games as well as choice and true/false; question pictures now show on the player and host screens; read-aloud for students who have it |
| Joining fixed | ✅ subject teachers can run games for the classes they teach (only the class teacher could before); students join from the game link without the code; guests of a live lesson can play the game launched from it |
| Sync fixed | ✅ when time runs out, every screen fetches the reveal at once instead of waiting up to 10 seconds; the server closes the question after the same 1.5 s grace answers get |
| Scores fixed | ✅ team totals no longer decided by team size; ending a game mid-question costs nobody a life or a streak |
| Leaderboard for guests fixed | ✅ every board row has an opaque key, so "you" is found by key, not by name (two guests called Sam, or anonymous "Player 3", used to break it); guests appear on game boards |
| Live module confirmations | ✅ the live screens' confirm dialogs and messages work (the provider was missing after the move, so "End game" and similar buttons did nothing); the easy-to-read font support works on live screens |

## 14e. Entrance exam automation (phase 14e, done)

| Feature | Status |
|---|---|
| Rules per intake | ✅ **Admissions → Entrance exams**: one intake per class (and intake label): the test, when it is sent, where it is taken, camera check at home, Safe Exam Browser at centres, weights for test, interview and previous report, overall and per-section pass marks, borderline band, who is interviewed, automatic or approve-first decisions, waiting-list size, results release date, scores shown or not, offer validity, acceptance fee, class to enrol into |
| Automatic assignment | ✅ the moment an application arrives, or its form fee is paid (online or marked paid), the test is assigned by the database and seated in the earliest sitting with room; "Assign waiting applicants" catches up older applications |
| Sittings and centres | ✅ online windows and centre sessions with seats; seats are booked with a lock, so a centre is never overbooked; adding a sitting seats everyone waiting; families can choose a date when the school allows; staff can move a candidate; multi-centre board (booked, checked in, writing, handed in, absent) |
| Messages | ✅ families are told the link and window, or the centre, time and a one-time **PIN** (or asked to choose a date); a reminder the day before; candidates who miss their sitting are marked absent and told |
| On-site test (CBT) | ✅ the centre computer shows the PIN screen (`/entrance/pin`); the PIN only works during that sitting; wrong PINs are limited per computer; Safe Exam Browser file per sitting; centre tests cannot be started from home; staff can issue a new PIN |
| Camera check at home | ✅ a photo every minute; no face / two faces / camera off are flagged for staff to review (never marked down automatically); photos deleted after 60 days |
| Scores | ✅ weighted score from the test, interview and report; percent per question section; section pass marks |
| Merit list and decisions | ✅ ranked against the seats left: offers to the top, then the waiting list, regret below the pass mark or once the list is full; borderline candidates are **booked into an interview** automatically (next interview session with room) and decided after it; decisions sent automatically or by "Send decisions" after approval; offers use the school's offer letter (e-sign, acceptance fee) |
| Waiting list moves up | ✅ a declined or expired offer frees a seat and the best candidate still waiting is offered it |
| Results checker | ✅ `/apply/results/<school>`: application number + surname; only after release; score shown if the school chooses; the family's tracking page shows the result, the test details and date choice |
| One-step enrolment | ✅ "Enrol accepted": every accepted child whose acceptance fee is paid becomes a student (admission number, class, guardian, first-term invoice); sign-ins for the child and parent follow automatically |
| Entrance analytics | ✅ applicants, tested, absent, passed, offered, joined; score spread; feeder schools and sources (average, offered, joined); hardest questions |

## 14f. Elections and voting (phase 14f, done)

| Feature | Status |
|---|---|
| Elections | ✅ **Students & welfare → Elections & voting**: prefects, PTA, class reps, house captains, staff or other; voters are students, parents, staff or everyone, for the whole school or chosen classes; voting window; posts with one or more seats; candidates (picked from the school's students, with photo and promises, or any name) |
| One vote, checked by the database | ✅ votes go only through the database's checks: on the voters' list, voting open, no more choices than seats, real candidates for that post, and one vote per person (or per family for PTA elections) |
| Secret ballot | ✅ who voted and what was chosen are stored apart with nothing linking them (ballots have no voter and no time), so not even the head can see anyone's vote; ballots and votes can't be read by anyone directly, only counted; each voter gets a receipt code to check their ballot was counted |
| Voting online | ✅ **Vote** in the student and parent menus: the ballot paper (choose one / up to N, read each candidate's promises, abstain by leaving a post blank), check your choices, cast; parents (and staff) are told by email/WhatsApp when voting opens and when results are out |
| Teacher-run voting tablet | ✅ a teacher opens the tablet screen for a class they teach: pick the student whose turn it is, the student votes full-screen (no menus), "thank you" and back to the list; the teacher sees who has voted (online or on the tablet), never how |
| Live turnout | ✅ can vote, voted (%), online, on a tablet, and by class; refreshes while voting is open |
| Results | ✅ counts per candidate, the elected, abstentions, and ties on a seat flagged for the school to settle; live for officers if the election allows, otherwise once voting closes; published to voters when the school chooses |
| Fixed ballot paper and audit | ✅ posts and candidates can't change once votes are cast; creating, opening, closing and publishing are recorded in the audit log |

## 14g-1. Synergy Swift's own sales CRM and customer health (phase 14g-1, done)

| Feature | Status |
|---|---|
| Book a demo | ✅ `/demo` (linked from the home page): school, contact, size, needs; becomes a scored lead at once and the platform team is emailed; throttled per address, with a hidden spam trap |
| Pipeline | ✅ **Platform → Sales & customers**: prospect schools by stage (new, contacted, demo booked, demo done, on trial, proposal sent, won, lost) with size, yearly value, lead score and next step (overdue in red); open deals, pipeline and weighted value, won this month, follow-ups due |
| Lead score | ✅ size, stage, how recent the last contact was, source (referrals close best) and a planned next step |
| Activity | ✅ calls, WhatsApp (one tap to chat), emails, meetings, demos and notes; stage changes logged; a lost school needs a reason |
| Quotes | ✅ priced from the platform's own plans, size bands, add-on groups, termly or yearly and discount (the same prices billing uses); numbered; emailed to the contact; accepted moves the lead to won |
| Won → school | ✅ "Create the school" opens the new-school wizard filled in from the lead and its quote; the lead is linked and marked won |
| Customer health and churn risk | ✅ every school's health score with the reasons in plain words: staff signing in, use this month against last, school gone quiet, overdue invoices, subscription past due, renewal within 60 days, no parents or students yet; at risk / watch / healthy; renewals in the next 60 days |
| Onboarding checklist | ✅ school created, data imported, staff trained, parents invited, live; ticks itself from what the school does, or by hand |

## 14g-2. Fee collections, fundraising and the family timeline (phase 14g-2, done)

| Feature | Status |
|---|---|
| Collections worklist | ✅ **Fees → Collections**: every family that owes (siblings together), balance, days overdue, escalation level, open or broken promise, last contact and the suggested next step; filters for "need action now", "promised to pay" and "broke a promise" |
| Promises to pay | ✅ record an amount and a date; checked every day against payments since: kept (closes itself, even early) or broken (the family's case goes to "call", a follow-up for today is left on the family's record, and the parent gets a polite message with the payment link) |
| Escalation | ✅ reminded → bursar has called → principal's letter → final notice; the next step rises with how long the money is overdue and what has already been tried |
| One-tap contact | ✅ call, WhatsApp, payment page, send a reminder with the pay link, log the contact (shared with the family's record) |
| Fundraising | ✅ **Families & community → Fundraising**: appeals with a goal and dates; public giving page (`/give/<school>/<appeal>`) with progress and recent supporters (as the school allows; anonymous gifts never named) and online giving through the school's payment provider (card, transfer, USSD); gifts and pledges taken at the school (cash, transfer, cheque, POS); receipts numbered; thank-you messages; pledges marked paid later |
| Gifts can't be faked | ✅ an online gift is marked paid only after the payment provider confirms the exact amount; staff can record only offline gifts |
| Family timeline | ✅ the family's 360° record now also shows promises to pay (kept/broken) and gifts |

## 14g-3. Two-way WhatsApp inbox and channel return (phase 14g-3, done)

| Feature | Status |
|---|---|
| Parents' WhatsApp messages in the inbox | ✅ messages to the school's WhatsApp number arrive in the shared school-office inbox as a WhatsApp thread for that family (the family is found by phone however the number was typed; when a number belongs to families in two schools, the school that last messaged it gets it; unknown numbers are kept for the platform team); photos and voice notes are marked; each message is kept once even when WhatsApp retries 🔑 |
| Replies go back on WhatsApp | ✅ a staff reply in a WhatsApp thread goes straight to the parent's WhatsApp within WhatsApp's 24-hour window (delivered / failed shown), otherwise the parent gets the usual notification; translation, safeguarding flags and the hourly limit work as for portal messages |
| Signed webhooks only | ✅ Meta requests are checked with the app secret, Twilio requests with the auth token; anything else is refused. Needs `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` (🔑, set on the server) |
| School switch | ✅ a school can turn the WhatsApp inbox off (`tenant_settings.whatsapp_inbox`) |
| Lead scoring | ✅ (already in admissions) each enquiry's score with its reasons |
| Channel return | ✅ admissions analytics now show, per source, the fees billed to the children it brought in and the return for every ₦1 of marketing spend, beside cost per enquiry and per enrolment |

## 14h. SEN engagement: parents, students and the school (phase 14h, done)

| Feature | Status |
|---|---|
| Parents see the support plan | ✅ a parent of a child on the SEN register sees, in their portal (Support plans), how the school supports the child, the active plan's targets with progress, success criteria and the next review date; the SENCO decides per child whether the profile is shared with the family (on by default); staff-only notes such as agencies never leave the school |
| Parents agree the plan and add their views | ✅ "I agree with this plan" with their name and views, shown on the plan for staff; the coordinator is told |
| How each target is going at home | ✅ parents (and the child) rate each target from "Hard" to "Great" with a comment; staff see it under the target |
| Two-way home–school book | ✅ notes from home with how the day went, notes and "good news" from staff (the family gets a notification with a link), read receipts both ways, and "Ask for a review meeting"; the SEN register shows new notes, meeting requests and whether each plan is agreed |
| The child's own plan | ✅ students see "My support plan" in plain words ("I can do this", "Things that help me in class"), say how each target is going and tell their teachers what helps. What the child writes reaches school staff only, never the family, so a child can raise something about home safely |
| Handshake into live lessons | ✅ the SENCO's extra time (rounded to 25, 50 or 100%), read-aloud (also set by a "reader" exam arrangement), easy-to-read font (also set by "enlarged print") and calm mode (no rankings) reach SwiftCipher live lessons and games automatically, and are removed when the profile is closed |
| Who sees what | ✅ enforced in the database: families only for their own child and only while shared; teachers only when the profile is shared with teachers; other schools see nothing (database tests cover each rule) |

## 14i-1. Staff time: shifts, lateness requests, phone clock-in and payroll (phase 14i-1, done)

| Feature | Status |
|---|---|
| Shifts | ✅ HR → Time & shifts: shift patterns with start and end, days, minutes of grace before "late", minutes before the end that count as "left early", campus, and whether the shift runs on school holidays; overnight shifts (security, boarding) run past midnight. One click gives everyone without a shift the standard school day |
| Clash checks | ✅ nobody can be given two shifts whose hours overlap on the same weekday (checked in the database, with the clashing shift named); shifts can start and end on dates |
| Late, early and absent per shift | ✅ the gate, clocking machines and phone sign-ins judge each person against their own shift (first sign-in of the shift only); the daily staff register shows the shift, campus, minutes late, early departures, "not in yet" and holidays, and counts by campus |
| "I'll be late", "Leaving early", "I forgot to clock in" | ✅ staff tell their line manager (or HR, if they have none) from HR → Time & shifts or the sign-in page; the manager approves or declines with a reply; nobody decides their own request; an approved missed clock adds the sign-in record; approved lates and early departures never count against the person |
| Phone clock-in with no machine | ✅ a screen at the entrance shows a code that changes every 30 seconds (Sign in / out → Staff clock-in code, one per campus); staff scan it with their phone camera and are signed in or out at once; a photo of it stops working within about 90 seconds; schools choose: the code, the school grounds (GPS), either, or both |
| Multi-campus | ✅ campuses named in the rules; codes, shifts and sign-ins carry the campus; the staff register shows who is in at each campus |
| Payroll link | ✅ optional: a fixed amount per late arrival or per minute late after a number of free lates each month (early departures can count too), and unexcused absent days unpaid like unpaid leave; shown on the payslip as their own lines; off by default |
| Month report | ✅ everyone's month: days on shift, late (with minutes and excused), left early, absent, leave and the deduction, sortable, with CSV |

## 14i-2. Bus exceptions, exam-hall check-in and invigilator cover (phase 14i-2, done)

| Feature | Status |
|---|---|
| "Boarded but not in school" | ✅ every five minutes the system looks for children scanned onto a bus in the morning who, an hour later, are not signed in at the gate or marked present, when the school has evidence for the day (the register was taken, or the gate is in use); transport staff, the heads and the bus attendant are told at once |
| "Not dropped off" | ✅ a child scanned onto the afternoon bus and never scanned off when the trip ends (or after three hours) raises an urgent check to the same people |
| Bus checks screen | ✅ Transport → Bus checks: each open check with the child, class, route, time boarded and one-tap calls to the parents and the driver; closed with a note by a person, or by itself when the child is signed in, marked present or scanned off; history by day |
| Exam-hall check-in | ✅ Exam planner → Check-in & live board: invigilators scan the candidate's ID card (or type the admission number) at the hall door; wrong-hall candidates are sent to the right hall and seat; check-in by hand from the list; only the session's invigilators and admins can check candidates in |
| Online papers wait for check-in | ✅ an exam period can require candidates to be checked in at their hall before an online paper opens |
| Live board | ✅ per session: candidates, checked in, started and submitted online papers, per hall with a progress bar, the candidates not yet in (by seat), refreshing every 20 seconds |
| Invigilators: present, late, absent, cover | ✅ invigilators tap "I'm here"; those on leave or recorded absence show as absent, those not in the hall ten minutes before the start as late; admins find cover from staff free in that session (those signed in at the gate first), and the new invigilator is told at once; cover is recorded |

## 14j. Exam extras: paper import, the exams office and exam requests (phase 14j, done)

| Feature | Status |
|---|---|
| Import an existing paper | ✅ in an exam's Questions: "Import a paper (PDF, Word)" or paste the text; numbered questions, options on their own lines or inline (A. … B. …), "Answer: B" lines or an answer key at the end, Section B / Theory questions as essays, marks in brackets, True/False; every question is shown to check (missing answers and "see the diagram" flagged) before it is added; scanned papers have no text and must be typed |
| Spoken answers, drawing, rating scales, read-aloud | ✅ already in place (14a): spoken-answer recording, drawing and constructions, rating scale, and the read-aloud tool |
| Exam officer | ✅ a new staff role: runs the exam planner (halls, timetable, seating, invigilators), the check-in desk and live board, and decides exam requests; school admins can do the same |
| Exams office page | ✅ papers being written now (writing, finished, locked, flagged for 3+ integrity warnings), papers in the next 14 days, scripts waiting to be marked, marked papers with results not released, today's check-in progress for a running exam period with a link to the live board, SEN access arrangements, waiting requests; refreshes every 30 seconds |
| Exam requests | ✅ extra time, a late sitting (a window after the class has written it), a resit, or a special arrangement (reader, scribe, separate room…) for one candidate and one paper; asked for by staff (and, through the same rules, by a parent for their child or a student for themself); the exams office approves or declines with a reply and both sides are told |
| Requests apply themselves | ✅ approved extra time is added when the candidate starts (or straight away if they are already writing); a late sitting lets them start inside its window and run the full time; a resit keeps the first attempt word for word in an archive and lets them start again |

## 14k. Super admin centre (phase 14k, done)

| Feature | Status |
|---|---|
| Revenue | ✅ Platform → Overview: monthly recurring revenue and the annual run rate from every paying school's subscription (plan, size band, add-ons, agreed price and discount, priced exactly like its invoices), cash collected in 30 days and 12 months, overdue value, new and lost revenue in the last 30 days, revenue renewing in 60 days, trials and what they are worth, revenue by plan |
| Module adoption | ✅ for each module: how many active schools have it switched on, and how many actually used it in the last 30 days (something recorded in it); the gap shows schools paying for something they do not use |
| System health | ✅ when the scheduler last ran (it records a heartbeat every minute), messages waiting and the oldest, failed messages and webhooks in 24 hours, database size, accounts, schools by status; plain-word warnings when something needs a look |
| School activity | ✅ students, staff and the share of staff who signed in this month; the most active schools and the quietest (possible churn), with last activity |
| Support access instead of impersonation | ✅ a platform admin (admin or owner) opens one school for 15, 30 or 60 minutes, with a reason, as a separate account named "Synergy Swift support (their name)" acting as a school admin, teacher, bursar, HR manager or exam officer; a one-time link is opened in a private window; everything it does is in the school's change history under that name; the school's admins see every visit and its reason under Security & sign-in; the database stops honouring the account the moment the time is up (and the scheduler closes it and bans its sign-in); "End now" closes it early; both the platform and the school audit logs record it |

## 14l. Result PINs, branch reports and performance budgets (phase 14l, done)

| Feature | Status |
|---|---|
| Scratch-card result PINs | ✅ Exams & results → Result checker PINs: batches of up to 5,000 cards for a term (or any term), uses per PIN, price per card and expiry; serial numbers from the school's initials; PINs printed (cards with the checker address and a QR code) or downloaded as CSV when the batch is made, then kept only as hashes; look a card up by serial (uses, student, last check) and cancel lost or stolen cards; use per batch |
| Public result checker | ✅ /results/check/&lt;school&gt;: admission number and PIN, no sign-in; a PIN belongs to the first student it is used for and works its set number of times; a use is only counted when a published result is shown; guessing is slowed (20 tries per address and 10 per student in 15 minutes); opens the signed report card |
| Branch reports for proprietors | ✅ the group console now adds pass rate (term average 50+), staff on time (30 days), applications and offered places (90 days); every column ranks the branches when clicked; CSV download |
| Performance budgets | ✅ one visit in five reports real page speed (main content, response to taps, layout shift, first paint, server time); every database call slower than 0.8 s is recorded; Platform → Overview shows the 75th percentile of each against its budget, the slowest pages and the slowest database calls over 7 days; budgets can be changed; samples are kept 14 days |

## 14o. Portfolios, share links, transcripts and targets (phase 14o, done)

| Feature | Status |
|---|---|
| Students add their achievements, with photos | ✅ on the student's home page: title, kind, level, place or medal, date and a photo; a teacher sees "Added by the student" on the student record with the photo and verifies it (or marks it not verified); only verified achievements leave the school |
| Teachers' achievement portfolio | ✅ HR → My portfolio: awards, qualifications, training, certifications, publications and more, with a photo and a link; colleagues can see it |
| Share as a link to the portfolio dashboard | ✅ students, parents and teachers make a private link to the whole portfolio or one achievement, for a week, a month, three months or a year; the page shows verified achievements with photos, approved work and certificates (checkable online), the school's name and logo, and the student's first name and initial only; views are counted; links can be stopped at any time |
| Transcripts, released per child | ✅ students (My transcript) and parents (Portfolio & transcript) can read the transcript at any time, but it shows "Not released" and cannot be printed or downloaded until an admin, the bursar or the exams office releases it on the student's record (for example once fees are paid); releases and holds are in the change history |
| Targets | ✅ staff set term-average, subject-score and attendance targets per student (with progress from published results and attendance, on target or not yet), students and parents add personal goals and tick them off; class targets (class average, attendance, pass rate, other) under Classroom → Class targets, seen by the class's students and families |
| Clubs and boarding | ✅ already in place (phase 11): clubs and societies with membership and attendance, boarding houses, rooms, exeats and roll calls |

## 14m. The 20,000-user test (phase 14m, done)

| Item | Status |
|---|---|
| Database at 20,000 accounts | ✅ `scripts/load/scale-bench.mjs`: 10 schools x 2,000 accounts with a month of data, timed as each role with row-level security on |
| Fix: permission checks once per query | ✅ migration 7400: parent attendance 33 s → 38 ms, admin 30-day dashboard 26 s → 17 ms, report cards 1.4 s → 6 ms; permission suite unchanged |
| Staging kit | ✅ `seed-staging.mjs` (refuses the live project), `k6-school-day.js` (register rush, results day, CBT paper, browsing), runbook |
| Report and recommendations | ✅ `docs/LOAD_TEST_REPORT.md`: verdict, findings by severity, actions in order |
| Real-traffic run and Playwright journeys | ⏳ need a staging Supabase project and Render service |

## 14p. AI automation on Gemini (phase 14p, done)

| Item | Status |
|---|---|
| One AI door for the platform | ✅ `src/lib/ai.ts`: Gemini with JSON-schema answers checked by zod, one retry, AI Studio and Vertex keys, plain messages; Claude only when no Gemini key |
| Usage and limits | ✅ every request logged in `ai_usage` per school and person; refused without the AI module or past the monthly allowance (school limit, else `AI_MONTHLY_LIMIT`, else 3,000); `/school/ai` shows the month |
| Report comments | ✅ each student's subjects, change since last term, biggest movers, attendance, conduct ratings, effort, pronoun; tone and length; stock phrases banned; principal's differs from the teacher's; "Write for me" per card |
| Everything else moved to Gemini | ✅ lesson notes, notices, translation, homework feedback, quiz questions, study helper, live-lesson questions and slides |
| AI sales manager (super admin) | ✅ lead brief (stage, warmth, next step, talking points, risks, plan from the price list, drafted email/WhatsApp), send or open in WhatsApp, weekly summary emailed Monday, autopilot drafts for stale deals |
| AI admissions office (schools) | ✅ family brief with what is missing and a reply in the school's voice; applicant summary with a suggested decision; optional autopilot: answer enquiries after 15 min, chase quiet applications, weekly report |
| HR and SEN | ✅ job adverts from the title; SMART support-plan targets from the SEN profile |
| Scheduling | ✅ `/api/cron/ai` every 10 minutes in its own request, one run at a time |

## Scale fixes after the 20,000-user test (done)

| Finding | Status |
|---|---|
| 4: Supabase Auth called on every request | ✅ `getClaims()` in the middleware and route guards: checked locally once the project uses asymmetric JWT signing keys (Supabase → JWT Keys) |
| 5: scheduler with no lock, 19 jobs in one request | ✅ migration 7600 `cron_locks`; dispatcher, `/api/cron/slow` (billing, accounts, entrance, every 5 min) and `/api/cron/ai` each run one at a time |
| 2: 1,000-row cap | ⏳ configuration: Supabase → Data API → Max rows 50000 |
| 3: one small server | ⏳ hosting: Render Standard x2 before a large group |

Also: parents and students can now ask the exams office for extra time, a late sitting, a resit or a special arrangement (`/parent/exam-requests`, `/student/exam-requests`).

## Database updates to run

Paste **`supabase/updates/RUN_THIS_UPDATE.sql`** into the Supabase SQL editor and run it once. It holds every migration below, in order, and is safe to run again. (Regenerate it with `node scripts/bundle-update.mjs` after new migrations.)

| Migration | Phase |
|---|---|
| `20260101002400_results_guard.sql` | result-portal fixes |
| `20260101002500_question_bank.sql` | 1 |
| `20260101002600_exam_logistics.sql` | 1 |
| `20260101002700_moderation.sql` | 1 |
| `20260101002800_report_cards_plus.sql` | 1 |
| `20260101002900_admissions_crm.sql` | 2 |
| `20260101003000_review_fixes.sql` | 2 fixes |
| `20260101003100_community_crm.sql` | 3 |
| `20260101003200_core_security.sql` | 4 |
| `20260101003300_sis.sql` | 5 |
| `20260101003400_lms_teaching.sql` | 6a |
| `20260101003500_lms_content.sql` | 6b |
| `20260101003600_attendance.sql` | 7a |
| `20260101003700_timetable_calendar.sql` | 7b |
| `20260101003800_communication.sql` | 8 |
| `20260101003900_fees_plus.sql` | 9a |
| `20260101004000_accounts.sql` | 9b |
| `20260101004100_hr_people.sql` | 10a |
| `20260101004200_payroll_appraisals.sql` | 10b |
| `20260101004300_welfare.sql` | 11a |
| `20260101004400_boarding_transport.sql` | 11b |
| `20260101004500_library.sql` | 11c |
| `20260101004600_inventory_procurement.sql` | 11d |
| `20260101004700_cocurricular.sql` | 11e |
| `20260101004800_portals.sql` | 12a |
| `20260101004900_apps.sql` | 12b |
| `20260101005000_insights.sql` | 13a |
| `20260101005100_report_builder.sql` | 13b |
| `20260101005200_open_api.sql` | 13c |
| `20260101005300_lti.sql` | 13d |
| `20260101005400_classroom_sync.sql` | 13e |
| `20260101005500_compliance_docs.sql` | 13f |
| `20260101005600_esign.sql` | 13g |
| `20260101005700_question_types_tools.sql` | 14a |
| `20260101005800_saas_plans.sql` | 14b |
| `20260101005900_function_hardening.sql` | security: who may call database functions |
| `20260101006000_classroom.sql` | 14d-1 |
| `20260101006100_live_engine.sql` | 14d-2 (generated from SwiftCipher; needs `live` in Supabase → Settings → API → Exposed schemas) |
| `20260101006110_live_sync.sql` | 14d-2 |
| `20260101006120_live_seb.sql` | 14d-2 |
| `20260101006130_live_games.sql` | 14d-3 |
| `20260101006200_entrance_automation.sql` | 14e |
| `20260101006300_elections.sql` | 14f |
| `20260101006400_sales_crm.sql` | 14g-1 |
| `20260101006500_collections_fundraising.sql` | 14g-2 |
| `20260101006600_whatsapp_inbox.sql` | 14g-3 |
| `20260101006700_sen_engagement.sql` | 14h |
| `20260101006800_staff_time.sql` | 14i-1 |
| `20260101006900_bus_exam_safety.sql` | 14i-2 |
| `20260101007000_exam_office.sql` | 14j |
| `20260101007100_platform_centre.sql` | 14k |
| `20260101007200_result_pins_perf.sql` | 14l |
| `20260101007300_portfolios_transcripts.sql` | 14o |
| `20260101007400_rls_performance.sql` | 14m |
| `20260101007500_ai_automation.sql` | 14p |
| `20260101007600_cron_locks.sql` | scale fixes |
