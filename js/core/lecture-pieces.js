// js/core/lecture-pieces.js — VERIF-DOCUMENTS lots 1-2 (v15.740 provisoire).
// Lecture LOCALE d'une pièce (PDF ou image) pour les vérifications : codes 2D-Doc (DataMatrix), couche texte,
// informations internes du PDF. Rien ne quitte l'appareil.
// Les dépendances du navigateur sont INJECTÉES (pdf.js, lecteur DataMatrix, canvas) : le module reste testable
// sans DOM (__tests__/helpers/lecture-pieces.test.js, avec des doublures).
// Leçons du prototype (phase 1) : le code ne se détecte pas sur une page entière → on lit d'abord les IMAGES
// intégrées au PDF, puis la page rendue, puis des fenêtres qui se chevauchent ; rendu pdf.js avec intent « print »
// (le mode écran s'arrête quand l'onglet passe en arrière-plan).

import { compterEnregistrements, trouverSuperpositions } from './indices-pdf.js';

export const MAX_PAGES = 3;
const MAX_TEXTE = 200000;
const MAX_FENETRES = 48;
export const ESSAIS_MAX = 60;          // décodages DataMatrix au plus par document (temps de calcul borné, téléphones)
const IMAGES_PAR_PAGE = 6;
const IMAGES_EXAMINEES = 20;           // images peintes regardées par page (détection d'une page scannée)
const DELAI_OBJET_MS = 2000;
const ceder = () => new Promise((r) => setTimeout(r, 0));   // rend la main au navigateur entre deux lectures lourdes
/** Objet image de pdf.js : les images partagées entre pages (« g_… ») sont dans commonObjs, les autres dans objs ;
 *  une attente qui ne se résout jamais (objet absent) est coupée au bout de 2 s (null). */
export function attendreObjet(page, nom, ms = DELAI_OBJET_MS) {
  return new Promise((res) => {
    const t = setTimeout(() => res(null), ms);
    const fin = (o) => { clearTimeout(t); res(o || null); };
    try { const store = String(nom).startsWith('g_') ? page.commonObjs : page.objs; if (!store) return fin(null); store.get(nom, fin); } catch { fin(null); }
  });
}

/**
 * Cherche un DataMatrix dans un canvas : l'image entière, puis des fenêtres qui se chevauchent.
 * @param {object} canvas
 * @param {(c:object)=>string|null} lire  décodeur (ZXing) appliqué à un canvas
 * @param {(w:number,h:number)=>object} creerCanvas
 */
export function chercherCode(canvas, lire, creerCanvas, budget) {
  const b = budget || { essais: Infinity };
  const essai = (c) => { if (b.essais <= 0) return null; b.essais--; return lire(c); };
  const plein = essai(canvas); if (plein) return plein;
  const W = canvas.width, H = canvas.height; const T = Math.round(Math.min(W, H) / 2.5); if (T < 120) return null;
  const pas = Math.round(T / 2); let n = 0;
  for (let y = 0; y < H; y += pas) for (let x = 0; x < W; x += pas) {
    if (++n > MAX_FENETRES || b.essais <= 0) return null;
    const c = creerCanvas(T, T); const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, T, T); g.drawImage(canvas, x, y, T, T, 0, 0, T, T);
    const t = essai(c); if (t) return t;
  }
  return null;
}

