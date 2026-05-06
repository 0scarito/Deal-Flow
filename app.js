// ── SUPABASE CLIENT ───────────────────────────────────────────────────────────
var SUPABASE_URL='https://nlnvnqfuuggtbcqvnxag.supabase.co';
var SUPABASE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sbnZucWZ1dWdndGJjcXZueGFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNjYyMjgsImV4cCI6MjA5MzY0MjIyOH0.DpaQdphDzDkl7_Q1VoUfH9Z3EbAP21rTl0GVkBtnwd0';
var sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);

// JS camelCase <-> DB snake_case mapping for deals
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
  return r;
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
async function sbInsert(table,data){
  var row=table==='deals'?dealToRow(data):Object.assign({},data);
  delete row.id; delete row._id;
  var res=await sb.from(table).insert(row).select();
  if(res.error)throw res.error;
  return (res.data||[]).map(function(r){return{id:r.id,data:table==='deals'?rowToDeal(r):rowToRef(r)};});
}
async function sbUpdate(table,id,data){
  var row=table==='deals'?dealToRow(data):Object.assign({},data);
  delete row.id; delete row._id; delete row.created_at;
  var res=await sb.from(table).update(row).eq('id',id).select();
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

// Domain checklists (Wealins procedures)
var PRELIM=[
  {id:'p1',label:'Contrat Wealins ouvert'},
  {id:'p2',label:'Mandat tripartite établi (Indosuez / Wealins / Chamfeuil)'},
  {id:'p3',label:'Mandat envoyé à Indosuez — rattachement plateforme'},
  {id:'p4',label:'Avis de virement envoyé à Wealins'}
];
var STEPS={
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

function prelimProgress(c){
  if(!c||!c.prelim)return{done:0,total:PRELIM.length,pct:0};
  var done=PRELIM.filter(function(s){return c.prelim[s.id];}).length;
  return{done:done,total:PRELIM.length,pct:Math.round(done/PRELIM.length*100)};
}
function dealClientChecks(d,clientName){
  return (d.wealins_checks&&d.wealins_checks[clientName])||{};
}
function dealClientProgress(d,clientName){
  var steps=STEPS[d.wealins_type]||[];
  if(!steps.length)return{done:0,total:0,pct:0};
  var checks=dealClientChecks(d,clientName);
  var done=steps.filter(function(s){return checks[s.id];}).length;
  return{done:done,total:steps.length,pct:Math.round(done/steps.length*100)};
}
function dealAggregateProgress(d){
  var steps=STEPS[d.wealins_type]||[];
  if(!steps.length||!d.clients||!d.clients.length)return{done:0,total:0,pct:0,clientsDone:0,clientsTotal:0};
  var clientsDone=0,sumDone=0,sumTotal=0;
  d.clients.forEach(function(c){
    var p=dealClientProgress(d,c);
    sumDone+=p.done;sumTotal+=p.total;
    if(p.total>0&&p.done===p.total)clientsDone++;
  });
  return{done:sumDone,total:sumTotal,pct:sumTotal?Math.round(sumDone/sumTotal*100):0,clientsDone:clientsDone,clientsTotal:d.clients.length};
}
function contractIsComplete(c){
  var pp=prelimProgress(c);
  if(pp.done!==pp.total)return false;
  // Look at all deals using this contract
  var dealsForContract=deals.filter(function(d){return (d.contract_ids||[]).includes(c._id);});
  if(!dealsForContract.length)return pp.done===pp.total;
  // Find which client is on this contract within each deal
  return dealsForContract.every(function(d){
    var clientName=null;
    (d.contract_ids||[]).forEach(function(cid,i){if(cid===c._id&&d.clients&&d.clients[i])clientName=d.clients[i];});
    if(!clientName)return true;
    var p=dealClientProgress(d,clientName);
    return p.total>0&&p.done===p.total;
  });
}
function contractStatus(c){
  var pp=prelimProgress(c);
  var dealsForContract=deals.filter(function(d){return (d.contract_ids||[]).includes(c._id);});
  var allEmpty=pp.done===0&&dealsForContract.every(function(d){
    var clientName=null;
    (d.contract_ids||[]).forEach(function(cid,i){if(cid===c._id&&d.clients&&d.clients[i])clientName=d.clients[i];});
    if(!clientName)return true;
    return dealClientProgress(d,clientName).done===0;
  });
  if(allEmpty)return'new';
  if(contractIsComplete(c)&&dealsForContract.length>0)return'done';
  return'in-progress';
}
function contractGlobalPct(c){
  var pp=prelimProgress(c);
  var totalSteps=pp.total,doneSteps=pp.done;
  var dealsForContract=deals.filter(function(d){return (d.contract_ids||[]).includes(c._id);});
  dealsForContract.forEach(function(d){
    var clientName=null;
    (d.contract_ids||[]).forEach(function(cid,i){if(cid===c._id&&d.clients&&d.clients[i])clientName=d.clients[i];});
    if(!clientName)return;
    var p=dealClientProgress(d,clientName);
    totalSteps+=p.total;doneSteps+=p.done;
  });
  return totalSteps?Math.round(doneSteps/totalSteps*100):0;
}
function pendingProcedures(){
  var n=0;
  deals.forEach(function(d){
    if(!d.wealins_type||!d.clients)return;
    d.clients.forEach(function(cn){
      var p=dealClientProgress(d,cn);
      if(p.total>0&&p.done<p.total)n++;
    });
  });
  return n;
}

async function loadContracts(){
  var res=await sb.from('contracts').select('*');
  if(res.error)throw res.error;
  contracts_db=(res.data||[]).map(function(r){return{_id:r.id,client:r.client,num:r.num||'',banque:r.banque||'Indosuez Luxembourg',notes:r.notes||'',prelim:r.prelim||{},created_at:r.created_at};});
}
async function saveContract(c){
  var row={client:c.client,num:c.num||null,banque:c.banque||'Indosuez Luxembourg',notes:c.notes||null,prelim:c.prelim||{}};
  if(c._id){
    var res=await sb.from('contracts').update(row).eq('id',c._id).select();
    if(res.error)throw res.error;
    var existing=contracts_db.find(function(x){return x._id===c._id;});
    if(existing&&res.data&&res.data[0]){Object.assign(existing,{client:res.data[0].client,num:res.data[0].num||'',banque:res.data[0].banque||'',notes:res.data[0].notes||'',prelim:res.data[0].prelim||{}});}
    return existing;
  } else {
    var res=await sb.from('contracts').insert(row).select();
    if(res.error)throw res.error;
    if(res.data&&res.data[0]){
      var nc={_id:res.data[0].id,client:res.data[0].client,num:res.data[0].num||'',banque:res.data[0].banque||'Indosuez Luxembourg',notes:res.data[0].notes||'',prelim:res.data[0].prelim||{},created_at:res.data[0].created_at};
      contracts_db.push(nc);
      return nc;
    }
  }
}
async function deleteContractDB(id){
  var res=await sb.from('contracts').delete().eq('id',id);
  if(res.error)throw res.error;
  contracts_db=contracts_db.filter(function(c){return c._id!==id;});
  // Unlink from deals
  for(var di=0;di<deals.length;di++){
    var d=deals[di];
    if(!d.contract_ids)continue;
    var changed=false;
    d.contract_ids=d.contract_ids.map(function(cid){if(cid===id){changed=true;return null;}return cid;});
    if(changed&&d._id)await sbUpdate('deals',d._id,d);
  }
}
function contractsForClient(clientName){
  return contracts_db.filter(function(c){return c.client===clientName;});
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
async function checkAuth(){
  var res=await sb.auth.getSession();
  var session=res.data&&res.data.session;
  if(session){document.getElementById('loginOverlay').style.display='none';initApp();}
  else{document.getElementById('loadingOverlay').style.display='none';document.getElementById('loginOverlay').style.display='flex';}
}
async function doLogin(){
  var email=document.getElementById('loginEmail').value.trim();
  var pw=document.getElementById('loginPw').value;
  var btn=document.getElementById('loginBtn');
  var err=document.getElementById('loginErr');
  btn.disabled=true;btn.textContent='Connexion…';err.textContent='';
  var res=await sb.auth.signInWithPassword({email:email,password:pw});
  if(res.error){err.textContent=res.error.message||'Email ou mot de passe incorrect.';btn.disabled=false;btn.textContent='Se connecter';}
  else{document.getElementById('loginOverlay').style.display='none';initApp();}
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
function filt(){return curV==='Tous'?deals:deals.filter(d=>d.v===curV);}
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
var CLIENT_DEFAULTS=['OAA','Anthony Ravau','Evelyne Berdugo','Sacha Zerbib','Franck Gary','SBM Lux','SIHPM','LevCap','Matthieu Senra','JackMélo','Eric Billen','David Niddam','COHEN Joachim','TFC','SPN'];
function loadClients(){return clients_db.map(c=>c.name);}
function saveClients(list){/* managed via saveClientDB */}
function buildClientSelect(selected){
  var clients=loadClients().slice().sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
  // Build first client line
  renderClientLines([selected||'']);
}

function clientSelectHTML(selected){
  var clients=loadClients().slice().sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
  return '<option value="">— Choisir —</option>'+clients.map(c=>'<option value="'+c+'"'+(c===selected?' selected':'')+'>'+c+'</option>').join('');
}

var CONTRATS=['Assurance Vie Lux','Contrat Assurance Vie','Contrat de Capitalisation','CTO','PER'];

function contratSelectHTML(selected){
  return CONTRATS.map(function(c){return '<option'+(c===selected?' selected':'')+'>'+c+'</option>';}).join('');
}

function depositaireSelectHTML(selected){
  var items=fourn_db.filter(function(f){return f.famille==='Banque'||f.famille==='Assureur';}).sort(function(a,b){return a.name.localeCompare(b.name);});
  return '<option value="">— Dépositaire —</option>'+items.map(function(f){return '<option'+(f.name===selected?' selected':'')+'>'+f.name+'</option>';}).join('');
}

function wealinsContractSelectHTML(clientName,selectedId){
  var list=clientName?contractsForClient(clientName):[];
  var opts='<option value="">— Aucun —</option>';
  list.forEach(function(c){opts+='<option value="'+c._id+'"'+(c._id===selectedId?' selected':'')+'>'+(c.num||'(sans n°)')+'</option>';});
  opts+='<option value="__new__">+ Créer contrat Wealins…</option>';
  return opts;
}

function renderClientLines(selectedArr, contratsArr, nominalsArr, depositairesArr, wealinsContractIdsArr){
  var container=document.getElementById('clientLines');
  container.innerHTML='';
  (selectedArr||['']).forEach(function(sel,idx){
    var contrat=(contratsArr&&contratsArr[idx])||'Assurance Vie Lux';
    var nominal=(nominalsArr&&nominalsArr[idx])||'';
    var depositaire=(depositairesArr&&depositairesArr[idx])||'';
    var wealinsId=(wealinsContractIdsArr&&wealinsContractIdsArr[idx])||'';
    var removeBtn=idx>0?'<button type="button" class="btn btn-sm" onclick="removeClientLine(this)" style="color:var(--red);border-color:var(--red-bg);flex-shrink:0;">✕</button>':'<span style="width:30px;"></span>';
    var div=document.createElement('div');
    div.style.cssText='display:flex;gap:8px;align-items:center;margin-bottom:8px;';
    div.innerHTML=
      '<select class="mClientSel" style="flex:2;min-width:0;" onchange="onClientLineClientChange(this)">'+clientSelectHTML(sel)+'</select>'+
      '<select class="mContratSel" style="flex:2;min-width:0;">'+contratSelectHTML(contrat)+'</select>'+
      '<select class="mWealinsContractSel" style="flex:2;min-width:0;" onchange="onWealinsContractChange(this)">'+wealinsContractSelectHTML(sel,wealinsId)+'</select>'+
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
    '<select class="mClientSel" style="flex:2;min-width:0;" onchange="onClientLineClientChange(this)">'+clientSelectHTML('')+'</select>'+
    '<select class="mContratSel" style="flex:2;min-width:0;">'+contratSelectHTML('Assurance Vie Lux')+'</select>'+
    '<select class="mWealinsContractSel" style="flex:2;min-width:0;" onchange="onWealinsContractChange(this)">'+wealinsContractSelectHTML('','')+'</select>'+
    '<select class="mDepositaireSel" style="flex:2;min-width:0;">'+depositaireSelectHTML('')+'</select>'+
    '<input type="number" class="mNomSel" placeholder="Nominal" style="flex:1;min-width:80px;max-width:130px;" oninput="calcM()"/>'+
    '<button type="button" class="btn btn-sm" onclick="showAddClientForLine(this)" style="flex-shrink:0;padding:6px 10px;font-size:14px;line-height:1;" title="Nouveau client">+</button>'+
    '<button type="button" class="btn btn-sm" onclick="removeClientLine(this)" style="color:var(--red);border-color:var(--red-bg);flex-shrink:0;">✕</button>';
  container.appendChild(div);
}

function onClientLineClientChange(sel){
  // When client changes, refresh that line's Wealins contract dropdown
  var row=sel.closest('div');
  var wsel=row.querySelector('.mWealinsContractSel');
  if(wsel)wsel.innerHTML=wealinsContractSelectHTML(sel.value,'');
}

function onWealinsContractChange(sel){
  if(sel.value==='__new__'){
    var row=sel.closest('div');
    var clientSel=row.querySelector('.mClientSel');
    var clientName=clientSel?clientSel.value:'';
    if(!clientName){alert('Sélectionnez d\'abord un client.');sel.value='';return;}
    sel.value='';
    window._contractModalCallback=function(saved){
      if(saved&&saved._id){
        sel.innerHTML=wealinsContractSelectHTML(clientName,saved._id);
      }
    };
    openContractModal(null,clientName);
  }
}

function getSelectedClients(){
  var sels=document.querySelectorAll('.mClientSel');
  var contSels=document.querySelectorAll('.mContratSel');
  var wealinsSels=document.querySelectorAll('.mWealinsContractSel');
  var depSels=document.querySelectorAll('.mDepositaireSel');
  var nomSels=document.querySelectorAll('.mNomSel');
  var globalNom=parseFloat(document.getElementById('mNom').value)||0;
  var result=[];
  for(var i=0;i<sels.length;i++){
    if(sels[i].value){
      var lineNom=nomSels[i]?parseFloat(nomSels[i].value)||0:0;
      var wealinsId=wealinsSels[i]?wealinsSels[i].value:'';
      if(wealinsId==='__new__')wealinsId='';
      result.push({
        client:sels[i].value,
        contrat:contSels[i]?contSels[i].value:'Assurance Vie Lux',
        wealinsContractId:wealinsId,
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
  ['synthese','deals','facturation','graphiques','clients','fournisseurs','brokers','contrats','commissions'].forEach(p=>document.getElementById('p-'+p).classList.toggle('on',p===id));
  document.querySelectorAll('.nbtn').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  document.getElementById('pageTitle').textContent={synthese:'Synthèse',deals:'Tous les deals',facturation:'Facturation',graphiques:'Graphiques',clients:'Clients',fournisseurs:'Fournisseurs',brokers:'Brokers',contrats:'Suivi Contrats Wealins',commissions:'Commissions'}[id]||'';
  if(id==='synthese')setTimeout(function(){renderCAChart();},200);
  else if(id==='graphiques')setTimeout(renderCharts,80);
    else if(id==='facturation'){setTimeout(()=>{renderFact();renderUFRappr();renderUFInvTable();},50);}
  else if(id==='deals')renderDeals();
  else if(id==='clients')renderClients();
  else if(id==='fournisseurs')renderFourn();
  else if(id==='brokers')renderBrokers();
  else if(id==='contrats')renderContrats();
  else if(id==='commissions'){initCommPeriod();renderCommissions();}
  else renderAll();
}
function setV(v,btn){curV=v;document.querySelectorAll('.vbtn').forEach(b=>b.classList.remove('on'));btn.classList.add('on');renderAll();}
function onSearch(){var q=document.getElementById('gSearch').value;if(q)goTo('deals',document.querySelectorAll('.nbtn')[1]);document.getElementById('srch').value=q;renderDeals();}
function renderAll(){renderKpis();renderRecent();updateAlertBadge();updateContratsBadge();if(document.getElementById('p-facturation').classList.contains('on'))renderFact();}

function renderKpis(){
  var d=filt();
  var year=String(new Date().getFullYear());

  // UF payés depuis le début de l'année (facture codifiée payée avec date inv)
  var ufPaye=d.filter(x=>(x.ct==='UF'||x.ct==='BOTH')&&x.fSt==='Payé'&&x.inv&&x.inv.startsWith(year));
  var tUFPaye=ufPaye.reduce(function(s,x){return s+(x.ufE||0);},0);

  // Running payés — montants réellement déclarés et payés (Supabase cache)
  var tRunPaye=0,nbFourn=0;
  rapprochement_db.filter(function(r){return r.type==='run'&&r.paid&&r.declared&&r.period&&r.period.endsWith('_'+year);}).forEach(function(r){tRunPaye+=r.declared;nbFourn++;});

  // Perf fees payés (deals fSt=Payé avec pf.amount ou pf.rate, date inv dans l'année)
  var tPF=0;
  d.filter(function(x){return x.fSt==='Payé'&&x.inv&&x.inv.startsWith(year)&&x.pf&&x.pf.mode!=='none';}).forEach(function(x){
    if(x.pf.amount) tPF+=x.pf.amount;
  });

  var ca=tUFPaye+tRunPaye+tPF;

  // KPI grid : 4 encarts si perf fees > 0, sinon 3
  var kpiHtml=
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--rs);padding:16px 20px;">'+
      '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">UF payés '+year+'</div>'+
      '<div style="font-size:24px;font-weight:600;color:var(--text);">'+fE(tUFPaye)+'</div>'+
      '<div style="font-size:12px;color:var(--text2);margin-top:4px;">'+ufPaye.length+' facture'+(ufPaye.length!==1?'s':'')+'</div>'+
    '</div>'+
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--rs);padding:16px 20px;">'+
      '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Running payés '+year+'</div>'+
      '<div style="font-size:24px;font-weight:600;color:var(--text);">'+fE(tRunPaye)+'</div>'+
      '<div style="font-size:12px;color:var(--text2);margin-top:4px;">'+nbFourn+' fournisseur'+(nbFourn!==1?'s':'')+'</div>'+
    '</div>';


  kpiHtml+=
    '<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--rs);padding:16px 20px;">'+
      '<div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Perf fees payés '+year+'</div>'+
      '<div style="font-size:24px;font-weight:600;color:var(--text);">'+fE(tPF)+'</div>'+
      '<div style="font-size:12px;color:var(--text2);margin-top:4px;">commissions performance</div>'+
    '</div>';

  kpiHtml+=
    '<div style="background:var(--blue);border-radius:var(--rs);padding:16px 20px;">'+
      '<div style="font-size:11px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">CA '+year+'</div>'+
      '<div style="font-size:24px;font-weight:600;color:#fff;">'+fE(ca)+'</div>'+
      '<div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:4px;">UF + Running + Perf fees</div>'+
    '</div>';

  // Procédures Wealins en attente (5e KPI quand >0)
  var nPending=pendingProcedures();
  var nbCols=4;
  if(nPending>0){
    nbCols=5;
    kpiHtml+=
      '<div onclick="goTo(\'contrats\',document.querySelectorAll(\'.nbtn\')[7])" style="background:var(--amber-bg);border:1px solid rgba(176,122,16,.3);border-radius:var(--rs);padding:16px 20px;cursor:pointer;">'+
        '<div style="font-size:11px;color:var(--amber);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Procédures Wealins en attente</div>'+
        '<div style="font-size:24px;font-weight:600;color:var(--amber-t);">'+nPending+'</div>'+
        '<div style="font-size:12px;color:var(--amber);margin-top:4px;">checklists incomplètes</div>'+
      '</div>';
  }

  document.getElementById('kpiGrid').style.gridTemplateColumns='repeat('+nbCols+',minmax(0,1fr))';
  document.getElementById('kpiGrid').innerHTML=kpiHtml;
}
function kH(l,c,v,s){return '<div class="kpi'+(c?' '+c:'')+'"><div class="kpi-l">'+l+'</div><div class="kpi-v">'+v+'</div><div class="kpi-s">'+s+'</div></div>';}

function renderRecent(){
  renderSynthPaye();
  renderSynthPipe();
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
  var paye=d.filter(x=>x.fSt==='Payé');
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
  var pipe=d.filter(x=>x.fSt==='À émettre'||x.fSt==='Facturé');
  var totalNom=pipe.reduce((s,x)=>s+(x.dev==='USD'?x.nom/(x.fx||1):x.nom),0);
  var totalUF=pipe.filter(x=>x.ct==='UF'||x.ct==='BOTH').reduce((s,x)=>s+(x.ufE||0),0);
  var totalRun=pipe.filter(x=>x.ct==='RUN'||x.ct==='BOTH').reduce((s,x)=>s+(x.runE||0),0);
  var html=
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">'+
      '<div style="background:var(--surface2);border-radius:var(--rs);padding:12px 14px;">'+
        '<div style="font-size:11px;color:var(--text3);margin-bottom:4px;">Deals en cours</div>'+
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
    html+=recent.map(d=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);" onclick="openDet(deals['+deals.indexOf(d)+'])" style="cursor:pointer;">'+
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
  } else { html+='<div class="empty">Aucun deal en cours.</div>'; }
  document.getElementById('synthPipe').innerHTML=html;
}

function renderSynthFactPaye(){
  var d=filt();
  var year=String(new Date().getFullYear());
  // UF payés tous
  var ufAll=d.filter(x=>(x.ct==='UF'||x.ct==='BOTH')&&x.fSt==='Payé');
  var ufYTD=ufAll.filter(x=>x.inv&&x.inv.startsWith(year));
  // Running: récupérer depuis localStorage
  var allKeys=[];try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.startsWith('recapfact_'))allKeys.push(k);}}catch(e){}
  var runFacts=allKeys.map(k=>{
    try{var data=JSON.parse(localStorage.getItem(k)||'{}');if(!data.paid||!data.declared)return null;
    var parts=k.replace('recapfact_','').split('_');var yr=parts[parts.length-1];var tr=parts[parts.length-2];var fn=parts.slice(0,-2).join('_');
    return{fourn:fn,trim:tr,year:yr,amount:data.declared,paidDate:data.paidDate||''};}catch(e){return null;}
  }).filter(Boolean);
  var runAll=runFacts;
  var runYTD=runFacts.filter(x=>x.year===year);
  var totalUFAll=ufAll.reduce((s,x)=>s+(x.ufE||0),0);
  var totalUFYTD=ufYTD.reduce((s,x)=>s+(x.ufE||0),0);
  var totalRunAll=runAll.reduce((s,x)=>s+x.amount,0);
  var totalRunYTD=runYTD.reduce((s,x)=>s+x.amount,0);
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

function renderDeals(){
  var q=(document.getElementById('srch').value||'').toLowerCase(),ft=document.getElementById('flT').value,ff=document.getElementById('flF').value,fd=document.getElementById('flDev').value,ff2=document.getElementById('flFourn').value;
  var data=filt().filter(d=>{if(ft&&d.ct!==ft)return false;if(ff&&d.fSt!==ff)return false;if(fd&&d.dev!==fd)return false;if(ff2&&d.fourn!==ff2)return false;if(q&&!(d.client.toLowerCase().includes(q)||d.fourn.toLowerCase().includes(q)||(d.produit||'').toLowerCase().includes(q)||(d.isin||'').toLowerCase().includes(q)))return false;return true;});
  data.sort((a,b)=>{var av=a[sCol]||0,bv=b[sCol]||0;return typeof av==='string'?av.localeCompare(bv)*sDir:(av-bv)*sDir;});
  var t=document.getElementById('dealsT');while(t.rows.length>1)t.deleteRow(1);
  document.getElementById('dealsEmpty').style.display=data.length?'none':'block';
  data.forEach(d=>{var r=t.insertRow();r.className='cl';r.onclick=()=>openDet(d);var av='<span class="av av-'+avC(d.v)+'">'+avL(d.v)+'</span>';r.innerHTML='<td class="mono">'+d.date+'</td><td>'+av+'</td><td style="font-weight:500;white-space:nowrap;">'+d.client+'</td><td style="color:var(--text2);font-size:11px;">'+d.contrat+'</td><td>'+d.produit+'</td><td>'+d.fourn+'</td><td style="color:var(--text2);">'+(d.broker||'—')+'</td><td style="text-align:right;" class="mono">'+f0(d.nom)+'</td><td>'+d.dev+'</td><td class="mono" style="font-size:10px;color:var(--text2);">'+(d.isin||'—')+'</td><td class="mono" style="font-size:11px;color:var(--text2);">'+(d.issue||'—')+'</td><td class="mono" style="font-size:11px;color:var(--text2);">'+(d.invS||'—')+'</td><td class="mono" style="font-size:11px;color:var(--text2);">'+(d.inv||'—')+'</td><td>'+tBadge(d.ct)+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+(d.ufE>0?fE(d.ufE):'—')+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+(d.runE>0?fE(d.runE):'—')+'</td><td style="color:var(--text2);">'+(d.tva===0?'Exo':(d.tva*100).toFixed(0)+'%')+'</td><td class="mono" style="font-size:11px;">'+(d.fRef||'—')+'</td><td>'+fBadge(d.fSt)+'</td><td style="font-size:11px;color:var(--text2);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(d.notes||'—')+'</td><td style="display:flex;gap:5px;"><button class="btn btn-sm" onclick="event.stopPropagation();openDealModal('+deals.indexOf(d)+')">Modifier</button><button class="btn btn-sm" style="color:var(--red);border-color:var(--red-bg);" onclick="event.stopPropagation();deleteDeal('+deals.indexOf(d)+')">Supprimer</button></td>';});
  var fourns=[...new Set(filt().map(d=>d.fourn))].sort(),sel=document.getElementById('flFourn'),cv=sel.value;sel.innerHTML='<option value="">Tous fournisseurs</option>';fourns.forEach(f=>{sel.innerHTML+='<option'+(f===cv?' selected':'')+'>'+f+'</option>';});
}
function sBy(c){if(sCol===c)sDir*=-1;else{sCol=c;sDir=-1;}renderDeals();}

var arbSrcDeal=null;

function openDet(d){
  var idx=deals.indexOf(d);
  document.getElementById('detTitle').textContent=d.client+' — '+d.fourn;
  // Wealins status block
  var wealinsBlock='';
  if(d.wealins_type){
    var prog=dealClientProgress(d,d.client);
    var contractId=(d.contract_ids||[])[0];
    var ctr=contractId?contracts_db.find(function(x){return x._id===contractId;}):null;
    var ctrLabel=ctr?(ctr.num||'(sans n°)'):'<span style="color:var(--red);">Aucun contrat rattaché</span>';
    var pillCls=prog.total>0&&prog.done===prog.total?'pill-done':prog.done>0?'pill-prog':'pill-new';
    var pillTxt=prog.total>0&&prog.done===prog.total?'Complet':prog.done>0?'En cours':'Non démarré';
    wealinsBlock=
      '<div style="background:var(--surface2);border-radius:var(--rs);padding:10px 14px;margin-top:12px;border:1px solid var(--border);">'+
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'+
          '<span class="badge '+(WTYPE_BADGE[d.wealins_type]||'bgr')+'">Wealins '+(WTYPE_LBL[d.wealins_type]||d.wealins_type)+'</span>'+
          '<span style="font-size:12px;color:var(--text2);">Contrat: '+ctrLabel+'</span>'+
          '<div style="flex:1;"></div>'+
          '<span class="ctr-pill '+pillCls+'">'+pillTxt+'</span>'+
          '<span style="font-size:12px;font-weight:600;">'+prog.done+'/'+prog.total+'</span>'+
        '</div>'+
      '</div>';
  } else {
    wealinsBlock='<div style="background:var(--surface2);border-radius:var(--rs);padding:8px 14px;margin-top:12px;border:1px dashed var(--border-md);font-size:12px;color:var(--text2);">Aucun suivi Wealins. <a href="#" onclick="event.preventDefault();closeDet();openDealModal('+idx+');" style="color:var(--blue);text-decoration:underline;">Activer dans le deal</a></div>';
  }
  document.getElementById('detBody').innerHTML=
    '<div class="fg2">'+
    '<div><div class="kpi-l">Vendeur</div><div>'+d.v+'</div></div>'+
    '<div><div class="kpi-l">Trade date</div><div>'+d.date+'</div></div>'+
    '<div><div class="kpi-l">Fournisseur</div><div>'+d.fourn+'</div></div>'+
    '<div><div class="kpi-l">Produit</div><div>'+d.produit+'</div></div>'+
    '<div><div class="kpi-l">Nominal</div><div>'+fE(d.nom)+'</div></div>'+
    '<div><div class="kpi-l">Type</div><div>'+d.ct+'</div></div>'+
    (d.ufE>0?'<div><div class="kpi-l">UF</div><div>'+fE(d.ufE)+'</div></div>':'')+
    (d.runE>0?'<div><div class="kpi-l">Running/an</div><div>'+fE(d.runE)+'</div></div>':'')+
    '<div><div class="kpi-l">Statut facture</div><div>'+d.fSt+'</div></div>'+
    '</div>'+wealinsBlock;
  document.getElementById('detHist').innerHTML=(d.hist||[]).slice().reverse().map(function(h){return '<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);"><span style="color:var(--text3);">'+h.ts+'</span> — '+h.a+'</div>';}).join('');
  document.getElementById('detEdit').onclick=function(){closeDet();openDealModal(idx);};
  document.getElementById('detDelete').onclick=async function(){if(confirm('Supprimer ce deal ?')){if(d._id)await sbDelete('deals',d._id);deals.splice(idx,1);closeDet();renderAll();}};
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
  return '<option value="">— Fournisseur —</option>'+fourn_db.map(function(f){return '<option'+(f.name===selected?' selected':'')+'>'+f.name+'</option>';}).join('');
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
    '<input type="number" class="arbTauxSel" placeholder="%" step="0.01" style="min-width:0;" title="Taux UF ou Running (%)"/>'+
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
  document.getElementById('arbProrataText').textContent='Pro-rata Running '+d.fourn+' : '+days+' jours ('+tradeDate+' \u2192 '+arbDate+') = '+fE(prorata)+' \u00e0 facturer';
  document.getElementById('arbProrataInfo').style.display='block';
}

function updateArbSummary(){
  if(arbSrcDeal==null)return;
  var d=deals[arbSrcDeal];
  var total=Array.from(document.querySelectorAll('.arbMontantSel')).reduce(function(s,i){return s+(parseFloat(i.value)||0);},0);
  var solde=d.nom-total;
  document.getElementById('arbTotalArb').textContent=fE(total);
  document.getElementById('arbSolde').textContent=fE(solde);
  document.getElementById('arbSolde').style.color=solde<0?'var(--red)':solde===0?'var(--green)':'var(--text)';
}

async function confirmArbitrage(){
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
  var tradeDate=d.issue||d.date;
  var days=Math.round((new Date(arbDate)-new Date(tradeDate))/(1000*60*60*24));
  var prorataRun=d.runE>0&&days>0?Math.round(d.runE*(totalArb/d.nom)*(days/365)):0;
  // Mettre \u00e0 jour le deal source
  d.nom=d.nom-totalArb;
  d.runE=d.nom>0?Math.round((d.runR/100)*d.nom):0;
  d.arbClosed=d.nom===0;
  d.hist.push({ts:nowS(),a:'Arbitrage de '+fE(totalArb)+' vers '+destinations.map(function(x){return x.fourn;}).join(', ')+' le '+arbDate+' \u2014 Pro-rata Running: '+fE(prorataRun),by:'Syst\u00e8me'});
  if(d._id){var{_id,...upd}=d;await sbUpdate('deals',_id,upd);}
  // Cr\u00e9er les nouveaux deals
  for(var dest of destinations){
    var newDeal={v:d.v,date:arbDate,stat:'Deal r\u00e9alis\u00e9',client:d.client,contrat:dest.contrat,depositaire:dest.depositaire||'',broker:d.broker||'',fourn:dest.fourn,produit:dest.produit||d.produit,isin:d.isin||'',nom:dest.nom,dev:d.dev,fx:d.fx||1,issue:arbDate,invS:'',inv:'',ct:dest.ct||'RUN',ufR:dest.ct==='UF'||dest.ct==='BOTH'?dest.taux:0,runR:dest.ct==='RUN'||dest.ct==='BOTH'?dest.taux:0,tva:0,ufE:dest.ct==='UF'||dest.ct==='BOTH'?Math.round((dest.taux/100)*dest.nom):0,runE:dest.ct==='RUN'||dest.ct==='BOTH'?Math.round((dest.taux/100)*dest.nom):0,pf:dest.ct==='PF'?{mode:'fixed',amount:dest.taux,type:'fixed',freq:'Annuel'}:{mode:'none'},fSt:'\u00c0 \u00e9mettre',fRef:'',notes:'Arbitrage depuis '+d.fourn+' le '+arbDate,arbId:arbId,arbSrc:d._id||'',hist:[{ts:nowS(),a:'Deal cr\u00e9\u00e9 par arbitrage depuis '+d.fourn+' ('+fE(dest.nom)+')',by:'Syst\u00e8me'}]};
    var res=await sbInsert('deals',newDeal);if(res&&res[0])newDeal._id=res[0].id;
    deals.push(newDeal);
  }
  closeArbModal();renderAll();
  toast('Arbitrage enregistr\u00e9 \u2014 '+destinations.length+' nouveau'+(destinations.length>1?'x deals cr\u00e9\u00e9s':' deal cr\u00e9\u00e9')+'. Pro-rata Running '+d.fourn+': '+fE(prorataRun));
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
    var btn=inv.paid?'<span style="font-size:11px;color:var(--green);">✓ Payé le '+inv.paidDate+'</span>':inv.facture?'<button class="btn btn-sm" style="background:var(--green);color:white;border-color:var(--green);" onclick="markRunInvPaid(\''+inv.fourn.replace(/'/g,"\\'")+'\',\''+inv.trim+'\',\''+inv.year+'\')">Marquer payé</button>':'—';
    var delBtn='<button class="btn btn-sm" style="color:var(--red);border-color:var(--red-bg);margin-left:4px;" onclick="deleteRunInv(\''+inv.fourn.replace(/'/g,"\\'")+'\',\''+inv.trim+'\',\''+inv.year+'\')">✕</button>';
    var r=t.insertRow();
    r.innerHTML='<td style="font-weight:500;">'+inv.fourn+'</td>'+
      '<td class="mono">'+inv.trim+' '+inv.year+'</td>'+
      '<td style="text-align:right;">'+fE(inv.theoTrim||0)+'</td>'+
      '<td style="text-align:right;font-weight:500;">'+fE(inv.declared)+'</td>'+
      '<td class="mono" style="color:var(--text2);">'+(inv.factureDate||'—')+'</td>'+
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
      d.fSt='Payé';d.inv=paidDate;
      d.hist.push({ts:nowS(),a:'Facture Running payée — '+trim+' '+year,by:'Système'});
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
  d.fSt='Payé';d.inv=new Date().toISOString().split('T')[0];
  d.hist.push({ts:nowS(),a:'Facture Perf fees payée',by:'Système'});
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
  d.fSt='À émettre';d.invS='';d.inv='';
  d.hist.push({ts:nowS(),a:'Facture UF réinitialisée',by:'Système'});
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
  d.fSt='Payé';
  d.inv=paidDate;
  d.hist.push({ts:nowS(),a:'Facture UF payée',by:'Système'});
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
  var data=filt();
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
  return '<div class="fact-card">'+
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;">'+
      '<div>'+
        '<div style="font-size:11px;color:var(--text3);">'+(d.fRef||'Sans référence')+' · '+d.date+'</div>'+
        '<div style="font-size:14px;font-weight:600;margin-top:1px;">'+d.client+'</div>'+
        '<div style="font-size:11px;color:var(--text2);">'+d.fourn+(d.produit?' · '+d.produit:'')+'</div>'+
        '<div style="margin-top:4px;"><span class="badge bb" style="font-size:9px;">UF</span> <span style="font-size:11px;color:var(--text2);">Trade date : '+(d.issue||'—')+'</span></div>'+
      '</div>'+
      '<div style="display:flex;gap:6px;align-items:center;">'+fBadge(d.fSt)+
        '<button class="btn btn-sm" onclick="cycleFS('+idx+')">Changer statut</button>'+
      '</div>'+
    '</div>'+
    '<div class="fact-det">'+
      '<div><div class="fd-l">HT</div><div class="fd-v">'+fE(ht)+'</div></div>'+

      '<div><div class="fd-l">Total</div><div class="fd-v" style="font-size:15px;">'+fE(ht)+'</div></div>'+
      '<div><div class="fd-l">Invoice sending</div><div class="fd-v">'+(d.invS||'—')+'</div></div>'+
      '<div><div class="fd-l">Invoice payment</div><div class="fd-v">'+(d.inv||'—')+'</div></div>'+
      '<div><div class="fd-l">Vendeur</div><div class="fd-v">'+d.v+'</div></div>'+
    '</div>'+
  '</div>';
}

async function cycleFS(idx){
  var o=['À émettre','Facturé','Payé','Litige'],d=deals[idx],i=o.indexOf(d.fSt),n=o[(i+1)%o.length];
  d.hist.push({ts:nowS(),a:'Statut → '+n,by:d.v});d.fSt=n;
  if(d._id)await sbUpdate('deals',d._id,d);
  renderFact();renderKpis();updateAlertBadge();toast('Statut → '+n);
}
function setFT(t,btn){ftab=t;document.querySelectorAll('#factTabs .stab').forEach(b=>b.classList.remove('on'));btn.classList.add('on');renderFact();}

// ── RUNNING TRIMESTRIEL ───────────────────────────────────────────────────────
function renderAlertes(){}
function updateAlertBadge(){}

function renderCharts(){
  var data=filt();
  var byF={};data.filter(d=>d.ufE>0).forEach(d=>{byF[d.fourn]=(byF[d.fourn]||0)+d.ufE;});
  var uL=Object.keys(byF).sort((a,b)=>byF[b]-byF[a]),uV=uL.map(k=>Math.round(byF[k])),uC=['#1d5fd4','#1a8a4a','#6b4fc4','#b07a10','#c23b3b','#6b6b65','#8b5cf6','#f59e0b','#06b6d4','#ec4899'];
  if(charts.uf)charts.uf.destroy();
  charts.uf=new Chart(document.getElementById('cUF'),{type:'doughnut',data:{labels:uL,datasets:[{data:uV,backgroundColor:uC.slice(0,uL.length),borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+fE(c.raw)}}}}});
  document.getElementById('legUF').innerHTML=uL.map((l,i)=>'<span style="display:flex;align-items:center;gap:3px;"><span style="width:9px;height:9px;border-radius:2px;background:'+uC[i]+';display:inline-block;"></span>'+l+' '+fE(uV[i])+'</span>').join('');
  var byF={};data.filter(d=>d.runE>0).forEach(d=>{byF[d.fourn]=(byF[d.fourn]||0)+d.runE;});
  var rS=Object.entries(byF).sort((a,b)=>a[1]-b[1]),rL=rS.map(e=>e[0]),rV=rS.map(e=>Math.round(e[1]));
  var h=Math.max(200,rL.length*36+60);document.getElementById('cRunW').style.height=h+'px';
  if(charts.run)charts.run.destroy();
  charts.run=new Chart(document.getElementById('cRun'),{type:'bar',data:{labels:rL,datasets:[{data:rV,backgroundColor:'#1a8a4a',borderRadius:4,borderWidth:0}]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fE(c.raw)}}},scales:{x:{ticks:{callback:v=>'€'+f0(v)},grid:{color:'rgba(0,0,0,0.05)'}},y:{grid:{display:false}}}}});
  var byM={};data.forEach(d=>{if(!d.date)return;var m=d.date.substring(0,7);if(!byM[m])byM[m]={uf:0,run:0};byM[m].uf+=d.ufE;byM[m].run+=d.runE;});
  var months=Object.keys(byM).sort();
  if(charts.tl)charts.tl.destroy();
  charts.tl=new Chart(document.getElementById('cTL'),{type:'bar',data:{labels:months,datasets:[{label:'UF',data:months.map(m=>Math.round(byM[m].uf)),backgroundColor:'#1d5fd4',borderRadius:3,borderWidth:0},{label:'Running',data:months.map(m=>Math.round(byM[m].run)),backgroundColor:'#1a8a4a',borderRadius:3,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.dataset.label+': '+fE(c.raw)}}},scales:{x:{stacked:true,grid:{display:false},ticks:{autoSkip:false,maxRotation:45}},y:{stacked:true,ticks:{callback:v=>'€'+f0(v)},grid:{color:'rgba(0,0,0,0.05)'}}}}});
  var bySt={};data.forEach(d=>{bySt[d.fSt]=(bySt[d.fSt]||0)+1;});var stL=Object.keys(bySt),stV=stL.map(k=>bySt[k]),stC={'Payé':'#1a8a4a','Facturé':'#1d5fd4','À émettre':'#b07a10','Litige':'#c23b3b'};
  if(charts.fa)charts.fa.destroy();
  charts.fa=new Chart(document.getElementById('cFact'),{type:'doughnut',data:{labels:stL,datasets:[{data:stV,backgroundColor:stL.map(l=>stC[l]||'#aaa'),borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+c.raw+' deal'+(c.raw>1?'s':'')}}}}});
  document.getElementById('legFact').innerHTML=stL.map((l,i)=>'<span style="display:flex;align-items:center;gap:3px;"><span style="width:9px;height:9px;border-radius:2px;background:'+(stC[l]||'#aaa')+';display:inline-block;"></span>'+l+' ('+stV[i]+')</span>').join('');
  var eur=data.filter(d=>d.dev==='EUR').reduce((s,d)=>s+d.nom,0),usd=data.filter(d=>d.dev==='USD').reduce((s,d)=>s+d.nom,0);
  if(charts.dv)charts.dv.destroy();
  charts.dv=new Chart(document.getElementById('cDev'),{type:'doughnut',data:{labels:['EUR','USD'],datasets:[{data:[Math.round(eur),Math.round(usd)],backgroundColor:['#6b4fc4','#b07a10'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': '+f0(c.raw)}}}}});
  document.getElementById('legDev').innerHTML='<span style="display:flex;align-items:center;gap:3px;"><span style="width:9px;height:9px;border-radius:2px;background:#6b4fc4;display:inline-block;"></span>EUR '+f0(eur)+'</span><span style="display:flex;align-items:center;gap:3px;"><span style="width:9px;height:9px;border-radius:2px;background:#b07a10;display:inline-block;"></span>USD '+f0(usd)+'</span>';
}

function openDealModal(idx){
  editIdx=idx!=null?idx:-1;
  rebuildFournSelect();rebuildBrokerSelect();
  document.getElementById('dmTitle').textContent=editIdx>=0?'Modifier le deal':'Nouveau deal';
  if(editIdx>=0){var d=deals[editIdx];document.getElementById('mV').value=d.v;document.getElementById('mDate').value=d.date;document.getElementById('mStat').value=d.stat;
    var wealinsId=(d.contract_ids&&d.contract_ids[0])||'';
    renderClientLines([d.client],[d.contrat],[d.nom],[d.depositaire||''],[wealinsId]);
    document.getElementById('mContrat').value=d.contrat;document.getElementById('mBroker').value=d.broker||'';document.getElementById('mFourn').value=d.fourn;document.getElementById('mProduit').value=d.produit;document.getElementById('mISIN').value=d.isin||'';document.getElementById('mNom').value=d.nom;document.getElementById('mDev').value=d.dev;document.getElementById('mIssue').value=d.issue||'';document.getElementById('mInvS').value=d.invS||'';document.getElementById('mInv').value=d.inv||'';document.getElementById('mUFR').value=d.ufR;document.getElementById('mRunR').value=d.runR;document.getElementById('mNotes').value=d.notes||'';
    document.getElementById('mWealinsType').value=d.wealins_type||'';
    setCT(d.ct);
    var pf=d.pf||{mode:'none'};pfMode=pf.mode||'none';
    var pfBtn=document.getElementById('ctPF');pfBtn.classList.toggle('on',pfMode!=='none');
    document.getElementById('pfRow').style.display=pfMode!=='none'?'block':'none';
    if(pfMode!=='none'){document.getElementById('mPFType').value=pf.type||'pct';document.getElementById('mPFRate').value=pf.rate||'';document.getElementById('mPFHurdle').value=pf.hurdle||'';document.getElementById('mPFFixed').value=pf.amount||'';document.getElementById('mPFFreq').value=pf.freq||'annuel';onPFTypeChange();}
    onWealinsTypeChange();
  } else {document.getElementById('mDate').value=today();renderClientLines(['']);document.getElementById('mFourn').value='';document.getElementById('mNom').value='';document.getElementById('mUFR').value='';document.getElementById('mRunR').value='';document.getElementById('mISIN').value='';document.getElementById('mBroker').value='';document.getElementById('mProduit').value='';document.getElementById('mNotes').value='';document.getElementById('mPFRate').value='';document.getElementById('mPFHurdle').value='';document.getElementById('mPFFixed').value='';document.getElementById('mInvS').value='';document.getElementById('mWealinsType').value='';document.getElementById('ctPF').classList.remove('on');document.getElementById('pfRow').style.display='none';pfMode='none';cancelAddClient();setCT('UF');onWealinsTypeChange();}
  rebuildFournSelect();rebuildBrokerSelect();
  document.getElementById('dealModal').classList.add('on');calcM();
}

function onWealinsTypeChange(){
  var typ=document.getElementById('mWealinsType').value;
  var box=document.getElementById('mWealinsChecklist');
  var hint=document.getElementById('mWealinsHint');
  if(!typ){box.style.display='none';if(hint)hint.textContent='Sélectionnez un type pour activer la checklist Wealins par client.';return;}
  if(hint)hint.textContent='Type "'+(WTYPE_LBL[typ]||typ)+'" sélectionné — '+(STEPS[typ]||[]).length+' étapes par client.';
  // Render checklist only when editing a single deal (one client)
  if(editIdx<0){box.style.display='none';if(hint)hint.textContent+=' La checklist sera disponible après création.';return;}
  var d=deals[editIdx];
  if(!d){box.style.display='none';return;}
  var clientName=d.client;
  document.getElementById('mWealinsClientLbl').textContent='— '+clientName;
  var checks=(d.wealins_checks&&d.wealins_checks[clientName])||{};
  var stepsForType=STEPS[typ]||[];
  document.getElementById('mWealinsChecksBody').innerHTML=stepsForType.map(function(s){
    var on=!!checks[s.id];
    return '<div class="step-row">'+
      '<div class="chk'+(on?' on':'')+'" data-step="'+s.id+'" onclick="this.classList.toggle(\'on\');this.nextElementSibling.classList.toggle(\'struck\');"></div>'+
      '<span class="step-lbl'+(on?' struck':'')+'">'+escH(s.label)+'</span>'+
      (s.note?'<span class="step-note">'+escH(s.note)+'</span>':'')+
    '</div>';
  }).join('');
  box.style.display='';
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
  var nom=parseFloat(document.getElementById('mNom').value)||0;
  var items=getSelectedClients();
  if(!items.length){alert('Au moins un client requis.');return;}
  if(!items.some(function(x){return x.nom>0;})){alert('Veuillez saisir un nominal pour au moins un client.');return;}
  var dev=document.getElementById('mDev').value,fx=1,nomE=nom;
  var ufP=(parseFloat(document.getElementById('mUFR').value)||0)/100,runP=(parseFloat(document.getElementById('mRunR').value)||0)/100;
  var pf={mode:pfMode};
  if(pfMode!=='none'){var pfType=document.getElementById('mPFType').value;pf.type=pfType;pf.freq=document.getElementById('mPFFreq').value;if(pfType==='pct'){pf.rate=parseFloat(document.getElementById('mPFRate').value)||0;pf.hurdle=parseFloat(document.getElementById('mPFHurdle').value)||0;}else{pf.amount=parseFloat(document.getElementById('mPFFixed').value)||0;}}
  var wealinsType=document.getElementById('mWealinsType').value||null;
  var base={v:document.getElementById('mV').value,date:document.getElementById('mDate').value,stat:document.getElementById('mStat').value,contrat:document.getElementById('mContrat').value,broker:document.getElementById('mBroker').value,fourn:document.getElementById('mFourn').value,produit:document.getElementById('mProduit').value,isin:document.getElementById('mISIN').value,nom,dev,fx,issue:document.getElementById('mIssue').value,invS:document.getElementById('mInvS').value,inv:document.getElementById('mInv').value,ct,ufR:parseFloat(document.getElementById('mUFR').value)||0,runR:parseFloat(document.getElementById('mRunR').value)||0,tva:0,ufE:Math.round(dev==='USD'?(nom*ufP/fx):nom*ufP),runE:Math.round(nomE*runP),pf,fSt:'À émettre',fRef:'',notes:document.getElementById('mNotes').value,wealins_type:wealinsType};
  if(editIdx>=0){
    var cc=getSelectedClients();
    var lineNom=cc.length&&cc[0].nom?cc[0].nom:nom;
    var ufP2=(parseFloat(document.getElementById('mUFR').value)||0)/100;
    var runP2=(parseFloat(document.getElementById('mRunR').value)||0)/100;
    // Read checklist from DOM
    var existing=deals[editIdx];
    var clientName=cc.length?cc[0].client:existing.client;
    var newChecks=Object.assign({},existing.wealins_checks||{});
    if(wealinsType){
      var stepChecks={};
      document.querySelectorAll('#mWealinsChecksBody .chk').forEach(function(el){stepChecks[el.dataset.step]=el.classList.contains('on');});
      newChecks[clientName]=stepChecks;
    }
    var contractIds=cc.length&&cc[0].wealinsContractId?[cc[0].wealinsContractId]:(existing.contract_ids||[]);
    var prevHist=Array.isArray(existing.hist)?existing.hist:[];
    var d={...base,nom:lineNom,ufE:Math.round(lineNom*ufP2),runE:Math.round(lineNom*runP2),client:clientName,contrat:cc.length?cc[0].contrat:base.contrat,contract_ids:contractIds,wealins_checks:newChecks,hist:[...prevHist,{ts:nowS(),a:'Deal modifié',by:base.v}]};
    var _id=existing._id;d._id=_id;if(_id)await sbUpdate('deals',_id,d);deals[editIdx]=d;
    closeDM();renderAll();toast('Deal modifié.');
  } else {
    var ufP3=(parseFloat(document.getElementById('mUFR').value)||0)/100;
    var runP3=(parseFloat(document.getElementById('mRunR').value)||0)/100;
    for(var ii=0;ii<items.length;ii++){
      var item=items[ii];
      var lineNom2=item.nom||nom;
      var contractIdsNew=item.wealinsContractId?[item.wealinsContractId]:[];
      var d={...base,nom:lineNom2,ufE:Math.round(lineNom2*ufP3),runE:Math.round(lineNom2*runP3),client:item.client,contrat:item.contrat,depositaire:item.depositaire||'',contract_ids:contractIdsNew,wealins_checks:{},fSt:'À émettre',hist:[{ts:nowS(),a:'Deal créé',by:base.v}]};
      var res=await sbInsert('deals',d);
      if(res&&res[0])d._id=res[0].id;
      deals.push(d);
    }
    closeDM();renderAll();toast(items.length>1?items.length+' deals enregistrés.':'Nouveau deal enregistré.');
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
  var reader=new FileReader();
  reader.onload=async function(ev){
    var lines=ev.target.result.split('\n').filter(function(l){return l.trim();}),imp=0;
    for(var li=1;li<lines.length;li++){
      var c=lines[li].split(',');if(c.length<10)continue;
      // Column order: 0=Vendeur,1=Date,2=Client,3=Contrat,4=Fournisseur,5=Broker,6=Produit,7=ISIN,
      // 8=Nominal,9=Devise,10=FX,11=Issue,12=End,13=Type,14=UF%,15=Run%,16=UF EUR,17=Run EUR,
      // 18=Statut,19=Ref,20=Invoice,21=Notes
      var d={v:c[0]||'Audrey',date:c[1]||today(),stat:'Deal réalisé',client:c[2]||'',contrat:c[3]||'',fourn:c[4]||'',broker:c[5]||'',produit:c[6]||'',isin:c[7]||'',nom:parseFloat(c[8])||0,dev:c[9]||'EUR',fx:parseFloat(c[10])||1,issue:c[11]||'',end:c[12]||'',ct:c[13]||'UF',ufR:parseFloat(c[14])||0,runR:parseFloat(c[15])||0,ufE:parseFloat(c[16])||0,runE:parseFloat(c[17])||0,tva:0,fSt:c[18]||'À émettre',fRef:c[19]||'',inv:c[20]||'',notes:c[21]||'',hist:[{ts:nowS(),a:'Importé depuis CSV',by:'Import'}]};
      var res=await sbInsert('deals',d);
      if(res&&res[0])d._id=res[0].id;
      deals.push(d);imp++;
    }
    alert(imp+' deal(s) importé(s).');renderAll();e.target.value='';
  };
  reader.readAsText(file);
}

// ── CLIENTS ──────────────────────────────────────────────────────────────────
var clientTab='ALL';
function loadClientDB(){return clients_db;}
function saveClientDB(db){/* async handled in saveClient */}
function buildDefaultClientDB(){
  var pp=['OAA','Anthony Ravau','Evelyne Berdugo','Sacha Zerbib','Franck Gary','Matthieu Senra','JackMélo','Eric Billen','David Niddam','COHEN Joachim'];
  var pm=['SBM Lux','SIHPM','LevCap','TFC','SPN'];
  var db=[...pp.map(n=>({name:n,type:'PP',vendeur:'',email:'',notes:''})),...pm.map(n=>({name:n,type:'PM',vendeur:'',email:'',notes:''}))];
  return db;
}
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
    r.innerHTML='<td style="font-weight:500;cursor:pointer;" title="Double-cliquer pour modifier" ondblclick="openAddClientModal(\''+c.name.replace(/'/g,"\\'")+'\')">'+c.name+'</td><td>'+typeBadge+'</td><td style="color:var(--text2);">'+(c.vendeur||'—')+'</td><td style="text-align:center;">'+nbD+'</td><td style="text-align:right;" class="mono">'+(totalNom>0?fE(totalNom):'—')+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+(totalUF>0?fE(totalUF):'—')+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+(totalRun>0?fE(totalRun):'—')+'</td><td class="mono" style="color:var(--text2);">'+lastDate+'</td>';
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
    document.getElementById('cNotes').value=c.notes||'';
  } else {
    document.getElementById('cType').value='PP';
    document.getElementById('cVendeur').value='';
    document.getElementById('cEmail').value='';
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
      Object.entries(byContrat).forEach(function([contrat,cDeals]){
        html+='<div style="margin-bottom:12px;">'+
          '<div style="font-size:11px;font-weight:600;color:var(--text2);background:var(--surface2);padding:4px 10px;border-radius:4px;margin-bottom:6px;">'+contrat+'</div>'+
          cDeals.map(function(d){
            var statut=d.fSt==='Payé'?'<span class="badge bg">Payé</span>':d.fSt==='Facturé'?'<span class="badge bb">Facturé</span>':'<span class="badge ba">À émettre</span>';
            var montant=d.ct==='UF'?fE(d.ufE)+' UF':d.ct==='RUN'?fE(d.runE)+'/an':fE(d.ufE)+' UF + '+fE(d.runE)+'/an';
            return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:4px;">'+
              '<div>'+
                '<span style="font-weight:500;font-size:13px;">'+d.fourn+'</span>'+
                '<span style="color:var(--text2);font-size:12px;margin-left:8px;">'+d.produit+'</span>'+
              '</div>'+
              '<div style="display:flex;gap:12px;align-items:center;">'+
                (d.depositaire?'<span style="font-size:12px;color:var(--text3);font-style:italic;">'+d.depositaire+'</span>':'') +
                '<span style="font-size:12px;color:var(--blue);font-weight:500;">'+fE(d.nom)+' '+d.dev+'</span>'+
              '</div>'+
            '</div>';
          }).join('')+
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
  // Historique des opérations
  var histSection=document.getElementById('clientHistSection');
  var histLines=document.getElementById('clientHistLines');
  if(name){
    var allDeals=deals.filter(function(d){return d.client===name;}).sort(function(a,b){return b.date.localeCompare(a.date);});
    if(allDeals.length){
      histSection.style.display='block';
      var html='<div style="border-left:2px solid var(--border);padding-left:12px;">';
      allDeals.forEach(function(d){
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
              '<span style="font-size:11px;color:var(--text3);">'+d.date+'</span>'+
              '<span style="font-size:11px;color:var(--text3);margin-left:6px;">'+label+'</span>'+
              '<div style="font-weight:500;margin-top:2px;">'+d.fourn+' — '+d.produit+'</div>'+
              (d.notes&&d.notes!=='Deal test'?'<div style="font-size:11px;color:var(--text3);margin-top:1px;font-style:italic;">'+d.notes+'</div>':'')+
            '</div>'+
            '<div style="text-align:right;flex-shrink:0;margin-left:12px;">'+
              typeBadge+
              '<div style="font-size:12px;color:var(--blue);font-weight:500;margin-top:3px;">'+fE(d.nom)+' '+d.dev+'</div>'+
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
async function deleteDeal(idx){
  if(idx<0||idx>=deals.length)return;
  var d=deals[idx];
  if(!confirm('Supprimer le deal "'+d.client+' — '+d.produit+'" ? Cette action est irréversible.'))return;
  if(d._id)await sbDelete('deals',d._id);
  deals.splice(idx,1);
  renderAll();toast('Deal supprimé.');
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
    // Migrate wealins_checks keyed by old client name
    for(var dj=0;dj<deals.length;dj++){
      var ddd=deals[dj];
      if(ddd.wealins_checks&&ddd.wealins_checks[original]){
        ddd.wealins_checks[name]=ddd.wealins_checks[original];
        delete ddd.wealins_checks[original];
        if(ddd._id)await sbUpdate('deals',ddd._id,ddd);
      }
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
  renderFourn();
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
    r.innerHTML='<td style="font-weight:500;cursor:pointer;" title="Double-cliquer pour modifier" ondblclick="openFournModal(\''+f.name.replace(/'/g,"\\'")+'\')">'+f.name+'</td><td><span class="badge '+bc+'">'+bl+'</span></td><td style="text-align:center;">'+nb+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+(tUF>0?fE(tUF):'—')+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+(tRun>0?fE(tRun):'—')+'</td><td class="mono" style="color:var(--text2);">'+last+'</td>';
  });
  rebuildFournSelect();
}
function rebuildFournSelect(){
  var list=loadFourn().slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
  var sel=document.getElementById('mFourn');
  if(!sel)return;
  var cur=sel.value;
  sel.innerHTML='<option value="">— Choisir —</option>';
  var families=['SDG','Banque','Assureur'];
  var labels={'SDG':'Sociétés de gestion','Banque':'Banques','Assureur':'Assureurs'};
  families.forEach(fam=>{
    var items=list.filter(f=>f.famille===fam);
    if(!items.length)return;
    sel.innerHTML+='<optgroup label="'+labels[fam]+'">'+items.map(f=>'<option'+(f.name===cur?' selected':'')+'>'+f.name+'</option>').join('')+'</optgroup>';
  });
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
    r.innerHTML='<td style="font-weight:500;cursor:pointer;" title="Double-cliquer pour modifier" ondblclick="openBrokerModal(\''+b.replace(/'/g,"\\'")+'\')" >'+b+'</td><td style="text-align:center;">'+nb+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+(tUF>0?fE(tUF):'—')+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+(tRun>0?fE(tRun):'—')+'</td><td class="mono" style="color:var(--text2);">'+last+'</td>';
  });
  rebuildBrokerSelect();
}
function rebuildBrokerSelect(){
  var list=brokers_db.slice().sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'})).map(b=>b.name);
  var sel=document.getElementById('mBroker');
  if(!sel)return;
  var cur=sel.value;
  sel.innerHTML='<option value="">— Aucun —</option>'+list.map(b=>'<option'+(b===cur?' selected':'')+'>'+b+'</option>').join('');
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
  // Uniquement les factures codifiées Payé, filtrées sur la date de paiement (inv)
  return deals.filter(d=>{
    if(d.fSt!=='Payé')return false;
    return matchPeriod(d.inv,year,month,trim);
  });
}

function getPeriodLabel(){
  var year=document.getElementById('commYear').value;
  if(commPeriod==='annee')return 'Année '+year;
  if(commPeriod==='mois'){var mns=['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];return mns[(parseInt(document.getElementById('commMonth').value)||1)-1]+' '+year;}
  if(commPeriod==='trimestre')return 'T'+document.getElementById('commTrim').value+' '+year;
  return '';
}

function commSummary(data){
  function splitFactor(d){return d.v==='Audrey & David'?0.5:1;}

  // UF : somme des ufE des deals de ce vendeur (split 50% si deal commun)
  var uf=0;
  for(var i=0;i<data.length;i++) uf+=(data[i].ufE||0)*splitFactor(data[i]);

  // Running : pour chaque fournisseur présent dans data,
  // chercher la facture payée dans localStorage et attribuer la part
  var run=0;
  var year='';
  try{var el=document.getElementById('commYear');if(el)year=el.value;}catch(e){}

  // Fournisseurs distincts dans les deals Running de data
  var fourns={};
  for(var di=0;di<data.length;di++){
    var d=data[di];
    if(d.ct!=='RUN'&&d.ct!=='BOTH') continue;
    if(!fourns[d.fourn]) fourns[d.fourn]=[];
    fourns[d.fourn].push(d);
  }

  // Pour chaque fournisseur, trouver toutes les factures payées
  for(var fourn in fourns){
    var vendeurDeals=fourns[fourn];
    // Tous les deals Running Payés chez ce fournisseur (tous vendeurs)
    var allDeals=deals.filter(function(x){
      return (x.ct==='RUN'||x.ct==='BOTH')&&x.fourn===fourn&&x.fSt==='Pay\xe9';
    });
    var allRunE=allDeals.reduce(function(s,x){return s+(x.runE||0);},0);
    if(!allRunE) continue;

    // Part runE du vendeur avec split
    var vendeurRunE=vendeurDeals.reduce(function(s,x){return s+(x.runE||0)*splitFactor(x);},0);
    var share=vendeurRunE/allRunE;

    rapprochement_db.filter(function(r){
      return r.type==='run'&&r.fourn===fourn&&r.paid&&r.declared&&(!year||(r.period&&r.period.endsWith('_'+year)));
    }).forEach(function(r){run+=r.declared*share;});
  }

  var pf=0;
  for(var pi=0;pi<data.length;pi++){
    var pd=data[pi];
    if(pd.pf&&pd.pf.mode!=='none'&&pd.pf.amount) pf+=pd.pf.amount*splitFactor(pd);
  }
  return {nb:data.length,uf:uf,run:run,pf:pf};
}

function renderCommissions(){
  if(!document.getElementById('commYear').value)initCommPeriod();
  var allData=getCommDeals();
  document.getElementById('commPeriodLabel').textContent=getPeriodLabel();
  closeCommDrill();

  var s=commSummary(allData);
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
    var vs=commSummary(vData);
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
  document.getElementById('commDrillTitle').innerHTML='← <strong>'+vendeur+'</strong> — Détail · '+getPeriodLabel();
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

function getRunProrata(d){
  if(!d.runE||d.runE===0)return 0;
  if(!d.invS||!d.inv)return 0;
  var invYear=d.invS.substring(0,4);
  var invMonth=parseInt(d.invS.substring(5,7));
  var invTrim=Math.ceil(invMonth/3);
  var key='recapfact_'+d.fourn+'_T'+invTrim+'_'+invYear;
  try{
    var saved=JSON.parse(localStorage.getItem(key)||'null');
    if(saved&&saved.paid&&saved.declared!=null){
      // Proportional share based on runE
      var allDealsForTrim=deals.filter(x=>(x.ct==='RUN'||x.ct==='BOTH')&&x.fourn===d.fourn&&x.invS===d.invS&&x.fSt==='Payé');
      var totalRunE=allDealsForTrim.reduce((s,x)=>s+(x.runE||0),0);
      return totalRunE>0?saved.declared*(d.runE/totalRunE):0;
    }
  }catch(e){}
  return 0;
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
      r.innerHTML='<td style="font-weight:500;">'+f+'</td><td style="text-align:center;">'+v.nb+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+fE(v.uf)+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+fE(v.run)+'</td><td style="text-align:right;color:var(--purple);">'+(v.pf>0?fE(v.pf):'—')+'</td><td style="text-align:right;font-weight:500;">'+fE(ht)+'</td>';
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
      r.innerHTML='<td style="font-weight:500;">'+c+'</td><td style="text-align:center;">'+v.nb+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+fE(v.uf)+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+fE(v.run)+'</td><td style="text-align:right;color:var(--purple);">'+(v.pf>0?fE(v.pf):'—')+'</td><td style="text-align:right;font-weight:500;">'+fE(ht)+'</td>';
    });
  } else {
    t.innerHTML='<tr><th>Date</th><th>Client</th><th>Fournisseur</th><th>Produit</th><th>Nominal</th><th>UF</th><th>'+runCol+'</th><th>Perf fees</th><th>Statut</th></tr>';
    data.sort((a,b)=>b.date.localeCompare(a.date)).forEach(d=>{
      var r=t.insertRow();r.className='cl';r.onclick=()=>openDet(d);
      var pf=d.pf&&d.pf.mode!=='none'&&d.pf.amount?fE(d.pf.amount):(d.pf&&d.pf.mode==='pct'&&d.pf.rate?d.pf.rate+'%':'—');
      var runP=getRunProrata(d);
      r.innerHTML='<td class="mono">'+d.date+'</td><td style="font-weight:500;">'+d.client+'</td><td>'+d.fourn+'</td><td style="color:var(--text2);">'+d.produit+'</td><td class="mono" style="text-align:right;">'+f0(d.nom)+' '+d.dev+'</td><td style="text-align:right;color:var(--blue);font-weight:500;">'+(d.ufE>0?fE(d.ufE):'—')+'</td><td style="text-align:right;color:var(--green);font-weight:500;">'+(runP>0?fE(runP):'—')+'</td><td style="text-align:right;color:var(--purple);">'+pf+'</td><td>'+fBadge(d.fSt)+'</td>';
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
var ctrExp={};      // contract id → bool (expanded)
var ctrDealExp={};  // contractId|dealId → bool (deal expanded inside contract)
var ctrFilters={};  // search params

function escH(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

function renderContrats(){
  var search=(document.getElementById('ctSearch')?document.getElementById('ctSearch').value:'').toLowerCase();
  var stat=document.getElementById('ctStat')?document.getElementById('ctStat').value:'';
  var sort=document.getElementById('ctSort')?document.getElementById('ctSort').value:'recent';
  var list=contracts_db.slice();
  if(search){
    list=list.filter(function(c){
      var hay=(c.client+' '+c.num+' '+c.notes).toLowerCase();
      if(hay.indexOf(search)!==-1)return true;
      // also match deal product/isin under this contract
      var ds=deals.filter(function(d){return (d.contract_ids||[]).includes(c._id);});
      return ds.some(function(d){return ((d.produit||'')+' '+(d.isin||'')).toLowerCase().indexOf(search)!==-1;});
    });
  }
  if(stat)list=list.filter(function(c){return contractStatus(c)===stat;});
  if(sort==='name')list.sort(function(a,b){return a.client.localeCompare(b.client);});
  else if(sort==='progress')list.sort(function(a,b){return contractGlobalPct(b)-contractGlobalPct(a);});
  else list.sort(function(a,b){return new Date(b.created_at||0)-new Date(a.created_at||0);});

  // Unlinked deals banner (deals with no contract_ids and that have at least one client)
  var unlinkedDeals=deals.filter(function(d){return !d.contract_ids||d.contract_ids.every(function(x){return !x;});}).filter(function(d){return d.clients&&d.clients.length;});
  var bannerHTML='';
  if(unlinkedDeals.length){
    bannerHTML='<div class="unlinked-banner"><span>⚠</span><span><b>'+unlinkedDeals.length+' deal'+(unlinkedDeals.length>1?'s':'')+'</b> sans contrat rattaché. Cliquez sur un deal pour le rattacher à un contrat Wealins.</span><div style="flex:1;"></div><button class="btn btn-sm" onclick="goTo(\'deals\',document.querySelectorAll(\'.nbtn\')[1])">Voir les deals</button></div>';
  }

  var container=document.getElementById('contratsList');
  if(!list.length){
    container.innerHTML=bannerHTML;
    document.getElementById('contratsEmpty').style.display=bannerHTML?'none':'block';
    return;
  }
  document.getElementById('contratsEmpty').style.display='none';

  container.innerHTML=bannerHTML+list.map(function(c){
    var st=contractStatus(c);
    var pct=contractGlobalPct(c);
    var pp=prelimProgress(c);
    var dealsForC=deals.filter(function(d){return (d.contract_ids||[]).includes(c._id);});
    var stLbl=st==='done'?'Complété':st==='in-progress'?'En cours':'Non démarré';
    var stCls=st==='done'?'pill-done':st==='in-progress'?'pill-prog':'pill-new';
    var open=ctrExp[c._id];
    var prelimHTML=PRELIM.map(function(s){
      var on=!!c.prelim[s.id];
      return '<div class="step-row">'+
        '<div class="chk'+(on?' on':'')+'" onclick="togglePrelim(\''+c._id+'\',\''+s.id+'\')"></div>'+
        '<span class="step-lbl'+(on?' struck':'')+'">'+escH(s.label)+'</span>'+
      '</div>';
    }).join('');

    var dealsHTML=dealsForC.length?dealsForC.map(function(d){
      // Find which client(s) are on this contract within this deal
      var clientsOnContract=[];
      (d.contract_ids||[]).forEach(function(cid,i){if(cid===c._id&&d.clients&&d.clients[i])clientsOnContract.push(d.clients[i]);});
      if(!clientsOnContract.length)return'';
      var dKey=c._id+'|'+(d._id||deals.indexOf(d));
      var dOpen=ctrDealExp[dKey];
      var typ=d.wealins_type||'';
      var typeBadge=typ?'<span class="badge '+(WTYPE_BADGE[typ]||'bgr')+'">'+WTYPE_LBL[typ]+'</span>':'<span class="badge bgr">Type Wealins ?</span>';
      var ag=dealAggregateProgress(d);
      var stepsForType=STEPS[typ]||[];
      var checksHTML=clientsOnContract.map(function(cn){
        var prog=dealClientProgress(d,cn);
        var checks=dealClientChecks(d,cn);
        if(!stepsForType.length)return'<div style="font-size:11px;color:var(--text3);padding:6px 0;">Sélectionnez un type Wealins (Structuré / UCITS / Alternatif) sur ce deal pour afficher la checklist.</div>';
        return '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border);">'+
          '<div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:6px;">'+escH(cn)+' <span style="color:var(--text3);font-weight:400;">— '+prog.done+'/'+prog.total+'</span></div>'+
          stepsForType.map(function(s){
            var on=!!checks[s.id];
            return '<div class="step-row">'+
              '<div class="chk'+(on?' on':'')+'" onclick="toggleDealCheck(\''+(d._id||'')+'\',\''+escH(cn).replace(/\\\\/g,'\\\\\\\\').replace(/\\'/g,"\\\\\\'")+'\',\''+s.id+'\')"></div>'+
              '<span class="step-lbl'+(on?' struck':'')+'">'+escH(s.label)+'</span>'+
              (s.note?'<span class="step-note">'+escH(s.note)+'</span>':'')+
            '</div>';
          }).join('')+
        '</div>';
      }).join('');
      return '<div class="ctr-deal-card">'+
        '<div class="ctr-deal-hd" onclick="toggleCtrDeal(\''+dKey+'\')">'+
          typeBadge+
          '<span style="font-size:12px;font-weight:600;flex:1;min-width:120px;">'+escH(d.produit||'(sans nom)')+'</span>'+
          (d.isin?'<span class="mono" style="font-size:11px;color:var(--text2);background:var(--surface);padding:2px 6px;border-radius:4px;">'+escH(d.isin)+'</span>':'')+
          '<span style="font-size:11px;color:var(--text2);">'+escH(d.fourn||'')+'</span>'+
          '<span style="font-size:11px;font-weight:600;color:var(--text);">'+ag.pct+'%</span>'+
          '<span class="chev'+(dOpen?' open':'')+'">▾</span>'+
        '</div>'+
        (dOpen?checksHTML:'')+
      '</div>';
    }).join(''):'<div style="font-size:12px;color:var(--text3);padding:8px 0;">Aucun deal rattaché à ce contrat. Créez un deal et sélectionnez ce contrat dans la ligne client.</div>';

    return '<div class="ctr-card '+st+'">'+
      '<div class="ctr-hd" onclick="toggleCtr(\''+c._id+'\')">'+
        '<div class="av av-a">'+escH((c.client||'?').slice(0,2).toUpperCase())+'</div>'+
        '<div class="ctr-info">'+
          '<div class="ctr-name">'+escH(c.client)+'</div>'+
          '<div class="ctr-meta">'+
            '<span>#'+escH(c.num||'—')+'</span>'+
            '<span>'+escH(c.banque||'')+'</span>'+
            '<span>'+dealsForC.length+' deal'+(dealsForC.length!==1?'s':'')+'</span>'+
          '</div>'+
        '</div>'+
        '<div class="ctr-right">'+
          '<span class="ctr-pill '+stCls+'">'+stLbl+'</span>'+
          '<span class="ctr-pct">'+pct+'%</span>'+
          '<button class="btn btn-sm" onclick="event.stopPropagation();openContractModal(\''+c._id+'\')">Modifier</button>'+
          '<span class="chev'+(open?' open':'')+'">▾</span>'+
        '</div>'+
      '</div>'+
      '<div class="ctr-bar"><div class="ctr-bar-fill'+(pct===100?' full':'')+'" style="width:'+pct+'%;"></div></div>'+
      (open?'<div class="ctr-body">'+
        (c.notes?'<div style="font-size:12px;color:var(--text2);font-style:italic;margin-top:10px;padding:8px 10px;background:var(--amber-bg);border-radius:var(--rs);border-left:3px solid var(--amber);">'+escH(c.notes)+'</div>':'')+
        '<div class="ctr-section-title">Étapes préliminaires <span class="ctr-section-count">'+pp.done+'/'+pp.total+'</span></div>'+
        prelimHTML+
        '<div class="ctr-section-title">Deals rattachés <span class="ctr-section-count">'+dealsForC.length+'</span></div>'+
        dealsHTML+
      '</div>':'')+
    '</div>';
  }).join('');
}

function toggleCtr(id){ctrExp[id]=!ctrExp[id];renderContrats();}
function toggleCtrDeal(key){ctrDealExp[key]=!ctrDealExp[key];renderContrats();}

async function togglePrelim(contractId,stepId){
  var c=contracts_db.find(function(x){return x._id===contractId;});
  if(!c)return;
  c.prelim=c.prelim||{};
  c.prelim[stepId]=!c.prelim[stepId];
  try{await saveContract(c);}catch(e){console.error(e);toast('Erreur sauvegarde');return;}
  renderContrats();
  updateContratsBadge();
}

async function toggleDealCheck(dealId,clientName,stepId){
  if(!dealId){toast('Deal non synchronisé.');return;}
  var d=deals.find(function(x){return x._id===dealId;});
  if(!d)return;
  d.wealins_checks=d.wealins_checks||{};
  d.wealins_checks[clientName]=d.wealins_checks[clientName]||{};
  d.wealins_checks[clientName][stepId]=!d.wealins_checks[clientName][stepId];
  try{await sbUpdate('deals',d._id,d);}catch(e){console.error(e);toast('Erreur sauvegarde');return;}
  renderContrats();
  updateContratsBadge();
}

function updateContratsBadge(){
  var badge=document.getElementById('contratsBadge');
  if(!badge)return;
  var n=pendingProcedures();
  if(n>0){badge.textContent=n;badge.style.display='';}
  else{badge.style.display='none';}
}

// ── CONTRACT MODAL ───────────────────────────────────────────────────────────
function openContractModal(contractId,prefillClient){
  var c=contractId?contracts_db.find(function(x){return x._id===contractId;}):null;
  document.getElementById('contractModalTitle').textContent=c?'Modifier le contrat Wealins':'Nouveau contrat Wealins';
  document.getElementById('ctmId').value=c?c._id:'';
  // Build client select
  var sel=document.getElementById('ctmClient');
  var clients=clients_db.map(function(x){return x.name;}).sort(function(a,b){return a.localeCompare(b);});
  var picked=c?c.client:(prefillClient||'');
  sel.innerHTML='<option value="">— Choisir —</option>'+clients.map(function(n){return '<option'+(n===picked?' selected':'')+'>'+n+'</option>';}).join('');
  document.getElementById('ctmNum').value=c?c.num:'';
  document.getElementById('ctmBanque').value=c?c.banque:'Indosuez Luxembourg';
  document.getElementById('ctmNotes').value=c?(c.notes||''):'';
  // Render prelim checklist
  var prelim=c?(c.prelim||{}):{};
  document.getElementById('ctmPrelim').innerHTML=PRELIM.map(function(s){
    var on=!!prelim[s.id];
    return '<div class="step-row">'+
      '<div class="chk'+(on?' on':'')+'" onclick="this.classList.toggle(\'on\');this.nextElementSibling.classList.toggle(\'struck\');" data-step="'+s.id+'"></div>'+
      '<span class="step-lbl'+(on?' struck':'')+'">'+escH(s.label)+'</span>'+
    '</div>';
  }).join('');
  document.getElementById('ctmDeleteBtn').style.display=c?'':'none';
  document.getElementById('contractModal').classList.add('on');
}
function closeContractModal(){document.getElementById('contractModal').classList.remove('on');}

async function saveContractFromModal(){
  var id=document.getElementById('ctmId').value;
  var client=document.getElementById('ctmClient').value;
  var num=document.getElementById('ctmNum').value.trim();
  var banque=document.getElementById('ctmBanque').value.trim()||'Indosuez Luxembourg';
  var notes=document.getElementById('ctmNotes').value.trim();
  if(!client){alert('Sélectionnez un client.');return;}
  // Read prelim from DOM checks
  var prelim={};
  document.querySelectorAll('#ctmPrelim .chk').forEach(function(el){prelim[el.dataset.step]=el.classList.contains('on');});
  var c={_id:id||null,client:client,num:num,banque:banque,notes:notes,prelim:prelim};
  try{
    var saved=await saveContract(c);
    closeContractModal();
    renderContrats();
    updateContratsBadge();
    toast(id?'Contrat mis à jour.':'Contrat créé.');
    if(window._contractModalCallback){var cb=window._contractModalCallback;window._contractModalCallback=null;cb(saved);}
  }catch(e){console.error(e);alert('Erreur: '+(e.message||e));}
}

async function deleteContractFromModal(){
  var id=document.getElementById('ctmId').value;
  if(!id)return;
  if(!confirm('Supprimer ce contrat ? Les deals rattachés seront détachés.'))return;
  try{
    await deleteContractDB(id);
    closeContractModal();
    renderContrats();
    updateContratsBadge();
    toast('Contrat supprimé.');
  }catch(e){console.error(e);alert('Erreur: '+(e.message||e));}
}

async function initApp(){
  document.getElementById('loadingOverlay').style.display='flex';
  try{
    var results=await Promise.all([
      sbGetAll('deals'),
      sbGetAll('clients'),
      sbGetAll('fournisseurs'),
      sbGetAll('brokers'),
      sb.from('rapprochement').select('*'),
      sb.from('contracts').select('*')
    ]);
    deals=results[0]||[];
    clients_db=results[1]||[];
    fourn_db=results[2]||[];
    brokers_db=results[3]||[];
    rapprochement_db=((results[4].data)||[]).map(rapprRowToObj);
    contracts_db=((results[5].data)||[]).map(function(r){return{_id:r.id,client:r.client,num:r.num||'',banque:r.banque||'Indosuez Luxembourg',notes:r.notes||'',prelim:r.prelim||{},created_at:r.created_at};});
    if(!fourn_db.length)await seedFournisseurs();
    else await mergeFournDefaults();
    if(!brokers_db.length)await seedBrokers();
  }catch(e){console.error('Init error',e);}
  document.getElementById('loadingOverlay').style.display='none';
  renderAll();rebuildFournSelect();rebuildBrokerSelect();
}

checkAuth();


