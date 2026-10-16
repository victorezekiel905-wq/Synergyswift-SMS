import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { readUpload } from "@/lib/files";
import { localParts } from "@/lib/attendance";
import { FRAMEWORKS, readiness, documentAlerts, scrMatrix } from "@/lib/compliance";

export const dynamic = "force-dynamic";

const MANAGERS = [...ROLES.admin, "qa_officer", "hr_manager"];
const CATEGORIES = ["policy", "certificate", "inspection", "minutes", "risk_assessment", "procedure", "report", "plan", "other"] as const;
const TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx" };

/**
 * Compliance. ?view=library (default) documents, read-receipts and alerts;
 * ?file=<id> opens a document; ?view=scr the single central record (HR);
 * ?view=inspection frameworks, progress and readiness.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx([...ROLES.staff, "parent"]);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const u = new URL(req.url).searchParams;
  const svc = createServiceClient();
  const manager = hasAny(ctx, MANAGERS);
  const today = localParts(new Date(), ctx.tenant.timezone).date;

  const file = u.get("file");
  if (file) {
    const { data: d } = await ctx.sb.from("school_documents").select("path").eq("tenant_id", tid).eq("id", file).maybeSingle();
    if (!d?.path) return jsonError("not found", 404);
    const { data } = await svc.storage.from("school-documents").createSignedUrl(d.path, 300);
    return data?.signedUrl ? NextResponse.redirect(data.signedUrl) : jsonError("not found", 404);
  }
  const view = u.get("view") ?? "library";
  if (view === "scr") {
    if (!hasAny(ctx, ROLES.hr)) return jsonError("forbidden", 403);
    const [{ data: staff }, { data: checks }] = await Promise.all([
      ctx.sb.from("staff").select("id,full_name,position,hire_date").eq("tenant_id", tid).neq("status", "exited").order("full_name"),
      ctx.sb.from("staff_checks").select("id,staff_id,kind,outcome,checked_on,expires_on,reference_no,notes,users:checked_by(full_name)").eq("tenant_id", tid).order("checked_on", { ascending: false })
    ]);
    return NextResponse.json({ matrix: scrMatrix((staff ?? []).map((s: any) => ({ id: s.id, name: s.full_name })), checks ?? [], today), staff: staff ?? [], checks: checks ?? [] });
  }
  if (view === "inspection") {
    if (!hasAny(ctx, ROLES.staff)) return jsonError("forbidden", 403);
    const [{ data: settings }, { data: progress }, { data: docs }, { data: staff }] = await Promise.all([
      ctx.sb.from("tenant_settings").select("inspection_frameworks").eq("tenant_id", tid).maybeSingle(),
      ctx.sb.from("inspection_progress").select("framework,requirement_key,status,owner_id,notes,document_ids,review_on,updated_at").eq("tenant_id", tid),
      ctx.sb.from("school_documents").select("id,title,category,status").eq("tenant_id", tid).in("status", ["approved", "draft"]).order("title"),
      svc.from("users").select("id,full_name").eq("tenant_id", tid).eq("active", true).not("role", "in", "(parent,student)").order("full_name")
    ]);
    const chosen: string[] = settings?.inspection_frameworks?.length ? settings.inspection_frameworks : [];
    return NextResponse.json({
      manager: hasAny(ctx, [...ROLES.admin, "qa_officer"]), me: ctx.userId, chosen,
      frameworks: FRAMEWORKS.map(f => ({ ...f, readiness: readiness(f, (progress ?? []) as any) })),
      progress: progress ?? [], documents: docs ?? [], staff: staff ?? []
    });
  }
  const [{ data: docs }, { data: mine }] = await Promise.all([
    ctx.sb.from("school_documents").select("id,family_id,version,title,category,description,path,mime,size_bytes,visibility,status,approved_at,review_due_on,expires_on,issued_by,reference_no,tags,requires_ack,owner_id,updated_at,users:owner_id(full_name)")
      .eq("tenant_id", tid).neq("status", "archived").order("category").order("title").order("version", { ascending: false }),
    ctx.sb.from("document_acknowledgements").select("document_id,acknowledged_at").eq("user_id", ctx.userId)
  ]);
  let acks: Record<string, number> = {}, staffCount = 0;
  if (manager) {
    const ids = (docs ?? []).filter((d: any) => d.requires_ack && d.status === "approved").map((d: any) => d.id);
    const [{ data: all }, { count }] = await Promise.all([
      ids.length ? ctx.sb.from("document_acknowledgements").select("document_id").in("document_id", ids) : { data: [] },
      svc.from("users").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("active", true).not("role", "in", "(parent,student)")
    ]);
    for (const a of all ?? []) acks[a.document_id] = (acks[a.document_id] ?? 0) + 1;
    staffCount = count ?? 0;
  }
  return NextResponse.json({
    manager, documents: docs ?? [], my_acks: mine ?? [], acks, staff_count: staffCount,
    alerts: manager ? documentAlerts((docs ?? []) as any, today) : []
  });
}

/** Uploads a document (multipart) or makes changes (JSON). */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) return upload(req, ctx);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const done = (r: { error: any }) => (r.error ? jsonError(r.error.message) : NextResponse.json({ ok: true }));
  switch (b.action) {
    case "acknowledge":
      return done(await ctx.sb.from("document_acknowledgements").upsert({ document_id: b.id, user_id: ctx.userId, tenant_id: tid }, { onConflict: "document_id,user_id", ignoreDuplicates: true }));
    case "update_document": {
      const { id, ...patch } = b;
      return done(await ctx.sb.from("school_documents").update(patch).eq("tenant_id", tid).eq("id", id));
    }
    case "approve": return done(await ctx.sb.from("school_documents").update({ status: "approved" }).eq("tenant_id", tid).eq("id", b.id));
    case "archive": return done(await ctx.sb.from("school_documents").update({ status: "archived" }).eq("tenant_id", tid).eq("id", b.id));
    case "delete_draft": {
      const { data: d } = await ctx.sb.from("school_documents").select("path,status").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
      if (!d || d.status !== "draft") return jsonError("Only drafts can be deleted; archive approved documents instead.");
      const r = await ctx.sb.from("school_documents").delete().eq("id", b.id);
      if (!r.error && d.path) await createServiceClient().storage.from("school-documents").remove([d.path]);
      return done(r);
    }
    case "save_check": {
      const { action: _a, id, ...row } = b;
      const data = { ...row, checked_on: row.checked_on || null, expires_on: row.expires_on || null, reference_no: row.reference_no || null, notes: row.notes || null, checked_by: ctx.userId };
      return done(id ? await ctx.sb.from("staff_checks").update(data).eq("tenant_id", tid).eq("id", id) : await ctx.sb.from("staff_checks").insert({ ...data, tenant_id: tid }));
    }
    case "delete_check": return done(await ctx.sb.from("staff_checks").delete().eq("tenant_id", tid).eq("id", b.id));
    case "set_frameworks": {
      if (!hasAny(ctx, ROLES.admin)) return jsonError("forbidden", 403);
      const ids = b.ids.filter(i => FRAMEWORKS.some(f => f.id === i));
      return done(await ctx.sb.from("tenant_settings").upsert({ tenant_id: tid, inspection_frameworks: ids, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" }));
    }
    case "save_progress": {
      const f = FRAMEWORKS.find(x => x.id === b.framework);
      if (!f || !f.areas.some(a => a.items.some(i => i.key === b.requirement_key))) return jsonError("unknown requirement");
      const { action: _a, ...row } = b;
      return done(await ctx.sb.from("inspection_progress").upsert({ ...row, tenant_id: tid, owner_id: row.owner_id ?? null, notes: row.notes ?? null, review_on: row.review_on || null,
        updated_by: ctx.userId, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,framework,requirement_key" }));
    }
  }
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("acknowledge"), id: z.string().uuid() }),
  z.object({ action: z.literal("update_document"), id: z.string().uuid(), title: z.string().trim().min(2).max(200).optional(), category: z.enum(CATEGORIES).optional(),
    description: z.string().max(2000).nullish(), visibility: z.enum(["leaders", "staff", "parents"]).optional(), review_due_on: DATE.nullish(), expires_on: DATE.nullish(),
    issued_by: z.string().max(200).nullish(), reference_no: z.string().max(100).nullish(), tags: z.array(z.string().max(40)).max(20).optional(), requires_ack: z.boolean().optional(),
    owner_id: z.string().uuid().nullish() }),
  z.object({ action: z.literal("approve"), id: z.string().uuid() }),
  z.object({ action: z.literal("archive"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete_draft"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_check"), id: z.string().uuid().nullish(), staff_id: z.string().uuid(),
    kind: z.enum(["identity", "right_to_work", "qualifications", "references", "police_check", "overseas_police_check", "prohibition_check", "medical_fitness", "safeguarding_training", "first_aid_training", "other"]),
    outcome: z.enum(["clear", "concern", "pending", "not_required"]), checked_on: DATE.nullish().or(z.literal("")), expires_on: DATE.nullish().or(z.literal("")),
    reference_no: z.string().max(100).nullish(), notes: z.string().max(1000).nullish() }),
  z.object({ action: z.literal("delete_check"), id: z.string().uuid() }),
  z.object({ action: z.literal("set_frameworks"), ids: z.array(z.string().max(30)).max(10) }),
  z.object({ action: z.literal("save_progress"), framework: z.string().max(30), requirement_key: z.string().max(60), status: z.enum(["not_started", "in_progress", "met", "not_applicable"]),
    owner_id: z.string().uuid().nullish(), notes: z.string().max(4000).nullish(), document_ids: z.array(z.string().uuid()).max(30).default([]), review_on: DATE.nullish().or(z.literal("")) })
]);

async function upload(req: NextRequest, ctx: any) {
  if (!hasAny(ctx, MANAGERS)) return jsonError("Only leaders, QA and HR add documents.", 403);
  const tid = ctx.tenant.id;
  const form = await req.formData().catch(() => null);
  if (!form) return jsonError("invalid form");
  const s = (k: string) => { const v = String(form.get(k) ?? "").trim(); return v || null; };
  const category = s("category") ?? "other";
  if (!(CATEGORIES as readonly string[]).includes(category)) return jsonError("choose a category");
  const title = s("title");
  if (!title || title.length < 2) return jsonError("give the document a title");
  const date = (k: string) => { const v = s(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
  let family = s("family_id"), version = 1;
  if (family) {
    const { data: prev } = await ctx.sb.from("school_documents").select("version").eq("tenant_id", tid).eq("family_id", family).order("version", { ascending: false }).limit(1);
    if (!prev?.length) return jsonError("the earlier version was not found", 404);
    version = prev[0].version + 1;
  } else family = randomUUID();
  const svc = createServiceClient();
  let path: string | null = null, mime: string | null = null, size: number | null = null;
  if (form.get("file") && typeof form.get("file") !== "string") {
    const r = await readUpload(form.get("file"), TYPES, 20);
    if (!r.ok) return jsonError(r.error, r.status);
    path = `${tid}/${family}/${version}-${randomUUID()}.${r.ext}`;
    const up = await svc.storage.from("school-documents").upload(path, r.buf, { contentType: r.type, upsert: false });
    if (up.error) return jsonError("could not store the file; try again");
    mime = r.type; size = r.size;
  }
  const visibility = ["leaders", "staff", "parents"].includes(s("visibility") ?? "") ? s("visibility") : "staff";
  const { data, error } = await ctx.sb.from("school_documents").insert({
    tenant_id: tid, family_id: family, version, title, category, description: s("description"), path, mime, size_bytes: size, visibility,
    status: form.get("approve") === "true" && hasAny(ctx, ROLES.admin) ? "approved" : "draft",
    review_due_on: date("review_due_on"), expires_on: date("expires_on"), issued_by: s("issued_by"), reference_no: s("reference_no"),
    tags: (s("tags") ?? "").split(",").map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 20), requires_ack: form.get("requires_ack") === "true",
    owner_id: s("owner_id") ?? ctx.userId, created_by: ctx.userId
  }).select("id").single();
  if (error) { if (path) await svc.storage.from("school-documents").remove([path]); return jsonError(error.message); }
  return NextResponse.json({ id: data.id, version }, { status: 201 });
}
