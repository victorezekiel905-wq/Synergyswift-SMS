/**
 * Sign-up codes and one-time passwords on the server (migration 9600). Service client only;
 * callers authorise first.
 */
import { createHash } from "crypto";
import { startingPassword } from "./accounts";
import { checkPassword, type PasswordPolicy } from "./security";
import { cleanCode, formatCode, isCodeShape, homeFor, type CodeKind } from "./sign-up-codes";
import { enqueue, loadBrand, rowsForGuardian, tryDispatch, type OutboxRow } from "./messaging/outbox";
import { communityNote } from "./messaging/notices";
import { normalizePhone, smsText } from "./messaging/providers";
import { fetchAll } from "./fetch-all";

type Svc = any;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TRIES = { windowMin: 15, perAddress: 20, perCode: 8 };

/** Wrong guesses are limited per address and per code (the table keeps a day). */
export async function codeTriesExceeded(svc: Svc, ip: string, code: string): Promise<boolean> {
  const since = new Date(Date.now() - TRIES.windowMin * 60_000).toISOString();
  const ipKey = `ip:${createHash("sha256").update(ip).digest("hex").slice(0, 24)}`, codeKey = `code:${cleanCode(code)}`;
  const [{ count: a }, { count: b }] = await Promise.all([
    svc.from("account_code_tries").select("id", { count: "exact", head: true }).eq("key", ipKey).gte("at", since),
    svc.from("account_code_tries").select("id", { count: "exact", head: true }).eq("key", codeKey).gte("at", since)
  ]);
  return (a ?? 0) >= TRIES.perAddress || (b ?? 0) >= TRIES.perCode;
}
export async function recordCodeTry(svc: Svc, ip: string, code: string) {
  const ipKey = `ip:${createHash("sha256").update(ip).digest("hex").slice(0, 24)}`;
  await svc.from("account_code_tries").insert([{ key: ipKey }, { key: `code:${cleanCode(code)}` }]);
  await svc.from("account_code_tries").delete().lt("at", new Date(Date.now() - 86_400_000).toISOString());
}

export type CodeInfo = { kind: CodeKind; tenantId: string; school: string; name: string | null; role: string; childName: string | null };

/** What a live code is for: the school, the person (first name only) and the account it makes. Null when it can't be used. */
export async function codeInfo(svc: Svc, code: string): Promise<CodeInfo | null> {
  if (!isCodeShape(code)) return null;
  const { data: c } = await svc.from("account_codes")
    .select("kind,tenant_id,role,uses,max_uses,used_at,revoked_at,staff(full_name,user_id),students(first_name,last_name,user_id),guardians(full_name,user_id),tenants(name,status)")
    .eq("code", cleanCode(code)).maybeSingle();
  if (!c || c.revoked_at || c.used_at || c.uses >= c.max_uses || c.tenants?.status !== "active") return null;
  const owner = c.kind === "staff" ? c.staff : c.kind === "guardian" ? c.guardians : c.kind === "student" ? c.students : null;
  if (owner?.user_id) return null;
  const { data: s } = await svc.from("tenant_settings").select("school_name").eq("tenant_id", c.tenant_id).maybeSingle();
  const first = (n?: string | null) => (n ?? "").trim().split(/\s+/)[0] || null;
  return {
    kind: c.kind, tenantId: c.tenant_id, school: s?.school_name ?? c.tenants?.name ?? "your school",
    name: c.kind === "staff" ? first(c.staff?.full_name) : c.kind === "guardian" ? first(c.guardians?.full_name) : c.kind === "student" ? first(c.students?.first_name) : null,
    role: c.kind === "staff" ? (c.role ?? "teacher") : c.kind === "student" ? "student" : "parent",
    childName: c.kind === "parent_link" ? first(c.students?.first_name) : null
  };
}

/** The school's password rules, for whoever is joining (staff rules apply to staff). */
export async function policyFor(svc: Svc, tenantId: string): Promise<Partial<PasswordPolicy>> {
  const { data: s } = await svc.from("tenant_settings").select("password_min_length,password_require_mixed_case,password_require_number,password_require_symbol").eq("tenant_id", tenantId).maybeSingle();
  return s ? { min_length: s.password_min_length, require_mixed_case: s.password_require_mixed_case, require_number: s.password_require_number, require_symbol: s.password_require_symbol } : {};
}

