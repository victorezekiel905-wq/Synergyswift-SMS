import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { notifyGuardians } from "@/lib/notify";
import { communityNote } from "@/lib/messaging/notices";
import { ARRANGEMENTS, PROGRESS, SEN_AREAS, SEN_NEEDS, SEN_STATUS } from "@/lib/sis";

export const dynamic = "force-dynamic";

/** SEN profile, IEPs, targets and reviews. Row-level security decides who sees and edits. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireCtx(ROLES.staff, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const [{ data: profile }, { data: ieps }, { data: manage }] = await Promise.all([
    ctx.sb.from("sen_profiles").select("*,coordinator:coordinator_id(full_name)").eq("tenant_id", tid).eq("student_id", id).maybeSingle(),
    ctx.sb.from("ieps").select("*,iep_targets(*,owner:owner_id(full_name)),iep_reviews(*,users:created_by(full_name))").eq("tenant_id", tid).eq("student_id", id).order("starts_on", { ascending: false }),
    ctx.sb.rpc("can_manage_sen", { p_student: id })
  ]);
  const { data: staff } = manage ? await createServiceClient().from("users").select("id,full_name").eq("tenant_id", tid).eq("active", true).not("role", "in", "(student,parent,alumni)").order("full_name") : { data: [] };
  // Phase 14h: the home–school book and what the family and the child say about each target (empty before migration 6700).
  const targetIds = (ieps ?? []).flatMap((i: any) => (i.iep_targets ?? []).map((t: any) => t.id));
  const [{ data: notes }, { data: feedback }] = await Promise.all([
    ctx.sb.from("sen_home_notes").select("*").eq("tenant_id", tid).eq("student_id", id).order("created_at", { ascending: false }).limit(100),
    targetIds.length ? ctx.sb.from("iep_target_feedback").select("*").in("target_id", targetIds).order("created_at", { ascending: false }).limit(300) : Promise.resolve({ data: [] })
  ]);
  return NextResponse.json({
    profile: profile ?? null, ieps: (ieps ?? []).map((i: any) => ({ ...i, iep_targets: [...(i.iep_targets ?? [])].sort((a: any, b: any) => a.position - b.position),
      iep_reviews: [...(i.iep_reviews ?? [])].sort((a: any, b: any) => b.reviewed_on.localeCompare(a.reviewed_on)) })),
    can_manage: Boolean(manage), staff: staff ?? [], me: ctx.userId, notes: notes ?? [], feedback: feedback ?? [],
    vocab: { status: SEN_STATUS, areas: SEN_AREAS, needs: SEN_NEEDS, arrangements: ARRANGEMENTS, progress: PROGRESS }
  });
}

const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("profile"), status: z.enum(["monitoring", "sen_support", "ehcp", "closed"]), areas: z.array(z.string().max(40)).max(10), needs: z.array(z.string().max(40)).max(20),
    summary: z.string().trim().max(4000).nullish(), strengths: z.string().trim().max(2000).nullish(), strategies: z.string().trim().max(4000).nullish(),
    extra_time_pct: z.number().int().min(0).max(100), arrangements: z.array(z.string().max(40)).max(15), agencies: z.string().trim().max(1000).nullish(),
    coordinator_id: z.string().uuid().nullish(), share_with_teachers: z.boolean(),
    // Phase 14h: shared with the family's portal; supports that follow the child into live lessons.
    share_with_parents: z.boolean().optional(), live_read_aloud: z.boolean().optional(), live_readable_font: z.boolean().optional(), live_calm_mode: z.boolean().optional() }),
  z.object({ action: z.literal("note"), body: z.string().trim().min(1).max(4000), kind: z.enum(["note", "praise"]).default("note"), notify_family: z.boolean().default(true) }),
  z.object({ action: z.literal("notes_read") }),
  z.object({ action: z.literal("iep"), id: z.string().uuid().nullish(), title: z.string().trim().min(2).max(120), starts_on: d, review_on: d.nullish(),
    status: z.enum(["draft", "active", "closed"]), student_voice: z.string().trim().max(2000).nullish(), parent_views: z.string().trim().max(2000).nullish(), notify_family: z.boolean().default(true) }),
  z.object({ action: z.literal("target"), id: z.string().uuid().nullish(), iep_id: z.string().uuid(), area: z.string().trim().max(60).nullish(), target: z.string().trim().min(2).max(1000),
    strategies: z.string().trim().max(2000).nullish(), success_criteria: z.string().trim().max(1000).nullish(), owner_id: z.string().uuid().nullish(),
    progress: z.enum(["not_started", "emerging", "developing", "secure", "achieved"]).default("not_started"), notes: z.string().trim().max(2000).nullish(), position: z.number().int().min(0).max(100).default(0) }),
  z.object({ action: z.literal("progress"), id: z.string().uuid(), progress: z.enum(["not_started", "emerging", "developing", "secure", "achieved"]), notes: z.string().trim().max(2000).nullish() }),
  z.object({ action: z.literal("delete_target"), id: z.string().uuid() }),
  z.object({ action: z.literal("review"), iep_id: z.string().uuid(), reviewed_on: d, summary: z.string().trim().min(2).max(4000), attendees: z.string().trim().max(500).nullish(), next_review: d.nullish() }),
  z.object({ action: z.literal("delete_iep"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const ctx = await requireCtx(ROLES.staff, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  const now = new Date().toISOString();
  const refuse = (e: any) => jsonError(/row-level security|violates/.test(e?.message ?? "") ? "only the SEN team can change this" : e?.message ?? "not found", e ? 403 : 404);

  switch (b.action) {
    case "note": {
      const { error } = await sb.from("sen_home_notes").insert({ tenant_id: tid, student_id: id, author_kind: "staff", author_user_id: ctx.userId, author_name: ctx.profile.full_name, kind: b.kind, body: b.body });
      if (error) return refuse(error);
      if (b.notify_family) {
        const { data: p } = await sb.from("sen_profiles").select("share_with_parents").eq("student_id", id).maybeSingle();
        if (p?.share_with_parents) await notifyGuardians(createServiceClient(), { tenantId: tid, studentIds: [id], kind: "sen", refId: id,
          build: (br: any, g: any) => communityNote(br, { name: g.full_name, subject: b.kind === "praise" ? "Good news from school" : "A note from school", lines: [b.body],
            link: `${appUrl(req)}/parent/support?student=${id}`, linkLabel: "Open the home–school book" }) }).catch(() => null);
      }
      return NextResponse.json({ ok: true });
    }
    case "notes_read": {
      await createServiceClient().from("sen_home_notes").update({ read_by_staff_at: now }).eq("tenant_id", tid).eq("student_id", id).neq("author_kind", "staff").is("read_by_staff_at", null);
      return NextResponse.json({ ok: true });
    }
    case "profile": {
      const { action: _a, ...row } = b;
      const { error } = await sb.from("sen_profiles").upsert({ ...row, student_id: id, tenant_id: tid, updated_by: ctx.userId, updated_at: now }, { onConflict: "student_id" });
      return error ? refuse(error) : NextResponse.json({ ok: true });
    }
    case "iep": {
      const { action: _a, id: iepId, notify_family, ...row } = b;
      const { data: before } = iepId ? await sb.from("ieps").select("status").eq("id", iepId).maybeSingle() : { data: null };
      const q = iepId ? sb.from("ieps").update({ ...row, updated_at: now }).eq("tenant_id", tid).eq("student_id", id).eq("id", iepId)
        : sb.from("ieps").insert({ ...row, tenant_id: tid, student_id: id, created_by: ctx.userId });
      const { data, error } = await q.select("id").maybeSingle();
      if (error || !data) return refuse(error);
      // When a plan goes live, the family is told it is ready to read in their portal.
      if (notify_family && row.status === "active" && before?.status !== "active") {
        const base = appUrl(req);
        await notifyGuardians(createServiceClient(), { tenantId: tid, studentIds: [id], kind: "iep", refId: data.id, createdBy: ctx.userId,
          build: (brand, g, sid) => communityNote(brand, { name: g.full_name, subject: "Your child's support plan", lines: ["We have written a support plan for your child with targets and the help they will get. Please read it and tell us what you think."],
            link: g.user_id ? `${base}/parent#records` : `${base}/g/${g.portal_token}#records`, linkLabel: "Read the plan" }) }).catch(() => null);
      }
      return NextResponse.json({ ok: true, id: data.id });
    }
    case "target": {
      const { action: _a, id: tId, ...row } = b;
      const { data: iep } = await sb.from("ieps").select("id").eq("tenant_id", tid).eq("student_id", id).eq("id", row.iep_id).maybeSingle();
      if (!iep) return jsonError("plan not found", 404);
      const q = tId ? sb.from("iep_targets").update({ ...row, updated_at: now }).eq("tenant_id", tid).eq("id", tId) : sb.from("iep_targets").insert({ ...row, tenant_id: tid });
      const { data, error } = await q.select("id").maybeSingle();
      return error || !data ? refuse(error) : NextResponse.json({ ok: true, id: data.id });
    }
    case "progress": {
      // The SEN team, or the teacher who owns the target.
      const { data, error } = await sb.from("iep_targets").update({ progress: b.progress, ...(b.notes !== undefined ? { notes: b.notes } : {}), updated_at: now }).eq("tenant_id", tid).eq("id", b.id).select("id").maybeSingle();
      return error || !data ? refuse(error) : NextResponse.json({ ok: true });
    }
    case "delete_target": {
      const { data, error } = await sb.from("iep_targets").delete().eq("tenant_id", tid).eq("id", b.id).select("id").maybeSingle();
      return error || !data ? refuse(error) : NextResponse.json({ ok: true });
    }
    case "review": {
      const { data: iep } = await sb.from("ieps").select("id").eq("tenant_id", tid).eq("student_id", id).eq("id", b.iep_id).maybeSingle();
      if (!iep) return jsonError("plan not found", 404);
      const { action: _a, ...row } = b;
      const { error } = await sb.from("iep_reviews").insert({ ...row, tenant_id: tid, created_by: ctx.userId });
      if (error) return refuse(error);
      if (b.next_review) await sb.from("ieps").update({ review_on: b.next_review, updated_at: now }).eq("id", b.iep_id);
      return NextResponse.json({ ok: true });
    }
    case "delete_iep": {
      const { data, error } = await sb.from("ieps").delete().eq("tenant_id", tid).eq("student_id", id).eq("id", b.id).eq("status", "draft").select("id").maybeSingle();
      return error || !data ? jsonError(error?.message ?? "only draft plans can be deleted; close a live plan instead") : NextResponse.json({ ok: true });
    }
  }
}
