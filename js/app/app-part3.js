
// =================== IMPORT BANCAIRE ===================
// ⑦.6 — LE STAGING DE MOUVEMENTS DE LA PAGE « IMPORT » A DISPARU, SANS RIEN LAISSER.
// Les mouvements passent uniquement par l'import bancaire (bouton « Importer un relevé »
// de la page Loyers & Mouvements) : deux portes d'entrée pour la même donnée, c'étaient
// deux lectures de fichier, deux applications des règles et deux jeux de bugs.
// `_stagingData`, `handleImport`, `importXLSXBank`, `renderStaging`, `validateImport`
// et leurs satellites sont supprimés. L'import RÉFÉRENTIEL (logements, baux, entités)
// ci-dessous reste : c'est un autre sujet, listé comme chantier séparé dans le CDC.


// =================== IMPORT RÉFÉRENTIEL (Item 18) ===================

function genImportTemplate() {
  if(typeof XLSX==='undefined'){ showToast('SheetJS non chargé','err'); return; }
  const wb = XLSX.utils.book_new();

  const _sheet = (headers, example, req=[]) => {
    // Plain strings in AOA → garantit que les clés header correspondent au parser
    const ws = XLSX.utils.aoa_to_sheet([headers, example.map(v=>v||'')]);
    ws['!freeze'] = {xSplit:0, ySplit:1};
    // Styles appliqués après sur les cellules existantes (ignorés en community si non supportés)
    headers.forEach((h,i)=>{
      const c = XLSX.utils.encode_cell({r:0,c:i});
      if(ws[c]) ws[c].s = { fill:{fgColor:{rgb:req.includes(i)?'C0392B':'2D5986'}}, font:{bold:true,color:{rgb:'FFFFFF'},sz:10}, alignment:{wrapText:true,horizontal:'center'} };
    });
    example.forEach((v,i)=>{
      const c = XLSX.utils.encode_cell({r:1,c:i});
      if(ws[c]) ws[c].s = { font:{italic:true,color:{rgb:'888888'}}, fill:{fgColor:{rgb:'F5F5F5'}}, alignment:{wrapText:true} };
    });
    return ws;
  };

  // Entités
  XLSX.utils.book_append_sheet(wb, _sheet(
    ['Nom *','Type','SIREN','RCS','Gérant','Siège social','IBAN','BIC'],
    ['→ SCI DD EXEMPLE','→ SCI IS','→ 123 456 789','→ Strasbourg','→ Jean Dupont','→ 10 rue de la Paix, 67000 Strasbourg','→ FR76 1234...','→ BNPAFRPP'],
    [0]
  ), 'Entités');

  // Immeubles
  XLSX.utils.book_append_sheet(wb, _sheet(
    ['Nom immeuble *','Entité *','Valeur estimée (€)','Travaux (€)'],
    ['→ Immeuble Exemple','→ SCI DD EXEMPLE','→ 450000','→ 15000'],
    [0,1]
  ), 'Immeubles');

  // Logements
  XLSX.utils.book_append_sheet(wb, _sheet(
    ['Référence *','Immeuble *','Entité *','Type','Surface (m²)','Étage','Adresse','Notes'],
    ['→ F-001','→ Immeuble Exemple','→ SCI DD EXEMPLE','→ T3','→ 55','→ 1er','→ 12 rue Victor Hugo, 57800 Freyming',''],
    [0,1,2]
  ), 'Logements');

  // Baux
  XLSX.utils.book_append_sheet(wb, _sheet(
    ['Réf. logement *','Début bail *','Fin bail','Loyer HC * (€)','Charges (€)','Dépôt garantie (€)','Jour paiement','IRL (T1–T4)','Adresse du bien','Locataire 1 — Nom *','Locataire 1 — DDN','Locataire 1 — Lieu naissance','Locataire 1 — Tél','Locataire 1 — Mail','Locataire 2 — Nom','Locataire 2 — DDN','Locataire 2 — Lieu naissance','Locataire 2 — Tél','Locataire 2 — Mail','Locataire 3 — Nom','Garant','Chauffage','Entité','Notes'],
    ['→ F-001','→ 2024-01-15','→ 2027-01-14','→ 650','→ 20','→ 1300','→ 5','→ T1','→ 12 rue Victor Hugo','→ MARTIN Jean','→ 1985-06-12','→ Metz','→ 06 12 34 56 78','→ jean@email.com','','','','','','','→ MME DUPONT (garant)','→ Individuel gaz','→ SCI DD EXEMPLE',''],
    [0,1,3,9]
  ), 'Baux_Locataires');

  // Assurances PNO
  XLSX.utils.book_append_sheet(wb, _sheet(
    ['Réf. logement *','Type','Compagnie','N° contrat','Prime annuelle (€)','Échéance','Notes'],
    ['→ F-001','→ PNO','→ AXA','→ AXA-2024-001','→ 180','→ 2025-01-15','→ Renouvellement auto'],
    [0]
  ), 'Assurances_PNO');

  // MRH
  XLSX.utils.book_append_sheet(wb, _sheet(
    ['Réf. logement *','Locataire','Compagnie','N° contrat','Prime annuelle (€)','Échéance','Notes'],
    ['→ F-001','→ MARTIN Jean','→ MAAF','→ MRH-2024-123','→ 95','→ 2025-01-15','→ Attestation reçue le 15/01/2024'],
    [0]
  ), 'MRH_Locataires');

  XLSX.writeFile(wb, `Propryo_Template_Import.xlsx`);
}

function handleImportRef(inp) {
  const file = inp.files[0]; if(!file) return;
  if(typeof XLSX==='undefined'){ showToast('SheetJS non chargé','err'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
      showImportRefPreview(_importRefParse(wb));
    } catch(err) { showToast('Erreur lecture : ' + err.message, 'err'); }
    inp.value = '';
  };
  reader.readAsArrayBuffer(file);
}

function _refRows(wb, name) {
  const ws = wb.Sheets[name]; if(!ws) return [];
  return XLSX.utils.sheet_to_json(ws, {defval:''}).filter(r=>{
    const vals = Object.values(r).map(v=>String(v||'').trim());
    return vals.some(v=>v) && !vals.some(v=>v.startsWith('→ '));
  });
}

function _nd(s) {
  s = String(s||'').trim(); if(!s) return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : s;
}

function _importRefParse(wb) {
  const d = {entites:[],immeubles:[],logements:[],baux:[],assurances:[],mrh:[],errors:[]};

  _refRows(wb,'Entités').forEach((r,i)=>{
    const nom = String(r['Nom *']||r['Nom']||'').trim();
    if(!nom){d.errors.push(`Entités L${i+2} : nom manquant`);return;}
    d.entites.push({nom,type:r['Type']||'SCI IS',siren:String(r['SIREN']||''),rcs:String(r['RCS']||''),gerant:String(r['Gérant']||''),siege:String(r['Siège social']||''),iban:String(r['IBAN']||''),bic:String(r['BIC']||'')});
  });

  _refRows(wb,'Immeubles').forEach((r,i)=>{
    const nom=String(r['Nom immeuble *']||r['Nom']||'').trim(), entity=String(r['Entité *']||r['Entité']||'').trim();
    if(!nom){d.errors.push(`Immeubles L${i+2} : nom manquant`);return;}
    d.immeubles.push({nom,entity,valeurEstimee:parseFloat(r['Valeur estimée (€)'])||0,montantTravaux:parseFloat(r['Travaux (€)'])||0});
  });

  _refRows(wb,'Logements').forEach((r,i)=>{
    const ref=String(r['Référence *']||r['ref']||'').trim();
    if(!ref){d.errors.push(`Logements L${i+2} : référence manquante`);return;}
    d.logements.push({ref,imm:String(r['Immeuble *']||'').trim(),entity:String(r['Entité *']||'').trim(),type:String(r['Type']||''),surf:parseFloat(r['Surface (m²)'])||0,etage:String(r['Étage']||''),adr:String(r['Adresse']||''),notes:String(r['Notes']||'')});
  });

  _refRows(wb,'Baux_Locataires').forEach((r,i)=>{
    const ref=String(r['Réf. logement *']||'').trim();
    if(!ref){d.errors.push(`Baux L${i+2} : réf. manquante`);return;}
    const locs=[];
    for(let n=1;n<=3;n++){
      const nom=String(r[`Locataire ${n} — Nom${n===1?' *':''}`]||'').trim(); if(!nom) break;
      locs.push({nom,ddn:String(r[`Locataire ${n} — DDN`]||''),lieuNaiss:String(r[`Locataire ${n} — Lieu naissance`]||''),tel:String(r[`Locataire ${n} — Tél`]||''),email:String(r[`Locataire ${n} — Mail`]||'')});
    }
    if(!locs.length){d.errors.push(`Baux L${i+2} (${ref}) : locataire 1 manquant`);return;}
    d.baux.push({ref,locataires:locs,nom:locs[0].nom,debut:_nd(r['Début bail *']),fin:_nd(r['Fin bail']),hc:parseFloat(r['Loyer HC * (€)'])||0,ch:parseFloat(r['Charges (€)'])||0,dg:parseFloat(r['Dépôt garantie (€)'])||0,jpay:String(r['Jour paiement']||'5'),irl:String(r['IRL (T1–T4)']||'T1'),adrBien:String(r['Adresse du bien']||''),chauff:String(r['Chauffage']||''),garant:String(r['Garant']||''),entity:String(r['Entité']||''),notes:String(r['Notes']||'')});
  });

  _refRows(wb,'Assurances_PNO').forEach(r=>{
    const logement=String(r['Réf. logement *']||'').trim(); if(!logement) return;
    d.assurances.push({logement,type:String(r['Type']||'PNO'),compagnie:String(r['Compagnie']||''),numContrat:String(r['N° contrat']||''),prime:parseFloat(r['Prime annuelle (€)'])||0,echeance:_nd(r['Échéance']),notes:String(r['Notes']||'')});
  });

  _refRows(wb,'MRH_Locataires').forEach(r=>{
    const logement=String(r['Réf. logement *']||'').trim(); if(!logement) return;
    d.mrh.push({logement,locataire:String(r['Locataire']||''),compagnie:String(r['Compagnie']||''),numContrat:String(r['N° contrat']||''),prime:parseFloat(r['Prime annuelle (€)'])||0,echeance:_nd(r['Échéance']),notes:String(r['Notes']||'')});
  });

  return d;
}

let _refStaged = null;

function showImportRefPreview(d) {
  _refStaged = d;
  const counts = [['Entités',d.entites],['Immeubles',d.immeubles],['Logements',d.logements],['Baux/Locataires',d.baux],['Assurances PNO',d.assurances],['Assurances habitation',d.mrh]];
  const total = counts.reduce((s,[,a])=>s+a.length,0);
  if(!total && !d.errors.length){ showToast('Aucune donnée détectée — vérifier les noms d\'onglets','err'); return; }
  el('imp-ref-count').textContent = total + ' enregistrement(s) détecté(s)';
  el('imp-ref-summary').innerHTML =
    counts.filter(([,a])=>a.length).map(([lbl,a])=>`<div class="flex-b" style="padding:5px 0;border-bottom:1px solid var(--bor)"><span>${lbl}</span><b style="color:var(--grn)">+${a.length}</b></div>`).join('')
    + (d.errors.length ? `<div style="margin-top:10px;padding:8px 10px;background:rgba(248,81,73,.1);border-radius:var(--r);font-size:11px;color:var(--red)">⚠️ ${d.errors.length} ligne(s) ignorée(s) :<br>${d.errors.slice(0,5).map(escHtml).join('<br>')}${d.errors.length>5?`<br>…+${d.errors.length-5} autres`:''}</div>` : '');
  openM('ov-import-ref');
}

