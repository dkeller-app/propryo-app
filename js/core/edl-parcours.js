/**
 * core/edl-parcours.js — le parcours d'un état des lieux (chantier EDL TERRAIN, lots 5 et 7).
 *
 * CDC docs/CDC-EDL.md §4 (« une pièce à l'écran à la fois »), §A.1 (rail C du pouce),
 * §6 et §A.6 (entrée / sortie, le verdict DÉDUIT jamais saisi), §9 invariants 23 à 25,
 * §A.6 (« le verdict d'un élément de sortie égale TOUJOURS verdictDe(entrée, sortie) »).
 *
 * Module PUR : ni DOM, ni DB. Il répond à « où en est-on ? » et « quel verdict ? ».
 * L'inline rend ; ce module compte, déduit et navigue.
 *
 * Règle gravée (§A.6, invariant testable) : le verdict n'est NI stocké NI saisi.
 * Il se recalcule à chaque rendu depuis (étatEntrée, étatSortie). Un état de sortie
 * vide n'est JAMAIS « conforme » présumé — il reste « à constater ».
 */

export const VERDICTS = { A_CONSTATER: 'a-constater', CONFORME: 'conforme', ECART: 'ecart' };

const _s = (v) => (v == null ? '' : String(v).trim());

/**
 * Le verdict d'un élément de sortie, DÉDUIT (§A.6). Jamais stocké, jamais saisi.
 *   - rien de constaté en sortie        → 'à constater'
 *   - même état qu'à l'entrée           → 'conforme'
 *   - état différent (ou constaté sans état d'entrée) → 'écart'
 */
export function verdictDe(etatEntree, etatSortie) {
  const s = _s(etatSortie);
  if (!s) return VERDICTS.A_CONSTATER;         // on ne présume jamais « conforme »
  return _s(etatEntree) === s ? VERDICTS.CONFORME : VERDICTS.ECART;
}

/** Un élément porte-t-il un état sur le côté pertinent (sortie si isSortie, sinon entrée) ? */
export function elementRenseigne(x, isSortie) {
  if (!x) return false;
  return !!_s(isSortie ? x.etatS : x.etatE);
}

/** Une observation non vide sur le côté pertinent ? */
export function aUneObs(x, isSortie) {
  if (!x) return false;
  return !!_s(isSortie ? x.obsS : x.obsE);
}

/** Au moins une photo sur le côté pertinent ? */
export function aUnePhoto(x, isSortie) {
  if (!x) return false;
  const p = isSortie ? x.photosS : x.photosE;
  return Array.isArray(p) && p.length > 0;
}

/**
 * §A.6, reco du pilotage appliquée : une observation de sortie NON VIDE alors qu'aucun
 * écart n'est constaté (état de sortie vide, ou identique à l'entrée) mérite un
 * avertissement « l'état est-il toujours le même ? ». On prévient, on ne décide pas.
 */
export function avertObsSortie(x) {
  if (!x) return false;
  if (!_s(x.obsS)) return false;
  return verdictDe(x.etatE, x.etatS) !== VERDICTS.ECART;
}

/**
 * Progression d'une pièce : combien d'éléments portent un état, combien restent.
 * @returns {{total:number, remplis:number, restants:number}}
 */
export function progressionPiece(piece, isSortie) {
  const els = (piece && piece.elements) || [];
  let remplis = 0;
  for (const x of els) if (elementRenseigne(x, isSortie)) remplis++;
  return { total: els.length, remplis, restants: els.length - remplis };
}

/** Nombre d'éléments de la pièce dont le verdict de sortie est « écart » (§6). */
export function compterEcarts(piece) {
  const els = (piece && piece.elements) || [];
  let n = 0;
  for (const x of els) if (verdictDe(x && x.etatE, x && x.etatS) === VERDICTS.ECART) n++;
  return n;
}

/** Nombre d'éléments encore « à constater » en sortie (état de sortie vide). */
export function compterAConstater(piece) {
  const els = (piece && piece.elements) || [];
  let n = 0;
  for (const x of els) if (verdictDe(x && x.etatE, x && x.etatS) === VERDICTS.A_CONSTATER) n++;
  return n;
}

/**
 * Stats d'une pièce pour la barre / feuille des pièces (§A.1).
 * @returns {{nom:string, total, remplis, restants, ecarts, complete:boolean}}
 */
export function statsPiece(piece, isSortie) {
  const p = progressionPiece(piece, isSortie);
  return {
    nom: (piece && piece.nom) || '',
    total: p.total,
    remplis: p.remplis,
    restants: p.restants,
    ecarts: isSortie ? compterEcarts(piece) : 0,
    complete: p.total > 0 && p.restants === 0,
  };
}

/** Agrégat de toutes les pièces (barre de progression globale + total des écarts). */
export function statsGlobales(pieces, isSortie) {
  const arr = pieces || [];
  let total = 0, remplis = 0, ecarts = 0, piecesCompletes = 0;
  for (const p of arr) {
    const s = statsPiece(p, isSortie);
    total += s.total; remplis += s.remplis; ecarts += s.ecarts;
    if (s.complete) piecesCompletes++;
  }
  return {
    pieces: arr.length, piecesCompletes,
    total, remplis, restants: total - remplis,
    ecarts,
    pct: total > 0 ? Math.round((remplis / total) * 100) : 0,
  };
}

