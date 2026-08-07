/* Injects COOP/COEP headers so wasm multithreading works on GitHub Pages. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.mode === "navigate" || (req.method === "GET" && new URL(req.url).origin === location.origin)) {
    e.respondWith((async () => {
      const res = await fetch(req);
      if (res.status === 0) return res;
      const h = new Headers(res.headers);
      h.set("Cross-Origin-Opener-Policy", "same-origin");
      h.set("Cross-Origin-Embedder-Policy", "require-corp");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    })());
  }
});
