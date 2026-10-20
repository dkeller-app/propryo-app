/**
 * core/utils.js — Helpers utilitaires purs (sans dépendance DB / DOM).
 *
 * Source unique de vérité pour les helpers d'échappement HTML, validation,
 * classification de catégories, etc.
 *
 * Importé par les tests Vitest et par js/main.js (qui expose à window pour
 * compatibilité avec les onclick inline encore présents dans index-test.html).
 */

// ────────────────────────────────────────────────────────────────────────────
// Sanitize / échappement HTML (Sprint 1A SECU-INNERHTML)
// ────────────────────────────────────────────────────────────────────────────

/** Échappe une string pour injection HTML safe. null/undefined → ''. */
export function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Alias court */
export const _esc = escHtml;

/** Tag function template literal qui escape automatiquement chaque ${...}.
 *  Pour injecter du HTML brut (composition), wrapper _raw(s). */
export function _h(strings, ...values) {
  let r = '';
  for (let i = 0; i < strings.length; i++) {
    r += strings[i];
    if (i < values.length) {
      const v = values[i];
      if (v && typeof v === 'object' && v.__raw === true) r += v.value;
      else r += escHtml(v);
    }
  }
  return r;
}

/** Marqueur "trusted HTML" pour bypass volontaire dans _h. */
export function _raw(s) { return { __raw: true, value: String(s == null ? '' : s) }; }

// ────────────────────────────────────────────────────────────────────────────
// Validation montants (Sprint 1B BUG-HC-GARDE-FOU)
// ────────────────────────────────────────────────────────────────────────────

export function _validateHC(value) {
  const n = Number(value);
  if (Number.isNaN(n) || value === '' || value == null) {
    return { valid: false, value: 0, reason: 'Montant non numérique' };
  }
  if (n < 1) return { valid: false, value: n, reason: 'Montant nul ou négatif' };
  if (n > 50000) return { valid: false, value: n, reason: 'Montant excessif (> 50 000 €/mois)' };
  return { valid: true, value: n };
}

export function _validateHCCH(hc, ch) {
  const hcN = Number(hc) || 0;
  const chN = Number(ch) || 0;
  if (hcN <= 0) return { coherent: false, ratio: 0, reason: 'HC manquant ou nul' };
  if (chN < 0) return { coherent: false, ratio: 0, reason: 'CH négatif' };
  const ratio = chN / hcN;
  if (ratio > 1) return { coherent: false, ratio, reason: 'Charges > loyer principal (anormal)' };
  if (ratio > 0.5) return { coherent: false, ratio, reason: 'Charges > 50% du loyer (à vérifier)' };
  return { coherent: true, ratio };
}

export function _outlierVsMedian(value, median, threshold = 10) {
  const v = Number(value) || 0;
  const m = Number(median) || 0;
  if (m <= 0 || v <= 0) return { outlier: false, ratio: 0 };
  const ratio = v / m;
  if (ratio >= threshold || ratio <= 1 / threshold) return { outlier: true, ratio };
  return { outlier: false, ratio };
}

// ────────────────────────────────────────────────────────────────────────────
// DPE / gel IRL loi Climat 2021 (Sprint 1B)
// ────────────────────────────────────────────────────────────────────────────

const DPE_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

export function _isDpeClassValide(classe) {
  return DPE_CLASSES.includes(String(classe || '').toUpperCase());
}

export function _bailGelDpeFG(bail) {
  if (!bail) return false;
  const c = String(bail.dpe || '').toUpperCase();
  return c === 'F' || c === 'G';
}

export function _dpeExpire(dpeDateIso, refDate = new Date()) {
  if (!dpeDateIso) return false;
  const dpeDate = new Date(dpeDateIso);
  if (Number.isNaN(dpeDate.getTime())) return false;
  const tenYearsLater = new Date(dpeDate);
  tenYearsLater.setFullYear(tenYearsLater.getFullYear() + 10);
  return refDate >= tenYearsLater;
}

