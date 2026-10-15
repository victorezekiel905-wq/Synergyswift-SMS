import { enqueue, staffRows, loadBrand, type OutboxRow } from "@/lib/messaging/outbox";
import { communityNote } from "@/lib/messaging/notices";
import { holidayDates } from "@/lib/attendance-server";
import { leaveBalances, DEFAULT_TEMPLATES, materialise, type LeavePolicy, type Taken } from "@/lib/hr";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** School holidays (from the calendar, in the school's time zone) and the days the school works. */
export async function workingCalendar(svc: any, tenantId: string, from: string, to: string, timeZone: string) {
  const [holidays, { data }] = await Promise.all([
    holidayDates(svc, tenantId, from, to, timeZone),
    svc.from("tenant_settings").select("school_weekdays").eq("tenant_id", tenantId).maybeSingle()
  ]);
  return { holidays: new Set<string>(holidays), weekdays: (data?.school_weekdays?.length ? data.school_weekdays : [1, 2, 3, 4, 5]) as number[] };
}

export async function leavePolicies(svc: any, tenantId: string): Promise<LeavePolicy[]> {
  const { data } = await svc.from("leave_policies").select("leave_type,days_per_year,paid,carry_over_max,needs_document,min_notice_days").eq("tenant_id", tenantId);
  return (data ?? []) as LeavePolicy[];
}

/** One person's balances for the leave year that contains `today`. */
export async function balancesFor(svc: any, tenantId: string, staffId: string, today: string, policies?: LeavePolicy[]) {
  const [{ data: s }, { data: reqs }, pols] = await Promise.all([
    svc.from("staff").select("leave_allowance").eq("tenant_id", tenantId).eq("id", staffId).maybeSingle(),
    svc.from("leave_requests").select("leave_type,days,status,starts_on").eq("tenant_id", tenantId).eq("staff_id", staffId)
      .gte("starts_on", `${Number(today.slice(0, 4)) - 2}-01-01`),
    policies ? Promise.resolve(policies) : leavePolicies(svc, tenantId)
  ]);
  return leaveBalances({ policies: pols, annualAllowance: Number(s?.leave_allowance ?? 20), requests: (reqs ?? []) as Taken[], today });
}

/** Approved leave appears in the cover planner as an absence; cancelled or rejected leave comes out again. */
export async function syncAbsence(svc: any, tenantId: string, leaveId: string, actor: string | null) {
  const { data: l } = await svc.from("leave_requests").select("id,status,starts_on,ends_on,leave_type,staff(user_id)").eq("tenant_id", tenantId).eq("id", leaveId).maybeSingle();
  if (!l) return;
  if (l.status === "approved" && l.staff?.user_id) {
    await svc.from("staff_absences").upsert({ tenant_id: tenantId, user_id: l.staff.user_id, starts_on: l.starts_on, ends_on: l.ends_on,
      reason: `${l.leave_type} leave`, recorded_by: actor, leave_request_id: l.id }, { onConflict: "leave_request_id" });
  } else {
    await svc.from("staff_absences").delete().eq("tenant_id", tenantId).eq("leave_request_id", l.id);
  }
}

/** Users who decide leave (HR managers, then admins if the school has no HR manager). */
export async function leaveDeciders(svc: any, tenantId: string): Promise<string[]> {
  const { data } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", tenantId).eq("active", true);
  const has = (u: any, r: string) => u.role === r || (u.extra_roles ?? []).includes(r);
  const hr = (data ?? []).filter((u: any) => has(u, "hr_manager")).map((u: any) => u.id);
  return hr.length ? hr : (data ?? []).filter((u: any) => has(u, "school_admin") || has(u, "principal")).map((u: any) => u.id);
}

/** In-app/email note to staff members by user id. */
export async function tellStaff(svc: any, tenantId: string, userIds: string[], kind: string, subject: string, text: string, url: string, refId?: string) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  const rows = await staffRows(svc, { tenantId, userIds: ids, kind, subject, text, url, refId: refId ?? null });
  if (rows.length) await enqueue(svc, rows);
}

/** An email to someone outside the school (a job candidate), in the school's style. */
export async function emailPerson(svc: any, tenantId: string, p: { email: string; name: string; subject: string; lines: string[]; link?: string | null; linkLabel?: string; kind: string; refId?: string }) {
  if (!EMAIL.test(p.email.trim())) return;
  const brand = await loadBrand(svc, tenantId);
  const m = communityNote(brand, { name: p.name, subject: p.subject, lines: p.lines, link: p.link ?? null, linkLabel: p.linkLabel });
  const row: OutboxRow = { tenant_id: tenantId, channel: "email", to_address: p.email.trim(), to_name: p.name, kind: p.kind, subject: m.subject,
    body_text: m.text, body_html: m.html, ref_id: p.refId ?? null };
  await enqueue(svc, [row]);
}

/** The school's checklist templates, with the starter ones added on first use. */
export async function ensureTemplates(svc: any, tenantId: string) {
  const { data } = await svc.from("hr_checklist_templates").select("id,kind,name,items").eq("tenant_id", tenantId).order("name");
  if (data?.length) return data;
  await svc.from("hr_checklist_templates").insert(DEFAULT_TEMPLATES.map(t => ({ tenant_id: tenantId, kind: t.kind, name: t.name, items: t.items })));
  const { data: again } = await svc.from("hr_checklist_templates").select("id,kind,name,items").eq("tenant_id", tenantId).order("name");
  return again ?? [];
}

