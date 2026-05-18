// Deal Flow — Service Worker
// Stratégie : network-first pour l'app shell (toujours essayer la dernière version,
// fallback cache si offline). Aucune interception des appels Supabase / CDN.

// Bumped 2026-05-18 — Phase L.4 — 1 deal = 1 client × 1 produit (Oscar 2026-05-18):
// Architectural rework, applies to NEW deals only (edit mode untouched —
// legacy multi-codif deals continue to render and edit as they are).
//   · saveDeal NEW mode: splits the collected tree so every codif becomes
//     its own deal row with its own dedicated contract. dealGroupId no
//     longer generated (concept dropped).
//   · autoLinkDealToContract: always creates a NEW contract per deal (was
//     find-or-create on the client). 3 deals under one client = 3 contrats
//     séparés. Cascade-delete relies on this 1-to-1 mapping.
//   · Duplicate check runs on each split codif-deal independently.
//   · 'Soumission groupée' badge in openDet kept (reads legacy dealGroupId
//     when present — no migration needed).
// (Previous: 2026-05-18 v40 — Phase L.3.1 cascade diagnostic + force re-render.)
const CACHE_NAME = 'dealflow-v41';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png'
];

// INSTALL — pre-cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()) // active la nouvelle version immédiatement
  );
});

// ACTIVATE — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim()) // prend le contrôle de tous les onglets ouverts
  );
});

// FETCH — network-first for the app shell, network-only for everything else
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ne touche pas aux requêtes Supabase ni aux CDNs — direct au réseau
  if (url.origin !== self.location.origin) return;

  // Ne touche pas aux POST/PUT/DELETE etc. — direct au réseau
  if (req.method !== 'GET') return;

  // Network-first pour same-origin GET
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Update cache with fresh copy (best-effort)
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
