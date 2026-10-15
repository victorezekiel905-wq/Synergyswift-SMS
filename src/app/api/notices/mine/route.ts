import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * The notice board for whoever is signed in (staff, students, parents): the
 * last 60 days, unread first, plus any emergency alert still to be acknowledged.
 */
export async function GET() {
  const ctx = await requireCtx();
  if (ctx instanceof NextResponse) return ctx;
  const { data, error } = await ctx.sb.from("notice_recipients")
    .select("id,read_at,acknowledged_at,student_ids,notices!inner(id,kind,title,body,requires_ack,sent_at,expires_at,pinned,status)")
    .eq("tenant_id", ctx.tenant.id).eq("notices.status", "sent").gte("created_at", new Date(Date.now() - 60 * 86400_000).toISOString())
    .order("created_at", { ascending: false }).limit(100);
  if (error) return jsonError(error.message);
  const now = Date.now();
  const items = (data ?? []).map((r: any) => ({ receipt_id: r.id, read_at: r.read_at, acknowledged_at: r.acknowledged_at, ...r.notices }));
  const emergency = items.find((i: any) => i.kind === "emergency" && !i.acknowledged_at && (!i.expires_at || Date.parse(i.expires_at) > now)) ?? null;
  return NextResponse.json({ items, unread: items.filter((i: any) => !i.read_at).length, emergency });
}

const Body = z.object({ receipt_id: z.string().uuid(), ack: z.boolean().default(false) });

/** Marks my copy as read, or acknowledged. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("receipt_id required");
  const now = new Date().toISOString();
  const patch: Record<string, string> = { read_at: now };
  if (parsed.data.ack) patch.acknowledged_at = now;
  const { data, error } = await ctx.sb.from("notice_recipients").update(patch).eq("tenant_id", ctx.tenant.id).eq("id", parsed.data.receipt_id).select("id").maybeSingle();
  return error || !data ? jsonError(error?.message ?? "not found", 404) : NextResponse.json({ ok: true });
}
