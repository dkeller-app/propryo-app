/**
 * core/qui-paie.js — TRAVAUX : QUI PAIE ? (CDC mockups/TRAVAUX-QUI-PAIE, GO Didier 13/10/2026)
 *
 * Moteur de règles DÉTERMINISTE et SOURCÉ : à partir d'un incident (élément, nature,
 * intervention, cause, contexte), il SUGGÈRE qui paie, cite le texte appliqué MOT POUR MOT
 * (Légifrance, relevé du 13/10/2026) et affiche un niveau de confiance. Le bailleur décide.
 *
 *   - Zone grise ⇒ payeur 'a_arbitrer', toujours avec DEUX lectures. Jamais d'affirmation.
 *   - Cause inconnue sur un élément de la liste du décret 87-712 ⇒ 'a_arbitrer' (jamais
 *     « locataire » par défaut).
 *   - Sinistre (dégât des eaux, incendie, effraction, bris de glace) ⇒ circuit assurance,
 *     sans verdict de responsabilité.
 *   - Aucun calcul d'argent ici (le coût part dans le moteur Finances par un mouvement).
 *
 * Module PUR : aucune dépendance DB / DOM / réseau. L'appelant fournit le contexte (meublé,
 * copropriété, clause du bail) lu sur le bail et l'immeuble.
 *
 * Information juridique générale, pas une consultation juridique (loi n° 71-1130, art. 54).
 */

/** Version du jeu de règles, stockée sur chaque verdict (un ancien verdict reste lisible). */
export const QP_VERSION = '2026-10-13';

export const PAYEURS = Object.freeze({
  BAILLEUR: 'bailleur', LOCATAIRE: 'locataire', ARBITRER: 'a_arbitrer', SYNDIC: 'syndic', ASSURANCE: 'assurance',
});
export const PAYEUR_LBL = Object.freeze({
  bailleur: 'Le bailleur', locataire: 'Le locataire', a_arbitrer: 'À arbitrer', syndic: 'Le syndic', assurance: 'Circuit assurance',
});
export const CONFIANCE = Object.freeze({ EXPLICITE: 'texte_explicite', PROBABLE: 'lecture_probable', ARBITRER: 'a_arbitrer' });
export const CONFIANCE_LBL = Object.freeze({
  texte_explicite: 'Texte explicite', lecture_probable: 'Lecture probable', a_arbitrer: 'Zone grise',
});

export const MENTION_LEGALE = 'Information juridique générale, pas une consultation juridique (loi n° 71-1130 du 31 décembre 1971, art. 54). La décision revient au bailleur.';

/* ─────────────── Textes cités (verbatim Légifrance, 13/10/2026) ─────────────── */
const U = {
  ann: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000006491868',
  d1: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000006491827',
  a6: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000043977105',
  a7: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000051748585',
  c1720: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006442784',
  c1754: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006443116',
  c1755: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006443127',
  r22415: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000020726536',
  r1423: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043818929',
  l6514: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000039313545',
  l1132: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000035731302',
  dev: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000033959893',
  l54: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000039280601',
};

