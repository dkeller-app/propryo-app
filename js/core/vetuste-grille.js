/**
 * core/vetuste-grille.js — GRILLE DE VÉTUSTÉ (décret n° 2016-382)
 *
 * Chiffre la part réellement imputable au locataire sur une dégradation constatée
 * à l'état des lieux de sortie, en appliquant un abattement de vétusté.
 *
 * Cadre légal (décret 2016-382 du 30 mars 2016) : si une grille est utilisée, elle
 * doit provenir d'un accord collectif de location. Le barème par défaut embarqué est
 * la grille OPAC Paris (accord collectif de référence, citée par les tribunaux). Chaque
 * type d'élément porte 4 paramètres :
 *   - vie : durée de vie théorique (années)
 *   - fr  : franchise (années initiales sans abattement)
 *   - ab  : abattement forfaitaire annuel (% par an)
 *   - res : part résiduelle (% du coût qui reste TOUJOURS à charge du locataire,
 *           même équipement amorti — plancher du décret)
 *
 * Formule : usure = (âge − franchise) × abattement/an, PLAFONNÉE à (100 % − part
 * résiduelle) ; part locataire = coût × (1 − usure). Le locataire paie donc toujours
 * au moins la part résiduelle.
 *
 * L'âge se compte depuis la VRAIE mise en service (date de pose / dernière réfection),
 * PAS depuis l'entrée du locataire — sauf si l'EDL d'entrée note l'élément « neuf »,
 * auquel cas la date de l'EDL d'entrée fait foi (charge de la preuve = bailleur).
 *
 * Module PUR (sans DB / DOM). Tests Vitest miroir : __tests__/helpers/vetuste-grille.test.js
 */

// Grille OPAC Paris — [durée de vie, franchise, abattement/an %, part résiduelle %]
export const VETUSTE_BAREME = [
  { k: 'peinture',   nom: 'Peinture / papiers peints',           vie: 7,  fr: 1, ab: 15, res: 10 },
  { k: 'moquette',   nom: 'Moquette',                            vie: 7,  fr: 1, ab: 15, res: 10 },
  { k: 'solplast_h', nom: 'Revêtement plastique (pièce humide)', vie: 10, fr: 2, ab: 10, res: 20 },
  { k: 'solplast',   nom: 'Revêtement plastique (autre pièce)',  vie: 15, fr: 5, ab: 8,  res: 20 },
  { k: 'parquet',    nom: 'Parquet / carrelage / faïence',       vie: 20, fr: 5, ab: 5,  res: 25 },
  { k: 'sanitaire',  nom: 'Appareils sanitaires',                vie: 20, fr: 5, ab: 5,  res: 25 },
  { k: 'robinet',    nom: 'Robinetterie / quincaillerie',        vie: 10, fr: 2, ab: 10, res: 20 },
  { k: 'menager',    nom: 'Appareils ménagers',                  vie: 8,  fr: 2, ab: 15, res: 10 },
  { k: 'meuble',     nom: 'Meubles sous évier',                  vie: 15, fr: 5, ab: 8,  res: 20 },
  { k: 'menuiserie', nom: 'Menuiseries int./ext.',              vie: 20, fr: 5, ab: 5,  res: 25 },
  { k: 'volet',      nom: 'Volets roulants',                     vie: 10, fr: 2, ab: 10, res: 20 },
  { k: 'store',      nom: 'Stores',                              vie: 5,  fr: 1, ab: 20, res: 20 },
  { k: 'chauffage',  nom: 'Chauffage / radiateurs',              vie: 25, fr: 5, ab: 4,  res: 20 },
  { k: 'plomberie',  nom: 'Plomberie / canalisations',           vie: 15, fr: 5, ab: 8,  res: 20 },
  { k: 'elec',       nom: 'Réseau électrique',                   vie: 20, fr: 5, ab: 5,  res: 25 }
];

