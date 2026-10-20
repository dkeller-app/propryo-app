/**
 * core/legal-bilan.js — Bilan annuel par entité (Sprint 3C LEGAL-BILAN-ANNUEL).
 *
 * Synthèse N-1 par bailleur : revenus, charges, cash-flow, vacance, occupation,
 * répartition par logement, projection N. Réutilise _compute2044 pour la
 * structure fiscale + ajoute KPIs métier.
 *
 * Utilité V1 :
 *   - PDF récapitulatif annuel envoyé au bailleur (CRG mandataire pré-requis V1.1)
 *   - Synthèse perso pour bailleur particulier
 *   - Pré-requis Sprint 3E GESTION-CRG (qui sera plus complet : mensuel + détaillé)
 */

import { _compute2044 } from './legal-2044.js';
import { resolveScope, scopeWeight } from './finances-scope.js';
import { periodeEnVigueurA } from './loyer-du-mois.js';
import { finOccupationBail, bailLoueAu } from './fin-occupation.js';

/**
 * Calcule le bilan annuel pour une entité (= un bailleur, personne morale ou physique).
 *
 * @param {Object} db - DB global snapshot (logements, mouvements, baux, baux_historique, quittances)
 * @param {Object} stdCategories - STD_CATEGORIES global
 * @param {string} entityNom - Nom exact de l'entité dans DB.entites
 * @param {number|string} year - Année (ex 2025)
 * @param {Object} [opts] - { mapping, today, cashflowReel }
 *   `cashflowReel` (lot 6, B — R-0) : le cash-flow réel de l'entité LU dans le moteur Finances
 *   (`_finMonthly` → `annual.cashflowReel`, via le bloc unique `_dashCfReel`), injecté par l'app. Le
 *   bilan ne le recalcule JAMAIS : « revenus − charges » 2044 n'est pas un cash-flow (sans prêt, sans
 *   travaux d'agrandissement, sans dépenses non déductibles…). Absent → `kpis.cashFlow` = null, affiché
 *   « non disponible » plutôt qu'un chiffre faux.
 * @returns {Object} - bilan structuré (KPIs + détail par logement + résultat fiscal)
 */