export const TEXTES = Object.freeze({
  'd87712-1': { ref: 'Décret n° 87-712 du 26 août 1987, art. 1', url: U.d1,
    extrait: 'Sont des réparations locatives les travaux d\'entretien courant, et de menues réparations, y compris les remplacements d\'éléments assimilables auxdites réparations, consécutifs à l\'usage normal des locaux et équipements à usage privatif.' },
  'ann-Ia': { ref: 'Décret n° 87-712, annexe, I a)', url: U.ann, extrait: 'Entretien courant, notamment des allées, pelouses, massifs, bassins et piscines ; taille, élagage, échenillage des arbres et arbustes ;' },
  'ann-Ib': { ref: 'Décret n° 87-712, annexe, I b)', url: U.ann, extrait: 'Enlèvement de la mousse et des autres végétaux.' },
  'ann-Ic': { ref: 'Décret n° 87-712, annexe, I c)', url: U.ann, extrait: 'Dégorgement des conduits.' },
  'ann-IIa': { ref: 'Décret n° 87-712, annexe, II a)', url: U.ann, extrait: 'Menues réparations des boutons et poignées de portes, des gonds, crémones et espagnolettes ; remplacement notamment de boulons, clavettes et targettes.' },
  'ann-IIb': { ref: 'Décret n° 87-712, annexe, II b)', url: U.ann, extrait: 'Remplacement des vitres détériorées.' },
  'ann-IIc': { ref: 'Décret n° 87-712, annexe, II c)', url: U.ann, extrait: 'Remplacement notamment de cordes, poulies ou de quelques lames.' },
  'ann-IId': { ref: 'Décret n° 87-712, annexe, II d)', url: U.ann, extrait: 'Remplacement de petites pièces ainsi que des clés égarées ou détériorées.' },
  'ann-IIe': { ref: 'Décret n° 87-712, annexe, II e)', url: U.ann, extrait: 'Remplacement notamment de boulons, clavettes, targettes.' },
  'ann-IIIa': { ref: 'Décret n° 87-712, annexe, III a)', url: U.ann, extrait: 'Menus raccords de peintures et tapisseries ; remise en place ou remplacement de quelques éléments des matériaux de revêtement tels que faïence, mosaïque, matière plastique ; rebouchage des trous rendu assimilable à une réparation par le nombre, la dimension et l\'emplacement de ceux-ci.' },
  'ann-IIIb': { ref: 'Décret n° 87-712, annexe, III b)', url: U.ann, extrait: 'Remplacement de quelques lames de parquets et remise en état, pose de raccords de moquettes et autres revêtements de sol, notamment en cas de taches et de trous.' },
  'ann-IIIc': { ref: 'Décret n° 87-712, annexe, III c)', url: U.ann, extrait: 'Remplacement des tablettes et tasseaux de placard et réparation de leur dispositif de fermeture ; fixation de raccords et remplacement de pointes de menuiseries.' },
  'ann-IVa': { ref: 'Décret n° 87-712, annexe, IV a)', url: U.ann, extrait: 'Dégorgement : Remplacement notamment de joints et de colliers.' },
  'ann-IVb': { ref: 'Décret n° 87-712, annexe, IV b)', url: U.ann, extrait: 'Entretien courant des robinets, siphons et ouvertures d\'aération ; Remplacement périodique des tuyaux souples de raccordement.' },
  'ann-IVc': { ref: 'Décret n° 87-712, annexe, IV c)', url: U.ann, extrait: 'Vidange.' },
  'ann-IVd-gaz': { ref: 'Décret n° 87-712, annexe, IV d)', url: U.ann, extrait: 'Remplacement des bilames, pistons, membranes, boîtes à eau, allumage piézo-électrique, clapets et joints des appareils à gaz ;' },
  'ann-IVd-chauffe': { ref: 'Décret n° 87-712, annexe, IV d)', url: U.ann, extrait: 'Rinçage et nettoyage des corps de chauffe et tuyauteries ;' },
  'ann-IVd-robinet': { ref: 'Décret n° 87-712, annexe, IV d)', url: U.ann, extrait: 'Remplacement des joints, clapets et presse-étoupes des robinets ;' },
  'ann-IVd-chasse': { ref: 'Décret n° 87-712, annexe, IV d)', url: U.ann, extrait: 'Remplacement des joints, flotteurs et joints cloches des chasses d\'eau.' },
  'ann-IVe': { ref: 'Décret n° 87-712, annexe, IV e)', url: U.ann, extrait: 'Nettoyage des dépôts de calcaire, remplacement des tuyaux flexibles de douches.' },
  'ann-V': { ref: 'Décret n° 87-712, annexe, V', url: U.ann, extrait: 'Remplacement des interrupteurs, prises de courant, coupe-circuits et fusibles, des ampoules, tubes lumineux ; réparation ou remplacement des baguettes ou gaines de protection.' },
  'ann-VIa': { ref: 'Décret n° 87-712, annexe, VI a)', url: U.ann, extrait: 'Entretien courant et menues réparations des appareils tels que réfrigérateurs, machines à laver le linge et la vaisselle, sèche-linge, hottes aspirantes, adoucisseurs, capteurs solaires, pompes à chaleur, appareils de conditionnement d\'air, antennes individuelles de radiodiffusion et de télévision, meubles scellés, cheminées, glaces et miroirs ;' },
  'ann-VId': { ref: 'Décret n° 87-712, annexe, VI d)', url: U.ann, extrait: 'Ramonage des conduits d\'évacuation des fumées et des gaz et conduits de ventilation.' },
  'a6-al1': { ref: 'Loi n° 89-462 du 6 juillet 1989, art. 6, al. 1', url: U.a6,
    extrait: 'Le bailleur est tenu de remettre au locataire un logement décent ne laissant pas apparaître de risques manifestes pouvant porter atteinte à la sécurité physique ou à la santé, exempt de toute infestation d\'espèces nuisibles et parasites, répondant à un niveau de performance minimal au sens de l\'article L. 173-1-1 du code de la construction et de l\'habitation et doté des éléments le rendant conforme à l\'usage d\'habitation.' },
  'a6c': { ref: 'Loi n° 89-462 du 6 juillet 1989, art. 6 c)', url: U.a6,
    extrait: 'D\'entretenir les locaux en état de servir à l\'usage prévu par le contrat et d\'y faire toutes les réparations, autres que locatives, nécessaires au maintien en état et à l\'entretien normal des locaux loués ;' },
  'a7c': { ref: 'Loi n° 89-462 du 6 juillet 1989, art. 7 c)', url: U.a7,
    extrait: 'De répondre des dégradations et pertes qui surviennent pendant la durée du contrat dans les locaux dont il a la jouissance exclusive, à moins qu\'il ne prouve qu\'elles ont eu lieu par cas de force majeure, par la faute du bailleur ou par le fait d\'un tiers qu\'il n\'a pas introduit dans le logement ;' },
  'a7d': { ref: 'Loi n° 89-462 du 6 juillet 1989, art. 7 d)', url: U.a7,
    extrait: 'De prendre à sa charge l\'entretien courant du logement, des équipements mentionnés au contrat et les menues réparations ainsi que l\'ensemble des réparations locatives définies par décret en Conseil d\'Etat, sauf si elles sont occasionnées par vétusté, malfaçon, vice de construction, cas fortuit ou force majeure.' },
  'a7g': { ref: 'Loi n° 89-462 du 6 juillet 1989, art. 7 g)', url: U.a7,
    extrait: 'De s\'assurer contre les risques dont il doit répondre en sa qualité de locataire et d\'en justifier lors de la remise des clés puis, chaque année, à la demande du bailleur.' },
  'c1720': { ref: 'Code civil, art. 1720, al. 2', url: U.c1720,
    extrait: 'Il doit y faire, pendant la durée du bail, toutes les réparations qui peuvent devenir nécessaires, autres que les locatives.' },
  'c1754-vitres': { ref: 'Code civil, art. 1754', url: U.c1754,
    extrait: 'Aux vitres, à moins qu\'elles ne soient cassées par la grêle ou autres accidents extraordinaires et de force majeure, dont le locataire ne peut être tenu ;' },
  'c1755': { ref: 'Code civil, art. 1755', url: U.c1755,
    extrait: 'Aucune des réparations réputées locatives n\'est à la charge des locataires quand elles ne sont occasionnées que par vétusté ou force majeure.' },
  'env-r22415': { ref: 'Code de l\'environnement, art. R224-41-5', url: U.r22415,
    extrait: 'Lorsque le logement, le local, le bâtiment ou partie de bâtiment est équipé d\'une chaudière individuelle, l\'entretien est effectué à l\'initiative de l\'occupant, sauf, le cas échéant, stipulation contraire du bail.' },
  'env-r22415-coll': { ref: 'Code de l\'environnement, art. R224-41-5, al. 2', url: U.r22415,
    extrait: 'L\'entretien des chaudières collectives est effectué à l\'initiative du propriétaire ou du syndicat des copropriétaires de l\'immeuble.' },
  'cch-r1423': { ref: 'Code de la construction et de l\'habitation, art. R142-3', url: U.r1423,
    extrait: 'La responsabilité de l\'installation du détecteur de fumée mentionné à l\'article R. 142-2 incombe au propriétaire et la responsabilité de son entretien, ainsi que, si nécessaire, de son renouvellement incombe à l\'occupant du logement.' },
  'cch-r1423-meuble': { ref: 'Code de la construction et de l\'habitation, art. R142-3, al. 2 et 1°', url: U.r1423,
    extrait: 'Cependant, cette responsabilité d\'installation, d\'entretien et de renouvellement incombe : 1° au propriétaire pour les logements à caractère saisonnier, les logements-foyers mentionnés à l\'article R. 832-20 dont la gestion est assurée par le propriétaire ou par un organisme autres que ceux mentionnés à l\'article L. 365-4, les résidences hôtelières à vocation sociale, les logements attribués ou loués en raison de l\'exercice d\'une fonction ou d\'un emploi et les locations meublées ;' },
  'l6557-14': { ref: 'Loi n° 65-557 du 10 juillet 1965, art. 14', url: U.l6514,
    extrait: 'Il a pour objet la conservation et l\'amélioration de l\'immeuble ainsi que l\'administration des parties communes. Le syndicat est responsable des dommages causés aux copropriétaires ou aux tiers ayant leur origine dans les parties communes, sans préjudice de toutes actions récursoires.' },
  'assur-l1132': { ref: 'Code des assurances, art. L113-2, 4°', url: U.l1132,
    extrait: 'De donner avis à l\'assureur, dès qu\'il en a eu connaissance et au plus tard dans le délai fixé par le contrat, de tout sinistre de nature à entraîner la garantie de l\'assureur. Ce délai ne peut être inférieur à cinq jours ouvrés.' },
  'devis-2017': { ref: 'Arrêté du 24 janvier 2017, art. 4, I', url: U.dev,
    extrait: 'Préalablement à l\'exécution de toute prestation visée à l\'article 1er, conclue en établissement commercial, le professionnel remet au client un devis détaillé, qui comporte, outre les mentions des articles L. 111-1 et L. 111-2 du code de la consommation, les mentions suivantes :' },
  'l71-54': { ref: 'Loi n° 71-1130 du 31 décembre 1971, art. 54', url: U.l54,
    extrait: 'Nul ne peut, directement ou par personne interposée, à titre habituel et rémunéré, donner des consultations juridiques ou rédiger des actes sous seing privé, pour autrui :' },
});

