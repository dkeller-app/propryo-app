/**
 * js/core/audio-capture.js — ENREGISTREMENT DE LA DICTÉE (chantier EDL-VOIX-IA, lot B1) ET DE L'ÉTAT DES
 * LIEUX FILMÉ (EDL-VIDEO-IA : option `video`, caméra + micro).
 *
 * MediaRecorder, sans dépendance. Formats (relevé du 13/10) :
 *   - audio/webm;codecs=opus : Chrome, Android, Firefox, Safari ≥ 18.4 (iOS 18.4, mars 2025) ;
 *   - audio/mp4 (AAC)        : Safari 14.1 → 18.3 ;
 *   - repli final            : import d'un fichier audio (application Dictaphone du téléphone).
 * Toutes les dépendances navigateur sont injectées (tests sans navigateur).
 */

export const FORMATS_PREFERES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
export const DUREE_MAX_S = 300;   // 5 min par dictée (CDC §2) ; au-delà : arrêt, la dictée est gardée

export function captureDisponible(win) {
  try {
    return !!(win && win.MediaRecorder && win.navigator && win.navigator.mediaDevices && typeof win.navigator.mediaDevices.getUserMedia === 'function');
  } catch (_) { return false; }
}

export function choisirFormat(isTypeSupported) {
  if (typeof isTypeSupported !== 'function') return '';
  for (const f of FORMATS_PREFERES) { try { if (isTypeSupported(f)) return f; } catch (_) { /* suivant */ } }
  return '';   // le navigateur choisit
}

/** Type « nu » (sans codecs) envoyé au relais. */
export function typeNu(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase() || 'audio/webm';
}

// ── ÉTAT DES LIEUX FILMÉ (EDL-VIDEO-IA) — même enregistreur, mode vidéo ─────────────────────────────
// Décision 14/10 : 720p au plus, ~1 Mbit/s (~7,5 Mo/min), 3 min par prise. Formats (relevé du 14/10) :
//   video/webm (VP9/VP8 + Opus) : Chrome, Android, Safari >= 18.4 ; video/mp4 (H.264) : Safari 14.5 -> 18.3.
//   (MP4 de Chrome Android signalé instable : le WebM passe en premier.)
// Le SON part aussi dans un 2e enregistreur AUDIO sur le même flux : c'est lui que la dictée existante
// transcrit (le relais n'accepte que de l'audio ; la vidéo n'y va jamais).
export const FORMATS_VIDEO = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];
export const VIDEO_DEBIT = 1000000;
export const VIDEO_PRISE_MAX_S = 180;
export const CONTRAINTES_VIDEO = Object.freeze({
  audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  // Valeurs SOUHAITÉES seulement (jamais `max`) : en portrait, le téléphone tourne l'image (720×1280) et une
  // contrainte stricte ferait échouer la caméra. Le poids reste borné par le débit (VIDEO_DEBIT).
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
});
export function choisirFormatVideo(isTypeSupported) {
  if (typeof isTypeSupported !== 'function') return '';
  for (const f of FORMATS_VIDEO) { try { if (isTypeSupported(f)) return f; } catch (_) { /* suivant */ } }
  return '';
}
export function typeVideoNu(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase() || 'video/webm';
}
export function captureVideoDisponible(win) {
  return captureDisponible(win) && typeof (win && win.MediaStream) === 'function';
}
export function codeErreurCamera(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return 'camera_refusee';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError' || n === 'NotReadableError') return 'camera_absente';
  return 'capture';
}

export function codeErreurMicro(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') return 'micro_refuse';
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return 'micro_absent';
  return 'capture';
}

/**
 * @param {object} o
 * @param {Function} o.getUserMedia   (contraintes) => Promise<MediaStream>
 * @param {Function} o.MediaRecorder  constructeur
 * @param {Function} [o.maintenant]   () => ms
 * @param {number}   [o.maxSec]
 * @param {Function} [o.planifier]    (fn, ms) => id   (setInterval)
 * @param {Function} [o.annulerPlan]  (id) => void      (clearInterval)
 * @param {Function} [o.onTick]       (secondes) => void
 * @param {Function} [o.onMax]        () => void  — durée maximale atteinte (l'enregistrement s'arrête)
 * @param {boolean}  [o.video]        état des lieux filmé : caméra + micro, et un 2e enregistreur audio seul
 * @param {Function} [o.MediaStream]  constructeur (mode vidéo : flux audio seul pour la dictée)
 */
