/**
 * telephone.global.js — Wrapper browser (window.ImmoTelephone)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    js/core/telephone.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  /**
   * core/telephone.js — numéro de MOBILE pour le second facteur de signature (code SMS). Module PUR, partagé par l'app
   * (avertissement « renseigner le mobile » avant l'envoi) et par le relais (envoi du code, preuve).
   *
   * Règle (relecture adverse du 21/10 : pas de SMS vers l'international, coût et fraude) :
   *  • mobile de métropole (06 / 07) → +33 6/7… ;
   *  • mobile des départements d'outre-mer écrit en national → indicatif du territoire : 0690/0691 Guadeloupe (+590),
   *    0694 Guyane (+594), 0696/0697 Martinique (+596), 0692/0693 La Réunion et 0639 Mayotte (+262) ;
   *  • les mêmes numéros déjà écrits en +33, +590, +594, +596, +262 sont acceptés ;
   *  • tout le reste (fixe, numéro étranger, tronqué, texte) → null : pas de second facteur, JAMAIS de blocage (la preuve
   *    le note « sans mobile »).
   */
  const DOM = [['690', '590'], ['691', '590'], ['694', '594'], ['696', '596'], ['697', '596'], ['692', '262'], ['693', '262'], ['639', '262']]

  function mobileE164(tel) {
    const brut = String(tel == null ? '' : tel).trim()
    if (!brut || brut.length > 32) return null
    const chiffres = brut.replace(/[\s.\-()/]/g, '')
    if (!/^\+?\d+$/.test(chiffres)) return null
    let n = chiffres.replace(/^\+/, '')
    if (!brut.startsWith('+')) {
      if (n.startsWith('00')) n = n.slice(2)
      else if (/^0\d{9}$/.test(n)) {                           // écriture nationale à 10 chiffres
        const dom = DOM.find(([p]) => n.slice(1, 4) === p)
        n = (dom ? dom[1] : '33') + n.slice(1)
      } else return null
    }
    const cc = ['590', '594', '596', '262'].find((c) => n.startsWith(c))
    if (cc) {
      const national = n.slice(cc.length).replace(/^0/, '')
      return DOM.some(([p, c]) => c === cc && national.startsWith(p)) && /^\d{9}$/.test(national) ? '+' + cc + national : null
    }
    if (n.startsWith('33')) {
      const national = n.slice(2).replace(/^0/, '')            // « +33 (0)6… »
      return /^[67]\d{8}$/.test(national) ? '+33' + national : null
    }
    return null
  }

  /** Numéro masqué pour l'écran et la preuve : « +33 6 •• •• •• 78 » (deux derniers chiffres seulement). */
  function masquerMobile(e164) {
    const m = mobileE164(e164)
    if (!m) return ''
    if (m.startsWith('+33')) return '+33 ' + m[3] + ' •• •• •• ' + m.slice(-2)
    return m.slice(0, 4) + ' ' + m.slice(4, 7) + ' •• •• ' + m.slice(-2)
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.ImmoTelephone = {
    mobileE164: mobileE164,
    masquerMobile: masquerMobile
  };
  for (var _k in global.ImmoTelephone) {
    if (Object.prototype.hasOwnProperty.call(global.ImmoTelephone, _k)) global[_k] = global.ImmoTelephone[_k];
  }
})(typeof window !== 'undefined' ? window : globalThis);
