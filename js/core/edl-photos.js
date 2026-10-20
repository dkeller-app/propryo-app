/**
 * core/edl-photos.js — les photos de l'état des lieux (chantier EDL TERRAIN).
 *
 * CDC : docs/CDC-EDL.md §2 (photos) et §3bis (bug de production du 20/08).
 *
 * LOT 0 — invariants 22 et 34i : ouvrir un EDL ne doit plus monter TOUS les
 * binaires en mémoire. `_edlPreloadPhotos` (index.html) chargeait les 98 photos
 * de l'EDL F3 réel, soit ≈ 60 Mo de base64, avant même le premier rendu : iOS
 * décharge l'onglet sous pression mémoire et la visite en cours est perdue.
 * Le préchargement passe « à la demande » : seules les vignettes visibles sont
 * hydratées.
 *
 * Ce module ne connaît ni le DOM, ni IndexedDB, ni le réseau. Il répond à
 * « QUOI charger » ; l'inline garde le « COMMENT ».
 */

/** Les 8 emplacements de photos de compteurs (entrée + sortie). */
import { metaPhotoVideo } from './edl-video.js';

export const EDL_COMPTEUR_PHOTO_KEYS = ['elec', 'gaz', 'eauC', 'eauF', 'elecS', 'gazS', 'eauCS', 'eauFS'];

/* ══ LOT 3 ══════════════════════════════════════════════════════════════════
   Le calibre de la prise de vue, la sérialisation, et « à l'abri ».
   CDC §2 : le redimensionnement 1600 px / JPEG 0,8 n'est PAS rouvert — mais il
   était recopié à l'identique en CINQ endroits (le CDC en comptait quatre).
   ═══════════════════════════════════════════════════════════════════════════ */

/** Côté maximal d'une photo d'EDL. Calibre de preuve, non rouvert (CDC §2). */
export const PHOTO_MAX_PX = 1600;
/** Qualité JPEG. Même statut. */
export const PHOTO_QUALITE = 0.8;

/**
 * Les dimensions après redimensionnement, en préservant les proportions.
 * Une photo plus petite que le maximum n'est jamais AGRANDIE.
 */
export function dimensionsRedimensionnees(w, h, max = PHOTO_MAX_PX) {
  const lw = Number(w) || 0, lh = Number(h) || 0;
  if (lw <= 0 || lh <= 0) return { w: 0, h: 0 };
  if (lw <= max && lh <= max) return { w: lw, h: lh };
  return lw > lh
    ? { w: max, h: Math.round(lh * max / lw) }
    : { w: Math.round(lw * max / lh), h: max };
}

/**
 * La sérialisation d'une photo dans l'enregistrement d'EDL — SOURCE UNIQUE.
 *
 * Le bug qu'elle ferme : trois copies de ce mappage vivaient dans index.html
 * (deux `_phMeta` + `_edlCptPhMeta`) et AUCUNE ne recopiait `cloudKey`. Donc
 * chaque enregistrement effaçait la preuve que la photo était dans le cloud —
 * ce qui explique le constat du CDC : « 0 sur 182 avec un cloudKey ». La photo
 * repartait à l'envoi indéfiniment, et la relecture, faute de chemin, devinait
 * un chemin qui n'existe pas.
 */
export function metaPhoto(ph) {
  const p = ph || {};
  return {
    name: p.name || '',
    idbKey: p.idbKey || '',
    ts: p.ts || '',
    // Le SEUL juge de « à l'abri » (invariant 7) : il ne doit jamais se perdre.
    cloudKey: p.cloudKey || '',
    // Invariant 20 (retour Didier 27/08) : une photo dont le binaire local a disparu
    // (éviction stockage iOS) est marquée ICI pour être NOMMÉE à l'utilisateur (« à
    // reprendre ») au lieu de bloquer le compteur à N‑1 en silence. Doit survivre au save.
    binaireManquant: !!p.binaireManquant,
    // Compteur d'absences confirmées (anti-faux-positif, cf. decisionBinaireIntrouvable) — persisté.
    manqueVus: Math.max(0, (Number(p.manqueVus) | 0)),
    // Héritages Google Drive : conservés pour ne rien détruire, jamais lus.
    synced: !!p.synced,
    driveFileId: p.driveFileId || '',
    driveFileName: p.driveFileName || '',
    // EDL-VIDEO-IA : photo tirée d'une vidéo — prise, instant (s) et cadre. Preuve indexée : doit
    // survivre à chaque enregistrement (le PDF cite « vidéo Cuisine à 00:41 »).
    ...(metaPhotoVideo(p.video) ? { video: metaPhotoVideo(p.video) } : {}),
  };
}