export function _computeBilanAnnuel(db, stdCategories, entityNom, year, opts) {
  if (!db || !entityNom || !year) return null;
  const yr = String(year);
  const from = yr + '-01-01';
  const to = yr + '-12-31';
  // B3 — occupation / vacance : ne PAS projeter les mois à venir. Pour l'exercice EN COURS, on borne
  // le calcul d'occupation à aujourd'hui (le fiscal et les mouvements gardent l'année pleine [from,to]).
  // opts.today (YYYY-MM-DD) injectable pour des tests déterministes ; défaut = date du jour.
  const _todayStr = (opts && opts.today) || new Date().toISOString().slice(0, 10);
  const occTo = (_todayStr >= from && _todayStr < to) ? _todayStr : to;
  const isAlive = e => e && !e._deleted;

  const entity = (db.entites || []).find(e => isAlive(e) && e.nom === entityNom);
  if (!entity) return null;

  // Logements de l'entité (actifs OU archivés dans l'année courante)
  const logements = (db.logements || [])
    .filter(l => isAlive(l) && l.entity === entityNom);
  // Périmètre = CELUI DE FINANCES (resolveScope / scopeWeight, jamais recopié — audit lot 6 🟠2 + 🟡D) : lots de
  // l'entité (refs tolérantes : espaces, casse), frais du bailleur (`SCI:<nom>`) et charges posées sur ses
  // immeubles (qui vide + imm, noms nettoyés). Vue BAILLEUR : chaque mouvement pèse 0 ou 1.
  const scEntite = resolveScope({ ent: entityNom }, db.logements || [], { entites: (db.entites || []).filter(isAlive) });
  // Repli de resolveScope (entité absente du catalogue) = « tout le patrimoine » : jamais pour le bilan d'UNE entité.
  const mvtsEntite = scEntite.fallback
    ? (db.mouvements || []).filter(m => m && !m._deleted && m.qui === 'SCI:' + entityNom)
    : (db.mouvements || []).filter(m => scopeWeight(scEntite, m) > 0);
  // Un lot : ses refs, comparées comme Finances. Les refs AMBIGUËS de l'entité (« A1 » / « a1 ») passent en
  // comparaison stricte, comme pour l'entité : sinon un mouvement compterait dans les deux lots et
  // Σ lots + non réparti ≠ entité (contre-vérif lot 6, 🟡1).
  const duLot = (l) => {
    const r = String(l.ref == null ? '' : l.ref).trim();
    const sc = { kind: 'ent', refs: [r], refAmbigus: scEntite.refAmbigus, refStricts: new Set([r]) };
    return (m) => scopeWeight(sc, m) > 0;
  };

  // Baux historiques de l'entité finis dans l'année
  const bauxHist = (db.baux_historique || [])
    .filter(b => isAlive(b) && b.entity === entityNom && (b.fin >= from && b.fin <= to));

  // Calcul fiscal 2044 pour l'entité (filtre via STD_CATEGORIES)
  // M-2 (CDC FINANCES §3) : le mapping des catégories perso est ENFIN passé au bilan — sans
  // lui, une charge de catégorie maison comptait dans le tableau et disparaissait du détail
  // par logement (le total ne pouvait pas égaler la somme des logements).
  const mapping = (opts && opts.mapping) || null;
  // Mouvements déjà filtrés sur le périmètre : `_compute2044` ne filtre plus que la période.
  const fiscal = _compute2044(mvtsEntite, stdCategories, { from, to, mapping });

  // KPIs métier par logement
  // Lot 6, B — le détail d'un lot ne lit QUE les mouvements du lot. `_compute2044` filtré par entité garde
  // aussi les mouvements du BAILLEUR (`qui = 'SCI:<nom>'` : comptable, intérêts d'un prêt global…) : chaque
  // lot les comptait, la somme des lots dépassait l'entité. Ils ont leur propre ligne (`bailleurNonReparti`).
  const parLogement = logements.map(l => {
    const lFiscal = _compute2044(mvtsEntite.filter(duLot(l)), stdCategories, { from, to, mapping });
    // Détecter période de vacance (bail courant + historiques de cette année)
    const bailCourant = (db.baux && db.baux[l.ref] && isAlive(db.baux[l.ref])) ? db.baux[l.ref] : null;
    const histsForRef = (db.baux_historique || []).filter(b => isAlive(b) && b.ref === l.ref);
    const occDays = _calcOccDays(bailCourant, histsForRef, from, occTo);
    const totalDays = _daysBetween(from, occTo);
    const vacanceDays = totalDays - occDays;
    // R0-H : le loyer de référence se lit au barème à la fin de la période mesurée, pas sur
    // `hists[hists.length-1]` — le dernier ÉLÉMENT du tableau, qui n'est pas le dernier bail.
    const _ctxLoyer = { bareme: db.loyerBareme || [], bailCourant, hists: histsForRef, lot: l };
    const loyerMensuelMoyen = loyerHcDuLotA(occTo, l.ref, _ctxLoyer);
    return {
      ref: l.ref,
      type: l.type,
      imm: l.imm,
      // ⚠️ Lisait `allBails`, dont la déclaration a disparu avec le changement de signature de
      // `_calcOccDays` : `ReferenceError` en mode strict, qui ne se déclenchait QUE si le cache
      // `l.locataire` était vide — c'est-à-dire exactement le cas que R0-B répare. Le bilan
      // annuel ne s'affichait plus, sans le moindre message (`openBilanAnnuel` n'a pas de
      // try/catch). Aucun test ne l'a vu : la fixture existante remplit toujours `locataire`.
      //
      // Au passage, le libellé était déjà faux : `allBails` contenait AUSSI le bail courant,
      // donc un lot loué dont le cache est vide s'affichait « (historique) ». Un bail courant
      // existe → on prend son locataire ; sinon seul l'historique justifie « (historique) ».
      locataire: l.locataire
        || (bailCourant ? _nomLocataireBail(bailCourant) : '')
        || (histsForRef.length ? '(historique)' : 'Vacant'),
      occDays,
      vacanceDays,
      tauxOccupation: totalDays > 0 ? Math.round(occDays / totalDays * 1000) / 10 : 0,
      revenus: lFiscal.totalRecettes,
      charges: lFiscal.totalCharges,
      // Lot 6, B : la colonne s'appelait « Cash-flow » mais valait revenus − charges au sens 2044 — ce
      // n'est pas un cash-flow. C'est le RÉSULTAT FISCAL du lot (intérêts d'emprunt rattachés au lot
      // déduits, comme `resultatFoncier` de l'entité), et la colonne le dit.
      resultatFiscal: lFiscal.resultatFoncier,
      loyerMensuelMoyen,
      // R0-H : chaque segment vide est valorisé au loyer de SON époque, jamais à celui
      // d'aujourd'hui. `vacanceDays` reste le total affiché, il ne sert plus de multiplicande.
      manqueAGagner: _manqueVacance(_segmentsVacants(bailCourant, histsForRef, from, occTo), l.ref, _ctxLoyer)
    };
  });

  // Mouvements de l'entité rattachés à AUCUN de ses lots (frais du bailleur, charges d'immeuble) : une ligne à part,
  // jamais répartie ni perdue — Σ lots + cette ligne = entité, par construction (même périmètre, partition).
  const fBailleur = _compute2044(mvtsEntite.filter(m => !logements.some(l => duLot(l)(m))), stdCategories, { from, to, mapping });
  const bailleurNonReparti = (fBailleur.totalRecettes || fBailleur.totalCharges || fBailleur.totalInterets)
    ? { revenus: fBailleur.totalRecettes, charges: fBailleur.totalCharges, resultatFiscal: fBailleur.resultatFoncier }
    : null;

  // KPIs entité agrégés
  const totalRevenus = fiscal.totalRecettes;
  const totalCharges = fiscal.totalCharges;
  const totalInterets = fiscal.totalInterets;
  const _cfInj = opts && opts.cashflowReel;
  const cashFlow = (typeof _cfInj === 'number' && Number.isFinite(_cfInj)) ? Math.round(_cfInj * 100) / 100 : null;
  const resultatFoncier = fiscal.resultatFoncier;
  const totalManqueAGagner = parLogement.reduce((s, l) => s + l.manqueAGagner, 0);
  const totalOccDays = parLogement.reduce((s, l) => s + l.occDays, 0);
  const totalVacanceDays = parLogement.reduce((s, l) => s + l.vacanceDays, 0);
  const tauxOccupationGlobal = (totalOccDays + totalVacanceDays) > 0
    ? Math.round(totalOccDays / (totalOccDays + totalVacanceDays) * 1000) / 10
    : 0;

  return {
    entity: { id: entity.id, nom: entity.nom, type: entity.type, siren: entity.siren },
    year: yr,
    period: { from, to },
    kpis: {
      totalRevenus,
      totalCharges,
      totalInterets,
      cashFlow,
      resultatFoncier,
      totalManqueAGagner: Math.round(totalManqueAGagner * 100) / 100,
      nbLogements: logements.length,
      nbBauxHist: bauxHist.length,
      tauxOccupationGlobal
    },
    fiscal,
    parLogement,
    bailleurNonReparti,
    generatedAt: new Date().toISOString()
  };
}

