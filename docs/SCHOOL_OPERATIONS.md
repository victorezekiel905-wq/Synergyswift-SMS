# School operations platform (v45 to v47)

This release turns EduClass Fusion from a classroom-engagement tool into a full school management system. It adds a hidden platform layer for the operator, and every school runs as a fully isolated tenant.

## Who can do what

| Person | Where they work | Can |
|---|---|---|
| Platform (super) admin | `/platform` | Create schools, suspend and reactivate them, switch modules on or off, set student limits, invite school admins, see usage. Has no account inside any school. |
| School admin / principal | `/school`, `/school/setup` | Everything inside their own school: grading rules, calendar, classes, staff roles, publishing results. |
| Teacher | `/dashboard`, `/school/results`, `/exams` | Enter scores for subjects they teach, build and proctor exams, use the LMS. |
| Form teacher | `/school/results` | Compile report cards for their class and write the form teacher's comment until the cards are published. |
| Gate officer | `/school/gate`, `/school/pickup` | Run the sign-in kiosk and the pickup desk. |
| Librarian, bursar, HR manager, QA officer | their module pages | Library; requisition approval; staff records and leave; lesson observations. |
| Parent | `/parent`, or the private `/g/<token>` link | See children on site now, sign-in history, published results, library books; generate pickup codes. |
| Student | `/student`, `/exam/<id>` | Take exams, see published report cards. |

Staff can hold several duties. For example, a teacher can also be a gate officer: set **extra duties** under **HR → Staff → Roles**.

## Tenant isolation

Isolation is enforced in the database, not only in the app.

- A school's users can read only their own `tenants` row. Listing or guessing another school returns nothing.
- Every new table carries `tenant_id` and is protected by row-level security keyed on `my_tenant_id()`. That function returns nothing when the school is suspended, so suspension locks all of a school's data at once.
- Users can no longer create their own profile row, change their own role, or move to another tenant. Database triggers block these even if the API were bypassed.
- Platform admins are stored in `platform_admins`, which tenants cannot read. The platform audit log is also invisible to tenants.
- Tables that shipped earlier with row-level security switched off (`invoices`, `feature_flags`, `assignments`, and others) are now tenant-scoped. Policies that let any user read every school's audit log, announcements or leaderboards are fixed.

`npm run test:db` applies every migration to a real Postgres engine (PGlite) and checks these rules as real users. It runs 152 scenario checks, covering cross-tenant reads and writes, self-promotion, self-approval, publishing rights, suspension, deactivation, two-factor enforcement, fees, payroll, health records, messaging, wallets, cover, live bus and outbox access. The full privilege matrix is in [ACCESS_AND_ISOLATION.md](ACCESS_AND_ISOLATION.md).

## Results: from score sheet to the parent's phone

1. **Set up** (School setup → Grading). Each school defines its own components (for example CA1 20, CA2 20, Exam 60) and grade bands (A1 75–100 "Excellent" …). It also sets the pass mark, rounding, and whether positions and class averages appear. Different classes can use different schemes. A component can have any maximum and any weight. It contributes score ÷ max × weight.
2. **Enter scores** (Results → Score entry). This works like a spreadsheet: Enter moves down the column, and out-of-range scores are flagged. Teachers can only enter scores for subjects assigned to them; the database enforces this.
   **Approval (optional).** Turn it on under School setup → Departments & approval, give each department a head and put subjects in departments. Teachers then press *Submit for approval*; the head of department approves or returns the sheet with a note, and the principal gives final approval. Submitted scores are locked for teachers until they are approved or returned, nobody can approve scores they submitted, and every step is logged. Report cards compile only from approved sheets.
3. **Compile** (Results → Report cards). This computes totals, grades, subject positions with ties ranked 1-2-2-4, class average, highest and lowest, overall average and position, GPA and days present from gate sign-ins. Missing components are flagged before publishing.
   **Report layouts and extras.** Each grading scheme picks a layout: Nigerian (CA columns, positions, class averages), British (attainment, effort, target and predicted grades, a comment per subject) or American (percentages, letter grades, GPA). From the second term on, cards show each subject's term totals and the session (cumulative) average and position. Teachers add per-subject comments, effort and targets under Score entry → *Comments & targets*; predicted grades are forecast from the student's earlier results unless the teacher sets one. The comment bank offers ready comments that match each student's average.
   **Mid-term reports.** Tick the assessments that count (usually the CAs) under School setup → Grading, then switch Report cards to *Mid-term* and compile, publish and send as usual.
   **Printing.** *Print all cards* gives the whole class as one PDF; *Broadsheet* and *Master score sheet* print the class summary and every assessment score per subject. A student's *Transcript* (from their profile) lists every session's results.
