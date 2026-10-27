import { NextRequest, NextResponse } from "next/server";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { readUpload, MEDIA_TYPES } from "@/lib/files";
import { appUrl } from "@/lib/school";
import { savePhoto, photoUrl, targetsFor, sharesFor, createShare } from "@/lib/portfolio-server";

export const dynamic = "force-dynamic";

async function me(ctx: any) {
  const { data } = await ctx.sb.from("students").select("*").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  return data as { id: string; transcript_allowed?: boolean } | null;
}

/** A student's own portfolio, achievements (with photos), certificates, targets and share links; ?open=<id> opens a file. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(["student"]);
  if (ctx instanceof NextResponse) return ctx;
  const st = await me(ctx);
  if (!st) return jsonError("your login is not linked to a student record", 404);
  const sid = st.id, tid = ctx.tenant.id;
  const svc = createServiceClient();
  const open = new URL(req.url).searchParams.get("open");
  if (open) {
    const { data: p } = await ctx.sb.from("portfolio_items").select("path").eq("tenant_id", tid).eq("student_id", sid).eq("id", open).maybeSingle();
    if (!p?.path) return jsonError("not found", 404);
    const { data } = await svc.storage.from("student-documents").createSignedUrl(p.path, 300);
    return data?.signedUrl ? NextResponse.redirect(data.signedUrl) : jsonError("could not open the file", 500);
  }
  const [{ data: items }, { data: achievements }, { data: certificates }, { data: subjects }, targets, shares] = await Promise.all([
    ctx.sb.from("portfolio_items").select("id,title,kind,description,link_url,path,status,feedback,created_at,subjects(name)").eq("tenant_id", tid).eq("student_id", sid).order("created_at", { ascending: false }),
    ctx.sb.from("student_achievements").select("*").eq("tenant_id", tid).eq("student_id", sid).order("achieved_on", { ascending: false }),
    ctx.sb.from("certificates").select("id,title,kind,issued_on,verify_token").eq("tenant_id", tid).eq("student_id", sid).eq("status", "issued").order("issued_on", { ascending: false }),
    svc.from("subjects").select("id,name").eq("tenant_id", tid).order("name"),
    targetsFor(ctx.sb, tid, sid),
    sharesFor(svc, tid, { student_id: sid }, appUrl(req))
  ]);
  return NextResponse.json({
    items: (items ?? []).map((i: any) => ({ ...i, has_file: Boolean(i.path), path: undefined })),
    achievements: await Promise.all((achievements ?? []).map(async (a: any) => ({ id: a.id, kind: a.kind, title: a.title, award: a.award, level: a.level, achieved_on: a.achieved_on,
      status: a.status ?? "verified", source: a.source ?? "staff", photo: await photoUrl(svc, a.photo_path) }))),
    certificates: certificates ?? [], subjects: subjects ?? [], targets, shares, transcript_allowed: Boolean(st.transcript_allowed), student_id: sid
  });
}

const KINDS = ["work", "project", "artwork", "writing", "photo", "video", "audio", "other"];
const ACH_KINDS = ["academic", "sports", "arts", "leadership", "service", "competition", "attendance", "character", "other"];
const LEVELS = ["class", "school", "local", "state", "national", "international"];

/**
 * Add work (multipart with a file, or JSON with a link; a teacher approves it), add an achievement with a photo
 * (multipart, what=achievement; a teacher verifies it), set a personal target, or make / stop a share link.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(["student"]);
  if (ctx instanceof NextResponse) return ctx;
  const st = await me(ctx);
  if (!st) return jsonError("your login is not linked to a student record", 404);
  const sid = st.id, tid = ctx.tenant.id;
  const svc = createServiceClient();
  const since = new Date(Date.now() - 86400_000).toISOString();
  const multipart = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
  const form = multipart ? await req.formData() : null;
  const b = multipart ? null : await readJson<Record<string, any>>(req);

  if (form?.get("what") === "achievement") {
    const { count } = await svc.from("student_achievements").select("id", { count: "exact", head: true }).eq("student_id", sid).eq("source", "student").gte("created_at", since);
    if ((count ?? 0) >= 5) return jsonError("you can add up to 5 achievements a day", 429);
    const title = String(form.get("title") ?? "").trim();
    if (title.length < 2 || title.length > 160) return jsonError("give the achievement a title");
    const achieved = String(form.get("achieved_on") ?? "");
    let photo: string | null = null;
    if (form.get("photo") instanceof File && (form.get("photo") as File).size) {
      const p = await savePhoto(svc, tid, sid, form.get("photo"));
      if (!p.ok) return jsonError(p.error);
      photo = p.path;
    }
    const { error } = await svc.from("student_achievements").insert({ tenant_id: tid, student_id: sid, title, kind: ACH_KINDS.includes(String(form.get("kind"))) ? String(form.get("kind")) : "other",
      level: LEVELS.includes(String(form.get("level"))) ? String(form.get("level")) : "school", award: String(form.get("award") ?? "").slice(0, 120) || null,
      description: String(form.get("description") ?? "").slice(0, 1000) || null, achieved_on: /^\d{4}-\d{2}-\d{2}$/.test(achieved) ? achieved : new Date().toISOString().slice(0, 10),
      photo_path: photo, source: "student", status: "pending", recorded_by: ctx.userId });
    if (error) return jsonError(error.message);
    return NextResponse.json({ ok: true }, { status: 201 });
  }
  if (b?.action === "share") {
    const days = [7, 30, 90, 365].includes(Number(b.days)) ? Number(b.days) : 90;
    if (b.achievement_id) {
      const { data: a } = await svc.from("student_achievements").select("id,status").eq("tenant_id", tid).eq("student_id", sid).eq("id", b.achievement_id).maybeSingle();
      if (!a) return jsonError("not found", 404);
      if (a.status && a.status !== "verified") return jsonError("an achievement can be shared once your teacher has verified it");
    }
    const s = await createShare(svc, { tenantId: tid, studentId: sid, achievementId: b.achievement_id ?? null, days, actor: ctx.userId });
    return NextResponse.json({ url: `${appUrl(req)}/p/${s.token}` });
  }
  if (b?.action === "revoke") {
    const { error } = await svc.from("portfolio_shares").update({ revoked_at: new Date().toISOString() }).eq("tenant_id", tid).eq("student_id", sid).eq("id", String(b.id ?? ""));
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b?.action === "target") {
    const d = String(b.description ?? "").trim();
    if (d.length < 3 || d.length > 300) return jsonError("say what your target is");
    const { error } = await svc.from("student_targets").insert({ tenant_id: tid, student_id: sid, kind: "personal", description: d, set_by: ctx.userId, set_by_kind: "student" });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true }, { status: 201 });
  }
  if (b?.action === "target_status") {
    const status = ["active", "met", "dropped"].includes(String(b.status)) ? String(b.status) : null;
    if (!status) return jsonError("choose a status");
    const { error } = await svc.from("student_targets").update({ status }).eq("tenant_id", tid).eq("student_id", sid).eq("id", String(b.id ?? "")).eq("set_by_kind", "student");
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }

  // A piece of work.
  const { count } = await svc.from("portfolio_items").select("id", { count: "exact", head: true }).eq("student_id", sid).eq("added_by", ctx.userId).gte("created_at", since);
  if ((count ?? 0) >= 10) return jsonError("you can add up to 10 pieces of work a day", 429);
  let row: Record<string, unknown>;
  if (form) {
    const f = await readUpload(form.get("file"), MEDIA_TYPES, 25);
    if (!f.ok) return jsonError(f.error, f.status);
    const path = `${tid}/${sid}/portfolio-${Date.now()}.${f.ext}`;
    const { error } = await svc.storage.from("student-documents").upload(path, f.buf, { contentType: f.type });
    if (error) return jsonError(error.message, 500);
    row = { title: String(form.get("title") ?? ""), description: String(form.get("description") ?? "") || null, kind: String(form.get("kind") ?? "work"), subject_id: String(form.get("subject_id") ?? "") || null, path, content_type: f.type };
  } else {
    if (!/^https:\/\/[^\s]{4,500}$/.test(String(b?.link_url ?? ""))) return jsonError("paste an https:// link, or choose a file");
    row = { title: b?.title ?? "", description: b?.description || null, kind: b?.kind ?? "work", subject_id: b?.subject_id || null, link_url: b?.link_url };
  }
  const title = String(row.title).trim();
  if (title.length < 2 || title.length > 160) return jsonError("give your work a title");
  if (row.subject_id && !/^[0-9a-f-]{36}$/.test(String(row.subject_id))) row.subject_id = null;
  const { error } = await svc.from("portfolio_items").insert({ ...row, title, description: row.description ? String(row.description).slice(0, 1000) : null,
    kind: KINDS.includes(String(row.kind)) ? row.kind : "work", tenant_id: tid, student_id: sid, status: "submitted", added_by: ctx.userId });
  if (error) return jsonError(error.message);
  return NextResponse.json({ ok: true }, { status: 201 });
}
