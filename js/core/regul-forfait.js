/**
 * core/regul-forfait.js — FORFAIT DE CHARGES (loi n° 89-462 : art. 25-10 meublé, art. 8-1, V colocation) dans la RÉGULARISATION.
 *
 * Le forfait de charges n'est pas régularisable. La régularisation (computeRegul, index.html) retire
 * donc, pour chaque occupation, les charges réelles et les provisions datées PENDANT une période au
 * forfait — sans toucher une période aux provisions (exercice N-1, année de transition, retour aux
 * provisions). L'état forfait à une date est lu par `bailForfaitActifLe` (avenant.js) dans les avenants
 * du bail (registre `baux_evenements` + anciens `bail.avenants[]`).
 *
 * PUR : aucune lecture de DB, du DOM ni de l'horloge. index.html injecte les données et appelle ces
 * fonctions (exposées sur window par main.js). Tests : __tests__/helpers/regul-forfait.test.js
 */
import { bailForfaitActifLe, forfaitEtapes, forfaitPertinent, avenantObjetApplique, avenantApplique, regimeForfaitObjet, effetAvenant } from './avenant.js';
import { listeAvenants } from './avenant-registre.js';

const _ymd = (s) => String(s == null ? '' : s).slice(0, 10);
const _jour = 86400000;
const _t = (iso) => Date.parse(_ymd(iso) + 'T00:00:00Z');
const _iso = (t) => new Date(t).toISOString().slice(0, 10);
const _veille = (iso) => _iso(_t(iso) - _jour);
const _r2 = (x) => Math.round(x * 100) / 100;
function _frDate(iso) {
  const p = _ymd(iso).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : _ymd(iso);
}

/**
 * Avenants qui régissent CE bail, pour la timeline forfait. Liste du registre (listeAvenants : registre
 * + anciens avenants, statuts compris). `debutsClos` : débuts des baux clos du logement — un avenant
 * rattaché à l'un d'eux n'est jamais attribué au bail courant. `finIso` (bail clos) : un avenant d'un
 * bail SUIVANT (autre début de bail, daté après la fin de celui-ci) n'est pas retenu.
 */
export function forfaitAvenantsDuBail({ journal, bailEvents, cle, bail, finIso, debutsClos } = {}) {
  if (!bail) return undefined;
  const liste = listeAvenants({ journal, bailEvents, cle, bail, debutsClos });
  const debut = _ymd(bail.debut), fin = _ymd(finIso);
  if (!fin) return liste;
  return liste.filter((a) => _ymd(a.bailDebut) === debut || _ymd(a.date) <= fin);
}

/** Jours de [debutIso, finIso] (inclus) NON couverts par le forfait. Arithmétique UTC sur des dates ISO. */
export function occNonForfaitJours(bail, debutIso, finIso, avenants) {
  const d = _ymd(debutIso);
  if (!d) return 0;
  const t0 = _t(d), t1 = _t(_ymd(finIso) || d);
  if (!(t1 >= t0)) return 0;
  let jours = 0;
  for (let t = t0; t <= t1; t += _jour) if (!bailForfaitActifLe(bail, _iso(t), avenants)) jours++;
  return jours;
}

/**
 * Intervalles au forfait qui recoupent [fromIso, toIso] (bornes incluses, coupés à la fenêtre) :
 * [{ du, au }]. Forfait d'origine (flag seul, sans avenant de charges) → toute la fenêtre.
 */
export function forfaitIntervalles(bail, fromIso, toIso, avenants) {
  const from = _ymd(fromIso), to = _ymd(toIso);
  if (!bail || !from || !to || to < from) return [];
  const etapes = forfaitEtapes(bail, avenants);
  if (etapes === null) return bail.chForfait === true ? [{ du: from, au: to }] : [];
  const out = [];
  let debut = bailForfaitActifLe(bail, from, avenants) ? from : null;
  for (const e of etapes) {
    if (e.date <= from) continue;
    if (e.date > to) break;
    if (e.forfait && debut === null) debut = e.date;
    else if (!e.forfait && debut !== null) { if (_veille(e.date) >= debut) out.push({ du: debut, au: _veille(e.date) }); debut = null; }
  }
  if (debut !== null) out.push({ du: debut, au: to });
  return out;
}