/** Étiquette du rail du pouce (§A.1) : « Cuisine · 3 / 8 ». */
export function railLabel(nom, idx, total) {
  const n = Number(idx), t = Number(total);
  const pos = Number.isFinite(n) && Number.isFinite(t) && t > 0 ? ` · ${n + 1} / ${t}` : '';
  return _s(nom) + pos;
}

/** Borne un index de pièce dans [0, n-1]. */
export function indexClamp(i, n) {
  if (!(n > 0)) return 0;
  const v = Math.trunc(Number(i) || 0);
  return v < 0 ? 0 : v >= n ? n - 1 : v;
}

/** Pièce suivante, bornée (jamais de dépassement ni de boucle). */
export function suivante(i, n) { return indexClamp(indexClamp(i, n) + 1, n); }
/** Pièce précédente, bornée. */
export function precedente(i, n) { return indexClamp(indexClamp(i, n) - 1, n); }

/** Y a-t-il une pièce après / avant l'index courant ? (griser les flèches du rail). */
export function aSuivante(i, n) { return indexClamp(i, n) < n - 1; }
export function aPrecedente(i, n) { return indexClamp(i, n) > 0; }

/**
 * §A.6 / VALEUR PROBANTE — le constat d'ENTRÉE est SIGNÉ dès qu'on est en mode sortie :
 * ni son état, ni son observation, ni ses photos ne sont modifiables ou supprimables,
 * sur AUCUN format. Ces prédicats purs pilotent les gardes fonction de edlEtat / edlObs /
 * edlDelPhoto / _edlPhotoCell (inline) — un verrou de document signé ne repose jamais sur
 * le CSS seul. `entreeVerrouillee` : état + observation d'entrée. `photoEntreeVerrouillee` :
 * suppression d'une photo d'entrée (le geste le plus grave — il détruit un binaire probant).
 */
export function entreeVerrouillee(isSortie) { return !!isSortie; }
export function photoEntreeVerrouillee(side, isSortie) { return side === 'E' && !!isSortie; }

/**
 * §A.6 — la pellicule de la visionneuse tronque au-delà de `cap` vignettes et ouvre
 * le reste par un « +N » (un élément peut porter jusqu'à 8 photos). Pur et testable.
 * @returns {{visibles:number, plusN:number}}
 */
export function troncaturePellicule(total, cap = 3) {
  const t = Math.max(0, Math.trunc(Number(total) || 0));
  const c = Math.max(0, Math.trunc(Number(cap) || 0));
  return t <= c ? { visibles: t, plusN: 0 } : { visibles: c, plusN: t - c };
}

/**
 * §A.6 — la visionneuse : « pellicule » (téléphone, une grande image + les 2 séries
 * au-dessus) sous le seuil, « colonnes » (PC/tablette, entrée | sortie) au-dessus.
 */
export function layoutVisionneuse(largeur, seuil = 768) {
  return (Number(largeur) || 0) < seuil ? 'pellicule' : 'colonnes';
}

/**
 * P9 (§7bis, §9 inv. 34h) — LE résolveur unique de « l'EDL de sortie qui fait foi »
 * pour un bail. Le bug : `edls.find(e => e.type === 'Sortie')` rend le PREMIER dans
 * l'ordre d'insertion. Sur un logement reloué, c'est la sortie du locataire PRÉCÉDENT
 * qui pilotait le délai de restitution du locataire actuel — une échéance légale
 * déplacée en silence. La règle : le plus RÉCENT à partir du début du bail, jamais le
 * premier trouvé. Source unique, comme `duMois` pour les loyers.
 *
 * Fenêtre = [bail.debut, +∞[ : on borne par le BAS (exclut la sortie du locataire
 * précédent, le bug traité). Pas de borne haute — la sortie du locataire qui part est
 * de toute façon la plus récente. Limite connue : consulter le délai d'un bail ANCIEN
 * alors qu'un bail POSTÉRIEUR a déjà sa propre sortie choisirait cette dernière ; cas
 * non rencontré en pratique (le délai se calcule à la sortie, avant le bail suivant).
 *
 * @param {{ref?:string, debut?:string}} bail
 * @param {Array} edls   la collection DB.edl
 * @returns {object|null} l'EDL de sortie qui fait foi, ou null
 */
export function edlSortieQuiFaitFoi(bail, edls) {
  if (!bail || !bail.ref) return null;
  const debut = bail.debut ? String(bail.debut) : null;
  let best = null;
  for (const e of (edls || [])) {
    if (!e || e._deleted || e.type !== 'Sortie' || e.logement !== bail.ref) continue;
    // une sortie ne peut pas précéder le début du bail : elle appartient au bail
    // précédent. (Une sortie sans date reste candidate — mieux vaut la garder.)
    if (debut && e.date && String(e.date) < debut) continue;
    if (!best) { best = e; continue; }
    // le plus récent gagne ; à date égale, on garde le premier rencontré (stable)
    if (String(e.date || '') > String(best.date || '')) best = e;
  }
  return best;
}
