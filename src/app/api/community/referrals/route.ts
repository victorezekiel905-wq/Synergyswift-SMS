import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchAll } from "@/lib/results";

export const dynamic = "force-dynamic";

/** Referral rewards owed and paid, the school's standard reward, and the top referring families. */
export async function GET() {
  const ctx = await requireCtx(ROLES.finance, "community");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const [{ data: rewards, error }, { data: s }, leads] = await Promise.all([
    ctx.sb.from("referral_rewards").select("*,guardians(id,full_name,phone),admission_leads(parent_name,child_name,stage)").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(500),
    svc.from("tenant_settings").select("referral_reward_kind,referral_reward_amount,currency").eq("tenant_id", tid).maybeSingle(),
    fetchAll<any>(() => svc.from("admission_leads").select("referred_by,stage,guardians:referred_by(full_name)").eq("tenant_id", tid).not("referred_by", "is", null).order("id"))
  ]);
  if (error) return jsonError(error.message);
  const top = new Map<string, { id: string; name: string; referred: number; enrolled: number }>();
  for (const l of leads) {
    const t = top.get(l.referred_by) ?? { id: l.referred_by, name: l.guardians?.full_name ?? "Family", referred: 0, enrolled: 0 };
    t.referred++;
    if (l.stage === "enrolled") t.enrolled++;
    top.set(l.referred_by, t);
  }
  return NextResponse.json({
    items: rewards ?? [], settings: { kind: s?.referral_reward_kind ?? "fee_discount", amount: Number(s?.referral_reward_amount ?? 0) }, currency: s?.currency ?? "NGN",
    top: [...top.values()].sort((a, b) => b.enrolled - a.enrolled || b.referred - a.referred).slice(0, 20),
    totals: { referred: leads.length, enrolled: leads.filter(l => l.stage === "enrolled").length }
  });
}

const Kind = z.enum(["fee_discount", "wallet_credit", "gift", "cash"]);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), kind: Kind, amount: z.number().min(0).max(100_000_000) }),
  z.object({ action: z.literal("status"), id: z.string().uuid(), status: z.enum(["pending", "approved", "issued", "cancelled"]), note: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal("add"), guardian_id: z.string().uuid(), kind: Kind, amount: z.number().min(0).max(100_000_000), note: z.string().trim().max(300).nullish() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.finance, "community");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.action === "settings") {
    if (!hasAny(ctx, ROLES.admin)) return jsonError("only school admins can change the referral reward", 403);
    const { error } = await createServiceClient().from("tenant_settings").upsert({ tenant_id: tid, referral_reward_kind: b.kind, referral_reward_amount: b.amount }, { onConflict: "tenant_id" });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "add") {
    const { data: g } = await ctx.sb.from("guardians").select("id").eq("tenant_id", tid).eq("id", b.guardian_id).maybeSingle();
    if (!g) return jsonError("family not found", 404);
    const { error } = await ctx.sb.from("referral_rewards").insert({ tenant_id: tid, guardian_id: b.guardian_id, kind: b.kind, amount: b.amount, note: b.note ?? null });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true }, { status: 201 });
  }
  const patch: Record<string, unknown> = { status: b.status };
  if (b.note !== undefined) patch.note = b.note;
  if (b.status === "approved") patch.approved_by = ctx.userId;
  patch.issued_at = b.status === "issued" ? new Date().toISOString() : null;
  const { data, error } = await ctx.sb.from("referral_rewards").update(patch).eq("tenant_id", tid).eq("id", b.id).select("id").maybeSingle();
  if (error || !data) return jsonError(error?.message ?? "reward not found", error ? 400 : 404);
  await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: `referral_reward.${b.status}`, meta: { id: b.id } });
  return NextResponse.json({ ok: true });
}
