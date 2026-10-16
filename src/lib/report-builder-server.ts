/**
 * Loads the rows behind each report-builder dataset, and sends scheduled
 * reports. Uses the service client: callers check the person may use the
 * dataset first (canUse), and teachers' results are limited to their classes.
 */
import { fetchAll } from "./results";
import { studentName } from "./school";
import { localParts } from "./attendance";
import { ageOn } from "./census";
import { monthOf } from "./insights";
import { termsInOrder } from "./insights-server";
import { datasetById, canUse, validateSpec, runSpec, nextRun, type Spec, type Output } from "./report-builder";
import { enqueue, loadBrand } from "./messaging/outbox";
import { communityNote } from "./messaging/notices";

const CAP = 20000;
type Params = NonNullable<Spec["params"]>;
export type Who = { userId: string; roles: Set<string>; leader: boolean };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function range(p: Params, today: string) {
  const from = p.from && DATE.test(p.from) ? p.from : `${today.slice(0, 4)}-01-01`;
  const to = p.to && DATE.test(p.to) ? p.to : today;
  return { from, to };
}

/** Classes a teacher teaches or is form tutor of (null = no limit). */
async function teacherClasses(svc: any, tenantId: string, who: Who): Promise<string[] | null> {
  if (who.leader) return null;
  const [{ data: o }, { data: f }] = await Promise.all([
    svc.from("subject_offerings").select("class_group_id").eq("tenant_id", tenantId).eq("teacher_id", who.userId),
    svc.from("class_groups").select("id").eq("tenant_id", tenantId).eq("form_teacher_id", who.userId)
  ]);
  return [...new Set([...(o ?? []).map((x: any) => x.class_group_id), ...(f ?? []).map((x: any) => x.id)])];
}

async function classMap(svc: any, tenantId: string) {
  const { data } = await svc.from("class_groups").select("id,name,level").eq("tenant_id", tenantId);
  return new Map<string, { name: string; level: string }>((data ?? []).map((c: any) => [c.id, { name: c.name, level: c.level || c.name }]));
}

async function currentTermId(svc: any, tenantId: string, p: Params) {
  if (p.term_id) return p.term_id;
  const terms = await termsInOrder(svc, tenantId);
  return (terms.find(t => t.is_current) ?? terms[terms.length - 1])?.id ?? null;
}

