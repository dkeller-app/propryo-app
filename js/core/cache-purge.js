// js/core/cache-purge.js — Décisions PURES de purge du cache client (P1.3, volet RGPD de
// l'AUDIT-SYNC-CLOUD-2026-07-12, cause C-C).
//
// Constat : en mode cloud, chaque saveDB écrit TOUT le DB dans le miroir localStorage `immotrack_v4`
// (filet de rollback) et les binaires vivent dans IndexedDB `immotrack_photos` — jamais purgés, ni au
// logout ni à la révocation → un membre révoqué gardait une copie lisible À VIE des données d'autrui
// (bug réel : Marion voyait Zito/Fric + le tableau gestionnaire après révocation).
//
// Ce module ne touche AUCUNE API navigateur : il classe (tag du miroir) et inventorie (binaires
// idb-only) ; l'EXÉCUTION (localStorage.removeItem / indexedDB.deleteDatabase) vit dans
// js/app/supabase-entry.js. Matrice de purge : cf. docs/superpowers/specs/
// 2026-07-13-sync-p13-rehydrate-realtime-purge-design.md §3b.

// Clé localStorage du tag posé au login : JSON { userId, espaceId } (espace PROPRE primaire).
// Permet, au login suivant, de savoir À QUI appartient le miroir résiduel.
export const MIRROR_TAG_KEY = 'immotrack_v4_tag'

// Tag à écrire au login (chaîne prête pour localStorage).
export const mirrorTag = (userId, espaceId) => JSON.stringify({ userId, espaceId })

// Classe le tag résiduel vs l'utilisateur/espace qui se connecte. Fail-safe : tout tag absent,
// corrompu ou incomplet → 'untagged' (on ne peut PAS prouver que le miroir est à autrui → on purge le
// miroir mais on ÉPARGNE IndexedDB, qui peut contenir les seuls exemplaires de preuves du même user).
// 'other-user' est le SEUL verdict qui autorise la purge inconditionnelle d'IndexedDB (données d'autrui).
export function classifyMirrorTag(raw, userId, espaceId) {
  if (!raw || typeof raw !== 'string') return 'untagged'
  let tag
  try { tag = JSON.parse(raw) } catch (_e) { return 'untagged' }
  if (!tag || typeof tag !== 'object' || !tag.userId || !tag.espaceId) return 'untagged'
  if (tag.userId !== userId) return 'other-user'
  if (tag.espaceId !== espaceId) return 'other-espace'
  return 'same'
}

// ── Token de session Supabase (BUG-LOGIN-DOUBLE) — clés localStorage à purger ─────────────────────
// persistSession:true (fix du double-login : la session survit aux reloads/onglets, standard SaaS) fait
// vivre le token dans localStorage sous une clé DÉTERMINISTE (storageKey EXPLICITE, cf. supabase-entry).
// Il DOIT partir au logout ET au changement de compte : un token valide laissé sur la machine est une
// aggravation RGPD au-delà du miroir de données (cause C-C). supabase-js écrit aussi, pendant un flux
// PKCE (Google SSO / reset), un `${storageKey}-code-verifier` transitoire → on purge les deux.
// Fail-safe : storageKey absent/non-chaîne → [] (rien à purger, jamais de throw).
// La clé elle-même vit ICI (source unique) : supabase-entry la passe au client, le registre du
// stockage local (js/core/stockage-local.js) la reconnaît comme jeton de session.
export const AUTH_STORAGE_KEY = 'immo-supabase-auth'
export function authStorageKeys(storageKey) {
  if (!storageKey || typeof storageKey !== 'string') return []
  return [storageKey, storageKey + '-code-verifier']
}

// ── Binaires « idb-only » : présents en IndexedDB SANS copie Supabase Storage ─────────────────────
// Tant que P2.4 (upload Storage systématique) n'est pas fait, 20/35 documents vivants n'existent QUE
// dans IndexedDB (forensique 12/07) : les purger = détruire des preuves légales (quittances, baux…).
// Règle gravée « pas d'auto-suppression : preuves légales » → la purge IndexedDB au logout n'est
// autorisée QUE si cet inventaire est vide. Prédicat aligné sur le rattrapage existant
// `_drvUploadPendingAttachments` (documents : idbKey && !cloudKey) et sur le périmètre photo de
// `_edlPreloadPhotos` (pièces E/S, clés E/S, compteurs, mobilier E/S).
const _idbOnly = ph => !!(ph && ph.idbKey && !ph.cloudKey)

export function listIdbOnlyBinaries(db) {
  const out = []
  const d = db || {}
  for (const doc of (Array.isArray(d.documents) ? d.documents : [])) {
    if (!doc || doc._deleted) continue
    if (_idbOnly(doc)) out.push({ kind: 'document', id: doc.id, idbKey: doc.idbKey })
  }
  for (const edl of (Array.isArray(d.edl) ? d.edl : [])) {
    if (!edl || edl._deleted) continue
    const push = ph => { if (_idbOnly(ph)) out.push({ kind: 'edl-photo', id: edl.id, idbKey: ph.idbKey }) }
    const each = arr => { if (Array.isArray(arr)) arr.forEach(push) }
    for (const p of (Array.isArray(edl.pieces) ? edl.pieces : [])) {
      if (!p) continue
      for (const x of (Array.isArray(p.elements) ? p.elements : [])) { if (x) { each(x.photosE); each(x.photosS) } }
    }
    for (const c of (Array.isArray(edl.cles) ? edl.cles : [])) { if (c) { each(c.photos); each(c.photosS) } }
    const cp = edl.compteursPhotos
    if (cp && typeof cp === 'object') for (const k of Object.keys(cp)) each(cp[k])
    const mob = edl.mobilier
    if (mob && Array.isArray(mob.elements)) for (const m of mob.elements) { if (m) { each(m.photosE); each(m.photosS) } }
  }
  return out
}
