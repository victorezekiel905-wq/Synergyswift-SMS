import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { guardiansByStudent, rowsForGuardian, enqueue, tryDispatch, loadBrand, type OutboxRow } from "@/lib/messaging/outbox";
import { resultPublished } from "@/lib/messaging/templates";
import { appUrl } from "@/lib/school";

const Body = z.object({
  term_id: z.string().uuid(),
  class_group_id: z.string().uuid(),
  student_ids: z.array(z.string().uuid()).optional(),  // publish a subset
  notify: z.boolean().default(true),
  resend: z.boolean().default(false)                   // re-notify already-published cards
});

/**
 * Publishes report cards and pushes them to every guardian by email and
 * WhatsApp immediately (dispatch runs inside this request; leftovers and
 * retries go through the cron dispatcher).
 */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "results");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;

  let q = ctx.sb.from("report_cards").select("id,student_id,status,average,position,class_size,access_token,data")
    .eq("tenant_id", tid).eq("term_id", b.term_id).eq("class_group_id", b.class_group_id);
  if (b.student_ids?.length) q = q.in("student_id", b.student_ids);
  const { data: cards, error } = await q;
  if (error) return jsonError(error.message);
  const toPublish = (cards ?? []).filter((c: any) => c.status === "draft" || c.status === "approved");
  const toNotify = b.resend ? (cards ?? []).filter((c: any) => c.status !== "withheld") : toPublish;
  if (!toNotify.length) return jsonError("nothing to publish; compile results first (withheld cards are skipped)");

  if (toPublish.length) {
    const { error: pErr } = await ctx.sb.from("report_cards")
      .update({ status: "published", published_at: new Date().toISOString(), published_by: ctx.userId })
      .in("id", toPublish.map((c: any) => c.id));
    if (pErr) return jsonError(pErr.message);
  }
  await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "results.published",
    target: b.class_group_id, meta: { term_id: b.term_id, count: toPublish.length } });

  const { data: settings } = await ctx.sb.from("tenant_settings").select("notify_results").eq("tenant_id", tid).maybeSingle();
  if (!b.notify || settings?.notify_results === false) {
    return NextResponse.json({ published: toPublish.length, notified: 0 });
  }

  const svc = createServiceClient();
  const brand = await loadBrand(svc, tid);
  const guardians = await guardiansByStudent(svc, tid, toNotify.map((c: any) => c.student_id));
  const base = appUrl(req);
  const rows: OutboxRow[] = [];
  const noContact: string[] = [];
  for (const c of toNotify as any[]) {
    const gs = guardians.get(c.student_id) ?? [];
    const before = rows.length;
    for (const g of gs) {
      rows.push(...rowsForGuardian(tid, g, "result", resultPublished(brand, {
        guardianName: g.full_name, studentName: c.data?.student_name ?? "Your child", termName: c.data?.term_label ?? "Term",
        average: c.average === null ? null : Number(c.average), position: c.position, classSize: c.class_size,
        showPosition: Boolean(c.data?.scheme?.show_position), link: `${base}/r/${c.access_token}`,
        subjects: (c.data?.subjects ?? []).filter((s: any) => s.total !== null).map((s: any) => ({ subject: s.subject, total: s.total, grade: s.grade }))
      }), c.id, ctx.userId));
    }
    if (rows.length === before) noContact.push(c.data?.student_name ?? c.student_id);
  }
  if (rows.length) await enqueue(svc, rows);
  const delivery = rows.length ? await tryDispatch(svc, { budgetMs: 25_000, concurrency: 10 }) : null;
  return NextResponse.json({ published: toPublish.length, messages_queued: rows.length, delivery, students_without_contacts: noContact });
}
