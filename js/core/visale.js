/**
 * core/visale.js — GARANTIE VISALE (Action Logement)
 *
 * PUR (sans DB / DOM). Aucune API Visale n'existe : le bailleur recopie le visa, l'app contrôle.
 * Sources (visale.fr, vérifiées le 25/09/2026) :
 *  - le visa porte : n° unique, locataire(s), « Montant du loyer (charges comprises) maximum
 *    couvert », « Date de validité » ;
 *  - « le contrat de cautionnement doit être validé avant la signature du bail » ;
 *  - plafonds au 06/01/2026 : https://www.visale.fr/faq/quelles-sont-les-conditions-liees-au-loyer/
 * CDC : docs/CDC-VISALE-GMBI.md · Tests : __tests__/helpers/visale.test.js
 */

// Barème du 06/01/2026, loyer CHARGES COMPRISES. Rappel seulement : le plafond qui fait foi
// est celui inscrit sur le visa (il dépend aussi des revenus du locataire, 50 % max).
export const VISALE_PLAFONDS = {
  dateEffet: '2026-01-06',
  source: 'https://www.visale.fr/faq/quelles-sont-les-conditions-liees-au-loyer/',
  zones: [
    { lbl: 'Île-de-France', max: 1940, etudiant: 1000 },
    { lbl: 'Agglomérations de plus de 100 000 habitants, Corse, DROM', max: 1575, etudiant: 840 },
    { lbl: 'Autres communes', max: 1365, etudiant: 680 },
  ],
};

const _ISO = /^\d{4}-\d{2}-\d{2}$/;

function _montant(x) {
  if (typeof x === 'number') return Number.isFinite(x) && x > 0 ? x : null;
  const s = String(x == null ? '' : x).replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** Forme canonique du visa, ou null si aucun n° de visa (legacy `{ visaId }` accepté). */
export function visaleNormaliser(v) {
  if (!v || typeof v !== 'object') return null;
  const visaId = String(v.visaId || '').trim();
  if (!visaId) return null;
  const validite = String(v.validite || '').trim();
  return {
    visaId,
    beneficiaires: String(v.beneficiaires || '').trim(),
    loyerMax: _montant(v.loyerMax),
    validite: _ISO.test(validite) ? validite : '',
    cautionValidee: v.cautionValidee === true,
  };
}

export function visaleRenseigne(v) {
  return !!(v && String(v.visaId || '').trim());
}

/**
 * Contrôles non bloquants.
 * @param {object} v visa (forme libre, normalisée ici)
 * @param {{loyerCC:number, aujourdhui:string}} ctx loyer charges comprises du bail, date ISO du jour
 * @returns {{depasse:{loyerCC,loyerMax}|null, expire:{validite}|null}}
 */
export function visaleControle(v, ctx) {
  const vis = visaleNormaliser(v);
  const out = { depasse: null, expire: null };
  if (!vis) return out;
  const cc = Math.round((Number(ctx && ctx.loyerCC) || 0) * 100) / 100;
  if (vis.loyerMax && cc > 0 && cc > vis.loyerMax) out.depasse = { loyerCC: cc, loyerMax: vis.loyerMax };
  const auj = String((ctx && ctx.aujourdhui) || '');
  if (vis.validite && _ISO.test(auj) && auj > vis.validite) out.expire = { validite: vis.validite };
  return out;
}

/**
 * Le dossier en ligne du locataire ne transmet que le n° de visa : un complément ne doit pas
 * effacer ce que le bailleur a recopié du visa (loyer max, validité, case cautionnement).
 */
export function visaleFusionner(existant, entrant) {
  const ex = visaleNormaliser(existant);
  const inn = visaleNormaliser(entrant);
  if (!inn) return ex;
  if (!ex || ex.visaId !== inn.visaId) return inn;
  return ex;
}