function validateImportRef() {
  const d = _refStaged; if(!d) return;
  let added=0, updated=0;

  d.entites.forEach(e=>{
    const ex=DB.entites.find(x=>x.nom===e.nom);
    // CHAMPS RÉSERVÉS (0064) : sur une SCI partagée gérée sans être plein gestionnaire, l'import ne touche pas l'identité
    // légale, l'IBAN, la signature… (réglés par le propriétaire de la SCI ; la base les refuserait).
    if(ex){ const _src = (typeof _entChampsReserves === 'function' && _entChampsReserves(ex)) ? Object.fromEntries(Object.entries(e).filter(([k]) => !_ENT_CHAMPS_RESERVES.includes(k))) : e; Object.assign(ex,_src); updated++; }
    else{DB.entites.push({id:nid(),...e,immeubles:[]});added++;}
  });

  d.immeubles.forEach(imm=>{
    const ent=DB.entites.find(e=>e.nom===imm.entity); if(!ent) return;
    if(!ent.immeubles) ent.immeubles=[];
    const ex=ent.immeubles.find(i=>i.nom===imm.nom);
    if(ex){Object.assign(ex,{valeurEstimee:imm.valeurEstimee,montantTravaux:imm.montantTravaux});updated++;}
    else{ent.immeubles.push({nom:imm.nom,valeurEstimee:imm.valeurEstimee,montantTravaux:imm.montantTravaux});added++;}
  });

  d.logements.forEach(l=>{
    const ex=DB.logements.find(x=>x.ref===l.ref);
    if(ex){Object.assign(ex,l);updated++;}
    else{DB.logements.push({id:nid(),...l,locataire:'',tel:'',mail:'',hc:0,ch:0,debut:'',fin:'',dg:0,irl:'T1',irlDerniereApplication:''});added++;}
  });

  d.baux.forEach(b=>{
    const ref=b.ref, bail={...b}; delete bail.ref;
    const log=DB.logements.find(l=>l.ref===ref);
    if(!bail.entity&&log) bail.entity=log.entity;
    if(!bail.adrBien&&log) bail.adrBien=log.adr;
    // FAMILLE « écritures destructrices » — l'import REMPLAÇAIT le bail existant en entier, alors
    // que juste au-dessus entités / immeubles / logements sont fusionnés (Object.assign). Sur un
    // lot déjà géré, ré-importer le fichier de référence effaçait le dossier de départ, la
    // restitution du DG et les signatures. Les colonnes importées gagnent, le reste survit.
    // Variante GATÉE (audit) : un bail SUPPRIMÉ laisse un tombstone { ref, _deleted:true, … } en
    // place. Préserver depuis lui ferait naître le bail importé DÉJÀ SUPPRIMÉ — invisible partout
    // (_isAlive), alors que le toast annonce « 1 ajout » et que le logement, lui, est mis à jour.
    // _preserverBailExistant refuse un tombstone comme source : l'import recrée bien un bail vivant.
    //
    // Et le gate isNewBail se DÉRIVE, il ne se force pas (2e audit) : une ligne du classeur qui
    // décrit un AUTRE bail (nouveau locataire) doit repartir vierge. Sinon le bail importé naissait
    // signé par le locataire précédent (signatures + bailSnapshot), déjà clôturé (cloture,
    // finEffective) et porteur de son départ et de son DG restitué — et « Voir le bail signé »
    // affichait le contrat de l'ancien. La date de début est le discriminateur porté par la donnée
    // importée elle-même.
    const _memeBail = !!(DB.baux[ref] && !DB.baux[ref]._deleted
      && String(DB.baux[ref].debut || '').slice(0, 10) === String(bail.debut || '').slice(0, 10));
    _preserverBailExistant(bail, DB.baux[ref], !_memeBail);
    // Et l'import doit dater sa propre écriture : sans _stamp, le bail hérite du _modifiedAt de
    // celui qu'il remplace et une copie distante plus ancienne peut le réécraser au merge.
    if (typeof _stamp === 'function') _stamp(bail);
    DB.baux[ref]=bail; added++;
    if(log){
      const locs=bail.locataires||[];
      log.locataire=locs.map(l=>l.nom).join(', ');
      log.tel=locs[0]?.tel||''; log.mail=locs[0]?.email||'';
      log.hc=bail.hc; log.ch=bail.ch; log.dg=bail.dg;
      log.debut=bail.debut; log.fin=bail.fin;
      log.irl=bail.irl; log.entity=bail.entity||log.entity;
      _pushLoyerTheoFromLive(log); // v15.233 B1 : import bail → loyer théorique logement
    }
  });

  d.assurances.forEach(a=>{
    const ex=DB.assurances.find(x=>x.logement===a.logement&&x.type===a.type);
    if(ex){Object.assign(ex,a);updated++;}
    else{DB.assurances.push({id:nid(),...a});added++;}
  });

  if(!DB.mrh) DB.mrh=[];
  d.mrh.forEach(m=>{
    const ex=DB.mrh.find(x=>x.logement===m.logement);
    if(ex){Object.assign(ex,m);updated++;}
    else{DB.mrh.push({id:nid(),...m});added++;}
  });

  saveDB(); initFilters(); _rPeriodPage();
  closeM('ov-import-ref');
  showToast(`Import terminé — ${added} ajout(s), ${updated} mise(s) à jour`,'ok',5000);
  _refStaged=null;
}

// =================== SIGNATURE ENTITÉ ===================

let _entSigB64 = null; // buffer temporaire pendant l'édition du modal

function _loadEntSig(inp) {
  const file = inp.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const maxW=400, maxH=150;
      let w=img.width, h=img.height;
      if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}
      if(h>maxH){w=Math.round(w*maxH/h);h=maxH;}
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      _entSigB64=cv.toDataURL('image/png',0.9);
      _showEntSigPreview(_entSigB64);
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

function _showEntSigPreview(b64) {
  const im=el('ent-sig-img'), em=el('ent-sig-empty'), bt=el('ent-sig-btns');
  if(!im||!em||!bt) return;
  if(b64){im.src=b64;im.style.display='';em.style.display='none';bt.style.display='';}
  else{im.src='';im.style.display='none';em.style.display='';bt.style.display='none';}
}

function _clearEntSig() {
  _entSigB64=null;
  const f=el('ent-sig-file'); if(f) f.value='';
  _showEntSigPreview(null);
}

// v13.28 BAIL-PRINT-POLISH point 4 : Logo entité (data URL base64).
// Pattern dupliqué de la signature (load/preview/clear).
let _entLogoB64 = null;

function _loadEntLogo(inp) {
  const file = inp.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const maxW=300, maxH=100;
      let w=img.width, h=img.height;
      if(w>maxW){h=Math.round(h*maxW/w);w=maxW;}
      if(h>maxH){w=Math.round(w*maxH/h);h=maxH;}
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
      cv.getContext('2d').drawImage(img,0,0,w,h);
      _entLogoB64=cv.toDataURL('image/png',0.9);
      _showEntLogoPreview(_entLogoB64);
    };
    img.src=e.target.result;
  };
  reader.readAsDataURL(file);
}

function _showEntLogoPreview(b64) {
  const im=el('ent-logo-img'), em=el('ent-logo-empty'), bt=el('ent-logo-btns');
  if(!im||!em||!bt) return;
  if(b64){im.src=b64;im.style.display='';em.style.display='none';bt.style.display='';}
  else{im.src='';im.style.display='none';em.style.display='';bt.style.display='none';}
}

function _clearEntLogo() {
  _entLogoB64=null;
  const f=el('ent-logo-file'); if(f) f.value='';
  _showEntLogoPreview(null);
}

// Image de signature seule — pour l'espace AU-DESSUS du filet du gabarit (on signe au-dessus
// de la ligne). Rend '' quand l'entite n'a pas de signature enregistree : l'espace reste vierge
// pour une signature manuscrite, sans <br> de remplissage.
// (l'ancien _docSigImg, qui empilait l'image SOUS son propre libellé et rendait deux <br> de
//  remplissage quand il n'y avait pas de signature, n'a plus d'appelant : il est supprimé.)
function _docSigOnly(ent) {
  return ent?.signature
    ? `<img src="${escHtml(ent.signature)}" alt="" style="max-height:10mm;max-width:100%;display:block">`
    : '';
}

// =================== MODE CLOUD (ex-Drive retiré) ===================
// Google Drive a été PHYSIQUEMENT retiré (cutover « Connexion B ») : OAuth GIS, tokens, sync, picker,
// arborescence et FAB sont supprimés. Supabase est la SEULE persistance. _immoCloudActive() renvoie TRUE
// en prod (toutes les fonctions partagées prennent la branche cloud) et FALSE UNIQUEMENT dans le harnais
// de test (index-test*.html / ?sandbox=1), qui reste legacy/démo isolé. _isTestMode (const top-level)
// est en portée ici et utilise la même détection que le boot — ne PAS le casser : c'est ce qui protège
// le harnais de test.
function _immoCloudActive() {
  return (typeof _isTestMode !== 'undefined') ? !_isTestMode : true;
}
// Plus aucune lecture seule Drive : l'app n'est jamais bloquée en écriture (cloud ou test). Conservé en
// `let` car des fonctions partagées le lisent encore (toujours false désormais).
let _appReadOnly = false;
// No-op : il n'y a plus d'état « lecture seule » lié à une connexion Drive. Conservé car appelé depuis
// saveDB() et la bascule cloud (supabase-entry) — garantit qu'aucun résidu ne grise l'app.
function _updateReadOnlyMode() {
  _appReadOnly = false;
  try { document.body.classList.remove('app-readonly'); } catch (e) {}
}
// No-op conservé : d'anciens chemins (upload PDF/photo) l'appelaient quand Drive était déconnecté. En
// cloud, l'écriture passe toujours → plus de message « connecter Drive ».
function _showReadOnlyAlert() {}

/* v14.32 BUG-DRIVE-RESURRECTION Phase 3 : cascade tombstone sur tous les
   sous-objets d'une entité supprimée. Sans ce cascade, supprimer une entité
   sur PC laisserait ses logements/baux/mouvements/etc. vivants → ils
   resteraient sur les autres devices au prochain pull (ressuscités via la
   logique d'union du merge).

   Appelé par delEnt (côté local) et par _mergeEntityPayload (côté pull
   quand on reçoit une entité tombstone d'un autre device). Tombstone
   préserve les champs de filtrage du payload (entity, logement, qui)
   pour cohérence avec _buildEntityPayload. */
