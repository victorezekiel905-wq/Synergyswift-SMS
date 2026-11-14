import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, hasAny, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

const needsUpdate = (m: string) => /student_id_prefix|next_admission_no|renumber_students/.test(m);

/** The school's student ID format: its letters and the next ID (GC-0013), for forms and School setup. */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const { data: prefix, error } = await svc.rpc("student_id_prefix", { p_tenant: ctx.tenant.id });
  if (error) return NextResponse.json({ prefix: null, next: null, needs_update: needsUpdate(error.message) });
  // The next number, read without taking it (the real one is given when the student is saved).
  const { data: rows } = await svc.from("students").select("admission_no").eq("tenant_id", ctx.tenant.id).like("admission_no", `${prefix}-%`).limit(100000);
  const max = (rows ?? []).reduce((m: number, r: { admission_no: string }) => {
    const n = Number(r.admission_no.slice(String(prefix).length + 1));
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  const { count } = await svc.from("students").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenant.id);
  return NextResponse.json({ prefix, next: `${prefix}-${String(max + 1).padStart(4, "0")}`, students: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}

const Body = z.object({ action: z.literal("renumber"), confirm: z.literal("RENUMBER") });

/** Gives every student a new ID in the school's format, oldest first; the old ID is kept. Admins only. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  if (!hasAny(ctx, ROLES.admin)) return jsonError("only a school admin can renumber students", 403);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("type RENUMBER to confirm");
  const { data, error } = await createServiceClient().rpc("renumber_students", { p_tenant: ctx.tenant.id });
  if (error) return jsonError(needsUpdate(error.message) ? "Student IDs need the database update (migration 20260101010600)." : error.message, 400);
  await createServiceClient().from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: "students.renumber_requested", meta: { students: data } });
  return NextResponse.json({ ok: true, renumbered: data });
}
