import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { listSignups, actOnSignup } from "@/lib/signups";

export const dynamic = "force-dynamic";

/** Every new account waiting to be confirmed, across all schools and new-school sign-ups. */
export async function GET() {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  try { return NextResponse.json({ ...(await listSignups(createServiceClient(), null)), can_act: gate.role !== "support" }); }
  catch (e) { return jsonError((e as Error).message); }
}

const Body = z.object({ action: z.enum(["confirm", "resend", "remove"]), user_id: z.string().uuid() });

/** Platform admins and the owner: confirm an account, send its link again, or remove it. */
export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin("admin");
  if (gate instanceof NextResponse) return gate;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("action and user_id required");
  const svc = createServiceClient();
  const { data: row } = await svc.from("signup_requests").select("*").eq("user_id", parsed.data.user_id).maybeSingle();
  if (!row) return jsonError("not found", 404);
  const r = await actOnSignup(svc, row, parsed.data.action, { userId: gate.userId, how: "platform", base: appUrl(req) });
  if (!r.ok) return jsonError(r.error);
  await svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action: `signup.${parsed.data.action}`, tenant_id: row.tenant_id, meta: { email: row.email, kind: row.kind } });
  return NextResponse.json({ ok: true });
}