function _cascadeDeleteEntity(entNom, entityId) {
  if (!entNom) return 0;
  // v15.186 : utilise le helper centralisé _tombstoneObj
  const tombstone = _tombstoneObj;
  let count = 0;
  // v15.186 : récupère l'entité (peut être déjà tombstone ou vivante selon le call site)
  // pour résoudre les IDs immeubles dans la cascade documents étendue.
  const ent = (DB.entites || []).find(e => e && (e.nom === entNom || e.entityId === entityId));

  // Logements de cette entité
  (DB.logements || []).forEach((l, i) => {
    if (l && !l._deleted && l.entity === entNom) {
      DB.logements[i] = tombstone({ id: l.id, ref: l.ref, entity: l.entity, imm: l.imm });
      count++;
    }
  });
  // refs des logements qu'on vient juste de tombstone (pour cascade enfants).
  const cascadeRefs = new Set((DB.logements || []).filter(l => l && l._deleted && l.entity === entNom).map(l => l.ref));
  // v15.240 V3-REFONTE-ASSURANCES : noms d'immeubles de l'entité (pour cascader les PNO de portée immeuble,
  // qui n'ont pas de a.logement). Source : ent.immeubles[] + l.imm des logements de l'entité.
  const cascadeImmNames = new Set([
    ...(((ent && ent.immeubles) || []).map(im => im && im.nom).filter(Boolean)),
    ...((DB.logements || []).filter(l => l && l.entity === entNom && l.imm).map(l => l.imm))
  ]);

  // Baux liés (par entity ou par ref logement)
  Object.keys(DB.baux || {}).forEach(k => {
    const b = DB.baux[k];
    if (b && !b._deleted && (b.entity === entNom || cascadeRefs.has(k))) {
      DB.baux[k] = tombstone({ entity: b.entity || entNom, ref: k });
      count++;
    }
  });

  // Mouvements liés (qui === SCI:nom ou ref logement)
  const sciKey = 'SCI:' + entNom;
  (DB.mouvements || []).forEach((m, i) => {
    if (m && !m._deleted && (m.qui === sciKey || cascadeRefs.has(m.qui))) {
      DB.mouvements[i] = tombstone({ id: m.id, qui: m.qui });
      count++;
    }
  });

  // Quittances liées (entity ou logement)
  (DB.quittances || []).forEach((q, i) => {
    if (q && !q._deleted && (q.entity === entNom || cascadeRefs.has(q.logement))) {
      DB.quittances[i] = tombstone({ id: q.id, entity: q.entity || entNom, logement: q.logement || '' });
      count++;
    }
  });

  // EDLs liés (par logement)
  (DB.edl || []).forEach((e, i) => {
    if (e && !e._deleted && cascadeRefs.has(e.logement)) {
      DB.edl[i] = tombstone({ id: e.id, logement: e.logement });
      count++;
    }
  });

  // Assurances + MRH (par logement OU portée immeuble pour les PNO d'ensemble — v15.240)
  (DB.assurances || []).forEach((a, i) => {
    if (a && !a._deleted && (cascadeRefs.has(a.logement) || (a.immeuble && cascadeImmNames.has(a.immeuble)))) {
      DB.assurances[i] = tombstone({ id: a.id, logement: a.logement || '', immeuble: a.immeuble || '' });
      count++;
    }
  });
  (DB.mrh || []).forEach((m, i) => {
    if (m && !m._deleted && cascadeRefs.has(m.logement)) {
      DB.mrh[i] = tombstone({ id: m.id, logement: m.logement });
      count++;
    }
  });
  // LOG-CANDIDATS : candidats rattachés à l'entité (par entity nom OU logRef du logement)
  (DB.candidats || []).forEach((c, i) => {
    if (c && !c._deleted && (c.entity === entNom || cascadeRefs.has(c.logRef))) {
      DB.candidats[i] = tombstone({ id: c.id, entity: c.entity || entNom, logRef: c.logRef || '' });
      count++;
    }
  });

  // Bail historique (entity ou ref)
  (DB.baux_historique || []).forEach((b, i) => {
    if (b && !b._deleted && (b.entity === entNom || cascadeRefs.has(b.ref))) {
      DB.baux_historique[i] = tombstone({ entity: b.entity || entNom, ref: b.ref || '', debut: b.debut || '' });
      count++;
    }
  });

  // irlHistorique (par ref)
  (DB.irlHistorique || []).forEach((h, i) => {
    if (h && !h._deleted && cascadeRefs.has(h.ref)) {
      DB.irlHistorique[i] = tombstone({ ref: h.ref, date: h.date || '', dateRevision: h.dateRevision, dateEffet: h.dateEffet });
      count++;
    }
  });

  // v14.35 DRIVE-ARBORESCENCE Phase B : documents uploadés Drive (par logRef).
  // v15.186 FIX BUG CRITIQUE : étendre la cascade aux docs avec parentType='entite'
  // /'mouvement'/'bail'/'immeuble'. Sans ça, les docs orphelins (parent disparu)
  // restaient vivants en DB → invisibles dans _buildEntityPayload (filtres parent
  // disparu) → JAMAIS nettoyés sur Drive ni propagés aux autres devices.
  // v15.187 fix audit : couverture COMPLÈTE des 7 parentTypes (logement via logRef +
  // entite + immeuble + mouvement + bail + edl + assurance + mrh + quittance), pas
  // juste 4. Construit les sets d'IDs/refs des sous-objets tombstones APRÈS leurs
  // cascades respectives (l.37787-37814) pour résoudre les parents.
  const mvIds = new Set((DB.mouvements || []).filter(m => m && m._deleted && (m.qui === sciKey || cascadeRefs.has(m.qui))).map(m => m.id));
  const bailRefs = new Set(Object.keys(DB.baux || {}).filter(k => DB.baux[k] && DB.baux[k]._deleted && (DB.baux[k].entity === entNom || cascadeRefs.has(k))));
  const edlIds = new Set((DB.edl || []).filter(e => e && e._deleted && cascadeRefs.has(e.logement)).map(e => e.id));
  const assIds = new Set((DB.assurances || []).filter(a => a && a._deleted && (cascadeRefs.has(a.logement) || (a.immeuble && cascadeImmNames.has(a.immeuble)))).map(a => a.id));
  const mrhIds = new Set((DB.mrh || []).filter(m => m && m._deleted && cascadeRefs.has(m.logement)).map(m => m.id));
  const quitIds = new Set((DB.quittances || []).filter(q => q && q._deleted && (q.entity === entNom || cascadeRefs.has(q.logement))).map(q => q.id));
  const entId = ent && ent.id;
  const immIds = new Set((ent && Array.isArray(ent.immeubles) ? ent.immeubles : []).map(im => im && im.id).filter(Boolean));
  const candIds = new Set((DB.candidats || []).filter(c => c && c._deleted && (c.entity === entNom || cascadeRefs.has(c.logRef))).map(c => c.id));
  (DB.documents || []).forEach((d, i) => {
    if (!d || d._deleted) return;
    let matchesEntity = false;
    if (d.logRef && cascadeRefs.has(d.logRef)) matchesEntity = true;
    else if (d.parentType === 'entite' && entId != null && +d.parentId === +entId) matchesEntity = true;
    else if (d.parentType === 'immeuble' && d.parentId != null && immIds.has(+d.parentId)) matchesEntity = true;
    else if (d.parentType === 'mouvement' && mvIds.has(d.parentId)) matchesEntity = true;
    else if (d.parentType === 'bail' && d.parentRef && bailRefs.has(d.parentRef)) matchesEntity = true;
    else if (d.parentType === 'edl' && edlIds.has(d.parentId)) matchesEntity = true;
    else if (d.parentType === 'assurance' && assIds.has(d.parentId)) matchesEntity = true;
    else if (d.parentType === 'mrh' && mrhIds.has(d.parentId)) matchesEntity = true;
    else if (d.parentType === 'quittance' && quitIds.has(d.parentId)) matchesEntity = true;
    else if (d.parentType === 'candidat' && candIds.has(d.parentId)) matchesEntity = true; // LOG-CANDIDATS
    if (matchesEntity) {
      DB.documents[i] = tombstone({ id: d.id, logRef: d.logRef, parentType: d.parentType, parentId: d.parentId, parentRef: d.parentRef });
      count++;
    }
  });

  console.log('[cascadeDeleteEntity]', entNom, '→', count, 'sous-objets tombstones');
  return count;
}

// v15.248 BUG-DELIMM-CASCADE : cascade de suppression scopée IMMEUBLE (entity + imm).
// Les vues groupent les logements par l.imm (string) — tombstoner le seul objet immeuble
// laissait ses logements vivants → l'immeuble restait affiché (« suppression ne marche pas »).
// On tombstone donc TOUS les sous-objets de l'immeuble. L'entité reste VIVANTE → la
// propagation Drive passe par _buildEntityPayload(ent) qui inclut les sous-objets tombstones
// tant qu'ils préservent leurs champs de filtrage (pas de symétrie merge-side nécessaire,
// même modèle que _cascadeDeleteEntity). Mode dryRun : renvoie un décompte par catégorie
// sans muter → source unique de la confirmation détaillée de delImm (zéro drift annoncé/réel).
function _cascadeDeleteImmeuble(entNom, immNom, immId, dryRun) {
  const b = { logements:0, baux:0, mouvements:0, quittances:0, edl:0, assurances:0, mrh:0, candidats:0, baux_historique:0, irlHistorique:0, documents:0, total:0 };
  if (!entNom || !immNom) return b;
  const tombstone = _tombstoneObj;
  // v15.248 : on COLLECTE les IDs/refs des sous-objets matchés DURANT chaque passe
  // (et pas en re-filtrant les tombstones après), car _tombstoneObj ne préserve qu'un
  // sous-ensemble de champs (ex : `portee` est perdu) → re-filtrer raterait les PNO
  // portée-immeuble pour la cascade documents. Les sets sont peuplés dans les 2 modes
  // (dry-run inclus) car le décompte des documents en dépend.
  const mvIds = new Set(), edlIds = new Set(), assIds = new Set(), mrhIds = new Set(), quitIds = new Set(), candIds = new Set(), bailRefs = new Set();

  // Logements de cet immeuble (scopés entity + imm). cascadeRefs construit depuis les
  // logements VIVANTS matchés (avant tombstone) → identique en dry-run et en réel.
  const cascadeRefs = new Set();
  (DB.logements || []).forEach((l, i) => {
    if (l && !l._deleted && l.entity === entNom && l.imm === immNom) {
      cascadeRefs.add(l.ref);
      b.logements++;
      if (!dryRun) DB.logements[i] = tombstone({ id: l.id, ref: l.ref, entity: l.entity, imm: l.imm });
    }
  });

  // Baux liés (par ref logement uniquement — scopé immeuble, PAS par entity)
  Object.keys(DB.baux || {}).forEach(k => {
    const bx = DB.baux[k];
    if (bx && !bx._deleted && cascadeRefs.has(k)) {
      bailRefs.add(k);
      b.baux++;
      if (!dryRun) DB.baux[k] = tombstone({ entity: bx.entity || entNom, ref: k });
    }
  });

  // Mouvements liés (par ref logement)
  (DB.mouvements || []).forEach((m, i) => {
    if (m && !m._deleted && cascadeRefs.has(m.qui)) {
      mvIds.add(m.id);
      b.mouvements++;
      if (!dryRun) DB.mouvements[i] = tombstone({ id: m.id, qui: m.qui });
    }
  });

  // Quittances liées (par logement)
  (DB.quittances || []).forEach((q, i) => {
    if (q && !q._deleted && cascadeRefs.has(q.logement)) {
      quitIds.add(q.id);
      b.quittances++;
      if (!dryRun) DB.quittances[i] = tombstone({ id: q.id, entity: q.entity || entNom, logement: q.logement || '' });
    }
  });

  // EDLs liés (par logement)
  (DB.edl || []).forEach((e, i) => {
    if (e && !e._deleted && cascadeRefs.has(e.logement)) {
      edlIds.add(e.id);
      b.edl++;
      if (!dryRun) DB.edl[i] = tombstone({ id: e.id, logement: e.logement });
    }
  });

  // Assurances (par logement OU PNO portée-immeuble) + MRH (par logement)
  (DB.assurances || []).forEach((a, i) => {
    if (a && !a._deleted && (cascadeRefs.has(a.logement) || (a.portee === 'immeuble' && a.immeuble === immNom))) {
      assIds.add(a.id);
      b.assurances++;
      if (!dryRun) DB.assurances[i] = tombstone({ id: a.id, logement: a.logement || '', immeuble: a.immeuble || '', portee: a.portee || '' });
    }
  });
  (DB.mrh || []).forEach((m, i) => {
    if (m && !m._deleted && cascadeRefs.has(m.logement)) {
      mrhIds.add(m.id);
      b.mrh++;
      if (!dryRun) DB.mrh[i] = tombstone({ id: m.id, logement: m.logement });
    }
  });

  // LOG-CANDIDATS : candidats rattachés à un logement de l'immeuble (par logRef)
  (DB.candidats || []).forEach((c, i) => {
    if (c && !c._deleted && cascadeRefs.has(c.logRef)) {
      candIds.add(c.id);
      b.candidats++;
      if (!dryRun) DB.candidats[i] = tombstone({ id: c.id, entity: c.entity || entNom, logRef: c.logRef || '' });
    }
  });

  // Bail historique (par ref)
  (DB.baux_historique || []).forEach((bh, i) => {
    if (bh && !bh._deleted && cascadeRefs.has(bh.ref)) {
      b.baux_historique++;
      if (!dryRun) DB.baux_historique[i] = tombstone({ entity: bh.entity || entNom, ref: bh.ref || '', debut: bh.debut || '' });
    }
  });

  // irlHistorique (par ref)
  (DB.irlHistorique || []).forEach((h, i) => {
    if (h && !h._deleted && cascadeRefs.has(h.ref)) {
      b.irlHistorique++;
      if (!dryRun) DB.irlHistorique[i] = tombstone({ ref: h.ref, date: h.date || '', dateRevision: h.dateRevision, dateEffet: h.dateEffet });
    }
  });

  // Documents Drive : cascade par parent (logRef + immeuble + mouvement + bail +
  // edl + assurance + mrh + quittance + candidat). Les sets d'IDs/refs ont été
  // collectés DURANT les passes ci-dessus (cf commentaire en tête).
  (DB.documents || []).forEach((d, i) => {
    if (!d || d._deleted) return;
    let match = false;
    if (d.logRef && cascadeRefs.has(d.logRef)) match = true;
    else if (d.parentType === 'immeuble' && immId != null && d.parentId != null && +d.parentId === +immId) match = true;
    else if (d.parentType === 'mouvement' && mvIds.has(d.parentId)) match = true;
    else if (d.parentType === 'bail' && d.parentRef && bailRefs.has(d.parentRef)) match = true;
    else if (d.parentType === 'edl' && edlIds.has(d.parentId)) match = true;
    else if (d.parentType === 'assurance' && assIds.has(d.parentId)) match = true;
    else if (d.parentType === 'mrh' && mrhIds.has(d.parentId)) match = true;
    else if (d.parentType === 'quittance' && quitIds.has(d.parentId)) match = true;
    else if (d.parentType === 'candidat' && candIds.has(d.parentId)) match = true;
    if (match) {
      b.documents++;
      if (!dryRun) DB.documents[i] = tombstone({ id: d.id, logRef: d.logRef, parentType: d.parentType, parentId: d.parentId, parentRef: d.parentRef });
    }
  });

  b.total = b.logements + b.baux + b.mouvements + b.quittances + b.edl + b.assurances + b.mrh + b.candidats + b.baux_historique + b.irlHistorique + b.documents;
  if (!dryRun) console.log('[cascadeDeleteImmeuble]', entNom + '/' + immNom, '→', b.total, 'sous-objets tombstones');
  return b;
}


