/**
 * js/core/ia-client.js — CLIENT DU SOCLE IA côté app (chantier EDL-VOIX-IA, lot B1).
 *
 * Parle aux routes du relais (/ai/status, /ai/transcribe, /ai/structure). Réutilisable tel quel par
 * les chantiers suivants (lecture des pièces de dossier, tri des photos d'incident) : seule la `task`
 * change. La clé du fournisseur n'est JAMAIS ici : le relais la détient (secret wrangler).
 *
 * Ne lève jamais : chaque appel rend { ok:true, … } ou { ok:false, code, motif? }.
 * Codes : offline · auth · quota · disabled · too_large · format · refused · invalid · unavailable · demo.
 * `fetchImpl`, `enLigne` et `demo` sont injectables (tests). COMPTE DÉMO (?demo=1, window.__immoDemo) : aucun appel,
 * code `demo` (non réessayable) et message clair — la démonstration n'a ni compte connecté ni relais.
 */

export const CODES_REESSAYABLES = new Set(['offline', 'unavailable', 'auth']);

export function codeDepuisReponse(status, body) {
  const e = body && body.error;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'quota';
  // 503 video_disabled = état des lieux filmé pas encore ouvert (interrupteur AI_VIDEO du relais).
  // 503 ocr_disabled = lecture des bulletins pas encore ouverte (interrupteur AI_OCR du relais, VERIF-DOCUMENTS).
  if (status === 404 || (status === 503 && (e === 'ai_disabled' || e === 'video_disabled' || e === 'ocr_disabled'))) return 'disabled';
  if (status === 413) return 'too_large';
  if (status === 415) return 'format';
  if (status === 422) return 'refused';
  if (status === 400) return e === 'audio_empty' ? 'vide' : 'invalid';
  return 'unavailable';
}

