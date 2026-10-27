import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { notifyContact } from "@/lib/notify";
import { admissionNote } from "@/lib/messaging/notices";

export const dynamic = "force-dynamic";

const TEACHERS = [...ROLES.admin, "teacher"] as const;
const isOfficer = (roles: Set<string>) => ROLES.admin.some(r => roles.has(r));

/**
 * Elections (phase 14f). Officers (school admins) set up elections, posts and candidates,
 * open and close voting, see turnout and results, and publish them. Teachers see open
 * elections to run a voting tablet for their classes.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(TEACHERS, "elections");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    const [{ data: elections, error }, { data: classes }] = await Promise.all([
      ctx.sb.from("elections").select("id,title,kind,audience,status,opens_at,closes_at,allow_kiosk,class_group_ids,election_posts(count),election_candidates(count)")
        .eq("tenant_id", tid).order("created_at", { ascending: false }).limit(100),
      ctx.sb.from("class_groups").select("id,name").eq("tenant_id", tid).order("name")
    ]);
    if (error) return jsonError(error.message.includes("elections") ? "Elections need the database update (migration 20260101006300)." : error.message);
    return NextResponse.json({ elections: elections ?? [], classes: classes ?? [], officer: isOfficer(ctx.roles) });
  }
  const { data: e } = await ctx.sb.from("elections").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle();
  if (!e) return jsonError("election not found", 404);
  const [{ data: posts }, { data: candidates }, turnout, results] = await Promise.all([
    ctx.sb.from("election_posts").select("*").eq("election_id", id).order("position"),
    ctx.sb.from("election_candidates").select("*").eq("election_id", id).order("position"),
    isOfficer(ctx.roles) ? ctx.sb.rpc("election_turnout", { p_election: id }).then((r: { data: unknown }) => r.data ?? null) : Promise.resolve(null),
    ctx.sb.rpc("election_results", { p_election: id }).then((r: { data: unknown; error: unknown }) => (r.error ? null : r.data))
  ]);
  return NextResponse.json({ election: e, posts: posts ?? [], candidates: candidates ?? [], turnout, results, officer: isOfficer(ctx.roles) });
}

const iso = z.string().datetime({ offset: true });
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().nullish(), title: z.string().trim().min(2).max(160), kind: z.enum(["prefects", "pta", "class_rep", "house", "staff", "other"]),
    description: z.string().trim().max(3000).nullish(), audience: z.enum(["students", "parents", "staff", "everyone"]), class_group_ids: z.array(z.string().uuid()).max(500).nullish(),
    one_per_family: z.boolean().default(false), allow_kiosk: z.boolean().default(true), live_results: z.boolean().default(false), publish_to_voters: z.boolean().default(true),
    opens_at: iso.nullish(), closes_at: iso.nullish() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_post"), election_id: z.string().uuid(), id: z.string().uuid().nullish(), title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).nullish(), seats: z.number().int().min(1).max(50), position: z.number().int().min(0).max(1000).default(0) }),
  z.object({ action: z.literal("delete_post"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_candidate"), election_id: z.string().uuid(), post_id: z.string().uuid(), id: z.string().uuid().nullish(), name: z.string().trim().min(1).max(120),
    student_id: z.string().uuid().nullish(), photo_url: z.string().trim().url().max(500).nullish().or(z.literal("")), manifesto: z.string().trim().max(4000).nullish(), position: z.number().int().min(0).max(1000).default(0) }),
  z.object({ action: z.literal("delete_candidate"), id: z.string().uuid() }),
  z.object({ action: z.enum(["open", "close", "publish"]), id: z.string().uuid(), notify: z.boolean().default(true) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "elections");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const audit = (action: string, target: string, meta: Record<string, unknown> = {}) => ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action, target, meta });
  const election = async (id: string) => (await ctx.sb.from("elections").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle()).data as any;

  switch (b.action) {
    case "save": {
      const { action: _a, id, ...row } = b;
      if (row.opens_at && row.closes_at && new Date(row.closes_at) <= new Date(row.opens_at)) return jsonError("Voting must close after it opens.");
      if (id) {
        const cur = await election(id);
        if (!cur) return jsonError("election not found", 404);
        // Once voting has started, who votes can no longer change.
        const fixed = cur.status !== "draft" ? { audience: cur.audience, class_group_ids: cur.class_group_ids, one_per_family: cur.one_per_family } : {};
        const { data, error } = await ctx.sb.from("elections").update({ ...row, class_group_ids: row.class_group_ids?.length ? row.class_group_ids : null, ...fixed, updated_at: new Date().toISOString() })
          .eq("tenant_id", tid).eq("id", id).select("*").single();
        if (error) return jsonError(error.message);
        await audit("elections.updated", id);
        return NextResponse.json({ ok: true, election: data });
      }
      const { data, error } = await ctx.sb.from("elections").insert({ ...row, class_group_ids: row.class_group_ids?.length ? row.class_group_ids : null, tenant_id: tid, created_by: ctx.userId })
        .select("*").single();
      if (error) return jsonError(error.message);
      await audit("elections.created", data.id, { title: data.title });
      return NextResponse.json({ ok: true, election: data });
    }
    case "delete": {
      const cur = await election(b.id);
      if (!cur) return jsonError("election not found", 404);
      if (!["draft"].includes(cur.status)) return jsonError("Only a draft can be deleted. Close the election instead; its results are kept.");
      const { error } = await ctx.sb.from("elections").delete().eq("tenant_id", tid).eq("id", b.id);
      if (error) return jsonError(error.message);
      await audit("elections.deleted", b.id, { title: cur.title });
      return NextResponse.json({ ok: true });
    }
    case "save_post": {
      const { action: _a, id, ...row } = b;
      const q = id ? ctx.sb.from("election_posts").update({ ...row, description: row.description ?? null }).eq("tenant_id", tid).eq("id", id)
        : ctx.sb.from("election_posts").insert({ ...row, description: row.description ?? null, tenant_id: tid });
      const { data, error } = await q.select("*").single();
      return error ? jsonError(error.message) : NextResponse.json({ ok: true, post: data });
    }
    case "delete_post": {
      const { error } = await ctx.sb.from("election_posts").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "save_candidate": {
      const { action: _a, id, ...row } = b;
      if (row.student_id) {
        const { data: s } = await ctx.sb.from("students").select("id").eq("tenant_id", tid).eq("id", row.student_id).maybeSingle();
        if (!s) return jsonError("That student is not in your school.");
      }
      const values = { ...row, student_id: row.student_id ?? null, photo_url: row.photo_url || null, manifesto: row.manifesto ?? null };
      const q = id ? ctx.sb.from("election_candidates").update(values).eq("tenant_id", tid).eq("id", id) : ctx.sb.from("election_candidates").insert({ ...values, tenant_id: tid });
      const { data, error } = await q.select("*").single();
      return error ? jsonError(error.message) : NextResponse.json({ ok: true, candidate: data });
    }
    case "delete_candidate": {
      const { error } = await ctx.sb.from("election_candidates").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "open": case "close": case "publish": {
      const cur = await election(b.id);
      if (!cur) return jsonError("election not found", 404);
      if (b.action === "open") {
        const { data: posts } = await ctx.sb.from("election_posts").select("id,election_candidates(count)").eq("election_id", b.id);
        if (!posts?.length || posts.some((p: any) => !(p.election_candidates?.[0]?.count > 0))) return jsonError("Every post needs at least one candidate before voting opens.");
      }
      if (b.action === "publish" && !["closed", "published"].includes(cur.status) && !(cur.closes_at && new Date(cur.closes_at) <= new Date())) return jsonError("Close voting before publishing results.");
      const status = b.action === "open" ? "open" : b.action === "close" ? "closed" : "published";
      const extra = b.action === "close" && cur.closes_at && new Date(cur.closes_at) > new Date() ? { closes_at: new Date().toISOString() } : {};
      const { error } = await ctx.sb.from("elections").update({ status, ...extra, updated_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.id);
      if (error) return jsonError(error.message);
      await audit(`elections.${b.action}`, b.id, { title: cur.title });
      const sent = b.notify && b.action !== "close" ? await tellVoters(cur, b.action, appUrl(req)) : 0;
      return NextResponse.json({ ok: true, status, messages_queued: sent });
    }
  }
}

/**
 * Tells parents (and staff) when voting opens or results are published. Students see it in
 * their portal (Vote). Messages are queued; the dispatch run sends them.
 */