/**
 * REFONTE FINANCES étape 2 — R-4 / K-2 : occupation & vacance d'un JEU DE LOTS injecté.
 * « Passe sous le socle » : le périmètre vient de finances-scope (scopeLots), jamais d'un
 * filtre `l.entity === X` maison — les lots sans bailleur comptent enfin (P-2, constat 21).
 *   R-4 · « Occupation » = MOYENNE de la période (jours loués ÷ jours louables sur [from..to]),
 *         plus jamais un instantané. L'état du jour est rendu à part (`vacantsJour`).
 *   K-2 · manque à gagner THÉORIQUE = chaque segment vide × le loyer qui était EN VIGUEUR
 *         à son début (`loyerHcDuLotA`) ÷ 30,44. R0-H : c'était le loyer de référence du lot
 *         AUJOURD'HUI appliqué à des jours vides PASSÉS — l'infraction I-1. Il QUALIFIE le
 *         taux, ce n'est pas une créance.
 * @param {Object} db  DB (baux, baux_historique)
 * @param {Array} lots lots du périmètre (déjà filtrés par le socle)
 * @param {{from:string, to:string, today?:string}} opts fenêtre ISO (YYYY-MM-DD, bornes incluses) ; `today` = jour de
 *        l'état « vacants du jour » (défaut : aujourd'hui, heure locale).
 */
