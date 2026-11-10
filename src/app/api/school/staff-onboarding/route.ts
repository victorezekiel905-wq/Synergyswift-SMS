import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError, ROLES, STAFF_ROLE_OPTIONS, denyUnless } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { sendCodes } from "@/lib/sign-up-codes-server";
import { grantStaffAccess, rolesOutsidePlan, type AccessResult } from "@/lib/staff-access-server";
import { onboardingList, setStaffSubjects, nextStaffNo, setStaffClasses } from "@/lib/staff-onboarding-server";

export const dynamic = "force-dynamic";
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Staff onboarding for school admins: the school's subjects and everyone on the staff list with where they are. */
export async function GET() {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const tid = ctx.tenant.id;
  const [{ data: subjects }, { data: classes }, { data: offerings }, { data: users }, list] = await Promise.all([
    svc.from("subjects").select("id,name,code").eq("tenant_id", tid).order("name"),
    svc.from("class_groups").select("id,name,level,form_teacher_id").eq("tenant_id", tid).order("name"),
    svc.from("subject_offerings").select("class_group_id,subject_id,teacher_id").eq("tenant_id", tid),
    svc.from("users").select("id,full_name").eq("tenant_id", tid).not("role", "in", "(student,parent)"),
    onboardingList(svc, tid)
  ]);
  const roles = STAFF_ROLE_OPTIONS.filter(r => !rolesOutsidePlan(ctx, [r]).length);
  // Who teaches what now, so the page can say "replaces …".
  const names = new Map(((users ?? []) as any[]).map(u => [u.id, u.full_name]));
  const taken: Record<string, string> = {};
  for (const o of (offerings ?? []) as any[]) if (o.teacher_id) taken[`${o.class_group_id}:${o.subject_id}`] = names.get(o.teacher_id) ?? "someone";
  for (const c of (classes ?? []) as any[]) if (c.form_teacher_id) taken[`${c.id}:form`] = names.get(c.form_teacher_id) ?? "someone";
  return NextResponse.json({ subjects: subjects ?? [], classes: (classes ?? []).map((c: any) => ({ id: c.id, name: c.name, level: c.level })), taken, staff: list, roles });
}

const Method = z.enum(["code", "invite", "otp"]);
const Assignments = z.array(z.object({ class_group_id: z.string().uuid(), subject_id: z.string().uuid().nullable() })).max(200);
const Role = z.enum(STAFF_ROLE_OPTIONS);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("onboard"), full_name: z.string().trim().min(2).max(120), email: z.string().trim().max(254),
    staff_no: z.string().trim().max(40).nullish(), subject_ids: z.array(z.string().uuid()).max(60).default([]),
    role: Role.default("teacher"), extra_roles: z.array(Role).max(15).default([]), method: Method.default("invite"),
    phone: z.string().trim().max(30).nullish(), position: z.string().trim().max(80).nullish(), classes: Assignments.default([]) }),
  // The classes they teach: in place now if they have signed up, else as soon as they do.
  z.object({ action: z.literal("classes"), staff_id: z.string().uuid(), classes: Assignments }),
  // Someone still waiting: a fresh code, the invitation link, or a one-time password.
  z.object({ action: z.literal("resend"), staff_id: z.string().uuid(), method: Method, email: z.string().trim().max(254).nullish() }),
  z.object({ action: z.literal("subjects"), staff_id: z.string().uuid(), subject_ids: z.array(z.string().uuid()).max(60) })
]);