/**
 * Invariant 7 : « une photo est à l'abri SI ET SEULEMENT SI elle porte un cloudKey ».
 * `synced` est un héritage de Drive : une photo `synced:true` SANS cloudKey était
 * exclue à vie de l'envoi par l'ancien filtre `!ph.synced`.
 */
export function estAlAbri(ph) {
  return !!(ph && ph.cloudKey);
}

/** Le compteur de l'en-tête : « 34 / 77 photos à l'abri ». */
export function compterAlAbri(photos) {
  const l = photos || [];
  const alAbri = l.filter(estAlAbri).length;
  return { total: l.length, alAbri, restantes: l.length - alAbri };
}

/**
 * Ce qu'il reste à envoyer : ce qui a un idbKey, pas encore de cloudKey, ET dont le binaire
 * local n'est pas déclaré perdu. On exclut `binaireManquant` sinon la photo se ré-enfile et se
 * re-jette à l'infini (boucle « 3/4 » éternelle) — elle relève de « à reprendre », pas d'un envoi.
 */
export function photosAEnvoyer(photos) {
  return (photos || []).filter(ph => ph && ph.idbKey && !estAlAbri(ph) && !ph.binaireManquant);
}

/** Nombre d'absences CONFIRMÉES (lecture IDB résolue à vide, pas un throw) avant de déclarer
 *  une photo « perdue ». Absorbe les faux négatifs iOS (le store renvoie parfois vide sous
 *  pression) : on ne condamne pas une preuve légale sur un seul incident. */
export const SEUIL_BINAIRE_MANQUANT = 3;

/**
 * Décision quand le binaire local est introuvable à l'envoi (audit 27/08, D-HAUTE).
 * On distingue une erreur TRANSITOIRE (la lecture IndexedDB a levé : iOS sous pression mémoire,
 * store fermé) d'une absence CONFIRMÉE (la lecture s'est résolue à vide). On ne déclare JAMAIS
 * une perte sur un throw, ni avant SEUIL absences confirmées — sinon on transforme un incident
 * réparable en abandon définitif (la photo étant exclue à vie de l'envoi une fois marquée).
 * @param {boolean} idbThrew        la lecture IDB a-t-elle levé (vs résolu à vide) ?
 * @param {number}  manqueVusAvant  absences confirmées déjà comptées
 * @returns {{action:'retry'|'compter'|'perdre', manqueVus:number}}
 *   retry   → transitoire : réessayer plus tard, ne rien marquer ;
 *   compter → absence confirmée mais sous le seuil : incrémenter, réessayer ;
 *   perdre  → seuil atteint : marquer binaireManquant (« à reprendre »).
 */
export function decisionBinaireIntrouvable(idbThrew, manqueVusAvant) {
  const avant = Math.max(0, (Number(manqueVusAvant) | 0));
  if (idbThrew) return { action: 'retry', manqueVus: avant };
  const n = avant + 1;
  if (n >= SEUIL_BINAIRE_MANQUANT) return { action: 'perdre', manqueVus: n };
  return { action: 'compter', manqueVus: n };
}

/**
 * État de sauvegarde cloud d'un EDL pour la LISTE — calme, JAMAIS de fraction anxiogène
 * (décision Didier 27/08). Quatre états seulement :
 *   - 'vide'       : aucune photo → rien à afficher ;
 *   - 'perte'      : ≥1 photo au binaire local perdu (à reprendre) → NOMMÉE, distincte ;
 *   - 'en-cours'   : il reste des photos à monter (binaires présents) → « sauvegarde en cours » ;
 *   - 'sauvegarde' : toutes les photos sont dans le cloud → « sauvegardé ».
 * `perdues` liste les objets photo perdus (pour les nommer). On ne montre jamais « X/Y ».
 */
export function etatSauvegarde(photos) {
  const l = photos || [];
  if (!l.length) return { statut: 'vide', total: 0, perdues: [], enAttente: 0 };
  const perdues = l.filter(ph => ph && ph.binaireManquant && !estAlAbri(ph));
  const enAttente = l.filter(ph => ph && ph.idbKey && !estAlAbri(ph) && !ph.binaireManquant).length;
  if (perdues.length) return { statut: 'perte', total: l.length, perdues, enAttente };
  if (enAttente > 0) return { statut: 'en-cours', total: l.length, perdues: [], enAttente };
  return { statut: 'sauvegarde', total: l.length, perdues: [], enAttente: 0 };
}

