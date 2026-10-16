import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { studentName, appUrl } from "@/lib/school";
import { zonedToUtc } from "@/lib/attendance";
import { notifyGuardians } from "@/lib/notify";
import { communityNote } from "@/lib/messaging/notices";
import { formatInZone } from "@/lib/messaging/outbox";

export const dynamic = "force-dynamic";

const STUDENT = "first_name,last_name,other_names,class_groups(name)";

/** Behaviour incidents (who was involved and how) and detentions (sessions, who is in them, served or missed). */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "behaviour");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id, sb = ctx.sb;
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [incidents, sessions, detentions, staff] = await Promise.all([
    sb.from("behaviour_incidents").select(`id,occurred_at,location,severity,description,action_taken,status,outcome,reported_by,behaviour_categories(name),behaviour_incident_students(student_id,role,students(${STUDENT}))`)
      .eq("tenant_id", tid).order("occurred_at", { ascending: false }).limit(150),
    sb.from("detention_sessions").select("*").eq("tenant_id", tid).gte("starts_at", since).order("starts_at"),
    sb.from("detentions").select(`id,student_id,session_id,reason,status,parent_notified_at,created_at,incident_id,students(${STUDENT})`).eq("tenant_id", tid)
      .or(`status.eq.scheduled,created_at.gte.${since}`).order("created_at", { ascending: false }).limit(500),
    createServiceClient().from("users").select("id,full_name").eq("tenant_id", ctx.tenant.id).eq("active", true).neq("role", "parent").neq("role", "student").order("full_name")
  ]);
  return NextResponse.json({
    me: ctx.userId, admin: hasAny(ctx, ROLES.admin), staff: staff.data ?? [],
    incidents: (incidents.data ?? []).map((i: any) => ({ ...i, students: (i.behaviour_incident_students ?? []).map((s: any) => ({ id: s.student_id, role: s.role, name: studentName(s.students), class: s.students?.class_groups?.name ?? null })), behaviour_incident_students: undefined })),
    sessions: sessions.data ?? [],
    detentions: (detentions.data ?? []).map((d: any) => ({ ...d, name: studentName(d.students), class: d.students?.class_groups?.name ?? null, students: undefined }))
  });
}