/** Image d'un objet pdf.js (bitmap, ou pixels selon ImageKind 1/2/3) → canvas, agrandi sans lissage s'il est petit. */
export function imageVersCanvas(obj, creerCanvas) {
  const w = obj.width, h = obj.height; if (!w || !h) return null;
  const marge = Math.round(Math.max(w, h) * 0.08) + 4;
  const base = creerCanvas(w + 2 * marge, h + 2 * marge); const g = base.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, base.width, base.height);
  if (obj.bitmap) g.drawImage(obj.bitmap, marge, marge);
  else if (obj.data) {
    const id = g.createImageData(w, h); const d = obj.data, o = id.data;
    if (obj.kind === 1) {                       // GRAYSCALE_1BPP : 1 bit par pixel, lignes alignées sur l'octet, bit à 1 = blanc
      const ligne = (w + 7) >> 3;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = (d[y * ligne + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0; const p = 4 * (y * w + x); o[p] = o[p + 1] = o[p + 2] = v; o[p + 3] = 255; }
    } else {
      const bpp = obj.kind === 3 ? 4 : 3;
      for (let i = 0, j = 0; i < w * h; i++, j += bpp) { o[4 * i] = d[j]; o[4 * i + 1] = d[j + 1]; o[4 * i + 2] = d[j + 2]; o[4 * i + 3] = 255; }
    }
    g.putImageData(id, marge, marge);
  } else return null;
  const min = Math.min(base.width, base.height);
  if (min >= 300) return base;
  const k = Math.ceil(300 / min); const c = creerCanvas(base.width * k, base.height * k); const gg = c.getContext('2d');
  gg.imageSmoothingEnabled = false; gg.drawImage(base, 0, 0, c.width, c.height);
  return c;
}

/**
 * @param {{octets:Uint8Array, mime:string}} fichier
 * @param {{pdfjs?:object, lire:(canvas)=>string|null, creerCanvas:(w,h)=>object, chargerImage?:(octets,mime)=>Promise<{source,largeur,hauteur}>,
 *          lirePhoto?:(canvas)=>Promise<string|null>}} deps  lirePhoto (LECTURE-PHOTOS) : lecteur de photos, utilisé pour une
 *          image, et pour une page de PDF quand la recherche directe n'a rien donné (page scannée ou photographiée)
 * @returns {Promise<{illisible:boolean, estPdf:boolean, pages?:number, codes:string[], texte:string, metadonnees?:object, enregistrements?:number, superpositions?:Array,
 *   inacheve?:true, codeParPhoto?:true}>}  inacheve : la lecture d'une photo n'a pas pu finir (à relire) ; codeParPhoto : le code
 *   vient d'une photo ou d'une page scannée (le texte du PDF n'est alors pas comparable aux données signées)
 */
