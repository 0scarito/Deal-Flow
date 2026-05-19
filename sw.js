// Deal Flow — Service Worker
// Stratégie : network-first pour l'app shell (toujours essayer la dernière version,
// fallback cache si offline). Aucune interception des appels Supabase / CDN.

// 2026-05-19 v50 — L.10 Facturation Rapprochement par fournisseur vendor filter + Audrey vs David chart removed.
//   · renderFact : at the end of the function, re-render the currently visible Facturation sub-tab
//     (UF / RUN / PF) so its "Rapprochement par fournisseur" table + Suivi Factures table follow
//     curV. Bug : the Running rapprochement (recapRUNT, "Amundi AM / ASG Capital / EURAZEO ~182k€")
//     stayed stale when toggling Audrey/David because renderAll → renderFact didn't cascade into
//     renderRecapFourn (only fired on tab click, not on vendor change). UF + PF same pattern.
//   · Pilotage : "Audrey vs David — VALIDÉ vs PIPE" chart REMOVED (Oscar's request — v49 added it,
//     v50 removes it). cVendeurs canvas + parent card + the g2 wrapper around (Vendeurs, Pipeline)
//     collapsed — Pipeline chart now stands alone full-width. 62 lines of renderCharts removed.
// (Previous: 2026-05-19 v49 — L.10 Pilotage forward window + vendor scoping (Suivi Contrats, Facturation) + Audrey vs David VALIDÉ/PIPE split.)
//   · Pilotage Évolution Mensuelle : months12 window now -3 → +8 (3 back, 9 forward)
//     instead of 12 backward. Series aligned to months12 so chart populates even when
//     all deals are trade-dated in current month (forward-est fills horizon).
//   · vendeurOfClient(name) helper added near filt(). Lookup client.vendeur in clients_db.
//   · renderContrats + renderContratsStats : filter contracts by curV via client→vendeur.
//   · renderUFInvTable + renderUFDeals : billingUFEntries(billingEntries(filt())) so
//     Facturation respects curV (was leaking other vendors' deals into Audrey/David tabs).
//   · Pilotage chart "Audrey vs David" : VALIDÉ (invS set) vs PIPE (!invS) stacked split.
//     4 bars (Audrey VAL / Audrey PIPE / David VAL / David PIPE) × 3 stacks (UF/Run/PF).
//     Pipe Run = annual runE minus already-validated paid rappros, floored at 0.
// (Previous: 2026-05-19 v48 — instrumentation only, never deployed.)
// Bumped 2026-05-19 — v48 instrumentation — Évolution mensuelle chart debug (never shipped):
//   · console.log [TL chart v48] in renderCharts → reveals runEntriesForChart count,
//     months12 window, paidQByFourn, final byM. Removed in v49 along with the root-cause fix.
// (Previous: 2026-05-19 v47 — drop ct filter on runEntriesForChart in renderCharts.)
// Bumped 2026-05-19 — Phase L.9 — Pilotage + Facturation + Alertes fixes (Oscar 2026-05-19):
//   · Running mensuel chart : new formula = paid rappros (distributed over 3 months)
//     + forward-looking runE/12 for months without paid data. Was buggy (only deal
//     trade month got runE/12, zero elsewhere — that's why Oscar saw ~234€).
//   · PF table : codif-level pf via billingEntries (was deal-level d.pf which missed
//     Phase D configs). Pct-mode entries now show "À calculer" + rate/hurdle.
//   · setFactType : ftPFTab now in the reset list (was staying blue after click).
//   · Alerts dismissals : TIME-BOUND (30 days) + auto-cleanup for dead deals.
// (Previous: 2026-05-19 v45 — Phase L.8 commissions + fourn drill-down.)
// Bumped 2026-05-19 — Phase L.8 — Synthèse + Facturation bug fixes (Oscar 2026-05-19):
//   · _feesToCycleRates : ct default '' (not 'UF') when no fees defined — was the
//     root cause of empty codifs polluting the UF Suivi table.
//   · codifEffectiveCt + dealCodifsEffective virtual codif : same default fix.
//   · renderFact : KPI filters require ufE/runE > 0 (not just ct).
//   · PF kpi added to factKpi (was hidden behind the PF tab).
//   · renderSynthPipe/Realise/Paye : show 'Commissions attendues' (UF+Run/an+PF)
//     instead of face nominal, per Oscar's framing : nominaux = money to be made.
//   · NEW : openFournDetailModal — click any fourn name → drill-down modal with
//     all deals of that fourn, kpis, table sortable.
// (Previous: 2026-05-19 v44 — Phase L.7 templates v2 inline on fourn.)
// Bumped 2026-05-19 — Phase L.7 — Templates v2 inline on fourn (Oscar 2026-05-19):
//   · Prelim steps now live directly on fourn.prelim_steps (no more templates_db lookup).
//   · Investment steps now live directly on fourn.products[i].investment_steps,
//     auto-applied on deal create via ISIN exact / product name match.
//   · Legacy template_name pointer still works as fallback for unmigrated fourns.
//   · One-shot migration via window._migrateTemplatesToFournInline() in console.
//   · UI = inline editors inside the Fournisseur modal (no separate Templates page).
// (Previous: 2026-05-19 v43 — Phase L.6 backfill deal_id button.)
// Bumped 2026-05-19 — Phase L.6 — Backfill legacy deal_id (Oscar 2026-05-19):
//   · New button "🔧 Backfill" next to "🔍 Doublons" on the deals page.
//   · Scans every contract produit lacking a deal_id; heuristic match
//     to deals by client + ISIN exact + name + nominal proximity + fourn.
//   · Review modal with 3 sections by confidence — Oscar confirms each
//     row before any DB write. Idempotent (re-runnable safely).
//   · Repairs cascade-delete coverage on legacy data (pre-Phase K).
// (Previous: 2026-05-18 v42 — Phase L.5 save-to-catalogue prompt.)
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
const CACHE_NAME = 'dealflow-v50';
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
