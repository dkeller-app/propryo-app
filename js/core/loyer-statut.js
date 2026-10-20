import { _loyerArrearsPass } from './loyer-du-mois.js';

/**
 * core/loyer-statut.js — SUIVI-LOYERS-SOURCE-UNIQUE Phase A.
 *
 * LE moteur unique du statut de paiement d'un locataire (décision user 2026-07-08,
 * cf docs/subjects/SUIVI-LOYERS-SOURCE-UNIQUE.md + audit AUDIT-FINANCES-COHERENCE
 * constats 4-9 / 40-45 : 6 formules différentes répondaient à « ce locataire
 * est-il à jour ? », 5 surfaces sur 11 donnaient un verdict faux sur le scénario
 * « 2 mois payés en janvier, rien en février »).
 *
 * Algorithme (porté tel quel de _suiviLoyerStrip, H1 v15.408) : le total encaissé
 * de l'année est alloué CHRONOLOGIQUEMENT sur les mois dus (le plus ancien
 * d'abord) — un paiement n'est pas rattaché au mois calendaire de sa date, il
 * comble d'abord le plus vieux mois non couvert. Le report (trop-payé un mois,
 * régularisé un autre) est donc géré par construction.
 *
 * Pure / testable : aucune lecture de DB — les résolveurs sont injectés.
 *   - dueOfMonth(mi0) → € dû du mois (index 0-11) ; en prod :
 *     _getActiveBailHcChProrated (bail actif du mois + prorata entrée/sortie).
 *   - totalPaid = Σ des loyers encaissés de l'année pour le lot (cat 211, crédits).
 *
 * Statuts d'un mois : 'ok' (payé) · 'warn' (partiel) · 'imp' (impayé) pour les
 * mois échus ; 'avance' (futur pré-payé) · 'avenir' pour les mois futurs ;
 * 'vac' si aucun dû (pas de bail actif).
 *
 * @param {Object} input { year, today (ISO), monthlyFull, totalPaid, dueOfMonth }
 * @returns {{months: Array<{mi,cls,recu,attendu,due}>, solde, recu, attendu, curMo, monthlyFull}}
 */
export function _computeLoyerStatut(input) {
  const i = input || {};
  const y = parseInt(i.year, 10);
  const today = String(i.today || _loyerTodayLocal());
  const cy = parseInt(today.slice(0, 4), 10);
  const curMo = (y < cy) ? 12 : (y > cy ? 0 : parseInt(today.slice(5, 7), 10)); // dernier mois échu
  const monthlyFull = Number(i.monthlyFull) || 0;
  const totalPaid = Number(i.totalPaid) || 0;
  const dueOfMonth = (typeof i.dueOfMonth === 'function') ? i.dueOfMonth : (() => monthlyFull);
  const round2 = (n) => Math.round(n * 100) / 100;

  const months = [];
  let attenduEcoule = 0, pool = totalPaid;
  for (let mi = 1; mi <= 12; mi++) {
    const ecoule = mi <= curMo;
    // Dû du mois : proraté (résolveur injecté) pour les mois échus ; plein loyer en
    // référence pour le futur (permet de détecter l'avance).
    const due = ecoule ? (Number(dueOfMonth(mi - 1)) || 0) : monthlyFull;
    if (ecoule) attenduEcoule += due;
    let cls, recu = 0;
    if (due <= 0.5) { cls = 'vac'; }                       // pas de bail actif ce mois
    else {
      const filled = Math.min(pool, due); pool -= filled; recu = round2(filled);
      const r = filled / due;
      if (ecoule) cls = (r >= 0.99) ? 'ok' : (r > 0.01 ? 'warn' : 'imp');  // payé / partiel / retard
      else cls = (r >= 0.99) ? 'avance' : 'avenir';                        // futur pré-payé / à venir
    }
    months.push({ mi, cls, recu, attendu: ecoule ? round2(due) : 0, due: round2(due) });
  }
  const solde = round2(totalPaid - attenduEcoule);          // + = avance, − = retard
  return { months, solde, recu: round2(totalPaid), attendu: round2(attenduEcoule), curMo, monthlyFull, year: y };
}

/**
 * Solde AJUSTÉ par la règle de tolérance début de mois : tant qu'elle est active,
 * le dû du mois COURANT est neutralisé (pas encore exigible à l'affichage) — mais les
 * arriérés des mois précédents restent visibles (contrairement à l'ancien
 * _computeImpayes qui masquait TOUT avant le 10 — audit constat 45).
 */
export function _loyerSoldeAjuste(statut, todayISO) {
  const s = statut || {};
  const today = String(todayISO || _loyerTodayLocal());
  if (!_loyerToleranceActive(today)) return s.solde || 0;
  if (parseInt(today.slice(0, 4), 10) !== s.year || !s.curMo) return s.solde || 0;
  const cur = (s.months || [])[s.curMo - 1];
  return Math.round(((s.solde || 0) + ((cur && cur.attendu) || 0)) * 100) / 100;
}

