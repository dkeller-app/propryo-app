/**
 * core/anteriorite.js — R0-C · Q1 RÉVISÉ (décisions Didier 01/10 → 05/10, docs/CDC-R0C.md en-tête,
 * maquette validée mockups/R0C/MAQUETTE-ANTERIORITE.html).
 *
 * LE point de départ des loyers suivis d'un lot. Trois sources, une seule règle :
 *   1. la DATE D'ACHAT (entrée en jouissance du bailleur actuel) — `logement.detenuDepuis` (exception
 *      par logement) sinon `immeuble.dateAcquisition`. Aucun loyer n'est dû au bailleur actuel avant
 *      elle (bien acheté loué : Ferrette, mars 2026) ;
 *   2. l'ANTÉRIORITÉ notée sur un bail (`bail.anteriorite`) : la date à partir de laquelle Propryo suit
 *      ce bail, et la situation du locataire à cette date (à jour, arriéré, avance). Ce solde d'ouverture
 *      entre UNE fois dans la dette (Finances et restitution) ;
 *   3. à défaut, la date PROVISOIRE posée pour les données existantes (décision (b) du 05/10) : le
 *      1ᵉʳ jour du mois du 1ᵉʳ loyer encaissé (= l'ancienne règle du moteur), marquée « à confirmer ».
 *      Aucun chiffre ne bouge tant que l'utilisateur ne confirme rien.
 * Jamais l'absence de relevés : sans date d'achat ni antériorité, c'est la date provisoire qui vaut,
 * et elle est signalée.
 *
 * PUR : aucune lecture de DB. L'app injecte les collections (app-part2 : `_finLotSuivi`).
 */
import { finOccupationBail } from './fin-occupation.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const _r2 = (n) => Math.round(n * 100) / 100;
const _vivant = (b) => !!b && !b._deleted;

/** 'YYYY-MM-DD' valide ou null (accepte 'YYYY-MM' → 1ᵉʳ du mois, et un ISO horodaté). */
export function normaliserDate(v) {
  if (v == null || v === '') return null;
  let s = String(v).trim();
  if (/^\d{4}-\d{2}$/.test(s)) s += '-01';
  s = s.slice(0, 10);
  if (!ISO.test(s)) return null;
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  // refuse les dates « débordées » (2026-02-30 → 2026-03-02) : on ne réécrit jamais une saisie
  const r = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return r === s ? s : null;
}

const _montant = (v) => {
  const n = Number(String(v == null ? '' : v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? _r2(n) : 0;
};

/**
 * Normalise une antériorité saisie dans l'écran « Situation du locataire ». Rend l'objet à stocker
 * dans `bail.anteriorite`, ou null si la date est absente/invalide (rien n'est enregistré à moitié).
 * La situation fixe ce qui est gardé : « à jour » ne garde aucun montant, « avance » ne garde que
 * l'avance, « arriéré » garde loyer + charges (+ les mois, s'ils sont connus).
 * @param {{date, situation, loyer, charges, avance, mois, note}} saisie
 * @param {{maintenant?:string}} [opts]
 */
export function normaliserAnteriorite(saisie, opts) {
  const s = saisie || {};
  const date = normaliserDate(s.date);
  if (!date) return null;
  const situation = ['a-jour', 'arriere', 'avance'].includes(s.situation) ? s.situation : 'a-jour';
  const mois = Array.isArray(s.mois)
    ? [...new Set(s.mois.map((m) => String(m || '').slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)))].sort()
    : [];
  return {
    date, situation,
    loyer: situation === 'arriere' ? _montant(s.loyer) : 0,
    charges: situation === 'arriere' ? _montant(s.charges) : 0,
    avance: situation === 'avance' ? _montant(s.avance) : 0,
    mois: situation === 'arriere' ? mois : [],
    note: String(s.note || '').slice(0, 500),
    saisiLe: (opts && opts.maintenant) || new Date().toISOString()
  };
}

/**
 * Le point de départ des loyers suivis d'un LOT, et le solde d'ouverture à y poser.
 * @param {Object} i
 * @param {string|null} [i.dateAcqLot]  `logement.detenuDepuis` (exception par logement)
 * @param {string|null} [i.dateAcqImm]  `immeuble.dateAcquisition`
 * @param {Array<{debut, finEffective?, fin?, archive?, anteriorite?, _deleted?}>} i.bails baux du lot
 * @param {string|null} [i.provisoireIso] date provisoire (b) : 1ᵉʳ loyer encaissé (ancienne règle)
 * @returns {{date:string|null, source:'acquisition'|'anteriorite'|'provisoire'|null, jouissance:string|null,
 *            aConfirmer:boolean, ouverture:null|{date:string, bailDebut:string, loyer:number, charge:number, avance:number},
 *            bailsAvant:string[]}}
 *   `bailsAvant` = entrées des baux en cours au point de départ et commencés avant lui : ceux dont la
 *   situation est à noter (fil rouge, fiche immeuble).
 */
export function debutSuiviLot(i) {
  const o = i || {};
  const jouissance = normaliserDate(o.dateAcqLot) || normaliserDate(o.dateAcqImm);
  const bails = (o.bails || []).filter((b) => _vivant(b) && normaliserDate(b.debut));
  // L'antériorité la plus récente fait foi pour le lot (le passé d'avant est résumé par son solde).
  let ant = null;
  for (const b of bails) {
    const a = b.anteriorite && normaliserDate(b.anteriorite.date);
    if (!a) continue;
    if (!ant || a > ant.date) ant = { date: a, bailDebut: normaliserDate(b.debut), a: b.anteriorite };
  }
  // Une antériorité datée AVANT l'achat ne vaut pas : le bailleur actuel ne suivait rien à cette date.
  if (ant && jouissance && ant.date < jouissance) ant = null;

  let date = null, source = null;
  if (jouissance || ant) {
    if (ant && (!jouissance || ant.date >= jouissance)) { date = ant.date; source = 'anteriorite'; }
    else { date = jouissance; source = 'acquisition'; }
  } else {
    date = normaliserDate(o.provisoireIso);
    source = date ? 'provisoire' : null;
  }
  // LA fin d'occupation (fin-occupation.js) : bail archivé → sa fin ; bail courant → clôture ou départ déclaré.
  const finDe = (b) => normaliserDate(finOccupationBail(b, !!b.archive)) || null;
  const bailsAvant = date
    ? bails.filter((b) => normaliserDate(b.debut) < date && (!finDe(b) || finDe(b) >= date)).map((b) => normaliserDate(b.debut)).sort()
    : [];
  let ouverture = null;
  if (ant && source === 'anteriorite') {
    const a = ant.a;
    const loyer = a.situation === 'arriere' ? _montant(a.loyer) : 0;
    const charge = a.situation === 'arriere' ? _montant(a.charges) : 0;
    const avance = a.situation === 'avance' ? _montant(a.avance) : 0;
    if (loyer || charge || avance) ouverture = { date: ant.date, bailDebut: ant.bailDebut, loyer, charge, avance };
  }
  return {
    date, source, jouissance, ouverture, bailsAvant,
    // (b) : à confirmer seulement si la date provisoire TRONQUE vraiment un bail (sinon rien à dire)
    aConfirmer: source === 'provisoire' && bailsAvant.length > 0
  };
}
