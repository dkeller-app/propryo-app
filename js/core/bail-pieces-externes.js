/**
 * js/core/bail-pieces-externes.js — RETOURS 15/10 (lot 2, point 1) : un bail signé HORS Propryo a PLUSIEURS pièces
 * (au moins le bail et l'acte de cautionnement), chacune typée. Décisions de Didier du 15/10 :
 *   D1 — types : bail signé, acte de cautionnement (une pièce par garant inscrit au bail), avenant, annexe, autre (nommée) ;
 *        PDF ET photos acceptés (le contrôle du contenu reste celui de l'app : _pjTypeReel) ;
 *   D2 — « Je l'ai en papier » pour l'acte de cautionnement : la caution compte comme DÉTENUE.
 *
 * Stockage (jamais dans bail.signatures : la ligne cloud du bail est verrouillée) :
 *   - chaque pièce = un document DB.documents { nature:'bail-signe-externe', piece, garantNom? + garantIdx? (acte de
 *     cautionnement), pieceLibelle?, bailSignedAt, bailDebut } routé vers l'espace du bail (_espaceId). Un document SANS
 *     `piece` (déposé avant ce lot) est le bail signé — migré au démarrage par `migrerPiecesExternes` ;
 *   - « détenu en papier » = sur le LOGEMENT (partagé avec la SCI, comme les validations de régularisation) :
 *     logement.cautionsPapier[cleGarant(bail, nom)] = { at, par, nom }.
 *
 * L'acte de cautionnement est rattaché à la PERSONNE (nom du garant, normalisé), pas à son rang : retirer le garant 1 d'un
 * bail à deux garants ne donne jamais l'acte de l'un à l'autre (relecture adverse 15/10). Repli par rang seulement pour un
 * acte déposé sans nom.
 *
 * Prédicat pour l'Accueil (la matrice est refaite par un autre chantier, ce module ne la touche pas) :
 *   cautionDetenue({ bail, pieces, papier, signatureGarant }) / etatCaution(...)
 */

export const NATURE = 'bail-signe-externe'

export const PIECE_TYPES = [
  { k: 'bail', l: 'Bail signé' },
  { k: 'caution', l: 'Acte de cautionnement' },
  { k: 'avenant', l: 'Avenant' },
  { k: 'annexe', l: 'Annexe au bail' },
  { k: 'autre', l: 'Autre pièce' },
]
const TYPES = new Set(PIECE_TYPES.map(t => t.k))
const ORDRE = { bail: 0, caution: 1, avenant: 2, annexe: 3, autre: 4 }

/** Nom comparable : minuscules, sans accents ni espaces superflus. */
export function normNom(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Type d'une pièce ; un document sans type (avant ce lot) est le bail signé. */
export function pieceDe(doc) {
  return doc && TYPES.has(doc.piece) ? doc.piece : 'bail'
}

/** Garants inscrits au bail (legacy à plat : garant, garant2), dans l'ordre, avec leur rang (1, 2). */
export function garantsDuBail(bail) {
  const b = bail || {}
  return [[1, b.garant], [2, b.garant2]]
    .map(([idx, nom]) => ({ idx, nom: String(nom == null ? '' : nom).trim() }))
    .filter(g => g.nom)
}

/** L'acte d'un garant parmi les pièces : par nom (normalisé) ; repli par rang pour un acte déposé sans nom. Le plus récent. */
export function acteDuGarant(pieces, g) {
  if (!g) return null
  const n = normNom(g.nom)
  const actes = (Array.isArray(pieces) ? pieces : []).filter(d => d && !d._deleted && pieceDe(d) === 'caution')
  const parNom = actes.filter(d => d.garantNom && normNom(d.garantNom) === n)
  const l = parNom.length ? parNom : actes.filter(d => !d.garantNom && Number(d.garantIdx || 1) === Number(g.idx))
  return l.slice().sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))[0] || null
}

/** Actes de cautionnement qui ne correspondent plus à aucun garant inscrit (garant retiré ou remplacé). */
export function actesOrphelins(pieces, garants) {
  const pris = new Set((Array.isArray(garants) ? garants : []).map(g => acteDuGarant(pieces, g)).filter(Boolean))
  return (Array.isArray(pieces) ? pieces : []).filter(d => d && !d._deleted && pieceDe(d) === 'caution' && !pris.has(d))
}

