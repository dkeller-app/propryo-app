/**
 * core/normalisation-loyers.js — NORMALISATION-LOYERS (01/10). Module PUR, testé.
 *
 * POURQUOI. La catégorie héritée « Loyers » (et l'ancien libellé du référentiel « Arriérés de
 * loyers ») ne vit plus au cloud (0 mouvement au 01/10), mais elle reste dans les sauvegardes JSON
 * d'avril (38 à 50 mouvements par fichier). Elle reviendrait par une RESTAURATION de sauvegarde ou
 * un IMPORT JSON, qui réinjectent les données telles quelles. Décision Didier (01/10) : le code ne
 * tolère plus « Loyers » ; les données passent dans « Loyers encaissés » (ligne 211). Cette fonction
 * est LE point unique de cette normalisation, appelé à chaque porte d'entrée des données
 * (initDB, restauration, import JSON, travaux de démarrage cloud).
 *
 * Elle retire aussi `locNouvIban` du bail (minimisation RGPD : l'IBAN du locataire n'est ni demandé
 * ni gardé). Sur un bail SIGNÉ, seul le champ à la RACINE est retiré : `signatures.bailSnapshot` et
 * l'empreinte (`bailLegalContent`, js/core/bail-content-hash.js) n'en dépendent pas et ne sont
 * JAMAIS touchés. Un IBAN présent DANS un snapshot signé est seulement compté (décision D3 ouverte).
 *
 * Périmètre EXACT : seuls les noms « Loyers » et « Arriérés de loyers » sont visés, à la lettre.
 * Une catégorie voisine (« loyer » en minuscules, au singulier : espace eaa6b867, autre utilisateur,
 * sans accord) n'est PAS touchée.
 *
 * Catégorie personnelle homonyme : si l'espace rattache « Loyers » à AUTRE CHOSE que la ligne 211
 * (alias vers une autre mère, mapping vers une autre ligne, ou « __ignore »), c'est un choix de
 * l'utilisateur : ce nom est laissé intact partout (mouvements, règles, réglages) et signalé.
 *
 * Idempotente : un second passage ne modifie rien et ne tamponne rien.
 */

export const CATEGORIE_LOYERS = 'Loyers encaissés';
export const CATEGORIES_LOYERS_HERITEES = Object.freeze(['Loyers', 'Arriérés de loyers']);
const LIGNE_LOYERS = '211';

const _own = (obj, k) => (obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, k)) ? obj[k] : undefined;
const _tamponDefaut = (o) => { if (o && typeof o === 'object') o._modifiedAt = new Date().toISOString(); return o; };

/** Bail signé (le document scellé) : on n'y pose même pas de tampon, seul le retrait est fait. */
function _signe(b) {
  const s = b && b.signatures;
  return !!(s && typeof s === 'object' && (s.locked || s.signedAt));
}

/**
 * Le nom hérité est-il, dans CET espace, une catégorie personnelle rattachée ailleurs qu'aux loyers ?
 * Rattaché à la ligne 211 (ou pas rattaché du tout) = l'héritage à normaliser.
 */
export function homonymePerso(db, nom) {
  const D = db || {};
  const alias = _own(D.catAlias, nom);
  if (alias && alias !== CATEGORIE_LOYERS) return true;
  const params = D.params && typeof D.params === 'object' ? D.params : {};
  // Même précédence que le classifieur (catCtxFromDb, js/core/utils.js) : catMapping prime, clé par clé,
  // sur legal2044Mapping. Seul le rattachement EFFECTIF décide.
  const m = _own(D.catMapping, nom) || _own(params.legal2044Mapping, nom);
  return !!(m && String(m) !== LIGNE_LOYERS);
}

/** Retire `locNouvIban` à la racine d'un bail. Renvoie true si le champ existait. */
function _purgerIbanRacine(b, stamp) {
  if (!b || typeof b !== 'object' || !Object.prototype.hasOwnProperty.call(b, 'locNouvIban')) return false;
  delete b.locNouvIban;
  if (!_signe(b)) stamp(b);
  return true;
}