export function _estRevisableIRL(bail) {
  if (!bail) return { revisable: false, blocking: true, raison: 'Bail non fourni' };
  const c = String(bail.dpe || '').toUpperCase();
  if (!c) return { revisable: false, blocking: true, raison: 'DPE non renseigné' };
  if (!_isDpeClassValide(c)) return { revisable: false, blocking: true, raison: 'DPE invalide' };
  if (c === 'F' || c === 'G') {
    return { revisable: false, blocking: true, raison: `Loyer gelé DPE ${c} (loi Climat 2021 art 23, 24/08/2022)` };
  }
  if (_dpeExpire(bail.dpeDate)) {
    return { revisable: true, blocking: false, raison: 'DPE expiré (> 10 ans) — révision autorisée mais à renouveler' };
  }
  return { revisable: true, blocking: false, raison: '' };
}

// ────────────────────────────────────────────────────────────────────────────
// LEGAL-DPE-INTERDICTION-LOCATION — v15.05 Sprint 7 V1.1
// Loi Climat & Résilience 2021-1104, art. 23 + décret 2022-945.
// Calendrier interdictions nouvelle location :
//   - 1er janvier 2023 : G+ (conso > 450 kWh/m²/an) interdits
//   - 1er janvier 2025 : G interdits
//   - 1er janvier 2028 : F interdits
//   - 1er janvier 2034 : E interdits
// Override IMPOSSIBLE (amende 15 000 €). Différent du gel IRL (qui est sur
// baux en cours) : ici on bloque la CRÉATION/RENOUVELLEMENT d'un nouveau bail.
// ────────────────────────────────────────────────────────────────────────────

const DPE_INTERDICTION_CALENDRIER = [
  // Note : 'G+' = G avec conso > 450 kWh/m²/an. Pas systématiquement encodé
  // côté DB ; on traite ici sur la classe seule. La distinction G/G+ peut
  // être ajoutée plus tard via un champ logement.dpeKwh.
  { classe: 'G', anneeBlocage: 2025, dateBlocage: '2025-01-01', loi: 'Loi Climat 2021-1104 art. 23' },
  { classe: 'F', anneeBlocage: 2028, dateBlocage: '2028-01-01', loi: 'Loi Climat 2021-1104 art. 23' },
  { classe: 'E', anneeBlocage: 2034, dateBlocage: '2034-01-01', loi: 'Loi Climat 2021-1104 art. 23' }
];

/**
 * Indique si un logement classé `dpe` est interdit à la location à la date `dateRef`.
 * @param {string} dpe — classe DPE 'A'..'G' (case-insensitive)
 * @param {string|Date} dateRef — date à laquelle on souhaite signer/renouveler le bail (ISO YYYY-MM-DD ou Date)
 * @returns {{ interdit: boolean, raison: string, anneeBlocage: number|null, dateBlocage: string|null, classe: string }}
 *
 * Notes :
 *   - DPE A à D : jamais interdit.
 *   - DPE E à G : interdit à partir de la date de blocage du calendrier (incluse).
 *   - DPE absent ou invalide : retourne `interdit: false` (pas notre rôle d'imposer
 *     un DPE — d'autres garde-fous gèrent l'absence de DPE, ici on parle d'interdiction
 *     stricte loi Climat).
 */
export function _dpeInterditLocationAuDate(dpe, dateRef) {
  const result = { interdit: false, raison: '', anneeBlocage: null, dateBlocage: null, classe: '' };
  if (!dpe) return result;
  const c = String(dpe).toUpperCase().trim();
  if (!_isDpeClassValide(c)) return result;
  result.classe = c;
  const rule = DPE_INTERDICTION_CALENDRIER.find(r => r.classe === c);
  if (!rule) return result; // DPE A-D : jamais interdit
  // Normalise dateRef
  let refTs;
  if (dateRef instanceof Date) {
    refTs = dateRef.getTime();
  } else if (typeof dateRef === 'string' && dateRef.length >= 10) {
    refTs = new Date(dateRef.slice(0, 10) + 'T00:00:00').getTime();
  } else {
    refTs = new Date().getTime();
  }
  if (Number.isNaN(refTs)) return result;
  const blockTs = new Date(rule.dateBlocage + 'T00:00:00').getTime();
  if (refTs >= blockTs) {
    result.interdit = true;
    result.anneeBlocage = rule.anneeBlocage;
    result.dateBlocage = rule.dateBlocage;
    result.raison = `DPE ${c} interdit à la location depuis le ${rule.dateBlocage} (${rule.loi})`;
  }
  return result;
}

