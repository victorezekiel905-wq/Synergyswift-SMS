/**
 * Recycle bin. The database keeps every deletion (migration 9400); this names what was
 * deleted, and works out which stored files go when a deletion is removed for good.
 * Uploaded files are not removed when their record is deleted, so a restore brings the
 * file back too; they go when the deletion leaves the bin for good (by hand, or after
 * KEEP_DAYS).
 */

/** Days a deletion stays in the bin before it is removed for good. */
export const KEEP_DAYS = 30;

/** Who can open the bin: the school's administrators (and platform staff acting for a school). */
export const BIN_ROLES = ["school_admin", "platform_admin"] as const;

/** Plain names for what was deleted, by table. */
const KIND: Record<string, string> = {
  "public.students": "Student", "public.guardians": "Parent", "public.staff": "Staff member", "public.class_groups": "Class",
  "public.subjects": "Subject", "public.departments": "Department", "public.school_sections": "School section",
  "public.academic_sessions": "Session", "public.terms": "Term", "public.exams": "Exam", "public.exam_series": "Exam series",
  "public.exam_papers": "Exam paper", "public.exam_halls": "Exam hall", "public.question_bank": "Bank question",
  "public.homework": "Homework", "public.lessons": "Lesson", "public.lesson_notes": "Lesson note", "public.schemes_of_work": "Scheme of work",
  "public.learning_paths": "Learning path", "public.learning_groups": "Learning group", "public.online_lessons": "Online lesson",
  "public.content_packages": "Learning content", "public.lti_tools": "Connected tool", "public.lti_links": "Tool link",
  "public.forums": "Forum", "public.forum_threads": "Forum thread", "public.notices": "Notice", "public.news_posts": "News post",
  "public.school_events": "Event", "public.message_templates": "Message template", "public.surveys": "Survey", "public.tickets": "Parent request",
  "public.class_story_posts": "Class story post", "public.school_documents": "School document", "public.student_documents": "Student document",
  "public.staff_documents": "Staff document", "public.student_achievements": "Student achievement", "public.staff_achievements": "Staff achievement",
  "public.portfolio_items": "Portfolio item", "public.staff_qualifications": "Qualification", "public.job_postings": "Job posting",
  "public.job_applications": "Job application", "public.applications": "Admission application", "public.admission_leads": "Admissions enquiry",
  "public.admission_events": "Admissions event", "public.admission_sequences": "Follow-up sequence", "public.entrance_plans": "Entrance test plan",
  "public.alumni": "Alumnus", "public.crm_partners": "Partner", "public.crm_campaigns": "Campaign", "public.family_segments": "Family group",
  "public.fee_items": "Fee item", "public.fee_invoices": "Invoice", "public.fee_awards": "Scholarship or award", "public.fee_discount_rules": "Discount rule",
  "public.installment_plans": "Instalment plan", "public.expenses": "Expense", "public.budgets": "Budget", "public.ledger_accounts": "Ledger account",
  "public.journal_entries": "Journal entry", "public.payroll_runs": "Payroll run", "public.pay_grades": "Pay grade", "public.appraisals": "Appraisal",
  "public.cpd_activities": "Training record", "public.staff_shifts": "Shift", "public.staff_checklists": "Staff checklist",
  "public.hr_checklist_templates": "Checklist template", "public.staff_absences": "Staff absence", "public.leave_requests": "Leave request",
  "public.library_books": "Library book", "public.inventory_items": "Stock item", "public.assets": "Asset", "public.suppliers": "Supplier",
  "public.purchase_orders": "Purchase order", "public.requisitions": "Requisition", "public.rooms": "Room", "public.timetable_periods": "Timetable period",
  "public.transport_routes": "Bus route", "public.vehicles": "Vehicle", "public.drivers": "Driver", "public.hostels": "Hostel",
  "public.hostel_rooms": "Hostel room", "public.houses": "House", "public.behaviour_incidents": "Behaviour incident",
  "public.detention_sessions": "Detention session", "public.ieps": "Support plan", "public.iep_targets": "Support plan target",
  "public.elections": "Election", "public.election_posts": "Election post", "public.election_candidates": "Candidate",
  "public.competitions": "Competition", "public.cc_groups": "Club or society", "public.badges": "Badge", "public.trait_definitions": "Trait",
  "public.early_years_areas": "Early years area", "public.early_years_items": "Early years item", "public.grading_schemes": "Grading scheme",
  "public.comment_bank": "Saved comment", "public.curriculum_objectives": "Curriculum objective", "public.reenrolment_rounds": "Re-enrolment round",
  "public.result_pin_batches": "Result PIN batch", "public.saved_reports": "Saved report", "public.reports": "Report",
  "public.signature_requests": "Signature request", "public.statutory_returns": "Statutory return", "public.pt_conferences": "Parent-teacher conference",
  "public.fundraising_campaigns": "Fundraising campaign", "public.shop_items": "Shop item", "public.consent_purposes": "Consent purpose",
  "public.immunisations": "Immunisation", "public.attendance_devices": "Attendance device", "public.visitors": "Visitor",
  "public.qa_checklists": "Observation checklist", "public.rubrics": "Rubric",
  "live.lessons": "Live lesson", "live.lesson_media": "Lesson media", "live.media_folders": "Media folder", "live.rubrics": "Rubric",
  "live.assignments": "Lesson assignment", "live.student_groups": "Student group", "live.scenes": "Classroom scene"
};

