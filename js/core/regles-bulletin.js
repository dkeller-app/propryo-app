// js/core/regles-bulletin.js — VERIF-DOCUMENTS lot 3 (v15.740) ; REGLES-PAIE (v15.752 provisoire).
// RÈGLES DE COHÉRENCE des bulletins de salaire d'un dossier, appliquées aux valeurs LUES par l'IA (tâche relais
// « bulletin-paie », PDF ou photo) et éventuellement CORRIGÉES par le bailleur. L'IA lit, la règle décide : chaque constat
// cite son texte (Code du travail, art. R3243-1 ; arrêté du 25/02/2016 ; décret n° 2015-1437 ; Urssaf ; BOSS) et ses
// valeurs. Une valeur absente = règle non applicable (jamais un écart). Aucun score, aucun total, aucun mot de jugement.
//
// GARDE-FOU DE LECTURE (REGLES-PAIE, décision du 16/10/2026) : une erreur de lecture ne doit jamais produire un constat.
//  1. Quorum : les constats d'un bulletin ne sont produits que si au moins 2 égalités « d'ancrage » indépendantes tiennent
//     (net à payer = net avant impôt − impôt ; brut − cotisations ± lignes = net avant impôt ; somme des lignes = total ;
//     heures × taux = salaire de base). Sinon : valeurs lues, aucun constat (`lectureIncertaine`).
//  2. Écart explicable par UNE erreur de lecture plausible (un chiffre remplacé, deux chiffres inversés, un chiffre en trop
//     ou en moins, virgule déplacée ou perdue, signe perdu) d'UNE valeur, sans casser une autre égalité qui tient :
//     règle non appliquée (rangée dans `incertaines`, jamais un constat). Prix assumé : une retouche d'UN seul chiffre d'un
//     montant que rien d'autre ne recoupe n'est pas relevée.
//  3. Lignes décalées (taux légal d'une autre ligne, ou plusieurs taux hors norme) : aucun constat de taux.
//  4. Un cumul lu égal au montant du mois, hors janvier et hors mois d'entrée, est une lecture de la mauvaise colonne : ignoré.
//  5. N1 (brut − cotisations ± lignes = net avant impôt) reste une ancre : une ligne non lue entre le total et le net
//     produirait le même écart qu'un net retouché.
//  6. Relecture adverse Opus (16/10) : une valeur JUSTE prise dans une case voisine (net social pour net avant impôt,
//     taux pour montant, brut pour une assiette, colonne patronale, champ rendu à 0) est aussi une lecture plausible.
//     2e relecture (16/10) : acompte ou saisie après l'impôt, 2e ligne de prélèvement, bulletin complémentaire, cumul lu
//     dans une colonne voisine, période mal lue. Conclusion : toute égalité arithmétique peut être cassée par une pratique
//     légitime ou une lecture plausible. Seules TL (taux CSG/CRDS, régime général) et CS produisent un constat interne ;
//     entre bulletins, B5 (périodes, cumuls à l'appui), B6 et B7. Toute autre règle qui ne tient pas → ok = null et le
//     bulletin n'est pas « OK » (règles respectées non publiées) : « non vérifiable », jamais « à vérifier ».
// Règles écartées après étude (mockups/REGLES-PAIE, phase 1) : net social ≤ brut (B3 retirée : le montant net social
// intègre les contributions patronales santé et prévoyance, BOSS), assiette plafonnée ≤ PMSS (régularisation progressive),
// taux Agirc-Arrco, assiette CSG ≥ 98,25 % du brut, net imposable recalculé, SMIC, taux global des cotisations.
// Module pur. Testé par __tests__/helpers/regles-bulletin.test.js.

import { identiteConcorde } from './deux-d-doc.js';

