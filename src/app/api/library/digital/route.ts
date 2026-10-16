import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { readUpload, MEDIA_TYPES } from "@/lib/files";

export const dynamic = "force-dynamic";

/** Attaches the file for an e-book, audiobook or video (PDF, Word, slides, MP3, M4A, MP4; up to 50 MB). Form: book_id, file. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.library, "library");
  if (ctx instanceof NextResponse) return ctx;
  const form = await req.formData().catch(() => null);
  if (!form) return jsonError("invalid form");
  const bookId = String(form.get("book_id") ?? "");
  const { data: b } = await ctx.sb.from("library_books").select("id,format,digital_path").eq("tenant_id", ctx.tenant.id).eq("id", bookId).maybeSingle();
  if (!b) return jsonError("book not found", 404);
  if (b.format === "print") return jsonError("set the format to e-book, audio or video first");
  const r = await readUpload(form.get("file"), MEDIA_TYPES, 50);
  if (!r.ok) return jsonError(r.error, r.status);
  const svc = createServiceClient();
  const path = `${ctx.tenant.id}/${b.id}/${randomUUID()}.${r.ext}`;
  const up = await svc.storage.from("library-digital").upload(path, r.buf, { contentType: r.type, upsert: false });
  if (up.error) return jsonError("could not store the file; try again");
  await svc.from("library_books").update({ digital_path: path, digital_url: null }).eq("id", b.id);
  if (b.digital_path) await svc.storage.from("library-digital").remove([b.digital_path]);
  return NextResponse.json({ ok: true }, { status: 201 });
}
