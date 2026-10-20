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
  if (nature === 'appliquee' && reprise === effet && bareme && !perIrl) {
    return { ok: false, erreur: 'Période du barème introuvable pour cette révision — utiliser « Corriger une période ».' };
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
  const irlHistorique = i.irlHistorique.map((x, k) => (k === idx
    ? { ...x, _deleted: true, _deletedAt: stamp, _modifiedAt: stamp, _supprimeeLe: _ymd(i.todayIso) } : x));
  let bareme = Array.isArray(i.bareme) ? i.bareme : [];
  let logHc = null;
  if (a.nature !== 'doublon') {
    const ancien = Number(h.ancienHC) || 0;
    if (a.reprise === a.effet) {
      bareme = _loyerAvantALaMemeDate(bareme, want, a.effet, ancien, 'Révision IRL supprimée');
    } else {
      // Mois quittancés : la révision reste au barème jusqu'à la veille de la reprise.
      const enVigueur = periodeEnVigueurA(bareme, i.ref, a.reprise);
      const bd = (enVigueur && enVigueur.bailDebut) || (_ok(i.bailDebut) ? _ymd(i.bailDebut) : undefined);
      bareme = appliquerNouvellePeriode(bareme, {
        ref: (enVigueur && enVigueur.ref) || i.ref, debut: a.reprise, hc: ancien,
        ch: enVigueur ? (Number(enVigueur.ch) || 0) : (Number(i.chRepli) || 0),
        source: 'manuel', bailDebut: bd, note: 'Révision IRL supprimée — mois déjà quittancés inchangés'
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
