import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { readUpload, MEDIA_TYPES } from "@/lib/files";

export const dynamic = "force-dynamic";

/** Achievements, portfolio and certificates for one student; ?open=<portfolio id> opens a file. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireCtx(ROLES.staff, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const open = new URL(req.url).searchParams.get("open");
  if (open) {
    const { data: p } = await ctx.sb.from("portfolio_items").select("path,title").eq("tenant_id", tid).eq("student_id", id).eq("id", open).maybeSingle();
    if (!p?.path) return jsonError("not found", 404);
    const { data } = await createServiceClient().storage.from("student-documents").createSignedUrl(p.path, 300);
    return data?.signedUrl ? NextResponse.redirect(data.signedUrl) : jsonError("could not open the file", 500);
  }
  const [{ data: achievements }, { data: portfolio }, { data: certificates }, { data: subjects }] = await Promise.all([
    ctx.sb.from("student_achievements").select("*,users:recorded_by(full_name)").eq("tenant_id", tid).eq("student_id", id).order("achieved_on", { ascending: false }),
    ctx.sb.from("portfolio_items").select("*,subjects(name),users:added_by(full_name)").eq("tenant_id", tid).eq("student_id", id).order("created_at", { ascending: false }),
    ctx.sb.from("certificates").select("id,kind,serial_no,title,issued_on,status,verify_token,revoked_reason").eq("tenant_id", tid).eq("student_id", id).order("issued_on", { ascending: false }),
    ctx.sb.from("subjects").select("id,name").eq("tenant_id", tid).order("name")
  ]);
  return NextResponse.json({ achievements: achievements ?? [], portfolio: portfolio ?? [], certificates: certificates ?? [], subjects: subjects ?? [], me: ctx.userId });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("achievement"), id: z.string().uuid().nullish(), kind: z.enum(["academic", "sports", "arts", "leadership", "service", "competition", "attendance", "character", "other"]),
    title: z.string().trim().min(2).max(160), description: z.string().trim().max(1000).nullish(), level: z.enum(["class", "school", "local", "state", "national", "international"]),
    award: z.string().trim().max(120).nullish(), achieved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), shared_with_family: z.boolean().default(true) }),
  z.object({ action: z.literal("delete_achievement"), id: z.string().uuid() }),
  z.object({ action: z.literal("link"), title: z.string().trim().min(2).max(160), description: z.string().trim().max(1000).nullish(), kind: z.enum(["work", "project", "artwork", "writing", "photo", "video", "audio", "other"]),
    subject_id: z.string().uuid().nullish(), link_url: z.string().trim().url().max(500).refine(u => /^https:\/\//.test(u), "use an https:// link"), shared_with_family: z.boolean().default(true) }),
  z.object({ action: z.literal("review"), id: z.string().uuid(), status: z.enum(["approved", "returned"]), feedback: z.string().trim().max(1000).nullish() }),
  z.object({ action: z.literal("delete_item"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireCtx(ROLES.staff, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  const { data: st } = await sb.from("students").select("id").eq("tenant_id", tid).eq("id", id).maybeSingle();
  if (!st) return jsonError("student not found", 404);

  // A portfolio file (multipart: file, title, kind, subject_id, description, shared).
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const title = String(form.get("title") ?? "").trim();
    if (title.length < 2) return jsonError("give the piece of work a title");
    const f = await readUpload(form.get("file"), MEDIA_TYPES, 25);
    if (!f.ok) return jsonError(f.error, f.status);
    const svc = createServiceClient();
    const path = `${tid}/${id}/portfolio-${Date.now()}.${f.ext}`;
    const { error: upErr } = await svc.storage.from("student-documents").upload(path, f.buf, { contentType: f.type });
    if (upErr) return jsonError(upErr.message, 500);
    const kinds = ["work", "project", "artwork", "writing", "photo", "video", "audio", "other"];
    const subject = String(form.get("subject_id") ?? "");
    const { error } = await sb.from("portfolio_items").insert({ tenant_id: tid, student_id: id, title: title.slice(0, 160), description: String(form.get("description") ?? "").slice(0, 1000) || null,
      kind: kinds.includes(String(form.get("kind"))) ? String(form.get("kind")) : "work", subject_id: /^[0-9a-f-]{36}$/.test(subject) ? subject : null, path, content_type: f.type,
      shared_with_family: form.get("shared") !== "false", added_by: ctx.userId, reviewed_by: ctx.userId });
    if (error) { await svc.storage.from("student-documents").remove([path]); return jsonError(error.message); }
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  switch (b.action) {
    case "achievement": {
      const { action: _a, id: aid, ...row } = b;
      const { data, error } = aid
        ? await sb.from("student_achievements").update(row).eq("tenant_id", tid).eq("student_id", id).eq("id", aid).select("id").maybeSingle()
        : await sb.from("student_achievements").insert({ ...row, tenant_id: tid, student_id: id, recorded_by: ctx.userId }).select("id").single();
      return error || !data ? jsonError(error?.message ?? "only the person who recorded it or an admin can change it", 403) : NextResponse.json({ ok: true, id: data.id });
    }
    case "delete_achievement": {
      const { data, error } = await sb.from("student_achievements").delete().eq("tenant_id", tid).eq("student_id", id).eq("id", b.id).select("id").maybeSingle();
      return error || !data ? jsonError(error?.message ?? "only the person who recorded it or an admin can delete it", 403) : NextResponse.json({ ok: true });
    }
    case "link": {
      const { action: _a, ...row } = b;
      const { error } = await sb.from("portfolio_items").insert({ ...row, tenant_id: tid, student_id: id, added_by: ctx.userId, reviewed_by: ctx.userId });
      return error ? jsonError(error.message) : NextResponse.json({ ok: true }, { status: 201 });
    }
    case "review": {
      const { error } = await sb.from("portfolio_items").update({ status: b.status, feedback: b.feedback ?? null, reviewed_by: ctx.userId }).eq("tenant_id", tid).eq("student_id", id).eq("id", b.id);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "delete_item": {
      const { data, error } = await sb.from("portfolio_items").delete().eq("tenant_id", tid).eq("student_id", id).eq("id", b.id).select("path").maybeSingle();
      if (error || !data) return jsonError(error?.message ?? "not found", 404);
      if (data.path) await createServiceClient().storage.from("student-documents").remove([data.path]);
      return NextResponse.json({ ok: true });
    }
  }
}
