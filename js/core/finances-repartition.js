/**
 * core/finances-repartition.js — REFONTE FINANCES étape 2 · P-4 (CDC §1).
 *
 * LA CLÉ MENSUELLE DE RÉPARTITION DES FRAIS BAILLEUR en vue immeuble : comptable, frais
 * bancaires, CFE, assurance SCI — tout ce qui n'est rattachable à aucun immeuble.
 *
 * Pour chaque mois M et chaque lot du bailleur :
 *   1. bail actif ce mois-là → le loyer HC DE CE MOIS au TAUX PLEIN (barème historisé,
 *      injecté via `duPlein` — 800 € en janvier, 850 € en août après IRL, JAMAIS rétroactif) ;
 *   2. pas de bail ce mois-là → `loyerHcRef` (loyer souhaité de la fiche), repli `hc` ;
 *   3. aucune valeur → 0.
 * Poids de l'immeuble pour M = potentiel de l'immeuble ÷ potentiel total du bailleur ce
 * mois-là. CHAQUE FRAIS EST RÉPARTI AVEC LES POIDS DU MOIS OÙ IL TOMBE. Repli au nombre de
 * lots si le potentiel total d'un mois est nul. Taux plein, pas de prorata d'entrée/sortie.
 *
 * Écartés explicitement (CDC) : la répartition égale 1/nbImm (faux dès que les immeubles
 * diffèrent en taille) et le prorata des loyers ENCAISSÉS (la vacance déplacerait les frais).
 *
 * INVARIANT (testé) : Σ des poids des immeubles du bailleur = 1 pour chaque mois
 * → Σ vues immeuble = vue bailleur, mois par mois ET sur l'année.
 *
 * PUR : lots + résolveur de taux injectés, aucune lecture de DB ni de DOM.
 * Tests : __tests__/finances-etape2-invariants.test.js (tranche 7).
 */

const _s = (v) => String(v == null ? '' : v).trim();

/** Potentiel locatif d'UN lot pour un mois (règles 1→3 ci-dessus). */
export function potentielLotMois(lot, ym, duPlein) {
  if (!lot || !lot.ref) return 0;
  const d = typeof duPlein === 'function' ? duPlein(_s(lot.ref), ym) : null;
  if (d && d.occupied) return Number(d.hc) || 0;                  // bail actif → taux plein du mois
  return Number(lot.loyerHcRef) || Number(lot.hc) || 0;          // sinon loyer de référence, repli hc
}

/**
 * Poids mensuels des immeubles d'un bailleur.
 * @param {Array} lots lots VIVANTS du bailleur porteur (tous ses immeubles)
 * @param {string} ym 'YYYY-MM'
 * @param {function} duPlein (ref, ym) => {hc, occupied} — adaptateur tauxPleinMois
 * @returns {{parImm:Object, total:number, nbParImm:Object, nbLots:number, repli:boolean}}
 */
export function poidsMensuels(lots, ym, duPlein) {
  const parImm = {}, nbParImm = {};
  let total = 0, nbLots = 0;
  (Array.isArray(lots) ? lots : []).forEach((l) => {
    if (!l || l._deleted || !l.ref) return;
    const imm = _s(l.imm);
    if (!imm) return;                       // un lot sans immeuble ne porte aucune quote-part (panier à part)
    const pot = potentielLotMois(l, ym, duPlein);
    parImm[imm] = (parImm[imm] || 0) + pot;
    nbParImm[imm] = (nbParImm[imm] || 0) + 1;
    total += pot; nbLots++;
  });
  return { parImm, total, nbParImm, nbLots, repli: total <= 0 };
}

/**
 * Construit la CLÉ INJECTABLE `scope.sciWeight` (fonction du mouvement) pour la vue immeuble.
 * Mémoïsée par mois — un frais est réparti avec les poids du MOIS OÙ IL TOMBE.
 * @param {{lots:Array, immKey:string, duPlein:function}} opts
 * @returns {function(Object):number} (mv) => 0..1
 */
export function buildSciWeightMensuel(opts) {
  const o = opts || {};
  const lots = Array.isArray(o.lots) ? o.lots : [];
  const immKey = _s(o.immKey);
  const duPlein = o.duPlein;
  const cache = new Map();                  // ym → poids 0..1 de immKey
  const poidsDuMois = (ym) => {
    if (cache.has(ym)) return cache.get(ym);
    const p = poidsMensuels(lots, ym, duPlein);
    let w;
    if (!p.repli) w = (p.parImm[immKey] || 0) / p.total;
    else w = p.nbLots > 0 ? (p.nbParImm[immKey] || 0) / p.nbLots : 0;   // repli : nombre de lots
    w = Math.min(1, Math.max(0, w));
    cache.set(ym, w);
    return w;
  };
  const fn = (mv) => {
    const d = _s(mv && mv.date);
    if (!/^\d{4}-\d{2}/.test(d)) return 0;  // frais sans date exploitable : aucun mois → aucun poids
    return poidsDuMois(d.slice(0, 7));
  };
  fn.poidsDuMois = poidsDuMois;             // exposé : infobulle « calcul visible au clic » + tests
  return fn;
}
