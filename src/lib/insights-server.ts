/**
 * Data for the analytics pages and the school census. Uses the service client:
 * routes check who may see what first, and pass `scope` to limit a teacher to
 * the classes and subjects they teach. The rules live in insights.ts and census.ts.
 */
import { fetchAll } from "./results";
import { studentName } from "./school";
import { localParts } from "./attendance";
import { type ResultRow, monthsBack, monthOf, byMonth, admissionsBySource, collectionByClass } from "./insights";
import { censusReturn, type CensusStaff } from "./census";

export type TermRow = { id: string; name: string; starts_on: string | null; position: number; is_current: boolean; session: string; session_starts: string | null };

/** All terms, oldest first. */
export async function termsInOrder(svc: any, tenantId: string): Promise<TermRow[]> {
  const { data } = await svc.from("terms").select("id,name,starts_on,position,is_current,created_at,academic_sessions(name,starts_on,created_at)").eq("tenant_id", tenantId);
  return (data ?? []).map((t: any) => ({
    id: t.id, name: t.name, starts_on: t.starts_on, position: t.position, is_current: t.is_current,
    session: t.academic_sessions?.name ?? "", session_starts: t.academic_sessions?.starts_on ?? t.academic_sessions?.created_at ?? null, _c: t.created_at
  })).sort((a: any, b: any) => String(a.session_starts ?? "").localeCompare(String(b.session_starts ?? "")) || a.position - b.position
    || String(a.starts_on ?? a._c).localeCompare(String(b.starts_on ?? b._c)))
    .map(({ _c, ...t }: any) => t);
}

export type Scope = { teacherId: string; formClassIds: string[] } | null;

/** One row per student per subject for a term, from the computed report cards. */
export async function resultRows(svc: any, tenantId: string, termId: string, scope: Scope = null): Promise<ResultRow[]> {
  const [cards, { data: classes }, { data: offerings }] = await Promise.all([
    fetchAll<any>(() => svc.from("report_cards").select("student_id,class_group_id,data,status").eq("tenant_id", tenantId).eq("term_id", termId).eq("kind", "term").neq("status", "withheld").order("student_id")),
    svc.from("class_groups").select("id,name,level").eq("tenant_id", tenantId),
    svc.from("subject_offerings").select("class_group_id,subject_id,teacher_id,users(full_name)").eq("tenant_id", tenantId)
  ]);
  const ids = [...new Set(cards.map(c => c.student_id))];
  const students = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await svc.from("students").select("id,first_name,last_name,other_names,gender").in("id", ids.slice(i, i + 300));
    for (const s of data ?? []) students.set(s.id, s);
  }
  const cls = new Map<string, any>((classes ?? []).map((c: any) => [c.id, c]));
  const teacher = new Map<string, { id: string | null; name: string }>((offerings ?? []).map((o: any) => [`${o.class_group_id}|${o.subject_id}`, { id: o.teacher_id, name: o.users?.full_name ?? "" }]));
  const out: ResultRow[] = [];
  for (const c of cards) {
    const s = students.get(c.student_id);
    const k = cls.get(c.class_group_id);
    for (const sub of c.data?.subjects ?? []) {
      const t = teacher.get(`${c.class_group_id}|${sub.subject_id}`);
      if (scope && t?.id !== scope.teacherId && !scope.formClassIds.includes(c.class_group_id)) continue;
      out.push({
        student_id: c.student_id, student: s ? studentName(s) : "Student", gender: s?.gender ?? null,
        class_group_id: c.class_group_id, class_name: k?.name ?? c.data?.class_name ?? "", level: k?.level || k?.name || "Unknown",
        subject_id: sub.subject_id, subject: sub.subject ?? "", teacher_id: t?.id ?? null, teacher: t?.name || "Not assigned",
        total: sub.total === null || sub.total === undefined ? null : Number(sub.total), passed: sub.passed ?? null
      });
    }
  }
  return out;
}

