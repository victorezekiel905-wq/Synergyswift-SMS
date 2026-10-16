import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { toCsv } from "@/lib/school";
import { DATASETS, canUse, datasetById, outputRows, nextRun, type Spec } from "@/lib/report-builder";
import { runReport, type Who } from "@/lib/report-builder-server";
import { termsInOrder } from "@/lib/insights-server";

export const dynamic = "force-dynamic";
const LEADERS = [...ROLES.admin, "qa_officer", "it_admin"];
const who = (ctx: any): Who => ({ userId: ctx.userId, roles: ctx.roles, leader: hasAny(ctx, LEADERS) });

/**
 * The report builder. GET: the datasets this person may use, saved reports,
 * staff to send to, terms and classes. GET ?id= runs a saved report
 * (&format=csv downloads it).
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const u = new URL(req.url).searchParams;
  const id = u.get("id");
  if (id) {
    const { data: r } = await ctx.sb.from("saved_reports").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!r) return jsonError("not found", 404);
    const out = await runReport(svc, tid, ctx.tenant.timezone, r.dataset, r.spec ?? {}, who(ctx));
    if ("error" in out) return jsonError(out.error, 403);
    if (u.get("format") === "csv") {
      return new NextResponse(toCsv(outputRows(out)), { headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${r.name.replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-") || "report"}.csv"`
      } });
    }
    return NextResponse.json({ report: r, output: { ...out, rows: out.rows.slice(0, 1000) } });
  }
  const [{ data: saved }, { data: staff }, terms, { data: classes }] = await Promise.all([
    ctx.sb.from("saved_reports").select("id,owner_id,name,description,dataset,spec,shared,schedule,schedule_day,schedule_hour,recipient_ids,next_run_at,last_sent_at,last_error,updated_at,users!saved_reports_owner_id_fkey(full_name)")
      .eq("tenant_id", tid).order("name"),
    svc.from("users").select("id,full_name,role").eq("tenant_id", tid).eq("active", true).not("role", "in", "(parent,student)").order("full_name"),
    termsInOrder(svc, tid),
    svc.from("class_groups").select("id,name").eq("tenant_id", tid).order("name")
  ]);
  return NextResponse.json({
    me: ctx.userId,
    datasets: DATASETS.filter(d => canUse(d, ctx.roles)),
    saved: (saved ?? []).map((r: any) => ({ ...r, owner: r.users?.full_name ?? null, users: undefined, usable: (() => { const d = datasetById(r.dataset); return d ? canUse(d, ctx.roles) : false; })() })),
    staff: staff ?? [],
    terms: terms.map(t => ({ id: t.id, label: `${t.name} ${t.session}`.trim(), is_current: t.is_current })).reverse(),
    classes: classes ?? []
  });
}

const SpecZ = z.object({
  columns: z.array(z.string().max(40)).max(40),
  filters: z.array(z.object({ column: z.string().max(40), op: z.enum(["eq", "neq", "contains", "gt", "gte", "lt", "lte", "empty", "not_empty"]), value: z.union([z.string().max(200), z.number(), z.boolean(), z.null()]).optional() })).max(20).optional(),
  params: z.object({ term_id: z.string().uuid().nullish(), from: z.string().max(10).nullish(), to: z.string().max(10).nullish(), class_group_id: z.string().uuid().nullish() }).optional(),
  group_by: z.string().max(40).nullish(),
  aggregates: z.array(z.object({ column: z.string().max(40), fn: z.enum(["count", "sum", "avg", "min", "max"]) })).max(10).optional(),
  sort: z.object({ column: z.string().max(60), dir: z.enum(["asc", "desc"]) }).nullish(),
  limit: z.number().int().min(1).max(20000).nullish()
});
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("run"), dataset: z.string().max(40), spec: SpecZ }),
  z.object({ action: z.literal("save"), id: z.string().uuid().nullish(), name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).nullish(),
    dataset: z.string().max(40), spec: SpecZ, shared: z.boolean().default(false),
    schedule: z.enum(["none", "daily", "weekly", "monthly"]).default("none"), schedule_day: z.number().int().min(1).max(28).nullish(),
    schedule_hour: z.number().int().min(0).max(23).default(7), recipient_ids: z.array(z.string().uuid()).max(50).default([]) }),
  z.object({ action: z.literal("send_now"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;

  if (b.action === "run") {
    const out = await runReport(createServiceClient(), tid, ctx.tenant.timezone, b.dataset, b.spec as Spec, who(ctx));
    if ("error" in out) return jsonError(out.error);
    return NextResponse.json({ ...out, rows: out.rows.slice(0, 1000) });
  }
  if (b.action === "save") {
    const d = datasetById(b.dataset);
    if (!d || !canUse(d, ctx.roles)) return jsonError("your role cannot report on that dataset", 403);
    const check = await runReport(createServiceClient(), tid, ctx.tenant.timezone, b.dataset, { ...(b.spec as Spec), limit: 1 }, who(ctx));
    if ("error" in check) return jsonError(check.error);
    if (b.schedule !== "none" && !b.recipient_ids.length) return jsonError("Choose who the report is sent to.");
    if (b.schedule === "weekly" && !(b.schedule_day && b.schedule_day <= 7)) return jsonError("Choose the day of the week.");
    if (b.schedule === "monthly" && !b.schedule_day) return jsonError("Choose the day of the month.");
    const next = nextRun({ schedule: b.schedule, schedule_day: b.schedule_day ?? null, schedule_hour: b.schedule_hour }, new Date(), ctx.tenant.timezone);
    const row = { name: b.name, description: b.description ?? null, dataset: b.dataset, spec: b.spec, shared: b.shared, schedule: b.schedule,
      schedule_day: b.schedule === "none" || b.schedule === "daily" ? null : b.schedule_day, schedule_hour: b.schedule_hour,
      recipient_ids: b.schedule === "none" ? [] : b.recipient_ids, next_run_at: next?.toISOString() ?? null };
    const res = b.id
      ? await ctx.sb.from("saved_reports").update(row).eq("tenant_id", tid).eq("id", b.id).select("id").maybeSingle()
      : await ctx.sb.from("saved_reports").insert({ ...row, tenant_id: tid, owner_id: ctx.userId }).select("id").single();
    if (res.error) return jsonError(res.error.message.includes("only be sent to staff") ? "Reports can only be sent to staff of this school." : res.error.message);
    if (!res.data) return jsonError("Only the author (or an admin) can change this report.", 403);
    return NextResponse.json({ ok: true, id: res.data.id, next_run_at: row.next_run_at });
  }
  if (b.action === "send_now") {
    const { data, error } = await ctx.sb.from("saved_reports").update({ next_run_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.id).neq("schedule", "none").select("id").maybeSingle();
    if (error) return jsonError(error.message);
    if (!data) return jsonError("Only a scheduled report you own can be sent now.", 403);
    return NextResponse.json({ ok: true });
  }
  const { data, error } = await ctx.sb.from("saved_reports").delete().eq("tenant_id", tid).eq("id", b.id).select("id");
  if (error) return jsonError(error.message);
  if (!data?.length) return jsonError("Only the author (or an admin) can delete this report.", 403);
  return NextResponse.json({ ok: true });
}
