/**
 * core/pilotage-familles.js — Lot 1a KPI (CDC-KPI §2.2/§2.3/§2.4).
 *
 * L'AGRÉGATEUR DES 8 FAMILLES d'alerte de l'écran Pilotage.
 *
 * Les MOTEURS existants disent QUI est concerné (AlertRules, byLot de Finances,
 * _computeOccupationLots, computeEntretienStatut, _computeUnifiedTodo). Ce module ne
 * recalcule rien : il REGROUPE ces éléments en 8 familles, les ORDONNE par coût du retard,
 * COMPTE, et choisit le PIRE CAS nommé de chaque famille — la seule logique de présentation
 * partagée entre bulles, feuille de détail et filtre de matrice.
 *
 * Module PUR : reçoit des tableaux d'items déjà normalisés (injection), aucune dépendance DB
 * ni DOM. Une famille sans item n'a pas de carte (CDC §2.4 : « une famille vide n'existe pas »).
 *
 * Registre R-1 : les libellés sont à l'infinitif, objet + à + verbe.
 */

/**
 * Définition des 8 familles, dans l'ordre EXACT d'affichage = ce que le retard coûte.
 *   zone   : 'argent' | 'gestion' (regroupement = zones de la sidebar, CDC §2.3)
 *   couleur: 'rouge' (se périme / pénalité) | 'orange' (on te doit / à faire) | 'gris' (perte lente)
 *   lbl    : titre de la bulle (objet + à + verbe)
 *   unite  : suffixe du montant, ou '' si la famille n'a pas d'euros
 * L'ordre du tableau EST l'ordre de rendu.
 */
export const FAMILLES = [
  { id: 'depot', zone: 'argent', couleur: 'rouge', lbl: 'Dépôts à restituer', unite: '€' },
  { id: 'irl', zone: 'argent', couleur: 'rouge', lbl: 'Loyers à réviser', unite: '€/mois' },
  { id: 'impaye', zone: 'argent', couleur: 'orange', lbl: 'Impayés à relancer', unite: '€' },
  { id: 'regul', zone: 'argent', couleur: 'orange', lbl: 'Régularisations à émettre', unite: '' },
  { id: 'finbail', zone: 'gestion', couleur: 'rouge', lbl: 'Fins de bail à préparer', unite: '' },
  { id: 'document', zone: 'gestion', couleur: 'rouge', lbl: 'Documents à renouveler', unite: '' },
  // TRAVAUX : QUI PAIE ? (13/10/2026) — incidents non résolus (registre de la fiche logement).
  { id: 'incident', zone: 'gestion', couleur: 'orange', lbl: 'Incidents à traiter', unite: '' },
  { id: 'entretien', zone: 'gestion', couleur: 'orange', lbl: 'Entretiens à réaliser', unite: '' },
  { id: 'vacant', zone: 'gestion', couleur: 'gris', lbl: 'Logements à relouer', unite: '€', negatif: true },
];

/**
 * Familles affichées SEULEMENT quand elles ont des éléments (décision Didier 13/10 : la bulle
 * « Incidents à traiter » n'apparaît que s'il y a des incidents ouverts). Les huit familles
 * historiques restent toujours affichées sur PC (« ✓ À jour » si vides).
 */
export const FAMILLES_SI_NON_VIDES = ['incident'];

const _FAM_INDEX = FAMILLES.reduce((m, f, i) => { m[f.id] = i; return m; }, {});

/** Zones dans l'ordre d'affichage (Pilotage n'a rien à agir → absent). */
export const ZONES = [
  { id: 'argent', titre: 'Argent' },
  { id: 'gestion', titre: 'Gestion locative' },
];

const _r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Trie les items d'une famille par urgence DÉCROISSANTE : le pire d'abord.
 * Critère par famille — un item porte les champs que son moteur produit :
 *   depot/document/finbail/regul : `urgenceJours` (petit = urgent : jours restants avant limite)
 *   irl                          : `urgenceJours` (jours avant prescription)
 *   impaye/vacant                : `urgenceJours` = ancienneté (grand = urgent) → négatif pour trier
 *   entretien                    : `urgenceJours` = retard (grand = urgent) → négatif
 */
