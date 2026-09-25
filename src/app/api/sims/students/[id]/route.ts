import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { StudentInput, cleanStudent } from "@/lib/validators";
import { createServiceClient } from "@/lib/supabase/service";
import { provisionUser } from "@/lib/provision";
import { appUrl, studentName } from "@/lib/school";

/** Full student profile: bio, guardians, recent gate events, report cards, library loans. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireCtx(ROLES.staff, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const { data: student } = await ctx.sb.from("students")
    .select("*,class_groups(id,name,level)").eq("tenant_id", tid).eq("id", params.id).maybeSingle();
  if (!student) return jsonError("not found", 404);
  const [guardians, gate, reports, loans] = await Promise.all([
    ctx.sb.from("student_guardians")
      .select("relation,is_primary,can_pickup,guardians(id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,user_id)")
      .eq("tenant_id", tid).eq("student_id", params.id),
    ctx.sb.from("gate_events").select("id,direction,method,late,at,note").eq("tenant_id", tid).eq("student_id", params.id)
      .order("at", { ascending: false }).limit(30),
    ctx.sb.from("report_cards").select("id,term_id,average,position,class_size,status,published_at,access_token,terms(name,academic_sessions(name))")
      .eq("tenant_id", tid).eq("student_id", params.id).order("computed_at", { ascending: false }),
    ctx.sb.from("library_loans").select("id,issued_at,due_at,returned_at,fine_amount,library_books(title)")
      .eq("tenant_id", tid).eq("student_id", params.id).order("issued_at", { ascending: false }).limit(20)
  ]);
  return NextResponse.json({
    student, guardians: guardians.data ?? [], gate_events: gate.data ?? [],
    report_cards: reports.data ?? [], loans: loans.data ?? []
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireCtx(ROLES.sims, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = StudentInput.partial().safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { data, error } = await ctx.sb.from("students").update(cleanStudent(parsed.data))
    .eq("tenant_id", ctx.tenant.id).eq("id", params.id).select("id").maybeSingle();
  if (error) return jsonError(error.message.includes("duplicate") ? "admission number already exists" : error.message);
  if (!data) return jsonError("not found", 404);
  return NextResponse.json(data);
}

/** POST { action: "create_login", email } → gives the student a portal/exam login. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireCtx(ROLES.sims, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const body = await readJson<{ action?: string; email?: string }>(req);
  if (body.action !== "create_login") return jsonError("unknown action");
  const { data: s } = await ctx.sb.from("students").select("id,first_name,last_name,other_names,user_id")
    .eq("tenant_id", ctx.tenant.id).eq("id", params.id).maybeSingle();
  if (!s) return jsonError("not found", 404);
  if (s.user_id) return jsonError("this student already has a login");
  try {
    const svc = createServiceClient();
    const { userId } = await provisionUser(svc, {
      tenantId: ctx.tenant.id, email: String(body.email ?? ""), fullName: studentName(s), role: "student",
      redirectTo: `${appUrl(req)}/auth/welcome?next=/student`, createdBy: ctx.userId
    });
    await svc.from("students").update({ user_id: userId }).eq("tenant_id", ctx.tenant.id).eq("id", s.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError((e as Error).message);
  }
}
