/**
 * Compliance rules: starter checklists for the inspection frameworks schools
 * in Nigeria and British-curriculum schools abroad follow, readiness scores,
 * review and expiry alerts for documents, and the single central record of
 * staff checks. Pure and unit tested.
 *
 * The checklists summarise the published frameworks in plain words so a school
 * can organise its evidence. They are not the official text: schools should
 * check them against the current documents from their state ministry / SUBEB,
 * the UK Department for Education (BSO), COBIS and Cambridge International.
 */

export type Requirement = { key: string; text: string; evidence: string; href?: string };
export type Area = { id: string; title: string; items: Requirement[] };
export type Framework = { id: string; name: string; short: string; note: string; areas: Area[] };

const R = (key: string, text: string, evidence: string, href?: string): Requirement => ({ key, text, evidence, href });

export const FRAMEWORKS: Framework[] = [
  {
    id: "moe_subeb", short: "MoE / SUBEB", name: "Ministry of Education / SUBEB minimum standards (Nigeria)",
    note: "Approval and quality-assurance visits by the state Ministry of Education, SUBEB (basic schools) or the Quality Assurance agency. Requirements differ by state; add or mark items not applicable as needed.",
    areas: [
      { id: "approval", title: "Approval and records of the school", items: [
        R("approval.certificate", "Current approval / registration certificate from the state ministry", "Certificate in the document library with its expiry or renewal date"),
        R("approval.c_of_o", "Proof of land and building ownership or lease; building approval", "Title documents or lease; building plan approval"),
        R("approval.fire", "Fire safety certificate and working fire extinguishers", "Fire service certificate; extinguisher service log"),
        R("approval.sbmc", "School-Based Management Committee / PTA in place with minutes", "Membership list and meeting minutes", "/school/community")
      ] },
      { id: "staff", title: "Staff", items: [
        R("staff.qualified", "Teachers hold the required qualifications (NCE minimum for basic schools; degree with education for secondary)", "Qualifications recorded on each staff record", "/school/hr"),
        R("staff.trcn", "Teachers registered with the Teachers Registration Council of Nigeria (TRCN)", "TRCN numbers recorded as qualifications", "/school/hr"),
        R("staff.ratio", "Teacher-to-pupil ratio within the state limit", "Census return figures", "/school/insights?tab=census"),
        R("staff.files", "Personal files for all staff: appointment letters, credentials, next of kin", "Staff records and contracts", "/school/hr")
      ] },
      { id: "curriculum", title: "Curriculum and teaching", items: [
        R("curriculum.nerdc", "Teaching follows the national (NERDC) curriculum for each class", "Schemes of work by subject and class", "/school/schemes"),
        R("curriculum.timetable", "A timetable for every class with the required periods per subject", "Published timetable", "/school/timetable"),
        R("curriculum.lesson_notes", "Lesson notes written, checked and signed weekly", "Lesson notes with approvals", "/school/lesson-notes"),
        R("curriculum.assessment", "Continuous assessment and examination records kept", "Score sheets and report cards", "/school/results")
      ] },
      { id: "records", title: "Statutory records", items: [
        R("records.admission_register", "Admission register (with admission numbers and withdrawals)", "Student records and movements", "/school/students"),
        R("records.attendance", "Class attendance registers, marked daily", "Morning registers", "/school/attendance"),
        R("records.log_book", "Log book of important events", "Notices and the change history"),
        R("records.visitors", "Visitors' book", "Visitor sign-in log", "/school/visitors"),
        R("records.discipline", "Punishment / discipline book", "Behaviour incidents", "/school/behaviour"),
        R("records.stock", "Stock and inventory book", "Inventory and asset register", "/school/finance"),
        R("records.cumulative", "Cumulative record cards for each pupil", "Student records with report cards over the years", "/school/students"),
        R("records.minutes", "Minutes of staff meetings", "Minutes in the document library")
      ] },
      { id: "safety", title: "Safety, health and welfare", items: [
        R("safety.child_protection", "Child protection policy in line with the Child Rights Act; a named safeguarding lead", "Approved safeguarding policy; staff confirmations", "/school/compliance"),
        R("safety.first_aid", "First-aid box and a trained first-aider; sick bay", "Health visits log; first-aid training checks", "/school/health"),
        R("safety.sanitation", "Enough toilets (separate for boys and girls) and clean water", "Facilities record"),
        R("safety.classrooms", "Classrooms of adequate size, ventilation and furniture", "Rooms list and census", "/school/rooms"),
        R("safety.security", "Fence, gate control and security staff", "Gate log", "/school/gate")
      ] }
    ]
  },
  {
    id: "bso", short: "BSO", name: "British Schools Overseas (BSO) standards",
    note: "UK Department for Education standards for British schools overseas, inspected by an accredited body. Arranged here by the eight parts of the standards.",
    areas: [
      { id: "quality", title: "Part 1: Quality of education", items: [
        R("quality.curriculum_policy", "Written curriculum policy, plans and schemes of work covering the required areas", "Curriculum policy; schemes of work", "/school/schemes"),
        R("quality.teaching", "Teaching enables pupils to learn and make good progress; lessons are well planned", "Lesson observations; lesson plans", "/school/qa"),
        R("quality.assessment", "A framework to assess pupils' work and track progress", "Gradebook, progress tracking, value added", "/school/insights"),
        R("quality.send", "Provision for pupils with special educational needs and EAL", "SEN register and plans", "/school/sen")
      ] },
      { id: "smsc", title: "Part 2: Spiritual, moral, social and cultural development", items: [
        R("smsc.values", "Pupils learn respect for others, the law and democratic values", "PSHE/citizenship schemes; assemblies plan"),
        R("smsc.balance", "Balanced presentation of political issues", "Policy on political impartiality")
      ] },
      { id: "welfare", title: "Part 3: Welfare, health and safety", items: [
        R("welfare.safeguarding_policy", "Safeguarding policy reflecting current guidance, reviewed every year; designated safeguarding lead trained", "Approved policy with review date; staff confirmations", "/school/compliance"),
        R("welfare.behaviour", "Behaviour policy with sanctions; records of serious sanctions", "Behaviour policy; incident records", "/school/behaviour"),
        R("welfare.anti_bullying", "Anti-bullying strategy that is put into practice", "Anti-bullying policy; incident records"),
        R("welfare.health_safety", "Health and safety policy; fire risk assessment and drills", "H&S policy; fire risk assessment; drill log"),
        R("welfare.first_aid", "First-aid policy and trained staff", "First-aid policy; training checks", "/school/health"),
        R("welfare.supervision", "Pupils properly supervised", "Duty rota; trip risk assessments", "/school/activities"),
        R("welfare.registers", "Admission and attendance registers kept as required", "Registers", "/school/attendance"),
        R("welfare.risk_assessment", "Risk assessment policy and practice", "Risk assessments in the document library")
      ] },
      { id: "staff", title: "Part 4: Suitability of staff and proprietors", items: [
        R("staff.scr", "Single central record of recruitment checks for all staff", "Single central record complete", "/school/compliance?tab=scr"),
        R("staff.checks", "Identity, right to work, qualifications, references and police checks (including overseas) before starting", "Checks recorded with dates", "/school/compliance?tab=scr"),
        R("staff.safer_recruitment", "Safer recruitment: a trained person on every interview panel", "Recruitment records", "/school/hr")
      ] },
      { id: "premises", title: "Part 5: Premises and accommodation", items: [
        R("premises.toilets", "Suitable toilets and washing facilities", "Premises survey"),
        R("premises.medical", "Accommodation for medical examination and the care of sick pupils", "Sick bay"),
        R("premises.maintained", "Premises maintained to a standard that keeps pupils safe", "Maintenance log", "/school/finance"),
        R("premises.water_light", "Suitable drinking water, lighting, acoustics and outdoor space", "Premises survey")
      ] },
      { id: "information", title: "Part 6: Provision of information", items: [
        R("information.published", "Key information and policies available to parents (safeguarding, behaviour, complaints, curriculum, admissions)", "Policies shared with parents in the library", "/school/compliance"),
        R("information.reports", "An annual written report of each pupil's progress to parents", "Published report cards", "/school/results")
      ] },
      { id: "complaints", title: "Part 7: Complaints", items: [
        R("complaints.procedure", "Written complaints procedure with informal, formal and panel stages and time limits", "Complaints procedure", "/school/support"),
        R("complaints.records", "Record of formal complaints and how they were resolved", "Support tickets", "/school/support")
      ] },
      { id: "leadership", title: "Part 8: Leadership and management", items: [
        R("leadership.standards_met", "Leaders show the knowledge and skills to meet the standards consistently", "Self-evaluation; development plan"),
        R("leadership.wellbeing", "Leaders actively promote pupils' wellbeing", "Wellbeing check-ins; pastoral records", "/school/pastoral")
      ] }
    ]
  },
  {
    id: "cobis", short: "COBIS", name: "COBIS Patron's Accreditation and Compliance",
    note: "Council of British International Schools accreditation and compliance. Summarised by its main areas.",
    areas: [
      { id: "safeguarding", title: "Safeguarding and child protection", items: [
        R("safeguarding.policy", "Safeguarding policy aligned with current UK guidance and local law, reviewed yearly", "Approved policy with review date", "/school/compliance"),
        R("safeguarding.dsl", "Designated safeguarding lead and deputies, trained and known to all", "DSL named; training checks"),
        R("safeguarding.training", "All staff trained in safeguarding and have read the policy", "Staff confirmations; training checks", "/school/compliance?tab=scr"),
        R("safeguarding.records", "Concerns recorded, acted on and kept securely", "Safeguarding log", "/school/pastoral")
      ] },
      { id: "recruitment", title: "Safer recruitment", items: [
        R("recruitment.scr", "Single central record complete for all staff and volunteers", "Single central record", "/school/compliance?tab=scr"),
        R("recruitment.overseas", "Overseas police checks or certificates of good conduct where staff have lived abroad", "Checks recorded")
      ] },
      { id: "governance", title: "Leadership and governance", items: [
        R("governance.board", "Effective governance with clear roles and minutes", "Board minutes in the library"),
        R("governance.plan", "A school development plan with priorities and review", "Development plan")
      ] },
      { id: "education", title: "Quality of education", items: [
        R("education.curriculum", "A broad, balanced British-style curriculum", "Curriculum policy; schemes of work", "/school/schemes"),
        R("education.outcomes", "Pupils' progress and outcomes tracked and analysed", "Results analytics", "/school/insights")
      ] },
      { id: "safety", title: "Health, safety and wellbeing", items: [
        R("safety.hs", "Health and safety, fire and first-aid arrangements", "Policies; drills; certificates"),
        R("safety.wellbeing", "Pupil and staff wellbeing supported", "Wellbeing and pastoral records", "/school/pastoral")
      ] },
      { id: "parents", title: "Partnership with parents", items: [
        R("parents.communication", "Regular communication and reporting to parents", "Messages, notices, report cards", "/school/messages"),
        R("parents.complaints", "Accessible complaints procedure", "Complaints procedure", "/school/support")
      ] }
    ]
  },
  {
    id: "cambridge", short: "Cambridge", name: "Cambridge International exam centre requirements",
    note: "What a registered Cambridge centre must have in place to run Cambridge exams, summarised from the Cambridge Handbook. Check the current Handbook each year.",
    areas: [
      { id: "centre", title: "Centre administration", items: [
        R("centre.registration", "Centre registration current; head of centre and exams officer named", "Registration letter in the library"),
        R("centre.entries", "Entries made by the deadlines; candidate details checked", "Entries record"),
        R("centre.data", "Candidate data handled in line with data protection", "Data protection policy")
      ] },
      { id: "security", title: "Security of materials", items: [
        R("security.storage", "Question papers stored in a secure room or safe with restricted keys", "Secure storage description; key log"),
        R("security.receipt", "Receipt and checking of confidential materials logged", "Materials log")
      ] },
      { id: "conduct", title: "Conducting exams", items: [
        R("conduct.invigilators", "Trained invigilators; ratio and briefing as required", "Invigilator list and training record", "/exams"),
        R("conduct.room", "Exam rooms set out to the rules: seating plans, clocks, notices", "Seating plans", "/school/exam-planner"),
        R("conduct.access", "Access arrangements approved in advance for candidates who need them", "SEN access arrangements", "/school/sen"),
        R("conduct.malpractice", "Malpractice and irregularities reported to Cambridge", "Malpractice log")
      ] },
      { id: "coursework", title: "Coursework and non-exam assessment", items: [
        R("coursework.authentication", "Coursework authenticated and marked to Cambridge instructions; moderation samples sent", "Authentication records"),
        R("coursework.deadlines", "Internal deadlines set so marks reach Cambridge on time", "Calendar", "/calendar")
      ] },
      { id: "results", title: "Results and certificates", items: [
        R("results.release", "Results released to candidates only as allowed", "Results release record"),
        R("results.certificates", "Certificates kept securely and issued with signatures", "Certificate issue log")
      ] }
    ]
  }
];

