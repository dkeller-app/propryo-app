/**
 * core/manque-accepte.js — FINANCES-SUIVI-V2 (ex-FINANCES-SUIVI-UNIQUE P2) : l'entrée « manque accepté » du journal du bail.
 *
 * Conception : docs/subjects/FINANCES-SUIVI-UNIQUE-MOTEUR.md §D (stockage, synchro, garde-fous) et
 * §I Q1 (le geste solde ce qui manque, sans réimputer ; jamais un encaissement).
 *
 * FINANCES-SUIVI-V2 (reprise sur main, 16/10/2026) : le MOTEUR est le suivi unique de finances-monthly.js
 * (`_computeSuiviLot` → `_computeDetteBail`), qui consomme des manques normalisés `{ id, bailDebut, ym, montant }`.
 * Ce module porte l'ENTRÉE DE JOURNAL (forme stockée dans DB.baux_evenements, validation à la saisie, annulation par
 * tombstone), comme avenant-registre.js le fait pour les avenants. Aucune dépendance au moteur.
 *
 * Forme stockée (§D) :
 *   { id: 'mqa_' + uid, type: 'manque_accepte', ref /* clé NUE du logement *\/, bailDebut, bailUid?,
 *     ym, montant, motif /* obligatoire *\/, date /* du geste *\/, auteur?, _espaceId?, _modifiedAt,
 *     _deleted?, _deletedAt? }
 * Synchro : table cloud baux_evenements (type_evenement 'manque_accepte' après la migration 0056 ;
 * avant elle, le mappeur rangeait tout type inconnu en 'autre' — l'objet entier voyage dans
 * legacy_raw, rien n'est perdu). Annulation = tombstone (`_deleted:true`) → suppression douce
 * gardée par version. Une nouvelle acceptation crée TOUJOURS un nouvel id (jamais de résurrection).
 *
 * PUR : aucune lecture de DB globale, aucune horloge (`now` et `uid` injectés), aucun DOM.
 * Tests : __tests__/helpers/manque-accepte.test.js.
 */

export const TYPE_MANQUE = 'manque_accepte';
export const PREFIXE_ID = 'mqa_';

const _r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const _nr = (s) => String(s == null ? '' : s).trim().toLowerCase();
const _cleNue = (k) => String(k == null ? '' : k).split('@@')[0];
const _isIsoJour = (s) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(s || '').slice(0, 10));
const _isYm = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || ''));
const EPS = 0.005;

/** Vrai pour une entrée de journal « manque accepté » non annulée. */
export function estManqueActif(e) {
  return !!(e && typeof e === 'object' && e.type === TYPE_MANQUE && !e._deleted);
}

/**
 * Validation de la saisie. `plafond` = la dette du mois que l'appelant a calculée (montant
 * pré-rempli de l'écran) : obligatoire, un geste ne peut pas dépasser ce qui manque.
 * @returns {Array<{champ:string, message:string}>} vide ⇔ valide
 */
export function validerManque(input, { plafond } = {}) {
  const i = input || {};
  const err = [];
  if (!_cleNue(i.ref).trim()) err.push({ champ: 'ref', message: 'Logement manquant.' });
  if (!_isIsoJour(i.bailDebut)) err.push({ champ: 'bailDebut', message: 'Bail non identifié (date de début invalide).' });
  if (!_isYm(i.ym)) err.push({ champ: 'ym', message: 'Mois invalide (AAAA-MM attendu).' });
  else if (_isIsoJour(i.bailDebut) && i.ym < String(i.bailDebut).slice(0, 7)) err.push({ champ: 'ym', message: 'Mois antérieur au début du bail.' });
  const m = Number(i.montant);
  if (!Number.isFinite(m) || _r2(m) <= 0) err.push({ champ: 'montant', message: 'Le montant doit être supérieur à 0.' });
  const p = Number(plafond);
  if (plafond == null || plafond === '' || !Number.isFinite(p) || _r2(p) <= 0) err.push({ champ: 'plafond', message: 'Aucune dette sur ce mois : rien à accepter.' });
  else if (Number.isFinite(m) && _r2(m) > _r2(p) + EPS) err.push({ champ: 'montant', message: 'Le montant dépasse ce qui manque (' + _r2(p).toFixed(2).replace('.', ',') + ' €).' });
  if (typeof i.motif !== 'string' || !i.motif.trim()) err.push({ champ: 'motif', message: 'Le motif est obligatoire.' });
  if (i.date != null && i.date !== '' && !_isIsoJour(i.date)) err.push({ champ: 'date', message: 'Date du geste invalide.' });
  return err;
}

/**
 * Rattachement d'un manque à son bail (objet bail de l'app, courant ou archivé) : début, ligne cloud
 * propre (`_bailUid` → `bailUid`, lu par le mappeur pour `bail_id`), espace (partage SCI).
 * Même règle que avenant-registre.js `_rattachement`, sans `signedAt` (un manque n'est pas une
 * modification du document signé et ne doit pas être pris pour tel par store-sync).
 */
