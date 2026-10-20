// js/core/lecture-photo-client.js — LECTURE-PHOTOS (v15.751 provisoire) : client du lecteur de photos.
// La lecture (lecture-photo.js, plusieurs secondes sur un téléphone) tourne dans un Worker de module
// (lecture-photo-worker.js) pour ne pas figer l'écran ; repli sur le fil principal si le navigateur ne sait pas créer
// ce Worker ; délai au bout duquel la page reprend la main (null). Utilisé par l'app (vérification des pièces) et par la
// page publique de dépôt (contrôle immédiat, copie dans relay/public/vendor). Testé par lecture-photo-client.test.js.
import { versGris } from './lecture-photo.js';

/**
 * @param {{creerWorker?:()=>Worker, repli?:(g:{w,h,d}, opts:object)=>Promise<{texte,etape,essais,nettete?}>, delaiMs?:number}} deps
 * @returns {{lire:(g:{w,h,d:Uint8Array}, opts?:object)=>Promise<{texte:string|null, etape?:string|null, essais?:number, nettete?:number|null,
 *   delai?:boolean, interrompu?:boolean, indisponible?:boolean}>, fermer:()=>void}}
 *   delai : pas de réponse à temps (le Worker est alors arrêté puis recréé à la lecture suivante) ; interrompu : la lecture
 *   s'est arrêtée faute de temps ; indisponible : aucune lecture possible (ni Worker ni repli). Dans ces trois cas, « pas
 *   de code » ne veut PAS dire « aucun code sur la pièce ».
 */
export function clientLecturePhoto({ creerWorker, repli, delaiMs = 60000 } = {}) {
  let w = null, hs = false, seq = 0;
  const attente = new Map();
  const RIEN = { texte: null, etape: null, essais: 0, indisponible: true };
  const viaRepli = async (g, opts) => { if (!repli) return { ...RIEN }; try { return await repli(g, opts); } catch { return { ...RIEN }; } };
  // Délai dépassé : le Worker est arrêté (travail orphelin) et les autres lectures en cours rendues « délai » ; un nouveau
  // Worker sera créé à la lecture suivante (ce n'est pas une panne : pas de passage au repli).
  const relancer = () => {
    try { if (w) w.terminate(); } catch { /* rien */ } w = null;
    const enCours = [...attente.values()]; attente.clear(); for (const a of enCours) a.rendre({ texte: null, etape: null, essais: 0, delai: true });
  };
  const casser = () => {
    hs = true; try { if (w) w.terminate(); } catch { /* rien */ } w = null;
    const enCours = [...attente.values()]; attente.clear(); for (const a of enCours) a.basculer();
  };
  const worker = () => {
    if (hs || !creerWorker) return null;
    if (w) return w;
    try {
      w = creerWorker();
      w.onmessage = (e) => { const d = (e && e.data) || {}; const a = attente.get(d.id); if (!a) return; attente.delete(d.id);
        a.rendre(d.erreur ? { texte: null, etape: null, essais: d.essais || 0, interrompu: true } : { texte: d.texte || null, etape: d.etape || null, essais: d.essais || 0, interrompu: !!d.interrompu, nettete: d.nettete == null ? null : d.nettete }); };
      w.onerror = () => casser();
      w.onmessageerror = () => casser();
    } catch { hs = true; w = null; }
    return w;
  };
  return {
    lire(g, opts = {}) {
      const ww = worker();
      if (!ww) return viaRepli(g, opts);
      return new Promise((resoudre) => {
        const id = ++seq;
        // opts.attenteMs : attente propre à cette lecture (temps restant de l'appelant + marge), sinon delaiMs
        const t = setTimeout(() => { attente.delete(id); resoudre({ texte: null, etape: null, essais: 0, delai: true }); relancer(); }, opts.attenteMs || delaiMs);
        attente.set(id, {
          rendre: (v) => { clearTimeout(t); resoudre(v); },
          basculer: () => { clearTimeout(t); viaRepli(g, opts).then(resoudre); }
        });
        const copie = g.d.slice();                       // l'image de l'appelant reste intacte ; la copie est transférée
        try { ww.postMessage({ id, w: g.w, h: g.h, gris: copie.buffer, opts }, [copie.buffer]); }
        catch { attente.delete(id); clearTimeout(t); casser(); viaRepli(g, opts).then(resoudre); }
      });
    },
    fermer() { const enCours = [...attente.values()]; attente.clear(); for (const a of enCours) a.rendre({ texte: null, etape: null, essais: 0 }); try { if (w) w.terminate(); } catch { /* rien */ } w = null; }
  };
}

/**
 * Image décodée (ImageBitmap, <img>, <video>, canvas) → niveaux de gris, réduite à `max` px de côté, sur fond blanc.
 * @param {CanvasImageSource} source
 * @param {(w:number,h:number)=>HTMLCanvasElement|OffscreenCanvas} creerCanvas
 */
export function sourceVersGris(source, largeur, hauteur, creerCanvas, max = 3000) {
  const k = Math.min(1, max / Math.max(largeur, hauteur));
  const w = Math.max(1, Math.round(largeur * k)), h = Math.max(1, Math.round(hauteur * k));
  const c = creerCanvas(w, h), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(source, 0, 0, w, h);
  return versGris(ctx.getImageData(0, 0, w, h).data, w, h);
}
