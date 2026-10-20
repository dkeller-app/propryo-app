/**
 * core/biens-migration.js — migrations douces du chantier « simplification Biens ».
 *
 * Règle du chantier : on retire des ÉCRANS, jamais des données. Quand deux champs
 * concurrents décrivent la même réalité et qu'un seul survit à l'écran, la valeur de
 * celui qui disparaît est REVERSÉE dans le survivant — jamais effacée.
 *
 * Toutes les fonctions d'ici sont PURES au sens « pas de DB globale, pas de DOM » :
 * elles prennent la collection en argument, la mutent sur place (les objets sont ceux
 * de DB, l'appelant les stampe), et rendent un compte-rendu. Toutes sont IDEMPOTENTES :
 * un second passage ne change rien et rend { migres: 0 }.
 */

/**
 * N° de lot en copropriété — deux champs pour une seule réalité :
 *   • log.lot     — champ historique. A une colonne cloud (js/core/store-mapping.js) et
 *                   alimente la clause de bail « Numéro de lot copropriété ». SURVIVANT.
 *   • log.numLot  — doublon ajouté plus tard, JAMAIS synchronisé (aucune colonne), lu par
 *                   personne. Son input disparaît de la modale (étape 4 du chantier).
 *
 * On reverse numLot dans lot quand lot est vide. On ne touche jamais un lot déjà renseigné
 * (le survivant fait foi) et on ne supprime pas numLot (réversibilité).
 *
 * @param {Array<Object>} logements — DB.logements (mutés sur place)
 * @returns {{migres:number, refs:string[]}}
 */
export function migrerNumLotVersLot(logements) {
  const out = { migres: 0, refs: [] };
  if (!Array.isArray(logements)) return out;
  const rempli = (x) => x !== null && x !== undefined && String(x).trim() !== '';
  for (const log of logements) {
    if (!log || typeof log !== 'object') continue;
    if (rempli(log.lot)) continue;          // le survivant fait foi
    if (!rempli(log.numLot)) continue;      // rien à reverser
    log.lot = String(log.numLot).trim();
    out.migres++;
    out.refs.push(log.ref);
  }
  return out;
}
