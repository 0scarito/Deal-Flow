// Deal Flow — Service Worker
// Stratégie : network-first pour l'app shell (toujours essayer la dernière version,
// fallback cache si offline). Aucune interception des appels Supabase / CDN.

// Bumped 2026-05-18 — Phase L.2 — Deal modal UI surgical (Oscar 2026-05-18):
//   · A1 — 'Banque' field removed from fournisseur block.
//   · A2 — 'Assureur' field auto-hides for CTO contract type.
//   · A3 — 'Date de maturité' always visible regardless of product type.
//   · D — Modifier/Supprimer alignment fixed on deals list.
//   · E — Total count + nominal sum displayed in deals filter bar.
// (Previous: 2026-05-18 v37 — Phase L.1 cascade-delete deal → contrat.)
const CACHE_NAME = 'dealflow-v38';
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
