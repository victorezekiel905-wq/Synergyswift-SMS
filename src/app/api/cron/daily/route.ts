import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { guardiansByStudent, rowsForGuardian, enqueue, loadBrand, dispatchDue, formatInZone, type OutboxRow } from "@/lib/messaging/outbox";
import { libraryOverdue } from "@/lib/messaging/templates";
import { studentName } from "@/lib/school";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily housekeeping (run once a day with Authorization: Bearer $CRON_SECRET):
 *  - expire old pickup codes
 *  - remind guardians about overdue library books (at most once every 7 days per loan)
 *  - close exams whose window has ended
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
  return NextResponse.json({ expired_pickup_codes: expired?.length ?? 0, exams_closed: closed?.length ?? 0, library_reminders: rows.length, delivery });
}
