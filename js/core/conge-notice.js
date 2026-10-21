/**
 * core/conge-notice.js — F-4 : NOTICE D'INFORMATION jointe au congé pour reprise ou pour vente.
 *
 * Loi n° 89-462 du 6 juillet 1989, art. 15-I : « Une notice d'information relative aux obligations du
 * bailleur et aux voies de recours et d'indemnisation du locataire est jointe au congé délivré par le
 * bailleur en raison de sa décision de reprendre ou de vendre le logement. » Contenu fixé par l'arrêté du
 * 13 décembre 2017 (NOR : TERL1711455A, JORF n° 0296 du 20 décembre 2017), annexe modifiée par le décret
 * n° 2019-966 du 18 septembre 2019 (art. 8), en vigueur depuis le 1er janvier 2020.
 *
 * Décision Didier 17/10/2026 (« 4a oui ») : la notice est jointe AUTOMATIQUEMENT, texte officiel reproduit
 * mot pour mot, avec sa date de consultation.
 *
 * Champ (préambule de la notice) : locaux loués NON MEUBLÉS, résidence principale ; la notice « ne s'applique
 * pas, notamment, aux logements loués meublés (art. 25-3) ». Elle n'est donc jointe qu'au congé du bail NU
 * pour reprise ou pour vente — jamais au motif légitime et sérieux, jamais au meublé.
 *
 * VERBATIM : `NOTICE_CONGE_LIGNES` est le texte de l'annexe tel que Légifrance l'affiche (version en vigueur,
 * https://www.legifrance.gouv.fr/loda/id/JORFTEXT000036236664, consultée le 20/10/2026), découpé en lignes
 * (un paragraphe, un intitulé ou un tiret par ligne, espaces normalisés). Les coquilles du texte publié
 * (« 30 0000 € », adresses web espacées) sont CONSERVÉES : on ne corrige pas un texte officiel.
 * L'empreinte SHA-256 de `NOTICE_CONGE_LIGNES.join('\n')` relevée sur la page le jour de la consultation est
 * `NOTICE_CONGE_SHA256` ; le test __tests__/helpers/conge-notice.test.js la recalcule : toute retouche du texte
 * le fait échouer. Seule la ligne 2 de Légifrance (« loi n° 86-1290 du 23 décembre 1986 Préambule ») mêle la
 * fin du titre et la première entrée du sommaire (lien unique sur la page) : le rendu les sépare, sans
 * changer un mot.
 *
 * PUR (sans DB / DOM). Rendu HTML `.pro-doc` comme `art15IIProDoc` (js/core/conge.js), texte échappé.
 */

export const NOTICE_CONGE_SOURCE = {
  titre: "Arrêté du 13 décembre 2017 relatif au contenu de la notice d'information relative aux obligations du bailleur et aux voies de recours et d'indemnisation du locataire jointe au congé délivré par le bailleur en raison de sa décision de reprendre ou de vendre le logement",
  nor: 'TERL1711455A',
  jorf: 'JORF n° 0296 du 20 décembre 2017',
  modifie: 'annexe modifiée par le décret n° 2019-966 du 18 septembre 2019, art. 8 (en vigueur le 1er janvier 2020)',
  url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000036236664',
  consulteLe: '2026-10-20'
};

export const NOTICE_CONGE_SHA256 = '0881645528e0e18acc63ed5fa7a9d92100017f68d93feb93dde4662dff49e099';

