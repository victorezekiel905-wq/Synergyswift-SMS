import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";
import { appUrl } from "@/lib/school";
import { authorizeUrl, canvaConfigured, pkcePair, seal } from "@/lib/canva";

export const dynamic = "force-dynamic";

/** Starts connecting the teacher's Canva account (opened in a small window from the slide maker). */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  if (!canvaConfigured()) return new NextResponse("Canva is not set up on this site yet.", { status: 503 });
  const p = pkcePair();
  const res = NextResponse.redirect(authorizeUrl({ challenge: p.challenge, state: p.state, redirectUri: `${appUrl(req)}/api/canva/callback` }));
  // The verifier and state stay on the server side of the browser (an encrypted, http-only cookie for 10 minutes).
  res.cookies.set("ss_canva", seal(JSON.stringify({ v: p.verifier, s: p.state, u: ctx.userId })), {
    httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/canva", maxAge: 600 });
  return res;
}
