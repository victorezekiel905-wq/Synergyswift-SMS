import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

const KINDS = { logo: "logo_url", signature: "principal_signature_url", stamp: "stamp_url" } as const;
type Kind = keyof typeof KINDS;
const MAX = 2 * 1024 * 1024;

/** PNG, JPEG or WebP, by the file's own first bytes (not its name). SVG is refused: it can carry script. */
function imageType(b: Uint8Array): { ext: string; type: string } | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", type: "image/png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return { ext: "webp", type: "image/webp" };
  return null;
}

/**
 * Uploads the school's logo, the principal's signature or the school stamp as an image,
 * and saves its address in the school's settings (report cards, emails and payment pages
 * show it from there). School admins only.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const form = await req.formData().catch(() => null);
  const kind = String(form?.get("kind") ?? "") as Kind;
  const file = form?.get("file");
  if (!(kind in KINDS)) return jsonError("choose what the image is: logo, signature or stamp");
  if (!(file instanceof File)) return jsonError("choose an image file");
  if (file.size > MAX) return jsonError("the image is larger than 2 MB; use a smaller one");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const t = imageType(bytes);
  if (!t) return jsonError("use a PNG, JPG or WebP image (a PNG with a transparent background prints best for a signature or stamp)");
  const tid = ctx.tenant.id;
  // A long random name: the address works without signing in (report cards, emails), so it must not be guessable.
  const path = `${tid}/branding/${kind}-${randomBytes(12).toString("hex")}.${t.ext}`;
  const svc = createServiceClient();
  const { error: upErr } = await svc.storage.from("school-assets").upload(path, bytes, { contentType: t.type, upsert: false });
  if (upErr) return jsonError(`the image couldn't be saved: ${upErr.message}`, 500);
  const url = `${appUrl(req)}/api/public/branding/${path}`;
  const { data: before } = await ctx.sb.from("tenant_settings").select(KINDS[kind]).eq("tenant_id", tid).maybeSingle();
  const { error } = await ctx.sb.from("tenant_settings").upsert({ tenant_id: tid, [KINDS[kind]]: url }, { onConflict: "tenant_id" });
  if (error) { await svc.storage.from("school-assets").remove([path]); return jsonError(error.message); }
  // The image it replaces is removed, if it was one uploaded here.
  const old = (before as Record<string, string | null> | null)?.[KINDS[kind]] ?? "";
  const oldPath = old.split("/api/public/branding/")[1];
  if (oldPath?.startsWith(`${tid}/branding/`)) await svc.storage.from("school-assets").remove([oldPath]);
  await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "settings.branding_uploaded", meta: { kind } });
  return NextResponse.json({ ok: true, kind, url });
}
