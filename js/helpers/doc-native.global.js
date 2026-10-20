/**
 * doc-native.global.js — Wrapper browser (window.DocNative)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/doc-native.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // ─── DÉPENDANCES IMPORTÉES depuis ./pdf-flow.js (résolues via global) ───
  function splitBlockAcrossPages(){
    if (!global.PdfFlow || typeof global.PdfFlow.splitBlockAcrossPages !== 'function') {
      console.warn('[mirror doc-native] dep manquante: global.PdfFlow.splitBlockAcrossPages');
      // Fallback minimal pour formatAdresse-like (objet imm → string vide ou rue)
      return (arguments[0] && typeof arguments[0] === 'object' && arguments[0].adr) ? arguments[0].adr : '';
    }
    return global.PdfFlow.splitBlockAcrossPages.apply(null, arguments);
  }

  // ─── DÉPENDANCES IMPORTÉES depuis ./doc-brand.js (résolues via global) ───
  function brandzoneModel(){
    if (!global.DocBrand || typeof global.DocBrand.brandzoneModel !== 'function') {
      console.warn('[mirror doc-native] dep manquante: global.DocBrand.brandzoneModel');
      // Fallback minimal pour formatAdresse-like (objet imm → string vide ou rue)
      return (arguments[0] && typeof arguments[0] === 'object' && arguments[0].adr) ? arguments[0].adr : '';
    }
    return global.DocBrand.brandzoneModel.apply(null, arguments);
  }
  function propryoMarkOps(){
    if (!global.DocBrand || typeof global.DocBrand.propryoMarkOps !== 'function') {
      console.warn('[mirror doc-native] dep manquante: global.DocBrand.propryoMarkOps');
      // Fallback minimal pour formatAdresse-like (objet imm → string vide ou rue)
      return (arguments[0] && typeof arguments[0] === 'object' && arguments[0].adr) ? arguments[0].adr : '';
    }
    return global.DocBrand.propryoMarkOps.apply(null, arguments);
  }

  // ─── DÉPENDANCES IMPORTÉES depuis ./montant-doc.js (résolues via global) ───
  function pdfSafeText(){
    if (!global.MontantDoc || typeof global.MontantDoc.pdfSafeText !== 'function') {
      console.warn('[mirror doc-native] dep manquante: global.MontantDoc.pdfSafeText');
      // Fallback minimal pour formatAdresse-like (objet imm → string vide ou rue)
      return (arguments[0] && typeof arguments[0] === 'object' && arguments[0].adr) ? arguments[0].adr : '';
    }
    return global.MontantDoc.pdfSafeText.apply(null, arguments);
  }

  // __tests__/helpers/doc-native.js — CDC-QUITTANCES-IRL D26 : le MOTEUR d'écriture NATIF partagé
  // pour tous les documents émis (fini la rasterisation html2canvas).
  //
  // POURQUOI (D26) : les quatre documents restants (quittance, lettre IRL, décompte de charges,
  // récap DDT) sortaient en IMAGE (html2canvas → JPEG → addImage) : 449 Ko, 2 pages, 184 DPI,
  // flous. Le moteur natif du bail (`PDF_NATIVE`, v13.05) était enfermé dans la source stringifiée
  // de la fenêtre d'aperçu du bail — inatteignable depuis la fenêtre principale. Ce module l'expose.
  //
  // DEUX rôles, un seul fichier :
  //  1. `PDF_NATIVE` — les primitives de tracé jsPDF (marges A4, drawText à retour à la ligne,
  //     drawTitle, drawTable via autoTable, drawBrandzone vectoriel). Sous-ensemble « document »
  //     du moteur du bail (les méthodes de signature/paraphe restent au bail).
  //  2. Un pont HTML→NATIF SANS DOM : `parseDocDoc` lit le HTML `.pro-doc` que produisent déjà les
  //     générateurs (`_buildQuittanceHtml`/`_buildIRLLetterHtml`/`_buildDecompteHtml`, via le gabarit
  //     unique DocTemplate) et le rejoue en texte natif. AUCUN mot n'est réécrit : le fond juridique
  //     est celui de l'aperçu, mot pour mot (garde-fou D26 « zéro mot perdu/ajouté »).
  //
  // PUR côté parsing (aucun DOM — la cible de test est `node`) : le découpage se fait sur les
  // classes STABLES du gabarit (`pro-parties`, `pro-lignes`, `pro-tbl`, `pro-acte`, `pro-mention`,
  // `pro-encart`, `pro-lieu`, `pro-signzone`). Le tracé, lui, s'exerce contre une fausse instance
  // jsPDF qui capture `text()` — comme email-pdf-attachment.test.js.
  //
  // Tests : __tests__/helpers/doc-native.test.js




  // ────────────────────────────────────────────────────────────────────────────
  // 1. Décodage HTML → texte (aucune balise, entités WinAnsi décodées, texte assaini)
  // ────────────────────────────────────────────────────────────────────────────

  const _SP = String.fromCharCode(32);    // espace ASCII garanti
  const _NBSP = String.fromCharCode(160);  // espace insécable WinAnsi (0xA0)

  /** Entités rencontrées dans le fond des documents (escHtml + littéraux des gabarits). */
  function _decodeEntities(s) {
    return String(s == null ? '' : s)
      // Les frontières de blocs séparent les mots (comme le navigateur les rend) : sans ça, deux
      // paragraphes voisins « habilité ;</p><p>Désigné(s) » se colleraient en « ;Désigné(s) ».
      .replace(/<\/?(?:p|div|h[1-6]|li|tr|ul|ol|table|thead|tbody)\b[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, _NBSP)
      .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
      .replace(/&eacute;/g, 'é').replace(/&egrave;/g, 'è').replace(/&agrave;/g, 'à')
      .replace(/&ccedil;/g, 'ç').replace(/&ecirc;/g, 'ê').replace(/&ocirc;/g, 'ô')
      .replace(/&euro;/g, '€')
      .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&rsquo;/g, '’')
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&'); // en dernier, sinon double-décodage
  }

  function _trimAsciiWs(l) {
    return l.replace(/[\t\x20]+$/, '').replace(/^[\t\x20]+/, '').replace(/[\t\x20]{2,}/g, _SP);
  }

  /**
   * HTML → texte : balises retirées, <br> → saut de ligne, espaces ASCII normalisés, PUIS assaini
   * WinAnsi (pdfSafeText). Les caractères non encodables par les polices standard (emoji décoratifs
   * ⏱/✓/⚠/🔒, espaces exotiques d'ICU) sont retirés ICI, en amont : le rendu natif ne les envoie
   * jamais à pdf.text, ce qui garantit « 0 avertissement [pdfSafeText] » (D26). Accents, €, «»,
   * tirets typographiques — tous WinAnsi — sont conservés.
   */
  function htmlToText(s) {
    const t = _decodeEntities(s);
    const lines = t.split('\n').map(l => _trimAsciiWs(pdfSafeText(_trimAsciiWs(l))));
    return lines.join('\n').replace(/^\n+|\n+$/g, '').replace(/\n{2,}/g, '\n');
  }

  /** HTML → suite de mots (pour le garde-fou « zéro mot perdu/ajouté »). */
  function htmlToWords(s) {
    return htmlToText(s).split(/\s+/).filter(Boolean);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Tokenizer SANS DOM du corps d'un document du gabarit
  // ────────────────────────────────────────────────────────────────────────────

  /** Éléments HTML sans balise fermante (auto-fermants). */
  const _VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'col', 'area', 'base', 'wbr']);

  /**
   * Découpe une chaîne HTML en segments de PREMIER niveau, en respectant l'imbrication (un
   * `<div class="pro-parties">` qui contient des `<p>` reste UN seul segment ; une `<table>` reste
   * atomique). CONTRAT (audit 26/08, documents opposables) : AUCUN contenu de premier niveau n'est
   * jamais perdu — TOUT élément (quel que soit son tag, pas seulement div/p/table) ET tout texte nu
   * non blanc entre les éléments sont renvoyés. Ce qui n'est pas reconnu par `classifyBlock` y est
   * rendu en paragraphe ET signalé bruyamment (jamais avalé en silence). Le texte purement blanc
   * (indentation, retours) est le seul écarté.
   */
  function splitTopLevelBlocks(html) {
    const s = String(html || '');
    const blocks = [];
    let i = 0; const n = s.length;
    while (i < n) {
      const lt = s.indexOf('<', i);
      if (lt < 0) { const t = s.slice(i); if (t.trim()) blocks.push(t); break; }
      if (lt > i) { const t = s.slice(i, lt); if (t.trim()) blocks.push(t); }   // texte nu de 1er niveau
      const m = /^<\s*(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)\s*>/.exec(s.slice(lt));
      if (!m) { const t = s.slice(lt); if (t.trim()) blocks.push(t); break; }   // '<' isolé : rien perdu
      const closing = m[1] === '/';
      const tag = m[2].toLowerCase();
      const selfClose = m[3] === '/' || _VOID_TAGS.has(tag);
      const tagEnd = lt + m[0].length;
      if (closing) { i = tagEnd; continue; }                                    // fermante orpheline
      if (selfClose) { blocks.push(s.slice(lt, tagEnd)); i = tagEnd; continue; }
      // Fin de CET élément : on matche la fermeture du MÊME tag, en respectant son imbrication.
      const re = new RegExp('<\\s*(/?)' + tag + '\\b[^>]*>', 'gi');
      re.lastIndex = tagEnd;
      let depth = 1, mm, closeEnd = -1;
      while ((mm = re.exec(s))) {
        if (mm[1] === '/') { if (--depth === 0) { closeEnd = re.lastIndex; break; } }
        else depth++;
      }
      if (closeEnd < 0) closeEnd = n;                                            // non fermé : jusqu'au bout
      blocks.push(s.slice(lt, closeEnd));
      i = closeEnd;
    }
    return blocks;
  }

  /** Retire la balise ouvrante et fermante extérieures d'un bloc (`<p ...>X</p>` → `X`). */
  function _inner(block) {
    return String(block || '').trim()
      .replace(/^<[a-z0-9]+\b[^>]*>/i, '')
      .replace(/<\/[a-z0-9]+>\s*$/i, '');
  }

  function _hasClass(s, cls) { return new RegExp('class="[^"]*\\b' + cls + '\\b').test(s); }

  function _parseParties(block) {
    const out = [];
    const re = /<div class="pro-partie">([\s\S]*?)<\/div>/g;
    let m;
    while ((m = re.exec(block))) {
      const inner = m[1];
      const label = (inner.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1] || '';
      const qui = (inner.match(/<span class="pro-qui">([\s\S]*?)<\/span>/) || [])[1] || '';
      const corps = inner.replace(/<h2>[\s\S]*?<\/h2>/, '').replace(/<span class="pro-qui">[\s\S]*?<\/span>/, '');
      out.push({ label, qui, corps });
    }
    return out;
  }

  function _parseLignes(block) {
    const out = [];
    const re = /<div class="pro-lg([^"]*)">\s*<span class="lab">([\s\S]*?)<\/span>\s*<span class="val">([\s\S]*?)<\/span>\s*<\/div>/g;
    let m;
    while ((m = re.exec(block))) {
      out.push({ lab: m[2], val: m[3], tot: /\btot\b/.test(m[1]), hi: /\bhi\b/.test(m[1]) });
    }
    return out;
  }

  function _parseSignzone(block) {
    const out = [];
    let m, any = false;
    const objRe = /<div class="pro-sigspace">([\s\S]*?)<\/div>\s*<div class="pro-signbox">([\s\S]*?)<\/div>/g;
    while ((m = objRe.exec(block))) { out.push({ sig: m[1], label: m[2] }); any = true; }
    if (any) return out;
    const strRe = /<div class="pro-signbox">([\s\S]*?)<\/div>/g;
    while ((m = strRe.exec(block))) out.push({ sig: '', label: m[1] });
    return out;
  }

  function _parseTbl(block) {
    const rows = [...block.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)];
    let head = null; const body = []; let foot = null;
    for (const [, attrs, cellsHtml] of rows) {
      const cells = [...cellsHtml.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => c[1]);
      if (/<th/i.test(cellsHtml)) { head = cells; continue; }
      if (/\btot\b/.test(attrs)) { foot = cells; continue; }
      body.push(cells);
    }
    return { head, rows: body, foot };
  }

  /** Classe un bloc de premier niveau du corps d'un document. */
  function classifyBlock(raw) {
    const s = String(raw || '').trim();
    if (!s) return { t: 'para', v: '' };
    if (_hasClass(s, 'no-print') || _hasClass(s, 'alerte')) return { t: 'alerte', v: s, screenOnly: true };
    if (_hasClass(s, 'pro-parties')) return { t: 'parties', blocs: _parseParties(s) };
    if (_hasClass(s, 'pro-lignes')) return { t: 'lignes', rows: _parseLignes(s) };
    // AVENANT-REFONTE §7 D7 — tableau clé / valeur : rendu en deux colonnes (clé en gras sur fond),
    // pas en tableau autoTable dont la dernière colonne était alignée à droite.
    if (_hasClass(s, 'pro-kv')) return { t: 'kv', rows: _parseTbl(s).rows };
    if (_hasClass(s, 'pro-tbl') || /^<table/i.test(s)) return Object.assign({ t: 'tbl' }, _parseTbl(s));
    // AVENANT-REFONTE §7 D5 — titre d'article : il était rendu en texte courant (et signalé).
    if (/^<h3[\s>]/i.test(s)) return { t: 'h3', v: _inner(s) };
    if (_hasClass(s, 'pro-acte')) return { t: 'acte', v: _inner(s) };
    if (_hasClass(s, 'pro-mention')) return { t: 'mention', v: _inner(s) };
    if (_hasClass(s, 'pro-encart')) return { t: 'encart', v: _inner(s) };
    if (_hasClass(s, 'pro-lieu')) return { t: 'lieu', v: _inner(s) };
    if (_hasClass(s, 'pro-signzone')) return { t: 'signzone', boxes: _parseSignzone(s) };
    if (/^<p[\s>]/i.test(s)) return { t: 'para', v: _inner(s) };   // paragraphe nu du gabarit : connu
    // TOUT le reste — élément de premier niveau NON PRÉVU par le gabarit (<h2>, <ul>, <blockquote>…)
    // ou texte nu — est RENDU en paragraphe (aucun mot perdu) ET SIGNALÉ bruyamment. Un document
    // opposable ne doit jamais perdre un mot en silence : on rend d'abord, on avertit ensuite, et le
    // drapeau `_unhandled` permet aux tests d'exiger l'intégration au gabarit (audit 26/08).
    const asText = /^</.test(s) ? _inner(s) : s;
    if (String(asText).trim() && typeof console !== 'undefined' && console.warn) {
      console.warn('[docNative] contenu de premier niveau non géré par le gabarit, rendu en paragraphe (à intégrer) :', s.slice(0, 140));
    }
    return { t: 'para', v: asText, _unhandled: true };
  }

  /** Contenu à l'intérieur du conteneur `.pro-doc`. */
  function _innerProDoc(html) {
    const s = String(html || '');
    const m = s.match(/<div class="pro-doc"[^>]*>/);
    if (!m) return s;
    const open = m.index + m[0].length;
    const close = s.lastIndexOf('</div>');
    return close > open ? s.slice(open, close) : s.slice(open);
  }

  /**
   * Reconstruit un document du gabarit : {titre, ctx, ref, date, blocks}. Le bandeau (avant le
   * titre) et le pied sont retirés du corps — le bandeau est rejoué en vectoriel, le pied est
   * porté par {ref, date}.
   */
  function parseDocDoc(html) {
    const inner = _innerProDoc(html);
    const top = splitTopLevelBlocks(inner);
    const titreIdx = top.findIndex(b => _hasClass(b, 'pro-titre'));
    const piedIdx = top.findIndex(b => _hasClass(b, 'pro-pied'));
    const titreBlock = titreIdx >= 0 ? top[titreIdx] : '';
    const piedBlock = piedIdx >= 0 ? top[piedIdx] : '';
    const titre = (titreBlock.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '';
    const ctx = (titreBlock.match(/<p class="pro-ctx">([\s\S]*?)<\/p>/) || [])[1] || '';
    const piedSpans = [...piedBlock.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map(mm => htmlToText(mm[1]));
    const from = titreIdx >= 0 ? titreIdx + 1 : 0;
    const to = piedIdx >= 0 ? piedIdx : top.length;
    const blocks = [];
    for (let k = from; k < to; k++) {
      const raw = top[k];
      if (_hasClass(raw, 'pro-titre') || _hasClass(raw, 'pro-pied')) continue;
      blocks.push(classifyBlock(raw));
    }
    return { titre: htmlToText(titre), ctx: htmlToText(ctx), ref: piedSpans[0] || '', date: piedSpans[1] || '', blocks };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Mots d'un document (garde-fou « zéro mot perdu/ajouté »)
  // ────────────────────────────────────────────────────────────────────────────

  function _blockText(b) {
    if (!b || b.screenOnly) return '';
    switch (b.t) {
      case 'parties': return (b.blocs || []).map(p => [p.label, p.qui, htmlToText(p.corps)].filter(Boolean).join(' ')).join(' ');
      case 'lignes': return (b.rows || []).map(r => htmlToText(r.lab) + ' ' + htmlToText(r.val)).join(' ');
      case 'tbl': return [(b.head || []).map(htmlToText).join(' '), (b.rows || []).map(r => r.map(htmlToText).join(' ')).join(' '), (b.foot || []).map(htmlToText).join(' ')].join(' ');
      case 'kv': return (b.rows || []).map(r => r.map(htmlToText).join(' ')).join(' ');
      case 'signzone': return (b.boxes || []).map(x => htmlToText(x.label)).join(' ');
      default: return htmlToText(b.v);
    }
  }

  /** La suite de mots d'un document (titre, ctx, corps, pied) — hors bandeaux d'écran no-print. */
  function docWords(parsed) {
    const p = parsed || {};
    const parts = [p.titre || '', p.ctx || ''];
    for (const b of (p.blocks || [])) parts.push(_blockText(b));
    parts.push(p.ref || '', p.date || '');
    return parts.join(' ').split(/\s+/).filter(Boolean);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 4. PDF_NATIVE — primitives de tracé (sous-ensemble « document » du moteur du bail v13.05)
  // ────────────────────────────────────────────────────────────────────────────

  const PDF_NATIVE = {
    MARGIN_LEFT: 15, MARGIN_RIGHT: 15, MARGIN_TOP: 15, MARGIN_BOTTOM: 25,
    PAGE_W: 210, PAGE_H: 297, CONTENT_W: 180,
    FONT_FAMILY: 'helvetica',
    FONT_SIZE_BODY: 10.5, FONT_SIZE_H1: 14, FONT_SIZE_H2: 11, FONT_SIZE_H3: 10.5, FONT_SIZE_NOTE: 9, FONT_SIZE_SMALL: 8,
    PARAGRAPH_GAP: 2.5, H2_GAP_BEFORE: 6, H2_GAP_AFTER: 3, H3_GAP_BEFORE: 4, H3_GAP_AFTER: 2,
    COLOR_TEXT: [25, 25, 25], COLOR_MUTED: [110, 110, 110], COLOR_TITLE: [10, 10, 10],
    COLOR_BORDER: [180, 180, 180], COLOR_TABLE_HEADER_BG: [240, 240, 240],
    COLOR_PLACEHOLDER_BORDER: [200, 200, 200], COLOR_PLACEHOLDER_LABEL: [150, 150, 150],

    drawText: function (pdf, text, x, y, opts) {
      opts = opts || {};
      var size = opts.size || PDF_NATIVE.FONT_SIZE_BODY;
      var style = opts.style || 'normal';
      var color = opts.color || PDF_NATIVE.COLOR_TEXT;
      var maxWidth = opts.maxWidth || PDF_NATIVE.CONTENT_W;
      var align = opts.align || 'left';
      pdf.setFont(PDF_NATIVE.FONT_FAMILY, style);
      pdf.setFontSize(size);
      pdf.setTextColor(color[0], color[1], color[2]);
      var lines = pdf.splitTextToSize(String(text || ''), maxWidth);
      var lineHeight = size * 0.4;
      var actualX = x;
      if (align === 'center') actualX = x + maxWidth / 2;
      else if (align === 'right') actualX = x + maxWidth;
      var _chunks = splitBlockAcrossPages(y, lines.length, lineHeight, { pageH: PDF_NATIVE.PAGE_H, marginTop: PDF_NATIVE.MARGIN_TOP, marginBottom: PDF_NATIVE.MARGIN_BOTTOM });
      if (!_chunks.length) return y;
      var _endY = y, _prevPage = 0;
      for (var _c = 0; _c < _chunks.length; _c++) {
        var _ch = _chunks[_c];
        while (_prevPage < _ch.page) { pdf.addPage(); _prevPage++; }
        pdf.text(lines.slice(_ch.from, _ch.to), actualX, _ch.y, { align: align, baseline: 'top' });
        _endY = _ch.y + (_ch.to - _ch.from) * lineHeight;
      }
      return _endY + 0.5;
    },

    drawTitle: function (pdf, level, text, x, y, opts) {
      opts = opts || {};
      var maxWidth = opts.maxWidth || PDF_NATIVE.CONTENT_W;
      if (level === 1) {
        var newY1 = PDF_NATIVE.drawText(pdf, text, x, y + 4, { size: PDF_NATIVE.FONT_SIZE_H1, style: 'bold', color: PDF_NATIVE.COLOR_TITLE, align: 'center', maxWidth: maxWidth });
        return newY1 + 4;
      } else if (level === 2) {
        y += PDF_NATIVE.H2_GAP_BEFORE;
        var newY2 = PDF_NATIVE.drawText(pdf, String(text || '').toUpperCase(), x, y, { size: PDF_NATIVE.FONT_SIZE_H2, style: 'bold', color: PDF_NATIVE.COLOR_TITLE, maxWidth: maxWidth });
        pdf.setDrawColor(60, 60, 60); pdf.setLineWidth(0.4);
        pdf.line(x, newY2 + 0.5, x + maxWidth, newY2 + 0.5);
        return newY2 + PDF_NATIVE.H2_GAP_AFTER + 2;
      } else if (level === 3) {
        y += PDF_NATIVE.H3_GAP_BEFORE;
        var newY3 = PDF_NATIVE.drawText(pdf, text, x, y, { size: PDF_NATIVE.FONT_SIZE_H3, style: 'bold', color: PDF_NATIVE.COLOR_TITLE, maxWidth: maxWidth });
        return newY3 + PDF_NATIVE.H3_GAP_AFTER;
      }
      return y;
    },

    drawBrandzone: function (pdf, item, y) {
      item = item || {};
      var ratio = 1;
      if (item.logo) { try { var pr = pdf.getImageProperties(item.logo); if (pr && pr.height) ratio = pr.width / pr.height; } catch (e) {} }
      var m = brandzoneModel({ entLogo: item.logo, entNom: item.sciNom, logoRatio: ratio });
      var x = PDF_NATIVE.MARGIN_LEFT, right = PDF_NATIVE.PAGE_W - PDF_NATIVE.MARGIN_RIGHT;
      var bandH = m.logoH, topY = y;
      if (m.left.kind === 'logo') {
        try { pdf.addImage(item.logo, PDF_NATIVE.MARGIN_LEFT, topY, m.left.w, m.left.h); bandH = Math.max(bandH, m.left.h); }
        catch (e) { console.warn('[brandzone] logo bailleur illisible', e); }
      }
      var wordSize = m.propryo.wordSize * 2.83;
      pdf.setFont(PDF_NATIVE.FONT_FAMILY, 'bold'); pdf.setFontSize(wordSize);
      var wordW = pdf.getTextWidth(m.propryo.mot);
      var markSize = m.propryo.markSize, gap = markSize * 0.28;
      var markX = right - wordW - gap - markSize, markY = topY + (bandH - markSize) / 2;
      var ops = propryoMarkOps(markX, markY, markSize);
      for (var k = 0; k < ops.length; k++) {
        var o = ops[k];
        if (o.op === 'roundedRect') { pdf.setDrawColor(o.color[0], o.color[1], o.color[2]); pdf.setLineWidth(o.lineWidth); pdf.roundedRect(o.x, o.y, o.w, o.h, o.r, o.r, 'S'); }
        else { pdf.setFillColor(o.color[0], o.color[1], o.color[2]); pdf.circle(o.x, o.y, o.r, 'F'); }
      }
      pdf.setTextColor(16, 21, 33);
      pdf.text(m.propryo.mot, right, markY + markSize * 0.78, { align: 'right' });
      var ruleY = topY + bandH + 4;
      pdf.setDrawColor(228, 231, 238); pdf.setLineWidth(0.35);
      pdf.line(x, ruleY, right, ruleY);
      pdf.setTextColor(PDF_NATIVE.COLOR_TEXT[0], PDF_NATIVE.COLOR_TEXT[1], PDF_NATIVE.COLOR_TEXT[2]);
      return ruleY + 7;
    },

    drawTable: function (pdf, headers, rows, startY, opts) {
      opts = opts || {};
      var conf = {
        body: rows, startY: startY,
        margin: { top: PDF_NATIVE.MARGIN_TOP, left: PDF_NATIVE.MARGIN_LEFT, right: PDF_NATIVE.MARGIN_RIGHT, bottom: PDF_NATIVE.MARGIN_BOTTOM },
        styles: { font: PDF_NATIVE.FONT_FAMILY, fontSize: PDF_NATIVE.FONT_SIZE_BODY - 0.5, cellPadding: 1.5, textColor: PDF_NATIVE.COLOR_TEXT, lineColor: PDF_NATIVE.COLOR_BORDER, lineWidth: 0.1 },
        headStyles: { fillColor: PDF_NATIVE.COLOR_TABLE_HEADER_BG, textColor: PDF_NATIVE.COLOR_TITLE, fontStyle: 'bold' }
      };
      if (headers) conf.head = [headers];
      if (opts.columnStyles) conf.columnStyles = opts.columnStyles;
      if (opts.styles) Object.assign(conf.styles, opts.styles);
      pdf.autoTable(conf);
      return pdf.lastAutoTable.finalY + 2;
    },

    newPageIfNeeded: function (pdf, currentY, neededSpace) {
      if (currentY + (neededSpace || 10) > PDF_NATIVE.PAGE_H - PDF_NATIVE.MARGIN_BOTTOM) {
        pdf.addPage(); return PDF_NATIVE.MARGIN_TOP;
      }
      return currentY;
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // 5. Rendu natif d'un document parsé
  // ────────────────────────────────────────────────────────────────────────────

  /** Extrait le src d'une <img> (signature bailleur posée en image, comme l'EDL). */
  function _imgSrc(html) {
    var m = String(html || '').match(/<img[^>]*\bsrc="([^"]*)"/i);
    return m ? m[1] : '';
  }

  /**
   * Mention posée AU-DESSUS de la signature (avenant, décision 30/09) : « Lu et approuvé » une fois signé
   * (comme drawSignatureBlock pour le bail), ou la consigne « Précéder la signature de la mention
   * manuscrite… » sur le document à imprimer (`pro-sigconsigne` : un espace plus haut pour écrire à la main).
   * Recherche de chaînes (pas d'expression régulière) : le document peut venir du partage SCI.
   * @returns {{t:string, consigne:boolean}|null}
   */
  // Témoin lu par la signature d'un avenant : ce moteur trace la mention au-dessus de la signature. Un
  // moteur plus ancien (cache) l'ignorerait ; l'app refuse alors de produire un PDF signé (échec fermé).
  const SIG_MENTION_SUPPORT = true;
  function _sigMention(html) {
    const s = String(html || '');
    const o = s.indexOf('<em class="pro-sigmention');
    if (o < 0) return null;
    const g = s.indexOf('>', o);
    const f = g < 0 ? -1 : s.indexOf('</em>', g);
    if (f < 0) return null;
    const t = htmlToText(s.slice(g + 1, f));
    return t ? { t, consigne: s.slice(o, g).indexOf('pro-sigconsigne') >= 0 } : null;
  }

  /**
   * Rejoue un document parsé (parseDocDoc) en texte natif. Le bandeau est tracé en vectoriel
   * depuis `ent` ; les signatures bailleur restent des images posées par addImage (comme l'EDL).
   * @param {object} pdf   instance jsPDF déjà blindée (MontantDoc.hardenJsPdfText)
   * @param {object} ent   entité bailleur (logo, nom)
   * @param {object} parsed sortie de parseDocDoc
   * @param {object} PN    PDF_NATIVE (injectable pour test)
   * @param {object} [opts]
   *   @param {boolean} [opts.pagination] pied (réf., date, « Page p / N ») sur CHAQUE page — sinon
   *     pied sur la dernière page seulement, sans numéro (aspect historique des quittances).
   *   @param {string[]} [opts.paraphes] libellés des cases de paraphe posées en bas de chaque page
   *     sauf la dernière, seulement si le document fait plus d'une page.
   */
  function renderDocToPdf(pdf, ent, parsed, PN, opts) {
    PN = PN || PDF_NATIVE;
    opts = opts || {};
    const x = PN.MARGIN_LEFT, right = PN.PAGE_W - PN.MARGIN_RIGHT, W = PN.CONTENT_W;
    const bodyBottom = PN.PAGE_H - PN.MARGIN_BOTTOM;
    let y = PN.MARGIN_TOP;
    try { y = PN.drawBrandzone(pdf, { logo: ent && ent.logo, sciNom: (ent && ent.nom) || '' }, y); } catch (e) { y = PN.MARGIN_TOP + 8; }
    if (parsed.titre) y = PN.drawTitle(pdf, 1, parsed.titre, x, y);
    if (parsed.ctx) y = PN.drawText(pdf, parsed.ctx, x, y, { size: PN.FONT_SIZE_NOTE, color: PN.COLOR_MUTED }) + 2;

    // ── Mesures (mêmes tailles et polices que le tracé) : AVENANT-REFONTE §7 D1/D6. Avant, on
    // réservait une hauteur forfaitaire (24 mm pour un cadre qui en prend ~31) : le cadre était
    // coupé en bas de page, sa ligne sur une page et le nom du signataire sur la suivante.
    const textH = (t, size, w, style) => {
      pdf.setFont(PN.FONT_FAMILY, style || 'normal'); pdf.setFontSize(size);
      return pdf.splitTextToSize(String(t || ''), w).length * size * 0.4 + 0.5;
    };
    const SIG_MAX_COLS = 3, SIG_GAP = 6, SIG_TOP = 8, SIG_SPACE = 11, SIG_UNDER = 2;
    const sigGeom = (n) => {
      const cols = Math.max(1, Math.min(n, SIG_MAX_COLS));
      const bw = cols === 1 ? 70 : Math.min(70, (W - SIG_GAP * (cols - 1)) / cols);
      return { cols, bw, step: cols === 1 ? 0 : (W - bw * cols) / (cols - 1) + bw };
    };
    const sigRows = (boxes) => {
      const g = sigGeom((boxes || []).length);
      const rows = [];
      for (let i = 0; i < (boxes || []).length; i += g.cols) rows.push(boxes.slice(i, i + g.cols));
      return { g, rows };
    };
    // Mention au-dessus de la signature (« Lu et approuvé » / consigne papier) : hauteur de la plus haute
    // de la rangée, posée dans le blanc au-dessus du cadre (3 mm gardés au-dessus d'elle) : une rangée sans
    // mention garde exactement sa hauteur (quittances, reçus…) ; une consigne papier ouvre un espace plus
    // haut (mention manuscrite + signature).
    const SIG_SPACE_PAPIER = 18, SIG_MENTION_GAP = 1, SIG_MENTION_TOP = 3;
    const sigMentionSize = (m) => (m.consigne ? PN.FONT_SIZE_SMALL : PN.FONT_SIZE_NOTE);
    const sigMentionH = (row, bw) => Math.max(0, ...row.map(bx => {
      const m = _sigMention(bx.sig);
      return m ? textH(m.t, sigMentionSize(m), bw, 'italic') + SIG_MENTION_GAP : 0;
    }));
    const sigSpace = (row) => (row.some(bx => { const m = _sigMention(bx.sig); return m && m.consigne && !_imgSrc(bx.sig); }) ? SIG_SPACE_PAPIER : SIG_SPACE);
    const sigTopH = (row, bw) => Math.max(SIG_TOP, SIG_MENTION_TOP + sigMentionH(row, bw));
    const sigRowH = (row, bw) => sigTopH(row, bw) + sigSpace(row) + SIG_UNDER
      + Math.max.apply(null, row.map(bx => textH(htmlToText(bx.label), PN.FONT_SIZE_SMALL, bw)));
    const h3H = (b) => PN.H3_GAP_BEFORE + textH(htmlToText(b.v), PN.FONT_SIZE_H3, W, 'bold') + PN.H3_GAP_AFTER;
    const blockH = (b) => {
      if (b.t === 'h3') return h3H(b);
      if (b.t === 'lieu') return 8 + textH(htmlToText(b.v), PN.FONT_SIZE_BODY, W) + PN.PARAGRAPH_GAP;
      if (b.t === 'signzone') {
        const { g, rows } = sigRows(b.boxes);
        return rows.reduce((s, r) => s + sigRowH(r, g.bw), 0) + PN.PARAGRAPH_GAP;
      }
      if (b.t === 'mention') return textH(htmlToText(b.v), PN.FONT_SIZE_NOTE, W) + PN.PARAGRAPH_GAP;
      return textH(htmlToText(b.v), PN.FONT_SIZE_BODY, W) + PN.PARAGRAPH_GAP;
    };
    const usable = bodyBottom - PN.MARGIN_TOP;

    const blocks = (parsed.blocks || []).filter(b => b && !b.screenOnly);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      // Garder ensemble « Fait à… », le titre « Signatures » et les cadres (D6) : on mesure la
      // séquence qui mène aux cadres et on change de page UNE fois si elle ne tient pas.
      // La mesure S'ARRÊTE à la zone de signature (audit : une mention longue après le cadre poussait
      // « Fait à » et le cadre sur des pages différentes) et ne compte pas le blanc posé APRÈS le
      // cadre, qui n'a pas à tenir dans la page (audit : page en plus sur quittance / IRL / reçu).
      if (b.t === 'lieu' || b.t === 'h3' || b.t === 'signzone') {
        let j = i, h = 0, withSig = false;
        while (j < blocks.length && !withSig && ['lieu', 'h3', 'signzone'].indexOf(blocks[j].t) >= 0) {
          h += blockH(blocks[j]); if (blocks[j].t === 'signzone') withSig = true; j++;
        }
        if (withSig) y = PN.newPageIfNeeded(pdf, y, Math.min(h - PN.PARAGRAPH_GAP, usable));
      }
      // Un titre d'article ne reste jamais seul en bas de page : il part avec le début de son texte
      // (ou avec la hauteur minimale d'un tableau, 40 mm, si c'est un tableau qui suit).
      if (b.t === 'h3') {
        const suite = blocks[i + 1] && blocks[i + 1].t === 'tbl' ? 40 : 12;
        y = PN.newPageIfNeeded(pdf, y, Math.min(h3H(b) + suite, usable));
      }
      y = PN.newPageIfNeeded(pdf, y, b.t === 'tbl' ? 40 : 14);
      switch (b.t) {
        case 'h3':
          y = PN.drawTitle(pdf, 3, htmlToText(b.v), x, y, { maxWidth: W });
          break;
        case 'kv': {
          const kW = W * 0.44, pad = 2;
          for (const r of (b.rows || [])) {
            const k = htmlToText(r[0]), v = htmlToText(r[1]);
            const rh = Math.max(textH(k, PN.FONT_SIZE_NOTE, kW - 2 * pad, 'bold'), textH(v, PN.FONT_SIZE_NOTE, W - kW - 2 * pad)) + 2 * pad;
            y = PN.newPageIfNeeded(pdf, y, rh);
            try { pdf.setFillColor(247, 248, 251); pdf.rect(x, y, kW, rh, 'F'); } catch (e) {}
            PN.drawText(pdf, k, x + pad, y + pad, { size: PN.FONT_SIZE_NOTE, style: 'bold', color: PN.COLOR_TITLE, maxWidth: kW - 2 * pad });
            PN.drawText(pdf, v, x + kW + pad, y + pad, { size: PN.FONT_SIZE_NOTE, maxWidth: W - kW - 2 * pad });
            try { pdf.setDrawColor(228, 231, 238); pdf.setLineWidth(0.2); pdf.line(x, y + rh, x + W, y + rh); } catch (e) {}
            y += rh;
          }
          y += PN.PARAGRAPH_GAP + 2;
          break;
        }
        case 'parties': {
          // Retour Didier : les parties doivent être CÔTE À CÔTE dans des cartouches gris, comme à
          // l'écran (.pro-parties{display:flex} / .pro-partie{background:#f7f8fb}) — plus empilées.
          const blocs = (b.blocs || []).filter(Boolean);
          const nCol = blocs.length || 1;
          const gapC = 4, pad = 3.4;   // plus d'air dans les cartouches (retour Didier : « tout serré »)
          const colW = (W - gapC * (nCol - 1)) / nCol;
          // Mesurer chaque colonne (mêmes tailles/police que le tracé) → fonds alignés sur la plus haute.
          const measure = (p) => {
            const w = colW - 2 * pad;
            let h = pad;
            pdf.setFont(PN.FONT_FAMILY, 'normal'); pdf.setFontSize(PN.FONT_SIZE_SMALL);
            h += pdf.splitTextToSize(htmlToText(p.label).toUpperCase(), w).length * (PN.FONT_SIZE_SMALL * 0.4) + 1;
            if (p.qui) { pdf.setFontSize(9.5); h += pdf.splitTextToSize(htmlToText(p.qui), w).length * (9.5 * 0.4) + 0.5; }
            const c = htmlToText(p.corps);
            if (c) { pdf.setFontSize(PN.FONT_SIZE_SMALL); h += pdf.splitTextToSize(c, w).length * (PN.FONT_SIZE_SMALL * 0.4); }
            return h + pad;
          };
          const boxH = blocs.length ? Math.max.apply(null, blocs.map(measure)) : 0;
          y = PN.newPageIfNeeded(pdf, y, boxH + 2);
          const yTop = y;
          blocs.forEach((p, i) => {
            const cx = x + i * (colW + gapC);
            try { pdf.setFillColor(247, 248, 251); pdf.roundedRect(cx, yTop, colW, boxH, 1.5, 1.5, 'F'); } catch (e) {}
            let cy = yTop + pad;
            cy = PN.drawText(pdf, htmlToText(p.label).toUpperCase(), cx + pad, cy, { size: PN.FONT_SIZE_SMALL, color: PN.COLOR_MUTED, maxWidth: colW - 2 * pad }) + 0.5;
            if (p.qui) cy = PN.drawText(pdf, htmlToText(p.qui), cx + pad, cy, { size: 9.5, style: 'bold', color: PN.COLOR_TITLE, maxWidth: colW - 2 * pad });
            const corps = htmlToText(p.corps);
            if (corps) PN.drawText(pdf, corps, cx + pad, cy, { size: PN.FONT_SIZE_SMALL, maxWidth: colW - 2 * pad });
          });
          y = yTop + boxH + PN.PARAGRAPH_GAP + 4;   // plus d'air après les parties
          break;
        }
        case 'acte':
          // La phrase d'acte (« Je soussigné… ») respire : un peu d'air avant et après.
          y += 2;
          y = PN.drawText(pdf, htmlToText(b.v), x, y) + PN.PARAGRAPH_GAP + 2;
          break;
        case 'para':
          y = PN.drawText(pdf, htmlToText(b.v), x, y) + PN.PARAGRAPH_GAP;
          break;
        case 'lignes': {
          const valW = 46;
          for (const r of (b.rows || [])) {
            y = PN.newPageIfNeeded(pdf, y, 8);
            const style = r.tot ? 'bold' : 'normal';
            const color = r.hi ? [255, 90, 60] : (r.tot ? PN.COLOR_TITLE : PN.COLOR_TEXT);
            const yLab = PN.drawText(pdf, htmlToText(r.lab), x, y, { style: style, maxWidth: W - valW - 4 });
            PN.drawText(pdf, htmlToText(r.val), right - valW, y, { style: style, color: color, align: 'right', maxWidth: valW });
            y = yLab + 1.2;   // lignes du décompte un peu plus aérées
          }
          y += PN.PARAGRAPH_GAP + 3;
          break;
        }
        case 'tbl': {
          const rows = (b.rows || []).map(r => r.map(htmlToText));
          if (b.foot) rows.push(b.foot.map(htmlToText));
          const head = b.head ? b.head.map(htmlToText) : null;
          const nCol = head ? head.length : (rows[0] ? rows[0].length : 1);
          const colStyles = {}; if (nCol > 1) colStyles[nCol - 1] = { halign: 'right' };
          y = PN.drawTable(pdf, head, rows, y, { columnStyles: colStyles }) + PN.PARAGRAPH_GAP;
          break;
        }
        case 'mention':
        case 'encart':
          y = PN.drawText(pdf, htmlToText(b.v), x, y, { size: PN.FONT_SIZE_NOTE, color: PN.COLOR_MUTED }) + PN.PARAGRAPH_GAP;
          break;
        case 'lieu':
          y += 8;   // « Fait à… » nettement détaché du corps
          y = PN.drawText(pdf, htmlToText(b.v), x, y) + PN.PARAGRAPH_GAP;
          break;
        case 'signzone': {
          // D1-D3 : une RANGÉE de cadres (3 au plus, 58-70 mm) est mesurée puis posée entière sur
          // une seule page. Avant : cadres par 70 mm fixes, hauteur réservée trop courte, ligne et
          // image non paginées → cadre coupé, nom du signataire seul en haut de la page suivante.
          const { g, rows } = sigRows(b.boxes);
          for (const row of rows) {
            y = PN.newPageIfNeeded(pdf, y, Math.min(sigRowH(row, g.bw), usable));
            const yTop = y + sigTopH(row, g.bw);                // haut de l'espace de signature
            const yMention = yTop - sigMentionH(row, g.bw);     // mention juste au-dessus
            const space = sigSpace(row);
            let bx = row.length === 1 && g.cols === 1 ? right - g.bw : x;
            for (const box of row) {
              const src = _imgSrc(box.sig);
              const mention = _sigMention(box.sig);
              if (mention) PN.drawText(pdf, mention.t, bx, yMention, { size: sigMentionSize(mention), style: 'italic', color: [60, 60, 60], maxWidth: g.bw });
              // Signature : ratio PRÉSERVÉ (avant : forcée à 58×10 mm → déformée). Ajustée dans une
              // boîte max 58×11 mm, calée sur la ligne — comme à l'écran.
              if (src) {
                try {
                  let maxWsig = Math.min(g.bw, 58), maxHsig = SIG_SPACE, ratioSig = 1;
                  try { const prSig = pdf.getImageProperties(src); if (prSig && prSig.width && prSig.height) ratioSig = prSig.width / prSig.height; } catch (e) {}
                  let iw = maxWsig, ih = iw / ratioSig;
                  if (ih > maxHsig) { ih = maxHsig; iw = ih * ratioSig; }
                  pdf.addImage(src, 'PNG', bx, yTop + (maxHsig - ih), iw, ih);
                } catch (e) {}
              }
              pdf.setDrawColor(120, 120, 120); pdf.setLineWidth(0.2);
              pdf.line(bx, yTop + space, bx + g.bw, yTop + space);
              PN.drawText(pdf, htmlToText(box.label), bx, yTop + space + SIG_UNDER, { size: PN.FONT_SIZE_SMALL, color: PN.COLOR_MUTED, maxWidth: g.bw });
              bx += g.step;
            }
            y = y + sigRowH(row, g.bw);
          }
          y += PN.PARAGRAPH_GAP;
          break;
        }
        default:
          y = PN.drawText(pdf, htmlToText(b.v), x, y) + PN.PARAGRAPH_GAP;
      }
    }

    // Pied EN BAS DE PAGE, dans la marge basse. D4 : le contenu ne descend jamais sous `bodyBottom`
    // (drawText pagine avant) : le pied a toujours sa place, on ne crée PLUS de page pour lui seul.
    const nPages = typeof pdf.getNumberOfPages === 'function' ? pdf.getNumberOfPages() : 1;
    const paraphes = (opts.paraphes || []).filter(Boolean);
    const avecParaphes = paraphes.length > 0 && nPages > 1;
    const drawFoot = (p) => {
      const surParaphe = avecParaphes && p < nPages;
      const footY = bodyBottom + (surParaphe ? 5.5 : 8);
      const pageLbl = opts.pagination ? 'Page ' + p + ' / ' + nPages : '';
      if (parsed.ref || parsed.date || pageLbl) {
        try { pdf.setDrawColor(228, 231, 238); pdf.setLineWidth(0.2); const fl = surParaphe ? 3 : 4; pdf.line(x, footY - fl, x + W, footY - fl); } catch (e) {}
        // pdf.text DIRECT (pas PN.drawText) : le pied vit dans la marge basse, SOUS la zone de contenu.
        // PN.drawText refuserait d'y écrire (sa pagination le renverrait sur une page en trop).
        pdf.setFont(PN.FONT_FAMILY, 'normal'); pdf.setFontSize(PN.FONT_SIZE_SMALL);
        pdf.setTextColor(PN.COLOR_MUTED[0], PN.COLOR_MUTED[1], PN.COLOR_MUTED[2]);
        if (parsed.ref) pdf.text(String(parsed.ref), x, footY, { baseline: 'top' });
        if (pageLbl) pdf.text(pageLbl, x + W / 2, footY, { align: 'center', baseline: 'top' });
        if (parsed.date) pdf.text(String(parsed.date), x + W, footY, { align: 'right', baseline: 'top' });
      }
      // Cases de paraphe (acte de plusieurs pages) : une par partie, en bas à droite, sauf sur la
      // dernière page qui porte les signatures.
      if (surParaphe) {
        // Largeur adaptée au nombre de parties : tout tient entre la marge gauche (+ « Paraphes ») et la droite.
        const cg = 3, ch = 8, cw = Math.min(16, (W - 22 - (paraphes.length - 1) * cg) / paraphes.length);
        let cx = right - paraphes.length * cw - (paraphes.length - 1) * cg;
        const cy = PN.PAGE_H - 13.5;
        pdf.setFontSize(6); pdf.setTextColor(PN.COLOR_MUTED[0], PN.COLOR_MUTED[1], PN.COLOR_MUTED[2]);
        pdf.text('Paraphes', cx - 2, cy + ch / 2, { align: 'right', baseline: 'middle' });
        for (const lbl of paraphes) {
          try { pdf.setDrawColor(180, 180, 180); pdf.setLineWidth(0.2); pdf.rect(cx, cy, cw, ch, 'S'); } catch (e) {}
          pdf.text(String(lbl), cx + cw / 2, cy + ch + 1, { align: 'center', baseline: 'top' });
          cx += cw + cg;
        }
      }
    };
    if ((opts.pagination || avecParaphes) && typeof pdf.setPage === 'function') {
      for (let p = 1; p <= nPages; p++) { pdf.setPage(p); drawFoot(p); }
    } else {
      drawFoot(nPages);
    }
    return pdf;
  }

  /**
   * Point d'entrée : HTML `.pro-doc` (sortie d'un `_buildXHtml`) → Blob PDF natif.
   * @param {Function} JsPdfCls classe jsPDF
   * @param {object} ent  entité bailleur
   * @param {string} html HTML du document (gabarit)
   * @param {object} [opts] { hardenText }
   * @returns {Blob}
   */
  function docHtmlToPdfBlob(JsPdfCls, ent, html, opts) {
    opts = opts || {};
    const pdf = new JsPdfCls({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    if (opts.hardenText) opts.hardenText(pdf);
    const parsed = parseDocDoc(html);
    renderDocToPdf(pdf, ent, parsed, PDF_NATIVE);
    return pdf.output('blob');
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.DocNative = {
    htmlToText: htmlToText,
    htmlToWords: htmlToWords,
    splitTopLevelBlocks: splitTopLevelBlocks,
    classifyBlock: classifyBlock,
    parseDocDoc: parseDocDoc,
    docWords: docWords,
    PDF_NATIVE: PDF_NATIVE,
    renderDocToPdf: renderDocToPdf,
    docHtmlToPdfBlob: docHtmlToPdfBlob,
    SIG_MENTION_SUPPORT: SIG_MENTION_SUPPORT
  };
})(typeof window !== 'undefined' ? window : globalThis);
