import { notifyGuardians } from "@/lib/notify";
import { communityNote } from "@/lib/messaging/notices";
import { formatInZone } from "@/lib/messaging/outbox";
import { studentName } from "@/lib/school";
import { tellStaff } from "@/lib/hr-server";
import { reminderDue } from "@/lib/library";

/** Readers whose reserved book is waiting for them: the student (and their parents) or the member of staff hears once. */
export async function notifyReadyHolds(svc: any, baseUrl: string) {
  const { data } = await svc.from("library_reservations").select("id,tenant_id,student_id,staff_id,expires_at,library_books(title),students(first_name,last_name,other_names,user_id),staff(user_id)")
    .eq("status", "ready").is("notified_at", null).limit(200);
  let n = 0;
  for (const r of data ?? []) {
    const { data: done } = await svc.from("library_reservations").update({ notified_at: new Date().toISOString() }).eq("id", r.id).is("notified_at", null).select("id");
    if (!done?.length) continue;
    const title = r.library_books?.title ?? "your book";
    const { data: t } = await svc.from("tenants").select("timezone").eq("id", r.tenant_id).maybeSingle();
    const until = r.expires_at ? formatInZone(new Date(r.expires_at), t?.timezone ?? "Africa/Lagos").date : "soon";
    const userId = r.students?.user_id ?? r.staff?.user_id;
    if (userId) await tellStaff(svc, r.tenant_id, [userId], "library", "Your library book is ready", `"${title}" is waiting for you at the library until ${until}.`, `${baseUrl}/student`, r.id);
    if (r.student_id) await notifyGuardians(svc, { tenantId: r.tenant_id, studentIds: [r.student_id], kind: "library", refId: r.id,
      build: (brand, g) => communityNote(brand, { name: g.full_name, subject: `Library: ${title}`, lines: [`The book ${studentName(r.students)} reserved, "${title}", is waiting at the library until ${until}.`] }) });
    n++;
  }
  return n;
}

/** Overdue books: a reminder every few days to the reader themselves (parents get the weekly reminder from the daily job). Also lapses uncollected holds. Run daily. */
export async function sendOverdueReminders(svc: any, now = new Date()) {
  await svc.rpc("library_expire_holds").then(() => null, () => null);
  const { data } = await svc.from("library_loans").select("id,tenant_id,student_id,staff_id,due_at,returned_at,last_reminded_at,library_books(title),students(user_id),staff(user_id)")
    .is("returned_at", null).lt("due_at", now.toISOString()).limit(2000);
  let n = 0;
  for (const l of data ?? []) {
    if (!reminderDue(l, now)) continue;
    await svc.from("library_loans").update({ last_reminded_at: now.toISOString() }).eq("id", l.id);
    const title = l.library_books?.title ?? "a library book";
    const days = Math.ceil((now.getTime() - Date.parse(l.due_at)) / 86_400_000);
    const userId = l.students?.user_id ?? l.staff?.user_id;
    if (!userId) continue;
    await tellStaff(svc, l.tenant_id, [userId], "library", "Library book overdue", `"${title}" is ${days} day${days === 1 ? "" : "s"} overdue. Please return or renew it.`, "/student", l.id);
    n++;
  }
  return n;
}