export async function loadRows(svc: any, tenantId: string, timeZone: string, dataset: string, p: Params, who: Who): Promise<Record<string, unknown>[]> {
  const today = localParts(new Date(), timeZone).date;
  const cg = p.class_group_id ?? null;
  const classes = await classMap(svc, tenantId);
  const cls = (id: string | null) => (id ? classes.get(id) : undefined);
  switch (dataset) {
    case "students": {
      let q = () => { let x = svc.from("students").select("id,admission_no,first_name,last_name,other_names,gender,date_of_birth,class_group_id,admitted_on,fee_category,status,houses(name),student_guardians(guardians(full_name,phone))").eq("tenant_id", tenantId).eq("status", "active"); if (cg) x = x.eq("class_group_id", cg); return x.order("id"); };
      const rows = await fetchAll<any>(q);
      return rows.slice(0, CAP).map(s => {
        const g = s.student_guardians?.[0]?.guardians;
        return { admission_no: s.admission_no, name: studentName(s), gender: s.gender, date_of_birth: s.date_of_birth, age: ageOn(s.date_of_birth, today),
          class: cls(s.class_group_id)?.name ?? "", level: cls(s.class_group_id)?.level ?? "", house: s.houses?.name ?? "", admitted_on: s.admitted_on,
          fee_category: s.fee_category, status: s.status, guardian: g?.full_name ?? "", guardian_phone: g?.phone ?? "" };
      });
    }
    case "attendance": {
      const { from, to } = range(p, today);
      const marks = await fetchAll<any>(() => { let x = svc.from("class_attendance").select("student_id,status,class_group_id").eq("tenant_id", tenantId).gte("date", from).lte("date", to); if (cg) x = x.eq("class_group_id", cg); return x.order("id"); });
      const per = new Map<string, Record<string, number>>();
      for (const m of marks.slice(0, 500000)) { const t = per.get(m.student_id) ?? { present: 0, late: 0, absent: 0, excused: 0 }; t[m.status] = (t[m.status] ?? 0) + 1; per.set(m.student_id, t); }
      const students = await byIds(svc, "students", [...per.keys()], "id,admission_no,first_name,last_name,other_names,gender,class_group_id");
      return students.map((s: any) => {
        const t = per.get(s.id)!, days = t.present + t.late + t.absent + t.excused;
        return { name: studentName(s), admission_no: s.admission_no, class: cls(s.class_group_id)?.name ?? "", level: cls(s.class_group_id)?.level ?? "", gender: s.gender,
          days, present: t.present, late: t.late, absent: t.absent, excused: t.excused, rate: days ? Math.round(((t.present + t.late) / days) * 1000) / 10 : null };
      });
    }
    case "results":
    case "report_cards": {
      const term = await currentTermId(svc, tenantId, p);
      if (!term) return [];
      const allowed = await teacherClasses(svc, tenantId, who);
      const cards = await fetchAll<any>(() => { let x = svc.from("report_cards").select("student_id,class_group_id,average,position,class_size,status,data").eq("tenant_id", tenantId).eq("term_id", term).eq("kind", "term"); if (cg) x = x.eq("class_group_id", cg); return x.order("student_id"); });
      const mine = allowed ? cards.filter(c => allowed.includes(c.class_group_id)) : cards;
      const students = new Map((await byIds(svc, "students", mine.map(c => c.student_id), "id,admission_no,first_name,last_name,other_names,gender")).map((s: any) => [s.id, s]));
      const base = (c: any) => { const s: any = students.get(c.student_id) ?? {}; return { name: s.first_name ? studentName(s) : "", admission_no: s.admission_no ?? "", class: cls(c.class_group_id)?.name ?? "", level: cls(c.class_group_id)?.level ?? "", gender: s.gender ?? null }; };
      if (dataset === "report_cards") return mine.map(c => ({ ...base(c), average: c.average === null ? null : Number(c.average), position: c.position, class_size: c.class_size, subjects_passed: c.data?.subjects_passed ?? null, status: c.status }));
      return mine.flatMap(c => (c.data?.subjects ?? []).map((s: any) => ({ ...base(c), subject: s.subject, total: s.total === null ? null : Number(s.total), grade: s.grade ?? null, passed: s.passed ?? null, position: s.position ?? null }))).slice(0, CAP);
    }
    case "invoices": {
      const term = p.term_id ?? null;
      const rows = await fetchAll<any>(() => {
        let x = svc.from("fee_invoices").select("invoice_no,title,total,amount_paid,status,due_date,created_at,student_id,students(first_name,last_name,other_names,admission_no,class_group_id)").eq("tenant_id", tenantId).neq("status", "void");
        if (term) x = x.eq("term_id", term);
        if (p.from && DATE.test(p.from)) x = x.gte("created_at", p.from);
        if (p.to && DATE.test(p.to)) x = x.lte("created_at", `${p.to}T23:59:59`);
        return x.order("created_at");
      });
      return rows.filter(i => !cg || i.students?.class_group_id === cg).slice(0, CAP).map(i => ({
        invoice_no: i.invoice_no, name: i.students ? studentName(i.students) : "", admission_no: i.students?.admission_no ?? "", class: cls(i.students?.class_group_id)?.name ?? "",
        title: i.title, total: Number(i.total), paid: Number(i.amount_paid), balance: Math.max(0, Number(i.total) - Number(i.amount_paid)), status: i.status, due_date: i.due_date, created: i.created_at?.slice(0, 10)
      }));
    }
    case "payments": {
      const { from, to } = range(p, today);
      const rows = await fetchAll<any>(() => svc.from("fee_payments").select("receipt_no,amount,method,provider,reference,payer_name,paid_at,created_at,students(first_name,last_name,other_names,class_group_id)")
        .eq("tenant_id", tenantId).eq("status", "success").gte("created_at", from).lte("created_at", `${to}T23:59:59`).order("created_at"));
      return rows.filter(x => !cg || x.students?.class_group_id === cg).slice(0, CAP).map(x => {
        const at = x.paid_at ?? x.created_at;
        return { receipt_no: x.receipt_no, date: localParts(new Date(at), timeZone).date, month: monthOf(at, timeZone), name: x.students ? studentName(x.students) : "", class: cls(x.students?.class_group_id)?.name ?? "",
          amount: Number(x.amount), method: x.method, provider: x.provider, reference: x.reference, payer: x.payer_name };
      });
    }
    case "applications": {
      const { from, to } = range(p, today);
      const rows = await fetchAll<any>(() => svc.from("applications").select("application_no,first_name,last_name,other_names,applying_for,status,source,created_at,guardian_name,guardian_phone,guardian_email,fee_paid")
        .eq("tenant_id", tenantId).gte("created_at", from).lte("created_at", `${to}T23:59:59`).order("created_at"));
      return rows.slice(0, CAP).map(a => ({ application_no: a.application_no, name: studentName(a), applying_for: a.applying_for, status: a.status, source: a.source,
        month: monthOf(a.created_at, timeZone), created: a.created_at?.slice(0, 10), guardian: a.guardian_name, guardian_phone: a.guardian_phone, guardian_email: a.guardian_email, fee_paid: a.fee_paid }));
    }
    case "staff": {
      const rows = await fetchAll<any>(() => svc.from("staff").select("staff_no,full_name,department,position,employment_type,hire_date,status,email,phone,staff_personal(gender)").eq("tenant_id", tenantId).order("staff_no"));
      return rows.slice(0, CAP).map(s => { const pers = Array.isArray(s.staff_personal) ? s.staff_personal[0] : s.staff_personal; return {
        staff_no: s.staff_no, name: s.full_name, department: s.department, position: s.position, employment_type: s.employment_type, gender: pers?.gender ?? null,
        hire_date: s.hire_date, status: s.status, email: s.email, phone: s.phone }; });
    }
    case "library_loans": {
      const { from, to } = range(p, today);
      const rows = await fetchAll<any>(() => svc.from("library_loans").select("issued_at,due_at,returned_at,fine_amount,library_books(title),students(first_name,last_name,other_names,class_group_id),staff(full_name)")
        .eq("tenant_id", tenantId).gte("issued_at", from).lte("issued_at", `${to}T23:59:59`).order("issued_at"));
      const now = Date.now();
      return rows.slice(0, CAP).map(l => {
        const end = l.returned_at ? new Date(l.returned_at).getTime() : now;
        return { title: l.library_books?.title ?? "", borrower: l.students ? studentName(l.students) : l.staff?.full_name ?? "", class: cls(l.students?.class_group_id)?.name ?? (l.staff ? "Staff" : ""),
          issued: l.issued_at?.slice(0, 10), due: l.due_at?.slice(0, 10), returned: l.returned_at?.slice(0, 10) ?? null,
          overdue_days: Math.max(0, Math.floor((end - new Date(l.due_at).getTime()) / 86400_000)), fine: Number(l.fine_amount ?? 0) };
      });
    }
    case "behaviour": {
      const { from, to } = range(p, today);
      const rows = await fetchAll<any>(() => svc.from("behaviour_incident_students").select("role,students(first_name,last_name,other_names,class_group_id),behaviour_incidents!inner(occurred_at,severity,status,location,tenant_id,behaviour_categories(name))")
        .eq("tenant_id", tenantId).gte("behaviour_incidents.occurred_at", from).lte("behaviour_incidents.occurred_at", `${to}T23:59:59`).order("incident_id"));
      return rows.filter(r => !cg || r.students?.class_group_id === cg).slice(0, CAP).map(r => ({
        date: r.behaviour_incidents?.occurred_at?.slice(0, 10), name: r.students ? studentName(r.students) : "", class: cls(r.students?.class_group_id)?.name ?? "",
        category: r.behaviour_incidents?.behaviour_categories?.name ?? "", severity: r.behaviour_incidents?.severity, role: r.role, status: r.behaviour_incidents?.status, location: r.behaviour_incidents?.location ?? "" }));
    }
  }
  return [];
}

