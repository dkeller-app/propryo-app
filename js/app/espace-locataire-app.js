// js/app/espace-locataire-app.js — ESPACE LOCATAIRE, côté PROPRIÉTAIRE (et associés de la SCI).
// CDC : mockups/ESPACE-LOCATAIRE/CDC-ESPACE-LOCATAIRE.md — décisions D1 → D14 (GO Didier 14/10/2026). Migration 0059.
//
// Chargé après l'affichage de l'app (supabase-entry.js, mode cloud seulement). Rôles :
//  1. bloc « Espace locataire » de l'onglet Bail de la fiche logement (window._elBlocHtml, appelé par rLogFiche) :
//     état du lien par colocataire, dernière visite, accord électronique, créer / renouveler et envoyer / révoquer,
//     documents visibles (retrait), messages ;
//  2. PUBLICATION automatique des documents définitifs du bail (D6) : bail et avenants signés (fichiers déjà
//     archivés), états des lieux signés, quittances et décomptes (PDF figés au moment de la publication), justificatifs ;
//  3. IMPORT des signalements du locataire dans le registre des incidents (D11, nouvelIncident) ;
//  4. fin de bail / clôture des comptes reportées sur les accès (phases D4).
// Le jeton est tiré ICI (navigateur du propriétaire) ; seule son empreinte part en base ; le lien n'est montré qu'une
// fois (D3). Toute écriture passe par la RLS par SCI (window.__immoEspaceLoc, supabase-entry.js).
//  5. QUITTANCE DÉPOSÉE AUTOMATIQUEMENT (GO Didier 19/10/2026, mockups/QUITTANCE-ESPACE-LOCATAIRE) : dès qu'un mois est
//     payé en entier d'après le moteur (moisAQuittancer / peutQuittancer), la quittance est créée au registre par la
//     fabrique unique (_creerQuittance) puis publiée ; si le mois n'est plus payé en entier, elle est retirée de l'espace
//     (retire_le) et garde une mention au registre. Règles pures : js/core/quittance-auto.js.
import * as EL from '../core/espace-locataire.js'
import * as QA from '../core/quittance-auto.js'
import { bailLigneCle } from '../core/store-mapping.js'
import { validationsDuLogement, estDeLEspacePropre } from '../core/regul-validation.js'

const W = window
const API = () => W.__immoEspaceLoc
const G = (n) => (typeof W[n] === 'function' ? W[n] : null)          // fonctions globales de l'app (déclarations classiques)
const esc = (s) => (G('escHtml') ? W.escHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])))
const ico = (n, s) => (G('_uiIcon') ? W._uiIcon(n, s) : '')
const toast = (m, t, d) => { if (G('showToast')) W.showToast(m, t || 'ok', d) }
const fdate = (s) => (G('fd') ? W.fd(String(s || '').slice(0, 10)) : String(s || '').slice(0, 10))
const fdh = (s) => { const d = new Date(s); if (isNaN(d)) return ''; return fdate(d.toISOString()) + ' à ' + String(d.getHours()).padStart(2, '0') + ' h ' + String(d.getMinutes()).padStart(2, '0') }
// Même lecture de date que store-mapping (dateOnly) : « AAAA-MM-JJ… » tel quel, sinon date UTC.
const jour = (s) => { const v = String(s == null ? '' : s); if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10); const d = new Date(v); return v && !isNaN(d) ? d.toISOString().slice(0, 10) : '' }
const db = () => { try { return DB } catch (e) { return null } }   // eslint-disable-line no-undef
const vivant = (o) => o && !o._deleted
// `_appReadOnly` est un `let` de script (app-part3.js) : PAS une propriété de window — lu par son nom, sous try.
const lectureSeule = () => { try { return _appReadOnly === true } catch (e) { return false } }   // eslint-disable-line no-undef
const horsLigne = () => W.__immoHorsLigne === true
// UN SEUL PUBLIEUR des quittances automatiques : le poste du propriétaire de l'espace du logement (comme les décomptes) —
// deux postes qui créeraient chacun la quittance du même mois laisseraient deux entrées au registre.
const deLEspacePropre = (log) => estDeLEspacePropre(log, G('_optsEspacePropre') ? W._optsEspacePropre() : {})
// LE verdict par mois du lot, lu au moteur unique (le même appel que la fabrique _creerQuittance). null = moteur absent.
const etatLot = (ref) => { try { return G('_loyerEtatLot') ? (W._loyerEtatLot(ref) || null) : null } catch (e) { return null } }
// Même convertisseur que le registre (moisFrToYm, tolérant aux accents : « aout 2026 ») — sinon une ancienne quittance
// mal orthographiée ne serait pas reconnue et le mois serait quittancé une seconde fois.
const ymDeQuittance = (q) => (G('moisFrToYm') ? (W.moisFrToYm(q && q.mois) || null) : EL.moisCle(q && q.mois))
// La quittance du REGISTRE d'un mois de cette location (identité + mois : jamais celle d'un autre locataire).
function quittanceDuRegistre(t, ym, loc) {
  return ((db() || {}).quittances || []).find((q) => vivant(q) && q.logement === t.ref && ymDeQuittance(q) === ym && EL.quittanceDeLaLocation(q, loc)) || null
}
// Repli SANS identité (nom du locataire corrigé depuis l'émission) : seulement si la location couvre le mois EN ENTIER
// (personne d'autre n'a pu y habiter) et qu'il n'existe qu'UNE quittance vivante de ce logement pour ce mois.
function quittanceSeuleDuMois(t, ym, loc) {
  if (!QA.moisEntierDansLocation(ym, t.debut, loc && loc.fin)) return null
  const l = ((db() || {}).quittances || []).filter((q) => vivant(q) && q.logement === t.ref && ymDeQuittance(q) === ym)
  return l.length === 1 ? l[0] : null
}

const etat = { acces: [], docs: new Map(), msgs: new Map(), relais: null, charge: false, enCours: false, dernier: 0, accesLuLe: 0, accesTenteLe: 0, echecs: new Set() }

// ─────────────────────────── Correspondance bail (app) ↔ ligne `baux` (cloud) ───────────────────────────
function locatairesDuBail(bail, log) {
  if (bail && Array.isArray(bail.locataires) && bail.locataires.length)
    return bail.locataires.map((l) => ({ nom: String((l && l.nom) || '').trim() || 'Locataire', email: String((l && l.email) || '').trim() }))
  return [{ nom: String((bail && bail.nom) || (log && log.locataire) || 'Locataire').trim(), email: String((bail && bail.email) || (log && log.mail) || '').trim() }]
}
function logDe(ref) { return ((db() || {}).logements || []).find((l) => vivant(l) && l.ref === ref) || null }
function entNomDe(bail, log) { return (bail && bail.entity) || (log && log.entity) || null }
function bailId(ref, bail) {
  const a = API(); if (!a || !bail) return null
  const r = String(ref).split('@@')[0]
  return a.uuid('bail', bailLigneCle(r, bail._bailUid), entNomDe(bail, logDe(r)))
}
// Toutes les locations connues (en cours + archivées), indexées par id de ligne `baux`.
function locations() {
  const D = db() || {}, out = []
  for (const [k, bail] of Object.entries(D.baux || {})) {
    if (!vivant(bail)) continue
    const ref = String(k).split('@@')[0]
    out.push({ ref, bail, archive: false, id: bailId(ref, bail), debut: jour(bail.debut) || null })
  }
  for (const h of D.baux_historique || []) {
    if (!vivant(h) || !h.ref) continue
    out.push({ ref: String(h.ref).split('@@')[0], bail: h, archive: true, id: bailId(h.ref, h), debut: jour(h.debut) || null })
  }
  return out
}
function locationDe(a) {
  return locations().find((t) => t.id === a.bail_id && (t.debut || null) === (a.bail_debut || null)) || null
}
const finOcc = (bail, archive) => (typeof W.finOccupationBail === 'function' ? W.finOccupationBail(bail, archive) : String(bail.finEffective || (archive ? bail.fin : '') || ''))

// ─────────────────────────── Chargement ───────────────────────────
async function chargerAcces() {
  const a = API(); if (!a || !a.pret()) return
  try {
    etat.acces = await a.select('locataire_acces', {}, 'id,espace_id,entite_id,logement_id,bail_id,bail_debut,locataire_rang,locataire_nom,emis_le,revoque_le,fin_bail,comptes_clos_le,derniere_visite,accord_quittance_le,accord_quittance_version,accord_quittance_code,accord_retire_le')
    const ids = etat.acces.map((x) => x.id)
    etat.msgs = new Map()
    if (ids.length) {
      const m = await a.select('locataire_messages', { acces_id: ids }, 'id,acces_id,auteur,corps,pieces,cree_le,lu_bailleur_le,signalement_id')
      for (const x of m) { if (!etat.msgs.has(x.acces_id)) etat.msgs.set(x.acces_id, []); etat.msgs.get(x.acces_id).push(x) }
      for (const l of etat.msgs.values()) l.sort((p, q) => String(p.cree_le).localeCompare(String(q.cree_le)))
    }
    etat.charge = true
    etat.accesLuLe = Date.now()
  } catch (e) { console.warn('[espace-locataire] accès', e && e.message) }
}
async function chargerDocs(bid) {
  try { etat.docs.set(bid, await API().select('locataire_documents', { bail_id: bid })) } catch (e) { etat.docs.set(bid, []) }
  return etat.docs.get(bid)
}
async function etatRelais() {
  if (etat.relais) return etat.relais
  try {
    const cfg = G('_relayCfg') ? W._relayCfg() : null
    const r = cfg ? await fetch(cfg.base + '/el/etat', { cache: 'no-store' }) : null
    etat.relais = r && r.ok ? await r.json() : { actif: false, emails: false }
  } catch (e) { etat.relais = { actif: false, emails: false } }
  return etat.relais
}

