/**
 * js/core/edl-video-images.js — CHOIX DES IMAGES D'UNE VIDÉO D'ÉTAT DES LIEUX (chantier EDL-VIDEO-IA).
 *
 * Mistral ne prend pas la vidéo : le téléphone en tire des IMAGES, et seules celles-ci partent au modèle.
 * Méthode prouvée sur la vidéo de référence (cuisine, 59 s — mockups/EDL-VIDEO-IA/prototype) :
 *   - mesurer 2 fois par seconde une petite image grise (luminosité, netteté, écart avec la vue en cours) ;
 *   - une nouvelle « vue » commence quand l'image s'écarte trop de la première image de la vue (seuil 28
 *     sur 255), ou après 3 s ; on garde l'image la PLUS NETTE de chaque vue (parmi les assez claires) ;
 *   - une vue entièrement floue (panoramique rapide) est gardée quand même, marquée `flou` : c'est parfois
 *     la seule vue d'un élément (la fenêtre, la suspension de la cuisine de référence).
 * Résultat sur la référence : 80 images, et les 9 recadrages faits à la main y sont tous (corrélation ≥ 0,88).
 *
 * Module PUR (aucun DOM) : la couche app dessine l'image de la caméra sur un canvas et passe les pixels
 * à `mesurer()` ; le sélecteur dit quand garder l'image en grand (`meilleur`), l'app la capture alors.
 */

export const REGLAGES = Object.freeze({
  pasSec: 0.5,          // une mesure toutes les 0,5 s
  seuil: 28,            // écart moyen (0-255) qui ouvre une nouvelle vue
  dureeMaxVue: 3,       // s : au-delà, nouvelle vue même sans mouvement
  lumMin: 25,           // image trop sombre en dessous
  netteteRel: 0.35,     // « floue » si netteté < 35 % de la médiane de la prise
  petiteLargeur: 90,    // largeur de l'image grise de mesure (px)
  envoiCote: 768,       // grand côté des images envoyées au modèle (px)
  imagesParAppel: 8,    // limite Mistral (documentation vision, 14/10/2026)
});

/** Pixels RGBA (Uint8ClampedArray) → { gris, lum, nettete } (variance du laplacien). */
export function mesurer(rgba, w, h) {
  const n = w * h;
  const gris = new Float32Array(n);
  let somme = 0;
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const g = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    gris[j] = g; somme += g;
  }
  let s = 0, s2 = 0, k = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * gris[i] - gris[i - 1] - gris[i + 1] - gris[i - w] - gris[i + w];
      s += l; s2 += l * l; k++;
    }
  }
  const m = k ? s / k : 0;
  return { gris, lum: n ? somme / n : 0, nettete: k ? s2 / k - m * m : 0 };
}

/** Écart moyen absolu entre deux images grises de même taille (0-255). */
export function ecart(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 255;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
}