export function _computeOccupationLots(db, lots, opts) {
  const o = opts || {};
  const from = o.from, to = o.to;
  const _d = new Date();
  const today = o.today || (_d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()).padStart(2, '0'));
  const isAlive = (e) => e && !e._deleted;
  const r2 = (n) => Math.round(n * 100) / 100;
  let occ = 0, louable = 0, manque = 0;
  const vacantsJour = [];
  if (!from || !to || to < from) return { occDays: 0, louableDays: 0, taux: 0, manqueAGagner: 0, vacantsJour, nbLots: 0 };
  let nb = 0;
  (lots || []).forEach((l) => {
    if (!isAlive(l) || !l.ref) return;
    nb++;
    const bailCourant = (db && db.baux && db.baux[l.ref] && isAlive(db.baux[l.ref])) ? db.baux[l.ref] : null;
    const hists = ((db && db.baux_historique) || []).filter((b) => isAlive(b) && b.ref === l.ref);
    const occDays = _calcOccDays(bailCourant, hists, from, to);
    const totalDays = _daysBetween(from, to);
    const vac = Math.max(0, totalDays - occDays);
    occ += occDays; louable += totalDays;
    // R0-H : ce moteur-ci valorisait la vacance avec `lot.loyerHcRef || lot.hc`, l'autre avec
    // `bailCourant.hc` — deux sources, et la même erreur : le loyer d'aujourd'hui appliqué
    // au passé. Une seule lecture désormais, datée segment par segment.
    manque += _manqueVacance(
      _segmentsVacants(bailCourant, hists, from, to), l.ref,
      { bareme: (db && db.loyerBareme) || [], bailCourant, hists, lot: l });
    // R0-B — la vacance se lit sur le BAIL, pas sur `l.locataire`. Ce champ n'est qu'un cache
    // dénormalisé, resynchronisé au démarrage et seulement SI le bail porte un nom : un bail
    // repris à l'achat ou une saisie en cours le laissent vide. Un lot loué apparaissait alors
    // dans la liste des vacants — et un lot réellement vide, dont le cache gardait l'ancien
    // locataire, n'y apparaissait pas. Un bail clôturé mais encore présent ne loue plus rien.
    // Statut du jour = LA fonction de statut (fin-occupation.js `bailLoueAu`) : un départ déclaré passé rend
    // le lot vacant (« vacant depuis » = la date de sortie), comme le compte des jours d'occupation ci-dessus.
    const loue = bailLoueAu(bailCourant, today);
    if (!loue) {
      const fins = hists.map((b) => b.finEffective || b.fin).filter(Boolean);
      const sortie = bailCourant ? finOccupationBail(bailCourant, false) : '';
      if (sortie) fins.push(sortie);
      fins.sort();
      vacantsJour.push({ ref: l.ref, depuis: fins.length ? fins[fins.length - 1] : null, departDeclare: !!sortie });
    }
  });
  return {
    occDays: occ, louableDays: louable,
    taux: louable > 0 ? r2(occ / louable * 100) : 0,
    manqueAGagner: r2(manque), vacantsJour, nbLots: nb
  };
}


