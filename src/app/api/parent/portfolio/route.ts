import { NextRequest, NextResponse } from "next/server";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { studentPortfolio, targetsFor, sharesFor, createShare } from "@/lib/portfolio-server";

export const dynamic = "force-dynamic";

/** A parent's view of a child's portfolio, targets, transcript release and share links (phase 14o). */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(["parent"]);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  // RLS limits students to the parent's own children.
  const { data: kids } = await ctx.sb.from("students").select("*").eq("tenant_id", tid).order("first_name");
  const student = new URL(req.url).searchParams.get("student") ?? kids?.[0]?.id;
  const child = (kids ?? []).find((k: any) => k.id === student);
  const children = (kids ?? []).map((k: any) => ({ id: k.id, name: `${k.first_name} ${k.last_name}` }));
  if (!child) return NextResponse.json({ children, child: null });
  const svc = createServiceClient();
  const [portfolio, targets, shares] = await Promise.all([
    studentPortfolio(svc, tid, child.id, { shared: true }), targetsFor(ctx.sb, tid, child.id), sharesFor(svc, tid, { student_id: child.id }, appUrl(req))]);
  return NextResponse.json({ children, child: { id: child.id, name: `${child.first_name} ${child.last_name}`, transcript_allowed: Boolean(child.transcript_allowed) }, ...portfolio, targets, shares });
}

/** Share the portfolio (or one achievement), stop a link, or add a target from home. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(["parent"]);
  if (ctx instanceof NextResponse) return ctx;
  const b = await readJson<Record<string, any>>(req);
  const tid = ctx.tenant.id;
  const { data: child } = await ctx.sb.from("students").select("id").eq("tenant_id", tid).eq("id", String(b.student_id ?? "")).maybeSingle();
  if (!child) return jsonError("not found", 404);
  const svc = createServiceClient();
  if (b.action === "share") {
    const days = [7, 30, 90, 365].includes(Number(b.days)) ? Number(b.days) : 90;
    const s = await createShare(svc, { tenantId: tid, studentId: child.id, achievementId: b.achievement_id ?? null, days, actor: ctx.userId });
    return NextResponse.json({ url: `${appUrl(req)}/p/${s.token}` });
  }
  if (b.action === "revoke") {
    await svc.from("portfolio_shares").update({ revoked_at: new Date().toISOString() }).eq("tenant_id", tid).eq("student_id", child.id).eq("id", String(b.id ?? ""));
    return NextResponse.json({ ok: true });
  }
  if (b.action === "target") {
    const d = String(b.description ?? "").trim();
    if (d.length < 3 || d.length > 300) return jsonError("say what the target is");
    const { error } = await svc.from("student_targets").insert({ tenant_id: tid, student_id: child.id, kind: "personal", description: d, set_by: ctx.userId, set_by_kind: "parent" });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  return jsonError("unknown action");
}
