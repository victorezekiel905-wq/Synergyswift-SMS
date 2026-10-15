/**
 * Server side of content packages: unpacking uploads into storage, launch
 * tokens, and saving progress (which also ticks off learning-path steps and
 * gives learning points).
 */
import JSZip from "jszip";
import { createHash } from "crypto";
import { safeZipPath, commonRoot, detectPackage, mimeFor, signToken, verifyToken, bestStatus, type AttemptStatus, type ContentToken, type DetectedPackage, type PackageKind } from "./content";
import { POINTS } from "./lms";

export const PKG_LIMITS = { zipMb: 80, files: 4000, unpackedMb: 300 };
const BUCKET = "content";

export function contentKey(): Buffer {
  if (process.env.CONTENT_SIGNING_KEY) return Buffer.from(process.env.CONTENT_SIGNING_KEY);
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svc) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createHash("sha256").update(`content-token:${svc}`).digest();
}

export const storagePath = (tenantId: string, pkgId: string, path: string) => `${tenantId}/${pkgId}/${path}`;

/** A launch link valid for six hours. `attemptId` null = a staff preview that saves nothing. */
export function launchToken(p: { tenantId: string; pkgId: string; userId: string; attemptId: string | null; kind: PackageKind }): string {
  const t: ContentToken = { t: p.tenantId, p: p.pkgId, u: p.userId, a: p.attemptId, k: p.kind, e: Math.floor(Date.now() / 1000) + 6 * 3600 };
  return signToken(t, contentKey());
}
export const readToken = (token: string, allowExpired = false) => verifyToken(token, contentKey(), Date.now(), allowExpired);
/** The value the SCORM runtime tags its messages with, so the player ignores anything else. */
export const tokenNonce = (token: string) => (token.split(".")[1] ?? "").slice(0, 12);

export type UnpackedFile = { p: string; s: number; t: string };

