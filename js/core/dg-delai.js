/**
 * core/dg-delai.js — LA règle du délai de restitution du dépôt de garantie.
 *
 * Article 22 de la loi n° 89-462 du 6 juillet 1989 (version en vigueur depuis le 27/03/2014, loi
 * n° 2014-366 art. 6 ; texte cité verbatim dans l'app : `_ART22_RESTITUTION`, app-part1) :
 *   - « Il est restitué dans un délai maximal de deux mois à compter de la remise en main propre, ou
 *     par lettre recommandée avec demande d'avis de réception, des clés au bailleur ou à son mandataire » ;
 *   - « Il est restitué dans un délai maximal d'un mois à compter de la remise des clés par le
 *     locataire lorsque l'état des lieux de sortie est conforme à l'état des lieux d'entrée » ;
 *   - à défaut, « le dépôt de garantie restant dû au locataire est majoré d'une somme égale à 10 % du
 *     loyer mensuel en principal, pour chaque période mensuelle commencée en retard », majoration non
 *     due lorsque le locataire n'a pas indiqué l'adresse de son nouveau domicile.
 *
 * Les deux délais sont des MAXIMUMS. Décisions du pilotage (06/10) :
 *   - point de départ = la remise des clés : celle DÉCLARÉE au départ (`bail.depart.dateSortie`), sinon
 *     la date de l'EDL de sortie de CE bail, sinon la fin effective, sinon la fin du bail ;
 *   - conformité : l'EDL de sortie de CE bail comparé à l'entrée (aucune dégradation relevée = conforme) ;
 *     sans EDL de sortie, elle est INCONNUE (`null`) — jamais déduite des retenues (`dgRetenu`) : une
 *     retenue pour loyer impayé ne rend pas l'état des lieux non conforme ;
 *   - conformité inconnue : « au plus tard le <1 mois> si l'EDL de sortie est conforme, sinon le <2 mois> ».
 *     Entre les deux : « dépassement possible » ; après 2 mois : « en retard ». La pénalité CERTAINE court
 *     depuis l'échéance applicable (2 mois si la conformité est inconnue) ; celle qui courrait depuis
 *     1 mois n'est que POSSIBLE — dite, jamais additionnée au solde.
 *
 * Pur (aucun DOM, aucune DB) : lu par js/core/gestion-dg-impayes.js (_dgStatut,
 * _calculerDelaiRestitution, _penaliteRetardDG) et, via le mirror js/helpers/dg-delai.global.js
 * (`window.DgDelai`), par l'assistant de départ, la tâche de l'Accueil et la fenêtre de restitution.
 * Dates en ISO AAAA-MM-JJ, arithmétique sur composants (aucun fuseau).
 *
 * Tests : __tests__/helpers/dg-delai.test.js
 */

// + n mois calendaires, recadré au dernier jour du mois cible (31/01 + 1 mois → 28/02 ou 29/02, art. 641
// CPC) : la règle de bail-echeance.js, réutilisée (une seule copie ; le mirror la lit dans BailEcheance).
import { ajouterMois } from './bail-echeance.js';

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})/;

/** Nombre de jours de `a` à `b` (positif si b est après a). null si une date est invalide. */
export function joursEntre(a, b) {
  const x = RE_ISO.exec(String(a || '')), y = RE_ISO.exec(String(b || ''));
  if (!x || !y) return null;
  return Math.round((Date.UTC(+y[1], +y[2] - 1, +y[3]) - Date.UTC(+x[1], +x[2] - 1, +x[3])) / 86400000);
}

/** Une dégradation relevée = un élément noté plus mal à la sortie qu'à l'entrée (heuristique historique
 *  de l'app : « Mauvais état », ou « État d'usage » sur un élément entré en « Bon état »). */
function _aUneDegradation(edlSortie) {
  return (edlSortie.pieces || []).some((p) => (p.elements || []).some((el) =>
    el.etatS && el.etatS !== el.etatE && (el.etatS === 'Mauvais état' || (el.etatS === "État d'usage" && el.etatE === 'Bon état'))));
}