/** Starts an onboarding or offboarding checklist for someone from a template, and tells each item's owners. */
export async function startChecklist(svc: any, tenantId: string, p: { staffId: string; kind: "onboarding" | "offboarding"; templateId?: string | null; startedOn: string; actor: string | null; baseUrl: string }) {
  const templates = await ensureTemplates(svc, tenantId);
  const t = templates.find((x: any) => x.id === p.templateId) ?? templates.find((x: any) => x.kind === p.kind);
  if (!t || t.kind !== p.kind) throw new Error(`no ${p.kind} checklist template`);
  const { data: open } = await svc.from("staff_checklists").select("id").eq("tenant_id", tenantId).eq("staff_id", p.staffId).eq("kind", p.kind).is("completed_at", null).limit(1);
  if (open?.length) throw new Error(`an ${p.kind} checklist is already under way for this person`);
  const { data: list, error } = await svc.from("staff_checklists").insert({ tenant_id: tenantId, staff_id: p.staffId, kind: p.kind, name: t.name, started_on: p.startedOn, created_by: p.actor })
    .select("id").single();
  if (error) throw new Error(error.message);
  const items = materialise(t.items ?? [], p.startedOn);
  if (items.length) {
    const ins = await svc.from("staff_checklist_items").insert(items.map(i => ({ ...i, tenant_id: tenantId, checklist_id: list.id })));
    if (ins.error) throw new Error(ins.error.message);
  }
  // Owners hear about their items.
  const { data: s } = await svc.from("staff").select("full_name,user_id,line_manager_id").eq("id", p.staffId).maybeSingle();
  const roles = [...new Set(items.map(i => i.owner).filter(o => o !== "staff" && o !== "line_manager"))];
  const { data: users } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", tenantId).eq("active", true);
  const owners = (users ?? []).filter((u: any) => roles.some(r => u.role === r || (u.extra_roles ?? []).includes(r))).map((u: any) => u.id);
  if (items.some(i => i.owner === "line_manager") && s?.line_manager_id) {
    const { data: m } = await svc.from("staff").select("user_id").eq("id", s.line_manager_id).maybeSingle();
    if (m?.user_id) owners.push(m.user_id);
  }
  if (items.some(i => i.owner === "staff") && s?.user_id && p.kind === "onboarding") owners.push(s.user_id);
  await tellStaff(svc, tenantId, owners.filter((id: string) => id !== p.actor), `hr_${p.kind}`, `${p.kind === "onboarding" ? "Onboarding" : "Offboarding"}: ${s?.full_name ?? "staff"}`,
    `There are ${p.kind} tasks for ${s?.full_name ?? "a member of staff"} for you to tick off.`, `${p.baseUrl}/school/hr?tab=checklists`, list.id);
  return list.id as string;
}

/** Turns a successful candidate into a member of staff: record, CV on file, onboarding started. */
export async function hireApplicant(svc: any, tenantId: string, p: { applicationId: string; staffNo: string; position?: string | null; department?: string | null;
  hireDate: string; employmentType: string; actor: string | null; baseUrl: string; startOnboarding: boolean }) {
  const { data: a } = await svc.from("job_applications").select("id,full_name,email,phone,cv_path,stage,posting_id,internal_staff_id,job_postings(title,department,positions)")
    .eq("tenant_id", tenantId).eq("id", p.applicationId).maybeSingle();
  if (!a) throw new Error("application not found");
  if (a.stage !== "offer") throw new Error("make the candidate an offer first");
  let staffId = a.internal_staff_id as string | null;
  if (staffId) {
    await svc.from("staff").update({ position: p.position ?? a.job_postings?.title ?? null, department: p.department ?? a.job_postings?.department ?? null }).eq("id", staffId);
  } else {
    const { data: st, error } = await svc.from("staff").insert({ tenant_id: tenantId, staff_no: p.staffNo, full_name: a.full_name, email: a.email, phone: a.phone,
      position: p.position ?? a.job_postings?.title ?? null, department: p.department ?? a.job_postings?.department ?? null, hire_date: p.hireDate,
      employment_type: p.employmentType, status: "active" }).select("id").single();
    if (error) throw new Error(error.message.includes("duplicate") ? "that staff number is already used" : error.message);
    staffId = st.id as string;
  }
  if (a.cv_path) {
    const dl = await svc.storage.from("job-applications").download(a.cv_path);
    if (!dl.error && dl.data) {
      const ext = String(a.cv_path).split(".").pop();
      const path = `${tenantId}/${staffId}/cv-${Date.now()}.${ext}`;
      const up = await svc.storage.from("staff-documents").upload(path, Buffer.from(await dl.data.arrayBuffer()), { contentType: dl.data.type || "application/pdf" });
      if (!up.error) await svc.from("staff_documents").insert({ tenant_id: tenantId, staff_id: staffId, kind: "cv", title: `CV (application for ${a.job_postings?.title ?? "post"})`, path, mime: dl.data.type, size_bytes: dl.data.size, uploaded_by: p.actor });
    }
  }
  await svc.from("job_applications").update({ stage: "hired", hired_staff_id: staffId, stage_changed_at: new Date().toISOString() }).eq("id", a.id);
  // Close the posting once every place is filled.
  const { count } = await svc.from("job_applications").select("id", { count: "exact", head: true }).eq("posting_id", a.posting_id).eq("stage", "hired");
  if ((count ?? 0) >= Number(a.job_postings?.positions ?? 1)) await svc.from("job_postings").update({ status: "filled" }).eq("id", a.posting_id).eq("status", "open");
  let checklistId: string | null = null;
  if (p.startOnboarding && !a.internal_staff_id) checklistId = await startChecklist(svc, tenantId, { staffId, kind: "onboarding", startedOn: p.hireDate, actor: p.actor, baseUrl: p.baseUrl }).catch(() => null);
  return { staffId, checklistId };
}
