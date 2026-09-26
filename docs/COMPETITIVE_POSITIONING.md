# Competitive positioning

This page compares EduClass Fusion with the leading school systems in each market. For each one, it gives the main selling point, the problems its users or the press have reported, and what we took or avoided. It ends with our selling points and the gaps that remain.

Research was done in September 2026 from vendor pages, review sites, school help pages and news reports (sources at the end). Review-site complaints are what some users reported, not verified faults. Vendor figures are the vendor's own claims.

## The market in one paragraph

Large US districts run **PowerSchool**, **Infinite Campus** or **Skyward**. Independent schools choose **Veracross** or **Blackbaud** for admissions, billing and fundraising on one database. UK schools and academy trusts are moving to **Arbor** and **Bromcom**. Australian schools use **Compass**. IB schools plan and report in **Toddle** or **ManageBac**. Families are reached through add-on apps: **ParentSquare**, **ClassDojo** and **Seesaw** for messages, **ParentPay** for cashless payments, and **Edulog** for bus tracking. Admissions offices add **SchoolMint** or **Finalsite**. Teaching runs in **Canvas**, **Schoology** or **Google Classroom**. In India, **Fedena**, **Teachmint** and **Classter** sell long lists of modules. In the Gulf, **Orison** and **Classera** lead. In Africa, **SAFSMS** and **Edves** (Nigeria), **Zeraki** (Kenya) and **d6** (South Africa) win on results, fees and SMS. A typical school therefore pays for four to eight products that do not share data. No single product covers the whole school well.

## The leaders: what sells them, and what goes wrong

### Student information systems

| System | Known for | Reported problems | How EduClass Fusion answers |
|---|---|---|---|
| **PowerSchool** (US) | The largest K-12 SIS. Enrolment, grading, attendance, analytics; standards-based and traditional grading. | **December 2024 breach**: an attacker used one contractor's password on a support portal that did not require multi-factor authentication, and took data on about 62 million students and 9.5 million teachers. Reviewers also report a steep learning curve, gradebook and attendance in different places, hard setup, slow support and difficult year-end rollover. | Two-factor sign-in is **mandatory for super admins and enforced by the database**. Schools can require it for staff too. There is no support back door into school data: the super admin sees settings and usage, not records. Navigation is grouped by task, and year-end rollover is one checked step. |
| **Infinite Campus** (US) | Early-warning risk scores from attendance, behaviour and grades, with intervention plans. | Reviewers describe paying separately for modules, and cluttered screens. | Early-warning scores with the reasons shown and an intervention log are built in. Every module is in one product, and the platform switches modules on per school. |
| **Skyward** (US) | Long-established district SIS. | Reviewers call it slow and dated. | Built in 2026 on a modern stack, installable on phones, with an offline register. |
| **Veracross** (independent schools) | Admissions, billing and advancement on one data model, with an admissions funnel. | Reviewers say its advancement module is weaker than Blackbaud's. | Admissions with online forms and tracking, fees and wallet share one student record. Fundraising is not offered (see gaps). |
| **Blackbaud** (independent schools) | Student records combined with fundraising and donor management. | **2020 ransomware attack** affecting more than 13,000 customers. It led to a $49.5 million settlement with 49 US states and Washington DC, and a $3 million SEC penalty for misleading disclosures. | Tenant isolation, two-factor sign-in and 152 automated security checks. Every school's data is hidden from every other school by the database itself. |
| **Arbor** (UK) | Clean interface, one login across a multi-academy trust, behaviour points with automatic actions, a parent app, and cover management. | No significant problems found in this research. | Behaviour rules act automatically; school groups give owners one console across branches; cover suggests free staff for each lesson. |
| **Bromcom** (UK) | All-through MIS with a cover module for present and future absences, and room closures. | No significant problems found in this research. | Staff absence and cover, with approved leave pulled in automatically. |
| **Compass** (Australia) | Parent portal and app for news, absences, payments and permissions. | App-store reviews complain of frequent log-outs and password problems. Outage trackers list more than 96 user-reported outages in a year. | Parents need no password: a private link opens their portal. A `/api/status` endpoint lets the operator monitor uptime. |

### Family engagement and payments

