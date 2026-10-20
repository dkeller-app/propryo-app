/**
 * irl-dpe-gate.global.js — Wrapper browser (window.IrlDpeGate)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/irl-dpe-gate.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // __tests__/helpers/irl-dpe-gate.js — CDC-QUITTANCES-IRL D23 / invariant I16.
  //
  // LE point de décision réglementaire du DPE pour la révision IRL, isolé et testable :
  //   - un DPE renseigné F ou G ET valide → loyer GELÉ (loi Climat & Résilience art. 23) → exclu ;
  //   - un DPE absent → l'app ne peut pas vérifier le gel → la révision est proposable, avec une
  //     pastille « à compléter » (D23) ; elle n'est JAMAIS retenue pour cette raison ;
  //   - un DPE de plus de 10 ans n'est plus valable → traité comme MANQUANT (proposable + pastille),
  //     et un F/G périmé ne gèle donc plus (on ne peut pas s'appuyer sur un diagnostic périmé).
  //
  // PUR : `todayISO` injecté (jamais new Date() implicite), aucune lecture DB, aucun DOM.
  // Tests : __tests__/helpers/irl-dpe-gate.test.js

  const _MS_YEAR = 365.25 * 24 * 3600 * 1000;

  /** Âge d'un DPE en années, ou null si la date est absente/illisible. */
  function _ageYears(dpeDate, todayISO) {
    if (!dpeDate) return null;
    const d = new Date(String(dpeDate).slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    const ref = /^\d{4}-\d{2}-\d{2}/.test(String(todayISO || ''))
      ? new Date(String(todayISO).slice(0, 10) + 'T00:00:00')
      : new Date();
    return (ref.getTime() - d.getTime()) / _MS_YEAR;
  }

  /**
   * @param {{dpe?:string, dpeDate?:string, todayISO?:string}} input
   * @returns {{gel:boolean, dpeManquant:boolean, dpeExpire:boolean}}
   *   gel         → exclu des révisions (F/G valide) ;
   *   dpeManquant → révision proposable mais pastille « DPE à compléter » (absent ou périmé) ;
   *   dpeExpire   → le DPE saisi a plus de 10 ans.
   */
  function irlDpeGate(input) {
    const i = input || {};
    const d = String(i.dpe || '').toUpperCase().trim();
    const age = _ageYears(i.dpeDate, i.todayISO);
    const dpeExpire = age != null && age > 10;
    // Un F/G PÉRIMÉ ne gèle plus : on ne s'appuie pas sur un diagnostic hors validité.
    const gel = (d === 'F' || d === 'G') && !dpeExpire;
    // Absent OU périmé → à compléter (jamais retenu pour autant).
    const dpeManquant = !d || dpeExpire;
    return { gel, dpeManquant, dpeExpire };
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.IrlDpeGate = {
    irlDpeGate: irlDpeGate
  };
})(typeof window !== 'undefined' ? window : globalThis);
