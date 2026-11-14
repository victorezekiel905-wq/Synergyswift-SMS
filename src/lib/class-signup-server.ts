/**
 * Class sign-up codes on the server (migration 10300). Service client only; callers authorise first.
 * A student who signs up with a class code has a sign-in but no profile: nothing opens until the
 * class teacher or an admin confirms them.
 */
import { randomBytes } from "crypto";
import { checkPassword } from "./security";
import { cleanCode, formatCode, isCodeShape } from "./sign-up-codes";
import { policyFor } from "./sign-up-codes-server";
import { loginEmailFor } from "./login-name";
import { isFullName, splitName } from "./class-signup";
import { studentName } from "./school";

type Svc = any;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const USERNAME = /^[a-z0-9][a-z0-9.]{2,29}$/;
/** Most requests one class can have waiting (stops a leaked code filling the list). */
const MAX_WAITING = 150;

export const classCodesNeedUpdate = (m: string) => /class_signup_codes|class_signups|issue_class_code/.test(m);

export type ClassCodeInfo = { classId: string; tenantId: string; className: string; school: string };

/** The class a live class code belongs to. Null when there is none (or the school is closed). */
export async function classCodeInfo(svc: Svc, code: string): Promise<ClassCodeInfo | null> {
  if (!isCodeShape(code)) return null;
  const { data: c, error } = await svc.from("class_signup_codes").select("class_group_id,tenant_id,class_groups(name),tenants(name,status)").eq("code", cleanCode(code)).maybeSingle();
  if (error || !c || c.tenants?.status !== "active") return null;
  const { data: s, error: sErr } = await svc.from("tenant_settings").select("school_name,class_signup_enabled").eq("tenant_id", c.tenant_id).maybeSingle();
  // Students sign up with their own code; a class code works only when the school has turned class codes on.
  if (sErr || !s?.class_signup_enabled) return null;
  return { classId: c.class_group_id, tenantId: c.tenant_id, className: c.class_groups?.name ?? "your class", school: s?.school_name ?? c.tenants?.name ?? "your school" };
}

/**
 * Makes the sign-in and the waiting request. The student chooses a username (or types an
 * email) and their own password; the account opens when the class teacher confirms them.
 */
export async function signUpWithClassCode(svc: Svc, p: { code: string; login: string; password: string; fullName: string }) {
  const info = await classCodeInfo(svc, p.code);
  if (!info) return { ok: false as const, status: 400, error: "That code is not right. Check it with your class teacher." };
  const fullName = p.fullName.trim().replace(/\s+/g, " ");
  if (!isFullName(fullName)) return { ok: false as const, status: 400, error: "Type your full name: your first name and your surname, as the school has them." };
  let email = p.login.trim().toLowerCase();
  let username: string | null = null;
  if (!email.includes("@")) {
    if (!USERNAME.test(email)) return { ok: false as const, status: 400, error: "Choose a username of 3 to 30 small letters, numbers or dots, with no spaces (for example ada.obi7). Or type an email address." };
    const { data: taken } = await svc.from("users").select("id").ilike("username", email).limit(1);
    if (taken?.length) return { ok: false as const, status: 409, error: "That username is taken. Try another, for example with a number at the end." };
    username = email;
    email = loginEmailFor(username);
  }
  if (!EMAIL.test(email)) return { ok: false as const, status: 400, error: "Choose a username. It is what you sign in with." };
  const problems = checkPassword(p.password, await policyFor(svc, info.tenantId), { email: username ?? email, name: fullName });
  if (problems.length) return { ok: false as const, status: 400, error: `Please ${problems.join(", ")}.` };
  const { count } = await svc.from("class_signups").select("id", { count: "exact", head: true }).eq("class_group_id", info.classId).eq("status", "pending");
  if ((count ?? 0) >= MAX_WAITING) return { ok: false as const, status: 429, error: "Too many students are waiting for this class already. Ask your class teacher to confirm them first." };

  const { data: made, error } = await svc.auth.admin.createUser({ email, password: p.password, email_confirm: true, user_metadata: { full_name: fullName, signup_as: "class_student" } });
  if (error || !made?.user) {
    if (/already|exists|registered/i.test(error?.message ?? "")) return { ok: false as const, status: 409, error: username ? "That username is taken. Try another, for example with a number at the end." : "This email already has an account. Sign in instead." };
    return { ok: false as const, status: 502, error: "We couldn't make the account just now. Please try again." };
  }
  const { error: rErr } = await svc.from("class_signups").insert({ tenant_id: info.tenantId, class_group_id: info.classId, user_id: made.user.id, full_name: fullName, username, email });
  if (rErr) {
    await svc.auth.admin.deleteUser(made.user.id);
    return { ok: false as const, status: 400, error: classCodesNeedUpdate(rErr.message) ? "Class codes need the database update (migration 20260101010300)." : "We couldn't make the account just now. Please try again." };
  }
  return { ok: true as const, email, username, school: info.school, className: info.className, tenantId: info.tenantId, classId: info.classId, userId: made.user.id as string };
}

