import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { decodeJwt, verifyJwt, checkClientAssertion, AGS } from "@/lib/lti";
import { toolKey, issueAccessToken } from "@/lib/lti-server";

export const dynamic = "force-dynamic";

const err = (error: string, description: string, status = 400) => NextResponse.json({ error, error_description: description }, { status });

/** OAuth 2 client-credentials for tools (signed JWT assertion), giving access to the grade services. */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const get = (k: string) => (form?.get(k) as string | null) ?? null;
  if (get("grant_type") !== "client_credentials") return err("unsupported_grant_type", "use client_credentials");
  if (get("client_assertion_type") !== "urn:ietf:params:oauth:client-assertion-type:jwt-bearer") return err("invalid_request", "client_assertion_type must be jwt-bearer");
  const assertion = get("client_assertion") ?? "";
  const clientId = decodeJwt(assertion)?.payload.iss;
  if (!clientId) return err("invalid_client", "unreadable client_assertion", 401);
  const svc = createServiceClient();
  const { data: tool } = await svc.from("lti_tools").select("id,client_id,jwks_url,public_key_pem,grades,active").eq("client_id", clientId).maybeSingle();
  if (!tool?.active || !tool.grades) return err("invalid_client", "unknown tool, or grades are turned off for it", 401);
  const tokenUrl = `${appUrl(req)}/api/lti/token`;
  let claims: Record<string, any> | string;
  try { claims = verifyJwt(assertion, await toolKey(tool, assertion)); } catch (e) { return err("invalid_client", (e as Error).message, 401); }
  if (typeof claims === "string") return err("invalid_client", claims, 401);
  const bad = checkClientAssertion(claims, tool.client_id, tokenUrl);
  if (bad) return err("invalid_client", bad, 401);
  const allowed = [AGS.lineitem, AGS.score, AGS.result];
  const scope = (get("scope") ?? "").split(" ").filter(s => allowed.includes(s)).join(" ") || allowed.join(" ");
  return NextResponse.json({ access_token: await issueAccessToken(svc, appUrl(req), tool.id, scope), token_type: "Bearer", expires_in: 3600, scope },
    { headers: { "Cache-Control": "no-store" } });
}
