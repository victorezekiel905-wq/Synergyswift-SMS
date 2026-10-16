import { NextRequest, NextResponse } from "next/server";
import { getCtx } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { readState, type Provider } from "@/lib/classroom-sync";
import { connect, stateSecret } from "@/lib/classroom-sync-server";

export const dynamic = "force-dynamic";

/** Back from Google or Microsoft: keeps the teacher's tokens and returns to the page. */
export async function GET(req: NextRequest, props: { params: Promise<{ provider: string }> }) {
  const { provider } = await props.params;
  const base = appUrl(req);
  const back = (q: string) => NextResponse.redirect(`${base}/school/classroom-sync?${q}`);
  const u = new URL(req.url).searchParams;
  if (u.get("error")) return back(`error=${encodeURIComponent(u.get("error_description") ?? u.get("error")!)}`);
  const st = readState(stateSecret(), u.get("state") ?? "");
  const ctx = await getCtx();
  if (!st || st.provider !== provider || !ctx || ctx.userId !== st.userId) return back("error=The sign-in did not match; please try again.");
  try {
    await connect(createServiceClient(), ctx.tenant.id, ctx.userId, provider as Provider, u.get("code") ?? "", `${base}/api/connect/${provider}/callback`);
    return back(`connected=${provider}`);
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message)}`);
  }
}
