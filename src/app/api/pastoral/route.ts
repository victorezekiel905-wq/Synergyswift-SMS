import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl, studentName } from "@/lib/school";
import { localParts, zonedToUtc } from "@/lib/attendance";
import { needsFollowUp, moodSummary, moodTrend, CONCERN_CATEGORIES } from "@/lib/welfare";
import { logAccess, alertNewConcern, counsellors } from "@/lib/welfare-server";
import { tellStaff } from "@/lib/hr-server";

export const dynamic = "force-dynamic";

const STUDENT = "first_name,last_name,other_names,admission_no,class_groups(name)";

/**
 * Pastoral care: safeguarding concerns, counselling, referrals and wellbeing check-ins.
 * Any staff member can report a concern or refer a student; the safeguarding team (counsellors,
 * principal, admins) manages concerns; counsellors keep counselling records; form teachers and
 * counsellors follow up check-ins. Opening a concern or a case is logged.
 * GET ?view=overview|concerns|concern&id=|cases|case&id=|referrals|wellbeing[&class=&days=]
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "behaviour");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const view = u.get("view") ?? "overview";
  const tid = ctx.tenant.id, sb = ctx.sb, svc = createServiceClient();
  const dsl = hasAny(ctx, ["counsellor", ...ROLES.admin]), counsellor = ctx.roles.has("counsellor");
  const today = localParts(new Date(), ctx.tenant.timezone).date;

  if (view === "overview") {
    const [concerns, referrals, checkins, settings] = await Promise.all([
      sb.from("safeguarding_concerns").select("id,status,severity,reported_by").eq("tenant_id", tid).neq("status", "closed"),
      sb.from("pastoral_referrals").select("id,status,referred_by").eq("tenant_id", tid).eq("status", "new"),
      sb.from("wellbeing_checkins").select("mood,feelings,wants_to_talk,student_id,followed_up_at").eq("tenant_id", tid).gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).not("student_id", "is", null),
      svc.from("tenant_settings").select("wellbeing_checkins,wellbeing_anonymous,safeguarding_escalate_hours").eq("tenant_id", tid).maybeSingle()
    ]);
    const open = (concerns.data ?? []).filter((c: any) => dsl);
    return NextResponse.json({ dsl, counsellor, admin: hasAny(ctx, ROLES.admin), settings: settings.data,
      open_concerns: open.length, unacknowledged: open.filter((c: any) => c.status === "new").length,
      new_referrals: counsellor ? (referrals.data ?? []).length : 0,
      checkins_to_follow_up: (checkins.data ?? []).filter((c: any) => needsFollowUp(c) && !c.followed_up_at).length,
      categories: CONCERN_CATEGORIES });
  }

  if (view === "concerns") {
    const { data } = await sb.from("safeguarding_concerns").select(`id,student_id,category,severity,status,created_at,acknowledged_at,escalated_at,assigned_to,reported_by,students(${STUDENT})`)
      .eq("tenant_id", tid).order("created_at", { ascending: false }).limit(300);
    const ids = [...new Set((data ?? []).flatMap((c: any) => [c.assigned_to, c.reported_by]).filter(Boolean))];
    const { data: names } = ids.length ? await svc.from("users").select("id,full_name").in("id", ids) : { data: [] };
    const nm = new Map((names ?? []).map((n: any) => [n.id, n.full_name]));
    const team = dsl ? (await svc.from("users").select("id,full_name,role,extra_roles").eq("tenant_id", tid).eq("active", true)).data?.filter((x: any) =>
      ["counsellor", "principal", "school_admin"].some(r => x.role === r || (x.extra_roles ?? []).includes(r))).map((x: any) => ({ id: x.id, full_name: x.full_name })) ?? [] : [];
    return NextResponse.json({ dsl, me: ctx.userId, team, concerns: (data ?? []).map((c: any) => ({ ...c, student: studentName(c.students), class: c.students?.class_groups?.name ?? null,
      assigned_name: nm.get(c.assigned_to) ?? null, reporter_name: nm.get(c.reported_by) ?? null, mine: c.reported_by === ctx.userId, students: undefined })) });
  }

  if (view === "concern") {
    const { data: c } = await sb.from("safeguarding_concerns").select(`*,students(${STUDENT},date_of_birth)`).eq("tenant_id", tid).eq("id", u.get("id") ?? "").maybeSingle();
    if (!c) return jsonError("not found", 404);
    if (!dsl) return NextResponse.json({ concern: { id: c.id, category: c.category, severity: c.severity, status: c.status, created_at: c.created_at, description: c.description, student: studentName(c.students) }, dsl: false });
    await logAccess(svc, tid, ctx.userId, "safeguarding_concern", c.id, c.student_id);
    const [{ data: chron }, { data: others }, { data: access }] = await Promise.all([
      sb.from("safeguarding_actions").select("id,kind,detail,at,by_user").eq("concern_id", c.id).order("at"),
      sb.from("safeguarding_concerns").select("id,category,severity,status,created_at").eq("tenant_id", tid).eq("student_id", c.student_id).neq("id", c.id).order("created_at", { ascending: false }),
      sb.from("sensitive_access_log").select("user_id,at").eq("record_kind", "safeguarding_concern").eq("record_id", c.id).order("at", { ascending: false }).limit(30)
    ]);
    const ids = [...new Set([c.reported_by, c.assigned_to, ...(chron ?? []).map((x: any) => x.by_user), ...(access ?? []).map((x: any) => x.user_id)].filter(Boolean))];
    const { data: names } = ids.length ? await svc.from("users").select("id,full_name").in("id", ids) : { data: [] };
    const nm = new Map((names ?? []).map((n: any) => [n.id, n.full_name]));
    return NextResponse.json({ dsl: true, concern: { ...c, student: studentName(c.students), class: c.students?.class_groups?.name ?? null, reporter_name: nm.get(c.reported_by) ?? null, assigned_name: nm.get(c.assigned_to) ?? null },
      chronology: (chron ?? []).map((x: any) => ({ ...x, by: nm.get(x.by_user) ?? "System" })), earlier: others ?? [],
      opened_by: (access ?? []).map((x: any) => ({ name: nm.get(x.user_id) ?? "?", at: x.at })) });
  }

  if (view === "cases") {
    const { data } = await sb.from("counselling_cases").select(`id,student_id,counsellor_id,category,risk_level,status,opened_at,closed_at,shared_with_dsl,students(${STUDENT}),counselling_sessions(held_at,next_session_at)`)
      .eq("tenant_id", tid).order("opened_at", { ascending: false }).limit(300);
    return NextResponse.json({ counsellor, me: ctx.userId, cases: (data ?? []).map((c: any) => {
      const s = (c.counselling_sessions ?? []).sort((a: any, b: any) => b.held_at.localeCompare(a.held_at));
      return { ...c, student: studentName(c.students), class: c.students?.class_groups?.name ?? null, sessions: s.length, last_session: s[0]?.held_at ?? null,
        next_session: s.map((x: any) => x.next_session_at).filter((x: any) => x && x >= new Date().toISOString()).sort()[0] ?? null, students: undefined, counselling_sessions: undefined };
    }) });
  }

  if (view === "case") {
    const { data: c } = await sb.from("counselling_cases").select(`*,students(${STUDENT})`).eq("tenant_id", tid).eq("id", u.get("id") ?? "").maybeSingle();
    if (!c) return jsonError("not found", 404);
    await logAccess(svc, tid, ctx.userId, "counselling_case", c.id, c.student_id);
    const { data: sessions } = await sb.from("counselling_sessions").select("*").eq("case_id", c.id).order("held_at", { ascending: false });
    return NextResponse.json({ case: { ...c, student: studentName(c.students), class: c.students?.class_groups?.name ?? null }, sessions: sessions ?? [], counsellor, me: ctx.userId });
  }

  if (view === "referrals") {
    const { data } = await sb.from("pastoral_referrals").select(`id,student_id,reason,urgency,status,created_at,referred_by,case_id,students(${STUDENT})`).eq("tenant_id", tid).order("created_at", { ascending: false }).limit(200);
    const ids = [...new Set((data ?? []).map((r: any) => r.referred_by).filter(Boolean))];
    const { data: names } = ids.length ? await svc.from("users").select("id,full_name").in("id", ids) : { data: [] };
    const nm = new Map((names ?? []).map((n: any) => [n.id, n.full_name]));
    return NextResponse.json({ counsellor, referrals: (data ?? []).map((r: any) => ({ ...r, student: studentName(r.students), class: r.students?.class_groups?.name ?? null,
      referrer: nm.get(r.referred_by) ?? null, mine: r.referred_by === ctx.userId, reason: counsellor || r.referred_by === ctx.userId ? r.reason : null, students: undefined })) });
  }

  if (view === "wellbeing") {
    const days = Math.min(60, Math.max(1, Number(u.get("days") ?? 14)));
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    let q = sb.from("wellbeing_checkins").select(`id,student_id,class_group_id,mood,feelings,note,wants_to_talk,created_at,followed_up_at,follow_up_note,followed_up_by,students(${STUDENT}),class_groups(name)`)
      .eq("tenant_id", tid).gte("created_at", since).order("created_at", { ascending: false }).limit(5000);
    if (u.get("class")) q = q.eq("class_group_id", u.get("class")!);
    const { data } = await q;
    const items = data ?? [];
    const dayList = Array.from({ length: Math.min(days, 30) }, (_, i) => new Date(Date.parse(`${today}T00:00:00Z`) - (Math.min(days, 30) - 1 - i) * 86_400_000).toISOString().slice(0, 10));
    const classes = [...new Map(items.filter((i: any) => i.class_group_id).map((i: any) => [i.class_group_id, i.class_groups?.name ?? "?"])).entries()].map(([id, name]) => ({ id, name }));
    return NextResponse.json({
      summary: moodSummary(items), trend: moodTrend(items, dayList), classes,
      follow_up: items.filter((i: any) => needsFollowUp(i)).map((i: any) => ({ id: i.id, student_id: i.student_id, student: studentName(i.students), class: i.students?.class_groups?.name ?? null,
        mood: i.mood, feelings: i.feelings, note: i.note, wants_to_talk: i.wants_to_talk, reason: needsFollowUp(i), created_at: i.created_at, followed_up_at: i.followed_up_at, follow_up_note: i.follow_up_note }))
    });
  }
  return jsonError("unknown view", 404);
}

const date = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/));
const opt = (n: number) => z.string().trim().max(n).nullish().transform(v => v || null);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("report_concern"), student_id: z.string().uuid(), category: z.enum(Object.keys(CONCERN_CATEGORIES) as [string, ...string[]]),
    severity: z.enum(["low", "medium", "high", "critical"]), description: z.string().trim().min(10).max(8000), observed_at: date.nullish(), location: opt(200), immediate_action: opt(2000), source_ref: opt(200) }),
  z.object({ action: z.literal("concern_update"), id: z.string().uuid(), status: z.enum(["new", "acknowledged", "investigating", "referred", "monitoring", "closed"]).optional(),
    severity: z.enum(["low", "medium", "high", "critical"]).optional(), assigned_to: z.string().uuid().nullable().optional(), external_agency: opt(200).optional(), external_ref: opt(100).optional(),
    parents_informed: z.enum(["yes", "no", "not_appropriate"]).nullable().optional(), outcome: opt(4000).optional() }),
  z.object({ action: z.literal("concern_note"), id: z.string().uuid(), kind: z.enum(["note", "contacted_parent", "meeting", "referred"]), detail: z.string().trim().min(2).max(4000) }),
  z.object({ action: z.literal("refer"), student_id: z.string().uuid(), reason: z.string().trim().min(3).max(2000), urgency: z.enum(["routine", "soon", "urgent"]) }),
  z.object({ action: z.literal("referral_decide"), id: z.string().uuid(), accept: z.boolean() }),
  z.object({ action: z.literal("open_case"), student_id: z.string().uuid(), category: z.enum(["academic", "emotional", "family", "peer", "bereavement", "behaviour", "career", "health", "other"]),
    source: z.enum(["self", "teacher", "parent", "safeguarding", "other"]), summary: opt(4000), risk_level: z.enum(["low", "medium", "high"]), shared_with_dsl: z.boolean().default(false) }),
  z.object({ action: z.literal("update_case"), id: z.string().uuid(), summary: opt(4000), risk_level: z.enum(["low", "medium", "high"]), shared_with_dsl: z.boolean(), counsellor_id: z.string().uuid().nullish(),
    status: z.enum(["open", "closed"]) }),
  z.object({ action: z.literal("add_session"), case_id: z.string().uuid(), held_at: date, duration_min: z.number().int().min(1).max(480).nullish(), mode: z.enum(["in_person", "group", "phone", "online"]),
    notes: opt(10000), actions: opt(4000), next_session_at: date.nullish() }),
  z.object({ action: z.literal("follow_up"), id: z.string().uuid(), note: opt(1000) }),
  z.object({ action: z.literal("settings"), wellbeing_checkins: z.boolean(), wellbeing_anonymous: z.boolean(), safeguarding_escalate_hours: z.number().int().min(1).max(72) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "behaviour");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, sb = ctx.sb, svc = createServiceClient(), base = appUrl(req), tz = ctx.tenant.timezone;
  const fail = (m: string) => jsonError(m.includes("row-level security") ? "you cannot do that" : m);
  // Times from the page's date-and-time inputs are the school's local time.
  const iso = (v: string | null | undefined) => !v ? null : v.length === 16 ? zonedToUtc(v, tz)?.toISOString() ?? null : v;

  switch (b.action) {
    case "report_concern": {
      const { data, error } = await sb.from("safeguarding_concerns").insert({ tenant_id: tid, student_id: b.student_id, category: b.category, severity: b.severity, description: b.description,
        observed_at: iso(b.observed_at) ?? new Date().toISOString(), location: b.location, immediate_action: b.immediate_action, source_ref: b.source_ref }).select("id").single();
      if (error) return fail(error.message);
      await alertNewConcern(svc, tid, { id: data.id, severity: b.severity, category: b.category, reporter: ctx.userId }, base);
      return NextResponse.json({ id: data.id }, { status: 201 });
    }
    case "concern_update": {
      const { action: _a, id, ...patch } = b;
      const { data, error } = await sb.from("safeguarding_concerns").update(patch).eq("tenant_id", tid).eq("id", id).select("id,assigned_to").maybeSingle();
      if (error) return fail(error.message);
      if (!data) return jsonError("not found", 404);
      if (patch.assigned_to && patch.assigned_to !== ctx.userId) await tellStaff(svc, tid, [patch.assigned_to], "safeguarding", "Safeguarding concern assigned to you", "A safeguarding concern has been assigned to you.", `${base}/school/pastoral?concern=${id}`, id);
      return NextResponse.json({ ok: true });
    }
    case "concern_note": {
      const { error } = await sb.from("safeguarding_actions").insert({ tenant_id: tid, concern_id: b.id, kind: b.kind, detail: b.detail });
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "refer": {
      const { data, error } = await sb.from("pastoral_referrals").insert({ tenant_id: tid, student_id: b.student_id, reason: b.reason, urgency: b.urgency, referred_by: ctx.userId }).select("id").single();
      if (error) return fail(error.message);
      await tellStaff(svc, tid, (await counsellors(svc, tid)).filter(id => id !== ctx.userId), "pastoral_referral", `${b.urgency === "urgent" ? "Urgent " : ""}Counselling referral`,
        "A member of staff has referred a student to counselling.", `${base}/school/pastoral?tab=counselling`, data.id);
      return NextResponse.json({ id: data.id }, { status: 201 });
    }
    case "referral_decide": {
      const { data: r } = await sb.from("pastoral_referrals").select("id,student_id,reason,status,referred_by").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
      if (!r) return jsonError("not found", 404);
      if (r.status !== "new") return jsonError("this referral has been dealt with");
      let caseId: string | null = null;
      if (b.accept) {
        const { data: c, error } = await sb.from("counselling_cases").insert({ tenant_id: tid, student_id: r.student_id, counsellor_id: ctx.userId, source: "teacher", summary: `Referral: ${r.reason}`, created_by: ctx.userId }).select("id").single();
        if (error) return fail(error.message);
        caseId = c.id;
      }
      const { error } = await sb.from("pastoral_referrals").update({ status: b.accept ? "accepted" : "declined", case_id: caseId, decided_by: ctx.userId, decided_at: new Date().toISOString() }).eq("id", r.id);
      if (error) return fail(error.message);
      if (r.referred_by) await tellStaff(svc, tid, [r.referred_by], "pastoral_referral", "Your counselling referral", b.accept ? "A counsellor has taken on the student you referred." : "A counsellor has looked at your referral; please speak to them.", `${base}/school/pastoral?tab=counselling`, r.id);
      return NextResponse.json({ case_id: caseId });
    }
    case "open_case": {
      const { action: _a, ...row } = b;
      const { data, error } = await sb.from("counselling_cases").insert({ ...row, tenant_id: tid, counsellor_id: ctx.userId, created_by: ctx.userId }).select("id").single();
      return error ? fail(error.message) : NextResponse.json({ id: data.id }, { status: 201 });
    }
    case "update_case": {
      const { action: _a, id, ...row } = b;
      const patch: Record<string, unknown> = { ...row, closed_at: row.status === "closed" ? new Date().toISOString() : null };
      if (row.counsellor_id === undefined) delete patch.counsellor_id;
      const { error } = await sb.from("counselling_cases").update(patch).eq("tenant_id", tid).eq("id", id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "add_session": {
      const { error } = await sb.from("counselling_sessions").insert({ tenant_id: tid, case_id: b.case_id, held_at: iso(b.held_at), duration_min: b.duration_min ?? null, mode: b.mode,
        notes: b.notes, actions: b.actions, next_session_at: iso(b.next_session_at ?? null) });
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "follow_up": {
      const { data, error } = await sb.from("wellbeing_checkins").update({ followed_up_at: new Date().toISOString(), follow_up_note: b.note }).eq("tenant_id", tid).eq("id", b.id).select("id");
      if (error) return fail(error.message);
      return data?.length ? NextResponse.json({ ok: true }) : jsonError("not found or not yours to follow up", 404);
    }
    case "settings": {
      if (!hasAny(ctx, ROLES.admin)) return jsonError("only admins change these settings", 403);
      const { action: _a, ...row } = b;
      const { error } = await sb.from("tenant_settings").update(row).eq("tenant_id", tid);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
  }
}
