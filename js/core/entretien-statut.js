/**
 * core/entretien-statut.js — Lot 0 KPI (CDC-KPI §3.1/§3.2).
 *
 * LE STATUT D'ENTRETIEN D'UN LOT, lu sur TOUTES les obligations qui le concernent.
 *
 * Remplaçait la branche `chauffage` de `_pilStatutDoc` (supprimé le 16/10 avec l’ancienne matrice), qui plantait :
 *   1. elle traitait `DB.equipements[ref]` comme un TABLEAU (`.find`) alors que c'est un
 *      OBJET indexé par clé de règle → `TypeError: eq.find is not a function` dès qu'un
 *      entretien est enregistré ;
 *   2. elle filtrait par `/chaud|chauff/i` → 8 obligations sur 12 (ramonages, poêles,
 *      clim/PAC) invisibles ;
 *   3. elle lisait `dernierControle` au lieu de `lastDate` (le vrai champ écrit par l'écran
 *      Équipements) → toujours `absent`.
 *
 * Module PUR : reçoit les règles par injection (`EQUIP_RULES` vit dans le monolithe). Aucune
 * dépendance au DOM, à DB, ni à l'horloge — `today` est passé.
 *
 * Forme des données d'un lot (écran Équipements, index.html:50640) :
 *   equipData = { CHAUDIERE_GAZ: { lastDate:'2025-03-14', interv, notes }, ... }
 *
 * Statut rendu (mêmes verdicts que la matrice de conformité, CDC §2.5) :
 *   'na'  aucune obligation ne concerne ce lot
 *   'ok'  toutes les obligations applicables sont à jour
 *   'wn'  au moins un contrôle dépassé (l'équipement existe, l'entretien a pris du retard)
 *   'ko'  au moins une obligation JAMAIS contrôlée
 * Pire verdict l'emporte : ko > wn > ok.
 */

const _MS_JOUR = 86400000;

/** Date d'échéance = dernier contrôle + intervalle de la règle (années OU mois). */
function _echeance(lastDate, rule) {
  const d = new Date(lastDate + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  if (rule.intervalMonths) d.setMonth(d.getMonth() + rule.intervalMonths);
  else d.setFullYear(d.getFullYear() + (rule.intervalYears || 1));
  return d;
}

/**
 * @param {Object}   input
 * @param {Object}   input.equipData  { <ruleKey>: { lastDate, ... } } — peut être {} ou absent
 * @param {Array}    input.rules      EQUIP_RULES injecté (chaque règle : { key, condFn, intervalYears?, intervalMonths?, rappels? })
 * @param {Object}   input.bail       le bail (passé à condFn)
 * @param {Object}   input.log        le logement (passé à condFn — porte log.chauffage.*)
 * @param {Date}     [input.today]    horloge injectée (défaut : maintenant)
 * @param {number}   [input.graceDays=31] tolérance après échéance avant de passer 'wn' (défaut ~1 mois)
 * @returns {{statut:'na'|'ok'|'wn'|'ko', applicables:number, enRetard:number,
 *            jamaisControle:number, pireRetardJours:number, detail:Array}}
 */
export function computeEntretienStatut(input) {
  const i = input || {};
  const equipData = (i.equipData && typeof i.equipData === 'object') ? i.equipData : {};
  const rules = Array.isArray(i.rules) ? i.rules : [];
  const bail = i.bail || null;
  const log = i.log || null;
  const today = i.today instanceof Date ? i.today : new Date();
  const grace = (i.graceDays == null ? 31 : i.graceDays) * _MS_JOUR;

  let applicables = 0, enRetard = 0, jamais = 0, pireRetard = 0;
  const detail = [];

  rules.forEach((rule) => {
    if (!rule || typeof rule.condFn !== 'function') return;
    // Règle « info seule » (rappels vide) : cohérent avec l'agenda, elle ne fait pas alerte.
    if (Array.isArray(rule.rappels) && rule.rappels.length === 0) return;
    let applicable;
    try { applicable = !!rule.condFn(bail, log); } catch (e) { applicable = false; }
    if (!applicable) return;
    applicables++;

    const entry = equipData[rule.key];
    const lastDate = entry && entry.lastDate;
    if (!lastDate) { jamais++; detail.push({ key: rule.key, statut: 'ko' }); return; }

    const ech = _echeance(lastDate, rule);
    if (!ech) { jamais++; detail.push({ key: rule.key, statut: 'ko' }); return; }
    const retardMs = today.getTime() - (ech.getTime() + grace);
    if (retardMs > 0) {
      enRetard++;
      const j = Math.floor(retardMs / _MS_JOUR);
      if (j > pireRetard) pireRetard = j;
      detail.push({ key: rule.key, statut: 'wn', retardJours: j });
    } else {
      detail.push({ key: rule.key, statut: 'ok' });
    }
  });

  let statut;
  if (applicables === 0) statut = 'na';
  else if (jamais > 0) statut = 'ko';
  else if (enRetard > 0) statut = 'wn';
  else statut = 'ok';

  return { statut, applicables, enRetard, jamaisControle: jamais, pireRetardJours: pireRetard, detail };
}
