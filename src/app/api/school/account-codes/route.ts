import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, STAFF_ROLE_OPTIONS } from "@/lib/auth";
import { ALWAYS_ALLOWED_ROLES } from "@/lib/saas";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { listCodes, createOneTimeLogin, sendCodes, inviteByEmail } from "@/lib/sign-up-codes-server";
import { formatCode } from "@/lib/sign-up-codes";

export const dynamic = "force-dynamic";

const KIND = z.enum(["staff", "student", "guardian", "parent_link"]);

/** Sign-up codes and one-time passwords for everyone the school adds (school admins). */
export async function GET() {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  try {
    return NextResponse.json({ rows: await listCodes(createServiceClient(), ctx.tenant.id) });
  } catch (e) {
    const m = (e as Error).message;
    return jsonError(/account_codes/.test(m) ? "Sign-up codes need the database update (migration 20260101009600)." : m, 503);
  }
}

const Body = z.discriminatedUnion("action", [
  // A new code (the old one stops working). For staff, optionally the role they sign up with.
  z.object({ action: z.literal("new_code"), kind: KIND, id: z.string().uuid() }),
  z.object({ action: z.literal("staff_role"), staff_id: z.string().uuid(), role: z.enum(STAFF_ROLE_OPTIONS), extra_roles: z.array(z.enum(STAFF_ROLE_OPTIONS)).max(10).default([]) }),
  // The second way in: a login with their email and a one-time password.
  z.object({ action: z.literal("one_time_password"), kind: z.enum(["staff", "student", "guardian"]), id: z.string().uuid(), email: z.string().trim().max(254) }),
  // The third way in: an emailed invitation link to set their password.
  z.object({ action: z.literal("invite"), kind: z.enum(["staff", "student", "guardian"]), id: z.string().uuid(), email: z.string().trim().max(254).nullish() }),
  z.object({ action: z.literal("send"), items: z.array(z.object({ kind: KIND, id: z.string().uuid() })).min(1).max(2000) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const mine = async (kind: string, id: string) => {
    const table = kind === "staff" ? "staff" : kind === "guardian" ? "guardians" : "students";
    const { data } = await svc.from(table).select("id").eq("tenant_id", tid).eq("id", id).maybeSingle();
    return Boolean(data);
  };

  if (b.action === "new_code") {
    if (!(await mine(b.kind, b.id))) return jsonError("not found", 404);
    const { data, error } = await svc.rpc("issue_account_code", { p_kind: b.kind, p_id: b.id, p_by: ctx.userId });
    if (error) return jsonError(error.message);
    await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "account.code_reissued", target: b.id, meta: { kind: b.kind } });
    return NextResponse.json({ ok: true, code: formatCode(data as string) });
  }

  if (b.action === "staff_role") {
    if (!(await mine("staff", b.staff_id))) return jsonError("not found", 404);
    const extra = b.extra_roles.filter(r => r !== b.role);
    const ceiling = ctx.tenant.allowed_roles;
    const outside = ceiling ? [b.role, ...extra].filter(r => !ALWAYS_ALLOWED_ROLES.includes(r) && !ceiling.includes(r)) : [];
    if (outside.length) return jsonError(`your school's plan does not include: ${outside.join(", ")}`);
    const { data, error } = await svc.rpc("issue_account_code", { p_kind: "staff", p_id: b.staff_id, p_by: ctx.userId, p_role: b.role, p_extra: extra });
    if (error) return jsonError(error.message);
    await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "account.code_role_set", target: b.staff_id, meta: { role: b.role, extra } });
    return NextResponse.json({ ok: true, code: formatCode(data as string) });
  }

  if (b.action === "one_time_password") {
    try {
      const r = await createOneTimeLogin(svc, { tenantId: tid, kind: b.kind, id: b.id, email: b.email, actor: ctx.userId, baseUrl: appUrl(req) });
      return NextResponse.json({ ok: true, ...r });
    } catch (e) { return jsonError((e as Error).message); }
  }

  if (b.action === "invite") {
    try {
      const r = await inviteByEmail(svc, { tenantId: tid, kind: b.kind, id: b.id, email: b.email ?? null, actor: ctx.userId, baseUrl: appUrl(req) });
      return NextResponse.json({ ok: true, ...r });
    } catch (e) { return jsonError((e as Error).message); }
  }

  // send
  const r = await sendCodes(svc, { tenantId: tid, items: b.items, baseUrl: appUrl(req), actor: ctx.userId });
  return NextResponse.json({ ok: true, ...r });
}
