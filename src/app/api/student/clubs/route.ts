import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { localParts } from "@/lib/attendance";
import { joinCheck } from "@/lib/cocurricular";
import { setClubFee } from "@/lib/cocurricular-server";
import { tellStaff } from "@/lib/hr-server";

export const dynamic = "force-dynamic";

async function me(ctx: any) {
  const { data } = await ctx.sb.from("students").select("id,class_group_id,first_name,last_name").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  return data as { id: string; class_group_id: string | null; first_name: string; last_name: string } | null;
}

/** A student's clubs and teams, the ones they can join, and their competition results. */
export async function GET() {
  const ctx = await requireCtx(["student"]);
  if (ctx instanceof NextResponse) return ctx;
  const s = await me(ctx);
  if (!s) return NextResponse.json({ groups: [], results: [] });
  const tid = ctx.tenant.id;
  const [{ data: groups }, { data: mine }, { data: counts }, { data: results }] = await Promise.all([
    ctx.sb.from("cc_groups").select("id,name,kind,description,meets,location,capacity,joining,open_to_class_ids,active").eq("tenant_id", tid).eq("active", true).order("name"),
    ctx.sb.from("cc_members").select("group_id,status,role").eq("student_id", s.id),
    createServiceClient().from("cc_members").select("group_id").eq("tenant_id", tid).eq("status", "active"),
    ctx.sb.from("competition_entries").select("id,event,position,award,score,competitions(title,held_on,level)").eq("student_id", s.id).order("created_at", { ascending: false }).limit(30)
  ]);
  const status = new Map((mine ?? []).map((m: any) => [m.group_id, m]));
  return NextResponse.json({
    groups: (groups ?? []).map((g: any) => {
      const m: any = status.get(g.id);
      const check = joinCheck(g, { classId: s.class_group_id, activeMembers: (counts ?? []).filter((c: any) => c.group_id === g.id).length, status: m?.status ?? null });
      return { id: g.id, name: g.name, kind: g.kind, description: g.description, meets: g.meets, location: g.location, status: m?.status ?? null, role: m?.role ?? null, can_join: check.ok, why_not: check.ok ? null : check.reason, joining: g.joining };
    }).filter((g: any) => g.status === "active" || g.status === "requested" || g.can_join),
    results: results ?? []
  });
}

const Body = z.object({ action: z.enum(["join", "leave"]), group_id: z.string().uuid() });

/** Join (or ask to join) a club, or leave it. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(["student"]);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("choose a group");
  const b = parsed.data;
  const s = await me(ctx);
  if (!s) return jsonError("your login is not linked to a student record", 404);
  const svc = createServiceClient(), tid = ctx.tenant.id;
  const { data: g } = await svc.from("cc_groups").select("id,name,joining,capacity,open_to_class_ids,active,lead_id,assistant_ids,fee_item_id").eq("tenant_id", tid).eq("id", b.group_id).maybeSingle();
  if (!g) return jsonError("group not found", 404);
  const { data: cur } = await svc.from("cc_members").select("status").eq("group_id", g.id).eq("student_id", s.id).maybeSingle();
  const today = localParts(new Date(), ctx.tenant.timezone).date;
  if (b.action === "leave") {
    if (!cur || !["active", "requested"].includes(cur.status)) return jsonError("you are not in this group");
    await svc.from("cc_members").update({ status: "left", left_on: today }).eq("group_id", g.id).eq("student_id", s.id);
    await setClubFee(svc, tid, s.id, g.fee_item_id, false);
    return NextResponse.json({ ok: true });
  }
  const { count } = await svc.from("cc_members").select("student_id", { count: "exact", head: true }).eq("group_id", g.id).eq("status", "active");
  const check = joinCheck(g, { classId: s.class_group_id, activeMembers: count ?? 0, status: cur?.status ?? null });
  if (!check.ok) return jsonError(check.reason);
  const { error } = await svc.from("cc_members").upsert({ group_id: g.id, tenant_id: tid, student_id: s.id, status: check.status, requested_at: new Date().toISOString(),
    joined_on: check.status === "active" ? today : null, left_on: null }, { onConflict: "group_id,student_id" });
  if (error) return jsonError(error.message);
  if (check.status === "active") await setClubFee(svc, tid, s.id, g.fee_item_id, true);
  else await tellStaff(svc, tid, [g.lead_id, ...(g.assistant_ids ?? [])].filter(Boolean), "club", `Request to join ${g.name}`, `${s.first_name} ${s.last_name} has asked to join ${g.name}.`, "/school/activities", g.id);
  return NextResponse.json({ status: check.status }, { status: 201 });
}
