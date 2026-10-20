/**
 * core/aide-decision-candidats.js — AIDE À LA DÉCISION : comparer les dossiers d'un même logement.
 *
 * PUR (sans DB / DOM). Une ligne par candidat, un état par critère objectif, AUCUNE note, aucun total,
 * aucun classement imposé : le propriétaire choisit, dossier par dossier (RGPD art. 22 ; CJUE C-634/21 SCHUFA).
 * Règles fixes écrites par l'humain (pas un « système d'IA » : AI Act, art. 3(1) et considérant 12).
 *
 * Critères (décisions de Didier, 16/10/2026 — CDC : mockups/CANDIDATS-AIDE-DECISION) :
 *  - Dossier : catégories de la liste légale présentes (décret n° 2015-1437) ;
 *  - Pièces : UN mot par dossier tiré des états de la vérification existante (verif-pieces.js), sans compte,
 *    sans tri, sans couleur de verdict ;
 *  - Taux d'effort : loyer charges comprises ÷ ressources nettes mensuelles, allocations comprises (toutes les
 *    ressources comptent : Défenseur des droits, guide « Louer sans discriminer » 2025). Aucun seuil légal :
 *    le repère est celui du propriétaire, aucun par défaut, le même pour tous les dossiers ; Propryo n'en suggère aucun ;
 *  - Garantie : Visale (contrôle du visa existant) / Garant / Aucune.
 * Ordre par défaut : date de réception, la plus récente d'abord, comme la liste des candidats (décision de Didier du
 * 16/10 ; l'ordre d'arrivée est un critère objectif cité par le Défenseur des droits). Tri au choix SEULEMENT sur les
 * dates et le taux d'effort.
 * Tests : __tests__/helpers/aide-decision-candidats.test.js
 */
import { categoriesManquantes, libelleGarantie } from './candidature.js';
import { ETATS_PIECE } from './verif-pieces.js';
import { visaleControle, visaleNormaliser } from './visale.js';

/** Statuts d'un dossier encore « en lice » (ni refusé, ni converti en bail). */
export const STATUTS_EN_LICE = Object.freeze(['recu', 'enCours', 'valide']);
/** Seules colonnes triables (décision 3). */
export const TRIS = Object.freeze(['recu', 'debut', 'tauxEffort']);
export const TRI_DEFAUT = Object.freeze({ cle: 'recu', sens: 'desc' });

/**
 * Sources affichées dans le détail du taux d'effort (consultées le 16/10/2026).
 *  - visale.fr : « Le montant du loyer garanti (charges comprises) est calculé en fonction des ressources du locataire,
 *    dans la limite de 50 % de ses revenus. »
 *  - Défenseur des droits, « Louer sans discriminer » (2025) : refuser de prendre en compte un revenu « du fait de [sa]
 *    nature, ou de ne les prendre en compte que partiellement, n'apparaît en revanche ni nécessaire ni approprié ».
 */
export const SOURCES = Object.freeze({
  visale: Object.freeze({ libelle: 'visale.fr', url: 'https://www.visale.fr/faq/quelles-sont-les-conditions-liees-au-loyer/' }),
  defenseur: Object.freeze({ libelle: 'Défenseur des droits, guide « Louer sans discriminer », 2025', url: 'https://www.defenseurdesdroits.fr/sites/default/files/2025-05/ddd_guide_louer-sans-discriminer_2025_20250616_0.pdf' }),
});

const _ref = (s) => String(s == null ? '' : s).trim();

/** Dossiers d'un logement à comparer : vivants, non archivés, en lice. */
export function candidatsAComparer(candidats, logRef) {
  const r = _ref(logRef);
  if (!r) return [];
  return (Array.isArray(candidats) ? candidats : []).filter((c) => c && !c._deleted && !c._archived
    && _ref(c.logRef) === r && STATUTS_EN_LICE.includes(c.statut));
}
/** La comparaison n'a de sens qu'à partir de 2 dossiers. */
export function peutComparer(candidats, logRef) {
  return candidatsAComparer(candidats, logRef).length >= 2;
}

/** Repère du propriétaire : pourcentage de 1 à 100 (une décimale au plus), sinon null (= aucun repère). */
export function normaliserRepere(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.').replace(/\s*%$/, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 10) / 10;
  return n >= 1 && n <= 100 ? n : null;
}

/** Taux d'effort en % entier (arrondi), ou null si le loyer ou les ressources manquent. */
export function tauxEffort(loyerCC, ressources) {
  const l = Number(loyerCC), r = Number(ressources);
  if (!(l > 0) || !(r > 0)) return null;
  return Math.round((l / r) * 100);
}
/** Position face au repère : null (aucun repère ou aucun taux), 'dans' (≤ repère) ou 'audessus'. */
export function situationRepere(pct, repere) {
  const rp = normaliserRepere(repere);
  if (rp == null || pct == null || !Number.isFinite(pct)) return null;
  return pct <= rp ? 'dans' : 'audessus';
}
export const MOTS_REPERE = Object.freeze({ dans: 'dans le repère', audessus: 'au-dessus du repère' });

