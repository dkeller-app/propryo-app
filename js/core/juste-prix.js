/**
 * core/juste-prix.js — JUSTE-PRIX DE MISE EN LOCATION.
 *   Tranche 1 : fourchette de loyer HC suggérée (Carte des loyers ANIL).
 *   Tranche 2 : TENSION du marché (zonage A/B/C + zone tendue) et ENCADREMENT des loyers.
 *
 * Module PUR (aucune lecture de DB ni du DOM, aucun fetch). L'app (app-part2) géocode l'adresse via
 * la BAN déjà utilisée (window.GeorisquesErpDetector), charge À LA DEMANDE les fichiers de données
 * (js/data/carte-loyers-2025.json, zonage-abc-2026.json, zone-tendue-2025.json,
 * encadrement-communes.json) et appelle `evaluer(input, record, options)`.
 *
 * Donnée de marché : « Carte des loyers 2025 » (ANIL / DGALN, data.gouv.fr, Licence Ouverte v2).
 *   Les indicateurs sont des loyers d'ANNONCE, CHARGES COMPRISES, pour un bien NON MEUBLÉ, en €/m².
 *   Pour afficher un loyer HORS CHARGES (ce dont Propryo a besoin), on retranche une PROVISION de
 *   charges ESTIMÉE (heuristique documentée ci-dessous, clairement « estimation »).
 *
 * TRANCHE 2 — données officielles supplémentaires (sourcées dans l'en-tête de chaque JSON) :
 *   - Zonage A/B/C (Abis/A/B1/B2/C) par code INSEE — DHUP, data.gouv.fr, Licence Ouverte v2,
 *     en vigueur 26/06/2026. Sert à DÉRIVER un niveau de tension : on INTERPRÈTE la fourchette ANIL
 *     (orienter la lecture vers le haut en marché tendu), on NE la recalcule JAMAIS.
 *   - Zone tendue (TLV, art. 232 CGI, décret 22/12/2025) par code INSEE — signal légal complémentaire.
 *   - Encadrement du NIVEAU des loyers (expérimentation art. 140 loi ELAN) : liste officielle des
 *     communes (service-public.fr F1314, vérifiée 01/11/2026). Un plafond d'encadrement est un CHIFFRE
 *     LÉGAL qui dépend du secteur géographique (quartier), de l'époque, du nombre de pièces et du
 *     meublé : il N'EST PAS déterminé par le seul code INSEE. Les grilles €/m² ne sont donc PAS
 *     intégrées (garde-fou juridique) ; on DÉTECTE l'applicabilité et on renvoie vers le simulateur
 *     officiel pour le plafond exact. La logique de bornage (`encadrementPlafond` + borne de la
 *     fourchette) est implémentée et testée pour le jour où une grille sourcée sera câblée.
 *
 * Règles arbitrées (Didier, 01-04/11/2026) :
 *   - Toujours une FOURCHETTE suggérée, jamais un verdict ; le détail se lit au clic.
 *   - Fourchette LARGE (± ~12 %), RESSERRÉE quand la fiabilité de la commune est bonne.
 *   - Loyer affiché HORS CHARGES, mention « hors charges » explicite, provision estimée juste après.
 *   - AVERTIR, JAMAIS BLOQUER (DPE F/G, classe interdite, encadrement…). L'utilisateur décide.
 *   - Commune non localisée avec certitude (score BAN < 0,5) → ni tension ni encadrement affichés.
 *   - Argent = source unique Finances : ce module N'ÉCRIT aucun loyer et NE RECALCULE aucun montant
 *     Finances ; il LIT le loyer actuel (passé en entrée) seulement pour le situer dans la fourchette.
 *
 * DPE : réutilise `_dpeInterditLocationAuDate` + la règle de gel F/G (loi Climat et Résilience,
 *   art. 17 / 17-1 loi 1989, depuis le 24/08/2022) de js/core/utils.js — aucune règle légale recopiée.
 *
 * Tests Vitest miroir : __tests__/helpers/juste-prix.test.js
 */
import { _dpeInterditLocationAuDate, _isDpeClassValide } from './utils.js';

// Indices des colonnes dans un enregistrement de type (cf. tools/build-carte-loyers.mjs) :
//   rec = [loypredm2 (€/m² CC), nbobs_com, R2_adj, TYPPRED (0=maille,1=epci,2=commune)]
const I_LOY = 0, I_NBOBS = 1, I_R2 = 2, I_TYP = 3;

/** Surfaces de référence du bien-type (guide ANIL) — informatif. */
export const SURFACES_REF = { a12: 37, a3: 72, mai: 92 };

/** Libellés des segments de la Carte des loyers. */
export const SEG_LABEL = { a12: 'appartement T1-T2', a3: 'appartement T3 et +', mai: 'maison' };