/**
 * LE loyer HC d'un lot À UNE DATE DONNÉE — qu'il soit loué ou vide.
 *
 * R0-H : deux moteurs valorisaient la vacance, et tous deux appliquaient le loyer
 * D'AUJOURD'HUI à des jours vides PASSÉS — `bailCourant.hc` ici, `lot.loyerHcRef || lot.hc`
 * dans `_computeOccupationLots`. Deux sources, et la même infraction à I-1 (« le loyer
 * d'aujourd'hui appliqué à tout le passé ») que le CDC déclare supprimée. Un lot reloué
 * 850 € après six mois de vide, puis révisé à 900 €, se voyait imputer six mois à 900 €.
 *
 * La chaîne des sources, dans cet ordre :
 *   1. le BARÈME en vigueur à cette date — c'est l'historique du loyer, la même lecture que
 *      `duMois()` (aucun moteur concurrent) ;
 *   2. le bail EN COURS à cette date, s'il y en a un ;
 *   3. sinon le bail qui s'est terminé le plus récemment AVANT — ce que le lot valait quand
 *      il s'est vidé, qui est la bonne contrefactuelle d'une vacance ;
 *   4. le bail qui commence le plus tôt APRÈS — un lot jamais encore loué à cette date ne
 *      vaut que ce que son premier locataire acceptera ;
 *   5. la fiche du lot, en dernier recours (stock non migré) ;
 *   6. zéro, et rien d'inventé.
 */
export function loyerHcDuLotA(iso, ref, ctx) { return loyerDuLotA(iso, ref, ctx).hc; }

/**
 * Le loyer HC ET les charges d'un lot à une date — pris sur la MÊME source, jamais l'un au
 * barème et l'autre au bail. Trois écrans valorisaient une vacance à `hc + ch`, chacun avec
 * sa propre façon de trouver « le dernier bail » (le dernier ÉLÉMENT d'un tableau trié par
 * date de DÉBUT, ce qui n'est pas le dernier bail).
 */
