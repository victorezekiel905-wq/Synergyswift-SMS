import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { FRAMEWORKS, GRADING, stage, planCurriculum, curriculumLabel } from "@/lib/curricula";

export const dynamic = "force-dynamic";

/** Sections (Nursery, Primary, Secondary …), their classes and frameworks, and the framework catalogue. */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const [{ data: sections }, { data: classes }, { data: settings }] = await Promise.all([
    ctx.sb.from("school_sections").select("id,name,kind,curriculum,head_user_id,position").eq("tenant_id", tid).order("position").order("name"),
    ctx.sb.from("class_groups").select("id,name,level,section_id,curriculum,scheme_id").eq("tenant_id", tid).order("name"),
    ctx.sb.from("tenant_settings").select("curriculum").eq("tenant_id", tid).maybeSingle()
  ]);
  return NextResponse.json({
    sections: (sections ?? []).map((s: any) => ({ ...s, curriculum_label: curriculumLabel(s.curriculum), classes: (classes ?? []).filter((c: any) => c.section_id === s.id).length })),
    classes: (classes ?? []).map((c: any) => ({ ...c, curriculum_label: curriculumLabel(c.curriculum) })),
    unsectioned: (classes ?? []).filter((c: any) => !c.section_id).length,
    curriculum: settings?.curriculum ?? null,
    frameworks: FRAMEWORKS.map(f => ({ key: f.key, name: f.name, summary: f.summary, stages: f.stages.map(s => ({ key: s.key, name: s.name, kind: s.kind, levels: s.levels, exam: s.exam ?? null,
      subjects: s.subjects.length, grading: GRADING[s.grading].name })) }))
  });
}

