// js/app/incident-circuit-app.js — CIRCUIT D'UN INCIDENT, côté PROPRIÉTAIRE (et associés de la SCI).
// CDC : docs/CDC-INCIDENT-CIRCUIT.md (D1 → D18, GO Didier 14/10/2026). Migration 0060. Maquette : mockups/INCIDENT-CIRCUIT.
//
// Chargé par js/main.js dans TOUS les modes (local comme cloud). Rôles :
//  1. carte « Circuit » de la fiche incident (couche #ov-incident du registre, app-part2.js) et action principale ;
//  2. carnet d'artisans (DB.artisans, table 0060) : migration du carnet calculé d'avant, fiche, note privée ;
//  3. plafond d'intervention directe par structure (entite.incidentReglages), validé une fois (D1) ;
//  4. envoi de la demande à l'artisan : lien sans compte (cloud) ou message prêt à envoyer (local) ;
//  5. entreprises suggérées (annuaire officiel /near_point, liste RGE) triées par distance, critères affichés (D7, D8) ;
//  6. devis au-dessus du plafond (accepter / refuser), lecture IA d'une facture ou d'un devis ;
//  7. VALIDATION FINALE : constat → verdict du moteur (règles inchangées), dépense créée UNE fois par le chemin
//     existant (_incEnregistrerFacture → _mvCreate) ou rattachée, résultat publié au locataire, lien artisan clos à 30 j.
// Aucune règle juridique ni aucun calcul d'argent ici : modules purs incident-circuit.js et qui-paie.js, moteur Finances.
import * as IC from '../core/incident-circuit.js'
import * as EL from '../core/espace-locataire.js'

const W = window
const G = (n) => (typeof W[n] === 'function' ? W[n] : null)
const API = () => (W.__immoIncidentCircuit && W.__immoIncidentCircuit.pret() ? W.__immoIncidentCircuit : null)
const db = () => { try { return DB } catch (e) { return null } }   // eslint-disable-line no-undef
const etatInc = () => { try { return _incState } catch (e) { return null } }   // eslint-disable-line no-undef
const esc = (s) => (G('escHtml') ? W.escHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])))
const js = (v) => esc(JSON.stringify(v))   // argument d'un onclick (attribut entre guillemets doubles)
const ico = (n, s) => (G('_uiIcon') ? W._uiIcon(n, s) : '')
const toast = (m, t, d) => { if (G('showToast')) W.showToast(m, t || 'ok', d) }
const fdate = (s) => (G('fd') ? W.fd(String(s || '').slice(0, 10)) : String(s || '').slice(0, 10))
const fdh = (s) => { const d = new Date(s); if (isNaN(d)) return ''; return fdate(d.toISOString()) + ' à ' + String(d.getHours()).padStart(2, '0') + ' h ' + String(d.getMinutes()).padStart(2, '0') }
const euros = (n) => (n == null ? '' : (G('fmt') ? W.fmt(Number(n)) : Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })))
const vivant = (o) => o && !o._deleted
const QP = () => W.QuiPaie
const IN = () => W.Incidents

const etat = { acces: new Map(), depots: new Map(), lu: new Map(), relais: null, sugg: new Map(), geo: new Map(), choix: null, lecture: new Map(), valid: new Map(), filtreMetier: null, envoi: new Set() }

// ─────────────────────────── Accès aux données de l'app ───────────────────────────
const incidentDe = (id) => (G('_incGet') ? W._incGet(id) : null)
const logDe = (ref) => ((db() || {}).logements || []).find((l) => vivant(l) && l.ref === ref) || null
function entiteDe(inc) {
  const log = inc && inc.logRef ? logDe(inc.logRef) : null
  const nom = (inc && inc.entity) || (log && log.entity) || ''
  const ents = ((db() || {}).entites || []).filter((e) => vivant(e) && e.nom === nom)
  // Deux structures homonymes (la sienne et une SCI partagée) : celle de l'espace de l'incident d'abord.
  const esp = (inc && inc._espaceId) || (log && log._espaceId) || null
  return (esp != null && ents.find((e) => e._espaceId === esp)) || ents[0] || null
}
// ─────────────────────────── Droit d'écriture par structure (SCI partagée) ───────────────────────────
// Le plafond (entite.incidentReglages) et le carnet (table artisans) sont rattachés à la SCI et partagés entre ses
// membres. Modifiables par le propriétaire et les gestionnaires de la SCI ; visibles en lecture seule des autres
// membres. Règle unique : window.__immoPeutEcrireSci (store-multi peutEcrireSci, la même que le routage et la RLS).
const lectureSeuleApp = () => { try { return !!_appReadOnly } catch (e) { return false } }   // eslint-disable-line no-undef
// Empêchement de tout l'appareil (pas d'une structure) : hors ligne, application en lecture seule. '' sinon.
const motifGlobal = () => (W.__immoHorsLigne === true ? 'Hors ligne : les modifications reprennent une fois la connexion revenue.'
  : lectureSeuleApp() ? 'Accès en lecture seule : modification impossible.' : '')
function droit(espaceId, nom) {
  const g = motifGlobal(); if (g) return { ok: false, motif: g }
  const f = G('__immoPeutEcrireSci')
  if (!f || W.__immoSupabaseMode !== true) return { ok: true, motif: '' }   // mode local : tout est au compte
  return f(espaceId == null ? null : espaceId, nom || '') === true ? { ok: true, motif: '' }
    : { ok: false, motif: 'Accès en lecture seule à ' + (nom || 'cette structure') + ' : le plafond et le carnet s\'y règlent par son propriétaire ou un gestionnaire.' }
}
const droitEnt = (ent) => (ent ? droit(ent._espaceId, ent.nom) : { ok: false, motif: 'Structure introuvable : rattacher le bien à une structure.' })
// Droit sur la structure d'un incident (structure introuvable : celle du nom porté par l'incident).
const droitInc = (inc) => { const e = entiteDe(inc); return e ? droitEnt(e) : droit(null, (inc && inc.entity) || '') }
const droitArtisan = (a) => droit(a && a._espaceId, a && a.entity)
const refuser = (d) => { toast(d.motif, 'warn', 6000); return false }
// Un artisan créé pour une structure vit dans l'espace de cette structure (SCI partagée → espace de son propriétaire).
const dansEspaceDe = (a, ent) => { if (ent && ent._espaceId != null) a._espaceId = ent._espaceId; return a }
const reglagesDe = (inc) => IC.normaliserReglages((entiteDe(inc) || {}).incidentReglages)
// Métier de l'incident : choisi dans le circuit, sinon celui de l'élément. Élément « autre » (signalement sans aide de
// l'IA, élément non reconnu) : AUCUN métier supposé → aucun artisan proposé ni prévenu, le propriétaire choisit.
function metierDe(inc) {
  const d = QP() && inc ? QP().elementDef(inc.element) : null
  return (inc && inc.circuit && inc.circuit.metier) || (d && d.metier) || null
}
const metierLbl = (m) => (m ? ((IN() && IN().NAF_METIERS[m]) || {}).lbl || m : 'métier à préciser')
function artisans() { const D = db(); if (!D) return []; if (!Array.isArray(D.artisans)) D.artisans = []; return D.artisans }
const artisanDe = (id) => artisans().find((a) => vivant(a) && String(a.id) === String(id)) || null
function persisterInc(inc, avant) { if (G('_incPersister')) W._incPersister(inc, 'update', avant) }
function persisterArtisan(a, action) {
  if (G('_stamp')) W._stamp(a)
  if (G('_auditLog')) W._auditLog(action || 'update', 'artisan', a.id, a.nom)
  if (G('saveDB')) W.saveDB()
}
const rerender = () => { if (G('_incRender') && etatInc()) W._incRender() }
const aller = (v) => { if (G('_incGo')) W._incGo(v) }

// ─────────────────────────── Migration du carnet calculé (D5, « migrer, pas tolérer ») ───────────────────────────
function migrerCarnet() {
  const D = db(); if (!D || !IN()) return 0
  const derive = IN().carnetArtisans(D.incidents || [], D.equipements || {})
  // Tous les existants (supprimés compris) : une fiche supprimée par le propriétaire n'est jamais recréée.
  const tous = (Array.isArray(D.artisans) ? D.artisans : []).map((a) => ({ ...a, _deleted: false }))
  // Structure de chaque artisan déduit = celle du logement de l'incident d'origine (entiteDe : l'espace du logement
  // départage deux SCI homonymes, la sienne et une partagée).
  const structureDe = new Map()
  const nouveaux = IC.migrationCarnet(derive, tous, (x) => { const l = x.logRef ? logDe(x.logRef) : null; structureDe.set(x, l ? entiteDe({ logRef: x.logRef }) : null); return (l && l.entity) || '' }, new Date().toISOString())
  const ents = (D.entites || []).filter(vivant)
  const entDe = (a) => { for (const [x, e] of structureDe) if (e && e.nom === a.entity && String(x.nom || '').trim() === a.nom) return e; return ents.find((e) => e.nom === a.entity) || null }
  // Seulement dans un carnet modifiable (SCI partagée en lecture seule : son carnet appartient à ses gestionnaires).
  const aCreer = nouveaux.map((a) => [a, entDe(a)]).filter(([a, e]) => (e ? droitEnt(e).ok : droit(null, a.entity).ok))
  if (!aCreer.length) return 0
  for (const [a, e] of aCreer) { a.id = G('nid') ? W.nid() : Date.now() + Math.random(); dansEspaceDe(a, e); if (G('_stamp')) W._stamp(a); artisans().push(a) }
  if (G('saveDB')) W.saveDB()
  return aCreer.length
}

// ─────────────────────────── Cloud : liens et dépôts de l'incident ───────────────────────────
const cleInc = (inc) => String(inc.id)
async function chargerCircuit(inc, force) {
  const a = API(); if (!a || !inc) return
  const k = cleInc(inc), t = etat.lu.get(k)
  if (!force && t && Date.now() - t < 30_000) return
  etat.lu.set(k, Date.now())
  try {
    const acces = await a.select('artisan_acces', { incident_legacy_id: String(inc.id) }, 'id,espace_id,artisan_nom,artisan_email,artisan_tel,metier,plafond_ttc,emis_le,revoque_le,valide_le,derniere_visite,creneau_date,creneau_debut,creneau_fin,creneau_confirme_le,creneau_accord_expres,constat,constat_sous_type,constat_ampleur,constat_resume,constat_le,signalement_id')
    acces.sort((x, y) => String(y.emis_le).localeCompare(String(x.emis_le)))
    etat.acces.set(k, acces)
    const ids = acces.map((x) => x.id)
    const deps = ids.length ? await a.select('artisan_depots', { acces_id: ids }, 'id,acces_id,type_depot,storage_path,nom,mime,montant_ttc,numero,statut,decide_le,cree_le') : []
    for (const id of ids) etat.depots.set(id, deps.filter((d) => d.acces_id === id).sort((x, y) => String(x.cree_le).localeCompare(String(y.cree_le))))
  } catch (e) { console.warn('[circuit] chargement', e && e.message) }
}
const accesActif = (inc) => (etat.acces.get(cleInc(inc)) || []).find((x) => !x.revoque_le) || null
const depotsDe = (x) => (x ? etat.depots.get(x.id) || [] : [])
async function etatRelais() {
  if (etat.relais) return etat.relais
  try { const cfg = G('_relayCfg') ? W._relayCfg() : null; const r = cfg ? await fetch(cfg.base + '/el/etat', { cache: 'no-store' }) : null; etat.relais = r && r.ok ? await r.json() : { actif: false, emails: false } }
  catch (e) { etat.relais = { actif: false, emails: false } }
  return etat.relais
}