export function kindOf(schema: string, table: string): string {
  const k = KIND[`${schema}.${table}`];
  if (k) return k;
  const t = table.replace(/_/g, " ").replace(/s$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Where each kind of record keeps its uploaded files. */
const FILES: Record<string, { bucket: string; column: string; many?: boolean }> = {
  "public.school_documents": { bucket: "school-documents", column: "path" },
  "public.student_documents": { bucket: "student-documents", column: "path" },
  "public.staff_documents": { bucket: "staff-documents", column: "path" },
  "public.portfolio_items": { bucket: "student-documents", column: "path" },
  "public.staff_achievements": { bucket: "student-documents", column: "photo_path" },
  "public.job_applications": { bucket: "job-applications", column: "cv_path" },
  "public.class_story_posts": { bucket: "class-story", column: "photos", many: true },
  "public.library_books": { bucket: "library-digital", column: "digital_path" },
  "live.lesson_media": { bucket: "live-lesson-media", column: "storage_path" }
};

export type BinRow = { schema_name: string; table_name: string; op: string; data: Record<string, any> };

/**
 * The stored files that belong to kept rows, by bucket, and the learning-content packages
 * whose files go with them. Only this school's files (paths under its own folder).
 */
export function filesOf(rows: BinRow[], tenantId: string): { buckets: Record<string, string[]>; packages: { id: string; paths: string[] }[] } {
  const buckets: Record<string, string[]> = {};
  const packages: { id: string; paths: string[] }[] = [];
  const mine = (p: unknown): p is string => typeof p === "string" && p.startsWith(`${tenantId}/`) && !p.includes("..");
  for (const r of rows) {
    if (r.op !== "delete") continue;
    const key = `${r.schema_name}.${r.table_name}`;
    if (key === "public.content_packages") {
      if (r.data?.tenant_id !== tenantId || typeof r.data?.id !== "string") continue;
      const paths = (Array.isArray(r.data.files) ? r.data.files : []).map((f: any) => f?.p).filter((p: unknown): p is string => typeof p === "string" && !p.includes(".."));
      if (paths.length) packages.push({ id: r.data.id, paths });
      continue;
    }
    const f = FILES[key];
    if (!f) continue;
    const v = r.data?.[f.column];
    const list = (f.many ? (Array.isArray(v) ? v : []) : [v]).filter(mine);
    if (list.length) (buckets[f.bucket] ??= []).push(...list);
  }
  for (const b of Object.keys(buckets)) buckets[b] = [...new Set(buckets[b])];
  return { buckets, packages };
}

/** One deletion as the bin shows it. */
export type BinEntry = {
  batch: string; deleted_at: string; expires_at: string; who: string;
  items: { kind: string; label: string }[]; more: number; linked: number; unlinked: number;
};

/** Turns the database's list into what the page shows. */
export function toEntries(rows: { batch: string; deleted_at: string; actor_id: string | null; actor: string; items: { schema: string; table: string; label: string }[]; linked: number; unlinked: number }[],
  names: Map<string, string>): BinEntry[] {
  return rows.map(r => {
    const items = (r.items ?? []).map(i => ({ kind: kindOf(i.schema, i.table), label: i.label || "Untitled" }));
    return {
      batch: r.batch, deleted_at: r.deleted_at,
      expires_at: new Date(Date.parse(r.deleted_at) + KEEP_DAYS * 86_400_000).toISOString(),
      who: r.actor_id ? names.get(r.actor_id) ?? "Former user" : /^guardian:/.test(r.actor) ? "A parent" : r.actor === "public" ? "Public page" : "System",
      items: items.slice(0, 20), more: Math.max(0, items.length - 20), linked: r.linked ?? 0, unlinked: r.unlinked ?? 0
    };
  });
}
