/**
 * Accounts that set themselves up (the "handshake"): every active student
 * gets a username login with a starting password, and the details go to
 * their parents; every parent gets an invitation (email) or their private
 * portal link (WhatsApp/SMS). Runs from the dispatch cron and can be run for
 * one student or parent from the school's pages. Service client only.
 */
import { usernameFor, startingPassword, studentKeyMessage } from "./accounts";
import { loginEmailFor } from "./login-name";
import { enqueue, loadBrand, rowsForGuardian } from "./messaging/outbox";
import { portalLink } from "./messaging/templates";
import { provisionUser } from "./provision";

type Svc = any;
const studentName = (s: { first_name: string; last_name: string }) => `${s.first_name} ${s.last_name}`.trim();

async function usernameTaken(svc: Svc, u: string) {
  const { data } = await svc.from("users").select("id").ilike("username", u).limit(1);
  return Boolean(data?.length);
}

/** Gives one student a username login (if they have none) and sends the details to their parents. */
export async function ensureStudentLogin(svc: Svc, studentId: string, baseUrl: string, actor: string | null = null) {
  const { data: s } = await svc.from("students").select("id,tenant_id,user_id,admission_no,first_name,last_name,status,tenants(slug,public_slug)").eq("id", studentId).maybeSingle();
  if (!s) throw new Error("student not found");
  if (s.user_id) return { created: false, username: null as string | null };
  const code = s.tenants?.public_slug || s.tenants?.slug || "school";
  const taken = new Set<string>();
  // Find a free username (checked against the database, a few at a time).
  let username = usernameFor(s, code, u => taken.has(u));
  while (await usernameTaken(svc, username)) { taken.add(username); username = usernameFor(s, code, u => taken.has(u)); }
  const password = startingPassword();
  const { data: created, error } = await svc.auth.admin.createUser({ email: loginEmailFor(username), password, email_confirm: true, user_metadata: { full_name: studentName(s) } });
  if (error || !created?.user) throw new Error(error?.message ?? "could not create the login");
  const userId = created.user.id;
  const { error: uErr } = await svc.from("users").insert({ id: userId, tenant_id: s.tenant_id, email: loginEmailFor(username), full_name: studentName(s), role: "student", username, must_change_password: true });
  if (uErr) { await svc.auth.admin.deleteUser(userId); throw new Error(uErr.message); }
  await svc.from("students").update({ user_id: userId, login_sent_at: new Date().toISOString() }).eq("id", s.id);
  // The details go to the parents (children usually have no email of their own).
  const { data: links } = await svc.from("student_guardians").select("guardians(id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,notify_sms)").eq("student_id", s.id);
  const brand = await loadBrand(svc, s.tenant_id);
  const rows = (links ?? []).flatMap((l: any) => l.guardians ? rowsForGuardian(s.tenant_id, l.guardians, "account_key",
    studentKeyMessage(brand, { guardianName: l.guardians.full_name, studentName: studentName(s), username, password, link: `${baseUrl}/login` }), s.id, actor)
    .map(r => ({ ...r, recipient_guardian_id: l.guardians.id })) : []);
  if (rows.length) await enqueue(svc, rows);
  await svc.from("audit_logs").insert({ tenant_id: s.tenant_id, actor_id: actor, action: "student.login_created", target: s.id, meta: { username, sent_to: rows.length } });
  return { created: true, username, password: rows.length ? null : password, sent: rows.length };
}

/** Resets a student's password to a new starting one and sends it to their parents. */
export async function resendStudentKey(svc: Svc, studentId: string, baseUrl: string, actor: string | null) {
  const { data: s } = await svc.from("students").select("id,tenant_id,user_id,first_name,last_name").eq("id", studentId).maybeSingle();
  if (!s?.user_id) return ensureStudentLogin(svc, studentId, baseUrl, actor);
  const { data: u } = await svc.from("users").select("username").eq("id", s.user_id).maybeSingle();
  if (!u?.username) throw new Error("this student signs in with an email address; use the password reset instead");
  const password = startingPassword();
  const { error } = await svc.auth.admin.updateUserById(s.user_id, { password });
  if (error) throw new Error(error.message);
  await svc.from("users").update({ must_change_password: true }).eq("id", s.user_id);
  const { data: links } = await svc.from("student_guardians").select("guardians(id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,notify_sms)").eq("student_id", s.id);
  const brand = await loadBrand(svc, s.tenant_id);
  const rows = (links ?? []).flatMap((l: any) => l.guardians ? rowsForGuardian(s.tenant_id, l.guardians, "account_key",
    studentKeyMessage(brand, { guardianName: l.guardians.full_name, studentName: studentName(s), username: u.username, password, link: `${baseUrl}/login` }), s.id, actor)
    .map(r => ({ ...r, recipient_guardian_id: l.guardians.id })) : []);
  if (rows.length) await enqueue(svc, rows);
  await svc.from("audit_logs").insert({ tenant_id: s.tenant_id, actor_id: actor, action: "student.login_reset", target: s.id, meta: { sent_to: rows.length } });
  return { username: u.username, password: rows.length ? null : password, sent: rows.length };
}

