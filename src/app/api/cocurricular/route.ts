import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { studentName } from "@/lib/school";
import { localParts } from "@/lib/attendance";
import { attendanceRate, achievementFor, rosterFromResponses, rosterSummary, ACHIEVEMENT_LEVEL, ACHIEVEMENT_KIND } from "@/lib/cocurricular";
import { setClubFee, tellTripParents } from "@/lib/cocurricular-server";
import { tellStaff } from "@/lib/hr-server";

export const dynamic = "force-dynamic";

const STUDENT = "first_name,last_name,other_names,admission_no,class_group_id,class_groups(name)";

/**
 * Clubs and teams, competitions and trips (staff).
 * GET ?view=groups | group&id= | competitions | competition&id= | trips | trip&id=
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "events");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const view = u.get("view") ?? "groups";
  const tid = ctx.tenant.id, sb = ctx.sb, admin = hasAny(ctx, ROLES.admin);

  if (view === "students") {
    const { data } = await sb.from("students").select("id,first_name,last_name,other_names,admission_no").eq("tenant_id", tid).eq("class_group_id", u.get("class_id") ?? "").eq("status", "active").order("last_name");
    return NextResponse.json((data ?? []).map((s: any) => ({ id: s.id, name: studentName(s), admission_no: s.admission_no })));
  }
  if (view === "groups") {
    const svc = createServiceClient();
    const [{ data: groups }, { data: members }, staff, { data: classes }, { data: fees }] = await Promise.all([
      sb.from("cc_groups").select("*").eq("tenant_id", tid).order("name"),
      sb.from("cc_members").select("group_id,status").eq("tenant_id", tid).in("status", ["active", "requested"]),
      svc.from("users").select("id,full_name").eq("tenant_id", tid).eq("active", true).neq("role", "parent").neq("role", "student").order("full_name"),
      sb.from("class_groups").select("id,name").eq("tenant_id", tid).order("name"),
      admin ? svc.from("fee_items").select("id,name").eq("tenant_id", tid).order("name") : Promise.resolve({ data: [] })
    ]);
    const nm = new Map((staff.data ?? []).map((s: any) => [s.id, s.full_name]));
    return NextResponse.json({ admin, me: ctx.userId, staff: staff.data ?? [], classes: classes ?? [], fee_items: fees ?? [],
      groups: (groups ?? []).map((g: any) => ({ ...g, lead_name: nm.get(g.lead_id) ?? null, members: (members ?? []).filter((m: any) => m.group_id === g.id && m.status === "active").length,
        requests: (members ?? []).filter((m: any) => m.group_id === g.id && m.status === "requested").length, mine: admin || g.lead_id === ctx.userId || (g.assistant_ids ?? []).includes(ctx.userId) })) });
  }
  if (view === "group") {
    const id = u.get("id") ?? "";
    const [{ data: g }, { data: members }, { data: sessions }] = await Promise.all([
      sb.from("cc_groups").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle(),
      sb.from("cc_members").select(`student_id,role,status,joined_on,requested_at,students(${STUDENT})`).eq("group_id", id).in("status", ["active", "requested"]),
      sb.from("cc_sessions").select("id,held_on,kind,notes,cc_attendance(student_id,status)").eq("group_id", id).order("held_on", { ascending: false }).limit(60)
    ]);
    if (!g) return jsonError("not found", 404);
    const marks = (sessions ?? []).flatMap((s: any) => s.cc_attendance ?? []);
    return NextResponse.json({ group: g, can_manage: admin || g.lead_id === ctx.userId || (g.assistant_ids ?? []).includes(ctx.userId),
      members: (members ?? []).map((m: any) => ({ ...m, name: studentName(m.students), class: m.students?.class_groups?.name ?? null, rate: attendanceRate(marks.filter((x: any) => x.student_id === m.student_id)), students: undefined }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name)),
      sessions: (sessions ?? []).map((s: any) => ({ id: s.id, held_on: s.held_on, kind: s.kind, notes: s.notes, marks: s.cc_attendance ?? [] })) });
  }
  if (view === "competitions") {
    const { data } = await sb.from("competitions").select("*,cc_groups(name),competition_entries(id,position,award)").eq("tenant_id", tid).order("held_on", { ascending: false }).limit(200);
    return NextResponse.json((data ?? []).map((c: any) => ({ ...c, entries: (c.competition_entries ?? []).length, podium: (c.competition_entries ?? []).filter((e: any) => e.position && e.position <= 3).length, competition_entries: undefined })));
  }
  if (view === "competition") {
    const [{ data: c }, { data: entries }] = await Promise.all([
      sb.from("competitions").select("*").eq("tenant_id", tid).eq("id", u.get("id") ?? "").maybeSingle(),
      sb.from("competition_entries").select(`*,students(${STUDENT})`).eq("tenant_id", tid).eq("competition_id", u.get("id") ?? "").order("event").order("position", { nullsFirst: false })
    ]);
    if (!c) return jsonError("not found", 404);
    return NextResponse.json({ competition: c, entries: (entries ?? []).map((e: any) => ({ ...e, name: studentName(e.students), class: e.students?.class_groups?.name ?? null, students: undefined })) });
  }
  if (view === "trips") {
    const { data } = await sb.from("school_events").select("id,title,starts_at,departs_at,returns_at,location,fee,capacity,requires_consent,staff_ids,trip_roster(status),event_responses(consent)")
      .eq("tenant_id", tid).eq("kind", "trip").gte("starts_at", new Date(Date.now() - 30 * 86_400_000).toISOString()).order("starts_at");
    return NextResponse.json((data ?? []).map((e: any) => ({ ...e, consented: (e.event_responses ?? []).filter((r: any) => r.consent).length, roster: rosterSummary(e.trip_roster ?? []),
      on_staff: admin || (e.staff_ids ?? []).includes(ctx.userId), trip_roster: undefined, event_responses: undefined })));
  }
  if (view === "trip") {
    const id = u.get("id") ?? "";
    const svc = createServiceClient();
    const [{ data: e }, { data: roster }, { data: responses }] = await Promise.all([
      sb.from("school_events").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle(),
      sb.from("trip_roster").select(`student_id,status,departed_at,returned_at,note,students(${STUDENT})`).eq("event_id", id),
      sb.from("event_responses").select(`student_id,consent,invoice_id,fee_invoices(status),students(${STUDENT})`).eq("event_id", id)
    ]);
    if (!e) return jsonError("not found", 404);
    const ids = [...new Set([...(roster ?? []).map((r: any) => r.student_id), ...(responses ?? []).map((r: any) => r.student_id)])];
    const { data: med } = ids.length ? await svc.from("medical_profiles").select("student_id,allergies,conditions,medications").in("student_id", ids) : { data: [] };
    const medBy = new Map((med ?? []).map((m: any) => [m.student_id, m]));
    const consent = rosterFromResponses((responses ?? []).map((r: any) => ({ student_id: r.student_id, consent: r.consent, invoice_status: r.fee_invoices?.status ?? null })), Number(e.fee));
    const payBy = new Map(consent.map(c => [c.student_id, c]));
    const { data: staff } = await svc.from("users").select("id,full_name").eq("tenant_id", tid).eq("active", true).neq("role", "parent").neq("role", "student").order("full_name");
    return NextResponse.json({
      event: e, staff: staff ?? [], admin, can_manage: admin || (e.staff_ids ?? []).includes(ctx.userId),
      responses: (responses ?? []).map((r: any) => ({ student_id: r.student_id, consent: r.consent, name: studentName(r.students), class: r.students?.class_groups?.name ?? null, paid: payBy.get(r.student_id)?.paid ?? false })),
      roster: (roster ?? []).map((r: any) => { const m: any = medBy.get(r.student_id); return { ...r, name: studentName(r.students), class: r.students?.class_groups?.name ?? null, paid: payBy.get(r.student_id)?.paid ?? (Number(e.fee) <= 0),
        medical: [m?.allergies && `Allergies: ${m.allergies}`, m?.conditions && `Conditions: ${m.conditions}`, m?.medications && `Medication: ${m.medications}`].filter(Boolean).join(" · ") || null, students: undefined }; })
        .sort((a: any, b: any) => a.name.localeCompare(b.name)),
      summary: rosterSummary(roster ?? [])
    });
  }
  return jsonError("unknown view", 404);
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = (n: number) => z.string().trim().max(n).nullish().transform(v => v || null);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_group"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(120), kind: z.enum(["club", "society", "sport", "team", "choir", "band", "drama", "other"]),
    description: opt(2000), meets: opt(120), location: opt(120), capacity: z.number().int().min(1).max(2000).nullish(), lead_id: z.string().uuid().nullish(), assistant_ids: z.array(z.string().uuid()).max(10).default([]),
    open_to_class_ids: z.array(z.string().uuid()).max(100).default([]), joining: z.enum(["open", "approval", "closed"]), fee_item_id: z.string().uuid().nullish(), active: z.boolean().default(true) }),
  z.object({ action: z.literal("add_members"), group_id: z.string().uuid(), student_ids: z.array(z.string().uuid()).min(1).max(500) }),
  z.object({ action: z.literal("member"), group_id: z.string().uuid(), student_id: z.string().uuid(), status: z.enum(["active", "left", "declined"]).optional(), role: z.enum(["member", "captain", "vice_captain", "secretary", "treasurer", "other"]).optional() }),
  z.object({ action: z.literal("session"), group_id: z.string().uuid(), held_on: date, kind: z.enum(["meeting", "training", "rehearsal", "match", "performance", "other"]), notes: opt(1000),
    marks: z.array(z.object({ student_id: z.string().uuid(), status: z.enum(["present", "absent", "late", "excused"]) })).max(2000) }),
  z.object({ action: z.literal("save_competition"), id: z.string().uuid().optional(), title: z.string().trim().min(2).max(160), kind: z.enum(["sports", "academic", "arts", "debate", "quiz", "other"]),
    level: z.enum(["house", "school", "local", "state", "national", "international"]), held_on: date, venue: opt(160), organiser: opt(160), group_id: z.string().uuid().nullish(), notes: opt(2000) }),
  z.object({ action: z.literal("entries"), competition_id: z.string().uuid(), entries: z.array(z.object({ id: z.string().uuid().optional(), student_id: z.string().uuid(), event: opt(80), team_name: opt(80),
    position: z.number().int().min(1).max(1000).nullish(), score: opt(40), award: opt(120), notes: opt(300) })).max(500) }),
  z.object({ action: z.literal("trip_setup"), id: z.string().uuid(), departs_at: z.string().datetime({ offset: true }).nullish(), returns_at: z.string().datetime({ offset: true }).nullish(),
    meeting_point: opt(160), staff_ids: z.array(z.string().uuid()).max(30), risk_assessment: opt(8000), emergency_contact: opt(160) }),
  z.object({ action: z.literal("build_roster"), id: z.string().uuid(), include_unpaid: z.boolean().default(false) }),
  z.object({ action: z.literal("roster"), id: z.string().uuid(), student_ids: z.array(z.string().uuid()).min(1).max(500), status: z.enum(["going", "departed", "returned", "absent", "cancelled"]), tell_parents: z.boolean().default(false) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "events");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, sb = ctx.sb, svc = createServiceClient();
  const fail = (m: string) => jsonError(m.includes("row-level security") ? "only the group's leaders (or admins) can do that" : m);
  const today = localParts(new Date(), ctx.tenant.timezone).date;

  switch (b.action) {
    case "save_group": {
      const { action: _a, id, ...row } = b;
      const full: Record<string, unknown> = { ...row, lead_id: row.lead_id ?? null, fee_item_id: row.fee_item_id ?? null, capacity: row.capacity ?? null };
      // Leads keep their group running; leadership and the fee stay with admins.
      if (!hasAny(ctx, ROLES.admin)) { delete full.lead_id; delete full.assistant_ids; delete full.fee_item_id; }
      const { data, error } = id ? await sb.from("cc_groups").update(full).eq("tenant_id", tid).eq("id", id).select("id").maybeSingle()
        : await sb.from("cc_groups").insert({ ...full, tenant_id: tid }).select("id").single();
      if (error) return fail(error.message.includes("duplicate") ? "a group with that name exists" : error.message.includes("row-level") ? "only admins create groups" : error.message);
      if (!data) return jsonError("not found or not yours to change", 404);
      if (row.lead_id && row.lead_id !== ctx.userId && !id) await tellStaff(svc, tid, [row.lead_id], "club", `You lead ${row.name}`, `You have been made the lead for ${row.name}. Add members and take attendance under Activities.`, "/school/activities", data.id);
      return NextResponse.json({ id: data.id });
    }
    case "add_members": {
      const { data: g } = await sb.from("cc_groups").select("fee_item_id").eq("tenant_id", tid).eq("id", b.group_id).maybeSingle();
      const { error } = await sb.from("cc_members").upsert(b.student_ids.map(s => ({ group_id: b.group_id, tenant_id: tid, student_id: s, status: "active", joined_on: today })), { onConflict: "group_id,student_id" });
      if (error) return fail(error.message);
      for (const s of b.student_ids) await setClubFee(svc, tid, s, g?.fee_item_id ?? null, true);
      return NextResponse.json({ ok: true });
    }
    case "member": {
      const patch: Record<string, unknown> = {};
      if (b.status) Object.assign(patch, { status: b.status, ...(b.status === "active" ? { joined_on: today, left_on: null } : b.status === "left" ? { left_on: today } : {}) });
      if (b.role) patch.role = b.role;
      const { data, error } = await sb.from("cc_members").update(patch).eq("tenant_id", tid).eq("group_id", b.group_id).eq("student_id", b.student_id).select("status").maybeSingle();
      if (error) return fail(error.message);
      if (!data) return jsonError("not found or not yours to change", 404);
      if (b.status) {
        const { data: g } = await sb.from("cc_groups").select("name,fee_item_id").eq("id", b.group_id).maybeSingle();
        await setClubFee(svc, tid, b.student_id, g?.fee_item_id ?? null, b.status === "active");
        if (b.status === "active" || b.status === "declined") {
          const { data: st } = await svc.from("students").select("user_id").eq("id", b.student_id).maybeSingle();
          if (st?.user_id) await tellStaff(svc, tid, [st.user_id], "club", g?.name ?? "Club", b.status === "active" ? `You are now a member of ${g?.name}.` : `Your request to join ${g?.name} was not accepted this time.`, "/student", b.group_id);
        }
      }
      return NextResponse.json({ ok: true });
    }
    case "session": {
      const { data: s, error } = await sb.from("cc_sessions").upsert({ tenant_id: tid, group_id: b.group_id, held_on: b.held_on, kind: b.kind, notes: b.notes, created_by: ctx.userId }, { onConflict: "group_id,held_on,kind" }).select("id").single();
      if (error) return fail(error.message);
      if (b.marks.length) {
        const { error: e2 } = await sb.from("cc_attendance").upsert(b.marks.map(m => ({ session_id: s.id, tenant_id: tid, student_id: m.student_id, status: m.status })), { onConflict: "session_id,student_id" });
        if (e2) return fail(e2.message);
      }
      return NextResponse.json({ id: s.id });
    }
    case "save_competition": {
      const { action: _a, id, ...row } = b;
      const full = { ...row, group_id: row.group_id ?? null };
      const { data, error } = id ? await sb.from("competitions").update(full).eq("tenant_id", tid).eq("id", id).select("id").maybeSingle()
        : await sb.from("competitions").insert({ ...full, tenant_id: tid, created_by: ctx.userId }).select("id").single();
      if (error) return fail(error.message);
      return NextResponse.json({ id: data?.id });
    }
    case "entries": {
      const { data: c } = await sb.from("competitions").select("id,title,kind,level,held_on").eq("tenant_id", tid).eq("id", b.competition_id).maybeSingle();
      if (!c) return jsonError("competition not found", 404);
      let achievements = 0;
      for (const e of b.entries) {
        const row = { tenant_id: tid, competition_id: c.id, student_id: e.student_id, event: e.event, team_name: e.team_name, position: e.position ?? null, score: e.score, award: e.award, notes: e.notes };
        const { data: saved, error } = e.id ? await sb.from("competition_entries").update(row).eq("tenant_id", tid).eq("id", e.id).select("id,achievement_id").maybeSingle()
          : await sb.from("competition_entries").insert(row).select("id,achievement_id").single();
        if (error) return fail(error.message.includes("duplicate") ? "a student is entered twice for the same event" : error.message);
        // Podium places and awards go on the student's record of achievements (once).
        const award = achievementFor({ position: e.position ?? null, award: e.award });
        if (award && saved && !saved.achievement_id) {
          const { data: a } = await svc.from("student_achievements").insert({ tenant_id: tid, student_id: e.student_id, kind: ACHIEVEMENT_KIND[c.kind] ?? "competition", level: ACHIEVEMENT_LEVEL[c.level] ?? "school",
            title: `${c.title}${e.event ? `: ${e.event}` : ""}`.slice(0, 160), award, achieved_on: c.held_on, recorded_by: ctx.userId }).select("id").single();
          if (a) { await svc.from("competition_entries").update({ achievement_id: a.id }).eq("id", saved.id); achievements++; }
        }
      }
      return NextResponse.json({ ok: true, achievements });
    }
    case "trip_setup": {
      if (!hasAny(ctx, ROLES.admin)) return jsonError("only admins set up trips", 403);
      const { action: _a, id, ...row } = b;
      if (row.departs_at && row.returns_at && row.returns_at <= row.departs_at) return jsonError("the return is before departure");
      const { error } = await sb.from("school_events").update({ ...row, late_alerted_at: null }).eq("tenant_id", tid).eq("id", id).eq("kind", "trip");
      if (error) return fail(error.message);
      await tellStaff(svc, tid, row.staff_ids.filter(s => s !== ctx.userId), "trip", "You are on a trip", "You have been added to the staff for a school trip. The roster and medical notes are under Activities → Trips.", `/school/activities?tab=trips&trip=${id}`, id);
      return NextResponse.json({ ok: true });
    }
    case "build_roster": {
      const { data: e } = await sb.from("school_events").select("id,fee").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
      if (!e) return jsonError("trip not found", 404);
      const { data: responses } = await sb.from("event_responses").select("student_id,consent,fee_invoices(status)").eq("event_id", e.id);
      const going = rosterFromResponses((responses ?? []).map((r: any) => ({ student_id: r.student_id, consent: r.consent, invoice_status: r.fee_invoices?.status ?? null })), Number(e.fee))
        .filter(r => b.include_unpaid || r.paid);
      if (!going.length) return jsonError("nobody has consent (and payment) yet");
      const { error } = await sb.from("trip_roster").upsert(going.map(g => ({ event_id: e.id, tenant_id: tid, student_id: g.student_id })), { onConflict: "event_id,student_id", ignoreDuplicates: true });
      return error ? fail(error.message.includes("row-level") ? "only trip staff or admins can do that" : error.message) : NextResponse.json({ added: going.length });
    }
    case "roster": {
      const { error } = await sb.from("trip_roster").upsert(b.student_ids.map(s => ({ event_id: b.id, tenant_id: tid, student_id: s, status: b.status })), { onConflict: "event_id,student_id" });
      if (error) return fail(error.message.includes("row-level") ? "only trip staff or admins can do that" : error.message);
      const told = b.tell_parents && (b.status === "departed" || b.status === "returned") ? await tellTripParents(svc, tid, b.id, b.student_ids, b.status, ctx.tenant.timezone) : 0;
      return NextResponse.json({ ok: true, parents_told: told });
    }
  }
}
