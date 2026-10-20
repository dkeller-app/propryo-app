/**
 * core/finances-window.js — REFONTE FINANCES étape 1 « socle » (CDC-FINANCES § 2).
 *
 * LES DEUX FENÊTRES NOMMÉES de l'onglet Finances. Une seule fenêtre par question, et la
 * question est écrite dans le nom — c'est ce qui empêche le retour des 4 fenêtres
 * concurrentes du constat 33 / C2 (année civile pleine ici, 01/01→aujourd'hui là,
 * projection annualisée ailleurs).
 *
 *   F-1   · FENÊTRE D'EXIGIBILITÉ — « ce qui est DÛ » : retard, recouvrement, relances.
 *           01/01 → dernier mois échu. On ne peut pas être en retard sur un loyer qui
 *           n'est pas encore dû : aucun mouvement ne l'étend, jamais.
 *   F-1 v2· FENÊTRE DE CONSTAT — « ce qui est PASSÉ sur le compte » : loyers encaissés,
 *           charges payées, cash-flow, colonne Année. 01/01 → dernier mois contenant un
 *           mouvement connu. DÉCISION DIDIER « B » : un mouvement POST-DATÉ COMPTE
 *           (« l'argent est déjà là, il ne doit pas être invisible ») — il est aujourd'hui
 *           purement ignoré (`if (!b) return`, constat 26). Les mois non échus sont
 *           comptés MAIS drapeautés `future` pour que l'UI les grise (« à venir »).
 *
 * Le comparatif N-1 s'aligne sur la MÊME étendue de mois que N (`alignPreviousYear`),
 * sinon la variation compare 10 mois à 9.
 *
 * CONVENTION REPRISE DE LA PROD (pas d'invention) : « dernier mois échu » = le MOIS COURANT,
 * exactement comme `_computeFinancesMonthly` (index.html:50891 → finances-monthly.js:52) et
 * comme la table F-1 du CDC (« Tableau P&L + héro : 01/01 → mois courant ✔ »). La tolérance
 * de début de mois (< 10, constat 45) est portée par `graceLast`, calculée avec la MÊME
 * constante `_LOYER_TOLERANCE_JOUR` que le suivi des loyers (aucune duplication).
 *
 * PUR : aucune lecture de DB, aucun DOM, `today` toujours injectable.
 * Tests : __tests__/helpers/finances-window.test.js
 */

import { _LOYER_TOLERANCE_JOUR, _loyerTodayLocal } from './loyer-statut.js';
import { inScope as _mvDansScope } from './finances-scope.js';
import { MOIS_FR } from './utils.js';

export const WINDOW_KIND = { CONSTAT: 'constat', EXIGIBILITE: 'exigibilite' };

// CONTRAT DE LA FENÊTRE VIDE (`empty: true`, `lastMonth: 0`) : depuis l'étape 2, le moteur
// mensuel qui reçoit une FENÊTRE clampe à 0 et produit ZÉRO mois (plus de promotion 0→1 —
// elle ne subsiste que sur le chemin historique sans fenêtre). L'appelant court-circuite
// quand même pour afficher un état vide plutôt qu'un tableau creux. Test « fenêtre vide ».

// Date du jour en ISO LOCAL, jamais toISOString() : en UTC, le 1er du mois avant ~2 h fait
// perdre un mois à la fenêtre, et le 1er janvier fait basculer l'exercice en cours en
// « à venir » (fenêtre VIDE). Le projet a déjà tranché ce piège — on réutilise sa fonction.
const _today = (v) => (v ? String(v).slice(0, 10) : _loyerTodayLocal());
const _ym = (year, mo) => String(year) + '-' + String(mo).padStart(2, '0');
const _dernierJour = (year, mo) => new Date(Number(year), Number(mo), 0).getDate();

/**
 * Dernier mois ÉCHU de l'exercice — le socle des deux fenêtres.
 * Exercice clos → 12 · exercice en cours → mois courant · exercice à venir → 0 (rien n'est
 * échu ; la fenêtre est alors vide et le DIT, plutôt que d'afficher 12 mois fantômes).
 */
function _dernierMoisEchu(year, todayIso) {
  const t = _today(todayIso);
  const y = _annee(year), curY = Number(t.slice(0, 4));
  if (!y) return 0;                          // exercice non numérique → fenêtre vide, pas de NaN
  if (y < curY) return 12;
  if (y > curY) return 0;
  return parseInt(t.slice(5, 7), 10);
}