/**
 * UN état de pièces pour le dossier (décision 2) : d'après les états de chaque pièce (VerifPieces.etatPiece) et
 * les constats de dossier de la lecture des bulletins. Ordre d'attention : à vérifier, en attente, non vérifiable, OK.
 * « Non lue » (pièce d'identité, type sans contrôle) ne compte pas. Aucun état connu → null (rien n'est affiché).
 */
export function etatPiecesDossier(etats, constatsDossier) {
  const vus = new Set((Array.isArray(etats) ? etats : []).map((e) => e && e.etat).filter(Boolean));
  if (Array.isArray(constatsDossier) && constatsDossier.length) vus.add('averif');
  const etat = ['averif', 'attente', 'nonverif', 'ok'].find((k) => vus.has(k));
  return etat ? { etat, mot: ETATS_PIECE[etat] } : null;
}

/** Dossier : complet / déclaré complet (aucune pièce, case cochée) / catégories manquantes, dans l'ordre du décret. */
export function etatDossier(categoriesFournies, declareComplet) {
  const fournies = Array.isArray(categoriesFournies) ? categoriesFournies : [];
  const manque = categoriesManquantes(fournies);
  if (!manque.length) return { etat: 'complet', manque: [] };
  if (!fournies.length && declareComplet) return { etat: 'declare', manque: [] };
  return { etat: 'manque', manque };
}

/** Garantie : type + mot + précision Visale (visa qui couvre le loyer, loyer au-dessus du visa, visa expiré). */
export function etatGarantie(cand, loyerCC, aujourdhui) {
  const mot = libelleGarantie(cand);
  const type = mot === 'Visale' ? 'visale' : mot === 'Garant' ? 'garant' : 'aucune';
  let precision = '';
  if (type === 'visale') {
    const vis = visaleNormaliser(cand.visale);
    const ctl = visaleControle(cand.visale, { loyerCC, aujourdhui });
    if (ctl.expire) precision = 'visa expiré';
    else if (ctl.depasse) precision = 'loyer au-dessus du visa';
    else if (vis && vis.loyerMax && Number(loyerCC) > 0) precision = 'couvre le loyer';
  }
  return { type, mot, precision };
}

/**
 * Une ligne de comparaison. `ctx` : { loyerCC, repere, aujourdhui, categoriesFournies, etatsPieces, constatsDossier }.
 * Les ressources sont celles saisies (`revenus`) ; `examinees` = case « Pièces examinées par le bailleur ».
 */
export function ligneComparaison(cand, ctx) {
  const c = cand || {}; const x = ctx || {};
  const ressources = Number(c.revenus) || 0;
  const pct = tauxEffort(x.loyerCC, ressources);
  return {
    id: c.id,
    recu: String(c.dateCreation || ''),
    debut: String(c.dateDebutSouhaitee || ''),
    statut: c.statut || '',
    dossier: etatDossier(x.categoriesFournies, !!c.piecesCompletes),
    pieces: etatPiecesDossier(x.etatsPieces, x.constatsDossier),
    taux: { pct, ressources, loyerCC: Number(x.loyerCC) || 0, examinees: !!c.piecesVerifiees, situation: situationRepere(pct, x.repere) },
    garantie: etatGarantie(c, x.loyerCC, x.aujourdhui),
    nom: [c.prenom, c.nom].map(_ref).filter(Boolean).join(' '),
  };
}

/** Normalise un tri demandé : clé hors liste → tri par défaut. */
export function normaliserTri(cle, sens) {
  if (!TRIS.includes(cle)) return { cle: TRI_DEFAUT.cle, sens: TRI_DEFAUT.sens };
  return { cle, sens: sens === 'asc' ? 'asc' : 'desc' };
}

/**
 * Trie les lignes (copie). Valeur absente (date vide, taux inconnu) toujours en dernier ; égalité → nom, puis id.
 */
export function trierLignes(lignes, cle, sens) {
  const t = normaliserTri(cle, sens);
  const val = (l) => t.cle === 'tauxEffort' ? (l.taux ? l.taux.pct : null) : (t.cle === 'debut' ? (l.debut || null) : (l.recu || null));
  const cmpVal = (a, b) => (typeof a === 'number' && typeof b === 'number') ? a - b : String(a).localeCompare(String(b));
  return (Array.isArray(lignes) ? lignes.slice() : []).sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va == null && vb != null) return 1;
    if (vb == null && va != null) return -1;
    if (va != null && vb != null) { const d = cmpVal(va, vb); if (d) return t.sens === 'asc' ? d : -d; }
    return String(a.nom || '').localeCompare(String(b.nom || ''), 'fr') || String(a.id || '').localeCompare(String(b.id || ''));
  });
}
