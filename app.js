// ── SUPABASE CLIENT ───────────────────────────────────────────────────────────
var SUPABASE_URL='https://nlnvnqfuuggtbcqvnxag.supabase.co';
var SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sbnZucWZ1dWdndGJjcXZueGFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNjYyMjgsImV4cCI6MjA5MzY0MjIyOH0.DpaQdphDzDkl7_Q1VoUfH9Z3EbAP21rTl0GVkBtnwd0';
var sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);

// JS camelCase <-> DB snake_case mapping for deals
var DATE_FIELDS=['date','issue','inv_s','inv','end_date','terme','maturite','runStart','run_start'];
// Columns we'll strip out at insert/update time when the DB schema cache says
// they don't exist. Populated on demand from PostgREST error messages.
var _missingDealCols={};
function dealToRow(d){
  var r=Object.assign({},d);
  delete r._id; delete r.created_at; delete r.updated_at;
  r.uf_r=r.ufR; r.run_r=r.runR; r.uf_e=r.ufE; r.run_e=r.runE;
  r.inv_s=r.invS; r.f_st=r.fSt; r.f_ref=r.fRef;
  r.arb_id=r.arbId; r.arb_src=r.arbSrc; r.arb_closed=r.arbClosed;
  r.end_date=r.end;
  r.deal_group_id=r.dealGroupId; delete r.dealGroupId;
  r.fx_date=r.fxDate||null; delete r.fxDate;
  r.paid_at=r.paidAt||null; delete r.paidAt;
  delete r.ufR; delete r.runR; delete r.ufE; delete r.runE;
  delete r.invS; delete r.fSt; delete r.fRef;
  delete r.arbId; delete r.arbSrc; delete r.arbClosed; delete r.end;
  // Normalize empty strings to null for date-typed columns (Postgres rejects "")
  DATE_FIELDS.forEach(function(f){if(r[f]==='')r[f]=null;});
  // Strip columns previously flagged as missing in the schema cache
  Object.keys(_missingDealCols).forEach(function(k){delete r[k];});
  return r;
}
// Try to detect a "Could not find the 'X' column of 'Y' in the schema cache" error.
// Returns the missing column name if matched (and remembers it), null otherwise.
function _detectMissingDealCol(err){
  var msg=String((err&&err.message)||err||'');
  var m=msg.match(/Could not find the '([^']+)' column of '([^']+)' in the schema cache/i);
  if(m&&m[2]==='deals'){_missingDealCols[m[1]]=true;return m[1];}
  return null;
}
function rowToDeal(r){
  var d=Object.assign({},r);
  d._id=d.id; delete d.id; delete d.created_at; delete d.updated_at;
  d.ufR=d.uf_r; d.runR=d.run_r; d.ufE=d.uf_e; d.runE=d.run_e;
  d.invS=d.inv_s; d.fSt=d.f_st; d.fRef=d.f_ref;
  d.arbId=d.arb_id; d.arbSrc=d.arb_src; d.arbClosed=d.arb_closed;
  d.end=d.end_date;
  d.dealGroupId=d.deal_group_id||null; delete d.deal_group_id;
  d.fxDate=d.fx_date||null; delete d.fx_date;
  d.paidAt=d.paid_at||null; delete d.paid_at;
  delete d.uf_r; delete d.run_r; delete d.uf_e; delete d.run_e;
  delete d.inv_s; delete d.f_st; delete d.f_ref;
  delete d.arb_id; delete d.arb_src; delete d.arb_closed; delete d.end_date;
  return d;
}
function rowToRef(r){var d=Object.assign({},r);d._id=d.id;delete d.id;delete d.created_at;delete d.updated_at;return d;}

// ── Phase 3 — FX rates (Frankfurter / ECB) ─────────────────────────────────
// In-memory cache + localStorage persistence. Keyed by "from-to-date".
// Returns the multiplier rate so: amount_to = amount_from * rate.
var _FX_CACHE_KEY='dealflow-fx-cache-v1';
var _fxCache={};
function _fxLoadFromStorage(){
  try{var s=localStorage.getItem(_FX_CACHE_KEY);if(s)_fxCache=JSON.parse(s)||{};}catch(e){_fxCache={};}
}
function _fxSaveToStorage(){
  try{localStorage.setItem(_FX_CACHE_KEY,JSON.stringify(_fxCache));}catch(e){}
}
_fxLoadFromStorage();
// Phase J.4 — FX API switched 2026-05-15 from Frankfurter (api.frankfurter.app)
// to fawazahmed0/currency-api via jsdelivr CDN.
//
// Why : Frankfurter started returning 301 redirects which Chrome blocks via CORS
// when the response doesn't carry the Access-Control-Allow-Origin header on the
// redirect itself. The new API is on jsdelivr's CDN (Cloudflare-fronted) so CORS
// is always present. Also free, no API key, no rate limit, daily-updated rates.
//
// API shape :
//   Latest : https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{from}.json
//     → {"date":"2025-...","{from}":{"eur":0.92,"gbp":0.78,...}}
//   Historical : https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{date}/v1/currencies/{from}.json
//     → same shape, rates at that date
//
// Currency codes are LOWERCASE in this API (usd, eur — not USD, EUR). We
// normalise inside the function so callers can keep passing uppercase.
//
// Fallback : if historical fails (future date / not yet tagged), try 'latest'.
async function getFxRate(from,to,date){
  if(!from||!to||from===to)return 1;
  var dKey=date||'latest';
  var key=from+'-'+to+'-'+dKey;
  if(_fxCache[key]!=null)return _fxCache[key];
  var fromLo=from.toLowerCase(), toLo=to.toLowerCase();
  // Primary attempt — at the requested date if specific, else 'latest'.
  // The jsdelivr URL uses '@latest' for the rolling/latest tag, '@2025-12-31' etc for historical.
  var dateTag = (dKey==='latest') ? '@latest' : '@'+dKey;
  var url='https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api'+dateTag+'/v1/currencies/'+fromLo+'.json';
  try{
    var res=await fetch(url);
    if(!res.ok)throw new Error('HTTP '+res.status);
    var data=await res.json();
    var rate=data && data[fromLo] && data[fromLo][toLo];
    if(rate==null)throw new Error('No rate '+to+' in '+from+' response');
    _fxCache[key]=rate;
    if(data.date && data.date!==dKey) _fxCache[from+'-'+to+'-'+data.date]=rate;
    _fxSaveToStorage();
    return rate;
  }catch(err){
    console.warn('[FX] primary fetch failed for '+key+' ('+url+')',err);
    // Fallback to 'latest' if specific date failed (= future date or no tag yet).
    if(dKey !== 'latest'){
      try{
        var urlL='https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/'+fromLo+'.json';
        var resL = await fetch(urlL);
        if(resL.ok){
          var dataL = await resL.json();
          var rateL = dataL && dataL[fromLo] && dataL[fromLo][toLo];
          if(rateL != null){
            _fxCache[key] = rateL;
            _fxCache[from+'-'+to+'-latest'] = rateL;
            if(dataL.date) _fxCache[from+'-'+to+'-'+dataL.date] = rateL;
            _fxSaveToStorage();
            console.warn('[FX] '+from+'→'+to+' for '+dKey+' fell back to latest ('+(dataL.date||'?')+') = '+rateL);
            return rateL;
          }
        }
      }catch(err2){
        console.warn('[FX] latest fallback also failed for '+from+'-'+to, err2);
      }
    }
    return null; // caller treats null = "could not resolve"
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase I — FX HELPERS (Phase I.2)
// ═══════════════════════════════════════════════════════════════════════════
//
// Storage convention (legacy, kept for backward compat):
//   d.fx = native_per_EUR (e.g. USD 1.087 means 1 EUR = 1.087 USD)
//   d.nom is in deal's native currency (d.dev)
//   Conversion to EUR: nomEur = d.nom / d.fx
//
// Display convention (sens humain — what Oscar wants everywhere):
//   "1 USD = 0,92 EUR" — answers "how many EUR for my USD nominal?"
//   Formula: rateHuman = 1 / d.fx
//
// API source: fawazahmed0/currency-api via jsdelivr CDN (swapped from
// Frankfurter on 2026-05-15 — see Phase J.4 comment block above getFxRate
// for the why). Returns sens humain directly:
//   getFxRate('USD','EUR','2026-05-15') → 0.92 (EUR per USD)
//   We INVERT once at storage time (line 4416 fxRate=1/resolved) to keep d.fx
//   in the legacy convention. Then INVERT BACK at display time (1/d.fx).
//
// These helpers centralise the conversion so every renderer reads the same
// canonical values without each one re-implementing the math.

// Returns the human-sense FX rate for a deal — "1 native = X EUR".
// Use for any UI that displays "1 USD = 0,92 EUR" type strings.
function fxHumanRate(d){
  if(!d || !d.dev || d.dev==='EUR' || !d.fx) return 1;
  return 1 / d.fx;
}

// Convert a NATIVE amount to EUR using the deal's snapshotted FX.
// Use for: nominal display, theoretical fee amounts at trade-date.
function fxToEur(nativeAmount, d){
  if(!d || !d.dev || d.dev==='EUR') return nativeAmount||0;
  return (nativeAmount||0) / (d.fx||1);
}

// Convert a NATIVE amount to EUR using a fresh FX rate fetched for a specific date.
// Use for: billing-date conversions, perf valuation conversions. Async because
// it may need to fetch a fresh rate from Frankfurter.
// Returns {eur:number, rate:number, rateDate:string, snapshot:boolean}
//   snapshot = true means we fell back to the trade-date FX (API failed or no date)
async function fxToEurAtDate(nativeAmount, d, date){
  if(!d || !d.dev || d.dev==='EUR'){
    return {eur:nativeAmount||0, rate:1, rateDate:date||'', snapshot:false};
  }
  var native = nativeAmount||0;
  if(!date){
    // No date → fall back to trade-date snapshot
    return {eur: fxToEur(native, d), rate: fxHumanRate(d), rateDate: d.fxDate||d.date||'', snapshot:true};
  }
  var rate = await getFxRate(d.dev, 'EUR', date);
  if(rate==null){
    // API failed → fall back to snapshot, mark it
    return {eur: fxToEur(native, d), rate: fxHumanRate(d), rateDate: d.fxDate||d.date||'', snapshot:true};
  }
  return {eur: Math.round(native * rate), rate: rate, rateDate: date, snapshot:false};
}

// Display helper — formats a "1 X = Y EUR" pill for any deal/currency context.
function fxRatePill(d){
  if(!d || !d.dev || d.dev==='EUR') return '';
  var rate = fxHumanRate(d);
  var dateStr = d.fxDate || d.date || '';
  return '1 '+d.dev+' = '+rate.toFixed(4)+' EUR'+(dateStr?' (au '+dateStr+')':'');
}
// Display helper — formats a "USD 1 234 × 0,9200 = EUR 1 135" breakdown.
// Use for: every invoice that involves a native-currency amount.
function fxBreakdownLine(nativeAmount, dev, rateHuman, dateStr){
  if(!dev || dev==='EUR') return '';
  var eur = Math.round((nativeAmount||0) * rateHuman);
  var nfmt = new Intl.NumberFormat('fr-FR');
  var efmt = new Intl.NumberFormat('fr-FR');
  return dev+' '+nfmt.format(Math.round(nativeAmount||0))+' × '+rateHuman.toFixed(4)+
         (dateStr?' (taux '+dateStr+')':'')+' = EUR '+efmt.format(eur);
}

async function sbGet(table){
  var res=await sb.from(table).select('*');
  if(res.error)throw res.error;
  return (res.data||[]).map(function(r){return{id:r.id,data:table==='deals'?rowToDeal(r):rowToRef(r)};});
}
var _warnedMissingCols={};
function _warnAboutMissingCol(col){
  if(_warnedMissingCols[col])return;
  _warnedMissingCols[col]=true;
  // Friendly toast — explain the workaround
  toast('Colonne "'+col+'" absente — sauvegardé sans. Lance le SQL d\'ajout dans Supabase pour activer ce champ.');
  console.warn('[Schema cache] deals.'+col+' missing. To enable it, run in Supabase SQL editor: alter table deals add column '+col+(col==='terme'?' date;':' text;'));
}

// Phase J.1 — loop retry on "missing column" errors so we handle MULTIPLE unknown
// columns in sequence (was one-shot retry → second unknown col still failed).
// Up to 5 retries (= 5 unknown columns to discover and strip per call). After
// that we give up and surface the error.
async function sbInsert(table,data){
  var row=table==='deals'?dealToRow(data):Object.assign({},data);
  delete row.id; delete row._id;
  var res=await sb.from(table).insert(row).select();
  for(var attempt=0; attempt<5 && res.error && table==='deals'; attempt++){
    var miss=_detectMissingDealCol(res.error);
    if(!miss) break;
    _warnAboutMissingCol(miss);
    var row2=dealToRow(data);
    delete row2.id; delete row2._id;
    res=await sb.from(table).insert(row2).select();
  }
  if(res.error)throw res.error;
  return (res.data||[]).map(function(r){return{id:r.id,data:table==='deals'?rowToDeal(r):rowToRef(r)};});
}
async function sbUpdate(table,id,data){
  var row=table==='deals'?dealToRow(data):Object.assign({},data);
  delete row.id; delete row._id; delete row.created_at;
  var res=await sb.from(table).update(row).eq('id',id).select();
  for(var attempt=0; attempt<5 && res.error && table==='deals'; attempt++){
    var miss=_detectMissingDealCol(res.error);
    if(!miss) break;
    _warnAboutMissingCol(miss);
    var row2=dealToRow(data);
    delete row2.id; delete row2._id; delete row2.created_at;
    res=await sb.from(table).update(row2).eq('id',id).select();
  }
  if(res.error)throw res.error;
  return (res.data||[]).map(function(r){return{id:r.id,data:table==='deals'?rowToDeal(r):rowToRef(r)};});
}
async function sbDelete(table,id){
  var res=await sb.from(table).delete().eq('id',id);
  if(res.error)throw res.error;
  return true;
}
async function sbGetAll(table){
  var res=await sb.from(table).select('*');
  if(res.error)throw res.error;
  return (res.data||[]).map(function(r){return table==='deals'?rowToDeal(r):rowToRef(r);});
}

// ── RAPPROCHEMENT CACHE (in-memory + Supabase) ────────────────────────────────
var rapprochement_db=[];
function rapprFind(fourn,type,period){
  return rapprochement_db.find(function(r){return r.fourn===fourn&&r.type===type&&r.period===(period||null);});
}
function rapprRowToObj(r){
  return {id:r.id,fourn:r.fourn,type:r.type,period:r.period,declared:r.declared,comment:r.comment||'',facture:r.facture||false,factureDate:r.facture_date||'',paid:r.paid||false,paidDate:r.paid_date||'',theoTrim:r.theo_trim||0};
}
async function rapprSave(fourn,type,period,data){
  // Validate period format: 'run'/'encours' need T#_YEAR; 'uf'/'pf' need null
  if(type==='run'||type==='encours'){
    if(!period||!/^T[1-4]_\d{4}$/.test(period))throw new Error('Période invalide pour '+type+': "'+period+'" (attendu T#_YYYY)');
  } else if(type==='uf'||type==='pf'){
    if(period)throw new Error('Période non vide pour type '+type+' (attendu null)');
  } else {
    throw new Error('Type rapprochement inconnu: '+type);
  }
  // Validate declared amount: refuse negative or absurd values
  var declared=Number(data&&data.declared);
  if(!isFinite(declared))throw new Error('Montant déclaré invalide (NaN/Infinity).');
  if(declared<0)throw new Error('Montant déclaré négatif refusé : '+declared+' € (entrez 0 ou un montant positif).');
  if(declared>1e10)throw new Error('Montant déclaré anormalement élevé : '+declared+' € — vérifiez la saisie.');
  if(!fourn||typeof fourn!=='string')throw new Error('Fournisseur invalide.');
  var existing=rapprFind(fourn,type,period);
  var row={fourn:fourn,type:type,period:period||null,declared:data.declared,comment:data.comment||'',facture:data.facture||false,facture_date:data.factureDate||null,paid:data.paid||false,paid_date:data.paidDate||null,theo_trim:data.theoTrim||null};
  if(existing){
    var res=await sb.from('rapprochement').update(row).eq('id',existing.id).select();
    if(res.error)throw res.error;
    if(res.data&&res.data[0])Object.assign(existing,rapprRowToObj(res.data[0]));
  } else {
    var res=await sb.from('rapprochement').insert(row).select();
    if(res.error)throw res.error;
    if(res.data&&res.data[0])rapprochement_db.push(rapprRowToObj(res.data[0]));
  }
}
async function rapprDelete(fourn,type,period){
  var existing=rapprFind(fourn,type,period);
  if(!existing)return;
  var res=await sb.from('rapprochement').delete().eq('id',existing.id);
  if(res.error)throw res.error;
  rapprochement_db=rapprochement_db.filter(function(r){return r.id!==existing.id;});
}

// ── WEALINS CONTRACTS (in-memory + Supabase) ─────────────────────────────────
var contracts_db=[];

// Default checklist seeds — each contract/investissement gets its own copy at creation,
// then can be customized (add / rename / delete steps).
var PRELIM_DEFAULTS=[
  {id:'p1',label:'Contrat Wealins ouvert'},
  {id:'p2',label:'Mandat tripartite établi (Indosuez / Wealins / Chamfeuil)'},
  {id:'p3',label:'Mandat envoyé à Indosuez — rattachement plateforme'},
  {id:'p4',label:'Avis de virement envoyé à Wealins'}
];
var STEPS_DEFAULTS={
  'structuré':[
    {id:'s1',label:'Term Sheet envoyée sur e-Wealins (Vos Investissements)',note:'Joindre DIC'},
    {id:'s2',label:'Code ISIN renseigné dans la demande'},
    {id:'s3',label:'Éligibilité FAS validée par Wealins'},
    {id:'s4',label:'Questionnaire de connaissance client envoyé par Wealins'},
    {id:'s5',label:'Questionnaire complété par le client'},
    {id:'s6',label:'Avenant signé (courtier + client)'},
    {id:'s7',label:'Avenant validé par Wealins'},
    {id:'s8',label:'Ordre transmis par e-mail à Indosuez (compte + quantité + ISIN)',note:'Obligatoire'}
  ],
  'ucits':[
    {id:'u1',label:'Investissement initié sur e-Wealins'},
    {id:'u2',label:'Ordre passé sur MyIndosuez'},
    {id:'u3',label:'Confirmation reçue'}
  ],
  'alternatif':[
    {id:'a1',label:"E-mail envoyé à Wealins (contrat(s) + montants)"},
    {id:'a2',label:"Confirmation d'éligibilité reçue de Wealins"},
    {id:'a3',label:'Investissement réalisé sur e-Wealins'},
    {id:'a4',label:'Ordre passé sur MyIndosuez'},
    {id:'a5',label:'Confirmation reçue'}
  ]
};
var WTYPE_LBL={'structuré':'Structuré','ucits':'UCITS','alternatif':'Alternatif'};
var WTYPE_BADGE={'structuré':'bg','ucits':'bb','alternatif':'ba'};

function newStepId(){return 'st_'+Math.random().toString(36).slice(2,9);}
function defaultPrelim(){return [];}
function defaultStepsFor(type){return [];}
// Defaults remain available via "Charger défauts Wealins" buttons in the modals (optional convenience).
function seedPrelimDefaults(){return PRELIM_DEFAULTS.map(function(s){return{id:newStepId(),label:s.label,done:false};});}
function seedStepsForType(type){var arr=STEPS_DEFAULTS[type]||[];return arr.map(function(s){var o={id:newStepId(),label:s.label,done:false};if(s.note)o.note=s.note;return o;});}

function parseMoney(s){
  if(!s)return 0;
  var cleaned=String(s).replace(/[^\d,.\-]/g,'').replace(/\s/g,'');
  var lastComma=cleaned.lastIndexOf(','),lastDot=cleaned.lastIndexOf('.');
  var normalized=cleaned;
  if(lastComma>lastDot)normalized=cleaned.replace(/\./g,'').replace(',','.');
  else if(lastDot>-1)normalized=cleaned.replace(/,/g,'');
  var n=parseFloat(normalized);
  return isNaN(n)?0:n;
}

function prelimProgress(c){
  var steps=(c&&Array.isArray(c.prelim))?c.prelim:[];
  if(!steps.length)return{done:0,total:0,pct:0};
  var done=steps.filter(function(s){return s.done;}).length;
  return{done:done,total:steps.length,pct:Math.round(done/steps.length*100)};
}
function prodProgress(p){
  var steps=(p&&Array.isArray(p.steps))?p.steps:[];
  if(!steps.length)return{done:0,total:0,pct:0};
  var done=steps.filter(function(s){return s.done;}).length;
  return{done:done,total:steps.length,pct:Math.round(done/steps.length*100)};
}
// Status d'un contrat — basé sur le pourcentage global pour rester cohérent.
// Règle simple : si globalPct === 100% et qu'il y a au moins un investissement
// (sinon on n'a rien à suivre), c'est 'done'. Si rien n'est coché du tout, 'new'.
// Sinon 'in-progress'. Cette logique est volontairement alignée avec globalPct
// pour qu'on ne puisse plus avoir 100% affiché ET "En cours" en même temps.
function contratStatus(c){
  var pp=prelimProgress(c);
  var produits=c.produits||[];
  var allEmpty=pp.done===0&&produits.every(function(p){return prodProgress(p).done===0;});
  if(allEmpty)return'new';
  var pct=globalPct(c);
  if(pct>=100&&produits.length>0)return'done';
  return'in-progress';
}
function globalPct(c){
  var pp=prelimProgress(c);
  var totalSteps=pp.total,doneSteps=pp.done;
  (c.produits||[]).forEach(function(p){var pr=prodProgress(p);totalSteps+=pr.total;doneSteps+=pr.done;});
  return totalSteps?Math.round(doneSteps/totalSteps*100):0;
}
function pendingProcedures(){
  // count investments with progress < 100% across all contracts
  var n=0;
  contracts_db.forEach(function(c){
    (c.produits||[]).forEach(function(p){
      var pr=prodProgress(p);
      if(pr.total>0&&pr.done<pr.total)n++;
    });
  });
  return n;
}

function rowToContract(r){
  return {
    _id:r.id,
    client:r.client,
    num:r.num||'',
    banque:r.banque||'Indosuez Luxembourg',
    notes:r.notes||'',
    template_name:r.template_name||'',
    prelim:Array.isArray(r.prelim)?r.prelim:defaultPrelim(),
    produits:Array.isArray(r.produits)?r.produits:[],
    created_at:r.created_at
  };
}

async function loadContracts(){
  var res=await sb.from('contracts').select('*');
  if(res.error)throw res.error;
  contracts_db=(res.data||[]).map(rowToContract);
}
async function saveContract(c){
  var row={
    client:c.client,
    num:c.num||null,
    banque:c.banque||'Indosuez Luxembourg',
    notes:c.notes||null,
    template_name:c.template_name||null,
    prelim:Array.isArray(c.prelim)?c.prelim:defaultPrelim(),
    produits:Array.isArray(c.produits)?c.produits:[]
  };
  if(c._id){
    var res=await sb.from('contracts').update(row).eq('id',c._id).select();
    if(res.error)throw res.error;
    var existing=contracts_db.find(function(x){return x._id===c._id;});
    if(existing&&res.data&&res.data[0]){
      var fresh=rowToContract(res.data[0]);
      Object.assign(existing,fresh);
    }
    return existing;
  } else {
    var res=await sb.from('contracts').insert(row).select();
    if(res.error)throw res.error;
    if(res.data&&res.data[0]){
      var nc=rowToContract(res.data[0]);
      contracts_db.push(nc);
      return nc;
    }
  }
}
async function deleteContractDB(id){
  var res=await sb.from('contracts').delete().eq('id',id);
  if(res.error)throw res.error;
  contracts_db=contracts_db.filter(function(c){return c._id!==id;});
}
function contractsForClient(clientName){
  return contracts_db.filter(function(c){return c.client===clientName;});
}

// ── CONTRACT TEMPLATES (procédures réutilisables, multi-packs) ──────────────
var templates_db=[];
function rowToTemplate(r){
  // step_packs is the canonical field. Legacy templates may have only `steps`
  // (a flat array) — wrap them into a single "Standard" pack so the UI keeps working.
  var packs=Array.isArray(r.step_packs)?r.step_packs:[];
  if(!packs.length&&Array.isArray(r.steps)&&r.steps.length){
    packs=[{id:'pack_legacy',name:'Standard',steps:r.steps}];
  }
  return{
    _id:r.id,
    name:r.name,
    prelim:Array.isArray(r.prelim)?r.prelim:[],
    step_packs:packs,
    created_at:r.created_at
  };
}
async function loadTemplates(){
  var res=await sb.from('contract_templates').select('*').order('name');
  if(res.error)throw res.error;
  templates_db=(res.data||[]).map(rowToTemplate);
}
async function saveTemplate(t){
  var row={
    name:t.name,
    prelim:Array.isArray(t.prelim)?t.prelim:[],
    step_packs:Array.isArray(t.step_packs)?t.step_packs:[],
    // Keep `steps` empty going forward — packs is the canonical field.
    steps:[]
  };
  if(t._id){
    var res=await sb.from('contract_templates').update(row).eq('id',t._id).select();
    if(res.error)throw res.error;
    var existing=templates_db.find(function(x){return x._id===t._id;});
    if(existing&&res.data&&res.data[0])Object.assign(existing,rowToTemplate(res.data[0]));
    return existing;
  } else {
    var res=await sb.from('contract_templates').insert(row).select();
    if(res.error)throw res.error;
    if(res.data&&res.data[0]){var nt=rowToTemplate(res.data[0]);templates_db.push(nt);return nt;}
  }
}
async function deleteTemplate(id){
  var res=await sb.from('contract_templates').delete().eq('id',id);
  if(res.error)throw res.error;
  templates_db=templates_db.filter(function(t){return t._id!==id;});
}
async function seedDefaultTemplates(){
  if(templates_db.length>0)return;
  var wealins={
    name:'Wealins',
    prelim:PRELIM_DEFAULTS.map(function(s){return{id:newStepId(),label:s.label};}),
    step_packs:[
      {id:newStepId(),name:'Produit Structuré',steps:STEPS_DEFAULTS['structuré'].map(function(s){var o={id:newStepId(),label:s.label};if(s.note)o.note=s.note;return o;})},
      {id:newStepId(),name:'UCITS',steps:STEPS_DEFAULTS['ucits'].map(function(s){var o={id:newStepId(),label:s.label};if(s.note)o.note=s.note;return o;})},
      {id:newStepId(),name:'Alternatif',steps:STEPS_DEFAULTS['alternatif'].map(function(s){var o={id:newStepId(),label:s.label};if(s.note)o.note=s.note;return o;})}
    ]
  };
  try{await saveTemplate(wealins);}catch(e){console.warn('Seed Wealins template failed',e);}
}
function templateByName(name){return templates_db.find(function(t){return t.name===name;});}
// Phase B.2 — pick the template that should drive an investment's step pack.
// Preference: the fournisseur's own template_name → fallback to the contract's.
// Returns the template name (string) or empty string if nothing's set.
function _pickPackTemplate(fournName,contractTemplateName){
  if(fournName){
    var f=fourn_db.find(function(x){return x.name===fournName;});
    if(f && f.template_name) return f.template_name;
  }
  return contractTemplateName||'';
}
function templatePrelimCopy(name){
  var t=templateByName(name);if(!t)return[];
  return t.prelim.map(function(s){return{id:newStepId(),label:s.label,done:false};});
}
function templatePackCopy(templateName,packId){
  // Returns a fresh deep copy of the steps array of the given pack
  var t=templateByName(templateName);if(!t)return[];
  var pack=(t.step_packs||[]).find(function(p){return p.id===packId;});
  if(!pack&&(t.step_packs||[]).length)pack=t.step_packs[0]; // fallback: first pack
  if(!pack)return[];
  return pack.steps.map(function(s){var o={id:newStepId(),label:s.label,done:false};if(s.note)o.note=s.note;return o;});
}
function templatePackForType(templateName,produitType){
  // Try to match a deal's produit_type to one of the template's packs by name fuzzy match
  var t=templateByName(templateName);if(!t||!t.step_packs)return null;
  if(!produitType)return t.step_packs[0];
  var pt=produitType.toLowerCase();
  for(var i=0;i<t.step_packs.length;i++){
    var nm=(t.step_packs[i].name||'').toLowerCase();
    if(nm&&pt.indexOf(nm.split(/\s+/)[0])!==-1)return t.step_packs[i];
    if(nm&&nm.indexOf(pt.split(/\s+/)[0])!==-1)return t.step_packs[i];
  }
  return t.step_packs[0];
}

// Map deal.produit_type → investissement type used for badges
function dealTypeToProdType(pt){
  if(!pt)return'autre';
  var x=pt.toLowerCase();
  if(x.indexOf('struct')!==-1)return'structuré';
  if(x.indexOf('ucits')!==-1||x.indexOf('opcvm')!==-1)return'ucits';
  if(x.indexOf('alternat')!==-1)return'alternatif';
  return'autre';
}

// Audit fix — sync the linked Suivi Contrat's produits[] with the deal's current
// codifications[]. Used on edit (= after saveDeal updates the row). Removes orphans
// (codifs removed by the user), adds new produits for newly-added codifs, and
// updates display fields on existing produits while preserving user-added state
// (steps progress, retraits, arbitrages, arb_origin, notes).
async function _syncContractProduitsForDealEdit(deal){
  if(!deal||!deal._id||!deal.client)return;
  var contract=contracts_db.find(function(c){return c.client===deal.client;});
  if(!contract||!Array.isArray(contract.produits))return;
  var newCodifs=Array.isArray(deal.codifications)?deal.codifications:[];
  var validIdx={};for(var i=0;i<newCodifs.length;i++)validIdx[i]=true;
  var dirty=false;
  var existingIdx={};
  // Pass 1 : iterate existing produits, drop orphans, update matched ones
  var kept=[];
  contract.produits.forEach(function(p){
    if(p.deal_id!==deal._id){kept.push(p);return;}
    var pidx=(p.codif_idx==null)?0:p.codif_idx;
    if(!validIdx[pidx]){dirty=true;return;} // orphan → drop
    existingIdx[pidx]=true;
    var c=newCodifs[pidx];
    var newName=c.produit||p.name;
    var newIsin=c.isin||p.isin||'';
    var newType=dealTypeToProdType(c.type||deal.produit_type);
    var montantStr=c.nominal?(new Intl.NumberFormat('fr-FR').format(c.nominal)+' '+(c.currency||deal.dev||'EUR')):p.montant;
    var fields={name:newName,isin:newIsin,type:newType,montant:montantStr,fourn:c.fourn||'',assureur:c.assureur||'',banque:c.banque||'',billingMode:c.billingMode||'fast'};
    Object.keys(fields).forEach(function(k){if(p[k]!==fields[k]){p[k]=fields[k];dirty=true;}});
    kept.push(p);
  });
  // Pass 2 : add new produits for codifs that don't have a matching produit yet
  newCodifs.forEach(function(c,i){
    if(existingIdx[i])return;
    // Phase B.2 — Investment pack comes from the FOURNISSEUR's template (if it has one),
    // not the contract's. Falls back to contract.template_name when the fourn has none.
    // Preliminary steps still come from the contract template (untouched).
    var pickedPack=null,steps=[],tplUsed=_pickPackTemplate(c.fourn,contract.template_name);
    if(tplUsed){
      pickedPack=templatePackForType(tplUsed,c.type||deal.produit_type);
      if(pickedPack)steps=templatePackCopy(tplUsed,pickedPack.id);
    }
    var notesParts=[];
    if(c.fourn)notesParts.push('Fournisseur: '+c.fourn);
    if(c.assureur)notesParts.push('Assureur: '+c.assureur);
    if(c.banque)notesParts.push('Banque: '+c.banque);
    if(c.broker)notesParts.push('Broker: '+c.broker);
    if(deal.contrat)notesParts.push('Contrat: '+deal.contrat);
    if(c.maturite)notesParts.push('Maturité: '+c.maturite);
    kept.push({
      id:newStepId(),
      name:c.produit||deal.produit||'(produit non nommé)',
      isin:c.isin||'',
      type:dealTypeToProdType(c.type||deal.produit_type),
      pack_name:pickedPack?pickedPack.name:'',
      montant:c.nominal?(new Intl.NumberFormat('fr-FR').format(c.nominal)+' '+(c.currency||deal.dev||'EUR')):'',
      notes:notesParts.join(' · '),
      steps:steps,
      deal_id:deal._id,
      codif_idx:i,
      fourn:c.fourn||'',assureur:c.assureur||'',banque:c.banque||'',billingMode:c.billingMode||'fast'
    });
    dirty=true;
  });
  if(dirty){
    contract.produits=kept;
    try{await saveContract(contract);}catch(e){console.error('saveContract after produits sync failed',e);}
  }
}

// Batch C.1 — On deal creation: find (or create) the client's contract and append
// ONE produit PER codification (= per fournisseur in the new model). Legacy deals
// without codifications[] fall back to a single produit using top-level fields.
//
// K.1 status filter (Oscar 2026-05-18) — a deal saved as 'Deal réalisé' or
// 'Deal payé' is already settled. We don't track those in the contracts page
// because there's nothing left to follow up on. Only in-flight statuses
// ('Deal pipe' + any future intermediate) auto-create a contract.
async function autoLinkDealToContract(deal){
  if(!deal||!deal.client)return;
  if(deal.stat==='Deal réalisé'||deal.stat==='Deal payé')return;
  var clientName=deal.client;
  // Phase L.4 (Oscar 2026-05-18) — always create a NEW contract per deal.
  // Used to find-or-create the client's contract and stack produits; now each
  // deal gets its own dedicated contract (Oscar: "3 contrats séparés sous le
  // même client" si 3 deals). Cascade-delete relies on this 1-to-1 mapping :
  // suppression d'un deal → contrat correspondant vidé puis supprimé.
  var firstCodif=(deal.codifications||[])[0]||{};
  var primaryFournName = firstCodif.assureur || firstCodif.banque || firstCodif.fourn || deal.fourn || '';
  var primaryFourn = primaryFournName ? fourn_db.find(function(f){return f.name===primaryFournName;}) : null;
  var pickedTemplateName = null;
  if(primaryFourn && primaryFourn.template_name && templateByName(primaryFourn.template_name)){
    pickedTemplateName = primaryFourn.template_name;
  } else if(templates_db[0]){
    pickedTemplateName = templates_db[0].name;
  }
  var newC={
    _id:null,client:clientName,num:'',
    banque:deal.depositaire||'Indosuez Luxembourg',
    notes:'',
    template_name:pickedTemplateName,
    prelim:pickedTemplateName?templatePrelimCopy(pickedTemplateName):[],
    produits:[]
  };
  var contract=await saveContract(newC);
  if(!contract)return;
  contract.produits=contract.produits||[];
  // Build the list of items to add — one per codification (preferred) or one fallback legacy
  var sourceItems=[];
  if(Array.isArray(deal.codifications)&&deal.codifications.length){
    sourceItems=deal.codifications.map(function(c,i){return{
      idx:i,
      name:c.produit||deal.produit||'(produit non nommé)',
      isin:c.isin||'',
      type:dealTypeToProdType(c.type||deal.produit_type),
      nominal:c.nominal||0,
      currency:c.currency||deal.dev||'EUR',
      fourn:c.fourn||'',
      assureur:c.assureur||'',
      banque:c.banque||'',
      broker:c.broker||'',
      maturite:c.maturite||null,
      feeSnapshot:c.feeSnapshot||[],
      billingMode:c.billingMode||'fast'
    };});
  } else {
    // Legacy fallback (deals predating Phase 2 with no codifications[])
    sourceItems=[{
      idx:0,
      name:deal.produit||'(produit non nommé)',
      isin:deal.isin||'',
      type:dealTypeToProdType(deal.produit_type),
      nominal:deal.nom||0,
      currency:deal.dev||'EUR',
      fourn:deal.fourn||'',assureur:'',banque:'',broker:deal.broker||'',
      maturite:deal.maturite||deal.terme||null,
      feeSnapshot:[],billingMode:'fast'
    }];
  }
  var addedCount=0,lastAddedProd=null;
  sourceItems.forEach(function(item){
    // Dedup: a (deal_id, codif_idx) tuple must not already exist as a produit in this contract.
    if(deal._id&&contract.produits.some(function(p){
      var sameDeal=p.deal_id===deal._id;
      if(!sameDeal)return false;
      var pidx=p.codif_idx;
      // Legacy produits without codif_idx are treated as the codif #0 slot
      var pidxNorm=(pidx==null)?0:pidx;
      return pidxNorm===item.idx;
    }))return;
    var montantStr=item.nominal?(new Intl.NumberFormat('fr-FR').format(item.nominal)+' '+item.currency):'';
    var notesParts=[];
    if(item.fourn)notesParts.push('Fournisseur: '+item.fourn);
    if(item.assureur)notesParts.push('Assureur: '+item.assureur);
    if(item.banque)notesParts.push('Banque: '+item.banque);
    if(item.broker)notesParts.push('Broker: '+item.broker);
    if(deal.contrat)notesParts.push('Contrat: '+deal.contrat);
    if(item.maturite)notesParts.push('Maturité: '+item.maturite);
    // Phase B.2 — same routing as the codif-sync path above.
    var pickedPack=null,steps=[],tplUsed=_pickPackTemplate(item.fourn,contract.template_name);
    if(tplUsed){
      pickedPack=templatePackForType(tplUsed,item.type);
      if(pickedPack)steps=templatePackCopy(tplUsed,pickedPack.id);
    }
    var prod={
      id:newStepId(),
      name:item.name,
      isin:item.isin,
      type:item.type,
      pack_name:pickedPack?pickedPack.name:'',
      montant:montantStr,
      notes:notesParts.join(' · '),
      steps:steps,
      deal_id:deal._id||null,
      codif_idx:item.idx,
      // Snapshot the counterparty trio + billing mode on the produit so the Suivi
      // Contrats view doesn't have to dig back into the deal's codifications jsonb.
      fourn:item.fourn,
      assureur:item.assureur,
      banque:item.banque,
      billingMode:item.billingMode
    };
    contract.produits.push(prod);
    lastAddedProd=prod;
    addedCount++;
  });
  if(addedCount===0)return; // everything was already linked — re-save protection
  await saveContract(contract);
  ctrExp[contract._id]=true;
  if(lastAddedProd)prodExp[contract._id+'|'+lastAddedProd.id]=true;
}

// ── TEAM MEMBERS (gestion équipe + rôles) ───────────────────────────────────
var team_members_db=[];
var currentUserEmail=null;
var currentUserRole='admin'; // default permissive — tightening will happen later if asked

function rowToMember(r){return{_id:r.id,email:r.email,name:r.name,role:r.role||'admin',created_at:r.created_at};}

async function loadTeamMembers(){
  var res=await sb.from('team_members').select('*').order('name');
  if(res.error)throw res.error;
  team_members_db=(res.data||[]).map(rowToMember);
}
async function ensureCurrentUserMember(){
  // After successful login, make sure the connected user has a row in team_members.
  // Default new users to 'admin' (per spec: everyone can do everything for now).
  var s=await sb.auth.getSession();
  var email=s&&s.data&&s.data.session&&s.data.session.user?s.data.session.user.email:null;
  if(!email)return;
  currentUserEmail=email;
  var existing=team_members_db.find(function(m){return m.email===email;});
  if(existing){currentUserRole=existing.role||'admin';return;}
  // Auto-create
  var defaultName=email.split('@')[0].split(/[._-]+/).map(function(p){return p.charAt(0).toUpperCase()+p.slice(1);}).join(' ');
  try{
    var res=await sb.from('team_members').insert({email:email,name:defaultName,role:'admin'}).select();
    if(res.error)throw res.error;
    if(res.data&&res.data[0]){team_members_db.push(rowToMember(res.data[0]));currentUserRole='admin';}
  }catch(e){console.warn('ensureCurrentUserMember failed (table may not exist yet)',e);}
}
async function inviteMember(email,name,role){
  email=(email||'').trim().toLowerCase();
  name=(name||'').trim();
  role=role==='viewer'?'viewer':'admin';
  if(!email||!name)throw new Error('Email et nom requis.');
  if(!email.endsWith(ALLOWED_DOMAIN))throw new Error('L\'email doit être en '+ALLOWED_DOMAIN);
  var res=await sb.from('team_members').insert({email:email,name:name,role:role}).select();
  if(res.error)throw res.error;
  if(res.data&&res.data[0])team_members_db.push(rowToMember(res.data[0]));
  return res.data&&res.data[0]?rowToMember(res.data[0]):null;
}
async function updateMemberDB(id,patch){
  var res=await sb.from('team_members').update(patch).eq('id',id).select();
  if(res.error)throw res.error;
  var m=team_members_db.find(function(x){return x._id===id;});
  if(m&&res.data&&res.data[0])Object.assign(m,rowToMember(res.data[0]));
  return m;
}
async function deleteMemberDB(id){
  var res=await sb.from('team_members').delete().eq('id',id);
  if(res.error)throw res.error;
  team_members_db=team_members_db.filter(function(m){return m._id!==id;});
}

// ── MEMBRES PAGE + MODAL ────────────────────────────────────────────────────
function renderMembres(){
  var el=document.getElementById('membresList');if(!el)return;
  var list=team_members_db.slice().sort(function(a,b){return a.name.localeCompare(b.name);});
  document.getElementById('membresEmpty').style.display=list.length?'none':'block';
  if(!list.length){el.innerHTML='';return;}
  el.innerHTML='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">'+
    list.map(function(m){
      var isMe=m.email===currentUserEmail;
      var roleCls=m.role==='admin'?'bg':'bgr';
      var roleLbl=m.role==='admin'?'Admin':'Lecture seule';
      return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--rs);padding:14px 16px;display:flex;flex-direction:column;gap:6px;'+(isMe?'border-left:3px solid var(--blue);':'')+'">'+
        '<div style="display:flex;align-items:center;gap:8px;">'+
          '<div class="av av-a" style="width:32px;height:32px;font-size:13px;">'+escH((m.name||'?').slice(0,2).toUpperCase())+'</div>'+
          '<div style="flex:1;min-width:0;">'+
            '<div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+escH(m.name)+(isMe?' <span style="font-size:10px;color:var(--blue);font-weight:500;">(vous)</span>':'')+'</div>'+
            '<div style="font-size:11px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+escH(m.email)+'</div>'+
          '</div>'+
          '<span class="badge '+roleCls+'">'+roleLbl+'</span>'+
        '</div>'+
        '<div style="display:flex;gap:6px;margin-top:4px;">'+
          '<button class="btn btn-sm" onclick="openMemberModal(\''+m._id+'\')" style="font-size:11px;">Modifier</button>'+
          (isMe?'':'<button class="btn btn-sm" style="font-size:11px;color:var(--red);border-color:var(--red-bg);" onclick="confirmDeleteMember(\''+m._id+'\')">Supprimer</button>')+
        '</div>'+
      '</div>';
    }).join('')+'</div>';
}

function openMemberModal(memberId){
  var m=memberId?team_members_db.find(function(x){return x._id===memberId;}):null;
  document.getElementById('memberModalTitle').textContent=m?'Modifier le membre':'Inviter un membre';
  document.getElementById('memId').value=m?m._id:'';
  document.getElementById('memEmail').value=m?m.email:'';
  document.getElementById('memEmail').disabled=!!m; // can't change email after invite (it's the auth identity)
  document.getElementById('memName').value=m?m.name:'';
  document.getElementById('memRole').value=m?m.role:'admin';
  document.getElementById('memberModal').classList.add('on');
  setTimeout(function(){var f=m?document.getElementById('memName'):document.getElementById('memEmail');if(f)f.focus();},50);
}
function closeMemberModal(){document.getElementById('memberModal').classList.remove('on');}

async function saveMemberFromModal(){
  var id=document.getElementById('memId').value;
  var email=document.getElementById('memEmail').value.trim().toLowerCase();
  var name=document.getElementById('memName').value.trim();
  var role=document.getElementById('memRole').value;
  if(!name){alert('Nom requis.');return;}
  try{
    if(id){
      await updateMemberDB(id,{name:name,role:role});
      toast('Membre mis à jour.');
    } else {
      if(!email){alert('Email requis.');return;}
      if(!email.endsWith(ALLOWED_DOMAIN)){alert('L\'email doit être en '+ALLOWED_DOMAIN);return;}
      if(team_members_db.some(function(m){return m.email===email;})){alert('Ce membre existe déjà.');return;}
      await inviteMember(email,name,role);
      toast('Membre invité. Ils peuvent maintenant se connecter avec '+email+' et le mot de passe d\'équipe.');
    }
    closeMemberModal();
    renderMembres();
  }catch(e){console.error(e);alert('Erreur: '+(e.message||e));}
}

async function confirmDeleteMember(id){
  var m=team_members_db.find(function(x){return x._id===id;});if(!m)return;
  if(m.email===currentUserEmail){alert('Vous ne pouvez pas vous supprimer vous-même.');return;}
  if(!confirm('Retirer '+m.name+' ('+m.email+') de l\'équipe ?\n\nNote: leur compte Supabase Auth restera actif. Pour le révoquer complètement, supprimez-le aussi dans Supabase Dashboard → Authentication → Users.'))return;
  try{
    await deleteMemberDB(id);
    renderMembres();
    toast('Membre retiré.');
  }catch(e){console.error(e);alert('Erreur: '+(e.message||e));}
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
async function checkAuth(){
  var res=await sb.auth.getSession();
  var session=res.data&&res.data.session;
  if(session){document.getElementById('loginOverlay').style.display='none';initApp();}
  else{document.getElementById('loadingOverlay').style.display='none';document.getElementById('loginOverlay').style.display='flex';}
}
var ALLOWED_DOMAIN='@chamfeuilcapital.com';
async function doLogin(){
  var email=document.getElementById('loginEmail').value.trim().toLowerCase();
  var pw=document.getElementById('loginPw').value;
  var btn=document.getElementById('loginBtn');
  var err=document.getElementById('loginErr');
  btn.disabled=true;btn.textContent='Connexion…';err.textContent='';
  if(!email.endsWith(ALLOWED_DOMAIN)){err.textContent='Email '+ALLOWED_DOMAIN+' requis.';btn.disabled=false;btn.textContent='Se connecter';return;}
  // Sign-in only — accounts must be pre-provisioned by admin (no auto-signup).
  var res=await sb.auth.signInWithPassword({email:email,password:pw});
  if(res.error){
    err.textContent='Email ou mot de passe incorrect. Contacte l\'admin si tu n\'as pas de compte.';
    btn.disabled=false;btn.textContent='Se connecter';
  } else {
    document.getElementById('loginOverlay').style.display='none';initApp();
  }
}
async function doLogout(){
  await sb.auth.signOut();
  deals=[];clients_db=[];fourn_db=[];brokers_db=[];rapprochement_db=[];
  document.getElementById('loginOverlay').style.display='flex';
}

// ── APP ─────────────────────────────────────────────────────────────────────
var deals=[],curV='Tous',sCol='date',sDir=-1,editIdx=-1,ct='UF',ftab='all',charts={};
var clients_db=[], fourn_db=[], brokers_db=[];

deals=[];

function f0(n){return new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(Math.round(n||0));}
function fE(n){return '€\u202f'+f0(n);}
function today(){return new Date().toISOString().split('T')[0];}
function nowS(){return new Date().toLocaleString('fr-FR');}
// XSS-safe escape helpers
// escH: HTML text/attribute context.
// escJS: JS string literal context.
// escAttr: combine both (for embedding a string inside a JS literal inside an HTML attribute,
// e.g. onclick="foo('"+escAttr(name)+"')").
function escH(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function escJS(s){return String(s==null?'':s).replace(/[\\'"<>&\n\r]/g,function(c){return{'\\':'\\\\',"'":"\\'",'"':'\\"','<':'\\x3c','>':'\\x3e','&':'\\x26','\n':'\\n','\r':'\\r'}[c];});}
function escAttr(s){return escH(escJS(s));}
// `filt()` keeps archived deals in scope — the commission they generated
// was real and must keep counting in stats (CA, Pilotage, Commissions).
// Archived deals are visually excluded only from:
//  • the Deals table (renderDeals filters !archived)
//  • the Suivi Contrats auto-link (saveDeal flow creates fresh deals)
// Facturation includes them and shows a "Deal supprimé" warning on the card.
// Vendor filter — "Audrey" includes "Audrey & David" co-owned deals, same for "David".
// "Tous" returns everything.
function filt(){
  if(curV==='Tous')return deals;
  return deals.filter(function(d){
    if(!d.v)return false;
    return d.v===curV||d.v.indexOf(curV)!==-1; // catches "Audrey", "Audrey & David", etc.
  });
}
function filtIncludingArchived(){return filt();} // alias kept for clarity at call sites
function toast(m){var t=document.getElementById('toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),2200);}
async function saveLocal(){
  // Sync all deals to Supabase
  for(var d of deals){
    var {_id,...data}=d;
    if(_id){await sbUpdate('deals',_id,data);}
    else{var res=await sbInsert('deals',data);if(res&&res[0]){d._id=res[0].id;}}
  }
}
async function loadLocal(){
  deals=await sbGetAll('deals');
}
function loadClients(){return clients_db.map(c=>c.name);}
function saveClients(list){/* managed via saveClientDB */}
function buildClientSelect(selected){
  var clients=loadClients().slice().sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
  // Build first client line
  renderClientLines([selected||'']);
}

function clientSelectHTML(selected){
  var clients=loadClients().slice().sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
  return '<option value="">— Choisir —</option>'+clients.map(function(c){return '<option value="'+escH(c)+'"'+(c===selected?' selected':'')+'>'+escH(c)+'</option>';}).join('');
}

var CONTRATS=['Assurance Vie Lux','Contrat Assurance Vie','Contrat de Capitalisation','CTO','PER'];

function contratSelectHTML(selected){
  return CONTRATS.map(function(c){return '<option'+(c===selected?' selected':'')+'>'+c+'</option>';}).join('');
}

function depositaireSelectHTML(selected){
  var items=fourn_db.filter(function(f){return f.famille==='Banque'||f.famille==='Assureur';}).sort(function(a,b){return a.name.localeCompare(b.name);});
  return '<option value="">— Dépositaire —</option>'+items.map(function(f){return '<option value="'+escH(f.name)+'"'+(f.name===selected?' selected':'')+'>'+escH(f.name)+'</option>';}).join('');
}

function renderClientLines(selectedArr, contratsArr, nominalsArr, depositairesArr){
  var container=document.getElementById('clientLines');
  container.innerHTML='';
  (selectedArr||['']).forEach(function(sel,idx){
    var contrat=(contratsArr&&contratsArr[idx])||'Assurance Vie Lux';
    var nominal=(nominalsArr&&nominalsArr[idx])||'';
    var depositaire=(depositairesArr&&depositairesArr[idx])||'';
    var removeBtn=idx>0?'<button type="button" class="btn btn-sm" onclick="removeClientLine(this)" style="color:var(--red);border-color:var(--red-bg);flex-shrink:0;">✕</button>':'<span style="width:30px;"></span>';
    var div=document.createElement('div');
    div.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:8px;';
    div.innerHTML=
      '<select class="mClientSel" style="flex:2;min-width:0;">'+clientSelectHTML(sel)+'</select>'+
      '<select class="mContratSel" style="flex:2;min-width:0;">'+contratSelectHTML(contrat)+'</select>'+
      '<select class="mDepositaireSel" style="flex:2;min-width:0;">'+depositaireSelectHTML(depositaire)+'</select>'+
      '<input type="number" class="mNomSel" placeholder="Nominal" value="'+nominal+'" style="flex:1;min-width:80px;max-width:130px;" oninput="calcM()"/>'+
      '<button type="button" class="btn btn-sm" onclick="showAddClientForLine(this)" style="flex-shrink:0;padding:6px 10px;font-size:14px;line-height:1;" title="Nouveau client">+</button>'+
      removeBtn;
    container.appendChild(div);
  });
}

function addClientLine(){
  var container=document.getElementById('clientLines');
  var div=document.createElement('div');
  div.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:8px;';
  div.innerHTML=
    '<select class="mClientSel" style="flex:2;min-width:0;">'+clientSelectHTML('')+'</select>'+
    '<select class="mContratSel" style="flex:2;min-width:0;">'+contratSelectHTML('Assurance Vie Lux')+'</select>'+
    '<select class="mDepositaireSel" style="flex:2;min-width:0;">'+depositaireSelectHTML('')+'</select>'+
    '<input type="number" class="mNomSel" placeholder="Nominal" style="flex:1;min-width:80px;max-width:130px;" oninput="calcM()"/>'+
    '<button type="button" class="btn btn-sm" onclick="showAddClientForLine(this)" style="flex-shrink:0;padding:6px 10px;font-size:14px;line-height:1;" title="Nouveau client">+</button>'+
    '<button type="button" class="btn btn-sm" onclick="removeClientLine(this)" style="color:var(--red);border-color:var(--red-bg);flex-shrink:0;">✕</button>';
  container.appendChild(div);
}

function removeClientLine(btn){
  var row=btn.closest('div');
  if(!row)return;
  var container=document.getElementById('clientLines');
  // Don't allow removing the last line
  if(container.children.length<=1){alert('Au moins une ligne client requise.');return;}
  row.remove();
  calcM();
}

function getSelectedClients(){
  var sels=document.querySelectorAll('.mClientSel');
  var contSels=document.querySelectorAll('.mContratSel');
  var depSels=document.querySelectorAll('.mDepositaireSel');
  var nomSels=document.querySelectorAll('.mNomSel');
  var globalNom=parseFloat(document.getElementById('mNom').value)||0;
  var result=[];
  for(var i=0;i<sels.length;i++){
    if(sels[i].value){
      var lineNom=nomSels[i]?parseFloat(nomSels[i].value)||0:0;
      result.push({
        client:sels[i].value,
        contrat:contSels[i]?contSels[i].value:'Assurance Vie Lux',
        depositaire:depSels[i]?depSels[i].value:'',
        nom:lineNom||globalNom
      });
    }
  }
  return result;
}



function showAddClientForLine(btn){
  document.getElementById('addClientRow').style.display='block';
  setTimeout(function(){document.getElementById('newClientInput').focus();},50);
}

function showAddClient(){document.getElementById('addClientRow').style.display='block';setTimeout(()=>document.getElementById('newClientInput').focus(),50);}
function cancelAddClient(){document.getElementById('addClientRow').style.display='none';document.getElementById('newClientInput').value='';}
async function confirmAddClient(){var name=document.getElementById('newClientInput').value.trim();if(!name)return;if(!clients_db.find(c=>c.name===name)){var entry={name,type:'PP',vendeur:'',email:'',notes:''};var res=await sbInsert('clients',entry);if(res&&res[0]){clients_db.push({...entry,_id:res[0].id});}}
  // Refresh all client selects (both legacy .mClientSel and new .dealClientSel)
  // and select the newly added client in the last one of each kind.
  var sels2=document.querySelectorAll('.mClientSel');
  sels2.forEach(function(sel){var cur=sel.value;sel.innerHTML=clientSelectHTML(cur);});
  if(sels2.length>0)sels2[sels2.length-1].value=name;
  var sels3=document.querySelectorAll('.dealClientSel');
  sels3.forEach(function(sel){var cur=sel.value;sel.innerHTML=clientSelectHTML(cur);});
  if(sels3.length>0)sels3[sels3.length-1].value=name;
cancelAddClient();}

function goTo(id,btn){
  ['synthese','alertes','deals','facturation','suivi-perf','graphiques','clients','fournisseurs','brokers','contrats','commissions','membres'].forEach(p=>document.getElementById('p-'+p)&&document.getElementById('p-'+p).classList.toggle('on',p===id));
  document.querySelectorAll('.nbtn').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  document.getElementById('pageTitle').textContent={synthese:'Synthèse',alertes:'Alertes & vérifications',deals:'Tous les deals',facturation:'Facturation','suivi-perf':'Suivi Perf',graphiques:'Pilotage',clients:'Clients',fournisseurs:'Fournisseurs',brokers:'Brokers',contrats:'Suivi Contrats',commissions:'Commissions',membres:'Équipe & accès'}[id]||'';
  if(id==='synthese')setTimeout(function(){renderCAChart();},200);
  else if(id==='alertes')renderAlertesPage();
  else if(id==='graphiques')setTimeout(renderCharts,80);
    else if(id==='facturation'){setTimeout(()=>{renderFact();renderUFRappr();renderUFInvTable();},50);}
  else if(id==='suivi-perf')setTimeout(renderSuiviPerf,80);
  else if(id==='deals')renderDeals();
  else if(id==='clients')renderClients();
  else if(id==='fournisseurs')renderFourn();
  else if(id==='brokers')renderBrokers();
  else if(id==='contrats')renderContrats();
  else if(id==='membres')renderMembres();
  else if(id==='commissions'){initCommPeriod();renderCommissions();}
  else renderAll();
}
function setV(v,btn){curV=v;document.querySelectorAll('.vbtn').forEach(b=>b.classList.remove('on'));btn.classList.add('on');renderAll();}
function onSearch(){var q=document.getElementById('gSearch').value;if(q)goTo('deals',document.querySelectorAll('.nbtn')[1]);document.getElementById('srch').value=q;renderDeals();}
function renderAll(){
  // Batch D.1.#6 — re-render the currently active page's content too, so vendor
  // filter switches (Audrey/David/Tous) behave as a live filter on every page,
  // not just on Synthèse. Previously only renderKpis was called → the deals
  // table, contrats list, facturation page, etc. stayed stale until navigation.
  renderKpis();renderRecent();updateAlertBadge();updateContratsBadge();
  var isOn=function(id){var el=document.getElementById(id);return el&&el.classList.contains('on');};
  if(isOn('p-deals')&&typeof renderDeals==='function')renderDeals();
  if(isOn('p-facturation')&&typeof renderFact==='function')renderFact();
  if(isOn('p-alertes')&&typeof renderAlertesPage==='function')renderAlertesPage();
  if(isOn('p-clients')&&typeof renderClients==='function')renderClients();
  if(isOn('p-fournisseurs')&&typeof renderFourn==='function')renderFourn();
  if(isOn('p-contrats')&&typeof renderContrats==='function')renderContrats();
  if(isOn('p-commissions')&&typeof renderCommissions==='function')renderCommissions();
  if(isOn('p-graphiques')&&typeof renderCharts==='function')renderCharts();
  if(isOn('p-suivi-perf')&&typeof renderSuiviPerf==='function')renderSuiviPerf();
}

// Compute the year's three commission totals + CA total. Used by Synthèse (CA only)
// and Pilotage (full breakdown).
function computeYearTotals(year){
  year=year||String(new Date().getFullYear());
  var d=filt();
  var ufPaye=d.filter(function(x){return (x.ct==='UF'||x.ct==='BOTH')&&x.fSt==='Payé'&&x.inv&&x.inv.startsWith(year);});
  var tUFPaye=ufPaye.reduce(function(s,x){return s+(x.ufE||0);},0);
  var tRunPaye=0,fournSet={};
  rapprochement_db.filter(function(r){return r.type==='run'&&r.paid&&r.declared&&r.period&&r.period.endsWith('_'+year);}).forEach(function(r){tRunPaye+=r.declared;fournSet[r.fourn]=true;});
  var tPF=0,pfDeals=d.filter(function(x){return x.fSt==='Payé'&&x.inv&&x.inv.startsWith(year)&&x.pf&&x.pf.mode!=='none';});
  pfDeals.forEach(function(x){if(x.pf.amount)tPF+=x.pf.amount;});
  return{year:year,uf:tUFPaye,ufNb:ufPaye.length,run:tRunPaye,runNbFourn:Object.keys(fournSet).length,pf:tPF,pfNb:pfDeals.length,ca:tUFPaye+tRunPaye+tPF};
}

function renderKpis(){
  var year=String(new Date().getFullYear());
  var t=computeYearTotals(year);

  // Synthèse : grand encart CA + (éventuellement) procédures Wealins en attente.
  // Les détails UF / Running / Perf fees sont déplacés dans Pilotage.
  var kpiHtml=
    '<div style="background:linear-gradient(135deg,#1a3a6b 0%,#1d5fd4 100%);border-radius:var(--rs);padding:20px 24px;color:#fff;">'+
      '<div style="font-size:11px;color:rgba(255,255,255,0.75);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">Chiffre d\'affaires '+year+'</div>'+
      '<div style="font-size:32px;font-weight:700;color:#fff;letter-spacing:-.5px;">'+fE(t.ca)+'</div>'+
      '<div style="font-size:12px;color:rgba(255,255,255,0.75);margin-top:6px;">UF + Running + Perf fees · payés</div>'+
      '<div style="display:flex;gap:18px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.18);">'+
        '<div><div style="font-size:10px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.4px;">UF</div><div style="font-size:14px;font-weight:600;color:#fff;margin-top:2px;">'+fE(t.uf)+'</div></div>'+
        '<div><div style="font-size:10px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.4px;">Running</div><div style="font-size:14px;font-weight:600;color:#fff;margin-top:2px;">'+fE(t.run)+'</div></div>'+
        '<div><div style="font-size:10px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.4px;">Perf fees</div><div style="font-size:14px;font-weight:600;color:#fff;margin-top:2px;">'+fE(t.pf)+'</div></div>'+
        '<div style="flex:1;"></div>'+
        '<div style="font-size:11px;color:rgba(255,255,255,0.7);align-self:center;">Détails complets dans <button onclick="goTo(\'graphiques\',document.querySelector(\'.nbtn[onclick*=graphiques]\'))" style="background:rgba(255,255,255,.15);color:#fff;border:none;padding:4px 10px;border-radius:4px;font-size:11px;cursor:pointer;font-family:inherit;">Pilotage →</button></div>'+
      '</div>'+
    '</div>';

  // Procédures Wealins en attente (à droite du CA si >0)
  var nPending=pendingProcedures();
  var nbCols=1;
  if(nPending>0){
    nbCols=2;
    kpiHtml+=
      '<div onclick="goTo(\'contrats\',document.querySelector(\'.nbtn[onclick*=contrats]\'))" style="background:var(--amber-bg);border:1px solid rgba(176,122,16,.3);border-radius:var(--rs);padding:20px 24px;cursor:pointer;display:flex;flex-direction:column;justify-content:center;">'+
        '<div style="font-size:11px;color:var(--amber);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">Procédures Wealins en attente</div>'+
        '<div style="font-size:32px;font-weight:700;color:var(--amber-t);letter-spacing:-.5px;">'+nPending+'</div>'+
        '<div style="font-size:12px;color:var(--amber);margin-top:6px;">checklists incomplètes — cliquez pour voir</div>'+
      '</div>';
  }

  document.getElementById('kpiGrid').style.gridTemplateColumns='repeat('+nbCols+',minmax(0,1fr))';
  document.getElementById('kpiGrid').innerHTML=kpiHtml;
}
function kH(l,c,v,s){return '<div class="kpi'+(c?' '+c:'')+'"><div class="kpi-l">'+l+'</div><div class="kpi-v">'+v+'</div><div class="kpi-s">'+s+'</div></div>';}

function renderRecent(){
  renderSynthPaye();
  renderSynthPipe();
  renderSynthRealise();
  // Délai pour s'assurer que le canvas est dans le DOM visible
  setTimeout(function(){renderCAChart();},200);
}

function renderCAChart(){
  var mois=['Jan','\xc9\xe9v','Mar','Avr','Mai','Jun','Jul','Ao\xfb','Sep','Oct','Nov','D\xe9c'];
  var now=new Date();
  var year=String(now.getFullYear());
  var el=document.getElementById('caChartYear');
  if(el)el.textContent=year;
  var canvas=document.getElementById('cCA');
  if(!canvas)return;

  // Build cumul using same logic as renderKpis but month by month
  var labels=[], cumul=[], total=0;
  var yr=year;

  for(var m=0;m<=11;m++){
    var pad=m+1<10?'0':''
    var mStr=yr+'-'+pad+String(m+1);
    var tUF=0, tRun=0, seen={};

    // Phase D.3 — iterate codif-level entries so a deal with mixed UF+Run
    // fournisseurs contributes correctly to each side of the monthly cumul.
    var monthEntries=billingEntries(deals);
    for(var di=0;di<monthEntries.length;di++){
      var e=monthEntries[di];
      if(e.fSt!=='Pay\xe9') continue;
      var inv=e.inv||'';
      if(inv.substring(0,7)!==mStr) continue;
      if(e.ct==='UF'||e.ct==='BOTH') tUF+=(e.ufE||0);
      if(e.ct==='RUN'||e.ct==='BOTH'){
        if(!e.invS) continue;
        var t=Math.ceil(parseInt(e.invS.substring(5,7))/3);
        var rKey='T'+t+'_'+yr+'__'+e.fourn; // dedup per (period, fourn) — different fournisseurs add independently
        if(seen[rKey]) continue; seen[rKey]=1;
        var rv=rapprFind(e.fourn,'run',rKey.split('__')[0]);
        if(rv&&rv.paid&&rv.declared) tRun+=rv.declared;
        else tRun+=(e.runE||0)/4;
      }
    }

    total+=tUF+tRun;
    labels.push(mois[m]);
    cumul.push(Math.round(total));
    if(m>=now.getMonth()) break;
  }

  if(charts.ca){charts.ca.destroy();charts.ca=null;}
  var ctx=canvas.getContext('2d');
  var grad=ctx.createLinearGradient(0,0,0,220);
  grad.addColorStop(0,'rgba(29,95,212,0.3)');
  grad.addColorStop(1,'rgba(29,95,212,0.01)');

  charts.ca=new Chart(ctx,{
    type:'line',
    data:{labels:labels,datasets:[{
      data:cumul,
      borderColor:'#1d5fd4',
      backgroundColor:grad,
      borderWidth:3,
      pointRadius:5,
      pointBackgroundColor:'#1d5fd4',
      pointBorderColor:'#fff',
      pointBorderWidth:2,
      fill:true,
      tension:0.3
    }]},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return fE(c.raw)+' \u20ac';}}}},
      scales:{
        x:{grid:{display:false},ticks:{color:'#888',font:{size:11}}},
        y:{beginAtZero:true,grid:{color:'rgba(0,0,0,0.06)'},ticks:{color:'#888',font:{size:11},callback:function(v){
          if(v>=1000000) return (v/1000000).toFixed(1)+'M';
          if(v>=1000) return Math.round(v/1000)+'K';
          return v;
        }}}
      }
    }
  });
}




function renderSynthPaye(){
  var d=filt();
  var paye=d.filter(x=>x.stat==='Deal payé');
  var nbUF=paye.filter(x=>x.ct==='UF'||x.ct==='BOTH').length;
  var nbRun=paye.filter(x=>x.ct==='RUN'||x.ct==='BOTH').length;
  var totalUF=paye.reduce((s,x)=>s+(x.ufE||0),0);
  var totalNom=paye.reduce((s,x)=>s+(x.dev==='USD'?x.nom/(x.fx||1):x.nom),0);
  var html=
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:4px;">'+
      '<div style="background:var(--surface2);border-radius:var(--rs);padding:12px 14px;">'+
        '<div style="font-size:11px;color:var(--text3);margin-bottom:4px;">Nb deals</div>'+
        '<div style="font-size:28px;font-weight:600;color:var(--text);">'+paye.length+'</div>'+
        '<div style="font-size:11px;color:var(--text2);">'+nbUF+' UF · '+nbRun+' Running</div>'+
      '</div>'+
      '<div style="background:var(--surface2);border-radius:var(--rs);padding:12px 14px;">'+
        '<div style="font-size:11px;color:var(--text3);margin-bottom:4px;">Nominaux</div>'+
        '<div style="font-size:22px;font-weight:600;color:var(--blue);">'+fE(totalNom)+'</div>'+
        '<div style="font-size:11px;color:var(--text2);">Encours total</div>'+
      '</div>'+
    '</div>';
  document.getElementById('synthPaye').innerHTML=html;
}

function renderSynthPipe(){
  var d=filt();
  var pipe=d.filter(x=>x.stat==='Deal pipe');
  var recent=pipe.slice().sort(function(a,b){return (b.date||'').localeCompare(a.date||'');}).slice(0,5);
  var totalNom=pipe.reduce((s,x)=>s+(x.dev==='USD'?x.nom/(x.fx||1):x.nom),0);
  var totalUF=pipe.filter(x=>x.ct==='UF'||x.ct==='BOTH').reduce((s,x)=>s+(x.ufE||0),0);
  var totalRun=pipe.filter(x=>x.ct==='RUN'||x.ct==='BOTH').reduce((s,x)=>s+(x.runE||0),0);
  var html=
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">'+
      '<div style="background:var(--surface2);border-radius:var(--rs);padding:12px 14px;">'+
        '<div style="font-size:11px;color:var(--text3);margin-bottom:4px;">Deals en pipe</div>'+
        '<div style="font-size:28px;font-weight:600;color:var(--text);">'+pipe.length+'</div>'+
        '<div style="font-size:11px;color:var(--text2);">'+pipe.filter(x=>x.fSt==='À émettre').length+' à émettre · '+pipe.filter(x=>x.fSt==='Facturé').length+' facturés</div>'+
      '</div>'+
      '<div style="background:var(--surface2);border-radius:var(--rs);padding:12px 14px;">'+
        '<div style="font-size:11px;color:var(--text3);margin-bottom:4px;">Nominaux en pipe</div>'+
        '<div style="font-size:22px;font-weight:600;color:var(--green);">'+fE(totalNom)+'</div>'+
        '<div style="font-size:11px;color:var(--text2);">UF: '+fE(totalUF)+' · Run/an: '+fE(totalRun)+'</div>'+
      '</div>'+
    '</div>';
  if(recent.length){
    html+='<div style="border-top:1px solid var(--border);padding-top:10px;">';
    html+=recent.map(d=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer;" onclick="openDet(deals['+deals.indexOf(d)+'])">'+
      '<div>'+
        '<span style="font-size:13px;font-weight:500;color:var(--text);">'+d.client+'</span>'+
        '<span style="font-size:11px;color:var(--text2);margin-left:6px;">'+d.fourn+'</span>'+
      '</div>'+
      '<div style="display:flex;gap:8px;align-items:center;">'+
        fBadge(d.fSt)+
        '<span style="font-size:12px;color:var(--green);font-weight:500;">'+(d.ufE>0?fE(d.ufE):'')+(d.runE>0?' '+fE(d.runE)+'/an':'')+'</span>'+
      '</div>'+
    '</div>').join('');
    html+='</div>';
  } else { html+='<div class="empty">Aucun deal en pipe.</div>'; }
  document.getElementById('synthPipe').innerHTML=html;
}
function renderSynthRealise(){
  var d=filt();
  var realise=d.filter(x=>x.stat==='Deal réalisé');
  var recent=realise.slice().sort(function(a,b){return (b.date||'').localeCompare(a.date||'');}).slice(0,5);
  var nbUF=realise.filter(x=>x.ct==='UF'||x.ct==='BOTH').length;
  var nbRun=realise.filter(x=>x.ct==='RUN'||x.ct==='BOTH').length;
  var totalNom=realise.reduce((s,x)=>s+(x.dev==='USD'?x.nom/(x.fx||1):x.nom),0);
  var totalUF=realise.filter(x=>x.ct==='UF'||x.ct==='BOTH').reduce((s,x)=>s+(x.ufE||0),0);
  var totalRun=realise.filter(x=>x.ct==='RUN'||x.ct==='BOTH').reduce((s,x)=>s+(x.runE||0),0);
  var html=
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">'+
      '<div style="background:var(--surface2);border-radius:var(--rs);padding:12px 14px;">'+
        '<div style="font-size:11px;color:var(--text3);margin-bottom:4px;">Deals réalisés</div>'+
        '<div style="font-size:28px;font-weight:600;color:var(--text);">'+realise.length+'</div>'+
        '<div style="font-size:11px;color:var(--text2);">'+nbUF+' UF · '+nbRun+' Running</div>'+
      '</div>'+
      '<div style="background:var(--surface2);border-radius:var(--rs);padding:12px 14px;">'+
        '<div style="font-size:11px;color:var(--text3);margin-bottom:4px;">Nominaux réalisés</div>'+
        '<div style="font-size:22px;font-weight:600;color:var(--purple,#7c3aed);">'+fE(totalNom)+'</div>'+
        '<div style="font-size:11px;color:var(--text2);">UF: '+fE(totalUF)+' · Run/an: '+fE(totalRun)+'</div>'+
      '</div>'+
    '</div>';
  if(recent.length){
    html+='<div style="border-top:1px solid var(--border);padding-top:10px;">';
    html+=recent.map(d=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer;" onclick="openDet(deals['+deals.indexOf(d)+'])">'+
      '<div>'+
        '<span style="font-size:13px;font-weight:500;color:var(--text);">'+d.client+'</span>'+
        '<span style="font-size:11px;color:var(--text2);margin-left:6px;">'+d.fourn+'</span>'+
      '</div>'+
      '<div style="display:flex;gap:8px;align-items:center;">'+
        fBadge(d.fSt)+
        '<span style="font-size:12px;color:var(--purple,#7c3aed);font-weight:500;">'+(d.ufE>0?fE(d.ufE):'')+(d.runE>0?' '+fE(d.runE)+'/an':'')+'</span>'+
      '</div>'+
    '</div>').join('');
    html+='</div>';
  } else { html+='<div class="empty">Aucun deal réalisé.</div>'; }
  document.getElementById('synthRealise').innerHTML=html;
}

function renderSynthFactPaye(){
  var d=filt();
  var year=String(new Date().getFullYear());
  // UF payés tous
  var ufAll=d.filter(x=>(x.ct==='UF'||x.ct==='BOTH')&&x.fSt==='Payé');
  var ufYTD=ufAll.filter(x=>x.inv&&x.inv.startsWith(year));
  // Running: source = rapprochement_db (Supabase). Toutes les running paid.
  var runAll=rapprochement_db.filter(function(r){return r.type==='run'&&r.paid&&r.declared;});
  var runYTD=runAll.filter(function(r){return r.period&&r.period.endsWith('_'+year);});
  var totalUFAll=ufAll.reduce((s,x)=>s+(x.ufE||0),0);
  var totalUFYTD=ufYTD.reduce((s,x)=>s+(x.ufE||0),0);
  var totalRunAll=runAll.reduce(function(s,r){return s+(r.declared||0);},0);
  var totalRunYTD=runYTD.reduce(function(s,r){return s+(r.declared||0);},0);
  var html='<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:16px;">'+
    '<div style="background:var(--blue-bg,#e8f0fb);border-radius:var(--rs);padding:12px;">'+
      '<div style="font-size:10px;color:var(--text3);">UF payés — '+year+'</div>'+
      '<div style="font-size:20px;font-weight:700;color:var(--blue);">'+fE(totalUFYTD)+'</div>'+
      '<div style="font-size:11px;color:var(--text2);">'+ufYTD.length+' facture'+(ufYTD.length!==1?'s':'')+'</div>'+
    '</div>'+
    '<div style="background:var(--green-bg,#e8f5ec);border-radius:var(--rs);padding:12px;">'+
      '<div style="font-size:10px;color:var(--text3);">Running payés — '+year+'</div>'+
      '<div style="font-size:20px;font-weight:700;color:var(--green);">'+fE(totalRunYTD)+'</div>'+
      '<div style="font-size:11px;color:var(--text2);">'+runYTD.length+' facture'+(runYTD.length!==1?'s':'')+'</div>'+
    '</div>'+
  '</div>';
  document.getElementById('synthFactPaye').innerHTML=html;
}

function avC(v){return v==='Audrey'?'a':v==='David'?'d':'p';}
function avL(v){return v[0];}
function tBadge(c){return c==='BOTH'?'<span class="badge bb">UF</span> <span class="badge bg">Run</span>':c==='UF'?'<span class="badge bb">UF</span>':'<span class="badge bg">Run</span>';}
function fBadge(s){var m={Payé:'bg',Facturé:'bb','À émettre':'ba',Litige:'br'};return '<span class="badge '+(m[s]||'bgr')+'">'+s+'</span>';}
function sRow(d){return '<td class="mono">'+d.date+'</td><td><span class="av av-'+avC(d.v)+'">'+avL(d.v)+'</span></td><td style="font-weight:500;">'+d.client+'</td><td>'+d.fourn+'</td><td style="color:var(--text2);">'+d.produit+'</td><td style="text-align:right;" class="mono">'+f0(d.nom)+' '+d.dev+'</td><td>'+tBadge(d.ct)+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+(d.ufE>0?fE(d.ufE):'—')+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+(d.runE>0?fE(d.runE):'—')+'</td><td>'+fBadge(d.fSt)+'</td>';}

var selectedDealIds=new Set();
var _dealsFiltered=[];
function dealKey(d){return d._id||('idx_'+deals.indexOf(d));}

function _isoDate(d){return d.toISOString().slice(0,10);}
function dateRangeFromPreset(preset){
  var now=new Date();now.setHours(0,0,0,0);
  var from=null,to=null;
  if(preset==='7d'){from=new Date(now);from.setDate(from.getDate()-7);to=now;}
  else if(preset==='30d'){from=new Date(now);from.setDate(from.getDate()-30);to=now;}
  else if(preset==='thisMonth'){from=new Date(now.getFullYear(),now.getMonth(),1);to=new Date(now.getFullYear(),now.getMonth()+1,0);}
  else if(preset==='lastMonth'){from=new Date(now.getFullYear(),now.getMonth()-1,1);to=new Date(now.getFullYear(),now.getMonth(),0);}
  else if(preset==='thisQuarter'){var qStart=Math.floor(now.getMonth()/3)*3;from=new Date(now.getFullYear(),qStart,1);to=new Date(now.getFullYear(),qStart+3,0);}
  else if(preset==='lastQuarter'){var qStart2=Math.floor(now.getMonth()/3)*3-3;from=new Date(now.getFullYear(),qStart2,1);to=new Date(now.getFullYear(),qStart2+3,0);}
  else if(preset==='thisYear'){from=new Date(now.getFullYear(),0,1);to=new Date(now.getFullYear(),11,31);}
  else if(preset==='lastYear'){from=new Date(now.getFullYear()-1,0,1);to=new Date(now.getFullYear()-1,11,31);}
  return from&&to?{from:_isoDate(from),to:_isoDate(to)}:null;
}
function onDatePresetChange(){
  var preset=document.getElementById('flDatePreset').value;
  var fromEl=document.getElementById('flDateFrom'),toEl=document.getElementById('flDateTo');
  if(!preset){fromEl.value='';toEl.value='';renderDeals();return;}
  if(preset==='custom'){fromEl.focus();return;}
  var range=dateRangeFromPreset(preset);
  if(range){fromEl.value=range.from;toEl.value=range.to;}
  renderDeals();
}
function resetDealFilters(){
  ['srch','flT','flF','flDev','flFourn','flDatePreset','flDateFrom','flDateTo'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  renderDeals();
}

function renderDeals(){
  var q=(document.getElementById('srch').value||'').toLowerCase(),ft=document.getElementById('flT').value,ff=document.getElementById('flF').value,fd=document.getElementById('flDev').value,ff2=document.getElementById('flFourn').value;
  var dFrom=(document.getElementById('flDateFrom')||{}).value||'';
  var dTo=(document.getElementById('flDateTo')||{}).value||'';
  var data=filt().filter(d=>{
    if(d.archived)return false; // archived (soft-deleted) — only shown on Facturation
    if(ft&&d.ct!==ft)return false;
    if(ff&&d.fSt!==ff)return false;
    if(fd&&d.dev!==fd)return false;
    if(ff2&&d.fourn!==ff2)return false;
    if(dFrom&&(!d.date||d.date<dFrom))return false;
    if(dTo&&(!d.date||d.date>dTo))return false;
    if(q&&!(d.client.toLowerCase().includes(q)||d.fourn.toLowerCase().includes(q)||(d.produit||'').toLowerCase().includes(q)||(d.isin||'').toLowerCase().includes(q)))return false;
    return true;
  });
  data.sort((a,b)=>{var av=a[sCol]||0,bv=b[sCol]||0;return typeof av==='string'?av.localeCompare(bv)*sDir:(av-bv)*sDir;});
  _dealsFiltered=data;
  var t=document.getElementById('dealsT');while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('dealsEmpty').style.display=data.length?'none':'block';
  data.forEach(d=>{
    var r=t.insertRow();r.className='cl';r.onclick=function(ev){if(ev.target.tagName==='INPUT'||ev.target.tagName==='BUTTON')return;openDet(d);};
    var av='<span class="av av-'+avC(d.v)+'">'+avL(d.v)+'</span>';
    var k=dealKey(d);
    var checked=selectedDealIds.has(k)?' checked':'';
    r.innerHTML='<td style="text-align:center;"><input type="checkbox" class="rowSel" data-key="'+escH(k)+'"'+checked+' onclick="event.stopPropagation();onDealRowSel(this)"/></td><td class="mono">'+escH(d.date)+'</td><td>'+av+'</td><td style="font-weight:500;white-space:nowrap;">'+escH(d.client)+'</td><td style="color:var(--text2);font-size:11px;">'+escH(d.contrat)+'</td><td>'+escH(d.produit)+'</td><td style="color:var(--text2);font-size:11px;">'+(d.produit_type?escH(d.produit_type):'—')+'</td><td>'+escH(d.fourn)+'</td><td style="color:var(--text2);">'+(d.broker?escH(d.broker):'—')+'</td><td style="text-align:right;" class="mono">'+f0(d.nom)+'</td><td>'+escH(d.dev)+'</td><td class="mono" style="font-size:10px;color:var(--text2);">'+(d.isin?escH(d.isin):'—')+'</td><td class="mono" style="font-size:11px;color:var(--text2);">'+(d.issue?escH(d.issue):'—')+'</td><td class="mono" style="font-size:11px;color:var(--text2);">'+(d.invS?escH(d.invS):'—')+'</td><td class="mono" style="font-size:11px;color:var(--text2);">'+(d.inv?escH(d.inv):'—')+'</td><td class="mono" style="font-size:11px;color:var(--text2);">'+(d.terme?escH(d.terme):'—')+'</td><td>'+tBadge(d.ct)+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+(d.ufE>0?fE(d.ufE):'—')+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+(d.runE>0?fE(d.runE):'—')+'</td><td class="mono" style="font-size:11px;">'+(d.fRef?escH(d.fRef):'—')+'</td><td>'+fBadge(d.fSt)+'</td><td style="font-size:11px;color:var(--text2);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(d.notes?escH(d.notes):'—')+'</td><td><div style="display:flex;gap:5px;justify-content:flex-end;align-items:center;"><button class="btn btn-sm" onclick="event.stopPropagation();openDealModal('+deals.indexOf(d)+')">Modifier</button><button class="btn btn-sm" style="color:var(--red);border-color:var(--red-bg);" onclick="event.stopPropagation();deleteDeal('+deals.indexOf(d)+')">Supprimer</button></div></td>';
  });
  var fourns=[...new Set(filt().map(function(d){return d.fourn;}))].sort(),sel=document.getElementById('flFourn'),cv=sel.value;sel.innerHTML='<option value="">Tous fournisseurs</option>';fourns.forEach(function(f){if(f)sel.innerHTML+='<option value="'+escH(f)+'"'+(f===cv?' selected':'')+'>'+escH(f)+'</option>';});
  // E (Oscar 2026-05-18) — total count + nominal sum in the filter bar.
  var countEl=document.getElementById('dealsCount');
  if(countEl){
    var totalUniverse=deals.filter(function(x){return !x.archived;}).length;
    var sumNomEur=data.reduce(function(s,x){return s+(_dealNomEur(x)||0);},0);
    countEl.textContent='— '+data.length+' / '+totalUniverse+' deals · total '+fE(Math.round(sumNomEur));
  }
  // Constrain date inputs to the actual range of deal dates (real bounds, not hardcoded)
  var allDates=deals.map(function(x){return x.date;}).filter(Boolean).sort();
  if(allDates.length){
    var minD=allDates[0],maxD=allDates[allDates.length-1];
    var fromEl=document.getElementById('flDateFrom'),toEl=document.getElementById('flDateTo');
    if(fromEl){fromEl.min=minD;fromEl.max=maxD;}
    if(toEl){toEl.min=minD;toEl.max=maxD;}
  }
  refreshBulkBar();
}

function onDealRowSel(cb){
  var k=cb.dataset.key;
  if(cb.checked)selectedDealIds.add(k);else selectedDealIds.delete(k);
  refreshBulkBar();
  syncSelectAllCheckbox();
}
function toggleSelectAllDeals(cb){
  if(cb.checked){_dealsFiltered.forEach(function(d){selectedDealIds.add(dealKey(d));});}
  else{_dealsFiltered.forEach(function(d){selectedDealIds.delete(dealKey(d));});}
  document.querySelectorAll('#dealsT .rowSel').forEach(function(el){el.checked=cb.checked;});
  refreshBulkBar();
}
function syncSelectAllCheckbox(){
  var sa=document.getElementById('bulkSelectAll');if(!sa)return;
  var allChecked=_dealsFiltered.length>0&&_dealsFiltered.every(function(d){return selectedDealIds.has(dealKey(d));});
  sa.checked=allChecked;
  sa.indeterminate=!allChecked&&_dealsFiltered.some(function(d){return selectedDealIds.has(dealKey(d));});
}
function refreshBulkBar(){
  // Count only deals currently visible (filtered) for bar
  var visibleSelected=_dealsFiltered.filter(function(d){return selectedDealIds.has(dealKey(d));});
  var bar=document.getElementById('dealsBulkBar');
  if(!bar)return;
  if(visibleSelected.length>0){bar.style.display='flex';document.getElementById('bulkSelCount').textContent=visibleSelected.length;}
  else bar.style.display='none';
  syncSelectAllCheckbox();
}
function bulkClear(){selectedDealIds.clear();renderDeals();}
function getSelectedDealsList(){return deals.filter(function(d){return selectedDealIds.has(dealKey(d));});}
async function bulkApplyStatus(){
  var newStatus=document.getElementById('bulkStatus').value;
  if(!newStatus){alert('Choisissez un statut.');return;}
  var sel=getSelectedDealsList();
  if(!sel.length){alert('Aucun deal sélectionné.');return;}
  if(!confirm('Appliquer le statut "'+newStatus+'" à '+sel.length+' deal(s) ?'))return;
  var failed=0;
  for(var i=0;i<sel.length;i++){
    var d=sel[i];
    d.fSt=newStatus;
    if(!d.hist)d.hist=[];
    d.hist.push({ts:nowS(),a:'Statut → '+newStatus+' (action groupée)',by:'Système'});
    if(d._id){try{await sbUpdate('deals',d._id,d);}catch(e){console.error('Bulk status update failed for',d._id,e);failed++;}}
  }
  selectedDealIds.clear();
  renderAll();
  toast(sel.length+' deal(s) mis à jour'+(failed?' ('+failed+' erreur(s))':'.'));
}
async function bulkDelete(){
  var sel=getSelectedDealsList();
  if(!sel.length){alert('Aucun deal sélectionné.');return;}
  // Pre-count linked investissements + contracts that will become empty.
  // The cascade is mandatory (Oscar 2026-05-18) — surface the scope upfront so
  // the user knows exactly what's about to be purged.
  var totalProdsLinked=0;
  var contractsToBeEmptied=new Set();
  var contractsTouched=new Set();
  sel.forEach(function(d){
    var links=findAllLinkedInvestissements(d);
    totalProdsLinked+=links.length;
    var byContract={};
    links.forEach(function(l){
      var cid=l.contract._id||l.contract.client;
      byContract[cid]=byContract[cid]||{contract:l.contract,count:0};
      byContract[cid].count++;
      contractsTouched.add(cid);
    });
    // A contract is emptied when its TOTAL produits == sum of removed produits
    // across this batch. Approximate (we don't know other batches), but accurate
    // for the common case of one bulk pass.
  });
  // Re-pass: tally per-contract removal totals across all selected deals.
  var perContractRemoval={};
  sel.forEach(function(d){
    findAllLinkedInvestissements(d).forEach(function(l){
      var cid=l.contract._id||l.contract.client;
      perContractRemoval[cid]=perContractRemoval[cid]||{contract:l.contract,n:0};
      perContractRemoval[cid].n++;
    });
  });
  Object.keys(perContractRemoval).forEach(function(cid){
    var r=perContractRemoval[cid];
    if(r.n>=(r.contract.produits||[]).length)contractsToBeEmptied.add(cid);
  });
  var msg='Supprimer définitivement '+sel.length+' deal(s) ?'+
          (totalProdsLinked?'\n\n⚠ Cascade obligatoire — '+totalProdsLinked+' investissement(s) seront purgés des suivis de contrats':'')+
          (contractsToBeEmptied.size?'\n⚠ '+contractsToBeEmptied.size+' contrat(s) deviendront vides et seront supprimés':'')+
          '\n\nIrréversible.';
  if(!confirm(msg))return;
  var failed=0;
  var combinedCascade={produitsRemoved:0, contractsDeleted:0, contractsKept:0};
  for(var i=0;i<sel.length;i++){
    var d=sel[i];
    try{
      var cascade=await cascadeDeleteDealLinks(d);
      combinedCascade.produitsRemoved+=cascade.produitsRemoved;
      combinedCascade.contractsDeleted+=cascade.contractsDeleted;
      combinedCascade.contractsKept+=cascade.contractsKept;
    }catch(e){console.error('Bulk cascade failed for',d._id,e);}
    if(d._id){try{await sbDelete('deals',d._id);}catch(e){console.error('Bulk delete failed for',d._id,e);failed++;continue;}}
    var idx=deals.indexOf(d);if(idx>=0)deals.splice(idx,1);
  }
  selectedDealIds.clear();
  renderAll();
  toast(sel.length+' deal(s) supprimé(s)'+_cascadeSummaryToast(combinedCascade)+(failed?' ('+failed+' erreur(s))':'.'));
}
function bulkExportCSV(){
  var sel=getSelectedDealsList();
  if(!sel.length){alert('Aucun deal sélectionné.');return;}
  var h=['Vendeur','Date','Client','Contrat','Fournisseur','Broker','Produit','TypeProduit','ISIN','Nominal','Devise','FX','Issue','Terme','Type','UF%','Run%','UF EUR','Run EUR','Statut','Ref','Invoice','Notes'];
  var rows=sel.map(function(d){return[d.v,d.date,d.client,d.contrat,d.fourn,d.broker,d.produit,d.produit_type||'',d.isin,d.nom,d.dev,d.fx,d.issue,d.terme||'',d.ct,d.ufR,d.runR,d.ufE,d.runE,d.fSt,d.fRef,d.inv,d.notes].map(function(v){return (v||'').toString().replace(/,/g,';');});});
  var csv=[h.join(','),...rows.map(function(r){return r.join(',');})].join('\n');
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'}));a.download='deals_selection_'+today()+'.csv';a.click();
  toast(sel.length+' deal(s) exporté(s).');
}
function sBy(c){if(sCol===c)sDir*=-1;else{sCol=c;sDir=-1;}renderDeals();}

var arbSrcDeal=null;

function openDet(d){
  var idx=deals.indexOf(d);
  document.getElementById('detTitle').textContent=(d.archived?'⚠ ':'')+d.client+' — '+d.fourn;

  // Build arbitrage chain block
  var arbBlock='';
  // Provenance: this deal came from an arbitrage
  if(d.arbSrc){
    var src=deals.find(function(x){return x._id===d.arbSrc;});
    var srcLabel=src?(src.fourn+' / '+(src.produit||'')):'Source supprimée';
    arbBlock+='<div style="background:var(--purple-bg);border:1px solid rgba(107,79,196,.25);border-radius:var(--rs);padding:10px 12px;margin-top:12px;font-size:12px;color:var(--purple-t);">'+
      '← <b>Issu d\'un arbitrage '+escH(d.arbId||'')+'</b> · Source : '+escH(srcLabel)+(src?' <button class="btn btn-sm" onclick="closeDet();openDet(deals['+deals.indexOf(src)+'])" style="font-size:10px;padding:2px 8px;margin-left:6px;">Voir source</button>':'')+
    '</div>';
  }
  // Destinations: this deal has been arbed to others
  var destDeals=d._id?deals.filter(function(x){return x.arbSrc===d._id;}):[];
  if(destDeals.length>0){
    arbBlock+='<div style="background:var(--purple-bg);border:1px solid rgba(107,79,196,.25);border-radius:var(--rs);padding:10px 12px;margin-top:8px;font-size:12px;color:var(--purple-t);">'+
      '<div style="font-weight:600;margin-bottom:6px;">→ Arbitrages sortants ('+destDeals.length+')</div>'+
      destDeals.map(function(dd){
        return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0;border-top:1px dashed rgba(107,79,196,.2);">'+
          '<span style="flex:1;">'+escH(dd.fourn)+' / '+escH(dd.produit||'')+' · '+fE(dd.nom)+(dd.runR>0?' · Run '+dd.runR+'%':'')+(dd.ufR>0?' · UF '+dd.ufR+'%':'')+' · '+escH(dd.date)+'</span>'+
          '<button class="btn btn-sm" onclick="closeDet();openDet(deals['+deals.indexOf(dd)+'])" style="font-size:10px;padding:2px 8px;">Ouvrir</button>'+
        '</div>';
      }).join('')+
    '</div>';
  }
  // Pro-rata to bill: detect last arb history entry on source side
  if(destDeals.length>0||d.arbClosed){
    var lastArbHist=(d.hist||[]).slice().reverse().find(function(h){return h.a&&h.a.indexOf('Pro-rata Running')!==-1;});
    if(lastArbHist){
      arbBlock+='<div style="background:var(--amber-bg);border:1px solid rgba(176,122,16,.3);border-radius:var(--rs);padding:8px 12px;margin-top:6px;font-size:12px;color:var(--amber-t);">⚠ <b>Pro-rata à facturer</b> mentionné dans l\'historique : "'+escH(lastArbHist.a)+'"</div>';
    }
  }

  // Phase 4 — richer details: codifications expanded + FX snapshot + group indicator
  var codifsBlock='';
  if(Array.isArray(d.codifications)&&d.codifications.length){
    codifsBlock='<div class="form-sep" style="margin-top:14px;">Fournisseurs du contrat</div>';
    codifsBlock+='<div style="display:flex;flex-direction:column;gap:6px;">'+
      d.codifications.map(function(c){
        // Phase G — display feeSnapshot using the canonical label even when the
        // stored kind is a legacy string (Gestion/Entrée). The cycle mapping is
        // the source of truth, not the label string. F.3 re-sync migrates the
        // stored data; this guard ensures the UI is consistent in the meantime.
        var feeStr=(c.feeSnapshot&&c.feeSnapshot.length)?c.feeSnapshot.map(function(f){
          var cycles=(typeof feeKindCycles==='function')?feeKindCycles(f.kind):{uf:false,run:false};
          var canon=(cycles.uf&&cycles.run)?'UF+Run':(cycles.run?'Run':(cycles.uf?'UF':(f.kind||'?')));
          var pctTxt=(f.pct||0)+'%';
          if(f.kind==='UF+Run' && f.runPct!=null && f.runPct!=='') pctTxt='UF '+f.pct+'% / Run '+f.runPct+'%';
          return escH(canon)+' '+escH(pctTxt);
        }).join(' · '):'—';
        var pfStr=(c.pf&&c.pf.mode&&c.pf.mode!=='none')?(c.pf.mode==='pct'?(c.pf.rate||0)+'% sur perf'+(c.pf.hurdle?' (hurdle '+c.pf.hurdle+'%)':''):fE(c.pf.amount||0)+' fixe')+' · '+(c.pf.freq||'annuel'):null;
        var amtStr=c.nominal?fE(c.nominal):'—';
        // Batch A.3 — billing mode badge
        var bm=c.billingMode||'fast';
        var bmBadge='<span style="font-size:10px;padding:1px 6px;border-radius:3px;font-weight:600;'+
          (bm==='feed'?'background:rgba(176,122,16,.15);color:#b07a10;':'background:rgba(29,95,212,.12);color:#1d5fd4;')+
          '">'+(bm==='feed'?'FEED':'FAST')+'</span>';
        return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:8px 10px;font-size:12px;">'+
          '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:baseline;margin-bottom:4px;">'+
            '<span style="font-weight:600;">'+escH(c.fourn||'—')+'</span>'+
            (c.produit?'<span style="color:var(--text2);">'+escH(c.produit)+'</span>':'')+
            (c.isin?'<span style="font-family:monospace;font-size:10px;color:var(--text3);">'+escH(c.isin)+'</span>':'')+
            bmBadge+
            '<div style="flex:1;"></div>'+
            '<span style="font-weight:600;">'+amtStr+'</span>'+
          '</div>'+
          '<div style="font-size:11px;color:var(--text2);display:flex;gap:14px;flex-wrap:wrap;">'+
            (c.assureur?'<span>Assureur : <b>'+escH(c.assureur)+'</b></span>':'')+
            (c.banque?'<span>Banque : <b>'+escH(c.banque)+'</b></span>':'')+
            (c.broker?'<span>Broker : '+escH(c.broker)+'</span>':'')+
            (c.maturite?'<span>Maturité : '+escH(c.maturite)+'</span>':'')+
          '</div>'+
          '<div style="font-size:11px;color:var(--text3);margin-top:3px;">Frais : '+feeStr+(pfStr?' · Perf : '+pfStr:'')+'</div>'+
        '</div>';
      }).join('')+
    '</div>';
  }
  // FX snapshot block (only when contract is non-EUR) — Phase I.2 uses centralised
  // helpers so the "1 USD = 0.92 EUR" sens humain is consistent everywhere.
  var fxBlock='';
  if(d.dev&&d.dev!=='EUR'&&d.fx&&d.fx!==1){
    fxBlock='<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--rs);padding:8px 12px;margin-top:10px;font-size:11px;color:var(--text2);">'+
      '<b>FX trade-date</b> : '+escH(fxRatePill(d))+' · '+
      'Nominal '+escH(d.dev)+' '+f0(d.nom)+' ≈ '+fE(Math.round(fxToEur(d.nom,d)))+
      '<div style="font-size:10px;color:var(--text3);margin-top:3px;">'+
        'Frais sont calculés en '+escH(d.dev)+' puis convertis en EUR au taux à la date de facturation (UF=closing, Run=date facture trim, Perf=date valorisation). Le snapshot ci-dessus est figé au trade.'+
      '</div>'+
    '</div>';
  }
  // Group indicator (this deal is part of a multi-row submission)
  var groupBlock='';
  if(d.dealGroupId){
    var siblings=deals.filter(function(x){return x.dealGroupId===d.dealGroupId&&x._id!==d._id;});
    if(siblings.length){
      groupBlock='<div style="background:rgba(29,95,212,.08);border:1px solid rgba(29,95,212,.25);border-radius:var(--rs);padding:8px 12px;margin-top:10px;font-size:11px;color:var(--blue);">'+
        '<b>↔ Soumission groupée</b> ('+(siblings.length+1)+' contrats) : '+
        siblings.map(function(s){return '<a style="cursor:pointer;text-decoration:underline;" onclick="closeDet();openDet(deals['+deals.indexOf(s)+'])">'+escH(s.client)+' / '+escH(s.contrat)+'</a>';}).join(' · ')+
      '</div>';
    }
  }
  document.getElementById('detBody').innerHTML=
    '<div class="fg2">'+
    '<div><div class="kpi-l">Vendeur</div><div>'+escH(d.v||'')+'</div></div>'+
    '<div><div class="kpi-l">Trade date</div><div>'+escH(d.date||'')+'</div></div>'+
    '<div><div class="kpi-l">Client</div><div>'+escH(d.client||'')+'</div></div>'+
    '<div><div class="kpi-l">Contrat</div><div>'+escH(d.contrat||'')+'</div></div>'+
    (d.depositaire?'<div><div class="kpi-l">Dépositaire</div><div>'+escH(d.depositaire)+'</div></div>':'')+
    '<div><div class="kpi-l">Total contrat</div><div>'+fE(d.nom)+' '+escH(d.dev||'EUR')+(d.arbClosed?' <span class="badge bp" style="margin-left:6px;">Clôturé par arbitrage</span>':'')+'</div></div>'+
    (d.ct?'<div><div class="kpi-l">Type comm.</div><div>'+escH(d.ct)+'</div></div>':'')+
    (d.ufE>0?'<div><div class="kpi-l">UF</div><div>'+fE(d.ufE)+'</div></div>':'')+
    (d.runE>0?'<div><div class="kpi-l">Running/an</div><div>'+fE(d.runE)+'</div></div>':'')+
    '<div><div class="kpi-l">Statut facture</div><div>'+escH(d.fSt||'')+'</div></div>'+
    '</div>'+groupBlock+fxBlock+codifsBlock+arbBlock;
  document.getElementById('detHist').innerHTML=(d.hist||[]).slice().reverse().map(function(h){return '<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);"><span style="color:var(--text3);">'+h.ts+'</span> — '+h.a+'</div>';}).join('');
  document.getElementById('detEdit').onclick=function(){closeDet();openDealModal(idx);};
  document.getElementById('detDelete').onclick=function(){
    showDealDeleteConfirm(d,async function(action,links){
      if(action==='cancel')return;
      if(action==='view'){
        closeDet();
        var firstLink=links&&links[0];
        if(firstLink)ctrExp[firstLink.contract._id]=true;
        goTo('contrats',document.querySelector('.nbtn[onclick*=contrats]'));
        return;
      }
      if(action==='archive'){
        try{
          d.archived=true;
          if(!d.hist)d.hist=[];
          d.hist.push({ts:nowS(),a:'Deal archivé (soft-delete)',by:'Système'});
          if(d._id)await sbUpdate('deals',d._id,d);
          closeDet();renderAll();
          toast('Deal archivé. La facture reste dans Facturation avec mention "Deal supprimé".');
        }catch(e){console.error(e);alert('Erreur : '+(e.message||e));}
        return;
      }
      try{
        // Cascade is mandatory (Oscar 2026-05-18) — purge all linked produits and
        // delete any contract that becomes empty as a result.
        var cascade=await cascadeDeleteDealLinks(d);
        if(d._id)await sbDelete('deals',d._id);
        deals.splice(idx,1);
        closeDet();renderAll();
        toast('Deal supprimé définitivement.'+_cascadeSummaryToast(cascade));
      }catch(e){console.error(e);alert('Erreur : '+(e.message||e));}
    });
  };
  var showArb=(d.ct==='RUN'||d.ct==='BOTH')&&d.nom>0&&!d.arbClosed;
  document.getElementById('detArbitre').style.display=showArb?'':'none';
  document.getElementById('detArbitre').onclick=function(){closeDet();openArbitrage(idx);};
  document.getElementById('detModal').classList.add('on');
}
function closeDet(){document.getElementById('detModal').classList.remove('on');}

function openArbitrage(idx){
  var d=deals[idx];if(!d)return;
  arbSrcDeal=idx;
  document.getElementById('arbSrcFourn').textContent=d.fourn;
  document.getElementById('arbSrcFourn2').textContent=d.fourn;
  document.getElementById('arbSrcClient').textContent=d.client;
  document.getElementById('arbSrcNom').textContent=fE(d.nom)+' '+d.dev;
  document.getElementById('arbSrcRun').textContent=d.runE>0?fE(d.runE)+'/an':'';
  document.getElementById('arbNomDispo').textContent=fE(d.nom);
  document.getElementById('arbDate').value=today();
  document.getElementById('arbDestLines').innerHTML='';
  addArbDestLine();
  updateArbProrata();
  document.getElementById('arbModal').classList.add('on');
}
function closeArbModal(){document.getElementById('arbModal').classList.remove('on');arbSrcDeal=null;}

function arbFournSelectHTML(selected){
  return '<option value="">— Fournisseur —</option>'+fourn_db.map(function(f){return '<option value="'+escH(f.name)+'"'+(f.name===selected?' selected':'')+'>'+escH(f.name)+'</option>';}).join('');
}

// Counter used to make per-row datalist IDs unique (one ISIN-style datalist per row,
// repopulated when the fournisseur is changed).
var _arbDestLineCounter=0;
function addArbDestLine(){
  // Outer wrapper holds main grid row + optional parts/cours sub-row
  var wrap=document.createElement('div');
  wrap.className='arb-dest-row';
  wrap.style.cssText='margin-bottom:8px;';
  var counter=++_arbDestLineCounter;
  var prodListId='arbProdList-'+counter;
  var isinListId='arbIsinList-'+counter;
  wrap.dataset.prodListId=prodListId;
  wrap.dataset.isinListId=isinListId;
  // Phase F.5 \u2014 grid extended to include ISIN. Cols : Fourn \u00b7 Produit \u00b7 ISIN \u00b7
  // Contrat \u00b7 D\u00e9positaire \u00b7 Montant \u00b7 Type \u00b7 Taux \u00b7 \u00d7. Both Produit and ISIN
  // are datalist-backed inputs (typing OR picking works), and they cross-fill
  // each other when one is picked.
  var div=document.createElement('div');
  div.style.cssText='display:grid;grid-template-columns:1.2fr 1.3fr 120px 130px 130px 110px 100px 85px auto;gap:6px;align-items:center;';
  div.innerHTML=
    '<select class="arbFournSel" style="min-width:0;" onchange="_onArbFournChange(this);updateArbSummary()">'+arbFournSelectHTML('')+'</select>'+
    '<input list="'+prodListId+'" type="text" class="arbProduitSel" placeholder="Produit (auto-suggest)" style="min-width:0;" oninput="_onArbProduitChange(this)" onchange="_onArbProduitChange(this)"/>'+
    // Phase F.5 \u2014 ISIN input. Datalist sourced from the picked fournisseur's catalogue.
    // Picking an ISIN auto-fills produit/type/taux (reverse direction of Produit picker).
    // User can still type a custom ISIN manually \u2014 the datalist is suggestions, not gate.
    '<input list="'+isinListId+'" type="text" class="arbIsinSel" placeholder="ISIN" title="ISIN (auto-suggest catalogue, ou saisie manuelle)" style="min-width:0;font-family:monospace;font-size:11px;" oninput="_onArbIsinChange(this)" onchange="_onArbIsinChange(this)"/>'+
    '<select class="arbContratSel" style="min-width:0;">'+contratSelectHTML('Assurance Vie Lux')+'</select>'+
    '<select class="arbDepSel" style="min-width:0;">'+depositaireSelectHTML('')+'</select>'+
    '<input type="number" class="arbMontantSel" placeholder="Nominal" style="min-width:0;" oninput="_onArbMontantChange(this)"/>'+
    '<select class="arbTypeSel" style="min-width:0;" onchange="updateArbTypeRow(this);updateArbSummary()">'+
      '<option value="RUN">Running</option>'+
      '<option value="UF">UF</option>'+
      '<option value="BOTH">UF+Run</option>'+
      '<option value="PF">Perf fees</option>'+
    '</select>'+
    '<input type="number" class="arbTauxSel" placeholder="%" step="0.01" style="min-width:0;" title="Taux UF ou Running (%)" oninput="updateArbSummary()"/>'+
    '<button type="button" class="btn btn-sm" onclick="this.closest(\'.arb-dest-row\').remove();updateArbSummary();" style="color:var(--red);border-color:var(--red-bg);">\u2715</button>'+
    // Datalists \u2014 initially empty until a fournisseur is picked. Filled by _onArbFournChange.
    '<datalist id="'+prodListId+'"></datalist>'+
    '<datalist id="'+isinListId+'"></datalist>';
  // Batch D.3 \u2014 parts \u00d7 cours sub-row (auto-computes montant when both filled)
  var subRow=document.createElement('div');
  subRow.style.cssText='display:grid;grid-template-columns:1.2fr 1.3fr 120px 130px 130px 110px 100px 85px auto;gap:6px;align-items:center;margin-top:3px;padding-top:3px;border-top:1px dashed var(--border);font-size:10px;color:var(--text3);';
  subRow.innerHTML=
    '<span></span><span></span><span></span><span></span>'+
    '<span style="text-align:right;color:var(--text3);">Nb parts \u00d7 cours :</span>'+
    '<input type="number" class="arbNbPartsSel" placeholder="Nb" step="0.0001" style="min-width:0;font-size:10px;padding:3px 6px;" oninput="_onArbPartsChange(this)"/>'+
    '<span style="text-align:center;color:var(--text3);">\u00d7</span>'+
    '<input type="number" class="arbCoursSel" placeholder="Cours" step="0.0001" style="min-width:0;font-size:10px;padding:3px 6px;" oninput="_onArbPartsChange(this)"/>'+
    '<span></span>';
  wrap.appendChild(div);
  wrap.appendChild(subRow);
  document.getElementById('arbDestLines').appendChild(wrap);
  updateArbSummary();
}

// Phase C.3 / F.5 \u2014 when the fournisseur changes, repopulate BOTH datalists
// (produit + ISIN) from that fournisseur's catalogue. Same pattern as deal modal.
function _onArbFournChange(sel){
  var wrap=sel.closest('.arb-dest-row');
  if(!wrap)return;
  var fournName=sel.value;
  var prodListId=wrap.dataset.prodListId;
  if(prodListId){
    var dl=wrap.querySelector('datalist#'+prodListId);
    if(dl) dl.innerHTML=_prodDatalistInnerHtml(fournName);
  }
  // Phase F.5 \u2014 ISIN datalist too
  var isinListId=wrap.dataset.isinListId;
  if(isinListId){
    var idl=wrap.querySelector('datalist#'+isinListId);
    if(idl) idl.innerHTML=_isinDatalistInnerHtml(fournName);
  }
}

// Phase C.3 \u2014 when the user picks (or types) a product, look it up in the
// fournisseur's catalogue. If found, auto-fill the type+taux from its fees.
// First fee row wins (covers the 99% case of one fee per product); user can
// override after.
function _onArbProduitChange(input){
  var wrap=input.closest('.arb-dest-row');
  if(!wrap)return;
  var fournSel=wrap.querySelector('.arbFournSel');
  var fournName=fournSel?fournSel.value:'';
  if(!fournName)return;
  var partLabel=(input.value||'').trim();
  if(!partLabel)return;
  // Find a product with a matching `part` label in this fournisseur's catalog.
  var products=getFournProducts(fournName);
  var prod=products.find(function(p){return (p.part||'').trim()===partLabel;});
  if(!prod)return;
  // Phase F.5 \u2014 also cross-fill the ISIN input if it's empty (user picked produit first)
  var isinInput=wrap.querySelector('.arbIsinSel');
  if(isinInput && !isinInput.value && prod.isin) isinInput.value=prod.isin;
  // Auto-fill type/taux from the fees catalogue (Phase A.3 vocabulary).
  if(!prod.fees||!prod.fees.length)return;
  _applyArbProductFees(wrap, prod);
}
// Phase F.5 \u2014 reverse direction: user picks an ISIN, we look up the product by ISIN
// and cross-fill produit + type + taux. Same idempotency rules as the produit picker.
function _onArbIsinChange(input){
  var wrap=input.closest('.arb-dest-row');
  if(!wrap)return;
  var fournSel=wrap.querySelector('.arbFournSel');
  var fournName=fournSel?fournSel.value:'';
  if(!fournName)return;
  var isin=(input.value||'').trim();
  if(!isin)return;
  var prod=getFournProductByIsin(fournName, isin);
  if(!prod)return; // user typed a custom ISIN not in catalogue \u2014 that's allowed, just don't auto-fill
  // Cross-fill produit if empty
  var prodInput=wrap.querySelector('.arbProduitSel');
  if(prodInput && !prodInput.value && prod.part) prodInput.value=prod.part;
  // Auto-fill type/taux
  if(prod.fees && prod.fees.length) _applyArbProductFees(wrap, prod);
}
// Phase F.5 \u2014 shared application of a product's fees onto an arb dest line.
// Factored out so the produit picker and the ISIN picker call the same logic.
function _applyArbProductFees(wrap, prod){
  if(!wrap || !prod || !prod.fees) return;
  var rates=_feesToCycleRates(prod.fees);
  var typeSel=wrap.querySelector('.arbTypeSel');
  var tauxInput=wrap.querySelector('.arbTauxSel');
  if(!typeSel||!tauxInput)return;
  // Only fill the rate if the user hasn't typed one already.
  var hasManualRate=tauxInput.value&&parseFloat(tauxInput.value)>0;
  if(rates.ufR>0 && rates.runR>0){
    typeSel.value='BOTH';
    if(!hasManualRate) tauxInput.value=rates.runR; // BOTH convention: displayed taux is the running rate
  } else if(rates.runR>0){
    typeSel.value='RUN';
    if(!hasManualRate) tauxInput.value=rates.runR;
  } else if(rates.ufR>0){
    typeSel.value='UF';
    if(!hasManualRate) tauxInput.value=rates.ufR;
  }
  updateArbTypeRow(typeSel);
  updateArbSummary();
}
// Batch D.3 \u2014 arb dest line: auto-compute montant from nb \u00d7 cours when both > 0
function _onArbPartsChange(inputEl){
  var wrap=inputEl.closest('.arb-dest-row');
  if(!wrap)return;
  var nb=parseFloat(wrap.querySelector('.arbNbPartsSel').value);
  var cs=parseFloat(wrap.querySelector('.arbCoursSel').value);
  if(!isNaN(nb)&&!isNaN(cs)&&nb>0&&cs>0){
    wrap.querySelector('.arbMontantSel').value=(nb*cs).toFixed(2);
  }
  updateArbSummary();
}
function _onArbMontantChange(inputEl){
  // Manual montant input \u2014 wins over parts \u00d7 cours (which we keep stored as informational).
  updateArbSummary();
}

function updateArbTypeRow(sel){
  // Show/hide taux based on type
  var row=sel.closest('div');
  var taux=row.querySelector('.arbTauxSel');
  var type=sel.value;
  taux.placeholder=type==='PF'?'Montant PF':'%';
  taux.title=type==='UF'?'Taux UF (%)':type==='RUN'?'Taux Running (%/an)':type==='BOTH'?'Taux Running (%/an)':'Montant Perf fees (€)';
}

function updateArbProrata(){
  if(arbSrcDeal==null)return;
  var d=deals[arbSrcDeal];if(!d||!d.runE)return;
  var arbDate=document.getElementById('arbDate').value;if(!arbDate)return;
  var tradeDate=d.issue||d.date;if(!tradeDate)return;
  var days=Math.round((new Date(arbDate)-new Date(tradeDate))/(1000*60*60*24));
  if(days<=0)return;
  var prorata=Math.round(d.runE*(days/365));
  var trim=trimFromDate(arbDate);
  document.getElementById('arbProrataText').textContent='Pro-rata Running '+d.fourn+' : '+days+' jours ('+tradeDate+' \u2192 '+arbDate+') = '+fE(prorata)+' \u00e0 facturer'+(trim?' sur '+trimLabelFR(trim):'');
  document.getElementById('arbProrataInfo').style.display='block';
  updateArbSummary();
}

function updateArbSummary(){
  if(arbSrcDeal==null)return;
  var d=deals[arbSrcDeal];
  var total=Array.from(document.querySelectorAll('.arbMontantSel')).reduce(function(s,i){return s+(parseFloat(i.value)||0);},0);
  var solde=d.nom-total;
  document.getElementById('arbTotalArb').textContent=fE(total);
  document.getElementById('arbSolde').textContent=fE(solde);
  document.getElementById('arbSolde').style.color=solde<0?'var(--red)':solde===0?'var(--green)':'var(--text)';
  // Build a clear "what will happen" preview
  var preview=document.getElementById('arbPreview');
  var body=document.getElementById('arbPreviewBody');
  if(!preview||!body)return;
  var arbDate=document.getElementById('arbDate').value;
  if(!arbDate||total<=0||total>d.nom){preview.style.display='none';return;}
  var tradeDate=d.issue||d.date;
  var days=tradeDate?Math.round((new Date(arbDate)-new Date(tradeDate))/86400000):0;
  var prorataRun=d.runE>0&&days>0?Math.round(d.runE*(total/d.nom)*(days/365)):0;
  var trim=trimFromDate(arbDate);
  var destLines=document.querySelectorAll('#arbDestLines > div');
  var dests=[];
  destLines.forEach(function(line){
    var fourn=line.querySelector('.arbFournSel').value;
    var produit=line.querySelector('.arbProduitSel').value;
    var montant=parseFloat(line.querySelector('.arbMontantSel').value)||0;
    var type=line.querySelector('.arbTypeSel').value;
    var taux=parseFloat(line.querySelector('.arbTauxSel').value)||0;
    if(fourn&&montant>0)dests.push({fourn:fourn,produit:produit,montant:montant,type:type,taux:taux});
  });
  var clientHasContract=contracts_db.some(function(c){return c.client===d.client;});
  var willCloseSrc=solde===0;
  var lines=[];
  lines.push('• <b>Source</b> '+escH(d.fourn)+' / '+escH(d.produit||'')+' : nominal '+fE(d.nom)+' → '+fE(solde)+(willCloseSrc?' <span class="badge bp">clôturé</span>':' (réduit)'));
  if(prorataRun>0)lines.push('• <b>Pro-rata Running</b> à facturer : '+fE(prorataRun)+' ('+days+' j de '+escH(tradeDate||'?')+' à '+escH(arbDate)+')');
  if(prorataRun>0&&trim)lines.push('• <b>Rapprochement '+trimLabelFR(trim)+' '+escH(d.fourn)+'</b> : auto-incrémenté de +'+fE(prorataRun)+' avec note d\'arbitrage');
  if(dests.length){
    lines.push('• <b>'+dests.length+' nouveau'+(dests.length>1?'x deals créés':' deal créé')+'</b> avec date '+escH(arbDate)+' (statut "Deal réalisé")');
    dests.forEach(function(x){
      var commTxt='';
      if(x.type==='RUN')commTxt=' · Running '+x.taux+'%/an = '+fE(Math.round(x.taux/100*x.montant))+'/an';
      else if(x.type==='UF')commTxt=' · UF '+x.taux+'% = '+fE(Math.round(x.taux/100*x.montant));
      else if(x.type==='BOTH')commTxt=' · Run+UF '+x.taux+'%';
      else if(x.type==='PF')commTxt=' · Perf fees '+fE(x.taux);
      lines.push('&nbsp;&nbsp;&nbsp;&nbsp;→ '+escH(x.fourn)+' / '+escH(x.produit||'(produit)')+' · '+fE(x.montant)+commTxt);
    });
  }
  if(clientHasContract)lines.push('• <b>Suivi Contrats</b> : invest. source marqué arbitré · '+dests.length+' nouvelle'+(dests.length>1?'s lignes':' ligne')+' ajoutée'+(dests.length>1?'s':'')+' au contrat de '+escH(d.client));
  body.innerHTML=lines.join('<br>');
  preview.style.display='';
}

async function confirmArbitrage(){
 try{
  if(arbSrcDeal==null)return;
  var d=deals[arbSrcDeal];
  var arbDate=document.getElementById('arbDate').value;
  if(!arbDate){alert('Veuillez indiquer la date de l\'arbitrage.');return;}
  var destLines=document.querySelectorAll('#arbDestLines > div');
  var destinations=[];
  destLines.forEach(function(line){
    var fourn=line.querySelector('.arbFournSel').value;
    var produit=line.querySelector('.arbProduitSel').value||d.produit;
    var contrat=line.querySelector('.arbContratSel').value;
    var dep=line.querySelector('.arbDepSel').value;
    var montant=parseFloat(line.querySelector('.arbMontantSel').value)||0;
    var type=line.querySelector('.arbTypeSel').value;
    var taux=parseFloat(line.querySelector('.arbTauxSel').value)||0;
    // Batch D.3 — optional parts × cours capture (informational; montant is the source of truth)
    var nbPartsEl=line.querySelector('.arbNbPartsSel');
    var coursEl=line.querySelector('.arbCoursSel');
    var nbParts=nbPartsEl?(parseFloat(nbPartsEl.value)||null):null;
    var cours=coursEl?(parseFloat(coursEl.value)||null):null;
    if(fourn&&montant>0)destinations.push({fourn:fourn,produit:produit,contrat:contrat,depositaire:dep,nom:montant,ct:type,taux:taux,nbParts:nbParts,cours:cours});
  });
  if(!destinations.length){alert('Veuillez ajouter au moins un fournisseur cible.');return;}
  var totalArb=destinations.reduce(function(s,x){return s+x.nom;},0);
  if(totalArb>d.nom){alert('Le montant arb\u00e9tr\u00e9 ('+fE(totalArb)+') d\u00e9passe le nominal disponible ('+fE(d.nom)+').');return;}
  var arbId='ARB-'+Date.now();
  // Pro-rata source: from "last billable point" (issue or last trim cutoff) to arbDate, on the arbed portion only
  var tradeDate=d.issue||d.date;
  var days=tradeDate?Math.round((new Date(arbDate)-new Date(tradeDate))/(1000*60*60*24)):0;
  var prorataRun=d.runE>0&&days>0?Math.round(d.runE*(totalArb/d.nom)*(days/365)):0;

  // Mettre \u00e0 jour le deal source
  var srcOriginalNom=d.nom;
  d.nom=d.nom-totalArb;
  d.runE=d.nom>0?Math.round((d.runR/100)*d.nom):0;
  d.arbClosed=d.nom===0;
  if(d.nom===0)d.end=arbDate;
  if(!d.hist)d.hist=[];
  d.hist.push({ts:nowS(),a:'Arbitrage '+arbId+' \u2014 '+fE(totalArb)+' vers '+destinations.map(function(x){return x.fourn+' ('+fE(x.nom)+')';}).join(', ')+' le '+arbDate+' \u00b7 Pro-rata Running \u00e0 facturer : '+fE(prorataRun),by:'Syst\u00e8me'});
  if(d._id){var{_id,...upd}=d;await sbUpdate('deals',_id,upd);}

  // Cr\u00e9er les nouveaux deals destinations
  var createdDeals=[];
  for(var dest of destinations){
    var ufR=(dest.ct==='UF'||dest.ct==='BOTH')?dest.taux:0;
    var runR=(dest.ct==='RUN'||dest.ct==='BOTH')?dest.taux:0;
    var newDeal={
      v:d.v,date:arbDate,stat:'Deal r\u00e9alis\u00e9',
      client:d.client,contrat:dest.contrat,depositaire:dest.depositaire||'',broker:d.broker||'',
      fourn:dest.fourn,produit:dest.produit||d.produit,produit_type:d.produit_type||null,isin:d.isin||'',
      nom:dest.nom,dev:d.dev,fx:d.fx||1,
      issue:arbDate,invS:'',inv:'',
      ct:dest.ct||'RUN',
      ufR:ufR,runR:runR,tva:0,
      ufE:Math.round(ufR/100*dest.nom),
      runE:Math.round(runR/100*dest.nom),
      pf:dest.ct==='PF'?{mode:'fixed',amount:dest.taux,type:'fixed',freq:'Annuel'}:{mode:'none'},
      fSt:'\u00c0 \u00e9mettre',fRef:'',
      notes:'Arbitrage depuis '+d.fourn+' ('+fE(dest.nom)+') le '+arbDate,
      arbId:arbId,arbSrc:d._id||'',
      hist:[{ts:nowS(),a:'Deal cr\u00e9\u00e9 par arbitrage '+arbId+' depuis '+d.fourn+' \u2014 Nominal '+fE(dest.nom)+(dest.ct==='RUN'||dest.ct==='BOTH'?' \u00b7 Running '+dest.taux+'%/an':'')+(dest.ct==='UF'||dest.ct==='BOTH'?' \u00b7 UF '+dest.taux+'%':''),by:'Syst\u00e8me'}]
    };
    var res=await sbInsert('deals',newDeal);if(res&&res[0])newDeal._id=res[0].id;
    deals.push(newDeal);
    createdDeals.push(newDeal);
  }

  // \u2500\u2500 Rapprochement: ajouter automatiquement le pro-rata sur le trim de l'arbDate \u2500\u2500
  var rapprNote='';
  if(prorataRun>0){
    var trimPeriod=trimFromDate(arbDate);
    if(trimPeriod){
      try{
        var existing=rapprFind(d.fourn,'run',trimPeriod);
        var arbLine='[Arbitrage '+arbId+' \u00b7 '+arbDate+'] +'+f0(prorataRun)+' \u20ac pro-rata Running ('+f0(totalArb)+' \u20ac arbitr\u00e9 \u00b7 '+days+' j depuis '+(d.issue||d.date||'?')+')';
        var newComment=existing&&existing.comment?(existing.comment+'\n'+arbLine):arbLine;
        var newDeclared=(existing?(existing.declared||0):0)+prorataRun;
        await rapprSave(d.fourn,'run',trimPeriod,{
          declared:newDeclared,
          comment:newComment,
          facture:existing?existing.facture:false,
          factureDate:existing?existing.factureDate:'',
          paid:existing?existing.paid:false,
          paidDate:existing?existing.paidDate:'',
          theoTrim:existing?existing.theoTrim:0
        });
        rapprNote=' \u00b7 Rapprochement '+trimLabelFR(trimPeriod)+' '+d.fourn+' mis \u00e0 jour';
      }catch(e){console.warn('Rapprochement auto-update failed',e);rapprNote=' \u00b7 \u26a0 Mise \u00e0 jour rapprochement \u00e9chou\u00e9e \u2014 \u00e0 compl\u00e9ter manuellement';}
    }
  }

  // \u2500\u2500 Suivi Contrats: marquer source arbitr\u00e9, ajouter destinations \u2500\u2500
  try{
    var clientContract=contracts_db.find(function(c){return c.client===d.client;});
    if(clientContract){
      // Marquer l'investissement source comme partiellement/totalement arbitr\u00e9
      if(d._id&&Array.isArray(clientContract.produits)){
        var srcProd=clientContract.produits.find(function(p){return p.deal_id===d._id;});
        if(srcProd){
          srcProd.arbitrages=srcProd.arbitrages||[];
          srcProd.arbitrages.push({
            arbId:arbId,date:arbDate,montant:totalArb,
            prorata_run:prorataRun,
            destinations:createdDeals.map(function(nd){return{deal_id:nd._id||null,fourn:nd.fourn,produit:nd.produit,montant:nd.nom};})
          });
          // If source fully arbed, update montant to 0; else reduce
          var formatMontant=function(n,dev){return new Intl.NumberFormat('fr-FR').format(n)+' '+(dev||'EUR');};
          srcProd.montant=d.nom>0?formatMontant(d.nom,d.dev):'0 '+(d.dev||'EUR')+' (arbitr\u00e9)';
          srcProd.notes=(srcProd.notes||'')+(srcProd.notes?' \u00b7 ':'')+'Arbitr\u00e9 '+fE(totalArb)+' le '+arbDate;
        }
      }
      // Ajouter les destinations comme nouvelles lignes investissement
      var packSteps=clientContract.template_name?templatePackForType(clientContract.template_name,d.produit_type):null;
      var stepsCopy=packSteps?templatePackCopy(clientContract.template_name,packSteps.id):[];
      createdDeals.forEach(function(nd){
        var prod={
          id:newStepId(),
          name:nd.produit||'(produit non nomm\u00e9)',
          isin:nd.isin||'',
          type:dealTypeToProdType(nd.produit_type),
          pack_name:packSteps?packSteps.name:'',
          montant:new Intl.NumberFormat('fr-FR').format(nd.nom)+' '+(nd.dev||'EUR'),
          notes:'Issu de l\'arbitrage '+arbId+' (source: '+d.fourn+')',
          steps:stepsCopy.map(function(s){return Object.assign({},s);}),
          deal_id:nd._id||null,
          arb_origin:{arbId:arbId,source_deal_id:d._id||null,source_fourn:d.fourn,date:arbDate}
        };
        clientContract.produits.push(prod);
        ctrExp[clientContract._id]=true;
        prodExp[clientContract._id+'|'+prod.id]=true;
      });
      await saveContract(clientContract);
    }
  }catch(e){console.error('Suivi Contrats sync after arbitrage failed',e);}

  closeArbModal();renderAll();
  toast('Arbitrage '+arbId+' enregistr\u00e9 \u2014 '+destinations.length+' destination'+(destinations.length>1?'s':'')+' \u00b7 Pro-rata : '+fE(prorataRun)+rapprNote);
 }catch(err){
  console.error('confirmArbitrage failed',err);
  alert('Erreur arbitrage : '+(err.message||err));
 }
}

// \u2500\u2500 RETRAIT (sortie de cash par le client) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Comme un arbitrage mais sans destination : le client retire son cash.
// Le nominal du deal source diminue (ou tombe \u00e0 0 = position cl\u00f4tur\u00e9e),
// le pro-rata Running sur la part retir\u00e9e est calcul\u00e9 et ajout\u00e9 au
// rapprochement du trimestre, et le Suivi Contrats du client est mis \u00e0 jour.
var retraitSrcDeal=null;

function openRetrait(idx){
  var d=deals[idx];if(!d)return;
  retraitSrcDeal=idx;
  document.getElementById('retrSrcFourn').textContent=d.fourn||'\u2014';
  document.getElementById('retrSrcClient').textContent=d.client||'';
  document.getElementById('retrSrcNom').textContent=fE(d.nom||0)+' '+(d.dev||'');
  document.getElementById('retrSrcRun').textContent=d.runE>0?fE(d.runE)+'/an':'';
  document.getElementById('retrNomDispo').textContent=fE(d.nom||0);
  document.getElementById('retrDate').value=today();
  document.getElementById('retrMontant').value='';
  var rnp=document.getElementById('retrNbParts');if(rnp)rnp.value='';
  var rcs=document.getElementById('retrCours');if(rcs)rcs.value='';
  document.getElementById('retrNote').value='';
  document.getElementById('retrTotal').textContent='\u2014';
  document.getElementById('retrSolde').textContent='\u2014';
  document.getElementById('retrProrataInfo').style.display='none';
  document.getElementById('retrPreview').style.display='none';
  document.getElementById('retraitModal').classList.add('on');
  setTimeout(function(){var m=document.getElementById('retrMontant');if(m)m.focus();},50);
}
function closeRetraitModal(){document.getElementById('retraitModal').classList.remove('on');retraitSrcDeal=null;}
function retraitFillTotal(){
  if(retraitSrcDeal==null)return;
  var d=deals[retraitSrcDeal];if(!d)return;
  document.getElementById('retrMontant').value=d.nom||0;
  updateRetraitPreview();
}

function updateRetraitPreview(){
  if(retraitSrcDeal==null)return;
  var d=deals[retraitSrcDeal];if(!d)return;
  var montant=parseFloat(document.getElementById('retrMontant').value)||0;
  var date=document.getElementById('retrDate').value;
  var solde=Math.max(0,(d.nom||0)-montant);
  document.getElementById('retrTotal').textContent=montant>0?fE(montant)+' '+(d.dev||''):'\u2014';
  document.getElementById('retrSolde').textContent=fE(solde)+' '+(d.dev||'');
  var soldeEl=document.getElementById('retrSolde');
  soldeEl.style.color=montant>(d.nom||0)?'var(--red)':solde===0?'var(--green)':'var(--text)';

  // Pro-rata Running
  var tradeDate=d.issue||d.date;
  var days=tradeDate&&date?Math.round((new Date(date)-new Date(tradeDate))/86400000):0;
  var prorataRun=d.runE>0&&days>0&&montant>0&&d.nom>0?Math.round(d.runE*(montant/d.nom)*(days/365)):0;
  var trim=trimFromDate(date);
  var pr=document.getElementById('retrProrataInfo');
  if(prorataRun>0){
    document.getElementById('retrProrataText').textContent='Pro-rata Running '+(d.fourn||'')+' : '+days+' j ('+tradeDate+' \u2192 '+date+') = '+fE(prorataRun)+' \u00e0 facturer'+(trim?' sur '+trimLabelFR(trim):'');
    pr.style.display='block';
  } else pr.style.display='none';

  // Aper\u00e7u
  var preview=document.getElementById('retrPreview');
  var body=document.getElementById('retrPreviewBody');
  if(!date||montant<=0||montant>(d.nom||0)){preview.style.display='none';return;}
  var willClose=solde===0;
  var clientHasContract=contracts_db.some(function(c){return c.client===d.client;});
  var lines=[];
  lines.push('\u2022 <b>Position</b> '+escH(d.fourn||'')+' / '+escH(d.produit||'')+' : nominal '+fE(d.nom||0)+' \u2192 '+fE(solde)+(willClose?' <span class="badge bp">cl\u00f4tur\u00e9e</span>':' (r\u00e9duite)'));
  lines.push('\u2022 <b>Cash retir\u00e9 par le client</b> : '+fE(montant)+' '+(d.dev||''));
  if(prorataRun>0)lines.push('\u2022 <b>Pro-rata Running</b> \u00e0 facturer : '+fE(prorataRun)+' ('+days+' j)');
  if(prorataRun>0&&trim)lines.push('\u2022 <b>Rapprochement '+trimLabelFR(trim)+' '+escH(d.fourn||'')+'</b> : auto-incr\u00e9ment\u00e9 de +'+fE(prorataRun));
  if(clientHasContract)lines.push('\u2022 <b>Suivi Contrats</b> : invest. marqu\u00e9 retrait, trace conserv\u00e9e dans l\'historique');
  body.innerHTML=lines.join('<br>');
  preview.style.display='';
}

// Batch D.3 — retraits: dual input mode (montant direct OR parts × cours)
// User can type either Montant, OR (NbParts, Cours) — the unfilled one is auto-derived.
function _onRetrPartsChange(){
  var nb=parseFloat(document.getElementById('retrNbParts').value);
  var c=parseFloat(document.getElementById('retrCours').value);
  if(!isNaN(nb)&&!isNaN(c)&&nb>0&&c>0){
    document.getElementById('retrMontant').value=(nb*c).toFixed(2);
  }
  updateRetraitPreview();
}
function _onRetrMontantInput(){
  // If user is editing montant directly while NbParts+Cours are also set,
  // clear the cours to break the ambiguity (montant becomes the source of truth again).
  var np=document.getElementById('retrNbParts');
  var cs=document.getElementById('retrCours');
  if(np&&cs&&(parseFloat(np.value)>0||parseFloat(cs.value)>0)){
    // Keep them for record but don't recompute; the manual montant wins until they're re-touched
  }
  updateRetraitPreview();
}
async function confirmRetrait(){
 try{
  if(retraitSrcDeal==null)return;
  var d=deals[retraitSrcDeal];if(!d)return;
  var montant=parseFloat(document.getElementById('retrMontant').value)||0;
  var nbParts=parseFloat((document.getElementById('retrNbParts')||{}).value)||null;
  var cours=parseFloat((document.getElementById('retrCours')||{}).value)||null;
  var date=document.getElementById('retrDate').value;
  var note=(document.getElementById('retrNote').value||'').trim();
  if(!date){alert('Veuillez indiquer la date du retrait.');return;}
  if(montant<=0){alert('Veuillez saisir un montant > 0.');return;}
  if(montant>(d.nom||0)){alert('Le montant retir\u00e9 ('+fE(montant)+') d\u00e9passe le nominal disponible ('+fE(d.nom||0)+').');return;}

  var retraitId='RTR-'+Date.now();
  var tradeDate=d.issue||d.date;
  var days=tradeDate?Math.round((new Date(date)-new Date(tradeDate))/86400000):0;
  var prorataRun=d.runE>0&&days>0&&d.nom>0?Math.round(d.runE*(montant/d.nom)*(days/365)):0;

  // Update source deal
  var willClose=montant>=d.nom;
  d.nom=Math.max(0,(d.nom||0)-montant);
  d.runE=d.nom>0?Math.round((d.runR/100)*d.nom):0;
  d.ufE=d.nom>0?Math.round((d.ufR/100)*d.nom):d.ufE; // UF reste tel quel si d\u00e9j\u00e0 per\u00e7u
  if(willClose){d.arbClosed=true;d.end=date;}
  if(!d.hist)d.hist=[];
  d.hist.push({ts:nowS(),a:'Retrait '+retraitId+' \u2014 '+fE(montant)+' '+(d.dev||'')+' le '+date+(prorataRun>0?' \u00b7 Pro-rata Running \u00e0 facturer : '+fE(prorataRun):'')+(note?' \u00b7 '+note:''),by:'Syst\u00e8me'});
  if(d._id){var{_id,...upd}=d;await sbUpdate('deals',_id,upd);}

  // Auto-update rapprochement with pro-rata
  var rapprNote='';
  if(prorataRun>0){
    var trimPeriod=trimFromDate(date);
    if(trimPeriod){
      try{
        var existing=rapprFind(d.fourn,'run',trimPeriod);
        var rLine='[Retrait '+retraitId+' \u00b7 '+date+'] +'+f0(prorataRun)+' \u20ac pro-rata Running ('+f0(montant)+' \u20ac retir\u00e9 \u00b7 '+days+' j)';
        var newComment=existing&&existing.comment?(existing.comment+'\n'+rLine):rLine;
        var newDeclared=(existing?(existing.declared||0):0)+prorataRun;
        await rapprSave(d.fourn,'run',trimPeriod,{
          declared:newDeclared,comment:newComment,
          facture:existing?existing.facture:false,
          factureDate:existing?existing.factureDate:'',
          paid:existing?existing.paid:false,
          paidDate:existing?existing.paidDate:'',
          theoTrim:existing?existing.theoTrim:0
        });
        rapprNote=' \u00b7 Rapprochement '+trimLabelFR(trimPeriod)+' '+(d.fourn||'')+' mis \u00e0 jour';
      }catch(e){console.warn('Rapprochement auto-update failed',e);rapprNote=' \u00b7 \u26a0 Mise \u00e0 jour rapprochement \u00e9chou\u00e9e';}
    }
  }

  // Suivi Contrats: log the retrait on the linked invest
  try{
    var clientContract=contracts_db.find(function(c){return c.client===d.client;});
    if(clientContract&&d._id&&Array.isArray(clientContract.produits)){
      var srcProd=clientContract.produits.find(function(p){return p.deal_id===d._id;});
      if(srcProd){
        srcProd.retraits=srcProd.retraits||[];
        srcProd.retraits.push({retraitId:retraitId,date:date,montant:montant,prorata_run:prorataRun,note:note,closed:willClose,nbParts:nbParts,cours:cours});
        var formatMontant=function(n,dev){return new Intl.NumberFormat('fr-FR').format(n)+' '+(dev||'EUR');};
        srcProd.montant=d.nom>0?formatMontant(d.nom,d.dev):'0 '+(d.dev||'EUR')+' (retrait total)';
        srcProd.notes=(srcProd.notes||'')+(srcProd.notes?' \u00b7 ':'')+'Retrait '+fE(montant)+' le '+date;
        await saveContract(clientContract);
      }
    }
  }catch(e){console.error('Suivi Contrats sync after retrait failed',e);}

  closeRetraitModal();renderAll();
  toast('Retrait '+retraitId+' enregistr\u00e9 \u2014 '+fE(montant)+(prorataRun>0?' \u00b7 Pro-rata : '+fE(prorataRun):'')+rapprNote);
 }catch(err){
  console.error('confirmRetrait failed',err);
  alert('Erreur retrait : '+(err.message||err));
 }
}

var factType='UF';
var ufDealTab='all';

function setFactType(t,btn){
  factType=t;
  ['ftUFTab','ftRUNTab'].forEach(id=>{
    var b=document.getElementById(id);if(!b)return;
    b.style.color='var(--text2)';b.style.borderBottomColor='transparent';b.style.fontWeight='500';
  });
  if(btn){btn.style.color='var(--blue)';btn.style.borderBottomColor='var(--blue)';btn.style.fontWeight='600';}
  document.getElementById('factUFSection').style.display=t==='UF'?'block':'none';
  document.getElementById('factRUNSection').style.display=t==='RUN'?'block':'none';
  document.getElementById('factPFSection').style.display=t==='PF'?'block':'none';
  if(t==='RUN'){initRecapTrim();renderRecapFourn();renderRunInvTable();}
  if(t==='UF'){renderUFRappr();renderUFInvTable();}
  if(t==='PF'){renderPFRappr();renderPFInvTable();}
}

function setUFDealTab(tab,btn){
  ufDealTab=tab;
  document.querySelectorAll('#ufDealTabs .btn').forEach(b=>{b.style.background='';b.style.color='';b.style.borderColor='';});
  if(btn){btn.style.background='var(--text)';btn.style.color='var(--surface)';btn.style.borderColor='var(--text)';}
  renderUFDeals();
}

function renderUFDeals(){
  // Phase D.3 — iterate codification-level entries, not raw deals. A deal with
  // Amundi (Run) + Wealins (UF) on the same contract now lands here ONLY for
  // its UF codification(s), not the whole deal. `d.ufR` / `d.fourn` etc. on
  // the entry refer to codif-level values; `d._id` and other deal-level
  // passthrough fields work as before.
  var all=billingUFEntries();
  var filtered=ufDealTab==='all'?all
    :ufDealTab==='aE'?all.filter(d=>!d.fSt||d.fSt==='À émettre')
    :ufDealTab==='fact'?all.filter(d=>d.fSt==='Facturé')
    :all.filter(d=>d.fSt==='Payé');
  var t=document.getElementById('ufDealsT');if(!t)return;
  while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('ufDealsEmpty').style.display=filtered.length?'none':'block';
  filtered.slice().sort((a,b)=>a.fourn.localeCompare(b.fourn)||(b.date||'').localeCompare(a.date||'')).forEach(function(d){
    // For per-row actions, idx must point to the parent deal in `deals` array.
    var idx=deals.indexOf(d.deal);
    var statut=d.fSt==='Payé'?'<span class="badge bg">Payée</span>':d.fSt==='Facturé'?'<span class="badge bb">Facturée</span>':'<span class="badge ba">À émettre</span>';
    var btn=d.fSt==='Payé'
      ?'<span style="font-size:11px;color:var(--green);">✓ Payé</span>'
      :d.fSt==='Facturé'
        ?'<button class="btn btn-sm" style="background:var(--green);color:white;border-color:var(--green);" onclick="markUFInvPaid('+idx+')">Marquer payé</button>'
        :'<button class="btn btn-sm" style="background:var(--green);color:white;border-color:var(--green);" onclick="openUFFactModalDeal('+idx+')">Facturer</button>';
    // Use codif's nominal for the line (not the deal total). Convert to EUR using deal fx.
    var nomE=Math.round((d.nominal||0)/(d.fx||1));
    var r=t.insertRow();
    r.innerHTML=
      '<td style="font-weight:500;">'+d.fourn+'</td>'+
      '<td>'+d.client+'</td>'+
      '<td style="color:var(--text2);">'+d.produit+'</td>'+
      '<td class="mono" style="color:var(--text2);">'+(d.issue||d.date||'—')+'</td>'+
      '<td style="text-align:right;" class="mono">'+fE(nomE)+'</td>'+
      '<td style="text-align:right;color:var(--text2);">'+(d.ufR||0)+'%</td>'+
      '<td style="text-align:right;font-weight:600;color:var(--blue);">'+fE(d.ufE)+'</td>'+
      '<td class="mono" style="color:var(--text2);">'+(d.invS||'—')+'</td>'+
      '<td class="mono" style="color:var(--green);">'+(d.inv||'—')+'</td>'+
      '<td>'+statut+'</td>'+
      '<td>'+btn+'</td>';
  });
}


var recapFam='ALL', recapTrim=1, recapTrimYear=new Date().getFullYear();
var recapCurrentFourn=null, recapCurrentTheo=0, recapCurrentEncours=0;

function setRecapFam(f,btn){
  recapFam=f;
  document.querySelectorAll('#recapFamTabs .btn').forEach(b=>{b.style.background='';b.style.color='';b.style.borderColor='';});
  btn.style.background='var(--text)';btn.style.color='var(--surface)';btn.style.borderColor='var(--text)';
  renderRecapFourn();
}
function setRecapTrim(t,btn){
  recapTrim=t;
  document.querySelectorAll('#recapTrimTabs .btn').forEach(b=>{b.style.background='';b.style.color='';b.style.borderColor='';});
  if(btn){btn.style.background='var(--text)';btn.style.color='var(--surface)';btn.style.borderColor='var(--text)';}
  renderRecapFourn();
}
function initRecapTrim(){
  var years=[...new Set(deals.map(d=>d.date?d.date.substring(0,4):null).filter(Boolean))].sort().reverse();
  if(!years.length)years=[String(new Date().getFullYear())];
  var sel=document.getElementById('recapTrimYear');
  var cur=sel.value;
  sel.innerHTML=years.map(y=>'<option'+(y===cur?' selected':'')+'>'+y+'</option>').join('');
  if(!sel.value)sel.value=years[0];
  recapTrimYear=parseInt(sel.value)||new Date().getFullYear();
  // Activate current trim button
  var t=Math.ceil((new Date().getMonth()+1)/3);
  recapTrim=t;
  document.querySelectorAll('#recapTrimTabs .btn').forEach(b=>{b.style.background='';b.style.color='';b.style.borderColor='';});
  var btn=document.getElementById('rcT'+t);
  if(btn){btn.style.background='var(--text)';btn.style.color='var(--surface)';btn.style.borderColor='var(--text)';}
}

// Running rapprochement — reads from in-memory cache, writes async to Supabase
function loadRecapFact(fourn){
  var r=rapprFind(fourn,'run','T'+recapTrim+'_'+recapTrimYear);
  return r?{declared:r.declared,comment:r.comment,facture:r.facture,factureDate:r.factureDate,paid:r.paid,paidDate:r.paidDate,theoTrim:r.theoTrim}:null;
}
async function saveRecapFactData(fourn,data){await rapprSave(fourn,'run','T'+recapTrim+'_'+recapTrimYear,data);}

function getTrimDates(trim,year){
  var starts=[[1,1],[4,1],[7,1],[10,1]];
  var ends=[[3,31],[6,30],[9,30],[12,31]];
  var s=starts[trim-1];var e=ends[trim-1];
  return{
    start:new Date(year,s[0]-1,s[1]),end:new Date(year,e[0]-1,e[1]),
    startStr:year+'-'+String(s[0]).padStart(2,'0')+'-'+String(s[1]).padStart(2,'0'),
    endStr:year+'-'+String(e[0]).padStart(2,'0')+'-'+String(e[1]).padStart(2,'0'),
    label:'T'+trim+' '+year
  };
}
function calcRunProrataTrim(d,trimDates){
  // Phase D.4 — prefer the codif's CURRENT runE (= post-retraits/arbitrages) when
  // available via a billing entry. This means : if 100k EUR was withdrawn from
  // an Amundi position before the trim, future quarters bill on what's left,
  // not on the initial nominal. The entry shape carries .codif and .deal back-
  // pointers so we can resolve the current value.
  // Known limitation: when a retrait happens DURING this trim, we use the
  // end-of-trim nominal for the whole period — slightly under-bills that one
  // quarter. Accurate intra-quarter prorata is a Phase D.5 refinement.
  var baseRun = d.runE;
  if(d.codif && d.deal && typeof codifCurrentRunE==='function'){
    baseRun = codifCurrentRunE(d.codif, d.deal);
  }
  if(!baseRun || baseRun===0) return 0;
  var tradeStr=d.issue||d.date;
  if(!tradeStr)return baseRun/4;
  var trade=new Date(tradeStr);
  if(trade>trimDates.end)return 0;
  var effStart=trade>trimDates.start?trade:trimDates.start;
  var days=Math.round((trimDates.end-effStart)/(1000*60*60*24))+1;
  return baseRun*(days/365);
}

function renderRecapFourn(){
  var sel=document.getElementById('recapTrimYear');
  if(sel&&sel.value)recapTrimYear=parseInt(sel.value)||recapTrimYear;
  var year=recapTrimYear||new Date().getFullYear();
  var trimDates=getTrimDates(recapTrim,year);
  document.getElementById('recapPeriodLabel').textContent='— '+trimDates.label;
  var pl2=document.getElementById('recapPeriodLabel2');if(pl2)pl2.textContent='— '+trimDates.label;

  var data=filt();
  var fourns=loadFourn().slice();

  // Filter by famille
  var filteredFourns=recapFam==='ALL'?fourns:fourns.filter(f=>f.famille===recapFam);
  filteredFourns.sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));

  // ── RUNNING TABLE ──
  // Phase D.3 — switch to codif-level entries. A deal with Amundi (Run) +
  // Wealins (UF) on the same contract now shows Amundi's Run portion under
  // Amundi here (and Wealins's UF portion in the UF table below), instead of
  // miscategorising the whole deal based on its top-level ct.
  var tRUN=document.getElementById('recapRUNT');
  while(tRUN.rows.length>1)tRUN.deleteRow(1);

  var entriesAll=billingEntries(data);
  var runRows=[];
  filteredFourns.forEach(f=>{
    var fDeals=entriesAll.filter(d=>(d.ct==='RUN'||d.ct==='BOTH')&&d.fourn===f.name&&(d.issue||d.date||'')<=trimDates.endStr);
    if(!fDeals.length)return;
    // Per-codif EUR-equivalent nominal (using deal FX).
    var nomEUR=fDeals.reduce((s,d)=>s+Math.round((d.nominal||0)/(d.fx||1)),0);
    var runAn=fDeals.reduce((s,d)=>s+(d.runE||0),0);
    // calcRunProrataTrim takes a deal; our entry exposes the deal-level fields
    // it reads (date/issue/runE/runStart) at the top level, so it works as-is.
    var theoTrim=fDeals.reduce((s,d)=>s+calcRunProrataTrim(d,trimDates),0);
    var saved=loadRecapFact(f.name);
    runRows.push({fourn:f,nb:fDeals.length,nomEUR,runAn,theoTrim,declared:saved?saved.declared:null,comment:saved?saved.comment:'',facture:saved?saved.facture:false});
  });

  document.getElementById('recapRUNEmpty').style.display=runRows.length?'none':'block';
  var totalNom=0,totalTheo=0,totalDecl=0,nbEcart=0;

  runRows.forEach(function(item){
    var bc=FAMILLE_BADGE[item.fourn.famille]||'bgr';
    var bl=FAMILLE_LABELS[item.fourn.famille]||item.fourn.famille||'—';
    var ecart=item.declared!=null?item.declared-item.theoTrim:null;
    var ecartCell=ecart!=null?'<span style="font-weight:600;color:'+(Math.abs(ecart)<1?'var(--green)':ecart>0?'var(--purple)':'var(--red)')+';">'+(ecart>=0?'+':'')+fE(ecart)+'</span>':'—';
    var statut=item.facture?'<span class="badge bg">Facturé</span>':item.declared==null?'<span class="badge ba">À saisir</span>':Math.abs(ecart)<1?'<span class="badge bg">Validé</span>':'<span class="badge br">Écart</span>';
    if(ecart!=null&&Math.abs(ecart)>=1)nbEcart++;
    totalNom+=item.nomEUR;totalTheo+=item.theoTrim;if(item.declared!=null)totalDecl+=item.declared;
    var r=tRUN.insertRow();
    r.innerHTML=
      '<td style="font-weight:500;white-space:nowrap;">'+item.fourn.name+'</td>'+
      '<td><span class="badge '+bc+'">'+bl+'</span></td>'+
      '<td style="text-align:center;">'+item.nb+'</td>'+
      '<td style="text-align:right;color:var(--blue);font-weight:500;">'+fE(item.nomEUR)+'</td>'+
      '<td style="text-align:right;color:var(--green);">'+fE(item.runAn)+'/an</td>'+
      '<td style="text-align:right;font-weight:600;color:var(--green);">'+fE(item.theoTrim)+'</td>'+
      '<td style="text-align:right;">'+(item.declared!=null?'<strong>'+fE(item.declared)+'</strong>':'<span style="color:var(--text3);">—</span>')+'</td>'+
      '<td>'+ecartCell+'</td>'+
      '<td>'+statut+'</td>'+
      '<td><button class="btn btn-sm" onclick="openRecapFactModal(\''+item.fourn.name.replace(/'/g,"\\'")+'\','+item.nomEUR+','+item.theoTrim+')">Saisir</button></td>';
  });

  // Total row
  if(runRows.length>1){
    var tr=tRUN.insertRow();tr.style.borderTop='2px solid var(--border-md)';
    var ecartTotal=totalDecl>0?totalDecl-totalTheo:null;
    tr.innerHTML='<td colspan="3" style="font-weight:700;">Total</td>'+
      '<td style="text-align:right;font-weight:700;color:var(--blue);">'+fE(totalNom)+'</td>'+
      '<td></td>'+
      '<td style="text-align:right;font-weight:700;color:var(--green);">'+fE(totalTheo)+'</td>'+
      '<td style="text-align:right;font-weight:700;">'+(totalDecl>0?fE(totalDecl):'—')+'</td>'+
      '<td style="font-weight:700;">'+(ecartTotal!=null?'<span style="color:'+(Math.abs(ecartTotal)<1?'var(--green)':ecartTotal>0?'var(--purple)':'var(--red)')+';">'+(ecartTotal>=0?'+':'')+fE(ecartTotal)+'</span>':'—')+'</td>'+
      '<td colspan="2"></td>';
  }

  // KPIs
  document.getElementById('recapKpi').innerHTML=
    kH('Encours total',fE(totalNom),runRows.length+' fournisseurs')+
    kH('Fact. théorique '+trimDates.label,fE(totalTheo),'pro-rata temporis')+
    kH('Déclaré fournisseurs',totalDecl>0?fE(totalDecl):'—',runRows.filter(r=>r.declared!=null).length+' / '+runRows.length+' saisis')+
    kH('En écart',nbEcart>0?nbEcart+' fourn.':'Aucun',nbEcart>0?'à vérifier':'',nbEcart>0?'danger':'');

  // ── UF TABLE ──
  // ── UF TABLE — une ligne par codification UF (Phase D.3) ──
  var tUF=document.getElementById('recapUFT');
  while(tUF.rows.length>1)tUF.deleteRow(1);
  var ufDeals=entriesAll.filter(d=>(d.ct==='UF'||d.ct==='BOTH')&&d.ufE>0&&(recapFam==='ALL'||fourns.find(f=>f.name===d.fourn&&f.famille===recapFam)));
  ufDeals.sort((a,b)=>a.fourn.localeCompare(b.fourn)||(b.date||'').localeCompare(a.date||''));
  document.getElementById('recapUFEmpty').style.display=ufDeals.length?'none':'block';
  var ufCommTotal=0;
  ufDeals.forEach(d=>{
    var f=fourns.find(x=>x.name===d.fourn)||{famille:''};
    var bc=FAMILLE_BADGE[f.famille]||'bgr';var bl=FAMILLE_LABELS[f.famille]||f.famille||'—';
    var statut=d.fSt==='Payé'?'<span class="badge bg">Payée</span>':d.fSt==='Facturé'?'<span class="badge bb">Facturée</span>':'<span class="badge ba">À émettre</span>';
    var safeName=d.fourn.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    var idx=deals.indexOf(d.deal); // entry → parent deal index
    var actionBtn=d.fSt==='Payé'
      ?'<span style="font-size:11px;color:var(--green);font-weight:600;">✓ Payé</span>'
      :'<button class="btn btn-sm" style="background:var(--green);color:white;border-color:var(--green);" onclick="openUFFactModalDeal('+idx+')">Facturer</button>';
    var nomE=Math.round((d.nominal||0)/(d.fx||1));
    var r=tUF.insertRow();
    r.innerHTML=
      '<td style="font-weight:500;">'+d.fourn+'</td>'+
      '<td><span class="badge '+bc+'">'+bl+'</span></td>'+
      '<td>'+d.client+'</td>'+
      '<td style="color:var(--text2);">'+d.produit+'</td>'+
      '<td class="mono" style="color:var(--text2);">'+(d.issue||d.date||'—')+'</td>'+
      '<td style="text-align:right;" class="mono">'+fE(nomE)+'</td>'+
      '<td style="text-align:right;color:var(--text2);">'+(d.ufR||0)+'%</td>'+
      '<td style="text-align:right;font-weight:500;color:var(--blue);">'+fE(d.ufE)+'</td>'+
      '<td>'+statut+'</td>'+
      '<td>'+actionBtn+'</td>';
    ufCommTotal+=d.ufE;
  });
  if(ufDeals.length>1){var tr=tUF.insertRow();tr.style.borderTop='2px solid var(--border-md)';tr.innerHTML='<td colspan="7" style="font-weight:700;">Total</td><td style="text-align:right;font-weight:700;color:var(--blue);">'+fE(ufCommTotal)+'</td><td colspan="2"></td>';}
}

// ── SUIVI FACTURES RUNNING ────────────────────────────────────────────────────
var runInvTab='all';

function setRunInvTab(tab,btn){
  runInvTab=tab;
  document.querySelectorAll('#runInvTabs .btn').forEach(b=>{b.style.background='';b.style.color='';b.style.borderColor='';});
  if(btn){btn.style.background='var(--text)';btn.style.color='var(--surface)';btn.style.borderColor='var(--text)';}
  renderRunInvTable();
}

function getAllRunInvoices(){
  return rapprochement_db.filter(function(r){return r.type==='run'&&r.declared!=null;}).map(function(r){
    var parts=(r.period||'').split('_');
    var year=parts[parts.length-1];
    var trim=parts.slice(0,parts.length-1).join('_');
    return {fourn:r.fourn,trim:trim,year:year,theoTrim:r.theoTrim||0,declared:r.declared,factureDate:r.factureDate||'',facture:r.facture||false,paid:r.paid||false,paidDate:r.paidDate||''};
  }).sort(function(a,b){return b.year.localeCompare(a.year)||b.trim.localeCompare(a.trim)||a.fourn.localeCompare(b.fourn);});
}

function renderRunInvTable(){
  var all=getAllRunInvoices();
  // Batch E.1 — 'archives' tab = paid invoices (Running/PF use rapprochement_db, no
  // 60s standby — the ✕ delete button is the revert path). 'pay' tab = empty in
  // the new flow since paid migrates immediately to Archives.
  var filtered=runInvTab==='all'?all.filter(function(i){return !i.paid;})
    :runInvTab==='aE'?all.filter(i=>!i.facture&&!i.paid)
    :runInvTab==='fact'?all.filter(i=>i.facture&&!i.paid)
    :runInvTab==='archives'?all.filter(i=>i.paid)
    :all.filter(i=>i.paid); // 'pay' (legacy) → behave like archives
  var t=document.getElementById('runInvT');
  while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('runInvEmpty').style.display=filtered.length?'none':'block';
  filtered.forEach(function(inv){
    var statut=inv.paid?'<span class="badge bg">Payée</span>':inv.facture?'<span class="badge bb">Facturée</span>':'<span class="badge ba">À émettre</span>';
    var btn=inv.paid?'<span style="font-size:11px;color:var(--green);">✓ Payé le '+escH(inv.paidDate||'')+'</span>':inv.facture?'<button class="btn btn-sm" style="background:var(--green);color:white;border-color:var(--green);" onclick="markRunInvPaid(\''+escAttr(inv.fourn)+'\',\''+escAttr(inv.trim)+'\',\''+escAttr(inv.year)+'\')">Marquer payé</button>':'—';
    var delBtn='<button class="btn btn-sm" style="color:var(--red);border-color:var(--red-bg);margin-left:4px;" onclick="deleteRunInv(\''+escAttr(inv.fourn)+'\',\''+escAttr(inv.trim)+'\',\''+escAttr(inv.year)+'\')">✕</button>';
    var r=t.insertRow();
    r.innerHTML='<td style="font-weight:500;">'+escH(inv.fourn)+'</td>'+
      '<td class="mono">'+escH(inv.trim)+' '+escH(inv.year)+'</td>'+
      '<td style="text-align:right;">'+fE(inv.theoTrim||0)+'</td>'+
      '<td style="text-align:right;font-weight:500;">'+fE(inv.declared)+'</td>'+
      '<td class="mono" style="color:var(--text2);">'+(inv.factureDate?escH(inv.factureDate):'—')+'</td>'+
      '<td>'+statut+'</td>'+
      '<td style="white-space:nowrap;">'+btn+delBtn+'</td>';
  });
}

async function deleteRunInv(fourn,trim,year){
  if(!confirm('Supprimer cette facture Running de "'+fourn+'" ('+trim+' '+year+') ?'))return;
  await rapprDelete(fourn,'run',trim+'_'+year);
  renderRunInvTable();renderRecapFourn();
  toast('Facture supprimée.');
}

async function markRunInvPaid(fourn,trim,year){
  try{
    var r=rapprFind(fourn,'run',trim+'_'+year);
    if(!r)return;
    var paidDate=new Date().toISOString().split('T')[0];
    await rapprSave(fourn,'run',trim+'_'+year,{declared:r.declared,comment:r.comment,facture:r.facture,factureDate:r.factureDate,paid:true,paidDate:paidDate,theoTrim:r.theoTrim});
    var trimNum=parseInt(trim.replace('T',''));
    var yearNum=parseInt(year);
    var trimDates=getTrimDates(trimNum,yearNum);
    // Phase D.3 — find parent deals that have at least one Run codif from this
    // fournisseur AND are in 'Facturé' state for this trim. dedupe to deals so
    // we update each deal's fSt only once even if it has multiple Run codifs
    // from the same fournisseur.
    var matchEntries=billingEntries(deals).filter(function(e){return(e.ct==='RUN'||e.ct==='BOTH')&&e.fourn===fourn&&e.fSt==='Facturé'&&e.invS===trimDates.endStr;});
    var toUpdateSet=new Set();matchEntries.forEach(function(e){toUpdateSet.add(e.deal);});
    var toUpdate=Array.from(toUpdateSet);
    for(var i=0;i<toUpdate.length;i++){
      var d=toUpdate[i];
      d.fSt='Payé';d.stat='Deal payé';d.inv=paidDate;
      d.hist.push({ts:nowS(),a:'Facture Running payée — '+trim+' '+year+' (deal passé en payé)',by:'Système'});
      if(d._id)await sbUpdate('deals',d._id,d);
    }
    renderRunInvTable();renderFact();renderKpis();updateAlertBadge();
    // Phase H — auto-refresh the commissions page if it's open (or its drill).
    // Marking a running rapprochement paid is the trigger for commission Running
    // to update — the drill needs to re-render to pick up the new amount.
    if(typeof renderCommissions==='function' && document.getElementById('p-commissions')&&document.getElementById('p-commissions').classList.contains('on')){
      renderCommissions();
    }
    if(typeof renderDrill==='function' && typeof commDrillVendeur!=='undefined' && commDrillVendeur){
      renderDrill();
    }
    toast('Facture '+fourn+' '+trim+' '+year+' marquée comme payée. Commissions mises à jour.');
  }catch(e){toast('Erreur lors de la mise à jour.');}
}

// Update genFactureRecap to store theoTrim for tracking

// ── PERF FEES RAPPROCHEMENT ───────────────────────────────────────────────────
var pfRapprCurrentFourn=null, pfRapprCurrentTheo=0;
var pfInvTabCurrent='all';

function loadPFRappr(fourn){var r=rapprFind(fourn,'pf',null);return r?{declared:r.declared,comment:r.comment,facture:r.facture,factureDate:r.factureDate}:null;}
async function savePFRapprData(fourn,data){await rapprSave(fourn,'pf',null,data);}

function setPFInvTab(tab,btn){
  pfInvTabCurrent=tab;
  document.querySelectorAll('#pfInvTabs .btn').forEach(b=>{b.style.background='';b.style.color='';b.style.borderColor='';});
  if(btn){btn.style.background='var(--text)';btn.style.color='var(--surface)';btn.style.borderColor='var(--text)';}
  renderPFInvTable();
}

function renderPFRappr(){
  var data=filt();
  var fourns=loadFourn();
  // Deals avec perf fees et statut À émettre
  var pfDeals=data.filter(d=>d.pf&&d.pf.mode!=='none'&&d.pf.amount>0&&(!d.fSt||d.fSt==='À émettre'));

  // KPIs
  var allPF=data.filter(d=>d.pf&&d.pf.mode!=='none'&&d.pf.amount>0);
  var toFact=allPF.filter(d=>!d.fSt||d.fSt==='À émettre');
  var factured=allPF.filter(d=>d.fSt==='Facturé');
  var paid=allPF.filter(d=>d.fSt==='Payé');
  document.getElementById('pfKpi').innerHTML=
    kH('À facturer','warn',fE(toFact.reduce((s,d)=>s+(d.pf.amount||0),0)),toFact.length+' deal'+(toFact.length!==1?'s':''))+
    kH('Facturé','',fE(factured.reduce((s,d)=>s+(d.pf.amount||0),0)),factured.length+' facture'+(factured.length!==1?'s':''))+
    kH('Payé','blue',fE(paid.reduce((s,d)=>s+(d.pf.amount||0),0)),paid.length+' facture'+(paid.length!==1?'s':''));

  // Rapprochement par fournisseur
  var t=document.getElementById('pfRapprT');
  while(t.rows.length>1)t.deleteRow(1);
  var byFourn={};
  pfDeals.forEach(d=>{
    if(!byFourn[d.fourn])byFourn[d.fourn]={nb:0,theo:0,deals:[],famille:''};
    byFourn[d.fourn].nb++;
    byFourn[d.fourn].theo+=(d.pf.amount||0);
    byFourn[d.fourn].deals.push(d);
    var f=fourns.find(x=>x.name===d.fourn);
    byFourn[d.fourn].famille=f?f.famille:'';
  });
  var rows=Object.entries(byFourn).sort((a,b)=>a[0].localeCompare(b[0]));
  document.getElementById('pfRapprEmpty').style.display=rows.length?'none':'block';
  rows.forEach(function([fname,v]){
    var bc=FAMILLE_BADGE[v.famille]||'bgr';var bl=FAMILLE_LABELS[v.famille]||'—';
    var saved=loadPFRappr(fname);
    var ecart=saved&&saved.declared!=null?saved.declared-v.theo:null;
    var statut=saved&&saved.facture?'<span class="badge bg">Facturé</span>':saved&&saved.declared!=null?'<span class="badge bg">Validé</span>':'<span class="badge ba">À saisir</span>';
    var r=t.insertRow();
    var safe=fname.replace(/'/g,"\\'");
    r.innerHTML=
      '<td style="font-weight:500;">'+fname+'</td>'+
      '<td><span class="badge '+bc+'">'+bl+'</span></td>'+
      '<td style="text-align:center;">'+v.nb+'</td>'+
      '<td style="text-align:right;font-weight:600;color:var(--green);">'+fE(v.theo)+'</td>'+
      '<td style="text-align:right;">'+(saved&&saved.declared!=null?'<strong>'+fE(saved.declared)+'</strong>':'<span style="color:var(--text3);">—</span>')+'</td>'+
      '<td>'+statut+'</td>'+
      '<td><button class="btn btn-sm" onclick="openPFRapprModal(\''+safe+'\')">Saisir</button></td>';
  });
}

function openPFRapprModal(fournName){
  var data=filt();
  var fDeals=data.filter(d=>d.pf&&d.pf.mode!=='none'&&d.pf.amount>0&&d.fourn===fournName&&(!d.fSt||d.fSt==='À émettre'));
  pfRapprCurrentFourn=fournName;
  pfRapprCurrentTheo=fDeals.reduce((s,d)=>s+(d.pf.amount||0),0);
  document.getElementById('pfRapprTitle').textContent='Perf fees — '+fournName;
  document.getElementById('pfRmFourn').textContent=fournName;
  document.getElementById('pfRmTheo').textContent=fE(pfRapprCurrentTheo);
  var saved=loadPFRappr(fournName);
  document.getElementById('pfRmDeclared').value=saved&&saved.declared!=null?saved.declared:'';
  document.getElementById('pfRmDeclared').removeAttribute('readonly');
  document.getElementById('pfRmComment').value=saved?saved.comment:'';
  // Phase I.5 — show per-deal breakdown with native + FX conversion when non-EUR.
  // For Perf fees the canonical FX date is the VALORISATION date (= when the
  // perf is observed). We use today as the reasonable default since that's when
  // the user is generating the invoice.
  var billingDate=new Date().toISOString().split('T')[0];
  document.getElementById('pfRmDealsList').innerHTML=fDeals.map(function(d){
    var dev=d.dev||'EUR';
    var pfAmtNative=d.pf.amount||0; // legacy: pf.amount stored in EUR. For non-EUR deals it's still EUR (legacy decision).
    if(dev!=='EUR'){
      // Show in EUR (snapshot) + FX line
      var rateHuman=fxHumanRate(d);
      return '<div style="padding:5px 0;border-bottom:1px solid var(--border);">'+
        '<div style="display:flex;justify-content:space-between;">'+
          '<div><strong>'+escH(d.client)+'</strong><span style="color:var(--text2);margin-left:6px;">'+escH(d.produit)+'</span></div>'+
          '<span style="font-weight:600;color:var(--green);">'+fE(d.pf.amount)+' EUR</span>'+
        '</div>'+
        '<div style="font-size:10px;color:var(--text3);margin-top:2px;">FX trade : 1 '+escH(dev)+' = '+rateHuman.toFixed(4)+' EUR'+(d.fxDate?' (au '+escH(d.fxDate)+')':'')+
        ' — note : Perf fees stockés en EUR. Si tu veux refacturer en '+escH(dev)+', re-set pf.amount manuellement.</div>'+
      '</div>';
    }
    return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);">'+
      '<div><strong>'+escH(d.client)+'</strong><span style="color:var(--text2);margin-left:6px;">'+escH(d.produit)+'</span></div>'+
      '<span style="font-weight:600;color:var(--green);">'+fE(d.pf.amount)+'</span></div>';
  }).join('');
  updatePFRapprEcart();
  document.getElementById('pfRapprModal').classList.add('on');
  setTimeout(()=>document.getElementById('pfRmDeclared').focus(),50);
}
function closePFRapprModal(){document.getElementById('pfRapprModal').classList.remove('on');pfRapprCurrentFourn=null;}
async function resetPFRappr(){
  if(!pfRapprCurrentFourn)return;
  if(!confirm('Réinitialiser la saisie pour '+pfRapprCurrentFourn+' ?'))return;
  await rapprDelete(pfRapprCurrentFourn,'pf',null);
  closePFRapprModal();renderPFRappr();toast('Saisie réinitialisée.');
}
function updatePFRapprEcart(){
  var declared=parseFloat(document.getElementById('pfRmDeclared').value)||0;
  if(!declared){document.getElementById('pfRmEcart').textContent='—';return;}
  var ecart=declared-pfRapprCurrentTheo;
  document.getElementById('pfRmEcart').textContent=(ecart>=0?'+':'')+fE(ecart);
  document.getElementById('pfRmEcart').style.color=Math.abs(ecart)<1?'var(--green)':ecart>0?'var(--purple)':'var(--red)';
}
async function savePFRappr(){
  if(!pfRapprCurrentFourn)return;
  var declared=parseFloat(document.getElementById('pfRmDeclared').value);
  if(isNaN(declared)){alert('Veuillez saisir un montant.');return;}
  var saved=loadPFRappr(pfRapprCurrentFourn)||{};
  await savePFRapprData(pfRapprCurrentFourn,{declared:declared,comment:document.getElementById('pfRmComment').value,facture:saved.facture||false});
  closePFRapprModal();renderPFRappr();toast('Montant enregistré pour '+pfRapprCurrentFourn+'.');
}
async function genPFRapprFacture(){
  if(!pfRapprCurrentFourn)return;
  var declared=parseFloat(document.getElementById('pfRmDeclared').value);
  if(isNaN(declared)||declared===0){alert('Veuillez saisir le montant avant de générer la facture.');return;}
  var comment=document.getElementById('pfRmComment').value;
  await savePFRapprData(pfRapprCurrentFourn,{declared:declared,comment:comment,facture:true,factureDate:new Date().toISOString().split('T')[0]});
  var fDeals=filt().filter(function(d){return d.pf&&d.pf.mode!=='none'&&d.pf.amount>0&&d.fourn===pfRapprCurrentFourn&&(!d.fSt||d.fSt==='À émettre');});
  for(var i=0;i<fDeals.length;i++){
    var d=fDeals[i];
    d.fSt='Facturé';d.invS=new Date().toISOString().split('T')[0];
    d.hist.push({ts:nowS(),a:'Facture Perf fees générée',by:'Système'});
    if(d._id)await sbUpdate('deals',d._id,d);
  }
  genInvoicePDF(pfRapprCurrentFourn,'PF',null,declared,fDeals);
  closePFRapprModal();renderPFRappr();renderPFInvTable();renderFact();renderKpis();
  toast('Facture Perf fees générée pour '+pfRapprCurrentFourn+'.');
}

function renderPFInvTable(){
  var all=deals.filter(d=>d.pf&&d.pf.mode!=='none'&&d.pf.amount>0);
  if(all.some(_isPaidStandby))_kickFactStandbyTimer();
  var filtered=_filterInvByTab(all,pfInvTabCurrent);
  if(pfInvTabCurrent==='archives'){
    filtered.sort(function(a,b){return (b.paidAt||'').localeCompare(a.paidAt||'');});
  } else {
    filtered.sort((a,b)=>a.fourn.localeCompare(b.fourn));
  }
  var t=document.getElementById('pfInvT');if(!t)return;
  while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('pfInvEmpty').style.display=filtered.length?'none':'block';
  filtered.forEach(function(d){
    var idx=deals.indexOf(d);
    var statut=d.fSt==='Payé'?'<span class="badge bg">Payée</span>':d.fSt==='Facturé'?'<span class="badge bb">Facturée</span>':'<span class="badge ba">À émettre</span>';
    var btn;
    if(d.fSt==='Payé'){btn=_renderStandbyBtn(idx,d,'unMarkPFInvPaid');}
    else if(d.fSt==='Facturé'){btn='<button class="btn btn-sm" style="background:var(--green);color:white;border-color:var(--green);" onclick="markPFInvPaid('+idx+')">Marquer payé</button>';}
    else {btn='—';}
    var r=t.insertRow();
    r.innerHTML=
      '<td style="font-weight:500;">'+escH(d.fourn||'')+'</td>'+
      '<td>'+escH(d.client||'')+'</td>'+
      '<td style="color:var(--text2);">'+escH(d.produit||'')+'</td>'+
      '<td style="text-align:right;font-weight:500;color:var(--green);">'+fE(d.pf.amount)+'</td>'+
      '<td class="mono" style="color:var(--text2);">'+escH(d.invS||'—')+'</td>'+
      '<td class="mono" style="color:var(--text2);">'+escH(d.inv||'—')+'</td>'+
      '<td>'+statut+'</td>'+
      '<td>'+btn+'</td>';
  });
}

async function markPFInvPaid(idx){
  var d=deals[idx];if(!d)return;
  d.fSt='Payé';d.stat='Deal payé';d.inv=new Date().toISOString().split('T')[0];
  d.paidAt=new Date().toISOString(); // Batch E.1 — start 60s stand-by
  d.hist.push({ts:nowS(),a:'Facture Perf fees payée (deal passé en payé)',by:'Système'});
  if(d._id)await sbUpdate('deals',d._id,d);
  renderPFInvTable();renderPFRappr();renderFact();renderKpis();updateAlertBadge();
  _kickFactStandbyTimer();
  toast('Facture Perf fees de '+d.client+' marquée payée — archivée dans 60s. Cliquer Annuler si erreur.');
}
async function unMarkPFInvPaid(idx){
  var d=deals[idx];if(!d)return;
  if(!_isPaidStandby(d))return;
  d.fSt='Facturé';d.stat='Deal réalisé';d.inv='';d.paidAt=null;
  d.hist.push({ts:nowS(),a:'Marquage facture Perf fees "payée" annulé (revenu en facturée)',by:'Système'});
  if(d._id)await sbUpdate('deals',d._id,d);
  renderPFInvTable();renderPFRappr();renderFact();renderKpis();updateAlertBadge();
  toast('Marquage annulé — facture revenue en "Facturée".');
}

// ── UF RAPPROCHEMENT ─────────────────────────────────────────────────────────
var ufFam='ALL';
var ufRapprCurrentFourn=null, ufRapprCurrentTheo=0;

function setUFFam(f,btn){
  ufFam=f;
  document.querySelectorAll('#ufFamTabs .btn').forEach(b=>{b.style.background='';b.style.color='';b.style.borderColor='';});
  if(btn){btn.style.background='var(--text)';btn.style.color='var(--surface)';btn.style.borderColor='var(--text)';}
  renderUFRappr();
}

function loadUFRappr(fourn){var r=rapprFind(fourn,'uf',null);return r?{declared:r.declared,comment:r.comment,facture:r.facture,factureDate:r.factureDate}:null;}
async function saveUFRapprData(fourn,data){await rapprSave(fourn,'uf',null,data);}

function renderUFRappr(){
  // Phase D.3 — flatten to codif-level entries before filtering so a deal with
  // Amundi (Run) + Wealins (UF) shows ONLY its UF codif here. Grouping by
  // fournisseur uses codif.fourn (the codif's own SDG/Banque/Assureur).
  var dataDeals=filt();
  var data=billingEntries(dataDeals);
  var fourns=loadFourn();
  var filteredFourns=ufFam==='ALL'?fourns:fourns.filter(f=>f.famille===ufFam);

  // KPIs — sum UF amounts at codif level.
  var allUF=data.filter(d=>(d.ct==='UF'||d.ct==='BOTH')&&d.ufE>0);
  var toFact=allUF.filter(d=>!d.fSt||d.fSt==='À émettre');
  var factured=allUF.filter(d=>d.fSt==='Facturé');
  var paid=allUF.filter(d=>d.fSt==='Payé');
  document.getElementById('ufKpi').innerHTML=
    kH('À facturer','warn',fE(toFact.reduce((s,d)=>s+(d.ufE||0),0)),toFact.length+' deal'+(toFact.length!==1?'s':''))+
    kH('Facturé','' ,fE(factured.reduce((s,d)=>s+(d.ufE||0),0)),factured.length+' facture'+(factured.length!==1?'s':''))+
    kH('Payé','blue',fE(paid.reduce((s,d)=>s+(d.ufE||0),0)),paid.length+' facture'+(paid.length!==1?'s':''));

  // Rapprochement table — group by codif.fourn (= the fournisseur supplying the UF product)
  var t=document.getElementById('ufRapprT');
  while(t.rows.length>1)t.deleteRow(1);
  var rows=[];
  filteredFourns.forEach(f=>{
    var fDeals=data.filter(d=>(d.ct==='UF'||d.ct==='BOTH')&&d.fourn===f.name&&(!d.fSt||d.fSt==='À émettre'));
    if(!fDeals.length)return;
    // Use codif nominal converted to EUR via deal fx (not deal.nom — that's the full contract).
    var nomTotal=fDeals.reduce((s,d)=>s+Math.round((d.nominal||0)/(d.fx||1)),0);
    var theo=fDeals.reduce((s,d)=>s+(d.ufE||0),0);
    var saved=loadUFRappr(f.name);
    rows.push({fourn:f,nb:fDeals.length,nomTotal,theo,declared:saved?saved.declared:null,facture:saved?saved.facture:false,deals:fDeals});
  });
  rows.sort((a,b)=>a.fourn.name.localeCompare(b.fourn.name));
  document.getElementById('ufRapprEmpty').style.display=rows.length?'none':'block';

  rows.forEach(function(item){
    var bc=FAMILLE_BADGE[item.fourn.famille]||'bgr';var bl=FAMILLE_LABELS[item.fourn.famille]||'—';
    var ecart=item.declared!=null?item.declared-item.theo:null;
    var ecartCell=ecart!=null?'<span style="font-weight:600;color:'+(Math.abs(ecart)<1?'var(--green)':ecart>0?'var(--purple)':'var(--red)')+';">'+(ecart>=0?'+':'')+fE(ecart)+'</span>':'—';
    var statut=item.facture?'<span class="badge bg">Facturé</span>':item.declared==null?'<span class="badge ba">À saisir</span>':Math.abs(ecart)<1?'<span class="badge bg">Validé</span>':'<span class="badge br">Écart</span>';
    var r=t.insertRow();
    var safeName=item.fourn.name.replace(/'/g,"\\'");
    r.innerHTML=
      '<td style="font-weight:500;">'+item.fourn.name+'</td>'+
      '<td><span class="badge '+bc+'">'+bl+'</span></td>'+
      '<td style="text-align:center;">'+item.nb+'</td>'+
      '<td style="text-align:right;color:var(--blue);font-weight:500;">'+fE(item.nomTotal)+'</td>'+
      '<td style="text-align:right;font-weight:600;color:var(--green);">'+fE(item.theo)+'</td>'+
      '<td style="text-align:right;">'+(item.declared!=null?'<strong>'+fE(item.declared)+'</strong>':'<span style="color:var(--text3);">—</span>')+'</td>'+
      '<td>'+statut+'</td>'+
      '<td><button class="btn btn-sm" onclick="openUFRapprModal(\''+safeName+'\')">Saisir</button></td>';
  });
}

function openUFRapprModal(fournName){
  // Phase D.3 — codif-level entries, filtered to the UF codifs of the picked fournisseur.
  var data=billingEntries(filt());
  var fDeals=data.filter(d=>(d.ct==='UF'||d.ct==='BOTH')&&d.fourn===fournName&&(!d.fSt||d.fSt==='À émettre'));
  ufRapprCurrentFourn=fournName;
  ufRapprCurrentTheo=fDeals.reduce((s,d)=>s+(d.ufE||0),0);
  document.getElementById('ufRapprTitle').textContent='Facture UF — '+fournName;
  document.getElementById('ufRmFourn').textContent=fournName;
  document.getElementById('ufRmNb').textContent=fDeals.length+' deal'+(fDeals.length!==1?'s':'');
  document.getElementById('ufRmTheo').textContent=fE(ufRapprCurrentTheo);
  var saved=loadUFRappr(fournName);
  document.getElementById('ufRmDeclared').value=saved?saved.declared:'';
  document.getElementById('ufRmComment').value=saved?saved.comment:'';
  // Phase I.4 — for non-EUR deals, show the breakdown : native amount + FX rate
  // + EUR conversion. Lets the user see exactly what's being charged in source
  // currency and the rate that converts it. Uses ufE_native if available
  // (Phase I.3 enrichment), else falls back to ufE / fxHumanRate.
  document.getElementById('ufRmDealsList').innerHTML=fDeals.map(function(d){
    var dev = d.dev || 'EUR';
    var isNative = dev !== 'EUR';
    var nativeAmt = (d.codif && typeof d.codif.ufE_native==='number') ? d.codif.ufE_native : (d.ufE * (d.fx||1));
    var fxLine = '';
    if(isNative && d.deal){
      var rateHuman = fxHumanRate(d.deal);
      fxLine = '<div style="font-size:10px;color:var(--text3);margin-top:2px;">'+
               dev+' '+f0(nativeAmt)+' × '+rateHuman.toFixed(4)+
               (d.deal.fxDate?' (taux '+escH(d.deal.fxDate)+')':'')+
               ' = EUR '+fE(d.ufE)+'</div>';
    }
    return '<div style="padding:5px 0;border-bottom:1px solid var(--border);">'+
      '<div style="display:flex;justify-content:space-between;">'+
        '<div><strong>'+d.client+'</strong><span style="color:var(--text2);margin-left:6px;">'+d.produit+'</span></div>'+
        '<span style="font-weight:600;color:var(--blue);">'+(isNative?dev+' '+f0(nativeAmt):fE(d.ufE))+'</span>'+
      '</div>'+
      fxLine+
    '</div>';
  }).join('');
  updateUFRapprEcart();
  document.getElementById('ufRapprModal').classList.add('on');
  setTimeout(()=>document.getElementById('ufRmDeclared').focus(),50);
}
function closeUFRapprModal(){document.getElementById('ufRapprModal').classList.remove('on');ufRapprCurrentFourn=null;}

async function resetUFRappr(){
  if(!ufRapprCurrentFourn)return;
  if(!confirm('Réinitialiser la saisie pour '+ufRapprCurrentFourn+' ?'))return;
  await rapprDelete(ufRapprCurrentFourn,'uf',null);
  closeUFRapprModal();renderUFRappr();toast('Saisie réinitialisée pour '+ufRapprCurrentFourn+'.');
}

function updateUFRapprEcart(){
  var declared=parseFloat(document.getElementById('ufRmDeclared').value)||0;
  if(!declared){document.getElementById('ufRmEcart').textContent='—';return;}
  var ecart=declared-ufRapprCurrentTheo;
  document.getElementById('ufRmEcart').textContent=(ecart>=0?'+':'')+fE(ecart);
  document.getElementById('ufRmEcart').style.color=Math.abs(ecart)<1?'var(--green)':ecart>0?'var(--purple)':'var(--red)';
}

async function saveUFRappr(){
  if(!ufRapprCurrentFourn)return;
  var declared=parseFloat(document.getElementById('ufRmDeclared').value);
  if(isNaN(declared)){alert('Veuillez saisir un montant.');return;}
  var saved=loadUFRappr(ufRapprCurrentFourn)||{};
  await saveUFRapprData(ufRapprCurrentFourn,{declared:declared,comment:document.getElementById('ufRmComment').value,facture:saved.facture||false});
  closeUFRapprModal();renderUFRappr();toast('Montant enregistré pour '+ufRapprCurrentFourn+'.');
}

async function genUFRapprFacture(){
  if(!ufRapprCurrentFourn)return;
  var declared=parseFloat(document.getElementById('ufRmDeclared').value);
  if(isNaN(declared)||declared===0){alert('Veuillez saisir le montant avant de générer la facture.');return;}
  var comment=document.getElementById('ufRmComment').value;
  await saveUFRapprData(ufRapprCurrentFourn,{declared:declared,comment:comment,facture:true,factureDate:new Date().toISOString().split('T')[0]});
  // Phase D.3 — entries view to find every UF codif of this fournisseur waiting to be invoiced.
  // markUFFacturé below operates on the parent deal (still deal-level state for now).
  var fDeals=billingEntries(filt()).filter(function(d){return(d.ct==='UF'||d.ct==='BOTH')&&d.fourn===ufRapprCurrentFourn&&(!d.fSt||d.fSt==='À émettre');});
  for(var i=0;i<fDeals.length;i++){
    var d=fDeals[i];
    d.fSt='Facturé';d.invS=new Date().toISOString().split('T')[0];
    d.hist.push({ts:nowS(),a:'Facture UF générée',by:'Système'});
    if(d._id)await sbUpdate('deals',d._id,d);
  }
  genInvoicePDF(ufRapprCurrentFourn,'UF',null,declared,fDeals);
  closeUFRapprModal();renderUFRappr();renderUFInvTable();renderFact();renderKpis();
  toast('Facture UF générée pour '+ufRapprCurrentFourn+' — '+fDeals.length+' deal'+(fDeals.length!==1?'s':'')+' mis à jour.');
}

// ── SUIVI FACTURES UF ────────────────────────────────────────────────────────
var ufInvTab='all';

function setUFInvTab(tab,btn){
  ufInvTab=tab;
  document.querySelectorAll('#ufInvTabs .btn').forEach(b=>{b.style.background='';b.style.color='';b.style.borderColor='';});
  if(btn){btn.style.background='var(--text)';btn.style.color='var(--surface)';btn.style.borderColor='var(--text)';}
  // Search box visible only on the Archives tab
  var sBox=document.getElementById('ufInvSearchWrap');
  if(sBox)sBox.style.display=tab==='archives'?'flex':'none';
  renderUFInvTable();
}

// ── Batch E.1 — stand-by + archives helpers (shared UF / RUN / PF) ──────────
var _FACT_STANDBY_MS=60000;
function _isPaidStandby(d){
  if(!d||d.fSt!=='Payé'||!d.paidAt)return false;
  try{return(Date.now()-new Date(d.paidAt).getTime())<_FACT_STANDBY_MS;}catch(e){return false;}
}
function _isPaidArchived(d){
  return d&&d.fSt==='Payé'&&!!d.paidAt&&!_isPaidStandby(d);
}
function _standbySecondsLeft(d){
  if(!d||!d.paidAt)return 0;
  try{return Math.max(0,Math.ceil((_FACT_STANDBY_MS-(Date.now()-new Date(d.paidAt).getTime()))/1000));}catch(e){return 0;}
}
function _filterInvByTab(all,tab){
  // tab values : 'all' | 'aE' | 'fact' | 'pay' | 'archives'
  if(tab==='archives')return all.filter(_isPaidArchived);
  // For non-archive tabs, always exclude already-archived paid (timestamped > 60s ago)
  var live=all.filter(function(d){return !_isPaidArchived(d);});
  if(tab==='aE')return live.filter(function(d){return !d.fSt||d.fSt==='À émettre';});
  if(tab==='fact')return live.filter(function(d){return d.fSt==='Facturé';});
  if(tab==='pay')return live.filter(function(d){return d.fSt==='Payé';});
  return live; // 'all'
}
function _renderStandbyBtn(idx,d,unMarkFn){
  // The fixed-width slot that displays "✓ Payé · (Ns) [Annuler]" while in stand-by,
  // then collapses to a static "✓ Payé le X" once archived.
  if(_isPaidStandby(d)){
    var s=_standbySecondsLeft(d);
    return '<span style="font-size:11px;color:var(--green);font-weight:500;">✓ Payé le '+escH(d.inv||'')+'</span>'+
      ' <span style="font-size:10px;color:var(--text3);">('+s+'s avant archivage)</span>'+
      ' <button class="btn btn-sm" style="margin-left:4px;font-size:10px;padding:2px 8px;color:var(--amber-t);border-color:var(--amber);" onclick="'+unMarkFn+'('+idx+')">Annuler</button>';
  }
  return '<span style="font-size:11px;color:var(--green);">✓ Payé le '+escH(d.inv||'')+'</span>';
}
// Auto-refresh timer — ticks every 1s while at least one deal is in stand-by window.
var _factStandbyTimer=null;
function _kickFactStandbyTimer(){
  if(_factStandbyTimer)return;
  _factStandbyTimer=setInterval(function(){
    var stillStandby=deals.some(_isPaidStandby);
    var pageOpen=document.getElementById('p-facturation')&&document.getElementById('p-facturation').classList.contains('on');
    if(pageOpen){
      if(typeof renderUFInvTable==='function')renderUFInvTable();
      if(typeof renderRunInvTable==='function')renderRunInvTable();
      if(typeof renderPFInvTable==='function')renderPFInvTable();
    }
    if(!stillStandby){clearInterval(_factStandbyTimer);_factStandbyTimer=null;}
  },1000);
}

function renderUFInvTable(){
  // Phase D.3 — codif-level entries so UF lists exactly the codifs that carry UF
  // fees, never the whole deal.
  var all=billingUFEntries();
  // Audit fix — restart standby timer if rows are still in the 60s window (e.g. after page reload)
  if(all.some(function(e){return _isPaidStandby(e.deal);}))_kickFactStandbyTimer();
  var filtered=_filterInvByTab(all,ufInvTab);
  // Archives tab: search box filters by client/fourn/produit
  if(ufInvTab==='archives'){
    var q=((document.getElementById('ufInvSearch')||{}).value||'').toLowerCase().trim();
    if(q)filtered=filtered.filter(function(d){return (d.client||'').toLowerCase().indexOf(q)!==-1||(d.fourn||'').toLowerCase().indexOf(q)!==-1||(d.produit||'').toLowerCase().indexOf(q)!==-1;});
    // Sort archives by paidAt desc (most recently archived first)
    filtered.sort(function(a,b){return ((b.deal&&b.deal.paidAt)||'').localeCompare((a.deal&&a.deal.paidAt)||'');});
  } else {
    filtered.sort(function(a,b){return b.date.localeCompare(a.date);});
  }
  var t=document.getElementById('ufInvT');
  if(!t)return;
  while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('ufInvEmpty').style.display=filtered.length?'none':'block';
  filtered.forEach(function(d){
    var idx=deals.indexOf(d.deal); // entry → parent deal idx
    var statut=d.fSt==='Payé'?'<span class="badge bg">Payée</span>':d.fSt==='Facturé'?'<span class="badge bb">Facturée</span>':'<span class="badge ba">À émettre</span>';
    var btn;
    if(d.fSt==='Payé'){btn=_renderStandbyBtn(idx,d,'unMarkUFInvPaid');}
    else if(d.fSt==='Facturé'){btn='<button class="btn btn-sm" style="background:var(--green);color:white;border-color:var(--green);" onclick="markUFInvPaid('+idx+')">Marquer payé</button>';}
    else {btn='<button class="btn btn-sm" onclick="markUFInvFact('+idx+')">Marquer facturée</button>';}
    var delBtn='<button class="btn btn-sm" style="color:var(--red);border-color:var(--red-bg);margin-left:4px;" onclick="deleteUFInv('+idx+')" title="Supprimer">✕</button>';
    var r=t.insertRow();
    r.innerHTML=
      '<td style="font-weight:500;">'+escH(d.fourn||'')+'</td>'+
      '<td>'+escH(d.client||'')+'</td>'+
      '<td style="color:var(--text2);">'+escH(d.produit||'')+'</td>'+
      '<td class="mono" style="color:var(--text2);">'+escH(d.issue||d.date||'—')+'</td>'+
      '<td style="text-align:right;font-weight:500;color:var(--blue);">'+fE(d.ufE)+'</td>'+
      '<td class="mono" style="color:var(--text2);">'+escH(d.invS||'—')+'</td>'+
      '<td class="mono" style="color:var(--text2);">'+escH(d.inv||'—')+'</td>'+
      '<td>'+statut+'</td>'+
      '<td style="white-space:nowrap;">'+btn+delBtn+'</td>';
  });
}

async function deleteUFInv(idx){
  var d=deals[idx];if(!d)return;
  if(!confirm('Réinitialiser la facture UF de "'+d.client+'" chez '+d.fourn+' ?'))return;
  var wasPaid=d.stat==='Deal payé';
  d.fSt='À émettre';d.invS='';d.inv='';
  if(wasPaid)d.stat='Deal réalisé';
  d.hist.push({ts:nowS(),a:'Facture UF réinitialisée'+(wasPaid?' (deal repassé en réalisé)':''),by:'Système'});
  if(d._id)await sbUpdate('deals',d._id,d);
  renderUFInvTable();renderFact();renderKpis();updateAlertBadge();
  toast('Facture UF réinitialisée.');
}

async function markUFInvFact(idx){
  var d=deals[idx];if(!d)return;
  d.fSt='Facturé';
  d.invS=new Date().toISOString().split('T')[0];
  d.hist.push({ts:nowS(),a:'Facture UF émise',by:'Système'});
  if(d._id)await sbUpdate('deals',d._id,d);
  renderUFInvTable();renderFact();renderKpis();updateAlertBadge();
  toast('Facture UF de '+d.client+' marquée comme facturée.');
}

async function markUFInvPaid(idx){
  var d=deals[idx];if(!d)return;
  var paidDate=new Date().toISOString().split('T')[0];
  d.fSt='Payé';d.stat='Deal payé';
  d.inv=paidDate;
  d.paidAt=new Date().toISOString(); // Batch E.1 — start the 60s stand-by countdown
  d.hist.push({ts:nowS(),a:'Facture UF payée (deal passé en payé)',by:'Système'});
  if(d._id)await sbUpdate('deals',d._id,d);
  renderUFInvTable();renderFact();renderKpis();updateAlertBadge();
  _kickFactStandbyTimer();
  toast('Facture UF de '+d.client+' marquée payée — archivée dans 60s. Cliquer Annuler si erreur.');
}
async function unMarkUFInvPaid(idx){
  var d=deals[idx];if(!d)return;
  if(!_isPaidStandby(d))return; // archived — unmarking from archives is via deleteUFInv
  d.fSt='Facturé';d.stat='Deal réalisé';
  d.inv='';
  d.paidAt=null;
  d.hist.push({ts:nowS(),a:'Marquage facture UF "payée" annulé (revenu en facturée)',by:'Système'});
  if(d._id)await sbUpdate('deals',d._id,d);
  renderUFInvTable();renderFact();renderKpis();updateAlertBadge();
  toast('Marquage annulé — facture revenue en "Facturée".');
}

function openRecapFactModal(fournName,encours,theo){
  recapCurrentFourn=fournName;recapCurrentTheo=theo;recapCurrentEncours=encours;
  var year=recapTrimYear;
  var trimDates=getTrimDates(recapTrim,year);
  document.getElementById('recapFactModalTitle').textContent=fournName+' — '+trimDates.label+' '+year;
  document.getElementById('rfmFourn').textContent=fournName;
  document.getElementById('rfmEncours').textContent=fE(encours);
  document.getElementById('rfmTheo').textContent=fE(theo);
  var saved=loadRecapFact(fournName);
  document.getElementById('rfmDeclared').value=saved&&saved.declared!=null?saved.declared:'';
  document.getElementById('rfmDeclared').removeAttribute('readonly');
  document.getElementById('rfmDeclared').removeAttribute('disabled');
  document.getElementById('rfmComment').value=saved?saved.comment:'';
  // Phase I.5 — show per-deal breakdown for non-EUR codifs at this fournisseur.
  // Async because we need to fetch the FX at the trim-end date (the canonical
  // moment for a Running quarterly invoice). The user sees the snapshot value
  // immediately + the live FX line populates a moment later.
  _renderRecapFactFxBreakdown(fournName, trimDates).catch(function(e){
    console.error('[FX breakdown] failed',e);
  });
  document.getElementById('rfmGenBtn').textContent=saved&&saved.facture?'✓ Facture générée':'✓ Valider et générer facture';
  document.getElementById('rfmGenBtn').style.opacity=saved&&saved.facture?'0.5':'1';
  updateRecapEcart();
  document.getElementById('recapFactModal').classList.add('on');
  setTimeout(()=>document.getElementById('rfmDeclared').focus(),50);
}
function closeRecapFactModal(){document.getElementById('recapFactModal').classList.remove('on');recapCurrentFourn=null;}

// Phase I.5 — async breakdown : for each non-EUR codif at this fournisseur (with
// Running fees), compute native amount × FX at trim-end → EUR. Show alongside
// the snapshot EUR (trade-date) so user sees what the BCE-rate-at-trim would
// give. Lets the user enter an informed declared amount.
async function _renderRecapFactFxBreakdown(fournName, trimDates){
  var el = document.getElementById('rfmFxBreakdown');
  if(!el) return;
  // Get all Run codifs at this fournisseur
  var entries = billingEntries(filt()).filter(function(e){
    return (e.ct==='RUN'||e.ct==='BOTH') && e.fourn===fournName;
  });
  var nonEur = entries.filter(function(e){return e.dev && e.dev!=='EUR' && e.deal;});
  if(!nonEur.length){ el.style.display='none'; return; }
  el.style.display='block';
  el.innerHTML='<div style="font-weight:600;color:var(--text2);margin-bottom:6px;">Conversion FX au taux de fin de trimestre ('+escH(trimDates.endStr)+')</div>'+
    '<div style="font-size:10px;color:var(--text3);font-style:italic;">Calcul en cours…</div>';
  // Fetch FX rates in parallel by distinct currency
  var devs = Array.from(new Set(nonEur.map(function(e){return e.dev;})));
  var rateMap = {};
  await Promise.all(devs.map(async function(dev){
    rateMap[dev] = await getFxRate(dev, 'EUR', trimDates.endStr);
  }));
  // Build the breakdown HTML
  var lines = [];
  var totalNativeByDev = {};
  var totalEurAtTrim = 0;
  var totalEurAtTrade = 0;
  nonEur.forEach(function(e){
    var d = e.deal;
    // Annual native running × trim_days/365 = trim-prorata native running
    var annualNative = (e.codif && typeof e.codif.runE_native==='number') ? e.codif.runE_native : (e.runE * (d.fx||1));
    var trimNative = annualNative / 4; // Approximate quarter — could refine via days_in_trim/365
    var rateAtTrim = rateMap[e.dev];
    var eurAtTrim = rateAtTrim ? Math.round(trimNative * rateAtTrim) : null;
    var eurAtTrade = Math.round(trimNative / (d.fx||1));
    if(!totalNativeByDev[e.dev]) totalNativeByDev[e.dev]=0;
    totalNativeByDev[e.dev] += trimNative;
    if(eurAtTrim!=null) totalEurAtTrim += eurAtTrim;
    totalEurAtTrade += eurAtTrade;
    lines.push(
      '<div style="display:grid;grid-template-columns:1fr auto;gap:8px;padding:4px 0;border-bottom:1px dotted var(--border);">'+
        '<div><b>'+escH(e.client||'?')+'</b> <span style="color:var(--text2);">'+escH(e.produit||'?')+'</span></div>'+
        '<div style="text-align:right;font-family:monospace;">'+
          e.dev+' '+f0(trimNative)+
          (rateAtTrim ? ' × <b>'+rateAtTrim.toFixed(4)+'</b> = EUR '+fE(eurAtTrim) : ' <span style="color:var(--red);">(FX non récupéré)</span>')+
        '</div>'+
        '<div style="font-size:9px;color:var(--text3);grid-column:1/-1;">Trade FX : '+(1/(d.fx||1)).toFixed(4)+' (≈ EUR '+fE(eurAtTrade)+(eurAtTrim!=null&&eurAtTrim!==eurAtTrade?' — écart FX '+(eurAtTrim>eurAtTrade?'+':'')+fE(eurAtTrim-eurAtTrade):'')+')</div>'+
      '</div>'
    );
  });
  var summary='<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-weight:600;">'+
    'Total trim à facturer (taux trim-end) : '+(totalEurAtTrim>0?fE(totalEurAtTrim)+' EUR':'—')+
    (totalEurAtTrade && totalEurAtTrim!==totalEurAtTrade?' &nbsp;<span style="color:var(--text3);font-weight:400;font-size:10px;">vs '+fE(totalEurAtTrade)+' au trade-date</span>':'')+
    '</div>';
  el.innerHTML='<div style="font-weight:600;color:var(--text2);margin-bottom:6px;">Conversion FX au taux de fin de trimestre ('+escH(trimDates.endStr)+')</div>'+
    lines.join('')+summary;
}
function updateRecapEcart(){
  var declared=parseFloat(document.getElementById('rfmDeclared').value)||0;
  if(!declared){document.getElementById('rfmEcart').textContent='—';document.getElementById('rfmEcartNote').textContent='';return;}
  var ecart=declared-recapCurrentTheo;
  var pct=recapCurrentTheo>0?((ecart/recapCurrentTheo)*100).toFixed(1)+'%':'';
  document.getElementById('rfmEcart').textContent=(ecart>=0?'+':'')+fE(ecart);
  document.getElementById('rfmEcart').style.color=Math.abs(ecart)<1?'var(--green)':ecart>0?'var(--purple)':'var(--red)';
  document.getElementById('rfmEcartNote').textContent=pct?pct+' par rapport à la facturation théorique':'';
}
async function saveRecapFact(){
  if(!recapCurrentFourn)return;
  var declared=parseFloat(document.getElementById('rfmDeclared').value);
  if(isNaN(declared)){alert('Veuillez saisir un montant.');return;}
  var saved=loadRecapFact(recapCurrentFourn)||{};
  await saveRecapFactData(recapCurrentFourn,{declared:declared,comment:document.getElementById('rfmComment').value,facture:saved.facture||false,paid:saved.paid||false,paidDate:saved.paidDate||'',theoTrim:recapCurrentTheo});
  closeRecapFactModal();renderRecapFourn();renderRunInvTable();toast('Montant enregistré pour '+recapCurrentFourn+'.');
}
async function genFactureRecap(){
  if(!recapCurrentFourn)return;
  var declared=parseFloat(document.getElementById('rfmDeclared').value);
  if(isNaN(declared)||declared===0){alert('Veuillez saisir le montant déclaré avant de générer la facture.');return;}
  var comment=document.getElementById('rfmComment').value;
  var year=recapTrimYear;
  var trimDates=getTrimDates(recapTrim,year);
  var trimLabel='T'+recapTrim+' '+year;
  await saveRecapFactData(recapCurrentFourn,{declared:declared,comment:comment,facture:true,factureDate:new Date().toISOString().split('T')[0],paid:false,paidDate:'',theoTrim:recapCurrentTheo});
  // Phase D.3 — find parent deals that have at least one Running codif from this fournisseur,
  // then mark each such deal as Facturé. (Per-codif facture status is a Phase D.4 concern.)
  var fEntries=billingEntries(filt()).filter(function(e){return(e.ct==='RUN'||e.ct==='BOTH')&&e.fourn===recapCurrentFourn;});
  var fDealsSet=new Set();fEntries.forEach(function(e){fDealsSet.add(e.deal);});
  var fDeals=Array.from(fDealsSet);
  var updated=0;
  for(var i=0;i<fDeals.length;i++){
    var d=fDeals[i];
    if(d.fSt!=='Payé'){d.fSt='Facturé';d.invS=trimDates.endStr;d.hist.push({ts:nowS(),a:'Facture Running générée — '+trimLabel,by:'Système'});if(d._id)await sbUpdate('deals',d._id,d);updated++;}
  }
  genInvoicePDF(recapCurrentFourn,'RUN',trimLabel,declared,fDeals);
  closeRecapFactModal();renderRecapFourn();renderRunInvTable();renderFact();renderKpis();
  toast('Facture générée pour '+recapCurrentFourn+' — '+updated+' deal'+(updated>1?'s':'')+' mis à jour.');
}

function renderFact(){
  // Phase D.3 — switch to codif-level entries so KPIs only count codifs that
  // carry the relevant fee type. A deal with Amundi (Run) + Wealins (UF) on
  // the same contract contributes its UF codif to UF KPIs AND its Run codif
  // to Run KPIs, instead of double-counting based on the deal's top-level ct.
  var dataDeals=filtIncludingArchived();
  var entries=billingEntries(dataDeals);
  var ufDeals=entries.filter(d=>d.ct==='UF'||d.ct==='BOTH');
  var aE=ufDeals.filter(d=>d.fSt==='À émettre');
  var fa=ufDeals.filter(d=>d.fSt==='Facturé');
  var pa=ufDeals.filter(d=>d.fSt==='Payé');
  var li=ufDeals.filter(d=>d.fSt==='Litige');
  var totalFact=[...fa,...pa].reduce((s,d)=>s+d.ufE,0);
  var totalPaye=pa.reduce((s,d)=>s+d.ufE,0);
  var totalRun=entries.filter(d=>d.ct==='RUN'||d.ct==='BOTH').reduce((s,d)=>s+d.runE,0);
  var runDeals=entries.filter(d=>d.ct==='RUN'||d.ct==='BOTH');
  var runFact=runDeals.filter(d=>d.fSt==='Facturé');
  var runPaye=runDeals.filter(d=>d.fSt==='Payé');
  var totalRunFact=0;
  rapprochement_db.filter(function(r){return r.type==='run'&&r.declared&&(r.facture||r.paid);}).forEach(function(r){totalRunFact+=r.declared;});
  var runFactNb=runFact.length+runPaye.length;
  document.getElementById('factKpi').innerHTML=
    kH('UF facturé + payé','',fE(totalFact),fa.length+pa.length+' factures')+
    kH('Running facturé + payé','',fE(totalRunFact),runFactNb+' facture'+(runFactNb!==1?'s':''))+
    kH('UF à émettre','warn',aE.length+' facture'+(aE.length!==1?'s':''),fE(aE.reduce((s,d)=>s+d.ufE,0))+' HT')+
    kH('Running annuel total','',fE(totalRun),'encours annualisés');
  var show=ftab==='all'?ufDeals:ftab==='aE'?aE:ftab==='fact'?fa:ftab==='pay'?pa:li;
  document.getElementById('factList').innerHTML=show.length?
    show.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(d=>fCard(d)).join(''):
    '<div class="empty">Aucune facture UF dans cette catégorie.</div>';
  // Batch B.3 — async pass to fill USD conversion mentions with billing-date FX rate
  _updateFactFxMentions(show);
}
// Batch B.3 — fetch period FX (= invoice date or today) for each USD facture
// and render the conversion mention inline. Snapshot trade-date FX is also shown
// for audit comparison.
async function _updateFactFxMentions(deals_subset){
  for(var i=0;i<deals_subset.length;i++){
    var d=deals_subset[i];
    if(!d._id||!d.dev||d.dev==='EUR')continue;
    if(d.fSt==='Payé')continue; // payment locked the rate — no need to surface a live conversion
    var card=document.querySelector('.fact-card[data-deal-id="'+d._id+'"]');
    if(!card)continue;
    var mention=card.querySelector('.fx-mention');
    if(!mention)continue;
    var billingDate=d.invS||today();
    mention.innerHTML='<span style="color:var(--text3);font-size:10px;">⏱ Calcul FX au '+escH(billingDate)+'…</span>';
    var rate=await getFxRate(d.dev,'EUR',billingDate);
    if(rate==null){
      mention.innerHTML='<div style="font-size:10px;color:var(--amber-t);background:var(--amber-bg);padding:5px 8px;border-radius:3px;border-left:2px solid var(--amber);">⚠ FX du jour non récupéré pour '+escH(d.dev)+' au '+escH(billingDate)+' — affichage avec snapshot trade-date.</div>';
      continue;
    }
    var nominalNative=d.nom||0;
    var ufP=(d.ufR||0)/100;
    var feeNative=nominalNative*ufP;
    var feeEurPeriod=feeNative*rate;
    var snapshotRate=d.fx?(1/d.fx):1;
    var snapshotEur=d.ufE||0;
    var diff=feeEurPeriod-snapshotEur;
    mention.innerHTML=
      '<div style="font-size:10px;color:var(--text2);margin-top:6px;padding:6px 9px;background:var(--amber-bg);border-radius:3px;border-left:2px solid var(--amber);">'+
        '<div style="font-weight:600;color:var(--amber-t);margin-bottom:3px;">⇄ Conversion '+escH(d.dev)+' → EUR (taux période)</div>'+
        '<div>Nominal <b>'+f0(nominalNative)+' '+escH(d.dev)+'</b> × UF '+(d.ufR||0)+'% = <b>'+f0(feeNative)+' '+escH(d.dev)+'</b></div>'+
        '<div>× FX <b>'+rate.toFixed(4)+'</b> au '+escH(billingDate)+' (date facturation) = <b>'+fE(Math.round(feeEurPeriod))+' HT</b></div>'+
        '<div style="color:var(--text3);margin-top:3px;">Pour mémoire — snapshot trade : FX '+snapshotRate.toFixed(4)+' au '+escH(d.fxDate||d.date||'?')+' = '+fE(snapshotEur)+
          (Math.abs(diff)>1?' · écart '+(diff>0?'+':'')+fE(Math.round(diff)):'')+
        '</div>'+
      '</div>';
  }
}

function fCard(d){
  var ht=d.ufE;
  var idx=deals.indexOf(d);
  var arch=!!d.archived;
  // Visual distinction for archived (faded + bottom-right warning panel)
  var archBanner=arch?'<div style="position:absolute;bottom:0;right:0;background:var(--red-bg);color:var(--red-t);font-size:10px;font-weight:600;padding:4px 10px;border-top-left-radius:8px;border-left:1px solid rgba(194,59,59,.3);border-top:1px solid rgba(194,59,59,.3);display:flex;align-items:center;gap:5px;" title="Le deal a été supprimé. La facture est conservée pour historique.">⚠ Deal supprimé</div>':'';
  var statusButtons=arch?'':'<button class="btn btn-sm" onclick="cycleFS('+idx+')">Changer statut</button>';
  // Batch B.3 — placeholder for FX conversion mention (USD/etc. only — filled async)
  var fxMentionPlaceholder=(d.dev&&d.dev!=='EUR'&&d.fSt!=='Payé')?'<div class="fx-mention"></div>':'';
  var devChip=(d.dev&&d.dev!=='EUR')?' <span class="badge ba" style="font-size:9px;">'+escH(d.dev)+'</span>':'';
  return '<div class="fact-card" data-deal-id="'+escH(d._id||'')+'" style="position:relative;'+(arch?'opacity:.85;border-style:dashed;':'')+'">'+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;">'+
      '<div>'+
        '<div style="font-size:11px;color:var(--text3);">'+(d.fRef||'Sans référence')+' · '+d.date+'</div>'+
        '<div style="font-size:14px;font-weight:600;margin-top:1px;">'+d.client+'</div>'+
        '<div style="font-size:11px;color:var(--text2);">'+d.fourn+(d.produit?' · '+d.produit:'')+'</div>'+
        '<div style="margin-top:4px;"><span class="badge bb" style="font-size:9px;">UF</span>'+devChip+' <span style="font-size:11px;color:var(--text2);">Trade date : '+(d.issue||'—')+'</span></div>'+
      '</div>'+
      '<div style="display:flex;gap:6px;align-items:center;">'+fBadge(d.fSt)+statusButtons+
      '</div>'+
    '</div>'+
    '<div class="fact-det">'+
      '<div><div class="fd-l">HT</div><div class="fd-v">'+fE(ht)+'</div></div>'+
      '<div><div class="fd-l">Total</div><div class="fd-v" style="font-size:15px;">'+fE(ht)+'</div></div>'+
      '<div><div class="fd-l">Invoice sending</div><div class="fd-v">'+(d.invS||'—')+'</div></div>'+
      '<div><div class="fd-l">Invoice payment</div><div class="fd-v">'+(d.inv||'—')+'</div></div>'+
      '<div><div class="fd-l">Vendeur</div><div class="fd-v">'+d.v+'</div></div>'+
    '</div>'+
    fxMentionPlaceholder+
    archBanner+
  '</div>';
}

async function cycleFS(idx){
  var o=['À émettre','Facturé','Payé','Litige'],d=deals[idx],i=o.indexOf(d.fSt),n=o[(i+1)%o.length];
  d.hist.push({ts:nowS(),a:'Statut → '+n,by:d.v});d.fSt=n;
  // Audit fix — cycleFS must trigger the same stand-by/archive flow as markUFInvPaid.
  // Going INTO 'Payé' starts the 60s countdown; going OUT clears it.
  if(n==='Payé'){d.paidAt=new Date().toISOString();d.stat='Deal payé';}
  else if(d.paidAt){d.paidAt=null;if(d.stat==='Deal payé')d.stat='Deal réalisé';}
  if(d._id)await sbUpdate('deals',d._id,d);
  renderFact();renderKpis();updateAlertBadge();
  if(typeof renderUFInvTable==='function')renderUFInvTable();
  if(typeof renderPFInvTable==='function')renderPFInvTable();
  if(n==='Payé'&&typeof _kickFactStandbyTimer==='function')_kickFactStandbyTimer();
  toast('Statut → '+n+(n==='Payé'?' — archivée dans 60s.':''));
}
function setFT(t,btn){ftab=t;document.querySelectorAll('#factTabs .stab').forEach(b=>b.classList.remove('on'));btn.classList.add('on');renderFact();}

// ── ALERTES (système de checks complet) ─────────────────────────────────────
function fmtDateFR(s){if(!s)return'';var d=new Date(s);if(isNaN(d))return s;return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric'});}
function fmtDelay(days){if(days===0)return"aujourd'hui";if(days===1)return'demain';if(days<0)return Math.abs(days)+' j en retard';if(days<30)return'dans '+days+' j';if(days<60)return'dans '+Math.round(days/7)+' sem';return'dans '+Math.round(days/30)+' mois';}
function trimFromDate(dateStr){
  if(!dateStr)return null;
  var d=new Date(dateStr);if(isNaN(d))return null;
  return 'T'+Math.ceil((d.getMonth()+1)/3)+'_'+d.getFullYear();
}
function trimLabelFR(period){
  if(!period)return'';
  var m=period.match(/^T([1-4])_(\d{4})$/);if(!m)return period;
  return 'Q'+m[1]+' '+m[2];
}
var ALERT_CATEGORIES={
  verifs:{label:'Vérifications post-deal',color:'var(--green,#22a05a)'},
  produits:{label:'Produits / Échéances',color:'var(--amber)'},
  deals:{label:'Cohérence des deals',color:'var(--red)'},
  contrats:{label:'Suivi Contrats',color:'var(--blue)'},
  rapprochement:{label:'Rapprochements',color:'var(--purple)'},
  orphans:{label:'Données orphelines',color:'var(--text3)'}
};

// Batch B.1 — Dismissed alerts persisted in localStorage.
// Reset never (Oscar can clear localStorage manually if needed).
var _ALERT_DISMISS_KEY='dealflow-alerts-dismissed-v1';
var _dismissedAlerts=null;
function _loadDismissedAlerts(){
  if(_dismissedAlerts)return _dismissedAlerts;
  try{_dismissedAlerts=JSON.parse(localStorage.getItem(_ALERT_DISMISS_KEY)||'{}')||{};}catch(e){_dismissedAlerts={};}
  return _dismissedAlerts;
}
function _isAlertDismissed(id){return !!_loadDismissedAlerts()[id];}
function dismissAlert(id){
  var d=_loadDismissedAlerts();
  d[id]=new Date().toISOString();
  try{localStorage.setItem(_ALERT_DISMISS_KEY,JSON.stringify(d));}catch(e){}
  renderAlertesPage();
  renderAll&&typeof renderAll==='function'&&renderAll();
}
function _firstOfNextMonth(date){
  return new Date(date.getFullYear(),date.getMonth()+1,1);
}
function _firstOfNextQuarter(date){
  var qStartMonth=Math.floor(date.getMonth()/3)*3+3; // next quarter start
  var year=date.getFullYear();
  if(qStartMonth>=12){qStartMonth-=12;year++;}
  return new Date(year,qStartMonth,1);
}
function _currentQuarterTag(date){
  var q=Math.floor(date.getMonth()/3)+1;
  return date.getFullYear()+'-Q'+q;
}
function _quarterEndDate(date){
  var qStartMonth=Math.floor(date.getMonth()/3)*3;
  return new Date(date.getFullYear(),qStartMonth+3,0); // last day of quarter
}
var ALERT_SEVERITY={
  urgent:{lbl:'Urgent',cls:'br',color:'var(--red)'},
  warning:{lbl:'Attention',cls:'ba',color:'var(--amber)'},
  info:{lbl:'Info',cls:'bb',color:'var(--blue)'}
};

function buildAlerts(){
  var alerts=[],now=new Date();now.setHours(0,0,0,0);
  var dayMs=86400000;

  // VÉRIFICATIONS POST-DEAL (Batch B.1) — J+3 / J+10 / 1er du mois / 1er du trimestre
  deals.forEach(function(d){
    if(d.stat==='Deal payé')return; // fully closed = nothing to verify
    if(d.archived)return;
    var refRaw=d.issue||d.date;
    if(!refRaw)return;
    var ref=new Date(refRaw);
    if(isNaN(ref))return;
    ref.setHours(0,0,0,0);
    var key=d._id||'idx-'+deals.indexOf(d);
    var detail=(d.client||'?')+' · '+(d.fourn||'')+(d.produit?' / '+d.produit:'');
    var act={type:'deal',payload:d._id||null};
    // J+3
    var j3=new Date(ref.getTime()+3*dayMs);
    if(now>=j3){
      var id3='verif-j3-'+key;
      if(!_isAlertDismissed(id3)){
        var ds3=Math.floor((now-j3)/dayMs);
        alerts.push({id:id3,severity:ds3>14?'urgent':ds3>7?'warning':'info',category:'verifs',title:'Vérif J+3 — '+(d.produit||'deal'),detail:detail+' · trade '+fmtDateFR(refRaw)+(ds3>0?' · '+ds3+' j depuis la deadline':''),action:act,dismissable:true});
      }
    }
    // J+10
    var j10=new Date(ref.getTime()+10*dayMs);
    if(now>=j10){
      var id10='verif-j10-'+key;
      if(!_isAlertDismissed(id10)){
        var ds10=Math.floor((now-j10)/dayMs);
        alerts.push({id:id10,severity:ds10>21?'urgent':ds10>10?'warning':'info',category:'verifs',title:'Vérif J+10 — '+(d.produit||'deal'),detail:detail+' · trade '+fmtDateFR(refRaw)+(ds10>0?' · '+ds10+' j depuis la deadline':''),action:act,dismissable:true});
      }
    }
    // 1er du mois suivant
    var nextMonth=_firstOfNextMonth(ref);
    if(now>=nextMonth){
      var idM='verif-month-'+key+'-'+nextMonth.toISOString().slice(0,7);
      if(!_isAlertDismissed(idM)){
        alerts.push({id:idM,severity:'info',category:'verifs',title:'Vérif mensuelle — '+(d.produit||'deal'),detail:detail+' · checkpoint depuis '+fmtDateFR(nextMonth.toISOString().slice(0,10)),action:act,dismissable:true});
      }
    }
    // 1er du trimestre suivant
    var nextQ=_firstOfNextQuarter(ref);
    if(now>=nextQ){
      var idQ='verif-quarter-'+key+'-'+nextQ.toISOString().slice(0,7);
      if(!_isAlertDismissed(idQ)){
        alerts.push({id:idQ,severity:'info',category:'verifs',title:'Vérif trimestrielle — '+(d.produit||'deal'),detail:detail+' · début de trimestre '+fmtDateFR(nextQ.toISOString().slice(0,10)),action:act,dismissable:true});
      }
    }
  });

  // FRAIS BANQUE TRIMESTRIEL (Batch B.2) — visible les 30 derniers jours du trimestre courant
  var qEnd=_quarterEndDate(now);
  var qTag=_currentQuarterTag(now);
  var daysToQEnd=Math.round((qEnd-now)/dayMs);
  if(daysToQEnd>=0&&daysToQEnd<=30){
    var bankAlertId='bank-fees-check-'+qTag;
    if(!_isAlertDismissed(bankAlertId)){
      alerts.push({id:bankAlertId,severity:daysToQEnd<=10?'urgent':daysToQEnd<=20?'warning':'info',category:'verifs',title:'Frais transaction banque — '+qTag+' à check',detail:'Fin de trimestre dans '+daysToQEnd+' j · vérifier les frais de transaction côté banque dépositaire',action:null,dismissable:true});
    }
  }

  // PRODUITS / ÉCHÉANCES
  deals.forEach(function(d){
    [{f:'terme',lbl:'Terme'},{f:'maturite',lbl:'Maturité'},{f:'end',lbl:'Fin'}].forEach(function(df){
      var v=d[df.f];if(!v)return;
      var t=new Date(v);if(isNaN(t))return;
      var days=Math.round((t-now)/dayMs);
      if(days<-30||days>180)return;
      var sev=days<=30?'urgent':days<=90?'warning':'info';
      alerts.push({id:'mat-'+(d._id||deals.indexOf(d))+'-'+df.f,severity:sev,category:'produits',title:(d.produit||'Produit')+' — '+df.lbl+' '+fmtDateFR(v),detail:(d.client||'?')+' · '+(d.produit_type?d.produit_type+' · ':'')+(d.fourn||'')+' · '+fmtDelay(days),action:{type:'deal',payload:d._id||null}});
    });
    if(Array.isArray(d.codifications)){
      d.codifications.forEach(function(c,i){
        if(!c||!c.maturite)return;
        var t=new Date(c.maturite);if(isNaN(t))return;
        var days=Math.round((t-now)/dayMs);
        if(days<-30||days>180)return;
        var sev=days<=30?'urgent':days<=90?'warning':'info';
        alerts.push({id:'codifmat-'+(d._id||deals.indexOf(d))+'-'+i,severity:sev,category:'produits',title:(c.produit||'Produit')+' — Maturité '+fmtDateFR(c.maturite),detail:(d.client||'?')+' · '+(c.fourn||'')+' · '+fmtDelay(days),action:{type:'deal',payload:d._id||null}});
      });
    }
  });

  // COHÉRENCE DES DEALS
  deals.forEach(function(d){
    var idx=deals.indexOf(d),key=d._id||idx;
    var ref=(d.client||'?')+' · '+(d.produit||'')+(d.fourn?' / '+d.fourn:'');
    var act={type:'deal',payload:d._id||null};
    if(!d.client)alerts.push({id:'noclient-'+key,severity:'urgent',category:'deals',title:'Deal sans client',detail:(d.produit||'')+' · '+(d.date||''),action:act});
    if(!d.fourn)alerts.push({id:'nofourn-'+key,severity:'urgent',category:'deals',title:'Deal sans fournisseur',detail:ref,action:act});
    if(!d.produit)alerts.push({id:'noprod-'+key,severity:'warning',category:'deals',title:'Deal sans produit nommé',detail:ref,action:act});
    if(!d.nom||d.nom<=0)alerts.push({id:'nonom-'+key,severity:'urgent',category:'deals',title:'Nominal nul ou manquant',detail:ref,action:act});
    if(d.fSt==='Payé'&&!d.inv)alerts.push({id:'paid-noinv-'+key,severity:'warning',category:'deals',title:'Deal "Payé" sans n° de facture',detail:ref,action:act});
    if(d.fSt==='Facturé'&&!d.invS)alerts.push({id:'fact-noinvs-'+key,severity:'warning',category:'deals',title:'Deal "Facturé" sans date d\'envoi',detail:ref,action:act});
    if(d.fSt==='Litige')alerts.push({id:'litige-'+key,severity:'urgent',category:'deals',title:'Deal en litige',detail:ref,action:act});
    if((d.ct==='UF'||d.ct==='BOTH')&&d.nom>0&&d.ufR>0&&(!d.ufE||d.ufE===0))alerts.push({id:'ufmismatch-'+key,severity:'warning',category:'deals',title:'Taux UF défini mais montant à 0',detail:ref+' · '+d.ufR+'%',action:act});
    if((d.ct==='RUN'||d.ct==='BOTH')&&d.nom>0&&d.runR>0&&(!d.runE||d.runE===0))alerts.push({id:'runmismatch-'+key,severity:'warning',category:'deals',title:'Taux Running défini mais montant à 0',detail:ref+' · '+d.runR+'%/an',action:act});
    if((d.ct==='RUN'||d.ct==='BOTH')&&d.runE>0&&!d.runStart&&!d.issue)alerts.push({id:'runnostart-'+key,severity:'info',category:'deals',title:'Running sans date de départ',detail:ref,action:act});
    if(d.ct==='UF'&&(!d.ufR||d.ufR===0))alerts.push({id:'ufnone-'+key,severity:'info',category:'deals',title:'Type UF mais taux à 0',detail:ref,action:act});
    if(d.stat==='Deal pipe'&&d.date){
      var pd=new Date(d.date);
      if(!isNaN(pd)){
        var pdDays=Math.round((now-pd)/dayMs);
        if(pdDays>180)alerts.push({id:'pipestale-'+key,severity:'warning',category:'deals',title:'Deal en pipe depuis > 6 mois',detail:ref+' · '+pdDays+' j',action:act});
        else if(pdDays>90)alerts.push({id:'pipeolder-'+key,severity:'info',category:'deals',title:'Deal en pipe depuis > 3 mois',detail:ref+' · '+pdDays+' j',action:act});
      }
    }
    if(d.stat==='Deal réalisé'&&(!d.ufE||d.ufE===0)&&(!d.runE||d.runE===0))alerts.push({id:'realnoq-'+key,severity:'info',category:'deals',title:'Deal réalisé sans commission',detail:ref,action:act});
    // Arbitrage pro-rata not yet billed
    var hasArbProrata=Array.isArray(d.hist)&&d.hist.some(function(h){return h.a&&h.a.indexOf('Pro-rata Running à facturer')!==-1;});
    if(hasArbProrata&&d.fSt!=='Payé'){
      alerts.push({id:'arbprorata-'+key,severity:'warning',category:'deals',title:'Pro-rata d\'arbitrage à facturer',detail:ref+' · '+(d.arbClosed?'clôturé':'partiellement arbitré'),action:act});
    }
  });
  // ISIN duplicates with different product names
  var isinMap={};
  deals.forEach(function(d){if(d.isin)(isinMap[d.isin]=isinMap[d.isin]||[]).push(d);});
  Object.keys(isinMap).forEach(function(isin){
    var ds=isinMap[isin];if(ds.length<2)return;
    var names={};ds.forEach(function(d){if(d.produit)names[d.produit.trim()]=true;});
    var distinct=Object.keys(names);
    if(distinct.length>1)alerts.push({id:'isindup-'+isin,severity:'warning',category:'deals',title:'ISIN '+isin+' avec produits différents',detail:distinct.slice(0,3).join(' / ')+(distinct.length>3?' …':''),action:null});
  });

  // SUIVI CONTRATS
  contracts_db.forEach(function(c){
    var act={type:'contract',payload:c._id};
    var pp=prelimProgress(c);
    var produits=c.produits||[];
    if(pp.total>0&&pp.done<pp.total&&produits.length>0)alerts.push({id:'prelim-incomplete-'+c._id,severity:'warning',category:'contrats',title:'Étapes préliminaires incomplètes',detail:c.client+' · '+pp.done+'/'+pp.total+' · '+produits.length+' invest.',action:act});
    if(produits.length===0&&pp.total>0)alerts.push({id:'noinvest-'+c._id,severity:'info',category:'contrats',title:'Contrat sans investissement',detail:c.client,action:act});
    produits.forEach(function(p){
      var pr=prodProgress(p);
      if(pr.total>0&&pr.done<pr.total){
        var sev=pr.done===0?'warning':'info';
        alerts.push({id:'prod-incomplete-'+c._id+'-'+p.id,severity:sev,category:'contrats',title:'Checklist incomplète — '+(p.name||'sans nom'),detail:c.client+' · '+pr.done+'/'+pr.total+' étapes',action:act});
      }
    });
  });
  // Pipe deals not linked to a Suivi Contrat
  deals.forEach(function(d){
    if(d.stat!=='Deal pipe')return;
    var hasLink=contracts_db.some(function(c){if(c.client!==d.client)return false;return (c.produits||[]).some(function(p){return p.deal_id===d._id;});});
    if(!hasLink)alerts.push({id:'pipenocontract-'+(d._id||deals.indexOf(d)),severity:'warning',category:'contrats',title:'Deal pipe sans suivi de contrat',detail:(d.client||'')+' · '+(d.produit||''),action:{type:'deal',payload:d._id||null}});
  });

  // RAPPROCHEMENTS
  rapprochement_db.forEach(function(r){
    if(r.declared&&!r.facture)alerts.push({id:'rappr-nofact-'+r.id,severity:'info',category:'rapprochement',title:'Rapprochement déclaré non facturé',detail:r.fourn+' · '+(r.period||'(sans période)')+' · '+f0(r.declared)+' €',action:null});
    if(r.facture&&!r.paid&&r.factureDate){
      var fd=new Date(r.factureDate);
      if(!isNaN(fd)){
        var fdays=Math.round((now-fd)/dayMs);
        if(fdays>60)alerts.push({id:'rappr-unpaid-'+r.id,severity:fdays>120?'urgent':'warning',category:'rapprochement',title:'Facture impayée depuis '+fdays+' j',detail:r.fourn+' · facturée le '+fmtDateFR(r.factureDate)+' · '+f0(r.declared)+' €',action:null});
      }
    }
    if(r.declared<0)alerts.push({id:'rappr-neg-'+r.id,severity:'warning',category:'rapprochement',title:'Rapprochement avec montant négatif',detail:r.fourn+' · '+(r.period||''),action:null});
  });

  // DONNÉES ORPHELINES
  fourn_db.forEach(function(f){if(!deals.some(function(d){return d.fourn===f.name;}))alerts.push({id:'fourn-orph-'+f._id,severity:'info',category:'orphans',title:'Fournisseur sans deal',detail:f.name,action:null});});
  brokers_db.forEach(function(b){if(!deals.some(function(d){return d.broker===b.name;}))alerts.push({id:'broker-orph-'+b._id,severity:'info',category:'orphans',title:'Broker sans deal',detail:b.name,action:null});});
  clients_db.forEach(function(cl){if(!deals.some(function(d){return d.client===cl.name;})&&!contracts_db.some(function(c){return c.client===cl.name;}))alerts.push({id:'client-orph-'+cl._id,severity:'info',category:'orphans',title:'Client sans aucun deal ni contrat',detail:cl.name,action:null});});
  var fournNames={};fourn_db.forEach(function(f){fournNames[f.name]=true;});
  var brokerNames={};brokers_db.forEach(function(b){brokerNames[b.name]=true;});
  var clientNames={};clients_db.forEach(function(c){clientNames[c.name]=true;});
  deals.forEach(function(d){
    var key=d._id||deals.indexOf(d);
    if(d.fourn&&!fournNames[d.fourn])alerts.push({id:'unknown-fourn-'+key,severity:'warning',category:'orphans',title:'Deal référence un fournisseur inconnu',detail:(d.client||'?')+' · "'+d.fourn+'"',action:{type:'deal',payload:d._id||null}});
    if(d.broker&&!brokerNames[d.broker]&&d.broker!=='Direct'&&d.broker!=='Autre')alerts.push({id:'unknown-broker-'+key,severity:'info',category:'orphans',title:'Deal référence un broker inconnu',detail:(d.client||'?')+' · "'+d.broker+'"',action:{type:'deal',payload:d._id||null}});
    if(d.client&&!clientNames[d.client])alerts.push({id:'unknown-client-'+key,severity:'warning',category:'orphans',title:'Deal référence un client absent du fichier',detail:'"'+d.client+'" · '+(d.produit||''),action:{type:'deal',payload:d._id||null}});
  });

  var order={urgent:0,warning:1,info:2};
  alerts.sort(function(a,b){var s=order[a.severity]-order[b.severity];if(s!==0)return s;return a.category.localeCompare(b.category);});
  return alerts;
}

function alertActionHandler(a){
  if(!a.action)return null;
  if(a.action.type==='deal'&&a.action.payload){
    return function(){var d=deals.find(function(x){return x._id===a.action.payload;});if(d)openDet(d);};
  }
  if(a.action.type==='contract'&&a.action.payload){
    return function(){ctrExp[a.action.payload]=true;goTo('contrats',document.querySelector('.nbtn[onclick*=contrats]'));};
  }
  return null;
}

function updateAlertBadge(){
  var alerts=buildAlerts();
  var urgent=alerts.filter(function(a){return a.severity==='urgent';}).length;
  var badge=document.getElementById('alertesBadge');
  if(badge){
    if(alerts.length>0){
      badge.textContent=alerts.length;
      badge.style.display='';
      badge.style.background=urgent>0?'var(--red-bg)':'var(--amber-bg)';
      badge.style.color=urgent>0?'var(--red-t)':'var(--amber-t)';
    } else badge.style.display='none';
  }
}

function renderAlertes(){updateAlertBadge();}

// Batch D.2 — collapse state per category and per (category+deal) sub-group, persisted in localStorage
var _ALERT_COLLAPSE_KEY='dealflow-alert-collapse-v1';
var _alertCollapseState=null;
function _loadAlertCollapse(){
  if(_alertCollapseState)return _alertCollapseState;
  try{_alertCollapseState=JSON.parse(localStorage.getItem(_ALERT_COLLAPSE_KEY)||'{"cat":{},"deal":{}}');}catch(e){_alertCollapseState={cat:{},deal:{}};}
  if(!_alertCollapseState.cat)_alertCollapseState.cat={};
  if(!_alertCollapseState.deal)_alertCollapseState.deal={};
  return _alertCollapseState;
}
function _saveAlertCollapse(){try{localStorage.setItem(_ALERT_COLLAPSE_KEY,JSON.stringify(_loadAlertCollapse()));}catch(e){}}
function _toggleAlertCat(cat){var s=_loadAlertCollapse();s.cat[cat]=!s.cat[cat];_saveAlertCollapse();renderAlertesPage();}
function _toggleAlertDealGroup(cat,dealId){var s=_loadAlertCollapse();var k=cat+'|'+dealId;s.deal[k]=!s.deal[k];_saveAlertCollapse();renderAlertesPage();}
function _expandAllAlerts(){var s=_loadAlertCollapse();s.cat={};s.deal={};_saveAlertCollapse();renderAlertesPage();}
function _collapseAllAlerts(){var s=_loadAlertCollapse();Object.keys(ALERT_CATEGORIES).forEach(function(k){s.cat[k]=true;});_saveAlertCollapse();renderAlertesPage();}
function _renderAlertItemRow(a){
  var sv=ALERT_SEVERITY[a.severity];
  var clickable=alertActionHandler(a)?'cursor:pointer;':'';
  var dismissBtn=a.dismissable?'<button type="button" class="alert-dismiss-btn" data-dismiss="'+escH(a.id)+'" title="Marquer comme vérifié" style="background:none;border:1px solid var(--border);color:var(--text2);cursor:pointer;font-size:10px;padding:3px 8px;border-radius:3px;margin-left:8px;">✓ Vérifié</button>':'';
  return '<div class="alert-item" style="'+clickable+'" data-alertid="'+escH(a.id)+'">'+
    '<span class="adot" style="background:'+sv.color+';"></span>'+
    '<div style="flex:1;min-width:0;">'+
      '<div style="font-size:13px;font-weight:500;color:var(--text);">'+escH(a.title)+'</div>'+
      '<div style="font-size:11px;color:var(--text2);margin-top:1px;">'+escH(a.detail||'')+'</div>'+
    '</div>'+
    '<span class="badge '+sv.cls+'">'+sv.lbl+'</span>'+
    dismissBtn+
  '</div>';
}
function renderAlertesPage(){
  if(!document.getElementById('p-alertes'))return;
  var alerts=buildAlerts();
  var sevFilter=(document.getElementById('alertSeverity')||{}).value||'';
  var catFilter=(document.getElementById('alertCategory')||{}).value||'';
  if(sevFilter)alerts=alerts.filter(function(a){return a.severity===sevFilter;});
  if(catFilter)alerts=alerts.filter(function(a){return a.category===catFilter;});

  var summary=document.getElementById('alertesSummary');
  if(summary){
    var byS={urgent:0,warning:0,info:0};alerts.forEach(function(a){byS[a.severity]++;});
    summary.innerHTML=alerts.length+' alerte'+(alerts.length>1?'s':'')+
      (byS.urgent>0?' · <span style="color:var(--red);font-weight:600;">'+byS.urgent+' urgent'+(byS.urgent>1?'s':'')+'</span>':'')+
      (byS.warning>0?' · <span style="color:var(--amber-t);font-weight:600;">'+byS.warning+' attention</span>':'')+
      (byS.info>0?' · <span style="color:var(--text2);">'+byS.info+' info</span>':'')+
      ' &nbsp;·&nbsp; <a onclick="_expandAllAlerts()" style="cursor:pointer;text-decoration:underline;color:var(--text3);font-size:10px;">tout déplier</a>'+
      ' / <a onclick="_collapseAllAlerts()" style="cursor:pointer;text-decoration:underline;color:var(--text3);font-size:10px;">tout replier</a>';
  }
  var listEl=document.getElementById('alertesList');
  var emptyEl=document.getElementById('alertesEmpty');
  if(!alerts.length){listEl.innerHTML='';emptyEl.style.display='block';return;}
  emptyEl.style.display='none';

  var groups={};alerts.forEach(function(a){(groups[a.category]=groups[a.category]||[]).push(a);});
  var collapse=_loadAlertCollapse();
  var html='';
  Object.keys(ALERT_CATEGORIES).forEach(function(catKey){
    var list=groups[catKey];if(!list||!list.length)return;
    var cat=ALERT_CATEGORIES[catKey];
    var catCollapsed=!!collapse.cat[catKey];
    // Sub-group by deal_id (when alert has action.type='deal'); rest goes into "ungrouped"
    var byDeal={};
    var ungrouped=[];
    list.forEach(function(a){
      var dealId=(a.action&&a.action.type==='deal'&&a.action.payload)?a.action.payload:null;
      if(dealId){(byDeal[dealId]=byDeal[dealId]||[]).push(a);}
      else ungrouped.push(a);
    });
    // Severity breakdown for the header chip
    var sBreak={urgent:0,warning:0,info:0};list.forEach(function(a){sBreak[a.severity]++;});
    var sevChips='';
    if(sBreak.urgent)sevChips+='<span style="color:var(--red);font-weight:600;font-size:10px;">'+sBreak.urgent+'⚠</span> ';
    if(sBreak.warning)sevChips+='<span style="color:var(--amber-t);font-weight:600;font-size:10px;">'+sBreak.warning+'!</span> ';
    if(sBreak.info)sevChips+='<span style="color:var(--text3);font-size:10px;">'+sBreak.info+'i</span>';
    html+='<div class="card" style="border-left:4px solid '+cat.color+';padding:0;margin-bottom:8px;overflow:hidden;">'+
      '<div onclick="_toggleAlertCat(\''+escH(catKey)+'\')" style="cursor:pointer;padding:9px 14px;display:flex;align-items:center;gap:8px;background:var(--surface2);user-select:none;">'+
        '<span class="chev'+(catCollapsed?'':' open')+'" style="color:var(--text2);">▾</span>'+
        '<span style="font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;">'+escH(cat.label)+'</span>'+
        '<span style="background:var(--surface);padding:1px 8px;border-radius:999px;font-weight:500;color:var(--text);font-size:11px;">'+list.length+'</span>'+
        '<div style="flex:1;"></div>'+
        '<span style="display:flex;gap:6px;align-items:center;">'+sevChips+'</span>'+
      '</div>';
    if(!catCollapsed){
      html+='<div style="padding:6px 12px 10px;">';
      // Ungrouped alerts first (no deal context)
      ungrouped.forEach(function(a){html+=_renderAlertItemRow(a);});
      // Then per-deal sub-groups
      Object.keys(byDeal).forEach(function(dealId){
        var dealAlerts=byDeal[dealId];
        if(dealAlerts.length===1){
          // Single alert per deal — render inline, no sub-group needed
          html+=_renderAlertItemRow(dealAlerts[0]);
        } else {
          var deal=deals.find(function(x){return x._id===dealId;});
          var dealLbl=deal?(escH(deal.client||'?')+' · '+escH(deal.fourn||'')+(deal.produit?' / '+escH(deal.produit):'')):'Deal '+escH(dealId);
          var dealCollapsed=!!collapse.deal[catKey+'|'+dealId];
          html+='<div style="margin:6px 0;border:1px dashed var(--border);border-radius:5px;overflow:hidden;">'+
            '<div onclick="_toggleAlertDealGroup(\''+escH(catKey)+'\',\''+escH(dealId)+'\')" style="cursor:pointer;padding:6px 10px;display:flex;align-items:center;gap:6px;background:var(--surface);font-size:11px;color:var(--text2);user-select:none;">'+
              '<span class="chev'+(dealCollapsed?'':' open')+'" style="font-size:10px;">▾</span>'+
              '<span style="font-weight:500;">'+dealLbl+'</span>'+
              '<span style="background:var(--surface2);padding:0 6px;border-radius:999px;font-size:10px;font-weight:500;">'+dealAlerts.length+'</span>'+
            '</div>';
          if(!dealCollapsed){
            html+='<div style="padding:4px 8px;">';
            dealAlerts.forEach(function(a){html+=_renderAlertItemRow(a);});
            html+='</div>';
          }
          html+='</div>';
        }
      });
      html+='</div>';
    }
    html+='</div>';
  });
  listEl.innerHTML=html;
  // Wire up action handlers (click on the row) and dismiss buttons (click on ✓)
  listEl.querySelectorAll('.alert-item').forEach(function(el){
    var id=el.dataset.alertid;
    var a=alerts.find(function(x){return x.id===id;});if(!a)return;
    var h=alertActionHandler(a);
    if(h){
      el.addEventListener('click',function(ev){
        // Don't trigger the row action when the user clicks the dismiss button
        if(ev.target.closest('.alert-dismiss-btn'))return;
        h(ev);
      });
    }
  });
  listEl.querySelectorAll('.alert-dismiss-btn').forEach(function(btn){
    btn.addEventListener('click',function(ev){
      ev.stopPropagation();
      dismissAlert(btn.dataset.dismiss);
    });
  });
}

// Encours d'un client = somme des nominaux (en EUR) de ses deals actifs.
// Un deal est "actif" si nom > 0 (les deals fully arbed-out ont nom=0 automatiquement).
// Audit fix — generic FX conversion for ALL non-EUR currencies (was hardcoded USD only).
// d.fx convention : native_per_EUR (e.g. USD : 1.087 → d.nom/d.fx = EUR).
function _dealNomEur(d){
  if(!d)return 0;
  var nom=d.nom||0;
  if(!d.dev||d.dev==='EUR')return nom;
  return nom/(d.fx||1);
}
function encoursForClient(clientName){
  if(!clientName)return 0;
  return deals.filter(function(d){return d.client===clientName&&(d.nom||0)>0;}).reduce(function(s,d){
    return s+_dealNomEur(d);
  },0);
}
function encoursTotalGlobal(){
  return deals.filter(function(d){return (d.nom||0)>0;}).reduce(function(s,d){
    return s+_dealNomEur(d);
  },0);
}
function renderEncoursGlobaux(){
  var total=encoursTotalGlobal();
  var clientSet={};
  deals.forEach(function(d){if((d.nom||0)>0&&d.client)clientSet[d.client]=true;});
  var nbClients=Object.keys(clientSet).length;
  document.getElementById('encoursGlobaux').textContent='€ '+f0(total);
  document.getElementById('encoursGlobauxSub').textContent=nbClients+' client'+(nbClients>1?'s':'')+' avec position'+(nbClients>1?'s':'')+' active'+(nbClients>1?'s':'');
}

// Palette catégorielle harmonisée (cohérente avec le design system)
var PALETTE=['#1d5fd4','#1a8a4a','#6b4fc4','#b07a10','#c23b3b','#0ea5e9','#ec4899','#10b981','#8b5cf6','#f59e0b','#475569','#65a30d'];
var CHART_DEFAULTS={
  font:{family:"'DM Sans', sans-serif",size:11},
  tooltip:{
    backgroundColor:'rgba(20,20,20,0.92)',padding:10,cornerRadius:6,
    titleFont:{size:12,weight:'600',family:"'DM Sans', sans-serif"},
    bodyFont:{size:12,family:"'DM Sans', sans-serif"},
    boxPadding:6,displayColors:true,borderColor:'rgba(255,255,255,0.08)',borderWidth:1
  },
  gridSoft:'rgba(0,0,0,0.05)'
};
function legendChip(color,label,suffix){
  return '<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;background:var(--surface2);border-radius:999px;"><span style="width:8px;height:8px;border-radius:2px;background:'+color+';display:inline-block;"></span><span>'+escH(label)+(suffix?' <span style="color:var(--text3);">'+suffix+'</span>':'')+'</span></span>';
}

function renderCharts(){
  renderPilotageKpis();
  renderEncoursGlobaux();
  var data=filt();
  var year=String(new Date().getFullYear());

  // ── 2. Évolution mensuelle UF + Running (line area) ──────────────────────
  // Aggregate by month for the current year (or whatever year filter is)
  var byM={};
  data.forEach(function(d){
    if(!d.date)return;
    var m=d.date.substring(0,7);
    if(!byM[m])byM[m]={uf:0,run:0};
    if(d.fSt==='Payé'&&d.inv)byM[m].uf+=(d.ufE||0);
    byM[m].run+=(d.runE||0)/12; // running annuel → mensuel
  });
  var months=Object.keys(byM).sort();
  // Last 12 months window for readability
  if(months.length>12)months=months.slice(-12);
  var mUF=months.map(function(m){return Math.round(byM[m].uf);});
  var mRun=months.map(function(m){return Math.round(byM[m].run);});
  var mLabels=months.map(function(m){var p=m.split('-');return ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][parseInt(p[1])-1]+' '+p[0].slice(2);});
  if(charts.tl)charts.tl.destroy();
  charts.tl=new Chart(document.getElementById('cTL'),{
    type:'line',
    data:{labels:mLabels,datasets:[
      {label:'UF payés',data:mUF,borderColor:'#1d5fd4',backgroundColor:'rgba(29,95,212,.15)',borderWidth:2.5,pointRadius:3,pointHoverRadius:6,pointBackgroundColor:'#1d5fd4',pointBorderColor:'#fff',pointBorderWidth:2,fill:true,tension:0.35},
      {label:'Running mensuel',data:mRun,borderColor:'#1a8a4a',backgroundColor:'rgba(26,138,74,.12)',borderWidth:2.5,pointRadius:3,pointHoverRadius:6,pointBackgroundColor:'#1a8a4a',pointBorderColor:'#fff',pointBorderWidth:2,fill:true,tension:0.35}
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{display:false},tooltip:Object.assign({},CHART_DEFAULTS.tooltip,{callbacks:{label:function(c){return c.dataset.label+' : '+fE(c.raw);}}})},scales:{x:{grid:{display:false,drawBorder:false},ticks:{color:'#9aa0a6',font:CHART_DEFAULTS.font}},y:{grid:{color:CHART_DEFAULTS.gridSoft,drawBorder:false},ticks:{color:'#9aa0a6',font:CHART_DEFAULTS.font,callback:function(v){return v>=1000?Math.round(v/1000)+'k':v;}},beginAtZero:true}}}
  });
  document.getElementById('pilTLLegend').innerHTML='<span style="margin-left:10px;">'+legendChip('#1d5fd4','UF payés')+' '+legendChip('#1a8a4a','Running mensuel')+'</span>';

  // ── 4. Top 10 clients (encours) ──────────────────────────────────────────
  var byClient={};
  data.forEach(function(d){
    if(!d.client||d.arbClosed)return;
    var nomEUR=_dealNomEur(d);
    byClient[d.client]=(byClient[d.client]||0)+nomEUR;
  });
  var topClients=Object.entries(byClient).sort(function(a,b){return a[1]-b[1];}).slice(-10);
  var tcL=topClients.map(function(e){return e[0];}),tcV=topClients.map(function(e){return Math.round(e[1]);});
  document.getElementById('cTopClientsW').style.height=Math.max(240,tcL.length*28+30)+'px';
  if(charts.tc)charts.tc.destroy();
  if(tcL.length)charts.tc=new Chart(document.getElementById('cTopClients'),{type:'bar',data:{labels:tcL,datasets:[{data:tcV,backgroundColor:'rgba(29,95,212,0.85)',hoverBackgroundColor:'#1d5fd4',borderRadius:6,borderWidth:0,maxBarThickness:22}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:Object.assign({},CHART_DEFAULTS.tooltip,{callbacks:{label:function(c){return fE(c.raw)+' d\'encours';}}})},scales:{x:{ticks:{color:'#9aa0a6',font:CHART_DEFAULTS.font,callback:function(v){return v>=1000000?(v/1000000).toFixed(1)+'M':v>=1000?Math.round(v/1000)+'k':v;}},grid:{color:CHART_DEFAULTS.gridSoft,drawBorder:false}},y:{ticks:{color:'#374151',font:CHART_DEFAULTS.font},grid:{display:false,drawBorder:false}}}}});

  // ── 5. Mix par type de produit (donut) ──────────────────────────────────
  var byType={};data.forEach(function(d){
    if(d.arbClosed||!d.nom)return;
    var t=d.produit_type||'Non classé';
    var nomEUR=_dealNomEur(d);
    byType[t]=(byType[t]||0)+nomEUR;
  });
  var typeEntries=Object.entries(byType).sort(function(a,b){return b[1]-a[1];});
  var ptL=typeEntries.map(function(e){return e[0];}),ptV=typeEntries.map(function(e){return Math.round(e[1]);});
  if(charts.pt)charts.pt.destroy();
  if(ptL.length)charts.pt=new Chart(document.getElementById('cTypeProd'),{type:'doughnut',data:{labels:ptL,datasets:[{data:ptV,backgroundColor:PALETTE.slice(0,ptL.length),borderWidth:2,borderColor:'#fff',hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{display:false},tooltip:Object.assign({},CHART_DEFAULTS.tooltip,{callbacks:{label:function(c){return c.label+' : '+fE(c.raw);}}})}}});
  document.getElementById('legTypeProd').innerHTML=ptL.length?ptL.map(function(l,i){return legendChip(PALETTE[i],l,fE(ptV[i]));}).join(''):'<span style="color:var(--text3);">Renseignez le type de produit dans les deals.</span>';

  // ── 6. Audrey vs David (commissions cumulées année) ──────────────────────
  var t=computeYearTotals(year);
  var vData={Audrey:{uf:0,run:0,pf:0},David:{uf:0,run:0,pf:0}};
  // UF/PF — direct from deals
  data.forEach(function(d){
    if(d.fSt!=='Payé'||!d.inv||!d.inv.startsWith(year))return;
    var split=d.v==='Audrey & David'?0.5:1;
    if(d.v==='Audrey'||d.v==='Audrey & David')vData.Audrey.uf+=(d.ufE||0)*split;
    if(d.v==='David'||d.v==='Audrey & David')vData.David.uf+=(d.ufE||0)*split;
    if(d.pf&&d.pf.amount){
      if(d.v==='Audrey'||d.v==='Audrey & David')vData.Audrey.pf+=d.pf.amount*split;
      if(d.v==='David'||d.v==='Audrey & David')vData.David.pf+=d.pf.amount*split;
    }
  });
  // Running — attribute by share
  rapprochement_db.forEach(function(r){
    if(r.type!=='run'||!r.paid||!r.declared||!r.period||!r.period.endsWith('_'+year))return;
    var fournDeals=deals.filter(function(x){return (x.ct==='RUN'||x.ct==='BOTH')&&x.fourn===r.fourn;});
    var totalRunE=fournDeals.reduce(function(s,x){return s+(x.runE||0);},0);
    if(!totalRunE)return;
    ['Audrey','David'].forEach(function(v){
      var vRunE=fournDeals.filter(function(x){return x.v===v||x.v==='Audrey & David';}).reduce(function(s,x){return s+(x.runE||0)*(x.v==='Audrey & David'?0.5:1);},0);
      vData[v].run+=r.declared*(vRunE/totalRunE);
    });
  });
  if(charts.ven)charts.ven.destroy();
  charts.ven=new Chart(document.getElementById('cVendeurs'),{
    type:'bar',
    data:{
      labels:['Audrey','David'],
      datasets:[
        {label:'UF',data:[Math.round(vData.Audrey.uf),Math.round(vData.David.uf)],backgroundColor:'#1d5fd4',borderRadius:6,maxBarThickness:60},
        {label:'Running',data:[Math.round(vData.Audrey.run),Math.round(vData.David.run)],backgroundColor:'#1a8a4a',borderRadius:6,maxBarThickness:60},
        {label:'Perf fees',data:[Math.round(vData.Audrey.pf),Math.round(vData.David.pf)],backgroundColor:'#6b4fc4',borderRadius:6,maxBarThickness:60}
      ]
    },
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{boxWidth:12,boxHeight:12,padding:14,font:CHART_DEFAULTS.font,color:'#374151'}},tooltip:Object.assign({},CHART_DEFAULTS.tooltip,{callbacks:{label:function(c){return c.dataset.label+' : '+fE(c.raw);}}})},scales:{x:{stacked:true,grid:{display:false,drawBorder:false},ticks:{color:'#374151',font:Object.assign({},CHART_DEFAULTS.font,{size:13,weight:'600'})}},y:{stacked:true,ticks:{color:'#9aa0a6',font:CHART_DEFAULTS.font,callback:function(v){return v>=1000?Math.round(v/1000)+'k':v;}},grid:{color:CHART_DEFAULTS.gridSoft,drawBorder:false},beginAtZero:true}}}
  });

  // ── 7. Pipeline & facturation par statut (À émettre / Facturé / Payé) ──
  var statuses=['À émettre','Facturé','Payé'];
  var pipeBySt={};statuses.forEach(function(s){pipeBySt[s]={uf:0,run:0,nom:0,nb:0};});
  data.forEach(function(d){
    var s=pipeBySt[d.fSt];if(!s)return;
    s.uf+=(d.ufE||0);s.run+=(d.runE||0);s.nb++;
    s.nom+=(_dealNomEur(d));
  });
  if(charts.pipe)charts.pipe.destroy();
  charts.pipe=new Chart(document.getElementById('cPipe'),{
    type:'bar',
    data:{
      labels:statuses,
      datasets:[
        {label:'UF',data:statuses.map(function(s){return Math.round(pipeBySt[s].uf);}),backgroundColor:'#1d5fd4',borderRadius:6,maxBarThickness:60},
        {label:'Running annuel',data:statuses.map(function(s){return Math.round(pipeBySt[s].run);}),backgroundColor:'#1a8a4a',borderRadius:6,maxBarThickness:60}
      ]
    },
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{boxWidth:12,boxHeight:12,padding:14,font:CHART_DEFAULTS.font,color:'#374151'}},tooltip:Object.assign({},CHART_DEFAULTS.tooltip,{callbacks:{label:function(c){return c.dataset.label+' : '+fE(c.raw);}}})},scales:{x:{stacked:true,grid:{display:false,drawBorder:false},ticks:{color:'#374151',font:Object.assign({},CHART_DEFAULTS.font,{size:13,weight:'600'})}},y:{stacked:true,ticks:{color:'#9aa0a6',font:CHART_DEFAULTS.font,callback:function(v){return v>=1000?Math.round(v/1000)+'k':v;}},grid:{color:CHART_DEFAULTS.gridSoft,drawBorder:false},beginAtZero:true}}}
  });
  document.getElementById('legPipe').innerHTML=statuses.map(function(s){
    return '<span style="color:var(--text2);">'+s+' : <b>'+pipeBySt[s].nb+'</b> deal'+(pipeBySt[s].nb>1?'s':'')+' · nominal '+fE(pipeBySt[s].nom)+'</span>';
  }).join('');

  // ── 8. Devise (donut nominal en EUR) — audit fix : convert chaque devise via d.fx
  // pour que GBP/CHF/JPY soient aussi correctement affichés. d.fx = native_per_EUR.
  var byDev={};
  data.forEach(function(d){
    var dev=d.dev||'EUR';
    var eurEq=dev==='EUR'?(d.nom||0):((d.nom||0)/(d.fx||1));
    byDev[dev]=(byDev[dev]||0)+eurEq;
  });
  var devKeys=Object.keys(byDev).sort();
  var devPalette={EUR:'#6b4fc4',USD:'#b07a10',GBP:'#1d5fd4',CHF:'#dc2626',JPY:'#0ea5e9'};
  var devColors=devKeys.map(function(k){return devPalette[k]||'#888';});
  if(charts.dv)charts.dv.destroy();
  charts.dv=new Chart(document.getElementById('cDev'),{type:'doughnut',data:{labels:devKeys,datasets:[{data:devKeys.map(function(k){return Math.round(byDev[k]);}),backgroundColor:devColors,borderWidth:2,borderColor:'#fff',hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{display:false},tooltip:Object.assign({},CHART_DEFAULTS.tooltip,{callbacks:{label:function(c){return c.label+' (eq. EUR) : '+f0(c.raw);}}})}}});
  document.getElementById('legDev').innerHTML=devKeys.map(function(k,i){return legendChip(devColors[i],k,f0(byDev[k]));}).join('');
}

// KPIs Pilotage : UF / Running / Perf fees / CA total
function renderPilotageKpis(){
  var el=document.getElementById('pilKpis');if(!el)return;
  var year=String(new Date().getFullYear());
  var t=computeYearTotals(year);
  function card(label,value,sub,color){
    return '<div class="card" style="padding:16px 18px;border-top:3px solid '+color+';">'+
      '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;">'+label+'</div>'+
      '<div style="font-size:24px;font-weight:600;color:var(--text);margin-top:6px;letter-spacing:-.4px;">'+value+'</div>'+
      '<div style="font-size:11px;color:var(--text2);margin-top:4px;">'+sub+'</div>'+
    '</div>';
  }
  el.innerHTML=
    card('UF payés '+year,fE(t.uf),t.ufNb+' facture'+(t.ufNb!==1?'s':'')+' codifiées','#1d5fd4')+
    card('Running payés '+year,fE(t.run),t.runNbFourn+' fournisseur'+(t.runNbFourn!==1?'s':''),'#1a8a4a')+
    card('Perf fees '+year,fE(t.pf),t.pfNb+' deal'+(t.pfNb!==1?'s':''),'#6b4fc4')+
    '<div class="card" style="background:linear-gradient(135deg,#1a3a6b 0%,#1d5fd4 100%);color:#fff;border:none;padding:16px 18px;display:flex;flex-direction:column;justify-content:center;">'+
      '<div style="font-size:11px;color:rgba(255,255,255,0.75);text-transform:uppercase;letter-spacing:.5px;">CA total '+year+'</div>'+
      '<div style="font-size:26px;font-weight:700;color:#fff;margin-top:6px;letter-spacing:-.5px;">'+fE(t.ca)+'</div>'+
      '<div style="font-size:11px;color:rgba(255,255,255,.75);margin-top:4px;">UF + Running + Perf fees</div>'+
    '</div>';
}

function fournOptHtml(selected){
  var list=loadFourn().slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
  var families=['SDG','Banque','Assureur'],labels={SDG:'Sociétés de gestion',Banque:'Banques',Assureur:'Assureurs'};
  var html='<option value="">— Choisir —</option>';
  families.forEach(function(fam){var items=list.filter(function(f){return f.famille===fam;});if(!items.length)return;html+='<optgroup label="'+escH(labels[fam])+'">'+items.map(function(f){return '<option value="'+escH(f.name)+'"'+(f.name===(selected||'')?' selected':'')+'>'+escH(f.name)+'</option>';}).join('')+'</optgroup>';});
  return html;
}
function brokerOptHtml(selected){
  var list=brokers_db.slice().sort(function(a,b){return a.name.localeCompare(b.name,undefined,{sensitivity:'base'});}).map(function(b){return b.name;});
  return '<option value="">— Aucun —</option>'+list.map(function(b){return '<option value="'+escH(b)+'"'+(b===(selected||'')?' selected':'')+'>'+escH(b)+'</option>';}).join('');
}
var PRODUIT_TYPES=['Action','Obligation','Produit Structuré','Private Equity','UCITS / OPCVM','Fonds Alternatif','ETF','Immobilier','Autre'];
function produitTypeOptHtml(selected){
  return '<option value="">— Choisir —</option>'+PRODUIT_TYPES.map(function(t){return '<option'+(t===(selected||'')?' selected':'')+'>'+t+'</option>';}).join('');
}
// Closed set of fee kinds — aligned with the deal-level cycle vocabulary
// (deal.ct ∈ UF | RUN | BOTH | PF) AND the Facturation page tabs
// (Up-Front / Running / Perf fees). Single source of truth used in every "type
// de frais" select (fournisseur product line, deal custom fee row, arbitrage
// product picker). Keeps display & matching consistent across the app — no
// casing drift, no typos, no orphan fee strings.
//
// Semantics:
//   UF      → fee charged once up-front at closing       → drives deal.ufR
//   Run     → fee charged annually (running, prorata trim) → drives deal.runR
//   UF+Run  → same percentage applies to BOTH cycles      → drives ufR AND runR
//             (shortcut for products with identical up-front and running rates;
//              for differing rates, add 2 separate rows — one UF, one Run)
//
// IMPORTANT — stored values vs displayed labels:
//   - Stored value: 'UF' | 'Run' | 'UF+Run'  (legacy data compatibility, never changed)
//   - Displayed label: 'Up-Front' | 'Running' | 'Up-Front + Running'  (matches
//     the Facturation page tabs Oscar sees — vocabulary alignment).
// Perf fees are a separate concept with their own params (rate, hurdle, freq, mode)
// and live in a dedicated section of the product card / deal modal (`pf` field),
// not in this dropdown.
// ═══════════════════════════════════════════════════════════════════════════
// FEE CALCULATION REFERENCE — source of truth for "how is each fee billed?"
// ═══════════════════════════════════════════════════════════════════════════
//
// Three fee types map 1:1 to the three Facturation page tabs (Up-Front, Running,
// Perf fees). Each has its own calculation, billing cadence and data dependencies.
//
// ┌──────────────┬───────────────────────────────────────────────────────────────┐
// │ UP-FRONT     │ Formula : codif.nominal × codif.ufR / 100                     │
// │   ↳ ufE      │ Cadence : ONE-SHOT at closing (signature of the deal)         │
// │              │ Source  : codifEffectiveUfE(codif, deal)                      │
// │              │ Storage : rapprochement_db row { type:'uf',  fourn, period }  │
// │              │ Note    : nominal here = INITIAL (not currentNominal) — the   │
// │              │           up-front is charged once, never re-billed.          │
// ├──────────────┼───────────────────────────────────────────────────────────────┤
// │ RUNNING      │ Annual  : codif.nominal × codif.runR / 100  (runR is /an)     │
// │   ↳ runE     │ Per trim: annual_runE × (days_in_trim / 365)                  │
// │              │ Cadence : 4 invoices per year (T1, T2, T3, T4)                │
// │              │ Source  : calcRunProrataTrim(entry, trimDates)                │
// │              │ Storage : rapprochement_db row { type:'run', fourn, period:   │
// │              │           'T1_2026' etc, declared, facture, paid }            │
// │              │ Adjusts : uses codifCurrentNominal(codif, deal) for forward   │
// │              │           trims — so retraits/arbitrages reduce future bills. │
// │              │ Known gap : retrait mid-trim under-bills that one trim slightly│
// │              │             (we use end-of-trim nominal) — refine in Phase D.5│
// ├──────────────┼───────────────────────────────────────────────────────────────┤
// │ PERF FEES    │ Inputs  : VL history imported from Excel (vlHistory on the    │
// │   ↳ pf       │           product) gives gross perf % = (vl1-vl0)/vl0 × 100   │
// │              │ Pct mode: fee = nominal × (perf% - hurdle%) × rate% / 10000   │
// │              │           — only triggers when perf% > hurdle%                │
// │              │ Fixed   : fee = pf.amount when perf% > hurdle% else 0         │
// │              │ Cadence : per pf.freq (annuel/cloture/valorisation/variable)  │
// │              │ Source  : _computePerfFees(fournName, isin, vl0, vl1)         │
// │              │ Storage : rapprochement_db row { type:'pf', fourn, period }   │
// │              │ Display : "Suivi Perf" page shows computed perf fees per      │
// │              │           product. Facturation Perf fees tab lists deals      │
// │              │           with pf.amount > 0 ready to invoice.                │
// └──────────────┴───────────────────────────────────────────────────────────────┘
//
// Storage shape on a product (catalogue level — set on the fournisseur, copied
// into the deal codification on save):
//   product = {
//     isin, part, type, unit, currency,
//     fees: [ { kind: 'UF'|'Run'|'UF+Run', pct: number } ],
//     pf:   { mode: 'none'|'pct'|'fixed',
//             rate?:   number,   // %  (pct mode)
//             hurdle?: number,   // %  (both pct and fixed)
//             amount?: number,   // €  (fixed mode)
//             freq?: 'annuel'|'cloture'|'valorisation'|'variable' }
//   }
//
// Storage shape on a codification (deal level):
//   codification = {
//     fourn, produit, type, isin, nominal, currency, billingMode,
//     feeSnapshot: [...fees from product...],   // Snapshotted at deal creation
//     ct: 'UF'|'RUN'|'BOTH',                    // Phase D.1
//     ufR, runR,                                // Derived from feeSnapshot
//     ufE, runE,                                // = nominal × rate/100
//     pf: { ...copied from product.pf... }      // Phase E.3
//   }
//
// Phase A.3 / E.3 — Auto-fill chain on product pick :
//   user picks ISIN → onDealIsinChange()
//     → fees auto-fill contract-level ufR/runR/ct (via _autofillContractRatesFromFees)
//     → pf  auto-fills the deal-fourn-block's dfPfBlock (via _autofillDealPfFromProductPf)
//   On save → codifications enriched (_enrichCodifWithRates) → persisted on the deal.
// ═══════════════════════════════════════════════════════════════════════════

var FEE_TYPES=[
  {value:'UF',      label:'Up-Front'},
  {value:'Run',     label:'Running'},
  {value:'UF+Run',  label:'Up-Front + Running'}
];
function feeKindOptHtml(selected){
  var sel=(selected||'').trim().toLowerCase();
  return '<option value="">— Type —</option>'+FEE_TYPES.map(function(t){
    return '<option value="'+t.value+'"'+(t.value.toLowerCase()===sel?' selected':'')+'>'+t.label+'</option>';
  }).join('');
}
// Translate a fee row's kind to which cycle(s) the percentage applies to.
// Returns {uf:boolean, run:boolean}. Used by the deal-level auto-fill that
// computes ufR/runR from the picked product's fees array.
//
// Backward compatibility (Phase F.4) — deals saved before the Phase A.1 rename
// stored kinds like "Gestion" / "Surperformance" / "Entrée". We map them to
// the closest cycle equivalent so legacy data keeps computing instead of
// silently falling back to ct='UF' / ufR=runR=0.
//   "Gestion"        → Run    (management fee, billed annually)
//   "Entrée"         → UF     (entry fee, one-shot at signature)
//   "Surperformance" → no UF/Run mapping (it's a perf concept — should be in
//                      product.pf, not in fees[]). Returns {uf:false,run:false}
//                      so it doesn't pollute the cycle rates. F.3 re-sync from
//                      catalogue is the right path to clean these up.
function feeKindCycles(kind){
  var k=(kind||'').trim().toLowerCase();
  // Current vocabulary (Phase A.1+)
  if(k==='uf' || k==='up-front' || k==='upfront' || k==='up front')return {uf:true,run:false};
  if(k==='run' || k==='running')return {uf:false,run:true};
  if(k==='uf+run' || k==='ufrun' || k==='both' || k==='les deux' || k==='up-front + running' || k==='upfront+running')return {uf:true,run:true};
  // Legacy vocabulary (pre-A.1) — kept as aliases for unmigrated deals.
  if(k==='gestion')return {uf:false,run:true};   // management fee = Running
  if(k==='entrée' || k==='entree')return {uf:true,run:false}; // entry fee = UF
  // 'surperformance' intentionally not mapped — it's a perf concept, doesn't fit UF/Run.
  return {uf:false,run:false}; // unknown — don't auto-fill
}
// Product types that carry a maturity date. Others (Action, ETF, UCITS…) don't —
// hiding the field on those types cuts visual noise in the deal modal.
var TYPES_WITH_MATURITY=['Obligation','Produit Structuré'];
function typeHasMaturity(t){return TYPES_WITH_MATURITY.indexOf(t||'')!==-1;}
// ── Phase 1B — Codif line cascade Fournisseur → ISIN (datalist) + fee snapshot
var _codifLineCounter=0;
function _isinDatalistInnerHtml(fournName){
  var products=getFournProducts(fournName);
  if(!products.length)return '';
  return products.map(function(p){
    var unitLbl=p.unit==='share'?'Share':'Part';
    var label=[unitLbl+': '+(p.part||''),p.currency||''].filter(Boolean).join(' · ');
    return '<option value="'+escH(p.isin||'')+'">'+escH(label)+'</option>';
  }).join('');
}
// Produit/Support datalist — same idea as the ISIN one but keyed on the part label.
// Lets the user type "A acc" and see real matches from the fournisseur's catalogue
// instead of inventing a new spelling each time.
function _prodDatalistInnerHtml(fournName){
  var products=getFournProducts(fournName);
  if(!products.length)return '';
  var seen={};
  return products.map(function(p){
    var part=(p.part||'').trim();
    if(!part||seen[part])return '';
    seen[part]=1;
    var hint=[p.isin,p.currency].filter(Boolean).join(' · ');
    return '<option value="'+escH(part)+'">'+escH(hint)+'</option>';
  }).filter(Boolean).join('');
}
// Catalog picker — used in the FRAIS block when mode=auto & fournisseur has products.
// One option per ISIN, with the full descriptor : ISIN · Part/Share label · fees summary.
function _renderAutoPickerOptions(fournName,currentIsin){
  var prods=getFournProducts(fournName);
  if(!prods.length)return '<option value="">— Pas de produits dans le catalogue —</option>';
  var opts='<option value="">— Choisir un produit du catalogue —</option>';
  prods.forEach(function(p){
    var unitLbl=p.unit==='share'?'Share':'Part';
    var feesSummary=(p.fees&&p.fees.length)
      ? p.fees.map(function(f){
          // Phase F.2 — show both rates on UF+Run if runPct is set.
          if(f.kind==='UF+Run' && f.runPct!=null && f.runPct!=='') return 'UF '+f.pct+'% / Run '+f.runPct+'%';
          return f.kind+' '+(f.pct||0)+'%';
        }).join(' · ')
      : '(aucun frais)';
    var label=p.isin+' · '+unitLbl+': '+(p.part||'(sans nom)')+' · '+feesSummary;
    opts+='<option value="'+escH(p.isin||'')+'"'+(p.isin===currentIsin?' selected':'')+'>'+escH(label)+'</option>';
  });
  return opts;
}
function _onDfAutoPickerChange(sel){
  var fournBlock=sel.closest('.deal-fourn-block');
  if(!fournBlock)return;
  var newIsin=sel.value;
  if(!newIsin)return;
  var isinInput=fournBlock.querySelector('.dfISIN');
  if(isinInput){isinInput.value=newIsin;onDealIsinChange(isinInput);}
}
function _renderFeeSnapshotInline(fees){
  if(!fees||!fees.length)return '';
  return 'Frais produit : '+fees.map(function(f){
    var pct=(f.pct||f.pct===0)?f.pct+'%':'—';
    // Phase F.2 — UF+Run rows can carry separate ufPct (= f.pct) and runPct.
    // Render as "UF+Run UF2% / Run1.5%" when both are present; fallback to
    // single "% only" for legacy data or single-cycle rows.
    if(f.kind==='UF+Run' && f.runPct!=null && f.runPct!==''){
      pct='UF '+f.pct+'% / Run '+f.runPct+'%';
    }
    return '<b>'+escH(f.kind||'?')+'</b> '+escH(pct);
  }).join(' · ');
}
function onCodifFournChange(sel){
  var row=sel.closest('.codif-line');
  if(!row)return;
  var fournName=sel.value;
  // Rebuild datalist options for the ISIN field of THIS row
  var listId=row.dataset.isinListId;
  var dl=row.querySelector('datalist#'+listId);
  if(dl)dl.innerHTML=_isinDatalistInnerHtml(fournName);
  // Re-evaluate fee snapshot for currently-typed ISIN (might no longer match the new fourn)
  var isinInput=row.querySelector('.codifISIN');
  if(isinInput)onCodifIsinChange(isinInput);
}
function onCodifIsinChange(input){
  var row=input.closest('.codif-line');
  if(!row)return;
  var fournSel=row.querySelector('.codifFourn');
  var fournName=fournSel?fournSel.value:'';
  var isin=(input.value||'').trim();
  var product=getFournProductByIsin(fournName,isin);
  var fees=product?(product.fees||[]):[];
  // Persist snapshot on the row (read back in getCodifLines)
  row.dataset.feeSnapshot=JSON.stringify(fees);
  var snap=row.querySelector('.codif-snapshot');
  if(snap){
    var html=_renderFeeSnapshotInline(fees);
    snap.innerHTML=html;
    snap.style.display=html?'':'none';
  }
  // Auto-fill from product (Produit + Currency) — only if user hasn't set them
  if(product){
    var prodInput=row.querySelector('.codifProduit');
    if(prodInput&&!prodInput.value&&product.part)prodInput.value=product.part;
    var curSel=row.querySelector('.codifCurrency');
    if(curSel&&product.currency&&curSel.dataset.userSet!=='true')curSel.value=product.currency;
  }
  // Phase 2: cascade to Σ indicator
  if(typeof _updateCodifSum==='function')_updateCodifSum();
}

// ── Phase 2 — Assureur/Banque/Nominal/Currency per codif line + Σ indicator
function assureurSelectHTML(selected){
  var items=fourn_db.filter(function(f){return f.famille==='Assureur';}).sort(function(a,b){return a.name.localeCompare(b.name);});
  return '<option value="">— Assureur —</option>'+items.map(function(f){return '<option value="'+escH(f.name)+'"'+(f.name===selected?' selected':'')+'>'+escH(f.name)+'</option>';}).join('');
}
function banqueSelectHTML(selected){
  var items=fourn_db.filter(function(f){return f.famille==='Banque';}).sort(function(a,b){return a.name.localeCompare(b.name);});
  return '<option value="">— Banque —</option>'+items.map(function(f){return '<option value="'+escH(f.name)+'"'+(f.name===selected?' selected':'')+'>'+escH(f.name)+'</option>';}).join('');
}
// Phase J.2 — only EUR + USD supported for NEW codifs (per Oscar 2026-05-15).
// To re-add others, append back to this list — currencySelectHTML reads from it.
var CODIF_CURRENCIES=['EUR','USD'];
// Legacy guard (Oscar 2026-05-18) — if a codif already carries a currency
// outside CODIF_CURRENCIES (older deals predating Phase J.2: GBP/CHF/JPY/…),
// prepend it to the option list so the editor preserves the real currency
// instead of silently collapsing to EUR. New codifs only see EUR + USD.
function currencySelectHTML(selected){
  var list=CODIF_CURRENCIES.slice();
  if(selected && list.indexOf(selected)<0) list.unshift(selected);
  return list.map(function(c){return '<option'+(c===(selected||'EUR')?' selected':'')+'>'+c+'</option>';}).join('');
}
function _curSymbol(c){return c==='EUR'?'€':c==='USD'?'$':c==='GBP'?'£':c==='JPY'?'¥':c==='CHF'?'Fr':c;}
function _updateCodifSum(){
  var indicator=document.getElementById('codifSumIndicator');
  if(!indicator)return;
  // Σ codif nominals grouped by currency
  var byCurrency={};
  document.querySelectorAll('#codifLines .codif-line').forEach(function(row){
    var nomInput=row.querySelector('.codifNominal');
    var curSel=row.querySelector('.codifCurrency');
    if(!nomInput||!curSel)return;
    var n=parseFloat(nomInput.value);
    if(isNaN(n)||n<=0)return;
    var c=curSel.value||'EUR';
    byCurrency[c]=(byCurrency[c]||0)+n;
  });
  // Deal total = Σ client-line nominals (in deal currency mDev)
  var dealTotal=0;
  document.querySelectorAll('.mNomSel').forEach(function(s){dealTotal+=parseFloat(s.value)||0;});
  var dealCurEl=document.getElementById('mDev');
  var dealCur=dealCurEl?dealCurEl.value:'EUR';
  var keys=Object.keys(byCurrency);
  if(!keys.length&&!dealTotal){indicator.style.display='none';return;}
  // Compose the line
  var sumPart=keys.length?'<b>Σ codifs</b> : '+keys.map(function(c){return f0(byCurrency[c])+' '+_curSymbol(c);}).join(' + '):'<b>Σ codifs</b> : —';
  var totalPart='<b>Total clients</b> : '+f0(dealTotal)+' '+_curSymbol(dealCur);
  var warning='';
  if(keys.length===1&&keys[0]===dealCur&&dealTotal){
    var diff=byCurrency[dealCur]-dealTotal;
    if(Math.abs(diff)<0.5)warning=' <span style="color:var(--green);">✓ équilibré</span>';
    else warning=' <span style="color:var(--red);">⚠ écart '+f0(Math.abs(diff))+' '+_curSymbol(dealCur)+'</span>';
  } else if(keys.length>1){
    warning=' <span style="color:var(--amber);">(devises mixtes — FX requis pour comparer)</span>';
  } else if(keys.length===1&&dealTotal&&keys[0]!==dealCur){
    warning=' <span style="color:var(--amber);">(codif en '+_curSymbol(keys[0])+', total en '+_curSymbol(dealCur)+' — FX requis)</span>';
  }
  indicator.innerHTML=sumPart+' &nbsp;·&nbsp; '+totalPart+warning;
  indicator.style.display='';
}
function addCodifLine(codif){
  codif=Object.assign({fourn:'',produit:'',type:'',isin:'',broker:'',maturite:'',feeSnapshot:[],assureur:'',banque:'',nominal:'',currency:''},codif||{});
  // Default currency for fresh lines = deal-level mDev (so single-currency case is no-friction)
  if(!codif.currency){
    var mDevEl=document.getElementById('mDev');
    codif.currency=(mDevEl&&mDevEl.value)||'EUR';
  }
  var container=document.getElementById('codifLines');
  var listId='codifIsinList-'+(++_codifLineCounter);
  var row=document.createElement('div');
  row.className='codif-line';
  row.style.cssText='margin-bottom:8px;padding-bottom:6px;border-bottom:1px dashed var(--border);';
  row.dataset.isinListId=listId;
  row.dataset.feeSnapshot=JSON.stringify(codif.feeSnapshot||[]);
  row.innerHTML=
    // Row 1 — existing fields (Fournisseur SDG, Produit, Type, ISIN, Broker, Maturité, ×)
    '<div style="display:grid;grid-template-columns:1.3fr 1.3fr 130px 100px 1fr 120px 28px;gap:6px;align-items:center;">'+
      '<select class="codifFourn" onchange="onCodifFournChange(this)">'+fournOptHtml(codif.fourn)+'</select>'+
      '<input type="text" class="codifProduit" value="'+(codif.produit||'')+'" placeholder="Produit / Support"/>'+
      '<select class="codifType">'+produitTypeOptHtml(codif.type)+'</select>'+
      '<input list="'+listId+'" type="text" class="codifISIN" value="'+(codif.isin||'')+'" placeholder="ISIN" style="font-family:monospace;font-size:11px;" onchange="onCodifIsinChange(this)" oninput="onCodifIsinChange(this)"/>'+
      '<select class="codifBroker">'+brokerOptHtml(codif.broker)+'</select>'+
      '<input type="date" class="codifMaturite" value="'+(codif.maturite||'')+'"/>'+
      '<button type="button" onclick="removeCodifLine(this)" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:18px;padding:0;line-height:1;">×</button>'+
    '</div>'+
    // Row 2 — Phase 2 new fields (Assureur, Banque, Nominal, Currency)
    '<div style="display:grid;grid-template-columns:1.3fr 1.3fr 130px 100px 1fr 120px 28px;gap:6px;align-items:center;margin-top:4px;">'+
      '<select class="codifAssureur" onchange="_updateCodifSum()">'+assureurSelectHTML(codif.assureur)+'</select>'+
      '<select class="codifBanque" onchange="_updateCodifSum()">'+banqueSelectHTML(codif.banque)+'</select>'+
      '<input type="number" class="codifNominal" value="'+(codif.nominal||'')+'" placeholder="Nominal" step="0.01" min="0" oninput="_updateCodifSum()"/>'+
      '<select class="codifCurrency" onchange="this.dataset.userSet=\'true\';_updateCodifSum();">'+currencySelectHTML(codif.currency)+'</select>'+
      '<span></span><span></span><span></span>'+
    '</div>'+
    // Datalist (ISIN suggestions) + Fee snapshot inline display
    '<datalist id="'+listId+'">'+_isinDatalistInnerHtml(codif.fourn||'')+'</datalist>'+
    '<div class="codif-snapshot" style="font-size:10px;color:var(--text2);padding-left:4px;margin-top:4px;display:none;"></div>';
  container.appendChild(row);
  // Mark currency as "user-set" if the codif came in with an explicit currency (edit mode)
  if(codif.currency&&codif.currency!=='EUR'){
    var curSel=row.querySelector('.codifCurrency');
    if(curSel)curSel.dataset.userSet='true';
  }
  // Snapshot pattern (Q1A — immutable). On render :
  //  1) If the codif carries a stored snapshot, display it as-is (don't re-derive from
  //     the live product — fees may have changed since deal creation, and the historical
  //     value is what matters).
  //  2) Else if codif has an ISIN (legacy pre-Phase-1B deal), opportunistically derive
  //     the snapshot once from the live catalogue so it shows something useful.
  if(Array.isArray(codif.feeSnapshot)&&codif.feeSnapshot.length){
    var snap=row.querySelector('.codif-snapshot');
    if(snap){snap.innerHTML=_renderFeeSnapshotInline(codif.feeSnapshot);snap.style.display='';}
  } else if(codif.isin){
    var isinInput=row.querySelector('.codifISIN');
    onCodifIsinChange(isinInput);
  }
  if(typeof _updateCodifSum==='function')_updateCodifSum();
}
function removeCodifLine(btn){
  var row=btn.closest('.codif-line');
  if(document.querySelectorAll('#codifLines .codif-line').length>1){
    row.remove();
    if(typeof _updateCodifSum==='function')_updateCodifSum();
  }
}
function renderCodifLines(codifs){
  var c=document.getElementById('codifLines');c.innerHTML='';
  if(!codifs||!codifs.length)codifs=[{fourn:'',produit:'',isin:'',broker:''}];
  codifs.forEach(function(x){addCodifLine(x);});
  if(typeof _updateCodifSum==='function')_updateCodifSum();
}
function getCodifLines(){
  var result=[];
  document.querySelectorAll('#codifLines .codif-line').forEach(function(row){
    var feeSnapshot=[];
    try{feeSnapshot=JSON.parse(row.dataset.feeSnapshot||'[]')||[];}catch(e){feeSnapshot=[];}
    var nomRaw=row.querySelector('.codifNominal');
    var nomVal=nomRaw?parseFloat(nomRaw.value):NaN;
    result.push({
      fourn:row.querySelector('.codifFourn').value,
      produit:row.querySelector('.codifProduit').value,
      type:row.querySelector('.codifType')?row.querySelector('.codifType').value:'',
      isin:row.querySelector('.codifISIN').value,
      broker:row.querySelector('.codifBroker').value,
      maturite:row.querySelector('.codifMaturite').value,
      feeSnapshot:feeSnapshot,
      // Phase 2 fields
      assureur:row.querySelector('.codifAssureur')?row.querySelector('.codifAssureur').value:'',
      banque:row.querySelector('.codifBanque')?row.querySelector('.codifBanque').value:'',
      nominal:isNaN(nomVal)?0:nomVal,
      currency:row.querySelector('.codifCurrency')?row.querySelector('.codifCurrency').value:'EUR'
    });
  });
  return result;
}
// ── Phase 2 v2 — Deal modal opens onto a nested tree (Client → Contrat → Fournisseur)
function openDealModal(idx){
  editIdx=idx!=null?idx:-1;
  rebuildFournSelect();rebuildBrokerSelect();
  document.getElementById('dmTitle').textContent=editIdx>=0?'Modifier le deal':'Nouveau deal';
  // Reset the tree
  var treeContainer=document.getElementById('dealClients');
  treeContainer.innerHTML='';
  // Legacy hidden shims reset (so anything still reading them gets a sane default)
  document.getElementById('mNom').value='';
  document.getElementById('mUFR').value='';
  document.getElementById('mRunR').value='';
  document.getElementById('mDev').value='EUR';
  document.getElementById('mContrat').value='Assurance Vie Lux';
  document.getElementById('mPFRate').value='';
  document.getElementById('mPFHurdle').value='';
  document.getElementById('mPFFixed').value='';
  pfMode='none';
  if(editIdx>=0){
    // EDIT mode — load the existing row + any siblings sharing dealGroupId
    var d=deals[editIdx];
    document.getElementById('mV').value=d.v||'Audrey';
    document.getElementById('mDate').value=d.date||today();
    document.getElementById('mStat').value=d.stat||'Deal pipe';
    document.getElementById('mNotes').value=d.notes||'';
    // Group rows: if dealGroupId set, find siblings; else single-row legacy edit
    var groupRows=[];
    if(d.dealGroupId){
      groupRows=deals.filter(function(x){return x.dealGroupId===d.dealGroupId;});
    } else {
      groupRows=[d];
    }
    // Group by client → for each client, list its contracts (rows)
    var byClient={};
    groupRows.forEach(function(row){
      var c=row.client||'(?)';
      if(!byClient[c])byClient[c]={client:c,contracts:[]};
      byClient[c].contracts.push(_dealRowToContractData(row));
    });
    Object.keys(byClient).forEach(function(c){
      _renderDealClientBlockFromData(byClient[c]);
    });
    // Lock add-client/add-contract buttons in edit mode (keep scope = existing group structure)
    document.getElementById('dealAddClientBtn')&&(document.getElementById('dealAddClientBtn').style.display='none');
  } else {
    // NEW mode — empty tree + first client block pre-added for friction-zero
    document.getElementById('mDate').value=today();
    document.getElementById('mV').value='Audrey';
    document.getElementById('mStat').value='Deal pipe';
    document.getElementById('mNotes').value='';
    var addBtn=document.getElementById('dealAddClientBtn');
    if(addBtn)addBtn.style.display='';
    addDealClientBlock('');
  }
  cancelAddClient();
  rebuildFournSelect();rebuildBrokerSelect();
  document.getElementById('dealModal').classList.add('on');
}
// Convert a saved deal row into the contract-shaped data the tree expects
function _dealRowToContractData(row){
  // Map row-level perf-fees down into the first codification if codifications don't carry per-fourn pf yet
  var codifs=(row.codifications&&row.codifications.length)?row.codifications.slice():[{
    fourn:row.fourn||'',produit:row.produit||'',type:row.produit_type||'',isin:row.isin||'',broker:row.broker||'',
    maturite:row.maturite||row.terme||'',feeSnapshot:[],feesMode:'auto',
    assureur:'',banque:'',nominal:row.nom||0
  }];
  // Default feesMode = 'auto' for legacy codifs that don't carry it
  codifs.forEach(function(c){if(!c.feesMode)c.feesMode=c.feeSnapshot&&c.feeSnapshot.length?'auto':'auto';});
  if(row.pf&&row.pf.mode&&row.pf.mode!=='none'&&codifs.length){
    // Legacy deals had pf at deal level. Promote it to the first codification if that codif has no pf yet.
    if(!codifs[0].pf||!codifs[0].pf.mode||codifs[0].pf.mode==='none')codifs[0].pf=Object.assign({},row.pf);
  }
  return{
    _id:row._id,
    contrat:row.contrat||'Assurance Vie Lux',
    nom:row.nom||0,dev:row.dev||'EUR',depositaire:row.depositaire||'',
    ct:row.ct||'UF',ufR:row.ufR||'',runR:row.runR||'',tva:row.tva||0,
    codifications:codifs
  };
}
function _renderDealClientBlockFromData(clientData){
  var block=addDealClientBlock(clientData.client,/*autoFirstContract*/false);
  // In edit mode, lock add-contract / remove-client too
  if(editIdx>=0){
    var addC=block.querySelector('.btn-add-contract');if(addC)addC.style.display='none';
    var rmC=block.querySelector('.btn-remove-client');if(rmC)rmC.style.display='none';
  }
  clientData.contracts.forEach(function(cd){
    addDealContractBlock(block,cd);
    // In edit mode, lock remove-contract too
    if(editIdx>=0){
      var last=block.querySelectorAll('.deal-contract-block');
      var lastBlock=last[last.length-1];
      var rmBtn=lastBlock&&lastBlock.querySelector('.btn-remove-contract');
      if(rmBtn)rmBtn.style.display='none';
    }
  });
}
function closeDM(){document.getElementById('dealModal').classList.remove('on');editIdx=-1;}
function setCT(t){ct=t;['UF','RUN','BOTH'].forEach(x=>{document.getElementById('ct'+x).classList.remove('on');});document.getElementById('ct'+t).classList.add('on');document.getElementById('ufRow').style.display=(t==='UF'||t==='BOTH')?'grid':'none';document.getElementById('runRow').style.display=(t==='RUN'||t==='BOTH')?'grid':'none';calcM();}

var pfMode='none';
function togglePF(btn){
  pfMode=pfMode==='none'?'pct':'none';
  btn.classList.toggle('on',pfMode!=='none');
  document.getElementById('pfRow').style.display=pfMode!=='none'?'block':'none';
  if(pfMode==='pct')document.getElementById('mPFType').value='pct';
  onPFTypeChange();calcM();
}
function onPFTypeChange(){
  var t=document.getElementById('mPFType').value;
  document.getElementById('pfRateWrap').style.display=t==='pct'?'':'none';
  document.getElementById('pfFixedWrap').style.display=t==='fixed'?'':'none';
  document.getElementById('pfHurdleWrap').style.display=t==='pct'?'':'none';
  calcM();
}

function calcM(){
  // Somme des nominaux saisis par ligne client
  var nomSels=document.querySelectorAll('.mNomSel');
  var nom=0;
  nomSels.forEach(function(s){nom+=parseFloat(s.value)||0;});
  if(!nom)nom=parseFloat(document.getElementById('mNom').value)||0; // fallback global
  var dev=document.getElementById('mDev').value,fx=1,nomE=nom;
  var ufP=(parseFloat(document.getElementById('mUFR').value)||0)/100,runP=(parseFloat(document.getElementById('mRunR').value)||0)/100;
  var ufD=nom*ufP,ufE=dev==='USD'?ufD/fx:ufD,runE=nomE*runP;
  var ht=(ct==='UF'?ufE:0)+(ct==='RUN'?runE:0)+(ct==='BOTH'?ufE+runE:0);
  document.getElementById('csD').textContent=ufP>0&&nom>0?(dev==='USD'?'$':'€')+f0(ufD):'—';
  document.getElementById('csUF').textContent=ufP>0&&nom>0?fE(ufE):'—';
  document.getElementById('csRun').textContent=runP>0&&nom>0?fE(runE)+'/an':'—';
  document.getElementById('csTTC').textContent=nom>0&&(ufP>0||runP>0)?fE(ht):'—';
  // Perf fees summary
  if(pfMode!=='none'){
    var pfType=document.getElementById('mPFType').value;
    var freqLabels={annuel:'Annuelle',cloture:'À la clôture',valorisation:'À chaque valorisation',variable:'Variable'};
    var freq=freqLabels[document.getElementById('mPFFreq').value]||'—';
    if(pfType==='pct'){
      var rate=parseFloat(document.getElementById('mPFRate').value)||0;
      var hurdle=parseFloat(document.getElementById('mPFHurdle').value)||0;
      document.getElementById('pfSummType').textContent=rate>0?rate+'% sur perf':'—';
      document.getElementById('pfSummCond').textContent=hurdle>0?'Hurdle : '+hurdle+'%':'Performance brute';
    } else {
      var fixed=parseFloat(document.getElementById('mPFFixed').value)||0;
      document.getElementById('pfSummType').textContent='Montant fixe';
      document.getElementById('pfSummCond').textContent=fixed>0?fE(fixed):'—';
    }
    document.getElementById('pfSummFreq').textContent=freq;
  }
  // Phase 2 — re-evaluate Σ codifs vs Σ clientLines whenever a deal-level
  // input (client nominals, deal currency, fees) changes
  if(typeof _updateCodifSum==='function')_updateCodifSum();
}

async function saveDeal(){
 try{
  // Walk the nested tree → list of {client, contractData (incl. codifications)} pairs
  var tree=_collectDealTree();
  if(!tree.length){alert('Au moins un client requis.');return;}
  var hasAnyNominal=false;
  tree.forEach(function(pair){if(pair.contractData.nom>0)hasAnyNominal=true;});
  if(!hasAnyNominal){alert('Veuillez saisir un total pour au moins un contrat.');return;}
  var vendor=document.getElementById('mV').value;
  var date=document.getElementById('mDate').value;
  var stat=document.getElementById('mStat').value;
  var notes=document.getElementById('mNotes').value;
  // Phase 3 — Pre-fetch FX rates for every non-EUR contract currency.
  // Each currency is fetched once; the result is reused for all contracts in that currency.
  // FX is snapshotted as-of the trade date (immutable per deal — Q1A pattern, currency edition).
  var fxByDev={};
  for(var ti=0;ti<tree.length;ti++){
    var dev=tree[ti].contractData.dev;
    if(dev&&dev!=='EUR'&&!(dev in fxByDev)){
      fxByDev[dev]=await getFxRate(dev,'EUR',date);
    }
  }
  var fxFailures=Object.keys(fxByDev).filter(function(k){return fxByDev[k]==null;});
  if(fxFailures.length){
    // Phase J.3 — bloquant maintenant (avant juste un toast facile à manquer).
    // Sauver un deal non-EUR avec fx=1 → la conversion EUR est fausse partout
    // (nominaux affichés en EUR = montant native, fees idem). Confirmer explicitement.
    var msg='⚠ Taux de change NON récupéré pour : '+fxFailures.join(', ')+'\n\n'+
            'Possibles causes :\n'+
            '· Connexion internet coupée\n'+
            '· API Frankfurter (BCE) momentanément indispo\n'+
            '· Date trop dans le futur (l\'API a du data jusqu\'à aujourd\'hui réel)\n\n'+
            'Si tu sauves maintenant, le deal sera enregistré avec fx=1 — les conversions EUR seront FAUSSES jusqu\'à ce que tu corriges le fx manuellement (via /sb-fix ou en re-éditant le deal).\n\n'+
            'Annuler maintenant pour réessayer dans 1 min ?';
    if(confirm(msg)){
      // user clicked OK → cancel save, let them retry
      toast('Save annulé — réessaie quand la connexion FX est rétablie.');
      return;
    }
    // else : user clicked Cancel → proceed with fx=1 anyway (= they accept the risk)
    toast('⚠ Sauvegardé avec fx=1 pour '+fxFailures.join(', ')+' — fx à corriger.');
  }
  if(editIdx>=0){
    // EDIT mode — update in-place. Modal is locked to the original group structure
    // (no add/remove client/contract), so we map each rendered contract back to its
    // original deal row by _id.
    var existing=deals[editIdx];
    var groupId=existing.dealGroupId||null;
    for(var i=0;i<tree.length;i++){
      var pair=tree[i];
      var origId=pair.contractData._id;
      if(!origId)continue;
      var origRow=deals.find(function(x){return x._id===origId;});
      if(!origRow)continue;
      var prevHist=Array.isArray(origRow.hist)?origRow.hist:[];
      var rowPayload=_buildDealRowFromContract(pair,vendor,date,stat,notes,groupId,fxByDev);
      rowPayload._id=origId;
      rowPayload.hist=prevHist.concat([{ts:nowS(),a:'Deal modifié',by:vendor}]);
      // Audit fix — preserve workflow / lifecycle fields that the modal doesn't manage,
      // so editing the deal's commercial data doesn't wipe its facturation state,
      // arbitrage links, archive flag, or FX snapshot timestamp.
      rowPayload.fSt=origRow.fSt||'À émettre';
      rowPayload.inv=origRow.inv||'';
      rowPayload.invS=origRow.invS||'';
      rowPayload.fRef=origRow.fRef||'';
      rowPayload.paidAt=origRow.paidAt||null;
      rowPayload.archived=!!origRow.archived;
      rowPayload.arbId=origRow.arbId||null;
      rowPayload.arbSrc=origRow.arbSrc||null;
      rowPayload.arbClosed=!!origRow.arbClosed;
      rowPayload.end=origRow.end||null;
      // Keep FX snapshot date if nothing changed currency-wise on this edit
      if(!rowPayload.fxDate&&origRow.fxDate)rowPayload.fxDate=origRow.fxDate;
      await sbUpdate('deals',origId,rowPayload);
      // Update in-memory
      var idxInDeals=deals.findIndex(function(x){return x._id===origId;});
      if(idxInDeals>=0)deals[idxInDeals]=rowPayload;
      // Audit fix — sync produits in the linked Suivi Contrat : remove orphans,
      // add new fourns, update mutable display fields on existing produits.
      try{await _syncContractProduitsForDealEdit(rowPayload);}catch(syncErr){console.error('Contract produits sync failed',syncErr);}
    }
    closeDM();renderAll();toast('Deal modifié.');
  } else {
    // Phase L.4 (Oscar 2026-05-18) — NEW mode rule: 1 deal = 1 client × 1 produit.
    // SPLIT the collected tree so every codif (= 1 produit) becomes its own deal
    // row + its own dedicated contract. dealGroupId concept dropped (Oscar OK
    // with full rebuild). The duplicate check + insert loop below operate on the
    // SPLIT tree so each codif-deal is independently checked + inserted.
    // Edit mode (above) keeps the legacy multi-codif behaviour — only new
    // creation flips to per-codif.
    var splitTree=[];
    for(var ti=0;ti<tree.length;ti++){
      var origPair=tree[ti];
      var origC=origPair.contractData;
      var origCodifs=(origC.codifications||[]).slice();
      if(origCodifs.length<=1){
        // 0 or 1 codif — pass through unchanged.
        splitTree.push(origPair);
      } else {
        // Multi-codif — explode into one (client × single-codif × dedicated contract) per codif.
        origCodifs.forEach(function(codif){
          var singleC=Object.assign({},origC,{
            codifications:[codif],
            // Override contract-level nominal with this codif's nominal — each
            // split deal's contract total reflects only its own investissement.
            nom:parseFloat(codif.nominal)||0
          });
          splitTree.push({client:origPair.client,contractData:singleC});
        });
      }
    }
    tree=splitTree;
    var groupId=null; // dealGroupId dropped 2026-05-18
    var autoLinked=0;
    // Phase G.4 — anti-doublon : avant d'insérer, on cherche un deal déjà
    // existant qui aurait la même signature (client + contract + first codif's
    // fourn + first codif's ISIN + same nominal total + same trade date). Si
    // match, on demande confirmation à l'utilisateur. Évite les doubles-clics
    // sur Save + les recréations par mégarde.
    // Phase L.3 (Oscar 2026-05-18) — duplicate check uses _dealDuplicateSignature
    // so the inline guard and the retro scanner agree on what 'same' means.
    // Normalisation: trim + case-fold, cents on nominal, ISIN→upper, fallback
    // to produit name when ISIN empty. Adds dev + vendor that were missing
    // in the legacy check (likely root cause of the Ayal Cohen false-neg).
    var duplicates=[];
    for(var j=0;j<tree.length;j++){
      var pair=tree[j];
      var pc=pair.contractData;
      var firstCodif=(pc.codifications&&pc.codifications[0])||{};
      var candidate={
        client:pair.client, contrat:pc.contrat, date:date,
        nom:pc.nom, dev:pc.dev, v:vendor,
        fourn:firstCodif.fourn, isin:firstCodif.isin, produit:firstCodif.produit,
        codifications:pc.codifications
      };
      var candSig=_dealDuplicateSignature(candidate);
      var dup=deals.find(function(x){
        if(x.archived) return false;
        return _dealDuplicateSignature(x)===candSig;
      });
      if(dup)duplicates.push({pair:pair, existing:dup});
    }
    if(duplicates.length){
      var dupSummary=duplicates.map(function(d){
        return '· '+d.pair.client+' / '+(d.pair.contractData.contrat||'?')+' / '+f0(d.pair.contractData.nom||0)+' '+(d.pair.contractData.dev||'EUR')+' au '+date;
      }).join('\n');
      if(!confirm(duplicates.length+' deal'+(duplicates.length>1?'s':'')+' identique'+(duplicates.length>1?'s':'')+' existe'+(duplicates.length>1?'nt':'')+' déjà :\n\n'+dupSummary+'\n\nCréer un duplicate ?')){
        toast('Création annulée — '+duplicates.length+' doublon'+(duplicates.length>1?'s':'')+' détecté'+(duplicates.length>1?'s':'')+'.');
        return;
      }
    }
    // Phase L.5 (Oscar 2026-05-18) — save-to-catalogue prompt. For each
    // codif-deal in the (now split) tree, if its (produit, ISIN) doesn't
    // match any entry in its fournisseur's catalogue, offer to add it on
    // submit. Trigger = deal submit (not blur, per Oscar). Lookup keyed
    // on `fourn` field only (assureur/banque ignored — the product is
    // logged under the fournisseur SDG, where it actually lives).
    var catalogueAdds=[];
    for(var ci=0;ci<tree.length;ci++){
      var cpair=tree[ci];
      var cc=cpair.contractData;
      var codif=(cc.codifications||[])[0];
      if(!codif) continue;
      var fournName=(codif.fourn||'').trim();
      if(!fournName) continue;
      var prodName=(codif.produit||'').trim();
      var prodIsin=(codif.isin||'').trim();
      // Skip if both produit name and ISIN are empty — probably an oversight,
      // not a real new product worth catalogue-ing.
      if(!prodName && !prodIsin) continue;
      var existing=(typeof getFournProducts==='function')?getFournProducts(fournName):[];
      var matchesExisting=existing.some(function(p){
        var pIsin=(p.isin||'').trim().toUpperCase();
        var pPart=(p.part||'').trim().toLowerCase();
        if(prodIsin && pIsin===prodIsin.toUpperCase()) return true;
        if(prodName && pPart===prodName.toLowerCase()) return true;
        return false;
      });
      if(matchesExisting) continue;
      catalogueAdds.push({
        fourn:fournName,
        product:{
          isin:prodIsin,
          part:prodName,
          currency:codif.currency||cc.dev||'EUR',
          type:codif.type||'',
          fees:codif.feeSnapshot||[],
          unit:'part',
          pf:codif.pf||{mode:'none'}
        }
      });
    }
    if(catalogueAdds.length){
      var summary=catalogueAdds.map(function(a){
        return '· '+(a.product.part||'(sans nom)')+(a.product.isin?' — ISIN '+a.product.isin:'')+
               (a.product.fees&&a.product.fees.length?' — '+a.product.fees.length+' tranche(s) de frais':'')+
               ' → catalogue de '+a.fourn;
      }).join('\n');
      var ok=confirm(catalogueAdds.length+' nouveau(x) produit(s) détecté(s) — pas encore au catalogue du fournisseur :\n\n'+summary+'\n\nLes ajouter au catalogue (le produit sera reconnu pour les prochains deals) ?');
      if(ok){
        var addedCount=0;
        for(var ai=0;ai<catalogueAdds.length;ai++){
          var add=catalogueAdds[ai];
          var f=fourn_db.find(function(x){return x.name===add.fourn;});
          if(!f) continue;
          f.products=f.products||[];
          f.products.push(add.product);
          try{
            if(f._id) await sbUpdate('fournisseurs',f._id,f);
            addedCount++;
          }catch(e){console.error('[L.5] catalogue add failed for '+add.fourn,e);}
        }
        if(addedCount) toast(addedCount+' produit(s) ajouté(s) au catalogue.');
      }
    }
    for(var j=0;j<tree.length;j++){
      var rowPayload=_buildDealRowFromContract(tree[j],vendor,date,stat,notes,groupId,fxByDev);
      rowPayload.hist=[{ts:nowS(),a:'Deal créé',by:vendor}];
      var res=await sbInsert('deals',rowPayload);
      if(res&&res[0])rowPayload._id=res[0].id;
      deals.push(rowPayload);
      // Phase K.1 (revised 2026-05-18) — auto-create the contract for new deals
      // EXCEPT when the deal is already settled ('Deal réalisé' or 'Deal payé').
      // Settled deals have nothing left to follow up on, so polluting the
      // contracts page with them adds noise. The status guard lives inside
      // autoLinkDealToContract — see the comment on that function.
      try{await autoLinkDealToContract(rowPayload);autoLinked++;}
      catch(e){console.error('autoLinkDealToContract failed',e);}
    }
    closeDM();renderAll();
    var msg=tree.length>1?tree.length+' deals enregistrés':'Nouveau deal enregistré';
    toast(msg+(autoLinked?' · '+autoLinked+' investissement'+(autoLinked>1?'s':'')+' ajouté'+(autoLinked>1?'s':'')+' au suivi.':'.'));
  }
 }catch(err){
  console.error('saveDeal failed',err);
  alert('Erreur enregistrement deal :\n\n'+(err.message||err)+'\n\n(Voir la console pour le détail.)');
 }
}
function _genGroupId(){
  if(typeof crypto!=='undefined'&&crypto.randomUUID)return 'g_'+crypto.randomUUID();
  return 'g_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
}
function _buildDealRowFromContract(pair,vendor,date,stat,notes,groupId,fxByDev){
  var c=pair.contractData;
  var firstCodif=(c.codifications&&c.codifications[0])||{};
  // Legacy deal-level pf : kept as a no-op marker (per-fourn pf is the source of truth now)
  var legacyPf=(firstCodif.pf&&firstCodif.pf.mode&&firstCodif.pf.mode!=='none')?firstCodif.pf:{mode:'none'};
  var ufP=(parseFloat(c.ufR)||0)/100;
  var runP=(parseFloat(c.runR)||0)/100;
  var nom=parseFloat(c.nom)||0;
  var dev=c.dev||'EUR';
  // FX rate snapshot at trade date (per Q1A immutability) — only relevant for non-EUR contracts.
  // Legacy convention: d.fx = native_per_EUR (e.g. for USD : 1.087 means 1 EUR = 1.087 USD,
  // so d.nom / d.fx = EUR amount). Frankfurter returns the inverse (0.92 for USD→EUR),
  // we invert to preserve compat with every existing renderer (d.nom/(d.fx||1) is used everywhere).
  var fxRate=1,fxDate=null;
  if(dev!=='EUR'){
    var resolved=(fxByDev&&fxByDev[dev]);
    if(resolved!=null&&resolved!==0){fxRate=1/resolved;fxDate=date;}
    // If null → keep fx=1 (the toast in saveDeal already warned the user)
  }
  // EUR-equivalent of the contract total — derived but useful for KPIs that need a single base
  var nomEur=Math.round(nom/fxRate);
  // Phase I.3 — re-enrich codifications NOW that we know the deal's FX, so the
  // EUR-equivalent ufE/runE (legacy fields) reflect the trade-date FX conversion
  // for non-EUR deals. ufE_native / runE_native stay in native currency.
  var dealCtxForFx={dev:dev, fx:fxRate};
  if(c.codifications && c.codifications.length){
    enrichDealCodifications(c.codifications, dealCtxForFx);
  }
  // Phase H.2 — Sum codif-level ufE/runE (already in EUR-equivalent from enrichment)
  // instead of recomputing nom × deal-level rate. This makes the deal row mirror
  // exactly what the catalogue says per codif.
  var sumUfE=0, sumRunE=0, sumUfNative=0, sumRunNative=0;
  (c.codifications||[]).forEach(function(cd){
    sumUfE+=cd.ufE||0;
    sumRunE+=cd.runE||0;
    sumUfNative  += cd.ufE_native  || 0;
    sumRunNative += cd.runE_native || 0;
  });
  // Fallback : if codif enrichment didn't run (legacy data), use nom × rate.
  if(sumUfE===0 && ufP>0)   sumUfE   = Math.round(nomEur*ufP);
  if(sumRunE===0 && runP>0) sumRunE  = Math.round(nomEur*runP);
  if(sumUfNative===0 && ufP>0)  sumUfNative  = Math.round(nom*ufP*100)/100;
  if(sumRunNative===0 && runP>0)sumRunNative = Math.round(nom*runP*100)/100;
  return{
    v:vendor,date:date,stat:stat,
    client:pair.client,contrat:c.contrat||'Assurance Vie Lux',
    depositaire:c.depositaire||'',
    fourn:firstCodif.fourn||'',produit:firstCodif.produit||'',produit_type:firstCodif.type||null,
    isin:firstCodif.isin||'',broker:firstCodif.broker||'',
    maturite:firstCodif.maturite||null,terme:firstCodif.maturite||null,
    codifications:c.codifications||[],
    nom:nom,dev:dev,fx:fxRate,
    fxDate:fxDate,
    issue:'',invS:'',inv:'',
    ct:c.ct||'UF',ufR:parseFloat(c.ufR)||0,runR:parseFloat(c.runR)||0,tva:parseFloat(c.tva)||0,
    // EUR-equivalents at trade-date FX (legacy fields, used by KPIs that don't yet
    // do per-event FX). For non-EUR deals, billing pages should prefer ufE_native /
    // runE_native at the CODIFICATION level (inside the codifications JSONB blob)
    // + fxToEurAtDate() for the most accurate billing-time conversion.
    // NOTE — we deliberately don't put ufE_native / runE_native on the top-level
    // deal because (a) they're derivable from codifs, (b) they'd need DB columns,
    // (c) the codif-level native fields are the source of truth for billing.
    ufE:sumUfE, runE:sumRunE,
    pf:legacyPf,
    fSt:'À émettre',fRef:'',
    notes:notes||'',
    dealGroupId:groupId||null
  };
}
function _collectDealTree(){
  var pairs=[];
  document.querySelectorAll('#dealClients .deal-client-block').forEach(function(cb){
    var clientSel=cb.querySelector('.dealClientSel');
    var clientName=clientSel?clientSel.value:'';
    if(!clientName)return;
    cb.querySelectorAll('.deal-contract-block').forEach(function(ctb){
      var contractData=_collectContractBlock(ctb);
      pairs.push({client:clientName,contractData:contractData});
    });
  });
  return pairs;
}
function _collectContractBlock(ctb){
  var contrat=ctb.querySelector('.contractType').value;
  var nom=parseFloat(ctb.querySelector('.contractTotal').value)||0;
  var dev=ctb.querySelector('.contractDev').value;
  var depo=ctb.querySelector('.contractDepo').value;
  // Commission structure may be hidden (collapsed) — query may return null; default sensibly.
  var ctEl=ctb.querySelector('.contractCT');
  var ufREl=ctb.querySelector('.contractUFR');
  var runREl=ctb.querySelector('.contractRunR');
  var tvaEl=ctb.querySelector('.contractTVA');
  var commVisible=ctb.querySelector('.contract-commission')&&ctb.querySelector('.contract-commission').style.display!=='none';
  var ct=commVisible&&ctEl?ctEl.value:'UF';
  var ufR=commVisible?parseFloat(ufREl.value)||0:0;
  var runR=commVisible?parseFloat(runREl.value)||0:0;
  var tva=commVisible?parseFloat(tvaEl.value)||0:0;
  var codifications=[];
  ctb.querySelectorAll('.deal-fourn-block').forEach(function(fb){
    // Fees: depends on mode
    var feesModeEl=fb.querySelector('.dfFeesMode');
    var feesMode=feesModeEl?feesModeEl.value:'auto';
    var feeSnapshot=[];
    if(feesMode==='custom'){
      feeSnapshot=_readDfCustomFees(fb);
    } else if(feesMode==='auto'){
      try{feeSnapshot=JSON.parse(fb.dataset.feeSnapshot||'[]')||[];}catch(e){feeSnapshot=[];}
    } else /* none */ {feeSnapshot=[];}
    var nominal=parseFloat(fb.querySelector('.dfNominal').value)||0;
    var pfMode=fb.querySelector('.dfPfMode').value;
    var pf={mode:pfMode};
    if(pfMode==='pct'){
      pf.type='pct';
      pf.rate=parseFloat(fb.querySelector('.dfPfRate').value)||0;
      pf.hurdle=parseFloat(fb.querySelector('.dfPfHurdle').value)||0;
      pf.freq=fb.querySelector('.dfPfFreq').value||'annuel';
    } else if(pfMode==='fixed'){
      pf.type='fixed';
      pf.amount=parseFloat(fb.querySelector('.dfPfFixed').value)||0;
      pf.freq=fb.querySelector('.dfPfFreq').value||'annuel';
    }
    var billingModeEl=fb.querySelector('.dfBillingMode');
    var billingMode=billingModeEl?billingModeEl.value:'fast';
    codifications.push({
      fourn:fb.querySelector('.dfFourn').value,
      produit:fb.querySelector('.dfProduit').value,
      type:fb.querySelector('.dfType').value,
      isin:fb.querySelector('.dfISIN').value,
      broker:fb.querySelector('.dfBroker').value,
      maturite:fb.querySelector('.dfMaturite').value,
      feeSnapshot:feeSnapshot,
      feesMode:feesMode,
      assureur:fb.querySelector('.dfAssureur').value,
      // A1 — Banque UI removed 2026-05-18; keep '' for DB back-compat.
      banque:'',
      nominal:nominal,
      currency:dev, // Per Oscar : currency lives at contract level only
      billingMode:billingMode, // Batch A.3 — fast | feed
      pf:pf
    });
  });
  // Phase D.1 — enrich every codification with its own ct/ufR/runR/ufE/runE
  // derived from its feeSnapshot. Billing pages will iter on these per-codif
  // fields, so we persist them at save time. Deal-level ct/ufR/runR is kept
  // for backward compat + KPIs that still need a single contract aggregate.
  // NOTE — no `deal` arg here because FX isn't resolved yet at this point in
  // the flow (saveDeal fetches it AFTER tree collection). For non-EUR deals
  // this pass writes ufE/runE as if EUR; _buildDealRowFromContract then re-runs
  // enrichDealCodifications with the resolved {dev, fx} context so the persisted
  // codifs carry the correct EUR-equivalent. The signature mismatch is therefore
  // intentional — search 'Phase I.3' in this file for the re-enrichment path.
  enrichDealCodifications(codifications);
  // Phase H.2 — derive deal-level aggregates from the codif sums, OVERRIDING
  // whatever the user typed at contract level. The codifs are the source of
  // truth (= fees come from product catalogue); the contract-level fields
  // become a computed snapshot. If user typed manual contract rates AND has
  // codifs, the codifs win (= the auto-calc reflects what's actually billed).
  var derived={ct:ct,ufR:ufR,runR:runR}; // start from user-typed values
  if(codifications.length){
    var sumUfE=0, sumRunE=0, sumNomUf=0, sumNomRun=0, wUfR=0, wRunR=0;
    var hasUf=false, hasRun=false;
    codifications.forEach(function(c){
      var nm=parseFloat(c.nominal)||0;
      sumUfE += c.ufE||0;
      sumRunE+= c.runE||0;
      if((c.ufR||0)>0){ wUfR += (c.ufR||0)*nm; sumNomUf += nm; hasUf=true; }
      if((c.runR||0)>0){wRunR+= (c.runR||0)*nm; sumNomRun+= nm; hasRun=true; }
      if(c.ct==='BOTH'){hasUf=true; hasRun=true;}
    });
    derived.ufR  = sumNomUf >0 ? Math.round(wUfR /sumNomUf *10000)/10000 : 0;
    derived.runR = sumNomRun>0 ? Math.round(wRunR/sumNomRun*10000)/10000 : 0;
    derived.ct   = (hasUf&&hasRun) ? 'BOTH' : hasRun ? 'RUN' : hasUf ? 'UF' : ct;
  }
  return{
    _id:ctb.dataset.origDealId||null,
    contrat:contrat,nom:nom,dev:dev,depositaire:depo,
    ct:derived.ct, ufR:derived.ufR, runR:derived.runR, tva:tva,
    codifications:codifications
  };
}

// ── Phase 2 v2 — Render helpers for the nested deal tree ────────────────────
function showAddClientPickerForDeal(){
  // Simple — add a new empty client block. User picks from the dropdown inside.
  // The "+ nouveau client" path is handled via addClientRow (newClientInput) which
  // appends to clients_db, then we refresh all .dealClientSel.
  addDealClientBlock('');
}
function addDealClientBlock(clientName,autoFirstContract){
  if(autoFirstContract===undefined)autoFirstContract=true;
  clientName=clientName||'';
  var container=document.getElementById('dealClients');
  var blockIdx=container.children.length;
  var block=document.createElement('div');
  block.className='deal-client-block';
  block.style.cssText='background:var(--surface2);border:1px solid var(--border);border-radius:var(--rs);padding:14px 16px;margin-bottom:14px;';
  block.innerHTML=
    '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">'+
      '<span class="client-label" style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.4px;">Client #'+(blockIdx+1)+'</span>'+
      '<select class="dealClientSel" style="flex:1;max-width:340px;">'+clientSelectHTML(clientName)+'</select>'+
      '<button type="button" class="btn btn-sm btn-add-contract" onclick="addContractToClientBlock(this)">+ contrat</button>'+
      '<div style="flex:1;"></div>'+
      '<button type="button" class="btn btn-sm btn-remove-client" onclick="removeDealClientBlock(this)" style="color:var(--red);border-color:var(--red-bg);">× client</button>'+
    '</div>'+
    '<div class="deal-contracts"></div>';
  container.appendChild(block);
  if(autoFirstContract)addDealContractBlock(block);
  return block;
}
function removeDealClientBlock(btn){
  var block=btn.closest('.deal-client-block');
  if(block)block.remove();
  _renumberDealClients();
}
function _renumberDealClients(){
  document.querySelectorAll('#dealClients .deal-client-block').forEach(function(b,i){
    var lbl=b.querySelector('.client-label');
    if(lbl)lbl.textContent='Client #'+(i+1);
  });
}
function addContractToClientBlock(btn){
  var clientBlock=btn.closest('.deal-client-block');
  if(clientBlock)addDealContractBlock(clientBlock);
}
function addDealContractBlock(clientBlock,data){
  data=Object.assign({
    contrat:'Assurance Vie Lux',nom:'',dev:'EUR',depositaire:'',
    ct:'UF',ufR:'',runR:'',tva:0,codifications:[],
    _id:null
  },data||{});
  var contractsContainer=clientBlock.querySelector('.deal-contracts');
  var idx=contractsContainer.children.length;
  var block=document.createElement('div');
  block.className='deal-contract-block';
  block.style.cssText='background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:11px 12px;margin-bottom:8px;';
  if(data._id)block.dataset.origDealId=data._id;
  // Auto-expand commission block if data already carries non-zero rates (edit mode of existing deal)
  var hasCommData=(parseFloat(data.ufR)>0)||(parseFloat(data.runR)>0)||(parseFloat(data.tva)>0)||(data.ct&&data.ct!=='UF');
  block.innerHTML=
    '<div style="display:flex;gap:8px;align-items:center;margin-bottom:7px;">'+
      '<span class="contract-label" style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.3px;">Contrat #'+(idx+1)+'</span>'+
      '<div style="flex:1;"></div>'+
      '<button type="button" class="btn-toggle-commission" onclick="toggleContractCommission(this)" style="background:none;border:1px dashed var(--border);color:var(--text2);cursor:pointer;font-size:10px;padding:3px 8px;border-radius:3px;'+(hasCommData?'display:none;':'')+'">+ Frais de structure</button>'+
      '<button type="button" class="btn btn-sm btn-remove-contract" onclick="removeDealContractBlock(this)" style="color:var(--red);border-color:var(--red-bg);font-size:10px;padding:3px 8px;">× contrat</button>'+
    '</div>'+
    // Labels row 1
    '<div style="display:grid;grid-template-columns:1.3fr 130px 90px 1.5fr;gap:6px;margin-bottom:2px;font-size:9px;color:var(--text3);font-weight:600;letter-spacing:.3px;text-transform:uppercase;">'+
      '<span>Type de contrat</span><span>Total contrat</span><span>Devise</span><span>Dépositaire</span>'+
    '</div>'+
    // Row : type / total / devise / dépositaire
    '<div style="display:grid;grid-template-columns:1.3fr 130px 90px 1.5fr;gap:6px;margin-bottom:8px;align-items:center;">'+
      '<select class="contractType" onchange="_onContractTypeChange(this)">'+contratSelectHTML(data.contrat)+'</select>'+
      '<input type="number" class="contractTotal" value="'+(data.nom||'')+'" placeholder="Total contrat" step="0.01" min="0" oninput="_updateContractSum(this)"/>'+
      '<select class="contractDev" onchange="_onContractDevChange(this)">'+currencySelectHTML(data.dev)+'</select>'+
      '<select class="contractDepo">'+depositaireSelectHTML(data.depositaire)+'</select>'+
    '</div>'+
    // Commission structure block — collapsible
    '<div class="contract-commission" style="'+(hasCommData?'':'display:none;')+'background:var(--surface2);padding:8px 10px;border-radius:4px;margin-bottom:8px;">'+
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'+
        '<span style="font-size:10px;color:var(--text3);font-weight:600;letter-spacing:.3px;">FRAIS DE STRUCTURE</span>'+
        '<select class="contractCT" style="font-size:11px;">'+
          '<option value="UF"'+(data.ct==='UF'?' selected':'')+'>Up-Front</option>'+
          '<option value="RUN"'+(data.ct==='RUN'?' selected':'')+'>Running</option>'+
          '<option value="BOTH"'+(data.ct==='BOTH'?' selected':'')+'>UF + Run</option>'+
        '</select>'+
        '<span style="font-size:10px;color:var(--text3);">UF%</span><input type="number" class="contractUFR" value="'+(data.ufR||'')+'" step="0.01" placeholder="0" style="width:70px;font-size:11px;"/>'+
        '<span style="font-size:10px;color:var(--text3);">Run%</span><input type="number" class="contractRunR" value="'+(data.runR||'')+'" step="0.001" placeholder="0" style="width:70px;font-size:11px;"/>'+
        '<span style="font-size:10px;color:var(--text3);">TVA%</span><input type="number" class="contractTVA" value="'+(data.tva||0)+'" step="0.1" placeholder="0" style="width:60px;font-size:11px;"/>'+
        '<div style="flex:1;"></div>'+
        '<button type="button" onclick="hideContractCommission(this)" title="Masquer" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;line-height:1;padding:0 4px;">×</button>'+
      '</div>'+
    '</div>'+
    '<div style="font-size:10px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.3px;margin-bottom:5px;">Fournisseurs du contrat</div>'+
    '<div class="contract-fourns"></div>'+
    '<button type="button" class="btn btn-sm" onclick="addFournToContractBlock(this)" style="margin-top:4px;font-size:11px;">+ fournisseur</button>'+
    '<div class="contract-sum" style="display:none;font-size:11px;color:var(--text2);margin-top:8px;padding:6px 10px;background:var(--surface2);border-radius:4px;border:1px solid var(--border);"></div>';
  contractsContainer.appendChild(block);
  // Populate the fournisseurs
  if(Array.isArray(data.codifications)&&data.codifications.length){
    data.codifications.forEach(function(c){_appendDealFournBlock(block,c);});
  } else {
    _appendDealFournBlock(block,{});
  }
  _updateContractSum(block);
  _renumberDealContracts(clientBlock);
}
function removeDealContractBlock(btn){
  var block=btn.closest('.deal-contract-block');
  var client=btn.closest('.deal-client-block');
  if(block)block.remove();
  if(client)_renumberDealContracts(client);
}
function _renumberDealContracts(clientBlock){
  clientBlock.querySelectorAll('.deal-contract-block').forEach(function(b,i){
    var lbl=b.querySelector('.contract-label');
    if(lbl)lbl.textContent='Contrat #'+(i+1);
  });
}
function addFournToContractBlock(btn){
  var contract=btn.closest('.deal-contract-block');
  if(contract){_appendDealFournBlock(contract,{});_updateContractSum(contract);}
}
function _appendDealFournBlock(contractBlock,data){
  data=Object.assign({
    fourn:'',produit:'',type:'',isin:'',broker:'',maturite:'',
    feeSnapshot:[],assureur:'',banque:'',nominal:'',
    feesMode:'auto',
    billingMode:'fast', // Batch A.3 — fast = facture unique au save · feed = running annuel facturé à la SDG
    pf:{mode:'none'}
  },data||{});
  var fournsContainer=contractBlock.querySelector('.contract-fourns');
  var listId='dealIsinList-'+(++_codifLineCounter);
  var prodListId='dealProdList-'+_codifLineCounter;
  var fournBlock=document.createElement('div');
  fournBlock.className='deal-fourn-block';
  fournBlock.style.cssText='background:#fff;border:1px solid var(--border);border-radius:5px;padding:8px 9px;margin-bottom:6px;';
  fournBlock.dataset.isinListId=listId;
  fournBlock.dataset.prodListId=prodListId;
  fournBlock.dataset.feeSnapshot=JSON.stringify(data.feeSnapshot||[]);
  var pf=data.pf||{mode:'none'};
  var pfMode=pf.mode||(pf.type?pf.type:'none');
  var showRate=pfMode==='pct';
  var showFixed=pfMode==='fixed';
  var showFreq=pfMode!=='none'&&pfMode;
  var feesMode=data.feesMode||'auto';
  // Caption rows use the shared .field-caption class (declared in style.css).
  // Was: 4+ identical inline style strings duplicated through this template.
  fournBlock.innerHTML=
    // Row 1 labels (Oscar 2026-05-18 — Maturité always visible, "on sait jamais")
    '<div class="field-caption" style="display:grid;grid-template-columns:1.3fr 1.3fr 130px 110px 1fr 130px 28px;gap:6px;margin-bottom:2px;">'+
      '<span>Fournisseur (SDG)</span><span>Produit / Support</span><span>Type</span><span>ISIN</span><span>Broker</span><span>Maturité</span><span></span>'+
    '</div>'+
    // Row 1 inputs
    '<div style="display:grid;grid-template-columns:1.3fr 1.3fr 130px 110px 1fr 130px 28px;gap:6px;align-items:center;margin-bottom:6px;">'+
      '<select class="dfFourn" onchange="onDealFournChange(this)">'+fournOptHtml(data.fourn)+'</select>'+
      // Phase G.3 — produit input fires onProduitChange so picking a catalogue
      // produit (via datalist or matching text) auto-fills ISIN + type + fees
      // on the deal modal too (mirror of the arbitrage flow F.5).
      '<input list="'+prodListId+'" type="text" class="dfProduit" value="'+(data.produit||'')+'" placeholder="ex: A acc EUR" oninput="_onDealProduitChange(this)" onchange="_onDealProduitChange(this)"/>'+
      '<select class="dfType" onchange="onDealTypeChange(this)">'+produitTypeOptHtml(data.type)+'</select>'+
      '<input list="'+listId+'" type="text" class="dfISIN" value="'+(data.isin||'')+'" placeholder="FR00…" style="font-family:monospace;font-size:11px;" onchange="onDealIsinChange(this)" oninput="onDealIsinChange(this)"/>'+
      '<select class="dfBroker">'+brokerOptHtml(data.broker)+'</select>'+
      // A3 (Oscar 2026-05-18) — Maturité always shown.
      '<input type="date" class="dfMaturite" value="'+(data.maturite||'')+'"/>'+
      '<button type="button" onclick="removeDealFournBlock(this)" title="Retirer ce fournisseur" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:18px;padding:0;line-height:1;">×</button>'+
    '</div>'+
    // Row 2 — Assureur + Nominal (A1: Banque removed 2026-05-18). dfAssureurWrap
    // toggles based on parent contract type — hidden for CTO (brokerage = no
    // assureur), shown for everything else.
    '<div class="dfRow2" style="display:flex;gap:6px;align-items:flex-end;margin-bottom:4px;">'+
      '<div class="dfAssureurWrap" style="flex:1.5;">'+
        '<div class="field-caption" style="margin-bottom:2px;"><span>Assureur</span></div>'+
        '<select class="dfAssureur">'+assureurSelectHTML(data.assureur)+'</select>'+
      '</div>'+
      '<div style="width:150px;">'+
        '<div class="field-caption" style="margin-bottom:2px;"><span>Nominal</span></div>'+
        '<input type="number" class="dfNominal" value="'+(data.nominal||'')+'" placeholder="Nominal" step="0.01" min="0" oninput="_updateContractSum(this)"/>'+
      '</div>'+
    '</div>'+
    '<datalist id="'+listId+'">'+_isinDatalistInnerHtml(data.fourn||'')+'</datalist>'+
    '<datalist id="'+prodListId+'">'+_prodDatalistInnerHtml(data.fourn||'')+'</datalist>'+
    // ── Paramètres facturation & frais (FACTURATION + FRAIS + PERF FEES) ──
    // Wrapped under a single named group instead of 3 visually-equal siblings of the
    // row inputs above. The group title makes the relationship explicit, and the
    // .df-group container provides ONE visual boundary instead of three dashed
    // top-borders fighting for attention.
    '<div class="df-group">'+
    '<div class="df-group-hd">Facturation & frais</div>'+
    // Mode facturation (Fast / Feed)
    '<div class="dfBillingBlock df-subblock-in-group" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'+
      '<span class="field-caption-sm">FACTURATION</span>'+
      '<select class="dfBillingMode" onchange="_onDfBillingModeChange(this)" style="font-size:11px;">'+
        '<option value="fast"'+((data.billingMode||'fast')==='fast'?' selected':'')+'>Fast — facture unique au closing</option>'+
        '<option value="feed"'+(data.billingMode==='feed'?' selected':'')+'>Feed — running annuel facturé à la SDG</option>'+
      '</select>'+
      '<span class="dfBillingHint" style="font-size:10px;color:var(--text3);font-style:italic;">'+(data.billingMode==='feed'?'→ facture annuelle à émettre vers '+(data.fourn||'la société de gestion'):'→ une seule facture (UF) au save')+'</span>'+
    '</div>'+
    // ── Fees block (auto from ISIN / personnaliser / aucun) ──
    // Quand mode=auto ET le fournisseur a des produits → un sélecteur de catalogue
    // explicite apparaît : pick d'un produit → fill auto ISIN + Part + Type + fees.
    '<div class="dfFeesBlock df-subblock-in-group">'+
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'+
        '<span class="field-caption-sm">FRAIS</span>'+
        '<select class="dfFeesMode" onchange="_onDfFeesModeChange(this)" style="font-size:11px;">'+
          '<option value="auto"'+(feesMode==='auto'?' selected':'')+'>Auto (depuis ISIN)</option>'+
          '<option value="custom"'+(feesMode==='custom'?' selected':'')+'>Personnaliser</option>'+
          '<option value="none"'+(feesMode==='none'?' selected':'')+'>Aucun</option>'+
        '</select>'+
        '<select class="dfFeesAutoPicker" onchange="_onDfAutoPickerChange(this)" title="Catalogue produits du fournisseur" style="font-size:11px;flex:1;min-width:200px;display:'+((feesMode==='auto'&&data.fourn&&getFournProducts(data.fourn).length)?'':'none')+';">'+
          _renderAutoPickerOptions(data.fourn||'',data.isin||'')+
        '</select>'+
      '</div>'+
      '<div class="dfFeesAutoDisplay" style="font-size:10px;color:var(--text2);margin-top:4px;display:'+(feesMode==='auto'?'':'none')+';">'+
        ((data.feeSnapshot&&data.feeSnapshot.length)?_renderFeeSnapshotInline(data.feeSnapshot):'<span style="color:var(--text3);font-style:italic;">— choisis un produit du catalogue ou tape l\'ISIN —</span>')+
      '</div>'+
      '<div class="dfFeesCustomWrap" style="margin-top:6px;display:'+(feesMode==='custom'?'':'none')+';">'+
        '<div class="dfFeesCustomRows"></div>'+
        '<button type="button" class="btn-add-xs" onclick="_addDfCustomFeeRow(this)" style="margin-top:2px;">+ frais</button>'+
      '</div>'+
    '</div>'+
    // Perf fees per fourn
    '<div class="dfPfBlock df-subblock-in-group" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'+
      '<span class="field-caption-sm">PERF FEES</span>'+
      '<select class="dfPfMode" onchange="_onDfPfModeChange(this)" style="font-size:11px;">'+
        '<option value="none"'+(pfMode==='none'?' selected':'')+'>Aucun</option>'+
        '<option value="pct"'+(pfMode==='pct'?' selected':'')+'>% sur perf</option>'+
        '<option value="fixed"'+(pfMode==='fixed'?' selected':'')+'>Montant fixe</option>'+
      '</select>'+
      '<span class="dfPfPctLabel" style="font-size:10px;color:var(--text3);display:'+(showRate?'':'none')+';">Rate%</span>'+
      '<input type="number" class="dfPfRate" value="'+(pf.rate||'')+'" step="0.01" placeholder="ex: 20" style="width:70px;font-size:11px;display:'+(showRate?'':'none')+';"/>'+
      '<span class="dfPfHurdleLabel" style="font-size:10px;color:var(--text3);display:'+(showRate?'':'none')+';">Hurdle%</span>'+
      '<input type="number" class="dfPfHurdle" value="'+(pf.hurdle||'')+'" step="0.01" placeholder="ex: 8" style="width:70px;font-size:11px;display:'+(showRate?'':'none')+';"/>'+
      '<span class="dfPfFixedLabel" style="font-size:10px;color:var(--text3);display:'+(showFixed?'':'none')+';">Montant</span>'+
      '<input type="number" class="dfPfFixed" value="'+(pf.amount||'')+'" step="1" placeholder="ex: 50000" style="width:90px;font-size:11px;display:'+(showFixed?'':'none')+';"/>'+
      '<span class="dfPfFreqLabel" style="font-size:10px;color:var(--text3);display:'+(showFreq?'':'none')+';">Fréq.</span>'+
      '<select class="dfPfFreq" style="font-size:11px;display:'+(showFreq?'':'none')+';">'+
        '<option value="annuel"'+(pf.freq==='annuel'?' selected':'')+'>Annuelle</option>'+
        '<option value="cloture"'+(pf.freq==='cloture'?' selected':'')+'>Clôture</option>'+
        '<option value="valorisation"'+(pf.freq==='valorisation'?' selected':'')+'>Valorisation</option>'+
        '<option value="variable"'+(pf.freq==='variable'?' selected':'')+'>Variable</option>'+
      '</select>'+
    '</div>'+
    '</div>';  // /df-group
  fournsContainer.appendChild(fournBlock);
  // A2 — apply Assureur visibility based on parent contract's current type.
  _applyAssureurVisibilityToContract(contractBlock);
  // Custom fees mode — populate rows from feeSnapshot
  if(feesMode==='custom'){
    var customWrap=fournBlock.querySelector('.dfFeesCustomRows');
    if(customWrap){
      var initial=(data.feeSnapshot&&data.feeSnapshot.length)?data.feeSnapshot:[{kind:'',pct:''}];
      initial.forEach(function(f){_appendDfCustomFeeRow(customWrap,f);});
    }
  }
  // Opportunistic snapshot derivation for legacy codifs (no stored snapshot but ISIN set)
  if((!Array.isArray(data.feeSnapshot)||!data.feeSnapshot.length)&&data.isin&&feesMode==='auto'){
    var isinInput=fournBlock.querySelector('.dfISIN');
    if(isinInput)onDealIsinChange(isinInput);
  }
}

// ── Phase 2 v2.1 — UI helpers (commission toggle, fees mode, etc.) ──
function toggleContractCommission(btn){
  var contract=btn.closest('.deal-contract-block');
  var cm=contract&&contract.querySelector('.contract-commission');
  if(cm){cm.style.display='';btn.style.display='none';}
}
function hideContractCommission(btn){
  var contract=btn.closest('.deal-contract-block');
  var cm=contract&&contract.querySelector('.contract-commission');
  var tg=contract&&contract.querySelector('.btn-toggle-commission');
  if(cm)cm.style.display='none';
  if(tg)tg.style.display='';
  // Reset values when hiding
  ['contractUFR','contractRunR','contractTVA'].forEach(function(c){
    var el=contract.querySelector('.'+c);if(el)el.value='';
  });
  var ctSel=contract.querySelector('.contractCT');if(ctSel)ctSel.value='UF';
}
function _onContractDevChange(sel){
  // Currency change at contract level — update the contract sum display
  _updateContractSum(sel);
}
function _onDfFeesModeChange(sel){
  var fournBlock=sel.closest('.deal-fourn-block');
  if(!fournBlock)return;
  var mode=sel.value;
  var autoEl=fournBlock.querySelector('.dfFeesAutoDisplay');
  var customWrap=fournBlock.querySelector('.dfFeesCustomWrap');
  var pickerEl=fournBlock.querySelector('.dfFeesAutoPicker');
  if(autoEl)autoEl.style.display=mode==='auto'?'':'none';
  if(customWrap)customWrap.style.display=mode==='custom'?'':'none';
  if(pickerEl){
    var fournSel=fournBlock.querySelector('.dfFourn');
    var fournName=fournSel?fournSel.value:'';
    var hasProducts=getFournProducts(fournName).length>0;
    pickerEl.style.display=(mode==='auto'&&hasProducts)?'':'none';
  }
  if(mode==='auto'){
    // Re-derive snapshot from current ISIN
    var isinInput=fournBlock.querySelector('.dfISIN');
    if(isinInput)onDealIsinChange(isinInput);
  } else if(mode==='custom'){
    // Seed custom rows from current snapshot if empty
    var rows=fournBlock.querySelector('.dfFeesCustomRows');
    if(rows&&!rows.children.length){
      var snap=[];
      try{snap=JSON.parse(fournBlock.dataset.feeSnapshot||'[]')||[];}catch(e){snap=[];}
      var seed=snap.length?snap:[{kind:'',pct:''}];
      seed.forEach(function(f){_appendDfCustomFeeRow(rows,f);});
    }
  } else if(mode==='none'){
    fournBlock.dataset.feeSnapshot='[]';
  }
}
function _addDfCustomFeeRow(btn){
  var fournBlock=btn.closest('.deal-fourn-block');
  var rows=fournBlock&&fournBlock.querySelector('.dfFeesCustomRows');
  if(rows)_appendDfCustomFeeRow(rows,{kind:'',pct:''});
}
function _appendDfCustomFeeRow(container,fee){
  var row=document.createElement('div');
  row.className='dfCustomFeeRow';
  // Phase F.2 — grid extended for the secondary Run% input. Hidden unless kind=UF+Run.
  var isCombo=(fee.kind==='UF+Run');
  row.style.cssText='display:grid;grid-template-columns:1fr 64px 64px 24px;gap:4px;margin-bottom:3px;align-items:center;';
  var primaryLbl=isCombo?'UF %':'%';
  row.innerHTML=
    '<select class="dfCfKind" onchange="_onFfKindChange(this)" style="font-size:11px;">'+feeKindOptHtml(fee.kind)+'</select>'+
    '<input type="number" class="dfCfPct" value="'+(fee.pct||fee.pct===0?fee.pct:'')+'" placeholder="'+primaryLbl+'" title="'+(isCombo?'Taux UF (%)':'Taux (%)')+'" step="0.01" min="0" style="font-size:11px;"/>'+
    '<input type="number" class="dfCfRunPct" value="'+(fee.runPct||fee.runPct===0?fee.runPct:'')+'" placeholder="Run %" title="Taux Running (%/an)" step="0.01" min="0" style="font-size:11px;display:'+(isCombo?'':'none')+';"/>'+
    '<button type="button" onclick="_removeDfCustomFeeRow(this)" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:0;line-height:1;">×</button>';
  container.appendChild(row);
}
function _removeDfCustomFeeRow(btn){
  var row=btn.closest('.dfCustomFeeRow');
  if(row)row.remove();
}
function _readDfCustomFees(fournBlock){
  var out=[];
  fournBlock.querySelectorAll('.dfCustomFeeRow').forEach(function(r){
    var k=(r.querySelector('.dfCfKind').value||'').trim();
    var p=parseFloat(r.querySelector('.dfCfPct').value);
    // Phase F.2 — UF+Run rows carry a secondary runPct field.
    var entry={kind:k,pct:isNaN(p)?0:p};
    if(k==='UF+Run'){
      var runPct=parseFloat((r.querySelector('.dfCfRunPct')||{}).value);
      if(!isNaN(runPct))entry.runPct=runPct;
    }
    if(k||!isNaN(p))out.push(entry);
  });
  return out;
}
// Batch A.3 — update hint when billing mode changes
function _onDfBillingModeChange(sel){
  var fournBlock=sel.closest('.deal-fourn-block');
  var hint=fournBlock&&fournBlock.querySelector('.dfBillingHint');
  if(!hint)return;
  var fournSel=fournBlock.querySelector('.dfFourn');
  var fournName=fournSel?fournSel.value:'';
  hint.textContent=sel.value==='feed'
    ?'→ facture annuelle à émettre vers '+(fournName||'la société de gestion')
    :'→ une seule facture (UF) au save';
}
function removeDealFournBlock(btn){
  var block=btn.closest('.deal-fourn-block');
  var contract=btn.closest('.deal-contract-block');
  // Cheap misclick protection: only ask for confirmation if the block has data
  // worth losing (fournisseur picked, ISIN typed, nominal entered, fees customised…).
  // Empty rows just disappear silently — no friction added when there's nothing at stake.
  if(block && _dealFournBlockHasData(block)){
    if(!confirm('Retirer ce fournisseur du deal ? Les saisies seront perdues.'))return;
  }
  if(block)block.remove();
  if(contract)_updateContractSum(contract);
}
function _dealFournBlockHasData(block){
  if(!block)return false;
  var fourn=(block.querySelector('.dfFourn')||{}).value;
  var prod=((block.querySelector('.dfProduit')||{}).value||'').trim();
  var isin=((block.querySelector('.dfISIN')||{}).value||'').trim();
  var nom=((block.querySelector('.dfNominal')||{}).value||'').trim();
  var hasCustomFee=block.querySelectorAll('.dfCustomFeeRow').length>0;
  return !!(fourn||prod||isin||nom||hasCustomFee);
}
function onDealFournChange(sel){
  var fournBlock=sel.closest('.deal-fourn-block');
  if(!fournBlock)return;
  var fournName=sel.value;
  var listId=fournBlock.dataset.isinListId;
  var dl=fournBlock.querySelector('datalist#'+listId);
  if(dl)dl.innerHTML=_isinDatalistInnerHtml(fournName);
  // Same treatment for the produit/support datalist: switching fournisseur should
  // immediately surface that fournisseur's catalogue, not stale options.
  var prodListId=fournBlock.dataset.prodListId;
  if(prodListId){
    var pdl=fournBlock.querySelector('datalist#'+prodListId);
    if(pdl)pdl.innerHTML=_prodDatalistInnerHtml(fournName);
  }
  // Refresh the auto picker dropdown — populated from the new fourn's catalog,
  // visible only if mode=auto AND there are products.
  var picker=fournBlock.querySelector('.dfFeesAutoPicker');
  if(picker){
    picker.innerHTML=_renderAutoPickerOptions(fournName,'');
    var modeEl=fournBlock.querySelector('.dfFeesMode');
    var hasProducts=getFournProducts(fournName).length>0;
    var isAuto=modeEl&&modeEl.value==='auto';
    picker.style.display=(hasProducts&&isAuto)?'':'none';
  }
  var isinInput=fournBlock.querySelector('.dfISIN');
  if(isinInput)onDealIsinChange(isinInput);
}
// onDealTypeChange — no-op stub since 2026-05-18 (Oscar A3 rule: Maturité
// always visible). Kept so the dfType onchange hook has a future-proof landing.
function onDealTypeChange(sel){ /* no-op since 2026-05-18 */ }

// A2 helper (Oscar 2026-05-18) — toggle the Assureur block of every fournisseur
// child of a contract based on the contract type. CTO is the only type that
// doesn't need an assureur (brokerage account); everything else does.
function _applyAssureurVisibilityToContract(contractBlock){
  if(!contractBlock)return;
  var typeSel=contractBlock.querySelector('.contractType');
  var contractType=typeSel?typeSel.value:'';
  var hideAssureur=(contractType==='CTO');
  contractBlock.querySelectorAll('.deal-fourn-block .dfAssureurWrap').forEach(function(wrap){
    wrap.style.display=hideAssureur?'none':'';
    if(hideAssureur){
      var sel=wrap.querySelector('.dfAssureur');
      if(sel) sel.value='';
    }
  });
}
function _onContractTypeChange(sel){
  var contractBlock=sel.closest('.deal-contract-block');
  if(contractBlock) _applyAssureurVisibilityToContract(contractBlock);
}
// Phase G.3 — bidirectional cascade : picking the produit/part input on a deal
// fourn block also auto-fills the ISIN + everything downstream (type, fees,
// contract-level ufR/runR/ct, pf config). Symmetric with onDealIsinChange.
// Looks up the product by `part` label in the picked fournisseur's catalogue.
// If found and the ISIN slot is empty, fills the ISIN and triggers
// onDealIsinChange to propagate everything else through the existing pipeline.
function _onDealProduitChange(input){
  var fournBlock=input.closest('.deal-fourn-block');
  if(!fournBlock)return;
  var fournSel=fournBlock.querySelector('.dfFourn');
  var fournName=fournSel?fournSel.value:'';
  if(!fournName)return;
  var partLabel=(input.value||'').trim();
  if(!partLabel)return;
  var products=getFournProducts(fournName);
  var prod=products.find(function(p){return (p.part||'').trim()===partLabel;});
  if(!prod || !prod.isin) return; // typed value not in catalogue or no ISIN — let user keep typing
  var isinInput=fournBlock.querySelector('.dfISIN');
  if(!isinInput) return;
  // Only auto-fill if the ISIN field is empty (= user hasn't already set one).
  // Avoids overwriting a deliberate manual ISIN.
  if(!isinInput.value){
    isinInput.value=prod.isin;
    // Trigger the full ISIN cascade — type/fees/contract rates/pf auto-fill etc.
    onDealIsinChange(isinInput);
  }
}
function onDealIsinChange(input){
  var fournBlock=input.closest('.deal-fourn-block');
  if(!fournBlock)return;
  var fournSel=fournBlock.querySelector('.dfFourn');
  var fournName=fournSel?fournSel.value:'';
  var isin=(input.value||'').trim();
  var product=getFournProductByIsin(fournName,isin);
  var fees=product?(product.fees||[]):[];
  // Only auto-apply snapshot when mode is "auto". In custom/none, leave whatever user has.
  var modeEl=fournBlock.querySelector('.dfFeesMode');
  var feesMode=modeEl?modeEl.value:'auto';
  if(feesMode==='auto'){
    fournBlock.dataset.feeSnapshot=JSON.stringify(fees);
    var autoEl=fournBlock.querySelector('.dfFeesAutoDisplay');
    if(autoEl){
      autoEl.innerHTML=fees.length?_renderFeeSnapshotInline(fees):'<span style="color:var(--text3);font-style:italic;">— pas de frais sur cet ISIN dans le catalogue —</span>';
    }
  }
  if(product){
    var prodInput=fournBlock.querySelector('.dfProduit');
    if(prodInput&&!prodInput.value&&product.part)prodInput.value=product.part;
    // Batch D.1.#2 — auto-fill Type from product catalogue if it carries one and the user hasn't picked anything yet
    var typeSel=fournBlock.querySelector('.dfType');
    if(typeSel&&!typeSel.value&&product.type)typeSel.value=product.type;
  }
  // Sync the auto picker dropdown to match the current ISIN (so picking via text/datalist updates the catalog picker)
  var autoPicker=fournBlock.querySelector('.dfFeesAutoPicker');
  if(autoPicker){
    var match=Array.prototype.find.call(autoPicker.options,function(o){return o.value===isin;});
    autoPicker.value=match?isin:'';
  }
  // NEW (Phase A.3) — auto-fill the deal's contract-level cycle/rates from the
  // product's fees catalogue, so picking a product end-to-end-populates ufR/runR/ct
  // without manual re-entry. Only fills when those fields are still empty (0)
  // so we never overwrite a deliberate user edit.
  var contract=input.closest('.deal-contract-block');
  if(contract && product && fees.length){
    _autofillContractRatesFromFees(contract,fees);
  }
  // Phase E.3 — auto-fill the deal's Perf fees block from the product's pf config
  // (mirror of the UF/Run auto-fill above). Only fills when the deal-level pf mode
  // is still 'none' (= untouched by the user) — preserves manual edits.
  if(product && product.pf && product.pf.mode && product.pf.mode!=='none'){
    _autofillDealPfFromProductPf(fournBlock, product.pf);
  }
  if(contract)_updateContractSum(contract);
}
// Phase E.3 — copy a product's perf config into the deal-fourn-block's dfPfBlock UI.
// Read-then-write: only fills when the dfPfMode is still 'none' so we don't clobber
// a deliberate manual config. Updates display visibility just like _onDfPfModeChange.
function _autofillDealPfFromProductPf(fournBlock, prodPf){
  if(!fournBlock || !prodPf || !prodPf.mode || prodPf.mode==='none') return;
  var modeEl=fournBlock.querySelector('.dfPfMode');
  if(!modeEl) return;
  if(modeEl.value && modeEl.value!=='none') return; // user already set something
  modeEl.value=prodPf.mode;
  var setV=function(cls,v){var el=fournBlock.querySelector(cls);if(el && v!=null) el.value=v;};
  if(prodPf.mode==='pct'){
    setV('.dfPfRate',   prodPf.rate);
    setV('.dfPfHurdle', prodPf.hurdle);
  } else if(prodPf.mode==='fixed'){
    setV('.dfPfFixed',  prodPf.amount);
    setV('.dfPfHurdle', prodPf.hurdle);
  }
  setV('.dfPfFreq', prodPf.freq||'annuel');
  // Re-run the visibility toggle so the right rows show.
  if(typeof _onDfPfModeChange==='function') _onDfPfModeChange(modeEl);
  if(typeof toast==='function') toast('Perf fees auto-remplies depuis le catalogue ('+prodPf.mode+(prodPf.rate?' '+prodPf.rate+'%':'')+(prodPf.hurdle?' hurdle '+prodPf.hurdle+'%':'')+')');
}

// Translate a fees array into deal-level cycle rates.
// Each fee row has shape:
//   {kind:'UF',     pct:X}            → adds X to ufR
//   {kind:'Run',    pct:X}            → adds X to runR
//   {kind:'UF+Run', pct:X, runPct:Y}  → adds X to ufR AND Y to runR (Phase F.2)
//     · Legacy: if runPct undefined on a UF+Run row, fallback to pct on BOTH
//       cycles (Phase A.1 behavior — pre-F.2 data still computes correctly).
// Multiple rows of the same kind accumulate (rare but supported).
// Returns {ufR, runR, ct} ready to drop into the contract inputs.
function _feesToCycleRates(fees){
  var ufR=0, runR=0;
  (fees||[]).forEach(function(f){
    var pct=parseFloat(f.pct);
    var hasUfPct=!isNaN(pct)&&pct>0;
    var c=feeKindCycles(f.kind);
    // Phase F.2 — UF+Run can carry a separate runPct. If it exists we use it,
    // else we fall back to legacy "same pct on both cycles".
    var isCombo=(c.uf && c.run);
    var runPctRaw=isCombo?parseFloat(f.runPct):NaN;
    var hasRunPct=!isNaN(runPctRaw)&&runPctRaw>0;
    if(c.uf && hasUfPct) ufR+=pct;
    if(c.run){
      if(isCombo && hasRunPct) runR+=runPctRaw;       // F.2 path : separate rates
      else if(hasUfPct)        runR+=pct;             // legacy : same pct for both
    }
  });
  // Round to 4 decimals to avoid binary-float artifacts (1.5+0.0 = 1.5000000001 etc).
  ufR=Math.round(ufR*10000)/10000;
  runR=Math.round(runR*10000)/10000;
  var ct=(ufR>0 && runR>0)?'BOTH':(runR>0?'RUN':(ufR>0?'UF':'UF'));
  return {ufR:ufR, runR:runR, ct:ct};
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase D.1 — Per-codification fee resolution
// ═══════════════════════════════════════════════════════════════════════════
// Each codification (= one fournisseur+produit slot on a deal) now carries its
// own ct/ufR/runR/ufE/runE — derived from its feeSnapshot and nominal, not from
// the deal-level rates. This is the model change that lets a single deal mix
// Amundi (Run) + Wealins (UF) on the same contract while categorising each
// correctly on the billing pages.
//
// Two paths:
//   _enrichCodifWithRates(codif, deal)  — MUTATES the codif at save time,
//                                          adding ct/ufR/runR fields plus the
//                                          fee amounts: ufE_native / runE_native
//                                          (source of truth, in the codif's own
//                                          currency) and ufE / runE (legacy EUR
//                                          equivalent at trade-date FX = deal.fx,
//                                          computed only if `deal` is passed and
//                                          carries dev + fx).
//   codifEffective{Ct,UfR,RunR,UfE,RunE}(codif, deal)
//                                       — READS effective values with legacy
//                                          fallback: if the codif doesn't have
//                                          the field (= deal predates Phase D),
//                                          falls back to the deal-level value
//                                          scaled by codif's nominal share.
//
// Backward compat: any deal saved before Phase D has codifications without these
// fields. Reading via the getters keeps the UI consistent until that deal is
// re-saved (which will re-run _enrichCodifWithRates and persist the fields).

function _enrichCodifWithRates(codif, deal){
  if(!codif) return codif;
  var fees=Array.isArray(codif.feeSnapshot)?codif.feeSnapshot:[];
  var rates=_feesToCycleRates(fees);
  var nom=parseFloat(codif.nominal)||0;
  codif.ct  = rates.ct;
  codif.ufR = rates.ufR;
  codif.runR= rates.runR;
  // Phase I.3 — fee amounts are stored in NATIVE currency (= the codif's currency,
  // which equals the deal's dev). This is the source of truth — immutable across
  // billing cycles. The EUR equivalent is computed on-the-fly at display time
  // using fxToEurAtDate(native, deal, billing_date).
  //
  // Legacy compat: codif.ufE / codif.runE still expose the EUR-equivalent at
  // trade-date FX (for KPIs / synthese / commissions that haven't been migrated
  // to async per-event FX). New native fields: codif.ufE_native / codif.runE_native.
  codif.ufE_native  = Math.round(nom * (rates.ufR/100) * 100) / 100; // 2 decimals
  codif.runE_native = Math.round(nom * (rates.runR/100) * 100) / 100;
  // EUR equivalents (at trade-date snapshot FX). For EUR deals, fx=1 so this
  // equals the native amount. For USD/etc deals, fxToEur divides by d.fx.
  if(deal && deal.dev && deal.dev!=='EUR' && deal.fx){
    codif.ufE  = Math.round(codif.ufE_native  / deal.fx);
    codif.runE = Math.round(codif.runE_native / deal.fx);
  } else {
    codif.ufE  = Math.round(codif.ufE_native);
    codif.runE = Math.round(codif.runE_native);
  }
  return codif;
}

// Helper getters used by billing pages — codif first, deal-level fallback.
// `deal` arg is needed for the legacy fallback (where the codif doesn't carry
// its own rate and we apportion the deal-level rate by codif/deal nominal ratio).
function codifEffectiveCt(codif, deal){
  if(codif && codif.ct) return codif.ct;
  return (deal && deal.ct) || 'UF';
}
function codifEffectiveUfR(codif, deal){
  if(codif && typeof codif.ufR==='number') return codif.ufR;
  return (deal && deal.ufR) || 0;
}
function codifEffectiveRunR(codif, deal){
  if(codif && typeof codif.runR==='number') return codif.runR;
  return (deal && deal.runR) || 0;
}
// EUR amounts: prefer the codif's stored value; if missing, compute on-the-fly
// from its nominal × its rate. Last resort: apportion deal.ufE/runE by share.
function codifEffectiveUfE(codif, deal){
  if(codif && typeof codif.ufE==='number') return codif.ufE;
  var nom=parseFloat(codif&&codif.nominal)||0;
  var rate=codifEffectiveUfR(codif, deal);
  if(nom>0 && rate>0) return Math.round(nom * (rate/100));
  // Legacy fallback : apportion deal.ufE by codif's share of deal.nom
  if(deal && deal.nom>0 && nom>0) return Math.round((deal.ufE||0) * (nom/deal.nom));
  return 0;
}
function codifEffectiveRunE(codif, deal){
  if(codif && typeof codif.runE==='number') return codif.runE;
  var nom=parseFloat(codif&&codif.nominal)||0;
  var rate=codifEffectiveRunR(codif, deal);
  if(nom>0 && rate>0) return Math.round(nom * (rate/100));
  if(deal && deal.nom>0 && nom>0) return Math.round((deal.runE||0) * (nom/deal.nom));
  return 0;
}
// Convenience : returns all codifications of a deal, each enriched on-the-fly
// (without mutating storage) — so iterating billing pages can read uniformly.
// Use this everywhere the billing pages query deals — it normalizes the legacy
// vs Phase D shape.
function dealCodifsEffective(deal){
  if(!deal || !Array.isArray(deal.codifications) || !deal.codifications.length){
    // Legacy deals without codifications: synthesize one virtual codif from
    // the deal's top-level fields so iterators don't choke.
    if(!deal) return [];
    return [{
      fourn:deal.fourn||'',produit:deal.produit||'',type:deal.produit_type||'',
      isin:deal.isin||'',broker:deal.broker||'',
      nominal:deal.nom||0,currency:deal.dev||'EUR',
      ct:deal.ct||'UF', ufR:deal.ufR||0, runR:deal.runR||0,
      ufE:deal.ufE||0, runE:deal.runE||0,
      _virtual:true // marker so callers can branch if needed (rare)
    }];
  }
  return deal.codifications.map(function(c){
    return {
      fourn:c.fourn||'',produit:c.produit||'',type:c.type||'',
      isin:c.isin||'',broker:c.broker||'',
      nominal:c.nominal||0,currency:c.currency||deal.dev||'EUR',
      ct:codifEffectiveCt(c,deal),
      ufR:codifEffectiveUfR(c,deal),
      runR:codifEffectiveRunR(c,deal),
      ufE:codifEffectiveUfE(c,deal),
      runE:codifEffectiveRunE(c,deal),
      assureur:c.assureur||'',banque:c.banque||'',
      billingMode:c.billingMode||'fast',
      pf:c.pf||{mode:'none'},
      feeSnapshot:c.feeSnapshot||[],
      maturite:c.maturite||null,
      // Keep a reference to the parent deal for upstream filters (client/date/etc.)
      _deal:deal
    };
  });
}
// Phase D.1 / I.3 — persist enriched rates on the codifications array of a deal.
// Mutates `codifs` in place. Idempotent. `deal` is optional but recommended :
// it carries the trade-date FX (deal.fx) needed to compute EUR equivalents for
// non-EUR deals. Without it, ufE/runE are computed as if the deal were EUR.
function enrichDealCodifications(codifs, deal){
  if(!Array.isArray(codifs)) return codifs;
  codifs.forEach(function(c){_enrichCodifWithRates(c, deal);});
  return codifs;
}

// Phase H.2 — propagate codif-level aggregates back to deal-level fields.
// Reason: many legacy renderers (commissions, fournisseur référentiel, alerts,
// CSV export) read `d.ufE / d.runE / d.ct / d.ufR / d.runR` directly. If we only
// enrich codifs and leave deal fields stale, those renderers display 0.
//
// Aggregation rules :
//   d.ufE  = sum of codif.ufE  across all codifs
//   d.runE = sum of codif.runE across all codifs
//   d.ct   = UF if all codifs are UF, RUN if all codifs are RUN, BOTH if mixed,
//            otherwise leave existing (defensive : never blank).
//   d.ufR  = weighted-average rate by nominal (representative for the contract)
//   d.runR = weighted-average rate by nominal
//
// Idempotent. Safe to call multiple times. Doesn't write to DB (in-memory only —
// the deal save flow re-saves naturally on next save_collect cycle).
function _recomputeDealAggregates(d){
  if(!d || !Array.isArray(d.codifications) || !d.codifications.length) return d;
  var sumUfE=0, sumRunE=0, sumNomUf=0, sumNomRun=0, weightedUfR=0, weightedRunR=0;
  var ctSeen={UF:false, RUN:false, BOTH:false};
  d.codifications.forEach(function(c){
    var nom=parseFloat(c.nominal)||0;
    sumUfE += c.ufE||0;
    sumRunE+= c.runE||0;
    if((c.ufR||0)>0){ weightedUfR  += (c.ufR||0)*nom;  sumNomUf  += nom; }
    if((c.runR||0)>0){weightedRunR += (c.runR||0)*nom; sumNomRun += nom; }
    if(c.ct==='UF') ctSeen.UF=true;
    if(c.ct==='RUN') ctSeen.RUN=true;
    if(c.ct==='BOTH'){ctSeen.UF=true; ctSeen.RUN=true;}
  });
  d.ufE = sumUfE;
  d.runE= sumRunE;
  d.ufR = sumNomUf >0 ? Math.round(weightedUfR /sumNomUf *10000)/10000 : 0;
  d.runR= sumNomRun>0 ? Math.round(weightedRunR/sumNomRun*10000)/10000 : 0;
  if(ctSeen.UF && ctSeen.RUN) d.ct='BOTH';
  else if(ctSeen.RUN) d.ct='RUN';
  else if(ctSeen.UF) d.ct='UF';
  // else leave d.ct as-is (no codif had a recognized type — likely empty kind data)
  return d;
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase D.2 — currentNominal per codification
// ═══════════════════════════════════════════════════════════════════════════
// A codification's effective base for fee calculation is NOT its initial
// nominal forever — it shrinks when capital is withdrawn or arbitraged out.
// Sources of reduction:
//   1. Retraits → stored on contract.produits[].retraits[]; linkage to a codif
//      is via (deal_id, codif_idx) on the produit entry.
//   2. Arbitrages out → a new deal exists with arbSrc=this.deal._id; the new
//      deal's nominal is what was moved out. (TODO Phase D.4 : track codif-level
//      arbitrage source via arbSrcCodifIdx — for now, arbitrages reduce the
//      whole deal proportionally across codifs.)
//
// Returns the current nominal (number, EUR-equivalent in the deal's currency).
function codifCurrentNominal(codif, deal){
  if(!codif) return 0;
  var initial=parseFloat(codif.nominal)||0;
  if(!deal||!deal._id) return initial;
  var codifIdx=(deal.codifications||[]).indexOf(codif);
  // Retraits reduction — look up the matching contract.produits row by
  // (deal_id, codif_idx) and sum montant on its retraits.
  var retraitTotal=0;
  if(typeof contracts_db!=='undefined' && Array.isArray(contracts_db)){
    contracts_db.forEach(function(ct){
      if(!ct||!Array.isArray(ct.produits))return;
      ct.produits.forEach(function(p){
        if(p.deal_id!==deal._id)return;
        var pidx=(p.codif_idx==null)?0:p.codif_idx;
        if(pidx!==codifIdx&&!(codifIdx===-1&&pidx===0))return; // legacy match: codif #0 if not found
        (p.retraits||[]).forEach(function(r){retraitTotal+=(r.montant||0);});
      });
    });
  }
  // Arbitrage-out reduction — find downstream deals (arbSrc === deal._id) and
  // currently apportion their nominal proportionally to codifs (since we don't
  // yet track arbSrcCodifIdx). Once D.4 lands, this becomes exact.
  var arbOut=0;
  if(typeof deals!=='undefined' && Array.isArray(deals)){
    var downstream=deals.filter(function(x){return x.arbSrc===deal._id;});
    var totalDownstream=downstream.reduce(function(s,x){return s+(x.nom||0);},0);
    if(totalDownstream>0 && deal.nom>0){
      // Proportional to this codif's share of the deal's initial total.
      var shareOfDeal=(deal.nom>0)?(initial/deal.nom):0;
      arbOut=Math.round(totalDownstream*shareOfDeal);
    }
  }
  var cur=initial-retraitTotal-arbOut;
  return cur<0?0:cur; // floor at 0 — can't have negative nominal
}

// Per-codification EUR amounts using CURRENT nominal (post-retraits/arbitrages)
// instead of initial. Used by the billing pages for ongoing periods. For closed
// historical periods, use codifEffectiveRunE/UfE with the initial nominal.
function codifCurrentRunE(codif, deal){
  var nom=codifCurrentNominal(codif, deal);
  var rate=codifEffectiveRunR(codif, deal);
  return Math.round(nom * (rate/100));
}
function codifCurrentUfE(codif, deal){
  // UF is one-shot at closing — usually computed from INITIAL nominal, not current.
  // Only useful if you ever decide to bill UF on top-ups (rare). Kept for symmetry.
  var nom=codifCurrentNominal(codif, deal);
  var rate=codifEffectiveUfR(codif, deal);
  return Math.round(nom * (rate/100));
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase D.3 — Billing entries (flatten deals → codif-level rows)
// ═══════════════════════════════════════════════════════════════════════════
// Returns a flat array of { deal, codif, fourn, produit, ct, ufR, runR, ufE, runE, ... }
// — one entry per (deal × codif) combination. Each entry carries a reference
// back to its parent deal for client/date/status filtering at the top level,
// plus codif-level fields for fee categorisation and amounts.
//
// This is the new canonical iterator for billing pages. Old code that filtered
// `deals.filter(d => d.ct==='UF')` becomes `billingEntries().filter(e => e.ct==='UF')`.
// Aggregations by fournisseur use `e.fourn` (codif-level, not deal-level).
function billingEntries(dealList){
  var src=Array.isArray(dealList)?dealList:(typeof deals!=='undefined'?deals:[]);
  var out=[];
  src.forEach(function(d){
    var codifs=dealCodifsEffective(d);
    codifs.forEach(function(c){
      out.push({
        deal:d,
        codif:c,
        // Codif-level (the parts that VARY per fournisseur on the same deal)
        fourn:c.fourn||d.fourn||'',
        produit:c.produit||d.produit||'',
        isin:c.isin||d.isin||'',
        type:c.type||d.produit_type||'',
        ct:c.ct,
        ufR:c.ufR,
        runR:c.runR,
        ufE:c.ufE,
        runE:c.runE,
        nominal:c.nominal||0,
        currency:c.currency||d.dev||'EUR',
        billingMode:c.billingMode||'fast',
        pf:c.pf||{mode:'none'},
        broker:c.broker||d.broker||'',
        maturite:c.maturite||d.maturite||null,
        // Deal-level passthrough — keep same field names so existing downstream
        // code that read `d.client / d.date / d.fSt / d.ufE / d._id` continues
        // to work after replacing the source iterator. `nom` here is the DEAL
        // total; use `nominal` for codif's share.
        _id:d._id,
        client:d.client||'',
        contrat:d.contrat||'',
        date:d.date||'',
        issue:d.issue||'',
        v:d.v||'',
        stat:d.stat||'',
        fSt:d.fSt||'',
        inv:d.inv||'',
        invS:d.invS||'',
        nom:d.nom||0,
        dev:d.dev||'EUR',
        fx:d.fx||1,
        tva:d.tva||0,
        depositaire:d.depositaire||'',
        runStart:d.runStart||'',
        arbId:d.arbId||null,
        arbSrc:d.arbSrc||null,
        notes:d.notes||''
      });
    });
  });
  return out;
}
// Convenience filters — billing-by-type. These accept either an entry stream
// or default to all current billing entries.
function billingUFEntries(entries){
  var src=entries||billingEntries();
  return src.filter(function(e){return (e.ct==='UF'||e.ct==='BOTH')&&e.ufE>0;});
}
function billingRunEntries(entries){
  var src=entries||billingEntries();
  return src.filter(function(e){return (e.ct==='RUN'||e.ct==='BOTH')&&e.runE>0;});
}

// Apply derived rates to the contract block. Will NOT overwrite a non-zero
// value that the user typed manually — first wins. This keeps the auto-fill
// helpful without being annoying.
function _autofillContractRatesFromFees(contractBlock,fees){
  if(!contractBlock||!fees)return;
  var rates=_feesToCycleRates(fees);
  var ufREl=contractBlock.querySelector('.contractUFR');
  var runREl=contractBlock.querySelector('.contractRunR');
  var ctEl=contractBlock.querySelector('.contractCT');
  var changed=false;
  if(ufREl && rates.ufR>0 && (!ufREl.value || parseFloat(ufREl.value)===0)){
    ufREl.value=rates.ufR;
    changed=true;
  }
  if(runREl && rates.runR>0 && (!runREl.value || parseFloat(runREl.value)===0)){
    runREl.value=rates.runR;
    changed=true;
  }
  if(ctEl && (!ctEl.value || ctEl.value==='UF') && rates.ct!=='UF'){
    // Only upgrade the default 'UF' to RUN or BOTH; don't downgrade.
    ctEl.value=rates.ct;
    changed=true;
  } else if(ctEl && !ctEl.value){
    ctEl.value=rates.ct;
    changed=true;
  }
  if(changed && typeof toast==='function'){
    toast('Frais auto-remplis depuis le catalogue '+(rates.ufR>0?'UF '+rates.ufR+'% ':'')+(rates.runR>0?'Run '+rates.runR+'%':''));
  }
}
function _onDfPfModeChange(sel){
  var fournBlock=sel.closest('.deal-fourn-block');
  var mode=sel.value;
  var show=function(s,visible){var el=fournBlock.querySelector(s);if(el)el.style.display=visible?'':'none';};
  show('.dfPfPctLabel',mode==='pct');
  show('.dfPfRate',mode==='pct');
  show('.dfPfHurdleLabel',mode==='pct');
  show('.dfPfHurdle',mode==='pct');
  show('.dfPfFixedLabel',mode==='fixed');
  show('.dfPfFixed',mode==='fixed');
  show('.dfPfFreqLabel',mode!=='none');
  show('.dfPfFreq',mode!=='none');
}
function _updateContractSum(anyChildOrContract){
  var contract=(anyChildOrContract&&anyChildOrContract.classList&&anyChildOrContract.classList.contains('deal-contract-block'))?anyChildOrContract:(anyChildOrContract&&anyChildOrContract.closest?anyChildOrContract.closest('.deal-contract-block'):null);
  if(!contract)return;
  // Single currency = contract.dev. Sum all fournisseur nominals into one total.
  var sumNom=0;
  contract.querySelectorAll('.deal-fourn-block').forEach(function(fb){
    var nomInp=fb.querySelector('.dfNominal');
    if(!nomInp)return;
    var nominal=parseFloat(nomInp.value);
    if(isNaN(nominal)||nominal<=0)return;
    sumNom+=nominal;
  });
  var totalEl=contract.querySelector('.contractTotal');
  var devEl=contract.querySelector('.contractDev');
  var total=parseFloat(totalEl?totalEl.value:'')||0;
  var dealCur=devEl?devEl.value:'EUR';
  var sumEl=contract.querySelector('.contract-sum');
  if(!sumEl)return;
  if(!sumNom&&!total){sumEl.style.display='none';return;}
  var sym=_curSymbol(dealCur);
  var sumPart='<b>Σ fourns</b> : '+f0(sumNom)+' '+sym;
  var totalPart='<b>Total contrat</b> : '+f0(total)+' '+sym;
  var warning='';
  if(total){
    var diff=sumNom-total;
    if(Math.abs(diff)<0.5)warning=' <span style="color:var(--green);">✓ équilibré</span>';
    else warning=' <span style="color:var(--red);">⚠ écart '+f0(Math.abs(diff))+' '+sym+'</span>';
  }
  sumEl.innerHTML=sumPart+' &nbsp;·&nbsp; '+totalPart+warning;
  sumEl.style.display='';
}

function exportCSV(){
  var h=['Vendeur','Date','Client','Contrat','Fournisseur','Broker','Produit','ISIN','Nominal','Devise','FX','Issue','End','Type','UF%','Run%','UF EUR','Run EUR','Statut','Ref','Invoice','Notes'];
  var rows=filt().map(d=>[d.v,d.date,d.client,d.contrat,d.fourn,d.broker,d.produit,d.isin,d.nom,d.dev,d.fx,d.issue,d.end,d.ct,d.ufR,d.runR,d.ufE,d.runE,d.fSt,d.fRef,d.inv,d.notes].map(v=>(v||'').toString().replace(/,/g,';')));
  var csv=[h.join(','),...rows.map(r=>r.join(','))].join('\n');
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'}));a.download='deals_'+today()+'.csv';a.click();
}
function importCSV(e){
  var file=e.target.files[0];if(!file)return;
  var fileInput=e.target;
  var EXPECTED_COLS=22;
  var reader=new FileReader();
  reader.onload=async function(ev){
    var lines=ev.target.result.split('\n').filter(function(l){return l.trim();}),imp=0,skipped=0,errors=[];
    try{
      for(var li=1;li<lines.length;li++){
        var c=lines[li].split(',');
        if(c.length<EXPECTED_COLS){skipped++;errors.push('Ligne '+(li+1)+': '+c.length+' colonnes (attendu '+EXPECTED_COLS+')');continue;}
        // Column order: 0=Vendeur,1=Date,2=Client,3=Contrat,4=Fournisseur,5=Broker,6=Produit,7=ISIN,
        // 8=Nominal,9=Devise,10=FX,11=Issue,12=End,13=Type,14=UF%,15=Run%,16=UF EUR,17=Run EUR,
        // 18=Statut,19=Ref,20=Invoice,21=Notes
        var d={v:c[0]||'Audrey',date:c[1]||today(),stat:'Deal réalisé',client:c[2]||'',contrat:c[3]||'',fourn:c[4]||'',broker:c[5]||'',produit:c[6]||'',isin:c[7]||'',nom:parseFloat(c[8])||0,dev:c[9]||'EUR',fx:parseFloat(c[10])||1,issue:c[11]||'',end:c[12]||'',ct:c[13]||'UF',ufR:parseFloat(c[14])||0,runR:parseFloat(c[15])||0,ufE:parseFloat(c[16])||0,runE:parseFloat(c[17])||0,tva:0,fSt:c[18]||'À émettre',fRef:c[19]||'',inv:c[20]||'',notes:c[21]||'',hist:[{ts:nowS(),a:'Importé depuis CSV',by:'Import'}]};
        try{
          var res=await sbInsert('deals',d);
          if(res&&res[0])d._id=res[0].id;
          deals.push(d);imp++;
        }catch(insErr){
          skipped++;errors.push('Ligne '+(li+1)+': '+(insErr.message||insErr));
        }
      }
      var msg=imp+' deal(s) importé(s).';
      if(skipped)msg+='\n\n'+skipped+' ligne(s) ignorée(s):\n'+errors.slice(0,5).join('\n')+(errors.length>5?'\n…':'');
      alert(msg);renderAll();
    }catch(fatal){
      alert('Import interrompu: '+(fatal.message||fatal)+'\n\n'+imp+' deal(s) importé(s) avant l\'erreur.');
      renderAll();
    }finally{
      fileInput.value='';
    }
  };
  reader.onerror=function(){alert('Erreur de lecture du fichier.');fileInput.value='';};
  reader.readAsText(file);
}

// ── CLIENTS ──────────────────────────────────────────────────────────────────
var clientTab='ALL';
var clientSortKey='name'; // 'name' | 'classif'
var clientSortDir=1;       // 1 asc / -1 desc
function loadClientDB(){return clients_db;}
function saveClientDB(db){/* async handled in saveClient */}
// saveClientDB handled by Supabase
function setClientTab(t,btn){
  clientTab=t;
  document.querySelectorAll('#tabPP,#tabPM,#tabAll').forEach(b=>{b.style.background='';b.style.color='';b.style.borderColor='';});
  btn.style.background='var(--text)';btn.style.color='var(--surface)';btn.style.borderColor='var(--text)';
  renderClients();
}
function setClientSort(k){
  if(clientSortKey===k)clientSortDir=-clientSortDir;
  else{clientSortKey=k;clientSortDir=1;}
  renderClients();
}
// Batch A.2 — classification badge (A premium / B actif / C courant / D dormant)
function _clientClassifBadge(cl){
  if(!cl)return '<span style="font-size:10px;color:var(--text3);">—</span>';
  var colorMap={A:{bg:'rgba(34,139,69,.15)',fg:'#1e7f3a'},B:{bg:'rgba(29,95,212,.15)',fg:'#1d5fd4'},C:{bg:'rgba(176,122,16,.15)',fg:'#b07a10'},D:{bg:'rgba(140,140,140,.15)',fg:'#777'}};
  var c=colorMap[cl]||{bg:'var(--surface2)',fg:'var(--text2)'};
  return '<span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;font-weight:700;font-size:11px;background:'+c.bg+';color:'+c.fg+';">'+escH(cl)+'</span>';
}
function renderClients(){
  var db=loadClientDB();
  var filtered=clientTab==='ALL'?db.slice():db.filter(c=>c.type===clientTab);
  // Search filter — matches name / email / vendeur référent / classification / notes
  var qEl=document.getElementById('clientSearch');
  var q=qEl?(qEl.value||'').toLowerCase().trim():'';
  if(q){
    filtered=filtered.filter(function(c){
      if((c.name||'').toLowerCase().indexOf(q)!==-1)return true;
      if((c.email||'').toLowerCase().indexOf(q)!==-1)return true;
      if((c.vendeur||'').toLowerCase().indexOf(q)!==-1)return true;
      if((c.classification||'').toLowerCase().indexOf(q)!==-1)return true;
      if((c.notes||'').toLowerCase().indexOf(q)!==-1)return true;
      return false;
    });
  }
  var countEl=document.getElementById('clientsCount');
  if(countEl)countEl.textContent=filtered.length+' client'+(filtered.length>1?'s':'')+(q?' (filtrés)':'');
  // Sort: default by name; click on Classif. header → sort by classification (NULL last)
  if(clientSortKey==='classif'){
    filtered.sort(function(a,b){
      var ac=a.classification||'￿',bc=b.classification||'￿'; // unclassified last
      if(ac!==bc)return ac<bc?-1*clientSortDir:1*clientSortDir;
      return a.name.localeCompare(b.name,undefined,{sensitivity:'base'});
    });
  } else {
    filtered.sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'})*clientSortDir);
  }
  var t=document.getElementById('clientsT');
  while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('clientsEmpty').style.display=filtered.length?'none':'block';
  filtered.forEach(c=>{
    // Audit fix — respect vendor filter (curV via filt()) so per-client KPIs match the active scope
    var dDeals=filt().filter(d=>d.client===c.name);
    var nbD=dDeals.length;
    var totalNom=dDeals.reduce((s,d)=>s+d.nom,0);
    var totalUF=dDeals.reduce((s,d)=>s+d.ufE,0);
    var totalRun=dDeals.reduce((s,d)=>s+d.runE,0);
    var lastDate=dDeals.length?dDeals.sort((a,b)=>b.date.localeCompare(a.date))[0].date:'—';
    var typeBadge=c.type==='PP'?'<span class="badge bb">Pers. physique</span>':'<span class="badge bp">Pers. morale</span>';
    var r=t.insertRow();
    var encours=encoursForClient(c.name);
    r.innerHTML='<td style="font-weight:500;cursor:pointer;" title="Double-cliquer pour modifier" ondblclick="openAddClientModal(\''+escAttr(c.name)+'\')">'+escH(c.name)+'</td><td>'+typeBadge+'</td><td style="text-align:center;">'+_clientClassifBadge(c.classification)+'</td><td style="color:var(--text2);">'+(c.vendeur?escH(c.vendeur):'—')+'</td><td style="text-align:right;font-weight:600;color:var(--blue);" class="mono">'+(encours>0?fE(encours):'—')+'</td><td style="text-align:center;">'+nbD+'</td><td style="text-align:right;" class="mono">'+(totalNom>0?fE(totalNom):'—')+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+(totalUF>0?fE(totalUF):'—')+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+(totalRun>0?fE(totalRun):'—')+'</td><td class="mono" style="color:var(--text2);">'+escH(lastDate)+'</td>';
  });
}
function openAddClientModal(name){
  document.getElementById('clientModalTitle').textContent=name?'Modifier le client':'Nouveau client';
  document.getElementById('cName').value=name||'';
  document.getElementById('cName').dataset.original=name||'';
  if(name){
    var db=loadClientDB();var c=db.find(x=>x.name===name)||{};
    document.getElementById('cType').value=c.type||'PP';
    var clEl=document.getElementById('cClassif');if(clEl)clEl.value=c.classification||'';
    document.getElementById('cVendeur').value=c.vendeur||'';
    document.getElementById('cEmail').value=c.email||'';
    var ecDisp=document.getElementById('cEncoursDisplay');if(ecDisp){var ec=encoursForClient(c.name);ecDisp.textContent=ec>0?fE(ec):'— (aucun deal actif)';}
    document.getElementById('cNotes').value=c.notes||'';
    _loadClientProfileIntoModal(c.profile||{});
  } else {
    document.getElementById('cType').value='PP';
    var clEl2=document.getElementById('cClassif');if(clEl2)clEl2.value='';
    document.getElementById('cVendeur').value='';
    document.getElementById('cEmail').value='';
    var ecDisp2=document.getElementById('cEncoursDisplay');if(ecDisp2)ecDisp2.textContent='— (aucun deal pour l\'instant)';
    document.getElementById('cNotes').value='';
    _loadClientProfileIntoModal({});
  }
  document.getElementById('clientDeleteBtn').style.display=name?'':'none';
  var placeholder=document.getElementById('clientNewPlaceholder');
  if(placeholder)placeholder.style.display=name?'none':'flex';

  // KPIs encours
  var kpisDiv=document.getElementById('clientKpis');
  var kpisContent=document.getElementById('clientKpisContent');
  if(name){
    // Audit fix — respect vendor filter
    var cDeals=filt().filter(function(d){return d.client===name;});
    var totalNom=cDeals.reduce(function(s,d){return s+(d.dev==='EUR'?(d.nom||0):((d.nom||0)/(d.fx||1)));},0);
    var totalUF=cDeals.reduce(function(s,d){return s+(d.ufE||0);},0);
    var totalRun=cDeals.reduce(function(s,d){return s+(d.runE||0);},0);
    var nbDeals=cDeals.length;
    kpisDiv.style.display='block';
    kpisContent.innerHTML=
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">'+
      '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--rs);padding:10px;">'+
        '<div style="font-size:10px;color:var(--text3);">Nominaux</div>'+
        '<div style="font-size:16px;font-weight:600;color:var(--blue);">'+fE(totalNom)+'</div>'+
        '<div style="font-size:10px;color:var(--text3);">'+nbDeals+' deal'+(nbDeals>1?'s':'')+'</div>'+
      '</div>'+
      '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--rs);padding:10px;">'+
        '<div style="font-size:10px;color:var(--text3);">Running /an</div>'+
        '<div style="font-size:16px;font-weight:600;color:var(--green);">'+fE(totalRun)+'</div>'+
        (totalUF>0?'<div style="font-size:10px;color:var(--text3);">UF: '+fE(totalUF)+'</div>':'')+
      '</div>'+
      '</div>';
  } else {
    kpisDiv.style.display='none';
  }

  // Lignes d'investissement en cours
  var investSection=document.getElementById('clientInvestSection');
  var investLines=document.getElementById('clientInvestLines');
  if(name){
    var clientDeals=filt().filter(function(d){return d.client===name;}).sort(function(a,b){return (a.contrat||'').localeCompare(b.contrat||'');});
    if(clientDeals.length){
      investSection.style.display='block';
      // Grouper par contrat
      var byContrat={};
      clientDeals.forEach(function(d){
        var c=d.contrat||'Sans contrat';
        if(!byContrat[c])byContrat[c]=[];
        byContrat[c].push(d);
      });
      var html='';
      Object.entries(byContrat).forEach(function(entry){
        var contrat=entry[0],cDeals=entry[1];
        // Stats du contrat — sum across ALL codifs of all deals in this contract,
        // so a deal with mixed UF+Run codifs contributes correctly to each side
        // (Phase G.2 fix — was summing deal-level ufE/runE which was wrong for
        // mixed deals).
        var sumNomEUR=cDeals.reduce(function(s,d){return s+(_dealNomEur(d));},0);
        var sumUF=0, sumRun=0;
        cDeals.forEach(function(d){
          dealCodifsEffective(d).forEach(function(c){
            sumUF += (c.ufE||0);
            sumRun+= (c.runE||0);
          });
        });

        html+='<div style="margin-bottom:14px;">'+
          // En-tête contrat avec récap
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface2);border-radius:8px 8px 0 0;border:1px solid var(--border);border-bottom:none;">'+
            '<div style="font-size:12px;font-weight:600;color:var(--text);text-transform:uppercase;letter-spacing:.3px;">'+escH(contrat)+'</div>'+
            '<div style="display:flex;gap:14px;font-size:11px;color:var(--text2);align-items:center;">'+
              '<span><b style="color:var(--text);">'+cDeals.length+'</b> deal'+(cDeals.length>1?'s':'')+'</span>'+
              '<span><b style="color:var(--text);">'+fE(sumNomEUR)+'</b></span>'+
              (sumUF>0?'<span style="color:var(--blue);"><b>'+fE(sumUF)+'</b> UF</span>':'')+
              (sumRun>0?'<span style="color:var(--green);"><b>'+fE(sumRun)+'</b>/an</span>':'')+
            '</div>'+
          '</div>'+
          // Liste des deals dans le contrat
          '<div style="border:1px solid var(--border);border-radius:0 0 8px 8px;border-top:none;background:var(--surface);">'+
          cDeals.map(function(d,i){
            var stMap={'Payé':{cls:'bg',color:'var(--green)'},'Facturé':{cls:'bb',color:'var(--blue)'},'À émettre':{cls:'ba',color:'var(--amber)'},'Litige':{cls:'br',color:'var(--red)'}};
            var st=stMap[d.fSt]||{cls:'bgr',color:'var(--text3)'};
            var statusBadge='<span class="badge '+st.cls+'">'+escH(d.fSt||'')+'</span>';
            // Phase G.2 — iterate codif-level entries so each product is shown
            // on its own line with its OWN fourn/produit/ct/fees. Replaces the
            // old "1 row per deal showing only the first codif" rendering.
            var codifEntries=dealCodifsEffective(d);
            var isMulti=codifEntries.length>1;
            var depChip=d.depositaire?'<span style="font-size:10px;color:var(--text3);background:var(--surface2);padding:1px 6px;border-radius:3px;white-space:nowrap;">📍 '+escH(d.depositaire)+'</span>':'';
            var isLast=i===cDeals.length-1;
            var idx=deals.indexOf(d);
            // Build the codif sub-rows.
            var subRows=codifEntries.map(function(c){
              var ctBadge=c.ct==='UF'?'<span class="badge bb">UF</span>':
                          c.ct==='RUN'?'<span class="badge bg">Running</span>':
                          c.ct==='BOTH'?'<span class="badge bb">UF</span><span class="badge bg" style="margin-left:3px;">Run</span>':'';
              var feesParts=[];
              if(c.ufE>0)  feesParts.push('<span style="color:var(--blue);font-weight:500;">'+fE(c.ufE)+'</span> UF ('+c.ufR+'%)');
              if(c.runE>0) feesParts.push('<span style="color:var(--green);font-weight:500;">'+fE(c.runE)+'</span>/an ('+c.runR+'%)');
              if(c.pf && c.pf.amount) feesParts.push('<span style="color:var(--purple);font-weight:500;">'+fE(c.pf.amount)+'</span> PF');
              var nomEur=Math.round((c.nominal||0)/(d.fx||1));
              return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px dashed var(--border);">'+
                '<div style="flex:1;min-width:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'+
                  '<span style="font-weight:600;font-size:12px;color:var(--text);">'+escH(c.fourn||'')+'</span>'+
                  '<span style="color:var(--text2);font-size:12px;">'+escH(c.produit||'(produit ?)')+'</span>'+
                  (c.isin?'<span class="mono" style="font-size:10px;color:var(--text3);">'+escH(c.isin)+'</span>':'')+
                  ctBadge+
                  (feesParts.length?'<span style="font-size:11px;color:var(--text2);">'+feesParts.join(' · ')+'</span>':'<span style="font-size:11px;color:var(--red);font-style:italic;">⚠ aucun frais</span>')+
                '</div>'+
                '<div style="flex-shrink:0;font-weight:600;font-size:12px;color:var(--text);" class="mono">'+f0(nomEur)+' '+escH(d.dev||'EUR')+'</div>'+
              '</div>';
            }).join('');
            // Header — when multi, surfaces the "X produits — cliquer pour détail" indicator.
            // When single, summary collapses to the codif's own row at the top (no need to
            // duplicate it as a sub-row).
            var headerInfo;
            if(isMulti){
              headerInfo=
                '<div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">'+
                  '<span class="client-deal-chev" style="display:inline-block;transition:transform .15s ease;font-size:10px;color:var(--text3);">▶</span>'+
                  '<span style="font-weight:600;font-size:13px;color:var(--text);">'+codifEntries.length+' produits</span>'+
                  '<span style="font-size:11px;color:var(--text3);font-style:italic;">cliquer pour détail</span>'+
                  depChip+
                '</div>';
            } else {
              // Single codif: show its data directly in the header (no expand needed
              // for content, just for actions). Same shape as before, but data from codif.
              var c0=codifEntries[0]||{};
              headerInfo=
                '<div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">'+
                  '<span class="client-deal-chev" style="display:inline-block;transition:transform .15s ease;font-size:10px;color:var(--text3);">▶</span>'+
                  '<span style="font-weight:600;font-size:13px;color:var(--text);">'+escH(c0.fourn||'')+'</span>'+
                  '<span style="color:var(--text2);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;">'+escH(c0.produit||'(produit ?)')+'</span>'+
                  (c0.isin?'<span class="mono" style="font-size:10px;color:var(--text3);">'+escH(c0.isin)+'</span>':'')+
                  depChip+
                '</div>';
            }
            // For the right-side header data: amount + status. Use deal total nominal.
            var nomEurTotal=_dealNomEur(d);
            return '<div class="client-deal-row" data-deal-idx="'+idx+'" data-multi="'+(isMulti?'1':'0')+'" style="border-bottom:'+(isLast?'none':'1px solid var(--border)')+';transition:background .12s;">'+
              '<div style="display:flex;cursor:pointer;" onclick="toggleClientDealRow(this.parentElement)" onmouseover="this.style.background=\'var(--surface2)\'" onmouseout="this.style.background=\'\'">'+
                // Bandeau couleur statut
                '<div style="width:3px;background:'+st.color+';flex-shrink:0;"></div>'+
                '<div style="flex:1;padding:10px 12px;min-width:0;">'+
                  '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:'+(isMulti?'0':'5px')+';">'+
                    headerInfo+
                    '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">'+
                      '<span style="font-weight:600;font-size:13px;color:var(--text);" class="mono">'+f0(nomEurTotal)+' '+escH(d.dev||'')+'</span>'+
                      statusBadge+
                    '</div>'+
                  '</div>'+
                  // Single-codif quick stats line (multi-codif gets stats on expand only)
                  (!isMulti?
                    (function(){
                      var c0=codifEntries[0]||{};
                      var ctBadge=c0.ct==='UF'?'<span class="badge bb">UF</span>':
                                  c0.ct==='RUN'?'<span class="badge bg">Running</span>':
                                  c0.ct==='BOTH'?'<span class="badge bb">UF</span><span class="badge bg" style="margin-left:3px;">Run</span>':'';
                      var fp=[];
                      if(c0.ufE>0)  fp.push('<span style="color:var(--blue);font-weight:500;">'+fE(c0.ufE)+'</span> UF ('+c0.ufR+'%)');
                      if(c0.runE>0) fp.push('<span style="color:var(--green);font-weight:500;">'+fE(c0.runE)+'</span>/an ('+c0.runR+'%)');
                      if(c0.pf && c0.pf.amount) fp.push('<span style="color:var(--purple);font-weight:500;">'+fE(c0.pf.amount)+'</span> PF');
                      return '<div style="display:flex;align-items:center;gap:8px;font-size:11px;padding-left:18px;">'+
                        ctBadge+
                        (fp.length?'<span style="color:var(--text2);">'+fp.join(' · ')+'</span>':'<span style="color:var(--red);font-style:italic;">⚠ aucun frais — vérifier le catalogue produit</span>')+
                      '</div>';
                    })()
                  :'')+
                '</div>'+
              '</div>'+
              // Codif sub-rows panel (always rendered, visible only when expanded)
              // — for multi, this is the "details des produits". For single, it's
              // hidden because the header already shows the data.
              (isMulti?
                '<div class="client-deal-subrows" style="display:none;padding:6px 12px 4px 18px;background:var(--surface);border-top:1px dashed var(--border);">'+subRows+'</div>'
              :'')+
              // Action panel — Arbitrer / Retirer / Détail. Per-deal (not per-codif).
              '<div class="client-deal-actions" style="display:none;padding:8px 12px 12px 18px;background:var(--surface2);border-top:1px dashed var(--border);">'+
                '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">'+
                  '<span style="font-size:11px;color:var(--text3);margin-right:4px;">Actions :</span>'+
                  '<button class="btn btn-sm" onclick="event.stopPropagation();closeClientModal();openDet(deals['+idx+'])" style="font-size:11px;padding:4px 10px;white-space:nowrap;" title="Voir le détail complet du deal">📄 Détail</button>'+
                  '<button class="btn btn-sm" onclick="event.stopPropagation();closeClientModal();openArbitrage('+idx+')" style="font-size:11px;padding:4px 10px;white-space:nowrap;" title="Arbitrer ce deal">⇄ Arbitrer</button>'+
                  '<button class="btn btn-sm" onclick="event.stopPropagation();closeClientModal();openRetrait('+idx+')" style="font-size:11px;padding:4px 10px;white-space:nowrap;color:var(--amber-t);border-color:rgba(176,122,16,.3);background:var(--amber-bg);" title="Retrait de cash sur ce deal">↓ Retirer</button>'+
                '</div>'+
              '</div>'+
            '</div>';
          }).join('')+
          '</div>'+
        '</div>';
      });
      investLines.innerHTML=html;
    } else {
      investSection.style.display='block';
      investLines.innerHTML='<div class="empty">Aucun deal enregistré pour ce client.</div>';
    }
  } else {
    investSection.style.display='none';
    investLines.innerHTML='';
  }
  // Historique des opérations — extracted to renderClientHistory() so the
  // "Masquer les payés" toggle can re-render without re-opening the modal.
  // Per Oscar's request (Phase C.1): history is COLLAPSED by default each time
  // the modal opens. The user clicks the header to expand. The "Masquer payés"
  // checkbox shows only when the section is expanded.
  _currentClientHistName=name||null;
  _clientHistShowPaid=false; // reset unfold-override per client
  _clientHistExpanded=false; // collapsed by default on each open
  var hpCb=document.getElementById('cHidePaid');if(hpCb)hpCb.checked=false; // default = show all
  _applyClientHistExpandedState();
  renderClientHistory();
  setTimeout(()=>document.getElementById('cName').focus(),50);
  document.getElementById('clientModal').classList.add('on');
}
// Phase C.1 — collapsible history. State lives in _clientHistExpanded (boolean).
var _clientHistExpanded=false;
function toggleClientHistory(){
  _clientHistExpanded=!_clientHistExpanded;
  _applyClientHistExpandedState();
}
// Phase C.2 — toggle the action panel on a portfolio row. Collapses any other
// expanded row in the same list so only one is open at a time (less visual noise).
// Phase G.2 — also reveals the codif sub-rows (.client-deal-subrows) when the
// row is a multi-codif deal. Hidden by default, visible when expanded.
function toggleClientDealRow(row){
  if(!row)return;
  var panel=row.querySelector('.client-deal-actions');
  var subrows=row.querySelector('.client-deal-subrows');
  var chev=row.querySelector('.client-deal-chev');
  var isOpen=panel&&panel.style.display!=='none';
  // Collapse all others first
  var list=row.parentElement;
  if(list){
    list.querySelectorAll('.client-deal-row').forEach(function(r){
      var p=r.querySelector('.client-deal-actions');
      var s=r.querySelector('.client-deal-subrows');
      var c=r.querySelector('.client-deal-chev');
      if(p)p.style.display='none';
      if(s)s.style.display='none';
      if(c)c.style.transform='rotate(0deg)';
    });
  }
  // Toggle the clicked one (opens if it was closed, stays closed if user re-clicks an already-open)
  if(panel) panel.style.display=isOpen?'none':'block';
  if(subrows) subrows.style.display=isOpen?'none':'block';
  if(chev) chev.style.transform=isOpen?'rotate(0deg)':'rotate(90deg)';
}
function _applyClientHistExpandedState(){
  var lines=document.getElementById('clientHistLines');
  var chev=document.getElementById('clientHistChevron');
  var hpLbl=document.getElementById('clientHistHidePaidLbl');
  if(lines) lines.style.display=_clientHistExpanded?'block':'none';
  if(chev) chev.style.transform=_clientHistExpanded?'rotate(90deg)':'rotate(0deg)';
  if(hpLbl) hpLbl.style.display=_clientHistExpanded?'flex':'none';
}
function closeClientModal(){document.getElementById('clientModal').classList.remove('on');document.getElementById('cName').dataset.original='';_currentClientHistName=null;}

// Batch A.4 — extracted history renderer so the "Masquer les payés" toggle
// can re-render in place. State lives in _currentClientHistName.
var _currentClientHistName=null;
var _clientHistShowPaid=false; // override when user clicks the "+ X payés masqués" link
function _isEventPaid(ev){
  if(ev.kind!=='deal'&&ev.kind!=='arb')return false;
  var d=ev.deal;
  if(!d)return false;
  // Audit fix — fSt values are 'À émettre' | 'Facturé' | 'Payé' | 'Litige' (NOT 'Facture payée'); previous string never matched
  return d.stat==='Deal payé'||d.fSt==='Payé';
}
function _renderHistDealRow(ev){
  var d=ev.deal;
  var isArb=d.arbId||d.arbSrc;
  var icon=isArb?'⇄':'●';
  var color=isArb?'var(--purple,#7c3aed)':'var(--blue)';
  var label=isArb?'Arbitrage':'Deal';
  var typeBadge=d.ct==='UF'?'<span class="badge bb">UF</span>':d.ct==='RUN'?'<span class="badge bg">Running</span>':'<span class="badge bb">UF+Run</span>';
  var paidBadge=_isEventPaid(ev)?'<span class="badge" style="background:rgba(34,139,69,.15);color:#1e7f3a;margin-left:4px;">✓ Payé</span>':'';
  var fees='';
  if(d.ufE>0)fees+=fE(d.ufE)+' UF';
  if(d.runE>0)fees+=(fees?' · ':'')+fE(d.runE)+'/an';
  if(d.pf&&d.pf.amount)fees+=(fees?' · ':'')+fE(d.pf.amount)+' PF';
  return '<div style="position:relative;margin-bottom:12px;'+(_isEventPaid(ev)?'opacity:.65;':'')+'">'+
    '<div style="position:absolute;left:-18px;top:3px;color:'+color+';font-size:14px;font-weight:700;">'+icon+'</div>'+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;">'+
      '<div>'+
        '<span style="font-size:11px;color:var(--text3);">'+escH(d.date||'')+'</span>'+
        '<span style="font-size:11px;color:var(--text3);margin-left:6px;">'+label+'</span>'+
        paidBadge+
        '<div style="font-weight:500;margin-top:2px;">'+escH(d.fourn||'')+' — '+escH(d.produit||'')+'</div>'+
        (d.notes&&d.notes!=='Deal test'?'<div style="font-size:11px;color:var(--text3);margin-top:1px;font-style:italic;">'+escH(d.notes)+'</div>':'')+
      '</div>'+
      '<div style="text-align:right;flex-shrink:0;margin-left:12px;">'+
        typeBadge+
        '<div style="font-size:12px;color:var(--blue);font-weight:500;margin-top:3px;">'+fE(d.nom)+' '+escH(d.dev||'')+'</div>'+
        (fees?'<div style="font-size:11px;color:var(--text2);">'+fees+'</div>':'')+
      '</div>'+
    '</div>'+
  '</div>';
}
function _renderHistRetraitRow(ev){
  var r=ev.retrait,p=ev.prod,sd=ev.srcDeal;
  var icon='↓',color='var(--amber)',label='Retrait'+(r.closed?' (clôture)':'');
  var srcLabel=sd?(escH(sd.fourn||'')+' — '+escH(sd.produit||'')):escH(p.name||'(produit)');
  var dev=sd?(sd.dev||'EUR'):'EUR';
  return '<div style="position:relative;margin-bottom:12px;">'+
    '<div style="position:absolute;left:-18px;top:3px;color:'+color+';font-size:14px;font-weight:700;">'+icon+'</div>'+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;">'+
      '<div>'+
        '<span style="font-size:11px;color:var(--text3);">'+escH(r.date||'')+'</span>'+
        '<span style="font-size:11px;color:var(--amber-t);margin-left:6px;font-weight:500;">'+label+'</span>'+
        '<div style="font-weight:500;margin-top:2px;">'+srcLabel+'</div>'+
        (r.note?'<div style="font-size:11px;color:var(--text3);margin-top:1px;font-style:italic;">'+escH(r.note)+'</div>':'')+
      '</div>'+
      '<div style="text-align:right;flex-shrink:0;margin-left:12px;">'+
        '<span class="badge ba">↓ Cash retiré</span>'+
        '<div style="font-size:12px;color:var(--amber-t);font-weight:600;margin-top:3px;">−'+fE(r.montant||0)+' '+escH(dev)+'</div>'+
        (r.prorata_run?'<div style="font-size:11px;color:var(--text2);">+ pro-rata '+fE(r.prorata_run)+'</div>':'')+
      '</div>'+
    '</div>'+
  '</div>';
}
function renderClientHistory(){
  var name=_currentClientHistName;
  var histSection=document.getElementById('clientHistSection');
  var histLines=document.getElementById('clientHistLines');
  if(!histSection||!histLines)return;
  if(!name){histSection.style.display='none';histLines.innerHTML='';return;}
  // Collect events (deals + retraits) for this client
  var events=[];
  // Audit fix — respect vendor filter in the history timeline
  filt().filter(function(d){return d.client===name;}).forEach(function(d){
    events.push({kind:d.arbId||d.arbSrc?'arb':'deal',date:d.date||'',deal:d});
  });
  contracts_db.forEach(function(c){
    if(c.client!==name)return;
    (c.produits||[]).forEach(function(p){
      (p.retraits||[]).forEach(function(r){
        var srcDeal=p.deal_id?deals.find(function(x){return x._id===p.deal_id;}):null;
        events.push({kind:'retrait',date:r.date||'',retrait:r,prod:p,contract:c,srcDeal:srcDeal});
      });
    });
  });
  if(!events.length){histSection.style.display='none';return;}
  histSection.style.display='block';
  // Surface the count on the collapsed header so Oscar knows there's content waiting.
  var countEl=document.getElementById('clientHistCount');
  if(countEl) countEl.textContent='('+events.length+' opération'+(events.length>1?'s':'')+')';
  events.sort(function(a,b){return (b.date||'').localeCompare(a.date||'');});
  // Filter logic — checkbox "Masquer les payés" + override flag set by the unfold link
  var cb=document.getElementById('cHidePaid');
  var hide=cb&&cb.checked&&!_clientHistShowPaid;
  var paidCount=events.filter(_isEventPaid).length;
  var visible=hide?events.filter(function(e){return !_isEventPaid(e);}):events;
  var html='<div style="border-left:2px solid var(--border);padding-left:12px;">';
  visible.forEach(function(ev){
    html+=ev.kind==='retrait'?_renderHistRetraitRow(ev):_renderHistDealRow(ev);
  });
  html+='</div>';
  // Footer : if filter active and some events were hidden, show an "unfold" link
  if(hide&&paidCount>0){
    html+='<div style="text-align:center;margin-top:8px;">'+
      '<a onclick="_unfoldPaidEvents()" style="cursor:pointer;font-size:11px;color:var(--text3);text-decoration:underline;">'+
        '+ '+paidCount+' opération'+(paidCount>1?'s':'')+' payée'+(paidCount>1?'s':'')+' masquée'+(paidCount>1?'s':'')+' (afficher)'+
      '</a>'+
    '</div>';
  } else if(!hide&&_clientHistShowPaid&&cb&&cb.checked){
    html+='<div style="text-align:center;margin-top:8px;">'+
      '<a onclick="_refoldPaidEvents()" style="cursor:pointer;font-size:11px;color:var(--text3);text-decoration:underline;">'+
        '↑ Masquer à nouveau les payés'+
      '</a>'+
    '</div>';
  }
  histLines.innerHTML=html;
}
function _unfoldPaidEvents(){_clientHistShowPaid=true;renderClientHistory();}
function _refoldPaidEvents(){_clientHistShowPaid=false;renderClientHistory();}
function _onHidePaidToggle(){_clientHistShowPaid=false;renderClientHistory();}

// ── Batch E.2 — Perf rétro-commissions Excel import (LFIS template) ───────────
var _sheetJsPromise=null;
function _loadSheetJS(){
  if(window.XLSX)return Promise.resolve(window.XLSX);
  if(_sheetJsPromise)return _sheetJsPromise;
  _sheetJsPromise=new Promise(function(resolve,reject){
    var s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload=function(){resolve(window.XLSX);};
    s.onerror=function(){reject(new Error('Échec chargement SheetJS depuis CDN'));};
    document.head.appendChild(s);
  });
  return _sheetJsPromise;
}
var _pendingPerfImport=null; // {periodLabel, matched, unmatched, fileName}
async function _handlePerfImport(file){
  if(!file)return;
  toast('Chargement '+file.name+'…');
  try{
    var XLSX=await _loadSheetJS();
    var buf=await file.arrayBuffer();
    var wb=XLSX.read(buf,{type:'array',cellDates:true});
    if(!wb.SheetNames||!wb.SheetNames.length){alert('Fichier vide.');return;}
    // Find the Synthèse sheet — exact match or fuzzy
    var synthName=wb.SheetNames.find(function(n){return /synth/i.test(n);});
    if(!synthName){alert('Aucun onglet "Synthèse" trouvé dans le fichier.');return;}
    var rows=XLSX.utils.sheet_to_json(wb.Sheets[synthName],{header:1,defval:null});
    // Find header row containing "ISIN"
    var headerIdx=rows.findIndex(function(r){return r&&r.some(function(c){return String(c||'').trim()==='ISIN';});});
    if(headerIdx===-1){alert('Colonne "ISIN" introuvable dans l\'onglet Synthèse.');return;}
    var headers=rows[headerIdx].map(function(h){return String(h||'').trim();});
    var col=function(name){return headers.indexOf(name);};
    var dataRows=rows.slice(headerIdx+1).filter(function(r){return r&&r[col('ISIN')];});
    // Extract period label (e.g. "1T2026" or "Q1 2026") from cells above the header
    var periodLabel='?';
    for(var i=0;i<headerIdx;i++){
      var rr=rows[i];if(!rr)continue;
      var s=rr.map(function(c){return String(c||'');}).join(' ');
      var m=s.match(/(\d[T])(\d{4})|du\s+(\d{2}\/\d{2}\/\d{4}).*au\s+(\d{2}\/\d{2}\/\d{4})/i);
      if(m){periodLabel=(m[1]&&m[2])?(m[1]+m[2]):(m[3]+' → '+m[4]);break;}
    }
    var items=dataRows.map(function(r){return{
      isin:String(r[col('ISIN')]||'').trim(),
      libelle:String(r[col('Libellé')]||'').trim(),
      onglet:String(r[col('Onglet')]||'').trim(),
      tauxRetro:Number(r[col('Taux rétro.')]||0),
      derPosition:Number(r[col('Dernière position')]||0),
      derEncours:Number(r[col('Dernier encours')]||0),
      encoursMoyen:Number(r[col('Encours moyen')]||0),
      montantHT:Number(r[col('Montant HT')]||0),
      montantTTC:Number(r[col('Montant TTC')]||0),
      devise:String(r[col('Devise du contrat')]||'EUR').trim()
    };}).filter(function(it){return it.isin;});
    // Try to enrich with last VL from per-ISIN sheets
    items.forEach(function(it){
      var sn=wb.SheetNames.find(function(n){return n.indexOf(it.isin)!==-1;});
      if(!sn)return;
      var detail=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:null});
      // Header is the row containing "Date Facturation" / "VL" (typically row 2 = idx 1)
      var dHdrIdx=detail.findIndex(function(r){return r&&r.some(function(c){return String(c||'').trim()==='VL';});});
      if(dHdrIdx===-1)return;
      var dHeaders=detail[dHdrIdx].map(function(h){return String(h||'').trim();});
      var vlCol=dHeaders.indexOf('VL');
      var dateCol=dHeaders.indexOf('Date Position');
      if(dateCol===-1)dateCol=dHeaders.indexOf('Date Facturation');
      // Walk backwards to find the last row with a VL
      for(var k=detail.length-1;k>dHdrIdx;k--){
        var dr=detail[k];if(!dr||dr[vlCol]==null)continue;
        it.lastVL=Number(dr[vlCol]||0);
        var dv=dateCol>=0?dr[dateCol]:null;
        if(dv instanceof Date)it.lastVLDate=dv.toISOString().slice(0,10);
        else if(typeof dv==='string')it.lastVLDate=dv;
        break;
      }
    });
    // Match against fournisseur catalogue
    var matched=[],unmatched=[];
    items.forEach(function(it){
      var foundFourn=null,foundProd=null;
      for(var fi=0;fi<fourn_db.length;fi++){
        var f=fourn_db[fi];if(!Array.isArray(f.products))continue;
        for(var pi=0;pi<f.products.length;pi++){
          if(f.products[pi].isin===it.isin){foundFourn=f;foundProd=f.products[pi];break;}
        }
        if(foundFourn)break;
      }
      if(foundFourn&&foundProd)matched.push({item:it,fourn:foundFourn,product:foundProd});
      else unmatched.push(it);
    });
    _pendingPerfImport={periodLabel:periodLabel,matched:matched,unmatched:unmatched,fileName:file.name};
    _renderPerfImportModal();
  }catch(err){console.error('Perf import failed',err);alert('Erreur lecture Excel : '+(err.message||err));}
}
function _renderPerfImportModal(){
  if(!_pendingPerfImport)return;
  var p=_pendingPerfImport;
  document.getElementById('perfImportTitle').textContent='Import rétro-commissions — '+p.periodLabel;
  var body=document.getElementById('perfImportBody');
  var matchedRows=p.matched.map(function(m){
    var it=m.item;
    return '<tr style="background:rgba(34,139,69,.06);">'+
      '<td style="padding:5px 8px;border-bottom:1px solid var(--border);">'+escH(it.isin)+'</td>'+
      '<td style="padding:5px 8px;border-bottom:1px solid var(--border);"><b>'+escH(m.fourn.name)+'</b> / '+escH(m.product.part||it.libelle)+'</td>'+
      '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;font-family:monospace;font-size:11px;">'+(it.lastVL?it.lastVL.toFixed(4):'—')+'</td>'+
      '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;">'+(it.encoursMoyen?fE(it.encoursMoyen):'—')+'</td>'+
      '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--blue);font-weight:500;">'+(it.montantHT?fE(it.montantHT):'—')+'</td>'+
      '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--text3);font-size:11px;">'+(it.tauxRetro?(it.tauxRetro*100).toFixed(3)+'%':'—')+'</td>'+
    '</tr>';
  }).join('');
  var unmatchedRows=p.unmatched.map(function(it){
    return '<tr>'+
      '<td style="padding:5px 8px;border-bottom:1px solid var(--border);font-family:monospace;font-size:11px;">'+escH(it.isin)+'</td>'+
      '<td style="padding:5px 8px;border-bottom:1px solid var(--border);">'+escH(it.libelle)+'</td>'+
      '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--text2);">'+(it.encoursMoyen?fE(it.encoursMoyen):'—')+'</td>'+
      '<td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--text2);">'+(it.montantHT?fE(it.montantHT):'—')+'</td>'+
    '</tr>';
  }).join('');
  body.innerHTML=
    '<div style="background:var(--surface2);padding:10px 14px;border-radius:var(--rs);margin-bottom:12px;font-size:12px;">'+
      '<b>Fichier</b> : '+escH(p.fileName)+' &nbsp;·&nbsp; '+
      '<b>Période détectée</b> : '+escH(p.periodLabel)+' &nbsp;·&nbsp; '+
      '<span style="color:#1e7f3a;font-weight:600;">'+p.matched.length+' produit'+(p.matched.length>1?'s':'')+' matchés</span> &nbsp;·&nbsp; '+
      '<span style="color:'+(p.unmatched.length?'var(--amber-t)':'var(--text3)')+';">'+p.unmatched.length+' non matchés</span>'+
    '</div>'+
    (p.matched.length?'<div style="font-size:11px;color:var(--text2);font-weight:600;margin-bottom:6px;text-transform:uppercase;letter-spacing:.3px;">✓ Matchés (le valider mettra à jour le catalogue)</div>'+
      '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;">'+
        '<thead><tr style="background:var(--surface2);"><th style="padding:5px 8px;text-align:left;font-size:10px;color:var(--text3);">ISIN</th><th style="padding:5px 8px;text-align:left;font-size:10px;color:var(--text3);">Fournisseur / Produit</th><th style="padding:5px 8px;text-align:right;font-size:10px;color:var(--text3);">Dernier VL</th><th style="padding:5px 8px;text-align:right;font-size:10px;color:var(--text3);">Encours moyen</th><th style="padding:5px 8px;text-align:right;font-size:10px;color:var(--text3);">Montant HT</th><th style="padding:5px 8px;text-align:right;font-size:10px;color:var(--text3);">Taux rétro</th></tr></thead>'+
        '<tbody>'+matchedRows+'</tbody>'+
      '</table>':'')+
    (p.unmatched.length?'<div style="font-size:11px;color:var(--amber-t);font-weight:600;margin-bottom:6px;text-transform:uppercase;letter-spacing:.3px;">⚠ Non matchés (ajouter ces ISIN au catalogue Fournisseurs pour les importer)</div>'+
      '<table style="width:100%;border-collapse:collapse;font-size:12px;">'+
        '<thead><tr style="background:var(--surface2);"><th style="padding:5px 8px;text-align:left;font-size:10px;color:var(--text3);">ISIN</th><th style="padding:5px 8px;text-align:left;font-size:10px;color:var(--text3);">Libellé</th><th style="padding:5px 8px;text-align:right;font-size:10px;color:var(--text3);">Encours moyen</th><th style="padding:5px 8px;text-align:right;font-size:10px;color:var(--text3);">Montant HT</th></tr></thead>'+
        '<tbody>'+unmatchedRows+'</tbody>'+
      '</table>':'');
  document.getElementById('perfImportConfirmBtn').textContent=p.matched.length?'Valider l\'import ('+p.matched.length+' produits)':'Aucun matché — fermer';
  document.getElementById('perfImportConfirmBtn').disabled=!p.matched.length;
  document.getElementById('perfImportModal').classList.add('on');
}
function closePerfImportModal(){
  document.getElementById('perfImportModal').classList.remove('on');
  _pendingPerfImport=null;
}
async function confirmPerfImport(){
  if(!_pendingPerfImport||!_pendingPerfImport.matched.length){closePerfImportModal();return;}
  var p=_pendingPerfImport;
  var todayStr=today();
  var savedCount=0;
  for(var i=0;i<p.matched.length;i++){
    var m=p.matched[i];
    // Update the latest summary fields (used for KPIs / récap)
    m.product.latestVL=m.item.lastVL||null;
    m.product.latestVLDate=m.item.lastVLDate||null;
    m.product.latestEncours=m.item.derEncours||null;
    m.product.latestEncoursMoyen=m.item.encoursMoyen||null;
    m.product.latestRetroHT=m.item.montantHT||null;
    m.product.latestRetroTTC=m.item.montantTTC||null;
    m.product.lastImportDate=todayStr;
    m.product.lastImportPeriod=p.periodLabel;
    m.product.lastImportFileName=p.fileName;
    // Append to vlHistory — keyed by date, idempotent (re-import same period = update, not duplicate).
    // This is the data driving the perf graph + over-perf calc.
    if(m.item.lastVL!=null&&m.item.lastVLDate){
      m.product.vlHistory=Array.isArray(m.product.vlHistory)?m.product.vlHistory:[];
      var existing=m.product.vlHistory.find(function(h){return h.date===m.item.lastVLDate;});
      if(existing){
        existing.vl=m.item.lastVL;
        existing.encours=m.item.derEncours||null;
        existing.encoursMoyen=m.item.encoursMoyen||null;
        existing.period=p.periodLabel;
      } else {
        m.product.vlHistory.push({
          date:m.item.lastVLDate,
          vl:m.item.lastVL,
          encours:m.item.derEncours||null,
          encoursMoyen:m.item.encoursMoyen||null,
          retroHT:m.item.montantHT||null,
          period:p.periodLabel
        });
      }
      // Keep chronological order — useful for the graph
      m.product.vlHistory.sort(function(a,b){return (a.date||'').localeCompare(b.date||'');});
    }
    try{await sbUpdateFournSafe(m.fourn._id,m.fourn,m.fourn);savedCount++;}catch(e){console.error('Save fourn failed',m.fourn.name,e);}
  }
  closePerfImportModal();
  toast('Import validé — '+savedCount+' produit(s) mis à jour avec les données '+p.periodLabel+'.');
  if(typeof renderFourn==='function')renderFourn();
  if(typeof renderSuiviPerf==='function')renderSuiviPerf();
}

// ── Suivi Perf — page dédiée (import LFIS + tableau + graph + perf fees over-perf) ──
var _perfSortKey='fourn',_perfSortDir=1;
var _perfChartMode='base'; // 'base' (100=premier import) ou 'abs' (VL réelle)
var _perfChartInstance=null;
function setPerfSort(k){
  if(_perfSortKey===k)_perfSortDir=-_perfSortDir;
  else{_perfSortKey=k;_perfSortDir=1;}
  renderSuiviPerf();
}
function setPerfChartMode(m,btn){
  _perfChartMode=m;
  ['perfChartModeAbs','perfChartModeBase'].forEach(function(id){
    var b=document.getElementById(id);if(b){b.style.background='';b.style.color='';b.style.borderColor='';}
  });
  if(btn){btn.style.background='var(--text)';btn.style.color='var(--surface)';btn.style.borderColor='var(--text)';}
  renderSuiviPerf();
}
// Aggregate all products across SDG fournisseurs that have vlHistory (= have been imported).
function _collectPerfProducts(){
  var out=[];
  fourn_db.forEach(function(f){
    if(f.famille!=='SDG'||!Array.isArray(f.products))return;
    f.products.forEach(function(p){
      if(!p||!p.isin)return;
      if(!Array.isArray(p.vlHistory)||!p.vlHistory.length)return;
      out.push({fourn:f,product:p});
    });
  });
  return out;
}
// For a given (fourn, isin) — sum up matching codifications across all active deals.
function _perfDealMatches(fournName,isin){
  if(!fournName||!isin)return [];
  var matches=[];
  deals.forEach(function(d){
    if(d.archived||!Array.isArray(d.codifications))return;
    d.codifications.forEach(function(c,idx){
      if(c.fourn===fournName&&c.isin===isin&&(c.nominal||0)>0){
        matches.push({deal:d,codif:c,idx:idx});
      }
    });
  });
  return matches;
}
// Compute the over-performance perf fee for a product based on its VL evolution
// AND any deals that reference it with a pf config.
// Returns {grossPerfPct, totalNominal, totalGain, totalPerfFee, perDealBreakdown}.
function _computePerfFees(fournName,isin,vl0,vl1){
  var dealMatches=_perfDealMatches(fournName,isin);
  if(!dealMatches.length||!vl0||!vl1||vl0===0)return{grossPerfPct:0,totalNominal:0,totalGain:0,totalPerfFee:0,perDealBreakdown:[]};
  var grossPerfPct=((vl1-vl0)/vl0)*100;
  var totalNominal=0,totalGain=0,totalPerfFee=0;
  var breakdown=[];
  dealMatches.forEach(function(m){
    var nom=m.codif.nominal||0;
    var nomEur=(m.deal.dev==='EUR'||!m.deal.dev)?nom:nom/(m.deal.fx||1);
    var gain=nomEur*(grossPerfPct/100);
    totalNominal+=nomEur;totalGain+=gain;
    var pf=m.codif.pf||{};
    var perfFee=0;
    if(pf.mode==='pct'&&pf.rate>0){
      var hurdle=pf.hurdle||0;
      var overPerf=grossPerfPct-hurdle;
      if(overPerf>0){
        // Perf fee € = nominal × overPerf% × rate% / 10000
        perfFee=nomEur*overPerf*pf.rate/10000;
      }
    } else if(pf.mode==='fixed'&&pf.amount>0){
      // Fixed perf fee — applies once if over-performing
      if(grossPerfPct>(pf.hurdle||0))perfFee=pf.amount;
    }
    totalPerfFee+=perfFee;
    // Include codif + codifIdx so callers (Phase E.5 push action) can write back the
    // computed perfFee onto the exact codification it applies to.
    breakdown.push({deal:m.deal,codif:m.codif,codifIdx:m.idx,nominal:nomEur,gain:gain,perfFee:perfFee,pf:pf});
  });
  return{grossPerfPct:grossPerfPct,totalNominal:totalNominal,totalGain:totalGain,totalPerfFee:totalPerfFee,perDealBreakdown:breakdown};
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase E.5 — Push computed perf fees from Suivi Perf into the Facturation tab.
// ═══════════════════════════════════════════════════════════════════════════
// What this does:
//   1. Walk every imported product (= has vlHistory).
//   2. Compute its perf fee via _computePerfFees(fourn, isin, vl0, vl1).
//   3. For each deal × codification matching (fourn, isin), set
//      codif.pf.amount = computed perfFee (rounded to €).
//      Also mirror to deal-level d.pf.amount for the first matching codif so
//      legacy Facturation Perf-fees-tab filter (d.pf.amount > 0) catches it.
//   4. Save updated deals to Supabase via sbUpdate.
//   5. Toast summary + refresh Facturation page.
//
// Idempotency:
//   - If a deal's codif already has a non-zero pf.amount AND it's currently in
//     state 'Facturé' or 'Payé' on the perf side, we DON'T overwrite (don't
//     re-bill what's already invoiced).
//   - If the computed perfFee is 0 (= perf hasn't crossed hurdle yet), we DON'T
//     clear an existing non-zero pf.amount (the user might be in mid-cycle).
//   - User gets prompted to confirm before any DB write.
//
// Returns: a summary object with counts, surfaced in a toast.
async function pushPerfFeesToFacturation(){
  // Gather every product with VL history → compute perf fee → collect breakdown rows
  var allItems = (typeof _collectPerfProducts==='function')?_collectPerfProducts():[];
  var rowsToPush = [];
  allItems.forEach(function(x){
    var h = x.product.vlHistory||[];
    if(h.length<2) return; // need at least 2 VL points to compute a perf
    var vl0 = (h[0]||{}).vl||0;
    var vl1 = (h[h.length-1]||{}).vl||0;
    if(!vl0) return;
    var calc = _computePerfFees(x.fourn.name, x.product.isin, vl0, vl1);
    (calc.perDealBreakdown||[]).forEach(function(b){
      if(!b.perfFee || b.perfFee<=0) return; // skip rows below hurdle
      rowsToPush.push({
        fourn: x.fourn.name,
        isin:  x.product.isin,
        part:  x.product.part||'',
        deal:  b.deal,
        codif: b.codif,
        codifIdx: b.codifIdx,
        perfFee: Math.round(b.perfFee),
        perfPct: calc.grossPerfPct
      });
    });
  });
  if(!rowsToPush.length){
    toast('Rien à pousser — aucun produit n\'a généré de perf fee (hurdle non franchi ou pas de deals).');
    return;
  }
  // Aggregate by deal so we save each deal once even if multiple codifs change.
  var perDeal = new Map();
  rowsToPush.forEach(function(r){
    if(!perDeal.has(r.deal)) perDeal.set(r.deal, []);
    perDeal.get(r.deal).push(r);
  });
  // Idempotency check — count rows that would actually change
  var willChange = 0, willSkipFacturé = 0, willSkipSame = 0;
  rowsToPush.forEach(function(r){
    var c = r.codif;
    var existing = (c&&c.pf&&c.pf.amount)||0;
    // Skip if the codif's deal is already at Facturé/Payé state on the PF side
    // (= already invoiced, don't overwrite). For now we use deal-level fSt because
    // per-codif fSt is a Phase D.5 concern.
    if(r.deal && (r.deal.fSt==='Facturé' || r.deal.fSt==='Payé') && existing>0){
      willSkipFacturé++; return;
    }
    if(existing===r.perfFee){ willSkipSame++; return; }
    willChange++;
  });
  var totalPushed = rowsToPush.reduce(function(s,r){return s+r.perfFee;},0);
  var msg = 'Pousser '+willChange+' perf fee'+(willChange>1?'s':'')+' vers la facturation ?\n\n'+
            '· Total à pousser : '+fE(totalPushed)+' €\n'+
            '· Deals concernés : '+perDeal.size+'\n'+
            (willSkipFacturé?'· Skip (déjà facturé/payé) : '+willSkipFacturé+'\n':'')+
            (willSkipSame?'· Skip (montant identique) : '+willSkipSame+'\n':'')+
            '\nLes deals modifiés apparaîtront sur l\'onglet Facturation > Perf fees.';
  if(!confirm(msg)) return;
  // Execute — write codif.pf.amount on each row and persist the parent deal.
  var savedDeals = 0, errors = 0;
  for(var [dealRef, dealRows] of perDeal){
    if(!dealRef) continue;
    // Skip if facturé/payé and an amount already exists
    var skipDeal = false;
    dealRows.forEach(function(r){
      if(dealRef.fSt==='Facturé' || dealRef.fSt==='Payé'){
        var ex=(r.codif&&r.codif.pf&&r.codif.pf.amount)||0;
        if(ex>0) skipDeal=true;
      }
    });
    if(skipDeal) continue;
    var changed = false;
    dealRows.forEach(function(r){
      var c = r.codif; if(!c) return;
      c.pf = c.pf || {mode:'pct'};
      if(c.pf.amount === r.perfFee) return;
      c.pf.amount = r.perfFee;
      c.pf.lastComputed = new Date().toISOString();
      changed = true;
    });
    // Mirror to deal-level pf so the legacy Facturation filter (d.pf.amount > 0)
    // catches it. Use the first changed codif's pf as the deal-level summary.
    if(changed){
      var firstChanged = dealRows.find(function(r){return r.codif && r.codif.pf && r.codif.pf.amount>0;});
      if(firstChanged){
        dealRef.pf = dealRef.pf || {mode:firstChanged.codif.pf.mode||'pct'};
        // Sum every codif's perf fee on this deal for the deal-level amount
        var sumPf = (dealRef.codifications||[]).reduce(function(s,c){
          return s + ((c.pf && c.pf.amount)||0);
        },0);
        dealRef.pf.amount = sumPf;
        if(firstChanged.codif.pf.mode) dealRef.pf.mode = firstChanged.codif.pf.mode;
      }
      // Push history entry on the deal
      dealRef.hist = dealRef.hist || [];
      dealRef.hist.push({
        ts: (typeof nowS==='function'?nowS():new Date().toISOString()),
        a: 'Perf fees poussées depuis Suivi Perf — '+dealRows.length+' codif·s (total '+fE(dealRows.reduce(function(s,r){return s+r.perfFee;},0))+' €)',
        by: 'Système'
      });
      // Save to Supabase
      if(dealRef._id){
        try{ await sbUpdate('deals', dealRef._id, dealRef); savedDeals++; }
        catch(e){ console.error('pushPerfFees save failed for deal '+dealRef._id, e); errors++; }
      } else {
        savedDeals++; // in-memory only (legacy local deals)
      }
    }
  }
  // Refresh affected pages
  if(typeof renderSuiviPerf==='function') renderSuiviPerf();
  if(typeof renderFact==='function') renderFact();
  if(typeof renderPFInvTable==='function') renderPFInvTable();
  if(typeof renderKpis==='function') renderKpis();
  var summary = '↗ '+savedDeals+' deal'+(savedDeals>1?'s':'')+' mis à jour · '+fE(totalPushed)+' € de perf fees poussées';
  if(errors) summary += ' ('+errors+' erreur'+(errors>1?'s':'')+')';
  toast(summary);
}
function renderSuiviPerf(){
  if(!document.getElementById('p-suivi-perf'))return;
  var allItems=_collectPerfProducts();
  // Refresh filters
  var fournSel=document.getElementById('perfFournFilter');
  var prodSel=document.getElementById('perfProductFilter');
  if(fournSel){
    var prevFourn=fournSel.value;
    var fournsWithData={};allItems.forEach(function(x){fournsWithData[x.fourn.name]=true;});
    var fournNames=Object.keys(fournsWithData).sort();
    fournSel.innerHTML='<option value="">Tous les fournisseurs ('+fournNames.length+')</option>'+
      fournNames.map(function(n){return '<option value="'+escH(n)+'"'+(n===prevFourn?' selected':'')+'>'+escH(n)+'</option>';}).join('');
  }
  var fournFilter=fournSel?fournSel.value:'';
  // Product filter — populated based on the selected fournisseur (or all if no filter)
  if(prodSel){
    var prevProd=prodSel.value;
    var prodOptions=allItems
      .filter(function(x){return !fournFilter||x.fourn.name===fournFilter;})
      .map(function(x){return{isin:x.product.isin,label:x.fourn.name+' · '+(x.product.part||'(sans nom)')+' · '+x.product.isin};});
    prodSel.innerHTML='<option value="">Tous les produits ('+prodOptions.length+')</option>'+
      prodOptions.map(function(p){return '<option value="'+escH(p.isin)+'"'+(p.isin===prevProd?' selected':'')+'>'+escH(p.label)+'</option>';}).join('');
  }
  var prodFilter=prodSel?prodSel.value:'';
  // Apply filters
  var filtered=allItems.filter(function(x){
    if(fournFilter&&x.fourn.name!==fournFilter)return false;
    if(prodFilter&&x.product.isin!==prodFilter)return false;
    return true;
  });
  // Build rows with metrics
  var rows=filtered.map(function(x){
    var h=x.product.vlHistory||[];
    var first=h[0]||{};
    var last=h[h.length-1]||{};
    var vl0=first.vl||0,vl1=last.vl||0;
    var perfPct=vl0?((vl1-vl0)/vl0)*100:0;
    var pfCalc=_computePerfFees(x.fourn.name,x.product.isin,vl0,vl1);
    return{
      fourn:x.fourn.name,isin:x.product.isin,part:x.product.part||'',unit:x.product.unit||'part',
      vl0:vl0,vl1:vl1,perfPct:perfPct,
      nominal:pfCalc.totalNominal,gain:pfCalc.totalGain,perfFee:pfCalc.totalPerfFee,
      date:last.date||x.product.latestVLDate||'',
      currency:x.product.currency||'EUR',
      vlHistory:h
    };
  });
  // Sort
  rows.sort(function(a,b){
    var k=_perfSortKey;
    var av=a[k],bv=b[k];
    if(typeof av==='string')return av.localeCompare(bv||'')*_perfSortDir;
    return ((av||0)-(bv||0))*_perfSortDir;
  });
  // Render summary
  var totalNom=rows.reduce(function(s,r){return s+(r.nominal||0);},0);
  var totalGain=rows.reduce(function(s,r){return s+(r.gain||0);},0);
  var totalPerfFee=rows.reduce(function(s,r){return s+(r.perfFee||0);},0);
  var sumEl=document.getElementById('perfImportSummary');
  if(sumEl){
    sumEl.innerHTML=rows.length+' produit'+(rows.length!==1?'s':'')+' · Total nominal : '+fE(totalNom)+' · Gain brut : '+(totalGain>=0?'+':'')+fE(Math.round(totalGain))+' · <b style="color:var(--purple);">Perf fees dues : '+fE(Math.round(totalPerfFee))+'</b>';
  }
  document.getElementById('perfTableCount').textContent=rows.length+' lignes';
  // Render table
  var t=document.getElementById('perfTable');
  while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('perfTableEmpty').style.display=rows.length?'none':'block';
  rows.forEach(function(r){
    var tr=t.insertRow();
    var perfColor=r.perfPct>0?'var(--green)':r.perfPct<0?'var(--red)':'var(--text2)';
    var unitBadge=r.unit==='share'?'<span class="badge bp" style="font-size:9px;">Share</span>':'<span class="badge bb" style="font-size:9px;">Part</span>';
    tr.innerHTML=
      '<td style="font-weight:500;">'+escH(r.fourn)+'</td>'+
      '<td class="mono" style="font-size:11px;">'+escH(r.isin)+'</td>'+
      '<td style="white-space:nowrap;">'+unitBadge+' <span style="color:var(--text2);font-size:12px;">'+escH(r.part)+'</span></td>'+
      '<td class="mono" style="text-align:right;">'+(r.vl0?r.vl0.toFixed(4):'—')+'</td>'+
      '<td class="mono" style="text-align:right;font-weight:500;">'+(r.vl1?r.vl1.toFixed(4):'—')+'</td>'+
      '<td style="text-align:right;font-weight:600;color:'+perfColor+';">'+(r.perfPct?(r.perfPct>0?'+':'')+r.perfPct.toFixed(2)+'%':'—')+'</td>'+
      '<td style="text-align:right;">'+(r.nominal?fE(Math.round(r.nominal)):'—')+'</td>'+
      '<td style="text-align:right;color:'+perfColor+';">'+(r.gain?(r.gain>=0?'+':'')+fE(Math.round(r.gain)):'—')+'</td>'+
      '<td style="text-align:right;color:var(--purple);font-weight:600;">'+(r.perfFee>0?fE(Math.round(r.perfFee)):'—')+'</td>'+
      '<td class="mono" style="text-align:right;color:var(--text2);font-size:11px;">'+escH(r.date)+'</td>';
  });
  // Render chart
  _renderPerfChart(rows);
}
function _renderPerfChart(rows){
  var canvas=document.getElementById('perfChart');
  if(!canvas||!window.Chart)return;
  if(_perfChartInstance){_perfChartInstance.destroy();_perfChartInstance=null;}
  if(!rows.length){document.getElementById('perfChartLegend').innerHTML='<span style="color:var(--text3);">Aucune donnée à afficher.</span>';return;}
  // Collect all unique dates across all rows
  var dateSet={};
  rows.forEach(function(r){(r.vlHistory||[]).forEach(function(h){if(h.date)dateSet[h.date]=true;});});
  var dates=Object.keys(dateSet).sort();
  if(!dates.length)return;
  var palette=PALETTE||['#1d5fd4','#1a8a4a','#6b4fc4','#b07a10','#c23b3b','#0ea5e9','#ec4899','#10b981','#8b5cf6','#f59e0b'];
  var datasets=rows.map(function(r,i){
    var color=palette[i%palette.length];
    var histByDate={};
    (r.vlHistory||[]).forEach(function(h){if(h.date)histByDate[h.date]=h.vl;});
    var vl0=r.vl0||0;
    var data=dates.map(function(d){
      var v=histByDate[d];
      if(v==null)return null;
      if(_perfChartMode==='base'&&vl0)return (v/vl0)*100;
      return v;
    });
    return{
      label:r.fourn+' / '+(r.part||r.isin),
      data:data,
      borderColor:color,
      backgroundColor:color+'22',
      tension:0.25,
      spanGaps:true,
      pointRadius:3,
      pointHoverRadius:5,
      borderWidth:2
    };
  });
  document.getElementById('perfChartScope').textContent=(rows.length===1)?'— '+rows[0].fourn+' / '+rows[0].part:'';
  _perfChartInstance=new Chart(canvas,{
    type:'line',
    data:{labels:dates,datasets:datasets},
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'nearest',axis:'x',intersect:false},
      plugins:{
        legend:{display:false},
        tooltip:Object.assign({},CHART_DEFAULTS.tooltip,{callbacks:{
          label:function(c){
            var v=c.parsed.y;if(v==null)return c.dataset.label+' : —';
            if(_perfChartMode==='base'){
              return c.dataset.label+' : '+v.toFixed(2)+' (base 100)'+(v>=100?' = +'+(v-100).toFixed(2)+'%':' = '+(v-100).toFixed(2)+'%');
            }
            return c.dataset.label+' : '+v.toFixed(4);
          }
        }})
      },
      scales:{
        x:{grid:{display:false,drawBorder:false},ticks:{color:'#6b6b65',font:CHART_DEFAULTS.font,maxRotation:0,autoSkipPadding:20}},
        y:{grid:{color:CHART_DEFAULTS.gridSoft,drawBorder:false},ticks:{color:'#9aa0a6',font:CHART_DEFAULTS.font,callback:function(v){return _perfChartMode==='base'?v.toFixed(0):v.toFixed(2);}}}
      }
    }
  });
  // Legend
  document.getElementById('perfChartLegend').innerHTML=datasets.map(function(ds){
    return '<span style="display:inline-flex;align-items:center;gap:5px;padding:2px 8px;background:var(--surface2);border-radius:999px;"><span style="width:8px;height:8px;border-radius:2px;background:'+ds.borderColor+';display:inline-block;"></span><span>'+escH(ds.label)+'</span></span>';
  }).join('');
}
function deleteClientFromModal(){var o=document.getElementById('cName').dataset.original;if(!o)return;closeClientModal();deleteClient(o);}
// Returns {contract, prod} if a Suivi-Contrats investissement is linked to this deal, else null.
// (First match only — kept for legacy callsites that just need a "is anything linked?" check.)
function findLinkedInvestissement(deal){
  if(!deal||!deal._id)return null;
  for(var i=0;i<contracts_db.length;i++){
    var c=contracts_db[i];
    if(!Array.isArray(c.produits))continue;
    var p=c.produits.find(function(x){return x.deal_id===deal._id;});
    if(p)return{contract:c,prod:p};
  }
  return null;
}

// Returns an array of {contract, prod} for EVERY produit row across contracts_db
// that's linked to this deal. A multi-fourn deal creates one produit per codif,
// so 1 deal → N produits on the same contract is common. 1 deal across multiple
// contracts is rare but possible (batched multi-contract creation). Used by
// the cascade-delete path so we purge every produit row in one go, not just
// the first match.
function findAllLinkedInvestissements(deal){
  if(!deal||!deal._id)return [];
  var out=[];
  for(var i=0;i<contracts_db.length;i++){
    var c=contracts_db[i];
    if(!Array.isArray(c.produits))continue;
    c.produits.forEach(function(p){
      if(p.deal_id===deal._id)out.push({contract:c,prod:p});
    });
  }
  return out;
}

// Cascade-delete helper (Oscar 2026-05-18 rule). When a deal is deleted, every
// contract produit row linked to that deal (produit.deal_id === deal._id) gets
// purged. If a contract is left with zero produits AFTER the purge, the contract
// itself is deleted — préliminaires sont per-investissement, sans investissement
// le suivi de contrat n'a plus de raison d'exister. Manually-created contracts
// have no produit.deal_id and are therefore never touched by this path.
// Returns {produitsRemoved, contractsDeleted, contractsKept} for toast messaging.
async function cascadeDeleteDealLinks(deal){
  var summary={produitsRemoved:0, contractsDeleted:0, contractsKept:0};
  if(!deal||!deal._id){
    console.warn('[cascade] skipped — deal has no _id', deal);
    return summary;
  }
  console.log('[cascade] start for deal._id=', deal._id, 'client=', deal.client);
  var affectedContracts=contracts_db.filter(function(c){
    return Array.isArray(c.produits) && c.produits.some(function(p){return p.deal_id===deal._id;});
  });
  console.log('[cascade] affected contracts:', affectedContracts.length);
  if(affectedContracts.length===0){
    // Diagnostic: surface why nothing linked. Common cause = produit.deal_id never
    // set (legacy data predating Phase K) OR contract was created manually so no
    // produit has a deal_id. The cascade is a no-op in both cases — by design.
    var anyProdAtAll=contracts_db.some(function(c){return (c.produits||[]).length>0;});
    var anyWithDealId=contracts_db.some(function(c){return (c.produits||[]).some(function(p){return p.deal_id;});});
    console.log('[cascade] DB has any produits:', anyProdAtAll, '· any with deal_id:', anyWithDealId);
  }
  for(var i=0;i<affectedContracts.length;i++){
    var c=affectedContracts[i];
    var before=(c.produits||[]).length;
    c.produits=(c.produits||[]).filter(function(p){return p.deal_id!==deal._id;});
    var removed=before - c.produits.length;
    summary.produitsRemoved += removed;
    console.log('[cascade] contract', c._id, '(', c.client, '): removed', removed, '/', before, '→ remaining', c.produits.length);
    if(c.produits.length===0){
      if(c._id){
        try{
          await sbDelete('contracts',c._id);
          console.log('[cascade] sbDelete contracts OK for', c._id);
        }catch(e){console.error('[cascade] sbDelete contracts FAILED for', c._id, e);}
      }
      var idx=contracts_db.indexOf(c);
      if(idx>=0)contracts_db.splice(idx,1);
      summary.contractsDeleted++;
    } else {
      try{
        await saveContract(c);
        console.log('[cascade] saveContract OK for', c._id);
      }catch(e){console.error('[cascade] saveContract FAILED for', c._id, e);}
      summary.contractsKept++;
    }
  }
  console.log('[cascade] done — summary:', JSON.stringify(summary));
  // Force a contracts re-render so the Suivi Contrats page reflects the cascade
  // even before the realtime echo arrives (paranoia: realtime can be slow).
  if(typeof rerenderForTable==='function'){
    try{ rerenderForTable('contracts'); }catch(e){}
  }
  return summary;
}

// Format a toast suffix describing the cascade outcome. Empty string if nothing
// was cascaded. Pluralisation in French because the toasts are French.
function _cascadeSummaryToast(s){
  if(!s||(s.produitsRemoved===0&&s.contractsDeleted===0))return '';
  var parts=[];
  if(s.produitsRemoved>0)parts.push(s.produitsRemoved+' investissement'+(s.produitsRemoved>1?'s':'')+' purgé'+(s.produitsRemoved>1?'s':''));
  if(s.contractsDeleted>0)parts.push(s.contractsDeleted+' contrat'+(s.contractsDeleted>1?'s':'')+' vidé'+(s.contractsDeleted>1?'s':'')+' supprimé'+(s.contractsDeleted>1?'s':''));
  return ' · '+parts.join(' + ');
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase L.3 — Duplicate detection (Oscar 2026-05-18)
// ═══════════════════════════════════════════════════════════════════════════
// 'Un doublon c'est littéralement 2 fois le même deal' — same dimensions in
// every field that identifies a deal as unique business-wise. The signature
// normalises whitespace + case so 'Ayal Cohen' / ' Ayal  Cohen ' /
// 'ayal cohen' all collide. Used by both the inline saveDeal check AND the
// retroactive scanner — single source of truth.
function _dealDuplicateSignature(d){
  if(!d) return '';
  var firstCodif = (d.codifications && d.codifications[0]) || {};
  var fourn = (d.fourn || firstCodif.fourn || '').trim().toLowerCase();
  var isin  = (d.isin  || firstCodif.isin  || '').trim().toUpperCase();
  var prod  = (d.produit || firstCodif.produit || '').trim().toLowerCase();
  var prodKey = isin || prod;
  return [
    (d.client || '').trim().toLowerCase(),
    (d.contrat || '').trim().toLowerCase(),
    (d.date || '').trim(),
    Math.round((d.nom || 0) * 100),
    (d.dev || 'EUR').trim().toUpperCase(),
    (d.v || '').trim().toLowerCase(),
    fourn,
    prodKey
  ].join('|');
}

function _scanDuplicateDeals(){
  var bySig = {};
  deals.forEach(function(d){
    if(d.archived) return;
    var sig = _dealDuplicateSignature(d);
    if(!sig) return;
    (bySig[sig] = bySig[sig] || []).push(d);
  });
  return Object.keys(bySig)
    .map(function(s){ return bySig[s]; })
    .filter(function(g){ return g.length > 1; })
    .sort(function(a, b){ return b.length - a.length; });
}

function showDuplicatesReport(){
  var groups = _scanDuplicateDeals();
  var existing = document.getElementById('duplicatesReportModal');
  if(existing) existing.remove();
  var ov = document.createElement('div');
  ov.id = 'duplicatesReportModal';
  ov.className = 'ov on';
  var body;
  if(!groups.length){
    body = '<div class="empty" style="padding:24px;">Aucun doublon détecté dans la base. Tout est propre.</div>';
  } else {
    var totalDup = groups.reduce(function(s, g){ return s + (g.length - 1); }, 0);
    body = '<div style="font-size:13px;line-height:1.5;color:var(--text);margin:0 0 14px;">'+
           '<b>'+groups.length+' groupe'+(groups.length>1?'s':'')+'</b> de doublons '+
           'détecté'+(groups.length>1?'s':'')+' — au total <b>'+totalDup+' deal'+(totalDup>1?'s':'')+
           '</b> en trop. Garde une copie par groupe et supprime les autres (cascade auto sur les contrats liés).</div>';
    body += groups.map(function(group){
      var first = group[0];
      var hdr = '<div style="font-weight:600;font-size:12px;color:var(--text);margin-bottom:6px;">'+
                escH(first.client||'')+' — '+escH(first.contrat||'')+' — '+escH(first.date||'')+
                ' — '+f0(first.nom||0)+' '+escH(first.dev||'EUR')+
                ' <span style="color:var(--red);">('+group.length+' copies)</span></div>';
      var rows = group.map(function(d){
        var idx = deals.indexOf(d);
        var info = escH(d.fourn||'')+' · '+escH(d.produit||'(sans produit)')+(d.isin?' · '+escH(d.isin):'');
        return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px dashed var(--border);font-size:11px;">'+
          '<span style="color:var(--text2);flex:1;">'+info+' <span class="mono" style="color:var(--text3);">'+(d._id?String(d._id).slice(0,8):'no-id')+'</span></span>'+
          '<button class="btn btn-sm" onclick="document.getElementById(\'duplicatesReportModal\').remove();openDet(deals['+idx+']);">Voir</button>'+
          '<button class="btn btn-sm" style="color:var(--red);border-color:var(--red-bg);" onclick="document.getElementById(\'duplicatesReportModal\').remove();deleteDeal('+idx+');">Supprimer</button>'+
          '</div>';
      }).join('');
      return '<div style="background:var(--surface2);padding:10px 12px;border-radius:var(--rs);margin-bottom:8px;">'+hdr+rows+'</div>';
    }).join('');
  }
  ov.innerHTML =
    '<div class="modal" style="max-width:720px;max-height:80vh;display:flex;flex-direction:column;">'+
      '<div class="modal-hd"><span class="modal-title">Scan des doublons</span>'+
      '<button class="close-btn" onclick="document.getElementById(\'duplicatesReportModal\').remove();">×</button></div>'+
      '<div class="modal-body" style="overflow-y:auto;">'+body+'</div>'+
      '<div class="modal-ft"><button class="btn" onclick="document.getElementById(\'duplicatesReportModal\').remove();">Fermer</button></div>'+
    '</div>';
  document.body.appendChild(ov);
}

// Show the linked-deletion confirm modal. callback(action, links)
// action ∈ {'cancel','view','archive','delete'}
// links = array of {contract, prod} (possibly empty). The cascade is mandatory
// per Oscar 2026-05-18 — no more "delete deal only, keep investissement" path.
var _ddcCallback=null;
function showDealDeleteConfirm(deal,callback){
  var links=findAllLinkedInvestissements(deal);
  var firstLink=links[0]||null;
  // Always show the modal (even when no linked investissement) so the user
  // can choose between archive (keep facture trace) and hard delete.
  document.getElementById('ddcClient').textContent=firstLink?firstLink.contract.client:(deal.client||'—');
  document.getElementById('ddcDealLabel').textContent=(deal.client||'')+' — '+(deal.produit||'');
  if(links.length){
    // Group by contract for a readable summary when multiple produits exist.
    var byContract={};
    links.forEach(function(l){
      var cid=l.contract._id||l.contract.client;
      if(!byContract[cid])byContract[cid]={contract:l.contract, prods:[]};
      byContract[cid].prods.push(l.prod);
    });
    var lines=Object.keys(byContract).map(function(cid){
      var g=byContract[cid];
      var contractEmptyAfter=(g.contract.produits||[]).length===g.prods.length;
      var prodsHtml=g.prods.map(function(p){
        return '<div style="padding-left:12px;">· '+escH(p.name||'(sans nom)')+(p.isin?' · ISIN '+escH(p.isin):'')+'</div>';
      }).join('');
      return '<div style="margin-top:6px;"><b>Contrat</b> : '+escH(g.contract.client)+(g.contract.num?' (#'+escH(g.contract.num)+')':'')+(contractEmptyAfter?' <span style="color:var(--red-t);">— sera supprimé (plus aucun investissement)</span>':' <span style="color:var(--text3);">— '+g.prods.length+'/'+(g.contract.produits||[]).length+' investissement(s) retiré(s)</span>')+'</div>'+prodsHtml;
    }).join('');
    document.getElementById('ddcDetails').innerHTML=
      '<div><b>'+links.length+' investissement'+(links.length>1?'s':'')+' lié'+(links.length>1?'s':'')+'</b> '+(Object.keys(byContract).length>1?'(sur '+Object.keys(byContract).length+' contrats)':'')+'</div>'+lines;
  } else {
    var paidNote=(deal.fSt==='Payé'||deal.fSt==='Facturé')?'<div style="margin-top:6px;color:var(--amber-t);"><b>⚠ Facture '+escH(deal.fSt.toLowerCase())+'</b> — l\'archivage est recommandé pour garder la trace.</div>':'';
    document.getElementById('ddcDetails').innerHTML=
      '<div>Statut facture : <b>'+escH(deal.fSt||'—')+'</b></div>'+
      '<div>Aucun investissement Suivi Contrats lié à ce deal.</div>'+paidNote;
  }
  _ddcCallback=function(action){callback(action,links);};
  document.getElementById('dealDeleteConfirmModal').classList.add('on');
}
function closeDealDeleteConfirm(){
  document.getElementById('dealDeleteConfirmModal').classList.remove('on');
  if(_ddcCallback){var cb=_ddcCallback;_ddcCallback=null;cb('cancel');}
}
function ddcAction(action){
  document.getElementById('dealDeleteConfirmModal').classList.remove('on');
  if(_ddcCallback){var cb=_ddcCallback;_ddcCallback=null;cb(action);}
}

async function deleteDeal(idx){
  if(idx<0||idx>=deals.length)return;
  var d=deals[idx];
  if(!d){console.error('deleteDeal called with stale idx',idx);return;}
  // Phase G.5 — extra safety : the actual destructive operation uses `d._id`
  // and `deals.splice(deals.indexOf(d), 1)`, both of which match by object
  // reference / by ID. So even if `idx` gets stale between render and click
  // (e.g. concurrent filter/sort), we delete the captured `d`, not a sibling.
  // The reverse-lookup `deals.indexOf(d)` further guarantees we splice the
  // exact object — not "deal at position X" which could now be someone else.
  showDealDeleteConfirm(d,async function(action,links){
    if(action==='cancel')return;
    if(action==='view'){
      var firstLink=links&&links[0];
      if(firstLink)ctrExp[firstLink.contract._id]=true;
      goTo('contrats',document.querySelector('.nbtn[onclick*=contrats]'));
      return;
    }
    if(action==='archive'){
      try{
        d.archived=true;
        if(!d.hist)d.hist=[];
        d.hist.push({ts:nowS(),a:'Deal archivé (soft-delete)',by:'Système'});
        if(d._id)await sbUpdate('deals',d._id,d);
        renderAll();
        toast('Deal archivé. La facture reste visible dans Facturation avec la mention "Deal supprimé".');
      }catch(e){console.error(e);alert('Erreur : '+(e.message||e));}
      return;
    }
    try{
      // Cascade is mandatory (Oscar 2026-05-18) — purge all linked produits and
      // delete any contract that becomes empty as a result.
      var cascade=await cascadeDeleteDealLinks(d);
      if(d._id)await sbDelete('deals',d._id);
      var i=deals.indexOf(d);if(i>=0)deals.splice(i,1);
      renderAll();
      toast('Deal supprimé définitivement.'+_cascadeSummaryToast(cascade));
    }catch(e){console.error(e);alert('Erreur : '+(e.message||e));}
  });
}

async function deleteClient(name){
  if(!confirm('Supprimer le client "'+name+'" ? Cette action est irréversible.'))return;
  var c=clients_db.find(x=>x.name===name);
  if(c&&c._id)await sbDelete('clients',c._id);
  clients_db=clients_db.filter(x=>x.name!==name);
  renderClients();toast('Client supprimé.');
}
async function saveClient(){
  var name=document.getElementById('cName').value.trim();
  var original=document.getElementById('cName').dataset.original||'';
  if(!name){alert('Nom requis.');return;}
  var classifEl=document.getElementById('cClassif');
  var classification=classifEl?classifEl.value:'';
  var profile=_readClientProfileFromModal();
  var entry={name,type:document.getElementById('cType').value,classification:classification||null,profile:profile,vendeur:document.getElementById('cVendeur').value,email:document.getElementById('cEmail').value,notes:document.getElementById('cNotes').value};
  if(original&&original!==name){
    var c=clients_db.find(x=>x.name===original);
    if(c){entry._id=c._id;await _sbClientUpsertSafe('update',c._id,entry);Object.assign(c,entry);}
    for(var di=0;di<deals.length;di++){var dd=deals[di];if(dd.client===original){dd.client=name;if(dd._id)await sbUpdate('deals',dd._id,dd);}}
    // Cascade to contracts (rename client field)
    var ctrToUpdate=contracts_db.filter(function(x){return x.client===original;});
    for(var ci=0;ci<ctrToUpdate.length;ci++){
      ctrToUpdate[ci].client=name;
      try{await saveContract(ctrToUpdate[ci]);}catch(e){console.error('Contract rename cascade failed',e);}
    }
  } else {
    var existing=clients_db.find(x=>x.name===name);
    if(existing){await _sbClientUpsertSafe('update',existing._id,entry);Object.assign(existing,entry);}
    else{var res=await _sbClientUpsertSafe('insert',null,entry);if(res&&res[0])clients_db.push({...entry,_id:res[0].id});}
  }
  closeClientModal();renderClients();renderDeals();toast(original?'Client mis à jour.':'Client ajouté.');
}
// Defensive client upsert — strips columns not yet on Supabase (classification, profile)
// and retries. Toast points to the matching migration.
var _warnedNoClassifCol=false;
var _warnedNoProfileCol=false;
async function _sbClientUpsertSafe(op,id,entry){
  var payload=Object.assign({},entry);
  delete payload._id; delete payload.id;
  async function exec(p){
    if(op==='update'){var ru=await sb.from('clients').update(p).eq('id',id).select();if(ru.error)throw ru.error;return ru.data;}
    var ri=await sb.from('clients').insert(p).select();if(ri.error)throw ri.error;return ri.data;
  }
  async function retryStripped(failingField){
    var stripped=Object.assign({},payload);delete stripped[failingField];
    return exec(stripped);
  }
  try{return await exec(payload);}catch(err){
    var msg=String((err&&err.message)||err||'').toLowerCase();
    if(msg.indexOf("'classification'")!==-1||(msg.indexOf('classification')!==-1&&msg.indexOf('column')!==-1)){
      if(!_warnedNoClassifCol){_warnedNoClassifCol=true;toast('Colonne "classification" absente — lance 08_client_classification.sql.');}
      delete payload.classification;
      try{return await exec(payload);}catch(err2){
        var msg2=String((err2&&err2.message)||err2||'').toLowerCase();
        if(msg2.indexOf("'profile'")!==-1||(msg2.indexOf('profile')!==-1&&msg2.indexOf('column')!==-1)){
          if(!_warnedNoProfileCol){_warnedNoProfileCol=true;toast('Colonne "profile" absente — lance 09_client_profile.sql.');}
          delete payload.profile;return exec(payload);
        }
        throw err2;
      }
    }
    if(msg.indexOf("'profile'")!==-1||(msg.indexOf('profile')!==-1&&msg.indexOf('column')!==-1)){
      if(!_warnedNoProfileCol){_warnedNoProfileCol=true;toast('Colonne "profile" absente — lance 09_client_profile.sql.');}
      return retryStripped('profile');
    }
    throw err;
  }
}

// ── Batch C.2 — Client profile + adequacy report ─────────────────────────────
function _loadClientProfileIntoModal(p){
  p=p||{};
  var ta=p.target_allocation||{};
  var setV=function(id,v){var el=document.getElementById(id);if(el)el.value=(v||v===0)?v:'';};
  setV('cProfileRisk',p.risk||'');
  setV('cProfileHorizon',p.horizon||'');
  setV('cTargetAction',ta.action||'');
  setV('cTargetObligation',ta.obligation||'');
  setV('cTargetStructure',ta.structure||'');
  setV('cTargetAlternatif',ta.alternatif||'');
  setV('cTargetAutre',ta.autre||'');
  setV('cProfileConstraints',p.constraints||'');
  var lr=document.getElementById('cProfileLastReview');
  if(lr)lr.textContent='Dernière revue : '+(p.last_review||'—');
  _recomputeTargetSum();
}
function _readClientProfileFromModal(){
  var num=function(id){var el=document.getElementById(id);if(!el)return null;var v=parseFloat(el.value);return isNaN(v)?null:v;};
  var profile={
    risk:(document.getElementById('cProfileRisk')||{}).value||null,
    horizon:(document.getElementById('cProfileHorizon')||{}).value||null,
    target_allocation:{
      action:num('cTargetAction'),
      obligation:num('cTargetObligation'),
      structure:num('cTargetStructure'),
      alternatif:num('cTargetAlternatif'),
      autre:num('cTargetAutre')
    },
    constraints:((document.getElementById('cProfileConstraints')||{}).value||'').trim()||null,
    last_review:_existingProfileLastReview()
  };
  // Clean up nulls in target_allocation
  Object.keys(profile.target_allocation).forEach(function(k){if(profile.target_allocation[k]==null)delete profile.target_allocation[k];});
  return profile;
}
function _existingProfileLastReview(){
  // Preserve the existing last_review unless markAdequacyReviewed has just set it
  var original=document.getElementById('cName').dataset.original;
  if(!original)return null;
  var c=clients_db.find(function(x){return x.name===original;});
  return c&&c.profile?c.profile.last_review||null:null;
}
function _recomputeTargetSum(){
  var ids=['cTargetAction','cTargetObligation','cTargetStructure','cTargetAlternatif','cTargetAutre'];
  var sum=ids.reduce(function(s,id){var el=document.getElementById(id);return s+(el?(parseFloat(el.value)||0):0);},0);
  var out=document.getElementById('cTargetSum');
  if(out){
    out.textContent=sum+'%';
    out.style.color=(sum===0||sum===100)?'var(--text)':(sum>100?'var(--red)':'var(--amber-t)');
  }
}
function _profileCategoryOf(rawType){
  if(!rawType)return 'autre';
  var x=String(rawType).toLowerCase();
  if(x.indexOf('action')!==-1||x==='etf')return 'action';
  if(x.indexOf('oblig')!==-1)return 'obligation';
  if(x.indexOf('struct')!==-1)return 'structure';
  if(x.indexOf('altern')!==-1||x.indexOf('private')!==-1||x==='pe')return 'alternatif';
  return 'autre';
}
function _computeActualAllocation(clientName){
  var sumByCat={action:0,obligation:0,structure:0,alternatif:0,autre:0};
  var totalEur=0;
  deals.filter(function(d){return d.client===clientName&&(d.nom||0)>0&&!d.archived;}).forEach(function(d){
    if(Array.isArray(d.codifications)&&d.codifications.length){
      d.codifications.forEach(function(c){
        var n=parseFloat(c.nominal)||0;
        if(n<=0)return;
        var nEur=d.dev==='EUR'?n:(n/(d.fx||1));
        var cat=_profileCategoryOf(c.type||d.produit_type);
        sumByCat[cat]+=nEur;totalEur+=nEur;
      });
    } else {
      var nomEur=d.dev==='EUR'?(d.nom||0):((d.nom||0)/(d.fx||1));
      var cat=_profileCategoryOf(d.produit_type);
      sumByCat[cat]+=nomEur;totalEur+=nomEur;
    }
  });
  var pctByCat={};
  Object.keys(sumByCat).forEach(function(k){pctByCat[k]=totalEur>0?Math.round(sumByCat[k]/totalEur*1000)/10:0;});
  return{sumByCat:sumByCat,pctByCat:pctByCat,totalEur:totalEur};
}
var _currentAdequacyClient=null;
function openAdequacyReport(){
  // Identify which client we're reporting on — the one currently in the client modal
  var name=document.getElementById('cName').dataset.original||document.getElementById('cName').value.trim();
  if(!name){alert('Sélectionnez un client avant de générer le rapport.');return;}
  var c=clients_db.find(function(x){return x.name===name;});
  if(!c){alert('Client introuvable.');return;}
  _currentAdequacyClient=name;
  var profile=c.profile||{};
  var target=profile.target_allocation||{};
  var actual=_computeActualAllocation(name);
  document.getElementById('adequacyTitle').textContent='Rapport d\'adéquation — '+name;
  var categories=[
    {key:'action',label:'Actions'},
    {key:'obligation',label:'Obligations'},
    {key:'structure',label:'Produits structurés'},
    {key:'alternatif',label:'Alternatif / PE'},
    {key:'autre',label:'Autre'}
  ];
  var hasTarget=Object.keys(target).some(function(k){return target[k]>0;});
  var riskLbl={conservateur:'Conservateur',modere:'Modéré',dynamique:'Dynamique','tres-dynamique':'Très dynamique'}[profile.risk]||'— non défini —';
  var horizonLbl={court:'Court (< 3 ans)',moyen:'Moyen (3-7 ans)',long:'Long (> 7 ans)'}[profile.horizon]||'— non défini —';
  var rowsHtml=categories.map(function(cat){
    var t=target[cat.key]||0;
    var a=actual.pctByCat[cat.key]||0;
    var deviation=a-t;
    var absDev=Math.abs(deviation);
    var flag='';
    if(hasTarget){
      if(absDev>10)flag='<span style="color:var(--red);font-weight:600;">⚠ '+(deviation>0?'+':'')+deviation.toFixed(1)+'%</span>';
      else if(absDev>5)flag='<span style="color:var(--amber-t);font-weight:500;">'+(deviation>0?'+':'')+deviation.toFixed(1)+'%</span>';
      else flag='<span style="color:var(--green);">✓ '+(deviation>0?'+':'')+deviation.toFixed(1)+'%</span>';
    } else flag='<span style="color:var(--text3);">—</span>';
    return '<tr>'+
      '<td style="padding:6px 8px;border-bottom:1px solid var(--border);">'+cat.label+'</td>'+
      '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--text2);">'+t+'%</td>'+
      '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;font-weight:600;">'+a.toFixed(1)+'%</td>'+
      '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;">'+flag+'</td>'+
      '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--text2);">'+(actual.sumByCat[cat.key]?fE(actual.sumByCat[cat.key]):'—')+'</td>'+
    '</tr>';
  }).join('');
  var globalFlag='';
  if(hasTarget){
    var maxDev=Math.max.apply(null,categories.map(function(cat){return Math.abs((actual.pctByCat[cat.key]||0)-(target[cat.key]||0));}));
    if(maxDev>10)globalFlag='<div style="background:rgba(194,59,59,.1);border:1px solid rgba(194,59,59,.3);border-radius:var(--rs);padding:10px 14px;margin-bottom:12px;color:var(--red);font-size:12px;font-weight:500;">⚠ Déviation significative détectée (max '+maxDev.toFixed(1)+'%) — revue conseillée.</div>';
    else if(maxDev>5)globalFlag='<div style="background:rgba(176,122,16,.1);border:1px solid rgba(176,122,16,.3);border-radius:var(--rs);padding:10px 14px;margin-bottom:12px;color:var(--amber-t);font-size:12px;">⚠ Léger écart (max '+maxDev.toFixed(1)+'%) — surveillance recommandée.</div>';
    else globalFlag='<div style="background:rgba(34,139,69,.1);border:1px solid rgba(34,139,69,.3);border-radius:var(--rs);padding:10px 14px;margin-bottom:12px;color:#1e7f3a;font-size:12px;font-weight:500;">✓ Portefeuille aligné sur la cible (max '+maxDev.toFixed(1)+'%).</div>';
  } else {
    globalFlag='<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--rs);padding:10px 14px;margin-bottom:12px;color:var(--text2);font-size:12px;">Aucune allocation cible définie dans le profil. Renseignez les % cibles pour activer l\'analyse d\'écart.</div>';
  }
  document.getElementById('adequacyBody').innerHTML=
    globalFlag+
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;font-size:12px;">'+
      '<div style="background:var(--surface2);padding:8px 12px;border-radius:5px;"><div style="font-size:10px;color:var(--text3);">Profil de risque</div><div style="font-weight:600;margin-top:2px;">'+escH(riskLbl)+'</div></div>'+
      '<div style="background:var(--surface2);padding:8px 12px;border-radius:5px;"><div style="font-size:10px;color:var(--text3);">Horizon</div><div style="font-weight:600;margin-top:2px;">'+escH(horizonLbl)+'</div></div>'+
      '<div style="background:var(--surface2);padding:8px 12px;border-radius:5px;"><div style="font-size:10px;color:var(--text3);">Encours total</div><div style="font-weight:600;margin-top:2px;color:var(--blue);">'+fE(Math.round(actual.totalEur))+'</div></div>'+
      '<div style="background:var(--surface2);padding:8px 12px;border-radius:5px;"><div style="font-size:10px;color:var(--text3);">Dernière revue</div><div style="font-weight:600;margin-top:2px;">'+escH(profile.last_review||'—')+'</div></div>'+
    '</div>'+
    '<table style="width:100%;border-collapse:collapse;font-size:12px;">'+
      '<thead><tr style="background:var(--surface2);"><th style="padding:6px 8px;text-align:left;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.3px;">Type</th><th style="padding:6px 8px;text-align:right;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.3px;">Cible</th><th style="padding:6px 8px;text-align:right;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.3px;">Réel</th><th style="padding:6px 8px;text-align:right;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.3px;">Écart</th><th style="padding:6px 8px;text-align:right;font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.3px;">Encours</th></tr></thead>'+
      '<tbody>'+rowsHtml+'</tbody>'+
    '</table>'+
    (profile.constraints?'<div style="margin-top:14px;padding:10px 14px;background:var(--surface2);border-radius:var(--rs);font-size:12px;color:var(--text2);"><b>Contraintes :</b> '+escH(profile.constraints)+'</div>':'');
  document.getElementById('adequacyModal').classList.add('on');
}
function closeAdequacyReport(){document.getElementById('adequacyModal').classList.remove('on');_currentAdequacyClient=null;}
async function markAdequacyReviewed(){
  if(!_currentAdequacyClient){closeAdequacyReport();return;}
  var c=clients_db.find(function(x){return x.name===_currentAdequacyClient;});
  if(!c){closeAdequacyReport();return;}
  c.profile=Object.assign({},c.profile||{},{last_review:today()});
  try{await _sbClientUpsertSafe('update',c._id,c);toast('Revue datée du '+today()+'.');}catch(e){console.error(e);alert('Erreur sauvegarde : '+(e.message||e));}
  closeAdequacyReport();
  // If the parent client modal is open, refresh the last_review hint
  var lr=document.getElementById('cProfileLastReview');
  if(lr)lr.textContent='Dernière revue : '+today();
}

// ── FOURNISSEURS ─────────────────────────────────────────────────────────────
var fournTab='ALL';
var FOURN_DEFAULTS=[
  {name:'Amundi AM',famille:'SDG'},{name:'Archinvest',famille:'SDG'},{name:'EURAZEO',famille:'SDG'},
  {name:'Jupiter',famille:'SDG'},{name:'LFIS',famille:'SDG'},{name:'Longchamp',famille:'SDG'},
  {name:'NEXTSTAGE',famille:'SDG'},{name:'Nomura',famille:'SDG'},{name:'Parus',famille:'SDG'},
  {name:'TFC',famille:'SDG'},{name:'TOBAM',famille:'SDG'},
  {name:'BNP',famille:'Banque'},{name:'BOA',famille:'Banque'},{name:'SG',famille:'Banque'},
  {name:'AXA',famille:'Assureur'},{name:'Wealins',famille:'Assureur'}
];
function loadFourn(){return fourn_db;}
function saveFournList(list){/* handled async */}
var FAMILLE_LABELS={SDG:'Société de gestion',Banque:'Banque',Assureur:'Assureur'};
var FAMILLE_BADGE={SDG:'bb',Banque:'bg',Assureur:'bp'};
function setFournTab(t,btn){
  fournTab=t;
  document.querySelectorAll('#fournTabs .btn').forEach(b=>{b.style.background='';b.style.color='';b.style.borderColor='';});
  btn.style.background='var(--text)';btn.style.color='var(--surface)';btn.style.borderColor='var(--text)';
  var isBroker=t==='BROKER';
  document.getElementById('fournTableSection').style.display=isBroker?'none':'block';
  document.getElementById('fournBrokersSection').style.display=isBroker?'block':'none';
  document.getElementById('fournAddBtn').textContent=isBroker?'+ Nouveau broker':'+ Nouveau fournisseur';
  document.getElementById('fournAddBtn').onclick=isBroker?function(){openBrokerModal();}:function(){openFournModal();};
  if(isBroker)renderBrokers();else renderFourn();
}
function renderFourn(){
  var all=loadFourn().slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
  var list=fournTab==='ALL'?all:all.filter(f=>f.famille===fournTab);
  // Search filter — matches name / contact / email / addr / any product ISIN or part label
  var qEl=document.getElementById('fournSearch');
  var q=qEl?(qEl.value||'').toLowerCase().trim():'';
  if(q){
    list=list.filter(function(f){
      if((f.name||'').toLowerCase().indexOf(q)!==-1)return true;
      if((f.contact||'').toLowerCase().indexOf(q)!==-1)return true;
      if((f.email||'').toLowerCase().indexOf(q)!==-1)return true;
      if((f.addr1||'').toLowerCase().indexOf(q)!==-1)return true;
      if((f.addr2||'').toLowerCase().indexOf(q)!==-1)return true;
      if(Array.isArray(f.products)){
        for(var i=0;i<f.products.length;i++){
          var p=f.products[i];
          if((p.isin||'').toLowerCase().indexOf(q)!==-1)return true;
          if((p.part||'').toLowerCase().indexOf(q)!==-1)return true;
        }
      }
      return false;
    });
  }
  document.getElementById('fournCount').textContent=list.length+' fournisseur'+(list.length>1?'s':'')+(q?' (filtrés)':'');
  var t=document.getElementById('fournT');
  while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('fournEmpty').style.display=list.length?'none':'block';
  // Phase H.3 — pre-compute per-fournisseur aggregates from codif-level entries
  // so a deal with multiple fournisseurs in its codifications contributes to
  // each fournisseur's totals separately (was deal-level `d.fourn` which only
  // counted the FIRST fournisseur of the deal).
  var entries=billingEntries(filt());
  var byFourn={};
  var dealsTouched={};
  entries.forEach(function(e){
    var name=e.fourn||'';
    if(!name) return;
    if(!byFourn[name]) byFourn[name]={ufE:0,runE:0,lastDate:'',dealIds:new Set()};
    byFourn[name].ufE  += e.ufE||0;
    byFourn[name].runE += e.runE||0;
    byFourn[name].dealIds.add(e._id||e.deal);
    var dt=e.date||'';
    if(dt>byFourn[name].lastDate) byFourn[name].lastDate=dt;
  });
  list.forEach(function(f){
    var agg = byFourn[f.name] || {ufE:0,runE:0,lastDate:'',dealIds:new Set()};
    var nb = agg.dealIds.size;
    var tUF = agg.ufE;
    var tRun = agg.runE;
    var last = agg.lastDate || '—';
    var bc=FAMILLE_BADGE[f.famille]||'bgr';
    var bl=FAMILLE_LABELS[f.famille]||f.famille;
    var r=t.insertRow();
    r.innerHTML='<td style="font-weight:500;cursor:pointer;" title="Double-cliquer pour modifier" ondblclick="openFournModal(\''+escAttr(f.name)+'\')">'+escH(f.name)+'</td><td><span class="badge '+bc+'">'+bl+'</span></td><td style="text-align:center;">'+nb+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+(tUF>0?fE(tUF):'—')+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+(tRun>0?fE(tRun):'—')+'</td><td class="mono" style="color:var(--text2);">'+escH(last)+'</td>';
  });
  rebuildFournSelect();
}
function rebuildFournSelect(){
  var sel=document.getElementById('mFourn');
  if(sel){var cur=sel.value;sel.innerHTML=fournOptHtml(cur);}
  document.querySelectorAll('#codifLines .codifFourn').forEach(function(s){var cur=s.value;s.innerHTML=fournOptHtml(cur);});
}
function openFournModal(name){
  document.getElementById('fournModalTitle').textContent=name?'Modifier le fournisseur':'Nouveau fournisseur';
  var existingProducts=[];
  // Populate the template picker first (same options as the contract modal's).
  var tplSel=document.getElementById('fTemplate');
  if(tplSel){
    tplSel.innerHTML='<option value="">— Aucun (utilise le template du contrat) —</option>'+
      (templates_db||[]).map(function(t){return '<option value="'+escH(t.name)+'">'+escH(t.name)+'</option>';}).join('');
  }
  if(name){
    var f=loadFourn().find(x=>x.name===name)||{};
    document.getElementById('fName').value=name;
    document.getElementById('fFamille').value=f.famille||'SDG';
    document.getElementById('fAddr1').value=f.addr1||'';
    document.getElementById('fAddr2').value=f.addr2||'';
    document.getElementById('fContact').value=f.contact||'';
    document.getElementById('fEmail').value=f.email||'';
    if(tplSel)tplSel.value=f.template_name||'';
    document.getElementById('fName').dataset.original=name;
    existingProducts=Array.isArray(f.products)?f.products:[];
  } else {
    document.getElementById('fName').value='';
    document.getElementById('fFamille').value='SDG';
    document.getElementById('fAddr1').value='';
    document.getElementById('fAddr2').value='';
    document.getElementById('fContact').value='';
    document.getElementById('fEmail').value='';
    if(tplSel)tplSel.value='';
    document.getElementById('fName').dataset.original='';
  }
  // Hydrate the products list. Products now apply to ALL families (SDG / Banque
  // / Assureur) — every fournisseur referenced in a deal benefits from having
  // a catalogue with fees. On a brand-new fournisseur (no name), pre-render
  // one blank product line; edit mode preserves whatever's stored.
  document.getElementById('fProducts').innerHTML='';
  if(existingProducts.length){
    existingProducts.forEach(function(p){addFournProductLine(p);});
    document.getElementById('fProductsEmpty').style.display='none';
  } else if(!name){
    // New fournisseur — auto-add an empty product slot regardless of family.
    addFournProductLine();
    document.getElementById('fProductsEmpty').style.display='none';
  } else {
    document.getElementById('fProductsEmpty').style.display='';
  }
  onFournFamilleChange();
  document.getElementById('fournDeleteBtn').style.display=name?'':'none';
  document.getElementById('fournModal').classList.add('on');
  setTimeout(()=>document.getElementById('fName').focus(),50);
}
function deleteFournFromModal(){
  var original=document.getElementById('fName').dataset.original;
  if(!original)return;
  closeFournModal();
  deleteFourn(original);
}
function closeFournModal(){document.getElementById('fournModal').classList.remove('on');document.getElementById('fName').dataset.original='';}
// ISIN soft-check — real ISINs are 12 chars, alphanumeric, country prefix.
// We don't enforce the full check-digit algo (some legacy / partial codes might be
// valid for now), just flag anything that's not obviously well-formed.
function _isWellFormedIsin(s){
  if(!s)return true; // empty is fine — just means "no ISIN yet"
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(s);
}
async function saveFourn(){
  var name=document.getElementById('fName').value.trim();
  var famille=document.getElementById('fFamille').value;
  var addr1=document.getElementById('fAddr1').value.trim();
  var addr2=document.getElementById('fAddr2').value.trim();
  var contact=document.getElementById('fContact').value.trim();
  var email=document.getElementById('fEmail').value.trim();
  var original=document.getElementById('fName').dataset.original||'';
  if(!name){alert('Nom requis.');return;}
  // Products carried for every family — SDG, Banque, Assureur all have catalogues.
  var products=getFournProductsFromModal();
  // Phase G.1 — VALIDATION (blocking): every fee row of every product must have
  // a kind set (UF / Run / UF+Run). No empty "Type" allowed — that's the root of
  // the "? 1.3%" rendering bug and the silent ct='UF' fallback on the deal.
  // A product can be saved with ZERO fee rows (e.g. a placeholder product without
  // a known structure yet), but it CAN'T have a row with a pct but no kind.
  var badRows=[];
  products.forEach(function(p,pi){
    (p.fees||[]).forEach(function(f,fi){
      var hasKind=(f.kind||'').trim()!=='';
      var hasPct=!isNaN(parseFloat(f.pct))&&parseFloat(f.pct)>0;
      // Either both empty (=> we'd drop the row at read-time anyway), or both set.
      if(hasPct && !hasKind) badRows.push({prodLabel:(p.isin||p.part||'produit #'+(pi+1)), row:fi+1});
    });
  });
  if(badRows.length){
    var summary=badRows.slice(0,3).map(function(b){return b.prodLabel+' (frais #'+b.row+')';}).join(', ');
    alert('Type de frais manquant sur : '+summary+(badRows.length>3?' …':'')+'\n\nChaque ligne de frais doit avoir un type (UF / Run / UF+Run). Sinon le calcul ne fonctionne pas.');
    return;
  }
  // Phase B.1 — per-fournisseur template (drives the investment-pack steps when this
  // fournisseur supplies a product on a contract). Empty string = use the contract's
  // template as fallback.
  var tplElSave=document.getElementById('fTemplate');
  var template_name=tplElSave?(tplElSave.value||null):null;
  // ISIN sanity check — non-blocking. Toast each malformed ISIN so the user sees
  // them but doesn't get stopped from saving (some legacy / placeholder codes
  // may not match the 12-char format yet).
  var malformed=products.filter(function(p){return p.isin && !_isWellFormedIsin(p.isin);}).map(function(p){return p.isin;});
  if(malformed.length){
    toast('⚠ ISIN suspects (sauvegardé quand même) : '+malformed.slice(0,3).join(', ')+(malformed.length>3?'…':''));
  }
  var payload={name,famille,addr1,addr2,contact,email,products,template_name};
  if(original&&original!==name){
    var f=fourn_db.find(x=>x.name===original);
    if(f){Object.assign(f,payload);await sbUpdateFournSafe(f._id,payload,f);}
    for(var di=0;di<deals.length;di++){var dd=deals[di];if(dd.fourn===original){dd.fourn=name;if(dd._id)await sbUpdate('deals',dd._id,dd);}}
    // Cascade to rapprochement (in-memory cache + DB)
    var rapprToUpdate=rapprochement_db.filter(function(r){return r.fourn===original;});
    for(var ri=0;ri<rapprToUpdate.length;ri++){
      var rr=rapprToUpdate[ri];
      var ures=await sb.from('rapprochement').update({fourn:name}).eq('id',rr.id).select();
      if(ures.error)console.error('Rapproch rename failed',ures.error);
      else rr.fourn=name;
    }
  } else {
    var existing=fourn_db.find(x=>x.name===name);
    if(existing){Object.assign(existing,payload);await sbUpdateFournSafe(existing._id,payload,existing);}
    else{
      var res=await sbInsertFournSafe(payload);
      if(res&&res[0])fourn_db.push({...payload,_id:res[0].id});
    }
  }
  closeFournModal();renderFourn();renderDeals();toast(original?'Fournisseur mis à jour.':'Fournisseur ajouté.');
}

// ── Phase 1A — Fournisseur Products (catalogue ISIN per SDG row) ────────────
// Defensive insert/update: if Supabase column `products` or `template_name`
// not yet migrated, strip it and retry once. Warns the user via toast so the
// migration gets run.
var _warnedNoProductsCol=false;
var _warnedNoTemplateNameCol=false;
function _isMissingColErr(err,col){
  var m=String((err&&err.message)||err||'').toLowerCase();
  return m.indexOf("'"+col+"'")!==-1||m.indexOf('"'+col+'"')!==-1||(m.indexOf(col)!==-1&&m.indexOf('column')!==-1);
}
function _warnNoProductsCol(){
  if(_warnedNoProductsCol)return;
  _warnedNoProductsCol=true;
  toast('Colonne "products" absente — sauvegardé sans. Lance 05_fournisseur_products.sql sur Supabase.');
  console.warn('[Schema] fournisseurs.products missing. Apply: alter table fournisseurs add column products jsonb default \'[]\'::jsonb;');
}
function _warnNoTemplateNameCol(){
  if(_warnedNoTemplateNameCol)return;
  _warnedNoTemplateNameCol=true;
  toast('Colonne "template_name" absente sur fournisseurs — sauvegardé sans. Applique : alter table fournisseurs add column template_name text;');
  console.warn('[Schema] fournisseurs.template_name missing. Apply: alter table fournisseurs add column template_name text;');
}
// Try saving; if the DB rejects an unknown column, strip & retry. Handles both
// `products` and `template_name` columns the same way — keeps the UI usable
// in-session even when a migration hasn't been applied yet.
async function sbInsertFournSafe(payload){
  var res=await sb.from('fournisseurs').insert(payload).select();
  if(res.error&&_isMissingColErr(res.error,'template_name')){
    _warnNoTemplateNameCol();
    var p2=Object.assign({},payload);delete p2.template_name;
    res=await sb.from('fournisseurs').insert(p2).select();
  }
  if(res.error&&_isMissingColErr(res.error,'products')){
    _warnNoProductsCol();
    var stripped=Object.assign({},payload);delete stripped.products;delete stripped.template_name;
    res=await sb.from('fournisseurs').insert(stripped).select();
  }
  if(res.error){console.error('Fournisseur insert failed',res.error);throw res.error;}
  return res.data||[];
}
async function sbUpdateFournSafe(id,payload,memRow){
  var data=Object.assign({},payload);delete data.id;delete data._id;delete data.created_at;
  var res=await sb.from('fournisseurs').update(data).eq('id',id).select();
  if(res.error&&_isMissingColErr(res.error,'template_name')){
    _warnNoTemplateNameCol();
    var d2=Object.assign({},data);delete d2.template_name;
    res=await sb.from('fournisseurs').update(d2).eq('id',id).select();
  }
  if(res.error&&_isMissingColErr(res.error,'products')){
    _warnNoProductsCol();
    var stripped=Object.assign({},data);delete stripped.products;delete stripped.template_name;
    res=await sb.from('fournisseurs').update(stripped).eq('id',id).select();
    // Reflect: in-memory row still has products[] (so UI works this session),
    // but the DB row doesn't (until migration applied).
  }
  if(res.error){console.error('Fournisseur update failed',res.error);throw res.error;}
  return res.data||[];
}

function onFournFamilleChange(){
  // Products are now relevant for EVERY family (SDG manages funds, Banque manages
  // structured products / accounts, Assureur manages life-insurance contracts that
  // wrap underlying instruments). All can have a catalogue with fees.
  var fam=document.getElementById('fFamille').value;
  var section=document.getElementById('fProductsSection');
  section.style.display=''; // always visible
  // Auto-add an empty slot if the catalogue is empty — same constraint as before:
  // a fournisseur without products is not useful to reference in a deal.
  if(!document.querySelectorAll('#fProducts .fourn-product-card').length){
    addFournProductLine();
    document.getElementById('fProductsEmpty').style.display='none';
  }
}

function addFournProductLine(prod){
  prod=prod||{isin:'',part:'',type:'',unit:'part',currency:'EUR',fees:[{kind:'',pct:''}],pf:{mode:'none'}};
  var c=document.getElementById('fProducts');
  var card=document.createElement('div');
  card.className='fourn-product-card';
  card.style.cssText='background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:8px;margin-bottom:6px;';
  // Header row : ISIN, Unit, Label, Type, Currency, × remove product
  // Phase J.2 — uses currencySelectHTML so legacy products carrying a non-
  // canonical currency (GBP/CHF/JPY/…) still render with their actual value.
  var curOpts=currencySelectHTML(prod.currency||'EUR');
  var unitVal=prod.unit||'part';
  var pf=prod.pf||{mode:'none'};
  var pfMode=pf.mode||'none';
  // Two-row layout (was one cramped 6-col grid at modal-width 520px).
  // Row 1: ISIN (prominent mono) · Part label (flex) · × close.
  // Row 2: Unit · Type · Currency — categorization grouped together below.
  card.innerHTML=
    // Row 1 — identity
    '<div style="display:grid;grid-template-columns:160px 1fr 24px;gap:6px;margin-bottom:4px;align-items:center;">'+
      '<input type="text" class="fpIsin" value="'+escH(prod.isin||'')+'" placeholder="ISIN (FR00…)" style="font-family:monospace;font-size:11px;"/>'+
      '<input type="text" class="fpPart" value="'+escH(prod.part||'')+'" placeholder="Nom du produit / part (ex: A acc EUR / AAPL)"/>'+
      '<button type="button" onclick="removeFournProductLine(this)" title="Supprimer ce produit" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:18px;padding:0;line-height:1;">×</button>'+
    '</div>'+
    // Row 2 — categorization
    '<div style="display:grid;grid-template-columns:90px 1fr 80px;gap:6px;margin-bottom:6px;align-items:center;">'+
      '<select class="fpUnit" title="Type d\'unité — part de fonds ou action / share" style="font-size:11px;">'+
        '<option value="part"'+(unitVal==='part'?' selected':'')+'>Part</option>'+
        '<option value="share"'+(unitVal==='share'?' selected':'')+'>Share</option>'+
      '</select>'+
      '<select class="fpType" style="font-size:11px;">'+produitTypeOptHtml(prod.type)+'</select>'+
      '<select class="fpCurrency" style="font-size:11px;">'+curOpts+'</select>'+
    '</div>'+
    '<div class="fp-fees-wrap" style="padding-left:8px;border-left:2px solid var(--border);"></div>'+
    // Phase E.2 — Perf fees section, mirrors the deal modal's dfPfBlock so
    // configs live on the product and auto-fill the deal on product pick.
    // Hidden when mode=none unless the user toggles it on.
    '<div class="fp-pf-block" style="margin-top:6px;padding:6px 9px;background:var(--surface);border-radius:4px;border-top:1px dashed var(--border);display:flex;gap:6px;align-items:center;flex-wrap:wrap;">'+
      '<span class="field-caption-sm" style="white-space:nowrap;">PERF FEES</span>'+
      '<select class="fpPfMode" onchange="_onFpPfModeChange(this)" style="font-size:11px;">'+
        '<option value="none"'+(pfMode==='none'?' selected':'')+'>Aucun</option>'+
        '<option value="pct"'+(pfMode==='pct'?' selected':'')+'>% sur perf</option>'+
        '<option value="fixed"'+(pfMode==='fixed'?' selected':'')+'>Montant fixe</option>'+
      '</select>'+
      '<span class="fpPfRateLbl" style="font-size:10px;color:var(--text3);display:'+(pfMode==='pct'?'':'none')+';">Rate%</span>'+
      '<input type="number" class="fpPfRate" value="'+escH(String(pf.rate==null?'':pf.rate))+'" step="0.01" placeholder="ex: 20" style="width:64px;font-size:11px;display:'+(pfMode==='pct'?'':'none')+';"/>'+
      '<span class="fpPfHurdleLbl" style="font-size:10px;color:var(--text3);display:'+(pfMode!=='none'?'':'none')+';">Hurdle%</span>'+
      '<input type="number" class="fpPfHurdle" value="'+escH(String(pf.hurdle==null?'':pf.hurdle))+'" step="0.01" placeholder="ex: 8" style="width:64px;font-size:11px;display:'+(pfMode!=='none'?'':'none')+';"/>'+
      '<span class="fpPfFixedLbl" style="font-size:10px;color:var(--text3);display:'+(pfMode==='fixed'?'':'none')+';">Montant</span>'+
      '<input type="number" class="fpPfFixed" value="'+escH(String(pf.amount==null?'':pf.amount))+'" step="1" placeholder="ex: 50000" style="width:84px;font-size:11px;display:'+(pfMode==='fixed'?'':'none')+';"/>'+
      '<span class="fpPfFreqLbl" style="font-size:10px;color:var(--text3);display:'+(pfMode!=='none'?'':'none')+';">Fréq.</span>'+
      '<select class="fpPfFreq" style="font-size:11px;display:'+(pfMode!=='none'?'':'none')+';">'+
        '<option value="annuel"'+(pf.freq==='annuel'?' selected':'')+'>Annuelle</option>'+
        '<option value="cloture"'+(pf.freq==='cloture'?' selected':'')+'>Clôture</option>'+
        '<option value="valorisation"'+(pf.freq==='valorisation'?' selected':'')+'>Valorisation</option>'+
        '<option value="variable"'+(pf.freq==='variable'?' selected':'')+'>Variable</option>'+
      '</select>'+
    '</div>';
  c.appendChild(card);
  var feesWrap=card.querySelector('.fp-fees-wrap');
  var feesArr=(prod.fees&&prod.fees.length)?prod.fees:[{kind:'',pct:''}];
  feesArr.forEach(function(fee){_appendFpFeeRow(feesWrap,fee);});
  // "+ frais" sits inline at the bottom-right of the fees wrap — visually anchored
  // to the rows it adds to, instead of floating as a separate block element.
  var addFeeBtn=document.createElement('button');
  addFeeBtn.type='button';addFeeBtn.className='fp-add-fee-btn btn-add-xs';
  addFeeBtn.style.cssText='margin-top:2px;float:right;';
  addFeeBtn.textContent='+ frais';
  addFeeBtn.onclick=function(){_appendFpFeeRow(feesWrap,{kind:'',pct:''},addFeeBtn);};
  // Wrap in a container so float doesn't break parent layout
  var addFeeWrap=document.createElement('div');
  addFeeWrap.style.cssText='overflow:hidden;';
  addFeeWrap.appendChild(addFeeBtn);
  feesWrap.appendChild(addFeeWrap);
  // Hide "empty" placeholder text once a product exists
  document.getElementById('fProductsEmpty').style.display='none';
}

function _appendFpFeeRow(container,fee,beforeNode){
  var row=document.createElement('div');
  row.className='fp-fee-row';
  // Phase F.2 — grid expands when kind=UF+Run to fit a second % field. We use
  // 1fr+spec instead of a fixed col to let the kind selector breathe even when
  // the secondary input is visible.
  var isCombo=(fee.kind==='UF+Run');
  row.style.cssText='display:grid;grid-template-columns:1fr 56px 56px 24px;gap:4px;margin-bottom:3px;align-items:center;';
  // Labels above the inputs only appear in combo mode for clarity (else the
  // single % input is self-explanatory). Empty placeholders keep grid alignment.
  // Build the secondary input slot. In combo mode → "Run%" input; else → empty span.
  var primaryLbl=isCombo?'UF %':'%';
  row.innerHTML=
    '<select class="ffKind" onchange="_onFfKindChange(this)" style="font-size:11px;">'+feeKindOptHtml(fee.kind)+'</select>'+
    '<input type="number" class="ffPct" value="'+escH(String(fee.pct==null||fee.pct===''?'':fee.pct))+'" placeholder="'+primaryLbl+'" title="'+(isCombo?'Taux UF (%)':'Taux (%)')+'" step="0.01" min="0" style="font-size:11px;"/>'+
    '<input type="number" class="ffRunPct" value="'+escH(String(fee.runPct==null||fee.runPct===''?'':fee.runPct))+'" placeholder="Run %" title="Taux Running (%/an)" step="0.01" min="0" style="font-size:11px;display:'+(isCombo?'':'none')+';"/>'+
    '<button type="button" onclick="removeFpFeeRow(this)" title="Retirer ce frais" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:0;line-height:1;">×</button>';
  if(beforeNode)container.insertBefore(row,beforeNode);else container.appendChild(row);
}
// Phase F.2 — toggle the secondary Run% input when the kind switches.
// Updates placeholder + title on the primary input too (UF % vs %).
function _onFfKindChange(sel){
  var row=sel.closest('.fp-fee-row, .dfCustomFeeRow');
  if(!row)return;
  var isCombo=(sel.value==='UF+Run');
  // Primary input label
  var primary=row.querySelector('.ffPct, .dfCfPct');
  if(primary){
    primary.placeholder=isCombo?'UF %':'%';
    primary.title=isCombo?'Taux UF (%)':'Taux (%)';
  }
  // Secondary input visibility
  var secondary=row.querySelector('.ffRunPct, .dfCfRunPct');
  if(secondary) secondary.style.display=isCombo?'':'none';
}

function removeFpFeeRow(btn){
  var row=btn.closest('.fp-fee-row');
  var container=row.parentElement;
  if(container.querySelectorAll('.fp-fee-row').length>1)row.remove();
}

// Phase E.2 — toggle Perf fee inputs visibility based on mode on a product card.
// Mirrors _onDfPfModeChange behavior in the deal modal.
function _onFpPfModeChange(sel){
  var block=sel.closest('.fp-pf-block');
  if(!block) return;
  var mode=sel.value;
  var showRate=(mode==='pct');
  var showFixed=(mode==='fixed');
  var showAny=(mode!=='none');
  var setDisp=function(cls,show){var el=block.querySelector(cls);if(el)el.style.display=show?'':'none';};
  setDisp('.fpPfRateLbl',showRate);
  setDisp('.fpPfRate',   showRate);
  setDisp('.fpPfHurdleLbl',showAny);
  setDisp('.fpPfHurdle',   showAny);
  setDisp('.fpPfFixedLbl',showFixed);
  setDisp('.fpPfFixed',   showFixed);
  setDisp('.fpPfFreqLbl',showAny);
  setDisp('.fpPfFreq',   showAny);
}

function removeFournProductLine(btn){
  var card=btn.closest('.fourn-product-card');
  card.remove();
  if(!document.querySelectorAll('#fProducts .fourn-product-card').length){
    document.getElementById('fProductsEmpty').style.display='';
  }
}

function getFournProductsFromModal(){
  var prods=[];
  document.querySelectorAll('#fProducts .fourn-product-card').forEach(function(card){
    var isin=(card.querySelector('.fpIsin').value||'').trim();
    var part=(card.querySelector('.fpPart').value||'').trim();
    var typeEl=card.querySelector('.fpType');
    var type=typeEl?typeEl.value:'';
    var unitEl=card.querySelector('.fpUnit');
    var unit=unitEl?unitEl.value:'part';
    var currency=card.querySelector('.fpCurrency').value||'EUR';
    var fees=[];
    card.querySelectorAll('.fp-fee-row').forEach(function(row){
      var kind=(row.querySelector('.ffKind').value||'').trim();
      var pctRaw=row.querySelector('.ffPct').value;
      var pct=parseFloat(pctRaw);
      // Phase F.2 — UF+Run rows carry an additional runPct for the Running cycle.
      var entry={kind:kind,pct:isNaN(pct)?0:pct};
      if(kind==='UF+Run'){
        var runPctRaw=(row.querySelector('.ffRunPct')||{}).value;
        var runPct=parseFloat(runPctRaw);
        if(!isNaN(runPct))entry.runPct=runPct;
      }
      if(kind||!isNaN(pct))fees.push(entry);
    });
    // Phase E.2 — read the perf fee config block.
    var pf={mode:'none'};
    var pfModeEl=card.querySelector('.fpPfMode');
    if(pfModeEl){
      pf.mode=pfModeEl.value||'none';
      if(pf.mode==='pct'){
        pf.rate=parseFloat((card.querySelector('.fpPfRate')||{}).value)||0;
        pf.hurdle=parseFloat((card.querySelector('.fpPfHurdle')||{}).value)||0;
        pf.freq=(card.querySelector('.fpPfFreq')||{}).value||'annuel';
      } else if(pf.mode==='fixed'){
        pf.amount=parseFloat((card.querySelector('.fpPfFixed')||{}).value)||0;
        pf.hurdle=parseFloat((card.querySelector('.fpPfHurdle')||{}).value)||0;
        pf.freq=(card.querySelector('.fpPfFreq')||{}).value||'annuel';
      }
    }
    var hasPf=(pf.mode!=='none');
    if(isin||part||type||fees.length||hasPf)prods.push({isin:isin,part:part,type:type,unit:unit,currency:currency,fees:fees,pf:pf});
  });
  return prods;
}

// Helpers consumed by Phase 2 (codif line cascade + fee snapshot)
function getFournProducts(name){
  var f=fourn_db.find(function(x){return x.name===name;});
  return f&&Array.isArray(f.products)?f.products:[];
}
function getFournProductByIsin(name,isin){
  if(!isin)return null;
  return getFournProducts(name).find(function(p){return p.isin===isin;})||null;
}
async function deleteFourn(name){
  if(!confirm('Supprimer "'+name+'" ? Cette action est irréversible.'))return;
  var f=fourn_db.find(x=>x.name===name);
  if(f&&f._id)await sbDelete('fournisseurs',f._id);
  fourn_db=fourn_db.filter(x=>x.name!==name);
  renderFourn();toast('Fournisseur supprimé.');
}

// ── FOURNISSEURS SUB-TABS ────────────────────────────────────────────────────
var fournSub='ref';
function setFournSub(sub,btn){
  fournSub=sub;
  document.querySelectorAll('#fournSubTabs .stab').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('fournRefSection').style.display=sub==='ref'?'block':'none';
  document.getElementById('fournRapprSection').style.display=sub==='rappr'?'block':'none';
  if(sub==='rappr'){initRapprTrim();renderRapprochement();}
}

// ── RAPPROCHEMENT ENCOURS ────────────────────────────────────────────────────
var rapprTrim=1, rapprYear=new Date().getFullYear();
// Cache: {fournisseur_trim_year: {declared, comment}}
function loadRapprData(fourn,trim,year){
  var r=rapprFind(fourn,'encours','T'+trim+'_'+year);
  return r?{declared:r.declared,comment:r.comment}:null;
}
async function saveRapprData(fourn,trim,year,data){await rapprSave(fourn,'encours','T'+trim+'_'+year,data);}

function initRapprTrim(){
  var years=[...new Set(deals.map(d=>d.date?d.date.substring(0,4):null).filter(Boolean))].sort().reverse();
  if(!years.length)years=[String(new Date().getFullYear())];
  var sel=document.getElementById('rapprYear');
  var cur=sel.value;
  sel.innerHTML=years.map(y=>'<option'+(y===cur?' selected':'')+'>'+y+'</option>').join('');
  if(!sel.value)sel.value=years[0];
  rapprYear=parseInt(sel.value);
  var m=new Date().getMonth()+1;
  var t=Math.ceil(m/3);
  setRapprTrim(t,document.getElementById('rrT'+t));
}

function setRapprTrim(t,btn){
  rapprTrim=t;
  document.querySelectorAll('#rapprTrimTabs .btn').forEach(b=>{b.style.background='';b.style.color='';b.style.borderColor='';});
  if(btn){btn.style.background='var(--text)';btn.style.color='var(--surface)';btn.style.borderColor='var(--text)';}
  renderRapprochement();
}

function getRapprDeals(){
  var year=parseInt(document.getElementById('rapprYear').value)||new Date().getFullYear();
  rapprYear=year;
  // All deals up to end of selected trimestre (actifs = pas de date de fin ou date de fin après début du trimestre)
  return deals;
}

function renderRapprochement(){
  var year=parseInt(document.getElementById('rapprYear').value)||new Date().getFullYear();
  rapprYear=year;
  var trimDates=getTrimDates(rapprTrim,year);
  document.getElementById('rapprLabel').textContent=trimDates.label;
  var allDeals=getRapprDeals();
  var fourns=loadFourn().slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));

  // Build per-fournisseur data
  var rows=[];
  fourns.forEach(f=>{
    var fDeals=allDeals.filter(d=>d.fourn===f.name);
    if(!fDeals.length)return;
    var nomEUR=fDeals.reduce((s,d)=>s+_dealNomEur(d),0);
    var saved=loadRapprData(f.name,rapprTrim,year);
    rows.push({fourn:f,deals:fDeals,nomEUR,declared:saved?saved.declared:null,comment:saved?saved.comment:''});
  });

  // KPIs
  var totalNom=rows.reduce((s,r)=>s+r.nomEUR,0);
  var totalDecl=rows.filter(r=>r.declared!=null).reduce((s,r)=>s+r.declared,0);
  var nbRappr=rows.filter(r=>r.declared!=null).length;
  var nbEcart=rows.filter(r=>r.declared!=null&&Math.abs(r.declared-r.nomEUR)>100).length;
  document.getElementById('rapprKpi').innerHTML=
    kH('Nominal total app',fE(totalNom),rows.length+' fournisseurs')+
    kH('Déclaré fournisseurs',totalDecl>0?fE(totalDecl):'—',nbRappr+' / '+rows.length+' saisis')+
    kH('Écart global',totalDecl>0?fE(totalDecl-totalNom):'—',totalDecl>0?(totalDecl>=totalNom?'Fournisseur > App':'App > Fournisseur'):'')+
    kH('Fournisseurs en écart',nbEcart>0?nbEcart+' fournisseur'+(nbEcart>1?'s':''):'Aucun',nbEcart>0?'à vérifier':'','');

  // Table
  var t=document.getElementById('rapprT');
  while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('rapprEmpty').style.display=rows.length?'none':'block';

  rows.forEach(function(item){
    var ecart=item.declared!=null?item.declared-item.nomEUR:null;
    var ecartPct=ecart!=null&&item.nomEUR>0?((ecart/item.nomEUR)*100).toFixed(1)+'%':'';
    var statut=item.declared==null
      ?'<span class="badge ba">À saisir</span>'
      :Math.abs(ecart)<100
        ?'<span class="badge bg">Validé</span>'
        :ecart>0?'<span class="badge bp">Fournisseur +</span>'
               :'<span class="badge br">Écart négatif</span>';
    var ecartCell=ecart!=null
      ?'<span style="font-weight:600;color:'+(Math.abs(ecart)<100?'var(--green)':ecart>0?'var(--purple)':'var(--red)')+';">'+(ecart>0?'+':'')+fE(ecart)+(ecartPct?' ('+ecartPct+')':'')+'</span>'
      :'—';
    var bc=FAMILLE_BADGE[item.fourn.famille]||'bgr';
    var bl=FAMILLE_LABELS[item.fourn.famille]||item.fourn.famille;
    var r=t.insertRow();
    r.innerHTML=
      '<td style="font-weight:500;white-space:nowrap;">'+item.fourn.name+'</td>'+
      '<td><span class="badge '+bc+'">'+bl+'</span></td>'+
      '<td style="text-align:right;color:var(--blue);font-weight:500;">'+fE(item.nomEUR)+'</td>'+
      '<td style="text-align:right;">'+(item.declared!=null?'<span style="font-weight:500;">'+fE(item.declared)+'</span>':'<span style="color:var(--text3);">—</span>')+'</td>'+
      '<td>'+ecartCell+'</td>'+
      '<td>'+statut+'</td>'+
      '<td><button class="btn btn-sm" onclick="openRapprModal(\''+item.fourn.name.replace(/'/g,"\\'")+'\','+item.nomEUR+')">Saisir</button></td>';
  });
}

var rapprCurrentFourn=null;
function openRapprModal(fournName,nomEUR){
  rapprCurrentFourn=fournName;
  var year=parseInt(document.getElementById('rapprYear').value)||new Date().getFullYear();
  var trimDates=getTrimDates(rapprTrim,year);
  document.getElementById('rapprModalTitle').textContent='Saisir encours déclaré';
  document.getElementById('rapprModalFourn').textContent=fournName;
  document.getElementById('rapprModalApp').textContent=fE(nomEUR);
  document.getElementById('rapprModalPeriod').textContent=trimDates.label;
  var saved=loadRapprData(fournName,rapprTrim,year);
  document.getElementById('rapprDeclared').value=saved?saved.declared:'';
  document.getElementById('rapprComment').value=saved?saved.comment:'';
  updateRapprCalc();
  document.getElementById('rapprModal').classList.add('on');
  setTimeout(()=>document.getElementById('rapprDeclared').focus(),50);
}
function closeRapprModal(){document.getElementById('rapprModal').classList.remove('on');rapprCurrentFourn=null;}
function updateRapprCalc(){
  var declared=parseFloat(document.getElementById('rapprDeclared').value)||0;
  var app=parseFloat(document.getElementById('rapprModalApp').textContent.replace(/[^0-9.-]/g,'').replace(/\s/g,''))||0;
  // reparse from stored value
  var fournName=document.getElementById('rapprModalFourn').textContent;
  var allDeals=deals.filter(d=>d.fourn===fournName);
  var nomEUR=allDeals.reduce((s,d)=>s+(_dealNomEur(d)),0);
  if(!declared){document.getElementById('rapprEcartDisplay').textContent='—';document.getElementById('rapprEcartPct').textContent='';return;}
  var ecart=declared-nomEUR;
  var pct=nomEUR>0?((ecart/nomEUR)*100).toFixed(1)+'%':'';
  document.getElementById('rapprEcartDisplay').textContent=(ecart>0?'+':'')+fE(ecart);
  document.getElementById('rapprEcartDisplay').style.color=Math.abs(ecart)<100?'var(--green)':ecart>0?'var(--purple)':'var(--red)';
  document.getElementById('rapprEcartPct').textContent=pct?' ('+pct+' par rapport au nominal app)':'';
}
async function saveRapprochement(){
  if(!rapprCurrentFourn)return;
  var declared=parseFloat(document.getElementById('rapprDeclared').value);
  if(isNaN(declared)){alert('Veuillez saisir un montant.');return;}
  var comment=document.getElementById('rapprComment').value;
  var year=parseInt(document.getElementById('rapprYear').value)||new Date().getFullYear();
  await saveRapprData(rapprCurrentFourn,rapprTrim,year,{declared:declared,comment:comment});
  closeRapprModal();renderRapprochement();toast('Encours enregistré pour '+rapprCurrentFourn+'.');
}

// ── BROKERS ──────────────────────────────────────────────────────────────────
var BROKER_DEFAULTS=['KCS','Silex','Direct','Indosuez','Natixis','Société Générale','BNP Paribas CIB','Oddo BHF','Caceis','Autre'];
function loadBrokers(){return brokers_db.map(b=>b.name);}
function saveBrokerList(list){/* handled async */}
function renderBrokers(){
  var list=brokers_db.slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'})).map(b=>b.name);
  // Same search bar as Fournisseurs — filter brokers by name
  var qEl=document.getElementById('fournSearch');
  var q=qEl?(qEl.value||'').toLowerCase().trim():'';
  if(q)list=list.filter(function(n){return n.toLowerCase().indexOf(q)!==-1;});
  document.getElementById('brokerCount').textContent=list.length+' broker'+(list.length>1?'s':'')+(q?' (filtrés)':'');
  var t=document.getElementById('brokerT');
  while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('brokerEmpty').style.display=list.length?'none':'block';
  list.forEach(function(b){
    // Audit fix — per-broker KPIs respect vendor filter
    var dDeals=filt().filter(d=>d.broker===b);
    var nb=dDeals.length;
    var tUF=dDeals.reduce((s,d)=>s+d.ufE,0);
    var tRun=dDeals.reduce((s,d)=>s+d.runE,0);
    var last=dDeals.length?dDeals.slice().sort((a,b)=>b.date.localeCompare(a.date))[0].date:'—';
    var r=t.insertRow();
    r.innerHTML='<td style="font-weight:500;cursor:pointer;" title="Double-cliquer pour modifier" ondblclick="openBrokerModal(\''+escAttr(b)+'\')" >'+escH(b)+'</td><td style="text-align:center;">'+nb+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+(tUF>0?fE(tUF):'—')+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+(tRun>0?fE(tRun):'—')+'</td><td class="mono" style="color:var(--text2);">'+escH(last)+'</td>';
  });
  rebuildBrokerSelect();
}
function rebuildBrokerSelect(){
  var sel=document.getElementById('mBroker');
  if(sel){var cur=sel.value;sel.innerHTML=brokerOptHtml(cur);}
  document.querySelectorAll('#codifLines .codifBroker').forEach(function(s){var cur=s.value;s.innerHTML=brokerOptHtml(cur);});
}
function openBrokerModal(name){
  document.getElementById('brokerModalTitle').textContent=name?'Modifier le broker':'Nouveau broker';
  document.getElementById('bName').value=name||'';
  document.getElementById('bName').dataset.original=name||'';
  document.getElementById('brokerDeleteBtn').style.display=name?'':'none';
  document.getElementById('brokerModal').classList.add('on');
  setTimeout(()=>document.getElementById('bName').focus(),50);
}
function closeBrokerModal(){document.getElementById('brokerModal').classList.remove('on');document.getElementById('bName').dataset.original='';}
function deleteBrokerFromModal(){var o=document.getElementById('bName').dataset.original;if(!o)return;closeBrokerModal();deleteBroker(o);}
async function saveBroker(){
  var name=document.getElementById('bName').value.trim();
  var original=document.getElementById('bName').dataset.original||'';
  if(!name){alert('Nom requis.');return;}
  if(original&&original!==name){
    var b=brokers_db.find(x=>x.name===original);
    if(b){b.name=name;await sbUpdate('brokers',b._id,{name:name});}
    for(var di=0;di<deals.length;di++){var dd=deals[di];if(dd.broker===original){dd.broker=name;if(dd._id)await sbUpdate('deals',dd._id,dd);}}
  } else {
    if(!brokers_db.find(x=>x.name===name)){var res=await sbInsert('brokers',{name});if(res&&res[0])brokers_db.push({name,_id:res[0].id});}
  }
  closeBrokerModal();renderBrokers();renderDeals();toast(original?'Broker mis à jour.':'Broker ajouté.');
}
async function deleteBroker(name){
  if(!confirm('Supprimer "'+name+'" ? Cette action est irréversible.'))return;
  var b=brokers_db.find(x=>x.name===name);
  if(b&&b._id)await sbDelete('brokers',b._id);
  brokers_db=brokers_db.filter(x=>x.name!==name);
  renderBrokers();toast('Broker supprimé.');
}

async function seedFournisseurs(){
  for(var f of FOURN_DEFAULTS){var res=await sbInsert('fournisseurs',f);if(res&&res[0])fourn_db.push({...f,_id:res[0].id});}
}
async function seedBrokers(){
  for(var name of BROKER_DEFAULTS){var res=await sbInsert('brokers',{name});if(res&&res[0])brokers_db.push({name,_id:res[0].id});}
}
async function mergeFournDefaults(){
  for(var i=0;i<FOURN_DEFAULTS.length;i++){
    var def=FOURN_DEFAULTS[i];
    if(!fourn_db.find(function(f){return f.name===def.name;})){
      var res=await sbInsert('fournisseurs',def);
      if(res&&res[0])fourn_db.push(Object.assign({},def,{_id:res[0].id}));
    }
  }
}

// Sync reference tables with entities actually used in deals (handles imported data)
async function mergeClientsFromDeals(){
  var names=new Set();
  deals.forEach(function(d){if(d.client&&d.client.trim())names.add(d.client.trim());});
  for(var name of names){
    if(!clients_db.find(function(c){return c.name===name;})){
      var entry={name:name,type:'',vendeur:'',email:'',notes:''};
      try{var res=await sbInsert('clients',entry);if(res&&res[0])clients_db.push(Object.assign({},entry,{_id:res[0].id}));}
      catch(e){console.warn('mergeClientsFromDeals: insert failed for "'+name+'"',e);}
    }
  }
}
async function mergeFournsFromDeals(){
  var names=new Set();
  deals.forEach(function(d){
    if(d.fourn&&d.fourn.trim())names.add(d.fourn.trim());
    if(Array.isArray(d.codifications))d.codifications.forEach(function(c){if(c.fourn&&c.fourn.trim())names.add(c.fourn.trim());});
  });
  for(var name of names){
    if(!fourn_db.find(function(f){return f.name===name;})){
      var entry={name:name,famille:'',addr1:'',addr2:'',contact:'',email:''};
      try{var res=await sbInsert('fournisseurs',entry);if(res&&res[0])fourn_db.push(Object.assign({},entry,{_id:res[0].id}));}
      catch(e){console.warn('mergeFournsFromDeals: insert failed for "'+name+'"',e);}
    }
  }
}
async function mergeBrokersFromDeals(){
  var names=new Set();
  deals.forEach(function(d){
    if(d.broker&&d.broker.trim())names.add(d.broker.trim());
    if(Array.isArray(d.codifications))d.codifications.forEach(function(c){if(c.broker&&c.broker.trim())names.add(c.broker.trim());});
  });
  for(var name of names){
    if(!brokers_db.find(function(b){return b.name===name;})){
      try{var res=await sbInsert('brokers',{name:name});if(res&&res[0])brokers_db.push({name:name,_id:res[0].id});}
      catch(e){console.warn('mergeBrokersFromDeals: insert failed for "'+name+'"',e);}
    }
  }
}

// ── COMMISSIONS MODULE ────────────────────────────────────────────────────────
var commPeriod='annee', commDrillVendeur=null, commDrillTab='fournisseur';

function initCommPeriod(){
  // Années alimentées uniquement par les dates de paiement réelles (inv)
  var years=[...new Set(deals.filter(d=>d.fSt==='Payé'&&d.inv).map(d=>d.inv.substring(0,4)))].sort().reverse();
  if(!years.length){var y=new Date().getFullYear();years=[String(y),String(y-1)];}
  var sel=document.getElementById('commYear');
  var cur=sel.value;
  sel.innerHTML=years.map(y=>'<option'+(y===cur?' selected':'')+'>'+y+'</option>').join('');
  if(!sel.value&&years.length)sel.value=years[0];
  var msel=document.getElementById('commMonth');
  var mns=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  msel.innerHTML=mns.map((m,i)=>'<option value="'+(i+1)+'"'+(i+1===new Date().getMonth()+1?' selected':'')+'>'+m+'</option>').join('');
}

function setCommPeriod(p,btn){
  commPeriod=p;
  document.querySelectorAll('#commPeriodTabs .btn').forEach(b=>{b.style.background='';b.style.color='';b.style.borderColor='';});
  btn.style.background='var(--text)';btn.style.color='var(--surface)';btn.style.borderColor='var(--text)';
  document.getElementById('commMonth').style.display=p==='mois'?'':'none';
  document.getElementById('commTrim').style.display=p==='trimestre'?'':'none';
  renderCommissions();
}

function matchPeriod(dateStr,year,month,trim){
  if(!dateStr)return false;
  var y=dateStr.substring(0,4);
  var m=parseInt(dateStr.substring(5,7));
  if(commPeriod==='annee')return y===year;
  if(commPeriod==='mois')return y===year&&m===month;
  if(commPeriod==='trimestre'){var t=Math.ceil(m/3);return y===year&&t===trim;}
  return false;
}

function getCommDeals(){
  var year=document.getElementById('commYear').value;
  var month=parseInt(document.getElementById('commMonth').value)||1;
  var trim=parseInt(document.getElementById('commTrim').value)||1;
  // Set of fournisseurs with at least one paid running rapprochement in the active period
  var paidRunFourns={};
  rapprochement_db.forEach(function(r){
    if(r.type==='run'&&r.paid&&r.declared&&rapprMatchesCommPeriod(r.period))paidRunFourns[r.fourn]=true;
  });
  return deals.filter(function(d){
    // (A) Per-deal payments (UF / PF / one-off): require fSt='Payé' AND inv date in period
    if(d.fSt==='Payé'&&matchPeriod(d.inv,year,month,trim))return true;
    // (B) Running contribution: include this deal if ANY of its codifications has
    // Run fees AND that codif's fournisseur has a paid rapprochement in the period.
    // (Phase D.3 — was deal-level d.ct/d.fourn which mis-routed deals with mixed codifs.)
    var codifs=dealCodifsEffective(d);
    for(var i=0;i<codifs.length;i++){
      var c=codifs[i];
      if((c.ct==='RUN'||c.ct==='BOTH') && c.runE>0 && paidRunFourns[c.fourn]) return true;
    }
    return false;
  });
}

function getPeriodLabel(){
  var year=document.getElementById('commYear').value;
  if(commPeriod==='annee')return 'Année '+year;
  if(commPeriod==='mois'){var mns=['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];return mns[(parseInt(document.getElementById('commMonth').value)||1)-1]+' '+year;}
  if(commPeriod==='trimestre')return 'T'+document.getElementById('commTrim').value+' '+year;
  return '';
}

// Match a rapprochement period (T#_YYYY) against the active Commissions period selection.
function rapprMatchesCommPeriod(period){
  if(!period)return false;
  var m=period.match(/^T([1-4])_(\d{4})$/);if(!m)return false;
  var trim=parseInt(m[1]),year=m[2];
  var selYear=(document.getElementById('commYear')||{}).value||'';
  if(selYear&&year!==selYear)return false;
  if(commPeriod==='trimestre'){
    var selTrim=parseInt((document.getElementById('commTrim')||{}).value)||0;
    if(selTrim&&trim!==selTrim)return false;
  } else if(commPeriod==='mois'){
    var selMonth=parseInt((document.getElementById('commMonth')||{}).value)||0;
    if(selMonth){
      var trimOfMonth=Math.ceil(selMonth/3);
      if(trim!==trimOfMonth)return false;
    }
  }
  return true;
}

// commSummary computes UF / Running / Perf-fees totals for a slice of deals.
// `data` = deals filtered by period (and optionally by vendor). It drives UF + PF (per-deal).
// `vendorScope` = optional array of vendor names this slice represents. Used to attribute
// the Running rapprochement share by runE proportion at each fournisseur.
// Pass `null`/undefined for the "all vendors" total.
function commSummary(data,vendorScope){
  function splitFactor(d){return d.v==='Audrey & David'?0.5:1;}
  function isInScope(v){
    if(!vendorScope||!vendorScope.length)return true; // global view
    if(vendorScope.indexOf(v)!==-1)return true;
    if(v==='Audrey & David'&&(vendorScope.indexOf('Audrey')!==-1||vendorScope.indexOf('David')!==-1))return true;
    return false;
  }

  // UF — per-deal, only deals with fSt='Payé' in period
  var uf=0;
  for(var i=0;i<data.length;i++)uf+=(data[i].ufE||0)*splitFactor(data[i]);

  // RUNNING — walk ALL paid rapprochements in the selected period (regardless of data),
  // then attribute share to the vendor scope based on runE proportion at the fournisseur.
  // This handles the case where running deals are never individually marked "Payé" — the
  // rapprochement IS the running invoice.
  var run=0;
  rapprochement_db.forEach(function(r){
    if(r.type!=='run'||!r.paid||!r.declared)return;
    if(!rapprMatchesCommPeriod(r.period))return;
    // All running deals at this fournisseur (any status — used for runE share computation)
    var fournDeals=deals.filter(function(x){return (x.ct==='RUN'||x.ct==='BOTH')&&x.fourn===r.fourn;});
    var totalRunE=fournDeals.reduce(function(s,x){return s+(x.runE||0);},0);
    if(!totalRunE){
      // Edge: rapprochement exists with no associated running deal (e.g., legacy data)
      // → in global view, count it; in vendor view, skip (cannot attribute)
      if(!vendorScope||!vendorScope.length)run+=r.declared;
      return;
    }
    var inScopeRunE=0;
    fournDeals.forEach(function(x){
      if(isInScope(x.v))inScopeRunE+=(x.runE||0)*splitFactor(x);
    });
    var share=totalRunE>0?(inScopeRunE/totalRunE):0;
    run+=r.declared*share;
  });

  // PERF FEES — per-deal, only deals with fSt='Payé' in period and pf.amount set
  var pf=0;
  for(var pi=0;pi<data.length;pi++){
    var pd=data[pi];
    if(pd.pf&&pd.pf.mode!=='none'&&pd.pf.amount)pf+=pd.pf.amount*splitFactor(pd);
  }

  return {nb:data.length,uf:uf,run:run,pf:pf};
}

function renderCommissions(){
  if(!document.getElementById('commYear').value)initCommPeriod();
  var allData=getCommDeals();
  document.getElementById('commPeriodLabel').textContent=getPeriodLabel();
  closeCommDrill();

  var s=commSummary(allData,null); // null = global view across all vendors
  var ht=s.uf+s.run;
  var runLabel='Running facturé & payé';

  document.getElementById('commKpiGrid').innerHTML=
    cKpi('Total UF',fE(s.uf),s.nb+' deal'+(s.nb!==1?'s':''))+
    cKpi(runLabel,fE(s.run),'montants réellement encaissés')+
    cKpi('Perf fees',s.pf>0?fE(s.pf):'—','commissions performance')+
    cKpi('Total HT',fE(ht),'UF + Running + Perf fees','blue');


  var vendeurs=['Audrey','David'];
  var colors={Audrey:'var(--blue)',David:'var(--green)'};
  document.getElementById('commVendeurCards').innerHTML=vendeurs.map(v=>{
    // Deals solo du vendeur + deals communs (avec 50% appliqué dans commSummary)
    var vData=allData.filter(d=>d.v===v||d.v==='Audrey & David');
    var vs=commSummary(vData,[v]);
    var vht=vs.uf+vs.run;
    var pct=ht>0?Math.round(vht/ht*100):0;
    return '<div class="card" style="cursor:pointer;border:1.5px solid var(--border);" onclick="openCommDrill(\''+v+'\')">'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">'+
        '<div>'+
          '<div style="display:flex;align-items:center;gap:8px;">'+
            '<span class="av av-'+v[0].toLowerCase()+'" style="width:28px;height:28px;font-size:12px;">'+v[0]+'</span>'+
            '<span style="font-size:16px;font-weight:600;">'+v+'</span>'+
          '</div>'+
          '<div style="font-size:11px;color:var(--text2);margin-top:3px;">'+vData.length+' deal'+(vData.length!==1?'s':'')+' · '+pct+'% du total · '+getPeriodLabel()+'</div>'+
        '</div>'+
        '<span style="font-size:11px;color:var(--text2);padding:4px 10px;background:var(--surface2);border-radius:20px;">Voir détail →</span>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:12px;">'+
        '<div style="background:var(--surface2);border-radius:var(--rs);padding:10px 12px;">'+
          '<div style="font-size:10px;color:var(--text3);margin-bottom:3px;">Up-Front</div>'+
          '<div style="font-size:16px;font-weight:600;color:var(--blue);">'+fE(vs.uf)+'</div>'+
        '</div>'+
        '<div style="background:var(--surface2);border-radius:var(--rs);padding:10px 12px;">'+
          '<div style="font-size:10px;color:var(--text3);margin-bottom:3px;">'+runLabel+'</div>'+
          '<div style="font-size:16px;font-weight:600;color:var(--green);">'+fE(vs.run)+'</div>'+
        '</div>'+
        '<div style="background:var(--surface2);border-radius:var(--rs);padding:10px 12px;">'+
          '<div style="font-size:10px;color:var(--text3);margin-bottom:3px;">Perf fees</div>'+
          '<div style="font-size:16px;font-weight:600;color:var(--purple);">'+(vs.pf>0?fE(vs.pf):'—')+'</div>'+
        '</div>'+
      '</div>'+
      '<div style="border-top:1px solid var(--border);padding-top:10px;display:flex;justify-content:space-between;align-items:center;">'+
        '<div><span style="font-size:11px;color:var(--text2);">Total HT </span><span style="font-weight:600;">'+fE(vht)+'</span></div>'+
        '<div><span style="font-size:11px;color:var(--text2);">Total </span><span style="font-weight:600;font-size:15px;">'+fE(vht)+'</span></div>'+
      '</div>'+
      '<div style="margin-top:10px;"><div style="height:5px;background:var(--surface2);border-radius:3px;overflow:hidden;"><div style="height:100%;width:'+pct+'%;background:'+colors[v]+';border-radius:3px;transition:width .4s;"></div></div></div>'+
    '</div>';
  }).join('');
}

function cKpi(l,v,s,c){var col=c==='blue'?'color:var(--blue);':'';return '<div class="kpi"><div class="kpi-l">'+l+'</div><div class="kpi-v" style="'+col+'">'+v+'</div><div class="kpi-s">'+s+'</div></div>';}

function openCommDrill(vendeur){
  commDrillVendeur=vendeur;
  document.getElementById('commDrillCard').style.display='block';
  document.getElementById('commDrillTitle').innerHTML='← <strong>'+escH(vendeur)+'</strong> — Détail · '+escH(getPeriodLabel());
  setDrillTab('fournisseur',document.querySelectorAll('#commDrillTabs .stab')[0]);
  document.getElementById('commDrillCard').scrollIntoView({behavior:'smooth',block:'start'});
}

function closeCommDrill(){
  commDrillVendeur=null;
  document.getElementById('commDrillCard').style.display='none';
}

function setDrillTab(tab,btn){
  commDrillTab=tab;
  document.querySelectorAll('#commDrillTabs .stab').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  renderDrill();
}

// For commission drill: returns this deal's running contribution across all paid rapprochements
// at d.fourn that match the active commission period. Source: rapprochement_db (Supabase), not
// the legacy localStorage. Share computed against ALL running deals at the fournisseur (any
// status — running is tracked at trim+fourn level, not per-deal-payment).
function getRunProrata(d){
  if(!d||(!d.runE)||d.runE===0)return 0;
  if(d.ct!=='RUN'&&d.ct!=='BOTH')return 0;
  var fournDeals=deals.filter(function(x){return (x.ct==='RUN'||x.ct==='BOTH')&&x.fourn===d.fourn;});
  var totalRunE=fournDeals.reduce(function(s,x){return s+(x.runE||0);},0);
  if(!totalRunE)return 0;
  var contribution=0;
  rapprochement_db.forEach(function(r){
    if(r.type!=='run'||r.fourn!==d.fourn||!r.paid||!r.declared)return;
    if(!rapprMatchesCommPeriod(r.period))return;
    contribution+=r.declared*(d.runE/totalRunE);
  });
  return contribution;
}
// Phase H.4 — codif-level version : returns the running contribution of a single
// codification (not the whole deal). Used by the commission drill so a deal with
// Amundi (Run) + Banque (UF) codifs only counts Amundi's share under Amundi —
// instead of routing the whole deal to one fournisseur.
function getCodifRunProrata(codif){
  if(!codif || !codif.runE || codif.runE===0) return 0;
  if(codif.ct!=='RUN' && codif.ct!=='BOTH') return 0;
  if(!codif.fourn) return 0;
  // Sum runE across ALL codifs at this fournisseur, all deals.
  var totalRunE=0;
  deals.forEach(function(d){
    (d.codifications||[]).forEach(function(c){
      if(c.fourn===codif.fourn && (c.ct==='RUN'||c.ct==='BOTH')){
        totalRunE += c.runE||0;
      }
    });
  });
  if(!totalRunE) return 0;
  var contribution=0;
  rapprochement_db.forEach(function(r){
    if(r.type!=='run' || r.fourn!==codif.fourn || !r.paid || !r.declared) return;
    if(!rapprMatchesCommPeriod(r.period)) return;
    contribution += r.declared * (codif.runE / totalRunE);
  });
  return contribution;
}

function renderDrill(){
  if(!commDrillVendeur)return;
  var data=getCommDeals().filter(d=>d.v===commDrillVendeur||d.v==='Audrey & David');
  var t=document.getElementById('commDrillT');
  t.innerHTML='';
  document.getElementById('commDrillEmpty').style.display=data.length?'none':'block';
  // Phase H — clarify the column header. The displayed value is the rapprochement-
  // paid amount (= what the fournisseur actually declared & paid), NOT the
  // theoretical annual run × rate. Was "Running /an" which was misleading.
  var runCol='Running facturé & payé';
  var runColTitle='Montant Running réellement déclaré et payé par le fournisseur pour la période (vient des rapprochements). Pas le théorique nominal×runR%.';

  if(commDrillTab==='fournisseur'){
    t.innerHTML='<tr><th>Fournisseur</th><th class="tc">Nb deals</th><th class="tr">UF (EUR)</th><th class="tr" title="'+escAttr(runColTitle)+'">'+runCol+'</th><th class="tr">Perf fees</th><th class="tr">Total</th></tr>';
    // Phase H.4 — iterate codif-level so each fournisseur gets only its OWN
    // codifs' contributions (not the whole deal). A deal Amundi(Run)+Banque(UF)
    // splits between rows for Amundi and Banque correctly.
    var by={};
    data.forEach(function(d){
      dealCodifsEffective(d).forEach(function(c){
        var name=c.fourn||'?';
        if(!by[name])by[name]={uf:0,run:0,pf:0,dealIds:new Set()};
        by[name].dealIds.add(d._id||d);
        by[name].uf  += c.ufE||0;
        by[name].run += getCodifRunProrata(c);
        by[name].pf  += (c.pf && c.pf.amount ? c.pf.amount : 0);
      });
    });
    Object.entries(by).sort(function(a,b){return (b[1].uf+b[1].run)-(a[1].uf+a[1].run);}).forEach(function(entry){
      var f=entry[0], v=entry[1];
      var ht=v.uf+v.run;
      var nb=v.dealIds.size;
      var r=t.insertRow();
      r.innerHTML='<td style="font-weight:500;">'+escH(f)+'</td><td style="text-align:center;">'+nb+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+(v.uf>0?fE(v.uf):'—')+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+(v.run>0?fE(v.run):'—')+'</td><td style="text-align:right;color:var(--purple);">'+(v.pf>0?fE(v.pf):'—')+'</td><td style="text-align:right;font-weight:500;">'+(ht>0?fE(ht):'—')+'</td>';
    });
  } else if(commDrillTab==='client'){
    t.innerHTML='<tr><th>Client</th><th class="tc">Nb deals</th><th class="tr">UF (EUR)</th><th class="tr" title="'+escAttr(runColTitle)+'">'+runCol+'</th><th class="tr">Perf fees</th><th class="tr">Total</th></tr>';
    // Phase H.4 — same approach for client grouping : sum across all codifs.
    var by={};
    data.forEach(function(d){
      var cl=d.client||'?';
      if(!by[cl])by[cl]={uf:0,run:0,pf:0,dealIds:new Set()};
      by[cl].dealIds.add(d._id||d);
      dealCodifsEffective(d).forEach(function(c){
        by[cl].uf  += c.ufE||0;
        by[cl].run += getCodifRunProrata(c);
        by[cl].pf  += (c.pf && c.pf.amount ? c.pf.amount : 0);
      });
    });
    Object.entries(by).sort(function(a,b){return (b[1].uf+b[1].run)-(a[1].uf+a[1].run);}).forEach(function(entry){
      var c=entry[0], v=entry[1];
      var ht=v.uf+v.run;
      var nb=v.dealIds.size;
      var r=t.insertRow();
      r.innerHTML='<td style="font-weight:500;">'+escH(c)+'</td><td style="text-align:center;">'+nb+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+(v.uf>0?fE(v.uf):'—')+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+(v.run>0?fE(v.run):'—')+'</td><td style="text-align:right;color:var(--purple);">'+(v.pf>0?fE(v.pf):'—')+'</td><td style="text-align:right;font-weight:500;">'+(ht>0?fE(ht):'—')+'</td>';
    });
  } else {
    t.innerHTML='<tr><th>Date</th><th>Client</th><th>Fournisseur</th><th>Produit</th><th class="tr">Nominal</th><th class="tr">UF</th><th class="tr" title="'+escAttr(runColTitle)+'">'+runCol+'</th><th class="tr">Perf fees</th><th>Statut</th></tr>';
    data.sort((a,b)=>b.date.localeCompare(a.date)).forEach(d=>{
      var r=t.insertRow();r.className='cl';r.onclick=()=>openDet(d);
      var pf=d.pf&&d.pf.mode!=='none'&&d.pf.amount?fE(d.pf.amount):(d.pf&&d.pf.mode==='pct'&&d.pf.rate?d.pf.rate+'%':'—');
      var runP=getRunProrata(d);
      r.innerHTML='<td class="mono">'+escH(d.date)+'</td><td style="font-weight:500;">'+escH(d.client)+'</td><td>'+escH(d.fourn)+'</td><td style="color:var(--text2);">'+escH(d.produit)+'</td><td class="mono" style="text-align:right;">'+f0(d.nom)+' '+escH(d.dev)+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+(d.ufE>0?fE(d.ufE):'—')+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+(runP>0?fE(runP):'—')+'</td><td style="text-align:right;color:var(--purple);">'+pf+'</td><td>'+fBadge(d.fSt)+'</td>';
    });
  }
}

// ── GÉNÉRATION FACTURE PDF ────────────────────────────────────────────────────
function genInvoicePDF(fournName,type,period,amount,deals_list){
  var fourn=fourn_db.find(function(x){return x.name===fournName;})||{name:fournName};

  // ── Validation : refuse de générer si des infos obligatoires manquent ──
  var missing=[];
  if(!fourn.name)missing.push('Nom du fournisseur');
  if(!fourn.addr1)missing.push('Adresse postale (ligne 1)');
  if(!fourn.email)missing.push('Email du fournisseur');
  if(!amount||amount<=0)missing.push('Montant à facturer (positif)');
  if(missing.length){
    alert('Impossible de générer la facture — informations manquantes :\n\n• '+missing.join('\n• ')+'\n\nComplétez la fiche du fournisseur "'+fournName+'" puis réessayez.');
    return;
  }

  var today=new Date();
  var dateStr='Paris, le '+today.getDate()+' '+['January','February','March','April','May','June','July','August','September','October','November','December'][today.getMonth()]+' '+today.getFullYear();
  var trimLabel=period||'';
  var code=fournName.replace(/[^A-Z0-9]/gi,'').toUpperCase().substring(0,3);
  // Suffixe : T1/T2/T3/T4 pour les factures trimestrielles (RUN), 001 sinon
  var trimMatch=(period||'').match(/T([1-4])/);
  var invSuffix=(type==='RUN'&&trimMatch)?'T'+trimMatch[1]:'001';
  var invoiceNum=code+'-'+type+'-'+trimLabel.replace(/[^0-9T]/g,'')+'-'+invSuffix;
  var productsDesc=deals_list.map(function(d){return d.produit;}).filter(function(v,i,a){return a.indexOf(v)===i;}).join(' / ')||'Management Fees';
  // Logo en filigrane : URL absolue (window.open + document.write n'a pas de baseURI fiable)
  var logoUrl=window.location.origin+window.location.pathname.replace(/[^/]+$/,'')+'logo.png';

  var html=`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Facture ${invoiceNum}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page{margin:14mm 18mm;size:A4;}
  body{font-family:Arial,sans-serif;font-size:11px;color:#222;margin:0;padding:0;position:relative;}
  /* Filigrane Chamfeuil : positionné plus haut (env. 38% de la page), plus grand, légèrement plus opaque */
  body::before{
    content:'';position:fixed;top:38%;left:50%;width:90vw;height:90vw;max-width:720px;max-height:720px;
    transform:translate(-50%,-50%);
    background:url('${logoUrl}') no-repeat center/contain;
    opacity:0.18;
    z-index:-1;
    pointer-events:none;
    print-color-adjust:exact;-webkit-print-color-adjust:exact;
  }
  /* Header : fond blanc, wordmark vert, logo + divider, comme la charte Chamfeuil */
  .header-bar{background:transparent;color:#234c3e;padding:8px 0 18px 0;margin-bottom:24px;display:flex;align-items:center;gap:20px;border-bottom:1.5px solid #234c3e;}
  .header-bar .header-logo{height:54px;width:auto;flex-shrink:0;}
  .header-bar .header-divider{width:1.5px;height:54px;background:#234c3e;flex-shrink:0;}
  .header-bar .company-name{font-family:'Cinzel',Georgia,serif;font-size:30px;font-weight:600;letter-spacing:.10em;line-height:1;color:#234c3e;}
  .header-bar .company-suffix{font-family:'Cinzel',Georgia,serif;font-size:13px;font-weight:500;letter-spacing:.55em;margin-top:5px;text-indent:.55em;color:#234c3e;}
  /* Numéro de facture épinglé en haut à droite, vraiment dans le coin de la page */
  .invoice-num-corner{position:absolute;top:0;right:0;font-family:'Cinzel',Georgia,serif;font-size:14px;font-weight:500;letter-spacing:.04em;color:#234c3e;line-height:1;}
  .section{margin-bottom:16px;}
  .label{font-weight:bold;font-size:11px;color:#234c3e;text-transform:uppercase;margin-bottom:4px;}
  .from-to{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-bottom:20px;}
  .box{border-left:3px solid #234c3e;padding-left:10px;}
  .amount-box{background:#eef4f0;border:1px solid #234c3e;padding:12px 18px;margin:20px 0;display:flex;justify-content:space-between;align-items:center;}
  .amount-box .amount{font-size:22px;font-weight:bold;color:#234c3e;}
  .amount-box .label2{font-size:11px;color:#555;}
  .detail-table{width:100%;border-collapse:collapse;margin:14px 0;background:rgba(255,255,255,0.85);}
  .detail-table th{background:#234c3e;color:white;padding:7px 10px;text-align:left;font-size:10px;}
  .detail-table td{padding:6px 10px;border-bottom:1px solid #e0e0e0;font-size:10px;}
  .detail-table tr:last-child td{border-bottom:2px solid #234c3e;font-weight:bold;}
  .legal{font-size:9px;color:#555;line-height:1.5;border-top:1px solid #ccc;padding-top:10px;margin-top:16px;}
  .payment{background:#f9f9f9;border:1px solid #ddd;padding:12px 16px;margin-top:14px;}
  .payment .title{font-weight:bold;color:#234c3e;margin-bottom:6px;font-size:11px;}
  .footer-bar{background:#234c3e;color:white;padding:8px 20px;font-size:9px;text-align:center;margin-top:20px;}
  .exo{font-style:italic;color:#555;font-size:10px;margin-top:6px;}
</style></head><body>

<div class="invoice-num-corner">Facture ${invoiceNum}</div>
<div class="header-bar">
  <img src="${logoUrl}" class="header-logo" alt="">
  <div class="header-divider"></div>
  <div>
    <div class="company-name">CHAMFEUIL</div>
    <div class="company-suffix">CAPITAL</div>
  </div>
</div>

<div class="section">
  <div style="font-size:12px;margin-bottom:4px;"><strong>Date :</strong> ${dateStr}</div>
  <div style="font-size:12px;"><strong>${type==='RUN'?'Management Fees rebates from':type==='PF'?'Performance Fees —':'Up-Front Commission —'} ${fournName}</strong></div>
  ${type==='RUN'&&period?`<div style="font-size:11px;color:#555;margin-top:3px;">Period: ${period} — ${productsDesc}</div>`:`<div style="font-size:11px;color:#555;margin-top:3px;">${productsDesc}</div>`}
</div>

<div class="from-to">
  <div class="box">
    <div class="label">From</div>
    <strong>Chamfeuil Capital</strong><br>
    231 rue Saint Honoré 75001 Paris<br>
    audrey.gary@chamfeuilcapital.com<br>
    +33 (6) 59 66 25 87<br>
    VAT Number: FR11928443001
  </div>
  <div class="box">
    <div class="label">To</div>
    <strong>${fourn.name}</strong><br>
    ${fourn.addr1?fourn.addr1+'<br>':''}
    ${fourn.addr2?fourn.addr2+'<br>':''}
    ${fourn.contact?'Attention : '+fourn.contact+'<br>':''}
    ${fourn.email?fourn.email:''}
  </div>
</div>

<div class="amount-box">
  <div>
    <div class="label2">COMMISSION AMOUNT</div>
    <div class="amount">${new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(amount)} EUR</div>
    <div class="label2">payable in euros</div>
  </div>
  <div style="text-align:right;font-size:11px;color:#555;">
    ${type==='RUN'?'Running fees — pro-rata temporis':'Up-Front commission — opération unique'}
    ${type==='RUN'&&period?'<br>'+period:''}
  </div>
</div>

<table class="detail-table">
  ${type==='RUN'?`
  <tr><th>Description</th><th>Période</th><th>Encours total (EUR)</th><th>Taux moyen</th><th>Montant facturé</th></tr>
  <tr>
    <td>Management Fees rebates — ${fournName}</td>
    <td>${period||'—'}</td>
    <td>${new Intl.NumberFormat('fr-FR').format(Math.round(deals_list.reduce((s,d)=>s+(_dealNomEur(d)),0)))} EUR</td>
    <td>${deals_list.length>0?((deals_list.reduce((s,d)=>s+(d.runR||0),0)/deals_list.length).toFixed(3))+'%/an':'—'}</td>
    <td>${new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2}).format(amount)} EUR</td>
  </tr>
  <tr class="total-row"><td colspan="4"><strong>Total</strong></td><td><strong>${new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2}).format(amount)} EUR</strong></td></tr>
  `:`
  <tr><th>Client</th><th>Produit</th><th>Nominal</th><th>Taux</th><th>Montant</th></tr>
  ${deals_list.map(d=>`<tr><td>${d.client}</td><td>${d.produit||'—'}</td><td>${new Intl.NumberFormat('fr-FR').format(Math.round(d.nom||0))} ${d.dev||'EUR'}</td><td>${(d.ufR||0)+'%'}</td><td>${new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2}).format(d.ufE||0)} EUR</td></tr>`).join('')}
  <tr class="total-row"><td colspan="4"><strong>Total</strong></td><td><strong>${new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2}).format(amount)} EUR</strong></td></tr>
  `}
</table>

<div class="exo">* Exonéré de TVA selon Art 261 C 1° du CGI.</div>

<div class="legal">
  Conformément à l'article L441-6 du code du commerce, des pénalités de retard sont dues à défaut de règlement le jour suivant la date d'échéance, le taux d'intérêt de ces pénalités de retard est de 3 fois le montant du taux d'intérêt légal. Conformément au décret 2012-1115 du 02/10/12, tout retard de paiement entraînera l'application d'une indemnité forfaitaire pour frais de recouvrement de 40€.<br><br>
  Aucun escompte n'est accordé pour paiement anticipé. Payable à l'échéance.
</div>

<div class="payment">
  <div class="title">Payment Details :</div>
  Agence LCL PARIS MOZART<br>
  IBAN FR57 3000 2004 2900 0037 6067 N50<br>
  Code B.I.C. CRLYFRPP<br><br>
  <strong>TITULAIRE DU COMPTE : CHAMFEUIL</strong><br>
  231 RUE SAINT HONORE 75001 PARIS<br><br>
  <em>Payment is due within 30 days of the invoice date</em><br>
  <em>Please mention the invoice number when making the payment</em><br>
  <em>For any queries, contact us at audrey.gary@chamfeuilcapital.com</em>
</div>

<div class="footer-bar">
  contact@chamfeuilcapital.com &nbsp;|&nbsp; 231 rue Saint-Honoré – 75001 Paris &nbsp;|&nbsp; chamfeuilcapital.com &nbsp;|&nbsp; RCS PARIS : 928 443 001 — CHAMFEUIL CAPITAL, société au capital de 40.000 EUROS — ORIAS n°24004789
</div>

</body></html>`;

  // Open in new window and trigger print as PDF
  var win=window.open('','_blank');
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(()=>{win.print();},500);
}

var _ufCurrentFourn=null;
var _ufCurrentDealIdx=null;

function openUFFactModalDeal(idx){
  var d=deals[idx];
  if(!d){toast('Deal introuvable.');return;}
  _ufCurrentDealIdx=idx;
  _ufCurrentFourn=null;
  document.getElementById('ufFactModalTitle').textContent='Facture UF — '+d.fourn;
  document.getElementById('ufFmFourn').textContent=d.fourn;
  document.getElementById('ufFmAmount').textContent=fE(d.ufE);
  document.getElementById('ufFmComment').value='';
  document.getElementById('ufFmDeals').innerHTML=
    '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);">'+
    '<div><strong>'+d.client+'</strong><span style="color:var(--text2);margin-left:8px;">'+d.produit+'</span></div>'+
    '<div style="font-weight:600;color:var(--blue);">'+fE(d.ufE)+'</div></div>';
  document.getElementById('ufFactModal').classList.add('on');
}

function openUFFactModal(fournName){
  // kept for compatibility if needed
  _ufCurrentFourn=fournName;_ufCurrentDealIdx=null;
  document.getElementById('ufFactModalTitle').textContent='Facture UF — '+fournName;
  document.getElementById('ufFmFourn').textContent=fournName;
  document.getElementById('ufFmAmount').textContent='—';
  document.getElementById('ufFmDeals').innerHTML='';
  document.getElementById('ufFactModal').classList.add('on');
}

function closeUFFactModal(){document.getElementById('ufFactModal').classList.remove('on');_ufCurrentFourn=null;_ufCurrentDealIdx=null;}

async function confirmUFInvoice(){
  if(_ufCurrentDealIdx!=null){
    // Single deal mode
    var d=deals[_ufCurrentDealIdx];
    if(!d)return;
    genInvoicePDF(d.fourn,'UF',null,d.ufE,[d]);
    // Mark as Facturé
    d.fSt='Facturé';
    d.invS=new Date().toISOString().split('T')[0];
    if(!d.hist)d.hist=[];
    d.hist.push({ts:nowS(),a:'Facture UF générée',by:'Système'});
    var{_id,...data}=d;if(_id)await sbUpdate('deals',_id,data);
    closeUFFactModal();renderRecapFourn();renderUFInvTable();renderFact();renderKpis();
    toast('Facture UF générée pour '+d.client+'.');
  } else if(_ufCurrentFourn){
    var data=window._ufRecapData&&window._ufRecapData[_ufCurrentFourn];
    if(!data)return;
    genInvoicePDF(_ufCurrentFourn,'UF',null,data.uf,data.deals);
    closeUFFactModal();
    toast('Facture UF générée pour '+_ufCurrentFourn+'.');
  }
}

// ── WEALINS CONTRATS PAGE ────────────────────────────────────────────────────
var ctrExp={};       // contract id → expanded
var prodExp={};      // contractId|prodId → expanded
// escH defined globally at top of file (XSS helpers)
function fmtEUR(n){return new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n||0);}

function renderContratsStats(){
  var total=contracts_db.length;
  var allProds=[];
  contracts_db.forEach(function(c){(c.produits||[]).forEach(function(p){allProds.push(p);});});
  var done=0,prog=0,totalEUR=0;
  allProds.forEach(function(p){
    var pr=prodProgress(p);
    if(pr.total>0&&pr.done===pr.total)done++;
    else if(pr.done>0)prog++;
    totalEUR+=parseMoney(p.montant);
  });
  var html=
    '<div class="kpi"><div class="kpi-l">Contrats</div><div class="kpi-v">'+total+'</div><div class="kpi-s">clients suivis</div></div>'+
    '<div class="kpi"><div class="kpi-l">Investissements</div><div class="kpi-v">'+allProds.length+'</div><div class="kpi-s">au total</div></div>'+
    '<div class="kpi"><div class="kpi-l">Complétés</div><div class="kpi-v" style="color:var(--green-t);">'+done+'</div><div class="kpi-s">checklist 100%</div></div>'+
    '<div class="kpi'+(prog>0?' warn':'')+'"><div class="kpi-l">En cours</div><div class="kpi-v">'+prog+'</div><div class="kpi-s">à compléter</div></div>'+
    '<div class="kpi"><div class="kpi-l">Total investi</div><div class="kpi-v">'+fmtEUR(totalEUR)+'</div><div class="kpi-s">portefeuilles cumulés</div></div>';
  var el=document.getElementById('contratsStats');
  if(el)el.innerHTML=html;
}

function renderTemplatesPanel(){
  var el=document.getElementById('templatesPanel');if(!el)return;
  var open=ctrTemplatesOpen;
  if(!templates_db.length){
    el.innerHTML='<div style="display:flex;align-items:center;gap:10px;padding:8px 0;"><span style="font-size:12px;color:var(--text2);">Aucun template défini.</span><div style="flex:1;"></div><button class="btn btn-sm btn-primary" onclick="openTemplateModal()">+ Créer un template</button></div>';
    return;
  }
  var header='<div style="display:flex;align-items:center;gap:10px;cursor:pointer;" onclick="toggleTemplatesPanel()">'+
    '<span style="font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.4px;">Templates de contrats <span style="background:var(--surface2);padding:1px 8px;border-radius:999px;font-weight:500;">'+templates_db.length+'</span></span>'+
    '<div style="flex:1;"></div>'+
    '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();openTemplateModal()">+ Nouveau template</button>'+
    '<span class="chev'+(open?' open':'')+'" style="font-size:14px;color:var(--text2);">▾</span>'+
  '</div>';
  if(!open){el.innerHTML=header;return;}
  el.innerHTML=header+
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:10px;">'+
    templates_db.map(function(t){
      return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--rs);padding:12px 14px;display:flex;flex-direction:column;gap:6px;">'+
        '<div style="display:flex;align-items:center;gap:8px;">'+
          '<span style="font-size:13px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+escH(t.name)+'</span>'+
          '<button class="btn btn-sm" style="padding:3px 8px;font-size:11px;" onclick="openTemplateModal(\''+t._id+'\')">✎</button>'+
          '<button class="btn btn-sm" style="padding:3px 8px;font-size:11px;color:var(--red);border-color:var(--red-bg);" onclick="confirmDeleteTemplate(\''+t._id+'\')">×</button>'+
        '</div>'+
        '<div style="font-size:11px;color:var(--text2);">'+(t.prelim||[]).length+' étape'+((t.prelim||[]).length>1?'s':'')+' préliminaire'+((t.prelim||[]).length>1?'s':'')+' · '+(t.step_packs||[]).length+' pack'+((t.step_packs||[]).length>1?'s':'')+' d\'investissement</div>'+
        ((t.step_packs||[]).length?'<div style="font-size:11px;color:var(--text3);margin-top:2px;">'+(t.step_packs||[]).map(function(p){return escH(p.name)+' ('+(p.steps||[]).length+')';}).join(' · ')+'</div>':'')+
      '</div>';
    }).join('')+
    '</div>';
}
var ctrTemplatesOpen=true;
function toggleTemplatesPanel(){ctrTemplatesOpen=!ctrTemplatesOpen;renderTemplatesPanel();}

function renderContrats(){
  renderTemplatesPanel();
  renderContratsStats();
  var search=(document.getElementById('ctSearch')?document.getElementById('ctSearch').value:'').toLowerCase();
  var stat=document.getElementById('ctStat')?document.getElementById('ctStat').value:'';
  var sort=document.getElementById('ctSort')?document.getElementById('ctSort').value:'recent';
  var list=contracts_db.slice();
  if(search){
    list=list.filter(function(c){
      var hay=(c.client+' '+(c.num||'')+' '+(c.notes||'')).toLowerCase();
      if(hay.indexOf(search)!==-1)return true;
      return (c.produits||[]).some(function(p){return ((p.name||'')+' '+(p.isin||'')).toLowerCase().indexOf(search)!==-1;});
    });
  }
  if(stat)list=list.filter(function(c){return contratStatus(c)===stat;});
  if(sort==='name')list.sort(function(a,b){return a.client.localeCompare(b.client);});
  else if(sort==='progress')list.sort(function(a,b){return globalPct(b)-globalPct(a);});
  else list.sort(function(a,b){return new Date(b.created_at||0)-new Date(a.created_at||0);});

  var container=document.getElementById('contratsList');
  if(!list.length){
    container.innerHTML='';
    document.getElementById('contratsEmpty').style.display='block';
    return;
  }
  document.getElementById('contratsEmpty').style.display='none';

  container.innerHTML=list.map(function(c){
    var st=contratStatus(c);
    var pct=globalPct(c);
    var pp=prelimProgress(c);
    var produits=c.produits||[];
    var stLbl=st==='done'?'Complété':st==='in-progress'?'En cours':'Non démarré';
    var stCls=st==='done'?'pill-done':st==='in-progress'?'pill-prog':'pill-new';
    var open=ctrExp[c._id];
    var prelimHTML=(c.prelim||[]).map(function(s,idx){
      return '<div class="step-row">'+
        '<div class="chk'+(s.done?' on':'')+'" onclick="togglePrelim(\''+c._id+'\','+idx+')"></div>'+
        '<span class="step-lbl'+(s.done?' struck':'')+'" ondblclick="renamePrelimStep(\''+c._id+'\','+idx+')">'+escH(s.label)+'</span>'+
        '<button class="btn btn-sm" style="padding:2px 6px;font-size:10px;color:var(--text3);border-color:transparent;" onclick="renamePrelimStep(\''+c._id+'\','+idx+')" title="Renommer">✎</button>'+
        '<button class="btn btn-sm" style="padding:2px 6px;font-size:10px;color:var(--red);border-color:transparent;" onclick="deletePrelimStep(\''+c._id+'\','+idx+')" title="Supprimer">×</button>'+
      '</div>';
    }).join('')+
    '<div style="margin-top:6px;"><button class="btn btn-sm" onclick="addPrelimStep(\''+c._id+'\')" style="font-size:11px;">+ Ajouter une étape</button></div>';

    var produitsHTML=produits.length?produits.map(function(p){
      var pr=prodProgress(p);
      var pKey=c._id+'|'+p.id;
      var pOpen=prodExp[pKey];
      // Prefer the user-defined pack_name as the pill label; fall back to old type label
      var pillText=p.pack_name||WTYPE_LBL[p.type]||p.type||'?';
      var typeBadge='<span class="badge '+(WTYPE_BADGE[p.type]||'bgr')+'">'+escH(pillText)+'</span>';
      // Arbitrage badges
      var arbBadges='';
      if(p.arb_origin)arbBadges+='<span class="badge bp" title="Issu de l\'arbitrage '+escH(p.arb_origin.arbId||'')+' depuis '+escH(p.arb_origin.source_fourn||'')+' le '+escH(p.arb_origin.date||'')+'">← Arbitrage</span> ';
      if(Array.isArray(p.arbitrages)&&p.arbitrages.length)arbBadges+='<span class="badge ba" title="'+p.arbitrages.length+' arbitrage(s) sortant(s)">→ Arbitré ('+p.arbitrages.length+')</span> ';
      if(Array.isArray(p.retraits)&&p.retraits.length){
        var totalRetrait=p.retraits.reduce(function(s,r){return s+(r.montant||0);},0);
        var hasClosure=p.retraits.some(function(r){return r.closed;});
        arbBadges+='<span class="badge '+(hasClosure?'br':'ba')+'" title="'+p.retraits.length+' retrait(s) — total '+fE(totalRetrait)+(hasClosure?' (position clôturée)':'')+'">↓ Retrait'+(p.retraits.length>1?'s ('+p.retraits.length+')':'')+'</span> ';
      }
      var stepsHTML=(p.steps||[]).map(function(s,idx){
        return '<div class="step-row">'+
          '<div class="chk'+(s.done?' on':'')+'" onclick="toggleProdStep(\''+c._id+'\',\''+p.id+'\','+idx+')"></div>'+
          '<span class="step-lbl'+(s.done?' struck':'')+'" ondblclick="renameProdStep(\''+c._id+'\',\''+p.id+'\','+idx+')">'+escH(s.label)+'</span>'+
          (s.note?'<span class="step-note">'+escH(s.note)+'</span>':'')+
          '<button class="btn btn-sm" style="padding:2px 6px;font-size:10px;color:var(--text3);border-color:transparent;" onclick="renameProdStep(\''+c._id+'\',\''+p.id+'\','+idx+')" title="Renommer">✎</button>'+
          '<button class="btn btn-sm" style="padding:2px 6px;font-size:10px;color:var(--red);border-color:transparent;" onclick="deleteProdStep(\''+c._id+'\',\''+p.id+'\','+idx+')" title="Supprimer">×</button>'+
        '</div>';
      }).join('')+
      '<div style="margin-top:6px;"><button class="btn btn-sm" onclick="addProdStep(\''+c._id+'\',\''+p.id+'\')" style="font-size:11px;">+ Ajouter une étape</button></div>';

      // Arbitrage detail block when expanded
      var arbDetail='';
      if(Array.isArray(p.arbitrages)&&p.arbitrages.length){
        arbDetail='<div style="margin:8px 0;padding:8px 10px;background:var(--purple-bg);border-radius:4px;border-left:2px solid var(--purple);font-size:11px;">'+
          '<div style="font-weight:600;color:var(--purple-t);margin-bottom:4px;">Arbitrages sortants</div>'+
          p.arbitrages.map(function(a){
            return '<div style="margin-top:3px;color:var(--purple-t);">• '+escH(a.date)+' — '+fE(a.montant)+' vers '+(a.destinations||[]).map(function(dst){return escH(dst.fourn)+' ('+fE(dst.montant)+')';}).join(', ')+(a.prorata_run?' · pro-rata Running '+fE(a.prorata_run):'')+'</div>';
          }).join('')+
        '</div>';
      }
      if(p.arb_origin){
        arbDetail+='<div style="margin:8px 0;padding:8px 10px;background:var(--purple-bg);border-radius:4px;border-left:2px solid var(--purple);font-size:11px;color:var(--purple-t);">'+
          '← Issu de l\'arbitrage '+escH(p.arb_origin.arbId||'')+' depuis <b>'+escH(p.arb_origin.source_fourn||'')+'</b> le '+escH(p.arb_origin.date||'')+
        '</div>';
      }

      // Batch C.1 — sub-row: fourn · assureur · banque · billing mode badge
      var cpartyChips=[];
      if(p.fourn)cpartyChips.push('<span style="color:var(--text3);">SDG</span> <b style="color:var(--text2);">'+escH(p.fourn)+'</b>');
      if(p.assureur)cpartyChips.push('<span style="color:var(--text3);">Assureur</span> <b style="color:var(--text2);">'+escH(p.assureur)+'</b>');
      if(p.banque)cpartyChips.push('<span style="color:var(--text3);">Banque</span> <b style="color:var(--text2);">'+escH(p.banque)+'</b>');
      var billingBadge='';
      if(p.billingMode){
        var bm=p.billingMode;
        billingBadge='<span style="font-size:9px;padding:1px 5px;border-radius:3px;font-weight:600;margin-left:4px;'+
          (bm==='feed'?'background:rgba(176,122,16,.15);color:#b07a10;':'background:rgba(29,95,212,.12);color:#1d5fd4;')+
          '">'+(bm==='feed'?'FEED':'FAST')+'</span>';
      }
      var subRow=(cpartyChips.length||billingBadge)?
        '<div style="display:flex;gap:10px;align-items:center;font-size:10px;color:var(--text2);padding:4px 12px 0;flex-wrap:wrap;">'+
          cpartyChips.join('<span style="color:var(--text3);">·</span>')+
          billingBadge+
        '</div>':'';
      return '<div class="ctr-deal-card">'+
        '<div class="ctr-deal-hd" onclick="toggleProdExp(\''+pKey+'\')">'+
          typeBadge+
          arbBadges+
          '<span style="font-size:12px;font-weight:600;flex:1;min-width:120px;">'+escH(p.name||'(sans nom)')+'</span>'+
          (p.isin?'<span class="mono" style="font-size:11px;color:var(--text2);background:var(--surface);padding:2px 6px;border-radius:4px;">'+escH(p.isin)+'</span>':'')+
          (p.montant?'<span style="font-size:12px;color:var(--text);font-weight:600;">'+escH(p.montant)+'</span>':'')+
          '<span style="font-size:11px;font-weight:600;color:var(--text);">'+pr.pct+'%</span>'+
          ((pr.total>0&&pr.done<pr.total)?'<button class="btn btn-sm" style="font-size:10px;padding:3px 8px;color:var(--green-t);border-color:var(--green-bg);background:var(--green-bg);" onclick="event.stopPropagation();completeAllProd(\''+c._id+'\',\''+p.id+'\')" title="Cocher toutes les étapes de cet investissement">✓</button>':'')+
          '<button class="btn btn-sm" onclick="event.stopPropagation();openProdModal(\''+c._id+'\',\''+p.id+'\')">Modifier</button>'+
          '<button class="btn btn-sm" style="color:var(--red);border-color:var(--red-bg);" onclick="event.stopPropagation();deleteProd(\''+c._id+'\',\''+p.id+'\')">×</button>'+
          '<span class="chev'+(pOpen?' open':'')+'">▾</span>'+
        '</div>'+
        subRow+
        '<div class="ctr-bar"><div class="ctr-bar-fill'+(pr.pct===100?' full':'')+'" style="width:'+pr.pct+'%;"></div></div>'+
        (pOpen?'<div style="padding-top:8px;">'+arbDetail+(p.notes?'<div style="font-size:12px;color:var(--text2);font-style:italic;margin-bottom:8px;padding:6px 10px;background:var(--surface);border-radius:4px;border-left:2px solid var(--amber);">'+escH(p.notes)+'</div>':'')+stepsHTML+'</div>':'')+
      '</div>';
    }).join(''):'<div style="font-size:12px;color:var(--text3);padding:8px 0;">Aucun investissement — cliquez sur Ajouter.</div>';

    return '<div class="ctr-card '+st+'">'+
      '<div class="ctr-hd" onclick="toggleCtr(\''+c._id+'\')">'+
        '<div class="av av-a">'+escH((c.client||'?').slice(0,2).toUpperCase())+'</div>'+
        '<div class="ctr-info">'+
          '<div class="ctr-name">'+escH(c.client)+'</div>'+
          '<div class="ctr-meta">'+
            '<span>#'+escH(c.num||'—')+'</span>'+
            '<span>'+escH(c.banque||'')+'</span>'+
            '<span>'+produits.length+' investissement'+(produits.length!==1?'s':'')+'</span>'+
          '</div>'+
        '</div>'+
        '<div class="ctr-right">'+
          '<span class="ctr-pill '+stCls+'">'+stLbl+'</span>'+
          '<span class="ctr-pct">'+pct+'%</span>'+
          (pct<100?'<button class="btn btn-sm" style="color:var(--green-t);border-color:var(--green-bg);background:var(--green-bg);" onclick="event.stopPropagation();completeAllContract(\''+c._id+'\')" title="Cocher toutes les étapes (prélim + investissements)">✓ Tout cocher</button>':'')+
          '<button class="btn btn-sm" onclick="event.stopPropagation();openContractModal(\''+c._id+'\')">Modifier</button>'+
          '<button class="btn btn-sm" style="color:var(--red);border-color:var(--red-bg);" onclick="event.stopPropagation();deleteContractFromCard(\''+c._id+'\')">×</button>'+
          '<span class="chev'+(open?' open':'')+'">▾</span>'+
        '</div>'+
      '</div>'+
      '<div class="ctr-bar"><div class="ctr-bar-fill'+(pct===100?' full':'')+'" style="width:'+pct+'%;"></div></div>'+
      (open?'<div class="ctr-body">'+
        (c.notes?'<div style="font-size:12px;color:var(--text2);font-style:italic;margin-top:10px;padding:8px 10px;background:var(--amber-bg);border-radius:var(--rs);border-left:3px solid var(--amber);">'+escH(c.notes)+'</div>':'')+
        '<div class="ctr-section-title">Étapes préliminaires <span class="ctr-section-count">'+pp.done+'/'+pp.total+'</span></div>'+
        prelimHTML+
        renderClientArbitragesPanel(c)+
        '<div class="ctr-section-title">Investissements <span class="ctr-section-count">'+produits.length+'</span><div style="flex:0;"><button class="btn btn-sm" onclick="openProdModal(\''+c._id+'\')" style="font-size:11px;margin-left:8px;">+ Ajouter</button></div></div>'+
        produitsHTML+
      '</div>':'')+
    '</div>';
  }).join('');
}

// Aggregate all arbitrages for a contract from its produits[].arbitrages,
// and combine with any deal-level arb info for completeness.
function renderClientArbitragesPanel(contract){
  var produits=contract.produits||[];
  var allArbs=[];
  produits.forEach(function(p){
    (p.arbitrages||[]).forEach(function(a){
      allArbs.push({date:a.date,arbId:a.arbId,sourceProduit:p.name,sourceFourn:'',montant:a.montant,prorata:a.prorata_run,destinations:a.destinations||[]});
    });
  });
  if(!allArbs.length)return '';
  allArbs.sort(function(a,b){return (b.date||'').localeCompare(a.date||'');});
  var totalArbed=allArbs.reduce(function(s,a){return s+(a.montant||0);},0);
  var totalProrata=allArbs.reduce(function(s,a){return s+(a.prorata||0);},0);
  var html='<div class="ctr-section-title">Arbitrages <span class="ctr-section-count">'+allArbs.length+'</span></div>'+
    '<div style="background:var(--purple-bg);border-radius:var(--rs);padding:10px 12px;border:1px solid rgba(107,79,196,.2);font-size:12px;color:var(--purple-t);">'+
      '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px;font-size:11px;">'+
        '<span><b>'+allArbs.length+'</b> opération'+(allArbs.length>1?'s':'')+'</span>'+
        '<span><b>'+fE(totalArbed)+'</b> arbitré au total</span>'+
        '<span><b>'+fE(totalProrata)+'</b> de pro-rata cumulé</span>'+
      '</div>'+
      allArbs.map(function(a){
        var dests=(a.destinations||[]).map(function(dst){return escH(dst.fourn||'?')+' ('+fE(dst.montant)+')';}).join(', ');
        return '<div style="padding:6px 0;border-top:1px dashed rgba(107,79,196,.2);">'+
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'+
            '<span class="mono" style="font-size:10px;color:var(--text3);">'+escH(a.arbId||'')+'</span>'+
            '<span style="font-weight:600;">'+escH(a.date||'')+'</span>'+
            '<span style="color:var(--text2);">·</span>'+
            '<span>'+escH(a.sourceProduit||'')+' → '+dests+'</span>'+
            '<div style="flex:1;"></div>'+
            '<span class="badge bp">'+fE(a.montant)+'</span>'+
            (a.prorata?'<span class="badge ba">+'+fE(a.prorata)+' pro-rata</span>':'')+
          '</div>'+
        '</div>';
      }).join('')+
    '</div>';
  return html;
}

function toggleCtr(id){ctrExp[id]=!ctrExp[id];renderContrats();}
function toggleProdExp(key){prodExp[key]=!prodExp[key];renderContrats();}

async function persistContract(c){try{await saveContract(c);}catch(e){console.error(e);toast('Erreur de sauvegarde.');}}

// Tick all prelim steps + all investment steps in one go.
async function completeAllContract(contractId){
  var c=contracts_db.find(function(x){return x._id===contractId;});if(!c)return;
  var totalSteps=(c.prelim||[]).length+(c.produits||[]).reduce(function(s,p){return s+((p.steps||[]).length);},0);
  if(totalSteps===0){toast('Aucune étape à cocher.');return;}
  if(!confirm('Cocher toutes les étapes de ce contrat ('+totalSteps+' étape'+(totalSteps>1?'s':'')+') ?'))return;
  (c.prelim||[]).forEach(function(s){s.done=true;});
  (c.produits||[]).forEach(function(p){(p.steps||[]).forEach(function(s){s.done=true;});});
  await persistContract(c);renderContrats();updateContratsBadge();
  toast(totalSteps+' étape'+(totalSteps>1?'s':'')+' cochée'+(totalSteps>1?'s':''));
}

// Tick all steps of one investment.
async function completeAllProd(contractId,prodId){
  var c=contracts_db.find(function(x){return x._id===contractId;});if(!c)return;
  var p=(c.produits||[]).find(function(x){return x.id===prodId;});if(!p||!p.steps||!p.steps.length)return;
  var n=p.steps.length;
  p.steps.forEach(function(s){s.done=true;});
  await persistContract(c);renderContrats();updateContratsBadge();
  toast(n+' étape'+(n>1?'s':'')+' cochée'+(n>1?'s':'')+' sur '+(p.name||'investissement'));
}

async function checkAndTransitionDeals(c){
  if(contratStatus(c)!=='done')return;
  var dealIds=(c.produits||[]).map(function(p){return p.deal_id;}).filter(Boolean);
  if(!dealIds.length)return;
  var transitioned=0;
  for(var i=0;i<deals.length;i++){
    var d=deals[i];
    if(dealIds.indexOf(d._id)>=0&&d.stat==='Deal pipe'){
      d.stat='Deal réalisé';
      d.hist=Array.isArray(d.hist)?d.hist:[];
      d.hist.push({ts:nowS(),a:'Deal passé en réalisé — toutes les étapes Suivi Contrats complétées',by:'Système'});
      if(d._id){var{_id,...upd}=d;await sbUpdate('deals',_id,upd);}
      transitioned++;
    }
  }
  if(transitioned>0){renderAll();toast(transitioned+' deal'+(transitioned>1?'s passés':'  passé')+' en réalisé — toutes les étapes sont complétées ✓');}
}
async function togglePrelim(contractId,idx){
  var c=contracts_db.find(function(x){return x._id===contractId;});if(!c||!c.prelim||!c.prelim[idx])return;
  c.prelim[idx].done=!c.prelim[idx].done;
  await persistContract(c);renderContrats();updateContratsBadge();
  await checkAndTransitionDeals(c);
}
async function addPrelimStep(contractId){
  var c=contracts_db.find(function(x){return x._id===contractId;});if(!c)return;
  var label=prompt('Libellé de la nouvelle étape préliminaire :');
  if(!label||!label.trim())return;
  c.prelim=c.prelim||[];
  c.prelim.push({id:newStepId(),label:label.trim(),done:false});
  await persistContract(c);renderContrats();updateContratsBadge();
}
async function renamePrelimStep(contractId,idx){
  var c=contracts_db.find(function(x){return x._id===contractId;});if(!c||!c.prelim[idx])return;
  var label=prompt('Renommer cette étape :',c.prelim[idx].label);
  if(label===null)return;
  if(!label.trim()){alert('Libellé vide.');return;}
  c.prelim[idx].label=label.trim();
  await persistContract(c);renderContrats();
}
async function deletePrelimStep(contractId,idx){
  var c=contracts_db.find(function(x){return x._id===contractId;});if(!c||!c.prelim[idx])return;
  if(!confirm('Supprimer l\'étape "'+c.prelim[idx].label+'" ?'))return;
  c.prelim.splice(idx,1);
  await persistContract(c);renderContrats();updateContratsBadge();
}

async function toggleProdStep(contractId,prodId,idx){
  var c=contracts_db.find(function(x){return x._id===contractId;});if(!c)return;
  var p=(c.produits||[]).find(function(x){return x.id===prodId;});if(!p||!p.steps[idx])return;
  p.steps[idx].done=!p.steps[idx].done;
  await persistContract(c);renderContrats();updateContratsBadge();
  await checkAndTransitionDeals(c);
}
async function addProdStep(contractId,prodId){
  var c=contracts_db.find(function(x){return x._id===contractId;});if(!c)return;
  var p=(c.produits||[]).find(function(x){return x.id===prodId;});if(!p)return;
  var label=prompt('Libellé de la nouvelle étape :');if(!label||!label.trim())return;
  var note=prompt('Annotation optionnelle (laissez vide pour aucune) :','');
  p.steps=p.steps||[];
  var step={id:newStepId(),label:label.trim(),done:false};
  if(note&&note.trim())step.note=note.trim();
  p.steps.push(step);
  await persistContract(c);renderContrats();updateContratsBadge();
}
async function renameProdStep(contractId,prodId,idx){
  var c=contracts_db.find(function(x){return x._id===contractId;});if(!c)return;
  var p=(c.produits||[]).find(function(x){return x.id===prodId;});if(!p||!p.steps[idx])return;
  var label=prompt('Renommer cette étape :',p.steps[idx].label);
  if(label===null)return;
  if(!label.trim()){alert('Libellé vide.');return;}
  p.steps[idx].label=label.trim();
  await persistContract(c);renderContrats();
}
async function deleteProdStep(contractId,prodId,idx){
  var c=contracts_db.find(function(x){return x._id===contractId;});if(!c)return;
  var p=(c.produits||[]).find(function(x){return x.id===prodId;});if(!p||!p.steps[idx])return;
  if(!confirm('Supprimer l\'étape "'+p.steps[idx].label+'" ?'))return;
  p.steps.splice(idx,1);
  await persistContract(c);renderContrats();updateContratsBadge();
}

async function deleteProd(contractId,prodId){
  var c=contracts_db.find(function(x){return x._id===contractId;});if(!c)return;
  var p=(c.produits||[]).find(function(x){return x.id===prodId;});if(!p)return;
  if(!confirm('Supprimer l\'investissement "'+(p.name||'sans nom')+'" ?'))return;
  c.produits=c.produits.filter(function(x){return x.id!==prodId;});
  await persistContract(c);renderContrats();updateContratsBadge();
  toast('Investissement supprimé.');
}
async function deleteContractFromCard(contractId){
  var c=contracts_db.find(function(x){return x._id===contractId;});if(!c)return;
  if(!confirm('Supprimer le contrat de '+c.client+' et tous ses investissements ?'))return;
  try{
    await deleteContractDB(contractId);
    renderContrats();updateContratsBadge();
    toast('Contrat supprimé.');
  }catch(e){console.error(e);alert('Erreur: '+(e.message||e));}
}

function updateContratsBadge(){
  var badge=document.getElementById('contratsBadge');
  if(!badge)return;
  var n=pendingProcedures();
  if(n>0){badge.textContent=n;badge.style.display='';}
  else{badge.style.display='none';}
}

// ── INLINE STEP EDITOR (used in both contract & investissement modals) ──────
function renderStepEditorRows(steps,opts){
  // steps: array of {id?, label, note?, done}
  // opts.note: true if note field is shown
  return (steps||[]).map(function(s){
    var hasNote=opts&&opts.note;
    return '<div class="step-edit-row" data-id="'+escH(s.id||newStepId())+'" style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">'+
      '<div class="chk'+(s.done?' on':'')+'" onclick="this.classList.toggle(\'on\')" style="flex-shrink:0;"></div>'+
      '<input type="text" class="step-edit-label" value="'+escH(s.label||'')+'" placeholder="Libellé de l\'étape" style="flex:1;min-width:0;font-size:12px;padding:5px 8px;"/>'+
      (hasNote?'<input type="text" class="step-edit-note" value="'+escH(s.note||'')+'" placeholder="Annotation (optionnel)" style="width:140px;font-size:11px;padding:5px 8px;"/>':'')+
      '<button type="button" class="btn btn-sm" style="padding:3px 8px;font-size:11px;color:var(--red);border-color:var(--red-bg);flex-shrink:0;" onclick="this.closest(\'.step-edit-row\').remove();">×</button>'+
    '</div>';
  }).join('');
}
function readStepEditorRows(containerEl,opts){
  var hasNote=opts&&opts.note;
  var rows=containerEl.querySelectorAll('.step-edit-row');
  var out=[];
  rows.forEach(function(row){
    var labelEl=row.querySelector('.step-edit-label');
    var label=labelEl?labelEl.value.trim():'';
    if(!label)return;
    var s={id:row.dataset.id||newStepId(),label:label,done:row.querySelector('.chk').classList.contains('on')};
    if(hasNote){var nEl=row.querySelector('.step-edit-note');var note=nEl?nEl.value.trim():'';if(note)s.note=note;}
    out.push(s);
  });
  return out;
}
function addEditorStep(containerId,opts){
  var hasNote=opts&&opts.note;
  var c=document.getElementById(containerId);
  var div=document.createElement('div');
  div.outerHTML;
  var html=
    '<div class="step-edit-row" data-id="'+newStepId()+'" style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">'+
      '<div class="chk" onclick="this.classList.toggle(\'on\')" style="flex-shrink:0;"></div>'+
      '<input type="text" class="step-edit-label" placeholder="Libellé de l\'étape" style="flex:1;min-width:0;font-size:12px;padding:5px 8px;"/>'+
      (hasNote?'<input type="text" class="step-edit-note" placeholder="Annotation (optionnel)" style="width:140px;font-size:11px;padding:5px 8px;"/>':'')+
      '<button type="button" class="btn btn-sm" style="padding:3px 8px;font-size:11px;color:var(--red);border-color:var(--red-bg);flex-shrink:0;" onclick="this.closest(\'.step-edit-row\').remove();">×</button>'+
    '</div>';
  c.insertAdjacentHTML('beforeend',html);
  var inputs=c.querySelectorAll('.step-edit-label');
  if(inputs.length)inputs[inputs.length-1].focus();
}

// ── CONTRACT MODAL ───────────────────────────────────────────────────────────
function buildTemplateSelectHTML(selected){
  var opts='<option value="">— Aucun (sur mesure) —</option>';
  templates_db.slice().sort(function(a,b){return a.name.localeCompare(b.name);}).forEach(function(t){
    opts+='<option value="'+escH(t.name)+'"'+(t.name===selected?' selected':'')+'>'+escH(t.name)+'</option>';
  });
  return opts;
}
function openContractModal(contractId,prefillClient){
  var c=contractId?contracts_db.find(function(x){return x._id===contractId;}):null;
  document.getElementById('contractModalTitle').textContent=c?'Modifier le contrat':'Nouveau contrat';
  document.getElementById('ctmId').value=c?c._id:'';
  var sel=document.getElementById('ctmClient');
  var clients=clients_db.map(function(x){return x.name;}).sort(function(a,b){return a.localeCompare(b);});
  var picked=c?c.client:(prefillClient||'');
  sel.innerHTML='<option value="">— Choisir —</option>'+clients.map(function(n){return '<option'+(n===picked?' selected':'')+'>'+n+'</option>';}).join('');
  document.getElementById('ctmNum').value=c?c.num:'';
  document.getElementById('ctmBanque').value=c?c.banque:'Indosuez Luxembourg';
  document.getElementById('ctmNotes').value=c?(c.notes||''):'';
  // Template picker
  var tplSel=document.getElementById('ctmTemplate');
  if(tplSel)tplSel.innerHTML=buildTemplateSelectHTML(c?(c.template_name||''):'');
  // Editable prelim list — preserved if editing, empty by default for new
  var prelim=c?(c.prelim||[]):[];
  document.getElementById('ctmPrelim').innerHTML=renderStepEditorRows(prelim,{note:false});
  document.getElementById('ctmDeleteBtn').style.display=c?'':'none';
  document.getElementById('contractModal').classList.add('on');
}
function closeContractModal(){document.getElementById('contractModal').classList.remove('on');}
function ctmAddStep(){addEditorStep('ctmPrelim',{note:false});}
function ctmTemplateChanged(){
  // Phase K.2 — picking any template (incl. "Aucun") loads its prelim. Empty
  // value = clear all prelim rows (= "Aucun template"). Confirm before destroying
  // existing rows.
  var name=document.getElementById('ctmTemplate').value;
  var existingRows=document.querySelectorAll('#ctmPrelim .step-edit-row').length;
  if(!name){
    // Aucun — clear preliminaries (user opted out of template)
    if(existingRows>0&&!confirm('Retirer toutes les étapes préliminaires ? (Aucun template sélectionné)'))return;
    document.getElementById('ctmPrelim').innerHTML='';
    return;
  }
  if(existingRows>0&&!confirm('Remplacer les étapes actuelles par celles du template "'+name+'" ?'))return;
  var rows=templatePrelimCopy(name);
  document.getElementById('ctmPrelim').innerHTML=renderStepEditorRows(rows,{note:false});
}
// Phase K.2 — kept as legacy noop in case any old code path still references it.
// The hardcoded "Charger défauts Wealins" button is gone — the template selector
// above does the same job for ANY template.
function ctmLoadDefaults(){
  console.warn('ctmLoadDefaults() is deprecated — use the Template selector instead.');
  var existingRows=document.querySelectorAll('#ctmPrelim .step-edit-row').length;
  if(existingRows>0&&!confirm('Remplacer les étapes actuelles par les 4 étapes Wealins par défaut ?'))return;
  document.getElementById('ctmPrelim').innerHTML=renderStepEditorRows(seedPrelimDefaults(),{note:false});
}

async function saveContractFromModal(){
  var id=document.getElementById('ctmId').value;
  var client=document.getElementById('ctmClient').value;
  var num=document.getElementById('ctmNum').value.trim();
  var banque=document.getElementById('ctmBanque').value.trim()||'Indosuez Luxembourg';
  var notes=document.getElementById('ctmNotes').value.trim();
  var tplEl=document.getElementById('ctmTemplate');
  var template_name=tplEl?(tplEl.value||null):null;
  if(!client){alert('Sélectionnez un client.');return;}
  var prelim=readStepEditorRows(document.getElementById('ctmPrelim'),{note:false});
  var existing=id?contracts_db.find(function(x){return x._id===id;}):null;
  var c={
    _id:id||null,
    client:client,
    num:num,
    banque:banque,
    notes:notes,
    template_name:template_name,
    prelim:prelim,
    produits:existing?existing.produits:[]
  };
  try{
    var saved=await saveContract(c);
    closeContractModal();
    renderContrats();
    updateContratsBadge();
    toast(id?'Contrat mis à jour.':'Contrat créé.');
    if(saved&&!id&&saved._id){ctrExp[saved._id]=true;renderContrats();}
  }catch(e){console.error(e);alert('Erreur: '+(e.message||e));}
}

async function deleteContractFromModal(){
  var id=document.getElementById('ctmId').value;
  if(!id)return;
  if(!confirm('Supprimer ce contrat ?'))return;
  try{
    await deleteContractDB(id);
    closeContractModal();
    renderContrats();
    updateContratsBadge();
    toast('Contrat supprimé.');
  }catch(e){console.error(e);alert('Erreur: '+(e.message||e));}
}

// ── TEMPLATE MODAL (multi-pack) ─────────────────────────────────────────────
function renderPackEditorRows(packs){
  // Renders one collapsible block per pack
  return packs.map(function(p,idx){
    var packId=p.id||newStepId();
    return '<div class="tpl-pack" data-pack-id="'+escH(packId)+'" style="border:1px solid var(--border);border-radius:var(--rs);padding:10px 12px;margin-bottom:10px;background:var(--surface2);">'+
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'+
        '<input type="text" class="tpl-pack-name" placeholder="Nom du pack (ex: Produit Structuré)" value="'+escH(p.name||'')+'" style="flex:1;font-size:13px;font-weight:500;padding:5px 8px;"/>'+
        '<button type="button" class="btn btn-sm" onclick="tplPackAddStep(this)" style="font-size:11px;">+ Étape</button>'+
        '<button type="button" class="btn btn-sm" style="font-size:11px;color:var(--red);border-color:var(--red-bg);" onclick="if(confirm(\'Supprimer ce pack ?\'))this.closest(\'.tpl-pack\').remove();">Supprimer pack</button>'+
      '</div>'+
      '<div class="tpl-pack-steps">'+renderStepEditorRows((p.steps||[]).map(function(s){var o={id:s.id,label:s.label,done:false};if(s.note)o.note=s.note;return o;}),{note:true})+'</div>'+
    '</div>';
  }).join('');
}
function readPackEditorRows(containerEl){
  var packBlocks=containerEl.querySelectorAll('.tpl-pack');
  var out=[];
  packBlocks.forEach(function(blk){
    var nameEl=blk.querySelector('.tpl-pack-name');
    var name=nameEl?nameEl.value.trim():'';
    if(!name)return; // skip unnamed packs
    var stepsEl=blk.querySelector('.tpl-pack-steps');
    var steps=stepsEl?readStepEditorRows(stepsEl,{note:true}).map(function(s){var o={id:s.id,label:s.label};if(s.note)o.note=s.note;return o;}):[];
    out.push({id:blk.dataset.packId||newStepId(),name:name,steps:steps});
  });
  return out;
}
function tplPackAddStep(btn){
  var stepsEl=btn.closest('.tpl-pack').querySelector('.tpl-pack-steps');
  if(!stepsEl)return;
  // append a new empty row inline
  var html=
    '<div class="step-edit-row" data-id="'+newStepId()+'" style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">'+
      '<div class="chk" onclick="this.classList.toggle(\'on\')" style="flex-shrink:0;"></div>'+
      '<input type="text" class="step-edit-label" placeholder="Libellé de l\'étape" style="flex:1;min-width:0;font-size:12px;padding:5px 8px;"/>'+
      '<input type="text" class="step-edit-note" placeholder="Annotation (optionnel)" style="width:140px;font-size:11px;padding:5px 8px;"/>'+
      '<button type="button" class="btn btn-sm" style="padding:3px 8px;font-size:11px;color:var(--red);border-color:var(--red-bg);flex-shrink:0;" onclick="this.closest(\'.step-edit-row\').remove();">×</button>'+
    '</div>';
  stepsEl.insertAdjacentHTML('beforeend',html);
  var inputs=stepsEl.querySelectorAll('.step-edit-label');
  if(inputs.length)inputs[inputs.length-1].focus();
}
function tplAddPack(){
  var c=document.getElementById('tplPacks');
  c.insertAdjacentHTML('beforeend',renderPackEditorRows([{id:newStepId(),name:'',steps:[]}]));
  var newPackName=c.querySelectorAll('.tpl-pack-name');
  if(newPackName.length)newPackName[newPackName.length-1].focus();
}

function openTemplateModal(templateId){
  var t=templateId?templates_db.find(function(x){return x._id===templateId;}):null;
  document.getElementById('tplModalTitle').textContent=t?'Modifier le template':'Nouveau template de contrat';
  document.getElementById('tplId').value=t?t._id:'';
  document.getElementById('tplName').value=t?t.name:'';
  document.getElementById('tplPrelim').innerHTML=renderStepEditorRows((t?t.prelim:[]).map(function(s){return{id:s.id,label:s.label,done:false};}),{note:false});
  document.getElementById('tplPacks').innerHTML=renderPackEditorRows(t?t.step_packs:[]);
  document.getElementById('tplDeleteBtn').style.display=t?'':'none';
  document.getElementById('templateModal').classList.add('on');
  setTimeout(function(){document.getElementById('tplName').focus();},50);
}
function closeTemplateModal(){document.getElementById('templateModal').classList.remove('on');}
function tplAddPrelim(){addEditorStep('tplPrelim',{note:false});}
async function saveTemplateFromModal(){
  var id=document.getElementById('tplId').value;
  var name=document.getElementById('tplName').value.trim();
  if(!name){alert('Nom du template requis.');return;}
  if(!id&&templates_db.some(function(t){return t.name.toLowerCase()===name.toLowerCase();})){alert('Un template "'+name+'" existe déjà.');return;}
  var prelimRows=readStepEditorRows(document.getElementById('tplPrelim'),{note:false});
  var prelim=prelimRows.map(function(s){return{id:s.id,label:s.label};});
  var step_packs=readPackEditorRows(document.getElementById('tplPacks'));
  try{
    await saveTemplate({_id:id||null,name:name,prelim:prelim,step_packs:step_packs});
    closeTemplateModal();
    renderContrats();
    toast(id?'Template mis à jour.':'Template créé.');
  }catch(e){console.error(e);alert('Erreur: '+(e.message||e));}
}
async function deleteTemplateFromModal(){
  var id=document.getElementById('tplId').value;if(!id)return;
  if(!confirm('Supprimer ce template ? Les contrats existants ne sont pas affectés.'))return;
  try{
    await deleteTemplate(id);
    closeTemplateModal();renderContrats();
    toast('Template supprimé.');
  }catch(e){console.error(e);alert('Erreur: '+(e.message||e));}
}
async function confirmDeleteTemplate(id){
  var t=templates_db.find(function(x){return x._id===id;});if(!t)return;
  if(!confirm('Supprimer le template "'+t.name+'" ? Les contrats existants ne sont pas affectés.'))return;
  try{await deleteTemplate(id);renderContrats();toast('Template supprimé.');}
  catch(e){console.error(e);alert('Erreur: '+(e.message||e));}
}

// ── INVESTMENT (PRODUIT) MODAL ───────────────────────────────────────────────
var _prodEditCtxId=null,_prodEditCtxProdId=null;
function openProdModal(contractId,prodId){
  var c=contracts_db.find(function(x){return x._id===contractId;});
  if(!c){alert('Contrat introuvable.');return;}
  _prodEditCtxId=contractId;_prodEditCtxProdId=prodId||null;
  var p=prodId?(c.produits||[]).find(function(x){return x.id===prodId;}):null;
  document.getElementById('prodModalTitle').textContent=p?"Modifier l'investissement":'Ajouter un investissement';
  document.getElementById('prodPName').value=p?p.name:'';
  document.getElementById('prodPISIN').value=p?p.isin:'';
  document.getElementById('prodPType').value=p?p.type:'structuré';
  document.getElementById('prodPMontant').value=p?p.montant:'';
  document.getElementById('prodPNotes').value=p?(p.notes||''):'';
  document.getElementById('prodPClientLbl').textContent=c.client;
  // Build pack picker from contract's template
  var packSel=document.getElementById('prodPPack');
  var tpl=c.template_name?templateByName(c.template_name):null;
  var packs=tpl?(tpl.step_packs||[]):[];
  var packOpts='<option value="">— Vide / sur mesure —</option>';
  packs.forEach(function(pk){
    var sel=p&&p.pack_name===pk.name?' selected':'';
    packOpts+='<option value="'+escH(pk.id)+'"'+sel+'>'+escH(pk.name)+' ('+(pk.steps||[]).length+' étape'+((pk.steps||[]).length>1?'s':'')+')</option>';
  });
  if(packSel)packSel.innerHTML=packOpts;
  // Steps: edit → existing; create → seed from first pack of contract's template if any
  var steps;
  if(p)steps=p.steps||[];
  else if(packs.length)steps=templatePackCopy(c.template_name,packs[0].id);
  else steps=[];
  document.getElementById('prodPSteps').innerHTML=renderStepEditorRows(steps,{note:true});
  // Hint label
  var hint=document.getElementById('prodTplHint');
  if(hint){
    if(!p&&packs.length)hint.textContent='Étapes pré-remplies depuis le pack "'+packs[0].name+'" du template "'+c.template_name+'". Changez de pack ou modifiez librement.';
    else if(!p&&c.template_name)hint.textContent='Le template "'+c.template_name+'" n\'a pas de pack défini — ajoutez vos étapes manuellement.';
    else if(!p)hint.textContent='Aucun template appliqué au contrat — ajoutez vos étapes manuellement.';
    else hint.textContent='';
  }
  document.getElementById('prodDeleteBtn').style.display=p?'':'none';
  document.getElementById('prodModal').classList.add('on');
  setTimeout(function(){document.getElementById('prodPName').focus();},50);
}
function prodPackChanged(){
  if(!_prodEditCtxId)return;
  var c=contracts_db.find(function(x){return x._id===_prodEditCtxId;});if(!c)return;
  var packId=document.getElementById('prodPPack').value;
  var existingRows=document.querySelectorAll('#prodPSteps .step-edit-row').length;
  if(!packId){
    // "Vide / sur mesure"
    if(existingRows>0&&!confirm('Effacer les étapes actuelles ?')){
      // Revert select
      var packSel=document.getElementById('prodPPack');
      // No straightforward revert — leave as is
      return;
    }
    document.getElementById('prodPSteps').innerHTML='';
    return;
  }
  if(existingRows>0&&!confirm('Remplacer les étapes actuelles par celles du pack sélectionné ?'))return;
  var steps=templatePackCopy(c.template_name,packId);
  document.getElementById('prodPSteps').innerHTML=renderStepEditorRows(steps,{note:true});
}
function closeProdModal(){document.getElementById('prodModal').classList.remove('on');_prodEditCtxId=null;_prodEditCtxProdId=null;}
function prodAddStep(){addEditorStep('prodPSteps',{note:true});}
function prodLoadDefaults(){
  // Replace (idempotent) with the Wealins-built-in defaults for the selected type
  var type=document.getElementById('prodPType').value;
  var defs=seedStepsForType(type);
  if(!defs.length){alert('Aucune étape par défaut pour ce type.');return;}
  var existingRows=document.querySelectorAll('#prodPSteps .step-edit-row').length;
  if(existingRows>0&&!confirm('Remplacer les étapes actuelles par les '+defs.length+' étapes par défaut du type "'+(WTYPE_LBL[type]||type)+'" ?'))return;
  document.getElementById('prodPSteps').innerHTML=renderStepEditorRows(defs,{note:true});
}

async function saveProdFromModal(){
  if(!_prodEditCtxId)return;
  var c=contracts_db.find(function(x){return x._id===_prodEditCtxId;});if(!c){alert('Contrat introuvable.');return;}
  var name=document.getElementById('prodPName').value.trim();
  var isin=document.getElementById('prodPISIN').value.trim();
  var type=document.getElementById('prodPType').value;
  var montant=document.getElementById('prodPMontant').value.trim();
  var notes=document.getElementById('prodPNotes').value.trim();
  if(!name){alert('Nom du produit requis.');return;}
  var steps=readStepEditorRows(document.getElementById('prodPSteps'),{note:true});
  // Capture the pack name (just the label of the picked pack, not its id, for portability)
  var packId=document.getElementById('prodPPack')?document.getElementById('prodPPack').value:'';
  var packName='';
  if(packId&&c.template_name){
    var tpl=templateByName(c.template_name);
    if(tpl){var pk=(tpl.step_packs||[]).find(function(p){return p.id===packId;});if(pk)packName=pk.name;}
  }
  c.produits=c.produits||[];
  if(_prodEditCtxProdId){
    var p=c.produits.find(function(x){return x.id===_prodEditCtxProdId;});
    if(!p)return;
    p.name=name;p.isin=isin;p.type=type;p.montant=montant;p.notes=notes;p.steps=steps;p.pack_name=packName;
  } else {
    var newP={id:newStepId(),name:name,isin:isin,type:type,pack_name:packName,montant:montant,notes:notes,steps:steps};
    c.produits.push(newP);
    prodExp[c._id+'|'+newP.id]=true;
    ctrExp[c._id]=true;
  }
  try{
    await saveContract(c);
    closeProdModal();
    renderContrats();updateContratsBadge();
    toast(_prodEditCtxProdId?'Investissement mis à jour.':'Investissement ajouté.');
  }catch(e){console.error(e);alert('Erreur: '+(e.message||e));}
}
async function deleteProdFromModal(){
  if(!_prodEditCtxId||!_prodEditCtxProdId)return;
  if(!confirm('Supprimer cet investissement ?'))return;
  var c=contracts_db.find(function(x){return x._id===_prodEditCtxId;});if(!c)return;
  c.produits=(c.produits||[]).filter(function(x){return x.id!==_prodEditCtxProdId;});
  try{
    await saveContract(c);
    closeProdModal();renderContrats();updateContratsBadge();
    toast('Investissement supprimé.');
  }catch(e){console.error(e);alert('Erreur: '+(e.message||e));}
}

function withTimeout(promise,ms,label){
  return Promise.race([
    promise,
    new Promise(function(_,reject){setTimeout(function(){reject(new Error('Timeout '+(label||'')+' après '+(ms/1000)+'s'));},ms);})
  ]);
}
function _showStuckLoadingHelp(){
  // Show a "Reset session" button on the loading overlay after 10s
  var ov=document.getElementById('loadingOverlay');if(!ov)return;
  if(ov.querySelector('.stuckHelp'))return;
  var div=document.createElement('div');
  div.className='stuckHelp';
  div.style.cssText='margin-top:20px;text-align:center;font-size:12px;color:var(--text2);max-width:380px;';
  div.innerHTML='Le chargement est anormalement long.<br>Cela arrive après un redémarrage Supabase (token périmé).<br><br>'+
    '<button class="btn btn-primary" style="font-size:12px;" onclick="localStorage.clear();location.reload();">Réinitialiser la session</button>';
  ov.appendChild(div);
}

async function initApp(){
  document.getElementById('loadingOverlay').style.display='flex';
  var stuckTimer=setTimeout(_showStuckLoadingHelp,10000);
  // Tab-order hygiene: the × close button is in modal-hd, which is the first
  // interactive element of every modal. Without this, Tab into a modal lands
  // on close before the first input. Set tabindex=-1 on all close buttons so
  // keyboard navigation starts at the first real field. Click still works.
  document.querySelectorAll('.close-btn').forEach(function(b){b.tabIndex=-1;});
  try{
    var results=await withTimeout(Promise.all([
      sbGetAll('deals'),
      sbGetAll('clients'),
      sbGetAll('fournisseurs'),
      sbGetAll('brokers'),
      sb.from('rapprochement').select('*'),
      sb.from('contracts').select('*'),
      sb.from('contract_templates').select('*').order('name'),
      sb.from('team_members').select('*').order('name')
    ]),20000,'chargement initial');
    deals=results[0]||[];
    clients_db=results[1]||[];
    fourn_db=results[2]||[];
    brokers_db=results[3]||[];
    // Phase 1A backfill: ensure every fournisseur has a products[] (in-memory only;
    // DB-side default comes from the jsonb DEFAULT in migration 05).
    fourn_db.forEach(function(f){if(!Array.isArray(f.products))f.products=[];});
    // Phase D.1 + H.2 + I.3 backfill — enrich codifs with their own ct/ufR/runR,
    // compute ufE/runE in EUR using the deal's snapshot FX (for non-EUR deals),
    // propagate aggregates to deal-level fields for legacy renderers, and stash
    // the native amounts (ufE_native, runE_native) for per-event FX conversion
    // at billing time. In-memory only; persists on next save.
    deals.forEach(function(d){
      if(Array.isArray(d.codifications)&&d.codifications.length){
        enrichDealCodifications(d.codifications, d);
        _recomputeDealAggregates(d);
      }
    });
    if(results[4].error){console.error('Rapprochement fetch failed',results[4].error);toast('Erreur chargement rapprochement — facturation peut être incomplète.');rapprochement_db=[];}
    else rapprochement_db=((results[4].data)||[]).map(rapprRowToObj);
    if(results[5].error){
      var msg=String(results[5].error.message||'').toLowerCase();
      if(msg.indexOf('does not exist')!==-1||msg.indexOf('relation')!==-1){
        console.warn('Contracts table missing — run the SQL in Supabase to enable it.');
      } else {
        console.error('Contracts fetch failed',results[5].error);
      }
      contracts_db=[];
    } else {
      contracts_db=((results[5].data)||[]).map(rowToContract);
    }
    if(results[7]&&results[7].error){
      var mmsg=String(results[7].error.message||'').toLowerCase();
      if(mmsg.indexOf('does not exist')!==-1||mmsg.indexOf('relation')!==-1){
        console.warn('team_members table missing — run the team_members SQL.');
      } else console.error('Team members fetch failed',results[7].error);
      team_members_db=[];
    } else if(results[7]){
      team_members_db=((results[7].data)||[]).map(rowToMember);
      await ensureCurrentUserMember();
    }
    if(results[6].error){
      var tmsg=String(results[6].error.message||'').toLowerCase();
      if(tmsg.indexOf('does not exist')!==-1||tmsg.indexOf('relation')!==-1){
        console.warn('contract_templates table missing — run the templates SQL.');
      } else console.error('Templates fetch failed',results[6].error);
      templates_db=[];
    } else {
      templates_db=((results[6].data)||[]).map(rowToTemplate);
      await seedDefaultTemplates();
    }
    if(!fourn_db.length)await seedFournisseurs();
    else await mergeFournDefaults();
    if(!brokers_db.length)await seedBrokers();
    // Ensure all entities referenced in deals exist in their reference tables
    await mergeClientsFromDeals();
    await mergeFournsFromDeals();
    await mergeBrokersFromDeals();
  }catch(e){
    clearTimeout(stuckTimer);
    console.error('Init error',e);
    var msg=String(e.message||e);
    var stuck=msg.indexOf('Timeout')!==-1||msg.toLowerCase().indexOf('jwt')!==-1||msg.toLowerCase().indexOf('expired')!==-1;
    if(stuck){
      // Force a clean reset on session-related issues
      if(confirm('Connexion impossible — token de session probablement périmé.\n\nRéinitialiser la session et se reconnecter ?')){
        localStorage.clear();location.reload();return;
      }
    }
    document.getElementById('loadingOverlay').style.display='none';
    alert('Erreur de chargement : '+msg+'\n\nVérifiez votre connexion ou rechargez la page.');
    return;
  }
  clearTimeout(stuckTimer);
  await migrateDealStatuses();
  document.getElementById('loadingOverlay').style.display='none';
  renderAll();rebuildFournSelect();rebuildBrokerSelect();
  // Clear any browser-autofilled values in search fields
  setTimeout(function(){['srch','gSearch','ctSearch'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});},100);
  setupRealtime();
  startCodeWatcher();
  injectForceReloadLink();
}
async function migrateDealStatuses(){
  // Backfill: any deal with fSt='Payé' but stat!='Deal payé' is migrated.
  // Idempotent — safe to run on every boot.
  var migrated=0;
  for(var i=0;i<deals.length;i++){
    var d=deals[i];
    if(d.fSt==='Payé'&&d.stat!=='Deal payé'){
      d.stat='Deal payé';
      d.hist=Array.isArray(d.hist)?d.hist:[];
      d.hist.push({ts:nowS(),a:'Migration : stat aligné sur "Deal payé" (facture déjà payée)',by:'Système'});
      if(d._id){try{var{_id,...upd}=d;await sbUpdate('deals',_id,upd);}catch(e){console.error('Migration update failed for',_id,e);}}
      migrated++;
    }
  }
  if(migrated>0)console.log('migrateDealStatuses: '+migrated+' deal(s) re-classés en Deal payé');
}

// Auth state listener — handle session expiry mid-use
sb.auth.onAuthStateChange(function(event,session){
  if(event==='SIGNED_OUT'||(event==='TOKEN_REFRESHED'&&!session)){
    deals=[];clients_db=[];fourn_db=[];brokers_db=[];rapprochement_db=[];contracts_db=[];
    document.getElementById('loginOverlay').style.display='flex';
  }
});

// ── REALTIME (DB sync across collaborators) ─────────────────────────────────
var _realtimeChannel=null,_realtimeSetup=false;
function rerenderForTable(table){
  // Always update KPIs/badges since they depend on all tables.
  try{renderAll();}catch(e){}
  if(table==='deals'){
    if(document.getElementById('p-deals')&&document.getElementById('p-deals').classList.contains('on'))renderDeals();
    rebuildFournSelect();
  } else if(table==='contracts'){
    if(document.getElementById('p-contrats')&&document.getElementById('p-contrats').classList.contains('on'))renderContrats();
    updateContratsBadge();
  } else if(table==='clients'){
    if(document.getElementById('p-clients')&&document.getElementById('p-clients').classList.contains('on'))renderClients();
  } else if(table==='fournisseurs'){
    if(document.getElementById('p-fournisseurs')&&document.getElementById('p-fournisseurs').classList.contains('on'))renderFourn();
    rebuildFournSelect();
  } else if(table==='brokers'){
    if(document.getElementById('p-brokers')&&document.getElementById('p-brokers').classList.contains('on'))renderBrokers();
    rebuildBrokerSelect();
  }
  setLiveStatus('live');
}

function setupRealtime(){
  if(_realtimeSetup)return;_realtimeSetup=true;
  _realtimeChannel=sb.channel('app-realtime')
    .on('postgres_changes',{event:'*',schema:'public',table:'deals'},function(p){
      try{
        if(p.eventType==='DELETE'){deals=deals.filter(function(x){return x._id!==p.old.id;});}
        else{
          var d=rowToDeal(p.new);
          var idx=deals.findIndex(function(x){return x._id===d._id;});
          if(idx>=0)deals[idx]=d;else deals.push(d);
        }
        rerenderForTable('deals');
      }catch(e){console.error('Realtime deals error',e);}
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'clients'},function(p){
      try{
        if(p.eventType==='DELETE'){clients_db=clients_db.filter(function(x){return x._id!==p.old.id;});}
        else{
          var c=rowToRef(p.new);
          var idx=clients_db.findIndex(function(x){return x._id===c._id;});
          if(idx>=0)clients_db[idx]=c;else clients_db.push(c);
        }
        rerenderForTable('clients');
      }catch(e){console.error('Realtime clients error',e);}
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'fournisseurs'},function(p){
      try{
        if(p.eventType==='DELETE'){fourn_db=fourn_db.filter(function(x){return x._id!==p.old.id;});}
        else{
          var f=rowToRef(p.new);
          var idx=fourn_db.findIndex(function(x){return x._id===f._id;});
          if(idx>=0)fourn_db[idx]=f;else fourn_db.push(f);
        }
        rerenderForTable('fournisseurs');
      }catch(e){console.error('Realtime fournisseurs error',e);}
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'brokers'},function(p){
      try{
        if(p.eventType==='DELETE'){brokers_db=brokers_db.filter(function(x){return x._id!==p.old.id;});}
        else{
          var b=rowToRef(p.new);
          var idx=brokers_db.findIndex(function(x){return x._id===b._id;});
          if(idx>=0)brokers_db[idx]=b;else brokers_db.push(b);
        }
        rerenderForTable('brokers');
      }catch(e){console.error('Realtime brokers error',e);}
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'rapprochement'},function(p){
      try{
        if(p.eventType==='DELETE'){rapprochement_db=rapprochement_db.filter(function(r){return r.id!==p.old.id;});}
        else{
          var r=rapprRowToObj(p.new);
          var idx=rapprochement_db.findIndex(function(x){return x.id===r.id;});
          if(idx>=0)rapprochement_db[idx]=r;else rapprochement_db.push(r);
        }
        rerenderForTable('rapprochement');
      }catch(e){console.error('Realtime rapprochement error',e);}
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'contracts'},function(p){
      try{
        if(p.eventType==='DELETE'){contracts_db=contracts_db.filter(function(c){return c._id!==p.old.id;});}
        else{
          var c=rowToContract(p.new);
          var idx=contracts_db.findIndex(function(x){return x._id===c._id;});
          if(idx>=0)contracts_db[idx]=c;else contracts_db.push(c);
        }
        rerenderForTable('contracts');
      }catch(e){console.error('Realtime contracts error',e);}
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'contract_templates'},function(p){
      try{
        if(p.eventType==='DELETE'){templates_db=templates_db.filter(function(t){return t._id!==p.old.id;});}
        else{
          var t=rowToTemplate(p.new);
          var idx=templates_db.findIndex(function(x){return x._id===t._id;});
          if(idx>=0)templates_db[idx]=t;else templates_db.push(t);
        }
        if(document.getElementById('p-contrats')&&document.getElementById('p-contrats').classList.contains('on'))renderContrats();
        setLiveStatus('live');
      }catch(e){console.error('Realtime templates error',e);}
    })
    .on('postgres_changes',{event:'*',schema:'public',table:'team_members'},function(p){
      try{
        if(p.eventType==='DELETE'){team_members_db=team_members_db.filter(function(m){return m._id!==p.old.id;});}
        else{
          var m=rowToMember(p.new);
          var idx=team_members_db.findIndex(function(x){return x._id===m._id;});
          if(idx>=0)team_members_db[idx]=m;else team_members_db.push(m);
          // If this row is for the current user, refresh their cached role
          if(m.email===currentUserEmail)currentUserRole=m.role||'admin';
        }
        if(document.getElementById('p-membres')&&document.getElementById('p-membres').classList.contains('on'))renderMembres();
        setLiveStatus('live');
      }catch(e){console.error('Realtime team_members error',e);}
    })
    .subscribe(function(status){
      if(status==='SUBSCRIBED')setLiveStatus('live');
      else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')setLiveStatus('offline');
    });
}

function setLiveStatus(state){
  var el=document.getElementById('liveStatus');if(!el)return;
  if(state==='live'){el.textContent='● Live';el.style.color='var(--green)';el.title='Synchronisation temps réel active';}
  else if(state==='offline'){el.textContent='● Hors ligne';el.style.color='var(--red)';el.title='Connexion temps réel perdue — rechargez si nécessaire';}
  else{el.textContent='● Connexion…';el.style.color='var(--text3)';}
}

// Show a "Forcer le rechargement" link in the topbar so users can manually
// pull the latest code without waiting for the 30s watcher poll. Useful when
// two collaborators see different versions due to CDN/cache lag.
function injectForceReloadLink(){
  if(document.getElementById('forceReloadLink'))return;
  var topbar=document.querySelector('.topbar-r');if(!topbar)return;
  var a=document.createElement('button');
  a.id='forceReloadLink';
  a.title='Recharger l\'app et purger le cache pour aligner avec les autres utilisateurs';
  a.style.cssText='background:none;border:none;color:var(--text3);font-size:11px;cursor:pointer;padding:4px 8px;border-radius:4px;font-family:inherit;';
  a.textContent='⟳ Sync';
  a.onmouseover=function(){a.style.background='var(--surface2)';a.style.color='var(--text)';};
  a.onmouseout=function(){a.style.background='';a.style.color='var(--text3)';};
  a.onclick=function(){
    // Hard reload: force re-fetch of all assets, bypass cache
    if('caches' in window){caches.keys().then(function(keys){keys.forEach(function(k){caches.delete(k);});});}
    location.reload(true);
  };
  topbar.insertBefore(a,topbar.firstChild);
}

// ── CODE-UPDATE WATCHER (auto-banner when teammate pushes new code) ─────────
var _initialCodeHash=null,_updateBannerShown=false;
function _hashStr(s){var h=0;for(var i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;}return h.toString(36);}
async function _fetchAppHash(){
  // Hash app.js + index.html signatures together. Cache-busted so CDN serves fresh.
  try{
    var [a,b]=await Promise.all([
      fetch('app.js?cb='+Date.now(),{cache:'no-store'}).then(function(r){return r.text();}),
      fetch('index.html?cb='+Date.now(),{cache:'no-store'}).then(function(r){return r.text();})
    ]);
    return _hashStr(a)+'|'+_hashStr(b);
  }catch(e){return null;}
}
var _autoReloadPending=false;
async function checkCodeUpdate(){
  if(_autoReloadPending)return;
  var h=await _fetchAppHash();
  if(!h)return;
  if(_initialCodeHash===null){_initialCodeHash=h;return;}
  if(h!==_initialCodeHash){_autoReloadPending=true;tryAutoReload();}
}
function _isUserBusy(){
  // Modal currently open?
  if(document.querySelector('.ov.on'))return true;
  // User actively typing in an input that has unsaved content?
  var ae=document.activeElement;
  if(ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA')&&ae.value)return true;
  return false;
}
function tryAutoReload(){
  if(!_autoReloadPending)return;
  if(_isUserBusy()){
    // Show a discreet "pending" indicator so user knows reload is queued
    showPendingReloadToast();
    setTimeout(tryAutoReload,3000);
    return;
  }
  // Brief flash so the reload isn't jarring
  showReloadingToast();
  setTimeout(function(){location.reload(true);},700);
}
function showPendingReloadToast(){
  if(document.getElementById('reloadPending'))return;
  var div=document.createElement('div');
  div.id='reloadPending';
  div.style.cssText='position:fixed;bottom:24px;right:24px;background:var(--amber);color:#fff;padding:8px 14px;border-radius:6px;font-size:12px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.2);';
  div.textContent='🔄 Mise à jour en attente — fermez le modal pour rafraîchir';
  document.body.appendChild(div);
}
function showReloadingToast(){
  var p=document.getElementById('reloadPending');if(p)p.remove();
  var div=document.createElement('div');
  div.style.cssText='position:fixed;bottom:24px;right:24px;background:var(--blue);color:#fff;padding:8px 14px;border-radius:6px;font-size:12px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.2);';
  div.textContent='🔄 Mise à jour…';
  document.body.appendChild(div);
}
// Poll every 30s. Cache-busted fetch so GitHub Pages CDN serves fresh content.
function startCodeWatcher(){checkCodeUpdate();setInterval(checkCodeUpdate,30000);}

checkAuth();