/** Expose le calendrier pour UI (lentille Conformité, alertes). */
export function _dpeInterdictionCalendrier() {
  return DPE_INTERDICTION_CALENDRIER.slice(); // copie défensive
}

// ────────────────────────────────────────────────────────────────────────────
// Classification catégories (Sprint 1C BUG-CHARGE-001)
// ────────────────────────────────────────────────────────────────────────────

/** Référentiel par défaut utilisé par les tests. En prod, on lui passe le STD_CATEGORIES global. */
const STD_CATEGORIES_DEFAULT = [
  { nom: 'Loyers encaissés', ligne2044: '211', type: 'recette' },
  { nom: 'Charges de copropriété', ligne2044: '229', type: 'charge' },
  { nom: 'Charges récupérables non récupérées', ligne2044: '225', type: 'charge' },
  { nom: 'Régularisation provisions copro N-1', ligne2044: '230', type: 'charge' },
  { nom: 'Charges récupérables (eau, énergie…)', ligne2044: '', type: 'special', recup: true },
  { nom: 'Travaux (entretien, réparation, amélioration)', ligne2044: '224', type: 'charge' },
  { nom: 'Primes d\'assurance (PNO, GLI)', ligne2044: '223', type: 'charge' }
];

function _findStd(stdCats, nom) {
  return (stdCats || STD_CATEGORIES_DEFAULT).find(c => c.nom === nom);
}

/**
 * R0-D (AUDIT-GLOBAL) — Normalise le 2e argument des classifieurs.
 *
 * Deux formes acceptées, pour que l'app injecte son VRAI contexte sans casser les appelants
 * historiques (même patron d'injection que `_computeFinancesMonthly`, qui reçoit `catLigne`) :
 *   - `Array`  → référentiel seul (forme historique des tests) ;
 *   - `Object` → `{ stdCats, alias, mapping }` — le contexte complet de l'app :
 *       `alias`   = `DB.catAlias`   (règle M-1 : toute catégorie perso est un alias d'une mère),
 *       `mapping` = `DB.catMapping` ou `params.legal2044Mapping` ('__ignore' = hors 2044).
 *
 * Sans argument, on retombe sur le référentiel par défaut — suffisant pour les libellés
 * standard, jamais pour une catégorie perso : c'est précisément pourquoi l'app doit injecter.
 */
function _catCtx(arg) {
  if (Array.isArray(arg)) return { stdCats: arg, alias: null, mapping: null };
  if (arg && typeof arg === 'object') {
    return {
      stdCats: Array.isArray(arg.stdCats) ? arg.stdCats : STD_CATEGORIES_DEFAULT,
      alias: arg.alias || null,
      mapping: arg.mapping || null
    };
  }
  return { stdCats: STD_CATEGORIES_DEFAULT, alias: null, mapping: null };
}

/** Lecture de table SÛRE : une clé héritée (`toString`, `constructor`…) ne doit rien rattacher. */
function _own(obj, key) {
  return (obj && Object.prototype.hasOwnProperty.call(obj, key)) ? obj[key] : undefined;
}

/**
 * Catégorie mère d'un nom : hit direct dans le référentiel, sinon résolution d'alias.
 * Le hit STD prime : le référentiel est figé, un alias ne peut pas remapper une mère.
 * Renvoie l'entrée du référentiel, ou undefined.
 */
function _catMere(cat, ctx) {
  const std = _findStd(ctx.stdCats, cat);
  if (std) return std;
  const al = _own(ctx.alias, cat);
  return al ? _findStd(ctx.stdCats, al) : undefined;
}