/** Reads a zip (.zip or .h5p), works out what it is and copies its files to storage. */
export async function unpackPackage(svc: any, tenantId: string, pkgId: string, buf: Buffer):
  Promise<{ ok: true; detected: DetectedPackage; files: UnpackedFile[]; size: number } | { ok: false; error: string }> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buf); } catch { return { ok: false, error: "that file is not a zip, SCORM, xAPI or H5P package" }; }
  const entries = Object.values(zip.files).filter(f => !f.dir);
  if (entries.length > PKG_LIMITS.files) return { ok: false, error: `packages can hold at most ${PKG_LIMITS.files} files` };
  // Declared sizes, checked before anything is unpacked (protects against zip bombs).
  const declared = entries.reduce((a, f) => a + Number((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0), 0);
  if (declared > PKG_LIMITS.unpackedMb * 1024 * 1024) return { ok: false, error: `packages can be at most ${PKG_LIMITS.unpackedMb} MB when unpacked` };
  const named = entries.map(f => ({ f, p: safeZipPath(f.name) })).filter((x): x is { f: JSZip.JSZipObject; p: string } => x.p !== null);
  const root = commonRoot(named.map(x => x.p));
  const files = named.map(x => ({ f: x.f, p: x.p.slice(root.length) })).filter(x => x.p);
  const byPath = new Map(files.map(x => [x.p, x.f]));
  const detected = await detectPackage([...byPath.keys()], async p => {
    const f = byPath.get(p);
    return f ? (await f.async("string")).slice(0, 2_000_000) : null;
  });
  if ("error" in detected) return { ok: false, error: detected.error };

  const out: UnpackedFile[] = [];
  let size = 0, failed: string | null = null;
  const queue = [...files];
  const worker = async () => {
    for (let x = queue.shift(); x && !failed; x = queue.shift()) {
      const data = await x.f.async("nodebuffer");
      size += data.length;
      if (size > PKG_LIMITS.unpackedMb * 1024 * 1024) { failed = `packages can be at most ${PKG_LIMITS.unpackedMb} MB when unpacked`; return; }
      const type = mimeFor(x.p);
      const { error } = await svc.storage.from(BUCKET).upload(storagePath(tenantId, pkgId, x.p), data, { contentType: type.split(";")[0], upsert: true });
      if (error) { failed = `could not store ${x.p}: ${error.message}`; return; }
      out.push({ p: x.p, s: data.length, t: type });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (failed) {
    await removePackageFiles(svc, tenantId, pkgId, out.map(f => f.p));
    return { ok: false, error: failed };
  }
  return { ok: true, detected, files: out.sort((a, b) => a.p.localeCompare(b.p)), size };
}

export async function removePackageFiles(svc: any, tenantId: string, pkgId: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += 500) await svc.storage.from(BUCKET).remove(paths.slice(i, i + 500).map(p => storagePath(tenantId, pkgId, p)));
}

export async function readPackageFile(svc: any, tenantId: string, pkgId: string, path: string): Promise<Buffer | null> {
  const { data, error } = await svc.storage.from(BUCKET).download(storagePath(tenantId, pkgId, path));
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Saves progress on a package. Status never goes backwards, time adds up,
 * and the first completion gives learning points and ticks off any
 * learning-path steps that use this package.
 */
export async function saveAttempt(svc: any, p: { tenantId: string; attemptId: string; packageId: string; status: AttemptStatus | null; score: number | null; seconds: number; data?: Record<string, unknown> }) {
  const { data: cur } = await svc.from("content_attempts").select("id,status,score,time_seconds,student_id,completed_at,data").eq("id", p.attemptId).eq("tenant_id", p.tenantId).maybeSingle();
  if (!cur) return null;
  const status = p.status ? bestStatus(cur.status, p.status) : cur.status === "not_attempted" ? "incomplete" : cur.status;
  const finishedNow = ["completed", "passed"].includes(status) && !cur.completed_at;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status, updated_at: now, time_seconds: Math.min(2_000_000_000, (cur.time_seconds ?? 0) + Math.max(0, Math.min(p.seconds, 24 * 3600))),
    score: p.score !== null && p.score !== undefined ? Math.max(Number(cur.score ?? 0), p.score) : cur.score
  };
  if (p.data) patch.data = p.data;
  if (finishedNow) patch.completed_at = now;
  await svc.from("content_attempts").update(patch).eq("id", cur.id);
  if (cur.student_id && (finishedNow || status === "failed")) await contentStepsDone(svc, p.tenantId, cur.student_id, p.packageId, status, patch.score as number | null);
  if (cur.student_id && finishedNow) {
    await svc.from("learning_activity").upsert({ tenant_id: p.tenantId, student_id: cur.student_id, kind: "content", points: POINTS.content, ref_id: p.packageId },
      { onConflict: "student_id,kind,ref_id", ignoreDuplicates: true });
  }
  return { status, score: patch.score };
}

/** Learning-path steps for this package, in paths the student's class follows. */
async function contentStepsDone(svc: any, tenantId: string, studentId: string, packageId: string, status: AttemptStatus, score: number | null) {
  const { data: st } = await svc.from("students").select("class_group_id").eq("id", studentId).maybeSingle();
  if (!st?.class_group_id) return;
  const { data: steps } = await svc.from("learning_path_steps").select("id,path_id,pass_pct,learning_paths!inner(status,class_group_ids)")
    .eq("tenant_id", tenantId).eq("kind", "content").eq("package_id", packageId).eq("learning_paths.status", "published").contains("learning_paths.class_group_ids", [st.class_group_id]);
  for (const s of steps ?? []) {
    const ok = status === "completed" || status === "passed";
    const good = ok && (score === null || s.pass_pct === 0 || status === "passed" || score >= s.pass_pct);
    const { data: prev } = await svc.from("learning_path_progress").select("status,attempts").eq("step_id", s.id).eq("student_id", studentId).maybeSingle();
    if (prev && (prev.status === "done" || prev.status === "passed")) continue;
    await svc.from("learning_path_progress").upsert({ step_id: s.id, student_id: studentId, tenant_id: tenantId, path_id: s.path_id, status: good ? "done" : "failed", score,
      attempts: (prev?.attempts ?? 0) + 1, completed_at: new Date().toISOString() }, { onConflict: "step_id,student_id" });
    if (good) await svc.from("learning_activity").upsert({ tenant_id: tenantId, student_id: studentId, kind: "path_step", points: POINTS.path_step, ref_id: s.id }, { onConflict: "student_id,kind,ref_id", ignoreDuplicates: true });
  }
}
