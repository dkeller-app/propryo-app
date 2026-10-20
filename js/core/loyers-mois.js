/**
 * core/loyers-mois.js — CDC-QUITTANCES-IRL étape 1 : LE SOCLE DU VERDICT.
 *
 * Répond à UNE question, pour un couple (lot, mois) : « ce mois est-il soldé ? ».
 *
 * D7 — l'imputation n'est PAS réinventée, elle est CONSOMMÉE. Le rattachement d'un
 * paiement à un mois est déjà tranché (décisions 09/07 et 14/07) et codé dans
 * `_loyerArrearsPass` / `_computeLoyerNetting` (loyer-du-mois.js) : cascade
 * loyer courant → charges courant → arriérés loyer FIFO → arriérés charges FIFO,
 * plus le netting avance↔retard. Ce module ne fait que LIRE `retardMois` :
 *
 *     mois quittançable  ⇔  retardMois[idx].loyer === 0 && retardMois[idx].charge === 0
 *
 * Ce seul prédicat donne gratuitement le rattrapage (3 mois soldés d'un coup), le
 * paiement en plusieurs fois et l'avance. Aucun nouveau moteur : `_matcheMois()`
 * (le 7ᵉ, qui rattachait un paiement au mois calendaire de sa date — C3) est
 * SUPPRIMÉ, pas corrigé.
 *
 * Pur / testable : aucune lecture de DB, aucun DOM. Le contexte est injecté par
 * l'appelant (index.html assemble `months` depuis `_duMoisLot` + les mouvements).
 *
 * Invariants couverts : I4 (une quittance n'existe que sur un mois soldé),
 * I6 (une seule source d'imputation), I7 (une quittance = un mois).
 * Tests : __tests__/helpers/loyers-mois.test.js
 */

import { _loyerArrearsPass } from './loyer-du-mois.js';

const _r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
/** Seuil « au centime » (D6). Aligné sur le 0.005 de _loyerArrearsPass. */
export const EPS_CENTIME = 0.005;

export const MOIS_FR_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const _deaccent = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Libellé de mois FR (« août 2026 ») ou ISO (« 2026-08 ») → 'YYYY-MM'.
 * LE convertisseur unique : les quittances stockent `mois` en toutes lettres,
 * tout le reste de l'app raisonne en 'YYYY-MM'. (Remplace les 3 copies privées
 * _moisToDate / _qaMoisToDate.)
 * @returns {string|null}
 */
export function moisFrToYm(mois) {
  if (!mois) return null;
  const s = _deaccent(mois).trim();
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) {
    const m = parseInt(iso[2], 10);
    return (m >= 1 && m <= 12) ? `${iso[1]}-${iso[2]}` : null;
  }
  const an = s.match(/(\d{4})/);
  if (!an) return null;
  for (let i = 0; i < MOIS_FR_LONG.length; i++) {
    if (s.includes(_deaccent(MOIS_FR_LONG[i]))) {
      return `${an[1]}-${String(i + 1).padStart(2, '0')}`;
    }
  }
  return null;
}

/** 'YYYY-MM' → « août 2026 » (le format stocké dans DB.quittances.mois). */
export function ymToMoisFr(ym) {
  if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) return '';
  const m = parseInt(String(ym).slice(5, 7), 10);
  if (m < 1 || m > 12) return '';
  return `${MOIS_FR_LONG[m - 1]} ${String(ym).slice(0, 4)}`;
}

/** Liste des 'YYYY-MM' de startYm à endYm inclus (bornée à 600 mois). */
export function ymRange(startYm, endYm) {
  const out = [];
  if (!/^\d{4}-\d{2}$/.test(String(startYm || '')) || !/^\d{4}-\d{2}$/.test(String(endYm || ''))) return out;
  let y = parseInt(String(startYm).slice(0, 4), 10), m = parseInt(String(startYm).slice(5, 7), 10);
  const ey = parseInt(String(endYm).slice(0, 4), 10), em = parseInt(String(endYm).slice(5, 7), 10);
  while ((y < ey) || (y === ey && m <= em)) {
    out.push(y + '-' + String(m).padStart(2, '0'));
    m++; if (m > 12) { m = 1; y++; }
    if (out.length > 600) break;
  }
  return out;
}

