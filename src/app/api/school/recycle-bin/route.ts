import { NextRequest, NextResponse } from "next/server";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { BIN_ROLES, KEEP_DAYS, toEntries } from "@/lib/recycle-bin";
import { purgeDeletions } from "@/lib/recycle-bin-server";

export const dynamic = "force-dynamic";

const BATCH = /^t\d{1,20}$/;

/** The school's recycle bin, newest first. School admins only. */
export async function GET() {
  const ctx = await requireCtx(BIN_ROLES);
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const { data, error } = await svc.rpc("recycle_bin_list", { p_tenant: ctx.tenant.id, p_limit: 500 });
  if (error) return jsonError(error.message.includes("recycle_bin") ? "The recycle bin is not set up yet: run the latest database update." : error.message, 500);
  const ids = [...new Set((data ?? []).map((r: any) => r.actor_id).filter(Boolean))] as string[];
  const { data: users } = ids.length ? await svc.from("users").select("id,full_name").in("id", ids) : { data: [] };
  const names = new Map<string, string>((users ?? []).map((u: { id: string; full_name: string }) => [u.id, u.full_name]));
  return NextResponse.json({ entries: toEntries(data ?? [], names), keep_days: KEEP_DAYS });
}

/**
 * { action: "restore", batch }      put a deletion back, with everything that went with it
 * { action: "delete", batches: [] } remove deletions for good (stored files too)
 * { action: "empty" }               remove everything in the bin for good
 */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(BIN_ROLES);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const b = await readJson<{ action?: string; batch?: string; batches?: string[] }>(req);
  const log = (action: string, meta: Record<string, unknown>) =>
    svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action, meta }).then(() => null, () => null);

  if (b.action === "restore") {
    if (!b.batch || !BATCH.test(b.batch)) return jsonError("choose something to restore");
    const { data, error } = await svc.rpc("recycle_bin_restore", { p_tenant: tid, p_batch: b.batch });
    if (error) return jsonError(error.message, error.code === "P0002" ? 404 : 400);
    await log("recycle_bin.restored", { batch: b.batch, ...data });
    return NextResponse.json({ ok: true, ...data });
  }

  if (b.action === "delete" || b.action === "empty") {
    let batches: string[];
    if (b.action === "delete") {
      batches = (Array.isArray(b.batches) ? b.batches : []).filter(x => typeof x === "string" && BATCH.test(x)).slice(0, 500);
      if (!batches.length) return jsonError("choose something to delete");
    } else {
      const { data, error } = await svc.from("recycle_bin").select("batch").eq("tenant_id", tid).eq("top", true).limit(5000);
      if (error) return jsonError(error.message, 500);
      batches = [...new Set<string>((data ?? []).map((r: { batch: string }) => r.batch))];
    }
    try {
      const n = await purgeDeletions(svc, tid, batches);
      await log(b.action === "empty" ? "recycle_bin.emptied" : "recycle_bin.deleted", { deletions: n });
      return NextResponse.json({ ok: true, deleted: n });
    } catch (e) {
      return jsonError((e as Error).message, 500);
    }
  }
  return jsonError("unknown action");
}
