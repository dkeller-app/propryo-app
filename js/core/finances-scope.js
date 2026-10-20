/**
 * core/finances-scope.js — REFONTE FINANCES étape 1 « socle » (CDC-FINANCES § 1).
 *
 * LE résolveur de périmètre UNIQUE de l'onglet Finances (P-1, P-2, P-3). Aucun moteur ne
 * refait son filtrage maison : tous consomment `lotInScope` (appartenance d'un LOT) et
 * `scopeWeight` (poids d'un MOUVEMENT) — c'est la fin du constat C7.
 *
 *   P-1 · 3 crans : Tout → bailleur → immeuble. PAS de cran logement (décision Didier : le
 *         détail par lot reste une lecture, jamais un périmètre).
 *   P-2 · AUCUN LOT INVISIBLE : les lots sans bailleur vivent dans le panier
 *         « Sans bailleur (à rattacher) », ceux sans immeuble dans « Sans immeuble
 *         (à rattacher) ». Paniers SÉLECTIONNABLES, avec leur compte de lots.
 *         Corrige les constats 13 et 21 : aujourd'hui un lot sans entité est exclu de la
 *         vacance (`_computeBilanAnnuel` filtre `l.entity === entityNom`) mais compté dans
 *         l'impayé — il n'appartenait à aucun périmètre affichable.
 *   P-3 · une seule fonction d'appartenance, une seule fonction de poids.
 *   P-5 · le catalogue expose toujours les immeubles, même s'il n'y en a qu'un.
 *   P-6 · le garde-fou « hors périmètre » ne se tait plus : il pose `scope.fallback`,
 *         que l'UI DOIT annoncer.
 *
 * HORS PÉRIMÈTRE de ce module (étape 7) : P-4, la clé de répartition des frais bailleur.
 * Le défaut reste celui de la prod (`1 / nbImm`, cf `_finEntScope` index.html:50378) ; la clé
 * est INJECTABLE (`opts.sciWeight`, nombre ou fonction du mouvement) pour que l'étape 7 y
 * branche le potentiel locatif mensuel sans toucher à ce fichier.
 *
 * PUR : aucune lecture de DB, aucun DOM. Le parc (`logements`) est toujours injecté.
 * Tests : __tests__/helpers/finances-scope.test.js
 */

import { _groupLogementsByImm } from './group-by-imm.js';

export const SCOPE_KIND = { ALL: 'all', ENT: 'ent', IMM: 'imm' };

/** Clés réservées des paniers « à rattacher » (jamais un nom d'entité/immeuble réel). */
export const SANS_BAILLEUR = '__SANS_BAILLEUR__';
export const SANS_IMMEUBLE = '__SANS_IMMEUBLE__';
export const LABEL_SANS_BAILLEUR = 'Sans bailleur (à rattacher)';
export const LABEL_SANS_IMMEUBLE = 'Sans immeuble (à rattacher)';
export const LABEL_TOUT = 'Tout';

const _s = (v) => String(v == null ? '' : v).trim();
/** Ref tolérante — même politique que _baremeOfLot / _findBailByRefTolerant (trim + minuscule). */
const _nr = (v) => _s(v).toLowerCase();
const _alive = (o) => !!o && !o._deleted;
const _cmpFr = (a, b) => String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });

/** Lots vivants du parc, `entity`/`imm`/`ref` normalisés en surface (les objets ne sont pas copiés). */
function _liveLots(logements) {
  return (Array.isArray(logements) ? logements : []).filter(_alive);
}

/**
 * Catalogue du sélecteur en cascade : bailleurs (+ panier « Sans bailleur ») et, pour chacun,
 * ses immeubles (+ panier « Sans immeuble »). `immeubles` au premier niveau = le cran « Tout ».
 * Chaque nœud porte son `nbLots` : l'utilisateur voit le poids de ce qu'il choisit, et les
 * paniers cessent d'être des trous noirs.
 *
 * @param {Array} logements DB.logements (tombstones filtrés ici)
 * @param {{entites?:Array}} [opts] entités connues (objets {nom} ou chaînes) — un bailleur
 *        sans aucun lot reste sélectionnable (il peut porter des frais SCI).
 * @returns {{nbLots:number, entites:Array, immeubles:Array}}
 */
