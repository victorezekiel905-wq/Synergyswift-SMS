/**
 * The app's menu: eight areas in plain words, each link shown only to the
 * roles that use it and only when the school has its module. Pure, unit
 * tested (the shell renders it).
 */
export type NavLink = { href: string; label: string; roles: string[]; module?: string; hint?: string };
export type NavGroup = { id: string; title: string; links: NavLink[] };

const STAFF = ["teacher", "school_admin", "it_admin", "platform_admin", "principal", "bursar", "librarian", "hr_manager", "qa_officer", "gate_officer",
  "transport_officer", "hostel_warden", "nurse", "admissions_officer", "cashier", "counsellor", "exam_officer"];
const ADMIN = ["school_admin", "principal", "platform_admin"];
const TEACH = ["teacher", "school_admin", "principal"];
const FINANCE = ["bursar", ...ADMIN];
const ACADEMIC = STAFF.filter(r => !["gate_officer", "librarian", "bursar", "transport_officer", "nurse", "admissions_officer", "hostel_warden", "cashier", "counsellor"].includes(r));
const PASTORAL = [...TEACH, "counsellor"];
const NOT_TILL = STAFF.filter(r => r !== "cashier");

export const NAV: NavGroup[] = [
  { id: "home", title: "Home", links: [
    { href: "/dashboard", label: "Dashboard", roles: [...STAFF, "student"] },
    { href: "/school", label: "School at a glance", roles: NOT_TILL },
    { href: "/student", label: "My school", roles: ["student"] },
    { href: "/student/support", label: "My support plan", roles: ["student"], module: "sims" },
    { href: "/parent", label: "My children", roles: ["parent"] },
    { href: "/parent/support", label: "Support plans (SEN)", roles: ["parent"], module: "sims" },
    { href: "/student/learn", label: "My learning", roles: ["student"], module: "lms" },
    { href: "/live/student", label: "Live lessons & games", roles: ["student"], module: "live" },
    { href: "/live/student/join", label: "Join with a code", roles: ["student"], module: "live" },
    { href: "/live/student/characters", label: "My characters", roles: ["student"], module: "live" },
    { href: "/student/practice", label: "Past-question practice", roles: ["student"], module: "exams" },
    { href: "/student/messages", label: "Messages with teachers", roles: ["student"] },
    { href: "/vote", label: "Vote", roles: ["student", "parent"], module: "elections" },
    { href: "/school/library", label: "Library & e-books", roles: ["student"], module: "library" },
    { href: "/calendar", label: "Calendar", roles: [...STAFF, "student", "parent"] }
  ] },
  { id: "teaching", title: "Teaching", links: [
    { href: "/teacher", label: "My teaching day", roles: TEACH },
    { href: "/school/attendance", label: "Class register", roles: TEACH, module: "attendance" },
    { href: "/school/classroom", label: "Classroom points & story", roles: [...TEACH, "counsellor"], module: "classroom" },
    { href: "/school/homework", label: "Homework", roles: TEACH, module: "homework" },
    { href: "/school/lesson-notes", label: "Lesson notes", roles: [...TEACH, "qa_officer"], module: "lesson_notes" },
    { href: "/school/schemes", label: "Schemes of work", roles: [...TEACH, "qa_officer"], module: "lesson_notes" },
    { href: "/live/teacher", label: "Live lessons", roles: TEACH, module: "live" },
    { href: "/live/teacher/lessons", label: "Lesson slides & activities", roles: TEACH, module: "live" },
    { href: "/live/teacher/challenge", label: "Quiz games", roles: TEACH, module: "live" },
    { href: "/live/teacher/questions", label: "Lesson questions", roles: TEACH, module: "live" },
    { href: "/live/teacher/media", label: "Pictures & videos", roles: TEACH, module: "live" },
    { href: "/live/teacher/reports", label: "Live lesson reports", roles: TEACH, module: "live" },
    { href: "/school/learning", label: "Learning library", roles: [...TEACH, "counsellor"], module: "lms" },
    { href: "/forums", label: "Discussions", roles: [...STAFF, "student"], module: "lms" },
    { href: "/school/timetable", label: "Timetable", roles: STAFF, module: "timetable" },
    { href: "/school/cover", label: "Cover for absent staff", roles: TEACH, module: "cover" },
    { href: "/school/rooms", label: "Rooms & booking", roles: NOT_TILL },
    { href: "/school/tools", label: "Outside learning apps", roles: [...TEACH, "it_admin"], module: "lms", hint: "LTI tools" },
    { href: "/school/classroom-sync", label: "Google Classroom & Teams", roles: TEACH },
    { href: "/teacher/guard", label: "Classroom device control", roles: [...TEACH, "it_admin"], module: "lms" }
  ] },
  { id: "exams", title: "Exams & results", links: [
    { href: "/school/results", label: "Results & report cards", roles: ACADEMIC, module: "results" },
    { href: "/school/exams-office", label: "Exams office", roles: ["exam_officer", ...ADMIN], module: "exams", hint: "Live papers, marking, requests, arrangements" },
    { href: "/exams", label: "Secure exams (CBT)", roles: [...TEACH, "exam_officer"], module: "exams" },
    { href: "/exams/bank", label: "Question bank", roles: [...TEACH, "exam_officer"], module: "exams" },
    { href: "/school/exam-planner", label: "Exam timetable & halls", roles: [...TEACH, "exam_officer"], module: "exams" },
    { href: "/school/insights", label: "Results analysis & returns", roles: [...TEACH, "qa_officer", "bursar", "admissions_officer"], module: "analytics" },
    { href: "/school/reports", label: "Report builder", roles: STAFF.filter(r => !["gate_officer", "cashier", "transport_officer", "nurse", "hostel_warden"].includes(r)) }
  ] },
  { id: "students", title: "Students & welfare", links: [
    { href: "/school/students", label: "Students & parents", roles: STAFF, module: "sims" },
    { href: "/school/analytics", label: "Students who need help", roles: [...PASTORAL, "qa_officer"], module: "analytics", hint: "early warning" },
    { href: "/school/sen", label: "Special needs (SEN)", roles: PASTORAL, module: "sims" },
    { href: "/school/pastoral", label: "Pastoral care", roles: NOT_TILL, module: "behaviour" },
    { href: "/school/behaviour", label: "Behaviour & houses", roles: [...PASTORAL, "hostel_warden"], module: "behaviour" },
    { href: "/school/activities", label: "Clubs, competitions & trips", roles: NOT_TILL, module: "events" },
    { href: "/school/elections", label: "Elections & voting", roles: TEACH, module: "elections" },
    { href: "/school/health", label: "Health & sick bay", roles: ["nurse", "hostel_warden", ...PASTORAL], module: "health" },
    { href: "/school/certificates", label: "Certificates", roles: ADMIN, module: "sims" },
    { href: "/school/rollover", label: "Promote students", roles: ADMIN, module: "sims" }
  ] },
  { id: "safety", title: "Safety & gate", links: [
    { href: "/school/gate", label: "Sign in / out", roles: STAFF, module: "gate" },
    { href: "/school/pickup", label: "Pickup desk", roles: ["gate_officer", ...ADMIN], module: "pickup" },
    { href: "/school/transport", label: "School buses", roles: ["transport_officer", ...TEACH], module: "transport" },
    { href: "/school/hostel", label: "Boarding & exeat", roles: ["hostel_warden", ...ADMIN], module: "hostel" },
    { href: "/school/visitors", label: "Visitors", roles: ["gate_officer", ...ADMIN], module: "visitors" }
  ] },
  { id: "families", title: "Messages & families", links: [
    { href: "/school/inbox", label: "Parent messages", roles: NOT_TILL, module: "inbox" },
    { href: "/school/student-messages", label: "Messages with students", roles: [...TEACH, "counsellor"] },
    { href: "/school/notices", label: "Announcements", roles: ["school_admin", "principal", "platform_admin", "it_admin"], module: "messaging" },
    { href: "/school/messages", label: "Email, SMS & WhatsApp", roles: [...ADMIN, "it_admin"], module: "messaging" },
    { href: "/school/events", label: "Events & trips", roles: STAFF, module: "events" },
    { href: "/school/meetings", label: "Parent meetings", roles: TEACH, module: "meetings" },
    { href: "/school/conferences", label: "Parent–teacher evenings", roles: NOT_TILL, module: "meetings" },
    { href: "/school/admissions", label: "Admissions", roles: ["admissions_officer", ...ADMIN], module: "admissions" },
    { href: "/school/community", label: "Families & community", roles: [...ADMIN, "bursar"], module: "community" },
    { href: "/school/support", label: "Complaints & requests", roles: NOT_TILL, module: "community" },
    { href: "/school/messaging-safety", label: "Messaging safety", roles: ["school_admin", "principal", "platform_admin", "counsellor"] }
  ] },
  { id: "money", title: "Money", links: [
    { href: "/school/fees", label: "Fees & payments", roles: FINANCE, module: "fees" },
    { href: "/school/shop", label: "Tuck shop & wallets", roles: ["cashier", ...FINANCE], module: "wallet" },
    { href: "/school/finance", label: "Accounts & stock", roles: STAFF, module: "inventory" },
    { href: "/school/requisitions", label: "Requests to buy", roles: STAFF, module: "requisitions" },
    { href: "/school/payroll", label: "Payroll & payslips", roles: STAFF, module: "payroll" }
  ] },
  { id: "office", title: "School office", links: [
    { href: "/school/hr", label: "Staff & leave", roles: STAFF, module: "hr" },
    { href: "/school/library", label: "Library", roles: STAFF, module: "library" },
    { href: "/school/qa", label: "Lesson observations & quality", roles: ["qa_officer", ...ADMIN], module: "qa" },
    { href: "/school/compliance", label: "Policies & compliance", roles: STAFF },
    { href: "/school/signatures", label: "E-signatures", roles: STAFF },
    { href: "/school/setup", label: "School setup", roles: ADMIN },
    { href: "/school/class-teams", label: "Class teams & accounts", roles: ADMIN },
    { href: "/school/roles", label: "Roles & privileges", roles: ADMIN },
    { href: "/school/subscription", label: "Subscription & modules", roles: ADMIN },
    { href: "/school/security", label: "Security & sign-in", roles: ADMIN },
    { href: "/school/consent", label: "Consent & privacy", roles: ADMIN },
    { href: "/school/data", label: "Import & export", roles: [...ADMIN, "it_admin"] },
    { href: "/school/integrations", label: "Website & connections", roles: [...ADMIN, "admissions_officer"] },
    { href: "/teacher/admin", label: "Device policies & audit", roles: [...ADMIN, "it_admin"] },
    { href: "/school/audit", label: "Change history", roles: ADMIN },
    { href: "/account/security", label: "My account & password", roles: [...STAFF, "parent", "student"] }
  ] }
];

