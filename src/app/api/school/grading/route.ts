import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { validateScheme, DEFAULT_SCHEME } from "@/lib/grading";

const SELECT = "id,name,is_default,pass_mark,show_position,show_class_average,cumulative_mode,decimals,created_at," +
  "grade_bands(id,grade,min_score,max_score,remark,grade_point),grading_components(id,name,max_score,weight,position)";

/** The school's grading schemes (each tenant defines its own). */
export async function GET() {
  const ctx = await requireCtx();
  if (ctx instanceof NextResponse) return ctx;
  const { data, error } = await ctx.sb.from("grading_schemes").select(SELECT)
    .eq("tenant_id", ctx.tenant.id).order("is_default", { ascending: false }).order("created_at");
  if (error) return jsonError(error.message);
  for (const s of data ?? []) {
    s.grade_bands?.sort((a: any, b: any) => b.min_score - a.min_score);
    s.grading_components?.sort((a: any, b: any) => a.position - b.position);
  }
  return NextResponse.json(data ?? []);
}

const SchemeBody = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(80),
  is_default: z.boolean().default(false),
  pass_mark: z.number().min(0).max(100),
  show_position: z.boolean(),
  show_class_average: z.boolean(),
  cumulative_mode: z.enum(["average", "weighted", "none"]).default("average"),
  decimals: z.number().int().min(0).max(3),
  components: z.array(z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(40),
    max_score: z.number().positive(),
    weight: z.number().min(0).max(100)
  })).min(1).max(12),
  bands: z.array(z.object({
    grade: z.string().trim().min(1).max(12),
    min_score: z.number().min(0).max(100),
    max_score: z.number().min(0).max(100),
    remark: z.string().trim().max(60).nullish(),
    grade_point: z.number().min(0).max(10).nullish()
  })).min(1).max(20)
});

/**
 * Create or replace a scheme. Components keep their ids when supplied so
 * already-entered scores stay attached; removed components are deleted only
 * if no scores reference them.
 */
export async function PUT(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const body = await readJson(req);
  const parsed = SchemeBody.safeParse(body.template === "default" ? { ...DEFAULT_SCHEME, show_position: true, show_class_average: true, decimals: 1 } : body);
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const s = parsed.data;
  const problems = validateScheme({ components: s.components.map((c, i) => ({ ...c, id: c.id ?? String(i) })), bands: s.bands });
  if (problems.length) return jsonError(problems.join(" "));
  const tid = ctx.tenant.id;
  const sb = ctx.sb;

  const fields = { name: s.name, is_default: s.is_default, pass_mark: s.pass_mark, show_position: s.show_position,
    show_class_average: s.show_class_average, cumulative_mode: s.cumulative_mode, decimals: s.decimals };
  let schemeId = s.id;
  if (schemeId) {
    const { error } = await sb.from("grading_schemes").update(fields).eq("tenant_id", tid).eq("id", schemeId);
    if (error) return jsonError(error.message);
  } else {
    const { data, error } = await sb.from("grading_schemes").insert({ ...fields, tenant_id: tid }).select("id").single();
    if (error) return jsonError(error.message);
    schemeId = data.id;
  }
  if (s.is_default) {
    await sb.from("grading_schemes").update({ is_default: false }).eq("tenant_id", tid).neq("id", schemeId);
  }

  // Components: update / insert / delete-if-unused
  const { data: existing } = await sb.from("grading_components").select("id").eq("scheme_id", schemeId);
  const keep = new Set(s.components.filter(c => c.id).map(c => c.id));
  for (const old of existing ?? []) {
    if (keep.has(old.id)) continue;
    const { count } = await sb.from("score_entries").select("id", { count: "exact", head: true }).eq("component_id", old.id);
    if ((count ?? 0) > 0) return jsonError("A component you removed already has scores. Keep it, or set its weight to 0.");
    await sb.from("grading_components").delete().eq("id", old.id);
  }
  for (let i = 0; i < s.components.length; i++) {
    const c = s.components[i];
    const row = { scheme_id: schemeId, name: c.name, max_score: c.max_score, weight: c.weight, position: i + 1 };
    const { error } = c.id
      ? await sb.from("grading_components").update(row).eq("id", c.id).eq("scheme_id", schemeId)
      : await sb.from("grading_components").insert(row);
    if (error) return jsonError(error.message);
  }
  await sb.from("grade_bands").delete().eq("scheme_id", schemeId);
  const { error: bErr } = await sb.from("grade_bands").insert(s.bands.map(b => ({ ...b, scheme_id: schemeId })));
  if (bErr) return jsonError(bErr.message);

  await sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "grading.saved", target: schemeId });
  return NextResponse.json({ id: schemeId });
}
