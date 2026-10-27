import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { requirePlatformAdmin, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { endSupportSession } from "@/lib/support-server";

export const dynamic = "force-dynamic";

/**
 * Support access (phase 14k). Instead of signing in as a real person, a platform admin opens a short,
 * audited session in one school as "Synergy Swift support": a separate account that only works until
 * the session ends, whose every action is recorded under that name, and which the school can see.
 */
export async function GET() {
  const pa = await requirePlatformAdmin("support");
  if (pa instanceof NextResponse) return pa;
  const svc = createServiceClient();
  const { data } = await svc.from("platform_support_sessions").select("id,tenant_id,started_by_name,reason,role,starts_at,expires_at,ended_at,tenants(name)")
    .order("starts_at", { ascending: false }).limit(100);
  const now = Date.now();
  return NextResponse.json({ sessions: (data ?? []).map((s: any) => ({ ...s, school: s.tenants?.name ?? null, tenants: undefined,
    live: !s.ended_at && Date.parse(s.expires_at) > now })) });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), tenant_id: z.string().uuid(), reason: z.string().trim().min(10).max(500), minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    role: z.enum(["school_admin", "teacher", "bursar", "hr_manager", "exam_officer"]).default("school_admin") }),
  z.object({ action: z.literal("end"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const pa = await requirePlatformAdmin("admin");
  if (pa instanceof NextResponse) return pa;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();
  const { data: me } = await svc.auth.admin.getUserById(pa.userId);
  const myName = (me?.user?.user_metadata as any)?.full_name || me?.user?.email || "Platform admin";

  if (b.action === "end") {
    const ok = await endSupportSession(svc, b.id, pa.userId);
    if (!ok) return jsonError("not found", 404);
    await svc.from("platform_audit_logs").insert({ actor_id: pa.userId, action: "support.ended", meta: { session_id: b.id } });
    return NextResponse.json({ ok: true });
  }

  const { data: tenant } = await svc.from("tenants").select("id,name,status").eq("id", b.tenant_id).maybeSingle();
  if (!tenant) return jsonError("not found", 404);
  if (tenant.status !== "active") return jsonError("this school is not active");
  const starts = new Date(), expires = new Date(starts.getTime() + b.minutes * 60_000);
  const email = `support-${randomBytes(6).toString("hex")}@support.synergyswift.invalid`;
  const created = await svc.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: "Synergy Swift support" },
    app_metadata: { support: true, support_until: expires.toISOString() } });
  if (created.error || !created.data.user) return jsonError(created.error?.message ?? "could not open support access");
  const uid = created.data.user.id;
  const { error: uerr } = await svc.from("users").insert({ id: uid, tenant_id: tenant.id, email, full_name: `Synergy Swift support (${myName})`, role: b.role, active: true, support_until: expires.toISOString() });
  if (uerr) { await svc.auth.admin.deleteUser(uid).catch(() => null); return jsonError(uerr.message); }
  const { data: session, error } = await svc.from("platform_support_sessions").insert({ tenant_id: tenant.id, support_user_id: uid, started_by: pa.userId, started_by_name: myName,
    reason: b.reason, role: b.role, starts_at: starts.toISOString(), expires_at: expires.toISOString() }).select("id").single();
  if (error) return jsonError(error.message);
  await svc.from("audit_logs").insert({ tenant_id: tenant.id, actor_id: uid, action: "support.started", meta: { session_id: session.id, minutes: b.minutes, reason: b.reason, by: myName } });
  await svc.from("platform_audit_logs").insert({ actor_id: pa.userId, action: "support.started", tenant_id: tenant.id, meta: { session_id: session.id, minutes: b.minutes, role: b.role, reason: b.reason } });
  const link = await svc.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: `${appUrl(req)}/auth/welcome?next=/dashboard` } });
  if (link.error) return jsonError(link.error.message);
  return NextResponse.json({ id: session.id, expires_at: expires.toISOString(), action_link: link.data.properties?.action_link ?? null });
}