/**
 * Post-traitement forfait d'UNE occupation de computeRegul (mutée et renvoyée). Retire des charges
 * (`details`) et des provisions (`moisDetails`) celles datées pendant le forfait, recalcule `charges`
 * et `provisions`, et pose `e.forfait` :
 *   { intervalles:[{du,au}], toute, partiel, effet, excluCharges, excluProvisions, exclusDetails, exclusMois }
 * `exclusDetails` garde les lignes retirées : la base d'estimation N-1 (charges du LOGEMENT) les relit.
 * Période examinée = l'occupation [debutOcc, finOcc] (repli : [from, to]). Aucun repère si aucun
 * intervalle au forfait ne recoupe l'occupation (exercice N-1 antérieur à l'avenant : intact).
 */
export function appliquerForfaitOccupation(e, { from, to, avenants } = {}) {
  const bl = e && e.bail;
  if (!bl || !forfaitPertinent(bl, avenants)) return e;
  const debutW = _ymd(e.debutOcc) || _ymd(from), finW = _ymd(e.finOcc) || _ymd(to);
  // Aucun intervalle au forfait ne recoupe l'OCCUPATION → rien à retirer, aucun repère. Une ligne datée
  // hors de l'occupation (cas défensif : computeRegul porte désormais une charge datée après le départ au
  // bailleur, vacance) ne rend pas « au forfait » une occupation qui ne l'a jamais été — et le décompte
  // n'imprime jamais une période au forfait vide (contre-audit 30/09).
  const intervalles = forfaitIntervalles(bl, debutW, finW, avenants);
  if (!intervalles.length) return e;
  const keptDet = [], exclusDetails = [], keptMois = [], exclusMois = [];
  let excluCharges = 0, excluProvisions = 0;
  (e.details || []).forEach((d) => {
    if (d && d.date && bailForfaitActifLe(bl, d.date, avenants)) { excluCharges += Number(d.montant) || 0; exclusDetails.push(d); }
    else keptDet.push(d);
  });
  (e.moisDetails || []).forEach((m) => {
    if (m && m.mois && bailForfaitActifLe(bl, m.mois + '-01', avenants)) { excluProvisions += Number(m.ch) || 0; exclusMois.push(m); }
    else keptMois.push(m);
  });
  if (exclusDetails.length || exclusMois.length) {
    e.details = keptDet; e.charges = _r2(keptDet.reduce((s, d) => s + (Number(d.montant) || 0), 0));
    e.moisDetails = keptMois; e.provisions = _r2(keptMois.reduce((s, m) => s + (Number(m.ch) || 0), 0));
  }
  const toute = intervalles.length === 1 && intervalles[0].du <= debutW && intervalles[0].au >= finW;
  e.forfait = {
    intervalles, toute, partiel: !toute,
    effet: intervalles[0].du,
    excluCharges: _r2(excluCharges), excluProvisions: _r2(excluProvisions),
    exclusDetails, exclusMois,
  };
  return e;
}

/** « sur toute la période » ou « du 01/03/2026 au 31/08/2026 [et du … au …] ». Texte brut (à échapper). */
export function periodeForfaitLibelle(f) {
  if (!f) return '';
  const iv = Array.isArray(f.intervalles) ? f.intervalles : [];
  if (f.toute) return 'sur toute la période';
  if (!iv.length) return '';
  const parts = iv.map((i) => 'du ' + _frDate(i.du) + ' au ' + _frDate(i.au));
  return parts.length < 2 ? parts[0] : parts.slice(0, -1).join(', ') + ' et ' + parts[parts.length - 1];
}

