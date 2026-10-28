import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { z as z4 } from "zod/v4";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { generateJson, aiErrorMessage } from "@/lib/ai";
import { createServiceClient } from "@/lib/supabase/service";
import { essayMark, appraisalSummary, feeReminder, timetableHelp } from "@/lib/ai-drafts";

export const maxDuration = 120;

/**
 * Small AI drafts for staff screens (phase 14p). Nothing is saved here: the
 * screen fills the form and the person edits and saves it.
 *  - job_advert: the "About the job" and "What we are looking for" text (HR).
 *  - iep_targets: SMART targets for a student's support plan, from the SEN
 *    profile (needs, strengths, what works) and the plan's existing targets.
 *  - essay_mark, appraisal_summary, fee_reminder, timetable_help (14q): see lib/ai-drafts.ts.
 */
const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("job_advert"), title: z.string().trim().min(2).max(160), department: z.string().trim().max(120).nullish(),
    employment_type: z.string().max(40).nullish(), location: z.string().trim().max(120).nullish(), salary_range: z.string().trim().max(120).nullish(), notes: z.string().trim().max(3000).nullish() }),
  z.object({ kind: z.literal("iep_targets"), student_id: z.string().uuid(), iep_id: z.string().uuid().nullish(), focus: z.string().trim().max(500).nullish() }),
  z.object({ kind: z.literal("essay_mark"), exam_id: z.string().uuid(), attempt_id: z.string().uuid(), question_id: z.string().uuid() }),
  z.object({ kind: z.literal("appraisal_summary"), appraisal_id: z.string().uuid() }),
  z.object({ kind: z.literal("fee_reminder"), guardian_id: z.string().uuid() }),
  z.object({ kind: z.literal("timetable_help"), days: z.number().int().min(1).max(7).default(5),
    unplaced: z.array(z.object({ classId: z.string().uuid(), subjectId: z.string().uuid(), teacherId: z.string().uuid().nullable(), perWeek: z.number().int().min(1).max(20), reason: z.string().max(200).nullish() })).min(1).max(200) })
]);

const Advert = z4.object({ description: z4.string(), requirements: z4.string() });
const Targets = z4.object({ targets: z4.array(z4.object({ area: z4.string(), target: z4.string(), strategies: z4.string(), success_criteria: z4.string() })) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  try {
    if (b.kind === "essay_mark") {
      const ctx = await requireCtx(ROLES.staff, "exams");
      if (ctx instanceof NextResponse) return ctx;
      const r = await essayMark(ctx, createServiceClient(), b.exam_id, b.attempt_id, b.question_id);
      return "error" in r ? jsonError(r.error, r.error === "not found" ? 404 : 400) : NextResponse.json(r);
    }
    if (b.kind === "appraisal_summary") {
      const ctx = await requireCtx(ROLES.staff, "hr");
      if (ctx instanceof NextResponse) return ctx;
      const r = await appraisalSummary(ctx, createServiceClient(), b.appraisal_id);
      return "error" in r ? jsonError(r.error, r.status ?? 400) : NextResponse.json(r);
    }
    if (b.kind === "fee_reminder") {
      const ctx = await requireCtx(ROLES.finance, "fees");
      if (ctx instanceof NextResponse) return ctx;
      const r = await feeReminder(ctx, createServiceClient(), b.guardian_id);
      return "error" in r ? jsonError(r.error, r.status ?? 400) : NextResponse.json(r);
    }
    if (b.kind === "timetable_help") {
      const ctx = await requireCtx(ROLES.admin, "timetable");
      if (ctx instanceof NextResponse) return ctx;
      return NextResponse.json(await timetableHelp(ctx, b.unplaced, b.days));
    }
    if (b.kind === "job_advert") {
      const ctx = await requireCtx(ROLES.hr, "hr");
      if (ctx instanceof NextResponse) return ctx;
      const { data: st } = await ctx.sb.from("tenant_settings").select("school_name,motto,address").eq("tenant_id", ctx.tenant.id).maybeSingle();
      const out = await generateJson({
        task: "job_advert", schema: Advert, temperature: 0.6, maxTokens: 3000,
        system: `You write job adverts for ${st?.school_name ?? ctx.tenant.name}, a school in Nigeria. Clear, warm, professional British English that
attracts good teachers and staff. "description": 120–200 words on the role, the school and what the person will do, in short paragraphs.
"requirements": a list of 5–8 lines, one per line starting with "- ", covering qualifications (e.g. B.Ed, TRCN registration where relevant), experience
and qualities. Never invent pay, benefits, dates or facts about the school that are not given.`,
        prompt: JSON.stringify({ job_title: b.title, department: b.department, type: b.employment_type, location: b.location, pay: b.salary_range, school_motto: st?.motto ?? null, notes_from_hr: b.notes })
      });
      return NextResponse.json({ description: out.description.slice(0, 8000), requirements: out.requirements.slice(0, 6000) });
    }

    if (b.kind !== "iep_targets") return jsonError("unknown kind");
    const ctx = await requireCtx(ROLES.staff, "sims");
    if (ctx instanceof NextResponse) return ctx;
    const { data: can } = await ctx.sb.rpc("can_manage_sen", { p_student: b.student_id });
    if (!can) return jsonError("only the SEN coordinator or an admin can plan targets", 403);
    const [{ data: p }, { data: s }, { data: existing }] = await Promise.all([
      ctx.sb.from("sen_profiles").select("areas,needs,summary,strengths,strategies,arrangements").eq("tenant_id", ctx.tenant.id).eq("student_id", b.student_id).maybeSingle(),
      ctx.sb.from("students").select("date_of_birth,class_groups(name)").eq("tenant_id", ctx.tenant.id).eq("id", b.student_id).maybeSingle(),
      b.iep_id ? ctx.sb.from("iep_targets").select("area,target,progress").eq("iep_id", b.iep_id) : Promise.resolve({ data: [] })
    ]);
    if (!p) return jsonError("Record the student's SEN profile first.");
    const age = s?.date_of_birth ? Math.floor((Date.now() - Date.parse(s.date_of_birth)) / (365.25 * 86_400_000)) : null;
    const out = await generateJson({
      task: "iep_targets", schema: Targets, temperature: 0.5, maxTokens: 3000,
      system: `You help a school's SEN coordinator in Nigeria write support plan targets. Suggest 3 to 5 SMART targets: specific, measurable,
achievable in one term, relevant to the needs given and built on the child's strengths. Each has a short area (e.g. "Reading"), the target in
plain words a parent understands, practical classroom strategies that need no special equipment, and success criteria (how staff will know).
Do not repeat targets already in the plan. Never diagnose or name conditions that are not in the profile.`,
      prompt: JSON.stringify({ class: (s as any)?.class_groups?.name ?? null, age, profile: p, existing_targets: existing ?? [], coordinator_focus: b.focus ?? null })
    });
    return NextResponse.json({ targets: out.targets.slice(0, 5) });
  } catch (e) {
    const { message, status } = aiErrorMessage(e);
    return jsonError(message, status);
  }
}