async function tellVoters(e: any, what: "open" | "publish", base: string) {
  if (what === "publish" && !e.publish_to_voters) return 0;
  const svc = createServiceClient();
  const link = `${base}/vote/${e.id}`;
  const when = e.closes_at ? new Date(e.closes_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : null;
  const lines = what === "open"
    ? [`Voting is open: ${e.title}.`, when ? `Vote before ${when}.` : "Vote online with your school sign-in.", "Your vote is secret: the school can see that you voted, never who you chose."]
    : [`The results of ${e.title} are out.`];
  const people: { name: string; email: string | null; phone: string | null }[] = [];
  if (["parents", "everyone"].includes(e.audience)) {
    let q = svc.from("student_guardians").select("guardians!inner(id,full_name,email,phone,user_id),students!inner(status,class_group_id)")
      .eq("tenant_id", e.tenant_id).eq("students.status", "active").not("guardians.user_id", "is", null).limit(20000);
    if (e.class_group_ids?.length) q = q.in("students.class_group_id", e.class_group_ids);
    const { data } = await q;
    const seen = new Set<string>();
    for (const r of data ?? []) {
      const g = (r as any).guardians;
      if (!g || seen.has(g.id)) continue;
      seen.add(g.id);
      people.push({ name: g.full_name, email: g.email, phone: g.phone });
    }
  }
  if (["staff", "everyone"].includes(e.audience)) {
    const { data } = await svc.from("users").select("full_name,email,phone,role,active").eq("tenant_id", e.tenant_id).not("role", "in", "(student,parent,alumni)").limit(5000);
    for (const u of data ?? []) if ((u as any).active !== false) people.push({ name: (u as any).full_name, email: (u as any).email, phone: (u as any).phone ?? null });
  }
  let sent = 0;
  for (const p of people) {
    sent += await notifyContact(svc, { tenantId: e.tenant_id, name: p.name, email: p.email, phone: p.phone, kind: "election", refId: e.id, defer: true,
      build: br => admissionNote(br, { name: p.name, subject: what === "open" ? `Vote: ${e.title}` : `Results: ${e.title}`, lines, link, linkLabel: what === "open" ? "Vote now" : "See the results" }) }).catch(() => 0);
  }
  return sent;
}
