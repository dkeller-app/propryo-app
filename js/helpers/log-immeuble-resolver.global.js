/**
 * log-immeuble-resolver.global.js — Wrapper browser (window.LogImmResolver)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/log-immeuble-resolver.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // ─── DÉPENDANCES IMPORTÉES depuis ./adresse-parser.js (résolues via global) ───
  function formatAdresse(){
    if (!global.AdresseParser || typeof global.AdresseParser.formatAdresse !== 'function') {
      console.warn('[mirror log-immeuble-resolver] dep manquante: global.AdresseParser.formatAdresse');
      // Fallback minimal pour formatAdresse-like (objet imm → string vide ou rue)
      return (arguments[0] && typeof arguments[0] === 'object' && arguments[0].adr) ? arguments[0].adr : '';
    }
    return global.AdresseParser.formatAdresse.apply(null, arguments);
  }

  /**
   * Module log-immeuble-resolver — le bien hérite de son immeuble parent
   * (ARCHI-FICHES-UNIFIED Session 2 Commit 2, v15.213)
   *
   * Décisions verrouillées 2026-05-27 :
   *   - A1 : immeuble porte adresse 3 champs séparés (rue/CP/ville)
   *   - A2 : le bien n'override PAS l'adresse (suppression brute en Session 3)
   *   - A3 : équipements communs sur l'immeuble
   *   - C2 : modale Bien affiche encart « 🏛 Hérité » en lecture seule
   *
   * Ces helpers retournent la valeur héritée depuis l'immeuble parent, avec
   * un fallback gracieux sur les champs legacy du bien (transition douce
   * avant Session 3 cleanup brutal).
   */


  /**
   * Résout l'adresse complète du bien (héritée de son immeuble parent).
   * Retourne aussi les 3 composants pour usage atomique.
   *
   * @param {object} log - logement
   * @param {object|null} imm - immeuble parent (peut être null si pas de FK)
   * @returns {{rue: string, codePostal: string, ville: string, full: string, source: 'imm'|'log-legacy'|'none'}}
   */
  function resolveAddressForLog(log, imm) {
    // Source = immeuble (cas nominal post-migration)
    if (imm && (imm.codePostal || imm.ville || imm.adr)) {
      return {
        rue: (imm.adr || '').trim(),
        codePostal: (imm.codePostal || '').trim(),
        ville: (imm.ville || '').trim(),
        full: formatAdresse(imm),
        source: 'imm'
      };
    }
    // Fallback legacy : log.adr seul (pré-migration ou bien orphelin)
    if (log && log.adr) {
      return {
        rue: (log.adr || '').trim(),
        codePostal: '',
        ville: '',
        full: (log.adr || '').trim(),
        source: 'log-legacy'
      };
    }
    return { rue: '', codePostal: '', ville: '', full: '', source: 'none' };
  }

  /**
   * Résout la période de construction (héritée de l'immeuble).
   * @returns {{value: string, source: 'imm'|'log-legacy'|'none'}}
   */
  function resolvePeriodeConstrForLog(log, imm) {
    if (imm && imm.periodeConstr) return { value: imm.periodeConstr, source: 'imm' };
    if (log && log.periodeConstr) return { value: log.periodeConstr, source: 'log-legacy' };
    return { value: '', source: 'none' };
  }

  /**
   * Résout le régime juridique (hérité de l'immeuble).
   * @returns {{value: string, source: 'imm'|'log-legacy'|'none'}}
   */
  function resolveRegimeJuridiqueForLog(log, imm) {
    if (imm && imm.regimeJuridique) return { value: imm.regimeJuridique, source: 'imm' };
    if (log && log.regimeJuridique) return { value: log.regimeJuridique, source: 'log-legacy' };
    return { value: '', source: 'none' };
  }

  /**
   * Résout l'année de construction.
   * @returns {{value: number, source: 'imm'|'log-legacy'|'none'}}
   */
  function resolveAnneeForLog(log, imm) {
    if (imm && +imm.annee) return { value: +imm.annee, source: 'imm' };
    if (log && +log.annee) return { value: +log.annee, source: 'log-legacy' };
    return { value: 0, source: 'none' };
  }

  /**
   * Résout les équipements communs (toujours sur l'immeuble — décision A3).
   * @returns {{equipements: object, source: 'imm'|'none'}}
   */
  function resolveEquipementsCommunsForLog(log, imm) {
    if (imm && imm.equipementsCommuns && typeof imm.equipementsCommuns === 'object') {
      return { equipements: imm.equipementsCommuns, source: 'imm' };
    }
    return { equipements: { customs: [] }, source: 'none' };
  }

  /**
   * Helper de complaisance : retourne tous les champs hérités en 1 appel,
   * pour affichage groupé dans la modale Bien (encart « 🏛 Hérité »).
   */
  function resolveInheritedForLog(log, imm) {
    return {
      address: resolveAddressForLog(log, imm),
      periodeConstr: resolvePeriodeConstrForLog(log, imm),
      regimeJuridique: resolveRegimeJuridiqueForLog(log, imm),
      annee: resolveAnneeForLog(log, imm),
      equipementsCommuns: resolveEquipementsCommunsForLog(log, imm)
    };
  }

  /**
   * Localisation propre au bien dans son immeuble : étage + numéro
   * d'appartement (futur champ `log.numApt` post-Session 2 Commit 2).
   * @returns {string} ex: "Apt 3B, 5e étage" | "5e étage" | "Apt 3B" | ""
   */
  function formatLogLocation(log) {
    if (!log) return '';
    const numApt = (log.numApt || '').toString().trim();
    const etage = log.etage;
    let etageLbl = '';
    if (etage !== '' && etage != null) {
      // Test "RDC" / "rdc" en premier (parseInt échouerait)
      if (/^rdc/i.test(String(etage))) etageLbl = 'rez-de-chaussée';
      else {
        const n = parseInt(etage, 10);
        if (!Number.isNaN(n)) {
          if (n === 0) etageLbl = 'rez-de-chaussée';
          else if (n === 1) etageLbl = '1er étage';
          else etageLbl = n + 'e étage';
        }
      }
    }
    if (numApt && etageLbl) return `Apt ${numApt}, ${etageLbl}`;
    if (numApt) return `Apt ${numApt}`;
    if (etageLbl) return etageLbl;
    return '';
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.LogImmResolver = {
    resolveAddressForLog: resolveAddressForLog,
    resolvePeriodeConstrForLog: resolvePeriodeConstrForLog,
    resolveRegimeJuridiqueForLog: resolveRegimeJuridiqueForLog,
    resolveAnneeForLog: resolveAnneeForLog,
    resolveEquipementsCommunsForLog: resolveEquipementsCommunsForLog,
    resolveInheritedForLog: resolveInheritedForLog,
    formatLogLocation: formatLogLocation
  };
})(typeof window !== 'undefined' ? window : globalThis);