/* ─────────────── Référentiels de saisie ─────────────── */

/**
 * Éléments : `ann` = rubrique de l'annexe du décret 87-712 (null = hors liste),
 * `metier` = clé de NAF_METIERS pour « Qui appeler ».
 */
export const ELEMENTS = Object.freeze([
  // Annexe du décret 87-712
  { k: 'jardin', lbl: 'Jardin privatif', groupe: 'Extérieurs', ann: 'ann-Ia', metier: 'jardin' },
  { k: 'terrasse', lbl: 'Terrasse, auvent, marquise', groupe: 'Extérieurs', ann: 'ann-Ib', metier: 'couverture' },
  { k: 'gouttiere', lbl: 'Gouttière, descente d\'eaux pluviales', groupe: 'Extérieurs', ann: 'ann-Ic', metier: 'couverture' },
  { k: 'porte_fenetre', lbl: 'Porte ou fenêtre (poignée, gonds, crémone)', groupe: 'Ouvertures', ann: 'ann-IIa', metier: 'menuiserie' },
  { k: 'vitre', lbl: 'Vitre', groupe: 'Ouvertures', ann: 'ann-IIb', metier: 'vitrerie', remplacementListe: true },
  { k: 'volet', lbl: 'Volet roulant, store, jalousie', groupe: 'Ouvertures', ann: 'ann-IIc', metier: 'menuiserie' },
  { k: 'serrure', lbl: 'Serrure, verrou, clés', groupe: 'Ouvertures', ann: 'ann-IId', metier: 'serrurerie' },
  { k: 'grille', lbl: 'Grille', groupe: 'Ouvertures', ann: 'ann-IIe', metier: 'serrurerie' },
  { k: 'mur_plafond', lbl: 'Murs, plafond, cloisons (peinture, papier, faïence)', groupe: 'Intérieur', ann: 'ann-IIIa', metier: 'peinture' },
  { k: 'sol', lbl: 'Parquet, moquette, revêtement de sol', groupe: 'Intérieur', ann: 'ann-IIIb', metier: 'sol' },
  { k: 'placard', lbl: 'Placard, plinthes, moulures', groupe: 'Intérieur', ann: 'ann-IIIc', metier: 'menuiserie' },
  { k: 'canalisation', lbl: 'Canalisation d\'eau, évacuation (bouchon, joint)', groupe: 'Plomberie', ann: 'ann-IVa', metier: 'plomberie' },
  { k: 'gaz_raccord', lbl: 'Robinet ou tuyau souple de gaz', groupe: 'Plomberie', ann: 'ann-IVb', metier: 'plomberie', remplacementListe: true },
  { k: 'fosse', lbl: 'Fosse septique, puisard', groupe: 'Plomberie', ann: 'ann-IVc', metier: 'assainissement' },
  { k: 'robinet', lbl: 'Robinetterie', groupe: 'Plomberie', ann: 'ann-IVd-robinet', metier: 'plomberie' },
  { k: 'chasse_eau', lbl: 'Chasse d\'eau, WC', groupe: 'Plomberie', ann: 'ann-IVd-chasse', metier: 'plomberie' },
  { k: 'sanitaire', lbl: 'Évier, lavabo, baignoire, douche', groupe: 'Plomberie', ann: 'ann-IVe', metier: 'plomberie' },
  { k: 'radiateur', lbl: 'Radiateur (corps de chauffe)', groupe: 'Chauffage et eau chaude', ann: 'ann-IVd-chauffe', metier: 'chauffage' },
  { k: 'chaudiere', lbl: 'Chaudière individuelle', groupe: 'Chauffage et eau chaude', ann: 'ann-IVd-gaz', metier: 'chauffage', special: 'chaudiere' },
  { k: 'electricite', lbl: 'Prise, interrupteur, ampoule, fusible', groupe: 'Électricité', ann: 'ann-V', metier: 'electricite', remplacementListe: true },
  { k: 'electromenager', lbl: 'Appareil ménager mentionné au bail', groupe: 'Équipements', ann: 'ann-VIa', metier: 'electromenager', special: 'electromenager' },
  { k: 'pac_clim', lbl: 'Pompe à chaleur, climatisation', groupe: 'Équipements', ann: 'ann-VIa', metier: 'chauffage' },
  { k: 'antenne', lbl: 'Antenne individuelle', groupe: 'Équipements', ann: 'ann-VIa', metier: 'electricite' },
  { k: 'conduit', lbl: 'Conduit de fumée ou de ventilation (ramonage)', groupe: 'Équipements', ann: 'ann-VId', metier: 'ramonage', special: 'conduit' },
  // Hors liste du décret
  { k: 'ballon', lbl: 'Ballon ou chauffe-eau électrique', groupe: 'Chauffage et eau chaude', ann: null, metier: 'plomberie', special: 'ballon' },
  { k: 'chauffage_coll', lbl: 'Chauffage ou eau chaude collectifs', groupe: 'Chauffage et eau chaude', ann: null, metier: 'chauffage', special: 'collectif' },
  { k: 'tableau_elec', lbl: 'Tableau ou installation électrique', groupe: 'Électricité', ann: null, metier: 'electricite' },
  { k: 'vmc', lbl: 'Ventilation mécanique (VMC)', groupe: 'Équipements', ann: null, metier: 'chauffage' },
  { k: 'detecteur', lbl: 'Détecteur de fumée', groupe: 'Équipements', ann: null, metier: 'electricite', special: 'detecteur' },
  { k: 'menuiserie', lbl: 'Fenêtre ou porte entière (menuiserie)', groupe: 'Ouvertures', ann: null, metier: 'menuiserie' },
  { k: 'toiture', lbl: 'Toiture, couverture', groupe: 'Bâti', ann: null, metier: 'couverture' },
  { k: 'facade', lbl: 'Façade, murs extérieurs', groupe: 'Bâti', ann: null, metier: 'maconnerie' },
  { k: 'structure', lbl: 'Murs porteurs, planchers, charpente', groupe: 'Bâti', ann: null, metier: 'maconnerie' },
  { k: 'autre', lbl: 'Autre (à décrire)', groupe: 'Autre', ann: null, metier: null, special: 'autre' },
]);
const _EL = ELEMENTS.reduce((m, e) => { m[e.k] = e; return m; }, {});
export function elementDef(k) { return _EL[k] || null; }

