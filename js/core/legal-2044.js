/**
 * core/legal-2044.js — Calcul aide déclaration revenus fonciers 2044.
 *
 * Sprint 3B LEGAL-2044 (P1 bloquant V1 commerciale).
 *
 * Source officielle : Notice 2044 - revenus 2024 (DGFP, mars 2025, PARA-DGFP-12497210).
 *
 * Architecture :
 *   - STD_CATEGORIES (défini dans index-test.html) mappe chaque catégorie sur sa
 *     ligne 2044 (211, 213, 221, 223, 224, 224bis, 225, 226, 227, 229, 230, 250)
 *     + type ('recette' | 'charge' | 'interet' | 'special').
 *   - Ce module agrège DB.mouvements pour une période donnée + une entité (option)
 *     en renvoyant un objet { '211': montant, '213': montant, ..., '250': montant,
 *     totalRecettes, totalCharges, totalInterets, resultatFoncier, etc. }.
 *
 * Périmètre V1 :
 *   - Régime réel (déclaration 2044). Pas le micro-foncier (< 15k€ — pas de 2044 nécessaire).
 *   - Pas de SCI IS / 2072 (sujet séparé LEGAL-2072 P3).
 *   - Pas de calcul de déficit foncier (sujet plus complexe : limite 10 700€/an,
 *     report sur 10 ans, exclusion intérêts d'emprunt — à étendre V1.1).
 *
 * Politique :
 *   - Si une catégorie n'a pas de ligne2044 mappée (custom user) → comptée dans
 *     `nonMappes[]` avec montant et libellé pour que l'utilisateur les classe à la main.
 *   - Catégories `type === 'special'` (capital prêt, DG reçu/restitué) ignorées.
 */

/**
 * Calcule les agrégats 2044 pour une période et un scope donnés.
 *
 * @param {Array} mouvements - DB.mouvements
 * @param {Array} stdCategories - STD_CATEGORIES de index-test.html
 * @param {Object} opts - { from, to, entityNom, refs[] }
 * @returns {{ lignes: Object, totalRecettes, totalCharges, totalInterets,
 *             resultatFoncier, nonMappes: Array, comptes: Object }}
 */
import { _csvCell } from './export-comptable.js';

