/**
 * log-label.global.js — Wrapper browser (window.LogLabel)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/log-label.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  /**
   * Module log-label — nom d'affichage du logement (RETOURS-2026-10-05 B3, BAIL-EN-COURS-NOM-AFFICHAGE).
   *
   * `logement.ref` reste la CLÉ TECHNIQUE (jointure partout). `logement.libelle` est un TEXTE D'ÉCRAN :
   * modifiable à tout moment, même avec un bail signé. Vide ou égal à la référence → on affiche la référence.
   * Pur : ne lit jamais DB. Le texte renvoyé n'est PAS échappé (escHtml à l'affichage).
   */

  const _fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const _natCmp = (a, b) => String(a == null ? '' : a).localeCompare(String(b == null ? '' : b), 'fr', { numeric: true, sensitivity: 'base' });

  /** Libellé saisi → valeur à stocker : trim, espaces fusionnés, caractères de contrôle retirés, 60 max.
   *  '' si vide ou égal à la référence (insensible à la casse) : dans ce cas on ne stocke rien. */
  function normaliserLibelle(raw, ref) {
    let s = String(raw == null ? '' : raw)
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+/g, '')   // invisibles + surcharges bidi (RLO…) : un nom ne doit pas mimer une réf
      .replace(/\s+/g, ' ')
      .trim();
    s = Array.from(s).slice(0, 60).join('').trim();   // par caractères (jamais au milieu d'un emoji)
    if (!s) return '';
    if (ref != null && s.toLowerCase() === String(ref).trim().toLowerCase()) return '';
    return s;
  }

  /** Nom affiché : libellé normalisé, sinon référence, sinon ''. */
  function libelle(log) {
    if (!log) return '';
    return normaliserLibelle(log.libelle, log.ref) || String(log.ref == null ? '' : log.ref);
  }

  /** Forme mixte « Nom · réf » (choix d'un logement, confirmations) ; « réf » seule sans libellé. */
  function libelleEtRef(log) {
    if (!log) return '';
    const nom = normaliserLibelle(log.libelle, log.ref);
    const ref = String(log.ref == null ? '' : log.ref);
    return nom ? nom + ' · ' + ref : ref;
  }

  /** Recherche : libellé OU référence, sans casse ni accents. `q` vide → vrai. */
  function correspond(log, q) {
    const n = _fold(q).trim();
    if (!n) return true;
    if (!log) return false;
    return _fold(libelle(log)).includes(n) || _fold(log.ref).includes(n);
  }

  /** Tri : nom affiché (naturel), puis référence. */
  function comparer(a, b) {
    return _natCmp(libelle(a), libelle(b)) || _natCmp(a && a.ref, b && b.ref);
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.LogLabel = {
    normaliserLibelle: normaliserLibelle,
    libelle: libelle,
    libelleEtRef: libelleEtRef,
    correspond: correspond,
    comparer: comparer
  };
})(typeof window !== 'undefined' ? window : globalThis);
