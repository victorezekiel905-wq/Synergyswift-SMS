import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, hasAny, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { sendCodes } from "@/lib/sign-up-codes-server";
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
  z.object({ action: z.literal("new_code"), kind: z.enum(["student", "parent_link"]), id: z.string().uuid() })
]);

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
  const ids = b.action === "send" ? b.ids : [b.id];
  const { data: ok } = classes.length ? await svc.from("students").select("id").eq("tenant_id", tid).in("id", ids).in("class_group_id", classes) : { data: [] };
  if ((ok ?? []).length !== new Set(ids).size) return jsonError("you can only use codes for students in your own class", 403);

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
