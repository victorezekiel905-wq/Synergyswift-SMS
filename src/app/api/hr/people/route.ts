import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { localParts } from "@/lib/attendance";
import { dueSoon, profileGaps, pipeline, LEAVE_TYPES, policyFor, type Stage } from "@/lib/hr";
import { balancesFor, leavePolicies, ensureTemplates, startChecklist, tellStaff } from "@/lib/hr-server";

export const dynamic = "force-dynamic";

const PERSONAL = "staff_id,date_of_birth,gender,marital_status,address,state_of_origin,nationality,nin,tin,pfa_name,rsa_pin,nhf_number,next_of_kin_name,next_of_kin_relation,next_of_kin_phone,emergency_contact_name,emergency_contact_phone,medical_notes,updated_at";

/**
 * Staff records and people processes.
 * GET ?view=profile[&staff=]   one person's record (HR: anyone; staff: themselves)
 * GET ?view=overview           HR: what needs attention (contracts, probation, licences, gaps, checklists, leave, recruitment)
 * GET ?view=checklists         checklists the signed-in user can see, with their items
 * GET ?view=templates          HR: checklist templates
 * GET ?view=policies           leave policies (every type, defaults filled in)
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const view = u.get("view") ?? "profile";
  const tid = ctx.tenant.id, sb = ctx.sb, svc = createServiceClient();
  const hr = hasAny(ctx, ROLES.hr);
  const today = localParts(new Date(), ctx.tenant.timezone).date;

  if (view === "profile") {
    let staffId = u.get("staff");
    const { data: mine } = await sb.from("staff").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
    if (!staffId) staffId = mine?.id ?? null;
    if (!staffId) return jsonError("no staff record is linked to your account; ask HR", 404);
    if (!hr && staffId !== mine?.id) return jsonError("forbidden", 403);
    const [staff, personal, docs, contracts, quals, lists, salary, team] = await Promise.all([
      sb.from("staff").select("id,staff_no,full_name,email,phone,department,position,employment_type,hire_date,status,leave_allowance,user_id,line_manager_id,probation_ends_on,exit_date,exit_reason,manager:line_manager_id(full_name)")
        .eq("tenant_id", tid).eq("id", staffId).maybeSingle(),
      sb.from("staff_personal").select(PERSONAL).eq("staff_id", staffId).maybeSingle(),
      sb.from("staff_documents").select("id,kind,title,mime,size_bytes,visible_to_staff,created_at").eq("staff_id", staffId).order("created_at", { ascending: false }),
      sb.from("staff_contracts").select("id,kind,position,starts_on,ends_on,probation_ends_on,notice_days,salary_note,notes,document_id,status,accepted_at,created_at").eq("staff_id", staffId).order("starts_on", { ascending: false }),
      sb.from("staff_qualifications").select("id,kind,title,institution,awarded_on,expires_on,reference_no,document_id,verified_at").eq("staff_id", staffId).order("awarded_on", { ascending: false, nullsFirst: false }),
      sb.from("staff_checklists").select("id,kind,name,started_on,completed_at,staff_checklist_items(id,position,label,owner,due_on,done_at,note)").eq("staff_id", staffId).order("started_on", { ascending: false }),
      hr ? svc.from("salary_profiles").select("staff_id").eq("staff_id", staffId).maybeSingle() : Promise.resolve({ data: undefined }),
      hr ? sb.from("staff").select("id,full_name").eq("tenant_id", tid).neq("status", "exited").order("full_name") : Promise.resolve({ data: [] })
    ]);
    if (!staff.data) return jsonError("staff not found", 404);
    const balances = await balancesFor(svc, tid, staffId, today);
    const gaps = profileGaps({ email: staff.data.email, phone: staff.data.phone, personal: personal.data, documents: docs.data ?? [], contracts: contracts.data ?? [],
      hasSalaryProfile: salary.data === undefined ? undefined : Boolean(salary.data) });
    return NextResponse.json({ staff: staff.data, personal: personal.data, documents: docs.data ?? [], contracts: contracts.data ?? [], qualifications: quals.data ?? [],
      checklists: (lists.data ?? []).map((c: any) => ({ ...c, items: (c.staff_checklist_items ?? []).sort((a: any, b: any) => a.position - b.position), staff_checklist_items: undefined })),
      balances, gaps, can_edit: hr, is_self: staffId === mine?.id, team: team.data ?? [], is_admin: hasAny(ctx, ROLES.admin) });
  }

  if (view === "overview") {
    if (!hr) return jsonError("forbidden", 403);
    const [staff, contracts, quals, personal, docs, lists, leave, apps, salary] = await Promise.all([
      svc.from("staff").select("id,full_name,email,phone,status,probation_ends_on").eq("tenant_id", tid),
      svc.from("staff_contracts").select("staff_id,kind,ends_on,status").eq("tenant_id", tid),
      svc.from("staff_qualifications").select("staff_id,title,expires_on").eq("tenant_id", tid).not("expires_on", "is", null),
      svc.from("staff_personal").select(PERSONAL).eq("tenant_id", tid),
      svc.from("staff_documents").select("staff_id,kind").eq("tenant_id", tid),
      svc.from("staff_checklists").select("id,staff_id,kind,name,started_on,completed_at,staff(full_name),staff_checklist_items(done_at,due_on)").eq("tenant_id", tid).is("completed_at", null),
      svc.from("leave_requests").select("id,status,starts_on,ends_on,leave_type,manager_status,staff(full_name)").eq("tenant_id", tid).in("status", ["pending", "approved"]).gte("ends_on", today),
      svc.from("job_applications").select("stage,job_postings!inner(status)").eq("tenant_id", tid).eq("job_postings.status", "open"),
      svc.from("salary_profiles").select("staff_id").eq("tenant_id", tid)
    ]);
    const people = (staff.data ?? []).filter((s: any) => s.status !== "exited");
    const alerts = dueSoon({ today, within: 45, staff: staff.data ?? [], contracts: contracts.data ?? [], qualifications: quals.data ?? [] });
    const pBy = new Map<string, Record<string, unknown>>((personal.data ?? []).map((p: any) => [p.staff_id, p]));
    const sal = new Set((salary.data ?? []).map((s: any) => s.staff_id));
    const gaps = people.map((s: any) => ({ staff_id: s.id, full_name: s.full_name,
      gaps: profileGaps({ email: s.email, phone: s.phone, personal: pBy.get(s.id) ?? null, documents: (docs.data ?? []).filter((d: any) => d.staff_id === s.id),
        contracts: (contracts.data ?? []).filter((c: any) => c.staff_id === s.id), hasSalaryProfile: sal.has(s.id) }) })).filter((g: any) => g.gaps.length).sort((a: any, b: any) => b.gaps.length - a.gaps.length);
    return NextResponse.json({
      today, headcount: people.length, alerts, gaps,
      checklists: (lists.data ?? []).map((c: any) => { const items = c.staff_checklist_items ?? []; return { id: c.id, staff_id: c.staff_id, name: c.name, kind: c.kind, staff_name: c.staff?.full_name, started_on: c.started_on,
        done: items.filter((i: any) => i.done_at).length, total: items.length, overdue: items.filter((i: any) => !i.done_at && i.due_on && i.due_on < today).length }; }),
      away: (leave.data ?? []).filter((l: any) => l.status === "approved" && l.starts_on <= today).map((l: any) => ({ name: l.staff?.full_name, leave_type: l.leave_type, until: l.ends_on })),
      pending_leave: (leave.data ?? []).filter((l: any) => l.status === "pending").length,
      recruitment: pipeline((apps.data ?? []) as { stage: Stage }[])
    });
  }

  if (view === "checklists") {
    const { data: me } = await sb.from("staff").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
    const { data } = await sb.from("staff_checklists").select("id,staff_id,kind,name,started_on,completed_at,staff(full_name,line_manager_id),staff_checklist_items(id,position,label,owner,due_on,done_at,note)")
      .eq("tenant_id", tid).order("completed_at", { ascending: true, nullsFirst: true }).order("started_on", { ascending: false }).limit(200);
    // Mirrors can_tick_item() in the database, which has the final say.
    const canTick = (owner: string, c: any) => hr || (owner === "staff" ? c.staff_id === me?.id : owner === "line_manager" ? Boolean(me?.id) && c.staff?.line_manager_id === me?.id : ctx.roles.has(owner));
    const lists: any[] = (data ?? []).map((c: any) => ({ id: c.id, staff_id: c.staff_id, staff_name: c.staff?.full_name, kind: c.kind, name: c.name, started_on: c.started_on, completed_at: c.completed_at,
      items: (c.staff_checklist_items ?? []).sort((x: any, y: any) => x.position - y.position).map((i: any) => ({ ...i, can_tick: canTick(i.owner, c) })) }));
    const openForMe = lists.flatMap(l => l.completed_at ? [] : l.items.filter((i: any) => !i.done_at && i.can_tick && (hr ? i.owner === "hr_manager" : true))).length;
    return NextResponse.json({ hr, me: me?.id ?? null, open_for_me: openForMe, checklists: lists });
  }

  if (view === "templates") {
    if (!hr) return jsonError("forbidden", 403);
    return NextResponse.json({ templates: await ensureTemplates(svc, tid) });
  }

  if (view === "policies") {
    const saved = await leavePolicies(svc, tid);
    return NextResponse.json({ policies: LEAVE_TYPES.map(t => ({ ...policyFor(t, saved, 0), saved: saved.some(p => p.leave_type === t), annual_uses_allowance: t === "annual" && !saved.find(p => p.leave_type === "annual")?.days_per_year })), can_edit: hr });
  }
  return jsonError("unknown view", 404);
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = (n: number) => z.string().trim().max(n).nullish().transform(v => v || null);
const owner = z.string().regex(/^[a-z_]{2,40}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_personal"), staff_id: z.string().uuid().optional(), date_of_birth: date.nullish().or(z.literal("")).transform(v => v || null),
    gender: z.enum(["female", "male", "other"]).nullish().or(z.literal("")).transform(v => v || null), marital_status: opt(30), address: opt(300), state_of_origin: opt(40), nationality: opt(40),
    nin: z.string().trim().regex(/^\d{11}$/, "NIN is 11 digits").nullish().or(z.literal("")).transform(v => v || null), tin: opt(30), pfa_name: opt(80),
    rsa_pin: z.string().trim().regex(/^PEN\d{12}$/i, "RSA PIN looks like PEN followed by 12 digits").nullish().or(z.literal("")).transform(v => v ? v.toUpperCase() : null),
    nhf_number: opt(30), next_of_kin_name: opt(120), next_of_kin_relation: opt(40), next_of_kin_phone: opt(30), emergency_contact_name: opt(120), emergency_contact_phone: opt(30), medical_notes: opt(1000) }),
  z.object({ action: z.literal("save_contract"), id: z.string().uuid().optional(), staff_id: z.string().uuid(), kind: z.enum(["permanent", "fixed_term", "probation", "part_time", "consultancy", "internship"]),
    position: opt(120), starts_on: date, ends_on: date.nullish().or(z.literal("")).transform(v => v || null), probation_ends_on: date.nullish().or(z.literal("")).transform(v => v || null),
    notice_days: z.number().int().min(0).max(365).nullish(), salary_note: opt(300), notes: opt(1000), document_id: z.string().uuid().nullish(), status: z.enum(["draft", "active", "ended"]).default("active"),
    supersede: z.boolean().default(true) }),
  z.object({ action: z.literal("accept_contract"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_qualification"), id: z.string().uuid().optional(), staff_id: z.string().uuid().optional(), kind: z.enum(["degree", "diploma", "certificate", "professional", "licence", "other"]),
    title: z.string().trim().min(1).max(160), institution: opt(160), awarded_on: date.nullish().or(z.literal("")).transform(v => v || null), expires_on: date.nullish().or(z.literal("")).transform(v => v || null),
    reference_no: opt(60), document_id: z.string().uuid().nullish() }),
  z.object({ action: z.literal("verify_qualification"), id: z.string().uuid(), verified: z.boolean() }),
  z.object({ action: z.literal("delete_qualification"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete_document"), id: z.string().uuid() }),
  z.object({ action: z.literal("document_visibility"), id: z.string().uuid(), visible: z.boolean() }),
  z.object({ action: z.literal("start_checklist"), staff_id: z.string().uuid(), kind: z.enum(["onboarding", "offboarding"]), template_id: z.string().uuid().nullish(), started_on: date.optional() }),
  z.object({ action: z.literal("tick"), item_id: z.string().uuid(), done: z.boolean(), note: opt(300) }),
  z.object({ action: z.literal("add_item"), checklist_id: z.string().uuid(), label: z.string().trim().min(1).max(200), owner, due_on: date.nullish() }),
  z.object({ action: z.literal("delete_item"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete_checklist"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_template"), id: z.string().uuid().optional(), kind: z.enum(["onboarding", "offboarding"]), name: z.string().trim().min(1).max(120),
    items: z.array(z.object({ label: z.string().trim().min(1).max(200), owner, due_days: z.number().int().min(0).max(365) })).max(60) }),
  z.object({ action: z.literal("delete_template"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_policy"), leave_type: z.enum(LEAVE_TYPES), days_per_year: z.number().min(0).max(366).nullable(), paid: z.boolean(),
    carry_over_max: z.number().min(0).max(366), needs_document: z.boolean(), min_notice_days: z.number().int().min(0).max(365) }),
  z.object({ action: z.literal("probation"), staff_id: z.string().uuid(), outcome: z.enum(["confirmed", "extended"]), until: date.optional() }),
  z.object({ action: z.literal("finish_offboarding"), staff_id: z.string().uuid(), exit_date: date, exit_reason: z.string().trim().min(2).max(200), disable_login: z.boolean().default(true) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, sb = ctx.sb;
  const hr = hasAny(ctx, ROLES.hr);
  const today = localParts(new Date(), ctx.tenant.timezone).date;
  const hrOnly = ["save_contract", "verify_qualification", "delete_document", "document_visibility", "start_checklist", "add_item", "delete_item", "delete_checklist",
    "save_template", "delete_template", "save_policy", "probation", "finish_offboarding"];
  if (hrOnly.includes(b.action) && !hr) return jsonError("only HR can do that", 403);
  const myStaff = async () => (await sb.from("staff").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle()).data?.id as string | undefined;
  const fail = (m: string, s = 400) => jsonError(m.replace(/^.*?violates row-level security.*$/, "you cannot change that"), s);

  switch (b.action) {
    case "save_personal": {
      const { action: _a, staff_id, ...row } = b;
      const id = staff_id ?? (await myStaff());
      if (!id) return jsonError("no staff record is linked to your account; ask HR", 404);
      if (!hr && id !== (await myStaff())) return jsonError("forbidden", 403);
      const { error } = await sb.from("staff_personal").upsert({ ...row, staff_id: id, tenant_id: tid, updated_at: new Date().toISOString() }, { onConflict: "staff_id" });
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "save_contract": {
      const { action: _a, id, supersede, ...row } = b;
      const { data, error } = id ? await sb.from("staff_contracts").update(row).eq("tenant_id", tid).eq("id", id).select("id").maybeSingle()
        : await sb.from("staff_contracts").insert({ ...row, tenant_id: tid, created_by: ctx.userId }).select("id").single();
      if (error) return fail(error.message);
      if (!data) return jsonError("contract not found", 404);
      if (row.status === "active") {
        if (supersede) await sb.from("staff_contracts").update({ status: "ended" }).eq("tenant_id", tid).eq("staff_id", row.staff_id).eq("status", "active").neq("id", data.id);
        const staffUpdate: Record<string, unknown> = { employment_type: row.kind === "part_time" ? "part_time" : row.kind === "consultancy" || row.kind === "fixed_term" ? "contract" : "full_time" };
        if (row.probation_ends_on) staffUpdate.probation_ends_on = row.probation_ends_on;
        if (row.position) staffUpdate.position = row.position;
        await sb.from("staff").update(staffUpdate).eq("tenant_id", tid).eq("id", row.staff_id);
        const { data: s } = await sb.from("staff").select("user_id").eq("id", row.staff_id).maybeSingle();
        if (s?.user_id && s.user_id !== ctx.userId) await tellStaff(createServiceClient(), tid, [s.user_id], "hr_contract", "Your contract", "A contract has been added to your HR record. Please read it and accept it.", `${appUrl(req)}/school/hr?tab=me`, data.id);
      }
      return NextResponse.json({ id: data.id });
    }
    case "accept_contract": {
      const me = await myStaff();
      const svc = createServiceClient();
      const { data } = await svc.from("staff_contracts").update({ accepted_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.id).eq("staff_id", me ?? "").eq("status", "active").is("accepted_at", null).select("id");
      return data?.length ? NextResponse.json({ ok: true }) : jsonError("nothing to accept");
    }
    case "save_qualification": {
      const { action: _a, id, staff_id, ...row } = b;
      const sid = staff_id ?? (await myStaff());
      if (!sid) return jsonError("no staff record is linked to your account", 404);
      if (!hr && sid !== (await myStaff())) return jsonError("forbidden", 403);
      const { data, error } = id ? await sb.from("staff_qualifications").update(row).eq("tenant_id", tid).eq("id", id).select("id").maybeSingle()
        : await sb.from("staff_qualifications").insert({ ...row, staff_id: sid, tenant_id: tid }).select("id").single();
      if (error) return fail(error.message);
      return data ? NextResponse.json({ id: data.id }) : jsonError("not found", 404);
    }
    case "verify_qualification": {
      const { error } = await sb.from("staff_qualifications").update({ verified_at: b.verified ? new Date().toISOString() : null }).eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "delete_qualification": {
      const { data, error } = await sb.from("staff_qualifications").delete().eq("tenant_id", tid).eq("id", b.id).select("id");
      if (error) return fail(error.message);
      return data?.length ? NextResponse.json({ ok: true }) : jsonError("not found", 404);
    }
    case "delete_document": {
      const { data } = await sb.from("staff_documents").delete().eq("tenant_id", tid).eq("id", b.id).select("path");
      if (data?.[0]?.path) await createServiceClient().storage.from("staff-documents").remove([data[0].path]);
      return data?.length ? NextResponse.json({ ok: true }) : jsonError("not found", 404);
    }
    case "document_visibility": {
      const { error } = await sb.from("staff_documents").update({ visible_to_staff: b.visible }).eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "start_checklist": {
      try {
        const id = await startChecklist(createServiceClient(), tid, { staffId: b.staff_id, kind: b.kind, templateId: b.template_id ?? null, startedOn: b.started_on ?? today, actor: ctx.userId, baseUrl: appUrl(req) });
        return NextResponse.json({ id }, { status: 201 });
      } catch (e) { return jsonError((e as Error).message); }
    }
    case "tick": {
      const { data, error } = await sb.from("staff_checklist_items").update({ done_at: b.done ? new Date().toISOString() : null, ...(b.note !== null ? { note: b.note } : {}) })
        .eq("tenant_id", tid).eq("id", b.item_id).select("id");
      if (error) return fail(error.message);
      return data?.length ? NextResponse.json({ ok: true }) : jsonError("this item is not yours to tick", 403);
    }
    case "add_item": {
      const { data: last } = await sb.from("staff_checklist_items").select("position").eq("checklist_id", b.checklist_id).order("position", { ascending: false }).limit(1);
      const { error } = await sb.from("staff_checklist_items").insert({ tenant_id: tid, checklist_id: b.checklist_id, label: b.label, owner: b.owner, due_on: b.due_on ?? null, position: (last?.[0]?.position ?? -1) + 1 });
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "delete_item": {
      const { error } = await sb.from("staff_checklist_items").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "delete_checklist": {
      const { error } = await sb.from("staff_checklists").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "save_template": {
      const { action: _a, id, ...row } = b;
      const { error } = id ? await sb.from("hr_checklist_templates").update(row).eq("tenant_id", tid).eq("id", id)
        : await sb.from("hr_checklist_templates").insert({ ...row, tenant_id: tid });
      return error ? fail(error.message.includes("duplicate") ? "a template with that name exists" : error.message) : NextResponse.json({ ok: true });
    }
    case "delete_template": {
      const { error } = await sb.from("hr_checklist_templates").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "save_policy": {
      const { action: _a, ...row } = b;
      const { error } = await sb.from("leave_policies").upsert({ ...row, tenant_id: tid }, { onConflict: "tenant_id,leave_type" });
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "probation": {
      if (b.outcome === "extended" && (!b.until || b.until <= today)) return jsonError("choose the new end of probation, after today");
      const { error } = await sb.from("staff").update({ probation_ends_on: b.outcome === "extended" ? b.until : null }).eq("tenant_id", tid).eq("id", b.staff_id);
      if (error) return fail(error.message);
      await sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: `staff.probation_${b.outcome}`, target: b.staff_id, meta: { until: b.until ?? null } });
      return NextResponse.json({ ok: true });
    }
    case "finish_offboarding": {
      if (b.disable_login && !hasAny(ctx, ROLES.admin)) return jsonError("only a school admin can disable a login; untick that box or ask an admin", 403);
      const { data: s } = await sb.from("staff").select("id,user_id").eq("tenant_id", tid).eq("id", b.staff_id).maybeSingle();
      if (!s) return jsonError("staff not found", 404);
      if (s.user_id === ctx.userId) return jsonError("you cannot offboard yourself");
      const { error } = await sb.from("staff").update({ status: "exited", exit_date: b.exit_date, exit_reason: b.exit_reason }).eq("tenant_id", tid).eq("id", s.id);
      if (error) return fail(error.message);
      await sb.from("staff_contracts").update({ status: "ended", ends_on: b.exit_date }).eq("tenant_id", tid).eq("staff_id", s.id).eq("status", "active");
      if (b.disable_login && s.user_id) await sb.from("users").update({ active: false }).eq("tenant_id", tid).eq("id", s.user_id);
      await sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "staff.exited", target: s.id, meta: { exit_date: b.exit_date, reason: b.exit_reason, login_disabled: b.disable_login && Boolean(s.user_id) } });
      return NextResponse.json({ ok: true });
    }
  }
}