/**
 * R0-D — LE PONT app→module : construit le contexte de classification depuis `DB`.
 *
 * Il vit ICI, dans le module testé, et non dans le câblage de `js/main.js` : c'est
 * exactement ce pont qui était cassé, il doit donc être couvert par des tests.
 *
 * Deux points de fidélité à l'ancien inline du monolithe, non négociables :
 *  - **repli CLÉ PAR CLÉ** : l'ancien écrivait `catMapping[cat] || legal2044Mapping[cat]`.
 *    Une valeur FALSY dans `catMapping` laissait donc le wizard 2044 reprendre la main.
 *    Une fusion d'objets naïve (`Object.assign`) casse ça et fait disparaître un loyer.
 *  - **prototype nul** : `Object.assign` déclenche le *setter* `__proto__`, si bien qu'un
 *    snapshot hostile (`JSON.parse('{"__proto__":{"Ma cat":"211"}}')`) reclasserait une
 *    catégorie en loyer par la chaîne de prototypes. `Object.create(null)` l'interdit.
 *
 * @param {object} db      DB de l'app (catAlias, catMapping, params.legal2044Mapping)
 * @param {Array} stdCats  référentiel réel de l'app (STD_CATEGORIES)
 */
/**
 * R0-D — Le DB VIVANT de l'app.
 *
 * Piège : `DB` est déclaré en `let` au niveau d'un script classique du monolithe. Il vit donc dans
 * l'environnement LEXICAL global et n'est **pas** une propriété de `window` — `window.DB` est un
 * simple miroir posé par `__immoSetDB` (chemin cloud), absent en session locale et périmé dès que
 * le `let DB` est réassigné (import, restauration, hydratation).
 *
 * Lire `window.DB` donne donc `undefined` la plupart du temps, et le classement retombe
 * silencieusement sans alias : c'est très exactement le bug R0-D, reconduit par sa propre
 * correction. Le dépôt a déjà le bon geste (`js/app/supabase-entry.js:65-66`) : le getter vivant.
 *
 * @param {object} win objet global (injecté pour être testable)
 * @returns {object|null}
 */
export function appDbFrom(win) {
  const W = win || null;
  if (!W) return null;
  if (typeof W.__immoGetDB === 'function') {
    // Le getter fait AUTORITÉ, y compris quand il répond « pas de DB ». `window.DB` est un miroir
    // posé par `__immoSetDB` que RIEN n'efface à la déconnexion ni au changement d'espace : lui
    // préférer le miroir reviendrait à classer avec le `catAlias` d'un AUTRE espace.
    try { return W.__immoGetDB() || null; } catch (e) { return W.DB || null; }
  }
  return W.DB || null;   // index.html sans le getter (ancien) → miroir, faute de mieux
}

export function catCtxFromDb(db, stdCats) {
  const D = db || {};
  const legal = (D.params && D.params.legal2044Mapping) || {};
  const cm = D.catMapping || {};
  const mapping = Object.create(null);
  for (const k of Object.keys(legal)) { if (legal[k]) mapping[k] = legal[k]; }
  for (const k of Object.keys(cm)) { if (cm[k]) mapping[k] = cm[k]; }
  return {
    stdCats: Array.isArray(stdCats) ? stdCats : undefined,
    alias: D.catAlias || null,
    mapping
  };
}

/**
 * Ligne 2044 d'une catégorie — LE résolveur unique (remplace la copie inline du monolithe).
 * Ordre : nom exact → alias vers une mère → mapping legacy ('__ignore' ⇒ hors 2044, donc null).
 */
export function _catLigne2044(cat, arg) {
  if (!cat) return null;
  const ctx = _catCtx(arg);
  const mere = _catMere(cat, ctx);
  if (mere) return mere.ligne2044 || null;
  const m = _own(ctx.mapping, cat) || null;
  return (m === '__ignore') ? null : m;
}

