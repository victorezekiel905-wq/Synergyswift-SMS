import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { PROVIDERS, matchGrades, oneNotePage, type Provider } from "@/lib/classroom-sync";
import { providerConfig, googleCourses, teamsClasses, googlePush, teamsPush, googleGrades, teamsGrades, oneNoteSend } from "@/lib/classroom-sync-server";

export const dynamic = "force-dynamic";

/** The classes this person teaches (all classes for admins). */
async function myClasses(svc: any, ctx: any) {
  const tid = ctx.tenant.id;
  const admin = hasAny(ctx, ROLES.admin);
  const [{ data: offerings }, { data: forms }] = await Promise.all([
    (admin ? svc.from("subject_offerings").select("class_group_id,subject_id,class_groups(name),subjects(name)").eq("tenant_id", tid)
      : svc.from("subject_offerings").select("class_group_id,subject_id,class_groups(name),subjects(name)").eq("tenant_id", tid).eq("teacher_id", ctx.userId)),
    (admin ? svc.from("class_groups").select("id,name").eq("tenant_id", tid) : svc.from("class_groups").select("id,name").eq("tenant_id", tid).eq("form_teacher_id", ctx.userId))
  ]);
  const rows = [
    ...(forms ?? []).map((c: any) => ({ class_group_id: c.id, class_name: c.name, subject_id: null as string | null, subject: null as string | null })),
    ...(offerings ?? []).map((o: any) => ({ class_group_id: o.class_group_id, class_name: o.class_groups?.name ?? "", subject_id: o.subject_id, subject: o.subjects?.name ?? "" }))
  ];
  return rows.sort((a, b) => a.class_name.localeCompare(b.class_name, undefined, { numeric: true }) || String(a.subject ?? "").localeCompare(String(b.subject ?? "")));
}
const teaches = (classes: { class_group_id: string }[], id: string) => classes.some(c => c.class_group_id === id);

export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const tid = ctx.tenant.id;
  const u = new URL(req.url).searchParams;
  const list = u.get("courses");
  if (list === "google" || list === "microsoft") {
    try { return NextResponse.json({ courses: list === "google" ? await googleCourses(svc, ctx.userId) : await teamsClasses(svc, ctx.userId) }); }
    catch (e) { return jsonError((e as Error).message, 502); }
  }
  const classes = await myClasses(svc, ctx);
  const ids = [...new Set(classes.map(c => c.class_group_id))];
  const [{ data: conns }, { data: links }, { data: hw }, { data: notes }] = await Promise.all([
    svc.from("oauth_connections").select("provider,account_email,updated_at").eq("user_id", ctx.userId),
    ids.length ? svc.from("class_links").select("id,class_group_id,subject_id,provider,external_id,external_name,external_url").eq("tenant_id", tid).in("class_group_id", ids) : { data: [] },
    ids.length ? svc.from("homework").select("id,title,due_at,class_group_id,subject_id,max_score,class_groups(name),subjects(name),homework_external(provider,external_url,pushed_at,grades_pulled_at)")
      .eq("tenant_id", tid).in("class_group_id", ids).gte("due_at", new Date(Date.now() - 30 * 86400_000).toISOString()).order("due_at", { ascending: false }).limit(100) : { data: [] },
    svc.from("lesson_notes").select("id,topic,week,onenote_url,updated_at,subjects(name),class_groups(name)").eq("tenant_id", tid).eq("author_id", ctx.userId).order("updated_at", { ascending: false }).limit(30)
  ]);
  return NextResponse.json({
    configured: { google: Boolean(providerConfig("google")), microsoft: Boolean(providerConfig("microsoft")) },
    connections: conns ?? [], classes, links: links ?? [], homework: hw ?? [], notes: notes ?? []
  });
}

