// core/loyers-badge.js — CDC-QUITTANCES-IRL D22 / invariant I15 : le CŒUR de comptage de la
// pastille rouge de l'entrée de menu « Loyers ».
//
// Le compteur = EXACTEMENT les lignes ACTIONNABLES de l'écran Loyers :
//   • quittances demandées PRÊTES à éditer (case cochée ET au moins un mois à quittancer),
//   • lots pas à jour (loyer/charges en retard),
//   • révisions à préparer (à-préparer + en-retard).
// N'y entrent JAMAIS : les NON-RÉVISABLES (gelé DPE F/G, bail < 1 an, indice non publié → `muets`)
// ni les révisions PERDUES (prescription art. 17-1 → `perdues`). Rien à y faire, rien à compter.
// 0 → pas de pastille (la surface d'affichage masque la pastille quand le compte est nul).
//
// PUR : aucune lecture DB, aucun DOM — l'appelant (index.html `_lyBadgeCount`) fournit déjà les
// états de lot et les révisions triées, avec les MÊMES calculs que l'écran (jamais une 2ᵉ source).
// Tests : __tests__/helpers/loyers-badge.test.js

/**
 * @param {Array<{demande?:boolean, aQuittancer?:Array, retard?:{enRetard?:boolean}}>} etats
 *        états de lot (sortie de `_lyEtatLot`).
 * @param {{aPreparer?:Array, enRetard?:Array, muets?:Array, perdues?:Array}} rev
 *        révisions triées (sortie de `_lyRevisionsTriees`).
 * @returns {number} le nombre de lignes actionnables (≥ 0). 0 → pas de pastille.
 */
export function loyersBadgeCount(etats, rev) {
  const b = loyersBadgeBreakdown(etats, rev);
  return b.quittances + b.pasAJour + b.revisions;
}

/**
 * Le détail des trois nombres (pour l'info-bulle), issu des mêmes filtres que le compteur.
 * @returns {{quittances:number, pasAJour:number, revisions:number}}
 */
export function loyersBadgeBreakdown(etats, rev) {
  const e = Array.isArray(etats) ? etats : [];
  const r = rev || {};
  const quittances = e.filter(x => x && x.demande && x.aQuittancer && x.aQuittancer.length).length;
  const pasAJour = e.filter(x => x && x.retard && x.retard.enRetard).length;
  // `muets` (gelé/trop-jeune/indice) et `perdues` (prescription) ne sont PAS sommés : ils vivent
  // dans les blocs « non révisables » / « IRL non appliquées », aucun geste demandé ici (I15).
  const revisions = ((r.aPreparer || []).length) + ((r.enRetard || []).length);
  return { quittances, pasAJour, revisions };
}
