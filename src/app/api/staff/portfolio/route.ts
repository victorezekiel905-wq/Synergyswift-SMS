import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { savePhoto, staffPortfolio, sharesFor, createShare } from "@/lib/portfolio-server";

export const dynamic = "force-dynamic";
const KINDS = ["award", "qualification", "training", "certification", "publication", "competition", "leadership", "service", "other"];

async function staffRecord(ctx: any, staffId: string | null) {
  const svc = createServiceClient();
  if (staffId) {
    if (!hasAny(ctx, ROLES.hr)) return null;
    const { data } = await svc.from("staff").select("id,full_name").eq("tenant_id", ctx.tenant.id).eq("id", staffId).maybeSingle();
    return data;
  }
  const { data } = await svc.from("staff").select("id,full_name").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  return data;
}

/** A teacher's own achievement portfolio (phase 14o); HR can see anyone's with ?staff_id=. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const s = await staffRecord(ctx, new URL(req.url).searchParams.get("staff_id"));
  if (!s) return NextResponse.json({ staff: null, achievements: [], shares: [] });
  const svc = createServiceClient();
  const [achievements, shares] = await Promise.all([staffPortfolio(svc, ctx.tenant.id, s.id), sharesFor(svc, ctx.tenant.id, { staff_id: s.id }, appUrl(req))]);
  return NextResponse.json({ staff: s, achievements, shares });
}

/** Add an achievement (multipart, with an optional photo), delete one, or make / stop a share link. Only for yourself. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const s = await staffRecord(ctx, null);
  if (!s) return jsonError("your account is not linked to a staff record; ask HR", 404);
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const title = String(form.get("title") ?? "").trim();
    if (title.length < 2 || title.length > 160) return jsonError("give the achievement a title");
    let photo: string | null = null;
    if (form.get("photo") instanceof File && (form.get("photo") as File).size) {
      const p = await savePhoto(svc, tid, `staff-${s.id}`, form.get("photo"));
      if (!p.ok) return jsonError(p.error);
      photo = p.path;
    }
    const link = String(form.get("link_url") ?? "").trim();
    const on = String(form.get("achieved_on") ?? "");
    const { error } = await svc.from("staff_achievements").insert({ tenant_id: tid, staff_id: s.id, title, kind: KINDS.includes(String(form.get("kind"))) ? String(form.get("kind")) : "award",
      description: String(form.get("description") ?? "").slice(0, 1000) || null, issuer: String(form.get("issuer") ?? "").slice(0, 120) || null,
      achieved_on: /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : new Date().toISOString().slice(0, 10), link_url: /^https:\/\//.test(link) ? link.slice(0, 500) : null, photo_path: photo });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true }, { status: 201 });
  }
  const b = await readJson<Record<string, any>>(req);
  if (b.action === "delete") {
    const { data } = await svc.from("staff_achievements").delete().eq("tenant_id", tid).eq("staff_id", s.id).eq("id", String(b.id ?? "")).select("photo_path").maybeSingle();
    if (data?.photo_path) await svc.storage.from("student-documents").remove([data.photo_path]);
    return NextResponse.json({ ok: true });
  }
  if (b.action === "share") {
    const days = [7, 30, 90, 365].includes(Number(b.days)) ? Number(b.days) : 90;
    const sh = await createShare(svc, { tenantId: tid, staffId: s.id, achievementId: b.achievement_id ?? null, days, actor: ctx.userId });
    return NextResponse.json({ url: `${appUrl(req)}/p/${sh.token}` });
  }
  if (b.action === "revoke") {
    await svc.from("portfolio_shares").update({ revoked_at: new Date().toISOString() }).eq("tenant_id", tid).eq("staff_id", s.id).eq("id", String(b.id ?? ""));
    return NextResponse.json({ ok: true });
  }
  return jsonError("unknown action");
}