const P = z.enum(["google", "microsoft"]);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("disconnect"), provider: P }),
  z.object({ action: z.literal("link_class"), provider: P, class_group_id: z.string().uuid(), subject_id: z.string().uuid().nullish(), external_id: z.string().min(1).max(200), external_name: z.string().max(200).nullish(), external_url: z.string().url().max(500).nullish() }),
  z.object({ action: z.literal("unlink"), id: z.string().uuid() }),
  z.object({ action: z.literal("push_homework"), provider: P, homework_id: z.string().uuid() }),
  z.object({ action: z.literal("pull_grades"), provider: P, homework_id: z.string().uuid() }),
  z.object({ action: z.literal("onenote"), lesson_note_id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();
  const tid = ctx.tenant.id;
  try {
    if (b.action === "disconnect") {
      await svc.from("oauth_connections").delete().eq("user_id", ctx.userId).eq("provider", b.provider);
      return NextResponse.json({ ok: true });
    }
    if (b.action === "onenote") {
      const { data: n } = await svc.from("lesson_notes").select("id,author_id,topic,content,week,subjects(name),class_groups(name)").eq("tenant_id", tid).eq("id", b.lesson_note_id).maybeSingle();
      if (!n || n.author_id !== ctx.userId) return jsonError("You can send only your own lesson notes.", 403);
      const url = await oneNoteSend(svc, ctx.userId, oneNotePage({ topic: n.topic, content: n.content ?? "", week: n.week, subject: (n as any).subjects?.name, class_name: (n as any).class_groups?.name }));
      await svc.from("lesson_notes").update({ onenote_url: url }).eq("id", n.id);
      return NextResponse.json({ ok: true, url });
    }
    const classes = await myClasses(svc, ctx);
    if (b.action === "link_class") {
      if (!teaches(classes, b.class_group_id)) return jsonError("You can link only classes you teach.", 403);
      let del = svc.from("class_links").delete().eq("tenant_id", tid).eq("class_group_id", b.class_group_id).eq("provider", b.provider);
      del = b.subject_id ? del.eq("subject_id", b.subject_id) : del.is("subject_id", null);
      await del;
      const { error } = await svc.from("class_links").insert({ tenant_id: tid, class_group_id: b.class_group_id, subject_id: b.subject_id ?? null, provider: b.provider,
        external_id: b.external_id, external_name: b.external_name ?? null, external_url: b.external_url ?? null, linked_by: ctx.userId });
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    if (b.action === "unlink") {
      const { data: l } = await svc.from("class_links").select("class_group_id").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
      if (!l || !teaches(classes, l.class_group_id)) return jsonError("not found", 404);
      await svc.from("class_links").delete().eq("id", b.id);
      return NextResponse.json({ ok: true });
    }

    const { data: hw } = await svc.from("homework").select("id,title,instructions,due_at,max_score,attachment_url,class_group_id,subject_id").eq("tenant_id", tid).eq("id", b.homework_id).maybeSingle();
    if (!hw || !teaches(classes, hw.class_group_id)) return jsonError("You can send only homework for classes you teach.", 403);
    const { data: links } = await svc.from("class_links").select("id,subject_id,external_id").eq("tenant_id", tid).eq("class_group_id", hw.class_group_id).eq("provider", b.provider);
    const link = (links ?? []).find((l: any) => l.subject_id && l.subject_id === hw.subject_id) ?? (links ?? []).find((l: any) => !l.subject_id);
    if (!link) return jsonError(`Link this class to a ${PROVIDERS[b.provider as Provider].label} ${b.provider === "google" ? "course" : "class"} first.`, 409);

    if (b.action === "push_homework") {
      const { data: done } = await svc.from("homework_external").select("external_url").eq("homework_id", hw.id).eq("provider", b.provider).maybeSingle();
      if (done) return jsonError("This homework was already sent there.", 409);
      const h = { title: hw.title, instructions: hw.instructions, due_at: hw.due_at, max_score: hw.max_score === null ? null : Number(hw.max_score), attachment_url: hw.attachment_url, link: `${appUrl(req)}/student` };
      const made = b.provider === "google" ? await googlePush(svc, ctx.userId, link.external_id, h) : await teamsPush(svc, ctx.userId, link.external_id, h);
      await svc.from("homework_external").insert({ homework_id: hw.id, provider: b.provider, tenant_id: tid, class_link_id: link.id, external_id: made.id, external_url: made.url, pushed_by: ctx.userId });
      return NextResponse.json({ ok: true, url: made.url });
    }

    // pull_grades
    const { data: ext } = await svc.from("homework_external").select("external_id").eq("homework_id", hw.id).eq("provider", b.provider).maybeSingle();
    if (!ext) return jsonError("Send this homework there first.", 409);
    const grades = b.provider === "google" ? await googleGrades(svc, ctx.userId, link.external_id, ext.external_id) : await teamsGrades(svc, ctx.userId, link.external_id, ext.external_id);
    const { data: kids } = await svc.from("students").select("id,users(email)").eq("tenant_id", tid).eq("class_group_id", hw.class_group_id).eq("status", "active");
    const { matched, unmatched } = matchGrades(grades, (kids ?? []).map((k: any) => ({ id: k.id, email: k.users?.email ?? null })), hw.max_score === null ? null : Number(hw.max_score));
    const { data: existing } = matched.length ? await svc.from("homework_submissions").select("id,student_id,marked_by").eq("homework_id", hw.id).in("student_id", matched.map(m => m.student_id)) : { data: [] };
    const have = new Map((existing ?? []).map((e: any) => [e.student_id, e]));
    let saved = 0, kept = 0;
    for (const m of matched) {
      const e: any = have.get(m.student_id);
      if (e?.marked_by && e.marked_by !== ctx.userId) { kept++; continue; } // another teacher's mark stands
      const row = { score: m.score, marked_by: ctx.userId, marked_at: new Date().toISOString() };
      if (e) await svc.from("homework_submissions").update(row).eq("id", e.id);
      else await svc.from("homework_submissions").insert({ ...row, homework_id: hw.id, tenant_id: tid, student_id: m.student_id, body: `Handed in on ${PROVIDERS[b.provider as Provider].label}.` });
      saved++;
    }
    await svc.from("homework_external").update({ grades_pulled_at: new Date().toISOString() }).eq("homework_id", hw.id).eq("provider", b.provider);
    return NextResponse.json({ ok: true, saved, kept, unmatched });
  } catch (e) {
    return jsonError((e as Error).message, 502);
  }
}
