import { NextRequest, NextResponse } from "next/server";
import { requireCtx, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

/**
 * Opens a learning tool for the signed-in person: records a single-use launch
 * and sends the browser to the tool's sign-in address (OIDC third-party login).
 * Students can open only their own class's tools (row-level security).
 */
export async function GET(req: NextRequest, props: { params: Promise<{ linkId: string }> }) {
  const ctx = await requireCtx();
  if (ctx instanceof NextResponse) return ctx;
  const { linkId } = await props.params;
  const { data: link } = await ctx.sb.from("lti_links").select("id,tool_id,target_link_uri").eq("tenant_id", ctx.tenant.id).eq("id", linkId).maybeSingle();
  if (!link) return jsonError("This tool is not available to you.", 404);
  const svc = createServiceClient();
  const { data: tool } = await svc.from("lti_tools").select("client_id,deployment_id,oidc_login_url,target_link_uri,active").eq("id", link.tool_id).maybeSingle();
  if (!tool?.active) return jsonError("This tool has been switched off by the school.", 409);
  const { data: launch, error } = await svc.from("lti_launches").insert({ tenant_id: ctx.tenant.id, link_id: link.id, user_id: ctx.userId }).select("id").single();
  if (error) return jsonError(error.message);
  const to = new URL(tool.oidc_login_url);
  to.searchParams.set("iss", appUrl(req));
  to.searchParams.set("login_hint", launch.id);
  to.searchParams.set("lti_message_hint", launch.id);
  to.searchParams.set("target_link_uri", link.target_link_uri ?? tool.target_link_uri);
  to.searchParams.set("client_id", tool.client_id);
  to.searchParams.set("lti_deployment_id", tool.deployment_id);
  return NextResponse.redirect(to.toString(), 302);
}
