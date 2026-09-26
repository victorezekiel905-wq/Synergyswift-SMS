# Competitive positioning

This page compares EduClass Fusion with the school systems that lead their markets. It lists what we adopted from each, the weaknesses we set out to avoid, and the selling points that follow. Research was done in September 2026 from vendor pages and public reviews (sources at the end).

## The market in one paragraph

Large districts in the US buy **PowerSchool** or **Infinite Campus**. Independent schools buy **Veracross** or **Blackbaud**, mainly for admissions, billing and fundraising on one database. UK schools and multi-academy trusts are moving to **Arbor**, which leads on a clean interface and a strong parent app. IB schools use **Toddle** or **ManageBac** for planning, portfolios and AI report comments. In India, **Fedena**, **Teachmint** and **Classter** sell long module lists (transport, hostel, inventory, CRM). In Nigeria and Kenya, **SAFSMS**, **Edves** and **Zeraki** win on result computation, fees and SMS to parents. No one product does all of this well, and most regional products lack serious exam security and data isolation.

## What we adopted

| From | What they are known for | What EduClass Fusion has |
|---|---|---|
| Arbor | Behaviour points with automatic actions; parent app with attendance, trips, payments, medical info, consultation booking, timetable and homework | Behaviour points and house points with rules that act automatically. A parent portal with fees and payment, events and consent, meeting booking, homework, timetable, attendance, behaviour, boarding and editable medical notes. |
| Arbor | One login across a multi-academy trust | School groups: an owner sees every branch's numbers in one console, while branches stay isolated from each other. |
| Veracross, Blackbaud | Admissions from enquiry to enrolment, billing, one data model | A public application form, a tracking link for families, a pipeline from review to enrolment, and enrolment that creates the student record. Fees, invoices, receipts and payments share the same student records. |
| Infinite Campus | Early-warning risk score from attendance, behaviour and grades, with interventions | A risk score for every student with the reasons shown, and an intervention log with plan, owner, review date and outcome. |
| Toddle | AI-drafted report comments from assessment data | AI drafts form-teacher and principal comments from each student's results, and the teacher edits before saving. AI also drafts weekly lesson notes. |
| Fedena, Teachmint, Classter | Transport, hostel, inventory, payroll and timetable modules | School buses with scan-on and scan-off alerts, boarding with beds and exeat, stock and assets, payroll with approval, and a clash-free timetable generator. |
| SAFSMS, Edves | Result computation, multi-branch, finance dashboards | Grading defined by each school, compiled report cards with positions, traits and attendance, and finance dashboards. |
| Zeraki | SMS fee reminders, fee balances on the parent's phone | Fee reminders by WhatsApp, email and SMS, each with a secure pay link, and the balance in the parent portal. |
| exam.net | Locked-down exam mode with teacher unlock | 12 question types, lockdown with violation limits and unlock, live monitoring, and Safe Exam Browser with cryptographic checks. |

## Weaknesses we avoid

| Common complaint | Where it is reported | How EduClass Fusion answers it |
|---|---|---|
| Steep learning curve, too many screens, gradebook and attendance in different places | PowerSchool reviews | Navigation is grouped by task (Teaching, Students, Parents, Finance, Operations, Administration). Each module is one page with tabs. |
| Year-to-year rollover is not seamless | PowerSchool reviews | Session rollover promotes every class, holds back repeaters and graduates the final year, with a check before anything moves. |
| Hard to set up, expensive training, slow support | PowerSchool reviews | Schools are created from the console in minutes. Setup follows one path: profile, session, grading, classes, students, staff. |
| Online test grades could not be retrieved | PowerSchool reviews | Exam answers autosave every 5 seconds with a device backup, and marks go into the term score sheet in one click. |
| Parents wait weeks for results; hand-filled sheets get lost or miscalculated | Nigerian school market | Scores are entered in a spreadsheet-style grid, and the report card is computed. Publishing sends each parent the result by email and WhatsApp within seconds. |
| Results sold through scratch cards | Nigerian school market | No scratch cards. Parents open the result from a private link or their portal. |
| Messages passed through students get lost | Nigerian school market | Every message goes through a tracked outbox with retries. When WhatsApp fails, the same message goes by SMS. |
| Fundraising or advancement bolted on and weak | Veracross reviews | Out of scope by design. We focus on running the school day, not donor management. |
| One vendor's data model per region; multi-branch treated as separate installs | Regional products | One cloud platform. Groups can see all their branches, and isolation is enforced by the database. |

