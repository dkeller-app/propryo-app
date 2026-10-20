/**
 * core/regime-lot.js — Résout le régime fiscal d'un LOT pour une année donnée.
 *
 * V3-REFONTE-LOYERS · FEAT-REGIMES-FISCAUX · brique P0 (correctness 2044).
 *
 * Pourquoi : la déclaration 2044 ne concerne QUE la location NUE (revenus fonciers,
 * régime réel). Un lot loué MEUBLÉ relève du BIC (LMNP, liasse 2031) — déclaration
 * séparée. Or le moteur 2044 agrège les mouvements par `qui = ref logement` sans
 * regarder la nature du bail → un loyer meublé tombait à tort dans le résultat foncier.
 *
 * Ce module fournit la décision PURE (testable) : « ce lot relève-t-il du 2044 cette
 * année ? », à partir du bail courant + de l'historique des baux + du LOGEMENT. Les
 * builders 2044 (index.html) l'utilisent pour filtrer `refs` (scope mouvements) et
 * `nbLocaux` (forfait 222), et pour signaler les lots exclus / mixtes / à qualifier.
 *
 * Source de la nature meublé/nu — MULTI-SOURCE avec fallback (audit code-reviewer) :
 *   1. `bail.type` ∈ { nu, meuble, etudiant, mobilite, garage, autre } — champ canonique
 *      BAIL-TYPES (v15.191), mais renseigné UNIQUEMENT sur les baux saisis depuis cette
 *      version (sur les vraies données : 2 baux sur 24).
 *   2. `logement.typeUsage` ∈ { habitation-nu, habitation-meuble, etudiant, mobilite,
 *      garage, local-pro, autre } — LA source fiable des données réelles (les
 *      baux_historique ne portent que { ref, debut, fin }, sans type ni usage).
 *   3. `bail.typeContrat` meublé/etudiant/mobilite — dernier filet (très anciens baux).
 *      NB : `typeContrat` sert aujourd'hui à initial/repris/renouvellement, donc ce test
 *      ne matche que d'éventuelles valeurs meublées legacy ; sinon inoffensif.
 *   4. défaut « nu » — jamais d'exclusion silencieuse.
 *
 * Périmètre P0 (niveau LOT, borné) :
 *   - nu / garage / type absent → foncier (2044).
 *   - meublé (meuble | etudiant | mobilite) → EXCLU du 2044.
 *   - « autre » / local-pro → reste foncier MAIS flagué « régime à qualifier ».
 *   - MIXTE (nu une partie de l'année, meublé l'autre) → inclus mais FLAGUÉ « part
 *     meublée à retirer » (on ne perd pas la part nue). La justesse 100 % du mixte
 *     (découpage par mouvement + ventilation immeuble) = P2.
 */

/** Natures de bail (champ bail.type) relevant du meublé (BIC) → hors champ 2044 foncier. */
export const MEUBLE_TYPES = ['meuble', 'etudiant', 'mobilite'];

/** typeUsage du logement relevant du meublé (BIC). Source fiable des données historiques. */
export const MEUBLE_USAGES = ['habitation-meuble', 'etudiant', 'mobilite'];

/** typeUsage / type indéterminés → restent au foncier par défaut mais SIGNALÉS « à qualifier ». */
export const INDETERMINE_USAGES = ['local-pro', 'autre'];

/**
 * Fin d'OCCUPATION d'un bail ('' = ouvert). L'app injecte SA règle (`finOccupation` =
 * `_bailFinOccupation` d'index.html : un bail nu/meublé en cours se reconduit tacitement, sa fin
 * contractuelle ne le termine pas — sinon un meublé de plus d'un an sortait du « meublé » et
 * retombait au foncier). Repli hors app : finEffective, sinon fin.
 */
function _finDe(bail, clos, finOccupation) {
  if (typeof finOccupation === 'function') return finOccupation(bail, clos) || '';
  return bail.finEffective || bail.fin || '';
}

/** Un bail chevauche-t-il l'année [yearStart, yearEnd] ? (dates ISO, comparaison string) */
function _bailOverlapsYear(bail, yearStart, yearEnd, clos, finOccupation) {
  if (!bail || bail._deleted) return false;   // un tombstone de bail clôturé ne loue rien
  const debut = bail.debut || '';
  const fin = _finDe(bail, clos, finOccupation);
  if (debut && debut > yearEnd) return false; // commence après l'année
  if (fin && fin < yearStart) return false;    // terminé avant l'année
  return true; // (un bail courant sans dates = réputé actif)
}

/**
 * Classe un bail d'un lot : 'meuble' | 'autre' | 'nu'. Multi-source avec fallback.
 * @param {Object?} bail     - bail (courant ou historique).
 * @param {Object?} logement - le lot (porte `typeUsage`).
 */