async function byIds(svc: any, table: string, ids: string[], cols: string) {
  const out: any[] = [];
  const uniq = [...new Set(ids)];
  for (let i = 0; i < uniq.length; i += 300) {
    const { data } = await svc.from(table).select(cols).in("id", uniq.slice(i, i + 300));
    out.push(...(data ?? []));
  }
  return out;
}

/** Runs a saved or draft report for a person, checking they may use its dataset. */
export async function runReport(svc: any, tenantId: string, timeZone: string, dataset: string, spec: Spec, who: Who): Promise<Output | { error: string }> {
  const d = datasetById(dataset);
  if (!d) return { error: "unknown dataset" };
  if (!canUse(d, who.roles)) return { error: `your role cannot report on ${d.label.toLowerCase()}` };
  const errs = validateSpec(d, spec);
  if (errs.length) return { error: errs.join("; ") };
  return runSpec(d, spec, await loadRows(svc, tenantId, timeZone, dataset, spec.params ?? {}, who));
}

const LEADERS = ["school_admin", "principal", "platform_admin", "qa_officer", "it_admin"];
async function whoIs(svc: any, userId: string): Promise<(Who & { tenantId: string; active: boolean }) | null> {
  const { data: u } = await svc.from("users").select("id,tenant_id,role,extra_roles,active").eq("id", userId).maybeSingle();
  if (!u) return null;
  const roles = new Set<string>([u.role, ...(u.extra_roles ?? [])]);
  return { userId: u.id, roles, leader: [...roles].some(r => LEADERS.includes(r)), tenantId: u.tenant_id, active: u.active };
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));

