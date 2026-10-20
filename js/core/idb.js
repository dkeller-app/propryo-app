/**
 * core/idb.js — Helpers IndexedDB pour stockage des photos EDL.
 *
 * Sprint 2 ARCHI-MODULAR Phase 1b.
 *
 * Le store IndexedDB stocke les photos EDL (entrées + sorties) en dataURL base64
 * pour éviter de gonfler localStorage (limite ~5 Mo navigateur). Les clés sont
 * générées via _idbKey() et stockées dans DB.edl[].pieces[].photos[] / compteurs.
 *
 * Pattern d'usage existant (inline) : photo upload → _idbPut(key, dataURL),
 * affichage → _idbGet(key) → résultat mis en cache mémoire _photoCache[key].
 */

export const _IDB_NAME = 'immotrack_photos';
export const _IDB_STORE = 'photos';

/** Cache mémoire dataURL, PROPRE à ce module.
 *  ⚠️ Le partage annoncé avec l'inline n'a jamais existé : `index.html:31685` déclare
 *  `let _photoCache = {}`, une liaison LEXICALE qui n'est PAS une propriété de `window`, et rien
 *  ne pose `window._photoCache`. La lecture ci-dessous rend donc toujours `{}` — même piège que
 *  `window.DB` (cf. `appDbFrom`, js/core/utils.js). Sans conséquence aujourd'hui : cet export
 *  n'est importé nulle part. On garde la lecture (elle marchera si l'inline expose un jour son
 *  cache) mais on cesse d'affirmer un partage qui n'a pas lieu. */
export const _photoCache = (typeof window !== 'undefined' && window._photoCache) || {};

/** Ouvre (ou crée) la DB et retourne l'instance IDBDatabase. */
export function _idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(_IDB_NAME, 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(_IDB_STORE);
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
  });
}

/** Stocke une dataURL sous une clé donnée. */
export function _idbPut(k, d) {
  return _idbOpen().then(db => new Promise((res, rej) => {
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).put(d, k);
    tx.oncomplete = res;
    tx.onerror = e => rej(e.target.error);
  }));
}

/** Récupère la dataURL d'une clé donnée (ou undefined si absent). */
export function _idbGet(k) {
  return _idbOpen().then(db => new Promise((res, rej) => {
    const tx = db.transaction(_IDB_STORE, 'readonly');
    const r = tx.objectStore(_IDB_STORE).get(k);
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e.target.error);
  }));
}

/** Supprime une entrée (idempotent — succès silencieux si absent). */
export function _idbDel(k) {
  return _idbOpen().then(db => new Promise((res, rej) => {
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).delete(k);
    tx.oncomplete = res;
    tx.onerror = () => res();
  }));
}

/** Génère une clé unique pour une nouvelle photo. */
export function _idbKey() {
  return 'ph_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}