export function buildScopeCatalog(logements, opts) {
  const lots = _liveLots(logements);
  const connues = ((opts && opts.entites) || [])
    .map((e) => _s(typeof e === 'string' ? e : (e && e.nom)))
    .filter(Boolean);

  const parEnt = new Map();          // nom → lots
  const sansEnt = [];
  lots.forEach((l) => {
    const ent = _s(l.entity);
    if (!ent) { sansEnt.push(l); return; }
    if (!parEnt.has(ent)) parEnt.set(ent, []);
    parEnt.get(ent).push(l);
  });
  connues.forEach((nom) => { if (!parEnt.has(nom)) parEnt.set(nom, []); });

  const entites = Array.from(parEnt.keys()).sort(_cmpFr).map((nom) => ({
    key: nom, label: nom, unassigned: false,
    nbLots: parEnt.get(nom).length,
    immeubles: _immNodes(parEnt.get(nom))
  }));
  if (sansEnt.length) {
    entites.push({
      key: SANS_BAILLEUR, label: LABEL_SANS_BAILLEUR, unassigned: true,
      nbLots: sansEnt.length, immeubles: _immNodes(sansEnt)
    });
  }
  return { nbLots: lots.length, entites, immeubles: _immNodes(lots) };
}

/** Nœuds « immeuble » d'un jeu de lots — délègue le groupage/tri à _groupLogementsByImm (DRY). */
function _immNodes(lots) {
  return _groupLogementsByImm(lots).map((g) => (g.isUnassigned
    ? { key: SANS_IMMEUBLE, label: LABEL_SANS_IMMEUBLE, unassigned: true, nbLots: g.logements.length }
    : { key: g.imm, label: g.imm, unassigned: false, nbLots: g.logements.length }));
}

/**
 * Résout une sélection d'UI en périmètre exploitable par les 4 moteurs.
 *
 * @param {{ent?:string, imm?:string}} selection `ent`/`imm` = '' (tout), un nom, ou une clé
 *        de panier (SANS_BAILLEUR / SANS_IMMEUBLE).
 * @param {Array} logements DB.logements
 * @param {{entites?:Array, sciWeight?:number|function}} [opts]
 * @returns {Object} scope — voir `scopeWeight` / `lotInScope`
 */