/** Exercice valide (année sur 4 chiffres) ou 0. */
function _annee(year) {
  const y = Number(year);
  return (Number.isInteger(y) && y >= 1000 && y <= 9999) ? y : 0;
}

/**
 * Normalise un « périmètre » en PRÉDICAT UNAIRE `(mv) => bool`.
 *
 * Garde-fou d'arité (audit I2) : `finances-scope.inScope` est BINAIRE `(scope, mv)`. Le geste
 * naturel — la passer ici telle quelle — la faisait appeler avec un seul argument : `mv`
 * devenait `undefined`, tout mouvement sortait du périmètre, et la fenêtre de constat cessait
 * SILENCIEUSEMENT de voir les post-datés (l'exact contraire de la décision « B »).
 * On accepte donc l'OBJET scope (forme recommandée) et on refuse bruyamment la fonction
 * binaire, plutôt que de renvoyer un chiffre faux.
 *
 * @param {Object|function|null} perimetre scope de finances-scope, ou prédicat unaire
 * @returns {function|null}
 */
function _filtrePerimetre(perimetre) {
  if (!perimetre) return null;
  if (typeof perimetre === 'object') return (mv) => _mvDansScope(perimetre, mv);
  if (typeof perimetre !== 'function') return null;
  if (perimetre.length >= 2) {
    throw new TypeError(
      'finances-window : périmètre invalide — une fonction binaire (scope, mv) a été reçue. '
      + "Passe l'OBJET scope (resolveScope(...)), pas finances-scope.inScope.");
  }
  return perimetre;
}

/**
 * Dernier mois de l'exercice contenant un mouvement CONNU (tombstones exclus, périmètre
 * respecté). 0 = aucun. Exposé : la fenêtre de constat en dépend entièrement.
 * @param {Array} mouvements DB.mouvements
 * @param {number|string} year exercice
 * @param {Object|function} [perimetre] scope de finances-scope (recommandé) ou prédicat
 *        unaire — un mouvement post-daté HORS périmètre ne doit pas étendre la fenêtre.
 *        Un mouvement à montant nul (cr=0 ET db=0) ne compte pas : il n'apporte aucun argent.
 */
export function lastMovementMonth(mouvements, year, perimetre) {
  const inScope = _filtrePerimetre(perimetre);
  const yr = String(year);
  let last = 0;
  (Array.isArray(mouvements) ? mouvements : []).forEach((mv) => {
    if (!mv || mv._deleted) return;
    const d = String(mv.date || '');
    if (!/^\d{4}-\d{2}/.test(d) || d.slice(0, 4) !== yr) return;
    const mo = parseInt(d.slice(5, 7), 10);
    if (!(mo >= 1 && mo <= 12)) return;
    // M4 : une ligne a montant NUL n'est pas « de l'argent deja la ». Elle ouvrirait a elle
    // seule une colonne de mois vide — et, avant le contrat A1, un mois de retard avec.
    if (!(Number(mv.cr) || 0) && !(Number(mv.db) || 0)) return;
    if (typeof inScope === 'function' && !inScope(mv)) return;
    if (mo > last) last = mo;
  });
  return last;
}

/** Assemble une fenêtre à partir de ses deux bornes de mois. */
function _makeWindow(kind, year, todayIso, lastMonth, dueMonth, extra) {
  const y = _annee(year);
  const last = y ? Math.max(0, Math.min(12, lastMonth | 0)) : 0;
  const due = Math.max(0, Math.min(12, dueMonth | 0));
  const months = [];
  for (let mo = 1; mo <= last; mo++) months.push({ ym: _ym(y, mo), mo, future: mo > due });
  const win = Object.assign({
    kind, year: y, today: _today(todayIso),
    lastMonth: last, dueMonth: due,
    fromYm: last ? _ym(y, 1) : '',
    toYm: last ? _ym(y, last) : '',
    months, nbMois: last, empty: last === 0,
    graceLast: false, aligned: false, label: ''
  }, extra || {});
  win.label = windowLabel(win);
  return win;
}

/**
 * F-1 · FENÊTRE D'EXIGIBILITÉ — ce qui est DÛ (retard, recouvrement, relances).
 * Aucun mouvement ne l'étend : le dénominateur du recouvrement suit cette fenêtre, donc un
 * encaissement anticipé ne peut plus faire dépasser 100 %.
 * @param {{year:number|string, today?:string}} input
 */