// ─────────────────────────── Bloc « Espace locataire » (fiche logement, onglet Bail) ───────────────────────────
const DUREE_LECTURE_ACCES = 60_000
const nonLus = (accesId) => (etat.msgs.get(accesId) || []).filter((m) => m.auteur === 'locataire' && !m.lu_bailleur_le).length
function accesDe(bid, debut) { return etat.acces.filter((a) => a.bail_id === bid && (a.bail_debut || null) === (debut || null)) }
const aujourdhui = () => jour(new Date().toISOString())
// Date d'activation (D2) : le jour LOCAL du propriétaire, comme le moteur (_loyerTodayLocal) — pas le jour UTC.
const jourLocal = () => { try { const v = G('_loyerTodayLocal') ? W._loyerTodayLocal() : ''; return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : aujourdhui() } catch (e) { return aujourdhui() } }
// Le colocataire d'un accès est identifié par son NOM (le rang dans bail.locataires bouge quand un colocataire part).
const accesDuLocataire = (liste, nom) => liste.find((y) => EL.cleNom(y.locataire_nom) === EL.cleNom(nom)) || null
const emailDe = (t, nom) => { if (!t) return ''; const l = locatairesDuBail(t.bail, logDe(t.ref)).find((x) => EL.cleNom(x.nom) === EL.cleNom(nom)); return (l && l.email) || '' }

function ligneAcces(x, note) {
  const ph = EL.phaseAcces(x.fin_bail, x.comptes_clos_le, aujourdhui())
  const lien = x.revoque_le ? 'Révoqué le ' + fdate(x.revoque_le)
    : ph === 'fini' ? 'Période de consultation terminée'
    : x.derniere_visite ? 'Actif · dernière visite le ' + fdh(x.derniere_visite) : 'Jamais ouvert · émis le ' + fdate(x.emis_le)
  const acc = EL.etatAccord(x, fdh)
  const fin = EL.finAcces(x.fin_bail, x.comptes_clos_le)
  const nm = (etat.msgs.get(x.id) || []).length, nl = nonLus(x.id)
  const actions = (ph === 'fini' ? '' : `<button type="button" class="btn bs bb" onclick="EspaceLoc.renouveler('${x.id}')">${ico('refresh', 14)} ${x.revoque_le ? 'Réactiver et envoyer' : 'Renouveler et envoyer'}</button>`)
    + (x.revoque_le || ph === 'fini' ? '' : `<button type="button" class="btn bs bb" onclick="EspaceLoc.revoquer('${x.id}')">${ico('close', 14)} Révoquer</button>`)
    + `<button type="button" class="btn bs bb" onclick="EspaceLoc.messages('${x.id}')">${ico('send', 14)} Messages${nl ? ' · ' + nl + ' non lu' + (nl > 1 ? 's' : '') : ''}</button>`
  return `<div class="el-locrow"><div class="el-locrow-h"><b>${esc(x.locataire_nom)}</b></div>
    ${note ? `<p class="el-note">${esc(note)}</p>` : ''}
    <div class="logf-bail-grid">
      <div class="logf-row"><span class="logf-label">Lien</span><span class="logf-value">${esc(lien)}</span></div>
      <div class="logf-row"><span class="logf-label">Quittance électronique</span><span class="logf-value">${esc(acc.texte)}</span></div>
      <div class="logf-row"><span class="logf-label">Fin d'accès</span><span class="logf-value">${fin ? esc(fdate(fin)) : 'À la clôture des comptes + 6 mois'}</span></div>
      <div class="logf-row"><span class="logf-label">Messages</span><span class="logf-value">${nm} message${nm > 1 ? 's' : ''}${nl ? ' · ' + nl + ' non lu' + (nl > 1 ? 's' : '') : ''}</span></div>
    </div>
    <div class="logf-bail-actions">${actions}</div></div>`
}

// Interrupteur « Déposer les quittances automatiquement » d'une location (exception au réglage global, D1). Montré au seul
// propriétaire de l'espace : c'est son poste qui dépose (un associé ne verrait qu'un réglage sans effet).
function blocQuittancesAuto(log, bail, ref, bid, debut) {
  if (!log || !deLEspacePropre(log)) return ''
  const D = db() || {}
  const rg = QA.reglage(D.params, ref, debut)
  const visibles = (etat.docs.get(bid) || []).filter((d) => d.type_doc === 'quittance' && !d.retire_le && (d.bail_debut || null) === (debut || null))
  const derniere = visibles.map((d) => ({ d, ym: QA.ymDeCle(d.cle) })).filter((x) => x.ym).sort((a, b) => b.ym.localeCompare(a.ym))[0]
  const detail = rg.actif
    ? 'Dès qu\'un mois est payé en entier (loyer et charges).' + (derniere ? ' Dernière : ' + esc(derniere.d.periode || derniere.ym) + ', déposée le ' + esc(fdate(derniere.d.publie_le)) + '.' : '')
    : 'Désactivé pour ce bail : les quittances faites à la main restent déposées.'
  return `<div class="el-qauto"><button type="button" class="el-sw" role="switch" aria-checked="${rg.actif ? 'true' : 'false'}" onclick='EspaceLoc.basculerQuittancesAuto(${esc(JSON.stringify(ref))},${esc(JSON.stringify(debut))})'>`
    + `<span class="el-sw-tr" aria-hidden="true"></span><span><b>Déposer les quittances automatiquement</b><span class="el-sw-d">${detail}</span></span></button></div>`
}
function basculerQuittancesAuto(ref, debut) {
  const D = db(); if (!D) return
  if (lectureSeule()) { toast('Lecture seule : réglage non modifiable.', 'warn'); return }
  if (!D.params) D.params = {}
  const avant = D.params.elQuittancesAuto
  const actif = !QA.reglage(D.params, ref, debut).actif
  D.params.elQuittancesAuto = QA.basculerBail(D.params, ref, debut, actif, jourLocal())
  if (G('saveDB') && W.saveDB() === false) { D.params.elQuittancesAuto = avant; toast('Réglage non enregistré (hors ligne).', 'err'); majBloc(); return }
  toast(actif ? 'Quittances déposées automatiquement pour ce bail, pour les mois payés en entier à partir d\'aujourd\'hui.' : 'Dépôt automatique des quittances désactivé pour ce bail.', 'ok', 5000)
  majBloc()
  if (actif) publierBientot()
}
// Carte du réglage GLOBAL (Paramètres › Bail). Vide hors du mode cloud (pas d'espace locataire).
function paramsQuittancesHtml() {
  const g = QA.reglageGlobal((db() || {}).params)
  const exc = g.exceptions.length ? `<p class="el-note" style="margin:10px 0 0">Exception en cours : ${g.exceptions.length} bail${g.exceptions.length > 1 ? 'x' : ''} (${esc(g.exceptions.map((k) => k.split('|')[0]).join(', '))}).</p>` : ''
  return `<div class="el-qparam"><div class="el-qparam-t">${ico('receipt', 16)} Quittances dans l'espace locataire</div>
    <p class="el-note">S'applique à chaque bail dont l'espace locataire est ouvert. Un bail peut faire exception : fiche du logement, onglet Bail.</p>
    <button type="button" class="el-sw" role="switch" aria-checked="${g.actif ? 'true' : 'false'}" onclick="EspaceLoc.basculerQuittancesAutoGlobal()"><span class="el-sw-tr" aria-hidden="true"></span><span><b>Déposer les quittances automatiquement</b>
    <span class="el-sw-d">La quittance d'un mois est créée et déposée dès que ce mois est payé en entier d'après le suivi des loyers (import du relevé ou paiement saisi), pour les paiements datés du jour de l'activation ou après. Si le mois n'est plus payé en entier, elle est retirée de l'espace et reste au registre.</span></span></button>${exc}</div>`
}
function basculerQuittancesAutoGlobal() {
  const D = db(); if (!D) return
  if (lectureSeule()) { toast('Lecture seule : réglage non modifiable.', 'warn'); return }
  if (!D.params) D.params = {}
  const avant = D.params.elQuittancesAuto
  const actif = !QA.reglageGlobal(D.params).actif
  D.params.elQuittancesAuto = QA.basculerGlobal(D.params, actif, jourLocal())
  if (G('saveDB') && W.saveDB() === false) { D.params.elQuittancesAuto = avant; toast('Réglage non enregistré (hors ligne).', 'err') }
  else toast(actif ? 'Quittances déposées automatiquement, pour les mois payés en entier à partir d\'aujourd\'hui.' : 'Dépôt automatique des quittances désactivé.', 'ok', 5000)
  const host = document.getElementById('param-el-quittances'); if (host) host.innerHTML = paramsQuittancesHtml()
  if (actif) publierBientot()
}

