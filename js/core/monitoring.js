/**
 * core/monitoring.js — Capture erreurs JS + métriques anonymes (Sprint 4C).
 *
 * V1 commerciale a besoin de monitoring pour comprendre les régressions chez
 * les premiers utilisateurs. Plutôt qu'embarquer Sentry (~30 KB + transferts
 * vers servers Sentry → sujet RGPD), on implémente un capture local + buffer
 * exportable vers Drive (RGPD-friendly).
 *
 * Politique :
 *   - Capture window.onerror + window.onunhandledrejection
 *   - Buffer dans DB.errorLog[] (cap soft 200 entrées)
 *   - DÉSACTIVÉ par défaut tant que DB.params.monitoringEnabled ≠ true
 *   - Métriques anonymes (pas de PII, pas d'IP, pas de userAgent en clair → hash)
 *
 * L'eventLog reste LOCAL. Le forward HTTP externe (plausible.io) a été RETIRÉ (AUDIT-C1 :
 * règle « aucun endpoint externe au runtime » + RGPD) ; un forward first-party (domaine Propryo)
 * pourra être ajouté explicitement le moment venu.
 */

// Le lecteur du DB VIVANT (getter `window.__immoGetDB`, repli sur le miroir) — jamais `window.DB`
// nu : ce miroir est absent en session locale / sandbox et périmé après réassignation de `DB`.
// Correction de MÉCANISME, pas de symptôme observé : `params.monitoringEnabled` n'est écrit NULLE
// PART dans le dépôt (trois sites le lisent, aucun ne l'active), donc ce module ne journalise rien
// aujourd'hui. Le jour où un écran l'activera, il écrira dans le bon état.
import { appDbFrom } from './utils.js';

/** Le DB vivant de l'app, ou null. */
function _db() {
  return appDbFrom(typeof window !== 'undefined' ? window : null);
}

/** Hash léger (FNV-1a) pour anonymiser userAgent / pathname. */
function _hashFNV(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/** Capture une erreur dans le buffer monitoring. */
export function _logError(error, context = {}) {
  if (typeof window === 'undefined') return null;
  const db = _db();
  if (!db || !db.params || db.params.monitoringEnabled !== true) return null;

  // navigator/location optionnels (peuvent être absents en Node test)
  const pathStr = (typeof location !== 'undefined' && location && location.pathname) ? String(location.pathname) : '';
  const uaStr = (typeof navigator !== 'undefined' && navigator && navigator.userAgent) ? String(navigator.userAgent).slice(0, 200) : '';
  const entry = {
    ts: new Date().toISOString(),
    message: String(error?.message || error || 'unknown').slice(0, 500),
    stack: String(error?.stack || '').slice(0, 1500),
    file: context.filename || '',
    line: context.lineno || 0,
    col: context.colno || 0,
    type: context.type || 'error',
    // Anonymisation : pas d'URL absolue, juste le hash + path relatif
    pathHash: _hashFNV(pathStr),
    uaHash: _hashFNV(uaStr)
  };

  if (!db.errorLog) db.errorLog = [];
  db.errorLog.push(entry);

  // Cap soft 200 entrées (~50 KB max)
  if (db.errorLog.length > 200) {
    db.errorLog = db.errorLog.slice(-100);
  }

  // Si DSN externe configuré, on envoie en best-effort (pas d'attente)
  if (db.params.sentryDsn) {
    try {
      fetch(db.params.sentryDsn, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
        keepalive: true
      }).catch(() => {}); // silent fail
    } catch(_) {}
  }

  return entry;
}

/** Compte simple événement (page view, action métier). */
export function _logEvent(name, properties = {}) {
  if (typeof window === 'undefined') return null;
  const db = _db();
  if (!db || !db.params || db.params.monitoringEnabled !== true) return null;

  const pathStr = (typeof location !== 'undefined' && location && location.pathname) ? String(location.pathname) : '';
  const entry = {
    ts: new Date().toISOString(),
    name: String(name || '').slice(0, 100),
    props: properties,
    pathHash: _hashFNV(pathStr)
  };

  if (!db.eventLog) db.eventLog = [];
  db.eventLog.push(entry);

  if (db.eventLog.length > 500) {
    db.eventLog = db.eventLog.slice(-250);
  }

  // AUDIT-C1 — beacon externe plausible.io RETIRÉ : viole la règle « aucun endpoint externe au
  // runtime » + enjeu RGPD (exfiltration url/props vers un tiers sans consentement). L'eventLog
  // reste LOCAL ; un forward first-party (domaine Propryo) pourra être ajouté explicitement plus tard.

  return entry;
}

/** Active la capture globale d'erreurs (à appeler au boot si user opt-in). */
export function _installGlobalCapture() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', e => {
    _logError(e.error || e.message, {
      filename: e.filename, lineno: e.lineno, colno: e.colno, type: 'window.error'
    });
  });

  window.addEventListener('unhandledrejection', e => {
    _logError(e.reason, { type: 'unhandledrejection' });
  });
}

/** Exporte les logs en JSON pour analyse offline (user-controlled). */
export function _exportMonitoringLogs(db) {
  if (!db) return JSON.stringify({ errorLog: [], eventLog: [] }, null, 2);
  return JSON.stringify({
    _meta: { app: 'Propryo', exportedAt: new Date().toISOString() },
    errorLog: db.errorLog || [],
    eventLog: db.eventLog || []
  }, null, 2);
}

/** Reset des logs (pour user qui veut tout effacer). */
export function _clearMonitoringLogs(db) {
  if (!db) return { cleared: 0 };
  const total = (db.errorLog?.length || 0) + (db.eventLog?.length || 0);
  db.errorLog = [];
  db.eventLog = [];
  return { cleared: total };
}
