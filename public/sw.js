/*
 * EduClass Fusion service worker.
 * - Makes the app installable on phones (Add to Home screen).
 * - Caches static build assets and the icon so the shell loads fast on slow networks.
 * - Never caches API responses or pages: school data is always live and private.
 * - When offline, page navigations show a small offline notice instead of an error.
 * - Shows push notifications (results, sign-in alerts, messages, bus, wallet).
 */
const CACHE = "educlass-static-v2";
// App pages that must open without a connection. They hold no school data:
// the data is fetched by the page, and the register keeps its own offline copy.
const PAGES = "educlass-pages-v1";
const OFFLINE_PAGES = ["/school/attendance"];
const OFFLINE_HTML = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a;text-align:center;padding:24px}</style></head>
<body><div><h1>You are offline</h1><p>Check your connection and try again. Exam answers you typed are kept on this device and will be sent when you reconnect.</p>
<button onclick="location.reload()" style="padding:10px 18px;border-radius:8px;border:0;background:#1d5ddb;color:#fff;font-weight:600">Try again</button></div></body></html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/icon.svg", "/manifest.webmanifest"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== PAGES).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never cache data

  // Immutable build assets: cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg") {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    })));
    return;
  }

  // Offline-capable pages: network first, then the last copy saved on this device.
  if (req.mode === "navigate" && OFFLINE_PAGES.includes(url.pathname)) {
    event.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(PAGES).then((c) => c.put(url.pathname, copy)); }
      return res;
    }).catch(() => caches.match(url.pathname).then((hit) => hit || new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } }))));
    return;
  }

  // Pages: always from the network; offline notice if that fails.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
  }
});

// Push notifications. The payload is { title, body, url, tag } from the server.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "School update", {
    body: data.body || "",
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/" }
  }));
});

// Tapping a notification focuses an open tab or opens the linked page (same site only).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if (w.url === target && "focus" in w) return w.focus();
    return self.clients.openWindow(target);
  }));
});
