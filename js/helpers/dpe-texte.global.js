/**
 * dpe-texte.global.js — Wrapper browser (window.DpeTexte)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/dpe-texte.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  /**
   * Module dpe-texte — lit, dans le TEXTE d'un DPE (extrait par pdf.js), l'estimation des coûts
   * annuels et les années de référence des prix de l'énergie (chantier ANNONCES, décision D7).
   *
   * Pourquoi : R126-23 CCH impose dans l'annonce le « Montant estimé des dépenses annuelles
   * d'énergie pour un usage standard » ET « l'année de référence des prix de l'énergie ». L'API
   * ADEME ne fournit ni la fourchette (un seul chiffre, cout_total_5_usages) ni les années.
   * Le DPE, lui, les imprime — formulation relevée sur 3 DPE réels (2024-2025) :
   *   « entre 450 € et 670 € par an Prix moyens des énergies indexés sur les années 2021, 2022, 2023
   *     (abonnements compris) »
   * Repli pour les DPE qui n'indiquent qu'une date : « indexés au 1er janvier 2021 ».
   *
   * L'app NE DEVINE RIEN : ces valeurs sont proposées « ✨ à vérifier » avec la phrase source,
   * et seulement si le champ est vide (même contrat que date / cabinet / résultat).
   */

  const _norm = (t) => String(t == null ? '' : t).replace(/[\s  ]+/g, ' ').trim();
  const _chiffres = (s) => String(s).replace(/[^\d]/g, '');
  const _grouper = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  /**
   * @param {string} texte  texte brut du PDF
   * @returns {{ depenses:string, depensesSrc:string, annees:string, anneesSrc:string }}
   *   depenses : « entre 450 € et 670 € par an » (espaces normalisés) ou ''
   *   annees   : « 2021, 2022, 2023 » ou « 2021 » ou ''
   */
  function lireCoutsDpe(texte) {
    const T = _norm(texte);
    const out = { depenses: '', depensesSrc: '', annees: '', anneesSrc: '' };

    const d = T.match(/entre\s+(\d[\d ]{0,9})\s*€\s+et\s+(\d[\d ]{0,9})\s*€\s+par\s+an/i);
    if (d) {
      const a = +_chiffres(d[1]), b = +_chiffres(d[2]);
      if (a > 0 && b >= a) {
        out.depenses = 'entre ' + _grouper(a) + ' € et ' + _grouper(b) + ' € par an';
        out.depensesSrc = d[0];
      }
    }

    const y = T.match(/prix\s+moyens\s+des\s+[ée]nergies\s+index[ée]s\s+sur\s+les\s+ann[ée]es\s+((?:19|20)\d{2}(?:\s*(?:,|et)\s*(?:19|20)\d{2})*)/i);
    if (y) {
      out.annees = (y[1].match(/(?:19|20)\d{2}/g) || []).join(', ');
      out.anneesSrc = y[0];
    } else {
      const j = T.match(/index[ée]s?\s+au\s+1(?:er)?\s+janvier\s+((?:19|20)\d{2})/i);
      if (j) { out.annees = j[1]; out.anneesSrc = j[0]; }
    }
    return out;
  }

  /** Une valeur de dépenses est-elle déjà une fourchette du DPE (« entre X € et Y € ») ? */
  function estFourchette(depenses) {
    return /\bentre\b.*\d.*\bet\b.*\d/i.test(String(depenses == null ? '' : depenses));
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.DpeTexte = {
    lireCoutsDpe: lireCoutsDpe,
    estFourchette: estFourchette
  };
})(typeof window !== 'undefined' ? window : globalThis);
