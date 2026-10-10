import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { importGraduates, CrmError } from "@/lib/community-server";

export const dynamic = "force-dynamic";

/** The alumni directory, with each person's interactions on ?id=. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "community");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const [{ data: a }, { data: log }] = await Promise.all([
      ctx.sb.from("alumni").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle(),
      ctx.sb.from("crm_interactions").select("id,kind,body,occurred_at,users:actor_id(full_name)").eq("tenant_id", tid).eq("alumni_id", id).order("occurred_at", { ascending: false }).limit(100)
    ]);
    if (!a) return jsonError("not found", 404);
    return NextResponse.json({ alumnus: { ...a, update_link: `${appUrl(req)}/alumni/update/${a.update_token}` }, log: log ?? [] });
  }
  const svc = createServiceClient();
  const [{ data, error }, { data: t }, { count: graduates }] = await Promise.all([
    ctx.sb.from("alumni").select("id,full_name,graduation_year,last_class,email,phone,occupation,employer,further_study,city,country,mentor,consent_contact,status,source,created_at")
      .eq("tenant_id", tid).order("graduation_year", { ascending: false, nullsFirst: false }).order("full_name").limit(5000),
    svc.from("tenants").select("public_slug").eq("id", tid).maybeSingle(),
    svc.from("students").select("id", { count: "exact", head: true }).eq("tenant_id", tid).eq("status", "graduated")
  ]);
  if (error) return jsonError(error.message);
  const items = data ?? [];
  return NextResponse.json({
    items, join_link: t?.public_slug ? `${appUrl(req)}/alumni/join/${t.public_slug}` : null,
    stats: { total: items.length, pending: items.filter((a: any) => a.status === "pending").length, mentors: items.filter((a: any) => a.mentor && a.status === "active").length,
      reachable: items.filter((a: any) => a.consent_contact && (a.email || a.phone)).length, graduates: graduates ?? 0 }
  });
}

const Fields = {
  full_name: z.string().trim().min(2).max(160), graduation_year: z.number().int().min(1900).max(2200).nullish(), last_class: z.string().trim().max(60).nullish(),
  email: z.string().trim().email().max(200).nullish().or(z.literal("")), phone: z.string().trim().max(30).nullish(), occupation: z.string().trim().max(120).nullish(),
  employer: z.string().trim().max(120).nullish(), further_study: z.string().trim().max(200).nullish(), city: z.string().trim().max(80).nullish(), country: z.string().trim().max(80).nullish(),
  linkedin: z.string().trim().url().max(300).nullish().or(z.literal("")), mentor: z.boolean().default(false), consent_contact: z.boolean().default(true), notes: z.string().trim().max(2000).nullish()
};
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().nullish(), ...Fields }),
  z.object({ action: z.literal("status"), id: z.string().uuid(), status: z.enum(["pending", "active", "archived"]) }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("import_graduates") }),
  z.object({ action: z.literal("log"), id: z.string().uuid(), kind: z.enum(["note", "call", "meeting", "email", "visit", "other"]), body: z.string().trim().min(1).max(4000) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "community");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  try {
    switch (b.action) {
      case "save": {
        const { action: _a, id, ...row } = b;
        const clean = { ...row, email: row.email || null, linkedin: row.linkedin || null, updated_at: new Date().toISOString() };
        const { data, error } = id
          ? await ctx.sb.from("alumni").update(clean).eq("tenant_id", tid).eq("id", id).select("id").single()
          : await ctx.sb.from("alumni").insert({ ...clean, tenant_id: tid, source: "staff", status: "active" }).select("id").single();
        return error ? jsonError(error.message) : NextResponse.json({ ok: true, id: data.id });
      }
      case "status": {
        const { error } = await ctx.sb.from("alumni").update({ status: b.status, updated_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "delete": {
        const { error } = await ctx.sb.from("alumni").delete().eq("tenant_id", tid).eq("id", b.id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "import_graduates":
        return NextResponse.json({ ok: true, added: await importGraduates(createServiceClient(), tid) });
      case "log": {
        const { error } = await ctx.sb.from("crm_interactions").insert({ tenant_id: tid, alumni_id: b.id, kind: b.kind, body: b.body, actor_id: ctx.userId });
        return error ? jsonError(error.message) : NextResponse.json({ ok: true }, { status: 201 });
      }
    }
  } catch (e) {
    if (e instanceof CrmError) return jsonError(e.message, e.status);
    return jsonError((e as Error).message);
  }
}
