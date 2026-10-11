/* PREMVIO service worker — offline shell + push notifications */
const CACHE = "premvio-v3";
const SHELL = ["./", "./index.html", 
  "./manifest.json", "./icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// Network first (always fresh), fall back to cache when offline. Only same-site files.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json(); } catch (err) { d = { title: "Premvio", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Premvio", {
    body: d.body || "",
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: { url: d.url || "./" },
    vibrate: [80, 40, 80],
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.split("#")[0] === target.split("#")[0] && "focus" in c) { c.navigate(target); return c.focus(); }
    }
    return clients.openWindow(target);
  }));
});