export const PLATFORM_NAV: NavGroup[] = [{ id: "platform", title: "Synergy Swift platform", links: [
  { href: "/platform", label: "Schools", roles: [] },
  { href: "/platform/new", label: "New school", roles: [] },
  { href: "/platform/sales", label: "Sales & customers", roles: [] },
  { href: "/platform/billing", label: "Billing & requests", roles: [] },
  { href: "/platform/plans", label: "Plans & prices", roles: [] },
  { href: "/platform/team", label: "Platform team", roles: [] },
  { href: "/platform/groups", label: "School groups", roles: [] },
  { href: "/account/security", label: "My account & password", roles: [] }
] }];

/** The areas and links this person may see: their roles, and only modules the school has. */
export function visibleNav(roles: Set<string>, modules: Record<string, boolean>, nav: NavGroup[] = NAV): NavGroup[] {
  const seen = new Set<string>();
  return nav.map(g => ({
    ...g,
    links: g.links.filter(l => {
      if (!l.roles.some(r => roles.has(r)) || (l.module && modules[l.module] === false)) return false;
      if (seen.has(l.href)) return false; // a page appears once, in its first area
      seen.add(l.href);
      return true;
    })
  })).filter(g => g.links.length);
}

/** The link that best matches a path (longest prefix), so the right area opens and the right row is marked. */
export function activeHref(groups: NavGroup[], path: string): string | null {
  let best: string | null = null;
  for (const l of groups.flatMap(g => g.links)) {
    const hit = path === l.href || (l.href !== "/school" && l.href !== "/dashboard" && path.startsWith(l.href + "/"));
    if (hit && (!best || l.href.length > best.length)) best = l.href;
  }
  return best;
}

