import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";

/** Ready-made report comments, optionally tied to an average range. ?average= returns the ones that fit first. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const role = u.searchParams.get("role");
  let q = ctx.sb.from("comment_bank").select("id,role,min_average,max_average,text,shared,created_by").eq("tenant_id", ctx.tenant.id);
  if (role) q = q.eq("role", role);
  const { data, error } = await q.order("min_average", { ascending: false, nullsFirst: false }).limit(500);
  if (error) return jsonError(error.message);
  const avg = u.searchParams.get("average") === null ? null : Number(u.searchParams.get("average"));
  const fits = (c: any) => avg === null || ((c.min_average === null || avg >= Number(c.min_average)) && (c.max_average === null || avg <= Number(c.max_average)));
  const list = (data ?? []).map((c: any) => ({ ...c, fits: fits(c), mine: c.created_by === ctx.userId }));
  list.sort((a: any, b: any) => Number(b.fits) - Number(a.fits));
  return NextResponse.json(list);
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().optional(), role: z.enum(["form_teacher", "principal", "subject"]),
    text: z.string().trim().min(2).max(600), min_average: z.number().min(0).max(100).nullish(), max_average: z.number().min(0).max(100).nullish(), shared: z.boolean().default(true) }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("seed") })
]);

// A starting set schools can edit (graded by average).
const STARTERS: { role: "form_teacher" | "principal"; min: number | null; max: number | null; text: string }[] = [
  { role: "form_teacher", min: 75, max: null, text: "An outstanding term. {name} works with focus and sets a fine example to the class." },
  { role: "form_teacher", min: 60, max: 74.99, text: "A very good term. {name} is hardworking and should keep pushing for excellence." },
  { role: "form_teacher", min: 50, max: 59.99, text: "A good effort. {name} can do even better with more consistent revision." },
  { role: "form_teacher", min: 40, max: 49.99, text: "A fair result. {name} needs to concentrate more in class and complete all assignments." },
  { role: "form_teacher", min: null, max: 39.99, text: "{name} needs to work much harder. We will support extra practice at school and at home." },
  { role: "principal", min: 70, max: null, text: "Excellent result. Keep it up." },
  { role: "principal", min: 50, max: 69.99, text: "Good result. Aim higher next term." },
  { role: "principal", min: null, max: 49.99, text: "There is room for improvement. Please work closely with your teachers." }
];

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.action === "seed") {
    if (!hasAny(ctx, ROLES.admin)) return jsonError("only admins can add the starter comments", 403);
    const { count } = await ctx.sb.from("comment_bank").select("id", { count: "exact", head: true }).eq("tenant_id", tid);
    if ((count ?? 0) > 0) return jsonError("the comment bank already has comments");
    const { error } = await ctx.sb.from("comment_bank").insert(STARTERS.map(s => ({ tenant_id: tid, role: s.role, min_average: s.min, max_average: s.max, text: s.text, shared: true, created_by: ctx.userId })));
    return error ? jsonError(error.message) : NextResponse.json({ added: STARTERS.length });
  }
  if (b.action === "delete") {
    const { data, error } = await ctx.sb.from("comment_bank").delete().eq("tenant_id", tid).eq("id", b.id).select("id");
    if (error) return jsonError(error.message);
    return data?.length ? NextResponse.json({ ok: true }) : jsonError("you can only delete your own comments", 403);
  }
  if (b.min_average !== null && b.min_average !== undefined && b.max_average !== null && b.max_average !== undefined && b.max_average < b.min_average) return jsonError("the range is back to front");
  const row = { role: b.role, text: b.text, min_average: b.min_average ?? null, max_average: b.max_average ?? null, shared: b.shared };
  if (b.id) {
    const { data, error } = await ctx.sb.from("comment_bank").update(row).eq("tenant_id", tid).eq("id", b.id).select("id");
    if (error) return jsonError(error.message);
    return data?.length ? NextResponse.json({ id: b.id }) : jsonError("you can only change your own comments", 403);
  }
  const { data, error } = await ctx.sb.from("comment_bank").insert({ ...row, tenant_id: tid, created_by: ctx.userId }).select("id").single();
  return error ? jsonError(error.message) : NextResponse.json(data, { status: 201 });
}
