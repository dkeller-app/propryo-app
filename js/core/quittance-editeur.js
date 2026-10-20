/**
 * core/quittance-editeur.js — L'ÉDITEUR DE QUITTANCE, direction « Le document » (V6).
 *
 * Principe directeur du CDC-LOYERS-DESIGN :
 *   « On ne retrouve pas une quittance. On permet à l'utilisateur d'éditer, comme pour l'EDL.
 *     On ne fait pas de liste infinie. Quand on a édité une quittance, l'app retient (pour le
 *     KPI de suivi) mais on ne garde pas le document en visuel. Si l'utilisateur veut une
 *     quittance passée, il la réédite. »
 *
 * Ce module ne dessine rien et ne lit aucune DB : il calcule ce que le RAIL du mois doit dire,
 * et le verdict de l'émission. Toute la matière vient de la cascade unique (`etatMoisLot`) —
 * aucun dû, aucun payé, aucune imputation n'est recalculé ici.
 *
 * Garde-fous NON BLOQUANTS (V7/V20/V21, arbitrage Didier 19/08 : « l'app doit prévenir mais pas
 * bloquer tout le temps l'utilisateur ») : un mois non soldé reste SÉLECTIONNABLE. Ce module
 * dit ce qu'il faut avertir ; il ne dit jamais « interdit ».
 *
 * Tests : __tests__/helpers/quittance-editeur.test.js
 */

import { EPS_CENTIME, ymToMoisFr } from './loyers-mois.js';

/** Les cinq états d'un mois dans le rail. */
export const MOIS_ETAT = Object.freeze({
  DONE: 'done',   // déjà quittancé — se rouvre pour rééditer
  OK: 'ok',       // soldé, pas encore quittancé
  NO: 'no',       // reste dû (V7 : quittançable quand même, avec avertissement)
  FUT: 'fut',     // mois futur non couvert (V8 : le critère est PAYÉ, pas ÉCHU)
  OFF: 'off'      // hors bail — rien à quittancer
});

const _r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const _an = (ym) => String(ym).slice(0, 4);

/**
 * Les années où ce lot a quelque chose à montrer (fenêtre de suivi + années déjà quittancées).
 * @param {{list:Array}} etat
 * @param {string[]} [quittancesYm]
 * @returns {string[]} années croissantes
 */
export function anneesDisponibles(etat, quittancesYm) {
  const s = new Set();
  for (const m of ((etat && etat.list) || [])) s.add(_an(m.ym));
  for (const ym of (quittancesYm || [])) if (/^\d{4}-\d{2}$/.test(String(ym))) s.add(_an(ym));
  return [...s].sort();
}

/**
 * LE RAIL — les douze mois d'une année, chacun avec son état, son dû et ce qu'il reste.
 * Un mois hors de la fenêtre de suivi existe quand même dans le rail, en `off` : l'utilisateur
 * voit que la question est posée pour les douze mois, pas seulement pour ceux qui l'arrangent.
 *
 * @param {{byYm:Object}} etat sortie de etatMoisLot
 * @param {string[]|Set} quittancesYm mois déjà quittancés de ce lot
 * @param {string|number} annee
 * @param {string} todayYm 'YYYY-MM' — borne du « futur »
 * @param {Object} [editeesLe] map ym → date d'édition ('YYYY-MM-DD'), pour l'état DONE
 * @returns {Array<{ym, mois, nom, etat, du, reste, editeeLe}>}
 */