export const SOURCES = {
  r3243: { libelle: 'Code du travail, art. R3243-1 (9° et 10°)', url: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048841718' },
  arrete: { libelle: 'arrêté du 25/02/2016 relatif au bulletin de paie', url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000032106923/' },
  decret: { libelle: 'décret n° 2015-1437, annexe I, D, 2°', url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000031444493' },
  calcul: { libelle: 'calcul du bulletin (montants imprimés entre eux)', url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000032106923/' },
  urssaf: { libelle: 'Urssaf, taux de cotisations du secteur privé au 01/01/2026', url: 'https://www.urssaf.fr/accueil/outils-documentation/taux-baremes/taux-cotisations-secteur-prive.html' },
  boss: { libelle: 'BOSS, assiette de la CSG et de la CRDS', url: 'https://boss.gouv.fr/portail/accueil/regles-dassujettissement/assiette-generale.html' },
};
export const TOLERANCES = Object.freeze({ net: 0.02, impot: 0.10, cumul: 0.05, total: 0.015 });
export const LIGNES_MAX = 40;
export const AUTRES_MAX = 8;
export const TYPES_BULLETIN = Object.freeze(['I.D.2', 'II.E.3']);
export const TYPES_CONTRAT = Object.freeze(['I.C.1', 'II.D.1']);
export const CHAMPS_BULLETIN = Object.freeze([
  ['periode', 'Période'], ['salarie', 'Salarié'], ['employeur', 'Employeur'], ['siret', 'SIRET'], ['dateEntree', 'Date d\'entrée'],
  ['heures', 'Heures payées'], ['tauxHoraire', 'Taux horaire'], ['salaireBase', 'Salaire de base'],
  ['brut', 'Salaire brut'], ['totalCotisations', 'Total des cotisations salariales'], ['netSocial', 'Montant net social'], ['netAvantImpot', 'Net à payer avant impôt'], ['impotBase', 'Base de l\'impôt prélevé'],
  ['impotTaux', 'Taux de l\'impôt prélevé (%)'], ['impotMontant', 'Impôt prélevé à la source'], ['netAPayer', 'Net à payer'], ['netImposable', 'Net imposable'],
  ['cumulBrut', 'Cumul brut'], ['cumulNetImposable', 'Cumul net imposable']
]);
export const CHAMPS_CONTRAT = Object.freeze([['salarie', 'Salarié'], ['employeur', 'Employeur'], ['siret', 'SIRET'], ['dateDebut', 'Date de début'], ['typeContrat', 'Type de contrat']]);
export const NUMERIQUES = Object.freeze(['heures', 'tauxHoraire', 'salaireBase', 'brut', 'totalCotisations', 'netSocial', 'netAvantImpot', 'impotBase', 'impotTaux', 'impotMontant', 'netAPayer', 'netImposable', 'cumulBrut', 'cumulNetImposable']);

// Taux salariaux légaux 2026 (Urssaf, page du 01/01/2026, consultée le 15/10/2026). Alsace-Moselle : 1,30 % au régime
// général ; 1,19 % au régime agricole à compter du 01/07/2026 (MSA). CSG/CRDS non déductible : 2,40 % + 0,50 % = 2,90 %.
// Heures supplémentaires : CSG/CRDS entièrement non déductible (6,80 % reporté, ou 9,70 % en une ligne) ; réduction 11,31 %.
const TAUX_LEGAUX = Object.freeze({ vp: [6.90], vd: [0.40], csgd: [6.80], csgnd: [2.90, 2.40], crds: [0.50], csghs: [6.80, 9.70, 9.20], als: [1.30, 1.19], redhs: [11.31] });
const LIB_LIGNE = { vp: 'vieillesse plafonnée', vd: 'vieillesse déplafonnée', csgd: 'CSG déductible', csgnd: 'CSG/CRDS non déductible', crds: 'CRDS', csghs: 'CSG/CRDS sur heures supplémentaires', als: 'maladie Alsace-Moselle', redhs: 'réduction heures supplémentaires' };
const ANNEES_TAUX = ['2026'];

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
/** « de août 2026 » → « d'août 2026 » (élision devant une voyelle). */
export const dePeriode = (p) => { const l = libellePeriode(p); return /^[aeiouéè]/i.test(l) ? 'd\'' + l : 'de ' + l; };
export const libellePeriode = (p) => { const m = /^(\d{4})-(\d{2})$/.exec(String(p || '')); return m ? `${MOIS[+m[2] - 1]} ${m[1]}` : ''; };
export const euros = (n) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ' ') + ' €' : '—');
const pct = (t) => String(t).replace('.', ',') + ' %';
const fdate = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const moisIndex = (p) => { const m = /^(\d{4})-(\d{2})$/.exec(String(p || '')); return m ? (+m[1]) * 12 + (+m[2] - 1) : null; };
const nombre = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const arrondi = (n) => Math.round(n * 100) / 100;
const siretDe = (s) => String(s || '').replace(/\D/g, '');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();

/** Catégorie légale d'une ligne de cotisation d'après son libellé (null si non reconnue ou revenu de remplacement). */
export function categorieLigne(libelle) {
  const l = norm(libelle);
  if (!l || /remplacement|activite partielle|chomage partiel|indemnit|\bij\b|ijss|maintien|retraite supp|pension/.test(l)) return null;
  const HS = /(heures? sup|h\.? ?sup|\bhs\b|hsup|tepa|heures? compl)/;
  if (/csg|crds/.test(l) && HS.test(l)) return 'csghs';
  if (/reduc|exon|deduc/.test(l) && HS.test(l)) return 'redhs';
  if (/deplafon/.test(l)) return 'vd';
  if (/(securite sociale|vieil|retraite de base|assurance vieillesse|\bss\b).*plafon/.test(l)) return 'vp';
  if (/^csg (deductible|non imposable)/.test(l) && !/non deductible/.test(l)) return 'csgd';
  if (/^csg ?\/ ?crds|^csg (non deductible|imposable)|^csg\/rds/.test(l)) return 'csgnd';
  if (/^crds|^rds\b/.test(l)) return 'crds';
  if (/alsace|moselle|regime local/.test(l)) return 'als';
  return null;
}

/**
 * Valeurs retenues d'une pièce : lecture de l'IA, puis corrections du bailleur (qui priment).
 * Une correction vide efface la valeur lue. Les lignes de cotisations sont bornées (LIGNES_MAX) et typées.
 */
export function valeursRetenues(ia) {
  if (!ia || !ia.lu) return null;
  const v = Object.assign({}, ia.lu);
  for (const [k, c] of Object.entries(ia.corrections || {})) v[k] = c ? c.apres : null;
  for (const k of NUMERIQUES) v[k] = nombre(v[k]);
  for (const k of ['periode', 'dateEntree', 'dateDebut', 'siret', 'salarie', 'employeur']) if (v[k] != null && typeof v[k] !== 'string') v[k] = null;
  const L = Array.isArray(v.lignes) ? v.lignes : [];
  v.lignesTronquees = !!v.lignesTronquees || L.length > LIGNES_MAX;
  v.lignes = L.slice(0, LIGNES_MAX).filter((l) => l && typeof l === 'object')
    .map((l) => ({ libelle: typeof l.libelle === 'string' ? l.libelle.slice(0, 120) : '', base: nombre(l.base), taux: nombre(l.taux), montant: nombre(l.montant) }));
  v.autresLignes = (Array.isArray(v.autresLignes) ? v.autresLignes : []).slice(0, AUTRES_MAX)
    .map((x) => nombre(x && typeof x === 'object' ? x.montant : x)).filter((x) => x != null);
  return v;
}

/**
 * Convertit une saisie de correction (« 2 193,04 € », « 2026-08 », « 04/09/2023 ») dans le format de la lecture.
 * @returns {{ok:boolean, valeur:any}}
 */
export function lireSaisie(champ, saisie) {
  const s = String(saisie == null ? '' : saisie).trim();
  if (!s) return { ok: true, valeur: null };
  if (NUMERIQUES.includes(champ)) {
    const n = Number(s.replace(/[\s  €%]/g, '').replace(',', '.'));
    const dec = champ === 'tauxHoraire' || champ === 'impotTaux' ? 10000 : 100;
    return isFinite(n) && Math.abs(n) <= 1e7 ? { ok: true, valeur: Math.round(n * dec) / dec } : { ok: false, valeur: null };
  }
  if (champ === 'periode') {
    let m = /^(\d{4})-(\d{1,2})$/.exec(s) || null; if (m) { const mm = +m[2]; return mm >= 1 && mm <= 12 ? { ok: true, valeur: `${m[1]}-${String(mm).padStart(2, '0')}` } : { ok: false }; }
    m = /^(\d{1,2})\/(\d{4})$/.exec(s); if (m) { const mm = +m[1]; return mm >= 1 && mm <= 12 ? { ok: true, valeur: `${m[2]}-${String(mm).padStart(2, '0')}` } : { ok: false }; }
    return { ok: false, valeur: null };
  }
  if (champ === 'dateEntree' || champ === 'dateDebut') {
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (m && !isNaN(Date.parse(s))) return { ok: true, valeur: s };
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); if (m) { const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return isNaN(Date.parse(iso)) ? { ok: false } : { ok: true, valeur: iso }; }
    return { ok: false, valeur: null };
  }
  if (champ === 'siret') { const d = siretDe(s); return d.length === 14 ? { ok: true, valeur: d } : { ok: false, valeur: null }; }
  return { ok: true, valeur: s.slice(0, 120) };
}

// ── Erreurs de lecture plausibles ──────────────────────────────────────────────────────────────────────────────────
const decimales = (x) => { const s = String(Math.abs(x)); const i = s.indexOf('.'); return i < 0 ? 0 : Math.min(6, s.length - i - 1); };
/** Variantes d'une chaîne de chiffres par UNE erreur : chiffre remplacé, deux voisins inversés, chiffre en trop ou en moins. */
export function variantesChiffres(s) {
  const out = new Set(); s = String(s);
  for (let i = 0; i < s.length; i++) for (let c = 0; c <= 9; c++) if (String(c) !== s[i]) out.add(s.slice(0, i) + c + s.slice(i + 1));
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2));
  for (let i = 0; i < s.length; i++) out.add(s.slice(0, i) + s.slice(i + 1));
  for (let i = 0; i <= s.length; i++) for (let c = 0; c <= 9; c++) out.add(s.slice(0, i) + c + s.slice(i));
  out.delete(s);
  return out;
}
/** Valeurs qu'une lecture aurait pu rendre À LA PLACE de `x` par une erreur plausible (et réciproquement : la relation est
 *  symétrique pour les substitutions et inversions, et on ajoute la virgule déplacée / perdue et le signe perdu). */
const _memoVar = new Map();
export function variantesLecture(x) {
  const m = _memoVar.get(x); if (m) return m;
  if (_memoVar.size > 5000) _memoVar.clear();
  const r = _variantes(x); _memoVar.set(x, r); return r;
}
function _variantes(x) {
  const d = Math.max(2, decimales(x)), k = Math.pow(10, d);
  const s = String(Math.round(Math.abs(x) * k));
  const out = new Set();
  for (const v of variantesChiffres(s)) if (/^\d+$/.test(v)) out.add(Number(v) / k);
  for (const f of [10, 100, 1000]) { out.add(Math.abs(x) * f); out.add(Math.abs(x) / f); }
  const r = [];
  for (const v of out) { r.push(x < 0 ? -v : v); r.push(x < 0 ? v : -v); }
  r.push(-x);
  return r;
}

