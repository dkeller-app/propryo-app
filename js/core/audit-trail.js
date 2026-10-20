/**
 * core/audit-trail.js — Journal des modifications (qui / quand / quoi).
 *
 * Sprint 3A AUDIT-TRAIL (V1.1 P0 selon BIZPLAN.md).
 *
 * Pré-requis CRG + RGPD :
 *   - CRG (Compte Rendu de Gestion mandataire) requiert traçabilité des actions
 *     sur les baux, mouvements financiers et quittances.
 *   - RGPD article 30 : registre des traitements de données personnelles
 *     (création/modification/suppression de personnes physiques tracées).
 *
 * Architecture data :
 *   DB.auditTrail = [ {ts, userId, userName, action, entityType, entityId,
 *                       entityRef, diff?, source?} ]
 *
 *   - ts : ISO 8601 (new Date().toISOString())
 *   - userId : DB.params.userId (généré au boot si absent)
 *   - userName : DB.params.userName (renseigné dans Paramètres)
 *   - action : 'create' | 'update' | 'delete' | 'restore'
 *   - entityType : 'entite' | 'logement' | 'bail' | 'mouvement' | 'quittance' |
 *                  'assurance' | 'mrh' | 'edl' | 'irl' | 'document'
 *   - entityId : id numérique ou string
 *   - entityRef : ref user-facing (ex 'F-001', 'SCI Dupont Immobilier')
 *   - diff : objet partiel avec changes (optionnel pour 'update')
 *   - source : 'ui' | 'drive_sync' | 'import' | 'migration' (défaut 'ui')
 *
 * Politique de rétention :
 *   - Pas de purge automatique pour V1 (sera ajoutée si volume > 10k entrées
 *     persistées au boot — limite localStorage ~5 Mo).
 *   - L'utilisateur peut purger manuellement via UI Paramètres.
 *
 * Sync Drive :
 *   - DB.auditTrail est embarqué dans le payload sync standard (timestamp-aware).
 *   - Pas de merge intelligent : on prend l'union des entrées (toutes les
 *     entrées ont un ts immuable → pas de conflit possible).
 */

/** Crée une nouvelle entrée audit, sans la persister (caller doit push dans DB.auditTrail + saveDB). */
import { _csvCell } from './export-comptable.js';
// Le lecteur du DB VIVANT (getter `window.__immoGetDB`, repli sur le miroir) — jamais `window.DB` nu.
import { appDbFrom } from './utils.js';

export function _auditEntry({ action, entityType, entityId, entityRef, diff, source = 'ui' } = {}) {
  if (!action || !entityType) {
    throw new Error('_auditEntry: action et entityType obligatoires');
  }
  return {
    ts: new Date().toISOString(),
    userId: _getCurrentUserId(),
    userName: _getCurrentUserName(),
    action,
    entityType,
    entityId: entityId != null ? entityId : null,
    entityRef: entityRef != null ? String(entityRef) : null,
    ...(diff ? { diff } : {}),
    source
  };
}

/** Calcule un diff superficiel entre 2 objets (clés modifiées + ancienne/nouvelle valeur).
 *  Limite à 20 clés pour ne pas exploser le size si entité massive (bail avec sigs). */
export function _diffShallow(before, after, maxKeys = 20) {
  const diff = {};
  if (!before || !after) return diff;
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let n = 0;
  for (const k of allKeys) {
    if (k.startsWith('_')) continue; // skip champs internes (_modifiedAt, _deleted, etc.)
    if (k === 'signatures' || k === 'photos') continue; // skip champs binaires lourds
    const b = before[k];
    const a = after[k];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    diff[k] = { from: _truncate(b), to: _truncate(a) };
    n++;
    if (n >= maxKeys) { diff.__truncated = true; break; }
  }
  return diff;
}

/** Tronque une valeur pour le log (évite de logger des dataURL de 500 KB). */
function _truncate(v) {
  if (typeof v === 'string' && v.length > 200) return v.slice(0, 200) + '…(' + v.length + ' chars)';
  if (typeof v === 'object' && v !== null) {
    const s = JSON.stringify(v);
    if (s.length > 500) return '[Object, ' + s.length + ' chars]';
  }
  return v;
}

/** Le DB VIVANT de l'app. `window.DB` n'est qu'un miroir posé par `__immoSetDB` (cloud,
 *  post-hydratation) : absent en session locale / sandbox, périmé après réassignation de `DB`.
 *  Lu tel quel, l'auteur de chaque entrée d'audit retombait sur « anonymous » / « Utilisateur »,
 *  et l'`userId` généré en repli n'était jamais persisté (il repartait de zéro à chaque appel). */
function _db() {
  return appDbFrom(typeof window !== 'undefined' ? window : null);
}

/** Récupère l'userId actuel (génère + persiste si absent). Source : DB.params.userId. */
function _getCurrentUserId() {
  const db = _db();
  if (!db || !db.params) return 'anonymous';
  if (!db.params.userId) {
    db.params.userId = 'usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }
  return db.params.userId;
}

/** Récupère le nom utilisateur (DB.params.userName ou 'Utilisateur'). */
function _getCurrentUserName() {
  const db = _db();
  return (db && db.params && db.params.userName) ? String(db.params.userName).trim() : 'Utilisateur';
}

/** Filtre les entrées par fenêtre temporelle + type entité + action. */
export function _auditFilter(entries, { from, to, entityType, action, userId } = {}) {
  if (!Array.isArray(entries)) return [];
  return entries.filter(e => {
    if (from && e.ts < from) return false;
    if (to && e.ts > to) return false;
    if (entityType && e.entityType !== entityType) return false;
    if (action && e.action !== action) return false;
    if (userId && e.userId !== userId) return false;
    return true;
  });
}

/** Export CSV des entrées d'audit. */
export function _auditToCsv(entries) {
  const headers = ['ts', 'userId', 'userName', 'action', 'entityType', 'entityId', 'entityRef', 'source', 'diff'];
  const rows = (entries || []).map(e => [
    e.ts || '',
    e.userId || '',
    e.userName || '',
    e.action || '',
    e.entityType || '',
    e.entityId != null ? String(e.entityId) : '',
    e.entityRef || '',
    e.source || '',
    e.diff ? JSON.stringify(e.diff) : ''
  ]);
  const escape = _csvCell;   // DRY : garde anti-formule CSV unique (export-comptable.js)
  return [headers.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
}

/** Cleanup défensif : supprime les entrées corrompues (sans ts ou action). */
export function _auditClean(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.filter(e => e && typeof e === 'object' && e.ts && e.action && e.entityType);
}
