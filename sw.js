// Deal Flow — Service Worker
// Stratégie : network-first pour l'app shell (toujours essayer la dernière version,
// fallback cache si offline). Aucune interception des appels Supabase / CDN.

// 2026-05-19 v55 — Universal product import + L.5 modal refactor (3 changes) :
//   1. importCSV renamed to importDealsFile, now accepts .csv/.xlsx/.xlsm.
//      Excel parsed via SheetJS (sheet_to_json with header:1, header-name
//      mapping tolerant of column reordering, fallback to positional). Both
//      paths converge on _processImportRows which scans for unknown (fourn,
//      ISIN/part) combos and queues them into the universal product modal
//      BEFORE inserting any deal. Deal-insert loop extracted into
//      _executeDealImport so both "no new products" and "modal confirmed"
//      paths reuse it.
//   2. NEW productImportModal in index.html — universal review surface for
//      product additions/updates. Editable ISIN/Name/Type/Currency/Fees with
//      ADD-tranche button, link-to-existing dropdown per row, skip checkbox,
//      and (in savedeal mode only) per-row "Toujours sauver pour <fourn>"
//      flag that persists fourn.auto_save_products = true. Mode-switched
//      DOM serves both Excel auto-detect and L.5 save-to-catalogue.
//   3. L.5 popup (saveDeal) refactored : native confirm() replaced with
//      _showSaveToCatalogueModal() promise wrapper around the new modal.
//      Detection extended : in addition to "completely unknown" products,
//      known products are now flagged when their fees array differs from
//      the deal entry (deep compare on kind + pct to 4 decimals). Modal
//      rows render as "Modifier produit existant" with a visual old/new
//      fees diff. Per-fourn auto_save_products bypass = silent save with
//      a toast, no modal interruption.
// 2026-05-19 v60.1 — PF perf switched from cumulative-window to per-period (since last PF invoice baseline).
// 2026-05-19 v60 — Cleanup orphan renderUFDeals + auto-push PF after perf import (no manual button).
// 2026-05-19 v59 — Fournisseurs DB: nouvelle colonne Nominal (sum codif.nominal par fourn) entre Nb deals et UF total.
// 2026-05-19 v58 — Facturation bucketing + PF tracked-perf + alert (3 fixes) :
//   1. "Suivi des factures Up-Front" and "Suivi des factures Perf fees" no longer
//      show deals with fSt='À émettre' (Ayal/Fantômas bug). Canonical "this is an
//      invoice" predicate is now entry.invS != empty. Unissued entries belong
//      ONLY in the rapprochement / "Deals à facturer" tables (renderUFRappr /
//      renderPFRappr). Fix lives in _filterInvByTab — single chokepoint for UF/PF
//      Suivi tables. Run/rapprochement_db flow unchanged (it already filters
//      r.declared!=null and was correct).
//   2. PF amount in renderPFInvTable is now derived LIVE from the product's
//      vlHistory (Suivi Perf imports) instead of relying solely on the stored
//      codif.pf.amount snapshot. New helpers : codifFindProduct, codifProductTracked,
//      codifProductPerfPct, codifEffectivePFAmount. Formula (pct mode) :
//        pfAmount = codif.nominalEUR × max(0, perfPct - hurdle) × rate / 10000
//      where perfPct = (latestVL - earliestVL) / earliestVL × 100. Fixed mode
//      unchanged (returns stored amount). The Suivi-Perf push action remains the
//      way to persist the snapshot for invoicing; this just keeps the display
//      honest in real time.
//   3. New dynamic alert "Perf non trackée — <produit>" in buildAlerts (category
//      rapprochement, severity warning). Raised for every distinct (fourn, isin)
//      with a pct-mode PF whose product has no vlHistory. NOT dismissable —
//      auto-resolves the moment the user imports the suivi de perf. Dedup so
//      multiple deals on the same product surface as a single alert row.
// (Previous: 2026-05-19 v55 — Universal product import + L.5 modal refactor.)
// (Previous: 2026-05-19 v54 — CIF/COA toggle relocated + per-contract (3 fixes) :
//   1. Activité toggle MOVED out of Line 1 (Vendeur/Trade date/Statut/Activité)
//      and INTO the Contrat block, right next to Type de contrat. Line 1 grid
//      restored to 3 columns (Vendeur / Trade date / Statut). Each contract
//      now carries its own CIF/COA — even though a deal is 1 client × 1
//      contract since L.4, this keeps activity semantically on the contract
//      where it belongs. Dépositaire pushed to its own row below to keep the
//      4-col Type/Activité/Total/Devise layout breathable.
//   2. Click handler rewritten as event delegation on #dealModal
//      (modal._activityToggleDelegated flag — idempotent). Works for every
//      .toggle-cif-coa in the modal, including ones added after open via
//      add-contract / add-client during the same session. Visual flips on
//      click; .dataset.value + .is-cif / .is-coa class stay in sync.
//   3. saveDeal reads activity from the per-contract toggle (via
//      _collectContractBlock -> contractData.activity). _buildDealRowFromContract
//      prefers contractData.activity over the legacy `activity` arg. The
//      activity column on the deals table is unchanged (still 1 value per
//      deal row — fine because L.4 already collapsed deals to 1 contract).
//      renderActivite() unchanged — still reads d.activity per-deal. Pilotage
//      Activité card keeps working as-is.
//      Pilotage Activité card keeps working as-is.)
// (Previous: 2026-05-19 v53 — CIF/COA activity type system :
//   1. New `activity` column on deals table (text, default 'CIF', check
//      constraint CIF|COA, backfilled). Migration SQL in db/deals_activity_v53.sql.
//   2. Deal modal Line 1 promoted from 3 -> 4 columns (Vendeur / Trade date /
//      Statut / Activité). Activité is an iOS-style pill toggle (CIF left blue,
//      COA right green) — click slides the thumb. data-value drives JS, .is-cif /
//      .is-coa class drives the CSS thumb position + active-label color.
//   3. rowToDeal mapper defaults d.activity to 'CIF' for legacy rows that
//      haven't been touched since migration. _buildDealRowFromContract carries
//      activity through to the upsert payload. setupActivityToggle() is wired
//      in openDealModal() (idempotent — _activityToggleWired flag).
//   4. Pilotage : new 'Activité — répartition CIF vs COA' card at the bottom
//      of the page. Two cells (CIF blue / COA green), each showing nb clients
//      distincts, nb fournisseurs distincts, CA total (UF+Run+PF paid for the
//      current year). renderActivite() runs inside renderCharts(); Running
//      attribution uses fourn-set heuristic on rapprochement_db (no schema
//      change there). Correlation one-liner summarises the % split.
// (Previous: 2026-05-19 v52 — UX polish bundle (4 small fixes):
//   1. Suivi Contrats : standalone "Templates de contrats" section removed
//      (was top of page, dead code since L.7 — templates now managed inline
//      per fournisseur). renderTemplatesPanel/toggleTemplatesPanel/ctrTemplatesOpen
//      all dropped. openTemplateModal/confirmDeleteTemplate kept (still used by
//      the inline fourn UI).
//   2. Pilotage : "Répartition par devise (nominal)" chart moved next to
//      "Pipeline & facturation — par statut" inside a single .g2 grid. Pipeline
//      had been full-width since v50 (Audrey vs David removal); now both charts
//      share the row, height-balanced at 220px each.
//   3. Deal modal : Broker dropdown moved from Row 1 (alongside Fournisseur /
//      Produit / Type / ISIN / Maturité) to Row 2 (next to Assureur + Nominal).
//      Row 1 grid shrinks from 7 → 6 columns. All ids/handlers/.dfBroker class
//      preserved — save path at saveDeal() unchanged.
//   4. KPI titles : verified already dynamic via String(new Date().getFullYear()).
//      No hardcoded year in any KPI label (CA total, UF payés, Running payés,
//      Perf fees, Chiffre d'affaires). Confirmed clean — no edit needed.
// (Previous: 2026-05-19 v51 — Phase M.1 + M.2 + M.3 bundled: dynamic vendor management
//   (vendeurs_db schema + Équipe CRUD UI + sidebar/deal-form/client-form pickers data-driven).
//   · New table vendeurs_db (id/name/color/initial/sort_order/created_at/archived_at)
//     seeded with Audrey(blue) + David(green). RLS open. SQL in db/vendeurs_db_M1.sql.
//   · loadVendeurs() in initApp fills vendeurs_db; falls back to hardcoded Audrey/David
//     if table missing or empty. Realtime channel on vendeurs_db re-renders sidebar.
//   · Sidebar Équipe block: vbtn buttons now generated by renderVbtnList() from
//     active (archived_at IS NULL) vendeurs_db rows, ordered by sort_order.
//   · Deal form #mV + Client form #cVendeur: populated by renderMVOptions() /
//     renderCVendeurOptions() on modal open. Archived vendors referenced in legacy
//     rows are preserved as "(archivé)" options so editing doesn't lose the link.
//   · Équipe page: new "Vendeurs" section above "Comptes" with CRUD + Modifier/Archiver/
//     Réactiver actions. Vendor modal uses 8-preset color chips
//     (blue/green/purple/amber/red/teal/pink/slate). Soft cap warning at 8 active.
//   · style.css: added teal/pink/slate tokens; .av.color-{name} classes for all 8.
// (Previous: 2026-05-19 v50 — L.10 Facturation Rapprochement par fournisseur vendor filter + Audrey vs David chart removed.
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
// (Previous: 2026-05-19 v57 — Close deal modal before save-to-catalogue popup (was popping behind).)

//   Allocation mismatch warning: red border on Total contrat + blocking confirm() if save with écart > 0.5.
// 2026-05-19 v56 — Replaced buggy CIF/COA iOS toggle with native <select> dropdown.
//   Dépositaire restored to same row as Type de contrat (5-col layout).
//     deal with this product auto-fills correctly via the existing
//     onDealIsinChange / _onDealProduitChange paths.
// (Previous: 2026-05-18 v41 — Phase L.4 1 deal = 1 produit + cascade diag.)
const CACHE_NAME = 'dealflow-v60-1';
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
