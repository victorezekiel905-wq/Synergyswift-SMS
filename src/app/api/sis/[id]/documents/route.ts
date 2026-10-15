import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { readUpload, DOC_TYPES } from "@/lib/files";

export const dynamic = "force-dynamic";

const KINDS = ["birth_certificate", "passport_photo", "previous_report", "transfer_letter", "medical", "immunisation", "id_document", "court_order", "sen_report", "certificate", "agreement", "other"];
const CONFIDENTIAL = ["court_order", "sen_report", "medical"];
const MANAGERS = ["school_admin", "principal", "platform_admin", "it_admin", "counsellor", "nurse"];

/** A student's documents (RLS hides confidential ones from most staff); ?open=<id> redirects to a short-lived link. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireCtx(ROLES.staff, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const open = new URL(req.url).searchParams.get("open");
  if (open) {
    const { data: d } = await ctx.sb.from("student_documents").select("path,name").eq("tenant_id", tid).eq("student_id", id).eq("id", open).maybeSingle();
    if (!d) return jsonError("not found", 404);
    const { data } = await createServiceClient().storage.from("student-documents").createSignedUrl(d.path, 120, { download: d.name });
    if (!data?.signedUrl) return jsonError("could not open the file", 500);
    await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "student_document.opened", target: open });
    return NextResponse.redirect(data.signedUrl);
  }
  const svc = createServiceClient();
  const [{ data: docs }, { data: app }] = await Promise.all([
    ctx.sb.from("student_documents").select("id,kind,name,size,content_type,notes,shared_with_family,confidential,created_at,users:uploaded_by(full_name)").eq("tenant_id", tid).eq("student_id", id).order("created_at", { ascending: false }),
    svc.from("applications").select("id,application_no,application_documents(id,kind,name,size,uploaded_at)").eq("tenant_id", tid).eq("student_id", id).maybeSingle()
  ]);
  const can = hasAny(ctx, MANAGERS);
  return NextResponse.json({ items: docs ?? [], from_application: app && can ? { application_no: app.application_no, documents: app.application_documents ?? [] } : null, can_manage: can });
}

/** Upload (multipart: file, kind, notes, shared, confidential), or copy a document from the admissions application ({ copy_application_document }). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireCtx(MANAGERS, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const { data: st } = await ctx.sb.from("students").select("id").eq("tenant_id", tid).eq("id", id).maybeSingle();
  if (!st) return jsonError("student not found", 404);
  const svc = createServiceClient();
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const b = await readJson<{ copy_application_document?: string }>(req);
    const { data: ad } = await svc.from("application_documents").select("kind,name,path,size,content_type,applications!inner(student_id,tenant_id)").eq("id", String(b.copy_application_document ?? ""))
      .eq("applications.student_id", id).eq("applications.tenant_id", tid).maybeSingle();
    if (!ad) return jsonError("document not found", 404);
    const { data: blob, error: dlErr } = await svc.storage.from("admissions").download(ad.path);
    if (dlErr || !blob) return jsonError("could not read the admissions file", 500);
    const ext = ad.path.split(".").pop();
    const path = `${tid}/${id}/${ad.kind}-${Date.now()}.${ext}`;
    const { error: upErr } = await svc.storage.from("student-documents").upload(path, Buffer.from(await blob.arrayBuffer()), { contentType: ad.content_type ?? undefined });
    if (upErr) return jsonError(upErr.message, 500);
    const kind = KINDS.includes(ad.kind) ? ad.kind : "other";
    const { error } = await ctx.sb.from("student_documents").insert({ tenant_id: tid, student_id: id, kind, name: ad.name, path, size: ad.size, content_type: ad.content_type,
      confidential: CONFIDENTIAL.includes(kind), uploaded_by: ctx.userId, notes: "From the admissions application" });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true }, { status: 201 });
  }
  const form = await req.formData();
  const kind = String(form.get("kind") ?? "other");
  if (!KINDS.includes(kind)) return jsonError("choose what the document is");
  const f = await readUpload(form.get("file"), DOC_TYPES, 10);
  if (!f.ok) return jsonError(f.error, f.status);
  const path = `${tid}/${id}/${kind}-${Date.now()}.${f.ext}`;
  const { error: upErr } = await svc.storage.from("student-documents").upload(path, f.buf, { contentType: f.type });
  if (upErr) return jsonError(upErr.message, 500);
  const confidential = form.get("confidential") === null ? CONFIDENTIAL.includes(kind) : form.get("confidential") === "true";
  const { data, error } = await ctx.sb.from("student_documents").insert({ tenant_id: tid, student_id: id, kind, name: f.name, path, size: f.size, content_type: f.type,
    notes: String(form.get("notes") ?? "").slice(0, 300) || null, shared_with_family: form.get("shared") === "true" && !confidential, confidential, uploaded_by: ctx.userId }).select("id").single();
  if (error) { await svc.storage.from("student-documents").remove([path]); return jsonError(error.message); }
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

/** { id, shared_with_family?, confidential?, kind?, notes? } */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireCtx(MANAGERS, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const b = await readJson<{ id?: string; shared_with_family?: boolean; confidential?: boolean; kind?: string; notes?: string | null }>(req);
  const patch: Record<string, unknown> = {};
  if (typeof b.confidential === "boolean") patch.confidential = b.confidential;
  if (typeof b.shared_with_family === "boolean") patch.shared_with_family = b.shared_with_family;
  if (b.kind && KINDS.includes(b.kind)) patch.kind = b.kind;
  if (b.notes !== undefined) patch.notes = b.notes ? String(b.notes).slice(0, 300) : null;
  const { data, error } = await ctx.sb.from("student_documents").update(patch).eq("tenant_id", ctx.tenant.id).eq("student_id", id).eq("id", String(b.id ?? "")).select("id,confidential,shared_with_family").maybeSingle();
  if (error || !data) return jsonError(error?.message ?? "not found", error ? 400 : 404);
  // Confidential papers are never shown to families.
  if (data.confidential && data.shared_with_family) await ctx.sb.from("student_documents").update({ shared_with_family: false }).eq("id", data.id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireCtx(ROLES.admin, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const doc = new URL(req.url).searchParams.get("doc") ?? "";
  const { data } = await ctx.sb.from("student_documents").delete().eq("tenant_id", ctx.tenant.id).eq("student_id", id).eq("id", doc).select("path").maybeSingle();
  if (!data) return jsonError("not found", 404);
  await createServiceClient().storage.from("student-documents").remove([data.path]);
  return NextResponse.json({ ok: true });
}