function blocInterieur(log, bail, ref) {
  const a = API()
  if (!a || !a.pret()) return ''
  const r = String(ref).split('@@')[0]
  const bid = bail ? bailId(ref, bail) : null, debut = bail ? (jour(bail.debut) || null) : null
  const liste = bail ? accesDe(bid, debut) : []
  // Anciennes locations du logement qui ont encore un accès (départ, documents seuls) : visibles et pilotables.
  const anciennes = new Map()
  for (const x of etat.acces) {
    if (bail && x.bail_id === bid && (x.bail_debut || null) === debut) continue
    const t = locationDe(x) || (x.logement_id && x.logement_id === a.uuid('logement', EL.cleNom(r), entNomDe(bail, log)) ? { ref: r, id: x.bail_id, debut: x.bail_debut || null } : null)
    if (!t || t.ref !== r) continue
    const k = x.bail_id + '|' + (x.bail_debut || '')
    if (!anciennes.has(k)) anciennes.set(k, { t, acces: [] })
    anciennes.get(k).acces.push(x)
  }
  if (!bail && !anciennes.size) return ''
  const actifs = liste.filter((x) => !x.revoque_le).length
  const chip = !etat.charge ? '<span class="logf-badge b-mute">Chargement…</span>'
    : actifs ? `<span class="logf-badge b-ok">${actifs} lien${actifs > 1 ? 's' : ''} actif${actifs > 1 ? 's' : ''}</span>` : '<span class="logf-badge b-mute">' + (bail ? 'Pas encore ouvert' : 'Ancienne location') + '</span>'
  const jsRef = esc(JSON.stringify(String(ref)))
  let corps = ''
  if (bail) {
    const locs = locatairesDuBail(bail, log)
    corps += locs.map((l, rang) => {
      const x = accesDuLocataire(liste, l.nom)
      if (!x) return `<div class="el-locrow"><div class="el-locrow-h"><b>${esc(l.nom)}</b><button type="button" class="btn bs bb" onclick='EspaceLoc.creer(${jsRef},${rang})'>${ico('link', 14)} Créer le lien</button></div></div>`
      return ligneAcces(x)
    }).join('')
    // Accès d'un colocataire qui n'est plus au bail (départ, nom corrigé) : jamais invisible, toujours révocable.
    for (const x of liste) if (!locs.some((l) => EL.cleNom(l.nom) === EL.cleNom(x.locataire_nom))) corps += ligneAcces(x, 'N\'est plus colocataire de ce bail : révoquer le lien si le départ est réglé.')
    const nDocs = (etat.docs.get(bid) || []).filter((d) => !d.retire_le && (d.bail_debut || null) === debut).length
    if (liste.length) corps += blocQuittancesAuto(log, bail, r, bid, debut)
    corps += `<div class="logf-bail-actions"><button type="button" class="btn bs bb" onclick='EspaceLoc.documents(${esc(JSON.stringify(bid))},${esc(JSON.stringify(debut))})'>${ico('doc', 14)} Documents visibles${etat.docs.has(bid) ? ' · ' + nDocs : ''}</button></div>`
  }
  for (const { t, acces } of anciennes.values()) {
    corps += `<h4 class="el-sous-titre">Ancienne location${t.debut ? ' du ' + esc(fdate(t.debut)) : ''}</h4>` + acces.map((x) => ligneAcces(x)).join('')
      + `<div class="logf-bail-actions"><button type="button" class="btn bs bb" onclick='EspaceLoc.documents(${esc(JSON.stringify(t.id))},${esc(JSON.stringify(t.debut))})'>${ico('doc', 14)} Documents visibles</button></div>`
  }
  return `<div class="flex-b" style="margin-bottom:10px;flex-wrap:wrap;gap:10px"><h3 class="logf-panel-title" style="margin:0">${ico('link')} Espace locataire</h3>${chip}</div>
    <p class="logf-panel-empty" style="margin:0 0 10px;text-align:left">Un lien personnel par locataire, sans mot de passe. Les documents définitifs de ce bail y sont publiés automatiquement.</p>
    ${corps}`
}
function blocHtml(log, bail, ref) {
  try {
    if (!API() || !API().pret()) return ''
    if (!etat.charge && !etat.enCours) setTimeout(() => { rafraichir().then(majBloc) }, 0)
    // « Dernière visite » : les accès sont relus à l'ouverture de la fiche si la lecture a plus d'une minute (sinon le bloc
    // montrait la valeur du dernier cycle, jusqu'à 10 minutes plus tôt). majBloc ne relance rien : pas de boucle.
    else if (etat.charge && !etat.enCours && Date.now() - Math.max(etat.accesLuLe, etat.accesTenteLe) > DUREE_LECTURE_ACCES) { etat.accesTenteLe = Date.now(); setTimeout(() => { rafraichir().then(majBloc) }, 0) }
    const bid = bail ? bailId(ref, bail) : null
    if (bid && !etat.docs.has(bid)) chargerDocs(bid).then(majBloc)
    const html = blocInterieur(log, bail, ref)
    // Logement sans bail ni ancien accès : conteneur vide, rempli si des accès arrivent au chargement.
    return `<div class="logf-panel el-bloc" style="grid-column:1/-1${html ? '' : ';display:none'}" id="el-bloc" data-ref="${esc(ref)}">${html}</div>`
  } catch (e) { console.warn('[espace-locataire] bloc', e); return '' }
}
function majBloc() {
  const n = document.getElementById('el-bloc'); if (!n) return
  const ref = n.getAttribute('data-ref'); const D = db() || {}
  const bail = G('_bienActiveBail') ? W._bienActiveBail(ref) : ((D.baux && D.baux[ref] && vivant(D.baux[ref]) && !D.baux[ref].cloture && !D.baux[ref].finEffective) ? D.baux[ref] : null)
  const html = blocInterieur(logDe(String(ref).split('@@')[0]), bail, ref)
  n.innerHTML = html
  n.style.display = html ? '' : 'none'
}

// ─────────────────────────── Couches (composant .ov / .modal de l'app) ───────────────────────────
function couche(id, titre, corps, pied) {
  const old = document.getElementById(id); if (old) old.remove()
  document.body.insertAdjacentHTML('beforeend', `<div class="ov" id="${id}" onclick="closeBg(event,'${id}')"><div class="modal" style="max-width:600px" role="dialog" aria-modal="true" aria-label="${esc(titre)}">
    <div class="m-head"><h3>${esc(titre)}</h3><button class="m-close" aria-label="Fermer" onclick="closeM('${id}')">${ico('close', 18)}</button></div>
    <div class="m-body">${corps}</div>${pied ? `<div class="m-foot">${pied}</div>` : ''}</div></div>`)
  if (G('openM')) W.openM(id)
}
const fermer = (id) => { if (G('closeM')) W.closeM(id) }

// ─────────────────────────── Émettre / renouveler / révoquer (D3) ───────────────────────────
async function partagerLien(jeton, nom, email, bienLabel, accesId) {
  const cfg = G('_relayCfg') ? W._relayCfg() : null
  const lien = cfg ? EL.lienEspace(cfg.base, jeton) : null
  if (!lien) { toast("Adresse du relais introuvable ou non sécurisée (https exigé) : lien non transmis.", 'err', 6000); return }
  const r = await etatRelais()
  let info = '<b>Lien affiché une seule fois.</b> Seule son empreinte est enregistrée : pour le transmettre à nouveau plus tard, le renouveler (l\'ancien cessera de fonctionner).'
  if (r.emails && accesId) {
    const ok = await notifier('invitation', accesId, { jeton })
    if (ok) info = 'Invitation envoyée par e-mail à l\'adresse du bail. ' + info
  }
  // COMPTE DÉMO (?demo=1) : nuage fictif local — le lien a la forme réelle mais aucune page locataire ne l'attend.
  if (W.__immoDemo === true) info = '<b>Démonstration :</b> lien fictif, la page du locataire ne s\'ouvre qu\'avec un vrai compte. ' + info
  if (G('_openShareModal')) {
    W._openShareModal({
      title: 'Lien de l\'espace locataire', ctxIcon: ico('link', 20), ctxTitle: bienLabel,
      ctxSub: 'Locataire : <b>' + esc(nom) + '</b>', url: lien, linkLabel: 'Lien personnel', email: email || '',
      subject: 'Espace locataire — ' + bienLabel,
      message: 'Bonjour,\n\nVoici le lien personnel de l\'espace locataire, sans mot de passe : documents du bail, quittances, signalement d\'un problème, messages.\nLe garder en favori et ne pas le transférer.',
      smsLead: 'Espace locataire (lien personnel, ne pas transférer) : ', info, doneJs: 'void 0;',
    })
  }
}
async function creer(ref, rang) {
  const D = db() || {}; const bail = D.baux && D.baux[ref]; const log = logDe(String(ref).split('@@')[0])
  if (!bail) return
  const loc = locatairesDuBail(bail, log)[rang]; if (!loc) return
  if (!(bail.locataires || []).length && !(bail.nom || (log && log.locataire))) { toast('Saisir d\'abord le nom du locataire dans le bail.', 'warn', 5000); return }
  try {
    const jeton = EL.nouveauJeton(); const h = await EL.empreinteJeton(jeton)
    const id = await API().rpc('el_acces_emettre', { p_bail_id: bailId(ref, bail), p_rang: rang, p_nom: loc.nom, p_jeton_sha256: h })
    await rafraichir(); majBloc()
    await partagerLien(jeton, loc.nom, loc.email, (log && (log.adr || log.ref)) || ref, id)
    publierBientot()
  } catch (e) { toast(/el:nom-ambigu/.test(e.message) ? 'Lien non créé : deux colocataires portent le même nom dans le bail ; les distinguer d\'abord.' : 'Lien non créé : bail pas encore enregistré dans le cloud (réessayer dans un instant), droit insuffisant ou connexion perdue.', 'err', 6000) }
}
async function renouveler(accesId) {
  const x = etat.acces.find((a) => a.id === accesId); if (!x) return
  try {
    const jeton = EL.nouveauJeton(); const h = await EL.empreinteJeton(jeton)
    await API().rpc('el_acces_renouveler', { p_acces_id: accesId, p_jeton_sha256: h })
    await rafraichir(); majBloc()
    const t = locationDe(x); const log = t ? logDe(t.ref) : null
    await partagerLien(jeton, x.locataire_nom, emailDe(t, x.locataire_nom), (log && (log.adr || log.ref)) || '', accesId)
  } catch (e) { toast('Renouvellement impossible : ' + (/periode-terminee/.test(e.message) ? 'la période de consultation est terminée.' : 'droit insuffisant ou connexion perdue.'), 'err', 6000) }
}
async function revoquer(accesId) {
  const x = etat.acces.find((a) => a.id === accesId); if (!x) return
  const ok = G('confirm2') ? W.confirm2('Révoquer le lien de ' + x.locataire_nom + ' ?\n\nLe lien cesse de fonctionner immédiatement, sur tous ses appareils. Les documents, messages et signalements restent enregistrés. Un nouveau lien peut être créé ensuite.') : true
  if (!ok) return
  try { await API().rpc('el_acces_revoquer', { p_acces_id: accesId }); await rafraichir(); majBloc(); toast('Lien révoqué.') }
  catch (e) { toast('Révocation impossible : droit insuffisant ou connexion perdue.', 'err', 5000) }
}

