import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { loadFamilies } from "@/lib/community-server";
import { matchesSegment, describeSegment, type SegmentRules } from "@/lib/community";
import { SegmentRulesSchema } from "@/lib/community-schemas";

export const dynamic = "force-dynamic";

/** Saved family segments with how many families each matches today. */
export async function GET() {
  const ctx = await requireCtx(ROLES.admin, "community");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const [{ data: segs }, families, { data: classes }] = await Promise.all([
    ctx.sb.from("family_segments").select("id,name,rules,created_at").eq("tenant_id", tid).order("name"),
    loadFamilies(svc, tid),
    svc.from("class_groups").select("id,name").eq("tenant_id", tid)
  ]);
  const names = Object.fromEntries((classes ?? []).map((c: any) => [c.id, c.name]));
  return NextResponse.json({
    items: (segs ?? []).map((s: any) => ({ ...s, description: describeSegment(s.rules, { classes: names }), count: families.filter(f => matchesSegment(f, s.rules as SegmentRules)).length }))
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().nullish(), name: z.string().trim().min(2).max(80), rules: SegmentRulesSchema }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "community");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.action === "delete") {
    const { error } = await ctx.sb.from("family_segments").delete().eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  const row = { tenant_id: tid, name: b.name, rules: b.rules, created_by: ctx.userId };
  const { data, error } = b.id
    ? await ctx.sb.from("family_segments").update({ name: b.name, rules: b.rules }).eq("tenant_id", tid).eq("id", b.id).select("id").single()
    : await ctx.sb.from("family_segments").insert(row).select("id").single();
  if (error) return jsonError(/duplicate/.test(error.message) ? "a segment with that name already exists" : error.message);
  return NextResponse.json({ ok: true, id: data.id });
}
