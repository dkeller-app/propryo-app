/**
 * core/emails-page.js — EMAIL-ONGLET-PERMANENT v15.79
 *
 * Helpers purs pour la page #p-emails "📧 Communications" :
 * - Groupage par mois pour l'historique
 * - Comptage par type / par mois pour le tableau de bord
 * - Sort + filtre par entityType
 *
 * Tests Vitest miroir : __tests__/helpers/emails-page.test.js
 */

/**
 * Trie une liste d'emails par date d'envoi décroissante (récent en premier).
 * @param {object[]} emails — entries DB.emailsSent
 * @returns {object[]} nouvelle liste triée
 */
export function _emailsSortDesc(emails) {
  if (!Array.isArray(emails)) return [];
  return emails.slice().sort((a, b) => String((b && b.sentAt) || '').localeCompare(String((a && a.sentAt) || '')));
}

/**
 * Groupe les emails par mois YYYY-MM, retour {[YYYY-MM]: emails[]} trié desc.
 * Skip les emails sans sentAt valide.
 * @param {object[]} emails
 * @returns {{key:string, label:string, emails:object[]}[]}
 */
export function _emailsGroupByMonth(emails) {
  if (!Array.isArray(emails)) return [];
  const buckets = new Map();
  for (const e of emails) {
    if (!e || !e.sentAt) continue;
    const key = String(e.sentAt).slice(0, 7); // YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(e);
  }
  const keys = Array.from(buckets.keys()).sort().reverse();
  return keys.map(k => ({
    key: k,
    label: _emailsFormatMonthLabel(k),
    emails: _emailsSortDesc(buckets.get(k)),
  }));
}

/**
 * Convertit "2026-05" en "Mai 2026" (français).
 */
export function _emailsFormatMonthLabel(yyyymm) {
  const m = String(yyyymm || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(yyyymm || '');
  const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const idx = parseInt(m[2], 10) - 1;
  return (months[idx] || m[2]) + ' ' + m[1];
}

/**
 * Compte les emails par type.
 * @param {object[]} emails
 * @returns {{[type:string]: number}}
 */
export function _emailsCountByType(emails) {
  const out = {};
  if (!Array.isArray(emails)) return out;
  for (const e of emails) {
    if (!e || !e.type) continue;
    out[e.type] = (out[e.type] || 0) + 1;
  }
  return out;
}

/**
 * Statistiques globales pour le tableau de bord.
 * @param {object[]} emails
 * @returns {{total:number, last30:number, last90:number, byMonth:object[], topTypes:Array}}
 */
export function _emailsDashboardStats(emails) {
  const empty = { total: 0, last30: 0, last90: 0, byMonth: [], topTypes: [] };
  if (!Array.isArray(emails) || !emails.length) return empty;
  const now = Date.now();
  let last30 = 0, last90 = 0;
  for (const e of emails) {
    if (!e || !e.sentAt) continue;
    const t = new Date(e.sentAt).getTime();
    if (!isFinite(t)) continue;
    const diffDays = (now - t) / 86400000;
    if (diffDays <= 30) last30++;
    if (diffDays <= 90) last90++;
  }
  const counts = _emailsCountByType(emails);
  const topTypes = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, n]) => ({ type, n }));
  return {
    total: emails.length,
    last30,
    last90,
    byMonth: _emailsGroupByMonth(emails).slice(0, 6),
    topTypes,
  };
}

/**
 * Filtre par entityType / entityId si fournis.
 * @param {object[]} emails
 * @param {string} [entityType]
 * @param {string} [entityId]
 * @returns {object[]}
 */
export function _emailsFilter(emails, entityType, entityId) {
  if (!Array.isArray(emails)) return [];
  if (!entityType && !entityId) return emails.slice();
  return emails.filter(e => {
    if (!e) return false;
    if (entityType && e.entityType !== entityType) return false;
    if (entityId && e.entityId !== entityId) return false;
    return true;
  });
}