// ─────────────────────────── Documents visibles (D6 : retrait possible) ───────────────────────────
const LIB_TYPE = { bail: 'Bail', avenant: 'Avenant', edl: 'État des lieux', quittance: 'Quittance', decompte: 'Décompte de charges', justificatif: 'Justificatif' }
async function documents(bid, debut) {
  if (!bid) return
  const ref = bid
  const liste = (await chargerDocs(bid)).filter((d) => (d.bail_debut || null) === (debut || null))
    .sort((a, b) => String(b.date_doc || b.publie_le).localeCompare(String(a.date_doc || a.publie_le)))
  // Quittance : mention lue au REGISTRE (déposée automatiquement / retirée parce que le mois n'est plus payé en entier).
  const t = locations().find((x) => x.id === bid && (x.debut || null) === (debut || null)) || null
  const qDe = (d) => { if (!t || d.type_doc !== 'quittance') return null; const ym = QA.ymDeCle(d.cle); return ym ? quittanceDuRegistre(t, ym, locInfo(t)) : null }
  const sousTitre = (d, q) => (d.retire_le && QA.motifRetrait(q) === 'non_solde')
    ? `<div class="el-doc-s el-doc-w">Retirée le ${esc(fdate(d.retire_le))} : le mois n'est plus payé en entier (paiement annulé ou reclassé). La quittance reste au registre ; elle sera déposée à nouveau quand le mois sera payé en entier.</div>`
    : `<div class="el-doc-s">${esc(LIB_TYPE[d.type_doc] || '')}${d.date_doc ? ' · ' + esc(fdate(d.date_doc)) : ''}${d.visible_jusqu_au ? ' · visible jusqu\'au ' + esc(fdate(d.visible_jusqu_au)) : ''}${d.retire_le ? ' · retiré le ' + esc(fdate(d.retire_le)) : ''}${!d.retire_le && q && q.origine === 'espace-locataire' ? ' · déposée automatiquement' : ''}</div>`
  const ligne = (d) => `<div class="el-docrow"><div><b>${esc(d.titre)}</b>${sousTitre(d, qDe(d))}</div>`
    + (d.retire_le ? '' : `<button type="button" class="btn bs bb" onclick='EspaceLoc.retirer(${esc(JSON.stringify(d.id))},${esc(JSON.stringify(ref))},${esc(JSON.stringify(debut))})'>Retirer</button>`) + '</div>'
  couche('ov-el-docs', 'Documents visibles', `<p class="el-note">Publiés automatiquement dès qu'ils sont définitifs (bail et avenants signés, états des lieux signés, quittances, décomptes de charges et justificatifs). Une quittance n'est visible que si son mois est payé en entier. Retirer un document le masque dans l'espace ; le fichier reste conservé.</p>`
    + (liste.length ? liste.map(ligne).join('') : '<p class="logf-panel-empty">Aucun document publié pour le moment.</p>'),
  `<button class="btn bs" onclick="EspaceLoc.publierMaintenant()">${ico('refresh', 14)} Publier maintenant</button><button class="btn bp" onclick="closeM('ov-el-docs')">Terminé</button>`)
}
async function retirer(docId, bid, debut) {
  const ok = G('confirm2') ? W.confirm2('Retirer ce document de l\'espace locataire ?\n\nIl ne sera plus visible du locataire. Le fichier reste conservé et le document ne sera pas republié automatiquement.') : true
  if (!ok) return
  try {
    const le = new Date().toISOString()
    const res = await API().update('locataire_documents', docId, { retire_le: le })
    if (!res || !res.length) { toast('Document non retiré : droit insuffisant ou document introuvable.', 'err', 5000); documents(bid, debut); return }
    // Retrait À LA MAIN (D6) : la quittance du registre reçoit la marque « manuel » — le mois redevenu soldé ne la
    // republiera jamais (une marque « non_solde » de la règle est remplacée).
    const d = (etat.docs.get(bid) || []).find((x) => x.id === docId)
    const t = d && d.type_doc === 'quittance' ? locations().find((x) => x.id === bid && (x.debut || null) === (debut || null)) : null
    const ym = d ? QA.ymDeCle(d.cle) : null
    const loc = t ? locInfo(t) : null
    const q = t && ym ? (quittanceDuRegistre(t, ym, loc) || quittanceSeuleDuMois(t, ym, loc)) : null
    if (q) { q.elRetrait = { le, motif: 'manuel' }; if (G('_stamp')) W._stamp(q); if (G('saveDB')) W.saveDB() }
    toast('Document retiré.'); documents(bid, debut)
  }
  catch (e) { toast('Retrait impossible : droit insuffisant ou connexion perdue.', 'err', 5000) }
}

// ─────────────────────────── Messages (D13 : au nom du bailleur) ───────────────────────────
const brouillons = new Map()
function messages(accesId) {
  const x = etat.acces.find((a) => a.id === accesId); if (!x) return
  const liste = etat.msgs.get(accesId) || []
  const t = locationDe(x); const log = t ? logDe(t.ref) : null
  const bailleur = entNomDe(t && t.bail, log) || 'le bailleur'
  const bulle = (m) => `<div class="el-bub ${m.auteur === 'bailleur' ? 'me' : 'them'}"><div class="el-bub-t">${esc(m.corps)}</div>`
    + (m.pieces || []).map((p, k) => `<button type="button" class="btn bs bb el-att" onclick="EspaceLoc.ouvrirPiece('${m.id}',${k})">${ico('doc', 13)} ${esc(p.nom || 'Pièce jointe')}</button>`).join('')
    + `<div class="el-bub-m">${m.auteur === 'bailleur' ? 'Envoyé au nom de ' + esc(bailleur) : esc(x.locataire_nom)} · ${esc(fdh(m.cree_le))}</div></div>`
  const ph = EL.phaseAcces(x.fin_bail, x.comptes_clos_le, jour(new Date().toISOString()))
  const ouvert = EL.peut(ph, 'message') && !x.revoque_le
  const jointes = (brouillons.get(accesId) || {}).pieces || []
  couche('ov-el-msg', 'Messages · ' + x.locataire_nom,
    `<div class="el-fil">${liste.length ? liste.map(bulle).join('') : '<p class="logf-panel-empty">Aucun message.</p>'}</div>`
    + (ouvert ? `<p class="el-note">Le locataire voit le nom « ${esc(bailleur)} », jamais celui de la personne qui répond. Réponse visible à sa prochaine ouverture de l'espace.</p>
      <textarea class="inp" id="el-msg-txt" rows="4" maxlength="4000" placeholder="Écrire au locataire">${esc((brouillons.get(accesId) || {}).texte || '')}</textarea>
      <div id="el-msg-pj">${jointes.map((p) => `<span class="el-pj">${esc(p.nom)}</span>`).join('')}</div>` : '<p class="el-note">Les messages sont fermés pour cette location.</p>'),
    ouvert ? `<button class="btn bs" onclick="EspaceLoc.joindre('${accesId}')">${ico('doc', 14)} Joindre</button><button class="btn bp" onclick="EspaceLoc.repondre('${accesId}')">${ico('send', 14)} Envoyer dans l'espace</button>` : `<button class="btn bp" onclick="closeM('ov-el-msg')">Fermer</button>`)
  // Marquer lus (au nom de qui lit : colonne lu_bailleur_le, droit d'écriture de la SCI requis ; sinon silencieux).
  const aLire = liste.filter((m) => m.auteur === 'locataire' && !m.lu_bailleur_le)
  if (aLire.length) Promise.all(aLire.map((m) => API().update('locataire_messages', m.id, { lu_bailleur_le: new Date().toISOString() }).then(() => { m.lu_bailleur_le = new Date().toISOString() }).catch(() => {}))).then(majBloc)
}
function cheminPieceProprio(x, ext) {
  const seg = x.entite_id || '_orphelin'
  const uuid = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : null
  return uuid ? `${x.espace_id}/${seg}/files/el-${x.id}-${uuid}.${ext}` : null
}
function joindre(accesId) {
  const x = etat.acces.find((a) => a.id === accesId); if (!x) return
  const b = brouillons.get(accesId) || { texte: '', pieces: [] }
  const ta = document.getElementById('el-msg-txt'); if (ta) b.texte = ta.value
  brouillons.set(accesId, b)
  if ((b.pieces || []).length >= 4) { toast('4 pièces jointes au plus.', 'warn'); return }
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/jpeg,image/png,application/pdf'
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return
    if (f.size > EL.DEPOT_MAX_OCTETS) { toast('Fichier trop lourd : 10 Mo au plus.', 'warn'); return }
    const ext = EL.typeReel(new Uint8Array(await f.slice(0, 16).arrayBuffer()))
    if (!ext) { toast('Format non accepté : photo (JPEG, PNG) ou PDF.', 'warn'); return }
    const path = cheminPieceProprio(x, ext); if (!path) return
    try { await API().upload(path, f, EL.MIME_DE[ext]); b.pieces.push({ path, nom: f.name.slice(0, 120), mime: EL.MIME_DE[ext], taille: f.size }); messages(accesId) }
    catch (e) { toast('Pièce non envoyée : droit insuffisant ou connexion perdue.', 'err', 5000) }
  }
  inp.click()
}
async function repondre(accesId, texteImpose, signalementId) {
  const x = etat.acces.find((a) => a.id === accesId); if (!x) return
  const b = brouillons.get(accesId) || { texte: '', pieces: [] }
  const ta = document.getElementById('el-msg-txt')
  const corps = texteImpose != null ? texteImpose : (ta ? ta.value : b.texte)
  const err = EL.erreurMessage(corps, b.pieces)
  if (err) { toast(err, 'warn'); return false }
  try {
    const row = { acces_id: accesId, auteur: 'bailleur', corps: String(corps).trim(), pieces: texteImpose != null ? [] : b.pieces }
    if (signalementId) row.signalement_id = signalementId
    const m = await API().insert('locataire_messages', row)
    if (!etat.msgs.has(accesId)) etat.msgs.set(accesId, [])
    etat.msgs.get(accesId).push(m)
    if (texteImpose == null) brouillons.delete(accesId)
    toast('Message déposé dans l\'espace locataire.')
    notifier('message', accesId, {})
    if (texteImpose == null) messages(accesId)
    majBloc()
    return true
  } catch (e) { toast('Message non envoyé : droit insuffisant ou connexion perdue.', 'err', 5000); return false }
}
async function ouvrirPiece(messageId, index) {
  for (const l of etat.msgs.values()) {
    const m = l.find((y) => y.id === messageId); if (!m) continue
    const p = (m.pieces || [])[index]; if (!p || !p.path) return
    const url = G('__immoCloudFileUrl') ? await W.__immoCloudFileUrl(p.path, 300) : null
    if (url) W.open(url, '_blank', 'noopener'); else toast('Pièce indisponible.', 'err')
    return
  }
}