// ─────────────────────────── Carte « Circuit » de la fiche ───────────────────────────
function verdictVisible(inc) { return !!(inc && (inc.constat || (inc.cause && inc.cause !== 'inconnue') || inc.payeurRetenu || inc.valideLe)) }
function verdictAttenteHtml() {
  return `<div class="inc-vd"><div class="inc-vd-top"><div class="inc-k">Qui paie</div>
    <div class="inc-vd-why">${ico('clock', 14)} Établi à la fin, sur le constat de l'artisan ou la facture, avec les textes de loi. Aucune cause n'est affichée avant : ni au locataire, ni ici.</div></div></div>`
}
function etapes(inc) {
  const x = accesActif(inc), deps = depotsDe(x)
  const e = [
    ['Signalé', true],
    ['Artisan prévenu', !!(x || (inc.circuit && inc.circuit.accesId) || inc.artisan)],
    ['Devis', deps.some((d) => d.type_depot === 'devis' && d.statut !== 'refuse')],
    ['Constat', !!(inc.constat || (x && x.constat))],
    ['Validé', !!inc.valideLe],
  ]
  return `<div class="inc-flow">${e.map(([l, ok]) => `<span class="inc-badge${ok ? ' pos' : ''}">${ok ? ico('check', 12) + ' ' : ''}${esc(l)}</span>`).join('')}</div>`
}
function lignePlafond(inc) {
  const r = reglagesDe(inc), ent = entiteDe(inc), m = metierDe(inc), p = IC.plafondPour(r, m)
  const qui = ent ? ent.nom : 'cette structure'
  return `<div class="inc-row"><span class="k">Plafond sans accord</span><span class="v">${r.valideLe ? esc(euros(p)) + ' TTC' + (m ? ' (' + esc(metierLbl(m).toLowerCase()) + ')' : '') : 'Non validé : tout devis passe par ici'}
    <button type="button" class="inc-lien" onclick="_incGo('plafond')">${ent && !droitEnt(ent).ok ? 'Voir' : r.valideLe ? 'Modifier' : 'Régler'}</button></span></div>${ent ? '' : `<div class="inc-note">${ico('info', 13)} Structure de l'incident introuvable : plafond réglé pour ${esc(qui)}.</div>`}`
}
function carteHtml(inc) {
  try {
    if (!inc) return ''
    if (API() && !etat.lu.has(cleInc(inc))) chargerCircuit(inc).then(rerender)
    const x = accesActif(inc), deps = depotsDe(x)
    let corps = ''
    if (inc.valideLe) {
      const p = inc.payeurRetenu || (inc.verdict && inc.verdict.payeur)
      corps += `<div class="inc-note pos">${ico('check', 13)} Validé le ${esc(fdh(inc.valideLe))} · ${esc(((QP() && QP().PAYEUR_LBL[p]) || p || '').toLowerCase())}${inc.resultatPublieLe ? ' · résultat publié au locataire' : ''}</div>`
      if (inc.remboursement && inc.remboursement.montant) corps += `<div class="inc-row"><span class="k">Demandé au locataire</span><span class="v">${esc(euros(inc.remboursement.montant))} · ${inc.remboursement.recuLe ? 'remboursé le ' + esc(fdate(inc.remboursement.recuLe)) : 'en attente'}
        <button type="button" class="inc-lien" onclick="IncCircuit.rembourse(${js(String(inc.id))})">${inc.remboursement.recuLe ? 'Annuler' : 'Marquer remboursé'}</button></span></div>`
      // Dépôts de l'artisan arrivés APRÈS la validation (le lien reste ouvert 30 jours pour la facture, D14).
      for (const d of deps.filter((y) => y.type_depot !== 'photo' && String(y.cree_le) > String(inc.valideLe))) {
        const joint = dansLeDossier(inc, d)
        corps += `<div class="inc-pro"><span class="n">${d.type_depot === 'devis' ? 'Devis' : 'Facture'}${d.numero ? ' ' + esc(d.numero) : ''} · ${esc(euros(d.montant_ttc))}</span><span class="m">Déposé le ${esc(fdate(d.cree_le))}, après la validation${joint ? ' · dans le dossier' : ''}</span>
          <span class="a"><button type="button" class="btn bs bb" onclick="IncCircuit.ouvrirDepot(${js(d.id)})">${ico('eye', 13)} Ouvrir</button>${joint ? '' : '<button type="button" class="btn bs bb" onclick="IncCircuit.joindre(' + js(String(inc.id)) + ',' + js(d.id) + ')">' + ico('link', 13) + ' Joindre au dossier</button>'}</span></div>`
      }
      if (inc.espaceSignalementId && !inc.resultatPublieLe && API()) corps += `<div class="inc-step-acts"><button type="button" class="btn bs bb" id="inc-pub" onclick="IncCircuit.publier(${js(String(inc.id))})">${ico('send', 13)} Publier le résultat au locataire</button></div>`
    } else if (x) {
      corps += `<div class="inc-row"><span class="k">Artisan</span><span class="v">${esc(x.artisan_nom)} · prévenu le ${esc(fdate(x.emis_le))}${x.derniere_visite ? ' · page ouverte' : ''}</span></div>`
      corps += `<div class="inc-row"><span class="k">Rendez-vous</span><span class="v">${x.creneau_date ? esc(fdate(x.creneau_date)) + (x.creneau_debut ? ' ' + esc(x.creneau_debut.slice(0, 5).replace(':', ' h ')) + (x.creneau_fin ? '–' + esc(x.creneau_fin.slice(0, 5).replace(':', ' h ')) : '') : '') + (x.creneau_confirme_le ? ' · confirmé par le locataire' : ' · à confirmer par le locataire') : 'Pas encore proposé'}</span></div>`
      for (const d of deps.filter((y) => y.type_depot !== 'photo')) {
        const st = d.statut ? ' · ' + (IC.STATUTS_DEVIS[d.statut] || d.statut).toLowerCase() : ''
        corps += `<div class="inc-pro"><span class="n">${d.type_depot === 'devis' ? 'Devis' : 'Facture'}${d.numero ? ' ' + esc(d.numero) : ''} · ${esc(euros(d.montant_ttc))}</span><span class="m">Déposé le ${esc(fdate(d.cree_le))}${esc(st)}</span>
          <span class="a"><button type="button" class="btn bs bb" onclick="IncCircuit.ouvrirDepot(${js(d.id)})">${ico('eye', 13)} Ouvrir</button>${d.type_depot === 'devis' && d.statut === 'en_attente' ? `<button type="button" class="btn bs bb" onclick="_incGo('devis')">${ico('check', 13)} Répondre</button>` : d.type_depot === 'devis' ? `<button type="button" class="btn bs bb" onclick="_incGo('devis')">${ico('sparkle', 13)} Vérifier le montant</button>` : ''}</span></div>`
      }
      const nPh = deps.filter((y) => y.type_depot === 'photo').length
      if (nPh) corps += `<div class="inc-row"><span class="k">Photos de l'artisan</span><span class="v">${nPh} <button type="button" class="inc-lien" onclick="IncCircuit.ouvrirPhotos(${js(String(inc.id))})">Voir</button></span></div>`
      if (x.constat) corps += `<div class="inc-row"><span class="k">Constat de l'artisan</span><span class="v">${esc([IC.constatLbl(x.constat), IC.ampleurLbl(x.constat_ampleur)].filter(Boolean).join(' · '))}</span></div>`
      corps += `<div class="inc-step-acts"><button type="button" class="btn bs bb" onclick="IncCircuit.renvoyer(${js(String(inc.id))})">${ico('send', 13)} Renvoyer le lien</button><button type="button" class="btn bs bb" onclick="_incGo('artisan')">${ico('people', 13)} Changer d'artisan</button><button type="button" class="btn bs bb" onclick="IncCircuit.retirer(${js(String(inc.id))})">${ico('close', 13)} Retirer le lien</button></div>`
    } else {
      const a = artisanPropose(inc)
      corps += a ? `<div class="inc-row"><span class="k">Artisan du carnet</span><span class="v">${esc(a.nom)} (${esc(metierLbl(metierDe(inc)).toLowerCase())})</span></div>`
        : metierDe(inc) ? `<div class="inc-note">${ico('info', 13)} Aucun artisan du carnet pour ${esc(metierLbl(metierDe(inc)).toLowerCase())} : choisir dans la liste des entreprises autour du logement.</div>`
        : `<div class="inc-note">${ico('info', 13)} Métier à préciser : aucun artisan n'est proposé ni prévenu tant que le métier n'est pas choisi.</div>`
      if (inc.artisan && inc.artisan.nom) corps += `<div class="inc-row"><span class="k">Artisan noté</span><span class="v">${esc(inc.artisan.nom)}</span></div>`
    }
    if (!inc.valideLe) corps += lignePlafond(inc)
    if (!inc.valideLe) corps += `<div class="inc-step-acts"><button type="button" class="btn bs bb" onclick="_incGo('facture-ia')">${ico('doc', 13)} Déposer la facture</button><button type="button" class="btn bs bb" onclick="_incGo('valider')">${ico('check', 13)} Valider la fin</button></div>`
    return `<div class="inc-card-b"><div class="inc-k">Circuit</div>${etapes(inc)}${corps}</div>`
  } catch (e) { console.warn('[circuit] carte', e); return '' }
}
// L'artisan que Propryo prévient (carnet, métier, structure) ; sinon le premier artisan joignable du carnet pour ce métier.
function artisanPropose(inc) {
  if (!metierDe(inc)) return null
  const ctx = { metier: metierDe(inc), entity: (entiteDe(inc) || {}).nom || inc.entity || '', incidents: (db() || {}).incidents || [] }
  return IC.artisanAPrevenir(artisans(), ctx) || IC.artisansPourMetier(artisans(), ctx).find(IC.joignable) || null
}
/** Action principale de la fiche (M-4). null = comportement d'avant ; '' = aucune action principale (attente). */
function piedHtml(inc) {
  if (!inc || inc.valideLe) return null
  const x = accesActif(inc), deps = depotsDe(x)
  if (deps.some((d) => d.type_depot === 'devis' && d.statut === 'en_attente')) return `<button type="button" class="btn bp" onclick="_incGo('devis')">${ico('check', 14)} Répondre au devis</button>`
  if (inc.constat || (x && x.constat) || deps.some((d) => d.type_depot === 'facture')) return `<button type="button" class="btn bp" onclick="_incGo('valider')">${ico('check', 14)} Valider la fin</button>`
  if (x || (inc.artisan && inc.artisan.nom)) return ''
  if (!droitInc(inc).ok) return ''   // structure en lecture seule : ni envoi ni choix d'artisan (la base les refuserait)
  const a = artisanPropose(inc)
  if (a) return `<button type="button" class="btn bp" onclick="IncCircuit.envoyer(${js(String(inc.id))},${js(String(a.id))})">${ico('send', 14)} Envoyer la demande à ${esc(a.nom)}</button>`
  return `<button type="button" class="btn bp" onclick="_incGo('artisan')">${ico('people', 14)} Choisir un artisan</button>`
}

