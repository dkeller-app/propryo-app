/**
 * core/dossier-comptable.js — Assemblage du « Dossier comptable » (.zip).
 *
 * Un seul fichier reliant les ÉCRITURES (FEC/journal/grand-livre, cf.
 * export-comptable.js) et les JUSTIFICATIFS (factures attachées aux mouvements).
 * CDC : docs/CDC-EXPORT-COMPTABLE.md.
 *
 * Ce module ne contient que des helpers PURS (aucun DOM, aucun fetch). Il produit
 * un PLAN d'assemblage (arborescence + nommage + index.csv + lien num↔facture) à
 * partir des métadonnées. L'orchestration IMPURE — récupération asynchrone des
 * binaires (IndexedDB `_idbGet` / cloud `_downloadPhotoFromDrive` / legacy) puis
 * `_bk.storedZip` + `_downloadBlobAs` — reste inline dans index.html et réutilise
 * les briques existantes (rien recréé).
 *
 * Alignement des `num` : le plan consomme `_buildMvtRows` (export-comptable.js),
 * même source que `_buildEcritures` → `num` identiques par construction.
 *
 * Tests Vitest : __tests__/helpers/dossier-comptable.test.js
 */

import { _csvCell, _uneLigne } from './export-comptable.js';

// ── Slugs / noms sûrs ────────────────────────────────────────────────────────

