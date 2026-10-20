/**
 * js/core/filets-migration.js — CDC-STOCKAGE lot 2 (docs/CDC-STOCKAGE.md §3.4, D2 C, G6).
 *
 * Le FILET AVANT MIGRATION : avant qu'une migration réécrive la base, une copie de la base telle
 * qu'elle était, pour pouvoir revenir en arrière si un défaut de la migration est découvert après
 * coup (le profil habituel : quelques jours plus tard, pas quelques secondes).
 *
 * Avant le lot 1, cette copie allait en localStorage, sans plafond ni purge : c'est la cause de
 * l'incident « Mémoire pleine » du 28/08. Elle va désormais dans la base IndexedDB EXISTANTE
 * `immotrack_backup`, store `handles` (celle de la sauvegarde de sécurité, qui y range `dirhandle`),
 * sans changement de version de base. Règles (D2 C) :
 *   - une copie par migration : `filet:<espace de noms>:<label>`, la suivante écrase la précédente ;
 *   - 3 copies au plus par espace de noms (prod `immotrack_v4`, sandbox `_test_immotrack_v4` : la
 *     sandbox ne peut pas évincer un filet de la prod) — les plus anciennes partent ;
 *   - 30 jours au plus : au-delà, retirée (au démarrage et à chaque nouveau filet) ;
 *   - retirées à la déconnexion et au changement d'utilisateur (S-7, RGPD), dans TOUS les espaces de
 *     noms — même règle que la purge des copies localStorage du lot 1 (`_test_*` compris) : sur un poste
 *     partagé, la sandbox peut porter des données réelles importées.
 * La copie de la base illisible (`corrompu:<clé>`, lot 1, écart 3 du pilotage) suit la même durée de
 * vie et la même purge. Rien d'autre du store n'est jamais touché (`dirhandle` en premier lieu).
 *
 * Aucune écriture localStorage ici (S-2, G6). La logique est testée contre un adaptateur en mémoire
 * ({ cles, lire, ecrire, supprimer }) ; l'adaptateur IndexedDB réel est en bas de ce fichier.
 */

export const FILET_IDB = 'immotrack_backup';
export const FILET_STORE = 'handles';
export const FILET_PREFIXE = 'filet:';
export const CORROMPU_PREFIXE = 'corrompu:';
export const FILETS_MAX = 3;
export const FILET_TTL_MS = 30 * 24 * 3600 * 1000;
/** Délai au-delà duquel une opération IndexedDB muette est traitée comme un refus (certains iOS). */
export const DELAI_MS = 3000;

export function cleFilet(ns, label) { return FILET_PREFIXE + String(ns) + ':' + String(label); }
export function estCleFilet(cle) { return typeof cle === 'string' && cle.startsWith(FILET_PREFIXE); }
/** Les entrées du store qui sont des copies de la base (filets + base illisible) — jamais `dirhandle`. */
export function estCopieDeBase(cle) {
  return typeof cle === 'string' && (cle.startsWith(FILET_PREFIXE) || cle.startsWith(CORROMPU_PREFIXE));
}

/** L'heure d'un enregistrement (ms), ou NaN si elle est absente ou illisible. */
export function heureDe(enr) {
  const at = enr && enr.at;
  if (typeof at === 'number') return Number.isFinite(at) ? at : NaN;
  if (typeof at === 'string') { const t = Date.parse(at); return Number.isNaN(t) ? NaN : t; }
  return NaN;
}

/**
 * Expirée ? Plus de 30 jours, ou une heure illisible (une copie dont on ne connaît pas l'âge ne peut
 * pas prouver qu'elle a moins de 30 jours ; c'est une copie de données personnelles), ou une heure
 * dans le futur au-delà de la durée de vie (horloge faussée : sans ça, elle ne partirait jamais).
 */
export function estExpiree(enr, maintenant, ttl = FILET_TTL_MS) {
  const t = heureDe(enr);
  if (Number.isNaN(t)) return true;
  return maintenant - t > ttl || t - maintenant > ttl;
}

/**
 * Décision PURE de rotation. `entrees` = [{ cle, enr, illue? }] du store (seules les copies de la base
 * sont considérées ; `illue` = lecture ratée → ni retirée, ni comptée). Rend les clés à supprimer :
 *   - toute copie expirée (tous espaces de noms) ;
 *   - pour l'espace de noms `ns` (s'il est donné), les filets au-delà des `max` plus récents.
 * `garder` : une clé à ne jamais retirer (le filet qu'on vient d'écrire).
 */
export function planRotation(entrees, { ns = null, maintenant, max = FILETS_MAX, ttl = FILET_TTL_MS, garder = null } = {}) {
  const aSupprimer = new Set();
  const vivants = [];
  const prefixeNs = ns == null ? null : FILET_PREFIXE + String(ns) + ':';
  for (const { cle, enr, illue } of entrees || []) {
    if (!estCopieDeBase(cle) || cle === garder) continue;
    // Lecture ratée (IndexedDB lent ou muet) : on ne sait rien de son âge — on ne la retire PAS sur une
    // erreur passagère (contre-audit lot 2) ; la passe suivante tranchera.
    if (illue) continue;
    if (estExpiree(enr, maintenant, ttl)) { aSupprimer.add(cle); continue; }
    if (prefixeNs && cle.startsWith(prefixeNs)) vivants.push({ cle, t: heureDe(enr) });
  }
  if (prefixeNs) {
    const place = Math.max(0, max - (garder && garder.startsWith(prefixeNs) ? 1 : 0));
    vivants.sort((a, b) => b.t - a.t || (a.cle < b.cle ? -1 : 1));
    vivants.slice(place).forEach(v => aSupprimer.add(v.cle));
  }
  return [...aSupprimer];
}

