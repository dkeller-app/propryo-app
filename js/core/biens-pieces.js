/**
 * core/biens-pieces.js — la liste des pièces du logement (chantier BIENS, étapes 5 et 6).
 *
 * Décision du 13/08 : L'ÉTAT DES LIEUX EST LA BASE. La liste sert deux usages de granularité
 * différente — le bail veut les pièces (« 2 chambres »), l'EDL veut le détail (Sol, Plinthes,
 * Murs, Plafond, Autres observations). On ne fait pas deux listes : celle de l'EDL fait foi,
 * le bail n'en lit que les noms de pièces.
 *
 * CONSÉQUENCE NON NÉGOCIABLE : aucun libellé n'est écrit ici. Le kit est DÉRIVÉ à l'exécution
 * de EDL_TPL / EDL_EXTRA (index.html), passés en argument. Un seul écart de nom — « Meubles bas »
 * au lieu de « Meubles bas (portes, étagères, tiroirs) » — dédoublerait la ligne dans l'état des
 * lieux et ruinerait la reprise. Le test __tests__/helpers/biens-pieces.test.js vérifie en plus,
 * en extrayant EDL_TPL / EDL_EXTRA d'index.html, que rien ne diverge.
 *
 * Stockage : log.edlTemplate.pieces, l'emplacement qui existe DÉJÀ et a exactement la forme
 * attendue { nom, elements[] }. Pas de nouveau champ, pas de second moteur de template :
 * openNewEDLForLog() sait déjà le charger au lieu de EDL_TPL.
 */

/**
 * Sections de EDL_TPL qui ne sont PAS des pièces du logement.
 * « Extérieurs / Communs » (Garage, Cave, Terrasse, Jardin, Clôture, Sonnette, Boîte aux lettres,
 * DAAF, Poubelles, Éclairage extérieur) est la section où se constate le DÉTECTEUR DE FUMÉE :
 * elle ne figure pas dans la liste du logement et l'EDL doit continuer de l'ajouter LUI-MÊME.
 * La perdre serait une régression réglementaire.
 */
export const SECTIONS_NON_PIECES = ['Extérieurs / Communs'];

/** Élément d'EDL vide — la forme que loadLogEDLTemplate pousse directement dans _edlP. */
export function elementVide(nom) {
  return { nom: nom, etatE: '', obsE: '', photosE: [], etatS: '', obsS: '', photosS: [] };
}

const _norm = (s) => String(s == null ? '' : s).trim();
const _estChambre = (nom) => /^chambre(\s|$)/i.test(_norm(nom));

/** Le modèle générique de pièce (nom + libellés d'éléments) tel qu'il vit dans EDL_TPL/EDL_EXTRA. */
function _modele(p) {
  return { nom: p.nom, elements: (p.e || []).slice() };
}

/**
 * Kit de démarrage d'un logement neuf : EDL_TPL VERBATIM, moins les sections qui ne sont pas
 * des pièces. « Chambre 1 » est le nom par défaut de EDL_TPL — conservé tel quel.
 */
export function piecesParDefaut(edlTpl) {
  return (edlTpl || [])
    .filter(p => p && SECTIONS_NON_PIECES.indexOf(p.nom) < 0)
    .map(p => ({ nom: p.nom, elements: (p.e || []).map(elementVide) }));
}

/**
 * Catalogue des pièces ajoutables : EDL_TPL ∪ EDL_EXTRA, sections non-pièces exclues,
 * dédoublonné par nom (EDL_TPL d'abord). « Chambre » (EDL_EXTRA) sert de moule aux chambres
 * numérotées et n'apparaît donc pas comme une entrée choisissable.
 */
export function catalogueKit(edlTpl, edlExtra) {
  const out = [];
  const vus = Object.create(null);
  [].concat(edlTpl || [], edlExtra || []).forEach(p => {
    if (!p || !p.nom) return;
    if (SECTIONS_NON_PIECES.indexOf(p.nom) >= 0) return;
    if (_norm(p.nom).toLowerCase() === 'chambre') return;   // moule, pas une entrée
    if (vus[p.nom]) return;
    vus[p.nom] = 1;
    out.push(_modele(p));
  });
  return out;
}

