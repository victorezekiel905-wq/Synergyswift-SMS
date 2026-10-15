import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny, type Ctx } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { readUpload, SUBMISSION_TYPES, RECORDING_TYPES } from "@/lib/files";
import { canSubmit, latePenalty, POINTS } from "@/lib/lms";
import { homeworkForStudent, checkOriginality } from "@/lib/homework";
import { assistConfigured, draftFeedback, assistErrorMessage } from "@/lib/assist";

export const dynamic = "force-dynamic";
const MAX_FILES = 5;

async function myStudent(ctx: Ctx) {
  const { data } = await createServiceClient().from("students").select("id,class_group_id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  return data as { id: string; class_group_id: string | null } | null;
}

/**
 * Opens a file with a short-lived link: ?sub=<submission>&file=<n> (the student's
 * upload) or ?sub=<submission>&media=<n> (the teacher's voice or video feedback).
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "homework");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const subId = u.get("sub") ?? "";
  const svc = createServiceClient();
  const { data: sub } = await svc.from("homework_submissions").select("id,tenant_id,student_id,status,files,feedback_media").eq("tenant_id", ctx.tenant.id).eq("id", subId).maybeSingle();
  if (!sub) return jsonError("not found", 404);
  const staff = hasAny(ctx, ROLES.staff);
  const me = staff ? null : await myStudent(ctx);
  if (!staff && me?.id !== sub.student_id) return jsonError("not found", 404);
  const media = u.get("media");
  const item = media !== null ? (sub.feedback_media ?? [])[Number(media)] : (sub.files ?? [])[Number(u.get("file") ?? -1)];
  if (!item) return jsonError("not found", 404);
  // Feedback stays hidden from the student until it is returned or marked.
  if (media !== null && !staff && sub.status === "submitted") return jsonError("not found", 404);
  const { data } = await svc.storage.from("homework").createSignedUrl(item.path, 300);
  return data?.signedUrl ? NextResponse.redirect(data.signedUrl) : jsonError("could not open the file", 500);
}

const StaffBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("annotate"), submission_id: z.string().uuid(), kind: z.enum(["text", "pin"]), start_offset: z.number().int().min(0).nullish(), end_offset: z.number().int().min(0).nullish(),
    quote: z.string().max(1000).nullish(), file_index: z.number().int().min(0).max(MAX_FILES).nullish(), x: z.number().min(0).max(100).nullish(), y: z.number().min(0).max(100).nullish(),
    comment: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal("delete_annotation"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete_media"), submission_id: z.string().uuid(), index: z.number().int().min(0) }),
  z.object({ action: z.literal("draft_feedback"), submission_id: z.string().uuid(), notes: z.string().trim().max(2000).nullish() }),
  z.object({ action: z.literal("check_originality"), submission_id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(undefined, "homework");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const multipart = (req.headers.get("content-type") ?? "").includes("multipart/form-data");

  // ---------- a student hands in ----------
  if (ctx.roles.has("student")) {
    if (!multipart) return jsonError("send the answer as a form");
    const me = await myStudent(ctx);
    if (!me) return jsonError("your login is not linked to a student record", 404);
    const form = await req.formData();
    const hwId = String(form.get("homework_id") ?? "");
    const hw = (await homeworkForStudent(svc, tid, me)).find((h: any) => h.id === hwId);
    if (!hw) return jsonError("homework not found", 404);
    const { data: full } = await svc.from("homework").select("id,subject_id,check_originality").eq("id", hw.id).single();
    const { data: existing } = await svc.from("homework_submissions").select("*").eq("homework_id", hw.id).eq("student_id", me.id).maybeSingle();
    const check = canSubmit(hw, existing ? { attempt: existing.attempt, status: existing.status } : null);
    if (!check.ok) return jsonError(check.reason, 409);
    const body = String(form.get("body") ?? "").slice(0, 50000);
    const uploads = form.getAll("files").filter(f => f instanceof File && f.size > 0);
    if (uploads.length > MAX_FILES) return jsonError(`attach at most ${MAX_FILES} files`);
    if (uploads.length && !hw.accept_files) return jsonError("this homework takes a written answer only");
    if (!body.trim() && !uploads.length) return jsonError("write an answer or attach your work");
    const files: { path: string; name: string; type: string; size: number }[] = [];
    for (const [i, file] of uploads.entries()) {
      const f = await readUpload(file, SUBMISSION_TYPES, 20);
      if (!f.ok) return jsonError(`${(file as File).name}: ${f.error}`, f.status);
      const path = `${tid}/${hw.id}/${me.id}/a${check.attempt}-${i}-${Date.now()}.${f.ext}`;
      const { error } = await svc.storage.from("homework").upload(path, f.buf, { contentType: f.type });
      if (error) return jsonError(error.message, 500);
      files.push({ path, name: f.name, type: f.type, size: f.size });
    }
    const now = new Date().toISOString();
    const pen = latePenalty({ dueAt: hw.due_at, submittedAt: now, pctPerDay: Number(hw.late_penalty_pct ?? 0), maxPct: Number(hw.late_penalty_max ?? 100) });
    if (existing) {
      // Keep the earlier attempt before replacing it.
      await svc.from("homework_submission_versions").insert({ tenant_id: tid, submission_id: existing.id, attempt: existing.attempt, body: existing.body, files: existing.files ?? [],
        submitted_at: existing.submitted_at, late: existing.late, score: existing.score, feedback: existing.feedback });
    }
    const row = { homework_id: hw.id, tenant_id: tid, student_id: me.id, body, files, attempt: check.attempt, late: pen.days > 0, penalty_pct: pen.pct, submitted_at: now,
      status: "submitted", score: null, raw_score: null, feedback: null, marked_by: null, marked_at: null, originality: null };
    const { data: saved, error } = await svc.from("homework_submissions").upsert(row, { onConflict: "homework_id,student_id" }).select("id").single();
    if (error) return jsonError(error.message);
    await svc.from("learning_activity").upsert({ tenant_id: tid, student_id: me.id, kind: "homework", points: POINTS.homework, ref_id: hw.id }, { onConflict: "student_id,kind,ref_id", ignoreDuplicates: true });
    if (full?.check_originality && body.trim()) {
      await checkOriginality(svc, { tenantId: tid, submissionId: saved.id, homeworkId: hw.id, studentId: me.id, body, subjectId: full.subject_id }).catch(() => null);
    }
    return NextResponse.json({ ok: true, attempt: check.attempt, late_days: pen.days, penalty_pct: pen.pct }, { status: 201 });
  }

  if (!hasAny(ctx, ROLES.staff)) return jsonError("forbidden", 403);
  const own = async (id: string) => (await ctx.sb.from("homework_submissions").select("id,student_id,homework_id,body,feedback_media,homework(title,instructions,max_score,subject_id,subjects(name),class_groups(name))").eq("tenant_id", tid).eq("id", id).maybeSingle()).data;

  // ---------- voice or video feedback (multipart: submission_id, file, seconds) ----------
  if (multipart) {
    const form = await req.formData();
    const sub = await own(String(form.get("submission_id") ?? ""));
    if (!sub) return jsonError("submission not found", 404);
    if ((sub.feedback_media ?? []).length >= 3) return jsonError("you can attach up to three recordings");
    const f = await readUpload(form.get("file"), RECORDING_TYPES, 25);
    if (!f.ok) return jsonError(f.error, f.status);
    const seconds = Math.max(0, Math.min(600, Math.round(Number(form.get("seconds") ?? 0))));
    const path = `${tid}/${sub.homework_id}/${sub.student_id}/feedback-${Date.now()}.${f.ext}`;
    const { error: upErr } = await svc.storage.from("homework").upload(path, f.buf, { contentType: f.type });
    if (upErr) return jsonError(upErr.message, 500);
    const media = [...(sub.feedback_media ?? []), { path, type: f.type, seconds, created_at: new Date().toISOString(), by: ctx.userId }];
    const { error } = await svc.from("homework_submissions").update({ feedback_media: media }).eq("id", sub.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true }, { status: 201 });
  }

  const parsed = StaffBody.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  if (b.action === "delete_annotation") {
    const { error } = await ctx.sb.from("submission_annotations").delete().eq("tenant_id", tid).eq("id", b.id).eq("author_id", ctx.userId);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  const sub = await own(b.submission_id);
  if (!sub) return jsonError("submission not found", 404);
  switch (b.action) {
    case "annotate": {
      if (b.kind === "text" && (b.start_offset == null || b.end_offset == null || b.end_offset <= b.start_offset)) return jsonError("select the words to comment on");
      if (b.kind === "pin" && (b.file_index == null || b.x == null || b.y == null)) return jsonError("click where the comment goes");
      const { action: _a, ...row } = b;
      const { data, error } = await ctx.sb.from("submission_annotations").insert({ ...row, tenant_id: tid, author_id: ctx.userId }).select("id").single();
      return error ? jsonError(error.message) : NextResponse.json({ ok: true, id: data.id }, { status: 201 });
    }
    case "delete_media": {
      const media = [...(sub.feedback_media ?? [])];
      const [gone] = media.splice(b.index, 1);
      if (!gone) return jsonError("not found", 404);
      await svc.storage.from("homework").remove([gone.path]);
      const { error } = await svc.from("homework_submissions").update({ feedback_media: media }).eq("id", sub.id);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "draft_feedback": {
      if (!assistConfigured()) return jsonError("Feedback drafting is not set up on this server.", 503);
      if (!sub.body?.trim()) return jsonError("there is no written answer to draft feedback on");
      const hw: any = sub.homework;
      try {
        return NextResponse.json(await draftFeedback({ subject: hw?.subjects?.name ?? null, level: hw?.class_groups?.name ?? null, task: [hw?.title, hw?.instructions].filter(Boolean).join("\n\n"),
          answer: sub.body, maxScore: hw?.max_score ?? null, teacherNotes: b.notes ?? null }));
      } catch (e) { const m = assistErrorMessage(e); return jsonError(m.message, m.status); }
    }
    case "check_originality": {
      if (!sub.body?.trim()) return jsonError("there is no written answer to check");
      const r = await checkOriginality(svc, { tenantId: tid, submissionId: sub.id, homeworkId: sub.homework_id, studentId: sub.student_id, body: sub.body, subjectId: (sub.homework as any)?.subject_id ?? null });
      return NextResponse.json(r ?? { similarity: 0, matches: [], style: null, note: "the answer is too short to check" });
    }
  }
}