/**
 * Moteur d'égalités. Chaque égalité : { code, champs:[clés], tient(vals) → bool, ancre?, regle? } ; `vals` = clé → nombre.
 * Une égalité qui ne tient pas est « explicable » s'il existe UNE erreur de lecture plausible d'UN de ses champs (variante)
 * qui la fait tenir SANS casser une autre égalité qui tient avec la valeur lue : alors ce n'est pas un constat.
 */
/** Évalue l'égalité avec `vals[k] = y`, sans copier le dictionnaire. */
function essai(eg, vals, k, y) { const old = vals[k]; vals[k] = y; try { return eg.tient(vals); } finally { vals[k] = old; } }
// Cases voisines d'un bulletin : une valeur lue égale à celle d'une case voisine a pu être prise dans la mauvaise case
// (net social lu pour le net avant impôt, taux lu pour le montant, brut lu pour une assiette, colonne du cumul…).
const GROUPES_VOISINS = [
  ['netAPayer', 'netAvantImpot', 'netSocial', 'netImposable', 'impotBase', 'impotMontant', 'impotTaux', 'brut', 'totalCotisations'],
  ['cumulBrut', 'cumulNetImposable', 'brut', 'netImposable', 'netSocial', 'netAvantImpot', 'netAPayer'],
  ['heures', 'tauxHoraire', 'salaireBase', 'brut'],
];
const EGALES_PAR_NATURE = new Set(['netImposable|impotBase']);   // base de l'impôt = net imposable : égalité normale
export function doublon(k, vals) {
  const x = vals[k]; if (x == null || x === 0) return false;
  const proches = new Set();
  for (const g of GROUPES_VOISINS) if (g.includes(k)) g.forEach((j) => proches.add(j));
  if (/^L\d+\./.test(k)) { for (const j of Object.keys(vals)) if (/^L\d+\./.test(j)) proches.add(j); for (const j of ['brut', 'salaireBase', 'totalCotisations']) proches.add(j); }
  proches.delete(k);
  for (const j of proches) {
    if (EGALES_PAR_NATURE.has(k + '|' + j)) continue;
    const y = vals[j]; if (typeof y === 'number' && y !== 0 && Math.abs(Math.abs(y) - Math.abs(x)) <= 0.005) return true;
  }
  return false;
}
function explicable(eg, vals, E, tient) {
  for (const k of eg.champs) {
    if (vals[k] == null) continue;
    const autres = E.filter((e) => e !== eg && tient.get(e) && e.champs.includes(k));
    // Zéro (valeur peut-être non lue : le relais ne cherche pas 0 dans le texte) ou valeur d'une case voisine, que
    // rien d'autre ne confirme (impôt à 0 € confirmé par base × taux 0 % : pas une lecture manquée).
    // CS : une assiette n'est que faiblement confirmée par base × taux (taux imprimé arrondi) → case voisine = plausible.
    if ((vals[k] === 0 || doublon(k, vals)) && (!autres.length || eg.code === 'CS')) return true;
    for (const y of variantesLecture(vals[k])) {
      if (essai(eg, vals, k, y) && autres.every((e) => essai(e, vals, k, y))) return true;
    }
  }
  return false;
}

/** Ensemble des égalités internes d'un bulletin (valeurs retenues `v`). */
/** Toutes les sommes ± d'un sous-ensemble de montants (3^n, n ≤ 6). */
function sommesSignees(a) {
  let S = [0]; for (const x of a) { const T = []; for (const s of S) { T.push(s, s + x, s - x); } S = T; }
  return [...new Set(S.map(arrondi))];
}
function egalitesInternes(v) {
  const vals = {}; const E = []; let cacheN1 = { cle: null, sommes: [] };
  for (const k of NUMERIQUES) if (nombre(v[k]) != null) vals[k] = v[k];
  const has = (...ks) => ks.every((k) => vals[k] != null);
  if (has('netAvantImpot', 'impotMontant', 'netAPayer')) E.push({ code: 'B1', ancre: true, regle: true, champs: ['netAPayer', 'netAvantImpot', 'impotMontant'], tient: (x) => Math.abs(x.netAPayer - arrondi(x.netAvantImpot - x.impotMontant)) <= TOLERANCES.net });
  if (has('impotBase', 'impotTaux', 'impotMontant')) E.push({ code: 'B2', regle: true, champs: ['impotMontant', 'impotBase', 'impotTaux'], tient: (x) => Math.abs(x.impotMontant - arrondi(x.impotBase * x.impotTaux / 100)) <= TOLERANCES.impot });
  const autres = (v.autresLignes || []).map((x) => nombre(x && typeof x === 'object' ? x.montant : x)).filter((x) => x != null).slice(0, 6);
  autres.forEach((a, i) => { vals['A' + i] = a; });
  if (has('brut', 'totalCotisations', 'netAvantImpot')) {
    const ka = autres.map((_, i) => 'A' + i);
    E.push({ code: 'N1', ancre: true, regle: true, ancreSeule: true, champs: ['brut', 'totalCotisations', 'netAvantImpot', ...ka], tient: (x) => {
      const d = arrondi(x.brut - x.totalCotisations - x.netAvantImpot); if (Math.abs(d) <= TOLERANCES.net) return true;
      const cle = ka.map((k) => x[k]).join('|');
      if (cle !== cacheN1.cle) cacheN1 = { cle, sommes: sommesSignees(ka.map((k) => Math.abs(x[k]))) };
      return cacheN1.sommes.some((s) => Math.abs(s - d) <= TOLERANCES.net); } });
  }
  if (has('heures', 'tauxHoraire', 'salaireBase')) E.push({ code: 'S1', ancre: true, regle: true, champs: ['salaireBase', 'heures', 'tauxHoraire'], tient: (x) => Math.abs(x.salaireBase - arrondi(x.heures * x.tauxHoraire)) <= 0.011 + Math.abs(x.heures) * 0.5 * Math.pow(10, -Math.max(2, decimales(x.tauxHoraire))) + Math.abs(x.tauxHoraire) * 0.5 * Math.pow(10, -Math.max(2, decimales(x.heures))) });
  // Lignes de cotisations.
  const L = v.lignes || [];
  L.forEach((l, i) => {
    for (const f of ['base', 'taux', 'montant']) if (l[f] != null) vals[`L${i}.${f}`] = l[f];
    if (l.base != null && l.taux != null && l.montant != null && l.taux !== 0) {
      const kb = `L${i}.base`, kt = `L${i}.taux`, km = `L${i}.montant`;
      E.push({ code: 'L1', regle: true, ligne: i, champs: [km, kb, kt], tient: (x) => { const dec = Math.max(2, decimales(x[kt])); return Math.abs(Math.abs(x[km]) - arrondi(Math.abs(x[kb] * x[kt]) / 100)) <= 0.011 + Math.abs(x[kb]) * 0.5 * Math.pow(10, -dec) / 100; } });
    }
  });
  const avecM = L.map((l, i) => i).filter((i) => L[i].montant != null);
  if (has('totalCotisations') && avecM.length >= 3 && !v.lignesTronquees) {
    const km = avecM.map((i) => `L${i}.montant`);
    E.push({ code: 'L2', ancre: true, regle: false, champs: ['totalCotisations', ...km], tient: (x) => Math.abs(arrondi(km.reduce((s, k) => s + x[k], 0)) - x.totalCotisations) <= TOLERANCES.total });
  }
  // Liens de confirmation (jamais de constat) : base de l'impôt = net imposable ; assiette déplafonnée = brut.
  if (has('impotBase', 'netImposable')) E.push({ code: 'lien', champs: ['impotBase', 'netImposable'], tient: (x) => Math.abs(x.impotBase - x.netImposable) <= 0.011 });
  L.forEach((l, i) => { if (categorieLigne(l.libelle) === 'vd' && l.base != null && has('brut')) E.push({ code: 'lien', champs: [`L${i}.base`, 'brut'], tient: (x) => Math.abs(x[`L${i}.base`] - x.brut) <= 0.011 }); });
  return { vals, E };
}

