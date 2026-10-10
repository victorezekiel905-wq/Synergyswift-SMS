import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";
import { clientIp } from "@/lib/net";

/** The caller's public IP as the server sees it (to allow "this network" for exams). */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ ip: clientIp(req.headers) });
}
