import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";

/** Class groups (arms), subjects, subject-teacher assignments and the staff list for pickers. */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const [groups, subjects, offerings, teachers, students] = await Promise.all([
    ctx.sb.from("class_groups").select("id,name,level,form_teacher_id,scheme_id").eq("tenant_id", tid).order("level").order("name"),
    ctx.sb.from("subjects").select("id,name,code").eq("tenant_id", tid).order("name"),
    ctx.sb.from("subject_offerings").select("id,class_group_id,subject_id,teacher_id").eq("tenant_id", tid),
    ctx.sb.from("users").select("id,full_name,email,role,extra_roles").eq("tenant_id", tid)
      .not("role", "in", "(student,parent)").eq("active", true).order("full_name"),
    ctx.sb.from("students").select("class_group_id").eq("tenant_id", tid).eq("status", "active")
  ]);
  const counts: Record<string, number> = {};
  for (const s of students.data ?? []) if (s.class_group_id) counts[s.class_group_id] = (counts[s.class_group_id] ?? 0) + 1;
  return NextResponse.json({
    class_groups: (groups.data ?? []).map((g: any) => ({ ...g, students: counts[g.id] ?? 0 })),
    subjects: subjects.data ?? [],
    offerings: offerings.data ?? [],
    staff: teachers.data ?? []
  });
}

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("class_group"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(60),
    level: z.string().trim().max(40).nullish(), form_teacher_id: z.string().uuid().nullish(), scheme_id: z.string().uuid().nullish() }),
  z.object({ kind: z.literal("subject"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), code: z.string().trim().max(20).nullish() }),
  z.object({ kind: z.literal("offering"), class_group_id: z.string().uuid(), subject_id: z.string().uuid(), teacher_id: z.string().uuid().nullish() }),
  z.object({ kind: z.literal("offer_all"), class_group_id: z.string().uuid() }),
  z.object({ kind: z.literal("delete"), table: z.enum(["class_groups", "subjects", "subject_offerings"]), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  const dup = (m: string) => (m.includes("duplicate") ? "that name already exists" : m);

  if (b.kind === "class_group") {
    const row = { tenant_id: tid, name: b.name, level: b.level ?? null, form_teacher_id: b.form_teacher_id ?? null, scheme_id: b.scheme_id ?? null };
    const { data, error } = b.id
      ? await sb.from("class_groups").update(row).eq("tenant_id", tid).eq("id", b.id).select("id").single()
      : await sb.from("class_groups").insert(row).select("id").single();
    return error ? jsonError(dup(error.message)) : NextResponse.json(data);
  }
  if (b.kind === "subject") {
    const row = { tenant_id: tid, name: b.name, code: b.code ?? null };
    const { data, error } = b.id
      ? await sb.from("subjects").update(row).eq("tenant_id", tid).eq("id", b.id).select("id").single()
      : await sb.from("subjects").insert(row).select("id").single();
    return error ? jsonError(dup(error.message)) : NextResponse.json(data);
  }
  if (b.kind === "offering") {
    const { data, error } = await sb.from("subject_offerings").upsert(
      { tenant_id: tid, class_group_id: b.class_group_id, subject_id: b.subject_id, teacher_id: b.teacher_id ?? null },
      { onConflict: "class_group_id,subject_id" }).select("id").single();
    return error ? jsonError(error.message) : NextResponse.json(data);
  }
  if (b.kind === "offer_all") {
    const { data: subs } = await sb.from("subjects").select("id").eq("tenant_id", tid);
    const rows = (subs ?? []).map((s: { id: string }) => ({ tenant_id: tid, class_group_id: b.class_group_id, subject_id: s.id }));
    if (rows.length) {
      const { error } = await sb.from("subject_offerings").upsert(rows, { onConflict: "class_group_id,subject_id", ignoreDuplicates: true });
      if (error) return jsonError(error.message);
    }
    return NextResponse.json({ ok: true, added: rows.length });
  }
  const { error } = await sb.from(b.table).delete().eq("tenant_id", tid).eq("id", b.id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}
