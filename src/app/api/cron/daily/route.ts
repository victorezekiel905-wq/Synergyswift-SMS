import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { guardiansByStudent, rowsForGuardian, enqueue, loadBrand, dispatchDue, formatInZone, type OutboxRow } from "@/lib/messaging/outbox";
import { libraryOverdue } from "@/lib/messaging/templates";
import { studentName } from "@/lib/school";
import { expireOffers } from "@/lib/admissions-crm";
import { purgeEntrancePhotos } from "@/lib/entrance-server";
import { runFeeAutomation } from "@/lib/fees-plus";
import { sendOverdueReminders } from "@/lib/library-server";
import { remindDocuments } from "@/lib/compliance-server";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily housekeeping (run once a day with Authorization: Bearer $CRON_SECRET):
 *  - expire old pickup codes
 *  - remind guardians about overdue library books (at most once every 7 days per loan)
 *  - close exams whose window has ended
 *  - delete exam webcam photos older than 30 days
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const svc = createServiceClient();
  const now = new Date().toISOString();

  const { data: expired } = await svc.from("pickup_codes").update({ status: "expired" }).eq("status", "active").lt("expires_at", now).select("id");
  const { data: closed } = await svc.from("exams").update({ status: "closed" }).eq("status", "published").lt("closes_at", now).select("id");

  const offersExpired = await expireOffers(svc).catch(() => 0);
  // Entrance-test camera photos go after 60 days.
  const entrancePhotos = await purgeEntrancePhotos(svc).catch(() => 0);
  // Fee reminders before and after due dates, and late fees after the grace period.
  const fees = await runFeeAutomation(svc, appUrl(req)).catch(() => null);
  // Readers hear about overdue books; holds not collected in time pass to the next reader.
  const readerReminders = await sendOverdueReminders(svc).catch(() => 0);
  // Policies due for review and certificates running out.
  const documentReminders = await remindDocuments(svc, appUrl(req)).catch(() => 0);
  // Change history is kept for each school's chosen period; spent sign-in codes and access grants go at once.
  let historyPurged = 0;
  const { data: keep } = await svc.from("tenant_settings").select("tenant_id,audit_retention_days");
  for (const k of keep ?? []) {
    const cutoff = new Date(Date.now() - (k.audit_retention_days ?? 730) * 86400_000).toISOString();
    const { count } = await svc.from("data_changes").delete({ count: "exact" }).eq("tenant_id", k.tenant_id).lt("at", cutoff);
    historyPurged += count ?? 0;
  }
  await svc.from("access_grants").delete().lt("expires_at", now);
  await svc.from("phone_login_codes").delete().lt("created_at", new Date(Date.now() - 86400_000).toISOString());
  // Webcam photos are kept for 30 days for appeals, then removed.
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data: oldSnaps } = await svc.from("exam_events").select("id,meta").eq("kind", "snapshot").lt("at", monthAgo).is("meta->deleted", null).limit(1000);
  const snapPaths = (oldSnaps ?? []).map((e: any) => e.meta?.path).filter(Boolean);
  for (let i = 0; i < snapPaths.length; i += 100) await svc.storage.from("exam-uploads").remove(snapPaths.slice(i, i + 100));
  for (const e of oldSnaps ?? []) await svc.from("exam_events").update({ meta: { ...e.meta, deleted: true } }).eq("id", e.id);

  const { data: loans } = await svc.from("library_loans")
    .select("id,tenant_id,student_id,due_at,library_books(title),students(first_name,last_name,other_names),tenants(status,timezone)")
    .is("returned_at", null).lt("due_at", now).not("student_id", "is", null).limit(5000);
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const rows: OutboxRow[] = [];
  const byTenant = new Map<string, any[]>();
  for (const l of loans ?? []) {
    if (l.tenants?.status !== "active") continue;
    if (!byTenant.has(l.tenant_id)) byTenant.set(l.tenant_id, []);
    byTenant.get(l.tenant_id)!.push(l);
  }
  for (const [tid, list] of byTenant) {
    const { data: recent } = await svc.from("message_outbox").select("ref_id").eq("tenant_id", tid).eq("kind", "library_overdue").gte("created_at", weekAgo).in("ref_id", list.map(l => l.id));
    const skip = new Set((recent ?? []).map((r: any) => r.ref_id));
    const todo = list.filter(l => !skip.has(l.id));
    if (!todo.length) continue;
    const brand = await loadBrand(svc, tid);
    const gmap = await guardiansByStudent(svc, tid, todo.map(l => l.student_id));
    for (const l of todo) {
      const due = formatInZone(new Date(l.due_at), l.tenants?.timezone ?? "UTC").date;
      for (const g of gmap.get(l.student_id) ?? []) {
        rows.push(...rowsForGuardian(tid, g, "library_overdue",
          libraryOverdue(brand, { guardianName: g.full_name, studentName: studentName(l.students), title: l.library_books?.title ?? "a book", due }), l.id, null));
      }
    }
  }
  if (rows.length) await enqueue(svc, rows);
  const delivery = rows.length ? await dispatchDue(svc, { budgetMs: 40_000 }) : null;
  return NextResponse.json({ document_reminders: documentReminders, expired_pickup_codes: expired?.length ?? 0, exams_closed: closed?.length ?? 0, library_reminders: rows.length, reader_reminders: readerReminders, webcam_photos_deleted: snapPaths.length, admission_offers_expired: offersExpired, entrance_photos_deleted: entrancePhotos, change_history_purged: historyPurged, fees, delivery });
}
