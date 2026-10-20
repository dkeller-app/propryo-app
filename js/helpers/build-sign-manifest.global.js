/**
 * build-sign-manifest.global.js — Wrapper browser (window.BuildSignManifest)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/build-sign-manifest.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // __tests__/helpers/build-sign-manifest.js

  // anchors: ancres mm jsPDF (top-left). Le manifeste les stocke TELLES QUELLES (mm).
  // BUG-DOUBLE-CONVERSION (2026-06-15) : NE PAS convertir mm→pt ici. Le relais
  // (relay/public/sign/stamp.js → rectFromJsPdf ; ses fallbackAnchors sont aussi en mm)
  // applique la conversion mm→pt + flip Y au moment du tamponnage. Convertir des DEUX
  // côtés appliquait mmToPt deux fois → ancres hors de la page → tampons invisibles
  // (signature/paraphes locataire jamais visibles depuis la mise en service).
  function buildSignManifest(anchors, totalPages) {
    return {
      v: 1,
      totalPages,
      anchors: (anchors || []).map(a => {
        const out = { sigId: a.sigId, kind: a.kind, page: a.page, x: a.x, y: a.y, w: a.w, h: a.h };
        if (a.luApprouve != null) out.luApprouve = a.luApprouve;
        return out;
      })
    };
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.BuildSignManifest = {
    buildSignManifest: buildSignManifest
  };
})(typeof window !== 'undefined' ? window : globalThis);
