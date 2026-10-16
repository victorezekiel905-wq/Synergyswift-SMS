import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";
import { appUrl } from "@/lib/school";
import { authorizeUrl, makeState, type Provider } from "@/lib/classroom-sync";
import { providerConfig, stateSecret } from "@/lib/classroom-sync-server";

export const dynamic = "force-dynamic";

/** Starts connecting a teacher's Google or Microsoft account. */
export async function GET(req: NextRequest, props: { params: Promise<{ provider: string }> }) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const { provider } = await props.params;
  if (provider !== "google" && provider !== "microsoft") return jsonError("unknown service", 404);
  const cfg = providerConfig(provider as Provider);
  if (!cfg || !stateSecret()) return jsonError("This service is not set up on the server yet.", 409);
  const { data: me } = await ctx.sb.from("users").select("email").eq("id", ctx.userId).maybeSingle();
  return NextResponse.redirect(authorizeUrl(provider as Provider, { clientId: cfg.clientId, msTenant: cfg.msTenant, loginHint: me?.email ?? null,
    redirectUri: `${appUrl(req)}/api/connect/${provider}/callback`, state: makeState(stateSecret(), ctx.userId, provider as Provider) }));
}
