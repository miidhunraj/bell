const CACHE = "call-bell-v6-hospitality";
const FILES = [
  "./",
  "./index.html",
  "./styles.css?v=6",
  "./app.js?v=6",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-1024.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then((hit) => {
      return (
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok) {
            const cp = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, cp));
          }
          return res;
        }).catch(() => caches.match("./index.html"))
      );
    })
  );
});
