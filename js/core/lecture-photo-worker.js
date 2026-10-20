// js/core/lecture-photo-worker.js — LECTURE-PHOTOS (v15.751 provisoire) : Worker de MODULE qui lit le code 2D-Doc d'une
// photo hors du fil de l'écran. Chargé depuis un fichier du site (worker-src 'self', CSP inchangée) ; reçoit des niveaux
// de gris {id, w, h, gris:ArrayBuffer, opts}, rend {id, texte, etape, essais, interrompu, nettete}. Aucune requête réseau.
// Le lecteur vendorisé est un UMD : importé comme module, il pose globalThis.ZXing.
import * as Z from '../vendor/zxing-library-0.21.3.min.js';
import { lirePhoto, lecteurZxing, nettete } from './lecture-photo.js';

const ZX = globalThis.ZXing || (Z && Z.MultiFormatReader ? Z : Z && Z.default);
const lire = lecteurZxing(ZX);

self.onmessage = async (e) => {
  const { id, w, h, gris, opts } = e.data || {};
  try {
    const g = { w, h, d: new Uint8Array(gris) };
    const o = opts || {};
    const r = await lirePhoto(g, lire, { essais: o.essais, delaiMs: o.delaiMs, rapide: !!o.rapide });
    self.postMessage({ id, texte: r.texte, etape: r.etape, essais: r.essais, interrompu: !!r.interrompu, nettete: o.nettete ? nettete(g) : null });
  } catch (err) {
    self.postMessage({ id, erreur: String((err && err.message) || err).slice(0, 200) });
  }
};
