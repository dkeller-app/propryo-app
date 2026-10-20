/**
 * core/preserve-fields.js — « aucun champ laissé derrière » (audit BIENS, constats C2 / I5).
 *
 * PROBLÈME DE FOND. Plusieurs modales enregistrent en RECONSTRUISANT l'objet de zéro depuis le
 * formulaire (`const im = { id, nom, adr, … }`), puis en remplaçant l'ancien : `ent.immeubles[i] = im`.
 * Tout champ qui n'a pas d'input dans cette modale disparaît alors SANS TOMBSTONE et SANS UNDO.
 * Vécu : `saveImm` ne reportait pas `compteursCollectifs` — le SEUL stockage des compteurs
 * collectifs, de leurs relevés et de leurs factures. Ouvrir « Modifier l'immeuble » puis
 * enregistrer effaçait toutes les charges communes de l'immeuble. Idem `contenance`,
 * `surfaceTotale`, les tombstones, et côté bailleur `capital` et le tag multi-espace `_espaceId`
 * (un immeuble d'une SCI partagée serait reparti dans le mauvais espace).
 *
 * RÈGLE DU PROJET, appliquée mécaniquement ici : on retire des ÉCRANS, jamais des DONNÉES. Un
 * champ absent du formulaire garde sa valeur. Le correctif est GÉNÉRIQUE volontairement : énumérer
 * les champs à sauver laisse repasser le bug au prochain champ ajouté ailleurs — c'est exactement
 * ce qui s'est produit ici (`_espaceId` était protégé nommément, ses voisins non).
 *
 * Le code inline d'index.html porte un SHADOW IDENTIQUE (file:// ne charge pas les ES modules) —
 * __tests__/helpers/preserve-fields.test.js vérifie la non-divergence.
 */

export function _preserverChampsExistants(reconstruit, existant) {
  if (!reconstruit || typeof reconstruit !== 'object') return reconstruit;
  if (!existant || typeof existant !== 'object') return reconstruit;
  var BAD = ['__proto__', 'constructor', 'prototype'];
  Object.keys(existant).forEach(function (k) {
    if (BAD.indexOf(k) >= 0) return;
    if (Object.prototype.hasOwnProperty.call(reconstruit, k)) return;
    reconstruit[k] = existant[k];
  });
  return reconstruit;
}

/**
 * BAIL — même remède, gaté sur l'ÉDITION. saveBail reconstruit lui aussi son objet depuis le
 * formulaire (getBailDataFromForm) puis remplace l'ancien : `DB.baux[ref] = bail`. Y passaient à
 * la trappe le DOSSIER DE DÉPART complet (bail.depart : congé, date de sortie, motif, avancement)
 * et la RESTITUTION DU DÉPÔT DE GARANTIE (dgRestitueAt — le drapeau lu par toutes les surfaces —,
 * dgDetailRetenues, dgRestitueMontant). Un simple changement de téléphone suffisait.
 *
 * Le gate n'est PAS une commodité. `archiverBail` ne supprime pas DB.baux[ref] au re-bail : il en
 * pousse une copie dans baux_historique et laisse l'ancien bail en place jusqu'à l'écrasement.
 * Préserver sans distinguer ferait donc hériter au bail du NOUVEAU locataire le dossier de départ,
 * la restitution de DG et les signatures de l'ANCIEN. On préserve à l'ÉDITION, jamais à la création.
 * Un bail tombstoné n'est pas non plus une source : on ne ressuscite rien.
 *
 * @param {object} reconstruit objet bail issu du formulaire (il gagne toujours sur ses propres clés)
 * @param {object} existant    DB.baux[ref] avant écriture
 * @param {boolean} isNewBail  true = création / re-bail → aucune préservation
 */
export function _preserverBailExistant(reconstruit, existant, isNewBail) {
  if (isNewBail) return reconstruit;
  if (!existant || typeof existant !== 'object') return reconstruit;
  if (existant._deleted) return reconstruit;
  return _preserverChampsExistants(reconstruit, existant);
}


/**
 * Variante pour les enregistrements où un BLOC DE CODE EN AMONT fait déjà autorité sur
 * quelques clés. Cas vécu : saveMv gère la pièce jointe (`pj` / `pjId`) dans un bloc dédié
 * qui la crée, la remplace ou la retire ; une préservation aveugle ressusciterait la PJ que
 * ce bloc vient de retirer. La règle reste la même pour TOUT LE RESTE : un champ sans input
 * garde sa valeur. Seules les clés pilotées voient leur présence/absence rétablie à l'état
 * décidé par le bloc — la préservation ne le contredit jamais.
 *
 * @param {object} reconstruit objet issu du formulaire
 * @param {object} existant    enregistrement en base avant écriture
 * @param {string[]} champsPilotes clés dont un bloc amont est seul décideur
 */
export function _preserverSaufChampsPilotes(reconstruit, existant, champsPilotes) {
  if (!reconstruit || typeof reconstruit !== 'object') return reconstruit;
  var pilotes = champsPilotes || [];
  var etat = pilotes.map(function (k) {
    return { k: k, present: Object.prototype.hasOwnProperty.call(reconstruit, k), val: reconstruit[k] };
  });
  _preserverChampsExistants(reconstruit, existant);
  etat.forEach(function (e) { if (e.present) reconstruit[e.k] = e.val; else delete reconstruit[e.k]; });
  return reconstruit;
}
