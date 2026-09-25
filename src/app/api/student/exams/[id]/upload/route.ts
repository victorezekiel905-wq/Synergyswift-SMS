import { NextRequest, NextResponse } from "next/server";
import { requireCtx, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { verifySeb, absoluteRequestUrl } from "@/lib/exams/seb";
import { GRACE_MS } from "@/lib/exams/server";

/** File-upload answers. Stored privately under <tenant>/<exam>/<attempt>/. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireCtx(["student"], "exams");
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const { data: exam } = await svc.from("exams").select("id,settings,tenant_id").eq("tenant_id", ctx.tenant.id).eq("id", params.id).maybeSingle();
  if (!exam) return jsonError("exam not found", 404);
  const seb = verifySeb(absoluteRequestUrl(req), req.headers, exam.settings ?? {});
  if (!seb.ok) return jsonError(seb.reason ?? "Safe Exam Browser required", 403);
  const { data: attempt } = await svc.from("exam_attempts").select("id,status,deadline_at,answers").eq("exam_id", exam.id).eq("student_user_id", ctx.userId).maybeSingle();
  if (!attempt || attempt.status !== "in_progress") return jsonError("exam is not in progress", 409);
  if (Date.now() > new Date(attempt.deadline_at).getTime() + GRACE_MS) return jsonError("time is up", 409);

  const form = await req.formData();
  const qid = String(form.get("question_id") ?? "");
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("file required");
  const { data: q } = await svc.from("exam_questions").select("id,type,data").eq("exam_id", exam.id).eq("id", qid).maybeSingle();
  if (!q || q.type !== "file_upload") return jsonError("not a file-upload question");
  const maxMb = Number(q.data?.max_mb ?? 10);
  if (file.size > maxMb * 1024 * 1024) return jsonError(`file is larger than ${maxMb} MB`, 413);
  const accept = String(q.data?.accept ?? ".pdf,.jpg,.jpeg,.png,.docx").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
  if (accept.length && !accept.includes(ext)) return jsonError(`allowed file types: ${accept.join(", ")}`, 415);

  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const path = `${ctx.tenant.id}/${exam.id}/${attempt.id}/${qid}-${Date.now()}-${safeName}`;
  const { error } = await svc.storage.from("exam-uploads").upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "application/octet-stream" });
  if (error) return jsonError(error.message, 500);
  const value = { path, name: file.name, size: file.size };
  await svc.from("exam_attempts").update({ answers: { ...(attempt.answers ?? {}), [qid]: value }, last_seen_at: new Date().toISOString() }).eq("id", attempt.id);
  return NextResponse.json(value);
}