/**
 * R0-D — Fabrique un lecteur de contexte MÉMOÏSÉ sur `_dbGen`.
 *
 * Pourquoi : les classifieurs tournent dans des `.filter()` sur `DB.mouvements`, une dizaine de
 * boucles par rendu d'Accueil. Reconstruire le mapping à chaque appel coûte, mesuré dans l'app :
 * 52 ms sur un parc courant (25 catégories × 2 000 mouvements), 488 ms à 200 catégories — soit du
 * jank visible, justement sur le profil « parc importé avec beaucoup de catégories perso » que ce
 * correctif vise. L'ancien inline, lui, faisait deux accès de propriété.
 *
 * `_dbGen` est le signal d'invalidation du dépôt (bumpé par `saveDB`, `__immoSetDB`, la
 * restauration), déjà utilisé pour mémoïser le statut des loyers et Finances — on le réutilise,
 * on n'en invente pas un autre.
 *
 * **Sans `_dbGen`, on ne mémoïse jamais** : la justesse prime sur la vitesse.
 */
export function makeCatCtxCache() {
  let gen = null, db = null, ctx = null;
  return function (win) {
    const W = win || null;
    const d = appDbFrom(W);
    // NaN !== NaN : pas de `_dbGen` ⇒ la comparaison échoue toujours ⇒ reconstruction à chaque appel.
    const g = (W && typeof W._dbGen === 'number') ? W._dbGen : NaN;
    // L'IDENTITÉ de l'objet DB compte autant que la génération : l'adoption cross-onglet
    // (`index.html:59394`) fait `DB = newDB` puis REND, sans bumper `_dbGen`. Sans cette
    // comparaison, on classerait le nouvel état avec l'ancienne table d'alias — R0-D, reconduit
    // par le cache censé accélérer sa correction. Couvre aussi les autres réassignations de `DB`.
    if (ctx !== null && g === gen && d === db) return ctx;
    ctx = catCtxFromDb(d, W && W.STD_CATEGORIES);
    gen = g; db = d;
    return ctx;
  };
}

/** True si cette catégorie compte comme "loyer encaissé" pour la régul. */
export function _isLoyerCategory(cat, arg) {
  if (!cat) return false;
  // NORMALISATION-LOYERS (01/10) : plus aucune tolérance de la catégorie héritée « Loyers ». Les données
  // sont normalisées en « Loyers encaissés » à chaque porte d'entrée (js/core/normalisation-loyers.js :
  // chargement, restauration, import JSON). Seul le référentiel, l'alias ou le mapping 211 rattachent.
  const ctx = _catCtx(arg);
  const mere = _catMere(cat, ctx);
  if (mere) return mere.type === 'recette' && mere.ligne2044 === '211';
  // Pas de mère connue : seul le mapping legacy peut encore rattacher à la ligne 211.
  return _catLigne2044(cat, arg) === '211';
}

