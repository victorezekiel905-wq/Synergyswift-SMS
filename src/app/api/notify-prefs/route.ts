import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, jsonError, getCtx, sessionIdentity } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { identifyGuardian } from "@/lib/guardian";
import { GROUPS, cleanPrefs } from "@/lib/notify-prefs";

export const dynamic = "force-dynamic";

/**
 * Whose choices these are: a parent (by their private link, or signed in as a
 * parent), otherwise the signed-in member of staff or student.
 */
async function who(token: string | null) {
  const svc = createServiceClient();
  if (token) {
    const g = await identifyGuardian(svc, token, async () => null);
    return "error" in g ? g : { svc, tenantId: g.tenantId, guardianId: g.guardianId, userId: null as string | null, sb: null };
  }
  const ctx = await getCtx();
  if (!ctx || ctx.tenant.status !== "active") return { error: "unauthenticated", status: 401 };
  if (ctx.roles.has("parent")) {
    const g = await identifyGuardian(svc, null, sessionIdentity);
    if (!("error" in g)) return { svc, tenantId: g.tenantId, guardianId: g.guardianId as string | null, userId: null as string | null, sb: null };
  }
  return { svc, tenantId: ctx.tenant.id, guardianId: null as string | null, userId: ctx.userId as string | null, sb: ctx.sb };
}

export async function GET(req: NextRequest) {
  const w = await who(new URL(req.url).searchParams.get("token"));
  if ("error" in w) return jsonError(w.error, w.status);
  const q = w.guardianId
    ? w.svc.from("notification_prefs").select("muted,quiet_from,quiet_to").eq("guardian_id", w.guardianId)
    : w.sb.from("notification_prefs").select("muted,quiet_from,quiet_to").eq("user_id", w.userId);
  const { data } = await q.maybeSingle();
  return NextResponse.json({
    groups: GROUPS.filter(g => w.guardianId ? g.id !== "work" : true),
    prefs: { muted: data?.muted ?? [], quiet_from: data?.quiet_from?.slice(0, 5) ?? null, quiet_to: data?.quiet_to?.slice(0, 5) ?? null }
  });
}

const Body = z.object({
  token: z.string().optional(),
  muted: z.array(z.string().max(20)).max(10),
  quiet_from: z.string().max(5).nullish(),
  quiet_to: z.string().max(5).nullish()
});

export async function PUT(req: NextRequest) {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const w = await who(parsed.data.token ?? null);
  if ("error" in w) return jsonError(w.error, w.status);
  const clean = cleanPrefs(parsed.data);
  const row = { tenant_id: w.tenantId, ...clean, updated_at: new Date().toISOString() };
  // Parents' rows are written by the server; staff and students write their own (row-level security applies).
  const res = w.guardianId
    ? await upsert(w.svc, "guardian_id", w.guardianId, row)
    : await upsert(w.sb, "user_id", w.userId!, row);
  if (res.error) return jsonError(res.error.message);
  return NextResponse.json({ ok: true, prefs: clean });
}

async function upsert(client: any, col: "user_id" | "guardian_id", id: string, row: Record<string, unknown>) {
  const { data: existing } = await client.from("notification_prefs").select("id").eq(col, id).maybeSingle();
  return existing
    ? client.from("notification_prefs").update(row).eq("id", existing.id)
    : client.from("notification_prefs").insert({ ...row, [col]: id });
}