// ─────────────────────────── Vue « artisan » : carnet, suggestions, assistance ───────────────────────────
function ligneArtisan(inc, a, extra) {
  const d = IC.derniereIntervention(a, (db() || {}).incidents || [])
  const infos = [a.metiers.map(metierLbl).join(', '), a.tel, a.email, d ? 'dernière intervention le ' + fdate(d) : ''].filter(Boolean).join(' · ')
  return `<div class="inc-pro"><span class="n">${esc(a.nom)}${a.prevenirAuto ? ' <span class="inc-badge pos">' + ico('check', 12) + ' Prévenu directement</span>' : ''}</span><span class="m">${esc(infos)}${a.notePrivee ? `<br><span class="inc-sub">${ico('lock', 12)} ${esc(a.notePrivee)}</span>` : ''}</span>
    <span class="a">${droitInc(inc).ok ? `<button type="button" class="btn bs bb" onclick="IncCircuit.envoyer(${js(String(inc.id))},${js(String(a.id))})">${ico('send', 13)} Envoyer la demande</button>` : ''}
    <button type="button" class="btn bs bb" onclick="IncCircuit.editer(${js(String(a.id))})">${ico('edit', 13)} Fiche</button>
    <a class="btn bs bb" href="${esc(IC.lienAvisEnLigne(a.nom, a.commune))}" target="_blank" rel="noopener noreferrer">${ico('external', 13)} Voir les avis en ligne</a>${extra || ''}</span></div>`
}
function vueArtisan(inc) {
  const m = etat.filtreMetier || metierDe(inc)
  const ent = entiteDe(inc)
  const ctx = { metier: m, entity: ent ? ent.nom : (inc.entity || ''), incidents: (db() || {}).incidents || [] }
  // Structure en lecture seule (SCI partagée sans droit d'écriture) : ni ajout au carnet, ni choix, ni envoi.
  const ecrire = droitInc(inc).ok
  const ajout = ecrire ? `<button type="button" class="btn bs bb" style="margin-top:6px" onclick="IncCircuit.editer(null)">${ico('plus', 13)} Ajouter un artisan au carnet</button>` : ''
  const carnet = IC.artisansPourMetier(artisans(), ctx)
  const autres = artisans().filter((a) => vivant(a) && !carnet.includes(a) && (!ctx.entity || !a.entity || a.entity === ctx.entity))
  const metiers = Object.entries(IN().NAF_METIERS)
  const s = m ? etat.sugg.get(cleInc(inc) + '|' + m) : null
  let sugg = ''
  if (!m) sugg = ''
  else if (!s) sugg = `<button type="button" class="btn bs" onclick="IncCircuit.suggerer(${js(String(inc.id))})">${ico('search', 14)} Chercher les entreprises autour du logement (${esc(metierLbl(m).toLowerCase())})</button>`
  else if (s.etat === 'charge') sugg = `<div class="inc-note">${ico('clock', 13)} Recherche en cours (annuaire officiel${IC.metierEnergie(m) ? ', liste RGE' : ''})…</div>`
  else if (s.etat === 'erreur') sugg = `<div class="inc-note">${ico('warn', 13)} ${esc(s.message || 'L\'annuaire ne répond pas.')} <button type="button" class="inc-lien" onclick="IncCircuit.suggerer(${js(String(inc.id))})">Réessayer</button></div>`
  else if (!s.liste.length) sugg = `<div class="inc-note">Aucune entreprise active trouvée pour ce métier à ${esc(String(s.rayon))} km.</div>`
  else {
    sugg = s.liste.slice(0, s.tout ? 40 : 10).map((x, i) => `<div class="inc-pro"><span class="n">${esc(x.nom)}${x.dejaUtilise ? ' <span class="inc-badge pos">' + ico('check', 12) + ' Déjà utilisée' + (x.derniere && x.derniere !== '0000-00-00' ? ' (' + esc(fdate(x.derniere)) + ')' : '') + '</span>' : ''}</span>
      <span class="m">${esc(String(x.distanceKm).replace('.', ','))} km · ${esc(x.commune || x.adresse)}${x.anneeCreation ? ' · créée en ' + x.anneeCreation : ''} · active${x.rge ? ' · RGE' : ''} · NAF ${esc(x.naf)}${x.tel ? ' · ' + esc(x.tel) : ''}</span>
      <span class="a">${ecrire ? `<button type="button" class="btn bs bb" onclick="IncCircuit.choisir(${js(String(inc.id))},${i})">Choisir</button>` : ''}
      <a class="btn bs bb" href="${esc(IC.lienFicheOfficielle(x.siret) || '#')}" target="_blank" rel="noopener noreferrer">${ico('external', 13)} Fiche officielle</a>
      <a class="btn bs bb" href="${esc(IC.lienAvisEnLigne(x.nom, x.commune))}" target="_blank" rel="noopener noreferrer">${ico('external', 13)} Voir les avis en ligne</a></span></div>`).join('')
      + (s.liste.length > 10 && !s.tout ? `<button type="button" class="btn bs bb" onclick="IncCircuit.toutVoir(${js(String(inc.id))})">Voir les ${s.liste.length - 10} autres</button>` : '')
  }
  const ass = IN().assistances({ mrh: (db() || {}).mrh || [], assurances: (db() || {}).assurances || [], logRef: inc.logRef, imm: inc.imm })
  const tel = (t) => (t ? `<a class="btn bs bb" href="tel:${esc(String(t).replace(/[^\d+]/g, ''))}">${ico('phone', 13)} Appeler</a>` : '')
  const devis = QP().TEXTES['devis-2017'] && G('_incCite') ? W._incCite(Object.assign({ id: 'devis-2017' }, QP().TEXTES['devis-2017'])) : ''
  return {
    titre: 'Choisir un artisan', sub: (G('_incElLbl') ? W._incElLbl(inc) : '') + ' · ' + (G('_incBienLbl') ? W._incBienLbl(inc) : ''),
    body: `
  <div class="inc-f inc-metier"><label class="inc-lb" for="inc-c-metier">Métier</label><select class="inp" id="inc-c-metier" onchange="IncCircuit.metier(this.value)">${m ? '' : '<option value="" selected disabled>Choisir le métier</option>'}${metiers.map(([k, x]) => `<option value="${esc(k)}"${k === m ? ' selected' : ''}>${esc(x.lbl)}</option>`).join('')}</select></div>
  ${!m ? `<div class="inc-note">${ico('info', 13)} Choisir le métier : le carnet et les entreprises autour du logement s'affichent ensuite.</div>
  ${ajout}` : `
  <div class="inc-grp"><div class="inc-grp-h"><h4>${ico('book', 15)} Carnet de ${esc(ent ? ent.nom : 'la structure')}</h4><span class="inc-sub">${esc(metierLbl(m))} · le plus récemment intervenu d'abord</span></div>
    ${carnet.length ? carnet.map((a) => ligneArtisan(inc, a)).join('') : `<div class="inc-note">Aucun artisan du carnet pour ce métier.</div>`}
    ${autres.length ? `<details class="inc-det"><summary>Autres artisans du carnet (${autres.length})</summary>${autres.map((a) => ligneArtisan(inc, a)).join('')}</details>` : ''}
    ${ajout}</div>
  <div class="inc-grp"><div class="inc-grp-h"><h4>${ico('search', 15)} Entreprises autour du logement</h4><span class="inc-sub">${esc(metierLbl(m))} (${esc(IN().NAF_METIERS[m].naf)})</span></div>
    <div class="inc-guard neutre"><b>Critères (faits publics)</b><ol>${IC.CRITERES.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>${esc(IC.MENTION_SUGGESTIONS)} L'adresse du logement est envoyée à la Base adresse nationale pour la situer ; seuls le code d'activité et cette position sont envoyés à l'annuaire de l'État et à l'ADEME.</div>
    ${sugg}</div>`}
  <div class="inc-grp"><div class="inc-grp-h"><h4>${ico('shield', 15)} Urgence : assistance des assurances</h4></div>
    <div class="inc-pro"><span class="n">Assurance habitation du locataire${ass.mrh.compagnie ? ' — ' + esc(ass.mrh.compagnie) : ''}</span><span class="m">${ass.mrh.tel ? 'Assistance : ' + esc(ass.mrh.tel) : 'Numéro non renseigné'}</span><span class="a">${tel(ass.mrh.tel)}</span></div>
    <div class="inc-pro"><span class="n">PNO du bailleur${ass.pno.compagnie ? ' — ' + esc(ass.pno.compagnie) : ''}</span><span class="m">${ass.pno.tel ? 'Assistance : ' + esc(ass.pno.tel) : 'Numéro non renseigné'}</span><span class="a">${tel(ass.pno.tel)}</span></div></div>
  <div class="inc-guard"><b>Avant toute intervention : un devis détaillé.</b> Sous le plafond, le devis déposé par l'artisan sur sa page est accepté automatiquement au nom du propriétaire ; au-delà, il arrive ici.${devis}</div>`,
    foot: `<button type="button" class="btn bs" onclick="_incGo('fiche')">${ico('chevron-left', 14)} Retour à l'incident</button>`,
  }
}
async function geocoder(inc) {
  const k = cleInc(inc); if (etat.geo.has(k)) return etat.geo.get(k)
  const log = inc.logRef ? logDe(inc.logRef) : null
  const cp = G('_incCodePostal') ? W._incCodePostal(inc) : ''
  const adr = [(log && log.adr) || '', cp && !String((log && log.adr) || '').includes(cp) ? cp : ''].filter(Boolean).join(' ')
  if (!adr) return null
  const r = await fetch('https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(adr) + '&limit=1', { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error('adresse')
  const f = ((await r.json()).features || [])[0]
  const c = f && f.geometry && f.geometry.coordinates
  const g = c ? { lat: c[1], lon: c[0], cp: f.properties && f.properties.postcode } : null
  etat.geo.set(k, g)
  return g
}
async function suggerer(incId) {
  const inc = incidentDe(incId); if (!inc) return
  const m = etat.filtreMetier || metierDe(inc); if (!m) return
  const cle = cleInc(inc) + '|' + m
  etat.sugg.set(cle, { etat: 'charge', liste: [] }); rerender()
  try {
    const g = await geocoder(inc)
    if (!g) throw Object.assign(new Error('Adresse du logement introuvable : la compléter sur la fiche du bien.'), { lisible: true })
    const naf = IN().NAF_METIERS[m].naf
    let liste = [], rayon = IC.RAYONS_KM[0]
    for (rayon of IC.RAYONS_KM) {
      const vus = new Map(liste.map((x) => [x.siren, x]))
      for (const page of [1, 2]) {
        const u = IC.urlNearPoint({ lat: g.lat, lon: g.lon, rayonKm: rayon, metier: m, page })
        const r = await fetch(u, { headers: { Accept: 'application/json' } })
        if (!r.ok) throw new Error('annuaire ' + r.status)
        const j = await r.json()
        for (const x of IC.lireNearPoint(j, { lat: g.lat, lon: g.lon, naf })) if (!vus.has(x.siren) || vus.get(x.siren).distanceKm > x.distanceKm) vus.set(x.siren, x)
        if (!j.total_pages || page >= j.total_pages) break
      }
      liste = [...vus.values()]
      if (liste.length >= IC.SUGGESTIONS_MIN) break
    }
    if (IC.metierEnergie(m)) {
      try { const r = await fetch(IC.urlRgeGeo({ lat: g.lat, lon: g.lon, rayonKm: Math.max(10, rayon), metier: m }), { headers: { Accept: 'application/json' } }); if (r.ok) liste = IC.fusionnerRge(liste, IC.lireRgeGeo(await r.json(), new Date().toISOString())) }
      catch (e) { /* la liste RGE est un complément : l'annuaire suffit */ }
    }
    etat.sugg.set(cle, { etat: 'ok', rayon, liste: IC.trierSuggestions(liste, artisans(), (db() || {}).incidents || []) })
  } catch (e) { console.warn('[circuit] suggestions', e && e.message); etat.sugg.set(cle, { etat: 'erreur', liste: [], message: e && e.lisible ? e.message : 'L\'annuaire ne répond pas (connexion ?). Le carnet reste disponible.' }) }
  rerender()
}

// Choisir une entreprise suggérée : coordonnées (l'annuaire n'en donne pas ; la liste RGE parfois), carnet, envoi.
function choisir(incId, i) {
  const inc = incidentDe(incId); if (!inc) return
  const m = etat.filtreMetier || metierDe(inc)
  const s = etat.sugg.get(cleInc(inc) + '|' + m); const x = s && s.liste[i]; if (!x) return
  etat.choix = { incId: String(inc.id), x, metier: m }
  aller('choisir')
}
function vueChoisir(inc) {
  const c = etat.choix; if (!c || c.incId !== String(inc.id)) return vueArtisan(inc)
  const x = c.x
  return {
    titre: 'Envoyer la demande', sub: x.nom,
    body: `<div class="inc-note">${ico('info', 13)} SIRET ${esc(x.siret)} · ${esc(x.adresse)} · ${esc(String(x.distanceKm).replace('.', ','))} km${x.anneeCreation ? ' · créée en ' + x.anneeCreation : ''}. ${x.tel ? 'Téléphone de la liste RGE (ADEME).' : 'L\'annuaire officiel ne donne ni téléphone ni e-mail : les relever sur la fiche officielle ou le site de l\'entreprise.'}</div>
    <div class="inc-g2"><div class="inc-f"><label class="inc-lb" for="inc-c-tel">Téléphone mobile (pour le SMS)</label><input class="inp" id="inc-c-tel" inputmode="tel" value="${esc(x.tel || '')}"></div>
    <div class="inc-f"><label class="inc-lb" for="inc-c-mail">E-mail <span class="inc-opt">— facultatif</span></label><input class="inp" id="inc-c-mail" inputmode="email" value="${esc(x.email || '')}"></div></div>
    <label class="inc-check"><input type="checkbox" id="inc-c-auto" checked> <span>Ajouter au carnet pour ${esc(metierLbl(c.metier).toLowerCase())} et la prévenir directement la prochaine fois</span></label>
    <div class="inc-guard neutre">L'entreprise recevra : l'adresse, l'accès, le prénom et le nom du locataire, son téléphone s'il l'a accepté, la description et les photos, le plafond. Rien sur le bail, le loyer ni les autres biens.</div>`,
    foot: `<button type="button" class="btn bs" onclick="_incGo('artisan')">Retour</button><a class="btn bs" href="${esc(IC.lienFicheOfficielle(x.siret) || '#')}" target="_blank" rel="noopener noreferrer">${ico('external', 14)} Fiche officielle</a><button type="button" class="btn bp" onclick="IncCircuit.confirmerChoix()">${ico('send', 14)} Envoyer la demande</button>`,
  }
}
async function confirmerChoix() {
  const c = etat.choix; if (!c) return
  const inc = incidentDe(c.incId); if (!inc) return
  const tel = ((document.getElementById('inc-c-tel') || {}).value || '').trim()
  const mail = ((document.getElementById('inc-c-mail') || {}).value || '').trim()
  const auto = !!(document.getElementById('inc-c-auto') || {}).checked
  const ent = entiteDe(inc)
  const d = ent ? droitEnt(ent) : droit(null, inc.entity || ''); if (!d.ok) return refuser(d)
  let a = artisans().find((y) => vivant(y) && y.siret && y.siret === c.x.siret && (!y.entity || y.entity === (ent ? ent.nom : y.entity)) && droitArtisan(y).ok)
  if (!a) {
    a = IC.nouvelArtisan({ entity: ent ? ent.nom : (inc.entity || ''), nom: c.x.nom, siret: c.x.siret, metiers: [c.metier], tel, email: mail, adresse: c.x.adresse, commune: c.x.commune, rge: c.x.rge, prevenirAuto: auto, source: c.x.tel ? 'rge' : 'annuaire' }, new Date().toISOString())
    a.id = G('nid') ? W.nid() : Date.now()
    dansEspaceDe(a, ent)
    artisans().push(a); persisterArtisan(a, 'create')
  } else {
    Object.assign(a, IC.nouvelArtisan({ ...a, tel: tel || a.tel, email: mail || a.email, metiers: [...new Set([...(a.metiers || []), c.metier])], prevenirAuto: a.prevenirAuto || auto }, a.creeLe), { id: a.id })
    persisterArtisan(a)
  }
  if (!IC.joignable(a)) { toast('Indiquer un téléphone ou un e-mail pour envoyer la demande.', 'warn', 5000); return }
  etat.choix = null
  await envoyer(String(inc.id), String(a.id))
}

// ─────────────────────────── Fiche d'un artisan du carnet (note privée, CDC § 13) ───────────────────────────
function editer(id) { etat.edition = id == null ? 'nouveau' : String(id); aller('carnet') }
function vueCarnet(inc) {
  const a = etat.edition === 'nouveau' ? IC.nouvelArtisan({ entity: (entiteDe(inc) || {}).nom || inc.entity || '', metiers: [etat.filtreMetier || metierDe(inc)].filter(Boolean) }) : artisanDe(etat.edition)
  if (!a) return vueArtisan(inc)
  const ent = entiteDe(inc)
  const d = etat.edition !== 'nouveau' ? droitArtisan(a) : ent ? droitEnt(ent) : droit(null, a.entity)
  return {
    titre: etat.edition === 'nouveau' ? 'Ajouter un artisan' : 'Fiche de l\'artisan', sub: a.entity ? 'Carnet de ' + a.entity : 'Carnet',
    body: (d.ok ? '' : noteLectureSeule(d)) + formArtisan(a, null, !d.ok),
    foot: d.ok ? `${etat.edition !== 'nouveau' ? `<button type="button" class="btn bs" onclick="IncCircuit.supprimerArtisan()">${ico('trash', 14)} Retirer du carnet</button>` : ''}<button type="button" class="btn bs" onclick="_incGo('artisan')">Annuler</button><button type="button" class="btn bp" onclick="IncCircuit.enregistrerArtisan()">Enregistrer</button>`
      : `<button type="button" class="btn bs" onclick="_incGo('artisan')">${ico('chevron-left', 14)} Retour</button>`,
  }
}
// Message d'une structure en lecture seule (couche de l'incident comme Paramètres).
const noteLectureSeule = (d) => `<div class="inc-note" role="note">${ico('lock', 13)} ${esc(d.motif)}</div>`
// Formulaire d'un artisan du carnet : le même dans un incident et dans Paramètres › Artisans et plafond (PREMIERS-PAS D3).
// `structures` (Paramètres, ajout, plusieurs structures modifiables) : [{ cle, nom }], choix de la structure dont c'est
// le carnet. `lecture` : structure en lecture seule, champs désactivés.
function formArtisan(a, structures, lecture) {
  const metiers = Object.entries(IN().NAF_METIERS)
  const dis = lecture ? ' disabled' : ''
  const choixStructure = Array.isArray(structures) && structures.length > 1
    ? `<div class="inc-f"><label class="inc-lb" for="inc-a-ent">Carnet de la structure</label><select class="inp" id="inc-a-ent">${structures.map((s, i) => `<option value="${esc(s.cle)}"${i === 0 ? ' selected' : ''}>${esc(s.nom)}</option>`).join('')}</select></div>`
    : ''
  return `${choixStructure}<div class="inc-g2"><div class="inc-f"><label class="inc-lb" for="inc-a-nom">Entreprise *</label><input class="inp" id="inc-a-nom" value="${esc(a.nom)}"${dis}></div>
      <div class="inc-f"><label class="inc-lb" for="inc-a-siret">SIRET <span class="inc-opt">— facultatif</span></label><input class="inp" id="inc-a-siret" inputmode="numeric" value="${esc(a.siret)}"${dis}></div></div>
      <div class="inc-g2"><div class="inc-f"><label class="inc-lb" for="inc-a-tel">Téléphone</label><input class="inp" id="inc-a-tel" inputmode="tel" value="${esc(a.tel)}"${dis}></div>
      <div class="inc-f"><label class="inc-lb" for="inc-a-mail">E-mail</label><input class="inp" id="inc-a-mail" inputmode="email" value="${esc(a.email)}"${dis}></div></div>
      <div class="inc-f"><span class="inc-lb">Métiers</span><div class="inc-chips">${metiers.map(([k, x]) => `<label class="inc-chip"><input type="checkbox" name="inc-a-met" value="${esc(k)}"${a.metiers.includes(k) ? ' checked' : ''}${dis}><span>${esc(x.lbl)}</span></label>`).join('')}</div></div>
      <label class="inc-check"><input type="checkbox" id="inc-a-auto"${a.prevenirAuto ? ' checked' : ''}${dis}> <span>Prévenir directement cet artisan quand un incident de ces métiers est signalé</span></label>
      <div class="inc-f"><label class="inc-lb" for="inc-a-note">Note privée <span class="inc-opt">— visible de la structure et de ses associés seulement, jamais publiée</span></label><textarea class="inp" id="inc-a-note" rows="3" maxlength="${IC.NOTE_MAX}"${dis}>${esc(a.notePrivee)}</textarea></div>
      ${a.nom ? `<a class="btn bs bb" href="${esc(IC.lienAvisEnLigne(a.nom, a.commune))}" target="_blank" rel="noopener noreferrer">${ico('external', 13)} Voir les avis en ligne</a>` : ''}`
}
/** Enregistre le formulaire d'un artisan (`portee` = la couche qui le porte). `entNouveau` : structure (objet) d'un
 *  artisan nouveau, ou son nom quand la structure est introuvable. true si enregistré. */
function enregistrerArtisanDans(portee, edition, entNouveau) {
  const existant = edition === 'nouveau' ? null : artisanDe(edition)
  if (edition !== 'nouveau' && !existant) return false
  const ent = entNouveau && typeof entNouveau === 'object' ? entNouveau : null
  const d = existant ? droitArtisan(existant) : ent ? droitEnt(ent) : droit(null, entNouveau || '')
  if (!d.ok) return refuser(d)
  // Tout est lu DANS la couche qui porte le formulaire : la fiche d'incident fermée garde ses champs (mêmes id) dans le DOM.
  const q = (id) => document.querySelector(portee + ' #' + id)
  const v = (id) => ((q(id) || {}).value || '').trim()
  const metiers = [...document.querySelectorAll(portee + ' input[name="inc-a-met"]:checked')].map((x) => x.value)
  if (!v('inc-a-nom')) { toast('Indiquer le nom de l\'entreprise.', 'warn'); return false }
  const champs = { nom: v('inc-a-nom'), siret: v('inc-a-siret'), tel: v('inc-a-tel'), email: v('inc-a-mail'), metiers, notePrivee: (q('inc-a-note') || {}).value || '', prevenirAuto: !!(q('inc-a-auto') || {}).checked }
  if (champs.email && !IC.nouvelArtisan({ email: champs.email }).email) toast('E-mail non reconnu : non enregistré.', 'warn', 4500)
  if (!existant) {
    const a = IC.nouvelArtisan({ ...champs, entity: ent ? ent.nom : (entNouveau || ''), source: 'libre' }, new Date().toISOString())
    a.id = G('nid') ? W.nid() : Date.now(); dansEspaceDe(a, ent); artisans().push(a); persisterArtisan(a, 'create')
  } else {
    Object.assign(existant, IC.nouvelArtisan({ ...existant, ...champs }, existant.creeLe), { id: existant.id }); persisterArtisan(existant)
  }
  toast('Carnet mis à jour.')
  return true
}
function enregistrerArtisan() {
  const st = etatInc(), inc = st ? incidentDe(st.id) : null
  if (enregistrerArtisanDans('#ov-incident', etat.edition, inc && (entiteDe(inc) || inc.entity))) aller('artisan')
}
function retirerArtisan(id) {
  const a = artisanDe(id); if (!a) return false
  const d = droitArtisan(a); if (!d.ok) return refuser(d)
  if (G('confirm2') && !W.confirm2('Retirer ' + a.nom + ' du carnet ?\n\nLes incidents passés gardent son nom. Il ne sera plus proposé ni prévenu.')) return false
  a._deleted = true; a._deletedAt = new Date().toISOString(); persisterArtisan(a, 'delete'); toast('Artisan retiré du carnet.')
  return true
}
function supprimerArtisan() { if (retirerArtisan(etat.edition)) aller('artisan') }

// ─────────────────────────── Envoi de la demande (D6, D13, D14) ───────────────────────────
function cheminComplet(key, inc) {
  const k = String(key || ''); if (!k) return null
  if (k.indexOf('/files/') !== -1) return k
  const a = API(); const esp = (inc && inc._espaceId) || (a && a.espacePropre())
  return esp ? esp + '/files/' + k : null
}
function photosDuDossier(inc) {
  return ((db() || {}).documents || []).filter((d) => vivant(d) && d.parentType === 'incident' && String(d.parentId) === String(inc.id) && d.cloudKey && /^image\/(jpeg|png)$/.test(d.mime || ''))
    .slice(0, 6).map((d) => ({ path: cheminComplet(d.cloudKey, inc), nom: d.name || 'photo' })).filter((p) => p.path)
}
async function signalementDe(inc) {
  const a = API(); if (!a || !inc.espaceSignalementId) return null
  try { return (await a.select('locataire_signalements', { id: inc.espaceSignalementId }, 'id,description,ia,tel_partage,telephone,acces_info,presence'))[0] || null } catch (e) { return null }
}
function locataireNom(inc) {
  const bail = inc.logRef && G('_bienActiveBail') ? W._bienActiveBail(inc.logRef) : null
  return inc.signaleParNom || (bail && Array.isArray(bail.locataires) && bail.locataires[0] && bail.locataires[0].nom) || (bail && bail.nom) || ''
}
function adresseDe(inc) {
  const log = inc.logRef ? logDe(inc.logRef) : null
  const et = log && log.etage ? String(log.etage).trim() : ''
  return [(log && (log.adr || log.ref)) || inc.imm || '', et ? (/^\d/.test(et) ? 'étage ' + et : et) : ''].filter(Boolean).join(', ')
}
// Un seul envoi à la fois par incident : deux clics émettraient deux jetons, le premier lien partagé ne marcherait plus.
async function envoyer(incId, artisanId) {
  const cle = String(incId)
  if (etat.envoi.has(cle)) return
  etat.envoi.add(cle)
  try { await envoyerUneFois(incId, artisanId) } finally { etat.envoi.delete(cle) }
}
async function envoyerUneFois(incId, artisanId) {
  const inc = incidentDe(incId), art = artisanDe(artisanId)
  if (!inc || !art) return
  const dr = droitInc(inc); if (!dr.ok) { refuser(dr); return }
  if (!IC.joignable(art)) { editer(art.id); toast('Ajouter un téléphone ou un e-mail à la fiche.', 'warn', 5000); return }
  const r = reglagesDe(inc), metier = art.metiers.includes(metierDe(inc)) ? metierDe(inc) : (art.metiers[0] || metierDe(inc) || null)
  const plafond = IC.plafondPour(r, metier)
  const sig = await signalementDe(inc)
  const demande = Object.assign(IC.demandeArtisan({ inc, signalement: sig || { description: inc.description }, adresse: adresseDe(inc), locataireNom: locataireNom(inc), elementLbl: G('_incElLbl') ? W._incElLbl(inc) : '', photos: photosDuDossier(inc) }),
    { pieces: r.conserverPieces ? 'conserver' : 'photo' })
  const avant = JSON.parse(JSON.stringify(inc))
  const noter = () => {
    inc.artisan = { nom: art.nom, siret: art.siret, tel: art.tel, source: 'carnet', metier }
    inc.circuit = Object.assign({}, inc.circuit || {}, { artisanId: art.id, metier, plafondTtc: plafond })
    if (inc.statut === 'signale' && IN()) IN().changerStatut(inc, 'en_cours', new Date().toISOString())
  }
  const api = API(), cfg = G('_relayCfg') ? W._relayCfg() : null
  if (!api || !cfg) {
    // Sans cloud : pas de lien ; la demande part en message (copier, SMS, e-mail, WhatsApp).
    noter(); persisterInc(inc, avant)
    if (G('_openShareModal')) W._openShareModal({ title: 'Demande à ' + art.nom, ctxIcon: ico('send', 20), ctxTitle: demande.titre, ctxSub: esc(demande.adresse), email: art.email, subject: 'Demande d\'intervention',
      message: `Bonjour,\n\nDemande d'intervention : ${demande.titre}.\n${demande.description}\nAdresse : ${demande.adresse}${demande.acces ? '\nAccès : ' + demande.acces : ''}${demande.telephone ? '\nLocataire : ' + demande.locataire + ', ' + demande.telephone : ''}\n\n${IC.phrasePlafond(plafond)}\nDevis préalable, puis facture à l'ordre de ${(entiteDe(inc) || {}).nom || 'du propriétaire'}.`, smsLead: 'Demande d\'intervention : ', doneJs: 'void 0;' })
    rerender(); return
  }
  try {
    const jeton = EL.nouveauJeton(), h = await EL.empreinteJeton(jeton)
    const accesId = await api.rpc('ar_acces_emettre', { p_espace_id: inc._espaceId || api.espacePropre(), p_incident_legacy_id: String(inc.id), p_signalement_id: inc.espaceSignalementId || null,
      p_artisan_nom: art.nom, p_artisan_email: art.email || null, p_artisan_tel: art.tel || null, p_metier: metier, p_plafond_ttc: plafond, p_demande: demande, p_jeton_sha256: h })
    noter(); inc.circuit.accesId = accesId; inc.circuit.emisLe = new Date().toISOString()
    persisterInc(inc, avant)
    await chargerCircuit(inc, true)
    const lien = String(cfg.base).replace(/\/+$/, '') + '/a#' + jeton
    if (!/^https:\/\//.test(lien)) { toast('Adresse du relais non sécurisée (https exigé) : lien non transmis.', 'err', 6000); return }
    const r0 = await etatRelais()
    let parMail = false
    if (r0.emails && art.email) parMail = await notifierArtisan(accesId, jeton)
    const m = IC.modeleEmailArtisan({ bailleur: (entiteDe(inc) || {}).nom, lien })
    if (parMail) toast('Demande envoyée par e-mail à ' + art.nom + '.')
    else if (G('_openShareModal')) {
      W._openShareModal({ title: 'Envoyer la demande à ' + art.nom, ctxIcon: ico('send', 20), ctxTitle: demande.titre, ctxSub: esc(demande.adresse), url: lien, linkLabel: 'Lien de la demande (sans compte)', email: art.email,
        subject: m.objet, message: m.texte.replace('\n' + lien, ''), smsLead: m.sms.replace(lien, ''),
        // COMPTE DÉMO (?demo=1) : nuage fictif local — le lien a la forme réelle mais aucune page d'artisan ne l'attend.
        info: (W.__immoDemo === true ? '<b>Démonstration :</b> lien fictif, la page de l\'artisan ne s\'ouvre qu\'avec un vrai compte. ' : '')
          + '<b>Lien affiché une seule fois.</b> Seule son empreinte est enregistrée : pour le transmettre à nouveau, « Renvoyer le lien » (l\'ancien cesse de fonctionner).', doneJs: 'void 0;' })
    }
    rerender()
  } catch (e) {
    const msg = /ar:interdit/.test(e.message) ? 'l\'incident n\'est pas encore enregistré dans le cloud (réessayer dans un instant) ou le droit d\'écriture manque.' : /ar:photo/.test(e.message) ? 'une photo du dossier n\'appartient pas à cette structure.' : 'connexion perdue.'
    toast('Demande non envoyée : ' + msg, 'err', 6500)
  }
}
async function notifierArtisan(accesId, jeton) {
  try {
    const cfg = G('_relayCfg') ? W._relayCfg() : null; if (!cfg) return false
    const jwt = await cfg.getToken(); if (!jwt) return false
    const r = await fetch(cfg.base + '/ar/notifier', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' }, body: JSON.stringify({ acces_id: accesId, jeton }) })
    return r.ok && (await r.json()).envoye === true
  } catch (e) { return false }
}
async function renvoyer(incId) {
  const inc = incidentDe(incId); if (!inc) return
  const x = accesActif(inc)
  const art = (inc.circuit && artisanDe(inc.circuit.artisanId)) || artisans().find((a) => vivant(a) && x && a.nom.toLowerCase() === x.artisan_nom.toLowerCase())
  if (!art) { aller('artisan'); return }
  await envoyer(incId, String(art.id))
}
async function retirer(incId) {
  const inc = incidentDe(incId), api = API(); if (!inc || !api) return
  const x = accesActif(inc); if (!x) return
  if (G('confirm2') && !W.confirm2('Retirer le lien de ' + x.artisan_nom + ' ?\n\nLe lien cesse de fonctionner immédiatement. Les devis, factures et photos déjà déposés restent enregistrés.')) return
  try { await api.rpc('ar_acces_revoquer', { p_acces_id: x.id }); await chargerCircuit(inc, true); toast('Lien retiré.'); rerender() }
  catch (e) { toast('Retrait impossible : droit insuffisant ou connexion perdue.', 'err', 5000) }
}
async function ouvrirDepot(depotId) {
  for (const l of etat.depots.values()) {
    const d = l.find((y) => y.id === depotId); if (!d) continue
    const url = G('__immoCloudFileUrl') ? await W.__immoCloudFileUrl(d.storage_path, 300) : null
    if (url) W.open(url, '_blank', 'noopener'); else toast('Fichier indisponible.', 'err')
    return
  }
}
async function ouvrirPhotos(incId) {
  const inc = incidentDe(incId); const x = inc && accesActif(inc)
  for (const d of depotsDe(x).filter((y) => y.type_depot === 'photo').slice(0, 6)) await ouvrirDepot(d.id)
}

// ─────────────────────────── Plafond (D1, D2, D4) ───────────────────────────
function vuePlafond(inc) {
  const ent = entiteDe(inc), d = droitEnt(ent)
  return {
    titre: 'Plafond d\'intervention directe', sub: ent ? ent.nom + ' · réglage propre à cette structure' : 'Structure de l\'incident',
    body: (ent && !d.ok ? noteLectureSeule(d) : '') + plafondCorps(ent, ent && !d.ok),
    foot: ent && !d.ok ? `<button type="button" class="btn bs" onclick="_incGo('fiche')">${ico('chevron-left', 14)} Retour</button>`
      : `<button type="button" class="btn bs" onclick="_incGo('fiche')">Annuler</button><button type="button" class="btn bp" onclick="IncCircuit.validerPlafond()">${ico('check', 14)} Valider le plafond</button>`,
  }
}
// Corps du réglage du plafond d'UNE structure : le même dans un incident et dans Paramètres › Artisans et plafond (D3).
// `lecture` : structure en lecture seule (SCI partagée sans droit d'écriture), champs désactivés.
function plafondCorps(ent, lecture) {
  const r = IC.normaliserReglages((ent || {}).incidentReglages), metiers = Object.entries(IN().NAF_METIERS)
  const dis = lecture ? ' disabled' : ''
  const devis = QP().TEXTES['devis-2017'] && G('_incCite') ? W._incCite(Object.assign({ id: 'devis-2017' }, QP().TEXTES['devis-2017'])) : ''
  return `<div class="inc-note">${ico('info', 13)} En dessous de ce montant, l'artisan prévenu par Propryo intervient sans attendre de réponse : son devis, déposé sur sa page, est accepté automatiquement au nom de ${esc(ent ? ent.nom : 'la structure')}. Au-dessus, le devis arrive sur la fiche de l'incident pour être accepté ou refusé en 1 clic.</div>
      <div class="inc-f"><label class="inc-lb" for="inc-p-mt">Plafond par intervention, TTC, déplacement compris</label><input class="inp" id="inc-p-mt" inputmode="decimal" value="${esc(String(r.plafondTtc).replace('.', ','))}"${dis}></div>
      <details class="inc-det"${Object.keys(r.parMetier).length ? ' open' : ''}><summary>Par métier (facultatif)</summary><div class="inc-g2">${metiers.map(([k, x]) => `<div class="inc-f"><label class="inc-lb" for="inc-p-${esc(k)}">${esc(x.lbl)}</label><input class="inp" id="inc-p-${esc(k)}" data-metier="${esc(k)}" inputmode="decimal" placeholder="plafond général" value="${r.parMetier[k] != null ? esc(String(r.parMetier[k]).replace('.', ',')) : ''}"${dis}></div>`).join('')}</div></details>
      <div class="inc-guard neutre"><b>Urgence.</b> Mise en sécurité (couper, colmater, sécuriser une porte) toujours autorisée, limitée aux travaux strictement nécessaires, dans la limite du plafond. La réparation au-delà passe par un devis.</div>
      <div class="inc-f"><span class="inc-lb">Pièces remplacées</span>
        <label class="inc-check"><input type="radio" name="inc-p-pieces" value="photo"${r.conserverPieces ? '' : ' checked'}${dis}> <span>Ne pas conserver, mais demander une photo de chaque pièce remplacée (preuve du constat)</span></label>
        <label class="inc-check"><input type="radio" name="inc-p-pieces" value="conserver"${r.conserverPieces ? ' checked' : ''}${dis}> <span>Conserver les pièces remplacées (l'artisan les laisse sur place)</span></label></div>
      <div class="inc-guard"><b>La règle du devis.</b> Le client est ${esc(ent ? ent.nom : 'le propriétaire')}, qui commande et paie ; le logement loué est le lieu d'exécution. Le devis reste dû avant les travaux, même sous le plafond.${devis}</div>
      ${r.valideLe ? `<div class="inc-note pos">${ico('check', 13)} Validé le ${esc(fdh(r.valideLe))}${r.validePar ? ' par ' + esc(r.validePar) : ''}.</div>` : `<div class="inc-note">${ico('info', 13)} Tant que le plafond n'est pas validé, tout devis passe par le propriétaire.</div>`}`
}
// Compte qui valide le plafond (trace sur la structure, lue par ses membres) : l'e-mail du compte connecté en mode
// cloud (window.__immoCloudInfo, posé à la connexion) ; aucun compte en mode local → vide.
const compteConnecte = () => { try { const c = W.__immoCloudInfo; return (c && typeof c.email === 'string' && c.email.trim()) || '' } catch (e) { return '' } }
/** Lit le réglage dans la couche `portee` et le valide pour la structure `ent`. true si enregistré. */
function appliquerPlafond(ent, portee) {
  if (!ent) { toast('Structure introuvable : rattacher le bien à une structure.', 'warn', 5000); return false }
  const d = droitEnt(ent); if (!d.ok) return refuser(d)
  const mt = IC.montant((document.querySelector(portee + ' #inc-p-mt') || {}).value)
  if (mt == null || mt > IC.PLAFOND_MAX) { toast('Indiquer un montant en euros.', 'warn'); return false }
  const parMetier = {}
  document.querySelectorAll(portee + ' input[data-metier]').forEach((i) => { const n = IC.montant(i.value); if (n != null) parMetier[i.getAttribute('data-metier')] = n })
  const conserver = ((document.querySelector(portee + ' input[name="inc-p-pieces"]:checked') || {}).value) === 'conserver'
  ent.incidentReglages = IC.normaliserReglages({ plafondTtc: mt, parMetier, conserverPieces: conserver, valideLe: new Date().toISOString(), validePar: compteConnecte() })
  if (G('_stamp')) W._stamp(ent)
  if (G('_auditLog')) W._auditLog('update', 'entite', ent.id, ent.nom + ' : plafond d\'intervention ' + mt + ' € TTC')
  if (G('saveDB')) W.saveDB()
  toast('Plafond de ' + euros(mt) + ' TTC validé pour ' + ent.nom + '.', 'ok', 4500)
  return true
}
function validerPlafond() {
  const st = etatInc(), inc = st ? incidentDe(st.id) : null; if (!inc) return
  if (appliquerPlafond(entiteDe(inc), '#ov-incident')) aller('fiche')
}

// ─────────────────────────── Paramètres › Artisans et plafond (PREMIERS-PAS D3) ───────────────────────────
// Les deux réglages qui rendent le circuit d'un incident autonome n'étaient accessibles que depuis un incident ouvert.
// Ici, hors incident : mêmes formulaires (plafondCorps, formArtisan), mêmes enregistrements (appliquerPlafond,
// enregistrerArtisanDans, retirerArtisan) — rien de recopié.
// TOUTES les structures visibles du compte : les siennes ET les SCI partagées avec lui (la base ne lui rend que celles
// auxquelles il a accès). Modifiables : les siennes et les SCI où il est gestionnaire ; les autres en lecture seule
// (droitEnt). Une structure est désignée par une CLÉ (espace + id) : deux SCI homonymes de deux espaces restent distinctes.
const espacePropre = () => { try { const a = W.__immoIncidentCircuit; return a && a.pret() ? a.espacePropre() : null } catch (e) { return null } }
const structures = () => ((db() || {}).entites || []).filter(vivant)
const cleStructure = (e) => String(e._espaceId == null ? '' : e._espaceId) + '|' + (e.id != null ? 'i' + e.id : 'n' + e.nom)
const entiteParCle = (cle) => structures().find((e) => cleStructure(e) === cle) || null
const modifiables = () => structures().filter((e) => droitEnt(e).ok)
// SCI partagée par un autre compte (étiquette de la liste) : taguée d'un espace qui n'est pas celui du compte.
const partagee = (e) => { const p = espacePropre(); const mine = G('__immoOwnEspaceMine') ? W.__immoOwnEspaceMine() === true : true; return !!p && e._espaceId != null && (e._espaceId !== p || !mine) }
const ap = { edition: null, hote: 'tp-artisans' }
function coucheAp(titre, corps, pied) {
  const old = document.getElementById('ov-ap'); if (old) old.remove()
  // Fiche d'incident FERMÉE : ses champs (mêmes id, mêmes <label for>) restent dans le DOM. On vide son corps (il est
  // redessiné à chaque ouverture par openIncident → _incRender) pour qu'aucun id ne soit en double.
  const fi = document.getElementById('ov-incident')
  if (fi && fi.classList.contains('hidden')) { const c = fi.querySelector('#inc-body'); if (c) c.innerHTML = '' }
  document.body.insertAdjacentHTML('beforeend', `<div class="ov" id="ov-ap"><div class="modal" style="max-width:640px" role="dialog" aria-modal="true" aria-labelledby="ov-ap-t">
    <div class="m-head"><h3 id="ov-ap-t">${esc(titre)}</h3><button type="button" class="m-close" aria-label="Fermer" onclick="IncCircuit.ap.fermer()">${ico('close', 18)}</button></div>
    <div class="m-body">${corps}</div><div class="m-foot">${pied}</div></div></div>`)
  if (G('openM')) W.openM('ov-ap')
  const ov = document.getElementById('ov-ap')
  ov.addEventListener('keydown', (k) => { if (k.key === 'Escape') { k.stopPropagation(); apFermer() } })
  const f = ov.querySelector('input,select,textarea'); if (f) f.focus()
}
function apFermer() { const o = document.getElementById('ov-ap'); if (o) o.remove() }
const piedLecture = `<button type="button" class="btn bs" onclick="IncCircuit.ap.fermer()">Fermer</button>`
function apPlafond(cle) {
  const ent = entiteParCle(cle); if (!ent) return
  const d = droitEnt(ent)
  coucheAp('Plafond d\'intervention · ' + ent.nom, (d.ok ? '' : noteLectureSeule(d)) + plafondCorps(ent, !d.ok),
    d.ok ? `<button type="button" class="btn bs" onclick="IncCircuit.ap.fermer()">Annuler</button><button type="button" class="btn bp" onclick="IncCircuit.ap.validerPlafond(${js(cle)})">${ico('check', 14)} Valider le plafond</button>` : piedLecture)
}
function apValiderPlafond(cle) { if (appliquerPlafond(entiteParCle(cle), '#ov-ap')) { apFermer(); parametres() } }
function apArtisan(id) {
  const choix = modifiables().map((e) => ({ cle: cleStructure(e), nom: e.nom }))
  ap.edition = id == null ? 'nouveau' : String(id)
  if (ap.edition === 'nouveau' && !choix.length) return
  const a = ap.edition === 'nouveau' ? IC.nouvelArtisan({ entity: choix[0].nom }) : artisanDe(ap.edition)
  if (!a) return
  const d = ap.edition === 'nouveau' ? { ok: true } : droitArtisan(a)
  coucheAp(ap.edition === 'nouveau' ? 'Ajouter un artisan' : 'Fiche de l\'artisan', (d.ok ? '' : noteLectureSeule(d)) + formArtisan(a, ap.edition === 'nouveau' ? choix : null, !d.ok),
    !d.ok ? piedLecture : `${ap.edition !== 'nouveau' ? `<button type="button" class="btn bs" onclick="IncCircuit.ap.retirer()">${ico('trash', 14)} Retirer du carnet</button>` : ''}<button type="button" class="btn bs" onclick="IncCircuit.ap.fermer()">Annuler</button><button type="button" class="btn bp" onclick="IncCircuit.ap.enregistrer()">Enregistrer</button>`)
}
function apEnregistrer() {
  const sel = document.querySelector('#ov-ap #inc-a-ent')
  // Une seule structure modifiable : pas de choix affiché, c'est elle.
  const ent = ap.edition !== 'nouveau' ? null : sel ? entiteParCle(sel.value) : (modifiables()[0] || null)
  if (ap.edition === 'nouveau' && !ent) { toast('Aucune structure modifiable pour ce carnet.', 'warn', 5000); return }
  if (enregistrerArtisanDans('#ov-ap', ap.edition, ent)) { apFermer(); parametres() }
}
function apRetirer() { if (retirerArtisan(ap.edition)) { apFermer(); parametres() } }
function parametres(hostId) {
  if (hostId) ap.hote = hostId
  const host = document.getElementById(ap.hote); if (!host || !IN()) return
  const ents = structures()
  const metierLbls = (a) => (a.metiers || []).map(metierLbl).join(', ')
  const lecture = ents.filter((e) => !droitEnt(e).ok)
  const lignesPlafond = ents.map((e) => {
    const r = IC.normaliserReglages(e.incidentReglages), ro = lecture.includes(e)
    const etatTxt = [r.valideLe ? `${euros(r.plafondTtc)} TTC par intervention · validé le ${fdate(r.valideLe)}` : 'Non validé : tout devis passe par le propriétaire.', partagee(e) ? 'SCI partagée' : '', ro ? 'lecture seule' : ''].filter(Boolean).join(' · ')
    return `<li class="ap-ligne"><span class="ap-m"><b>${esc(e.nom)}</b><span class="ap-s${r.valideLe || ro ? '' : ' a-faire'}">${esc(etatTxt)}</span></span><button type="button" class="btn bs bb" onclick="IncCircuit.ap.plafond(${js(cleStructure(e))})">${ro ? 'Voir le plafond' : r.valideLe ? 'Modifier le plafond' : 'Fixer le plafond'}</button></li>`
  }).join('')
  // Carnet : tous les artisans visibles (les siens et ceux des SCI partagées, la base ne rend que ceux-là).
  const carnet = artisans().filter(vivant)
  const lignesCarnet = carnet.map((a) => { const ro = !droitArtisan(a).ok; return `<li class="ap-ligne"><span class="ap-m"><b>${esc(a.nom)}</b><span class="ap-s">${esc([metierLbls(a), a.tel, a.entity ? 'carnet de ' + a.entity : '', ro ? 'lecture seule' : ''].filter(Boolean).join(' · '))}</span></span><button type="button" class="btn bs bb" onclick="IncCircuit.ap.artisan(${js(a.id)})">${ro ? 'Voir la fiche' : 'Modifier'}</button></li>` }).join('')
  const peutAjouter = modifiables().length > 0
  host.innerHTML = `<style>
      #${ap.hote} .ap-wrap{max-width:860px}
      #${ap.hote} .ap-intro{font-size:14px;color:var(--t2);margin:0 0 16px;line-height:1.5}
      #${ap.hote} .ap-liste{list-style:none;margin:0 0 20px;padding:0;border:1px solid var(--bor);border-radius:var(--r);background:var(--sur)}
      #${ap.hote} .ap-ligne{display:flex;align-items:center;gap:12px;padding:12px 14px;flex-wrap:wrap}
      #${ap.hote} .ap-ligne+.ap-ligne{border-top:1px solid var(--bor)}
      #${ap.hote} .ap-m{flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:2px}
      #${ap.hote} .ap-m b{color:var(--t1);font-size:14.5px}
      #${ap.hote} .ap-s{font-size:13px;color:var(--t2)}
      #${ap.hote} .ap-s.a-faire{color:var(--t1);font-weight:600}
      #${ap.hote} .ap-vide{padding:16px;font-size:14px;color:var(--t2);text-align:center;line-height:1.5}
      #${ap.hote} .ap-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 10px}
      #${ap.hote} .ap-h .ct{margin:0;flex:1}
      #${ap.hote} .ap-ro{display:flex;gap:8px;align-items:flex-start;font-size:14px;color:var(--t1);background:var(--sur);border:1px solid var(--bor);border-radius:var(--r);padding:10px 12px;margin:0 0 16px;line-height:1.5}
      #${ap.hote} .ap-ro svg{flex:none;margin-top:3px}
      @media (max-width:767px){ #${ap.hote} .ap-ligne .btn{flex:1 1 100%;min-height:44px} #${ap.hote} .ap-h .btn{flex:1 1 100%;min-height:44px} }
    </style><div class="ap-wrap">
    <div class="ct mb12">${ico('wrench', 16)} Artisans et plafond</div>
    <p class="ap-intro">Quand un locataire signale un incident, un artisan du carnet couvrant le métier reçoit la demande et intervient sous le plafond de la structure ; au-delà, son devis attend une validation.</p>
    ${motifGlobal() ? `<p class="ap-ro" role="note">${ico('lock', 14)} <span>${esc(motifGlobal())}</span></p>`
      : lecture.length ? `<p class="ap-ro" role="note">${ico('lock', 14)} <span>Lecture seule pour ${esc(lecture.map((e) => e.nom).join(', '))} : le plafond et le carnet ${lecture.length > 1 ? 'de ces structures se règlent par leur' : 'de cette structure se règlent par son'} propriétaire ou un gestionnaire.</span></p>` : ''}
    <div class="ap-h"><div class="ct" style="font-size:14px">Plafond d'intervention directe</div></div>
    ${ents.length ? `<ul class="ap-liste">${lignesPlafond}</ul>` : '<div class="ap-liste"><div class="ap-vide">Aucune structure pour l\'instant : ajouter d\'abord un logement (la structure, SCI ou nom propre, se crée avec lui).</div></div>'}
    <div class="ap-h"><div class="ct" style="font-size:14px">Carnet d'artisans</div>${peutAjouter ? `<button type="button" class="btn bp bb" onclick="IncCircuit.ap.artisan(null)">${ico('plus', 14)} Ajouter un artisan</button>` : ''}</div>
    ${carnet.length ? `<ul class="ap-liste">${lignesCarnet}</ul>` : '<div class="ap-liste"><div class="ap-vide">Aucun artisan au carnet. Plombier, électricien, chauffagiste : un artisan ajouté ici est prévenu directement quand un incident de son métier est signalé.</div></div>'}
  </div>`
}

// ─────────────────────────── Devis au-dessus du plafond (D3) ───────────────────────────
function vueDevis(inc) {
  const x = accesActif(inc), devis = depotsDe(x).filter((d) => d.type_depot === 'devis')
  const att = devis.filter((d) => d.statut === 'en_attente')
  const lu = (d) => etat.lecture.get(d.id)
  return {
    titre: att.length ? 'Devis à accepter' : 'Devis', sub: x ? x.artisan_nom + ' · plafond ' + euros(x.plafond_ttc) + ' TTC' : '',
    // En attente d'abord, puis les autres (un devis accepté automatiquement se relit aussi : montant déclaré par l'artisan).
    body: [...att, ...devis.filter((d) => d.statut !== 'en_attente')].map((d, i) => {
      const l = lu(d)
      const ecart = l && l.montantTTC != null && Math.abs(l.montantTTC - Number(d.montant_ttc)) > 1
      return `<div class="inc-grp"><div class="inc-grp-h"><h4>${ico('doc', 15)} Devis${d.numero ? ' ' + esc(d.numero) : ''} · ${esc(euros(d.montant_ttc))} TTC</h4><span class="inc-sub">Déposé le ${esc(fdh(d.cree_le))} · ${esc(IC.STATUTS_DEVIS[d.statut] || '')}</span></div>
        ${Number(d.montant_ttc) > Number(x.plafond_ttc) ? `<div class="inc-note">${ico('info', 13)} Au-dessus du plafond de ${esc(euros(x.plafond_ttc))} TTC.</div>` : ''}
        ${x.constat ? `<div class="inc-row"><span class="k">Constat de l'artisan</span><span class="v">${esc([IC.constatLbl(x.constat), IC.ampleurLbl(x.constat_ampleur)].filter(Boolean).join(' · '))}${x.constat_resume ? ' — ' + esc(x.constat_resume) : ''}</span></div>` : ''}
        ${l ? `<div class="inc-row"><span class="k">Lu par l'IA (à vérifier)</span><span class="v">${l.montantTTC != null ? esc(euros(l.montantTTC)) + ' TTC' : 'montant illisible'}${l.travaux ? ' · ' + esc(l.travaux) : ''}</span></div>` : ''}
        ${ecart ? `<div class="inc-guard">${ico('warn', 13)} Le montant lu sur le document (${esc(euros(l.montantTTC))}) diffère du montant déclaré par l'artisan (${esc(euros(d.montant_ttc))}).</div>` : ''}
        <div class="inc-step-acts"><button type="button" class="btn bs bb" onclick="IncCircuit.ouvrirDepot(${js(d.id)})">${ico('eye', 13)} Ouvrir le devis</button>${l ? '' : `<button type="button" class="btn bs bb" onclick="IncCircuit.lireDepot(${js(String(inc.id))},${js(d.id)})">${ico('sparkle', 13)} Lire avec l'IA</button>`}
        ${d.statut === 'en_attente' ? `<button type="button" class="btn bs bb" onclick="IncCircuit.decider(${js(String(inc.id))},${js(d.id)},false)">${ico('close', 13)} Refuser</button><button type="button" class="btn ${i === 0 ? 'bp' : 'bs'} bb" onclick="IncCircuit.decider(${js(String(inc.id))},${js(d.id)},true)">${ico('check', 13)} Accepter le devis</button>` : ''}</div></div>`
    }).join('') + `<div class="inc-note">${ico('info', 13)} Accepter engage ${esc((entiteDe(inc) || {}).nom || 'la structure')} pour ce montant. Refuser : l'artisan le voit sur sa page ; rien n'est commandé. La répartition se calcule à la fin, sur la facture.</div>`,
    foot: `<button type="button" class="btn bs" onclick="_incGo('fiche')">${ico('chevron-left', 14)} Retour à l'incident</button>`,
  }
}
async function decider(incId, depotId, accepte) {
  const inc = incidentDe(incId), api = API(); if (!inc || !api) return
  if (accepte) {
    const d = [...etat.depots.values()].flat().find((y) => y.id === depotId)
    if (G('confirm2') && !W.confirm2('Accepter le devis de ' + euros(d && d.montant_ttc) + ' TTC ?\n\nL\'artisan le voit aussitôt sur sa page et peut intervenir.')) return
  }
  try { await api.rpc('ar_devis_decider', { p_depot_id: depotId, p_accepte: !!accepte }); await chargerCircuit(inc, true); toast(accepte ? 'Devis accepté.' : 'Devis refusé.'); aller('fiche') }
  catch (e) { toast('Réponse non enregistrée : ' + (/deja-decide/.test(e.message) ? 'déjà décidé.' : 'droit insuffisant ou connexion perdue.'), 'err', 5000) }
}

// ─────────────────────────── Lecture IA d'une facture ou d'un devis ───────────────────────────
async function imagesDe(blob) {
  const verDataUrl = (b) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => res(null); fr.readAsDataURL(b) })
  const reduire = async (src) => {
    const k = Math.min(1, 1400 / Math.max(src.width, src.height))
    const cv = document.createElement('canvas'); cv.width = Math.round(src.width * k); cv.height = Math.round(src.height * k)
    cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height)
    const b = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.72)); return b ? verDataUrl(b) : null
  }
  if (blob.type === 'application/pdf') {
    if (!G('_ensurePdfjsLoaded')) return []
    await W._ensurePdfjsLoaded()
    const pdf = await W.pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise
    const out = []
    for (let p = 1; p <= Math.min(2, pdf.numPages); p++) {
      const page = await pdf.getPage(p); const vp = page.getViewport({ scale: 1.6 })
      const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise
      const d = await reduire(cv); if (d) out.push(d)
    }
    return out
  }
  if (!/^image\//.test(blob.type || '')) return []
  const bmp = await createImageBitmap(blob); const d = await reduire(bmp); return d ? [d] : []
}
function clientIA() {
  const cfg = G('_relayCfg') ? W._relayCfg() : null
  return cfg && W.IaClient ? W.IaClient.creerClientIA({ base: cfg.base, getToken: cfg.getToken }) : null
}
async function lireAvecIA(blob, type) {
  const c = clientIA(); if (!c) return { ok: false, message: 'Lecture automatique indisponible : saisir les valeurs.' }
  const images = await imagesDe(blob)
  if (!images.length) return { ok: false, message: 'Document non lisible automatiquement : saisir les valeurs.' }
  const r = await c.structurer('lecture-facture', { type, images })
  // CONSO-IA : plafond MENSUEL de l'offre (motif « mois ») → lecture en pause ce mois-ci ; la saisie reste ouverte.
  if (!r.ok) return { ok: false, message: r.code === 'quota' ? (r.motif === 'mois' ? 'Lecture de facture en pause ce mois-ci : saisir les valeurs.' : 'Limite d\'analyses du jour atteinte : saisir les valeurs.') : 'Lecture automatique indisponible : saisir les valeurs.' }
  return { ok: true, data: r.data }
}
async function lireDepot(incId, depotId) {
  const d = [...etat.depots.values()].flat().find((y) => y.id === depotId); if (!d) return
  toast('Lecture du document…', 'info', 2500)
  try {
    const url = G('__immoCloudFileUrl') ? await W.__immoCloudFileUrl(d.storage_path, 120) : null
    const blob = url ? await (await fetch(url)).blob() : null
    if (!blob) throw new Error('fichier')
    const r = await lireAvecIA(new Blob([blob], { type: d.mime }), d.type_depot === 'devis' ? 'devis' : 'facture')
    if (!r.ok) { toast(r.message, 'warn', 5000); return }
    etat.lecture.set(depotId, r.data); rerender()
  } catch (e) { toast('Lecture impossible : fichier indisponible.', 'warn') }
}
function vueFactureIa(inc) {
  const f = etat.valid.get(String(inc.id)) || {}
  return {
    titre: 'Déposer la facture', sub: (G('_incElLbl') ? W._incElLbl(inc) : '') + ' · lien de l\'artisan non utilisé',
    body: `<div class="inc-note">${ico('info', 13)} La facture (PDF ou photo) rejoint le dossier de preuves. L'IA la lit (montant, TVA, SIRET, travaux, constat probable) : chaque valeur se vérifie ensuite, avant la validation.</div>
      <div class="inc-f"><label class="inc-lb" for="inc-fi-file">Facture</label><input class="inp" id="inc-fi-file" type="file" accept="application/pdf,image/*"></div>
      ${f.lue ? `<div class="inc-note pos">${ico('check', 13)} Lue : ${esc(f.lue)}</div>` : ''}`,
    foot: `<button type="button" class="btn bs" onclick="_incGo('fiche')">Annuler</button><button type="button" class="btn bp" id="inc-fi-ok" onclick="IncCircuit.deposerFacture()">${ico('sparkle', 14)} Déposer et lire</button>`,
  }
}
async function deposerFacture() {
  const st = etatInc(), inc = st ? incidentDe(st.id) : null; if (!inc) return
  const file = (document.getElementById('inc-fi-file') || {}).files && document.getElementById('inc-fi-file').files[0]
  if (!file) { toast('Choisir la facture (PDF ou photo).', 'warn'); return }
  const b = document.getElementById('inc-fi-ok'); if (b) { b.disabled = true; b.textContent = 'Lecture…' }
  // 1. Dans le dossier de preuves (chemin existant des pièces jointes).
  try {
    const dataB64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = (e) => res(e.target.result); fr.onerror = () => rej(new Error('lecture')); fr.readAsDataURL(file) })
    if (G('_attachmentSaveForEntity')) await W._attachmentSaveForEntity({ type: 'incident', id: inc.id, ref: G('_incElLbl') ? W._incElLbl(inc) : '', logRef: inc.logRef || null, category: 'travaux' }, { name: file.name, mime: file.type, size: file.size, dataB64 })
  } catch (e) { toast('Facture non jointe au dossier : ' + (e.message || 'erreur') + '.', 'warn', 5000) }
  // 2. Lecture IA (jamais bloquante).
  const v = Object.assign({}, etat.valid.get(String(inc.id)) || {})
  try {
    const r = await lireAvecIA(file, 'facture')
    if (r.ok) {
      const d = r.data
      Object.assign(v, { montant: d.montantTTC != null ? d.montantTTC : v.montant, numero: d.numero || v.numero, date: d.date || v.date, travaux: d.travaux || v.travaux, constat: d.constatProbable || v.constat, source: 'facture',
        lue: [d.entreprise, d.siret ? 'SIRET ' + d.siret : '', d.montantTTC != null ? euros(d.montantTTC) + ' TTC' : '', d.travaux].filter(Boolean).join(' · ') })
    } else toast(r.message, 'warn', 5000)
  } catch (e) { toast('Lecture automatique impossible : saisir les valeurs.', 'warn', 5000) }
  etat.valid.set(String(inc.id), v)
  aller('valider')
}