export const NATURES = Object.freeze([
  { k: 'panne', lbl: 'Panne' }, { k: 'fuite', lbl: 'Fuite' }, { k: 'casse', lbl: 'Casse' },
  { k: 'usure', lbl: 'Usure' }, { k: 'entretien', lbl: 'Entretien' },
  { k: 'humidite', lbl: 'Humidité, moisissures' }, { k: 'nuisibles', lbl: 'Nuisibles' },
  { k: 'degat_eaux', lbl: 'Dégât des eaux' }, { k: 'autre', lbl: 'Autre' },
]);
export const INTERVENTIONS = Object.freeze([
  { k: 'inconnue', lbl: 'Non déterminé' }, { k: 'entretien', lbl: 'Entretien' },
  { k: 'petite_piece', lbl: 'Petite pièce' }, { k: 'quelques_elements', lbl: 'Quelques éléments' },
  { k: 'remplacement_complet', lbl: 'Remplacement complet' }, { k: 'installation', lbl: 'Installation' },
  { k: 'mise_en_conformite', lbl: 'Mise en conformité' },
]);
export const CAUSES = Object.freeze([
  { k: 'inconnue', lbl: 'Inconnue' }, { k: 'usage_normal', lbl: 'Usure normale' },
  { k: 'vetuste', lbl: 'Vétusté' }, { k: 'faute_locataire', lbl: 'Faute ou négligence du locataire' },
  { k: 'defaut_entretien', lbl: 'Défaut d\'entretien' }, { k: 'malfacon_vice', lbl: 'Malfaçon ou vice' },
  { k: 'sinistre', lbl: 'Sinistre' }, { k: 'force_majeure', lbl: 'Force majeure' },
  { k: 'tiers', lbl: 'Fait d\'un tiers' },
]);
export const URGENCES = Object.freeze([
  { k: 'eau', lbl: 'De l\'eau coule', consignes: ['Couper l\'arrivée d\'eau au robinet le plus proche ou au compteur.', 'Couper l\'électricité si l\'eau approche des prises ou du tableau électrique.'] },
  { k: 'gaz', lbl: 'Odeur de gaz', consignes: ['Ne pas allumer ni éteindre d\'appareil électrique, ne pas faire de flamme.', 'Ouvrir les fenêtres, fermer le robinet de gaz si possible, sortir du logement.', 'Appeler le 112 ou le 18 depuis l\'extérieur.'] },
  { k: 'chauffage', lbl: 'Plus de chauffage ou d\'eau chaude', consignes: ['Vérifier le disjoncteur et, pour une chaudière, le voyant de sécurité, sans démonter l\'appareil.'] },
  { k: 'porte', lbl: 'La porte d\'entrée ne ferme plus', consignes: ['Exiger un devis écrit avant toute intervention d\'un serrurier, même en urgence.'] },
  { k: 'electricite', lbl: 'Plus d\'électricité', consignes: ['Vérifier le disjoncteur général ; ne pas intervenir sur le tableau électrique.'] },
]);
export const CONSIGNE_DANGER = 'Danger immédiat : 112 ou 18.';

const _has = (list, k) => list.some((x) => x.k === k);
function _norm(input) {
  const i = input || {};
  const ctx = i.contexte || {};
  const tri = (v) => (v === true ? true : v === false ? false : null);
  return {
    element: _EL[i.element] ? i.element : 'autre',
    nature: _has(NATURES, i.nature) ? i.nature : 'autre',
    intervention: _has(INTERVENTIONS, i.intervention) ? i.intervention : 'inconnue',
    cause: _has(CAUSES, i.cause) ? i.cause : 'inconnue',
    urgences: Array.isArray(i.urgences) ? i.urgences.filter((u) => _has(URGENCES, u)) : [],
    contexte: {
      meuble: tri(ctx.meuble),
      partieCommune: ctx.partieCommune === true,
      copro: tri(ctx.copro),
      clauseChaudiereBailleur: ctx.clauseChaudiereBailleur === true,
    },
  };
}

const _T = (ids) => ids.filter((id) => TEXTES[id]).map((id) => ({ id, ...TEXTES[id] }));
const _PIECES_BASE = ['Photos datées de l\'incident', 'État des lieux d\'entrée (rubrique concernée)'];

function _v(payeur, regle, confiance, resume, textes, extra) {
  return Object.assign({
    version: QP_VERSION, payeur, regle, confiance, resume,
    textes: _T(textes || []), lectures: [], pieces: _PIECES_BASE.slice(),
  }, extra || {});
}
function _lect(payeur, si, textes) { return { payeur, si, textes: _T(textes) }; }
function _arb(regle, resume, l1, l2, pieces) {
  return _v(PAYEURS.ARBITRER, regle, CONFIANCE.ARBITRER, resume, [], {
    lectures: [l1, l2], pieces: (pieces || []).concat(_PIECES_BASE),
  });
}

/** Consignes de sécurité pour les urgences cochées (affichées AVANT le verdict). */
export function consignesUrgence(urgences) {
  const ks = Array.isArray(urgences) ? urgences : [];
  const out = [];
  URGENCES.forEach((u) => { if (ks.includes(u.k)) u.consignes.forEach((c) => { if (!out.includes(c)) out.push(c); }); });
  if (!out.length) return null;
  out.push(CONSIGNE_DANGER);
  return { urgences: URGENCES.filter((u) => ks.includes(u.k)).map((u) => u.lbl), consignes: out };
}

