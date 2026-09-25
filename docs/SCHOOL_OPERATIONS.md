# School operations platform (v45)

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

`npm run test:db` applies every migration to a real Postgres engine (PGlite) and checks these rules as real users. It runs 42 scenario checks, covering cross-tenant reads and writes, self-promotion, self-approval, publishing rights, suspension and outbox access.

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

## Going live checklist

1. Apply all migrations in `supabase/migrations` in order (Supabase SQL editor or `psql`).
2. Set the environment variables in `.env.example`. At minimum set the Supabase keys, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, one email provider and one WhatsApp provider.
3. Register the WhatsApp templates in [MESSAGING.md](MESSAGING.md) and set their names.
4. Schedule `/api/cron/dispatch` every minute and `/api/cron/daily` once a day.
5. Create yourself as platform admin: `node --env-file=.env.local scripts/make-platform-admin.mjs you@company.com`.
6. Sign in, open `/platform`, and create the first school. Its admin receives an invitation branded with the school's name.
7. The school admin sets up the profile, a session and terms, grading, classes and subjects. They then import students (CSV) and add staff, and send parents their portal links.