export async function analyserFichier(fichier, deps) {
  const octets = fichier && fichier.octets; const mime = String((fichier && fichier.mime) || '').toLowerCase();
  if (!octets || !octets.length) return { illisible: true, estPdf: false, codes: [], texte: '' };
  const codes = [];
  const ajouter = (t) => { if (t && !codes.includes(t)) codes.push(t); };
  const budget = { essais: (deps && deps.essaisMax) || ESSAIS_MAX };
  const pause = (deps && deps.ceder) || ceder;
  if (mime === 'application/pdf') {
    if (!deps || !deps.pdfjs) throw new Error('pdf.js indisponible');
    let doc;
    try { doc = await deps.pdfjs.getDocument({ data: octets.slice(), isEvalSupported: false }).promise; }
    catch { return { illisible: true, estPdf: true, codes: [], texte: '' }; }
    try {
      let meta = {}; try { meta = ((await doc.getMetadata()) || {}).info || {}; } catch { meta = {}; }
      const items = []; let texte = '', inacheve = false, parPhoto = false;
      const n = Math.min(doc.numPages || 0, MAX_PAGES);
      for (let p = 1; p <= n; p++) {
        const page = await doc.getPage(p);
        let caracteresPage = 0;
        try {
          const tc = await page.getTextContent();
          for (const it of tc.items || []) {
            if (!it || typeof it.str !== 'string') continue;
            caracteresPage += it.str.trim().length;
            items.push({ page: p, str: it.str, x: it.transform ? it.transform[4] : 0, y: it.transform ? it.transform[5] : 0 });
            if (texte.length < MAX_TEXTE) texte += it.str + (it.hasEOL ? '\n' : ' | ');
          }
        } catch { /* couche texte absente : pas de comparaison */ }
        // deux compteurs : toutes les images peintes (détection d'une page scannée, 20 au plus) ; les images CANDIDATES au code
        // après filtres (6 au plus, comme avant) — des logos placés avant le code ne l'empêchent pas d'être examiné
        let trouve = null, examinees = 0, vues = 0, grandeImage = false;
        try {
          const ops = await page.getOperatorList();
          const OPS = deps.pdfjs.OPS || {};
          for (let i = 0; i < ops.fnArray.length && !trouve && examinees < IMAGES_EXAMINEES; i++) {
            if (ops.fnArray[i] !== OPS.paintImageXObject && ops.fnArray[i] !== OPS.paintInlineImageXObject) continue;
            examinees++;
            const arg = ops.argsArray[i] && ops.argsArray[i][0];
            const obj = typeof arg === 'string' ? await attendreObjet(page, arg, deps.delaiObjetMs) : arg;
            if (!obj || !obj.width || !obj.height) continue;
            if (obj.width * obj.height >= 1e6) grandeImage = true;        // image d'au moins 1 Mpx : page scannée ou photographiée
            if (obj.width * obj.height > 16e6) continue;
            // Un 2D-Doc est presque carré et lisible : on ignore vignettes, filets et bandeaux.
            const ratio = Math.max(obj.width, obj.height) / Math.min(obj.width, obj.height);
            if (Math.min(obj.width, obj.height) < 16 || ratio > 3) continue;
            if (budget.essais <= 0 || vues >= IMAGES_PAR_PAGE) continue;
            vues++;
            const c = imageVersCanvas(obj, deps.creerCanvas); if (c) trouve = chercherCode(c, deps.lire, deps.creerCanvas, budget);
            await pause();
          }
        } catch { /* liste d'opérations indisponible : on passe au rendu */ }
        // LECTURE-PHOTOS : page SCANNÉE ou photographiée — sans couche texte, ou portée par une grande image (les applications
        // de numérisation ajoutent souvent un texte reconnu) → lecteur de photos, indépendamment du budget de la recherche
        // directe. Une page numérique (PDF d'impots.gouv, bulletin de logiciel de paie) n'y passe pas (temps borné).
        const photoProbable = !!deps.lirePhoto && (caracteresPage < 20 || grandeImage);
        if (!trouve && (budget.essais > 0 || photoProbable)) {
          const vp1 = page.getViewport({ scale: 1 }); const k = Math.min(3, 2400 / Math.max(vp1.width, vp1.height));
          const vp = page.getViewport({ scale: k }); const c = deps.creerCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
          await page.render({ canvasContext: c.getContext('2d'), viewport: vp, intent: 'print' }).promise;
          if (photoProbable) {
            // page scannée : le lecteur de photos SEUL (il essaie d'abord l'image entière) — pas les fenêtres sur le fil principal.
            // Une exception = lecture pas finie (délai) : « inacheve », la pièce sera relue — jamais « aucun code ».
            try { trouve = await deps.lirePhoto(c); if (trouve) parPhoto = true; } catch { inacheve = true; }
          } else if (budget.essais > 0) trouve = chercherCode(c, deps.lire, deps.creerCanvas, budget);
          await pause();
        }
        ajouter(trouve);
      }
      const enr = compterEnregistrements(octets);
      return {
        illisible: false, estPdf: true, pages: doc.numPages || 0, codes, texte,
        metadonnees: { producteur: String(meta.Producer || '').slice(0, 120), createur: String(meta.Creator || '').slice(0, 120), creeLe: String(meta.CreationDate || ''), modifieLe: String(meta.ModDate || '') },
        enregistrements: enr.enregistrements, superpositions: trouverSuperpositions(items),
        ...(inacheve ? { inacheve: true } : {}), ...(parPhoto ? { codeParPhoto: true } : {})
      };
    } finally { try { doc.destroy && doc.destroy(); } catch { /* rien */ } }
  }
  if (mime === 'image/jpeg' || mime === 'image/png') {
    let img;
    try { img = await deps.chargerImage(octets, mime); } catch { return { illisible: true, estPdf: false, codes: [], texte: '' }; }
    if (!img || !img.largeur || !img.hauteur) return { illisible: true, estPdf: false, codes: [], texte: '' };
    const k = Math.min(1, 3000 / Math.max(img.largeur, img.hauteur));
    const c = deps.creerCanvas(Math.round(img.largeur * k), Math.round(img.hauteur * k));
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img.source, 0, 0, c.width, c.height);
    try { if (img.source && typeof img.source.close === 'function') img.source.close(); } catch { /* rien */ }   // mémoire (téléphones)
    // LECTURE-PHOTOS : une photo passe par le lecteur de photos (localisation, redressement, grille) s'il est fourni
    // (une exception = lecture pas finie, faute de temps : « inacheve », la pièce sera relue — jamais « aucun code »)
    let t = null, inacheve = false;
    if (deps.lirePhoto) { try { t = await deps.lirePhoto(c); } catch { inacheve = true; } }
    else t = chercherCode(c, deps.lire, deps.creerCanvas, budget);
    ajouter(t);
    return { illisible: false, estPdf: false, codes, texte: '', ...(inacheve ? { inacheve: true } : {}), ...(t && deps.lirePhoto ? { codeParPhoto: true } : {}) };
  }
  return { illisible: true, estPdf: false, codes: [], texte: '' };
}