export function loyerDuLotA(iso, ref, ctx) {
  const c = ctx || {};
  const d = String(iso || '').slice(0, 10);
  if (!d) return { hc: 0, ch: 0 };
  // I5 : un champ VIDE n'est pas un zéro. Un logement de fonction ou un bail à titre gratuit
  // porte un `hc` de 0 RÉELLEMENT saisi : le rejeter faisait valoriser sa vacance au loyer
  // du bail d'avant, donc un manque à gagner sur un lot qui ne rapportait rien. Même règle
  // que `premierMontantSaisi` (`loyer-bareme.js`).
  const num = (v) => {
    if (v == null || v === '') return null;
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : null;
  };

  const sortie = (src) => ({ hc: num(src && src.hc) || 0, ch: num(src && src.ch) || 0 });
  const p = periodeEnVigueurA(c.bareme || [], ref, d);
  if (p && num(p.hc) != null) return sortie(p);

  const baux = [];
  if (c.bailCourant) baux.push(c.bailCourant);
  (c.hists || []).forEach((b) => { if (b) baux.push(b); });

  // I4 : LA même lecture de la fin d'un bail que `_segmentsOccupes`. Trois versions
  // cohabitaient dans ce module ; celle-ci ne regardait que `finEffective`, donc un bail
  // clôturé SANS `finEffective` n'était jamais « en cours », à aucune date.
  const finDe = (b) => _finDeBail(b, false, null);
  const enCoursA = (b) => {
    if (!b || !b.debut || String(b.debut).slice(0, 10) > d) return false;
    const f = finDe(b);
    return f == null ? true : f >= d;
  };
  // 2. le bail EN COURS. Sans lui, le 31 décembre d'un lot reloué au 1er octobre renvoyait
  //    le loyer de l'ANCIEN bail — la recherche ne regardait que les baux TERMINÉS.
  for (const b of baux) { if (enCoursA(b) && num(b.hc) != null) return sortie(b); }
  // 3. les baux TERMINÉS avant cette date, du plus récent au plus ancien — choisis sur leur
  //    date de FIN, pas sur l'ordre du tableau (le défaut précédent prenait le dernier
  //    ÉLÉMENT). On REMONTE tant qu'un bail ne porte pas de loyer : un bail dont le montant
  //    n'a jamais été saisi est une lacune de saisie, pas un loyer de zéro — il ne doit pas
  //    masquer celui d'avant et faire retomber sur la fiche du lot, c'est-à-dire sur le
  //    loyer d'AUJOURD'HUI (le défaut I-1 que tout ce lot corrige).
  const termines = baux
    .map((b) => ({ b, f: finDe(b) }))
    .filter((x) => x.f != null && x.f < d)
    .sort((x, y) => y.f.localeCompare(x.f));
  for (const { b } of termines) { if (num(b.hc) != null) return sortie(b); }

  // 4. le premier bail qui COMMENCE après cette date.
  let apres = null, debutApres = '';
  for (const b of baux) {
    const deb = b.debut ? String(b.debut).slice(0, 10) : '';
    if (!deb || deb <= d) continue;
    if (!apres || deb < debutApres) { apres = b; debutApres = deb; }
  }
  if (apres && num(apres.hc) != null) return sortie(apres);

  const lot = c.lot || null;
  if (!lot) return { hc: 0, ch: 0 };
  const ref0 = num(lot.loyerHcRef);
  return { hc: ref0 != null ? ref0 : (num(lot.hc) || 0), ch: num(lot.ch) || 0 };
}

/**
 * La FIN d'un bail, lue PARTOUT pareil dans ce module.
 *
 * R0-E : un bail n'est pas terminé parce que sa date de fin est passée — un bail nu non
 * dénoncé se reconduit tacitement. Seule la clôture (ou une `finEffective`) le termine. Les
 * baux d'HISTORIQUE, eux, sont terminés par construction : `force` les borne sans se fier à
 * leurs drapeaux, car les chemins d'archivage ne posent pas tous `cloture`.
 * @returns {string|null} la date de fin ISO, ou `defaut` si le bail court toujours.
 */
function _finDeBail(b, force, defaut) {
  if (!b) return defaut;
  // LA règle de l'app (finOccupationBail, fin-occupation.js) : clôture, sinon départ déclaré, sinon ouvert.
  // Repli `_archivedAt` pour un bail clos sans aucune date de fin (données anciennes).
  const f = finOccupationBail(b, !!force) || ((force || b.cloture) && b._archivedAt ? String(b._archivedAt).slice(0, 10) : '');
  return f || defaut;
}

