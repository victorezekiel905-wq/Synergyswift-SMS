import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { studentName } from "@/lib/school";

/**
 * Year-end promotion wizard (fixes the painful "rollover" other systems are
 * known for). GET: every class with its students, each student's latest
 * average and a suggested next class. POST: apply the moves in one go.
 */
export async function GET() {
  const ctx = await requireCtx(ROLES.admin, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const [{ data: groups }, { data: students }, { data: scheme }] = await Promise.all([
    ctx.sb.from("class_groups").select("id,name,level").eq("tenant_id", tid).order("level").order("name"),
    ctx.sb.from("students").select("id,admission_no,first_name,last_name,other_names,class_group_id").eq("tenant_id", tid).eq("status", "active").limit(20000),
    ctx.sb.from("grading_schemes").select("pass_mark").eq("tenant_id", tid).eq("is_default", true).maybeSingle()
  ]);
  const ids = (students ?? []).map((s: any) => s.id);
  const latest = new Map<string, number | null>();
  for (let i = 0; i < ids.length; i += 400) {
    const { data } = await ctx.sb.from("report_cards").select("student_id,average,computed_at").eq("tenant_id", tid).in("student_id", ids.slice(i, i + 400)).order("computed_at", { ascending: false });
    for (const r of data ?? []) if (!latest.has(r.student_id)) latest.set(r.student_id, r.average === null ? null : Number(r.average));
  }
  const gs = groups ?? [];
  // Suggest the next class: same arm name at the next level (JSS1 Gold → JSS2 Gold), else the first class of the next level.
  const levels = [...new Set(gs.map((g: any) => g.level).filter(Boolean))];
  const suggest = (g: any) => {
    const li = levels.indexOf(g.level);
    if (li < 0) return null;
    if (li === levels.length - 1) return "graduate";
    const next = gs.filter((x: any) => x.level === levels[li + 1]);
    const arm = g.name.replace(g.level, "").trim().toLowerCase();
    return (next.find((x: any) => x.name.replace(x.level, "").trim().toLowerCase() === arm) ?? next[0])?.id ?? null;
  };
  return NextResponse.json({
    pass_mark: Number(scheme?.pass_mark ?? 40),
    classes: gs.map((g: any) => ({ ...g, suggested: suggest(g), students: (students ?? []).filter((s: any) => s.class_group_id === g.id)
      .map((s: any) => ({ id: s.id, name: studentName(s), admission_no: s.admission_no, average: latest.get(s.id) ?? null })) }))
  });
}

const Body = z.object({
  moves: z.array(z.object({ from: z.string().uuid(), to: z.union([z.string().uuid(), z.literal("graduate"), z.literal("stay")]) })).min(1).max(500),
  repeat_student_ids: z.array(z.string().uuid()).max(5000).default([]),
  confirm: z.literal(true)
});

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("confirm the promotion plan first");
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const repeat = new Set(b.repeat_student_ids);
  // Snapshot every class's current students before moving anyone, so a move into
  // a class that is itself moving on does not get moved twice.
  const snapshot = new Map<string, string[]>();
  for (const m of b.moves) {
    const { data } = await ctx.sb.from("students").select("id").eq("tenant_id", tid).eq("class_group_id", m.from).eq("status", "active").limit(5000);
    snapshot.set(m.from, (data ?? []).map((s: any) => s.id).filter((id: string) => !repeat.has(id)));
  }
  let promoted = 0, graduated = 0;
  for (const m of b.moves) {
    const ids = snapshot.get(m.from) ?? [];
    if (!ids.length || m.to === "stay") continue;
    for (let i = 0; i < ids.length; i += 400) {
      const part = ids.slice(i, i + 400);
      const { error } = m.to === "graduate"
        ? await ctx.sb.from("students").update({ status: "graduated", class_group_id: null }).eq("tenant_id", tid).in("id", part)
        : await ctx.sb.from("students").update({ class_group_id: m.to }).eq("tenant_id", tid).in("id", part);
      if (error) return jsonError(error.message);
    }
    if (m.to === "graduate") graduated += ids.length; else promoted += ids.length;
  }
  await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "students.rollover", meta: { promoted, graduated, repeating: repeat.size } });
  return NextResponse.json({ promoted, graduated, repeating: repeat.size });
}
