import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { guardianByToken, guardianOverview } from "@/lib/guardian";
import { createPickupCode } from "@/lib/gate";
import { jsonError, readJson } from "@/lib/auth";

/** Passwordless guardian portal (link sent on WhatsApp / email). The token is a 48-hex bearer secret. */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const svc = createServiceClient();
  const g = await guardianByToken(svc, params.token);
  if (!g) return jsonError("This link is invalid or has been replaced. Ask the school for a new one.", 404);
  const data = await guardianOverview(svc, g.tenant_id, g.id, g.tenants.timezone);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pickup"), student_id: z.string().uuid(),
    delegate_name: z.string().trim().max(80).nullish(), delegate_phone: z.string().trim().max(30).nullish() }),
  z.object({ action: z.literal("revoke"), pickup_id: z.string().uuid() }),
  z.object({ action: z.literal("prefs"), notify_email: z.boolean(), notify_whatsapp: z.boolean() })
]);

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const svc = createServiceClient();
  const g = await guardianByToken(svc, params.token);
  if (!g) return jsonError("This link is invalid or has been replaced.", 404);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  if (b.action === "prefs") {
    await svc.from("guardians").update({ notify_email: b.notify_email, notify_whatsapp: b.notify_whatsapp }).eq("id", g.id);
    return NextResponse.json({ ok: true });
  }
  if (b.action === "revoke") {
    await svc.from("pickup_codes").update({ status: "revoked" }).eq("tenant_id", g.tenant_id).eq("guardian_id", g.id).eq("id", b.pickup_id).eq("status", "active");
    return NextResponse.json({ ok: true });
  }
  try {
    const r = await createPickupCode(svc, { tenantId: g.tenant_id, timezone: g.tenants.timezone, guardianId: g.id, studentId: b.student_id,
      delegateName: b.delegate_name, delegatePhone: b.delegate_phone });
    return NextResponse.json(r, { status: 201 });
  } catch (e) { return jsonError((e as Error).message); }
}
