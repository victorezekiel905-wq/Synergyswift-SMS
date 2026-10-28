import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { aiConfigured, allowanceFor } from "@/lib/ai";

export const dynamic = "force-dynamic";

const TASK_LABEL: Record<string, string> = {
  report_comments: "Report comments", lesson_note: "Lesson notes", quiz: "Quiz questions", live_questions: "Live lesson questions", slides: "Slides",
  translate: "Translation for parents", notice: "Notices", homework_feedback: "Homework feedback", tutor: "Study helper",
  admissions_brief: "Admissions replies", applicant_summary: "Applicant summaries", admissions_report: "Weekly admissions report"
};

/** The school's AI: this month's use against its allowance, and how drafts are written (phase 14p). Admins only. */
export async function GET() {
  const ctx = await requireCtx(ROLES.admin, "ai");
  if (ctx instanceof NextResponse) return ctx;
  const month = new Date(); month.setUTCDate(1); month.setUTCHours(0, 0, 0, 0);
  const [{ data: rows }, { data: st }] = await Promise.all([
    ctx.sb.from("ai_usage").select("task,ok,user_id,input_tokens,output_tokens,at").eq("tenant_id", ctx.tenant.id).gte("at", month.toISOString()).order("at", { ascending: false }).limit(20000),
    ctx.sb.from("tenant_settings").select("*").eq("tenant_id", ctx.tenant.id).maybeSingle()
  ]);
  const byTask = new Map<string, number>();
  for (const r of rows ?? []) byTask.set(r.task, (byTask.get(r.task) ?? 0) + 1);
  const limit = typeof (st as any)?.ai_monthly_limit === "number" ? (st as any).ai_monthly_limit : Number(process.env.AI_MONTHLY_LIMIT) > 0 ? Number(process.env.AI_MONTHLY_LIMIT) : 3000;
  const s = ((st as any)?.ai_settings ?? {}) as Record<string, any>;
  // The allowance split across the school's people, and who has used most of their share.
  const split = await allowanceFor(createServiceClient(), ctx.tenant.id, limit);
  const byUser = new Map<string, number>();
  for (const r of rows ?? []) if (r.user_id) byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + 1);
  const top = [...byUser].sort((a, b) => b[1] - a[1]).slice(0, 15);
  const { data: who } = top.length ? await ctx.sb.from("users").select("id,full_name,role,extra_roles").in("id", top.map(t => t[0])) : { data: [] };
  const people = top.map(([id, n]) => {
    const u = (who ?? []).find((x: any) => x.id === id);
    const roles = [u?.role, ...(u?.extra_roles ?? [])];
    const free = roles.some((r: string) => ["school_admin", "principal"].includes(r));
    const share = free ? null : u?.role === "student" ? split.shares.student : split.shares.staff;
    return { name: u?.full_name ?? "Someone", role: u?.role ?? "", used: n, share };
  });
  return NextResponse.json({
    available: aiConfigured(), used: rows?.length ?? 0, limit, split, people,
    by_task: [...byTask].map(([task, n]) => ({ task, label: TASK_LABEL[task] ?? task.replace(/_/g, " "), n })).sort((a, b) => b.n - a.n),
    settings: { comments: s.comments ?? { tone: "warm", length: "short" }, admissions: s.admissions ?? {} },
    admissions_report: s.admissions_report ?? null
  });
}

const Body = z.object({
  comments: z.object({ tone: z.enum(["warm", "formal", "encouraging", "firm"]), length: z.enum(["short", "medium"]) }).optional(),
  admissions: z.object({ autopilot: z.boolean(), auto_reply: z.boolean(), auto_chase: z.boolean(), weekly_report: z.boolean() }).optional()
});

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "ai");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  // Read-modify-write on the service client so the scheduler's own keys (report dates) are kept.
  const svc = createServiceClient();
  const { data: st } = await svc.from("tenant_settings").select("ai_settings").eq("tenant_id", ctx.tenant.id).maybeSingle();
  if (!st) return jsonError("Finish School setup first.");
  const next = { ...(st.ai_settings ?? {}), ...parsed.data };
  const { error } = await svc.from("tenant_settings").update({ ai_settings: next }).eq("tenant_id", ctx.tenant.id);
  if (error) return jsonError(error.message.includes("ai_settings") ? "AI settings need the database update (migration 20260101007500)." : error.message);
  await ctx.sb.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: "ai.settings", meta: parsed.data });
  return NextResponse.json({ ok: true });
}
