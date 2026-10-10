import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const KINDS = ["vendor", "supplier", "partner", "sponsor", "ngo", "government", "media", "other"] as const;

/** Vendors, suppliers, sponsors and partner organisations; ?id= adds the interaction log and spend. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.finance, "community");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const { data: p } = await ctx.sb.from("crm_partners").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!p) return jsonError("not found", 404);
    const svc = createServiceClient();
    // Spend: expenses whose payee matches the partner's name.
    const [{ data: log }, { data: spend }] = await Promise.all([
      svc.from("crm_interactions").select("id,kind,body,occurred_at,follow_up_at,users:actor_id(full_name)").eq("tenant_id", tid).eq("partner_id", id).order("occurred_at", { ascending: false }).limit(100),
      svc.from("expenses").select("id,description,amount,spent_on,category").eq("tenant_id", tid).ilike("payee", p.name.replace(/[%_]/g, "")).order("spent_on", { ascending: false }).limit(100)
    ]);
    return NextResponse.json({ partner: p, log: log ?? [], spend: spend ?? [], spend_total: (spend ?? []).reduce((a: number, e: any) => a + Number(e.amount), 0) });
  }
  const { data, error } = await ctx.sb.from("crm_partners").select("*").eq("tenant_id", tid).order("name").limit(2000);
  if (error) return jsonError(error.message);
  const soon = new Date(Date.now() + 45 * 86400_000).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10);
  const { data: s } = await createServiceClient().from("tenant_settings").select("currency").eq("tenant_id", tid).maybeSingle();
  return NextResponse.json({
    items: (data ?? []).map((p: any) => ({ ...p, renewal: p.contract_end && p.contract_end <= soon ? (p.contract_end < today ? "expired" : "due") : null })),
    currency: s?.currency ?? "NGN"
  });
}

const Fields = {
  name: z.string().trim().min(2).max(160), kind: z.enum(KINDS).default("vendor"), category: z.string().trim().max(80).nullish(), status: z.enum(["prospect", "active", "inactive"]).default("active"),
  contact_name: z.string().trim().max(120).nullish(), email: z.string().trim().email().max(200).nullish().or(z.literal("")), phone: z.string().trim().max(30).nullish(),
  website: z.string().trim().url().max(300).nullish().or(z.literal("")), address: z.string().trim().max(300).nullish(),
  contract_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")), contract_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  contract_value: z.number().min(0).nullish(), rating: z.number().int().min(1).max(5).nullish(), tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]), notes: z.string().trim().max(4000).nullish()
};
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().nullish(), ...Fields }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("log"), id: z.string().uuid(), kind: z.enum(["note", "call", "meeting", "email", "visit", "other"]), body: z.string().trim().min(1).max(4000),
    follow_up_at: z.string().datetime({ offset: true }).nullish() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.finance, "community");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.action === "save") {
    const { action: _a, id, ...row } = b;
    if (row.contract_start && row.contract_end && row.contract_end < row.contract_start) return jsonError("the contract cannot end before it starts");
    const clean = { ...row, email: row.email || null, website: row.website || null, contract_start: row.contract_start || null, contract_end: row.contract_end || null, updated_at: new Date().toISOString() };
    const { data, error } = id
      ? await ctx.sb.from("crm_partners").update(clean).eq("tenant_id", tid).eq("id", id).select("id").single()
      : await ctx.sb.from("crm_partners").insert({ ...clean, tenant_id: tid, created_by: ctx.userId }).select("id").single();
    return error ? jsonError(error.message) : NextResponse.json({ ok: true, id: data.id });
  }
  if (b.action === "delete") {
    const { error } = await ctx.sb.from("crm_partners").delete().eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  // Partner interactions are admin/bursar-only rows, written by the server after the role check above.
  const { data: p } = await ctx.sb.from("crm_partners").select("id").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
  if (!p) return jsonError("not found", 404);
  const { error } = await createServiceClient().from("crm_interactions").insert({ tenant_id: tid, partner_id: b.id, kind: b.kind, body: b.body, follow_up_at: b.follow_up_at ?? null, actor_id: ctx.userId });
  return error ? jsonError(error.message) : NextResponse.json({ ok: true }, { status: 201 });
}
