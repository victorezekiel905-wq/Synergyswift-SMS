import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { schemeFor, subjectPartsFor } from "@/lib/school";
import { validateScheme } from "@/lib/grading";

export const dynamic = "force-dynamic";

const MISSING = "This needs the database update (migration 20260101009200_results_portal_early_years).";
type Ctx = Exclude<Awaited<ReturnType<typeof requireCtx>>, NextResponse>;
type Target = { classId: string; className: string; level: string | null; subjectName: string; offeringId: string; teacherId: string | null };

/** One subject in one class, with the facts that decide whether this person may set its parts. */
async function target(ctx: Ctx, classId: string, subjectId: string): Promise<Target | null> {
  const { data } = await ctx.sb.from("subject_offerings").select("id,teacher_id,class_groups(name,level),subjects(name)")
    .eq("tenant_id", ctx.tenant.id).eq("class_group_id", classId).eq("subject_id", subjectId).maybeSingle();
  if (!data) return null;
  const d = data as any;
  return { classId, className: d.class_groups?.name ?? "the class", level: d.class_groups?.level ?? null, subjectName: d.subjects?.name ?? "the subject", offeringId: d.id, teacherId: d.teacher_id };
}

/** Admins always; the subject's teacher when the class's grading system lets subject teachers set their own parts. */
async function allowed(ctx: Ctx, t: Target) {
  const scheme = await schemeFor(ctx.sb, ctx.tenant.id, t.classId);
  if (!scheme) return { ok: false as const, why: "This class has no grading system yet.", scheme };
  if (scheme.template === "early_years") return { ok: false as const, why: "Preschool classes use the early years checklist, not marks.", scheme };
  if (hasAny(ctx, ROLES.admin)) return { ok: true as const, scheme };
  if (t.teacherId !== ctx.userId) return { ok: false as const, why: `Only the ${t.subjectName} teacher for ${t.className} (or an admin) can set its parts.`, scheme };
  if (!scheme.subject_parts) return { ok: false as const, why: `The school sets the parts for ${t.className}. An admin can let subject teachers set their own under Results → Grading systems.`, scheme };
  return { ok: true as const, scheme };
}

/** Marks already entered for this subject in this class against the given parts (any term). */
async function marksOn(ctx: Ctx, classId: string, subjectId: string, partIds: string[]) {
  if (!partIds.length) return 0;
  const { data: kids } = await ctx.sb.from("students").select("id").eq("tenant_id", ctx.tenant.id).eq("class_group_id", classId);
  const ids = (kids ?? []).map((k: any) => k.id);
  if (!ids.length) return 0;
  const { count } = await ctx.sb.from("score_entries").select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenant.id).eq("subject_id", subjectId).in("component_id", partIds).in("student_id", ids);
  return count ?? 0;
}

