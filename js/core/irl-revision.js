/**
 * core/irl-revision.js — IRL-REVISION (docs/subjects/IRL-REVISION.md, validé 2026-09-24).
 *
 * Ce qui se passe APRÈS « Valider la révision » :
 *   R6 — la lettre dit ce qui a été VALIDÉ (ancien loyer, nouveau loyer, indices, date d'effet
 *        réelle), lu dans l'entrée du journal `DB.irlHistorique`. Avant : `genIRLLetter`
 *        recalculait sur le loyer COURANT — une fois la révision appliquée, « Revoir la lettre »
 *        affichait une deuxième révision par-dessus la première.
 *   R7 — une révision PROGRAMMÉE (effet encore à venir) s'annule : l'entrée est retirée
 *        (tombstone, pour la propagation cloud) et le loyer d'avant REPREND à la même date via
 *        le moteur du barème existant (`appliquerNouvellePeriode`, supersession même début) —
 *        aucune période n'est détruite en silence, aucun mois passé n'est recalculé (I-1).
 *   Retours du 15/10/2026 (lot 1, point 2) — révisions EN DOUBLE (cas réel : 4 cartes identiques
 *        790,00 → 796,14 € au 01/10/2026, dont 3 bloquées « en attente » à vie) :
 *        · cleRevision / revisionDejaEnregistree — garde anti-doublon de la validation ;
 *        · dedoublonnerRevisions — nettoyage idempotent des doublons existants (démarrage) ;
 *        · analyserSuppressionRevision / supprimerRevision — « Supprimer cette révision » depuis
 *          l'historique du bail, sans jamais toucher aux mois déjà quittancés.
 *
 * Pur / testable : aucune lecture de DB, `todayIso` injecté.
 * Tests : __tests__/helpers/irl-revision.test.js
 */
import { appliquerNouvellePeriode, _premierDuMoisSuivant } from './loyer-bareme.js';
import { periodeEnVigueurA } from './loyer-du-mois.js';

const _nr = (s) => String(s == null ? '' : s).trim().toLowerCase();
const _ymd = (v) => String(v == null ? '' : v).slice(0, 10);
const _ok = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(_ymd(iso));
const _vivante = (h) => !!h && !h._deleted && h.action !== 'renonciation';

/**
 * L'entrée validée (appliquée ou programmée) qui porte le cycle `cycleIso` du lot `ref`.
 * Un cycle couvre l'année qui précède sa date : une clé à l'ancien format (1er du mois de
 * l'anniversaire, jour anniversaire) du même cycle est reconnue ; celle du cycle d'avant, non.
 * Audit I3 — `debutBail` : une entrée antérieure au début du bail appartient au bail PRÉCÉDENT du
 * même lot (relocation) — sa lettre porterait le loyer de l'ancien locataire.
 * @returns {Object|null} la plus récente (par date de validation) ; null si aucune
 */
export function entreeValideeDuCycle(journal, ref, cycleIso, debutBail) {
  const cyc = _ymd(cycleIso);
  const deb = _ok(debutBail) ? _ymd(debutBail) : '';
  if (!_ok(cyc) || !Array.isArray(journal)) return null;
  const prev = (parseInt(cyc.slice(0, 4), 10) - 1) + cyc.slice(4);
  const want = _nr(ref);
  let best = null, bestI = -1;
  journal.forEach((h, i) => {
    if (!_vivante(h) || _nr(h.ref) !== want) return;
    const k = _ymd(h.dateRevision);
    if (!_ok(k) || k <= prev || (deb && k < deb)) return;
    const d = _ymd(h.date);
    if (!best || d > _ymd(best.date) || (d === _ymd(best.date) && i > bestI)) { best = h; bestI = i; }
  });
  return best;
}

/**
 * L'objet « révision » attendu par le gabarit de lettre (`_buildIRLLetterHtml`), REJOUÉ depuis
 * l'entrée validée : aucun chiffre recalculé. null si l'entrée n'a pas ses indices (legacy).
 * @returns {{T:number, N:number, irlRef:{key:string,val:number}, irlVigueur:{key:string,val:number},
 *            variation:number, nouveauHC:number, ancienHC:number, dateRevision:Date,
 *            dateEffetIso:string}|null}
 */
export function revDepuisEntree(h) {
  if (!h) return null;
  const kv = String(h.irlVigueur || '').trim();
  const kr = String(h.irlRef || '').trim();
  const m = kv.match(/^T([1-4])\s+(\d{4})$/);
  const vV = Number(h.irlVigueurVal), vR = Number(h.irlRefVal);
  if (!m || !kr || !(vV > 0) || !(vR > 0)) return null;
  const cyc = _ymd(h.dateRevision) || _ymd(h.dateEffet);
  if (!_ok(cyc)) return null;
  return {
    T: parseInt(m[1], 10), N: parseInt(m[2], 10),
    irlRef: { key: kr, val: vR }, irlVigueur: { key: kv, val: vV },
    variation: (vV - vR) / vR,
    nouveauHC: Number(h.nouveauHC) || 0,
    ancienHC: Number(h.ancienHC) || 0,
    dateRevision: new Date(cyc + 'T00:00:00'),
    dateEffetIso: _ymd(h.dateEffet) || _ymd(h.dateApplication) || cyc
  };
}

