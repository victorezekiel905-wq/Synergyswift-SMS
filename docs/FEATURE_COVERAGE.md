# Feature coverage

Progress against the full school-platform specification (23 sections). Updated as each phase lands on the `full-spec` branch.

**Key:** ✅ built · 🟡 partly built (what is missing is noted) · ⬜ not built yet · 🔑 code built, needs your account or keys to switch on

Phases: **1** assessment and report cards (done) · **2** admissions CRM (done) · **3** parent and community CRM (done) · **4** core platform and security (done) · **5** SIS · **6** learning management · **7** attendance, timetable, calendar · **8** communication · **9** finance · **10** HR and payroll · **11** welfare, boarding, transport, library, inventory, co-curricular · **12** portals and apps · **13** analytics, integrations, compliance.

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
| Settings: grading, report templates, timezone, currency, languages | ✅ currency chosen from a list (₦, GH₵, KSh, R, CFA, $, £, €) and used for every amount; Paystack schools are warned about currencies Paystack does not take. One currency per school; invoices in a second currency are phase 9 |
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

## 5. Student information system (phase 5)

| Feature | Status |
|---|---|
| Student profile, guardians, photo, documents | ✅ |
| Admission numbers, QR ID cards | ✅ |
| Promotion, transfers, withdrawals, graduation | 🟡 promotion and rollover; transfer and graduation records missing |
| Behaviour, merits, house points | ✅ |
| SEN records and IEPs | ⬜ |
| Portfolio, achievements, certificates | ⬜ |
| Transfer certificates and testimonials | ⬜ |

## 6. Learning management (phase 6)

| Feature | Status |
|---|---|
| Lesson studio, slides, live class, games, homework, rubrics | ✅ |
| Lesson notes with approval | ✅ |
| Schemes of work with curriculum objective mapping | ⬜ |
| Content library incl. SCORM/xAPI, H5P | 🟡 media in lessons; no SCORM/xAPI/H5P |
| Authoring with LaTeX and code blocks | ⬜ |
| Learning paths with prerequisites | ⬜ |
| Assignments: late penalties, resubmission | 🟡 |
| Inline annotation, voice/video feedback | ⬜ |
| Plagiarism and AI-content checks | ⬜ |
| Discussion forums | ⬜ |
| Zoom, Google Meet, Teams | ⬜ 🔑 (built-in video exists) |
| Whiteboard, polls, breakout rooms, hand raise | 🟡 whiteboard, polls, hand raise exist; breakout rooms missing |
| Differentiation, gamification (badges, streaks) | 🟡 leaderboards exist |
| AI assistant: lesson plans, quiz generation, feedback, tutor bot | 🟡 drafting exists 🔑 (ANTHROPIC_API_KEY) |
| Offline and low-bandwidth mode | 🟡 offline register; installable app |

## 9–23

Sections 9 (attendance), 10 (timetabling), 11 (communication), 12 (finance), 13 (HR and payroll), 14 (welfare), 15 (boarding), 16 (transport), 17 (library), 18 (inventory), 19 (co-curricular), 20 (portals and apps), 21 (analytics), 22 (integrations) and 23 (compliance) are partly built today. See `SCHOOL_OPERATIONS.md` and the README. Each one gets its own table here, with what is missing, when its phase starts.

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