/**
 * LE verdict par mois d'un lot — délègue l'imputation à `_loyerArrearsPass`
 * (carry:true = netting avance↔retard, la politique cible des 5 surfaces).
 *
 * LOT 0 « socle des dates » : si l'appelant fournit `sources` (les mouvements encaissés
 * qui composent `received`), chaque mois porte en retour ses `paiements` — les versements
 * RÉELLEMENT imputés à CE mois par la cascade — et `datePaiement`, la date à laquelle il a
 * été soldé. I-DATE : sans rattachement daté, `datePaiement` vaut `null` et les surfaces
 * n'affichent RIEN. Aucune date n'est inventée, aucun repli sur « aujourd'hui ».
 *
 * @param {Array<{ym:string, hcDue:number, chDue:number, received:number,
 *                sources?:Array<{date:string, id?:string, montant:number}>}>} months
 *        chronologiques, ÉCHUS (l'appelant borne au mois courant).
 * @param {{graceLast?:boolean, opening?:Object}} [opts] graceLast : neutralise le manque NEUF du
 *        dernier mois (tolérance début de mois, `_loyerToleranceActive`). NE JAMAIS
 *        l'activer pour la quittançabilité (D6 : « au centime »).
 *        opening (R0-C, 2ᵉ audit 🟠3) : le solde d'ouverture du suivi et la réserve du mois qui le
 *        précède, EXACTEMENT ceux du maître Finances (`_loyerArrearsPass`, `opts.opening`).
 * @returns {{list:Array, byYm:Object, resteLoyer:number, resteCharge:number,
 *            reste:number, avance:number, nbMoisNonSoldes:number,
 *            premierMoisNonSolde:string|null}}
 */
export function etatMoisLot(months, opts) {
  const ms = (months || []).filter((m) => m && /^\d{4}-\d{2}$/.test(String(m.ym)));
  const pass = _loyerArrearsPass(
    ms.map((m) => ({ hcDue: m.hcDue, chDue: m.chDue, received: m.received, sources: m.sources })),
    { carry: true, graceLast: !!(opts && opts.graceLast), opening: (opts && opts.opening) || null }
  );
  // R0-C (2ᵉ audit 🟠3) — l'OUVERTURE (arriéré noté au début du suivi) n'est la dette d'aucun mois :
  // elle est retirée du mois où la cascade la pose et rendue à part (`ouverture`), datée. Sinon le
  // 1ᵉʳ mois suivi paraîtrait impayé (pas de quittance) et la relance l'appellerait « loyer de juin ».
  const ouvR = (opts && opts.opening && pass.ouvertureReste) ? pass.ouvertureReste : null;
  const list = ms.map((m, i) => {
    const hcDue = Math.max(0, Number(m.hcDue) || 0);
    const chDue = Math.max(0, Number(m.chDue) || 0);
    const du = _r2(hcDue + chDue);
    const r = pass.retardMois[i] || { loyer: 0, charge: 0 };
    const surOuv = !!ouvR && i === ouvR.idx;
    const resteLoyer = _r2(Math.max(0, r.loyer - (surOuv ? ouvR.loyer : 0)));
    const resteCharge = _r2(Math.max(0, r.charge - (surOuv ? ouvR.charge : 0)));
    const reste = _r2(resteLoyer + resteCharge);
    const vacance = du <= EPS_CENTIME;
    const solde = !vacance && reste <= EPS_CENTIME;
    // I-DATE — les versements RÉELLEMENT imputés à ce mois par la cascade, datés.
    // Un versement sans date connue (`date:null`) n'entre pas dans `paiements` : il ne
    // peut rien prouver. `datePaiement` n'existe que si le mois est soldé ET que tout
    // ce qui l'a soldé est daté — sinon `null`, et l'écran n'affiche rien.
    const brut = (pass.imputations && pass.imputations[i]) || [];
    const paiements = brut.filter((p) => p.date).map((p) => ({ date: p.date, id: p.id, montant: p.montant, poste: p.poste }));
    const totalImpute = _r2(brut.reduce((s, p) => s + p.montant, 0));
    const totalDate = _r2(paiements.reduce((s, p) => s + p.montant, 0));
    const complet = totalImpute - totalDate <= EPS_CENTIME;
    const datesVersements = [...new Set(paiements.map((p) => p.date))].sort();
    return {
      ym: String(m.ym),
      hcDue: _r2(hcDue), chDue: _r2(chDue), du,
      received: _r2(m.received),
      resteLoyer, resteCharge, reste,
      // D6 : soldé = plus AUCUN résidu, au centime. Un mois sans dû (vacance) n'est
      // pas « soldé » : il n'y a rien à quittancer.
      solde,
      partiel: !vacance && reste > EPS_CENTIME && reste < du - EPS_CENTIME,
      vacance,
      paiements,
      montantImpute: totalImpute,
      datesVersements,
      nbVersements: datesVersements.length,
      datePaiement: (solde && complet && datesVersements.length) ? datesVersements[datesVersements.length - 1] : null
    };
  });
  const byYm = {};
  list.forEach((e) => { byYm[e.ym] = e; });
  const nonSoldes = list.filter((e) => !e.vacance && e.reste > EPS_CENTIME);
  return {
    list, byYm,
    resteLoyer: _r2(pass.loyerArrear),
    resteCharge: _r2(pass.chargeArrear),
    reste: _r2(pass.loyerArrear + pass.chargeArrear),
    avance: _r2(pass.avance || 0),
    // R0-C : ce qui reste dû de l'arriéré NOTÉ au début du suivi (compris dans resteLoyer/resteCharge).
    ouverture: ouvR && (ouvR.loyer + ouvR.charge) > EPS_CENTIME
      ? { date: (opts.opening.date || null), ym: ms[ouvR.idx] ? String(ms[ouvR.idx].ym) : null, loyer: _r2(ouvR.loyer), charge: _r2(ouvR.charge),
          paiements: (pass.imputationsOuverture || []).filter((p) => p.date) }
      : null,
    nbMoisNonSoldes: nonSoldes.length,
    premierMoisNonSolde: nonSoldes.length ? nonSoldes[0].ym : null
  };
}