export const frameworkById = (id: string) => FRAMEWORKS.find(f => f.id === id) ?? null;
export type ProgressRow = { framework: string; requirement_key: string; status: "not_started" | "in_progress" | "met" | "not_applicable" };

/** How ready the school is for one framework: overall and by area (not-applicable items left out). */
export function readiness(f: Framework, progress: ProgressRow[]) {
  const st = new Map(progress.filter(p => p.framework === f.id).map(p => [p.requirement_key, p.status]));
  const count = (items: Requirement[]) => {
    let applicable = 0, met = 0, inProgress = 0;
    for (const r of items) {
      const s = st.get(r.key) ?? "not_started";
      if (s === "not_applicable") continue;
      applicable++;
      if (s === "met") met++; else if (s === "in_progress") inProgress++;
    }
    return { applicable, met, in_progress: inProgress, not_started: applicable - met - inProgress, pct: applicable ? Math.round((met / applicable) * 100) : null };
  };
  return { ...count(f.areas.flatMap(a => a.items)), areas: f.areas.map(a => ({ id: a.id, title: a.title, ...count(a.items) })) };
}

// ---------------- documents ----------------

export type DocRow = { id: string; title: string; category: string; status: string; review_due_on: string | null; expires_on: string | null };
export type DocAlert = { id: string; title: string; kind: "review_overdue" | "review_soon" | "expired" | "expires_soon"; date: string; days: number };

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400_000);