function _ibanDansSnapshot(b) {
  const snap = b && b.signatures && b.signatures.bailSnapshot;
  return !!(snap && typeof snap === 'object' && snap.locNouvIban != null && snap.locNouvIban !== '');
}

/** Bail verrouillé AU CLOUD (store-sync : `immutable` = signatures.locked) : sa ligne n'est jamais renvoyée. */
function _verrouille(b) { return !!(b && b.signatures && typeof b.signatures === 'object' && b.signatures.locked); }

/**
 * @param {object} db   le DB de l'app (muté EN PLACE : la restauration garde la référence vivante)
 * @param {{stamp?: Function, espacePropre?: string|null}} [opts]
 *   `stamp` = `_stamp` de l'app (pose `_modifiedAt`).
 *   `espacePropre` (mode cloud, partage SCI) : si la clé est PRÉSENTE, seuls les enregistrements de l'espace
 *   propre (`_espaceId` absent ou égal) sont normalisés. Ceux d'une SCI partagée par un autre propriétaire
 *   restent intacts : la configuration chargée (catégories, mappings) est celle de l'espace propre, pas la
 *   sienne, et un associé en lecture seule se heurterait à la RLS à chaque envoi. C'est l'appareil du
 *   propriétaire qui les normalise, avec SA configuration. La configuration elle-même est toujours propre
 *   (store-multi.js : seule la config de l'espace propre est chargée).
 *   `espacePropre: null` (associé INVITÉ, sans espace à lui) : seuls les enregistrements NON tagués sont
 *   touchés — jamais ceux du propriétaire (sinon : écriture refusée par la RLS = « conflict » → re-pull →
 *   nouvelle normalisation → boucle sans fin ; ou reclassement avec une config vide).
 * @returns {{modifie:boolean, aPersister:boolean, mouvements:number, reglesImport:number, categories:number,
 *   reglages:number, baux:number, bauxVerrouilles:number, historique:number, journal:number,
 *   horsEspace:number, ibanSnapshotsSignes:number, nomsSautes:string[]}}
 *   `modifie` : quelque chose a changé en mémoire. `aPersister` : un changement qui PART au cloud — une
 *   purge d'IBAN sur un bail verrouillé ne part jamais (la ligne n'est pas renvoyée) : elle ne justifie ni
 *   sauvegarde ni nouveau rendu, sinon chaque ré-hydratation relancerait un saveDB inutile.
 */
