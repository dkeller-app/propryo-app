// js/core/candidature-purge.js — CANDIDATURES-CONFORMITE lot 1 (12/10/2026).
// Purge RGPD des candidats NON RETENUS. Pur : aucun DOM, aucun réseau, aucun effet de bord.
// L'appelant (app-part1 `_purgeCandidatsRefusesProd`, `deleteCandidat`) exécute le plan.
//
// Règle : un candidat refusé est effacé JOURS_CONSERVATION_REFUS jours après la DATE DU REFUS
// (champ `refuseLe`), plus jamais d'après `_modifiedAt` (toute édition repoussait la purge).
// Un candidat converti en bail (statut 'converti' ou `bailRef` renseigné) n'est JAMAIS purgé.
// Périmètre : la fiche, ses pièces `parentType === 'candidat'` (DB.documents), leurs binaires
// IndexedDB, leurs fichiers du bucket `espace-files`, la copie du relais. Rien d'autre.
// Testé par __tests__/helpers/candidature-purge.test.js.

export const JOURS_CONSERVATION_REFUS = 30;
const JOUR_MS = 24 * 60 * 60 * 1000;

function _iso(v) {
  if (v == null || v === '') return '';
  const ms = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

/** Date du refus (ISO) : `refuseLe`, à défaut `_modifiedAt` (refus antérieur à la mise à jour). '' si inconnue. */
export function dateRefus(c) {
  if (!c || typeof c !== 'object') return '';
  return _iso(c.refuseLe) || _iso(c._modifiedAt);
}

/** Un candidat converti en bail n'est jamais purgé (son dossier rejoint le bail). */
export function estProtegeDeLaPurge(c) {
  if (!c || typeof c !== 'object') return true;
  return c.statut === 'converti' || !!String(c.bailRef || '').trim();
}

/**
 * Migration de donnée : refusés vivants sans `refuseLe` → la date posée une fois (depuis `_modifiedAt`,
 * sinon maintenant). Ensuite l'horloge ne bouge plus. Renvoie les patchs [{ id, refuseLe }].
 */
export function refuseLeAPoser(candidats, nowIso) {
  if (!Array.isArray(candidats)) return [];
  const out = [];
  for (const c of candidats) {
    if (!c || c._deleted || c.statut !== 'refuse' || estProtegeDeLaPurge(c)) continue;
    if (_iso(c.refuseLe)) continue;
    out.push({ id: c.id, refuseLe: _iso(c._modifiedAt) || _iso(nowIso) || new Date().toISOString() });
  }
  return out;
}

/** Ids des candidats à effacer maintenant (refusés depuis ≥ `jours`, non protégés, vivants). */
export function candidatsAPurger(candidats, nowMs, jours = JOURS_CONSERVATION_REFUS) {
  if (!Array.isArray(candidats)) return [];
  const seuil = jours * JOUR_MS;
  const out = [];
  for (const c of candidats) {
    if (!c || c._deleted || c.statut !== 'refuse' || estProtegeDeLaPurge(c)) continue;
    const ts = Date.parse(dateRefus(c));
    if (!Number.isFinite(ts)) continue;            // date inconnue : jamais de purge à l'aveugle
    if ((nowMs - ts) >= seuil) out.push(c.id);
  }
  return out;
}

/** Date de suppression annoncée (AAAA-MM-JJ) d'un candidat refusé ; '' sinon. */
export function dateSuppressionPrevue(c, jours = JOURS_CONSERVATION_REFUS) {
  if (!c || c.statut !== 'refuse' || estProtegeDeLaPurge(c)) return '';
  const ts = Date.parse(dateRefus(c));
  if (!Number.isFinite(ts)) return '';
  return new Date(ts + jours * JOUR_MS).toISOString().slice(0, 10);
}

/** Pièces VIVANTES d'un candidat : parentType 'candidat' ET parentId = candId. Rien d'autre. */
export function piecesDuCandidat(documents, candId) {
  if (!Array.isArray(documents)) return [];
  const id = String(candId);
  return documents.filter(d => d && !d._deleted && d.parentType === 'candidat' && String(d.parentId) === id);
}

/**
 * Plan d'effacement des candidats `ids` : pour chacun, les pièces, clés IndexedDB et chemins Storage.
 * Revérifie chaque candidat (vivant, non protégé) : un id demandé par erreur n'efface rien.
 */
export function planPurge(candidats, documents, ids) {
  if (!Array.isArray(candidats) || !Array.isArray(ids)) return [];
  const out = [];
  for (const id of ids) {
    const c = candidats.find(x => x && String(x.id) === String(id));
    if (!c || c._deleted || estProtegeDeLaPurge(c)) continue;
    const docs = piecesDuCandidat(documents, c.id);
    out.push({
      candId: c.id, entity: c.entity || '', linkId: c.linkId || '',
      docIds: docs.map(d => d.id),
      idbKeys: docs.map(d => d.idbKey).filter(Boolean),
      cloudPaths: docs.map(d => d.cloudKey).filter(cheminFichierCandidatValide),
      // cloudKey présent mais de forme inconnue : on ne sait pas l'effacer → l'appelant CONSERVE le
      // candidat (jamais de purge qui laisserait un fichier orphelin en ligne sans trace).
      cheminsInconnus: docs.filter(d => d.cloudKey && !cheminFichierCandidatValide(d.cloudKey)).length
    });
  }
  return out;
}

// Formes de chemin produites par l'app (`__immoCloudUpload`) : <espace>/<entité|_orphelin>/files/<clé>
// ou legacy <espace>/files/<clé>, clé = ph_|att_<horodatage>_<aléa>. Tout autre chemin est refusé :
// la fonction de suppression ne peut viser ni un dossier, ni un joker, ni une pièce d'un autre type
// nommée autrement.
const _UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const _CHEMIN_RE = new RegExp('^' + _UUID + '/(?:(?:' + _UUID + '|_orphelin)/)?files/(?:ph|att)_\\d+_[a-z0-9]+$');
// Clé NUE legacy (uploads d'avant le chemin complet) : relue par l'app comme <espace>/files/<clé>
// (__immoCloudFileUrl) — acceptée ici, développée de la même façon par la fonction de suppression.
const _CLE_NUE_RE = /^(?:ph|att)_\d+_[a-z0-9]+$/;
export function cheminFichierCandidatValide(p) {
  return typeof p === 'string' && (_CHEMIN_RE.test(p) || _CLE_NUE_RE.test(p));
}
export function estCleNue(p) { return typeof p === 'string' && _CLE_NUE_RE.test(p); }

/** File d'attente locale des fichiers en ligne pas encore effacés (hors ligne, échec réseau). */
export function ajouterEnAttente(liste, chemins) {
  const base = Array.isArray(liste) ? liste.filter(cheminFichierCandidatValide) : [];
  const set = new Set(base);
  for (const p of (Array.isArray(chemins) ? chemins : [])) if (cheminFichierCandidatValide(p)) set.add(p);
  return [...set];
}
export function retirerDeAttente(liste, effaces) {
  const ok = new Set(Array.isArray(effaces) ? effaces : []);
  return (Array.isArray(liste) ? liste : []).filter(p => !ok.has(p));
}

/** Candidats vivants qui portent encore le champ `confianceScore` (à effacer, décision du 12/10). */
export function idsAvecScoreStocke(candidats) {
  if (!Array.isArray(candidats)) return [];
  return candidats.filter(c => c && !c._deleted && Object.prototype.hasOwnProperty.call(c, 'confianceScore')).map(c => c.id);
}

/**
 * Colonnes à réécrire en même temps que le soft-delete cloud, pour qu'une ligne supprimée ne garde
 * AUCUNE donnée personnelle (le soft-delete laissait `legacy_raw` intact). Limité aux candidats et
 * aux pièces de candidats ; toute autre ligne → null (comportement inchangé, preuve légale).
 */
export function effacementLigneCloud(table, rec) {
  if (!rec || typeof rec !== 'object') return null;
  if (table === 'candidats') return { legacy_raw: { id: rec.id, _efface: true } };
  if (table === 'documents' && rec.parentType === 'candidat') {
    return { legacy_raw: { id: rec.id, parentType: 'candidat', _efface: true }, name: null };
  }
  return null;
}
