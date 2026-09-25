import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePerson, recordGateEvent } from "@/lib/gate";

const Body = z.object({
  code: z.string().trim().min(1).max(120),
  direction: z.enum(["auto", "in", "out"]).default("auto"),
  note: z.string().trim().max(200).nullish()
});

/** Gate kiosk: scan an ID-card QR (or type an admission / staff number) to sign someone in or out. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.gate, "gate");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("code required");
  const svc = createServiceClient();
  const person = await resolvePerson(svc, ctx.tenant.id, parsed.data.code);
  if (!person) return jsonError("No active student or staff member matches that card.", 404);
  try {
    const r = await recordGateEvent(svc, {
      tenantId: ctx.tenant.id, timezone: ctx.tenant.timezone, person, direction: parsed.data.direction,
      method: "kiosk", recordedBy: ctx.userId, note: parsed.data.note
    });
    return NextResponse.json({ person, ...r });
  } catch (e) {
    return jsonError((e as Error).message);
  }
}
