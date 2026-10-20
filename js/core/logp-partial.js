/**
 * P0-1 (chantier BIENS) — merge PARTIEL par chemin pointé + push du loyer de référence.
 *
 * Pourquoi : _logpReadFromForm() lisait tout le formulaire logement par el(id) et
 * renvoyait '' / false quand l'input n'existait pas dans le DOM ; saveParamLog
 * réaffectait ensuite sans condition. Retirer ou déplacer un pane effaçait donc en
 * silence log.presentation, log.quartier, log.locationInfo, log.dgRef, log.irlRef —
 * et imm.equipementsCommuns de l'immeuble parent, réécrit à chaque enregistrement
 * d'un logement (fil rouge de création compris, qui enchaîne les créations).
 *
 * Contrat : `partial` est une carte { 'chemin.pointe': valeur }. Une clé ABSENTE
 * signifie « champ non présent dans le DOM » → la valeur stockée n'est pas touchée.
 * Une clé présente écrase (une case décochée doit bien passer à false).
 * Les segments dangereux (__proto__ / constructor / prototype) sont ignorés.
 *
 * LIMITE CONNUE (audit 14/08) : la granularité de _logpReadFromForm est celle du GROUPE
 * (cuisine, sanitaires, technologies, quartier.transports, garanties…), pas du champ.
 * Sortir UNE case d'un de ces groupes du DOM remettrait les autres du groupe à false.
 * Un groupe se déplace donc en ENTIER — c'est ce que vérifie le test « inventaire des
 * clés » de __tests__/helpers/logp-partial.test.js.
 *
 * Le code inline de index.html porte un SHADOW IDENTIQUE de ces fonctions (file://
 * ne charge pas les ES modules) — le test logp-partial.test.js vérifie la non-divergence.
 */

export function _logpApplyPartial(target, partial) {
  if (!target || typeof target !== 'object') return target;
  if (!partial || typeof partial !== 'object') return target;
  var BAD = ['__proto__', 'constructor', 'prototype'];
  Object.keys(partial).forEach(function (path) {
    var val = partial[path];
    if (val === undefined) return;
    var segs = String(path).split('.').filter(Boolean);
    if (!segs.length) return;
    if (segs.some(function (s) { return BAD.indexOf(s) >= 0; })) return;
    var node = target;
    for (var i = 0; i < segs.length - 1; i++) {
      var s = segs[i];
      if (!node[s] || typeof node[s] !== 'object' || Array.isArray(node[s])) node[s] = {};
      node = node[s];
    }
    node[segs[segs.length - 1]] = val;
  });
  return target;
}

/**
 * LOYER-REFERENCE — bien VACANT : le loyer de référence saisi dans la modale EST le loyer
 * courant du bien (lu par la fiche, le candidat, l'invitation, le prochain bail). On tient
 * donc log.hc/ch/dg == loyer de référence. Bien OCCUPÉ : le bail pilote log.hc/ch (+ IRL),
 * on n'y touche pas.
 *
 * P0-1 : ne pousse QUE les valeurs dont le champ était réellement dans le formulaire
 * (clé présente dans `partial`) — sinon déplacer ces inputs recalculerait log.hc/ch/dg
 * depuis des valeurs qui n'ont pas été éditées.
 *
 * irlRef est volontairement absent : l'IRL ne pilote ni hc, ni ch, ni dg (audit M1).
 *
 * @returns {boolean} true si au moins une valeur a été poussée → l'appelant re-score les candidats.
 */
export function _logpPushLoyerRef(log, partial, occupe) {
  if (!log || typeof log !== 'object') return false;
  if (!partial || typeof partial !== 'object') return false;
  if (occupe) return false;
  var has = function (k) { return Object.prototype.hasOwnProperty.call(partial, k); };
  var rempli = function (x) { return x !== null && x !== undefined && String(x).trim() !== ''; };
  var pousse = false;
  if (has('loyerHcRef') && rempli(log.loyerHcRef)) { log.hc = Number(log.loyerHcRef) || 0; pousse = true; }
  if (has('chargesRef') && rempli(log.chargesRef)) { log.ch = Number(log.chargesRef) || 0; pousse = true; }
  if (has('dgRef') && rempli(log.dgRef)) { log.dg = Number(log.dgRef) || 0; pousse = true; }
  return pousse;
}
