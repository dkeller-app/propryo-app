/**
 * core/quittance-auto.js — QUITTANCE DÉPOSÉE AUTOMATIQUEMENT DANS L'ESPACE LOCATAIRE (GO Didier 19/10/2026).
 * Maquette : mockups/QUITTANCE-ESPACE-LOCATAIRE/maquette.html. Décisions :
 *   D1 — activé par défaut, réglage global (Paramètres › Bail) + exception bail par bail (fiche du logement) ;
 *   D2 — seuls les mois dont le paiement complet est DATÉ du jour de l'activation ou après (jamais de rattrapage) ;
 *   D3 — ton neutre côté locataire.
 *
 * Module PUR (aucun DOM, aucune DB, aucun réseau). AUCUNE règle d'argent ici : « payé en entier » est LU dans le moteur
 * unique (js/core/loyers-mois.js : peutQuittancer, moisAQuittancer, etat.byYm[ym].datePaiement), lui-même alimenté par
 * le suivi Finances (_computeSuiviLot → etatDepuisSuivi). La quittance ne calcule rien (art. 21 : une quittance n'existe
 * que pour un mois payé en entier ; un manque accepté → remise ; des charges passées à la régularisation → pas soldé).
 *
 * Le réglage vit dans la configuration de l'espace PROPRE du propriétaire (DB.params.elQuittancesAuto) et NON dans le
 * bail : un bail signé est verrouillé au cloud (0014/0015, toute mise à jour refusée). Seul le poste du propriétaire de
 * l'espace crée des quittances (un seul publieur : pas de doublon au registre entre associés).
 *
 * Forme : { actif?: boolean (défaut true), depuis?: 'AAAA-MM-JJ', baux?: { '<ref>|<début>': { actif: boolean, depuis?: 'AAAA-MM-JJ' } } }
 * Tests : __tests__/helpers/quittance-auto.test.js
 */

import { peutQuittancer, moisAQuittancer, EPS_CENTIME } from './loyers-mois.js'

const dIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) && s.length >= 10
const jour10 = (s) => (dIso(s) ? s.slice(0, 10) : null)

/** Clé d'une LOCATION (une ligne de bail peut être réutilisée par une location suivante : le début la distingue). */
export const cleBailAuto = (ref, debut) => String(ref == null ? '' : ref).split('@@')[0] + '|' + (jour10(String(debut || '')) || '-')

function lire(params) {
  const r = params && params.elQuittancesAuto
  return (r && typeof r === 'object' && !Array.isArray(r)) ? r : {}
}

/**
 * Réglage EFFECTIF d'une location. `depuis` null = pas encore de date d'activation (le cycle la pose avant de créer).
 * @returns {{actif:boolean, depuis:string|null, exception:boolean, source:'global'|'bail'}}
 */
export function reglage(params, ref, debut) {
  const r = lire(params)
  const globalActif = r.actif !== false
  const b = r.baux && typeof r.baux === 'object' ? r.baux[cleBailAuto(ref, debut)] : null
  if (b && typeof b.actif === 'boolean') {
    return { actif: b.actif, depuis: b.actif ? jour10(String(b.depuis || '')) : null, exception: b.actif !== globalActif, source: 'bail' }
  }
  return { actif: globalActif, depuis: globalActif ? jour10(String(r.depuis || '')) : null, exception: false, source: 'global' }
}

/** Réglage global (Paramètres) : { actif, depuis, exceptions:[clé] }. */
export function reglageGlobal(params) {
  const r = lire(params)
  const actif = r.actif !== false
  const exceptions = Object.entries(r.baux && typeof r.baux === 'object' ? r.baux : {})
    .filter(([, b]) => b && typeof b.actif === 'boolean' && b.actif !== actif).map(([k]) => k)
  return { actif, depuis: actif ? jour10(String(r.depuis || '')) : null, exceptions }
}

