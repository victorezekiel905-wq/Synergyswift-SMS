import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, jsonError, sessionIdentity } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { identifyGuardian, guardianHasChild } from "@/lib/guardian";
import { walletsForStudents, startWalletTopUp, WalletError } from "@/lib/wallet";
import { financeSettings } from "@/lib/fees";
import { providerConfigured } from "@/lib/payments";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

/** Parent view of each child's wallet: balance, what they bought, limits. */
export async function GET(req: NextRequest) {
  const svc = createServiceClient();
  const who = await identifyGuardian(svc, new URL(req.url).searchParams.get("token"), sessionIdentity);
  if ("error" in who) return jsonError(who.error, who.status);
  const { data: kids } = await svc.from("student_guardians").select("student_id,students(status)").eq("tenant_id", who.tenantId).eq("guardian_id", who.guardianId);
  const ids = (kids ?? []).filter((k: any) => k.students?.status === "active").map((k: any) => k.student_id);
  const s = await financeSettings(svc, who.tenantId);
  return NextResponse.json({ currency: s.currency, online: providerConfigured(s.provider), wallets: await walletsForStudents(svc, who.tenantId, ids) },
    { headers: { "Cache-Control": "no-store" } });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("topup"), token: z.string().optional(), student_id: z.string().uuid(), amount: z.number().positive().max(10_000_000),
    email: z.string().email().nullish(), return_path: z.string().max(200) }),
  z.object({ action: z.literal("settings"), token: z.string().optional(), student_id: z.string().uuid(), daily_limit: z.number().min(0).max(1_000_000).nullable(),
    low_balance_alert: z.number().min(0).max(1_000_000).nullable(), frozen: z.boolean() })
]);

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();
  const who = await identifyGuardian(svc, b.token, sessionIdentity);
  if ("error" in who) return jsonError(who.error, who.status);
  if (!(await guardianHasChild(svc, who.tenantId, who.guardianId, b.student_id))) return jsonError("you are not linked to this student", 403);
  try {
    if (b.action === "topup") {
      return NextResponse.json(await startWalletTopUp(svc, { tenantId: who.tenantId, guardianId: who.guardianId, studentId: b.student_id,
        amount: b.amount, email: b.email, baseUrl: appUrl(req), returnPath: b.return_path }));
    }
    const { error } = await svc.from("wallets").upsert({ student_id: b.student_id, tenant_id: who.tenantId, daily_limit: b.daily_limit,
      low_balance_alert: b.low_balance_alert, frozen: b.frozen, updated_at: new Date().toISOString() }, { onConflict: "student_id" });
    if (error) return jsonError(error.message);
    await svc.from("audit_logs").insert({ tenant_id: who.tenantId, action: "wallet.parent_settings", target: b.student_id,
      meta: { guardian_id: who.guardianId, daily_limit: b.daily_limit, frozen: b.frozen } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof WalletError) return jsonError(e.message, e.status);
    return jsonError((e as Error).message);
  }
}