/** This subject's parts in this class: the school's, its own (if any), and whether this person may change them. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const classId = u.searchParams.get("class_group_id"), subjectId = u.searchParams.get("subject_id");
  if (!classId || !subjectId) return jsonError("class_group_id and subject_id are required");
  const t = await target(ctx, classId, subjectId);
  if (!t) return jsonError("this subject is not offered in this class", 404);
  const a = await allowed(ctx, t);
  const own = (await subjectPartsFor(ctx.sb, ctx.tenant.id, classId)).get(subjectId) ?? null;
  const schoolParts = a.scheme?.components ?? [];

  // The same subject in the other classes of this year group that this person may also set.
  let siblings: { class_group_id: string; name: string; has_own: boolean }[] = [];
  if (a.ok && t.level) {
    const { data: others } = await ctx.sb.from("subject_offerings").select("class_group_id,teacher_id,class_groups!inner(name,level)")
      .eq("tenant_id", ctx.tenant.id).eq("subject_id", subjectId).eq("class_groups.level", t.level).neq("class_group_id", classId);
    for (const o of (others ?? []) as any[]) {
      const ot = await target(ctx, o.class_group_id, subjectId);
      if (!ot || !(await allowed(ctx, ot)).ok) continue;
      const theirs = (await subjectPartsFor(ctx.sb, ctx.tenant.id, o.class_group_id)).get(subjectId);
      siblings.push({ class_group_id: o.class_group_id, name: o.class_groups?.name ?? "", has_own: Boolean(theirs) });
    }
    siblings = siblings.sort((x, y) => x.name.localeCompare(y.name));
  }
  return NextResponse.json({
    subject: t.subjectName, class_name: t.className, can_set: a.ok, why_not: a.ok ? null : a.why,
    school_parts: schoolParts, own_parts: own, scheme_name: a.scheme?.name ?? null,
    marks_on_school_parts: own ? 0 : await marksOn(ctx, classId, subjectId, schoolParts.map(c => c.id)),
    siblings
  });
}

const Part = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(40), max_score: z.number().positive().max(1000), weight: z.number().min(0).max(100), midterm: z.boolean().default(false) });
const Put = z.object({
  class_group_id: z.string().uuid(), subject_id: z.string().uuid(),
  parts: z.array(Part).min(1).max(12),
  also_class_group_ids: z.array(z.string().uuid()).max(30).default([])
});

/** Set this subject's own parts in this class (and, if asked, in the same subject's other classes of the year). */
export async function PUT(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Put.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const names = b.parts.map(p => p.name.toLowerCase());
  if (new Set(names).size !== names.length) return jsonError("Two parts have the same name. Give each its own, e.g. CAT 1 and CAT 2.");
  const problems = validateScheme({ components: b.parts.map((p, i) => ({ ...p, id: String(i) })), bands: [{ grade: "-", min_score: 0, max_score: 100 }] });
  if (problems.length) return jsonError(problems.join(" "));

  const classes = [b.class_group_id, ...b.also_class_group_ids.filter(id => id !== b.class_group_id)];
  // Check every class first, so nothing is half-changed.
  const plan: { t: Target; existing: { id: string; name: string }[] }[] = [];
  for (const classId of classes) {
    const t = await target(ctx, classId, b.subject_id);
    if (!t) return jsonError("this subject is not offered in one of the classes", 404);
    const a = await allowed(ctx, t);
    if (!a.ok) return jsonError(a.why, 403);
    const { data: existing, error } = await ctx.sb.from("grading_components").select("id,name").eq("offering_id", t.offeringId);
    if (error) return jsonError(/offering_id/.test(error.message) ? MISSING : error.message);
    if (!(existing ?? []).length) {
      const n = await marksOn(ctx, classId, b.subject_id, (a.scheme?.components ?? []).map(c => c.id));
      if (n) return jsonError(`${n} mark${n === 1 ? " has" : "s have"} already been entered for ${t.subjectName} in ${t.className} with the school's parts. A subject can switch to its own parts before marks are entered; ask an admin if those marks should be cleared first.`, 409);
    }
    plan.push({ t, existing: existing ?? [] });
  }

  for (const [i, { t, existing }] of plan.entries()) {
    // In the first class, parts keep their ids so marks stay attached; in the others, parts are matched by name.
    const keepId = (p: z.infer<typeof Part>) => (i === 0 ? existing.find(e => e.id === p.id)?.id : existing.find(e => e.name.trim().toLowerCase() === p.name.toLowerCase())?.id);
    const keep = new Set(b.parts.map(keepId).filter(Boolean) as string[]);
    const gone = existing.filter(e => !keep.has(e.id));
    if (gone.length) {
      const n = await marksOn(ctx, t.classId, b.subject_id, gone.map(g => g.id));
      if (n) return jsonError(`A part you removed (${gone.map(g => g.name).join(", ")}) already has marks in ${t.className}. Keep it, or set what it counts for to 0.`, 409);
      const { error } = await ctx.sb.from("grading_components").delete().in("id", gone.map(g => g.id));
      if (error) return jsonError(error.message);
    }
    for (const [pos, p] of b.parts.entries()) {
      const row = { offering_id: t.offeringId, name: p.name, max_score: p.max_score, weight: p.weight, midterm: p.midterm, position: pos + 1 };
      const id = keepId(p);
      const { error } = id
        ? await ctx.sb.from("grading_components").update(row).eq("id", id).eq("offering_id", t.offeringId)
        : await ctx.sb.from("grading_components").insert(row);
      if (error) return jsonError(error.message.includes("row-level security") ? "You can't set the parts for this subject." : error.message, 403);
    }
  }
  await ctx.sb.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: "subject_parts.saved",
    meta: { subject_id: b.subject_id, classes, parts: b.parts.map(p => `${p.name} /${p.max_score} ${p.weight}%`) } });
  return NextResponse.json({ ok: true, classes: plan.length });
}

/** Go back to the school's parts for this subject in this class (only while its own parts have no marks). */
export async function DELETE(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const classId = u.searchParams.get("class_group_id"), subjectId = u.searchParams.get("subject_id");
  if (!classId || !subjectId) return jsonError("class_group_id and subject_id are required");
  const t = await target(ctx, classId, subjectId);
  if (!t) return jsonError("this subject is not offered in this class", 404);
  const a = await allowed(ctx, t);
  if (!a.ok) return jsonError(a.why, 403);
  const { data: own } = await ctx.sb.from("grading_components").select("id").eq("offering_id", t.offeringId);
  const ids = (own ?? []).map((c: any) => c.id);
  if (!ids.length) return NextResponse.json({ ok: true });
  const n = await marksOn(ctx, classId, subjectId, ids);
  if (n) return jsonError(`${n} mark${n === 1 ? " has" : "s have"} been entered with ${t.subjectName}'s own parts in ${t.className}, so it keeps them.`, 409);
  const { error } = await ctx.sb.from("grading_components").delete().in("id", ids);
  if (error) return jsonError(error.message);
  await ctx.sb.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: "subject_parts.reset", meta: { subject_id: subjectId, class_group_id: classId } });
  return NextResponse.json({ ok: true });
}
