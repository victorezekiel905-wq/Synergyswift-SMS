import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { TenantSettingsInput } from "@/lib/validators";

export async function GET() {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const { data } = await ctx.sb.from("tenant_settings").select("*").eq("tenant_id", ctx.tenant.id).maybeSingle();
  return NextResponse.json({ tenant: ctx.tenant, settings: data ?? { tenant_id: ctx.tenant.id } });
}

const Settings = TenantSettingsInput;

export async function PUT(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Settings.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  // Turning on two-factor sign-in from a session without it would lock this admin out at once.
  if (parsed.data.require_mfa && parsed.data.require_mfa !== "off") {
    const { data: aal } = await ctx.sb.rpc("session_aal");
    if (aal !== "aal2") return jsonError("Set up two-factor sign-in on your own account first (Account security), then turn this on.", 409);
  }
  const clean = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v === "" ? null : v]));
  const { data, error } = await ctx.sb.from("tenant_settings")
    .upsert({ ...clean, tenant_id: ctx.tenant.id, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" })
    .select("*").single();
  if (error) return jsonError(error.message);
  await ctx.sb.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: "settings.updated" });
  return NextResponse.json(data);
}
