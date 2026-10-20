// js/app/demo-app.js — COMPTE DÉMO (?demo=1) : branchement de la démonstration, côté app.
//
// Chargé par js/main.js UNIQUEMENT quand le script du <head> d'index.html a posé window.__immoDemo (paramètre ?demo=1) :
// import dynamique, aucun poids pour les vrais comptes. Rôles, une fois la base de la démo chargée :
//  1. compléter le jeu de données avec les RÉSULTATS des modules de l'app (jamais recopiés à la main) :
//     verdict « qui paie » d'un incident terminé (js/core/incident-circuit.js, règles inchangées), vérifications 2D-Doc
//     PRÉ-CALCULÉES des pièces fictives des candidats (js/core/verif-pieces.js) ;
//  2. servir le « nuage » FICTIF (js/core/demo-nuage.js) sous les deux accès bornés que l'app attend
//     (window.__immoEspaceLoc, window.__immoIncidentCircuit) et ouvrir les fichiers de ce nuage (devis, facture) ;
//  3. démarrer l'espace locataire côté propriétaire (js/app/espace-locataire-app.js), comme après une connexion.
// Rien ici n'écrit ailleurs que dans l'espace local de la démo (clés `_demo_`, bases IndexedDB `demo__`, cloisonnées par
// le script du <head>) ; le réseau vers le cloud est fermé.
import { semerNuage, creerNuage, lireEtat } from '../core/demo-nuage.js'
import { makeDetUuid } from '../core/det-uuid.js'
import { bailLigneCle } from '../core/store-mapping.js'
import * as EL from '../core/espace-locataire.js'
import * as IC from '../core/incident-circuit.js'
import * as VP from '../core/verif-pieces.js'

const W = (typeof window !== 'undefined') ? window : globalThis
// Espace FICTIF de la démo (format uuid) : sert de racine aux identifiants déterministes et aux chemins de fichiers.
export const ESPACE_DEMO = 'de300000-0000-4000-8000-00000000e5a0'
const G = (n) => (typeof W[n] === 'function' ? W[n] : null)
const db = () => { try { return DB } catch (e) { return null } }   // eslint-disable-line no-undef
const vivant = (o) => o && !o._deleted
const jour = (s) => String(s || '').slice(0, 10)
const uuidDe = makeDetUuid(ESPACE_DEMO)
const uuid = (collection, k) => uuidDe(collection, k)

// ─────────────────────────── 1. Résultats calculés par les modules de l'app ───────────────────────────
/** Verdict du moteur pour un incident terminé du jeu de données (constat de l'artisan → règles « qui paie »). */
export function completerIncidents(D) {
  let n = 0
  for (const inc of (D && D.incidents) || []) {
    if (!vivant(inc) || !inc.constat || inc.verdict) continue
    const v = IC.verdictDuConstat(inc, inc.constat)
    if (!v) continue
    inc.verdict = v
    if (!inc.payeurRetenu && v.payeur && v.payeur !== 'a_arbitrer') inc.payeurRetenu = v.payeur
    n++
  }
  return n
}

