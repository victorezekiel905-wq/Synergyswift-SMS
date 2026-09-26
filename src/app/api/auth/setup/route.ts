import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { DEFAULT_SCHEME } from "@/lib/grading";

/**
 * Called after every sign-in / sign-up. Idempotent.
 *
 * - Existing profile            → nothing to do.
 * - Platform (super) admin      → no tenant profile, ever; sent to /platform.
 * - Student with a class code   → profile created in that class's tenant.
 * - Anyone else                 → schools are provisioned by the platform admin.
 *   Self-serve school creation only when ALLOW_SELF_SERVE_TENANTS=true.
 *
 * Profile rows are written with the service role because users can no longer
 * insert their own profile (that let anyone join any tenant with any role).
 */
export async function POST(req: NextRequest) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: existing } = await sb.from("users").select("id,tenant_id,role").eq("id", user.id).maybeSingle();
  if (existing) return NextResponse.json({ ok: true, role: existing.role, already: true, next: "/dashboard" });

  const { data: state } = await sb.rpc("my_account_state");
  if (state?.state === "suspended") return NextResponse.json({ error: `${state.school} is suspended. Please contact your school.`, code: "suspended" }, { status: 403 });
  if (state?.state === "deactivated") return NextResponse.json({ error: "Your account has been deactivated. Please contact your school.", code: "deactivated" }, { status: 403 });
  // The school (or the platform) requires a second factor this session does not have yet.
  if (state?.state === "mfa_required") return NextResponse.json({ ok: true, already: true, mfa: true, next: "/account/security?required=school" });
  const { data: platformState } = await sb.rpc("platform_admin_state");
  if (platformState === "mfa_required") return NextResponse.json({ ok: true, already: true, mfa: true, next: "/account/security?required=platform" });
  if (platformState === "ok") return NextResponse.json({ ok: true, platform: true, already: true, next: "/platform" });
  const { data: groups } = await sb.rpc("my_group_ids");
  if (Array.isArray(groups) && groups.length) return NextResponse.json({ ok: true, group: true, already: true, next: "/group" });

  const body = await req.json().catch(() => ({}));
  const role = String(body.role ?? "");
  const fullName = String(body.full_name ?? user.user_metadata?.full_name ?? user.email ?? "User").slice(0, 120);
  const svc = createServiceClient();

  if (role === "student") {
    const code = String(body.join_code ?? "").trim().toUpperCase();
    if (!code) return NextResponse.json({ error: "join_code required for students" }, { status: 400 });
    const { data: cls } = await sb.rpc("class_lookup_by_code", { p_code: code });
    const c = cls?.[0] as { id: string; tenant_id: string } | undefined;
    if (!c) return NextResponse.json({ error: "class not found for that code" }, { status: 404 });
    const { data: t } = await svc.from("tenants").select("status").eq("id", c.tenant_id).maybeSingle();
    if (t?.status !== "active") return NextResponse.json({ error: "class not found for that code" }, { status: 404 });
    const { error: uErr } = await svc.from("users").insert({
      id: user.id, tenant_id: c.tenant_id, email: user.email ?? "", full_name: fullName, role: "student"
    });
    if (uErr && !uErr.message.includes("duplicate")) return NextResponse.json({ error: uErr.message }, { status: 400 });
    await svc.from("class_members").upsert({ class_id: c.id, user_id: user.id, role: "student" }, { onConflict: "class_id,user_id" });
    return NextResponse.json({ ok: true, role: "student", next: "/dashboard" });
  }

  if (process.env.ALLOW_SELF_SERVE_TENANTS !== "true") {
    return NextResponse.json({
      error: "Your account is not linked to a school yet. Ask your school administrator for an invitation.",
      code: "not_provisioned"
    }, { status: 403 });
  }

  // Self-serve (opt-in): new school with the caller as its admin.
  const tenantName = String(body.tenant_name ?? "My School").slice(0, 120);
  const slug = `school-${user.id.slice(0, 8)}`;
  const { data: tenant, error: tErr } = await svc.from("tenants").insert({ name: tenantName, slug, contact_email: user.email })
    .select("id").single();
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 400 });
  await svc.from("users").insert({ id: user.id, tenant_id: tenant.id, email: user.email ?? "", full_name: fullName, role: "school_admin" });
  await svc.from("tenant_settings").insert({ tenant_id: tenant.id, school_name: tenantName, sender_name: tenantName });
  const { data: scheme } = await svc.from("grading_schemes").insert({ tenant_id: tenant.id, name: DEFAULT_SCHEME.name, is_default: true }).select("id").single();
  if (scheme) {
    await svc.from("grading_components").insert(DEFAULT_SCHEME.components.map(c => ({ ...c, scheme_id: scheme.id })));
    await svc.from("grade_bands").insert(DEFAULT_SCHEME.bands.map(b => ({ ...b, scheme_id: scheme.id })));
  }
  return NextResponse.json({ ok: true, role: "school_admin", next: "/school" });
}
