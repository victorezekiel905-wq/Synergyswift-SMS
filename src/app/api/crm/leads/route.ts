import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { STAGES, SOURCES } from "@/lib/crm";
import { upsertLead, setLeadStage, refreshScore, syncLeadFromApplication, brandAndPrincipal } from "@/lib/admissions-crm";
import { notifyContact } from "@/lib/notify";
import { admissionNote } from "@/lib/messaging/notices";
import { appUrl } from "@/lib/school";

/**
 * GET: leads for the board and list (?stage=&source=&owner=me&search=), or
 * one lead in full with ?id= (activities, bookings, application, documents).
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admissions, "admissions");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const tid = ctx.tenant.id;
  const id = u.searchParams.get("id");
  if (id) {
    const { data: lead } = await ctx.sb.from("admission_leads").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!lead) return jsonError("lead not found", 404);
    const [{ data: activities }, { data: bookings }, { data: app }, { data: owner }, { data: referrer }] = await Promise.all([
      ctx.sb.from("lead_activities").select("id,kind,body,due_at,done_at,assigned_to,actor_id,meta,created_at,actor:users!lead_activities_actor_id_fkey(full_name)").eq("lead_id", id).order("created_at", { ascending: false }).limit(200),
      ctx.sb.from("admission_bookings").select("id,status,party_size,created_at,admission_events(title,kind,starts_at)").eq("lead_id", id).order("created_at", { ascending: false }),
      lead.application_id ? ctx.sb.from("applications").select("*,application_documents(id,kind,name,size,uploaded_at),admission_payments(kind,amount,status,paid_at,reference),entrance_attempts(id,status,total_score,max_score,submitted_at,exams(title))").eq("id", lead.application_id).maybeSingle() : Promise.resolve({ data: null }),
      lead.owner_id ? ctx.sb.from("users").select("full_name").eq("id", lead.owner_id).maybeSingle() : Promise.resolve({ data: null }),
      lead.referred_by ? ctx.sb.from("guardians").select("full_name").eq("id", lead.referred_by).maybeSingle() : Promise.resolve({ data: null })
    ]);
    return NextResponse.json({ lead: { ...lead, owner_name: (owner as any)?.full_name ?? null, referred_by_name: (referrer as any)?.full_name ?? null }, activities: activities ?? [], bookings: bookings ?? [], application: app });
  }
  let q = ctx.sb.from("admission_leads").select("id,stage,parent_name,email,phone,child_name,applying_for,intake,source,owner_id,score,next_follow_up_at,last_contact_at,application_id,created_at,updated_at,lost_reason")
    .eq("tenant_id", tid);
  const stage = u.searchParams.get("stage"), source = u.searchParams.get("source"), owner = u.searchParams.get("owner"), search = u.searchParams.get("search");
  if (stage) q = q.eq("stage", stage);
  if (source) q = q.eq("source", source);
  if (owner === "me") q = q.eq("owner_id", ctx.userId); else if (owner) q = q.eq("owner_id", owner);
  if (search) { const s = search.replace(/[%,()]/g, ""); q = q.or(`parent_name.ilike.%${s}%,child_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`); }
  if (u.searchParams.get("include_closed") !== "1" && !stage) q = q.gte("updated_at", new Date(Date.now() - 400 * 86_400_000).toISOString());
  const [{ data: leads, error }, { data: staff }, { data: tasks }] = await Promise.all([
    q.order("updated_at", { ascending: false }).limit(2000),
    ctx.sb.from("users").select("id,full_name,role,extra_roles").eq("tenant_id", tid).eq("active", true),
    ctx.sb.from("lead_activities").select("id,lead_id,body,due_at,assigned_to").eq("tenant_id", tid).eq("kind", "task").is("done_at", null).order("due_at").limit(500)
  ]);
  if (error) return jsonError(error.message);
  const officers = (staff ?? []).filter((x: any) => [x.role, ...(x.extra_roles ?? [])].some((r: string) => ["admissions_officer", "school_admin", "principal"].includes(r)));
  return NextResponse.json({ leads: leads ?? [], staff: officers.map((x: any) => ({ id: x.id, full_name: x.full_name })), tasks: tasks ?? [], me: ctx.userId });
}

const opt = (s: z.ZodTypeAny) => s.nullish().or(z.literal(""));
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), parent_name: z.string().trim().min(2).max(120), email: opt(z.string().trim().email()), phone: opt(z.string().trim().min(5).max(30)),
    child_name: opt(z.string().trim().max(120)), child_dob: opt(z.string().date()), applying_for: opt(z.string().trim().max(60)), intake: opt(z.string().trim().max(60)),
    source: z.enum(SOURCES), notes: opt(z.string().trim().max(2000)), owner_id: opt(z.string().uuid()), referral_code: opt(z.string().trim().max(20)) }),
  z.object({ action: z.literal("update"), id: z.string().uuid(), parent_name: z.string().trim().min(2).max(120).optional(), email: opt(z.string().trim().email()), phone: opt(z.string().trim().min(5).max(30)),
    child_name: opt(z.string().trim().max(120)), child_dob: opt(z.string().date()), applying_for: opt(z.string().trim().max(60)), intake: opt(z.string().trim().max(60)),
    source: z.enum(SOURCES).optional(), notes: opt(z.string().trim().max(4000)), owner_id: opt(z.string().uuid()), next_follow_up_at: opt(z.string().datetime({ offset: true })) }),
  z.object({ action: z.literal("stage"), id: z.string().uuid(), stage: z.enum(STAGES), note: opt(z.string().trim().max(1000)) }),
  z.object({ action: z.literal("log"), id: z.string().uuid(), kind: z.enum(["note", "call", "email", "sms", "whatsapp", "meeting"]), body: z.string().trim().min(1).max(4000) }),
  z.object({ action: z.literal("task"), id: z.string().uuid(), body: z.string().trim().min(1).max(500), due_at: z.string().datetime({ offset: true }), assigned_to: opt(z.string().uuid()) }),
  z.object({ action: z.literal("task_done"), task_id: z.string().uuid(), done: z.boolean().default(true) }),
  z.object({ action: z.literal("message"), id: z.string().uuid(), channel: z.enum(["email", "sms", "whatsapp"]), subject: opt(z.string().trim().max(160)), body: z.string().trim().min(2).max(2000) }),
  z.object({ action: z.literal("start_application"), id: z.string().uuid(), first_name: z.string().trim().min(1).max(60), last_name: z.string().trim().min(1).max(60),
    applying_for: z.string().trim().min(1).max(60), gender: z.enum(["male", "female", "other"]).nullish() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admissions, "admissions");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const base = appUrl(req);
  const blank = <T,>(v: T | "" | null | undefined) => (v === "" || v === undefined ? null : v);
  const firstContact = async (id: string) => {
    const now = new Date().toISOString();
    await ctx.sb.from("admission_leads").update({ last_contact_at: now, updated_at: now }).eq("tenant_id", tid).eq("id", id);
    await ctx.sb.from("admission_leads").update({ first_response_at: now }).eq("tenant_id", tid).eq("id", id).is("first_response_at", null);
  };
  try {
    switch (b.action) {
      case "create": {
        const r = await upsertLead(svc, tid, { parent_name: b.parent_name, email: blank(b.email), phone: blank(b.phone), child_name: blank(b.child_name), child_dob: blank(b.child_dob),
          applying_for: blank(b.applying_for), intake: blank(b.intake), source: b.source, notes: blank(b.notes), owner_id: blank(b.owner_id) ?? ctx.userId, referral_code: blank(b.referral_code), consent: true }, ctx.userId, base);
        // A walk-in or call taken by staff is a first contact already.
        if (["walk_in", "phone"].includes(b.source)) await firstContact(r.id);
        return NextResponse.json(r, { status: 201 });
      }
      case "update": {
        const { action: _a, id, ...rest } = b;
        const row = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === "" ? null : v]));
        const { error } = await ctx.sb.from("admission_leads").update({ ...row, updated_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", id);
        if (error) return jsonError(error.message);
        await refreshScore(svc, tid, id);
        return NextResponse.json({ ok: true });
      }
      case "stage": {
        if (b.stage === "lost" && !b.note) return jsonError("say why the family did not go ahead");
        const { data: lead } = await ctx.sb.from("admission_leads").select("application_id").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
        if (!lead) return jsonError("lead not found", 404);
        // Stages after "applied" follow the application; move it from the application instead.
        if (lead.application_id && ["applied", "assessed", "offered", "accepted", "enrolled"].includes(b.stage)) return jsonError("this family has an application: change its status under Applications and the pipeline follows");
        if (!lead.application_id && ["assessed", "offered", "accepted", "enrolled"].includes(b.stage)) return jsonError("start an application for this family first");
        await setLeadStage(svc, tid, b.id, b.stage, ctx.userId, blank(b.note));
        return NextResponse.json({ ok: true });
      }
      case "log": {
        await ctx.sb.from("lead_activities").insert({ tenant_id: tid, lead_id: b.id, kind: b.kind, body: b.body, actor_id: ctx.userId });
        if (b.kind !== "note") await firstContact(b.id);
        await refreshScore(svc, tid, b.id);
        return NextResponse.json({ ok: true });
      }
      case "task": {
        const { error } = await ctx.sb.from("lead_activities").insert({ tenant_id: tid, lead_id: b.id, kind: "task", body: b.body, due_at: b.due_at, assigned_to: blank(b.assigned_to) ?? ctx.userId, actor_id: ctx.userId });
        if (error) return jsonError(error.message);
        await ctx.sb.from("admission_leads").update({ next_follow_up_at: b.due_at }).eq("tenant_id", tid).eq("id", b.id);
        return NextResponse.json({ ok: true });
      }
      case "task_done": {
        const { error } = await ctx.sb.from("lead_activities").update({ done_at: b.done ? new Date().toISOString() : null }).eq("tenant_id", tid).eq("id", b.task_id).eq("kind", "task");
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "message": {
        const { data: lead } = await ctx.sb.from("admission_leads").select("*").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
        if (!lead) return jsonError("lead not found", 404);
        if (b.channel === "email" ? !lead.email : !lead.phone) return jsonError(`this family has no ${b.channel === "email" ? "email address" : "phone number"} on file`);
        const { brand } = await brandAndPrincipal(svc, tid);
        const n = await notifyContact(svc, { tenantId: tid, name: lead.parent_name, email: b.channel === "email" ? lead.email : null, phone: b.channel !== "email" ? lead.phone : null,
          kind: "admissions_message", refId: lead.id, build: () => admissionNote(brand, { name: lead.parent_name, subject: blank(b.subject) ?? `${brand.schoolName} admissions`, lines: b.body.split(/\n+/).filter(Boolean) }) });
        await ctx.sb.from("lead_activities").insert({ tenant_id: tid, lead_id: lead.id, kind: b.channel, body: b.body, actor_id: ctx.userId, meta: { queued: n } });
        await firstContact(lead.id);
        return NextResponse.json({ ok: true, queued: n });
      }
      case "start_application": {
        const { data: lead } = await ctx.sb.from("admission_leads").select("*").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
        if (!lead) return jsonError("lead not found", 404);
        if (lead.application_id) return jsonError("this family already has an application");
        if (!lead.phone) return jsonError("add the parent's phone number first");
        const { data: no } = await svc.rpc("next_doc_no", { p_tenant: tid, p_kind: "app" });
        const { data: app, error } = await ctx.sb.from("applications").insert({ tenant_id: tid, application_no: no, first_name: b.first_name, last_name: b.last_name, gender: b.gender ?? null,
          date_of_birth: lead.child_dob, applying_for: b.applying_for, guardian_name: lead.parent_name, guardian_email: lead.email, guardian_phone: lead.phone,
          source: ["walk_in", "referral", "agent", "website", "whatsapp", "facebook", "instagram", "phone", "open_day", "email"].includes(lead.source) ? lead.source : "other",
          utm: lead.utm ?? {}, referral_code: lead.referral_code, lead_id: lead.id }).select("*").single();
        if (error) return jsonError(error.message);
        await ctx.sb.from("admission_leads").update({ application_id: app.id }).eq("id", lead.id);
        await syncLeadFromApplication(svc, app);
        return NextResponse.json({ application_id: app.id, application_no: app.application_no, tracking_link: `${base}/apply/track/${app.tracking_token}` }, { status: 201 });
      }
      case "delete": {
        if (!ROLES.admin.some(r => ctx.roles.has(r))) return jsonError("only admins can delete leads", 403);
        const { error } = await ctx.sb.from("admission_leads").delete().eq("tenant_id", tid).eq("id", b.id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
    }
  } catch (e) { return jsonError((e as Error).message); }
}
