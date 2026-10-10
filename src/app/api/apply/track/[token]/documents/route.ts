import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError } from "@/lib/auth";
import { refreshScore } from "@/lib/admissions-crm";

export const dynamic = "force-dynamic";

const KINDS = ["birth_certificate", "previous_report", "passport_photo", "transfer_letter", "medical", "other"];
const TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };
const MAX_MB = 8;

/** The family uploads supporting documents from their private application link. Stored privately; staff open them with short-lived links. */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!/^[0-9a-f]{24,64}$/i.test(token)) return jsonError("not found", 404);
  const svc = createServiceClient();
  const { data: a } = await svc.from("applications").select("id,tenant_id,lead_id,status,tenants(status),application_documents(id)").eq("tracking_token", token).maybeSingle();
  if (!a || (a as any).tenants?.status !== "active") return jsonError("not found", 404);
  if (["enrolled", "rejected", "withdrawn", "declined", "expired"].includes(a.status)) return jsonError("this application is closed");
  if ((a.application_documents ?? []).length >= 15) return jsonError("you have uploaded the maximum number of documents");
  const form = await req.formData();
  const kind = String(form.get("kind") ?? "");
  const file = form.get("file");
  if (!KINDS.includes(kind)) return jsonError("choose what the document is");
  if (!(file instanceof File)) return jsonError("choose a file");
  if (file.size > MAX_MB * 1024 * 1024) return jsonError(`files must be ${MAX_MB} MB or smaller`, 413);
  const ext = TYPES[file.type];
  if (!ext) return jsonError("upload a PDF or a photo (JPG, PNG, WEBP or HEIC)", 415);
  const buf = Buffer.from(await file.arrayBuffer());
  // Check the file really is what it claims (magic bytes), so nothing else is stored.
  const head = buf.subarray(0, 12).toString("hex");
  const ok = ext === "pdf" ? head.startsWith("25504446") : ext === "jpg" ? head.startsWith("ffd8") : ext === "png" ? head.startsWith("89504e47")
    : ext === "webp" ? head.startsWith("52494646") && buf.subarray(8, 12).toString() === "WEBP" : buf.subarray(4, 8).toString() === "ftyp";
  if (!ok) return jsonError("that file does not look like a PDF or photo", 415);
  const path = `${a.tenant_id}/${a.id}/${kind}-${Date.now()}.${ext}`;
  const { error } = await svc.storage.from("admissions").upload(path, buf, { contentType: file.type });
  if (error) return jsonError(error.message, 500);
  const name = file.name.replace(/[^\w.\- ]+/g, "_").slice(-100) || `${kind}.${ext}`;
  const { data: doc, error: dErr } = await svc.from("application_documents").insert({ tenant_id: a.tenant_id, application_id: a.id, kind, path, name, size: file.size, content_type: file.type }).select("id,kind,name,size,uploaded_at").single();
  if (dErr) return jsonError(dErr.message);
  if (a.lead_id) {
    await svc.from("lead_activities").insert({ tenant_id: a.tenant_id, lead_id: a.lead_id, kind: "system", body: `Family uploaded ${kind.replace("_", " ")}: ${name}.` });
    await refreshScore(svc, a.tenant_id, a.lead_id);
  }
  return NextResponse.json(doc, { status: 201 });
}
