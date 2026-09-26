import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyGuardians, money } from "@/lib/notify";
import { eventInvite } from "@/lib/messaging/notices";
import { formatInZone } from "@/lib/messaging/outbox";
import { appUrl } from "@/lib/school";

/** School calendar: events with response counts (staff) — ?id= for the consent list. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "events");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const id = new URL(req.url).searchParams.get("id");
  if (id && ROLES.staff.some(r => ctx.roles.has(r))) {
    const { data: ev } = await ctx.sb.from("school_events").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!ev) return jsonError("not found", 404);
    const { data: responses } = await ctx.sb.from("event_responses").select("student_id,consent,note,responded_at,invoice_id,students(first_name,last_name,other_names,class_groups(name)),fee_invoices(status)").eq("event_id", id);
    return NextResponse.json({ event: ev, responses: responses ?? [] });
  }
  const { data } = await ctx.sb.from("school_events").select("*,event_responses(consent)").eq("tenant_id", tid)
    .gte("starts_at", new Date(Date.now() - 60 * 86400_000).toISOString()).order("starts_at").limit(300);
  return NextResponse.json((data ?? []).map((e: any) => ({ ...e, yes: (e.event_responses ?? []).filter((r: any) => r.consent).length, no: (e.event_responses ?? []).filter((r: any) => !r.consent).length, event_responses: undefined })));
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), title: z.string().trim().min(2).max(160), description: z.string().trim().max(4000).nullish(),
    kind: z.enum(["event", "trip", "club", "holiday", "exam", "meeting"]), starts_at: z.string().datetime({ offset: true }), ends_at: z.string().datetime({ offset: true }).nullish(),
    location: z.string().trim().max(200).nullish(), class_group_ids: z.array(z.string().uuid()).default([]), requires_consent: z.boolean().default(false),
    fee: z.number().min(0).max(1e9).default(0), capacity: z.number().int().positive().nullish(), respond_by: z.string().datetime({ offset: true }).nullish(), notify: z.boolean().default(true) }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "events");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.action === "delete") {
    const { error } = await ctx.sb.from("school_events").delete().eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  const { action: _a, notify, ...row } = b;
  const { data: ev, error } = await ctx.sb.from("school_events").insert({ ...row, tenant_id: tid, created_by: ctx.userId }).select("id,starts_at").single();
  if (error) return jsonError(error.message);
  let queued = 0;
  if (notify) {
    const svc = createServiceClient();
    let q = svc.from("students").select("id").eq("tenant_id", tid).eq("status", "active");
    if (row.class_group_ids.length) q = q.in("class_group_id", row.class_group_ids);
    const { data: studs } = await q.limit(20000);
    const { data: s } = await svc.from("tenant_settings").select("currency").eq("tenant_id", tid).maybeSingle();
    const f = formatInZone(new Date(ev.starts_at), ctx.tenant.timezone);
    const base = appUrl(req);
    const r = await notifyGuardians(svc, { tenantId: tid, studentIds: (studs ?? []).map((x: any) => x.id), kind: "event", refId: ev.id, createdBy: ctx.userId,
      dedupeGuardians: true, budgetMs: 20_000,
      build: (brand, g) => eventInvite(brand, { guardianName: g.full_name, title: row.title, when: `${f.date} ${f.time}`, needsConsent: row.requires_consent,
        fee: row.fee > 0 ? money(row.fee, s?.currency ?? "NGN") : null, link: g.portal_token ? `${base}/g/${g.portal_token}#events` : `${base}/parent#events` }) });
    queued = r.queued;
  }
  return NextResponse.json({ id: ev.id, messages_queued: queued }, { status: 201 });
}
