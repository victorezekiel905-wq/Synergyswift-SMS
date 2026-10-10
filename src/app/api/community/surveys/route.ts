import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { fetchAll } from "@/lib/results";
import { sendSurvey, audienceGuardianIds, CrmError } from "@/lib/community-server";
import { npsSummary, summariseQuestions, DEFAULT_SURVEY, type Question } from "@/lib/community";
import { SegmentRulesSchema } from "@/lib/community-schemas";

export const dynamic = "force-dynamic";

/** Surveys with response rates and NPS; ?id= adds the full results. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "community");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const id = new URL(req.url).searchParams.get("id");
  const svc = createServiceClient();
  if (id) {
    const { data: s } = await ctx.sb.from("surveys").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!s) return jsonError("survey not found", 404);
    const [responses, invites] = await Promise.all([
      fetchAll<any>(() => svc.from("survey_responses").select("id,nps,answers,created_at,guardians(id,full_name)").eq("survey_id", id).order("created_at", { ascending: false })),
      fetchAll<any>(() => svc.from("survey_invites").select("responded_at").eq("survey_id", id).order("id"))
    ]);
    // Over time: NPS per month, so schools see whether things are improving.
    const months = new Map<string, number[]>();
    for (const r of responses) if (r.nps !== null) { const m = r.created_at.slice(0, 7); if (!months.has(m)) months.set(m, []); months.get(m)!.push(r.nps); }
    return NextResponse.json({
      survey: s, invited: invites.length, responded: invites.filter(i => i.responded_at).length,
      nps: npsSummary(responses.map(r => r.nps)), questions: summariseQuestions(s.questions as Question[], responses),
      trend: [...months.entries()].sort().map(([month, scores]) => ({ month, ...npsSummary(scores) })),
      responses: s.anonymous ? responses.map(r => ({ ...r, guardians: null })) : responses.slice(0, 500)
    });
  }
  const { data, error } = await ctx.sb.from("surveys").select("id,title,status,anonymous,created_at,sent_at,closes_at,audience").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(100);
  if (error) return jsonError(error.message);
  const ids = (data ?? []).map((s: any) => s.id);
  const [inv, resp] = ids.length ? await Promise.all([
    fetchAll<any>(() => svc.from("survey_invites").select("survey_id,responded_at").in("survey_id", ids).order("id")),
    fetchAll<any>(() => svc.from("survey_responses").select("survey_id,nps").in("survey_id", ids).order("id"))
  ]) : [[], []];
  const [{ data: segments }, { data: classes }] = await Promise.all([
    ctx.sb.from("family_segments").select("id,name").eq("tenant_id", tid).order("name"),
    svc.from("class_groups").select("id,name").eq("tenant_id", tid).order("name")
  ]);
  return NextResponse.json({
    items: (data ?? []).map((s: any) => {
      const i = inv.filter(x => x.survey_id === s.id);
      return { ...s, invited: i.length, responded: i.filter(x => x.responded_at).length, nps: npsSummary(resp.filter(r => r.survey_id === s.id).map(r => r.nps)).nps };
    }),
    overall: npsSummary(resp.map(r => r.nps)),
    template: DEFAULT_SURVEY, segments: segments ?? [], classes: classes ?? []
  });
}

const QuestionSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9_]{1,30}$/), type: z.enum(["nps", "rating", "choice", "text"]), label: z.string().trim().min(2).max(300),
  options: z.array(z.string().trim().min(1).max(100)).max(12).optional(), required: z.boolean().optional()
}).refine(q => q.type !== "choice" || (q.options?.length ?? 0) >= 2, "multiple-choice questions need at least two options");
const Audience = z.object({ class_group_ids: z.array(z.string().uuid()).max(200).optional(), segment_id: z.string().uuid().nullish(), rules: SegmentRulesSchema.nullish() });
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().nullish(), title: z.string().trim().min(2).max(160), intro: z.string().trim().max(1000).nullish(),
    questions: z.array(QuestionSchema).min(1).max(25), anonymous: z.boolean().default(false), audience: Audience.default({}), closes_at: z.string().datetime({ offset: true }).nullish() }),
  z.object({ action: z.literal("count"), audience: Audience }),
  z.object({ action: z.literal("send"), id: z.string().uuid() }),
  z.object({ action: z.literal("remind"), id: z.string().uuid() }),
  z.object({ action: z.literal("close"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "community");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  try {
    switch (b.action) {
      case "save": {
        if (new Set(b.questions.map(q => q.id)).size !== b.questions.length) return jsonError("each question needs a different id");
        if (b.questions.filter(q => q.type === "nps").length > 1) return jsonError("a survey can have only one NPS question");
        const row = { title: b.title, intro: b.intro ?? null, questions: b.questions, anonymous: b.anonymous, audience: b.audience, closes_at: b.closes_at ?? null };
        if (b.id) {
          // Once families have answered, the questions are fixed so results stay comparable.
          const { count } = await svc.from("survey_responses").select("id", { count: "exact", head: true }).eq("survey_id", b.id);
          const patch = count ? { closes_at: row.closes_at, intro: row.intro, audience: row.audience } : row;
          const { error } = await ctx.sb.from("surveys").update(patch).eq("tenant_id", tid).eq("id", b.id);
          if (error) return jsonError(error.message);
          return NextResponse.json({ ok: true, id: b.id, locked: Boolean(count) });
        }
        const { data, error } = await ctx.sb.from("surveys").insert({ ...row, tenant_id: tid, created_by: ctx.userId }).select("id").single();
        return error ? jsonError(error.message) : NextResponse.json({ ok: true, id: data.id }, { status: 201 });
      }
      case "count":
        return NextResponse.json({ families: (await audienceGuardianIds(svc, tid, b.audience)).length });
      case "send":
      case "remind": {
        const { data: s } = await ctx.sb.from("surveys").select("id").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
        if (!s) return jsonError("survey not found", 404);
        const r = await sendSurvey(svc, { tenantId: tid, surveyId: b.id, baseUrl: appUrl(req), remind: b.action === "remind" });
        return NextResponse.json({ ok: true, ...r });
      }
      case "close": {
        const { error } = await ctx.sb.from("surveys").update({ status: "closed" }).eq("tenant_id", tid).eq("id", b.id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "delete": {
        const { error } = await ctx.sb.from("surveys").delete().eq("tenant_id", tid).eq("id", b.id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
    }
  } catch (e) {
    if (e instanceof CrmError) return jsonError(e.message, e.status);
    return jsonError((e as Error).message);
  }
}