/** Policies due for review (within 30 days or overdue) and certificates running out (within 60 days or expired). */
export function documentAlerts(docs: DocRow[], today: string): DocAlert[] {
  const out: DocAlert[] = [];
  for (const d of docs) {
    if (d.status !== "approved") continue;
    if (d.review_due_on) {
      const n = days(today, d.review_due_on);
      if (n < 0) out.push({ id: d.id, title: d.title, kind: "review_overdue", date: d.review_due_on, days: n });
      else if (n <= 30) out.push({ id: d.id, title: d.title, kind: "review_soon", date: d.review_due_on, days: n });
    }
    if (d.expires_on) {
      const n = days(today, d.expires_on);
      if (n < 0) out.push({ id: d.id, title: d.title, kind: "expired", date: d.expires_on, days: n });
      else if (n <= 60) out.push({ id: d.id, title: d.title, kind: "expires_soon", date: d.expires_on, days: n });
    }
  }
  return out.sort((a, b) => a.days - b.days);
}

// ---------------- single central record ----------------

export const CHECKS: { kind: string; label: string; required: boolean }[] = [
  { kind: "identity", label: "Identity", required: true },
  { kind: "right_to_work", label: "Right to work", required: true },
  { kind: "qualifications", label: "Qualifications", required: true },
  { kind: "references", label: "References", required: true },
  { kind: "police_check", label: "Police check", required: true },
  { kind: "overseas_police_check", label: "Overseas check", required: false },
  { kind: "prohibition_check", label: "Prohibition check", required: false },
  { kind: "medical_fitness", label: "Medical fitness", required: true },
  { kind: "safeguarding_training", label: "Safeguarding training", required: true },
  { kind: "first_aid_training", label: "First aid", required: false }
];

