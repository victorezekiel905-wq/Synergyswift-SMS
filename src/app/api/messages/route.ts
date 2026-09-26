import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { guardiansByStudent, rowsForGuardian, enqueue, tryDispatch, loadBrand, type OutboxRow } from "@/lib/messaging/outbox";
import { broadcast } from "@/lib/messaging/templates";
import { emailConfigured, whatsappConfigured, smsConfigured } from "@/lib/messaging/providers";

/** Delivery log + provider status. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.messaging, "messaging");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  let q = ctx.sb.from("message_outbox")
    .select("id,channel,to_address,to_name,kind,subject,status,attempts,last_error,created_at,sent_at,template_name")
    .eq("tenant_id", ctx.tenant.id).order("created_at", { ascending: false }).limit(300);
  const status = u.searchParams.get("status"), kind = u.searchParams.get("kind");
  if (status) q = q.eq("status", status);
  if (kind) q = q.eq("kind", kind);
  const { data, error } = await q;
  if (error) return jsonError(error.message);
  return NextResponse.json({ items: data ?? [], providers: { email: emailConfigured(), whatsapp: whatsappConfigured(), sms: smsConfigured() } });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("broadcast"), title: z.string().trim().min(2).max(120), body: z.string().trim().min(2).max(3000),
    class_group_ids: z.array(z.string().uuid()).default([]),   // empty = whole school
    channels: z.array(z.enum(["email", "whatsapp", "sms"])).min(1).default(["email", "whatsapp"]) }),
  z.object({ action: z.literal("retry"), ids: z.array(z.string().uuid()).min(1).max(500) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.messaging, "messaging");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();

  if (b.action === "retry") {
    const { error } = await svc.from("message_outbox").update({ status: "queued", next_attempt_at: new Date().toISOString(), attempts: 0 })
      .eq("tenant_id", tid).in("id", b.ids).in("status", ["failed", "skipped"]);
    if (error) return jsonError(error.message);
    const delivery = await tryDispatch(svc, { budgetMs: 15_000 });
    return NextResponse.json({ ok: true, delivery });
  }

  let sq = svc.from("students").select("id").eq("tenant_id", tid).eq("status", "active");
  if (b.class_group_ids.length) sq = sq.in("class_group_id", b.class_group_ids);
  const { data: students } = await sq.limit(20000);
  const ids = (students ?? []).map((s: { id: string }) => s.id);
  if (!ids.length) return jsonError("no students in the selected classes");
  const byStudent = await guardiansByStudent(svc, tid, ids);
  const brand = await loadBrand(svc, tid);

  // One message per guardian even if they have several children.
  const seen = new Set<string>();
  const rows: OutboxRow[] = [];
  byStudent.forEach(gs => gs.forEach(g => {
    if (seen.has(g.id)) return;
    seen.add(g.id);
    rows.push(...rowsForGuardian(tid, g, "broadcast", broadcast(brand, { guardianName: g.full_name, title: b.title, body: b.body }), null, ctx.userId)
      .filter(r => b.channels.includes(r.channel)));
  }));
  if (!rows.length) return jsonError("no guardians with a valid email or WhatsApp number");
  await enqueue(svc, rows);
  await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "broadcast.sent", meta: { title: b.title, recipients: rows.length } });
  const delivery = await tryDispatch(svc, { budgetMs: 25_000, concurrency: 10 });
  return NextResponse.json({ guardians: seen.size, messages_queued: rows.length, delivery });
}