/** Règles internes d'UN bulletin. @returns Array<{code, ok, titre, detail, source}> (+ métadonnées non affichées). */
export function reglesInternes(v) { return analyseInterne(v).regles; }

function analyseInterne(v, gardeFou = true) {
  const res = { regles: [], incertaines: [], lectureIncertaine: false };
  if (!v) return res;
  const { vals, E } = egalitesInternes(v);
  const tient = new Map(E.map((e) => [e, e.tient(vals)]));
  Object.assign(res, { vals, E, tient });
  const ancres = E.filter((e) => e.ancre), ancresOk = ancres.filter((e) => tient.get(e)).length;
  res.ancres = { total: ancres.length, tenues: ancresOk };
  // Quorum : au moins 2 ancres tenues ; sinon aucune règle n'est appliquée sur ce bulletin.
  if (gardeFou && ancresOk < 2) { res.lectureIncertaine = true; return res; }
  const L = v.lignes || [];
  // Seules TL (CSG/CRDS) et CS peuvent produire un constat. B1 (acompte, saisie ou 2e ligne d'impôt après le net avant
  // impôt), B2 (régularisation du prélèvement), S1 (horaire du contrat lu pour les heures payées), L1 (assiette ou colonne
  // voisine) et C2 (colonne voisine) : jamais un constat — un échec rend le bulletin « non vérifiable » (ok = null).
  const CONSTAT = new Set(['TL', 'CS']);
  const sortir = (e, ok, r) => {
    if (ok || !gardeFou || (CONSTAT.has(r.code) && !explicable(e, vals, E, tient))) res.regles.push(Object.assign({ ok }, r));
    else res.incertaines.push({ code: r.code, titre: r.titre });
  };
  const eL2 = E.find((e) => e.code === 'L2');
  const lignesSures = !gardeFou || !!(eL2 && tient.get(eL2));   // TL et CS : seulement si la somme des lignes lues = total
  for (const e of E) {
    if (!e.regle) continue;
    const ok = tient.get(e);
    if (e.code === 'B1') { const att = arrondi(v.netAvantImpot - v.impotMontant), ec = arrondi(v.netAPayer - att);
      sortir(e, ok, { code: 'B1', titre: ok ? 'Net à payer = net avant impôt − impôt prélevé.' : 'Le net à payer ne correspond pas au net avant impôt moins l\'impôt prélevé à la source.',
        detail: `${euros(v.netAvantImpot)} − ${euros(v.impotMontant)} = ${euros(att)} ; net à payer imprimé : ${euros(v.netAPayer)}${ok ? '' : ` ; écart : ${euros(Math.abs(ec))}`}.`, source: SOURCES.r3243 }); }
    else if (e.code === 'B2') { const att = arrondi(v.impotBase * v.impotTaux / 100), ec = arrondi(v.impotMontant - att);
      sortir(e, ok, { code: 'B2', titre: ok ? 'Impôt prélevé = base × taux.' : 'L\'impôt prélevé ne correspond pas à la base multipliée par le taux.',
        detail: `${euros(v.impotBase)} × ${pct(v.impotTaux)} = ${euros(att)} ; imprimé : ${euros(v.impotMontant)}${ok ? '' : ` ; écart : ${euros(Math.abs(ec))}`}.`, source: SOURCES.r3243 }); }
    else if (e.code === 'N1') { const att = arrondi(v.brut - v.totalCotisations), a = (v.autresLignes || []).slice(0, 6);
      // Ancre seulement : une ligne non lue entre le total et le net (titres-restaurant, transport, acompte…) produirait le
      // même écart qu'un net retouché. Cohérente : listée ; sinon rangée dans `incertaines` (garde-fou), jamais un constat.
      if (!ok && gardeFou) { res.incertaines.push({ code: 'N1', titre: 'net avant impôt' }); continue; }
      sortir(e, ok, { code: 'N1', titre: ok ? 'Brut − cotisations salariales = net à payer avant impôt.' : 'Le net à payer avant impôt ne correspond pas au brut moins les cotisations salariales.',
        detail: `${euros(v.brut)} − ${euros(v.totalCotisations)} = ${euros(att)}${a.length ? ` ; lignes entre le total et le net : ${a.map(euros).join(', ')}` : ''} ; net à payer avant impôt imprimé : ${euros(v.netAvantImpot)}${ok ? '' : ` ; écart : ${euros(Math.abs(arrondi(att - v.netAvantImpot)))}`}.`, source: SOURCES.arrete }); }
    else if (e.code === 'S1') { const att = arrondi(v.heures * v.tauxHoraire);
      sortir(e, ok, { code: 'S1', titre: ok ? 'Salaire de base = heures × taux horaire.' : 'Le salaire de base ne correspond pas aux heures multipliées par le taux horaire.',
        detail: `${String(v.heures).replace('.', ',')} h × ${String(v.tauxHoraire).replace('.', ',')} € = ${euros(att)} ; imprimé : ${euros(v.salaireBase)}${ok ? '' : ` ; écart : ${euros(Math.abs(arrondi(att - v.salaireBase)))}`}.`, source: SOURCES.calcul }); }
    else if (e.code === 'L1') { const l = L[e.ligne], att = arrondi(Math.abs(l.base * l.taux) / 100);
      // Une ligne cohérente n'est pas listée (trop de lignes) ; seul un écart l'est.
      if (!ok) sortir(e, ok, { code: 'L1', titre: `La cotisation « ${l.libelle || 'sans libellé'} » ne correspond pas à sa base multipliée par son taux.`,
        detail: `${euros(l.base)} × ${pct(l.taux)} = ${euros(att)} ; imprimé : ${euros(Math.abs(l.montant))} ; écart : ${euros(Math.abs(arrondi(att - Math.abs(l.montant))))}.`, source: SOURCES.calcul }); }
  }
  // Lignes de cotisations cohérentes : une règle de synthèse (affichée), seulement si au moins une ligne est vérifiable.
  const L1 = E.filter((e) => e.code === 'L1');
  if (L1.length && L1.every((e) => tient.get(e))) res.regles.push({ code: 'L1', ok: true, titre: `Cotisations : base × taux = montant (${L1.length} ligne${L1.length > 1 ? 's' : ''}).`, detail: '', source: SOURCES.calcul });
  // C2 : un cumul contient le mois.
  for (const [kc, kv, lib] of [['cumulBrut', 'brut', 'brut'], ['cumulNetImposable', 'netImposable', 'net imposable']]) {
    const cu = nombre(v[kc]), va = nombre(v[kv]); if (cu == null || va == null || !v.periode) continue;
    const janvier = v.periode.slice(5) === '01';
    const e = { code: 'C2', champs: [kc, kv], tient: (x) => (janvier ? Math.abs(x[kc] - x[kv]) <= TOLERANCES.net : x[kc] >= x[kv] - TOLERANCES.net) };
    const ok = e.tient(vals);
    if (ok) continue;   // cohérent : non listé (le cumul est vérifié avec le bulletin précédent)
    sortir(e, ok, { code: 'C2', titre: janvier ? `Le cumul ${lib} de janvier diffère du ${lib} du mois.` : `Le cumul ${lib} de l'année est inférieur au ${lib} du mois.`, detail: `Cumul imprimé : ${euros(cu)} ; ${lib} du mois : ${euros(va)}.`, source: SOURCES.calcul });
  }
  // TL : taux salariaux légaux 2026, sur les lignes reconnues dont base × taux = montant tient (taux confirmé).
  if (v.periode && ANNEES_TAUX.includes(String(v.periode).slice(0, 4)) && lignesSures) {
    // Taux qu'une lecture décalée peut donner : taux légal d'une autre ligne, taux patronaux 2026 (Urssaf, Agirc-Arrco),
    // taux de CSG/CRDS des revenus de remplacement (6,2 / 3,8 / 4,3 / 0,5).
    const tous = [...new Set([...Object.values(TAUX_LEGAUX).flat(), 8.55, 2.11, 2.02, 4.72, 1.29, 12.95, 1.62, 0.21, 0.036, 13, 7, 5.25, 3.45, 4, 4.05, 0.25, 0.3, 0.1, 0.5, 0.016, 6.2, 3.8, 4.3, 6.6, 9.2, 3.15, 0.86, 0.14, 8.64, 1.08, 0.024])];
    const ecarts = [];
    L.forEach((l, i) => {
      const cat = categorieLigne(l.libelle); if (!cat || cat === 'redhs' || l.taux == null) return;
      const eL1 = L1.find((e) => e.ligne === i); if (!eL1 || !tient.get(eL1)) return;
      const t = Math.abs(l.taux), legal = TAUX_LEGAUX[cat];
      // Taux légal, ou taux effectif imprimé sur une base égale au brut (taux × 98,25 %, ex. 6,681 % pour 6,80 %).
      if (legal.some((x) => Math.abs(x - t) <= 0.005 || Math.abs(x * 0.9825 - t) <= 0.0015)) return;
      // Libellé collé sur une ligne voisine : taux d'une autre ligne connue, OU même catégorie portée ailleurs avec un taux
      // légal, OU taux légal de cette catégorie présent sur une autre ligne (relecture finale du 16/10).
      const ailleurs = L.some((m, j) => j !== i && m.taux != null && ((categorieLigne(m.libelle) === cat && legal.some((x) => Math.abs(x - Math.abs(m.taux)) <= 0.005)) || legal.some((x) => Math.abs(x - Math.abs(m.taux)) <= 0.005)));
      ecarts.push({ l, cat, t, legal, decale: tous.some((x) => Math.abs(x - t) <= 0.005) || ailleurs });
    });
    // Plusieurs taux hors norme sur un même bulletin, ou un taux légal d'une AUTRE ligne : lignes décalées à la lecture.
    if (gardeFou && ecarts.length >= 2) for (const x of ecarts) res.incertaines.push({ code: 'TL', titre: x.l.libelle });
    else for (const x of ecarts) {
      // Constat seulement sur une ligne CSG/CRDS d'un bulletin du régime général de métropole (vieillesse plafonnée lue à
      // 6,90 %, base × taux = montant) : vieillesse et Alsace-Moselle hors norme peuvent relever d'un autre régime
      // (Mayotte, régimes spéciaux, non vérifiés) → jamais un constat.
      const regimeGeneral = L.some((l, i) => categorieLigne(l.libelle) === 'vp' && l.taux != null && Math.abs(Math.abs(l.taux) - 6.9) <= 0.005 && L1.find((e) => e.ligne === i && tient.get(e)));
      if (gardeFou && (x.decale || !['csgd', 'csgnd', 'crds'].includes(x.cat) || !regimeGeneral)) { res.incertaines.push({ code: 'TL', titre: x.l.libelle }); continue; }
      res.regles.push({ code: 'TL', ok: false, ligne: x.l.libelle, attendu: x.legal.map(pct).join(' ou '), titre: `Le taux salarial de « ${x.l.libelle} » diffère du taux légal 2026 (${LIB_LIGNE[x.cat]}).`, detail: `Taux imprimé : ${pct(x.t)} ; taux légal : ${x.legal.map(pct).join(' ou ')}.`, source: SOURCES.urssaf });
    }
    const nTL = L.filter((l, i) => categorieLigne(l.libelle) && categorieLigne(l.libelle) !== 'redhs' && L1.find((e) => e.ligne === i && tient.get(e))).length;
    if (nTL && !ecarts.length) res.regles.push({ code: 'TL', ok: true, titre: `Taux salariaux légaux 2026 respectés (${nTL} ligne${nTL > 1 ? 's' : ''} reconnue${nTL > 1 ? 's' : ''}).`, detail: '', source: SOURCES.urssaf });
  }
  // CS : assiette CSG/CRDS non déductible ≥ assiette CSG déductible (BOSS : la part des heures sup. passe en non déductible).
  const tauxDuLibelle = (l) => { const c = categorieLigne(l.libelle); return c && l.taux != null && TAUX_LEGAUX[c].some((x) => Math.abs(x - Math.abs(l.taux)) <= 0.005); };
  const iD = L.findIndex((l) => categorieLigne(l.libelle) === 'csgd' && l.base != null && (!gardeFou || tauxDuLibelle(l))), iN = L.findIndex((l) => ['csgnd', 'crds'].includes(categorieLigne(l.libelle)) && l.base != null && (!gardeFou || tauxDuLibelle(l)));
  if (iD >= 0 && iN >= 0 && lignesSures) {
    const e = { code: 'CS', champs: [`L${iN}.base`, `L${iD}.base`], tient: (x) => Math.abs(x[`L${iN}.base`]) >= Math.abs(x[`L${iD}.base`]) - 0.011 };
    const ok = e.tient(vals);
    sortir(e, ok, { code: 'CS', titre: ok ? 'Assiette de la CSG non déductible ≥ assiette de la CSG déductible.' : 'L\'assiette de la CSG non déductible est inférieure à celle de la CSG déductible.', detail: `${euros(L[iN].base)} et ${euros(L[iD].base)}.`, source: SOURCES.boss });
  }
  return res;
}

