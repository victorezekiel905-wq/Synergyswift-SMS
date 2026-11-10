import { NextResponse } from "next/server";
import { requireCtx, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { financeSettings } from "@/lib/fees";
import { studentShop, makeBuyCode, ShopError } from "@/lib/tuck-shop-server";

export const dynamic = "force-dynamic";

async function me() {
  const ctx = await requireCtx(["student"], "wallet");
  if (ctx instanceof NextResponse) return { error: ctx };
  const svc = createServiceClient();
  const { data: s } = await svc.from("students").select("id,first_name").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  if (!s) return { error: jsonError("your login is not linked to a student record", 404) };
  return { ctx, svc, student: s };
}

/** The student's tuck shop: balance, buys left today, their live code, history and what happened. */
export async function GET() {
  const w = await me();
  if ("error" in w) return w.error;
  try {
    const { currency } = await financeSettings(w.svc, w.ctx.tenant.id);
    return NextResponse.json({ currency, timezone: w.ctx.tenant.timezone, ...(await studentShop(w.svc, w.ctx.tenant.id, w.student.id)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return jsonError((e as Error).message, e instanceof ShopError ? e.status : 400); }
}

/** Makes the student's one-time buy code (or shows the live one), within the school's rules. */
export async function POST() {
  const w = await me();
  if ("error" in w) return w.error;
  try {
    const r = await makeBuyCode(w.svc, { tenantId: w.ctx.tenant.id, studentId: w.student.id, by: w.ctx.userId, as: "student", timeZone: w.ctx.tenant.timezone });
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.error, status: r.status }, { status: 409 });
  } catch (e) { return jsonError((e as Error).message, e instanceof ShopError ? e.status : 400); }
}
