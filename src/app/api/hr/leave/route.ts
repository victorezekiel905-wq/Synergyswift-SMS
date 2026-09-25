import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";

/** Working days between two dates inclusive (Mon–Fri). */
function workingDays(from: string, to: string): number {
  let n = 0;
  const d = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`);
  while (d <= end) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; d.setUTCDate(d.getUTCDate() + 1); }
  return n;
}

export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const { data, error } = await ctx.sb.from("leave_requests").select("*,staff(id,full_name,staff_no,department,user_id)")
    .eq("tenant_id", ctx.tenant.id).order("created_at", { ascending: false }).limit(500);
  if (error) return jsonError(error.message);
  const { data: me } = await ctx.sb.from("staff").select("id,full_name,leave_allowance").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  return NextResponse.json({ items: data ?? [], me, can_decide: hasAny(ctx, ROLES.hr) });
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Create = z.object({
  staff_id: z.string().uuid().optional(), // HR can file on behalf of someone
  leave_type: z.enum(["annual", "sick", "maternity", "paternity", "compassionate", "study", "unpaid", "other"]),
  starts_on: date, ends_on: date,
  reason: z.string().trim().max(1000).nullish()
});

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Create.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  if (b.ends_on < b.starts_on) return jsonError("end date is before start date");
  let staffId = b.staff_id;
  if (!staffId || !hasAny(ctx, ROLES.hr)) {
    const { data: me } = await ctx.sb.from("staff").select("id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
    if (!me) return jsonError("no staff record is linked to your account; ask HR", 404);
    staffId = me.id;
  }
  const days = workingDays(b.starts_on, b.ends_on);
  if (!days) return jsonError("the selected dates contain no working days");
  const { data, error } = await ctx.sb.from("leave_requests").insert({
    tenant_id: ctx.tenant.id, staff_id: staffId, leave_type: b.leave_type, starts_on: b.starts_on, ends_on: b.ends_on,
    days, reason: b.reason ?? null, status: "pending"
  }).select("id,days").single();
  return error ? jsonError(error.message) : NextResponse.json(data, { status: 201 });
}

const Decide = z.object({ id: z.string().uuid(), status: z.enum(["approved", "rejected", "cancelled"]), note: z.string().trim().max(500).nullish() });

export async function PATCH(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Decide.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("id and status required");
  const b = parsed.data;
  const { data: cur } = await ctx.sb.from("leave_requests").select("status,staff_id").eq("tenant_id", ctx.tenant.id).eq("id", b.id).maybeSingle();
  if (!cur) return jsonError("not found", 404);
  if (cur.status !== "pending" && !(cur.status === "approved" && b.status === "cancelled")) return jsonError(`this request is already ${cur.status}`);
  const fields: Record<string, unknown> = { status: b.status };
  if (b.status !== "cancelled") Object.assign(fields, { decided_by: ctx.userId, decided_at: new Date().toISOString(), decision_note: b.note ?? null });
  const { error } = await ctx.sb.from("leave_requests").update(fields).eq("tenant_id", ctx.tenant.id).eq("id", b.id);
  if (error) return jsonError(error.message.replace(/^.*?: /, ""), 403);
  return NextResponse.json({ ok: true });
}
