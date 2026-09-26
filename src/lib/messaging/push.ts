/**
 * Web push to the installed app (phones and desktops), free per message.
 *
 * Generate keys once with `npx web-push generate-vapid-keys`, then set
 * NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT
 * (a mailto: or https: contact).
 */
import webpush from "web-push";

const env = (k: string) => {
  const v = process.env[k];
  return v && !v.includes("replace") ? v : undefined;
};

export function pushConfigured(): boolean {
  return Boolean(env("NEXT_PUBLIC_VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY"));
}

export type PushSubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };
export type PushResult = { ok: boolean; providerId?: string; error?: string; retryable?: boolean; notConfigured?: boolean; gone?: boolean };

/** Payload shown by the service worker. Kept small: push services cap it near 4 KB. */
export function pushPayload(p: { title: string; body: string; url?: string | null; tag?: string | null }): string {
  return JSON.stringify({ title: p.title.slice(0, 80), body: p.body.slice(0, 240), url: sitePath(p.url), tag: p.tag ?? undefined });
}

/** The service worker only opens paths on this site, so absolute links are reduced to their path. */
export function sitePath(u: string | null | undefined): string {
  if (!u) return "/";
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  try { const x = new URL(u); return x.pathname + x.search + x.hash; } catch { return "/"; }
}

export async function sendPush(sub: PushSubscriptionRow, payload: string): Promise<PushResult> {
  if (!pushConfigured()) return { ok: false, notConfigured: true, error: "push is not configured (VAPID keys missing)" };
  try {
    const r = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      {
        TTL: 24 * 3600,
        urgency: "high",
        vapidDetails: {
          subject: env("VAPID_SUBJECT") ?? "mailto:support@example.com",
          publicKey: env("NEXT_PUBLIC_VAPID_PUBLIC_KEY")!,
          privateKey: env("VAPID_PRIVATE_KEY")!
        }
      }
    );
    return { ok: true, providerId: r.headers?.location ?? undefined };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode ?? 0;
    // 404/410: the browser unsubscribed or the app was removed.
    if (status === 404 || status === 410) return { ok: false, gone: true, error: `subscription expired (${status})` };
    return { ok: false, retryable: status === 0 || status === 429 || status >= 500, error: `push ${status || "network"}: ${(e as Error).message}`.slice(0, 300) };
  }
}