/**
 * Sends scheduled reports that are due (a few per run). Each is run as its
 * author, so it never shows more than they could see. Grouped reports carry
 * their totals in the email; row-by-row reports carry only the count and a
 * link that needs sign-in, so no student's details travel by email.
 */
export async function sendDueReports(svc: any, baseUrl: string, perRun = 5): Promise<number> {
  const { data: due } = await svc.from("saved_reports").select("id,tenant_id,owner_id,name,dataset,spec,schedule,schedule_day,schedule_hour,recipient_ids")
    .neq("schedule", "none").lte("next_run_at", new Date().toISOString()).order("next_run_at").limit(perRun);
  let sent = 0;
  for (const r of due ?? []) {
    const { data: t } = await svc.from("tenants").select("timezone,status").eq("id", r.tenant_id).maybeSingle();
    const tz = t?.timezone ?? "Africa/Lagos";
    const next = nextRun(r, new Date(), tz);
    try {
      const owner = r.owner_id ? await whoIs(svc, r.owner_id) : null;
      if (!owner || !owner.active || owner.tenantId !== r.tenant_id) throw new Error("the report's author no longer has an account here");
      if (t?.status && t.status !== "active") throw new Error("the school is not active");
      const out = await runReport(svc, r.tenant_id, tz, r.dataset, r.spec ?? {}, owner);
      if ("error" in out) throw new Error(out.error);
      const { data: users } = await svc.from("users").select("id,full_name,email,active,role").eq("tenant_id", r.tenant_id).in("id", r.recipient_ids ?? []);
      const brand = await loadBrand(svc, r.tenant_id);
      const link = `${baseUrl}/school/reports?id=${r.id}`;
      const grouped = Boolean(r.spec?.group_by);
      const when = localParts(new Date(), tz).date;
      const lines = [
        `Your ${r.schedule} report "${r.name}" for ${when}: ${out.total_rows} ${grouped ? "group" : "row"}${out.total_rows === 1 ? "" : "s"}.`,
        grouped ? "" : "Open it in the school system to see the rows or download them (you will need to sign in)."
      ].filter(Boolean);
      const table = grouped
        ? `<table style="border-collapse:collapse;font-size:13px;margin-top:8px"><tr>${out.columns.map(c => `<th style="text-align:left;border-bottom:1px solid #cbd5e1;padding:4px 8px">${esc(c.label)}</th>`).join("")}</tr>${
          out.rows.slice(0, 100).map(row => `<tr>${row.map(v => `<td style="border-bottom:1px solid #f1f5f9;padding:4px 8px">${esc(v ?? "")}</td>`).join("")}</tr>`).join("")}</table>` : "";
      const textTable = grouped ? out.rows.slice(0, 100).map(row => row.map(v => v ?? "").join(" | ")).join("\n") : "";
      const rows = (users ?? []).filter((u: any) => u.active && u.email && !["parent", "student"].includes(u.role)).map((u: any) => {
        const m = communityNote(brand, { name: u.full_name, subject: `${r.name} (${when})`, lines, link, linkLabel: "Open the report" });
        return { tenant_id: r.tenant_id, channel: "email" as const, to_address: u.email, to_name: u.full_name, kind: "scheduled_summary",
          subject: m.subject, body_text: textTable ? `${m.text}\n\n${textTable}` : m.text, body_html: !table ? m.html : m.html.includes("</body>") ? m.html.replace("</body>", `${table}</body>`) : m.html + table,
          ref_id: r.id, recipient_user_id: u.id };
      });
      if (rows.length) await enqueue(svc, rows);
      await svc.from("saved_reports").update({ last_sent_at: new Date().toISOString(), last_error: null, next_run_at: next?.toISOString() ?? null }).eq("id", r.id);
      sent++;
    } catch (e) {
      await svc.from("saved_reports").update({ last_error: String((e as Error).message).slice(0, 300), next_run_at: next?.toISOString() ?? null }).eq("id", r.id);
    }
  }
  return sent;
}
