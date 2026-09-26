import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { notifyApplicant, enrollApplication } from "@/lib/admissions";
import { appUrl, toCsv } from "@/lib/school";

const STATUSES = ["new", "reviewing", "assessment", "interview", "offered", "accepted", "enrolled", "rejected", "withdrawn"] as const;

/** Applications with funnel counts; ?format=csv exports. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admissions, "admissions");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const status = u.searchParams.get("status");
  let q = ctx.sb.from("applications").select("*").eq("tenant_id", ctx.tenant.id).order("created_at", { ascending: false }).limit(2000);
  if (status) q = q.eq("status", status);
  const [{ data: apps, error }, { data: all }, { data: settings }, { data: tenant }] = await Promise.all([
    q,
    ctx.sb.from("applications").select("status,source").eq("tenant_id", ctx.tenant.id).limit(20000),
    ctx.sb.from("tenant_settings").select("admissions_open,application_fee,admissions_intro,currency").eq("tenant_id", ctx.tenant.id).maybeSingle(),
    ctx.sb.from("tenants").select("public_slug").eq("id", ctx.tenant.id).maybeSingle()
  ]);
  if (error) return jsonError(error.message);
  if (u.searchParams.get("format") === "csv") {
    const csv = toCsv([["Application", "Child", "Applying for", "Guardian", "Phone", "Email", "Status", "Assessment score", "Source", "Date"],
      ...(apps ?? []).map((a: any) => [a.application_no, `${a.first_name} ${a.last_name}`, a.applying_for, a.guardian_name, a.guardian_phone, a.guardian_email, a.status, a.assessment_score, a.source, a.created_at])]);
    return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="applications.csv"` } });
  }
  const funnel = Object.fromEntries(STATUSES.map(s => [s, (all ?? []).filter((a: any) => a.status === s).length]));
  const total = (all ?? []).length;
  const enrolled = funnel.enrolled ?? 0;
  const offered = (funnel.offered ?? 0) + (funnel.accepted ?? 0) + enrolled;
  return NextResponse.json({
    applications: apps ?? [], funnel, total,
    conversion: { offer_rate: total ? Math.round((offered / total) * 1000) / 10 : null, yield: offered ? Math.round((enrolled / offered) * 1000) / 10 : null },
    settings: { ...(settings ?? {}), public_slug: tenant?.public_slug ?? null }
  });
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), id: z.string().uuid(), status: z.enum(STATUSES), note: z.string().trim().max(1000).nullish(), notify: z.boolean().default(true),
    assessment_at: z.string().datetime({ offset: true }).nullish(), interview_at: z.string().datetime({ offset: true }).nullish(), offer_expires_on: date.nullish() }),
  z.object({ action: z.literal("score"), id: z.string().uuid(), assessment_score: z.number().min(0).max(1000) }),
  z.object({ action: z.literal("fee"), id: z.string().uuid(), fee_paid: z.boolean(), fee_reference: z.string().trim().max(80).nullish() }),
  z.object({ action: z.literal("enroll"), id: z.string().uuid(), admission_no: z.string().trim().min(1).max(40), class_group_id: z.string().uuid().nullish() }),
  z.object({ action: z.literal("walk_in"), first_name: z.string().trim().min(1).max(60), last_name: z.string().trim().min(1).max(60), gender: z.enum(["male", "female", "other"]).nullish(),
    date_of_birth: date.nullish(), applying_for: z.string().trim().min(1).max(60), guardian_name: z.string().trim().min(2).max(120), guardian_phone: z.string().trim().min(5).max(30),
    guardian_email: z.string().trim().email().nullish().or(z.literal("")), previous_school: z.string().trim().max(120).nullish(), source: z.enum(["walk_in", "referral", "agent"]).default("walk_in") }),
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
  try {
    switch (b.action) {
      case "status": {
        const { data: app, error } = await ctx.sb.from("applications").update({ status: b.status, decision_note: b.note ?? null, updated_at: new Date().toISOString(),
          ...(b.assessment_at !== undefined ? { assessment_at: b.assessment_at } : {}), ...(b.interview_at !== undefined ? { interview_at: b.interview_at } : {}),
          ...(b.offer_expires_on !== undefined ? { offer_expires_on: b.offer_expires_on } : {}) }).eq("tenant_id", tid).eq("id", b.id).select("*").single();
        if (error) return jsonError(error.message);
        const sent = b.notify ? await notifyApplicant(svc, app, base, b.note) : 0;
        return NextResponse.json({ ok: true, messages_queued: sent });
      }
      case "score": case "fee": {
        const { action: _a, id, ...row } = b;
        const { error } = await ctx.sb.from("applications").update({ ...row, updated_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "enroll": {
        const r = await enrollApplication(svc, { tenantId: tid, applicationId: b.id, admissionNo: b.admission_no, classGroupId: b.class_group_id ?? null });
        const { data: app } = await svc.from("applications").select("*").eq("id", b.id).single();
        if (!r.already) await notifyApplicant(svc, app, base);
        await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "admissions.enrolled", target: r.student_id });
        return NextResponse.json(r);
      }
      case "walk_in": {
        const { action: _a, ...row } = b;
        const { data: no } = await svc.rpc("next_doc_no", { p_tenant: tid, p_kind: "app" });
        const { data, error } = await ctx.sb.from("applications").insert({ ...row, guardian_email: row.guardian_email || null, tenant_id: tid, application_no: no }).select("*").single();
        if (error) return jsonError(error.message);
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
