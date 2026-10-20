/**
 * core/espace-locataire.js — ESPACE LOCATAIRE (accès par lien, sans mot de passe). Module PUR (aucun DOM, aucun
 * réseau, aucune DB) partagé par l'app du propriétaire ET par le relais (import au build du Worker).
 *
 * CDC : mockups/ESPACE-LOCATAIRE/CDC-ESPACE-LOCATAIRE.md (décisions D1 → D14, GO Didier 14/10/2026).
 * La FRONTIÈRE d'accès vit en SQL (migration 0059, fonctions el_*) ; ce module ne décide d'aucun droit : il fabrique
 * le jeton, calcule les phases (miroir EXACT de public._el_phase), prépare les publications, traduit un signalement
 * en incident du registre existant (nouvelIncident) et rédige les e-mails neutres.
 */

import { ELEMENTS as QP_ELEMENTS, NATURES as QP_NATURES, URGENCES as QP_URGENCES } from './qui-paie.js'

// ─────────────────────────── Jeton et lien (D2, D3) ───────────────────────────
export const JETON_OCTETS = 32
export const JETON_RE = /^[A-Za-z0-9_-]{43}$/

const b64url = (bytes) => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Jeton neuf : 32 octets CSPRNG → base64url (43 caractères). `rand` injectable pour les tests. */
export function nouveauJeton(rand) {
  const bytes = new Uint8Array(JETON_OCTETS)
  const fill = rand || ((b) => globalThis.crypto.getRandomValues(b))
  fill(bytes)
  return b64url(bytes)
}

