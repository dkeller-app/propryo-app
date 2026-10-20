/**
 * core/irl-calendrier.js — CDC-QUITTANCES-IRL étape 5 : LE CALENDRIER DES RÉVISIONS.
 *
 * Répond à « quand ? » et « est-ce encore possible ? ». Le « combien ? » reste au calcul
 * d'indice existant (`computeIRLRevision`), et le « à partir de quand exactement ? » aux
 * garde-fous Q1 déjà codés (`computeDateEffetIRL` / `clampDateEffet`, loyer-bareme.js) —
 * ce module ne les redouble pas.
 *
 * Décisions encodées :
 *   R1 (IRL-REVISION, remplace D12) — la révision est au 1ᵉʳ du mois : celui du début du
 *         bail s'il commence le 1er, sinon le mois SUIVANT (bail du 15/09 → 01/10). Jamais en
 *         cours de mois, jamais avant le terme de l'année du contrat. Un mois CONVENU au bail
 *         (R10/R11, date commune du bailleur) remplace ce défaut.
 *   R5 — une révision validée à effet futur est PROGRAMMÉE (lue dans le journal irlHistorique).
 *   D13 — la révision est proposée UN MOIS AVANT : elle apparaît le 1ᵉʳ du mois précédent
 *         (effet 01/09 → à partir du 01/08), pas à 30 jours glissants.
 *   D15 — PRESCRIPTION art. 17-1 : au-delà d'un an après la date d'effet prévue, le cycle
 *         est fermé. Il n'est plus proposé ; il bascule en « ⌛ Perdue », informatif. Seul
 *         le CYCLE EN COURS reste révisable, sur le loyer ACTUEL.
 *   D17 — les non-révisables (DPE F/G gelé, bail < 1 an, indice non publié) sont VISIBLES
 *         mais muets : hors du compteur, sans action demandée.
 *
 * Invariants : I8 (prescription), I9 (rappel M-1), I10 (loyer gelé DPE F/G).
 * Pur / testable : aucune lecture de DB, aucun `new Date()` implicite — `todayISO` est injecté.
 * Tests : __tests__/helpers/irl-calendrier.test.js
 */

const _an = (iso) => parseInt(String(iso || '').slice(0, 4), 10);
const _mo = (iso) => parseInt(String(iso || '').slice(5, 7), 10);
const _ok = (iso) => /^\d{4}-\d{2}-\d{2}/.test(String(iso || ''));

/** États possibles d'une révision. Les trois derniers sont MUETS (D17/D15). */
export const ETAT = Object.freeze({
  A_PREPARER: 'a-preparer',   // dans le mois de rappel de l'effet à venir (D13)
  EN_RETARD: 'en-retard',     // effet prévu passé, jamais appliqué, cycle encore ouvert
  FAITE: 'faite',             // le cycle en cours est appliqué (ou renoncé)
  PROGRAMMEE: 'programmee',   // IRL-REVISION R5 : validée, effet encore à venir (« programmée au JJ/MM »)
  RIEN: 'rien',               // rien à faire maintenant
  GEL: 'gel',                 // DPE F ou G — loi Climat (I10)
  TROP_JEUNE: 'trop-jeune',   // bail de moins d'un an
  INDICE_MANQUANT: 'indice-manquant'  // trimestre non publié par l'INSEE
});

/** Les états qui ne demandent RIEN et ne comptent pas dans le badge (D17). */
export const ETATS_MUETS = Object.freeze([ETAT.GEL, ETAT.TROP_JEUNE, ETAT.INDICE_MANQUANT]);

/**
 * IRL-REVISION R1 — LE MOIS DE RÉVISION par défaut d'un bail : celui de son début si le bail
 * commence le 1er, sinon le mois SUIVANT. On ne révise jamais en cours de mois, et on ne
 * révise jamais AVANT le terme de l'année du contrat (art. 17-1 : « au terme de chaque année
 * du contrat ») — bail du 15/09 → révision chaque 01/10, jamais au 01/09 (ex-D12, qui avançait
 * la révision de quinze jours).
 * @returns {number} 1..12 (0 si entrée invalide)
 */
export function moisRevisionParDefaut(debutIso) {
  if (!_ok(debutIso)) return 0;
  const m = _mo(debutIso);
  const j = parseInt(String(debutIso).slice(8, 10), 10);
  return j === 1 ? m : (m % 12) + 1;
}