/** True si cette catégorie compte comme "charge récupérable" refacturable. */
export function _isChargeRecupCategory(cat, arg) {
  if (!cat) return false;
  if (cat === 'Charges') return true;
  const std = _catMere(cat, _catCtx(arg));
  // v15.x FIX-REGUL-RECUP : la catégorie « Charges récupérables (eau, énergie…) »
  // porte le flag recup (hors 2044). C'est l'intitulé que l'utilisateur tague à
  // l'import pour l'eau/énergie. La régul DOIT la prendre (avant : ignorée car ligne vide).
  if (std && std.recup) return true;
  // 229 Provisions copro + 230 Régul N-1 = récupérables. 225 = part bailleur (non refacturable),
  // 221/223/224 = charges propriétaire → exclus. On passe par le résolveur de ligne pour attraper
  // aussi les catégories rattachées par le MAPPING legacy, pas seulement par leur nom ou leur alias.
  const ln = _catLigne2044(cat, arg);
  return ln === '229' || ln === '230';
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers temporels (Sprint 1D BUG-DASH-001)
// ────────────────────────────────────────────────────────────────────────────

/** True si bail.debut <= dateRef <= bail.fin (ou pas de fin = ouvert). */
export function _bailEstActifAt(log, dateRef) {
  if (!log || !log.debut) return false;
  const refStr = String(dateRef);
  const refTs = new Date(refStr + (refStr.length === 10 ? 'T00:00:00' : '')).getTime();
  const debutTs = new Date(log.debut + 'T00:00:00').getTime();
  if (Number.isNaN(refTs) || Number.isNaN(debutTs)) return false;
  if (debutTs > refTs) return false;
  if (!log.fin) return true;
  const finTs = new Date(log.fin + 'T23:59:59').getTime();
  return finTs >= refTs;
}

/** Loyer HC en vigueur à la date donnée, en consultant irlHistorique[].
 *  En prod : passer DB.irlHistorique. En tests : passer un array dédié. */
export function _loyerHCAtDate(log, dateRef, irlHistorique = []) {
  if (!log) return 0;
  const refStr = String(dateRef);
  const refTs = new Date(refStr + (refStr.length === 10 ? 'T00:00:00' : '')).getTime();
  if (Number.isNaN(refTs)) return Number(log.hc) || 0;
  // Ref TOLÉRANTE (trim + minuscule), comme partout ailleurs dans l'app (_findBailByRefTolerant,
  // validateNewRef) : une révision enregistrée avec une ref légèrement différente (re-bail, import,
  // casse/espaces) reste rattachée → plus de repli rétroactif sur le loyer courant (bug user 2026-07-14).
  const _nr = s => String(s == null ? '' : s).trim().toLowerCase();
  const _wantRef = _nr(log.ref);
  // AUDIT-SUIVI-LOYERS Q1 : le loyer d'un mois suit la DATE D'EFFET explicite (`dateEffet`), jamais
  // l'anniversaire (`dateRevision`, resté la clé de cycle IRL). Fin de la sur-facturation rétroactive
  // (cause Fric). Repli sur dateRevision pour les entrées legacy (avant v15.484, réparées par la migration).
  const _eff = h => h.dateEffet || h.dateRevision;
  const hist = (irlHistorique || [])
    .filter(h => h && !h._deleted && _nr(h.ref) === _wantRef && h.action !== 'renonciation' && _eff(h));
  if (!hist.length) return Number(log.hc) || 0;
  const sorted = hist.slice().sort((a, b) => _eff(a).localeCompare(_eff(b)));
  if (refTs < new Date(_eff(sorted[0]) + 'T00:00:00').getTime()) {
    return Number(sorted[0].ancienHC) || Number(log.hc) || 0;
  }
  let applicable = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (new Date(_eff(sorted[i]) + 'T00:00:00').getTime() <= refTs) {
      applicable = sorted[i];
      break;
    }
  }
  return applicable ? (Number(applicable.nouveauHC) || Number(log.hc) || 0) : (Number(log.hc) || 0);
}

/** Charges en vigueur à la date donnée. Stub : pas d'historique CH dans schéma actuel. */
export function _chargesAtDate(log /*, dateRef, chHistorique */) {
  if (!log) return 0;
  return Number(log.ch) || 0;
}

// ────────────────────────────────────────────────────────────────────────────
// Prorata loyer intra-mois (v15.19 — Phase A1 BUG-PRORATA-DASH)
// Loi 6 juillet 1989 + jurisprudence Cass. 3e civ. : loyer dû au prorata du
// temps d'occupation pour entrée/sortie/transition intra-mois.
//
// AVANT v15.19 : _getActiveBailHcCh testait au 15 du mois et retournait le
// loyer plein si actif. Bug : locataire entré le 10/03 → attendu plein 1000€
// → payé prorata 710€ → marqué "impayé" à tort dans dashboard + quittances.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Calcule le loyer attendu (HC+CH) pour un logement sur un mois donné, avec
 * prorata jours pour entrées/sorties/transitions de bail intra-mois.
 *
 * Gère naturellement :
 *   - Bail démarrant en cours de mois (entrée mi-mois)
 *   - Bail finissant en cours de mois (sortie mi-mois)
 *   - Transition de 2 baux dans le même mois (somme prorata)
 *   - Bail courant (sans fin OU fin future) : HC via _loyerHCAtDate (révisions IRL)
 *   - Bail historique clôturé : bail.hc figé (pas de révision rétroactive)
 *
 * @param {object} log — logement (au moins {ref, hc})
 * @param {string|number} yr — année (ex: 2026 ou '2026')
 * @param {number} mi — index du mois 0-based (0=jan, 11=dec)
 * @param {Array<{debut, fin, hc, ch}>} bails — TOUS les baux du logement
 * @param {Array} irlHistorique — révisions IRL (peut être [] ou omis)
 * @param {Date} [todayRef] — date "aujourd'hui" pour distinguer bail courant vs historique (test only)
 * @returns {number} montant prorata total HC+CH pour le mois (somme baux qui chevauchent)
 */
