import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError, ROLES } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { runAccountAutomation, resendStudentKey, ensureGuardianInvite } from "@/lib/accounts-server";

/**
 * Class teams and accounts, for school admins: each class's form teacher,
 * subject teachers and extra teachers/assistants with their privileges; and
 * the automatic sign-ins for students and parents.
 */
export async function GET() {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const [classes, offerings, team, staff, subjects, settings, studentsAll, studentsNoLogin, guardiansAll, guardiansNoLogin, guardiansWaiting] = await Promise.all([
    svc.from("class_groups").select("id,name,level,form_teacher_id").eq("tenant_id", tid).order("name"),
    svc.from("subject_offerings").select("id,class_group_id,subject_id,teacher_id,subjects(name)").eq("tenant_id", tid),
    svc.from("class_staff").select("*").eq("tenant_id", tid),
    svc.from("users").select("id,full_name,role").eq("tenant_id", tid).not("role", "in", "(student,parent)").eq("active", true).order("full_name"),
    svc.from("subjects").select("id,name").eq("tenant_id", tid).order("name"),
    svc.from("tenant_settings").select("auto_student_logins,auto_parent_invites,story_photo_consent,points_allow_needs_work").eq("tenant_id", tid).maybeSingle(),
    svc.from("students").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("status", "active"),
    svc.from("students").select("id,first_name,last_name,login_sent_at", { count: "exact" }).eq("tenant_id", tid).eq("status", "active").is("user_id", null).limit(50),
    svc.from("guardians").select("id", { count: "exact", head: true }).eq("tenant_id", tid),
    svc.from("guardians").select("id", { count: "exact", head: true }).eq("tenant_id", tid).is("user_id", null),
    svc.from("guardians").select("id,full_name,email,phone,invited_at").eq("tenant_id", tid).is("user_id", null).is("invited_at", null).limit(50)
  ]);
  return NextResponse.json({
    classes: classes.data ?? [], offerings: offerings.data ?? [], team: team.data ?? [], staff: staff.data ?? [], subjects: subjects.data ?? [],
    settings: settings.data ?? {},
    accounts: {
      students: studentsAll.count ?? 0, students_without_login: studentsNoLogin.count ?? 0, students_waiting: studentsNoLogin.data ?? [],
      parents: guardiansAll.count ?? 0, parents_without_login: guardiansNoLogin.count ?? 0, parents_waiting: guardiansWaiting.data ?? []
    }
  });
}