// ════════════════════════════════════════════════════════════════════════════
// ESTIMATEUR DE CHARGES RÉCUPÉRABLES — PAR ASSIETTE, POSTE PAR POSTE
// ────────────────────────────────────────────────────────────────────────────
// But : aider le propriétaire À LA PREMIÈRE MISE EN LOCATION, sans aucune donnée, à savoir
// COMBIEN de provision de charges demander ET POURQUOI, poste par poste. Marche à partir de zéro ;
// les vraies charges Propryo (module « Postes de charges ») ne sont qu'un bonus (résolu dans l'app).
//
// Chaque poste déclare SON ASSIETTE (ce qui le pilote), fondée en droit :
//   'm2'      → €/m² du logement/mois × surface  (charge générale ≈ tantièmes ≈ surface, art. 10 loi 1965)
//   'occ'     → €/occupant/mois × occupants       (consommation d'eau, SISPEA)
//   'forfait' → coût annuel de TOUT l'immeuble ÷ 12 ÷ nombre de logements (service fixe mutualisé)
// Fondements : art. 10 loi n° 65-557 du 10/07/1965 ; décret n° 87-713 du 26/08/1987 (liste limitative
// des charges récupérables) ; art. 23 loi n° 89-462 du 06/07/1989 (TEOM récupérable à 100 %).
//
// GARDE-FOU SOURCING : un seul coefficient est un CHIFFRE FERME SOURCÉ — le prix de l'eau (SISPEA). Tous
// les autres sont des ORDRES DE GRANDEUR raisonnés, dérivés de ratios publics d'observatoires de charges
// (ARC) ou de moyennes nationales (TEOM) — jamais présentés comme des montants fermes. Le champ
// `sourceType` ('sourcé' | 'ordre-de-grandeur') le porte jusqu'à l'UI. Une provision estimée se
// RÉGULARISE chaque année sur les charges réelles (art. 23 loi 1989). Les coefficients peuvent être
// surchargés par le fichier de données js/data/charges-reference.json (passé en `ref`).
// ════════════════════════════════════════════════════════════════════════════

/** Prix de l'eau SISPEA (OFB / eaufrance, rapport 2025, données 2023) — SEULE donnée FERME SOURCÉE. */
export const EAU_DEFAUT = { prixM3: 4.69, m3ParPersonneAn: 53 };

/**
 * Catalogue des postes de charges récupérables, avec assiette, coefficient par défaut, explication et
 * source. `quand(s)` décide l'applicabilité (logique en code, testée) ; les coefficients/sources peuvent
 * être surchargés par le fichier de données (ref.postes[k]). `sourceType` distingue le chiffre FERME
 * SOURCÉ (eau) des ORDRES DE GRANDEUR (tous les autres).
 */
export const CHARGES_POSTES = [
  { k: 'entretien', nm: 'Entretien & ménage des communs', icon: 'broom', assiette: 'm2', perM2Mois: 0.35,
    pourquoi: "Nettoyage, éclairage et menu entretien du hall et des couloirs. Charge générale répartie aux tantièmes (≈ la surface du logement) — art. 10, loi du 10/07/1965.",
    source: "Ordre de grandeur · ratios d'observatoires de charges (ARC) · décret 87-713", sourceType: 'ordre-de-grandeur',
    quand: (s) => s.appart && s.copro },
  { k: 'verts', nm: 'Espaces verts communs', icon: 'tree', assiette: 'm2', perM2Mois: 0.08,
    pourquoi: "Tonte, taille et arrosage. Charge générale, répartie aux tantièmes (≈ la surface du logement).",
    source: "Ordre de grandeur · décret 87-713 · loi 1965 art. 10", sourceType: 'ordre-de-grandeur',
    quand: (s) => s.appart && s.verts },
  { k: 'gardien', nm: 'Gardien / concierge', icon: 'concierge', assiette: 'forfait', forfaitAn: 18000,
    pourquoi: "Part récupérable de la rémunération (75 % s'il assure entretien ET sortie des poubelles). Un salaire d'immeuble partagé entre les logements.",
    source: "Ordre de grandeur · part récupérable 75 % · décret 87-713", sourceType: 'ordre-de-grandeur',
    quand: (s) => s.appart && s.gardien },
  { k: 'ascenseur', nm: 'Ascenseur (entretien)', icon: 'elevator', assiette: 'forfait', forfaitAn: 2200,
    pourquoi: "Contrat d'entretien d'immeuble partagé entre les logements (service collectif, art. 10 loi 1965). Le remplacement de l'appareil reste à la charge du propriétaire, non récupérable.",
    source: "Ordre de grandeur · ~180 €/lot/an (ARC, Fédération des ascenseurs) · décret 87-713", sourceType: 'ordre-de-grandeur',
    quand: (s) => s.appart && s.ascenseur },
  { k: 'chauffage', nm: 'Chauffage collectif', icon: 'flame', assiette: 'm2', perM2Mois: 0.85,
    pourquoi: "Combustible + entretien de la chaudière. Proportionnel à la surface chauffée — le plus gros poste quand il existe.",
    source: "Ordre de grandeur · ratios d'observatoires de charges (ARC)", sourceType: 'ordre-de-grandeur',
    quand: (s) => s.appart && s.chauffColl },
  { k: 'eau', nm: 'Eau (compteur collectif)', icon: 'drop', assiette: 'occ',
    pourquoi: "Sur les occupants, pas la surface (~53 m³/personne/an × 4,69 €/m³). En compteur individuel, le locataire paie en direct → non repris ici.",
    source: "SISPEA (OFB / eaufrance), rapport 2025 — 4,69 €/m³ × 53 m³/pers./an", sourceType: 'sourcé',
    quand: (s) => s.appart && s.eauColl },
  { k: 'teom', nm: 'Ordures ménagères (TEOM)', icon: 'trash', assiette: 'm2', perM2Mois: 0.21,
    pourquoi: "Taxe assise sur la valeur locative du logement (≈ surface), récupérable à 100 %. Elle varie selon le taux voté par la commune ; certaines communes facturent au service (REOM).",
    source: "Moyenne nationale · récupérable à 100 % (art. 23 loi 1989) · affinée par commune prochainement", sourceType: 'ordre-de-grandeur',
    quand: () => true }
];

