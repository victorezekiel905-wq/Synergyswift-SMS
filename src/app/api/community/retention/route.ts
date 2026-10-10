import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl, studentName } from "@/lib/school";
import { fetchAll } from "@/lib/results";
import { loadFamilies, notifyRound, roundStudents, CrmError } from "@/lib/community-server";
import { reenrolmentSummary, REENROL_REASONS } from "@/lib/community";

export const dynamic = "force-dynamic";

/** Re-enrolment rounds with progress, and the families most at risk of leaving. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "community");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const roundId = new URL(req.url).searchParams.get("round");
  const [{ data: rounds }, families, { data: classes }, { data: settings }] = await Promise.all([
    ctx.sb.from("reenrolment_rounds").select("*").eq("tenant_id", tid).order("created_at", { ascending: false }),
    loadFamilies(svc, tid),
    svc.from("class_groups").select("id,name,level").eq("tenant_id", tid).order("name"),
    svc.from("tenant_settings").select("currency").eq("tenant_id", tid).maybeSingle()
  ]);
  const round = (rounds ?? []).find((r: any) => r.id === roundId) ?? (rounds ?? [])[0] ?? null;
  let detail = null;
  if (round) {
    const [students, responses] = await Promise.all([
      roundStudents(svc, tid, round),
      fetchAll<any>(() => svc.from("reenrolment_responses").select("student_id,intent,reason,note,responded_at,guardians(full_name)").eq("round_id", round.id).order("student_id"))
    ]);
    const by = new Map(responses.map(r => [r.student_id, r]));
    const cls = new Map<string, string>((classes ?? []).map((c: any) => [c.id, c.name]));
    const perClass = new Map<string, string[]>();
    for (const s of students) { const k = s.class_group_id ?? "none"; if (!perClass.has(k)) perClass.set(k, []); perClass.get(k)!.push(s.id); }
    detail = {
      summary: reenrolmentSummary(students.map((s: any) => s.id), responses),
      by_class: [...perClass.entries()].map(([id, ids]) => ({ class_name: cls.get(id) ?? "No class", ...reenrolmentSummary(ids, responses) })).sort((a, b) => a.class_name.localeCompare(b.class_name)),
      students: students.map((s: any) => {
        const r = by.get(s.id);
        return { id: s.id, name: studentName(s), class_name: cls.get(s.class_group_id) ?? null, intent: r?.intent ?? null, reason: r?.reason ?? null, note: r?.note ?? null, responded_at: r?.responded_at ?? null, by: r?.guardians?.full_name ?? null };
      }).sort((a: any, b: any) => (a.class_name ?? "").localeCompare(b.class_name ?? "") || a.name.localeCompare(b.name))
    };
  }
  return NextResponse.json({
    rounds: rounds ?? [], round, detail, classes: classes ?? [], currency: settings?.currency ?? "NGN",
    at_risk: families.filter(f => f.risk.level !== "low").slice(0, 300),
    counts: { high: families.filter(f => f.risk.level === "high").length, medium: families.filter(f => f.risk.level === "medium").length, families: families.length }
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().nullish(), title: z.string().trim().min(2).max(120), message: z.string().trim().max(1000).nullish(),
    class_group_ids: z.array(z.string().uuid()).max(200).default([]), deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }),
  z.object({ action: z.literal("open"), id: z.string().uuid(), notify: z.boolean().default(true) }),
  z.object({ action: z.literal("remind"), id: z.string().uuid() }),
  z.object({ action: z.literal("close"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("record"), id: z.string().uuid(), student_id: z.string().uuid(), intent: z.enum(["returning", "not_returning", "undecided"]),
    reason: z.enum(REENROL_REASONS).nullish(), note: z.string().trim().max(500).nullish() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "community");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  try {
    switch (b.action) {
      case "save": {
        const row = { title: b.title, message: b.message ?? null, class_group_ids: b.class_group_ids, deadline: b.deadline ?? null };
        const { data, error } = b.id
          ? await ctx.sb.from("reenrolment_rounds").update(row).eq("tenant_id", tid).eq("id", b.id).select("id").single()
          : await ctx.sb.from("reenrolment_rounds").insert({ ...row, tenant_id: tid, status: "draft", created_by: ctx.userId }).select("id").single();
        return error ? jsonError(error.message) : NextResponse.json({ ok: true, id: data.id });
      }
      case "open": {
        // One open round at a time, so families only ever see one question.
        await ctx.sb.from("reenrolment_rounds").update({ status: "closed" }).eq("tenant_id", tid).eq("status", "open").neq("id", b.id);
        const { error } = await ctx.sb.from("reenrolment_rounds").update({ status: "open" }).eq("tenant_id", tid).eq("id", b.id);
        if (error) return jsonError(error.message);
        const sent = b.notify ? await notifyRound(svc, { tenantId: tid, roundId: b.id, baseUrl: appUrl(req) }) : null;
        return NextResponse.json({ ok: true, sent });
      }
      case "remind":
        return NextResponse.json({ ok: true, sent: await notifyRound(svc, { tenantId: tid, roundId: b.id, baseUrl: appUrl(req), remind: true }) });
      case "close": {
        const { error } = await ctx.sb.from("reenrolment_rounds").update({ status: "closed" }).eq("tenant_id", tid).eq("id", b.id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "delete": {
        const { error } = await ctx.sb.from("reenrolment_rounds").delete().eq("tenant_id", tid).eq("id", b.id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "record": {
        // Staff record an answer given by phone or in person.
        const { data: s } = await svc.from("students").select("id").eq("tenant_id", tid).eq("id", b.student_id).maybeSingle();
        const { data: r } = await ctx.sb.from("reenrolment_rounds").select("id").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
        if (!s || !r) return jsonError("not found", 404);
        const { error } = await ctx.sb.from("reenrolment_responses").upsert({ round_id: b.id, student_id: b.student_id, tenant_id: tid, intent: b.intent,
          reason: b.intent === "not_returning" ? (b.reason ?? "other") : null, note: b.note ?? null, responded_at: new Date().toISOString() }, { onConflict: "round_id,student_id" });
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
    }
  } catch (e) {
    if (e instanceof CrmError) return jsonError(e.message, e.status);
    return jsonError((e as Error).message);
  }
}
