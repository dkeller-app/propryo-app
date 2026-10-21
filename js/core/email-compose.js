/**
 * core/email-compose.js — Infrastructure commune de proposition de mails sortants
 *
 * EMAIL-AUTO V1 (mode "proposition" — pas d'envoi backend).
 * Génère un brouillon de mail à partir d'un type + contexte, retournant
 * un objet {to, cc, subject, body, attachments, legalNote} prêt à être
 * consommé par js/components/email-modal.js (mailto:, clipboard, share).
 *
 * Pattern : helpers purs (pas de dépendance DB / DOM), exposés via window
 * pour les onclick inline d'index-test.html (cf. js/main.js pattern shadow).
 *
 * 10 types supportés V1 :
 *   quittance, avis-echeance, rappel-impaye-1, rappel-impaye-2, rappel-impaye-3,
 *   irl-revision, mrh-renouvellement, bail-signe-final, convocation-edl-sortie,
 *   decompte-regul-annuel.
 *
 * Mode V2 SaaS (envoi auto via SendGrid/Postmark) — hors scope V1.
 */

// `appDbFrom` : le lecteur du DB VIVANT (getter `window.__immoGetDB`, repli sur le miroir
// `window.DB`) — jamais `window.DB` nu, qui est absent en session locale et périmé après
// réassignation de `DB`.
import { escHtml, appDbFrom } from './utils.js';

// ────────────────────────────────────────────────────────────────────────────
// Templates inline (V1) — un par type. Variables interpolées : {{path.to.value}}
// ────────────────────────────────────────────────────────────────────────────