export const NOTICE_CONGE_LIGNES = [
  "ANNEXE",
  "Notice d'information relative aux obligations du bailleur et aux voies de recours et d'indemnisation du locataire jointe au congé délivré par le bailleur en raison de sa décision de reprendre ou de vendre le logement prise en application de l'article 15 de la loi n° 89-462 du 6 juillet 1989 tendant à améliorer les rapports locatifs et portant modification de la",
  "loi n° 86-1290 du 23 décembre 1986 Préambule",
  "1-Dispositions communes au congé pour vendre et au congé pour reprise",
  "1-1-Forme de la notification",
  "1-2-Auteur du congé",
  "1-3-Destinataire du congé",
  "1-4-Délai de préavis",
  "1-5-Suspension de la possibilité de donner congé",
  "1-6-Locataires protégés",
  "1-6-1-Locataire âgé de plus de 65 ans",
  "1-6-2-Locataire âgé de moins de 65 ans",
  "1-6-3-Exceptions",
  "1-7-Effet sur le locataire",
  "2-Dispositions propres à chaque catégorie de congé",
  "2-1-Congé pour reprise du logement",
  "2-1-1-Auteur du congé",
  "2-1-2-Bénéficiaires de la reprise",
  "2-1-3-Destination du logement",
  "2-1-4-Cas particulier",
  "2-1-5-Mentions obligatoires",
  "2-2-Congé pour vendre le logement",
  "2-2-1-Auteur du congé",
  "2-2-2-Cas particulier",
  "2-2-3-Mentions obligatoires",
  "2-2-4-Offre de vente au locataire",
  "2-2-4-1-Durée de validité de l'offre de vente",
  "2-2-4-2-Conséquence d'un refus par le locataire de l'offre de vente",
  "2-2-4-3-Conséquences d'une acceptation par le locataire de l'offre de vente",
  "2-2-4-4-Modification du prix ou des conditions de vente",
  "2-2-5-Cas particulier d'un congé pour vente par lots",
  "2-2-5-1-Droits spécifiques du locataire",
  "2-2-5-2-Droit de préemption sans congé",
  "3-Les litiges relatifs aux congés",
  "3-1-Les litiges relatifs au congé pour reprise et au congé pour vendre",
  "3-2-Le règlement des litiges",
  "3-2-1-Le règlement amiable",
  "3-2-1-1-La commission départementale de conciliation",
  "3-2-1-2-Le conciliateur de justice",
  "3-2-2-Le règlement judiciaire",
  "3-2-2-1-Action en justice",
  "3-2-2-2-Saisine du juge par le locataire",
  "3-3-Les effets de la contestation de la validité d'un congé",
  "3-3-1-Les suites du règlement amiable des différends",
  "3-3-2-Les suites du règlement judiciaire d'un différend",
  "3-3-2-1-Les effets sur le locataire d'un congé déclaré nul",
  "3-3-2-2-Les effets sur le bailleur d'un congé déclaré nul",
  "4-Contacts utiles",
  "Préambule",
  "Le congé délivré par le bailleur est la notification de sa décision de mettre fin au contrat de location. Il prend effet à l'échéance du contrat de location.",
  "En application de l'article 15 de la loi n° 89-462 du 6 juillet 1989 tendant à améliorer les rapports locatifs, la présente notice d'information rappelle les obligations du bailleur ainsi que les voies de recours et d'indemnisation du locataire lors d'un congé délivré par le bailleur en raison de sa décision de reprendre pour y habiter ou y loger un proche ou de vendre le logement. Elle est obligatoirement jointe au congé délivré par le bailleur pour ces motifs.",
  "Elle s'applique aux locaux à usage d'habitation ou à usage mixte professionnel et d'habitation loués non meublés soumis à la loi du 6 juillet 1989 précitée et qui constituent la résidence principale du locataire (logement occupé au moins huit mois par an) (art. 2).",
  "Cette notice ne s'applique pas, notamment, aux logements loués meublés (art. 25-3), aux logements foyers, aux logements de fonction (art. 2), aux logements occupés par des travailleurs saisonniers (art. 2), aux logements faisant l'objet d'une convention d'aide personnalisée au logement (APL) (art. 40-III), aux logements appartenant aux organismes d'habitations à loyer modéré et ne faisant pas l'objet d'une convention passée en application de l'article L. 351-2 du code de la construction et de l'habitation (art. 40-I), aux logements faisant l'objet d'une convention conclue avec l'Agence nationale de l'habitat (ANAH) (art. 40) et aux logements dont les loyers sont fixés en application de la loi de 1948 (art. 40).",
  "1-Dispositions communes au congé pour vendre et au congé pour reprise",
  "1-1-Forme de la notification",
  "Le congé délivré par le bailleur doit être porté à la connaissance du locataire par lettre recommandée avec demande d'avis de réception, par acte d'huissier ou par remise en main propre contre récépissé ou émargement.",
  "1-2-Auteur du congé",
  "Le congé est délivré au locataire par le bailleur. Lorsque le bailleur est une personne morale, le signataire du congé doit être dûment habilité. S'il est délivré par l'intermédiaire d'un mandataire (par exemple une agence immobilière, un administrateur de biens ou un notaire) et non directement par le bailleur, le congé doit mentionner le nom ou la dénomination sociale du bailleur.",
  "1-3-Destinataire du congé",
  "Le congé doit être adressé à tous les signataires du bail.",
  "Les époux sont, de droit, cotitulaires du bail (art. 1751 du code civil), même si un seul des époux est signataire du bail. Si le bailleur a été informé du mariage, il doit délivrer congé à chacun des deux époux.",
  "Les partenaires liés par un pacte civil de solidarité (Pacs) sont cotitulaires du bail si les noms des deux partenaires figurent dans le bail ou s'ils en font la demande conjointement (art. 1751 du code civil). Dans ce cas, le bailleur doit délivrer congé aux deux partenaires.",
  "Si le bailleur n'a pas été informé du mariage ou du Pacs, le congé délivré est opposable au conjoint ou au partenaire lié par un Pacs (art. 9-1).",
  "Le bailleur n'est pas tenu de notifier le congé au concubin du locataire, si celui-ci n'est pas signataire du bail.",
  "1-4-Délai de préavis",
  "Pour que le congé soit régulier, un délai de six mois au moins doit s'être écoulé entre la date de notification du congé au locataire et le terme du contrat de location. A défaut, le contrat de location sera reconduit tacitement. Le terme du bail s'apprécie en fonction de la date d'effet du contrat de location.",
  "Le point de départ du délai de préavis est la notification du congé :",
  "-lorsque le congé est délivré par acte d'huissier, le délai court à compter du jour de la signification de l'acte d'huissier au locataire ;",
  "-lorsque le congé est délivré par lettre recommandée avec demande d'avis de réception, le délai court à compter du jour de la réception de la lettre recommandée par le locataire, c'est-à-dire à partir de la remise effective de la lettre à son destinataire ;",
  "-lorsque le congé est remis en main propre, le délai court à compter de la date de cette remise contre récépissé ou émargement.",
  "Lorsqu'un délai est exprimé en mois, il expire le jour du dernier mois qui porte le même quantième que le jour de l'acte. A défaut, le délai expire le dernier jour du mois (art. 641 du code de procédure civile).",
  "Exemples :",
  "Si le contrat de location arrive à terme le 15 juin, la lettre de congé doit être notifiée au locataire au plus tard le 15 décembre de l'année précédente.",
  "Si le contrat de location arrive à terme le 30 juin, la lettre de congé doit être notifiée au locataire au plus tard le 31 décembre de l'année précédente. De même, si le contrat de location expire le 31 août, la lettre de congé doit être notifiée au plus tard le 28 février (ou 29 pour les années bissextiles), il s'agit bien du dernier jour du mois.",
  "Les jours fériés et les week-ends sont inclus dans ce calcul : si le délai de préavis s'achève un dimanche, il finit ce jour-là et non le vendredi précédent ou le lundi suivant. Si le congé est donné de manière anticipée bien avant le délai de six mois, il est valable, et prendra effet à la date à laquelle il aurait dû être donné. Ainsi, pour un contrat de location dont l'échéance arrive au 20 septembre, un congé délivré le 13 mars est valable ; en revanche, le délai de préavis ne commence à courir qu'à compter du 20 mars.",
  "1-5-Suspension de la possibilité de donner congé",
  "Lorsque le bâtiment où se situe le logement fait l'objet d'une procédure d'insalubrité ou de péril, le bailleur ne peut pas délivrer de congé au locataire tant que cette procédure n'a pas été abandonnée ou annulée par un tribunal.",
  "1-6-Locataires protégés",
  "1-6-1-Locataire âgé de plus de 65 ans",
  "Le bailleur ne peut délivrer congé à un locataire âgé de plus de 65 ans (1) et dont les ressources annuelles (2), à la date de notification du congé, sont inférieures au plafond de ressources en vigueur pour l'attribution des logements locatifs conventionnés fixé par arrêté du ministre chargé du logement (3).",
  "1-6-2-Locataire âgé de moins de 65 ans",
  "Le bailleur ne peut délivrer congé à un locataire ayant à sa charge une personne de plus de 65 ans (1) vivant habituellement dans le logement lorsque ce dernier remplit la condition de ressources évoquée au point 1-6-1 et lorsque le montant cumulé des ressources annuelles (2) de l'ensemble des personnes vivant au foyer est, à la date de notification du congé, inférieur au plafond de ressources en vigueur pour l'attribution des logements locatifs conventionnés fixé par arrêté du ministre chargé du logement (3).",
  "1-6-3-Exceptions",
  "Le locataire remplissant les conditions exposées aux 1-6-1 et 1-6-2 peut toutefois se voir délivrer un congé si le bailleur :",
  "-est âgé de plus de 65 ans (1) ;",
  "-ou si ses ressources annuelles (2) sont inférieures au plafond de ressources en vigueur pour l'attribution des logements locatifs conventionnés fixé par arrêté du ministre chargé du logement (3) ;",
  "-ou propose, pendant la période de préavis, une solution de relogement correspondant aux besoins et aux possibilités du locataire, dans les limites géographiques suivantes :",
  "-si la commune est divisée en arrondissements : dans le même arrondissement, les arrondissements limitrophes ou dans les communes limitrophes de l'arrondissement ;",
  "-si la commune est divisée en cantons : dans le même canton, ou dans les cantons limitrophes de ce canton inclus dans la même commune ou dans les communes limitrophes de ce canton si la commune est divisée en cantons ;",
  "-dans les autres cas : sur le territoire de la même commune ou d'une commune limitrophe, dans un rayon de 5 kilomètres (art. 13 bis de la loi n° 48-1360 du 1er septembre 1948).",
  "1-7-Effet sur le locataire",
  "Le locataire qui a reçu un congé pour vendre ou pour reprise doit quitter les lieux, au plus tard, le dernier jour du préavis.",
  "Il peut cependant quitter les lieux quand il le souhaite pendant la durée du préavis, il n'est alors redevable du loyer et des charges que jusqu'à la date de remise des clés.",
  "Il est alors conseillé d'informer le bailleur de son départ dans un délai raisonnable afin de fixer une date pour l'établissement de l'état des lieux de sortie.",
  "2-Dispositions propres à chaque catégorie de congé",
  "2-1-Congé pour reprise du logement",
  "2-1-1-Auteur du congé",
  "L'auteur du congé peut être :",
  "-le bailleur, personne physique ;",
  "-le bailleur, société civile immobilière de famille constituée exclusivement entre parents et alliés jusqu'au quatrième degré inclus ;",
  "-tout membre de l'indivision, lorsque le logement est en indivision, sous réserve de l'accord requis des co-indivisaires.",
  "2-1-2-Bénéficiaires de la reprise",
  "-le conjoint du bailleur personne physique, le partenaire auquel il est lié par un pacte civil de solidarité enregistré à la date du congé, son concubin notoire depuis au moins un an à la date du congé, ses ascendants, ses descendants ou ceux de son conjoint, de son partenaire ou de son concubin notoire ;",
  "-l'un des associés d'une société civile immobilière (qui peuvent être enfants, parents, petits-enfants, grands-parents, arrière-petits-enfants, arrière-grands-parents, frères, sœurs, neveux, nièces, oncles, tantes, petits-neveux, petites-nièces, grands-oncles, grandes-tantes et cousins germains) ;",
  "-lorsque le logement est en indivision, tout membre de l'indivision peut le reprendre afin d'y habiter ou d'y faire habiter son conjoint, le partenaire auquel il est lié par un pacte civil de solidarité enregistré à la date du congé, son concubin notoire depuis au moins un an à la date du congé, ses ascendants, ses descendants ou ceux de son conjoint, de son partenaire ou de son concubin notoire.",
  "2-1-3-Destination du logement",
  "Lorsque le congé est motivé par une reprise du logement, celui-ci devra être occupé par le bénéficiaire de la reprise et à titre de résidence principale.",
  "2-1-4-Cas particulier",
  "En principe, le congé pour reprise prend effet au terme du bail. Toutefois, lorsque le logement occupé par le locataire change de propriétaire en cours de bail, et que le terme du bail intervient moins de deux ans après l'acquisition du logement, le congé pour reprise donné par le bailleur ne prendra effet qu'à l'expiration d'une durée de deux ans à compter de la date d'acquisition.",
  "Exemple : si un logement est acquis le 15 juin 2016 et que le terme du bail intervient le 20 juillet 2017, le bailleur doit nécessairement donner congé six mois avant le terme du bail, soit le 20 janvier 2017. Ce congé, tout en devant respecter le préavis de six mois, ne prendra effet qu'au 15 juin 2018 afin que la durée d'occupation de deux ans soit respectée.",
  "2-1-5-Mentions obligatoires",
  "La notification du congé pour reprise doit comporter plusieurs mentions spécifiques :",
  "-la mention que le bailleur entend reprendre le logement pour l'habiter ou pour y loger l'un de ses proches ;",
  "-les nom et adresse du bénéficiaire de la reprise ;",
  "-la nature du lien de parenté qui existe entre le bénéficiaire et le bailleur ;",
  "-une mention justifiant du caractère réel et sérieux de la décision de reprise ;",
  "-dans le cas où le bailleur est une société civile immobilière familiale, le congé doit indiquer le nom et l'adresse de l'associé bénéficiaire de la reprise.",
  "2-2-Congé pour vendre le logement",
  "2-2-1-Auteur du congé",
  "Le congé pour vendre peut être délivré par un bailleur personne physique ou par un bailleur personne morale.",
  "2-2-2-Cas particulier",
  "En principe, le congé pour vendre prend effet au terme du bail. Toutefois, lorsque le logement occupé par le locataire change de propriétaire en cours de bail et que le terme du bail intervient moins de trois ans après l'acquisition du logement par le nouveau propriétaire, le congé pour vendre ne pourra être délivré par le bailleur qu'au terme de la première reconduction tacite ou du premier renouvellement du contrat de location en cours, dans le respect du délai de préavis.",
  "Exemple : pour un contrat de location arrivant à échéance le 31 mai 2017, lorsque le logement a changé de propriétaire le 1er mars 2015, le congé pour vendre pourra être notifié, si le bailleur est une personne physique, au plus tard le 30 novembre 2019, soit six mois avant le terme de la première reconduction, qui intervient le 31 mai 2020.",
  "2-2-3-Mentions obligatoires",
  "La notification du congé pour vendre doit comporter plusieurs mentions spécifiques :",
  "-la mention que le bailleur entend reprendre le logement pour le vendre ;",
  "-le congé doit indiquer le prix et les conditions de la vente envisagée des seuls locaux et éventuelles dépendances loués. A cet effet, le congé reprend la désignation des locaux loués figurant au bail ;",
  "-le congé doit décrire avec exactitude les locaux loués et quelles sont leurs dépendances éventuelles. En revanche, il n'est pas obligatoire que la superficie du logement soit mentionnée dans le congé ;",
  "-la notification du congé doit reproduire les cinq premiers alinéas du II de l'article 15 de la loi du 6 juillet 1989 précitée, lesquels indiquent quelles sont les conditions de l'offre de vente au profit du locataire.",
  "2-2-4-Offre de vente au locataire",
  "Dans le cas d'un congé pour vendre, la loi donne au locataire du logement mis en vente un droit de préemption : le locataire a priorité sur tout autre acquéreur potentiel du logement pour en faire l'acquisition à sa place et dans les mêmes conditions.",
  "En cas de pluralité de locataires, chacun d'eux bénéficie du droit de préemption.",
  "A noter que le locataire ne bénéficie pas d'un droit de préemption lorsque la vente se fait au profit d'un proche parent du bailleur, c'est-à-dire d'un parent jusqu'au troisième degré inclus (4), ou lorsque le logement qu'il occupe est inhabitable, notamment en cas d'arrêté de péril ou d'insalubrité.",
  "Le congé en lui-même constitue une offre de vente au profit du locataire.",
  "2-2-4-1-Durée de validité de l'offre de vente",
  "Le congé, en tant qu'offre de vente, ouvre au locataire un délai de deux mois pour l'accepter. Elle doit être maintenue pendant toute la durée de ce délai. La contestation éventuelle du congé par le locataire n'a pas pour effet de prolonger ce délai d'acceptation de l'offre de vente.",
  "2-2-4-2-Conséquence d'un refus par le locataire de l'offre de vente",
  "Si le locataire n'accepte pas l'offre de vente du logement, garde le silence ou émet une contre-proposition non acceptée par le bailleur, il doit quitter les lieux au plus tard le dernier jour du préavis.",
  "2-2-4-3-Conséquences d'une acceptation par le locataire de l'offre de vente",
  "Si le locataire accepte l'offre de vente du logement dans le délai fixé, toute éventuelle promesse de vente signée par le bailleur et un autre acquéreur est nulle.",
  "2-2-4-4-Modification du prix ou des conditions de vente",
  "Le prix indiqué dans le congé est laissé à la discrétion du propriétaire. Le prix doit être ferme. En l'absence d'intermédiaire, le prix ne comporte aucun honoraire de négociation.",
  "Si le propriétaire décide de vendre à un tiers à des conditions ou à un prix plus avantageux que ceux prévus dans l'offre de vente initiale, ce prix ou ces conditions doivent être notifiés au locataire par le bailleur ou par le notaire si le bailleur ne s'en est pas chargé. Si cette notification n'est pas faite, la vente consentie est nulle. Cette notification doit reproduire les termes des cinq alinéas de l'article 15-II de la loi du 6 juillet 1989 précitée.",
  "Si le locataire a communiqué au bailleur sa nouvelle adresse, la notification sera faite à cette adresse. S'il ne la fournit pas, la notification est faite à l'adresse du logement mis en vente.",
  "Cette notification constitue une nouvelle offre de vente au profit du locataire. Pour accepter cette offre, le locataire dispose d'une période d'un mois à compter de sa réception.",
  "S'il accepte cette nouvelle offre de vente, le locataire dispose d'un délai de deux mois à compter de la date d'envoi de sa réponse pour signer l'acte de vente. S'il fait part de son intention de recourir à un prêt bancaire, l'acceptation par le locataire de l'offre de vente est subordonnée à l'obtention du prêt et le délai de réalisation de la vente est porté à quatre mois.",
  "2-2-5-Cas particulier d'un congé pour vente par lots",
  "La vente par lots désigne la première vente, appartement par appartement, des lots issus de la division ou de la subdivision d'un immeuble.",
  "2-2-5-1-Droits spécifiques du locataire",
  "Dans le cas où un congé a été délivré en vue de la vente de plus de cinq logements situés dans le même immeuble et où le bailleur est une personne morale (autre qu'un organisme d'habitations à loyer modéré, qu'un bailleur personne physique ou qu'une société civile immobilière constituée exclusivement entre parents et alliés jusqu'au quatrième degré inclus), alors le locataire bénéficie d'un droit spécifique au maintien dans les lieux.",
  "En effet, le bail peut être expressément reconduit pour une durée inférieure à six ans. Si le congé intervient moins de deux ans avant le terme du contrat de location, le locataire obtient de droit, à sa demande, que son bail soit reconduit de manière à ce qu'il puisse disposer du logement pendant deux ans à compter de la notification du congé.",
  "Cette reconduction est établie entre les parties au plus tard 4 mois avant l'expiration du bail en cours. A l'expiration de la durée fixée par les parties pour le bail reconduit, celui-ci est résilié de plein droit.",
  "2-2-5-2-Droit de préemption sans congé",
  "Les règles relatives au congé pour vendre sont applicables seulement dans le cas où le bailleur décide de vendre le logement libre de tout occupant. Dans ce cas, les locataires bénéficient d'un droit de préemption pour acquérir le logement qu'ils occupent (article 10 de la loi n° 75-1351 du 31 décembre 1975) et l'offre de vente notifiée au profit du locataire ne vaut pas congé.",
  "Le bailleur peut cependant décider de vendre le logement occupé. Dans ce cas, il ne délivre pas de congé au locataire qui ne bénéficie alors pas du droit de préemption accessoire au congé pour vendre.",
  "3-Les litiges relatifs aux congés",
  "Différents litiges peuvent naître de la décision du propriétaire de mettre un terme au contrat de location. Le règlement de ces conflits peut se faire de manière amiable ou judiciaire.",
  "3-1-Les litiges relatifs au congé pour reprise et au congé pour vendre",
  "Le congé peut être contesté pour les motifs suivants (5) :",
  "-défaut des mentions obligatoires du congé : comme l'absence d'indication du motif du congé (6) ;",
  "-l'auteur du congé n'est pas habilité pour délivrer le congé ;",
  "-contestation du destinataire du congé : par exemple, lorsque les époux sont locataires, en raison de la cotitularité du bail, le congé doit être délivré à chacun d'entre eux. Cependant, le congé n'est pas nul mais privé de toute efficacité puisque inopposable à l'époux à qui il n'a pas été adressé ;",
  "-contestation de la forme de la notification : par exemple, le congé adressé par lettre simple ne peut être considéré comme un congé ;",
  "-contestation du délai de préavis du congé : lorsque le délai de préavis ne respecte pas le délai de six mois au moins avant la date d'expiration du bail ;",
  "-le non-respect des règles sur les locataires protégés ;",
  "-défaut de notification en cas de proposition de vente à des conditions ou à un prix plus avantageux.",
  "3-2-Le règlement des litiges",
  "En cas de conflit relatif au congé délivré au locataire par le bailleur, les parties peuvent tenter de trouver une solution amiable, entre elles ou avec l'aide de la commission départementale de conciliation ou du conciliateur de justice. En cas d'échec, le tribunal compétent peut être saisi pour trancher le litige.",
  "La durée au-delà de laquelle une action en justice n'est plus recevable est en principe de trois ans à compter du jour où le titulaire d'un droit a connu ou aurait dû connaître les faits lui permettant d'exercer ce droit. Si une conciliation amiable est initiée, elle doit s'inscrire dans ce délai.",
  "3-2-1-Le règlement amiable",
  "Lorsqu'il existe un litige, il est conseillé d'adresser un courrier recommandé avec accusé de réception à l'autre partie, relatant les faits le plus précisément possible. Ce courrier constitue une première étape importante, si le litige n'est pas résolu à l'amiable, pour engager un recours éventuel devant le juge.",
  "Si aucun accord n'est trouvé entre les parties elles-mêmes, la saisine de la commission départementale de conciliation (CDC) ou du conciliateur de justice peut être envisagée.",
  "3-2-1-1-La commission départementale de conciliation",
  "Présente dans chaque département, la CDC est composée de représentants d'organisations de bailleurs et d'organisations de locataires, en nombre égal ; elle a pour rôle de concilier les parties, afin d'éviter le recours au juge.",
  "La CDC peut être saisie par le bailleur ou le locataire concerné, lorsqu'il s'agit d'un litige de nature individuelle. Lorsqu'un locataire a avec son bailleur un litige locatif ou lorsque plusieurs locataires ont avec un même bailleur un litige de même origine, ils peuvent se faire représenter en justice par une association siégeant à la Commission nationale de concertation.",
  "La saisine de la commission, qui est facultative et gratuite, doit être formulée et adressée par lettre recommandée avec avis de réception ou par voie électronique au secrétariat de la commission. La saisine doit indiquer les nom, qualité et adresse du demandeur, ceux du défendeur ainsi que l'objet du litige ou de la difficulté. Dans tous les cas, il est utile que la lettre de saisine soit accompagnée de la copie des pièces en lien avec le litige (le bail, la notification du congé, etc.).",
  "Lors de la séance de conciliation, les parties peuvent se faire assister par une personne de leur choix ou se faire représenter par une personne dûment mandatée.",
  "Si un accord intervient, les termes de la conciliation font l'objet d'un document signé par chacune des parties. Si aucun accord n'est trouvé, la CDC rend un avis comportant l'exposé du litige, la position des parties ainsi que, le cas échéant, celle de la commission. Dans le cas d'une action en justice, cet avis pourra ensuite être transmis au juge par l'une ou l'autre des parties.",
  "3-2-1-2-Le conciliateur de justice",
  "Le recours à un conciliateur de justice, en dehors de toute saisine d'une juridiction, constitue un mode alternatif de règlement des conflits qui permet de trouver une issue amiable à un désaccord notamment entre un bailleur et un locataire (art. 1536 et suivants du code de procédure civile). La saisine du conciliateur de justice est gratuite. Il convient de contacter par courrier, par téléphone ou de se rendre à la permanence du conciliateur dont les coordonnées se trouvent sur le site :",
  "https :// www. conciliateurs. fr/ Trouver-une-permanence.",
  "Le conciliateur réunit les parties, qui peuvent être accompagnées d'une personne de leur choix.",
  "Si un accord est trouvé, le conciliateur peut établir un constat d'accord signé par les parties et le conciliateur actant leurs engagements. En cas d'échec de la conciliation, les parties peuvent faire régler le litige par le tribunal compétent.",
  "3-2-2-Le règlement judiciaire",
  "3-2-2-1-Action en justice",
  "Si le bailleur n'a pas respecté ses obligations en matière de délivrance du congé, le locataire peut exercer une action en justice auprès du tribunal judiciaire dans le ressort duquel se situe le logement, sans que le recours à un avocat ne soit obligatoire.",
  "Le locataire peut contester un congé pour reprise alors même qu'il a déjà quitté le logement.",
  "3-2-2-2-Saisine du juge par le locataire",
  "En cas de litige relatif au congé délivré par le bailleur, le locataire peut saisir le juge de deux façons : l'assignation ou la déclaration au greffe.",
  "L'assignation, utilisée quel que soit le montant du litige, est un acte qui permet de saisir le tribunal mais qui nécessite l'intervention d'un huissier de justice. Un acte est établi et délivré par l'huissier de justice, par lequel le demandeur prévient la partie adverse qu'une procédure judiciaire est intentée contre lui.",
  "La déclaration au greffe du tribunal est un mode simplifié de saisine du tribunal ne pouvant être utilisé que lorsque le litige porte sur un montant inférieur ou égal à 4 000 €.",
  "Dans l'hypothèse d'une procédure initiée par déclaration au greffe, la justification d'une tentative de conciliation préalable par le conciliateur de justice est une condition de recevabilité de la saisine du tribunal et apparaît donc obligatoire (art. 4 de loi n° 2016-1547 du 18 novembre 2016 de modernisation de la justice du XXIe siècle).",
  "Toutefois, l'obligation de tentative de conciliation préalable auprès du conciliateur de justice n'est pas systématiquement nécessaire.",
  "En effet, trois exceptions à cette nouvelle obligation ont été prévues :",
  "Outre l'hypothèse dans laquelle les parties sont déjà parvenues à un accord qu'elles souhaitent simplement faire homologuer par le juge, les parties sont dispensées de l'obligation de justification d'une tentative de conciliation lorsqu'elles démontrent avoir déjà tenté de trouver une solution amiable à leur litige par une autre voie que la conciliation ou en cas de motif légitime. Il appartiendra alors au juge saisi du litige d'apprécier si la tentative de conciliation par la commission départementale de conciliation est une tentative de résolution amiable du litige permettant de considérer que la condition de recevabilité de la saisine du tribunal est remplie.",
  "3-3-Les effets de la contestation de la validité d'un congé",
  "La contestation du congé par le locataire peut se faire lorsqu'il est ou non dans le logement. A l'amiable ou devant le juge, la résolution du différend a des conséquences variables suivant que le locataire a ou non quitté le logement et suivant la nature de l'irrégularité du congé.",
  "3-3-1-Les suites du règlement amiable des différends",
  "Lorsque les parties trouvent une solution à l'amiable, ce sont les termes de l'accord qui s'appliquent.",
  "En cas d'échec, les parties peuvent toujours faire régler le litige par le tribunal.",
  "3-3-2-Les suites du règlement judiciaire d'un différend",
  "Lorsque le juge est saisi d'un litige relatif à la validité du congé, il peut déclarer la nullité du congé.",
  "En effet, s'agissant des irrégularités relatives aux conditions de forme et de délai, le juge déclare, de manière générale, la nullité du congé. Dans les autres cas, notamment l'absence des mentions obligatoires inscrites dans chaque congé, le juge apprécie au cas par cas. La jurisprudence considère, en effet, que l'irrégularité seule n'est pas de nature à justifier la nullité et exige parfois que l'irrégularité cause un grief au locataire.",
  "3-3-2-1-Les effets sur le locataire d'un congé déclaré nul",
  "Si le congé est déclaré nul, les effets sur le locataire varient suivant qu'il a quitté ou non le logement :",
  "-lorsque le locataire est encore dans les lieux au moment de la nullité du congé, il peut éviter la déchéance de son titre locatif et bénéficier de la reconduction tacite de son bail ;",
  "-lorsque le locataire a quitté le logement au moment où le congé est déclaré nul, les juges tendent à refuser la réintégration du locataire et à octroyer de préférence des dommages-intérêts pour compenser le préjudice causé (par exemple pour compenser les frais et perturbations diverses causés par le déménagement, pour compenser les difficultés à trouver un logement équivalent ou un nouveau loyer plus élevé).",
  "3-3-2-2-Les effets sur le bailleur d'un congé déclaré nul",
  "Si le congé est déclaré nul alors que le locataire est encore dans le logement, le bail est reconduit. Le bailleur doit donc attendre la prochaine échéance pour délivrer un nouveau congé.",
  "Par ailleurs, en cas de congé frauduleux, une sanction pénale est encourue par le bailleur. La peine encourue est une amende pouvant aller jusqu'à 6 000 €, s'il s'agit d'une personne physique, et à 30 0000 €, s'il s'agit d'une personne morale.",
  "4-Contacts utiles",
  "-Les ADIL : les agences départementales d'information sur le logement apportent au public un conseil gratuit, neutre et personnalisé sur toutes les questions juridiques, financières et fiscales relatives au logement et leur proposent des solutions adaptées à leur cas personnel. Les ADIL assurent ainsi de nombreuses permanences sur l'ensemble du territoire : http :// www. anil. org/ votre-adil.",
  "-Les associations représentatives des bailleurs et des locataires.",
  "Au plan local, il existe de nombreuses organisations ayant pour objet de représenter et de défendre l'intérêt des locataires ou des bailleurs.",
  "Au niveau national, les organisations représentatives des locataires et des bailleurs sont celles siégeant à ce titre à la Commission nationale de concertation :",
  "-organisations nationales représentatives des bailleurs :",
  "-l'Union nationale de la propriété immobilière (UNPI) ;",
  "-l'Association des propriétaires de logements intermédiaires (APLI) ;",
  "-la Fédération des sociétés immobilières et foncières (FSIF) ;",
  "-organisations nationales représentatives des locataires :",
  "-la Confédération nationale du logement (CNL) ;",
  "-la Confédération générale du logement (CGL) ;",
  "-la Confédération syndicale des familles (CSF) ;",
  "-la Confédération de la consommation, du logement et du cadre de vie (CLCV) ;",
  "-l'Association Force ouvrière consommateurs (AFOC).",
  "-Maisons de justice et du droit et point d'accès au droit : les maisons de justice et du droit et les points d'accès au droit accueillent gratuitement et anonymement les personnes rencontrant un problème juridique et/ ou administratif.",
  "Le site http :// www. annuaires. justice. gouv. fr vous permet de connaître, à partir de votre code postal, le point d'accès au droit ou la maison de justice et du droit le plus proche de votre domicile.",
  "Information administrative :",
  "Ministère de la cohésion des territoires : http :// www. cohesion-territoires. gouv. fr ;",
  "Site officiel de l'administration française : http :// www. service-public. fr ;",
  "Numéro unique de renseignement des usagers Allo Service Public : 3939 (coût : 0,15 € la minute en moyenne).",
  "(1) Age apprécié à la date d'échéance du contrat.",
  "(2) Le montant de ressources retenu est celui qui est déclaré à l'administration fiscale avant tout abattement ou déduction",
  "(3) Arrêté du 29 juillet 1987 modifié relatif aux plafonds de ressources des bénéficiaires de la législation sur les habitations à loyer modéré et des nouvelles aides de l'Etat en secteur locatif.",
  "(4) Exemples : enfants, parents, petits-enfants, grands-parents, frères, sœurs, neveux, nièces, oncles, tantes.",
  "(5) Cette liste n'est pas exhaustive.",
  "(6) Congé pour reprise, voir § 2-1-5 ; congé pour vendre, voir § 2-2-3."
];