/** SHA-256 hexadécimal du jeton (texte UTF-8) — même calcul côté app (émission) et relais (vérification). */
export async function empreinteJeton(jeton) {
  if (!JETON_RE.test(String(jeton || ''))) return null
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(jeton))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Lien du locataire : le jeton dans le FRAGMENT (#), jamais envoyé au serveur dans l'URL (D2). */
export function lienEspace(base, jeton) {
  const b = String(base || '').trim().replace(/\/+$/, '')
  // https obligatoire (le lien est un secret durable) ; http seulement pour un relais local de développement.
  const ok = /^https:\/\/[^\s/#?]+$/i.test(b) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/i.test(b)
  if (!ok || !JETON_RE.test(String(jeton || ''))) return null
  return b + '/l#' + jeton
}

/** Lit le jeton d'un fragment d'URL (« #abc… »). Refuse tout ce qui n'a pas la forme exacte. */
export function jetonDuFragment(hash) {
  const t = String(hash || '').replace(/^#/, '').trim()
  return JETON_RE.test(t) ? t : null
}

// ─────────────────────────── Phases (D4) — miroir de public._el_phase ───────────────────────────
const ISO = /^(\d{4})-(\d{2})-(\d{2})/
const dIso = (s) => { const m = ISO.exec(String(s || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null }
const iso = (d) => d.toISOString().slice(0, 10)
/** Ajoute n mois à une date ISO, comme Postgres (`date + interval 'n months'` : jour borné au dernier du mois). */
export function plusMois(isoDate, n) {
  const d = dIso(isoDate); if (!d) return null
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + n, j = d.getUTCDate()
  const dernier = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return iso(new Date(Date.UTC(y, m, Math.min(j, dernier))))
}

/** 'complet' | 'depart' | 'documents' | 'fini'. fin / clos / jour au format AAAA-MM-JJ (fin vide = bail en cours). */
export function phaseAcces(fin, clos, jour) {
  const f = dIso(fin) ? String(fin).slice(0, 10) : null
  const c = dIso(clos) ? String(clos).slice(0, 10) : null
  const j = String(jour).slice(0, 10)
  if (!f || j <= f) return 'complet'
  if (j >= plusMois(f, 14)) return 'fini'
  if (!c) return 'depart'
  if (j < plusMois(c, 6)) return 'documents'
  return 'fini'
}

/** Dernier jour d'accès (exclu) : null si bail en cours ; sinon min(clôture + 6 mois, fin + 14 mois). */
export function finAcces(fin, clos) {
  if (!dIso(fin)) return null
  const plafond = plusMois(fin, 14)
  if (!dIso(clos)) return plafond
  const c6 = plusMois(clos, 6)
  return c6 < plafond ? c6 : plafond
}

export const PHASES_ECRITURE = Object.freeze({ signaler: ['complet'], message: ['complet', 'depart'], accord: ['complet', 'depart'] })
export const peut = (phase, action) => (PHASES_ECRITURE[action] || []).includes(phase)

// ─────────────────────────── Fin de bail / clôture : réconciliation (app) ───────────────────────────
/**
 * Fin d'occupation et clôture des comptes d'une location, lues sur le bail (vivant ou archivé) :
 *  • fin  = règle UNIQUE de l'app (finOccupationBail, injectée) ;
 *  • clos = date de restitution du dépôt (`dgRestitueAt`, posée par le solde de tout compte ou la clôture) ;
 *           aucun dépôt VERSÉ et fin connue → la fin vaut clôture (rien à restituer).
 *  • dgVerseMontant = LA définition du dépôt versé de l'app (_dgVerseMontant, injectée : case « Dépôt de garantie
 *    versé » décochée → 0). Sans injection (relais, tests anciens) : le dépôt du bail (dg).
 */
export function finEtClotureDuBail(bail, { finOccupation, archive = false, dgVerseMontant = null } = {}) {
  if (!bail) return { fin: null, clos: null }
  let fin = null
  try { fin = (typeof finOccupation === 'function' ? finOccupation(bail, archive) : '') || null } catch (e) { fin = null }
  if (fin && !dIso(fin)) fin = null
  if (fin) fin = String(fin).slice(0, 10)
  let clos = bail.dgRestitueAt && dIso(bail.dgRestitueAt) ? String(bail.dgRestitueAt).slice(0, 10) : null
  const verse = typeof dgVerseMontant === 'function' ? Number(dgVerseMontant(bail)) || 0 : Number(bail.dg) || 0
  if (!clos && fin && !(verse > 0)) clos = fin
  return { fin, clos }
}

/**
 * Mises à jour à pousser sur les accès (colonnes fin_bail / comptes_clos_le, seules modifiables par le propriétaire).
 * `acces` = lignes locataire_acces ; `trouverBail(a)` → { bail, archive } de la location de l'accès, ou null.
 * Ne recule jamais une date déjà posée par une donnée manquante (bail introuvable → rien).
 */
export function majFinsAcces(acces, trouverBail, finOccupation, dgVerseMontant = null) {
  const out = []
  for (const a of acces || []) {
    if (!a || a.revoque_le) continue
    const t = trouverBail(a); if (!t || !t.bail) continue
    const { fin, clos } = finEtClotureDuBail(t.bail, { finOccupation, archive: !!t.archive, dgVerseMontant })
    const patch = {}
    if ((fin || null) !== (a.fin_bail || null) && (fin || !t.archive)) patch.fin_bail = fin
    if ((clos || null) !== (a.comptes_clos_le || null) && (clos || !t.archive)) patch.comptes_clos_le = clos
    if (Object.keys(patch).length) out.push({ id: a.id, patch })
  }
  return out
}

// ─────────────────────────── Accord pour la quittance électronique (art. 21) ───────────────────────────
export const ACCORD_VERSION = 'v1'
export const ART21 = Object.freeze({
  texte: [
    'Le bailleur ou son mandataire est tenu de transmettre gratuitement une quittance au locataire qui en fait la demande. La quittance porte le détail des sommes versées par le locataire en distinguant le loyer et les charges.',
    'Aucuns frais liés à la gestion de l\'avis d\'échéance ou de la quittance ne peuvent être facturés au locataire.',
    'Avec l\'accord exprès du locataire, le bailleur peut procéder à la transmission dématérialisée de la quittance.',
    'Si le locataire effectue un paiement partiel, le bailleur est tenu de délivrer un reçu.',
  ],
  source: 'Loi n° 89-462 du 6 juillet 1989, article 21 — version en vigueur depuis le 27/03/2014 (Légifrance)',
  url: 'https://www.legifrance.gouv.fr/codes/section_lc/JORFTEXT000000509310/LEGISCTA000006118908/',
})
export const ART23_JUSTIFICATIFS = Object.freeze({
  texte: 'Durant six mois à compter de l\'envoi de ce décompte, les pièces justificatives sont tenues, dans des conditions normales, à la disposition des locataires.',
  source: 'Loi n° 89-462 du 6 juillet 1989, article 23 — version en vigueur depuis le 01/07/2021 (Légifrance)',
})
export const libelleAccord = (nom) => `${String(nom || 'Le locataire').trim()} accepte de recevoir les quittances de ce bail par voie électronique.`

/** État lisible de l'accord, pour le bloc du propriétaire (ton neutre). */
export function etatAccord(a, fdh) {
  const f = typeof fdh === 'function' ? fdh : (x) => String(x || '')
  if (a && a.accord_quittance_le && !a.accord_retire_le) return { donne: true, texte: 'Accord donné le ' + f(a.accord_quittance_le) + (a.accord_quittance_code ? ' (confirmé par code)' : '') }
  if (a && a.accord_retire_le) return { donne: false, texte: 'Accord retiré le ' + f(a.accord_retire_le) + ' : remettre la quittance papier sur demande' }
  return { donne: false, texte: 'Accord non donné : remettre la quittance papier sur demande' }
}

// ─────────────────────────── Signalement → incident du registre (D11) ───────────────────────────
export const PIECES = Object.freeze([
  { k: 'cuisine', lbl: 'Cuisine' }, { k: 'salle_de_bain', lbl: 'Salle de bain' }, { k: 'wc', lbl: 'WC' },
  { k: 'sejour', lbl: 'Séjour' }, { k: 'chambre', lbl: 'Chambre' }, { k: 'entree', lbl: 'Entrée' },
  { k: 'exterieur', lbl: 'Extérieur' }, { k: 'parties_communes', lbl: 'Parties communes' }, { k: 'autre', lbl: 'Autre' },
])
// Le locataire DÉCRIT ; le bailleur QUALIFIE (élément précis, « qui paie ») dans le registre : l'élément reste 'autre'
// avec le libellé choisi, seule la nature et l'urgence sont traduites (listes existantes de qui-paie.js).
export const PROBLEMES = Object.freeze([
  { k: 'fuite_eau', lbl: 'Fuite d\'eau', nature: 'fuite', urgence: 'eau' },
  { k: 'gaz', lbl: 'Odeur de gaz', nature: 'fuite', urgence: 'gaz' },
  { k: 'chauffage', lbl: 'Chauffage ou eau chaude', nature: 'panne', urgence: 'chauffage' },
  { k: 'electricite', lbl: 'Électricité', nature: 'panne', urgence: 'electricite' },
  { k: 'porte_serrure', lbl: 'Porte, serrure, clés', nature: 'casse', urgence: 'porte' },
  { k: 'fenetre_volet', lbl: 'Fenêtre ou volet', nature: 'casse', urgence: null },
  { k: 'equipement', lbl: 'Équipement fourni', nature: 'panne', urgence: null },
  { k: 'humidite', lbl: 'Humidité, moisissures', nature: 'humidite', urgence: null },
  { k: 'nuisibles', lbl: 'Nuisibles', nature: 'nuisibles', urgence: null },
  { k: 'autre', lbl: 'Autre', nature: 'autre', urgence: null },
])
export const URGENCES = Object.freeze([
  { k: 'faible', lbl: 'Pas urgent', aide: 'Gêne légère, peut attendre quelques jours' },
  { k: 'importante', lbl: 'Gêne importante', aide: 'Un équipement ne fonctionne plus, un dégât peut s\'aggraver' },
  { k: 'urgente', lbl: 'Urgent', aide: 'De l\'eau coule, odeur de gaz, plus de chauffage, porte qui ne ferme plus' },
])
const lblDe = (liste, k) => ((liste.find((x) => x.k === k) || {}).lbl) || ''

/** Contrôle d'une saisie de signalement (même règles que la base). Retourne null si valide, sinon un message. */
export function erreurSignalement(s) {
  const x = s || {}
  if (!PIECES.some((p) => p.k === x.piece)) return 'Choisir la pièce.'
  if (!PROBLEMES.some((p) => p.k === x.element)) return 'Choisir le problème.'
  if (!URGENCES.some((u) => u.k === x.urgence)) return 'Choisir le niveau d\'urgence.'
  const d = String(x.description || '').trim()
  if (d.length < 3) return 'Décrire le problème en quelques mots.'
  if (d.length > 2000) return 'Description trop longue (2 000 caractères au plus).'
  if ((x.photos || []).length > 6) return '6 photos au plus.'
  return null
}

// CIRCUIT D'UN INCIDENT (migration 0060) — aide de l'IA et contact pour l'intervention, tels que la base les enregistre.
// L'IA DÉCRIT (résumé, élément, nature, urgence) : jamais de cause ni de « qui paie » (CDC docs/CDC-INCIDENT-CIRCUIT.md).
const _ELEMENTS_QP = new Set(QP_ELEMENTS.map((e) => e.k))
const _NATURES_QP = new Set(QP_NATURES.map((n) => n.k))
const _URGENCES_QP = new Set(QP_URGENCES.map((u) => u.k))
const _txt = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max)
/** Aide de l'IA jointe au signalement (validée par le locataire) : bornée, clés connues seulement ; null si vide. */
export function normaliserIaSignalement(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null
  const out = {
    resume: _txt(x.resume, 2000),
    element: _ELEMENTS_QP.has(x.element) ? x.element : null,
    nature: _NATURES_QP.has(x.nature) ? x.nature : null,
    urgences: [...new Set((Array.isArray(x.urgences) ? x.urgences : []).filter((u) => _URGENCES_QP.has(u)))],
    texte: _txt(x.texte, 2000),
    reponses: (Array.isArray(x.reponses) ? x.reponses : []).slice(0, 2).map((r) => ({ q: _txt(r && r.q, 200), r: _txt(r && r.r, 200) })).filter((r) => r.q && r.r),
    dicte: x.dicte === true,
  }
  return out.resume || out.element || out.texte ? out : null
}
export const TELEPHONE_RE = /^[+0-9 .()-]{6,30}$/
/** Contact pour l'intervention : le téléphone n'est retenu QUE si le locataire accepte qu'il soit transmis (D13). */
export function normaliserContactSignalement(x) {
  const c = x || {}
  const tel = _txt(c.telephone, 30)
  const accord = c.tel_partage === true && TELEPHONE_RE.test(tel) && /\d{6}/.test(tel.replace(/\D/g, ''))
  return { tel_partage: accord, telephone: accord ? tel : null, acces_info: _txt(c.acces_info, 300) || null, presence: _txt(c.presence, 300) || null }
}

/** Identifiant d'incident DÉTERMINISTE (numérique, comme nid()) dérivé de l'uuid du signalement : deux membres qui
 *  importent en même temps produisent le même incident (aucun doublon). */
export function idIncidentDuSignalement(uuid) {
  const hex = String(uuid || '').replace(/[^0-9a-f]/gi, '').toLowerCase()
  if (hex.length < 13) return null
  return String(parseInt(hex.slice(0, 13), 16))
}

/**
 * Champs à passer à nouvelIncident (incidents.js) pour un signalement reçu. `ctx` : { logRef, entity, imm }.
 * Rien de la qualification (verdict, payeur) : c'est le bailleur qui la fait dans le registre.
 */
export function champsIncident(sig, ctx) {
  const c = ctx || {}
  const pb = PROBLEMES.find((p) => p.k === sig.element) || PROBLEMES[PROBLEMES.length - 1]
  const piece = lblDe(PIECES, sig.piece)
  // Avec l'aide de l'IA (0060) : l'élément et la nature DÉDUITS par l'IA (le locataire confirme la pièce et l'urgence,
  // pas ces deux champs) remplacent la liste courte ; le propriétaire les revoit sur la fiche.
  const ia = normaliserIaSignalement(sig.ia)
  const urgIa = ia && ia.urgences.length ? ia.urgences : null
  const urgences = sig.urgence === 'urgente' ? (urgIa || (pb.urgence ? [pb.urgence] : [])) : []
  return {
    id: Number(idIncidentDuSignalement(sig.id)),
    logRef: c.logRef || '',
    imm: sig.piece === 'parties_communes' ? (c.imm || '') : '',
    entity: c.entity || '',
    creeLe: sig.cree_le,
    signalePar: 'locataire',
    signaleParNom: String(c.nom || ''),
    canal: 'espace',
    element: (ia && ia.element) || 'autre',
    elementLibre: ia && ia.element ? piece : [pb.lbl, piece].filter(Boolean).join(' · '),
    nature: (ia && ia.nature) || pb.nature,
    urgences,
    description: String(sig.description || ''),
    contexte: { partieCommune: sig.piece === 'parties_communes' },
  }
}

// ─────────────────────────── Documents publiés (D6, D8) ───────────────────────────
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
/** 'avril 2026' (format des quittances de l'app) → '2026-04' ; déjà 'AAAA-MM' → inchangé ; sinon null. */
export function moisCle(mois) {
  const s = String(mois || '').trim().toLowerCase()
  if (/^\d{4}-\d{2}$/.test(s)) return s
  const m = /^([a-zéû]+)\s+(\d{4})$/.exec(s)
  if (!m) return null
  const i = MOIS.indexOf(m[1])
  return i < 0 ? null : m[2] + '-' + String(i + 1).padStart(2, '0')
}
/**
 * Élision française d'une préposition devant un mot : « de » + « avril » → « d'avril », « de » + « mars » → « de mars ».
 * Voyelle (accentuée ou non) ou « h » TRAITÉ COMME MUET : prévue pour les MOIS (aucun n'a de h aspiré) ; ne pas l'étendre à des mots
 * quelconques (« d'haricot »). Source UNIQUE des titres fabriqués à la
 * publication (relais et app ne refabriquent jamais le titre : il est figé en base au moment de la publication).
 */
export function elide(mot, prep = 'de') {
  const m = String(mot == null ? '' : mot).trim()
  if (!m) return ''
  const p = String(prep || 'de').trim().toLowerCase()
  const voyelle = /^[aeiouyàâäéèêëîïôöùûüœæh]/i.test(m)
  if (voyelle && p === 'de') return "d'" + m
  return p + ' ' + m
}
/** Titre d'une quittance publiée : « Quittance de mars 2026 », « Quittance d'avril 2026 », « Quittance d'août 2026 ». */
export const titreQuittance = (mois) => 'Quittance ' + elide(mois, 'de')

export const CLE_RE = /^[a-z]{2,16}:[A-Za-z0-9._:-]{1,120}$/
const cleSure = (s) => String(s || '').replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 120)
export const cleDocument = (type, id) => { const c = type + ':' + cleSure(id); return CLE_RE.test(c) ? c : null }

/** La date (AAAA-MM-JJ) tombe-t-elle dans la location [debut, fin] (fin vide = en cours) ? */
export function dansLaLocation(date, debut, fin) {
  const d = String(date || '').slice(0, 10)
  if (!dIso(d)) return false
  if (dIso(debut) && d < String(debut).slice(0, 10)) return false
  if (dIso(fin) && d > String(fin).slice(0, 10)) return false
  return true
}

// Identité d'un colocataire : son NOM normalisé (même règle que public._el_cle_nom en base).
export const cleNom = (s) => String(s == null ? '' : s).replace(/[\s\u00a0]+/g, ' ').trim().toLowerCase()

/**
 * Une quittance appartient-elle à CETTE location ? Le registre n'a qu'une quittance par (logement, mois) et ne porte pas
 * de lien vers le bail : le mois de passage d'un locataire à l'autre est commun aux deux locations. On exige donc
 * l'IDENTITÉ (au moins un nom de la quittance parmi les colocataires de la location) ET le mois dans la location.
 * loc : { debut, fin, noms:[…] }.
 */
export function quittanceDeLaLocation(q, loc) {
  const mk = moisCle(q && q.mois); if (!mk || !loc) return false
  const debutMois = mk + '-01', finMois = plusMois(debutMois, 1)
  if (dIso(loc.fin) && debutMois > String(loc.fin).slice(0, 10)) return false
  if (dIso(loc.debut) && finMois <= String(loc.debut).slice(0, 10)) return false
  const noms = new Set((loc.noms || []).map(cleNom).filter(Boolean))
  const deLaQuittance = String((q && q.locataire) || '').split(/\s*,\s*/).map(cleNom).filter(Boolean)
  return deLaQuittance.some((n) => noms.has(n))
}

/**
 * Un état des lieux appartient-il à CETTE location ? Identité exigée (un nom de colocataire dans le champ « locataire »
 * de l'EDL) ; entrée datée au plus 30 jours avant le début et pas après la fin ; sortie entre le début et la fin + 60 jours.
 * Le jour d'un passage de relais (sortie le matin, entrée l'après-midi) ne mélange donc jamais deux locations.
 */
export function edlDeLaLocation(edl, loc) {
  if (!edl || !loc) return false
  const d = String(edl.date || '').slice(0, 10); if (!dIso(d)) return false
  // Noms comparés par mots entiers (« jean martin » ne correspond pas à « jean martinez »).
  const mots = (t) => ' ' + cleNom(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' '
  const texte = mots(edl.locataire)
  const noms = (loc.noms || []).map(mots).filter((n) => n.trim())
  if (!texte.trim() || !noms.some((n) => texte.includes(n))) return false
  const debut = dIso(loc.debut) ? String(loc.debut).slice(0, 10) : null
  const fin = dIso(loc.fin) ? String(loc.fin).slice(0, 10) : null
  const decale = (iso, j) => { const x = dIso(iso); x.setUTCDate(x.getUTCDate() + j); return iso && x.toISOString().slice(0, 10) }
  if (/sortie/i.test(String(edl.type || ''))) return (!debut || d >= debut) && (!fin || d <= decale(fin, 60))
  return (!debut || d >= decale(debut, -30)) && (!fin || d <= fin)
}

/** Fenêtre légale des justificatifs : envoi du décompte + 6 mois (art. 23). */
export const visibleJusquauJustificatifs = (envoiIso) => { const f = plusMois(envoiIso, 6); return f ? f + 'T23:59:59Z' : null }

/**
 * Plan de publication : compare les documents SOUHAITÉS (calculés par l'app pour une location) aux lignes déjà
 * publiées. Renvoie { creer:[], maj:[] } — jamais de suppression (retrait = geste du propriétaire, D6).
 * `souhaites` : [{ cle, type_doc, titre, periode?, date_doc?, storage_path, sha256?, taille?, parentCle?, visible_jusqu_au? }]
 */
// Comparaison tolérante aux formats renvoyés par la base (« …T23:59:59Z » envoyé, « …T23:59:59+00:00 » relu).
function memeValeur(k, a, b) {
  const x = a || null, y = b || null
  if (x === y) return true
  if (x && y && (k === 'visible_jusqu_au' || k === 'date_doc')) {
    const tx = Date.parse(x), ty = Date.parse(y)
    if (!isNaN(tx) && !isNaN(ty)) return k === 'date_doc' ? String(x).slice(0, 10) === String(y).slice(0, 10) : tx === ty
  }
  return false
}
export function planPublication(souhaites, publies) {
  const parCle = new Map((publies || []).map((p) => [p.cle, p]))
  const creer = [], maj = []
  for (const s of souhaites || []) {
    if (!s || !CLE_RE.test(s.cle) || !s.storage_path) continue
    const p = parCle.get(s.cle)
    if (!p) { creer.push(s); continue }
    if (p.retire_le) continue   // retiré par le propriétaire : on ne le republie jamais tout seul
    const diff = {}
    // Le titre n'est jamais réécrit après publication (il peut porter une date de réédition, D8).
    for (const k of ['periode', 'date_doc', 'storage_path', 'sha256', 'visible_jusqu_au'])
      if (s[k] !== undefined && !memeValeur(k, s[k], p[k])) diff[k] = s[k] || null
    if (Object.keys(diff).length) maj.push({ id: p.id, patch: diff })
  }
  return { creer, maj }
}

// ─────────────────────────── Messages ───────────────────────────
export function erreurMessage(corps, pieces) {
  const c = String(corps || '').trim()
  if (!c) return 'Écrire un message.'
  if (c.length > 4000) return 'Message trop long (4 000 caractères au plus).'
  if ((pieces || []).length > 4) return '4 pièces jointes au plus.'
  return null
}

// ─────────────────────────── Fichiers déposés par le locataire ───────────────────────────
export const DEPOT_MAX_OCTETS = 10 * 1024 * 1024
/** Type RÉEL d'un fichier d'après ses premiers octets : 'jpg' | 'png' | 'pdf' | null. */
export function typeReel(bytes) {
  const b = bytes || []
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png'
  return null
}
export const MIME_DE = Object.freeze({ jpg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' })

// ─────────────────────────── E-mails (mode dev tant que le domaine n'est pas actif) ───────────────────────────
/**
 * Modèles NEUTRES (ni « tu » ni « vous ») : aucune donnée personnelle ni montant dans l'objet.
 * type : 'invitation' (porte le lien personnel, envoyé une fois à l'émission) | 'document' | 'message' | 'signalement'.
 * Le lien n'étant conservé nulle part en clair (D3), les avis suivants ne le portent pas : ils renvoient au lien
 * personnel déjà reçu. data : { bailleur, lien?, titre?, statut? }.
 * La quittance « disponible » ne part par e-mail que si l'accord électronique est donné (appelant).
 */
export const TYPES_EMAIL = Object.freeze(['invitation', 'document', 'message', 'signalement'])
export function modeleEmail(type, data) {
  const d = data || {}
  const lien = String(d.lien || '')
  const acces = lien ? 'Lien : ' + lien : "Ouvrir l'espace locataire avec le lien personnel reçu du bailleur (le garder en favori). Lien perdu : en demander un nouveau au bailleur."
  const signe = '\n\n— Propryo, pour ' + (d.bailleur || 'le bailleur') + '\nMessage automatique : ne pas répondre à cet e-mail. Le lien est personnel : ne pas le transférer.'
  if (type === 'invitation') {
    if (!lien) return null
    return { objet: "Accès à l'espace locataire", texte: "Bonjour,\n\nLe bailleur ouvre un espace locataire personnel, sans mot de passe : documents du bail, quittances, signalement d'un problème, messages.\n\nLien personnel, à conserver : " + lien + signe }
  }
  if (type === 'document') return { objet: "Un document est disponible dans l'espace locataire", texte: 'Bonjour,\n\nUn nouveau document est disponible : ' + (d.titre || 'document') + '.\n\n' + acces + signe }
  if (type === 'message') return { objet: "Nouveau message dans l'espace locataire", texte: "Bonjour,\n\nLe bailleur a répondu dans l'espace locataire.\n\n" + acces + signe }
  if (type === 'signalement') return { objet: "Avancement d'un signalement", texte: 'Bonjour,\n\nUn signalement a avancé' + (d.statut ? ' : ' + d.statut : '') + '.\n\n' + acces + signe }
  return null
}
