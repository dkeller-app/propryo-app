/**
 * acte-rapprochement.global.js — Wrapper browser (window.ActeRapprochement)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/acte-rapprochement.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // __tests__/helpers/acte-rapprochement.js
  // Rapprochement immeuble pour l'import d'acte : match par adresse normalisée,
  // DANS une entité donnée (les liens app sont par NOM → rattacher = pointer un
  // immeuble de CETTE entité). Jamais de décision automatique : on renvoie des
  // candidats triés, l'UI fait choisir.
  // NB : strip() a déjà remplacé les points par des espaces → on matche des mots nus.
  const VOIE_ABBR = [
    [/\br\b/g, 'rue'], [/\bav\b/g, 'avenue'], [/\bbd\b/g, 'boulevard'],
    [/\bpl\b/g, 'place'], [/\bimp\b/g, 'impasse'], [/\bch\b/g, 'chemin'],
    [/\bsq\b/g, 'square'], [/\ball\b/g, 'allee'], [/\bfg\b/g, 'faubourg'],
  ];

  function strip(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[–—]/g, '-').replace(/[.,;]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /** '16 R. des Tilleuls' → {num:'16', voie:'rue des tilleuls'} */
  function canonAdresse(adr) {
    let s = strip(adr);
    for (const [re, full] of VOIE_ABBR) s = s.replace(re, full);
    s = s.replace(/\s+/g, ' ').trim();
    const m = s.match(/^(\d+(?:\s*-\s*\d+)?(?:\s?(?:bis|ter|quater))?)\s+(.*)$/);
    if (m) return { num: m[1].replace(/\s*-\s*/, '-').replace(/\s+/g, ''), voie: m[2].trim() };
    return { num: '', voie: s };
  }

  function canonVille(v) {
    // tolère « 68100 Mulhouse » (champ ville de l'écran vérif) : on retire un CP en tête
    return strip(v).replace(/^\d{5}\s*/, '');
  }

  /**
   * Retire un suffixe « - <ville> » en fin de voie (cas fallback sur imm.nom,
   * souvent « 16 r. des Tilleuls — Mulhouse »). villes = candidates déjà canonisées.
   * Le tiret séparateur doit être ENTOURÉ d'espaces (après strip(), le cadratin
   * garde ses espaces : « tilleuls - mulhouse ») — un tiret collé est un nom
   * composé (« petit-mulhouse ») qu'on ne tronque JAMAIS.
   */
  function stripVilleSuffix(voie, villes) {
    for (const v of villes) {
      if (!v || voie === v || !voie.endsWith(v)) continue;
      const head = voie.slice(0, voie.length - v.length);
      if (/\s-\s*$/.test(head)) return head.replace(/[\s-]+$/, '').trim();
    }
    return voie;
  }

  /**
   * @param {object|null} entite  entité effective (dupEntity choisi) — {immeubles:[]}
   * @param {{adr:string, ville:string}} cible  adresse extraite/éditée de l'acte
   * @returns {{imm:object, idx:number, strength:'identique'|'proche'}[]} fort→faible
   */
  function matchImmeuble(entite, cible) {
    if (!entite || !Array.isArray(entite.immeubles) || !entite.immeubles.length) return [];
    const c = canonAdresse(cible && cible.adr);
    const cv = canonVille(cible && cible.ville);
    if (!c.voie || !cv) return [];
    const out = [];
    entite.immeubles.forEach((imm, idx) => {
      if (!imm || imm._deleted) return;
      const ia = canonAdresse(imm.adr || imm.nom);
      const iv = canonVille(imm.ville);
      // stripVilleSuffix UNIQUEMENT en fallback nom : un adr explicite n'a pas de suffixe ville.
      const iaVoie = imm.adr ? ia.voie : stripVilleSuffix(ia.voie, [iv, cv]);
      if (!iaVoie || iaVoie !== c.voie || iv !== cv) return;
      if (ia.num && c.num && ia.num === c.num) out.push({ imm, idx, strength: 'identique' });
      else out.push({ imm, idx, strength: 'proche' });
    });
    return out.sort((a, b) => (a.strength === 'identique' ? 0 : 1) - (b.strength === 'identique' ? 0 : 1));
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.ActeRapprochement = {
    canonAdresse: canonAdresse,
    matchImmeuble: matchImmeuble
  };
})(typeof window !== 'undefined' ? window : globalThis);