/** What the admin is told after a way in was given. */
function said(name: string, r: Extract<AccessResult, { ok: true }>, sent: number): string {
  if (r.otp) return `${name}'s login is ready. Username: ${r.otp.username} · One-time password: ${r.otp.password} (emailed to them; shown only now). They choose their own password at the first sign-in.`;
  if (r.invited) return `Invitation link emailed to ${r.email}. ${name} opens it and sets a password.`;
  if (r.code) return `${name}'s sign-up code is ${r.code}.${sent ? " It has been emailed to them." : ""} They make their account at /join with it.`;
  return "Saved.";
}

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".") || "form"}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  { const denied = denyUnless(ctx, "staff.roles"); if (denied) return denied; }

  if (b.action === "subjects") {
    const { data: s } = await svc.from("staff").select("id").eq("tenant_id", tid).eq("id", b.staff_id).maybeSingle();
    if (!s) return jsonError("staff not found", 404);
    const r = await setStaffSubjects(ctx.sb, tid, s.id, b.subject_ids);
    return r.error ? jsonError(r.error) : NextResponse.json({ ok: true });
  }

  if (b.action === "classes") {
    const r = await setStaffClasses(svc, { tenantId: tid, staffId: b.staff_id, actor: ctx.userId, want: b.classes });
    if (r.error) return jsonError(r.error);
    return NextResponse.json({ ok: true, message: r.applied ? "Classes saved." : "Classes saved. They are put in place the moment this person signs up." });
  }

  if (b.action === "resend") {
    const { data: s } = await svc.from("staff").select("id,full_name,email,user_id").eq("tenant_id", tid).eq("id", b.staff_id).maybeSingle();
    if (!s) return jsonError("staff not found", 404);
    if (s.user_id) return jsonError(`${s.full_name} has an account already. Change their roles in HR, or reset their password.`);
    // A record with no email (added before, or imported): the email typed now is kept on it.
    const typed = (b.email ?? "").trim().toLowerCase();
    if (typed && typed !== (s.email ?? "").toLowerCase()) {
      if (!EMAIL.test(typed)) return jsonError("Enter their email address.");
      const { data: taken } = await svc.from("users").select("id").eq("email", typed).limit(1);
      if (taken?.length) return jsonError("This email already has a Synergy Swift account. Use a different email.");
      await ctx.sb.from("staff").update({ email: typed }).eq("tenant_id", tid).eq("id", s.id);
      s.email = typed;
    }
    if (!s.email && b.method !== "code") return jsonError("Enter their email address first.");
    const { data: c } = await svc.from("account_codes").select("role,extra_roles").eq("tenant_id", tid).eq("kind", "staff").eq("staff_id", s.id).is("revoked_at", null).maybeSingle();
    const r = await grantStaffAccess(ctx, svc, req, { staff: s, role: c?.role ?? "teacher", extra: c?.extra_roles ?? [], method: b.method, email: b.email || s.email });
    if (!r.ok) return jsonError(r.error, r.status);
    const sent = r.code && s.email ? (await sendCodes(svc, { tenantId: tid, items: [{ kind: "staff", id: s.id }], baseUrl: appUrl(req), actor: ctx.userId })).messages : 0;
    return NextResponse.json({ ok: true, message: said(s.full_name, r, sent), otp: r.otp ?? null });
  }

  // Onboard: the staff record, the subjects they teach, then their way in.
  const email = b.email.toLowerCase();
  if (!EMAIL.test(email)) return jsonError("Enter their email address.");
  const outside = rolesOutsidePlan(ctx, [b.role, ...b.extra_roles]);
  if (outside.length) return jsonError(`your school's plan does not include: ${outside.join(", ")}`);
  const [{ data: onList }, { data: hasLogin }] = await Promise.all([
    svc.from("staff").select("full_name").eq("tenant_id", tid).ilike("email", email.replace(/[\\%_]/g, m => `\\${m}`)).limit(1),
    svc.from("users").select("id").eq("email", email).limit(1)
  ]);
  if (onList?.length) return jsonError(`${onList[0].full_name} already has this email on the staff list. Find them below or in HR.`);
  if (hasLogin?.length) return jsonError("This email already has a Synergy Swift account. Use a different email.");
  if (b.subject_ids.length) {
    const { data: ok } = await svc.from("subjects").select("id").eq("tenant_id", tid).in("id", b.subject_ids);
    if ((ok ?? []).length !== new Set(b.subject_ids).size) return jsonError("a subject chosen is not one of the school's subjects");
  }

  // The ID number is optional: one is made when it is left blank.
  let staff: { id: string; full_name: string; email: string | null; user_id: string | null; staff_no: string } | null = null;
  for (let attempt = 0; attempt < 4 && !staff; attempt++) {
    const staffNo = b.staff_no?.trim() || await nextStaffNo(svc, tid);
    const { data, error } = await ctx.sb.from("staff").insert({ tenant_id: tid, full_name: b.full_name, email, staff_no: staffNo, phone: b.phone || null, position: b.position || null })
      .select("id,full_name,email,user_id,staff_no").single();
    if (!error) { staff = data; break; }
    if (!error.message.includes("duplicate")) return jsonError(error.message);
    if (b.staff_no?.trim()) return jsonError(`ID number ${b.staff_no.trim()} is already used by someone else.`);
  }
  if (!staff) return jsonError("Could not make a staff number just now. Type one, or try again.");
  await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "staff.onboarded", target: staff.id, meta: { role: b.role, subjects: b.subject_ids.length, method: b.method } });

  const subj = b.subject_ids.length ? await setStaffSubjects(ctx.sb, tid, staff.id, b.subject_ids) : {};
  const r = await grantStaffAccess(ctx, svc, req, { staff, role: b.role, extra: b.extra_roles, method: b.method, email });
  // Classes chosen now: in place at once if the account was made (link, one-time password), else when they sign up.
  const cls = b.classes.length ? await setStaffClasses(svc, { tenantId: tid, staffId: staff.id, actor: ctx.userId, want: b.classes }) : null;
  const note = (subj.error ? ` (Subjects were not saved: ${subj.error}.)` : "") + (cls?.error ? ` (Classes were not saved: ${cls.error}. Choose them again from the list.)` : "");
  if (!r.ok) {
    return NextResponse.json({ ok: true, staff_id: staff.id, staff_no: staff.staff_no, access_error: r.error,
      message: `${staff.full_name} is on the staff list (ID ${staff.staff_no}), but their sign-in was not made: ${r.error}. Try again from the list below.${note}` });
  }
  const sent = r.code ? (await sendCodes(svc, { tenantId: tid, items: [{ kind: "staff", id: staff.id }], baseUrl: appUrl(req), actor: ctx.userId })).messages : 0;
  return NextResponse.json({ ok: true, staff_id: staff.id, staff_no: staff.staff_no, otp: r.otp ?? null, message: `${staff.full_name} added (ID ${staff.staff_no}). ${said(staff.full_name, r, sent)}${note}` });
}