/** Up to four everyday destinations for the phone bar, by role. The fifth button opens the full menu. */
export function bottomBar(roles: Set<string>, modules: Record<string, boolean>): { href: string; label: string; icon: string }[] {
  const on = (m?: string) => !m || modules[m] !== false;
  let items: { href: string; label: string; icon: string; module?: string }[];
  if (roles.has("parent") && roles.size === 1) items = [{ href: "/parent", label: "Children", icon: "home" }, { href: "/calendar", label: "Calendar", icon: "calendar" }, { href: "/account/security", label: "Account", icon: "user" }];
  else if (roles.has("student") && roles.size === 1) items = [{ href: "/student", label: "Today", icon: "home" }, { href: "/student/learn", label: "Learn", icon: "book", module: "lms" }, { href: "/student/practice", label: "Practice", icon: "check", module: "exams" }, { href: "/student/messages", label: "Messages", icon: "chat" }];
  else if (roles.has("teacher")) items = [{ href: "/teacher", label: "Today", icon: "home" }, { href: "/school/attendance", label: "Register", icon: "check", module: "attendance" }, { href: "/school/homework", label: "Homework", icon: "book", module: "homework" }, { href: "/school/inbox", label: "Parents", icon: "chat", module: "inbox" }];
  else items = [{ href: "/dashboard", label: "Home", icon: "home" }, { href: "/school/students", label: "Students", icon: "user", module: "sims" }, { href: "/calendar", label: "Calendar", icon: "calendar" }, { href: "/school/inbox", label: "Messages", icon: "chat", module: "inbox" }];
  return items.filter(i => on(i.module)).slice(0, 4).map(({ href, label, icon }) => ({ href, label, icon }));
}
