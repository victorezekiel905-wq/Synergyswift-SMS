import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";

/** My requisitions, or all of them for approvers. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "requisitions");
  if (ctx instanceof NextResponse) return ctx;
  const status = new URL(req.url).searchParams.get("status");
  let q = ctx.sb.from("requisitions")
    .select("*,requisition_items(id,description,quantity,unit_cost),requester:users!requisitions_requested_by_fkey(full_name),decider:users!requisitions_decided_by_fkey(full_name)")
    .eq("tenant_id", ctx.tenant.id).order("created_at", { ascending: false }).limit(300);
  if (status) q = q.eq("status", status);
  if (!hasAny(ctx, ROLES.approver)) q = q.eq("requested_by", ctx.userId);
  const { data, error } = await q;
  if (error) return jsonError(error.message);
  return NextResponse.json({ items: data ?? [], can_approve: hasAny(ctx, ROLES.approver), me: ctx.userId });
}

const Create = z.object({
  title: z.string().trim().min(3).max(160),
  department: z.string().trim().max(80).nullish(),
  justification: z.string().trim().max(2000).nullish(),
  needed_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  items: z.array(z.object({
    description: z.string().trim().min(1).max(200),
    quantity: z.number().positive().max(1e6),
    unit_cost: z.number().min(0).max(1e10)
  })).min(1).max(100)
});

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "requisitions");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Create.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { items, ...r } = parsed.data;
  const total = Math.round(items.reduce((s, i) => s + i.quantity * i.unit_cost, 0) * 100) / 100;
  const { data, error } = await ctx.sb.from("requisitions").insert({
    ...r, needed_by: r.needed_by || null, tenant_id: ctx.tenant.id, requested_by: ctx.userId, total_amount: total, status: "submitted"
  }).select("id").single();
  if (error) return jsonError(error.message);
  const { error: iErr } = await ctx.sb.from("requisition_items").insert(items.map(i => ({ ...i, requisition_id: data.id })));
  if (iErr) return jsonError(iErr.message);
  return NextResponse.json(data, { status: 201 });
}

const Decide = z.object({
  id: z.string().uuid(),
  status: z.enum(["approved", "rejected", "fulfilled", "cancelled"]),
  note: z.string().trim().max(1000).nullish()
});

/** Approve / reject / fulfil (approvers) or cancel (requester). DB trigger blocks self-approval. */
export async function PATCH(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "requisitions");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Decide.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("id and status required");
  const b = parsed.data;
  const { data: cur } = await ctx.sb.from("requisitions").select("status,requested_by").eq("tenant_id", ctx.tenant.id).eq("id", b.id).maybeSingle();
  if (!cur) return jsonError("not found", 404);
  const allowed: Record<string, string[]> = { submitted: ["approved", "rejected", "cancelled"], approved: ["fulfilled", "cancelled"] };
  if (!(allowed[cur.status] ?? []).includes(b.status)) return jsonError(`cannot move a ${cur.status} requisition to ${b.status}`);
  const fields: Record<string, unknown> = { status: b.status };
  if (b.status !== "cancelled") Object.assign(fields, { decided_by: ctx.userId, decided_at: new Date().toISOString(), decision_note: b.note ?? null });
  const { error } = await ctx.sb.from("requisitions").update(fields).eq("tenant_id", ctx.tenant.id).eq("id", b.id);
  if (error) return jsonError(error.message.replace(/^.*?: /, ""), 403);
  await ctx.sb.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: `requisition.${b.status}`, target: b.id });
  return NextResponse.json({ ok: true });
}