/**
 * FINANCES-SUIVI-V2 — LE VERDICT PAR MOIS, LU DANS LE MOTEUR UNIQUE. L'onglet Loyers, la relance, les
 * quittances, la fiche du logement et la restitution ne refont plus aucune imputation : ils lisent le suivi
 * du lot (`_computeSuiviLot`, bail par bail) mis à la forme historique de `etatMoisLot` (mêmes champs, mêmes
 * lecteurs : `peutQuittancer`, `moisProposables`, `retardLot`, `lignesRelance`, `datePaiementMois`).
 *
 * Un mois partagé par deux baux (rotation en cours de mois) additionne la part de chacun.
 * Un manque accepté ou un écart d'arrondi abandonné qui solde un mois y est rendu (`remise`, `remiseMotifs`) :
 * la quittance est émise pour le montant reçu, avec la mention de la remise (décision Didier Q1, 06/10).
 *
 * @param {{baux:Array}|null} suivi sortie de `_computeSuiviLot`
 * @param {{debuts?:string[]|null, manques?:Array<{bailDebut:string, ym:string, motif?:string}>}} [opts]
 *        `debuts` : ne garder que ces baux (début 'YYYY-MM-DD') ; absent = tous
 * @returns même forme que `etatMoisLot` (+ `bauxDebuts`, et `bailDebut`/`remise` par mois)
 */