/**
 * Raison affichée sous le badge d'une pièce « À vérifier » ou « Non vérifiable » (décision de Didier, 16/10) : la CAUSE et
 * QUOI VÉRIFIER, au ton neutre (infinitif). `rang` : 1 = la plus importante (affichée en premier).
 * @param {{code:string, ok:boolean|null, quoi?:string, mois?:string, recent?:string, ligne?:string, attendu?:string, garant?:boolean, proche?:boolean}} x
 * @returns {{cause:string, verifier:string, rang:number}}
 */
export function raisonDe(x) {
  const R = (cause, verifier, rang) => ({ cause, verifier, rang });
  const conclu = x && x.ok === false;
  switch (x && x.code) {
    case 'B1': return R('Le net payé ne correspond pas au calcul (acompte, saisie ou lecture possibles)', 'comparer avec le virement du salaire sur le relevé bancaire', 1);
    case 'N1': return R('Le net avant impôt ne correspond pas au brut moins les cotisations', 'comparer le net payé avec le virement du salaire sur le relevé bancaire', 2);
    case 'B4': case 'CB': case 'C2': return R('Cumul de l\'année incohérent avec les mois précédents', 'demander le bulletin de décembre ou une attestation employeur', 2);
    case 'B2': return R('L\'impôt prélevé ne correspond pas à sa base et à son taux', 'chercher une régularisation du prélèvement sur le bulletin', 3);
    case 'S1': return R('Le salaire de base ne correspond pas aux heures payées', 'vérifier les heures et le taux horaire sur le bulletin', 3);
    case 'L1': return R('Une cotisation ne correspond pas à sa base et à son taux', 'vérifier les lignes de cotisations sur la pièce d\'origine', 3);
    case 'TL': return conclu ? R(`Taux de « ${x.ligne || 'cotisation'} » différent du taux légal 2026 (${x.attendu || 'taux légal'} attendu)`, 'vérifier la pièce d\'origine', 2)
      : R('Taux de cotisation inhabituel (autre régime ou lecture à confirmer)', 'vérifier les taux sur la pièce d\'origine', 3);
    case 'CS': return conclu ? R('Assiettes de la CSG incohérentes', 'vérifier les lignes de CSG sur la pièce d\'origine', 2) : R('Assiettes de la CSG à confirmer', 'vérifier les lignes de CSG sur la pièce d\'origine', 3);
    case 'B6': return x.quoi === 'siret' ? (conclu ? R('Employeur différent de celui déclaré', 'vérifier le SIRET sur l\'Annuaire des entreprises', 2) : R('SIRET de l\'employeur lu avec incertitude', 'comparer avec le SIRET déclaré', 4))
      : (conclu ? R(`Nom différent ${x.garant ? 'du garant' : 'du candidat'}`, 'un nom d\'usage peut l\'expliquer ; vérifier la pièce d\'identité', 1) : R('Nom du salarié lu avec incertitude', 'comparer avec la pièce d\'identité', 4));
    case 'B5': return x.mois ? R(`Mois manquant${x.garant ? ' du garant' : ''} (${x.mois})`, 'demander le bulletin manquant', 3) : R(`Bulletin le plus récent : ${x.recent || 'ancien'}`, 'demander les derniers bulletins de salaire', 3);
    case 'B7': return x.quoi === 'employeur' ? R('Employeur du contrat différent de celui des bulletins', 'une agence d\'intérim peut l\'expliquer ; vérifier le contrat', 2)
      : x.proche ? R('Date d\'entrée différente du contrat de quelques semaines', 'date de signature ou d\'ancienneté possible ; vérifier la date d\'entrée sur le contrat', 2)
        : R('Date d\'entrée différente du contrat', 'un CDD suivi d\'un CDI peut l\'expliquer ; vérifier l\'avenant ou le nouveau contrat', 2);
    default: return R('Contrôle non concluant', 'comparer la pièce aux autres pièces du dossier', 5);
  }
}

