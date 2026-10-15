import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { messagingSettings } from "@/lib/student-messaging";
import { studentName } from "@/lib/school";

export const dynamic = "force-dynamic";
const LEADS = ["school_admin", "principal", "platform_admin", "counsellor"];

/**
 * Safeguarding view for admins, the principal and counsellors: flagged
 * messages from teacher-student and parent conversations, recent volume per
 * member of staff, and the student-messaging rules. ?thread= one teacher-student conversation.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(LEADS);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const u = new URL(req.url).searchParams;
  const all = u.get("all") === "1";
  const svc = createServiceClient();
  let sq = svc.from("student_thread_messages").select("id,body,flag_reason,flagged,reviewed_at,created_at,sender_kind,thread_id,student_threads(subject,students(first_name,last_name,other_names),staff:staff_user_id(full_name)),reviewer:reviewed_by(full_name)")
    .eq("tenant_id", tid).eq("flagged", true).order("created_at", { ascending: false }).limit(200);
  let pq = svc.from("conversation_messages").select("id,body,flag_reason,flagged,reviewed_at,created_at,sender_kind,sender_name,conversation_id,conversations(subject,students(first_name,last_name,other_names)),reviewer:reviewed_by(full_name)")
    .eq("tenant_id", tid).eq("flagged", true).order("created_at", { ascending: false }).limit(200);
  if (!all) { sq = sq.is("reviewed_at", null); pq = pq.is("reviewed_at", null); }
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [{ data: s }, { data: p }, { data: threads }, settings] = await Promise.all([sq, pq,
    svc.from("student_threads").select("staff_user_id,staff:staff_user_id(full_name)").eq("tenant_id", tid).gte("last_message_at", since).limit(5000),
    messagingSettings(svc, tid)]);
  const per = new Map<string, { name: string; threads: number }>();
  for (const t of threads ?? []) { const x = per.get(t.staff_user_id) ?? { name: (t as any).staff?.full_name ?? "", threads: 0 }; x.threads++; per.set(t.staff_user_id, x); }
  const items = [
    ...(s ?? []).map((m: any) => ({ id: m.id, source: "student", body: m.body, reason: m.flag_reason, at: m.created_at, reviewed_at: m.reviewed_at, reviewer: m.reviewer?.full_name ?? null,
      from: m.sender_kind === "staff" ? m.student_threads?.staff?.full_name : studentName(m.student_threads?.students), about: `${studentName(m.student_threads?.students)} and ${m.student_threads?.staff?.full_name ?? "a teacher"}`, thread_id: m.thread_id })),
    ...(p ?? []).map((m: any) => ({ id: m.id, source: "parent", body: m.body, reason: m.flag_reason, at: m.created_at, reviewed_at: m.reviewed_at, reviewer: m.reviewer?.full_name ?? null,
      from: m.sender_name, about: `${m.conversations?.subject ?? ""}${m.conversations?.students ? ` (${studentName(m.conversations.students)})` : ""}`, thread_id: m.conversation_id }))
  ].sort((a, b) => b.at.localeCompare(a.at));
  return NextResponse.json({ items, settings, volume: [...per.values()].sort((a, b) => b.threads - a.threads).slice(0, 30) });
}

const time = z.string().regex(/^\d{2}:\d{2}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review"), source: z.enum(["student", "parent"]), id: z.string().uuid() }),
  z.object({ action: z.literal("settings"), enabled: z.boolean(), from: time, to: time, parents_see: z.boolean() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(LEADS);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.action === "settings") {
    if (!["school_admin", "principal", "platform_admin"].some(r => ctx.roles.has(r))) return jsonError("only admins change these rules", 403);
    if (b.to <= b.from) return jsonError("the end time must be after the start time");
    const { error } = await createServiceClient().from("tenant_settings").upsert({ tenant_id: tid, student_messaging: b.enabled, student_messaging_from: b.from, student_messaging_to: b.to,
      student_messaging_parents_see: b.parents_see }, { onConflict: "tenant_id" });
    if (!error) await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "student_messaging.settings", meta: b });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  // Teacher-student messages are marked through the user's own client (the database checks the role);
  // parent messages are not open to client updates, so the server marks them after the role check above.
  const now = new Date().toISOString();
  const { data, error } = b.source === "student"
    ? await ctx.sb.from("student_thread_messages").update({ reviewed_at: now }).eq("tenant_id", tid).eq("id", b.id).select("id").maybeSingle()
    : await createServiceClient().from("conversation_messages").update({ reviewed_at: now, reviewed_by: ctx.userId }).eq("tenant_id", tid).eq("id", b.id).select("id").maybeSingle();
  return error || !data ? jsonError(error?.message ?? "not found", 404) : NextResponse.json({ ok: true });
}
