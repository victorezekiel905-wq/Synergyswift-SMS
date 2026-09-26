# Super-admin access, roles and isolation

This guide is for the platform owner. It explains how to get into the super-admin console, what every role can and cannot do, and how the system keeps schools and privileges apart.

## 1. Getting super-admin access

The super admin (called **platform admin** in the code) sits above every school. It creates schools, suspends them, switches modules on or off, sets student limits and manages school groups. It has **no account inside any school**, so no school can see it, list it or know it exists.

You need a Supabase project with all migrations applied. See the checklist in [SCHOOL_OPERATIONS.md](SCHOOL_OPERATIONS.md).

### Option A: from the Supabase dashboard (no command line)

1. In Supabase, open **Authentication → Users → Add user**. Enter your email and a strong password, and tick **Auto confirm user**. Use an email that is not a member of any school.
2. Open **SQL editor**, paste [`supabase/bootstrap/make_platform_admin.sql`](../supabase/bootstrap/make_platform_admin.sql), change the email on the marked line, and run it.
3. Go to `https://your-domain.com/login` and sign in with that email and password. You land on **/platform**.

### Option B: from a terminal

```bash
node --env-file=.env.local scripts/make-platform-admin.mjs you@your-company.com
```

If the email has no account yet, the script creates one and prints a one-time link to set your password. It refuses emails that already belong to a school.

### What you see as super admin

| Page | What it does |
|---|---|
| `/platform` | Every school with students, staff, users and messages sent. Create a new school and invite its first admin. |
| `/platform/<school>` | Suspend or reactivate the school, switch modules on or off, set the student limit, invite more school admins, see message delivery and the platform audit log. |
| `/platform/groups` | Group branches owned by one proprietor and give that proprietor a read-only console across those branches. |

### Removing or adding super admins

Run the commented lines at the bottom of the SQL file. Every grant through the SQL file or the script is recorded in `platform_audit_logs`, which schools cannot read.

### Keep it safe

- **One person, one account.** Do not share the super-admin login. Add a second platform admin instead.
- **Separate email.** Never use your super-admin email as a member of a school.
- **Protect the service-role key.** `SUPABASE_SERVICE_ROLE_KEY` bypasses all row-level security. Keep it only in server environment variables; never put it in the browser, the extension or a repository.

## 2. The four levels of access

| Level | Who | Sees |
|---|---|---|
| Platform admin | You, the operator | Every school's usage and settings, through the console only. It does not browse a school's day-to-day records in the app. |
| Group admin | A proprietor with several branches | Side-by-side numbers (enrolment, fee collection, attendance, average scores) for their own branches only. Read-only. |
| School staff | Admins, teachers and other staff roles | Their own school only, limited further by role (table below). |
| Families | Parents and students, plus public links | Only their own child's records. |

## 3. School roles and privileges

A staff member has one **main role** and can hold **extra duties**. For example, a teacher can also be the gate officer. Only a school admin or principal can change roles, under **HR → Staff → Roles**.

✅ = can do · 👁 = can view · — = no access

| Area | School admin / principal | Teacher | Bursar | HR manager | QA officer | Gate officer | Librarian | Nurse | Hostel warden | Transport officer | Admissions officer | IT admin |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| School setup, grading, calendar | ✅ | 👁 | — | — | — | — | — | — | — | — | — | — |
| Grant or remove staff roles | ✅ | — | — | — | — | — | — | — | — | — | — | — |
| Student and parent records | ✅ | 👁 | 👁 | 👁 | 👁 | 👁 | 👁 | 👁 | 👁 | 👁 | 👁 | ✅ |
| Class register | ✅ | ✅ own classes | — | — | — | — | — | — | — | — | — | — |
| Enter scores | ✅ | ✅ subjects taught and own form class | — | — | — | — | — | — | — | — | — | — |
| Compile report cards | ✅ | ✅ form teacher | — | — | — | — | — | — | — | — | — | — |
| Approve, publish, withhold results | ✅ | — | — | — | — | — | — | — | — | — | — | — |
| Lesson notes | ✅ approve | ✅ own | — | — | ✅ approve | — | — | — | — | — | — | — |
| Homework, behaviour points | ✅ | ✅ | — | — | — | — | — | — | behaviour | — | — | — |
| Secure exams | ✅ | ✅ | — | — | — | — | — | — | — | — | — | — |
| Fees, invoices, payments, expenses | ✅ | — | ✅ | — | — | — | — | — | — | — | — | — |
| Payroll | ✅ prepare and approve | own payslip | ✅ prepare | ✅ prepare | own payslip | own payslip | own payslip | own payslip | own payslip | own payslip | own payslip | own payslip |
| Requisitions | ✅ approve | request | ✅ approve | request | request | request | request | request | request | request | request | request |
| Leave | ✅ approve | request | request | ✅ approve | request | request | request | request | request | request | request | request |
| Gate, pickup desk, visitors | ✅ | 👁 gate log | — | 👁 gate log | 👁 gate log | ✅ | — | — | — | — | — | — |
| Library issue and return | ✅ | 👁 catalogue | — | — | — | — | ✅ | — | — | — | — | — |
| Health records, sick bay | ✅ | 👁 allergies of own students | — | — | — | — | — | ✅ | sick bay ✅, records 👁 | — | — | — |
| Boarding and exeat | ✅ | — | — | — | — | — | — | — | ✅ | — | — | — |
| School buses | ✅ | 👁 | — | — | — | — | — | — | — | ✅ | — | — |
| Admissions | ✅ | — | — | — | — | — | — | — | — | — | ✅ | — |
| Messages to all parents | ✅ | — | — | — | — | — | — | — | — | — | — | ✅ |
| Quality assurance | ✅ | own observations | — | — | ✅ | — | — | — | — | — | — | — |
| Audit log | ✅ | 👁 | — | — | 👁 | — | — | — | — | — | — | ✅ |

