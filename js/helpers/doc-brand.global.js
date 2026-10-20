/**
 * doc-brand.global.js — Wrapper browser (window.DocBrand)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/doc-brand.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // __tests__/helpers/doc-brand.js
  // S4 — bandeau d'identité, commun à TOUS les documents émis (bail, quittance, lettre IRL,
  // décompte de charges, EDL, acte de cautionnement, certificat de preuve).
  // PUR : aucune dépendance DOM/jsPDF. Sérialisé tel quel (toString) dans la popup de signature.
  //
  // SOURCE — rien n'est inventé ici :
  //   • Gabarit : mockups/DOCUMENTS-PROPRYO (variante B validée par Didier le 12/08) —
  //     émetteur à gauche, Propryo à droite, MÊME hauteur pilotée par une seule variable,
  //     filet fin dessous. Sans logo bailleur, la gauche reste VIDE et le bandeau se resserre
  //     (consigne 17/08 — le repli « le nom prend la place » a été rejeté à l'usage).
  //   • Logo : piste 01 « Le point », tracé repris à l'identique de
  //     mockups/SIGNATURE-PAGE-LOCATAIRE/sign-propryo.css (déjà en prod, page locataire du relais).
  //
  // En PDF, le tracé est rejoué en VECTORIEL (roundedRect + circle) plutôt que rastérisé :
  // net à tout zoom, aucun canvas ni police en jeu, et la géométrie reste testable.

  /** Cotes du bandeau, reprises du gabarit (mm). */
  const BRAND = {
    LOGO_H: 13,        // hauteur du logo bailleur  (--logo-h du gabarit)
    NOM_H: 5.3,        // hauteur du bandeau quand il n'y a pas de logo (le lockup Propryo seul)
    LOGO_MAX_W: 62,    // largeur maximale du logo bailleur
    RULE_GAP: 2.5,     // espace sous le bandeau avant le filet — 4 mm au mockup, resserre pour
                       // que les documents courants tiennent sur UNE page (regression 17/08)
    BOTTOM_GAP: 4,     // espace sous le filet avant le contenu — 7 mm au mockup, meme raison
    WORD_RATIO: 0.58   // taille du mot « Propryo » = 0,58 × hauteur du logo
  };

  /** Le tracé retenu, en coordonnées du viewBox 32×32 d'origine. */
  const PROPRYO_MARK = {
    viewBox: 32,
    rect: { x: 3.5, y: 3.5, w: 25, h: 25, r: 7.5, stroke: 3 },
    dot: { cx: 21, cy: 21, r: 4.2 },
    color: [255, 90, 60]                       // #ff5a3c — corail de la charte
  };

  /** Le même tracé en SVG, pour les documents HTML et l'app. */
  const PROPRYO_MARK_SVG =
    '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">'
    + '<rect x="3.5" y="3.5" width="25" height="25" rx="7.5" fill="none" stroke="#ff5a3c" stroke-width="3"/>'
    + '<circle cx="21" cy="21" r="4.2" fill="#ff5a3c"/></svg>';

  /**
   * Le tracé mis à l'échelle pour jsPDF, en mm, à poser en (x, y) dans un carré de `size`.
   * @returns {Array<{op:'roundedRect'|'circle', ...}>} opérations à rejouer telles quelles.
   */
  function propryoMarkOps(x, y, size) {
    if (!(size > 0)) return [];
    var s = size / PROPRYO_MARK.viewBox;
    var R = PROPRYO_MARK.rect, D = PROPRYO_MARK.dot, C = PROPRYO_MARK.color;
    return [
      { op: 'roundedRect', x: x + R.x * s, y: y + R.y * s, w: R.w * s, h: R.h * s, r: R.r * s, lineWidth: R.stroke * s, color: C },
      { op: 'circle', x: x + D.cx * s, y: y + D.cy * s, r: D.r * s, color: C }
    ];
  }

  /**
   * Le pavé du logo en chemin SVG, dans le repère du viewBox 32×32.
   * pdf-lib n'a pas de rectangle à coins arrondis (drawRectangle est à angles droits) : sans ce
   * chemin, le logo du certificat de preuve sortait CARRÉ alors qu'il est très arrondi (r = 7,5).
   * Consommé par page.drawSvgPath ; jsPDF, lui, a roundedRect et utilise propryoMarkOps.
   */
  function propryoRectSvgPath() {
    var R = PROPRYO_MARK.rect;
    var x0 = R.x, y0 = R.y, x1 = R.x + R.w, y1 = R.y + R.h, r = R.r;
    return 'M ' + (x0 + r) + ' ' + y0
      + ' H ' + (x1 - r) + ' A ' + r + ' ' + r + ' 0 0 1 ' + x1 + ' ' + (y0 + r)
      + ' V ' + (y1 - r) + ' A ' + r + ' ' + r + ' 0 0 1 ' + (x1 - r) + ' ' + y1
      + ' H ' + (x0 + r) + ' A ' + r + ' ' + r + ' 0 0 1 ' + x0 + ' ' + (y1 - r)
      + ' V ' + (y0 + r) + ' A ' + r + ' ' + r + ' 0 0 1 ' + (x0 + r) + ' ' + y0 + ' Z';
  }

  /** Largeur approchée du lockup « ▢ Propryo » en mm (marque + espace + mot). */
  function propryoLockupWidth(markSize, wordWidthMm) {
    return markSize + markSize * 0.28 + (wordWidthMm || markSize * 2.6);
  }

  /**
   * Modèle du bandeau.
   *
   * RÈGLE (consigne Didier, reformulée le 17/08) : « le document doit pouvoir avoir le logo du
   * bailleur ; si pas de logo, VIDE ». Donc logo présent → le logo ; logo absent → RIEN à gauche,
   * ni son nom, ni placeholder, ni cadre. Le lockup Propryo, lui, reste dans les deux cas.
   *
   * Une première version posait le NOM du bailleur en repli : rejeté à l'usage. L'identité du
   * bailleur n'est pas perdue pour autant — elle est portée par le CORPS de chaque document
   * (bloc « Le(s) Bailleur(s) » de la quittance, blocs Bailleur de l'IRL et du décompte, § I de
   * l'acte, ligne « Bailleur » de l'EDL, table d'identification du bail, ligne « Bailleur » du
   * certificat de preuve). C'est là qu'elle a sa valeur juridique, pas dans un bandeau.
   *
   * @param {{entLogo?:string, entNom?:string, logoRatio?:number}} input
   *        logoRatio = largeur/hauteur de l'image du bailleur (1 si inconnu).
   */
  function brandzoneModel(input) {
    var o = input || {};
    var nom = String(o.entNom == null ? '' : o.entNom).trim();
    var logo = String(o.entLogo == null ? '' : o.entLogo).trim();
    if (logo) {
      var ratio = o.logoRatio > 0 ? o.logoRatio : 1;
      var h = BRAND.LOGO_H, w = h * ratio;
      if (w > BRAND.LOGO_MAX_W) { w = BRAND.LOGO_MAX_W; h = w / ratio; }   // bridé sans déformation
      return {
        logoH: BRAND.LOGO_H,
        left: { kind: 'logo', src: logo, w: w, h: h, alt: nom || 'Logo du bailleur' },
        propryo: { mot: 'Propryo', markSize: BRAND.LOGO_H, wordSize: BRAND.LOGO_H * BRAND.WORD_RATIO }
      };
    }
    // Pas de logo : la gauche reste VIDE et le bandeau se resserre sur la hauteur du lockup.
    return {
      logoH: BRAND.NOM_H,
      left: { kind: 'vide', h: BRAND.NOM_H },
      propryo: { mot: 'Propryo', markSize: BRAND.NOM_H, wordSize: BRAND.NOM_H * BRAND.WORD_RATIO }
    };
  }

  function escBrand(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Bandeau prêt à insérer en tête d'un document HTML (quittance, IRL, décompte, cautionnement). */
  function brandzoneHtml(model) {
    var m = model || brandzoneModel({});
    // Sans logo : RIEN à gauche (cf. brandzoneModel). Pas de <span> vide non plus, sinon le
    // `gap` du flex laisserait un décrochage visible avant le lockup Propryo.
    var left = m.left.kind === 'logo'
      ? '<img src="' + escBrand(m.left.src) + '" alt="' + escBrand(m.left.alt) + '" style="height:'
        + m.left.h + 'mm;width:auto;max-width:' + BRAND.LOGO_MAX_W + 'mm;object-fit:contain;display:block">'
      : '';
    return '<div style="display:flex;align-items:center;gap:8mm;padding-bottom:' + BRAND.RULE_GAP
      + 'mm;margin-bottom:' + BRAND.BOTTOM_GAP + 'mm;border-bottom:.35mm solid #e4e7ee">'
      + left
      + '<span style="margin-left:auto;display:flex;align-items:center;gap:.28em;font-size:' + m.logoH + 'mm">'
      // le SVG doit remplir EXACTEMENT le carré de 1em, sinon le lockup dépasse la hauteur
      // du logo bailleur et les deux marques ne se répondent plus (vérifié au navigateur).
      + '<span style="width:1em;height:1em;display:block;flex:none;line-height:0">'
      + PROPRYO_MARK_SVG.replace('<svg ', '<svg style="width:100%;height:100%;display:block" ') + '</span>'
      + '<span style="font:800 ' + BRAND.WORD_RATIO + 'em/1 \'Schibsted Grotesk\',system-ui,sans-serif;color:#101521;letter-spacing:-.02em">Propryo</span>'
      + '</span></div>';
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.DocBrand = {
    BRAND: BRAND,
    PROPRYO_MARK: PROPRYO_MARK,
    PROPRYO_MARK_SVG: PROPRYO_MARK_SVG,
    propryoMarkOps: propryoMarkOps,
    propryoRectSvgPath: propryoRectSvgPath,
    propryoLockupWidth: propryoLockupWidth,
    brandzoneModel: brandzoneModel,
    brandzoneHtml: brandzoneHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