export function creerEnregistreur(o) {
  const now = o.maintenant || (() => Date.now());
  const video = !!o.video;
  const maxSec = o.maxSec || (video ? VIDEO_PRISE_MAX_S : DUREE_MAX_S);
  const planifier = o.planifier || ((fn, ms) => setInterval(fn, ms));
  const annulerPlan = o.annulerPlan || ((id) => clearInterval(id));
  let flux = null, rec = null, morceaux = [], etat = 'inactif', cumulMs = 0, depuis = 0, minuteur = null, mime = '';
  let recA = null, morceauxA = [], mimeA = '';   // mode vidéo : piste son seule, pour la dictée

  const secondes = () => Math.floor((cumulMs + (etat === 'enregistre' ? now() - depuis : 0)) / 1000);
  const couperFlux = () => { try { (flux && flux.getTracks ? flux.getTracks() : []).forEach((t) => t.stop()); } catch (_) { /* rien */ } flux = null; };
  const tic = () => {
    const s = secondes();
    try { o.onTick && o.onTick(s); } catch (_) { /* rien */ }
    if (s >= maxSec && etat === 'enregistre') { try { o.onMax && o.onMax(); } catch (_) { /* rien */ } }
  };

  return {
    get etat() { return etat; },
    get mime() { return mime; },
    get flux() { return flux; },
    secondes,
    /** Instant (s, au dixième) dans la prise, pauses exclues : horodate les images tirées de la vidéo. */
    instant() { return Math.round((cumulMs + (etat === 'enregistre' ? now() - depuis : 0)) / 100) / 10; },
    async demarrer() {
      if (etat !== 'inactif') return { ok: false, code: 'deja' };
      try {
        flux = await o.getUserMedia(video ? CONTRAINTES_VIDEO : { audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      } catch (e) { return { ok: false, code: video ? codeErreurCamera(e) : codeErreurMicro(e) }; }
      try {
        const sup = o.MediaRecorder.isTypeSupported && o.MediaRecorder.isTypeSupported.bind(o.MediaRecorder);
        if (video) {
          const choixV = choisirFormatVideo(sup);
          const optsV = { videoBitsPerSecond: VIDEO_DEBIT, audioBitsPerSecond: 64000 };
          rec = choixV ? new o.MediaRecorder(flux, { mimeType: choixV, ...optsV }) : new o.MediaRecorder(flux, optsV);
          mime = rec.mimeType || choixV || 'video/webm';
          // Piste son seule -> dictée (transcription). Échec = vidéo sans dictée (jamais bloquant).
          try {
            const pistesA = flux.getAudioTracks ? flux.getAudioTracks() : [];
            if (pistesA.length && o.MediaStream) {
              const choixA = choisirFormat(sup);
              const fa = new o.MediaStream(pistesA);
              recA = choixA ? new o.MediaRecorder(fa, { mimeType: choixA, audioBitsPerSecond: 32000 }) : new o.MediaRecorder(fa);
              mimeA = recA.mimeType || choixA || 'audio/webm';
              morceauxA = [];
              recA.ondataavailable = (ev) => { if (ev && ev.data && ev.data.size) morceauxA.push(ev.data); };
            }
          } catch (_) { recA = null; }
        } else {
          const choix = choisirFormat(sup);
          rec = choix ? new o.MediaRecorder(flux, { mimeType: choix, audioBitsPerSecond: 32000 }) : new o.MediaRecorder(flux);
          mime = rec.mimeType || choix || 'audio/webm';
        }
        morceaux = [];
        rec.ondataavailable = (ev) => { if (ev && ev.data && ev.data.size) morceaux.push(ev.data); };
        rec.start(1000);
        if (recA) { try { recA.start(1000); } catch (_) { recA = null; } }
      } catch (_) { couperFlux(); return { ok: false, code: 'capture' }; }
      etat = 'enregistre'; depuis = now(); cumulMs = 0;
      minuteur = planifier(tic, 500);
      return { ok: true, mime };
    },
    pause() {
      if (etat !== 'enregistre' || !rec) return false;
      try { rec.pause(); } catch (_) { return false; }
      if (recA) { try { recA.pause(); } catch (_) { /* rien */ } }
      cumulMs += now() - depuis; etat = 'pause'; tic();
      return true;
    },
    reprendre() {
      if (etat !== 'pause' || !rec) return false;
      try { rec.resume(); } catch (_) { return false; }
      if (recA) { try { recA.resume(); } catch (_) { /* rien */ } }
      depuis = now(); etat = 'enregistre';
      return true;
    },
    /** Arrête et rend { morceaux, mime, duree } (Blob construit par l'appelant). */
    arreter() {
      return new Promise((resolve) => {
        if (!rec || etat === 'inactif' || etat === 'fini') { resolve(null); return; }
        if (etat === 'enregistre') cumulMs += now() - depuis;
        etat = 'fini';
        if (minuteur != null) { annulerPlan(minuteur); minuteur = null; }
        const duree = Math.round(cumulMs / 1000);
        if (!video) {
          const fin = () => { couperFlux(); resolve({ morceaux: morceaux.slice(), mime: typeNu(mime), duree }); };
          try { rec.onstop = fin; rec.stop(); } catch (_) { fin(); }
          return;
        }
        // Vidéo : attendre les DEUX enregistreurs (le dernier morceau arrive avant onstop).
        let restants = recA ? 2 : 1;
        const fin = () => {
          if (--restants > 0) return;
          couperFlux();
          resolve({ morceaux: morceaux.slice(), mime: typeVideoNu(mime), duree, audio: recA && morceauxA.length ? { morceaux: morceauxA.slice(), mime: typeNu(mimeA) } : null });
        };
        // Garde-fou : un enregistreur déjà inactif n'appelle jamais onstop → on rend ce qu'on a après 4 s.
        const plan = setTimeout(() => { restants = 1; fin(); }, 4000);
        const finUne = () => { if (restants === 1) clearTimeout(plan); fin(); };
        try { rec.onstop = finUne; rec.stop(); } catch (_) { finUne(); }
        if (recA) { try { recA.onstop = finUne; recA.stop(); } catch (_) { finUne(); } }
      });
    },
    /** Abandon : rien n'est gardé. */
    annuler() {
      if (minuteur != null) { annulerPlan(minuteur); minuteur = null; }
      try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (_) { /* rien */ }
      try { if (recA && recA.state !== 'inactive') recA.stop(); } catch (_) { /* rien */ }
      morceaux = []; morceauxA = []; etat = 'fini'; couperFlux();
    },
  };
}
