/**
 * core/entity-cascade.js — NAV-FILTRE-ENTITE-GLOBAL (Chantier A)
 *
 * Helpers purs (sans DB / DOM) pour la cascade de filtrage
 * Entité → Immeuble → Bien.
 *
 * Règles validées user 2026-05-25 :
 *  - Q1 : reset auto des dropdowns enfants quand le parent change → géré côté
 *    index.html (ces helpers se contentent de recalculer les listes).
 *  - Q2 : l'option « Tous » reste toujours en tête → ajoutée côté index.html
 *    (ces helpers ne renvoient QUE les valeurs réelles, sans le « Tous »).
 *
 * Les logements passés en entrée sont supposés DÉJÀ filtrés (alive + non
 * archivés) par l'appelant. Ces helpers ne font que le filtrage
 * entité/immeuble + l'extraction des listes, en préservant l'ordre d'entrée.
 *
 * Tests Vitest miroir : __tests__/helpers/entity-cascade.test.js
 */

/**
 * Liste des noms d'immeubles concernés par une entité (ou tous si entité vide).
 * Préserve l'ordre d'apparition, dédupliqué.
 *
 * @param {object[]} logements liste de logements (déjà filtrés alive/non archivés)
 * @param {string} [entityName] nom de l'entité active ('' ou undefined = toutes)
 * @returns {string[]} noms d'immeubles distincts
 */
export function _immeublesForEntity(logements, entityName) {
  if (!Array.isArray(logements)) return [];
  const seen = new Set();
  const out = [];
  for (const l of logements) {
    if (!l) continue;
    if (entityName && l.entity !== entityName) continue;
    const imm = l.imm;
    if (!imm || seen.has(imm)) continue;
    seen.add(imm);
    out.push(imm);
  }
  return out;
}

/**
 * Liste des logements dans le périmètre (entité active ∩ immeuble sélectionné).
 * Si entityName ou immName est vide/undefined, le critère correspondant est ignoré.
 *
 * @param {object[]} logements
 * @param {string} [entityName] nom entité active
 * @param {string} [immName] nom immeuble sélectionné
 * @returns {object[]} logements filtrés (préserve l'ordre d'entrée)
 */
export function _logementsForScope(logements, entityName, immName) {
  if (!Array.isArray(logements)) return [];
  return logements.filter(l => {
    if (!l) return false;
    if (entityName && l.entity !== entityName) return false;
    if (immName && l.imm !== immName) return false;
    return true;
  });
}

/**
 * Indique si une valeur de dropdown reste valide dans le nouveau périmètre.
 * Sert à décider du reset (Q1) : si l'immeuble/bien sélectionné n'existe plus
 * dans la liste filtrée, on doit remettre le dropdown à « Tous » ('').
 *
 * @param {string} currentValue valeur actuelle du dropdown ('' = Tous)
 * @param {string[]} validValues valeurs réelles désormais disponibles
 * @returns {string} la valeur à conserver ('' si invalide → reset « Tous »)
 */
export function _resolveDropdownValue(currentValue, validValues) {
  if (!currentValue) return '';
  if (Array.isArray(validValues) && validValues.includes(currentValue)) return currentValue;
  return '';
}

/**
 * Filtre une collection d'items par leur entité, via une fonction d'accès.
 * Générique : sert à brancher les renderers (mouvements, quittances, etc.)
 * sur l'entité active.
 *
 * @param {object[]} items
 * @param {string} entityName entité active ('' = toutes)
 * @param {(item:object)=>string} entityOf accesseur renvoyant l'entité d'un item
 * @returns {object[]}
 */
export function _filterByEntity(items, entityName, entityOf) {
  if (!Array.isArray(items)) return [];
  if (!entityName) return items.slice();
  const fn = (typeof entityOf === 'function') ? entityOf : (x) => x && x.entity;
  return items.filter(it => fn(it) === entityName);
}
