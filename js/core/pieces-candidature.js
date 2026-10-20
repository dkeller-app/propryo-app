// js/core/pieces-candidature.js — CANDIDATURES-CONFORMITE lot 2 (12/10/2026).
// Liste FERMÉE des pièces justificatives exigibles d'un candidat à la location et de sa caution, et
// bouclier « pièce hors liste ». Pur : aucun DOM, aucun réseau. Partagé par l'app (js/main.js →
// window.PiecesCand) et par le relais (relay/src : contrôle du type + liste injectée dans le formulaire).
//
// SOURCES (relevées sur Légifrance le 12/10/2026) :
//  - Décret n° 2015-1437 du 5 novembre 2015, annexes I et II, version en vigueur depuis le 01/01/2023
//    (modifiées par le décret n° 2022-1014 du 19 juillet 2022, art. 35). Textes repris VERBATIM (`texte`).
//  - Loi n° 89-462 du 6 juillet 1989, art. 22-2, version en vigueur depuis le 27/03/2014 : liste fixée par
//    décret ; cosignature d'un ascendant ou descendant non imposable ; amende administrative.
//  - Ancienne rédaction de l'art. 22-2 (24/10/2010 → 27/03/2014) : liste EXPLICITE des documents
//    interdits, reprise ici comme dictionnaire d'EXEMPLES (chacun est hors de la liste actuelle).
//  - service-public.fr F1169 (vérifié le 10/04/2025) : visa Visale (caution Action Logement) ; aucune somme
//    d'argent avant la signature du bail.
// Testé par __tests__/helpers/pieces-candidature.test.js.

