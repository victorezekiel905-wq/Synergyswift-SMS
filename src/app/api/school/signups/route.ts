import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { listSignups, actOnSignup } from "@/lib/signups";

export const dynamic = "force-dynamic";

/** Accounts joining this school that are waiting to be confirmed. Admins only. */
export async function GET() {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  try { return NextResponse.json(await listSignups(createServiceClient(), ctx.tenant.id)); }
  catch (e) { return jsonError((e as Error).message); }
}

const Body = z.object({ action: z.enum(["confirm", "resend", "remove"]), user_id: z.string().uuid() });

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("action and user_id required");
  const svc = createServiceClient();
  // Only this school's sign-ups: another school's (or a new school's) look the same as none at all.
  const { data: row } = await svc.from("signup_requests").select("*").eq("user_id", parsed.data.user_id).eq("tenant_id", ctx.tenant.id).maybeSingle();
  if (!row) return jsonError("not found", 404);
  const r = await actOnSignup(svc, row, parsed.data.action, { userId: ctx.userId, how: "school_admin", base: appUrl(req) });
  if (!r.ok) return jsonError(r.error);
  await svc.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: `signup.${parsed.data.action}`, meta: { email: row.email, kind: row.kind } });
  return NextResponse.json({ ok: true });
}
