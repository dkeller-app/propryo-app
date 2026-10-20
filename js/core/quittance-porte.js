/**
 * core/quittance-porte.js — quel lot ouvre l'éditeur de quittance (« Faire une quittance »).
 *
 * Retours du 15/10/2026 (lot 1, point 5) — sur un logement d'un bailleur en NOM PROPRE, avec une SCI
 * choisie dans le filtre d'entité en haut à gauche, « Faire une quittance » affichait la quittance de la
 * SCI. Reproduit en Chrome : _openFaireQuittance(ref) ne cherchait le lot demandé que parmi les lots du
 * FILTRE d'affichage ; absent, il ouvrait en silence le PREMIER lot de la SCI (autre lot, autre locataire,
 * autre bailleur). Le document, lui, portait bien le bailleur de son bail : c'était le mauvais lot.
 *
 * Règle : un lot DEMANDÉ s'ouvre s'il a un bail, quel que soit le filtre (le filtre ne restreint que la
 * liste de la porte globale) ; un lot demandé sans bail ne se remplace jamais par un autre.
 * Pur. Tests : __tests__/helpers/quittance-porte.test.js
 */

/**
 * @param {{ref?:string, lotsPerimetre:string[], lotsQuittancables:string[]}} input
 *   lotsPerimetre : refs quittançables DANS le filtre d'entité (liste de la porte globale) ;
 *   lotsQuittancables : refs quittançables de tout le parc.
 * @returns {{ok:true, ref:string, horsPerimetre:boolean} | {ok:false, motif:'sans-bail'|'aucun-bail'|'perimetre-vide'}}
 */
export function lotQuittanceAOuvrir(input) {
  const i = input || {};
  const per = Array.isArray(i.lotsPerimetre) ? i.lotsPerimetre : [];
  const tous = Array.isArray(i.lotsQuittancables) ? i.lotsQuittancables : [];
  const ref = i.ref == null ? '' : String(i.ref);
  if (ref) {
    if (tous.includes(ref)) return { ok: true, ref, horsPerimetre: !per.includes(ref) };
    return { ok: false, motif: 'sans-bail' };
  }
  if (per.length) return { ok: true, ref: per[0], horsPerimetre: false };
  return { ok: false, motif: tous.length ? 'perimetre-vide' : 'aucun-bail' };
}
