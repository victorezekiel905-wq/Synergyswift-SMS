import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";

/** Academic sessions with their terms. */
export async function GET() {
  const ctx = await requireCtx();
  if (ctx instanceof NextResponse) return ctx;
  const { data, error } = await ctx.sb.from("academic_sessions")
    .select("id,name,starts_on,ends_on,is_current,terms(id,name,position,starts_on,ends_on,next_term_begins,is_current)")
    .eq("tenant_id", ctx.tenant.id).order("starts_on", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  if (error) return jsonError(error.message);
  for (const s of data ?? []) s.terms?.sort((a: any, b: any) => a.position - b.position);
  return NextResponse.json(data ?? []);
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish();
const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("session"), name: z.string().trim().min(3).max(40), starts_on: date, ends_on: date,
    with_terms: z.array(z.string().trim().min(1)).max(6).optional() }),
  z.object({ kind: z.literal("term"), session_id: z.string().uuid(), name: z.string().trim().min(1).max(40),
    position: z.number().int().min(1).max(6).default(1), starts_on: date, ends_on: date, next_term_begins: date }),
  z.object({ kind: z.literal("set_current_term"), term_id: z.string().uuid() }),
  z.object({ kind: z.literal("update_term"), term_id: z.string().uuid(), starts_on: date, ends_on: date, next_term_begins: date })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;

  if (b.kind === "session") {
    const { data: s, error } = await ctx.sb.from("academic_sessions")
      .insert({ tenant_id: tid, name: b.name, starts_on: b.starts_on ?? null, ends_on: b.ends_on ?? null }).select("id").single();
    if (error) return jsonError(error.message.includes("duplicate") ? "a session with that name exists" : error.message);
    const terms = b.with_terms ?? ["First Term", "Second Term", "Third Term"];
    if (terms.length) {
      const { error: tErr } = await ctx.sb.from("terms").insert(terms.map((name, i) => ({ tenant_id: tid, session_id: s.id, name, position: i + 1 })));
      if (tErr) return jsonError(tErr.message);
    }
    return NextResponse.json(s, { status: 201 });
  }
  if (b.kind === "term") {
    const { data, error } = await ctx.sb.from("terms").insert({
      tenant_id: tid, session_id: b.session_id, name: b.name, position: b.position,
      starts_on: b.starts_on ?? null, ends_on: b.ends_on ?? null, next_term_begins: b.next_term_begins ?? null
    }).select("id").single();
    if (error) return jsonError(error.message);
    return NextResponse.json(data, { status: 201 });
  }
  if (b.kind === "update_term") {
    const { error } = await ctx.sb.from("terms").update({
      starts_on: b.starts_on ?? null, ends_on: b.ends_on ?? null, next_term_begins: b.next_term_begins ?? null
    }).eq("tenant_id", tid).eq("id", b.term_id);
    if (error) return jsonError(error.message);
    return NextResponse.json({ ok: true });
  }
  // set_current_term: exactly one current term and session per tenant
  const { data: term } = await ctx.sb.from("terms").select("id,session_id").eq("tenant_id", tid).eq("id", b.term_id).maybeSingle();
  if (!term) return jsonError("term not found", 404);
  await ctx.sb.from("terms").update({ is_current: false }).eq("tenant_id", tid).eq("is_current", true);
  await ctx.sb.from("academic_sessions").update({ is_current: false }).eq("tenant_id", tid).eq("is_current", true);
  await ctx.sb.from("terms").update({ is_current: true }).eq("id", term.id);
  await ctx.sb.from("academic_sessions").update({ is_current: true }).eq("id", term.session_id);
  return NextResponse.json({ ok: true });
}