/** Sources de preuve de l'ancienneté (charge du bailleur). */
export const VETUSTE_SOURCES = {
  facture:  'Facture / devis de pose',
  edl_neuf: "« Neuf » à l'EDL d'entrée",
  estim:    'Estimation (à justifier)'
};

/** Retourne les paramètres de grille pour un type (repli sur le 1er si inconnu). */
export function vetusteParams(k, bareme) {
  const b = Array.isArray(bareme) && bareme.length ? bareme : VETUSTE_BAREME;
  for (let i = 0; i < b.length; i++) if (b[i] && b[i].k === k) return b[i];
  return b[0];
}

/** Âge en années révolues entre une mise en service et une date de référence (= today si absente). */
export function vetusteAge(miseEnServiceISO, refISO) {
  if (!miseEnServiceISO) return 0;
  const mes = new Date(String(miseEnServiceISO).slice(0, 10) + 'T00:00:00');
  const ref = refISO ? new Date(String(refISO).slice(0, 10) + 'T00:00:00')
                     : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(mes.getTime()) || Number.isNaN(ref.getTime())) return 0;
  let y = ref.getFullYear() - mes.getFullYear();
  const m = ref.getMonth() - mes.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < mes.getDate())) y--;
  return Math.max(0, y);
}

/** Fraction d'usure de vétusté [0..(1−res)] pour un âge donné. */
export function vetusteUsure(params, ageAnnees) {
  if (!params) return 0;
  const raw = Math.max(0, (Number(ageAnnees) || 0) - (Number(params.fr) || 0)) * ((Number(params.ab) || 0) / 100);
  const cap = (100 - (Number(params.res) || 0)) / 100;
  return Math.min(cap, Math.max(0, raw));
}

/** Part locataire (€, arrondie au centime) = coût × (1 − usure). */
export function vetustePart(cout, params, ageAnnees) {
  const u = vetusteUsure(params, ageAnnees);
  return Math.round(((Number(cout) || 0) * (1 - u)) * 100) / 100;
}

/**
 * Calcule une ligne de grille.
 * @param {object} ligne - { piece, type, cout, source:'facture'|'edl_neuf'|'estim', mes:ISO, edlEntreeDate?:ISO }
 * @param {object} [ctx] - { refDate:ISO (= date EDL sortie / today), bareme?:Array }
 * @returns {{ age, usurePct, part, params, aJustifier }}
 */
export function computeVetusteLigne(ligne, ctx) {
  ligne = ligne || {};
  ctx = ctx || {};
  const params = vetusteParams(ligne.type, ctx.bareme);
  // « Neuf » à l'EDL d'entrée → l'ancre est la date de l'EDL d'entrée (preuve acceptée).
  // Cette date peut être portée par la ligne (ligne.edlEntreeDate) ou, plus couramment,
  // par le contexte commun (ctx.edlEntreeDate = date de l'EDL d'entrée du logement).
  const anchor = (ligne.source === 'edl_neuf')
    ? (ligne.edlEntreeDate || ctx.edlEntreeDate || ligne.mes)
    : ligne.mes;
  const age = vetusteAge(anchor, ctx.refDate);
  const usure = vetusteUsure(params, age);
  const part = Math.round(((Number(ligne.cout) || 0) * (1 - usure)) * 100) / 100;
  return {
    age,
    usurePct: Math.round(usure * 100),
    part,
    params,
    aJustifier: ligne.source === 'estim' || !anchor
  };
}

/**
 * Total des parts locataire sur un ensemble de lignes.
 * @returns {{ total, nbAJustifier, rows:Array }}
 */
export function computeVetusteTotal(lignes, ctx) {
  let total = 0, nbAJustifier = 0;
  const rows = [];
  (lignes || []).forEach(l => {
    const r = computeVetusteLigne(l, ctx);
    total += r.part;
    if (r.aJustifier) nbAJustifier++;
    rows.push(Object.assign({}, l, r));
  });
  return { total: Math.round(total * 100) / 100, nbAJustifier, rows };
}