/**
 * R7 — annule la révision PROGRAMMÉE d'un lot (validée, effet encore à venir).
 * @param {{irlHistorique:Array, bareme:Array, ref:string, todayIso:string}} input
 * @returns {{ok:true, irlHistorique:Array, bareme:Array, entree:Object} | {ok:false, erreur:string}}
 */
export function annulerRevisionProgrammee(input) {
  const i = input || {};
  const today = _ymd(i.todayIso);
  const want = _nr(i.ref);
  const hist = Array.isArray(i.irlHistorique) ? i.irlHistorique : [];
  if (!want || !_ok(today)) return { ok: false, erreur: 'Données insuffisantes pour annuler la révision.' };
  // Audit I2 — TOUTES les entrées du lot encore en attente (les doublons d'avant le correctif
  // existent en prod) : en laisser une, c'est la voir s'appliquer quand même au jour de l'effet.
  // Audit passe 2 N2 — seulement celles dont l'effet est ENCORE À VENIR : un vieux doublon périmé
  // (jamais appliqué, bloqué par le contrôle de divergence) ne doit pas rendre l'annulation
  // impossible. Refus uniquement s'il n'y a rien de programmé.
  const idxs = [];
  hist.forEach((h, k) => {
    if (!_vivante(h) || _nr(h.ref) !== want || !h.pendingApply) return;
    const eff = _ymd(h.dateEffet) || _ymd(h.dateApplication);
    if (_ok(eff) && eff > today) idxs.push(k);
  });
  if (!idxs.length) {
    const atteinte = hist.some((h) => _vivante(h) && _nr(h.ref) === want && h.pendingApply);
    return { ok: false, erreur: atteinte
      ? "La date d'effet est atteinte : le nouveau loyer s'applique déjà. Corriger la date d'effet depuis l'historique du bail."
      : 'Aucune révision programmée pour ce lot.' };
  }
  const e = hist[idxs[idxs.length - 1]];     // la plus récente : celle que l'écran affiche
  // Audit M8 — horodaté comme les autres tombstones (resetIRLApply), pour la propagation.
  const stamp = today + 'T00:00:00.000Z';
  const irlHistorique = hist.map((h, k) => (idxs.includes(k) ? { ...h, _deleted: true, _deletedAt: stamp, _annuleeLe: today } : h));
  // Le loyer d'avant reprend À LA MÊME DATE, pour chaque date d'effet programmée : la période IRL
  // est supersédée (tombstone portant sa raison, visible dans l'historique du bail), jamais un trou.
  let bareme = Array.isArray(i.bareme) ? i.bareme : [];
  const vues = new Set();
  for (const k of idxs) {
    const h = hist[k];
    const effet = _ymd(h.dateEffet) || _ymd(h.dateApplication);
    if (vues.has(effet)) continue;
    vues.add(effet);
    bareme = _loyerAvantALaMemeDate(bareme, want, effet, h.ancienHC, 'Révision IRL programmée annulée');
  }
  return { ok: true, irlHistorique, bareme, entree: e };
}

/** Le loyer d'avant reprend À LA MÊME DATE : la période IRL posée à `effet` est supersédée
 *  (même début, moteur du barème existant) ; sans période IRL à cette date, rien ne change. */
