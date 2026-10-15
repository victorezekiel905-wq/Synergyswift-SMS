import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { studentName } from "@/lib/school";

/** Groups inside a class (support, core, extension …) and who is in each. ?class_group_id= */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const cg = new URL(req.url).searchParams.get("class_group_id");
  if (!cg) return jsonError("choose a class");
  const tid = ctx.tenant.id;
  const [{ data: groups }, { data: students }] = await Promise.all([
    ctx.sb.from("learning_groups").select("id,name,kind,learning_group_members(student_id)").eq("tenant_id", tid).eq("class_group_id", cg).order("name"),
    ctx.sb.from("students").select("id,first_name,last_name,other_names").eq("tenant_id", tid).eq("class_group_id", cg).eq("status", "active").order("first_name")
  ]);
  return NextResponse.json({
    groups: (groups ?? []).map((g: any) => ({ id: g.id, name: g.name, kind: g.kind, members: (g.learning_group_members ?? []).map((m: any) => m.student_id) })),
    students: (students ?? []).map((s: any) => ({ id: s.id, name: studentName(s) }))
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().nullish(), class_group_id: z.string().uuid(), name: z.string().trim().min(1).max(60), kind: z.enum(["support", "core", "extension", "custom"]) }),
  z.object({ action: z.literal("members"), id: z.string().uuid(), student_ids: z.array(z.string().uuid()).max(200) }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.action === "save") {
    const row = { tenant_id: tid, class_group_id: b.class_group_id, name: b.name, kind: b.kind, created_by: ctx.userId };
    const { data, error } = b.id
      ? await ctx.sb.from("learning_groups").update({ name: b.name, kind: b.kind }).eq("tenant_id", tid).eq("id", b.id).select("id").single()
      : await ctx.sb.from("learning_groups").insert(row).select("id").single();
    return error ? jsonError(error.message.includes("duplicate") ? "this class already has a group with that name" : error.message) : NextResponse.json({ ok: true, id: data.id });
  }
  if (b.action === "delete") {
    const { error } = await ctx.sb.from("learning_groups").delete().eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  const { data: g } = await ctx.sb.from("learning_groups").select("id,class_group_id").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
  if (!g) return jsonError("group not found", 404);
  const { data: ok } = b.student_ids.length ? await ctx.sb.from("students").select("id").eq("tenant_id", tid).eq("class_group_id", g.class_group_id).in("id", b.student_ids) : { data: [] };
  const ids = (ok ?? []).map((s: any) => s.id);
  await ctx.sb.from("learning_group_members").delete().eq("group_id", g.id);
  if (ids.length) {
    const { error } = await ctx.sb.from("learning_group_members").insert(ids.map((student_id: string) => ({ group_id: g.id, student_id, tenant_id: tid })));
    if (error) return jsonError(error.message);
  }
  return NextResponse.json({ ok: true, members: ids.length });
}