// Incident → message au locataire (règle du chantier Travaux : le texte part seulement par geste explicite, après
// relecture). Appelé depuis la vue « Message au locataire » de l'incident.
const ouvertAuxMessages = (x) => x && !x.revoque_le && EL.peut(EL.phaseAcces(x.fin_bail, x.comptes_clos_le, aujourdhui()), 'message')
function accesPourIncident(inc) {
  if (!inc) return null
  if (inc.espaceAccesId) { const a = etat.acces.find((x) => x.id === inc.espaceAccesId && ouvertAuxMessages(x)); if (a) return a }
  const D = db() || {}; const bail = inc.logRef && D.baux && D.baux[inc.logRef]
  if (!bail) return null
  const bid = bailId(inc.logRef, bail)
  return accesDe(bid, jour(bail.debut) || null).filter(ouvertAuxMessages).sort((a, b) => a.locataire_rang - b.locataire_rang)[0] || null
}
function disponiblePourIncident(inc) { return !!accesPourIncident(inc) }
async function envoyerTexteIncident(incId) {
  const inc = ((db() || {}).incidents || []).find((i) => vivant(i) && String(i.id) === String(incId)); if (!inc) return
  const a = accesPourIncident(inc); if (!a) { toast('Aucun espace locataire actif pour ce bail.', 'warn'); return }
  const ta = document.getElementById('inc-msg'); const t = ta ? ta.value : ''
  const corps = String(t).split('\n').filter((l, i) => !(i === 0 && /^Objet\s*:/.test(l))).join('\n').trim()
  const ok = G('confirm2') ? W.confirm2('Déposer ce message dans l\'espace locataire de ' + a.locataire_nom + ' ?\n\nLe texte part tel qu\'il est affiché.') : true
  if (!ok) return
  await repondre(a.id, corps, (inc.espaceAccesId === a.id && inc.espaceSignalementId) || null)
}

// ─────────────────────────── Publication automatique (D6, D8) ───────────────────────────
let _pubTimer = null
function publierBientot() { clearTimeout(_pubTimer); _pubTimer = setTimeout(() => cycle(true), 4000) }
// Appelé par saveDB (mode cloud) après CHAQUE enregistrement : un passage n'est relancé que si ce qui fait le verdict
// « payé en entier » a changé (mouvements, journal du bail — manques acceptés —, baux, barème, registre des quittances).
// L'autosave d'un EDL ou un réglage ne relance rien. Une écriture faite PENDANT un passage (le sien compris) en vaut un
// de plus, après : il ne trouve plus rien à faire et n'écrit plus — la relance s'arrête là.
let _sigArgent = null
function signatureArgent() {
  const D = db() || {}
  const part = (l) => { let m = ''; for (const x of (Array.isArray(l) ? l : [])) { const s = x && x._modifiedAt; if (s && String(s) > m) m = String(s) } return (Array.isArray(l) ? l.length : 0) + '@' + m }
  return part(D.mouvements) + '|' + part(D.baux_evenements) + '|' + part(D.quittances) + '|' + part(Object.values(D.baux || {}))
    + '|' + part(D.baux_historique) + '|' + part(D.loyerBareme)
}
let _aRelancer = false
function apresEnregistrement() {
  if (!_demarre) return
  const s = signatureArgent()
  if (s === _sigArgent) return
  if (_cycle) { _aRelancer = true; return }   // paiement enregistré PENDANT un passage : un passage de plus, après
  _sigArgent = s
  publierBientot()
}
const sur = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60)
async function sha256Hex(blob) {
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function cheminComplet(cloudKey, entNom) {
  const k = String(cloudKey || ''); if (!k) return null
  if (k.indexOf('/files/') !== -1) return k
  const seg = G('_cloudEntiteSeg') ? W._cloudEntiteSeg(entNom) : '_orphelin'
  const esp = API().espaceDeSeg(seg) || API().espacePropre()
  return esp ? esp + '/files/' + k : null   // clé nue LEGACY : <espace>/files/<clé> (même relecture que __immoCloudFileUrl)
}
async function base64EnBlob(r) {
  const bin = atob(r.base64); const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: 'application/pdf' })
}
async function televerserGenere(blob, t, cle) {
  const entNom = entNomDe(t.bail, logDe(t.ref))
  const seg = G('_cloudEntiteSeg') ? W._cloudEntiteSeg(entNom) : '_orphelin'
  const esp = API().espaceDeSeg(seg) || API().espacePropre()
  const h = await sha256Hex(blob)
  const path = `${esp}/${seg}/files/el_${sur(t.ref)}_${sur(cle)}_${h.slice(0, 12)}.pdf`
  await API().upload(path, blob, 'application/pdf')
  return { storage_path: path, sha256: h, taille: blob.size }
}