/** Checklist du circuit assurance (R15). `copro` ajoute le syndic. */
export function checklistSinistre(copro) {
  const l = [
    { qui: 'Locataire', k: 'mrh', lbl: 'Déclarer le sinistre à l\'assurance habitation', detail: 'Au plus tard dans le délai fixé par le contrat — au moins 5 jours ouvrés (2 en cas de vol).' },
    { qui: 'Locataire et voisin', k: 'constat', lbl: 'Remplir un constat amiable dégât des eaux', detail: 'Avec l\'occupant du logement d\'où vient la fuite, le cas échéant.' },
    { qui: 'Bailleur', k: 'pno', lbl: 'Prévenir l\'assurance propriétaire non occupant (PNO)', detail: '' },
  ];
  if (copro !== false) l.push({ qui: 'Bailleur', k: 'syndic', lbl: 'Prévenir le syndic', detail: 'Si l\'immeuble est en copropriété ou si la fuite vient des parties communes.' });
  l.push({ qui: 'Tous', k: 'photos', lbl: 'Photos datées des dégâts', detail: '' });
  l.push({ qui: 'Tous', k: 'conserver', lbl: 'Conserver les éléments endommagés et faire rechercher la fuite', detail: '' });
  return l;
}

/**
 * LE MOTEUR. Entrée : { element, nature, intervention, cause, urgences[], contexte:{meuble,
 * partieCommune, copro, clauseChaudiereBailleur} }. Sortie : verdict sourcé (voir CDC §3.2).
 */
export function quiPaie(input) {
  const n = _norm(input);
  const v = _quiPaieCore(n);
  v.urgence = consignesUrgence(n.urgences);
  if (!v.sinistre) v.sinistre = null;
  v.metier = (elementDef(n.element) || {}).metier || null;
  v.mention = MENTION_LEGALE;
  return v;
}