/**
 * La notice est-elle à joindre ? Bail NU (art. 15) + congé pour REPRISE ou pour VENTE, seulement.
 * Motif légitime et sérieux, bail meublé (art. 25-8), étudiant, mobilité, garage : non (préambule de la notice).
 * @param {{typeBail?:string, motif?:string}} o
 */
export function noticeCongeRequise(o) {
  o = o || {};
  const t = String(o.typeBail || 'nu');
  const m = String(o.motif || '');
  return t === 'nu' && (m === 'reprise' || m === 'vente');
}

function esc(x) {
  return String(x == null ? '' : x)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Intitulé numéroté (« 2-2-4-1-Durée… ») : profondeur = nombre de niveaux.
const _TITRE = /^(\d+(?:-\d+)*)-(\S.*)$/;
const _date = (iso) => { const p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso || ''); };

/**
 * La notice en HTML `.pro-doc` (annexe du congé, page à part). Le texte n'est jamais réécrit : chaque ligne
 * officielle devient un intitulé, un tiret ou un paragraphe ; le sommaire officiel est rendu tel quel.
 */
export function noticeCongeProDoc() {
  const L = NOTICE_CONGE_LIGNES;
  const iPre = L.indexOf('Préambule');   // début du corps (après le sommaire)
  // Lignes 1-2 de Légifrance : fin du titre + 1re entrée du sommaire, dans un même lien.
  const finTitre = L[2].replace(/ Préambule$/, '');
  const titre = L[1] + ' ' + finTitre;
  const sommaire = ['Préambule'].concat(L.slice(3, iPre));
  const corps = L.slice(iPre);
  const ligne = (s) => {
    const t = _TITRE.exec(s);
    if (s === 'Préambule' || t) {
      const prof = t ? t[1].split('-').length : 1;
      const tag = prof <= 1 ? 'h4' : 'h5';
      return '<' + tag + ' style="margin:10px 0 4px;font-size:' + (prof <= 1 ? '10pt' : '9.5pt') + '">' + esc(s) + '</' + tag + '>';
    }
    if (s.charAt(0) === '-') return '<p style="font-size:9pt;margin:2px 0 2px 14px">' + esc(s) + '</p>';
    if (/^\(\d\)/.test(s)) return '<p style="font-size:8pt;margin:2px 0;color:#3c4658">' + esc(s) + '</p>';
    return '<p style="font-size:9pt;margin:4px 0">' + esc(s) + '</p>';
  };
  const S = NOTICE_CONGE_SOURCE;
  return '<h3>Annexe — Notice d\'information jointe au congé (article 15-I de la loi n° 89-462 du 6 juillet 1989)</h3>'
    + '<p style="font-size:8pt;color:#3c4658">' + esc(S.titre) + ' — NOR : ' + esc(S.nor) + ' — ' + esc(S.jorf) + ' ; '
    + esc(S.modifie) + '. Texte officiel reproduit mot pour mot depuis Légifrance (' + esc(S.url) + '), version en vigueur consultée le '
    + esc(_date(S.consulteLe)) + '.</p>'
    + '<p style="font-size:9pt;font-weight:600;margin-top:8px">' + esc(L[0]) + '</p>'
    + '<p style="font-size:9.5pt;font-weight:600">' + esc(titre) + '</p>'
    + '<div style="font-size:8.5pt;color:#3c4658;margin:6px 0 10px">' + sommaire.map(esc).join('<br>') + '</div>'
    + corps.map(ligne).join('');
}
