import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { computePayslip, workingDaysInMonth, leaveDaysInMonth } from "@/lib/payroll";
import { toCsv } from "@/lib/school";

/**
 * GET ?view=profiles            salary profiles for every active staff member
 * GET ?view=runs                payroll runs
 * GET ?view=run&id=             one run with payslips (&format=csv → bank schedule)
 * GET ?view=mine                the signed-in staff member's released payslips
 */
export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const view = u.searchParams.get("view") ?? "runs";
  if (view === "mine") {
    const ctx = await requireCtx(ROLES.staff, "payroll");
    if (ctx instanceof NextResponse) return ctx;
    const { data } = await ctx.sb.from("payslips").select("*,payroll_runs(period,status,paid_at),staff(full_name,staff_no,position)")
      .eq("tenant_id", ctx.tenant.id).order("id", { ascending: false }).limit(36);
    return NextResponse.json(data ?? []);
  }
  const ctx = await requireCtx(ROLES.payroll, "payroll");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  if (view === "profiles") {
    const [{ data: staff }, { data: profiles }] = await Promise.all([
      ctx.sb.from("staff").select("id,full_name,staff_no,position,department,status").eq("tenant_id", tid).neq("status", "exited").order("full_name"),
      ctx.sb.from("salary_profiles").select("*").eq("tenant_id", tid)
    ]);
    const byStaff = new Map((profiles ?? []).map((p: any) => [p.staff_id, p]));
    return NextResponse.json((staff ?? []).map((s: any) => ({ ...s, profile: byStaff.get(s.id) ?? null })));
  }
  if (view === "run") {
    const id = u.searchParams.get("id");
    const { data: run } = await ctx.sb.from("payroll_runs").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!run) return jsonError("not found", 404);
    const { data: slips } = await ctx.sb.from("payslips").select("*,staff(full_name,staff_no,position,department)").eq("run_id", run.id).order("net", { ascending: false });
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

const Line = z.object({ name: z.string().trim().min(1).max(60), amount: z.number().min(0).max(1e9).nullish(), percent: z.number().min(0).max(100).nullish() });
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_profile"), staff_id: z.string().uuid(), basic: z.number().min(0).max(1e10),
    allowances: z.array(z.object({ name: z.string().trim().min(1).max(60), amount: z.number().min(0).max(1e9) })).max(20),
    deductions: z.array(Line).max(20), tax_percent: z.number().min(0).max(100), pension_percent: z.number().min(0).max(100),
    bank_name: z.string().trim().max(80).nullish(), account_no: z.string().trim().max(20).nullish(), account_name: z.string().trim().max(120).nullish() }),
  z.object({ action: z.literal("create_run"), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  z.object({ action: z.literal("recalculate"), run_id: z.string().uuid() }),
  z.object({ action: z.literal("approve"), run_id: z.string().uuid() }),
  z.object({ action: z.literal("mark_paid"), run_id: z.string().uuid() }),
  z.object({ action: z.literal("delete_run"), run_id: z.string().uuid() })
]);

async function buildPayslips(sb: any, tenantId: string, runId: string, period: string) {
  const [py, pm] = period.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(py, pm, 0)).toISOString().slice(0, 10);
  const [{ data: staff }, { data: profiles }, { data: leave }] = await Promise.all([
    sb.from("staff").select("id,status").eq("tenant_id", tenantId).neq("status", "exited"),
    sb.from("salary_profiles").select("*").eq("tenant_id", tenantId),
    sb.from("leave_requests").select("staff_id,starts_on,ends_on").eq("tenant_id", tenantId).eq("status", "approved").eq("leave_type", "unpaid")
      .lte("starts_on", monthEnd).gte("ends_on", `${period}-01`)
  ]);
  const byStaff = new Map((profiles ?? []).map((p: any) => [p.staff_id, p]));
  const wd = workingDaysInMonth(period);
  const rows = [];
  for (const s of staff ?? []) {
    const p: any = byStaff.get(s.id);
    if (!p || !(Number(p.basic) > 0)) continue;
    const unpaid = (leave ?? []).filter((l: any) => l.staff_id === s.id).reduce((a: number, l: any) => a + leaveDaysInMonth(period, l.starts_on, l.ends_on), 0);
    const c = computePayslip({ basic: Number(p.basic), allowances: p.allowances, deductions: p.deductions, tax_percent: Number(p.tax_percent), pension_percent: Number(p.pension_percent) },
      { unpaidLeaveDays: unpaid, workingDays: wd });
    rows.push({ run_id: runId, tenant_id: tenantId, staff_id: s.id, basic: c.basic, allowances: c.allowances, deductions: c.deductions, gross: c.gross,
      total_deductions: c.totalDeductions, net: c.net, unpaid_leave_days: unpaid, bank_name: p.bank_name, account_no: p.account_no, account_name: p.account_name });
  }
  await sb.from("payslips").delete().eq("run_id", runId);
  if (rows.length) {
    const { error } = await sb.from("payslips").insert(rows);
    if (error) throw new Error(error.message);
  }
  const totals = rows.reduce((a, r) => ({ gross: a.gross + r.gross, deductions: a.deductions + r.total_deductions, net: a.net + r.net }), { gross: 0, deductions: 0, net: 0 });
  await sb.from("payroll_runs").update({ gross: Math.round(totals.gross * 100) / 100, deductions: Math.round(totals.deductions * 100) / 100, net: Math.round(totals.net * 100) / 100 }).eq("id", runId);
  return { payslips: rows.length, ...totals };
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
  try {
    switch (b.action) {
      case "save_profile": {
        const { action: _a, ...row } = b;
        const { error } = await sb.from("salary_profiles").upsert({ ...row, tenant_id: tid, updated_at: new Date().toISOString() }, { onConflict: "staff_id" });
        if (error) return jsonError(error.message);
        await audit("payroll.profile_saved", { staff_id: b.staff_id, basic: b.basic });
        return NextResponse.json({ ok: true });
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