const Priv = { can_teach_live: z.boolean(), can_give_points: z.boolean(), can_post_story: z.boolean(), can_message_parents: z.boolean(), can_see_results: z.boolean() };
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), class_group_id: z.string().uuid(), subject_id: z.string().uuid().nullish(), user_id: z.string().uuid(),
    role: z.enum(["co_teacher", "assistant", "support"]).default("co_teacher"), ...Object.fromEntries(Object.entries(Priv).map(([k, v]) => [k, v.optional()])) }),
  z.object({ action: z.literal("update"), id: z.string().uuid(), role: z.enum(["co_teacher", "assistant", "support"]).optional(), ...Object.fromEntries(Object.entries(Priv).map(([k, v]) => [k, v.optional()])) }),
  z.object({ action: z.literal("remove"), id: z.string().uuid() }),
  z.object({ action: z.literal("form_teacher"), class_group_id: z.string().uuid(), user_id: z.string().uuid().nullable() }),
  z.object({ action: z.literal("subject_teacher"), offering_id: z.string().uuid(), user_id: z.string().uuid().nullable() }),
  z.object({ action: z.literal("settings"), auto_student_logins: z.boolean().optional(), auto_parent_invites: z.boolean().optional(), story_photo_consent: z.boolean().optional() }),
  z.object({ action: z.literal("run_accounts") }),
  z.object({ action: z.literal("resend_key"), student_id: z.string().uuid() }),
  z.object({ action: z.literal("invite_parent"), guardian_id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data as any;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const staffOf = async (uid: string) => (await svc.from("users").select("id,role").eq("tenant_id", tid).eq("id", uid).maybeSingle()).data;
  const audit = (action: string, meta: Record<string, unknown>) => svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action, meta });
  switch (b.action) {
    case "add": {
      const u = await staffOf(b.user_id);
      if (!u || ["student", "parent"].includes(u.role)) return jsonError("choose a member of staff");
      const { data: cg } = await svc.from("class_groups").select("id").eq("tenant_id", tid).eq("id", b.class_group_id).maybeSingle();
      if (!cg) return jsonError("class not found", 404);
      const row: Record<string, unknown> = { tenant_id: tid, class_group_id: b.class_group_id, subject_id: b.subject_id ?? null, user_id: b.user_id, role: b.role, added_by: ctx.userId };
      for (const k of Object.keys(Priv)) if (b[k] !== undefined) row[k] = b[k];
      if (b.role === "assistant" || b.role === "support") { row.can_message_parents = b.can_message_parents ?? false; row.can_see_results = b.can_see_results ?? false; }
      const { error } = await ctx.sb.from("class_staff").insert(row);
      if (error) return jsonError(error.message.includes("duplicate") ? "already on this class's team" : error.message);
      await audit("class_staff.added", { class_group_id: b.class_group_id, user_id: b.user_id, role: b.role });
      return NextResponse.json({ ok: true });
    }
    case "update": {
      const row: Record<string, unknown> = {};
      for (const k of [...Object.keys(Priv), "role"]) if (b[k] !== undefined) row[k] = b[k];
      const { error } = await ctx.sb.from("class_staff").update(row).eq("tenant_id", tid).eq("id", b.id);
      if (error) return jsonError(error.message);
      await audit("class_staff.updated", { id: b.id, ...row });
      return NextResponse.json({ ok: true });
    }
    case "remove": {
      const { error } = await ctx.sb.from("class_staff").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "form_teacher": {
      if (b.user_id && !(await staffOf(b.user_id))) return jsonError("choose a member of staff");
      const { error } = await svc.from("class_groups").update({ form_teacher_id: b.user_id }).eq("tenant_id", tid).eq("id", b.class_group_id);
      if (error) return jsonError(error.message);
      await audit("class.form_teacher", { class_group_id: b.class_group_id, user_id: b.user_id });
      return NextResponse.json({ ok: true });
    }
    case "subject_teacher": {
      if (b.user_id && !(await staffOf(b.user_id))) return jsonError("choose a member of staff");
      const { error } = await svc.from("subject_offerings").update({ teacher_id: b.user_id }).eq("tenant_id", tid).eq("id", b.offering_id);
      if (error) return jsonError(error.message);
      await audit("class.subject_teacher", { offering_id: b.offering_id, user_id: b.user_id });
      return NextResponse.json({ ok: true });
    }
    case "settings": {
      const row = Object.fromEntries(Object.entries(b).filter(([k, v]) => k !== "action" && v !== undefined));
      const { error } = await svc.from("tenant_settings").update(row).eq("tenant_id", tid);
      if (error) return jsonError(error.message);
      await audit("accounts.settings", row);
      return NextResponse.json({ ok: true });
    }
    case "run_accounts":
      return NextResponse.json(await runAccountAutomation(svc, appUrl(req), 100, tid));
    case "resend_key": {
      const { data: s } = await svc.from("students").select("id").eq("tenant_id", tid).eq("id", b.student_id).maybeSingle();
      if (!s) return jsonError("student not found", 404);
      try { return NextResponse.json(await resendStudentKey(svc, s.id, appUrl(req), ctx.userId)); }
      catch (e) { return jsonError((e as Error).message); }
    }
    case "invite_parent": {
      const { data: g } = await svc.from("guardians").select("id").eq("tenant_id", tid).eq("id", b.guardian_id).maybeSingle();
      if (!g) return jsonError("parent not found", 404);
      try { return NextResponse.json(await ensureGuardianInvite(svc, g.id, appUrl(req), ctx.userId)); }
      catch (e) { return jsonError((e as Error).message); }
    }
  }
  return jsonError("unknown action");
}