4. **Publish**. Only admins can publish. Published cards are signed: the QR code on a printed card opens the school's copy and says whether the figures still match. Add the principal's signature and school stamp under School setup → Profile. Each guardian immediately gets a branded email with the full subject table, and a WhatsApp message with the average, position and a private link to a printable report card at `/r/<token>`. Cards can be withheld per student, for example for unpaid fees.

## Sign-in and sign-out

- Every student and staff member has a QR ID card (Student or Staff → ID card → Print).
- The kiosk (`/school/gate/kiosk`) accepts USB or Bluetooth QR scanners, the device camera (Chrome and Edge), or typed admission and staff numbers. "Auto" alternates in and out.
- A student's scan sends their guardians an email and WhatsApp alert within seconds. Double scans within 60 seconds are ignored.
- Late arrivals are marked from the school's start times in the school's own time zone.
- Staff can also sign themselves in from their phone. This can be limited to a radius around the school (School setup → Attendance).

## Pickup codes

1. A parent opens their portal and taps **Generate pickup code**. They can name someone else, such as a driver or relative, and add that person's WhatsApp number.
2. A single-use 6-digit code goes to the parent, and to the collector if one was named. Only a hash of the code is stored. Codes expire after the school's validity window (default 4 hours).
3. At the gate, **Pickup desk** checks the code and shows the child's photo, class and collector. The officer confirms and releases the child.
4. The child is signed out, and guardians are told who collected them. Wrong codes are rate-limited per officer.

A guardian can only generate codes for children the school has marked "may collect".

## Secure exams

- Twelve question types: single and multiple choice (with partial credit), true/false, short answer, numeric with tolerance, fill-in-the-blanks, matching, ordering, hotspot on an image, essay with word limits, code with a marking guide, and file upload.
- Answer keys never leave the server. Options, order and matching columns are shuffled per student.
- The timer is set by the server, including late starts, the exam window, extra time and reopening.
- Exam-room behaviour: required full screen; tab, window, full-screen, copy, paste, print and developer-tool events are all logged; the exam locks after N violations until a teacher unlocks it (as on exam.net). Answers autosave every 5 seconds, with an offline backup on the device. An optional calculator is available.
- **Safe Exam Browser**: download a generated `.seb` file, or use the `sebs://` launch link. With a Config Key or Browser Exam Key pasted in, the server checks SEB's request-hash headers cryptographically on every request. Without a key it falls back to detecting the SEB user agent.
- The live monitor shows progress, time left, violations and activity per student. It supports unlock, +10 minutes, force-submit, reopen and reset.
- Marking view: auto-marked questions can be overridden, manual questions get points and feedback. Results can be released to students and pushed into the term score sheet as any grading component with one click.

## Operations modules

- **Library**: catalogue, issue by scanning an ID card, returns with automatic overdue fines, and weekly WhatsApp reminders to parents.
- **Requisitions**: itemised requests with totals, approve or reject with notes, then mark fulfilled. Nobody can approve their own request.
- **HR**: staff directory, roles and extra duties, login invitations, enable or disable access, ID cards, leave requests counted in working days, and an approval workflow with no self-approval.
- **Quality assurance**: configurable observation checklists and scored lesson observations with action plans. Live indicators cover score-entry progress per class and subject, staff punctuality, overdue books, pending approvals and message delivery rate.

## v46: the rest of the school

v46 adds the modules that the leading systems sell separately, so one login runs the whole school.

### Money

- **Fees** (`/school/fees`): fee items, class-specific amounts, optional extras and discounts. Invoices are generated for a whole class or term in one step. Every invoice and receipt gets a number (`INV-2026-000001`, `RCT-2026-000001`).
- **Online payment**: each invoice has a private pay link (`/pay/…`) sent by WhatsApp, email or SMS. Paystack and Flutterwave are supported, and money settles straight into the school's own subaccount. The server confirms every payment with the provider and checks the exact amount before marking it paid. Signed webhooks catch payments made after the parent closes the page.
- **Bursary**: record cash, transfer and POS payments, see debtors by class, and send reminders in one step. A school can choose to **withhold report cards from debtors**. Their parents then see a "please clear fees" notice instead of the result.
- **Finance** (`/school/finance`): expenses by category, income against spend, stock with issue and restock history, and a fixed-asset register.
- **Payroll** (`/school/payroll`): salary profiles with allowances, deductions, pension and tax. Unpaid leave is prorated automatically. A run is prepared, then approved by someone else, then released. Staff see only their own released payslips.

### Teaching and learning

