import { NextRequest } from "next/server";
import { iclockDevice, text } from "@/lib/iclock";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** The machine asks for commands; there are none, so it carries on sending its log. */
export async function GET(req: NextRequest) {
  const d = await iclockDevice(createServiceClient(), new URL(req.url).searchParams.get("SN") ?? "");
  return d ? text("OK") : text("ERROR: unknown device", 404);
}
