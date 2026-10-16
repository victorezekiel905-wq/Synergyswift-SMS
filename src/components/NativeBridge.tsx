"use client";
import { useEffect } from "react";

/**
 * Inside the Android or iPhone app (the Capacitor wrapper), registers this
 * phone for notifications through Firebase and opens the right page when one
 * is tapped. In a normal browser it does nothing. `token` is a parent's
 * private link; otherwise the signed-in session identifies the person.
 */
export const NATIVE_TOKEN_KEY = "ecf-native-token";

type Cap = {
  isNativePlatform?: () => boolean; getPlatform?: () => string;
  Plugins?: { PushNotifications?: {
    checkPermissions: () => Promise<{ receive: string }>; requestPermissions: () => Promise<{ receive: string }>;
    register: () => Promise<void>; addListener: (e: string, cb: (x: any) => void) => Promise<{ remove: () => void }> | { remove: () => void };
  } };
};

export default function NativeBridge({ enabled, token }: { enabled: boolean; token?: string }) {
  useEffect(() => {
    const cap = (window as { Capacitor?: Cap }).Capacitor;
    const push = cap?.Plugins?.PushNotifications;
    if (!enabled || !cap?.isNativePlatform?.() || !push) return;
    const platform = cap.getPlatform?.() === "ios" ? "ios" : "android";
    const handles: { remove: () => void }[] = [];
    let cancelled = false;
    (async () => {
      const add = async (e: string, cb: (x: any) => void) => { const h = await push.addListener(e, cb); if (cancelled) h.remove(); else handles.push(h); };
      await add("registration", async (t: { value: string }) => {
        try { localStorage.setItem(NATIVE_TOKEN_KEY, t.value); } catch { /* storage blocked */ }
        await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "subscribe_native", device_token: t.value, platform, token }) }).catch(() => {});
      });
      await add("pushNotificationActionPerformed", (a: { notification?: { data?: { url?: string } } }) => {
        const url = a.notification?.data?.url;
        if (url && url.startsWith("/") && !url.startsWith("//")) window.location.href = url;
      });
      let perm = await push.checkPermissions();
      if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await push.requestPermissions();
      if (perm.receive === "granted" && !cancelled) await push.register();
    })().catch(() => { /* the phone said no, or the plugin is missing */ });
    return () => { cancelled = true; handles.forEach(h => h.remove()); };
  }, [enabled, token]);
  return null;
}

/** On sign-out: stop this device getting the previous person's notifications. */
export async function forgetDevice() {
  try {
    const nt = localStorage.getItem(NATIVE_TOKEN_KEY);
    if (nt) await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", endpoint: nt }) });
    localStorage.removeItem(NATIVE_TOKEN_KEY);
  } catch { /* storage blocked or offline */ }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
  } catch { /* push not supported */ }
}
