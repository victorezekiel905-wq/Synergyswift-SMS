import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl, studentName } from "@/lib/school";
import { safeWebhookUrl } from "@/lib/open-api";

export const dynamic = "force-dynamic";

/**
 * Learning tools (LTI 1.3). Staff: tools, links and (?link_id=) scores; admins
 * also get the platform details to give the tool's makers. Students: the tools
 * added to their class with their own scores.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx([...ROLES.staff, "student"]);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const linkSel = "id,title,class_group_id,subject_id,homework_id,score_maximum,open_in,created_by,created_at,tool_id,lti_tools(name),class_groups(name),subjects(name),homework(title,due_at)";
  if (!hasAny(ctx, ROLES.staff)) {
    const [{ data: links }, { data: scores }] = await Promise.all([
      ctx.sb.from("lti_links").select(linkSel).eq("tenant_id", tid).order("created_at", { ascending: false }),
      ctx.sb.from("lti_scores").select("link_id,score_given,score_maximum,grading_progress").eq("user_id", ctx.userId)
    ]);
    const mine = new Map((scores ?? []).map((s: any) => [s.link_id, s]));
    return NextResponse.json({ links: (links ?? []).map((l: any) => ({ ...l, my_score: mine.get(l.id) ?? null })) });
  }
  const u = new URL(req.url).searchParams;
  const linkId = u.get("link_id");
  if (linkId) {
    const { data: scores } = await ctx.sb.from("lti_scores").select("user_id,score_given,score_maximum,activity_progress,grading_progress,comment,received_at").eq("tenant_id", tid).eq("link_id", linkId).order("received_at", { ascending: false });
    const ids = (scores ?? []).map((s: any) => s.user_id);
    const { data: st } = ids.length ? await ctx.sb.from("students").select("user_id,first_name,last_name,other_names,admission_no").in("user_id", ids) : { data: [] };
    const name = new Map((st ?? []).map((s: any) => [s.user_id, `${studentName(s)} (${s.admission_no})`]));
    return NextResponse.json({ scores: (scores ?? []).map((s: any) => ({ ...s, student: name.get(s.user_id) ?? "Someone" })) });
  }
  const admin = hasAny(ctx, ROLES.admin);
  const [{ data: tools }, { data: links }, { data: classes }, { data: subjects }, { data: homework }] = await Promise.all([
    ctx.sb.from("lti_tools").select(admin ? "*" : "id,name,description,active,grades").eq("tenant_id", tid).order("name"),
    ctx.sb.from("lti_links").select(linkSel).eq("tenant_id", tid).order("created_at", { ascending: false }).limit(300),
    ctx.sb.from("class_groups").select("id,name").eq("tenant_id", tid).order("name"),
    ctx.sb.from("subjects").select("id,name").eq("tenant_id", tid).order("name"),
    ctx.sb.from("homework").select("id,title,class_group_id,due_at").eq("tenant_id", tid).gte("due_at", new Date(Date.now() - 14 * 86400_000).toISOString()).order("due_at").limit(300)
  ]);
  const base = appUrl(req);
  return NextResponse.json({
    admin, me: ctx.userId, tools: tools ?? [], links: links ?? [], classes: classes ?? [], subjects: subjects ?? [], homework: homework ?? [],
    platform: admin ? { issuer: base, auth_url: `${base}/api/lti/auth`, token_url: `${base}/api/lti/token`, jwks_url: `${base}/api/lti/jwks` } : null
  });
}

const https = z.string().trim().url().startsWith("https://").max(500);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_tool"), id: z.string().uuid().nullish(), name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).nullish(),
    oidc_login_url: https, target_link_uri: https, redirect_uris: z.array(https).max(10).default([]), jwks_url: https.nullish().or(z.literal("")),
    public_key_pem: z.string().trim().max(5000).nullish(), custom: z.record(z.string().max(200)).default({}),
    send_name: z.boolean().default(true), send_email: z.boolean().default(false), grades: z.boolean().default(true), active: z.boolean().default(true) }),
  z.object({ action: z.literal("delete_tool"), id: z.string().uuid() }),
  z.object({ action: z.literal("add_link"), tool_id: z.string().uuid(), title: z.string().trim().min(1).max(160), class_group_id: z.string().uuid().nullish(),
    subject_id: z.string().uuid().nullish(), homework_id: z.string().uuid().nullish(), target_link_uri: https.nullish().or(z.literal("")),
    custom: z.record(z.string().max(200)).default({}), score_maximum: z.number().positive().max(100000).nullish(), open_in: z.enum(["window", "frame"]).default("window") }),
  z.object({ action: z.literal("delete_link"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const done = (r: { error: any }) => (r.error ? jsonError(r.error.message) : NextResponse.json({ ok: true }));

  if (b.action === "add_link") {
    if (b.class_group_id && !hasAny(ctx, ROLES.admin)) {
      // Teachers add tools to the classes they teach or tutor.
      const svc = createServiceClient();
      const [{ data: o }, { data: f }] = await Promise.all([
        svc.from("subject_offerings").select("id").eq("tenant_id", tid).eq("class_group_id", b.class_group_id).eq("teacher_id", ctx.userId).limit(1),
        svc.from("class_groups").select("id").eq("tenant_id", tid).eq("id", b.class_group_id).eq("form_teacher_id", ctx.userId).limit(1)
      ]);
      if (!o?.length && !f?.length) return jsonError("You can add tools only to classes you teach.", 403);
    }
    return done(await ctx.sb.from("lti_links").insert({ tenant_id: tid, tool_id: b.tool_id, title: b.title, class_group_id: b.class_group_id ?? null, subject_id: b.subject_id ?? null,
      homework_id: b.homework_id ?? null, target_link_uri: b.target_link_uri || null, custom: b.custom, score_maximum: b.score_maximum ?? null, open_in: b.open_in, created_by: ctx.userId }));
  }
  if (b.action === "delete_link") {
    const { data: l } = await ctx.sb.from("lti_links").select("created_by").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
    if (!l) return jsonError("not found", 404);
    if (l.created_by !== ctx.userId && !hasAny(ctx, ROLES.admin)) return jsonError("Only whoever added it (or an admin) can remove it.", 403);
    return done(await ctx.sb.from("lti_links").delete().eq("tenant_id", tid).eq("id", b.id));
  }
  if (!hasAny(ctx, ROLES.admin)) return jsonError("forbidden", 403);
  if (b.action === "delete_tool") return done(await ctx.sb.from("lti_tools").delete().eq("tenant_id", tid).eq("id", b.id));
  if (b.jwks_url && safeWebhookUrl(b.jwks_url)) return jsonError("The tool's key address must be a public https site.");
  if (b.grades && !b.jwks_url && !b.public_key_pem) return jsonError("To accept grades, give the tool's JWKS address or public key.");
  const row = { name: b.name, description: b.description ?? null, oidc_login_url: b.oidc_login_url, target_link_uri: b.target_link_uri, redirect_uris: b.redirect_uris,
    jwks_url: b.jwks_url || null, public_key_pem: b.public_key_pem || null, custom: b.custom, send_name: b.send_name, send_email: b.send_email, grades: b.grades, active: b.active };
  return done(b.id ? await ctx.sb.from("lti_tools").update(row).eq("tenant_id", tid).eq("id", b.id) : await ctx.sb.from("lti_tools").insert({ ...row, tenant_id: tid, created_by: ctx.userId }));
}
