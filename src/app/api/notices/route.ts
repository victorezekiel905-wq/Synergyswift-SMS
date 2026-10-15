import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { sendNotice, remindUnread, type Notice } from "@/lib/notices-server";
import { readStats, EMERGENCY_TEMPLATES } from "@/lib/communication";
import { appUrl, studentName } from "@/lib/school";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const SENDERS = ["school_admin", "principal", "platform_admin", "it_admin"];

/** Announcements, circulars and emergencies with read receipts; ?id= one with its recipients; ?templates=1. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(SENDERS, "messaging");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const u = new URL(req.url).searchParams;
  if (u.get("templates")) {
    const { data } = await ctx.sb.from("message_templates").select("id,name,kind,title,body").eq("tenant_id", tid).order("name");
    return NextResponse.json({ items: data ?? [], emergency: EMERGENCY_TEMPLATES });
  }
  const id = u.get("id");
  if (id) {
    const { data: n } = await ctx.sb.from("notices").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!n) return jsonError("not found", 404);
    const { data: rec } = await ctx.sb.from("notice_recipients")
      .select("id,recipient_kind,student_ids,delivered_at,read_at,acknowledged_at,reminded_at,guardians(full_name,phone),users(full_name,role)").eq("notice_id", id).limit(20000);
    const kids = [...new Set((rec ?? []).flatMap((r: any) => r.student_ids))] as string[];
    const { data: st } = kids.length ? await createServiceClient().from("students").select("id,first_name,last_name,other_names,class_groups(name)").in("id", kids.slice(0, 5000)) : { data: [] };
    const sMap = new Map((st ?? []).map((s: any) => [s.id, `${studentName(s)}${s.class_groups?.name ? ` (${s.class_groups.name})` : ""}`]));
    return NextResponse.json({ notice: n, stats: readStats(rec ?? []), recipients: (rec ?? []).map((r: any) => ({ id: r.id, kind: r.recipient_kind,
      name: r.guardians?.full_name ?? r.users?.full_name ?? "", phone: r.guardians?.phone ?? null, about: r.student_ids.map((x: string) => sMap.get(x)).filter(Boolean).join(", "),
      delivered_at: r.delivered_at, read_at: r.read_at, acknowledged_at: r.acknowledged_at })) });
  }
  const { data, error } = await ctx.sb.from("notices").select("id,kind,title,status,audience,to_parents,to_students,to_staff,requires_ack,scheduled_for,sent_at,created_at,notice_recipients(read_at,acknowledged_at)")
    .eq("tenant_id", tid).order("created_at", { ascending: false }).limit(200);
  if (error) return jsonError(error.message);
  const [{ data: sections }, { data: classes }] = await Promise.all([
    ctx.sb.from("school_sections").select("id,name").eq("tenant_id", tid).order("position"),
    ctx.sb.from("class_groups").select("id,name,section_id").eq("tenant_id", tid).order("name")
  ]);
  return NextResponse.json({ items: (data ?? []).map((n: any) => ({ ...n, notice_recipients: undefined, stats: readStats(n.notice_recipients ?? []) })), sections: sections ?? [], classes: classes ?? [] });
}

const Audience = z.object({ scope: z.enum(["school", "sections", "classes", "people"]), ids: z.array(z.string().uuid()).max(200).default([]),
  students: z.array(z.string().uuid()).max(500).default([]), guardians: z.array(z.string().uuid()).max(500).default([]), staff: z.array(z.string().uuid()).max(500).default([]) });
const Draft = z.object({
  id: z.string().uuid().nullish(), kind: z.enum(["announcement", "circular", "emergency"]).default("announcement"), title: z.string().trim().min(2).max(160), body: z.string().trim().min(2).max(20000),
  audience: Audience.default({ scope: "school", ids: [], students: [], guardians: [], staff: [] }), to_parents: z.boolean().default(true), to_students: z.boolean().default(false),
  to_staff: z.boolean().default(false), staff_roles: z.array(z.string().max(40)).max(20).default([]), requires_ack: z.boolean().default(false),
  channels: z.array(z.enum(["email", "whatsapp", "sms", "push"])).min(1).default(["push", "email", "whatsapp"]), translate: z.boolean().default(true),
  expires_at: z.string().datetime({ offset: true }).nullish(), pinned: z.boolean().default(false)
});
const Body = z.discriminatedUnion("action", [
  Draft.extend({ action: z.literal("save") }),
  Draft.extend({ action: z.literal("send"), scheduled_for: z.string().datetime({ offset: true }).nullish(), confirm: z.string().nullish() }),
  z.object({ action: z.literal("remind"), id: z.string().uuid() }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_template"), id: z.string().uuid().nullish(), name: z.string().trim().min(2).max(80), kind: z.enum(["announcement", "circular", "emergency", "message"]),
    title: z.string().trim().max(160).nullish(), body: z.string().trim().min(2).max(10000) }),
  z.object({ action: z.literal("delete_template"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(SENDERS, "messaging");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, sb = ctx.sb, svc = createServiceClient();
  const now = new Date().toISOString();
  switch (b.action) {
    case "save_template": {
      const { action: _a, id, ...row } = b;
      const { error } = id ? await sb.from("message_templates").update(row).eq("tenant_id", tid).eq("id", id) : await sb.from("message_templates").insert({ ...row, tenant_id: tid, created_by: ctx.userId });
      return error ? jsonError(/duplicate|unique/.test(error.message) ? "there is already a template with that name" : error.message) : NextResponse.json({ ok: true });
    }
    case "delete_template": {
      const { error } = await sb.from("message_templates").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "remind": {
      const { data: n } = await sb.from("notices").select("*").eq("tenant_id", tid).eq("id", b.id).eq("status", "sent").maybeSingle();
      if (!n) return jsonError("only sent notices can be repeated", 404);
      return NextResponse.json(await remindUnread(svc, n as Notice, appUrl(req)));
    }
    case "cancel": {
      const { data, error } = await sb.from("notices").update({ status: "cancelled", updated_at: now }).eq("tenant_id", tid).eq("id", b.id).eq("status", "scheduled").select("id").maybeSingle();
      return error || !data ? jsonError(error?.message ?? "only a scheduled notice can be cancelled") : NextResponse.json({ ok: true });
    }
    case "delete": {
      const { data, error } = await sb.from("notices").delete().eq("tenant_id", tid).eq("id", b.id).in("status", ["draft", "cancelled"]).select("id").maybeSingle();
      return error || !data ? jsonError(error?.message ?? "sent notices are kept as a record") : NextResponse.json({ ok: true });
    }
  }
  // save or send
  const { action, id, ...row } = b as z.infer<typeof Draft> & { action: "save" | "send"; scheduled_for?: string | null; confirm?: string | null };
  const scheduled = action === "send" && "scheduled_for" in b && b.scheduled_for ? b.scheduled_for : null;
  if (!row.to_parents && !row.to_students && !row.to_staff) return jsonError("choose who should receive it: parents, students or staff");
  if (row.kind === "emergency") {
    if (action === "send" && (b as { confirm?: string | null }).confirm !== "SEND") return jsonError("type SEND to confirm an emergency alert");
    if (scheduled) return jsonError("emergency alerts go out straight away");
    Object.assign(row, { requires_ack: true, channels: ["push", "sms", "whatsapp", "email"], audience: { ...row.audience }, pinned: true,
      expires_at: row.expires_at ?? new Date(Date.now() + 24 * 3600_000).toISOString() });
  }
  if (row.audience.scope !== "school" && row.audience.scope !== "people" && !row.audience.ids.length) return jsonError("choose at least one section or class");
  const fields = { ...row, status: action === "send" ? (scheduled ? "scheduled" : "sending") : "draft", scheduled_for: scheduled, updated_at: now };
  let noticeId = id ?? null;
  if (noticeId) {
    const { data, error } = await sb.from("notices").update(fields).eq("tenant_id", tid).eq("id", noticeId).in("status", ["draft", "scheduled"]).select("id").maybeSingle();
    if (error || !data) return jsonError(error?.message ?? "a sent notice cannot be changed");
  } else {
    const { data, error } = await sb.from("notices").insert({ ...fields, tenant_id: tid, created_by: ctx.userId }).select("id").single();
    if (error) return jsonError(error.message);
    noticeId = data.id;
  }
  if (action !== "send" || scheduled) return NextResponse.json({ ok: true, id: noticeId, scheduled: Boolean(scheduled) });
  const { data: n } = await svc.from("notices").select("*").eq("id", noticeId).single();
  const r = await sendNotice(svc, n as Notice, appUrl(req));
  await sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: row.kind === "emergency" ? "notice.emergency_sent" : "notice.sent", target: noticeId, meta: { recipients: r.recipients, messages: r.messages } });
  return NextResponse.json({ ok: true, id: noticeId, ...r });
}