export function etatDepuisSuivi(suivi, opts) {
  const o = opts || {};
  const garder = (b) => !Array.isArray(o.debuts) || o.debuts.includes(b.debut);
  const motifsDe = (debut, ym) => (Array.isArray(o.manques) ? o.manques : [])
    // un geste d'un mois donné peut solder la dette d'un mois ANTÉRIEUR (ordre H-1) : les motifs des gestes de ce mois ou après
    .filter((m) => m && !m._deleted && String(m.bailDebut || '').slice(0, 10) === debut && String(m.ym) >= ym && m.motif)
    .map((m) => String(m.motif));
  const parYm = {};
  let ouverture = null;
  let avance = 0;
  const debuts = [];
  for (const b of ((suivi && suivi.baux) || [])) {
    if (!b || b.suiviAbsent || !garder(b) || !Array.isArray(b.mois)) continue;
    debuts.push(b.debut);
    if (!b.finDu || (b.to && String(b.finDu).slice(0, 7) > b.to)) avance += Number(b.avanceBrute) || 0;   // bail en cours (départ futur compris)
    const ouv = b.ouverture || null;
    // Q3 — encaissements reçus pendant une vacance, rattachés « à confirmer » au bail le plus proche : un mois qu'ils
    // soldent est marqué (QUITTANCE-ESPACE-LOCATAIRE : jamais de quittance automatique sur un rattachement non confirmé).
    const aConf = new Set(((b.aConfirmer) || []).map((x) => String(x.id) + '|' + String(x.date)));
    for (const m of b.mois) {
      const e = parYm[m.ym] || (parYm[m.ym] = { ym: m.ym, hcDue: 0, chDue: 0, received: 0, resteLoyer: 0, resteCharge: 0,
        brut: [], remise: 0, remiseMotifs: [], aLaRegul: 0, bailDebut: b.debut, aConfirmer: false });
      if (aConf.size && (m.imputations || []).some((p) => aConf.has(String(p.id) + '|' + String(p.date)))) e.aConfirmer = true;
      e.hcDue += m.duHC; e.chDue += m.duCH; e.received += m.encaisse;
      const surOuv = !!ouv && ouv.ym === m.ym;
      e.resteLoyer += Math.max(0, m.loyerRetard - (surOuv ? ouv.loyer : 0));
      e.resteCharge += Math.max(0, m.chargeRetard - (surOuv ? ouv.charge : 0));
      e.aLaRegul += Number(m.aLaRegul) || 0;   // provisions passées à la régularisation (bail sorti, solde de tout compte)
      (m.imputations || []).forEach((p) => e.brut.push(p));
      if (m.remise > EPS_CENTIME) { e.remise += m.remise; motifsDe(b.debut, m.ym).forEach((x) => e.remiseMotifs.push(x)); }
      if (m.arrondi < -EPS_CENTIME) { e.remise += -m.arrondi; e.remiseMotifs.push('écart d’arrondi'); }
    }
    if (ouv && (ouv.loyer + ouv.charge) > EPS_CENTIME) {
      ouverture = ouverture
        ? { date: ouverture.date, ym: ouverture.ym, loyer: _r2(ouverture.loyer + ouv.loyer), charge: _r2(ouverture.charge + ouv.charge), paiements: ouverture.paiements.concat(ouv.paiements || []) }
        : { date: ouv.date || null, ym: ouv.ym, loyer: _r2(ouv.loyer), charge: _r2(ouv.charge), paiements: (ouv.paiements || []).slice() };
    }
  }
  const list = Object.keys(parYm).sort().map((ym) => {
    const e = parYm[ym];
    const du = _r2(e.hcDue + e.chDue);
    const resteLoyer = _r2(e.resteLoyer), resteCharge = _r2(e.resteCharge);
    const reste = _r2(resteLoyer + resteCharge);
    const vacance = du <= EPS_CENTIME;
    // Charges passées à la régularisation (17/10) : plus un retard (ni relance, ni arriéré), mais le mois n'est pas
    // PAYÉ — jamais « soldé » ni quittancé pour une somme qui n'a pas été reçue (art. 21).
    const aLaRegul = _r2(e.aLaRegul);
    const solde = !vacance && reste <= EPS_CENTIME && aLaRegul <= EPS_CENTIME;
    const paiements = e.brut.filter((p) => p.date).map((p) => ({ date: p.date, id: p.id, montant: p.montant, poste: p.poste }));
    const totalImpute = _r2(e.brut.reduce((s, p) => s + p.montant, 0));
    const totalDate = _r2(paiements.reduce((s, p) => s + p.montant, 0));
    const complet = totalImpute - totalDate <= EPS_CENTIME;
    const datesVersements = [...new Set(paiements.map((p) => p.date))].sort();
    return {
      ym, hcDue: _r2(e.hcDue), chDue: _r2(e.chDue), du, received: _r2(e.received),
      resteLoyer, resteCharge, reste, solde,
      partiel: !vacance && (reste + aLaRegul) > EPS_CENTIME && (reste + aLaRegul) < du - EPS_CENTIME,
      vacance, paiements, montantImpute: totalImpute, datesVersements, nbVersements: datesVersements.length,
      datePaiement: (solde && complet && datesVersements.length) ? datesVersements[datesVersements.length - 1] : null,
      remise: _r2(e.remise), remiseMotifs: [...new Set(e.remiseMotifs)], aLaRegul, bailDebut: e.bailDebut, aConfirmer: !!e.aConfirmer
    };
  });
  const byYm = {};
  list.forEach((e) => { byYm[e.ym] = e; });
  const nonSoldes = list.filter((e) => !e.vacance && e.reste > EPS_CENTIME);
  const oL = ouverture ? ouverture.loyer : 0, oC = ouverture ? ouverture.charge : 0;
  const resteLoyer = _r2(list.reduce((s, e) => s + e.resteLoyer, 0) + oL);
  const resteCharge = _r2(list.reduce((s, e) => s + e.resteCharge, 0) + oC);
  return {
    list, byYm, resteLoyer, resteCharge, reste: _r2(resteLoyer + resteCharge), avance: _r2(avance), ouverture,
    nbMoisNonSoldes: nonSoldes.length, premierMoisNonSolde: nonSoldes.length ? nonSoldes[0].ym : null,
    bauxDebuts: debuts
  };
}

