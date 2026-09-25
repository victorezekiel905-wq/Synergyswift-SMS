import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";

export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const { data, error } = await ctx.sb.from("exams")
    .select("id,title,status,duration_minutes,opens_at,closes_at,access_code,results_released,created_at,settings,class_groups(name),subjects(name),exam_questions(count),exam_attempts(count)")
    .eq("tenant_id", ctx.tenant.id).order("created_at", { ascending: false }).limit(300);
  return error ? jsonError(error.message) : NextResponse.json(data ?? []);
}

const Create = z.object({
  title: z.string().trim().min(2).max(160),
  subject_id: z.string().uuid().nullish(),
  class_group_id: z.string().uuid().nullish(),
  duration_minutes: z.number().int().min(1).max(600).default(60)
});

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Create.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const { data: s } = await ctx.sb.from("tenant_settings").select("exam_violation_limit").eq("tenant_id", ctx.tenant.id).maybeSingle();
  const { data, error } = await ctx.sb.from("exams").insert({
    ...parsed.data, tenant_id: ctx.tenant.id, created_by: ctx.userId,
    settings: {
      shuffle_questions: false, shuffle_options: true, require_fullscreen: true, block_copy_paste: true,
      violation_limit: s?.exam_violation_limit ?? 3, show_score_after_submit: false, allow_review: false,
      require_seb: false, seb_browser_keys: [], seb_config_keys: [], allow_spellcheck: false
    }
  }).select("id").single();
  return error ? jsonError(error.message) : NextResponse.json(data, { status: 201 });
}