// ── UI : onglet Partage & Accès ──────────────────────────────────────────────
// v15.307 PARTAGE-SCI — l'onglet « Partage » des Réglages a deux visages :
//   • mode CLOUD (Supabase) → écran « Partage & accès » multi-utilisateurs (membres, invitation par SCI,
//     révocation, encart facturation). Helpers backend via window.__immoPartage (supabase-entry.js).
//   • mode LEGACY (Drive ou local) → ancien écran de partage Drive (inchangé), ci-dessous _rParamsPartageDrive().
function rParamsPartage() {
  const wrap=el('tp-partage'); if(!wrap) return;
  if (window.__immoPartage) return _rParamsPartageCloud(wrap);
  // Cloud non encore prêt (helpers __immoPartage pas posés) → message d'attente.
  wrap.innerHTML = '<div class="mu" style="padding:32px;text-align:center">⟳ Connexion au partage…</div>';
}

// ── ÉCRAN « PARTAGE & ACCÈS » (mode cloud) — variante B de la maquette mockups/partage-sci/ ──────────
// Cartes par membre (périmètres en pastilles, badge « Lecture » discret), bouton « Inviter une personne »,
// encart facturation (partenaires en écriture : 1er offert, +3 €/mois au-delà ; lectures gratuites).
const PARTAGE_ADDON = 3;   // € / mois par partenaire EN ÉCRITURE au-delà du 1er offert

function _partageSciChip(g) {
  // pastille d'entité (couleur dérivée du nom côté helper) + badge « Lecture » discret si lecture seule
  const c = g.couleur || 'hsl(220,12%,60%)';
  const read = g.mode === 'lecture'
    ? ' <span class="badge gry" style="font-size:10px;padding:1px 6px;margin-left:2px" title="Consultation seule">👁 Lecture</span>'
    : '';
  return '<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px 4px 8px;border-radius:8px;font-size:12px;font-weight:600;line-height:1.2;border:1px solid '
    + c + '44;background:' + c + '14;color:' + c + '">'
    + '<span style="width:11px;height:11px;border-radius:3px;flex-shrink:0;background:' + c + '"></span>'
    + escHtml(g.nom || g.entite_nom || 'Périmètre') + read + '</span>';
}

