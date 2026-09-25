import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ user: null, profile: null }, { status: 200 });
  const { data: profile } = await sb.from("users")
    .select("id,tenant_id,email,full_name,role,extra_roles").eq("id", user.id).maybeSingle();
  let tenant = null;
  let platform = false;
  if (profile) {
    const { data } = await sb.from("tenants").select("id,name,status,modules").eq("id", profile.tenant_id).maybeSingle();
    tenant = data;
  } else {
    const { data } = await sb.rpc("is_platform_admin");
    platform = data === true;
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
    is_guardian: Boolean(guardian),
    is_staff_record: Boolean(staff)
  });
}
