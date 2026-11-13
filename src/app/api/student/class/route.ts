import { NextResponse } from "next/server";
import { requireCtx, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * The signed-in student's own class: its name, class teacher, the subjects taught there and who
 * teaches them, and how many classmates. Only their own class (found through their own record).
 */
export async function GET() {
  const ctx = await requireCtx(["student"]);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const { data: me } = await ctx.sb.from("students").select("id,first_name,admission_no,class_group_id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
  if (!me) return jsonError("your login is not linked to a student record", 404);
  if (!me.class_group_id) return NextResponse.json({ class: null, first_name: me.first_name, admission_no: me.admission_no });
  const svc = createServiceClient();
  const [{ data: cls }, { data: offs }, { count }] = await Promise.all([
    svc.from("class_groups").select("id,name,level,users:form_teacher_id(full_name)").eq("tenant_id", tid).eq("id", me.class_group_id).maybeSingle(),
    svc.from("subject_offerings").select("subjects(name),users:teacher_id(full_name)").eq("tenant_id", tid).eq("class_group_id", me.class_group_id),
    svc.from("students").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("class_group_id", me.class_group_id).eq("status", "active")
  ]);
  const subjects = ((offs ?? []) as any[]).map(o => ({ subject: o.subjects?.name ?? "Subject", teacher: o.users?.full_name ?? null }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
  return NextResponse.json({
    first_name: me.first_name, admission_no: me.admission_no,
    class: cls ? { name: cls.name, level: cls.level ?? null, class_teacher: (cls as any).users?.full_name ?? null, size: count ?? null, subjects } : null
  });
}