const StageKey = z.string().refine(k => Boolean(stage(k)), "unknown curriculum stage");
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().nullish(), name: z.string().trim().min(1).max(60), kind: z.enum(["nursery", "primary", "secondary", "sixth_form", "other"]),
    curriculum: StageKey.nullish(), head_user_id: z.string().uuid().nullish(), position: z.number().int().min(0).max(100).default(0) }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("assign"), class_group_ids: z.array(z.string().uuid()).min(1).max(500), section_id: z.string().uuid().nullable(), curriculum: StageKey.nullish() }),
  z.object({ action: z.literal("plan"), stages: z.array(StageKey).min(1).max(12), arms: z.array(z.string().trim().max(20)).max(12).default([]) }),
  z.object({ action: z.literal("apply"), stages: z.array(StageKey).min(1).max(12), arms: z.array(z.string().trim().max(20)).max(12).default([]),
    subjects: z.boolean().default(true), grading: z.boolean().default(true) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;

  if (b.action === "save") {
    const row = { tenant_id: tid, name: b.name, kind: b.kind, curriculum: b.curriculum ?? null, head_user_id: b.head_user_id ?? null, position: b.position };
    const { data, error } = b.id
      ? await sb.from("school_sections").update(row).eq("tenant_id", tid).eq("id", b.id).select("id").single()
      : await sb.from("school_sections").insert(row).select("id").single();
    return error ? jsonError(error.message.includes("duplicate") ? "a section with that name exists" : error.message) : NextResponse.json({ ok: true, id: data.id });
  }
  if (b.action === "delete") {
    const { error } = await sb.from("school_sections").delete().eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "assign") {
    const patch: Record<string, unknown> = { section_id: b.section_id };
    if (b.curriculum !== undefined) patch.curriculum = b.curriculum;
    const { error } = await sb.from("class_groups").update(patch).eq("tenant_id", tid).in("id", b.class_group_ids);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }

  const [{ data: classes }, { data: subjects }] = await Promise.all([
    sb.from("class_groups").select("id,name").eq("tenant_id", tid),
    sb.from("subjects").select("id,name").eq("tenant_id", tid)
  ]);
  const plan = planCurriculum({ stages: b.stages, arms: b.arms, existingClasses: (classes ?? []).map((c: any) => c.name), existingSubjects: (subjects ?? []).map((s: any) => s.name) });
  if (b.action === "plan") {
    return NextResponse.json({ sections: plan.sections, classes: plan.classes.map(c => c.name), subjects: plan.subjects, offerings: plan.offerings.length,
      grading: plan.grading.map(g => GRADING[g].name), existing_classes: b.stages.flatMap(k => stage(k)!.stage.levels).length * Math.max(1, b.arms.filter(Boolean).length) - plan.classes.length });
  }

  // apply: sections, grading schemes, classes, subjects, and which subjects each class takes.
  const sectionId = new Map<string, string>();
  const { data: existingSections } = await sb.from("school_sections").select("id,name").eq("tenant_id", tid);
  for (const [i, s] of plan.sections.entries()) {
    const found = (existingSections ?? []).find((x: any) => x.name.toLowerCase() === s.name.toLowerCase());
    if (found) { sectionId.set(s.stage, found.id); await sb.from("school_sections").update({ curriculum: s.stage, kind: s.kind }).eq("id", found.id); continue; }
    const { data, error } = await sb.from("school_sections").insert({ tenant_id: tid, name: s.name, kind: s.kind, curriculum: s.stage, position: i }).select("id").single();
    if (error) return jsonError(error.message);
    sectionId.set(s.stage, data.id);
  }
  const schemeId = new Map<string, string>();
  if (b.grading) {
    const { data: schemes } = await sb.from("grading_schemes").select("id,name").eq("tenant_id", tid);
    for (const key of plan.grading) {
      const g = GRADING[key];
      const found = (schemes ?? []).find((s: any) => s.name === g.name);
      if (found) { schemeId.set(key, found.id); continue; }
      const { data: sc, error } = await sb.from("grading_schemes").insert({ tenant_id: tid, name: g.name, pass_mark: g.pass_mark, template: g.template, show_position: g.show_position }).select("id").single();
      if (error) return jsonError(error.message);
      await sb.from("grading_components").insert(g.components.map((c, i) => ({ ...c, scheme_id: sc.id, position: i + 1 })));
      await sb.from("grade_bands").insert(g.bands.map(x => ({ ...x, scheme_id: sc.id })));
      schemeId.set(key, sc.id);
    }
  }
  const classId = new Map<string, string>((classes ?? []).map((c: any) => [c.name.toLowerCase(), c.id]));
  for (const c of plan.classes) {
    const st = stage(c.stage)!.stage;
    const { data, error } = await sb.from("class_groups").insert({ tenant_id: tid, name: c.name, level: c.level, section_id: sectionId.get(c.stage), scheme_id: schemeId.get(st.grading) ?? null }).select("id").single();
    if (error) return jsonError(error.message);
    classId.set(c.name.toLowerCase(), data.id);
  }
  // Existing classes with the same names join the section too.
  for (const key of b.stages) {
    const st = stage(key)!.stage;
    const names = st.levels.flatMap(l => (b.arms.filter(Boolean).length ? b.arms.filter(Boolean).map(a => `${l} ${a.trim()}`) : [l])).map(n => n.toLowerCase());
    const ids = names.map(n => classId.get(n)).filter(Boolean) as string[];
    if (ids.length) await sb.from("class_groups").update({ section_id: sectionId.get(key) }).eq("tenant_id", tid).in("id", ids).is("section_id", null);
  }
  let offered = 0;
  if (b.subjects) {
    const subjectId = new Map<string, string>((subjects ?? []).map((s: any) => [s.name.toLowerCase(), s.id]));
    if (plan.subjects.length) {
      const { data, error } = await sb.from("subjects").insert(plan.subjects.map(name => ({ tenant_id: tid, name }))).select("id,name");
      if (error) return jsonError(error.message);
      for (const s of data ?? []) subjectId.set(s.name.toLowerCase(), s.id);
    }
    const rows = plan.offerings.map(o => ({ tenant_id: tid, class_group_id: classId.get(o.class.toLowerCase()), subject_id: subjectId.get(o.subject.toLowerCase()) }))
      .filter(r => r.class_group_id && r.subject_id);
    for (let i = 0; i < rows.length; i += 500) {
      const { data, error } = await sb.from("subject_offerings").upsert(rows.slice(i, i + 500), { onConflict: "class_group_id,subject_id", ignoreDuplicates: true }).select("id");
      if (error) return jsonError(error.message);
      offered += data?.length ?? 0;
    }
  }
  const frameworks = [...new Set(b.stages.map(k => stage(k)!.framework.key))];
  await sb.from("tenant_settings").upsert({ tenant_id: tid, curriculum: frameworks.length === 1 ? frameworks[0] : "mixed" }, { onConflict: "tenant_id" });
  await sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "curriculum.applied", meta: { stages: b.stages, classes: plan.classes.length, subjects: plan.subjects.length } });
  return NextResponse.json({ ok: true, sections: plan.sections.length, classes: plan.classes.length, subjects: b.subjects ? plan.subjects.length : 0, offerings: offered, grading: schemeId.size });
}