function _partageAvatar(label, big) {
  const txt = String(label || '?').trim();
  const initials = txt === 'Moi' ? '🙂'
    : (txt.indexOf('@') !== -1 ? txt.slice(0, 2).toUpperCase() : txt.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?');
  const sz = big ? 38 : 30, fs = big ? 14 : 12;
  // couleur d'avatar stable dérivée du label
  let h = 0; for (let i = 0; i < txt.length; i++) { h = ((h << 5) - h) + txt.charCodeAt(i); h = h & h; }
  const c = 'hsl(' + (Math.abs(h) % 320 + 20) + ',55%,50%)';
  return '<div style="width:' + sz + 'px;height:' + sz + 'px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:' + fs + 'px;flex-shrink:0;color:#fff;background:' + c + '">' + initials + '</div>';
}

async function _rParamsPartageCloud(wrap) {
  wrap.innerHTML = '<div class="mu" style="padding:32px;text-align:center">⟳ Chargement du partage…</div>';
  // Statut super-admin résolu ICI (pas au login → ne bloque JAMAIS la connexion). Contrôle l'écran « Accès bêta ».
  try { window.__immoIsAdmin = window.__immoAdmin ? (await window.__immoAdmin.isAppAdmin()) === true : false; } catch (e) { window.__immoIsAdmin = false; }
  const res = await window.__immoPartage.listMembers();
  if (res.error) {
    wrap.innerHTML = '<div class="card" style="text-align:center;padding:28px">'
      + '<div style="font-size:30px;margin-bottom:10px">⚠️</div>'
      + '<div class="mu" style="margin-bottom:14px">Impossible de charger les accès partagés : ' + escHtml(res.error) + '</div>'
      + '<button class="btn bs" onclick="rParamsPartage()">↻ Réessayer</button></div>';
    return;
  }
  const members = res.members || [];
  // Bêta : tout gratuit (l'ancien encart chiffré « 1er offert · +X €/mois » n'était qu'un affichage).
  const partners = members.filter(m => !m.isOwner);
  const writePartners = partners.filter(m => (m.grants || []).some(g => g.mode === 'ecriture')).length;
  const billing = '<div style="background:var(--sur2,rgba(16,185,129,.08));border:1px solid rgba(16,185,129,.25);border-radius:var(--rl);padding:14px 16px;margin-bottom:16px">'
    + '<div style="font-weight:700;color:var(--t1);font-size:13.5px">' + _uiIcon('gift') + ' Gratuit pendant la bêta</div>'
    + '<div class="sm mu" style="margin-top:3px">Invitations illimitées — lecture et écriture offertes. '
    +   writePartners + ' partenaire' + (writePartners > 1 ? 's' : '') + ' en écriture actuellement.</div>'
    + '</div>';

  const cards = members.map(m => {
    const grants = m.grants || [];
    const chips = grants.length
      ? grants.map(_partageSciChip).join(' ')
      : (m.isOwner ? '<span class="mu sm">Accès à tous les périmètres.</span>' : '<span class="mu sm" style="font-style:italic">Aucun périmètre — accès révoqué.</span>');
    const youBadge = m.isMe ? ' <span class="badge gry" style="font-size:10px;padding:1px 7px" title="Compte connecté">connecté</span>' : '';
    const acts = (!m.isOwner)
      ? '<div class="flex-c" style="gap:6px;flex-shrink:0">'
        + '<button class="btn bs bb" title="Modifier le périmètre et le mode (bientôt)" disabled style="opacity:.5;cursor:not-allowed">✏️ Modifier</button>'
        + '<button class="btn br bb" title="Révoquer tout l\'accès" onclick="_partageRevoke(\'' + m.user_id + '\',\'' + _lyQ(m.label) + '\')">🗑 Révoquer</button>'
        + '</div>'
      : '';
    const sub = m.isOwner ? 'Propriétaire de l\'espace · accès à tout'
      : (grants.some(g => g.mode === 'ecriture') ? 'Co-gère (écriture) :' : 'Consulte (lecture seule) :');
    return '<div class="card" style="padding:16px 18px;margin-bottom:12px">'
      + '<div class="flex-b" style="align-items:flex-start;gap:10px;margin-bottom:10px">'
      +   '<div class="flex-c" style="gap:10px;min-width:0">' + _partageAvatar(m.label, true)
      +     '<div style="min-width:0"><div style="font-weight:700;font-size:14.5px;color:var(--t1)">' + escHtml(m.label) + youBadge + '</div>'
      +       (m.email && !m.isMe ? '<div class="sm" style="color:var(--t3)">' + escHtml(m.email) + '</div>' : '') + '</div></div>'
      +   acts
      + '</div>'
      + '<div class="sm mu" style="margin-bottom:7px">' + sub + '</div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' + chips + '</div>'
      + '</div>';
  }).join('');

  wrap.innerHTML =
    // Administration (super-admin) : onglets « Accès bêta » | « Consommation IA » | « Plafonds par offre » (CONSO-IA).
    (window.__immoIsAdmin ? '<div id="adm-mount"><div id="adm-onglets"></div><div id="beta-admin-mount"></div><div id="adm-ia-mount" hidden></div></div>' : '')
    + '<div class="flex-b" style="align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:14px">'
    + '<div><div class="ct" style="margin:0 0 4px">👥 Partage &amp; accès</div>'
    +   '<div class="mu sm" style="max-width:560px;line-height:1.5">Inviter une personne à accéder à un ou plusieurs périmètres (SCI ou Perso). En <b>écriture</b>, la gestion est partagée à parts égales ; en <b>lecture</b>, la personne consulte sans modifier. Chacun n\'accède qu\'aux périmètres partagés.</div></div>'
    + '<button class="btn bp" onclick="_partageOpenInvite()">➕ Inviter une personne</button>'
    + '</div>'
    + billing
    + '<div class="ct">Membres de l\'espace</div>'
    + cards;
  if (window.__immoIsAdmin) {
    try { if (window.ConsoIa) window.ConsoIa.adminOnglets(); } catch (e) {}
    if (!window.ConsoIa || window.ConsoIa.ongletAdmin() === 'beta') _renderBetaAdmin();
  }
}

// ── Écran admin bêta (super-admin global uniquement) : gère l'allowlist d'inscription ──
// Monté en tête de la page Partage via #beta-admin-mount, seulement si window.__immoIsAdmin.
async function _renderBetaAdmin() {
  const mount = el('beta-admin-mount'); if (!mount) return;
  mount.innerHTML = '<div class="card" style="padding:16px 18px;margin-bottom:16px"><div class="mu sm">⟳ Chargement des accès bêta…</div></div>';
  const r = await window.__immoAdmin.listAllowlist();
  if (r.error) { mount.innerHTML = '<div class="card" style="padding:16px 18px;margin-bottom:16px"><div class="mu sm">Accès bêta indisponible : ' + escHtml(r.error) + '</div></div>'; return; }
  const rows = r.rows || [];
  const nIns = rows.filter(x => x.registered_at).length;
  const nAtt = rows.length - nIns;
  const list = rows.length ? rows.map(x => {
    const isInvit = x.source === 'invitation';
    const typePill = isInvit
      ? '<span class="badge" style="background:var(--acc-w,rgba(255,90,60,.12));color:var(--acc);font-size:10.5px;padding:2px 8px">invité' + (x.invited_by_email ? ' · via ' + escHtml(String(x.invited_by_email).split('@')[0]) : '') + '</span>'
      : '<span class="badge gry" style="font-size:10.5px;padding:2px 8px">testeur</span>';
    const stat = x.registered_at
      ? '<span class="sm" style="color:var(--grn);white-space:nowrap">✓ inscrit</span>'
      : '<span class="sm" style="color:var(--amb,#b45309);white-space:nowrap">⏳ en attente</span>';
    return '<div class="flex-b" style="align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--bor)">'
      + '<span style="font-weight:600;font-size:13px;color:var(--t1);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(x.email) + '</span>'
      + '<span class="flex-c" style="gap:9px;flex-shrink:0">' + typePill + stat
      +   '<button class="btn br bb" title="Retirer l\'accès" onclick="_betaRemove(\'' + _lyQ(x.email) + '\')">🗑</button></span>'
      + '</div>';
  }).join('') : '<div class="mu sm" style="text-align:center;padding:22px">Aucun accès pour l\'instant. Ajouter l\'email d\'un testeur.</div>';
  mount.innerHTML =
    '<div class="card" style="padding:16px 18px;margin-bottom:18px">'
    + '<div class="flex-b" style="align-items:center;gap:10px;margin-bottom:4px">'
    +   '<div class="ct" style="margin:0">🎫 Accès bêta</div>'
    +   '<span class="badge" style="background:var(--acc-w,rgba(255,90,60,.12));color:var(--acc);font-size:10.5px;padding:2px 8px">🔒 réservé admin</span>'
    + '</div>'
    + '<div class="mu sm" style="margin-bottom:14px;line-height:1.5">Emails autorisés à créer un compte. Les invités ajoutés par un testeur apparaissent tout seuls.</div>'
    + '<div class="flex-c" style="gap:8px;margin-bottom:14px">'
    +   '<input class="inp" id="beta-add-email" type="email" placeholder="name@exemple.fr" style="flex:1;min-width:0" onkeydown="if(event.key===\'Enter\')_betaAddEmail()">'
    +   '<button class="btn bp" onclick="_betaAddEmail()">➕ Autoriser</button>'
    + '</div>'
    + '<div class="flex-c" style="gap:7px;margin-bottom:12px;flex-wrap:wrap">'
    +   '<span class="badge gry" style="font-size:11px">' + rows.length + ' autorisé' + (rows.length > 1 ? 's' : '') + '</span>'
    +   '<span class="badge" style="background:rgba(22,163,74,.12);color:var(--grn);font-size:11px">' + nIns + ' inscrit' + (nIns > 1 ? 's' : '') + '</span>'
    +   '<span class="badge" style="background:rgba(180,83,9,.12);color:var(--amb,#b45309);font-size:11px">' + nAtt + ' en attente</span>'
    + '</div>'
    + '<div style="border:1px solid var(--bor);border-radius:var(--r);overflow:hidden">' + list + '</div>'
    + '</div>';
}
async function _betaAddEmail() {
  const inp = el('beta-add-email'); if (!inp) return;
  const r = await window.__immoAdmin.addEmail(inp.value);
  if (r && r.error) { showToast(r.error, 'err', 5000); return; }
  inp.value = '';
  showToast('✓ Testeur autorisé', 'ok');
  _renderBetaAdmin();
}
async function _betaRemove(email) {
  if (!confirm('Retirer l\'accès de « ' + email + ' » ?\n\nCette personne ne pourra plus créer de compte (les comptes déjà créés ne sont pas supprimés).')) return;
  const r = await window.__immoAdmin.removeEmail(email);
  if (r && r.error) { showToast(r.error, 'err', 5000); return; }
  showToast('Accès retiré', 'ok');
  _renderBetaAdmin();
}

// Révocation d'un partenaire (confirmation native, comme le reste de l'app).
async function _partageRevoke(userId, label) {
  if (!confirm('Retirer TOUT l\'accès de « ' + (label || 'ce partenaire') + ' » à cet espace ?\n\nLa personne perd immédiatement l\'accès aux périmètres partagés. Action réversible (réinvitation possible).')) return;
  const r = await window.__immoPartage.revokeMember(userId);
  if (r && r.error) { showToast('Révocation impossible : ' + r.error, 'err', 5000); return; }
  showToast('Accès révoqué', 'ok');
  rParamsPartage();
}

// ── POPUP « INVITER UNE PERSONNE » (mode cloud) ─────────────────────────────────────────────────────
// Périmètres en cases à cocher (pastille + détection Perso) ; pour chaque coché, un mode Écriture/Lecture
// (Écriture par défaut) ; « Générer l'invitation » → __immoPartage.createInvite → modale de partage du
// bail (#ov-bss-share, mêmes canaux Copier/Email/SMS/WhatsApp/QR) avec le LIEN d'invitation.
let _partageInvite = { entites: [], sel: {}, modes: {} };   // sel[id]=bool ; modes[id]='ecriture'|'lecture'

async function _partageOpenInvite() {
  const host = el('ov-partage-invite');
  if (host) host.remove();
  const res = await window.__immoPartage.listEntites();
  if (res.error) { showToast('Impossible de charger les périmètres : ' + res.error, 'err', 5000); return; }
  _partageInvite = { entites: res.entites || [], sel: {}, modes: {} };
  if (!_partageInvite.entites.length) {
    showToast('Aucun périmètre à partager — créer d\'abord une entité (SCI ou Perso).', 'info', 5000);
    return;
  }
  document.body.insertAdjacentHTML('beforeend',
    '<div class="ov" id="ov-partage-invite" onclick="closeBg(event,\'ov-partage-invite\')">'
    + '<div class="modal" style="max-width:560px">'
    +   '<div class="m-head"><h3>🤝 Inviter une personne</h3><button class="m-close" onclick="closeM(\'ov-partage-invite\')">✕</button></div>'
    +   '<div class="m-body" id="partage-invite-body"></div>'
    +   '<div class="m-foot"><button class="btn bs" onclick="closeM(\'ov-partage-invite\')">Annuler</button>'
    +     '<button class="btn bp" id="partage-invite-gen" onclick="_partageGenInvite()">🔗 Générer l\'invitation</button></div>'
    + '</div></div>');
  openM('ov-partage-invite');
  _partageRenderInvite();
}

function _partageRenderInvite() {
  const body = el('partage-invite-body'); if (!body) return;
  const st = _partageInvite;
  const picks = st.entites.map(e => {
    const on = !!st.sel[e.id];
    const mode = st.modes[e.id] || 'ecriture';
    const c = e.couleur || 'hsl(220,12%,60%)';
    const sub = e.perso ? 'Patrimoine personnel' : 'Périmètre (SCI / société)';
    const modeRow = on
      ? '<div style="display:flex;gap:8px;margin:8px 0 2px 28px">'
        + '<button type="button" class="btn ' + (mode === 'ecriture' ? 'bp' : 'bs') + ' bb" onclick="_partageSetMode(\'' + e.id + '\',\'ecriture\')">✏️ Écriture</button>'
        + '<button type="button" class="btn ' + (mode === 'lecture' ? 'bp' : 'bs') + ' bb" onclick="_partageSetMode(\'' + e.id + '\',\'lecture\')">👁 Lecture</button>'
        + '</div>'
      : '';
    return '<div style="border:1.5px solid ' + (on ? 'var(--acc)' : 'var(--bor)') + ';border-radius:var(--r);background:' + (on ? 'var(--bg-info,rgba(59,126,246,.10))' : 'var(--sur2)') + ';padding:11px 13px">'
      + '<label style="display:flex;align-items:center;gap:11px;cursor:pointer;margin:0">'
      +   '<input type="checkbox" ' + (on ? 'checked' : '') + ' onchange="_partageToggle(\'' + e.id + '\')" style="width:18px;height:18px;accent-color:var(--acc);flex-shrink:0;cursor:pointer">'
      +   '<span style="width:11px;height:11px;border-radius:3px;flex-shrink:0;background:' + c + '"></span>'
      +   '<span style="flex:1;min-width:0"><span style="font-weight:600;font-size:13.5px;color:var(--t1)">' + escHtml(e.nom) + '</span>'
      +     '<span style="display:block;font-size:11.5px;color:var(--t3)">' + sub + '</span></span>'
      + '</label>' + modeRow
      + '</div>';
  }).join('');
  const n = st.entites.filter(e => st.sel[e.id]).length;
  body.innerHTML =
    '<div class="fg" style="margin-bottom:14px">'
    + '<label>Quel(s) périmètre(s) partager ?' + (n > 0 ? ' <span class="badge blu" style="margin-left:6px">' + n + ' sélectionné' + (n > 1 ? 's' : '') + '</span>' : '') + '</label>'
    + '<div style="display:flex;flex-direction:column;gap:9px">' + picks + '</div>'
    + '<div class="sm" style="color:var(--t3);margin-top:8px;line-height:1.5">Cocher au moins un périmètre, puis choisir le mode pour chacun (<b>Écriture</b> par défaut). Le <b>Perso</b> se partage comme une SCI.</div>'
    + '</div>'
    + '<div class="fg"><label>Email du partenaire <span style="color:var(--red)">(obligatoire)</span></label>'
    +   '<input class="inp" id="partage-invite-email" type="email" placeholder="prénom@exemple.fr" required>'
    +   '<div class="sm" style="color:var(--t3);margin-top:5px">Requis : cet email sera autorisé à créer son compte pour rejoindre le partage.</div></div>'
    + '<div style="background:var(--bg-success,rgba(22,163,74,.10));border:1px solid rgba(22,163,74,.2);border-radius:var(--rl);padding:12px 14px;font-size:12.5px;color:var(--grn);line-height:1.5">'
    +   _uiIcon('gift') + ' <b>Gratuit pendant la bêta</b> · invitations illimitées, lecture et écriture offertes.</div>';
  const genBtn = el('partage-invite-gen');
  if (genBtn) genBtn.disabled = (n === 0);
}

function _partageToggle(id) {
  _partageInvite.sel[id] = !_partageInvite.sel[id];
  if (_partageInvite.sel[id] && !_partageInvite.modes[id]) _partageInvite.modes[id] = 'ecriture';   // Écriture par défaut
  _partageRenderInvite();
}
function _partageSetMode(id, mode) { _partageInvite.modes[id] = mode; _partageRenderInvite(); }

async function _partageGenInvite() {
  const st = _partageInvite;
  const grants = st.entites.filter(e => st.sel[e.id]).map(e => ({ entite_id: e.id, mode: st.modes[e.id] || 'ecriture' }));
  if (!grants.length) { showToast('Choisir au moins un périmètre.', 'err'); return; }
  const emailInp = el('partage-invite-email');
  const email = emailInp ? emailInp.value.trim() : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showToast('Renseigner l\'email du partenaire (il sera autorisé à s\'inscrire).', 'err', 5000); if (emailInp) emailInp.focus(); return; }
  const btn = el('partage-invite-gen');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Génération…'; }
  const r = await window.__immoPartage.createInvite(grants, email);
  if (r && r.error) {
    showToast('Création de l\'invitation impossible : ' + r.error, 'err', 5000);
    if (btn) { btn.disabled = false; btn.textContent = '🔗 Générer l\'invitation'; }
    return;
  }
  // récap des périmètres pour le contexte de la modale de partage
  const noms = st.entites.filter(e => st.sel[e.id]).map(e => e.nom + (st.modes[e.id] === 'lecture' ? ' (lecture)' : '')).join(', ');
  closeM('ov-partage-invite');
  _partageOpenShareModal(r.url, email, noms);
}

// Réutilise EXACTEMENT la modale de partage du bail (#ov-bss-share + canaux _bss*) avec le lien d'invitation.
function _partageOpenShareModal(url, email, perimetres) {
  _openShareModal({
    title: '🤝 Invitation prête',
    ctxIcon: '🤝', ctxTitle: 'Lien d\'invitation sécurisé',
    ctxSub: (perimetres ? 'Périmètres partagés : <b>' + escHtml(perimetres) + '</b>' : 'Lien à partager avec la personne à inviter.'),
    url, linkLabel: 'Lien d\'invitation', email: email || '',
    subject: 'Invitation à gérer mon patrimoine immobilier',
    smsLead: 'Vous êtes invité·e à accéder à mon espace immobilier : ',
    message: 'Bonjour,\n\nJe vous invite à accéder à mon espace de gestion immobilière'
      + (perimetres ? ' (' + perimetres + ')' : '') + '.\n\n'
      + 'Cliquez sur le lien ci-dessous pour créer votre compte (ou vous connecter) et rejoindre l\'espace.\n\n'
      + 'Bien cordialement.',
    info: '🔒 À l\'ouverture du lien, la personne crée son compte (ou se connecte) et rejoint instantanément les périmètres choisis. La révocation de l\'accès reste possible à tout moment depuis cet écran.',
    doneJs: 'rParamsPartage();'
  });
}