| System | Known for | Reported problems | How EduClass Fusion answers |
|---|---|---|---|
| **ParentSquare** (US) | Two-way messaging translated into 100+ languages; text, email, app and voice. The vendor says it reaches 99.4% of families. | Separate product from the SIS. | Two-way messaging with translation both ways, email, WhatsApp, SMS and app push, all inside the same system as results and fees. |
| **ClassDojo** | Much-loved classroom culture and behaviour points. | A classroom-level tool; a competitor reports that several family features sit behind a per-parent subscription. | Behaviour points, houses and parent messaging are included for every family at no extra cost. |
| **Seesaw** | Student portfolios, a family app with translation into 100+ languages, AI-generated newsletters. | No significant problems found in this research. | Translation and AI-drafted notices. Portfolios are not yet offered (see gaps). |
| **ParentPay** (UK) | Cashless payments in 11,000+ UK schools: meals, trips, clubs; parents see what their child bought in the canteen. | Separate product from the SIS. | A cashless wallet with online top-up, a till that scans the ID card, every purchase visible to parents, daily limits, a lost-card freeze, and **allergies shown at the till**. |
| **d6** (South Africa) | Notices by WhatsApp, SMS, email and app from one portal; AI-drafted notices; cashless payments. | No significant problems found in this research. | The same channels, AI drafting and online payments, plus results, exams and the rest of the school in one product. |
| **Edulog** (US) | Live bus GPS, alerts when the bus enters a zone; one case study reported 75% fewer parent phone calls. | Separate product from the SIS. | Live bus location from the attendant's phone during a trip, alerts about five minutes before each stop, and a scan when each child gets on and off. |

### Admissions and learning

| System | Known for | Reported problems | How EduClass Fusion answers |
|---|---|---|---|
| **SchoolMint / Finalsite** | Online applications, fair lotteries, waitlists with sibling priority. | Separate products from the SIS. | Online applications with tracking and an enrolment pipeline. Lotteries and ranked waitlists are not yet offered (see gaps). |
| **Toddle / ManageBac** (IB) | Curriculum planning, portfolios, AI-drafted report comments. | No significant problems found in this research. | AI report comments and lesson notes, reviewed by the teacher. |
| **Canvas / Schoology** | Deep gradebooks, rubrics, outcomes; Schoology adds state standards and SCORM. | Separate from the SIS. | An LMS and secure exams share the results records. Standards alignment and SCORM are not yet offered (see gaps). |
| **Google Classroom** | Free and simple. | Reviewers describe a weak gradebook and no real rubric system. | A full per-school grading engine feeding report cards. |

### Regional ERPs

| System | Known for | Reported problems | How EduClass Fusion answers |
|---|---|---|---|
| **Fedena** (India) | 50+ modules including GPS transport and hostel. | Reviewers raise security concerns, a dated interface, fee carry-over problems and no offline sync. | 152 automated security and permission checks, a modern interface, unpaid invoices that stay open across terms until paid, and an offline register. |
| **Teachmint** (India) | Classroom tools plus fees and parent contact; rated above Fedena for support. | A reviewer reports needing a support ticket for small issues. | Schools configure grading, fees, roles, modules and languages themselves. |
| **Classter** | SIS, LMS, ERP and CRM in one; 500+ institutions. | No significant problems found in this research. | The same breadth, plus the African payment, WhatsApp and SMS rails. |
| **Orison / Classera** (Gulf) | Arabic and English; finance, HR, transport; the largest Middle East market share (Classera). | Sources disagree on Orison's Arabic support. | Parents can read messages in Arabic and 39 other languages through translation. The interface is in English (see gaps). |
| **SAFSMS / Edves** (Nigeria) | Result computation, finance, multi-branch (SAFSMS); hostel and events (Edves). | Parents wait for results; some schools sell result-checker scratch cards; messages sent home through students get lost. | Results reach every parent by email and WhatsApp within seconds of publishing, with no scratch cards, and every message is tracked. |
| **Zeraki** (Kenya) | SMS fee reminders; the vendor says 4,000+ schools use Zeraki Finance. | No significant problems found in this research. | Fee reminders with a pay link by WhatsApp, SMS, email and push. M-Pesa is not yet offered (see gaps). |

## What changed in this release (v47) because of this research