// Documents SOUHAITÉS pour une location. Les fichiers déjà archivés sont référencés ; les autres seront générés.
// `etatL` : verdict du moteur pour le lot (etatLot). Une quittance n'est souhaitée que si son mois n'est PAS « non soldé »
// (art. 21 : jamais de quittance pour un mois non payé en entier, même émise à la main « sans paiement constaté ») ;
// moteur absent → aucune quittance publiée (rien ne peut être vérifié).
function souhaites(t, emisLe, etatL) {
  const D = db() || {}, out = []
  const log = logDe(t.ref), entNom = entNomDe(t.bail, log)
  const fin = (finOcc(t.bail, t.archive) || '').slice(0, 10) || null
  const sig = t.bail.signatures || {}
  if (sig.signedAt && sig.cloudPdfKey) out.push({ cle: 'bail:signe', type_doc: 'bail', titre: 'Bail signé', date_doc: jour(sig.signedAt), storage_path: cheminComplet(sig.cloudPdfKey, entNom) })
  for (const av of D.baux_evenements || []) {
    if (!vivant(av) || av.type !== 'avenant' || av.statut !== 'signe') continue
    if (String(av.ref || '').split('@@')[0] !== t.ref || (jour(av.bailDebut) || null) !== t.debut) continue
    const doc = (D.documents || []).find((d) => vivant(d) && (d.id === av.pdfDocId || d.id === av.scanDocId) && d.cloudKey)
    const p = doc ? doc.cloudKey : (typeof av.pdfKey === 'string' ? av.pdfKey : null)
    if (p) out.push({ cle: EL.cleDocument('avenant', av.id), type_doc: 'avenant', titre: 'Avenant n° ' + (av.no || ''), date_doc: jour(av.signeLe || av.date), storage_path: cheminComplet(p, entNom) })
  }
  const loc = { debut: t.debut, fin, noms: locatairesDuBail(t.bail, log).map((l) => l.nom) }
  for (const edl of D.edl || []) {
    if (!vivant(edl) || edl.logement !== t.ref || !(edl.signatures && edl.signatures.signedAt)) continue
    if (!EL.edlDeLaLocation(edl, loc)) continue   // identité + bornes : jamais l'EDL d'un autre locataire
    const sortie = /sortie/i.test(edl.type || '')
    out.push({ cle: EL.cleDocument('edl', edl.id), type_doc: 'edl', titre: sortie ? 'État des lieux de sortie' : 'État des lieux d\'entrée', date_doc: jour(edl.date),
      generer: async () => (G('generateEDLPdfNative') ? W.generateEDLPdfNative(edl) : null) })
  }
  if (etatL) {   // quittances : location EN COURS (le rendu relit le bail courant, F11) ; archivée : dépôt automatique seulement
    for (const q of D.quittances || []) {
      if (!vivant(q) || q.logement !== t.ref) continue
      if (t.archive && q.origine !== 'espace-locataire') continue
      const mk = ymDeQuittance(q); if (!mk) continue
      if (!EL.quittanceDeLaLocation(q, loc)) continue   // identité + mois : jamais la quittance d'un autre locataire
      const v = QA.verdict(etatL, mk, q)
      if (v === 'non_solde') continue   // mois pas (ou plus) payé en entier : jamais dans l'espace
      // Mois hors du suivi (verdict inconnu) : une quittance émise « sans paiement constaté » (trace V9) n'est pas publiée.
      const trace = ((D.params || {}).quittancesMeta || {})[t.ref + '|' + mk]
      if (v !== 'solde' && trace && (trace.forceeLe || trace.forceePar)) continue
      const reedition = emisLe && q.date && jour(q.date) < jour(emisLe)
      out.push({ cle: EL.cleDocument('quittance', mk), type_doc: 'quittance', titre: EL.titreQuittance(q.mois) + (reedition ? ' (réédition du ' + fdate(new Date().toISOString()) + ')' : ''),
        periode: q.mois, date_doc: jour(q.date) || null,
        generer: async () => {
          // Rendu NATIF seulement, appelé directement (le repli texte de secours ne doit jamais être figé comme définitif).
          if (!G('_buildQuittanceHtml') || !G('_docHtmlToNativeBlob') || !W.DocNative) return null
          const ent = (D.entites || []).find((e) => e.nom === (q.entity || entNom)) || {}
          try { const built = W._buildQuittanceHtml({ ...q, total: (q.hc || 0) + (q.ch || 0) }, log || { ref: t.ref }, ent, t.bail); return built && built.html ? await W._docHtmlToNativeBlob(built.html, ent) : null }
          catch (e) { return null }
        } })
    }
  }
  // Décomptes validés + justificatifs (art. 23 : 6 mois après l'envoi)
  // ALERTE-REGUL (14/10) : la validation est portée par le LOGEMENT (partagée par la SCI, js/core/regul-validation.js),
  // plus par la configuration de l'espace propre. Périmètre inchangé : un logement rattaché à un immeuble.
  // UN SEUL PUBLIEUR, le poste du PROPRIÉTAIRE de l'espace du logement (audit 15/10) : le décompte est calculé
  // avec la configuration de l'espace propre (catégories, relevés de compteurs) — celle d'un associé peut
  // différer, et le premier document publié l'emporte. Un associé valide ; le décompte part du poste du propriétaire.
  const espOpts = G('_optsEspacePropre') ? W._optsEspacePropre() : {}
  for (const p of (log && log.imm && estDeLEspacePropre(log, espOpts) ? validationsDuLogement(log) : [])) {
    const from = p.du, to = p.au, v = { at: p.at }; if (!v.at) continue
    if (typeof W.computeRegul !== 'function') break
    let res = null; try { res = W.computeRegul(from, to) } catch (e) { res = null }
    const entries = (res && res.entries) || {}
    for (const [entryKey, e] of Object.entries(entries)) {
      if (!e || e.ref !== t.ref || (jour(e.bail && e.bail.debut) || null) !== t.debut) continue
      const annee = from.slice(0, 4), cle = EL.cleDocument('decompte', from + '_' + to)
      out.push({ cle, type_doc: 'decompte', titre: 'Décompte de régularisation des charges ' + annee, periode: fdate(from) + ' au ' + fdate(to), date_doc: jour(v.at),
        generer: async () => {
          if (!G('_buildDecompteHtml') || !G('_docHtmlToNativeBlob') || !W.DocNative) return null
          const ent = (D.entites || []).find((x) => x.nom === entNom) || {}
          try { const built = W._buildDecompteHtml(entryKey, from, to); return built && !built.error && built.html ? await W._docHtmlToNativeBlob(built.html, ent) : null }
          catch (e2) { return null }
        } })
      const vu = new Set()
      for (const ligne of e.details || []) {
        if (!ligne || ligne.mvId == null || vu.has(ligne.mvId)) continue
        vu.add(ligne.mvId)
        const m = (D.mouvements || []).find((x) => vivant(x) && x.id === ligne.mvId)
        const doc = m && G('_mvPjResolve') ? W._mvPjResolve(m) : null
        if (!doc || doc._legacy || !doc.cloudKey) continue
        out.push({ cle: EL.cleDocument('justif', from + '_' + ligne.mvId), type_doc: 'justificatif', titre: 'Justificatif : ' + (m.lib || doc.name || 'facture'), date_doc: jour(m.date),
          storage_path: cheminComplet(doc.cloudKey, entNom), parentCle: cle, visible_jusqu_au: EL.visibleJusquauJustificatifs(jour(v.at)),
          mime: /^image\/(jpeg|png)$/.test(doc.mime || '') ? doc.mime : 'application/pdf' })
      }
    }
  }
  return out.filter((d) => d.cle)
}

const MAX_GENERES_PAR_CYCLE = 12   // les PDF à générer sont étalés sur plusieurs passages (long bail repris)
async function peutPublier(bid) {
  if (!etat.droits) etat.droits = new Map()
  if (etat.droits.has(bid)) return etat.droits.get(bid)
  try { const ok = (await API().rpc('el_peut_publier', { p_bail_id: bid })) === true; etat.droits.set(bid, ok); return ok }
  catch (e) { return false }   // erreur passagère : pas mémorisée, nouvel essai au prochain passage
}
// Identité d'une location pour rattacher une quittance du registre (mêmes champs que souhaites()).
function locInfo(t) {
  const fin = (finOcc(t.bail, t.archive) || '').slice(0, 10) || null
  return { debut: t.debut, fin, noms: locatairesDuBail(t.bail, logDe(t.ref)).map((l) => l.nom) }
}

// ─────────────────────────── Quittance déposée automatiquement (GO 19/10) ───────────────────────────
// Cohérence d'une location : retrait (mois plus payé en entier), republication (mois de nouveau soldé, retrait fait PAR
// CETTE RÈGLE — marque `elRetrait` au registre), effacement d'une marque devenue sans objet. Le registre n'est jamais
// effacé : la quittance y reste, avec sa mention. Un retrait fait à la main (D6) n'est jamais annulé.
// Tourne sur le SEUL poste publieur (propriétaire de l'espace, en ligne) : un poste aux données en retard ou un associé
// au paramétrage différent obtiendrait un autre verdict (relecture adverse 19/10). La marque est posée et ENREGISTRÉE
// avant le retrait au cloud : si le retrait échoue, le passage suivant le refait (marque + document visible + non soldé)
// ou efface la marque (mois soldé) — jamais un retrait sans marque, que D6 prendrait pour un retrait à la main.
async function coherenceQuittances(t, publies, voulus, etatL) {
  const loc = locInfo(t)
  // Quittance du registre : par identité (noms), sinon — nom du locataire corrigé depuis — l'UNIQUE quittance vivante du
  // logement pour ce mois, quand la location couvre le mois en entier (aucun autre locataire possible ; relecture Fable 19/10).
  const qDe = (ym) => quittanceDuRegistre(t, ym, loc) || quittanceSeuleDuMois(t, ym, loc)
  // Remise comparée à celle FIGÉE au registre — sauf pour une quittance du dépôt automatique déjà retirée : sa remise est
  // re-figée à la republication (sinon elle ne pourrait jamais revenir).
  const plan = QA.planCoherence(publies, (ym, row) => { const q = qDe(ym); return QA.verdict(etatL, ym, (row && row.retire_le && q && q.origine === 'espace-locataire') ? null : q) }, qDe)
  let modifie = false, republiees = 0, generes = 0
  const marquer = (ym, val) => {
    const q = qDe(ym); if (!q) return false
    if (val) q.elRetrait = val; else delete q.elRetrait
    if (G('_stamp')) W._stamp(q)
    modifie = true
    return true
  }
  for (const { row, ym } of plan.retirer) {
    const q = qDe(ym); if (!q) continue   // registre pas (encore) chargé sur ce poste : ne rien retirer à l'aveugle
    const avant = QA.motifRetrait(q) === 'non_solde' ? q.elRetrait : null
    const le = (avant && avant.le) || new Date().toISOString()
    if (!avant) {
      const ancienne = q.elRetrait
      marquer(ym, { le, motif: 'non_solde' })
      if (enregistrer() === false) { if (ancienne) q.elRetrait = ancienne; else delete q.elRetrait; continue }
    }
    try {
      const res = await API().update('locataire_documents', row.id, { retire_le: le })
      if (!res || !res.length) continue   // refusé (0 ligne) : la marque reste, nouvel essai au prochain passage
      row.retire_le = le
      if (G('_auditLog')) W._auditLog('update', 'quittance', q.id, 'retirée de l\'espace locataire : ' + ym + ' plus payé en entier')
    } catch (e) { /* réseau : nouvel essai au prochain passage */ }
  }
  for (const { row, ym } of plan.republier) {
    const d = voulus.find((x) => x.cle === row.cle)
    if (!d || !d.generer || generes >= MAX_GENERES_PAR_CYCLE || etat.echecs.has(t.id + '|' + d.cle)) continue
    generes++
    try {
      // Quittance du dépôt automatique : la remise du mois est RE-FIGÉE depuis le moteur avant de refaire le PDF (elle a
      // pu diminuer depuis l'émission — le document dirait alors une somme reçue trop faible).
      const qR = qDe(ym)
      if (qR && qR.origine === 'espace-locataire') {
        const e = etatL.byYm && etatL.byYm[ym]
        const rem = e && e.remise > 0.005 ? Math.round(e.remise * 100) / 100 : 0
        if (rem > 0) { qR.remise = rem; const mo = (e.remiseMotifs || []).join(' ; ').slice(0, 200); if (mo) qR.remiseMotif = mo; else delete qR.remiseMotif }
        else { delete qR.remise; delete qR.remiseMotif }
        if (G('_stamp')) W._stamp(qR)
        modifie = true
      }
      const blob = await d.generer()   // nouveau PDF : la date du paiement qui solde le mois a pu changer
      if (!blob) { etat.echecs.add(t.id + '|' + d.cle); continue }
      const f = await televerserGenere(blob, t, d.cle)
      const res = await API().update('locataire_documents', row.id, { storage_path: f.storage_path, sha256: f.sha256, taille: f.taille, retire_le: null })
      if (!res || !res.length) { etat.echecs.add(t.id + '|' + d.cle); continue }   // refusé : pas de PDF re-téléversé à chaque passage
      row.retire_le = null; row.storage_path = f.storage_path; row.sha256 = f.sha256; row.taille = f.taille
      marquer(ym, null)
      republiees++
    } catch (e) { etat.echecs.add(t.id + '|' + d.cle) }
  }
  for (const { ym } of plan.effacerMarque) marquer(ym, null)
  if (modifie) enregistrer()
  return { republiees, generes }
}
// Écritures du passage automatique : hors de la pile « Annuler » (autosave) — sinon « Annuler » après un import retirait
// la quittance créée (recréée 4 s plus tard) au lieu de l'import (relecture adverse 19/10).
const enregistrer = () => (G('saveDB') ? W.saveDB({ autosave: true, quoi: 'quittance-auto' }) : false)

