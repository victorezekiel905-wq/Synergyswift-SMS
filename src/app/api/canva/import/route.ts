import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { accessToken, importDeck, canvaConfigured, CanvaAuthError } from "@/lib/canva";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Sends a PowerPoint (made in the browser from the slides) into the teacher's Canva and returns the link to edit it there. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  if (!canvaConfigured()) return jsonError("Canva is not set up on this site yet.", 503);
  const svc = createServiceClient();
  const token = await accessToken(svc, ctx.userId);
  if (!token) return NextResponse.json({ error: "Connect your Canva account first.", code: "canva_connect" }, { status: 409 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength < 100) return jsonError("The slides file is empty.");
  if (bytes.byteLength > 40_000_000) return jsonError("The slides are too big to send (over 40 MB). Remove some photos and try again.", 413);
  const title = (new URL(req.url).searchParams.get("title") ?? "Lesson slides").slice(0, 50);
  try {
    const out = await importDeck(token, title, bytes);
    await ctx.sb.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: "canva.import", meta: { title, design_id: out.designId } });
    return NextResponse.json({ edit_url: out.editUrl });
  } catch (e) {
    if (e instanceof CanvaAuthError) {
      await svc.from("canva_connections").delete().eq("user_id", ctx.userId);
      return NextResponse.json({ error: e.message, code: "canva_connect" }, { status: 409 });
    }
    return jsonError((e as Error).message, 502);
  }
}