export function _compute2044(mouvements, stdCategories, opts = {}) {
  const { from = '', to = '', entityNom = '', refs = [],
          imms = [], nbLocaux = 0, partBailleur225 = 0, detail = false, mapping = null } = opts;
  const inScope = m => {
    if (!m || m._deleted) return false;
    if (from && m.date < from) return false;
    if (to && m.date > to) return false;
    if (entityNom) {
      // m.qui peut être un ref logement OU 'SCI:<nom>'
      const isGlobal = m.qui === 'SCI:' + entityNom;
      const isInScope = refs && refs.length ? refs.includes(m.qui) : false;
      // Charge posée au niveau immeuble : qui vide + imm rattaché à un immeuble du bailleur.
      // (ex. taxe foncière, PNO, syndic part proprio). Sans ça → tombe dans le trou et
      // disparaît du 2044. Cf V3-REFONTE-LOYERS chantier A.
      const isImmScope = (!m.qui && m.imm && imms && imms.length) ? imms.includes(m.imm) : false;
      if (!isGlobal && !isInScope && !isImmScope) return false;
    }
    return true;
  };

  const catByName = new Map();
  (stdCategories || []).forEach(c => catByName.set(c.nom, c));

  // Type 2044 déduit d'un n° de ligne (pour les catégories CUSTOM mappées via opts.mapping,
  // qui ne portent qu'un numéro de ligne, pas de type). Les catégories STD gardent leur
  // type figé via catByName (le mapping ne s'applique JAMAIS à une catégorie STD).
  const _typeFromLigne = (ln) => {
    if (ln === '211' || ln === '212' || ln === '213' || ln === '214') return 'recette';
    if (ln === '250') return 'interet';
    if (ln === '230') return 'deduction';
    return 'charge'; // 221..229, 224bis, 228...
  };

  const lignes = {};
  const comptes = {}; // ligne → nombre de mvts
  const nonMappes = [];
  // Détail des mouvements par ligne (opt-in via opts.detail) — alimente le PDF du wizard.
  const mvtsByLigne = detail ? {} : null;
  let totalRecettes = 0, totalCharges = 0, totalInterets = 0;

  (mouvements || []).filter(inScope).forEach(m => {
    // Mouvements rattachés à un compteur collectif : ignorés ici. Leur part bailleur
    // (charges récupérables non récupérées) est réinjectée sur la ligne 225 via
    // opts.partBailleur225 (précalculé par computeRegul côté UI). Sans ce skip →
    // double compte (facture brute en charge + part bailleur ajoutée). Cf V3-REFONTE-LOYERS.
    if (m.compteurCcId) return;
    let std = catByName.get(m.cat);
    // Catégorie non-STD : on tente le mapping custom fourni par l'appelant (opts.mapping).
    if (!std && mapping && mapping[m.cat]) {
      const ln = mapping[m.cat];
      if (ln) std = { ligne2044: ln, type: _typeFromLigne(ln) };
    }
    if (!std) {
      // Catégorie custom non mappée
      if ((m.cr || 0) > 0 || (m.db || 0) > 0) {
        nonMappes.push({ id: m.id, date: m.date, lib: m.lib, cat: m.cat, cr: m.cr || 0, db: m.db || 0, qui: m.qui });
      }
      return;
    }
    if (!std.ligne2044) return; // 'special' (capital prêt, DG) : hors résultat
    const ligne = std.ligne2044;
    if (!(ligne in lignes)) { lignes[ligne] = 0; comptes[ligne] = 0; }
    // Sémantique de signe (inchangée) : recette = cr − db (arriérés négatifs possibles) ;
    // charge/intérêt = db − cr (remboursements partiels possibles) ; deduction (ligne 230,
    // régul N-1 provisions copro) = db − cr mais SE SOUSTRAIT du total des charges (notice
    // 2044 : ligne 240 = (221..229) − 230).
    let amt = 0;
    if (std.type === 'recette') { amt = (m.cr || 0) - (m.db || 0); totalRecettes += amt; }
    else if (std.type === 'charge') { amt = (m.db || 0) - (m.cr || 0); totalCharges += amt; }
    else if (std.type === 'interet') { amt = (m.db || 0) - (m.cr || 0); totalInterets += amt; }
    else if (std.type === 'deduction') { amt = (m.db || 0) - (m.cr || 0); totalCharges -= amt; }
    lignes[ligne] += amt;
    if (detail) {
      (mvtsByLigne[ligne] || (mvtsByLigne[ligne] = [])).push({ id: m.id, date: m.date, lib: m.lib, montant: amt });
    }
    comptes[ligne]++;
  });

  // Forfait légal ligne 222 (notice 2044 § 222) : 20 € par local, calculé automatiquement
  // (« réputé couvrir les autres frais de gestion non déductibles pour leur montant réel »).
  // nbLocaux fourni par l'appelant (nombre de logements actifs du bailleur).
  if (nbLocaux > 0) {
    lignes['222'] = (lignes['222'] || 0) + nbLocaux * 20;
    comptes['222'] = (comptes['222'] || 0) + 1;
    totalCharges += nbLocaux * 20;
  }
  // Part bailleur des charges récupérables non récupérées (ligne 225), précalculée par
  // l'appelant via computeRegul (vacances + logements exclus du compteur collectif).
  // Cumulée avec d'éventuels mouvements 225 saisis directement.
  if (partBailleur225) {
    lignes['225'] = (lignes['225'] || 0) + partBailleur225;
    comptes['225'] = (comptes['225'] || 0) + 1;
    totalCharges += partBailleur225;
  }

  // Arrondi à 2 décimales pour chaque ligne
  Object.keys(lignes).forEach(k => { lignes[k] = Math.round(lignes[k] * 100) / 100; });
  totalRecettes = Math.round(totalRecettes * 100) / 100;
  totalCharges = Math.round(totalCharges * 100) / 100;
  totalInterets = Math.round(totalInterets * 100) / 100;
  const resultatFoncier = Math.round((totalRecettes - totalCharges - totalInterets) * 100) / 100;

  return {
    lignes,
    comptes,
    totalRecettes,
    totalCharges,
    totalInterets,
    resultatFoncier,
    nonMappes,
    ...(detail ? { mvtsByLigne } : {}),
    period: { from, to },
    entityNom: entityNom || null
  };
}

