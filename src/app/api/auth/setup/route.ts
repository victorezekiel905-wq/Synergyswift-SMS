import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { DEFAULT_SCHEME } from "@/lib/grading";
import { emailDomain } from "@/lib/security";
import { staffRows, enqueue, tryDispatch } from "@/lib/messaging/outbox";
import { appUrl } from "@/lib/school";
import { hashSchoolCode, isSchoolCodeShape } from "@/lib/school-codes";

/**
 * Called after every sign-in / sign-up. Idempotent.
 *
 * - Existing profile            → nothing to do.
 * - Platform (super) admin      → no tenant profile, ever; sent to /platform.
 * - Student with a class code   → profile created in that class's tenant.
 * - Anyone else                 → schools are created by the platform owner, or by
 *   a prospect with a one-time school code the owner made (used up at once).
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
  if (state?.state === "suspended" || state?.state === "paused") {
    const why = state.message ? ` ${state.message}` : " Please contact your school.";
    return NextResponse.json({ error: `${state.school} is ${state.state === "paused" ? "closed for now" : "not available right now"}.${why}`, code: state.state }, { status: 403 });
  }
  if (state?.state === "deactivated") return NextResponse.json({ error: "Your account has been deactivated. Please contact your school.", code: "deactivated" }, { status: 403 });
  // The school (or the platform) requires a second factor this session does not have yet.
  if (state?.state === "mfa_required") return NextResponse.json({ ok: true, already: true, mfa: true, next: "/account/security?required=school" });
  if (state?.state === "password_expired") return NextResponse.json({ ok: true, already: true, next: "/account/security?required=password" });
  if (state?.state === "access_restricted") return NextResponse.json({ ok: true, already: true, next: "/dashboard" });
  if (state?.state === "alumni") return NextResponse.json({ ok: true, already: true, next: "/alumni/me" });
  if (state?.state === "sso_required") return NextResponse.json({ error: "Your school requires you to sign in with your school Google or Microsoft account.", code: "sso_required" }, { status: 403 });
  const { data: platformState } = await sb.rpc("platform_admin_state");
  if (platformState === "mfa_required") return NextResponse.json({ ok: true, already: true, mfa: true, next: "/account/security?required=platform" });
  if (platformState === "ok") return NextResponse.json({ ok: true, platform: true, already: true, next: "/platform" });
  const { data: groups } = await sb.rpc("my_group_ids");
  if (Array.isArray(groups) && groups.length) return NextResponse.json({ ok: true, group: true, already: true, next: "/group" });

  const body = await req.json().catch(() => ({}));
  // Sign-ups that had to confirm their email first carry their answers on the account (/api/auth/register).
  const signedUp = (user.user_metadata ?? {}) as { signup_as?: string; join_code?: string };
  const role = String(body.role ?? (signedUp.signup_as === "student" ? "student" : ""));
  const fullName = String(body.full_name ?? user.user_metadata?.full_name ?? user.email ?? "User").slice(0, 120);
  const svc = createServiceClient();

  if (role === "student") {
    const code = String(body.join_code ?? signedUp.join_code ?? "").trim().toUpperCase();
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

  // Single sign-on from a school's own email domain: the account is created and waits for an admin to approve it.
  const provider = String(user.app_metadata?.provider ?? "");
  const domain = emailDomain(user.email);
  if (["google", "azure"].includes(provider) && domain && user.email_confirmed_at) {
    const { data: schools } = await svc.from("tenant_settings").select("tenant_id,sso_domains,sso_auto_join,tenants(status,name)").eq("sso_auto_join", true).contains("sso_domains", [domain]);
    const school = (schools ?? []).find((s: any) => s.tenants?.status === "active");
    if (school) {
      const { error: uErr } = await svc.from("users").insert({ id: user.id, tenant_id: school.tenant_id, email: user.email ?? "", full_name: fullName, role: "teacher", active: false });
      if (uErr && !uErr.message.includes("duplicate")) return NextResponse.json({ error: uErr.message }, { status: 400 });
      await svc.from("staff").insert({ tenant_id: school.tenant_id, user_id: user.id, staff_no: `SSO-${user.id.slice(0, 8).toUpperCase()}`, full_name: fullName, email: user.email, status: "active" });
      await svc.from("audit_logs").insert({ tenant_id: school.tenant_id, actor_id: user.id, action: "staff.sso_join_requested", meta: { email: user.email, provider } });
      try {
        const { data: admins } = await svc.from("users").select("id").eq("tenant_id", school.tenant_id).eq("active", true).in("role", ["school_admin", "principal"]).limit(10);
        const rows = await staffRows(svc, { tenantId: school.tenant_id, userIds: (admins ?? []).map((a: any) => a.id), kind: "staff_join", subject: `${fullName} asked to join`,
          text: `${fullName} (${user.email}) signed in with ${provider === "azure" ? "Microsoft" : "Google"}. Approve them in HR & leave and set their role.`, url: `${appUrl(req)}/school/hr` });
        if (rows.length) { await enqueue(svc, rows); await tryDispatch(svc, { budgetMs: 3000 }); }
      } catch { /* the request is recorded even if the notice fails */ }
      await sb.auth.signOut();
      return NextResponse.json({ error: `Thanks, ${fullName.split(" ")[0]}. Your account at ${school.tenants?.name ?? "your school"} is waiting for approval by a school admin. You can sign in once they approve it.`, code: "pending_approval" }, { status: 403 });
    }
  }

  // A new school needs a one-time school code from the Synergy Swift owner (migration 7900).
  // Normally the code was used up when the account was made (/api/auth/register), inside its
  // 20 minutes; the school is created now, at the first sign-in after the email is confirmed.
  const meta = (user.user_metadata ?? {}) as { school_name?: string };
  const { data: held } = await svc.from("school_signup_codes").select("id").eq("used_by", user.id).is("tenant_id", null).is("revoked_at", null).limit(1).maybeSingle();
  let codeId: string | null = held?.id ?? null;
  if (!codeId) {
    const schoolCode = String(body.school_code ?? "").trim();
    if (!schoolCode) {
      return NextResponse.json({
        error: "Your account is not linked to a school yet. Staff: ask your school administrator for an invitation. Setting up a new school: you need a school code from Synergy Swift.",
        code: "not_provisioned"
      }, { status: 403 });
    }
    if (!isSchoolCodeShape(schoolCode)) return NextResponse.json({ error: "That school code isn't right. Check it and try again.", code: "bad_code" }, { status: 400 });
    const { data: claimed, error: cErr } = await svc.rpc("claim_school_code", { p_hash: hashSchoolCode(schoolCode), p_user: user.id });
    if (cErr) return NextResponse.json({ error: "Setting up schools needs the database update (migration 20260101007900)." }, { status: 503 });
    if (!claimed) return NextResponse.json({ error: "That school code has already been used, has expired, or was cancelled. Ask Synergy Swift for a new one.", code: "code_used" }, { status: 403 });
    codeId = claimed as string;
  }

  // A code made for a school already created on the console (migration 8900): its holder becomes
  // that school's administrator. Before that migration the column is missing and every code makes a school.
  const { data: codeRow } = await svc.from("school_signup_codes").select("for_tenant_id").eq("id", codeId).maybeSingle();
  const forTenant = (codeRow as { for_tenant_id?: string | null } | null)?.for_tenant_id ?? null;
  if (forTenant) {
    try {
      const { data: school } = await svc.from("tenants").select("id,name,contact_email").eq("id", forTenant).maybeSingle();
      if (!school) throw new Error("this school no longer exists");
      const { error: uErr } = await svc.from("users").insert({ id: user.id, tenant_id: school.id, email: user.email ?? "", full_name: fullName, role: "school_admin" });
      if (uErr) throw new Error(uErr.message);
      await svc.from("staff").insert({ tenant_id: school.id, user_id: user.id, staff_no: `ADMIN-${user.id.slice(0, 6).toUpperCase()}`, full_name: fullName, email: user.email, position: "School administrator" });
      if (!school.contact_email) await svc.from("tenants").update({ contact_email: user.email }).eq("id", school.id);
      await svc.from("school_signup_codes").update({ tenant_id: school.id }).eq("id", codeId);
      await svc.from("audit_logs").insert({ tenant_id: school.id, actor_id: user.id, action: "tenant.admin_joined_with_code", meta: { code_id: codeId } });
    } catch (e) {
      if (!held) await svc.rpc("release_school_code", { p_id: codeId });
      return NextResponse.json({ error: `Your account couldn't be added to the school: ${(e as Error).message}. Your code still works; sign in again to retry.` }, { status: 400 });
    }
    return NextResponse.json({ ok: true, role: "school_admin", next: "/school" });
  }

  // The code is used up. If creating the school fails, the prospect can try again.
  const tenantName = String(body.tenant_name ?? meta.school_name ?? "").trim().slice(0, 120) || "My School";
  try {
    const slug = `school-${user.id.slice(0, 8)}`;
    const { data: tenant, error: tErr } = await svc.from("tenants").insert({ name: tenantName, slug, contact_email: user.email })
      .select("id").single();
    if (tErr) throw new Error(tErr.message);
    const { error: uErr } = await svc.from("users").insert({ id: user.id, tenant_id: tenant.id, email: user.email ?? "", full_name: fullName, role: "school_admin" });
    if (uErr) { await svc.from("tenants").delete().eq("id", tenant.id); throw new Error(uErr.message); }
    await svc.from("tenant_settings").insert({ tenant_id: tenant.id, school_name: tenantName, sender_name: tenantName });
    const { data: scheme } = await svc.from("grading_schemes").insert({ tenant_id: tenant.id, name: DEFAULT_SCHEME.name, is_default: true }).select("id").single();
    if (scheme) {
      await svc.from("grading_components").insert(DEFAULT_SCHEME.components.map(c => ({ ...c, scheme_id: scheme.id })));
      await svc.from("grade_bands").insert(DEFAULT_SCHEME.bands.map(b => ({ ...b, scheme_id: scheme.id })));
    }
    const { data: used } = await svc.from("school_signup_codes").update({ tenant_id: tenant.id }).eq("id", codeId).select("lead_id,label").single();
    // The prospect in the sales pipeline becomes a customer.
    if (used?.lead_id) {
      const now = new Date().toISOString();
      await svc.from("sales_leads").update({ tenant_id: tenant.id, stage: "won", stage_changed_at: now, updated_at: now }).eq("id", used.lead_id).neq("stage", "won");
      await svc.from("sales_activities").insert({ lead_id: used.lead_id, kind: "system", body: `School set up with its code: ${tenantName} (${user.email}).` });
    }
    await svc.from("audit_logs").insert({ tenant_id: tenant.id, actor_id: user.id, action: "tenant.created_with_code", meta: { code_id: codeId, label: used?.label ?? null } });
  } catch (e) {
    // A code claimed in this request is put back; one used when the account was made stays with this account.
    if (!held) await svc.rpc("release_school_code", { p_id: codeId });
    return NextResponse.json({ error: `The school couldn't be set up: ${(e as Error).message}. Your code still works; sign in again to retry.` }, { status: 400 });
  }
  return NextResponse.json({ ok: true, role: "school_admin", next: "/school" });
}
