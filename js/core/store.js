// js/core/store.js — Couche de persistance UNIQUE (seam).
//
// P1 : adossée au backend localStorage actuel → comportement STRICTEMENT identique à
//   saveDB()/initDB() (cf. index.html). DB (objet global) reste le cache synchrone : les
//   lectures UI (DB.xxx) ne passent PAS par ici. Ce module n'est que la frontière de
//   persistance (hydratation + écriture) + une API par collection.
// P3 : le `backend` deviendra Supabase et upsert/remove écriront par ligne (concurrence
//   `version`, Realtime). Les appelants (saveDB, save<X>) ne changeront pas.
//
// Dépendances INJECTÉES (backend, key, hooks) → testable hors navigateur (Vitest).

export function createStore({ backend, key, hooks = {}, serialize = JSON.stringify, deserialize = JSON.parse }) {
  if (!backend || typeof backend.getItem !== 'function' || typeof backend.setItem !== 'function')
    throw new Error('createStore: backend { getItem, setItem } requis')
  if (!key) throw new Error('createStore: key requise')

  const noop = () => {}
  const onUndoBefore = hooks.onUndoBefore || noop   // _undoOnSaveDB()
  const onAuditFlush = hooks.onAuditFlush || noop   // _auditFlushPending()
  const onDirty = hooks.onDirty || noop             // _markDriveDirty()
  const onUndoAfter = hooks.onUndoAfter || noop     // _undoOnSaveDBSuccess()
  const onQuotaError = hooks.onQuotaError || noop   // toast "stockage plein"

  // Référence au cache DB courant (fournie par l'app via attach(DB) au boot).
  let db = null
  function attach(currentDb) { db = currentDb; return db }
  function current() { return db }

  // Hydratation : lit le backend → objet (ou null si absent / illisible). Les valeurs
  // par défaut + migrations restent dans initDB() (qui appellera hydrate() puis complètera).
  function hydrate() {
    const raw = backend.getItem(key)
    if (raw == null) return null
    try { return deserialize(raw) } catch (_) { return null }
  }

  // Persistance : reproduit EXACTEMENT l'ordre des effets de saveDB()
  // (index.html : undoBefore → auditFlush → setItem → markDirty → undoAfter ; quota capturé).
  function persist(currentDb) {
    const target = currentDb !== undefined ? currentDb : db
    onUndoBefore()
    onAuditFlush()
    try {
      backend.setItem(key, serialize(target))
    } catch (e) {
      onQuotaError(e)
    }
    onDirty()
    onUndoAfter()
    return true
  }

  // ── API par collection ───────────────────────────────────────────────────────
  // P1 : mute le cache DB (forme legacy) + persiste. P3 : écrira la ligne dans Supabase.
  function _coll(collection) {
    if (!db) throw new Error('Store: aucun DB attaché — appeler attach(DB) au boot')
    return db[collection]
  }

  function upsert(collection, record) {
    const coll = _coll(collection)
    if (Array.isArray(coll)) {
      const i = coll.findIndex(r => r && String(r.id) === String(record.id))
      if (i >= 0) coll[i] = record; else coll.push(record)
    } else if (coll && typeof coll === 'object') {
      // collection map keyée (ex. baux[ref]) : clé = record.__key sinon record.ref
      const k = record.__key != null ? record.__key : record.ref
      if (k == null) throw new Error('Store.upsert: clé manquante pour la map ' + collection)
      coll[k] = record
    } else {
      throw new Error('Store.upsert: collection inconnue ' + collection)
    }
    persist()
    return record
  }

  function remove(collection, id, { tombstone = true, preserve = {} } = {}) {
    const coll = _coll(collection)
    const now = new Date().toISOString()
    const stamp = Object.assign({ _deleted: true, _deletedAt: now, _modifiedAt: now }, preserve)
    if (Array.isArray(coll)) {
      const i = coll.findIndex(r => r && String(r.id) === String(id))
      if (i < 0) return
      if (tombstone) coll[i] = Object.assign({}, coll[i], stamp); else coll.splice(i, 1)
    } else if (coll && typeof coll === 'object') {
      if (!(id in coll)) return
      if (tombstone) coll[id] = Object.assign({}, coll[id], stamp); else delete coll[id]
    } else {
      throw new Error('Store.remove: collection inconnue ' + collection)
    }
    persist()
  }

  return { hydrate, persist, upsert, remove, attach, current }
}