export function computeExigibiliteWindow(input) {
  const i = input || {};
  const t = _today(i.today);
  const last = _dernierMoisEchu(i.year, t);
  // Tolérance de début de mois : le loyer du mois courant non encore payé n'est pas un
  // « retard » avant le 10 (parité Suivi des loyers, constat 45).
  const graceLast = last > 0
    && Number(i.year) === Number(t.slice(0, 4))
    && last === parseInt(t.slice(5, 7), 10)
    && parseInt(t.slice(8, 10), 10) < _LOYER_TOLERANCE_JOUR;
  return _makeWindow(WINDOW_KIND.EXIGIBILITE, i.year, t, last, last, { graceLast });
}

/**
 * F-1 v2 · FENÊTRE DE CONSTAT — ce qui est PASSÉ sur le compte (décision « B »).
 * S'étend jusqu'au dernier mois contenant un mouvement, mois non échus compris ; ceux-ci
 * portent `future: true` (l'UI les grise et les marque « à venir » — l'utilisateur doit
 * voir d'où vient le dépassement, pas le subir).
 * @param {{year:number|string, today?:string, mouvements?:Array, scope?:Object,
 *          filtreMouvement?:function}} input `scope` = sortie de resolveScope (recommandé).
 */
export function computeConstatWindow(input) {
  const i = input || {};
  const t = _today(i.today);
  const due = _dernierMoisEchu(i.year, t);
  const perimetre = i.scope || i.filtreMouvement || i.inScope;
  const last = Math.max(due, lastMovementMonth(i.mouvements, i.year, perimetre));
  return _makeWindow(WINDOW_KIND.CONSTAT, i.year, t, last, due);
}

/**
 * Fenêtre N-1 alignée sur la MÊME étendue de mois que N (T-2 / F-1 v2) — sinon la variation
 * compare 10 mois à 9. L'exercice N-1 étant clos, aucun de ses mois n'est « à venir ».
 * @param {Object} win fenêtre N
 * @returns {Object|null}
 */
export function alignPreviousYear(win) {
  if (!win) return null;
  return _makeWindow(win.kind, Number(win.year) - 1, win.today, win.lastMonth, win.lastMonth,
    { aligned: true, graceLast: false });
}

/** `true` si le mois (ym ou numéro) est compté mais non échu — colonne à griser. */
export function isFutureMonth(win, mois) {
  if (!win) return false;
  let mo;
  if (typeof mois === 'number') mo = mois;
  else {
    const s = String(mois);
    // Un 'YYYY-MM' d'un AUTRE exercice n'est pas « à venir » dans cette fenêtre : il n'y est
    // simplement pas.
    if (/^\d{4}-\d{2}/.test(s)) {
      if (Number(s.slice(0, 4)) !== win.year) return false;
      mo = parseInt(s.slice(5, 7), 10);
    } else mo = parseInt(s, 10);
  }
  return !!mo && mo > win.dueMonth && mo <= win.lastMonth;
}

/**
 * Libellé prêt à afficher — la fenêtre effective est écrite en clair en haut de page (F-1),
 * jamais devinée par l'utilisateur.
 *   constat en cours  → « Exercice 2026 · tout ce qui est saisi au 13/09 »
 *   constat clos      → « Exercice 2025 · année complète »
 *   exigibilité       → « du 01/01 au 30 septembre 2026 · 9 mois »
 *   N-1 aligné        → « 2025 · même période (10 mois) »
 */
export function windowLabel(win) {
  if (!win) return '';
  if (win.aligned) return win.empty ? win.year + ' · aucun mois' : `${win.year} · même période (${win.nbMois} mois)`;
  if (win.kind === WINDOW_KIND.CONSTAT) {
    if (win.empty) return `Exercice ${win.year} · rien de saisi`;
    // « année complète » ne vaut que pour un exercice CLOS : en décembre de l'exercice en
    // cours, lastMonth vaut 12 alors que le mois n'est pas fini — le libellé mentirait.
    if (win.lastMonth === 12 && win.year < Number(String(win.today).slice(0, 4))) {
      return `Exercice ${win.year} · année complète`;
    }
    const t = String(win.today);
    return `Exercice ${win.year} · tout ce qui est saisi au ${t.slice(8, 10)}/${t.slice(5, 7)}`;
  }
  if (win.empty) return 'aucun mois échu';
  const mo = win.lastMonth;
  return `du 01/01 au ${_dernierJour(win.year, mo)} ${MOIS_FR[mo - 1]} ${win.year} · ${win.nbMois} mois`;
}