/**
 * Makes an account with a code: the email is the username, the password the person's own.
 * The sign-in is made first, then the code is claimed in one locked step; if that fails the
 * sign-in is removed again, so a refused code never leaves a half-made account.
 */
export async function signUpWithCode(svc: Svc, p: { code: string; email: string; password: string; fullName?: string | null }) {
  const info = await codeInfo(svc, p.code);
  if (!info) return { ok: false as const, status: 400, error: "That code is not right, or it has been used. Check it, or ask the school for a new one." };
  const email = p.email.trim().toLowerCase();
  if (!EMAIL.test(email)) return { ok: false as const, status: 400, error: "Enter your email address. It is what you sign in with." };
  const problems = checkPassword(p.password, await policyFor(svc, info.tenantId), { email, name: p.fullName ?? info.name });
  if (problems.length) return { ok: false as const, status: 400, error: `Please ${problems.join(", ")}.` };
  const { data: made, error } = await svc.auth.admin.createUser({ email, password: p.password, email_confirm: true, user_metadata: { full_name: p.fullName ?? info.name ?? undefined } });
  if (error || !made?.user) {
    if (/already|exists|registered/i.test(error?.message ?? "")) {
      return { ok: false as const, status: 409, error: info.kind === "parent_link"
        ? "This email already has an account. Sign in, then add your child with this code on your page."
        : "This email already has an account. Sign in instead, or use a different email." };
    }
    return { ok: false as const, status: 502, error: "We couldn't make the account just now. Please try again." };
  }
  const { data: r, error: cErr } = await svc.rpc("claim_account_code", { p_code: cleanCode(p.code), p_user: made.user.id, p_email: email, p_full_name: p.fullName ?? null });
  if (cErr) {
    await svc.auth.admin.deleteUser(made.user.id);
    return { ok: false as const, status: 400, error: cErr.message.includes("does not exist") ? "Sign-up codes need the database update (migration 20260101009600)." : cErr.message };
  }
  return { ok: true as const, email, role: r.role as string, next: (r.next as string) ?? homeFor(r.role), school: info.school };
}

/** Kinds of people a one-time password can be made for, and their tables. */
const PERSON: Record<"staff" | "student" | "guardian", { table: string; name: string }> = {
  staff: { table: "staff", name: "full_name" }, student: { table: "students", name: "first_name,last_name" }, guardian: { table: "guardians", name: "full_name" }
};

/**
 * The second way in: a login made with the person's email and a one-time password. They must
 * choose their own password at the first sign-in. The password goes to them (and, for a
 * student, to their parents) and is returned once for the school to hand over.
 */