export function mediane(xs) {
  const a = xs.slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * Sélecteur EN CONTINU (pendant le tournage, ou en relisant une vidéo importée).
 *   const s = creerSelecteur();
 *   const r = s.ajouter({ t, gris, lum, nettete });   // r.meilleur → capturer l'image en grand :
 *   s.attacher(r.idx, donnee);                         // donnee = ce que l'app veut garder (data URL…)
 *   const images = s.terminer();                       // [{ t, nettete, lum, flou, donnee }]
 * N'occupe la mémoire que d'UNE image en grand par vue.
 */
export function creerSelecteur(opts = {}) {
  const o = { ...REGLAGES, ...opts };
  const vues = [];            // { ref:gris, debut, meilleur:{idx,t,nettete,lum,clair}, donnee }
  const nettetes = [];
  let idx = 0;
  return {
    ajouter(e) {
      const i = idx++;
      nettetes.push(e.nettete);
      let v = vues[vues.length - 1];
      if (!v || ecart(e.gris, v.ref) > o.seuil || e.t - v.debut >= o.dureeMaxVue) {
        v = { ref: e.gris, debut: e.t, meilleur: null, donnee: null };
        vues.push(v);
      }
      const clair = e.lum >= o.lumMin;
      const b = v.meilleur;
      // On préfère une image assez claire ; à clarté égale, la plus nette.
      const mieux = !b || (clair && !b.clair) || (clair === b.clair && e.nettete > b.nettete);
      if (mieux) { v.meilleur = { idx: i, t: e.t, nettete: e.nettete, lum: e.lum, clair }; v.donnee = null; }
      return { idx: i, meilleur: mieux, vue: vues.length - 1 };
    },
    attacher(i, donnee) {
      for (let k = vues.length - 1; k >= 0; k--) {
        if (vues[k].meilleur && vues[k].meilleur.idx === i) { vues[k].donnee = donnee; return true; }
      }
      return false;
    },
    get nbVues() { return vues.length; },
    terminer() {
      const med = mediane(nettetes);
      return vues.filter((v) => v.meilleur && v.donnee != null && v.meilleur.clair)
        .map((v) => ({ t: v.meilleur.t, nettete: v.meilleur.nettete, lum: v.meilleur.lum, flou: v.meilleur.nettete < o.netteteRel * med, donnee: v.donnee }));
    },
  };
}

/** Découpe en appels de `max` images (8 par requête chez Mistral). */
export function lots(images, max = REGLAGES.imagesParAppel) {
  const r = [];
  for (let i = 0; i < (images || []).length; i += max) r.push(images.slice(i, i + max));
  return r;
}

/** Dimensions d'envoi (grand côté `cote`, jamais agrandi). */
export function dimensionsEnvoi(w, h, cote = REGLAGES.envoiCote) {
  const W = Number(w) || 0, H = Number(h) || 0;
  if (W <= 0 || H <= 0) return { w: 0, h: 0 };
  const k = Math.min(1, cote / Math.max(W, H));
  return { w: Math.round(W * k), h: Math.round(H * k) };
}

/** mm:ss (instant dans la vidéo, affiché et imprimé dans le PDF). */
export function mmss(t) {
  const s = Math.max(0, Math.round(Number(t) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function normaliser(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/**
 * Instant (s) où un extrait a été prononcé, si la transcription a des segments horodatés
 * ({start,end,text}) : interpolation sur la position du texte dans le segment. null sinon.
 * Ce n'est qu'un INDICE pour le modèle (prototype : l'instant dit ne donne la bonne image que 3 fois sur 9).
 */
export function instantCite(segments, extrait) {
  const ex = normaliser(extrait);
  if (!ex || !Array.isArray(segments)) return null;
  for (const sg of segments) {
    const txt = normaliser(sg && sg.text);
    const i = txt.indexOf(ex);
    if (i < 0) continue;
    const a = Number(sg.start) || 0, b = Number(sg.end) || a;
    return Math.round((a + (txt.length ? i / txt.length : 0) * (b - a)) * 10) / 10;
  }
  return null;
}

/** Rectangle en pixels d'un cadre normalisé { x, y, l, h } (0-1) sur une image W×H. */
export function rectPixels(cadre, W, H) {
  const c = cadre || { x: 0, y: 0, l: 1, h: 1 };
  const x = Math.max(0, Math.min(1, Number(c.x) || 0)), y = Math.max(0, Math.min(1, Number(c.y) || 0));
  const l = Math.max(0.01, Math.min(1 - x, Number(c.l) || 1)), h = Math.max(0.01, Math.min(1 - y, Number(c.h) || 1));
  return { sx: Math.round(x * W), sy: Math.round(y * H), sw: Math.max(1, Math.round(l * W)), sh: Math.max(1, Math.round(h * H)) };
}

/** Ajuste un cadre (geste « recadrer ») en le gardant dans l'image et d'au moins 10 % de côté. */
export function ajusterCadre(cadre, { dx = 0, dy = 0, dl = 0, dh = 0 } = {}) {
  const r = (v) => Math.round(v * 1000) / 1000;
  let l = Math.max(0.1, Math.min(1, (Number(cadre.l) || 1) + dl));
  let h = Math.max(0.1, Math.min(1, (Number(cadre.h) || 1) + dh));
  let x = Math.max(0, Math.min(1 - l, (Number(cadre.x) || 0) + dx));
  let y = Math.max(0, Math.min(1 - h, (Number(cadre.y) || 0) + dy));
  return { x: r(x), y: r(y), l: r(l), h: r(h) };
}
