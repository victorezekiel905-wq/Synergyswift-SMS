import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, hasAny, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { postMessage, startFromStaff, MessagingError } from "@/lib/conversations";
import { appUrl, studentName } from "@/lib/school";

/**
 * Staff inbox for parent conversations.
 *   GET                 threads visible to me (?scope=all for admins' safeguarding view)
 *   GET ?c=<id>         one thread's messages (marks it read for the assigned member of staff)
 *   GET ?student=<id>   the parents of a student, to start a thread
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const tid = ctx.tenant.id;
  const isAdmin = hasAny(ctx, ROLES.admin);

  const student = u.searchParams.get("student");
  if (student) {
    const { data } = await ctx.sb.from("student_guardians").select("relation,guardians(id,full_name,language)").eq("tenant_id", tid).eq("student_id", student);
    return NextResponse.json({ guardians: (data ?? []).filter((x: any) => x.guardians).map((x: any) => ({ ...x.guardians, relation: x.relation })) });
  }

  const cid = u.searchParams.get("c");
  if (cid) {
    const { data: c } = await ctx.sb.from("conversations")
      .select("id,subject,status,staff_user_id,student_id,guardian_id,created_at,guardians(full_name,language),students(first_name,last_name,other_names)").eq("tenant_id", tid).eq("id", cid).maybeSingle();
    if (!c) return jsonError("conversation not found", 404);
    const { data: msgs } = await ctx.sb.from("conversation_messages").select("id,sender_kind,sender_name,sender_user_id,body,translated_body,source_lang,created_at")
      .eq("conversation_id", cid).order("created_at").limit(500);
    if (c.staff_user_id === ctx.userId || (!c.staff_user_id && isAdmin)) {
      await createServiceClient().from("conversations").update({ staff_unread: 0 }).eq("id", cid).eq("tenant_id", tid);
    }
    return NextResponse.json({
      conversation: { ...c, student: studentName(c.students), guardian: c.guardians?.full_name, guardian_language: c.guardians?.language ?? null },
      // Staff read parents' messages translated into the school language, with the original kept.
      messages: (msgs ?? []).map((m: any) => ({
        id: m.id, mine: m.sender_user_id === ctx.userId, from_parent: m.sender_kind === "guardian", sender: m.sender_name, at: m.created_at,
        text: m.sender_kind === "guardian" ? (m.translated_body ?? m.body) : m.body,
        original: m.sender_kind === "guardian" && m.translated_body ? m.body : null,
        sent_as: m.sender_kind === "staff" && m.translated_body ? m.translated_body : null
      })),
      can_reply: c.status === "open" && (c.staff_user_id === ctx.userId || isAdmin)
    });
  }

  let q = ctx.sb.from("conversations")
    .select("id,subject,status,staff_unread,last_message_at,staff_user_id,started_by,guardians(full_name),students(first_name,last_name,other_names),users!conversations_staff_user_id_fkey(full_name)")
    .eq("tenant_id", tid).order("last_message_at", { ascending: false }).limit(200);
  if (!(isAdmin && u.searchParams.get("scope") === "all")) {
    q = isAdmin ? q.or(`staff_user_id.eq.${ctx.userId},staff_user_id.is.null`) : q.eq("staff_user_id", ctx.userId);
  }
  const { data, error } = await q;
  if (error) return jsonError(error.message);
  return NextResponse.json({
    is_admin: isAdmin,
    threads: (data ?? []).map((c: any) => ({
      id: c.id, subject: c.subject, status: c.status, unread: c.staff_unread, last_message_at: c.last_message_at, started_by: c.started_by,
      guardian: c.guardians?.full_name, student: studentName(c.students), staff: c.users?.full_name ?? "School office", mine: c.staff_user_id === ctx.userId
    }))
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), guardian_id: z.string().uuid(), student_id: z.string().uuid(),
    subject: z.string().trim().min(2).max(160), body: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("reply"), conversation_id: z.string().uuid(), body: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("close"), conversation_id: z.string().uuid() }),
  z.object({ action: z.literal("reopen"), conversation_id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const isAdmin = hasAny(ctx, ROLES.admin);
  const svc = createServiceClient();
  const base = appUrl(req);
  try {
    if (b.action === "start") {
      const r = await startFromStaff(svc, { tenantId: tid, staff: { userId: ctx.userId, name: ctx.profile.full_name, isAdmin }, guardianId: b.guardian_id, studentId: b.student_id, subject: b.subject, body: b.body, baseUrl: base });
      return NextResponse.json(r, { status: 201 });
    }
    // Only the member of staff in the thread, or an admin, can reply or close it.
    const { data: c } = await ctx.sb.from("conversations").select("id,staff_user_id").eq("tenant_id", tid).eq("id", b.conversation_id).maybeSingle();
    if (!c) return jsonError("conversation not found", 404);
    if (c.staff_user_id !== ctx.userId && !isAdmin) return jsonError("forbidden", 403);
    if (b.action === "reply") {
      return NextResponse.json(await postMessage(svc, { tenantId: tid, conversationId: c.id, sender: { kind: "staff", userId: ctx.userId, name: ctx.profile.full_name }, body: b.body, baseUrl: base }));
    }
    await svc.from("conversations").update({ status: b.action === "close" ? "closed" : "open" }).eq("id", c.id).eq("tenant_id", tid);
    await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: `conversation.${b.action}`, target: c.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof MessagingError) return jsonError(e.message, e.status);
    return jsonError((e as Error).message);
  }
}
