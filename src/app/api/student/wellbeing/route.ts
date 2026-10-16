import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { localParts, zonedToUtc } from "@/lib/attendance";
import { appUrl } from "@/lib/school";
import { FEELINGS } from "@/lib/welfare";
import { alertCheckin } from "@/lib/welfare-server";

export const dynamic = "force-dynamic";

/** A student's wellbeing check-in: is it switched on, have they checked in today, and their recent ones. */
export async function GET() {
  const ctx = await requireCtx(["student"]);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id, svc = createServiceClient();
  const { data: s } = await ctx.sb.from("students").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
  const { data: set } = await svc.from("tenant_settings").select("wellbeing_checkins,wellbeing_anonymous").eq("tenant_id", tid).maybeSingle();
  if (!s || !set?.wellbeing_checkins) return NextResponse.json({ enabled: false });
  const today = localParts(new Date(), ctx.tenant.timezone).date;
  const start = zonedToUtc(`${today}T00:00`, ctx.tenant.timezone)?.toISOString() ?? `${today}T00:00:00Z`;
  const { data: mine } = await ctx.sb.from("wellbeing_checkins").select("mood,feelings,wants_to_talk,created_at,followed_up_at").eq("student_id", s.id).order("created_at", { ascending: false }).limit(14);
  return NextResponse.json({ enabled: true, anonymous_allowed: Boolean(set.wellbeing_anonymous), done_today: (mine ?? []).some((m: any) => m.created_at >= start), recent: mine ?? [], feelings: FEELINGS });
}

const Body = z.object({ mood: z.number().int().min(1).max(5), feelings: z.array(z.enum(FEELINGS)).max(6).default([]), note: z.string().trim().max(500).nullish(),
  wants_to_talk: z.boolean().default(false), anonymous: z.boolean().default(false) });

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(["student"]);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("choose how you feel");
  const b = parsed.data;
  const tid = ctx.tenant.id, svc = createServiceClient();
  const { data: s } = await svc.from("students").select("id,class_group_id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
  if (!s) return jsonError("your login is not linked to a student record", 404);
  const { data: set } = await svc.from("tenant_settings").select("wellbeing_checkins,wellbeing_anonymous").eq("tenant_id", tid).maybeSingle();
  if (!set?.wellbeing_checkins) return jsonError("check-ins are not switched on", 403);
  // Asking to talk always gives your name, so someone can find you.
  const anonymous = Boolean(set.wellbeing_anonymous) && b.anonymous && !b.wants_to_talk;
  const today = localParts(new Date(), ctx.tenant.timezone).date;
  const start = zonedToUtc(`${today}T00:00`, ctx.tenant.timezone)?.toISOString() ?? `${today}T00:00:00Z`;
  if (!anonymous) {
    const { count } = await svc.from("wellbeing_checkins").select("id", { count: "exact", head: true }).eq("student_id", s.id).gte("created_at", start);
    if (count) return jsonError("you have already checked in today");
  }
  const { data, error } = await svc.from("wellbeing_checkins").insert({ tenant_id: tid, student_id: anonymous ? null : s.id, class_group_id: s.class_group_id, mood: b.mood,
    feelings: b.feelings, note: anonymous ? null : b.note ?? null, wants_to_talk: b.wants_to_talk }).select("id,student_id,mood,feelings,wants_to_talk").single();
  if (error) return jsonError(error.message);
  const alerted = await alertCheckin(svc, tid, data, appUrl(req)).catch(() => false);
  return NextResponse.json({ ok: true, someone_will_check: alerted }, { status: 201 });
}
