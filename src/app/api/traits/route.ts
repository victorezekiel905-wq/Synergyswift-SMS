import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { traitScale, TRAIT_PRESETS, type ScaleItem } from "@/lib/traits";

/**
 * The school's own ratings of the whole child on report cards: its own areas (Character,
 * Skills, Effort, Co-curricular…) and its own scale (migration 8400).
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const tid = ctx.tenant.id;
  const termId = u.searchParams.get("term_id"), cg = u.searchParams.get("class_group_id");
  const [{ data: traits }, { data: st }] = await Promise.all([
    ctx.sb.from("trait_definitions").select("*").eq("tenant_id", tid).order("position"),
    ctx.sb.from("tenant_settings").select("*").eq("tenant_id", tid).maybeSingle()
  ]);
  const scale = traitScale(st);
  if (!termId || !cg) return NextResponse.json({ traits: traits ?? [], scale, presets: TRAIT_PRESETS });
  const { data: students } = await ctx.sb.from("students").select("id,admission_no,first_name,last_name,other_names").eq("tenant_id", tid).eq("class_group_id", cg).eq("status", "active").order("last_name");
  const ids = (students ?? []).map((s: any) => s.id);
  const { data: ratings } = ids.length ? await ctx.sb.from("trait_ratings").select("student_id,trait_id,rating").eq("term_id", termId).in("student_id", ids) : { data: [] };
  return NextResponse.json({ traits: traits ?? [], students: students ?? [], ratings: ratings ?? [], scale, presets: TRAIT_PRESETS });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_traits"), traits: z.array(z.object({ id: z.string().uuid().optional(), domain: z.string().trim().min(2).max(40), name: z.string().trim().min(1).max(60) })).max(80) }),
  z.object({ action: z.literal("seed_defaults") }),
  z.object({ action: z.literal("add_area"), preset: z.string().max(40) }),
  z.object({ action: z.literal("save_scale"), scale: z.array(z.object({ value: z.number().int().min(1).max(10), short: z.string().trim().min(1).max(4), label: z.string().trim().min(1).max(40) })).min(2).max(10) }),
  z.object({ action: z.literal("rate"), term_id: z.string().uuid(), ratings: z.array(z.object({ student_id: z.string().uuid(), trait_id: z.string().uuid(), rating: z.number().int().min(1).max(10).nullable() })).max(5000) })
]);

const DEFAULTS = {
  affective: ["Punctuality", "Attendance", "Neatness", "Politeness", "Honesty", "Self-control", "Relationship with others", "Leadership", "Attentiveness"],
  psychomotor: ["Handwriting", "Verbal fluency", "Sports and games", "Handling tools", "Drawing and painting", "Musical skills"]
};

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.action === "rate") {
    // Only values on the school's own scale.
    const { data: st } = await ctx.sb.from("tenant_settings").select("*").eq("tenant_id", tid).maybeSingle();
    const allowed = new Set(traitScale(st).map(s => s.value));
    if (b.ratings.some(r => r.rating !== null && !allowed.has(r.rating))) return jsonError("a rating is not on the school's scale");
    const set = b.ratings.filter(r => r.rating !== null).map(r => ({ tenant_id: tid, term_id: b.term_id, student_id: r.student_id, trait_id: r.trait_id, rating: r.rating, rated_by: ctx.userId }));
    if (set.length) {
      const { error } = await ctx.sb.from("trait_ratings").upsert(set, { onConflict: "term_id,student_id,trait_id" });
      if (error) return jsonError(error.message.includes("row-level security") ? "only teachers of this class can rate these students" : error.message, 403);
    }
    for (const r of b.ratings.filter(x => x.rating === null)) {
      await ctx.sb.from("trait_ratings").delete().eq("term_id", b.term_id).eq("student_id", r.student_id).eq("trait_id", r.trait_id);
    }
    return NextResponse.json({ saved: set.length });
  }
  if (!ROLES.admin.some(r => ctx.roles.has(r))) return jsonError("only school admins can change the trait list", 403);
  if (b.action === "seed_defaults") {
    const rows = (["affective", "psychomotor"] as const).flatMap(d => DEFAULTS[d].map((name, i) => ({ tenant_id: tid, domain: d, name, position: i + 1 })));
    await ctx.sb.from("trait_definitions").upsert(rows, { onConflict: "tenant_id,domain,name", ignoreDuplicates: true });
    return NextResponse.json({ ok: true });
  }
  if (b.action === "add_area") {
    const p = TRAIT_PRESETS.find(x => x.domain === b.preset);
    if (!p) return jsonError("unknown area");
    const { count } = await ctx.sb.from("trait_definitions").select("id", { count: "exact", head: true }).eq("tenant_id", tid);
    const rows = p.items.map((name, i) => ({ tenant_id: tid, domain: p.domain, name, position: (count ?? 0) + i + 1 }));
    const { error } = await ctx.sb.from("trait_definitions").upsert(rows, { onConflict: "tenant_id,domain,name", ignoreDuplicates: true });
    if (error) return jsonError(error.message.includes("check") ? "This needs the database update (migration 20260101008400)." : error.message);
    return NextResponse.json({ ok: true });
  }
  if (b.action === "save_scale") {
    const values = b.scale.map(s => s.value);
    if (new Set(values).size !== values.length) return jsonError("each point on the scale needs its own value");
    const scale: ScaleItem[] = [...b.scale].sort((x, y) => y.value - x.value);
    const { error } = await ctx.sb.from("tenant_settings").update({ trait_scale: scale }).eq("tenant_id", tid);
    if (error) return jsonError(error.message.includes("trait_scale") ? "This needs the database update (migration 20260101008400)." : error.message);
    return NextResponse.json({ ok: true });
  }
  const keep = b.traits.filter(t => t.id).map(t => t.id!);
  const { data: existing } = await ctx.sb.from("trait_definitions").select("id").eq("tenant_id", tid);
  for (const e of existing ?? []) if (!keep.includes(e.id)) await ctx.sb.from("trait_definitions").delete().eq("id", e.id);
  for (let i = 0; i < b.traits.length; i++) {
    const t = b.traits[i];
    const row = { tenant_id: tid, domain: t.domain, name: t.name, position: i + 1 };
    const { error } = t.id ? await ctx.sb.from("trait_definitions").update(row).eq("id", t.id) : await ctx.sb.from("trait_definitions").insert(row);
    if (error) return jsonError(error.message);
  }
  return NextResponse.json({ ok: true });
}
