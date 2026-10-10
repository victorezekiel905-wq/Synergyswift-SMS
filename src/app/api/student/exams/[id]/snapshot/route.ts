import { NextRequest, NextResponse } from "next/server";
import { requireCtx, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { GRACE_MS } from "@/lib/exams/server";

const MAX_BYTES = 300 * 1024;

/**
 * Webcam proctoring: the exam page sends a small JPEG every few seconds while
 * the exam requires it. Stored privately under <tenant>/<exam>/<attempt>/snaps/
 * and visible only to staff; the daily job deletes them after 30 days.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireCtx(["student"], "exams");
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const { data: exam } = await svc.from("exams").select("id,settings").eq("tenant_id", ctx.tenant.id).eq("id", params.id).maybeSingle();
  if (!exam || !exam.settings?.webcam_snapshots) return jsonError("this exam does not use the camera", 404);
  const { data: attempt } = await svc.from("exam_attempts").select("id,status,deadline_at").eq("exam_id", exam.id).eq("student_user_id", ctx.userId).maybeSingle();
  if (!attempt || !["in_progress", "locked"].includes(attempt.status)) return jsonError("exam is not in progress", 409);
  if (Date.now() > new Date(attempt.deadline_at).getTime() + GRACE_MS) return jsonError("time is up", 409);

  // At most one photo per half interval, so a modified page cannot flood storage.
  const interval = Math.min(600, Math.max(15, Number(exam.settings.snapshot_interval_sec ?? 60)));
  const { data: last } = await svc.from("exam_events").select("at").eq("attempt_id", attempt.id).eq("kind", "snapshot").order("at", { ascending: false }).limit(1);
  if (last?.[0] && Date.now() - new Date(last[0].at).getTime() < (interval * 1000) / 2) return jsonError("too soon", 429);

  const form = await req.formData();
  const file = form.get("photo");
  if (!(file instanceof File)) return jsonError("photo required");
  if (file.size > MAX_BYTES) return jsonError("photo too large", 413);
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return jsonError("photo must be a JPEG", 415);
  const path = `${ctx.tenant.id}/${exam.id}/${attempt.id}/snaps/${Date.now()}.jpg`;
  const { error } = await svc.storage.from("exam-uploads").upload(path, buf, { contentType: "image/jpeg" });
  if (error) return jsonError(error.message, 500);
  await svc.from("exam_events").insert({ attempt_id: attempt.id, kind: "snapshot", meta: { path, faces: Number(form.get("faces") ?? -1) } });
  await svc.from("exam_attempts").update({ last_seen_at: new Date().toISOString() }).eq("id", attempt.id);
  return NextResponse.json({ ok: true, next_in_sec: interval });
}