function _quiPaieCore(n) {
  const el = elementDef(n.element);
  const { cause, intervention, nature, contexte } = n;
  const ann = el.ann;

  // 1. Sinistre assurable → circuit assurance, sans verdict de responsabilité (R15).
  if (cause === 'sinistre' || nature === 'degat_eaux') {
    return _v(PAYEURS.ASSURANCE, 'R15', CONFIANCE.PROBABLE,
      'Un sinistre se règle entre assurances : aucun responsable n\'est désigné ici. Suivre la liste et garder chaque pièce.',
      ['assur-l1132', 'a7g'], { sinistre: { checklist: checklistSinistre(contexte.copro) }, pieces: ['Constat amiable', 'Photos datées des dégâts', 'Factures des biens endommagés'] });
  }

  // 2. Partie commune → syndic (copropriété) ou bailleur (monopropriété) (R14).
  if (contexte.partieCommune || el.special === 'collectif') {
    const entretienColl = el.special === 'collectif' && (intervention === 'entretien');
    const txtSyndic = entretienColl ? ['env-r22415-coll'] : ['l6557-14'];
    const txtBailleur = entretienColl ? ['env-r22415-coll'] : ['a6c', 'c1720'];
    if (contexte.copro === true) {
      return _v(PAYEURS.SYNDIC, entretienColl ? 'R8' : 'R14', entretienColl ? CONFIANCE.EXPLICITE : CONFIANCE.PROBABLE,
        'Une partie ou un équipement commun d\'un immeuble en copropriété relève du syndicat des copropriétaires : prévenir le syndic. Le bailleur en paie sa quote-part par les appels de fonds.',
        txtSyndic, { pieces: ['Photos datées', 'Échanges avec le syndic'] });
    }
    if (contexte.copro === false) {
      // R224-41-5 al. 2 dit QUI fait réaliser l'entretien collectif, pas qui en supporte le coût final :
      // le bailleur l'avance ; il peut être récupérable dans les charges selon le bail (décret 87-713).
      return _v(PAYEURS.BAILLEUR, entretienColl ? 'R8' : 'R14', CONFIANCE.PROBABLE,
        entretienColl
          ? 'L\'immeuble n\'est pas en copropriété : le propriétaire fait réaliser l\'entretien du chauffage collectif. Il en avance le coût, qui peut être récupérable dans les charges selon le bail.'
          : 'L\'immeuble n\'est pas en copropriété : les parties et équipements communs relèvent du propriétaire de l\'immeuble.',
        txtBailleur);
    }
    return _arb(entretienColl ? 'R8' : 'R14', 'Le régime de l\'immeuble n\'est pas renseigné : la réponse dépend de l\'existence d\'une copropriété.',
      _lect(PAYEURS.SYNDIC, 'si l\'immeuble est en copropriété', txtSyndic),
      _lect(PAYEURS.BAILLEUR, 'si le propriétaire possède tout l\'immeuble (monopropriété)', txtBailleur),
      ['Règlement de copropriété ou titre de propriété']);
  }

  // 3. Humidité, moisissures (R16) et nuisibles : zones grises.
  if (nature === 'humidite') {
    return _arb('R16', 'La loi ne tranche pas seule : tout dépend de l\'origine de l\'humidité.',
      _lect(PAYEURS.BAILLEUR, 'si l\'humidité vient d\'un défaut de ventilation, d\'isolation ou d\'une infiltration : le logement doit rester décent', ['a6-al1', 'a6c']),
      _lect(PAYEURS.LOCATAIRE, 'si un défaut d\'aération ou d\'entretien courant est en cause', ['a7c']),
      ['Photos de la ventilation (VMC, bouches)', 'Date d\'apparition et pièce concernée', 'Avis écrit d\'un professionnel']);
  }
  if (nature === 'nuisibles') {
    return _arb('Z9', 'Le logement doit être remis exempt de nuisibles ; pendant le bail, l\'origine de l\'infestation décide.',
      _lect(PAYEURS.BAILLEUR, 'si l\'infestation existait à l\'entrée ou vient du bâti', ['a6-al1']),
      _lect(PAYEURS.LOCATAIRE, 'si elle est apparue pendant le bail du fait de l\'occupant', ['a7c']),
      ['Date d\'apparition', 'État des lieux d\'entrée', 'Rapport du professionnel']);
  }

  // 4. Éléments à règle propre.
  if (el.special === 'detecteur') {
    if (intervention === 'installation' || intervention === 'mise_en_conformite') {
      return _v(PAYEURS.BAILLEUR, 'R10', CONFIANCE.EXPLICITE, 'L\'installation du détecteur de fumée incombe au propriétaire.', ['cch-r1423']);
    }
    if (contexte.meuble === true) {
      return _v(PAYEURS.BAILLEUR, 'R11', CONFIANCE.EXPLICITE, 'En location meublée, l\'installation, l\'entretien et le renouvellement du détecteur incombent au propriétaire.', ['cch-r1423-meuble']);
    }
    if (cause === 'malfacon_vice') {
      return _arb('R11', 'Un détecteur défectueux dès l\'origine n\'est pas une question d\'entretien : la cause décide.',
        _lect(PAYEURS.BAILLEUR, 'si l\'appareil installé était défectueux ou non conforme', ['cch-r1423']),
        _lect(PAYEURS.LOCATAIRE, contexte.meuble === true ? 'jamais en location meublée' : 'si seul le renouvellement normal est en cause (location nue)', contexte.meuble === true ? ['cch-r1423-meuble'] : ['cch-r1423']),
        ['Date d\'installation', 'Facture de l\'appareil']);
    }
    if (contexte.meuble === false) {
      return _v(PAYEURS.LOCATAIRE, 'R11', CONFIANCE.EXPLICITE, 'L\'entretien et, si nécessaire, le renouvellement du détecteur incombent à l\'occupant.', ['cch-r1423']);
    }
    return _arb('R11', 'Le type de location (nue ou meublée) n\'est pas connu : il décide.',
      _lect(PAYEURS.LOCATAIRE, 'en location nue', ['cch-r1423']),
      _lect(PAYEURS.BAILLEUR, 'en location meublée', ['cch-r1423-meuble']), ['Bail (type de location)']);
  }

  if (el.special === 'chaudiere') {
    if (intervention === 'entretien') {
      if (contexte.clauseChaudiereBailleur) {
        return _v(PAYEURS.BAILLEUR, 'R6', CONFIANCE.EXPLICITE, 'Le bail confie l\'entretien de la chaudière au bailleur.', ['env-r22415']);
      }
      return _v(PAYEURS.LOCATAIRE, 'R6', CONFIANCE.EXPLICITE, 'L\'entretien annuel d\'une chaudière individuelle est à l\'initiative de l\'occupant, sauf clause contraire du bail.', ['env-r22415', 'a7d'], { pieces: ['Attestation d\'entretien annuel'] });
    }
    if (intervention === 'remplacement_complet') {
      if (cause === 'faute_locataire' || cause === 'defaut_entretien') {
        return _arb('R7', 'Le remplacement revient au bailleur, sauf si un défaut d\'entretien ou une faute du locataire est prouvé.',
          _lect(PAYEURS.BAILLEUR, 'si la chaudière est en fin de vie ou si le défaut d\'entretien n\'est pas prouvé', ['a6c', 'c1720']),
          _lect(PAYEURS.LOCATAIRE, 'si le défaut d\'entretien ou la faute est prouvé', ['a7c', 'env-r22415']),
          ['Attestations d\'entretien annuel', 'Rapport du chauffagiste', 'Âge de la chaudière']);
      }
      return _v(PAYEURS.BAILLEUR, 'R7', CONFIANCE.PROBABLE, 'Le remplacement d\'une chaudière n\'est pas une réparation locative : il revient au bailleur, sauf défaut d\'entretien prouvé.', ['a6c', 'c1720'], { pieces: ['Attestations d\'entretien annuel', 'Rapport du chauffagiste'] });
    }
    if ((intervention === 'installation' || intervention === 'mise_en_conformite') && cause !== 'faute_locataire') {
      return _v(PAYEURS.BAILLEUR, 'R7', CONFIANCE.PROBABLE, 'Installer ou mettre en conformité la chaudière n\'est pas une réparation locative : cela revient au bailleur.', ['a6c', 'c1720']);
    }
    // Panne : petite pièce d'usure (IV d) ou remplacement → zone grise si on ne sait pas.
    if (intervention === 'inconnue' || cause === 'inconnue') {
      return _arb('Z4', 'Chaudière en panne : une petite pièce d\'usure relève du locataire, une réparation lourde ou un remplacement du bailleur.',
        _lect(PAYEURS.LOCATAIRE, 'si la panne se répare par une petite pièce listée (membrane, allumage, joint, clapet) et vient de l\'usage normal', ['ann-IVd-gaz', 'a7d']),
        _lect(PAYEURS.BAILLEUR, 'si la réparation dépasse ces pièces, ou vient de la vétusté ou d\'un vice', ['a6c', 'c1755']),
        ['Diagnostic écrit du chauffagiste', 'Attestations d\'entretien annuel', 'Âge de la chaudière']);
    }
  }

  if (el.special === 'conduit' && intervention !== 'entretien' && intervention !== 'inconnue') {
    // Réparation du conduit lui-même (pas un ramonage) : hors liste.
    return _horsListe(n);
  }

  if (el.special === 'ballon' && (intervention === 'entretien' || intervention === 'petite_piece')) {
    return _arb('Z5', 'Ballon entartré ou petite réparation : l\'entretien courant relève du locataire, une réparation de l\'appareil du bailleur.',
      _lect(PAYEURS.LOCATAIRE, 'si seul un rinçage ou un nettoyage est nécessaire', ['ann-IVd-chauffe', 'a7d']),
      _lect(PAYEURS.BAILLEUR, 'si une pièce de l\'appareil est à remplacer ou si l\'usure vient de la vétusté', ['a6c', 'c1755']),
      ['Diagnostic du professionnel', 'Âge du ballon']);
  }

  if (el.special === 'electromenager') {
    if (intervention === 'remplacement_complet' && (cause === 'usage_normal' || cause === 'vetuste' || cause === 'inconnue')) {
      return _v(PAYEURS.BAILLEUR, 'R13', CONFIANCE.PROBABLE, 'Le remplacement d\'un appareil mentionné au bail et usé n\'est pas une menue réparation : il revient au bailleur.', ['a6c', 'c1720'], { pieces: ['Âge et facture de l\'appareil', 'Diagnostic du réparateur'] });
    }
    if (contexte.meuble === true && intervention === 'inconnue') {
      return _arb('Z7', 'Appareil d\'un meublé : une menue réparation relève du locataire, un remplacement du bailleur.',
        _lect(PAYEURS.LOCATAIRE, 'si une menue réparation suffit', ['ann-VIa', 'a7d']),
        _lect(PAYEURS.BAILLEUR, 'si l\'appareil est à remplacer pour usure', ['a6c']),
        ['Diagnostic du réparateur', 'Âge de l\'appareil']);
    }
  }

  // 5. Règle générale.
  if (el.special === 'autre') return _autre(n);
  return ann ? _listeDecret(n, el) : _horsListe(n);
}