async function lireCopies(adaptateur) {
  const cles = (await adaptateur.cles()).filter(estCopieDeBase);
  const entrees = [];
  // Une à une : chaque copie peut peser plusieurs Mo, on ne les garde pas toutes en mémoire.
  for (const cle of cles) {
    let enr = null;
    try { enr = await adaptateur.lire(cle); }
    catch (_e) { entrees.push({ cle, enr: null, illue: true }); continue; }
    // Lue, mais VIDE (null, undefined, '') : ce n'est PAS une lecture ratée. Sans heure, elle est
    // expirée et part (estExpiree) — la marquer « illue » la garderait à vie (audit lots 2-3, M28).
    entrees.push({ cle, enr: enr ? { at: enr.at } : null });
  }
  return entrees;
}

async function supprimerToutes(adaptateur, cles) {
  const faites = [];
  for (const cle of cles) {
    try { await adaptateur.supprimer(cle); faites.push(cle); } catch (_e) { /* la suivante passe quand même */ }
  }
  return faites;
}

/**
 * Pose le filet `label` de l'espace de noms `ns`. `json` = la base sérialisée AU MOMENT DE L'APPEL
 * (l'appelant la fige de façon synchrone, avant que la migration ne la modifie). Écrit, PUIS fait la
 * rotation : un échec d'écriture ne retire aucun filet existant. Rend
 * { ok, cle, supprimees } — ne lève jamais (un filet ne bloque jamais une migration).
 */
export async function poserFilet(adaptateur, { ns, label, json, maintenant = Date.now() }) {
  const cle = cleFilet(ns, label);
  try {
    await adaptateur.ecrire(cle, { v: 1, label: String(label), ns: String(ns), at: maintenant, json: String(json) });
  } catch (erreur) {
    return { ok: false, cle, supprimees: [], erreur };
  }
  let supprimees = [];
  try {
    const plan = planRotation(await lireCopies(adaptateur), { ns, maintenant, garder: cle });
    supprimees = await supprimerToutes(adaptateur, plan);
  } catch (_e) { /* rotation au prochain démarrage */ }
  return { ok: true, cle, supprimees };
}

/** Passe de démarrage : retire les copies de plus de 30 jours (filets et base illisible). Ne lève jamais. */
export async function expirerCopies(adaptateur, { maintenant = Date.now() } = {}) {
  try {
    const plan = planRotation(await lireCopies(adaptateur), { maintenant });
    return await supprimerToutes(adaptateur, plan);
  } catch (_e) { return []; }
}

/** Purge RGPD (logout, changement d'utilisateur) : TOUTES les copies de la base, jamais le reste. Ne lève jamais. */
export async function purgerCopies(adaptateur) {
  try { return await supprimerToutes(adaptateur, (await adaptateur.cles()).filter(estCopieDeBase)); }
  catch (_e) { return []; }
}

/** Le contenu d'un filet, pour une restauration de support (procédure, sans UI dans ce chantier). */
export async function lireFilet(adaptateur, ns, label) {
  const enr = await adaptateur.lire(cleFilet(ns, label));
  return enr && typeof enr.json === 'string' ? enr : null;
}

// ── Adaptateur IndexedDB réel ────────────────────────────────────────────────────────────────

/**
 * La base `immotrack_backup` ouverte EXACTEMENT comme `_bkIdbOpen` (version 1, création du store
 * `handles` s'il manque) : l'ouvrir sans version créerait une base sans store, et la sauvegarde de
 * sécurité ne pourrait plus y ranger son dossier. Connexion ouverte à chaque opération et refermée
 * après (personne ne doit rester bloqué sur cette base). Chaque opération est bornée dans le temps.
 */
export function adaptateurIndexedDB(fabrique, { nom = FILET_IDB, store = FILET_STORE, delaiMs = DELAI_MS } = {}) {
  const ouvrir = () => new Promise((res, rej) => {
    let r;
    try { r = fabrique.open(nom, 1); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(store)) db.createObjectStore(store); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('indexeddb-erreur'));
    r.onblocked = () => rej(new Error('indexeddb-bloque'));
  });
  const operer = (mode, geste) => {
    let db = null;
    let minuterie;
    const travail = ouvrir().then(d => {
      db = d;
      return new Promise((res, rej) => {
        let t;
        try { t = mode === 'readwrite' ? d.transaction(store, mode, { durability: 'strict' }) : d.transaction(store, mode); }
        catch (_e) { t = d.transaction(store, mode); }
        let valeur;
        t.oncomplete = () => res(valeur);
        t.onerror = () => rej(t.error || new Error('indexeddb-transaction'));
        t.onabort = () => rej(t.error || new Error('indexeddb-abandon'));
        const req = geste(t.objectStore(store));
        if (req) req.onsuccess = () => { valeur = req.result; };
      });
    });
    const delai = new Promise((_r, rej) => { minuterie = setTimeout(() => rej(new Error('indexeddb-muet')), delaiMs); });
    return Promise.race([travail, delai]).finally(() => {
      clearTimeout(minuterie);
      // Fermée après la transaction (ou plus tard si elle répond après le délai).
      travail.then(() => { try { db && db.close(); } catch (_e) {} }, () => { try { db && db.close(); } catch (_e) {} });
    });
  };
  return {
    cles: () => operer('readonly', s => s.getAllKeys()).then(k => (Array.isArray(k) ? k : []).map(String)),
    lire: (cle) => operer('readonly', s => s.get(cle)),
    ecrire: (cle, enr) => operer('readwrite', s => s.put(enr, cle)),
    supprimer: (cle) => operer('readwrite', s => s.delete(cle)),
  };
}