// ─────────────────────────── Validation finale (engagement financier) ───────────────────────────
function valeursValidation(inc) {
  const x = accesActif(inc), deps = depotsDe(x)
  const fac = deps.filter((d) => d.type_depot === 'facture').slice(-1)[0] || null
  const v = Object.assign({}, etat.valid.get(String(inc.id)) || {})
  const c = inc.constat || (x && x.constat ? { constat: x.constat, sousType: x.constat_sous_type, ampleur: x.constat_ampleur, resume: x.constat_resume, source: 'artisan' } : null)
  return {
    constat: v.constat || (c && c.constat) || null, sousType: v.sousType || (c && c.sousType) || null, ampleur: v.ampleur || (c && c.ampleur) || null,
    resume: v.travaux || (c && c.resume) || '', source: v.source || (c && c.source) || 'proprietaire',
    montant: v.montant != null ? v.montant : (fac ? Number(fac.montant_ttc) : null), numero: v.numero || (fac && fac.numero) || '', date: v.date || '', facture: fac, payeur: v.payeur || inc.payeurRetenu || null,
  }
}
function vueValider(inc) {
  const v = valeursValidation(inc)
  const k = v.constat ? IC.normaliserConstat({ constat: v.constat, sousType: v.sousType, ampleur: v.ampleur, resume: v.resume, source: v.source }) : null
  const verdict = k ? IC.verdictDuConstat(inc, k) : null
  const arb = verdict && verdict.payeur === 'a_arbitrer'
  const payeur = v.payeur || (verdict && !arb ? verdict.payeur : null)
  const cite = (t) => (G('_incCite') ? W._incCite(t) : '')
  const deja = (inc.mouvementIds || []).length > 0
  const cands = IN().mouvementsRattachables((db() || {}).mouvements || [], inc, { espaceId: G('_incEspace') ? W._incEspace(inc) : undefined }).filter((m) => !(inc.mouvementIds || []).map(String).includes(String(m.id)))
  const sugg = QP().qualificationSuggeree(verdict)
  const auj = new Date(); auj.setMinutes(auj.getMinutes() - auj.getTimezoneOffset())
  const radio = (name, liste, sel) => `<div class="inc-chips">${liste.map((x) => `<label class="inc-chip"><input type="radio" name="${name}" value="${esc(x.k)}"${sel === x.k ? ' checked' : ''} onchange="IncCircuit.majValidation()"><span>${esc(x.lbl)}</span></label>`).join('')}</div>`
  const verdictHtml = !verdict ? `<div class="inc-note">${ico('info', 13)} Choisir le constat : la répartition s'affiche aussitôt, avec les textes.</div>`
    : `<div class="inc-vd"><div class="inc-vd-top"><div class="inc-k">Qui paie</div><div class="inc-vd-pay${arb ? ' arb' : ''}">${esc(QP().PAYEUR_LBL[verdict.payeur] || verdict.payeur)}</div><div class="inc-vd-conf"><span>Règle ${esc(verdict.regle || '')}</span></div><div class="inc-vd-why">${esc(verdict.resume || '')}</div></div>
      <div class="inc-vd-b">${arb ? `<div class="inc-reads">${verdict.lectures.map((l, i) => `<label class="inc-read"><span class="inc-rh"><input type="radio" name="inc-v-payeur" value="${esc(l.payeur)}"${payeur === l.payeur ? ' checked' : ''} onchange="IncCircuit.majValidation()"> Lecture ${i + 1} : ${esc(QP().PAYEUR_LBL[l.payeur] || l.payeur)}</span><span class="inc-rs">${esc(l.si.charAt(0).toUpperCase() + l.si.slice(1))}.</span>${l.textes.map(cite).join('')}</label>`).join('')}</div>` : (verdict.textes || []).map(cite).join('')}
      <div class="inc-legal">${ico('info', 13)} <span>${esc(QP().MENTION_LEGALE)}</span></div></div></div>`
  // Contre-contrôle (jamais bloquant) : montant à enregistrer comparé aux devis acceptés et au plafond du lien.
  const xv = accesActif(inc), devisOk = depotsDe(xv).filter((d) => d.type_depot === 'devis' && (d.statut === 'auto_accepte' || d.statut === 'accepte'))
  const totalDevis = devisOk.reduce((t, d) => t + (Number(d.montant_ttc) || 0), 0), mt = IC.montant(v.montant)
  const ecart = !deja && mt > 0 && xv ? (totalDevis > 0 && mt > totalDevis + 1 ? `Le montant (${euros(mt)}) dépasse le total des devis acceptés (${euros(totalDevis)}).`
    : !totalDevis && Number(xv.plafond_ttc) > 0 && mt > Number(xv.plafond_ttc) ? `Le montant (${euros(mt)}) dépasse le plafond sans accord (${euros(xv.plafond_ttc)}) et aucun devis n'a été accepté.` : '') : ''
  const ecartHtml = ecart ? `<div class="inc-guard">${ico('warn', 13)} ${esc(ecart)} Vérifier la facture avant de valider.</div>` : ''
  const argent = deja ? `<div class="inc-note pos">${ico('check', 13)} Dépense déjà enregistrée dans Finances : ${esc(euros(G('_incCoutBailleur') ? W._incCoutBailleur(inc) : null))}. Elle n'est pas comptée une seconde fois.</div>`
    : `${cands.length ? `<div class="inc-grp"><div class="inc-grp-h"><h4>${ico('link', 15)} Déjà dans les mouvements ?</h4><span class="inc-sub">Rattacher évite de compter la dépense deux fois.</span></div>${cands.slice(0, 4).map((m) => `<div class="inc-pro"><span class="n">${esc(euros(+m.db || 0))} · ${esc(fdate(m.date))}</span><span class="m">${esc(m.lib || '')}</span><span class="a"><button type="button" class="btn bs bb" onclick="IncCircuit.rattacher(${js(String(inc.id))},${+m.id})">${ico('link', 13)} Rattacher</button></span></div>`).join('')}</div>` : ''}
      <div class="inc-g2"><div class="inc-f"><label class="inc-lb" for="inc-fac-mt">Montant TTC payé</label><input class="inp" id="inc-fac-mt" inputmode="decimal" placeholder="0,00" value="${v.montant != null ? esc(String(v.montant).replace('.', ',')) : ''}"></div>
      <div class="inc-f"><label class="inc-lb" for="inc-fac-dt">Date du paiement</label><input class="inp" id="inc-fac-dt" type="date" value="${esc(v.date || auj.toISOString().slice(0, 10))}"></div></div>
      <div class="inc-f"><label class="inc-lb" for="inc-fac-num">N° de facture <span class="inc-opt">— facultatif</span></label><input class="inp" id="inc-fac-num" value="${esc(v.numero)}"></div>
      <div class="inc-f"><span class="inc-lb">Nature de la dépense <span class="inc-opt">— suggestion, modifiable</span></span><div class="inc-fac-pick">${QP().QUALIFS.filter((q) => !q.seulementSiSuggere || q.k === sugg).map((q) => `<label><input type="radio" name="inc-fac-q" value="${q.k}"${q.k === sugg ? ' checked' : ''}><span>${esc(q.lbl)}<span class="d">${esc(q.detail)}</span></span></label>`).join('')}</div></div>`
  const signal = inc.espaceSignalementId && API()
  return {
    titre: 'Valider la fin', sub: (G('_incElLbl') ? W._incElLbl(inc) : '') + ' · ' + (G('_incBienLbl') ? W._incBienLbl(inc) : ''),
    body: `<div class="inc-grp"><div class="inc-grp-h"><h4>${ico('wrench', 15)} Constat${v.source === 'artisan' ? ' déclaré par l\'artisan' : v.source === 'facture' ? ' proposé d\'après la facture' : ''}</h4><span class="inc-sub">Modifiable : c'est lui qui décide de la règle appliquée</span></div>
        ${radio('inc-v-constat', IC.CONSTATS, v.constat)}
        ${v.constat === 'exterieure' ? radio('inc-v-sous', IC.SOUS_TYPES_EXTERIEURE, v.sousType || 'tiers') : ''}
        <div class="inc-f"><span class="inc-lb">Ampleur</span>${radio('inc-v-ampleur', IC.AMPLEURS, v.ampleur)}</div>
        <div class="inc-f"><label class="inc-lb" for="inc-v-resume">Travaux réalisés</label><textarea class="inp" id="inc-v-resume" rows="2" maxlength="1000">${esc(v.resume)}</textarea></div></div>
      ${verdictHtml}
      <div class="inc-grp"><div class="inc-grp-h"><h4>${ico('money', 15)} Argent</h4><span class="inc-sub">La dépense part dans Finances une seule fois, par le chemin existant</span></div>${ecartHtml}${argent}
        ${payeur === 'locataire' ? `<div class="inc-note">${ico('info', 13)} Le locataire verra le montant de la facture, le constat et les textes ; le remboursement se suit sur la fiche (son traitement dans la déclaration 2044 est à voir avec le comptable).</div>` : ''}</div>
      <div class="inc-note">${ico('info', 13)} ${signal ? 'Après la validation, le locataire voit le résultat expliqué dans son espace (constat, payeur, montant s\'il paie, textes cités) et peut le contester par message.' : 'Pas d\'espace locataire pour ce signalement : préparer ensuite le message au locataire si besoin.'}</div>`,
    foot: `<button type="button" class="btn bs" onclick="_incGo('fiche')">Annuler</button><button type="button" class="btn bp" id="inc-v-ok" onclick="IncCircuit.valider()">${ico('check', 14)} Valider${signal ? ' et informer le locataire' : ''}</button>`,
  }
}
function lireValidation(inc) {
  const v = Object.assign({}, etat.valid.get(String(inc.id)) || {})
  const sel = (n) => (document.querySelector('#ov-incident input[name="' + n + '"]:checked') || {}).value
  if (sel('inc-v-constat')) v.constat = sel('inc-v-constat')
  if (sel('inc-v-sous')) v.sousType = sel('inc-v-sous')
  if (sel('inc-v-ampleur')) v.ampleur = sel('inc-v-ampleur')
  if (sel('inc-v-payeur')) v.payeur = sel('inc-v-payeur')
  const r = document.getElementById('inc-v-resume'); if (r) v.travaux = r.value
  // Champ absent (dépense déjà rattachée / enregistrée) : aucun montant saisi ne survit, seul Finances fait foi.
  const m = document.getElementById('inc-fac-mt'); if (m) v.montant = IC.montant(m.value); else delete v.montant
  const n = document.getElementById('inc-fac-num'); if (n) v.numero = n.value
  const d = document.getElementById('inc-fac-dt'); if (d) v.date = d.value
  etat.valid.set(String(inc.id), v)
  return v
}
function majValidation() { const st = etatInc(), inc = st ? incidentDe(st.id) : null; if (!inc) return; lireValidation(inc); rerender() }
async function rattacher(incId, mvId) {
  const inc = incidentDe(incId); if (!inc) return
  lireValidation(inc)
  const statut = inc.statut
  if (G('_incRattacherMouvement')) W._incRattacherMouvement(mvId)   // chemin existant : la dépense reste comptée une fois
  aller('valider')
  if (statut !== 'resolu' && inc.statut === 'resolu' && !inc.valideLe) toast('Mouvement rattaché : terminer par « Valider ».', 'info', 4500)
}
async function valider() {
  const st = etatInc(), inc = st ? incidentDe(st.id) : null; if (!inc) return
  const v = lireValidation(inc)
  const k = v.constat ? IC.normaliserConstat({ constat: v.constat, sousType: v.sousType, ampleur: v.ampleur, resume: v.travaux, source: v.source || 'proprietaire' }, new Date().toISOString()) : null
  if (!k) { toast('Choisir le constat : il décide de la règle appliquée.', 'warn', 4500); return }
  const verdict = IC.verdictDuConstat(inc, k)
  if (verdict && verdict.payeur === 'a_arbitrer' && !v.payeur) { toast('Zone grise : choisir une des deux lectures.', 'warn', 4500); return }
  const montantSaisi = IC.montant(v.montant)
  const deja = (inc.mouvementIds || []).length > 0
  // JAMAIS BLOQUER : sans montant, la validation se fait sans dépense, après confirmation.
  if (!deja && !(montantSaisi > 0) && G('confirm2') && !W.confirm2('Aucun montant : la fin est validée SANS dépense dans Finances.\n\nValider quand même ?')) return
  const b = document.getElementById('inc-v-ok'); if (b) { b.disabled = true; b.textContent = 'Validation…' }
  // 1. Dépense : UNE fois, par le chemin existant (_incEnregistrerFacture → _mvCreate), seulement s'il n'y en a pas déjà.
  //    D'abord, tant que le formulaire (montant, date, numéro, nature) est à l'écran : c'est lui que ce chemin lit.
  if (!deja && montantSaisi > 0 && G('_incEnregistrerFacture')) {
    const n0 = (inc.mouvementIds || []).length
    await W._incEnregistrerFacture()
    // Dépense non créée (date vide, erreur…) : le propriétaire décide ; rien n'est publié ni demandé sans dépense réelle.
    if ((inc.mouvementIds || []).length === n0 && G('confirm2') && !W.confirm2('La dépense n\'a pas été enregistrée dans Finances (voir le message).\n\nValider quand même la fin SANS montant ? Rien ne sera demandé ni montré au locataire.')) {
      const b2 = document.getElementById('inc-v-ok'); if (b2) { b2.disabled = false; b2.innerHTML = ico('check', 14) + ' Valider' }
      return
    }
  }
  // Montant retenu = la dépense RÉELLEMENT enregistrée dans Finances, jamais un montant saisi qui n'y serait pas.
  const montantRetenu = (inc.mouvementIds || []).length && G('_incCoutBailleur') ? W._incCoutBailleur(inc) : null
  const avant = JSON.parse(JSON.stringify(inc))
  // 2. Constat, verdict, payeur retenu (règles de qui-paie.js inchangées ; champs du moteur posés pour l'historique).
  const e = IC.entreeMoteur(k)
  inc.constat = k; inc.cause = e.cause; inc.intervention = e.intervention
  if (verdict) { delete verdict.mention; inc.verdict = verdict }
  if (v.payeur) inc.payeurRetenu = v.payeur
  inc.valideLe = new Date().toISOString()
  // La facture déposée par l'artisan rejoint le dossier de preuves (sans copie du fichier).
  const x = accesActif(inc), fac = valeursValidation(inc).facture
  if (fac) joindreDepot(inc, fac)
  inc.circuit = Object.assign({}, inc.circuit || {}, { factureNumero: v.numero || null })
  if (inc.statut !== 'resolu' && IN()) IN().changerStatut(inc, 'resolu', new Date().toISOString())
  persisterInc(inc, avant)
  // 3. Résultat publié au locataire (espace locataire) — textes relus dans le référentiel.
  const payeur = inc.payeurRetenu || (inc.verdict && inc.verdict.payeur)
  if (payeur === 'locataire') { const a3 = JSON.parse(JSON.stringify(inc)); inc.remboursement = { montant: montantRetenu > 0 ? montantRetenu : null, recuLe: null }; persisterInc(inc, a3) }
  const api = API()
  if (api && inc.espaceSignalementId) await publierResultat(inc, false)
  // 4. Le lien de l'artisan reste ouvert 30 jours (facture tardive), puis expire (D14).
  if (api && x) { try { await api.rpc('ar_acces_valider', { p_acces_id: x.id }) } catch (err) { /* sans effet sur la validation */ } }
  etat.valid.delete(String(inc.id))
  toast('Fin validée.', 'ok', 4000)
  aller('fiche'); if (G('_incRefreshHost')) W._incRefreshHost()
}
// Un dépôt de l'artisan rejoint le dossier de preuves de l'incident (référence au fichier, sans copie). Idempotent.
function joindreDepot(inc, dep) {
  const D = db(); if (!D || !dep) return false
  if (!D.documents) D.documents = []
  if (D.documents.some((d) => vivant(d) && d.parentType === 'incident' && String(d.parentId) === String(inc.id) && d.cloudKey === dep.storage_path)) return false
  const nom = dep.nom || dep.type_depot || 'document'
  const doc = { id: G('nid') ? W.nid() : Date.now(), parentType: 'incident', parentId: inc.id, parentRef: String(inc.id), logRef: inc.logRef || null, category: 'travaux', idbKey: null, cloudKey: dep.storage_path, name: nom, originalName: nom, mime: dep.mime, size: 0, uploadedAt: dep.cree_le, source: 'lien-artisan' }
  if (G('_stamp')) W._stamp(doc); D.documents.push(doc)
  return true
}
const dansLeDossier = (inc, dep) => ((db() || {}).documents || []).some((d) => vivant(d) && d.parentType === 'incident' && String(d.parentId) === String(inc.id) && d.cloudKey === dep.storage_path)
function joindre(incId, depotId) {
  const inc = incidentDe(incId), x = inc ? accesActif(inc) : null; if (!inc) return
  const dep = depotsDe(x).find((d) => String(d.id) === String(depotId)); if (!dep) return
  if (joindreDepot(inc, dep)) { if (G('saveDB')) W.saveDB(); toast('Joint au dossier de l\'incident.', 'ok', 3500) }
  rerender()
}
// Résultat expliqué au locataire. Montant = la dépense RÉELLEMENT enregistrée dans Finances (jamais un montant saisi).
async function publierResultat(inc, seul) {
  const api = API(); if (!api || !inc || !inc.espaceSignalementId) return false
  const payeur = inc.payeurRetenu || (inc.verdict && inc.verdict.payeur)
  const cout = (inc.mouvementIds || []).length && G('_incCoutBailleur') ? W._incCoutBailleur(inc) : null
  const r = IC.resultatPourLocataire({ verdict: inc.verdict, payeurRetenu: inc.payeurRetenu, constat: inc.constat, montantTtc: payeur === 'locataire' && cout > 0 ? cout : null, factureNumero: (inc.circuit && inc.circuit.factureNumero) || '' })
  if (r.erreur) { if (seul) toast(r.erreur, 'warn', 5000); return false }
  try {
    if (await api.publierResultat(inc.espaceSignalementId, r)) { const a4 = JSON.parse(JSON.stringify(inc)); inc.resultatPublieLe = r.publieLe; persisterInc(inc, a4); if (seul) { toast('Résultat publié dans l\'espace du locataire.', 'ok', 4000); rerender() } return true }
  } catch (err) { /* message ci-dessous */ }
  toast('Résultat non publié dans l\'espace locataire (connexion ?) : réessayer avec « Publier le résultat » sur la fiche.', 'warn', 6000)
  return false
}
async function publier(incId) {
  const b = document.getElementById('inc-pub'); if (b) b.disabled = true
  await publierResultat(incidentDe(incId), true)
  if (b) b.disabled = false
}
function rembourse(incId) {
  const inc = incidentDe(incId); if (!inc || !inc.remboursement) return
  const avant = JSON.parse(JSON.stringify(inc))
  inc.remboursement = Object.assign({}, inc.remboursement, { recuLe: inc.remboursement.recuLe ? null : new Date().toISOString().slice(0, 10) })
  persisterInc(inc, avant); rerender()
}

