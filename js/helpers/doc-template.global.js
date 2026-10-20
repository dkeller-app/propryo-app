/**
 * doc-template.global.js — Wrapper browser (window.DocTemplate)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    __tests__/helpers/doc-template.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // __tests__/helpers/doc-template.js
  // DOCS-UNIFIES — gabarit unique des documents émis (variante B, validée par Didier le 12/08).
  //
  // SOURCE — rien n'est inventé ici : mockups/DOCUMENTS-PROPRYO/index.html, sélecteur
  // « Gabarit → B — sans ✓ validée ». Les règles ci-dessous sont la transposition littérale
  // des sélecteurs `.g-p` + `.g-sans` du mockup (mêmes valeurs, mêmes unités mm/pt, mêmes
  // couleurs). Le bandeau d'identité, lui, reste chez DocBrand (module S4) : ce module ne le
  // redessine pas, il le REÇOIT et le pose en tête.
  //
  // PÉRIMÈTRE STRICT : la FORME. Aucun texte juridique, aucune mention, aucun article de loi,
  // aucun montant ne transite par ce module autrement que comme fragment déjà construit par
  // l'appelant. « Le fond — textes, mentions, articles de loi — est copié du code tel qu'il
  // est validé » (mockup, en-tête).
  //
  // CONVENTION D'ÉCHAPPEMENT : toutes les entrées sont des FRAGMENTS HTML déjà échappés par
  // l'appelant (les générateurs de documents appellent escHtml/fmt en amont, comme avant).
  // Ce module ne ré-échappe rien — sinon les `<b>`, `<br>` et `&nbsp;` du fond seraient
  // affichés en clair, ce qui abîmerait le texte légal.
  //
  // PUR : aucune dépendance DOM. Testable, sérialisable.

  /** Cotes et couleurs du gabarit, reprises telles quelles du mockup (variante B). */
  const DOC_TPL = Object.freeze({
    ENCRE: '#1a2030',        // .g-p       — couleur du corps
    ENCRE_FORTE: '#101521',  // titres, totaux
    GRIS: '#6e7888',         // .ctx       — ligne de contexte
    GRIS_LABEL: '#8b94a5',   // h2         — étiquettes de bloc
    GRIS_MENTION: '#7c8698', // .mention
    GRIS_PIED: '#9aa3b2',    // .pied
    FILET: '#e4e7ee',        // filets
    FOND_BLOC: '#f7f8fb',    // .partie / .lignes
    ACCENT: '#ff5a3c',       // corail de la charte — .acte, .lg.hi
    CORPS_PT: 10,            // .g-sans font-size
    CORPS_LH: 1.55,          // .g-sans line-height
    TITRE_PT: 17             // .g-p h1 — 21 pt au mockup, ramene a 17 pour tenir sur 1 page
  });

  /**
   * Piles de polices. Aucune police n'est chargée depuis un CDN (règle « aucun CDN externe au
   * runtime ») : les documents retombent proprement sur la pile système si Schibsted Grotesk
   * et Inter ne sont pas installées.
   */
  const DOC_FONT_TITRE = '"Schibsted Grotesk","Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const DOC_FONT_CORPS = '"Inter",system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';

  /**
   * La feuille de style du gabarit, entièrement scopée sous `.pro-doc`.
   * Scopée parce que trois documents sur quatre sont injectés par innerHTML DANS la page de
   * l'app (modale d'aperçu IRL, modale décompte) : une règle nue sur `body`/`h1` repeindrait
   * l'application elle-même — c'est exactement ce que faisait le CSS Times de la quittance
   * avant qu'on l'isole dans une iframe (v15.104).
   */
  function docCss() {
    const T = DOC_TPL;
    return `
  .pro-doc{color:${T.ENCRE};font-family:${DOC_FONT_CORPS};font-size:${T.CORPS_PT}pt;line-height:${T.CORPS_LH};background:#fff}
  .pro-doc *{box-sizing:border-box}
  .pro-doc p{margin:0 0 1.6mm}
  .pro-doc .pro-titre{margin:0 0 3mm}
  .pro-doc .pro-titre h1{font:800 ${T.TITRE_PT}pt/1.08 ${DOC_FONT_TITRE};margin:0 0 1mm;letter-spacing:-.025em;color:${T.ENCRE_FORTE};text-decoration:none;text-align:left}
  .pro-doc .pro-ctx{font:400 9pt/1.25 ${DOC_FONT_CORPS};color:${T.GRIS};margin:0}
  .pro-doc .pro-parties{display:flex;gap:4mm;margin:0 0 4mm}
  .pro-doc .pro-partie{flex:1;background:${T.FOND_BLOC};border-radius:2.5mm;padding:2.8mm 3.4mm}
  .pro-doc .pro-partie h2{font:600 7.5pt/1 ${DOC_FONT_CORPS};letter-spacing:.13em;text-transform:uppercase;color:${T.GRIS_LABEL};margin:0 0 1.4mm;text-decoration:none}
  .pro-doc .pro-partie p{margin:0 0 1mm;font-size:8.5pt;line-height:1.35}
  .pro-doc .pro-partie p:last-child{margin-bottom:0}
  .pro-doc .pro-qui{font-weight:700;color:${T.ENCRE_FORTE};font-size:9.5pt;display:block;margin-bottom:.8mm}
  .pro-doc .pro-acte{border-left:.9mm solid ${T.ACCENT};padding:.4mm 0 .4mm 3.5mm;margin:0 0 4mm;font-size:10.5pt;line-height:1.42}
  .pro-doc .pro-acte b{color:${T.ENCRE_FORTE}}
  .pro-doc .pro-lignes{background:${T.FOND_BLOC};border-radius:2.5mm;padding:2mm 3.4mm;margin:0 0 4mm}
  .pro-doc .pro-lg{display:flex;align-items:baseline;padding:1.1mm 0;border-bottom:.2mm solid ${T.FILET}}
  .pro-doc .pro-lg:last-child{border-bottom:0}
  .pro-doc .pro-lg .lab{flex:1;padding-right:5mm;font-size:9pt;line-height:1.3}
  .pro-doc .pro-lg .val{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap;font-size:10pt}
  .pro-doc .pro-lg.tot{border-bottom:0;border-top:.45mm solid ${T.ENCRE_FORTE};margin-top:.6mm;padding-top:1.8mm}
  .pro-doc .pro-lg.tot .lab{font-weight:700;font-size:10.5pt;color:${T.ENCRE_FORTE}}
  .pro-doc .pro-lg.tot .val{font-weight:800;font-size:12pt;color:${T.ENCRE_FORTE}}
  .pro-doc .pro-lg.hi .val{color:${T.ACCENT}}
  .pro-doc h3{font:700 11pt/1.25 ${DOC_FONT_TITRE};color:${T.ENCRE_FORTE};letter-spacing:-.01em;margin:5mm 0 2.2mm;padding-bottom:1.2mm;border-bottom:.35mm solid ${T.FILET};page-break-after:avoid}
  .pro-doc .pro-kv{width:100%;border-collapse:collapse;margin:0 0 4mm;page-break-inside:avoid}
  .pro-doc .pro-kv td{padding:1.8mm 3mm;border-bottom:.2mm solid ${T.FILET};vertical-align:top;font-size:9.5pt}
  .pro-doc .pro-kv tr:last-child td{border-bottom:0}
  .pro-doc .pro-kv td:first-child{background:${T.FOND_BLOC};font-weight:600;color:${T.ENCRE_FORTE};width:44%}
  .pro-doc .pro-tbl{width:100%;border-collapse:collapse;margin:0 0 4mm;font-size:8.5pt}
  .pro-doc .pro-tbl th{text-align:left;font:600 7.5pt/1 ${DOC_FONT_CORPS};letter-spacing:.13em;text-transform:uppercase;color:${T.GRIS_LABEL};padding:0 2.5mm 1.4mm;border-bottom:.35mm solid ${T.FILET};background:none}
  .pro-doc .pro-tbl td{padding:1.4mm 2.5mm;border-bottom:.2mm solid ${T.FILET};vertical-align:top}
  .pro-doc .pro-tbl td.num,.pro-doc .pro-tbl th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .pro-doc .pro-tbl tr.tot td{border-bottom:0;border-top:.45mm solid ${T.ENCRE_FORTE};font-weight:700;color:${T.ENCRE_FORTE};padding-top:1.8mm}
  .pro-doc .pro-mention{font-size:8pt;color:${T.GRIS_MENTION};line-height:1.45;margin:0 0 2mm;font-style:normal;border:0;padding:0}
  .pro-doc .pro-encart{background:${T.FOND_BLOC};border-radius:2.5mm;padding:2.4mm 3.4mm;margin:0 0 4mm;font-size:8pt;color:${T.GRIS_MENTION};line-height:1.45}
  .pro-doc .pro-encart b{color:${T.ENCRE};font-weight:600}
  .pro-doc .pro-lieu{font-size:9pt;color:#3c4658;margin:0 0 1mm}
  /* 3 cadres × 56 mm + 2 × 6 mm = 180 mm (zone utile) : même rangée de 3 que le PDF natif
     (le PDF élargit à 70 mm quand il n'y a qu'1 ou 2 cadres) */
  .pro-doc .pro-signzone{padding-top:3mm;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6mm}
  .pro-doc .pro-signzone.duo{justify-content:space-between}
  .pro-doc .pro-sigcase{page-break-inside:avoid}
  .pro-doc .pro-sigspace{width:56mm;min-height:10mm;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;overflow:hidden}
  .pro-doc .pro-sigspace img{max-height:10mm;max-width:56mm;display:block}
  .pro-doc .pro-sigmention{display:block;font-size:9pt;font-style:italic;color:${T.ENCRE};line-height:1.3;text-align:center;margin:0 0 .6mm}
  .pro-doc .pro-sigmention.pro-sigconsigne{font-size:8pt;color:${T.GRIS_MENTION};margin-bottom:auto}
  .pro-doc .pro-sigspace:has(.pro-sigconsigne){min-height:24mm}
  .pro-doc .pro-signbox{width:56mm;border-top:.3mm solid #b8c0cd;padding-top:1.4mm;text-align:center;font-size:8.5pt;line-height:1.35;color:${T.GRIS}}
  .pro-doc .pro-pied{margin-top:4mm;padding-top:1.8mm;border-top:.2mm solid ${T.FILET};display:flex;justify-content:space-between;gap:6mm;font-size:7.5pt;color:${T.GRIS_PIED}}
  .pro-doc .pro-pied .ref{font-family:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;letter-spacing:.06em}
  .pro-doc .pro-alerte{border-radius:2.5mm;padding:2.4mm 3.4mm;margin:0 0 4mm;font-size:9pt;line-height:1.35}
  @media print{.pro-doc .no-print{display:none}}`
      // AUDIT M4 — le générateur de mirror IIFE ré-indente tout le corps des fonctions de deux
      // espaces, littéral gabarit compris : sans ce nettoyage, window.DocTemplate.docCss() rend
      // des règles décalées là où le module ES n'en met pas. Sans conséquence en CSS, mais deux
      // sorties divergentes pour une même source, ce n'est pas une source unique.
      .replace(/^[ \t]+/gm, '').trim();
  }

  /** La feuille de style prête à insérer dans un fragment injecté par innerHTML. */
  function docStyleTag() {
    return '<style>' + docCss() + '</style>';
  }

  /**
   * Titre du document + sa ligne de contexte en gris.
   * @param {string} h1  titre (fragment HTML)
   * @param {string} [ctx] ligne de contexte (fragment HTML) — omise si vide
   */
  function docTitre(h1, ctx) {
    const c = ctx == null ? '' : String(ctx);
    return '<div class="pro-titre"><h1>' + (h1 == null ? '' : String(h1)) + '</h1>'
      + (c ? '<p class="pro-ctx">' + c + '</p>' : '') + '</div>';
  }

  /**
   * Les parties, côte à côte, chacune dans son bloc (mockup : « Même texte, autre disposition »).
   * @param {Array<{label:string, qui?:string, corps?:string}>} blocs
   */
  function docParties(blocs) {
    const list = (blocs || []).filter(Boolean);
    if (!list.length) return '';
    return '<div class="pro-parties">' + list.map(function (b) {
      return '<div class="pro-partie"><h2>' + (b.label == null ? '' : String(b.label)) + '</h2>'
        + (b.qui ? '<span class="pro-qui">' + b.qui + '</span>' : '')
        + (b.corps == null ? '' : String(b.corps))
        + '</div>';
    }).join('') + '</div>';
  }

  /** La phrase qui porte l'acte, mise en avant sans être réécrite. */
  function docActe(html) {
    return '<p class="pro-acte">' + (html == null ? '' : String(html)) + '</p>';
  }

  /**
   * Bloc de chiffres. `tot` trace le filet de total, `hi` passe la valeur en corail.
   * @param {Array<{lab:string, val:string, tot?:boolean, hi?:boolean}>} rows
   */
  function docLignes(rows) {
    const list = (rows || []).filter(Boolean);
    if (!list.length) return '';
    return '<div class="pro-lignes">' + list.map(function (r) {
      const cls = 'pro-lg' + (r.tot ? ' tot' : '') + (r.hi ? ' hi' : '');
      return '<div class="' + cls + '"><span class="lab">' + (r.lab == null ? '' : String(r.lab))
        + '</span><span class="val">' + (r.val == null ? '' : String(r.val)) + '</span></div>';
    }).join('') + '</div>';
  }

  /** Mention en petit gris (celles du fond légal : elles ne sont jamais réécrites, juste posées). */
  function docMention(html) {
    return '<p class="pro-mention">' + (html == null ? '' : String(html)) + '</p>';
  }

  /** Encart gris pour un bloc de mentions long (décompte : mentions légales obligatoires). */
  function docEncart(html) {
    return '<div class="pro-encart">' + (html == null ? '' : String(html)) + '</div>';
  }

  /** « Fait à …, le … » */
  function docLieu(html) {
    return '<p class="pro-lieu">' + (html == null ? '' : String(html)) + '</p>';
  }

  /**
   * Zone de signature. Une case → à droite ; deux cases → aux deux bords (mockup, bail).
   *
   * Deux formes acceptées :
   *   - une chaîne : le fragment est posé sous le filet (forme historique) ;
   *   - un objet {sig, label} : `sig` occupe l'espace AU-DESSUS du filet — c'est là qu'on
   *     signe sur un document papier — et `label` reste sous le filet. On signe au-dessus de
   *     la ligne, pas en dessous : la forme chaîne empilait l'image de signature sous son
   *     propre libellé, ce qui n'a pas de sens sur une feuille imprimée.
   *
   * @param {Array<string|{sig?:string,label?:string}>} boxes
   */
  function docSignzone(boxes) {
    const list = (boxes || []).filter(function (b) {
      return b != null && b !== '' && !(typeof b === 'object' && !b.sig && !b.label);
    });
    if (!list.length) return '';
    return '<div class="pro-signzone' + (list.length > 1 ? ' duo' : '') + '">'
      + list.map(function (b) {
        if (typeof b === 'string') return '<div class="pro-signbox">' + b + '</div>';
        return '<div class="pro-sigcase">'
          + '<div class="pro-sigspace">' + (b.sig || '') + '</div>'
          + '<div class="pro-signbox">' + (b.label || '') + '</div>'
          + '</div>';
      }).join('')
      + '</div>';
  }

  /**
   * Pied de page : référence du document à gauche, date d'émission à droite.
   *
   * ÉCART ASSUMÉ AU MOCKUP : le mockup affiche « page 1/1 ». Ces documents sont rasterisés puis
   * paginés a posteriori (_rasterizeHtmlToPdfBlob) ou imprimés par le navigateur : le nombre de
   * pages n'est pas connu au moment de construire le HTML. Écrire « 1/1 » serait faux dès qu'un
   * document déborde. La case n'est donc remplie que si l'appelant CONNAÎT la pagination.
   */
  function docPied(o) {
    const opts = o || {};
    const parts = [];
    if (opts.ref) parts.push('<span class="ref">' + opts.ref + '</span>');
    if (opts.date) parts.push('<span>' + opts.date + '</span>');
    if (opts.pages) parts.push('<span>' + opts.pages + '</span>');
    if (!parts.length) return '';
    return '<div class="pro-pied">' + parts.join('') + '</div>';
  }

  /**
   * Le document complet, dans l'ordre du gabarit : bandeau d'identité, titre, corps, pied.
   * C'est LE point d'entrée : aucun générateur ne réassemble ces morceaux lui-même.
   *
   * @param {object} o
   * @param {string} [o.bandeau]  sortie de DocBrand.brandzoneHtml (déjà stylée en ligne)
   * @param {string} [o.titre]    titre du document
   * @param {string} [o.ctx]      ligne de contexte sous le titre
   * @param {string} [o.corps]    fragment HTML du corps (fond légal, jamais réécrit ici)
   * @param {string} [o.ref]      référence portée au pied
   * @param {string} [o.date]     date d'émission portée au pied
   * @param {string} [o.pages]    pagination, seulement si elle est connue
   * @param {boolean} [o.withStyle=true] insère la feuille de style scopée en tête du fragment
   * @param {string} [o.pageBreakAfter] 'always' pour enchaîner un document par destinataire
   */
  function docPage(o) {
    const opts = o || {};
    const style = opts.withStyle === false ? '' : docStyleTag();
    const brk = opts.pageBreakAfter ? ' style="page-break-after:' + opts.pageBreakAfter + '"' : '';
    return style + '<div class="pro-doc"' + brk + '>'
      + (opts.bandeau || '')
      + (opts.titre ? docTitre(opts.titre, opts.ctx) : '')
      + (opts.corps || '')
      + docPied({ ref: opts.ref, date: opts.date, pages: opts.pages })
      + '</div>';
  }

  /**
   * DOC-3 (AUDIT-GLOBAL) — Rend un document `.pro-doc` dans une IFRAME SANDBOXÉE.
   *
   * Le HTML des documents était injecté par `innerHTML` DANS LA PAGE DE L'APP : un `<img onerror>`
   * glissé dans un champ synchronisé (nom de garant, libellé, note) s'exécutait dans l'origine de
   * l'application, avec accès au jeton de session et au miroir de données.
   *
   * Pourquoi isoler plutôt qu'assainir : le corps d'un document CONTIENT du HTML légitime
   * (tableaux, mises en forme) — l'échapper globalement casserait le document. Et on n'écrit pas un
   * sanitizer maison sur un chemin de document légal, ni n'en charge un (règle « aucun CDN runtime »).
   * L'iframe neutralise le script QUEL QUE SOIT le contenu : c'est la seule garantie qui ne dépend
   * pas de la perfection de chaque générateur.
   *
   * ⚠️ `allow-same-origin` SANS `allow-scripts` : le script ne s'exécute pas, et le parent peut
   * mesurer la hauteur du document pour dimensionner le cadre. **Ajouter `allow-scripts` à cette
   * combinaison rendrait le bac à sable inopérant** — l'iframe pourrait retirer son propre sandbox.
   * C'est pourquoi le jeton est ignoré s'il est demandé par un appelant.
   *
   * @param {{corps?:string, css?:string, className?:string, title?:string}} o
   * @returns {string} le markup `<iframe …>` prêt à être inséré
   */
  /**
   * ⚠️ Le document est rendu TEL QUEL, sans échappement : il est destiné à la PROPRIÉTÉ `.srcdoc`
   * d'un cadre existant (aucun échappement d'attribut nécessaire par ce chemin). Pour produire du
   * MARKUP, passer par `docSandboxFrame`, qui échappe. Concaténer ce résultat dans un `innerHTML`
   * rouvrirait exactement la faille DOC-3.
   */
  function docSandboxDoc(o) {
    const opts = o || {};
    // `body{margin:0}` AVANT la CSS du gabarit : le cadre ne doit pas décaler le document par
    // rapport au rendu d'avant (marge par défaut de 8 px du navigateur).
    return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
      + '<style>body{margin:0}' + (opts.css || '') + '</style></head><body>'
      + (opts.corps || '') + '</body></html>';
  }

  /**
   * Le cadre complet, prêt à insérer. Pour un RE-rendu, préférer `docSandboxDoc` posé sur la
   * propriété `srcdoc` du cadre existant : on garde le cadre, sa hauteur et le défilement.
   */
  function docSandboxFrame(o) {
    const opts = o || {};
    const doc = docSandboxDoc(opts);
    // `srcdoc` est un attribut HTML : `&` D'ABORD (sinon on ré-encoderait les `&` produits juste
    // après), puis `"` qui seul peut fermer l'attribut.
    const srcdoc = String(doc).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const cls = opts.className ? ' class="' + String(opts.className).replace(/"/g, '&quot;') + '"' : '';
    const ttl = opts.title ? ' title="' + String(opts.title).replace(/"/g, '&quot;') + '"' : '';
    // Bac à sable NON négociable : la valeur est constante, jamais celle de l'appelant.
    return '<iframe sandbox="allow-same-origin"' + cls + ttl + ' srcdoc="' + srcdoc + '"></iframe>';
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.DocTemplate = {
    DOC_TPL: DOC_TPL,
    DOC_FONT_TITRE: DOC_FONT_TITRE,
    DOC_FONT_CORPS: DOC_FONT_CORPS,
    docCss: docCss,
    docStyleTag: docStyleTag,
    docTitre: docTitre,
    docParties: docParties,
    docActe: docActe,
    docLignes: docLignes,
    docMention: docMention,
    docEncart: docEncart,
    docLieu: docLieu,
    docSignzone: docSignzone,
    docPied: docPied,
    docPage: docPage,
    docSandboxDoc: docSandboxDoc,
    docSandboxFrame: docSandboxFrame
  };
})(typeof window !== 'undefined' ? window : globalThis);