/** Tells the class teacher (or, with none, the school's admins) that a student is waiting. */
export async function classSignupNotice(svc: Svc, p: { tenantId: string; classId: string; className: string; studentName: string; baseUrl: string }) {
  const { data: cls } = await svc.from("class_groups").select("form_teacher_id").eq("id", p.classId).maybeSingle();
  let to: string[] = cls?.form_teacher_id ? [cls.form_teacher_id] : [];
  if (!to.length) {
    const { data: admins } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", p.tenantId).eq("active", true);
    to = (admins ?? []).filter((u: any) => ["school_admin", "principal"].some(r => u.role === r || (u.extra_roles ?? []).includes(r))).map((u: any) => u.id).slice(0, 10);
  }
  if (!to.length) return;
  const { tellStaff } = await import("./hr-server");
  await tellStaff(svc, p.tenantId, to, "class_signup", `${p.studentName || "A student"} is waiting to join ${p.className}`,
    `${p.studentName || "A student"} signed up with ${p.className}'s class code. Confirm them (or decline) under Teaching → My class codes.`,
    `${p.baseUrl}/school/class-codes`, p.classId);
}

/** Whether the school lets students sign up with their class's shared code. False before the database update. */
export async function classSignupEnabled(svc: Svc, tenantId: string): Promise<boolean> {
  const { data, error } = await svc.from("tenant_settings").select("class_signup_enabled").eq("tenant_id", tenantId).maybeSingle();
  return !error && Boolean(data?.class_signup_enabled);
}

export type ClassCode = { class_id: string; class_name: string; code: string | null };
export type WaitingSignup = { id: string; class_id: string; class_name: string | null; full_name: string; username: string | null; created_at: string };

/** These classes' codes and the students waiting to be confirmed. Null before the database update. */
export async function classCodesAndWaiting(svc: Svc, tenantId: string, classes: { id: string; name: string }[]): Promise<{ codes: ClassCode[]; waiting: WaitingSignup[] } | null> {
  if (!classes.length) return { codes: [], waiting: [] };
  const ids = classes.map(c => c.id);
  const [codes, waiting] = await Promise.all([
    svc.from("class_signup_codes").select("class_group_id,code").eq("tenant_id", tenantId).in("class_group_id", ids),
    svc.from("class_signups").select("id,class_group_id,full_name,username,email,created_at").eq("tenant_id", tenantId).eq("status", "pending").in("class_group_id", ids).order("created_at").limit(500)
  ]);
  if (codes.error || waiting.error) return null;
  const name = new Map(classes.map(c => [c.id, c.name]));
  return {
    codes: classes.map(c => ({ class_id: c.id, class_name: c.name, code: formatCode((codes.data ?? []).find((x: any) => x.class_group_id === c.id)?.code ?? "") || null })),
    waiting: (waiting.data ?? []).map((w: any) => ({ id: w.id, class_id: w.class_group_id, class_name: name.get(w.class_group_id) ?? null, full_name: w.full_name, username: w.username ?? w.email, created_at: w.created_at }))
  };
}