export async function createOneTimeLogin(svc: Svc, p: { tenantId: string; kind: "staff" | "student" | "guardian"; id: string; email: string; actor: string; baseUrl: string }) {
  const email = p.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error("enter a valid email address: it becomes their username");
  const t = PERSON[p.kind];
  const { data: rec } = await svc.from(t.table).select(`id,user_id,${t.name}`).eq("tenant_id", p.tenantId).eq("id", p.id).maybeSingle();
  if (!rec) throw new Error("not found");
  if (rec.user_id) throw new Error("this person already has an account; reset their password instead");
  const name = p.kind === "student" ? `${rec.first_name} ${rec.last_name}`.trim() : rec.full_name;
  const { data: taken } = await svc.from("users").select("id").eq("email", email).limit(1);
  if (taken?.length) throw new Error("this email already has an account; use a different email");
  // Staff get the role chosen for their code (teacher until an admin sets one).
  const { data: code } = await svc.from("account_codes").select("role,extra_roles").eq("kind", p.kind).eq(`${p.kind === "guardian" ? "guardian" : p.kind}_id`, p.id).is("revoked_at", null).maybeSingle();
  const role = p.kind === "staff" ? (code?.role ?? "teacher") : p.kind === "student" ? "student" : "parent";
  const password = startingPassword();
  const { data: made, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error || !made?.user) throw new Error(/already|exists|registered/i.test(error?.message ?? "") ? "this email already has an account; use a different email" : "could not make the login just now");
  const uid = made.user.id;
  const { error: uErr } = await svc.from("users").insert({ id: uid, tenant_id: p.tenantId, email, full_name: name, role, extra_roles: p.kind === "staff" ? (code?.extra_roles ?? []) : [], must_change_password: true });
  if (uErr) { await svc.auth.admin.deleteUser(uid); throw new Error(uErr.message); }
  await svc.from(t.table).update({ user_id: uid, ...(p.kind !== "student" ? { email } : {}) }).eq("id", p.id);
  // Their personal code is spent: the account exists now.
  await svc.from("account_codes").update({ used_at: new Date().toISOString(), used_by: uid }).eq("kind", p.kind).eq(`${p.kind === "guardian" ? "guardian" : p.kind}_id`, p.id).is("revoked_at", null);
  await svc.from("audit_logs").insert({ tenant_id: p.tenantId, actor_id: p.actor, action: "account.one_time_password_created", target: uid, meta: { kind: p.kind, role } });

  const brand = await loadBrand(svc, p.tenantId);
  const lines = [`Your ${brand.schoolName} account is ready.`, `Username: ${email}`, `One-time password: ${password}`,
    "Sign in with these, then choose your own password. The one-time password stops working once you do."];
  const note = communityNote(brand, { name, subject: `Your ${brand.schoolName} sign-in`, lines, link: `${p.baseUrl}/login`, linkLabel: "Sign in" });
  const rows: OutboxRow[] = [{ tenant_id: p.tenantId, channel: "email", to_address: email, to_name: name, kind: "account_key", subject: note.subject, body_text: note.text, body_html: note.html, ref_id: uid, created_by: p.actor }];
  if (p.kind === "student") {
    const { data: links } = await svc.from("student_guardians").select("guardians(id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,notify_sms)").eq("student_id", p.id);
    for (const l of links ?? []) if (l.guardians) rows.push(...rowsForGuardian(p.tenantId, l.guardians, "account_key",
      communityNote(brand, { name: l.guardians.full_name, subject: `${name}'s ${brand.schoolName} sign-in`, lines: [`${name}'s account is ready.`, ...lines.slice(1)], link: `${p.baseUrl}/login`, linkLabel: "Sign in" }), uid, p.actor));
  }
  await enqueue(svc, rows);
  await tryDispatch(svc, { budgetMs: 6000 }).catch(() => null);
  return { username: email, password, sent: rows.length };
}

export type CodeRow = { kind: CodeKind; id: string; name: string; detail: string | null; code: string | null; role: string | null; extra_roles: string[];
  uses: number; max_uses: number; has_account: boolean; email: string | null; phone: string | null };

/** Everyone's codes for the school's page: people without accounts, and every student's parent code. */
export async function listCodes(svc: Svc, tenantId: string): Promise<CodeRow[]> {
  const [codes, staff, students, guardians, classes] = await Promise.all([
    fetchAll<any>(() => svc.from("account_codes").select("kind,staff_id,student_id,guardian_id,code,role,extra_roles,uses,max_uses,used_at").eq("tenant_id", tenantId).is("revoked_at", null).order("id")),
    fetchAll<any>(() => svc.from("staff").select("id,full_name,email,phone,position,user_id,status").eq("tenant_id", tenantId).neq("status", "exited").order("id")),
    fetchAll<any>(() => svc.from("students").select("id,first_name,last_name,admission_no,class_group_id,user_id").eq("tenant_id", tenantId).eq("status", "active").order("id")),
    fetchAll<any>(() => svc.from("guardians").select("id,full_name,email,phone,user_id").eq("tenant_id", tenantId).order("id")),
    svc.from("class_groups").select("id,name").eq("tenant_id", tenantId).then((r: any) => r.data ?? [])
  ]);
  const by = (kind: string, id: string) => codes.find((c: any) => c.kind === kind && (c.staff_id ?? c.student_id ?? c.guardian_id) === id);
  const cls = new Map(classes.map((c: any) => [c.id, c.name]));
  const row = (kind: CodeKind, id: string, name: string, detail: string | null, hasAccount: boolean, email: string | null, phone: string | null): CodeRow => {
    const c = by(kind, id);
    const live = c && !c.used_at && c.uses < c.max_uses;
    return { kind, id, name, detail, code: live ? formatCode(c.code) : null, role: c?.role ?? null, extra_roles: c?.extra_roles ?? [], uses: c?.uses ?? 0, max_uses: c?.max_uses ?? 1,
      has_account: hasAccount, email, phone };
  };
  return [
    ...staff.map((s: any) => row("staff", s.id, s.full_name, s.position ?? null, Boolean(s.user_id), s.email, s.phone)),
    ...students.map((s: any) => row("student", s.id, `${s.first_name} ${s.last_name}`, [s.admission_no, cls.get(s.class_group_id)].filter(Boolean).join(" · ") || null, Boolean(s.user_id), null, null)),
    ...guardians.map((g: any) => row("guardian", g.id, g.full_name, null, Boolean(g.user_id), g.email, g.phone)),
    ...students.map((s: any) => row("parent_link", s.id, `${s.first_name} ${s.last_name}`, [s.admission_no, cls.get(s.class_group_id)].filter(Boolean).join(" · ") || null, false, null, null))
  ];
}