function _trierItems(famId, items) {
  const anciennete = (famId === 'impaye' || famId === 'vacant' || famId === 'entretien' || famId === 'incident');
  return items.slice().sort((a, b) => {
    const ua = Number(a.urgenceJours); const ub = Number(b.urgenceJours);
    const na = isNaN(ua), nb = isNaN(ub);
    if (na && nb) return 0;
    if (na) return 1; if (nb) return -1;     // items sans repère → à la fin
    return anciennete ? (ub - ua) : (ua - ub);
  });
}

/**
 * @param {Object} input  un tableau d'items par famille (chaque item libre, mais porte au
 *   moins `ref` et de quoi le trier ; `montant` si la famille a des euros ; `nom` pour l'afficher).
 *   Clés attendues : depot, irl, impaye, regul, finbail, document, entretien, vacant.
 * @returns {{familles: Array, parZone: Array, total: number}}
 *   familles : [{ id, zone, couleur, lbl, unite, negatif?, count, montant, items, pire }]
 *              — SEULEMENT les familles non vides, dans l'ordre du coût du retard.
 *   parZone  : [{ id, titre, familles:[...], count }] pour le rendu groupé.
 *   total    : nombre total d'items toutes familles.
 */
export function computePilotageFamilles(input) {
  const src = input || {};
  const familles = [];
  let total = 0;

  FAMILLES.forEach((def) => {
    const raw = Array.isArray(src[def.id]) ? src[def.id].filter(Boolean) : [];
    if (!raw.length) return;                                  // famille vide → pas de carte
    const items = _trierItems(def.id, raw);
    const montant = def.unite ? _r2(items.reduce((s, i) => s + (Number(i.montant) || 0), 0)) : null;
    total += items.length;
    familles.push({
      id: def.id, zone: def.zone, couleur: def.couleur, lbl: def.lbl, unite: def.unite,
      negatif: !!def.negatif,
      count: items.length,
      montant: (montant == null ? null : (def.negatif ? -montant : montant)),
      items,
      pire: items[0] || null,                                 // items déjà trié : le pire est en tête
    });
  });

  // Les familles sont déjà dans l'ordre global (FAMILLES) car on itère dessus.
  const parZone = ZONES.map((z) => {
    const fs = familles.filter((f) => f.zone === z.id);
    return { id: z.id, titre: z.titre, familles: fs, count: fs.reduce((s, f) => s + f.count, 0) };
  }).filter((z) => z.familles.length);

  return { familles, parZone, total };
}

/** Ordre global d'une famille (pour un test ou un tri externe). -1 si inconnue. */
export function ordreFamille(id) {
  return id in _FAM_INDEX ? _FAM_INDEX[id] : -1;
}

/**
 * Le POINT DE PAIEMENT d'un lot dans la matrice Pilotage (pastille loyer).
 *
 * « en retard » (neg) est piloté par L'ENSEMBLE des impayés de la bulle Impayés — déjà tolérant
 * « 1er du mois » (la bulle vient de `_computeImpayes` → `_loyerSoldeAjuste`, qui neutralise le
 * seul mois courant avant le 10). JAMAIS par le signe d'un solde brut, qui compterait le loyer du
 * mois courant non encore échu et mentirait « en retard » le 5 du mois. Garantit matrice == bulle.
 *
 * L'avance (adv) reste lue du solde signé (une avance = trop-perçu, non concerné par la tolérance).
 *
 * @param {boolean} hasLocataire   le lot est-il loué (sinon 'na', hors bail)
 * @param {string}  ref            réf du lot
 * @param {Set<string>|Array<string>} impayeRefs  réfs exactes de la bulle Impayés
 * @param {number}  soldeSigned    solde signé du lot (byLot.solde) — positif = avance
 * @returns {'na'|'neg'|'adv'|'pos'}
 */
export function pilotagePay(hasLocataire, ref, impayeRefs, soldeSigned) {
  if (!hasLocataire) return 'na';
  const set = (impayeRefs instanceof Set) ? impayeRefs : new Set(impayeRefs || []);
  if (set.has(ref)) return 'neg';                 // en retard = membre de la bulle (tolérant)
  if ((Number(soldeSigned) || 0) > 0.5) return 'adv';
  return 'pos';
}