function _classifyBail(bail, logement) {
  const t = bail && bail.type;
  if (t) {
    if (MEUBLE_TYPES.includes(t)) return 'meuble';
    if (t === 'autre') return 'autre';
    return 'nu'; // nu, garage
  }
  // Pas de bail.type → fallback sur l'usage du logement (source réelle).
  const u = logement && logement.typeUsage;
  if (u) {
    if (MEUBLE_USAGES.includes(u)) return 'meuble';
    if (INDETERMINE_USAGES.includes(u)) return 'autre';
    return 'nu'; // habitation-nu, garage
  }
  // Dernier filet : ancien champ typeContrat (baux meublés legacy).
  if (bail && MEUBLE_TYPES.includes(bail.typeContrat)) return 'meuble';
  return 'nu'; // défaut nu — jamais d'exclusion silencieuse
}

const _FLAG_MIXTE = (year) => ({ level: 'warn', msg: `Loué meublé une partie de ${year} — la part meublée relève du BIC (hors 2044), à retirer.` });
const _FLAG_AUTRE = () => ({ level: 'warn', msg: `Régime à qualifier (usage « autre » / local professionnel) — vérifier nu (2044) vs BIC.` });

/**
 * Statut foncier (2044) d'un lot pour une année.
 *
 * @param {Object}  args
 * @param {Object?} args.currentBail - DB.baux[ref] (bail courant du lot), ou null.
 * @param {Array}   args.histoBails  - baux historiques de CE lot (déjà filtrés), ou [].
 * @param {Object?} args.logement    - le lot { ref, typeUsage, ... } (fallback nature).
 * @param {number|string} args.year  - année déclarée (ex. 2026).
 * @returns {{ fonciere: boolean, mode: 'nu'|'meuble'|'mixte'|'autre'|'vacant',
 *             flag: null | { level: 'warn', msg: string } }}
 */
export function lotRegimeForYear({ currentBail = null, histoBails = [], logement = null, year, finOccupation = null } = {}) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const overlapping = [
    ...(_bailOverlapsYear(currentBail, yearStart, yearEnd, false, finOccupation) ? [currentBail] : []),
    ...(histoBails || []).filter(b => _bailOverlapsYear(b, yearStart, yearEnd, true, finOccupation)),
  ];

  // Aucun bail sur l'année (vacant) : se rabattre sur la nature connue du logement —
  // un lot meublé vacant ne devient pas foncier ; un local-pro vacant reste à qualifier.
  if (overlapping.length === 0) {
    const cls = _classifyBail(null, logement);
    if (cls === 'meuble') return { fonciere: false, mode: 'meuble', flag: null };
    if (cls === 'autre') return { fonciere: true, mode: 'autre', flag: _FLAG_AUTRE() };
    return { fonciere: true, mode: 'vacant', flag: null };
  }

  const classes = overlapping.map(b => _classifyBail(b, logement));
  const hasMeuble = classes.includes('meuble');
  const hasFoncier = classes.some(c => c === 'nu' || c === 'autre'); // nu/garage/autre restent au foncier
  const hasAutre = classes.includes('autre');

  if (hasMeuble && hasFoncier) {
    return { fonciere: true, mode: 'mixte', flag: _FLAG_MIXTE(year) };
  }
  if (hasMeuble) {
    return { fonciere: false, mode: 'meuble', flag: null };
  }
  if (hasAutre) {
    return { fonciere: true, mode: 'autre', flag: _FLAG_AUTRE() };
  }
  return { fonciere: true, mode: 'nu', flag: null };
}

/**
 * Répartit un scope de logements entre ce qui relève du 2044 (foncier) et ce qui en
 * est exclu (meublé/BIC), en signalant les cas mixtes / à qualifier. Orchestre
 * `lotRegimeForYear` sur chaque lot. Pur : on lui passe les collections de baux.
 *
 * @param {Array}  logements - lots du scope (objets { ref, typeUsage, ... }).
 * @param {Object} ctx
 * @param {Object} ctx.baux       - map ref → bail courant (ex. DB.baux).
 * @param {Array}  ctx.bauxHisto  - historique des baux (ex. DB.baux_historique). Chaque
 *                                  entrée s'identifie au lot par `.ref` (forme réelle)
 *                                  ou `.logement` (forme synthétique) — on accepte les deux.
 * @param {number|string} ctx.year - année déclarée.
 * @param {Function} [ctx.finOccupation] - règle de fin d'occupation de l'app (bail, clos) → ISO | ''.
 * @returns {{ fonciereRefs: string[], exclus: Array<{ref,mode}>, flagues: Array<{ref,mode,msg}> }}
 */
export function splitFonciereLots(logements, { baux = {}, bauxHisto = [], year, finOccupation = null } = {}) {
  const fonciereRefs = [];
  const exclus = [];
  const flagues = [];
  for (const l of (logements || [])) {
    const r = lotRegimeForYear({
      currentBail: baux[l.ref] || null,
      histoBails: (bauxHisto || []).filter(b => (b.logement || b.ref) === l.ref),
      logement: l,
      year,
      finOccupation
    });
    if (r.fonciere) fonciereRefs.push(l.ref);
    else exclus.push({ ref: l.ref, mode: r.mode });
    if (r.flag) flagues.push({ ref: l.ref, mode: r.mode, msg: r.flag.msg });
  }
  return { fonciereRefs, exclus, flagues };
}
