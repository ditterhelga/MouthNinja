/**
 * mouth-ninja-sw-v3-no-cache — caching disabled for development.
 * No precache. No fetch interception (browser loads fresh every time).
 * On activate: delete ALL Cache Storage entries for this origin.
 *
 * index.html does not register this file until caching is re-enabled.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
