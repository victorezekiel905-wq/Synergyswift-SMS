import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { localParts, zonedToUtc } from "@/lib/attendance";
import { canMove, panelSummary, pipeline, STAGES, type Stage } from "@/lib/hr";
import { emailPerson, tellStaff, hireApplicant } from "@/lib/hr-server";

export const dynamic = "force-dynamic";

const when = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/**
 * Recruitment. HR sees postings, applications, interviews and every panel score;
 * panel members see the candidates they interview and their own scores.
 * GET                    postings with pipeline counts (panel members: their interviews)
 * GET ?posting=          one posting's applications
 * GET ?application=      one application with interviews and scores
 * GET ?cv=<application>  the CV
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const tid = ctx.tenant.id, sb = ctx.sb, hr = hasAny(ctx, ROLES.hr);

  const cv = u.get("cv");
  if (cv) {
    const { data: a } = await sb.from("job_applications").select("cv_path").eq("tenant_id", tid).eq("id", cv).maybeSingle();
    if (!a?.cv_path) return jsonError("no CV", 404);
    const { data } = await createServiceClient().storage.from("job-applications").createSignedUrl(a.cv_path, 300);
    return data?.signedUrl ? NextResponse.redirect(data.signedUrl) : jsonError("not found", 404);
  }

  const appId = u.get("application");
  if (appId) {
    const { data: a } = await sb.from("job_applications").select("id,posting_id,full_name,email,phone,cover_letter,cv_path,answers,source,stage,rating,notes,internal_staff_id,hired_staff_id,stage_changed_at,created_at,job_postings(title)")
      .eq("tenant_id", tid).eq("id", appId).maybeSingle();
    if (!a) return jsonError("not found", 404);
    const { data: ivs } = await sb.from("job_interviews").select("id,scheduled_at,duration_min,mode,location,panel,status,interview_scores(panelist_id,score,recommendation,comments,created_at)")
      .eq("application_id", a.id).order("scheduled_at");
    const panelIds = [...new Set((ivs ?? []).flatMap((i: any) => [...i.panel, ...(i.interview_scores ?? []).map((s: any) => s.panelist_id)]))];
    const { data: people } = panelIds.length ? await createServiceClient().from("users").select("id,full_name").eq("tenant_id", tid).in("id", panelIds) : { data: [] };
    const name = new Map((people ?? []).map((p: any) => [p.id, p.full_name]));
    return NextResponse.json({
      application: { ...a, notes: hr ? a.notes : null, rating: hr ? a.rating : null, email: a.email, has_cv: Boolean(a.cv_path), cv_path: undefined },
      interviews: (ivs ?? []).map((i: any) => ({ ...i, panel: i.panel.map((id: string) => ({ id, name: name.get(id) ?? "?" })),
        scores: (i.interview_scores ?? []).map((s: any) => ({ ...s, name: name.get(s.panelist_id) ?? "?" })), summary: panelSummary(i.interview_scores ?? []), interview_scores: undefined })),
      hr, me: ctx.userId
    });
  }

  if (!hr) {
    // Panel members: the interviews they sit on.
    const { data } = await sb.from("job_interviews").select("id,scheduled_at,duration_min,mode,location,status,application_id,job_applications(full_name,job_postings(title))")
      .eq("tenant_id", tid).contains("panel", [ctx.userId]).order("scheduled_at", { ascending: false }).limit(100);
    return NextResponse.json({ hr: false, interviews: data ?? [] });
  }

  const postingId = u.get("posting");
  if (postingId) {
    const [{ data: p }, { data: apps }] = await Promise.all([
      sb.from("job_postings").select("*").eq("tenant_id", tid).eq("id", postingId).maybeSingle(),
      sb.from("job_applications").select("id,full_name,email,phone,stage,rating,source,internal_staff_id,cv_path,created_at,stage_changed_at,job_interviews(id,scheduled_at,status,interview_scores(score,recommendation))")
        .eq("tenant_id", tid).eq("posting_id", postingId).order("created_at", { ascending: false })
    ]);
    if (!p) return jsonError("not found", 404);
    return NextResponse.json({ posting: p, pipeline: pipeline((apps ?? []) as { stage: Stage }[]),
      applications: (apps ?? []).map((a: any) => {
        const ivs = a.job_interviews ?? [];
        const next = ivs.filter((i: any) => i.status === "scheduled").sort((x: any, y: any) => x.scheduled_at.localeCompare(y.scheduled_at))[0];
        return { id: a.id, full_name: a.full_name, email: a.email, phone: a.phone, stage: a.stage, rating: a.rating, source: a.source, internal: Boolean(a.internal_staff_id),
          has_cv: Boolean(a.cv_path), created_at: a.created_at, next_interview: next?.scheduled_at ?? null, summary: panelSummary(ivs.flatMap((i: any) => i.interview_scores ?? [])) };
      }) });
  }

  const [{ data: posts }, { data: apps }, { data: staff }, { data: settings }] = await Promise.all([
    sb.from("job_postings").select("id,title,department,employment_type,status,closes_on,positions,token,internal_only,created_at,published_at").eq("tenant_id", tid).order("created_at", { ascending: false }),
    sb.from("job_applications").select("posting_id,stage").eq("tenant_id", tid),
    createServiceClient().from("users").select("id,full_name").eq("tenant_id", tid).eq("active", true).neq("role", "parent").neq("role", "student").order("full_name"),
    createServiceClient().from("tenants").select("public_slug").eq("id", tid).maybeSingle()
  ]);
  return NextResponse.json({ hr: true, careers_slug: settings?.public_slug ?? null, people: staff ?? [],
    postings: (posts ?? []).map((p: any) => ({ ...p, pipeline: pipeline((apps ?? []).filter((a: any) => a.posting_id === p.id) as { stage: Stage }[]) })) });
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = (n: number) => z.string().trim().max(n).nullish().transform(v => v || null);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_posting"), id: z.string().uuid().optional(), title: z.string().trim().min(2).max(160), department: opt(80),
    employment_type: z.enum(["full_time", "part_time", "contract", "volunteer"]), location: opt(120), description: z.string().trim().max(8000).default(""),
    requirements: opt(6000), salary_range: opt(80), positions: z.number().int().min(1).max(100).default(1), closes_on: date.nullish().or(z.literal("")).transform(v => v || null),
    internal_only: z.boolean().default(false) }),
  z.object({ action: z.literal("posting_status"), id: z.string().uuid(), status: z.enum(["draft", "open", "closed", "filled"]) }),
  z.object({ action: z.literal("delete_posting"), id: z.string().uuid() }),
  z.object({ action: z.literal("add_application"), posting_id: z.string().uuid(), full_name: z.string().trim().min(2).max(120), email: z.string().trim().email(), phone: opt(30), source: opt(40), notes: opt(2000) }),
  z.object({ action: z.literal("move"), id: z.string().uuid(), stage: z.enum(STAGES), notify: z.boolean().default(false), message: opt(2000) }),
  z.object({ action: z.literal("update_application"), id: z.string().uuid(), rating: z.number().int().min(1).max(5).nullable(), notes: opt(4000) }),
  z.object({ action: z.literal("delete_application"), id: z.string().uuid() }),
  z.object({ action: z.literal("schedule_interview"), application_id: z.string().uuid(), at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), duration_min: z.number().int().min(5).max(480).default(30),
    mode: z.enum(["in_person", "phone", "video"]), location: opt(300), panel: z.array(z.string().uuid()).max(10).default([]), notify_candidate: z.boolean().default(true) }),
  z.object({ action: z.literal("interview_status"), id: z.string().uuid(), status: z.enum(["scheduled", "done", "cancelled", "no_show"]), notify_candidate: z.boolean().default(false) }),
  z.object({ action: z.literal("score"), interview_id: z.string().uuid(), score: z.number().int().min(1).max(5), recommendation: z.enum(["hire", "maybe", "no"]), comments: opt(4000) }),
  z.object({ action: z.literal("hire"), application_id: z.string().uuid(), staff_no: z.string().trim().min(1).max(40), position: opt(80), department: opt(80), hire_date: date,
    employment_type: z.enum(["full_time", "part_time", "contract", "volunteer"]).default("full_time"), start_onboarding: z.boolean().default(true) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, sb = ctx.sb, tz = ctx.tenant.timezone, base = appUrl(req);
  if (b.action !== "score" && !hasAny(ctx, ROLES.hr)) return jsonError("only HR can do that", 403);
  const svc = createServiceClient();
  const fail = (m: string) => jsonError(m.includes("row-level security") ? "you cannot change that" : m);
  const school = async () => (await svc.from("tenant_settings").select("school_name").eq("tenant_id", tid).maybeSingle()).data?.school_name ?? ctx.tenant.name;

  switch (b.action) {
    case "save_posting": {
      const { action: _a, id, ...row } = b;
      const { data, error } = id ? await sb.from("job_postings").update(row).eq("tenant_id", tid).eq("id", id).select("id").maybeSingle()
        : await sb.from("job_postings").insert({ ...row, tenant_id: tid, created_by: ctx.userId }).select("id").single();
      if (error) return fail(error.message);
      return data ? NextResponse.json({ id: data.id }) : jsonError("not found", 404);
    }
    case "posting_status": {
      const patch: Record<string, unknown> = { status: b.status };
      if (b.status === "open") {
        const { data: p } = await sb.from("job_postings").select("published_at,description").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
        if (!p) return jsonError("not found", 404);
        if (!p.description?.trim()) return jsonError("add a description before publishing");
        if (!p.published_at) patch.published_at = new Date().toISOString();
      }
      const { error } = await sb.from("job_postings").update(patch).eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "delete_posting": {
      const { count } = await sb.from("job_applications").select("id", { count: "exact", head: true }).eq("posting_id", b.id);
      if (count) return jsonError("this posting has applications; close it instead");
      const { error } = await sb.from("job_postings").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "add_application": {
      const { data: p } = await sb.from("job_postings").select("id").eq("tenant_id", tid).eq("id", b.posting_id).maybeSingle();
      if (!p) return jsonError("posting not found", 404);
      const { data, error } = await svc.from("job_applications").insert({ tenant_id: tid, posting_id: p.id, full_name: b.full_name, email: b.email.toLowerCase(), phone: b.phone,
        source: b.source ?? "added by HR", notes: b.notes }).select("id").single();
      if (error) return fail(error.message.includes("duplicate") ? "this person has already applied for the post" : error.message);
      return NextResponse.json({ id: data.id }, { status: 201 });
    }
    case "move": {
      const { data: a } = await sb.from("job_applications").select("id,stage,full_name,email,track_token,job_postings(title)").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
      if (!a) return jsonError("not found", 404);
      if (b.stage === "hired") return jsonError("use Hire to take someone on");
      if (!canMove(a.stage as Stage, b.stage)) return jsonError(`a candidate cannot go from ${a.stage} to ${b.stage}`);
      const { error } = await sb.from("job_applications").update({ stage: b.stage, stage_changed_at: new Date().toISOString() }).eq("id", a.id);
      if (error) return fail(error.message);
      if (b.notify) {
        const title = a.job_postings?.title ?? "the post", name = await school();
        const text: Partial<Record<Stage, string[]>> = {
          shortlisted: [`Thank you for applying for ${title} at ${name}. We are pleased to tell you that you have been shortlisted. We will be in touch about the next step.`],
          offer: [`We are delighted to offer you the post of ${title} at ${name}. We will send the details and contract shortly.`],
          rejected: [`Thank you for your interest in ${title} at ${name} and for the time you gave to your application. After careful thought we will not be taking it further on this occasion. We wish you every success.`]
        };
        const lines = [...(text[b.stage] ?? [`Your application for ${title} has moved on.`]), ...(b.message ? [b.message] : [])];
        await emailPerson(svc, tid, { email: a.email, name: a.full_name, subject: `Your application: ${title}`, lines, link: `${base}/careers/track/${a.track_token}`, linkLabel: "See your application", kind: "recruitment", refId: a.id });
      }
      return NextResponse.json({ ok: true });
    }
    case "update_application": {
      const { error } = await sb.from("job_applications").update({ rating: b.rating, notes: b.notes }).eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "delete_application": {
      const { data } = await sb.from("job_applications").delete().eq("tenant_id", tid).eq("id", b.id).select("cv_path");
      if (data?.[0]?.cv_path) await svc.storage.from("job-applications").remove([data[0].cv_path]);
      return data?.length ? NextResponse.json({ ok: true }) : jsonError("not found", 404);
    }
    case "schedule_interview": {
      const at = zonedToUtc(b.at, tz);
      if (!at || at.getTime() < Date.now() - 60_000) return jsonError("choose a time in the future");
      const { data: a } = await sb.from("job_applications").select("id,stage,full_name,email,track_token,job_postings(title)").eq("tenant_id", tid).eq("id", b.application_id).maybeSingle();
      if (!a) return jsonError("not found", 404);
      if (["hired", "rejected", "withdrawn"].includes(a.stage)) return jsonError(`this candidate is ${a.stage}`);
      const { data: valid } = b.panel.length ? await svc.from("users").select("id").eq("tenant_id", tid).eq("active", true).in("id", b.panel) : { data: [] };
      const panel = (valid ?? []).map((x: { id: string }) => x.id);
      const { data: iv, error } = await sb.from("job_interviews").insert({ tenant_id: tid, application_id: a.id, scheduled_at: at.toISOString(), duration_min: b.duration_min, mode: b.mode,
        location: b.location, panel, created_by: ctx.userId }).select("id").single();
      if (error) return fail(error.message);
      if (a.stage === "applied" || a.stage === "shortlisted") await sb.from("job_applications").update({ stage: "interview", stage_changed_at: new Date().toISOString() }).eq("id", a.id);
      const title = a.job_postings?.title ?? "the post", whenText = when(at.toISOString(), tz);
      const where = b.mode === "video" ? `by video${b.location ? `: ${b.location}` : " (we will send the link)"}` : b.mode === "phone" ? "by phone; we will call you" : `in person${b.location ? ` at ${b.location}` : ""}`;
      if (b.notify_candidate) await emailPerson(svc, tid, { email: a.email, name: a.full_name, subject: `Interview: ${title}`, kind: "recruitment", refId: iv.id,
        lines: [`We would like to invite you to an interview for ${title} at ${await school()} on ${whenText}, ${where}. It should take about ${b.duration_min} minutes.`,
          "If the time does not suit you, please reply to this email.", "Please bring originals of your certificates and a means of identification."],
        link: `${base}/careers/track/${a.track_token}`, linkLabel: "See your application" });
      await tellStaff(svc, tid, panel.filter((id: string) => id !== ctx.userId), "recruitment_panel", `Interview panel: ${a.full_name}`,
        `You are on the panel interviewing ${a.full_name} for ${title} on ${whenText}. Score them afterwards in HR → Recruitment.`, `${base}/school/hr?tab=recruitment&application=${a.id}`, iv.id);
      return NextResponse.json({ id: iv.id }, { status: 201 });
    }
    case "interview_status": {
      const { data: iv } = await sb.from("job_interviews").select("id,scheduled_at,job_applications(full_name,email,track_token,job_postings(title))").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
      if (!iv) return jsonError("not found", 404);
      const { error } = await sb.from("job_interviews").update({ status: b.status }).eq("id", iv.id);
      if (error) return fail(error.message);
      const a: any = iv.job_applications;
      if (b.status === "cancelled" && b.notify_candidate && a) await emailPerson(svc, tid, { email: a.email, name: a.full_name, subject: `Interview cancelled: ${a.job_postings?.title ?? ""}`, kind: "recruitment", refId: iv.id,
        lines: [`We are sorry, but your interview on ${when(iv.scheduled_at, tz)} has been cancelled. We will be in touch about a new time.`], link: `${base}/careers/track/${a.track_token}`, linkLabel: "See your application" });
      return NextResponse.json({ ok: true });
    }
    case "score": {
      const { error } = await sb.from("interview_scores").upsert({ interview_id: b.interview_id, tenant_id: tid, panelist_id: ctx.userId, score: b.score, recommendation: b.recommendation, comments: b.comments },
        { onConflict: "interview_id,panelist_id" });
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "hire": {
      try {
        const today = localParts(new Date(), tz).date;
        if (b.hire_date < today && !hasAny(ctx, ROLES.admin)) return jsonError("the start date is in the past");
        const r = await hireApplicant(svc, tid, { applicationId: b.application_id, staffNo: b.staff_no, position: b.position, department: b.department, hireDate: b.hire_date,
          employmentType: b.employment_type, actor: ctx.userId, baseUrl: base, startOnboarding: b.start_onboarding });
        await sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "recruitment.hired", target: r.staffId, meta: { application_id: b.application_id } });
        return NextResponse.json(r, { status: 201 });
      } catch (e) { return jsonError((e as Error).message); }
    }
  }
}
