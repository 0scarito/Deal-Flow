// Deal Flow — Service Worker
// Stratégie : network-first pour l'app shell (toujours essayer la dernière version,
// fallback cache si offline). Aucune interception des appels Supabase / CDN.

// Bumped 2026-05-18 — Phase L.5 — Save-to-catalogue prompt (Oscar 2026-05-18):
//   · At deal submit, for each split codif-deal whose (produit, ISIN)
//     doesn't match any entry in its fournisseur's catalogue, gather them
//     into a single confirm() : 'N nouveau(x) produit(s) détecté(s) —
//     pas encore au catalogue du fournisseur : ... Ajouter au catalogue ?'.
//   · On confirm, appended to fourn.products[] for each concerned
//     fournisseur (lookup keyed on .fourn only — assureur/banque ignored
//     because the product is logged under the fournisseur SDG).
//   · Fees snapshot, currency, type, pf config — all copied so the next
//     deal with this product auto-fills correctly via the existing
//     onDealIsinChange / _onDealProduitChange paths.
// (Previous: 2026-05-18 v41 — Phase L.4 1 deal = 1 produit + cascade diag.)
const CACHE_NAME = 'dealflow-v42';
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
