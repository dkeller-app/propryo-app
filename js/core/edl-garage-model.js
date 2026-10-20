/**
 * core/edl-garage-model.js — modèle d'état des lieux RÉDUIT pour un emplacement de droit
 * commun (garage / parking / box / local de stockage). Lot 2 du chantier bail garage.
 * CDC : docs/CDC-EDL-GARAGE.md.
 *
 * Module PUR (ni DOM ni DB). Il répond à « quels éléments constater ? » pour un EDL garage.
 * La liste est la LISTE VALIDÉE par Didier, IDENTIQUE pour toutes les natures : l'utilisateur
 * ajoute (« + Élément ») ou retire (🗑) ce qui ne s'applique pas (moteur EDL existant).
 * « Clé et bip » n'y figure PAS : c'est l'étape « Moyens d'accès » qui les gère.
 */

/** Éléments du constat EDL garage — liste unique, ordre validé. */
export const EDL_GARAGE_ELEMENTS = Object.freeze([
  'Porte', 'Serrure', 'Huisserie', 'Sol', 'Plafond', 'Toiture', 'Éclairage', 'Prise électrique'
]);

/** Libellé du bloc EDL selon la nature (place/box/garage/stockage). Défaut : Box. */
export function garageEdlLabel(nature) {
  switch (nature) {
    case 'place':    return 'Place de stationnement';
    case 'garage':   return 'Garage';
    case 'stockage': return 'Local de stockage';
    case 'box':
    default:         return 'Box';
  }
}

/** Un élément EDL vierge — MÊME forme que le moteur (entrée + sortie), cf edlAddElem. */
function blankElement(nom) {
  return { nom, etatE: '', obsE: '', photosE: [], etatS: '', obsS: '', photosS: [] };
}

/**
 * Construit les « pièces » d'un EDL garage : UN seul bloc, dont les éléments sont la liste
 * validée. Forme = celle attendue par `_edlP` (rendu/persistance inchangés).
 * @param {string} nature  place | box | garage | stockage
 * @returns {Array<{nom:string, elements:Array<object>}>}
 */
export function buildGarageEdlPieces(nature) {
  return [{
    nom: garageEdlLabel(nature),
    elements: EDL_GARAGE_ELEMENTS.map(blankElement)
  }];
}