/**
 * Génère un texte récap "prêt à recopier dans 2044" pour une entité.
 * @returns {string} - texte multilignes ASCII
 */
export function _format2044Recap(result, opts = {}) {
  const { yr = '' } = opts;
  const fmt = n => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + ' €';
  const lines = [];
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  DÉCLARATION 2044 — Aide au remplissage');
  if (result.entityNom) lines.push('  Entité : ' + result.entityNom);
  if (yr) lines.push('  Année : ' + yr);
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('▶ RECETTES BRUTES (à reporter en partie I)');
  if (result.lignes['211'] != null) lines.push('  Ligne 211 (Loyers encaissés / arriérés)         : ' + fmt(result.lignes['211']).padStart(15));
  if (result.lignes['213'] != null) lines.push('  Ligne 213 (Subventions / indemnités / divers)    : ' + fmt(result.lignes['213']).padStart(15));
  lines.push('  ─────────────────────────────────────────────────');
  lines.push('  Total recettes brutes                            : ' + fmt(result.totalRecettes).padStart(15));
  lines.push('');
  lines.push('▶ CHARGES DÉDUCTIBLES (à reporter en partie II)');
  if (result.lignes['221'] != null) lines.push('  Ligne 221 (Frais de gestion / hon. / compta)     : ' + fmt(result.lignes['221']).padStart(15));
  if (result.lignes['222'] != null) lines.push('  Ligne 222 (Forfait gestion 20 €/local)           : ' + fmt(result.lignes['222']).padStart(15));
  if (result.lignes['223'] != null) lines.push('  Ligne 223 (Primes d\'assurance)                   : ' + fmt(result.lignes['223']).padStart(15));
  if (result.lignes['224'] != null) lines.push('  Ligne 224 (Travaux de réparation / entretien)    : ' + fmt(result.lignes['224']).padStart(15));
  if (result.lignes['224bis'] != null) lines.push('  Ligne 224 bis (Travaux rénov énergétique)       : ' + fmt(result.lignes['224bis']).padStart(15));
  if (result.lignes['225'] != null) lines.push('  Ligne 225 (Charges récup non récupérées)         : ' + fmt(result.lignes['225']).padStart(15));
  if (result.lignes['226'] != null) lines.push('  Ligne 226 (Indemnités d\'éviction)                : ' + fmt(result.lignes['226']).padStart(15));
  if (result.lignes['227'] != null) lines.push('  Ligne 227 (Taxe foncière + taxes annexes)        : ' + fmt(result.lignes['227']).padStart(15));
  if (result.lignes['229'] != null) lines.push('  Ligne 229 (Provisions copropriété)               : ' + fmt(result.lignes['229']).padStart(15));
  if (result.lignes['230'] != null) lines.push('  Ligne 230 (Régul N-1 provisions copro, à DÉDUIRE): − ' + fmt(result.lignes['230']).padStart(13));
  lines.push('  ─────────────────────────────────────────────────');
  lines.push('  Total charges déductibles                        : ' + fmt(result.totalCharges).padStart(15));
  lines.push('');
  lines.push('▶ INTÉRÊTS D\'EMPRUNT (partie III)');
  if (result.lignes['250'] != null) lines.push('  Ligne 250 (Intérêts + frais emprunt)             : ' + fmt(result.lignes['250']).padStart(15));
  lines.push('  ─────────────────────────────────────────────────');
  lines.push('  Total intérêts                                   : ' + fmt(result.totalInterets).padStart(15));
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  RÉSULTAT FONCIER (recettes - charges - intérêts) : ' + fmt(result.resultatFoncier).padStart(15));
  lines.push('═══════════════════════════════════════════════════════════════');
  if (result.resultatFoncier < 0) {
    lines.push('');
    lines.push('⚠ Résultat foncier négatif — déficit foncier possible.');
    lines.push('  Imputation sur revenu global limitée à 10 700 €/an');
    lines.push('  (hors intérêts d\'emprunt → report sur 10 ans uniquement).');
    lines.push('  → Consulter notice 2044 §V ou l\'expert-comptable.');
  }
  if (result.nonMappes && result.nonMappes.length) {
    lines.push('');
    lines.push('⚠ ' + result.nonMappes.length + ' mouvement(s) avec catégorie non mappée à une ligne 2044.');
    lines.push('  À classer manuellement avant de déclarer (cf détail dans le wizard UI).');
  }
  return lines.join('\n');
}