- **Class register** (`/school/attendance`): take the register by class. Parents get an absence or lateness alert. Report cards show days present, absent and opened.
- **Timetable** (`/school/timetable`): set periods and lessons per week, then generate. The generator never double-books a teacher, class or room, spreads each subject across the week, keeps locked cells and lists anything that could not fit. Teachers and students see their own timetable.
- **Homework**: set, collect and mark. Late submissions are flagged, and parents see what is due.
- **Lesson notes**: teachers write weekly notes or get a complete first draft in seconds, and the principal or QA officer approves or returns them.
- **Traits and drafted comments**: rate affective and psychomotor traits on the report card. Form-teacher and principal comments can be drafted from each student's scores, and the teacher edits them before saving.
- **Early warning** (`/school/analytics`): every student gets a risk score from attendance, average, falling grades, failed subjects, behaviour and missing homework, with the reasons listed. Staff open an intervention with a plan, owner and review date, and close it with an outcome.

### Pastoral care

- **Behaviour**: positive and negative points by category, and house points. Rules act automatically, for example "3 lateness incidents in 14 days → detention and tell the parent".
- **Health** (`/school/health`): medical profiles (allergies, conditions, medication, emergency contact) and a sick-bay log. Parents are told about each visit and can update medical notes themselves.
- **Events and consent**: trips and events with cost and consent. Parents accept or decline from their portal.
- **Parent-teacher meetings**: teachers publish slots, and parents book and cancel them.

### Logistics

- **School buses** (`/school/transport`): routes, stops and riders. The driver's phone scans each child on and off, and parents get an alert each time.
- **Boarding** (`/school/hostel`): hostels, rooms and beds, with one bed per student. Parents request an exeat, the warden approves it, and parents are told when the child leaves and returns.
- **Visitors** (`/school/visitors`): sign visitors in and out, with host, purpose and badge.

### Growth

- **Admissions** (`/school/admissions`): a CRM for every family from first enquiry to enrolment.
  - *Capture*: `/enquire/<school>` (embed it on your website with the code under Setup), `/visit/<school>` to book tours and open days, `/apply/<school>` for applications, a WhatsApp click-to-chat link, ad links with `utm_campaign` tags, a lead webhook for Facebook / Instagram lead ads (via Zapier or Make), quick add for walk-ins and calls, and each parent's referral link in the parent portal. Repeat enquiries from the same phone or email merge into one family.
  - *Pipeline*: drag families across Enquiry → Tour booked → Applied → Assessed → Offer → Accepted → Enrolled or Lost. Once a family applies, the board follows the application. Each family has an owner (new enquiries go to the least-busy admissions officer), a score, a timeline of calls, messages and visits, and tasks.
  - *Follow-ups*: sequences of emails, SMS, WhatsApp messages and staff tasks start when a family enters a stage and stop when they move on. "Add starter sequences" gives a sensible set to edit.
  - *Applications*: families upload documents and pay the application fee online from their private link. Send an online entrance test (any exam from Secure exams) to one or many applicants; scores land on the application. Record interviews, waitlist with positions, and make offers: the offer letter comes from your template, the family signs it online with a drawn signature, then pays the acceptance fee. Offers expire automatically. Enrolling creates the student and parent records.
  - *Analytics*: funnel, sources and campaigns with cost per enquiry and per enrolment (add your marketing spend under Setup), staff response times and conversion, monthly trends and why families did not go ahead.
- **Session rollover** (`/school/rollover`): promote every class to the next level, keep repeating students back, and graduate the final year. Each class shows its suggested next class to check, and nothing moves until you confirm.
- **School groups** (`/group`): an owner of several branches sees headcount, attendance, fee collection and average results per branch. Branches still cannot see each other.

- **Families & community** (`/school/community`, admins; the bursar sees Referrals and Partners):
  - *Families*: every current family with its retention risk, last NPS score, balance, open complaints and re-enrolment answer. Filter and save the filter as a segment. Click a family for the 360° view: children, other guardians, fees and one timeline of everything that has happened. Log calls and meetings there.
  - *Complaints & requests*: families raise them from the parent portal; staff log calls and walk-ins. Each gets a number and promised reply and resolve times (set them under "Response times"). Overdue tickets escalate to the principal and admins. Families follow and reply from their link and rate the outcome. Every member of staff works their own tickets at `/school/support`.
  - *Surveys & NPS*: build a survey (start from the NPS template), choose the families, send. Families answer from a private link. Anyone scoring 0–6 on a named survey gets a follow-up ticket.
  - *Campaigns*: newsletters and campaigns by email, SMS or WhatsApp to all families, a segment, classes, alumni or partners. Preview, send yourself a test, send now or schedule. Families can unsubscribe and still get essential messages.
  - *Re-enrolment & retention*: open a round to ask every family whether each child will return, with reasons for leaving. The list of families at risk combines those answers with survey scores, overdue fees, unresolved complaints, attendance and siblings who left.
  - *Referrals*: set the reward for a referral that enrols; rewards appear automatically for approval.
  - *Alumni*: add graduated students, share the sign-up link, confirm sign-ups, find mentors.
  - *Partners & vendors*: contacts, contracts with renewal alerts, ratings, a contact log and spend from expenses.

### Running the school safely (phase 4)

