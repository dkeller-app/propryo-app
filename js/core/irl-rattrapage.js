/**
 * core/irl-rattrapage.js — IRL-RATTRAPAGE (v15.778, GO Didier 23/10/2026).
 *
 * LE PROBLÈME : l'agenda crée un rappel « Révision IRL » par lot et par année (agendaAutoSync), mais
 * AUCUN code ne le ferme quand la révision est appliquée, renoncée ou sans objet. Résultat mesuré sur
 * le compte réel : 69 rappels « en retard » à vie, dont une série du 01/01/2025 à « 660 j de retard »,
 * sans qu'on sache si le loyer a été révisé (l'argent est bon, l'agenda ment) ou non (révision perdue).
 *
 * CE MODULE classe chaque rappel dans l'un de six états et dit, pour chacun, si l'agenda peut le fermer
 * tout seul (décision 3 : fermeture automatique, réversible par « Rouvrir ») :
 *   · deja      — la révision A ÉTÉ appliquée au loyer : l'agenda ment. Fermé.
 *   · renoncee  — renoncée pour ce cycle. Fermé.
 *   · averifier — effet atteint mais loyer non à jour (IRL-MOTEUR v15.776) : DÉCISION à prendre. Ouvert.
 *   · areviser  — cycle encore dans son année : révision applicable aujourd'hui. Ouvert.
 *   · eteint    — cycle non réclamé dans l'année (art. 17-1, loi du 6 juillet 1989) : plus réclamable au
 *                 passé. Fermé, avec mention ; applicable pour l'AVENIR reste possible, le manque à
 *                 gagner reste visible dans « IRL non appliquées ».
 *   · muet      — non révisable (gel DPE, bail < 1 an, indice non publié) : ni compté ni fermé.
 *
 * ZÉRO CALCUL D'ARGENT ICI : les montants (gain mensuel, ancien/nouveau loyer) viennent du moteur
 * (computeIRLRevision, nouveauLoyerIrl, barème) et sont injectés. Pur / testable.
 * Tests : __tests__/helpers/irl-rattrapage.test.js
 */

const _ymd = (v) => String(v == null ? '' : v).slice(0, 10);
const _ok = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(_ymd(iso));
const _frDate = (iso) => { const s = _ymd(iso); return _ok(s) ? s.split('-').reverse().join('/') : ''; };

/** LES SIX ÉTATS d'un rappel de révision IRL, avec leur comportement d'agenda. */
export const ETATS_RATTRAPAGE = ['deja', 'renoncee', 'averifier', 'areviser', 'eteint', 'muet'];

/** Un cycle est-il éteint à la date du jour ? Non réclamé dans l'année = plus réclamable (art. 17-1). */
export function cycleEteint(cycleIso, todayIso) {
  if (!_ok(cycleIso) || !_ok(todayIso)) return false;
  const lim = new Date(_ymd(cycleIso) + 'T00:00:00');
  lim.setFullYear(lim.getFullYear() + 1);
  const limIso = lim.getFullYear() + '-' + String(lim.getMonth() + 1).padStart(2, '0') + '-' + String(lim.getDate()).padStart(2, '0');
  return _ymd(todayIso) >= limIso;
}

/**
 * L'état d'un rappel de révision IRL, à partir de FAITS déjà résolus par le moteur.
 * @param {Object} f
 *   @param {string} f.cycleIso      date de révision du cycle ('AAAA-MM-JJ')
 *   @param {string} f.todayIso
 *   @param {Object|null} f.entree    entrée du journal qui couvre ce cycle, ou null
 *     { action?, pendingApply?, appliedAt?, date?, nouveauHC?, ancienHC?, dateEffet? }
 *   @param {boolean} [f.aVerifier]   l'entrée est « à vérifier » (IrlRevision, IRL-MOTEUR)
 *   @param {boolean} [f.reclamable]  computeIRLRevision dit le cycle encore applicable (dans l'année)
 *   @param {boolean} [f.muet]        lot non révisable (gel / bail < 1 an / indice / mobilité)
 *   @param {number|null} [f.gainMensuel] gain mensuel de ce cycle (moteur), ou null
 * @returns {{etat:string, ferme:boolean, actionnable:boolean, gainMensuel:number|null}}
 *   ferme : l'agenda peut fermer ce rappel tout seul ; actionnable : demande une décision du propriétaire.
 */
