import { NextRequest } from "next/server";
import { iclockDevice, text } from "@/lib/iclock";
import { createServiceClient } from "@/lib/supabase/service";
import { parseAttlog } from "@/lib/attendance";
import { recordPunches } from "@/lib/attendance-server";
import { beginRequest } from "@/lib/request-actor";

export const dynamic = "force-dynamic";

/**
 * ZKTeco "push" (ADMS) protocol, used by most fingerprint and face-recognition
 * clocking machines: in the machine's Cloud Server settings, set this site's
 * address and port 443. GET is the handshake; POST carries the attendance log.
 */
export async function GET(req: NextRequest) {
  const sn = new URL(req.url).searchParams.get("SN") ?? "";
  const d = await iclockDevice(createServiceClient(), sn);
  if (!d) return text("ERROR: unknown device", 404);
  return text([`GET OPTION FROM: ${sn}`, "ATTLOGStamp=None", "OPERLOGStamp=9999", "ATTPHOTOStamp=None", "ErrorDelay=60", "Delay=30", "TransTimes=00:00;14:05",
    "TransInterval=1", "TransFlag=TransData AttLog", "Realtime=1", "Encrypt=None"].join("\n"));
}

export async function POST(req: NextRequest) {
  const store = beginRequest();
  const u = new URL(req.url).searchParams;
  const svc = createServiceClient();
  const d = await iclockDevice(svc, u.get("SN") ?? "");
  const body = (await req.text()).slice(0, 1_000_000);
  if (!d) return text("ERROR: unknown device", 404);
  if ((u.get("table") ?? "").toUpperCase() !== "ATTLOG") return text("OK");   // user lists, photos, operation logs: not needed
  store.actor = `device:${d.id}`;
  const punches = parseAttlog(body);
  const r = await recordPunches(svc, d, d.tenants?.timezone ?? "Africa/Lagos", punches);
  return text(`OK: ${punches.length}${r.unknown ? ` (${r.unknown} unknown)` : ""}`);
}
