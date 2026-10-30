import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, denyUnless } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl, currentTerm } from "@/lib/school";
import { buildSebConfig } from "@/lib/exams/seb";
import { enrollApplication, notifyApplicant } from "@/lib/admissions";
import { syncLeadFromApplication } from "@/lib/admissions-crm";
import { generateInvoices } from "@/lib/fees";
import { entranceAnalytics, formatPin, weightsValid } from "@/lib/entrance";
import { decideIntake, issuePin, loadCandidates, seatsLeftFor, toCandidate } from "@/lib/entrance-server";

export const dynamic = "force-dynamic";

/**
 * Entrance exams (phase 14e): intakes, sittings, the merit list and analytics.
 * GET: everything for the screen; ?plan=<id> adds that intake's candidates and analytics;
 * ?seb=<sitting> downloads the Safe Exam Browser file for the centre computers;
 * ?attempt=<id> shows a home test's camera photos and flags.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admissions, "admissions");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const tid = ctx.tenant.id;
  const svc = createServiceClient();

  const seb = u.searchParams.get("seb");
  if (seb) {
    const { data: s } = await ctx.sb.from("entrance_sittings").select("id,centre,entrance_plans(name,exams(settings))").eq("tenant_id", tid).eq("id", seb).maybeSingle();
    if (!s) return jsonError("sitting not found", 404);
    const base = appUrl(req);
    const settings = (s as any).entrance_plans?.exams?.settings ?? {};
    const xml = buildSebConfig({ startUrl: `${base}/entrance/pin`, quitUrl: `${base}/entrance/pin?done=1`, title: `${(s as any).entrance_plans?.name ?? "Entrance test"}, ${s.centre ?? ""}`,
      quit_password: settings.seb_quit_password ?? settings.quit_password, allow_spellcheck: false });
    return new NextResponse(xml, { headers: { "Content-Type": "application/seb", "Content-Disposition": `attachment; filename="entrance-${String(s.centre ?? "centre").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.seb"` } });
  }

  const attemptId = u.searchParams.get("attempt");
  if (attemptId) {
    const { data: at } = await ctx.sb.from("entrance_attempts").select("id,violations,face_flags").eq("tenant_id", tid).eq("id", attemptId).maybeSingle();
    if (!at) return jsonError("not found", 404);
    const { data: events } = await ctx.sb.from("entrance_events").select("kind,meta,at").eq("attempt_id", at.id).order("at", { ascending: false }).limit(60);
    const photos = [];
    for (const e of (events ?? []).filter((e: any) => e.kind === "snapshot" && e.meta?.path).slice(0, 12)) {
      const { data } = await svc.storage.from("admissions").createSignedUrl(e.meta.path, 600);
      if (data?.signedUrl) photos.push({ url: data.signedUrl, at: e.at, faces: e.meta.faces ?? null });
    }
    return NextResponse.json({ attempt: at, events: (events ?? []).filter((e: any) => e.kind !== "snapshot"), photos });
  }

  const [{ data: plans, error }, { data: sittings }, { data: exams }, { data: classes }, { data: capacity }] = await Promise.all([
    ctx.sb.from("entrance_plans").select("*,exams(title)").eq("tenant_id", tid).order("created_at", { ascending: false }),
    ctx.sb.from("entrance_sittings").select("*").eq("tenant_id", tid).order("starts_at"),
    ctx.sb.from("exams").select("id,title,status,duration_minutes").eq("tenant_id", tid).neq("status", "closed").order("created_at", { ascending: false }).limit(200),
    ctx.sb.from("class_groups").select("id,name").eq("tenant_id", tid).order("name"),
    ctx.sb.from("admission_capacity").select("level,intake,seats").eq("tenant_id", tid)
  ]);
  if (error) return jsonError(error.message.includes("entrance_plans") ? "Entrance automation needs the database update (migration 20260101006200)." : error.message);
  // Seats taken and progress per sitting (the multi-centre board).
  const ids = (sittings ?? []).map((s: any) => s.id);
  const { data: attempts } = ids.length ? await ctx.sb.from("entrance_attempts").select("sitting_id,status,checked_in_at,absent").in("sitting_id", ids).limit(20000) : { data: [] };
  const board = new Map<string, { booked: number; checked_in: number; started: number; submitted: number; absent: number }>();
  for (const a of attempts ?? []) {
    const b = board.get(a.sitting_id) ?? { booked: 0, checked_in: 0, started: 0, submitted: 0, absent: 0 };
    b.booked++; if (a.checked_in_at) b.checked_in++; if (a.status === "in_progress") b.started++; if (["submitted", "graded"].includes(a.status)) b.submitted++; if (a.absent) b.absent++;
    board.set(a.sitting_id, b);
  }
  const out: Record<string, unknown> = {
    plans: plans ?? [], exams: exams ?? [], classes: classes ?? [], capacity: capacity ?? [],
    results_url: await ctx.sb.from("tenants").select("public_slug").eq("id", tid).maybeSingle().then(({ data: t }: { data: { public_slug: string | null } | null }) => t?.public_slug ? `${appUrl(req)}/apply/results/${t.public_slug}` : null),
    sittings: (sittings ?? []).map((s: any) => ({ ...s, ...(board.get(s.id) ?? { booked: 0, checked_in: 0, started: 0, submitted: 0, absent: 0 }) }))
  };

  const planId = u.searchParams.get("plan");
  const plan = planId ? (plans ?? []).find((p: any) => p.id === planId) : null;
  if (plan) {
    const apps = await loadCandidates(svc, plan.id);
    const seats = await seatsLeftFor(svc, plan);
    const graded = apps.map(a => (a.entrance_attempts ?? [])[0]).filter((t: any) => t?.id && ["graded", "submitted"].includes(t.status)).map((t: any) => t.id);
    const [{ data: marks }, { data: questions }] = await Promise.all([
      graded.length ? svc.from("entrance_attempts").select("marks").in("id", graded.slice(0, 2000)) : { data: [] },
      plan.exam_id ? svc.from("exam_questions").select("id,prompt").eq("exam_id", plan.exam_id).limit(500) : { data: [] }
    ]);
    const candidates = apps.map(a => {
      const c = toCandidate(a), at = (a.entrance_attempts ?? [])[0] ?? null;
      return { id: a.id, application_no: a.application_no, name: `${a.first_name} ${a.last_name}`, status: a.status, previous_school: a.previous_school, source: a.source,
        test: c.test, sections: c.sections, interview: c.interview, report: c.report, score: a.composite_score === null ? null : Number(a.composite_score),
        rank: a.merit_rank, proposed: a.proposed_decision, reason: a.decision_reason, waitlist_position: a.waitlist_position, decided_at: a.decided_at, lead_id: a.lead_id,
        attempt: at ? { id: at.id, status: at.status, absent: at.absent, face_flags: at.face_flags, violations: at.violations, sitting_id: at.sitting_id, checked_in: Boolean(at.checked_in_at) } : null };
    }).sort((x, y) => (x.rank ?? 1e6) - (y.rank ?? 1e6) || Number(y.score ?? -1) - Number(x.score ?? -1) || x.name.localeCompare(y.name));
    out.merit = {
      seats_left: seats, candidates,
      analytics: entranceAnalytics(apps.map(a => ({ status: a.status, source: a.source, previous_school: a.previous_school, test: toCandidate(a).test,
        absent: Boolean((a.entrance_attempts ?? [])[0]?.absent), proposed: a.proposed_decision })),
        (marks ?? []).map((m: any) => m.marks ?? {}), (questions ?? []) as any, Number(plan.pass_mark))
    };
  }
  return NextResponse.json(out);
}

const iso = z.string().datetime({ offset: true });
const pct = z.number().min(0).max(100);
const Plan = z.object({
  id: z.string().uuid().nullish(),
  name: z.string().trim().min(1).max(120), level: z.string().trim().min(1).max(60), intake: z.string().trim().max(60).default(""),
  exam_id: z.string().uuid().nullish(), status: z.enum(["draft", "open", "closed"]).default("open"),
  assign_on: z.enum(["submitted", "fee_paid", "manual"]), where_mode: z.enum(["online", "centre", "choice"]),
  face_check: z.boolean().default(false), seb_at_centre: z.boolean().default(true), seb_at_home: z.boolean().default(false),
  test_weight: z.number().int().min(1).max(100), interview_weight: z.number().int().min(0).max(100), report_weight: z.number().int().min(0).max(100),
  pass_mark: pct, section_pass_marks: z.record(z.string().trim().min(1).max(80), pct).default({}), borderline_band: z.number().min(0).max(50),
  interview_for: z.enum(["none", "borderline", "passed", "everyone"]), decision_mode: z.enum(["auto", "approve"]),
  waitlist_size: z.number().int().min(0).max(10000), release_at: iso.nullish(), show_scores: z.boolean().default(false),
  offer_valid_days: z.number().int().min(1).max(120).nullish(), acceptance_fee: z.number().min(0).max(1e9).nullish(), class_group_id: z.string().uuid().nullish()
});
const Body = z.discriminatedUnion("action", [
  Plan.extend({ action: z.literal("save_plan") }),
  z.object({ action: z.literal("delete_plan"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_sitting"), id: z.string().uuid().nullish(), plan_id: z.string().uuid(), kind: z.enum(["online", "centre"]),
    centre: z.string().trim().max(120).nullish(), address: z.string().trim().max(300).nullish(), starts_at: iso, ends_at: iso, seats: z.number().int().min(1).max(100000).nullish() }),
  z.object({ action: z.literal("delete_sitting"), id: z.string().uuid() }),
  z.object({ action: z.literal("assign_waiting"), plan_id: z.string().uuid(), include_unpaid: z.boolean().default(false) }),
  z.object({ action: z.literal("move"), attempt_id: z.string().uuid(), sitting_id: z.string().uuid() }),
  z.object({ action: z.literal("reset_pin"), attempt_id: z.string().uuid() }),
  z.object({ action: z.literal("report_score"), application_id: z.string().uuid(), score: pct.nullable() }),
  z.object({ action: z.literal("send"), plan_id: z.string().uuid(), ids: z.array(z.string().uuid()).max(5000).nullish() }),
  z.object({ action: z.literal("release"), plan_id: z.string().uuid() }),
  z.object({ action: z.literal("enrol"), plan_id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admissions, "admissions");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const base = appUrl(req);
  const plan = async (id: string) => (await ctx.sb.from("entrance_plans").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle()).data as any;

  try {
    switch (b.action) {
      case "save_plan": {
        const { action: _a, id, seb_at_home, ...rest } = b;
        // Sent only when on, or when an intake that had it is switched off, so intakes save before migration 9000 too.
        const row = seb_at_home || id ? { ...rest, seb_at_home } : rest;
        if (!weightsValid(row)) return jsonError("The test, interview and report weights must add up to 100, and the test must count.");
        if (row.exam_id) {
          const { data: ex } = await ctx.sb.from("exams").select("id").eq("tenant_id", tid).eq("id", row.exam_id).maybeSingle();
          if (!ex) return jsonError("That test is not one of your school's exams.");
        }
        if (row.class_group_id) {
          const { data: cg } = await ctx.sb.from("class_groups").select("id").eq("tenant_id", tid).eq("id", row.class_group_id).maybeSingle();
          if (!cg) return jsonError("That class is not one of your school's classes.");
        }
        const values = { ...row, tenant_id: tid, release_at: row.release_at ?? null, offer_valid_days: row.offer_valid_days ?? null, acceptance_fee: row.acceptance_fee ?? null,
          class_group_id: row.class_group_id ?? null, exam_id: row.exam_id ?? null, updated_at: new Date().toISOString() };
        const q = id ? ctx.sb.from("entrance_plans").update(values).eq("tenant_id", tid).eq("id", id) : ctx.sb.from("entrance_plans").insert({ ...values, created_by: ctx.userId });
        let { data, error } = await q.select("*").single();
        // Before migration 9000 there is no seb_at_home column: an intake that doesn't use it still saves.
        if (error && /seb_at_home/.test(error.message)) {
          if (seb_at_home) return jsonError("Safe Exam Browser at home needs the database update (migration 20260101009000).");
          const { seb_at_home: _s, ...old } = values as typeof values & { seb_at_home?: boolean };
          ({ data, error } = await (id ? ctx.sb.from("entrance_plans").update(old).eq("tenant_id", tid).eq("id", id) : ctx.sb.from("entrance_plans").insert({ ...old, created_by: ctx.userId })).select("*").single());
        }
        if (error) return jsonError(error.message.includes("entrance_plans_intake") ? "There is already an entrance plan for that class and intake." : error.message);
        return NextResponse.json({ ok: true, plan: data });
      }
      case "delete_plan": {
        const { error } = await ctx.sb.from("entrance_plans").delete().eq("tenant_id", tid).eq("id", b.id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "save_sitting": {
        const p = await plan(b.plan_id);
        if (!p) return jsonError("entrance plan not found", 404);
        if (new Date(b.ends_at) <= new Date(b.starts_at)) return jsonError("The sitting must end after it starts.");
        if (b.kind === "centre" && !b.centre) return jsonError("Name the centre (for example, Main hall, Lekki campus).");
        const { action: _a, id, ...row } = b;
        const values = { ...row, tenant_id: tid, centre: row.centre ?? null, address: row.address ?? null, seats: row.seats ?? null };
        const q = id ? ctx.sb.from("entrance_sittings").update(values).eq("tenant_id", tid).eq("id", id) : ctx.sb.from("entrance_sittings").insert(values);
        const { data, error } = await q.select("*").single();
        if (error) return jsonError(error.message);
        // Tests waiting for a seat get one straight away.
        const { data: seated } = await ctx.sb.rpc("entrance_staff_seat_waiting", { p_plan: p.id });
        return NextResponse.json({ ok: true, sitting: data, seated: seated ?? 0 });
      }
      case "delete_sitting": {
        // Candidates booked into it go back to waiting for a seat (and are told the new details when they get one).
        const { error } = await ctx.sb.from("entrance_sittings").delete().eq("tenant_id", tid).eq("id", b.id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "assign_waiting": {
        const p = await plan(b.plan_id);
        if (!p) return jsonError("entrance plan not found", 404);
        if (!p.exam_id) return jsonError("Choose the entrance test for this intake first.");
        let q = ctx.sb.from("applications").select("id,fee_paid,entrance_attempts(id)").eq("tenant_id", tid).ilike("applying_for", p.level).in("status", ["new", "reviewing", "assessment"]).limit(2000);
        if (!b.include_unpaid && p.assign_on === "fee_paid") q = q.eq("fee_paid", true);
        const { data: apps } = await q;
        let assigned = 0;
        for (const a of (apps ?? []).filter((x: any) => !(x.entrance_attempts ?? []).length)) {
          const { data } = await ctx.sb.rpc("entrance_staff_assign", { p_app: a.id });
          if (data) assigned++;
        }
        return NextResponse.json({ ok: true, assigned });
      }
      case "move": {
        const { data, error } = await ctx.sb.rpc("entrance_staff_book", { p_attempt: b.attempt_id, p_sitting: b.sitting_id });
        if (error) return jsonError(error.message);
        return data ? NextResponse.json({ ok: true }) : jsonError("That sitting is full, over, or the test has already started.", 409);
      }
      case "reset_pin": {
        const { data: at } = await ctx.sb.from("entrance_attempts").select("id,status,sitting_id").eq("tenant_id", tid).eq("id", b.attempt_id).maybeSingle();
        if (!at) return jsonError("not found", 404);
        if (at.status !== "assigned") return jsonError("This test has already started.");
        const { data: s } = at.sitting_id ? await ctx.sb.from("entrance_sittings").select("kind,ends_at").eq("id", at.sitting_id).maybeSingle() : { data: null };
        if (s?.kind !== "centre") return jsonError("PINs are only for tests taken at a centre.");
        const pin = await issuePin(svc, at, s.ends_at);
        await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "admissions.entrance_pin_reset", target: at.id });
        return NextResponse.json({ ok: true, pin: formatPin(pin) });
      }
      case "report_score": {
        const { error } = await ctx.sb.from("applications").update({ report_score: b.score, updated_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.application_id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "send": case "release": {
        { const denied = denyUnless(ctx, "admissions.offer"); if (denied) return denied; }
        let p = await plan(b.plan_id);
        if (!p) return jsonError("entrance plan not found", 404);
        if (b.action === "release" && (!p.release_at || new Date(p.release_at) > new Date())) {
          const { data } = await ctx.sb.from("entrance_plans").update({ release_at: new Date().toISOString() }).eq("id", p.id).select("*").single();
          p = data ?? p;
        }
        const sent = await decideIntake(svc, p, base, { send: b.action === "send" ? (b.ids?.length ? b.ids : "all") : null });
        await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: `admissions.entrance_${b.action}`, target: p.id, meta: { decisions: sent } });
        return NextResponse.json({ ok: true, decisions: sent });
      }
      case "enrol": {
        { const denied = denyUnless(ctx, "admissions.offer"); if (denied) return denied; }
        const p = await plan(b.plan_id);
        if (!p) return jsonError("entrance plan not found", 404);
        const { data: apps } = await svc.from("applications").select("*").eq("tenant_id", tid).eq("entrance_plan_id", p.id).eq("status", "accepted").limit(2000);
        const ready = (apps ?? []).filter((a: any) => !Number(a.acceptance_fee) || a.acceptance_paid);
        const created: string[] = [];
        const problems: string[] = [];
        for (const a of ready) {
          try {
            const { data: no } = await svc.rpc("next_doc_no", { p_tenant: tid, p_kind: "adm" });
            const r = await enrollApplication(svc, { tenantId: tid, applicationId: a.id, admissionNo: no, classGroupId: p.class_group_id ?? null });
            const { data: done } = await svc.from("applications").select("*").eq("id", a.id).single();
            await syncLeadFromApplication(svc, done);
            if (!r.already) { created.push(r.student_id); await notifyApplicant(svc, done, base, null, true); }
          } catch (e) { problems.push(`${a.first_name} ${a.last_name}: ${(e as Error).message}`); }
        }
        // First-term invoices for the new students only (when this term's fees are set up).
        let invoices: number | null = null;
        if (created.length) {
          const term = await currentTerm(svc, tid);
          if (term) invoices = await generateInvoices(svc, { tenantId: tid, termId: term.id, classGroupIds: [], createdBy: ctx.userId, studentIds: created }).then(r => r.created).catch(() => null);
        }
        await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "admissions.entrance_enrol", target: p.id, meta: { enrolled: created.length } });
        return NextResponse.json({ ok: true, enrolled: created.length, waiting_for_fee: (apps ?? []).length - ready.length, invoices, problems });
      }
    }
  } catch (e) { return jsonError((e as Error).message); }
}
