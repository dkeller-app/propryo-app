/**
 * bail-sign-manifest.global.js — Wrapper browser (window.BailSignManifest)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/bail-sign-manifest.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // __tests__/helpers/bail-sign-manifest.js
  // Manifeste d'ancres de signature. encode/decode PUR. readFromDoc/embedInDoc reçoivent
  // un PDFDocument pdf-lib en paramètre (aucun import pdf-lib ici → testable + portable).
  const SENTINEL = 'ITSIGNv1:';

  function toB64url(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64url(b64) {
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function encode(manifest) {
    return SENTINEL + toB64url(JSON.stringify(manifest));
  }

  function decode(str) {
    if (typeof str !== 'string' || !str.startsWith(SENTINEL)) return null;
    try {
      return JSON.parse(fromB64url(str.slice(SENTINEL.length)));
    } catch {
      return null;
    }
  }

  function readFromDoc(pdfDoc) {
    return decode(pdfDoc.getKeywords());
  }

  function embedInDoc(pdfDoc, manifest) {
    pdfDoc.setKeywords([encode(manifest)]);
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.BailSignManifest = {
    SENTINEL: SENTINEL,
    encode: encode,
    decode: decode,
    readFromDoc: readFromDoc,
    embedInDoc: embedInDoc
  };
})(typeof window !== 'undefined' ? window : globalThis);
