/**
 * bail-paraphes.global.js — Wrapper browser (window.BailParaphes)
 * (GÉNÉRÉ AUTOMATIQUEMENT par tools/sync-helpers-global-mirrors.mjs)
 *
 * ⚠️ NE PAS ÉDITER À LA MAIN. Ce fichier est régénéré depuis :
 *    js/core/bail-paraphes.js
 *
 * Si tu modifies la logique, fais-le côté module ES, exécute :
 *   node tools/sync-helpers-global-mirrors.mjs
 * et commite les deux fichiers ensemble.
 */
(function(global) {
  'use strict';

  // js/core/bail-paraphes.js — PARAPHE-UNIQUE (v15.709, option A validée par Didier le 30/09).
  //
  // POURQUOI : en signature en présence (document défilant), chaque signataire trace son paraphe UNE
  // fois, puis l'appose d'un clic page par page. L'ancienne persistance recopiait la même image dans
  // chaque page : `signatures.paraphes = { page → { sigId → dataURL } }`. Sérialisé dans le miroir
  // local, la ligne cloud `baux.signatures` et les instantanés, cela faisait ≈ 0,5 M caractères par
  // bail à 2 signataires, dont 80 % de recopie (constat mockups/STOCKAGE/BAUX-POIDS.md).
  //
  // QUAND COMPACTER (audit 01/10, 🔴 prouvé) : UNIQUEMENT quand le bail devient COMPLET (plus aucun
  // signataire, présent ou distant, en attente). Tant qu'il est PARTIEL, `paraphes` est écrit en entier,
  // comme avant. Raison : en cloud, un onglet ouvert avant un déploiement n'est jamais rechargé ; s'il
  // reprend un bail partiel compacté (ex. le locataire signe après le bailleur), l'ancien code relit
  // `paraphes` (vide), réécrit `signatures` sans `parapheImg`, et le paraphe du 1er signataire est
  // PERDU pour toujours, PDF final archivé compris. Un bail complet, lui, n'est plus réécrit par la
  // signature (seule la réinitialisation l'efface).
  //
  // FORME STOCKÉE d'un bail COMPLET (signatures.format = 2) :
  //   signatures.parapheImg   = { sigId → dataURL }            une image par signataire
  //   signatures.parapheTimes = { page → { sigId → ISO } }     existait déjà : pages paraphées + heure
  //   signatures.paraphes     = { page → { sigId → dataURL } } ne garde que les signataires dont les
  //                              paraphes NE SE RÉDUISENT PAS à une image unique (ancien bail repris,
  //                              page sans heure, page vide) ; {} dans le cas normal.
  // RISQUE RÉSIDUEL (assumé, cf. rapport) : un onglet resté en v15.708 ou avant qui ouvre un bail COMPLET
  // compacté lit `paraphes` vide. Il ne plante pas, mais « PDF » y produit un PDF SANS AUCUNE page de
  // paraphe ; si ce bail n'a pas de certificat archivé (certRef), ce PDF peut remplacer le PDF archivé
  // (cloudPdfKey). À partir de v15.709, le contrôle de version (js/core/version-app.js) bloque signature
  // et « PDF » dans un onglet périmé, et `format` fait refuser une forme future inconnue.
  // FORME ANCIENNE (baux signés avant v15.709, et tout bail partiel) : `paraphes` seul, parfois avec
  // des images différentes par page (avant v15.697). Elle se lit telle quelle et n'est jamais réécrite
  // sur un bail verrouillé.
  //
  // Les images n'entrent pas dans l'empreinte légale (bail-content-hash.js : liste blanche).
  //
  // ⚠️ Ces fonctions sont sérialisées par toString() dans la popup de signature (document
  // about:blank, cf. previewBailData). Variables libres autorisées, injectées SOUS CE NOM :
  // `parapheDe` (dans parapheCarte), `compacterParaphes`, `parapheCarte`, `FORMAT_SIGNATURES`.
  // __tests__/helpers/popup-signature-reel.test.js extrait et exécute le VRAI bundle d'index.html.

  /** Version de la forme de `signatures` que ce code sait lire et écrire. */
  const FORMAT_SIGNATURES = 2;

  /**
   * Lecteur UNIQUE : image du paraphe du signataire `sigId` sur la page `page`, ou null.
   * Les deux formes : `paraphes[page][sigId]` (explicite, ancienne forme) prime ; sinon
   * `parapheImg[sigId]` si le signataire a une heure de paraphe sur cette page.
   */
  function parapheDe(sig, page, sigId) {
    var s = sig || {};
    var parPage = s.paraphes && s.paraphes[page];
    if (parPage && parPage[sigId]) return parPage[sigId];
    var img = s.parapheImg && s.parapheImg[sigId];
    var heure = s.parapheTimes && s.parapheTimes[page] && s.parapheTimes[page][sigId];
    return (img && heure) ? img : null;
  }

  /**
   * Carte complète { page → { sigId → dataURL } } (clés de page en chaînes), reconstruite pour le
   * PDF et la réouverture d'un bail signé. Une page sans aucun paraphe n'y figure pas, SAUF si elle
   * est explicitement présente (même vide) dans `paraphes` : l'ancien parcours (v12.94, pads absents)
   * a pu enregistrer `paraphes[page] = {}`, et la réouverture en déduit « page à cases de paraphe »
   * (pied dessiné, cases vides) — on garde ce rendu à l'identique.
   */
  function parapheCarte(sig) {
    var s = sig || {}, out = {}, pages = {}, k, id;
    for (k in (s.paraphes || {})) {
      if (Object.prototype.hasOwnProperty.call(s.paraphes, k) && s.paraphes[k] && typeof s.paraphes[k] === 'object') out[k] = {};
    }
    var sources = [s.paraphes || {}, s.parapheTimes || {}];
    for (var i = 0; i < sources.length; i++) {
      for (k in sources[i]) {
        if (!Object.prototype.hasOwnProperty.call(sources[i], k) || !sources[i][k]) continue;
        pages[k] = pages[k] || {};
        for (id in sources[i][k]) if (Object.prototype.hasOwnProperty.call(sources[i][k], id)) pages[k][id] = true;
      }
    }
    for (k in pages) {
      for (id in pages[k]) {
        var img = parapheDe(s, k, id);
        if (img) { out[k] = out[k] || {}; out[k][id] = img; }
      }
    }
    return out;
  }

  /**
   * Écriture : à partir de la carte en mémoire de la popup ({ page → { sigId → dataURL } }) et des
   * heures ({ page → { sigId → ISO } }), rend { parapheImg, paraphes } à stocker À CÔTÉ de
   * parapheTimes. Un signataire passe en image unique si et seulement si la relecture est EXACTE :
   * une seule image sur toutes ses pages ET une heure sur exactement ces pages-là. Sinon ses pages
   * restent explicites dans `paraphes` (aucune perte, aucun paraphe fantôme). N'altère pas l'entrée.
   */
  function compacterParaphes(carte, heures) {
    var c = carte || {}, h = heures || {}, parSig = {}, k, id;
    for (k in c) {
      if (!Object.prototype.hasOwnProperty.call(c, k) || !c[k]) continue;
      for (id in c[k]) {
        if (!Object.prototype.hasOwnProperty.call(c[k], id) || !c[k][id]) continue;
        parSig[id] = parSig[id] || { imgs: {}, pages: {} };
        parSig[id].imgs[c[k][id]] = true;
        parSig[id].pages[String(k)] = c[k][id];
      }
    }
    var parapheImg = {}, paraphes = {};
    // Page présente mais sans aucun paraphe (ancien bail, cf. parapheCarte) : gardée telle quelle.
    for (k in c) {
      if (!Object.prototype.hasOwnProperty.call(c, k) || !c[k] || typeof c[k] !== 'object') continue;
      var vide = true;
      for (id in c[k]) if (Object.prototype.hasOwnProperty.call(c[k], id) && c[k][id]) { vide = false; break; }
      if (vide) paraphes[String(k)] = {};
    }
    for (id in parSig) {
      var imgs = Object.keys(parSig[id].imgs), pagesImg = Object.keys(parSig[id].pages).sort();
      var pagesHeure = [];
      for (k in h) if (Object.prototype.hasOwnProperty.call(h, k) && h[k] && h[k][id]) pagesHeure.push(String(k));
      pagesHeure.sort();
      if (imgs.length === 1 && pagesHeure.join('|') === pagesImg.join('|')) {
        parapheImg[id] = imgs[0];
      } else {
        for (var j = 0; j < pagesImg.length; j++) {
          paraphes[pagesImg[j]] = paraphes[pagesImg[j]] || {};
          paraphes[pagesImg[j]][id] = parSig[id].pages[pagesImg[j]];
        }
      }
    }
    return { paraphes: paraphes, parapheImg: parapheImg };
  }

  /**
   * Le code courant sait-il lire cette forme ? Une forme FUTURE (format > FORMAT_SIGNATURES) est
   * refusée : la relire ou la réécrire avec ce code risquerait de perdre ce qu'il ne connaît pas.
   */
  function formatSignaturesConnu(sig) {
    var f = sig && sig.format != null ? Number(sig.format) : 0;
    return !(f > FORMAT_SIGNATURES);
  }

  /**
   * Le bail est-il COMPLET après cet enregistrement ? `sigs` = signataires du document dans l'ordre
   * (_SIGS : bailleurs puis 'loc-i'), `bailleurModes[i]` ∈ 'pres'|'dist'|'no' pour le i-ème bailleur
   * (défaut 'pres'), `finales` = { sigId → signature finale enregistrée }. Un signataire exclu ('no')
   * n'est pas attendu ; un distant l'est (il n'a pas de signature finale ici tant qu'il n'a pas signé).
   */
  function signaturesCompletes(sigs, bailleurModes, finales) {
    var f = finales || {}, bi = 0, attendus = 0;
    var liste = Array.isArray(sigs) ? sigs : [];
    for (var i = 0; i < liste.length; i++) {
      var id = liste[i] && liste[i].id;
      if (!id) continue;
      var mode = 'pres';
      if (!/^loc-/.test(id)) { mode = (bailleurModes && bailleurModes[bi]) || 'pres'; bi++; }
      if (mode === 'no') continue;
      attendus++;
      if (!f[id]) return false;
    }
    return attendus > 0;
  }

  /**
   * Ce que l'enregistrement de la popup écrit pour les paraphes : bail PARTIEL → la carte entière
   * (ancienne forme, lisible par toute version) ; bail COMPLET → forme compacte.
   */
  function ecrireParaphes(carte, heures, complet) {
    if (complet) return compacterParaphes(carte, heures);
    var c = carte || {}, out = {}, k, id;
    for (k in c) {
      if (!Object.prototype.hasOwnProperty.call(c, k) || !c[k] || typeof c[k] !== 'object') continue;
      out[String(k)] = {};
      for (id in c[k]) if (Object.prototype.hasOwnProperty.call(c[k], id) && c[k][id]) out[String(k)][id] = c[k][id];
    }
    return { paraphes: out };
  }

  /**
   * Retour du relais (parcours mixte présents + distants) : le bail devient complet → champs à
   * fusionner dans `signatures` pour le compacter. null si la forme est inconnue (on n'y touche pas).
   */
  function compacterSignatures(sig) {
    var s = sig || {};
    if (!formatSignaturesConnu(s)) return null;
    if (!s.paraphes && !s.parapheImg) return { format: FORMAT_SIGNATURES };
    var c = compacterParaphes(parapheCarte(s), s.parapheTimes);
    return { paraphes: c.paraphes, parapheImg: c.parapheImg, format: FORMAT_SIGNATURES };
  }

  // ─── EXPORT GLOBAL ───────────────────────────────────────────────
  global.BailParaphes = {
    FORMAT_SIGNATURES: FORMAT_SIGNATURES,
    parapheDe: parapheDe,
    parapheCarte: parapheCarte,
    compacterParaphes: compacterParaphes,
    formatSignaturesConnu: formatSignaturesConnu,
    signaturesCompletes: signaturesCompletes,
    ecrireParaphes: ecrireParaphes,
    compacterSignatures: compacterSignatures
  };
})(typeof window !== 'undefined' ? window : globalThis);