// ── Lot 3 : page 1 d'une pièce en JPEG, pour la lecture IA (seule cette page est envoyée — minimisation) ──
export const IMAGE_MAX_CARACTERES = 1050 * 1024;   // le relais refuse au-delà de 1 100 Kio (tâche bulletin-paie)
/**
 * @param {{octets:Uint8Array, mime:string}} fichier
 * @param {{pdfjs?, creerCanvas, chargerImage?, versJpeg:(canvas, qualite:number)=>string}} deps
 * @returns {Promise<string|null>} data URL JPEG, ou null si la page ne peut pas être rendue sous la taille admise
 */
export async function pageVersImage(fichier, deps, largeurCible = 1600) {
  const mime = String((fichier && fichier.mime) || '').toLowerCase();
  let source, largeur, hauteur, detruire = null;
  if (mime === 'application/pdf') {
    const doc = await deps.pdfjs.getDocument({ data: fichier.octets.slice(), isEvalSupported: false }).promise;
    detruire = () => { try { doc.destroy && doc.destroy(); } catch { /* rien */ } };
    try {
      const page = await doc.getPage(1);
      const vp1 = page.getViewport({ scale: 1 }); const k = Math.min(3, largeurCible / vp1.width);
      const vp = page.getViewport({ scale: k });
      source = deps.creerCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const g = source.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, source.width, source.height);
      await page.render({ canvasContext: g, viewport: vp, intent: 'print' }).promise;
      largeur = source.width; hauteur = source.height;
    } catch (e) { detruire(); throw e; }
  } else if (mime === 'image/jpeg' || mime === 'image/png') {
    const img = await deps.chargerImage(fichier.octets, mime);
    source = img.source; largeur = img.largeur; hauteur = img.hauteur;
  } else return null;
  try {
    for (const echelle of [1, 0.8, 0.65]) {
      const k = Math.min(1, (largeurCible * echelle) / largeur);
      const c = deps.creerCanvas(Math.round(largeur * k), Math.round(hauteur * k));
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(source, 0, 0, c.width, c.height);
      for (const q of [0.82, 0.7, 0.55]) { const u = deps.versJpeg(c, q); if (u && u.length <= IMAGE_MAX_CARACTERES) return u; }
    }
    return null;
  } finally {
    if (detruire) detruire();
    try { if (source && typeof source.close === 'function') source.close(); } catch { /* rien */ }
  }
}
