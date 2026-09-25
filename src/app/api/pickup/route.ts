import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { createPickupCode, verifyPickupCode, releaseStudent } from "@/lib/gate";
import { studentName } from "@/lib/school";

const Body = z.discriminatedUnion("action", [
  // Parent (logged in) generates a code
  z.object({ action: z.literal("generate"), student_id: z.string().uuid(),
    delegate_name: z.string().trim().max(80).nullish(), delegate_phone: z.string().trim().max(30).nullish() }),
  z.object({ action: z.literal("revoke"), pickup_id: z.string().uuid() }),
  // Gate officer checks a code, then releases the child
  z.object({ action: z.literal("verify"), code: z.string().trim().min(4).max(12) }),
  z.object({ action: z.literal("release"), pickup_id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(undefined, "pickup");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();
  const tid = ctx.tenant.id;

  if (b.action === "generate" || b.action === "revoke") {
    const { data: g } = await svc.from("guardians").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
    if (!g) return jsonError("only parents and guardians can manage pickup codes", 403);
    if (b.action === "revoke") {
      await svc.from("pickup_codes").update({ status: "revoked" }).eq("tenant_id", tid).eq("id", b.pickup_id).eq("guardian_id", g.id).eq("status", "active");
      return NextResponse.json({ ok: true });
    }
    try {
      const r = await createPickupCode(svc, { tenantId: tid, timezone: ctx.tenant.timezone, guardianId: g.id, studentId: b.student_id,
        delegateName: b.delegate_name, delegatePhone: b.delegate_phone });
      return NextResponse.json(r, { status: 201 });
    } catch (e) { return jsonError((e as Error).message); }
  }

  if (!ROLES.gate.some(r => ctx.roles.has(r))) return jsonError("forbidden", 403);

  if (b.action === "verify") {
    // Brute-force guard: 10 failed checks per officer per 15 minutes.
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { count } = await svc.from("pickup_attempts").select("id", { count: "exact", head: true })
      .eq("tenant_id", tid).eq("user_id", ctx.userId).eq("success", false).gte("at", since);
    if ((count ?? 0) >= 10) return jsonError("too many wrong codes; wait 15 minutes or ask an admin", 429);
    const hit = await verifyPickupCode(svc, tid, b.code);
    await svc.from("pickup_attempts").insert({ tenant_id: tid, user_id: ctx.userId, success: Boolean(hit) });
    if (!hit) return jsonError("Invalid or expired code. Do not release the child.", 404);
    return NextResponse.json({
      pickup_id: hit.id, expires_at: hit.expires_at,
      student: { name: studentName(hit.students), photo_url: hit.students?.photo_url ?? null, class_name: hit.students?.class_groups?.name ?? null },
      guardian: hit.guardians?.full_name, collector: hit.delegate_name || hit.guardians?.full_name,
      delegate_phone: hit.delegate_phone
    });
  }

  try {
    const r = await releaseStudent(svc, { tenantId: tid, timezone: ctx.tenant.timezone, pickupId: b.pickup_id, staffUserId: ctx.userId });
    return NextResponse.json(r);
  } catch (e) { return jsonError((e as Error).message, 409); }
}