/** A student's subject totals and average across every term with a report card. */
export async function studentHistory(svc: any, tenantId: string, studentId: string) {
  const [terms, { data: cards }] = await Promise.all([
    termsInOrder(svc, tenantId),
    svc.from("report_cards").select("term_id,average,position,class_size,data").eq("tenant_id", tenantId).eq("student_id", studentId).eq("kind", "term")
  ]);
  const order = new Map(terms.map((t, i) => [t.id, i]));
  return (cards ?? []).sort((a: any, b: any) => (order.get(a.term_id) ?? 0) - (order.get(b.term_id) ?? 0)).map((c: any) => {
    const t = terms.find(x => x.id === c.term_id);
    return { term_id: c.term_id, term: t ? `${t.name} ${t.session}`.trim() : "", average: c.average === null ? null : Number(c.average), position: c.position, class_size: c.class_size,
      subjects: (c.data?.subjects ?? []).map((s: any) => ({ subject_id: s.subject_id, subject: s.subject, total: s.total === null ? null : Number(s.total), grade: s.grade ?? null })) };
  });
}

/** Each student's score this term with their score in the same subject the term before, labelled by teacher or class. */
export async function valueAddedPairs(svc: any, tenantId: string, termId: string, by: "teacher" | "class") {
  const terms = await termsInOrder(svc, tenantId);
  const i = terms.findIndex(t => t.id === termId);
  const prev = i > 0 ? terms[i - 1] : null;
  if (!prev) return { previous: null, pairs: [] };
  const [now, before] = await Promise.all([resultRows(svc, tenantId, termId), resultRows(svc, tenantId, prev.id)]);
  const prior = new Map(before.filter(r => r.total !== null).map(r => [`${r.student_id}|${r.subject_id}`, r.total as number]));
  const pairs = now.filter(r => r.total !== null && prior.has(`${r.student_id}|${r.subject_id}`)).flatMap(r => {
    const key = by === "teacher" ? r.teacher_id : r.class_group_id;
    if (!key) return [];
    return [{ key, label: by === "teacher" ? r.teacher : r.class_name, student_id: r.student_id, subject_id: r.subject_id, subject: r.subject,
      prior: prior.get(`${r.student_id}|${r.subject_id}`)!, current: r.total as number }];
  });
  return { previous: `${prev.name} ${prev.session}`.trim(), pairs };
}

/** Fees over the last year: billed and collected by month, by method, and by class for the current term. */
export async function financeInsights(svc: any, tenantId: string, timeZone: string, termId: string | null) {
  const months = monthsBack(monthOf(new Date().toISOString(), timeZone), 12);
  const since = `${months[0]}-01`;
  const [payments, invoices, termInv] = await Promise.all([
    fetchAll<any>(() => svc.from("fee_payments").select("amount,method,paid_at,created_at").eq("tenant_id", tenantId).eq("status", "success").gte("created_at", since).order("created_at")),
    fetchAll<any>(() => svc.from("fee_invoices").select("total,created_at,status").eq("tenant_id", tenantId).neq("status", "void").gte("created_at", since).order("created_at")),
    termId ? fetchAll<any>(() => svc.from("fee_invoices").select("id,total,amount_paid,status,students(class_groups(name))").eq("tenant_id", tenantId).eq("term_id", termId).order("id")) : Promise.resolve([])
  ]);
  const methods = new Map<string, number>();
  for (const p of payments) methods.set(p.method, (methods.get(p.method) ?? 0) + Number(p.amount));
  return {
    collected: byMonth(payments, (p: any) => p.paid_at ?? p.created_at, (p: any) => Number(p.amount), months, timeZone),
    billed: byMonth(invoices, (i: any) => i.created_at, (i: any) => Number(i.total), months, timeZone),
    methods: [...methods.entries()].map(([method, amount]) => ({ method, amount: Math.round(amount * 100) / 100 })).sort((a, b) => b.amount - a.amount),
    by_class: collectionByClass(termInv.map((i: any) => ({ class_name: i.students?.class_groups?.name ?? null, total: Number(i.total), amount_paid: Number(i.amount_paid), status: i.status })))
  };
}