export function resolveScope(selection, logements, opts) {
  const sel = selection || {};
  const o = opts || {};
  const lots = _liveLots(logements);
  const cat = buildScopeCatalog(lots, o);

  // P-6 : les replis sont CUMULÉS, jamais écrasés — si le bailleur ET l'immeuble sont
  // retombés, l'UI doit pouvoir annoncer les deux.
  const fallbacks = [];

  // ── Cran bailleur ─────────────────────────────────────────────────────────
  let entKey = _s(sel.ent);
  if (entKey && entKey !== SANS_BAILLEUR && !cat.entites.some((e) => e.key === entKey)) {
    fallbacks.push({ raison: 'ent-inconnu', entDemande: entKey });   // P-6 : on le DIT
    entKey = '';
  } else if (entKey === SANS_BAILLEUR && !cat.entites.some((e) => e.key === SANS_BAILLEUR)) {
    fallbacks.push({ raison: 'panier-vide', panier: SANS_BAILLEUR });  // plus aucun lot orphelin
    entKey = '';
  }
  // Lots du cran bailleur seul — passe par `lotInScope` (règle unique, paniers compris).
  const entCran = { kind: entKey ? SCOPE_KIND.ENT : SCOPE_KIND.ALL, entKey, immKey: '' };
  const entLots = lots.filter((l) => lotInScope(entCran, l));

  // ── Cran immeuble ─────────────────────────────────────────────────────────
  let immKey = _s(sel.imm);
  if (immKey && immKey !== SANS_IMMEUBLE && !entLots.some((l) => _s(l.imm) === immKey)) {
    fallbacks.push({ raison: 'imm-hors-perimetre', immDemande: immKey });
    immKey = '';
  } else if (immKey === SANS_IMMEUBLE && !entLots.some((l) => !_s(l.imm))) {
    fallbacks.push({ raison: 'panier-vide', panier: SANS_IMMEUBLE });  // tous les lots sont rattachés
    immKey = '';
  }

  const kind = immKey ? SCOPE_KIND.IMM : (entKey ? SCOPE_KIND.ENT : SCOPE_KIND.ALL);

  // Entité PORTEUSE des frais SCI. Sélection explicite, sinon dérivée de l'immeuble choisi
  // (parité `_finEntScope`) : elle ne sert QU'À la quote-part, jamais à l'appartenance des lots
  // — un lot de l'immeuble rattaché à un autre bailleur reste dans le périmètre (P-2).
  let ent = (entKey && entKey !== SANS_BAILLEUR) ? entKey : '';
  // La dérivation ne vaut QUE si aucun cran bailleur n'est posé : dans le panier
  // « Sans bailleur », aucun frais SCI ne peut se rattacher (sinon on importerait ceux d'un
  // bailleur étranger au panier).
  // LIMITE CONNUE, VOULUE (parité prod `_finEntScope`, PAS une régression) : si l'immeuble
  // héberge des lots de PLUSIEURS bailleurs, on retient le PREMIER rencontré — `ent`, donc
  // `nbImm` et la quote-part `sciWeight`, dépendent alors de l'ordre de `DB.logements`.
  // Un immeuble multi-bailleurs n'a pas de porteur de frais évident : le trancher est une
  // décision produit (étape 7 / P-4), pas un correctif de socle.
  if (!entKey && immKey && immKey !== SANS_IMMEUBLE) {
    const porteur = lots.find((l) => _s(l.imm) === immKey && _s(l.entity));
    if (porteur) ent = _s(porteur.entity);
  }
  // Immeubles du BAILLEUR (dénominateur de la quote-part), pas du périmètre affiché.
  const baseImm = ent ? lots.filter((l) => _s(l.entity) === ent) : entLots;
  const immsBailleur = Array.from(new Set(baseImm.map((l) => _s(l.imm)).filter(Boolean))).sort(_cmpFr);
  const nbImm = immsBailleur.length;

  // Quote-part des frais de niveau bailleur (comptable, frais bancaires, CFE, assurance SCI).
  // INVARIANT P-4 : Σ des vues immeuble = vue bailleur. Le panier « Sans immeuble » pèse donc
  // ZÉRO — un frais SCI est par définition déjà réparti INTÉGRALEMENT sur les immeubles réels ;
  // lui laisser un poids de 1 le comptait une 2ᵉ fois en entier (audit C1 : Σ = 2 pour 1).
  let sciWeight = 1;
  if (o.sciWeight != null) sciWeight = o.sciWeight;                      // P-4 (étape 7) injecté
  else if (immKey === SANS_IMMEUBLE) sciWeight = 0;
  else if (kind === SCOPE_KIND.IMM && nbImm > 0) sciWeight = 1 / nbImm;

  // Immeubles DU PÉRIMÈTRE (pour les mouvements de niveau immeuble).
  const imms = immKey === SANS_IMMEUBLE ? []
    : (immKey ? [immKey] : immsBailleur.slice());

  const scope = {
    kind, entKey, immKey, ent,
    immFilter: (immKey && immKey !== SANS_IMMEUBLE) ? immKey : null,
    sansBailleur: entKey === SANS_BAILLEUR,
    sansImmeuble: immKey === SANS_IMMEUBLE,
    imms, nbImm, sciWeight,
    fallbacks,
    fallback: fallbacks.length ? fallbacks[0] : null,   // compat : le 1er repli
    refs: [], refSet: null, refStricts: null, refAmbigus: null, immSet: null, nbLots: 0, label: ''
  };
  scope.refs = scopeRefs(scope, lots);
  // Index des refs : `scopeWeight` est appelé une fois PAR MOUVEMENT par chaque moteur
  // (60 lots × 8 000 mouvements = ~500 k normalisations par passe si on scanne).
  scope.refSet = new Set(scope.refs.map(_nr));           // rapprochement TOLÉRANT (trim+casse)
  scope.refStricts = new Set(scope.refs);                // rapprochement STRICT (parité prod)
  scope.immSet = new Set(imms);                          // mouvements de niveau immeuble
  // Refs AMBIGUËS du PARC : une ref normalisée qui désigne plusieurs lots (« M1 » et « m1 »).
  // La tolérance ne doit jamais créer d'argent — sur ces refs on repasse en strict, sinon le
  // même mouvement pèserait 1 dans deux vues immeuble et Σ vues > vue bailleur.
  const vus = new Map();
  lots.forEach((l) => {
    const r = _s(l.ref); if (!r) return;
    const n = _nr(r);
    if (!vus.has(n)) vus.set(n, new Set());
    vus.get(n).add(r);
  });
  scope.refAmbigus = new Set(Array.from(vus.keys()).filter((n) => vus.get(n).size > 1));
  scope.nbLots = scope.refs.length;
  scope.label = scopeLabel(scope);
  return scope;
}

