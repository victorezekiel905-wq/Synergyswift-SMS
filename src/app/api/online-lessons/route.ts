import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { meetingProvider, lessonWindow } from "@/lib/learning";
import { zoomCreds, zoomToken, createZoomMeeting, deleteZoomMeeting } from "@/lib/zoom";

export const dynamic = "force-dynamic";

const COLS = "id,class_group_id,subject_id,title,provider,join_url,passcode,starts_at,duration_min,status,created_by,class_groups(name),subjects(name)";

/** Online lessons. Staff: all (?id= adds who joined); students and parents: their classes'. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "lms");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const u = new URL(req.url).searchParams;
  const staff = hasAny(ctx, ROLES.staff);
  const now = new Date();
  const id = u.get("id");
  if (id && staff) {
    const { data: l } = await ctx.sb.from("online_lessons").select(COLS).eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!l) return jsonError("not found", 404);
    const [{ data: students }, { data: joins }] = await Promise.all([
      ctx.sb.from("students").select("id,first_name,last_name").eq("tenant_id", tid).eq("class_group_id", l.class_group_id).eq("status", "active").order("last_name"),
      ctx.sb.from("online_lesson_joins").select("student_id,joined_at").eq("lesson_id", id)
    ]);
    return NextResponse.json({ lesson: { ...l, window: lessonWindow(l.starts_at, l.duration_min, now) }, students: students ?? [], joins: joins ?? [] });
  }
  const past = u.get("past") === "1";
  let q = ctx.sb.from("online_lessons").select(COLS).eq("tenant_id", tid);
  // Lessons that have not ended yet (or, with ?past=1, the last 60 days).
  q = past ? q.lt("starts_at", now.toISOString()).gte("starts_at", new Date(now.getTime() - 60 * 86400_000).toISOString()).order("starts_at", { ascending: false })
    : q.gte("starts_at", new Date(now.getTime() - 10 * 3600_000).toISOString()).order("starts_at");
  if (u.get("class_group_id")) q = q.eq("class_group_id", u.get("class_group_id"));
  const { data, error } = await q.limit(200);
  if (error) return jsonError(error.message);
  const items = (data ?? []).map((l: any) => ({ ...l, window: lessonWindow(l.starts_at, l.duration_min, now) })).filter((l: any) => past || l.window !== "ended");
  let zoom: { connected: boolean; own: boolean } | null = null;
  if (staff) {
    const z = await zoomCreds(createServiceClient(), tid);
    zoom = { connected: Boolean(z), own: Boolean(z?.own) };
  }
  return NextResponse.json({ items: items.map((l: any) => staff ? l : { ...l, join_url: undefined }), staff, zoom, admin: hasAny(ctx, ROLES.admin), me: ctx.userId });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), class_group_ids: z.array(z.string().uuid()).min(1).max(20), subject_id: z.string().uuid().nullish(), title: z.string().trim().min(2).max(160),
    starts_at: z.string().datetime({ offset: true }), duration_min: z.number().int().min(5).max(600).default(40), use_zoom: z.boolean().default(false),
    join_url: z.string().trim().max(1000).nullish(), passcode: z.string().trim().max(60).nullish() }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("zoom_keys"), account_id: z.string().trim().min(5).max(100), client_id: z.string().trim().min(5).max(100), client_secret: z.string().trim().min(5).max(200) }),
  z.object({ action: z.literal("zoom_disconnect") })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "lms");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();

  if (b.action === "zoom_keys" || b.action === "zoom_disconnect") {
    if (!hasAny(ctx, ROLES.admin)) return jsonError("only admins can connect Zoom", 403);
    if (b.action === "zoom_disconnect") {
      await svc.from("integration_secrets").delete().eq("tenant_id", tid).eq("provider", "zoom");
      return NextResponse.json({ ok: true });
    }
    const { action: _a, ...creds } = b;
    try { await zoomToken(creds); } catch (e) { return jsonError(`Zoom said: ${(e as Error).message}`, 422); }
    await svc.from("integration_secrets").upsert({ tenant_id: tid, provider: "zoom", data: creds, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,provider" });
    await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "integration.zoom_connected", meta: {} });
    return NextResponse.json({ ok: true });
  }

  if (b.action === "create") {
    const { count } = await ctx.sb.from("class_groups").select("id", { count: "exact", head: true }).eq("tenant_id", tid).in("id", b.class_group_ids);
    if (count !== b.class_group_ids.length) return jsonError("choose classes from this school");
    if (Date.parse(b.starts_at) < Date.now() - 3600_000) return jsonError("the start time has already passed");
    let link = { join_url: b.join_url ?? "", passcode: b.passcode ?? null, start_url: null as string | null, external_id: null as string | null };
    let provider = meetingProvider(link.join_url);
    if (b.use_zoom) {
      const z = await zoomCreds(svc, tid);
      if (!z) return jsonError("Zoom is not connected for this school yet. Paste a meeting link instead, or ask an admin to connect Zoom.");
      try {
        const m = await createZoomMeeting(z.creds, { title: b.title, startsAt: b.starts_at, durationMin: b.duration_min, timezone: ctx.tenant.timezone || "Africa/Lagos" });
        link = { join_url: m.join_url, passcode: m.passcode, start_url: m.start_url, external_id: m.id };
        provider = "zoom";
      } catch (e) { return jsonError(`Zoom said: ${(e as Error).message}`, 502); }
    } else if (!provider) return jsonError("paste the https meeting link from Zoom, Google Meet or Teams");
    // One meeting, shared by every class chosen.
    const rows = b.class_group_ids.map(cg => ({ tenant_id: tid, class_group_id: cg, subject_id: b.subject_id ?? null, title: b.title, provider: provider!, join_url: link.join_url,
      passcode: link.passcode, starts_at: b.starts_at, duration_min: b.duration_min, external_id: link.external_id, created_by: ctx.userId }));
    const { data, error } = await ctx.sb.from("online_lessons").insert(rows).select("id");
    if (error) return jsonError(error.message);
    if (link.start_url) await svc.from("online_lesson_hosts").insert((data ?? []).map((r: any) => ({ lesson_id: r.id, tenant_id: tid, start_url: link.start_url })));
    return NextResponse.json({ ok: true, ids: (data ?? []).map((r: any) => r.id), provider }, { status: 201 });
  }

  const { data: l } = await ctx.sb.from("online_lessons").select("id,external_id,provider,created_by").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
  if (!l) return jsonError("not found", 404);
  const res = b.action === "cancel"
    ? await ctx.sb.from("online_lessons").update({ status: "cancelled" }).eq("id", b.id).select("id").maybeSingle()
    : await ctx.sb.from("online_lessons").delete().eq("id", b.id).select("id").maybeSingle();
  if (res.error || !res.data) return jsonError(res.error?.message ?? "only the teacher who set it up or an admin can change it", 403);
  // The Zoom meeting goes when no other class's lesson still uses it.
  if (l.provider === "zoom" && l.external_id) {
    const { count } = await svc.from("online_lessons").select("id", { count: "exact", head: true }).eq("external_id", l.external_id).eq("status", "scheduled");
    if (!count) { const z = await zoomCreds(svc, tid); if (z) await deleteZoomMeeting(z.creds, l.external_id); }
  }
  return NextResponse.json({ ok: true });
}