/**
 * Conformité de l'EDL de sortie à celui d'entrée.
 *   - pas d'EDL de sortie, ou un élément dont l'état de sortie n'est pas constaté → INCONNUE (null) : « un état
 *     de sortie vide n'est JAMAIS conforme présumé » (règle gravée de js/core/edl-parcours.js, §A.6) — un EDL
 *     créé d'avance et jamais rempli ne déclenche plus « 1 mois » ni une pénalité certaine (audit DG 🟠4) ;
 *   - une dégradation relevée (heuristique historique, ci-dessus) → non conforme, même si l'EDL n'est pas fini ;
 *   - sinon conforme. (« Absent » vaut « Absent ou non applicable » dans l'app, EDL_DESC : il ne prouve rien.)
 * @param {object|null} edlSortie l'EDL de sortie qui fait foi pour CE bail (résolu par l'appelant)
 * @returns {true|false|null}
 */
export function conformiteEdlSortie(edlSortie) {
  if (!edlSortie) return null;
  const elements = (edlSortie.pieces || []).flatMap((p) => p.elements || []);
  if (!elements.length) return null;
  if (_aUneDegradation(edlSortie)) return false;
  if (elements.some((el) => el.etatS == null || String(el.etatS).trim() === '')) return null;
  return true;
}

/**
 * Point de départ du délai : la remise des clés.
 * @returns {{ iso: string, source: 'remise'|'edl'|'finEffective'|'fin' } | null}
 */
export function remiseDesCles(bail, edlSortie) {
  if (!bail) return null;
  const cands = [
    ['remise', bail.depart && bail.depart.dateSortie],
    ['edl', edlSortie && edlSortie.date],
    ['finEffective', bail.finEffective],
    ['fin', bail.fin],
  ];
  for (const [source, v] of cands) {
    const m = RE_ISO.exec(String(v || ''));
    if (m) return { iso: m[0], source };
  }
  return null;
}

/**
 * Les échéances de restitution d'un bail.
 * @returns {{ remise, source, conforme, delaiMois, limite, limiteSiConforme, limiteSinon } | null}
 *   `limite` = l'échéance APPLICABLE (1 mois si conforme, 2 mois sinon ou si la conformité est inconnue) ;
 *   `limiteSiConforme` / `limiteSinon` = les deux maximums légaux, toujours fournis.
 */
export function echeancesRestitution(bail, edlSortie) {
  const r = remiseDesCles(bail, edlSortie);
  if (!r) return null;
  const conforme = conformiteEdlSortie(edlSortie);
  const limiteSiConforme = ajouterMois(r.iso, 1), limiteSinon = ajouterMois(r.iso, 2);
  const delaiMois = conforme === true ? 1 : 2;
  return { remise: r.iso, source: r.source, conforme, delaiMois, limite: delaiMois === 1 ? limiteSiConforme : limiteSinon, limiteSiConforme, limiteSinon };
}

/**
 * Où en est le délai à une date.
 * @returns {{ etat: 'dans_le_delai'|'depassement_possible'|'en_retard', jours, joursSiConforme, joursRetard } | null}
 *   `jours` = jours restants jusqu'à l'échéance applicable (négatif = retard) ;
 *   `joursSiConforme` = jusqu'à l'échéance d'un mois quand la conformité est inconnue, sinon null.
 *   Le jour de l'échéance est encore dans le délai.
 */
export function etatDelai(ech, aujourdhui) {
  if (!ech) return null;
  const jours = joursEntre(aujourdhui, ech.limite);
  if (jours == null) return null;
  const joursSiConforme = ech.conforme === null ? joursEntre(aujourdhui, ech.limiteSiConforme) : null;
  const etat = jours < 0 ? 'en_retard' : (joursSiConforme != null && joursSiConforme < 0 ? 'depassement_possible' : 'dans_le_delai');
  return { etat, jours, joursSiConforme, joursRetard: jours < 0 ? -jours : 0 };
}

/** Périodes mensuelles COMMENCÉES entre l'échéance et la restitution (0 si pas de retard). */
export function moisCommences(limite, restitution) {
  if (!(joursEntre(limite, restitution) > 0)) return 0;
  let c = 0;
  while (joursEntre(ajouterMois(limite, c + 1), restitution) >= 0) c++;
  return ajouterMois(limite, c) === String(restitution).slice(0, 10) ? Math.max(1, c) : c + 1;
}