/** Sends people their codes: staff and parents to themselves; a student's codes to that student's parents. */
export async function sendCodes(svc: Svc, p: { tenantId: string; items: { kind: CodeKind; id: string }[]; baseUrl: string; actor: string }) {
  const brand = await loadBrand(svc, p.tenantId);
  const join = `${p.baseUrl}/join`;
  const how = (code: string) => [`Your sign-up code: ${formatCode(code)}`, `Go to ${join}, type the code, your email and a password of your own.`];
  const rows: OutboxRow[] = [];
  let skipped = 0;
  for (const it of p.items) {
    const col = it.kind === "staff" ? "staff_id" : it.kind === "guardian" ? "guardian_id" : "student_id";
    const { data: c } = await svc.from("account_codes").select("code,used_at,uses,max_uses").eq("tenant_id", p.tenantId).eq("kind", it.kind).eq(col, it.id).is("revoked_at", null).maybeSingle();
    if (!c || c.used_at || c.uses >= c.max_uses) { skipped++; continue; }
    if (it.kind === "staff") {
      const { data: s } = await svc.from("staff").select("full_name,email,phone").eq("id", it.id).maybeSingle();
      const note = communityNote(brand, { name: s?.full_name ?? "colleague", subject: `Your ${brand.schoolName} staff account`, lines: how(c.code), link: join, linkLabel: "Make my account" });
      const before = rows.length;
      if (s?.email && EMAIL.test(s.email)) rows.push({ tenant_id: p.tenantId, channel: "email", to_address: s.email, to_name: s.full_name, kind: "account_key", subject: note.subject, body_text: note.text, body_html: note.html, ref_id: it.id, created_by: p.actor });
      const ph = normalizePhone(s?.phone);
      if (ph) rows.push({ tenant_id: p.tenantId, channel: "sms", to_address: ph, to_name: s!.full_name, kind: "account_key", subject: note.subject, body_text: smsText(`${brand.schoolName}: your sign-up code is ${formatCode(c.code)}. Make your account at ${join}`), ref_id: it.id, created_by: p.actor });
      if (rows.length === before) skipped++;
      continue;
    }
    if (it.kind === "guardian") {
      const { data: g } = await svc.from("guardians").select("id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,notify_sms").eq("id", it.id).maybeSingle();
      const got = g ? rowsForGuardian(p.tenantId, { ...g, notify_email: true }, "account_key", communityNote(brand, { name: g.full_name, subject: `Your ${brand.schoolName} parent account`, lines: how(c.code), link: join, linkLabel: "Make my account" }), it.id, p.actor) : [];
      if (got.length) rows.push(...got); else skipped++;
      continue;
    }
    // A student's own code, or their parent code: to the parents on the child's record.
    const { data: st } = await svc.from("students").select("first_name,last_name").eq("id", it.id).maybeSingle();
    const child = st ? `${st.first_name} ${st.last_name}` : "your child";
    const { data: links } = await svc.from("student_guardians").select("guardians(id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,notify_sms)").eq("student_id", it.id);
    const before = rows.length;
    for (const l of links ?? []) {
      if (!l.guardians) continue;
      const lines = it.kind === "student"
        ? [`${child}'s student sign-up code: ${formatCode(c.code)}`, `${child} goes to ${join}, types the code, an email and a password.`]
        : [`Parent code for ${child}: ${formatCode(c.code)}`, `New to Synergy Swift? Go to ${join} and use it to make your parent account. Already signed in? Type it under "Add a child" on your page.`];
      rows.push(...rowsForGuardian(p.tenantId, { ...l.guardians, notify_email: true }, "account_key", communityNote(brand, { name: l.guardians.full_name, subject: `${child}: sign-up code`, lines, link: join, linkLabel: "Open" }), it.id, p.actor));
    }
    if (rows.length === before) skipped++;
  }
  if (rows.length) { await enqueue(svc, rows); await tryDispatch(svc, { budgetMs: 8000 }).catch(() => null); }
  return { messages: rows.length, skipped };
}
