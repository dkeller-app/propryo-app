/**
 * core/fin-occupation.js — LA règle de fin d'occupation d'un bail, PURE et sans dépendance.
 * Module à part pour être importé par tous ses lecteurs du cœur sans cycle d'import (loyer-du-mois,
 * loyer-bareme, anteriorite, legal-bilan) ; loyer-du-mois la ré-exporte (main.js → window).
 */
/**
 * LA fin d'OCCUPATION d'un bail ('' = occupation ouverte) — règle UNIQUE de l'app (décisions Didier 05/10).
 * Lue par le dû (bailsFromRaw → duMois), la régularisation et les compteurs (_bailFinOccupation, inline),
 * le bilan (legal-bilan), le périmètre 2044 (regime-lot, règle injectée), le chapitre d'une correction de
 * barème (loyer-bareme `chapitrePour`) et la date de suivi d'un lot (anteriorite `debutSuiviLot`).
 *   1. `finEffective` (clôture) fait foi ;
 *   2. bail clôturé ou archivé (`clos` = ligne d'historique, ou `cloture`) → sa fin ;
 *   3. bail EN COURS avec un départ déclaré (`depart.dateSortie`, assistant de départ) → la date de sortie
 *      (décision 2 : le loyer dû s'arrête au départ déclaré, avant même la clôture — cf. R0-C Q3) ;
 *   4. sinon OUVERT, quel que soit le type (décision 1 = A) : nu / meublé reconduits tacitement ; étudiant,
 *      mobilité, garage, autre échus non clôturés restent occupés jusqu'à la clôture (alerte « bail échu »).
 * @param {Object} bail
 * @param {boolean} [clos] true pour un bail d'historique (archivé)
 * @returns {string} 'YYYY-MM-DD' ou '' (ouvert)
 */
export function finOccupationBail(bail, clos) {
  if (!bail) return '';
  if (bail.finEffective) return String(bail.finEffective).slice(0, 10);
  const fin = bail.fin ? String(bail.fin).slice(0, 10) : '';
  if (clos || bail.cloture) return fin;
  if (bail.depart && bail.depart.dateSortie) return String(bail.depart.dateSortie).slice(0, 10);
  return '';
}

/**
 * LE statut LOUÉ d'un lot au jour `jourIso` — fonction UNIQUE (décision Didier 06/10).
 * Loué ⇔ son bail courant est vivant, non clôturé (ni `cloture`, ni `finEffective`), et son occupation
 * n'est pas terminée ce jour-là (finOccupationBail vide, ou ≥ jourIso). Un DÉPART DÉCLARÉ PASSÉ rend donc le
 * lot VACANT alors que le bail reste ouvert (« Vacant (départ le …, bail à clôturer) »). Sans départ déclaré,
 * statut identique à l'ancien (bail vivant non clôturé ⇒ loué, échéance contractuelle ignorée).
 * @param {Object} bail bail COURANT du lot (DB.baux[ref]) ou null
 * @param {string} jourIso 'YYYY-MM-DD'
 * @returns {boolean}
 */
export function bailLoueAu(bail, jourIso) {
  if (!bail || bail._deleted || bail.cloture || bail.finEffective) return false;
  const f = finOccupationBail(bail, false);
  return !f || f >= String(jourIso || '').slice(0, 10);
}
