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
  delete d.uf_r; delete d.run_r; delete d.uf_e; delete d.run_e;
  delete d.inv_s; delete d.f_st; delete d.f_ref;
  delete d.arb_id; delete d.arb_src; delete d.arb_closed; delete d.end_date;
  return d;
}
function rowToRef(r){var d=Object.assign({},r);d._id=d.id;delete d.id;delete d.created_at;delete d.updated_at;return d;}

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

async function sbInsert(table,data){
  var row=table==='deals'?dealToRow(data):Object.assign({},data);
  delete row.id; delete row._id;
  var res=await sb.from(table).insert(row).select();
  if(res.error&&table==='deals'){
    var miss=_detectMissingDealCol(res.error);
    if(miss){_warnAboutMissingCol(miss);
      // Retry with stripped row
      var row2=dealToRow(data);
      delete row2.id; delete row2._id;
      res=await sb.from(table).insert(row2).select();
    }
  }
  if(res.error)throw res.error;
  return (res.data||[]).map(function(r){return{id:r.id,data:table==='deals'?rowToDeal(r):rowToRef(r)};});
}
async function sbUpdate(table,id,data){
  var row=table==='deals'?dealToRow(data):Object.assign({},data);
  delete row.id; delete row._id; delete row.created_at;
  var res=await sb.from(table).update(row).eq('id',id).select();
  if(res.error&&table==='deals'){
    var miss=_detectMissingDealCol(res.error);
    if(miss){_warnAboutMissingCol(miss);
      var row2=dealToRow(data);
      delete row2.id; delete row2._id; delete row2.created_at;
      res=await sb.from(table).update(row2).eq('id',id).select();
    }
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

// On deal creation: find the client's existing contract (or auto-create one) and append an investissement
async function autoLinkDealToContract(deal){
  if(!deal||!deal.client)return;
  var clientName=deal.client;
  var contract=contracts_db.find(function(c){return c.client===clientName;});
  if(!contract){
    // Auto-create a minimal contract using the first available template (Wealins by default)
    var defaultTemplate=templates_db[0];
    var newC={
      _id:null,
      client:clientName,
      num:'',
      banque:deal.depositaire||'Indosuez Luxembourg',
      notes:'',
      template_name:defaultTemplate?defaultTemplate.name:null,
      prelim:defaultTemplate?templatePrelimCopy(defaultTemplate.name):[],
      produits:[]
    };
    contract=await saveContract(newC);
    if(!contract)return;
  }
  // Build investissement
  var montantStr=deal.nom?(new Intl.NumberFormat('fr-FR').format(deal.nom)+' '+(deal.dev||'EUR')):'';
  var notesParts=[];
  if(deal.depositaire)notesParts.push('Dépositaire: '+deal.depositaire);
  if(deal.fourn)notesParts.push('Fournisseur: '+deal.fourn);
  if(deal.contrat)notesParts.push('Contrat: '+deal.contrat);
  // Pick the best-matching pack from the contract's template
  var pickedPack=null,steps=[];
  if(contract.template_name){
    pickedPack=templatePackForType(contract.template_name,deal.produit_type);
    if(pickedPack)steps=templatePackCopy(contract.template_name,pickedPack.id);
  }
  var prod={
    id:newStepId(),
    name:deal.produit||'(produit non nommé)',
    isin:deal.isin||'',
    type:dealTypeToProdType(deal.produit_type),
    pack_name:pickedPack?pickedPack.name:'',
    montant:montantStr,
    notes:notesParts.join(' · '),
    steps:steps,
    deal_id:deal._id||null
  };
  // Skip if already linked (defensive — re-running the same deal save)
  if(deal._id&&(contract.produits||[]).some(function(p){return p.deal_id===deal._id;}))return;
  contract.produits=contract.produits||[];
  contract.produits.push(prod);
  await saveContract(contract);
  // Expand the contract card so user sees the new investissement when they go to the page
  ctrExp[contract._id]=true;
  prodExp[contract._id+'|'+prod.id]=true;
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
var TEAM_PASSWORD='Chamfeuil2026';
var ALLOWED_DOMAIN='@chamfeuilcapital.com';
async function doLogin(){
  var email=document.getElementById('loginEmail').value.trim().toLowerCase();
  var pw=document.getElementById('loginPw').value;
  var btn=document.getElementById('loginBtn');
  var err=document.getElementById('loginErr');
  btn.disabled=true;btn.textContent='Connexion…';err.textContent='';
  if(!email.endsWith(ALLOWED_DOMAIN)){err.textContent='Email '+ALLOWED_DOMAIN+' requis.';btn.disabled=false;btn.textContent='Se connecter';return;}
  if(pw!==TEAM_PASSWORD){err.textContent='Mot de passe incorrect.';btn.disabled=false;btn.textContent='Se connecter';return;}
  // Try sign-in; on "Invalid credentials", auto-register and retry
  var res=await sb.auth.signInWithPassword({email:email,password:pw});
  if(res.error){
    var msg=(res.error.message||'').toLowerCase();
    if(msg.indexOf('invalid')!==-1||msg.indexOf('not found')!==-1||msg.indexOf('user')!==-1){
      // First-time login: register then sign in
      btn.textContent='Création du compte…';
      var su=await sb.auth.signUp({email:email,password:pw});
      if(su.error){err.textContent=su.error.message;btn.disabled=false;btn.textContent='Se connecter';return;}
      // Try sign-in again (works if email confirmation is disabled in Supabase)
      var res2=await sb.auth.signInWithPassword({email:email,password:pw});
      if(res2.error){err.textContent='Compte créé mais connexion impossible. Vérifiez que la confirmation email est désactivée dans Supabase Auth → Providers → Email.';btn.disabled=false;btn.textContent='Se connecter';return;}
      document.getElementById('loginOverlay').style.display='none';initApp();return;
    }
    err.textContent=res.error.message||'Email ou mot de passe incorrect.';btn.disabled=false;btn.textContent='Se connecter';
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
function filt(){return curV==='Tous'?deals:deals.filter(function(d){return d.v===curV;});}
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
  // Refresh all client selects and select the new client in the last line
  var sels2=document.querySelectorAll('.mClientSel');
  sels2.forEach(function(sel){var cur=sel.value;sel.innerHTML=clientSelectHTML(cur);});
  if(sels2.length>0)sels2[sels2.length-1].value=name;
cancelAddClient();}

function goTo(id,btn){
  ['synthese','alertes','deals','facturation','graphiques','clients','fournisseurs','brokers','contrats','commissions','membres'].forEach(p=>document.getElementById('p-'+p)&&document.getElementById('p-'+p).classList.toggle('on',p===id));
  document.querySelectorAll('.nbtn').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  document.getElementById('pageTitle').textContent={synthese:'Synthèse',alertes:'Alertes & vérifications',deals:'Tous les deals',facturation:'Facturation',graphiques:'Pilotage',clients:'Clients',fournisseurs:'Fournisseurs',brokers:'Brokers',contrats:'Suivi Contrats',commissions:'Commissions',membres:'Équipe & accès'}[id]||'';
  if(id==='synthese')setTimeout(function(){renderCAChart();},200);
  else if(id==='alertes')renderAlertesPage();
  else if(id==='graphiques')setTimeout(renderCharts,80);
    else if(id==='facturation'){setTimeout(()=>{renderFact();renderUFRappr();renderUFInvTable();},50);}
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
  renderKpis();renderRecent();updateAlertBadge();updateContratsBadge();
  if(document.getElementById('p-facturation')&&document.getElementById('p-facturation').classList.contains('on'))renderFact();
  if(document.getElementById('p-alertes')&&document.getElementById('p-alertes').classList.contains('on'))renderAlertesPage();
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

    for(var di=0;di<deals.length;di++){
      var d=deals[di];
      if(d.fSt!=='Pay\xe9') continue;
      var inv=d.inv||'';
      if(inv.substring(0,7)!==mStr) continue;
      if(d.ct==='UF'||d.ct==='BOTH') tUF+=(d.ufE||0);
      if(d.ct==='RUN'||d.ct==='BOTH'){
        if(!d.invS) continue;
        var t=Math.ceil(parseInt(d.invS.substring(5,7))/3);
        var rKey='T'+t+'_'+yr;
        if(seen[rKey]) continue; seen[rKey]=1;
        var rv=rapprFind(d.fourn,'run',rKey);
        if(rv&&rv.paid&&rv.declared) tRun+=rv.declared;
        else tRun+=(d.runE||0)/4;
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
    r.innerHTML='<td style="text-align:center;"><input type="checkbox" class="rowSel" data-key="'+escH(k)+'"'+checked+' onclick="event.stopPropagation();onDealRowSel(this)"/></td><td class="mono">'+escH(d.date)+'</td><td>'+av+'</td><td style="font-weight:500;white-space:nowrap;">'+escH(d.client)+'</td><td style="color:var(--text2);font-size:11px;">'+escH(d.contrat)+'</td><td>'+escH(d.produit)+'</td><td style="color:var(--text2);font-size:11px;">'+(d.produit_type?escH(d.produit_type):'—')+'</td><td>'+escH(d.fourn)+'</td><td style="color:var(--text2);">'+(d.broker?escH(d.broker):'—')+'</td><td style="text-align:right;" class="mono">'+f0(d.nom)+'</td><td>'+escH(d.dev)+'</td><td class="mono" style="font-size:10px;color:var(--text2);">'+(d.isin?escH(d.isin):'—')+'</td><td class="mono" style="font-size:11px;color:var(--text2);">'+(d.issue?escH(d.issue):'—')+'</td><td class="mono" style="font-size:11px;color:var(--text2);">'+(d.invS?escH(d.invS):'—')+'</td><td class="mono" style="font-size:11px;color:var(--text2);">'+(d.inv?escH(d.inv):'—')+'</td><td class="mono" style="font-size:11px;color:var(--text2);">'+(d.terme?escH(d.terme):'—')+'</td><td>'+tBadge(d.ct)+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+(d.ufE>0?fE(d.ufE):'—')+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+(d.runE>0?fE(d.runE):'—')+'</td><td class="mono" style="font-size:11px;">'+(d.fRef?escH(d.fRef):'—')+'</td><td>'+fBadge(d.fSt)+'</td><td style="font-size:11px;color:var(--text2);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(d.notes?escH(d.notes):'—')+'</td><td style="display:flex;gap:5px;"><button class="btn btn-sm" onclick="event.stopPropagation();openDealModal('+deals.indexOf(d)+')">Modifier</button><button class="btn btn-sm" style="color:var(--red);border-color:var(--red-bg);" onclick="event.stopPropagation();deleteDeal('+deals.indexOf(d)+')">Supprimer</button></td>';
  });
  var fourns=[...new Set(filt().map(function(d){return d.fourn;}))].sort(),sel=document.getElementById('flFourn'),cv=sel.value;sel.innerHTML='<option value="">Tous fournisseurs</option>';fourns.forEach(function(f){if(f)sel.innerHTML+='<option value="'+escH(f)+'"'+(f===cv?' selected':'')+'>'+escH(f)+'</option>';});
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
  // Count deals with linked Suivi Contrats investments
  var withLinks=sel.map(findLinkedInvestissement).filter(Boolean).length;
  if(!confirm('Supprimer définitivement '+sel.length+' deal(s) ? Cette action est irréversible.'+(withLinks?'\n\n⚠ '+withLinks+' deal(s) ont un investissement lié dans Suivi Contrats.':'')))return;
  var alsoDeleteLinks=false;
  if(withLinks>0){
    alsoDeleteLinks=confirm('Supprimer aussi les '+withLinks+' investissement(s) liés dans Suivi Contrats ?\n\nOK = supprimer les deux, Annuler = supprimer uniquement les deals (les investissements restent dans Suivi Contrats).');
  }
  var failed=0;
  var contractsToSave={};
  for(var i=0;i<sel.length;i++){
    var d=sel[i];
    var link=alsoDeleteLinks?findLinkedInvestissement(d):null;
    if(d._id){try{await sbDelete('deals',d._id);}catch(e){console.error('Bulk delete failed for',d._id,e);failed++;continue;}}
    var idx=deals.indexOf(d);if(idx>=0)deals.splice(idx,1);
    if(link){
      link.contract.produits=(link.contract.produits||[]).filter(function(p){return p.id!==link.prod.id;});
      contractsToSave[link.contract._id]=link.contract;
    }
  }
  // Save touched contracts
  for(var cid in contractsToSave){
    try{await saveContract(contractsToSave[cid]);}catch(e){console.error('Save contract after bulk delete failed',e);}
  }
  selectedDealIds.clear();
  renderAll();
  toast(sel.length+' deal(s) supprimé(s)'+(alsoDeleteLinks&&withLinks?' avec leurs investissements liés':'')+(failed?' ('+failed+' erreur(s))':'.'));
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

  document.getElementById('detBody').innerHTML=
    '<div class="fg2">'+
    '<div><div class="kpi-l">Vendeur</div><div>'+d.v+'</div></div>'+
    '<div><div class="kpi-l">Trade date</div><div>'+d.date+'</div></div>'+
    '<div><div class="kpi-l">Fournisseur</div><div>'+d.fourn+'</div></div>'+
    '<div><div class="kpi-l">Produit</div><div>'+d.produit+'</div></div>'+
    '<div><div class="kpi-l">Nominal</div><div>'+fE(d.nom)+(d.arbClosed?' <span class="badge bp" style="margin-left:6px;">Clôturé par arbitrage</span>':'')+'</div></div>'+
    '<div><div class="kpi-l">Type</div><div>'+d.ct+'</div></div>'+
    (d.ufE>0?'<div><div class="kpi-l">UF</div><div>'+fE(d.ufE)+'</div></div>':'')+
    (d.runE>0?'<div><div class="kpi-l">Running/an</div><div>'+fE(d.runE)+'</div></div>':'')+
    '<div><div class="kpi-l">Statut facture</div><div>'+d.fSt+'</div></div>'+
    '</div>'+arbBlock;
  document.getElementById('detHist').innerHTML=(d.hist||[]).slice().reverse().map(function(h){return '<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);"><span style="color:var(--text3);">'+h.ts+'</span> — '+h.a+'</div>';}).join('');
  document.getElementById('detEdit').onclick=function(){closeDet();openDealModal(idx);};
  document.getElementById('detDelete').onclick=function(){
    showDealDeleteConfirm(d,async function(action,link){
      if(action==='cancel')return;
      if(action==='view'){
        closeDet();
        if(link)ctrExp[link.contract._id]=true;
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
        if(d._id)await sbDelete('deals',d._id);
        deals.splice(idx,1);
        if(action==='delete-both'&&link){
          link.contract.produits=(link.contract.produits||[]).filter(function(p){return p.id!==link.prod.id;});
          await saveContract(link.contract);
        }
        closeDet();renderAll();
        toast(action==='delete-both'?'Deal et investissement supprimés définitivement.':link?'Deal supprimé. Investissement conservé.':'Deal supprimé définitivement.');
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

function addArbDestLine(){
  var div=document.createElement('div');
  div.style.cssText='display:grid;grid-template-columns:1fr 1fr 120px 120px 80px 80px 80px auto;gap:6px;align-items:center;margin-bottom:6px;';
  div.innerHTML=
    '<select class="arbFournSel" style="min-width:0;" onchange="updateArbSummary()">'+arbFournSelectHTML('')+'</select>'+
    '<input type="text" class="arbProduitSel" placeholder="Produit" style="min-width:0;"/>'+
    '<select class="arbContratSel" style="min-width:0;">'+contratSelectHTML('Assurance Vie Lux')+'</select>'+
    '<select class="arbDepSel" style="min-width:0;">'+depositaireSelectHTML('')+'</select>'+
    '<input type="number" class="arbMontantSel" placeholder="Nominal" style="min-width:0;" oninput="updateArbSummary()"/>'+
    '<select class="arbTypeSel" style="min-width:0;" onchange="updateArbTypeRow(this)">'+
      '<option value="RUN">Running</option>'+
      '<option value="UF">UF</option>'+
      '<option value="BOTH">UF+Run</option>'+
      '<option value="PF">Perf fees</option>'+
    '</select>'+
    '<input type="number" class="arbTauxSel" placeholder="%" step="0.01" style="min-width:0;" title="Taux UF ou Running (%)" oninput="updateArbSummary()"/>'+
    '<button type="button" class="btn btn-sm" onclick="this.closest(\'div\').remove();updateArbSummary();" style="color:var(--red);border-color:var(--red-bg);">\u2715</button>';
  document.getElementById('arbDestLines').appendChild(div);
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
    if(fourn&&montant>0)destinations.push({fourn:fourn,produit:produit,contrat:contrat,depositaire:dep,nom:montant,ct:type,taux:taux});
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

async function confirmRetrait(){
 try{
  if(retraitSrcDeal==null)return;
  var d=deals[retraitSrcDeal];if(!d)return;
  var montant=parseFloat(document.getElementById('retrMontant').value)||0;
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
        srcProd.retraits.push({retraitId:retraitId,date:date,montant:montant,prorata_run:prorataRun,note:note,closed:willClose});
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
  var all=deals.filter(d=>(d.ct==='UF'||d.ct==='BOTH')&&d.ufE>0);
  var filtered=ufDealTab==='all'?all
    :ufDealTab==='aE'?all.filter(d=>!d.fSt||d.fSt==='À émettre')
    :ufDealTab==='fact'?all.filter(d=>d.fSt==='Facturé')
    :all.filter(d=>d.fSt==='Payé');
  var t=document.getElementById('ufDealsT');if(!t)return;
  while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('ufDealsEmpty').style.display=filtered.length?'none':'block';
  filtered.slice().sort((a,b)=>a.fourn.localeCompare(b.fourn)||(b.date||'').localeCompare(a.date||'')).forEach(function(d){
    var idx=deals.indexOf(d);
    var statut=d.fSt==='Payé'?'<span class="badge bg">Payée</span>':d.fSt==='Facturé'?'<span class="badge bb">Facturée</span>':'<span class="badge ba">À émettre</span>';
    var btn=d.fSt==='Payé'
      ?'<span style="font-size:11px;color:var(--green);">✓ Payé</span>'
      :d.fSt==='Facturé'
        ?'<button class="btn btn-sm" style="background:var(--green);color:white;border-color:var(--green);" onclick="markUFInvPaid('+idx+')">Marquer payé</button>'
        :'<button class="btn btn-sm" style="background:var(--green);color:white;border-color:var(--green);" onclick="openUFFactModalDeal('+idx+')">Facturer</button>';
    var nomE=d.dev==='USD'?d.nom/(d.fx||1):d.nom;
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
  if(!d.runE||d.runE===0)return 0;
  var tradeStr=d.issue||d.date;
  if(!tradeStr)return d.runE/4;
  var trade=new Date(tradeStr);
  if(trade>trimDates.end)return 0;
  var effStart=trade>trimDates.start?trade:trimDates.start;
  var days=Math.round((trimDates.end-effStart)/(1000*60*60*24))+1;
  return d.runE*(days/365);
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
  var tRUN=document.getElementById('recapRUNT');
  while(tRUN.rows.length>1)tRUN.deleteRow(1);

  var runRows=[];
  filteredFourns.forEach(f=>{
    var fDeals=data.filter(d=>(d.ct==='RUN'||d.ct==='BOTH')&&d.fourn===f.name&&(d.issue||d.date||'')<=trimDates.endStr);
    if(!fDeals.length)return;
    var nomEUR=fDeals.reduce((s,d)=>s+(d.dev==='USD'?d.nom/(d.fx||1):d.nom),0);
    var runAn=fDeals.reduce((s,d)=>s+(d.runE||0),0);
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
  // ── UF TABLE — une ligne par deal ──
  var tUF=document.getElementById('recapUFT');
  while(tUF.rows.length>1)tUF.deleteRow(1);
  var ufDeals=data.filter(d=>(d.ct==='UF'||d.ct==='BOTH')&&d.ufE>0&&(recapFam==='ALL'||fourns.find(f=>f.name===d.fourn&&f.famille===recapFam)));
  ufDeals.sort((a,b)=>a.fourn.localeCompare(b.fourn)||(b.date||'').localeCompare(a.date||''));
  document.getElementById('recapUFEmpty').style.display=ufDeals.length?'none':'block';
  var ufCommTotal=0;
  ufDeals.forEach(d=>{
    var f=fourns.find(x=>x.name===d.fourn)||{famille:''};
    var bc=FAMILLE_BADGE[f.famille]||'bgr';var bl=FAMILLE_LABELS[f.famille]||f.famille||'—';
    var statut=d.fSt==='Payé'?'<span class="badge bg">Payée</span>':d.fSt==='Facturé'?'<span class="badge bb">Facturée</span>':'<span class="badge ba">À émettre</span>';
    var safeName=d.fourn.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    var idx=deals.indexOf(d);
    var actionBtn=d.fSt==='Payé'
      ?'<span style="font-size:11px;color:var(--green);font-weight:600;">✓ Payé</span>'
      :'<button class="btn btn-sm" style="background:var(--green);color:white;border-color:var(--green);" onclick="openUFFactModalDeal('+idx+')">Facturer</button>';
    var nomE=d.dev==='USD'?d.nom/(d.fx||1):d.nom;
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
  var filtered=runInvTab==='all'?all:runInvTab==='aE'?all.filter(i=>!i.facture&&!i.paid):runInvTab==='fact'?all.filter(i=>i.facture&&!i.paid):all.filter(i=>i.paid);
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
    var toUpdate=deals.filter(function(d){return(d.ct==='RUN'||d.ct==='BOTH')&&d.fourn===fourn&&d.fSt==='Facturé'&&d.invS===trimDates.endStr;});
    for(var i=0;i<toUpdate.length;i++){
      var d=toUpdate[i];
      d.fSt='Payé';d.stat='Deal payé';d.inv=paidDate;
      d.hist.push({ts:nowS(),a:'Facture Running payée — '+trim+' '+year+' (deal passé en payé)',by:'Système'});
      if(d._id)await sbUpdate('deals',d._id,d);
    }
    renderRunInvTable();renderFact();renderKpis();updateAlertBadge();
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
  document.getElementById('pfRmDealsList').innerHTML=fDeals.map(d=>
    '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);">'+
    '<div><strong>'+d.client+'</strong><span style="color:var(--text2);margin-left:6px;">'+d.produit+'</span></div>'+
    '<span style="font-weight:600;color:var(--green);">'+fE(d.pf.amount)+'</span></div>').join('');
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
  var filtered=pfInvTabCurrent==='all'?all
    :pfInvTabCurrent==='aE'?all.filter(d=>!d.fSt||d.fSt==='À émettre')
    :pfInvTabCurrent==='fact'?all.filter(d=>d.fSt==='Facturé')
    :all.filter(d=>d.fSt==='Payé');
  var t=document.getElementById('pfInvT');if(!t)return;
  while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('pfInvEmpty').style.display=filtered.length?'none':'block';
  filtered.slice().sort((a,b)=>a.fourn.localeCompare(b.fourn)).forEach(function(d){
    var idx=deals.indexOf(d);
    var statut=d.fSt==='Payé'?'<span class="badge bg">Payée</span>':d.fSt==='Facturé'?'<span class="badge bb">Facturée</span>':'<span class="badge ba">À émettre</span>';
    var btn=d.fSt==='Payé'
      ?'<span style="font-size:11px;color:var(--green);">✓ Payé le '+(d.inv||'')+'</span>'
      :d.fSt==='Facturé'
        ?'<button class="btn btn-sm" style="background:var(--green);color:white;border-color:var(--green);" onclick="markPFInvPaid('+idx+')">Marquer payé</button>'
        :'—';
    var r=t.insertRow();
    r.innerHTML=
      '<td style="font-weight:500;">'+d.fourn+'</td>'+
      '<td>'+d.client+'</td>'+
      '<td style="color:var(--text2);">'+d.produit+'</td>'+
      '<td style="text-align:right;font-weight:500;color:var(--green);">'+fE(d.pf.amount)+'</td>'+
      '<td class="mono" style="color:var(--text2);">'+(d.invS||'—')+'</td>'+
      '<td class="mono" style="color:var(--text2);">'+(d.inv||'—')+'</td>'+
      '<td>'+statut+'</td>'+
      '<td>'+btn+'</td>';
  });
}

async function markPFInvPaid(idx){
  var d=deals[idx];if(!d)return;
  d.fSt='Payé';d.stat='Deal payé';d.inv=new Date().toISOString().split('T')[0];
  d.hist.push({ts:nowS(),a:'Facture Perf fees payée (deal passé en payé)',by:'Système'});
  if(d._id)await sbUpdate('deals',d._id,d);
  renderPFInvTable();renderPFRappr();renderFact();renderKpis();updateAlertBadge();
  toast('Facture Perf fees de '+d.client+' marquée payée.');
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
  var data=filt();
  var fourns=loadFourn();
  var filteredFourns=ufFam==='ALL'?fourns:fourns.filter(f=>f.famille===ufFam);

  // KPIs
  var allUF=data.filter(d=>(d.ct==='UF'||d.ct==='BOTH')&&d.ufE>0);
  var toFact=allUF.filter(d=>!d.fSt||d.fSt==='À émettre');
  var factured=allUF.filter(d=>d.fSt==='Facturé');
  var paid=allUF.filter(d=>d.fSt==='Payé');
  document.getElementById('ufKpi').innerHTML=
    kH('À facturer','warn',fE(toFact.reduce((s,d)=>s+(d.ufE||0),0)),toFact.length+' deal'+(toFact.length!==1?'s':''))+
    kH('Facturé','' ,fE(factured.reduce((s,d)=>s+(d.ufE||0),0)),factured.length+' facture'+(factured.length!==1?'s':''))+
    kH('Payé','blue',fE(paid.reduce((s,d)=>s+(d.ufE||0),0)),paid.length+' facture'+(paid.length!==1?'s':''));

  // Rapprochement table
  var t=document.getElementById('ufRapprT');
  while(t.rows.length>1)t.deleteRow(1);
  var rows=[];
  filteredFourns.forEach(f=>{
    var fDeals=data.filter(d=>(d.ct==='UF'||d.ct==='BOTH')&&d.fourn===f.name&&(!d.fSt||d.fSt==='À émettre'));
    if(!fDeals.length)return;
    var nomTotal=fDeals.reduce((s,d)=>s+(d.dev==='USD'?d.nom/(d.fx||1):d.nom||0),0);
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
  var data=filt();
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
  document.getElementById('ufRmDealsList').innerHTML=fDeals.map(d=>
    '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);">'+
    '<div><strong>'+d.client+'</strong><span style="color:var(--text2);margin-left:6px;">'+d.produit+'</span></div>'+
    '<span style="font-weight:600;color:var(--blue);">'+fE(d.ufE)+'</span></div>').join('');
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
  var fDeals=filt().filter(function(d){return(d.ct==='UF'||d.ct==='BOTH')&&d.fourn===ufRapprCurrentFourn&&(!d.fSt||d.fSt==='À émettre');});
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
  renderUFInvTable();
}

function renderUFInvTable(){
  var all=deals.filter(d=>(d.ct==='UF'||d.ct==='BOTH')&&d.ufE>0);
  var filtered=ufInvTab==='all'?all
    :ufInvTab==='aE'?all.filter(d=>!d.fSt||d.fSt==='À émettre')
    :ufInvTab==='fact'?all.filter(d=>d.fSt==='Facturé')
    :all.filter(d=>d.fSt==='Payé');
  var t=document.getElementById('ufInvT');
  if(!t)return;
  while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('ufInvEmpty').style.display=filtered.length?'none':'block';
  filtered.slice().sort((a,b)=>b.date.localeCompare(a.date)).forEach(function(d){
    var idx=deals.indexOf(d);
    var statut=d.fSt==='Payé'?'<span class="badge bg">Payée</span>':d.fSt==='Facturé'?'<span class="badge bb">Facturée</span>':'<span class="badge ba">À émettre</span>';
    var btn=d.fSt==='Payé'
      ?'<span style="font-size:11px;color:var(--green);">✓ Payé le '+(d.inv||'')+'</span>'
      :d.fSt==='Facturé'
        ?'<button class="btn btn-sm" style="background:var(--green);color:white;border-color:var(--green);" onclick="markUFInvPaid('+idx+')">Marquer payé</button>'
        :'<button class="btn btn-sm" onclick="markUFInvFact('+idx+')">Marquer facturée</button>';
    var delBtn='<button class="btn btn-sm" style="color:var(--red);border-color:var(--red-bg);margin-left:4px;" onclick="deleteUFInv('+idx+')" title="Supprimer">✕</button>';
    var r=t.insertRow();
    r.innerHTML=
      '<td style="font-weight:500;">'+d.fourn+'</td>'+
      '<td>'+d.client+'</td>'+
      '<td style="color:var(--text2);">'+d.produit+'</td>'+
      '<td class="mono" style="color:var(--text2);">'+(d.issue||d.date||'—')+'</td>'+
      '<td style="text-align:right;font-weight:500;color:var(--blue);">'+fE(d.ufE)+'</td>'+
      '<td class="mono" style="color:var(--text2);">'+(d.invS||'—')+'</td>'+
      '<td class="mono" style="color:var(--text2);">'+(d.inv||'—')+'</td>'+
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
  d.hist.push({ts:nowS(),a:'Facture UF payée (deal passé en payé)',by:'Système'});
  if(d._id)await sbUpdate('deals',d._id,d);
  renderUFInvTable();renderFact();renderKpis();updateAlertBadge();
  toast('Facture UF de '+d.client+' marquée comme payée. Commissions mises à jour.');
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
  document.getElementById('rfmGenBtn').textContent=saved&&saved.facture?'✓ Facture générée':'✓ Valider et générer facture';
  document.getElementById('rfmGenBtn').style.opacity=saved&&saved.facture?'0.5':'1';
  updateRecapEcart();
  document.getElementById('recapFactModal').classList.add('on');
  setTimeout(()=>document.getElementById('rfmDeclared').focus(),50);
}
function closeRecapFactModal(){document.getElementById('recapFactModal').classList.remove('on');recapCurrentFourn=null;}
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
  var fDeals=filt().filter(function(d){return(d.ct==='RUN'||d.ct==='BOTH')&&d.fourn===recapCurrentFourn;});
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
  // Include archived deals on the Facturation page so the trace of past invoices stays visible
  var data=filtIncludingArchived();
  var ufDeals=data.filter(d=>d.ct==='UF'||d.ct==='BOTH');
  var aE=ufDeals.filter(d=>d.fSt==='À émettre');
  var fa=ufDeals.filter(d=>d.fSt==='Facturé');
  var pa=ufDeals.filter(d=>d.fSt==='Payé');
  var li=ufDeals.filter(d=>d.fSt==='Litige');
  var totalFact=[...fa,...pa].reduce((s,d)=>s+d.ufE,0);
  var totalPaye=pa.reduce((s,d)=>s+d.ufE,0);
  var totalRun=data.filter(d=>d.ct==='RUN'||d.ct==='BOTH').reduce((s,d)=>s+d.runE,0);
  var runDeals=data.filter(d=>d.ct==='RUN'||d.ct==='BOTH');
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
}

function fCard(d){
  var ht=d.ufE;
  var idx=deals.indexOf(d);
  var arch=!!d.archived;
  // Visual distinction for archived (faded + bottom-right warning panel)
  var archBanner=arch?'<div style="position:absolute;bottom:0;right:0;background:var(--red-bg);color:var(--red-t);font-size:10px;font-weight:600;padding:4px 10px;border-top-left-radius:8px;border-left:1px solid rgba(194,59,59,.3);border-top:1px solid rgba(194,59,59,.3);display:flex;align-items:center;gap:5px;" title="Le deal a été supprimé. La facture est conservée pour historique.">⚠ Deal supprimé</div>':'';
  var statusButtons=arch?'':'<button class="btn btn-sm" onclick="cycleFS('+idx+')">Changer statut</button>';
  return '<div class="fact-card" style="position:relative;'+(arch?'opacity:.85;border-style:dashed;':'')+'">'+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;">'+
      '<div>'+
        '<div style="font-size:11px;color:var(--text3);">'+(d.fRef||'Sans référence')+' · '+d.date+'</div>'+
        '<div style="font-size:14px;font-weight:600;margin-top:1px;">'+d.client+'</div>'+
        '<div style="font-size:11px;color:var(--text2);">'+d.fourn+(d.produit?' · '+d.produit:'')+'</div>'+
        '<div style="margin-top:4px;"><span class="badge bb" style="font-size:9px;">UF</span> <span style="font-size:11px;color:var(--text2);">Trade date : '+(d.issue||'—')+'</span></div>'+
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
    archBanner+
  '</div>';
}

async function cycleFS(idx){
  var o=['À émettre','Facturé','Payé','Litige'],d=deals[idx],i=o.indexOf(d.fSt),n=o[(i+1)%o.length];
  d.hist.push({ts:nowS(),a:'Statut → '+n,by:d.v});d.fSt=n;
  if(d._id)await sbUpdate('deals',d._id,d);
  renderFact();renderKpis();updateAlertBadge();toast('Statut → '+n);
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
  produits:{label:'Produits / Échéances',color:'var(--amber)'},
  deals:{label:'Cohérence des deals',color:'var(--red)'},
  contrats:{label:'Suivi Contrats',color:'var(--blue)'},
  rapprochement:{label:'Rapprochements',color:'var(--purple)'},
  orphans:{label:'Données orphelines',color:'var(--text3)'}
};
var ALERT_SEVERITY={
  urgent:{lbl:'Urgent',cls:'br',color:'var(--red)'},
  warning:{lbl:'Attention',cls:'ba',color:'var(--amber)'},
  info:{lbl:'Info',cls:'bb',color:'var(--blue)'}
};

function buildAlerts(){
  var alerts=[],now=new Date();now.setHours(0,0,0,0);
  var dayMs=86400000;

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
      (byS.info>0?' · <span style="color:var(--text2);">'+byS.info+' info</span>':'');
  }
  var listEl=document.getElementById('alertesList');
  var emptyEl=document.getElementById('alertesEmpty');
  if(!alerts.length){listEl.innerHTML='';emptyEl.style.display='block';return;}
  emptyEl.style.display='none';

  var groups={};alerts.forEach(function(a){(groups[a.category]=groups[a.category]||[]).push(a);});
  var html='';
  Object.keys(ALERT_CATEGORIES).forEach(function(catKey){
    var list=groups[catKey];if(!list||!list.length)return;
    var cat=ALERT_CATEGORIES[catKey];
    html+='<div class="card" style="border-left:4px solid '+cat.color+';padding:12px 16px;margin-bottom:12px;">'+
      '<div style="font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;display:flex;align-items:center;gap:8px;">'+
        '<span>'+cat.label+'</span>'+
        '<span style="background:var(--surface2);padding:1px 8px;border-radius:999px;font-weight:500;color:var(--text);">'+list.length+'</span>'+
      '</div>';
    list.forEach(function(a){
      var sv=ALERT_SEVERITY[a.severity];
      var clickable=alertActionHandler(a)?'cursor:pointer;':'';
      html+='<div class="alert-item" style="'+clickable+'" data-alertid="'+escH(a.id)+'">'+
        '<span class="adot" style="background:'+sv.color+';"></span>'+
        '<div style="flex:1;min-width:0;">'+
          '<div style="font-size:13px;font-weight:500;color:var(--text);">'+escH(a.title)+'</div>'+
          '<div style="font-size:11px;color:var(--text2);margin-top:1px;">'+escH(a.detail||'')+'</div>'+
        '</div>'+
        '<span class="badge '+sv.cls+'">'+sv.lbl+'</span>'+
      '</div>';
    });
    html+='</div>';
  });
  listEl.innerHTML=html;
  listEl.querySelectorAll('.alert-item').forEach(function(el){
    var id=el.dataset.alertid;
    var a=alerts.find(function(x){return x.id===id;});if(!a)return;
    var h=alertActionHandler(a);if(!h)return;
    el.addEventListener('click',h);
  });
}

// Encours d'un client = somme des nominaux (en EUR) de ses deals actifs.
// Un deal est "actif" si nom > 0 (les deals fully arbed-out ont nom=0 automatiquement).
function encoursForClient(clientName){
  if(!clientName)return 0;
  return deals.filter(function(d){return d.client===clientName&&(d.nom||0)>0;}).reduce(function(s,d){
    var nomEUR=d.dev==='USD'?d.nom/(d.fx||1):d.nom;
    return s+nomEUR;
  },0);
}
function encoursTotalGlobal(){
  return deals.filter(function(d){return (d.nom||0)>0;}).reduce(function(s,d){
    var nomEUR=d.dev==='USD'?d.nom/(d.fx||1):d.nom;
    return s+nomEUR;
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
    var nomEUR=d.dev==='USD'?d.nom/(d.fx||1):d.nom;
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
    var nomEUR=d.dev==='USD'?d.nom/(d.fx||1):d.nom;
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
    s.nom+=(d.dev==='USD'?d.nom/(d.fx||1):d.nom);
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

  // ── 8. Devise (donut nominal) ───────────────────────────────────────────
  var eur=data.filter(function(d){return d.dev==='EUR';}).reduce(function(s,d){return s+d.nom;},0);
  var usd=data.filter(function(d){return d.dev==='USD';}).reduce(function(s,d){return s+d.nom;},0);
  if(charts.dv)charts.dv.destroy();
  charts.dv=new Chart(document.getElementById('cDev'),{type:'doughnut',data:{labels:['EUR','USD'],datasets:[{data:[Math.round(eur),Math.round(usd)],backgroundColor:['#6b4fc4','#b07a10'],borderWidth:2,borderColor:'#fff',hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{display:false},tooltip:Object.assign({},CHART_DEFAULTS.tooltip,{callbacks:{label:function(c){return c.label+' : '+f0(c.raw);}}})}}});
  document.getElementById('legDev').innerHTML=legendChip('#6b4fc4','EUR',f0(eur))+legendChip('#b07a10','USD',f0(usd));
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
function addCodifLine(codif){
  codif=codif||{fourn:'',produit:'',type:'',isin:'',broker:'',maturite:''};
  var container=document.getElementById('codifLines');
  var row=document.createElement('div');
  row.className='codif-line';
  row.style.cssText='display:grid;grid-template-columns:1.3fr 1.3fr 130px 100px 1fr 120px 28px;gap:6px;margin-bottom:6px;align-items:center;';
  row.innerHTML='<select class="codifFourn">'+fournOptHtml(codif.fourn)+'</select>'
    +'<input type="text" class="codifProduit" value="'+(codif.produit||'')+'" placeholder="Produit / Support"/>'
    +'<select class="codifType">'+produitTypeOptHtml(codif.type)+'</select>'
    +'<input type="text" class="codifISIN" value="'+(codif.isin||'')+'" placeholder="ISIN" style="font-family:monospace;font-size:11px;"/>'
    +'<select class="codifBroker">'+brokerOptHtml(codif.broker)+'</select>'
    +'<input type="date" class="codifMaturite" value="'+(codif.maturite||'')+'"/>'
    +'<button type="button" onclick="removeCodifLine(this)" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:18px;padding:0;line-height:1;">×</button>';
  container.appendChild(row);
}
function removeCodifLine(btn){
  var row=btn.closest('.codif-line');
  if(document.querySelectorAll('#codifLines .codif-line').length>1)row.remove();
}
function renderCodifLines(codifs){
  var c=document.getElementById('codifLines');c.innerHTML='';
  if(!codifs||!codifs.length)codifs=[{fourn:'',produit:'',isin:'',broker:''}];
  codifs.forEach(function(x){addCodifLine(x);});
}
function getCodifLines(){
  var result=[];
  document.querySelectorAll('#codifLines .codif-line').forEach(function(row){
    result.push({
      fourn:row.querySelector('.codifFourn').value,
      produit:row.querySelector('.codifProduit').value,
      type:row.querySelector('.codifType')?row.querySelector('.codifType').value:'',
      isin:row.querySelector('.codifISIN').value,
      broker:row.querySelector('.codifBroker').value,
      maturite:row.querySelector('.codifMaturite').value
    });
  });
  return result;
}
function openDealModal(idx){
  editIdx=idx!=null?idx:-1;
  rebuildFournSelect();rebuildBrokerSelect();
  document.getElementById('dmTitle').textContent=editIdx>=0?'Modifier le deal':'Nouveau deal';
  if(editIdx>=0){var d=deals[editIdx];document.getElementById('mV').value=d.v;document.getElementById('mDate').value=d.date;document.getElementById('mStat').value=d.stat;renderClientLines([d.client],[d.contrat],[d.nom],[d.depositaire||'']);document.getElementById('mContrat').value=d.contrat;document.getElementById('mNom').value=d.nom;document.getElementById('mDev').value=d.dev;document.getElementById('mIssue').value=d.issue||'';document.getElementById('mInvS').value=d.invS||'';document.getElementById('mInv').value=d.inv||'';document.getElementById('mUFR').value=d.ufR;document.getElementById('mRunR').value=d.runR;document.getElementById('mNotes').value=d.notes||'';renderCodifLines(d.codifications&&d.codifications.length?d.codifications:[{fourn:d.fourn||'',produit:d.produit||'',type:d.produit_type||'',isin:d.isin||'',broker:d.broker||'',maturite:d.maturite||d.terme||''}]);setCT(d.ct);
    var pf=d.pf||{mode:'none'};pfMode=pf.mode||'none';
    var pfBtn=document.getElementById('ctPF');pfBtn.classList.toggle('on',pfMode!=='none');
    document.getElementById('pfRow').style.display=pfMode!=='none'?'block':'none';
    if(pfMode!=='none'){document.getElementById('mPFType').value=pf.type||'pct';document.getElementById('mPFRate').value=pf.rate||'';document.getElementById('mPFHurdle').value=pf.hurdle||'';document.getElementById('mPFFixed').value=pf.amount||'';document.getElementById('mPFFreq').value=pf.freq||'annuel';onPFTypeChange();}
  } else {document.getElementById('mDate').value=today();renderClientLines(['']);renderCodifLines([]);document.getElementById('mNom').value='';document.getElementById('mUFR').value='';document.getElementById('mRunR').value='';document.getElementById('mNotes').value='';document.getElementById('mPFRate').value='';document.getElementById('mPFHurdle').value='';document.getElementById('mPFFixed').value='';document.getElementById('mInvS').value='';document.getElementById('ctPF').classList.remove('on');document.getElementById('pfRow').style.display='none';pfMode='none';cancelAddClient();setCT('UF');}
  rebuildFournSelect();rebuildBrokerSelect();
  document.getElementById('dealModal').classList.add('on');calcM();
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
}

async function saveDeal(){
 try{
  var nom=parseFloat(document.getElementById('mNom').value)||0;
  var items=getSelectedClients();
  if(!items.length){alert('Au moins un client requis.');return;}
  if(!items.some(function(x){return x.nom>0;})){alert('Veuillez saisir un nominal pour au moins un client.');return;}
  var dev=document.getElementById('mDev').value,fx=1,nomE=nom;
  var ufP=(parseFloat(document.getElementById('mUFR').value)||0)/100,runP=(parseFloat(document.getElementById('mRunR').value)||0)/100;
  var pf={mode:pfMode};
  if(pfMode!=='none'){var pfType=document.getElementById('mPFType').value;pf.type=pfType;pf.freq=document.getElementById('mPFFreq').value;if(pfType==='pct'){pf.rate=parseFloat(document.getElementById('mPFRate').value)||0;pf.hurdle=parseFloat(document.getElementById('mPFHurdle').value)||0;}else{pf.amount=parseFloat(document.getElementById('mPFFixed').value)||0;}}
  var codifs=getCodifLines();
  var base={v:document.getElementById('mV').value,date:document.getElementById('mDate').value,stat:document.getElementById('mStat').value,contrat:document.getElementById('mContrat').value,fourn:codifs[0]?codifs[0].fourn:'',produit:codifs[0]?codifs[0].produit:'',produit_type:codifs[0]&&codifs[0].type?codifs[0].type:null,isin:codifs[0]?codifs[0].isin:'',broker:codifs[0]?codifs[0].broker:'',maturite:codifs[0]?codifs[0].maturite||null:null,terme:codifs[0]?codifs[0].maturite||null:null,codifications:codifs,nom,dev,fx,issue:document.getElementById('mIssue').value,invS:document.getElementById('mInvS').value,inv:document.getElementById('mInv').value,ct,ufR:parseFloat(document.getElementById('mUFR').value)||0,runR:parseFloat(document.getElementById('mRunR').value)||0,tva:0,ufE:Math.round(dev==='USD'?(nom*ufP/fx):nom*ufP),runE:Math.round(nomE*runP),pf,fSt:'À émettre',fRef:'',notes:document.getElementById('mNotes').value};
  if(editIdx>=0){
    var cc=getSelectedClients();
    var lineNom=cc.length&&cc[0].nom?cc[0].nom:nom;
    var ufP2=(parseFloat(document.getElementById('mUFR').value)||0)/100;
    var runP2=(parseFloat(document.getElementById('mRunR').value)||0)/100;
    var existing=deals[editIdx];
    var prevHist=Array.isArray(existing.hist)?existing.hist:[];
    var d={...base,nom:lineNom,ufE:Math.round(lineNom*ufP2),runE:Math.round(lineNom*runP2),client:cc.length?cc[0].client:existing.client,contrat:cc.length?cc[0].contrat:base.contrat,hist:[...prevHist,{ts:nowS(),a:'Deal modifié',by:base.v}]};
    var _id=existing._id;d._id=_id;if(_id)await sbUpdate('deals',_id,d);deals[editIdx]=d;
    closeDM();renderAll();toast('Deal modifié.');
  } else {
    var ufP3=(parseFloat(document.getElementById('mUFR').value)||0)/100;
    var runP3=(parseFloat(document.getElementById('mRunR').value)||0)/100;
    var autoLinked=0;
    for(var ii=0;ii<items.length;ii++){
      var item=items[ii];
      var lineNom2=item.nom||nom;
      var d={...base,nom:lineNom2,ufE:Math.round(lineNom2*ufP3),runE:Math.round(lineNom2*runP3),client:item.client,contrat:item.contrat,depositaire:item.depositaire||'',fSt:'À émettre',hist:[{ts:nowS(),a:'Deal créé',by:base.v}]};
      var res=await sbInsert('deals',d);
      if(res&&res[0])d._id=res[0].id;
      deals.push(d);
      if(d.stat==='Deal pipe'){try{await autoLinkDealToContract(d);autoLinked++;}catch(e){console.error('autoLinkDealToContract failed',e);}}
    }
    closeDM();renderAll();toast((items.length>1?items.length+' deals enregistrés':'Nouveau deal enregistré')+(autoLinked?' · '+autoLinked+' investissement'+(autoLinked>1?'s':'')+' ajouté'+(autoLinked>1?'s':'')+' au suivi.':'.'));
  }
 }catch(err){
  console.error('saveDeal failed',err);
  alert('Erreur enregistrement deal :\n\n'+(err.message||err)+'\n\n(Voir la console pour le détail.)');
 }
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
function loadClientDB(){return clients_db;}
function saveClientDB(db){/* async handled in saveClient */}
// saveClientDB handled by Supabase
function setClientTab(t,btn){
  clientTab=t;
  document.querySelectorAll('#tabPP,#tabPM,#tabAll').forEach(b=>{b.style.background='';b.style.color='';b.style.borderColor='';});
  btn.style.background='var(--text)';btn.style.color='var(--surface)';btn.style.borderColor='var(--text)';
  renderClients();
}
function renderClients(){
  var db=loadClientDB();
  var filtered=clientTab==='ALL'?db:db.filter(c=>c.type===clientTab);
  filtered.sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
  var t=document.getElementById('clientsT');
  while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('clientsEmpty').style.display=filtered.length?'none':'block';
  filtered.forEach(c=>{
    var dDeals=deals.filter(d=>d.client===c.name);
    var nbD=dDeals.length;
    var totalNom=dDeals.reduce((s,d)=>s+d.nom,0);
    var totalUF=dDeals.reduce((s,d)=>s+d.ufE,0);
    var totalRun=dDeals.reduce((s,d)=>s+d.runE,0);
    var lastDate=dDeals.length?dDeals.sort((a,b)=>b.date.localeCompare(a.date))[0].date:'—';
    var typeBadge=c.type==='PP'?'<span class="badge bb">Pers. physique</span>':'<span class="badge bp">Pers. morale</span>';
    var r=t.insertRow();
    var encours=encoursForClient(c.name);
    r.innerHTML='<td style="font-weight:500;cursor:pointer;" title="Double-cliquer pour modifier" ondblclick="openAddClientModal(\''+escAttr(c.name)+'\')">'+escH(c.name)+'</td><td>'+typeBadge+'</td><td style="color:var(--text2);">'+(c.vendeur?escH(c.vendeur):'—')+'</td><td style="text-align:right;font-weight:600;color:var(--blue);" class="mono">'+(encours>0?fE(encours):'—')+'</td><td style="text-align:center;">'+nbD+'</td><td style="text-align:right;" class="mono">'+(totalNom>0?fE(totalNom):'—')+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+(totalUF>0?fE(totalUF):'—')+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+(totalRun>0?fE(totalRun):'—')+'</td><td class="mono" style="color:var(--text2);">'+escH(lastDate)+'</td>';
  });
}
function openAddClientModal(name){
  document.getElementById('clientModalTitle').textContent=name?'Modifier le client':'Nouveau client';
  document.getElementById('cName').value=name||'';
  document.getElementById('cName').dataset.original=name||'';
  if(name){
    var db=loadClientDB();var c=db.find(x=>x.name===name)||{};
    document.getElementById('cType').value=c.type||'PP';
    document.getElementById('cVendeur').value=c.vendeur||'';
    document.getElementById('cEmail').value=c.email||'';
    var ecDisp=document.getElementById('cEncoursDisplay');if(ecDisp){var ec=encoursForClient(c.name);ecDisp.textContent=ec>0?fE(ec):'— (aucun deal actif)';}
    document.getElementById('cNotes').value=c.notes||'';
  } else {
    document.getElementById('cType').value='PP';
    document.getElementById('cVendeur').value='';
    document.getElementById('cEmail').value='';
    var ecDisp2=document.getElementById('cEncoursDisplay');if(ecDisp2)ecDisp2.textContent='— (aucun deal pour l\'instant)';
    document.getElementById('cNotes').value='';
  }
  document.getElementById('clientDeleteBtn').style.display=name?'':'none';
  var placeholder=document.getElementById('clientNewPlaceholder');
  if(placeholder)placeholder.style.display=name?'none':'flex';

  // KPIs encours
  var kpisDiv=document.getElementById('clientKpis');
  var kpisContent=document.getElementById('clientKpisContent');
  if(name){
    var cDeals=deals.filter(function(d){return d.client===name;});
    var totalNom=cDeals.reduce(function(s,d){return s+(d.dev==='USD'?d.nom/(d.fx||1):d.nom||0);},0);
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
    var clientDeals=deals.filter(function(d){return d.client===name;}).sort(function(a,b){return (a.contrat||'').localeCompare(b.contrat||'');});
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
        // Stats du contrat
        var sumNomEUR=cDeals.reduce(function(s,d){return s+(d.dev==='USD'?d.nom/(d.fx||1):d.nom);},0);
        var sumUF=cDeals.reduce(function(s,d){return s+(d.ufE||0);},0);
        var sumRun=cDeals.reduce(function(s,d){return s+(d.runE||0);},0);

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
            var typeBadge=d.ct==='UF'?'<span class="badge bb">UF</span>':d.ct==='RUN'?'<span class="badge bg">Running</span>':d.ct==='BOTH'?'<span class="badge bb">UF</span><span class="badge bg" style="margin-left:3px;">Run</span>':'';
            var feesParts=[];
            if(d.ufE>0)feesParts.push('<span style="color:var(--blue);font-weight:500;">'+fE(d.ufE)+'</span> UF');
            if(d.runE>0)feesParts.push('<span style="color:var(--green);font-weight:500;">'+fE(d.runE)+'</span>/an');
            if(d.pf&&d.pf.amount)feesParts.push('<span style="color:var(--purple);font-weight:500;">'+fE(d.pf.amount)+'</span> PF');
            var depChip=d.depositaire?'<span style="font-size:10px;color:var(--text3);background:var(--surface2);padding:1px 6px;border-radius:3px;white-space:nowrap;">📍 '+escH(d.depositaire)+'</span>':'';
            var isLast=i===cDeals.length-1;
            var idx=deals.indexOf(d);
            return '<div style="display:flex;border-bottom:'+(isLast?'none':'1px solid var(--border)')+';transition:background .12s;" onmouseover="this.style.background=\'var(--surface2)\'" onmouseout="this.style.background=\'\'">'+
              // Bandeau couleur statut
              '<div style="width:3px;background:'+st.color+';flex-shrink:0;border-radius:0 0 0 0;"></div>'+
              '<div style="flex:1;padding:10px 12px;min-width:0;cursor:pointer;" onclick="closeClientModal();openDet(deals['+idx+'])">'+
                // Ligne 1 : fournisseur + produit + depositaire (gauche) | nominal + status (droite)
                '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:5px;">'+
                  '<div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">'+
                    '<span style="font-weight:600;font-size:13px;color:var(--text);white-space:nowrap;">'+escH(d.fourn||'')+'</span>'+
                    '<span style="color:var(--text2);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;">'+escH(d.produit||'')+'</span>'+
                    depChip+
                  '</div>'+
                  '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">'+
                    '<span style="font-weight:600;font-size:13px;color:var(--text);" class="mono">'+f0(d.nom)+' '+escH(d.dev||'')+'</span>'+
                    statusBadge+
                  '</div>'+
                '</div>'+
                // Ligne 2 : type + commissions + ISIN/maturité
                '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;">'+
                  '<div style="display:flex;align-items:center;gap:8px;min-width:0;">'+
                    typeBadge+
                    (feesParts.length?'<span style="color:var(--text2);">'+feesParts.join(' · ')+'</span>':'')+
                  '</div>'+
                  '<div style="display:flex;align-items:center;gap:8px;color:var(--text3);font-size:10px;">'+
                    (d.isin?'<span class="mono">'+escH(d.isin)+'</span>':'')+
                    (d.maturite||d.terme?'<span>échéance '+escH(d.maturite||d.terme)+'</span>':'')+
                  '</div>'+
                '</div>'+
              '</div>'+
              '<div style="display:flex;flex-direction:column;align-items:stretch;gap:4px;padding:0 10px;flex-shrink:0;">'+
                '<button class="btn btn-sm" onclick="event.stopPropagation();closeClientModal();openArbitrage('+idx+')" style="font-size:11px;padding:4px 10px;white-space:nowrap;" title="Arbitrer ce deal">⇄ Arbitrer</button>'+
                '<button class="btn btn-sm" onclick="event.stopPropagation();closeClientModal();openRetrait('+idx+')" style="font-size:11px;padding:4px 10px;white-space:nowrap;color:var(--amber-t);border-color:rgba(176,122,16,.3);background:var(--amber-bg);" title="Retrait de cash sur ce deal">↓ Retirer</button>'+
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
  // Historique des opérations — deals + retraits, fusionnés sur la même timeline
  var histSection=document.getElementById('clientHistSection');
  var histLines=document.getElementById('clientHistLines');
  if(name){
    var events=[];
    // Deals (création + arbitrages = ils apparaissent comme deal ou arbitrage selon arbId/arbSrc)
    deals.filter(function(d){return d.client===name;}).forEach(function(d){
      events.push({kind:d.arbId||d.arbSrc?'arb':'deal',date:d.date||'',deal:d});
    });
    // Retraits (stockés dans contracts_db[].produits[].retraits[])
    contracts_db.forEach(function(c){
      if(c.client!==name)return;
      (c.produits||[]).forEach(function(p){
        (p.retraits||[]).forEach(function(r){
          var srcDeal=p.deal_id?deals.find(function(x){return x._id===p.deal_id;}):null;
          events.push({kind:'retrait',date:r.date||'',retrait:r,prod:p,contract:c,srcDeal:srcDeal});
        });
      });
    });
    if(events.length){
      histSection.style.display='block';
      events.sort(function(a,b){return (b.date||'').localeCompare(a.date||'');});
      var html='<div style="border-left:2px solid var(--border);padding-left:12px;">';
      events.forEach(function(ev){
        if(ev.kind==='retrait'){
          var r=ev.retrait,p=ev.prod,sd=ev.srcDeal;
          var icon='↓',color='var(--amber)',label='Retrait'+(r.closed?' (clôture)':'');
          var srcLabel=sd?(escH(sd.fourn||'')+' — '+escH(sd.produit||'')):escH(p.name||'(produit)');
          var dev=sd?(sd.dev||'EUR'):'EUR';
          html+=
            '<div style="position:relative;margin-bottom:12px;">'+
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
          return;
        }
        var d=ev.deal;
        var isArb=d.arbId||d.arbSrc;
        var icon=isArb?'⇄':'●';
        var color=isArb?'var(--purple,#7c3aed)':'var(--blue)';
        var label=isArb?'Arbitrage':'Deal';
        var typeBadge=d.ct==='UF'?'<span class="badge bb">UF</span>':d.ct==='RUN'?'<span class="badge bg">Running</span>':'<span class="badge bb">UF+Run</span>';
        var fees='';
        if(d.ufE>0)fees+=fE(d.ufE)+' UF';
        if(d.runE>0)fees+=(fees?' · ':'')+fE(d.runE)+'/an';
        if(d.pf&&d.pf.amount)fees+=(fees?' · ':'')+fE(d.pf.amount)+' PF';
        html+=
          '<div style="position:relative;margin-bottom:12px;">'+
            '<div style="position:absolute;left:-18px;top:3px;color:'+color+';font-size:14px;font-weight:700;">'+icon+'</div>'+
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;">'+
              '<div>'+
                '<span style="font-size:11px;color:var(--text3);">'+escH(d.date||'')+'</span>'+
                '<span style="font-size:11px;color:var(--text3);margin-left:6px;">'+label+'</span>'+
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
      });
      html+='</div>';
      histLines.innerHTML=html;
    } else {
      histSection.style.display='none';
    }
  } else {
    histSection.style.display='none';
    histLines.innerHTML='';
  }
  setTimeout(()=>document.getElementById('cName').focus(),50);
  document.getElementById('clientModal').classList.add('on');
}
function closeClientModal(){document.getElementById('clientModal').classList.remove('on');document.getElementById('cName').dataset.original='';}
function deleteClientFromModal(){var o=document.getElementById('cName').dataset.original;if(!o)return;closeClientModal();deleteClient(o);}
// Returns {contract, prod} if a Suivi-Contrats investissement is linked to this deal, else null.
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

// Show the linked-deletion confirm modal. callback(action, link)
// action ∈ {'cancel','view','archive','delete-deal-only','delete-both'}
var _ddcCallback=null;
function showDealDeleteConfirm(deal,callback){
  var link=findLinkedInvestissement(deal);
  // Always show the modal (even when no linked investissement) so the user
  // can choose between archive (keep facture trace) and hard delete.
  document.getElementById('ddcClient').textContent=link?link.contract.client:(deal.client||'—');
  document.getElementById('ddcDealLabel').textContent=(deal.client||'')+' — '+(deal.produit||'');
  if(link){
    document.getElementById('ddcDetails').innerHTML=
      '<div><b>Investissement lié</b> : '+escH(link.prod.name||'(sans nom)')+(link.prod.isin?' · ISIN '+escH(link.prod.isin):'')+(link.prod.montant?' · '+escH(link.prod.montant):'')+'</div>'+
      '<div style="margin-top:4px;"><b>Contrat</b> : '+escH(link.contract.client)+(link.contract.num?' (#'+escH(link.contract.num)+')':'')+'</div>';
  } else {
    var paidNote=(deal.fSt==='Payé'||deal.fSt==='Facturé')?'<div style="margin-top:6px;color:var(--amber-t);"><b>⚠ Facture '+escH(deal.fSt.toLowerCase())+'</b> — l\'archivage est recommandé pour garder la trace.</div>':'';
    document.getElementById('ddcDetails').innerHTML=
      '<div>Statut facture : <b>'+escH(deal.fSt||'—')+'</b></div>'+
      '<div>Aucun investissement Suivi Contrats lié à ce deal.</div>'+paidNote;
  }
  // Show / hide the "Tout supprimer" option based on link presence
  var deleteBothBtn=document.querySelector('#dealDeleteConfirmModal .modal-ft button[onclick*="delete-both"]');
  if(deleteBothBtn)deleteBothBtn.style.display=link?'':'none';
  _ddcCallback=function(action){callback(action,link);};
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
  showDealDeleteConfirm(d,async function(action,link){
    if(action==='cancel')return;
    if(action==='view'){
      if(link)ctrExp[link.contract._id]=true;
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
      if(d._id)await sbDelete('deals',d._id);
      var i=deals.indexOf(d);if(i>=0)deals.splice(i,1);
      if(action==='delete-both'&&link){
        link.contract.produits=(link.contract.produits||[]).filter(function(p){return p.id!==link.prod.id;});
        await saveContract(link.contract);
      }
      renderAll();
      toast(action==='delete-both'?'Deal et investissement supprimés définitivement.':link?'Deal supprimé. Investissement conservé.':'Deal supprimé définitivement.');
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
  var entry={name,type:document.getElementById('cType').value,vendeur:document.getElementById('cVendeur').value,email:document.getElementById('cEmail').value,notes:document.getElementById('cNotes').value};
  if(original&&original!==name){
    var c=clients_db.find(x=>x.name===original);
    if(c){entry._id=c._id;await sbUpdate('clients',c._id,entry);Object.assign(c,entry);}
    for(var di=0;di<deals.length;di++){var dd=deals[di];if(dd.client===original){dd.client=name;if(dd._id)await sbUpdate('deals',dd._id,dd);}}
    // Cascade to contracts (rename client field)
    var ctrToUpdate=contracts_db.filter(function(x){return x.client===original;});
    for(var ci=0;ci<ctrToUpdate.length;ci++){
      ctrToUpdate[ci].client=name;
      try{await saveContract(ctrToUpdate[ci]);}catch(e){console.error('Contract rename cascade failed',e);}
    }
  } else {
    var existing=clients_db.find(x=>x.name===name);
    if(existing){await sbUpdate('clients',existing._id,entry);Object.assign(existing,entry);}
    else{var res=await sbInsert('clients',entry);if(res&&res[0])clients_db.push({...entry,_id:res[0].id});}
  }
  closeClientModal();renderClients();renderDeals();toast(original?'Client mis à jour.':'Client ajouté.');
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
  document.getElementById('fournCount').textContent=list.length+' fournisseur'+(list.length>1?'s':'');
  var t=document.getElementById('fournT');
  while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('fournEmpty').style.display=list.length?'none':'block';
  list.forEach(function(f){
    var dDeals=deals.filter(d=>d.fourn===f.name);
    var nb=dDeals.length;
    var tUF=dDeals.reduce((s,d)=>s+d.ufE,0);
    var tRun=dDeals.reduce((s,d)=>s+d.runE,0);
    var last=dDeals.length?dDeals.slice().sort((a,b)=>b.date.localeCompare(a.date))[0].date:'—';
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
  if(name){
    var f=loadFourn().find(x=>x.name===name)||{};
    document.getElementById('fName').value=name;
    document.getElementById('fFamille').value=f.famille||'SDG';
    document.getElementById('fAddr1').value=f.addr1||'';
    document.getElementById('fAddr2').value=f.addr2||'';
    document.getElementById('fContact').value=f.contact||'';
    document.getElementById('fEmail').value=f.email||'';
    document.getElementById('fName').dataset.original=name;
  } else {
    document.getElementById('fName').value='';
    document.getElementById('fFamille').value='SDG';
    document.getElementById('fAddr1').value='';
    document.getElementById('fAddr2').value='';
    document.getElementById('fContact').value='';
    document.getElementById('fEmail').value='';
    document.getElementById('fName').dataset.original='';
  }
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
async function saveFourn(){
  var name=document.getElementById('fName').value.trim();
  var famille=document.getElementById('fFamille').value;
  var addr1=document.getElementById('fAddr1').value.trim();
  var addr2=document.getElementById('fAddr2').value.trim();
  var contact=document.getElementById('fContact').value.trim();
  var email=document.getElementById('fEmail').value.trim();
  var original=document.getElementById('fName').dataset.original||'';
  if(!name){alert('Nom requis.');return;}
  var payload={name,famille,addr1,addr2,contact,email};
  if(original&&original!==name){
    var f=fourn_db.find(x=>x.name===original);
    if(f){Object.assign(f,payload);await sbUpdate('fournisseurs',f._id,payload);}
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
    if(existing){Object.assign(existing,payload);await sbUpdate('fournisseurs',existing._id,payload);}
    else{var res=await sbInsert('fournisseurs',payload);if(res&&res[0])fourn_db.push({...payload,_id:res[0].id});}
  }
  closeFournModal();renderFourn();renderDeals();toast(original?'Fournisseur mis à jour.':'Fournisseur ajouté.');
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
    var nomEUR=fDeals.reduce((s,d)=>{
      var n=d.nom||0;
      return s+(d.dev==='USD'?n/(d.fx||1):n);
    },0);
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
  var nomEUR=allDeals.reduce((s,d)=>s+(d.dev==='USD'?d.nom/(d.fx||1):d.nom),0);
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
  document.getElementById('brokerCount').textContent=list.length+' broker'+(list.length>1?'s':'');
  var t=document.getElementById('brokerT');
  while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('brokerEmpty').style.display=list.length?'none':'block';
  list.forEach(function(b){
    var dDeals=deals.filter(d=>d.broker===b);
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
    // (B) Running contribution: include this deal if it has running and its fournisseur has a
    // paid rapprochement in the period (running is tracked at trim+fourn level, independent of fSt)
    if((d.ct==='RUN'||d.ct==='BOTH')&&d.runE>0&&paidRunFourns[d.fourn])return true;
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

function renderDrill(){
  if(!commDrillVendeur)return;
  var data=getCommDeals().filter(d=>d.v===commDrillVendeur||d.v==='Audrey & David');
  var t=document.getElementById('commDrillT');
  t.innerHTML='';
  document.getElementById('commDrillEmpty').style.display=data.length?'none':'block';
  var runCol=commPeriod==='annee'?'Running /an':commPeriod==='trimestre'?'Running trim.':'Running mois';

  if(commDrillTab==='fournisseur'){
    t.innerHTML='<tr><th>Fournisseur</th><th>Nb deals</th><th>UF (EUR)</th><th>'+runCol+'</th><th>Perf fees</th><th>Total</th></tr>';
    var by={};
    data.forEach(d=>{
      if(!by[d.fourn])by[d.fourn]={nb:0,uf:0,run:0,pf:0};
      by[d.fourn].nb++;by[d.fourn].uf+=d.ufE||0;
      by[d.fourn].run+=getRunProrata(d);
      by[d.fourn].pf+=(d.pf&&d.pf.amount?d.pf.amount:0);
    });
    Object.entries(by).sort((a,b)=>b[1].uf+b[1].run-(a[1].uf+a[1].run)).forEach(([f,v])=>{
      var ht=v.uf+v.run;var r=t.insertRow();
      r.innerHTML='<td style="font-weight:500;">'+escH(f)+'</td><td style="text-align:center;">'+v.nb+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+fE(v.uf)+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+fE(v.run)+'</td><td style="text-align:right;color:var(--purple);">'+(v.pf>0?fE(v.pf):'—')+'</td><td style="text-align:right;font-weight:500;">'+fE(ht)+'</td>';
    });
  } else if(commDrillTab==='client'){
    t.innerHTML='<tr><th>Client</th><th>Nb deals</th><th>UF (EUR)</th><th>'+runCol+'</th><th>Perf fees</th><th>Total</th></tr>';
    var by={};
    data.forEach(d=>{
      if(!by[d.client])by[d.client]={nb:0,uf:0,run:0,pf:0};
      by[d.client].nb++;by[d.client].uf+=d.ufE||0;
      by[d.client].run+=getRunProrata(d);
      by[d.client].pf+=(d.pf&&d.pf.amount?d.pf.amount:0);
    });
    Object.entries(by).sort((a,b)=>b[1].uf+b[1].run-(a[1].uf+a[1].run)).forEach(([c,v])=>{
      var ht=v.uf+v.run;var r=t.insertRow();
      r.innerHTML='<td style="font-weight:500;">'+escH(c)+'</td><td style="text-align:center;">'+v.nb+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+fE(v.uf)+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+fE(v.run)+'</td><td style="text-align:right;color:var(--purple);">'+(v.pf>0?fE(v.pf):'—')+'</td><td style="text-align:right;font-weight:500;">'+fE(ht)+'</td>';
    });
  } else {
    t.innerHTML='<tr><th>Date</th><th>Client</th><th>Fournisseur</th><th>Produit</th><th>Nominal</th><th>UF</th><th>'+runCol+'</th><th>Perf fees</th><th>Statut</th></tr>';
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
  var fourn=fourn_db.find(x=>x.name===fournName)||{name:fournName};
  var today=new Date();
  var dateStr='Paris, le '+today.getDate()+' '+['January','February','March','April','May','June','July','August','September','October','November','December'][today.getMonth()]+' '+today.getFullYear();
  var trimLabel=period||'';
  // Invoice number: e.g. TOB-RUN-2026T1-001
  var code=fournName.replace(/[^A-Z0-9]/gi,'').toUpperCase().substring(0,3);
  var invoiceNum=code+'-'+type+'-'+trimLabel.replace(/[^0-9T]/g,'')+'-001';
  var productsDesc=deals_list.map(d=>d.produit).filter((v,i,a)=>a.indexOf(v)===i).join(' / ')||'Management Fees';

  var html=`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @page{margin:15mm 20mm 20mm 20mm;}
  body{font-family:Arial,sans-serif;font-size:11px;color:#222;margin:0;padding:0;}
  .header-bar{background:#1a3a5c;color:white;padding:10px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;}
  .header-bar .company{font-size:16px;font-weight:bold;letter-spacing:1px;}
  .header-bar .invoice-num{font-size:13px;font-weight:bold;}
  .section{margin-bottom:16px;}
  .label{font-weight:bold;font-size:11px;color:#1a3a5c;text-transform:uppercase;margin-bottom:4px;}
  .from-to{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-bottom:20px;}
  .box{border-left:3px solid #1a3a5c;padding-left:10px;}
  .amount-box{background:#f0f4f8;border:1px solid #1a3a5c;padding:12px 18px;margin:20px 0;display:flex;justify-content:space-between;align-items:center;}
  .amount-box .amount{font-size:22px;font-weight:bold;color:#1a3a5c;}
  .amount-box .label2{font-size:11px;color:#555;}
  .detail-table{width:100%;border-collapse:collapse;margin:14px 0;}
  .detail-table th{background:#1a3a5c;color:white;padding:7px 10px;text-align:left;font-size:10px;}
  .detail-table td{padding:6px 10px;border-bottom:1px solid #e0e0e0;font-size:10px;}
  .detail-table tr:last-child td{border-bottom:2px solid #1a3a5c;font-weight:bold;}
  .legal{font-size:9px;color:#555;line-height:1.5;border-top:1px solid #ccc;padding-top:10px;margin-top:16px;}
  .payment{background:#f9f9f9;border:1px solid #ddd;padding:12px 16px;margin-top:14px;}
  .payment .title{font-weight:bold;color:#1a3a5c;margin-bottom:6px;font-size:11px;}
  .footer-bar{background:#1a3a5c;color:white;padding:8px 20px;font-size:9px;text-align:center;margin-top:20px;}
  .exo{font-style:italic;color:#555;font-size:10px;margin-top:6px;}
</style></head><body>

<div class="header-bar">
  <div class="company">CHAMFEUIL CAPITAL</div>
  <div class="invoice-num">INVOICE #${invoiceNum}</div>
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
    <td>${new Intl.NumberFormat('fr-FR').format(Math.round(deals_list.reduce((s,d)=>s+(d.dev==='USD'?d.nom/(d.fx||1):d.nom||0),0)))} EUR</td>
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
  var name=document.getElementById('ctmTemplate').value;
  if(!name)return;
  var existingRows=document.querySelectorAll('#ctmPrelim .step-edit-row').length;
  if(existingRows>0&&!confirm('Remplacer les étapes actuelles par celles du template "'+name+'" ?'))return;
  var rows=templatePrelimCopy(name);
  document.getElementById('ctmPrelim').innerHTML=renderStepEditorRows(rows,{note:false});
}
function ctmLoadDefaults(){
  // Replace (not append) with the Wealins built-in defaults — idempotent
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


