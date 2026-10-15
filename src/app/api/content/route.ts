import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { unpackPackage, removePackageFiles, PKG_LIMITS } from "@/lib/content-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The content library. Staff see everything (?id= adds who has done it); students see what their class can open. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "lms");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const staff = hasAny(ctx, ROLES.staff);
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const { data: pkg } = await ctx.sb.from("content_packages").select("id,title,description,kind,subject_id,level,launch_path,size_bytes,meta,mastery_score,class_group_ids,created_by,created_at,files,subjects(name)")
      .eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!pkg) return jsonError("not found", 404);
    if (!staff) return NextResponse.json({ package: { ...pkg, files: undefined, file_count: (pkg.files ?? []).length }, files: (pkg.files ?? []).map((f: { p: string; s: number }) => ({ p: f.p, s: f.s })) });
    const { data: attempts } = await ctx.sb.from("content_attempts").select("status,score,time_seconds,launches,updated_at,completed_at,student_id,students(first_name,last_name,class_group_id)")
      .eq("package_id", id).not("student_id", "is", null).order("updated_at", { ascending: false }).limit(2000);
    return NextResponse.json({ package: { ...pkg, files: undefined, file_count: (pkg.files ?? []).length }, attempts: attempts ?? [],
      mine: pkg.created_by === ctx.userId || hasAny(ctx, ROLES.admin) });
  }
  const { data, error } = await ctx.sb.from("content_packages").select("id,title,description,kind,subject_id,level,size_bytes,mastery_score,class_group_ids,created_by,created_at,subjects(name)")
    .eq("tenant_id", tid).order("created_at", { ascending: false }).limit(500);
  if (error) return jsonError(error.message);
  const { data: mine } = await ctx.sb.from("content_attempts").select("package_id,status,score,updated_at").eq("user_id", ctx.userId);
  return NextResponse.json({ items: data ?? [], attempts: mine ?? [], staff, me: ctx.userId, limits: PKG_LIMITS });
}

const Meta = z.object({
  title: z.string().trim().max(160).nullish(), description: z.string().trim().max(2000).nullish(), subject_id: z.string().uuid().nullish(), level: z.string().trim().max(40).nullish(),
  class_group_ids: z.array(z.string().uuid()).max(100).default([]), mastery_score: z.number().min(0).max(100).nullish()
});
const Body = z.discriminatedUnion("action", [
  Meta.extend({ action: z.literal("update"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() })
]);

/** Multipart: upload a package (file + meta). JSON: update or delete one. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "lms");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("choose a .zip or .h5p file");
    if (file.size > PKG_LIMITS.zipMb * 1024 * 1024) return jsonError(`packages must be ${PKG_LIMITS.zipMb} MB or smaller`, 413);
    let meta: z.infer<typeof Meta>;
    try { meta = Meta.parse(JSON.parse(String(form.get("meta") ?? "{}"))); } catch { return jsonError("the details are not valid"); }
    if (meta.class_group_ids.length) {
      const { count } = await ctx.sb.from("class_groups").select("id", { count: "exact", head: true }).eq("tenant_id", tid).in("id", meta.class_group_ids);
      if (count !== meta.class_group_ids.length) return jsonError("choose classes from this school");
    }
    const id = randomUUID();
    const r = await unpackPackage(svc, tid, id, Buffer.from(await file.arrayBuffer()));
    if (!r.ok) return jsonError(r.error, 422);
    const title = (meta.title || r.detected.title || file.name.replace(/\.(zip|h5p)$/i, "")).slice(0, 160);
    const { error } = await ctx.sb.from("content_packages").insert({
      id, tenant_id: tid, title: title.length >= 2 ? title : `Package ${title}`, description: meta.description ?? null, kind: r.detected.kind, subject_id: meta.subject_id ?? null, level: meta.level ?? null,
      launch_path: r.detected.launch, files: r.files, size_bytes: r.size, meta: r.detected.meta, mastery_score: meta.mastery_score ?? r.detected.mastery ?? null,
      class_group_ids: meta.class_group_ids, created_by: ctx.userId
    });
    if (error) { await removePackageFiles(svc, tid, id, r.files.map(f => f.p)); return jsonError(error.message); }
    return NextResponse.json({ ok: true, id, kind: r.detected.kind, files: r.files.length }, { status: 201 });
  }
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  if (b.action === "update") {
    const { action: _a, id, ...row } = b;
    const patch = Object.fromEntries(Object.entries({ ...row, updated_at: new Date().toISOString() }).filter(([, v]) => v !== undefined));
    if (typeof patch.title === "string" && patch.title.length < 2) delete patch.title;
    const { data, error } = await ctx.sb.from("content_packages").update(patch).eq("tenant_id", tid).eq("id", id).select("id").maybeSingle();
    return error ? jsonError(error.message) : data ? NextResponse.json({ ok: true }) : jsonError("only the teacher who added it or an admin can change it", 403);
  }
  const { data: pkg } = await ctx.sb.from("content_packages").select("id,files").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
  if (!pkg) return jsonError("not found", 404);
  const { data: gone, error } = await ctx.sb.from("content_packages").delete().eq("tenant_id", tid).eq("id", b.id).select("id").maybeSingle();
  if (error || !gone) return jsonError(error?.message ?? "only the teacher who added it or an admin can delete it", 403);
  await removePackageFiles(svc, tid, b.id, (pkg.files ?? []).map((f: { p: string }) => f.p));
  return NextResponse.json({ ok: true });
}