/** Le moule des chambres : EDL_EXTRA['Chambre'], à défaut « Chambre 1 » de EDL_TPL. */
export function mouleChambre(edlTpl, edlExtra) {
  const extra = (edlExtra || []).find(p => p && _norm(p.nom).toLowerCase() === 'chambre');
  if (extra) return _modele(extra);
  const tpl = (edlTpl || []).find(p => p && _estChambre(p.nom));
  return tpl ? _modele(tpl) : { nom: 'Chambre', elements: [] };
}

/** « Chambre 1 » existe déjà → « Chambre 2 ». Numérote au-delà du plus grand numéro présent. */
export function prochainNomChambre(pieces) {
  let max = 0;
  (pieces || []).forEach(p => {
    if (!p || !_estChambre(p.nom)) return;
    const m = _norm(p.nom).match(/(\d+)\s*$/);
    max = Math.max(max, m ? parseInt(m[1], 10) : 1);
  });
  return 'Chambre ' + (max + 1);
}

/** Les libellés d'éléments proposés pour une pièce, d'après son nom (kit) — verbatim. */
export function elementsModeleFor(nom, edlTpl, edlExtra) {
  const tous = [].concat(edlTpl || [], edlExtra || []);
  const exact = tous.find(p => p && p.nom === nom);
  if (exact) return (exact.e || []).slice();
  if (_estChambre(nom)) return mouleChambre(edlTpl, edlExtra).elements;
  return [];
}

/**
 * Clause « Désignation des pièces » du bail, générée depuis la liste.
 * Les chambres sont regroupées à la position de la première : « … , 2 chambres ».
 * Rend '' si la liste est vide → l'appelant garde son repli habituel.
 */
export function designationPieces(pieces) {
  const parts = [];
  let nbChambres = 0;
  let posChambres = -1;
  (pieces || []).forEach(p => {
    const nom = _norm(p && p.nom);
    if (!nom) return;
    if (SECTIONS_NON_PIECES.indexOf(nom) >= 0) return;
    if (_estChambre(nom)) {
      nbChambres++;
      if (posChambres < 0) { posChambres = parts.length; parts.push(null); }
      return;
    }
    parts.push(nom);
  });
  if (posChambres >= 0) parts[posChambres] = nbChambres + (nbChambres > 1 ? ' chambres' : ' chambre');
  return parts.filter(Boolean).join(', ');
}

/**
 * « T3 » déduit du nombre de pièces principales (séjour / salon + chambres + bureau),
 * définition retenue par le libellé de la modale. Rend '' si indéterminable.
 */
export function typeDeduit(pieces) {
  let n = 0;
  (pieces || []).forEach(p => {
    const nom = _norm(p && p.nom).toLowerCase();
    if (!nom) return;
    if (_estChambre(nom) || nom.indexOf('séjour') === 0 || nom.indexOf('sejour') === 0
        || nom.indexOf('salon') === 0 || nom.indexOf('bureau') === 0) n++;
  });
  return n > 0 ? 'T' + n : '';
}

/**
 * Libellés des équipements communs — ceux de la modale Immeuble (imm-ec-*), qui est le point
 * de saisie réel. Ordre stable = celui de la modale.
 */
export const EC_LABELS = [
  ['ascenseur', 'Ascenseur'],
  ['gardien', 'Gardien'],
  ['interphone', 'Interphone'],
  ['digicode', 'Digicode'],
  ['videosurv', 'Vidéosurveillance'],
  ['parking_commun', 'Parking commun'],
  ['local_velos', 'Local vélos'],
  ['jardin_commun', 'Jardin commun']
];

/**
 * Clause « Parties communes » du bail, générée depuis imm.equipementsCommuns.
 * La donnée appartient au BÂTIMENT, pas au lot : elle est identique pour tous les lots et
 * se saisit une seule fois sur la fiche immeuble. Rend '' pour un logement autonome (pas
 * d'immeuble d'où hériter) → l'appelant garde son repli « Néant ».
 */
export function partiesCommunesDepuisImm(imm) {
  const ec = (imm && imm.equipementsCommuns) || null;
  if (!ec || typeof ec !== 'object') return '';
  const out = EC_LABELS.filter(([k]) => !!ec[k]).map(([, label]) => label);
  (Array.isArray(ec.customs) ? ec.customs : []).forEach(c => { const t = _norm(c); if (t) out.push(t); });
  return out.join(', ');
}
