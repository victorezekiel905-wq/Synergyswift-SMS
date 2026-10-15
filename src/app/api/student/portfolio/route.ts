import { NextRequest, NextResponse } from "next/server";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { readUpload, MEDIA_TYPES } from "@/lib/files";

export const dynamic = "force-dynamic";

async function me(ctx: any) {
  const { data } = await ctx.sb.from("students").select("id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  return data?.id as string | undefined;
}

/** A student's own portfolio, achievements and certificates; ?open=<id> opens one of their files. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(["student"]);
  if (ctx instanceof NextResponse) return ctx;
  const sid = await me(ctx);
  if (!sid) return jsonError("your login is not linked to a student record", 404);
  const tid = ctx.tenant.id;
  const open = new URL(req.url).searchParams.get("open");
  if (open) {
    const { data: p } = await ctx.sb.from("portfolio_items").select("path").eq("tenant_id", tid).eq("student_id", sid).eq("id", open).maybeSingle();
    if (!p?.path) return jsonError("not found", 404);
    const { data } = await createServiceClient().storage.from("student-documents").createSignedUrl(p.path, 300);
    return data?.signedUrl ? NextResponse.redirect(data.signedUrl) : jsonError("could not open the file", 500);
  }
  const [{ data: items }, { data: achievements }, { data: certificates }, { data: subjects }] = await Promise.all([
    ctx.sb.from("portfolio_items").select("id,title,kind,description,link_url,path,status,feedback,created_at,subjects(name)").eq("tenant_id", tid).eq("student_id", sid).order("created_at", { ascending: false }),
    ctx.sb.from("student_achievements").select("id,title,award,level,achieved_on").eq("tenant_id", tid).eq("student_id", sid).order("achieved_on", { ascending: false }),
    ctx.sb.from("certificates").select("id,title,kind,issued_on,verify_token").eq("tenant_id", tid).eq("student_id", sid).eq("status", "issued").order("issued_on", { ascending: false }),
    createServiceClient().from("subjects").select("id,name").eq("tenant_id", tid).order("name")
  ]);
  return NextResponse.json({ items: (items ?? []).map((i: any) => ({ ...i, has_file: Boolean(i.path), path: undefined })), achievements: achievements ?? [], certificates: certificates ?? [], subjects: subjects ?? [] });
}

/** Add work (multipart with a file, or JSON with a link). It waits for a teacher to approve it. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(["student"]);
  if (ctx instanceof NextResponse) return ctx;
  const sid = await me(ctx);
  if (!sid) return jsonError("your login is not linked to a student record", 404);
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const since = new Date(Date.now() - 86400_000).toISOString();
  const { count } = await svc.from("portfolio_items").select("id", { count: "exact", head: true }).eq("student_id", sid).eq("added_by", ctx.userId).gte("created_at", since);
  if ((count ?? 0) >= 10) return jsonError("you can add up to 10 pieces of work a day", 429);
  const kinds = ["work", "project", "artwork", "writing", "photo", "video", "audio", "other"];
  let row: Record<string, unknown>;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const f = await readUpload(form.get("file"), MEDIA_TYPES, 25);
    if (!f.ok) return jsonError(f.error, f.status);
    const path = `${tid}/${sid}/portfolio-${Date.now()}.${f.ext}`;
    const { error } = await svc.storage.from("student-documents").upload(path, f.buf, { contentType: f.type });
    if (error) return jsonError(error.message, 500);
    row = { title: String(form.get("title") ?? ""), description: String(form.get("description") ?? "") || null, kind: String(form.get("kind") ?? "work"), subject_id: String(form.get("subject_id") ?? "") || null, path, content_type: f.type };
  } else {
    const b = await readJson<{ title?: string; description?: string; kind?: string; subject_id?: string; link_url?: string }>(req);
    if (!/^https:\/\/[^\s]{4,500}$/.test(String(b.link_url ?? ""))) return jsonError("paste an https:// link, or choose a file");
    row = { title: b.title ?? "", description: b.description || null, kind: b.kind ?? "work", subject_id: b.subject_id || null, link_url: b.link_url };
  }
  const title = String(row.title).trim();
  if (title.length < 2 || title.length > 160) return jsonError("give your work a title");
  if (row.subject_id && !/^[0-9a-f-]{36}$/.test(String(row.subject_id))) row.subject_id = null;
  const { error } = await svc.from("portfolio_items").insert({ ...row, title, description: row.description ? String(row.description).slice(0, 1000) : null,
    kind: kinds.includes(String(row.kind)) ? row.kind : "work", tenant_id: tid, student_id: sid, status: "submitted", added_by: ctx.userId });
  if (error) return jsonError(error.message);
  return NextResponse.json({ ok: true }, { status: 201 });
}
