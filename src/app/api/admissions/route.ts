import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, denyUnless } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyApplicant, enrollApplication } from "@/lib/admissions";
import { syncLeadFromApplication } from "@/lib/admissions-crm";
import { issueOffer, sendDecisionLetter } from "@/lib/admissions-decisions";
import { seatsLeft } from "@/lib/crm";
import { notifyContact } from "@/lib/notify";
import { admissionNote } from "@/lib/messaging/notices";
import { appUrl, toCsv } from "@/lib/school";

const STATUSES = ["new", "reviewing", "assessment", "interview", "offered", "accepted", "enrolled", "rejected", "withdrawn", "waitlisted", "declined", "expired"] as const;

/** Applications with funnel counts, seats left per level and each family's documents, payments and entrance tests; ?format=csv exports. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admissions, "admissions");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const status = u.searchParams.get("status");
  const tid = ctx.tenant.id;
  let q = ctx.sb.from("applications").select("*,application_documents(id,kind,name,size,uploaded_at),admission_payments(kind,amount,status,paid_at),entrance_attempts(id,exam_id,status,total_score,max_score,submitted_at,token,exams(title))")
    .eq("tenant_id", tid).order("created_at", { ascending: false }).limit(2000);
  if (status) q = q.eq("status", status);
  const [{ data: apps, error }, { data: all }, { data: settings }, { data: tenant }, { data: capacity }, { data: exams }] = await Promise.all([
    q,
    ctx.sb.from("applications").select("status,source,applying_for").eq("tenant_id", tid).limit(20000),
    ctx.sb.from("tenant_settings").select("admissions_open,application_fee,admissions_intro,currency,acceptance_fee,offer_valid_days").eq("tenant_id", tid).maybeSingle(),
    ctx.sb.from("tenants").select("public_slug").eq("id", tid).maybeSingle(),
    ctx.sb.from("admission_capacity").select("level,seats").eq("tenant_id", tid),
    ctx.sb.from("exams").select("id,title,status,duration_minutes").eq("tenant_id", tid).neq("status", "closed").order("created_at", { ascending: false }).limit(100)
  ]);
  if (error) return jsonError(error.message);
  if (u.searchParams.get("format") === "csv") {
    const csv = toCsv([["Application", "Child", "Applying for", "Guardian", "Phone", "Email", "Status", "Assessment score", "Interview score", "Source", "Fee paid", "Date"],
      ...(apps ?? []).map((a: any) => [a.application_no, `${a.first_name} ${a.last_name}`, a.applying_for, a.guardian_name, a.guardian_phone, a.guardian_email, a.status, a.assessment_score, a.interview_score, a.source, a.fee_paid ? "yes" : "no", a.created_at])]);
    return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="applications.csv"` } });
  }
  const funnel = Object.fromEntries(STATUSES.map(s => [s, (all ?? []).filter((a: any) => a.status === s).length]));
  const total = (all ?? []).length;
  const enrolled = funnel.enrolled ?? 0;
  const offered = (funnel.offered ?? 0) + (funnel.accepted ?? 0) + enrolled;
  const left = seatsLeft((capacity ?? []).map((c: any) => ({ level: c.level, seats: c.seats })), (all ?? []) as any);
  return NextResponse.json({
    applications: apps ?? [], funnel, total, exams: exams ?? [],
    seats: (capacity ?? []).map((c: any) => ({ level: c.level, seats: c.seats, left: left.get(c.level) ?? c.seats })),
    conversion: { offer_rate: total ? Math.round((offered / total) * 1000) / 10 : null, yield: offered ? Math.round((enrolled / offered) * 1000) / 10 : null },
    settings: { ...(settings ?? {}), public_slug: tenant?.public_slug ?? null }
  });
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const iso = z.string().datetime({ offset: true });
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), id: z.string().uuid(), status: z.enum(STATUSES), note: z.string().trim().max(1000).nullish(), notify: z.boolean().default(true),
    assessment_at: iso.nullish(), interview_at: iso.nullish(), offer_expires_on: date.nullish() }),
  z.object({ action: z.literal("score"), id: z.string().uuid(), assessment_score: z.number().min(0).max(1000) }),
  z.object({ action: z.literal("fee"), id: z.string().uuid(), fee_paid: z.boolean(), fee_reference: z.string().trim().max(80).nullish() }),
  z.object({ action: z.literal("interview"), id: z.string().uuid(), interview_at: iso.nullish(), interviewer_id: z.string().uuid().nullish(),
    interview_notes: z.string().trim().max(4000).nullish(), interview_score: z.number().min(0).max(100).nullish() }),
  z.object({ action: z.literal("offer"), id: z.string().uuid(), acceptance_fee: z.number().min(0).max(1e9).nullish(), expires_on: date.nullish(), note: z.string().trim().max(1000).nullish(), force: z.boolean().default(false) }),
  z.object({ action: z.literal("waitlist"), id: z.string().uuid(), position: z.number().int().min(1).max(10000).nullish() }),
  z.object({ action: z.literal("acceptance_paid"), id: z.string().uuid(), paid: z.boolean() }),
  z.object({ action: z.literal("assign_entrance"), ids: z.array(z.string().uuid()).min(1).max(500), exam_id: z.string().uuid(), opens_at: iso.nullish(), closes_at: iso.nullish(), notify: z.boolean().default(true) }),
  z.object({ action: z.literal("document_url"), doc_id: z.string().uuid() }),
  z.object({ action: z.literal("enroll"), id: z.string().uuid(), admission_no: z.string().trim().min(1).max(40), class_group_id: z.string().uuid().nullish() }),
  z.object({ action: z.literal("walk_in"), first_name: z.string().trim().min(1).max(60), last_name: z.string().trim().min(1).max(60), gender: z.enum(["male", "female", "other"]).nullish(),
    date_of_birth: date.nullish(), applying_for: z.string().trim().min(1).max(60), guardian_name: z.string().trim().min(2).max(120), guardian_phone: z.string().trim().min(5).max(30),
    guardian_email: z.string().trim().email().nullish().or(z.literal("")), previous_school: z.string().trim().max(120).nullish(), source: z.enum(["walk_in", "referral", "agent", "phone"]).default("walk_in") }),
  z.object({ action: z.literal("settings"), admissions_open: z.boolean(), application_fee: z.number().min(0).max(1e9), admissions_intro: z.string().trim().max(3000).nullish(),
    public_slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "use lowercase letters, numbers and dashes").nullish() })
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
  const now = () => new Date().toISOString();
  try {
    switch (b.action) {
      case "status": {
        const extra: Record<string, unknown> = {};
        if (b.status === "waitlisted") {
          const { data: cur } = await ctx.sb.from("applications").select("applying_for,waitlist_position").eq("tenant_id", tid).eq("id", b.id).single();
          if (!cur.waitlist_position) {
            const { data: last } = await ctx.sb.from("applications").select("waitlist_position").eq("tenant_id", tid).eq("status", "waitlisted").eq("applying_for", cur.applying_for)
              .order("waitlist_position", { ascending: false, nullsFirst: false }).limit(1);
            extra.waitlist_position = (last?.[0]?.waitlist_position ?? 0) + 1;
          }
        } else extra.waitlist_position = null;
        const { data: app, error } = await ctx.sb.from("applications").update({ status: b.status, decision_note: b.note ?? null, updated_at: now(), ...extra,
          ...(b.assessment_at !== undefined ? { assessment_at: b.assessment_at } : {}), ...(b.interview_at !== undefined ? { interview_at: b.interview_at } : {}),
          ...(b.offer_expires_on !== undefined ? { offer_expires_on: b.offer_expires_on } : {}) }).eq("tenant_id", tid).eq("id", b.id).select("*").single();
        if (error) return jsonError(error.message);
        await syncLeadFromApplication(svc, app);
        let sent = 0;
        if (b.notify) sent = ["waitlisted", "rejected"].includes(b.status) ? await sendDecisionLetter(svc, app, b.status === "waitlisted" ? "waitlist" : "regret", base) : await notifyApplicant(svc, app, base, b.note);
        return NextResponse.json({ ok: true, messages_queued: sent });
      }
      case "score": case "fee": case "acceptance_paid": {
        const row = b.action === "acceptance_paid" ? { acceptance_paid: b.paid } : (() => { const { action: _a, id: _i, ...r } = b; return r; })();
        const { data: app, error } = await ctx.sb.from("applications").update({ ...row, updated_at: now() }).eq("tenant_id", tid).eq("id", b.id).select("*").single();
        if (error) return jsonError(error.message);
        if (app.lead_id) await svc.from("lead_activities").insert({ tenant_id: tid, lead_id: app.lead_id, kind: "system", actor_id: ctx.userId,
          body: b.action === "score" ? `Assessment score recorded: ${b.assessment_score}.` : b.action === "fee" ? `Application fee marked ${b.fee_paid ? "paid" : "unpaid"}.` : `Acceptance fee marked ${b.paid ? "paid" : "unpaid"}.` });
        return NextResponse.json({ ok: true });
      }
      case "interview": {
        const { action: _a, id, ...row } = b;
        const { data: app, error } = await ctx.sb.from("applications").update({ ...row, updated_at: now() }).eq("tenant_id", tid).eq("id", id).select("*").single();
        if (error) return jsonError(error.message);
        if (app.lead_id && (b.interview_notes || b.interview_score !== undefined)) await svc.from("lead_activities").insert({ tenant_id: tid, lead_id: app.lead_id, kind: "meeting", actor_id: ctx.userId,
          body: `Interview${b.interview_score !== null && b.interview_score !== undefined ? ` scored ${b.interview_score}/100` : ""}${b.interview_notes ? `: ${b.interview_notes}` : ""}` });
        return NextResponse.json({ ok: true });
      }
      case "offer": {
      { const denied = denyUnless(ctx, "admissions.offer"); if (denied) return denied; }
        const { data: app } = await ctx.sb.from("applications").select("*").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
        if (!app) return jsonError("application not found", 404);
        if (["enrolled", "accepted"].includes(app.status)) return jsonError(`this application is already ${app.status}`);
        const { data: cap } = await ctx.sb.from("admission_capacity").select("level,seats").eq("tenant_id", tid).eq("level", app.applying_for);
        if (cap?.length && !b.force) {
          const { data: others } = await ctx.sb.from("applications").select("applying_for,status").eq("tenant_id", tid).eq("applying_for", app.applying_for).neq("id", app.id);
          const left = seatsLeft(cap.map((c: any) => ({ level: c.level, seats: c.seats })), (others ?? []) as any).get(app.applying_for) ?? 0;
          if (left <= 0) return jsonError(`${app.applying_for} is full. Put the child on the waiting list, raise the number of seats, or offer anyway.`, 409);
        }
        const { link, sent } = await issueOffer(svc, app, base, { acceptanceFee: b.acceptance_fee ?? null, expiresOn: b.expires_on ?? null, note: b.note ?? null });
        return NextResponse.json({ ok: true, offer_link: link, messages_queued: sent });
      }
      case "waitlist": {
        const { error } = await ctx.sb.from("applications").update({ waitlist_position: b.position ?? null, updated_at: now() }).eq("tenant_id", tid).eq("id", b.id).eq("status", "waitlisted");
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "assign_entrance": {
        const { data: exam } = await ctx.sb.from("exams").select("id,title,duration_minutes").eq("tenant_id", tid).eq("id", b.exam_id).maybeSingle();
        if (!exam) return jsonError("exam not found", 404);
        const { data: apps } = await ctx.sb.from("applications").select("*").eq("tenant_id", tid).in("id", b.ids);
        let sent = 0;
        for (const a of apps ?? []) {
          const { data: att, error } = await svc.from("entrance_attempts").upsert({ tenant_id: tid, application_id: a.id, exam_id: exam.id, opens_at: b.opens_at ?? null, closes_at: b.closes_at ?? null },
            { onConflict: "application_id,exam_id", ignoreDuplicates: false }).select("token,status").single();
          if (error) return jsonError(error.message);
          if (["new", "reviewing"].includes(a.status)) {
            const { data: up } = await ctx.sb.from("applications").update({ status: "assessment", assessment_at: b.opens_at ?? a.assessment_at, updated_at: now() }).eq("id", a.id).select("*").single();
            if (up) await syncLeadFromApplication(svc, up);
          }
          if (b.notify && att.status === "assigned") {
            sent += await notifyContact(svc, { tenantId: tid, name: a.guardian_name, email: a.guardian_email, phone: a.guardian_phone, kind: "admission", refId: a.id,
              build: br => admissionNote(br, { name: a.guardian_name, subject: `Entrance test for ${a.first_name}`, lines: [`${a.first_name}'s online entrance test (${exam.title}, ${exam.duration_minutes} minutes) is ready.`,
                b.opens_at ? `It opens ${new Date(b.opens_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}${b.closes_at ? ` and closes ${new Date(b.closes_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : ""}.` : "It can be taken now.",
                "Please let your child take it alone, in one sitting, on a computer or tablet."], link: `${base}/entrance/${att.token}`, linkLabel: "Start the entrance test" }) });
          }
        }
        return NextResponse.json({ ok: true, assigned: (apps ?? []).length, messages_queued: sent });
      }
      case "document_url": {
        const { data: d } = await ctx.sb.from("application_documents").select("path").eq("tenant_id", tid).eq("id", b.doc_id).maybeSingle();
        if (!d) return jsonError("document not found", 404);
        const { data } = await svc.storage.from("admissions").createSignedUrl(d.path, 300);
        return data?.signedUrl ? NextResponse.json({ url: data.signedUrl }) : jsonError("file not found", 404);
      }
      case "enroll": {
        const r = await enrollApplication(svc, { tenantId: tid, applicationId: b.id, admissionNo: b.admission_no, classGroupId: b.class_group_id ?? null });
        const { data: app } = await svc.from("applications").select("*").eq("id", b.id).single();
        await syncLeadFromApplication(svc, app);
        if (!r.already) await notifyApplicant(svc, app, base);
        await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "admissions.enrolled", target: r.student_id });
        return NextResponse.json(r);
      }
      case "walk_in": {
        const { action: _a, ...row } = b;
        const { data: no } = await svc.rpc("next_doc_no", { p_tenant: tid, p_kind: "app" });
        const { data, error } = await ctx.sb.from("applications").insert({ ...row, guardian_email: row.guardian_email || null, tenant_id: tid, application_no: no }).select("*").single();
        if (error) return jsonError(error.message);
        await syncLeadFromApplication(svc, data);
        await notifyApplicant(svc, data, base);
        return NextResponse.json(data, { status: 201 });
      }
      case "settings": {
        if (!ROLES.admin.some(r => ctx.roles.has(r))) return jsonError("only school admins can change admission settings", 403);
        if (b.public_slug) {
          const { data: taken } = await svc.from("tenants").select("id").ilike("public_slug", b.public_slug).neq("id", tid).maybeSingle();
          if (taken) return jsonError("that web address is already taken");
          await svc.from("tenants").update({ public_slug: b.public_slug }).eq("id", tid);
        }
        const { error } = await ctx.sb.from("tenant_settings").upsert({ tenant_id: tid, admissions_open: b.admissions_open, application_fee: b.application_fee, admissions_intro: b.admissions_intro ?? null }, { onConflict: "tenant_id" });
        return error ? jsonError(error.message) : NextResponse.json({ ok: true, apply_url: b.public_slug ? `${base}/apply/${b.public_slug}` : null });
      }
    }
  } catch (e) { return jsonError((e as Error).message); }
}
