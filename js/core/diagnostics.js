/**
 * core/diagnostics.js — BAILLEUR-DIAGNOSTICS-DDT v15.05 Sprint 7 V1.1
 *
 * Helpers purs (sans DB / DOM) pour la gestion du Dossier Diagnostic Technique
 * (DDT) à charge bailleur. 9 diagnostics couverts selon loi 89-462 art. 3-3.
 *
 * Modèle de données attendu sur un logement :
 *   logement.diagnostics = {
 *     dpe:      { date, classe, valeurKwh, diagnostiqueur, pjDocId, na, notes },
 *     crep:     { date, presence, diagnostiqueur, pjDocId, na, notes },
 *     amiante:  { date, presence, diagnostiqueur, pjDocId, na, notes },
 *     gaz:      { date, conforme, diagnostiqueur, pjDocId, na, notes },
 *     elec:     { date, conforme, diagnostiqueur, pjDocId, na, notes },
 *     erp:      { date, expose, diagnostiqueur, pjDocId, na, notes },
 *     termites: { date, presence, diagnostiqueur, pjDocId, na, notes },
 *     merule:   { date, presence, diagnostiqueur, pjDocId, na, notes },
 *     bruit:    { date, zone, diagnostiqueur, pjDocId, na, notes }
 *   }
 *
 * Rétrocompat : `log.dpe` (classe) + `log.dpeDate` (date) restent supportés
 * en lecture via `_diagGet(log, 'dpe')` qui fallback sur les champs flat.
 *
 * Tests Vitest miroir : __tests__/helpers/diagnostics.test.js
 */

// ────────────────────────────────────────────────────────────────────────────
// Période de construction → 3 tranches LÉGALES (source unique)
// Personne n'a l'année exacte : la PÉRIODE pilote plomb & amiante ; l'année
// (legacy) sert de repli exact quand elle est présente.
//   Avant 1949 → plomb + amiante · De 1949 à 1997 → amiante · Après 1997 → aucun.
// ────────────────────────────────────────────────────────────────────────────

