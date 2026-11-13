import { NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { accessAreas, classesFrom, roleLabel } from "@/lib/my-access";

export const dynamic = "force-dynamic";

/**
 * The signed-in member of staff's own access, for their dashboard: their roles, what those roles
 * open, the classes they are in (form teacher, subjects, class team with its privileges) and the
 * subjects they teach. Only their own rows are read.
 */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const tid = ctx.tenant.id, uid = ctx.userId;
  const [{ data: forms }, { data: offs }, { data: team }, { data: staff }] = await Promise.all([
    svc.from("class_groups").select("id,name").eq("tenant_id", tid).eq("form_teacher_id", uid),
    svc.from("subject_offerings").select("class_group_id,subjects(name),class_groups(name)").eq("tenant_id", tid).eq("teacher_id", uid),
    svc.from("class_staff").select("*,subjects(name),class_groups(name)").eq("tenant_id", tid).eq("user_id", uid),
    svc.from("staff").select("id,staff_no,position").eq("tenant_id", tid).eq("user_id", uid).maybeSingle()
  ]);
  // The subjects they were added with (migration 9800); none before that update.
  const { data: subj } = staff?.id
    ? await svc.from("staff_subjects").select("subjects(name)").eq("tenant_id", tid).eq("staff_id", staff.id)
    : { data: [] };
  const classes = classesFrom({
    forms: (forms ?? []) as { id: string; name: string }[],
    offerings: ((offs ?? []) as any[]).map(o => ({ class_group_id: o.class_group_id, class_name: o.class_groups?.name ?? "Class", subject: o.subjects?.name ?? "Subject" })),
    team: ((team ?? []) as any[]).map(t => ({ class_group_id: t.class_group_id, class_name: t.class_groups?.name ?? "Class", role: t.role, subject: t.subjects?.name ?? null, row: t }))
  });
  const own = [ctx.profile.role, ...ctx.profile.extra_roles];
  const granted = [...ctx.roles].filter(r => !own.includes(r));
  return NextResponse.json({
    name: ctx.profile.full_name, staff_no: staff?.staff_no ?? null, position: staff?.position ?? null,
    roles: [...new Set(own)].map(r => ({ key: r, label: roleLabel(r) })),
    custom_role: ctx.customRole ? { name: (ctx.customRole as any).name ?? "Custom role", adds: granted.map(roleLabel), takes_away: ctx.customRole.deny_modules ?? [] } : null,
    areas: accessAreas(ctx.roles, ctx.tenant.modules ?? {}, ctx.customRole?.deny_modules ?? []),
    classes,
    subjects: [...new Set(((subj ?? []) as any[]).map(s => s.subjects?.name).filter(Boolean) as string[])].sort()
  });
}