// ── Diagnostic DB (utile pour comparer multi-device) ────────────────────────
function showDBDiag() {
  const lines=Object.keys(DB).sort().map(k=>{
    const v=DB[k];
    let count, type;
    if(Array.isArray(v)) { type='array'; count=v.length; }
    else if(v && typeof v==='object') { type='object'; count=Object.keys(v).length; }
    else { type=typeof v; count=v===null?'null':String(v).slice(0,20); }
    return `${k.padEnd(20)} ${type.padEnd(8)} ${count}`;
  });
  const meta=`localStorage   : ${(new Blob(Object.values(localStorage)).size/1024).toFixed(1)} Ko\n──────────────────────────────────────────`;
  const txt=meta+'\n'+lines.join('\n');
  document.getElementById('dbdiag-meta').textContent=`${Object.keys(DB).length} collections — ${(navigator.userAgent.match(/iPhone|iPad|Android/)||['Desktop'])[0]}`;
  document.getElementById('dbdiag-text').value=txt;
  document.getElementById('ov-dbdiag').classList.remove('hidden');
}
function copyDBDiag() {
  const ta=document.getElementById('dbdiag-text');
  ta.select(); ta.setSelectionRange(0,99999);
  try {
    navigator.clipboard.writeText(ta.value).then(
      ()=>showToast('Copié dans le presse-papier ✓','ok',2000),
      ()=>{ document.execCommand('copy'); showToast('Copié ✓','ok',1500); }
    );
  } catch(e){ document.execCommand('copy'); showToast('Copié ✓','ok',1500); }
}

// beforeunload : sauvegarde localStorage synchrone (harnais de test uniquement — en mode cloud,
// __immoSupabaseMode est posé et on ne redescend JAMAIS le DB mémoire en localStorage, cf. audit C1).
window.addEventListener('beforeunload', ()=>{
  // BASCULE SUPABASE (P3) : en mode cloud, le DB en mémoire ne doit JAMAIS redescendre en localStorage
  // (sinon le snapshot cloud écraserait la vraie clé locale prod). Cf. audit C1.
  if (window.__immoSupabaseMode) return;
  // P1.3 : boot CLOUD avant login → DB mémoire VIDE (initDB ne lit plus le miroir) — fermer l'onglet
  // sur l'écran de connexion ne doit pas écraser le miroir prod avec ce vide.
  if (_CLOUD_BOOT) return;
  // localStorage toujours synchrone (mode test)
  try { _miroirEcrire(JSON.stringify(DB)); } catch(e){}   // STOCKAGE lot 1 : écrivain unique (éviction sur quota)
});

// v13.05 — sync localStorage → DB en mémoire quand un autre window/popup écrit.
// Le navigateur déclenche `storage` UNIQUEMENT pour les autres windows de même
// origine (pas la window qui a écrit). Donc parfait pour le cas popup signature
// qui sauvegarde via fallback localStorage : la fenêtre principale se synchronise
// instantanément (bail signé visible sans recharger) et le beforeunload ultérieur
// n'écrase plus nos signatures fraîchement sauvegardées.
window.addEventListener('storage', (e) => {
  // BASCULE SUPABASE (P3) : en mode cloud, ne JAMAIS adopter un état localStorage (cf. audit C2 —
  // contamination cross-onglet : le DB cloud ne doit pas se substituer aux données prod d'un autre onglet).
  if (window.__immoSupabaseMode) return;
  // P1.3 : boot CLOUD avant login → ne rien adopter non plus (l'app est derrière l'overlay ; adopter le
  // miroir écrit par un autre onglet re-créerait le rendu pré-login de données potentiellement d'autrui).
  if (_CLOUD_BOOT) return;
  if (e.key !== KEY || !e.newValue) return;
  // v15.123 ANTI PING-PONG : si le contenu reçu est IDENTIQUE à notre DB actuelle, on
  // ignore (un autre onglet a ré-écrit le même contenu via pull/push, ce n'est pas un
  // vrai changement utilisateur). Sans ce garde-fou, les setItem internes des 2 onglets
  // se renvoyaient la balle en boucle : adopt → render → saveDB → push → setItem →
  // event storage dans l'autre onglet → adopt → … (boucle infinie inter-onglets).
  let _curStr=null; try { _curStr = JSON.stringify(DB); } catch(_){}
  if (_curStr !== null && e.newValue === _curStr) return;
  try {
    const newDB = JSON.parse(e.newValue);
    if (!newDB.baux) return;
    // CROSS-TAB (harnais de test uniquement — le mode cloud est court-circuité plus haut) : cet onglet
    // adopte INTÉGRALEMENT l'état qu'un autre onglet vient d'écrire en localStorage → la modif apparaît
    // instantanément ici. (Drive retiré → plus de dirty-tracking ni d'anti-ping-pong de push.)
    {
      DB = newDB;
      try { if (typeof _rPeriodPage === 'function') _rPeriodPage(); } catch(_){}
      try { if (typeof rBaux === 'function') rBaux(); } catch(_){}
      try { if (typeof rBailleurs === 'function') rBailleurs(); } catch(_){}
      try { if (typeof initFilters === 'function') initFilters(); } catch(_){}
      console.log('[storage] cross-tab : état adopté depuis un autre onglet');
      return;
    }
    let changed = false;
    Object.keys(newDB.baux).forEach(ref => {
      if (!DB.baux[ref]) return;
      const newSig = newDB.baux[ref].signatures;
      const curSig = DB.baux[ref].signatures;
      // Ajout / mise à jour signatures
      if (newSig && (!curSig || curSig.signedAt !== newSig.signedAt)) {
        DB.baux[ref].signatures = newSig;
        changed = true;
      }
      // Suppression signatures (reset depuis autre fenêtre)
      else if (!newSig && curSig) {
        delete DB.baux[ref].signatures;
        changed = true;
      }
    });
    if (changed) {
      try { rBaux(); } catch(e){}
      try { showToast('🔄 Signatures synchronisées depuis le wizard', 'ok', 3000); } catch(e){}
    }
  } catch(err) { console.warn('[storage sync]', err); }
});

// ── EDL TERRAIN lot 2 — « ajoute Propryo à ton écran d'accueil » ────────────
// CDC docs/CDC-EDL.md §3 verrou 4 : non installée, l'app se fait purger ses
// photos et son miroir par Safari au bout de 7 jours. La règle (qui, quand,
// sous quelle forme) est dans le module testé js/core/pwa-install.js ; ici, le
// bandeau et le branchement navigateur.
const PWA_REFUS_KEY = 'propryo_pwa_refus';
let _pwaPrompt = null;          // l'événement Android, s'il est offert
let _pwaEssais = 0;             // app encore derrière l'écran de connexion
let _pwaAttentes = 0;           // page plein écran ouverte / saisie en cours : on repasse plus tard
let _pwaMinuterie = null;       // une seule relance en attente (load ET beforeinstallprompt appellent _pwaInviter)

/** Le navigateur propose l'installation : on garde la main pour la proposer AU BON MOMENT. */
window.addEventListener('beforeinstallprompt', (e) => {
  try { e.preventDefault(); } catch (_) {}
  _pwaPrompt = e;
  _pwaInviter();
});
window.addEventListener('appinstalled', () => { _pwaFermer(false); _pwaPrompt = null; });

/** L'app est-elle encore derrière l'écran de connexion ? */
function _pwaAppVisible() {
  if (document.documentElement.hasAttribute('data-lpboot')) return false;
  const ov = document.getElementById('imsb-overlay');
  if (ov && getComputedStyle(ov).display !== 'none') return false;
  return true;
}

/** Une page plein écran est-elle ouverte ? Mêmes couches que le placement du toast (js/components/toast.js),
 *  plus l'assistant de signature. */
function _pwaCoucheOuverte() {
  for (const n of document.querySelectorAll('.ov:not(.hidden), .edl-page.edl-lpage, #wizV2-overlay')) {
    const c = getComputedStyle(n);
    if (c.display !== 'none' && c.visibility !== 'hidden') return true;
  }
  return false;
}

/** Un champ de saisie a-t-il le focus ? (cases, boutons et curseurs ne sont pas une saisie) */
function _pwaSaisieEnCours() {
  const a = document.activeElement;
  if (!a || a === document.body || a === document.documentElement) return false;
  if (a.isContentEditable) return true;
  const t = String(a.tagName || '').toLowerCase();
  if (t === 'textarea' || t === 'select') return true;
  if (t === 'input') return !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(a.type || 'text');
  return false;
}

function _pwaRelancer(ms) {
  if (_pwaMinuterie) clearTimeout(_pwaMinuterie);
  _pwaMinuterie = setTimeout(() => { _pwaMinuterie = null; _pwaInviter(); }, ms);
}

function _pwaInviter() {
  const M = (typeof window !== 'undefined') ? window.PwaInstall : null;
  if (!M) return;
  if (!_pwaAppVisible()) {
    if (_pwaEssais++ < 6) _pwaRelancer(5000);
    return;
  }
  if (document.getElementById('pwa-invite')) return;
  let refuseA = 0;
  try { refuseA = parseInt(localStorage.getItem(PWA_REFUS_KEY) || '0', 10) || 0; } catch (_) {}
  const d = M.decideInvitation({
    largeur: window.innerWidth,
    installe: M.estInstalle({
      standaloneMedia: !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches),
      navigatorStandalone: !!window.navigator.standalone,
      referrer: document.referrer || ''
    }),
    plateforme: M.detectPlateforme(navigator.userAgent, navigator.maxTouchPoints || 0),
    refuseA,
    maintenant: Date.now(),
    promptDisponible: !!_pwaPrompt,
    coucheOuverte: _pwaCoucheOuverte(),
    saisieEnCours: _pwaSaisieEnCours()
  });
  if (!d.afficher) {
    // Page plein écran ouverte ou saisie en cours : pas maintenant, on repasse (≈ 10 min au plus dans la visite).
    if ((M.MOTIFS_ATTENTE || []).indexOf(d.motif) >= 0 && _pwaAttentes++ < 150) _pwaRelancer(4000);
    return;
  }
  const t = M.texteInvitation(d.mode);
  // Bandeau DANS LE FLUX en tête d'écran, déclaré à _v4SyncBannersHeight (comme le bandeau hors ligne) : .layout
  // prend la hauteur restante, le bandeau ne recouvre donc jamais une action ni un pied collant. Aucun bouton
  // corail : l'écran garde son unique action primaire (M-4) ; « Installer » est un bouton secondaire.
  const box = document.createElement('div');
  box.id = 'pwa-invite';
  box.className = 'pwa-invite';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', t.titre);
  box.innerHTML =
    '<div class="pwa-invite-txt"><strong>' + escHtml(t.titre) + '</strong>'
    + '<span>' + escHtml(t.corps) + '</span></div>'
    + '<div class="pwa-invite-act">'
    + '<button type="button" class="btn pwa-invite-no" id="pwa-invite-no">Plus tard</button>'
    + (t.action ? '<button type="button" class="btn bs pwa-invite-go" id="pwa-invite-go">' + escHtml(t.action) + '</button>' : '')
    + '</div>';
  const layout = document.querySelector('body > .layout');
  if (layout) document.body.insertBefore(box, layout); else document.body.insertBefore(box, document.body.firstChild);
  try { if (typeof _v4SyncBannersHeight === 'function') _v4SyncBannersHeight(); } catch (_) {}
  const no = document.getElementById('pwa-invite-no');
  if (no) no.onclick = () => _pwaFermer(true);
  const go2 = document.getElementById('pwa-invite-go');
  if (go2) go2.onclick = async () => {
    if (!_pwaPrompt) { _pwaFermer(true); return; }
    try { _pwaPrompt.prompt(); await _pwaPrompt.userChoice; } catch (e) { console.warn('[pwa] prompt', e); }
    _pwaPrompt = null;
    _pwaFermer(false);
  };
}