/**
 * Première mise en route (D1 : activé par défaut) : pose la date d'activation globale si elle manque.
 * @returns {Object|null} le NOUVEL objet elQuittancesAuto, ou null s'il n'y a rien à écrire.
 */
export function initialiser(params, jour) {
  const r = lire(params)
  if (r.actif === false || jour10(String(r.depuis || '')) || !dIso(String(jour || ''))) return null
  return { ...r, actif: true, depuis: String(jour).slice(0, 10) }
}

/** Interrupteur global. Rallumer = nouvelle date d'activation (D2 : rien de ce qui a été payé pendant l'arrêt). */
export function basculerGlobal(params, actif, jour) {
  const r = lire(params)
  const out = { ...r, actif: !!actif }
  if (actif) out.depuis = String(jour).slice(0, 10)
  else delete out.depuis
  return out
}

/** Interrupteur d'une location (exception). Allumer = date d'activation propre à ce bail. */
export function basculerBail(params, ref, debut, actif, jour) {
  const r = lire(params)
  const baux = { ...(r.baux && typeof r.baux === 'object' ? r.baux : {}) }
  baux[cleBailAuto(ref, debut)] = actif ? { actif: true, depuis: String(jour).slice(0, 10) } : { actif: false }
  return { ...r, baux }
}

/** Dernier jour 'AAAA-MM-JJ' du mois 'AAAA-MM'. */
const finDuMois = (ym) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return ym + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0') }
/**
 * Le mois est-il couvert EN ENTIER par la location [debut, fin] (fin vide = en cours) ? Un mois d'entrée ou de sortie en
 * cours de mois peut être partagé avec le locataire précédent ou suivant : son dû (celui du LOT) dépasse alors la part de
 * ce locataire — il reste au geste du propriétaire, jamais automatique (relecture adverse 19/10).
 */
export function moisEntierDansLocation(ym, debut, fin) {
  const d = jour10(String(debut || '')), f = jour10(String(fin || ''))
  if (d && d > ym + '-01') return false
  if (f && f < finDuMois(ym)) return false
  return true
}

/**
 * Les mois à quittancer AUTOMATIQUEMENT pour une location : soldés au moteur (moisAQuittancer = peutQuittancer ok, pas
 * encore quittancés), dans la location, et dont le paiement complet est DATÉ du jour de l'activation ou après (D2).
 * Un mois soldé sans date de paiement (versement non daté, solde d'ouverture, remise seule) n'est jamais automatique.
 * @param {{byYm:Object, list:Array}} etat sortie de _loyerEtatLot (moteur)
 * @param {{depuis:string|null, deja?:string[]|Set, debut?:string, fin?:string}} o
 * @returns {string[]} 'YYYY-MM' chronologiques
 */
export function moisADeposer(etat, o) {
  const opt = o || {}
  const depuis = jour10(String(opt.depuis || ''))
  if (!etat || !etat.byYm || !depuis) return []
  return moisAQuittancer(etat, opt.deja || []).filter((ym) => {
    const e = etat.byYm[ym]
    if (!e || !moisEntierDansLocation(ym, opt.debut, opt.fin)) return false
    if (e.aConfirmer) return false   // soldé par un encaissement « à confirmer » (reçu pendant une vacance)
    const dp = jour10(String(e.datePaiement || ''))
    return !!dp && dp >= depuis
  })
}

/**
 * Verdict de PUBLICATION d'une quittance déjà au registre (q, facultative), lu au moteur :
 *   'solde'     — le mois est payé en entier (peutQuittancer ok) ;
 *   'non_solde' — le mois est suivi et n'est PAS payé en entier (reste dû, charges à la régularisation, aucun dû) ;
 *   'inconnu'   — le moteur ne suit pas ce mois (avant le début du suivi, moteur indisponible) : rien n'est changé.
 */
