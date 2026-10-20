/**
 * bank-import.global.js — Wrapper browser (window.BankImport)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    js/core/bank-import.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  /**
   * core/bank-import.js — Import bancaire (lecture, dédup, compte, reprise).
   *
   * CDC : docs/CDC-IMPORT.md (validé 17/08). Refonte v15.518 « IMPORT-MOUVEMENTS ».
   *
   * Formats acceptés : **OFX** (privilégié) + **Excel** (.xlsx/.xls). Le lecteur CSV
   * a été RETIRÉ (①.1) : format libre, illisible pour l'utilisateur, à l'origine de
   * la totalité des bugs de lecture — un CSV mal lu n'échoue pas franchement, il
   * importe des montants faux sans le dire.
   *
   * Principe transverse T-1 « ON NE CACHE RIEN » : aucune ligne n'est écartée,
   * corrigée ou masquée en silence. Chaque ligne non retenue sort dans
   * `discarded[]` avec son motif, et le récapitulatif de lecture (`meta`) expose
   * ce qui a été décidé et **ce qui l'a prouvé**.
   *
   * Architecture : 100% offline-first (pas de backend AISP DSP2).
   * Les fonctions sont PURES : la lecture du fichier (FileReader, XLSX.read) reste
   * côté index.html, le module reçoit du texte (OFX) ou un tableau de lignes (Excel).
   *
   * Tests Vitest miroir : __tests__/helpers/bank-import.test.js
   *                     + __tests__/helpers/bank-read.test.js
   *                     + __tests__/helpers/bank-regles-refonte.test.js (REGLES-REFONTE, lot D)
   */

  // ────────────────────────────────────────────────────────────────────────────
  // v15.78 — Hash stable synchrone (FNV-1a + DJB2 concat) — 16 chars hex
  // Pas de besoin cryptographique (just dedup), donc pas de crypto.subtle async.
  // 64 bits ≈ 1.8×10^19 valeurs → collision négligeable sur < 10k mouvements.
  // ────────────────────────────────────────────────────────────────────────────

  function _bankHashStable(str) {
    const s = String(str || '');
    let h1 = 0x811c9dc5;   // FNV-1a 32-bit offset
    let h2 = 5381;          // DJB2 init
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 = ((h2 * 33) + c) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  /** Normalisation commune des textes d'empreinte (accents, casse, espaces). */
  function _bankNormTxt(s) {
    return String(s == null ? '' : s)
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim()
      .toLowerCase();
  }

  /**
   * Empreinte stable d'une ligne de tableur (Excel) : date + montant signé + libellé.
   * Remplace l'ancienne empreinte CSV (calculée sur la ligne brute) : un tableur n'a
   * pas de « ligne brute » et une empreinte sur le contenu métier est plus stable.
   * @returns {string} 16 chars hex
   */
  function _bankFingerprintRow(date, signedAmount, libelle) {
    const amt = (Math.round((Number(signedAmount) || 0) * 100) / 100).toFixed(2);
    return _bankHashStable(_bankNormTxt(date) + '|' + amt + '|' + _bankNormTxt(libelle));
  }

  /**
   * Empreinte stable pour une transaction OFX (body STMTTRN entier).
   * Priorité 1 : FITID (identifiant unique fourni par la banque, retourné préfixé "fitid:").
   * Priorité 2 : hash sur (DTPOSTED|TRNAMT|NAME|MEMO) joints.
   * ⚠️ La valeur d'une balise SGML court jusqu'au `<` suivant, PAS jusqu'au retour à la
   * ligne (②.1) : un MEMO sur deux lignes était tronqué, donc l'empreinte changeait
   * d'un export à l'autre.
   * @param {string} stmttrnBody — contenu entre <STMTTRN> et </STMTTRN>
   * @returns {string} 'fitid:XXX' si FITID présent, sinon 16 chars hex
   */
  function _bankFingerprintOFX(stmttrnBody) {
    const body = String(stmttrnBody || '');
    const fitid = _bankOfxTag(body, 'FITID');
    if (fitid) return 'fitid:' + fitid;
    const fields = ['DTPOSTED', 'TRNAMT', 'NAME', 'MEMO']
      .map(t => _bankOfxTag(body, t))
      .join('|');
    return _bankHashStable(fields);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ①.1 — RECONNAISSANCE DU FICHIER PAR SIGNATURE RÉELLE (fini le « sinon c'est du CSV »)
  // ────────────────────────────────────────────────────────────────────────────

  /** Taille maximale acceptée pour un relevé (①.2, inchangé). */
  const _BANK_MAX_FILE_SIZE = 5 * 1024 * 1024;

  /**
   * Reconnaît le format d'un fichier par sa SIGNATURE binaire / textuelle.
   * Aucun repli « sinon c'est du CSV » : un fichier non reconnu est refusé
   * explicitement, avec un message qui dit quoi faire (①.1 / ①.5).
   *
   * @param {Uint8Array|number[]} bytes — les premiers octets du fichier (≥ 512 conseillé)
   * @param {string} [filename] — sert UNIQUEMENT de départage secondaire, jamais de preuve
   * @returns {{format:'ofx'|'xlsx'|'xls'|'unknown', reason:string}}
   */
  function _bankDetectFormat(bytes, filename) {
    const b = bytes && bytes.length ? Array.from(bytes.slice(0, 8)) : [];
    const name = String(filename || '').toLowerCase();
    // ZIP (PK\x03\x04) = OOXML → .xlsx
    if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) {
      return { format: 'xlsx', reason: 'signature ZIP/OOXML (PK)' };
    }
    // OLE2 compound file → .xls (Excel 97-2003)
    if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
      return { format: 'xls', reason: 'signature OLE2 (Excel 97-2003)' };
    }
    // OFX : SGML ou XML, reconnu sur le début du texte
    let head = '';
    try {
      const raw = bytes && bytes.length ? bytes.slice(0, 2048) : [];
      head = Array.from(raw).map(c => String.fromCharCode(c)).join('');
    } catch (e) { head = ''; }
    if (/OFXHEADER|<OFX[\s>]|<STMTTRN>|<BANKMSGSRSV1>/i.test(head)) {
      return { format: 'ofx', reason: 'en-tête OFX' };
    }
    if (name.endsWith('.ofx') || name.endsWith('.qfx')) {
      // Extension OFX mais aucune balise reconnue → on refuse plutôt que de deviner.
      return { format: 'unknown', reason: 'extension OFX mais aucune balise OFX trouvée' };
    }
    return { format: 'unknown', reason: 'signature inconnue' };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Primitives montants / dates
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Parse un montant FR/EN vers nombre. "1 234,56 €" → 1234.56.
   * ②.4 : les **parenthèses comptables** valent le signe négatif — `(487,00)` → -487.
   * Gère aussi l'espace insécable (U+00A0) et l'espace fine (U+202F) des exports FR,
   * et le signe suffixé `487,00-` (exports SEPA/mainframe).
   */
  function _bankParseAmount(s) {
    if (s == null || s === '') return 0;
    if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
    let v = String(s).replace(/[\s   €$£]/g, '').trim();
    if (!v) return 0;
    let neg = false;
    // Parenthèses comptables : (487,00) = −487,00
    const par = v.match(/^\((.*)\)$/);
    if (par) { neg = true; v = par[1]; }
    // Signe suffixé : 487,00-
    if (/-$/.test(v)) { neg = !neg; v = v.slice(0, -1); }
    if (/^\+/.test(v)) v = v.slice(1);
    if (/^-/.test(v)) { neg = !neg; v = v.slice(1); }
    // Format FR : 1.234,56 → 1234.56. Si présence de virgule + point, le dernier domine.
    const lastComma = v.lastIndexOf(',');
    const lastDot = v.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) v = v.replace(/\./g, '').replace(',', '.');
      else                      v = v.replace(/,/g, '');
    } else if (lastComma >= 0) {
      // Si virgule = séparateur décimal (toujours 1-2 décimales après) → remplace
      if (/,\d{1,2}$/.test(v)) v = v.replace(',', '.');
      else                      v = v.replace(/,/g, '');
    }
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return 0;
    return neg ? -n : n;
  }

  /**
   * Parse une date FR/ISO vers YYYY-MM-DD. "15/06/2026" → "2026-06-15".
   * Accepte aussi un objet Date (Excel lu avec `cellDates:true`) et un numéro de
   * série Excel (repli quand la cellule n'a pas de format date).
   * Retourne '' si la date n'est pas reconnue OU n'existe pas (31/02).
   */
  function _bankParseDate(s) {
    if (s == null || s === '') return '';
    if (s instanceof Date) {
      if (isNaN(s.getTime())) return '';
      const y = s.getFullYear(), mo = s.getMonth() + 1, d = s.getDate();
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    if (typeof s === 'number') {
      // Numéro de série Excel (époque 1899-12-30). Bornes larges : 1990 → 2100.
      if (s < 32874 || s > 73415) return '';
      const ms = Math.round(s) * 86400000 + Date.UTC(1899, 11, 30);
      const d = new Date(ms);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
    const str = String(s).trim();
    let y = 0, mo = 0, d = 0, m;
    if ((m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)))                      { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/)))     { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else if ((m = str.match(/^(\d{4})(\d{2})(\d{2})/)))                        { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/)))     { d = +m[1]; mo = +m[2]; y = 2000 + (+m[3]); }
    else return '';
    if (!_bankIsRealDate(y, mo, d)) return '';
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /** Une date qui n'existe pas au calendrier (31/02, 30/02, mois 13) n'est pas une date. */
  function _bankIsRealDate(y, mo, d) {
    if (!(y >= 1900 && y <= 2200)) return false;
    if (!(mo >= 1 && mo <= 12)) return false;
    if (!(d >= 1 && d <= 31)) return false;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }

  /** Une cellule ressemble-t-elle à une DATE ? (un nombre nu ne compte pas : ce serait un montant) */
  function _bankIsDateLike(v) {
    if (v instanceof Date) return !isNaN(v.getTime());
    if (typeof v === 'number') return false;
    if (v == null || String(v).trim() === '') return false;
    return _bankParseDate(v) !== '';
  }

  /** Une cellule ressemble-t-elle à un MONTANT ? (chiffres + séparateurs, rien d'autre) */
  function _bankIsAmountLike(v) {
    if (v instanceof Date) return false;
    if (typeof v === 'number') return Number.isFinite(v);
    if (v == null) return false;
    const s = String(v).replace(/[\s   €$£]/g, '').trim();
    if (!s) return false;
    return /^[(+-]?\d{1,3}(?:[ .,]?\d{3})*(?:[.,]\d{1,4})?\)?-?$/.test(s) || /^[(+-]?\d+(?:[.,]\d{1,4})?\)?-?$/.test(s);
  }

  /** Les devises autres que l'euro sont ÉCARTÉES et signalées (③.2) plutôt qu'importées à un montant faux. */
  const _BANK_FOREIGN_CUR = /\b(usd|gbp|chf|cad|jpy|aud|sek|nok|dkk|pln|czk)\b|[$£¥]/i;
  function _bankForeignCurrency(cell) {
    const s = String(cell == null ? '' : cell);
    if (!s) return '';
    const m = s.match(_BANK_FOREIGN_CUR);
    return m ? m[0].toUpperCase() : '';
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Parser OFX (Open Financial Exchange) — format SGML/XML simplifié
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * ②.1 — Lit la valeur d'une balise OFX. La valeur d'une balise SGML court jusqu'au
   * **`<` suivant**, PAS jusqu'au premier retour à la ligne : c'est exactement le bug
   * qui tronquait un `MEMO` sur deux lignes (RUM, référence de mandat, motif du
   * virement disparaissaient). Les retours à la ligne deviennent des espaces (I-2 :
   * libellé intégral, aucune troncature — n'importe quel mot doit pouvoir servir de
   * motif de règle).
   */
  function _bankOfxTag(body, tag) {
    const m = String(body || '').match(new RegExp(`<${tag}>([^<]*)`, 'i'));
    if (!m) return '';
    return m[1].replace(/\s+/g, ' ').trim();
  }

  /** Balises textuelles agrégées dans le libellé OFX (②.1), dans l'ordre de lisibilité. */
  const _BANK_OFX_TEXT_TAGS = ['NAME', 'PAYEE', 'EXTDNAME', 'MEMO', 'CHECKNUM', 'REFNUM'];

  /** Agrège toutes les balises textuelles d'une transaction OFX, sans doublon ni troncature. */
  function _bankOfxLabel(body) {
    const seen = new Set();
    const parts = [];
    for (const t of _BANK_OFX_TEXT_TAGS) {
      const v = _bankOfxTag(body, t);
      if (!v) continue;
      const k = _bankNormTxt(v);
      if (!k || seen.has(k)) continue;
      // Un fragment déjà contenu dans un précédent n'apporte rien (NAME répété dans MEMO).
      if (parts.some(p => _bankNormTxt(p).includes(k))) { seen.add(k); continue; }
      seen.add(k);
      parts.push(v);
    }
    return parts.join(' — ').trim();
  }

  /**
   * Parse un texte OFX → liste de transactions normalisées.
   * Format cible : `<STMTTRN><TRNTYPE>...<DTPOSTED>...<TRNAMT>...<NAME>...<MEMO>...</STMTTRN>`
   * Supporte SGML (tags non fermés) et XML (tags fermés).
   * T-1 : rien n'est jeté en silence — les transactions non retenues (date illisible,
   * montant nul, devise étrangère) sortent dans `discarded[]` avec leur motif.
   * @returns {object[]} lignes normalisées ; `_discarded` porte la liste des écartées.
   */
  function _bankParseOFX(text) {
    const r = _bankReadOFX(text);
    const out = r.lines;
    out._discarded = r.discarded;
    out._meta = r.meta;
    return out;
  }

  /**
   * Lecture OFX complète : lignes + écartées + méta de lecture (③.1).
   * @returns {{lines:object[], discarded:object[], meta:object}}
   */
  function _bankReadOFX(text) {
    const meta = { source: 'ofx', dateColLabel: 'date de comptabilisation (DTPOSTED)', dateColKind: 'comptabilisation',
                   orientation: 'signed', orientationProof: 'ofx', orientationProofLabel: 'OFX : le montant TRNAMT est signé par la banque',
                   currency: '', sheetName: '', headerRow: null, balance: { checked: false }, period: { from: '', to: '' } };
    const lines = [], discarded = [];
    if (!text || typeof text !== 'string') return { lines, discarded, meta };
    meta.currency = (_bankOfxTag(text, 'CURDEF') || 'EUR').toUpperCase();
    const tx = [...text.matchAll(/<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|<\/BANKTRANLIST>)/gi)];
    tx.forEach((m, i) => {
      const body = m[1] || '';
      const libelle = _bankOfxLabel(body);
      const date = _bankParseDate(_bankOfxTag(body, 'DTPOSTED'));
      const val = _bankParseAmount(_bankOfxTag(body, 'TRNAMT'));
      const cur = (_bankOfxTag(body, 'CURSYM') || _bankOfxTag(body, 'CURRENCY') || meta.currency || 'EUR').toUpperCase();
      if (cur && cur !== 'EUR' && /^[A-Z]{3}$/.test(cur)) {
        discarded.push({ index: i, date, libelle, amount: val, reason: 'devise ' + cur + ' — non convertie', raw: body });
        return;
      }
      if (val === 0) {
        discarded.push({ index: i, date, libelle, amount: 0, reason: 'montant à 0 €', raw: body });
        return;
      }
      // ③.3 v2 : une date illisible n'écarte plus la ligne — elle est importée et MARQUÉE.
      lines.push({
        date,
        libelle,
        debit:  val < 0 ? -val : 0,
        credit: val > 0 ?  val : 0,
        signedAmount: val,
        fitid: _bankOfxTag(body, 'FITID'),
        raw: body,
        _rowIndex: i,
        _fingerprint: _bankFingerprintOFX(body),
        _importSource: 'ofx',
        _dateDouteuse: date ? '' : 'date illisible dans le relevé',
      });
    });
    _bankMarkDoubtfulDates(lines);
    const ds = lines.map(l => l.date).filter(Boolean).sort();
    meta.period = { from: ds[0] || '', to: ds[ds.length - 1] || '' };
    meta.count = lines.length;
    return { lines, discarded, meta };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // ②.2 — DÉBUT DES DONNÉES TROUVÉ PAR LE CONTENU, EN SILENCE
  // « Ce n'est pas à moi d'expliquer à l'app comment lire un fichier. » On teste les
  // 20 premières lignes comme candidat en-tête : une colonne contient-elle des dates
  // valides sur ≥ 80 % des lignes, une ou deux des montants, le nombre de colonnes
  // est-il stable. Les noms d'en-têtes ne servent que de BONUS de confiance.
  // ────────────────────────────────────────────────────────────────────────────

  const _BANK_H_DATE   = /(date|jour)/i;
  const _BANK_H_OPER   = /op[ée]?ration|op\b|transaction/i;
  const _BANK_H_COMPTA = /comptabilis/i;
  const _BANK_H_VALEUR = /valeur/i;
  const _BANK_H_LIB    = /(libell|intitul|description|d[ée]tail|nature|motif|objet|narrative|memo|r[ée]f[ée]rence)/i;
  const _BANK_H_DEBIT  = /(d[ée]bit|retrait|sortie|withdraw|paiement|d[ée]pense)/i;
  const _BANK_H_CREDIT = /(cr[ée]dit|d[ée]p[oô]t|entr[ée]e|deposit|recette|encaiss)/i;
  const _BANK_H_MONT   = /(montant|amount|somme|valeur eur)/i;
  const _BANK_H_SOLDE  = /(solde|balance)/i;

  function _bankHdr(headers, i) {
    return _bankNormTxt(headers && headers[i] != null ? headers[i] : '');
  }

  /**
   * Statistiques d'une colonne sur les lignes de données (dates / montants / textes).
   * Un montant libellé en devise étrangère (« 1200 USD ») compte comme un MONTANT :
   * la colonne doit être reconnue pour que la ligne puisse être écartée avec son
   * motif (③.2) — sinon elle disparaîtrait en faisant échouer toute la lecture.
   */
  function _bankColStats(data, ci) {
    let nonEmpty = 0, dates = 0, amounts = 0, texts = 0, textLen = 0;
    for (const r of data) {
      const v = r ? r[ci] : null;
      if (v == null || String(v).trim() === '') continue;
      nonEmpty++;
      if (_bankIsDateLike(v)) dates++;
      else if (_bankIsAmountLike(v)) amounts++;
      else if (_bankForeignCurrency(v) && /\d/.test(String(v))) amounts++;
      else { texts++; textLen += String(v).length; }
    }
    return { nonEmpty, dates, amounts, texts, avgTextLen: texts ? textLen / texts : 0 };
  }

  /**
   * Trouve la ligne d'en-tête (ou son absence) PAR LE CONTENU.
   * @param {Array<Array>} rows — lignes brutes du tableur (tableau de tableaux)
   * @param {{maxProbe?:number}} [opts]
   * @returns {{headerRow:number, headers:string[], data:Array<Array>, ncols:number,
   *            dateCols:number[], amountCols:number[], textCols:number[],
   *            goodRows:number, headerBonus:number, ok:boolean}}
   *   `headerRow` = -1 quand le fichier n'a pas d'en-tête (les données commencent à la 1re ligne).
   */
  function _bankFindHeaderRow(rows, opts = {}) {
    const maxProbe = opts.maxProbe != null ? opts.maxProbe : 20;
    const all = Array.isArray(rows) ? rows : [];
    const empty = { headerRow: -1, headers: [], data: [], ncols: 0, dateCols: [], amountCols: [], textCols: [], goodRows: 0, headerBonus: 0, ok: false };
    if (!all.length) return empty;

    const candidates = [];
    const last = Math.min(maxProbe, all.length - 1);
    for (let h = -1; h <= last; h++) {
      const data = all.slice(h + 1).filter(r => Array.isArray(r) && r.some(c => c != null && String(c).trim() !== ''));
      if (data.length < 2) continue;
      const ncols = Math.max(...data.map(r => r.length), 0);
      if (!ncols) continue;
      const dateCols = [], amountCols = [], textCols = [];
      for (let c = 0; c < ncols; c++) {
        const s = _bankColStats(data, c);
        if (!s.nonEmpty) continue;
        // Seuil à 70 % (et non 80 %) : une ligne de total ou un pied de page suffit à
        // faire tomber une colonne de dates à 75 % sur un relevé court. Ces lignes-là
        // ressortent ensuite dans `discarded[]` avec leur motif (T-1).
        if (s.dates / s.nonEmpty >= 0.7 && s.dates >= Math.max(2, data.length * 0.5)) dateCols.push(c);
        else if (s.amounts / s.nonEmpty >= 0.7) amountCols.push(c);
        else textCols.push(c);
      }
      if (!dateCols.length || !amountCols.length) continue;
      // Stabilité du nombre de colonnes : part des lignes au format majoritaire.
      const widths = {};
      data.forEach(r => { const w = r.filter(c => c != null && String(c).trim() !== '').length; widths[w] = (widths[w] || 0) + 1; });
      const stable = Math.max(...Object.values(widths)) / data.length;
      const dcol = dateCols[0];
      const goodRows = data.filter(r => _bankIsDateLike(r[dcol]) && amountCols.some(c => _bankIsAmountLike(r[c]) && _bankParseAmount(r[c]) !== 0)).length;
      if (!goodRows) continue;
      const headers = h >= 0 ? (all[h] || []).map(c => (c == null ? '' : String(c))) : [];
      let headerBonus = 0;
      headers.forEach((_, i) => {
        const k = _bankHdr(headers, i);
        if (!k) return;
        if (_BANK_H_DATE.test(k) || _BANK_H_LIB.test(k) || _BANK_H_DEBIT.test(k) ||
            _BANK_H_CREDIT.test(k) || _BANK_H_MONT.test(k) || _BANK_H_SOLDE.test(k)) headerBonus++;
      });
      candidates.push({ headerRow: h, headers, data, ncols, dateCols, amountCols, textCols, goodRows, headerBonus, stable, ok: true });
    }
    if (!candidates.length) return empty;
    candidates.sort((a, b) =>
      (b.goodRows - a.goodRows) ||
      (b.headerBonus - a.headerBonus) ||
      (b.stable - a.stable) ||
      (b.headerRow - a.headerRow));
    return candidates[0];
  }

  /**
   * ②.3 — La DATE D'OPÉRATION fait foi (pas la date de valeur) : c'est le jour où
   * l'argent a bougé, celui que dit le locataire et que porte la quittance.
   * Priorité si en-têtes présents : opération > comptabilisation > valeur ;
   * sinon la première colonne de dates.
   */
  function _bankPickDateColumn(headers, dateCols) {
    const cols = Array.isArray(dateCols) ? dateCols : [];
    if (!cols.length) return { idx: -1, label: '', kind: 'aucune' };
    const score = (c) => {
      const k = _bankHdr(headers, c);
      if (!k) return 0;
      if (_BANK_H_OPER.test(k)) return 3;
      if (_BANK_H_COMPTA.test(k)) return 2;
      if (_BANK_H_VALEUR.test(k)) return 1;
      return 0;
    };
    let best = cols[0], bestScore = score(cols[0]);
    for (const c of cols.slice(1)) { const s = score(c); if (s > bestScore) { best = c; bestScore = s; } }
    const kind = bestScore === 3 ? 'operation' : bestScore === 2 ? 'comptabilisation' : bestScore === 1 ? 'valeur' : 'inconnue';
    const lbl = headers && headers[best] ? String(headers[best]).trim() : '';
    return { idx: best, label: lbl || ('colonne ' + (best + 1)), kind };
  }

  /**
   * ②.4 — CHOIX DE LA COLONNE DE MONTANT quand il n'y a pas de couple débit/crédit.
   *
   * 🐛 **Prendre la colonne numérique la plus à gauche est faux** : beaucoup d'exports
   * Excel de banques placent un « N° d'opération » ou une « Référence » avant le montant.
   * Le numéro devenait le montant, et le sens de toutes les lignes avec (audit C1).
   * Une colonne d'argent, ça se reconnaît : elle porte des décimales ou des négatifs.
   * Un identifiant, ce sont des entiers positifs, tous de la même longueur.
   *
   * Ordre : en-tête explicite (« montant », « amount »…) → colonne qui contient des
   * décimales ou des négatifs → la plus à droite (le montant suit les références).
   */
  function _bankPickAmountColumn(data, cols, headers) {
    const list = (cols || []).slice();
    if (!list.length) return -1;
    const named = list.filter(c => _BANK_H_MONT.test(_bankHdr(headers, c)));
    if (named.length) return named[0];
    const money = (c) => {
      let dec = 0, neg = 0, n = 0, widths = new Set();
      for (const r of data) {
        const raw = r && r[c];
        if (raw == null || String(raw).trim() === '') continue;
        const v = _bankParseAmount(raw);
        if (v === 0) continue;
        n++;
        if (Math.abs(Math.round(v) - v) > 0.0001) dec++;
        if (v < 0) neg++;
        widths.add(String(Math.abs(Math.round(v))).length);
      }
      // Un identifiant : que des entiers positifs, tous de la même longueur.
      const looksLikeId = n >= 2 && dec === 0 && neg === 0 && widths.size === 1;
      return { n, score: (dec > 0 ? 2 : 0) + (neg > 0 ? 1 : 0), looksLikeId };
    };
    const scored = list.map(c => ({ c, ...money(c) }));
    const real = scored.filter(s => !s.looksLikeId);
    const pool = real.length ? real : scored;
    pool.sort((a, b) => (b.score - a.score) || (b.c - a.c));   // à score égal, la plus à droite
    return pool[0].c;
  }

  /**
   * ②.4 — ORIENTATION DÉBIT/CRÉDIT : prouvée, pas devinée.
   * Reconnaissance : deux colonnes jamais remplies ensemble = couple débit/crédit ;
   * une colonne avec des positifs ET des négatifs = montant signé ; une colonne texte
   * à deux valeurs = colonne de sens.
   * Ordre de résolution : **solde → signes → en-têtes → convention**.
   *
   * @returns {{mode:'debitCredit'|'signed'|'sens', debitIdx:number, creditIdx:number,
   *            amountIdx:number, sensIdx:number, proof:string, proofLabel:string}}
   */
  function _bankDetectOrientation(data, ctx = {}) {
    const headers = ctx.headers || [];
    const soldeIdx = ctx.soldeIdx != null ? ctx.soldeIdx : -1;
    const amountCols = (ctx.amountCols || []).filter(c => c !== soldeIdx);
    const out = { mode: 'signed', debitIdx: -1, creditIdx: -1, amountIdx: -1, sensIdx: -1, proof: 'convention', proofLabel: '' };

    // ── Colonne de SENS : une colonne texte à deux valeurs (D/C, débit/crédit…) ──
    const sensIdx = (ctx.textCols || []).find(c => {
      const vals = new Set();
      for (const r of data) {
        const v = _bankNormTxt(r && r[c]);
        if (!v) continue;
        vals.add(v);
        if (vals.size > 2) return false;
      }
      if (vals.size !== 2) return false;
      return [...vals].every(v => /^(d|c|db|cr|debit|credit|-|\+|dr|d[ée]bit|cr[ée]dit)$/.test(v));
    });
    if (sensIdx != null && amountCols.length === 1) {
      out.mode = 'sens'; out.sensIdx = sensIdx; out.amountIdx = amountCols[0];
      out.proof = 'colonne de sens';
      out.proofLabel = 'une colonne « ' + (_bankHdr(headers, sensIdx) || ('colonne ' + (sensIdx + 1))) + ' » ne prend que deux valeurs (débit / crédit)';
      return out;
    }

    // ── Couple débit/crédit : deux colonnes JAMAIS remplies ensemble ──
    if (amountCols.length >= 2) {
      for (let i = 0; i < amountCols.length; i++) {
        for (let j = i + 1; j < amountCols.length; j++) {
          const a = amountCols[i], b = amountCols[j];
          let both = 0, one = 0;
          for (const r of data) {
            const va = _bankParseAmount(r && r[a]) !== 0;
            const vb = _bankParseAmount(r && r[b]) !== 0;
            if (va && vb) both++; else if (va || vb) one++;
          }
          if (both === 0 && one >= 2) {
            out.mode = 'debitCredit';
            // Preuve n° 1 : le solde. On teste les deux affectations, celle qui boucle gagne.
            if (soldeIdx >= 0) {
              const fit = (dIdx, cIdx) => _bankCheckBalance(
                data.map(r => ({ signed: Math.abs(_bankParseAmount(r && r[cIdx])) - Math.abs(_bankParseAmount(r && r[dIdx])), solde: _bankParseAmount(r && r[soldeIdx]) }))).ok;
              if (fit(a, b)) { out.debitIdx = a; out.creditIdx = b; out.proof = 'solde'; out.proofLabel = 'le solde de chaque ligne confirme le sens'; return out; }
              if (fit(b, a)) { out.debitIdx = b; out.creditIdx = a; out.proof = 'solde'; out.proofLabel = 'le solde de chaque ligne confirme le sens'; return out; }
            }
            // Preuve n° 2 : les signes (une colonne systématiquement négative = les débits).
            const negRate = (c) => { let n = 0, t = 0; for (const r of data) { const v = _bankParseAmount(r && r[c]); if (v !== 0) { t++; if (v < 0) n++; } } return t ? n / t : 0; };
            const na = negRate(a), nb = negRate(b);
            if (na >= 0.9 && nb <= 0.1) { out.debitIdx = a; out.creditIdx = b; out.proof = 'signes'; out.proofLabel = 'une colonne ne contient que des montants négatifs'; return out; }
            if (nb >= 0.9 && na <= 0.1) { out.debitIdx = b; out.creditIdx = a; out.proof = 'signes'; out.proofLabel = 'une colonne ne contient que des montants négatifs'; return out; }
            // Preuve n° 3 : les en-têtes.
            const ka = _bankHdr(headers, a), kb = _bankHdr(headers, b);
            if (_BANK_H_DEBIT.test(ka) && _BANK_H_CREDIT.test(kb)) { out.debitIdx = a; out.creditIdx = b; out.proof = 'en-têtes'; out.proofLabel = 'les en-têtes « ' + ka + ' » et « ' + kb +' »'; return out; }
            if (_BANK_H_DEBIT.test(kb) && _BANK_H_CREDIT.test(ka)) { out.debitIdx = b; out.creditIdx = a; out.proof = 'en-têtes'; out.proofLabel = 'les en-têtes « ' + kb + ' » et « ' + ka + ' »'; return out; }
            // Repli : convention (la colonne de gauche = les débits).
            out.debitIdx = a; out.creditIdx = b; out.proof = 'convention';
            out.proofLabel = 'aucune preuve — convention appliquée : la colonne de gauche = les débits';
            return out;
          }
        }
      }
    }

    // ── Colonne unique de montant signé ──
    const amountIdx = _bankPickAmountColumn(data, amountCols, headers);
    out.mode = 'signed'; out.amountIdx = amountIdx;
    if (amountIdx < 0) { out.proofLabel = 'aucune colonne de montant trouvée'; return out; }
    let pos = 0, neg = 0;
    for (const r of data) { const v = _bankParseAmount(r && r[amountIdx]); if (v > 0) pos++; else if (v < 0) neg++; }
    if (soldeIdx >= 0) {
      const direct = _bankCheckBalance(data.map(r => ({ signed: _bankParseAmount(r && r[amountIdx]), solde: _bankParseAmount(r && r[soldeIdx]) })));
      if (direct.ok) { out.proof = 'solde'; out.proofLabel = 'le solde de chaque ligne confirme les montants'; return out; }
      const inv = _bankCheckBalance(data.map(r => ({ signed: -_bankParseAmount(r && r[amountIdx]), solde: _bankParseAmount(r && r[soldeIdx]) })));
      if (inv.ok) { out.invert = true; out.proof = 'solde'; out.proofLabel = 'le solde prouve que les montants sont inversés — correction appliquée'; return out; }
    }
    if (pos > 0 && neg > 0) { out.proof = 'signes'; out.proofLabel = 'la colonne contient des montants positifs et négatifs — les négatifs sont les dépenses'; return out; }
    const k = _bankHdr(headers, amountIdx);
    if (_BANK_H_DEBIT.test(k))  { out.allDebit = true;  out.proof = 'en-têtes'; out.proofLabel = 'en-tête « ' + k + ' » : toutes les lignes sont des dépenses'; return out; }
    if (_BANK_H_CREDIT.test(k)) { out.allCredit = true; out.proof = 'en-têtes'; out.proofLabel = 'en-tête « ' + k + ' » : toutes les lignes sont des recettes'; return out; }
    out.proof = 'convention';
    out.proofLabel = 'aucune preuve — convention appliquée : montant positif = recette';
    return out;
  }

  /**
   * ②.5 — LE SOLDE CERTIFIE LA LECTURE. `solde(n) − solde(n−1) = crédit − débit` sur
   * toutes les lignes → prouve d'un coup : bonnes colonnes, aucune ligne oubliée,
   * aucune ligne parasite, montants bien lus, sens non inversé.
   * **Informe, ne bloque pas** ; en cas d'écart, montre LA LIGNE où ça décroche.
   * Gère les relevés chronologiques croissants ET décroissants.
   *
   * @param {{signed:number, solde:number}[]} entries — dans l'ordre du fichier
   * @returns {{checked:boolean, ok:boolean, count:number, brokenAt:number, expected:number, got:number, order:string}}
   */
  function _bankCheckBalance(entries, tol = 0.011) {
    const e = (entries || []).filter(x => x && Number.isFinite(x.solde) && x.solde !== 0);
    const res = { checked: false, ok: false, count: 0, brokenAt: -1, expected: 0, got: 0, order: '' };
    if (e.length < 2) return res;
    res.checked = true;
    // Croissant : solde(n) − solde(n−1) = mouvement(n).
    // Décroissant (Crédit Agricole : le plus récent en tête) : solde(n−1) − solde(n) =
    // mouvement(n−1) — c'est le mouvement de la ligne du DESSUS qui explique l'écart.
    const run = (asc) => {
      let firstBreak = -1, expected = 0, got = 0, breaks = 0;
      for (let i = 1; i < e.length; i++) {
        const delta = asc ? (e[i].solde - e[i - 1].solde) : (e[i - 1].solde - e[i].solde);
        const mv = Number((asc ? e[i] : e[i - 1]).signed) || 0;
        if (Math.abs(delta - mv) > tol) {
          breaks++;
          if (firstBreak < 0) { firstBreak = asc ? i : (i - 1); expected = mv; got = delta; }
        }
      }
      return { breaks, firstBreak, expected, got };
    };
    const asc = run(true), desc = run(false);
    const best = asc.breaks <= desc.breaks ? asc : desc;
    res.order = asc.breaks <= desc.breaks ? 'croissant' : 'décroissant';
    res.count = e.length;
    res.ok = best.breaks === 0;
    res.brokenAt = best.firstBreak;
    res.expected = best.expected;
    res.got = best.got;
    res.breaks = best.breaks;
    return res;
  }

  /**
   * ③.3 v2 — DATES ABERRANTES : on IMPORTE et on MARQUE. Une date éloignée de plus
   * de 12 mois de la période du fichier n'est pas écartée : la ligne atterrit dans
   * « À compléter » avec un badge `⚠ date douteuse`.
   * Mutation en place de `_dateDouteuse`.
   */
  function _bankMarkDoubtfulDates(lines) {
    const arr = Array.isArray(lines) ? lines : [];
    const dates = [...new Set(arr.map(l => l && l.date).filter(Boolean))].sort();
    if (dates.length < 3) return arr;
    // On regroupe les dates par « paquets » séparés de plus de 12 mois, puis on garde
    // le plus gros paquet comme période du relevé. Un historique long mais régulier
    // (5 ans de loyers) reste UN seul paquet — rien n'est marqué ; une date isolée en
    // 2019 au milieu d'un relevé d'août 2026 forme son propre paquet → marquée.
    const gapMonths = (a, b) => {
      const da = new Date(a + 'T00:00:00Z'), db = new Date(b + 'T00:00:00Z');
      return (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + (db.getUTCMonth() - da.getUTCMonth());
    };
    const clusters = [[dates[0]]];
    for (let i = 1; i < dates.length; i++) {
      if (gapMonths(dates[i - 1], dates[i]) > 12) clusters.push([dates[i]]);
      else clusters[clusters.length - 1].push(dates[i]);
    }
    if (clusters.length === 1) {
      for (const l of arr) { if (l && !l.date) l._dateDouteuse = l._dateDouteuse || 'date illisible dans le relevé'; }
      return arr;
    }
    const core = clusters.reduce((a, b) => (b.length > a.length ? b : a));
    const lo = core[0], hi = core[core.length - 1];
    for (const l of arr) {
      if (!l) continue;
      if (!l.date) { l._dateDouteuse = l._dateDouteuse || 'date illisible dans le relevé'; continue; }
      if (l.date < lo || l.date > hi) l._dateDouteuse = 'date éloignée de plus de 12 mois de la période du relevé';
    }
    return arr;
  }

  /**
   * ①.4 — Excel multi-feuilles : on lit **la feuille qui contient des mouvements**
   * (colonne de dates + colonne de montants). Une seule correspond → aucune question.
   * Plusieurs → on affiche leur nom et le nombre de lignes, l'utilisateur choisit.
   * @param {{name:string, rows:Array<Array>}[]} sheets
   * @returns {{name:string, nRows:number, isCandidate:boolean, reason:string}[]}
   */
  function _bankPickSheets(sheets) {
    return (sheets || []).map(s => {
      const head = _bankFindHeaderRow(s.rows || []);
      return {
        name: s.name,
        nRows: head.ok ? head.goodRows : 0,
        isCandidate: !!head.ok,
        reason: head.ok ? (head.goodRows + ' mouvement(s)') : 'aucune colonne de dates + montants',
      };
    });
  }

  /**
   * ②/③ — LECTURE COMPLÈTE D'UN TABLEAU (Excel). Fonction pure : reçoit les lignes
   * brutes, rend les mouvements, les lignes écartées AVEC LEUR MOTIF (T-1) et le
   * récapitulatif de lecture (③.1).
   *
   * @param {Array<Array>} rows
   * @param {{sheetName?:string, invert?:boolean}} [opts]
   * @returns {{ok:boolean, lines:object[], discarded:object[], meta:object}}
   */
  function _bankReadTable(rows, opts = {}) {
    const meta = {
      source: 'xlsx', sheetName: opts.sheetName || '', headerRow: -1,
      dateColLabel: '', dateColKind: 'aucune',
      orientation: '', orientationProof: '', orientationProofLabel: '',
      balance: { checked: false }, period: { from: '', to: '' }, count: 0, currency: 'EUR',
    };
    const head = _bankFindHeaderRow(rows, opts);
    if (!head.ok) {
      return { ok: false, lines: [], discarded: [], meta,
               error: "Aucune colonne de dates + montants trouvée dans cette feuille." };
    }
    meta.headerRow = head.headerRow;
    const headers = head.headers;
    // Colonne de solde : en-tête explicite, sinon la colonne de montants qui « boucle ».
    let soldeIdx = head.amountCols.find(c => _BANK_H_SOLDE.test(_bankHdr(headers, c)));
    if (soldeIdx == null) soldeIdx = -1;
    const dcol = _bankPickDateColumn(headers, head.dateCols);
    meta.dateColLabel = dcol.label; meta.dateColKind = dcol.kind;
    // L'orientation se décide sur les VRAIES lignes de mouvement (celles qui portent une
    // date) : une ligne de total remplit débit ET crédit, ce qui casserait la reconnaissance
    // du couple « deux colonnes jamais remplies ensemble ».
    const oriData = head.data.filter(r => _bankParseDate(r[dcol.idx]));
    const ori = _bankDetectOrientation(oriData.length >= 2 ? oriData : head.data,
      { headers, amountCols: head.amountCols, textCols: head.textCols, soldeIdx });
    // La seule colonne de montants est celle du SOLDE : il n'y a pas de montant
    // d'opération à lire. On le dit franchement plutôt que d'écarter toutes les lignes
    // avec le motif trompeur « montant à 0 € ».
    if (ori.mode !== 'debitCredit' && ori.amountIdx < 0) {
      return { ok: false, lines: [], discarded: [], meta,
               error: "Cette feuille a une colonne de dates et une colonne de solde, mais aucune colonne de montant d'opération." };
    }
    meta.orientation = ori.mode;
    meta.orientationProof = ori.proof;
    meta.orientationProofLabel = ori.proofLabel;
    // Colonnes de libellé : TOUTES les colonnes texte (hors sens) — I-2, aucune troncature,
    // n'importe quel mot ou référence doit pouvoir servir de motif de règle.
    const libCols = head.textCols.filter(c => c !== ori.sensIdx);
    libCols.sort((a, b) => {
      const ka = _BANK_H_LIB.test(_bankHdr(headers, a)) ? 1 : 0;
      const kb = _BANK_H_LIB.test(_bankHdr(headers, b)) ? 1 : 0;
      return (kb - ka) || (a - b);
    });
    const userInvert = !!opts.invert;

    const lines = [], discarded = [], balEntries = [];
    head.data.forEach((r, i) => {
      const date = _bankParseDate(r[dcol.idx]);
      // Devise étrangère → écartée et signalée (③.2), jamais importée à un montant faux.
      let foreign = '';
      for (const c of head.amountCols) { const f = _bankForeignCurrency(r[c]); if (f) { foreign = f; break; } }
      let debit = 0, credit = 0;
      if (ori.mode === 'debitCredit') {
        debit  = Math.abs(_bankParseAmount(r[ori.debitIdx]));
        credit = Math.abs(_bankParseAmount(r[ori.creditIdx]));
      } else if (ori.mode === 'sens') {
        const v = Math.abs(_bankParseAmount(r[ori.amountIdx]));
        const s = _bankNormTxt(r[ori.sensIdx]);
        if (/^(c|cr|credit|cr[ée]dit|\+)$/.test(s)) credit = v; else debit = v;
      } else {
        let v = _bankParseAmount(r[ori.amountIdx]);
        if (ori.invert) v = -v;
        if (ori.allDebit) { debit = Math.abs(v); }
        else if (ori.allCredit) { credit = Math.abs(v); }
        else if (v >= 0) credit = v; else debit = -v;
      }
      if (userInvert) { const t = debit; debit = credit; credit = t; }
      const libelle = libCols.map(c => (r[c] == null ? '' : String(r[c]).replace(/\s+/g, ' ').trim()))
        .filter(Boolean)
        .filter((v, k, a) => a.findIndex(x => _bankNormTxt(x) === _bankNormTxt(v)) === k)
        .join(' · ');
      const rowNo = head.headerRow + 2 + i;   // n° de ligne « comme dans le tableur »
      if (foreign) {
        discarded.push({ index: i, rowNo, date, libelle, amount: credit - debit, reason: 'devise ' + foreign + ' — non convertie', raw: r });
        return;
      }
      if (debit === 0 && credit === 0) {
        discarded.push({ index: i, rowNo, date, libelle, amount: 0, reason: 'montant à 0 €', raw: r });
        return;
      }
      // Ni date ni libellé : ce n'est pas un mouvement dont la date serait illisible (③.3),
      // c'est une ligne de total ou un pied de page. Écartée AVEC SON MOTIF, réintégrable.
      if (!date && !libelle) {
        discarded.push({ index: i, rowNo, date: '', libelle: '', amount: credit - debit,
                         reason: 'ligne sans date ni libellé — total ou pied de page', raw: r });
        return;
      }
      const signed = credit - debit;
      if (soldeIdx >= 0) balEntries.push({ signed, solde: _bankParseAmount(r[soldeIdx]), rowNo, libelle, date });
      lines.push({
        date, libelle, debit, credit, signedAmount: signed,
        raw: r, _rowIndex: i, _rowNo: rowNo,
        _fingerprint: _bankFingerprintRow(date, signed, libelle),
        _importSource: 'xlsx',
        _dateDouteuse: date ? '' : 'date illisible dans le relevé',
      });
    });
    _bankMarkDoubtfulDates(lines);
    if (soldeIdx >= 0) {
      const bal = _bankCheckBalance(balEntries);
      if (bal.checked && bal.brokenAt > 0 && balEntries[bal.brokenAt]) {
        bal.brokenRow = balEntries[bal.brokenAt].rowNo;
        bal.brokenLabel = balEntries[bal.brokenAt].libelle;
        bal.brokenDate = balEntries[bal.brokenAt].date;
      }
      meta.balance = bal;
    }
    const ds = lines.map(l => l.date).filter(Boolean).sort();
    meta.period = { from: ds[0] || '', to: ds[ds.length - 1] || '' };
    meta.count = lines.length;
    return { ok: lines.length > 0, lines, discarded, meta };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ⑦ LES RÈGLES — « L'app propose. Tu valides. Si tu veux que ce soit
  //    automatique, tu en fais une règle. »
  //
  // R-A v2 · AUCUNE RÈGLE LIVRÉE. La liste démarre vide et ne contient que ce que
  // l'utilisateur a créé. Une mise à jour de l'app ne peut JAMAIS créer, modifier ou
  // supprimer une règle : les règles sont les données de l'utilisateur, pas celles de
  // l'app. Les mots-clés du moteur de PROPOSITIONS (✨) ne sont donc pas des règles —
  // ils ne s'appliquent jamais seuls.
  // ════════════════════════════════════════════════════════════════════════════

  /** Sens d'une ligne bancaire : 'cr' (recette) ou 'db' (dépense). */
  function _bankLineSens(line) {
    return (Number(line && line.credit) || 0) > 0 ? 'cr' : 'db';
  }

  /** Une règle porte-t-elle une affectation ? (⑦.2 : l'affectation est UNE valeur, pas 4) */
  function _bankRuleHasAff(r) {
    return !!(r && (r.bailleurDuCompte || r.qui || r.imm || r.compteurCcId));
  }
  function _bankRuleAffKey(r) {
    return (r.bailleurDuCompte ? 'BDC' : '') + '|' + (r.qui || '') + '|' + (r.imm || '') + '|' + (r.compteurCcId || '');
  }

  /**
   * ⑦.1 — Ce qu'une règle sait dire, en 3 critères :
   * **Motif** (le libellé contient ce texte, insensible casse/accents) · **Sens**
   * (dépense / recette / les deux — NOUVEAU) · **Compte** (optionnel).
   *
   * Le sens règle un vrai bug métier : une règle « EDF » attrapait le prélèvement ET
   * le remboursement de trop-perçu, et classait le remboursement en charge.
   *
   * 🐛 **BUG 8 du CDC** : la restriction de compte TOMBAIT quand le compte était
   * inconnu (`rule.compte && accountId && …`) — la règle d'un autre compte
   * s'appliquait quand même. Une règle liée à un compte ne s'applique désormais
   * QU'À ce compte.
   *
   * REGLES-REFONTE (lot D, décisions du 06/10) — deux modèles coexistent :
   *  - règle REFONDUE (porte `mots` / `motsLibres`, cf. `_bankRuleIsV2`) : tous les mots,
   *    sans ordre, compte OBLIGATOIRE et strict (jamais un autre compte, jamais « tous »),
   *    condition de montant, exceptions → `_bankRuleMatchV2` ;
   *  - règle HISTORIQUE (champ `pattern` texte) : comportement EXACT d'avant (sous-chaîne
   *    contiguë, compte vide = tous les comptes) tant qu'elle n'est pas réenregistrée.
   *
   * @param {object} rule
   * @param {object} line — { libelle, credit, debit, date, _fingerprint? }
   * @param {*} accountId — compte du mouvement / de l'import
   * @param {{loyerCC?:Function}} [ctx] — valeurs fournies par l'appelant (condition « = loyer CC »)
   */
  function _bankRuleMatch(rule, line, accountId, ctx) {
    if (!rule || rule._deleted || !line) return false;
    if (_bankRuleIsV2(rule)) return _bankRuleMatchV2(rule, line, accountId, ctx || {});
    if (!rule.pattern) return false;
    if (rule.compte && String(rule.compte) !== String(accountId == null ? '' : accountId)) return false;
    if (rule.sens && rule.sens !== _bankLineSens(line)) return false;
    const pat = _bankNormTxt(rule.pattern);
    if (!pat) return false;
    if (!_bankNormTxt(line.libelle).includes(pat)) return false;
    // Une règle historique n'a pas d'exception tant qu'elle n'est pas réenregistrée :
    // ce test est neutre pour elle (comportement inchangé), défensif sinon.
    return !_bankRuleIsException(rule, line);
  }

  /**
   * ⑦.2 v2 — Quand PLUSIEURS règles correspondent.
   * - **Règles complémentaires** (champs différents) → on applique les deux, et
   *   l'origine de chaque champ est affichée (« catégorie : règle SYNDIC · bien :
   *   règle LES TILLEULS »). C'est le cas légitime, il ne doit pas être traité comme
   *   une erreur.
   * - **Règles en conflit** (même champ, valeurs différentes) → **aucun automatisme** :
   *   la ligne reste « à compléter », les candidates sont affichées avec leur résultat,
   *   l'utilisateur choisit.
   * - Deux règles aboutissant à la même valeur ne sont pas un conflit.
   *
   * @returns {{matched:object[], cat:string, catRule:object|null, aff:object|null,
   *            affRule:object|null, conflicts:{field:string, rules:object[]}[], byRule:boolean}}
   */
  function _bankApplyRules(rules, line, opts = {}) {
    const accountId = opts.accountId;
    // `opts.loyerCC` (facultatif) est transmis à la condition de montant « = loyer CC ».
    const matched = (Array.isArray(rules) ? rules : []).filter(r => _bankRuleMatch(r, line, accountId, opts));
    const out = { matched, cat: '', catRule: null, aff: null, affRule: null, conflicts: [], byRule: false };

    const catRules = matched.filter(r => r.cat);
    const catVals = [...new Set(catRules.map(r => r.cat))];
    if (catVals.length === 1) { out.cat = catVals[0]; out.catRule = catRules[0]; }
    else if (catVals.length > 1) out.conflicts.push({ field: 'cat', rules: catRules });

    const affRules = matched.filter(_bankRuleHasAff);
    const affVals = [...new Set(affRules.map(_bankRuleAffKey))];
    if (affVals.length === 1) {
      const r = affRules[0];
      out.aff = { bailleurDuCompte: !!r.bailleurDuCompte, qui: r.qui || '', imm: r.imm || '', compteurCcId: r.compteurCcId || '' };
      out.affRule = r;
    } else if (affVals.length > 1) out.conflicts.push({ field: 'aff', rules: affRules });

    out.byRule = !!(out.cat || out.aff);
    return out;
  }

  /**
   * R-C — Cas multi-bailleur (ICARUS facture toutes les SCI) : **une seule** règle,
   * dont l'affectation vaut « le bailleur du compte », résolu à l'import depuis le
   * compte reconnu. Une ligne pour tous les bailleurs, et ça reste juste quand une SCI
   * s'ajoute. Un compte mixte ne peut rien résoudre : l'affectation reste vide.
   */
  function _bankResolveAff(aff, account) {
    if (!aff) return { qui: '', imm: '', compteurCcId: '' };
    if (aff.bailleurDuCompte) {
      const b = (account && !account.mixte && account.bailleur) ? account.bailleur : '';
      return { qui: b ? 'SCI:' + b : '', imm: '', compteurCcId: '', unresolved: !b };
    }
    return { qui: aff.qui || '', imm: aff.imm || '', compteurCcId: aff.compteurCcId || '' };
  }

  /**
   * ⑦.4 — APERÇU EN DIRECT à la création d'une règle. Aujourd'hui on tape le motif
   * **à l'aveugle** dans un `prompt()`. Cible : voir, à chaque frappe, les lignes de
   * l'import qui correspondent, le nombre de mouvements déjà en base concernés, et une
   * alerte quand le motif est trop court ou attrape des lignes de natures différentes.
   *
   * ⑦.7 — Fonctionne **sans import** : il s'appuie alors sur les mouvements déjà
   * enregistrés (« ce motif correspond à 17 mouvements existants »).
   *
   * @param {{pattern:string, sens?:string, compte?:string}} draft
   * @param {{importLines?:object[], mouvements?:object[], accountId?:*}} ctx
   * @returns {{lines:object[], nBase:number, baseCats:string[], tooShort:boolean,
   *            mixed:boolean, ok:boolean, level:'', 'warn'|'ok'}}
   */
  function _bankRulePreview(draft, ctx = {}) {
    const pattern = String((draft && draft.pattern) || '').trim();
    const rule = { pattern, sens: (draft && draft.sens) || '', compte: (draft && draft.compte) || '' };
    const out = { lines: [], nBase: 0, baseCats: [], tooShort: false, mixed: false, ok: false, level: '' };
    if (!pattern) return out;
    out.tooShort = pattern.length < 4;
    out.lines = (ctx.importLines || []).filter(l => _bankRuleMatch(rule, l, ctx.accountId));
    // 🐛 REGLES-REFONTE D6 — un mouvement en base est testé avec SON compte
    // (`_bankAccountId`), jamais « comme s'il était du compte courant » : avant, le
    // compteur « déjà en base » et l'alerte « natures différentes » mélangeaient les
    // comptes dès qu'un import était en cours.
    const baseHits = (ctx.mouvements || []).filter(m => {
      if (!m || m._deleted) return false;
      const line = { libelle: m.lib || '', credit: m.cr || 0, debit: m.db || 0 };
      return _bankRuleMatch(rule, line, m._bankAccountId);
    });
    out.nBase = baseHits.length;
    out.baseCats = [...new Set(baseHits.map(m => m.cat).filter(Boolean))];
    // « Natures différentes » = les lignes attrapées n'ont pas toutes le même sens, ou
    // les mouvements déjà en base sont classés dans plusieurs catégories.
    const senses = new Set(out.lines.map(_bankLineSens));
    out.mixed = senses.size > 1 || out.baseCats.length > 1;
    out.ok = !out.tooShort && !out.mixed && (out.lines.length > 0 || out.nBase > 0);
    out.level = (out.tooShort || out.mixed) ? 'warn' : (out.ok ? 'ok' : '');
    return out;
  }

  /**
   * ⑦.7 — Colonne « utilisée » de la liste des règles : « 23 mouvements classés ·
   * dernière fois le 12/08 ». Sert à repérer une règle obsolète ou trop large.
   * S'appuie sur `_rules[]`, la trace laissée sur chaque mouvement importé.
   */
  function _bankRuleUsage(rule, mouvements) {
    const pat = _bankNormTxt(rule && rule.pattern);
    const out = { count: 0, lastDate: '' };
    // REGLES-REFONTE phase 4 — la trace porte désormais l'IDENTIFIANT de la règle ; une
    // trace historique (motif) n'est comptée que pour une règle du même compte que le
    // mouvement (ou une règle sans compte) : la règle d'un autre compte ne l'a pas classé.
    const id = (rule && rule.id != null && rule.id !== '') ? String(rule.id) : '';
    if (!pat && !id) return out;
    const acc = rule && rule.compte ? String(rule.compte) : '';
    for (const m of (mouvements || [])) {
      if (!m || m._deleted || !Array.isArray(m._rules)) continue;
      const parId = !!id && m._rules.some(p => String(p) === id);
      const parMotif = !parId && !!pat && (!acc || String(m._bankAccountId == null ? '' : m._bankAccountId) === acc)
        && m._rules.some(p => _bankNormTxt(p) === pat);
      if (!parId && !parMotif) continue;
      out.count++;
      if ((m.date || '') > out.lastDate) out.lastDate = m.date || '';
    }
    return out;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // REGLES-REFONTE (lot D, maquettes validées le 06/10 — mockups/REGLES-REFONTE/)
  //
  // Modèle refondu d'une règle (les champs historiques sont conservés) :
  //   { id,                         ← identifiant STABLE, la clé (plus le motif)
  //     mots: [],                   ← puces cochées : cherchées comme MOTS ENTIERS
  //     motsLibres: [],             ← mots saisis (« + mot ») : cherchés comme MORCEAUX de mot
  //     pattern,                    ← libellé d'affichage (mots joints), compat. traces/journal
  //     sens: '' | 'cr' | 'db',
  //     compte,                     ← OBLIGATOIRE pour toute règle refondue
  //     montant: null | {type:'loyerCC'} | {type:'exact', valeur} | {type:'plage', min, max},
  //     exceptions: [{cle, date, libelle, montant, sens, _addedAt}],
  //     cat, qui, imm, compteurCcId, bailleurDuCompte, _modifiedAt, … }
  //
  // Tous les mots doivent figurer dans le libellé, SANS ordre ni adjacence, casse et
  // accents ignorés. Une règle historique (`pattern` seul, sans `mots`) garde son
  // comportement exact tant qu'elle n'est pas réenregistrée.
  //
  // Module PUR : aucune lecture de DB. Le loyer CC du mois (condition « = loyer CC »)
  // est FOURNI par l'appelant (`ctx.loyerCC(qui, ym, line)`), l'horodatage aussi
  // (`opts.now`, sinon l'heure courante) et l'identifiant (`opts.newId`).
  // ════════════════════════════════════════════════════════════════════════════

  /** La règle porte-t-elle le modèle refondu (mots choisis) ? Sinon : règle historique (`pattern`). */
  function _bankRuleIsV2(rule) {
    return !!(rule && (Array.isArray(rule.mots) || Array.isArray(rule.motsLibres)));
  }

  /** Horodatage ISO (injectable pour les tests). */
  function _bankNow(opts) {
    return (opts && opts.now) ? String(opts.now) : new Date().toISOString();
  }

  /**
   * Identifiant opaque d'une NOUVELLE règle. Jamais dérivé du motif : modifier les
   * mots ne change pas l'identité de la règle.
   */
  function _bankRuleNewId() {
    try {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return 'rg_' + globalThis.crypto.randomUUID();
    } catch (e) { /* repli ci-dessous */ }
    return 'rg_' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  }

  /** Ramène un mouvement en base ({lib, cr, db}) à la forme « ligne d'import » ({libelle, credit, debit}). */
  function _bankAsLine(x) {
    if (!x) return null;
    if (Object.prototype.hasOwnProperty.call(x, 'libelle')) return x;
    return { date: x.date || '', libelle: x.lib || '', credit: Number(x.cr) || 0, debit: Number(x.db) || 0,
      fitid: x.fitid, _fingerprint: x._fingerprint, _bankAccountId: x._bankAccountId, suggestedCat: x.cat || '' };
  }

  /** Montant absolu d'une ligne, au centime. */
  function _bankLineAmount(line) {
    const cr = Number(line && line.credit) || 0;
    const v = cr > 0 ? cr : Math.abs(Number(line && line.debit) || 0);
    return Math.round(v * 100) / 100;
  }

  /**
   * Clé d'une ligne pour les EXCEPTIONS : l'empreinte de la ligne (FITID ou
   * date|montant|libellé), la même que celle mémorisée sur le mouvement importé —
   * une ligne exclue le reste à la ré-importation du même relevé.
   */
  function _bankRuleLineKey(lineOrMv) {
    const l = _bankAsLine(lineOrMv);
    if (!l) return '';
    if (l._fingerprint) return String(l._fingerprint);
    if (l.fitid && String(l.fitid).trim()) return 'fitid:' + String(l.fitid).trim();
    const cr = Number(l.credit) || 0;
    const signed = cr > 0 ? cr : -Math.abs(Number(l.debit) || 0);
    return _bankFingerprintRow(l.date || '', signed, l.libelle || '');
  }

  /** La ligne est-elle une exception mémorisée de la règle ? */
  function _bankRuleIsException(rule, line) {
    const ex = rule && Array.isArray(rule.exceptions) ? rule.exceptions : null;
    if (!ex || !ex.length) return false;
    const cle = _bankRuleLineKey(line);
    return !!cle && ex.some(e => e && e.cle === cle);
  }

  /** Mots normalisés (uniques) d'une règle refondue. */
  function _bankRuleTokens(rule) {
    const uniq = arr => [...new Set((Array.isArray(arr) ? arr : []).map(_bankNormTxt).filter(Boolean))];
    return { mots: uniq(rule && rule.mots), libres: uniq(rule && rule.motsLibres) };
  }

  /**
   * Le mot figure-t-il dans le texte entouré de séparateurs RÉELS (pas le début ni la fin du texte) ?
   * Sert à comparer un mot entier à un motif historique (sous-chaîne) : en bord de motif, la ligne
   * peut coller d'autres lettres au mot (relecture ciblée B1).
   */
  function _bankMotInterne(texte, motNorm) {
    const w = String(motNorm || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!w) return false;
    return new RegExp('[^\\p{L}\\p{N}]' + w + '(?=[^\\p{L}\\p{N}])', 'u').test(String(texte || ''));
  }

  /** Le mot (normalisé) figure-t-il COMME MOT ENTIER dans le libellé normalisé ? (lettres et chiffres Unicode) */
  function _bankMotEntier(libNorm, motNorm) {
    const w = String(motNorm || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!w) return false;
    return new RegExp('(^|[^\\p{L}\\p{N}])' + w + '(?=[^\\p{L}\\p{N}]|$)', 'u').test(libNorm);
  }

  /**
   * Condition de montant. « loyerCC » = loyer charges comprises du mois du bail du
   * logement affecté (`rule.qui`), recette uniquement ; la valeur est FOURNIE par
   * l'appelant. Valeur absente, nulle ou callback en erreur → la condition ne matche
   * pas (jamais d'élargissement silencieux, jamais d'exception levée).
   */
  function _bankRuleMontantOk(rule, line, ctx) {
    const c = rule.montant;
    if (!c || !c.type) return true;
    const amt = _bankLineAmount(line);
    const eq = (a, b) => Math.abs(a - b) < 0.005;
    if (c.type === 'exact') {
      const v = Number(c.valeur);
      return Number.isFinite(v) && v !== 0 && eq(amt, Math.abs(v));
    }
    if (c.type === 'plage') {
      const lo = (c.min == null || c.min === '') ? -Infinity : Number(c.min);
      const hi = (c.max == null || c.max === '') ? Infinity : Number(c.max);
      if (Number.isNaN(lo) || Number.isNaN(hi)) return false;
      if (lo === -Infinity && hi === Infinity) return false;
      return amt >= lo - 0.005 && amt <= hi + 0.005;
    }
    if (c.type === 'loyerCC') {
      if (_bankLineSens(line) !== 'cr') return false;
      const qui = String(rule.qui || '');
      if (!qui || qui.startsWith('SCI:') || rule.bailleurDuCompte) return false;
      if (!ctx || typeof ctx.loyerCC !== 'function') return false;
      let v;
      try { v = Number(ctx.loyerCC(qui, String(line.date || '').slice(0, 7), line)); } catch (e) { return false; }
      return Number.isFinite(v) && v > 0 && eq(amt, v);
    }
    return false;   // type inconnu : ne matche pas
  }

  /** Correspondance d'une règle REFONDUE (cf. `_bankRuleMatch`). */
  function _bankRuleMatchV2(rule, line, accountId, ctx) {
    // Compte OBLIGATOIRE et strict : jamais un autre compte, jamais « tous les comptes ».
    if (!rule.compte || accountId == null || accountId === '') return false;
    if (String(rule.compte) !== String(accountId)) return false;
    if (rule.sens && rule.sens !== _bankLineSens(line)) return false;
    const t = _bankRuleTokens(rule);
    if (!t.mots.length && !t.libres.length) return false;
    const lib = _bankNormTxt(line.libelle);
    if (!lib) return false;
    if (!t.mots.every(w => _bankMotEntier(lib, w))) return false;
    if (!t.libres.every(w => lib.includes(w))) return false;
    if (_bankRuleIsException(rule, line)) return false;
    return _bankRuleMontantOk(rule, line, ctx);
  }

  /** Motif lisible d'une règle (refondue : mots joints ; historique : `pattern`). */
  function _bankRuleMotif(rule) {
    if (!rule) return '';
    if (_bankRuleIsV2(rule)) return [...(rule.mots || []), ...(rule.motsLibres || [])].map(w => String(w)).join(' ');
    return String(rule.pattern || '');
  }

  /**
   * D4/D5 — Remplace le « mot le plus long deviné » : découpe le libellé en mots
   * (puces cliquables), dans l'ordre, sans doublon (casse/accents ignorés), SANS
   * rien présélectionner.
   * @returns {string[]} les mots tels qu'écrits dans le libellé
   */
  function _bankMotsDuLibelle(libelle) {
    const out = [];
    const seen = new Set();
    const s = String(libelle == null ? '' : libelle).normalize('NFC');
    for (const w of s.split(/[^\p{L}\p{N}]+/u)) {
      if (!w) continue;
      const n = _bankNormTxt(w);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(w);
    }
    return out;
  }

  /** Normalise la condition de montant saisie. */
  function _bankRuleNormMontant(m) {
    if (!m || !m.type) return { montant: null };
    if (m.type === 'loyerCC') return { montant: { type: 'loyerCC' } };
    const num = v => (v === '' || v == null) ? null : (typeof v === 'number' ? v : _bankParseAmount(v));
    const r2 = v => Math.round(Math.abs(v) * 100) / 100;
    if (m.type === 'exact') {
      const v = num(m.valeur);
      if (v == null || !Number.isFinite(v) || v === 0) return { error: 'montant' };
      return { montant: { type: 'exact', valeur: r2(v) } };
    }
    if (m.type === 'plage') {
      const a = num(m.min), b = num(m.max);
      if (a == null && b == null) return { error: 'montant' };
      if ((a != null && !Number.isFinite(a)) || (b != null && !Number.isFinite(b))) return { error: 'montant' };
      const min = a == null ? null : r2(a), max = b == null ? null : r2(b);
      if (min != null && max != null && min > max) return { error: 'montant' };   // rien n'est corrigé en silence
      return { montant: { type: 'plage', min, max } };
    }
    return { error: 'montant' };
  }

  /**
   * Construit (création) ou réenregistre (modification, `opts.base`) une règle
   * refondue, en validant ce que la fenêtre exige.
   * Erreurs : 'mots' (aucun mot) · 'compte' (compte obligatoire) · 'montant' (condition
   * invalide) · 'montant-recette' (« = loyer CC » hors recette) · 'montant-logement'
   * (« = loyer CC » sans logement affecté).
   * Réenregistrer une règle historique la fait passer au modèle refondu (et retire
   * le badge « compte à choisir »). L'identifiant d'une règle existante est conservé.
   *
   * @param {object} draft — { mots, motsLibres, sens, compte, montant, exceptions?, cat, qui, imm, compteurCcId, bailleurDuCompte }
   * @param {{base?:object, newId?:Function, now?:string}} [opts]
   * @returns {{ok:boolean, errors:string[], rule:object|null}}
   */
  function _bankRuleBuild(draft, opts = {}) {
    const d = draft || {};
    const base = opts.base || null;
    const errors = [];
    const clean = (arr, splitSpaces) => {
      const out = [], seen = new Set();
      for (const raw of (Array.isArray(arr) ? arr : [])) {
        const txt = String(raw == null ? '' : raw).trim();
        for (const p of (splitSpaces ? txt.split(/\s+/) : [txt])) {
          const n = _bankNormTxt(p);
          if (!n || seen.has(n)) continue;
          seen.add(n); out.push(p);
        }
      }
      return out;
    };
    const mots = clean(d.mots, false);
    const motsNorm = new Set(mots.map(_bankNormTxt));
    // Un mot saisi identique à une puce cochée est redondant (le mot entier est plus strict).
    // Relecture ciblée A1 : un morceau n'est JAMAIS redécoupé — la fenêtre n'accepte qu'un mot sans
    // espace, seul le motif d'une règle historique (« LOYER DUPONT ») en contient, et il doit rester
    // une sous-chaîne (comportement d'avant la refonte).
    const motsLibres = clean(d.motsLibres, false).filter(w => !motsNorm.has(_bankNormTxt(w)));
    if (!mots.length && !motsLibres.length) errors.push('mots');
    const compte = (d.compte != null && d.compte !== '') ? String(d.compte) : '';
    if (!compte) errors.push('compte');
    const sens = (d.sens === 'cr' || d.sens === 'db') ? d.sens : '';
    const bdc = !!d.bailleurDuCompte;
    // Relecture ciblée B4 : logement et compteur collectif s'excluent (le compteur l'emporte, comme
    // `_bankRulePrefill` et le filet de l'import) — sinon deux règles d'affectation effective
    // identique seraient vues « en conflit » et la ligne resterait à classer.
    const cc = bdc ? '' : String(d.compteurCcId || '');
    const qui = (bdc || cc) ? '' : String(d.qui || '');
    const nm = _bankRuleNormMontant(d.montant);
    if (nm.error) errors.push(nm.error);
    else if (nm.montant && nm.montant.type === 'loyerCC') {
      if (sens !== 'cr') errors.push('montant-recette');
      if (!qui || qui.startsWith('SCI:')) errors.push('montant-logement');
    }
    if (errors.length) return { ok: false, errors, rule: null };
    const now = _bankNow(opts);
    const exSrc = Array.isArray(d.exceptions) ? d.exceptions : (base && Array.isArray(base.exceptions) ? base.exceptions : []);
    const rule = Object.assign({}, base || {}, {
      id: (base && base.id) || d.id || (typeof opts.newId === 'function' ? opts.newId() : _bankRuleNewId()),
      mots, motsLibres,
      pattern: [...mots, ...motsLibres].join(' '),
      sens, compte,
      montant: nm.montant || null,
      exceptions: exSrc.filter(e => e && e.cle).map(e => Object.assign({}, e)),
      cat: String(d.cat || ''),
      qui,
      imm: bdc ? '' : String(d.imm || ''),
      compteurCcId: cc,
      bailleurDuCompte: bdc,
      _modifiedAt: now,
    });
    delete rule.compteAChoisir;
    delete rule._deleted; delete rule._deletedAt;
    if (!base) rule._createdAt = now;
    return { ok: true, errors: [], rule };
  }

  /**
   * Brouillon d'édition d'une règle existante (panneau « Modifier »). Une règle
   * historique ouvre ses mots en « mots saisis » (morceaux de mot : le plus proche de
   * la sous-chaîne d'avant) et signale qu'il faut choisir le compte.
   */
  function _bankRuleToDraft(rule) {
    const r = rule || {};
    const v2 = _bankRuleIsV2(r);
    return {
      id: r.id || '',
      mots: v2 ? (r.mots || []).slice() : [],
      // Relecture ciblée A1 : le motif historique reste UN seul morceau (« LOYER DUPONT », mots côte à
      // côte, dans cet ordre) — le découper en mots cherchés n'importe où élargissait la règle en
      // silence au réenregistrement (« DUPONT MARTIN LOYER GARAGE » rangé en loyer du logement).
      motsLibres: v2 ? (r.motsLibres || []).slice() : (String(r.pattern || '').trim() ? [String(r.pattern).trim().replace(/\s+/g, ' ')] : []),
      sens: r.sens || '', compte: r.compte || '',
      montant: r.montant ? Object.assign({}, r.montant) : null,
      exceptions: (Array.isArray(r.exceptions) ? r.exceptions : []).map(e => Object.assign({}, e)),
      cat: r.cat || '', qui: r.qui || '', imm: r.imm || '', compteurCcId: r.compteurCcId || '',
      bailleurDuCompte: !!r.bailleurDuCompte,
      historique: !v2,
      compteAChoisir: !r.compte,
    };
  }

  /**
   * Décocher une ligne de l'aperçu = « ne rentre pas dans la règle » : exception
   * mémorisée sur la règle (copie stampée renvoyée ; la règle d'origine n'est pas
   * modifiée). Déjà présente → la règle est rendue telle quelle.
   */
  function _bankRuleAddException(rule, lineOrMv, opts = {}) {
    if (!rule) return rule;
    const l = _bankAsLine(lineOrMv);
    const cle = _bankRuleLineKey(l);
    const ex = Array.isArray(rule.exceptions) ? rule.exceptions.slice() : [];
    if (!cle || ex.some(e => e && e.cle === cle)) return rule;
    const now = _bankNow(opts);
    ex.push({ cle, date: l.date || '', libelle: l.libelle || '', montant: _bankLineAmount(l), sens: _bankLineSens(l), _addedAt: now });
    return Object.assign({}, rule, { exceptions: ex, _modifiedAt: now });
  }

  /** Retire une exception (Mes règles). Ne reclasse rien. Copie stampée, ou la règle telle quelle si absente. */
  function _bankRuleRemoveException(rule, cle, opts = {}) {
    if (!rule || !Array.isArray(rule.exceptions)) return rule;
    const ex = rule.exceptions.filter(e => !(e && e.cle === cle));
    if (ex.length === rule.exceptions.length) return rule;
    return Object.assign({}, rule, { exceptions: ex, _modifiedAt: _bankNow(opts) });
  }

  /**
   * Migration DOUCE et IDEMPOTENTE des règles existantes (décision Didier n° 2 : pas
   * d'écran de migration). Chaque règle vivante sans `id` en reçoit un ; celles sans
   * compte sont marquées `compteAChoisir` (badge « Compte à choisir »). Le motif, le
   * compte et le comportement ne changent PAS (la règle reste historique). Aucune
   * règle supprimée ni fusionnée (R-A v2 : ce sont les données de l'utilisateur).
   * Les tombstones sont laissés tels quels.
   *
   * L'identifiant attribué est calculé UNE FOIS depuis la position et le contenu de
   * la règle à cet instant (jamais recalculé ensuite) : deux appareils qui migrent la
   * même base obtiennent les mêmes identifiants. 🐛 Audit (M3) — le contenu pris en
   * compte EXCLUT les horodatages (`_modifiedAt`, `_createdAt`, `_addedAt`… : tout champ
   * `_…At`, à tous les niveaux) et ne dépend pas de l'ordre des clés (un objet relu depuis
   * le serveur peut les rendre dans un autre ordre) : une règle qui ne diffère que par son
   * horodatage d'un appareil à l'autre reçoit le même identifiant.
   *
   * @param {object[]} rules — DB.importRules (modifié en place ; absent → rien)
   * @returns {{migrated:number, skipped:number}}
   */
  function _bankMigrateRules(rules, opts = {}) {
    let migrated = 0, skipped = 0;
    if (!Array.isArray(rules)) return { migrated, skipped };
    const now = _bankNow(opts);
    const used = new Set(rules.map(r => r && r.id).filter(Boolean).map(String));
    rules.forEach((r, i) => {
      if (!r || typeof r !== 'object' || r._deleted || r.id) { skipped++; return; }
      // Relecture ciblée A2 : contenu SEUL (sans la position) — une règle ajoutée ou supprimée plus haut
      // sur un appareil ne décale plus les identifiants des suivantes ; deux règles identiques sont
      // départagées par le suffixe « -n », dans l'ordre de la liste.
      let id = 'rg_' + _bankHashStable(_bankRuleContenuStable(r));
      for (let n = 2; used.has(id); n++) id = id.replace(/-\d+$/, '') + '-' + n;
      used.add(id);
      r.id = id;
      if (!r.compte) r.compteAChoisir = true;
      r._modifiedAt = now;
      migrated++;
    });
    return { migrated, skipped };
  }

  /** Champ d'horodatage (volatil d'un appareil à l'autre) : `_modifiedAt`, `_createdAt`, `_addedAt`… */
  function _bankEstHorodatage(k) {
    return /^_[A-Za-z]*At$/.test(String(k));
  }

  /** Contenu d'une règle pour son identifiant de migration : sans horodatage, clés triées. */
  function _bankRuleContenuStable(v) {
    if (Array.isArray(v)) return '[' + v.map(_bankRuleContenuStable).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).filter(k => !_bankEstHorodatage(k) && v[k] !== undefined).sort()
        .map(k => JSON.stringify(k) + ':' + _bankRuleContenuStable(v[k])).join(',') + '}';
    }
    return JSON.stringify(v === undefined ? null : v);
  }

  /** D6 — Retrouve une règle PAR SON IDENTIFIANT (remplace `_bankRuleIdxOf(pattern)`). -1 si absente ou supprimée. */
  function _bankRuleIdxById(rules, id) {
    if (id == null || id === '') return -1;
    return (Array.isArray(rules) ? rules : []).findIndex(r => r && !r._deleted && r.id != null && String(r.id) === String(id));
  }

  /** La règle vivante d'identifiant `id`, ou null. */
  function _bankRuleById(rules, id) {
    const i = _bankRuleIdxById(rules, id);
    return i >= 0 ? rules[i] : null;
  }

  /**
   * Retrouve la règle qui a classé un mouvement depuis sa trace (`m._rules[]`) :
   * un identifiant d'abord ; sinon (trace historique = motif) une règle du MÊME
   * compte que le mouvement — la règle d'un autre compte n'a pas pu le classer.
   */
  function _bankRuleFindForTrace(rules, trace, accountId) {
    const byId = _bankRuleById(rules, trace);
    if (byId) return byId;
    const p = _bankNormTxt(trace);
    if (!p) return null;
    const acc = accountId == null ? '' : String(accountId);
    const cands = (Array.isArray(rules) ? rules : []).filter(r => r && !r._deleted
      && _bankNormTxt(_bankRuleMotif(r)) === p && (!r.compte || String(r.compte) === acc));
    return cands.find(r => r.compte && String(r.compte) === acc) || cands[0] || null;
  }

  /**
   * Tombstone d'une règle supprimée, indexé sur son IDENTIFIANT (le motif et le
   * compte restent pour la compat et le journal). À poser EN PLACE dans
   * DB.importRules (jamais de splice : cf. v15.186).
   */
  function _bankRuleTombstone(rule, opts = {}) {
    const now = _bankNow(opts);
    const t = { _deleted: true, _deletedAt: now, _modifiedAt: now };
    if (rule && rule.id != null && rule.id !== '') t.id = rule.id;
    t.pattern = (rule && rule.pattern) || '';
    if (rule && rule.compte) t.compte = rule.compte;
    return t;
  }

  /**
   * ⚠ NON BRANCHÉE (audit M4) : aucun code de l'app n'appelle cette fonction. Aujourd'hui
   * `DB.importRules` voyage dans le bloc de configuration de l'espace, qui est REMPLACÉ EN
   * ENTIER à chaque écriture (pas de fusion règle par règle : le dernier appareil qui écrit
   * fixe toute la liste). Elle est prête et testée pour le jour où la synchro fusionnera
   * les règles ; ne pas supposer qu'elle protège quoi que ce soit avant ce branchement.
   *
   * Fusion de deux listes de règles (deux appareils, une restauration…), clé =
   * identifiant (à défaut, pour une règle historique : motif + compte). Deux règles
   * de même motif sur deux comptes ne se confondent donc plus. Le plus récent
   * (`_modifiedAt`) gagne, SAUF qu'une suppression gagne toujours : un identifiant
   * supprimé ne ressuscite jamais (une re-création porte un nouvel identifiant).
   * Un tombstone HISTORIQUE (sans id, motif seul) n'éteint PAS une règle qui a reçu un
   * id : on ne sait pas distinguer « la même règle migrée ailleurs » d'« une règle
   * recréée avec le même motif », et perdre une règle de l'utilisateur est pire (R-A v2).
   * @returns {object[]} nouvelle liste (les objets d'entrée ne sont pas modifiés)
   */
  function _bankRulesMergeById(local, remote) {
    const keyOf = r => (r.id != null && r.id !== '') ? 'id:' + r.id : 'pat:' + _bankNormTxt(r.pattern) + '|' + (r.compte || '');
    const ts = r => Date.parse((r && r._modifiedAt) || '') || 0;
    const out = [];
    const idx = new Map();
    const add = r => {
      if (!r || typeof r !== 'object') return;
      const k = keyOf(r);
      if (!idx.has(k)) { idx.set(k, out.length); out.push(r); return; }
      const cur = out[idx.get(k)];
      if (cur._deleted) return;                                   // supprimée = définitif
      if (r._deleted || ts(r) > ts(cur)) out[idx.get(k)] = r;
    };
    (Array.isArray(local) ? local : []).forEach(add);
    (Array.isArray(remote) ? remote : []).forEach(add);
    return out;
  }

  /** Clé du RÉSULTAT d'une règle (catégorie + affectation). */
  function _bankRuleResultKey(r) {
    return (r.cat || '') + '#' + _bankRuleAffKey(r);
  }

  /** Clé des CRITÈRES d'une règle (compte, sens, motif, montant). */
  function _bankRuleCritKey(r) {
    const t = _bankRuleTokens(r);
    const motif = _bankRuleIsV2(r) ? [t.mots.slice().sort(), t.libres.slice().sort()] : ['§', _bankNormTxt(r.pattern)];
    return JSON.stringify([String(r.compte || ''), r.sens || '', motif, r.montant || null]);
  }

  /**
   * D3 — Création d'un DOUBLON EXACT refusée : renvoie la règle vivante déjà
   * identique (mêmes compte, sens, mots, condition de montant ET même résultat), ou
   * null. La règle elle-même (même objet ou même id) n'est pas son propre doublon.
   */
  function _bankRuleExactDuplicate(rules, candidate) {
    if (!candidate) return null;
    const k = _bankRuleCritKey(candidate) + '§' + _bankRuleResultKey(candidate);
    return (Array.isArray(rules) ? rules : []).find(r => r && !r._deleted && r !== candidate
      && !(candidate.id != null && candidate.id !== '' && r.id === candidate.id)
      && _bankRuleCritKey(r) + '§' + _bankRuleResultKey(r) === k) || null;
  }

  /** Condition de montant normalisée (comparaison de deux règles). */
  function _bankRuleMontantKey(r) {
    const m = r && r.montant && r.montant.type ? r.montant : null;
    if (!m) return '';
    if (m.type === 'exact') return 'exact|' + Math.round(Math.abs(Number(m.valeur) || 0) * 100);
    if (m.type === 'plage') {
      const b = v => (v == null || v === '') ? '' : String(Math.round(Math.abs(Number(v) || 0) * 100));
      return 'plage|' + b(m.min) + '|' + b(m.max);
    }
    return String(m.type);
  }

  /**
   * La règle `a` attrape-t-elle TOUTES les lignes que `b` attrape ? (a est alors au moins aussi
   * large que b.) Tous les mots de `a` se retrouvent dans `b`, le sens de `a` est « les deux » ou
   * celui de `b`, et — audit I2 — la condition de montant est LA MÊME : deux règles « LOYER
   * DUPONT » dont l'une exige « = loyer CC » et l'autre « = 700 € » n'attrapent pas les mêmes
   * lignes, ce ne sont pas des doublons.
   */
  function _bankRuleCovers(a, b) {
    if (_bankRuleMontantKey(a) !== _bankRuleMontantKey(b)) return false;
    if (a.sens && a.sens !== b.sens) return false;
    const ta = _bankRuleIsV2(a) ? _bankRuleTokens(a) : { mots: [], libres: [_bankNormTxt(a.pattern)].filter(Boolean) };
    const bLegacy = !_bankRuleIsV2(b);
    const tb = bLegacy ? { mots: [], libres: [] } : _bankRuleTokens(b);
    const bText = bLegacy ? _bankNormTxt(b.pattern) : '';
    if (!ta.mots.length && !ta.libres.length) return false;
    if (bLegacy && !bText) return false;
    // Relecture ciblée B1 : un motif historique est une SOUS-CHAÎNE — « PRLV EDF » attrape
    // « PRLV EDFENR ». Un mot entier de `a` ne le couvre que s'il y est entouré de séparateurs
    // DANS le motif lui-même (« SEPA » dans « PRLV SEPA EDF ») ; jamais en bord de motif.
    const motOk = w => tb.mots.includes(w) || (bLegacy && _bankMotInterne(bText, w));
    const libreOk = s => tb.mots.some(x => x.includes(s)) || tb.libres.some(x => x.includes(s)) || (bLegacy && bText.includes(s));
    return ta.mots.every(motOk) && ta.libres.every(libreOk);
  }

  /**
   * Laquelle GARDER entre deux règles en doublon : la plus LARGE, celle qui attrape aussi toutes
   * les lignes de l'autre (audit I2 : garder la plus précise faisait perdre le classement des
   * lignes que seule la large attrapait — « VIR SARAR 150 » sans « SYNDIC »). À égalité (chacune
   * couvre l'autre) : la première.
   */
  function _bankRulePlusLarge(a, b) {
    if (_bankRuleCovers(a, b)) return a;
    if (_bankRuleCovers(b, a)) return b;
    return a;
  }

  /** Une exception de `garder` porte-t-elle sur une ligne que `retirer` attrape ? (relecture ciblée B2) */
  function _bankRuleExclutCeQueClasse(garder, retirer) {
    const ex = Array.isArray(garder && garder.exceptions) ? garder.exceptions : [];
    return ex.some(e => {
      if (!e) return false;
      if ((retirer.exceptions || []).some(x => x && x.cle === e.cle)) return false;   // l'autre l'exclut aussi : rien n'est perdu
      const m = Math.abs(Number(e.montant) || 0);
      const ligne = { libelle: e.libelle || '', date: e.date || '', credit: e.sens === 'cr' ? m : 0, debit: e.sens === 'cr' ? 0 : m };
      // montant « = loyer CC » : valeur inconnue ici → la ligne est réputée attrapée (prudence : pas de fusion)
      const r = (retirer.montant && retirer.montant.type === 'loyerCC') ? Object.assign({}, retirer, { montant: null }) : retirer;
      return _bankRuleMatch(Object.assign({}, r, { exceptions: [] }), ligne, retirer.compte || '');
    });
  }

  /** « Garder les deux » a-t-il été choisi pour cette paire (dans un sens ou dans l'autre) ? */
  function _bankRuleGardeLesDeux(a, b) {
    const lists = (x, y) => !!(x && y && y.id != null && y.id !== '' && Array.isArray(x.gardeAvec) && x.gardeAvec.some(i => String(i) === String(y.id)));
    return lists(a, b) || lists(b, a);
  }

  /**
   * Mes règles — signal de DOUBLON : même compte, même résultat, même condition de montant,
   * et l'une attrape toutes les lignes de l'autre (`_bankRuleCovers` : mots inclus, sens
   * compatible). Deux règles de sens opposés (dépense / recette) ne peuvent jamais attraper
   * la même ligne : ce n'est pas un doublon. `garder` = la plus LARGE (rien n'est perdu à la
   * fusion), `retirer` = celle qu'elle couvre.
   * @returns {{a:object, b:object, garder:object, retirer:object}[]}
   */
  function _bankRulesDuplicates(rules) {
    const live = (Array.isArray(rules) ? rules : []).filter(r => r && !r._deleted);
    const out = [];
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        if (String(a.compte || '') !== String(b.compte || '')) continue;
        if (_bankRuleResultKey(a) !== _bankRuleResultKey(b)) continue;
        if (a.sens && b.sens && a.sens !== b.sens) continue;
        if (_bankRuleGardeLesDeux(a, b)) continue;            // « Garder les deux » : le signal ne revient pas
        if (!_bankRuleCovers(a, b) && !_bankRuleCovers(b, a)) continue;
        const garder = _bankRulePlusLarge(a, b);
        const retirer = garder === a ? b : a;
        // Relecture ciblée B2 : la fusion réunit les exceptions ; si la règle gardée exclut une ligne
        // que l'autre classe, la fusion lui ferait perdre son classement → ce n'est pas un doublon.
        if (_bankRuleExclutCeQueClasse(garder, retirer)) continue;
        out.push({ a, b, garder, retirer });
      }
    }
    return out;
  }

  /**
   * « Fusionner » deux règles en doublon (fonction pure) : garde la plus LARGE (celle qui
   * attrape aussi toutes les lignes de l'autre : aucune ligne ne perd son classement),
   * réunit les exceptions des deux, et fournit le tombstone de l'autre (à poser en place
   * par l'appelant). Les objets d'entrée ne sont pas modifiés.
   * @returns {{garder:object, retirer:object, tombstone:object}}
   */
  function _bankRulesFuse(a, b, opts = {}) {
    const keep = _bankRulePlusLarge(a, b);
    const drop = keep === a ? b : a;
    const now = _bankNow(opts);
    const ex = [];
    const seen = new Set();
    for (const e of [...(keep.exceptions || []), ...(drop.exceptions || [])]) {
      if (!e || !e.cle || seen.has(e.cle)) continue;
      seen.add(e.cle); ex.push(Object.assign({}, e));
    }
    const garder = Object.assign({}, keep, { _modifiedAt: now });
    if (ex.length || Array.isArray(keep.exceptions)) garder.exceptions = ex;
    return { garder, retirer: drop, tombstone: _bankRuleTombstone(drop, { now }) };
  }

  /**
   * « Garder les deux » (Mes règles) : mémorise, sur la règle `a`, que la paire (a, b) est voulue.
   * Solution simple : un champ `gardeAvec` (liste d'identifiants) sur UNE des deux règles ; il voyage
   * avec elle à la synchro, et `_bankRulesDuplicates` ne signale plus la paire. Copie stampée ;
   * la règle d'origine n'est pas modifiée ; déjà mémorisé → règle rendue telle quelle.
   */
  function _bankRuleGarderLesDeux(a, b, opts = {}) {
    if (!a || !b || b.id == null || b.id === '') return a;
    if (_bankRuleGardeLesDeux(a, b)) return a;
    const ids = (Array.isArray(a.gardeAvec) ? a.gardeAvec : []).concat([String(b.id)]);
    return Object.assign({}, a, { gardeAvec: ids, _modifiedAt: _bankNow(opts) });
  }

  /**
   * Mes règles — doublons indexés par la règle À RETIRER : `{ [id]: règle à garder }`.
   * (Le message de doublon s'affiche sur la règle couverte — la plus précise —, et le bouton
   * dit laquelle est gardée : la plus large.)
   */
  function _bankRulesDoublonsParId(rules) {
    const out = {};
    for (const d of _bankRulesDuplicates(rules)) {
      if (d.retirer && d.retirer.id != null && d.retirer.id !== '' && !out[d.retirer.id]) out[d.retirer.id] = d.garder;
    }
    return out;
  }

  /**
   * Mes règles — regroupement par COMPTE (fonction pure).
   *  - `sansCompte` : règles historiques sans compte (« Compte à choisir »), toujours affichées, en tête ;
   *  - `groupes` : un par compte vivant (ordre des comptes), seulement ceux qui ont des règles ;
   *  - `inconnus` : règles dont le compte n'existe plus (jamais masquées en silence) ;
   *  - filtre bailleur (`opts.bailleur`, vide ou « all » = Voir tout) : un compte d'un AUTRE bailleur est
   *    masqué ; un compte mixte ou sans bailleur n'est jamais masqué (on ne cache rien faute de savoir).
   *  - `bailleurs` : bailleurs distincts des comptes (pour le filtre) ; `masquees` : règles cachées par le filtre.
   * Les règles supprimées (`_deleted`) sont ignorées.
   * @param {object[]} rules
   * @param {{id:*, label?:string, bailleur?:string, mixte?:boolean, _deleted?:boolean}[]} accounts
   * @param {{bailleur?:string}} [opts]
   */
  function _bankRulesParCompte(rules, accounts, opts = {}) {
    const live = (Array.isArray(rules) ? rules : []).filter(r => r && !r._deleted);
    const accs = (Array.isArray(accounts) ? accounts : []).filter(a => a && !a._deleted);
    const N = _bankNormTxt;
    const bailleurs = [];
    accs.forEach(a => {
      const b = !a.mixte && a.bailleur ? String(a.bailleur).trim() : '';
      if (b && !bailleurs.some(x => N(x) === N(b))) bailleurs.push(b);
    });
    const filtre = (opts.bailleur && opts.bailleur !== 'all') ? String(opts.bailleur) : '';
    const visible = a => {
      if (!filtre || a.mixte || !a.bailleur || !String(a.bailleur).trim()) return true;
      return N(a.bailleur) === N(filtre);
    };
    const out = { sansCompte: [], groupes: [], inconnus: [], bailleurs, filtre, masquees: 0, bailleursMasques: [] };
    const known = new Set(accs.map(a => String(a.id)));
    out.sansCompte = live.filter(r => r.compte == null || r.compte === '');
    out.inconnus = live.filter(r => r.compte != null && r.compte !== '' && !known.has(String(r.compte)));
    accs.forEach(a => {
      const regles = live.filter(r => r.compte != null && r.compte !== '' && String(r.compte) === String(a.id));
      if (!regles.length) return;
      if (!visible(a)) {
        out.masquees += regles.length;
        const b = String(a.bailleur).trim();
        if (!out.bailleursMasques.some(x => N(x) === N(b))) out.bailleursMasques.push(b);
        return;
      }
      out.groupes.push({ compte: a, regles });
    });
    return out;
  }

  /**
   * Mes règles — ce que la liste affiche d'une règle (fonction pure) : mots cochés, mots « saisis »
   * (une règle historique n'a que des morceaux de mot), exceptions. Aucune statistique d'utilisation.
   */
  function _bankRuleVue(rule) {
    const r = rule || {};
    const v2 = _bankRuleIsV2(r);
    // Relecture ciblée A1 : un motif historique s'affiche comme il se cherche — UN morceau (« VIR LOYER JEAN »).
    const motsLibres = v2 ? (r.motsLibres || []).slice() : (String(r.pattern || '').trim() ? [String(r.pattern).trim().replace(/\s+/g, ' ')] : []);
    return {
      id: r.id != null ? String(r.id) : '',
      mots: v2 ? (r.mots || []).slice() : [],
      motsLibres,
      sens: r.sens === 'cr' || r.sens === 'db' ? r.sens : '',
      montant: r.montant && r.montant.type ? r.montant : null,
      exceptions: (Array.isArray(r.exceptions) ? r.exceptions : []).filter(e => e && e.cle),
      compteAChoisir: !r.compte,
      historique: !v2,
    };
  }

  /**
   * D5 — APERÇU d'une règle candidate (création ou modification).
   *  - lignes de l'import en cours qui correspondent, chacune COCHÉE ou DÉCOCHÉE
   *    (décochée = exception de la règle) ; la ligne SOURCE est toujours incluse,
   *    cochée et verrouillée, même quand elle ne correspond pas (`correspond:false`
   *    → l'écran signale qu'elle ne suivrait plus la règle) ;
   *  - 🐛 audit M2 — une ligne de l'import DÉJÀ CLASSÉE À LA MAIN (`_userEdited` / `_reviewed`),
   *    autre que la source, est marquée `protegee` : à l'enregistrement elle est laissée telle
   *    quelle (cf. `_bankReclassifyPrepare`), elle n'est donc PAS comptée dans `nSuivront`
   *    (« N lignes suivront la règle ») mais dans `nProtegees` (« laissées telles quelles ») ;
   *  - compteur « en base » informatif, du MÊME compte uniquement ;
   *  - alerte « natures différentes » calculée sur les lignes COCHÉES DE L'IMPORT
   *    (nature = catégorie proposée, ou sens différents).
   * Le compte de la règle, à défaut celui de l'import (`ctx.accountId`), est le seul
   * considéré : une règle ne voit jamais les mouvements d'un autre compte.
   *
   * @param {object} regle — règle candidate (modèle refondu ou historique)
   * @param {{importLines?:object[], mouvements?:object[], accountId?:*, source?:object,
   *          sourceIndex?:number, loyerCC?:Function}} ctx
   * @returns {{lignes:{line:object, index:number, cle:string, source:boolean, verrouille:boolean,
   *            coche:boolean, correspond:boolean, protegee:boolean}[], nCochees:number,
   *            nSuivront:number, nProtegees:number, nBase:number, baseCats:string[],
   *            natures:string[], mixed:boolean, tooShort:boolean, vide:boolean, compteManquant:boolean,
   *            sourceCorrespond:boolean|null, level:''|'warn'|'ok'}}
   */
  function _bankRuleApercu(regle, ctx = {}) {
    const r = regle || {};
    const importAcc = (ctx.accountId != null && ctx.accountId !== '') ? String(ctx.accountId) : '';
    const compte = (r.compte != null && r.compte !== '') ? String(r.compte) : importAcc;
    const exKeys = new Set((Array.isArray(r.exceptions) ? r.exceptions : []).map(e => e && e.cle).filter(Boolean));
    // On teste la règle SANS ses exceptions : une ligne exclue reste listée, décochée.
    const cand = Object.assign({}, r, { compte, exceptions: [] });
    delete cand._deleted;
    const t = _bankRuleIsV2(cand) ? _bankRuleTokens(cand) : { mots: [], libres: [_bankNormTxt(cand.pattern)].filter(Boolean) };
    const motifLen = [...t.mots, ...t.libres].join(' ').length;
    const out = { lignes: [], nCochees: 0, nSuivront: 0, nProtegees: 0, nBase: 0, baseCats: [], natures: [], mixed: false, tooShort: false,
      vide: motifLen === 0, compteManquant: !compte, sourceCorrespond: null, level: '' };
    const canMatch = !out.vide && !!compte;
    const match = (l, acc) => canMatch && _bankRuleMatch(cand, l, acc, ctx);

    const src = ctx.source ? _bankAsLine(ctx.source) : null;
    const srcKey = src ? _bankRuleLineKey(src) : '';
    let srcRow = null;
    (Array.isArray(ctx.importLines) ? ctx.importLines : []).forEach((l, index) => {
      if (!l) return;
      const cle = _bankRuleLineKey(l);
      const isSrc = (ctx.sourceIndex != null && ctx.sourceIndex === index) || (!!srcKey && cle === srcKey && !srcRow);
      const ok = match(l, importAcc);
      if (!ok && !isSrc) return;
      const row = { line: l, index, cle, source: isSrc, verrouille: isSrc, coche: isSrc || !exKeys.has(cle), correspond: ok,
        protegee: !isSrc && !!(l._userEdited || l._reviewed) };
      if (isSrc) srcRow = row;
      out.lignes.push(row);
    });
    if (src && !srcRow) {
      const acc = (src._bankAccountId != null && src._bankAccountId !== '') ? String(src._bankAccountId) : importAcc;
      srcRow = { line: src, index: -1, cle: srcKey, source: true, verrouille: true, coche: true, correspond: match(src, acc), protegee: false };
      out.lignes.push(srcRow);
    }
    if (srcRow) {
      out.lignes = [srcRow, ...out.lignes.filter(x => x !== srcRow)];
      out.sourceCorrespond = srcRow.correspond;
    }

    if (canMatch) {
      const hits = (Array.isArray(ctx.mouvements) ? ctx.mouvements : []).filter(m => {
        if (!m || m._deleted) return false;
        if (String(m._bankAccountId == null ? '' : m._bankAccountId) !== compte) return false;
        const k = _bankRuleLineKey(m);
        if (srcKey && k === srcKey) return false;           // la source est déjà listée
        if (exKeys.has(k)) return false;
        return _bankRuleMatch(cand, _bankAsLine(m), compte, ctx);
      });
      out.nBase = hits.length;
      out.baseCats = [...new Set(hits.map(m => m.cat).filter(Boolean))];
    }

    const cochees = out.lignes.filter(x => x.coche && x.index >= 0);
    out.nCochees = out.lignes.filter(x => x.coche).length;
    const importCochees = out.lignes.filter(x => x.index >= 0 && x.coche && x.correspond);
    out.nProtegees = importCochees.filter(x => x.protegee).length;
    out.nSuivront = importCochees.length - out.nProtegees;
    out.natures = [...new Set(cochees.map(x => x.line.suggestedCat).filter(Boolean))];
    const senses = new Set(cochees.map(x => _bankLineSens(x.line)));
    out.mixed = out.natures.length > 1 || senses.size > 1;
    out.tooShort = !out.vide && motifLen < 4;
    out.level = (out.vide || (!out.lignes.length && !out.nBase && !out.compteManquant)) ? ''
      : ((out.tooShort || out.mixed || out.compteManquant || out.sourceCorrespond === false) ? 'warn' : 'ok');
    return out;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // REGLES-REFONTE phase 4 — APPLICATION (décisions Didier du 06/10).
  // La règle s'applique : (a) à la ligne SOURCE immédiatement, (b) aux lignes de
  // l'import en cours, (c) aux imports futurs. JAMAIS aux mouvements déjà en base,
  // sauf le mouvement d'où la règle est créée (fiche d'un mouvement enregistré).
  // Jamais d'écrasement silencieux d'un classement fait à la main : ces lignes sont
  // sautées ET comptées, pour que l'écran le dise.
  // ════════════════════════════════════════════════════════════════════════════

  /** Ce qu'une ligne / un mouvement garde comme trace d'une règle : son identifiant (à défaut, son motif). */
  function _bankRuleTraceKey(rule) {
    if (!rule) return '';
    return (rule.id != null && rule.id !== '') ? String(rule.id) : String(rule.pattern || '');
  }

  /** Affectation qu'une règle poserait (résolue sur le compte), ou null si la règle n'en porte pas. */
  function _bankRuleAffResolved(rule, account) {
    if (!_bankRuleHasAff(rule)) return null;
    return _bankResolveAff({ bailleurDuCompte: !!rule.bailleurDuCompte, qui: rule.qui || '', imm: rule.imm || '',
      compteurCcId: rule.compteurCcId || '' }, account || null);
  }

  /**
   * Classe UNE ligne d'import avec les règles vivantes (ex-inline `_bankApplyRule`).
   * Modifie la ligne. Trace `_rules` = identifiants des règles ; `_ruleOrigin` porte le
   * motif lisible ET l'identifiant (pour rouvrir LA bonne règle, jamais par motif).
   * @param {object[]} rules
   * @param {object} line
   * @param {{accountId?:*, account?:object, loyerCC?:Function}} [opts]
   * @returns {boolean} une règle a classé quelque chose
   */
  function _bankLineApplyRules(rules, line, opts = {}) {
    if (!line) return false;
    const live = (Array.isArray(rules) ? rules : []).filter(r => r && !r._deleted);
    const res = _bankApplyRules(live, line, { accountId: opts.accountId, loyerCC: opts.loyerCC });
    line._ruleConflicts = res.conflicts.length ? res.conflicts : null;
    line._ruleOrigin = null;
    line._rules = res.matched.map(_bankRuleTraceKey).filter(Boolean);
    if (!res.byRule) return false;
    const aff = _bankResolveAff(res.aff, opts.account || null);
    // « Je choisis des choses dans la règle, on les récupère après » (Didier, 06/10) : une règle
    // refondue n'applique QUE les champs qu'elle définit et n'efface jamais les autres (une règle
    // « catégorie seule » laisse l'affectation de la ligne, une règle « affectation seule » sa
    // catégorie). Seules les règles historiques (sans `mots`) gardent l'ancien comportement exact :
    // le champ non défini est remis à vide. Une affectation « bailleur du compte » non résolvable
    // (compte mixte) n'efface rien non plus.
    const garde = res.matched.some(_bankRuleIsV2);
    line.suggestedCat = res.cat || (garde ? (line.suggestedCat || '') : '');
    if ((res.aff && !aff.unresolved) || !garde) {
      line.suggestedQui = aff.qui || '';
      line.suggestedImm = aff.imm || '';
      line.suggestedCc  = aff.compteurCcId || '';
    }
    line.confidence   = 1;                        // déterministe : c'est une règle, pas une proposition
    line.matchSource  = 'Règle d\'import';
    line._byRule      = true;
    line._ruleOrigin = {
      cat: res.catRule ? _bankRuleMotif(res.catRule) : '',
      catId: res.catRule ? _bankRuleTraceKey(res.catRule) : '',
      aff: res.affRule ? (res.affRule.bailleurDuCompte ? 'le bailleur du compte' : _bankRuleMotif(res.affRule)) : '',
      affId: res.affRule ? _bankRuleTraceKey(res.affRule) : '',
      affUnresolved: !!aff.unresolved,
    };
    return true;
  }

  const _BANK_CLASSEMENT_FIELDS = ['suggestedCat', 'suggestedQui', 'suggestedImm', 'suggestedCc', 'confidence', 'matchSource',
    '_byRule', '_ruleConflicts', '_ruleOrigin', '_ambiguous', '_candidates', '_autresRegles', '_regleSource',
    'isDuplicate', 'duplicateOf', 'duplicateReason', 'dupLevel'];

  /** Classement d'une ligne au format « ligne d'import » (suggested*), depuis une ligne ou un mouvement enregistré. */
  function _bankClassementDe(x) {
    if (!x) return { cat: '', qui: '', imm: '', cc: '' };
    if (Object.prototype.hasOwnProperty.call(x, 'libelle')) {
      return { cat: x.suggestedCat || '', qui: x.suggestedQui || '', imm: x.suggestedImm || '', cc: x.suggestedCc || '' };
    }
    return { cat: x.cat || '', qui: x.qui || '', imm: x.imm || '', cc: x.compteurCcId || '' };
  }

  /** L'affectation `aff` (résolue) est-elle déjà celle du classement `c` ? Comparée sur ce que l'affectation désigne. */
  function _bankAffEgale(aff, c) {
    if (aff.compteurCcId) return c.cc === aff.compteurCcId;
    if (aff.qui) return c.qui === aff.qui;
    if (aff.imm) return !c.qui && c.imm === aff.imm;
    return true;
  }

  /**
   * 🐛 Audit B1 — Les AUTRES règles actives qui attrapent aussi la ligne de départ d'une règle
   * qu'on crée (ou modifie), et qui y donneraient un AUTRE résultat. La règle créée gagne pour
   * CETTE ligne (c'est sa source) ; ces règles-là sont signalées, jamais appliquées en silence.
   * Le résultat comparé est celui de la ligne APRÈS la règle : ce que la règle définit, et pour
   * le reste ce que la ligne porte déjà (une règle n'efface jamais ce qu'elle ne définit pas).
   * Seuls les champs que l'autre règle définit sont comparés (catégorie, affectation).
   *
   * @param {object[]} rules — toutes les règles (supprimées ignorées)
   * @param {object} regle — la règle créée / modifiée (son `id`, s'il existe, l'exclut de la liste)
   * @param {object} lineOrMv — la ligne de départ (ligne d'import, ou mouvement enregistré)
   * @param {{accountId?:*, account?:object, loyerCC?:Function, dejaClassee?:boolean}} [opts] —
   *   `dejaClassee` : la ligne porte déjà le résultat de la règle (ne pas le recalculer)
   * @returns {{regle:object, id:string, motif:string, compteAChoisir:boolean, champs:string[], cat:string, aff:object|null}[]}
   */
  function _bankRuleAutresResultats(rules, regle, lineOrMv, opts = {}) {
    if (!regle || !lineOrMv) return [];
    const line = _bankAsLine(lineOrMv);
    const acc = (opts.accountId != null && opts.accountId !== '') ? opts.accountId
      : (lineOrMv._bankAccountId != null ? lineOrMv._bankAccountId : regle.compte);
    const c = _bankClassementDe(lineOrMv);
    if (!opts.dejaClassee) {
      if (regle.cat) c.cat = regle.cat;
      const a = _bankRuleAffResolved(regle, opts.account);
      if (a && !a.unresolved) { c.qui = a.qui || ''; c.imm = a.imm || ''; c.cc = a.compteurCcId || ''; }
    }
    const rid = (regle.id != null && regle.id !== '') ? String(regle.id) : '';
    const ctx = { loyerCC: opts.loyerCC };
    const out = [];
    for (const o of (Array.isArray(rules) ? rules : [])) {
      if (!o || o._deleted || o === regle) continue;
      if (rid && o.id != null && String(o.id) === rid) continue;
      if (!_bankRuleMatch(o, line, acc, ctx)) continue;
      const champs = [];
      if (o.cat && o.cat !== c.cat) champs.push('cat');
      const oa = _bankRuleAffResolved(o, opts.account);
      if (oa && !oa.unresolved && !_bankAffEgale(oa, c)) champs.push('aff');
      if (!champs.length) continue;
      out.push({ regle: o, id: o.id != null ? String(o.id) : '', motif: _bankRuleMotif(o), compteAChoisir: !o.compte,
        champs, cat: o.cat || '', aff: oa && !oa.unresolved ? oa : null });
    }
    return out;
  }

  /**
   * Prépare le RECLASSEMENT de l'import en cours après création / modification /
   * suppression d'une règle (ex-inline `_bankReclassify`). Fonction pure : renvoie de
   * nouvelles lignes, sans toucher aux lignes d'entrée.
   *  - ligne classée à la main (`_userEdited` / `_reviewed`) → gardée telle quelle ; si
   *    la règle `opts.rule` la touche (elle correspond à la ligne), elle est COMPTÉE dans
   *    `protegees` (l'écran l'annonce : jamais d'écrasement silencieux) ;
   *  - ligne SOURCE (`opts.sourceIndex`) qui correspond à la règle → elle est CLASSÉE ICI PAR
   *    CETTE RÈGLE, et par elle seule (🐛 audit B1 : avant, elle était vidée puis reclassée par
   *    TOUTES les règles ; une autre règle en conflit faisait tout échouer, la proposition
   *    automatique réécrivait la ligne et l'affectation faite à la main était perdue sans un
   *    mot). Ce que la règle ne définit pas, la ligne le garde. Les autres règles qui donnent
   *    un autre résultat sur cette ligne sont listées (`_autresRegles`, `sourceAutres`) pour
   *    que l'écran le DISE. `_suitRegle` dit au classement de ne pas la reclasser. La marque
   *    « retouchée » est levée (la créer ne doit pas la verrouiller hors règle), SAUF si la
   *    ligne garde une partie classée à la main que la règle ne définit pas : elle reste alors
   *    protégée, pour qu'un reclassement ultérieur ne l'efface pas ;
   *    si elle ne correspond pas, elle reste comme elle est (`sourceSuit:false`) ;
   *  - ligne de départ d'une règle créée PLUS TÔT dans cet import (`_regleSource`), non protégée :
   *    reclassée par SA règle de la même façon (tant que la règle existe et l'attrape) ;
   *  - autre ligne → classement retiré, elle sera reclassée (une autre ligne en conflit reste
   *    « ⚠ N règles possibles », au choix de l'utilisateur, CDC ⑦.2 v2).
   * @param {object[]} lines
   * @param {{rule?:object, rules?:object[], sourceIndex?:number, accountId?:*, account?:object, loyerCC?:Function}} [opts]
   *   `rules` : toutes les règles (pour signaler les autres règles de la ligne source)
   * @returns {{lines:object[], protegees:number, sourceSuit:boolean|null, sourceAutres:object[]}}
   */
  function _bankReclassifyPrepare(lines, opts = {}) {
    const rule = (opts.rule && !opts.rule._deleted) ? opts.rule : null;
    const ctx = { loyerCC: opts.loyerCC };
    const appOpts = { accountId: opts.accountId, account: opts.account, loyerCC: opts.loyerCC };
    const strip = l => {
      const r = Object.assign({}, l);
      _BANK_CLASSEMENT_FIELDS.forEach(k => { delete r[k]; });
      return r;
    };
    let protegees = 0, sourceSuit = null, sourceAutres = [];
    // Classe la ligne par SA règle (la règle créée depuis elle), seule ; garde ce que la règle ne définit pas.
    const classerParSaRegle = (l, srcRule) => {
      const r = strip(l);
      let garde = false;
      if (_bankRuleIsV2(srcRule)) {
        if (!srcRule.cat && l.suggestedCat) { r.suggestedCat = l.suggestedCat; garde = true; }
        if (!_bankRuleHasAff(srcRule)) {
          ['suggestedQui', 'suggestedImm', 'suggestedCc'].forEach(f => { if (l[f]) { r[f] = l[f]; garde = true; } });
        }
      }
      _bankLineApplyRules([srcRule], r, appOpts);
      const autres = _bankRuleAutresResultats(opts.rules, srcRule, r, Object.assign({ dejaClassee: true }, appOpts));
      r._autresRegles = autres.length ? autres.map(_bankAutreRegleVue) : null;
      r._regleSource = _bankRuleTraceKey(srcRule);
      if (!(garde && l._userEdited)) delete r._userEdited;
      r._suitRegle = true;
      return { r, autres };
    };
    const out = (Array.isArray(lines) ? lines : []).map((l, k) => {
      if (!l) return l;
      const touche = !!rule && _bankRuleMatch(rule, l, opts.accountId, ctx);
      if (rule && opts.sourceIndex != null && opts.sourceIndex === k) {
        sourceSuit = touche;
        if (touche) {
          const x = classerParSaRegle(l, rule);
          sourceAutres = x.autres;
          return x.r;
        }
      }
      if (l._userEdited || l._reviewed) {
        if (touche) protegees++;   // correspond à la règle ET déjà classée à la main : laissée telle quelle
        // Ligne de départ d'une règle précédente : son signal « une autre règle donne un autre
        // résultat » est recalculé (la règle en cause a pu être modifiée ou supprimée entre-temps).
        if (l._autresRegles && l._regleSource && Array.isArray(opts.rules)) {
          const src = _bankRuleById(opts.rules, l._regleSource);
          const autres = src ? _bankRuleAutresResultats(opts.rules, src, l, Object.assign({ dejaClassee: true }, appOpts)) : [];
          return Object.assign({}, l, { _autresRegles: autres.length ? autres.map(_bankAutreRegleVue) : null });
        }
        return l;
      }
      // Ligne de départ d'une règle créée plus tôt dans cet import : elle reste classée par SA règle
      // (si la règle existe toujours et l'attrape encore) — une autre règle ne la reprend pas en douce.
      if (l._regleSource && Array.isArray(opts.rules)) {
        const src = _bankRuleById(opts.rules, l._regleSource);
        if (src && _bankRuleMatch(src, l, opts.accountId, ctx)) return classerParSaRegle(l, src).r;
      }
      return strip(l);
    });
    return { lines: out, protegees, sourceSuit, sourceAutres };
  }

  /** Ce que la ligne garde d'une « autre règle » (sans l'objet règle : la ligne peut être copiée). */
  function _bankAutreRegleVue(x) {
    return { id: x.id, motif: x.motif, compteAChoisir: x.compteAChoisir, champs: x.champs.slice(), cat: x.cat,
      aff: x.aff ? Object.assign({}, x.aff) : null };
  }

  /**
   * Création d'une règle depuis la fiche d'un MOUVEMENT ENREGISTRÉ (décision Didier du
   * 06/10) : ce mouvement, et LUI SEUL, est mis à jour directement. Fonction pure : renvoie
   * le correctif à appliquer (l'appelant stampe, journalise et enregistre).
   * Le mouvement est testé avec SON compte : une règle qui ne le couvre pas (mot absent
   * du libellé, autre compte, exception, montant) ne le modifie pas (`ok:false`).
   * La règle pose sa catégorie, et son affectation si elle en porte une ; la trace
   * `_rules` reçoit son identifiant.
   * @returns {{ok:boolean, raison:''|'absent'|'ne-correspond-pas', patch:object|null, changed:boolean}}
   */
  function _bankRulePatchMouvement(rule, mv, opts = {}) {
    if (!rule || rule._deleted || !mv || mv._deleted) return { ok: false, raison: 'absent', patch: null, changed: false };
    if (!_bankRuleMatch(rule, _bankAsLine(mv), mv._bankAccountId, { loyerCC: opts.loyerCC })) {
      return { ok: false, raison: 'ne-correspond-pas', patch: null, changed: false };
    }
    const patch = {};
    if (rule.cat) patch.cat = rule.cat;
    const a = _bankRuleAffResolved(rule, opts.account);
    if (a && !a.unresolved) { patch.qui = a.qui || ''; patch.imm = a.imm || ''; patch.compteurCcId = a.compteurCcId || ''; }
    const prev = Array.isArray(mv._rules) ? mv._rules.map(String) : [];
    const trace = _bankRuleTraceKey(rule);
    patch._rules = (!trace || prev.includes(trace)) ? prev : [...prev, trace];
    const changed = patch._rules.length !== prev.length
      || ['cat', 'qui', 'imm', 'compteurCcId'].some(k => k in patch && String(mv[k] == null ? '' : mv[k]) !== String(patch[k]));
    return { ok: true, raison: '', patch, changed };
  }

  /**
   * Pré-remplissage de la fenêtre de règle depuis ce qui est DÉJÀ classé sur une ligne d'import
   * ou sur un mouvement enregistré (« si j'ai fait des modifs dans le mouvement, on les récupère
   * dans la règle », Didier, 06/10) : catégorie + affectation (logement / immeuble / SCI / compteur).
   * L'utilisateur modifie ensuite librement ; ce qu'il change dans la fenêtre est ce qui est
   * enregistré. Exclusivité logement ↔ compteur respectée (le compteur l'emporte).
   * @param {{cat?:string, qui?:string, imm?:string, compteurCcId?:string}} [c]
   * @returns {{cat:string, qui:string, imm:string, cc:string}}
   */
  function _bankRulePrefill(c) {
    const x = c || {};
    const cc = x.compteurCcId ? String(x.compteurCcId) : '';
    return { cat: x.cat ? String(x.cat) : '', qui: cc ? '' : (x.qui ? String(x.qui) : ''),
      imm: x.imm ? String(x.imm) : '', cc };
  }

  /**
   * (Phase 4, plus appelé par l'interface depuis la phase 6a : les puces portent mots entiers et
   * mots saisis séparément ; conservé et testé pour un champ texte « motif » éventuel.)
   * Brouillon de la fenêtre de règle (champ texte « motif ») → mots de la règle. Un mot CLIQUÉ parmi les mots du libellé
   * (ou déjà « mot entier » de la règle ouverte) reste un mot entier ; un mot TAPÉ est un
   * morceau de mot (comme la puce « + mot »). Aucun mot n'est deviné.
   * @param {string} texte — contenu du champ motif
   * @param {string[]} motsEntiers — mots marqués « mot entier »
   * @returns {{mots:string[], motsLibres:string[]}}
   */
  function _bankRuleMotsDuChamp(texte, motsEntiers) {
    const entiers = new Set((Array.isArray(motsEntiers) ? motsEntiers : []).map(_bankNormTxt).filter(Boolean));
    const mots = [], motsLibres = [], seen = new Set();
    for (const w of String(texte == null ? '' : texte).trim().split(/\s+/)) {
      const n = _bankNormTxt(w);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      (entiers.has(n) ? mots : motsLibres).push(w);
    }
    return { mots, motsLibres };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // REGLES-REFONTE phase 6a — INTERFACE de la fenêtre de règle (maquettes validées).
  // Logique pure derrière les puces de mots, la condition de montant, les lignes
  // décochables de l'aperçu et la pastille « ✓ Règle enregistrée ».
  // ════════════════════════════════════════════════════════════════════════════

  /** Texte d'un montant saisi : vide, ou chiffres avec séparateurs / signe / € (jamais des lettres). */
  function _bankMontantSaisiValide(v) {
    const t = String(v == null ? '' : v).trim();
    return t === '' || /^[-+]?[\d\s .,]*\d[\d\s .,]*€?$/.test(t.replace(/ | /g, ' '));
  }

  /**
   * Condition de montant de la fenêtre (boutons radio + champs texte) → condition du modèle.
   * `ui` = { type: 'none'|'loyerCC'|'exact'|'plage', valeur, min, max } (textes saisis, « 150,00 » accepté).
   * @returns {{montant:object|null, aucune:boolean, invalide:boolean}} `invalide` : champ incomplet ou
   *   illisible — l'écran le dit et bloque l'enregistrement (rien n'est corrigé en silence).
   */
  function _bankRuleMontantDepuisSaisie(ui) {
    const u = ui || {};
    if (!u.type || u.type === 'none') return { montant: null, aucune: true, invalide: false };
    if (u.type === 'loyerCC') return { montant: { type: 'loyerCC' }, aucune: false, invalide: false };
    const champs = u.type === 'exact' ? [u.valeur] : [u.min, u.max];
    if (!champs.every(_bankMontantSaisiValide)) return { montant: null, aucune: false, invalide: true };
    const nm = _bankRuleNormMontant({ type: u.type, valeur: u.valeur, min: u.min, max: u.max });
    if (nm.error || !nm.montant) return { montant: null, aucune: false, invalide: true };
    return { montant: nm.montant, aucune: false, invalide: false };
  }

  /**
   * Retour en direct de la puce libre « + mot » : le morceau saisi est-il ajoutable, et figure-t-il
   * dans le libellé de départ ? (Une puce libre est cherchée comme MORCEAU de mot : « ELEC » attrape
   * « ELECTRICITE ».)
   * @param {string} saisie
   * @param {{motsLibelle?:string[], saisis?:string[], puces?:string[]}} [ctx] — mots du libellé de départ,
   *   mots déjà saisis, puces (mots entiers) de la fenêtre
   * @returns {{etat:'vide'|'espace'|'doublon'|'puce'|'present'|'absent', ajoutable:boolean, mot:string, trouveDans:string}}
   */
  function _bankMotSaisiDiagnostic(saisie, ctx = {}) {
    const mot = String(saisie == null ? '' : saisie).trim();
    const out = { etat: 'vide', ajoutable: false, mot, trouveDans: '' };
    if (!mot) return out;
    if (/\s/.test(mot)) { out.etat = 'espace'; return out; }
    const n = _bankNormTxt(mot);
    if (!n) { out.etat = 'vide'; return out; }
    if ((ctx.saisis || []).some(w => _bankNormTxt(w) === n)) { out.etat = 'doublon'; return out; }
    if ((ctx.puces || []).some(w => _bankNormTxt(w) === n)) { out.etat = 'puce'; return out; }
    out.ajoutable = true;
    const hit = (ctx.motsLibelle || []).find(w => _bankNormTxt(w).includes(n));
    if (hit) { out.etat = 'present'; out.trouveDans = hit; } else out.etat = 'absent';
    return out;
  }

  /**
   * Cases de l'aperçu : décocher une ligne = l'ajouter aux EXCEPTIONS de la règle, recocher = la
   * retirer (clé = empreinte de la ligne). Renvoie la nouvelle liste ; l'entrée n'est pas modifiée.
   */
  function _bankRuleExceptionsApresCase(exceptions, line, coche, opts = {}) {
    const base = { exceptions: Array.isArray(exceptions) ? exceptions : [] };
    const cle = _bankRuleLineKey(line);
    if (!cle) return base.exceptions.slice();
    const r = coche ? _bankRuleRemoveException(base, cle, opts) : _bankRuleAddException(base, line, opts);
    return r.exceptions.slice();
  }

  /**
   * Une exception mémorisée concerne-t-elle ENCORE la règle ? (l'entrée porte date, libellé, montant, sens ;
   * on la rejoue comme une ligne). Sert à ne pas garder une exception posée en décochant une ligne que
   * l'utilisateur a ensuite sortie du motif.
   */
  function _bankRuleExceptionPortee(rule, exc, ctx = {}) {
    if (!rule || !exc) return false;
    const m = Math.abs(Number(exc.montant) || 0);
    const line = { date: exc.date || '', libelle: exc.libelle || '', credit: exc.sens === 'cr' ? m : 0, debit: exc.sens === 'cr' ? 0 : m };
    return _bankRuleMatch(Object.assign({}, rule, { exceptions: [] }), line, rule.compte, ctx);
  }

  /**
   * Actions directes de l'alerte « natures différentes » : un mot du libellé de départ qui, ajouté
   * comme puce, rend les lignes cochées homogènes (et garde la ligne source) ; le sens à fixer quand
   * la règle attrape à la fois dépenses et recettes.
   * @param {object} regle — règle candidate
   * @param {object} ctx — celui de `_bankRuleApercu`, + `motsLibelle` (mots du libellé de départ)
   * @returns {{mot:string, sens:''|'db'|'cr'}}
   */
  function _bankRuleSuggestions(regle, ctx = {}) {
    const out = { mot: '', sens: '' };
    const ap = _bankRuleApercu(regle, ctx);
    if (!ap.mixed) return out;
    const cochees = ap.lignes.filter(x => x.coche && x.index >= 0);
    if (!regle.sens) {
      const sens = new Set(cochees.map(x => _bankLineSens(x.line)));
      if (sens.size > 1) {
        const src = ap.lignes.find(x => x.source);
        if (src) out.sens = _bankLineSens(src.line);
        else out.sens = cochees.filter(x => _bankLineSens(x.line) === 'db').length >= cochees.length / 2 ? 'db' : 'cr';
      }
    }
    if (ctx.source || ap.lignes.some(x => x.source)) {
      const deja = new Set([..._bankRuleTokens(regle).mots, ..._bankRuleTokens(regle).libres]);
      let best = 0;
      for (const w of (ctx.motsLibelle || [])) {
        const n = _bankNormTxt(w);
        if (!n || deja.has(n)) continue;
        const cand = Object.assign({}, regle, { mots: [...(regle.mots || []), w] });
        const a = _bankRuleApercu(cand, ctx);
        // À égalité de lignes gardées, le mot le plus long (plus parlant : PROVISION plutôt que PERM).
        if (!a.mixed && a.sourceCorrespond !== false && (a.nCochees > best || (a.nCochees === best && best > 0 && w.length > out.mot.length))) { best = a.nCochees; out.mot = w; }
      }
    }
    return out;
  }

  /**
   * Pastille « ✓ Règle enregistrée » (ligne d'import ET fiche d'un mouvement enregistré) : que dit-on
   * d'une ligne par rapport aux règles du MÊME compte ?
   *  - 'aucune'      : aucune règle ne la couvre → bouton « Mémoriser la règle » ;
   *  - 'enregistree' : au moins une règle la couvre ;
   *  - 'doublon'     : deux règles (même résultat, l'une incluse dans l'autre) la couvrent ;
   *  - 'exception'   : une règle la couvrirait, mais elle en a été sortie (exception mémorisée).
   * @returns {{etat:string, regles:object[], exceptions:object[]}}
   */
  function _bankRuleStatutLigne(rules, lineOrMv, accountId, ctx = {}) {
    const out = { etat: 'aucune', regles: [], exceptions: [] };
    const line = _bankAsLine(lineOrMv);
    if (!line) return out;
    const live = (Array.isArray(rules) ? rules : []).filter(r => r && !r._deleted);
    const c = { loyerCC: ctx.loyerCC };
    out.regles = live.filter(r => _bankRuleMatch(r, line, accountId, c));
    if (out.regles.length) {
      out.etat = _bankRulesDuplicates(out.regles).length ? 'doublon' : 'enregistree';
      return out;
    }
    out.exceptions = live.filter(r => _bankRuleIsV2(r) && _bankRuleIsException(r, line)
      && _bankRuleMatch(Object.assign({}, r, { exceptions: [] }), line, accountId, c));
    if (out.exceptions.length) out.etat = 'exception';
    return out;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Matching heuristique vers (catégorie, qui) ImmoTrack
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Devine la catégorie + le bien (qui) pour une transaction.
   * @param {object} line — { date, libelle, debit, credit, signedAmount }
   * @param {object} ctx  — { baux, categories, mouvementsExistants, tolerance }
   * @returns {{ cat: string, qui: string, confidence: number, source: string }}
   *
   * Heuristiques (ordre de priorité) :
   *   1. Match nom locataire dans libellé + montant ≈ loyer attendu → Loyers + ref bail
   *   2. Libellé contient "PRELEV" + RUM connu → ...
   *   3. Match catégorie par mots-clés (ASSURANCE, ELECTRICITE, etc.)
   *   4. Fallback : catégorie "Autre" / qui ""
   */
  /** Le mot est-il présent COMME MOT ENTIER dans le libellé normalisé ? (⑦.5 a) */
  function _bankWordIn(libNorm, word) {
    const w = String(word || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!w) return false;
    return new RegExp('(^|[^a-z0-9])' + w + '([^a-z0-9]|$)').test(libNorm);
  }

  /** Construit la proposition « loyer » pour un candidat, avec l'écart affiché (⑦.5 e). */
  function _bankProposeLoyer(result, c, candidates) {
    const ecartAbs = c.ecart == null ? null : Math.abs(c.ecart);
    result.cat = 'Loyers encaissés';
    result.qui = c.ref;
    result.candidates = candidates;
    // Le montant GRADUE la confiance ; il ne disqualifie plus.
    result.confidence = ecartAbs == null ? 0.7 : (ecartAbs < 1 ? 0.95 : (ecartAbs < 20 ? 0.85 : 0.75));
    const parts = ['nom du locataire reconnu'];
    if (c.ancien) parts.push('ancien locataire');
    if (c.du > 0) {
      parts.push('montant ' + _bankEur(c.du + (c.ecart || 0)) + ' · dû du mois ' + _bankEur(c.du));
      if (ecartAbs != null && ecartAbs >= 1) parts.push(c.ecart > 0 ? 'avance de ' + _bankEur(c.ecart) : 'reste ' + _bankEur(-c.ecart));
    }
    result.source = parts.join(' · ');
    return result;
  }

  /** Formatage minimal d'un montant pour les libellés de proposition (module PUR : pas d'Intl). */
  function _bankEur(v) {
    const n = Math.round((Number(v) || 0) * 100) / 100;
    return n.toFixed(2).replace('.', ',') + ' €';
  }

  function _bankMatchHeuristic(line, ctx = {}) {
    const result = { cat: '', qui: '', confidence: 0, source: '', candidates: [], ambiguous: false };
    if (!line || !line.libelle) return result;
    const lib = _bankNormTxt(line.libelle);
    const baux = ctx.baux || {};

    // ── ⑦.5 · LE MATCH LOCATAIRE, 5 corrections ────────────────────────────────
    if (line.credit > 0) {
      const ym = String(line.date || '').slice(0, 7);
      const cands = [];
      for (const [ref, bail] of Object.entries(baux)) {
        if (!bail) continue;
        // 🐛 d — LES BAUX CLÔTURÉS REDEVIENNENT CANDIDATS (bug 7). Un arriéré versé
        // après le départ d'un locataire ne matchait plus rien : `if (bail.cloture) continue`.
        const ancien = !!bail.cloture;
        const rawNames = (bail.locataires || [{ nom: bail.nom }])
          .map(x => String((x && x.nom) || '').trim()).filter(Boolean);
        const locNames = rawNames.map(_bankNormTxt).filter(Boolean);
        const locWords = [];
        locNames.forEach(n => n.split(/[\s\-']+/).forEach(w => { if (w.length >= 3) locWords.push(w); }));
        // 🐛 a — FRONTIÈRE DE MOT (bug 4) : le nom est cherché comme MOT ENTIER, plus
        // comme sous-chaîne. « Marc » matchait `SUPERMARCHE`, « Roy » matchait `ROYAL` —
        // et le niveau 0,70 n'exigeait pas que le montant corresponde : un faux positif
        // suffisait à proposer le mauvais lot.
        const nameMatched = locWords.some(w => _bankWordIn(lib, w));
        // 🐛 c — LE DÛ EST CELUI DU MOIS DU RELEVÉ (bug 6), plus le loyer d'aujourd'hui :
        // après une indexation, les mois antérieurs chutaient de confiance pour un motif faux.
        const du = (typeof ctx.duMois === 'function' && ym)
          ? (Number((ctx.duMois(ref, ym) || {}).total) || 0)
          : ((Number(bail.hc) || 0) + (Number(bail.ch) || 0));
        const ecart = du > 0 ? (line.credit - du) : null;
        cands.push({ ref, nom: rawNames.join(' / '), ancien, nameMatched, du, ecart });
      }
      // 🐛 e — LE MONTANT N'EST PLUS UN CRITÈRE MAIS UN INDICATEUR : le nom suffit à
      // proposer, le montant gradue la confiance et l'écart s'affiche. Fin du seuil ±5 €
      // qui disqualifiait paiements partiels, rattrapages et avances.
      const exact = (c) => c.ecart != null && Math.abs(c.ecart) < 1;
      const byName = cands.filter(c => c.nameMatched);
      if (byName.length === 1) return _bankProposeLoyer(result, byName[0], byName);
      if (byName.length > 1) {
        // 🐛 b — TOUS LES BAUX SONT ÉVALUÉS (bug 5) : plus de « premier bail qui matche
        // gagne » (sortie de boucle immédiate, ordre des clés). Si le montant désigne
        // un seul candidat, il tranche ; sinon la proposition est AMBIGUË et les
        // candidats sont affichés — jamais de gagnant arbitraire.
        const exacts = byName.filter(exact);
        if (exacts.length === 1) return _bankProposeLoyer(result, exacts[0], byName);
        result.cat = 'Loyers encaissés';
        result.qui = '';
        result.confidence = 0.5;
        result.ambiguous = true;
        result.candidates = byName;
        result.source = byName.length + ' locataires possibles — à choisir';
        return result;
      }
      // Aucun nom reconnu : un MONTANT SEUL ne propose que s'il n'y a QU'UN lot dont le
      // dû corresponde (sinon on désignerait un bien au hasard).
      const exacts = cands.filter(exact);
      if (exacts.length === 1) {
        const c = exacts[0];
        result.cat = 'Loyers encaissés';
        result.qui = c.ref;
        result.confidence = 0.6;
        result.candidates = [c];
        result.source = 'Montant exactement égal au dû du mois de ' + c.ref + (c.ancien ? ' (ancien locataire)' : '');
        return result;
      }
    }

    // 2. Catégorisation par mots-clés (débits typiquement).
    // V3-REFONTE-LOYERS : les `cat` ci-dessous sont les NOMS EXACTS de STD_CATEGORIES (index.html).
    // Avant, le moteur proposait « Taxes foncières », « Intérêts d'emprunt », « Frais de gérance,
    // rémunérations », « Autres » — qui n'existent PAS dans STD_CATEGORIES → ces mouvements ne mappaient
    // aucune ligne 2044 (nonMappes) = sous-déclaration silencieuse. Corrigé ici.
    const KEYWORDS = [
      // 15/10 (Didier) : une assurance de PRÊT (prélevée à part) n'est pas une PNO — ligne 250, cash-flow.
      // AVANT la règle « assurance » générale (sinon « PRLV CNP ASSURANCES PRET » partait en 223).
      // Relectures (15/10) : jamais sur un libellé de PNO / GLI / habitation / auto ni d'une banque-assureur
      // (« ASSURANCE CREDIT MUTUEL » = PNO ACM) ; CNP / Cardif seulement avec « prêt / emprunt ».
      { rx: /^(?!.*\b(pno|gli|habitation|mrh|multirisque|auto|loyers? impayes)\b).*\b(assurances? (de |du )?(pret|credit immo\w*|emprunt\w*)|emprunteur|(cnp|cardif)\b.*\b(pret|emprunt\w*))\b/i, cat: 'Prêt — Assurance emprunteur', confidence: 0.8, src: 'Mot-clé assurance emprunteur' },
      // CNP / Cardif sans autre indice : surtout de l'assurance de prêt → proposé (confiance basse), jamais en PNO.
      { rx: /^(?!.*\b(pno|gli|habitation|mrh|multirisque|auto|loyers? impayes)\b).*\b(cnp|cardif)\b/i, cat: 'Prêt — Assurance emprunteur', confidence: 0.6, src: 'Assureur emprunteur (CNP / Cardif) — à vérifier' },
      { rx: /\b(assurances?|axa|maaf|matmut|aviva|allianz|maif|groupama|gli)\b/i, cat: 'Primes d\'assurance (PNO, GLI)', confidence: 0.85, src: 'Mot-clé assurance' },
      // Frais bancaires (tenue de compte) → catégorie dédiée ; péage/carburant → Divers (tout hors 2044, couvert par le forfait 222).
      { rx: /\b(frais bancaires|tenue de compte|cotisation carte|frais de compte|commission d.intervention|abonnement compte)\b/i, cat: 'Frais bancaires', confidence: 0.72, src: 'Mot-clé frais bancaires (forfait 222)' },
      { rx: /\b(peage|autoroute|aprr|sanef|carburant|essence|station service)\b/i, cat: 'Divers (non déductible)', confidence: 0.6, src: 'Mot-clé péage/carburant (forfait 222 → Divers)' },
      { rx: /\b(edf|engie|eni|enedis|electric|electricite|gaz de france|gdf|veolia|saur|suez|sde|smede|eaux|chauffage)\b/i, cat: 'Charges récupérables (eau, énergie…)', confidence: 0.80, src: 'Mot-clé énergie/eau' },
      { rx: /\b(syndic|copropriete|copro|charges copro|appel de fonds)\b/i, cat: 'Charges de copropriété', confidence: 0.90, src: 'Mot-clé syndic' },
      { rx: /\b(travaux|renovation|reno|peinture|plombier|electricien|chauffagiste|menuisier|charpentier|carreleur|macon|serrurier)\b/i, cat: 'Travaux (entretien, réparation, amélioration)', confidence: 0.80, src: 'Mot-clé travaux' },
      { rx: /\b(taxe fonciere|tf )/i, cat: 'Taxe foncière (et taxes annexes)', confidence: 0.92, src: 'Mot-clé TF' },
      { rx: /\b(comptable|expert.comptable|comptabilite|cabinet comptable)\b/i, cat: 'Frais de gestion / honoraires / comptabilité', confidence: 0.78, src: 'Mot-clé comptable' },
      // Échéance de crédit importée → capital remboursé (trésorerie). Les intérêts (ligne 250) se saisissent
      // à part depuis l'attestation annuelle de banque (décision design 2026-06-21), pas dérivés de l'échéance.
      { rx: /\b(emprunt|pret|credit immo|credit immobilier|amortissement|echeance pret)\b/i, cat: 'Prêt', confidence: 0.72, src: 'Mot-clé emprunt (échéance ; intérêts via attestation)' },
      { rx: /\b(notaire|frais notaire)\b/i, cat: 'Acquisition / cession de bien', confidence: 0.70, src: 'Mot-clé notaire' },
      { rx: /\b(honoraires|gerance|gestion locative|agence immo)\b/i, cat: 'Frais de gestion / honoraires / comptabilité', confidence: 0.72, src: 'Mot-clé gestion' },
      { rx: /\b(dpe|diagnostic|geometre|huissier|avocat|expertise)\b/i, cat: 'Frais de gestion / honoraires / comptabilité', confidence: 0.7, src: 'Mot-clé procédure/diagnostic' }
    ];
    for (const k of KEYWORDS) {
      if (k.rx.test(lib)) {
        result.cat = k.cat;
        result.confidence = k.confidence;
        result.source = k.src;
        return result;
      }
    }

    // 3. Fallback : aucune catégorie inventée. '' → la revue affiche « à classer », l'utilisateur choisit.
    result.cat = '';
    result.confidence = 0;
    result.source = 'Aucun match — à classifier manuellement';
    return result;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Détection doublons
  // ────────────────────────────────────────────────────────────────────────────

  /** FITID stocké sur un mouvement, quelle qu'en soit la forme (champ direct ou empreinte). */
  function _bankMvFitid(m) {
    if (!m) return '';
    if (m.fitid && String(m.fitid).trim()) return String(m.fitid).trim();
    const fp = String(m._fingerprint || '');
    return fp.startsWith('fitid:') ? fp.slice(6) : '';
  }

  /**
   * ⑥ DÉTECTION DES DOUBLONS — deux niveaux, deux traitements.
   *
   * **⑥.1 · Le FITID est la stratégie n° 1 en OFX.** C'est l'identifiant unique de
   * transaction fourni par la banque, plus fiable que toute empreinte calculée. Il
   * tranche **avant** l'empreinte et **dans les deux sens** : identique = doublon
   * certain ; différent = **pas** un doublon. Avant, il n'était consulté qu'en second
   * rang et contre les seuls mouvements sans empreinte → une banque qui réémet un
   * relevé avec un libellé retouché (« en cours » → « définitif ») passait pour du
   * nouveau. L'empreinte reste la stratégie principale pour Excel, qui n'a pas
   * d'identifiant de transaction.
   *
   * **⑥.2 · Certains écartés en silence, probables à trancher.**
   * - `dupLevel:'certain'` (même FITID ou même empreinte) → écarté automatiquement,
   *   replié en une ligne de résumé. Zéro clic.
   * - `dupLevel:'probable'` (date ±3 j + montant ±1 €, ou somme des parts du jour) →
   *   « à décider » : ni exclu ni inclus, et **l'import reste bloqué tant qu'il en
   *   reste un non tranché**. Cas qui motive la décision : deux loyers de 850 € à deux
   *   jours d'écart, deux locataires différents — avant, un vrai loyer disparaissait
   *   sans que rien ne le signale.
   *
   * @returns {Array<{...line, isDuplicate, dupLevel, duplicateOf, duplicateReason}>}
   */
  function _bankDedup(newLines, mouvementsExistants, options = {}) {
    const toleranceDays = options.toleranceDays ?? 3;
    const toleranceAmount = options.toleranceAmount ?? 1;
    const legacyFallback = options.legacyFallback !== false;
    const accountId = options.accountId;
    const alive = (mouvementsExistants || []).filter(m => m && !m._deleted);

    // Index des fingerprints existants en DB (lookup O(1))
    const fpIndex = new Map();
    // ⑥.1 — Index des FITID limité au COMPTE COURANT quand on le connaît : un FITID
    // n'est unique que **chez une banque**, pas dans l'absolu. Deux banques peuvent
    // émettre le même identifiant (« 000000001 ») ; sans ce filtrage, une opération
    // légitime d'un compte serait déclarée doublon certain d'une opération d'un autre
    // compte — et écartée sans un clic. Les mouvements sans compte (legacy, saisis à la
    // main) restent pris en compte : les exclure ferait perdre la reconnaissance des
    // imports d'avant le suivi par compte.
    const fitidIndex = new Map();
    for (const m of alive) {
      // AUDIT-C1 — l'empreinte (comme le FITID) n'est PAS unique dans l'absolu : 2 comptes multi-SCI
      // (même syndic, même jour/montant/libellé) → sans ce filtre, l'opération du 2e compte était
      // déclarée « doublon certain » et écartée SANS un clic (argent manquant). On scope fpIndex au
      // compte courant, comme fitidIndex ci-dessous. Les mouvements sans compte (legacy/manuel) restent inclus.
      if (accountId != null && m._bankAccountId != null && String(m._bankAccountId) !== String(accountId)) continue;
      if (m._fingerprint && !fpIndex.has(m._fingerprint)) fpIndex.set(m._fingerprint, m);
      const f = _bankMvFitid(m);
      if (f && !fitidIndex.has(f)) fitidIndex.set(f, m);
    }

    // AUDIT-C1 — candidats limités au compte courant (même raison que fpIndex/fitidIndex) : la
    // ressemblance date/montant (strat. 3) ne doit pas matcher un mouvement d'un AUTRE compte.
    // Calculé UNE fois : il ne dépend que de `alive` et `accountId`, tous deux constants pour
    // l'import. Il vivait dans la boucle, donc refiltrait tout le parc à chaque ligne du relevé
    // (O(lignes × mouvements) sur le thread de l'interface, qui se voit dès quelques milliers).
    const scopedAlive = alive.filter(m => !(accountId != null && m._bankAccountId != null && String(m._bankAccountId) !== String(accountId)));

    const out = [];
    for (const line of (newLines || [])) {
      let isDuplicate = false, dupLevel = '', duplicateOf = '', duplicateReason = '';

      // ── Stratégie 1 : FITID, dans les DEUX SENS ──────────────────────────────
      const lineFitid = line.fitid ? String(line.fitid).trim() : '';
      if (lineFitid) {
        const m = fitidIndex.get(lineFitid);
        if (m) {
          out.push({ ...line, isDuplicate: true, dupLevel: 'certain',
            duplicateOf: String(m.id || '?'),
            duplicateReason: 'Même identifiant de transaction (FITID) — la banque dit que c’est la même opération' });
          continue;
        }
      }
      // La preuve NÉGATIVE du FITID ne vaut que face à un mouvement qui PORTE un FITID :
      // « celui-ci a un autre identifiant, ce n'est pas la même opération ». Elle ne dit
      // rien d'un mouvement sans identifiant (import Excel, saisie manuelle).
      // 🐛 Audit C2 : conclure globalement dès qu'UN mouvement du compte portait un FITID
      // faisait sauter empreinte ET heuristique → une période importée en Excel puis
      // recouverte par un relevé OFX était comptée DEUX FOIS, sans un mot.
      const cands = lineFitid ? scopedAlive.filter(m => { const f = _bankMvFitid(m); return !f || f === lineFitid; }) : scopedAlive;

      // ── Stratégie 2 : empreinte (principale pour Excel) ──────────────────────
      if (line._fingerprint && fpIndex.has(line._fingerprint)) {
        const m = fpIndex.get(line._fingerprint);
        const mf = _bankMvFitid(m);
        if (!lineFitid || !mf || mf === lineFitid) {
          isDuplicate = true; dupLevel = 'certain';
          duplicateOf = String(m.id || '?');
          duplicateReason = 'Empreinte identique — opération déjà importée';
        }
      }

      // ── Stratégie 3 : ressemblance (date ±3 j + montant ±1 €) → PROBABLE ─────
      if (!isDuplicate && legacyFallback) {
        const lineMontant = line.credit > 0 ? line.credit : -line.debit;
        const lineDate = line.date ? new Date(line.date + 'T00:00:00').getTime() : NaN;
        for (const m of cands) {
          if (m._fingerprint && m._fingerprint === line._fingerprint) continue; // déjà couvert
          if (!m.date || !isFinite(lineDate)) continue;
          const mMontant = (m.cr || 0) > 0 ? (m.cr || 0) : -(m.db || 0);
          if (Math.abs(mMontant - lineMontant) > toleranceAmount) continue;
          const mDate = new Date(m.date + 'T00:00:00').getTime();
          const dayDiff = Math.abs((mDate - lineDate) / 86400000);
          if (dayDiff > toleranceDays) continue;
          isDuplicate = true; dupLevel = 'probable';
          duplicateOf = String(m.id || '?');
          duplicateReason = `Même montant à ${Math.round(dayDiff)} jour(s) d’écart — à confirmer : est-ce la même opération ?`;
          break;
        }
      }

      // ── Stratégie 4 : relevé déjà importé PUIS DÉCOUPÉ ───────────────────────
      // La ligne source ne matche aucune part individuelle (montants différents) : on
      // détecte que son montant = la SOMME des parts d'import bancaire du même jour.
      if (!isDuplicate) {
        const lineMontant = line.credit > 0 ? line.credit : -line.debit;
        // 🐛 Audit I5 : `line._bankAccountId` n'est JAMAIS posé sur une ligne d'import
        // (le champ n'existe qu'à la création du mouvement) — ce garde était mort, et la
        // somme des parts du jour était comparée aux mouvements de TOUS les comptes.
        // Depuis ⑥.2 ces faux positifs sont « probables » et BLOQUENT la validation.
        const acct = line._bankAccountId || (accountId != null ? accountId : null);
        const parts = cands.filter(m =>
          m.date === line.date && m._source === 'bank_import' &&
          (acct == null || m._bankAccountId == null || String(m._bankAccountId) === String(acct)));
        if (parts.length >= 2) {
          const sum = parts.reduce((s, m) => s + ((m.cr || 0) > 0 ? (m.cr || 0) : -(m.db || 0)), 0);
          if (Math.abs(sum - lineMontant) <= toleranceAmount) {
            isDuplicate = true; dupLevel = 'probable';
            duplicateOf = String(parts[0].id || '?');
            duplicateReason = 'Ce virement semble déjà importé puis découpé (la somme des lignes du jour correspond)';
          }
        }
      }

      out.push({ ...line, isDuplicate, dupLevel, duplicateOf, duplicateReason });
    }
    return out;
  }

  /**
   * R-B v2 / ⑧ — Une ligne peut-elle rejoindre l'onglet « Reconnus » ?
   *
   * 🐛 **BUG 10 du CDC** : `_bankLineDone` faisait basculer en « Reconnus » toute ligne
   * dont catégorie + bien étaient remplis, **y compris par une simple proposition** —
   * du classement automatique déguisé. Les trois états sont :
   * - **règle** (validée par l'utilisateur) → automatisable ;
   * - **proposition** (✨) → TOUJOURS soumise, reste dans « À compléter » même complète ;
   * - **non détecté** → à classer.
   *
   * Bloquent aussi : une date manquante (le mouvement serait rejeté par la synchro),
   * un conflit de règles non arbitré (⑦.2), une proposition ambiguë (⑦.5 b).
   * Ne bloque PAS : une date douteuse — elle reste signalée par son badge (⑧.1).
   */
  function _bankIsAutomatable(line) {
    if (!line) return false;
    if (!line.date) return false;
    if (line._ruleConflicts && line._ruleConflicts.length) return false;
    if (line._ambiguous) return false;
    return !!(line._byRule || line._reviewed || line._userEdited
      || (Array.isArray(line._sp) && line._sp.length));
  }

  /**
   * ⑥.2 / ⑧.1 — Compte les doublons **probables non tranchés** : tant qu'il en reste,
   * la validation de l'import est bloquée (même logique que le garde-fou existant sur
   * les « Reconnus »). Un doublon certain ne bloque rien : il est écarté sans clic.
   */
  function _bankUndecidedDuplicates(lines) {
    return (Array.isArray(lines) ? lines : []).filter(l =>
      l && l.isDuplicate && l.dupLevel === 'probable' && !l._userExclude && !l._userKeep && !l._dupConfirmed).length;
  }

  /**
   * ⑧.1 v2 (SMOKE 14/08, décision user) — « il faut pouvoir valider et garder en mémoire ».
   * Une ligne non prête ne bloque plus l'import : elle est GARDÉE en attente sur le compte
   * (DB.params.bankPending) et re-proposée au prochain import. Snapshot JSON-sûr : on garde
   * la donnée bancaire + la saisie non validée, on retire les drapeaux transitoires
   * (_userExclude, _reviewed, _userEdited — sinon les règles créées entre-temps ne
   * s'appliqueraient plus à la reprise).
   */
  function _bankPendingSnapshot(line) {
    if (!line) return null;
    const keep = ['date', 'libelle', 'debit', 'credit', 'signedAmount', 'fitid', 'raw',
      '_fingerprint', '_importSource', 'suggestedCat', 'suggestedQui', 'suggestedImm', 'suggestedCc',
      'confidence', 'matchSource', '_byRule', '_gerance', '_candidates', '_ambiguous', '_ruleConflicts', '_sp'];
    const out = {};
    keep.forEach(k => { if (line[k] !== undefined && line[k] !== null) out[k] = line[k]; });
    out._pending = true;
    return out;
  }

  /**
   * ⑧.1 v2 — fusionne les lignes du fichier et le stock « en attente » du compte.
   * Dédup par empreinte : si le nouveau fichier recontient une ligne en attente,
   * LE FICHIER GAGNE (donnée plus fraîche) ; le stock n'ajoute que ce qui manque.
   */
  function _bankMergePendingLines(fileLines, pendingLines) {
    const base = Array.isArray(fileLines) ? fileLines.slice() : [];
    const fps = new Set(base.map(l => l && l._fingerprint).filter(Boolean));
    (Array.isArray(pendingLines) ? pendingLines : []).forEach(p => {
      if (!p) return;
      if (p._fingerprint && fps.has(p._fingerprint)) return;
      base.push(Object.assign({}, p, { _pending: true }));
    });
    return base;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // v15.78 — Migration rétroactive des fingerprints sur mouvements existants
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Calcule et stocke `_fingerprint` sur les mouvements existants ÉLIGIBLES,
   * sans rawLine d'origine. Stratégie :
   *   - Mouvements avec `fitid` (OFX legacy v15.07) → fingerprint = 'fitid:' + fitid
   *   - Autres mouvements (CSV legacy ou saisis manuellement) → laissés intacts,
   *     leur dédup passera par le fallback legacy au prochain import (1 fois).
   *
   * Idempotent : ne recalcule pas si `_fingerprint` déjà présent.
   *
   * @param {object[]} mouvements — DB.mouvements (modifié en place pour les éligibles)
   * @returns {{ migrated:number, skipped:number }}
   */
  function _bankMigrateFingerprints(mouvements) {
    let migrated = 0, skipped = 0;
    if (!Array.isArray(mouvements)) return { migrated, skipped };
    for (const m of mouvements) {
      if (!m || m._deleted) { skipped++; continue; }
      if (m._fingerprint) { skipped++; continue; } // déjà migré
      if (m.fitid && String(m.fitid).trim()) {
        m._fingerprint = 'fitid:' + String(m.fitid).trim();
        migrated++;
      } else {
        skipped++; // CSV legacy ou saisi manuel : pas de migration possible
      }
    }
    return { migrated, skipped };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // BANK-IMPORT-V2 (v15.160 Phase A) — Identification du compte source d'un fichier
  // pour permettre un pointeur de progression par compte (au lieu du dédup heuristique
  // par contenu qui casse dès que l'user modifie les lignes après import).
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Extrait l'identifiant de compte d'un fichier OFX/QFX.
   * Cherche dans les blocs `<BANKACCTFROM>` (compte bancaire) ou `<CCACCTFROM>` (carte crédit).
   * @param {string} text — contenu OFX brut
   * @returns {{bankId:string, acctId:string, acctType:string, identifier:string} | null}
   *   `identifier` est préfixé 'acct:' pour distinguer des hashes CSV.
   */
  function _bankExtractOFXAccount(text) {
    if (!text || typeof text !== 'string') return null;
    // Cherche le 1er bloc BANKACCTFROM ou CCACCTFROM (peut être SGML ou XML).
    // On limite la recherche jusqu'à la prochaine balise majeure pour éviter de capturer trop.
    const blockMatch = text.match(/<(BANKACCTFROM|CCACCTFROM)>([\s\S]*?)(?:<\/\1>|<STMTTRN|<BANKTRANLIST|<LEDGERBAL)/i);
    const body = blockMatch ? blockMatch[2] : '';
    const get = (tag) => {
      const m = body.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
      return m ? m[1].trim() : '';
    };
    const bankId   = get('BANKID');
    const acctId   = get('ACCTID');
    const acctType = get('ACCTTYPE');
    if (!acctId) return null;
    return {
      bankId, acctId, acctType,
      identifier: 'acct:' + (bankId ? bankId + ':' : '') + acctId
    };
  }

  /**
   * ④.2 — Identifiant de compte trouvé dans un fichier Excel : on cherche l'**IBAN**
   * ou le **numéro de compte** dans le préambule — les lignes qu'on écarte de l'import
   * servent à identifier le compte.
   *
   * ⚠️ On ne transpose PAS le hash d'en-têtes de l'ancien lecteur CSV : il identifiait
   * un *format*, pas un compte — deux comptes de la même banque produisaient le même
   * identifiant (collision → pointeur faussé, doublons non détectés).
   *
   * @param {Array<Array>} rows — lignes brutes du tableur
   * @param {number} [headerRow] — ligne d'en-tête trouvée ; on ne fouille qu'AVANT
   * @returns {{identifier:string, kind:'iban'|'compte', value:string} | null}
   */
  function _bankExtractSheetAccount(rows, headerRow) {
    const all = Array.isArray(rows) ? rows : [];
    const stop = (headerRow == null || headerRow < 0) ? Math.min(all.length, 15) : headerRow;
    const texts = [];
    for (let i = 0; i < stop; i++) {
      const r = all[i]; if (!Array.isArray(r)) continue;
      for (const c of r) { if (c != null && String(c).trim()) texts.push(String(c)); }
    }
    const blob = texts.join(' ');
    // IBAN FR (27 caractères), tolérant aux espaces de présentation.
    const iban = blob.replace(/[  ]/g, ' ').match(/\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}[ ]?[A-Z0-9]{1,4})\b/);
    if (iban) {
      const v = iban[1].replace(/\s/g, '').toUpperCase();
      if (v.length >= 15 && v.length <= 34) return { identifier: 'iban:' + v, kind: 'iban', value: v };
    }
    // Numéro de compte annoncé explicitement (« Compte n° 00012345678 »).
    const cpt = blob.match(/(?:compte|account)[^0-9]{0,14}([0-9]{8,20})/i);
    if (cpt) return { identifier: 'cpt:' + cpt[1], kind: 'compte', value: cpt[1] };
    return null;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // BANK-IMPORT-V2 (v15.162 Phase D) — Pointeur de progression par compte
  // ────────────────────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────────────────
  // ④ LE COMPTE BANCAIRE — un compte appartient toujours à quelqu'un
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * ④.1 — Le **bailleur est obligatoire** sur un compte : ce n'est pas un filtre,
   * c'est un fait. Il débloque la règle « bailleur du compte » (R-C), les biens
   * proposés, et le garde-fou d'affectation ci-dessous.
   * Échappatoire explicite : `mixte:true` (« compte mixte — plusieurs bailleurs »),
   * qui désactive la règle dynamique et impose le classement manuel.
   * @returns {{ok:boolean, reason:string}}
   */
  function _bankAccountBailleurOk(account) {
    if (!account) return { ok: false, reason: 'aucun compte' };
    if (account.mixte) return { ok: true, reason: 'compte mixte — plusieurs bailleurs' };
    if (account.bailleur && String(account.bailleur).trim()) return { ok: true, reason: '' };
    return { ok: false, reason: 'ce compte n’a pas encore de bailleur' };
  }

  /**
   * ④.1 — Garde-fou : un mouvement du compte de la SCI X ne peut pas être affecté à
   * un bien d'une **autre** entité (rien ne l'empêchait avant). Un compte mixte, ou
   * un compte sans bailleur, ne bloque rien.
   * Fonction PURE : l'appelant résout l'entité du bien avant d'appeler.
   * @param {{bailleur?:string, mixte?:boolean}} account
   * @param {string} entiteCible — entité du bien visé ('' si inconnue)
   * @returns {{ok:boolean, message:string}}
   */
  function _bankAffectationConflict(account, entiteCible) {
    const cible = String(entiteCible || '').trim();
    if (!account || account.mixte || !account.bailleur || !cible) return { ok: true, message: '' };
    if (_bankNormTxt(account.bailleur) === _bankNormTxt(cible)) return { ok: true, message: '' };
    return {
      ok: false,
      message: 'Ce compte appartient à ' + account.bailleur + ' — un mouvement de ce compte ne peut pas être affecté à un bien de ' + cible + '.',
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // REGLES-REFONTE phase 5 — PÉRIMÈTRE PAR BAILLEUR (D6) + compte repris d'un import
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Compte d'une règle à l'ouverture de la fenêtre (décision Didier du 06/10, correction de la
   * phase 4). Le compte est REPRIS (lecture seule) dès qu'un compte est déjà connu ; le sélecteur
   * n'existe que s'il n'y en a aucun :
   *  - ligne d'import      → le compte de l'import ;
   *  - mouvement enregistré → le compte du mouvement ;
   *  - création « à froid » PENDANT un import (Réglages, « Mes règles »…) → le compte de l'import ;
   *  - création « à froid » hors import → sélecteur ;
   *  - règle existante avec compte → son compte (lecture seule) ; sans compte (historique) → sélecteur.
   * Fonction PURE.
   * @param {{edit?:boolean, ruleCompte?:*, lineAccountId?:*, mvAccountId?:*, importAccountId?:*}} p
   * @returns {{compte:string, fixe:boolean, origine:'regle'|'ligne'|'mouvement'|'import'|'aucun'}}
   */
  function _bankRuleCompteInitial(p = {}) {
    const has = v => v != null && String(v) !== '';
    if (p.edit) {
      return has(p.ruleCompte)
        ? { compte: String(p.ruleCompte), fixe: true, origine: 'regle' }
        : { compte: '', fixe: false, origine: 'aucun' };
    }
    if (has(p.lineAccountId)) return { compte: String(p.lineAccountId), fixe: true, origine: 'ligne' };
    if (has(p.mvAccountId)) return { compte: String(p.mvAccountId), fixe: true, origine: 'mouvement' };
    if (has(p.importAccountId)) return { compte: String(p.importAccountId), fixe: true, origine: 'import' };
    return { compte: '', fixe: false, origine: 'aucun' };
  }

  /**
   * D6 — Le compte appartient à un BAILLEUR : tout ce qui est proposé pour un mouvement de ce
   * compte (logements, immeubles, SCI, compteurs, locataires reconnus) est limité à ce bailleur.
   * Fonction PURE (aucune lecture de DB : l'appelant passe `data`).
   *
   * Règles (jamais d'élargissement silencieux) :
   *  - `opts.tout` (« Voir tout », ponctuel, choisi par l'utilisateur) : rien n'est filtré ;
   *  - compte avec périmètre immeuble (`scope:{niv:'imm',cible}`) : cet immeuble seulement
   *    (même pour un compte mixte : l'utilisateur l'a demandé) ;
   *  - compte mixte : plusieurs bailleurs, pas de filtre (classement manuel) ;
   *  - compte SANS bailleur ni mixte : comportement sûr = TOUT est proposé et `warn` l'explique
   *    (on ne cache jamais rien en silence faute de savoir à qui appartient le compte) ;
   *  - un bien dont le propriétaire est INCONNU (logement sans entité, immeuble introuvable,
   *    bail d'un lot qui n'existe plus) reste proposé : on ne masque que ce qu'on SAIT être à un
   *    autre bailleur.
   *
   * @param {{bailleur?:string, mixte?:boolean, scope?:{niv:string,cible:string}}|null} account
   * @param {{entites?:object[], logements?:object[]}} data — entités (nom, immeubles[{nom}]) et logements (ref, imm, entity)
   * @param {{tout?:boolean}} [opts]
   * @returns {{
   *   mode:'tout'|'bailleur'|'imm'|'mixte'|'sans-bailleur'|'aucun-compte', limite:boolean, elargi:boolean,
   *   bailleur:string, cible:string, warn:string,
   *   logementOk:(l:object)=>boolean, immeubleOk:(nom:string)=>boolean, entiteOk:(nom:string)=>boolean,
   *   bailOk:(ref:string, bail?:object)=>boolean
   * }}
   */
  function _bankPerimetre(account, data, opts = {}) {
    const d = data || {};
    const entites = (d.entites || []).filter(e => e && !e._deleted);
    const logements = (d.logements || []).filter(l => l && !l._deleted);
    const N = _bankNormTxt;
    const tout = !!(opts && opts.tout);
    const scope = account && account.scope && account.scope.niv === 'imm' && account.scope.cible ? account.scope : null;
    const bailleur = account && !account.mixte && account.bailleur && String(account.bailleur).trim() ? String(account.bailleur).trim() : '';

    let mode;
    if (!account) mode = 'aucun-compte';
    else if (scope) mode = 'imm';
    else if (account.mixte) mode = 'mixte';
    else if (bailleur) mode = 'bailleur';
    else mode = 'sans-bailleur';
    const filtre = mode === 'imm' || mode === 'bailleur';
    const actif = filtre && !tout;
    const warn = (mode === 'sans-bailleur')
      ? 'Ce compte n’a pas de bailleur : tout le patrimoine est proposé. Renseigner son bailleur pour limiter les listes.'
      : '';

    // Propriétaire(s) d'un immeuble : entités qui le déclarent + entité de ses logements.
    const ownersOfImm = (nom) => {
      const out = new Set();
      const n = N(nom);
      if (!n) return out;
      entites.forEach(e => { if ((e.immeubles || []).some(i => i && !i._deleted && N(i.nom) === n)) out.add(N(e.nom)); });
      logements.forEach(l => { if (N(l.imm) === n && l.entity) out.add(N(l.entity)); });
      return out;
    };
    const sameBailleur = (owner) => N(owner) === N(bailleur);
    const cibleImm = scope ? N(scope.cible) : '';
    const cibleOwners = scope ? ownersOfImm(scope.cible) : new Set();

    const logementOk = (l) => {
      if (!actif || !l) return true;
      if (mode === 'imm') return N(l.imm) === cibleImm;
      return !l.entity || sameBailleur(l.entity);
    };
    const immeubleOk = (nom) => {
      if (!actif) return true;
      if (mode === 'imm') return N(nom) === cibleImm;
      const o = ownersOfImm(nom);
      return o.size === 0 || o.has(N(bailleur));
    };
    const entiteOk = (nom) => {
      if (!actif) return true;
      if (mode === 'imm') return cibleOwners.size === 0 || cibleOwners.has(N(nom));
      return sameBailleur(nom);
    };
    const bailOk = (ref, bail) => {
      if (!actif) return true;
      const lg = logements.find(l => l.ref === ref);
      if (lg) return logementOk(lg);
      // Lot disparu de la liste (supprimé / archivé hors données) : on s'en remet au bail s'il porte son entité.
      const ent = bail && (bail.entity || bail.entite);
      if (mode === 'bailleur' && ent) return sameBailleur(ent);
      return true;
    };
    return {
      mode, limite: actif, elargi: filtre && tout, bailleur, cible: scope ? String(scope.cible) : '', warn,
      logementOk, immeubleOk, entiteOk, bailOk,
    };
  }

  /**
   * Baux proposés pour la reconnaissance du locataire (« Proposition — locataire reconnu »),
   * limités au périmètre du compte. Le bail CLOS « ancien locataire » d'un lot du MÊME bailleur
   * reste proposé (CDC ⑦.5 d). Fonction PURE : renvoie un NOUVEL objet {ref → bail}.
   * @param {Object<string,object>} baux — {ref → bail} (baux actifs + clos marqués `cloture`)
   * @param {ReturnType<typeof _bankPerimetre>} perimetre
   */
  function _bankBauxDuPerimetre(baux, perimetre) {
    const out = {};
    for (const [ref, bail] of Object.entries(baux || {})) {
      if (!perimetre || perimetre.bailOk(ref, bail)) out[ref] = bail;
    }
    return out;
  }

  /**
   * ⑤.1 — Migration DOUCE et IDEMPOTENTE des comptes : l'ancien pointeur unique
   * (`lastImport.fingerprint`) devient une liste des **10 dernières empreintes**.
   * Ne touche à rien d'autre : aucun compte n'est supprimé, aucun bailleur inventé.
   * @param {object[]} accounts — DB.params.bankAccounts (modifié en place)
   * @returns {{migrated:number, skipped:number}}
   */
  function _bankMigrateAccounts(accounts) {
    let migrated = 0, skipped = 0;
    for (const a of (Array.isArray(accounts) ? accounts : [])) {
      if (!a || a._deleted) { skipped++; continue; }
      const li = a.lastImport;
      if (!li) { skipped++; continue; }
      if (Array.isArray(li.fingerprints)) { skipped++; continue; }   // déjà migré
      li.fingerprints = li.fingerprint ? [li.fingerprint] : [];
      migrated++;
    }
    return { migrated, skipped };
  }

  /** Nombre d'empreintes de reprise mémorisées par compte (⑤.1). */
  const _BANK_FP_MEMORY = 10;

  /**
   * ⑤.1 — Coupe le fichier après **la plus récente des empreintes mémorisées**.
   * Une seule suffit pour rester déterministe : un chevauchement partiel, une ligne
   * disparue ou un libellé retouché ne cassent plus la reprise.
   * @param {object[]} lines
   * @param {string[]} fingerprints — les 10 dernières empreintes importées (plus récente en tête)
   * @returns {{after:object[], found:boolean, idx:number, matched:string}}
   */
  function _bankSliceAfterFingerprints(lines, fingerprints) {
    const fps = (Array.isArray(fingerprints) ? fingerprints : []).filter(Boolean);
    const all = Array.isArray(lines) ? lines : [];
    if (!fps.length) return { after: all, found: false, idx: -1, matched: '' };
    // On garde la coupe qui laisse le MOINS de lignes : c'est l'empreinte la plus
    // récente réellement présente dans le fichier.
    let best = null;
    for (const fp of fps) {
      const r = _bankSliceAfterFingerprint(all, fp);
      if (!r.found) continue;
      if (!best || r.after.length < best.after.length) best = { ...r, matched: fp };
    }
    return best || { after: all, found: false, idx: -1, matched: '' };
  }

  /**
   * ⑤.2 — Un fichier dont la ligne la plus récente est ANTÉRIEURE au pointeur est un
   * import **rétroactif** : accepté, mais annoncé. Toutes les lignes sont proposées,
   * les doublons déjà en base sont détectés.
   */
  function _bankIsRetroactive(lines, lastImport) {
    if (!lastImport || !lastImport.date) return false;
    const ds = (Array.isArray(lines) ? lines : []).map(l => l && l.date).filter(Boolean).sort();
    if (!ds.length) return false;
    return ds[ds.length - 1] < lastImport.date;
  }

  /**
   * Coupe une liste de lignes parsées à la position d'un fingerprint pointeur.
   * Sert au mode « imports suivants » : on récupère seulement ce qui est APRÈS la
   * dernière ligne déjà importée pour ce compte (identifiée par son `_fingerprint`).
   * @param {object[]} lines — lignes parsées (chaque ligne a un `_fingerprint`)
   * @param {string} fingerprint — fingerprint de la dernière ligne déjà importée
   * @returns {{after:object[], found:boolean, idx:number}}
   *   - found:true  → idx = position du pointeur ; after = les lignes PLUS RÉCENTES que le pointeur (peut être vide si tout est déjà importé)
   *   - found:false → idx = -1 ; after = lines (toutes — le caller doit appliquer un fallback : dédup heuristique)
   */
  function _bankSliceAfterFingerprint(lines, fingerprint) {
    if (!fingerprint || !Array.isArray(lines)) return { after: Array.isArray(lines) ? lines : [], found: false, idx: -1 };
    const idx = lines.findIndex(l => l && l._fingerprint === fingerprint);
    if (idx < 0) return { after: lines, found: false, idx: -1 };
    // BUG-BANK-SLICE-DESC (13/07/2026) : la sémantique est « les lignes PLUS RÉCENTES que le
    // pointeur », pas « après dans l'ordre du fichier ». Certains exports sont chronologiques
    // croissants (CM, BNP…), d'autres DÉCROISSANTS (Crédit Agricole : récent en premier) — le
    // slice positionnel supposait croissant et, sur un fichier décroissant, renvoyait le côté
    // ANCIEN (déjà importé) en jetant silencieusement toutes les nouvelles lignes. Détection de
    // l'ordre par les dates qui encadrent le fichier ; dates absentes/égales → repli positionnel
    // historique (croissant), inchangé.
    const dates = lines.map(l => (l && l.date) || '').filter(Boolean);
    const desc = dates.length >= 2 && dates[0] > dates[dates.length - 1];
    return { after: desc ? lines.slice(0, idx) : lines.slice(idx + 1), found: true, idx };
  }

  /**
   * Calcule le nouveau pointeur `lastImport` à partir d'un lot de lignes qu'on vient d'importer.
   * La « dernière ligne » est celle dont la `date` est la plus grande (pas l'ordre dans le fichier,
   * qui peut être DESC chez certaines banques).
   *
   * 🐛 **BUG 2 du CDC (⑤.2) — LE POINTEUR NE RECULE JAMAIS.** Avant, le pointeur était
   * recalculé comme la date max du lot importé et **écrasait** l'ancien : importer juin
   * après août faisait RECULER le pointeur de fin août à fin juin, et l'import suivant
   * reproposait juillet-août en entier. On garde désormais la date la plus récente entre
   * l'ancien pointeur et le nouveau, et l'empreinte qui va avec.
   *
   * ⑤.1 — On mémorise les **10 dernières empreintes** (plus récente en tête) au lieu
   * d'une seule : un chevauchement partiel, une ligne disparue ou un libellé retouché
   * ne cassent plus la reprise.
   *
   * @param {object[]} acceptedLines — lignes effectivement importées (chacune avec date + _fingerprint)
   * @param {number} previousCount — compteur cumulé existant (avant cet import)
   * @param {object} [previousLastImport] — pointeur existant, pour ne jamais reculer
   * @returns {{date:string, fingerprint:string|null, fingerprints:string[], count:number, at:string} | null}
   */
  function _bankComputeLastImport(acceptedLines, previousCount, previousLastImport) {
    if (!Array.isArray(acceptedLines) || !acceptedLines.length) return previousLastImport || null;
    const prev = previousLastImport || null;
    const sorted = acceptedLines.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const last = sorted[sorted.length - 1];
    const newDate = last.date || '';
    const prevDate = (prev && prev.date) || '';
    const fresh = sorted.slice().reverse().map(l => l && l._fingerprint).filter(Boolean);
    const prevFps = Array.isArray(prev && prev.fingerprints) ? prev.fingerprints
      : ((prev && prev.fingerprint) ? [prev.fingerprint] : []);
    // Le pointeur ne recule jamais : on garde la date la plus récente des deux.
    const keepPrev = prevDate && newDate && prevDate > newDate;
    // 🐛 Audit I1 — LES EMPREINTES SUIVENT LA MÊME RÈGLE QUE LA DATE. En mettant toujours
    // le lot fraîchement importé en tête, un import RÉTROACTIF (⑤.2) chassait les 10
    // empreintes d'août au profit de celles de juin : l'import de septembre ne retrouvait
    // plus rien et affichait « Reprise non retrouvée » — précisément ce que ⑤.1 devait
    // supprimer. On garde en tête les empreintes du côté le plus RÉCENT.
    const fingerprints = keepPrev
      ? [...new Set([...prevFps, ...fresh])].slice(0, _BANK_FP_MEMORY)
      : [...new Set([...fresh, ...prevFps])].slice(0, _BANK_FP_MEMORY);
    return {
      date: keepPrev ? prevDate : newDate,
      fingerprint: keepPrev ? (prev.fingerprint || null) : (last._fingerprint || null),
      fingerprints,
      count: (Number(previousCount) || 0) + acceptedLines.length,
      at: new Date().toISOString()
    };
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.BankImport = {
    _bankHashStable: _bankHashStable,
    _bankFingerprintRow: _bankFingerprintRow,
    _bankFingerprintOFX: _bankFingerprintOFX,
    _BANK_MAX_FILE_SIZE: _BANK_MAX_FILE_SIZE,
    _bankDetectFormat: _bankDetectFormat,
    _bankParseAmount: _bankParseAmount,
    _bankParseDate: _bankParseDate,
    _bankIsDateLike: _bankIsDateLike,
    _bankIsAmountLike: _bankIsAmountLike,
    _bankForeignCurrency: _bankForeignCurrency,
    _bankOfxTag: _bankOfxTag,
    _bankOfxLabel: _bankOfxLabel,
    _bankParseOFX: _bankParseOFX,
    _bankReadOFX: _bankReadOFX,
    _bankFindHeaderRow: _bankFindHeaderRow,
    _bankPickDateColumn: _bankPickDateColumn,
    _bankPickAmountColumn: _bankPickAmountColumn,
    _bankDetectOrientation: _bankDetectOrientation,
    _bankCheckBalance: _bankCheckBalance,
    _bankMarkDoubtfulDates: _bankMarkDoubtfulDates,
    _bankPickSheets: _bankPickSheets,
    _bankReadTable: _bankReadTable,
    _bankLineSens: _bankLineSens,
    _bankRuleMatch: _bankRuleMatch,
    _bankApplyRules: _bankApplyRules,
    _bankResolveAff: _bankResolveAff,
    _bankRulePreview: _bankRulePreview,
    _bankRuleUsage: _bankRuleUsage,
    _bankRuleIsV2: _bankRuleIsV2,
    _bankRuleNewId: _bankRuleNewId,
    _bankRuleLineKey: _bankRuleLineKey,
    _bankRuleMotif: _bankRuleMotif,
    _bankMotsDuLibelle: _bankMotsDuLibelle,
    _bankRuleBuild: _bankRuleBuild,
    _bankRuleToDraft: _bankRuleToDraft,
    _bankRuleAddException: _bankRuleAddException,
    _bankRuleRemoveException: _bankRuleRemoveException,
    _bankMigrateRules: _bankMigrateRules,
    _bankRuleIdxById: _bankRuleIdxById,
    _bankRuleById: _bankRuleById,
    _bankRuleFindForTrace: _bankRuleFindForTrace,
    _bankRuleTombstone: _bankRuleTombstone,
    _bankRulesMergeById: _bankRulesMergeById,
    _bankRuleExactDuplicate: _bankRuleExactDuplicate,
    _bankRulesDuplicates: _bankRulesDuplicates,
    _bankRulesFuse: _bankRulesFuse,
    _bankRuleGarderLesDeux: _bankRuleGarderLesDeux,
    _bankRulesDoublonsParId: _bankRulesDoublonsParId,
    _bankRulesParCompte: _bankRulesParCompte,
    _bankRuleVue: _bankRuleVue,
    _bankRuleApercu: _bankRuleApercu,
    _bankRuleTraceKey: _bankRuleTraceKey,
    _bankLineApplyRules: _bankLineApplyRules,
    _bankRuleAutresResultats: _bankRuleAutresResultats,
    _bankReclassifyPrepare: _bankReclassifyPrepare,
    _bankRulePatchMouvement: _bankRulePatchMouvement,
    _bankRulePrefill: _bankRulePrefill,
    _bankRuleMotsDuChamp: _bankRuleMotsDuChamp,
    _bankRuleMontantDepuisSaisie: _bankRuleMontantDepuisSaisie,
    _bankMotSaisiDiagnostic: _bankMotSaisiDiagnostic,
    _bankRuleExceptionsApresCase: _bankRuleExceptionsApresCase,
    _bankRuleExceptionPortee: _bankRuleExceptionPortee,
    _bankRuleSuggestions: _bankRuleSuggestions,
    _bankRuleStatutLigne: _bankRuleStatutLigne,
    _bankMatchHeuristic: _bankMatchHeuristic,
    _bankDedup: _bankDedup,
    _bankIsAutomatable: _bankIsAutomatable,
    _bankUndecidedDuplicates: _bankUndecidedDuplicates,
    _bankPendingSnapshot: _bankPendingSnapshot,
    _bankMergePendingLines: _bankMergePendingLines,
    _bankMigrateFingerprints: _bankMigrateFingerprints,
    _bankExtractOFXAccount: _bankExtractOFXAccount,
    _bankExtractSheetAccount: _bankExtractSheetAccount,
    _bankAccountBailleurOk: _bankAccountBailleurOk,
    _bankAffectationConflict: _bankAffectationConflict,
    _bankRuleCompteInitial: _bankRuleCompteInitial,
    _bankPerimetre: _bankPerimetre,
    _bankBauxDuPerimetre: _bankBauxDuPerimetre,
    _bankMigrateAccounts: _bankMigrateAccounts,
    _BANK_FP_MEMORY: _BANK_FP_MEMORY,
    _bankSliceAfterFingerprints: _bankSliceAfterFingerprints,
    _bankIsRetroactive: _bankIsRetroactive,
    _bankSliceAfterFingerprint: _bankSliceAfterFingerprint,
    _bankComputeLastImport: _bankComputeLastImport
  };
  for (var _k in global.BankImport) {
    if (Object.prototype.hasOwnProperty.call(global.BankImport, _k)) global[_k] = global.BankImport[_k];
  }
})(typeof window !== 'undefined' ? window : globalThis);
