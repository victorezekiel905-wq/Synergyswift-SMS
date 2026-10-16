import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { platformKey } from "@/lib/lti-server";

export const dynamic = "force-dynamic";

/** The platform's public keys, for tools to check our launches (JWKS). */
export async function GET() {
  const svc = createServiceClient();
  await platformKey(svc);
  const { data } = await svc.from("lti_platform_keys").select("public_jwk").eq("active", true);
  return NextResponse.json({ keys: (data ?? []).map((k: any) => k.public_jwk) }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
