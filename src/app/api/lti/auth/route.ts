import { NextRequest, NextResponse } from "next/server";
import { getCtx } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { checkAuthRequest, launchClaims, signJwt, autoPostPage } from "@/lib/lti";
import { platformKey } from "@/lib/lti-server";

export const dynamic = "force-dynamic";

const page = (title: string, text: string, status = 400) =>
  new NextResponse(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;padding:40px;text-align:center"><h1>${title}</h1><p>${text.replace(/[<>&]/g, "")}</p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

/**
 * The tool's sign-in request (OIDC authorization). The login hint is the
 * single-use launch made when the person clicked the tool; if a session is
 * present it must be the same person. Answers by posting the signed launch
 * (id_token) to the tool's registered address.
 */
async function handle(req: NextRequest, p: URLSearchParams) {
  const svc = createServiceClient();
  const clientId = p.get("client_id");
  const { data: tool } = clientId ? await svc.from("lti_tools").select("*").eq("client_id", clientId).maybeSingle() : { data: null };
  if (!tool?.active) return page("Tool not available", "This learning tool is not set up or has been switched off.");
  const hint = p.get("login_hint") ?? "";
  const { data: launch } = /^[0-9a-f-]{36}$/.test(hint) ? await svc.from("lti_launches").select("id,tenant_id,link_id,user_id,created_at,used_at").eq("id", hint).maybeSingle() : { data: null };
  const problem = checkAuthRequest(Object.fromEntries(p.entries()), tool, launch, Date.now());
  if (problem) return page("Could not open the tool", problem);
  if (launch!.tenant_id !== tool.tenant_id) return page("Could not open the tool", "this tool belongs to another school");
  const hintMsg = p.get("lti_message_hint");
  if (hintMsg && hintMsg !== launch!.id) return page("Could not open the tool", "the launch does not match");
  const ctx = await getCtx().catch(() => null);
  if (ctx && ctx.userId !== launch!.user_id) return page("Could not open the tool", "you are signed in as someone else; open the tool again");
  // Single use.
  const { data: claimed } = await svc.from("lti_launches").update({ used_at: new Date().toISOString() }).eq("id", launch!.id).is("used_at", null).select("id");
  if (!claimed?.length) return page("Could not open the tool", "this launch was already used");

  const [{ data: link }, { data: user }, { data: school }] = await Promise.all([
    svc.from("lti_links").select("id,title,target_link_uri,custom,class_group_id,score_maximum,class_groups(name),subjects(name)").eq("id", launch!.link_id).maybeSingle(),
    svc.from("users").select("id,full_name,email,role,extra_roles").eq("id", launch!.user_id).maybeSingle(),
    svc.from("tenant_settings").select("school_name").eq("tenant_id", tool.tenant_id).maybeSingle()
  ]);
  if (!link || !user) return page("Could not open the tool", "the link or account no longer exists");
  const base = appUrl(req);
  const [given, ...rest] = String(user.full_name ?? "").split(" ");
  const k = await platformKey(svc);
  const claims = launchClaims({
    issuer: base, clientId: tool.client_id, deploymentId: tool.deployment_id, nonce: p.get("nonce")!, nowSec: Math.floor(Date.now() / 1000),
    user: { id: user.id, name: tool.send_name ? user.full_name : null, given: tool.send_name ? given : null, family: tool.send_name ? rest.join(" ") || null : null,
      email: tool.send_email ? user.email : null, roles: [user.role, ...(user.extra_roles ?? [])] },
    link: { id: link.id, title: link.title, targetLinkUri: link.target_link_uri ?? tool.target_link_uri, custom: { ...(tool.custom ?? {}), ...(link.custom ?? {}) } },
    context: link.class_group_id ? { id: link.class_group_id, label: (link as any).class_groups?.name ?? "", title: [(link as any).class_groups?.name, (link as any).subjects?.name].filter(Boolean).join(" ") } : null,
    platform: { guid: tool.tenant_id, name: school?.school_name ?? "School" },
    returnUrl: `${base}/student`,
    ags: tool.grades ? { lineitem: `${base}/api/lti/ags/${link.id}/lineitem`, lineitems: `${base}/api/lti/ags/${link.id}` } : null
  });
  const idToken = signJwt(claims, k.private_pem, k.kid);
  return new NextResponse(autoPostPage(p.get("redirect_uri")!, { id_token: idToken, ...(p.get("state") ? { state: p.get("state")! } : {}) }, `Opening ${link.title}…`),
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  return handle(req, new URL(req.url).searchParams);
}
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const p = new URLSearchParams();
  form?.forEach((v, k) => { if (typeof v === "string") p.set(k, v); });
  return handle(req, p);
}