/**
 * Base d'estimation : charges du LOGEMENT sur un exercice, par mouvement, depuis les occupations de
 * computeRegul — lignes gardées ET lignes retirées au titre du forfait (`forfait.exclusDetails`) : la
 * base estime les charges du logement, elle ne dépend pas du régime de charges de l'an passé.
 * @returns {{ total:number, moves:Array<{key,date,lib,montant}> }}
 */
export function baseChargesLogement(entries) {
  const byMv = {};
  (Array.isArray(entries) ? entries : []).forEach((e) => {
    const lignes = (e && e.details ? e.details : []).concat((e && e.forfait && e.forfait.exclusDetails) || []);
    lignes.forEach((d) => {
      const k = (d.mvId != null) ? ('id:' + d.mvId) : ((d.date || '') + '|' + (d.mvLib || d.lib || ''));
      if (!byMv[k]) byMv[k] = { key: k, date: d.date || '', lib: (d.mvLib || d.lib || ''), montant: 0 };
      byMv[k].montant += (d.montant || 0);
    });
  });
  const moves = Object.values(byMv)
    .map((m) => ({ key: m.key, date: m.date, lib: m.lib, montant: _r2(m.montant) }))
    .filter((m) => m.montant > 0)
    .sort((a, b) => b.montant - a.montant);
  // total = somme des parts arrondies → cohérent avec la « base retenue » (pas de dérive de cents)
  return { total: _r2(moves.reduce((s, m) => s + m.montant, 0)), moves };
}

// Règle « appliqué » d'un objet d'avenant : définie dans avenant.js (utilisée aussi par planApplication).
export { avenantObjetApplique };

const _REGIMES = ['Passage au forfait de charges', 'Retour aux provisions'];
/**
 * Ce que la carte d'un avenant AFFICHE comme appliqué / document seulement — sans réécrire la donnée.
 * Un avenant appliqué qui CHANGE le régime des charges (forfait ↔ provisions) est honoré par la
 * régularisation à sa date d'effet : il est « appliqué », même enregistré avant que la régularisation ne
 * lise le forfait (lot 2 : `appliques:[]`, « Document seulement : charges »).
 * Le régime « sans cet avenant » ignore le flag `chForfait` du bail : seul un avenant le pose, et c'est
 * justement celui-ci qui l'a posé.
 * @param {object} av  entrée du registre (ou avenant repris)
 * @param {{bail:object, avenants:Array, libelleCharges?:string}} ctx  avenants du bail (liste du registre)
 * @returns {{appliques:string[], docSeul:string[]}}
 */
export function avenantApplicationAffichee(av, { bail, avenants, libelleCharges = 'Charges' } = {}) {
  const app = Array.isArray(av && av.appliques) ? av.appliques.slice() : [];
  const doc = Array.isArray(av && av.docSeul) ? av.docSeul.slice() : [];
  const same = { appliques: app, docSeul: doc };
  if (!av || !bail || !avenantApplique(av)) return same;
  if (!(Array.isArray(av.objets) ? av.objets : []).some((o) => regimeForfaitObjet(o) !== null)) return same;
  const eff = effetAvenant(av);
  if (!eff) return same;
  const liste = Array.isArray(avenants) ? avenants : [];
  const sansFlag = Object.assign({}, bail, { chForfait: false });
  const avec = bailForfaitActifLe(sansFlag, eff, liste.some((x) => x && x.id === av.id) ? liste : liste.concat([av]));
  const sans = bailForfaitActifLe(sansFlag, eff, liste.filter((x) => x && x.id !== av.id));
  if (avec === sans) return same;
  const lbl = avec ? _REGIMES[0] : _REGIMES[1];
  return {
    appliques: app.filter((x) => !_REGIMES.includes(x)).concat([lbl]),
    // « Charges » en document seul : le montant n'a pas changé, mais le régime, lui, est appliqué.
    docSeul: doc.filter((x) => !_REGIMES.includes(x) && x !== libelleCharges),
  };
}
