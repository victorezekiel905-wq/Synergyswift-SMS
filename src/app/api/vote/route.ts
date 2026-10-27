import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Voting for students, parents and staff (phase 14f): the elections you can vote in, the
 * ballot paper, casting your vote (secret; one vote), results once published, and checking
 * your receipt. Everything goes through the database's checks (cast_ballot …).
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "elections");
  if (ctx instanceof NextResponse) return ctx;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    const { data, error } = await ctx.sb.rpc("my_elections");
    if (error) return jsonError(error.message);
    return NextResponse.json({ elections: data ?? [] });
  }
  const { data: list } = await ctx.sb.rpc("my_elections");
  const mine = ((list ?? []) as any[]).find(e => e.id === id);
  if (!mine) return jsonError("This election is not open to you.", 404);
  const [{ data: posts }, { data: candidates }, results] = await Promise.all([
    ctx.sb.from("election_posts").select("id,title,description,seats,position").eq("election_id", id).order("position"),
    ctx.sb.from("election_candidates").select("id,post_id,name,photo_url,manifesto,position").eq("election_id", id).order("position"),
    mine.results ? ctx.sb.rpc("election_results", { p_election: id }).then((r: { data: unknown; error: unknown }) => (r.error ? null : r.data)) : Promise.resolve(null)
  ]);
  return NextResponse.json({ election: mine, posts: posts ?? [], candidates: candidates ?? [], results });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cast"), election_id: z.string().uuid(), choices: z.record(z.string().uuid(), z.array(z.string().uuid()).max(50)) }),
  z.object({ action: z.literal("check"), election_id: z.string().uuid(), receipt: z.string().trim().min(6).max(40) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(undefined, "elections");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("invalid request");
  const b = parsed.data;
  if (b.action === "cast") {
    const { data, error } = await ctx.sb.rpc("cast_ballot", { p_election: b.election_id, p_choices: b.choices });
    if (error) return jsonError(error.message, error.code === "42501" ? 403 : 400);
    return NextResponse.json({ ok: true, receipt: data });
  }
  const { data, error } = await ctx.sb.rpc("election_check_receipt", { p_election: b.election_id, p_receipt: b.receipt });
  if (error) return jsonError(error.message);
  return NextResponse.json({ counted: Boolean(data) });
}
