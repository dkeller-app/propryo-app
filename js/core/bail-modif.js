/**
 * core/bail-modif.js — HISTORIQUE-BAIL-ONGLET (2026-07-17), décision user ④.
 *
 * Toute modification d'un terme FINANCIER du bail (loyer HC, provision charges,
 * dépôt de garantie) passe par une popup de validation dans saveBail :
 * ancien → nouveau, date d'effet (garde-fous Q1 : jamais rétroactive, jamais dans
 * un mois quittancé), motif obligatoire. hc/ch → nouvelle période datée du barème
 * (appliquerNouvellePeriode, source 'manuel', note = motif) ; dg → trace append-only
 * DB.bailEvents. Les autres champs du bail restent en sauvegarde simple.
 *
 * Fonctions PURES — testées : __tests__/helpers/bail-modif.test.js.
 */

import { clampDateEffet, _premierDuMoisSuivant } from './loyer-bareme.js';

const CHAMPS_FINANCIERS = [
  { champ: 'hc', label: 'Loyer hors charges' },
  { champ: 'ch', label: 'Provision charges' },
  { champ: 'dg', label: 'Dépôt de garantie' }
];

/**
 * Compare les termes financiers d'un bail avant/après édition.
 * @returns {Array<{champ,label,avant,apres}>} vide si création (prev null) ou rien de financier.
 */
export function detecterChangementsFinanciers(prev, next) {
  if (!prev || !next) return [];
  const out = [];
  for (const { champ, label } of CHAMPS_FINANCIERS) {
    const avant = Number(prev[champ]) || 0;
    const apres = Number(next[champ]) || 0;
    if (avant !== apres) out.push({ champ, label, avant, apres });
  }
  return out;
}

/**
 * Date d'effet pré-remplie d'une modification manuelle : 1er du mois SUIVANT la
 * modification, remontée si nécessaire hors des mois déjà quittancés (Q1).
 * @returns {{effetIso:string, ajustee:boolean}}
 */
export function dateEffetModifDefaut(todayIso, dernierMoisQuittanceYm) {
  const propose = _premierDuMoisSuivant(todayIso);
  return clampDateEffet(propose, { dernierMoisQuittanceYm: dernierMoisQuittanceYm || undefined });
}

const _nr = (s) => String(s == null ? '' : s).trim().toLowerCase();
const _ymd = (iso) => String(iso == null ? '' : iso).slice(0, 10);

/**
 * B1 (audit 17/07) : borne minimale de la date d'effet d'une NOUVELLE période — le 1er du
 * mois SUIVANT le dernier début de période vivante du lot. appliquerNouvellePeriode ne clôt
 * que la période ouverte ANTÉRIEURE au nouveau début : sans cette borne, une date d'effet
 * placée avant une période vivante plus récente (ex. IRL en attente déjà inscrite au barème)
 * laisserait DEUX périodes ouvertes → dû divergent silencieusement.
 * @returns {string} borne ISO ('' si barème vide pour ce lot)
 */