/** @param {boolean} refus — un « plus tard » se souvient 30 jours (module). */
function _pwaFermer(refus) {
  const b = document.getElementById('pwa-invite');
  if (b) b.remove();
  try { if (typeof _v4SyncBannersHeight === 'function') _v4SyncBannersHeight(); } catch (_) {}
  if (refus) { try { localStorage.setItem(PWA_REFUS_KEY, String(Date.now())); } catch (_) {} }
}

// iOS ne donne aucun événement : on tente après le boot.
window.addEventListener('load', () => setTimeout(_pwaInviter, 6000));

// PWA
if('serviceWorker' in navigator && (location.hostname.includes('github.io') || location.hostname === 'app.propryo.fr')){
  window.addEventListener('load', () => {
    // Mémorise s'il y avait déjà un SW actif (= mise à jour, pas première install)
    const hadController = !!navigator.serviceWorker.controller;
    let _reloading = false;
    // Quand un nouveau SW prend le contrôle → rechargement automatique.
    // ⚠️ MAIS JAMAIS en mode cloud (BUG-LOGIN-DOUBLE) : un location.reload() intempestif pendant la
    // fenêtre post-login (résolution espace + hydratation, plusieurs secondes de réseau) détruisait la
    // session et renvoyait à l'écran de connexion (la « double connexion »). La garde était armée sur
    // __immoSupabaseMode, posé APRÈS onLoggedIn → elle laissait justement passer le reload dans cette
    // fenêtre. Elle est désormais armée sur __immoCloudBoot, posé DÈS le boot-gate (head) : en mode
    // cloud, on ne recharge JAMAIS automatiquement. Le SW étant network-first sur HTML+JS, le code frais
    // arrive de toute façon à la prochaine navigation réelle. (Le fix persistSession:true rend en plus
    // un reload inoffensif — la session est retrouvée ; ceci évite le rebond visible.)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      try { window.__immoCrumb && window.__immoCrumb('sw-controllerchange cloud=' + !!window.__immoCloudBoot); } catch(e){}
      if(hadController && !_reloading && !window.__immoCloudBoot){ _reloading = true; try { window.__immoCrumb && window.__immoCrumb('sw-reload'); } catch(e){} location.reload(); }
    });
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}

// SheetJS CDN
(function(){
  const s=document.createElement('script');
  s.src='js/vendor/xlsx-0.20.3.full.min.js'; // self-hosted (plus de cdnjs runtime) ; F-xlsx (audit sécu) : bump SheetJS 0.18.5→0.20.3 → corrige CVE-2023-30533 (prototype pollution) + CVE-2024-22363 (ReDoS)
  document.head.appendChild(s);
})();