- **Sections & curriculum** (School setup): set the school up from a curriculum in one step: pick stages (for example Nigerian Primary and JSS, or British KS3 with IGCSE), add arms, and the sections, classes, subjects and grading schemes are created. Nothing existing is deleted.
- **Security & sign-in** (`/school/security`): password rules and expiry, two-factor rules, idle sign-out and session length, Google/Microsoft sign-in (and letting staff join with the school email, approved in HR), phone sign-in, and where staff pages may be opened (school network, approved devices, or either). New devices wait for approval in the same page. An admin can sign anyone out everywhere.
- **Consent & privacy** (`/school/consent`): the permissions families are asked for (records, emergency care, photos inside and outside school, trips, newsletters), who has answered, printable lists such as "children who may not be photographed", paper forms, and the privacy notice. Changing a permission's wording asks families again.
- **Import & export** (`/school/data`): bring in students, parents, staff, classes, subjects, who teaches what, opening balances, alumni and vendors from CSV or Excel. "Check the file" lists every problem by row before anything is saved. Every list exports to Excel or CSV in the same columns.
- **Change history** (`/school/audit`): every record added, changed or deleted, who did it and the values before and after. Kept for two years unless you change it under Security & sign-in.
- **Search**: press Ctrl K (⌘ K on a Mac) anywhere.
- **Counsellors** see behaviour, early warning and health records (read only). **Alumni** invited from the alumni directory sign in to their own alumni page and never see school data.

### Student records (phase 5)

- Each student's page has tabs: **Documents**, **SEN & support**, **Achievements & certificates** and **History & leaving**.
- **Leaving**: under History & leaving, record a transfer, withdrawal or graduation with the last day, reason and new school. The checklist shows unpaid fees, unreturned books, a boarding bed and wallet money to refund. The child's place, bed, bus seat and own sign-in are released; nothing is deleted, and they can be re-admitted.
- **Certificates** (`/school/certificates`): issue to a whole class (attendance, completion, participation) or, from a student's page, a transfer certificate, testimonial or award with the wording prepared from their record. Each certificate has a number and a QR code; scanning it shows whether it is genuine or has been revoked.
- **SEN register** (`/school/sen`): children with special educational needs, their support plans and review dates, and a printable list of exam arrangements for invigilators. Extra time is added automatically to online exams.
- Promoting students at the end of the session records each move in their history and can add graduates to the alumni list.

### Teaching and learning (phase 6)

