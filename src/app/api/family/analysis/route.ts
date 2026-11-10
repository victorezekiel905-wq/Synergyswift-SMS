import { NextRequest, NextResponse } from "next/server";
import { jsonError, sessionIdentity } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { identifyGuardian, guardianHasChild } from "@/lib/guardian";
import { financeSettings } from "@/lib/fees";
import { studentAnalysis } from "@/lib/analysis-student-server";

export const dynamic = "force-dynamic";

/**
 * A parent's analysis of one of their children across every module the school uses
 * (?student_id=…; the first child when not given), with the list of their children to switch.
 * Only children linked to this parent; only what the school has published.
 */
export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams;
  const svc = createServiceClient();
  const who = await identifyGuardian(svc, q.get("token"), sessionIdentity);
  if ("error" in who) return jsonError(who.error, who.status);
  const { data: links } = await svc.from("student_guardians").select("student_id,students(first_name,last_name,status,class_groups(name))").eq("tenant_id", who.tenantId).eq("guardian_id", who.guardianId);
  const children: { id: string; name: string; class_name: string | null }[] = (links ?? []).filter((l: any) => l.students?.status === "active")
    .map((l: any) => ({ id: l.student_id as string, name: `${l.students.first_name} ${l.students.last_name}`, class_name: l.students.class_groups?.name ?? null }))
    .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
  if (!children.length) return NextResponse.json({ children, analysis: null });
  const wanted = q.get("student_id") || children[0]!.id;
  if (!children.some(c => c.id === wanted) || !(await guardianHasChild(svc, who.tenantId, who.guardianId, wanted))) return jsonError("you are not linked to this student", 403);
  const [{ data: tenant }, { currency }] = await Promise.all([
    svc.from("tenants").select("modules").eq("id", who.tenantId).maybeSingle(),
    financeSettings(svc, who.tenantId)
  ]);
  const analysis = await studentAnalysis(svc, { tenantId: who.tenantId, studentId: wanted, timezone: who.timezone || "Africa/Lagos", modules: tenant?.modules ?? null, forParent: true });
  if (!analysis) return jsonError("student not found", 404);
  return NextResponse.json({ children, currency, analysis }, { headers: { "Cache-Control": "no-store" } });
}