/**
 * Majoration de retard (art. 22) : 10 % du loyer mensuel en principal par période mensuelle commencée.
 * @param {object} ech  échéances (echeancesRestitution)
 * @param {{ loyerPrincipal:number, restitution:string, adresseNonCommuniquee?:boolean }} o
 *   `restitution` = date du virement si elle est connue, sinon le jour même (le retard court).
 * @returns {{ enRetard, moisRetard, penalite, base, dateLimite, exclue,
 *             possible: null | { depuis, moisRetard, penalite } }}
 *   `possible` : conformité inconnue seulement — la majoration qui courrait depuis l'échéance d'un mois si
 *   l'EDL de sortie s'avérait conforme. Elle se DIT, elle ne s'additionne jamais au solde.
 */
export function penaliteRetard(ech, o) {
  const base = Number(o && o.loyerPrincipal) || 0;
  const exclue = !!(o && o.adresseNonCommuniquee);
  const out = { enRetard: false, moisRetard: 0, penalite: 0, base, dateLimite: ech ? ech.limite : null, exclue, possible: null };
  const restit = RE_ISO.exec(String((o && o.restitution) || ''));
  if (!ech || !restit) return out;
  const calc = (n) => (exclue ? 0 : Math.round(n * 0.10 * base * 100) / 100);
  out.moisRetard = moisCommences(ech.limite, restit[0]);
  out.enRetard = out.moisRetard > 0;
  out.penalite = calc(out.moisRetard);
  if (ech.conforme === null) {
    const n = moisCommences(ech.limiteSiConforme, restit[0]);
    if (n > 0) out.possible = { depuis: ech.limiteSiConforme, moisRetard: n, penalite: calc(n) };
  }
  return out;
}

/**
 * État du délai en une phrase — LA formulation de l'assistant de départ, de la tâche de l'Accueil, de la
 * fiche du bien et de la carte locataire (`court`). Préfixer de « DG » / « Dépôt de garantie ».
 *   dans le délai        : « à restituer au plus tard le … · J‑n »            · court « J‑n »
 *   dépassement possible : « dépassement possible (si l'EDL de sortie est conforme) — au plus tard le … · J‑n »
 *                                                                              · court « dépassement possible »
 *   en retard            : « en retard de n j — majoration de 10 % … »         · court « retard n j »
 * J‑n compte jusqu'à la PREMIÈRE date annoncée (1 mois si la conformité est inconnue).
 */
export function texteEtatDelai(ech, et, fd, court) {
  if (!ech || !et) return '';
  const f = typeof fd === 'function' ? fd : (x) => x;
  if (et.etat === 'en_retard') {
    return court ? 'retard ' + et.joursRetard + ' j'
      : 'en retard de ' + et.joursRetard + ' j — majoration de 10 % du loyer mensuel en principal par période mensuelle commencée';
  }
  if (et.etat === 'depassement_possible') {
    return court ? 'dépassement possible'
      : "dépassement possible (si l'EDL de sortie est conforme) — au plus tard le " + f(ech.limite) + ' · J‑' + et.jours;
  }
  const j = (ech.conforme === null && et.joursSiConforme != null) ? et.joursSiConforme : et.jours;
  return court ? 'J‑' + j : 'à restituer ' + libelleEcheance(ech, fd) + ' · J‑' + j;
}

/** Texte de l'échéance, une seule formulation pour toutes les surfaces (`fd` = formatage de date de l'app). */
export function libelleEcheance(ech, fd) {
  if (!ech) return '';
  const f = typeof fd === 'function' ? fd : (x) => x;
  if (ech.conforme === null) return 'au plus tard le ' + f(ech.limiteSiConforme) + " si l'EDL de sortie est conforme, sinon le " + f(ech.limiteSinon);
  return 'au plus tard le ' + f(ech.limite) + (ech.conforme ? " (EDL de sortie conforme, 1 mois)" : " (dégradations relevées à l'EDL de sortie, 2 mois)");
}