/** Libellé lisible d'une pièce. L'acte porte le nom de SA personne (celle enregistrée au dépôt). */
export function libellePiece(doc, garants) {
  const p = pieceDe(doc)
  if (p === 'caution') {
    if (doc && String(doc.garantNom || '').trim()) return 'Acte de cautionnement — ' + String(doc.garantNom).trim()
    const g = (Array.isArray(garants) ? garants : []).find(x => Number(x.idx) === Number(doc && doc.garantIdx))
    return 'Acte de cautionnement' + (g ? ' — ' + g.nom : '')
  }
  if (p === 'autre') return String((doc && doc.pieceLibelle) || '').trim() || 'Autre pièce'
  if ((p === 'avenant' || p === 'annexe') && doc && String(doc.pieceLibelle || '').trim()) return String(doc.pieceLibelle).trim()
  return (PIECE_TYPES.find(t => t.k === p) || PIECE_TYPES[0]).l
}

/** Pièces d'UNE déclaration (même signedAt), vivantes, triées : bail, cautions, avenants, annexes, autres. */
export function piecesDeclaration(docs, signedAt) {
  if (!signedAt) return []
  return (Array.isArray(docs) ? docs : [])
    .filter(d => d && !d._deleted && d.nature === NATURE && d.bailSignedAt === signedAt)
    .slice()
    .sort((a, b) => (ORDRE[pieceDe(a)] - ORDRE[pieceDe(b)])
      || ((Number(a.garantIdx) || 0) - (Number(b.garantIdx) || 0))
      || String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || '')))
}

/** Le bail signé de la déclaration (le plus récent s'il y en avait plusieurs). */
export function bailSigne(pieces) {
  const l = (Array.isArray(pieces) ? pieces : []).filter(d => d && !d._deleted && pieceDe(d) === 'bail')
  return l.sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))[0] || null
}

/** Clé d'un acte « détenu en papier » sur le logement : date de début du bail + nom normalisé du garant. */
export function cleGarant(bail, nom) {
  return String((bail && bail.debut) || '') + '|' + normNom(nom)
}

/**
 * Change la date de début d'un bail dans les clés « papier » d'un logement (correction de la date de début : les actes
 * détenus suivent le bail). Rend true si quelque chose a changé.
 */
export function suivreDebut(papier, ancienDebut, nouveauDebut) {
  if (!papier || typeof papier !== 'object' || ancienDebut === nouveauDebut) return false
  let ch = false
  for (const k of Object.keys(papier)) {
    const i = k.indexOf('|')
    if (i < 0 || k.slice(0, i) !== String(ancienDebut || '')) continue
    const nk = String(nouveauDebut || '') + k.slice(i)
    if (!papier[nk]) papier[nk] = papier[k]
    delete papier[k]
    ch = true
  }
  return ch
}

/**
 * État de la caution d'un bail : 'na' (aucun garant inscrit), 'detenue' (chaque garant a son acte : fichier déposé, papier
 * déclaré, ou acte signé dans Propryo), 'partielle', 'absente'.
 * @param {{bail:object, pieces?:object[], papier?:object, signatureGarant?:boolean}} o — pieces = pièces de la déclaration
 *        courante ; papier = logement.cautionsPapier ; signatureGarant = la caution a signé dans Propryo
 *        (bail.signatures.garant, la source lue aujourd'hui par la matrice de l'Accueil).
 */
export function etatCaution(o = {}) {
  const garants = garantsDuBail(o.bail)
  const papier = (o.papier && typeof o.papier === 'object') ? o.papier : {}
  const detail = garants.map(g => {
    const f = acteDuGarant(o.pieces, g)
    const p = papier[cleGarant(o.bail, g.nom)]
    return { idx: g.idx, nom: g.nom, source: f ? 'fichier' : (p ? 'papier' : (o.signatureGarant ? 'signature' : null)), doc: f || null, papier: p || null }
  })
  const n = detail.filter(g => g.source).length
  const etat = !garants.length ? 'na' : (n === garants.length ? 'detenue' : (n ? 'partielle' : 'absente'))
  return { etat, garants: detail }
}

/** Prédicat simple pour l'Accueil : chaque garant inscrit au bail a son acte de cautionnement. */
export function cautionDetenue(o = {}) {
  return etatCaution(o).etat === 'detenue'
}

/**
 * Migration (idempotente) : un document « bail signé hors Propryo » déposé avant ce lot n'a pas de `piece` → c'est le
 * bail signé. `garder(doc)` (facultatif) restreint aux documents que cet appareil peut écrire. Rend les documents modifiés.
 */
export function migrerPiecesExternes(documents, garder) {
  const out = []
  for (const d of Array.isArray(documents) ? documents : []) {
    if (!d || d._deleted || d.nature !== NATURE || TYPES.has(d.piece)) continue
    if (typeof garder === 'function' && !garder(d)) continue
    d.piece = 'bail'
    out.push(d)
  }
  return out
}
