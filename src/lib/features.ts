/**
 * Everything Synergy Swift does, for the public Features page and the tour.
 * Grouped as schools think about their work, in plain words, each with what it
 * gives the school. Keep in step with the modules in lib/saas.ts.
 */
export type Feature = { title: string; text: string; benefit: string };
export type FeatureGroup = { id: string; title: string; intro: string; items: Feature[] };

export const FEATURES: FeatureGroup[] = [
  { id: "core", title: "Students and the school office", intro: "One record for every child, from enquiry to graduation.", items: [
    { title: "Student records", text: "Personal details, guardians, class, photo, documents, special needs and medical notes in one place.", benefit: "Nothing is typed twice; every office sees the same child." },
    { title: "Classes and teams", text: "Admins create classes, add students and assign teachers. Teachers and students see only their own classes.", benefit: "Privacy by design; less clutter for everyone." },
    { title: "Timetable", text: "Builds the timetable for you around rooms, teacher availability and double periods, then explains anything that would not fit.", benefit: "Days of puzzle work become minutes." },
    { title: "Events and consent", text: "Trips and events with parent consent forms, rosters and a late-back alert.", benefit: "No lost paper slips, no guessing who is on the bus." },
    { title: "Behaviour and houses", text: "Merits, incidents, detentions and house points.", benefit: "A fair, visible record that parents can follow." },
    { title: "Staff cover", text: "Finds and assigns cover when a teacher is away.", benefit: "Every class is covered before the bell." },
    { title: "Lesson observations", text: "Observation checklists, feedback and the teacher's reply.", benefit: "Better teaching, with evidence for appraisals." }
  ] },
  { id: "results", title: "Results and report cards", intro: "Your school's own way of assessing, marked and printed properly.", items: [
    { title: "Your assessment pattern", text: "Tests, CA, CAT, projects and exams with your own marks and weights; Nigerian, British and American patterns ready to start from.", benefit: "The system fits your school, not the other way round." },
    { title: "Effort, conduct and co-curricular grades", text: "Your own rating scale and areas: punctuality, neatness, sports, clubs, leadership.", benefit: "Report cards that describe the whole child." },
    { title: "Report cards and transcripts", text: "Totals, grades, positions and averages worked out for you; comments drafted for teachers; printed with your seal.", benefit: "Results day without the late nights." },
    { title: "Result PINs and scratch cards", text: "Parents open results online with a PIN, or on a basic phone by USSD.", benefit: "Secure access, and income for the school." }
  ] },
  { id: "exams", title: "Exams and entrance", intro: "Computer-based testing that holds up on the day.", items: [
    { title: "Secure CBT", text: "23 question types and 17 subject tools, locked to the Safe Exam Browser, with face checks and answers saved as students go.", benefit: "Fair exams, even on a weak connection." },
    { title: "Marking", text: "Automatic marking, with suggested marks and feedback for essays that teachers confirm.", benefit: "Hours of marking saved every week." },
    { title: "Exam office", text: "Hall check-in, invigilation, extra time and resit requests, live board of every hall.", benefit: "Calm, organised exam weeks." },
    { title: "Entrance exams", text: "Applicants sit online or at your centre; scores, interviews and offers flow from it.", benefit: "Admit the right students, faster." }
  ] },
  { id: "learning", title: "Teaching and learning", intro: "Lessons students join in, and a learning space for every class.", items: [
    { title: "Live lessons and games", text: "Present on the projector while students answer on phones, signed in or as guests with a code. Polls, drawing and five game modes.", benefit: "Every student takes part, and every answer lands in the markbook." },
    { title: "Homework", text: "Set, collect and mark online, with written and voice feedback.", benefit: "No lost exercise books; parents see what is due." },
    { title: "Class discussions", text: "A discussion board for each class where teachers and students talk, with moderation and safety checks.", benefit: "Learning continues after the bell." },
    { title: "Online learning", text: "Lessons, learning paths, SCORM and H5P content, online classes and an offline mode.", benefit: "Learning that survives a closure or a bad network." },
    { title: "Classroom points and class story", text: "Points for skills and a class photo feed parents follow, with a weekly report home.", benefit: "Families see the good things, every week." },
    { title: "Library and e-books", text: "Barcode loans, reservations and a digital library with free books to read and download.", benefit: "Reading for every child, on any device." },
    { title: "Portfolios and achievements", text: "Students collect achievements with photos and share their portfolio; teachers keep their own.", benefit: "A record of growth beyond grades." }
  ] },
  { id: "money", title: "Fees and finance", intro: "Every naira accounted for.", items: [
    { title: "Fees and online payments", text: "Invoices, instalments, discounts, Paystack, Flutterwave and Remita, with receipts at once.", benefit: "Money in sooner, with no bank slips to chase." },
    { title: "Collections", text: "Who owes, promises to pay, reminders written for each family, and the next step for each.", benefit: "Firm, polite follow-up that works." },
    { title: "Accounts and buying", text: "Budgets, petty cash, ledger, stock, assets, requisitions and purchase orders.", benefit: "Clean books and no surprise spending." },
    { title: "HR and payroll", text: "Staff files, recruitment, leave, appraisals and payroll with PAYE, pension and NHF.", benefit: "Staff paid right and on time." }
  ] },
  { id: "safety", title: "Safety and welfare", intro: "Know where every child is, with tight security and little fuss.", items: [
    { title: "Gate sign-in and sign-out", text: "Cards, fingerprints, QR codes or a phone PIN at the gate; parents are told at once.", benefit: "Fast mornings, and certainty about who is in." },
    { title: "Pickup and drop-off", text: "One-time pickup codes for named collectors, from the app or a basic phone by USSD.", benefit: "No child leaves with the wrong adult." },
    { title: "School bus", text: "Boarding and drop-off on each route, live position, and alerts if a child is missing.", benefit: "Parents stop worrying about the journey." },
    { title: "Boarding and exeat", text: "Exeat with parent approval (also by USSD), roll calls, late-return alerts and dining.", benefit: "Every boarder accounted for." },
    { title: "Health and safeguarding", text: "Sick bay, medicines, allergies, counselling and safeguarding with escalation.", benefit: "Care that is recorded and followed up." },
    { title: "Visitors", text: "Visitor sign-in and badges.", benefit: "You always know who is on site." }
  ] },
  { id: "families", title: "Families and communication", intro: "Parents see what matters, the moment it happens.", items: [
    { title: "Parent app", text: "Every child on one page: arrival, register, homework, results, fees and the bus, with Ask the school for quick answers.", benefit: "Fewer calls to the office." },
    { title: "Messages in their way", text: "WhatsApp, SMS, email or the app, in the parent's own language, with read receipts.", benefit: "Messages that are actually read." },
    { title: "Basic phones by USSD", text: "Results, fees, attendance, the bus, pickup codes and absences by dialling a code, no smartphone or data needed.", benefit: "No family is left out." },
    { title: "Admissions", text: "Enquiries, online applications with form fees, and an assistant that answers families quickly.", benefit: "More enquiries become enrolments." },
    { title: "Elections", text: "Prefect and PTA elections with secret ballots and kiosk voting.", benefit: "Trusted results, in minutes." }
  ] },
  { id: "leadership", title: "Leadership and control", intro: "The whole school at a glance, and the right people in control.", items: [
    { title: "Head's dashboard", text: "Attendance, fees and results live, a weekly summary in plain words, and a dashboard each school arranges its own way.", benefit: "Spot problems in days, not at the end of term." },
    { title: "Reports and returns", text: "A report builder, scheduled reports, government returns and the annual census.", benefit: "Inspection-ready all year." },
    { title: "Roles and security", text: "Roles and privileges per job, two-step sign-in, approved devices and a full change history.", benefit: "Children's records stay safe." },
    { title: "AI assistant", text: "Drafts for comments, lesson notes, slides, quizzes, notices and appraisals, always checked by staff.", benefit: "Hours back for teaching." },
    { title: "Groups of schools", text: "Reports across every school in a group.", benefit: "One view for the proprietor." }
  ] }
];
