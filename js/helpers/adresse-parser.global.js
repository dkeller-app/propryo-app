/**
 * adresse-parser.global.js — Wrapper browser (window.AdresseParser)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/adresse-parser.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  /**
   * Module adresse-parser — parse une adresse française en {rue, codePostal, ville}
   * (ARCHI-FICHES-UNIFIED Session 2, v15.212)
   *
   * Décision A1 (verrouillée 2026-05-27) : l'immeuble porte 3 champs séparés
   * `adr` (rue) + `codePostal` + `ville` au lieu d'un champ unique. Ce parser
   * sert pour :
   *   1. Migration auto au boot (split d'`imm.adr` existant)
   *   2. Aide à la saisie (l'utilisateur peut coller une adresse complète,
   *      on auto-remplit les 3 champs)
   *   3. Lettres / PDF / quittances : reconstitution d'adresse complète via
   *      `formatAdresse({rue, codePostal, ville})`.
   *
   * Stratégie : trouver le code postal français (5 chiffres). Tout ce qui
   * précède = rue ; tout ce qui suit = ville. Si pas de CP → tout dans `rue`.
   * Conservative : on ne casse jamais l'existant — si parsing incertain, on
   * laisse l'adresse complète dans `rue` et on laisse CP/ville vides.
   */

  /**
   * Parse une adresse française.
   * @param {string} adr - adresse libre (ex: "15 rue X, 69001 Lyon")
   * @returns {{rue: string, codePostal: string, ville: string}}
   */
  function parseAdresse(adr) {
    if (!adr || typeof adr !== 'string') return { rue: '', codePostal: '', ville: '' };
    const s = adr.trim();
    if (!s) return { rue: '', codePostal: '', ville: '' };

    // Cherche un code postal FR : 5 chiffres entourés de séparateurs ou en bordure
    // (\b avec \d ne fonctionne pas en chevauchement avec lettres, on utilise une regex précise)
    const cpRegex = /(?:^|[\s,;])(\d{5})(?:[\s,;]|$)/;
    const m = s.match(cpRegex);

    if (!m) {
      // Pas de CP → toute la chaîne dans rue, conservative
      return { rue: s, codePostal: '', ville: '' };
    }

    const cp = m[1];
    const cpIdx = m.index + m[0].indexOf(cp); // position exacte du CP dans la string
    const before = s.slice(0, cpIdx).trim();
    const after = s.slice(cpIdx + 5).trim();

    // Nettoyage : retire virgules / point-virgules / espaces multiples en bord
    const rue = before.replace(/[,;\s]+$/, '').trim();
    const ville = after.replace(/^[,;\s]+/, '').replace(/\s+/g, ' ').trim();

    return { rue, codePostal: cp, ville };
  }

  /**
   * Reconstitue une adresse complète à partir des 3 champs.
   * @param {object} imm - objet avec {adr, codePostal, ville} (legacy compat:
   *   si codePostal+ville absents, retourne juste adr)
   * @returns {string} ex: "15 rue X, 69001 Lyon"
   */
  function formatAdresse(imm) {
    if (!imm || typeof imm !== 'object') return '';
    const rue = (imm.adr || '').trim();
    const cp = (imm.codePostal || '').trim();
    const ville = (imm.ville || '').trim();

    if (!rue && !cp && !ville) return '';
    if (!cp && !ville) return rue; // legacy : adr seul (avant migration)

    const parts = [];
    if (rue) parts.push(rue);
    const cpVille = [cp, ville].filter(Boolean).join(' ').trim();
    if (cpVille) parts.push(cpVille);
    return parts.join(', ');
  }

  /**
   * Détermine si une adresse legacy mérite d'être split (CP trouvé dedans)
   * ou si on doit la laisser telle quelle.
   * Utilisé par la migration boot pour décider quels immeubles toucher.
   * @param {object} imm - objet immeuble
   * @returns {boolean} true si la migration peut splitter proprement
   */
  function needsAddressSplit(imm) {
    if (!imm || typeof imm !== 'object') return false;
    // Déjà splitté ?
    if (imm.codePostal || imm.ville) return false;
    // Pas d'adresse ?
    if (!imm.adr || typeof imm.adr !== 'string') return false;
    // CP détectable ?
    const r = parseAdresse(imm.adr);
    return !!r.codePostal;
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.AdresseParser = {
    parseAdresse: parseAdresse,
    formatAdresse: formatAdresse,
    needsAddressSplit: needsAddressSplit
  };
})(typeof window !== 'undefined' ? window : globalThis);