// Split proraté {hc, ch} d'un mois (somme des baux qui chevauchent). Le HC/CH est déjà
// proratisé jours-d'occupation — c'est LA source du dû pour la cascade d'imputation
// (_loyerSplitCascade). _loyerProrataMois délègue à ce split (DRY, comportement inchangé = hc+ch).
export function _loyerProrataMoisSplit(log, yr, mi, bails, irlHistorique = [], todayRef = new Date()) {
  const empty = { hc: 0, ch: 0 };
  if (!log || !Array.isArray(bails) || !bails.length) return empty;
  const y = parseInt(yr);
  const m = parseInt(mi);
  if (Number.isNaN(y) || Number.isNaN(m) || m < 0 || m > 11) return empty;

  // Bornes ISO du mois
  const mm = String(m + 1).padStart(2, '0');
  const firstDayOfMonth = `${y}-${mm}-01`;
  const lastDayNum = new Date(y, m + 1, 0).getDate(); // 28/29/30/31
  const lastDayOfMonth = `${y}-${mm}-${String(lastDayNum).padStart(2, '0')}`;
  const joursDansMois = lastDayNum;

  const todayIso = todayRef.toISOString().slice(0, 10);

  let hcTotal = 0, chTotal = 0;

  for (const bail of bails) {
    if (!bail || !bail.debut) continue;
    const bDebut = String(bail.debut).slice(0, 10);
    const bFin = bail.fin ? String(bail.fin).slice(0, 10) : '9999-12-31';
    // Le bail chevauche-t-il le mois ?
    if (bDebut > lastDayOfMonth) continue;
    if (bFin < firstDayOfMonth) continue;
    // Période effective intersectée avec le mois
    const debutEff = bDebut > firstDayOfMonth ? bDebut : firstDayOfMonth;
    const finEff = bFin < lastDayOfMonth ? bFin : lastDayOfMonth;
    if (debutEff > finEff) continue;
    // Jours d'occupation = (finDay - debutDay) + 1
    const debutDay = parseInt(debutEff.slice(8, 10));
    const finDay = parseInt(finEff.slice(8, 10));
    const joursOcc = (finDay - debutDay) + 1;
    if (joursOcc <= 0) continue;
    // HC à appliquer : bail courant → _loyerHCAtDate (consulte révisions IRL)
    // Bail historique clôturé → bail.hc figé (clos avec son HC final)
    const isCurrent = !bail.fin || bail.fin >= todayIso;
    const hc = isCurrent
      ? _loyerHCAtDate(log, debutEff, irlHistorique)
      : (Number(bail.hc) || 0);
    const ch = Number(bail.ch) || 0;
    const f = joursOcc / joursDansMois;
    hcTotal += hc * f;
    chTotal += ch * f;
  }

  return { hc: hcTotal, ch: chTotal };
}
export function _loyerProrataMois(log, yr, mi, bails, irlHistorique = [], todayRef = new Date()) {
  const s = _loyerProrataMoisSplit(log, yr, mi, bails, irlHistorique, todayRef);
  return s.hc + s.ch;
}

// ────────────────────────────────────────────────────────────────────────────
// Calendrier français — source unique (REFONTE-FINANCES socle, 2026-08)
// ────────────────────────────────────────────────────────────────────────────

/** Noms des mois en français, index 0 = janvier. Consommé par finances-window.js.
 *  (Des copies privées subsistent dans js/app/app-part1.js et app-part2.js — MOIS, MOIS_FR,
 *  _QA_MOIS_FR… — à replier sur celle-ci hors chantier Finances.) */
export const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