## Our selling points

1. **Results reach parents in seconds.** Publish, and every parent gets the report card by email and WhatsApp, with SMS as a fallback. No scratch cards, no printing, no queue at the gate.
2. **The child's day is visible to the parent.** Parents get an alert when their child signs in, signs out, boards or leaves the bus, visits the sick bay, or misses class. Parents give a one-time pickup code to whoever collects their child, and the gate checks it.
3. **Fees get paid.** Every invoice has a pay link, payments go straight into the school's own account, and every payment is verified with the provider. Schools can choose to hold back report cards from families who owe fees.
4. **Exams that can be trusted.** 12 question types, lockdown, live proctoring and Safe Exam Browser support, built into the same system that holds the results.
5. **Each school's data is truly private.** Isolation is enforced by the database. It is tested with 104 automated checks, including a suspended school losing access to every module.
6. **One system for the whole school.** Results, LMS, SIMS, exams, attendance, fees, payroll, HR, library, requisitions, quality assurance, behaviour, health, transport, boarding, visitors, admissions, timetable and analytics share one login and one set of records.
7. **Each school runs things its own way.** Grading schemes, report-card traits, fee structures, SMS mode, modules and roles are set per school.
8. **AI that saves teachers time.** Draft lesson notes and report comments, reviewed by a teacher before anything is saved.
9. **Works on any phone.** Parents need no app download, since the portal opens from a WhatsApp link. Staff can install the app on their home screen.

## Honest gaps

These are areas where a competitor is still ahead. Selling around them is safer than claiming parity.

- **Native mobile apps.** Arbor and others ship store apps with push notifications. We ship an installable web app, and parents use WhatsApp links.
- **Live GPS for buses.** Fedena advertises GPS tracking. Our buses record scan-on and scan-off events only.
- **Government returns.** PowerSchool and Arbor produce state and national census returns. We have none yet.
- **Fundraising and alumni.** Veracross and Blackbaud lead here. We have no advancement module.
- **Mobile money.** Kenyan schools expect M-Pesa. We support card and bank payments through Paystack and Flutterwave, not M-Pesa directly.
- **Offline registers.** Schools with poor connectivity may want attendance that works offline. Ours needs a connection.
- **Live delivery not yet proven.** The email, WhatsApp, SMS, payment and AI integrations are built and unit-tested against the providers' documented formats, but they have not been run against live accounts.

## Sources

- Rediker, [Top 10 Best School Management Software Systems in 2026](https://www.rediker.com/best-school-management-software)
- PeerSpot, [Best K-12 Student Information Systems 2026](https://www.peerspot.com/categories/k-12-student-information-systems-sis)
- G2, [PowerSchool SIS pros and cons](https://www.g2.com/products/powerschool-sis/reviews?qs=pros-and-cons); Capterra, [PowerSchool SIS reviews](https://www.capterra.com/p/154883/PowerSchool-Student-Information-System/reviews/?page=6)
- TrustRadius, [Veracross reviews](https://www.trustradius.com/products/veracross/reviews/all); GetApp, [Veracross vs Blackbaud](https://www.getapp.com/education-childcare-software/a/veracross/compare/blackbaud-ems/)
- Arbor, [School MIS](https://arbor-education.com/school-mis/); Plantsbrook School, [Parent guide to Arbor](https://plantsbrookschool.co.uk/your-child/parents-carers/parent-guide-to-arbor/)
- Infinite Campus, [Campus Analytics Suite](https://www.infinitecampus.com/products/campus-analytics-suite)
- Toddle, [IB MYP portfolios and reports](https://www.toddleapp.com/ib-myp/student-portfolios-progress-reports/); ManageBac, [Portfolio and report cards](https://managebac.com/ib-pyp/feature/portfolio-report-cards)
- SoftwareSuggest, [Best school management software 2026](https://www.softwaresuggest.com/school-management-software); Decentro, [Best school ERP software in India](https://decentro.tech/blog/best-school-erp-software/)
- SAFSMS, [School management system](https://safsms.com/school-management-system/1000/); Edves, [Top school management software in Nigeria](https://edves.org/top-school-management-software-2025/)
- Zeraki, [Zeraki Analytics](https://www.zeraki.app/zeraki-analytics)