/** Élément de la liste du décret 87-712 (R1, R2, R3, R5, R12, R9, Z1, Z8). */
function _listeDecret(n, el) {
  const { cause, intervention } = n;
  const regleUsage = el.k === 'electromenager' ? 'R12' : (el.k === 'conduit' ? 'R9' : 'R1');
  // Installer ou mettre en conformité un élément n'est pas une réparation locative (art. 6 a et c).
  if ((intervention === 'installation' || intervention === 'mise_en_conformite') && cause !== 'faute_locataire') {
    return _v(PAYEURS.BAILLEUR, 'R4', CONFIANCE.PROBABLE, 'Installer ou mettre en conformité un équipement n\'est pas une réparation locative : cela revient au bailleur.', ['a6c', 'c1720']);
  }
  // L'entretien courant (ramonage, graissage, détartrage…) ne dépend pas d'une cause.
  if (intervention === 'entretien' && (cause === 'inconnue' || cause === 'usage_normal')) {
    return _v(PAYEURS.LOCATAIRE, regleUsage, CONFIANCE.EXPLICITE, 'L\'entretien courant figure dans la liste des réparations locatives.', [el.ann, 'a7d']);
  }
  if (cause === 'faute_locataire' || cause === 'defaut_entretien') {
    return _v(PAYEURS.LOCATAIRE, 'R5', CONFIANCE.PROBABLE, 'Le locataire répond des dégradations survenues pendant le bail, sauf s\'il prouve la force majeure, la faute du bailleur ou le fait d\'un tiers qu\'il n\'a pas introduit.', ['a7c'], { pieces: ['Photos datées', 'État des lieux d\'entrée', 'Échanges avec le locataire'] });
  }
  if (cause === 'vetuste') {
    return _v(PAYEURS.BAILLEUR, 'R2', CONFIANCE.PROBABLE, 'Une réparation locative occasionnée par la vétusté reste à la charge du bailleur. Tout dépend de la preuve de l\'âge de l\'élément.', ['a7d', 'c1755'], { pieces: ['Âge de l\'élément (facture de pose, état des lieux d\'entrée)', 'Photos datées'] });
  }
  if (cause === 'malfacon_vice' || cause === 'force_majeure') {
    const t = ['a7d', 'c1755'];
    if (el.k === 'vitre' && cause === 'force_majeure') t.push('c1754-vitres');
    return _v(PAYEURS.BAILLEUR, 'R3', CONFIANCE.PROBABLE, 'Une réparation occasionnée par une malfaçon, un vice, un cas fortuit ou une force majeure ne revient pas au locataire.', t);
  }
  if (cause === 'tiers') {
    return _arb('R5', 'Le fait d\'un tiers décharge le locataire seulement si ce tiers n\'a pas été introduit par lui dans le logement.',
      _lect(PAYEURS.BAILLEUR, 'si le tiers n\'a pas été introduit par le locataire', ['a7c']),
      _lect(PAYEURS.LOCATAIRE, 'si le locataire a introduit ce tiers dans le logement', ['a7c']),
      ['Dépôt de plainte ou attestation', 'Photos datées']);
  }
  if (cause === 'usage_normal') {
    if (intervention === 'remplacement_complet') {
      // La rubrique liste ELLE-MÊME le remplacement (vitres détériorées, prises et interrupteurs, tuyaux
      // souples de gaz) : il reste locatif, comme toute réparation listée due à l'usage normal.
      if (el.remplacementListe) return _v(PAYEURS.LOCATAIRE, regleUsage, CONFIANCE.EXPLICITE, 'Le remplacement de cet élément figure lui-même dans la liste des réparations locatives. Il reste à la charge du bailleur seulement s\'il vient de la vétusté, d\'une malfaçon, d\'un vice, d\'un cas fortuit ou d\'une force majeure.', [el.ann, 'a7d']);
      return _v(PAYEURS.BAILLEUR, 'R4', CONFIANCE.PROBABLE, 'Un remplacement complet dépasse les menues réparations : il revient au bailleur. Si seuls quelques éléments sont à remplacer, la réparation reste locative.', ['a6c', 'c1720'], { pieces: ['Devis détaillé', 'Photos datées'] });
    }
    if (intervention === 'inconnue') {
      return _arb('Z1', 'Tout dépend de l\'ampleur de la réparation : menue réparation (locataire) ou remplacement complet (bailleur).',
        _lect(PAYEURS.LOCATAIRE, 'si une menue réparation ou le remplacement de quelques éléments suffit', [el.ann, 'a7d']),
        _lect(PAYEURS.BAILLEUR, 'si l\'élément entier est à remplacer', ['a6c', 'c1720']),
        ['Devis détaillé', 'Photos datées']);
    }
    const why = el.k === 'conduit'
      ? 'Le ramonage figure dans la liste des réparations locatives.'
      : 'Cette réparation figure dans la liste des réparations locatives. Elle reste à la charge du bailleur seulement si elle vient de la vétusté, d\'une malfaçon, d\'un vice, d\'un cas fortuit ou d\'une force majeure.';
    return _v(PAYEURS.LOCATAIRE, regleUsage, CONFIANCE.EXPLICITE, why, [el.ann, 'a7d']);
  }
  // Cause inconnue : jamais « locataire » par défaut.
  return _arb(regleUsage, 'La cause n\'est pas connue : elle décide qui paie.',
    _lect(PAYEURS.LOCATAIRE, 'si la panne vient de l\'usage normal (réparation locative listée)', [el.ann, 'a7d']),
    _lect(PAYEURS.BAILLEUR, 'si elle vient de la vétusté, d\'une malfaçon, d\'un vice ou d\'une force majeure', ['a7d', 'c1755']),
    ['Âge de l\'élément', 'Diagnostic écrit du professionnel']);
}

