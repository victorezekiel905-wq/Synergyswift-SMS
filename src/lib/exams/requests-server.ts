/**
 * Approved exam requests for one candidate and one online paper (phase 14j):
 * extra minutes, a late-sitting window, a resit, and special arrangements.
 * Empty before migration 7000.
 */
export type Allowances = {
  extra: number;
  late: { id: string; opens_at: string; closes_at: string } | null;
  resit: { id: string } | null;
  arrangements: string[];
};

export const NO_ALLOWANCES: Allowances = { extra: 0, late: null, resit: null, arrangements: [] };

export async function allowancesFor(svc: any, tenantId: string, examId: string, studentId: string | null | undefined, now = new Date()): Promise<Allowances> {
  if (!studentId) return NO_ALLOWANCES;
  const { data, error } = await svc.from("exam_requests").select("id,kind,minutes,opens_at,closes_at,arrangement,used_at")
    .eq("tenant_id", tenantId).eq("exam_id", examId).eq("student_id", studentId).eq("status", "approved");
  if (error || !data) return NO_ALLOWANCES;
  const t = now.getTime();
  const late = data.find((r: any) => r.kind === "late_sitting" && !r.used_at && t >= Date.parse(r.opens_at) && t <= Date.parse(r.closes_at)) ?? null;
  return {
    extra: data.filter((r: any) => r.kind === "extra_time").reduce((a: number, r: any) => a + (r.minutes ?? 0), 0),
    late: late ? { id: late.id, opens_at: late.opens_at, closes_at: late.closes_at } : null,
    resit: (() => { const r = data.find((x: any) => x.kind === "resit" && !x.used_at); return r ? { id: r.id } : null; })(),
    arrangements: data.filter((r: any) => r.kind === "special_arrangement" && r.arrangement).map((r: any) => r.arrangement)
  };
}

/** A resit: the first attempt is kept word for word in the archive, then cleared so the candidate can start again. */
export async function archiveForResit(svc: any, attempt: any, requestId: string) {
  const { error } = await svc.from("exam_attempt_archive").insert({ tenant_id: attempt.tenant_id, exam_id: attempt.exam_id, student_user_id: attempt.student_user_id, request_id: requestId, attempt });
  if (error) throw new Error(error.message);
  await svc.from("exam_attempts").delete().eq("id", attempt.id);
  await svc.from("exam_requests").update({ used_at: new Date().toISOString() }).eq("id", requestId);
}
