import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";

/** Character (affective) and skills (psychomotor) ratings shown on report cards. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const tid = ctx.tenant.id;
  const termId = u.searchParams.get("term_id"), cg = u.searchParams.get("class_group_id");
  const { data: traits } = await ctx.sb.from("trait_definitions").select("*").eq("tenant_id", tid).order("domain").order("position");
  if (!termId || !cg) return NextResponse.json({ traits: traits ?? [] });
  const { data: students } = await ctx.sb.from("students").select("id,admission_no,first_name,last_name,other_names").eq("tenant_id", tid).eq("class_group_id", cg).eq("status", "active").order("last_name");
  const ids = (students ?? []).map((s: any) => s.id);
  const { data: ratings } = ids.length ? await ctx.sb.from("trait_ratings").select("student_id,trait_id,rating").eq("term_id", termId).in("student_id", ids) : { data: [] };
  return NextResponse.json({ traits: traits ?? [], students: students ?? [], ratings: ratings ?? [] });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_traits"), traits: z.array(z.object({ id: z.string().uuid().optional(), domain: z.enum(["affective", "psychomotor"]), name: z.string().trim().min(1).max(60) })).max(40) }),
  z.object({ action: z.literal("seed_defaults") }),
  z.object({ action: z.literal("rate"), term_id: z.string().uuid(), ratings: z.array(z.object({ student_id: z.string().uuid(), trait_id: z.string().uuid(), rating: z.number().int().min(1).max(5).nullable() })).max(5000) })
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