/** Deux noms qui ne diffèrent que d'une lettre (lecture) : distance d'édition ≤ 1 sur la chaîne normalisée. */
function uneLettre(a, b) {
  // Lecture plausible d'un nom : confusions de l'OCR (rn↔m, cl↔d, ii↔u, vv↔w, 0↔o, 1↔l) puis distance d'édition ≤ 2.
  const n = (x) => norm(x).replace(/0/g, 'o').replace(/1/g, 'l').replace(/[^a-z ]/g, '').replace(/rn/g, 'm').replace(/cl/g, 'd').replace(/ii/g, 'u').replace(/vv/g, 'w');
  a = n(a); b = n(b);
  if (a === b) return true; if (Math.abs(a.length - b.length) > 2) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= 2;
}
const memeAUneErreurPres = (a, b) => a === b || variantesChiffres(a).has(b);

/**
 * Analyse de tous les bulletins (et de la page 1 du contrat) d'une personne du dossier.
 * @param {{pieces: Array<{id, nom, type:'bulletin'|'contrat', ia}>, identite:{nom, prenom}, siretDeclare?:string, recuLe?:string, qui?:'candidat'|'garant', gardeFou?:boolean}} p
 * `gardeFou: false` : réservé à la mesure (mockups/REGLES-PAIE) ; l'app ne le passe jamais.
 * @returns {{ parPiece: Object<string,{etat, regles, constats, incertaines, lectureIncertaine}>, constats: Array }}
 */
