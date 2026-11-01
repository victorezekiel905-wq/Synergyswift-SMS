import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { validateScheme, DEFAULT_SCHEME } from "@/lib/grading";

const SELECT = "id,name,is_default,pass_mark,show_position,show_class_average,cumulative_mode,decimals,template,created_at," +
  "grade_bands(id,grade,min_score,max_score,remark,grade_point),grading_components(id,name,max_score,weight,position,midterm)";
const MISSING = "This needs the database update (migration 20260101009200_results_portal_early_years).";

/** The school's grading schemes (each tenant defines its own), with the stage each is for (9200) when the database has it. */
export async function GET() {
  const ctx = await requireCtx();
  if (ctx instanceof NextResponse) return ctx;
  const q = (cols: string) => ctx.sb.from("grading_schemes").select(cols)
    .eq("tenant_id", ctx.tenant.id).order("is_default", { ascending: false }).order("created_at");
  let { data, error } = await q(SELECT + ",stage,subject_parts");
  if (error && /stage|subject_parts/.test(error.message)) ({ data, error } = await q(SELECT));
  if (error) return jsonError(error.message);
  for (const s of (data ?? []) as any[]) {
    s.stage ??= null;
    s.subject_parts ??= false;
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
  report_layout: z.enum(["nigerian", "british", "american", "early_years"]).default("nigerian"),
  stage: z.enum(["preschool", "primary", "secondary", "sixth_form"]).nullish(),
  // Let the teachers of each subject set their own parts (9200). Grades, pass mark and layout stay as set here.
  subject_parts: z.boolean().optional(),
  decimals: z.number().int().min(0).max(3),
  components: z.array(z.object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(40),
    max_score: z.number().positive(),
    weight: z.number().min(0).max(100),
    midterm: z.boolean().default(false)
  })).max(12),
  bands: z.array(z.object({
    grade: z.string().trim().min(1).max(12),
    min_score: z.number().min(0).max(100),
    max_score: z.number().min(0).max(100),
    remark: z.string().trim().max(60).nullish(),
    grade_point: z.number().min(0).max(10).nullish()
  })).max(20),
  // The classes that use this system. Leaving it out keeps them as they are.
  class_group_ids: z.array(z.string().uuid()).max(500).optional()
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
  // Preschool is rated against the early-years checklist, so it has no marks or grade bands.
  const earlyYears = s.report_layout === "early_years";
  if (earlyYears) { s.components = []; s.bands = []; s.show_position = false; s.show_class_average = false; s.cumulative_mode = "none"; s.stage = "preschool"; }
  else {
    const problems = validateScheme({ components: s.components.map((c, i) => ({ ...c, id: c.id ?? String(i) })), bands: s.bands });
    if (problems.length) return jsonError(problems.join(" "));
  }
  const tid = ctx.tenant.id;
  const sb = ctx.sb;

  const fields: Record<string, unknown> = { name: s.name, is_default: earlyYears ? false : s.is_default, pass_mark: s.pass_mark, show_position: s.show_position,
    show_class_average: s.show_class_average, cumulative_mode: s.cumulative_mode, decimals: s.decimals, template: s.report_layout };
  if (s.stage !== undefined) fields.stage = s.stage;
  if (s.subject_parts !== undefined && !earlyYears) fields.subject_parts = s.subject_parts;
  const migrationNeeded = (m: string) => /stage|subject_parts|template_check|early_years/.test(m);
  let schemeId = s.id;
  if (schemeId) {
    const { error } = await sb.from("grading_schemes").update(fields).eq("tenant_id", tid).eq("id", schemeId);
    if (error) return jsonError(migrationNeeded(error.message) ? MISSING : error.message);
  } else {
    const { data, error } = await sb.from("grading_schemes").insert({ ...fields, tenant_id: tid }).select("id").single();
    if (error) return jsonError(migrationNeeded(error.message) ? MISSING : error.message);
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
    const row = { scheme_id: schemeId, name: c.name, max_score: c.max_score, weight: c.weight, midterm: c.midterm, position: i + 1 };
    const { error } = c.id
      ? await sb.from("grading_components").update(row).eq("id", c.id).eq("scheme_id", schemeId)
      : await sb.from("grading_components").insert(row);
    if (error) return jsonError(error.message);
  }
  await sb.from("grade_bands").delete().eq("scheme_id", schemeId);
  if (s.bands.length) {
    const { error: bErr } = await sb.from("grade_bands").insert(s.bands.map(b => ({ ...b, scheme_id: schemeId })));
    if (bErr) return jsonError(bErr.message);
  }

  // The ticked classes use this system; classes that were on it and are no longer ticked go back to the school default.
  let assigned: number | undefined;
  if (s.class_group_ids) {
    const { error: offErr } = await sb.from("class_groups").update({ scheme_id: null }).eq("tenant_id", tid).eq("scheme_id", schemeId)
      .not("id", "in", `(${s.class_group_ids.length ? s.class_group_ids.join(",") : "00000000-0000-0000-0000-000000000000"})`);
    if (offErr) return jsonError(offErr.message);
    if (s.class_group_ids.length) {
      const { error: onErr } = await sb.from("class_groups").update({ scheme_id: schemeId }).eq("tenant_id", tid).in("id", s.class_group_ids);
      if (onErr) return jsonError(onErr.message);
    }
    assigned = s.class_group_ids.length;
  }

  await sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "grading.saved", target: schemeId, meta: { classes: assigned ?? null } });
  return NextResponse.json({ id: schemeId, classes: assigned });
}

/** Delete a grading system nobody has entered marks against. Its classes go back to the school default. */
export async function DELETE(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return jsonError("which grading system?");
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  const { data: scheme } = await sb.from("grading_schemes").select("id,name,grading_components(id)").eq("tenant_id", tid).eq("id", id).maybeSingle();
  if (!scheme) return jsonError("grading system not found", 404);
  const componentIds = ((scheme as any).grading_components ?? []).map((c: any) => c.id);
  if (componentIds.length) {
    const { count } = await sb.from("score_entries").select("id", { count: "exact", head: true }).eq("tenant_id", tid).in("component_id", componentIds);
    if ((count ?? 0) > 0) return jsonError("Marks have already been entered with this grading system, so it can't be deleted. Move its classes to another system instead.");
  }
  await sb.from("class_groups").update({ scheme_id: null }).eq("tenant_id", tid).eq("scheme_id", id);
  const { error } = await sb.from("grading_schemes").delete().eq("tenant_id", tid).eq("id", id);
  if (error) return jsonError(error.message);
  await sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "grading.deleted", target: id, meta: { name: (scheme as any).name } });
  return NextResponse.json({ ok: true });
}
