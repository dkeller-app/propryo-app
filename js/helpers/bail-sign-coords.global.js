/**
 * bail-sign-coords.global.js — Wrapper browser (window.BailSignCoords)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/bail-sign-coords.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // __tests__/helpers/bail-sign-coords.js
  // Conversion repère jsPDF(mm, haut-gauche) → pdf-lib(pt, bas-gauche) + ancres de repli.
  // PUR : aucune dépendance pdf-lib, aucun window. Copie alignée sur relay/public/sign/coords.js.
  const PDF_NATIVE = {
    MARGIN_LEFT: 15, MARGIN_RIGHT: 15, MARGIN_TOP: 15, MARGIN_BOTTOM: 25,
    PAGE_W: 210, PAGE_H: 297,
    FOOT_Y: 297 - 25 + 5,        // 277 : ligne du label
    PARAPHE_RECT_DY: 2.5,        // sous-cadres à FOOT_Y + 2.5 = 279.5
    COL_W: 70, COL_H: 14
  };

  const PT_PER_MM = 72 / 25.4;

  function mmToPt(mm) {
    return mm * PT_PER_MM;
  }

  function rectFromJsPdf({ x, y, w, h }, pageHeightPt) {
    return {
      x: mmToPt(x),
      y: pageHeightPt - mmToPt(y + h),
      width: mmToPt(w),
      height: mmToPt(h)
    };
  }

  function fallbackAnchors({ sigId, side, totalPages }) {
    const colX = side === 'locataire'
      ? PDF_NATIVE.PAGE_W - PDF_NATIVE.MARGIN_RIGHT - PDF_NATIVE.COL_W // 125
      : PDF_NATIVE.MARGIN_LEFT;                                        // 15
    const parapheY = PDF_NATIVE.FOOT_Y + PDF_NATIVE.PARAPHE_RECT_DY;   // 279.5
    const anchors = [];
    for (let p = 1; p <= totalPages; p++) {
      anchors.push({ sigId, kind: 'paraphe', page: p, x: colX, y: parapheY, w: PDF_NATIVE.COL_W, h: PDF_NATIVE.COL_H });
    }
    anchors.push({ sigId, kind: 'signature', page: totalPages, x: colX, y: 235, w: 90, h: 30, luApprouve: true });
    return anchors;
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.BailSignCoords = {
    PDF_NATIVE: PDF_NATIVE,
    mmToPt: mmToPt,
    rectFromJsPdf: rectFromJsPdf,
    fallbackAnchors: fallbackAnchors
  };
})(typeof window !== 'undefined' ? window : globalThis);