/** Le mois de révision retenu : celui convenu au bail (1..12) s'il est valide, sinon le défaut. */
export function moisRevision(debutIso, moisConvenu) {
  const m = parseInt(moisConvenu, 10);
  return (m >= 1 && m <= 12) ? m : moisRevisionParDefaut(debutIso);
}

/**
 * La date de révision d'un cycle : le 1er du mois de révision de l'année `annee`.
 * @param {string} debutIso début du bail
 * @param {number} annee année du cycle (= année de la date de révision)
 * @param {number} [moisConvenu] mois de révision convenu au bail (R10/R11), sinon R1
 * @returns {string} 'YYYY-MM-01' ('' si entrée invalide)
 */
export function effetDuCycle(debutIso, annee, moisConvenu) {
  const m = _ok(debutIso) ? moisRevision(debutIso, moisConvenu) : 0;
  const y = parseInt(annee, 10);
  if (!m || m < 1 || m > 12 || !Number.isFinite(y)) return '';
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

/** D13 — le mois de RAPPEL d'un effet : le mois précédent, en entier. @returns 'YYYY-MM' */
export function moisRappel(effetIso) {
  if (!_ok(effetIso)) return '';
  let y = _an(effetIso), m = _mo(effetIso) - 1;
  if (m < 1) { m = 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** Même date, un an plus tard (bornes de prescription — art. 17-1). */
function _plusUnAn(iso) {
  return `${_an(iso) + 1}${String(iso).slice(4, 10)}`;
}

/**
 * Le PREMIER cycle révisable.
 *  - Sans date convenue (R1) : la première date de révision tombant AU MOINS un an après le début
 *    du bail. Bail du 15/09/2023 → 01/10/2024 ; du 01/09/2023 → 01/09/2024 ; du 15/12/2023 → 01/01/2025.
 *  - Avec une date CONVENUE au bail (R10/R11, date commune du bailleur) : sa première occurrence
 *    APRÈS le début du bail, même à moins d'un an (R12 : le bail est signé, on ne bloque pas —
 *    `premierEffetAnticipe` le signale, le garde-fou avertit avant la validation).
 */
export function premierEffet(debutIso, moisConvenu) {
  if (!_ok(debutIso)) return '';
  const debut = String(debutIso).slice(0, 10);
  const convenu = parseInt(moisConvenu, 10) >= 1 && parseInt(moisConvenu, 10) <= 12;
  const borne = convenu ? null : _plusUnAn(debut);
  for (let y = _an(debut); y <= _an(debut) + 2; y++) {
    const e = effetDuCycle(debutIso, y, moisConvenu);
    if (!e) continue;
    if (convenu ? e > debut : e >= borne) return e;
  }
  return '';
}

/**
 * IRL-REVISION R12 — la première révision tombe-t-elle MOINS d'un an après le début du bail
 * (date convenue) ? Rend cette date, sinon ''. Informatif : jamais un verrou.
 */
export function premierEffetAnticipe(debutIso, moisConvenu) {
  if (!_ok(debutIso)) return '';
  const premier = premierEffet(debutIso, moisConvenu);
  return (premier && premier < _plusUnAn(String(debutIso).slice(0, 10))) ? premier : '';
}

/**
 * L'année de l'indice à retenir pour une révision datée `effetIso`, sur le trimestre `T` du bail :
 * le DERNIER indice de ce trimestre PUBLIÉ à la date de révision (INSEE, « Réviser un loyer
 * d'habitation » : un bail signé le 1er mars applique chaque année l'IRL du 4e trimestre de
 * l'année précédente). Publications au JO vers le milieu du mois suivant le trimestre :
 * T1 → avril, T2 → juillet, T3 → octobre, T4 → janvier N+1. Au 1er d'un mois, l'indice est
 * donc disponible à partir de mai (T1), août (T2), novembre (T3), février (T4 de N-1).
 * @returns {number|null}
 */
export function anneeIndice(T, effetIso) {
  const t = parseInt(T, 10);
  if (!_ok(effetIso) || !(t >= 1 && t <= 4)) return null;
  const y = _an(effetIso), m = _mo(effetIso);
  if (t === 4) return m >= 2 ? y - 1 : y - 2;
  const dispo = { 1: 5, 2: 8, 3: 11 }[t];
  return m >= dispo ? y : y - 1;
}

/**
 * Maquette 7b (validée 25/09) — le trimestre IRL CONSEILLÉ pour un mois de révision : celui dont
 * l'indice est le plus récent au 1er de ce mois (publication mi-avril/juillet/octobre/janvier).
 * Février–avril → T4 · mai–juillet → T1 · août–octobre → T2 · novembre–janvier → T3.
 * Une PROPOSITION : le trimestre reste un choix du contrat (art. 17-1).
 * @returns {number|null}
 */
export function trimestreConseille(mois) {
  const m = parseInt(mois, 10);
  if (!(m >= 1 && m <= 12)) return null;
  return [3, 4, 4, 4, 1, 1, 1, 2, 2, 2, 3, 3][m - 1];
}

/**
 * L'indice de BASE conseillé : le trimestre conseillé, dans sa dernière année PUBLIÉE à la date de
 * signature (INSEE : « le dernier indice publié à la date de signature »). 'T3 2024' ; '' si invalide.
 */
export function indiceBaseConseille(signatureIso, moisRev) {
  const t = trimestreConseille(moisRev);
  const a = t ? anneeIndice(t, signatureIso) : null;
  return (t && a != null) ? `T${t} ${a}` : '';
}

/**
 * Audit C1/C2 — L'INDICE DE RÉFÉRENCE du bail : l'année de l'indice « en vigueur » de sa dernière
 * révision (appliquée, programmée ou renoncée — une renonciation consomme aussi son année), à
 * défaut celle de l'indice de base du bail (`bail.irl`, ex. « T2 2023 »). Les entrées antérieures
 * au début du bail (bail précédent du même lot) sont ignorées.
 * @param {{journal?:Array, debut?:string, bailIrl?:string}} input
 * @returns {number|null}
 */
export function anneeReference(input) {
  const i = input || {};
  const debut = String(i.debut || '').slice(0, 10);
  let best = null, bestK = '';
  for (const e of (Array.isArray(i.journal) ? i.journal : [])) {
    if (!e || e._deleted) continue;
    const k = String(e.dateRevision || e.date || '').slice(0, 10);
    if (!_ok(k) || (debut && k < debut)) continue;
    const m = String(e.irlVigueur || '').match(/^T[1-4]\s+(\d{4})$/);
    if (m && k >= bestK) { bestK = k; best = parseInt(m[1], 10); }
  }
  if (best != null) return best;
  const b = String(i.bailIrl || '').match(/(\d{4})/);
  return b ? parseInt(b[1], 10) : null;
}

/**
 * L'indice d'une révision : le dernier publié à la date de révision (`anneeIndice`), et JAMAIS une
 * année déjà prise en compte par le loyer (`anneeReference`). Si aucun indice plus récent que la
 * référence n'est publié à cette date, il n'y a RIEN à réviser pour ce cycle (`dejaIndexe`) :
 * appliquer la même variation une deuxième fois serait une IRL composée.
 *   · audit C1 — bail du 1er mars indexé T4, cycle 2025 appliqué EN RETARD avec T4 2025 : au
 *     01/03/2026 le dernier T4 publié est encore T4 2025 → rien à réviser (et pas T4 2025 deux fois).
 *   · audit C2 — bail signé en septembre sur T2 2026, date commune en octobre : au 01/10/2026
 *     aucun T2 plus récent → la révision anticipée n'a rien à appliquer.
 * @returns {{annee:number|null, dejaIndexe:boolean}}
 */
export function indiceDuCycle(T, effetIso, anneeRef, refVientDuBail) {
  const n = anneeIndice(T, effetIso);
  if (n == null) return { annee: null, dejaIndexe: false, rienAReviser: false };
  const ref = parseInt(anneeRef, 10);
  const deja = Number.isFinite(ref) && n <= ref;
  // Décision Didier 25/09 (source : ANIL — « l'indice du même trimestre CONNU À LA DATE DE
  // RÉVISION » ; exemple ANIL d'une demande tardive : même loyer révisé, seule la date d'effet
  // change). L'indice est celui connu à la date de révision du cycle, jamais un indice publié plus
  // tard. S'il est déjà dans le loyer (révision antérieure faite avec un indice publié après sa
  // date), il n'y a RIEN À RÉVISER pour ce cycle ; le calendrier redevient normal au suivant.
  // EXCEPTION (audit passe 2 N1) : la référence est l'indice de BASE du bail, choisi par l'ancienne
  // table de publication (publié quelques jours après la signature) — on attend alors le même
  // trimestre de l'année suivante (ref + 1), faute de quoi le bail perdrait sa 1re révision.
  if (!deja) return { annee: n, dejaIndexe: false, rienAReviser: false };
  return refVientDuBail
    ? { annee: ref + 1, dejaIndexe: true, rienAReviser: false }
    : { annee: n, dejaIndexe: true, rienAReviser: true };
}

/**
 * Le cycle EN COURS : le dernier dont la date de révision est déjà passée (ou du jour).
 * `null` tant que le premier cycle n'est pas atteint.
 */
export function cycleEnCours(debutIso, todayISO, moisConvenu) {
  const p = premierEffet(debutIso, moisConvenu);
  if (!p || !_ok(todayISO) || todayISO < p) return null;
  let annee = _an(todayISO);
  if (todayISO < effetDuCycle(debutIso, annee, moisConvenu)) annee -= 1;
  const effetIso = effetDuCycle(debutIso, annee, moisConvenu);
  return { annee, effetIso, rappelYm: moisRappel(effetIso) };
}

/** Le cycle SUIVANT (celui dont on prépare la lettre pendant son mois de rappel). */
export function cycleSuivant(debutIso, todayISO, moisConvenu) {
  const cur = cycleEnCours(debutIso, todayISO, moisConvenu);
  const annee = cur ? cur.annee + 1 : _an(premierEffet(debutIso, moisConvenu));
  const effetIso = effetDuCycle(debutIso, annee, moisConvenu);
  return effetIso ? { annee, effetIso, rappelYm: moisRappel(effetIso) } : null;
}

/**
 * IRL-REVISION R5 — les marques de cycle TRAITÉ : `irlDerniereApplication` + la clé de cycle
 * (`dateRevision`) de chaque entrée vivante du journal — appliquée, programmée (effet à venir)
 * ou renoncée. Avant : seul `irlDerniereApplication` comptait, et il n'est posé qu'une fois
 * l'effet atteint → une révision validée pour le mois prochain laissait la ligne « en retard ».
 * Audit I3 — une marque ANTÉRIEURE au début du bail appartient au bail précédent du même lot
 * (relocation) : elle ne vaut rien pour celui-ci.
 */
function _marques(i, debut, moisConvenu) {
  const out = [];
  const garde = (k) => _ok(k) && (!debut || k >= debut);
  let d0 = String(i.derniereApplicationIso || '').slice(0, 10);
  // Audit passe 2 N3 — une ANCIENNE marque peut être la date d'EFFET d'une révision (repli des
  // versions précédentes) : si elle n'est la clé d'aucune entrée mais la date d'effet de l'une,
  // c'est la clé de cycle de cette entrée qui vaut.
  const jr = Array.isArray(i.journal) ? i.journal.filter((e) => e && !e._deleted) : [];
  // Passe 3 N9 — jamais si d0 EST une date de cycle du bail : c'est alors la marque de CE cycle
  // (entrée absente du journal), la rattacher à un autre ferait réappliquer sa variation.
  const _estCycle = _ok(d0) && debut && effetDuCycle(debut, _an(d0), moisConvenu) === d0;
  if (_ok(d0) && !_estCycle && !jr.some((e) => String(e.dateRevision || '').slice(0, 10) === d0)) {
    const e = jr.find((x) => String(x.dateEffet || x.dateApplication || '').slice(0, 10) === d0 && _ok(String(x.dateRevision || '').slice(0, 10)));
    if (e) d0 = String(e.dateRevision).slice(0, 10);
  }
  if (garde(d0)) out.push(d0);
  for (const e of (Array.isArray(i.journal) ? i.journal : [])) {
    if (!e || e._deleted) continue;
    const k = String(e.dateRevision || '').slice(0, 10);
    if (garde(k)) out.push(k);
  }
  return out;
}

/**
 * Un cycle est traité si une marque tombe DANS SA FENÊTRE : après la date de révision du cycle
 * précédent, au plus tard à la sienne. Fenêtre et non égalité : les clés déjà enregistrées portent
 * d'anciens formats (jour anniversaire, 1er du mois de l'anniversaire — ex-D12), toujours
 * ANTÉRIEURS OU ÉGAUX à la date du cycle qu'elles désignent : un bail du 15/09 marqué
 * « 2025-09-01 » a bien fait son cycle 2025, dont la date est désormais le 01/10/2025.
 * Audit I6 — borne haute : une marque postérieure (date d'effet d'une révision tardive posée en
 * repli) ne « fait » plus le cycle suivant à sa place.
 */
function _traite(marques, debut, effetIso, moisConvenu, depuis) {
  if (!effetIso) return false;
  const prev = effetDuCycle(debut, _an(effetIso) - 1, moisConvenu);
  // Audit passe 2 N5 — la date de révision a CHANGÉ (bail en cours, mois convenu modifié) : pour un
  // cycle de la nouvelle série, une marque d'avant le changement appartient à l'ancienne série et
  // ne le « fait » pas (sinon une variation est sautée). La double application, elle, est écartée
  // par l'indice de référence (anneeReference / indiceDuCycle).
  const dp = _ok(depuis) ? String(depuis).slice(0, 10) : '';
  return marques.some((d) => d > prev && d <= effetIso && !(dp && effetIso > dp && d < dp));
}

/**
 * Pour la PRESCRIPTION seulement : une marque postérieure vaut preuve que les cycles d'avant ont
 * été réglés (appliqués ou renoncés). Données importées avec la seule dernière application : on
 * n'affiche jamais « IRL non appliquée » sur un cycle dont on ne sait rien.
 */
function _traiteOuDepasse(marques, debut, effetIso, moisConvenu) {
  if (!effetIso) return false;
  const prev = effetDuCycle(debut, _an(effetIso) - 1, moisConvenu);
  return marques.some((d) => d > prev);
}

/**
 * Audit I1 — la révision PROGRAMMÉE du lot, quel que soit son cycle : validée, effet encore à
 * venir. Tant qu'elle existe, c'est ELLE que le lot affiche (annulable, non revalidable) — sinon
 * le rappel du cycle suivant la masquait et laissait valider une 2ᵉ révision par-dessus.
 */
function _programmeeDuLot(i, debut, today) {
  let best = null;
  for (const e of (Array.isArray(i.journal) ? i.journal : [])) {
    if (!e || e._deleted || e.action === 'renonciation' || !e.pendingApply) continue;
    const k = String(e.dateRevision || '').slice(0, 10);
    const eff = String(e.dateEffet || e.dateApplication || '').slice(0, 10);
    if (!_ok(k) || !_ok(eff) || (debut && k < debut) || eff <= today) continue;
    if (!best || k > best.cycleIso || (k === best.cycleIso && eff > best.effetIso)) best = { cycleIso: k, effetIso: eff };
  }
  return best;
}

/**
 * L'ÉTAT de la révision d'un lot à une date donnée — le cœur du bloc « Révisions ».
 *
 * @param {Object} input
 *   @param {string} input.debut         début du bail 'YYYY-MM-DD'
 *   @param {string} input.todayISO      date du jour 'YYYY-MM-DD'
 *   @param {number} [input.moisRevision]  mois de révision convenu au bail (1..12), sinon R1
 *   @param {string} [input.moisRevisionDepuis]  date à laquelle ce mois a été changé (bail en cours)
 *   @param {string} [input.derniereApplicationIso]  `log.irlDerniereApplication`
 *   @param {Array}  [input.journal]     entrées `DB.irlHistorique` DE CE LOT
 *   @param {boolean} [input.gel]        DPE F ou G (I10) — décidé par l'appelant
 *   @param {boolean} [input.indiceManquant]  trimestre non publié (D17)
 * @returns {{etat:string, muet:boolean, cycleAnnee:number|null, effetPrevuIso:string,
 *            rappelYm:string, joursAvantEffet:number|null, premiereEffetIso:string,
 *            premiereAnticipeeIso:string, programmee:{cycleIso:string, effetIso:string}|null,
 *            perdue:{annee:number, effetIso:string}|null}}
 */
export function etatRevision(input) {
  const i = input || {};
  const debut = String(i.debut || '').slice(0, 10);
  const today = String(i.todayISO || '').slice(0, 10);
  const mc = i.moisRevision;
  const base = {
    etat: ETAT.RIEN, muet: false, cycleAnnee: null, effetPrevuIso: '', rappelYm: '',
    joursAvantEffet: null, premiereEffetIso: premierEffet(debut, mc),
    premiereAnticipeeIso: premierEffetAnticipe(debut, mc), programmee: null, perdue: null,
    conflitSuivant: null
  };
  if (!_ok(debut) || !_ok(today)) return base;

  // I10 — le gel DPE F/G prime sur tout : aucun calendrier, aucune action.
  if (i.gel) return Object.assign(base, { etat: ETAT.GEL, muet: true });

  const marques = _marques(i, debut, mc);
  // Audit passe 4 (C2/I1) — un cycle SANS OBJET (règle ANIL : l'indice connu à sa date est déjà dans
  // le loyer) compte comme TRAITÉ : il n'est ni « en retard » ni « perdu », et il ne masque plus le
  // rappel du cycle suivant. Le prédicat vient de l'appelant (il connaît trimestre et référence).
  const sansObjet = (effetIso) => typeof i.sansObjet === 'function' && !!effetIso && !!i.sansObjet(effetIso);
  const fait = (effetIso) => _traite(marques, debut, effetIso, mc, i.moisRevisionDepuis) || sansObjet(effetIso);

  // R5 / audit I1 — une révision validée dont l'effet est à venir PRIME sur tout le reste.
  const prog = _programmeeDuLot(i, debut, today);
  if (prog) {
    return Object.assign(base, {
      etat: ETAT.PROGRAMMEE, cycleAnnee: _an(prog.cycleIso), effetPrevuIso: prog.cycleIso,
      rappelYm: moisRappel(prog.cycleIso), programmee: prog,
      joursAvantEffet: _joursEntre(today, prog.effetIso)
    });
  }
  // Un cycle traité (et plus rien de programmé) : FAIT.
  // Audit passe 5 I-1 — le drapeau « sans objet » est posé ICI, pour TOUTES les sorties « traité »
  // (cycle en cours, premier cycle, cycle suivant dans son mois de rappel).
  const etatTraite = (cycle, extra) => Object.assign(base, {
    etat: ETAT.FAITE, cycleAnnee: cycle.annee,
    effetPrevuIso: cycle.effetIso, rappelYm: cycle.rappelYm,
    joursAvantEffet: _joursEntre(today, cycle.effetIso),
    sansObjet: sansObjet(cycle.effetIso) && !_traite(marques, debut, cycle.effetIso, mc, i.moisRevisionDepuis)
  }, extra || {});

  const suivant = cycleSuivant(debut, today, mc);
  const cur = cycleEnCours(debut, today, mc);

  // Bail encore avant son premier cycle.
  if (!cur) {
    const premier = base.premiereEffetIso;
    const rappelPremier = moisRappel(premier);
    const premierCycle = { annee: _an(premier), effetIso: premier, rappelYm: rappelPremier };
    // Déjà traitée (renoncée à l'avance, par ex.) : plus « à préparer ».
    if (premier && fait(premier)) return etatTraite(premierCycle);
    // D13/I9 — le rappel M-1 vaut AUSSI pour la toute première révision.
    if (rappelPremier && today.slice(0, 7) === rappelPremier && !i.indiceManquant) {
      return Object.assign(base, {
        etat: ETAT.A_PREPARER, cycleAnnee: _an(premier),
        effetPrevuIso: premier, rappelYm: rappelPremier,
        joursAvantEffet: _joursEntre(today, premier)
      });
    }
    // D17 — sinon : visible, muet, avec sa première échéance.
    return Object.assign(base, {
      etat: (rappelPremier && today.slice(0, 7) === rappelPremier && i.indiceManquant)
        ? ETAT.INDICE_MANQUANT : ETAT.TROP_JEUNE,
      muet: true,
      effetPrevuIso: premier,
      rappelYm: rappelPremier,
      joursAvantEffet: _joursEntre(today, premier)
    });
  }

  const curFait = fait(cur.effetIso);

  // D15 — PRESCRIPTION : le cycle PRÉCÉDENT jamais réclamé est présumé abandonné
  // (plus d'un an après sa date de révision). Informatif, jamais proposé (I8).
  let perdue = null;
  const precedentIso = effetDuCycle(debut, cur.annee - 1, mc);
  if (precedentIso && precedentIso >= base.premiereEffetIso
      && !_traiteOuDepasse(marques, debut, precedentIso, mc) && !sansObjet(precedentIso)
      && today >= _plusUnAn(precedentIso)) {
    perdue = { annee: cur.annee - 1, effetIso: precedentIso };
  }

  // R3 — le cycle en cours n'a pas été réclamé : il reste ouvert (moins d'un an), proposable.
  // La date d'effet réelle est recalée par les garde-fous R2 (jamais rétroactive).
  if (!curFait) {
    if (i.indiceManquant) {
      return Object.assign(base, {
        etat: ETAT.INDICE_MANQUANT, muet: true, cycleAnnee: cur.annee,
        effetPrevuIso: cur.effetIso, rappelYm: cur.rappelYm, perdue
      });
    }
    // Maquette 5 (option C, validée 25/09) — la révision de l'année écoulée n'est toujours pas faite
    // et on est dans le mois de rappel de la SUIVANTE : deux hausses tomberaient en quelques jours
    // (« une seule fois par an »). Signalé ; l'écran fait choisir, rien n'est bloqué.
    const conflit = (suivant && today.slice(0, 7) === suivant.rappelYm) ? { effetIso: suivant.effetIso } : null;
    return Object.assign(base, {
      etat: ETAT.EN_RETARD, cycleAnnee: cur.annee, effetPrevuIso: cur.effetIso,
      rappelYm: cur.rappelYm, joursAvantEffet: _joursEntre(today, cur.effetIso), perdue,
      conflitSuivant: conflit
    });
  }

  // Le cycle en cours est traité. Reste-t-il le RAPPEL du cycle suivant (D13/I9) ?
  if (suivant && today.slice(0, 7) === suivant.rappelYm) {
    if (fait(suivant.effetIso)) return etatTraite(suivant, { perdue });
    if (i.indiceManquant) {
      return Object.assign(base, {
        etat: ETAT.INDICE_MANQUANT, muet: true, cycleAnnee: suivant.annee,
        effetPrevuIso: suivant.effetIso, rappelYm: suivant.rappelYm, perdue
      });
    }
    return Object.assign(base, {
      etat: ETAT.A_PREPARER, cycleAnnee: suivant.annee, effetPrevuIso: suivant.effetIso,
      rappelYm: suivant.rappelYm, joursAvantEffet: _joursEntre(today, suivant.effetIso), perdue
    });
  }

  const r = etatTraite(cur, { perdue });
  // FAITE : le compte à rebours porte sur le cycle suivant (comportement historique).
  if (r.etat === ETAT.FAITE) r.joursAvantEffet = suivant ? _joursEntre(today, suivant.effetIso) : null;
  return r;
}

function _joursEntre(aIso, bIso) {
  if (!_ok(aIso) || !_ok(bIso)) return null;
  const a = new Date(aIso + 'T00:00:00'), b = new Date(bIso + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * D16 — LE CALENDRIER type Gantt : douze mois glissants à partir du mois courant,
 * une ligne par lot. Pur : l'appelant fournit déjà l'état de chaque lot.
 *
 * @param {Array<{ref:string, libelle?:string, etat:Object}>} lots
 *        `etat` = sortie de etatRevision
 * @param {string} todayISO
 * @returns {{mois:Array<{ym:string, mois:number, annee:number, courant:boolean}>,
 *            lignes:Array<{ref:string, libelle:string, cells:Array<{ym:string, kind:string, label:string}>}>}}
 *        kind ∈ '' | 'rappel' | 'effet' | 'faite' | 'gel'
 *        Un effet passé est PROJETÉ sur sa prochaine occurrence annuelle : le calendrier
 *        montre quand la prochaine échéance retombe, pas une colonne vide.
 */
export function ganttRevisions(lots, todayISO) {
  const today = String(todayISO || '').slice(0, 10);
  const mois = [];
  if (_ok(today)) {
    let y = _an(today), m = _mo(today);
    for (let k = 0; k < 12; k++) {
      mois.push({ ym: `${y}-${String(m).padStart(2, '0')}`, mois: m, annee: y, courant: k === 0 });
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  const fenetre = new Set(mois.map((m) => m.ym));
  // Un effet PASSÉ (cycle en retard, lot gelé, indice manquant) ne tomberait dans aucune
  // colonne : on le PROJETTE sur sa prochaine occurrence annuelle, qui est bien dans la
  // fenêtre — le calendrier montre « quand ça retombe », pas « quand ça aurait dû ».
  const projete = (ym) => {
    if (!ym) return '';
    let y = parseInt(ym.slice(0, 4), 10);
    const mm = ym.slice(4);
    for (let k = 0; k < 12; k++) { if (fenetre.has(y + mm)) return y + mm; y++; }
    return '';
  };
  const lignes = (lots || []).map((l) => {
    const e = (l && l.etat) || {};
    // R5 — une révision PROGRAMMÉE tombe au mois où elle PREND EFFET (01/10 si validée le 24/09
    // pour un cycle du 01/09), pas au mois de son cycle : c'est là que le loyer change.
    const effSrc = (e.etat === ETAT.PROGRAMMEE && e.programmee && e.programmee.effetIso) ? e.programmee.effetIso : e.effetPrevuIso;
    const effetYm = projete(String(effSrc || '').slice(0, 7));
    const rappelYm = effetYm ? moisRappel(effetYm + '-01') : '';
    // D17 — un lot non révisable (gelé, bail trop jeune, indice manquant) n'a ni bande de
    // rappel ni pavé d'effet : une seule case grise, qui dit pourquoi.
    const muet = !!e.muet;
    const cells = mois.map((mm) => {
      let kind = '', label = '';
      if (muet) {
        if (effetYm && mm.ym === effetYm) {
          kind = 'gel';
          label = e.etat === ETAT.GEL ? 'loyer gelé' : (e.etat === ETAT.TROP_JEUNE ? 'bail < 1 an' : 'non révisable');
        }
      } else if (effetYm) {
        if (mm.ym === effetYm) {
          kind = (e.etat === ETAT.FAITE || e.etat === ETAT.PROGRAMMEE) ? 'faite' : 'effet';
          label = '01/' + effetYm.slice(5, 7);
        } else if (mm.ym === rappelYm) { kind = 'rappel'; label = 'rappel'; }
      }
      return { ym: mm.ym, kind, label };
    });
    return { ref: (l && l.ref) || '', libelle: (l && l.libelle) || '', cells, etat: e.etat };
  });
  return { mois, lignes };
}

/**
 * V3/V4 (CDC-LOYERS-DESIGN) — LE RUBAN DES RÉVISIONS : douze tuiles, un chiffre par mois.
 *
 * Il REMPLACE le Gantt « 1 lot × 12 mois » (33 lignes sur le parc réel, l'un des postes
 * qui faisaient monter l'écran Loyers à 3 691 px). Aucun calendrier n'est recalculé :
 * ce ruban n'est qu'une AGRÉGATION en colonnes de `ganttRevisions` — même fenêtre, mêmes
 * projections, mêmes états. Le détail par mois (quels lots) reste atteignable au clic, ce
 * que le Gantt donnait en occupant douze fois plus de place.
 *
 * @param {{mois:Array, lignes:Array}} gantt sortie de ganttRevisions
 * @returns {{mois:Array<{ym:string, mois:number, annee:number, courant:boolean,
 *            nbEffet:number, nbFaite:number, nbGel:number, nbRappel:number,
 *            effet:Array, faite:Array, gel:Array}>, totalEffet:number, totalGel:number}}
 */
export function rubanRevisions(gantt) {
  const g = gantt || { mois: [], lignes: [] };
  const par = new Map();
  (g.mois || []).forEach((m) => par.set(m.ym, {
    ym: m.ym, mois: m.mois, annee: m.annee, courant: !!m.courant,
    nbEffet: 0, nbFaite: 0, nbGel: 0, nbRappel: 0, effet: [], faite: [], gel: []
  }));
  for (const l of (g.lignes || [])) {
    for (const c of (l.cells || [])) {
      const b = par.get(c.ym);
      if (!b || !c.kind) continue;
      const info = { ref: l.ref, libelle: l.libelle, etat: l.etat, label: c.label };
      if (c.kind === 'effet') { b.nbEffet++; b.effet.push(info); }
      else if (c.kind === 'faite') { b.nbFaite++; b.faite.push(info); }
      else if (c.kind === 'gel') { b.nbGel++; b.gel.push(info); }
      else if (c.kind === 'rappel') { b.nbRappel++; }
    }
  }
  const mois = [...par.values()];
  return {
    mois,
    totalEffet: mois.reduce((s, m) => s + m.nbEffet, 0),
    totalGel: mois.reduce((s, m) => s + m.nbGel, 0)
  };
}
