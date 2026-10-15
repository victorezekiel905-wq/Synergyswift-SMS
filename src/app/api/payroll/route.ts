import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { computePay, workingDaysInMonth, leaveDaysInMonth, workedShare, DEFAULT_PAY_SETTINGS, NTA2025_BANDS, type PaySettings, type Band } from "@/lib/payroll";
import { toCsv, appUrl } from "@/lib/school";
import { tellStaff } from "@/lib/hr-server";

export const dynamic = "force-dynamic";

/**
 * GET ?view=profiles            salary profiles for everyone being paid
 * GET ?view=runs                payroll runs
 * GET ?view=run&id=             one run with payslips (&format=csv → bank schedule)
 * GET ?view=remittance&id=&kind=paye|pension|nhf|employer   statutory schedules for a run (CSV)
 * GET ?view=settings            statutory settings and pay grades
 * GET ?view=loans               staff loans and advances
 * GET ?view=mine                the signed-in staff member's released payslips (and loans)
 */
export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const view = u.searchParams.get("view") ?? "runs";
  if (view === "mine") {
    const ctx = await requireCtx(ROLES.staff, "payroll");
    if (ctx instanceof NextResponse) return ctx;
    // Only the person's own, even for payroll staff who can read everyone's.
    const { data: me } = await ctx.sb.from("staff").select("id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
    if (!me) return NextResponse.json({ payslips: [], loans: [] });
    const [{ data }, { data: loans }] = await Promise.all([
      ctx.sb.from("payslips").select("*,staff(full_name,staff_no,position,department)").eq("tenant_id", ctx.tenant.id).eq("staff_id", me.id).order("id", { ascending: false }).limit(36),
      ctx.sb.from("staff_loans").select("id,kind,principal,monthly_deduction,balance,start_period,status,approved_by").eq("tenant_id", ctx.tenant.id).eq("staff_id", me.id).neq("status", "cancelled").order("created_at", { ascending: false })
    ]);
    // Staff cannot read payroll runs, so the month comes from the server; drafts stay hidden (payroll staff included).
    const runIds = [...new Set((data ?? []).map((p: any) => p.run_id))];
    const { data: runs } = runIds.length ? await createServiceClient().from("payroll_runs").select("id,period,status,paid_at").eq("tenant_id", ctx.tenant.id).in("id", runIds) : { data: [] };
    const runBy = new Map((runs ?? []).map((r: any) => [r.id, r]));
    const released = (data ?? []).map((p: any) => ({ ...p, payroll_runs: runBy.get(p.run_id) ?? null })).filter((p: any) => p.payroll_runs && p.payroll_runs.status !== "draft");
    return NextResponse.json({ payslips: released.sort((x: any, y: any) => String(y.payroll_runs?.period).localeCompare(String(x.payroll_runs?.period))), loans: loans ?? [] });
  }
  const ctx = await requireCtx(ROLES.payroll, "payroll");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  if (view === "settings") {
    const [s, { data: grades }] = await Promise.all([paySettings(ctx.sb, tid), ctx.sb.from("pay_grades").select("*").eq("tenant_id", tid).order("name")]);
    return NextResponse.json({ settings: s, default_bands: NTA2025_BANDS, grades: grades ?? [] });
  }
  if (view === "loans") {
    const [{ data }, { data: staff }] = await Promise.all([
      ctx.sb.from("staff_loans").select("*,staff(full_name,staff_no,user_id)").eq("tenant_id", tid).order("created_at", { ascending: false }),
      ctx.sb.from("staff").select("id,full_name,staff_no").eq("tenant_id", tid).neq("status", "exited").order("full_name")
    ]);
    return NextResponse.json({ loans: data ?? [], staff: staff ?? [], me: ctx.userId, can_approve: hasAny(ctx, ROLES.admin) });
  }
  if (view === "profiles") {
    const [{ data: staff }, { data: profiles }, { data: grades }, { data: personal }] = await Promise.all([
      ctx.sb.from("staff").select("id,full_name,staff_no,position,department,status").eq("tenant_id", tid).neq("status", "exited").order("full_name"),
      ctx.sb.from("salary_profiles").select("*").eq("tenant_id", tid),
      ctx.sb.from("pay_grades").select("id,name,basic,allowances").eq("tenant_id", tid).order("name"),
      createServiceClient().from("staff_personal").select("staff_id,tin,rsa_pin,pfa_name,nhf_number").eq("tenant_id", tid)
    ]);
    const byStaff = new Map((profiles ?? []).map((p: any) => [p.staff_id, p]));
    const ids = new Map((personal ?? []).map((p: any) => [p.staff_id, p]));
    return NextResponse.json({ grades: grades ?? [], staff: (staff ?? []).map((s: any) => {
      const p: any = ids.get(s.id);
      return { ...s, profile: byStaff.get(s.id) ?? null, ids: { tin: Boolean(p?.tin), rsa_pin: Boolean(p?.rsa_pin), pfa: p?.pfa_name ?? null, nhf: Boolean(p?.nhf_number) } };
    }) });
  }
  if (view === "run" || view === "remittance") {
    const id = u.searchParams.get("id");
    const { data: run } = await ctx.sb.from("payroll_runs").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!run) return jsonError("not found", 404);
    const { data: slips } = await ctx.sb.from("payslips").select("*,staff(full_name,staff_no,position,department)").eq("run_id", run.id).order("net", { ascending: false });
    if (view === "remittance") {
      const kind = u.searchParams.get("kind") ?? "paye";
      const { data: personal } = await createServiceClient().from("staff_personal").select("staff_id,tin,rsa_pin,pfa_name,nhf_number,state_of_origin").eq("tenant_id", tid);
      const pBy = new Map((personal ?? []).map((p: any) => [p.staff_id, p]));
      const csv = (name: string, rows: (string | number | null)[][]) => new NextResponse("﻿" + toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${run.period}.csv"` } });
      const list = (slips ?? []) as any[];
      if (kind === "pension") {
        const rows = list.filter(s => Number(s.pension_employee) || Number(s.pension_employer)).sort((a, b) => String((pBy.get(a.staff_id) as any)?.pfa_name ?? "").localeCompare(String((pBy.get(b.staff_id) as any)?.pfa_name ?? "")));
        return csv("pension-schedule", [["PFA", "RSA PIN", "Staff no", "Name", "Employee", "Employer", "Total"],
          ...rows.map(s => { const p: any = pBy.get(s.staff_id); return [p?.pfa_name ?? "MISSING", p?.rsa_pin ?? "MISSING", s.staff?.staff_no, s.staff?.full_name, s.pension_employee, s.pension_employer, Math.round((Number(s.pension_employee) + Number(s.pension_employer)) * 100) / 100]; })]);
      }
      if (kind === "nhf") {
        return csv("nhf-schedule", [["NHF number", "Staff no", "Name", "Basic", "NHF"],
          ...list.filter(s => Number(s.nhf) > 0).map(s => { const p: any = pBy.get(s.staff_id); return [p?.nhf_number ?? "MISSING", s.staff?.staff_no, s.staff?.full_name, s.basic, s.nhf]; })]);
      }
      if (kind === "employer") {
        const names = [...new Set(list.flatMap(s => (s.employer_contributions ?? []).map((e: any) => e.name)))] as string[];
        return csv("employer-contributions", [["Staff no", "Name", ...names, "Total"],
          ...list.map(s => [s.staff?.staff_no, s.staff?.full_name, ...names.map(n => (s.employer_contributions ?? []).find((e: any) => e.name === n)?.amount ?? 0), s.employer_total])]);
      }
      return csv("paye-schedule", [["TIN", "Staff no", "Name", "State of origin", "Gross", "Annual taxable income", "PAYE"],
        ...list.map(s => { const p: any = pBy.get(s.staff_id); return [p?.tin ?? "MISSING", s.staff?.staff_no, s.staff?.full_name, p?.state_of_origin ?? "", s.gross, s.taxable_income, s.paye]; }),
        ["", "", "Total", "", round(list.reduce((t, s) => t + Number(s.gross), 0)), "", round(list.reduce((t, s) => t + Number(s.paye), 0))]]);
    }
    if (u.searchParams.get("format") === "csv") {
      const rows = [["Staff no", "Name", "Bank", "Account number", "Account name", "Net pay", "Narration"],
        ...(slips ?? []).map((s: any) => [s.staff?.staff_no, s.staff?.full_name, s.bank_name, s.account_no, s.account_name, s.net, `Salary ${run.period}`])];
      return new NextResponse("﻿" + toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="payroll-${run.period}.csv"` } });
    }
    return NextResponse.json({ run, payslips: slips ?? [], me: ctx.userId, can_approve: hasAny(ctx, ROLES.admin) });
  }
  const { data } = await ctx.sb.from("payroll_runs").select("*").eq("tenant_id", tid).order("period", { ascending: false }).limit(60);
  return NextResponse.json({ runs: data ?? [], me: ctx.userId, can_approve: hasAny(ctx, ROLES.admin) });
}

const round = (n: number) => Math.round(n * 100) / 100;

async function paySettings(sb: any, tenantId: string): Promise<PaySettings & { prorate_joiners: boolean; saved: boolean }> {
  const { data } = await sb.from("hr_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!data) return { ...DEFAULT_PAY_SETTINGS, prorate_joiners: true, saved: false };
  const n = (k: string) => Number(data[k]);
  return { tax_regime: data.tax_regime, tax_bands: data.tax_bands, pension_employee_pct: n("pension_employee_pct"), pension_employer_pct: n("pension_employer_pct"), nhf_pct: n("nhf_pct"),
    nhis_employee_pct: n("nhis_employee_pct"), nhis_employer_pct: n("nhis_employer_pct"), nsitf_pct: n("nsitf_pct"), itf_pct: n("itf_pct"), rent_relief_pct: n("rent_relief_pct"),
    rent_relief_cap: n("rent_relief_cap"), prorate_joiners: data.prorate_joiners, saved: true };
}

const Allow = z.object({ name: z.string().trim().min(1).max(60), amount: z.number().min(0).max(1e9), pensionable: z.boolean().nullish(), taxable: z.boolean().nullish() });
const Line = z.object({ name: z.string().trim().min(1).max(60), amount: z.number().min(0).max(1e9).nullish(), percent: z.number().min(0).max(100).nullish() });
const pct = z.number().min(0).max(100);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_profile"), staff_id: z.string().uuid(), grade_id: z.string().uuid().nullish(), basic: z.number().min(0).max(1e10),
    allowances: z.array(Allow).max(20), deductions: z.array(Line).max(20), tax_percent: pct.default(0), pension_percent: pct.default(0),
    annual_rent: z.number().min(0).max(1e11).default(0), nhf: z.boolean().default(false), nhis: z.boolean().default(false), pension_exempt: z.boolean().default(false),
    bank_name: z.string().trim().max(80).nullish(), account_no: z.string().trim().max(20).nullish(), account_name: z.string().trim().max(120).nullish() }),
  z.object({ action: z.literal("save_settings"), tax_regime: z.enum(["nta2025", "flat"]), tax_bands: z.array(z.object({ upto: z.number().positive().nullable(), rate: pct })).max(12).nullable(),
    pension_employee_pct: pct, pension_employer_pct: pct, nhf_pct: pct, nhis_employee_pct: pct, nhis_employer_pct: pct, nsitf_pct: pct, itf_pct: pct, rent_relief_pct: pct,
    rent_relief_cap: z.number().min(0).max(1e11), prorate_joiners: z.boolean() }),
  z.object({ action: z.literal("save_grade"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(60), basic: z.number().min(0).max(1e10), allowances: z.array(Allow).max(20) }),
  z.object({ action: z.literal("delete_grade"), id: z.string().uuid() }),
  z.object({ action: z.literal("add_loan"), staff_id: z.string().uuid(), kind: z.enum(["loan", "advance"]), principal: z.number().positive().max(1e10), monthly_deduction: z.number().positive().max(1e10),
    start_period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), note: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal("approve_loan"), id: z.string().uuid() }),
  z.object({ action: z.literal("cancel_loan"), id: z.string().uuid() }),
  z.object({ action: z.literal("create_run"), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  z.object({ action: z.literal("recalculate"), run_id: z.string().uuid() }),
  z.object({ action: z.literal("approve"), run_id: z.string().uuid() }),
  z.object({ action: z.literal("mark_paid"), run_id: z.string().uuid() }),
  z.object({ action: z.literal("delete_run"), run_id: z.string().uuid() })
]);

/** Payslips for everyone employed during the month: grade pay, proration, unpaid leave, statutory deductions, loans. */
async function buildPayslips(sb: any, tenantId: string, runId: string, period: string) {
  const [py, pm] = period.split("-").map(Number);
  const monthStart = `${period}-01`, monthEnd = new Date(Date.UTC(py, pm, 0)).toISOString().slice(0, 10);
  const [{ data: staff }, { data: profiles }, { data: leave }, { data: grades }, { data: loans }, settings] = await Promise.all([
    sb.from("staff").select("id,status,hire_date,exit_date").eq("tenant_id", tenantId).or(`status.neq.exited,exit_date.gte.${monthStart}`),
    sb.from("salary_profiles").select("*").eq("tenant_id", tenantId),
    sb.from("leave_requests").select("staff_id,starts_on,ends_on,leave_type,half_day").eq("tenant_id", tenantId).eq("status", "approved")
      .lte("starts_on", monthEnd).gte("ends_on", monthStart),
    sb.from("pay_grades").select("id,basic,allowances").eq("tenant_id", tenantId),
    sb.from("staff_loans").select("id,staff_id,monthly_deduction,balance,start_period").eq("tenant_id", tenantId).eq("status", "active").not("approved_by", "is", null).lte("start_period", period),
    paySettings(sb, tenantId)
  ]);
  const { data: pols } = await sb.from("leave_policies").select("leave_type,paid").eq("tenant_id", tenantId);
  const unpaidTypes = new Set<string>(["unpaid", ...(pols ?? []).filter((p: any) => p.paid === false).map((p: any) => p.leave_type)]);
  const byStaff = new Map((profiles ?? []).map((p: any) => [p.staff_id, p]));
  const gradeBy = new Map((grades ?? []).map((g: any) => [g.id, g]));
  const wd = workingDaysInMonth(period);
  const rows = [];
  for (const s of staff ?? []) {
    if (s.hire_date && s.hire_date > monthEnd) continue;
    const p: any = byStaff.get(s.id);
    if (!p) continue;
    const g: any = p.grade_id ? gradeBy.get(p.grade_id) : null;
    const basic = g ? Number(g.basic) : Number(p.basic);
    if (!(basic > 0)) continue;
    const allowances = [...(g?.allowances ?? []), ...(p.allowances ?? [])];
    const worked = settings.prorate_joiners ? workedShare(period, s.hire_date, s.exit_date) : { share: 1, days: wd };
    if (worked.share <= 0) continue;
    const unpaid = (leave ?? []).filter((l: any) => l.staff_id === s.id && unpaidTypes.has(l.leave_type))
      .reduce((a: number, l: any) => a + (l.half_day ? 0.5 : leaveDaysInMonth(period, l.starts_on, l.ends_on)), 0);
    const c = computePay({ basic, allowances, deductions: p.deductions ?? [], tax_percent: Number(p.tax_percent), pension_percent: Number(p.pension_percent),
      annual_rent: Number(p.annual_rent ?? 0), nhf: p.nhf, nhis: p.nhis, pension_exempt: p.pension_exempt }, settings,
      { unpaidLeaveDays: unpaid, workingDays: wd, share: worked.share, loans: (loans ?? []).filter((l: any) => l.staff_id === s.id) });
    rows.push({ run_id: runId, tenant_id: tenantId, staff_id: s.id, basic: c.basic, allowances: c.allowances, deductions: c.deductions, gross: c.gross,
      total_deductions: c.totalDeductions, net: c.net, unpaid_leave_days: unpaid, bank_name: p.bank_name, account_no: p.account_no, account_name: p.account_name,
      paye: c.paye, taxable_income: c.taxable, pension_employee: c.pensionEmployee, pension_employer: c.pensionEmployer, nhf: c.nhf,
      employer_contributions: c.employer, employer_total: c.employerTotal, loan_repayments: c.loanRepayments, days_worked: worked.share < 1 ? worked.days : null });
  }
  await sb.from("payslips").delete().eq("run_id", runId);
  if (rows.length) {
    const { error } = await sb.from("payslips").insert(rows);
    if (error) throw new Error(error.message);
  }
  const totals = rows.reduce((a, r) => ({ gross: a.gross + r.gross, deductions: a.deductions + r.total_deductions, net: a.net + r.net, employer: a.employer + r.employer_total }), { gross: 0, deductions: 0, net: 0, employer: 0 });
  await sb.from("payroll_runs").update({ gross: round(totals.gross), deductions: round(totals.deductions), net: round(totals.net), employer_total: round(totals.employer) }).eq("id", runId);
  return { payslips: rows.length, gross: round(totals.gross), deductions: round(totals.deductions), net: round(totals.net), employer: round(totals.employer) };
}

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.payroll, "payroll");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  const audit = (action: string, meta: Record<string, unknown>) => sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action, meta });
  const fail = (m: string) => jsonError(m.replace(/^.*?row-level security.*$/, "you cannot change that"));
  try {
    switch (b.action) {
      case "save_profile": {
        const { action: _a, ...row } = b;
        const { error } = await sb.from("salary_profiles").upsert({ ...row, grade_id: row.grade_id || null, tenant_id: tid, updated_at: new Date().toISOString() }, { onConflict: "staff_id" });
        if (error) return fail(error.message);
        await audit("payroll.profile_saved", { staff_id: b.staff_id, basic: b.basic, grade_id: b.grade_id ?? null });
        return NextResponse.json({ ok: true });
      }
      case "save_settings": {
        const { action: _a, ...row } = b;
        if (row.tax_bands) {
          const bands = row.tax_bands as Band[];
          if (bands[bands.length - 1]?.upto !== null) return jsonError("the last band has no upper limit");
          for (let i = 1; i < bands.length - 1; i++) if (Number(bands[i].upto) <= Number(bands[i - 1].upto)) return jsonError("each band must end above the one before");
        }
        const { error } = await sb.from("hr_settings").upsert({ ...row, tenant_id: tid, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
        if (error) return fail(error.message);
        await audit("payroll.settings_saved", row);
        return NextResponse.json({ ok: true });
      }
      case "save_grade": {
        const { action: _a, id, ...row } = b;
        const { error } = id ? await sb.from("pay_grades").update(row).eq("tenant_id", tid).eq("id", id) : await sb.from("pay_grades").insert({ ...row, tenant_id: tid });
        return error ? fail(error.message.includes("duplicate") ? "a grade with that name exists" : error.message) : NextResponse.json({ ok: true });
      }
      case "delete_grade": {
        const { count } = await sb.from("salary_profiles").select("staff_id", { count: "exact", head: true }).eq("grade_id", b.id);
        if (count) return jsonError(`${count} staff are on this grade; move them first`);
        const { error } = await sb.from("pay_grades").delete().eq("tenant_id", tid).eq("id", b.id);
        return error ? fail(error.message) : NextResponse.json({ ok: true });
      }
      case "add_loan": {
        if (b.monthly_deduction > b.principal) return jsonError("the monthly deduction is more than the loan");
        const { data, error } = await sb.from("staff_loans").insert({ tenant_id: tid, staff_id: b.staff_id, kind: b.kind, principal: b.principal, balance: b.principal,
          monthly_deduction: b.monthly_deduction, start_period: b.start_period, note: b.note ?? null }).select("id").single();
        if (error) return fail(error.message);
        await audit("payroll.loan_added", { staff_id: b.staff_id, principal: b.principal });
        return NextResponse.json({ id: data.id }, { status: 201 });
      }
      case "approve_loan": {
        const { error } = await sb.from("staff_loans").update({ approved_by: ctx.userId }).eq("tenant_id", tid).eq("id", b.id).is("approved_by", null);
        if (error) return fail(error.message.replace(/^.*?: /, ""));
        await audit("payroll.loan_approved", { loan_id: b.id });
        return NextResponse.json({ ok: true });
      }
      case "cancel_loan": {
        const { error } = await sb.from("staff_loans").update({ status: "cancelled" }).eq("tenant_id", tid).eq("id", b.id).eq("status", "active");
        return error ? fail(error.message) : NextResponse.json({ ok: true });
      }
      case "create_run": {
        const { data: run, error } = await sb.from("payroll_runs").insert({ tenant_id: tid, period: b.period, created_by: ctx.userId }).select("id").single();
        if (error) return jsonError(error.message.includes("duplicate") ? `a payroll for ${b.period} already exists` : error.message);
        const r = await buildPayslips(sb, tid, run.id, b.period);
        await audit("payroll.run_created", { period: b.period, ...r });
        return NextResponse.json({ id: run.id, ...r }, { status: 201 });
      }
      case "recalculate": {
        const { data: run } = await sb.from("payroll_runs").select("id,period,status").eq("tenant_id", tid).eq("id", b.run_id).maybeSingle();
        if (!run) return jsonError("not found", 404);
        if (run.status !== "draft") return jsonError("only draft payrolls can be recalculated");
        return NextResponse.json(await buildPayslips(sb, tid, run.id, run.period));
      }
      case "approve": case "mark_paid": {
        const next = b.action === "approve" ? { status: "approved", approved_by: ctx.userId, approved_at: new Date().toISOString() } : { status: "paid", paid_at: new Date().toISOString() };
        const { error } = await sb.from("payroll_runs").update(next).eq("tenant_id", tid).eq("id", b.run_id);
        if (error) return jsonError(error.message.replace(/^.*?: /, ""), 403);
        await audit(`payroll.${b.action}`, { run_id: b.run_id });
        if (b.action === "approve") {
          // Staff with a login hear that their payslip is ready (no amounts in the message).
          const svc = createServiceClient();
          const { data: run } = await svc.from("payroll_runs").select("period").eq("id", b.run_id).maybeSingle();
          const { data: slips } = await svc.from("payslips").select("staff(user_id)").eq("run_id", b.run_id);
          const users = (slips ?? []).map((s: any) => s.staff?.user_id).filter(Boolean);
          await tellStaff(svc, tid, users, "payslip_ready", `Payslip for ${run?.period ?? ""}`, `Your payslip for ${run?.period ?? "this month"} is ready.`, `${appUrl(req)}/school/payroll`, b.run_id);
        }
        return NextResponse.json({ ok: true });
      }
      case "delete_run": {
        const { data: run } = await sb.from("payroll_runs").select("status").eq("tenant_id", tid).eq("id", b.run_id).maybeSingle();
        if (run?.status !== "draft") return jsonError("only draft payrolls can be deleted");
        await sb.from("payroll_runs").delete().eq("tenant_id", tid).eq("id", b.run_id);
        return NextResponse.json({ ok: true });
      }
    }
  } catch (e) { return jsonError((e as Error).message); }
}