export function rattachementManque(bail) {
  const b = bail || {};
  const r = { bailDebut: String(b.debut || '').slice(0, 10) };
  if (b._bailUid) r.bailUid = String(b._bailUid);
  if (b._espaceId != null) r._espaceId = b._espaceId;
  return r;
}

/**
 * Crée l'entrée de journal (sans l'insérer nulle part).
 * @param {Object} input { ref, bailDebut, bailUid?, _espaceId?, ym, montant, motif, date?, auteur? }
 * @param {{uid:string, now:string, plafond:number}} opts `uid` et `now` (ISO) injectés : jamais
 *        d'horloge ni d'aléa ici. `date` absente ⇒ jour de `now`.
 * @returns {{ok:true, entree:Object} | {ok:false, erreurs:Array}}
 */
export function nouveauManque(input, { uid, now, plafond } = {}) {
  const i = input || {};
  const erreurs = validerManque(i, { plafond });
  if (!uid || !String(uid).trim()) erreurs.push({ champ: 'id', message: 'Identifiant manquant.' });
  if (!now || Number.isNaN(Date.parse(now))) erreurs.push({ champ: 'now', message: 'Horodatage manquant.' });
  if (erreurs.length) return { ok: false, erreurs };
  const entree = {
    id: PREFIXE_ID + String(uid).trim(),
    type: TYPE_MANQUE,
    ref: _cleNue(i.ref).trim(),
    bailDebut: String(i.bailDebut).slice(0, 10),
    ym: String(i.ym),
    montant: _r2(i.montant),
    motif: i.motif.trim(),
    date: (i.date ? String(i.date) : String(now)).slice(0, 10),
    _modifiedAt: String(now)
  };
  if (i.bailUid) entree.bailUid = String(i.bailUid);
  if (i.auteur != null && String(i.auteur).trim()) entree.auteur = String(i.auteur).trim();
  if (i._espaceId != null) entree._espaceId = i._espaceId;
  return { ok: true, entree };
}

/**
 * Annulation = TOMBSTONE, en place (l'app passe ensuite par `_stamp`) : `_deleted`, `_deletedAt`,
 * `_modifiedAt`. Le reste de l'entrée est conservé (trace, synchro gardée par version).
 * @returns {Object|null} l'entrée, ou null si ce n'est pas un manque actif (rien n'est touché)
 */
export function annulerManque(entree, now) {
  if (!estManqueActif(entree)) return null;
  if (!now || Number.isNaN(Date.parse(now))) throw new TypeError('annulerManque : `now` (ISO) est obligatoire');
  entree._deleted = true;
  entree._deletedAt = String(now);
  entree._modifiedAt = String(now);
  return entree;
}

/** Le manque ACTIF d'id `id` dans le journal (premier trouvé), ou null. */
export function trouverManque(journal, id) {
  if (id == null || id === '') return null;
  return (Array.isArray(journal) ? journal : []).find((e) => estManqueActif(e) && String(e.id) === String(id)) || null;
}

/**
 * Le bail visé par un manque : le bail COURANT du logement s'il commence à `bailDebut`, sinon un
 * bail ARCHIVÉ (DB.baux_historique) du même logement et du même début. Supprimés ignorés.
 * @param {Object} db { baux, baux_historique } (injecté)
 * @returns {{bail:Object, archive:boolean}|null}
 */
export function bailDuManque(db, ref, bailDebut) {
  const D = db || {};
  const want = _nr(_cleNue(ref));
  const debut = String(bailDebut || '').slice(0, 10);
  if (!want || !_isIsoJour(debut)) return null;
  for (const [k, b] of Object.entries(D.baux || {})) {
    if (!b || typeof b !== 'object' || b._deleted || _nr(_cleNue(k)) !== want) continue;
    if (String(b.debut || '').slice(0, 10) === debut) return { bail: b, archive: false };
  }
  for (const b of (Array.isArray(D.baux_historique) ? D.baux_historique : [])) {
    if (!b || typeof b !== 'object' || b._deleted || _nr(_cleNue(b.ref)) !== want) continue;
    if (String(b.debut || '').slice(0, 10) === debut) return { bail: b, archive: true };
  }
  return null;
}

/**
 * Les manques ACTIFS d'un lot, au format consommé par le moteur (`_computeSuiviLot({ manques })`) :
 * `{ id, bailDebut, ym, montant, motif, date }`. Tombstones filtrés ; référence du logement tolérante (clé nue,
 * casse et espaces ignorés), comme le rattachement des baux.
 * @param {Array} journal DB.baux_evenements (injecté)
 * @param {string} ref
 */
export function manquesDuLot(journal, ref) {
  const want = _nr(_cleNue(ref));
  return (Array.isArray(journal) ? journal : [])
    .filter((e) => estManqueActif(e) && _nr(_cleNue(e.ref)) === want)
    .map((e) => ({ id: e.id, bailDebut: String(e.bailDebut || '').slice(0, 10), ym: String(e.ym || ''), montant: _r2(e.montant), motif: String(e.motif || ''), date: String(e.date || '').slice(0, 10) }));
}
