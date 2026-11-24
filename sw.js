/* Offline-Unterstützung und Push-Mitteilungen der Pillenerinnerung. */
importScripts("config.js", "shared.js");
const VERSION = "pb-v6";
const SHELL = ["./", "index.html", "style.css", "app.js", "shared.js", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/badge.png", "icons/icon.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== VERSION).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const same = url.origin === self.location.origin;
  const fonts = url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com");
  if (!same && !fonts) return;
  e.respondWith(fetch(e.request, same ? { cache: "no-cache" } : {}).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});

self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) {}
  const pill = d.kind === "due" || d.kind === "nag" || d.kind === "snooze";
  e.waitUntil(self.registration.showNotification(d.title || "Pillenerinnerung", {
    body: d.body || "", tag: d.tag || "pillen", renotify: true, requireInteraction: pill, data: d,
    actions: pill ? [{ action: "taken", title: "Eingenommen" }, { action: "snooze", title: "In 15 Min." }] : [],
    icon: "icons/icon-192.png", badge: "icons/badge.png", vibrate: [300, 120, 300, 120, 300]
  }).then(() => tell({ type: "push" })));
});

async function tell(msg) { (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).forEach(c => c.postMessage(msg)); }

self.addEventListener("notificationclick", e => {
  const n = e.notification, d = n.data || {}; n.close();
  e.waitUntil((async () => {
    const dev = await pbGet("device");
    if (e.action === "taken" && d.slot) {
      await pbInboxAdd({ type: "taken", slot: d.slot, meds: (d.meds || []).map(m => m.id), at: Date.now() });
      if (dev) await pbRpc("pill_slot", { dev, slot: d.slot, open: [] }).catch(() => {});
      return tell({ type: "inbox" });
    }
    if (e.action === "snooze" && d.slot) {
      await pbInboxAdd({ type: "snooze", slot: d.slot, until: Date.now() + 15 * 60000 });
      if (dev) await pbRpc("pill_snooze", { dev, slot: d.slot, minutes: 15 }).catch(() => {});
      return tell({ type: "inbox" });
    }
    const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (cs.length) return cs[0].focus();
    return self.clients.openWindow("./");
  })());
});