export function borneMinEffetBareme(bareme, ref) {
  const want = _nr(ref);
  let max = '';
  for (const p of (bareme || [])) {
    if (!p || p._deleted || _nr(p.ref) !== want) continue;
    // AUDIT 2026-08-24 — les périodes `source:'bail'` sont EXCLUES. Ce ne sont pas des décisions
    // datées mais les continuations DÉRIVÉES du loyer du bail (garantie de couverture, reprise
    // d'une période coupée) ; appliquerNouvellePeriode les supersède désormais au lieu de s'y
    // arrêter. Les compter ici repoussait la date d'effet d'une augmentation de plusieurs années
    // derrière une ligne que l'app venait elle-même de fabriquer, avec un motif faux dans la popup
    // (« mois quittancé / période existante »). Mesuré à l'écran sur MUL-002 : borne au 01/02/2030
    // pour une augmentation demandée au 01/01/2027.
    if ((p.source || 'bail') === 'bail') continue;
    const d = _ymd(p.debut);
    if (d > max) max = d;
  }
  return max ? _premierDuMoisSuivant(max) : '';
}
function _veille(iso) {
  const d = new Date(_ymd(iso) + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/**
 * Correction d'événement (décision user ⑤) : re-dater la date d'effet d'une révision IRL
 * erronée depuis la timeline. PUR (copies). Garde-fous : normalisation au 1er du mois +
 * jamais dans un mois quittancé (clampDateEffet) ; la nouvelle date doit rester STRICTEMENT
 * entre la période précédente et la période suivante du barème (pas de chevauchement).
 * Re-borne la période 'irl' correspondante (debut) et la fin de la période précédente.
 * @param {{irlHistorique:Array, bareme:Array, ref:string, revisionDate:string,
 *          ancienEffet:string, nouvelleDateEffet:string, dernierMoisQuittanceYm?:string}} input
 * @returns {{ok:boolean, erreur?:string, effetIso?:string, ajustee?:boolean,
 *            irlHistorique?:Array, bareme?:Array}}
 */
export function redaterRevisionIRL(input) {
  const i = input || {};
  const want = _nr(i.ref);
  const revDate = _ymd(i.revisionDate);
  const ancienEffet = _ymd(i.ancienEffet);

  const hist = (i.irlHistorique || []).map((h) => ({ ...h }));
  const idx = hist.findIndex((h) => h && !h._deleted && _nr(h.ref) === want
    && (_ymd(h.date) === revDate || _ymd(h.dateRevision) === revDate)
    && (!ancienEffet || _ymd(h.dateEffet) === ancienEffet || _ymd(h.dateApplication) === ancienEffet));
  if (idx < 0) return { ok: false, erreur: 'Révision introuvable dans l\'historique IRL.' };
  if (hist[idx].action === 'renonciation') {
    return { ok: false, erreur: 'Une renonciation n\'a pas de date d\'effet à corriger.' };
  }

  // IRL-REVISION (audit I5) — corriger une date d'effet ne la rend JAMAIS rétroactive : pas avant la
  // date de révision du cycle, pas avant la DEMANDE (date de validation — art. 17-1 : « prend effet
  // à compter de sa demande »), pas sur un mois quittancé. Avant : seul le mois quittancé bornait,
  // et le menu « ⋯ » d'une révision programmée ouvrait ce chemin.
  // Décision Didier 25/09 (N6) : la date corrigée est LIBRE (le cas d'origine : la lettre est
  // partie plus tôt que la validation dans l'app) — ni la demande ni le 1er du mois ne bornent ;
  // restent intangibles la date de révision du cycle et le mois quittancé.
  // Décision Didier 25/09 (2ᵉ temps) : « on ne revient pas en arrière » — jamais avant la DEMANDE
  // (date de validation de la révision), au jour près : révision rétroactive impossible (art. 17-1).
  // Audit passe 5 (m3) — entrée legacy SANS `date` (demande inconnue) : pas de plancher « demande »
  // inventé ; restent la date de révision du cycle et le mois quittancé. Choix assumé : l'app ne
  // connaît pas la demande, elle ne la fabrique pas (test « legacy sans date »).
  const cl = clampDateEffet(i.nouvelleDateEffet, {
    libre: true,
    annivMoisPremierIso: _ymd(hist[idx].dateRevision) || undefined,
    demandeIso: _ymd(hist[idx].date) || undefined,
    dernierMoisQuittanceYm: i.dernierMoisQuittanceYm || undefined
  });
  const effet = cl.effetIso;
  if (!effet) return { ok: false, erreur: 'Date d\'effet invalide.' };

  // Période 'irl' portée par cette révision : même lot, source irl, debut = ancien effet.
  const bar = (i.bareme || []).map((p) => ({ ...p }));
  const oldEffet = ancienEffet || _ymd(hist[idx].dateEffet);
  const pIdx = bar.findIndex((p) => p && !p._deleted && _nr(p.ref) === want
    && p.source === 'irl' && _ymd(p.debut) === oldEffet);
  // M2 (audit 17/07) : sans période barème correspondante (révision legacy pré-Q1), re-dater
  // l'historique seul ferait diverger l'affichage du dû réel → refus explicite.
  if (pIdx < 0) {
    return { ok: false, erreur: 'Période du barème introuvable pour cette révision — utiliser « Corriger une période ».' };
  }

  // Bornes : strictement après le debut de la période précédente, avant la suivante.
  const vivantes = bar.filter((p) => p && !p._deleted && _nr(p.ref) === want && p !== bar[pIdx])
    .sort((a, b) => _ymd(a.debut).localeCompare(_ymd(b.debut)));
  const prev = vivantes.filter((p) => _ymd(p.debut) < oldEffet).pop() || null;
  const next = vivantes.find((p) => _ymd(p.debut) > oldEffet) || null;
  if (prev && effet <= _ymd(prev.debut)) {
    return { ok: false, erreur: `La date d'effet franchirait la période précédente (début ${prev.debut}).` };
  }
  if (next && effet >= _ymd(next.debut)) {
    return { ok: false, erreur: `La date d'effet franchirait la période suivante (début ${next.debut}).` };
  }
  bar[pIdx] = { ...bar[pIdx], debut: effet };
  if (prev && prev.fin != null) {
    const prevIdx = bar.indexOf(prev);
    bar[prevIdx] = { ...prev, fin: _veille(effet) };
  }

  hist[idx] = { ...hist[idx], dateEffet: effet, dateApplication: effet, dateEffetAjustee: cl.ajustee };
  return { ok: true, effetIso: effet, ajustee: cl.ajustee, irlHistorique: hist, bareme: bar };
}
