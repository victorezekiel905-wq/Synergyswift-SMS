import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyGuardians } from "@/lib/notify";
import { sickbayNote, communityNote } from "@/lib/messaging/notices";
import { formatInZone } from "@/lib/messaging/outbox";
import { studentName } from "@/lib/school";
import { localParts, zonedToUtc } from "@/lib/attendance";
import { medicationRound, immunisationsDue, ALLERGY_ORDER, VACCINES, type Plan } from "@/lib/welfare";

export const dynamic = "force-dynamic";

const STUDENT = "first_name,last_name,other_names,admission_no,class_groups(name)";

/**
 * ?student_id=          medical profile, visits, medication plans and doses, immunisations
 * ?view=medication      today's medication round
 * ?view=immunisations   immunisations due in the next 30 days or overdue
 * otherwise             recent sick bay visits and students with allergies or conditions (most severe first)
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "health");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id, tz = ctx.tenant.timezone;
  const u = new URL(req.url).searchParams;
  const sid = u.get("student_id");
  const today = localParts(new Date(), tz).date;
  if (sid) {
    const [{ data: profile }, { data: visits }, { data: plans }, { data: doses }, { data: imms }] = await Promise.all([
      ctx.sb.from("medical_profiles").select("*").eq("tenant_id", tid).eq("student_id", sid).maybeSingle(),
      ctx.sb.from("sickbay_visits").select("*").eq("tenant_id", tid).eq("student_id", sid).order("at", { ascending: false }).limit(50),
      ctx.sb.from("medication_plans").select("*").eq("tenant_id", tid).eq("student_id", sid).order("active", { ascending: false }).order("starts_on", { ascending: false }),
      ctx.sb.from("medication_doses").select("*").eq("tenant_id", tid).eq("student_id", sid).order("given_at", { ascending: false }).limit(50),
      ctx.sb.from("immunisations").select("*").eq("tenant_id", tid).eq("student_id", sid).order("given_on", { ascending: false, nullsFirst: false })
    ]);
    return NextResponse.json({ profile, visits: visits ?? [], plans: plans ?? [], doses: doses ?? [], immunisations: imms ?? [], vaccines: VACCINES });
  }
  if (u.get("view") === "medication") {
    const start = zonedToUtc(`${today}T00:00`, tz)?.toISOString() ?? `${today}T00:00:00Z`;
    const [{ data: plans }, { data: doses }] = await Promise.all([
      ctx.sb.from("medication_plans").select(`*,students(${STUDENT})`).eq("tenant_id", tid).eq("active", true).lte("starts_on", today),
      ctx.sb.from("medication_doses").select(`id,plan_id,student_id,medicine,dose,status,note,given_at,students(${STUDENT})`).eq("tenant_id", tid).gte("given_at", start).order("given_at", { ascending: false })
    ]);
    const local = (doses ?? []).map((d: any) => ({ ...d, local_minutes: localParts(new Date(d.given_at), tz).minutes }));
    const now = localParts(new Date(), tz).minutes;
    const round = medicationRound((plans ?? []) as Plan[], local, today, now);
    const name = new Map<string, { student: string; class: string | null }>((plans ?? []).map((p: any) => [p.id, { student: studentName(p.students), class: p.students?.class_groups?.name ?? null }]));
    return NextResponse.json({
      round: round.map(r => ({ ...r, ...name.get(r.plan.id) })),
      as_needed: (plans ?? []).filter((p: any) => p.as_needed && (!p.ends_on || p.ends_on >= today)).map((p: any) => ({ ...p, student: studentName(p.students), class: p.students?.class_groups?.name ?? null, students: undefined })),
      given_today: (doses ?? []).map((d: any) => ({ ...d, student: studentName(d.students), students: undefined }))
    });
  }
  if (u.get("view") === "immunisations") {
    const { data } = await ctx.sb.from("immunisations").select(`student_id,vaccine,next_due_on,given_on,students(${STUDENT})`).eq("tenant_id", tid).limit(20000);
    const names = new Map<string, { student: string; class: string | null }>((data ?? []).map((r: any) => [r.student_id, { student: studentName(r.students), class: r.students?.class_groups?.name ?? null }]));
    return NextResponse.json({ due: immunisationsDue(data ?? [], today).map(r => ({ ...r, ...names.get(r.student_id), students: undefined })), vaccines: VACCINES });
  }
  const [{ data: visits }, { data: alerts }] = await Promise.all([
    ctx.sb.from("sickbay_visits").select(`*,students(${STUDENT})`).eq("tenant_id", tid).order("at", { ascending: false }).limit(200),
    ctx.sb.from("medical_profiles").select(`student_id,allergies,allergy_severity,has_epipen,conditions,medications,blood_group,genotype,care_plan,students(${STUDENT})`).eq("tenant_id", tid).limit(5000)
  ]);
  const rank = (a: any) => ALLERGY_ORDER[a.allergy_severity ?? ""] ?? 5;
  return NextResponse.json({ visits: visits ?? [], alerts: (alerts ?? []).filter((a: any) => (a.allergies ?? "").trim() || (a.conditions ?? "").trim() || a.has_epipen).sort((a: any, b: any) => rank(a) - rank(b)) });
}

const opt = (n: number) => z.string().trim().max(n).nullish();
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_profile"), student_id: z.string().uuid(), blood_group: opt(5), genotype: opt(5), allergies: opt(500),
    allergy_severity: z.enum(["none", "mild", "moderate", "severe", "anaphylaxis"]).nullish(), has_epipen: z.boolean().default(false), care_plan: opt(4000),
    conditions: opt(500), medications: opt(500), dietary: opt(300), emergency_contact: opt(200), doctor: opt(200) }),
  z.object({ action: z.literal("visit"), student_id: z.string().uuid(), complaint: z.string().trim().min(2).max(300), temperature: z.number().min(30).max(45).nullish(),
    pulse: z.number().int().min(20).max(250).nullish(), blood_pressure: z.string().trim().regex(/^\d{2,3}\/\d{2,3}$/, "e.g. 110/70").nullish().or(z.literal("")),
    treatment: opt(500), outcome: z.enum(["returned_to_class", "resting", "sent_home", "hospital"]), follow_up_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
    notify_parent: z.boolean().default(true) }),
  z.object({ action: z.literal("visit_left"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_plan"), id: z.string().uuid().optional(), student_id: z.string().uuid(), medicine: z.string().trim().min(1).max(120), dose: z.string().trim().min(1).max(80),
    route: z.string().trim().max(40).default("oral"), times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(8).default([]), as_needed: z.boolean().default(false),
    starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")), instructions: opt(1000), parent_consent: z.boolean(), stock_note: opt(200), active: z.boolean().default(true) }),
  z.object({ action: z.literal("give"), student_id: z.string().uuid(), plan_id: z.string().uuid().nullish(), medicine: z.string().trim().max(120).nullish(), dose: z.string().trim().max(80).nullish(),
    status: z.enum(["given", "refused", "missed", "not_available"]), note: opt(300), notify_parent: z.boolean().default(false) }),
  z.object({ action: z.literal("save_immunisation"), id: z.string().uuid().optional(), student_id: z.string().uuid(), vaccine: z.string().trim().min(1).max(80), dose_no: z.number().int().min(1).max(10).nullish(),
    given_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")), provider: opt(120), batch_no: opt(40), next_due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")) }),
  z.object({ action: z.literal("delete_immunisation"), id: z.string().uuid() })
]);

const OUTCOME: Record<string, string> = { returned_to_class: "returned to class", resting: "resting in the sick bay", sent_home: "needs to go home; please collect", hospital: "referred to hospital; please call the school now" };

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.health, "health");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, sb = ctx.sb, tz = ctx.tenant.timezone;
  const fail = (m: string) => jsonError(m.includes("row-level security") ? "you cannot do that" : m);
  const nul = (v: string | null | undefined) => v || null;
  switch (b.action) {
    case "save_profile": {
      const { action: _a, ...row } = b;
      const { error } = await sb.from("medical_profiles").upsert({ ...row, tenant_id: tid, updated_by: ctx.userId, updated_at: new Date().toISOString() }, { onConflict: "student_id" });
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "visit": {
      const { data: visit, error } = await sb.from("sickbay_visits").insert({ tenant_id: tid, student_id: b.student_id, complaint: b.complaint, temperature: b.temperature ?? null, pulse: b.pulse ?? null,
        blood_pressure: nul(b.blood_pressure), treatment: b.treatment ?? null, outcome: b.outcome, follow_up_on: nul(b.follow_up_on), recorded_by: ctx.userId, parent_notified: b.notify_parent }).select("id,at").single();
      if (error) return fail(error.message);
      let queued = 0;
      if (b.notify_parent) {
        const svc = createServiceClient();
        const { data: s } = await svc.from("students").select("first_name,last_name,other_names").eq("id", b.student_id).maybeSingle();
        const r = await notifyGuardians(svc, { tenantId: tid, studentIds: [b.student_id], kind: "health", refId: visit.id, createdBy: ctx.userId,
          build: (brand, g) => sickbayNote(brand, { guardianName: g.full_name, studentName: studentName(s), complaint: b.complaint, outcome: OUTCOME[b.outcome],
            time: formatInZone(new Date(visit.at), tz).time }) });
        queued = r.queued;
      }
      return NextResponse.json({ id: visit.id, messages_queued: queued }, { status: 201 });
    }
    case "visit_left": {
      const { error } = await sb.from("sickbay_visits").update({ left_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "save_plan": {
      const { action: _a, id, ...row } = b;
      if (!row.as_needed && !row.times.length) return jsonError("give the times, or tick 'when needed'");
      const full = { ...row, ends_on: nul(row.ends_on), times: row.as_needed ? [] : row.times };
      const { error } = id ? await sb.from("medication_plans").update(full).eq("tenant_id", tid).eq("id", id) : await sb.from("medication_plans").insert({ ...full, tenant_id: tid, created_by: ctx.userId });
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "give": {
      let medicine = b.medicine ?? null, dose = b.dose ?? null;
      if (b.plan_id) {
        const { data: p } = await sb.from("medication_plans").select("medicine,dose,student_id,parent_consent").eq("tenant_id", tid).eq("id", b.plan_id).maybeSingle();
        if (!p || p.student_id !== b.student_id) return jsonError("plan not found", 404);
        if (!p.parent_consent && b.status === "given") return jsonError("there is no parental consent on this plan");
        medicine = p.medicine; dose = p.dose;
      }
      if (!medicine || !dose) return jsonError("say what was given and how much");
      const { data, error } = await sb.from("medication_doses").insert({ tenant_id: tid, student_id: b.student_id, plan_id: b.plan_id ?? null, medicine, dose, status: b.status, note: b.note ?? null }).select("id,given_at").single();
      if (error) return fail(error.message);
      if (b.notify_parent) {
        const svc = createServiceClient();
        const { data: s } = await svc.from("students").select("first_name,last_name,other_names").eq("id", b.student_id).maybeSingle();
        const t = formatInZone(new Date(data.given_at), tz).time;
        await notifyGuardians(svc, { tenantId: tid, studentIds: [b.student_id], kind: "health", refId: data.id, createdBy: ctx.userId, budgetMs: 1500,
          build: (brand, g) => communityNote(brand, { name: g.full_name, subject: `Medication: ${studentName(s)}`,
            lines: [b.status === "given" ? `${studentName(s)} was given ${medicine} (${dose}) at ${t} by the school nurse.` : `${studentName(s)} did not take ${medicine} at ${t} (${b.status.replace("_", " ")}).${b.note ? ` ${b.note}` : ""}`] }) });
      }
      return NextResponse.json({ id: data.id }, { status: 201 });
    }
    case "save_immunisation": {
      const { action: _a, id, ...row } = b;
      const full = { ...row, given_on: nul(row.given_on), next_due_on: nul(row.next_due_on), dose_no: row.dose_no ?? null };
      const { error } = id ? await sb.from("immunisations").update(full).eq("tenant_id", tid).eq("id", id) : await sb.from("immunisations").insert({ ...full, tenant_id: tid, recorded_by: ctx.userId });
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "delete_immunisation": {
      const { error } = await sb.from("immunisations").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
  }
}
