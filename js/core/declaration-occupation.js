/**
 * core/declaration-occupation.js — DÉCLARATION D'OCCUPATION (impots.gouv, « Gérer mes biens immobiliers »)
 *
 * PUR (sans DB / DOM). Aucune API DGFiP ne permet d'écrire dans ce service : l'app affiche une
 * alerte PONCTUELLE au changement de locataire (rien de persisté, pas de bulle Pilotage).
 *
 * Base légale (Légifrance, vérifiée le 25/09/2026) :
 *  - art. 1418 CGI : déclaration « avant le 1er juillet de chaque année », uniquement en cas de
 *    changement depuis la dernière déclaration ; personnes morales via l'espace professionnel.
 *  - art. 1770 terdecies CGI : « amende de 150 € par local », y compris omission ou inexactitude.
 *  - Catégories : Cerfa 1208-OD-SD (« un seul choix possible ») ; motifs de vacance verbatim.
 * CDC : docs/CDC-VISALE-GMBI.md · Tests : __tests__/helpers/declaration-occupation.test.js
 */

export const GMBI_URL = 'https://www.impots.gouv.fr/particulier/la-declaration-doccupation';

export const GMBI_CATEGORIE_TIERS = 'Votre bien est occupé par une ou plusieurs personne(s) autres que vous-même (ex : location)';
export const GMBI_CATEGORIE_VACANT = 'Votre bien est vacant (il n\'est pas occupé et est vide de meuble)';

// Cerfa 1208-OD-SD, § 3.4 — l'app ne connaît pas le motif : elle les liste, n'en choisit aucun.
export const GMBI_MOTIFS_VACANCE = [
  'Bien vacant pour des raisons personnelles',
  'Bien qui ne peut être rendu habitable qu\'au prix de travaux importants (plus de 25 % de la valeur du logement)',
  'Bien mis en location ou en vente au prix du marché et ne trouvant pas locataire ou acquéreur',
  'Bien destiné à être démoli ou faire l\'objet d\'une opération de rénovation urbaine',
];

const _ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Échéance de la campagne qui couvre un changement daté : les changements du 02/01/N au
 * 01/01/N+1 se déclarent avant le 1er juillet N+1 (service-public.gouv.fr, campagne 2026).
 * @returns {string} 'AAAA-07-01' (à lire « avant le »), '' si date invalide
 */
export function gmbiEcheance(dateIso) {
  const m = _ISO.exec(String(dateIso || ''));
  if (!m) return '';
  const y = Number(m[1]);
  const premierJanvier = m[2] === '01' && m[3] === '01';
  return (premierJanvier ? y : y + 1) + '-07-01';
}

function _occupants(bail) {
  const b = bail || {};
  const locs = Array.isArray(b.locataires) && b.locataires.length ? b.locataires : (b.nom ? [{ nom: b.nom, ddn: b.ddn, lieuNaiss: b.lieuNaiss }] : []);
  return locs
    .map(l => ({ nom: String((l && l.nom) || '').trim(), ddn: String((l && l.ddn) || ''), lieuNaiss: String((l && l.lieuNaiss) || '').trim() }))
    .filter(l => l.nom);
}

function _cleNoms(occ) {
  return occ.map(o => o.nom.toLowerCase().replace(/\s+/g, ' ').trim()).sort().join('|');
}

/** Alerte « départ » : le local devient vacant à la date de sortie. */
export function gmbiAlerteSortie({ log, bail, dateSortie }) {
  const date = String(dateSortie || '');
  if (!_ISO.test(date)) return null;
  return {
    kind: 'sortie',
    ref: (log && log.ref) || (bail && bail.ref) || '',
    date,
    echeance: gmbiEcheance(date),
    categorie: GMBI_CATEGORIE_VACANT,
    motifs: GMBI_MOTIFS_VACANCE,
    occupants: _occupants(bail),
  };
}

/**
 * Alerte « arrivée » d'un nouvel occupant. null si ce n'est pas un changement d'occupant :
 * bail repris à l'achat, renouvellement, mêmes occupants que le bail précédent.
 */
export function gmbiAlerteEntree({ log, bail, precedent }) {
  const b = bail || {};
  if (b.typeContrat === 'repris' || b.typeContrat === 'renouvellement') return null;
  const date = String(b.debut || '');
  if (!_ISO.test(date)) return null;
  const occupants = _occupants(b);
  if (!occupants.length) return null;
  if (precedent) {
    const avant = _occupants(precedent);
    if (avant.length && _cleNoms(avant) === _cleNoms(occupants)) return null;
  }
  const hc = Number(b.hc);
  return {
    kind: 'entree',
    ref: (log && log.ref) || b.ref || '',
    date,
    echeance: gmbiEcheance(date),
    categorie: GMBI_CATEGORIE_TIERS,
    loyerHC: Number.isFinite(hc) && hc > 0 ? hc : null,
    occupants,
  };
}