/** Export CSV pour comptable. opts.exclus / opts.flagues (FEAT-REGIMES P0) ajoutent des
 *  lignes de transparence sur le périmètre foncier (lots meublés exclus, lots à vérifier). */
export function _2044ToCsv(result, opts = {}) {
  const headers = ['ligne_2044', 'description', 'nb_mouvements', 'montant_eur'];
  const rows = [];
  const labels = {
    '211': 'Loyers encaissés / arriérés',
    '213': 'Subventions / indemnités / recettes diverses',
    '221': 'Frais de gestion et procédure',
    '222': 'Frais de gestion forfaitaires (20 €/local)',
    '223': 'Primes d\'assurance (PNO, GLI)',
    '224': 'Travaux de réparation et d\'entretien',
    '224bis': 'Travaux de rénovation énergétique',
    '225': 'Charges récupérables non récupérées',
    '226': 'Indemnités d\'éviction',
    '227': 'Taxe foncière + taxes annexes',
    '229': 'Provisions pour charges de copropriété',
    '230': 'Régularisation provisions copro N-1 (à déduire des charges)',
    '250': 'Intérêts d\'emprunt + frais'
  };
  Object.keys(result.lignes).sort().forEach(ligne => {
    rows.push([ligne, labels[ligne] || ligne, result.comptes[ligne] || 0, result.lignes[ligne]]);
  });
  rows.push(['TOTAL_RECETTES', 'Total recettes brutes', '', result.totalRecettes]);
  rows.push(['TOTAL_CHARGES', 'Total charges déductibles', '', result.totalCharges]);
  rows.push(['TOTAL_INTERETS', 'Total intérêts d\'emprunt', '', result.totalInterets]);
  rows.push(['RESULTAT_FONCIER', 'Résultat foncier (recettes - charges - intérêts)', '', result.resultatFoncier]);
  // FEAT-REGIMES P0 : transparence du périmètre foncier (symétrie panneau / wizard / PDF / CSV).
  (opts.exclus || []).forEach(e => {
    rows.push(['LOT_EXCLU_MEUBLE', `Lot exclu du 2044 — meublé/BIC (${e.mode || 'meuble'}) : ${e.ref}`, '', '']);
  });
  (opts.flagues || []).forEach(f => {
    rows.push(['LOT_A_VERIFIER', `Lot à vérifier (${f.mode || 'mixte'}) : ${f.ref}${f.msg ? ' — ' + f.msg : ''}`, '', '']);
  });
  const escape = _csvCell;   // DRY : garde anti-formule CSV unique (export-comptable.js)
  return [headers.join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
}