export function periodeLegale(periode, annee) {
  const a = Number(annee);
  // Amiante = permis avant le 1er JUILLET 1997 → à la granularité de l'année, 1997 est INCLUS (prudence : jamais sous-appliquer un diagnostic obligatoire). Plomb = avant le 1er janvier 1949 (exact).
  if (a && a >= 1000) return a < 1949 ? 'Avant 1949' : (a < 1998 ? 'De 1949 à 1997' : 'Après 1997');
  switch (periode) {
    case 'Avant 1949': return 'Avant 1949';
    case 'De 1949 à 1997': return 'De 1949 à 1997';
    case 'Après 1997': return 'Après 1997';
    case 'De 1949 à 1974':
    case 'De 1975 à 1989':
    case 'De 1990 à 2005': return 'De 1949 à 1997';   // ancien bucket sans année : prudence (amiante possible)
    case 'Depuis 2005': return 'Après 1997';
    default: return '';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Catalogue des 9 diagnostics — source unique
// ────────────────────────────────────────────────────────────────────────────

export const DIAGS_CATALOG = [
  {
    key:    'dpe',
    label:  'DPE — Performance énergétique',
    validityYears: 10,
    legal:  'Loi 2010-788 + décret 2020-1610',
    icon:   '🌡',
    joindreAuBail: true,
    /** DPE applicable à TOUS les logements habitation. */
    isApplicable: () => true
  },
  {
    key:    'crep',
    label:  'CREP — Plomb (saturnisme)',
    validityYears: null, // location : 6 ans si présence de plomb (> 1 mg/cm²), illimité si absence (1 an = règle vente)
    validityIfPresence: 6,
    legal:  'Art. L1334-5 à L1334-9 Code santé publique',
    icon:   '⚠',
    joindreAuBail: true,
    /** CREP : logements dont le permis de construire est antérieur au 1er janvier 1949.
     *  Piloté par la PÉRIODE (année legacy en repli via periodeLegale). */
    isApplicable: (log) => {
      const p = periodeLegale(log?.periodeConstr, log?.anneeConstruction);
      return p ? (p === 'Avant 1949') : null; // info manquante → ne sait pas
    }
  },
  {
    key:    'amiante',
    label:  'Amiante (DAPP)',
    validityYears: null, // illimité si absence
    legal:  'Art. R1334-15 à R1334-29 Code santé publique',
    icon:   '🧪',
    joindreAuBail: true,
    /** Amiante : permis de construire avant le 1er juillet 1997.
     *  Piloté par la PÉRIODE (année legacy en repli via periodeLegale). */
    isApplicable: (log) => {
      const p = periodeLegale(log?.periodeConstr, log?.anneeConstruction);
      return p ? (p !== 'Après 1997') : null;
    }
  },
  {
    key:    'gaz',
    label:  'État installation gaz',
    validityYears: 6,
    legal:  'Art. L134-6 Code construction',
    icon:   '🔥',
    joindreAuBail: true,
    /** Gaz : installation de plus de 15 ans. */
    isApplicable: (log) => {
      const a = Number(log?.installationGazAnnee);
      if (!a) return null;
      return (new Date().getFullYear() - a) >= 15;
    }
  },
  {
    key:    'elec',
    label:  'État installation électrique',
    validityYears: 6,
    legal:  'Art. L134-7 Code construction',
    icon:   '⚡',
    joindreAuBail: true,
    /** Élec : installation de plus de 15 ans. */
    isApplicable: (log) => {
      const a = Number(log?.installationElecAnnee);
      if (!a) return null;
      return (new Date().getFullYear() - a) >= 15;
    }
  },
  {
    key:    'erp',
    label:  'ERP — Risques (PPR/sismicité/radon)',
    validityYears: 0.5, // 6 mois (date du bail)
    legal:  'Art. L125-5 Code environnement',
    icon:   '🌊',
    joindreAuBail: true,
    /** ERP : commune en zone PPRN/PPRT/sismique/radon. Sans data API, true par défaut. */
    isApplicable: (log) => log?.zoneRisques !== false // null/true → applicable
  },
  {
    key:    'termites',
    label:  'Termites / parasitaire',
    validityYears: 0.5,
    legal:  'Art. L133-6 Code construction',
    icon:   '🐛',
    joindreAuBail: true,
    /** Termites : commune avec arrêté préfectoral. */
    isApplicable: (log) => !!log?.zoneTermites
  },
  {
    key:    'merule',
    label:  'Mérule',
    validityYears: null, // pas de validité périodique, à déclarer si zone
    legal:  'Art. L133-7 Code construction',
    icon:   '🍄',
    joindreAuBail: true,
    isApplicable: (log) => !!log?.zoneMerule
  },
  {
    key:    'bruit',
    label:  'Bruit aérien (PEB)',
    validityYears: null,
    legal:  'Art. L112-11 Code urbanisme',
    icon:   '✈',
    joindreAuBail: true,
    isApplicable: (log) => !!log?.zonePEB
  }
];

const DIAG_KEYS = DIAGS_CATALOG.map(d => d.key);

/** Lookup catalogue par clé. */
export function _diagCatalogEntry(diagKey) {
  return DIAGS_CATALOG.find(d => d.key === diagKey) || null;
}

// ────────────────────────────────────────────────────────────────────────────
// Lecture / écriture
// ────────────────────────────────────────────────────────────────────────────

/**
 * Lit l'info diag d'un logement avec rétrocompat champs flat.
 *   _diagGet(log, 'dpe') → { date, classe, ... } ou null si absent
 * Pour DPE : fallback sur log.dpe (classe) + log.dpeDate (date).
 */
export function _diagGet(log, diagKey) {
  if (!log || !diagKey) return null;
  const diags = log.diagnostics || {};
  const direct = diags[diagKey];
  if (direct && typeof direct === 'object') return direct;
  // Rétrocompat DPE
  if (diagKey === 'dpe' && (log.dpe || log.dpeDate)) {
    return {
      date:    log.dpeDate || '',
      classe:  log.dpe || '',
      diagnostiqueur: '',
      pjDocId: null,
      na: false,
      notes: ''
    };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Applicabilité
// ────────────────────────────────────────────────────────────────────────────

/**
 * Indique si le diagnostic est applicable à ce logement.
 * @returns {true|false|null} — null si information manquante (année construction etc.)
 */
export function _estDiagApplicable(diagKey, logement) {
  const entry = _diagCatalogEntry(diagKey);
  if (!entry || !logement) return null;
  // Si l'utilisateur a explicitement marqué N/A → false
  const info = _diagGet(logement, diagKey);
  if (info && info.na === true) return false;
  return entry.isApplicable(logement);
}

// ────────────────────────────────────────────────────────────────────────────
// Expiration
// ────────────────────────────────────────────────────────────────────────────

/**
 * Calcule la date d'expiration d'un diagnostic en fonction du catalogue.
 * Approche string-based pour éviter les bugs timezone (setMonth en local time
 * sur une Date parsée en UTC donne un décalage d'1 jour).
 * @param {string} diagKey
 * @param {object} info — `_diagGet` output
 * @returns {string|null} — date ISO YYYY-MM-DD ou null si pas de validité périodique
 */
export function _diagDateExpiration(diagKey, info) {
  const entry = _diagCatalogEntry(diagKey);
  if (!entry || !info || !info.date) return null;
  if (diagKey === 'crep') {
    if (info.presence === true) return _addYMtoISO(info.date, entry.validityIfPresence || 6, 0);
    return null;
  }
  if (entry.validityYears == null) return null;
  const years = Math.floor(entry.validityYears);
  const months = Math.round((entry.validityYears - years) * 12);
  return _addYMtoISO(info.date, years, months);
}

/** Ajoute Y années + M mois à une date ISO YYYY-MM-DD, en arithmétique string. */
function _addYMtoISO(iso, years, months) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  let y = parseInt(m[1], 10);
  let mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  y += years;
  mo += months;
  while (mo > 12) { mo -= 12; y += 1; }
  while (mo < 1)  { mo += 12; y -= 1; }
  return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

/**
 * Indique si le diagnostic est expiré à la date de référence.
 * @returns {boolean}
 */
export function _estDiagExpire(diagKey, info, dateRef = new Date()) {
  const exp = _diagDateExpiration(diagKey, info);
  if (!exp) return false; // pas de validité périodique
  const refTs = dateRef instanceof Date ? dateRef.getTime()
    : new Date(String(dateRef).slice(0, 10) + 'T00:00:00').getTime();
  const expTs = new Date(exp + 'T23:59:59').getTime();
  return refTs > expTs;
}

/**
 * Statut visuel d'un diagnostic pour le logement.
 *   'valide' | 'expirebientot' | 'expire' | 'na' | 'manquant' | 'inapplicable'
 * `bientot` = expire dans moins de 6 mois (1 an pour DPE).
 */
export function _diagStatut(diagKey, logement, dateRef = new Date()) {
  const applicable = _estDiagApplicable(diagKey, logement);
  if (applicable === false) return 'inapplicable';
  // applicable === null → on traite comme applicable mais avertit
  const info = _diagGet(logement, diagKey);
  if (info && info.na === true) return 'na';
  if (!info || !info.date) return 'manquant';
  if (_estDiagExpire(diagKey, info, dateRef)) return 'expire';
  const exp = _diagDateExpiration(diagKey, info);
  if (!exp) return 'valide';
  const expTs = new Date(exp + 'T00:00:00').getTime();
  const refTs = dateRef instanceof Date ? dateRef.getTime()
    : new Date(String(dateRef).slice(0, 10) + 'T00:00:00').getTime();
  const sixMonths = 1000 * 60 * 60 * 24 * 30 * 6;
  const twelveMonths = sixMonths * 2;
  const threshold = diagKey === 'dpe' ? twelveMonths : sixMonths;
  if ((expTs - refTs) <= threshold) return 'expirebientot';
  return 'valide';
}

// ────────────────────────────────────────────────────────────────────────────
// DDT complet ?
// ────────────────────────────────────────────────────────────────────────────

/**
 * Indique si le Dossier Diagnostic Technique est complet pour ce logement à
 * la date donnée (= tous les diagnostics applicables sont valides ou N/A).
 * @returns {{ complet: boolean, manquants: string[], expires: string[], inconnus: string[] }}
 */
export function _ddtComplet(logement, dateRef = new Date()) {
  const out = { complet: true, manquants: [], expires: [], inconnus: [] };
  if (!logement) { out.complet = false; return out; }
  for (const entry of DIAGS_CATALOG) {
    const status = _diagStatut(entry.key, logement, dateRef);
    if (status === 'manquant')  { out.manquants.push(entry.key); out.complet = false; }
    if (status === 'expire')    { out.expires.push(entry.key);  out.complet = false; }
    // Note : 'expirebientot' n'invalide PAS le DDT (juste un warning)
    // 'inapplicable' / 'na' / 'valide' → OK
  }
  return out;
}

/** Liste des clés de diagnostic. */
export const DIAGS_KEYS = DIAG_KEYS.slice();

/**
 * RETOURS-2026-10-05 A1 — faut-il (re)faire le contrôle DDT dans saveBail ?
 * Non si la validation financière a déjà été franchie (_pendingVal), ni sur un bail existant
 * déjà signé ou commencé (le DDT est dû à la signature, art. 3-3 loi 89-462). Oui à la création
 * et sur un brouillon pas encore commencé. Miroir de `_ddtControleSaveBail` (app-part1.js).
 */
export function _ddtControleSaveBail({ bailExistant, pendingVal, today }) {
  if (pendingVal) return false;
  if (!bailExistant || bailExistant._deleted) return true;
  if (bailExistant.signatures && bailExistant.signatures.signedAt) return false;
  const d = String(bailExistant.debut || '').slice(0, 10);
  if (d && d <= String(today || '').slice(0, 10)) return false;
  return true;
}

/**
 * RETOURS-2026-10-05 A6 — date de conclusion du bail en place (signature, sinon début), ISO ou null
 * (pas de bail en cours : vacant, clôturé). Miroir de `_ddtDateBailEnPlace` (app-part2.js, qui lit DB.baux).
 */
export function _ddtDateBailEnPlace(bail) {
  if (!bail || bail._deleted || bail.cloture) return null;
  const d = String((bail.signatures && bail.signatures.signedAt) || bail.debut || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/**
 * Un diagnostic n'est « à refaire » que s'il était DÉJÀ périmé à la conclusion du bail en place
 * (art. 3-3 loi 89-462 : DDT annexé à la signature / au renouvellement). Sans bail en place : à `today`.
 */
export function _diagExpireARefaire(diagKey, logement, bail, today = new Date()) {
  const d = _ddtDateBailEnPlace(bail);
  return _diagStatut(diagKey, logement, d ? new Date(d + 'T00:00:00') : today) === 'expire';
}