/** Élément hors liste du décret (R4, R5) : règle par défaut, le bailleur. */
function _horsListe(n) {
  const { cause, nature, intervention, element } = n;
  // Zone grise n° 10 (CDC §3.5) : une CASSE survenue pendant le bail, cause non établie — le locataire
  // répond des dégradations sauf preuve contraire (art. 7 c) ; ce n'est pourtant pas une réparation locative.
  if (nature === 'casse' && cause === 'inconnue') {
    return _arb('Z10', 'Une casse survenue pendant le bail : sans cause établie, la charge de la preuve décide.',
      _lect(PAYEURS.LOCATAIRE, 'si la casse est survenue pendant le bail et que le locataire ne prouve ni force majeure, ni faute du bailleur, ni fait d\'un tiers non introduit', ['a7c']),
      _lect(PAYEURS.BAILLEUR, 'si la casse vient de l\'usure, de la vétusté ou d\'un vice de l\'élément', ['a6c', 'c1720']),
      ['Photos datées', 'État des lieux d\'entrée', 'Diagnostic écrit du professionnel']);
  }
  // Entretien courant d'un équipement hors de la liste : l'art. 7 d met l'entretien courant des
  // équipements mentionnés au contrat à la charge du locataire ; l'entretien normal des locaux reste au bailleur.
  if (intervention === 'entretien' && (cause === 'inconnue' || cause === 'usage_normal')) {
    return _arb('Z2', 'L\'entretien courant d\'un équipement relève du locataire ; l\'entretien normal des locaux et les réparations, du bailleur.',
      _lect(PAYEURS.LOCATAIRE, 'si c\'est l\'entretien courant d\'un équipement mentionné au bail (nettoyage, réglage)', element === 'vmc' ? ['a7d', 'ann-VId'] : ['a7d']),
      _lect(PAYEURS.BAILLEUR, 'si c\'est l\'entretien normal des locaux ou une réparation de l\'équipement', ['a6c', 'c1720']),
      ['Contrat d\'entretien éventuel', 'Bail (équipements mentionnés)']);
  }
  if (cause === 'faute_locataire') {
    return _v(PAYEURS.LOCATAIRE, 'R5', CONFIANCE.PROBABLE, 'Le locataire répond des dégradations survenues pendant le bail, sauf s\'il prouve la force majeure, la faute du bailleur ou le fait d\'un tiers qu\'il n\'a pas introduit.', ['a7c'], { pieces: ['Photos datées', 'État des lieux d\'entrée', 'Échanges avec le locataire'] });
  }
  if (cause === 'defaut_entretien' || cause === 'tiers') {
    return _arb('R5', 'Ce n\'est pas une réparation locative, mais une dégradation imputable au locataire resterait à sa charge.',
      _lect(PAYEURS.BAILLEUR, 'si aucune faute ni défaut d\'entretien du locataire n\'est prouvé', ['a6c', 'c1720']),
      _lect(PAYEURS.LOCATAIRE, 'si la dégradation vient de son fait ou d\'un tiers qu\'il a introduit', ['a7c']),
      ['Photos datées', 'Diagnostic écrit du professionnel']);
  }
  const conf = cause === 'force_majeure' ? CONFIANCE.PROBABLE : CONFIANCE.EXPLICITE;
  return _v(PAYEURS.BAILLEUR, 'R4', conf, 'Ce n\'est pas une réparation locative : elle revient au bailleur. Seule une faute ou une négligence prouvée du locataire changerait la lecture (art. 7 c).', ['c1720', 'a6c'], { pieces: ['Devis détaillé', 'Facture', 'Photos datées'] });
}

/** Élément « autre » : on ne sait pas s'il est dans la liste → à arbitrer, sauf faute. */
function _autre(n) {
  if (n.cause === 'faute_locataire') return _horsListe(n);
  return _arb('R4', 'L\'élément n\'est pas identifié : préciser l\'élément pour obtenir une règle.',
    _lect(PAYEURS.LOCATAIRE, 'si c\'est un entretien courant ou une menue réparation liés à l\'usage normal', ['d87712-1', 'a7d']),
    _lect(PAYEURS.BAILLEUR, 'si ce n\'est pas une réparation locative', ['a6c', 'c1720']),
    ['Description précise', 'Photos datées']);
}

/* ─────────────── Message au locataire (payeur = locataire) ─────────────── */

/**
 * Brouillon neutre (ni tu ni vous) que le bailleur relit puis envoie lui-même.
 * @param {object} verdict sortie de quiPaie
 * @param {{element?:string, dateSignalement?:string, bien?:string, signataire?:string}} ctx
 * @returns {string|null} null si le payeur suggéré n'est pas le locataire.
 */
export function messageLocataire(verdict, ctx) {
  if (!verdict) return null;
  const c = ctx || {};
  // Les textes CITÉS sont toujours ceux qui désignent le locataire : ceux du verdict s'il le désigne, sinon
  // ceux de la lecture « locataire » d'une zone grise. Jamais les obligations du bailleur (relecture C3).
  // Le bailleur a retenu « locataire » contre une suggestion « bailleur » (`retenuLocataire`) : aucun texte
  // ne le dit → message SANS citation et sans « relève de ».
  let textes = null;
  if (verdict.payeur === PAYEURS.LOCATAIRE) textes = verdict.textes || [];
  else {
    const l = (verdict.lectures || []).find((x) => x.payeur === PAYEURS.LOCATAIRE);
    if (l) textes = l.textes || [];
    else if (!c.retenuLocataire) return null;
  }
  const el = c.element || 'l\'élément signalé';
  const lignes = [];
  lignes.push(`Objet : ${el}${c.bien ? ' — ' + c.bien : ''}`);
  lignes.push('');
  lignes.push('Bonjour,');
  lignes.push('');
  const intro = c.dateSignalement ? 'Suite au signalement du ' + c.dateSignalement + ', la' : 'La';
  if (textes && textes.length) {
    lignes.push(`${intro} réparation signalée (${el}) relève des réparations à la charge du locataire :`);
    textes.forEach((t) => { lignes.push(`- ${t.ref} : « ${t.extrait} »`); });
  } else {
    lignes.push(`${intro} réparation signalée (${el}) est, selon le bailleur, à la charge du locataire. Pour toute question, le contacter.`);
  }
  lignes.push('');
  lignes.push('Si la cause est autre (vétusté, malfaçon, vice), merci de le signaler : la réparation reviendrait alors au bailleur.');
  lignes.push('');
  lignes.push('Rappel : l\'assurance habitation est obligatoire (loi n° 89-462, article 7 g) ; selon le contrat, elle peut couvrir certains dommages.');
  lignes.push('');
  lignes.push('Cordialement,');
  if (c.signataire) lignes.push(c.signataire);
  return lignes.join('\n');
}

/* ─────────────── Qualification de la dépense (suggestion, pas un conseil fiscal) ─────────────── */

/** Catégories existantes de STD_CATEGORIES (noms exacts, lus par Finances et la 2044). */
export const QUALIFS = Object.freeze([
  { k: 'travaux', cat: 'Travaux (entretien, réparation, amélioration)', lbl: 'Entretien, réparation ou amélioration', detail: 'Ligne 224 de la déclaration 2044' },
  { k: 'energie', cat: 'Travaux de rénovation énergétique', lbl: 'Rénovation énergétique', detail: 'Ligne 224 bis' },
  { k: 'construction', cat: 'Travaux de construction / agrandissement (non déductible)', lbl: 'Construction, reconstruction, agrandissement', detail: 'Non déductible : hors 2044, compte dans la trésorerie' },
  { k: 'recup', cat: 'Charges récupérables (eau, énergie…)', lbl: 'Charge récupérable sur le locataire', detail: 'Entre dans la régularisation des charges (entretien d\'un équipement collectif)', seulementSiSuggere: true },
]);
/**
 * La suggestion : entretien / réparation ; « charge récupérable » pour l'entretien d'un chauffage collectif
 * avancé par le bailleur (R8). L'utilisateur la change librement (aide au classement, pas un conseil fiscal).
 */
export function qualificationSuggeree(verdict) { return (verdict && verdict.regle === 'R8' && verdict.payeur === PAYEURS.BAILLEUR) ? 'recup' : 'travaux'; }
