/**
 * core/juste-prix.js — JUSTE-PRIX DE MISE EN LOCATION (tranche 1 : fourchette de loyer HC suggérée).
 *
 * Module PUR (aucune lecture de DB ni du DOM, aucun fetch). L'app (app-part2) géocode l'adresse via
 * la BAN déjà utilisée (window.GeorisquesErpDetector), charge À LA DEMANDE le fichier de données
 * (js/data/carte-loyers-2025.json) et appelle `evaluer(input, record, options)`.
 *
 * Donnée de marché : « Carte des loyers 2025 » (ANIL / DGALN, data.gouv.fr, Licence Ouverte v2).
 *   Les indicateurs sont des loyers d'ANNONCE, CHARGES COMPRISES, pour un bien NON MEUBLÉ, en €/m².
 *   Pour afficher un loyer HORS CHARGES (ce dont Propryo a besoin), on retranche une PROVISION de
 *   charges ESTIMÉE (heuristique documentée ci-dessous, clairement « estimation »).
 *
 * Règles arbitrées (Didier, 01-02/11/2026) :
 *   - Toujours une FOURCHETTE suggérée, jamais un verdict ; le détail se lit au clic.
 *   - Fourchette LARGE (± ~12 %), RESSERRÉE quand la fiabilité de la commune est bonne.
 *   - Loyer affiché HORS CHARGES, mention « hors charges » explicite, provision estimée juste après.
 *   - AVERTIR, JAMAIS BLOQUER (DPE F/G, classe interdite…). L'utilisateur décide du loyer.
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

/**
 * Barème de PROVISION DE CHARGES (estimation prudente, en €/m²/mois). Charges RÉCUPÉRABLES =
 * décret n° 87-713. Valeurs volontairement rondes et présentées comme une ESTIMATION, régularisée
 * une fois par an sur charges réelles — ce n'est pas un calcul Finances.
 *   baseCopro  : parties communes de copropriété (entretien courant, eau froide, souvent ascenseur).
 *   baseMaison : maison individuelle (peu de charges récupérables : abords, TEOM).
 *   chauffColl : surcoût si le chauffage est COLLECTIF (poste de loin le plus lourd).
 *   ecsColl    : surcoût si l'eau chaude est COLLECTIVE.
 */
export const PROV_BAREME = { baseCopro: 0.50, baseMaison: 0.15, chauffColl: 1.30, ecsColl: 0.50 };

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
 * Estime la provision de charges mensuelle (€). Entrées : surface, chauffage/eau chaude collectifs,
 * présence de parties communes (copropriété) ou maison individuelle.
 * @returns {{ montant:number, perM2:number, details:Array<{k:string,m2:number}>, indisponible:boolean }}
 */
export function estimerProvisionCharges({ surf, chauffageColl, ecsColl, copro, maison } = {}, bareme = PROV_BAREME) {
  const s = Number(surf);
  if (!Number.isFinite(s) || s <= 0) return { montant: 0, perM2: 0, details: [], indisponible: true };
  const details = [];
  let perM2 = 0;
  if (maison) { perM2 += bareme.baseMaison; details.push({ k: 'Abords / entretien (maison individuelle)', m2: bareme.baseMaison }); }
  else if (copro !== false) { perM2 += bareme.baseCopro; details.push({ k: 'Parties communes de copropriété (entretien, eau froide)', m2: bareme.baseCopro }); }
  if (chauffageColl) { perM2 += bareme.chauffColl; details.push({ k: 'Chauffage collectif', m2: bareme.chauffColl }); }
  if (ecsColl) { perM2 += bareme.ecsColl; details.push({ k: 'Eau chaude collective', m2: bareme.ecsColl }); }
  return { montant: Math.max(0, _r5(perM2 * s)), perM2: _r2d(perM2), details, indisponible: false };
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

  const prov = estimerProvisionCharges({
    surf, chauffageColl: !!input.chauffageColl, ecsColl: !!input.ecsColl,
    copro: input.maison ? false : (input.copro !== false), maison: !!input.maison
  });
  out.provision = prov;

  const fia = fiabiliteSegment(rec);
  out.fiabilite = fia;
  const width = FOURCHETTE_WIDTH[fia.niveau];

  let hcCentral = Math.max(0, out.loyerCC - prov.montant);
  let basse = _r5(hcCentral * (1 - width));
  let haute = _r5(hcCentral * (1 + width));

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

  out.hcCentral = Math.round(hcCentral);
  out.fourchette = { basse: Math.max(0, basse), haute: Math.max(0, haute), width };
  out.euroM2HC = surf > 0 ? _r2d(hcCentral / surf) : null;

  if (aLoyerActuel) {
    out.comparaison = { loyerActuelHC: Math.round(loyerActuel), position: positionDansFourchette(loyerActuel, out.fourchette) };
  }
  return out;
}