const TEMPLATES = {
  // ─── Quittance mensuelle ────────────────────────────────────────────────
  quittance: {
    subject: 'Quittance de loyer {{quittance.mois}} — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Vous trouverez ci-joint la quittance de loyer pour le mois de {{quittance.mois}} relatif au logement situé {{bail.adrBien}}.

Détail :
- Loyer hors charges : {{quittance.hc}} €
- Provisions sur charges : {{quittance.ch}} €
- Total perçu : {{quittance.total}} €

Pour toute question, n'hésitez pas à revenir vers nous.

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [
      { name: 'Quittance-{{quittance.mois}}-{{logement.ref}}.pdf', type: 'pdf' }
    ],
    legalNote: ''
  },

  // ─── Avis d'échéance (J-5 avant paiement) ──────────────────────────────
  'avis-echeance': {
    subject: 'Avis d\'échéance — Loyer {{periode}} — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Nous vous rappelons que votre loyer pour la période {{periode}} sera prélevé / à régler le {{dateEcheance}}.

Détail :
- Loyer hors charges : {{bail.hc}} €
- Provisions sur charges : {{bail.ch}} €
- Total dû : {{montant}} €

Coordonnées de paiement :
- IBAN : {{entite.iban}}
- BIC : {{entite.bic}}
- Référence à indiquer : Loyer {{periode}} {{logement.ref}}

Merci de bien vouloir effectuer ce règlement dans les délais.

Cordialement,
{{entite.gerant}}`,
    attachments: [],
    legalNote: ''
  },

  // ─── Rappel impayé n°1 (amical, J+5) ───────────────────────────────────
  'rappel-impaye-1': {
    subject: 'Rappel — Loyer {{periode}} non perçu',
    body: `Bonjour {{locataire.civNom}},

Sauf erreur ou règlement en cours de validation, nous n'avons pas réceptionné votre loyer pour la période {{periode}} (montant dû : {{montant}} €).

Il s'agit peut-être d'un simple oubli. Merci de régulariser dans les meilleurs délais ou de nous communiquer la date de paiement prévue.

Si le règlement a déjà été effectué, merci d'ignorer ce message.

Coordonnées de paiement :
- IBAN : {{entite.iban}}
- Référence : Loyer {{periode}} {{logement.ref}}

Cordialement,
{{entite.gerant}}`,
    attachments: [],
    legalNote: ''
  },

  // ─── Rappel impayé n°2 (ferme, J+15) ───────────────────────────────────
  'rappel-impaye-2': {
    subject: 'Relance — Loyer impayé {{periode}} — {{bail.adrBien}}',
    body: `{{locataire.civNom}},

Malgré notre précédent rappel, votre loyer pour la période {{periode}} (montant : {{montant}} €) demeure impayé à ce jour.

Cette situation ne peut perdurer. Nous vous demandons de régulariser sous 15 jours à compter de la réception de ce message.

À défaut de paiement ou de proposition d'échelonnement de votre part, nous serons contraints d'engager la procédure prévue à l'article 24 de la loi n° 89-462 du 6 juillet 1989 (mise en demeure par lettre recommandée, commandement de payer par huissier, puis assignation devant le tribunal).

Nous restons à votre disposition pour étudier toute solution amiable (étalement, plan de paiement).

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [],
    legalNote: 'Conserver une trace écrite (mail + accusé lecture). Avant LRAR, proposer une dernière fois un règlement amiable.'
  },

  // ─── Rappel impayé n°3 (mise en demeure, J+30) ─────────────────────────
  'rappel-impaye-3': {
    subject: 'MISE EN DEMEURE — Loyer impayé {{periode}} — {{bail.adrBien}}',
    body: `Lettre recommandée avec accusé de réception
(et copie par email)

{{locataire.civNom}}
{{bail.adrBien}}

Objet : Mise en demeure de payer — Loyer {{periode}}

{{locataire.civNom}},

{{phraseRelances}} votre loyer de la période {{periode}} d'un montant de {{montant}} € reste à ce jour impayé.

Par la présente, nous vous mettons en demeure de procéder au règlement intégral de la somme due dans un délai de huit (8) jours à compter de la réception de cette lettre.

À défaut de règlement dans ce délai, nous serons contraints :
1. de faire signifier par huissier de justice un commandement de payer visant la clause résolutoire du bail (art. 24 loi n° 89-462 du 6/7/1989),
2. puis, le cas échéant, de saisir le tribunal judiciaire en vue de la résiliation du bail et de votre expulsion.

Nous restons disposés à étudier toute proposition de règlement amiable ou de plan d'apurement de la dette.

Veuillez agréer, {{locataire.civNom}}, l'expression de nos salutations distinguées.

Fait à {{entite.siege}}, le {{dateLettre}}.

{{entite.signataire}}`,
    attachments: [],
    legalNote: 'OBLIGATOIRE : envoyer en lettre recommandée avec accusé de réception (LRAR). L\'email seul ne suffit pas juridiquement. Conserver les preuves d\'envoi et de réception.'
  },

  // ─── Révision IRL (annuelle) ───────────────────────────────────────────
  'irl-revision': {
    subject: 'Révision annuelle du loyer (IRL) — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Conformément à l'article 17-1 de la loi n° 89-462 du 6 juillet 1989 et à la clause de révision figurant à votre bail, nous vous informons de la révision annuelle du loyer de votre logement situé {{bail.adrBien}}.

Détail (cf. lettre détaillée en pièce jointe) :
- Loyer hors charges actuel : {{ancienHC}} €
- Nouveau loyer hors charges : {{nouveauHC}} €
- Application : à compter du mois de {{moisApplication}}

Les charges restent inchangées à {{bail.ch}} €/mois.

Pour toute question, n'hésitez pas à revenir vers nous.

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [
      { name: 'Lettre-revision-IRL-{{logement.ref}}.pdf', type: 'pdf' }
    ],
    legalNote: 'La révision n\'est valable que pour les bails non gelés (DPE ≠ F/G — loi Climat 2021 art. 23).'
  },

  // ─── Renouvellement MRH ────────────────────────────────────────────────
  'mrh-renouvellement': {
    subject: 'Renouvellement assurance habitation (MRH) — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

L'attestation d'assurance habitation actuellement en notre possession pour le logement {{bail.adrBien}} arrive à échéance le {{dateFinMRH}}.

Conformément à l'article 7g de la loi n° 89-462 du 6 juillet 1989, vous avez l'obligation de souscrire une assurance habitation (responsabilité civile locative au minimum) pendant toute la durée du bail.

Merci de bien vouloir nous transmettre votre nouvelle attestation MRH avant le {{dateFinMRH}}, par retour de mail (PDF ou photo lisible suffit).

À défaut de réception dans les délais, et conformément à votre contrat, nous serions contraints de souscrire une assurance pour votre compte et de vous en répercuter le coût.

Cordialement,
{{entite.gerant}}`,
    attachments: [],
    legalNote: 'Obligation légale (art. 7g loi 1989). Conserver la nouvelle attestation dans la fiche logement.'
  },

  // ─── Bail signé (envoi copie finale) ───────────────────────────────────
  'bail-signe-final': {
    subject: 'Bail signé — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Nous vous remercions pour la signature de votre bail concernant le logement situé {{bail.adrBien}}.

Vous trouverez en pièce jointe :
- Le contrat de bail signé (PDF)
- L'état des lieux d'entrée (PDF, si déjà réalisé)
- La notice d'information (annexe obligatoire)

Quelques informations pratiques :
- Date de prise d'effet : {{bail.debut}}
- Loyer mensuel : {{montant}} € (hors charges {{bail.hc}} € + charges {{bail.ch}} €)
- Date de paiement : le {{bail.jpay}} de chaque mois
- Dépôt de garantie : {{bail.dg}} € (reçu)

N'oubliez pas de souscrire votre assurance habitation (obligation légale) et de nous en transmettre l'attestation dans les meilleurs délais.

Bienvenue dans votre nouveau logement.

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [
      { name: 'Bail-{{logement.ref}}-signe.pdf', type: 'pdf' },
      { name: 'EDL-entree-{{logement.ref}}.pdf', type: 'pdf' }
    ],
    legalNote: 'Conserver une copie signée + accusé de réception (envoi recommandé ou remise en main propre avec signature locataire).'
  },

  // ─── Convocation EDL sortie ────────────────────────────────────────────
  'convocation-edl-sortie': {
    subject: 'Convocation — État des lieux de sortie — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Suite à votre préavis de départ du logement situé {{bail.adrBien}}, nous vous proposons de procéder à l'état des lieux de sortie le :

  {{dateEDL}} à {{heureEDL}}
  Sur place : {{bail.adrBien}}

Votre présence (ou celle d'un mandataire muni d'une procuration écrite) est requise pour la signature contradictoire de l'état des lieux, conformément à l'article 3-2 de la loi n° 89-462 du 6 juillet 1989.

Merci de bien vouloir :
- Confirmer votre disponibilité par retour de mail
- Restituer toutes les clés du logement (incluant boîte aux lettres, garage, cave)
- Fournir le relevé des compteurs (eau, gaz, électricité) si vous avez la main dessus
- Avoir effectué les éventuelles réparations locatives à votre charge

À défaut de présence et sans manifestation de votre part, l'état des lieux pourra être réalisé par huissier à vos frais (art. 3-2 al. 4 loi 1989).

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [],
    legalNote: 'Sans présence du locataire, EDL par huissier à ses frais (art. 3-2 loi 1989). Possibilité de RDV en deux temps si besoin.'
  },

  // ═══════════════════════════════════════════════════════════════════════
  // v15.09 Sprint 10 V1.1 — EMAIL-AUTO extension cycle locataire complet
  // 19 nouveaux types : signature bail, entrée locataire, vie du bail,
  // évolution, fin de bail, sortie/solde.
  // ═══════════════════════════════════════════════════════════════════════

  // ─── PHASE SIGNATURE BAIL ──────────────────────────────────────────────

  'bail-pret-a-signer': {
    subject: 'Votre bail est prêt à être signé — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Le projet de bail concernant le logement situé {{bail.adrBien}} est prêt à être signé.

Détail principal :
- Date de prise d'effet : {{bail.debut}}
- Durée : {{dureeBail}}
- Loyer hors charges : {{bail.hc}} €/mois
- Provisions sur charges : {{bail.ch}} €/mois
- Dépôt de garantie : {{bail.dg}} €

Vous trouverez en pièce jointe le projet de bail complet à relire. Merci de bien vouloir nous transmettre vos éventuelles questions / remarques avant la signature.

La signature aura lieu le {{dateSignature}}{{lieuSignatureTxt}}.

Documents à apporter le jour de la signature :
- Pièce d'identité en cours de validité
- Justificatif de domicile de moins de 3 mois
- Attestation MRH (assurance habitation) ou engagement de la souscrire avant entrée
- Acte de cautionnement signé par le(s) garant(s) le cas échéant

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [
      { name: 'Projet-bail-{{logement.ref}}.pdf', type: 'pdf' }
    ],
    legalNote: 'Conserver une trace de l\'envoi du projet (sert de preuve d\'information préalable du locataire).'
  },

  'cautionnement-signe': {
    subject: 'Acte de cautionnement bien reçu — {{bail.adrBien}}',
    body: `Bonjour {{garant.civNom}},

Nous accusons réception de l'acte de cautionnement signé par vos soins en garantie des obligations locatives de {{locataire.civNom}} pour le logement situé {{bail.adrBien}}.

Cet acte engage votre solidarité au paiement des loyers, charges, et éventuelles indemnités d'occupation, dans les limites définies par le document signé.

Vous trouverez en pièce jointe une copie de l'acte cautionnement.

Pour rappel, vous pouvez à tout moment :
- Demander un point sur la situation locative (état des règlements)
- Mettre fin au cautionnement à durée indéterminée par lettre recommandée (avec préavis prévu à l'acte)

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [
      { name: 'Cautionnement-{{logement.ref}}.pdf', type: 'pdf' }
    ],
    legalNote: 'Conservation de l\'acte original 5 ans après la fin du bail (prescription).'
  },

  'bail-avenant': {
    subject: 'Avenant à votre bail — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Nous vous transmettons en pièce jointe un avenant à votre bail concernant le logement {{bail.adrBien}}.

Objet de l'avenant : {{motifAvenant}}

Date d'application proposée : {{dateApplication}}

Merci de bien vouloir :
- Relire attentivement l'avenant
- Le signer dans les meilleurs délais (signature manuscrite ou électronique)
- Nous retourner un exemplaire signé

L'avenant ne modifie aucune autre clause du bail initial.

À votre disposition pour toute question avant signature.

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [
      { name: 'Avenant-{{logement.ref}}-{{dateApplication}}.pdf', type: 'pdf' }
    ],
    legalNote: 'L\'avenant doit être accepté explicitement (signé). Sans signature, le bail initial reste applicable.'
  },

  // ─── PHASE ENTRÉE LOCATAIRE ────────────────────────────────────────────

  'edl-convocation-entree': {
    subject: 'Convocation — État des lieux d\'entrée — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Nous vous donnons rendez-vous pour l'état des lieux d'entrée du logement situé {{bail.adrBien}} :

  Date : {{dateEDL}}
  Heure : {{heureEDL}}
  Sur place : {{bail.adrBien}}

Conformément à l'article 3-2 de la loi n° 89-462 du 6 juillet 1989, cet état des lieux contradictoire et écrit sera annexé à votre bail. Il décrit précisément l'état du logement et des équipements à votre entrée — il servira de référence à la sortie pour évaluer d'éventuelles dégradations.

Merci de :
- Confirmer votre disponibilité par retour de mail
- Prévoir 1 à 2 heures pour un examen détaillé pièce par pièce
- Vous munir d'une pièce d'identité
- Avoir souscrit votre assurance habitation (obligation art. 7g loi 1989) — apporter l'attestation

Si vous êtes empêché, vous pouvez vous faire représenter par un mandataire muni d'une procuration écrite.

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [],
    legalNote: 'Sans EDL contradictoire, présomption en faveur du locataire (logement loué en bon état art. 1731 Code civil) → grave perte pour le bailleur.'
  },

  'edl-entree-signe': {
    subject: 'État des lieux d\'entrée signé — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Vous trouverez en pièce jointe l'état des lieux d'entrée signé conjointement le {{dateEDL}} pour le logement situé {{bail.adrBien}}.

Ce document constitue la **référence officielle** de l'état du logement et de ses équipements à votre entrée.

Relevé des compteurs à votre entrée :
- Électricité : {{compteurElec}}
- Gaz : {{compteurGaz}}
- Eau froide : {{compteurEauF}}
- Eau chaude : {{compteurEauC}}

Conservez bien ce document — il sera comparé à l'état des lieux de sortie pour évaluer d'éventuelles réparations à votre charge.

Si vous constatez une anomalie non mentionnée dans les 10 jours suivant votre entrée, vous pouvez nous demander une révision par écrit (article 3-2 alinéa 5 loi 1989).

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [
      { name: 'EDL-entree-{{logement.ref}}.pdf', type: 'pdf' }
    ],
    legalNote: 'Le locataire a 10 jours après son entrée pour demander la modification de l\'EDL. Au-delà, l\'EDL est figé.'
  },

  'bienvenue-infos-pratiques': {
    subject: 'Bienvenue ! Informations pratiques — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Bienvenue dans votre nouveau logement {{bail.adrBien}}.

Voici quelques informations pratiques pour vous installer sereinement :

📡 RACCORDEMENTS
- Électricité : à mettre en service à votre nom auprès du fournisseur de votre choix
- Gaz : idem (si applicable)
- Eau : {{contactEau}}
- Internet / TV / Téléphone : opérateurs au choix (logement éligible {{technologiesDispo}})

🚮 ORDURES MÉNAGÈRES
- Jour de collecte ordures : {{jourCollecteOM}}
- Jour de collecte tri sélectif : {{jourCollecteTri}}
- Local poubelles : {{localPoubelles}}

🏢 COPROPRIÉTÉ / VOISINAGE
- Syndic : {{syndic}}
- Règlement de copropriété : disponible sur demande
- Contacts utiles voisins / gardien : {{contactGardien}}

🚨 EN CAS D'URGENCE
- Coupure générale eau / gaz / élec : {{contactUrgence}}
- Dégât des eaux : appeler immédiatement votre assurance + nous prévenir
- Incendie : 18 (pompiers) puis nous prévenir

🛡 OBLIGATIONS RAPPEL
- Assurance habitation (MRH) à souscrire avant entrée si pas encore fait
- Entretien chaudière annuel à organiser par vos soins (si chauffage gaz/fioul/bois)
- Détecteur de fumée à entretenir (pile à remplacer)

Pour toute question, n'hésitez pas à nous contacter par mail ou téléphone.

Bonne installation et excellente vie dans votre nouveau logement.

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [],
    legalNote: ''
  },

  'dg-recu': {
    subject: 'Confirmation réception dépôt de garantie — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Nous accusons bonne réception du dépôt de garantie d'un montant de {{bail.dg}} € versé le {{dateVersement}} pour le logement {{bail.adrBien}}.

Ce dépôt de garantie sera conservé pendant toute la durée du bail et restitué dans les conditions prévues par l'article 22 de la loi du 6 juillet 1989 :
- 1 mois à compter de la remise des clés si l'état des lieux de sortie est conforme à l'état des lieux d'entrée
- 2 mois à compter de la remise des clés dans les autres cas

Le dépôt de garantie est rémunéré uniquement dans certaines conditions très restrictives (non applicable dans la majorité des baux d'habitation classiques).

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [],
    legalNote: 'Date de versement à conserver pour le calcul du délai de restitution. Si paiement par chèque, attendre encaissement effectif.'
  },

  // ─── PHASE VIE DU BAIL — DEMANDES ATTESTATIONS / NOTIFICATIONS ─────────

  'demande-attest-entretien-chauffage': {
    subject: 'Demande d\'attestation d\'entretien chauffage {{annee}} — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Conformément à l'article R224-31 du Code de l'environnement et au décret n° 2009-649 du 9 juin 2009, l'entretien annuel de la chaudière du logement {{bail.adrBien}} est à votre charge.

Pour {{annee}}, nous n'avons pas encore reçu votre attestation d'entretien. Merci de bien vouloir nous la transmettre dès que possible (PDF ou photo lisible du certificat d'entretien).

Cette attestation doit être remise par le professionnel ayant réalisé l'intervention. Elle est obligatoire et engage votre responsabilité civile (assurance habitation) en cas d'incident lié au chauffage.

Si l'entretien n'a pas encore été réalisé pour cette année, merci de prévoir l'intervention dans les meilleurs délais et de nous transmettre le justificatif ensuite.

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [],
    legalNote: 'Obligation locataire (décret 2009-649). À conserver dans la fiche logement.'
  },

  'demande-attest-mrh': {
    subject: 'Renouvellement attestation d\'assurance habitation — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

L'attestation d'assurance habitation actuellement en notre possession arrive à échéance le {{dateFinMRH}}.

Conformément à l'article 7g de la loi n° 89-462 du 6 juillet 1989, vous avez l'obligation de souscrire et maintenir une assurance habitation (responsabilité civile locative au minimum) pendant toute la durée du bail.

Merci de nous transmettre votre nouvelle attestation MRH avant le {{dateFinMRH}}, par retour de mail (PDF ou photo lisible).

À défaut de réception dans les délais, nous serions contraints, conformément à votre contrat, de souscrire une assurance pour votre compte et de vous en répercuter le coût majoré de 10 % (art. 7g).

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [],
    legalNote: 'Obligation art. 7g loi 1989. Sans MRH, le bail peut être résilié à torts du locataire.'
  },

  'notification-travaux-a-venir': {
    subject: 'Notification de travaux à venir — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Nous vous informons que des travaux vont être réalisés dans / sur le logement situé {{bail.adrBien}} :

Nature des travaux : {{natureTravaux}}
Date de début : {{dateDebut}}
Durée estimée : {{dureeEstimee}}
Intervenant : {{intervenant}}

{{detailContexte}}

Conformément à l'article 7e de la loi n° 89-462 du 6 juillet 1989, le locataire est tenu de laisser exécuter les travaux d'amélioration des parties communes ou des parties privatives, ainsi que les travaux nécessaires au maintien en état et à l'entretien normal des locaux loués.

Si les travaux durent plus de 21 jours ouvrés, vous pouvez prétendre à une réduction proportionnelle de loyer (art. 1724 Code civil).

Pour tout aménagement de planning, contactez-nous au plus tôt.

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [],
    legalNote: 'Préavis raisonnable (8 jours minimum recommandé sauf urgence). Réduction loyer obligatoire si > 21 jours ouvrés.'
  },

  'notification-visite': {
    subject: 'Demande de créneau pour visite — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Nous aurions besoin d'accéder au logement {{bail.adrBien}} pour : {{motifVisite}}

Nous vous proposons les créneaux suivants :
- {{creneau1}}
- {{creneau2}}
- {{creneau3}}

Merci de nous indiquer celui qui vous conviendrait, ou de nous proposer un autre créneau si aucun ne fonctionne.

Conformément à la jurisprudence (article 9 loi 1989 + Cass. civ. 3e), l'accès au logement loué nécessite votre accord préalable, sauf en cas d'urgence (dégât des eaux, incendie, etc.).

Nous restons à votre disposition.

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [],
    legalNote: 'Sans accord du locataire = violation de domicile. Toujours négocier un créneau, sauf urgence avérée.'
  },

  // ─── PHASE ÉVOLUTION / FIN DE BAIL ─────────────────────────────────────

  'bail-renouvellement-3ans': {
    subject: 'Renouvellement de votre bail — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Votre bail concernant le logement {{bail.adrBien}} arrive à son terme initial le {{dateFin}}.

Sauf congé délivré dans les formes et délais légaux, votre bail sera **tacitement reconduit** : pour trois ans si le bailleur est une personne physique ou relève de l'article 13, pour six ans s'il est une autre personne morale (articles 10 et 13 de la loi n° 89-462 du 6 juillet 1989), ou pour un an s'il s'agit d'un bail meublé (article 25-7 de la même loi).

Nous restons à votre disposition pour toute discussion concernant cette reconduction.

{{noteRevisionLoyer}}

Bonne continuation dans votre logement.

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [],
    legalNote: 'Tacite reconduction = mêmes conditions financières. Pour modifier le loyer en renouvellement, suivre la procédure encadrée art. 17-2 loi 1989 (préavis 6 mois + références).'
  },

  'bail-conge-bailleur-6mois': {
    subject: 'Congé pour {{motifConge}} — {{bail.adrBien}}',
    body: `Lettre recommandée avec accusé de réception
(et copie par email)

{{locataire.civNom}}
{{bail.adrBien}}

Objet : Congé pour {{motifConge}} — Bail du {{bail.debut}}

{{locataire.civNom}},

Conformément à l'article 15-I de la loi n° 89-462 du 6 juillet 1989, je vous donne par la présente congé du logement {{bail.adrBien}} que je vous loue depuis le {{bail.debut}}, pour le motif suivant :

{{motifDetail}}

Le présent congé prend effet au terme du bail, soit le {{dateFin}}.

{{mentionPreavis}}

Vous trouverez ci-joint, le cas échéant, les pièces justifiant le motif allégué (offre de vente, justificatif de reprise pour un proche, etc.) conformément à la loi.

Veuillez agréer, {{locataire.civNom}}, l'expression de mes salutations distinguées.

Fait à {{entite.siege}}, le {{dateLettre}}.

{{entite.signataire}}`,
    attachments: [],
    legalNote: 'OBLIGATOIRE : LRAR ou signification par huissier ou remise en main propre contre récépissé. Mentionner précisément le motif (vente, reprise pour soi/proche, motif sérieux et légitime). Joindre justificatifs. Reprise ou vente : joindre la notice d\'information de l\'arrêté du 13 décembre 2017 (art. 15-I) — le document « Congé / résiliation » de la fiche du bien la joint d\'office.'
  },

  // BAUX-ECHUS — BAIL MEUBLÉ : refus de renouvellement motivé, art. 25-8, I (cité mot pour mot,
  // Légifrance, version en vigueur depuis le 29/07/2023). Pas d'art. 15, pas d'annexe 15-II (le droit
  // de préemption de l'art. 15-II ne vise que le bail nu).
  'bail-conge-bailleur-meuble': {
    subject: 'Congé pour {{motifConge}} — {{bail.adrBien}}',
    body: `Lettre recommandée avec accusé de réception
(et copie par email)

{{locataire.civNom}}
{{bail.adrBien}}

Objet : Congé pour {{motifConge}} — Bail meublé du {{bail.debut}}

{{locataire.civNom}},

L'article 25-8, I de la loi n° 89-462 du 6 juillet 1989 dispose : « Le bailleur qui ne souhaite pas renouveler le contrat doit informer le locataire avec un préavis de trois mois et motiver son refus de renouvellement du bail soit par sa décision de reprendre ou de vendre le logement, soit par un motif légitime et sérieux, notamment l'inexécution par le locataire de l'une des obligations lui incombant. »

En application de cet article, je vous informe par la présente que je ne renouvelle pas le bail du logement {{bail.adrBien}} que je vous loue depuis le {{bail.debut}}, pour le motif suivant :

{{motifDetail}}

Le présent congé prend effet au terme du bail, soit le {{dateFin}}.

{{mentionPreavis}}

Vous trouverez ci-joint, le cas échéant, les pièces justifiant le motif allégué.

Veuillez agréer, {{locataire.civNom}}, l'expression de mes salutations distinguées.

Fait à {{entite.siege}}, le {{dateLettre}}.

{{entite.signataire}}`,
    attachments: [],
    legalNote: 'OBLIGATOIRE (art. 25-8, I) : lettre recommandée avec demande d\'avis de réception, acte de commissaire de justice ou remise en main propre contre récépissé ou émargement, au moins trois mois avant le terme. À peine de nullité : le motif et, en cas de reprise, les nom et adresse du bénéficiaire et la nature du lien.'
  },

  // BAUX-ECHUS — BAIL ÉTUDIANT (9 mois) ou MOBILITÉ : aucun congé n'est nécessaire, le bail prend fin à
  // son terme (art. 25-7 / 25-14). La lettre INFORME, sans motif et sans « date d'effet » : la phrase de
  // terme est au futur ou au passé selon la date ({{phraseTerme}}).
  'bail-fin-terme-information': {
    subject: 'Information de fin de bail — {{bail.adrBien}}',
    body: `{{locataire.civNom}}
{{bail.adrBien}}

Objet : Information de fin de bail — Bail du {{bail.debut}}

{{locataire.civNom}},

Le bail du logement {{bail.adrBien}}, ayant pris effet le {{bail.debut}}, {{phraseTerme}}.

{{mentionPreavis}}

Pour poursuivre la location, un nouveau bail doit être signé. À défaut, merci de convenir d'une date pour l'état des lieux de sortie et la remise des clés.

Veuillez agréer, {{locataire.civNom}}, l'expression de mes salutations distinguées.

Fait à {{entite.siege}}, le {{dateLettre}}.

{{entite.signataire}}`,
    attachments: [],
    legalNote: 'Information, pas un congé : un bail étudiant de neuf mois (art. 25-7) ou un bail mobilité (art. 25-14) prend fin à son terme sans qu\'un congé soit nécessaire.'
  },

  // BAUX-ECHUS — GARAGE / AUTRE (hors loi du 6 juillet 1989) : le congé suit le contrat, sans motif.
  'bail-conge-bailleur-contrat': {
    subject: 'Congé — {{bail.adrBien}}',
    body: `Lettre recommandée avec accusé de réception
(et copie par email)

{{locataire.civNom}}
{{bail.adrBien}}

Objet : Congé — Contrat de location du {{bail.debut}}

{{locataire.civNom}},

Conformément aux stipulations du contrat de location ayant pris effet le {{bail.debut}} pour {{bail.adrBien}}, je vous donne par la présente congé de ce contrat, à effet du {{dateFin}}.

{{mentionPreavis}}

Je vous remercie de libérer les lieux et de restituer l'ensemble des moyens d'accès à cette date.

Veuillez agréer, {{locataire.civNom}}, l'expression de mes salutations distinguées.

Fait à {{entite.siege}}, le {{dateLettre}}.

{{entite.signataire}}`,
    attachments: [],
    legalNote: 'Location hors loi du 6 juillet 1989 : forme, préavis et date d\'effet du congé sont ceux prévus au contrat.'
  },

  'bail-preavis-recu': {
    subject: 'Accusé de réception de votre préavis — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Nous accusons bonne réception de votre préavis de départ du logement situé {{bail.adrBien}}, daté du {{datePreavis}}.

Conformément à votre courrier et à la loi du 6 juillet 1989 :
- Type de bail : {{typeBail}}
- Durée du préavis : {{dureePreavis}} mois
- Date d'effet : {{dateFinPreavis}}
- Motif (si réduit) : {{motifReduction}}

Nous vous proposons de procéder à l'état des lieux de sortie à proximité de cette date :
- Date proposée : {{dateEDLSortie}}
- Heure : {{heureEDLSortie}}

Merci de :
- Confirmer cette date ou nous proposer une alternative
- Restituer toutes les clés (logement, boîte aux lettres, garage, cave, parties communes)
- Effectuer les éventuelles réparations locatives à votre charge avant l'EDL
- Préparer votre nouvelle adresse pour le solde de tout compte

Le dépôt de garantie ({{bail.dg}} €) vous sera restitué dans les délais légaux, à compter de la remise des clés (art. 22 loi 89-462).

Nous vous remercions pour ces années de bail et vous souhaitons une bonne suite.

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [],
    legalNote: 'Conserver le préavis original (papier ou email). Le délai de préavis court à compter de la réception par le bailleur (cachet de la Poste).'
  },

  // ─── Résiliation amiable (accord des parties, art. 1193 C. civ.) ─────────
  'bail-resiliation-amiable': {
    subject: 'Protocole de résiliation amiable du bail — {{bail.adrBien}}',
    body: `PROTOCOLE DE RÉSILIATION AMIABLE

Entre les soussignés :
- Le bailleur : {{entite.nom}}, {{entite.siege}},
- Le locataire : {{locataire.civNom}},

concernant le logement situé {{bail.adrBien}}, loué depuis le {{bail.debut}},

il est convenu d'un commun accord, en application de l'article 1193 du code civil, ce qui suit :

Le bail est résilié à l'amiable, sans préavis ni indemnité de part ni d'autre, à la date d'effet du {{dateEffet}}.

À cette date, le locataire libère les lieux et restitue l'ensemble des clés. Un état des lieux de sortie contradictoire est établi ; le dépôt de garantie est restitué dans les conditions et délais légaux (art. 22 de la loi du 6 juillet 1989).

Conditions particulières convenues : {{conditions}}

Les parties se donnent mutuellement quitus de toute autre obligation au titre du bail, sous réserve du solde de tout compte (loyers, charges et régularisations dus jusqu'à la date d'effet).

Fait en deux exemplaires originaux à {{entite.siege}}, le {{dateLettre}}.

Le bailleur                              Le locataire (« Bon pour résiliation amiable »)
{{entite.signataireLigne}}       {{locataire.civNom}}`,
    attachments: [],
    legalNote: 'La résiliation amiable suppose l\'accord EXPRÈS des deux parties (art. 1193 C. civ.) : faire signer les deux exemplaires. Elle met fin au bail sans préavis ni motif, à la date convenue.'
  },

  // ─── PHASE SORTIE / SOLDE ───────────────────────────────────────────────

  'edl-sortie-signe': {
    subject: 'État des lieux de sortie signé — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Vous trouverez en pièce jointe l'état des lieux de sortie signé conjointement le {{dateEDL}} pour le logement situé {{bail.adrBien}}.

Synthèse :
- Comparatif compteurs entrée / sortie : {{comparatifCompteurs}}
- Dégradations constatées : {{degradationsBilan}}

{{conclusionEDL}}

Le solde de votre dépôt de garantie sera restitué dans les délais légaux : 1 mois à compter de la remise des clés si l'état des lieux de sortie est conforme à l'état des lieux d'entrée, 2 mois sinon (article 22 de la loi du 6 juillet 1989).

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [
      { name: 'EDL-sortie-{{logement.ref}}.pdf', type: 'pdf' }
    ],
    legalNote: 'Si désaccord sur l\'EDL → noter les réserves sur le document avant signature OU refuser de signer (constat par huissier à demander dans ce cas).'
  },

  'dg-restitution-integrale': {
    subject: 'Restitution intégrale de votre dépôt de garantie — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Suite à l'état des lieux de sortie du {{dateEDLSortie}} qui n'a fait apparaître aucune dégradation par rapport à l'entrée, nous vous restituons l'intégralité de votre dépôt de garantie.

Montant restitué : {{bail.dg}} €
Mode : virement bancaire
Date prévue du virement : {{dateRestitution}}

Conformément à l'article 22 de la loi n° 89-462 du 6 juillet 1989, ce remboursement intervient dans le délai légal d'un mois suivant la restitution des clés.

Nous vous souhaitons une bonne suite et restons à votre disposition pour toute attestation utile (logement libéré, etc.).

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [],
    legalNote: 'Délai 1 mois suivant remise des clés. Au-delà, pénalité de 10 % du loyer par mois de retard entamé (loi ALUR).'
  },

  'dg-restitution-partielle': {
    subject: 'Restitution partielle de votre dépôt de garantie — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Suite à l'état des lieux de sortie du {{dateEDLSortie}}, certaines dégradations ont été constatées et nécessitent une retenue sur votre dépôt de garantie.

Décompte :
- Dépôt de garantie initial : {{bail.dg}} €
- Retenues détaillées (factures / devis joints) :
{{detailRetenues}}
- Total retenu : {{montantRetenu}} €
- Solde restitué : {{soldeRestitue}} €

Le solde sera versé par virement bancaire.
Date prévue du virement : {{dateRestitution}}

Vous trouverez en pièce jointe les factures / devis justifiant les retenues, conformément à l'article 22 de la loi du 6 juillet 1989.

Le délai légal de restitution court à compter de la remise des clés : 1 mois si l'état des lieux de sortie est conforme à l'état des lieux d'entrée, 2 mois sinon (article 22 de la loi du 6 juillet 1989).

Si vous souhaitez contester un poste, merci de nous adresser un courrier motivé sous 15 jours.

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [],
    legalNote: 'Justificatifs OBLIGATOIRES (factures, devis détaillés). Retenue sans justif = irrecevable juridiquement et passible de la pénalité 10 %/mois.'
  },

  'solde-tout-compte': {
    subject: 'Solde de tout compte final — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

À la suite de la sortie du logement {{bail.adrBien}}, nous établissons ci-dessous le solde de tout compte final :

Crédits (sommes en votre faveur) :
- Dépôt de garantie : {{bail.dg}} €
- Trop-perçu charges (régul annuelle) : {{tropPercuCharges}} €
- Autre : {{autresCredits}} €
Total crédit : {{totalCredit}} €

Débits (sommes restant à votre charge) :
- Loyer impayé : {{loyerImpaye}} €
- Charges restant dues : {{chargesDues}} €
- Retenues sur DG (réparations) : {{retenuesDG}} €
- Autre : {{autresDebits}} €
Total débit : {{totalDebit}} €

Solde net : {{soldeNet}} € ({{senseSolde}})

{{instructionsReglement}}

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [],
    legalNote: 'Le solde de tout compte ne peut être imposé. Si le locataire conteste, action en justice possible (Tribunal Judiciaire — 5 ans de prescription).'
  },

  'attestation-logement-libere': {
    subject: 'Attestation officielle — Libération du logement {{bail.adrBien}}',
    body: `ATTESTATION DE LIBÉRATION DE LOGEMENT

Je soussigné(e), {{entite.gerant}}, agissant en qualité de bailleur (ou son mandataire) pour le compte de {{entite.nom}}, atteste par la présente que :

{{locataire.civNom}}, locataire du logement situé {{bail.adrBien}}, a effectivement libéré ledit logement en date du {{dateLiberation}}.

L'état des lieux contradictoire de sortie a été établi le {{dateEDLSortie}}. Les clés ont été remises {{modaliteRemiseClef}}.

Cette attestation est délivrée pour servir et valoir ce que de droit (changement d'adresse, démarches administratives, nouveau bail, etc.).

Fait à {{entite.siege}}, le {{dateAttestation}}.

{{entite.signataire}}`,
    attachments: [],
    legalNote: 'Utile au locataire pour CAF, employeur, nouveau bailleur, opérateurs téléphoniques, etc. Bonne pratique de la délivrer systématiquement.'
  },

  // ─── Décompte régularisation annuelle ──────────────────────────────────
  'decompte-regul-annuel': {
    subject: 'Décompte de régularisation des charges {{annee}} — {{bail.adrBien}}',
    body: `Bonjour {{locataire.civNom}},

Conformément à l'article 23 de la loi n° 89-462 du 6 juillet 1989, nous vous adressons le décompte de régularisation des charges pour l'année {{annee}} concernant le logement {{bail.adrBien}}.

Synthèse :
- Provisions sur charges versées sur la période : {{provisions}} €
- Charges réelles refacturables (quote-part locataire) : {{chargesReelles}} €
{{acompteLine}}- Solde : {{solde}} € ({{soldeSens}})

Le détail par nature de charge (eau, ordures ménagères, chauffage collectif, entretien des parties communes, etc.) figure dans le décompte joint en PDF.

Vous disposez d'un délai d'un mois à compter de la réception de cette régularisation pour consulter sur place les justificatifs (factures, contrats, décomptes copro) si vous le souhaitez.

{{soldeAction}}

Pour toute question, n'hésitez pas à revenir vers nous.

Cordialement,
{{entite.gerant}}
{{entite.nom}}`,
    attachments: [
      { name: 'Decompte-charges-{{annee}}-{{logement.ref}}.pdf', type: 'pdf' }
    ],
    legalNote: 'Conserver les justificatifs (factures, décomptes copro) à la disposition du locataire pendant 6 mois (art. 23 loi 1989).'
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Interpolation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Résout un chemin "a.b.c" dans context. Retourne undefined si introuvable.
 * @param {object} context
 * @param {string} path
 */
function _resolvePath(context, path) {
  if (context == null) return undefined;
  const parts = String(path).split('.');
  let v = context;
  for (const p of parts) {
    if (v == null) return undefined;
    v = v[p];
  }
  return v;
}

/**
 * L'ouverture de la mise en demeure, construite sur les relances RÉELLEMENT envoyées.
 *
 * Le modèle affirmait « Malgré nos relances des {{rappel1Date}} et {{rappel2Date}} » — deux
 * relances, toujours, qu'elles aient existé ou non. Les deux chemins produisaient une phrase
 * fausse : depuis la modale d'actes, les jetons valaient littéralement « (relance 1) » et
 * « (relance 2) » ; depuis le Hub, une absence de relance donnait « (inconnu) ».
 *
 * Une mise en demeure est l'étape amiable qui précède le commandement de payer visant la clause
 * résolutoire. Y affirmer des relances qui n'ont pas eu lieu, c'est offrir au locataire de quoi
 * la faire écarter — et, quand le locataire a bien été relancé une seule fois, se priver d'une
 * preuve exacte au profit d'une formule invérifiable.
 *
 * Ne renvoie JAMAIS une chaîne vide : `_interpolateEmail` transformerait '' en « (inconnu) ».
 *
 * @param {Array<string>} dates dates des relances effectivement envoyées, déjà formatées
 * @returns {string} l'amorce, ponctuation comprise, jusqu'à « nous constatons que »
 */
export function phraseRelances(dates) {
  const l = (Array.isArray(dates) ? dates : [])
    .map((d) => String(d == null ? '' : d).trim())
    .filter(Boolean);
  if (!l.length) return 'Nous constatons que';
  if (l.length === 1) return 'Malgré notre relance du ' + l[0] + ', nous constatons que';
  return 'Malgré nos relances des ' + l.slice(0, -1).join(', ') + ' et ' + l[l.length - 1]
    + ', nous constatons que';
}

/**
 * Interpole un template en remplaçant chaque {{path.to.value}} par sa valeur
 * résolue dans context. Variable absente / null / '' → '(inconnu)'.
 *
 * @param {string} template
 * @param {object} context
 * @param {object} [opts]
 * @param {boolean} [opts.escapeHtml=false] Si true, échappe les valeurs HTML.
 * @returns {string}
 */
export function _interpolateEmail(template, context, opts = {}) {
  if (template == null) return '';
  const escape = opts && opts.escapeHtml === true;
  return String(template).replace(/\{\{([\w.]+)\}\}/g, (_match, path) => {
    const v = _resolvePath(context, path);
    if (v == null || v === '') return '(inconnu)';
    const s = String(v);
    return escape ? escHtml(s) : s;
  });
}

// ────────────────────────────────────────────────────────────────────────────
// API principale
// ────────────────────────────────────────────────────────────────────────────

/**
 * Liste des types supportés en V1.
 * @returns {string[]}
 */
export function _emailTypesSupportes() {
  return Object.keys(TEMPLATES);
}

/**
 * v15.90 EM-3 DOC-CIVILITE — Enrichit ctx.locataire (et ctx.garant) avec des champs
 * dérivés civilité : civNom, civSalut, civilitePolitesse. Idempotent (no-op si déjà set).
 *
 * Mapping civilité court → long :
 *   'M.'  → 'Monsieur'
 *   'Mme' → 'Madame'
 *   ''    → '' (fallback : civNom = nom seul, civSalut = "Madame, Monsieur,")
 *
 * @param {object} ctx
 * @returns {object} ctx enrichi (nouvel objet, ne mute pas l'original)
 */
/**
 * Un modèle est un ACTE FORMEL s'il se clôt par « Fait à … » — c'est-à-dire s'il porte
 * `{{entite.siege}}`. On le DÉDUIT du modèle au lieu d'en tenir une liste : une liste à la main
 * aurait dérivé au premier modèle ajouté, et c'est précisément ce genre d'oubli qui a laissé le
 * Hub émettre un congé sans prix.
 *
 * Aujourd'hui : mise en demeure, congé bailleur, résiliation amiable, attestation de libération.
 */
export function acteFormel(type) {
  const t = TEMPLATES[type];
  return !!(t && /\{\{entite\.siege\}\}/.test(String(t.body || '')));
}

/**
 * L'IDENTITÉ DU SIGNATAIRE dans un acte formel.
 *
 * Une entité sans siège ni gérant produisait un acte « Fait à (inconnu) », signé « (inconnu) » —
 * sans que rien ne le signale, parce que `(inconnu)` est la convention du moteur d'interpolation
 * et que le garde-fou ne lit que les marqueurs nommés (cf. `congeMotifDetail`, conge.js).
 *
 * On pose donc ici des marqueurs NOMMÉS, et seulement sur les actes : un email courant signé du
 * prénom de l'utilisateur n'a pas à déclencher une alerte juridique.
 *
 * Ces deux mentions n'emportent PAS nullité — aucun texte n'impose le lieu de rédaction d'un
 * congé. Elles sont donc signalées sans le mot « NUL » (cf. table `NULLITE`, actes-mentions.js).
 */
function _enrichContextActe(ctx) {
  const e = (ctx && typeof ctx.entite === 'object' && ctx.entite) || {};
  const ou = (v, nom) => (String(v == null ? '' : v).trim() || ('\u2039' + nom + '\u203a'));

  // LA SIGNATURE DE L'ACTE, calculée — parce que « gérant » et « entité » ne sont pas toujours
  // deux choses. Les modèles imprimaient les deux jetons l'un sous l'autre : pour une SCI c'est
  // juste (« Didier Keller » / « SCI Dupont »), mais un PARTICULIER n'a pas de gérant — son acte
  // partait signé « (inconnu) », et le repli sur le nom de l'entité l'aurait fait signer deux fois.
  // On ne nomme donc la personne qu'une fois, et l'entité seulement si elle en diffère.
  // (Ces deux jetons n'existent que pour les actes formels : les 22 autres modèles gardent
  //  « {{entite.gerant}} / {{entite.nom}} », qui leur convient et que rien n'oblige à changer.)
  const gerant = String(e.gerant == null ? '' : e.gerant).trim();
  const nom = String(e.nom == null ? '' : e.nom).trim();
  const parties = [];
  if (gerant) parties.push(gerant);
  if (nom && nom !== gerant) parties.push(nom);
  const MARQUEUR = '\u2039signataire\u203a';

  return Object.assign({}, ctx, {
    entite: Object.assign({}, e, {
      siege: ou(e.siege, 'lieu de r\u00e9daction'),
      // Bloc de signature classique : une ligne par partie.
      signataire: parties.length ? parties.join('\n') : MARQUEUR,
      // Variante d'une seule ligne, pour le bloc à deux colonnes du protocole amiable, où un
      // saut de ligne décalerait la colonne du locataire.
      signataireLigne: parties.length ? parties.join(' \u2014 ') : MARQUEUR,
      // `gerant` est FACULTATIF, et n'a pas de sens pour un bailleur particulier. Le reste
      // du code retombe déjà sur le nom de l'entité ; sans ce repli, chaque acte d'un
      // particulier ouvrirait un dialogue — et on lui apprendrait à cliquer « Continuer »
      // avant le jour où le dialogue dira « cet acte serait NUL ».
      gerant: ou(e.gerant || e.nom, 'signataire')
    })
  });
}

function _enrichContextCivilite(ctx) {
  if (!ctx || typeof ctx !== 'object') return ctx;
  const enriched = Object.assign({}, ctx);
  for (const key of ['locataire', 'garant']) {
    const p = ctx[key];
    if (!p || typeof p !== 'object') continue;
    const civ = String(p.civilite || '').trim();
    const civLong = civ === 'M.' ? 'Monsieur' : (civ === 'Mme' ? 'Madame' : '');
    const nom = String(p.nom || '').trim();
    enriched[key] = Object.assign({}, p, {
      // civNom : préfixe civilité (long) au nom. Si pas de civilité → juste le nom.
      civNom: p.civNom != null ? p.civNom : ((civLong ? civLong + ' ' : '') + nom).trim() || nom,
      // civSalut : formule d'appel ('Madame,' / 'Monsieur,' / 'Madame, Monsieur,' si genre inconnu)
      civSalut: p.civSalut != null ? p.civSalut : (civLong ? civLong + ',' : 'Madame, Monsieur,'),
      // civilitePolitesse : forme longue seule ('Monsieur' / 'Madame' / '' fallback)
      civilitePolitesse: p.civilitePolitesse != null ? p.civilitePolitesse : civLong
    });
  }
  return enriched;
}

/**
 * Génère un brouillon de mail pour un type donné + contexte.
 *
 * @param {string} type - Type d'email parmi _emailTypesSupportes()
 * @param {object} [context] - Données pour interpolation : { locataire, bail, logement, entite, quittance, montant, periode, ... }
 * @param {object} [opts]
 * @param {boolean} [opts.escapeHtml=false] - Si true, escape HTML les valeurs (utile pour aperçu HTML)
 * @returns {object} { to, cc, subject, body, attachments: [{name, type}], legalNote, error? }
 */
export function _emailCompose(type, context = {}, opts = {}) {
  const tpl = TEMPLATES[type];
  if (!tpl) {
    return {
      to: '',
      cc: '',
      subject: '(type inconnu)',
      body: `Erreur : type d'email "${type}" non supporté. Types disponibles : ${_emailTypesSupportes().join(', ')}.`,
      attachments: [],
      legalNote: '',
      error: 'TYPE_UNKNOWN'
    };
  }

  // v15.90 EM-3 — enrichit locataire + garant avec civNom, civSalut, civilitePolitesse
  let ctx = _enrichContextCivilite(context || {});
  // Les actes formels nomment leurs trous d'identité ; ici, et pas au cas par cas chez
  // les appelants — le Hub, l'escalade quittance et la modale d'actes passent tous par ici.
  if (acteFormel(type)) ctx = _enrichContextActe(ctx);
  const to = (ctx.locataire && ctx.locataire.email) || ctx.to || '';
  const cc = ctx.cc || '';

  const attachments = (tpl.attachments || []).map(a => ({
    name: _interpolateEmail(a.name, ctx, opts),
    type: a.type
  }));

  return {
    to,
    cc,
    subject: _interpolateEmail(tpl.subject, ctx, opts),
    body: _interpolateEmail(tpl.body, ctx, opts),
    attachments,
    legalNote: tpl.legalNote || ''
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Historique d'envoi (Phase 3) — DB.emailsSent[]
// ────────────────────────────────────────────────────────────────────────────

/**
 * Log un envoi d'email dans DB.emailsSent[]. Ne persiste PAS le body (RGPD :
 * limiter la rétention des données personnelles). Persiste uniquement les
 * métadonnées : type, destinataires, sujet, date, statut, entité liée.
 *
 * Side-effect : si le DB vivant existe (prod), append + window.saveDB() si dispo.
 * En tests sans DB, retourne juste l'entry construite (pas de persistance).
 *
 * @param {string} entityType - 'logement' | 'bail' | 'entite' | 'quittance' | etc.
 * @param {string} entityId - Référence de l'entité (log.ref, quittance.id, etc.)
 * @param {object} emailData - { type, to, cc, subject, status: 'proposed'|'mailto'|'copied'|'shared' }
 * @returns {object} L'entry créée (id, sentAt, type, to, cc, subject, status, entityType, entityId)
 */
export function _logEmailSent(entityType, entityId, emailData) {
  const data = emailData || {};
  const entry = {
    id: 'em_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    type: data.type || '',
    to: data.to || '',
    cc: data.cc || '',
    subject: data.subject || '',
    sentAt: new Date().toISOString(),
    status: data.status || 'proposed',
    entityType: entityType || '',
    entityId: entityId || ''
  };

  // Persistance dans le DB VIVANT. Avant : `window.DB`, un simple MIROIR posé par `__immoSetDB`
  // (chemin cloud, post-hydratation). Deux dégâts distincts :
  //  · session locale / sandbox — le miroir est `undefined`, tout le bloc était sauté :
  //    l'historique d'envoi n'était jamais écrit (et `saveDB()` pas même appelé) ;
  //  · cloud après réassignation de `DB` (import, restauration, adoption cross-onglet) — le miroir
  //    est périmé : l'entrée partait dans un objet mort, et le `saveDB()` qui suit persistait
  //    le DB vivant, donc un état SANS l'entrée.
  const _db = (typeof window !== 'undefined') ? appDbFrom(window) : null;
  if (_db) {
    if (!Array.isArray(_db.emailsSent)) _db.emailsSent = [];
    _db.emailsSent.push(entry);
    if (typeof window.saveDB === 'function') {
      try { window.saveDB(); } catch (_) { /* silent — saveDB peut être bloqué en mode read-only */ }
    }
  }

  return entry;
}

/**
 * Retourne l'historique d'envoi filtré par entityType + entityId.
 * Si pas de paramètres → retourne tout l'historique (copie).
 *
 * @param {string} [entityType]
 * @param {string} [entityId]
 * @param {Array} [emailsSent] - Liste à filtrer (par défaut DB.emailsSent du DB vivant, ou [])
 * @returns {Array}
 */
export function _getEmailHistory(entityType, entityId, emailsSent) {
  let list;
  const _db = (typeof window !== 'undefined') ? appDbFrom(window) : null;   // DB vivant, pas le miroir
  if (Array.isArray(emailsSent)) {
    list = emailsSent;
  } else if (_db && Array.isArray(_db.emailsSent)) {
    list = _db.emailsSent;
  } else {
    list = [];
  }

  if (!entityType && !entityId) return list.slice();

  return list.filter(e => {
    if (entityType && e.entityType !== entityType) return false;
    if (entityId && e.entityId !== entityId) return false;
    return true;
  });
}