/**
 * I-DATE (V5, CDC-LOYERS-DESIGN) — LA porte unique de la « date de paiement » d'un mois.
 * Aucune surface ne recompose cette date : elle la demande ici, et si la réponse est
 * `null` elle n'affiche RIEN (jamais la date d'émission, jamais `aujourd'hui`).
 * @param {{byYm:Object}} etat sortie de etatMoisLot
 * @param {string} ym
 * @returns {{date:string|null, dates:string[], nb:number, solde:boolean, montant:number}}
 */
export function datePaiementMois(etat, ym) {
  const e = etat && etat.byYm && etat.byYm[String(ym)];
  if (!e) return { date: null, dates: [], nb: 0, solde: false, montant: 0 };
  return {
    date: e.datePaiement || null,
    dates: e.datesVersements || [],
    nb: e.nbVersements || 0,
    solde: !!e.solde,
    montant: e.montantImpute || 0
  };
}

/**
 * I-DATE, surfaces 1 et 2 du §4 — LA mention « reçu le … » des documents.
 *
 * L'article 21 de la loi du 6 juillet 1989 fait de la quittance un REÇU : la date qu'elle
 * porte engage le bailleur. Elle doit donc être celle du paiement qui a soldé CE mois —
 * jamais le dernier encaissement du lot, jamais la date d'émission, jamais « aujourd'hui ».
 * Sans rattachement daté, la phrase se dit SANS date : « déclare avoir reçu du locataire ».
 *
 * ⚠️ DEUX documents, DEUX règles (audit 19/08, défaut C3) :
 *   · une QUITTANCE atteste que le terme est payé EN ENTIER. Elle ne peut porter une date
 *     que si le mois est réellement soldé (`info.date`). Sur un mois partiellement payé, la
 *     liste des versements ne prouve rien : le document sortirait « reçu le 14/06 la somme
 *     de 800 € » alors que 300 € seulement sont arrivés — et le bandeau V7 affiché juste
 *     au-dessus promet l'inverse. Sans solde : AUCUNE date.
 *   · un REÇU DE PAIEMENT PARTIEL parle des versements réellement encaissés : là, c'est la
 *     LISTE qui fait foi, puisque le montant du document est celui de ces versements.
 *
 * @param {{date:string|null, dates:string[], nb:number}} info sortie de datePaiementMois
 * @param {(iso:string)=>string} [fmtDate] formateur JJ/MM/AAAA (identité par défaut)
 * @param {{partiel?:boolean}} [opts] `partiel` : le document n'atteste qu'un versement partiel
 * @returns {{avecDate:boolean, mention:string, dateAffichee:string|null}}
 *          `mention` s'insère après « déclare avoir reçu » : « le 14/06/2026 », ou
 *          « en 2 versements, le dernier le 19/01/2026 », ou '' (rien).
 */