/** Libellé affichable du périmètre (« SCI Alpha · Lilas », « Sans bailleur (à rattacher) »…). */
export function scopeLabel(scope) {
  if (!scope || scope.kind === SCOPE_KIND.ALL) return LABEL_TOUT;
  const g = scope.entKey === SANS_BAILLEUR ? LABEL_SANS_BAILLEUR : scope.entKey;
  const d = scope.immKey === SANS_IMMEUBLE ? LABEL_SANS_IMMEUBLE : scope.immKey;
  return [g, d].filter(Boolean).join(' · ') || LABEL_TOUT;
}

/**
 * APPARTENANCE D'UN LOT — la fonction unique (P-3). Consommée par la vacance/occupation,
 * le recouvrement, le tableau : plus aucun moteur ne réécrit `l.entity === X`.
 * @param {Object|null} scope null / cran « Tout » → tout lot vivant appartient
 * @param {Object} lot logement
 */
export function lotInScope(scope, lot) {
  if (!_alive(lot)) return false;
  if (!scope || scope.kind === SCOPE_KIND.ALL) return true;
  const ent = _s(lot.entity), imm = _s(lot.imm);
  if (scope.entKey === SANS_BAILLEUR) { if (ent) return false; }
  else if (scope.entKey && ent !== scope.entKey) return false;
  if (scope.immKey === SANS_IMMEUBLE) return !imm;
  if (scope.immKey) return imm === scope.immKey;
  return true;
}

/** Lots du périmètre (objets), ordre d'origine préservé. */
export function scopeLots(scope, logements) {
  return _liveLots(logements).filter((l) => lotInScope(scope, l));
}

/** Refs des lots du périmètre — même règle que `lotInScope`, jamais un filtre parallèle. */
export function scopeRefs(scope, logements) {
  return scopeLots(scope, logements).map((l) => _s(l.ref)).filter(Boolean);
}

/**
 * POIDS D'UN MOUVEMENT dans le périmètre — la fonction unique (P-3, remplace
 * `_finScopeWeight` index.html:50397). 0 = hors périmètre · 1 = rattaché · 0..1 = quote-part
 * d'un frais de niveau bailleur en vue immeuble.
 *
 * Règles (parité `_compute2044` conservée) :
 *   - `qui` = ref d'un lot du périmètre → 1 (ref tolérante : trim + casse) ;
 *   - `qui` = 'SCI:<bailleur>' → quote-part `scope.sciWeight` (clé P-4 injectable) ;
 *   - `qui` VIDE et `imm` dans le périmètre → 1 (un mouvement de niveau immeuble ne compte
 *     que si aucun lot n'est désigné, sinon il serait compté deux fois) ;
 *   - sinon 0.
 *
 * @param {Object|null} scope
 * @param {Object} mv mouvement
 * @returns {number} 0..1
 */
export function scopeWeight(scope, mv) {
  if (!mv || mv._deleted) return 0;
  if (!scope || scope.kind === SCOPE_KIND.ALL) return 1;
  const qui = _s(mv.qui);
  // Index précalculé quand le scope vient de `resolveScope` ; repli scan pour un scope
  // construit à la main (tests, appelants historiques). Sur une ref AMBIGUË du parc, la
  // comparaison redevient STRICTE : la tolérance ne doit jamais dupliquer un montant.
  if (qui) {
    const n = _nr(qui);
    if (scope.refAmbigus && scope.refAmbigus.has(n)) {
      if (scope.refStricts.has(qui)) return 1;
    } else if (scope.refSet ? scope.refSet.has(n) : (scope.refs || []).some((r) => _nr(r) === n)) {
      return 1;
    }
  }
  if (scope.ent && qui === 'SCI:' + scope.ent) {
    const w = typeof scope.sciWeight === 'function' ? scope.sciWeight(mv) : scope.sciWeight;
    const n = Number(w);
    // Une clé de répartition cassée ne doit JAMAIS retomber sur 1 : elle donnerait à CHAQUE
    // immeuble la totalité du frais (Σ vues = nbImm × le montant) — exactement la famille de
    // défaut de C1. On échoue bruyamment plutôt que de sur-compter en silence.
    if (!Number.isFinite(n)) {
      throw new TypeError('finances-scope : cle de repartition sciWeight invalide (' + w + ')');
    }
    return Math.min(1, Math.max(0, n));
  }
  if (!qui) {
    const im = _s(mv.imm);
    if (scope.immSet ? scope.immSet.has(im) : (scope.imms || []).indexOf(im) >= 0) return 1;
  }
  return 0;
}

/** `scopeWeight > 0` — remplace `_finInScope`. */
export function inScope(scope, mv) { return scopeWeight(scope, mv) > 0; }
