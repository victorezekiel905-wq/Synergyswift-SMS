import { NextRequest, NextResponse } from "next/server";
import { requireCtx, jsonError, ROLES, hasAny, readJson } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { storyPhotoAllowed } from "@/lib/accounts";

const MAX_MB = 6;

/** Students whose parents have said yes to photos inside the school (latest answer per child). */
async function photoConsented(svc: any, tenantId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data: purpose } = await svc.from("consent_purposes").select("id").eq("tenant_id", tenantId).eq("key", "photos_internal").maybeSingle();
  if (!purpose) return new Set();
  const { data: recs } = await svc.from("consent_records").select("student_id,granted,created_at").eq("tenant_id", tenantId).eq("purpose_id", purpose.id).in("student_id", ids).order("created_at", { ascending: false });
  const latest = new Map<string, boolean>();
  for (const r of recs ?? []) if (!latest.has(r.student_id)) latest.set(r.student_id, r.granted);
  return new Set([...latest].filter(([, g]) => g).map(([id]) => id));
}

/** A class's story: posts newest first, photos as short-lived links, likes. Staff, the class's students and its parents. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "classroom");
  if (ctx instanceof NextResponse) return ctx;
  const url = new URL(req.url);
  const cg = url.searchParams.get("class_group_id");
  if (!cg) return jsonError("class_group_id required");
  // RLS decides who can read this class's story.
  const { data: posts, error } = await ctx.sb.from("class_story_posts").select("id,class_group_id,author_id,body,photos,tagged,created_at,users:author_id(full_name)")
    .eq("tenant_id", ctx.tenant.id).eq("class_group_id", cg).order("created_at", { ascending: false }).limit(30);
  if (error) return jsonError(error.message);
  const svc = createServiceClient();
  const ids = (posts ?? []).map((p: { id: string }) => p.id);
  const { data: likes } = ids.length ? await svc.from("class_story_likes").select("post_id,user_id").in("post_id", ids) : { data: [] };
  const out = [];
  for (const p of posts ?? []) {
    const photos = [];
    for (const path of p.photos ?? []) {
      const { data } = await svc.storage.from("class-story").createSignedUrl(path, 3600);
      if (data?.signedUrl) photos.push(data.signedUrl);
    }
    const mine = (likes ?? []).filter((l: { post_id: string }) => l.post_id === p.id);
    out.push({ id: p.id, body: p.body, author: p.users?.full_name ?? "Teacher", created_at: p.created_at, photos, likes: mine.length, liked: mine.some((l: { user_id: string }) => l.user_id === ctx.userId), can_delete: p.author_id === ctx.userId || hasAny(ctx, ROLES.admin) });
  }
  return NextResponse.json({ posts: out });
}

/** New post (multipart: class_group_id, body, tagged[] student ids, photos[] up to 6 images). */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "classroom");
  if (ctx instanceof NextResponse) return ctx;
  const form = await req.formData();
  const cg = String(form.get("class_group_id") ?? "");
  const body = String(form.get("body") ?? "").trim().slice(0, 2000);
  const tagged = form.getAll("tagged").map(String).filter(id => /^[0-9a-f-]{36}$/.test(id));
  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!/^[0-9a-f-]{36}$/.test(cg)) return jsonError("class_group_id required");
  if (!body && !files.length) return jsonError("write something or add a photo");
  if (files.length > 6) return jsonError("at most 6 photos in a post");
  for (const f of files) {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type)) return jsonError("photos must be JPEG, PNG, WebP or HEIC");
    if (f.size > MAX_MB * 1024 * 1024) return jsonError(`each photo must be under ${MAX_MB} MB`);
  }
  const svc = createServiceClient();
  const tid = ctx.tenant.id;
  if (files.length) {
    const { data: s } = await svc.from("tenant_settings").select("story_photo_consent").eq("tenant_id", tid).maybeSingle();
    const required = s?.story_photo_consent !== false;
    if (required && !tagged.length) return jsonError("tick the children in the photos, so only children whose parents agreed to photos are shown");
    const { data: inClass } = await svc.from("students").select("id,first_name,last_name").eq("tenant_id", tid).eq("class_group_id", cg).in("id", tagged.length ? tagged : ["00000000-0000-0000-0000-000000000000"]);
    if ((inClass ?? []).length !== tagged.length) return jsonError("every tagged child must be in this class");
    const check = storyPhotoAllowed(tagged, await photoConsented(svc, tid, tagged), required);
    if (!check.ok) {
      const names = (inClass ?? []).filter((k: { id: string }) => check.missing.includes(k.id)).map((k: { first_name: string; last_name: string }) => `${k.first_name} ${k.last_name}`);
      return jsonError(`no photo consent yet for ${names.join(", ")}. Take a photo without them, or ask their parents in Consent & privacy.`);
    }
  }
  const id = crypto.randomUUID();
  const paths: string[] = [];
  for (const [i, f] of files.entries()) {
    const ext = f.type.split("/")[1].replace("jpeg", "jpg");
    const path = `${tid}/${cg}/${id}-${i}.${ext}`;
    const { error } = await svc.storage.from("class-story").upload(path, Buffer.from(await f.arrayBuffer()), { contentType: f.type });
    if (error) return jsonError(error.message, 500);
    paths.push(path);
  }
  // RLS checks the author teaches the class with the story privilege.
  const { error } = await ctx.sb.from("class_story_posts").insert({ id, tenant_id: tid, class_group_id: cg, author_id: ctx.userId, body: body || null, photos: paths, tagged });
  if (error) {
    if (paths.length) await svc.storage.from("class-story").remove(paths);
    return jsonError(error.message.includes("row-level security") ? "you cannot post to this class's story" : error.message, 403);
  }
  return NextResponse.json({ ok: true, id }, { status: 201 });
}

/** Like or unlike a post (anyone who can see it). */
export async function PATCH(req: NextRequest) {
  const ctx = await requireCtx(undefined, "classroom");
  if (ctx instanceof NextResponse) return ctx;
  const b = await readJson<{ post_id?: string; like?: boolean }>(req);
  if (!b.post_id || !/^[0-9a-f-]{36}$/.test(b.post_id)) return jsonError("post_id required");
  const { data: post } = await ctx.sb.from("class_story_posts").select("id").eq("id", b.post_id).maybeSingle();
  if (!post) return jsonError("not found", 404);
  const { error } = b.like === false
    ? await ctx.sb.from("class_story_likes").delete().eq("post_id", b.post_id).eq("user_id", ctx.userId)
    : await ctx.sb.from("class_story_likes").upsert({ post_id: b.post_id, user_id: ctx.userId, tenant_id: ctx.tenant.id });
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "classroom");
  if (ctx instanceof NextResponse) return ctx;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const { data: post } = await ctx.sb.from("class_story_posts").select("id,photos").eq("tenant_id", ctx.tenant.id).eq("id", id).maybeSingle();
  if (!post) return jsonError("not found", 404);
  const { data, error } = await ctx.sb.from("class_story_posts").delete().eq("id", id).select("id");
  if (error || !data?.length) return jsonError(error?.message ?? "only the author or an admin can delete this", 403);
  if (post.photos?.length) await createServiceClient().storage.from("class-story").remove(post.photos);
  return NextResponse.json({ ok: true });
}