export function moisRailLot(etat, quittancesYm, annee, todayYm, editeesLe) {
  const deja = new Set([...(quittancesYm instanceof Set ? quittancesYm : (quittancesYm || []))].map(String));
  const ed = editeesLe || {};
  const an = String(annee);
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${an}-${String(m).padStart(2, '0')}`;
    const e = (etat && etat.byYm) ? etat.byYm[ym] : null;
    const du = e ? _r2(e.du) : 0;
    const reste = e ? _r2(e.reste) : 0;
    let st;
    // Un mois À VENIR n'a pas encore d'entrée dans l'état (la fenêtre de suivi s'arrête au
    // mois courant) : il n'est pas « hors bail » pour autant. L'écran doit le dire tel qu'il
    // est — à venir — sinon les mois de fin d'année se lisent comme si le bail était fini.
    if (!e && todayYm && ym > String(todayYm)) st = MOIS_ETAT.FUT;
    else if (!e || e.vacance) st = MOIS_ETAT.OFF;
    else if (deja.has(ym)) st = MOIS_ETAT.DONE;
    else if (e.solde) st = MOIS_ETAT.OK;
    else if (todayYm && ym > String(todayYm)) st = MOIS_ETAT.FUT;
    else st = MOIS_ETAT.NO;
    out.push({
      ym, mois: ymToMoisFr(ym), nom: ymToMoisFr(ym).split(' ')[0],
      etat: st, du, reste,
      editeeLe: ed[ym] || null
    });
  }
  return out;
}

/**
 * V6 — le mois PRÉ-COCHÉ à l'ouverture : le plus ancien mois soldé non quittancé.
 * À défaut, le dernier mois qui a un dû (on ouvre sur quelque chose, jamais sur le vide).
 * @returns {string|null} 'YYYY-MM'
 */
export function moisParDefaut(rail) {
  const r = rail || [];
  const ok = r.find((m) => m.etat === MOIS_ETAT.OK);
  if (ok) return ok.ym;
  const utiles = r.filter((m) => m.etat !== MOIS_ETAT.OFF);
  return utiles.length ? utiles[utiles.length - 1].ym : null;
}

/**
 * L'ANNÉE ouverte par défaut : l'ANNÉE COURANTE dès qu'elle a quelque chose à montrer.
 * On n'ouvre pas sur 2021 parce qu'un vieux mois n'a jamais été quittancé — le geste de tous
 * les jours porte sur le mois en cours, et le rail des années est à un clic pour le reste.
 * À défaut (bail terminé, aucune donnée cette année), l'année utile la plus récente.
 * @param {{list:Array}} etat
 */
export function anneeParDefaut(etat, quittancesYm, todayYm) {
  const annees = anneesDisponibles(etat, quittancesYm);
  if (!annees.length) return todayYm ? _an(todayYm) : null;
  const courante = todayYm ? _an(todayYm) : null;
  const utile = (an) => moisRailLot(etat, quittancesYm, an, todayYm).some((m) => m.etat !== MOIS_ETAT.OFF);
  if (courante && annees.includes(courante) && utile(courante)) return courante;
  for (let i = annees.length - 1; i >= 0; i--) if (utile(annees[i])) return annees[i];
  return annees[annees.length - 1];
}

/**
 * LE VERDICT de l'émission — ce que le bas de l'éditeur doit dire, et ce que la fenêtre
 * doit avertir. **Rien n'est interdit** : `bloquant` n'existe pas dans ce retour.
 *
 * V7 — un mois non soldé s'émet, mais l'écran nomme les mois et le reste dû, propose le reçu
 * partiel en un clic, et exige une confirmation explicite à cocher. Fondement du garde-fou :
 * l'article 21 de la loi du 6 juillet 1989 fait de la quittance un REÇU ; remise à un locataire
 * qui n'a pas payé, elle vaut preuve de paiement CONTRE le bailleur.
 * V8 — aucun avertissement « mois non échu » : un mois futur couvert par une avance est `ok`,
 * un mois futur non couvert retombe simplement dans le garde-fou V7.
 *
 * @param {Array} rail
 * @param {string[]} selection ym cochés
 * @returns {{nbDocs, total, risques, reedits, confirmationRequise, resteTotal}}
 */
export function verdictEmission(rail, selection) {
  const sel = new Set((selection || []).map(String));
  const choisis = (rail || []).filter((m) => sel.has(m.ym) && m.etat !== MOIS_ETAT.OFF);
  const risques = choisis.filter((m) => m.etat === MOIS_ETAT.NO || m.etat === MOIS_ETAT.FUT);
  const reedits = choisis.filter((m) => m.etat === MOIS_ETAT.DONE);
  return {
    nbDocs: choisis.length,
    total: _r2(choisis.reduce((s, m) => s + m.du, 0)),
    resteTotal: _r2(risques.reduce((s, m) => s + m.reste, 0)),
    risques, reedits,
    // La seule chose que l'app EXIGE : une case cochée. Jamais un bouton grisé.
    confirmationRequise: risques.length > 0
  };
}

/**
 * V9 — l'étiquette « sans paiement constaté », DANS L'APP UNIQUEMENT.
 * Le document remis au locataire ne change pas : une mention de ce genre en ferait un
 * document bâtard, ni quittance ni reçu.
 * @param {{forceePar?:string, forceeLe?:string}} meta trace du geste forcé
 * @param {(iso:string)=>string} [fmtDate] formateur JJ/MM/AAAA (identité par défaut)
 * @returns {{visible:boolean, libelle:string, survol:string}}
 */
export function etiquetteSansPaiement(meta, fmtDate) {
  const m = meta || {};
  if (!m.forceeLe && !m.forceePar) return { visible: false, libelle: '', survol: '' };
  const f = (typeof fmtDate === 'function') ? fmtDate : ((x) => String(x));
  const qui = m.forceePar || 'un membre de l’espace';
  const quand = m.forceeLe ? f(m.forceeLe) : 'une date inconnue';
  return {
    visible: true,
    libelle: 'sans paiement constaté',
    // Utile au partage SCI : qui a pris la responsabilité, et quand.
    survol: `Émise sans paiement rattaché — confirmé par ${qui} le ${quand}`
  };
}

/**
 * LE CYCLE DE VIE DE LA TRACE V9 — elle suit le geste, dans les DEUX sens.
 *
 * Poser la trace sans jamais la retirer laissait l'étiquette « émise sans paiement rattaché »
 * collée à un mois depuis payé, pour toujours — et faisait sortir une quittance « forcée » là
 * où le paiement existe. Symétriquement, supprimer une quittance sans retirer sa trace faisait
 * dire au bandeau « ce mois n'est pas soldé » pendant que l'aperçu sortait une quittance pleine.
 * Une étiquette qui survit à son motif est un mensonge.
 *
 * @param {Object} meta map courante { 'REF|YYYY-MM': {forceePar, forceeLe} }
 * @param {{ref:string, moisEmis:string[], moisForces:string[], par:string, le:string}} geste
 * @returns {Object} la NOUVELLE map (l'entrée n'est pas mutée)
 */
export function metaApresEmission(meta, geste) {
  const out = Object.assign({}, meta || {});
  const g = geste || {};
  const forces = new Set((g.moisForces || []).map(String));
  for (const ym of (g.moisEmis || [])) {
    const k = cleMeta(g.ref, ym);
    if (forces.has(String(ym))) out[k] = { forceePar: g.par || '', forceeLe: g.le || '' };
    else delete out[k];                       // le mois n'est plus émis « sans paiement »
  }
  return out;
}

/** La trace meurt avec la quittance : même geste, même opération annulable. */
export function metaApresSuppression(meta, ref, ym) {
  const out = Object.assign({}, meta || {});
  delete out[cleMeta(ref, ym)];
  return out;
}

/** La clé de la trace d'un couple (lot, mois) dans le blob de configuration. */
export function cleMeta(ref, ym) { return String(ref) + '|' + String(ym); }

/**
 * V11 — la SAISIE LIBRE : l'app retient la saisie, pas le document. Rejouable, rééditable.
 * Elle est EXCLUE de tous les calculs : ni suivi des loyers, ni 2044 — elle ne prouve
 * aucun encaissement (I-LIBRE).
 * @param {Object} saisie champs du formulaire libre
 * @returns {{valide:boolean, manquants:string[], normalisee:Object}}
 */
export function validerSaisieLibre(saisie) {
  const s = saisie || {};
  const req = [
    ['bailleurNom', 'le nom du bailleur'],
    ['locataireNom', 'le nom du locataire'],
    ['adresse', 'l’adresse du logement'],
    ['debut', 'le début de la période'],
    ['fin', 'la fin de la période']
  ];
  const manquants = req.filter(([k]) => !String(s[k] || '').trim()).map(([, lbl]) => lbl);
  const hc = Number(s.hc) || 0, ch = Number(s.ch) || 0;
  if (hc + ch <= 0) manquants.push('un montant');
  return {
    valide: manquants.length === 0,
    manquants,
    normalisee: {
      libre: true,
      bailleurNom: String(s.bailleurNom || '').trim(),
      bailleurAdresse: String(s.bailleurAdresse || '').trim(),
      locataireNom: String(s.locataireNom || '').trim(),
      adresse: String(s.adresse || '').trim(),
      ville: String(s.ville || '').trim(),
      debut: String(s.debut || '').trim(),
      fin: String(s.fin || '').trim(),
      hc: _r2(hc), ch: _r2(ch), total: _r2(hc + ch),
      // Facultatif, et VIDE par défaut : sans date rattachée, la ligne « payé le » ne sort pas.
      datePaiement: String(s.datePaiement || '').trim() || null
    }
  };
}

export { EPS_CENTIME };
