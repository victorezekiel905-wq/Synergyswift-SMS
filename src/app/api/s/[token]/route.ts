import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { appUrl } from "@/lib/school";
import { surveyByToken, submitSurvey, CrmError } from "@/lib/community-server";

export const dynamic = "force-dynamic";

/** A family's survey from their private link. */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const svc = createServiceClient();
  const inv = await surveyByToken(svc, (await props.params).token);
  if (!inv) return jsonError("This survey link is not valid.", 404);
  const { data: s } = await svc.from("tenant_settings").select("school_name,logo_url,brand_color").eq("tenant_id", inv.tenant_id).maybeSingle();
  const sv = inv.surveys;
  const closed = sv.status !== "open" || (sv.closes_at && new Date(sv.closes_at) < new Date());
  return NextResponse.json({
    survey: { title: sv.title, intro: sv.intro, questions: sv.questions, anonymous: sv.anonymous },
    answered: Boolean(inv.responded_at), closed: Boolean(closed), name: sv.anonymous ? null : inv.guardians?.full_name ?? null,
    school: { name: s?.school_name ?? "School", logo_url: s?.logo_url ?? null, brand_color: s?.brand_color ?? null }
  });
}

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const body = await readJson<{ answers?: Record<string, unknown> }>(req);
  if (!body.answers || typeof body.answers !== "object") return jsonError("send your answers");
  try {
    return NextResponse.json(await submitSurvey(createServiceClient(), (await props.params).token, body.answers, appUrl(req)));
  } catch (e) {
    return e instanceof CrmError ? jsonError(e.message, e.status) : jsonError((e as Error).message);
  }
}