/**
 * Date du jour en ISO LOCAL (pas toISOString/UTC : l'ancien code inline utilisait
 * getMonth() local — entre minuit et ~2 h un 1er du mois, l'UTC retarderait curMo
 * d'un mois, voire d'un an au 1er janvier. Audit Phase A, point mineur).
 */
export function _loyerTodayLocal(d) {
  const n = d instanceof Date ? d : new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

/**
 * Position cumulée signée d'un locataire, BORNÉE à une fenêtre [startYm, endYm]
 * (SUIVI-LOYERS-SOURCE-UNIQUE Phase D-matrice). cumul = total encaissé − Σ dû échu.
 * + = avance, − = retard. En prod, le wrapper pose `startYm = max(bail.debut, début du
 * suivi = 1er mouvement de la base)` → tue le « −63 050 € » fantôme (dette comptée sur des
 * années sans données) SANS masquer les arriérés réels post-suivi (≠ `_moisDebut`, constat 41).
 * `dueOfMonth(ym)` = dû du mois (bail de l'époque + prorata, ex. `_getActiveBailHcChProrated`).
 * @returns {{cumul:number, sumDue:number, months:number, tracked:boolean}}
 */
export function _computeLoyerCumul(input) {
  const i = input || {};
  const startYm = String(i.startYm || '');
  const endYm = String(i.endYm || _loyerTodayLocal().slice(0, 7));
  const dueOfMonth = (typeof i.dueOfMonth === 'function') ? i.dueOfMonth : (() => 0);
  const totalPaid = Number(i.totalPaid) || 0;
  if (!/^\d{4}-\d{2}$/.test(startYm)) return { cumul: 0, sumDue: 0, months: 0, tracked: false };
  const ey = parseInt(endYm.slice(0, 4), 10), em = parseInt(endYm.slice(5, 7), 10);
  let y = parseInt(startYm.slice(0, 4), 10), m = parseInt(startYm.slice(5, 7), 10);
  let sumDue = 0, months = 0;
  while ((y < ey) || (y === ey && m <= em)) {
    sumDue += Number(dueOfMonth(y + '-' + String(m).padStart(2, '0'))) || 0;
    months++;
    m++; if (m > 12) { m = 1; y++; }
    if (months > 600) break;                          // garde-fou (50 ans)
  }
  return { cumul: Math.round((totalPaid - sumDue) * 100) / 100, sumDue: Math.round(sumDue * 100) / 100, months, tracked: true };
}

/**
 * CASCADE d'imputation d'un montant encaissé sur un mois (décision user 2026-07-09) :
 * loyer d'abord (plafonné au HC dû), puis charges (plafonné au CH dû), l'excédent = LOYER
 * perçu d'avance (fiscalement du loyer, pas une provision). Remplace l'ancien split au RATIO.
 * Invariant : hc + provisions = paid (pour paid > 0). `avance` est la part de `hc` au-delà de hc+ch.
 * @returns {{hc:number, provisions:number, avance:number}}
 */
export function _loyerSplitCascade(paid, hc, ch) {
  const P = Number(paid) || 0;
  const L = Math.max(0, Number(hc) || 0);
  const C = Math.max(0, Number(ch) || 0);
  const r2 = n => Math.round(n * 100) / 100;
  if (P <= 0) return { hc: r2(P), provisions: 0, avance: 0 };   // remboursement/arriéré négatif → imputé au loyer
  const loyerCourant = Math.min(P, L);
  const avance = Math.max(0, P - L - C);
  const provisions = Math.min(Math.max(0, P - L), C);
  return { hc: r2(loyerCourant + avance), provisions: r2(provisions), avance: r2(avance) };
}

/**
 * Cascade d'imputation CUMULATIVE d'un lot sur l'année (décision user 2026-07-09 :
 * « effacer les dettes avant de faire de l'avance sur loyer »). Passage chronologique :
 * chaque mois comble d'abord SON loyer puis SES charges, puis le reliquat récupère les
 * ARRIÉRÉS (loyer d'abord, puis charges), et seul ce qui reste APRÈS les dettes = loyer
 * perçu d'avance. Attribué au mois qui reçoit (cohérence trésorerie), pas de pull-back.
 * `loyersHC` inclut l'avance (loyer imposable à l'encaissement). « sans bail » (dû 0 partout)
 * → tout en loyer, JAMAIS d'avance (un arriéré n'est pas une avance — audit).
 * @param {Array<{hcDue:number, chDue:number, received:number}>} months chronologiques (échus)
 * @returns {Array<{loyersHC:number, provisions:number, avance:number}>}
 */
export function _computeLoyerChargeAlloc(months) {
  const r2 = n => Math.round(n * 100) / 100;
  const ms = months || [];
  let loyerArrear = 0, chargeArrear = 0;
  return ms.map(m => {
    const hcDue = Math.max(0, Number(m.hcDue) || 0);
    const chDue = Math.max(0, Number(m.chDue) || 0);
    const recv = Number(m.received) || 0;
    // Le reliquat n'est une AVANCE que si le mois a un dû actif (bail en cours). Un paiement sur un
    // mois SANS dû (ancien locataire dont le bail n'est pas résolu, vacance) = loyer encaissé, PAS
    // une avance — sinon changement de locataire → paiements de l'ancien comptés « trop-perçu »
    // (bug user 2026-07-13). Garde-fou PAR MOIS, plus global au lot.
    const monthHasDue = (hcDue + chDue) > 0.005;
    let pool = Math.max(0, recv);
    const loyerCur = Math.min(pool, hcDue); pool -= loyerCur; loyerArrear += (hcDue - loyerCur);
    const chargeCur = Math.min(pool, chDue); pool -= chargeCur; chargeArrear += (chDue - chargeCur);
    const loyerRecov = Math.min(pool, loyerArrear); pool -= loyerRecov; loyerArrear -= loyerRecov;   // arriérés loyer (priorité)
    const chargeRecov = Math.min(pool, chargeArrear); pool -= chargeRecov; chargeArrear -= chargeRecov;
    const leftover = Math.max(0, pool);
    const negAdj = Math.min(0, recv);                       // remboursement net → réduit le loyer du mois
    return {
      loyersHC: r2(loyerCur + loyerRecov + leftover + negAdj),
      provisions: r2(chargeCur + chargeRecov),
      avance: r2(monthHasDue ? leftover : 0),
      // FINANCES étape 2 (sous-ligne « dont rattrapage d'un mois antérieur ») : la part du reçu
      // du mois qui a servi des ARRIÉRÉS de mois précédents — le P&L reste tenu à l'encaissement
      // (le mois qui reçoit porte le montant), la sous-ligne explique le dépassement du dû.
      rattrapage: r2(loyerRecov + chargeRecov)
    };
  });
}

/**
 * Arriérés d'un lot (loyer / charges) + CAUSE résiduelle (retard orange, décision user
 * 2026-07-12 : « on doit pouvoir cliquer dessus afin de connaître la cause »). Même passage
 * chronologique que _computeLoyerChargeAlloc (loyer courant → charges courant → récup arriérés
 * loyer FIFO → récup arriérés charges FIFO), mais on garde une FILE des manques incurrus par mois.
 * La récupération solde les plus VIEUX manques d'abord → à la fin, la file = les mois ENCORE dus,
 * dont la somme des `short` résiduels = l'arriéré affiché (invariant drill ↔ sous-ligne).
 * « sans bail » (dû 0 partout) → jamais d'arriéré (un impayé sans dû n'existe pas).
 * `graceLast` (tolérance début de mois, cf _loyerToleranceActive / constat 45) : le manque NOUVEAU
 * du DERNIER mois (= mois courant avant le 10) n'est pas compté en retard — mais son paiement
 * récupère quand même les arriérés antérieurs, et ces arriérés antérieurs restent visibles.
 * @param {Array<{hcDue:number, chDue:number, received:number}>} months chronologiques (échus)
 * @param {boolean} [graceLast] neutralise le manque neuf du dernier mois (mois courant sous tolérance)
 * @returns {{months:Array<{loyerArrear,chargeArrear}>, loyerArrear:number, chargeArrear:number,
 *            causeLoyer:Array<{idx,short,due,recv}>, causeCharge:Array<{idx,short,due,recv}>}}
 */
export function _computeLoyerArrears(months, graceLast) {
  // AUDIT-SUIVI-LOYERS étape 1 (2026-07-15) : l'algorithme vit désormais dans
  // loyer-du-mois.js (_loyerArrearsPass, moteur partagé). Ici : délégué SANS netting
  // (carry:false = comportement historique « pas de pull-back », décision 2026-07-13) —
  // les surfaces basculeront sur _computeLoyerNetting (carry:true) à l'étape 4.
  return _loyerArrearsPass(months, { carry: false, graceLast: !!graceLast });
}

/**
 * La pastille unique (mêmes seuils que la modale Suivi des loyers) :
 * ±20 € de bruit toléré ; nMois = équivalent en mois arrondi à 0,1.
 * @returns {{cls:'retard'|'avance'|'ajour', montant:number, nMois:number}}
 */
export function _loyerChipVerdict(solde, monthlyFull) {
  const s = Number(solde) || 0;
  const mf = Number(monthlyFull) || 0;
  const montant = Math.round(Math.abs(s) * 100) / 100;
  const nMois = mf > 0 ? Math.round(montant / mf * 10) / 10 : 0;
  if (s <= -20) return { cls: 'retard', montant, nMois };
  if (s >= 20) return { cls: 'avance', montant, nMois };
  return { cls: 'ajour', montant, nMois };
}

/**
 * LA règle de tolérance début de mois, partagée par toutes les surfaces
 * (réf. _computeImpayes jour < 10 — seule règle conservée ; fin du
 * « 0 impayé sur l'Accueil, 14 sur Finances » — audit constat 45).
 * Tant qu'elle est active, le loyer du mois COURANT pas encore encaissé
 * ne doit pas être présenté comme un retard.
 */
export const _LOYER_TOLERANCE_JOUR = 10;
export function _loyerToleranceActive(todayISO) {
  const d = parseInt(String(todayISO || '').slice(8, 10), 10);
  return Number.isFinite(d) ? d < _LOYER_TOLERANCE_JOUR : false;
}
