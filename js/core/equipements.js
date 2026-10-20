/**
 * core/equipements.js — EQUIP-CONTROLES-PERIODIQUES v15.08 Sprint 9 V1.1
 *
 * Helpers purs (sans DB / DOM) pour la gestion des équipements à entretien
 * périodique à charge LOCATAIRE (décret 87-712 + 2009-649 + arrêtés).
 *
 * Tests Vitest miroir : __tests__/helpers/equipements.test.js
 */

/**
 * Calcule la date ISO de la prochaine échéance d'entretien à partir de la
 * dernière intervention et de la règle (intervalYears ou intervalMonths).
 * Approche string-based pour éviter le bug timezone setMonth (cf diagnostics).
 * @param {object} rule { intervalYears?: number, intervalMonths?: number }
 * @param {string} lastDateIso 'YYYY-MM-DD'
 * @returns {string|null} prochaine date ISO ou null si entrée invalide
 */
export function _calculerProchainControle(rule, lastDateIso) {
  if (!rule || !lastDateIso) return null;
  const m = String(lastDateIso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  let y = parseInt(m[1], 10);
  let mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const years = rule.intervalYears || 0;
  const months = rule.intervalMonths || (years ? 0 : 12);
  y += years;
  mo += months;
  while (mo > 12) { mo -= 12; y += 1; }
  while (mo < 1)  { mo += 12; y -= 1; }
  return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

/**
 * Génère la liste des items pour la clause bail "entretien locataire" (article 11.1 bis).
 * @param {object} log — logement avec champ optionnel `equipements`
 * @param {object} bail — bail avec champs `chauffXxx`
 * @returns {string[]} items textuels
 */
export function _buildClauseEntretienItems(log, bail) {
  if (!log) return [];
  const eq = log.equipements || {};
  const items = [];
  if (bail && (bail.chauffGaz || bail.chauffFioul || bail.chauffBois || bail.chauffPoeleBois || bail.chauffPoeleGran || bail.chauffInsert)) {
    items.push("Entretien annuel du système de chauffage (chaudière, poêle, insert) confié à un professionnel qualifié — décret 2009-649 et arrêtés associés. Un justificatif daté et signé sera remis au BAILLEUR.");
  }
  if ((bail && (bail.chauffFioul || bail.chauffBois || bail.chauffPoeleBois || bail.chauffPoeleGran || bail.chauffInsert || bail.chauffCheminee)) || eq.conduitFumee) {
    items.push("Ramonage annuel du conduit de fumée par un professionnel qualifié (Règlement Sanitaire Départemental). Certains arrêtés préfectoraux imposent une fréquence biannuelle.");
  }
  if (eq.ecsType === 'gaz') {
    items.push("Entretien annuel du chauffe-eau gaz (décret 2009-649).");
  } else if (eq.ecsType === 'thermodynamique') {
    items.push("Entretien annuel du chauffe-eau thermodynamique (fluide frigorigène).");
  }
  if (eq.climEte && Number(eq.climEtePuissance) >= 12) {
    items.push("Inspection biennale de la climatisation > 12 kW (décret 2010-349).");
  }
  if (eq.citerneFioul) {
    items.push("Contrôle et nettoyage quinquennal de la citerne fioul individuelle (arrêté 1er juillet 2004).");
  }
  if (eq.vmcType === 'individuelle') {
    items.push("Nettoyage régulier des bouches de ventilation mécanique contrôlée (RSDD).");
  }
  return items;
}

/**
 * Indique si un statut DAAF (saisi via wizard EDL) signifie "présent et utilisable".
 * Utile pour les alertes / contrôles légaux post-incendie.
 */
export function _isDaafCovered(daafStatutOrLog) {
  if (!daafStatutOrLog) return false;
  // accept either a string ('present'|'defaut'|'absent') or a log with equipements.daafPresent
  if (typeof daafStatutOrLog === 'string') {
    return daafStatutOrLog === 'present';
  }
  if (typeof daafStatutOrLog === 'object') {
    const eq = daafStatutOrLog.equipements || {};
    return eq.daafPresent === true;
  }
  return false;
}