/** Largeur de la demi-fourchette selon la fiabilité de l'indicateur communal. */
export const FOURCHETTE_WIDTH = { bon: 0.08, moyen: 0.12, faible: 0.16 };

const _r5 = (n) => Math.round(n / 5) * 5;           // arrondi au pas de 5 €
const _r2d = (n) => Math.round(n * 100) / 100;      // arrondi 2 décimales

/**
 * Choisit le segment de la Carte des loyers (a12 / a3 / mai) à partir du bien.
 * Maison → 'mai'. Appartement : T1-T2 (≤2 pièces) → 'a12', sinon 'a3'. Pièces inconnues : repli sur la
 * surface (réf. T1-T2 37 m² / T3+ 72 m², seuil médian ~55 m²), défaut 'a3' (appartement familial).
 */
export function choisirSegment({ maison, nbPieces, surf } = {}) {
  if (maison) return 'mai';
  const n = Number(nbPieces);
  if (Number.isFinite(n) && n > 0) return n <= 2 ? 'a12' : 'a3';
  const s = Number(surf);
  if (Number.isFinite(s) && s > 0) return s < 55 ? 'a12' : 'a3';
  return 'a3';
}

/**
 * Niveau de fiabilité d'un enregistrement de type (guide ANIL : prudence si R² < 0,5, ou nbobs_com < 30,
 * ou prédiction au niveau d'une maille). Retourne { niveau: 'bon'|'moyen'|'faible', ... }.
 */
export function fiabiliteSegment(rec) {
  if (!Array.isArray(rec)) return { niveau: 'faible', nbobs: 0, r2: 0, typ: 0, label: 'indéterminée' };
  const nbobs = +rec[I_NBOBS] || 0, r2 = +rec[I_R2] || 0, typ = +rec[I_TYP] || 0;
  let niveau;
  if (r2 < 0.5 || nbobs < 30) niveau = 'faible';   // seuils de prudence du guide
  else if (typ === 2) niveau = 'bon';              // prédiction au niveau communal (≥100 obs) + R² bon + ≥30 obs
  else niveau = 'moyen';                           // epci/maille mais R² bon et ≥30 obs commune
  const label = niveau === 'bon' ? 'bonne' : (niveau === 'moyen' ? 'moyenne' : 'à prendre avec prudence');
  const typLabel = typ === 2 ? 'commune' : (typ === 1 ? 'EPCI' : 'maille (communes voisines)');
  return { niveau, nbobs, r2, typ, label, typLabel };
}

/**
 * Nombre d'occupants PRÉVU par défaut à partir du nombre de pièces principales (T2≈2, T4≈4), borné
 * 1..8. Pièces inconnues → 2 (foyer type). Sert UNIQUEMENT à l'eau (compteur collectif) — modifiable.
 */
export function occupantsParDefaut(nbPieces) {
  const n = Number(nbPieces);
  if (!Number.isFinite(n) || n <= 0) return 2;
  return Math.min(8, Math.max(1, Math.round(n)));
}

/** Coefficient €/occupant/mois de l'eau (prix m³ × conso annuelle ÷ 12), surchargé par ref.eau. */
function _perOccEau(ref) {
  const e = (ref && ref.eau) || {};
  const prixM3 = +e.prixM3 > 0 ? +e.prixM3 : EAU_DEFAUT.prixM3;
  const m3 = +e.m3ParPersonneAn > 0 ? +e.m3ParPersonneAn : EAU_DEFAUT.m3ParPersonneAn;
  return (prixM3 * m3) / 12;
}

/**
 * Estime les charges RÉCUPÉRABLES mensuelles, POSTE PAR POSTE, par assiette. Fonction PURE : marche
 * à partir de zéro (aucune donnée Propryo requise). Entrées :
 *   { surf, maison, copro, nbPieces, occupants, nbLogements,
 *     chauffageColl, eauColl (ou ecsColl), equip:{ascenseur,verts,gardien} }
 * @param {object} ref - fichier js/data/charges-reference.json (surcharge coefficients/sources) ou null.
 * @returns {{ indisponible:boolean, total:number, perM2Annuel:number, occupants:number,
 *   nbLogements:number, lignes:Array<{k,nm,icon,assiette,assietteLabel,montant,pourquoi,source,sourceType}> }}
 */