// =================== INIT ===================
// P1.3 (audit sync cloud 2026-07-12, cause C-C) — jobs de boot DÉPENDANT DES DONNÉES, extraits 1:1 du
// DOMContentLoaded. En mode legacy/sandbox : appelés au même point qu'avant (comportement inchangé).
// En boot CLOUD : le DOMContentLoaded ne les lance PLUS (le DB y est vide, plus de miroir pré-login) —
// c'est __immoSetDB qui les déclenche UNE fois, post-hydratation, sur les VRAIES données. Double gain :
// plus de popup/rendu calculés sur le miroir d'un autre utilisateur (fuite Marion), et les mutations de
// ces jobs (quittances auto, agenda, purge candidats) ne sont plus JETÉES par l'hydratation — elles
// tournent après elle et se synchronisent au cloud comme toute modif.
let _bootDataJobsDone = false;
function _bootDataJobs() {
  if (_bootDataJobsDone) return;   // one-shot : no-op aux re-pulls suivants (__immoSetDB rappelé à chaque pull)
  // EDL TERRAIN lot 4 — HORS LIGNE, ces travaux d'entretien ne tournent PAS.
  // Ils ÉCRIVENT (révisions IRL, barème, migrations, purges) : le garde 19a les
  // refuse, et l'utilisateur reçoit une volée de messages rouges qu'il n'a rien
  // fait pour provoquer, à l'instant même où il ouvre l'app dans l'appartement.
  // Pire, _applyPendingIRLRevisions annonçait « ✓ N révisions appliquées » sans
  // lire le retour de saveDB : un succès affiché sur une écriture refusée
  // (invariant 19l). On ne pose PAS le drapeau : ils tourneront au retour.
  if (typeof window !== 'undefined' && window.__immoHorsLigne) return;
  _bootDataJobsDone = true;
  // v15.10 IRL-REVISION-UX-FIX Phase A3 : applique automatiquement les révisions IRL
  // dont la date anniversaire (dateApplication) est atteinte. Idempotent.
  if (typeof _applyPendingIRLRevisions === 'function') {
    try { _applyPendingIRLRevisions(); } catch(e) { console.warn('[IRL pending apply]', e); }
  }
  // AUDIT-SUIVI-LOYERS étape 3 : reconstruire le barème de loyer depuis l'existant, une fois.
  // INERTE (aucune surface ne lit encore le barème — étape 4) → ne modifie AUCUN enregistrement
  // existant (baux/IRL intacts). Idempotent (flag). Les incohérences sont recalculées à l'écran.
  if (typeof _migrerLoyerBareme === 'function') {
    try { _migrerLoyerBareme(); } catch(e) { console.warn('[migration barème loyer]', e); }
  }
  // BIENS étape 4 — migration douce N° lot copro : la modale n'a plus qu'un champ (log.lot, le seul
  // synchronisé cloud et lu par la clause de bail). Ce qui avait été saisi dans le doublon log.numLot
  // est reversé une fois dans log.lot s'il est vide. Idempotente, ne supprime rien, ne réécrit jamais
  // un log.lot déjà renseigné. Cœur pur testé : js/core/biens-migration.js.
  if (window._biensMigration && typeof window._biensMigration.numLotVersLot === 'function') {
    try {
      const _mig = window._biensMigration.numLotVersLot(DB.logements || []);
      if (_mig.migres > 0) { _mig.refs.forEach(r => { const l = (DB.logements||[]).find(x => x && x.ref === r); if (l) _stamp(l); }); saveDB(); }
    } catch(e) { console.warn('[migration N° lot copro]', e); }
  }
  // 15/10 — familles des catégories perso : choix validés (catMapping → alias), puis assurance de prêt. Au
  // démarrage, pas seulement à l'ouverture de Finances : l'Accueil et la fiche d'un bien lisent le même moteur.
  if (typeof _finMigrateCatAlias === 'function') { try { _finMigrateCatAlias(); } catch(e) { console.warn('[migration familles]', e); } }
  if (typeof _finMigrateAssuranceEmprunteur === 'function') { try { _finMigrateAssuranceEmprunteur(); } catch(e) { console.warn('[migration assurance emprunteur]', e); } }
  // RETOURS 15/10 (lot 2, point 1) — bail signé hors Propryo : une pièce déposée avant ce lot (sans type) est le bail signé.
  // Idempotente. Cœur pur testé : js/core/bail-pieces-externes.js.
  if (window.BailPiecesExternes && typeof window.BailPiecesExternes.migrerPiecesExternes === 'function') {
    try {
      // Documents d'un espace SCI tiers : laissés tels quels (lus comme « bail signé » de toute façon) — jamais d'écriture refusée
      // en boucle chez un membre en lecture seule (relecture adverse 15/10).
      const _propre = (typeof _optsEspacePropre === 'function') ? _optsEspacePropre().espacePropre : undefined;
      const _bp = window.BailPiecesExternes.migrerPiecesExternes(DB.documents || [], d => d._espaceId == null || (_propre != null && String(d._espaceId) === String(_propre)));
      if (_bp.length) { _bp.forEach(d => _stamp(d)); saveDB(); }
    } catch(e) { console.warn('[migration pièces du bail hors Propryo]', e); }
  }
  // RETOURS 15/10 (lot 2, point 2) — poêle à granulés et insert : les deux échéances « entretien » et « ramonage » deviennent
  // une seule (fiches d'intervention, pièces jointes, rappels d'agenda). Idempotente, rien n'est perdu (anciennes fiches gardées
  // dans `regroupeDe`). Cœur pur testé : js/core/entretien-regroupement.js. Rappels régénérés par agendaAutoSync.
  if (window.EntretienRegroupement && typeof window.EntretienRegroupement.regrouperEntretiens === 'function') {
    try {
      const _rg = window.EntretienRegroupement.regrouperEntretiens(DB, { stamp: _stamp });
      if (_rg.change) { saveDB(); if (typeof agendaAutoSync === 'function') { try { agendaAutoSync(); } catch(e2) {} } }
    } catch(e) { console.warn('[migration entretien + ramonage]', e); }
  }
  // ALERTE-REGUL (14/10) — migration douce : les validations de régul de l'ancien stockage (DB.regulValidations,
  // configuration de l'espace propre, jamais partagée) passent sur les LOGEMENTS du groupe validé (espace propre
  // seulement) → partagées par la SCI. EN DEUX TEMPS : copie d'abord (la clé reste, au cas où l'envoi d'un logement
  // échoue), retrait au démarrage suivant quand tous les logements la portent. Clé sans logement = conservée.
  // Cœur pur testé : js/core/regul-validation.js.
  if (window.RegulValidation && typeof window.RegulValidation.migrerValidationsHeritees === 'function' && DB.regulValidations) {
    try {
      const _mr = window.RegulValidation.migrerValidationsHeritees(DB, Object.assign({ stamp: _stamp }, _optsEspacePropre()));
      if (_mr.copiees > 0 || _mr.retirees > 0) saveDB();
    } catch(e) { console.warn('[migration validations régul]', e); }
  }
  // NORMALISATION-LOYERS : plus d'appel ici (audit 05/10). En local, initDB a normalisé ; en cloud, __immoSetDB
  // programme la normalisation à CHAQUE hydratation (login ET re-pulls), juste avant ces travaux de boot.
  // v15.10 Phase A6 — Audit migration baux existants : détecte des incohérences entre
  // log.hc et le montant attendu selon DB.irlHistorique (legacy avant v15.10).
  // Toast warn uniquement, pas de migration destructive (l'utilisateur audite manuellement).
  setTimeout(() => {
    try {
      if (typeof _loyerHCAtDate !== 'function') return;
      const today = new Date(); today.setHours(0,0,0,0);
      const todayIso = today.toISOString().slice(0,10);
      let incoherences = 0;
      for (const log of (DB.logements||[])) {
        // R-0 : un bail repris sortait de l'audit de cohérence IRL, donc son écart de loyer
        // n'était jamais signalé.
        if (!log || log._deleted || !_lotEstLoue(log)) continue;
        const expected = _loyerHCAtDate(log, todayIso);
        if (expected > 0 && Math.abs((Number(log.hc)||0) - expected) > 1) {
          incoherences++;
          console.warn(`[IRL audit v15.10] Logement ${log.ref} : log.hc=${log.hc} ≠ _loyerHCAtDate=${expected} → mvts à auditer manuellement`);
        }
      }
      if (incoherences > 0 && typeof showToast === 'function') {
        showToast(`⚠ ${incoherences} bail(s) avec incohérence IRL détectée — voir console pour détails`, 'warn', 8000);
      }
    } catch(e) { console.warn('[IRL audit]', e); }
  }, 3500);
  // CDC-QUITTANCES-IRL I13 — AUCUNE quittance n'est créée au démarrage. `_quittancesAutoGenAtBoot`
  // est supprimé : il émettait pour tout bail actif sans regarder le paiement.
  // D20 — en revanche la table IRL, elle, se met à jour seule : lecture de l'API BDM de
  // l'INSEE, au plus une fois par jour, SILENCIEUSE. Hors ligne : échec sans bruit, la table
  // garde ses valeurs et `IRL_DEFAULT` complète (I12).
  if (typeof _irlSyncInsee === 'function') {
    try { _irlSyncInsee(); } catch(e) { /* I12 : jamais bloquant */ }
  }
  agendaAutoSync();   // génération silencieuse des événements depuis les baux
  // Candidature — purge RGPD des non retenus, 30 jours après la DATE DU REFUS (CANDIDATURES-CONFORMITE) :
  // fichiers en ligne, pièces, binaires locaux, copie relais, fiche. Asynchrone (réseau), idempotente ;
  // aussi relancée à l'ouverture de l'onglet Candidats (go → renders.candidats).
  if (typeof _purgeCandidatsRefusesProd === 'function') {
    try { _purgeCandidatsRefusesProd().catch(e => console.warn('[purge candidats refusés]', e)); } catch(e) { console.warn('[purge candidats refusés]', e); }
  }
  // v14.99 Sprint 5A — BUG-PJ-LOCALSTORAGE : migration silencieuse des PJ legacy
  // (m.pj.dataB64) vers IndexedDB + DB.documents. Idempotent, skip si rien à migrer.
  // Délai 1500ms pour ne pas spammer au cold-boot + laisser l'UI se rendre.
  setTimeout(() => {
    if (typeof _migratePjMouvementsToAttachments === 'function') {
      _migratePjMouvementsToAttachments().catch(e => console.warn('[migration PJ] fail', e));
    }
  }, 1500);
  // CDC-QUITTANCES-IRL D22 / I14 — AUCUNE fenêtre ni toast IRL au démarrage. Le rappel des
  // révisions n'ouvre plus de modale au boot (`_checkIRLRappelsAuLogin` supprimée) : il attend
  // sur une PASTILLE de l'entrée de menu « Loyers » (_lyBadgeCount → _renderInboxSurfaces).
  // BAIL-SIGNATURE-DISTANCE C3 (Task 12) : poll des sessions de signature distance en attente.
  setTimeout(() => { try { _pollRemoteSignSessions({ force: true }); } catch (e) {} }, 2500);
  // v14.52 BUG-ENT-ORPHANS-CLEANUP Phase 1 : audit des rattachements orphelins
  // (logements/baux/quittances/mouvements pointant vers une entité inactive).
  // Délai 2200ms pour laisser le dashboard se rendre + ne pas trop spammer.
  setTimeout(_auditOrphansAtBoot, 2200);
  // P1.3 — RATTRAPAGE Storage réactivé : _drvUploadPendingAttachments (écrit v15.29x, jamais appelé)
  // pousse les documents « idb-only » (idbKey sans cloudKey) vers Supabase Storage. Fait fondre le
  // reliquat qui bloque la purge IndexedDB au logout (20/35 docs, forensique 12/07). No-op hors cloud
  // (garde interne __immoCloudUpload) et si rien à pousser ; throttlé.
  setTimeout(() => { try { if (typeof _drvUploadPendingAttachments === 'function') _drvUploadPendingAttachments(); } catch(e) { console.warn('[catchup PJ]', e); } }, 4000);
  // PREMIERS-PAS : les données du compte sont là (après l'hydratation en cloud) → la carte « Premiers pas » et la
  // visite d'un compte neuf peuvent enfin être évaluées (l'Accueil a été rendu AVANT ce drapeau).
  setTimeout(() => { try { if (typeof currentPage !== 'undefined' && currentPage === 'accueil' && window.PremiersPas) window.PremiersPas.carte(); } catch(e) {} }, 0);
}
window.addEventListener('DOMContentLoaded', ()=>{
  // v15.73 — Sauvegarde le footer ORIGINAL du modal bail (cible : openBail/openBailHist).
  // Doit être fait avant tout open de modal pour avoir l'état initial pristine.
  try {
    const _bf = document.querySelector('#ov-bail .m-foot');
    if (_bf) window._ORIG_BAIL_FOOT_HTML = _bf.innerHTML;
  } catch(e) { console.warn('[bail foot original]', e); }
  // v14.61 SANDBOX-MODE : si mode test, afficher un bandeau orange (harnais legacy/démo isolé).
  if (_isTestMode) _injectTestModeBanner();
  // CLOUD-ONLY (cutover Connexion B) : l'overlay de login est injecté par supabase-entry.js et le boot-gate
  // (head, data-lpboot) masque l'app jusqu'au login. Plus aucun portail Drive à afficher au démarrage.
  _applyStoredPrefs(); // thème, taille police, sidebar collapsed — avant tout rendu
  // v14.12.6 : injecte le texte d'engagement (cadre jaune) dans le formulaire EDL
  // une seule fois à l'init. Source = constantes EDL_ENGAGEMENT_* (mêmes que PDF).
  try {
    const _t = el('edl-engagement-titre');  if(_t)  _t.textContent  = EDL_ENGAGEMENT_TITRE;
    const _t1 = el('edl-engagement-txt1');  if(_t1) _t1.textContent = EDL_ENGAGEMENT_TXT1;
    const _t2 = el('edl-engagement-txt2');  if(_t2) _t2.textContent = EDL_ENGAGEMENT_TXT2;
  } catch(e) { console.warn('[EDL engagement] inject fail:', e); }
  // STOCKAGE lot 1 (S-5, D3 A) : retirer les copies héritées AVANT le premier save d'initDB.
  _stockageNettoyer();
  initDB();
  // STOCKAGE lot 2 (D2 C) : filets avant migration et copie de la base illisible de plus de 30 jours
  // retirés d'IndexedDB. Différé : rien d'urgent, on laisse passer le démarrage. Ne lève jamais.
  setTimeout(() => { try { if (typeof _filetsExpirer === 'function') _filetsExpirer(); } catch (e) {} }, 10000);
  // v15.04 USER-PROFILE-FILTERS Phase 3 : applique le filtre sidebar selon le profil
  // (no-op si tous les modules sont CORE et override vide).
  if (typeof _renderSidebarFiltered === 'function') _renderSidebarFiltered();
  // v15.38 DASH-REFONTE-GLOBALE-V4 CP1 : init sidebar V4 (entités épinglées + footer DK).
  // No-op si dashRenderV !== 'v2' (préserve sidebar v1 intacte).
  if (typeof _initSidebarV2 === 'function') _initSidebarV2();
  // P1.3 (audit C-C) : jobs de boot DATA-DÉPENDANTS extraits 1:1 dans _bootDataJobs() (ci-dessus).
  // Legacy/sandbox : exécutés ici même, au même point qu'avant. Boot CLOUD : différés — __immoSetDB
  // les lancera UNE fois sur les données hydratées (plus aucun rendu/calcul/mutation sur le miroir
  // pré-login, plus de popup IRL d'un espace révoqué).
  if (!_CLOUD_BOOT) _bootDataJobs();
  initFilters();
  if (typeof _undoUIInit === 'function') _undoUIInit(); // v14.22 UNDO-OP Phase 2
  // Fill year selector
  const cy=new Date().getFullYear();
  const ys=el('dash-year');
  ys.innerHTML=[cy-2,cy-1,cy,cy+1].map(y=>`<option value="${y}"${y===cy?' selected':''}>${y}</option>`).join('');
  // v15.73 — Boot via go() pour set le titre topbar + bottom nav act state. KPI Lot 3 : le
  // sélecteur d'année est rempli ci-dessus, dash-mois est auto-initialisé par rAccueil au premier
  // rendu (plus de rDash à appeler).
  // v15.408 NAV-HISTORY-BACK (suite audit) — restaurer AUSSI les pages #p-xxx au chargement
  // (F5 sur #p-irl rouvre IRL, comme les fiches). Et ne plus programmer go('accueil') quand
  // un deeplink FICHE est présent : le setTimeout 50 ms écrasait la fiche ouverte par le
  // bloc deeplink ci-dessous (bug latent v15.73).
  const _bootHash  = location.hash || '';
  const _bootFiche = /^#(log|imm|ent)-fiche-/.test(_bootHash);
  const _bootPageM = _bootHash.match(/^#p-([a-z][a-z-]*)$/);
  if (typeof go === 'function' && !_bootFiche) {
    const _bootPage = (_bootPageM && el('p-' + _bootPageM[1])) ? _bootPageM[1] : 'accueil';
    setTimeout(() => { try { go(_bootPage); } catch(e) { console.warn('[boot page]', e); } }, 50);
  }
  // v14.2 LOG-FICHE-360 + v14.3 IMM-FICHE-360 + v14.8 ENT-FICHE-360 : deeplink au boot
  try {
    const mEnt = location.hash.match(/^#ent-fiche-(\d+)$/);
    const mImm = location.hash.match(/^#imm-fiche-(\d+)-(\d+)$/);
    const mLog = location.hash.match(/^#log-fiche-(.+)$/);
    let _bootRouted = false;
    if(mEnt) {
      const entId = +mEnt[1];
      if((DB.entites||[]).some(e => +e.id === entId)) { openEntFiche(entId); _bootRouted = true; }
    } else if(mImm) {
      const entId = +mImm[1], immId = +mImm[2];
      const ent = (DB.entites||[]).find(e => +e.id === entId);
      const im  = ent && (ent.immeubles||[]).find(i => +i.id === immId);
      if(ent && im) { openImmFiche(entId, immId); _bootRouted = true; }
    } else if(mLog) {
      const ref = decodeURIComponent(mLog[1]);
      if((DB.logements||[]).some(l => l.ref === ref)) { openLogFiche(ref); _bootRouted = true; }
    }
    // Deeplink fiche invalide (bien supprimé, autre espace…) → retomber sur l'Accueil.
    if(_bootFiche && !_bootRouted && typeof go === 'function') {
      setTimeout(() => { try { go('accueil'); } catch(e){} }, 50);
    }
  } catch(e){}
  // v15.166 BUG-DEMO-INJECTION : toast bienvenue démo retiré (plus aucune
  // donnée auto-injectée — voir initDB). Un toast d'onboarding clean reste
  // à concevoir pour le 1er boot (futur sujet ONBOARDING).

  // P1.3 : rappels IRL (+1,5 s) et poll signature distance (+2,5 s) déplacés dans _bootDataJobs()
  // (en boot cloud ils tournaient sur le miroir pré-login — c'est LE bug « popup IRL Zito/Fric »).
  // v15.04 USER-PROFILE-FILTERS Phase 1 : wizard 4 questions au 1er load.
  // v15.73 : DÉSACTIVÉ — bloque l'écran au boot. Reste accessible via bouton
  // "Modifier mon profil" dans Paramètres. Default fonctionnel = solo.
  // setTimeout(() => {
  //   try {
  //     if (DB && DB.params && DB.params.profileWizardDone === false
  //         && typeof _profileWizardOpen === 'function') {
  //       _profileWizardOpen();
  //     }
  //   } catch(e) { console.warn('[profile wizard] open fail', e); }
  // }, 2500);
  // P1.3 : audit orphelins (+2,2 s) déplacé dans _bootDataJobs() (données requises).
  // Sidebar overlay close on mobile
  document.addEventListener('click',e=>{
    if(window.innerWidth<=768 && el('sb')?.classList.contains('open')){
      if(!el('sb').contains(e.target)&&e.target!==document.querySelector('.tb-menu')) el('sb').classList.remove('open');
    }
  });
  // Modal connexion Drive — délai pour laisser le dashboard se rendre
  // v13.41 : si user déjà connecté (a un _driveLastSync), tente silent re-grant
  // au lieu d'afficher le modal "Connecter Drive" qui suggère un 1er connect.
  // Si re-grant fail, le callback GIS ouvre _showDriveDisconnectedModal.
  window._appLoadedAt = Date.now();
  // v14.61 SANDBOX-MODE : pas de Drive auto-connect en mode test (isolation totale)
  if (_isTestMode) {
    console.info('[SANDBOX-MODE] Drive auto-connect désactivé (mode test)');
  }
  // v15.131 : la page de connexion est désormais affichée TÔT (début du DOMContentLoaded,
  // voir plus haut), AVANT le rendu du dashboard, pour couvrir l'écran immédiatement → plus
  // de flash "accueil puis page de connexion". L'ancien setTimeout(_showDriveConnectModal,1200)
  // est supprimé (c'est lui qui laissait voir l'accueil 1,2s avant la connexion).
});
