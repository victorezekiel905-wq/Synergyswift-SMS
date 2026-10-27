import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_BYTES = 300_000;
const MAX_PHOTOS = 240;

/**
 * Camera photo during an entrance test taken at home, when the intake checks faces
 * (phase 14e). Stored privately for the admissions team; photos with no face or several
 * faces are flagged by the page itself (events), never marked down automatically.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const token = (await props.params).token;
  if (!/^[0-9a-f]{36}$/i.test(token)) return jsonError("not found", 404);
  const svc = createServiceClient();
  const { data: at } = await svc.from("entrance_attempts").select("id,tenant_id,status,application_id,tenants(status)").eq("token", token).maybeSingle();
  if (!at || (at as any).tenants?.status !== "active") return jsonError("not found", 404);
  if (at.status !== "in_progress") return jsonError("the test is not in progress", 409);
  const { data: app } = await svc.from("applications").select("entrance_plan_id").eq("id", at.application_id).maybeSingle();
  const { data: plan } = app?.entrance_plan_id ? await svc.from("entrance_plans").select("face_check").eq("id", app.entrance_plan_id).maybeSingle() : { data: null };
  if (!plan?.face_check) return jsonError("this test does not use the camera", 403);

  const [{ count: recent }, { count: total }] = await Promise.all([
    svc.from("entrance_events").select("id", { count: "exact", head: true }).eq("attempt_id", at.id).eq("kind", "snapshot").gte("at", new Date(Date.now() - 10_000).toISOString()),
    svc.from("entrance_events").select("id", { count: "exact", head: true }).eq("attempt_id", at.id).eq("kind", "snapshot")
  ]);
  if ((recent ?? 0) > 0 || (total ?? 0) >= MAX_PHOTOS) return NextResponse.json({ ok: true, skipped: true });

  const form = await req.formData().catch(() => null);
  const photo = form?.get("photo");
  if (!(photo instanceof Blob) || photo.size === 0 || photo.size > MAX_BYTES || !/^image\/jpe?g$/.test(photo.type)) return jsonError("a JPEG photo up to 300 KB is needed");
  const faces = Number(form?.get("faces") ?? -1);
  const path = `entrance/${at.tenant_id}/${at.id}/${Date.now()}.jpg`;
  const { error } = await svc.storage.from("admissions").upload(path, Buffer.from(await photo.arrayBuffer()), { contentType: "image/jpeg", upsert: false });
  if (error) return jsonError(error.message);
  await svc.from("entrance_events").insert({ tenant_id: at.tenant_id, attempt_id: at.id, kind: "snapshot", meta: { path, faces: Number.isFinite(faces) ? faces : -1 } });
  return NextResponse.json({ ok: true });
}
