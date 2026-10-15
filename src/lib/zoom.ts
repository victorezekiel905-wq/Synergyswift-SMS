/**
 * Zoom Server-to-Server OAuth: creates and deletes meetings for online
 * lessons. A school can connect its own Zoom app (kept server-side in
 * integration_secrets); otherwise ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and
 * ZOOM_CLIENT_SECRET are used if set.
 */
import { zoomMeetingBody } from "./learning";

export type ZoomCreds = { account_id: string; client_id: string; client_secret: string };

export async function zoomCreds(svc: any, tenantId: string): Promise<{ creds: ZoomCreds; own: boolean } | null> {
  const { data } = await svc.from("integration_secrets").select("data").eq("tenant_id", tenantId).eq("provider", "zoom").maybeSingle();
  const d = data?.data;
  if (d?.account_id && d?.client_id && d?.client_secret) return { creds: d, own: true };
  const { ZOOM_ACCOUNT_ID: a, ZOOM_CLIENT_ID: c, ZOOM_CLIENT_SECRET: s } = process.env;
  return a && c && s ? { creds: { account_id: a, client_id: c, client_secret: s }, own: false } : null;
}

export async function zoomToken(c: ZoomCreds): Promise<string> {
  const r = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(c.account_id)}`, {
    method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${c.client_id}:${c.client_secret}`).toString("base64")}` }, signal: AbortSignal.timeout(15000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.reason || j.error || "Zoom did not accept the account details");
  return j.access_token;
}

export async function createZoomMeeting(c: ZoomCreds, p: { title: string; startsAt: string; durationMin: number; timezone: string }) {
  const r = await fetch("https://api.zoom.us/v2/users/me/meetings", {
    method: "POST", headers: { Authorization: `Bearer ${await zoomToken(c)}`, "Content-Type": "application/json" },
    body: JSON.stringify(zoomMeetingBody(p)), signal: AbortSignal.timeout(15000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.join_url) throw new Error(j.message || "Zoom could not create the meeting");
  return { id: String(j.id), join_url: String(j.join_url), start_url: String(j.start_url ?? ""), passcode: j.password ? String(j.password) : null };
}

/** A fresh host link (Zoom's host links stop working about two hours after they are made). */
export async function zoomStartUrl(c: ZoomCreds, id: string): Promise<string | null> {
  const r = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${await zoomToken(c)}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  const j = r?.ok ? await r.json().catch(() => null) : null;
  return j?.start_url ? String(j.start_url) : null;
}

export async function deleteZoomMeeting(c: ZoomCreds, id: string) {
  await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${await zoomToken(c)}` }, signal: AbortSignal.timeout(15000)
  }).catch(() => null);
}