/**
 * Invariant 8 : le chemin lu à la relecture est CELUI écrit à l'envoi.
 * Sans cloudKey, on ne DEVINE pas : l'envoi écrit `<espace>/<entité>/files/<clé>`
 * et la devinette visait `<espace>/files/<clé>` — deux chemins qui ne se croisent
 * jamais, donc un 404 silencieux à chaque relecture.
 */
export function cheminRelecture(ph) {
  return estAlAbri(ph) ? ph.cloudKey : null;
}

/**
 * Invariant 12 : libérer les photos locales d'un EDL est IMPOSSIBLE tant qu'une
 * seule d'entre elles n'a pas de cloudKey — et on dit lesquelles manquent.
 * Invariant 11 : aucun chemin ne libère automatiquement ; cette fonction ne
 * libère rien, elle répond seulement « est-ce permis ».
 */
export function peutLibererLocal(photos) {
  const l = photos || [];
  const manquantes = l.filter(ph => !estAlAbri(ph));
  if (!l.length) return { peut: false, manquantes: [], motif: 'aucune-photo' };
  if (manquantes.length) return { peut: false, manquantes, motif: 'photos-hors-cloud' };
  return { peut: true, manquantes: [], motif: 'ok' };
}

function _push(out, seen, arr) {
  if (!Array.isArray(arr)) return;
  for (const ph of arr) {
    if (!ph || !ph.idbKey) continue;
    if (seen.has(ph.idbKey)) continue;
    seen.add(ph.idbKey);
    out.push(ph);
  }
}

/**
 * Collecte TOUTES les photos d'un enregistrement d'EDL, dédupliquées par idbKey.
 * Source unique : pièces (E + S), clés (E + S), compteurs (8 emplacements),
 * inventaire mobilier (E + S). Une photo sans `idbKey` n'est pas collectable.
 *
 * @param {object} edlRec
 * @returns {Array<object>} les objets photo eux-mêmes (idbKey, cloudKey, name…)
 */
export function collectEdlPhotos(edlRec) {
  const out = [];
  const seen = new Set();
  if (!edlRec || typeof edlRec !== 'object') return out;

  (edlRec.pieces || []).forEach(p => (p && p.elements || []).forEach(x => {
    if (!x) return;
    _push(out, seen, x.photosE);
    _push(out, seen, x.photosS);
  }));

  (edlRec.cles || []).forEach(c => {
    if (!c) return;
    _push(out, seen, c.photos);
    _push(out, seen, c.photosS);
  });

  const cpt = edlRec.compteursPhotos || {};
  EDL_COMPTEUR_PHOTO_KEYS.forEach(k => _push(out, seen, cpt[k]));
  // Le détecteur de fumée : ses photos vivent dans `daaf.photos` sur
  // l'enregistrement, mais dans `_edlCptPhotos.daaf` dans le formulaire.
  // Les deux comptent — sans ça, la photo du DAAF n'était ni comptée « à
  // l'abri », ni hydratée, ni envoyée.
  _push(out, seen, cpt.daaf);
  if (edlRec.daaf) _push(out, seen, edlRec.daaf.photos);

  const mob = (edlRec.mobilier && Array.isArray(edlRec.mobilier.elements)) ? edlRec.mobilier.elements : [];
  mob.forEach(m => {
    if (!m) return;
    _push(out, seen, m.photosE);
    _push(out, seen, m.photosS);
  });

  return out;
}

/** Libellés lisibles des 8 emplacements compteur + DAAF (pour la galerie et l'export). */
export const EDL_PHOTO_LABELS = {
  elec: 'Compteur élec. (entrée)', gaz: 'Compteur gaz (entrée)', eauC: 'Eau chaude (entrée)', eauF: 'Eau froide (entrée)',
  elecS: 'Compteur élec. (sortie)', gazS: 'Compteur gaz (sortie)', eauCS: 'Eau chaude (sortie)', eauFS: 'Eau froide (sortie)',
  daaf: 'Détecteur de fumée',
};

/**
 * Toutes les photos d'un EDL avec un LIBELLÉ lisible (pièce·élément·côté, compteur, DAAF, clé,
 * mobilier), dédupliquées par idbKey (premier libellé rencontré). Source unique pour la galerie
 * de consultation ET l'export mobile (factorisation de l'ancien inline de _edlSharePhotos).
 * @returns {Array<{ph:object, label:string}>}
 */
