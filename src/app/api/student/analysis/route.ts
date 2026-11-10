import { NextResponse } from "next/server";
import { requireCtx, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { financeSettings } from "@/lib/fees";
import { studentAnalysis } from "@/lib/analysis-student-server";

export const dynamic = "force-dynamic";

/** A student's own analysis across the school's modules (no fees: those are for parents). */
export async function GET() {
  const ctx = await requireCtx(["student"]);
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const { data: s } = await svc.from("students").select("id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  if (!s) return jsonError("your login is not linked to a student record", 404);
  const [{ currency }, analysis] = await Promise.all([
    financeSettings(svc, ctx.tenant.id),
    studentAnalysis(svc, { tenantId: ctx.tenant.id, studentId: s.id, timezone: ctx.tenant.timezone || "Africa/Lagos", modules: ctx.tenant.modules ?? null, forParent: false })
  ]);
  if (!analysis) return jsonError("student not found", 404);
  return NextResponse.json({ currency, analysis }, { headers: { "Cache-Control": "no-store" } });
}