- **Writing maths and code**: text slides, homework instructions and discussions accept `# headings`, `- lists`, `**bold**`, links, maths between `$…$` or `$$…$$` (LaTeX) and code between three backticks with the language name, e.g. ` ```python `. Use **Preview** to check before saving.
- **Homework** (`/school/homework`): each piece can take a late penalty (per day, with a cap), allow resubmission up to a number of attempts, accept files, and go to chosen **learning groups** only (set them up under the **Learning groups** tab). When marking, highlight words in the answer to comment on them, click an uploaded image to pin a comment, or record voice or video feedback. **Send back to improve** returns the work with a note so the student can try again; earlier attempts are kept. **Draft feedback** writes a first draft with a suggested mark for you to edit (needs `ANTHROPIC_API_KEY`).
- **Originality**: answers are compared with classmates' answers and the student's own earlier work in the subject. A high match, or writing that is very unlike the student's usual style, is flagged with the passages. Treat it as a reason to talk to the student, not as proof.
- **Badges & points** (tab on the homework page): students earn points for homework, practice and discussion, and keep a streak for each school day they learn something. Admins add the starter badges or their own; automatic badges are given as soon as they are earned, and teachers give the others to students they tick in the class table. Students see their progress on `/student`; parents see it under Records.
- **Discussions** (`/forums`): staff open a forum for a class (or all their classes at once), the whole school or the staff room. Students post in their own class's forum and school-wide ones only. Staff pin, lock, hide and answer reports. Students' posts pass a language filter and are limited to 10 every 10 minutes.
- **Schemes of work** (`/school/schemes`): first add the curriculum objectives for a subject and level (paste them one per line). Then create a scheme, plan each week with its topic, objectives, activities and assessment, and submit it. The head of department, QA or the principal approves it or returns it with comments. Tick weeks as taught; the coverage bar shows which objectives are planned, taught or missing. **Write lesson note** on a week starts a lesson note linked to it.

- **Learning library** (`/school/learning`):
  - **Learning paths**: make a path for one or more classes from steps: reading, a link or video, interactive content, a quiz (choose questions from the bank or draft new ones), or homework. Each step can wait until chosen earlier steps are finished. Publish it when ready; the progress grid shows every student's steps.
  - **Content library**: upload a SCORM 1.2/2004, xAPI, H5P or zipped web-page package (up to 80 MB). Choose the classes that can open it on its own, or use it in a path. **Results** shows each student's status, score and time. Packages run in a sandbox, so they cannot see the school's pages or sign-in. H5P activities load the H5P player from the internet.
  - **Online lessons**: schedule a lesson with a Google Meet, Teams or Zoom link, or let the app create the Zoom meeting when Zoom is connected (admins connect the school's own Zoom app on the same tab). Students and parents see it; students can join from 15 minutes before, and **Who joined** lists them.
  - **Study helper**: admins switch it on and set questions per student per day (it needs `ANTHROPIC_API_KEY`). Students ask about their work and get hints and explanations, not homework answers. Chats are readable by the student's teachers, parents, counsellors and admins. If a student writes something that suggests they are unsafe or very upset, counsellors, the principal, admins and the form teacher get an alert straight away; open the conversation and **Mark as followed up**.
- **Question bank → Draft questions on a topic**: choose the subject, level, topic, question types and, optionally, curriculum objectives or lesson notes. Check and edit the drafts, then add the ones you want to the bank.
- **Breakout rooms**: in the live audio/video room the teacher opens breakout rooms (number and minutes), moves students between rooms, visits any room, sends a message to every room, and closes them to bring everyone back. Only the session's class can join its room.
- **Students** (`/student/learn`, "My learning"): learning paths, interactive lessons (with **Keep for offline use**), online classes with a **Join now** button, and the study helper. **Save data (lite mode)** makes live classes audio-only and turns off animations on that device. Homework has a **Stuck? Ask the study helper** link.

### Attendance (phase 7)

- **Attendance** (`/school/attendance`) has tabs for the **Morning register**, **Lesson registers**, the **Attendance report**, **Absence requests**, **Analytics**, **Staff** (admins, HR and QA) and **Machines & cards** (admins, IT and gate officers).
- **Lesson registers**: each teacher sees the day's lessons from the timetable, including any they cover. The register starts from the morning register and agreed absences; tap the exceptions and save. If a child was in school that morning but is marked absent in a lesson, their parents are told straight away (switch this off in Attendance settings).
- **Absence requests**: parents use **Tell the school about an absence** on the Learning tab of their portal (or their WhatsApp link). The form teacher (or an admin) agrees or declines with a note. Agreed school days are marked as excused and the parent is told.
- **Machines & cards**: link RFID card numbers to students and staff (a USB card reader at the gate kiosk types the number), and register fingerprint or face-recognition machines. For ZKTeco machines, set the machine's **Cloud Server** to this site's address (HTTPS) and register its serial number; enrol each person's fingerprint or face on the machine under the user number you link here. Other systems post check-ins to `/api/attendance/device` with the key shown when you add them. **Attendance settings** sets the late times for students and staff, the school days, and the persistent-absence threshold.
- **Staff**: the day's sheet of who clocked in, when, for how long, who was late, on leave or absent, with a CSV download.
- **Analytics**: the attendance rate and trend, classes, days of the week, students below the threshold, frequent lateness, lessons missed while in school, and registers not yet taken today.

### Timetable, rooms and calendar (phase 7)

- **Timetable** (`/school/timetable`): under **Rooms**, add classrooms, laboratories, ICT suites and halls, and give each class a home room. Under **Weekly load & generate**, set each subject's periods a week, how many are double periods, and whether it needs a lab or the ICT suite. Teachers mark periods they cannot teach under **My availability** (admins can do it for anyone under **Teacher availability**). **Generate** places every lesson without teacher, class or room clashes and lists anything that does not fit, with the reason.
- **Rooms & booking** (`/school/rooms`): see every room's day, including timetabled lessons, and book a room for a time (optionally every week for up to 12 weeks). A room cannot be double-booked or booked over a timetabled lesson. Rooms marked **Bookings need approval** wait for an admin, who approves or declines at the top of the page.
- **Calendar** (`/calendar`, for staff, students and parents): term dates, holidays (add them as "Holiday or closure" events), events, PTA meetings, exams, meetings, online lessons, cover, room bookings, homework deadlines and weekly lessons. **Get my calendar link** adds it to Google Calendar, Outlook or a phone; it updates itself. Making a new link stops the old one.

### Communication (phase 8)

- **Announcements** (`/school/notices`, admins): write an announcement or a circular, choose who gets it (the whole school, sections, classes, or chosen students, families and staff; parents, students, staff), the channels, whether people must confirm they have read it, and optionally a time to send. Placeholders such as `{parent_name}` and `{child_names}` are filled in for each family, and families get it in their home language. **Details** shows who has read and confirmed it; **Remind** sends it again to the rest. Save wording you reuse under **Templates**.
- **Emergency alert** (red button on the same page): pick the ready-made wording, fill in the [brackets], choose who, and type SEND. It goes out on the app, SMS, WhatsApp and email at once, and stays as a red bar on people's screens until they tap **I received this**. Watch confirmations under Sent.
- Everyone sees their **Notices** on the dashboard, `/student` and the parent portal (a Notices tab; the link in a WhatsApp or SMS opens the notice and records that it was read).
- **Messages with students** (`/school/student-messages`, and **Messages with teachers** for students): switched off until an admin turns it on under **Messaging safety**. Staff write only to students they teach, on school days within the hours set there; students write only to their own teachers; nothing can be edited or deleted; parents can read their child's conversations unless the school turns that off.
- **Messaging safety** (`/school/messaging-safety`, admins, principal, counsellors): messages in parent or student conversations that mention phone numbers, email addresses, private apps, meeting up, secrets, appearance or signs of risk are listed here and the leads are alerted at once. Read them, follow up, and **Mark reviewed**.
- **Parent–teacher evenings** (`/school/conferences`): admins set the date, times, appointment length and classes. Every teacher of those classes gets appointments and families are invited; parents book with each teacher under Meetings in their portal and cannot book two at the same time. Close booking before the evening, print each teacher's schedule, or cancel (families who booked are told).

### Fees (phase 9)

- **Fee setup**: each amount can apply to all classes or one class, and to every student or one **fee category** (for example `boarding`, `day`, `staff_child`); the most specific amount wins. Mark extras such as bus, lunch or clubs as optional, then give them to students under **Categories & extras** (that is also where students are put in a category).
- **Discounts & scholarships**: discount rules (siblings from the second or later child, children of staff, a category) apply automatically when invoices are made; a child gets the best single rule. Scholarships, bursaries and waivers are entered for a student by percentage or amount on chosen fees and count only once someone else approves them.
- **Instalments & reminders**: make plans (such as 50% now and 50% in 30 days) and pick one when generating invoices, or change a single invoice's plan from its details. Set a late fee and grace period, and switch on automatic reminders (a few days before the due date, then every few days while unpaid). The daily job does both.
- **Transfers to confirm**: parents who paid by transfer report it on their pay page with the bank reference (and a screenshot if they like). Check the bank statement, then **Confirm** (receipt sent) or **Reject** (the parent is told).
- **Debtors & statements**: outstanding balances by age, the debtors list (CSV), and a printable statement of account for any student. Parents see their own statement under Fees in their portal.
- **Online payments**: besides Paystack or Flutterwave (cards, bank, USSD, transfer), admins can add the school's **Remita** keys (parents get an RRR they can also pay at a bank) and **Stripe** keys (cards from abroad). Point Remita's notifications to `/api/pay/webhook/remita` and a Stripe webhook (event `checkout.session.completed`) to `/api/pay/webhook/stripe`.

### Accounts (phase 9)

Under **Finance**:

- **Petty cash**: open a float, name its custodian and set its imprest (the amount it is topped back up to), then top it up. The custodian sees the float under Finance → Petty cash, records each spend with a photo of the receipt, and counts the cash now and then. Each spend is an expense paid from the float. The bursary tops it back up, returns cash to the bank, and can book any shortage or surplus found at a count.
- **Budgets**: set what you expect to bill (by fee item) and spend (by expense category, with Salaries for payroll) over a period. The principal or another admin approves it. The budget page then shows actual against budget, how much of each line is used, and spending that was never budgeted. Reopen an approved budget to change it.
- **Ledger**: the general ledger builds itself from fees billed and received, expenses, petty cash, approved payroll and the wallet. Before your first report, post **Opening balances** under Journals (bank, cash and anything owed on the start date). Then use Statements for income and expenditure, the balance sheet, the trial balance and any account's ledger. Under **Chart of accounts**, add accounts and choose where each fee item, expense category and payment method is posted. If salaries go through payroll, do not also enter them as expenses.
- **Export to accounting**: download journals for QuickBooks Online, Sage 50 or Zoho Books (one journal per day and source, or every transaction), and the chart of accounts so the package can be set up with the same accounts. Once a period is exported, the principal or an admin closes the books up to its last day. Expenses, petty cash and journals dated on or before that day are then locked.
- **Reports**: collections by day, method and class; billed, paid and outstanding by class and fee item for a term. Every report has a CSV.

### People (phase 10)

Under **HR**:

- **Overview** (HR and admins): contracts, probation and licences ending in the next 45 days, records with missing details, onboarding and offboarding progress, who is away today, leave waiting and candidates in progress.
- **My HR** (everyone): your own details (NIN, tax ID, pension PFA and RSA PIN, NHF number, next of kin), documents, contracts to accept, qualifications to add (HR verifies them) and leave balances. Only you and HR see your personal details.
- **Staff directory**: set each person's **line manager** and **probation end** on their record, then open **Record** to add contracts, documents (tick "keep from the staff member" for references), and to confirm or extend probation, start onboarding or offboarding, or record that they have left (their contract ends and an admin can disable their login).
- **Leave**: set the rules per type under **Leave policies** (days a year, paid or not, carry-over, notice, whether a document is needed). Staff see their balances and ask for leave, including half days; weekends and school holidays on the calendar are not counted. The line manager recommends it, then HR decides; everyone is told. Approved leave appears in **Cover** for teachers.
- **Recruitment**: add a job and **Publish** it. It appears on the school's careers page at `/careers/<school web address>` (share the link or put it on the school website); tick "current staff only" for internal posts. Candidates apply with a CV and get a link to follow their application. Move them through shortlisted, interview and offer, with an email each time if you like. **Schedule interview** books a time, emails the candidate and tells the panel; each panel member scores on their own. **Hire** makes the staff record, copies the CV and starts onboarding.
- **Appraisals & CPD**: HR creates a cycle with its areas and weights, then adds staff (each person's line manager reviews them unless you pick someone). Staff score themselves and send the self-review; the reviewer scores, writes strengths, areas to develop and a recommendation, sets goals, and **shares** it; the person reads it, adds a comment and acknowledges. Lesson observations and CPD from the period sit alongside as evidence. Teachers answer their lesson observations under **My lesson observations**. Everyone logs CPD; HR verifies it, records whole-staff training at once, and sets the hours expected each year.
- **Onboarding**: checklists start from templates (starter ones are included; edit them under **Templates**). Each task belongs to HR, an admin, IT, the bursary, the line manager or the new person, and only they can tick it.

### Pastoral care (phase 11)

- **Pastoral care** (`/school/pastoral`), for every member of staff:
  - **Report a concern** whenever a child may be at risk: write what you saw or were told, in the child's words if you can. The safeguarding team (counsellors, the principal and admins) is alerted at once. If nobody acknowledges it in time, it goes to the principal and admins (after one hour for critical concerns; the time for others is under Settings). The team acknowledges, assigns, adds notes, records calls with parents and referrals to outside agencies, and closes with an outcome. Nothing in the chronology can be edited, and every opening of a concern is logged. The reporter sees only that it is being handled.
  - **Refer a student** to counselling. Counsellors take referrals on (which opens a case) or decline them, and keep confidential session notes. Notes can be corrected only on the day. A counsellor can share a case with the safeguarding team; otherwise only counsellors see it.
  - **Wellbeing**: switch on student check-ins under Settings. Students then see "How are you today?" on their home page. Check-ins with a very low mood, feeling unsafe, or "I'd like to talk" go to the form teacher and counsellors straight away; mark them followed up once you have spoken. The class and school mood and its trend are shown too.
- **Behaviour** adds **Incidents** (who was involved and how, with points for those responsible) and **Detentions** (sessions with a room, supervisor and places; parents are told the date and time; mark served or missed).
- **Health** adds the day's **medication round** (plans with times or "when needed", parental consent, and a dose log that cannot be changed), **immunisations** with what is due, allergy severity, EpiPen and emergency care plans, and vitals and follow-up dates on sick-bay visits.

### Payroll (phase 10)

- **Tax & pension** (payroll staff): the starting rates follow the Nigeria Tax Act 2025 (PAYE bands from 0% on the first ₦800,000 a year to 25% above ₦50m; pension, NHF and NHIS deducted first; rent relief of 20% of rent up to ₦500,000) and the Pension Reform Act (8% staff, 10% school on basic + housing + transport), plus NSITF 1%. **Check every rate with your tax adviser before the first run**; they are all editable, including the bands, and a flat percentage per person is still available.
- **Salaries**: put people on a **pay grade** (or enter their pay), tick NHF, NHIS or "not in the pension scheme", and enter annual rent for rent relief. Allowances are marked as counting for pension (housing and transport do by default) and as taxable. The list shows anyone missing a TIN, RSA PIN or NHF number; those come from their HR record.
- **Loans & advances**: the bursary enters them, the principal or another admin approves, and the monthly amount comes off pay (never below zero). Balances go down when the payroll is marked paid.
- **Each month**: prepare, check, and have someone else approve; staff are told their payslip is ready. Download the bank schedule and the PAYE, pension (grouped by PFA), NHF and employer-cost schedules for remittance. People who joined or left during the month get part of the month; unpaid leave comes off automatically.

### Parents and students

- The parent portal adds tabs for **Fees**, **Events**, **Meetings**, **Learning** (homework, timetable, behaviour, attendance), **Boarding** and **Help & feedback** (raise and follow complaints and requests). It also asks about re-enrolment, shows waiting surveys, and lists the permissions the school asks for (**Permissions and privacy**). **Records** shows each child's achievements, certificates, approved work, shared documents and support plan, which parents can agree to.
- Students add their own work to **My portfolio**; a teacher approves it before families see it. It works both after sign-in and through the private WhatsApp link.
- Students see their homework and timetable on `/student`.
- The app can be installed on a phone's home screen. It shows an offline page when there is no connection, and it never caches school data.

## v47: trust and family engagement

v47 adds what the market leaders sell as separate products (ParentSquare, ParentPay, Edulog, Arbor cover), and closes the security gap behind the largest school-data breaches.

### Security

- **Two-factor sign-in** (`/account/security`) with any authenticator app. Always required for super admins. Each school can require it for admins or for all staff under **School setup → Profile**. The database enforces it, so no page or API can skip it.
- **Student data export**: the **Export data** button on a student's record downloads everything the school holds about that child as one file, for access requests under the GDPR and Nigeria's NDPA. Every export is logged.
- **Status endpoint**: `GET /api/status` for uptime monitors. It returns `{ ok }`, or queue depth and provider status with `Authorization: Bearer $CRON_SECRET`.

### Talking with families

- **Parent messages** (`/school/inbox`): private two-way conversations. Teachers message families of students they teach; parents write to their child's teachers or the school office from their portal. Admins can review every thread for safeguarding, and nothing can be edited or deleted.
- **Translation**: each parent can choose a home language. Broadcasts and messages reach them translated, and their replies reach staff in the school's language, with the original one tap away.
- **Notice drafting**: on **Messages**, describe the notice under **Write it for me** and a draft appears, with [placeholders] rather than invented details.
- **App notifications**: free push notifications on phones and computers, for parents and staff. Parents turn them on in their portal; staff under **Account security**.

### Cashless wallet

- **Tuck shop & wallets** (`/school/shop`): parents top up online (Paystack or Flutterwave, paid into the school's account) or at the bursary. The cashier scans the ID card, taps items, and charges. The till shows the child's photo, balance and **food allergies**, and refuses a sale beyond the balance, the parent's daily limit, or a frozen card.
- Parents see every purchase, set a daily limit and a low-balance alert, and freeze a lost card from their portal. The new **cashier** role can use the till and nothing else.

### Staff cover

- **Cover** (`/school/cover`): record who is away (approved leave appears automatically), see every lesson that needs cover, and pick from the free staff suggested for each one. Teachers come first, then whoever has covered least this week. The database refuses anyone teaching then, absent, or already covering that period. The cover teacher is told at once and sees their duties on the same page.

### Live school bus

- On **School buses**, the attendant taps **Start morning trip** or **Start afternoon trip** on their phone. The phone shares its location until **End trip**, and parents of children on that bus see it on a map in their portal.
- Save each stop's location once (tap **📍 here** while standing at the stop in the route editor). Parents then get one alert per stop when the bus is about five minutes away.

### Offline register

- The class register keeps working when the connection drops. A register saved offline is kept on the device and sent automatically when the connection returns. The page and the class list also open without a connection once they have been used online. Signing out warns before deleting anything not yet sent.

## Going live checklist

1. Apply all migrations in `supabase/migrations` in order (Supabase SQL editor or `psql`).
2. Set the environment variables in `.env.example`. At minimum set the Supabase keys, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, one email provider and one WhatsApp provider.
3. Register the WhatsApp templates in [MESSAGING.md](MESSAGING.md) and set their names. Set an SMS provider for parents without WhatsApp.
   - For online fees, set `PAYSTACK_SECRET_KEY`, or `FLW_SECRET_KEY` and `FLW_SECRET_HASH`, and point the provider's webhook at `/api/pay/webhook/<provider>`. Each school then enters its own subaccount code under **Fees → Online payments**.
   - For drafted lesson notes, report comments and notices, for translation, for homework feedback and quiz drafts, and for the students' study helper, set the service key `ANTHROPIC_API_KEY`. Everything else works without it, and the drafting buttons stay hidden.
   - For Zoom lessons created by the app, set `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET` (a Server-to-Server OAuth app), or let each school connect its own Zoom app. Without Zoom, teachers paste Meet, Teams or Zoom links.
   - For app notifications, run `npx web-push generate-vapid-keys` and set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`.
   - Point an uptime monitor at `/api/status`.
   - For Google Workspace or Microsoft 365 sign-in, enable the Google and/or Azure providers in Supabase Auth (redirect URL `<app>/auth/callback`) and set `NEXT_PUBLIC_SSO_PROVIDERS=google,azure`.
   - Phone sign-in turns on by itself once an SMS provider is set.
4. Schedule `/api/cron/dispatch` every minute and `/api/cron/daily` once a day.
5. Create yourself as platform admin: `node --env-file=.env.local scripts/make-platform-admin.mjs you@company.com`. At first sign-in you set up two-factor sign-in, which super admins must use.
6. Sign in, open `/platform`, and create the first school. Its admin receives an invitation branded with the school's name.
7. The school admin sets up the profile, a session and terms, grading, classes and subjects. They then import students (CSV) and add staff, and send parents their portal links.
