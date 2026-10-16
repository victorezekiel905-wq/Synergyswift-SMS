/**
 * Push to the native Android and iPhone apps through Firebase Cloud Messaging
 * (HTTP v1). iPhones are reached through Firebase too, once the school's APNs
 * key is uploaded to the Firebase project.
 *
 * Set FCM_PROJECT_ID, FCM_CLIENT_EMAIL and FCM_PRIVATE_KEY from a Firebase
 * service account (Project settings → Service accounts → Generate new private key).
 */
import { createSign } from "node:crypto";
import type { PushResult } from "./push";

const env = (k: string) => {
  const v = process.env[k];
  return v && !v.includes("replace") ? v : undefined;
};
/** Private keys pasted into environment settings often arrive with literal "\n". */
const privateKey = () => env("FCM_PRIVATE_KEY")?.replace(/\\n/g, "\n");

export function fcmConfigured(): boolean {
  return Boolean(env("FCM_PROJECT_ID") && env("FCM_CLIENT_EMAIL") && privateKey());
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** A signed request for a Google access token (RS256), valid for an hour. */
export function serviceJwt(clientEmail: string, key: string, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: clientEmail, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: nowSec, exp: nowSec + 3600
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(key))}`;
}

/** The message body Firebase expects: shown as a notification, opening `url` in the app when tapped. */
export function fcmMessage(token: string, p: { title: string; body: string; url: string; tag?: string | null }) {
  return {
    message: {
      token,
      notification: { title: p.title.slice(0, 80), body: p.body.slice(0, 240) },
      data: { url: p.url, ...(p.tag ? { tag: p.tag } : {}) },
      android: { priority: "HIGH", notification: { ...(p.tag ? { tag: p.tag } : {}), click_action: "OPEN_URL" } },
      apns: { headers: { "apns-priority": "10" }, payload: { aps: { sound: "default", ...(p.tag ? { "thread-id": p.tag } : {}) } } }
    }
  };
}

/** How a Firebase error should be handled. */
export function fcmOutcome(status: number, errorCode?: string | null): Pick<PushResult, "gone" | "retryable"> {
  if (status === 404 || errorCode === "UNREGISTERED") return { gone: true, retryable: false };
  if (status === 400 && errorCode === "INVALID_ARGUMENT") return { gone: true, retryable: false };
  return { gone: false, retryable: status === 0 || status === 429 || status >= 500 };
}

let cached: { token: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const jwt = serviceJwt(env("FCM_CLIENT_EMAIL")!, privateKey()!, Math.floor(Date.now() / 1000));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`firebase sign-in failed (${r.status}): ${j.error_description ?? j.error ?? "unknown"}`);
  cached = { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return cached.token;
}

export async function sendFcm(deviceToken: string, p: { title: string; body: string; url: string; tag?: string | null }): Promise<PushResult> {
  if (!fcmConfigured()) return { ok: false, notConfigured: true, error: "app push is not configured (FCM keys missing)" };
  try {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${env("FCM_PROJECT_ID")}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(fcmMessage(deviceToken, p))
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, providerId: j.name ?? undefined };
    const code = j?.error?.details?.find((d: any) => d.errorCode)?.errorCode ?? j?.error?.status ?? null;
    return { ok: false, ...fcmOutcome(r.status, code), error: `fcm ${r.status}${code ? ` ${code}` : ""}: ${j?.error?.message ?? ""}`.slice(0, 300) };
  } catch (e) {
    return { ok: false, retryable: true, error: `fcm network: ${(e as Error).message}`.slice(0, 300) };
  }
}