// Scénarios de vérification 2D-Doc des pièces FICTIVES : ce que rendrait verifier2DDoc sur un avis signé (en-tête,
// champs), sans aucun vrai document ni vrai numéro fiscal. Les références sont des zéros (format seulement).
function champsAvis(nom, rfr, ref, annee = '2025') {
  return [{ id: '46', libelle: 'Déclarant 1', valeur: nom }, { id: '41', libelle: 'Revenu fiscal de référence', valeur: rfr },
    { id: '43', libelle: 'Nombre de parts', valeur: '1' }, { id: '44', libelle: 'Référence d\'avis d\'impôt', valeur: ref },
    { id: '47', libelle: 'Numéro fiscal du déclarant 1', valeur: '0000000000000' }, { id: '45', libelle: 'Année des revenus', valeur: annee }]
}
function texteAvis(champs) { return champs.map((c) => c.libelle + ' | ' + c.valeur).join(' | ') }
function resultatValide(champs, signe = '2026-07-24') {
  return { etat: 'valide', code: 'valide', motif: 'Signature valide (démonstration : résultat pré-calculé sur un document fictif).',
    entete: { version: '04', ac: 'FR06', certificat: signe < '2025-03-06' ? 'FPE2' : 'FPE3', type: '28', dateSignature: new Date(signe + 'T00:00:00Z') }, champs,
    certificat: signe < '2025-03-06' ? { ac: 'FR06', id: 'FPE2', du: '2022-03-07', au: '2025-03-06' } : { ac: 'FR06', id: 'FPE3', du: '2025-03-06', au: '2028-03-05' }, revocation: { du: '2026-10-02', au: '2026-10-09' } }
}
export const SCENARIOS_VERIF = Object.freeze({
  'avis-valide': () => { const ch = champsAvis('ROUSSEAU EMMA', '29640', '2600000000000'); return { analyse: { estPdf: true, codes: ['demo'], texte: texteAvis(ch), metadonnees: { producteur: 'DGFiP', createur: 'DGFiP' }, enregistrements: 1, superpositions: [] }, resultats: [resultatValide(ch)] } },
  // Garant : avis signé et conforme, mais sur les revenus 2023 → constat factuel V7 (décret n° 2015-1437 : dernier ou
  // avant-dernier avis), pour montrer un « point à vérifier » sur un dossier complet.
  'avis-valide-garant': () => { const ch = champsAvis('ROUSSEAU JEAN', '41210', '2400000000001', '2023'); return { analyse: { estPdf: true, codes: ['demo'], texte: texteAvis(ch), metadonnees: { producteur: 'DGFiP', createur: 'DGFiP' }, enregistrements: 1, superpositions: [] }, resultats: [resultatValide(ch, '2024-07-26')] } },
  // Photo d'un avis : aucun code 2D-Doc lisible → constat factuel V4 (et l'adresse du service de vérification).
  'avis-sans-code': () => ({ analyse: { estPdf: false, codes: [], texte: '', metadonnees: null, enregistrements: 0, superpositions: [] }, resultats: [] }),
})
/** Vérification PRÉ-CALCULÉE des pièces fictives marquées `_demoVerif` (posée une fois, ou si le module change de version). */
export function completerVerifs(D, maintenant) {
  let n = 0
  for (const d of (D && D.documents) || []) {
    if (!vivant(d) || !d._demoVerif || d.parentType !== 'candidat') continue
    if (d.verif && d.verif.v === VP.VERSION_VERIF) continue
    const sc = SCENARIOS_VERIF[d._demoVerif]; if (!sc) continue
    const cand = (D.candidats || []).find((c) => vivant(c) && String(c.id) === String(d.parentId)); if (!cand) continue
    const { analyse, resultats } = sc()
    d.verif = VP.construireVerif({ doc: d, candidat: cand, analyse, resultats, maintenant: maintenant || new Date() })
    n++
  }
  return n
}

// ─────────────────────────── 2. Le nuage fictif ───────────────────────────
function entNom(bail, log) { return (bail && bail.entity) || (log && log.entity) || null }
function logDe(D, ref) { return (D.logements || []).find((l) => vivant(l) && l.ref === ref) || null }
function locatairesDe(bail, log) {
  if (bail && Array.isArray(bail.locataires) && bail.locataires.length) return bail.locataires.map((l) => String((l && l.nom) || '').trim()).filter(Boolean)
  return [String((bail && bail.nom) || (log && log.locataire) || '').trim()].filter(Boolean)
}
/** Même dérivation que espace-locataire-app.js (bailId) : id de la ligne `baux` d'une location. */
export function bailIdDe(ref, bail, ent) { return uuid('bail', bailLigneCle(String(ref).split('@@')[0], bail && bail._bailUid), ent) }
function location(D, ref) {
  const bail = D.baux && D.baux[ref]; if (!vivant(bail)) return null
  const log = logDe(D, ref), ent = entNom(bail, log)
  return { bail_id: bailIdDe(ref, bail, ent), bail_debut: jour(bail.debut) || null, logement_id: uuid('logement', EL.cleNom(ref), ent), entite_id: null, fin_bail: null }
}
function infoBail(D, bid) {
  for (const [k, bail] of Object.entries(D.baux || {})) {
    if (!vivant(bail)) continue
    const ref = String(k).split('@@')[0], log = logDe(D, ref), ent = entNom(bail, log)
    if (bailIdDe(ref, bail, ent) === bid) return { bail_debut: jour(bail.debut) || null, logement_id: uuid('logement', EL.cleNom(ref), ent), entite_id: null, fin_bail: null }
  }
  return null
}
/** Documents DÉJÀ publiés d'une location (mêmes clés que la publication automatique) : quittances et EDL signés. */
function documentsVoulus(D, ref, acces) {
  const bail = D.baux && D.baux[ref]; if (!vivant(bail)) return []
  const loc = { debut: jour(bail.debut) || null, fin: null, noms: locatairesDe(bail, logDe(D, ref)) }
  const out = []
  for (const edl of D.edl || []) {
    if (!vivant(edl) || edl.logement !== ref || !(edl.signatures && edl.signatures.signedAt) || !EL.edlDeLaLocation(edl, loc)) continue
    out.push({ cle: EL.cleDocument('edl', edl.id), type_doc: 'edl', titre: /sortie/i.test(edl.type || '') ? 'État des lieux de sortie' : 'État des lieux d\'entrée', date_doc: jour(edl.date), publie_le: acces.emis_le })
  }
  for (const q of D.quittances || []) {
    if (!vivant(q) || q.logement !== ref || !EL.quittanceDeLaLocation(q, loc)) continue
    const mk = EL.moisCle(q.mois); if (!mk) continue
    out.push({ cle: EL.cleDocument('quittance', mk), type_doc: 'quittance', titre: EL.titreQuittance(q.mois), periode: q.mois, date_doc: jour(q.date) || null,
      publie_le: (jour(q.date) > jour(acces.emis_le) ? jour(q.date) + 'T09:00:00.000Z' : acces.emis_le) })
  }
  return out
}
function resultatDe(D, sig) {
  const inc = (D.incidents || []).find((i) => vivant(i) && Number(i.id) === Number(sig.resultatDe)); if (!inc) return null
  const r = IC.resultatPourLocataire({ verdict: inc.verdict, payeurRetenu: inc.payeurRetenu, constat: inc.constat, montantTtc: null,
    factureNumero: (inc.circuit && inc.circuit.factureNumero) || '', now: inc.resultatPublieLe || undefined })
  return r && !r.erreur ? r : null
}

