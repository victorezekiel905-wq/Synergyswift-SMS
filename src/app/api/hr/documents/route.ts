import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCtx, ROLES, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { readUpload } from "@/lib/files";

export const dynamic = "force-dynamic";

const TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" };
const KINDS = ["cv", "id", "offer_letter", "contract", "certificate", "reference", "medical", "appraisal", "exit", "other"];
const SELF_KINDS = ["cv", "id", "certificate", "medical", "other"];

/** Opens a staff document (HR: any; staff: their own visible ones). GET ?id= */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const { data: d } = await ctx.sb.from("staff_documents").select("path,title").eq("tenant_id", ctx.tenant.id).eq("id", id).maybeSingle();
  if (!d) return jsonError("not found", 404);
  const { data } = await createServiceClient().storage.from("staff-documents").createSignedUrl(d.path, 300);
  return data?.signedUrl ? NextResponse.redirect(data.signedUrl) : jsonError("not found", 404);
}

/**
 * Uploads a document to a staff record. HR files anything for anyone (and can keep it from the person,
 * e.g. references); staff add their own CV, ID, certificates and medical notes.
 * Form: file, kind, title, staff_id (HR), visible_to_staff (HR).
 */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const form = await req.formData().catch(() => null);
  if (!form) return jsonError("invalid form");
  const hr = hasAny(ctx, ROLES.hr);
  const tid = ctx.tenant.id;
  const kind = String(form.get("kind") ?? "other");
  if (!KINDS.includes(kind)) return jsonError("choose what kind of document this is");
  const { data: me } = await ctx.sb.from("staff").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
  let staffId = String(form.get("staff_id") ?? "") || me?.id || "";
  if (!hr) {
    if (!me) return jsonError("no staff record is linked to your account; ask HR", 404);
    if (staffId !== me.id) return jsonError("forbidden", 403);
    if (!SELF_KINDS.includes(kind)) return jsonError("HR files that kind of document");
  }
  const svc = createServiceClient();
  const { data: s } = await svc.from("staff").select("id").eq("tenant_id", tid).eq("id", staffId).maybeSingle();
  if (!s) return jsonError("staff not found", 404);
  staffId = s.id;
  const r = await readUpload(form.get("file"), TYPES, 10);
  if (!r.ok) return jsonError(r.error, r.status);
  const title = (String(form.get("title") ?? "").trim() || r.name).slice(0, 160);
  const path = `${tid}/${staffId}/${randomUUID()}.${r.ext}`;
  const up = await svc.storage.from("staff-documents").upload(path, r.buf, { contentType: r.type, upsert: false });
  if (up.error) return jsonError("could not store the file; try again");
  const { data, error } = await svc.from("staff_documents").insert({ tenant_id: tid, staff_id: staffId, kind, title, path, mime: r.type, size_bytes: r.size,
    visible_to_staff: hr ? form.get("visible_to_staff") !== "false" : true, uploaded_by: ctx.userId }).select("id").single();
  if (error) { await svc.storage.from("staff-documents").remove([path]); return jsonError(error.message); }
  return NextResponse.json({ id: data.id }, { status: 201 });
}
