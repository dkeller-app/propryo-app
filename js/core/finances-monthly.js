import { _computeLoyerChargeAlloc, _LOYER_TOLERANCE_JOUR, _loyerTodayLocal } from './loyer-statut.js';
// FINANCES-SUIVI-V2 — UNE passe compensée (`_loyerArrearsPass`, carry) donne retard ET avance : une avance
// couvre les mois suivants avant de laisser naître un retard ; jamais « retard ET avance » sur un bail.
import { _loyerArrearsPass, duMoisSuivi, segmentsOccupation } from './loyer-du-mois.js';
// R0-C : la dette de restitution suit la MÊME fenêtre d'exigibilité que Finances (tolérance < 10).
import { computeExigibiliteWindow } from './finances-window.js';

/**
 * R0-C lot 1 — LE collecteur des encaissements de LOYER (ligne 2044 « 211 », alias M-1 compris
 * via `catLigne`), par lot et par mois, net des contre-passations (`cr − db`), pondéré par le
 * périmètre. UNE implémentation, lue par la pré-passe d'ouverture N-1 du maître ET par la dette
 * de restitution (`_computeDetteBail`) : la restitution ne peut plus compter un encaissement que
 * Finances ne compte pas (ex. le versement du dépôt de garantie, catégorie hors 2044).
 * @param {Array} mvts mouvements
 * @param {function} catLigne cat → {ligne2044} | null
 * @param {function} poids mv → 0..1 (0 = hors périmètre)
 * @param {function} garder (mv, ym) → bool (filtre de dates / de lot, appliqué AVANT tout calcul)
 * @returns {{parLot:Object<string,Object<string,number>>, premierYm:string|null,
 *            lignes:Array<{qui:string, date:string, ym:string, montant:number}>}}
 */
function _collecterLoyers211(mvts, catLigne, poids, garder) {
  const parLot = {};
  const lignes = [];
  let premierYm = null;
  (mvts || []).forEach(mv => {
    if (!mv || mv._deleted || !mv.date) return;
    const ym = mv.date.slice(0, 7);
    if (!garder(mv, ym)) return;
    const r0 = catLigne(mv.cat);
    if (!r0 || r0.ligne2044 !== '211') return;    // seuls les loyers (HC + provisions)
    const w0 = poids(mv); if (!w0) return;
    const q0 = mv.qui || ''; if (!q0) return;
    const amt0 = ((Number(mv.cr) || 0) - (Number(mv.db) || 0)) * w0;
    (parLot[q0] = parLot[q0] || {})[ym] = (parLot[q0][ym] || 0) + amt0;
    // FINANCES-SUIVI-V2 : l'identifiant du mouvement (lien cliquable des fenêtres) et le bail CHOISI par
    // l'utilisateur pour un virement reçu entre deux baux (`mv.bailDebut`, décision Q3 du 06/10).
    lignes.push({ qui: q0, date: String(mv.date).slice(0, 10), ym, montant: amt0, id: (mv.id != null ? mv.id : null), bailDebut: mv.bailDebut ? String(mv.bailDebut).slice(0, 10) : null });
    if (!premierYm || ym < premierYm) premierYm = ym;
  });
  return { parLot, premierYm, lignes };
}

/** Même jour, un mois plus tôt (fin de mois recadrée : 31/03 → 28/02 ou 29/02). */
const _isoMoinsUnMois = (iso) => {
  const y = parseInt(iso.slice(0, 4), 10), m = parseInt(iso.slice(5, 7), 10), d = parseInt(iso.slice(8, 10), 10);
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const dd = Math.min(d, new Date(py, pm, 0).getDate());
  return py + '-' + String(pm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
};

const _ymPlus = (ym, k) => {
  let y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10) + k;
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  return y + '-' + String(m).padStart(2, '0');
};

