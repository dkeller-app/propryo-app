/**
 * core/attachments.js — Système unifié de pièces jointes (Phase 1 v14.99).
 *
 * Sprint 5A — BUG-PJ-LOCALSTORAGE (P1 V1).
 *
 * Architecture 3 tiers :
 *   - localStorage (DB.documents[]) : métadonnées légères (id, parentType,
 *     parentId, logRef, category, idbKey, driveFileId, name, mime, size, ts).
 *   - IndexedDB : cache binaire local par idbKey (cf core/idb.js).
 *   - Google Drive : source canonique long-terme (cf _drvUploadDoc v14.35).
 *
 * Ce module fournit des helpers PURS (pas de DOM, pas de DB globale touchée).
 * Les fonctions inline dans index-test.html consomment ces helpers + accèdent
 * à DB / IDB / Drive directement (effets de bord).
 *
 * Pattern de filiation :
 *   - parentType : 'mouvement' | 'travaux' | 'logement' | 'bail' | 'edl' |
 *                  'assurance' | 'mrh' | 'quittance' | 'charge' | 'entite'
 *   - parentId : id numérique stable de l'entité parent
 *   - parentRef : référence user-facing pour debug (libellé mvt, ref logement, etc.)
 *   - logRef : ref logement (pour Drive arborescence) — peut différer de parentRef
 *              si parent = bail/edl/quittance (qui ont leur propre ref logement liée)
 *   - category : sous-dossier Drive (DRIVE-ARBORESCENCE Phase A) — défaut 'documents'
 */

// ALIGNÉ sur la contrainte de la base documents_parent_type_check (0026 + 0040 + 0057) : un type absent
// de la base (anciens 'travaux', 'charge', 'edl', jamais émis) ferait échouer la synchro (23514).
// Anti-dérive : attachments.test.js relit la contrainte dans supabase/migrations.
const PARENT_TYPES = [
  'mouvement', 'immeuble', 'logement', 'entite', 'bail',
  'assurance', 'mrh', 'equipement', 'quittance', 'candidat',
  'incident'
];

const DRIVE_CATEGORIES = [
  'edl', 'bail', 'documents', 'photos', 'quittances',
  'irl', 'mrh', 'travaux', 'charges'
];

const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10 Mo
const DEFAULT_ACCEPTED_MIMES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

/**
 * Construit l'objet métadonnées attachement (DB.documents shape).
 *
 * @param {Object} params - { parentType, parentId, parentRef, logRef,
 *                            category, name, mime, size, idbKey,
 *                            driveFileId, driveWebViewLink, idGenerator }
 * @returns {Object} - doc prêt à push dans DB.documents[]
 */
export function _attachmentBuildDoc(params = {}) {
  const {
    parentType, parentId, parentRef, logRef,
    category = 'documents', name, mime, size = 0,
    idbKey = null, driveFileId = null, driveWebViewLink = null,
    idGenerator
  } = params;

  if (!parentType) throw new Error('_attachmentBuildDoc : parentType requis');
  if (!PARENT_TYPES.includes(parentType)) {
    throw new Error('_attachmentBuildDoc : parentType invalide « ' + parentType + ' » (attendu : ' + PARENT_TYPES.join(' | ') + ')');
  }
  if (!DRIVE_CATEGORIES.includes(category)) {
    throw new Error('_attachmentBuildDoc : category invalide « ' + category + ' »');
  }
  if (!name) throw new Error('_attachmentBuildDoc : name requis');

  const now = new Date().toISOString();
  const id = (typeof idGenerator === 'function')
    ? idGenerator()
    : Date.now() * 1000 + Math.floor(Math.random() * 1000); // fallback déterministe

  return {
    id,
    parentType,
    parentId: parentId != null ? parentId : null,
    parentRef: parentRef != null ? String(parentRef) : null,
    logRef: logRef != null ? String(logRef) : null,
    category,
    idbKey,
    driveFileId,
    driveWebViewLink,
    name: String(name).slice(0, 200),
    originalName: String(name).slice(0, 200),
    mime: mime || 'application/octet-stream',
    size: Number(size) || 0,
    uploadedAt: now,
    _modifiedAt: now
  };
}

/**
 * Valide qu'un File / Blob est acceptable pour upload.
 *
 * @param {File|Blob} file
 * @param {Object} opts - { maxSize, acceptedMimes }
 * @returns {{ valid: boolean, reason?: string }}
 */
