import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { AGS, parseScore } from "@/lib/lti";
import { toolFromAccessToken, recordScore } from "@/lib/lti-server";

export const dynamic = "force-dynamic";

/**
 * Assignment and Grade Services for one tool link (each link has one line item):
 *   GET  …/ags/<link>                    the line items (one)
 *   GET  …/ags/<link>/lineitem           the line item
 *   POST …/ags/<link>/lineitem/scores    a student's score
 *   GET  …/ags/<link>/lineitem/results   results so far
 */
async function load(req: NextRequest, linkId: string, scope: string) {
  const svc = createServiceClient();
  const who = await toolFromAccessToken(svc, appUrl(req), req.headers.get("authorization"), scope);
  if (typeof who === "string") return { error: NextResponse.json({ error: who }, { status: 401 }) };
  if (!/^[0-9a-f-]{36}$/.test(linkId)) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  const { data: link } = await svc.from("lti_links").select("id,tenant_id,tool_id,title,homework_id,score_maximum,homework(max_score)").eq("id", linkId).maybeSingle();
  if (!link || link.tool_id !== who.toolId) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  return { svc, link };
}

function lineItem(base: string, link: any) {
  const max = Number(link.score_maximum ?? link.homework?.max_score ?? 100) || 100;
  return { id: `${base}/api/lti/ags/${link.id}/lineitem`, scoreMaximum: max, label: link.title, resourceLinkId: link.id };
}

export async function GET(req: NextRequest, props: { params: Promise<{ linkId: string; rest?: string[] }> }) {
  const { linkId, rest = [] } = await props.params;
  const path = rest.join("/");
  const scope = path === "lineitem/results" ? AGS.result : AGS.lineitem;
  const r = await load(req, linkId, scope);
  if ("error" in r) return r.error;
  const base = appUrl(req);
  if (path === "") return NextResponse.json([lineItem(base, r.link)], { headers: { "Content-Type": "application/vnd.ims.lis.v2.lineitemcontainer+json" } });
  if (path === "lineitem") return NextResponse.json(lineItem(base, r.link), { headers: { "Content-Type": "application/vnd.ims.lis.v2.lineitem+json" } });
  if (path === "lineitem/results") {
    const { data } = await r.svc.from("lti_scores").select("user_id,score_given,score_maximum,comment").eq("link_id", r.link.id);
    return NextResponse.json((data ?? []).map((s: any) => ({ id: `${base}/api/lti/ags/${r.link.id}/lineitem/results/${s.user_id}`, scoreOf: `${base}/api/lti/ags/${r.link.id}/lineitem`,
      userId: s.user_id, resultScore: s.score_given, resultMaximum: s.score_maximum, comment: s.comment })), { headers: { "Content-Type": "application/vnd.ims.lis.v2.resultcontainer+json" } });
  }
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function POST(req: NextRequest, props: { params: Promise<{ linkId: string; rest?: string[] }> }) {
  const { linkId, rest = [] } = await props.params;
  if (rest.join("/") !== "lineitem/scores") return NextResponse.json({ error: "not found" }, { status: 404 });
  const r = await load(req, linkId, AGS.score);
  if ("error" in r) return r.error;
  const s = parseScore(await req.json().catch(() => null));
  if (typeof s === "string") return NextResponse.json({ error: s }, { status: 400 });
  const problem = await recordScore(r.svc, r.link, s);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  return new NextResponse(null, { status: 204 });
}
