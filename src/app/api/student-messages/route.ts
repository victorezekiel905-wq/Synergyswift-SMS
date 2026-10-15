import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny, type Ctx } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { startThread, postToThread, messagingSettings, ThreadError } from "@/lib/student-messaging";
import { teachersOfStudent } from "@/lib/conversations";
import { appUrl, studentName } from "@/lib/school";

export const dynamic = "force-dynamic";

const who = (ctx: Ctx) => ({ tenantId: ctx.tenant.id, timezone: ctx.tenant.timezone, userId: ctx.userId, name: ctx.profile.full_name ?? "Teacher",
  isStaff: hasAny(ctx, ROLES.staff), isLead: hasAny(ctx, ["school_admin", "principal", "platform_admin", "counsellor"]) });

/**
 * Teacher-student conversations. Staff: their own (?student_id= to start one);
 * students: theirs and the teachers they can write to; parents: their child's
 * (?student_id=, if the school allows). ?id= one conversation.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx();
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const u = new URL(req.url).searchParams;
  const svc = createServiceClient();
  const settings = await messagingSettings(svc, tid);
  const id = u.get("id");
  if (id) {
    const { data: t } = await ctx.sb.from("student_threads").select("id,subject,status,student_id,staff_user_id,created_at,students(first_name,last_name,other_names,user_id),staff:staff_user_id(full_name)").eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!t) return jsonError("not found", 404);
    const { data: msgs } = await ctx.sb.from("student_thread_messages").select("id,sender_kind,body,flagged,flag_reason,created_at").eq("thread_id", id).order("created_at");
    // Opening it clears the reader's unread count.
    if (t.staff_user_id === ctx.userId) await svc.from("student_threads").update({ staff_unread: 0 }).eq("id", id);
    if (t.students?.user_id === ctx.userId) await svc.from("student_threads").update({ student_unread: 0 }).eq("id", id);
    const participant = t.staff_user_id === ctx.userId || t.students?.user_id === ctx.userId;
    return NextResponse.json({ thread: { ...t, student: studentName(t.students), teacher: (t as any).staff?.full_name ?? "", students: undefined }, messages: msgs ?? [],
      can_write: participant && t.status === "open" && settings.enabled, settings: { from: settings.from, to: settings.to } });
  }
  const cols = "id,subject,status,student_unread,staff_unread,last_message_at,student_id,staff_user_id,students(first_name,last_name,other_names,class_groups(name)),staff:staff_user_id(full_name)";
  let q = ctx.sb.from("student_threads").select(cols).eq("tenant_id", tid).order("last_message_at", { ascending: false }).limit(200);
  const studentFilter = u.get("student_id");
  let teachers: { id: string; name: string; role: string }[] = [];
  if (hasAny(ctx, ROLES.staff)) q = studentFilter ? q.eq("student_id", studentFilter) : q.eq("staff_user_id", ctx.userId);
  else {
    const { data: me } = await svc.from("students").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
    if (me) { q = q.eq("student_id", me.id); teachers = settings.enabled ? await teachersOfStudent(svc, tid, me.id) : []; }
    else if (studentFilter) q = q.eq("student_id", studentFilter);   // a parent; RLS decides
  }
  const { data, error } = await q;
  if (error) return jsonError(error.message);
  return NextResponse.json({ enabled: settings.enabled, hours: { from: settings.from, to: settings.to }, teachers,
    items: (data ?? []).map((t: any) => ({ ...t, student: studentName(t.students), class_name: t.students?.class_groups?.name ?? null, teacher: t.staff?.full_name ?? "", students: undefined, staff: undefined })) });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), student_id: z.string().uuid().nullish(), staff_user_id: z.string().uuid().nullish(), subject: z.string().trim().min(1).max(160), body: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("send"), thread_id: z.string().uuid(), body: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("close"), thread_id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();
  const w = who(ctx);
  if (!w.isStaff && !ctx.roles.has("student")) return jsonError("forbidden", 403);
  try {
    if (b.action === "start") {
      if (w.isStaff && !b.student_id) return jsonError("choose a student");
      return NextResponse.json(await startThread(svc, w, { studentId: b.student_id ?? "", staffUserId: b.staff_user_id, subject: b.subject, body: b.body, baseUrl: appUrl(req) }), { status: 201 });
    }
    if (b.action === "send") return NextResponse.json(await postToThread(svc, w, { threadId: b.thread_id, body: b.body, baseUrl: appUrl(req) }));
    const { data: t } = await svc.from("student_threads").select("id,staff_user_id").eq("tenant_id", ctx.tenant.id).eq("id", b.thread_id).maybeSingle();
    if (!t || (t.staff_user_id !== ctx.userId && !w.isLead)) return jsonError("only the teacher can close this conversation", 403);
    await svc.from("student_threads").update({ status: "closed" }).eq("id", t.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ThreadError) return jsonError(e.message, e.status);
    throw e;
  }
}
