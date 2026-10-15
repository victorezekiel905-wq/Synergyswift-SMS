import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { localParts } from "@/lib/attendance";
import { leaveDays, checkLeave, policyFor, LEAVE_TYPES } from "@/lib/hr";
import { balancesFor, leavePolicies, workingCalendar, syncAbsence, leaveDeciders, tellStaff } from "@/lib/hr-server";

export const dynamic = "force-dynamic";

/**
 * Leave. Everyone sees their own requests and balances; line managers see and recommend their team's;
 * HR decides. GET ?month=YYYY-MM adds who is away that month.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id, svc = createServiceClient();
  const today = localParts(new Date(), ctx.tenant.timezone).date;
  const month = /^\d{4}-\d{2}$/.test(new URL(req.url).searchParams.get("month") ?? "") ? new URL(req.url).searchParams.get("month")! : today.slice(0, 7);
  const [{ data, error }, { data: me }, policies] = await Promise.all([
    ctx.sb.from("leave_requests").select("*,staff(id,full_name,staff_no,department,user_id,line_manager_id)").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(500),
    ctx.sb.from("staff").select("id,full_name,leave_allowance,line_manager_id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle(),
    leavePolicies(svc, tid)
  ]);
  if (error) return jsonError(error.message);
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const { data: away } = await svc.from("leave_requests").select("starts_on,ends_on,leave_type,half_day,staff(full_name,department)").eq("tenant_id", tid).eq("status", "approved")
    .lte("starts_on", monthEnd).gte("ends_on", `${month}-01`).order("starts_on");
  return NextResponse.json({
    items: (data ?? []).map((l: any) => ({ ...l, mine: l.staff_id === me?.id, i_manage: Boolean(me) && l.staff?.line_manager_id === me?.id })),
    me: me ? { ...me, balances: await balancesFor(svc, tid, me.id, today, policies) } : null,
    can_decide: hasAny(ctx, ROLES.hr), today, month,
    policies: LEAVE_TYPES.map(t => policyFor(t, policies, me?.leave_allowance ?? 20)),
    away: (away ?? []).map((a: any) => ({ name: a.staff?.full_name, department: a.staff?.department, starts_on: a.starts_on, ends_on: a.ends_on, leave_type: a.leave_type, half_day: a.half_day }))
  });
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Create = z.object({
  staff_id: z.string().uuid().optional(), // HR can file on behalf of someone
  leave_type: z.enum(LEAVE_TYPES),
  starts_on: date, ends_on: date, half_day: z.boolean().default(false),
  reason: z.string().trim().max(1000).nullish(), cover_note: z.string().trim().max(500).nullish(),
  document_id: z.string().uuid().nullish(),
  override: z.boolean().default(false)    // HR only: file even if notice or balance rules are not met
});

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Create.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, svc = createServiceClient(), hr = hasAny(ctx, ROLES.hr);
  const today = localParts(new Date(), ctx.tenant.timezone).date;
  if (b.ends_on < b.starts_on) return jsonError("end date is before start date");
  if (b.half_day && b.starts_on !== b.ends_on) return jsonError("a half day starts and ends on the same day");
  let staffId = b.staff_id;
  if (!staffId || !hr) {
    const { data: me } = await ctx.sb.from("staff").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
    if (!me) return jsonError("no staff record is linked to your account; ask HR", 404);
    staffId = me.id;
  }
  const { data: s } = await svc.from("staff").select("id,full_name,leave_allowance,line_manager_id,user_id").eq("tenant_id", tid).eq("id", staffId).maybeSingle();
  if (!s) return jsonError("staff not found", 404);
  if (b.document_id) {
    const { data: d } = await svc.from("staff_documents").select("id").eq("tenant_id", tid).eq("staff_id", s.id).eq("id", b.document_id).maybeSingle();
    if (!d) return jsonError("attach a document from this person's record");
  }
  const cal = await workingCalendar(svc, tid, b.starts_on, b.ends_on, ctx.tenant.timezone);
  const days = leaveDays(b.starts_on, b.ends_on, { holidays: cal.holidays, weekdays: cal.weekdays, halfDay: b.half_day });
  if (!days) return jsonError("the selected dates contain no working days");
  const { data: clash } = await svc.from("leave_requests").select("id").eq("tenant_id", tid).eq("staff_id", s.id).in("status", ["pending", "approved"])
    .lte("starts_on", b.ends_on).gte("ends_on", b.starts_on).limit(1);
  if (clash?.length) return jsonError("there is already a request for some of these days");
  const policies = await leavePolicies(svc, tid);
  const policy = policyFor(b.leave_type, policies, Number(s.leave_allowance ?? 20));
  const balance = (await balancesFor(svc, tid, s.id, b.starts_on, policies)).find(x => x.leave_type === b.leave_type);
  const problems = checkLeave({ type: b.leave_type, from: b.starts_on, to: b.ends_on, days, today, policy, remaining: balance?.remaining ?? null, hasDocument: Boolean(b.document_id) });
  if (problems.length && !(hr && b.override)) return jsonError(problems.join("; "));

  let managerUser: string | null = null;
  if (s.line_manager_id) managerUser = (await svc.from("staff").select("user_id").eq("id", s.line_manager_id).maybeSingle()).data?.user_id ?? null;
  const { data, error } = await ctx.sb.from("leave_requests").insert({
    tenant_id: tid, staff_id: s.id, leave_type: b.leave_type, starts_on: b.starts_on, ends_on: b.ends_on, days, half_day: b.half_day,
    reason: b.reason ?? null, cover_note: b.cover_note ?? null, document_id: b.document_id ?? null, status: "pending",
    manager_status: managerUser && managerUser !== ctx.userId ? "pending" : null
  }).select("id,days").single();
  if (error) return jsonError(error.message);
  const base = appUrl(req);
  const what = `${s.full_name}: ${b.leave_type} leave, ${days} day${days === 1 ? "" : "s"} from ${b.starts_on}`;
  if (managerUser && managerUser !== ctx.userId) await tellStaff(svc, tid, [managerUser], "leave_request", "Leave to recommend", `${what}. Please recommend it or not.`, `${base}/school/hr?tab=leave`, data.id);
  else await tellStaff(svc, tid, (await leaveDeciders(svc, tid)).filter(id => id !== ctx.userId), "leave_request", "Leave request", what, `${base}/school/hr?tab=leave`, data.id);
  return NextResponse.json({ ...data, warnings: problems }, { status: 201 });
}

const Decide = z.discriminatedUnion("action", [
  z.object({ action: z.literal("decide"), id: z.string().uuid(), status: z.enum(["approved", "rejected", "cancelled"]), note: z.string().trim().max(500).nullish() }),
  z.object({ action: z.literal("recommend"), id: z.string().uuid(), recommend: z.boolean(), note: z.string().trim().max(500).nullish() })
]);

export async function PATCH(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const raw = await readJson<Record<string, unknown>>(req);
  const parsed = Decide.safeParse({ action: "decide", ...raw });
  if (!parsed.success) return jsonError("id and status required");
  const b = parsed.data;
  const tid = ctx.tenant.id, svc = createServiceClient(), base = appUrl(req);
  const { data: cur } = await ctx.sb.from("leave_requests").select("id,status,staff_id,leave_type,starts_on,days,staff(full_name,user_id)").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
  if (!cur) return jsonError("not found", 404);
  const who: any = cur.staff;
  const msg = (m: string) => m.replace(/^.*?: /, "");

  if (b.action === "recommend") {
    const { error } = await ctx.sb.from("leave_requests").update({ manager_status: b.recommend ? "recommended" : "not_recommended", manager_note: b.note ?? null }).eq("tenant_id", tid).eq("id", b.id);
    if (error) return jsonError(msg(error.message), 403);
    await tellStaff(svc, tid, (await leaveDeciders(svc, tid)).filter(id => id !== ctx.userId), "leave_request", "Leave request",
      `${who?.full_name}: ${cur.leave_type} leave from ${cur.starts_on} (${cur.days} days), ${b.recommend ? "recommended" : "not recommended"} by the line manager.`, `${base}/school/hr?tab=leave`, b.id);
    return NextResponse.json({ ok: true });
  }

  if (cur.status !== "pending" && !(cur.status === "approved" && b.status === "cancelled")) return jsonError(`this request is already ${cur.status}`);
  const fields: Record<string, unknown> = { status: b.status };
  if (b.status !== "cancelled") fields.decision_note = b.note ?? null;
  const { error } = await ctx.sb.from("leave_requests").update(fields).eq("tenant_id", tid).eq("id", b.id);
  if (error) return jsonError(msg(error.message), 403);
  await syncAbsence(svc, tid, b.id, ctx.userId);
  if (b.status !== "cancelled" && who?.user_id && who.user_id !== ctx.userId) {
    await tellStaff(svc, tid, [who.user_id], "leave_decided", `Leave ${b.status}`, `Your ${cur.leave_type} leave from ${cur.starts_on} has been ${b.status}.${b.note ? ` ${b.note}` : ""}`, `${base}/school/hr?tab=leave`, b.id);
  } else if (b.status === "cancelled" && cur.status === "approved") {
    await tellStaff(svc, tid, (await leaveDeciders(svc, tid)).filter(id => id !== ctx.userId), "leave_cancelled", "Leave cancelled", `${who?.full_name} cancelled approved ${cur.leave_type} leave from ${cur.starts_on}.`, `${base}/school/hr?tab=leave`, b.id);
  }
  return NextResponse.json({ ok: true });
}
