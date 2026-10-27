import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { beginRequest } from "@/lib/request-actor";
import { checkAccess } from "@/lib/access";
import { passwordDaysLeft } from "@/lib/security";

// Account states that stop the app and send the user somewhere specific.
const BLOCKING = ["suspended", "paused", "deactivated", "mfa_required", "password_expired", "sso_required", "session_expired", "access_restricted", "alumni"];

export async function GET() {
  const store = beginRequest();
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ user: null, profile: null }, { status: 200 });
  store.actor = `user:${user.id}`;
  const { data: { session } } = await sb.auth.getSession();
  const access = await checkAccess(user.id, session?.access_token ?? null);
  const who = { id: user.id, email: user.email };
  if (!access.ok) {
    return NextResponse.json({ user: who, profile: null, tenant: null, platform: false, group: false, account: { state: "access_restricted", message: access.message, reason: access.reason, device: access.device } });
  }
  const { data: profile } = await sb.from("users")
    .select("id,tenant_id,email,full_name,role,extra_roles").eq("id", user.id).maybeSingle();
  let tenant = null;
  let platform = false;
  let group = false;
  if (profile) {
    const { data } = await sb.from("tenants").select("id,name,status,modules").eq("id", profile.tenant_id).maybeSingle();
    tenant = data;
  } else {
    const { data: state } = await sb.rpc("my_account_state");
    if (BLOCKING.includes(state?.state)) {
      return NextResponse.json({ user: who, profile: null, tenant: null, platform: false, group: false, account: state });
    }
    const { data: pstate } = await sb.rpc("platform_admin_state");
    platform = pstate === "ok";
    if (pstate === "mfa_required") {
      return NextResponse.json({ user: who, profile: null, tenant: null, platform: false, group: false, platform_mfa: true });
    }
    const { data: g } = await sb.rpc("my_group_ids");
    group = Array.isArray(g) && g.length > 0;
  }
  const [{ data: guardian }, { data: staff }] = profile ? await Promise.all([
    sb.from("guardians").select("id").eq("user_id", user.id).maybeSingle(),
    sb.from("staff").select("id").eq("user_id", user.id).maybeSingle()
  ]) : [{ data: null }, { data: null }];
  // School-wide preferences the app needs on every page.
  let prefs = null;
  let mustChange = false;
  if (profile) {
    const svc = createServiceClient();
    const [{ data: s }, { data: u }] = await Promise.all([
      svc.from("tenant_settings").select("currency,session_idle_minutes,password_max_age_days,password_policy_scope").eq("tenant_id", profile.tenant_id).maybeSingle(),
      svc.from("users").select("password_changed_at,must_change_password").eq("id", user.id).maybeSingle()
    ]);
    const staffRole = !["student", "parent"].includes(profile.role);
    const applies = Boolean(s?.password_max_age_days) && (staffRole || s?.password_policy_scope === "all");
    prefs = {
      currency: s?.currency ?? "NGN",
      idle_minutes: staffRole ? (s?.session_idle_minutes ?? 0) : 0,
      password_days_left: applies ? passwordDaysLeft(u?.password_changed_at ?? null, s!.password_max_age_days) : null
    };
    // A starting password (sent to the parents) must be replaced at the first sign-in.
    if (u?.must_change_password) mustChange = true;
  }
  return NextResponse.json({
    user: who,
    profile: profile ?? null,
    tenant,
    platform,
    group,
    prefs,
    is_guardian: Boolean(guardian),
    is_staff_record: Boolean(staff),
    ...(mustChange ? { account: { state: "password_expired", message: "Choose your own password to continue." } } : {})
  });
}