export function photosGalerie(edlRec) {
  const out = [];
  const seen = new Set();
  if (!edlRec || typeof edlRec !== 'object') return out;
  const add = (arr, label) => {
    if (!Array.isArray(arr)) return;
    for (const ph of arr) {
      if (!ph || !ph.idbKey || seen.has(ph.idbKey)) continue;
      seen.add(ph.idbKey);
      out.push({ ph, label });
    }
  };
  (edlRec.pieces || []).forEach(p => (p && p.elements || []).forEach(x => {
    if (!x) return;
    const base = ((p.nom || 'Pièce') + ' · ' + (x.nom || 'Élément'));
    add(x.photosE, base + ' · entrée');
    add(x.photosS, base + ' · sortie');
  }));
  (edlRec.cles || []).forEach((c, i) => {
    if (!c) return;
    const t = 'Clés' + (c.type ? ' ' + c.type : (i ? ' ' + (i + 1) : ''));
    add(c.photos, t + ' · entrée');
    add(c.photosS, t + ' · sortie');
  });
  const cpt = edlRec.compteursPhotos || {};
  EDL_COMPTEUR_PHOTO_KEYS.forEach(k => add(cpt[k], EDL_PHOTO_LABELS[k] || k));
  add(cpt.daaf, EDL_PHOTO_LABELS.daaf);
  if (edlRec.daaf) add(edlRec.daaf.photos, EDL_PHOTO_LABELS.daaf);
  const mob = (edlRec.mobilier && Array.isArray(edlRec.mobilier.elements)) ? edlRec.mobilier.elements : [];
  mob.forEach((m, i) => {
    if (!m) return;
    const t = 'Mobilier · ' + (m.nom || ('élément ' + (i + 1)));
    add(m.photosE, t + ' · entrée');
    add(m.photosS, t + ' · sortie');
  });
  return out;
}

/** Les clés IndexedDB de toutes les photos d'un EDL, dédupliquées. */
export function edlPhotoKeys(edlRec) {
  return collectEdlPhotos(edlRec).map(ph => ph.idbKey);
}

/** Index idbKey → objet photo (pour retrouver le cloudKey d'une vignette). */
export function photoIndexByKey(photos) {
  const idx = {};
  (photos || []).forEach(ph => { if (ph && ph.idbKey) idx[ph.idbKey] = ph; });
  return idx;
}

/**
 * Quelles vignettes sont « à l'écran », marge comprise, à partir de leurs
 * rectangles mesurés. Sert au premier rendu : on n'attend pas la première
 * notification de l'IntersectionObserver pour montrer ce qui est déjà visible.
 *
 * @param {Array<{idbKey:string, top:number, bottom:number}>} rects
 * @param {{viewportHeight?:number, margin?:number}} [opt]
 * @returns {Array<string>} les idbKey dans la bande visible
 */
export function keysInViewband(rects, { viewportHeight = 0, margin = 300 } = {}) {
  const out = [];
  for (const r of rects || []) {
    if (!r || !r.idbKey) continue;
    // Rectangle plat = élément sans boîte de rendu (modale pas encore affichée) :
    // NON mesurable, donc pas « visible ». Sans ce garde-fou, les 77 vignettes
    // d'un EDL réel tombent toutes dans la bande (0 > -300 et 0 < h+300) et on
    // recharge tout — exactement le défaut que le lot 0 supprime.
    if (!(r.bottom > r.top)) continue;
    if (r.bottom > -margin && r.top < viewportHeight + margin) out.push(r.idbKey);
  }
  return out;
}

/**
 * QUOI hydrater maintenant : les photos demandées (= vignettes visibles) qui ne
 * sont pas déjà en mémoire. Rien d'autre. Aucune photo hors de `visibleKeys`
 * ne peut sortir d'ici — c'est ce qui rend l'invariant 34i vrai.
 *
 * @param {{photos?:Array<object>, visibleKeys?:Array<string>|Set<string>, cache?:object}} arg
 * @returns {Array<object>} sous-ensemble de `photos`, sans doublon, ordre d'entrée
 */
export function photosToHydrate({ photos = [], visibleKeys = [], cache = {} } = {}) {
  const wanted = visibleKeys instanceof Set ? visibleKeys : new Set(visibleKeys || []);
  const done = new Set();
  const out = [];
  for (const ph of photos || []) {
    if (!ph || !ph.idbKey) continue;
    if (!wanted.has(ph.idbKey)) continue;
    if (cache && cache[ph.idbKey]) continue;
    if (done.has(ph.idbKey)) continue;
    done.add(ph.idbKey);
    out.push(ph);
  }
  return out;
}