**Parents** see only the children linked to them. For each child that covers sign-ins, published results, fees and online payment, pickup codes, event consent, meeting bookings, homework, behaviour, attendance, bus, boarding and exeat requests, and editable medical notes. A parent without a login uses a private link sent on WhatsApp. That link can be replaced at any time, and the old one then stops working.

**Students** see their own exams, published report cards, homework and timetable.

**Public links** each open exactly one thing, behind a long random token:

| Link | Opens |
|---|---|
| `/r/…` | One published report card |
| `/pay/…` | One invoice |
| `/g/…` | One guardian's portal |
| `/apply/track/…` | One application |

`/apply/<school>` exists only while that school's admissions are open.

## 4. How schools are kept apart (tenant isolation)

Isolation is enforced by the **database**, not only by the screens. A bug in a page cannot show one school's data to another.

1. **Every record carries its school.** Each table has a `tenant_id`, and row-level security on every table only returns rows where `tenant_id = my_tenant_id()`. That function returns the signed-in user's own school, and nothing at all if that school is suspended.
2. **Schools cannot see each other.** A school's users can read only their own row in `tenants`. Listing or guessing another school's ID returns nothing.
3. **The super admin is invisible.** Platform admins live in `platform_admins`, and platform actions go to `platform_audit_logs`. School users are denied at the database level on both tables.
4. **Suspension is instant and total.** When you suspend a school, `my_tenant_id()` returns nothing for its users and their own user rows are hidden, so every module stops returning data at once, including the older LMS tables. Deactivating one staff member does the same for that person only. Signing in then shows "School account suspended" or "Account deactivated". Reactivating restores access.
5. **Server actions are scoped.** A few actions run with elevated rights: sending messages, gate scans, payments, and parent-link portals. Each first checks the user's school and role, and every query filters by that school's ID.
6. **Public links are single-purpose.** Report-card, pay, portal and tracking tokens are 36 to 48 random characters. Each opens one record, and none works if the school is suspended.
7. **Multi-branch groups do not merge schools.** A group admin sees aggregate numbers for assigned branches through a separate console. Branches still cannot see each other, and a school never learns it belongs to a group.

## 5. How privileges are kept apart

Database triggers enforce these rules, so they hold even if someone calls the API directly:

| Rule | Enforced by |
|---|---|
| Nobody can create their own school profile or join a school on their own | `users` has no self-insert policy. Profiles are created only by invitation or a class join code. |
| Nobody can change their own role, deactivate themselves or move schools | `users_guard` trigger |
| A school can never grant "platform admin" | `users_guard` trigger |
| Schools cannot change their own status, modules, student limit or web slug | `tenants_guard` trigger |
| Only admins publish, approve or withhold results | `report_cards_guard` trigger |
| Teachers enter scores only for subjects they teach or their form class | `can_enter_scores()` policy |
| Nobody approves their own requisition | `requisitions_guard` trigger |
| Nobody approves their own leave | `leave_guard` trigger |
| Payroll needs a second person: prepared by HR or the bursar, approved by the principal or an admin | `payroll_guard` trigger. Paid payrolls cannot be reopened, and approved payslips cannot be edited. |
| Nobody approves their own lesson note, and approved notes are locked | `lesson_notes_guard` trigger |
| Payments are recorded only by the server | Online payments are verified with Paystack or Flutterwave, and the amount must match. Totals and receipt numbers are computed by the database. |
| Stock cannot go negative, and only finance staff move it | `inventory_move()` function |
| Students cannot see exam codes, Safe Exam Browser keys or unreleased marks | No student policy on `exams` or `exam_attempts`. Students only receive what the exam API chooses to send. |
| Students and parents cannot list other families' contact details | `users` policy: families see staff, never each other |

Important actions (role changes, results published, payments recorded or reversed, invoices voided, payroll approved, timetable generated, AI use) are written to the school's audit log. Platform actions go to the platform audit log.

## 6. How this is verified

`npm run test:db` builds a fresh Postgres database from every migration and checks these rules as real signed-in users. It checks cross-school reads and writes, self-promotion, self-approval, payroll separation, publishing rights, exam secrecy, family privacy and suspension. Run it after any database change. Every check must pass.
