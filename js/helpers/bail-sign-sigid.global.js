/**
 * bail-sign-sigid.global.js — Wrapper browser (window.BailSignSigid)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/bail-sign-sigid.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // __tests__/helpers/bail-sign-sigid.js
  // Convention sigId locataire ALIGNÉE sur le relais (relay/public/sign/sigid.js computeSigId).
  // Le relais ne connaît QUE les signataires à distance (présentiel jamais envoyé) et leur attribue
  // loc-0, loc-1, … par rang dans la liste reçue. Le manifeste embarqué par l'app DOIT porter les
  // mêmes sigId, sinon la signature distante est tamponnée dans la mauvaise case (ou nulle part).

  // Map sigId générique par côté : pour chaque item (index original), 'prefix-<rang parmi les
  // signataires distants de ce côté>' ou null si l'item est exclu de l'envoi (skip). Les exclus ne
  // consomment PAS de rang → rangs distants contigus, alignés sur computeSigId du relais.
  function _sideSigIdMap(items, prefix, skip) {
    const arr = Array.isArray(items) ? items : [];
    let rank = 0;
    return arr.map(it => skip(it) ? null : (prefix + '-' + (rank++)));
  }

  // Pour CHAQUE locataire (index original) : 'loc-<rang parmi les distants>' ou null si présentiel.
  function buildRemoteSigIdMap(locataires) {
    return _sideSigIdMap(locataires, 'loc', l => !!(l && l.presentiel));
  }

  // D2a — Pour CHAQUE bailleur/co-gérant (index original) : 'bailleur-<rang parmi les distants>' ou
  // null si présentiel (signe in-app) OU exclu (ne signe pas). Côté indépendant des locataires
  // (rangs bailleur-N et loc-N comptés séparément, comme sideOf/computeSigId du relais).
  function buildBailleurSigIdMap(bailleurs) {
    return _sideSigIdMap(bailleurs, 'bailleur', b => !!(b && (b.presentiel || b.exclu)));
  }

  // Réplique locale du computeSigId du relais — pour le test de non-régression cross-composant.
  function relayComputeSigId(remoteSigners, index) {
    const sideOf = r => /locat|preneur/i.test(r || '') ? 'locataire' : 'bailleur';
    const side = sideOf(remoteSigners[index].role);
    let rank = 0;
    for (let i = 0; i < index; i++) if (sideOf(remoteSigners[i].role) === side) rank++;
    return (side === 'locataire' ? 'loc' : 'bailleur') + '-' + rank;
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.BailSignSigid = {
    buildRemoteSigIdMap: buildRemoteSigIdMap,
    buildBailleurSigIdMap: buildBailleurSigIdMap,
    relayComputeSigId: relayComputeSigId
  };
})(typeof window !== 'undefined' ? window : globalThis);