// ─────────────────────────── Après l'import d'un signalement : prévenir l'artisan du carnet (D6) ───────────────────────────
async function apresImport(inc) {
  try {
    if (!inc || inc.circuit) return
    const a = IC.artisanAPrevenir(artisans(), { metier: metierDe(inc), entity: (entiteDe(inc) || {}).nom || inc.entity || '', incidents: (db() || {}).incidents || [] })
    if (!a) return
    const r0 = await etatRelais()
    // E-mail actif et artisan avec e-mail : Propryo le prévient directement. Sinon : un seul geste, « Envoyer la demande ».
    if (r0.emails && a.email && API()) { await envoyer(String(inc.id), String(a.id)); return }
    toast('Signalement reçu : ' + a.nom + ' (carnet) peut être prévenu en un geste depuis l\'incident.', 'info', 6500)
  } catch (e) { console.warn('[circuit] après import', e && e.message) }
}

// ─────────────────────────── Démarrage ───────────────────────────
let _demarre = false
export function demarrer() {
  if (_demarre) return
  _demarre = true
  W.IncCircuit = {
    joindre, publier,
    carteHtml, piedHtml, verdictVisible, verdictAttenteHtml,
    vues: { artisan: vueArtisan, choisir: vueChoisir, carnet: vueCarnet, plafond: vuePlafond, devis: vueDevis, 'facture-ia': vueFactureIa, valider: vueValider },
    envoyer, renvoyer, retirer, choisir, confirmerChoix, editer, enregistrerArtisan, supprimerArtisan, suggerer, validerPlafond, decider, lireDepot, deposerFacture,
    majValidation, valider, rattacher, rembourse, ouvrirDepot, ouvrirPhotos, apresImport,
    // PREMIERS-PAS D3 : Paramètres › Artisans et plafond (hors incident)
    parametres, ap: { plafond: apPlafond, validerPlafond: apValiderPlafond, artisan: apArtisan, enregistrer: apEnregistrer, retirer: apRetirer, fermer: apFermer },
    metier: (m) => { etat.filtreMetier = m; rerender() },
    toutVoir: (incId) => { const inc = incidentDe(incId); if (!inc) return; const s = etat.sugg.get(cleInc(inc) + '|' + (etat.filtreMetier || metierDe(inc))); if (s) { s.tout = true; rerender() } },
  }
  // Ouverture d'un incident : le métier choisi la dernière fois ne s'applique pas au suivant.
  const ouvrir = W.openIncident
  if (typeof ouvrir === 'function' && !ouvrir.__circuit) { W.openIncident = function (...a) { etat.filtreMetier = null; etat.choix = null; return ouvrir.apply(this, a) }; W.openIncident.__circuit = true }
  const tenter = () => { try { if (db() && Array.isArray(db().incidents)) migrerCarnet() } catch (e) { console.warn('[circuit] migration du carnet', e && e.message) } }
  setTimeout(tenter, 2500)
  // Fiche ouverte : les dépôts de l'artisan apparaissent sans recharger (toutes les 60 s).
  setInterval(() => { const st = etatInc(); const inc = st && st.id != null ? incidentDe(st.id) : null; if (inc && API() && document.getElementById('ov-incident') && !document.getElementById('ov-incident').classList.contains('hidden')) chargerCircuit(inc, true).then(() => { if (etatInc() && etatInc().view === 'fiche') rerender() }) }, 60_000)
}

export const _pourTests = { verdictVisible, valeursValidation }
