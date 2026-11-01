import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { EY_FRAMEWORKS, EY_SCALE_PRESETS, checkEyScale, earlyYearsSettings } from "@/lib/early-years";

export const dynamic = "force-dynamic";

const MISSING = "This needs the database update (migration 20260101009200_results_portal_early_years).";
const friendly = (m: string) => (/early_years|does not exist|schema cache/.test(m) ? MISSING : m);

/** Preschool settings: the checklist (areas and statements), the scale, the report options, and which classes are preschool. */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const [areas, items, settings, schemes, classes] = await Promise.all([
    ctx.sb.from("early_years_areas").select("id,name,position").eq("tenant_id", tid).order("position").order("name"),
    ctx.sb.from("early_years_items").select("id,area_id,text,position").eq("tenant_id", tid).order("position"),
    ctx.sb.from("tenant_settings").select("*").eq("tenant_id", tid).maybeSingle(),
    ctx.sb.from("grading_schemes").select("id,name,template").eq("tenant_id", tid),
    ctx.sb.from("class_groups").select("id,name,scheme_id").eq("tenant_id", tid).order("name")
  ]);
  if (areas.error) return jsonError(friendly(areas.error.message), 409);
  const eySchemes = new Set((schemes.data ?? []).filter((s: any) => s.template === "early_years").map((s: any) => s.id));
  return NextResponse.json({
    areas: (areas.data ?? []).map((a: any) => ({ ...a, items: (items.data ?? []).filter((i: any) => i.area_id === a.id) })),
    ...earlyYearsSettings(settings.data),
    classes: (classes.data ?? []).filter((c: any) => c.scheme_id && eySchemes.has(c.scheme_id)).map((c: any) => ({ id: c.id, name: c.name })),
    has_scheme: eySchemes.size > 0,
    frameworks: EY_FRAMEWORKS.map(f => ({ key: f.key, name: f.name, hint: f.hint, areas: f.areas.length, items: f.areas.reduce((n, a) => n + a.items.length, 0) })),
    scale_presets: EY_SCALE_PRESETS
  });
}

const Scale = z.array(z.object({ value: z.number().int().min(1).max(6), short: z.string().trim().min(1).max(4), label: z.string().trim().min(1).max(40) })).min(2).max(6);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_area"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal("delete_area"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_item"), id: z.string().uuid().optional(), area_id: z.string().uuid(), text: z.string().trim().min(1).max(200) }),
  z.object({ action: z.literal("delete_item"), id: z.string().uuid() }),
  z.object({ action: z.literal("reorder"), kind: z.enum(["area", "item"]), ids: z.array(z.string().uuid()).min(1).max(200) }),
  z.object({ action: z.literal("use_framework"), key: z.string().max(40) }),
  z.object({ action: z.literal("save_settings"), scale: Scale, options: z.object({
    area_comments: z.boolean(), show_traits: z.boolean(), show_attendance: z.boolean(), show_key: z.boolean() }) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "results");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  const done = async (error: { message: string } | null, extra: Record<string, unknown> = {}) => {
    if (error) return jsonError(error.message.includes("duplicate") ? "An area with that name is already on the checklist." : friendly(error.message));
    await sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: `early_years.${b.action}` });
    return NextResponse.json({ ok: true, ...extra });
  };

  if (b.action === "save_area") {
    if (b.id) return done((await sb.from("early_years_areas").update({ name: b.name }).eq("tenant_id", tid).eq("id", b.id)).error);
    const { count } = await sb.from("early_years_areas").select("id", { count: "exact", head: true }).eq("tenant_id", tid);
    const { data, error } = await sb.from("early_years_areas").insert({ tenant_id: tid, name: b.name, position: count ?? 0 }).select("id").single();
    return done(error, { id: data?.id });
  }
  if (b.action === "delete_area") return done((await sb.from("early_years_areas").delete().eq("tenant_id", tid).eq("id", b.id)).error);
  if (b.action === "save_item") {
    if (b.id) return done((await sb.from("early_years_items").update({ text: b.text }).eq("tenant_id", tid).eq("id", b.id)).error);
    const { count } = await sb.from("early_years_items").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("area_id", b.area_id);
    const { data, error } = await sb.from("early_years_items").insert({ tenant_id: tid, area_id: b.area_id, text: b.text, position: count ?? 0 }).select("id").single();
    return done(error, { id: data?.id });
  }
  if (b.action === "delete_item") return done((await sb.from("early_years_items").delete().eq("tenant_id", tid).eq("id", b.id)).error);
  if (b.action === "reorder") {
    const table = b.kind === "area" ? "early_years_areas" : "early_years_items";
    for (const [i, id] of b.ids.entries()) {
      const { error } = await sb.from(table).update({ position: i }).eq("tenant_id", tid).eq("id", id);
      if (error) return done(error);
    }
    return done(null);
  }
  if (b.action === "use_framework") {
    const f = EY_FRAMEWORKS.find(x => x.key === b.key);
    if (!f) return jsonError("unknown checklist");
    const { data: have, error: e0 } = await sb.from("early_years_areas").select("id,name,position").eq("tenant_id", tid);
    if (e0) return done(e0);
    let next = Math.max(-1, ...(have ?? []).map((a: any) => a.position)) + 1, added = 0;
    for (const area of f.areas) {
      // An area the school already has keeps its statements; it is not doubled.
      if ((have ?? []).some((a: any) => a.name.toLowerCase() === area.name.toLowerCase())) continue;
      const { data, error } = await sb.from("early_years_areas").insert({ tenant_id: tid, name: area.name, position: next++ }).select("id").single();
      if (error) return done(error);
      const { error: e2 } = await sb.from("early_years_items").insert(area.items.map((text, i) => ({ tenant_id: tid, area_id: data.id, text, position: i })));
      if (e2) return done(e2);
      added++;
    }
    return done(null, { added });
  }
  // save_settings
  const problems = checkEyScale(b.scale);
  if (problems.length) return jsonError(problems.join(" "));
  const { data: row } = await sb.from("tenant_settings").select("tenant_id").eq("tenant_id", tid).maybeSingle();
  const value = { early_years: { scale: [...b.scale].sort((x, y) => y.value - x.value), options: b.options } };
  const { error } = row
    ? await sb.from("tenant_settings").update(value).eq("tenant_id", tid)
    : await sb.from("tenant_settings").insert({ tenant_id: tid, ...value });
  return done(error);
}
