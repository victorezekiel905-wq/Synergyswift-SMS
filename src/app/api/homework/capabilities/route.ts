import { NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";
import { assistConfigured } from "@/lib/assist";

/** Which optional marking helpers this server offers. */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "homework");
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ drafting: assistConfigured() });
}