export function creerClientIA({ base, getToken, fetchImpl, enLigne, demo } = {}) {
  const f = fetchImpl || ((...a) => fetch(...a));
  const enDemo = typeof demo === 'boolean' ? demo : (typeof globalThis !== 'undefined' && globalThis.__immoDemo === true);
  const online = enLigne || (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const racine = String(base || '').replace(/\/+$/, '');

  async function appel(chemin, init = {}) {
    if (enDemo) return { ok: false, code: 'demo' };
    if (!racine) return { ok: false, code: 'disabled' };
    if (!online()) return { ok: false, code: 'offline' };
    let jeton = null;
    try { jeton = getToken ? await getToken() : null; } catch (_) { jeton = null; }
    if (!jeton) return { ok: false, code: 'auth' };
    let res;
    try {
      res = await f(racine + chemin, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${jeton}` } });
    } catch (_) {
      return { ok: false, code: online() ? 'unavailable' : 'offline' };
    }
    let body = null;
    try { body = await res.json(); } catch (_) { body = null; }
    // CONSO-IA : plafond MENSUEL de l'offre (429 motif « mois ») et part utilisée après un appel réussi (`conso`) sont
    // signalés à l'indicateur de l'app (js/app/conso-ia-app.js), qui met la fonction en pause ou avertit à 80 %.
    if (!res.ok) {
      const motif = body && body.motif;
      if (res.status === 429 && motif === 'mois') signaler({ famille: body.famille, pause: true, renouvellement: body.renouvellement });
      return { ok: false, code: codeDepuisReponse(res.status, body), motif, limites: body && body.limites, famille: body && body.famille, renouvellement: body && body.renouvellement };
    }
    if (body && body.conso && typeof body.conso === 'object') signaler({ famille: body.conso.famille, pct: body.conso.pct });
    return { ok: true, body: body || {} };
  }
  function signaler(x) {
    try { if (typeof globalThis !== 'undefined' && typeof globalThis.__iaConsoSignal === 'function') globalThis.__iaConsoSignal(x); } catch (_) { /* jamais bloquant */ }
  }

  return {
    async statut() {
      const r = await appel('/ai/status', { method: 'GET' });
      if (!r.ok) return r;
      // `video` : ce que le relais annonce pour l'état des lieux filmé (actif, taille max d'un fichier…).
      // Absent (relais d'avant) ou actif=false → la fonction « Filmer » reste masquée.
      const v = r.body.video && typeof r.body.video === 'object' ? r.body.video : null;
      return { ok: true, actif: !!r.body.actif, limites: r.body.limites || null, usageJour: r.body.usageJour || null,
        video: v ? { actif: v.actif === true, fichierMaxOctets: Number(v.fichierMaxOctets) || 0, priseMaxSec: Number(v.priseMaxSec) || 0, imagesParAppel: Number(v.imagesParAppel) || 8, imagesJour: Number(v.imagesJour) || 0 } : { actif: false },
        // `ocr` : lecture des bulletins de salaire (VERIF-DOCUMENTS) ; absent ou actif≠true → bouton masqué.
        ocr: { actif: !!(r.body.ocr && r.body.ocr.actif === true) } };
    },
    async transcrire(audio, { task = 'edl-piece', lang = 'fr', mime } = {}) {
      const type = String(mime || (audio && audio.type) || 'audio/webm');
      const r = await appel(`/ai/transcribe?lang=${encodeURIComponent(lang)}&task=${encodeURIComponent(task)}`, {
        method: 'POST', headers: { 'Content-Type': type }, body: audio,
      });
      if (!r.ok) return r;
      return { ok: true, text: String(r.body.text || ''), segments: Array.isArray(r.body.segments) ? r.body.segments : [], audioSec: Number(r.body.audioSec) || 0, modele: r.body.modele || '' };
    },
    async structurer(task, input) {
      const r = await appel('/ai/structure', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task, input }),
      });
      if (!r.ok) return r;
      return { ok: true, data: r.body.data, rejets: Number(r.body.rejets) || 0, modele: r.body.modele || '' };
    },
  };
}

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** « 2027-01-01 » → « 1er janvier » (CONSO-IA : date de reprise d'une fonction en pause). */
export function dateReprise(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? (Number(m[3]) === 1 ? '1er' : String(Number(m[3]))) + ' ' + MOIS_FR[Number(m[2]) - 1] : 'le mois prochain';
}

/** Message d'erreur affiché (ton neutre, M-13). `limites` = renvoyées par le relais en cas de quota. */
export function messageErreur(code, { motif, limites, renouvellement } = {}) {
  const minutes = limites && limites.audioSecJour ? Math.round(limites.audioSecJour / 60) : 60;
  // CONSO-IA : plafond MENSUEL de l'offre atteint — la fonction est en pause pour ce compte seulement.
  if (code === 'quota' && motif === 'mois') {
    return { titre: 'Dictée en pause jusqu’au ' + dateReprise(renouvellement), texte: 'Le plafond mensuel de dictée de l’offre est atteint. La dictée est gardée sur l’appareil et repartira seule ; la saisie à la main reste disponible pour toutes les pièces.', reessayable: false };
  }
  switch (code) {
    case 'offline': return { titre: 'Pas de réseau', texte: 'La dictée est gardée sur l’appareil. Elle sera analysée dès le retour du réseau.', reessayable: true };
    case 'auth': return { titre: 'Session à renouveler', texte: 'La connexion au compte a expiré. La dictée est gardée sur l’appareil et repartira après reconnexion.', reessayable: true };
    case 'quota': return { titre: 'Limite du jour atteinte', texte: motif === 'audio' ? `La dictée est limitée à ${minutes} minutes par jour et par compte. Elle sera de nouveau disponible demain.` : motif === 'images' ? 'L’analyse des images est limitée par jour et par compte. La vidéo est gardée ; les photos seront proposées demain, ou ajoutées à la main.' : 'Le nombre d’analyses du jour est atteint pour ce compte. La dictée sera de nouveau disponible demain.', reessayable: false };
    case 'demo': return { titre: 'Indisponible dans la démonstration', texte: 'L’analyse par l’IA passe par le relais sécurisé d’un compte connecté : elle est désactivée dans la démonstration et rien n’est envoyé.', reessayable: false };
    case 'disabled': return { titre: 'Dictée pas encore activée', texte: 'L’analyse de la dictée n’est pas encore ouverte sur ce compte.', reessayable: false };
    case 'too_large': return { titre: 'Enregistrement trop long', texte: 'Cet enregistrement dépasse la taille admise. Dicter la pièce en plusieurs fois.', reessayable: false };
    case 'format': return { titre: 'Format audio non reconnu', texte: 'Ce fichier n’est pas un enregistrement audio accepté (m4a, mp3, webm, ogg ou wav).', reessayable: false };
    case 'refused': return { titre: 'Enregistrement non lisible', texte: 'Le service n’a pas pu lire cet enregistrement. Dicter de nouveau, ou importer un autre fichier.', reessayable: false };
    case 'vide': return { titre: 'Aucune parole reconnue', texte: 'L’enregistrement semble vide ou trop bruité. Parler près du téléphone, puis recommencer.', reessayable: false };
    case 'invalid': return { titre: 'Analyse impossible', texte: 'La demande n’a pas pu être préparée pour cette pièce.', reessayable: false };
    default: return { titre: 'Analyse impossible pour le moment', texte: 'Le service d’analyse ne répond pas. La dictée est gardée sur l’appareil et repartira seule.', reessayable: true };
  }
}