// Création au REGISTRE, par la fabrique unique (_creerQuittance, qui revérifie peutQuittancer), des quittances des mois
// payés en entier depuis l'activation (D2), pour les locations en cours ayant un lien actif. Poste du propriétaire de
// l'espace seulement ; jamais hors ligne ni en lecture seule ; rien n'est gardé si l'enregistrement échoue.
const MAX_AUTO_PAR_CYCLE = 24
function deposerQuittancesAuto(locs) {
  const D = db(); if (!D || !G('_creerQuittance') || lectureSeule() || horsLigne()) return 0
  // Location archivée encore ouverte (phase départ) comprise : le dernier loyer payé après le départ donne sa quittance
  // (art. 21) — seulement pour un mois couvert EN ENTIER (sortie le dernier jour du mois), comme pour tout mois automatique.
  const eligibles = locs.filter(({ t }) => logDe(t.ref) && deLEspacePropre(logDe(t.ref)))
  if (!eligibles.length) return 0
  const avantParams = D.params ? D.params.elQuittancesAuto : undefined
  const init = QA.initialiser(D.params || {}, jourLocal())   // D1 : activé par défaut — date d'activation posée une fois
  if (init) { if (!D.params) D.params = {}; D.params.elQuittancesAuto = init }
  const crees = []
  for (const { t } of eligibles) {
    const rg = QA.reglage(D.params, t.ref, t.debut); if (!rg.actif || !rg.depuis) continue
    const etatL = etatLot(t.ref); if (!etatL) continue
    const loc = locInfo(t)
    const deja = (D.quittances || []).filter((q) => vivant(q) && q.logement === t.ref).map(ymDeQuittance).filter(Boolean)
    for (const ym of QA.moisADeposer(etatL, { depuis: rg.depuis, deja, debut: t.debut, fin: loc.fin })) {
      if (crees.length >= MAX_AUTO_PAR_CYCLE) break
      const r = W._creerQuittance(t.ref, ym)
      if (!r || !r.ok || r.existante || !r.quittance) continue
      // La fabrique nomme le locataire du bail COURANT : pour une location archivée, ce sont les locataires de CETTE
      // location (le mois est couvert en entier par elle seule).
      if (t.archive) {
        r.quittance.locataire = loc.noms.filter(Boolean).join(', ')
        if (t.bail && t.bail.entity) r.quittance.entity = t.bail.entity
      }
      if (!EL.quittanceDeLaLocation(r.quittance, loc)) {   // garde-fou : jamais une quittance au nom d'un autre locataire
        D.quittances = (D.quittances || []).filter((x) => x !== r.quittance)
        continue
      }
      r.quittance.origine = 'espace-locataire'
      if (G('_stamp')) W._stamp(r.quittance)
      crees.push(r.quittance)
    }
  }
  if (!crees.length && !init) return 0
  const ok = enregistrer()
  if (ok === false) {   // pas de destination durable : aucune quittance ne reste en mémoire seule
    D.quittances = (D.quittances || []).filter((q) => !crees.includes(q))
    if (init) { if (avantParams === undefined) delete D.params.elQuittancesAuto; else D.params.elQuittancesAuto = avantParams }
    return 0
  }
  if (crees.length) {
    toast(crees.length === 1 ? 'Quittance ' + EL.elide(crees[0].mois, 'de') + ' créée : mois payé en entier, déposée dans l\'espace locataire.'
      : crees.length + ' quittances créées (mois payés en entier), déposées dans l\'espace locataire.', 'info', 6000)
    if (G('_refreshAfterMutation')) W._refreshAfterMutation()
  }
  return crees.length
}

async function publierLocation(t, accesLoc) {
  if (!(await peutPublier(t.id))) return 0   // associé en lecture seule : rien n'est généré
  const espaceId = accesLoc[0].espace_id
  const emisLe = accesLoc.map((a) => a.emis_le).sort()[0]
  // Verdict du moteur, AUSSI pour une location archivée dont l'accès reste ouvert (phases départ / documents) : un
  // paiement reclassé après le départ doit retirer la quittance (souhaites ne publie de quittance que pour la location en cours).
  const etatL = etatLot(t.ref)
  const voulus = souhaites(t, emisLe, etatL)
  const publies = (await chargerDocs(t.id)).filter((d) => (d.bail_debut || null) === t.debut)
  const parCle = new Map(publies.map((d) => [d.cle, d]))
  let n = 0, generes = 0
  // Cohérence avec le moteur AVANT toute publication : retrait d'une quittance dont le mois n'est plus payé en entier,
  // republication de celle que cette règle avait retirée quand le mois redevient soldé.
  if (etatL && !horsLigne() && logDe(t.ref) && deLEspacePropre(logDe(t.ref))) {
    const r = await coherenceQuittances(t, publies, voulus, etatL)
    n += r.republiees; generes += r.generes
  }
  if (!voulus.length) { if (n) chargerDocs(t.id); return n }
  const plan = EL.planPublication(voulus.filter((d) => d.storage_path), publies)
  for (const u of plan.maj) { try { await API().update('locataire_documents', u.id, u.patch) } catch (e) { /* retenté au prochain cycle */ } }
  // Parents (décomptes) avant les justificatifs.
  const ordre = voulus.filter((d) => !parCle.has(d.cle) && !etat.echecs.has(t.id + '|' + d.cle)).sort((a, b) => (a.parentCle ? 1 : 0) - (b.parentCle ? 1 : 0))
  for (const d of ordre) {
    try {
      let fichier = d.storage_path ? { storage_path: d.storage_path } : null
      if (!fichier && d.generer) {
        if (generes >= MAX_GENERES_PAR_CYCLE) continue
        generes++
        const blob = await d.generer()
        if (!blob) { etat.echecs.add(t.id + '|' + d.cle); continue }   // rendu impossible : pas de nouvel essai pendant la session
        fichier = await televerserGenere(blob, t, d.cle)
      }
      if (!fichier || !fichier.storage_path) continue
      const parent = d.parentCle ? parCle.get(d.parentCle) : null
      if (d.parentCle && !parent) continue
      const row = await API().insert('locataire_documents', {
        espace_id: espaceId, bail_id: t.id, bail_debut: t.debut, cle: d.cle, type_doc: d.type_doc, titre: d.titre.slice(0, 200),
        periode: d.periode || null, date_doc: d.date_doc || null, storage_path: fichier.storage_path, mime: d.mime || 'application/pdf',
        taille: fichier.taille || null, sha256: fichier.sha256 || null, parent_id: parent ? parent.id : null, visible_jusqu_au: d.visible_jusqu_au || null,
      })
      parCle.set(d.cle, row); n++
      await avisDocument(row, accesLoc)
    } catch (e) {
      // Échec (droit d'écriture absent, fichier refusé…) : pas de nouvel essai pendant la session — rien n'est régénéré en boucle.
      etat.echecs.add(t.id + '|' + d.cle)
      if (e && e.code !== '23505') console.warn('[espace-locataire] publication', d.cle, e && e.message)
    }
  }
  if (n) chargerDocs(t.id)
  return n
}
async function avisDocument(row, accesLoc) {
  const r = await etatRelais(); if (!r.emails) return
  for (const a of accesLoc) {
    if (a.revoque_le) continue
    if (row.type_doc === 'quittance' && !(a.accord_quittance_le && !a.accord_retire_le)) continue   // quittance par e-mail : seulement avec l'accord (art. 21)
    await notifier('document', a.id, { titre: row.titre })
  }
}
// E-mail par le relais : le destinataire et le nom du bailleur sont lus EN BASE par le relais (el_acces_contact),
// jamais envoyés d'ici ; l'invitation transmet le seul jeton (le relais reconstruit le lien sur son origine).
async function notifier(type, accesId, data) {
  try {
    const r0 = await etatRelais(); if (!r0.emails) return false
    const cfg = G('_relayCfg') ? W._relayCfg() : null; if (!cfg) return false
    const jwt = await cfg.getToken(); if (!jwt) return false
    const r = await fetch(cfg.base + '/el/notifier', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, acces_id: accesId, ...(data || {}) }) })
    return r.ok && (await r.json()).envoye === true
  } catch (e) { return false }
}

