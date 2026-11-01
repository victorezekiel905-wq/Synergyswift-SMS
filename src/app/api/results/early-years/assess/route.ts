import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { earlyYearsSettings } from "@/lib/early-years";

export const dynamic = "force-dynamic";

/** One preschool class in one term: the children, the checklist, and their ratings and comments so far. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const termId = u.searchParams.get("term_id"), cg = u.searchParams.get("class_group_id");
  if (!termId || !cg) return jsonError("choose a term and a class");
  const tid = ctx.tenant.id;
  const [{ data: group }, { data: students }, { data: areas, error }, { data: items }, { data: settings }] = await Promise.all([
    ctx.sb.from("class_groups").select("id,name,scheme_id,grading_schemes(template)").eq("tenant_id", tid).eq("id", cg).maybeSingle(),
    ctx.sb.from("students").select("id,admission_no,first_name,last_name,other_names").eq("tenant_id", tid).eq("class_group_id", cg).eq("status", "active").order("last_name").order("first_name"),
    ctx.sb.from("early_years_areas").select("id,name,position").eq("tenant_id", tid).order("position").order("name"),
    ctx.sb.from("early_years_items").select("id,area_id,text,position").eq("tenant_id", tid).order("position"),
    ctx.sb.from("tenant_settings").select("*").eq("tenant_id", tid).maybeSingle()
  ]);
  if (error) return jsonError("This needs the database update (migration 20260101009200_results_portal_early_years).", 409);
  if (!group) return jsonError("class not found", 404);
  const ids = (students ?? []).map((s: any) => s.id);
  const [{ data: ratings }, { data: comments }] = ids.length ? await Promise.all([
    ctx.sb.from("early_years_ratings").select("student_id,item_id,rating").eq("tenant_id", tid).eq("term_id", termId).in("student_id", ids),
    ctx.sb.from("early_years_comments").select("student_id,area_id,comment").eq("tenant_id", tid).eq("term_id", termId).in("student_id", ids)
  ]) : [{ data: [] }, { data: [] }];
  const r: Record<string, Record<string, number>> = {}, c: Record<string, Record<string, string>> = {};
  for (const x of ratings ?? []) (r[x.student_id] ??= {})[x.item_id] = x.rating;
  for (const x of comments ?? []) (c[x.student_id] ??= {})[x.area_id] = x.comment;
  return NextResponse.json({
    class_name: group.name,
    early_years: (group as any).grading_schemes?.template === "early_years",
    students: students ?? [],
    areas: (areas ?? []).map((a: any) => ({ ...a, items: (items ?? []).filter((i: any) => i.area_id === a.id) })),
    ratings: r, comments: c,
    ...earlyYearsSettings(settings)
  });
}

const Body = z.object({
  term_id: z.string().uuid(),
  ratings: z.array(z.object({ student_id: z.string().uuid(), item_id: z.string().uuid(), rating: z.number().int().min(1).max(6).nullable() })).max(5000).default([]),
  comments: z.array(z.object({ student_id: z.string().uuid(), area_id: z.string().uuid(), comment: z.string().max(1500) })).max(1000).default([])
});

/** Save ratings (null clears one) and area comments (empty clears one). Only the child's teachers or an admin may. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const { data: settings } = await ctx.sb.from("tenant_settings").select("*").eq("tenant_id", tid).maybeSingle();
  const allowed = new Set(earlyYearsSettings(settings).scale.map(s => s.value));
  if (b.ratings.some(r => r.rating !== null && !allowed.has(r.rating))) return jsonError("a rating is not on the school's preschool scale");
  const denied = (m: string) => jsonError(m.includes("row-level security") ? "Only this class's teachers or an admin can assess these children." : m, m.includes("row-level security") ? 403 : 400);
  const now = new Date().toISOString();

  const set = b.ratings.filter(r => r.rating !== null).map(r => ({ tenant_id: tid, term_id: b.term_id, student_id: r.student_id, item_id: r.item_id, rating: r.rating, rated_by: ctx.userId, updated_at: now }));
  if (set.length) {
    const { error } = await ctx.sb.from("early_years_ratings").upsert(set, { onConflict: "term_id,student_id,item_id" });
    if (error) return denied(error.message);
  }
  for (const r of b.ratings.filter(x => x.rating === null)) {
    const { error } = await ctx.sb.from("early_years_ratings").delete().eq("tenant_id", tid).eq("term_id", b.term_id).eq("student_id", r.student_id).eq("item_id", r.item_id);
    if (error) return denied(error.message);
  }
  const write = b.comments.filter(x => x.comment.trim()).map(x => ({ tenant_id: tid, term_id: b.term_id, student_id: x.student_id, area_id: x.area_id, comment: x.comment.trim(), written_by: ctx.userId, updated_at: now }));
  if (write.length) {
    const { error } = await ctx.sb.from("early_years_comments").upsert(write, { onConflict: "term_id,student_id,area_id" });
    if (error) return denied(error.message);
  }
  for (const x of b.comments.filter(y => !y.comment.trim())) {
    const { error } = await ctx.sb.from("early_years_comments").delete().eq("tenant_id", tid).eq("term_id", b.term_id).eq("student_id", x.student_id).eq("area_id", x.area_id);
    if (error) return denied(error.message);
  }
  return NextResponse.json({ ok: true, saved: set.length + write.length });
}
