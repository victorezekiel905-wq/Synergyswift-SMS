import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * For a student who signed up with their class's code: still waiting for the class teacher,
 * or confirmed (their page is open now).
 */
export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const svc = createServiceClient();
  const { data: profile } = await svc.from("users").select("id").eq("id", user.id).maybeSingle();
  if (profile) return NextResponse.json({ state: "approved" });
  const { data: s } = await svc.from("class_signups").select("status,full_name,tenant_id,class_groups(name),tenants(name)").eq("user_id", user.id).maybeSingle();
  if (!s) return NextResponse.json({ state: "none" });
  const { data: t } = await svc.from("tenant_settings").select("school_name,logo_url").eq("tenant_id", s.tenant_id).maybeSingle();
  return NextResponse.json({ state: s.status === "approved" ? "approved" : "waiting", name: s.full_name, class_name: (s as any).class_groups?.name ?? null,
    school: t?.school_name ?? (s as any).tenants?.name ?? null, logo_url: t?.logo_url || null }, { headers: { "Cache-Control": "no-store" } });
}
