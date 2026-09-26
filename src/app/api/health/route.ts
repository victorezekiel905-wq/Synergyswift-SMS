import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyGuardians } from "@/lib/notify";
import { sickbayNote } from "@/lib/messaging/notices";
import { formatInZone } from "@/lib/messaging/outbox";
import { studentName } from "@/lib/school";

/** ?student_id= → medical profile + visits. Otherwise: today's sick bay log and students with allergies/conditions. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "health");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const sid = new URL(req.url).searchParams.get("student_id");
  if (sid) {
    const [{ data: profile }, { data: visits }] = await Promise.all([
      ctx.sb.from("medical_profiles").select("*").eq("tenant_id", tid).eq("student_id", sid).maybeSingle(),
      ctx.sb.from("sickbay_visits").select("*").eq("tenant_id", tid).eq("student_id", sid).order("at", { ascending: false }).limit(50)
    ]);
    return NextResponse.json({ profile, visits: visits ?? [] });
  }
  const [{ data: visits }, { data: alerts }] = await Promise.all([
    ctx.sb.from("sickbay_visits").select("*,students(first_name,last_name,other_names,admission_no,class_groups(name))").eq("tenant_id", tid).order("at", { ascending: false }).limit(200),
    ctx.sb.from("medical_profiles").select("student_id,allergies,conditions,medications,blood_group,genotype,students(first_name,last_name,other_names,class_groups(name))")
      .eq("tenant_id", tid).limit(5000)
  ]);
  return NextResponse.json({ visits: visits ?? [], alerts: (alerts ?? []).filter((a: any) => (a.allergies ?? "").trim() || (a.conditions ?? "").trim()) });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_profile"), student_id: z.string().uuid(), blood_group: z.string().trim().max(5).nullish(), genotype: z.string().trim().max(5).nullish(),
    allergies: z.string().trim().max(500).nullish(), conditions: z.string().trim().max(500).nullish(), medications: z.string().trim().max(500).nullish(),
    dietary: z.string().trim().max(300).nullish(), emergency_contact: z.string().trim().max(200).nullish(), doctor: z.string().trim().max(200).nullish() }),
  z.object({ action: z.literal("visit"), student_id: z.string().uuid(), complaint: z.string().trim().min(2).max(300), temperature: z.number().min(30).max(45).nullish(),
    treatment: z.string().trim().max(500).nullish(), outcome: z.enum(["returned_to_class", "resting", "sent_home", "hospital"]), notify_parent: z.boolean().default(true) })
]);

const OUTCOME: Record<string, string> = { returned_to_class: "returned to class", resting: "resting in the sick bay", sent_home: "needs to go home; please collect", hospital: "referred to hospital; please call the school now" };

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.health, "health");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.action === "save_profile") {
    const { action: _a, ...row } = b;
    const { error } = await ctx.sb.from("medical_profiles").upsert({ ...row, tenant_id: tid, updated_by: ctx.userId, updated_at: new Date().toISOString() }, { onConflict: "student_id" });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  const { data: visit, error } = await ctx.sb.from("sickbay_visits").insert({ tenant_id: tid, student_id: b.student_id, complaint: b.complaint, temperature: b.temperature ?? null,
    treatment: b.treatment ?? null, outcome: b.outcome, recorded_by: ctx.userId, parent_notified: b.notify_parent }).select("id,at").single();
  if (error) return jsonError(error.message);
  let queued = 0;
  if (b.notify_parent) {
    const svc = createServiceClient();
    const { data: s } = await svc.from("students").select("first_name,last_name,other_names").eq("id", b.student_id).maybeSingle();
    const r = await notifyGuardians(svc, { tenantId: tid, studentIds: [b.student_id], kind: "health", refId: visit.id, createdBy: ctx.userId,
      build: (brand, g) => sickbayNote(brand, { guardianName: g.full_name, studentName: studentName(s), complaint: b.complaint, outcome: OUTCOME[b.outcome],
        time: formatInZone(new Date(visit.at), ctx.tenant.timezone).time }) });
    queued = r.queued;
  }
  return NextResponse.json({ id: visit.id, messages_queued: queued }, { status: 201 });
}
