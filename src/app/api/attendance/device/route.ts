import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { sha256hex } from "@/lib/crypto";
import { recordPunches } from "@/lib/attendance-server";
import { beginRequest } from "@/lib/request-actor";

export const dynamic = "force-dynamic";

const Body = z.object({
  events: z.array(z.object({
    code: z.string().trim().min(1).max(64),                       // card number or the person's user number on the machine
    at: z.string().datetime({ offset: true }).nullish(),          // when they passed (default: now)
    direction: z.enum(["in", "out", "auto"]).default("auto"),
    method: z.enum(["card", "fingerprint", "face", "device"]).default("device")
  })).min(1).max(500)
});

/**
 * For fingerprint, face-recognition or card systems that can call a web
 * address: POST here with "Authorization: Bearer <device key>".
 */
export async function POST(req: NextRequest) {
  const store = beginRequest();
  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (key.length < 20) return NextResponse.json({ error: "device key required" }, { status: 401 });
  const svc = createServiceClient();
  const { data: device } = await svc.from("attendance_devices").select("id,tenant_id,name,mode,active,kind,tenants(timezone,status)").eq("secret", sha256hex(key)).eq("kind", "webhook").maybeSingle();
  if (!device || !device.active || device.tenants?.status !== "active") return NextResponse.json({ error: "unknown or disabled device" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  store.actor = `device:${device.id}`;
  const r = await recordPunches(svc, device, device.tenants?.timezone ?? "Africa/Lagos",
    parsed.data.events.map(e => ({ code: e.code, at: e.at ? new Date(e.at) : new Date(), direction: e.direction, method: e.method })));
  return NextResponse.json(r);
}