// Composant filename-safe conservant la casse : accents retirés, non [A-Za-z0-9] → '-'.
function _dcNameSlug(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Catégorie pour le nom de facture : slug en minuscules.
export function _dcCatSlug(s) {
  return _dcNameSlug(s).toLowerCase() || 'divers';
}

// Nom de dossier interne au zip : garde espaces + casse, retire contrôle et séparateurs de chemin.
function _dcDirSafe(s) {
  return String(s == null ? '' : s)
    .replace(/[\x00-\x1f\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Montant → composant de nom sans séparateur de milliers ; décimales via '-' (142,50 → 142-50).
export function _dcMontantSlug(montant) {
  const r = Math.round((Number(montant) || 0) * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r).replace('.', '-');
}

// Nom du .zip (décision #1) : Dossier-comptable_<Bailleur>_<AAAA-MM-JJ>.zip
// bailleurLabel vide / 'Tous' → 'Tous-bailleurs'.
export function _dcZipName(bailleurLabel, extractionYmd) {
  const raw = String(bailleurLabel == null ? '' : bailleurLabel).trim();
  const b = (!raw || /^tous$/i.test(raw)) ? 'Tous-bailleurs' : (_dcNameSlug(raw) || 'Tous-bailleurs');
  return `Dossier-comptable_${b}_${extractionYmd}.zip`;
}

// Sous-dossier factures (décision #2) : « <Bailleur> - <Lot> » ; sans lot → « <Bailleur> - _general ».
export function _dcFactureDir(bailleur, lot) {
  const b = _dcDirSafe(bailleur) || 'Bailleur';
  const l = _dcDirSafe(lot) || '_general';
  return `${b} - ${l}`;
}

// Extension = VRAI type du fichier (jamais forcée en .pdf) : priorité au nom, repli sur le mime.
export function _dcExtFromMime(mime, name) {
  const byName = /\.([A-Za-z0-9]{1,5})$/.exec(String(name || ''));
  if (byName) return '.' + byName[1].toLowerCase();
  const m = String(mime || '').toLowerCase();
  if (m.includes('pdf')) return '.pdf';
  if (m.includes('png')) return '.png';
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (m.includes('webp')) return '.webp';
  if (m.includes('gif')) return '.gif';
  return '.bin';
}

// Nom de facture : AAAA-MM-JJ_categorie_montant.ext ; collisions dans un même dossier → _2, _3…
// usedNames : Set des noms déjà pris DANS CE dossier (muté).
export function _dcFactureName(dateYmd, categorie, montant, ext, usedNames) {
  const base = `${dateYmd}_${_dcCatSlug(categorie)}_${_dcMontantSlug(montant)}`;
  let name = base + ext;
  if (usedNames) {
    let i = 2;
    while (usedNames.has(name)) { name = `${base}_${i}${ext}`; i++; }
    usedNames.add(name);
  }
  return name;
}

// ── Résolution de la pièce jointe d'un mouvement ─────────────────────────────

// Retourne { doc, legacy, name, mime, hasBinary } ou null (aucune PJ).
// hasBinary=false = métadonnée présente mais binaire perdu (ni idbKey, ni cloud) → « manquante ».
export function _dcResolveDoc(mvt, documents) {
  if (!mvt) return null;
  if (mvt.pjId != null) {
    const doc = (documents || []).find(d => d && !d._deleted && d.id === mvt.pjId);
    if (!doc) return null; // pjId orphelin (doc supprimé) → traité comme manquante
    return { doc, legacy: false, name: doc.name, mime: doc.mime, hasBinary: !!(doc.idbKey || doc.cloudKey || doc.driveFileId) };
  }
  if (mvt.pj && mvt.pj.dataB64) {
    return { doc: null, legacy: true, name: mvt.pj.name, mime: mvt.pj.mime, hasBinary: true, dataB64: mvt.pj.dataB64 };
  }
  return null;
}

// ── Plan d'assemblage ────────────────────────────────────────────────────────

/**
 * Construit le plan du dossier à partir des lignes « par mouvement » (_buildMvtRows).
 *
 * @param {Array} mvtRows - sortie de _buildMvtRows (export-comptable.js)
 * @param {Object} ctx - { documents, logements, extractionYmd, entityNom, from, to }
 * @returns {{ rows, pieceRefByNum, counts:{mouvements,factures,manquantes}, meta }}
 *   - rows[i] : { num, date, bailleur, lot, categorie, libelle, montant, type,
 *                 hasPj, resolved, fileName, filePath, status }
 *   - pieceRefByNum : { num → nom fichier facture | 'M'+num } → passé à _toFEC
 */
export function _dcBuildPlan(mvtRows, ctx = {}) {
  const { documents = [], logements = [], extractionYmd = '', entityNom = '', from = '', to = '' } = ctx;
  const logByRef = new Map();
  (logements || []).forEach(l => { if (l && l.ref != null) logByRef.set(l.ref, l); });

  const usedByDir = new Map(); // dir → Set(noms pris)
  const rows = [];
  const pieceRefByNum = {};
  let factures = 0, manquantes = 0;

  (mvtRows || []).forEach(r => {
    const mvt = r.mvt || {};
    // Bailleur / Lot
    let bailleur, lot;
    if (typeof r.qui === 'string' && r.qui.indexOf('SCI:') === 0) {
      bailleur = r.qui.slice(4);
      lot = '_general';
    } else {
      const log = logByRef.get(r.qui);
      bailleur = (log && log.entity) || entityNom || 'Bailleur';
      lot = (log && log.ref) || (r.qui || '_general');
    }

    const resolved = _dcResolveDoc(mvt, documents);
    const has = !!(resolved && resolved.hasBinary);
    let fileName = null, filePath = null;
    if (has) {
      const dir = _dcFactureDir(bailleur, lot);
      let used = usedByDir.get(dir);
      if (!used) { used = new Set(); usedByDir.set(dir, used); }
      const ext = _dcExtFromMime(resolved.mime, resolved.name);
      fileName = _dcFactureName(r.date, r.cat, r.montant, ext, used);
      filePath = `factures/${dir}/${fileName}`;
      factures++;
      pieceRefByNum[r.num] = fileName;
    } else {
      manquantes++;
      pieceRefByNum[r.num] = 'M' + r.num;
    }

    rows.push({
      num: r.num, date: r.date, bailleur, lot,
      // Montant SIGNÉ : un avoir / remboursement (`r.inverse`) est négatif dans index.csv, comme dans
      // Finances (le nom du fichier facture, lui, garde la valeur absolue).
      categorie: r.cat, libelle: r.lib, montant: r.inverse ? -r.montant : r.montant, type: r.type,
      hasPj: has, resolved, fileName, filePath,
      status: has ? 'présente' : 'ABSENTE'
    });
  });

  return {
    rows, pieceRefByNum,
    counts: { mouvements: rows.length, factures, manquantes },
    meta: { extractionYmd, entityNom, from, to }
  };
}

// ── index.csv (pont écriture ↔ facture, daté en tête) ────────────────────────

export function _dcIndexCsv(plan) {
  const meta = (plan && plan.meta) || {};
  const pieceRefByNum = (plan && plan.pieceRefByNum) || {};
  const headerComment = `# date d'extraction : ${_uneLigne(meta.extractionYmd)} · bailleur : ${_uneLigne(meta.entityNom || 'Tous')} · période : ${_uneLigne(meta.from)} → ${_uneLigne(meta.to)}`;
  const cols = ['ecriture_num', 'date', 'bailleur', 'lot', 'categorie', 'libelle', 'montant', 'piece_ref', 'fichier', 'facture'];
  const lines = [headerComment, cols.join(',')];
  (plan && plan.rows || []).forEach(r => {
    lines.push([
      'GL' + String(r.num).padStart(6, '0'),
      r.date, r.bailleur, r.lot, r.categorie, r.libelle,
      // Point décimal, cohérent avec journal.csv / grand-livre.csv (les 3 CSV du dossier ;
      // le FEC.txt, lui, garde la virgule imposée par la DGFiP). Cf. CDC §4.4.
      (Number(r.montant) || 0).toFixed(2),
      // piece_ref MIROIR du PieceRef du FEC : nom de fichier si présente, sinon 'M'+num
      // (jamais '—' ici → l'expert-comptable retrouve la même valeur des deux côtés).
      pieceRefByNum[r.num] || ('M' + r.num),
      r.filePath || '—',
      r.hasPj ? 'présente' : 'ABSENTE'
    ].map(_csvCell).join(','));
  });
  return lines.join('\n');
}

/**
 * Dégrade UNE ligne du plan en « facture ABSENTE » quand la récupération du binaire
 * a échoué au moment du téléchargement (hors ligne, cache vidé). Mute le plan pour
 * que FEC (via pieceRefByNum) ET index.csv restent EXACTS : aucune écriture ne
 * pointera vers un fichier absent du zip, ni l'inverse. Idempotent.
 *
 * @returns {boolean} true si la ligne a effectivement été dégradée
 */
export function _dcApplyFetchFailure(plan, num) {
  if (!plan || !Array.isArray(plan.rows)) return false;
  const row = plan.rows.find(r => r && r.num === num);
  if (!row || !row.hasPj) return false; // déjà absente ou introuvable → no-op
  row.hasPj = false;
  row.fileName = null;
  row.filePath = null;
  row.status = 'ABSENTE';
  if (plan.counts) {
    plan.counts.factures = Math.max(0, (plan.counts.factures || 0) - 1);
    plan.counts.manquantes = (plan.counts.manquantes || 0) + 1;
  }
  if (plan.pieceRefByNum) plan.pieceRefByNum[num] = 'M' + num;
  return true;
}