// Arithmétique de jours en UTC : un jour y dure EXACTEMENT 86 400 000 ms, y compris les deux
// dimanches de bascule horaire. En local, `+ 86400000` sur le 25 octobre donne le 25 à 23 h —
// assez pour perdre un trou d'un jour au printemps (aucun segment vide rendu alors que
// l'occupation en comptait un) et pour dater une vacance d'automne LA VEILLE, ce qui la
// valorisait au loyer de la période de barème refermée à la sortie du locataire.
const _J = 86400000;
const _utc = (iso) => {
  const t = String(iso).slice(0, 10);
  return Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
};
const _isoUtc = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * Les segments OCCUPÉS d'un lot sur [from, to], fusionnés — LA décomposition unique.
 *
 * C2 (retour d'audit) : les jours occupés et les segments vides venaient de deux calculs
 * séparés — une SOMME écrêtée d'un côté, une UNION de l'autre. Dès que deux baux se
 * chevauchent (le cas existe : deux lignes d'historique pour la même ref, ou un bail courant
 * recopié dans l'historique), les deux se contredisaient dans le MÊME objet retourné :
 * « 99,7 % d'occupation · 2 720,11 € de manque à gagner », un jour vide affiché pour
 * quatre-vingt-douze facturés. Une seule décomposition, deux lectures.
 * @returns {Array<[number, number]>} bornes UTC inclusives, triées et disjointes
 */
function _segmentsOccupes(bailCourant, hists, from, to) {
  const fromTs = _utc(from), toTs = _utc(to);
  if (!(toTs >= fromTs)) return [];
  const brut = [];
  const pousse = (b, force) => {
    if (!b || !b.debut) return;
    const fin = _finDeBail(b, force, null);
    const a = Math.max(_utc(b.debut), fromTs);
    const z = Math.min(fin == null ? toTs : _utc(fin), toTs);
    if (z >= a) brut.push([a, z]);
  };
  pousse(bailCourant, false);
  (hists || []).forEach((b) => pousse(b, true));

  brut.sort((x, y) => x[0] - y[0]);
  const fusion = [];
  for (const seg of brut) {
    const dernier = fusion[fusion.length - 1];
    // `+ _J` fusionne aussi les baux ADJACENTS : un bail qui finit le 30/06 et le suivant qui
    // commence le 01/07 ne laissent aucune vacance.
    if (dernier && seg[0] <= dernier[1] + _J) { if (seg[1] > dernier[1]) dernier[1] = seg[1]; }
    else fusion.push([seg[0], seg[1]]);
  }
  return fusion;
}

/** Les jours d'occupation — la SOMME des segments occupés, donc jamais plus que la période. */
function _calcOccDays(bailCourant, hists, from, to) {
  return _segmentsOccupes(bailCourant, hists, from, to)
    .reduce((s, [a, z]) => s + Math.round((z - a) / _J) + 1, 0);
}

/**
 * Les segments VIDES — le complément EXACT des segments occupés, par construction.
 * @returns {Array<{from:string, to:string, jours:number}>}
 */
function _segmentsVacants(bailCourant, hists, from, to) {
  const fromTs = _utc(from), toTs = _utc(to);
  if (!(toTs >= fromTs)) return [];
  const vides = [];
  let curseur = fromTs;
  for (const [a, z] of _segmentsOccupes(bailCourant, hists, from, to)) {
    if (a > curseur) vides.push([curseur, a - _J]);
    if (z + _J > curseur) curseur = z + _J;
  }
  if (curseur <= toTs) vides.push([curseur, toTs]);
  return vides
    .filter(([a, z]) => z >= a)
    .map(([a, z]) => ({ from: _isoUtc(a), to: _isoUtc(z), jours: Math.round((z - a) / _J) + 1 }));
}

/**
 * LE manque à gagner d'une vacance : chaque segment vide est valorisé au loyer qui était en
 * vigueur à SON DÉBUT. Le barème ne bouge pas pendant une vacance (une période naît d'une
 * révision, qui suppose un bail), donc cette lecture est exacte, pas approchée.
 */
function _manqueVacance(segments, ref, ctx) {
  let total = 0;
  for (const seg of segments) total += (seg.jours / 30.44) * loyerHcDuLotA(seg.from, ref, ctx);
  return Math.round(total * 100) / 100;
}

/**
 * Le nom des locataires d'un bail. `log.locataire` n'est qu'un cache : un bail repris à
 * l'achat ou une saisie en cours le laisse vide, et la clôture le VIDE (`log.locataire = ''`).
 * Le bail, lui, sait toujours.
 */
function _nomLocataireBail(b) {
  if (!b) return '';
  const noms = Array.isArray(b.locataires) ? b.locataires.map((x) => x && x.nom).filter(Boolean) : [];
  return noms.join(', ') || String(b.nom || '');
}

function _daysBetween(from, to) {
  const fromTs = new Date(from + 'T00:00:00').getTime();
  const toTs = new Date(to + 'T00:00:00').getTime();
  return Math.round((toTs - fromTs) / 86400000) + 1;
}

/** Formate le bilan en texte ASCII multilignes. */
export function _formatBilanTexte(bilan) {
  if (!bilan) return '(bilan introuvable)';
  const fmt = n => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',') + ' €';
  const lines = [];
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  BILAN ANNUEL — ' + bilan.entity.nom);
  lines.push('  Type : ' + (bilan.entity.type || 'n/a') + (bilan.entity.siren ? '  SIREN : ' + bilan.entity.siren : ''));
  lines.push('  Année : ' + bilan.year + '  (du ' + bilan.period.from + ' au ' + bilan.period.to + ')');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('▶ KPIs ENTITÉ');
  lines.push('  Revenus totaux ................. ' + fmt(bilan.kpis.totalRevenus).padStart(15));
  lines.push('  Charges totales ................ ' + fmt(bilan.kpis.totalCharges).padStart(15));
  lines.push('  Intérêts d\'emprunt ............. ' + fmt(bilan.kpis.totalInterets).padStart(15));
  lines.push('  ─────────────────────────────────────────────');
  lines.push('  Cash-flow réel (Finances) ...... ' + (bilan.kpis.cashFlow == null ? 'non disponible' : fmt(bilan.kpis.cashFlow)).padStart(15));
  lines.push('  Résultat foncier (2044) ........ ' + fmt(bilan.kpis.resultatFoncier).padStart(15));
  lines.push('');
  lines.push('  Nombre de logements ............ ' + bilan.kpis.nbLogements);
  lines.push('  Baux clôturés cette année ..... ' + bilan.kpis.nbBauxHist);
  lines.push('  Taux occupation global ......... ' + bilan.kpis.tauxOccupationGlobal + ' %');
  lines.push('  Manque à gagner cumulé ......... ' + fmt(bilan.kpis.totalManqueAGagner).padStart(15));
  lines.push('');
  lines.push('▶ DÉTAIL PAR LOGEMENT');
  // En-tête construit avec LES MÊMES largeurs que les lignes : chaque titre au-dessus de sa colonne.
  lines.push('  ' + 'Ref'.padEnd(10) + 'Type'.padEnd(9) + 'Locataire'.padEnd(26) + ' ' + 'Occ%'.padStart(6) + ' ' + 'Revenus'.padStart(11) + ' ' + 'Charges'.padStart(11) + ' ' + 'Résultat fiscal'.padStart(16));
  lines.push('  ' + '─'.repeat(93));
  bilan.parLogement.forEach(l => {
    const ref = (l.ref || '').padEnd(10);
    const type = (l.type || '').slice(0, 8).padEnd(9);
    const loc = (l.locataire || '').slice(0, 25).padEnd(26);
    const occ = String(l.tauxOccupation).padStart(5) + '%';
    const rev = fmt(l.revenus).padStart(11);
    const chg = fmt(l.charges).padStart(11);
    const rf = fmt(l.resultatFiscal).padStart(16);
    lines.push('  ' + ref + type + loc + ' ' + occ + ' ' + rev + ' ' + chg + ' ' + rf);
  });
  const nr = bilan.bailleurNonReparti;
  if (nr) {
    lines.push('  ' + 'Bailleur et immeubles (non réparti)'.padEnd(53) + fmt(nr.revenus).padStart(11) + ' ' + fmt(nr.charges).padStart(11) + ' ' + fmt(nr.resultatFiscal).padStart(16));
  }
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  Document généré par Propryo le ' + bilan.generatedAt);
  lines.push('═══════════════════════════════════════════════════════════════');
  return lines.join('\n');
}
