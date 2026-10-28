import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { finishConnect, unseal } from "@/lib/canva";

export const dynamic = "force-dynamic";

const page = (origin: string, ok: boolean, text: string) => new NextResponse(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Canva</title>
<body style="font-family:system-ui,sans-serif;padding:2rem;color:#111827"><p>${text}</p>
<script>try{window.opener&&window.opener.postMessage(${JSON.stringify(ok ? "canva-connected" : "canva-failed")},${JSON.stringify(origin)})}catch(e){}${ok ? "setTimeout(function(){window.close()},800)" : ""}</script></body>`,
  { headers: { "Content-Type": "text/html; charset=utf-8" } });

/** Canva sends the teacher back here with a one-time code; the server swaps it for tokens. */
export async function GET(req: NextRequest) {
  const origin = appUrl(req);
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return page(origin, false, "Please sign in to Synergy Swift first, then connect Canva again.");
  const u = new URL(req.url);
  const code = u.searchParams.get("code"), state = u.searchParams.get("state");
  if (u.searchParams.get("error") || !code) return page(origin, false, "Canva wasn't connected. You can close this window and try again.");
  let saved: { v: string; s: string; u: string };
  try { saved = JSON.parse(unseal(req.cookies.get("ss_canva")?.value ?? "")); } catch { return page(origin, false, "That took too long. Close this window and connect Canva again."); }
  if (saved.s !== state || saved.u !== ctx.userId) return page(origin, false, "This sign-in didn't match. Close this window and connect Canva again.");
  try {
    await finishConnect(createServiceClient(), { code, verifier: saved.v, redirectUri: `${origin}/api/canva/callback`, userId: ctx.userId, tenantId: ctx.tenant.id });
  } catch (e) { return page(origin, false, `Canva said: ${(e as Error).message.replace(/[<>&]/g, "")}`); }
  const res = page(origin, true, "Canva is connected. This window will close.");
  res.cookies.delete({ name: "ss_canva", path: "/api/canva" });
  return res;
}