export function mentionDateRecu(info, fmtDate, opts) {
  const f = (typeof fmtDate === 'function') ? fmtDate : ((x) => String(x));
  const i = info || {};
  const partiel = !!(opts && opts.partiel);
  const dates = Array.isArray(i.dates) ? i.dates : [];
  // Le repli sur la liste n'est ouvert QUE si le document est un reçu partiel, ou si le mois
  // est réellement soldé (auquel cas la liste EST la décomposition de ce solde).
  const utilisables = (partiel || i.date) ? dates : [];
  if (utilisables.length > 1) {
    const dernier = f(utilisables[utilisables.length - 1]);
    return { avecDate: true, mention: ` en ${utilisables.length} versements, le dernier le ${dernier}`, dateAffichee: dernier };
  }
  if (utilisables.length === 1) return { avecDate: true, mention: ` le ${f(utilisables[0])}`, dateAffichee: f(utilisables[0]) };
  if (i.date) return { avecDate: true, mention: ` le ${f(i.date)}`, dateAffichee: f(i.date) };
  return { avecDate: false, mention: '', dateAffichee: null };
}

/**
 * I4 — LE garde-fou d'émission. Aucune quittance ne peut naître d'un mois non soldé.
 * @param {{byYm:Object}} etat sortie de etatMoisLot
 * @param {string} ym
 * @returns {{ok:boolean, motif:string, reste:number}}
 */
export function peutQuittancer(etat, ym) {
  const e = etat && etat.byYm && etat.byYm[String(ym)];
  if (!e) return { ok: false, motif: 'mois hors période de suivi', reste: 0 };
  if (e.vacance) return { ok: false, motif: 'aucun loyer dû ce mois', reste: 0 };
  if (e.reste > EPS_CENTIME) return { ok: false, motif: `non soldé — reste ${e.reste.toFixed(2)} €`, reste: e.reste };
  // charges d'un bail sorti passées à la régularisation (17/10) : elles n'ont pas été REÇUES — pas de quittance (art. 21)
  if ((Number(e.aLaRegul) || 0) > EPS_CENTIME) return { ok: false, motif: 'provisions de charges non reçues — à la régularisation', reste: _r2(e.aLaRegul) };
  return { ok: true, motif: '', reste: 0 };
}

/**
 * D4/D8 — les mois proposables dans « Faire une quittance » : tous les mois du suivi,
 * chacun portant son verdict et, le cas échéant, son motif de blocage. Les mois non
 * soldés restent VISIBLES mais non sélectionnables (« reste 120,00 € »).
 * `quittancesYm` = Set/Array des 'YYYY-MM' déjà quittancés pour ce lot.
 * I7 : un mois = une entrée, jamais un intervalle.
 */
export function moisProposables(etat, quittancesYm) {
  const deja = new Set(
    (quittancesYm instanceof Set ? [...quittancesYm] : (quittancesYm || []))
      .map((x) => String(x))
  );
  return (etat && etat.list ? etat.list : [])
    .filter((e) => !e.vacance)
    .map((e) => {
      const g = peutQuittancer(etat, e.ym);
      return {
        ym: e.ym, mois: ymToMoisFr(e.ym), du: e.du, hc: e.hcDue, ch: e.chDue,
        solde: e.solde, reste: e.reste,
        dejaQuittance: deja.has(e.ym),
        selectable: g.ok,
        motif: g.ok ? (deja.has(e.ym) ? 'soldé · quittance déjà éditée' : 'soldé') : g.motif
      };
    });
}

/**
 * D3 — les mois soldés d'un lot qui n'ont pas encore leur quittance. C'est ce que
 * le bloc « Quittances demandées » propose (case `bail.quittanceDemandee` cochée).
 * Retourne les ym chronologiques ; N mois → N documents (I7, D8 « Éditer les 3 »).
 */
export function moisAQuittancer(etat, quittancesYm) {
  return moisProposables(etat, quittancesYm)
    .filter((m) => m.selectable && !m.dejaQuittance)
    .map((m) => m.ym);
}

/**
 * D9/D10 — la ligne « Impayés » d'un lot (V14 : ex « Pas à jour ») : UNE ligne quel que soit le nombre de mois,
 * loyer ET charges. `toleranceActive` (règle partagée `_loyerToleranceActive`, jour < 10)
 * neutralise le manque NEUF du mois courant sans masquer les arriérés antérieurs.
 * @returns {{enRetard:boolean, resteLoyer:number, resteCharge:number, reste:number,
 *            nbMois:number, depuisYm:string|null, loyerSeul:boolean, chargesSeules:boolean}}
 */
