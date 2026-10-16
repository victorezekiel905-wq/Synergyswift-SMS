import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { askParentsForExeat } from "@/lib/boarding-server";

export const dynamic = "force-dynamic";

/** A boarder's exeats. */
export async function GET() {
  const ctx = await requireCtx(["student"]);
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const { data: s } = await ctx.sb.from("students").select("id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  if (!s) return NextResponse.json({ boarder: false, exeats: [] });
  const [{ data: alloc }, { data: exeats }] = await Promise.all([
    svc.from("hostel_allocations").select("id").eq("tenant_id", ctx.tenant.id).eq("student_id", s.id).is("ended_at", null).maybeSingle(),
    svc.from("exeat_requests").select("id,kind,reason,leave_at,return_by,status,decision_note").eq("tenant_id", ctx.tenant.id).eq("student_id", s.id).order("created_at", { ascending: false }).limit(10)
  ]);
  return NextResponse.json({ boarder: Boolean(alloc), exeats: exeats ?? [] });
}

const Body = z.object({ kind: z.enum(["weekend", "day", "medical", "holiday", "family", "other"]), reason: z.string().trim().min(3).max(300),
  leave_at: z.string().datetime({ offset: true }), return_by: z.string().datetime({ offset: true }), collector_name: z.string().trim().max(120).nullish() });

/** A boarder asks to leave: their parents agree first, then the house decides. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(["student"]);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  if (new Date(b.return_by) <= new Date(b.leave_at)) return jsonError("the return time must be after leaving");
  if (new Date(b.leave_at).getTime() < Date.now() - 3_600_000) return jsonError("choose a time in the future");
  const svc = createServiceClient(), tid = ctx.tenant.id;
  const { data: s } = await svc.from("students").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
  if (!s) return jsonError("your login is not linked to a student record", 404);
  const { data: alloc } = await svc.from("hostel_allocations").select("id").eq("tenant_id", tid).eq("student_id", s.id).is("ended_at", null).maybeSingle();
  if (!alloc) return jsonError("only boarders ask for exeats");
  const { count } = await svc.from("exeat_requests").select("id", { count: "exact", head: true }).eq("student_id", s.id).in("status", ["awaiting_parent", "pending"]);
  if ((count ?? 0) >= 2) return jsonError("you already have requests waiting");
  const { data, error } = await svc.from("exeat_requests").insert({ tenant_id: tid, student_id: s.id, requested_by: "student", kind: b.kind, reason: b.reason, leave_at: b.leave_at,
    return_by: b.return_by, collector_name: b.collector_name ?? null, status: "awaiting_parent" }).select("id").single();
  if (error) return jsonError(error.message);
  await askParentsForExeat(svc, tid, data.id, ctx.tenant.timezone, appUrl(req), null);
  return NextResponse.json({ id: data.id }, { status: 201 });
}
