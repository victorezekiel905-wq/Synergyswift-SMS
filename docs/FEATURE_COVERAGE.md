# Feature coverage

Progress against the full school-platform specification (23 sections). Updated as each phase lands on the `full-spec` branch.

**Key:** ✅ built · 🟡 partly built (what is missing is noted) · ⬜ not built yet · 🔑 code built, needs your account or keys to switch on

Phases: **1** assessment and report cards (done) · **2** admissions CRM (done) · **3** parent and community CRM (done) · **4** core platform and security (done) · **5** SIS (done) · **6** learning management (done) · **7** attendance, timetable, calendar · **8** communication · **9** finance · **10** HR and payroll · **11** welfare, boarding, transport, library, inventory, co-curricular · **12** portals and apps · **13** analytics, integrations, compliance.

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

## 9. Attendance (phase 7)

| Feature | Status |
|---|---|
| Daily and per-lesson register, by teacher app | ✅ morning register (works offline) and a register for every lesson on the teacher's timetable, including lessons they cover; starts from the morning register and agreed absences |
| QR, RFID, biometric or face-recognition check-in | ✅ QR ID cards and RFID cards at the gate kiosk (any USB card reader); fingerprint and face-recognition clocking machines through the ZKTeco push protocol (most machines sold locally) or a webhook for other systems; staff self check-in on their phone at school |
| Automatic parent alerts by SMS, WhatsApp or push for absence and lateness | ✅ absent or late on the register, gate sign-in and out, and a child who was in school but missed a lesson; WhatsApp, SMS, email and app notifications |
| Leave requests from parents, with approval | ✅ parents report an absence ahead or after (portal or WhatsApp link); the form teacher or an admin agrees or declines; agreed days are marked excused and the parent is told |
| Staff attendance and clock-in/out | ✅ daily staff sheet from the kiosk, cards, clocking machines or self check-in: first in, last out, hours, late, on leave, absent; CSV |
| Attendance analytics: chronic absence flags, trends | ✅ school and class rate, daily trend and direction, day-of-week pattern, persistent absence below the school's threshold (default 90%), frequent lateness, lessons missed while in school, registers not yet taken today |

## 10. Timetabling and calendar (phase 7)

| Feature | Status |
|---|---|
| Automatic timetable generator with constraints | 🟡 periods, weekly loads, teacher clashes, locked cells; teacher availability, rooms and double periods coming in 7b |
| Substitution/cover management | ✅ |
| School calendar: terms, holidays, events, exams, PTA meetings | 🟡 events list; one calendar coming in 7b |
| Room and facility booking | ⬜ |
| Personal calendars synced with Google and Outlook | ⬜ |

## 11–23

Sections 11 (communication), 12 (finance), 13 (HR and payroll), 14 (welfare), 15 (boarding), 16 (transport), 17 (library), 18 (inventory), 19 (co-curricular), 20 (portals and apps), 21 (analytics), 22 (integrations) and 23 (compliance) are partly built today. See `SCHOOL_OPERATIONS.md` and the README. Each one gets its own table here, with what is missing, when its phase starts.

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
