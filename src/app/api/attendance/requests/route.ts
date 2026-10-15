import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { decideAbsence } from "@/lib/attendance-server";

export const dynamic = "force-dynamic";

/** Parents' absence requests for staff: waiting ones first. ?all=1 adds the last 60 days. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "attendance");
  if (ctx instanceof NextResponse) return ctx;
  const all = new URL(req.url).searchParams.get("all") === "1";
  let q = ctx.sb.from("student_absence_requests")
    .select("id,student_id,kind,starts_on,ends_on,reason,status,decision_note,decided_at,created_at,students(first_name,last_name,class_group_id,class_groups(name)),guardians(full_name,phone),decider:decided_by(full_name)")
    .eq("tenant_id", ctx.tenant.id).order("created_at", { ascending: false }).limit(300);
  q = all ? q.gte("created_at", new Date(Date.now() - 60 * 86400_000).toISOString()) : q.eq("status", "pending");
  const { data, error } = await q;
  if (error) return jsonError(error.message);
  const ids = [...new Set((data ?? []).map((r: any) => r.student_id))];
  const can = new Map<string, boolean>();
  for (const id of ids.slice(0, 100)) { const { data: ok } = await ctx.sb.rpc("can_decide_absence", { p_student: id }); can.set(id as string, Boolean(ok)); }
  return NextResponse.json({ items: (data ?? []).map((r: any) => ({ ...r, can_decide: can.get(r.student_id) ?? false })) });
}

const Body = z.object({ id: z.string().uuid(), approve: z.boolean(), note: z.string().trim().max(500).nullish() });

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "attendance");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("invalid decision");
  try {
    const r = await decideAbsence(ctx.sb, createServiceClient(), { tenantId: ctx.tenant.id, id: parsed.data.id, approve: parsed.data.approve, note: parsed.data.note ?? null,
      userId: ctx.userId, timezone: ctx.tenant.timezone });
    return NextResponse.json(r);
  } catch (e) {
    return jsonError((e as Error).message, 403);
  }
}