// ─────────────────────────── Import des signalements (D11) ───────────────────────────
// Réservations faites par CET appareil et pas encore enregistrées localement (onglet fermé entre les deux) : seules
// celles-ci sont reprises — un incident supprimé ensuite par le propriétaire n'est jamais recréé.
// Clé de stockage local 'imsb-el-imports-en-cours' (espace de test séparé par _lsKey en ?sandbox=1).
const importsEnCours = () => { try { const v = JSON.parse(localStorage.getItem(_lsKey('imsb-el-imports-en-cours')) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(-200) : [] } catch (e) { return [] } }
const ecrireImports = (l) => { try { localStorage.setItem(_lsKey('imsb-el-imports-en-cours'), JSON.stringify(l.slice(-200))) } catch (e) { /* stockage indisponible : rien à reprendre */ } }

// L'accueil (bulle « Incidents à traiter ») est rendu au chargement, AVANT cet import asynchrone : sans nouveau rendu, la
// bulle n'apparaissait qu'au changement d'onglet. _refreshAfterMutation ne connaît pas l'accueil (volontairement : il ne
// doit pas redessiner l'accueil après chaque mutation) ; ce rendu-ci est limité au cas « l'import a ajouté des incidents ».
// Réutilise _rPeriodPage (DRY : « rAccueil si on est sur l'accueil »). Sur téléphone, si la liste « À regarder » est ouverte,
// c'est elle qui est rafraîchie (rAccueil la remplacerait par l'accueil et ferait perdre la position).
function rafraichirAccueil() {
  try {
    if (document.querySelector('#accm-phone .atr') && G('_accmShowAregarder')) {
      let page = ''
      try { page = currentPage } catch (e) { return }   // eslint-disable-line no-undef
      if (page === 'accueil') W._accmShowAregarder()
      return
    }
    if (G('_rPeriodPage')) W._rPeriodPage()
  } catch (e) { console.warn('[espace-locataire] accueil', e && e.message) }
}

async function importerSignalements() {
  const D = db(); if (!D || !W.Incidents || typeof W.Incidents.nouvelIncident !== 'function') return 0
  if (!etat.acces.length) return 0
  let liste = []
  try { liste = await API().select('locataire_signalements', { importe_le: null }) } catch (e) { return 0 }
  const enCours = importsEnCours()
  if (enCours.length) { try { liste = liste.concat(await API().select('locataire_signalements', { id: enCours })) } catch (e) { /* reprise au prochain passage */ } }
  if (!D.incidents) D.incidents = []
  let n = 0
  const aEnregistrer = [], crees = []
  for (const s of liste) {
    const x = etat.acces.find((a) => a.id === s.acces_id); const t = x ? locationDe(x) : null
    if (!t) continue
    const legacy = EL.idIncidentDuSignalement(s.id); if (!legacy) continue
    if (D.incidents.some((i) => String(i.id) === legacy)) { if (enCours.includes(s.id)) aEnregistrer.push(s.id); continue }
    if (!s.importe_le) {
      // Réservation CONDITIONNELLE (importe_le encore vide) et droit d'écriture exigés : un associé en lecture seule
      // n'importe rien, deux membres n'importent pas deux fois.
      ecrireImports(importsEnCours().concat(s.id))
      let reserve = []
      try { reserve = await API().update('locataire_signalements', s.id, { incident_legacy_id: legacy, importe_le: new Date().toISOString() }, { importe_le: null }) } catch (e) { reserve = [] }
      if (!reserve.length) { ecrireImports(importsEnCours().filter((id) => id !== s.id)); continue }
    } else if (!enCours.includes(s.id)) continue
    const log = logDe(t.ref)
    const inc = W.Incidents.nouvelIncident(EL.champsIncident(s, { logRef: t.ref, imm: (log && log.imm) || '', entity: entNomDe(t.bail, log) || '', nom: x.locataire_nom }), new Date().toISOString())
    inc.espaceSignalementId = s.id; inc.espaceAccesId = s.acces_id; inc.vu = false
    if (G('_stamp')) W._stamp(inc)
    D.incidents.push(inc)
    if (!D.documents) D.documents = []
    ;(s.photos || []).forEach((p, k) => {
      if (!p || !p.path) return
      const docId = Number(legacy) + 1 + k   // déterministe : pas de pièce en double si deux membres importent
      if (D.documents.some((d) => d && d.id === docId)) return
      const doc = { id: docId, parentType: 'incident', parentId: inc.id, parentRef: String(inc.id), logRef: t.ref,
        category: 'incident', idbKey: null, cloudKey: p.path, name: p.nom || 'photo.jpg', originalName: p.nom || 'photo.jpg', mime: p.mime || 'image/jpeg', size: Number(p.taille) || 0,
        sha256: p.sha256 || null, uploadedAt: s.cree_le, source: 'espace-locataire' }
      if (G('_stamp')) W._stamp(doc)
      D.documents.push(doc)
    })
    if (G('_auditLog')) W._auditLog('create', 'incident', inc.id, 'signalé depuis l\'espace locataire')
    crees.push(inc)
    aEnregistrer.push(s.id)
    n++
  }
  if (n && G('saveDB')) W.saveDB()
  if (aEnregistrer.length) ecrireImports(importsEnCours().filter((id) => !aEnregistrer.includes(id)))
  if (n) {
    if (G('_refreshAfterMutation')) W._refreshAfterMutation()
    rafraichirAccueil()
    toast(n === 1 ? 'Nouveau signalement reçu depuis l\'espace locataire (registre des incidents).' : n + ' nouveaux signalements reçus depuis l\'espace locataire.', 'info', 6000)
    // Circuit d'un incident (0060) : l'artisan du carnet qui couvre le métier est prévenu (D6).
    if (W.IncCircuit && typeof W.IncCircuit.apresImport === 'function') for (const inc of crees) W.IncCircuit.apresImport(inc)
  }
  return n
}

// ─────────────────────────── Fins de bail → accès (D4) ───────────────────────────
async function reporterFins() {
  const maj = EL.majFinsAcces(etat.acces, (a) => locationDe(a), finOcc, G('_dgVerseMontant'))   // LA définition du dépôt versé (case B4)
  for (const u of maj) { try { await API().update('locataire_acces', u.id, u.patch); Object.assign(etat.acces.find((a) => a.id === u.id) || {}, u.patch) } catch (e) { /* droit insuffisant : un autre membre le fera */ } }
  return maj.length
}

// ─────────────────────────── Cycle ───────────────────────────
async function rafraichir() { etat.enCours = true; try { await chargerAcces() } finally { etat.enCours = false } }
let _cycle = null
async function cycle(force) {
  if (_cycle) return _cycle
  if (!force && Date.now() - etat.dernier < 60_000) return
  _cycle = (async () => {
    try {
      await rafraichir()
      if (!etat.acces.length) return
      await reporterFins()
      await importerSignalements()
      const parLoc = new Map()
      for (const a of etat.acces) { if (a.revoque_le) continue; const k = a.bail_id + '|' + (a.bail_debut || ''); if (!parLoc.has(k)) parLoc.set(k, []); parLoc.get(k).push(a) }
      const locs = []
      for (const accesLoc of parLoc.values()) {
        const t = locationDe(accesLoc[0]); if (!t) continue
        if (EL.phaseAcces(accesLoc[0].fin_bail, accesLoc[0].comptes_clos_le, jour(new Date().toISOString())) === 'fini') continue
        locs.push({ t, accesLoc })
      }
      deposerQuittancesAuto(locs)   // registre d'abord : les quittances créées sont publiées dans ce même passage
      for (const { t, accesLoc } of locs) await publierLocation(t, accesLoc)
      const nl = [...etat.msgs.values()].flat().filter((m) => m.auteur === 'locataire' && !m.lu_bailleur_le).length
      if (nl && !etat.avisMsg) { etat.avisMsg = true; toast(nl === 1 ? '1 message de locataire non lu (fiche du logement, Espace locataire).' : nl + ' messages de locataires non lus (fiche du logement, Espace locataire).', 'info', 6000) }
      majBloc()
    } catch (e) { console.warn('[espace-locataire] cycle', e && e.message) } finally {
      etat.dernier = Date.now()
      _sigArgent = signatureArgent()
      if (_aRelancer) { _aRelancer = false; publierBientot() }
    }
  })()
  try { await _cycle } finally { _cycle = null }
}

let _demarre = false
export function demarrer() {
  if (!API() || !API().pret()) return
  if (_demarre) { cycle(true); return }
  _demarre = true
  W._elBlocHtml = blocHtml
  W.EspaceLoc = { creer, renouveler, revoquer, documents, retirer, messages, joindre, repondre: (id) => repondre(id), ouvrirPiece,
    disponiblePourIncident, envoyerTexteIncident,
    // Liens actifs rattachés à la ligne cloud ACTUELLE du bail (re-datation / retrait de « signé hors Propryo » → nouvelle ligne).
    // PREMIERS-PAS (étape « Ouvrir l'espace du locataire ») : accès émis dans l'espace PROPRE, révoqués compris
    // (l'étape est faite dès le premier lien) ; null tant que les accès ne sont pas chargés.
    nbAccesEmis: () => { if (!etat.charge) return null; const p = API() && API().espacePropre ? API().espacePropre() : null; return etat.acces.filter((x) => !p || !x.espace_id || x.espace_id === p).length },
    accesActifsDuBail: (ref) => { const b = ((db() || {}).baux || {})[ref]; if (!b || !vivant(b)) return 0; return accesDe(bailId(ref, b), jour(b.debut) || null).filter((x) => !x.revoque_le).length },
    publierMaintenant: async () => { toast('Publication en cours…', 'info'); await cycle(true); toast('Documents à jour.') },
    // QUITTANCE DÉPOSÉE AUTOMATIQUEMENT (GO 19/10) : interrupteurs + signal de saveDB (app-part1.js).
    basculerQuittancesAuto, basculerQuittancesAutoGlobal, apresEnregistrement }
  W._elParamsQuittancesHtml = paramsQuittancesHtml
  _sigArgent = signatureArgent()
  const hostP = document.getElementById('param-el-quittances'); if (hostP) hostP.innerHTML = paramsQuittancesHtml()
  cycle(true)
  setInterval(() => cycle(false), 10 * 60_000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cycle(false) })
  if (G('rLogFiche') && document.querySelector('.logf-panels')) { try { majBloc() } catch (e) { /* ignoré */ } }
}

// Exposé pour les tests (fonctions sans effet de bord).
export const _pourTests = { locatairesDuBail, importerSignalements, rafraichirAccueil, etat, blocHtml, DUREE_LECTURE_ACCES,
  deposerQuittancesAuto, publierLocation, souhaites, documents, retirer, paramsQuittancesHtml, basculerQuittancesAuto, basculerQuittancesAutoGlobal,
  apresEnregistrement, signatureArgent, demarrer: () => { _demarre = true; _sigArgent = signatureArgent() } }
