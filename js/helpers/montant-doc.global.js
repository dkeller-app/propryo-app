/**
 * montant-doc.global.js — Wrapper browser (window.MontantDoc)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/montant-doc.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // __tests__/helpers/montant-doc.js
  // Formatage des MONTANTS et assainissement du TEXTE pour les documents (bail, quittance,
  // décomptes, EDL, certificats). PUR : aucune dépendance DOM, aucun Intl.
  //
  // POURQUOI (S3 SIGNATURE-SMOKE 13/08, preuve bp_102_7957d51b950d.pdf p.3) :
  // `toLocaleString('fr-FR')` sépare les milliers avec U+202F (NARROW NO-BREAK SPACE)
  // depuis ICU 72 (Chrome 111+). Ce caractère n'existe PAS dans l'encodage WinAnsi des
  // polices standard jsPDF → jsPDF bascule TOUTE la chaîne en 16 bits, rendue octet par
  // octet : « 12 000,00 » devient « 1 2 / 0 0 0 , 0 0 » (un NUL invisible devant chaque
  // caractère, et 0x20 0x2F = « /» à la place du séparateur).
  //
  // Deux niveaux, complémentaires :
  //   1. fmtMontantDoc/fmtEuroDoc — formatage DÉTERMINISTE (jamais toLocaleString) : le
  //      séparateur est U+00A0, qui EXISTE en WinAnsi. Immunise aussi contre les futures
  //      évolutions d'ICU et rend les tests stables quel que soit le runtime.
  //   2. pdfSafeText — filet de sécurité appliqué à TOUT texte envoyé à jsPDF, y compris
  //      les données saisies par l'utilisateur (un nom copié-collé peut contenir U+202F).

  /** Espace insécable WinAnsi (0xA0) — le seul séparateur de milliers sûr en PDF. */
  const NBSP = ' ';

  /**
   * Caractères fréquents en saisie/typographie qui n'existent PAS en WinAnsi et
   * cassent l'encodage jsPDF → remplacés par leur équivalent sûr ('' = supprimé).
   */
  const PDF_UNSAFE_MAP = {
    ' ': NBSP,   // narrow no-break space (séparateur de milliers d'ICU ≥ 72)
    ' ': NBSP,   // thin space
    ' ': NBSP,   // figure space
    ' ': NBSP,   // punctuation space
    ' ': NBSP,   // hair space
    ' ': NBSP,   // four-per-em space
    ' ': NBSP,   // six-per-em space
    ' ': ' ',    // en space
    ' ': ' ',    // em space
    ' ': ' ',    // three-per-em space
    ' ': NBSP,   // medium mathematical space
    '　': ' ',    // ideographic space
    '​': '',     // zero-width space
    '‌': '',     // zero-width non-joiner
    '‍': '',     // zero-width joiner
    '⁠': '',     // word joiner
    '﻿': '',     // BOM / zero-width no-break space
    '‑': '-',    // non-breaking hyphen
    '‒': '-',    // figure dash
    '―': '-',    // horizontal bar
    '−': '-'     // minus sign
  };

  // Caractères de la plage 0x80-0x9F de WinAnsi (Unicode > 0xFF mais bien encodables).
  // EXPORTÉ : la popup de signature (document about:blank) reçoit ces helpers sérialisés par
  // toString() — toute variable libre non exportée y serait un ReferenceError à l'exécution.
  const WINANSI_HIGH = '€‚ƒ„…†‡ˆ‰Š‹Œ'
    + 'Ž‘’“”•–—˜™š›œžŸ';

  /** true si `ch` est encodable par une police standard jsPDF (WinAnsi / CP1252). */
  function isWinAnsiChar(ch) {
    const c = ch.charCodeAt(0);
    if (c === 0x09 || c === 0x0A || c === 0x0D) return true;   // tab / CR / LF
    if (c >= 0x20 && c <= 0x7E) return true;                   // ASCII imprimable
    if (c >= 0xA0 && c <= 0xFF) return true;                   // Latin-1 supplement
    return WINANSI_HIGH.indexOf(ch) !== -1;
  }

  /**
   * Assainit un texte destiné à une police standard (WinAnsi) : jsPDF ET pdf-lib.
   * 1. remplace les caractères connus par leur équivalent sûr (table ci-dessus) ;
   * 2. RETIRE tout caractère résiduel non encodable — sinon jsPDF rebascule la ligne
   *    entière en 16 bits (bug S3) et pdf-lib LÈVE une exception (« WinAnsi cannot
   *    encode … »), ce qui bloquait la génération du certificat de preuve.
   * La table seule est une liste blanche fermée : le point 2 est ce qui garantit qu'un
   * caractère jamais rencontré (emoji, ✅, écriture non latine collée par l'utilisateur)
   * ne casse plus un document légal.
   * Accepte une chaîne, un tableau de lignes (jsPDF l'autorise), null/undefined (→ ''), un nombre.
   */
  function pdfSafeText(txt) {
    if (Array.isArray(txt)) return txt.map(pdfSafeText);
    if (txt == null) return '';
    let s = String(txt);
    for (const bad in PDF_UNSAFE_MAP) {
      if (s.indexOf(bad) !== -1) s = s.split(bad).join(PDF_UNSAFE_MAP[bad]);
    }
    if (!hasPdfUnsafeChars(s)) return s;
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (isWinAnsiChar(ch)) { out += ch; continue; }
      // Décomposition Unicode : « ễ » → « e », « œ » déjà WinAnsi, etc. Sinon on retire.
      const dec = typeof ch.normalize === 'function' ? ch.normalize('NFD') : ch;
      for (let k = 0; k < dec.length; k++) if (isWinAnsiChar(dec[k])) out += dec[k];
    }
    return out.replace(/ {2,}/g, ' ').replace(/ +$/, '');
  }

  /** true si le texte contient au moins un caractère non encodable en WinAnsi. */
  function hasPdfUnsafeChars(txt) {
    const s = String(txt == null ? '' : txt);
    for (let i = 0; i < s.length; i++) if (!isWinAnsiChar(s[i])) return true;
    return false;
  }

  /**
   * Parse un nombre tolérant : 12000 | '12000' | '1234,56' | '1 234,56' → Number.
   * Renvoie NaN — et NON 0 — pour une valeur aberrante (audit 13/08, finding 7) :
   * dans une quittance ou un décompte, un « 0,00 » crédible est plus dangereux qu'un
   * « – » visible. L'ABSENCE de valeur (null/undefined/'') vaut bien 0, elle.
   */
  function parseMontant(n) {
    if (n == null || n === '') return 0;
    if (typeof n === 'number') return isFinite(n) ? n : NaN;
    const s = String(n).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    const v = parseFloat(s);
    return isFinite(v) ? v : NaN;
  }

  /**
   * Montant français pour les DOCUMENTS : « 12 000,00 » (espace insécable WinAnsi,
   * virgule décimale). Déterministe — n'utilise ni Intl ni toLocaleString.
   * @param {number|string|null} n
   * @param {number} [decimals=2]
   */
  function fmtMontantDoc(n, decimals) {
    const d = decimals == null ? 2 : decimals;
    const v = parseMontant(n);
    if (isNaN(v)) return '–';                        // valeur aberrante : visible, pas déguisée en 0
    const neg = v < 0;
    const fixed = Math.abs(v).toFixed(d);            // arrondi + décimales fixes
    const parts = fixed.split('.');
    const grouped = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return (neg ? '-' : '') + grouped + (parts[1] ? ',' + parts[1] : '');
  }

  /** Montant + euro pour les documents : « 12 000,00 € » (espaces insécables). */
  function fmtEuroDoc(n, decimals) {
    return fmtMontantDoc(n, decimals) + NBSP + '€';
  }

  /**
   * Blinde une instance jsPDF : tout texte passé à `pdf.text(...)` est assaini.
   * Filet de sécurité pour les 46 appels existants ET les données utilisateur.
   * Idempotent (ne re-patche pas une instance déjà blindée).
   */
  function hardenJsPdfText(pdf) {
    if (!pdf || typeof pdf.text !== 'function' || pdf.__pdfTextHardened) return pdf;
    const orig = pdf.text.bind(pdf);
    pdf.text = function (txt, ...rest) {
      // On SIGNALE ce qu'on a dû assainir : sans ça, un caractère non couvert disparaîtrait
      // silencieusement d'un document légal (audit 13/08, finding 4).
      if (hasPdfUnsafeChars(Array.isArray(txt) ? txt.join(' ') : (txt == null ? '' : txt))
          && typeof console !== 'undefined' && console.warn) {
        console.warn('[pdfSafeText] caractère non encodable assaini dans :', txt);
      }
      return orig(pdfSafeText(txt), ...rest);
    };
    pdf.__pdfTextHardened = true;
    return pdf;
  }

  // ─── Montant EN TOUTES LETTRES (FR) ────────────────────────────────────────────
  //
  // POURQUOI (bug légal repéré 01/09/2026, smoke éditeur de quittance) :
  // la quittance F-001 (670,00 €) écrivait « … 670,00 € – Six-cent soixante euros »,
  // or 670 = « six cent soixante-DIX ». Montant en lettres FAUX de 10 € sur un
  // document que l'article 21 de la loi n° 89-462 rend OPPOSABLE au bailleur.
  // Cause : les tableaux de dizaines de `numToWords` (l.15047) ET de sa copie `nw`
  // (l.21004) ne géraient pas les cas spéciaux 70-79 / 90-99. DRY : une seule
  // conversion correcte ici, réutilisée par les deux via le mirror window.MontantDoc.
  //
  // ORTHOGRAPHE : traditionnelle (pré-1990) — c'est la forme attendue sur les
  // documents légaux et financiers français (chèques) : espaces autour de
  // cent/mille, « et un » pour 21/31/41/51/61/71, accords de cent et vingt.
  //
  // Règles couvertes : 70 = soixante-dix, 71 = soixante et onze, 80 = quatre-vingts
  // (s final), 81 = quatre-vingt-un (ni « et » ni s), 90 = quatre-vingt-dix,
  // 91 = quatre-vingt-onze, 100 = cent (invariable), 200 = deux cents, 201 = deux
  // cent un, 1000 = mille (invariable, jamais « un mille »), « cent »/« vingt »
  // perdent leur s devant « mille » mais le gardent devant « million(s) ».

  const _LET_UNITES = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
    'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const _LET_DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

  /**
   * 0..99 en lettres. `finalVingtSansS` : true quand le groupe est suivi de « mille »
   * → « quatre-vingt » perd son s (quatre-vingt mille, et non quatre-vingts mille).
   */
  function _sousCent(n, finalVingtSansS) {
    if (n < 20) return _LET_UNITES[n];
    const d = Math.floor(n / 10), u = n % 10;
    if (d === 7 || d === 9) {
      // 70-79 : soixante-… ; 90-99 : quatre-vingt-… (base + 10..19)
      if (d === 7 && u === 1) return 'soixante et onze';        // 71 : seul « et » de la plage
      const base = d === 7 ? 'soixante' : 'quatre-vingt';
      return base + '-' + _LET_UNITES[10 + u];
    }
    if (d === 8) {
      if (u === 0) return finalVingtSansS ? 'quatre-vingt' : 'quatre-vingts'; // 80
      return 'quatre-vingt-' + _LET_UNITES[u];                   // 81-89 : sans « et », sans s
    }
    const diz = _LET_DIZAINES[d];
    if (u === 0) return diz;
    if (u === 1) return diz + ' et un';                          // 21/31/41/51/61
    return diz + '-' + _LET_UNITES[u];
  }

  /**
   * 0..999 en lettres. `avantMille` : true si le groupe est suivi de « mille » (numéral
   * invariable) → cent et quatre-vingt perdent leur s ; devant « million(s) »/« milliard(s) »
   * (noms), passer false pour garder l'accord (deux cents millions).
   */
  function _troisChiffres(n, avantMille) {
    if (n === 0) return '';
    const c = Math.floor(n / 100), r = n % 100;
    let mot = '';
    if (c === 1) mot = 'cent';
    else if (c > 1) mot = _LET_UNITES[c] + ' cent' + (r === 0 && !avantMille ? 's' : '');
    if (r > 0) mot += (mot ? ' ' : '') + _sousCent(r, avantMille);
    return mot;
  }

  /**
   * Entier ≥ 0 en toutes lettres (FR traditionnel), 0..999 999 999 999.
   * Ex. 670 → « six cent soixante-dix », 1671 → « mille six cent soixante et onze ».
   */
  function _entierEnLettres(n) {
    n = Math.floor(Math.abs(n));
    if (n === 0) return 'zéro';
    const md = Math.floor(n / 1e9);
    const mi = Math.floor((n % 1e9) / 1e6);
    const ml = Math.floor((n % 1e6) / 1000);
    const r = n % 1000;
    const parts = [];
    if (md > 0) parts.push(_troisChiffres(md, false) + ' milliard' + (md > 1 ? 's' : ''));
    if (mi > 0) parts.push(_troisChiffres(mi, false) + ' million' + (mi > 1 ? 's' : ''));
    if (ml > 0) parts.push(ml === 1 ? 'mille' : _troisChiffres(ml, true) + ' mille');
    if (r > 0) parts.push(_troisChiffres(r, false));
    return parts.join(' ');
  }

  /**
   * Entier en toutes lettres, tolérant à l'entrée (chaîne, décimale arrondie).
   * Renvoie '' pour null/undefined/''/NaN. Résultat en minuscules (l'appelant
   * capitalise selon le contexte de phrase). Remplace l'ancienne fonction `nw`.
   * @param {number|string|null} n
   * @returns {string}
   */
  function nombreEnLettres(n) {
    if (n === '' || n === null || n === undefined) return '';
    const v = parseMontant(n);
    if (isNaN(v)) return '';
    return _entierEnLettres(Math.round(v));
  }

  /**
   * Montant en toutes lettres au format légal : « X euro(s) [et Y centime(s)] »,
   * première lettre capitalisée. Remplace l'ancienne fonction `numToWords`
   * (même contrat : suffixe « euro »/« euros » inclus, '' si entrée vide/NaN).
   * @param {number|string|null} n  montant en euros (décimales = centimes)
   * @returns {string}
   */
  function montantEnLettres(n) {
    if (n === '' || n === null || n === undefined) return '';
    const v = parseMontant(n);
    if (isNaN(v)) return '';
    if (v < 0) return 'moins ' + montantEnLettres(-v);
    const cents = Math.round(v * 100);
    const euros = Math.floor(cents / 100);
    const cts = cents % 100;
    let res = _entierEnLettres(euros) + (euros > 1 ? ' euros' : ' euro');
    if (cts > 0) res += ' et ' + _entierEnLettres(cts) + (cts > 1 ? ' centimes' : ' centime');
    return res.charAt(0).toUpperCase() + res.slice(1);
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.MontantDoc = {
    NBSP: NBSP,
    WINANSI_HIGH: WINANSI_HIGH,
    PDF_UNSAFE_MAP: PDF_UNSAFE_MAP,
    isWinAnsiChar: isWinAnsiChar,
    pdfSafeText: pdfSafeText,
    hasPdfUnsafeChars: hasPdfUnsafeChars,
    parseMontant: parseMontant,
    fmtMontantDoc: fmtMontantDoc,
    fmtEuroDoc: fmtEuroDoc,
    hardenJsPdfText: hardenJsPdfText,
    nombreEnLettres: nombreEnLettres,
    montantEnLettres: montantEnLettres
  };
})(typeof window !== 'undefined' ? window : globalThis);
