import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ user: null, profile: null }, { status: 200 });
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
    if (state?.state === "suspended" || state?.state === "deactivated" || state?.state === "mfa_required") {
      return NextResponse.json({ user: { id: user.id, email: user.email }, profile: null, tenant: null, platform: false, group: false, account: state });
    }
    const { data: pstate } = await sb.rpc("platform_admin_state");
    platform = pstate === "ok";
    if (pstate === "mfa_required") {
      return NextResponse.json({ user: { id: user.id, email: user.email }, profile: null, tenant: null, platform: false, group: false, platform_mfa: true });
    }
    const { data: g } = await sb.rpc("my_group_ids");
    group = Array.isArray(g) && g.length > 0;
  }
  const [{ data: guardian }, { data: staff }] = profile ? await Promise.all([
    sb.from("guardians").select("id").eq("user_id", user.id).maybeSingle(),
    sb.from("staff").select("id").eq("user_id", user.id).maybeSingle()
  ]) : [{ data: null }, { data: null }];
  return NextResponse.json({
    user: { id: user.id, email: user.email },
    profile: profile ?? null,
    tenant,
    platform,
    group,
    is_guardian: Boolean(guardian),
    is_staff_record: Boolean(staff)
  });
}