export function _attachmentValidateFile(file, opts = {}) {
  const { maxSize = DEFAULT_MAX_SIZE, acceptedMimes = DEFAULT_ACCEPTED_MIMES } = opts;
  if (!file) return { valid: false, reason: 'Fichier absent' };
  if (typeof file.size !== 'number') return { valid: false, reason: 'Taille indisponible' };
  if (file.size === 0) return { valid: false, reason: 'Fichier vide' };
  if (file.size > maxSize) {
    const mb = (file.size / 1024 / 1024).toFixed(2);
    const maxMb = (maxSize / 1024 / 1024).toFixed(0);
    return { valid: false, reason: `Fichier trop lourd : ${mb} Mo (max ${maxMb} Mo)` };
  }
  if (acceptedMimes.length > 0 && file.type) {
    // Wildcard EXPLICITE uniquement pour image/* (permet image/heic, avif, etc.)
    // Les autres types sont match exact.
    const ok = acceptedMimes.some(m => {
      if (file.type === m) return true;
      if (m.startsWith('image/') && file.type.startsWith('image/')) return true;
      return false;
    });
    if (!ok) return { valid: false, reason: `Type non supporté : ${file.type}` };
  }
  return { valid: true };
}

/**
 * Filtre une liste d'attachements selon des critères.
 *
 * @param {Array} attachments - DB.documents
 * @param {Object} filter - { parentType, parentId, logRef, category, includeDeleted }
 * @returns {Array}
 */
export function _attachmentMatch(attachments, filter = {}) {
  if (!Array.isArray(attachments)) return [];
  const { parentType, parentId, logRef, category, includeDeleted = false } = filter;
  return attachments.filter(a => {
    if (!a) return false;
    if (!includeDeleted && a._deleted) return false;
    if (parentType && a.parentType !== parentType) return false;
    if (parentId != null && a.parentId !== parentId) return false;
    if (logRef && a.logRef !== logRef) return false;
    if (category && a.category !== category) return false;
    return true;
  });
}

/**
 * Trouve l'attachement primaire d'un parent donné (le plus récent, ou par id).
 *
 * @param {Array} attachments
 * @param {Object} filter - { parentType, parentId, attachmentId }
 * @returns {Object|null}
 */
export function _attachmentResolve(attachments, filter = {}) {
  if (!Array.isArray(attachments)) return null;
  const { parentType, parentId, attachmentId } = filter;
  if (attachmentId != null) {
    return attachments.find(a => a && !a._deleted && a.id === attachmentId) || null;
  }
  const matches = _attachmentMatch(attachments, { parentType, parentId });
  if (!matches.length) return null;
  // Plus récent en premier (uploadedAt)
  matches.sort((x, y) => (y.uploadedAt || '').localeCompare(x.uploadedAt || ''));
  return matches[0];
}

/**
 * Génère le nom de fichier Drive normalisé.
 * Format : {category}_{ISO date}_{nom-original}.{ext}
 *
 * @param {string} category
 * @param {string} originalName
 * @param {Date} [now]
 */
export function _attachmentDriveName(category, originalName, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const cleaned = String(originalName || 'document')
    .replace(/[\x00-\x1f\\/]/g, '')
    .trim()
    .slice(0, 150);
  return `${category}_${date}_${cleaned}`;
}

/**
 * Plan de migration : pour chaque mouvement avec PJ legacy base64, génère
 * la liste d'opérations à effectuer (sans muter la DB).
 *
 * @param {Array} mouvements - DB.mouvements
 * @returns {{ candidates: Array, total: number, totalBytesLegacy: number }}
 */
export function _planLegacyPjMigration(mouvements) {
  if (!Array.isArray(mouvements)) return { candidates: [], total: 0, totalBytesLegacy: 0 };
  const candidates = mouvements.filter(m =>
    m && !m._deleted && m.pj && m.pj.dataB64 && !m.pjId
  );
  const totalBytesLegacy = candidates.reduce((s, m) => s + (m.pj.dataB64?.length || 0), 0);
  return {
    candidates,
    total: candidates.length,
    totalBytesLegacy
  };
}

/**
 * Compte les attachements sans binaire ni Drive (= binaire perdu).
 * Diagnostic post-migration ou après reset localStorage.
 */
export function _attachmentOrphans(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.filter(a => a && !a._deleted && !a.idbKey && !a.driveFileId);
}

/**
 * Constantes exportées pour réutilisation.
 */
export const ATTACHMENT_PARENT_TYPES = PARENT_TYPES;
export const ATTACHMENT_CATEGORIES = DRIVE_CATEGORIES;
export const ATTACHMENT_DEFAULT_MAX_SIZE = DEFAULT_MAX_SIZE;