const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const opt = (n: number) => z.string().trim().max(n).nullish().transform(v => v || null);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_incident"), occurred_at: local, location: opt(120), category_id: z.string().uuid().nullish(), severity: z.enum(["minor", "moderate", "serious"]),
    description: z.string().trim().min(3).max(4000), action_taken: opt(2000), students: z.array(z.object({ student_id: z.string().uuid(), role: z.enum(["responsible", "involved", "affected", "witness"]) })).min(1).max(40),
    record_points: z.boolean().default(true) }),
  z.object({ action: z.literal("resolve_incident"), id: z.string().uuid(), outcome: z.string().trim().min(2).max(2000) }),
  z.object({ action: z.literal("save_session"), id: z.string().uuid().optional(), kind: z.enum(["detention", "isolation", "community_service"]), starts_at: local, duration_min: z.number().int().min(5).max(480),
    location: opt(120), supervisor_id: z.string().uuid().nullish(), capacity: z.number().int().min(1).max(500).nullish() }),
  z.object({ action: z.literal("delete_session"), id: z.string().uuid() }),
  z.object({ action: z.literal("set_detention"), student_ids: z.array(z.string().uuid()).min(1).max(60), reason: z.string().trim().min(2).max(500), session_id: z.string().uuid().nullish(),
    incident_id: z.string().uuid().nullish(), behaviour_action_id: z.string().uuid().nullish(), notify_parent: z.boolean().default(true) }),
  z.object({ action: z.literal("assign"), ids: z.array(z.string().uuid()).min(1).max(200), session_id: z.string().uuid(), notify_parent: z.boolean().default(true) }),
  z.object({ action: z.literal("mark"), id: z.string().uuid(), status: z.enum(["served", "missed", "cancelled", "scheduled"]) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "behaviour");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, sb = ctx.sb, tz = ctx.tenant.timezone, svc = createServiceClient();
  const fail = (m: string) => jsonError(m.includes("row-level security") ? "you cannot do that" : m);

  /** Tells each student's parents when and where the detention is. */
  const tellParents = async (rows: { id: string; student_id: string; session_id: string | null; reason: string }[]) => {
    const sessionIds = [...new Set(rows.map(r => r.session_id).filter(Boolean))] as string[];
    if (!sessionIds.length) return 0;
    const { data: ses } = await svc.from("detention_sessions").select("id,kind,starts_at,duration_min,location").in("id", sessionIds);
    const sBy = new Map((ses ?? []).map((s: any) => [s.id, s]));
    const { data: studs } = await svc.from("students").select("id,first_name,last_name,other_names").in("id", rows.map(r => r.student_id));
    const names = new Map((studs ?? []).map((s: any) => [s.id, studentName(s)]));
    let n = 0;
    for (const r of rows) {
      const s: any = sBy.get(r.session_id ?? "");
      if (!s) continue;
      const when = formatInZone(new Date(s.starts_at), tz);
      const what = s.kind === "isolation" ? "an isolation session" : s.kind === "community_service" ? "community service" : "a detention";
      await notifyGuardians(svc, { tenantId: tid, studentIds: [r.student_id], kind: "behaviour", refId: r.id, createdBy: ctx.userId, budgetMs: 1500,
        build: (brand, g) => communityNote(brand, { name: g.full_name, subject: `${names.get(r.student_id) ?? "Your child"}: ${what}`,
          lines: [`${names.get(r.student_id) ?? "Your child"} has ${what} on ${when.date} at ${when.time} for ${s.duration_min} minutes${s.location ? ` in ${s.location}` : ""}.`, `Reason: ${r.reason}`,
            "Please make sure they attend and arrange to collect them afterwards if needed."] }) });
      await svc.from("detentions").update({ parent_notified_at: new Date().toISOString() }).eq("id", r.id);
      n++;
    }
    return n;
  };
  const roomFor = async (sessionId: string, adding: number) => {
    const { data: s } = await sb.from("detention_sessions").select("capacity").eq("tenant_id", tid).eq("id", sessionId).maybeSingle();
    if (!s) return "session not found";
    if (!s.capacity) return null;
    const { count } = await sb.from("detentions").select("id", { count: "exact", head: true }).eq("session_id", sessionId).neq("status", "cancelled");
    return (count ?? 0) + adding > s.capacity ? `that session has room for ${Math.max(0, s.capacity - (count ?? 0))} more` : null;
  };

  switch (b.action) {
    case "add_incident": {
      const at = zonedToUtc(b.occurred_at, tz)?.toISOString() ?? new Date().toISOString();
      const { data: inc, error } = await sb.from("behaviour_incidents").insert({ tenant_id: tid, occurred_at: at, location: b.location, category_id: b.category_id ?? null, severity: b.severity,
        description: b.description, action_taken: b.action_taken, reported_by: ctx.userId }).select("id").single();
      if (error) return fail(error.message);
      const { data: cat } = b.category_id ? await sb.from("behaviour_categories").select("id,kind,points").eq("tenant_id", tid).eq("id", b.category_id).maybeSingle() : { data: null };
      for (const s of b.students) {
        let recordId: string | null = null;
        if (b.record_points && cat && s.role === "responsible") {
          const { data: rec } = await sb.from("behaviour_records").insert({ tenant_id: tid, student_id: s.student_id, category_id: cat.id, kind: cat.kind, points: cat.points,
            note: `Incident: ${b.description.slice(0, 200)}`, recorded_by: ctx.userId, occurred_at: at }).select("id").single();
          recordId = rec?.id ?? null;
        }
        const ins = await sb.from("behaviour_incident_students").insert({ incident_id: inc.id, tenant_id: tid, student_id: s.student_id, role: s.role, behaviour_record_id: recordId });
        if (ins.error) return fail(ins.error.message);
      }
      return NextResponse.json({ id: inc.id }, { status: 201 });
    }
    case "resolve_incident": {
      const { data, error } = await sb.from("behaviour_incidents").update({ status: "resolved", outcome: b.outcome }).eq("tenant_id", tid).eq("id", b.id).select("id");
      if (error) return fail(error.message);
      return data?.length ? NextResponse.json({ ok: true }) : jsonError("only the person who reported it or an admin can close it", 403);
    }
    case "save_session": {
      const { action: _a, id, starts_at, ...row } = b;
      const at = zonedToUtc(starts_at, tz)?.toISOString();
      if (!at) return jsonError("check the date and time");
      const full = { ...row, starts_at: at, supervisor_id: row.supervisor_id ?? null, capacity: row.capacity ?? null };
      const { data, error } = id ? await sb.from("detention_sessions").update(full).eq("tenant_id", tid).eq("id", id).select("id").maybeSingle()
        : await sb.from("detention_sessions").insert({ ...full, tenant_id: tid }).select("id").single();
      if (error) return fail(error.message);
      if (row.supervisor_id && row.supervisor_id !== ctx.userId) {
        const when = formatInZone(new Date(at), tz);
        const { tellStaff } = await import("@/lib/hr-server");
        await tellStaff(svc, tid, [row.supervisor_id], "detention_duty", "Detention duty", `You are supervising ${row.kind.replace("_", " ")} on ${when.date} at ${when.time}${row.location ? ` in ${row.location}` : ""}.`, `${appUrl(req)}/school/behaviour?tab=detentions`, data?.id);
      }
      return NextResponse.json({ id: data?.id });
    }
    case "delete_session": {
      const { count } = await sb.from("detentions").select("id", { count: "exact", head: true }).eq("session_id", b.id).neq("status", "cancelled");
      if (count) return jsonError("move or cancel the detentions in this session first");
      const { error } = await sb.from("detention_sessions").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "set_detention": {
      if (b.session_id) { const full = await roomFor(b.session_id, b.student_ids.length); if (full) return jsonError(full); }
      const { data, error } = await sb.from("detentions").insert(b.student_ids.map(id => ({ tenant_id: tid, student_id: id, reason: b.reason, session_id: b.session_id ?? null,
        incident_id: b.incident_id ?? null, behaviour_action_id: b.behaviour_action_id ?? null, set_by: ctx.userId }))).select("id,student_id,session_id,reason");
      if (error) return fail(error.message);
      if (b.behaviour_action_id) await sb.from("behaviour_actions").update({ note: "Detention set" }).eq("tenant_id", tid).eq("id", b.behaviour_action_id);
      const told = b.notify_parent ? await tellParents(data ?? []) : 0;
      return NextResponse.json({ created: data?.length ?? 0, parents_told: told }, { status: 201 });
    }
    case "assign": {
      const full = await roomFor(b.session_id, b.ids.length);
      if (full) return jsonError(full);
      const { data, error } = await sb.from("detentions").update({ session_id: b.session_id, status: "scheduled" }).eq("tenant_id", tid).in("id", b.ids).select("id,student_id,session_id,reason");
      if (error) return fail(error.message);
      const told = b.notify_parent ? await tellParents(data ?? []) : 0;
      return NextResponse.json({ moved: data?.length ?? 0, parents_told: told });
    }
    case "mark": {
      const { data, error } = await sb.from("detentions").update({ status: b.status, marked_by: ctx.userId }).eq("tenant_id", tid).eq("id", b.id).select("behaviour_action_id").maybeSingle();
      if (error) return fail(error.message);
      if (b.status === "served" && data?.behaviour_action_id) {
        await sb.from("behaviour_actions").update({ status: "done", resolved_by: ctx.userId, resolved_at: new Date().toISOString(), note: "Detention served" }).eq("tenant_id", tid).eq("id", data.behaviour_action_id);
      }
      return NextResponse.json({ ok: true });
    }
  }
}