function _loyerAvantALaMemeDate(bareme, want, effet, ancienHC, note) {
  const per = bareme.find((p) => p && !p._deleted && _nr(p.ref) === want && _ymd(p.debut) === effet && p.source === 'irl');
  if (!per) return bareme;
  return appliquerNouvellePeriode(bareme, {
    ref: per.ref, debut: effet, hc: Number(ancienHC) || 0, ch: Number(per.ch) || 0,
    source: 'bail', bailDebut: per.bailDebut || undefined, note
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RÉVISIONS EN DOUBLE — retours du 15/10/2026 (lot 1, point 2).
// Cause : _applyIRLValidated empilait l'entrée sans regarder si la même révision existait déjà
// (double validation, deux appareils, rejeu) ; au jour de l'effet la première s'appliquait et les
// suivantes restaient « en attente » à vie (contrôle log.hc ≠ ancienHC de _applyPendingIRLRevisions).
// ─────────────────────────────────────────────────────────────────────────────────────────────

const _cents = (x) => Math.round((Number(x) || 0) * 100);
const _effetDe = (h) => _ymd(h && h.dateEffet) || _ymd(h && h.dateApplication) || _ymd(h && h.dateRevision);
const _indice = (h) => String((h && h.irlVigueur) || '').trim().replace(/\s+/g, ' ').toUpperCase();
const _frDate = (iso) => _ymd(iso).split('-').reverse().join('/');

/**
 * Identité d'une révision validée : LOT (ref tolérante) + INDICE (trimestre en vigueur) + DATE
 * D'EFFET. Deux entrées de même clé sont la même révision. null : renonciation, entrée
 * supprimée, ou sans date exploitable.
 */
export function cleRevision(h) {
  if (!_vivante(h)) return null;
  const ref = _nr(h.ref);
  const eff = _effetDe(h);
  if (!ref || !_ok(eff)) return null;
  return ref + '|' + _indice(h) + '|' + eff;
}

/**
 * Garde anti-doublon : la révision vivante déjà enregistrée pour ce lot, cet indice et cette
 * date d'effet (l'appliquée de préférence), ou null. `bailDebut` (facultatif) : une entrée dont
 * l'effet précède le bail en cours appartient au locataire précédent et ne compte pas.
 * @param {Array} journal DB.irlHistorique
 * @param {{ref:string, irlVigueur:string, dateEffet:string, bailDebut?:string}} cand
 */
export function revisionDejaEnregistree(journal, cand) {
  const k = cand ? cleRevision({ ref: cand.ref, irlVigueur: cand.irlVigueur, dateEffet: cand.dateEffet }) : null;
  if (!k || !Array.isArray(journal)) return null;
  const deb = _ok(cand.bailDebut) ? _ymd(cand.bailDebut) : '';
  let best = null;
  for (const h of journal) {
    if (cleRevision(h) !== k) continue;
    if (deb && _effetDe(h) < deb) continue;
    if (!best || (best.pendingApply && !h.pendingApply)) best = h;
  }
  return best;
}

/**
 * Nettoyage des doublons EXISTANTS (migration de données idempotente, au démarrage).
 * Par clé (lot, indice, date d'effet) : une seule entrée vivante est gardée — l'APPLIQUÉE s'il y
 * en a une (c'est elle qui a écrit le loyer), sinon la validation la plus récente. Les autres
 * passent en tombstone horodaté (propagation cloud) qui dit ce qui les a remplacées
 * (`_doublonDe`) : rien n'est effacé. Seuls les VRAIS doublons (mêmes montants au centime) sont
 * retirés ; un groupe aux montants différents est laissé tel quel et signalé (`divergents`) :
 * choisir entre deux loyers n'est pas une migration, c'est une décision.
 * Ne touche ni au loyer du lot, ni au barème (aucun des deux n'est lu ni écrit).
 * @returns {{irlHistorique:Array, retirees:Array<{index:number, gardee:number, cle:string}>, divergents:string[]}}
 *          `irlHistorique` est le tableau REÇU (même référence) quand rien n'est retiré.
 */
export function dedoublonnerRevisions(journal, nowIso) {
  const hist = Array.isArray(journal) ? journal : [];
  const groupes = new Map();
  hist.forEach((h, k) => {
    const c = cleRevision(h);
    if (!c) return;
    if (!groupes.has(c)) groupes.set(c, []);
    groupes.get(c).push(k);
  });
  const retirer = new Map();      // index retiré → index gardé
  const divergents = [];
  for (const [cle, idxs] of groupes) {
    if (idxs.length < 2) continue;
    const a0 = _cents(hist[idxs[0]].ancienHC), n0 = _cents(hist[idxs[0]].nouveauHC);
    if (idxs.some((k) => _cents(hist[k].ancienHC) !== a0 || _cents(hist[k].nouveauHC) !== n0)) { divergents.push(cle); continue; }
    const appliquees = idxs.filter((k) => !hist[k].pendingApply);
    const garde = appliquees.length ? appliquees[0] : idxs[idxs.length - 1];
    for (const k of idxs) if (k !== garde) retirer.set(k, garde);
  }
  if (!retirer.size) return { irlHistorique: hist, retirees: [], divergents };
  const stamp = String(nowIso || '');
  const irlHistorique = hist.map((h, k) => {
    if (!retirer.has(k)) return h;
    const g = hist[retirer.get(k)];
    return { ...h, _deleted: true, _deletedAt: stamp, _modifiedAt: stamp, _doublonDe: { date: _ymd(g.date), dateEffet: _effetDe(g) } };
  });
  const retirees = [...retirer.entries()].map(([k, g]) => ({ index: k, gardee: g, cle: cleRevision(hist[k]) }));
  return { irlHistorique, retirees, divergents };
}

/**
 * Ce que ferait « Supprimer cette révision » (sans rien écrire) — sert à afficher ou non le
 * geste et à rédiger la confirmation.
 * @param {{irlHistorique:Array, ref:string, index:number, todayIso:string,
 *          dernierMoisQuittanceYm?:string, bailDebut?:string, attendu?:{dateEffet:string, nouveauHC:number}}} input
 * @returns {{ok:false, erreur:string} | {ok:true, nature:'doublon'|'programmee'|'appliquee',
 *          entree:Object, effet:string, reprise:string|null, moisQuittancesConserves:boolean, jumelle:Object|null}}
 *   nature : 'doublon' — une autre révision vivante du lot porte la même date d'effet : seule
 *              l'entrée part, le barème et le loyer ne bougent pas ;
 *            'programmee' — effet encore à venir : le loyer d'avant reprend à la même date ;
 *            'appliquee' — effet atteint : le loyer d'avant reprend à la date d'effet, ou au
 *              1er du mois qui suit le dernier mois quittancé (les quittances émises font foi).
 */
export function analyserSuppressionRevision(input) {
  const i = input || {};
  const hist = Array.isArray(i.irlHistorique) ? i.irlHistorique : [];
  const want = _nr(i.ref);
  const today = _ymd(i.todayIso);
  const idx = Number(i.index);
  const h = Number.isInteger(idx) && idx >= 0 ? hist[idx] : null;
  if (!want || !_ok(today) || !_vivante(h) || _nr(h.ref) !== want) {
    return { ok: false, erreur: 'Révision introuvable : rafraîchir la page.' };
  }
  const effet = _effetDe(h);
  if (!_ok(effet)) return { ok: false, erreur: 'Révision sans date d’effet : utiliser « Corriger la date d’effet ».' };
  // L'écran a pu être rendu avant une synchronisation : on vérifie que c'est bien la même entrée.
  if (i.attendu && (_ymd(i.attendu.dateEffet) !== effet || _cents(i.attendu.nouveauHC) !== _cents(h.nouveauHC))) {
    return { ok: false, erreur: 'L’historique a changé depuis l’affichage : rafraîchir la page.' };
  }
  const deb = _ok(i.bailDebut) ? _ymd(i.bailDebut) : '';
  const autres = hist.filter((x, k) => k !== idx && _vivante(x) && _nr(x.ref) === want && (!deb || _effetDe(x) >= deb));
  const bareme = Array.isArray(i.bareme) ? i.bareme : null;
  const perIrl = bareme ? bareme.find((p) => p && !p._deleted && _nr(p.ref) === want && _ymd(p.debut) === effet && p.source === 'irl') : null;
  // Doublon = une autre entrée du MÊME bail, même date d'effet, MÊMES montants au centime (critère de
  // dedoublonnerRevisions) : seule l'entrée part, rien d'autre ne bouge.
  const memeMontant = (x) => _cents(x.ancienHC) === _cents(h.ancienHC) && _cents(x.nouveauHC) === _cents(h.nouveauHC);
  const jumelle = autres.find((x) => _effetDe(x) === effet && memeMontant(x)) || null;
  if (jumelle) return { ok: true, nature: 'doublon', entree: h, effet, reprise: null, moisQuittancesConserves: false, jumelle };
  // Deux révisions au même jour aux montants DIFFÉRENTS : celle qui n'est pas en vigueur (barème, sinon
  // loyer du lot) part seule ; celle en vigueur n'est supprimable qu'une fois l'autre retirée.
  const divergente = autres.find((x) => _effetDe(x) === effet) || null;
  if (divergente) {
    const enVigueur = perIrl ? _cents(perIrl.hc) === _cents(h.nouveauHC)
      : (i.logHc != null && _cents(i.logHc) === _cents(h.nouveauHC));
    if (enVigueur) {
      return { ok: false, erreur: 'Deux révisions aux montants différents au ' + _frDate(effet) + ' : supprimer d’abord celle de '
        + (Number(divergente.nouveauHC) || 0).toFixed(2).replace('.', ',') + ' € (non appliquée).' };
    }
    return { ok: true, nature: 'doublon', entree: h, effet, reprise: null, moisQuittancesConserves: false, jumelle: divergente };
  }
  const posterieure = autres
    .filter((x) => _effetDe(x) > effet && (!deb || _effetDe(x) >= deb))
    .sort((a, b) => _effetDe(a).localeCompare(_effetDe(b)))[0];
  if (posterieure) {
    return { ok: false, erreur: 'Une révision plus récente (effet au ' + _frDate(_effetDe(posterieure))
      + ') a été calculée sur ce loyer : la supprimer d’abord.' };
  }
  // Mois déjà quittancés à partir de l'effet (même une révision programmée a pu être quittancée d'avance) :
  // ils gardent le loyer révisé, l'ancien loyer reprend au 1er du mois qui suit le dernier quittancé.
  const dq = /^\d{4}-\d{2}$/.test(String(i.dernierMoisQuittanceYm || '')) ? String(i.dernierMoisQuittanceYm) : '';
  const quittance = !!dq && effet.slice(0, 7) <= dq;
  const reprise = quittance ? _premierDuMoisSuivant(dq + '-01') : effet;
  const nature = (h.pendingApply && effet > today) ? 'programmee' : 'appliquee';
  // Révision appliquée sans sa période au barème à la date d'effet (révision ancienne re-datée, période
  // corrigée à la main, validée hors connexion) : remettre l'ancien loyer sur le lot sans toucher au dû
  // ferait diverger l'affichage et le dû — refus explicite, comme « Corriger la date d'effet ».
  // `forcerReprise` (abandon d'une révision « à vérifier ») : le loyer d'avant est reposé à la date d'effet quelle que soit
  // la période qui y figure (corrigée à la main, ou absente) — jamais de période révisée orpheline.
  if (nature === 'appliquee' && reprise === effet && bareme && !perIrl && !i.forcerReprise) {
    return { ok: false, erreur: 'Période du barème introuvable pour cette révision — utiliser « Ajouter une période ».' };
  }
  return { ok: true, nature, entree: h, effet, reprise, moisQuittancesConserves: quittance, jumelle: null };
}

/**
 * « Supprimer cette révision » — l'entrée passe en tombstone (`_deleted`, horodatée : propagation
 * cloud, jamais effacée) et le barème suit selon `analyserSuppressionRevision` :
 *   · doublon     : barème inchangé ;
 *   · programmée  : la période IRL de la date d'effet est supersédée par l'ancien loyer ;
 *   · appliquée   : idem à la date d'effet, OU — si des mois à partir de l'effet sont déjà
 *                   quittancés — une période « ancien loyer » est posée au 1er du mois qui suit
 *                   le dernier mois quittancé : ces mois gardent le loyer révisé (I-1).
 * Pure : aucune donnée reçue n'est mutée.
 * @param {Object} input celui de analyserSuppressionRevision + {bareme, nowIso, logHc, chRepli}
 *   + (révision « à vérifier » abandonnée) `loyerReprise` : le loyer qui reprend, s'il n'est plus `ancienHC`
 *   (loyer d'avant l'effet corrigé entre-temps) ; `forcerReprise` : ce loyer est reposé à la date d'effet même si
 *   la période qui y figure n'est pas la période IRL (révisé corrigé à la main) — aucune hausse ne reste au barème
 *   pour un cycle redevenu « à faire » ; `motif` / `note` : la trace de l'abandon.
 * @returns {{ok:false, erreur:string} | {ok:true, nature, entree, effet, reprise, moisQuittancesConserves,
 *          irlHistorique:Array, bareme:Array, logHc:number|null, marqueCycle:string}}
 *   logHc : le loyer vivant à poser (null = ne pas toucher) ; marqueCycle : la clé de cycle à
 *   remettre sur le lot si elle était celle de la révision supprimée.
 */
export function supprimerRevision(input) {
  const a = analyserSuppressionRevision(input);
  if (!a.ok) return a;
  const i = input;
  const want = _nr(i.ref);
  const idx = Number(i.index);
  const h = a.entree;
  const stamp = String(i.nowIso || (_ymd(i.todayIso) + 'T00:00:00.000Z'));
  const motif = String(i.motif || '').trim();
  const irlHistorique = i.irlHistorique.map((x, k) => (k === idx
    ? { ...x, _deleted: true, _deletedAt: stamp, _modifiedAt: stamp, _supprimeeLe: _ymd(i.todayIso), ...(motif ? { _abandonMotif: motif } : {}) } : x));
  let bareme = Array.isArray(i.bareme) ? i.bareme : [];
  let logHc = null;
  if (a.nature !== 'doublon') {
    const ancien = (i.loyerReprise != null && Number.isFinite(Number(i.loyerReprise))) ? Number(i.loyerReprise) : (Number(h.ancienHC) || 0);
    const note = String(i.note || '') || 'Révision IRL supprimée';
    if (a.reprise === a.effet) {
      const b1 = _loyerAvantALaMemeDate(bareme, want, a.effet, ancien, note);
      const pE = (b1 === bareme && i.forcerReprise) ? periodeEnVigueurA(bareme, i.ref, a.effet) : null;
      if (pE && _cents(pE.hc) !== _cents(ancien)) {
        bareme = appliquerNouvellePeriode(bareme, {
          ref: pE.ref || i.ref, debut: a.effet, hc: ancien, ch: Number(pE.ch) || 0, source: 'manuel',
          bailDebut: pE.bailDebut || (_ok(i.bailDebut) ? _ymd(i.bailDebut) : undefined), note
        });
      } else bareme = b1;
    } else {
      // Mois quittancés : la révision reste au barème jusqu'à la veille de la reprise.
      const enVigueur = periodeEnVigueurA(bareme, i.ref, a.reprise);
      const bd = (enVigueur && enVigueur.bailDebut) || (_ok(i.bailDebut) ? _ymd(i.bailDebut) : undefined);
      bareme = appliquerNouvellePeriode(bareme, {
        ref: (enVigueur && enVigueur.ref) || i.ref, debut: a.reprise, hc: ancien,
        ch: enVigueur ? (Number(enVigueur.ch) || 0) : (Number(i.chRepli) || 0),
        source: 'manuel', bailDebut: bd, note: note + ' — mois déjà quittancés inchangés'
      });
    }
    if (i.logHc != null && _cents(i.logHc) === _cents(h.nouveauHC)) logHc = ancien;
  }
  // Clé de cycle : celle de la dernière révision (ou renonciation) restante du bail, sinon rien.
  const deb = _ok(i.bailDebut) ? _ymd(i.bailDebut) : '';
  const marqueCycle = irlHistorique
    .filter((x) => x && !x._deleted && _nr(x.ref) === want && _ok(x.dateRevision) && (!deb || _ymd(x.dateRevision) >= deb))
    .map((x) => _ymd(x.dateRevision)).sort().pop() || '';
  return { ...a, irlHistorique, bareme, logHc, marqueCycle };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// RÉVISION « À VÉRIFIER » — chantier IRL-MOTEUR (v15.776).
// Avant : au jour de l'effet, _applyPendingIRLRevisions SAUTAIT EN SILENCE une révision dont « l'ancien
// loyer » ne valait plus le loyer du lot (correction de période, avenant, saisie à la main) : un
// `console.warn`, rien à l'écran, l'entrée « en attente » à vie, le loyer vivant jamais mis à jour.
// Ce que la garde protégeait (v15.10) reste protégé : jamais deux fois la même révision, jamais
// une correction volontaire écrasée. Mais une révision qui ne passe pas la garde n'est plus perdue :
// elle passe « à vérifier », avec son motif, et le propriétaire décide (appliquer / abandonner).
// Rien n'est appliqué d'office : le moteur n'écrit ni le barème ni le loyer d'une révision à vérifier.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const _veille = (iso) => {
  const d = new Date(_ymd(iso) + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const _montant = (v) => (v == null || (typeof v === 'string' && v.trim() === '') || !Number.isFinite(Number(v))) ? null : Number(v);
const _r2 = (n) => Math.round(n * 100) / 100;

/**
 * LE nouveau loyer d'une révision IRL : base × indice en vigueur ÷ indice de référence, au centime.
 * Formule unique du moteur (calcul de la révision, recalcul à la validation, révision à vérifier).
 * @returns {number|null} null si la base ou un indice manque
 */
export function nouveauLoyerIrl(base, irlRefVal, irlVigueurVal) {
  const b = _montant(base), r = Number(irlRefVal), v = Number(irlVigueurVal);
  if (b == null || !(r > 0) || !(v > 0)) return null;
  return Math.round(b * v / r * 100) / 100;
}

/**
 * Au jour de l'effet : cette révision programmée peut-elle s'appliquer telle quelle ?
 * Le BARÈME fait foi (c'est lui qui fixe le dû) : la révision est cohérente si le loyer en vigueur la
 * VEILLE de l'effet vaut toujours sa base (`ancienHC`) et si le barème porte bien son nouveau loyer à
 * la date d'effet. Le loyer vivant du lot (`logHc`) dit ensuite s'il reste à l'écrire (= base) ou s'il
 * l'est déjà (= nouveau loyer : jamais deux fois). Sans barème pour ce lot (fichier local, données
 * anciennes) : seule la règle d'origine (loyer vivant = base) vaut.
 *
 * @param {{entree:Object, bareme?:Array, ref?:string, logHc:*, todayIso:string, bailDebut?:string}} input
 * @returns {{action:'ignorer'} | {action:'attendre'} | {action:'appliquer', hc:number} | {action:'deja', hc:number}
 *   | {action:'a-verifier', aVerifier:{code:'base-modifiee'|'loyer-revise-modifie'|'absente-bareme'|'loyer-vivant-modifie',
 *       effet:string, ancienHC:number, nouveauHC:number, loyerActuel:number|null, base:number|null,
 *       baremeEffet:number|null, recalcule:number|null}}}
 *   recalcule = le nouveau loyer sur la base EN VIGUEUR (barème, sinon loyer du lot), avec les indices de la révision.
 */
export function verifierRevisionAAppliquer(input) {
  const i = input || {};
  const h = i.entree;
  if (!_vivante(h) || !h.pendingApply) return { action: 'ignorer' };
  const quand = _ymd(h.dateApplication) || _ymd(h.dateEffet);
  const effet = _effetDe(h);
  const today = _ymd(i.todayIso);
  if (!_ok(quand) || !_ok(effet) || !_ok(today)) return { action: 'ignorer' };
  if (quand > today) return { action: 'attendre' };
  const anc = Number(h.ancienHC) || 0, nouv = Number(h.nouveauHC) || 0;
  const live = _montant(i.logHc);
  const ref = i.ref != null ? i.ref : h.ref;
  const bd = _ok(i.bailDebut) ? _ymd(i.bailDebut) : null;
  // Même borne que la base d'une révision (baseRevisionHC) : une période d'un AUTRE bail ne compte pas.
  const duBail = (p) => (p && (bd == null || p.bailDebut == null || _ymd(p.bailDebut) === bd)) ? p : null;
  const bareme = Array.isArray(i.bareme) ? i.bareme : [];
  const pV = duBail(periodeEnVigueurA(bareme, ref, _veille(effet)));
  const pE = duBail(periodeEnVigueurA(bareme, ref, effet));
  const base = pV ? _montant(pV.hc) : null;
  const baremeEffet = pE ? _montant(pE.hc) : null;
  const baseModifiee = base != null && _cents(base) !== _cents(anc);
  const reviseModifie = baremeEffet != null && _cents(baremeEffet) !== _cents(nouv);
  if (!baseModifiee && !reviseModifie) {
    if (live != null && _cents(live) === _cents(anc)) return { action: 'appliquer', hc: nouv };
    if (live != null && _cents(live) === _cents(nouv)) return { action: 'deja', hc: nouv };
    // Loyer du lot non renseigné : le barème (cohérent, et portant la révision) fait foi.
    if (live == null && baremeEffet != null) return { action: 'appliquer', hc: nouv };
    // Relecture Fable (2) — une période PLUS RÉCENTE que l'effet (avenant, correction) porte déjà le loyer du lot :
    // la révision est au barème, le loyer vivant a suivi la suite — constaté, rien à décider.
    const pT = duBail(periodeEnVigueurA(bareme, ref, today));
    if (live != null && pT && _ymd(pT.debut) > effet && _cents(pT.hc) === _cents(live)) return { action: 'deja', hc: nouv };
  }
  // Relecture adverse (1) — la base a été portée À LA MAIN au nouveau loyer avant l'effet (barème cohérent à l'effet) :
  // la révision est déjà en place. La recalculer l'appliquerait une 2ᵉ fois.
  if (baseModifiee && _cents(base) === _cents(nouv) && (baremeEffet == null || _cents(baremeEffet) === _cents(nouv))) {
    return { action: 'deja', hc: nouv };
  }
  let code = 'loyer-vivant-modifie';
  if (baseModifiee) code = 'base-modifiee';
  else if (reviseModifie) code = (_cents(baremeEffet) === _cents(anc)) ? 'absente-bareme' : 'loyer-revise-modifie';
  const b = base != null ? base : live;
  return { action: 'a-verifier', aVerifier: {
    code, effet, ancienHC: anc, nouveauHC: nouv, loyerActuel: live, base: b, baremeEffet,
    // Relecture adverse (8) — jamais un « nouveau loyer » calculé sur une base nulle (barème lacunaire comblé à 0).
    recalcule: (b != null && b > 0) ? nouveauLoyerIrl(b, h.irlRefVal, h.irlVigueurVal) : null
  } };
}

/**
 * Les montants que le propriétaire peut retenir pour une révision à vérifier, le PREMIER étant celui
 * que le moteur propose. Abandonner est toujours possible en plus (« Supprimer cette révision »).
 *   · 'recalcule' : le nouveau loyer recalculé sur la base en vigueur (base corrigée entre-temps) ;
 *   · 'valide'    : le montant validé (et annoncé par la lettre), tel quel ;
 *   · 'bareme'    : le montant que le barème porte à la date d'effet (révisé corrigé à la main) — jamais écrasé.
 * @returns {Array<{choix:'recalcule'|'valide'|'bareme', montant:number}>}
 */
export function propositionsAVerifier(av) {
  if (!av) return [];
  if (av.code === 'loyer-revise-modifie') return av.baremeEffet != null ? [{ choix: 'bareme', montant: av.baremeEffet }] : [];
  const out = [];
  // La base en vigueur atteint déjà le loyer révisé (hausse faite à la main ?) : le recalcul n'est plus LA proposition
  // (il ajouterait une hausse à une hausse) — il reste possible, jamais en premier (relecture adverse 1).
  const auDessus = av.base != null && _cents(av.base) >= _cents(av.nouveauHC);
  if (av.code !== 'absente-bareme' && av.recalcule != null && _cents(av.recalcule) !== _cents(av.nouveauHC)) {
    out.push(auDessus ? { choix: 'recalcule', montant: av.recalcule, prudence: true } : { choix: 'recalcule', montant: av.recalcule });
  }
  // Jamais une « révision » qui BAISSERAIT le loyer en vigueur (relecture Fable 4).
  if (!(av.base != null && _cents(av.nouveauHC) < _cents(av.base))) out.push({ choix: 'valide', montant: av.nouveauHC });
  // Ce qui est proposé en premier n'est jamais un geste « avec prudence ».
  return out.sort((x, y) => (x.prudence ? 1 : 0) - (y.prudence ? 1 : 0));
}

/**
 * La date à partir de laquelle un montant décidé pour une révision « à vérifier » est posé au barème : la date
 * d'effet, sauf si des mois sont déjà QUITTANCÉS depuis — alors le 1er du mois qui suit le dernier mois quittancé
 * (même règle que « Supprimer cette révision » : les mois quittancés gardent le loyer de leur quittance).
 * @param {string} effet 'AAAA-MM-JJ'
 * @param {string|null} dernierMoisQuittanceYm 'AAAA-MM'
 */
export function dateDecisionAVerifier(effet, dernierMoisQuittanceYm) {
  const eff = _ymd(effet);
  const dq = /^\d{4}-\d{2}$/.test(String(dernierMoisQuittanceYm || '')) ? String(dernierMoisQuittanceYm) : '';
  return (_ok(eff) && dq && eff.slice(0, 7) <= dq) ? _premierDuMoisSuivant(dq + '-01') : eff;
}

const _fmtDefaut = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' €';

/**
 * Le motif, en clair (ton neutre) : ce qui a changé depuis la validation, et pourquoi rien n'a été appliqué.
 * @param {Object} av l'objet `aVerifier`
 * @param {(n:number)=>string} [fmt] mise en forme des montants
 */
export function texteAVerifier(av, fmt) {
  if (!av) return '';
  const F = typeof fmt === 'function' ? fmt : _fmtDefaut;
  const eff = _frDate(av.effet);
  // Relecture adverse (3) — dire ce qui est RÉELLEMENT facturé : le barème porte, depuis la validation, un montant à la
  // date d'effet ; seul le loyer du bail (fiche, bail) n'a pas été mis à jour.
  const factu = av.baremeEffet != null ? ` Le barème facture ${F(av.baremeEffet)} depuis cette date${av.loyerActuel != null ? `, le loyer du bail reste ${F(av.loyerActuel)}` : ''}.` : '';
  switch (av.code) {
    case 'base-modifiee':
      return `Révision du ${eff} à vérifier : le loyer en vigueur avant cette date vaut ${F(av.base)}, la révision a été calculée sur ${F(av.ancienHC)}.` + factu;
    case 'loyer-revise-modifie':
      return `Révision du ${eff} à vérifier : le barème prévoit ${F(av.baremeEffet)} à cette date, la révision annonçait ${F(av.nouveauHC)}.`;
    case 'absente-bareme':
      return `Révision du ${eff} à vérifier : le barème ne porte plus le nouveau loyer de ${F(av.nouveauHC)} à cette date (il facture ${F(av.baremeEffet)}).`;
    default:
      return `Révision du ${eff} à vérifier : le loyer du bail vaut ${av.loyerActuel != null ? F(av.loyerActuel) : 'un montant non renseigné'}, la révision attendait ${F(av.ancienHC)}.` + factu;
  }
}

/**
 * Les révisions « à vérifier » d'un lot (vivantes, encore en attente, motif posé par le moteur),
 * du bail en cours si `bailDebut` est donné. Triées par date d'effet.
 * @returns {Array<{index:number, entree:Object}>}
 */
export function revisionsAVerifier(journal, ref, bailDebut, todayIso) {
  const want = _nr(ref);
  const deb = _ok(bailDebut) ? _ymd(bailDebut) : '';
  const today = _ok(todayIso) ? _ymd(todayIso) : '';
  const out = [];
  (Array.isArray(journal) ? journal : []).forEach((h, index) => {
    if (!_vivante(h) || !h.pendingApply || !h.aVerifier || _nr(h.ref) !== want) return;
    if (deb && _ok(h.dateRevision) && _ymd(h.dateRevision) < deb) return;
    // Redatée vers une date future (« Corriger la date d'effet ») : plus à vérifier, de nouveau programmée.
    if (today && (_ymd(h.dateApplication) || _effetDe(h)) > today) return;
    out.push({ index, entree: h });
  });
  return out.sort((a, b) => _effetDe(a.entree).localeCompare(_effetDe(b.entree)));
}

/**
 * L'entrée du journal une fois la révision vérifiée et appliquée par le propriétaire (copie, rien n'est muté) :
 * plus en attente, montants retenus, et la trace de la vérification (`verification` : choix, date, auteur,
 * motif, montants d'avant). Un recalcul sur une base corrigée change aussi la base (`ancienHC`).
 * @param {Object} entree l'entrée « à vérifier »
 * @param {{choix:'recalcule'|'valide'|'bareme', montant:number, base?:number, todayIso:string, par?:string, aPartirDu?:string}} o
 */
export function resoudreRevisionAVerifier(entree, o) {
  const p = o || {};
  const m = Number(p.montant);
  const today = _ymd(p.todayIso);
  const anc = (p.choix === 'recalcule' && _montant(p.base) != null) ? Number(p.base) : (Number(entree.ancienHC) || 0);
  const out = {
    ...entree, ancienHC: anc, nouveauHC: m, diff: _r2(m - anc), pendingApply: false, appliedAt: today,
    verification: { le: today, choix: p.choix, par: p.par || '', motif: (entree.aVerifier && entree.aVerifier.code) || '',
      ...(_ok(p.aPartirDu) && _ymd(p.aPartirDu) !== _effetDe(entree) ? { aPartirDu: _ymd(p.aPartirDu) } : {}),
      avant: { ancienHC: Number(entree.ancienHC) || 0, nouveauHC: Number(entree.nouveauHC) || 0 } }
  };
  delete out.aVerifier;
  return out;
}
