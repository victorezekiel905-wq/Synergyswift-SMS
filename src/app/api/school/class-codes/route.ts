import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, hasAny, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { chunks } from "@/lib/fetch-all";
import { sendCodes, createOneTimeLogin, renewOneTimeLogin } from "@/lib/sign-up-codes-server";
import { resendStudentKey } from "@/lib/accounts-server";
import { tenantSignIns } from "@/lib/staff-onboarding-server";
import { formatCode } from "@/lib/sign-up-codes";
import { codeClasses, classCodes } from "@/lib/onboarding-codes-server";

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
  const want = new URL(req.url).searchParams.get("class");
  const pick = want && classes.some(c => c.id === want) ? [want] : admin && !want ? [] : classes.slice(0, 1).map(c => c.id);
  try {
    const rows = await classCodes(svc, ctx.tenant.id, admin && want === "all" ? classes.map(c => c.id) : pick);
    return NextResponse.json({ admin, classes, selected: admin && want === "all" ? "all" : pick[0] ?? null, rows }, { headers: { "Cache-Control": "no-store" } });
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
  z.object({ action: z.literal("parent_login"), guardian_ids: z.array(z.string().uuid()).min(1).max(200), emails: z.record(z.string().uuid(), z.string().trim().max(254)).default({}) })
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
  } else ids = b.action === "send" || b.action === "student_login" ? b.ids : [b.id];
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
