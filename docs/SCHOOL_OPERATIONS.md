# School operations platform (v45 to v47)

This release turns EduClass Fusion from a classroom-engagement tool into a full school management system. It adds a hidden platform layer for the operator, and every school runs as a fully isolated tenant.

## Who can do what

| Person | Where they work | Can |
|---|---|---|
| Platform (super) admin | `/platform` | Create schools, suspend and reactivate them, switch modules on or off, set student limits, invite school admins, see usage. Has no account inside any school. |
| School admin / principal | `/school`, `/school/setup` | Everything inside their own school: grading rules, calendar, classes, staff roles, publishing results. |
| Teacher | `/dashboard`, `/school/results`, `/exams` | Enter scores for subjects they teach, write comments, build and proctor exams, use the LMS. |
| Form teacher | `/school/results` | Compile report cards for their class. |
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
3. **Compile** (Results → Report cards). This computes totals, grades, subject positions with ties ranked 1-2-2-4, class average, highest and lowest, overall average and position, GPA and days present from gate sign-ins. Missing components are flagged before publishing.
4. **Publish**. Only admins can publish. Each guardian immediately gets a branded email with the full subject table, and a WhatsApp message with the average, position and a private link to a printable report card at `/r/<token>`. Cards can be withheld per student, for example for unpaid fees.

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

- **Admissions** (`/school/admissions`): a public application form at `/apply/<school>`, open only while admissions are open. Applicants get a tracking link. Staff move each application through review, assessment, interview, offer and enrolment, and enrolling creates the student record.
- **Session rollover** (`/school/rollover`): promote every class to the next level, keep repeating students back, and graduate the final year. Each class shows its suggested next class to check, and nothing moves until you confirm.
- **School groups** (`/group`): an owner of several branches sees headcount, attendance, fee collection and average results per branch. Branches still cannot see each other.

### Parents and students

- The parent portal adds tabs for **Fees**, **Events**, **Meetings**, **Learning** (homework, timetable, behaviour, attendance) and **Boarding**. It works both after sign-in and through the private WhatsApp link.
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
   - For drafted lesson notes, report comments and notices, and for translation, set the service key `ANTHROPIC_API_KEY`. Everything else works without it, and the drafting buttons stay hidden.
   - For app notifications, run `npx web-push generate-vapid-keys` and set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`.
   - Point an uptime monitor at `/api/status`.
4. Schedule `/api/cron/dispatch` every minute and `/api/cron/daily` once a day.
5. Create yourself as platform admin: `node --env-file=.env.local scripts/make-platform-admin.mjs you@company.com`. At first sign-in you set up two-factor sign-in, which super admins must use.
6. Sign in, open `/platform`, and create the first school. Its admin receives an invitation branded with the school's name.
7. The school admin sets up the profile, a session and terms, grading, classes and subjects. They then import students (CSV) and add staff, and send parents their portal links.
