import { fetchAll } from "@/lib/results";
import { removePackageFiles } from "@/lib/content-server";
import { filesOf, KEEP_DAYS, type BinRow } from "@/lib/recycle-bin";

const FILE_TABLES = ["school_documents", "student_documents", "staff_documents", "portfolio_items", "staff_achievements", "job_applications",
  "class_story_posts", "library_books", "lesson_media", "content_packages"];

const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/**
 * Removes deletions from the bin for good: their stored files first, then the kept rows.
 * Only deletions of this school. If a file cannot be removed the deletion stays in the bin
 * (to be tried again), so no file is left behind with nothing pointing at it.
 */
export async function purgeDeletions(svc: any, tenantId: string, batches: string[]): Promise<number> {
  let done = 0;
  for (const part of chunks([...new Set(batches)], 100)) {
    const { data: tops, error } = await svc.from("recycle_bin").select("batch").eq("tenant_id", tenantId).eq("top", true).in("batch", part);
    if (error) throw new Error(error.message);
    const ours = [...new Set<string>((tops ?? []).map((t: { batch: string }) => t.batch))];
    if (!ours.length) continue;
    const rows = await fetchAll<BinRow>(() => svc.from("recycle_bin").select("id,schema_name,table_name,op,data")
      .in("batch", ours).eq("tenant_id", tenantId).eq("op", "delete").in("table_name", FILE_TABLES).order("id"));
    const { buckets, packages } = filesOf(rows, tenantId);
    for (const [bucket, paths] of Object.entries(buckets)) {
      for (const p of chunks(paths, 100)) {
        const { error: e } = await svc.storage.from(bucket).remove(p);
        if (e) throw new Error(`could not remove stored files (${e.message}); try again`);
      }
    }
    for (const pkg of packages) await removePackageFiles(svc, tenantId, pkg.id, pkg.paths);
    const { error: delErr } = await svc.from("recycle_bin").delete().in("batch", ours);
    if (delErr) throw new Error(delErr.message);
    done += ours.length;
  }
  return done;
}

/** Daily: deletions older than KEEP_DAYS leave the bin for good, files and all. */
export async function expireDeletions(svc: any): Promise<number> {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString();
  const { data, error } = await svc.from("recycle_bin").select("batch,tenant_id").eq("top", true).lt("deleted_at", cutoff).limit(2000);
  if (error) throw new Error(error.message);
  const byTenant = new Map<string, Set<string>>();
  for (const r of data ?? []) {
    if (!r.tenant_id) continue;
    if (!byTenant.has(r.tenant_id)) byTenant.set(r.tenant_id, new Set());
    byTenant.get(r.tenant_id)!.add(r.batch);
  }
  let n = 0;
  for (const [tid, batches] of byTenant) n += await purgeDeletions(svc, tid, [...batches]).catch(() => 0);
  return n;
}