export function retardLot(etat, opts) {
  const tol = !!(opts && opts.toleranceActive);
  const list = (etat && etat.list) ? etat.list : [];
  const dernierYm = list.length ? list[list.length - 1].ym : null;
  const retenus = list.filter((e) => !e.vacance && e.reste > EPS_CENTIME
    && !(tol && e.ym === dernierYm));
  // R0-C : l'arriéré noté au début du suivi compte toujours (il n'est jamais « neuf »).
  const ouv = (etat && etat.ouverture) || null;
  const oL = ouv ? ouv.loyer : 0, oC = ouv ? ouv.charge : 0;
  const resteLoyer = _r2(retenus.reduce((s, e) => s + e.resteLoyer, 0) + oL);
  const resteCharge = _r2(retenus.reduce((s, e) => s + e.resteCharge, 0) + oC);
  return {
    enRetard: retenus.length > 0 || (oL + oC) > EPS_CENTIME,
    resteLoyer, resteCharge, reste: _r2(resteLoyer + resteCharge),
    nbMois: retenus.length,
    depuisYm: (oL + oC) > EPS_CENTIME && ouv.ym ? ouv.ym : (retenus.length ? retenus[0].ym : null),
    loyerSeul: resteLoyer > EPS_CENTIME && resteCharge <= EPS_CENTIME,
    chargesSeules: resteCharge > EPS_CENTIME && resteLoyer <= EPS_CENTIME
  };
}

/**
 * D11 — le tableau du COURRIER DE RELANCE unique : ce qui manque, ligne par ligne,
 * d'après la cascade. Que le manque porte sur le loyer, les charges ou les deux,
 * c'est le même document — seul ce tableau change. Pas de second « rappel de charges ».
 * @returns {Array<{ym:string, mois:string, libelle:string, montant:number}>}
 */
export function lignesRelance(etat, opts) {
  const tol = !!(opts && opts.toleranceActive);
  const list = (etat && etat.list) ? etat.list : [];
  const dernierYm = list.length ? list[list.length - 1].ym : null;
  const out = [];
  // R0-C : l'arriéré noté au début du suivi, en tête, sous son vrai nom (jamais « loyer de <mois> »).
  const ouv = etat && etat.ouverture;
  if (ouv) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ouv.date || ''));
    const au = m ? ' au ' + m[3] + '/' + m[2] + '/' + m[1] : '';
    if (ouv.loyer > EPS_CENTIME) out.push({ ym: ouv.ym, mois: ymToMoisFr(ouv.ym), libelle: 'Arriéré de loyer' + au + ' (situation notée)', montant: ouv.loyer, ouverture: true });
    if (ouv.charge > EPS_CENTIME) out.push({ ym: ouv.ym, mois: ymToMoisFr(ouv.ym), libelle: 'Arriéré de charges' + au + ' (situation notée)', montant: ouv.charge, ouverture: true });
  }
  for (const e of list) {
    if (e.vacance) continue;
    if (tol && e.ym === dernierYm) continue;
    if (e.resteLoyer > EPS_CENTIME) out.push({ ym: e.ym, mois: ymToMoisFr(e.ym), libelle: `Loyer hors charges — ${ymToMoisFr(e.ym)}`, montant: e.resteLoyer });
    if (e.resteCharge > EPS_CENTIME) out.push({ ym: e.ym, mois: ymToMoisFr(e.ym), libelle: `Provisions sur charges — ${ymToMoisFr(e.ym)}`, montant: e.resteCharge });
  }
  return out;
}

/**
 * Niveau d'escalade du courrier (D11) : le TON durcit avec l'ancienneté du plus vieux
 * manque, mais c'est toujours le même bouton et le même gabarit. Réutilise les modèles
 * existants rappel-impaye-1/2/3 (rappel → relance → mise en demeure).
 * @param {string|null} depuisYm mois du plus ancien manque
 * @param {string} todayISO
 */
export function niveauRelance(depuisYm, todayISO) {
  if (!depuisYm) return null;
  const today = String(todayISO || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(today)) return 'rappel-impaye-1';
  const mois = (parseInt(today.slice(0, 4), 10) - parseInt(depuisYm.slice(0, 4), 10)) * 12
    + (parseInt(today.slice(5, 7), 10) - parseInt(depuisYm.slice(5, 7), 10));
  if (mois >= 3) return 'rappel-impaye-3';
  if (mois >= 2) return 'rappel-impaye-2';
  return 'rappel-impaye-1';
}