| Market lesson | What we built |
|---|---|
| PowerSchool and Blackbaud: the biggest risk is one stolen password | Two-factor sign-in, mandatory for super admins and optional per school for admins or all staff, enforced by the database |
| ParentSquare, ClassDojo, Seesaw, d6: families want two-way conversation in their own language | Private parent-staff messaging with safeguarding oversight and permanent records, translation both ways, AI-drafted notices |
| Compass: app log-outs and outages frustrate parents | Free push notifications, parents signed in by private link, and a status endpoint for uptime monitoring |
| ParentPay, d6: cashless schools | Wallet, online top-up, tuck shop till with allergy warnings, daily limits and a lost-card freeze |
| Edulog: live bus tracking cuts parent calls | Live bus location during trips and alerts about five minutes before each stop |
| Arbor, Bromcom: cover is a daily headache | Staff absence and cover, with the free staff suggested for each lesson |
| Fedena: no offline sync | The class register keeps working offline and sends itself later |
| GDPR and Nigeria's NDPA | One-click export of everything held about a student |

## Our selling points

1. **One system for the whole school.** Results, LMS, SIMS, secure exams, attendance, fees, wallet, payroll, HR, library, requisitions, quality assurance, behaviour, health, transport, boarding, visitors, admissions, timetable, cover, messaging and analytics share one login and one set of records. Schools stop paying for four to eight products that do not talk to each other.
2. **Secure by design.** Two-factor sign-in is enforced by the database, school data is isolated by the database, and 152 automated checks prove it on every release. No support back door reaches school records.
3. **Results reach parents in seconds.** Publish, and every parent gets the report card by email, WhatsApp, app notification or SMS. No scratch cards.
4. **Every family is reached, in their language.** WhatsApp, SMS, email and free push, two-way messaging, and translation into 40 languages.
5. **The child's day is visible.** Alerts when the child signs in or out, gets on or off the bus, visits the sick bay or misses class; the bus on a map; pickup by one-time code.
6. **Money is collected, and cash disappears.** Fee pay links and wallet top-ups settle straight into the school's own account after verification, and the till takes cards, not cash.
7. **Exams that can be trusted.** 12 question types, lockdown, live proctoring and Safe Exam Browser, feeding the same results records.
8. **Each school runs things its own way.** Grading schemes, report-card traits, fee structures, languages, SMS rules, two-factor rules, roles and modules are set per school.
9. **AI that saves staff time.** Lesson notes, report comments and parent notices are drafted by AI and always reviewed by a person.
10. **Works on any phone, even offline.** Parents need no app download or password. Staff can install the app, get push notifications and take the register without a connection.

## Honest gaps

These are areas where a competitor is still ahead. It is safer to sell around them than to claim parity.

- **Store apps.** We ship an installable web app with push notifications; Arbor, Compass and Edulog ship App Store and Play Store apps.
- **Government returns.** PowerSchool, Arbor and Bromcom produce state and national returns. We have none yet.
- **Fundraising and alumni.** Blackbaud and Veracross lead. We have no advancement module.
- **Mobile money.** Kenyan schools expect M-Pesa. We support cards and bank payments through Paystack and Flutterwave only.
- **Lotteries and ranked waitlists.** SchoolMint and Finalsite run admissions lotteries with sibling priority. Our admissions pipeline has no lottery.
- **Portfolios and standards.** Seesaw and Toddle offer student portfolios; Schoology aligns work to state standards and plays SCORM packages.
- **Voice calls.** ParentSquare can phone families. We do not.
- **Interface languages.** Parents' messages are translated, but the app itself is in English. Gulf schools expect a full Arabic interface.
- **Not yet proven live.** Email, WhatsApp, SMS, payment, AI and push integrations are built and unit-tested against the providers' documented formats, but have not run against live accounts.

## Sources

