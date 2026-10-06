/* 我的谱架 — Service Worker：离线缓存 */
"use strict";

const CACHE = "my-stand-v6";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/db.js",
  "./js/chords.js",
  "./js/metronome.js",
  "./js/library.js",
  "./js/viewer.js",
  "./js/app.js",
  "./js/vendor/pdf.min.js",
  "./js/vendor/pdf.worker.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // 统一策略：网络优先，失败时回落缓存（离线可用），更新即时生效
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(hit => hit || (e.request.mode === "navigate" ? caches.match("./index.html") : undefined))
      )
  );
});