export function etatRappelIrl(f) {
  const i = f || {};
  const g = (typeof i.gainMensuel === 'number' && isFinite(i.gainMensuel)) ? i.gainMensuel : null;
  if (!_ok(i.cycleIso) || !_ok(i.todayIso)) return { etat: 'muet', ferme: false, actionnable: false, gainMensuel: null };
  const h = i.entree;
  if (h) {
    if (h.action === 'renonciation') return { etat: 'renoncee', ferme: true, actionnable: false, gainMensuel: null };
    if (h.pendingApply && i.aVerifier) return { etat: 'averifier', ferme: false, actionnable: true, gainMensuel: g };
    // appliquée, ou en attente cohérente (le moteur l'appliquera au boot) : l'agenda peut fermer.
    return { etat: 'deja', ferme: true, actionnable: false, gainMensuel: null };
  }
  if (i.muet) return { etat: 'muet', ferme: false, actionnable: false, gainMensuel: null };
  if (i.reclamable) return { etat: 'areviser', ferme: false, actionnable: true, gainMensuel: g };
  // Aucune entrée, pas réclamable : cycle ÉTEINT seulement s'il est réellement PASSÉ depuis plus d'un an
  // (art. 17-1). Un cycle encore à venir, ou non encore échu, ne se ferme PAS (relecture adverse 🔴1 : sans
  // cette garde, les rappels des années futures étaient fermés à tort avec « délai d'un an dépassé »).
  if (cycleEteint(i.cycleIso, i.todayIso)) return { etat: 'eteint', ferme: true, actionnable: false, gainMensuel: g };
  return { etat: 'muet', ferme: false, actionnable: false, gainMensuel: null };
}

/**
 * Le compte et les totaux d'une liste de rappels classés (pour le bandeau de l'écran de rattrapage).
 * @param {Array<{etat:string, gainMensuel:number|null}>} items
 * @returns {{total:number, parEtat:Object, actionnables:number, recuperable:number, perdu:number}}
 *   recuperable : gain mensuel qu'on gagnerait en appliquant aujourd'hui (à réviser + éteints, applicables
 *   pour l'avenir) ; perdu : gain mensuel des cycles éteints (passé non rattrapable). Au centime.
 */
export function trierRattrapage(items) {
  const list = Array.isArray(items) ? items : [];
  const parEtat = {};
  ETATS_RATTRAPAGE.forEach((e) => { parEtat[e] = 0; });
  let recuperable = 0, perdu = 0, actionnables = 0;
  for (const it of list) {
    if (!it || !parEtat.hasOwnProperty(it.etat)) continue;
    parEtat[it.etat]++;
    const g = (typeof it.gainMensuel === 'number' && isFinite(it.gainMensuel)) ? it.gainMensuel : 0;
    if (it.etat === 'areviser') recuperable += g;
    if (it.etat === 'eteint') { recuperable += g; perdu += g; }
    if (it.actionnable) actionnables++;
  }
  return {
    total: list.filter((x) => x && parEtat.hasOwnProperty(x.etat)).length,
    parEtat, actionnables,
    recuperable: Math.round(recuperable * 100) / 100,
    perdu: Math.round(perdu * 100) / 100
  };
}

/**
 * La note d'un rappel fermé (agenda) et le texte « ce qui changerait » (rattrapage), ton neutre.
 * @param {string} etat
 * @param {Object} f faits (cycleIso, entree, gainMensuel, reclamableTexte?)
 * @param {(n:number)=>string} [fmt] formateur de montant
 */
export function noteRattrapage(etat, f, fmt) {
  const i = f || {};
  const F = typeof fmt === 'function' ? fmt : (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' €';
  const h = i.entree || {};
  const g = (typeof i.gainMensuel === 'number' && isFinite(i.gainMensuel)) ? i.gainMensuel : null;
  const plus = g != null && g > 0 ? ` (+${F(g)}/mois)` : '';
  switch (etat) {
    case 'deja':
      return `Révision appliquée au loyer${_ok(h.appliedAt) ? ' le ' + _frDate(h.appliedAt) : ''}${h.nouveauHC != null ? ' (' + F(h.nouveauHC) + ')' : ''}. Rappel fermé automatiquement.`;
    case 'renoncee':
      return `Révision renoncée${_ok(h.date) ? ' le ' + _frDate(h.date) : ''} : loyer maintenu. Rappel fermé automatiquement.`;
    case 'eteint':
      return `Délai d'un an dépassé (article 17-1, loi du 6 juillet 1989) : ce cycle ne peut plus être réclamé au passé. Rappel fermé ; le manque à gagner${plus} reste visible dans « IRL non appliquées ». Reste possible : réviser à partir d'aujourd'hui.`;
    case 'areviser':
      return `Cycle encore dans son année : révision applicable à partir d'aujourd'hui${plus}, jamais rétroactive.`;
    case 'averifier':
      return `Le loyer a changé depuis la validation : le loyer du bail n'a pas été mis à jour. Décider depuis Loyers › Révisions.`;
    default:
      return '';
  }
}