/** Invites one parent: an account invitation by email, or the private portal link by WhatsApp/SMS. */
export async function ensureGuardianInvite(svc: Svc, guardianId: string, baseUrl: string, actor: string | null = null) {
  const { data: g } = await svc.from("guardians").select("id,tenant_id,user_id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,notify_sms,portal_token,invited_at,student_guardians(students(first_name,last_name,status))").eq("id", guardianId).maybeSingle();
  if (!g) throw new Error("parent not found");
  const kids = (g.student_guardians ?? []).map((x: any) => x.students).filter((k: any) => k && k.status === "active");
  if (!kids.length) return { invited: false, reason: "no current children" };
  const names = kids.map(studentName).join(" and ");
  if (!g.user_id && g.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(g.email)) {
    const { userId } = await provisionUser(svc, { tenantId: g.tenant_id, email: g.email, fullName: g.full_name, role: "parent", redirectTo: `${baseUrl}/auth/welcome?next=/parent`, createdBy: actor });
    await svc.from("guardians").update({ user_id: userId, invited_at: new Date().toISOString() }).eq("id", g.id);
    return { invited: true, how: "email" };
  }
  // No email: the private portal link (they can also sign in with a code to their phone).
  const brand = await loadBrand(svc, g.tenant_id);
  const rows = rowsForGuardian(g.tenant_id, g, "portal_link", portalLink(brand, { guardianName: g.full_name, studentNames: names, link: `${baseUrl}/g/${g.portal_token}` }), g.id, actor)
    .map(r => ({ ...r, recipient_guardian_id: g.id }));
  if (!rows.length) return { invited: false, reason: "no email or phone" };
  await enqueue(svc, rows);
  await svc.from("guardians").update({ invited_at: new Date().toISOString() }).eq("id", g.id);
  return { invited: true, how: "link" };
}

/**
 * The cron's part: new students get logins, new parents get invited, for
 * schools that have the switches on. A few at a time so the run stays short.
 */
export async function runAccountAutomation(svc: Svc, baseUrl: string, limit = 25, onlyTenant: string | null = null) {
  const out = { student_logins: 0, parent_invites: 0, errors: 0 };
  let sq = svc.from("tenant_settings").select("tenant_id,auto_student_logins,auto_parent_invites").or("auto_student_logins.eq.true,auto_parent_invites.eq.true");
  if (onlyTenant) sq = sq.eq("tenant_id", onlyTenant);
  const { data: settings } = await sq;
  const active = new Set((await svc.from("tenants").select("id").eq("status", "active")).data?.map((t: { id: string }) => t.id) ?? []);
  const studentsOn = (settings ?? []).filter((s: any) => s.auto_student_logins && active.has(s.tenant_id)).map((s: any) => s.tenant_id);
  const parentsOn = (settings ?? []).filter((s: any) => s.auto_parent_invites && active.has(s.tenant_id)).map((s: any) => s.tenant_id);
  if (studentsOn.length) {
    const { data: kids } = await svc.from("students").select("id").in("tenant_id", studentsOn).eq("status", "active").is("user_id", null).is("login_sent_at", null).limit(limit);
    for (const k of kids ?? []) {
      try { await ensureStudentLogin(svc, k.id, baseUrl); out.student_logins++; }
      catch { out.errors++; await svc.from("students").update({ login_sent_at: new Date().toISOString() }).eq("id", k.id); } // do not retry forever
    }
  }
  if (parentsOn.length) {
    const { data: gs } = await svc.from("guardians").select("id").in("tenant_id", parentsOn).is("user_id", null).is("invited_at", null).limit(limit);
    for (const g of gs ?? []) {
      try { const r = await ensureGuardianInvite(svc, g.id, baseUrl); if (r.invited) out.parent_invites++; else await svc.from("guardians").update({ invited_at: new Date().toISOString() }).eq("id", g.id); }
      catch { out.errors++; await svc.from("guardians").update({ invited_at: new Date().toISOString() }).eq("id", g.id); }
    }
  }
  return out;
}