/**
 * Confirms a waiting student: matched to their record in that class (`studentId`), or added
 * as a new student (`studentId` null). Their account opens in that class.
 */
export async function approveSignup(svc: Svc, p: { tenantId: string; id: string; studentId: string | null; by: string }) {
  const { data: s } = await svc.from("class_signups").select("id,class_group_id,user_id,full_name,username,email,status").eq("tenant_id", p.tenantId).eq("id", p.id).maybeSingle();
  if (!s || s.status !== "pending") throw new Error("this request is no longer waiting");
  let student: { id: string; first_name: string; last_name: string; other_names?: string | null } | null = null;
  let made = false;
  if (p.studentId) {
    const { data } = await svc.from("students").select("id,first_name,last_name,other_names,user_id,class_group_id,status").eq("tenant_id", p.tenantId).eq("id", p.studentId).maybeSingle();
    if (!data || data.class_group_id !== s.class_group_id || data.status !== "active") throw new Error("choose a student in this class");
    if (data.user_id) throw new Error("that student already has an account; choose another, or decline this request");
    student = data;
  } else {
    const n = splitName(s.full_name);
    const { data, error } = await svc.from("students").insert({ tenant_id: p.tenantId, admission_no: `NEW-${randomBytes(4).toString("hex").toUpperCase()}`, first_name: n.first, last_name: n.last || n.first, class_group_id: s.class_group_id })
      .select("id,first_name,last_name,other_names").single();
    if (error || !data) throw new Error(error?.message ?? "could not add the student");
    student = data; made = true;
  }
  const undo = async () => { if (made && student) await svc.from("students").delete().eq("id", student.id); };
  const { error: uErr } = await svc.from("users").insert({ id: s.user_id, tenant_id: p.tenantId, email: s.email, full_name: studentName(student!), role: "student", ...(s.username ? { username: s.username } : {}) });
  if (uErr) { await undo(); throw new Error(/users_username/.test(uErr.message) ? "their username was taken in the meantime; decline this request and ask them to sign up again" : uErr.message); }
  const { data: linked } = await svc.from("students").update({ user_id: s.user_id }).eq("id", student!.id).is("user_id", null).select("id");
  if (!linked?.length) { await svc.from("users").delete().eq("id", s.user_id); await undo(); throw new Error("that student got an account a moment ago; choose another"); }
  // Their personal sign-up code is spent: the account exists now.
  await svc.from("account_codes").update({ used_at: new Date().toISOString(), used_by: s.user_id }).eq("kind", "student").eq("student_id", student!.id).is("revoked_at", null);
  await svc.from("class_signups").update({ status: "approved", student_id: student!.id, decided_by: p.by, decided_at: new Date().toISOString() }).eq("id", s.id);
  await svc.from("audit_logs").insert({ tenant_id: p.tenantId, actor_id: p.by, action: "account.class_signup_confirmed", target: s.user_id, meta: { student_id: student!.id, new_student: made, class_group_id: s.class_group_id } });
  return { student_id: student!.id, name: studentName(student!), new_student: made };
}

/** Declines a waiting student: the sign-in they made is removed (they can sign up again). */
export async function declineSignup(svc: Svc, p: { tenantId: string; id: string; by: string }) {
  const { data: s } = await svc.from("class_signups").select("id,user_id,full_name,status,class_group_id").eq("tenant_id", p.tenantId).eq("id", p.id).maybeSingle();
  if (!s || s.status !== "pending") throw new Error("this request is no longer waiting");
  const { error } = await svc.auth.admin.deleteUser(s.user_id);
  if (error) throw new Error("could not decline just now; please try again");
  await svc.from("class_signups").delete().eq("id", s.id);
  await svc.from("audit_logs").insert({ tenant_id: p.tenantId, actor_id: p.by, action: "account.class_signup_declined", meta: { name: s.full_name, class_group_id: s.class_group_id } });
  return { name: s.full_name as string };
}