export function normaliserDonneesLoyers(db, opts) {
  const o = opts || {};
  const stamp = (typeof o.stamp === 'function') ? o.stamp : _tamponDefaut;
  const filtrer = Object.prototype.hasOwnProperty.call(o, 'espacePropre');
  const espace = filtrer ? (o.espacePropre == null ? null : o.espacePropre) : null;
  const r = { modifie: false, aPersister: false, mouvements: 0, reglesImport: 0, categories: 0, reglages: 0,
    baux: 0, bauxVerrouilles: 0, historique: 0, journal: 0, horsEspace: 0, ibanSnapshotsSignes: 0, nomsSautes: [] };
  if (!db || typeof db !== 'object') return r;
  // Enregistrement de l'espace propre ? (hors mode cloud : tout est propre)
  const propre = (rec) => !filtrer || rec._espaceId == null || rec._espaceId === espace;

  // ── 1. Catégories héritées → « Loyers encaissés » ─────────────────────────────────────────
  const noms = new Set();
  for (const n of CATEGORIES_LOYERS_HERITEES) {
    if (homonymePerso(db, n)) r.nomsSautes.push(n); else noms.add(n);
  }
  if (noms.size) {
    // Noms encore portés par des mouvements d'un AUTRE espace (laissés à leur propriétaire) : leurs réglages
    // (liste, catConfig, mappings, alias) sont GARDÉS, pour qu'ils restent classés en attendant d'être
    // normalisés par l'appareil du propriétaire (contre-audit 05/10).
    const enAttente = new Set();
    if (Array.isArray(db.mouvements)) {
      for (const m of db.mouvements) {
        if (!m || typeof m !== 'object' || !noms.has(m.cat)) continue;
        if (!propre(m)) { r.horsEspace++; enAttente.add(m.cat); continue; }
        m.cat = CATEGORIE_LOYERS; stamp(m); r.mouvements++;
      }
    }
    if (Array.isArray(db.importRules)) {
      for (const x of db.importRules) {
        // _stamp aussi sur la règle modifiée (REGLES-REFONTE phase 4 : une règle a un _modifiedAt comme le reste).
        if (x && typeof x === 'object' && noms.has(x.cat)) { x.cat = CATEGORIE_LOYERS; stamp(x); r.reglesImport++; }
      }
    }
    const aNettoyer = new Set([...noms].filter(n => !enAttente.has(n)));
    if (Array.isArray(db.categories) && db.categories.some(c => aNettoyer.has(c))) {
      const avant = db.categories.length;
      db.categories = db.categories.filter(c => !aNettoyer.has(c));
      r.categories = avant - db.categories.length;
      if (!db.categories.includes(CATEGORIE_LOYERS)) db.categories.push(CATEGORIE_LOYERS);
    }
    // Réglages rattachés au nom hérité : sans objet une fois le nom disparu. Les tombstones
    // (`params._deletedCategories`) sont gardées : elles empêchent le nom de revenir.
    const params = (db.params && typeof db.params === 'object') ? db.params : null;
    for (const table of [db.catConfig, db.catMapping, db.catAlias, params && params.legal2044Mapping]) {
      if (!table || typeof table !== 'object') continue;
      for (const n of aNettoyer) {
        if (Object.prototype.hasOwnProperty.call(table, n)) { delete table[n]; r.reglages++; }
      }
    }
  }

  // ── 2. IBAN du locataire (RGPD) : la racine seulement, jamais le document signé ─────────────
  // LIMITE ASSUMÉE : sur un bail VERROUILLÉ au cloud, la purge reste en mémoire (la ligne signée n'est
  // jamais réécrite par l'app) ; l'IBAN y demeure dans `legacy_raw` tant que le filet SQL préparé
  // (mockups/MIGRATION-LOYERS, non appliqué) ne passe pas. 0 cas au cloud au 01/10.
  if (db.baux && typeof db.baux === 'object') {
    for (const b of Object.values(db.baux)) {
      if (!b || typeof b !== 'object') continue;
      if (Object.prototype.hasOwnProperty.call(b, 'locNouvIban') && !propre(b)) { r.horsEspace++; continue; }
      if (_purgerIbanRacine(b, stamp)) { r.baux++; if (_verrouille(b)) r.bauxVerrouilles++; }
      if (_signe(b) && _ibanDansSnapshot(b)) r.ibanSnapshotsSignes++;
    }
  }
  if (Array.isArray(db.baux_historique)) {
    for (const b of db.baux_historique) {
      if (!b || typeof b !== 'object') continue;
      if (Object.prototype.hasOwnProperty.call(b, 'locNouvIban') && !propre(b)) { r.horsEspace++; continue; }
      if (_purgerIbanRacine(b, stamp)) r.historique++;
      if (_signe(b) && _ibanDansSnapshot(b)) r.ibanSnapshotsSignes++;
    }
  }
  // Journal des baux signés : un changement portant sur l'IBAN est retiré ; une entrée qui n'a
  // plus aucun changement est supprimée logiquement (même règle que le filet SQL préparé dans
  // mockups/MIGRATION-LOYERS, NON appliqué en base).
  if (Array.isArray(db.baux_evenements)) {
    for (const e of db.baux_evenements) {
      if (!e || typeof e !== 'object' || !Array.isArray(e.changements)) continue;
      const garde = e.changements.filter(c => !(c && c.champ === 'locNouvIban'));
      if (garde.length === e.changements.length) continue;
      if (!propre(e)) { r.horsEspace++; continue; }
      e.changements = garde;
      if (!garde.length) e._deleted = true;
      stamp(e);
      r.journal++;
    }
  }

  r.aPersister = !!(r.mouvements || r.reglesImport || r.categories || r.reglages
    || (r.baux - r.bauxVerrouilles) || r.historique || r.journal);
  r.modifie = r.aPersister || r.bauxVerrouilles > 0;
  return r;
}