export function verdict(etat, ym, q) {
  const e = etat && etat.byYm && etat.byYm[String(ym)]
  if (!e) return 'inconnu'
  if (!peutQuittancer(etat, String(ym)).ok) return 'non_solde'
  // Mois « soldé » par une remise TOTALE : rien n'a été reçu → jamais de quittance (comme la fabrique _creerQuittance).
  if ((Number(e.remise) || 0) >= (Number(e.du) || 0) - EPS_CENTIME) return 'non_solde'
  // La quittance du registre a figé la remise du mois au moment de son émission. Si le moteur en compte DAVANTAGE
  // aujourd'hui (manque accepté après coup), le document atteste une somme reçue qui ne l'a pas été → retiré (il sera
  // refait à la main). Tolérance d'un euro : un écart d'arrondi abandonné (quelques centimes, aussi compté en remise)
  // ne retire pas les quittances émises avant que la remise soit figée au registre (v15.757).
  if (q && (Number(e.remise) || 0) - (Number(q.remise) || 0) > ECART_REMISE_TOLERE) return 'non_solde'
  return 'solde'
}

export const ECART_REMISE_TOLERE = 1
const YM_CLE =/^quittance:(\d{4}-\d{2})$/
/** 'quittance:2026-10' → '2026-10' (clé de publication de l'espace locataire). */
export const ymDeCle = (cle) => { const m = YM_CLE.exec(String(cle || '')); return m ? m[1] : null }

/**
 * COHÉRENCE des quittances publiées d'une location avec le moteur.
 *  • retirer      : visible et le mois n'est plus payé en entier → masquée (retire_le), conservée ;
 *  • republier    : retirée PAR CETTE RÈGLE (marque au registre) et le mois est de nouveau payé en entier → nouveau PDF ;
 *  • effacerMarque: marque au registre devenue sans objet (document visible et mois soldé).
 * Une quittance retirée À LA MAIN (sans marque) n'est jamais republiée (D6). Un verdict 'inconnu' ne change rien.
 * @param {Array<{id, cle, type_doc, retire_le}>} publies lignes locataire_documents de la location
 * @param {(ym:string)=>('solde'|'non_solde'|'inconnu')} verdictDe
 * @param {(ym:string)=>(Object|null)} quittanceDe la quittance du REGISTRE de ce mois (marque elRetrait, origine, date)
 *
 * Marque de retrait au registre (q.elRetrait) : motif 'non_solde' (posée par cette règle) ou 'manuel' (retrait du
 * propriétaire, D6 — jamais republiée). Sans marque (retrait manuel antérieur à la marque, ou quittance supprimée puis
 * recréée au registre) : republiée SEULEMENT si la quittance du registre a été créée par le dépôt automatique APRÈS le
 * retrait (relecture Fable 19/10) — un ancien retrait à la main reste intact.
 */
export const motifRetrait = (q) => (q && q.elRetrait ? (q.elRetrait.motif === 'manuel' ? 'manuel' : 'non_solde') : null)
export function planCoherence(publies, verdictDe, quittanceDe) {
  const retirer = [], republier = [], effacerMarque = []
  for (const p of publies || []) {
    if (!p || p.type_doc !== 'quittance') continue
    const ym = ymDeCle(p.cle); if (!ym) continue
    const v = verdictDe(ym, p), q = quittanceDe(ym) || null, motif = motifRetrait(q)
    if (!p.retire_le) {
      if (v === 'non_solde') retirer.push({ row: p, ym })
      else if (v === 'solde' && motif === 'non_solde') effacerMarque.push({ row: p, ym })
    } else if (v === 'solde') {
      if (motif === 'non_solde') republier.push({ row: p, ym })
      else if (!motif && q && q.origine === 'espace-locataire') {
        const cree = jour10(String(q.date || '')), retire = jour10(String(p.retire_le || ''))
        if (cree && retire && cree > retire) republier.push({ row: p, ym })
      }
    }
  }
  return { retirer, republier, effacerMarque }
}

export { EPS_CENTIME }