/** Admissions over the last year: applications by month and by source, and where they stand. */
export async function admissionsInsights(svc: any, tenantId: string, timeZone: string) {
  const months = monthsBack(monthOf(new Date().toISOString(), timeZone), 12);
  const apps = await fetchAll<any>(() => svc.from("applications").select("status,source,created_at,applying_for").eq("tenant_id", tenantId).gte("created_at", `${months[0]}-01`).order("created_at"));
  const statuses = ["new", "reviewing", "assessment", "interview", "offered", "accepted", "enrolled", "rejected", "withdrawn"];
  const levels = new Map<string, number>();
  for (const a of apps) levels.set(a.applying_for, (levels.get(a.applying_for) ?? 0) + 1);
  return {
    by_month: byMonth(apps, (a: any) => a.created_at, () => 1, months, timeZone),
    enrolled_by_month: byMonth(apps.filter((a: any) => a.status === "enrolled"), (a: any) => a.created_at, () => 1, months, timeZone),
    by_source: admissionsBySource(apps),
    funnel: statuses.map(s => ({ status: s, count: apps.filter((a: any) => a.status === s).length })),
    by_level: [...levels.entries()].map(([level, count]) => ({ level, count })).sort((a, b) => b.count - a.count)
  };
}

/** Works out the annual school census from the school's records. */
export async function buildCensus(svc: any, tenantId: string, timeZone: string, period: string, asOf?: string) {
  const day = asOf ?? localParts(new Date(), timeZone).date;
  const terms = await termsInOrder(svc, tenantId);
  const current = terms.find(t => t.is_current) ?? terms[terms.length - 1];
  const sessionTerms = current ? terms.filter(t => t.session === current.session) : [];
  const yearStarts = sessionTerms.map(t => t.starts_on).filter(Boolean).sort()[0] ?? `${period.slice(0, 4)}-09-01`;
  const [students, { data: classes }, { data: moves }, { data: sen }, staff, { data: profile }, rooms] = await Promise.all([
    fetchAll<any>(() => svc.from("students").select("id,gender,date_of_birth,admitted_on,class_group_id").eq("tenant_id", tenantId).eq("status", "active").order("id")),
    svc.from("class_groups").select("id,name,level").eq("tenant_id", tenantId),
    svc.from("student_movements").select("student_id").eq("tenant_id", tenantId).eq("kind", "repeated").gte("effective_on", yearStarts),
    svc.from("sen_profiles").select("student_id,needs,status").eq("tenant_id", tenantId).in("status", ["sen_support", "ehcp"]),
    fetchAll<any>(() => svc.from("staff").select("id,position,department,user_id,users(role,extra_roles),staff_personal(gender),staff_qualifications(kind,title,reference_no)").eq("tenant_id", tenantId).neq("status", "exited").order("id")),
    svc.from("tenant_settings").select("census_profile").eq("tenant_id", tenantId).maybeSingle(),
    svc.from("rooms").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("kind", "classroom").eq("active", true)
  ]);
  const cls = new Map<string, any>((classes ?? []).map((c: any) => [c.id, c]));
  const isTeacher = (s: any) => s.users?.role === "teacher" || (s.users?.extra_roles ?? []).includes("teacher") || /teach|tutor|lecturer|instructor/i.test(`${s.position ?? ""}`);
  return censusReturn({
    period, asOf: day, yearStarts, profile: (profile?.census_profile ?? {}) as Record<string, string>,
    students: students.map((s: any) => { const c = cls.get(s.class_group_id); return { id: s.id, gender: s.gender, date_of_birth: s.date_of_birth, admitted_on: s.admitted_on, level: c?.level || c?.name || "No class" }; }),
    repeaters: new Set((moves ?? []).map((m: any) => m.student_id)),
    sen: (sen ?? []).map((p: any) => ({ student_id: p.student_id, needs: p.needs ?? [] })),
    staff: staff.map((s: any): CensusStaff => {
      const personal = Array.isArray(s.staff_personal) ? s.staff_personal[0] : s.staff_personal;
      return { id: s.id, gender: personal?.gender ?? null, teaching: isTeacher(s), qualifications: s.staff_qualifications ?? [] };
    }),
    classrooms: rooms.count || (classes ?? []).length
  });
}
