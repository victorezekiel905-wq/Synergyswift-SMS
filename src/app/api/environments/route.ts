import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";

/** Browsing policies for live classes in the caller's school. */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const { data: policies, error } = await ctx.sb.from("environment_policies")
    .select("id,name,mode,allowlist,blocklist,required_urls,class_id")
    .eq("tenant_id", ctx.tenant.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return jsonError(error.message);
  return NextResponse.json(policies ?? []);
}

const Url = z.string().trim().min(1).max(300);
const Body = z.object({
  name: z.string().trim().min(1).max(120),
  mode: z.enum(["monitor", "focus", "lock"]),
  class_id: z.string().uuid().nullish(),
  allowlist: z.array(Url).max(200).default([]),
  blocklist: z.array(Url).max(200).default([]),
  required_urls: z.array(Url).max(50).default([])
});

/** Creates a policy. The school is always the caller's own, never taken from the request. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.class_id) {
    const { data: cls } = await ctx.sb.from("classes").select("id").eq("tenant_id", tid).eq("id", b.class_id).maybeSingle();
    if (!cls) return jsonError("class not found", 404);
  }
  const { data, error } = await ctx.sb.from("environment_policies").insert({
    tenant_id: tid, class_id: b.class_id ?? null, name: b.name, mode: b.mode,
    allowlist: b.allowlist, blocklist: b.blocklist, required_urls: b.required_urls
  }).select("id,name").single();
  if (error) return jsonError(error.message);
  await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "policy.created", target: data.id, meta: { mode: b.mode } });
  return NextResponse.json(data, { status: 201 });
}