export const SOURCES_PIECES = {
  decret: { libelle: 'Décret n° 2015-1437 du 5 novembre 2015 (annexes en vigueur depuis le 01/01/2023)', url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000031444493' },
  annexe1: { libelle: 'Décret n° 2015-1437, annexe I', url: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000046074681' },
  annexe2: { libelle: 'Décret n° 2015-1437, annexe II', url: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000046074679' },
  art222: { libelle: 'Loi n° 89-462 du 6 juillet 1989, art. 22-2 (en vigueur depuis le 27/03/2014)', url: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000028806691/' },
  art222ancien: { libelle: 'Loi n° 89-462, art. 22-2, rédaction du 24/10/2010 au 27/03/2014', url: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000022962988/2012-06-01' },
  f1169: { libelle: 'service-public.fr, fiche F1169', url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1169' }
};

/** Art. 22-2, alinéas 1 et 3, VERBATIM (version en vigueur depuis le 27/03/2014). */
export const TEXTE_LISTE_22_2 = "La liste des pièces justificatives pouvant être exigées du candidat à la location ou de sa caution par le bailleur, préalablement à l'établissement du contrat de location, est définie par décret en Conseil d'Etat, pris après avis de la Commission nationale de concertation.";
export const TEXTE_AMENDE_22_2 = "Les manquements au présent article sont punis d'une amende administrative, prononcée par le représentant de l'Etat dans le département, dont le montant ne peut être supérieur à 3 000 € pour une personne physique et à 15 000 € pour une personne morale.";

export const TYPE_NON_PRECISE = '';

const A1 = 'Décret n° 2015-1437, annexe I';
const A2 = 'Décret n° 2015-1437, annexe II';
const t = (id, categorie, libelle, texte, ref) => ({ id, categorie, libelle, texte, ref });

/** Liste fermée. `categorie` = zone de dépôt de l'app et du formulaire (identite, domicile, situation, ressources, garant). */
export const TYPES_PIECES = [
  // ── Annexe I — candidat : A. identité (pièce en cours de validité, avec photographie)
  t('I.A.1', 'identite', "Carte nationale d'identité", "Carte nationale d'identité française ou étrangère.", A1 + ', A.1'),
  t('I.A.2', 'identite', 'Passeport', 'Passeport français ou étranger.', A1 + ', A.2'),
  t('I.A.3', 'identite', 'Permis de conduire', 'Permis de conduire français ou étranger.', A1 + ', A.3'),
  t('I.A.4', 'identite', 'Titre de séjour', "Document justifiant du droit au séjour du candidat à la location étranger, notamment, carte de séjour temporaire, carte de résident, carte de ressortissant d'un Etat membre de l'Union européenne ou de l'Espace économique européen.", A1 + ', A.4'),
  // B. domicile — une seule pièce
  t('I.B.1', 'domicile', 'Trois dernières quittances de loyer, ou attestation du précédent bailleur', 'Trois dernières quittances de loyer ou, à défaut, attestation du précédent bailleur, ou de son mandataire, indiquant que le locataire est à jour de ses loyers et charges.', A1 + ', B.1'),
  t('I.B.2', 'domicile', "Attestation d'élection de domicile", "Attestation d'élection de domicile établissant le lien avec un organisme agréé au titre de l'article L. 264-2 du code de l'action sociale et des familles.", A1 + ', B.2'),
  t('I.B.3', 'domicile', "Attestation sur l'honneur de l'hébergeant", "Attestation sur l'honneur de l'hébergeant indiquant que le candidat à la location réside à son domicile.", A1 + ', B.3'),
  t('I.B.4', 'domicile', 'Dernier avis de taxe foncière, ou titre de propriété', 'Dernier avis de taxe foncière ou, à défaut, titre de propriété de la résidence principale.', A1 + ', B.4'),
  // C. activités professionnelles
  t('I.C.1', 'situation', "Contrat de travail ou de stage, ou attestation de l'employeur", "Contrat de travail ou de stage ou, à défaut, une attestation de l'employeur précisant l'emploi et la rémunération proposée, la date d'entrée en fonctions envisagée et, le cas échéant, la durée de la période d'essai.", A1 + ', C.1'),
  t('I.C.2', 'situation', 'Extrait K ou K bis de moins de trois mois', "L'extrait K ou K bis du registre du commerce et des sociétés de moins de trois mois pour une entreprise commerciale.", A1 + ', C.2'),
  t('I.C.3', 'situation', "Fiche d'immatriculation au Registre national des entreprises", "La fiche d'immatriculation au Registre national des entreprises de moins de trois mois pour une entreprise du secteur des métiers et de l'artisanat.", A1 + ', C.3'),
  t('I.C.4', 'situation', "Certificat d'identification de l'INSEE", "La copie du certificat d'identification de l'INSEE, comportant les numéros d'identification, pour un travailleur indépendant.", A1 + ', C.4'),
  t('I.C.5', 'situation', 'Carte professionnelle', 'La copie de la carte professionnelle pour une profession libérale.', A1 + ', C.5'),
  t('I.C.6', 'situation', "Pièce récente attestant de l'activité", "Toute pièce récente attestant de l'activité pour les autres professionnels.", A1 + ', C.6'),
  t('I.C.7', 'situation', "Carte d'étudiant ou certificat de scolarité", "Carte d'étudiant ou certificat de scolarité pour l'année en cours.", A1 + ', C.7'),
  // D. ressources
  t('I.D.1', 'ressources', "Dernier ou avant-dernier avis d'imposition ou de non-imposition", "Le dernier ou avant-dernier avis d'imposition ou de non-imposition et, lorsque tout ou partie des revenus perçus n'a pas été imposé en France mais dans un autre Etat ou territoire, le dernier ou avant-dernier avis d'imposition à l'impôt ou aux impôts qui tiennent lieu d'impôt sur le revenu dans cet Etat ou territoire ou un document en tenant lieu établi par l'administration fiscale de cet Etat ou territoire.", A1 + ', D.1'),
  t('I.D.2', 'ressources', 'Trois derniers bulletins de salaire', 'Trois derniers bulletins de salaires.', A1 + ', D.2'),
  t('I.D.3', 'ressources', 'Justificatif de versement des indemnités de stage', 'Justificatif de versement des indemnités de stage.', A1 + ', D.3'),
  t('I.D.4', 'ressources', "Deux derniers bilans, ou attestation de ressources d'un comptable", "Les deux derniers bilans ou, à défaut, une attestation de ressources pour l'exercice en cours délivré par un comptable pour les professions non salariées.", A1 + ', D.4'),
  t('I.D.5', 'ressources', 'Justificatif de pensions, prestations ou allocations', "Justificatif de versement des indemnités, retraites, pensions, prestations sociales et familiales et allocations perçues lors des trois derniers mois ou justificatif de l'ouverture des droits, établis par l'organisme payeur.", A1 + ', D.5'),
  t('I.D.6', 'ressources', 'Simulation des aides au logement', "Attestation de simulation établie par l'organisme payeur ou simulation établie par le locataire relative aux aides au logement.", A1 + ', D.6'),
  t('I.D.7', 'ressources', "Avis d'attribution de bourse", "Avis d'attribution de bourse pour les étudiants boursiers.", A1 + ', D.7'),
  t('I.D.8', 'ressources', 'Titre de propriété ou dernier avis de taxe foncière', "Titre de propriété d'un bien immobilier ou dernier avis de taxe foncière.", A1 + ', D.8'),
  t('I.D.9', 'ressources', 'Justificatif de revenus fonciers, rentes ou revenus de capitaux', 'Justificatif de revenus fonciers, de rentes viagères ou de revenus de valeurs et capitaux mobiliers.', A1 + ', D.9'),
  // ── Annexe II — cautions (zone « garant »)
  t('II.A.1', 'garant', "Caution — carte nationale d'identité", "Carte nationale d'identité française ou étrangère ;", A2 + ', A.1'),
  t('II.A.2', 'garant', 'Caution — passeport', 'Passeport français ou étranger ;', A2 + ', A.2'),
  t('II.A.3', 'garant', 'Caution — permis de conduire', 'Permis de conduire français ou étranger ;', A2 + ', A.3'),
  t('II.B.1', 'garant', 'Caution société — extrait K bis ou statuts', "Extrait K bis original de moins de trois mois de la société ou les statuts ou toute autre pièce justifiant de l'existence légale de la personne, faisant apparaître le nom du responsable et l'adresse de l'organisme ainsi que la preuve qu'une déclaration a été effectuée auprès d'une administration, une juridiction ou un organisme professionnel.", A2 + ', B.1'),
  t('II.B.2', 'garant', 'Caution société — identité du représentant', "Justificatif d'identité du représentant de la personne morale figurant sur l'extrait K bis ou les statuts.", A2 + ', B.2'),
  t('II.C.1', 'garant', 'Caution — dernière quittance de loyer', 'Dernière quittance de loyer.', A2 + ', C.1'),
  t('II.C.2', 'garant', "Caution — facture d'eau, de gaz ou d'électricité", "Facture d'eau, de gaz ou d'électricité de moins de trois mois.", A2 + ', C.2'),
  t('II.C.3', 'garant', "Caution — attestation d'assurance logement", "Attestation d'assurance logement de moins de trois mois.", A2 + ', C.3'),
  t('II.C.4', 'garant', 'Caution — dernier avis de taxe foncière, ou titre de propriété', 'Dernier avis de taxe foncière ou, à défaut, titre de propriété de la résidence principale.', A2 + ', C.4'),
  t('II.D.1', 'garant', "Caution — contrat de travail ou attestation de l'employeur", "Contrat de travail ou de stage ou, à défaut, une attestation de l'employeur précisant l'emploi et la rémunération proposée, la date d'entrée en fonctions envisagée et le cas échéant la durée de la période d'essai.", A2 + ', D.1'),
  t('II.D.2', 'garant', 'Caution — extrait K ou K bis', "L'extrait K ou K bis du registre du commerce et des sociétés datant de moins de trois mois pour une entreprise commerciale.", A2 + ', D.2'),
  t('II.D.3', 'garant', "Caution — fiche d'immatriculation au Registre national des entreprises", "La fiche d'immatriculation au Registre national des entreprises de moins de trois mois pour une entreprise du secteur des métiers et de l'artisanat.", A2 + ', D.3'),
  t('II.D.4', 'garant', "Caution — certificat d'identification de l'INSEE", "La copie du certificat d'identification de l'INSEE, comportant les numéros d'identification, pour un travailleur indépendant.", A2 + ', D.4'),
  t('II.D.5', 'garant', 'Caution — carte professionnelle', 'La copie de la carte professionnelle pour une profession libérale.', A2 + ', D.5'),
  t('II.D.6', 'garant', "Caution — pièce récente attestant de l'activité", "Toute pièce récente attestant de l'activité pour les autres professionnels.", A2 + ', D.6'),
  t('II.E.1', 'garant', "Caution — dernier avis d'imposition ou de non-imposition", "Dernier avis d'imposition ou de non-imposition et, lorsque tout ou partie des revenus perçus n'a pas été imposé en France mais dans un autre Etat ou territoire, le dernier avis d'imposition à l'impôt ou aux impôts qui tiennent lieu d'impôt sur le revenu dans cet Etat ou territoire ou un document en tenant lieu établi par l'administration fiscale de cet Etat ou territoire.", A2 + ', E.1'),
  t('II.E.2', 'garant', 'Caution — titre de propriété ou dernier avis de taxe foncière', "Titre de propriété d'un bien immobilier ou dernier avis de taxe foncière.", A2 + ', E.2'),
  t('II.E.3', 'garant', 'Caution — trois derniers bulletins de salaire', 'Trois derniers bulletins de salaires.', A2 + ', E.3'),
  t('II.E.4', 'garant', "Caution — deux derniers bilans, ou attestation d'un comptable", "Les deux derniers bilans ou, à défaut, une attestation de ressources pour l'exercice en cours délivré par un comptable pour les professions non salariées.", A2 + ', E.4'),
  t('II.E.5', 'garant', 'Caution — justificatif de pensions, prestations ou allocations', "Justificatif de versement des indemnités, retraites, pensions, prestations sociales et familiales et allocations perçues lors des trois derniers mois ou justificatif de l'ouverture des droits, établis par l'organisme payeur.", A2 + ', E.5'),
  t('II.E.6', 'garant', 'Caution — revenus fonciers, rentes ou revenus de capitaux', 'Justificatif de revenus fonciers, de rentes viagères ou de revenus de valeurs et capitaux mobiliers.', A2 + ', E.6'),
  // Garantie Visale : pièce citée par service-public.fr (absente du texte des annexes).
  t('VISALE', 'garant', 'Visa Visale (Action Logement)', "Le visa qu'Action logement a fourni au locataire.", 'service-public.fr F1169')
];

const _PAR_ID = new Map(TYPES_PIECES.map(x => [x.id, x]));

export function typesPourCategorie(categorie) {
  return TYPES_PIECES.filter(x => x.categorie === categorie);
}
export function typeValide(categorie, id) {
  if (!['identite', 'domicile', 'situation', 'ressources', 'garant'].includes(categorie)) return false;
  if (id === TYPE_NON_PRECISE) return true;
  const x = _PAR_ID.get(id);
  return !!x && x.categorie === categorie;
}
export function libelleType(id) {
  const x = _PAR_ID.get(id);
  return x ? x.libelle : 'Type non précisé';
}

// ── Bouclier « pièce hors liste » ─────────────────────────────────────────────
// Texte normalisé : minuscules, sans accents, apostrophes et séparateurs → espace. Mots entiers.
function _norm(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[’'`´_\-.,;:!?()[\]{}"«»/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const NB_SUP_3 = '(?:[4-9]|1[0-9]|quatre|cinq|six|sept|huit|neuf|dix|douze)';
const NB_SUP_2 = '(?:[3-9]|1[0-9]|trois|quatre|cinq|six)';
// id, libellé affiché, motif sur le texte normalisé. Les libellés « (ancienne liste) » renvoient à la
// rédaction 2010-2014 de l'art. 22-2 ; les autres sont hors des annexes du décret actuel.
const INTERDITS = [
  ['releve_compte', 'Relevé de compte bancaire ou postal', /\b(?:releves? (?:de |des )?(?:compte|comptes|bancaires?|banque|postal)|extraits? de compte)\b/],
  ['rib', "RIB (relevé d'identité bancaire)", /\b(?:rib|ribs|releve d identite bancaire)\b/],
  ['photo_identite', "Photographie d'identité (hors pièce d'identité)", /\bphoto(?:graphie)?s? d identite\b/],
  ['carte_vitale', "Carte Vitale ou carte d'assuré social", /\b(?:cartes? vitales?|cartes? d assure social|attestation de (?:securite sociale|droits? (?:a l )?assurance maladie)|numero de securite sociale)\b/],
  ['bonne_tenue', 'Attestation de bonne tenue de compte', /\bbonne tenue (?:de |du )?compte\b/],
  ['absence_credit', "Attestation d'absence de crédit en cours", /\b(?:absence de credits?|non endettement)\b/],
  ['prelevement', 'Autorisation de prélèvement automatique', /\b(?:autorisation de prelevement|mandat (?:de prelevement|sepa))\b/],
  ['carte_bancaire', 'Copie de carte bancaire', /\b(?:cartes? bancaires?|cartes? bleues?)\b/],
  ['jugement_divorce', 'Jugement de divorce', /\bjugement de divorce\b/],
  ['contrat_mariage', 'Contrat de mariage', /\bcontrat de mariage\b/],
  ['concubinage', 'Certificat de concubinage ou de PACS', /\b(?:certificat de concubinage|attestation de (?:concubinage|pacs)|convention de pacs|contrat de pacs)\b/],
  ['livret_famille', 'Livret de famille', /\blivret de famille\b/],
  ['reservation', "Chèque de réservation ou somme d'argent avant la signature", /\b(?:cheque de (?:reservation|caution)|frais de (?:reservation|dossier)|acompte|somme de reservation)\b/],
  ['dossier_medical', 'Dossier ou certificat médical', /\b(?:dossier medical|certificat medical)\b/],
  ['casier', 'Extrait de casier judiciaire', /\bcasier judiciaire\b/],
  ['compte_bloque', "Remise de fonds sur un compte bloqué", /\bcompte bloque\b/],
  ['bilans', 'Plus de deux bilans', new RegExp('\\b' + NB_SUP_2 + ' (?:derniers )?bilans\\b')],
  ['bulletins', 'Plus de trois bulletins de salaire', new RegExp('\\b' + NB_SUP_3 + ' (?:derniers |dernieres )?(?:bulletins|fiches) de (?:salaires?|paie|paye)\\b')],
  ['ficp', 'Extrait ou attestation du FICP', /\b(?:ficp|fichier (?:national )?des incidents)\b/],
  ['facture_energie', "Facture d'énergie demandée au candidat (exigible de la caution seulement)", /\bfactures? (?:d |de )?(?:eau|gaz|electricite|edf|engie|energie)\b/],
  ['cosignature_parents', "Cosignature imposée d'un parent (art. 22-2, al. 2)", /\b(?:(?:caution|cautions|garant|garants|cosignature) (?:de |des |d )(?:vos |ses |tes |leurs )?parents|parents? (?:doivent|doit) (?:se porter |etre )(?:caution|garants?))\b/]
];

// Pièces exigibles de la CAUTION (annexe II) : pas d'alerte dans la zone « garant » (relecture Opus #3).
const PERMIS_GARANT = new Set(['facture_energie']);
function _detecter(textNorm, brut, categorie) {
  const out = []; const vus = new Set();
  for (const [id, libelle, re] of INTERDITS) {
    if (vus.has(id)) continue;
    if (categorie === 'garant' && PERMIS_GARANT.has(id)) continue;
    const m = textNorm.match(re);
    if (!m) continue;
    vus.add(id);
    out.push({ id, libelle, extrait: _extraitBrut(brut, m[0]) });
  }
  return out;
}
// Retrouve dans le texte d'origine le passage correspondant (même longueur après normalisation).
function _extraitBrut(brut, trouve) {
  const s = String(brut || '');
  const mots = trouve.split(' ').length;
  const toks = s.split(/(\s+)/);
  for (let i = 0; i < toks.length; i++) {
    let acc = '', n = 0;
    for (let j = i; j < toks.length && n < mots + 4; j++) {
      acc += toks[j];
      if (!/^\s+$/.test(toks[j])) n++;
      if (_norm(acc) === trouve) return acc.trim().replace(/[.,;:!?]+$/, '');
    }
  }
  return trouve;
}

/** Pièces hors liste citées dans un texte libre (demande de complément). [] si rien. Jamais bloquant : l'appelant avertit. */
export function detecterPiecesInterdites(texte) {
  if (!texte) return [];
  return _detecter(_norm(texte), texte);
}
/** Même contrôle sur un nom de fichier (séparateurs _ - . traités comme des espaces). `categorie` = zone de
 * dépôt : dans « garant », une facture d'énergie est exigible (annexe II, C.2) et n'est pas signalée. */
export function nomFichierHorsListe(nom, categorie) {
  if (!nom) return [];
  const sansExt = String(nom).replace(/\.[a-z0-9]{2,5}$/i, '');
  return _detecter(_norm(sansExt), sansExt, categorie).map(x => ({ ...x, extrait: String(nom) }));
}
