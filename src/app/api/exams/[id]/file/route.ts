import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";

/** Teacher opens a student's uploaded answer via a short-lived signed URL. */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const path = new URL(req.url).searchParams.get("path") ?? "";
  if (!path.startsWith(`${ctx.tenant.id}/${params.id}/`) || path.includes("..")) return jsonError("not found", 404);
  const { data, error } = await createServiceClient().storage.from("exam-uploads").createSignedUrl(path, 120);
  if (error || !data?.signedUrl) return jsonError("file not found", 404);
  return NextResponse.redirect(data.signedUrl);
}