**Market overviews**: Rediker, [Top 10 best school management software 2026](https://www.rediker.com/best-school-management-software); PeerSpot, [Best K-12 SIS 2026](https://www.peerspot.com/categories/k-12-student-information-systems-sis); SoftwareSuggest, [Best school management software 2026](https://www.softwaresuggest.com/school-management-software); Classroom365, [UK MIS providers compared](https://www.classroom365.co.uk/services/school-mis/mis-software/).

**Breaches**: TechTarget, [PowerSchool data breach explained](https://www.techtarget.com/whatis/feature/PowerSchool-data-breach-Explaining-how-it-happened); TechCrunch, [What PowerSchool isn't saying](https://techcrunch.com/2025/03/10/what-powerschool-isnt-saying-about-its-massive-student-data-breach/); The Record, [Blackbaud $49.5 million settlement](https://therecord.media/blackbaud-settlement-data-breach-state-attorneys-general); TechCrunch, [SEC charges Blackbaud](https://techcrunch.com/2023/03/10/sec-blackbaud-charged-ransomware/).

**US SIS**: G2, [PowerSchool SIS pros and cons](https://www.g2.com/products/powerschool-sis/reviews?qs=pros-and-cons); Capterra, [PowerSchool SIS reviews](https://www.capterra.com/p/154883/PowerSchool-Student-Information-System/reviews/?page=6); Infinite Campus, [Campus Analytics Suite](https://www.infinitecampus.com/products/campus-analytics-suite); Capterra, [Infinite Campus reviews](https://www.capterra.com/p/188836/Infinite-Campus/reviews/); Capterra, [Skyward reviews](https://capterra.com/p/2185/Skyward-School-Management/reviews/).

**Independent schools**: TrustRadius, [Veracross reviews](https://www.trustradius.com/products/veracross/reviews/all); GetApp, [Veracross vs Blackbaud](https://www.getapp.com/education-childcare-software/a/veracross/compare/blackbaud-ems/).

**UK and Australia**: Arbor, [School MIS](https://arbor-education.com/school-mis/); Arbor Help Centre, [Arranging cover](https://support.arbor-education.com/hc/en-us/articles/20071894175389-Arranging-Cover-in-Arbor); Bromcom, [All-through MIS](https://bromcom.com/all-through-schoolmis); Compass, [Features](https://www.compass.education/features/); StatusGator, [Compass Education status](https://statusgator.com/services/compass-education); App Store, [Compass School Manager](https://apps.apple.com/au/app/compass-school-manager/id778415974).

**Family engagement and payments**: ParentSquare, [Classroom communications](https://www.parentsquare.com/platform/classroom-communications/); Bloomz, [ParentSquare alternatives](https://www.bloomz.com/blog/best-parentsquare-alternatives-2026/); Seesaw, [Digital portfolios](https://seesaw.com/features/digital-portfolio/); ParentPay, [Cashless payments](https://www.parentpay.com/services/cashless-payments/); d6, [Communication solutions](https://d6.co.za/school-solutions/communication_solutions/); Edulog, [GPS tracking](https://www.edulog.com/solutions/gpstracking/); EdScoop, [Bus tracking app](https://edscoop.com/bus-tracking-app-desoto-parish-louisiana-edulog/).

**Admissions and learning**: SchoolMint, [Waitlist management](https://schoolmint.com/schoolmint-enroll-feature-deep-dive-waitlist-management/); Finalsite, [Enrollment](https://www.finalsite.com/enrollment-management-system); Toddle, [Portfolios and reports](https://www.toddleapp.com/ib-myp/student-portfolios-progress-reports/); ManageBac, [Portfolio and report cards](https://managebac.com/ib-pyp/feature/portfolio-report-cards); Teachfloor, [Canvas vs Google Classroom](https://www.teachfloor.com/blog/canvas-vs-google-classroom); Software Finder, [Schoology vs Google Classroom](https://softwarefinder.com/resources/schoology-vs-google-classroom).

**Regional ERPs**: Capterra, [Fedena reviews](https://www.capterra.com/p/126199/Fedena-Pro/reviews/); Software Finder, [Teachmint review](https://softwarefinder.com/lms/teachmint/reviews); Decentro, [Best school ERP in India](https://decentro.tech/blog/best-school-erp-software/); Orison, [School ERP for the GCC](https://orisonsoftware.com/); Classera, [ERP acquisition](https://www.classera.com/en/company/news_details/classera-acquires-largest-erp-company-for-education-sector-in-the-middle-east/); SAFSMS, [School management system](https://safsms.com/school-management-system/1000/); Edves, [Top school software in Nigeria](https://edves.org/top-school-management-software-2025/); Zeraki, [Zeraki Analytics](https://www.zeraki.app/zeraki-analytics).
