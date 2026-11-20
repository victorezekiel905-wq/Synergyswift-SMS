import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { schoolInitials, nextStudentId } from "@/lib/admission-numbers";

/**
 * A student saved without an ID normally gets one from the database (migration 10600's trigger).
 * Where that update has not been run yet, the app gives the ID itself, in the same format
 * (the school's initials and a running number), instead of failing with a database error.
 * Returns the row unchanged when it has an ID or the database will give one.
 */
export async function withStudentId<T extends { admission_no?: string | null; [k: string]: unknown }>(tenantId: string, row: T): Promise<T> {
  if (row.admission_no && String(row.admission_no).trim()) return row;
  const svc = createServiceClient();
  const { error } = await svc.rpc("student_id_prefix", { p_tenant: tenantId });
  if (!error) return row; // the database fills it in
  const [{ data: t }, { data: s }] = await Promise.all([
    svc.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    svc.from("tenant_settings").select("school_name").eq("tenant_id", tenantId).maybeSingle()
  ]);
  const prefix = schoolInitials((s as any)?.school_name || (t as any)?.name);
  const { data: rows } = await svc.from("students").select("admission_no").eq("tenant_id", tenantId).like("admission_no", `${prefix}-%`).limit(100000);
  return { ...row, admission_no: nextStudentId((rows ?? []).map((r: any) => r.admission_no), prefix) };
}

/** A database error a person can act on, instead of the raw message about admission_no. */
export function studentSaveError(message: string): string {
  if (/duplicate/i.test(message)) return "that student ID is already used; type another or leave it blank";
  if (/admission_no/i.test(message)) return "the student ID could not be given automatically; type one, or run the latest database update";
  return message;
}
