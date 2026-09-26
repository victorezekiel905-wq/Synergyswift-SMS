import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";

export async function GET() {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const { data } = await ctx.sb.from("tenant_settings").select("*").eq("tenant_id", ctx.tenant.id).maybeSingle();
  return NextResponse.json({ tenant: ctx.tenant, settings: data ?? { tenant_id: ctx.tenant.id } });
}

const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
const Settings = z.object({
  school_name: z.string().trim().max(160).nullish(),
  motto: z.string().trim().max(200).nullish(),
  address: z.string().trim().max(300).nullish(),
  phone: z.string().trim().max(40).nullish(),
  email: z.string().trim().email().or(z.literal("")).nullish(),
  logo_url: z.string().trim().url().or(z.literal("")).nullish(),
  principal_name: z.string().trim().max(120).nullish(),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  sender_name: z.string().trim().max(80).nullish(),
  reply_to_email: z.string().trim().email().or(z.literal("")).nullish(),
  notify_gate_events: z.boolean().optional(),
  notify_results: z.boolean().optional(),
  staff_start_time: time.optional(),
  student_start_time: time.optional(),
  geofence_lat: z.number().min(-90).max(90).nullish(),
  geofence_lng: z.number().min(-180).max(180).nullish(),
  geofence_radius_m: z.number().int().min(20).max(20000).nullish(),
  library_loan_days: z.number().int().min(1).max(365).optional(),
  library_fine_per_day: z.number().min(0).optional(),
  currency: z.string().trim().max(8).optional(),
  pickup_code_ttl_min: z.number().int().min(10).max(1440).optional(),
  exam_violation_limit: z.number().int().min(1).max(50).optional(),
  sms_mode: z.enum(["off", "fallback", "always"]).optional()
});

export async function PUT(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Settings.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const clean = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v === "" ? null : v]));
  const { data, error } = await ctx.sb.from("tenant_settings")
    .upsert({ ...clean, tenant_id: ctx.tenant.id, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" })
    .select("*").single();
  if (error) return jsonError(error.message);
  await ctx.sb.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: "settings.updated" });
  return NextResponse.json(data);
}
