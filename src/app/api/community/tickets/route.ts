import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { createTicket, replyToTicket, setTicketStatus, CrmError } from "@/lib/community-server";
import { slaState, slaFor, PRIORITIES, TICKET_CATEGORIES, TICKET_KINDS, TICKET_STATUSES } from "@/lib/community";

export const dynamic = "force-dynamic";

/**
 * Complaints and requests. Admins see every ticket; other staff see the ones
 * they raised or are assigned (enforced by RLS on the caller's client).
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "community");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const tid = ctx.tenant.id;
  const admin = hasAny(ctx, ROLES.admin);
  const id = u.searchParams.get("id");
  if (id) {
    const { data: t } = await ctx.sb.from("tickets").select("*,guardians(id,full_name,phone,email),students(id,first_name,last_name,other_names),assignee:assigned_to(id,full_name),creator:created_by(full_name)")
      .eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!t) return jsonError("ticket not found", 404);
    const { data: messages } = await ctx.sb.from("ticket_messages").select("id,author,body,internal,created_at,users:author_id(full_name)").eq("ticket_id", id).order("created_at");
    const { token: _t, ...ticket } = t;
    return NextResponse.json({ ticket: { ...ticket, sla: slaState(t) }, messages: messages ?? [], can_assign: admin, me: ctx.userId });
  }
  const view = u.searchParams.get("view") ?? "open";
  let q = ctx.sb.from("tickets").select("id,ticket_no,kind,category,priority,channel,subject,status,assigned_to,created_by,created_at,updated_at,respond_due_at,resolve_due_at,first_response_at,resolved_at,escalation_level,satisfaction,guardians(full_name),students(first_name,last_name),assignee:assigned_to(full_name)")
    .eq("tenant_id", tid).order("created_at", { ascending: false }).limit(500);
  if (view === "open") q = q.not("status", "in", "(resolved,closed)");
  if (view === "mine") q = q.eq("assigned_to", ctx.userId).not("status", "in", "(resolved,closed)");
  if (view === "unassigned") q = q.is("assigned_to", null).not("status", "in", "(resolved,closed)");
  if (view === "done") q = q.in("status", ["resolved", "closed"]);
  const cat = u.searchParams.get("category");
  if (cat) q = q.eq("category", cat);
  const { data, error } = await q;
  if (error) return jsonError(error.message);
  const items = (data ?? []).map((t: any) => ({ ...t, sla: slaState(t) }));
  const svc = createServiceClient();
  const [{ data: staff }, { data: s }] = await Promise.all([
    svc.from("users").select("id,full_name,role").eq("tenant_id", tid).eq("active", true).not("role", "in", "(student,parent)").order("full_name"),
    svc.from("tenant_settings").select("ticket_sla").eq("tenant_id", tid).maybeSingle()
  ]);
  // Satisfaction and SLA performance over the last 90 days (admins only).
  let stats = null;
  if (admin) {
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const { data: recent } = await ctx.sb.from("tickets").select("status,category,respond_due_at,resolve_due_at,first_response_at,resolved_at,satisfaction,created_at").eq("tenant_id", tid).gte("created_at", since).limit(5000);
    const r = recent ?? [];
    const states: ReturnType<typeof slaState>[] = r.map((t: any) => slaState(t));
    const rated = r.filter((t: any) => t.satisfaction);
    const resolved = r.filter((t: any) => t.resolved_at);
    stats = {
      total: r.length, open: r.filter((t: any) => !["resolved", "closed"].includes(t.status)).length,
      responded_in_time: states.filter(s => s.respond.state === "met").length, responded: states.filter(s => s.respond.state === "met" || s.respond.state === "late").length,
      resolved_in_time: states.filter(s => s.resolve.state === "met").length, resolved: resolved.length,
      avg_resolve_hours: resolved.length ? Math.round(resolved.reduce((a: number, t: any) => a + (new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime()) / 3600_000, 0) / resolved.length) : null,
      satisfaction: rated.length ? Math.round((rated.reduce((a: number, t: any) => a + t.satisfaction, 0) / rated.length) * 10) / 10 : null, rated: rated.length,
      by_category: Object.entries(r.reduce((m: Record<string, number>, t: any) => ({ ...m, [t.category]: (m[t.category] ?? 0) + 1 }), {})).sort((a: any, b: any) => b[1] - a[1])
    };
  }
  return NextResponse.json({
    items, staff: staff ?? [], admin, me: ctx.userId, stats,
    sla: Object.fromEntries(PRIORITIES.map(p => [p, slaFor(p, s?.ticket_sla)]))
  });
}

const Hours = z.number().positive().max(24 * 90);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), guardian_id: z.string().uuid().nullish(), student_id: z.string().uuid().nullish(), kind: z.enum(TICKET_KINDS).default("complaint"),
    category: z.enum(TICKET_CATEGORIES).default("other"), priority: z.enum(PRIORITIES).default("normal"), channel: z.enum(["phone", "email", "walk_in", "whatsapp", "portal"]).default("phone"),
    subject: z.string().trim().min(2).max(160), body: z.string().trim().min(1).max(5000), assigned_to: z.string().uuid().nullish(), acknowledge: z.boolean().default(true) }),
  z.object({ action: z.literal("reply"), id: z.string().uuid(), body: z.string().trim().min(1).max(5000), internal: z.boolean().default(false) }),
  z.object({ action: z.literal("status"), id: z.string().uuid(), status: z.enum(TICKET_STATUSES), note: z.string().trim().max(2000).nullish() }),
  z.object({ action: z.literal("assign"), id: z.string().uuid(), assigned_to: z.string().uuid().nullable() }),
  z.object({ action: z.literal("update"), id: z.string().uuid(), priority: z.enum(PRIORITIES).optional(), category: z.enum(TICKET_CATEGORIES).optional() }),
  z.object({ action: z.literal("sla"), sla: z.record(z.enum(PRIORITIES), z.object({ respond: Hours, resolve: Hours })) }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "community");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const admin = hasAny(ctx, ROLES.admin);
  const base = appUrl(req);
  try {
    switch (b.action) {
      case "create": {
        if (b.guardian_id) {
          const { data: g } = await svc.from("guardians").select("id").eq("tenant_id", tid).eq("id", b.guardian_id).maybeSingle();
          if (!g) return jsonError("family not found", 404);
        }
        if (b.assigned_to && !admin && b.assigned_to !== ctx.userId) return jsonError("only a school admin can assign a ticket to someone else", 403);
        const t = await createTicket(svc, { tenantId: tid, guardianId: b.guardian_id ?? null, studentId: b.student_id ?? null, kind: b.kind, category: b.category, priority: b.priority,
          channel: b.channel, subject: b.subject, body: b.body, assignedTo: b.assigned_to ?? null, createdBy: ctx.userId, baseUrl: base, acknowledge: b.acknowledge });
        await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "ticket.created", meta: { ticket: t.ticket_no } });
        return NextResponse.json({ ok: true, id: t.id, ticket_no: t.ticket_no }, { status: 201 });
      }
      case "reply": {
        const { data: t } = await ctx.sb.from("tickets").select("id").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
        if (!t) return jsonError("ticket not found", 404);
        return NextResponse.json(await replyToTicket(svc, { tenantId: tid, ticketId: b.id, author: "staff", authorId: ctx.userId, authorName: ctx.profile.full_name, body: b.body, internal: b.internal, baseUrl: base }));
      }
      case "status":
        await setTicketStatus(svc, { tenantId: tid, ticketId: b.id, status: b.status, note: b.note, actorId: ctx.userId, actorName: ctx.profile.full_name, baseUrl: base, sb: ctx.sb });
        return NextResponse.json({ ok: true });
      case "assign": {
        if (!admin) return jsonError("only a school admin can assign tickets", 403);
        if (b.assigned_to) {
          const { data: u } = await svc.from("users").select("id").eq("tenant_id", tid).eq("id", b.assigned_to).eq("active", true).not("role", "in", "(student,parent)").maybeSingle();
          if (!u) return jsonError("choose an active member of staff");
        }
        const { data: t, error } = await ctx.sb.from("tickets").update({ assigned_to: b.assigned_to, updated_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.id).select("id,ticket_no,subject").maybeSingle();
        if (error || !t) return jsonError(error?.message ?? "ticket not found", error ? 400 : 404);
        await svc.from("ticket_messages").insert({ tenant_id: tid, ticket_id: t.id, author: "system", body: `${ctx.profile.full_name} ${b.assigned_to ? "assigned" : "unassigned"} this ticket.`, internal: true });
        if (b.assigned_to && b.assigned_to !== ctx.userId) {
          const { staffRows, enqueue, tryDispatch } = await import("@/lib/messaging/outbox");
          const rows = await staffRows(svc, { tenantId: tid, userIds: [b.assigned_to], kind: "ticket", refId: t.id, subject: `Assigned to you: ${t.ticket_no}`, text: t.subject, url: `${base}/school/support?ticket=${t.id}` });
          if (rows.length) { await enqueue(svc, rows); await tryDispatch(svc, { budgetMs: 3000 }); }
        }
        return NextResponse.json({ ok: true });
      }
      case "update": {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (b.priority) patch.priority = b.priority;
        if (b.category) patch.category = b.category;
        const { data: t, error } = await ctx.sb.from("tickets").update(patch).eq("tenant_id", tid).eq("id", b.id).select("id").maybeSingle();
        if (error || !t) return jsonError(error?.message ?? "ticket not found or not yours to change", error ? 400 : 404);
        return NextResponse.json({ ok: true });
      }
      case "sla": {
        if (!admin) return jsonError("only school admins can change response times", 403);
        for (const [p, v] of Object.entries(b.sla)) if (v.resolve < v.respond) return jsonError(`${p}: the time to resolve must be at least the time to respond`);
        const { error } = await svc.from("tenant_settings").upsert({ tenant_id: tid, ticket_sla: b.sla }, { onConflict: "tenant_id" });
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "delete": {
        if (!admin) return jsonError("only school admins can delete tickets", 403);
        const { error } = await ctx.sb.from("tickets").delete().eq("tenant_id", tid).eq("id", b.id);
        if (error) return jsonError(error.message);
        await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "ticket.deleted", meta: { id: b.id } });
        return NextResponse.json({ ok: true });
      }
    }
  } catch (e) {
    if (e instanceof CrmError) return jsonError(e.message, e.status);
    return jsonError((e as Error).message);
  }
}
