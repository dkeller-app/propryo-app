# Registre des traitements de données personnelles — ImmoTrack

**Version** : 1.1
**Date** : 2026-05-11 (maj 2026-06-08)
**Base légale** : Règlement (UE) 2016/679 art. 30 ("RGPD")
**Statut** : Modèle à compléter par chaque utilisateur ImmoTrack (responsable du traitement)

---

## Identité du responsable de traitement

| Champ | À compléter par l'utilisateur |
|---|---|
| Nom / Raison sociale | _ex : Didier Keller / SCI Mon Patrimoine_ |
| Adresse | _adresse complète_ |
| SIREN (si pro) | _le cas échéant_ |
| Email contact RGPD | _adresse email dédiée_ |
| DPO (si désigné) | _Non obligatoire si < 250 employés, sauf traitement sensible_ |

---

## Sous-traitants (art. 28 RGPD)

| Sous-traitant | Service | Localisation données | DPA signé | Référence |
|---|---|---|---|---|
| **Google Ireland Limited** | Stockage Drive (sync optionnelle) | UE + US (transferts encadrés clauses contractuelles types) | Oui — voir [DPA-GOOGLE-DRIVE.md](DPA-GOOGLE-DRIVE.md) | [Google Cloud DPA](https://cloud.google.com/terms/data-processing-addendum) |
| **Cloudflare, Inc.** | Relais à distance (Worker + KV ; pas de R2) — `bail-sign-relay` : transit temporaire (1) du bail le temps de la **signature**, (2) des **dépôts de candidature en ligne** (dossier + pièces) le temps de leur rapatriement, (3) **espace locataire** (traitement n°9) : page et API servies par le relais, **sans stockage** côté Cloudflare (les données restent dans Supabase ; seul un code de confirmation de 10 min peut transiter en KV) | KV mondial par défaut (répliqué multi-régions) ; restriction de juridiction UE recommandée | DPA standard Cloudflare (SCC) — à accepter dans le dashboard Cloudflare | [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/) |
| **Mistral AI** (France) | IA : transcription de la dictée de l'état des lieux (Voxtral), préparation des propositions (Mistral Small) et, pour l'état des lieux filmé, choix de photos parmi des **images** tirées de la vidéo sur l'appareil (Mistral Small 4, entrée image ; jamais la vidéo entière) ; circuit d'un incident (traitement n°10) : aide au signalement du locataire, constat de l'artisan, lecture d'une facture ou d'un devis ; **vérification des pièces des candidats** (traitement n°6) : lecture de la **première page** des bulletins de salaire et du contrat de travail par le modèle de lecture de documents (Mistral OCR, annotations structurées) sur le **point d'accès européen** api.eu.mistral.ai, à la demande du bailleur (interrupteur `AI_OCR` allumé après vérification de ce point d'accès le 16/10/2026) — appelée **uniquement par le relais** (clé jamais dans le navigateur) | Union européenne | Contrat de sous-traitance (DPA) Mistral à accepter ; **rétention zéro activée le 16/10/2026** sur les points d'accès sans état seulement (`/v1/ocr`, `/v1/audio/transcriptions`, `/v1/chat/completions`, les seuls qu'appelle le relais) ; **entraînement refusé** dans la console | [legal.mistral.ai](https://legal.mistral.ai) |
| **Resend** (Plus Five Five, Inc., San Francisco, États-Unis) — **inactif tant que `EMAIL_MODE="dev"`** | Envoi des e-mails transactionnels **par le relais seulement** (clé jamais dans le navigateur) : code de signature à distance (traitement n°5), invitation à l'espace locataire, avis « document disponible », « nouveau message », « signalement avancé » et code de l'accord de quittance électronique (traitement n°9), invitation de l'artisan (traitement n°10). Données transmises : adresse du destinataire, nom de la SCI ou du bailleur, contenu de l'e-mail (titre du document, statut, code à 6 chiffres valable 10 min, et **lien personnel** dans les invitations). Aucune pièce jointe. Suivi des ouvertures et des clics **désactivé** (sinon le lien personnel transiterait par le domaine de suivi) | **Envoi depuis la région UE** (eu-west-1, Irlande) ; **données du compte, métadonnées des e-mails, journaux et enregistrements des appels à l'API (donc le contenu envoyé) stockés aux États-Unis quelle que soit la région** (doc Resend « Regions », consultée le 15/10/2026). Conservation côté Resend : 30 jours (offre gratuite) | DPA Resend (mis à jour le 31/12/2025) : clauses contractuelles types 2021/914 (droit irlandais) + adhésion déclarée au **EU-US Data Privacy Framework** — à accepter / vérifier sur la liste officielle DPF à l'activation | [resend.com/legal/dpa](https://resend.com/legal/dpa) · [sous-traitants](https://resend.com/legal/subprocessors) · [régions](https://resend.com/docs/dashboard/domains/regions) |

**Envoi d'e-mails (Resend)** : chaque e-mail dit de la part de quel bailleur il est envoyé, pourquoi la personne le reçoit et à qui s'adresser pour ses données (le bailleur, responsable du traitement) ; il ne contient ni pièce jointe ni image ni pixel de suivi. Limites d'envoi côté relais : verrou de débit atomique par cible (10 par minute), puis compteurs par lien, par signataire, par compte, par destinataire (empreinte HMAC, 15 par jour) et plafond global du jour réparti en deux réserves (codes / avis) ; textes libres filtrés (pas de lien, d'adresse ni de numéro de téléphone repris dans un e-mail) ; aucune adresse, aucun code ni contenu dans les journaux du relais (type d'e-mail et statut seulement). Les rebonds et plaintes sont gérés par la liste de suppression automatique de Resend. **Point à arbitrer (D3)** : les e-mails d'invitation (espace locataire, artisan) portent le lien personnel ; Resend conserve les appels à l'API (donc ce lien) 30 jours aux États-Unis, alors que Propryo ne conserve le lien nulle part en clair. Options : accepter l'exception (liens révocables, « Renouveler » coupe l'ancien) et l'écrire dans l'AIPD, ou envoyer un lien d'amorce à usage unique (chantier à part). **Décision D12** (14/10/2026) : Resend pour la bêta ; comparaison avec **Brevo** (Sendinblue SAS, Paris ; données en France et en Belgique) à trancher avant le lancement public — l'hébergement des contenus aux États-Unis est le point défavorable de Resend.

**Important** : si vous activez la sync Drive, vous transférez vos données à Google. Si vos locataires ont saisi des données personnelles (nom, IBAN, email), informez-les via un avenant au bail ou un courrier ad hoc avant l'activation.

**Relais de signature** : lorsqu'un bail est envoyé en signature à distance, le PDF du bail (riche en données personnelles : noms, adresse, montants) et les preuves de signature (hash SHA-256 de l'email, téléphone, IP, user-agent, horodatages) transitent par Cloudflare. Données purgées automatiquement après **14 jours** (TTL KV ; pas de R2). KV étant répliqué mondialement par défaut, configurer la restriction de juridiction UE si la localisation des données dans l'UE est requise.

**Relais de candidature en ligne** : lorsqu'un bailleur invite un candidat à déposer son dossier en ligne (sans création de compte), le formulaire (identité, situation, garant) et les pièces justificatives téléversées transitent par le même relais Cloudflare (`bail-sign-relay`, stockage KV). Le lien candidat a une entropie de 256 bits (non devinable) ; le jeton de capacité bailleur (`ownerToken`) n'est **jamais** placé dans une URL ni journalisé. Données purgées automatiquement à l'expiration de l'invitation (**TTL KV = 7 / 14 / 30 jours** selon la durée choisie), après rapatriement dans l'app par le bailleur. Le rapatriement est **automatisé** (à l'ouverture de l'onglet Candidats, au retour de focus de la fenêtre, et toutes les 3 min) mais ne collecte **aucune donnée nouvelle** : il récupère uniquement ce que le candidat a volontairement déposé. Aucun score n'est calculé, ni côté relais ni dans l'app (score retiré en v15.731).

---

## Traitements

### 1. Gestion locative — Données des locataires

| Champ | Détail |
|---|---|
| **Finalité** | Exécution du contrat de bail (art. 6.1.b RGPD) + obligations légales (quittances, IRL, EDL) |
| **Catégories de personnes** | Locataires actuels + anciens locataires (durée du bail + 3 ans légaux ou 5 ans CRG mandataires) + garants |
| **Catégories de données** | Identité (nom, prénom, civilité, DDN, lieu naissance, adresse précédente), contact (téléphone, email), financier (IBAN si paiement SEPA — sinon non collecté), bail (loyer, charges, DG, durée, dates) |
| **Données sensibles** | Aucune (pas de données de santé, opinions politiques, etc.) |
| **Durée de conservation** | Pendant le bail + 3 ans après son terme (art. 2224 Code civil prescription civile commune) + 6 ans (art. L102B LPF pour mandataire Hoguet ou expert-comptable) |
| **Destinataires** | Responsable de traitement uniquement ; Google (si sync Drive) ; expert-comptable et avocat sur demande |
| **Transferts hors UE** | Si Drive : oui, vers les USA, encadrés par les clauses contractuelles types (SCC) Google |
| **Mesures techniques** | Chiffrement transport (HTTPS/TLS), chiffrement stockage (localStorage navigateur + Drive chiffré au repos), accès via OAuth Google (compte utilisateur unique) |

### 2. Suivi des bailleurs (entités juridiques + personnes physiques)

| Champ | Détail |
|---|---|
| **Finalité** | Gestion patrimoniale + déclarations fiscales (2044, 2072) + comptabilité |
| **Catégories de personnes** | Bailleurs particuliers (personnes physiques) + représentants de SCI/SAS (personnes physiques) |
| **Catégories de données** | Identité (nom, prénom, gérants pour SCI), juridique (SIREN, RCS, type juridique, statuts), bancaire (IBAN versement loyers + reversement honoraires si Hoguet) |
| **Durée de conservation** | Durée d'activité + 10 ans (obligation comptable art. L123-22 Code Commerce) |
| **Destinataires** | Responsable de traitement, expert-comptable, fisc (déclarations) |

### 3. Journal d'activité (Sprint 3A AUDIT-TRAIL)

| Champ | Détail |
|---|---|
| **Finalité** | Traçabilité des modifications pour CRG (Compte Rendu de Gestion mandataire) et conformité RGPD |
| **Catégories de personnes** | Utilisateurs de l'application (= responsable de traitement seul en V1) |
| **Catégories de données** | userId (UUID anonyme), userName (renseigné par utilisateur), timestamp, action, type d'entité modifiée, ref user-facing, diff (delta des champs modifiés, hors champs binaires) |
| **Durée de conservation** | Cap soft 10 000 entrées (~6 mois en usage régulier) puis prune des 5000 plus anciennes ; ou export CSV + purge manuelle via UI Paramètres |
| **Destinataires** | Responsable de traitement uniquement |

### 4. Photos d'état des lieux (EDL)

| Champ | Détail |
|---|---|
| **Finalité** | Preuve photographique de l'état du logement à l'entrée + sortie (obligation art. 3 loi 89-462 + décret 2016-382) |
| **Catégories de personnes** | Locataires (incidemment dans les photos si présents) |
| **Catégories de données** | Photos JPEG/PNG (pièces, compteurs, clés), dont les photos **tirées d'une vidéo** d'EDL (traitement n°8 : prise, instant, cadre conservés avec la photo) |
| **Durée de conservation** | Bail + 3 ans (preuve en cas de litige restitution DG) |
| **Stockage** | IndexedDB navigateur (`immotrack_photos`) puis **Supabase Storage** (bucket `espace-files`, chemin par SCI, RLS par SCI — migrations 0024/0031) ; Google Drive seulement si l'ancienne sync est activée. *(Corrigé le 14/10/2026 : la mention « IndexedDB + Drive » était périmée depuis le transfert cloud des photos d'EDL.)* |

### 5. Signature électronique à distance du bail (BAIL-SIGNATURE-DISTANCE)

| Champ | Détail |
|---|---|
| **Finalité** | Recueil de la signature électronique du bail à distance (loi ELAN ; niveau eIDAS « simple ») + constitution du dossier de preuve |
| **Catégories de personnes** | Signataires du bail : bailleur(s) et locataire(s) |
| **Catégories de données** | PDF du bail (identité, adresse, loyer, DG…), hash SHA-256 de l'email du signataire, téléphone, et preuves : hash SHA-256 du PDF signé, adresse IP, user-agent, horodatages ISO 8601 |
| **Données sensibles** | Aucune |
| **Base légale** | Exécution du contrat (art. 6.1.b RGPD) + intérêt légitime à la valeur probante (art. 6.1.f) |
| **Durée de conservation** | **Côté relais Cloudflare** : éphémère — 14 j (TTL KV), le temps de la signature uniquement. **Côté ImmoTrack** : bail signé + dossier de preuve conservés avec le bail (durée du bail + 3 ans, cf. traitement n°1) |
| **Destinataires** | Responsable de traitement ; Cloudflare (sous-traitant, transit temporaire) ; Resend (sous-traitant : envoi du code de vérification à l'adresse déjà connue du signataire, quand `EMAIL_MODE="resend"`) |
| **Transferts hors UE** | Possible via Cloudflare (KV répliqué mondialement) — encadré par les SCC du DPA Cloudflare ; restriction de juridiction UE recommandée. Resend (États-Unis) à l'activation des e-mails : SCC + DPF |
| **Mesures techniques** | sessionId 256 bits non devinable ; jetons HMAC-SHA256 (jamais dans l'URL) ; comparaison à temps constant des secrets ; HTTPS/TLS ; chiffrement KV au repos ; purge automatique (TTL) ; signature ordonnée (machine à états anti-rejeu) |
| **Anti-transfert (V1)** | Le lien de signature est livré uniquement à l'email du signataire ; vérification de l'adresse à l'ouverture puis code à 6 chiffres (10 min, 5 essais) : affiché à l'écran en mode test, **envoyé par e-mail** quand `EMAIL_MODE="resend"` ; obligatoire avant la signature quand `OTP_REQUIRED="true"`. Limites : 5 codes par heure et 10 par jour pour un signataire, 20 par jour pour le compte qui crée les sessions, 10 adresses refusées par heure et par IP (anti-oracle) ; nom du bailleur facultatif enregistré sur la session (« De la part de … ») |

### 6. Candidatures locataires (sélection du locataire)

| Champ | Détail |
|---|---|
| **Finalité** | Examen des dossiers de candidature en vue de sélectionner un locataire pour un logement vacant (mesures précontractuelles prises à la demande de la personne) ; **vérification de l'authenticité des pièces** déposées (prévention de la fraude documentaire) : signature 2D-Doc, informations techniques des fichiers, cohérence des bulletins de salaire, existence de l'employeur (VERIF-DOCUMENTS, v15.741) ; **comparaison des dossiers d'un même logement** par le bailleur, critère par critère (AIDE-DECISION, v15.755) |
| **Canal de collecte** | (a) **Saisie manuelle** par le bailleur dans l'app ; (b) **Dépôt en ligne par le candidat** via un lien sécurisé sans compte (relais Cloudflare `bail-sign-relay`) : le candidat remplit le formulaire et téléverse ses pièces, qui transitent par le relais (KV) puis sont **rapatriées automatiquement** dans l'app par le bailleur (déclencheurs : ouverture de l'onglet Candidats, retour de focus, intervalle 3 min) — le rapatriement automatisé **ne collecte aucune donnée nouvelle**, il récupère ce que le candidat a volontairement déposé |
| **Catégories de personnes** | Candidats locataires + leurs garants |
| **Catégories de données** | Identité (nom, prénom, civilité, DDN), contact (téléphone, email), situation (revenus mensuels, type de contrat CDI/CDD/autre, employeur et SIREN/SIRET facultatif), garant (nom, situation), pièces justificatives **limitées à la liste autorisée** par le décret n° 2015-1437 du 5 novembre 2015 (justificatif d'identité, de domicile, d'activité professionnelle, de ressources). **Résultats de vérification** posés sur chaque pièce : état de la signature 2D-Doc et données signées **utiles seulement** (nom des déclarants, revenu fiscal de référence, nombre de parts, année, référence d'avis et numéro fiscal pour le service manuel d'impots.gouv — jamais l'adresse) ; informations techniques du PDF (logiciels, dates, nombre d'enregistrements) ; pour les bulletins lus par l'IA : période, montants, employeur, SIRET, dates, et corrections du bailleur. Aucune pièce supplémentaire n'est demandée pour vérifier |
| **Données INTERDITES** | Conformément à l'art. 22-2 de la loi n° 89-462 du 6 juillet 1989, ne sont jamais demandées : photo (hors pièce d'identité), copie de carte vitale, relevés de compte, attestation d'absence de crédit, etc. **Le RIB/IBAN n'est PAS collecté au stade candidature** — il l'est uniquement à la signature du bail (cf. traitement n°1) |
| **Données sensibles** | Aucune |
| **Base légale** | Mesures précontractuelles prises à la demande de la personne concernée (art. 6.1.b RGPD) pour l'examen du dossier ; **intérêt légitime** du bailleur (art. 6.1.f) pour la vérification d'authenticité des pièces — **à valider par l'avocat** (avec mise en balance et droit d'opposition, mentionné dans l'information du candidat) |
| **Profilage / décision automatisée** | **Aucun score, aucun classement, aucun refus automatique** (le « score de confiance » a été retiré en v15.731 ; le champ stocké des anciens dossiers n'est plus ni lu ni écrit). **Comparaison des dossiers (v15.755)** : critères objectifs côte à côte, calculés par des règles fixes (pas d'IA) — dossier complet (liste du décret), un mot pour l'état des pièces (sans compte ni tri), taux d'effort = loyer charges comprises ÷ ressources nettes déclarées, allocations comprises (Défenseur des droits, « Louer sans discriminer », 2025), garantie ; aucune pondération, aucun total ; ordre par défaut = date de réception, tri au choix du bailleur sur les dates et le taux d'effort seulement ; repère du taux d'effort fixé par le bailleur (aucun par défaut, le même pour tous les dossiers ; réglage du compte, aucune donnée nouvelle sur le candidat) ; valider ou refuser se fait dossier par dossier, dans la fiche. Le candidat en est informé sur la page de dépôt. Les vérifications produisent des **constats factuels sourcés et datés** (« signature valide / non conforme / absente », « le net à payer ne correspond pas au net avant impôt moins l'impôt prélevé », « fichier modifié après sa création — ne permet pas de conclure »), présentés pièce par pièce, sans total ni couleur de verdict ; la décision reste humaine (art. 22 RGPD ; CJUE C-634/21). L'IA ne fait que **recopier** des valeurs (« proposé par l'IA, à vérifier », corrigeables, journal d'audit) ; les règles sont écrites (Code du travail R3243-1, arrêté du 25/02/2016). AI Act : analyse « pas à haut risque » (art. 6(3) a et d : extraction préparatoire, aucune évaluation de solvabilité ni profilage ; exception « détection de la fraude financière » de l'annexe III 5(b)) **à documenter et à faire valider par l'avocat** |
| **Durée de conservation** | **Candidat refusé** : 30 jours après la **date du refus**, puis effacement réel (fiche, pièces, **résultats de vérification**, binaires IndexedDB, fichiers du bucket `espace-files`, copie du relais ; ligne cloud réécrite sans donnée personnelle) au démarrage et à l'ouverture de l'onglet Candidats (v15.731). Un dossier refusé n'est plus jamais relu ni envoyé à l'IA. **Candidat retenu** : converti en locataire → les pièces et leurs résultats de vérification rejoignent le dossier du bail (traitement n°1). **Côté relais (dépôt en ligne)** : dossier déposé + pièces éphémères — purge automatique à l'expiration de l'invitation (TTL KV = 7/14/30 j selon la durée choisie), après rapatriement par le bailleur. **Mistral AI** (lecture des bulletins) : le contenu (image, texte lu) n'est pas conservé (rétention zéro activée le 16/10/2026, point d'accès sans état `/v1/ocr`), aucun entraînement ; Propryo ne garde pas l'image envoyée |
| **Destinataires** | Responsable de traitement (le bailleur) et associés de la SCI concernée (partage) ; **Cloudflare** (sous-traitant : transit temporaire du dépôt en ligne ; transport des listes publiques de certificats 2D-Doc, sans donnée personnelle) ; **Supabase** (hébergement, Irlande) ; **Mistral AI** (sous-traitant : lecture de la première page des bulletins et du contrat de travail, **seulement si le bailleur l'active et la lance**). L'API publique Recherche d'entreprises (annuaire de l'État) reçoit le SIREN/SIRET de l'employeur, rien d'autre. La vérification 2D-Doc et les indices techniques sont faits **sur l'appareil** du bailleur : aucun envoi |
| **Transferts hors UE** | **Dépôt en ligne** : transit via Cloudflare KV (répliqué mondialement) — encadré par les SCC du DPA Cloudflare ; restriction de juridiction UE recommandée. **Lecture IA** : point d'accès européen de Mistral imposé (`MISTRAL_OCR_BASE_URL`, par défaut api.eu.mistral.ai) ; plan de contrôle de Mistral (compte, facturation) possiblement hors UE selon sa documentation — à vérifier dans le DPA. La sync Drive est retirée |
| **Mesures techniques** | Aucun score ; purge réelle des refusés à 30 j après le refus ; isolation des données de test ; chiffrement transport (HTTPS/TLS) et stockage au repos ; RLS par SCI. **Dépôt en ligne** : lien candidat 256 bits non devinable ; `ownerToken` jamais placé dans une URL ni journalisé ; rapatriement automatisé sans collecte de donnée nouvelle. **Vérification des pièces** : contrôle 2D-Doc par WebCrypto contre 7 autorités **ancrées** dans le code (liste de confiance France Titres n° 23, empreintes SHA-256 testées), révocation obligatoire (aucun « valide » sans liste de révocation fraîche) ; minimisation (pièce d'identité jamais lue ; seuls les champs utiles conservés ; seule la page 1 des bulletins et du contrat part à l'IA, à la demande) ; journaux du relais sans contenu (testé) ; quota d'images par compte. **AIPD** : à mener avec l'avocat avant l'ouverture publique (données financières de tiers, usage innovant de l'IA, croisement de sources) |

### 7. Dictée de l'état des lieux assistée par IA (EDL-VOIX-IA)

| Champ | Détail |
|---|---|
| **Finalité** | Aider à remplir l'état des lieux : un commentaire oral d'une pièce est transcrit, puis une IA **propose** un état et une observation par élément cité. Rien n'entre dans l'EDL sans validation humaine, élément par élément ; l'EDL reste contradictoire et signé par les parties (« l'IA lit, la loi décide ») |
| **Catégories de personnes** | Utilisateur qui dicte (bailleur, gestionnaire, agent) ; incidemment le locataire ou toute personne présente dont la voix serait captée |
| **Catégories de données** | Enregistrement audio de la dictée (voix) ; transcription ; propositions (état, observation, extrait entendu) ; marque lisible par machine sur les valeurs acceptées (`iaE` / `iaS` / `compteursIA` : booléens, horodatage, modèle) ; compteurs de consommation par compte (appels, secondes d'audio, jetons — **sans aucun contenu**) |
| **Données sensibles** | Aucune attendue. La notice demande de prévenir les présents et d'éviter de citer des informations personnelles ; la consigne donnée au modèle interdit d'en reporter dans les observations |
| **Base légale** | Exécution du service souscrit par l'utilisateur (art. 6.1.b) ; pour la voix d'un tiers présent : intérêt légitime à établir l'EDL (art. 6.1.f), avec information préalable (notice) |
| **Durée de conservation** | **Audio** : jamais conservé — gardé sur l'appareil seulement le temps de l'envoi (file d'attente hors ligne en IndexedDB), supprimé dès la transcription réussie ; s'il ne peut pas partir (hors ligne, service indisponible, rien entendu), il reste sur l'appareil jusqu'à l'envoi ou sa suppression par l'utilisateur, 30 jours au plus (purge automatique) ; le relais ne le stocke pas. **Transcription et propositions** : sur l'appareil le temps de la relecture, puis effacées. **Valeurs validées** : avec l'EDL (traitement n°4). **Fournisseur** : rétention zéro (décision du 13/10/2026, activée sur le compte Mistral le 16/10/2026, points d'accès sans état `/v1/audio/transcriptions` et `/v1/chat/completions`), aucun entraînement. **Compteurs de consommation** : 48 h (quota du jour) et 400 jours (suivi mensuel), sans contenu |
| **Destinataires** | Responsable de traitement ; Cloudflare (relais, transit) ; Mistral AI (sous-traitant) |
| **Transferts hors UE** | Aucun prévu : Mistral AI héberge dans l'UE. Transit par le relais Cloudflare (cf. sous-traitants) |
| **Profilage / décision automatisée** | Aucun : propositions soumises à validation humaine une par une ; aucun score |
| **Transparence (AI Act art. 50)** | Mention « Proposé par l'IA, à vérifier » sur chaque proposition ; notice à la première utilisation ; mention discrète dans le PDF signé si au moins une proposition a été acceptée ; marquage lisible par machine |
| **Mesures techniques** | Clé du fournisseur en secret du relais, jamais dans le navigateur ; routes authentifiées (JWT Supabase) ; taille et type de l'audio contrôlés ; quota par compte et par jour ; sortie du modèle validée (éléments de la liste, états autorisés, extrait réellement entendu) ; **journaux sans contenu** (vérifié par test) ; aucune écriture sur un EDL signé |
| **AIPD** | **Recommandée** (voix captée au domicile, IA) — à réaliser avec l'avocat avant l'ouverture commerciale |

### 8. État des lieux filmé (vidéo + IA) — EDL-VIDEO-IA

> **Fonction ÉTEINTE en production** tant que le relais n'a pas `AI_VIDEO=true` (bêta sur offres gratuites, décision du 14/10/2026). Ce traitement s'applique dès son activation.

| Champ | Détail |
|---|---|
| **Finalité** | Garder une **preuve** de l'état du logement (vidéo d'une pièce commentée, pièce de l'état des lieux) et **aider** à la rédaction : la voix suit le traitement n°7 ; des images tirées de la vidéo sur l'appareil sont analysées pour **proposer** des photos par élément (jamais d'état ni de responsabilité). Rien n'entre dans l'EDL sans validation humaine ; l'EDL reste contradictoire et signé |
| **Catégories de personnes** | Bailleur / associé qui filme ; **locataires présents** (accord préalable) ; incidemment toute personne présente (consigne : ne pas filmer les personnes ; le modèle signale les images où une personne apparaît) |
| **Catégories de données** | Vidéo (image et son, au domicile) ; images tirées de la vidéo (≤ 1 024 px) ; photos gardées (traitement n°4) avec prise, instant et cadre ; **accords horodatés** (nom, date, heure, version du texte, représentant éventuel) ; empreinte SHA-256 de chaque vidéo ; registre `edl_medias` (chemin, taille, durée, pièce, scellé, échéance, gel) ; compteurs d'images analysées par compte (sans contenu) |
| **Données sensibles** | Aucune attendue ; l'intérieur d'un domicile est une donnée à caractère hautement personnel (critère d'AIPD) |
| **Base légale** | **Intérêt légitime** à la preuve de l'état du logement (art. 6.1.f), avec **accord préalable de chaque locataire présent** (case non pré-cochée, cochée par lui ; le représentant d'un locataire représenté coche pour lui), horodaté dans l'EDL ; refus = pas de vidéo, l'EDL se fait à la voix ou à la main. **À faire valider par l'avocat dans l'AIPD** |
| **Durée de conservation** | **Vidéo** (pièce de l'EDL) : pendant le bail, puis jusqu'à la fin de la 3e année qui suit la **restitution du dépôt de garantie** (art. 7-1 loi n° 89-462 ; CNIL délibération n° 2021-057 § 53), à défaut de date de restitution : fin du bail + 2 mois (art. 22) + 3 ans ; jamais moins de 3 ans après la signature de l'EDL (garde en base) ; **prolongeable** en cas de litige (CNIL § 54) ; **purge automatique** à échéance par tâche serveur planifiée, alerte « Ce qui presse » 30 jours avant. **Copie locale** de la vidéo : sur l'appareil jusqu'à l'envoi réussi, puis effacée. **Images tirées de la vidéo** : sur l'appareil le temps de la relecture, puis effacées (seules les photos gardées restent, traitement n°4). **Fournisseur** : idem traitement n°7 (rétention zéro activée le 16/10/2026, point d'accès sans état `/v1/chat/completions`) |
| **Destinataires** | Responsable de traitement ; associés de la SCI selon leurs droits (RLS) ; Supabase (stockage UE) ; Cloudflare (relais : transit des images et du son, jamais de la vidéo) ; Mistral AI (images et son seulement). **Locataire** : copie de la vidéo **sur demande** (mention dans le PDF), puis via l'espace locataire (chantier à venir) |
| **Transferts hors UE** | Aucun prévu (Supabase et Mistral : UE ; transit relais Cloudflare, cf. sous-traitants) |
| **Profilage / décision automatisée** | Aucun : photos proposées, gardées ou écartées par l'humain ; aucun état proposé par l'image ; aucun score |
| **Transparence (AI Act art. 50)** | Écran d'accord avant de filmer ; mention « Proposé par l'IA, à vérifier » ; mention étendue au PDF signé (« aide à la dictée et à l'image ») ; cadre « Vidéos de l'état des lieux » du PDF (pièce, durée, date, empreinte, accord, conservation) |
| **Mesures techniques** | Vidéo jamais envoyée à l'IA ; images ≤ 8 par appel, quota d'images par compte et par jour ; envoi reprenable (TUS) sans écrasement ; chemin par SCI et RLS (0031) ; **scellé** à la signature : ni suppression ni écrasement de la vidéo (table et stockage, migration 0058) ; échéance jamais avancée ; journaux sans contenu ; empreinte SHA-256 dans l'instantané signé |
| **AIPD** | **Obligatoire à réaliser avant l'activation** (critères CNIL délibération 2021-057 § 74-75 : données à caractère hautement personnel — intérieur du domicile, image et voix —, usage innovant d'une IA) : à faire avec l'avocat ; elle couvre aussi la dictée (traitement n°7) |

### 9. Espace locataire par lien, sans mot de passe (ESPACE-LOCATAIRE, migration 0059)

| Champ | Détail |
|---|---|
| **Finalité** | Mettre à disposition du locataire (chaque colocataire séparément) les documents de SON bail (bail et avenants signés, états des lieux signés, quittances, décomptes de charges et justificatifs), recueillir son accord pour la quittance électronique (art. 21 loi n° 89-462), lui permettre de signaler un problème dans le logement et d'échanger avec le bailleur |
| **Canal de collecte** | Lien personnel `…/l#<jeton>` transmis par le bailleur (fenêtre d'envoi, ou e-mail quand l'envoi sera actif). Aucun compte, aucun mot de passe. Le jeton (256 bits) est dans le fragment de l'URL : jamais envoyé au serveur dans l'URL, jamais journalisé |
| **Catégories de personnes** | Locataires et colocataires ; bailleur et associés de la SCI (auteurs des réponses, affichés sous le nom du bailleur) |
| **Catégories de données** | Nom du locataire (copie pour l'affichage), adresse du logement, nom du bailleur ; documents du bail (déjà détenus par le bailleur) ; accord quittance électronique (date, version du texte, retrait) ; signalements (pièce, nature, urgence, description, photos — ré-encodées dans le navigateur, ce qui retire les métadonnées GPS) ; messages et pièces jointes ; **journal minimal** : date de dernière visite (au plus une écriture par heure). Côté relais : condensat d'adresse IP salé du jour pour limiter les jetons invalides (jamais l'IP en clair, effacé après 24 h) |
| **Données sensibles** | Aucune attendue |
| **Base légale** | Exécution du contrat de bail (art. 6.1.b) et obligations légales (art. 6.1.c : quittance art. 21, justificatifs de charges art. 23 loi n° 89-462). Transmission électronique de la quittance : **accord exprès** du locataire (case non pré-cochée, horodatée, retirable) |
| **Profilage / décision automatisée** | Aucun |
| **Durée de conservation** | **Accès par le lien** : tout le bail ; puis jusqu'à la clôture des comptes (documents, messages) ; puis 6 mois de consultation des documents seuls ; plafond fin du bail + 14 mois (art. 22 et 23 loi n° 89-462 ; CNIL, délibération n° 2021-057). **Données** : chez le bailleur, avec le dossier du bail (traitement n°1). Ouvertures de fichiers et tentatives invalides : supprimées au fil de l'eau une fois âgées de plus de 24 h (à chaque nouvelle ouverture ou tentative ; une purge planifiée reste à mettre en place) |
| **Destinataires** | Le locataire concerné (ses seuls documents, messages, signalements) ; le bailleur et les associés de la SCI selon leurs droits (RLS par SCI) ; Supabase (hébergement, UE) ; Cloudflare (relais, transit sans stockage) ; Resend (sous-traitant, envoi des e-mails : invitation, avis, code de l'accord — **actif seulement quand `EMAIL_MODE="resend"`**, cf. sous-traitants) |
| **Transferts hors UE** | Aucun stockage hors UE prévu. Transit par le relais Cloudflare (DPA, SCC) ; Resend (États-Unis) à l'activation des e-mails, encadré par SCC / DPF |
| **Mesures techniques** | Jeton tiré dans le navigateur du bailleur, **seule son empreinte SHA-256 est stockée** (table sans aucune lecture possible) ; révocation et renouvellement immédiats ; le relais n'a **aucune clé de service** : identité technique limitée aux fonctions `el_*`, qui filtrent par bail et par accès (simulation d'isolation : un locataire ne voit rien d'un autre locataire, d'un autre lot ni d'une autre SCI) ; fichiers lisibles seulement 60 s après autorisation ; dépôts limités (JPEG, PNG, PDF ; 10 Mo ; octets vérifiés) ; en-têtes CSP sans source externe, `no-referrer`, `no-store`, `noindex` ; limite des jetons invalides (20 / heure / IP) et plafonds d'écriture ; aucun traceur ni mesure d'audience ; la qualification juridique d'un incident (« qui paie ») n'est montrée au locataire qu'**après la validation du bailleur** (résultat expliqué, textes cités — traitement n°10) |

### 10. Circuit d'un incident : signalement aidé par l'IA, intervention d'un artisan par lien (INCIDENT-CIRCUIT, migration 0060)

| Champ | Détail |
|---|---|
| **Finalité** | Faire réparer le logement (obligation du bailleur, art. 6 c loi n° 89-462) : aider le locataire à décrire un problème, prévenir un artisan, organiser le rendez-vous, recevoir devis, constat et facture, établir à la fin qui paie selon la loi et enregistrer la dépense |
| **Canal de collecte** | Espace locataire (traitement n°9) : dictée ou texte, photos, accord pour le téléphone, accès, présences ; **lien de l'artisan** `…/a#<jeton>` (sans compte) : créneau, devis, facture, photos, constat ; app du bailleur : carnet d'artisans, plafond, validation |
| **Catégories de personnes** | Locataires ; artisans (entreprises et entrepreneurs individuels) ; bailleur et associés de la SCI |
| **Catégories de données** | **Transmises à l'artisan (minimisées, D13)** : adresse et accès du logement, prénom et nom du locataire, **son téléphone seulement s'il a coché l'accord**, présences, description et photos du problème, plafond d'intervention. Jamais le bail, le loyer, les autres biens ni « qui paie ». **Artisans** (carnet, table `artisans`) : nom de l'entreprise, SIRET, métiers, téléphone, e-mail, adresse, note privée du bailleur (visible de la SCI et de ses associés seulement, jamais publiée ni partagée entre comptes). **Dépôts de l'artisan** : devis, facture, photos, constat neutre, créneau. **IA** : voix (transcription), texte, jusqu'à 3 photos réduites (locataire) ; texte (artisan) ; pages de facture ou de devis (bailleur) |
| **Données sensibles** | Aucune attendue |
| **Base légale** | Exécution du contrat de bail (art. 6.1.b) et obligation d'entretien du bailleur (art. 6 c loi n° 89-462) ; intérêt légitime du bailleur pour le carnet d'artisans (art. 6.1.f) ; **consentement** du locataire pour la transmission de son téléphone (case non pré-cochée) ; accès des lieux et créneau un samedi, un dimanche ou un jour férié : **accord exprès** du locataire (art. 7 e) |
| **Profilage / décision automatisée** | Aucun. L'IA reformule et propose (résumé, élément, constat, lecture de facture) : le locataire, l'artisan puis le bailleur confirment ; le payeur est établi par un moteur de règles sourcé et **validé par le bailleur** ; aucun score sur une personne ; les entreprises suggérées sont **listées** selon des faits publics (métier, activité, distance, RGE, ancienneté, déjà utilisée), sans avis ni recommandation |
| **Transparence (AI Act art. 50)** | Mention avant toute dictée (« assistant automatique… Proposé par l'IA, à vérifier ; voix non conservée ») sur les pages du locataire et de l'artisan ; propositions marquées « Proposé par l'IA, à vérifier » |
| **Durée de conservation** | **Lien de l'artisan** : actif jusqu'à 30 jours après la validation du bailleur, **90 jours au plus** après son émission ; révocable à tout moment. **Données** : avec le dossier de l'incident (pièces du dossier de preuves) et du bail (traitement n°1) ; carnet d'artisans tant que la structure l'utilise (suppression par le bailleur) ; ouvertures de fichiers supprimées au-delà de 24 h. **Voix et images envoyées à l'IA** : non conservées par Propryo après traitement |
| **Destinataires** | L'artisan choisi (sa seule demande et ses dépôts) ; le locataire (suivi, puis résultat expliqué après validation) ; le bailleur et les associés selon leurs droits (RLS par SCI) ; Supabase (UE) ; Cloudflare (relais, transit) ; Mistral AI (sous-traitant, UE) ; Resend (sous-traitant : e-mail d'invitation de l'artisan, quand `EMAIL_MODE="resend"`) ; **Base adresse nationale** (adresse du logement seule, pour obtenir sa position) ; **API publiques de l'État et de l'ADEME** (recherche d'entreprises, liste RGE) : seuls un code d'activité et cette position leur sont envoyés. Aucun nom ni coordonnée de personne n'est envoyé à ces services |
| **Transferts hors UE** | Aucun stockage hors UE prévu (transit relais Cloudflare, DPA, SCC). Resend (États-Unis) à l'activation des e-mails : SCC + DPF |
| **Mesures techniques** | Jeton de l'artisan tiré dans le navigateur du bailleur, **empreinte seule** stockée ; identité technique du relais limitée aux fonctions `ar_*` et `el_*` ; rattachements du lien **déduits de l'incident** (jamais du navigateur) ; photos de la demande limitées à la SCI de l'incident ; fichiers lisibles 60 s après autorisation ; dépôts contrôlés (types, 10 Mo, 40 / 24 h, 30 documents par lien) ; **plafond figé sur le lien et décision du devis par la base** ; quota d'IA par lien et par compte ; simulation d'isolation SQL (0060) ; journaux sans contenu |
| **AIPD** | À joindre à celle de l'espace locataire et de la dictée (traitements n°7 à 9), avec l'avocat, avant l'ouverture publique |

### 11. Mesure de la mise en route pendant la bêta (PREMIERS-PAS, sans migration) — **Propryo responsable de traitement**

| Champ | Détail |
|---|---|
| **Finalité** | Mesurer la prise en main de Propryo pendant la bêta privée (combien de comptes finissent la mise en route, en combien de temps, quelles étapes bloquent) et améliorer le parcours d'accueil |
| **Responsable** | Propryo (éditeur), pour ses propres besoins — et non le bailleur utilisateur |
| **Catégories de personnes** | Titulaires de compte Propryo (bailleurs, testeurs de la bêta) |
| **Catégories de données** | Dans les données du compte seulement (`DB.params.premiersPas`, blob privé `espace_config_private`, membres pleins de l'espace) : date de première évaluation, état de la visite guidée (proposée, en cours, passée, terminée, nombre de relances), **date à laquelle chaque étape de mise en route a été constatée faite** (logement, bail, relevé bancaire, règle d'import, espace du locataire, plafond, artisan, associé), date de fin, liste masquée ou non. **Aucun clic, aucune page vue, aucun appareil, aucune adresse IP, aucune donnée de locataire ou de candidat** |
| **Base légale** | Intérêt légitime de Propryo (art. 6.1.f) : améliorer un service en bêta, avec un traitement minimal et sans traceur |
| **Information** | Phrase dans Paramètres › Mon profil (« Propryo enregistre dans le compte les étapes de mise en route faites et leur date, pour mesurer la prise en main pendant la bêta. Aucun outil de mesure extérieur… ») ; politique de confidentialité ; information des testeurs à leur entrée dans la bêta |
| **Opposition (art. 21)** | Case « Partager la progression de mise en route avec Propryo » (cochée par défaut) dans Mon profil : décochée, les dates des étapes déjà enregistrées sont **effacées** (ainsi que la date de première évaluation et le nombre de relances) et plus aucune n'est enregistrée ; ne restent que ce qui sert à l'affichage : liste masquée ou réaffichée, état de la visite, date de fin de la mise en route (repli automatique de la liste 7 jours après) |
| **Traceurs** | Aucun outil d'analyse ni traceur tiers ; aucun cookie ; rien n'est déposé sur l'appareil au-delà du miroir local de la base, nécessaire au fonctionnement de l'app |
| **Destinataires** | Propryo (pilotage) par une requête en lecture seule (`scripts/premiers-pas-stats.mjs`) ; Supabase (hébergement UE) |
| **Durée de conservation** | Durée du compte ; **purge 12 mois après la fin de la bêta** (suppression de `premiersPas` des comptes) |
| **Transferts hors UE** | Aucun |

---

## Droits des personnes concernées (art. 15-22 RGPD)

Les locataires peuvent exercer :

- **Droit d'accès** (art. 15) : copie des données les concernant. Procédure : email au responsable de traitement, réponse sous 1 mois.
- **Droit de rectification** (art. 16) : correction des données inexactes (nom, email, etc.).
- **Droit à l'effacement** (art. 17) : suppression à la fin du bail + délais légaux (cf durées de conservation supra).
- **Droit à la portabilité** (art. 20) : récupération des données dans un format structuré (JSON via export ImmoTrack > Paramètres > "Mes données").
- **Droit d'opposition** (art. 21) : refus du traitement (sauf base légale contractuelle qui prime).

**Procédure recommandée** : créer un email type "rgpd@<votre-domaine>" ou utiliser une adresse dédiée. Tracer toutes les demandes dans `DB.auditTrail` (action='rgpd_request').

---

## Notification de violation (art. 33-34)

En cas de fuite de données (vol device + Drive non chiffré local, compromission compte Google, etc.) :
1. **Dans les 72 heures** : notification à la CNIL via le portail [https://www.cnil.fr/fr/notifier-une-violation-de-donnees-personnelles](https://www.cnil.fr/fr/notifier-une-violation-de-donnees-personnelles)
2. **Si risque élevé** : information des locataires concernés (lettre ou email).

---

## Mesures de sécurité techniques

| Risque | Mesure |
|---|---|
| Vol device | Chiffrement disque OS (BitLocker/FileVault) + verrouillage session |
| Compromission Drive | 2FA obligatoire sur le compte Google ; révocation token via [myaccount.google.com/security](https://myaccount.google.com/security) |
| Quota localStorage dépassé | Photos en IndexedDB (pas en localStorage) ; cap auditTrail 10k entrées |
| XSS | Helpers `escHtml` / `_h` / `_raw` (cf Sprint 1A SECU-INNERHTML) — neutralisent injections HTML dans données user |
| Backup | Sync Drive optionnelle + export JSON manuel via Paramètres |

---

## Mises à jour de ce registre

À actualiser à chaque modification :
- Ajout d'un sous-traitant (Stripe, Sentry, etc.)
- Nouveau type de traitement (multi-user, portail locataire, etc.)
- Changement de durée de conservation

**Dernière mise à jour** : 2026-10-17 (sous-traitant **Mistral AI** et traitements n°6, 7 et 8 : **rétention zéro activée le 16/10/2026** sur les points d'accès sans état `/v1/ocr`, `/v1/audio/transcriptions`, `/v1/chat/completions`, entraînement refusé ; lecture des bulletins `AI_OCR` allumée, v15.761). Précédente : 2026-10-16 (traitement n°6 : **comparaison des dossiers d'un même logement** — critères objectifs sans note ni classement, taux d'effort sur toutes les ressources, repère fixé par le bailleur, information du candidat ; à verser dans l'AIPD). Précédente : 2026-10-15 (traitement n°11 **mesure de la mise en route pendant la bêta** — Propryo responsable, intérêt légitime, opposition dans Mon profil, aucun traceur, purge 12 mois après la bêta). Précédente : 2026-10-15 (sous-traitant **Resend** inscrit — envoi des e-mails transactionnels par le relais, inactif tant que `EMAIL_MODE="dev"` ; région d'envoi UE, données du compte aux États-Unis, SCC + DPF ; traitements n°5, 9 et 10 mis à jour ; limites d'envoi et journaux sans donnée personnelle). Précédente : 2026-10-14 (traitement n°6 **mis à jour** — retrait du « score de confiance » et de la sync Drive (périmés depuis v15.731), ajout de la **vérification des pièces** (2D-Doc sur l'appareil, indices techniques, lecture IA des bulletins par Mistral OCR sur le point d'accès européen, à la demande), base légale proposée (intérêt légitime, à valider), AIPD à mener ; Cloudflare : KV seulement, pas de R2) ; 2026-10-14 (traitement n°9 **espace locataire par lien** ; Cloudflare : rôle (3) sans stockage ; Resend à inscrire à l'activation des e-mails) ; 2026-10-14 (traitement n°8 **état des lieux filmé** — éteint en production jusqu'à activation ; AIPD obligatoire avant activation ; traitement n°4 corrigé : photos d'EDL dans Supabase Storage). Précédente : 2026-10-13 (traitement n°7 **dictée de l'EDL assistée par IA** + sous-traitant **Mistral AI** ; AIPD recommandée). Précédente : 2026-06-08 (traitement n°6 étendu — **canal de dépôt en ligne** via relais Cloudflare : TTL invitation 7/14/30 j, `ownerToken` hors URL, score jamais calculé/transmis côté relais ; **rapatriement automatisé** documenté — aucune donnée nouvelle collectée ; Cloudflare ajouté aux sous-traitants/destinataires des candidatures)
**Mainteneur** : responsable de traitement ImmoTrack
