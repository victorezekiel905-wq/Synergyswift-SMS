import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { launchToken, tokenNonce } from "@/lib/content-server";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

const Body = z.object({ package_id: z.string().uuid() });

/**
 * Opens a package. Students get their own attempt (created on first open);
 * staff get a preview that saves nothing. Returns the sandboxed URL.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(undefined, "lms");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("package_id required");
  const tid = ctx.tenant.id;
  // Reading through the user's own client applies who-may-open rules.
  const { data: pkg } = await ctx.sb.from("content_packages").select("id,kind,launch_path,meta,title").eq("tenant_id", tid).eq("id", parsed.data.package_id).maybeSingle();
  if (!pkg) return jsonError("this content is not available to you", 404);
  const svc = createServiceClient();
  let attemptId: string | null = null;
  if (!hasAny(ctx, ROLES.staff)) {
    const { data: st } = await svc.from("students").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
    if (!st) return jsonError("only students can work through content", 403);
    const { data: att } = await svc.from("content_attempts").upsert({ tenant_id: tid, package_id: pkg.id, user_id: ctx.userId, student_id: st.id },
      { onConflict: "package_id,user_id", ignoreDuplicates: true }).select("id,launches").maybeSingle();
    const row = att ?? (await svc.from("content_attempts").select("id,launches").eq("package_id", pkg.id).eq("user_id", ctx.userId).single()).data;
    attemptId = row.id;
    await svc.from("content_attempts").update({ launches: (row.launches ?? 0) + 1 }).eq("id", row.id);
  }
  const token = launchToken({ tenantId: tid, pkgId: pkg.id, userId: ctx.userId, attemptId, kind: pkg.kind });
  let url = `/pkg/${token}/${pkg.kind === "h5p" ? "__h5p" : pkg.launch_path}`;
  if (pkg.kind === "xapi") {
    // Tin Can launch: the package reports to this school's record store for this learner.
    const base = appUrl(req);
    const q = new URLSearchParams({
      endpoint: `${base}/api/xapi/${token}/`, auth: `Basic ${Buffer.from(`${token}:x`).toString("base64")}`,
      actor: JSON.stringify({ objectType: "Agent", name: ctx.profile.full_name ?? "Learner", account: { homePage: base, name: ctx.userId } }),
      registration: attemptId ?? "00000000-0000-0000-0000-000000000000", activity_id: String(pkg.meta?.activity_id ?? `${base}/content/${pkg.id}`)
    });
    url += (url.includes("?") ? "&" : "?") + q.toString();
  }
  return NextResponse.json({ url, nonce: tokenNonce(token), token, kind: pkg.kind, preview: attemptId === null, title: pkg.title });
}