/** Borne de suivi normalisée : 'YYYY-MM' → 1ᵉʳ du mois, ISO (horodaté ou non) → 'YYYY-MM-DD', sinon null. */
const _borneIso = (v) => {
  const s = String(v == null ? '' : v);
  if (/^\d{4}-\d{2}$/.test(s)) return s + '-01';
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

/**
 * R0-C (2ᵉ audit 🔴1, 3ᵉ audit A1) — LA règle des encaissements datés AVANT le début du suivi, partagée
 * par le maître, la dette d'un bail et l'onglet Loyers : ils ne sont JAMAIS imputés automatiquement.
 *  - Borne = ANTÉRIORITÉ notée : la situation notée contient tous les paiements antérieurs (un terme
 *    payé d'avance se note « avait payé d'avance ») ;
 *  - Borne = DATE D'ACHAT : ils sont rendus dans `horsSuivi` ; ceux du mois qui précède l'achat sont
 *    marqués `aRattacher` (loyer peut-être versé à l'acquéreur pour le 1ᵉʳ terme) : c'est l'utilisateur
 *    qui les rattache, jamais le calcul.
 * Aucune « réserve » : celle du 2ᵉ audit effaçait une dette réelle (R1, R3) et comptait plusieurs fois
 * le même argent (R2).
 * @param {Array<{date:string, montant:number}>} lignes encaissements datés AVANT la borne
 * @param {string} borne 'YYYY-MM-DD'
 * @param {{achat?:boolean}} [opts] achat : la borne est une date d'achat
 * @returns {{horsSuivi:Array<{date:string, montant:number, aRattacher:boolean}>}}
 */
export function _avantBorne(lignes, borne, opts) {
  const seuil = (opts && opts.achat) ? _isoMoinsUnMois(borne) : borne;
  return {
    horsSuivi: (lignes || []).slice().sort((a, b) => a.date.localeCompare(b.date))
      .map(l => ({ date: l.date, montant: Math.round(l.montant * 100) / 100, aRattacher: l.date >= seuil && l.montant > 0 }))
  };
}

/**
 * core/finances-monthly.js — Sous-P&L mensuel (B4).
 *
 * Éclate le compte de résultat de l'onglet Finances mois par mois, sur le modèle
 * « prêt entier en charge » validé 2026-06-25 :
 *   - ligne « Prêt » = ÉCHÉANCE entière (mouvement cat « Prêt » = capital + intérêts).
 *   - Résultat réel après prêt = loyers HC − (prêt entier + autres charges propriétaire).
 *   - Base imposable 2044 = loyers HC − (INTÉRÊTS ligne 250 + autres charges) — le capital
 *     n'entre JAMAIS dans la base fiscale ; verrouillée tant qu'aucun intérêt n'est saisi.
 *   - Les deux vues ne s'additionnent jamais (réel = échéance, 2044 = intérêts).
 *
 * Pure / testable : reçoit les résolveurs de l'app par injection (DRY, pas de recopie).
 *   - scopeWeight(scope, m) → 0..1 (périmètre entité/immeuble + poids SCI, cf _finScopeWeight)
 *   - catLigne(cat) → {ligne2044, type} | null (cf _finCatLigne)
 *   - loyerDue(qui, ym) → {hc, ch} (dû proraté du mois, cascade cumulative, cf _finBailHcChAt)
 *   - isEcheance(m) → bool (mouvement = échéance de prêt, en prod : m.cat === 'Prêt')
 *   - isAssuranceEmprunteur(m) → bool (catégorie « Prêt — Assurance emprunteur », alias compris)
 *
 * Prêt, intérêts et assurance emprunteur (décision Didier 15/10) :
 *   - l'ÉCHÉANCE (« Prêt ») est un flux : `pret`, dans `charges` et le cash-flow, JAMAIS dans la 2044
 *     (elle contient le capital) ;
 *   - les INTÉRÊTS (« Prêt — Intérêts d'emprunt », attestation annuelle de la banque) sont une donnée
 *     de déclaration DÉJÀ PAYÉE dans l'échéance : `interets`, dans `base2044` (ligne 250), JAMAIS
 *     dans `charges` (sinon comptés deux fois au cash-flow), répartis au prorata des échéances (H-7) ;
 *   - l'ASSURANCE EMPRUNTEUR prélevée À PART de l'échéance est une vraie sortie d'argent qui n'est
 *     dans aucune échéance : `assuranceEmprunteur`, dans `charges` (cash-flow) ET dans `base2044`
 *     (ligne 250), à sa date réelle (pas de répartition H-7).
 *
 * @param {Object} input
 * @param {Object} [input.window] fenêtre de finances-window.js — LA forme à utiliser :
 *        `lastMonth` (constat) borne les mois produits, `dueMonth` (exigibilité) borne le retard.
 * @returns {{months: Array, annual: Object, interetsTotal: number, interetsKnown: boolean,
 *            lastMonth: number, dueMonth: number}}
 */
export function _computeFinancesMonthly(input) {
  const i = input || {};
  const yr = String(i.year);
  const mvts = Array.isArray(i.mouvements) ? i.mouvements : [];
  const scope = i.scope;
  const scopeWeight = i.scopeWeight || (() => 1);
  const catLigne = i.catLigne || (() => null);
  const isEcheance = i.isEcheance || (() => false);
  // Assurance emprunteur prélevée à part (décision Didier 15/10) : défaut = aucune (parité historique).
  const isAssuranceEmprunteur = i.isAssuranceEmprunteur || (() => false);
  const isGestionCharge = i.isGestionCharge || (() => false); // frais bancaires (seule catégorie à porter le drapeau) : charge proprio HORS 2044
  // Dépenses réelles HORS 2044 qui doivent peser sur le cash-flow (décision Didier 05/10 : « toutes
  // dépenses ou recettes doivent figurer dans cash flow ») : rend 'construction' (travaux
  // d'agrandissement, non déductibles) ou 'nonDeductible' (péage, matériel…), sinon null. L'achat
  // d'un bien, les apports d'associés, les dépôts et les virements internes n'y entrent PAS.
  const chargeHorsFiscal = i.chargeHorsFiscal || (() => null);
  const isRecupCharge = i.isRecupCharge || (() => false);     // charges récupérables payées en direct (flag recup, ligne 2044 vide) : transit locataire
  // L-5 : une charge récupérable AVANCÉE n'est « récupérable » que si un locataire peut la
  // rembourser — mois de vacance / lot sans bail / lot non récupérable → elle RESTE À CHARGE
  // et bascule dans « Autres charges propriétaire » (ligne 225). Injecté par l'app ; défaut =
  // tout récupérable (parité historique).
  const isRecupACharge = i.isRecupACharge || (() => false);
  // CASCADE d'imputation CUMULATIVE (décision user 2026-07-09 : « effacer les dettes avant
  // l'avance »). On collecte l'encaissé par (lot, mois) puis on impute chronologiquement PAR LOT
  // (loyer → charges → arriérés → avance) via _computeLoyerChargeAlloc. Injecté :
  // loyerDue(qui, ym) → {hc, ch} = dû proraté du mois (cf _finBailHcChAt). Fallback = pas de dû.
  const loyerDue = i.loyerDue || (() => ({ hc: 0, ch: 0 }));
  // Lots à bail actif dans la période (injecté) : inclus au RETARD même sans aucun mouvement —
  // un locataire qui ne paie RIEN de l'année est le pire retard, il ne doit pas être invisible
  // (règle « dès qu'au moins un locataire en retard », décision user 2026-07-12). N'invente
  // aucune recette : sans encaissement, sa cascade est 0/0/0, seul son arriéré compte.
  const activeLots = Array.isArray(i.activeLots) ? i.activeLots : [];

  // ── LE CONTRAT : le moteur reçoit une FENÊTRE, pas un entier (audit A1) ───────────────
  // Les deux bornes de F-1 / F-1 v2 ne sont PAS la même (finances-window.js) :
  //   `lastMonth` = fenêtre de CONSTAT     → jusqu'où on produit des mois (post-datés compris) ;
  //   `dueMonth`  = fenêtre d'EXIGIBILITÉ  → jusqu'où un dû peut être EN RETARD.
  // Les confondre était le piège de la décision « B » : passer la borne de constat (octobre)
  // faisait sauter la tolérance de début de mois et fabriquait un retard fantôme sur le mois
  // courant (~800 €/lot). `i.window` est la forme À UTILISER ; `i.lastMonth` reste accepté
  // pour les appelants historiques (les deux bornes valent alors le même mois).
  const win = i.window || null;
  // Horloge LOCALE, jamais toISOString()/UTC : le 1er du mois avant ~2 h, l'UTC recule d'un
  // mois (et d'un an au 1er janvier). Même résolveur que le suivi des loyers (audit I6).
  const today = i.today || (win && win.today) || _loyerTodayLocal();
  const curYear = today.slice(0, 4);
  const _clamp = (v) => Math.max(0, Math.min(12, v | 0));
  let lastMonth, dueMonth;
  if (win) {
    // A2 : une fenêtre VIDE produit ZÉRO mois. Elle ne doit plus être promue en janvier
    // fantôme — c'est un exercice où rien n'est encore exigible, pas un mois de janvier.
    lastMonth = _clamp(win.lastMonth);
    dueMonth = _clamp(win.dueMonth != null ? win.dueMonth : win.lastMonth);
  } else if (i.lastMonth != null) {
    lastMonth = _clamp(i.lastMonth);
    dueMonth = lastMonth;
  } else {
    lastMonth = (yr === curYear) ? parseInt(today.slice(5, 7), 10) : 12;
    dueMonth = lastMonth;
  }
  if (dueMonth > lastMonth) dueMonth = lastMonth;
  // Tolérance début de mois (parité Suivi des loyers, constat 45) : tant qu'on est avant le 10
  // ET que le dernier mois EXIGIBLE est le mois courant, son loyer non payé n'est pas un
  // « retard ». Elle suit `dueMonth`, jamais la borne de constat.
  const graceLast = dueMonth > 0 && (yr === curYear) && (dueMonth === parseInt(today.slice(5, 7), 10)) && (parseInt(today.slice(8, 10), 10) < _LOYER_TOLERANCE_JOUR);

  const blank = () => ({
    loyersBrut: 0, loyersHC: 0, provisions: 0, avance: 0, recettesDiverses: 0,
    loyerRetard: 0, chargeRetard: 0,   // RETARD des locataires à la fin du mois (Σ des lots, jamais net) — à l'année : au dernier mois exigible
    avanceLot: 0, ecart: 0, aRendre: 0, // FINANCES-SUIVI-V2 : avance compensée des lots, écart net (avance − retard), avance d'un parti à rendre
    duHC: 0, duCH: 0,                  // R-2 : dû du mois (barème historisé, Σ lots) — dénominateur du recouvrement
    rattrapage: 0,                     // part du reçu qui a servi des arriérés de mois ANTÉRIEURS (sous-ligne grise)
    nonAffecte: 0,                     // H-2 : encaissements de loyer SANS lot rattaché (comptés au total, détail faux)
    recupACharge: 0,                   // L-5 : charges récupérables restées à ta charge (sous-ensemble de `autres`)
    pret: 0, taxe: 0, travaux: 0, honoraires: 0, assurance: 0, autres: 0, gestionHF: 0, recup: 0, interets: 0,
    assuranceEmprunteur: 0,            // 15/10 : assurance de prêt prélevée à part — cash-flow ET 2044 (250), datée
    construction: 0, nonDeductible: 0,   // dépenses réelles hors 2044 (05/10) — dans les charges, jamais dans base2044
    charges: 0, reel: 0, recupSolde: 0, cashflowNet: 0, cashflowReel: 0, base2044: 0,
    _loyerByLot: null   // { qui → total encaissé du mois } — cascadé au finalize (non exporté)
  });

  const buckets = {};            // ym → agrégat
  const order = [];
  for (let m = 1; m <= lastMonth; m++) {
    const ym = yr + '-' + String(m).padStart(2, '0');
    buckets[ym] = Object.assign({ ym, mo: m }, blank());
    order.push(ym);
  }

  let intHorsFenetre = 0;                   // H-7 : intérêts datés HORS fenêtre (souvent 31/12) — donnée annuelle
  mvts.forEach(mv => {
    if (!mv || mv._deleted || !mv.date || mv.date.slice(0, 4) !== yr) return;
    const ym = mv.date.slice(0, 7);
    const b = buckets[ym];
    if (!b) {                               // mois hors fenêtre de constat
      // H-7 : les intérêts d'emprunt (250) sont une donnée ANNUELLE, pas un flux — datés 31/12
      // ils restaient invisibles toute l'année (constat 26). On les capte pour les répartir.
      const r0 = catLigne(mv.cat);
      // L'assurance emprunteur est un FLUX daté (comme toute dépense) : hors fenêtre, elle attend son mois.
      if (r0 && r0.ligne2044 === '250' && !isAssuranceEmprunteur(mv)) {
        const w0 = scopeWeight(scope, mv);
        if (w0) intHorsFenetre += ((Number(mv.db) || 0) - (Number(mv.cr) || 0)) * w0;
      }
      return;
    }
    const w = scopeWeight(scope, mv);
    if (!w) return;                         // hors périmètre

    const cr = Number(mv.cr) || 0, db = Number(mv.db) || 0;

    // Échéance de prêt (cat « Prêt ») = mensualité entière → ligne « Prêt » (jamais via catLigne).
    if (isEcheance(mv)) { b.pret += (db - cr) * w; return; }
    // Assurance emprunteur prélevée à part : vraie sortie d'argent, absente de toute échéance → seau
    // propre, compté au cash-flow ET en base 2044 (ligne 250), à sa date (pas de répartition H-7).
    if (isAssuranceEmprunteur(mv)) { b.assuranceEmprunteur += (db - cr) * w; return; }
    // Frais bancaires (flag gestionCharge — seule catégorie du référentiel à le porter) : charge
    // propriétaire RÉELLE mais HORS base 2044. Captée avant catLigne (qui renverrait null).
    if (isGestionCharge(mv)) { b.gestionHF += (db - cr) * w; return; }
    // Travaux d'agrandissement et dépenses non déductibles : sans ligne 2044, ils étaient JETÉS par
    // le filtre ci-dessous — 12 500 € de travaux payés n'apparaissaient nulle part dans le cash-flow.
    { const hf = chargeHorsFiscal(mv); if (hf === 'construction' || hf === 'nonDeductible') { b[hf] += (db - cr) * w; return; } }
    // Charges récupérables payées en direct (eau/énergie, flag recup, ligne 2044 vide) :
    // transit locataire, captées AVANT catLigne (qui renverrait null). Voir aussi 229/230 (copro).
    if (isRecupCharge(mv)) {
      const v = (db - cr) * w;
      // L-5 : « resté à ta charge » sort du transit locataire et devient une charge propriétaire
      // (ligne 225) — le cash-flow réel ne bouge pas d'un centime (déplacement, pas ajout).
      if (isRecupACharge(mv)) { b.recupACharge += v; b.autres += v; } else { b.recup += v; }
      return;
    }

    const r = catLigne(mv.cat);
    if (!r || !r.ligne2044) return;         // non mappée / special → hors résultat

    const l = r.ligne2044;
    if (l === '211') {                      // loyers (HC + provisions de charges) — cascadé par (lot, mois) au finalize
      const amt = (cr - db) * w;
      b.loyersBrut += amt;
      const q = mv.qui || '';
      if (!q) b.nonAffecte += amt;      // H-2 : total juste, détail faux — rendu VISIBLE (sous-ligne)
      if (!b._loyerByLot) b._loyerByLot = {};
      b._loyerByLot[q] = (b._loyerByLot[q] || 0) + amt;
      return;
    }
    if (l === '213') { b.recettesDiverses += (cr - db) * w; return; } // recettes diverses/GLI : imposables (parité _compute2044)
    const v = (db - cr) * w;                // net (remboursements partiels)
    if (l === '250') b.interets += v;
    else if (l === '227') b.taxe += v;
    else if (l === '224' || l === '224bis') b.travaux += v;
    else if (l === '221') b.honoraires += v;
    else if (l === '223') b.assurance += v;
    else if (l === '229' || l === '230') { if (isRecupACharge(mv)) { b.recupACharge += v; b.autres += v; } else { b.recup += v; } } // charges récupérables payées par le bailleur (transit locataire, sauf part restée à charge L-5)
    else if (l === '226' || l === '225') b.autres += v;
  });

  // H-7 : les intérêts d'emprunt sont une DONNÉE ANNUELLE, pas un flux de compte (souvent datés
  // 31/12 → hors fenêtre toute l'année, constat 26). Ils sont RÉPARTIS au prorata des échéances
  // de prêt payées ; sans échéance connue, ils restent datés (repli à l'identique).
  {
    let totInt = intHorsFenetre, totPret = 0;
    order.forEach(ym => { totInt += buckets[ym].interets; totPret += buckets[ym].pret; });
    if (totInt !== 0 && totPret > 0) {
      order.forEach(ym => { const b = buckets[ym]; b.interets = totInt * (b.pret / totPret); });
    } else if (intHorsFenetre !== 0 && order.length) {
      // Aucune échéance connue : pas de prorata possible — on rattache au dernier mois produit
      // plutôt que de PERDRE la donnée (l'annuel = Σ des mois).
      buckets[order[order.length - 1]].interets += intHorsFenetre;
    }
  }

  const round2 = n => Math.round(n * 100) / 100;
  // (1) Cascade d'imputation CUMULATIVE par LOT sur toute la période : chaque mois comble son
  //     loyer+charges, récupère les arriérés (loyer d'abord), reliquat = avance. Les résultats
  //     mensuels somment exactement à l'annuel (le mois qui reçoit porte la récup + l'avance).
  // ── C2 : POSITION D'OUVERTURE de l'arriéré (Finances maître, décision user (b) 2026-09-07) ──
  // Le retard était borné à l'année → un arriéré ouvert en N-1 n'y entrait pas. On calcule, par lot,
  // l'arriéré reporté du DÉBUT DU SUIVI (1er mouvement de la base) au 31/12 N-1, en faisant tourner
  // le MÊME netting sur les mois pré-exercice (dû = loyerDue du bail de l'époque, 0 avant le bail →
  // auto-borné). Il sera SEMÉ dans le netting de l'année (idx 0) → recouvré en priorité par les
  // paiements de l'année (une avance de l'année solde d'abord la dette N-1 : jamais « avance ET
  // retard » simultanés). N'entre QUE dans le retard/position : la cascade fiscale (loyersHC /
  // provisions / avance imposable, base 2044) reste année-scopée et INTOUCHÉE.
  // R0-C lot 1 : collecte déléguée au collecteur unique (même prédicat, même montant, même poids).
  const _pre = _collecterLoyers211(mvts, catLigne, (mv) => scopeWeight(scope, mv), (mv, ym) => ym < yr + '-01');
  const preRecv = _pre.parLot;   // qui → { ym → reçu 211 scopé } avant l'exercice
  const _suiviStartYm = _pre.premierYm;
  const _preYmsDepuis = (start) => {
    const out = [];
    if (!start) return out;
    let py = parseInt(start.slice(0, 4), 10), pm = parseInt(start.slice(5, 7), 10);
    const endY = parseInt(yr, 10) - 1;
    while ((py < endY) || (py === endY && pm <= 12)) {
      out.push(py + '-' + String(pm).padStart(2, '0'));
      pm++; if (pm > 12) { pm = 1; py++; }
      if (out.length > 600) break;                // garde-fou 50 ans
    }
    return out;
  };
  const _preYms = _preYmsDepuis(_suiviStartYm);
  // R0-C · Q1 — `debutDu(q)` (injecté, optionnel) : DÉBUT DU SUIVI du lot ('YYYY-MM-DD', ou 'YYYY-MM' =
  // le 1ᵉʳ) — entrée en jouissance du bailleur actuel ou date d'une antériorité notée (Q1 révisé 01/10).
  // Fourni, il fait foi (2ᵉ audit 🔴1, 05/10) : la pré-passe démarre à son mois (même si des relevés
  // le précèdent, même s'il précède le 1ᵉʳ versement : les premiers mois dus d'un bail comptent), le
  // solde d'ouverture y est semé, et les encaissements datés AVANT lui ne sont jamais imputés au
  // netting (`_avantBorne`, 3ᵉ audit A1 : aucune réserve). La cascade FISCALE
  // (loyersHC / provisions / avance, base 2044) n'en est pas touchée : un encaissement reste un
  // encaissement. Absent (date provisoire (b)) → comportement historique à l'identique.
  const debutDu = (typeof i.debutDu === 'function') ? i.debutDu : null;
  const _borneMemo = new Map();
  const _borneLot = (q) => {
    if (!debutDu || !q) return null;
    if (!_borneMemo.has(q)) _borneMemo.set(q, _borneIso(debutDu(q)));
    return _borneMemo.get(q);
  };
  // Encaissements 211 (même périmètre, même poids) datés avant la borne de leur lot : retirés du netting.
  const _avantB = debutDu
    ? _collecterLoyers211(mvts, catLigne, (mv) => scopeWeight(scope, mv), (mv) => { const b = _borneLot(mv.qui || ''); return !!b && String(mv.date).slice(0, 10) < b; })
    : { parLot: {}, lignes: [] };
  const _recuNet = (q, ym, recu) => recu - ((_avantB.parLot[q] && _avantB.parLot[q][ym]) || 0);
  const _preYmsLot = (q) => {
    const b = _borneLot(q);
    return b ? _preYmsDepuis(b.slice(0, 7)) : _preYms;
  };
  // R0-C · Q1 RÉVISÉ — `ouverture(q)` (injecté, optionnel) : le SOLDE D'OUVERTURE noté sur le bail
  // (antériorité : arriéré de loyer / de charges, ou avance, à la date de début du suivi), posé UNE
  // fois, AU MOIS de cette date. { ym:'YYYY-MM', loyer, charge, avance } | null. Avant l'exercice : semé
  // dans la pré-passe (il est alors soldé, ou reporté, par le même netting que tout arriéré) ; dans
  // l'exercice : semé à son mois dans le netting de l'exercice. Absent → comportement historique.
  const ouvertureOf = (typeof i.ouverture === 'function') ? i.ouverture : null;
  const _ouv = (q) => {
    const o = ouvertureOf ? ouvertureOf(q) : null;
    if (!o || !/^\d{4}-\d{2}$/.test(String(o.ym || ''))) return null;
    const v = { loyer: Math.max(0, Number(o.loyer) || 0), charge: Math.max(0, Number(o.charge) || 0), avance: Math.max(0, Number(o.avance) || 0) };
    return (v.loyer + v.charge + v.avance) > 0.005 ? Object.assign({ ym: String(o.ym) }, v) : null;
  };
  // ── FINANCES-SUIVI-V2 — LA POSITION DES LOTS (avance OU retard, jamais les deux) ─────────────────────
  // Avec `suivi(q)` injecté (l'app : `_finSuiviLot`), la position d'un lot vient du MOTEUR UNIQUE, bail par
  // bail (`_computeSuiviLot` → `_positionLot`) : la dette d'un locataire parti n'est plus payée par le
  // suivant, l'avance est compensée (lot E du 05/10, défaut C2 de l'audit du 14/07). Sans contexte de bail
  // (appelants historiques, tests unitaires du P&L), le lot est suivi comme UN bail synthétique : MÊME
  // passe (`_loyerArrearsPass` compensé), dû `loyerDue`, borne `debutDu` et ouverture comme avant. La passe
  // fiscale (`_computeLoyerChargeAlloc` : loyers HC, provisions, base 2044) reste à l'encaissement, intacte.
  const suiviOf = (typeof i.suivi === 'function') ? i.suivi : null;
  const dueYm = dueMonth > 0 ? yr + '-' + String(dueMonth).padStart(2, '0') : null;
  const _suiviSynthetique = (q) => {
    const yms = _preYmsLot(q).concat(order.slice(0, dueMonth));
    if (!yms.length) return null;
    const recu = (ym) => _recuNet(q, ym, ym < yr + '-01'
      ? ((preRecv[q] && preRecv[q][ym]) || 0)
      : ((buckets[ym] && buckets[ym]._loyerByLot && buckets[ym]._loyerByLot[q]) || 0));
    const months = yms.map(ym => { const d = loyerDue(q, ym) || {}; return { ym, hcDue: Number(d.hc) || 0, chDue: Number(d.ch) || 0, received: recu(ym) }; });
    const ouv = _ouv(q);
    let opening = null;
    if (ouv && ouv.ym <= yms[yms.length - 1]) opening = Object.assign({}, ouv, { idx: Math.max(0, yms.indexOf(ouv.ym)) });
    const r = _loyerArrearsPass(months, { carry: true, graceLast, opening });
    const mois = months.map((m, idx) => {
      const pm = r.months[idx] || {};
      return { ym: m.ym, retardLoyer: round2(pm.loyerArrear || 0), retardCharge: round2(pm.chargeArrear || 0), avance: round2(pm.avance || 0),
        loyerRetard: round2(r.retardMois[idx].loyer), chargeRetard: round2(r.retardMois[idx].charge) };
    });
    const prem = mois.find(m => (m.loyerRetard + m.chargeRetard) > 0.005);
    return { baux: [{ debut: yms[0] + '-01', finDu: null, mois, depuisYm: prem ? prem.ym : null }] };
  };

  const lotsEnRetard = [];       // R-2 : lots en retard au dernier mois exigible (compteur « N impayés »)
  // KPI Lot 0 (CDC-KPI §R-0 / D34) : le détail par lot est EXPOSÉ, pas jeté.
  const byLot = {};
  const allLots = new Set();
  order.forEach(ym => { const lots = buckets[ym]._loyerByLot; if (lots) for (const q in lots) allLots.add(q); });
  activeLots.forEach(q => allLots.add(q));   // + lots à bail actif sans mouvement (retard « zéro paiement »)
  allLots.forEach(q => {
    const lotMonths = order.map(ym => {
      const d = loyerDue(q, ym) || {};
      return { hcDue: Number(d.hc) || 0, chDue: Number(d.ch) || 0, received: (buckets[ym]._loyerByLot && buckets[ym]._loyerByLot[q]) || 0 };
    });
    const lotFrise = order.map((ym, idx) => ({
      ym, duHC: lotMonths[idx].hcDue, duCH: lotMonths[idx].chDue,
      encaisse: lotMonths[idx].received, loyerRetard: 0, chargeRetard: 0, avance: 0, position: 0, aRendre: 0, resteMois: 0, rattrapage: 0
    }));
    // R-2 : le dû CC du mois (barème historisé) — dénominateur unique du recouvrement.
    lotMonths.forEach((lm, idx) => { const b = buckets[order[idx]]; b.duHC += lm.hcDue; b.duCH += lm.chDue; });
    // Passe FISCALE à l'encaissement (2044) : inchangée.
    _computeLoyerChargeAlloc(lotMonths).forEach((a, idx) => {
      const b = buckets[order[idx]];
      b.loyersHC += a.loyersHC; b.provisions += a.provisions; b.avance += a.avance;
      b.rattrapage += a.rattrapage || 0;
      lotFrise[idx].rattrapage = a.rattrapage || 0;
    });
    // Position du lot à la fin de chaque mois EXIGIBLE ; au-delà (mois compté au constat, pas encore
    // exigible), la position reste celle du dernier mois exigible : un mois non échu n'est jamais en retard.
    const s = (q && q.indexOf('SCI:') !== 0) ? (suiviOf ? suiviOf(q) : _suiviSynthetique(q)) : null;
    if (s && dueYm) order.forEach((ym, idx) => {
      const p = _positionLot(s, idx < dueMonth ? ym : dueYm);
      const b = buckets[ym];
      b.loyerRetard += p.retardLoyer; b.chargeRetard += p.retardCharge;
      b.avanceLot += p.avance; b.ecart += p.position; b.aRendre += p.aRendre;
      // `resteMois` : ce qui reste dû AUJOURD'HUI de CE mois (baux comptés ce mois-là) — pour « reste à encaisser ce mois »
      let resteMois = 0;
      p.baux.forEach(pb => { const b = (s.baux || []).find(x => x.debut === pb.debut); const mm = b && b.mois && b.mois.find(x => x.ym === ym); if (mm) resteMois += (mm.loyerRetard || 0) + (mm.chargeRetard || 0); });
      Object.assign(lotFrise[idx], { loyerRetard: p.retardLoyer, chargeRetard: p.retardCharge, avance: p.avance, position: p.position, aRendre: p.aRendre, resteMois });
    });
    const pAn = (s && dueYm) ? _positionLot(s, dueYm) : null;
    if (pAn && pAn.retard > 0.005 && q) lotsEnRetard.push(q);

    if (q) {
      const sum = (k) => lotFrise.reduce((t, m) => t + (m[k] || 0), 0);
      const encaisse = round2(sum('encaisse'));
      const duHC = round2(sum('duHC')), duCH = round2(sum('duCH'));
      // Ancienneté : le plus vieux mois encore dû, parmi les baux comptés au dernier mois exigible.
      let depuisYm = null;
      if (pAn && s) (s.baux || []).forEach(b => { if (pAn.baux.some(x => x.debut === b.debut) && b.depuisYm && (!depuisYm || b.depuisYm < depuisYm)) depuisYm = b.depuisYm; });
      const position = pAn ? pAn.position : 0;
      byLot[q] = {
        months: lotFrise.map(m => ({
          ym: m.ym, duHC: round2(m.duHC), duCH: round2(m.duCH), encaisse: round2(m.encaisse),
          loyerRetard: round2(m.loyerRetard), chargeRetard: round2(m.chargeRetard),
          avance: round2(m.avance), position: round2(m.position), aRendre: round2(m.aRendre), resteMois: round2(m.resteMois), rattrapage: round2(m.rattrapage)
        })),
        annual: {
          duHC, duCH, encaisse,
          // position au dernier mois exigible : retard (Σ des baux, jamais net) et avance (baux en cours)
          retard: pAn ? pAn.retard : 0,
          avance: pAn ? pAn.avance : 0,
          aRendre: pAn ? pAn.aRendre : 0,
          position
        },
        // position signée du lot : + avance / − retard (plus « encaissé − dû » de l'année)
        solde: position,
        depuisYm,
        // les baux comptés au dernier mois exigible : qui doit quoi (un locataire PARTI n'est jamais nommé à la place du suivant)
        baux: pAn ? pAn.baux.map(b => ({ debut: b.debut, parti: b.parti, retard: b.retard, avance: b.avance })) : []
      };
    }
  });
  // (2) Champs dérivés (loyersHC/provisions/avance déjà posés : par cascade au mois, par somme à l'année).
  const finalizeDerived = b => {
    b.charges = b.pret + b.taxe + b.travaux + b.honoraires + b.assurance + b.autres + b.gestionHF   // charges propriétaire : prêt entier + frais bancaires
      + b.construction + b.nonDeductible                                                           // + dépenses réelles hors 2044 (05/10)
      + b.assuranceEmprunteur;                                                                     // + assurance de prêt prélevée à part (15/10)
    b.reel = b.loyersHC + b.recettesDiverses - b.charges;             // résultat propre (loyers HC + recettes diverses 213 − charges)
    b.recupSolde = b.provisions - b.recup;                            // transit locataire : + trop-perçu / − bailleur a avancé
    b.cashflowNet = b.reel;                                           // ton résultat propre (hors transit locataire)
    b.cashflowReel = b.reel + b.recupSolde;                           // vrai cash sur le compte (transit inclus)
    b.base2044 = b.loyersHC + b.recettesDiverses - (b.interets + b.assuranceEmprunteur + b.taxe + b.travaux + b.honoraires + b.assurance + b.autres); // 213 imposable ; capital ET gestionHF exclus ; 250 = intérêts + assurance emprunteur
    ['loyersBrut', 'loyersHC', 'provisions', 'avance', 'recettesDiverses', 'loyerRetard', 'chargeRetard', 'avanceLot', 'ecart', 'aRendre', 'duHC', 'duCH', 'rattrapage', 'nonAffecte', 'recupACharge', 'pret', 'taxe', 'travaux', 'honoraires', 'assurance', 'autres', 'gestionHF', 'construction', 'nonDeductible', 'recup', 'interets', 'assuranceEmprunteur', 'charges', 'reel', 'recupSolde', 'cashflowNet', 'cashflowReel', 'base2044']
      .forEach(k => { b[k] = round2(b[k]); });
    return b;
  };

  const months = order.map(ym => finalizeDerived(buckets[ym]));   // loyersHC/provisions/avance déjà posés par la cascade cumulative

  // Agrégat annuel (Σ des mois — loyersHC/provisions/avance inclus, PAS de re-cascade)
  const annual = Object.assign({ ym: yr, mo: 0 }, blank());
  months.forEach(b => {
    ['loyersBrut', 'loyersHC', 'provisions', 'avance', 'recettesDiverses', 'duHC', 'duCH', 'rattrapage', 'nonAffecte', 'recupACharge', 'pret', 'taxe', 'travaux', 'honoraires', 'assurance', 'autres', 'gestionHF', 'construction', 'nonDeductible', 'recup', 'interets', 'assuranceEmprunteur']
      .forEach(k => { annual[k] += b[k]; });
  });
  // FINANCES-SUIVI-V2 : retard, avance et écart sont des POSITIONS (à la fin du mois), pas des flux : la
  // colonne Année est la position au DERNIER MOIS EXIGIBLE (décision 06/10), jamais la somme des mois.
  {
    const dm = dueMonth > 0 ? months[dueMonth - 1] : null;
    ['loyerRetard', 'chargeRetard', 'avanceLot', 'ecart', 'aRendre'].forEach(k => { annual[k] = dm ? dm[k] : 0; });
  }
  finalizeDerived(annual);

  const interetsTotal = annual.interets;
  // Les bornes effectivement appliquées sont RENDUES : l'appelant (et les tests) peuvent
  // vérifier quelle fenêtre a réellement piloté le calcul, au lieu de le supposer.
  return { months, annual, interetsTotal, interetsKnown: interetsTotal > 0, lastMonth, dueMonth, lotsEnRetard, byLot };
}

/**
 * Ligne 250 de la 2044 (« intérêts d'emprunt et frais accessoires ») — ce qui est DÉJÀ compté pour une
 * année : sert l'alerte de double compte quand l'utilisateur saisit des intérêts (attestation de la
 * banque, qui inclut souvent l'assurance emprunteur) ou une assurance alors que l'autre existe déjà.
 * Pur : l'appelant injecte le genre (`genre(cat)` → 'interets' | 'assurance' | null, par la famille
 * mère) et le filtre de bien (`garder(mv)`). N'agrège RIEN pour Finances (le moteur reste seul juge
 * des montants) : c'est une liste de pièces, avec leur total, pour un message.
 * @param {{mouvements:Array, year:(string|number), genre:function, garder?:function, exclId?:*}} input
 * @returns {{lignes:Array<{id:*, date:string, lib:string, cat:string, genre:string, montant:number}>,
 *            total:number, totalInterets:number, totalAssurance:number}}
 */
export function _ligne250DejaComptee(input) {
  const i = input || {};
  const yr = String(i.year);
  const genre = i.genre || (() => null);
  const garder = i.garder || (() => true);
  const round2 = n => Math.round(n * 100) / 100;
  const lignes = [];
  (Array.isArray(i.mouvements) ? i.mouvements : []).forEach(mv => {
    if (!mv || mv._deleted || !mv.date || String(mv.date).slice(0, 4) !== yr) return;
    if (i.exclId != null && String(mv.id) === String(i.exclId)) return;
    const g = genre(mv.cat);
    if (g !== 'interets' && g !== 'assurance') return;
    if (!garder(mv)) return;
    const montant = round2((Number(mv.db) || 0) - (Number(mv.cr) || 0));
    if (Math.abs(montant) < 0.005) return;
    lignes.push({ id: mv.id, date: String(mv.date).slice(0, 10), lib: String(mv.lib || ''), cat: String(mv.cat || ''), genre: g, montant });
  });
  lignes.sort((a, b) => a.date.localeCompare(b.date));
  const somme = g => round2(lignes.filter(l => !g || l.genre === g).reduce((t, l) => t + l.montant, 0));
  return { lignes, total: somme(null), totalInterets: somme('interets'), totalAssurance: somme('assurance') };
}

/** Jours entre deux dates ISO (b − a), au jour près, sans fuseau. */
const _joursEntre = (a, b) => Math.round((Date.parse(String(b).slice(0, 10) + 'T00:00:00Z') - Date.parse(String(a).slice(0, 10) + 'T00:00:00Z')) / 86400000);

/**
 * FINANCES-SUIVI-V2 — À QUEL BAIL APPARTIENT UN ENCAISSEMENT DE LOYER (règle unique du suivi).
 *   1. le bail CHOISI par l'utilisateur (`mv.bailDebut`, alerte « à qui attribuer ce virement ») fait foi ;
 *   2. sinon le bail dont l'occupation contient la date ;
 *   3. avant le 1ᵉʳ bail du lot → le 1ᵉʳ bail (loyer payé quelques jours avant l'entrée) ; après le dernier
 *      bail terminé → ce bail (arriéré réglé après la sortie) ;
 *   4. ENTRE deux baux (vacance) → le bail le plus PROCHE dans le temps, marqué « à confirmer »
 *      (décision Didier Q3, 06/10/2026 : on demande à l'utilisateur ; tant qu'il n'a pas répondu, le plus proche).
 * @param {Array<{debut:string, end:string|null}>} segs segments d'occupation (segmentsOccupation)
 * @param {string} date 'YYYY-MM-DD'
 * @param {string|null} [choix] 'YYYY-MM-DD' début du bail choisi
 * @returns {null|{k:number, aConfirmer:boolean, choisi:boolean}}
 */
export function _bailDuPaiement(segs, date, choix) {
  const S = segs || [];
  if (!S.length || !date) return null;
  const d = String(date).slice(0, 10);
  if (choix) {
    const kc = S.findIndex((s) => s.debut === String(choix).slice(0, 10));
    if (kc >= 0) return { k: kc, aConfirmer: false, choisi: true };
  }
  const kd = S.findIndex((s) => s.debut <= d && (!s.end || d <= s.end));
  if (kd >= 0) return { k: kd, aConfirmer: false, choisi: false };
  let prev = -1, next = -1;
  S.forEach((s, idx) => { if (s.end && s.end < d) prev = idx; if (next < 0 && s.debut > d) next = idx; });
  if (prev < 0) return next >= 0 ? { k: next, aConfirmer: false, choisi: false } : null;
  if (next < 0) return { k: prev, aConfirmer: false, choisi: false };
  const dp = _joursEntre(S[prev].end, d), dn = _joursEntre(d, S[next].debut);
  return { k: dn <= dp ? next : prev, aConfirmer: true, choisi: false };
}

/**
 * R0-C lot 1 (docs/CDC-R0C.md, option B « Finances fait foi ») — LA DETTE D'UN BAIL, lue dans
 * le maître. C'est elle que la restitution du dépôt de garantie retient (art. 22 loi 89-462).
 *
 * FINANCES-SUIVI-V2 (docs/subjects/FINANCES-SUIVI-UNIQUE.md, décisions Didier 05/10 et 06/10) : c'est
 * aussi LE MOTEUR UNIQUE du suivi des loyers. Finances, l'onglet Loyers, la relance, les quittances, le
 * bandeau « Tous les loyers », l'Accueil et la restitution lisent tous ce calcul, bail par bail
 * (`_computeSuiviLot` l'assemble pour un lot). Il porte en plus :
 *   - la POSITION du bail à la fin de chaque mois (`mois[].retardLoyer/retardCharge/avance/position`) :
 *     avance OU retard, jamais les deux (même cascade compensée) ;
 *   - les règlements sans virement : `retenueLoyer` (retenue pour loyer sur le dépôt, posée au mois de la
 *     fin du bail, imputée sur le LOYER HC seulement — décision Didier 17/10) et `manques` (manques acceptés, à leur mois) — plafonnés, jamais une avance, jamais un
 *     encaissement (la 2044 n'en sait rien) ;
 *   - l'arrondi sous `seuilArrondi` (le suivi passe 1 €), tracé ;
 *   - le rattachement des encaissements de `_bailDuPaiement` (Q3) et la liste `aConfirmer`.
 *
 * Même cascade que le maître (loyer → charges → arriérés → avance), même dû (`duMoisSuivi` : barème
 * historisé, prorata d'entrée, 1ᵉʳ terme exigible après le début du suivi), mêmes encaissements
 * (`_collecterLoyers211` : ligne 211, alias M-1, net des contre-passations), même fenêtre d'exigibilité
 * (tolérance avant le 10). Le calcul court sur la vie du bail d'une traite, sans ouverture reportée :
 * le passé du bail est dans le calcul (fin du double/triple comptage, fin de la dette d'un locataire
 * facturée au suivant — cas C, cas Arslan).
 *
 * Décisions Didier 30/09 intégrées :
 *   Q1 RÉVISÉ (01/10) — le dû part de l'entrée du bail, borné par `debutSuivi` ; une part du bail
 *        antérieure à la borne → `suiviPartiel: true` ; un bail achevé avant la borne → `suiviAbsent: true`
 *        et montants `null` (dette inconnue, jamais un zéro muet).
 *   Q3 — `fin` = date de fin effective, sinon date de sortie ; elle borne le dû au jour près.
 *   Q5 — le trop-perçu restant est rendu dans `avance` (hors encaissements « à rattacher » / « à confirmer »).
 * Charges : `charge` est exposée, JAMAIS à retenir sur le dépôt (régularisation — anti-double-compte).
 *
 * @param {Object} input
 * @param {string} input.ref ref du lot (clé `qui` des mouvements, comparaison exacte comme le maître)
 * @param {{bails:Array, bareme:Array}} input.ctx contexte duMois du LOT (tous ses baux)
 * @param {string} input.bailDebut 'YYYY-MM-DD' — identifie le bail (début de son segment)
 * @param {string|null} [input.fin] fin du dû 'YYYY-MM-DD' ; absente = fin du segment
 * @param {Array} input.mouvements
 * @param {function} input.catLigne cat → {ligne2044} | null (en prod `_finCatLigne`)
 * @param {string|null} [input.debutSuivi] borne du suivi 'YYYY-MM-DD'
 * @param {string|null} [input.sourceSuivi] 'acquisition' | 'anteriorite' | 'provisoire'
 * @param {{loyer?:number, charge?:number, avance?:number}|null} [input.ouverture] solde d'ouverture noté sur CE bail
 * @param {Array<{ym:string, montant:number, id?:string, _deleted?:boolean}>} [input.manques] manques acceptés de CE bail
 * @param {number} [input.retenueLoyer] retenue pour loyer sur le dépôt de CE bail (bail sorti)
 * @param {boolean} [input.chargesALaRegul] bail SORTI dont le solde de tout compte est enregistré (restitution du dépôt
 *        datée…) : ses provisions de charges encore dues QUITTENT l'arriéré (`chargeRetard`, `retardCharge`, `charge` à 0)
 *        et sont rendues à part (`mois[].aLaRegul`, `chargesRegul`) — elles se règlent à la régularisation de charges
 *        (CDC Charges v15.574 « impayé = LOYER, charges = régul », décision pilotage 17/10). L'imputation ne change pas.
 * @param {number} [input.seuilArrondi] 0 par défaut ; le suivi passe 1
 * @param {string} [input.today] horloge locale 'YYYY-MM-DD'
 * @returns {null|Object} null = bail introuvable ou bornes incohérentes : dette INCONNUE (≠ 0).
 */
export function _computeDetteBail(input) {
  const i = input || {};
  const ref = i.ref, ctx = i.ctx;
  if (!ref || !ctx || !i.bailDebut) return null;
  const debut = String(i.bailDebut).slice(0, 10);
  const segs = segmentsOccupation(ctx.bails);
  const k = segs.findIndex(s => s.debut === debut);
  if (k < 0) return null;
  const seg = segs[k], next = segs[k + 1] || null, aUnPrecedent = k > 0;
  const catLigne = i.catLigne || (() => null);
  const today = i.today || _loyerTodayLocal();
  const round2 = n => Math.round(n * 100) / 100;

  // Q3 — fin du dû : la plus tôt entre la fin du segment (fin effective / troncature C4) et `fin`.
  let finDu = seg.end || null;
  if (i.fin) { const f = String(i.fin).slice(0, 10); if (!finDu || f < finDu) finDu = f; }
  if (finDu && finDu < debut) return null;

  const debutSuivi = i.debutSuivi ? (String(i.debutSuivi).length === 7 ? i.debutSuivi + '-01' : String(i.debutSuivi).slice(0, 10)) : null;
  const suiviPartiel = !!(debutSuivi && debutSuivi > debut);
  if (debutSuivi && finDu && debutSuivi > finDu) {
    return { loyer: null, charge: null, avance: null, avanceBrute: null, position: null, mois: [], from: null, to: null, debutSuivi, finDu,
      horsPeriode: [], aRattacher: [], aConfirmer: [], horsSuivi: [], graceLast: false, suiviPartiel: true, suiviAbsent: true,
      depuisYm: null, manquesIgnores: [], retenue: { montant: 0, appliquee: 0 }, arrondis: [] };
  }
  // Dû de CE bail seul, sa fin portée à `finDu` (segmentDebut isole sa part d'un mois partagé).
  const ctxDu = {
    ref, bareme: ctx.bareme || [],
    bails: (ctx.bails || []).map(b => (b && !b._deleted && b.debut && String(b.debut).slice(0, 10) === debut && finDu)
      ? Object.assign({}, b, { finEffective: finDu }) : b)
  };

  // Fenêtre d'exigibilité de Finances : rien au-delà du dernier mois échu.
  const W = computeExigibiliteWindow({ year: Number(today.slice(0, 4)), today });
  const moisCourant = today.slice(0, 7);
  const dernierExigible = W.dueMonth > 0 ? today.slice(0, 4) + '-' + String(W.dueMonth).padStart(2, '0') : _ymPlus(today.slice(0, 4) + '-01', -1);

  // Rattachement de chaque encaissement du lot à SON bail (`_bailDuPaiement`, règle unique Q3).
  const col = _collecterLoyers211(i.mouvements, catLigne, () => 1, (mv, ym) => mv.qui === ref && ym <= dernierExigible);
  const miens = [];
  col.lignes.forEach(l => {
    const r = _bailDuPaiement(segs, l.date, l.bailDebut);
    if (r && r.k === k) miens.push(Object.assign({}, l, { aConfirmer: !!r.aConfirmer, choisi: !!r.choisi }));
  });
  // 2ᵉ audit 🔴1 / 3ᵉ audit A1 — un encaissement daté AVANT le début du suivi n'est jamais imputé.
  const lignesSuivi = debutSuivi ? miens.filter(l => l.date >= debutSuivi) : miens;
  const avant = debutSuivi ? _avantBorne(miens.filter(l => l.date < debutSuivi), debutSuivi, { achat: i.sourceSuivi === 'acquisition' }) : { horsSuivi: [] };
  const recu = {}, src = {};
  lignesSuivi.forEach(l => {
    recu[l.ym] = (recu[l.ym] || 0) + l.montant;
    (src[l.ym] = src[l.ym] || []).push({ date: l.date, id: l.id, montant: l.montant });
  });
  const derniereLigne = lignesSuivi.reduce((m, l) => (l.ym > m ? l.ym : m), '');
  const premierSuivi = lignesSuivi.reduce((m, l) => (!m || l.ym < m ? l.ym : m), '');
  let from = debut.slice(0, 7);
  if (premierSuivi && premierSuivi < from) from = premierSuivi;
  if (debutSuivi && from < debutSuivi.slice(0, 7)) from = debutSuivi.slice(0, 7);
  let to = finDu ? finDu.slice(0, 7) : dernierExigible;
  if (derniereLigne > to) to = derniereLigne;
  if (to > dernierExigible) to = dernierExigible;

  const yms = [];
  for (let ym = from; ym <= to && yms.length <= 1200; ym = _ymPlus(ym, 1)) yms.push(ym);
  // Règlements sans virement : la retenue pour loyer au mois de la fin du bail (sinon au dernier mois
  // suivi), les manques acceptés à LEUR mois (un manque hors des mois du bail est ignoré, et dit).
  const retenue = finDu ? round2(Math.max(0, Number(i.retenueLoyer) || 0)) : 0;
  const ymRetenue = retenue > 0.005 && yms.length ? (yms.includes(finDu.slice(0, 7)) ? finDu.slice(0, 7) : yms[yms.length - 1]) : null;
  const manques = (Array.isArray(i.manques) ? i.manques : [])
    .filter(m => m && !m._deleted && /^\d{4}-\d{2}$/.test(String(m.ym || '')) && (Number(m.montant) || 0) > 0.005);
  const manquesIgnores = manques.filter(m => !yms.includes(String(m.ym))).map(m => ({ id: m.id != null ? m.id : null, ym: String(m.ym), montant: round2(Number(m.montant)) }));
  const lignesMois = yms.map(ym => {
    const d = duMoisSuivi(ctxDu, ym, debutSuivi, { segmentDebut: debut });
    const o = { ym, hcDue: Number(d.hc) || 0, chDue: Number(d.ch) || 0, received: recu[ym] || 0, sources: src[ym] || [] };
    const mq = manques.filter(m => String(m.ym) === ym).reduce((t, m) => t + (Number(m.montant) || 0), 0);
    if (mq > 0.005) o.remise = mq;
    if (ym === ymRetenue) o.reglement = retenue;
    return o;
  });
  // Tolérance du début de mois (< 10) : `sansTolerance` la coupe (quittances, D6 « au centime »).
  const graceLast = !i.sansTolerance && !!W.graceLast && yms.length > 0 && yms[yms.length - 1] === moisCourant;
  // Seule l'antériorité NOTÉE sur ce bail (Q1 révisé) est posée, une fois, au mois du début du suivi.
  const ouv = i.ouverture ? { loyer: Math.max(0, Number(i.ouverture.loyer) || 0), charge: Math.max(0, Number(i.ouverture.charge) || 0), avance: Math.max(0, Number(i.ouverture.avance) || 0) } : null;
  const opening = ouv ? Object.assign({}, ouv, { idx: debutSuivi ? Math.max(0, yms.indexOf(debutSuivi.slice(0, 7))) : 0 }) : null;
  const r = _loyerArrearsPass(lignesMois, { carry: true, graceLast, opening, seuilArrondi: Number(i.seuilArrondi) || 0 });
  const aConfLignes = lignesSuivi.filter(l => l.aConfirmer);
  const aLaRegul = !!(i.chargesALaRegul && finDu);
  const mois = lignesMois.map((m, idx) => {
    const pm = r.months[idx] || {};
    const retL = round2(pm.loyerArrear || 0), retC = aLaRegul ? 0 : round2(pm.chargeArrear || 0), av = round2(pm.avance || 0);
    const resC = round2(r.retardMois[idx].charge);
    return {
      ym: m.ym, duHC: round2(m.hcDue), duCH: round2(m.chDue), encaisse: round2(m.received),
      // résidu : ce qui reste dû AUJOURD'HUI de CE mois (relance, quittances, ancienneté)
      loyerRetard: round2(r.retardMois[idx].loyer), chargeRetard: aLaRegul ? 0 : resC,
      // provisions de charges de CE mois passées à la régularisation (bail sorti, solde de tout compte enregistré)
      aLaRegul: aLaRegul ? resC : 0,
      // position du bail à la FIN du mois (Finances, fenêtre, bandeau) : avance OU retard
      avance: av, retardLoyer: retL, retardCharge: retC, position: round2(av - retL - retC),
      remise: round2(pm.remise || 0), remiseCharge: round2(pm.remiseCharge || 0), reglement: round2(pm.reglement || 0), arrondi: round2(pm.arrondi || 0),
      paiements: (src[m.ym] || []).map(p => ({ id: p.id, date: p.date, montant: round2(p.montant),
        aConfirmer: aConfLignes.some(l => l.id === p.id && l.date === p.date) })),
      imputations: (r.imputations && r.imputations[idx]) || []
    };
  });
  const horsPeriode = lignesSuivi
    .filter(l => l.date < debut || (finDu && l.date > finDu))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(l => ({ date: l.date, montant: round2(l.montant) }));
  // 🟠6 — encaissements « à rattacher » : datés dans le mois qui précède l'entrée d'un bail VOISIN, ils
  // peuvent solder une dette, JAMAIS devenir un trop-perçu versé au locataire sortant.
  const avanceBrute = round2(r.avance || 0);
  const aRattacher = [];
  if (next && avanceBrute > 0.005) {
    const seuil = _isoMoinsUnMois(next.debut);
    let reste = avanceBrute;
    lignesSuivi.filter(l => l.date >= seuil && l.date < next.debut && l.montant > 0 && !l.choisi)
      .sort((x, y) => y.date.localeCompare(x.date))
      .forEach(l => {
        if (reste <= 0.005) return;
        const m = round2(Math.min(reste, l.montant));
        reste = round2(reste - m);
        aRattacher.push({ date: l.date, montant: m, compte: true, motif: 'avant l’entrée du bail suivant' });
      });
  }
  if (aUnPrecedent && !i._sansVoisin) {
    const prec = _computeDetteBail(Object.assign({}, i, { bailDebut: segs[k - 1].debut, fin: null, manques: [], retenueLoyer: 0, _sansVoisin: true }));
    ((prec && prec.aRattacher) || []).forEach(x => aRattacher.push({ date: x.date, montant: x.montant, compte: false,
      motif: 'avant l’entrée de ce bail' }));
  }
  aRattacher.sort((x, y) => x.date.localeCompare(y.date));
  // Q3 — encaissements reçus pendant une vacance, attribués au bail le plus proche « à confirmer ».
  const aConfirmer = aConfLignes.map(l => ({ id: l.id, date: l.date, montant: round2(l.montant) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const enAttente = round2(aRattacher.filter(x => x.compte).reduce((t, x) => t + x.montant, 0)
    + aConfirmer.filter(x => x.montant > 0).reduce((t, x) => t + x.montant, 0));
  const der = mois.length ? mois[mois.length - 1] : null;
  const prem = mois.find(m => (m.loyerRetard + m.chargeRetard) > 0.005);
  return {
    // Σ des résidus mensuels ARRONDIS au centime — exactement la règle d'agrégation du maître.
    loyer: round2(mois.reduce((s, m) => s + m.loyerRetard, 0)),
    charge: round2(mois.reduce((s, m) => s + m.chargeRetard, 0)),
    chargesRegul: round2(mois.reduce((s, m) => s + m.aLaRegul, 0)),
    // Q5 — trop-perçu restituable : jamais celui qui viendrait d'un encaissement à rattacher / à confirmer.
    avance: round2(Math.max(0, avanceBrute - enAttente)),
    avanceBrute,
    position: der ? der.position : 0,
    mois, from: yms.length ? from : null, to: yms.length ? to : null,
    debutSuivi, finDu, horsPeriode, aRattacher, aConfirmer, graceLast,
    horsSuivi: avant.horsSuivi,
    suiviPartiel, suiviAbsent: false,
    depuisYm: prem ? prem.ym : null,
    manquesIgnores,
    retenue: { montant: retenue, appliquee: round2(mois.reduce((s, m) => s + m.reglement, 0)) },
    arrondis: mois.filter(m => Math.abs(m.arrondi) > 0.005).map(m => ({ ym: m.ym, montant: m.arrondi })),
    // R0-C (2ᵉ audit 🟠3) — ce qui reste dû de l'antériorité NOTÉE (jamais la dette d'un mois suivi) et ce qui l'a soldée.
    // charges passées à la régularisation : le reste de charges de l'antériorité est déjà dans `aLaRegul` (un seul porteur)
    ouverture: (r.ouvertureReste && (r.ouvertureReste.loyer + (aLaRegul ? 0 : r.ouvertureReste.charge)) > 0.005 && yms[r.ouvertureReste.idx])
      ? { date: debutSuivi, ym: yms[r.ouvertureReste.idx], loyer: r.ouvertureReste.loyer, charge: aLaRegul ? 0 : r.ouvertureReste.charge,
          paiements: (r.imputationsOuverture || []).filter(p => p.date) }
      : null
  };
}

/**
 * FINANCES-SUIVI-V2 — LE SUIVI D'UN LOT : `_computeDetteBail` pour chacun de ses baux (segments
 * d'occupation tronqués C4). Aucune autre imputation : chaque surface lit ce résultat, directement ou à
 * travers `_positionLot` / le maître Finances.
 * @param {Object} input mêmes champs que `_computeDetteBail` (sans `bailDebut`/`fin`), plus :
 *   ouverture  {bailDebut, loyer, charge, avance}|null — l'antériorité notée (un bail)
 *   manques    [{bailDebut, ym, montant, id, ...}] — journal du lot (tombstones ignorés)
 *   retenues   {[bailDebut]: montant} — retenues pour loyer sur le dépôt
 *   chargesRegul {[bailDebut]: true} — baux sortis au solde de tout compte enregistré (charges dues → régularisation)
 * @returns {null|{ref:string, debutSuivi:string|null, baux:Array}}
 */
export function _computeSuiviLot(input) {
  const i = input || {};
  if (!i.ref || !i.ctx) return null;
  const segs = segmentsOccupation(i.ctx.bails);
  const ouvDe = (d) => (i.ouverture && String(i.ouverture.bailDebut || '').slice(0, 10) === d) ? i.ouverture : null;
  const baux = segs.map(s => {
    const r = _computeDetteBail(Object.assign({}, i, {
      bailDebut: s.debut, fin: null, ouverture: ouvDe(s.debut),
      manques: (Array.isArray(i.manques) ? i.manques : []).filter(m => m && !m._deleted && String(m.bailDebut || '').slice(0, 10) === s.debut),
      retenueLoyer: (i.retenues && i.retenues[s.debut]) || 0,
      chargesALaRegul: !!(i.chargesRegul && i.chargesRegul[s.debut])
    }));
    return r ? Object.assign({ debut: s.debut, end: s.end }, r) : null;
  }).filter(Boolean);
  const debutSuivi = i.debutSuivi ? (String(i.debutSuivi).length === 7 ? i.debutSuivi + '-01' : String(i.debutSuivi).slice(0, 10)) : null;
  return { ref: i.ref, debutSuivi, sourceSuivi: i.sourceSuivi || null, baux };
}

/**
 * FINANCES-SUIVI-V2 — LA POSITION D'UN LOT À LA FIN D'UN MOIS : Σ des baux visibles ce mois-là.
 *   - un bail compte de son 1ᵉʳ mois suivi à son dernier ; un bail EN COURS garde sa dernière position
 *     au-delà (mois pas encore exigibles) ;
 *   - un bail TERMINÉ (locataire parti) : sa dette, figée, reste visible jusqu'à la fin de l'année civile
 *     de son départ, puis disparaît (décision Didier Q2, 06/10 : l'année qui compte est celle du mois
 *     regardé) ; son avance éventuelle est « à rendre » (`aRendre`), HORS de la position du lot.
 * @param {{baux:Array}|null} suivi sortie de `_computeSuiviLot`
 * @param {string} ym 'YYYY-MM'
 * @returns {{ym:string, retardLoyer:number, retardCharge:number, retard:number, avance:number, position:number,
 *            aRendre:number, baux:Array<{debut:string, parti:boolean, retard:number, avance:number, ym:string}>}}
 */
export function _positionLot(suivi, ym) {
  const r2 = n => Math.round(n * 100) / 100;
  const out = { ym, retardLoyer: 0, retardCharge: 0, retard: 0, avance: 0, position: 0, aRendre: 0, baux: [] };
  if (!suivi || !Array.isArray(suivi.baux) || !/^\d{4}-\d{2}$/.test(String(ym || ''))) return out;
  for (const b of suivi.baux) {
    if (!b || b.suiviAbsent || !Array.isArray(b.mois) || !b.mois.length) continue;
    if (ym < b.mois[0].ym) continue;
    const parti = !!b.finDu && ym > b.finDu.slice(0, 7);
    if (parti && ym.slice(0, 4) !== b.finDu.slice(0, 4)) continue;
    let m = null;
    for (const x of b.mois) { if (x.ym <= ym) m = x; else break; }
    if (!m) continue;
    out.retardLoyer += m.retardLoyer; out.retardCharge += m.retardCharge;
    if (parti) out.aRendre += m.avance; else out.avance += m.avance;
    out.baux.push({ debut: b.debut, parti, retard: r2(m.retardLoyer + m.retardCharge), avance: r2(m.avance), ym: m.ym });
  }
  out.retardLoyer = r2(out.retardLoyer); out.retardCharge = r2(out.retardCharge);
  out.retard = r2(out.retardLoyer + out.retardCharge);
  out.avance = r2(out.avance); out.aRendre = r2(out.aRendre);
  out.position = r2(out.avance - out.retard);
  return out;
}

/**
 * FINANCES-SUIVI-V2 — LA FRISE 12 MOIS D'UN LOT (bandeau « Tous les loyers », fiche du logement, Accueil),
 * lue dans le suivi. Une case = la position du lot à la FIN du mois (`_positionLot`) :
 *   'avenir' mois pas encore exigible · 'vac' aucun bail suivi · 'avance' · 'ok' à jour ·
 *   'imp' retard au moins égal au dû du mois · 'warn' retard partiel, ou mois payé avec une dette ancienne.
 * `solde` = position au dernier mois exigible de l'année (même chiffre que Finances).
 * @param {{baux:Array}|null} suivi
 * @param {number|string} annee
 * @param {{dernierExigible:string, monthlyFull?:number, curMo?:number}} opts dernierExigible 'YYYY-MM'
 * @returns {{months:Array<{mi:number, cls:string, recu:number, attendu:number, due:number}>, solde:number,
 *            recu:number, attendu:number, curMo:number, monthlyFull:number}}
 */
export function _friseLot(suivi, annee, opts) {
  const o = opts || {};
  const r2 = n => Math.round(n * 100) / 100;
  const y = String(annee);
  const dernier = String(o.dernierExigible || '');
  const months = [];
  let recuAn = 0, attenduAn = 0;
  for (let mi = 1; mi <= 12; mi++) {
    const ym = y + '-' + String(mi).padStart(2, '0');
    let du = 0, recu = 0;
    ((suivi && suivi.baux) || []).forEach(b => {
      const m = (b && Array.isArray(b.mois)) ? b.mois.find(x => x.ym === ym) : null;
      if (m) { du += m.duHC + m.duCH; recu += m.encaisse; }
    });
    du = r2(du); recu = r2(recu);
    recuAn += recu;
    let cls;
    if (ym > dernier) cls = 'avenir';
    else {
      attenduAn += du;
      const p = _positionLot(suivi, ym);
      if (!p.baux.length || (du <= 0.005 && p.retard <= 0.005 && p.avance <= 0.005)) cls = 'vac';
      else if (p.retard <= 0.005) cls = p.avance > 0.005 ? 'avance' : 'ok';   // un retard (même d'un parti) l'emporte sur une avance
      else cls = (du > 0.005 && p.retard >= du - 0.005 && recu <= 0.005) ? 'imp' : 'warn';
    }
    months.push({ mi, cls, recu, attendu: du, due: du });
  }
  const fin = dernier && dernier.slice(0, 4) === y ? dernier : (dernier > y + '-12' ? y + '-12' : null);
  return {
    months, solde: fin ? _positionLot(suivi, fin).position : 0, recu: r2(recuAn), attendu: r2(attenduAn),
    curMo: o.curMo || 0, monthlyFull: Number(o.monthlyFull) || 0
  };
}