export type CheckRow = { staff_id: string; kind: string; outcome: string; checked_on: string | null; expires_on: string | null };
export type CellState = "clear" | "expired" | "pending" | "concern" | "missing" | "not_required";

/** Each member of staff with the state of every check (latest record of each kind) and whether the required ones are all clear. */
export function scrMatrix(staff: { id: string; name: string }[], checks: CheckRow[], today: string) {
  const latest = new Map<string, CheckRow>();
  for (const c of checks) {
    const k = `${c.staff_id}|${c.kind}`, prev = latest.get(k);
    if (!prev || (c.checked_on ?? "") >= (prev.checked_on ?? "")) latest.set(k, c);
  }
  return staff.map(s => {
    const cells: Record<string, CellState> = {};
    for (const ch of CHECKS) {
      const c = latest.get(`${s.id}|${ch.kind}`);
      cells[ch.kind] = !c ? "missing" : c.outcome === "not_required" ? "not_required" : c.outcome === "pending" ? "pending" : c.outcome === "concern" ? "concern"
        : c.expires_on && c.expires_on < today ? "expired" : "clear";
    }
    const gaps = CHECKS.filter(ch => ch.required && !["clear", "not_required"].includes(cells[ch.kind])).map(ch => ch.label);
    return { staff_id: s.id, name: s.name, cells, complete: gaps.length === 0, gaps };
  }).sort((a, b) => Number(a.complete) - Number(b.complete) || a.name.localeCompare(b.name));
}
