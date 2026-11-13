import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, hasAny, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { chunks, fetchAll } from "@/lib/fetch-all";
import { studentName } from "@/lib/school";
import { sendCodes, createOneTimeLogin, renewOneTimeLogin, inviteByEmail } from "@/lib/sign-up-codes-server";
import { resendStudentKey } from "@/lib/accounts-server";
import { tenantSignIns } from "@/lib/staff-onboarding-server";
import { formatCode } from "@/lib/sign-up-codes";
import { codeClasses, classCodes } from "@/lib/onboarding-codes-server";
import { classCodesAndWaiting, approveSignup, declineSignup, classCodesNeedUpdate } from "@/lib/class-signup-server";

export const dynamic = "force-dynamic";

/**
 * Students' sign-up codes and children's parent codes, class by class. Admins see every class;
 * a class (form) teacher sees only their own class. Subject teachers, students and parents never
 * see them. ?class= picks one class.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const admin = hasAny(ctx, ROLES.admin);
  const svc = createServiceClient();
  const classes = await codeClasses(svc, { tenantId: ctx.tenant.id, userId: ctx.userId, admin });
  // The students this person may add parents for (every class for admins, their own class for a class teacher).
  if (new URL(req.url).searchParams.get("students") === "1") {
    const ids = classes.map(c => c.id);
    const name = new Map(classes.map(c => [c.id, c.name]));
    const list = ids.length ? (await Promise.all(chunks(ids).map(c => fetchAll<any>(() => svc.from("students").select("id,first_name,last_name,other_names,admission_no,class_group_id")
      .eq("tenant_id", ctx.tenant.id).eq("status", "active").in("class_group_id", c).order("id"))))).flat() : [];
    return NextResponse.json({ students: list.map((s: any) => ({ id: s.id, name: studentName(s), admission_no: s.admission_no ?? null, class_name: name.get(s.class_group_id) ?? null }))
      .sort((a: any, b: any) => (a.class_name ?? "").localeCompare(b.class_name ?? "") || a.name.localeCompare(b.name)) }, { headers: { "Cache-Control": "no-store" } });
  }
  const want = new URL(req.url).searchParams.get("class");
  const pick = want && classes.some(c => c.id === want) ? [want] : admin && !want ? [] : classes.slice(0, 1).map(c => c.id);
  try {
    const shown = admin && want === "all" ? classes.map(c => c.id) : pick;
    const rows = await classCodes(svc, ctx.tenant.id, shown);
    // The shared class codes and the students waiting to be confirmed (every class this person has, so nobody waits unseen).
    const shared = await classCodesAndWaiting(svc, ctx.tenant.id, classes).catch(() => null);
    return NextResponse.json({ admin, classes, selected: admin && want === "all" ? "all" : pick[0] ?? null, rows,
      class_codes: shared ? shared.codes.filter(c => shown.includes(c.class_id)) : null, waiting: shared?.waiting ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const m = (e as Error).message;
    return jsonError(/account_codes/.test(m) ? "Sign-up codes need the database update (migration 20260101009600)." : m, 503);
  }
}

const Body = z.discriminatedUnion("action", [
  // Send codes to the students' parents (by email, WhatsApp or SMS).
  z.object({ action: z.literal("send"), kind: z.enum(["student", "parent_link"]), ids: z.array(z.string().uuid()).min(1).max(2000) }),
  // A new code (the old one stops working): admins only.
  z.object({ action: z.literal("new_code"), kind: z.enum(["student", "parent_link"]), id: z.string().uuid() }),
  // Students: a username and a one-time password each (made, or made again), shown once and sent to their parents.
  z.object({ action: z.literal("student_login"), ids: z.array(z.string().uuid()).min(1).max(200) }),
  // Parents: their email is the username; a one-time password each, shown once and emailed to them.
  z.object({ action: z.literal("parent_login"), guardian_ids: z.array(z.string().uuid()).min(1).max(200), emails: z.record(z.string().uuid(), z.string().trim().max(254)).default({}) }),
  // A class's shared sign-up code: a new one (the old one stops working). Admins only.
  z.object({ action: z.literal("new_class_code"), class_id: z.string().uuid() }),
  // A student who signed up with the class code: confirmed (matched to their record, or added as new), or declined.
  z.object({ action: z.literal("approve_signup"), id: z.string().uuid(), student_id: z.string().uuid().nullable() }),
  z.object({ action: z.literal("decline_signup"), id: z.string().uuid() }),
  // Add a parent, like staff onboarding: who they are, their children, and how they sign in.
  z.object({ action: z.literal("add_parent"), full_name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().max(254),
    phone: z.string().trim().max(30).nullish(), student_ids: z.array(z.string().uuid()).min(1).max(10), method: z.enum(["invite", "otp", "code"]) })
]);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const admin = hasAny(ctx, ROLES.admin);
  const svc = createServiceClient();
  // Only students in classes this person may see.
  const classes = (await codeClasses(svc, { tenantId: tid, userId: ctx.userId, admin })).map(c => c.id);

  if (b.action === "new_class_code") {
    if (!admin) return jsonError("only a school admin can make a new class code", 403);
    if (!classes.includes(b.class_id)) return jsonError("not found", 404);
    const { data, error } = await svc.rpc("issue_class_code", { p_class: b.class_id });
    if (error) return jsonError(classCodesNeedUpdate(error.message) ? "Class codes need the database update (migration 20260101010300)." : error.message, 400);
    await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "account.class_code_reissued", target: b.class_id });
    return NextResponse.json({ ok: true, code: formatCode(data as string) });
  }
  if (b.action === "approve_signup" || b.action === "decline_signup") {
    // Only for a class this person may see: its class teacher, or an admin.
    const { data: req0 } = await svc.from("class_signups").select("class_group_id").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
    if (!req0 || !classes.includes(req0.class_group_id)) return jsonError("not found", 404);
    try {
      if (b.action === "decline_signup") return NextResponse.json({ ok: true, ...(await declineSignup(svc, { tenantId: tid, id: b.id, by: ctx.userId })) });
      return NextResponse.json({ ok: true, ...(await approveSignup(svc, { tenantId: tid, id: b.id, studentId: b.student_id, by: ctx.userId })) });
    } catch (e) { return jsonError((e as Error).message); }
  }
  if (b.action === "add_parent") {
    if (!EMAIL.test(b.email)) return jsonError("Type the parent's email address: it becomes their username and their sign-in goes there.");
    // Only children in classes this person may see.
    const { data: kids } = await svc.from("students").select("id,first_name,last_name,other_names,class_group_id").eq("tenant_id", tid).in("id", b.student_ids);
    if ((kids ?? []).length !== new Set(b.student_ids).size || (kids ?? []).some((k: any) => !k.class_group_id || !classes.includes(k.class_group_id)))
      return jsonError("you can only add parents for students in your own class", 403);
    const names = (kids ?? []).map((k: any) => studentName(k)).join(" and ");
    // The school may already have this parent (same email): use that record.
    const { data: found } = await svc.from("guardians").select("id,full_name,user_id").eq("tenant_id", tid).ilike("email", b.email.replace(/[\\%_]/g, "\\$&")).limit(1);
    type G = { id: string; full_name: string; user_id: string | null };
    let g: G;
    if ((found ?? []).length) g = (found as G[])[0];
    else {
      const { data: made, error } = await svc.from("guardians").insert({ tenant_id: tid, full_name: b.full_name, email: b.email, phone: b.phone || null }).select("id,full_name,user_id").single();
      if (error || !made) return jsonError(error?.message ?? "could not add the parent");
      g = made as G;
    }
    const { error: lErr } = await svc.from("student_guardians").upsert(b.student_ids.map(sid => ({ tenant_id: tid, student_id: sid, guardian_id: g!.id, relation: "parent" })), { onConflict: "student_id,guardian_id", ignoreDuplicates: true });
    if (lErr) return jsonError(lErr.message);
    await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "parent.onboarded", target: g.id, meta: { method: b.method, children: b.student_ids.length } });
    if (g.user_id) return NextResponse.json({ ok: true, message: `${g.full_name} already has an account. ${names} ${b.student_ids.length === 1 ? "is" : "are"} now on their page.` });
    try {
      if (b.method === "invite") {
        const r = await inviteByEmail(svc, { tenantId: tid, kind: "guardian", id: g.id, email: b.email, actor: ctx.userId, baseUrl: appUrl(req) });
        return NextResponse.json({ ok: true, message: `${b.full_name} added as parent of ${names}. The email link went to ${r.email}.`, link: r.link ?? null });
      }
      if (b.method === "otp") {
        const r = await createOneTimeLogin(svc, { tenantId: tid, kind: "guardian", id: g.id, email: b.email, actor: ctx.userId, baseUrl: appUrl(req) });
        return NextResponse.json({ ok: true, message: `${b.full_name} added as parent of ${names}. Username: ${r.username}. One-time password: ${r.password} (also emailed; shown only now).`, password: r.password });
      }
      const r = await sendCodes(svc, { tenantId: tid, items: [{ kind: "guardian", id: g.id }], baseUrl: appUrl(req), actor: ctx.userId });
      return NextResponse.json({ ok: true, message: r.messages ? `${b.full_name} added as parent of ${names}. Their sign-up code was emailed to them.` : `${b.full_name} added as parent of ${names}, but the code could not be sent: hand it over from the list below.` });
    } catch (e) {
      return NextResponse.json({ ok: true, access_error: (e as Error).message, message: `${b.full_name} added as parent of ${names}, but their sign-in could not be sent: ${(e as Error).message}.` });
    }
  }
  // Parents: the children they are linked to decide which classes they belong to.
  let ids: string[];
  if (b.action === "parent_login") {
    const { data: links } = await svc.from("student_guardians").select("guardian_id,student_id").eq("tenant_id", tid).in("guardian_id", b.guardian_ids);
    const sids = [...new Set(((links ?? []) as any[]).map(l => l.student_id as string))];
    const { data: kids } = sids.length ? await svc.from("students").select("id,class_group_id").eq("tenant_id", tid).in("id", sids) : { data: [] };
    const inMine = new Set(((kids ?? []) as any[]).filter(k => k.class_group_id && classes.includes(k.class_group_id)).map(k => k.id));
    const ok = new Set(((links ?? []) as any[]).filter(l => inMine.has(l.student_id)).map(l => l.guardian_id));
    if (b.guardian_ids.some(g => !ok.has(g))) return jsonError("you can only make logins for parents of students in your own class", 403);
    ids = [];
  } else ids = b.action === "send" || b.action === "student_login" ? b.ids : b.action === "new_code" ? [b.id] : [];
  const mine = new Set(classes);
  let allowed = 0;
  for (const c of chunks([...new Set(ids)])) {
    const { data: ok } = await svc.from("students").select("id,class_group_id").eq("tenant_id", tid).in("id", c);
    allowed += (ok ?? []).filter((s: { class_group_id: string | null }) => s.class_group_id && mine.has(s.class_group_id)).length;
  }
  if (allowed !== new Set(ids).size) return jsonError("you can only use codes for students in your own class", 403);

  if (b.action === "student_login") {
    const out: { id: string; name: string; username: string | null; password: string | null; sent: number; error?: string }[] = [];
    const { data: st } = await svc.from("students").select("id,first_name,last_name").eq("tenant_id", tid).in("id", b.ids);
    for (const s of (st ?? []) as any[]) {
      try {
        const r: any = await resendStudentKey(svc, s.id, appUrl(req), ctx.userId);
        out.push({ id: s.id, name: `${s.first_name} ${s.last_name}`, username: r.username ?? null, password: r.password ?? null, sent: r.sent ?? 0 });
      } catch (e) { out.push({ id: s.id, name: `${s.first_name} ${s.last_name}`, username: null, password: null, sent: 0, error: (e as Error).message }); }
    }
    await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "account.student_one_time_passwords", meta: { count: out.length } });
    return NextResponse.json({ ok: true, logins: out });
  }

  if (b.action === "parent_login") {
    const out: { id: string; name: string; username: string | null; password: string | null; error?: string }[] = [];
    const { data: gs } = await svc.from("guardians").select("id,full_name,email,user_id").eq("tenant_id", tid).in("id", b.guardian_ids);
    const signIns = await tenantSignIns(svc, tid);
    for (const g of (gs ?? []) as any[]) {
      const typed = (b.emails[g.id] ?? "").toLowerCase();
      const email = String(typed || g.email || "").trim().toLowerCase();
      try {
        if (!EMAIL.test(email)) throw new Error("no email on record: type their email first (it becomes their username)");
        if (typed && typed !== (g.email ?? "").toLowerCase()) await svc.from("guardians").update({ email: typed }).eq("tenant_id", tid).eq("id", g.id);
        if (!g.user_id) {
          const r = await createOneTimeLogin(svc, { tenantId: tid, kind: "guardian", id: g.id, email, actor: ctx.userId, baseUrl: appUrl(req) });
          out.push({ id: g.id, name: g.full_name, username: r.username, password: r.password });
        } else {
          if (signIns?.get(g.user_id)) throw new Error("has signed in already: they use \"Forgot password\" on the sign-in page");
          const { data: u } = await svc.from("users").select("email").eq("id", g.user_id).maybeSingle();
          const r = await renewOneTimeLogin(svc, { tenantId: tid, userId: g.user_id, name: g.full_name, email: u?.email ?? email, actor: ctx.userId, baseUrl: appUrl(req) });
          out.push({ id: g.id, name: g.full_name, username: r.username, password: r.password });
        }
      } catch (e) { out.push({ id: g.id, name: g.full_name, username: null, password: null, error: (e as Error).message }); }
    }
    return NextResponse.json({ ok: true, logins: out });
  }

  if (b.action === "new_code") {
    if (!admin) return jsonError("only a school admin can make a new code", 403);
    const { data, error } = await svc.rpc("issue_account_code", { p_kind: b.kind, p_id: b.id, p_by: ctx.userId });
    if (error) return jsonError(error.message);
    await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "account.code_reissued", target: b.id, meta: { kind: b.kind } });
    return NextResponse.json({ ok: true, code: formatCode(data as string) });
  }
  const r = await sendCodes(svc, { tenantId: tid, items: b.ids.map(id => ({ kind: b.kind, id })), baseUrl: appUrl(req), actor: ctx.userId });
  await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "account.codes_sent", meta: { kind: b.kind, count: b.ids.length } });
  return NextResponse.json({ ok: true, ...r });
}