export function estimerChargesParPoste(input = {}, ref = null) {
  const surf = Number(input.surf);
  const out = { indisponible: false, total: 0, perM2Annuel: 0, occupants: 0, nbLogements: 0, lignes: [] };
  if (!Number.isFinite(surf) || surf <= 0) { out.indisponible = true; return out; }

  const appart = !input.maison;
  const copro = appart && (input.copro !== false);
  const equip = input.equip || {};
  const occupants = (Number.isFinite(+input.occupants) && +input.occupants > 0)
    ? Math.min(8, Math.max(1, Math.round(+input.occupants))) : occupantsParDefaut(input.nbPieces);
  const nbLog = (Number.isFinite(+input.nbLogements) && +input.nbLogements > 0) ? Math.round(+input.nbLogements) : 1;
  out.occupants = occupants; out.nbLogements = nbLog;

  const s = {
    appart, copro,
    chauffColl: !!input.chauffageColl,
    eauColl: (input.eauColl != null) ? !!input.eauColl : !!input.ecsColl,
    ascenseur: !!equip.ascenseur, verts: !!equip.verts, gardien: !!equip.gardien
  };

  for (const p of CHARGES_POSTES) {
    if (!p.quand(s)) continue;
    const o = (ref && ref.postes && ref.postes[p.k]) || null;
    const src = (o && o.source) || p.source;
    const srcType = (o && o.sourceType) || p.sourceType;
    let montant = 0, assietteLabel = '';
    if (p.assiette === 'm2') {
      const perM2 = (o && +o.perM2Mois > 0) ? +o.perM2Mois : p.perM2Mois;
      montant = perM2 * surf; assietteLabel = 'selon ' + surf + ' m²';
    } else if (p.assiette === 'occ') {
      montant = _perOccEau(ref) * occupants;
      assietteLabel = 'selon ' + occupants + ' occupant' + (occupants > 1 ? 's' : '');
    } else if (p.assiette === 'forfait') {
      const forfaitAn = (o && +o.forfaitAn > 0) ? +o.forfaitAn : p.forfaitAn;
      montant = forfaitAn / 12 / nbLog;
      assietteLabel = 'part immeuble ÷ ' + nbLog + ' logement' + (nbLog > 1 ? 's' : '');
    }
    montant = Math.max(0, Math.round(montant));
    out.lignes.push({ k: p.k, nm: p.nm, icon: p.icon, assiette: p.assiette, assietteLabel, montant, pourquoi: p.pourquoi, source: src, sourceType: srcType });
    out.total += montant;
  }
  out.perM2Annuel = surf > 0 ? _r2d((out.total * 12) / surf) : 0;
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// TRANCHE 2 — TENSION DU MARCHÉ (zonage A/B/C + zone tendue)
// ────────────────────────────────────────────────────────────────────────────
// Fonctions PURES. Les gros fichiers de données (zonage, zone tendue, encadrement) sont
// chargés par l'app et passés en argument ; un index Map est mémoïsé par objet (WeakMap).
// ════════════════════════════════════════════════════════════════════════════

/**
 * Ramène un code INSEE d'ARRONDISSEMENT municipal (Paris 751xx, Lyon 6938x, Marseille 132xx —
 * ce que renvoie la BAN) au code INSEE de la COMMUNE au Code officiel géographique (75056 / 69123 /
 * 13055), car les jeux officiels zonage/encadrement sont indexés par commune. Les autres codes
 * sont renvoyés tels quels.
 */
export function communeInseeCanonique(insee) {
  const s = String(insee == null ? '' : insee).trim();
  if (/^751\d\d$/.test(s)) return '75056';   // arrondissements de Paris
  if (/^6938\d$/.test(s)) return '69123';    // arrondissements de Lyon
  if (/^132\d\d$/.test(s)) return '13055';   // arrondissements de Marseille
  return s;
}

const _abcMapCache = new WeakMap();
const _tlvMapCache = new WeakMap();

/**
 * Zone A/B/C d'une commune (par ordre décroissant de tension : Abis, A, B1, B2, C).
 * @param {string} insee - code INSEE (arrondissement accepté, normalisé).
 * @param {object} zonage - contenu de zonage-abc-2026.json ({ zones:{Abis,A,B1,B2}, defaut:'C' }).
 * @returns {'Abis'|'A'|'B1'|'B2'|'C'|null} - C = reste du territoire (défaut du jeu) ; null si jeu absent.
 */
export function zoneABCDeCommune(insee, zonage) {
  if (!zonage || !zonage.zones) return null;
  let m = _abcMapCache.get(zonage);
  if (!m) {
    m = new Map();
    for (const z of ['Abis', 'A', 'B1', 'B2']) for (const i of (zonage.zones[z] || [])) m.set(i, z);
    _abcMapCache.set(zonage, m);
  }
  return m.get(communeInseeCanonique(insee)) || zonage.defaut || 'C';
}

/**
 * Statut « zone tendue » (art. 232 CGI / TLV) d'une commune.
 * @returns {0|1|2|null} 0 = non tendue, 1 = zone tendue, 2 = zone touristique et tendue, null = jeu absent.
 */
export function tlvDeCommune(insee, tlv) {
  if (!tlv) return null;
  let m = _tlvMapCache.get(tlv);
  if (!m) {
    m = new Map();
    for (const i of (tlv.tendue || [])) m.set(i, 1);
    for (const i of (tlv.touristiqueTendue || [])) m.set(i, 2);
    _tlvMapCache.set(tlv, m);
  }
  return m.get(communeInseeCanonique(insee)) || 0;
}

/** Niveaux de tension et conseil de lecture associé (ton neutre, infinitif). */
export const TENSION_NIV = {
  tresTendu: { cle: 'tres-tendu', label: 'marché très tendu', conseil: 'viser le haut de la fourchette' },
  tendu:     { cle: 'tendu',      label: 'marché tendu',       conseil: 'se situer plutôt vers le haut de la fourchette' },
  modere:    { cle: 'modere',     label: 'marché modéré',      conseil: 'se situer vers le milieu de la fourchette' },
  detendu:   { cle: 'detendu',    label: 'marché détendu',     conseil: 'rester vers le bas de la fourchette' },
  inconnu:   { cle: 'inconnu',    label: 'tension non déterminée', conseil: '' }
};

/**
 * Dérive un niveau de tension à partir de la zone A/B/C (signal structurel) et du statut zone tendue
 * (signal légal, qui peut relever un B2/C). On INTERPRÈTE la fourchette ANIL, on ne la recalcule pas.
 * @param {{zoneABC:?string, tlv:?number}} o
 * @returns {{niveau, cle, label, conseil, zoneABC, tlv, zoneTendue:boolean, touristiqueTendue:boolean}}
 */
export function tensionDeCommune({ zoneABC, tlv } = {}) {
  const t = +tlv || 0;
  let niveau;
  if (zoneABC === 'Abis' || zoneABC === 'A') niveau = 'tresTendu';
  else if (zoneABC === 'B1') niveau = 'tendu';
  else if (zoneABC === 'B2') niveau = t > 0 ? 'tendu' : 'modere';
  else if (zoneABC === 'C') niveau = t > 0 ? 'modere' : 'detendu';
  else niveau = 'inconnu';
  return {
    niveau, ...TENSION_NIV[niveau],
    zoneABC: zoneABC || null, tlv: t,
    zoneTendue: t === 1, touristiqueTendue: t === 2
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TRANCHE 2 — ENCADREMENT DU NIVEAU DES LOYERS (plafonnement)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Détecte si une commune applique l'encadrement du niveau des loyers (plafonnement).
 * NE renvoie JAMAIS de plafond €/m² : celui-ci dépend du quartier/époque/pièces/meublé et se vérifie
 * sur le simulateur officiel (garde-fou juridique — un plafond est un chiffre légal).
 * @param {string} insee
 * @param {object} data - contenu de encadrement-communes.json.
 * @returns {{applicable:boolean, territoire?, nom?, depuis?, couverture?, grilleDisponible?, simulateur?, fiche?}}
 */
export function encadrementDeCommune(insee, data) {
  if (!data || !data.communes) return { applicable: false };
  const c = data.communes[communeInseeCanonique(insee)];
  if (!c) return { applicable: false };
  const terr = (data.territoires || {})[c.territoire] || {};
  return {
    applicable: true,
    territoire: c.territoire,
    nom: terr.nom || '',
    depuis: terr.depuis || null,
    couverture: c.couverture || 'totale',   // 'totale' | 'partielle' (une partie de la commune seulement)
    grilleDisponible: false,                 // aucune grille €/m² intégrée (voir en-tête)
    simulateur: data.simulateurOfficiel || '',
    fiche: data.ficheOfficielle || ''
  };
}

/**
 * Plafond légal d'encadrement = loyer de référence MAJORÉ (€/m²) × surface. Fonction PURE, prête à
 * être utilisée le jour où une grille officielle sourcée fournit le loyer de référence majoré du
 * secteur. N'INVENTE aucun chiffre : si l'entrée est incomplète → null.
 * @param {{loyerRefMajoreM2:number, surf:number}} o
 * @returns {{plafondM2:number, plafond:number}|null}
 */
export function encadrementPlafond({ loyerRefMajoreM2, surf } = {}) {
  const m2 = Number(loyerRefMajoreM2), s = Number(surf);
  if (!Number.isFinite(m2) || m2 <= 0 || !Number.isFinite(s) || s <= 0) return null;
  return { plafondM2: _r2d(m2), plafond: Math.round(m2 * s) };
}

// ════════════════════════════════════════════════════════════════════════════
// TRANCHE 3 — RECOUPEMENT MULTI-SOURCES (OLL « loyers pratiqués » + détection d'aberration)
// ────────────────────────────────────────────────────────────────────────────
// Deuxième source : les Observatoires Locaux des Loyers (loyers RÉELLEMENT PRATIQUÉS, HORS CHARGES,
// médiane €/m²), là où un observatoire couvre la commune (js/data/oll-loyers.json — ~48 agglos).
// La Carte des loyers ANIL = loyers d'ANNONCE charges comprises : surévalue souvent, surtout les
// petites surfaces et les mailles. L'OLL ancre le bas (pratiqué) ; l'ANIL borne le haut (annonce).
// On AVERTIT (coherence/flags) et on ÉLARGIT la fourchette quand les sources divergent — jamais un
// point faussement précis. Fonctions PURES ; aucune invention de chiffre légal.
// ════════════════════════════════════════════════════════════════════════════

/** Paramètres du recoupement (seuils documentés, pas de constante magique cachée). */
export const RECOUP = {
  seuilOllNobs: 50,   // nb d'obs. minimal pour retenir l'ancre OLL (= règle de diffusion OLL)
  aberrA12A3: 1.45,   // ratio €/m² T1-T2 ÷ T3+ au-delà duquel l'indicateur ANIL petite surface est jugé suspect
  ecartBon: 0.12,     // écart relatif ANIL/OLL ≤ 12 % → sources concordantes
  ecartDiv: 0.30,     // écart relatif > 30 % → sources divergentes (une annonce reste normalement 15-28 %
                      //   au-dessus du loyer pratiqué : au-delà de 30 %, l'une des deux sources est douteuse)
  widthMin: 0.16      // demi-fourchette minimale en cas de divergence/fragilité
};

const _ollMapCache = new WeakMap();

/**
 * Loyer de référence OLL (loyer PRATIQUÉ médian HORS CHARGES, €/m²) pour une commune et un segment.
 * @param {string} insee - code INSEE (arrondissement accepté, normalisé en commune COG).
 * @param {'a12'|'a3'|'mai'} seg - segment (aligné sur la Carte des loyers).
 * @param {object} oll - contenu de oll-loyers.json ({ meta, zones:{Lxxxx:{n,dep,a12,a3,mai,ens}}, communes:{insee:Lxxxx} }).
 * @returns {{euroM2HC:number, nobs:number, zone:string, nom:string, dep:string, millesime:?number}|null}
 *   null si pas d'observatoire sur la commune ou si le segment n'est pas publié (on ne retombe PAS sur
 *   l'ensemble du parc : un €/m² « toutes typologies » n'est pas comparable à un segment précis).
 */
export function ollReference(insee, seg, oll) {
  if (!oll || !oll.zones || !oll.communes) return null;
  let idx = _ollMapCache.get(oll);
  if (!idx) { idx = oll.communes; _ollMapCache.set(oll, idx); }
  const code = idx[communeInseeCanonique(insee)] || idx[String(insee == null ? '' : insee).trim()];
  if (!code) return null;
  const z = oll.zones[code];
  const rec = z && z[seg];
  if (!Array.isArray(rec) || !(+rec[0] > 0)) return null;
  return {
    euroM2HC: +rec[0], nobs: +rec[1] || 0,
    zone: code, nom: (z && z.n) || '', dep: (z && z.dep) || '',
    millesime: (oll.meta && oll.meta.millesime) || null
  };
}

/**
 * Recoupe l'ancre ANIL (annonce) et l'ancre OLL (pratiqué) en une fourchette HONNÊTE.
 * @param {object} o
 * @param {{hc:number, ceiling?:number, floor?:number, typ?:number}} o.anil
 *   hc = loyer HC central dérivé de l'ANIL (déjà ajusté en cas d'aberration) ;
 *   ceiling = niveau « annonce » (borne haute réaliste pour une MISE EN LOCATION) ;
 *   floor = plancher implicite éventuel (ex. niveau T3+ de la commune) ; typ = TYPPRED ANIL.
 * @param {{hc:number, nobs:number}|null} o.oll - loyer HC pratiqué (€) de l'OLL, ou null.
 * @param {boolean} o.aberration - incohérence intra-ANIL détectée (petite surface suspecte).
 * @param {number} o.width - demi-fourchette de base (fiabilité ANIL).
 * @returns {{central, basse, haute, width, sources:string[], coherence, flags:string[], ecart:?number}}
 *   coherence ∈ 'bonne'|'moyenne'|'divergente'|'fragile'|'source-unique'.
 */
export function recouper({ anil, oll, aberration, width } = {}) {
  anil = anil || {};
  let w = Number.isFinite(width) ? width : FOURCHETTE_WIDTH.moyen;
  const flags = [], sources = ['anil'];
  let central = Number(anil.hc) || 0, coherence = 'source-unique', ecart = null;

  const hasOll = oll && Number(oll.hc) > 0 && (+oll.nobs || 0) >= RECOUP.seuilOllNobs;
  if (hasOll) {
    sources.push('oll');
    const moy = (central + oll.hc) / 2 || 1;
    ecart = Math.abs(central - oll.hc) / moy;
    const wO = (anil.typ != null && anil.typ < 2) ? 0.6 : 0.5;   // l'OLL pèse plus si l'ANIL est sur une maille/EPCI
    central = wO * oll.hc + (1 - wO) * central;
    coherence = ecart <= RECOUP.ecartBon ? 'bonne' : (ecart <= RECOUP.ecartDiv ? 'moyenne' : 'divergente');
    if (coherence === 'divergente') { flags.push('sources-divergentes'); w = Math.max(w, RECOUP.widthMin); }
  }
  if (aberration) {
    flags.push('anil-petite-surface');
    w = Math.max(w, RECOUP.widthMin);
    if (coherence === 'source-unique' || coherence === 'bonne') coherence = 'fragile';
  }

  let basse = central * (1 - w);
  let haute = central * (1 + w);
  const ceiling = Number.isFinite(anil.ceiling) ? anil.ceiling : central;
  haute = Math.max(haute, ceiling);                               // l'annonce ANIL borne le haut
  if (hasOll) { basse = Math.min(basse, oll.hc); haute = Math.max(haute, oll.hc); }  // ancre OLL dans la fourchette
  if (Number.isFinite(anil.floor) && anil.floor > 0) basse = Math.min(basse, anil.floor);
  basse = Math.max(0, basse); haute = Math.max(0, haute);

  // Largeur EFFECTIVE (honnête) : quand le recoupement élargit la fourchette au-delà du ± de base,
  // le libellé « ± X % » doit refléter la fourchette réellement affichée (demi-amplitude max autour du centre).
  const effWidth = central > 0 ? Math.max((central - basse) / central, (haute - central) / central) : w;

  return {
    central, basse, haute, width: _r2d(effWidth),
    sources, coherence, flags, ecart: ecart == null ? null : _r2d(ecart)
  };
}

/** Situe un loyer par rapport à une fourchette : 'sous' | 'dans' | 'au-dessus' | 'inconnue'. */
export function positionDansFourchette(loyer, fourchette) {
  const v = Number(loyer);
  if (!fourchette || !Number.isFinite(v)) return 'inconnue';
  if (v < fourchette.basse) return 'sous';
  if (v > fourchette.haute) return 'au-dessus';
  return 'dans';
}

/**
 * Évalue la fourchette de loyer HC suggérée pour un bien.
 * @param {object} input - {
 *     surf, maison, nbPieces, chauffageColl, ecsColl, copro,
 *     dpeClasse, usageApplicable, loyerActuelHC, commune, insee }
 * @param {object|null} record - enregistrement commune du fichier : { n, a12, a3, mai } (ou null = absente).
 * @param {object} [options] - { dateRef:'YYYY-MM-DD', meta:{...source} }
 * @returns {object} suggestion (voir champs ci-dessous). Jamais d'exception sur entrée incomplète :
 *     `applicable:false` + `raison` (usage-non-applicable | surface-absente | commune-absente | segment-absent).
 */
export function evaluer(input, record, options = {}) {
  input = input || {}; options = options || {};
  const dateRef = options.dateRef || new Date().toISOString().slice(0, 10);
  const out = {
    applicable: true, raison: '',
    commune: (record && record.n) || input.commune || '', insee: input.insee || '',
    segment: null, segmentLabel: '',
    euroM2CC: null, loyerCC: null,
    provision: null,
    hcCentral: null, fourchette: null, euroM2HC: null,
    fiabilite: null,
    dpe: { classe: '', gelFG: false, interdit: false, mentions: [] },
    tension: options.tension || null,        // résultat de tensionDeCommune (résolu par l'app)
    encadrement: options.encadrement || null, // résultat de encadrementDeCommune (+ plafond éventuel)
    oll: options.oll || null,                 // résultat de ollReference (loyer pratiqué HC €/m², résolu par l'app)
    recoupement: null,                        // { sources, coherence, flags, ecart } — tranche 3
    comparaison: null,
    meta: options.meta || null
  };

  if (input.usageApplicable === false) { out.applicable = false; out.raison = 'usage-non-applicable'; return out; }
  const surf = Number(input.surf);
  if (!Number.isFinite(surf) || surf <= 0) { out.applicable = false; out.raison = 'surface-absente'; return out; }
  if (!record) { out.applicable = false; out.raison = 'commune-absente'; return out; }

  const seg = choisirSegment({ maison: input.maison, nbPieces: input.nbPieces, surf });
  const rec = record[seg] || record.a3 || record.a12 || record.mai;
  if (!Array.isArray(rec)) { out.applicable = false; out.raison = 'segment-absent'; return out; }
  out.segment = seg; out.segmentLabel = SEG_LABEL[seg];

  const euroM2CC = +rec[I_LOY];
  out.euroM2CC = _r2d(euroM2CC);
  out.loyerCC = Math.round(euroM2CC * surf);

  const prov = estimerChargesParPoste({
    surf, maison: !!input.maison, copro: input.maison ? false : (input.copro !== false),
    nbPieces: input.nbPieces, occupants: input.occupants, nbLogements: input.nbLogements,
    chauffageColl: !!input.chauffageColl,
    eauColl: (input.eauColl != null) ? !!input.eauColl : !!input.ecsColl,
    equip: input.equip
  }, options.chargesRef || null);
  out.provision = {
    montant: prov.total, perM2: surf > 0 ? _r2d(prov.total / surf) : 0, perM2Annuel: prov.perM2Annuel,
    indisponible: prov.indisponible, occupants: prov.occupants, nbLogements: prov.nbLogements,
    lignes: prov.lignes
  };

  const fia = fiabiliteSegment(rec);
  out.fiabilite = fia;
  const baseWidth = FOURCHETTE_WIDTH[fia.niveau];

  // ── ANCRE ANIL (annonce CC − provision estimée) ──
  const hcAnil = Math.max(0, out.loyerCC - prov.total);

  // ── DÉTECTION D'ABERRATION intra-ANIL : pour une PETITE SURFACE (segment T1-T2), si le €/m² d'annonce
  //    est très supérieur à celui des T3+ de la MÊME commune, l'indicateur petite surface (prime d'annonce,
  //    échantillon mince) est jugé fragile. On recentre alors sur la moyenne des deux typologies ANIL qui
  //    encadrent la petite surface et on abaisse le plancher au niveau T3+ (données ANIL de la commune,
  //    aucune invention), puis on élargit la fourchette et on flague.
  let aberration = false, hcAnilFloor = null, hcAnilCentral = hcAnil;
  if (seg === 'a12' && Array.isArray(record.a3) && +record.a3[I_LOY] > 0) {
    const ratio = (+rec[I_LOY]) / (+record.a3[I_LOY]);
    if (ratio >= RECOUP.aberrA12A3) {
      aberration = true;
      hcAnilFloor = Math.max(0, Math.round((+record.a3[I_LOY]) * surf) - prov.total);
      hcAnilCentral = Math.round((hcAnil + hcAnilFloor) / 2);
    }
  }

  // ── ANCRE OLL (loyer pratiqué HC, résolu par l'app) + RECOUPEMENT ──
  const ollAnchor = (out.oll && +out.oll.euroM2HC > 0) ? { hc: (+out.oll.euroM2HC) * surf, nobs: +out.oll.nobs || 0 } : null;
  const rc = recouper({
    anil: { hc: hcAnilCentral, ceiling: hcAnil, floor: hcAnilFloor, typ: fia.typ },
    oll: ollAnchor, aberration, width: baseWidth
  });
  out.recoupement = { sources: rc.sources, coherence: rc.coherence, flags: rc.flags, ecart: rc.ecart };

  const width = rc.width;
  let hcCentral = Math.max(0, rc.central);
  let basse = _r5(rc.basse);
  let haute = _r5(rc.haute);

  // ── DPE : gel F/G + interdiction à la location (réutilise utils.js). AVERTIR, JAMAIS BLOQUER.
  const classe = String(input.dpeClasse || '').toUpperCase().trim();
  out.dpe.classe = _isDpeClassValide(classe) ? classe : '';
  const gelFG = classe === 'F' || classe === 'G';
  out.dpe.gelFG = gelFG;
  const interd = _dpeInterditLocationAuDate(classe, dateRef);
  out.dpe.interdit = !!interd.interdit;
  const loyerActuel = Number(input.loyerActuelHC);
  const aLoyerActuel = Number.isFinite(loyerActuel) && loyerActuel > 0;

  if (gelFG) {
    out.dpe.mentions.push('Logement classé ' + classe + ' : loyer gelé — révision et réévaluation interdites (loi Climat et Résilience, art. 17/17-1 de la loi du 6 juillet 1989, depuis le 24/08/2022).');
    if (aLoyerActuel) {
      const cap = Math.round(loyerActuel);
      const aMordu = haute > cap; // le plafond ne « borne » que s'il écrête réellement le haut de la fourchette
      haute = Math.min(haute, cap);
      hcCentral = Math.min(hcCentral, cap);
      if (basse > haute) basse = haute;
      if (aMordu) out.dpe.mentions.push('Fourchette bornée au dernier loyer appliqué (' + cap + ' € HC) : il ne peut pas être dépassé.');
    } else {
      out.dpe.mentions.push('Sans loyer appliqué connu, le loyer ne peut pas dépasser celui du précédent locataire.');
    }
  }
  if (interd.interdit) {
    out.dpe.mentions.push('Location interdite pour un DPE ' + classe + ' depuis le ' + interd.dateBlocage + ' (' + interd.loi + ') — avertissement, la décision reste au propriétaire.');
  }

  // ── ENCADREMENT : si une grille sourcée a fourni un plafond légal (loyer de référence majoré ×
  //    surface), BORNER le haut de la fourchette à ce plafond quand il mord (comme le gel DPE).
  //    AVERTIR, JAMAIS BLOQUER. Sans plafond fiable (cas live actuel), on n'écrête rien.
  const enc = out.encadrement;
  if (enc && enc.applicable && Number(enc.plafond) > 0) {
    const cap = Math.round(Number(enc.plafond));
    enc.borne = haute > cap;         // le plafond ne « borne » que s'il écrête réellement le haut
    haute = Math.min(haute, cap);
    hcCentral = Math.min(hcCentral, cap);
    if (basse > haute) basse = haute;
  }

  out.hcCentral = Math.round(hcCentral);
  out.fourchette = { basse: Math.max(0, basse), haute: Math.max(0, haute), width };
  out.euroM2HC = surf > 0 ? _r2d(hcCentral / surf) : null;

  if (aLoyerActuel) {
    out.comparaison = { loyerActuelHC: Math.round(loyerActuel), position: positionDansFourchette(loyerActuel, out.fourchette) };
  }
  return out;
}
