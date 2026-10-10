import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { loadFamilies, familyProfile, CrmError } from "@/lib/community-server";
import { matchesSegment, npsSummary, type SegmentRules } from "@/lib/community";
import { SegmentRulesSchema } from "@/lib/community-schemas";

export const dynamic = "force-dynamic";

/** Families with retention flags (list), or one family's 360° profile (?id=). Admins only. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "community");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const svc = createServiceClient();
  const tid = ctx.tenant.id;
  try {
    const id = u.searchParams.get("id");
    if (id) return NextResponse.json(await familyProfile(svc, tid, id));
    let rules: SegmentRules = {};
    const raw = u.searchParams.get("rules");
    if (raw) {
      const p = SegmentRulesSchema.safeParse(JSON.parse(raw));
      if (!p.success) return jsonError("invalid filter");
      rules = p.data as SegmentRules;
    }
    const segment = u.searchParams.get("segment");
    if (segment) {
      const { data: s } = await ctx.sb.from("family_segments").select("rules").eq("tenant_id", tid).eq("id", segment).maybeSingle();
      if (!s) return jsonError("segment not found", 404);
      rules = { ...s.rules, ...rules };
    }
    const all = await loadFamilies(svc, tid);
    const q = (u.searchParams.get("q") ?? "").trim().toLowerCase();
    const items = all.filter(f => matchesSegment(f, rules) && (!q || f.full_name.toLowerCase().includes(q) || (f.phone ?? "").includes(q) || (f.email ?? "").toLowerCase().includes(q)
      || f.children.some(c => c.name.toLowerCase().includes(q))));
    const [{ data: classes }, { data: settings }] = await Promise.all([
      svc.from("class_groups").select("id,name,level").eq("tenant_id", tid).order("name"),
      svc.from("tenant_settings").select("currency").eq("tenant_id", tid).maybeSingle()
    ]);
    const nps = npsSummary(all.map(f => f.last_nps));
    return NextResponse.json({
      items: items.slice(0, 2000), total: items.length, families: all.length, classes: classes ?? [], currency: settings?.currency ?? "NGN",
      overview: {
        families: all.length, high_risk: all.filter(f => f.risk.level === "high").length, medium_risk: all.filter(f => f.risk.level === "medium").length,
        nps: nps.nps, nps_responses: nps.responses, owing: all.filter(f => f.balance > 0).length, open_tickets: all.reduce((a, f) => a + f.open_tickets, 0),
        opted_out: all.filter(f => f.marketing_opt_out).length
      }
    });
  } catch (e) {
    if (e instanceof CrmError) return jsonError(e.message, e.status);
    return jsonError((e as Error).message);
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("log"), guardian_id: z.string().uuid(), student_id: z.string().uuid().nullish(),
    kind: z.enum(["note", "call", "meeting", "email", "sms", "whatsapp", "visit", "retention", "other"]), body: z.string().trim().min(1).max(4000),
    occurred_at: z.string().datetime({ offset: true }).nullish(), follow_up_at: z.string().datetime({ offset: true }).nullish() }),
  z.object({ action: z.literal("delete_log"), id: z.string().uuid() }),
  z.object({ action: z.literal("opt_out"), guardian_id: z.string().uuid(), opt_out: z.boolean() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "community");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.action === "log") {
    const { data: g } = await ctx.sb.from("guardians").select("id").eq("tenant_id", tid).eq("id", b.guardian_id).maybeSingle();
    if (!g) return jsonError("family not found", 404);
    const { error } = await ctx.sb.from("crm_interactions").insert({ tenant_id: tid, guardian_id: b.guardian_id, student_id: b.student_id ?? null, kind: b.kind, body: b.body,
      occurred_at: b.occurred_at ?? new Date().toISOString(), follow_up_at: b.follow_up_at ?? null, actor_id: ctx.userId });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true }, { status: 201 });
  }
  if (b.action === "delete_log") {
    const { error } = await ctx.sb.from("crm_interactions").delete().eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  const { error } = await ctx.sb.from("guardians").update({ marketing_opt_out: b.opt_out }).eq("tenant_id", tid).eq("id", b.guardian_id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}