export function analyserBulletins({ pieces, identite, siretDeclare, recuLe, qui, gardeFou = true }) {
  const G = gardeFou !== false;
  const parPiece = {}; const constats = [];
  const quiTxt = qui === 'garant' ? ' du garant' : '';
  const bull = [], contrats = [];
  for (const p of (pieces || []).filter((x) => x && typeof x === 'object')) {
    const v = valeursRetenues(p.ia);
    const e = { etat: 'ia_non_lancee', regles: [], constats: [], incertaines: [], lectureIncertaine: false };
    parPiece[p.id] = e;
    if (!p.ia) continue;
    if (p.ia.erreur) { e.etat = 'ia_erreur'; e.erreur = p.ia.erreur; continue; }
    if (!v || v.lisible === false) { e.etat = 'illisible'; continue; }
    if (p.type === 'contrat') { contrats.push({ p, v, e }); e.etat = 'lu'; continue; }
    // Cumul égal au montant du mois hors janvier et hors mois d'entrée : colonne du mois lue à la place du cumul → ignoré.
    for (const [kc, kv] of [['cumulBrut', 'brut'], ['cumulNetImposable', 'netImposable']]) {
      if (G && v[kc] != null && v[kv] != null && Math.abs(v[kc] - v[kv]) <= TOLERANCES.net && v.periode && v.periode.slice(5) !== '01' && !(v.dateEntree && v.dateEntree.slice(0, 7) === v.periode)) v[kc] = null;
    }
    const a = analyseInterne(v, G);
    e.incertaines = a.incertaines; e.lectureIncertaine = a.lectureIncertaine;
    bull.push({ p, v, e, a });
  }
  const nom = (p) => `« ${p.nom} »`;
  const ajouter = (e, c) => { e.constats.push(c); constats.push(c); };
  const fiables = bull.filter((b) => !b.a.lectureIncertaine);

  for (const { p, v, e, a } of fiables) {
    e.regles = a.regles;
    for (const r of e.regles) if (!r.ok) ajouter(e, { code: r.code, ligne: r.ligne, attendu: r.attendu, icone: 'calc', titre: `Bulletin ${libellePeriode(v.periode) || nom(p)} : ${r.titre.charAt(0).toLowerCase()}${r.titre.slice(1)}`, detail: r.detail, source: r.source.libelle, url: r.source.url, ia: true, pieceId: p.id });
    // Identité (comparaison sans accents, tirets ni ordre ; une lettre d'écart = lecture incertaine, pas de constat).
    if (v.salarie && identite && identite.nom) {
      const ok = identiteConcorde(v.salarie, identite.nom, identite.prenom);
      const declare = [identite.prenom, identite.nom].filter(Boolean).join(' ');
      if (G && ok === false && (uneLettre(v.salarie, declare) || uneLettre(v.salarie, [identite.nom, identite.prenom].filter(Boolean).join(' ')))) e.incertaines.push({ code: 'B6', titre: 'nom' });
      else {
        e.regles.push({ code: 'B6', quoi: 'nom', garant: qui === 'garant', ok: ok === null ? null : ok, titre: ok === false ? 'Le nom du salarié diffère de l\'identité déclarée.' : ok === null ? 'Nom du salarié' : 'Nom du salarié identique à l\'identité déclarée.', detail: `Salarié : ${v.salarie} ; identité déclarée${quiTxt} : ${declare}.`, source: { libelle: 'comparaison sans accents ni tirets' } });
        if (ok === false) ajouter(e, { code: 'B6', quoi: 'nom', garant: qui === 'garant', icone: 'doc', titre: `Bulletin ${libellePeriode(v.periode) || nom(p)} : le nom du salarié diffère de l'identité déclarée${quiTxt}.`, detail: `Salarié : ${v.salarie} ; identité déclarée : ${declare}. Un nom d'usage peut l'expliquer.`, source: 'lecture du bulletin (proposée par l\'IA, à vérifier)', ia: true, pieceId: p.id });
      }
    }
    // SIRET lu ≠ SIRET déclaré (comparaison au niveau SIREN si un SIREN a été déclaré) ; un chiffre d'écart = lecture incertaine.
    const sd = siretDe(siretDeclare), sl = siretDe(v.siret);
    if (sd && sl) {
      // Comparaison au niveau du SIREN : le SIRET déclaré peut être celui du siège, le bulletin celui de l'établissement.
      const cmpL = sl.slice(0, 9), cmpD = sd.slice(0, 9);
      const ok = cmpL === cmpD;
      if (G && !ok && memeAUneErreurPres(cmpL, cmpD)) e.incertaines.push({ code: 'B6', titre: 'SIRET' });
      else {
        e.regles.push({ code: 'B6', quoi: 'siret', ok, titre: ok ? 'SIRET identique à celui déclaré.' : 'Le SIRET du bulletin diffère de celui déclaré.', detail: `SIRET du bulletin : ${sl} ; déclaré : ${sd}.`, source: { libelle: 'déclaration du candidat' } });
        if (!ok) ajouter(e, { code: 'B6', quoi: 'siret', icone: 'building', titre: `Bulletin ${libellePeriode(v.periode) || nom(p)} : le SIRET de l'employeur diffère de celui déclaré.`, detail: `SIRET lu sur le bulletin : ${sl} ; déclaré : ${sd}.`, source: 'lecture du bulletin (proposée par l\'IA, à vérifier)', ia: true, pieceId: p.id });
      }
    }
  }

  // Entre bulletins : cumuls (B4 net imposable, CB brut), même employeur, même année, mois consécutifs.
  const tries = fiables.filter((b) => moisIndex(b.v.periode) != null).sort((a, b) => moisIndex(a.v.periode) - moisIndex(b.v.periode));
  const serie = [];
  for (let i = 1; i < tries.length; i++) {
    const A = tries[i - 1], B = tries[i];
    const nomEmp = (x) => norm(x).replace(/[^a-z0-9]/g, '');
    const memeEmployeur = ((siretDe(A.v.siret) && siretDe(B.v.siret)) ? siretDe(A.v.siret) === siretDe(B.v.siret) : true)
      && !(A.v.employeur && B.v.employeur && nomEmp(A.v.employeur) !== nomEmp(B.v.employeur))
      && !(B.v.dateEntree && String(B.v.dateEntree).slice(0, 7) > A.v.periode);   // entrée après le mois de A : nouvel emploi
    if (moisIndex(B.v.periode) - moisIndex(A.v.periode) !== 1 || !memeEmployeur || A.v.periode.slice(0, 4) !== B.v.periode.slice(0, 4)) continue;
    for (const [code, kc, kv, lib] of [['B4', 'cumulNetImposable', 'netImposable', 'net imposable'], ['CB', 'cumulBrut', 'brut', 'brut']]) {
      const ca = nombre(A.v[kc]), cb = nombre(B.v[kc]), nb = nombre(B.v[kv]);
      if (ca == null || cb == null || nb == null) continue;
      serie.push({ code, A, B, kc, kv, lib, ca, cb, nb, champs: ['a', 'b', 'n'], vals: { a: ca, b: cb, n: nb }, tient: (x) => Math.abs(x.b - arrondi(x.a + x.n)) <= TOLERANCES.cumul });
    }
  }
  // Une variante de lecture d'un champ de la série doit garder les autres égalités qui tiennent : celles du bulletin B
  // pour son montant du mois, les continuités voisines pour les cumuls.
  const okSerie = new Map(serie.map((s) => [s, s.tient(s.vals)]));
  // Cumuls : jamais un constat (2e relecture Opus : cumul lu dans une colonne voisine du tableau des cumuls, bulletin
  // complémentaire non fourni, période mal lue) ; un échec rend le bulletin « non vérifiable » (ok = null).
  for (const s of serie) {
    const ok = okSerie.get(s);
    const attendu = arrondi(s.ca + s.nb), ecart = arrondi(s.cb - attendu);
    if (G && !ok) { s.B.e.incertaines.push({ code: s.code, titre: 'cumul' }); continue; }
    const titreOk = s.code === 'B4' ? `Cumul net imposable dans la continuité ${dePeriode(s.A.v.periode)}.` : `Cumul brut dans la continuité ${dePeriode(s.A.v.periode)}.`;
    const titreKo = `Le cumul ${s.lib} ne prolonge pas celui ${dePeriode(s.A.v.periode)}.`;
    s.B.e.regles.push({ code: s.code, ok, titre: ok ? titreOk : titreKo, detail: `${euros(s.ca)} + ${euros(s.nb)} = ${euros(attendu)} ; cumul imprimé : ${euros(s.cb)}${ok ? '' : ` ; écart : ${euros(Math.abs(ecart))}`}.`, source: SOURCES.arrete });
    if (!ok) ajouter(s.B.e, { code: s.code, icone: 'calc', titre: `Bulletin ${libellePeriode(s.B.v.periode)} : le cumul ${s.lib} ne prolonge pas celui du bulletin ${dePeriode(s.A.v.periode)}.`, detail: `Cumul ${dePeriode(s.A.v.periode)} ${euros(s.ca)} + ${s.lib} ${euros(s.nb)} = ${euros(attendu)} ; cumul imprimé ${euros(s.cb)}. Écart : ${euros(Math.abs(ecart))}.`, source: SOURCES.arrete.libelle + ', cumul annuel', url: SOURCES.arrete.url, ia: true, pieceId: s.B.p.id });
  }
  // Périodes : sur TOUS les bulletins dont la période est lue (un bulletin sans quorum a bien été reçu) ; une période qu'UNE
  // erreur de lecture rendrait consécutive → pas de constat, sauf trou attesté par les cumuls de deux bulletins sûrs.
  const triesP = bull.filter((b) => moisIndex(b.v.periode) != null).sort((a, b) => moisIndex(a.v.periode) - moisIndex(b.v.periode));
  const sur = new Set(fiables);
  const periodes = triesP.map((t) => t.v.periode);
  const consecutives = (ps) => { const ix = ps.map(moisIndex).filter((x) => x != null).sort((a, b) => a - b); for (let i = 1; i < ix.length; i++) if (ix[i] - ix[i - 1] > 1) return false; return true; };
  const variantesPeriode = (p) => [...variantesChiffres(p.replace('-', ''))].filter((s) => /^\d{6}$/.test(s) && +s.slice(4) >= 1 && +s.slice(4) <= 12).map((s) => `${s.slice(0, 4)}-${s.slice(4)}`);
  if (triesP.length >= 2) {
    const manquants = [];
    for (let i = 1; i < triesP.length; i++) for (let m = moisIndex(triesP[i - 1].v.periode) + 1; m < moisIndex(triesP[i].v.periode); m++) manquants.push(`${MOIS[m % 12]} ${Math.floor(m / 12)}`);
    // Une période qu'UNE erreur de lecture rend consécutive est une lecture plausible, sauf si les cumuls de bulletins sûrs
    // contredisent la position corrigée (cumul(B) − cumul(A) ≠ montant de B) : alors le trou est réel.
    const cumulsCollent = (i, q) => {
      const liste = triesP.map((t, j) => ({ t, p: j === i ? q : t.v.periode })).sort((a, b) => moisIndex(a.p) - moisIndex(b.p));
      for (let j = 1; j < liste.length; j++) {
        const A = liste[j - 1], B = liste[j];
        if (!sur.has(A.t) || !sur.has(B.t) || moisIndex(B.p) - moisIndex(A.p) !== 1 || A.p.slice(0, 4) !== B.p.slice(0, 4)) continue;
        for (const [kc, kv] of [['cumulBrut', 'brut'], ['cumulNetImposable', 'netImposable']]) {
          const ca = A.t.v[kc], cb = B.t.v[kc], vb = B.t.v[kv];
          if (ca != null && cb != null && vb != null && cb < ca + vb - TOLERANCES.cumul) return false;   // plus haut : complémentaire possible
        }
      }
      return true;
    };
    const lecture = G && manquants.length && periodes.some((p, i) => variantesPeriode(p).some((q) => !periodes.some((x, j) => j !== i && x === q) && consecutives(periodes.map((x, j) => (j === i ? q : x))) && cumulsCollent(i, q)));
    const liste = manquants.length > 6 ? manquants.slice(0, 6).join(', ') + ` et ${manquants.length - 6} autre${manquants.length - 6 > 1 ? 's' : ''}` : manquants.join(', ');
    if (manquants.length && !lecture) constats.push({ code: 'B5', mois: liste, garant: qui === 'garant', icone: 'clock', titre: `Bulletins${quiTxt} : période${manquants.length > 1 ? 's' : ''} absente${manquants.length > 1 ? 's' : ''} entre les bulletins reçus (${liste}).`, detail: `Bulletins reçus : ${triesP.map((t) => libellePeriode(t.v.periode)).join(', ')}. Le décret prévoit les trois derniers bulletins de salaire.`, source: SOURCES.decret.libelle, url: SOURCES.decret.url, ia: true });
  }
  const r0 = recuLe ? new Date(recuLe) : null;
  if (triesP.length && r0 && !isNaN(r0.getTime())) {
    const r = r0; const ir = r.getUTCFullYear() * 12 + r.getUTCMonth();
    const dernier = triesP[triesP.length - 1];
    const recent = (p) => ir - moisIndex(p) <= 2;
    if (!recent(dernier.v.periode) && !(G && variantesPeriode(dernier.v.periode).some((q) => recent(q) && ir - moisIndex(q) >= 0))) {
      constats.push({ code: 'B5', recent: libellePeriode(dernier.v.periode), icone: 'clock', titre: `Bulletins${quiTxt} : le plus récent porte sur ${libellePeriode(dernier.v.periode)}.`, detail: `Pour un dossier reçu le ${fdate(r.toISOString())}, les trois derniers bulletins couvrent en principe les mois précédant la réception.`, source: SOURCES.decret.libelle, url: SOURCES.decret.url, ia: true });
    }
  }
  // Contrat de travail (page 1) ↔ bulletins : employeur et date d'entrée (un chiffre d'écart = lecture incertaine).
  for (const { p, v, e } of contrats) {
    for (const { p: pb, v: vb } of fiables) {
      const inverse = (d) => d.slice(0, 5) + d.slice(8, 10) + '-' + d.slice(5, 7);   // AAAA-JJ-MM
      const mi = (d) => +String(d).slice(0, 4) * 12 + +String(d).slice(5, 7);
      const differe = v.dateDebut && vb.dateEntree && v.dateDebut !== vb.dateEntree && !(G && (memeAUneErreurPres(v.dateDebut.replace(/-/g, ''), vb.dateEntree.replace(/-/g, '')) || inverse(v.dateDebut) === vb.dateEntree));
      if (differe) {
        // Décision de Didier (16/10) : un CDD suivi d'un CDI, une date de signature ou d'ancienneté lue à la place → jamais
        // « À vérifier » ; la pièce est « Non vérifiable » avec sa raison (moins de 3 mois : date de signature probable).
        e.regles.push({ code: 'B7', ok: null, quoi: 'date', proche: Math.abs(mi(v.dateDebut) - mi(vb.dateEntree)) < 3, titre: 'Date d\'entrée du contrat', detail: `Contrat : ${fdate(v.dateDebut)} ; bulletin ${libellePeriode(vb.periode) || nom(pb)} : ${fdate(vb.dateEntree)}.`, source: { libelle: 'lecture du contrat et du bulletin (proposée par l\'IA, à vérifier)' } });
        break;
      }
    }
    const sc = siretDe(v.siret);
    const autre = fiables.find((b) => siretDe(b.v.siret) && sc && siretDe(b.v.siret).slice(0, 9) !== sc.slice(0, 9) && !(G && memeAUneErreurPres(siretDe(b.v.siret).slice(0, 9), sc.slice(0, 9))));
    if (autre) constats.push({ code: 'B7', quoi: 'employeur', icone: 'building', titre: `Contrat ${nom(p)} et bulletin ${libellePeriode(autre.v.periode)} : employeurs différents (SIREN).`, detail: `Contrat : ${sc} ; bulletin : ${siretDe(autre.v.siret)}.`, source: 'lecture du contrat et du bulletin (proposée par l\'IA, à vérifier)', ia: true, pieceId: p.id });
  }
  // Règles non conclues (garde-fou) : publiées avec ok = null sous un titre neutre (« Non lu : … » à l'affichage), une
  // par nature, jamais un écart. Bulletin sans quorum : aucune règle (« Montants non contrôlés »).
  const NEUTRES = { B1: 'Net à payer et impôt prélevé', B2: 'Impôt prélevé : base × taux', N1: 'Brut, cotisations et net avant impôt',
    S1: 'Salaire de base : heures × taux horaire', L1: 'Cotisations : base × taux', C2: 'Cumuls de l\'année', TL: 'Taux légaux des cotisations',
    CS: 'Assiette de la CSG', B4: 'Cumul net imposable avec le mois précédent', CB: 'Cumul brut avec le mois précédent' };
  for (const { e } of bull) {
    if (G && !e.lectureIncertaine) {
      const vus = new Set(e.regles.filter((r) => r.ok === true || r.ok === false).map((r) => r.code + '|' + r.titre));
      const deja = new Set();
      for (const x of e.incertaines) {
        const titre = x.code === 'B6' ? (x.titre === 'nom' ? 'Nom du salarié' : 'SIRET de l\'employeur') : (NEUTRES[x.code] || x.code);
        if (deja.has(titre) || vus.has(x.code + '|' + titre)) continue; deja.add(titre);
        e.regles.push({ code: x.code, ok: null, quoi: x.code === 'B6' ? (x.titre === 'nom' ? 'nom' : 'siret') : undefined, titre, detail: 'Lecture à confirmer : valeur à vérifier sur la pièce.', source: { libelle: 'garde-fou de lecture' } });
      }
    }
    if (G && e.regles.some((r) => r.ok === null && r.code !== 'B6')) e.regles = e.regles.filter((r) => r.ok !== true);
    e.etat = e.constats.length ? 'ecart' : (e.regles.some((r) => r.ok === true || r.ok === false) ? 'sans_ecart' : 'lu');
  }
  // Raisons (cause + quoi vérifier) jointes à toute règle qui ne conclut pas « respectée » et à tout constat.
  const joindre = (x) => { if (x && x.ok !== true) Object.assign(x, raisonDe(x)); };
  for (const { e } of [...bull, ...contrats]) e.regles.forEach(joindre);
  constats.forEach((c) => Object.assign(c, raisonDe(Object.assign({ ok: false }, c))));
  return { parPiece, constats };
}