// Clés de l'espace démo (`_lsKey` de app-part1.js : préfixe `_demo_`), déclarées au registre js/core/stockage-local.js.
/* global _lsKey */
function lireLS(k) { try { return localStorage.getItem(_lsKey(k)) } catch (e) { return null } }
function ecrireNuage(v) { try { localStorage.setItem(_lsKey('demo_nuage'), v) } catch (e) { console.warn('[DEMO] stockage du nuage', e && e.message) } }

/** Le nuage de la séance : relu, sinon semé depuis le plan du jeu de données. null si aucun plan (sandbox, démo vide). */
export function ouvrirNuage(D) {
  let etat = lireEtat(lireLS('demo_nuage'))
  if (!etat) {
    let plan = null
    try { plan = JSON.parse(lireLS('demo_nuage_plan') || 'null') } catch (e) { plan = null }
    if (!plan) return null
    etat = semerNuage(plan, { espaceId: ESPACE_DEMO, location: (ref) => location(D, ref), documentsVoulus: (ref, a) => documentsVoulus(D, ref, a), resultat: (s) => resultatDe(D, s) })
    ecrireNuage(JSON.stringify(etat))
  }
  return creerNuage({
    etat, espaceId: ESPACE_DEMO,
    sauver: (e) => ecrireNuage(JSON.stringify(e)),
    uuid: (collection, k, ent) => uuid(collection, k, ent),
    infoBail: (bid) => infoBail(D, bid),
    deposer: async (path, blob) => {
      const url = await new Promise((res) => { try { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => res(null); fr.readAsDataURL(blob) } catch (e) { res(null) } })
      if (url && G('_idbPut')) await W._idbPut('demo_nuage:' + path, url)
    },
  })
}

// Fichier d'un chemin du nuage fictif → URL locale (blob:) ; null pour tout autre chemin (les appelants le gèrent déjà).
function fichierUrl(nuage) {
  return async (path) => {
    const k = nuage.fichierDe(path); if (!k || !G('_idbGet')) return null
    try {
      const data = String(await W._idbGet(k) || ''); const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(data); if (!m) return null
      // Décodage LOCAL (la CSP de la page refuse fetch('data:…') : connect-src n'autorise pas data:).
      const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]); const o = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i)
      return URL.createObjectURL(new Blob([o], { type: m[1] || 'application/octet-stream' }))
    } catch (e) { return null }
  }
}

// ─────────────────────────── 3. Démarrage ───────────────────────────
let _demarre = false
export function demarrer() {
  if (_demarre || W.__immoDemo !== true) return
  _demarre = true
  const essayer = (n) => {
    const D = db()
    // Base pas encore chargée (initDB au DOMContentLoaded) : on attend. Démo pas encore semée : le bandeau la charge
    // puis recharge la page — rien à faire ici.
    if (!D || !Array.isArray(D.logements)) { if (n < 100) setTimeout(() => essayer(n + 1), 100); return }
    if (!lireLS('demo_charge') || !D.logements.length) return
    try {
      const a = completerIncidents(D), b = completerVerifs(D)
      if ((a || b) && G('saveDB')) W.saveDB()
    } catch (e) { console.warn('[DEMO] compléments', e) }
    const nuage = ouvrirNuage(D)
    if (!nuage) return
    W.__immoEspaceLoc = nuage.espaceLoc
    W.__immoIncidentCircuit = nuage.incidentCircuit
    if (typeof W.__immoCloudFileUrl !== 'function') W.__immoCloudFileUrl = fichierUrl(nuage)
    import('./espace-locataire-app.js').then((m) => m.demarrer()).catch((e) => console.warn('[DEMO] espace locataire', e))
    if (G('_refreshAfterMutation')) { try { W._refreshAfterMutation() } catch (e) { /* rendu suivant */ } }
  }
  essayer(0)
}
