import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";

/** Automatic follow-up sequences: a series of messages or staff tasks that start when a lead enters a stage. */
export async function GET() {
  const ctx = await requireCtx(ROLES.admissions, "admissions");
  if (ctx instanceof NextResponse) return ctx;
  const { data, error } = await ctx.sb.from("admission_sequences").select("*,admission_sequence_steps(*)").eq("tenant_id", ctx.tenant.id).order("created_at");
  if (error) return jsonError(error.message);
  const { data: runs } = await ctx.sb.from("lead_sequence_runs").select("sequence_id,status").eq("tenant_id", ctx.tenant.id).limit(20000);
  return NextResponse.json((data ?? []).map((s: any) => ({
    ...s, admission_sequence_steps: (s.admission_sequence_steps ?? []).sort((a: any, b: any) => a.position - b.position),
    running: (runs ?? []).filter((r: any) => r.sequence_id === s.id && r.status === "active").length,
    finished: (runs ?? []).filter((r: any) => r.sequence_id === s.id && r.status === "done").length
  })));
}

const Step = z.object({ delay_hours: z.number().int().min(0).max(2160), channel: z.enum(["email", "sms", "whatsapp", "task"]), subject: z.string().trim().max(160).nullish(), body: z.string().trim().min(2).max(2000) });
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().optional(), name: z.string().trim().min(2).max(80),
    stage: z.enum(["enquiry", "tour_booked", "applied", "assessed", "offered", "accepted"]), active: z.boolean().default(true), steps: z.array(Step).min(1).max(12) }),
  z.object({ action: z.literal("toggle"), id: z.string().uuid(), active: z.boolean() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("seed") })
]);

// A sensible starting set; schools edit the wording.
const STARTERS = [
  { name: "New enquiry welcome", stage: "enquiry", steps: [
    { delay_hours: 0, channel: "email", subject: "Thank you for your interest in {school}", body: "Thank you for contacting {school} about {child}. We would love to show you around: book a school tour at a time that suits you, or apply online when you are ready." },
    { delay_hours: 2, channel: "task", subject: null, body: "Call {parent} to answer questions about {child} and invite them for a tour." },
    { delay_hours: 72, channel: "whatsapp", subject: null, body: "Hello {parent}, this is {school}. Would you like to visit the school with {child}? You can book a tour online." },
    { delay_hours: 168, channel: "email", subject: "Places for {level} are filling up", body: "Places for {level} at {school} are filling up. Apply online to secure an assessment date for {child}." }
  ] },
  { name: "After the tour", stage: "tour_booked", steps: [
    { delay_hours: 48, channel: "email", subject: "Thank you for visiting {school}", body: "Thank you for visiting {school}. When you are ready, apply online for {child} and we will arrange the assessment." },
    { delay_hours: 120, channel: "task", subject: null, body: "Follow up with {parent} after the tour: any questions, and is the family ready to apply?" }
  ] },
  { name: "Application received", stage: "applied", steps: [
    { delay_hours: 24, channel: "task", subject: null, body: "Check {child}'s application documents and schedule the assessment." },
    { delay_hours: 96, channel: "whatsapp", subject: null, body: "Hello {parent}, please upload {child}'s birth certificate and last school report on the application page if you have not done so." }
  ] },
  { name: "Offer reminder", stage: "offered", steps: [
    { delay_hours: 72, channel: "email", subject: "Your offer for {child}", body: "This is a reminder that {child}'s offer of a place at {school} is waiting for you. Sign the offer letter online to confirm the place." },
    { delay_hours: 168, channel: "task", subject: null, body: "Call {parent}: the offer for {child} has not been accepted yet." }
  ] }
] as const;

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admissions, "admissions");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const saveSteps = async (seqId: string, steps: z.infer<typeof Step>[]) => {
    await ctx.sb.from("admission_sequence_steps").delete().eq("sequence_id", seqId);
    const { error } = await ctx.sb.from("admission_sequence_steps").insert(steps.map((s, i) => ({ ...s, subject: s.subject || null, sequence_id: seqId, position: i + 1 })));
    return error;
  };
  if (b.action === "seed") {
    const { count } = await ctx.sb.from("admission_sequences").select("id", { count: "exact", head: true }).eq("tenant_id", tid);
    if ((count ?? 0) > 0) return jsonError("you already have follow-up sequences");
    for (const s of STARTERS) {
      const { data, error } = await ctx.sb.from("admission_sequences").insert({ tenant_id: tid, name: s.name, stage: s.stage, active: true }).select("id").single();
      if (error) return jsonError(error.message);
      const e = await saveSteps(data.id, s.steps.map(x => ({ ...x })));
      if (e) return jsonError(e.message);
    }
    return NextResponse.json({ added: STARTERS.length });
  }
  if (b.action === "save") {
    let id = b.id;
    if (id) {
      const { error } = await ctx.sb.from("admission_sequences").update({ name: b.name, stage: b.stage, active: b.active }).eq("tenant_id", tid).eq("id", id);
      if (error) return jsonError(error.message);
    } else {
      const { data, error } = await ctx.sb.from("admission_sequences").insert({ tenant_id: tid, name: b.name, stage: b.stage, active: b.active }).select("id").single();
      if (error) return jsonError(error.message);
      id = data.id;
    }
    const e = await saveSteps(id!, b.steps);
    return e ? jsonError(e.message) : NextResponse.json({ id });
  }
  if (b.action === "toggle") {
    const { error } = await ctx.sb.from("admission_sequences").update({ active: b.active }).eq("tenant_id", tid).eq("id", b.id);
    if (!b.active) await ctx.sb.from("lead_sequence_runs").update({ status: "stopped" }).eq("tenant_id", tid).eq("sequence_id", b.id).eq("status", "active");
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  const { error } = await ctx.sb.from("admission_sequences").delete().eq("tenant_id", tid).eq("id", b.id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}
