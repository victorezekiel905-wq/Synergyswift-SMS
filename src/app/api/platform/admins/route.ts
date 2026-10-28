import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { authMailConfigured, linkFrom, sendAuthEmail } from "@/lib/auth-mail";

/** The people who run Synergy Swift itself. Schools never see this list. */
export async function GET() {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const svc = createServiceClient();
  const { data } = await svc.from("platform_admins").select("user_id,role,email,created_at").order("created_at");
  return NextResponse.json({ admins: data ?? [], me: gate.userId, my_role: gate.role });
}

const Add = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["admin", "support"]) });

/** Owner only: give someone platform access. New people get an invitation email to set a password. */
export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin("owner");
  if (gate instanceof NextResponse) return gate;
  const parsed = Add.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const { email, role } = parsed.data;
  const svc = createServiceClient();
  // A school account cannot also be a platform account: keep the two worlds apart.
  const { data: schoolUser } = await svc.from("users").select("id").ilike("email", email).maybeSingle();
  if (schoolUser) return jsonError("this email belongs to a school account; use a separate email for platform work");
  let userId: string | null = null;
  const { data: list } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  userId = list?.users?.find((u: { email?: string }) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
  if (!userId && authMailConfigured()) {
    // The invitation comes from Synergy Swift's own email service.
    const base = appUrl(req);
    const { data, error } = await svc.auth.admin.generateLink({ type: "invite", email, options: { redirectTo: `${base}/auth/welcome?next=/platform` } });
    if (error) return jsonError(error.message);
    userId = data.user?.id ?? null;
    const url = linkFrom(base, data, "invite", "/platform");
    const sent = url ? await sendAuthEmail({ kind: "invite", to: email, link: url, brand: "Synergy Swift" }) : null;
    if (!sent?.ok) console.error("[platform admins] invite email:", sent?.error);
  } else if (!userId) {
    const { data, error } = await svc.auth.admin.inviteUserByEmail(email, { redirectTo: `${appUrl(req)}/auth/welcome?next=/platform` });
    if (error) return jsonError(error.message);
    userId = data.user?.id ?? null;
  }
  if (!userId) return jsonError("could not create the account");
  const { error } = await svc.from("platform_admins").upsert({ user_id: userId, role, email, added_by: gate.userId }, { onConflict: "user_id" });
  if (error) return jsonError(error.message);
  await svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action: "platform_admin.added", tenant_id: null, meta: { email, role } });
  return NextResponse.json({ ok: true }, { status: 201 });
}

const Change = z.object({ user_id: z.string().uuid(), role: z.enum(["admin", "support"]).optional(), remove: z.boolean().optional() });

/** Owner only: change someone's platform role or remove their access. The owner stays. */
export async function PATCH(req: NextRequest) {
  const gate = await requirePlatformAdmin("owner");
  if (gate instanceof NextResponse) return gate;
  const parsed = Change.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  if (b.user_id === gate.userId) return jsonError("you cannot change your own platform access");
  const svc = createServiceClient();
  const { data: row } = await svc.from("platform_admins").select("role,email").eq("user_id", b.user_id).maybeSingle();
  if (!row) return jsonError("not found", 404);
  if (row.role === "owner") return jsonError("the platform owner cannot be changed");
  const { error } = b.remove
    ? await svc.from("platform_admins").delete().eq("user_id", b.user_id)
    : await svc.from("platform_admins").update({ role: b.role }).eq("user_id", b.user_id);
  if (error) return jsonError(error.message);
  await svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action: b.remove ? "platform_admin.removed" : "platform_admin.role", tenant_id: null, meta: { email: row.email, role: b.role ?? null } });
  return NextResponse.json({ ok: true });
}
