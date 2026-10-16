import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { toCsv } from "@/lib/school";
import { buildCensus } from "@/lib/insights-server";
import { censusRows } from "@/lib/census";

export const dynamic = "force-dynamic";

/** The school's census details and its statutory returns; ?id=&format=csv downloads one. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "analytics");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const id = u.get("id");
  if (id) {
    const { data: r } = await ctx.sb.from("statutory_returns").select("*").eq("tenant_id", ctx.tenant.id).eq("id", id).maybeSingle();
    if (!r) return jsonError("not found", 404);
    if (u.get("format") === "csv") {
      return new NextResponse(toCsv(r.data?.rows ?? []), { headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="school-census-${r.period.replace(/\W+/g, "-")}.csv"`
      } });
    }
    return NextResponse.json(r);
  }
  const [{ data: settings }, { data: returns }] = await Promise.all([
    ctx.sb.from("tenant_settings").select("census_profile").eq("tenant_id", ctx.tenant.id).maybeSingle(),
    ctx.sb.from("statutory_returns").select("id,kind,period,status,prepared_at,submitted_at,reference,notes").eq("tenant_id", ctx.tenant.id).order("period", { ascending: false })
  ]);
  return NextResponse.json({ profile: settings?.census_profile ?? {}, returns: returns ?? [] });
}

const PERIOD = z.string().trim().regex(/^\d{4}\/\d{4}$/, "use the form 2026/2027");
const Cell = z.union([z.string().max(200), z.number()]);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_profile"), profile: z.object({
    school_code: z.string().trim().max(40).optional(), state: z.string().trim().max(60).optional(), lga: z.string().trim().max(80).optional(),
    ownership: z.enum(["private", "public", "mission", "community", ""]).optional(), school_type: z.string().trim().max(60).optional(),
    location: z.enum(["urban", "rural", ""]).optional(), year_established: z.string().trim().max(4).optional(), head_name: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(40).optional(), email: z.string().trim().max(120).optional()
  }) }),
  z.object({ action: z.literal("prepare"), period: PERIOD, as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  z.object({ action: z.literal("save_rows"), id: z.string().uuid(), rows: z.array(z.array(Cell).max(6)).max(2000), notes: z.string().max(2000).nullish() }),
  z.object({ action: z.literal("submit"), id: z.string().uuid(), reference: z.string().trim().max(80).nullish() }),
  z.object({ action: z.literal("set_reference"), id: z.string().uuid(), reference: z.string().trim().max(80).nullish(), notes: z.string().max(2000).nullish() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "analytics");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;

  if (b.action === "save_profile") {
    const profile = Object.fromEntries(Object.entries(b.profile).filter(([, v]) => v !== undefined && v !== ""));
    const { error } = await ctx.sb.from("tenant_settings").upsert({ tenant_id: tid, census_profile: profile, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true, profile });
  }
  if (b.action === "prepare") {
    const { data: existing } = await ctx.sb.from("statutory_returns").select("id,status").eq("tenant_id", tid).eq("kind", "annual_school_census").eq("period", b.period).maybeSingle();
    if (existing?.status === "submitted") return jsonError("This year's census has already been submitted.", 409);
    const computed = await buildCensus(createServiceClient(), tid, ctx.tenant.timezone, b.period, b.as_of);
    const data = { computed, rows: censusRows(computed) };
    const res = existing
      ? await ctx.sb.from("statutory_returns").update({ data, prepared_by: ctx.userId, prepared_at: new Date().toISOString() }).eq("id", existing.id).select("id").single()
      : await ctx.sb.from("statutory_returns").insert({ tenant_id: tid, kind: "annual_school_census", period: b.period, data, prepared_by: ctx.userId }).select("id").single();
    return res.error ? jsonError(res.error.message) : NextResponse.json({ ok: true, id: res.data.id });
  }
  const { data: r } = await ctx.sb.from("statutory_returns").select("id,status,data").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
  if (!r) return jsonError("not found", 404);
  if (b.action === "save_rows") {
    if (r.status === "submitted") return jsonError("A submitted return cannot be changed.", 409);
    const { error } = await ctx.sb.from("statutory_returns").update({ data: { ...r.data, rows: b.rows, edited: true }, notes: b.notes ?? null }).eq("id", r.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "submit") {
    const { error } = await ctx.sb.from("statutory_returns").update({ status: "submitted", reference: b.reference ?? null }).eq("id", r.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "set_reference") {
    const { error } = await ctx.sb.from("statutory_returns").update({ reference: b.reference ?? null, notes: b.notes ?? null }).eq("id", r.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (r.status === "submitted") return jsonError("A submitted return is kept.", 409);
  const { error } = await ctx.sb.from("statutory_returns").delete().eq("id", r.id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}
