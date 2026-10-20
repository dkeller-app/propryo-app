/**
 * core/mv-create.js — L'API UNIQUE « ajouter un mouvement » (chantier TRAVAUX : QUI PAIE ?).
 *
 * Avant : saveMv(), l'import bancaire (_bankImportConfirm) et la migration des factures de
 * compteurs (_migrateCcFacturesToMouvements) recopiaient chacun la même séquence
 * (horodatage → journal d'audit → push → saveDB → rafraîchissement), avec des variantes.
 * Ce module porte CETTE séquence une seule fois ; chaque appelant déclare ses variantes par
 * options, pour que les enregistrements produits restent identiques octet pour octet
 * (test __tests__/helpers/mv-create-identite.test.js).
 *
 * Il ne CONSTRUIT pas le mouvement (chaque appelant garde sa forme) et ne calcule rien :
 * Finances, la 2044 et la régularisation lisent le mouvement comme tous les autres.
 *
 * Module PUR : les effets passent par `deps` (injection), aucune dépendance DB / DOM.
 *
 * ⚠ Shadow inline IDENTIQUE dans js/app/app-part1.js (`_mvCreateShadow`) : la migration des
 * compteurs tourne au démarrage, avant le chargement de js/main.js. Test de parité dans
 * __tests__/helpers/mv-create.test.js.
 */

/**
 * @param {object} m  le mouvement, déjà construit par l'appelant (muté : horodatage).
 * @param {object} deps
 *   mouvements : le tableau vivant (DB.mouvements)
 *   stamp(m)   : pose _modifiedAt (_stamp de l'app)
 *   auditLog(action, type, id, label) : journal d'audit (facultatif)
 *   saveDB()   : persistance
 *   refresh()  : rafraîchissement des vues (_refreshAfterMutation)
 * @param {object} [opts]
 *   stamp   : true (défaut) | false
 *   audit   : 'before' (défaut) | 'after' | false — position du journal par rapport au push
 *   auditLabel : libellé du journal (défaut : lib || fac || id)
 *   save    : true (défaut) | false
 *   refresh : true (défaut) | false
 * @returns {object} m
 */
export function mvCreate(m, deps, opts) {
  var o = opts || {};
  var d = deps || {};
  var doStamp = o.stamp !== false;
  var audit = (o.audit === undefined) ? 'before' : o.audit;
  var label = (o.auditLabel != null) ? o.auditLabel : (m.lib || m.fac || String(m.id));
  if (doStamp && typeof d.stamp === 'function') d.stamp(m);
  if (audit === 'before' && typeof d.auditLog === 'function') d.auditLog('create', 'mouvement', m.id, label);
  d.mouvements.push(m);
  if (audit === 'after' && typeof d.auditLog === 'function') d.auditLog('create', 'mouvement', m.id, label);
  if (o.save !== false && typeof d.saveDB === 'function') d.saveDB();
  if (o.refresh !== false && typeof d.refresh === 'function') d.refresh();
  return m;
}
