/**
 * ImmoTrack — Bootstrap modulaire ES (Sprint 2 ARCHI-MODULAR)
 *
 * Ce fichier sera progressivement enrichi au fur et à mesure des phases :
 *   Phase 0 (v14.85) : skeleton (ici) — CSS extrait dans css/main.css
 *   Phase 1 (v14.86) : import core/{db,drive,idb,utils}.js
 *   Phase 2 (v14.87) : import components/{modal,toast,signature,charts}.js
 *   Phase 3 (v14.88+): tabs/* migrés un par un
 *   Phase 4 (v14.95) : cleanup index-test.html ne contient plus que la coquille HTML
 *
 * Compatibilité : ce fichier est chargé via <script type="module"> à la fin du
 * <body>. ⚠️ Les ES modules nécessitent un http-server (file:// CORS-bloqué).
 * Pour dev local : `npx http-server . -p 8766`.
 *
 * Pour l'instant ce skeleton sert juste de marqueur structurel.
 * Le code applicatif reste encore dans les <script> inline de index-test.html.
 */

// v14.86 ARCHI-MODULAR Phase 1a : import core/utils + expose à window pour
// compatibilité avec les onclick inline (toujours présents dans index-test.html).
//
// PATTERN DE TRANSITION :
// Tant qu'index-test.html garde ses définitions inline de escHtml, _h, etc.,
// ces exposures via window.X = X sont REDONDANTES (l'inline les définit déjà
// comme globales). Mais quand on migrera vers Phase 4 (cleanup inline), ces
// exposures deviendront LA SOURCE des fonctions globales.
//
// Aujourd'hui ces exposures ne CASSENT rien : assigner window.escHtml = escHtml
// re-écrit la même fonction au même nom (la version core/utils.js).
//
// 🚨 IMPORTANT : tant que l'inline existe ENCORE dans index-test.html, le code
// inline s'exécute AVANT main.js (qui est en `defer` implicite via type="module").
// Donc l'inline gagne. La ré-écriture par main.js arrive après.
// ⚠️ R0-D (AUDIT-GLOBAL) : cette ré-écriture n'est PAS idempotente par défaut. Elle ne l'est que
// si le module reçoit le même contexte que l'inline. Ça n'a pas été le cas pour les classifieurs
// de catégorie : le module posait son référentiel par défaut par-dessus celui de l'app et faisait
// disparaître la résolution d'alias. Toute globale exportée ici qui dépend de `DB` ou d'une
// constante du monolithe doit donc être ENVELOPPÉE avec son contexte, jamais assignée nue.

import * as ManqueAccepte from './core/manque-accepte.js';
import {
  escHtml, _esc, _h, _raw,
  _validateHC, _validateHCCH, _outlierVsMedian,
  _isDpeClassValide, _bailGelDpeFG, _dpeExpire, _estRevisableIRL,
  _dpeInterditLocationAuDate, _dpeInterdictionCalendrier,
  _catLigne2044, _isLoyerCategory, _isChargeRecupCategory, catCtxFromDb, appDbFrom, makeCatCtxCache,
  _bailEstActifAt, _loyerHCAtDate, _chargesAtDate, _loyerProrataMois, _loyerProrataMoisSplit
} from './core/utils.js';

import {
  _IDB_NAME, _IDB_STORE,
  _idbOpen, _idbPut, _idbGet, _idbDel, _idbKey
} from './core/idb.js';

import { showToast } from './components/toast.js';
import { openM, closeM, closeBg, confirm2 } from './components/modal.js';

import {
  _auditEntry, _diffShallow, _auditFilter, _auditToCsv, _auditClean
} from './core/audit-trail.js';

import {
  _compute2044, _format2044Recap, _2044ToCsv
} from './core/legal-2044.js';

import {
  lotRegimeForYear, splitFonciereLots, MEUBLE_TYPES
} from './core/regime-lot.js';

import {
  _findPersonalDataForRef, _generateGdprExport, _planErasure, _isEraseEligible
} from './core/rgpd.js';

import {
  _computeBilanAnnuel, _formatBilanTexte, _computeOccupationLots, loyerDuLotA
} from './core/legal-bilan.js';

// B4 — sous-P&L mensuel (modèle prêt entier en charge)
import {
  _computeFinancesMonthly, _computeDetteBail, _avantBorne, _ligne250DejaComptee, _computeSuiviLot, _positionLot, _bailDuPaiement, _friseLot
} from './core/finances-monthly.js';

// REFONTE FINANCES étape 2 — LE résolveur de périmètre unique (P-1/P-2/P-3) + les deux
// fenêtres nommées (F-1 / F-1 v2). Consommés par rFinances et toutes ses surfaces.
import {
  resolveScope as _finScopeResolveM, buildScopeCatalog as _finScopeCatalogM,
  scopeWeight as _finScopeWeightCoreM, lotInScope as _finScopeLotInM,
  scopeLots as _finScopeLotsM, scopeLabel as _finScopeLabelM,
  SANS_BAILLEUR as _FIN_SANS_BAILLEUR_M, SANS_IMMEUBLE as _FIN_SANS_IMMEUBLE_M,
  LABEL_SANS_BAILLEUR as _FIN_LBL_SANS_BAILLEUR_M, LABEL_SANS_IMMEUBLE as _FIN_LBL_SANS_IMMEUBLE_M
} from './core/finances-scope.js';
import {
  computeConstatWindow as _finWindowConstatM, computeExigibiliteWindow as _finWindowExigibiliteM,
  alignPreviousYear as _finWindowAlignN1M, isFutureMonth as _finWindowIsFutureM,
  windowLabel as _finWindowLabelM
} from './core/finances-window.js';
// P-4 — clé MENSUELLE de répartition des frais bailleur (potentiel locatif, plus jamais 1/nbImm)
import {
  buildSciWeightMensuel as _finSciWeightMensuelM, poidsMensuels as _finPoidsMensuelsM
} from './core/finances-repartition.js';

// SUIVI-LOYERS-SOURCE-UNIQUE Phase A — moteur unique de statut de paiement
import {
  _computeLoyerStatut, _loyerChipVerdict, _loyerToleranceActive, _loyerTodayLocal, _loyerSoldeAjuste, _computeLoyerCumul, _computeLoyerChargeAlloc, _computeLoyerArrears, _loyerSplitCascade, _LOYER_TOLERANCE_JOUR
} from './core/loyer-statut.js';

// AUDIT-SUIVI-LOYERS étape 1/2 — barème de loyer historisé (source de vérité du dû dans le temps)
import { bailLoueAu } from './core/fin-occupation.js';
import { bailHistCle, nouvelIdArchive } from './core/store-mapping.js';
import { duMois, duMoisFromRaw, duMoisSuiviFromRaw, bailsFromRaw, finOccupationBail, _baremeOfLot, periodeEnVigueurA, provisionPourRevision, baseRevisionHC, _debutSuivi, _computeLoyerNetting, tauxPleinMois, tauxPleinMoisFromRaw } from './core/loyer-du-mois.js';
import { reconstruireBaremeLot } from './core/loyer-migration.js';
import { computeEntretienStatut } from './core/entretien-statut.js';
import { regrouperEntretiens } from './core/entretien-regroupement.js';   // RETOURS 15/10 lot 2 — poêle / insert : une échéance
import * as RegleApplication from './core/regle-application.js';   // RETOURS 15/10 lot 2 — marqueur « classé à la main » (fiche du mouvement)
import * as BailPiecesExternes from './core/bail-pieces-externes.js';   // RETOURS 15/10 lot 2 — pièces du bail signé hors Propryo
import { computePilotageFamilles, pilotagePay, FAMILLES as _PIL_FAMILLES, ZONES as _PIL_ZONES, FAMILLES_SI_NON_VIDES as _PIL_SI_NON_VIDES } from './core/pilotage-familles.js';
import {
  computeDateEffetIRL, clampDateEffet, periodeInitialeBail,
  appliquerNouvellePeriode, synchroniserPeriodeBail, cloturerBareme, cloturerPeriodeParDebut, impactCloture,
  garantirCouvertureBail, chapitrePour,
  montantSaisi, premierMontantSaisi, reancrerPeriodesDuBail,
  _premierDuMois, _premierDuMoisSuivant
} from './core/loyer-bareme.js';
// HISTORIQUE-BAIL-ONGLET (17/07) - chapitres/rail de l'historique du bail (onglet Bail inline)
import { construireHistoriqueBail, enVigueur as bailHistoEnVigueur } from './core/bail-historique.js';
// BAIL-PERIODES (v15.775) — modifier / supprimer / ajouter UNE période du barème (pur) ; l'orchestrateur est dans app-part2.js.
import * as BaremeEdition from './core/bareme-edition.js';
import * as BailSignatureEtatMod from './core/bail-signature-etat.js';
import { bailSigneComplet, diffModificationsBail, reappliquerJournalBaux, journalDuBail, modificationsDuBail, valeurLisible as bailModifValeur } from './core/bail-modifications.js';
// HISTORIQUE-BAIL-ONGLET - popup de validation des modifications financieres du bail
import { detecterChangementsFinanciers, dateEffetModifDefaut, redaterRevisionIRL, borneMinEffetBareme } from './core/bail-modif.js';
// IRL-REVISION (R6/R7) — la lettre suit la révision VALIDÉE ; annuler une révision programmée.
import * as IrlRevision from './core/irl-revision.js';
// Retours 15/10 (lot 1, point 4) — ouvrir une pièce jointe sans page blanche (Blob au lieu d'une iframe data:).
import * as DocOuvrir from './core/doc-ouvrir.js';
// Retours 15/10 (lot 1, point 5) — « Faire une quittance » ouvre le lot demandé, jamais le 1er lot du filtre d'entité.
import { lotQuittanceAOuvrir } from './core/quittance-porte.js';
import { loyerTravauxGuard, avenantArticle, buildAvenantHtml, romain as avenantRomain, avenantChampsManquants, avenantMontant, avenantEntrant, avenantPartiesSignature, avenantHtmlSigne, avenantHtmlAImprimer, avenantSignatureManque, bailForfaitActifLe, forfaitEffetAu, forfaitPertinent, avenantApplique, regimeForfaitObjet, forfaitChargesPrevu, avertissementForfaitCharges, referenceForfaitCharges } from './core/avenant.js';
// AVENANT-REFONTE lot 2 — registre des avenants (journal baux_evenements, type 'avenant') : statuts, liste, numérotation.
import * as AvenantRegistre from './core/avenant-registre.js';
// Forfait de charges (art. 25-10 / 8-1, V) dans la régularisation : post-traitement, intervalles, base N-1 (pur, testé).
import { forfaitAvenantsDuBail, occNonForfaitJours, forfaitIntervalles, appliquerForfaitOccupation, periodeForfaitLibelle, baseChargesLogement, avenantObjetApplique, avenantApplicationAffichee } from './core/regul-forfait.js';
// Qui est le bailleur, et donc quelle duree minimale s'impose (art. 10 ET art. 13).
import { regimeBailleur, dureeBailNuLabel, dureeBailNuPhrase, sousTitreBailNu } from './core/bail-duree.js';
import { decompteRestitution, decompteRestitutionCorps } from './core/decompte-restitution.js';
import { noticeCongeRequise, noticeCongeProDoc } from './core/conge-notice.js';   // F-4 : notice jointe au congé (arrêté du 13/12/2017)
import { CONGE_MOTIFS, REPRISE_LIENS, CONGE_CAS_REDUITS, ART15_II_ALINEAS, letterToProDoc, art15IIProDoc, congeBailleurPreavisMois, congeLocatairePreavis, addMoisClamped as congeAddMois, locataireProtege, PREAVIS_REDUIT_CAS, preavisReduitClause, congeMotifDetail, congeDateEffet, congeMentionPreavis, congeBailleurModele, congePhraseTerme } from './core/conge.js';
// DOC-C — un acte ne part pas en PDF avec ses trous. Détection des mentions restées vides dans
// le document RENDU, et fondement légal quand l'absence emporte nullité (art. 15-I / 15-II).
import { mentionsManquantes, emporteNullite, messageMentionsManquantes, sortieAutorisee } from './core/actes-mentions.js';
// VISALE-GMBI — visa Visale (contrôles non bloquants) + alerte ponctuelle « déclaration d'occupation ».
import * as Visale from './core/visale.js';
// R0-C · Q1 révisé — point de départ des loyers suivis (date d'achat / antériorité / provisoire).
import * as Anteriorite from './core/anteriorite.js';
import * as DeclarationOccupation from './core/declaration-occupation.js';
// TRAVAUX : QUI PAIE ? — moteur de règles sourcé (pur, testé) : verdict, textes verbatim, message locataire.
import * as QuiPaie from './core/qui-paie.js';
// _mvCreate — API unique « ajouter un mouvement » (pur, testé ; shadow inline dans app-part1).
import * as MvCreate from './core/mv-create.js';
// Registre des incidents (pur, testé) : statuts, contexte, carnet dérivé, annuaire, RGE, famille.
import * as Incidents from './core/incidents.js';
// Circuit d'un incident (pur, testé) : constat → moteur, plafond, carnet, suggestions, accord exprès, résultat (0060).
import * as IncidentCircuit from './core/incident-circuit.js';

import {
  _buildMvtRows, _buildEcritures, _buildGrandLivre, _toFEC, _journalToCsv, _grandLivreToCsv,
  _listNonExportes, _nonExportesResume, _nonExportesCsv
} from './core/export-comptable.js';

import {
  _dcZipName, _dcFactureDir, _dcExtFromMime, _dcMontantSlug, _dcCatSlug,
  _dcFactureName, _dcResolveDoc, _dcBuildPlan, _dcIndexCsv, _dcApplyFetchFailure
} from './core/dossier-comptable.js';

import {
  _mapRentila, _mapBailFacile, _mergeImport
} from './core/import-concurrents.js';

import {
  _logError, _logEvent, _installGlobalCapture, _exportMonitoringLogs, _clearMonitoringLogs
} from './core/monitoring.js';

import {
  _emailCompose, _emailTypesSupportes, _interpolateEmail,
  _logEmailSent, _getEmailHistory, phraseRelances
} from './core/email-compose.js';

import { openEmailModal, _buildMailtoUrl, _emHandleAction } from './components/email-modal.js';
import { validateNewRef, canRenameLogement, renameLogementRef } from './core/rename-logement.js';
import { validateNewImmNom, renameImmeubleRefs } from './core/rename-immeuble.js';
// P0-1 (chantier BIENS) — merge partiel des champs de formulaire du logement.
import { _logpApplyPartial, _logpPushLoyerRef } from './core/logp-partial.js';
// BIENS (audit C2/I5) — « aucun champ laissé derrière » sur les modales qui reconstruisent l'objet.
import { _preserverChampsExistants, _preserverBailExistant, _preserverSaufChampsPilotes } from './core/preserve-fields.js';
// BIENS P1-15 — quelle photo sert de vignette (⭐ prioritaire, sinon la plus récente).
import { choisirCouverture } from './core/cover-photo.js';
// BIENS — migrations douces du chantier (n° lot copro, …).
import { migrerNumLotVersLot } from './core/biens-migration.js';
// NORMALISATION-LOYERS (01/10) — « Loyers » / « Arriérés de loyers » → « Loyers encaissés » + IBAN locataire purgé.
import { normaliserDonneesLoyers, homonymePerso as loyersHomonymePerso, CATEGORIE_LOYERS, CATEGORIES_LOYERS_HERITEES } from './core/normalisation-loyers.js';
// BIENS etapes 5/6 — liste des pieces (kit derive de EDL_TPL/EDL_EXTRA, clauses de bail).
import * as BiensPieces from './core/biens-pieces.js';
// ALERTE-REGUL (14/10) — régularisation validée PARTAGÉE par la SCI (portée par les logements) : règle unique.
import * as RegulValidation from './core/regul-validation.js';

// EDL TERRAIN lot 0 — quelles photos monter en memoire (CDC docs/CDC-EDL.md §3bis,
// invariants 22 et 34i : ouvrir un EDL ne charge plus les 98 binaires d'un coup).
import * as EdlPhotos from './core/edl-photos.js';

// EDL TERRAIN lot 1 — quand ecrire (CDC §1, invariants 1 a 5) : l'EDL s'autosauve,
// jamais a la frappe, jamais sur un EDL signe, jamais 2 ecritures en moins de 2 s.
import * as EdlAutosave from './core/edl-autosave.js';

// EDL TERRAIN lot 4bis — deux appareils, un etat des lieux (CDC §7, invariants
// 29 a 34) : avertissement de doublon, verrou consultatif d'appareil, et
// CONSERVATION DES DEUX VERSIONS sur conflit. C'est le travail hors ligne du
// lot 4 qui cree le risque ; sans ce module, une visite peut etre ecrasee.
import * as EdlConflit from './core/edl-conflit.js';

// EDL TERRAIN lots 5 et 7 — le parcours (CDC §4, §6, §A.1, §A.6) : progression
// par piece, comptage des ecarts, navigation bornee, et surtout le VERDICT
// DEDUIT (verdictDe(entree, sortie)) qui n'est ni stocke ni saisi.
import * as EdlParcours from './core/edl-parcours.js';

// EDL-TÉLÉPHONE — le parcours de l'EDL ENTIER : chaque section admin devient une
// étape au même titre qu'une pièce (fin du mur de 6 884 px d'admin permanent).
import * as EdlSteps from './core/edl-steps.js';
import * as EdlGarageModel from './core/edl-garage-model.js';

// EDL-TÉLÉPHONE — la relecture avant signature : bilan, lignes signalées, alertes,
// pop-up « en connaissance de cause » (verdict toujours déduit).
import * as EdlRelecture from './core/edl-relecture.js';

// EDL-VOIX-IA — socle IA côté app : transparence (AI Act art. 50, RGPD), mentions, marquage.
import * as IaTransparence from './core/ia-transparence.js';
// EDL-VOIX-IA — client du relais IA, file des dictées (hors ligne), capture audio, logique et vues de la dictée.
import * as IaClient from './core/ia-client.js';
import * as IaFileAttente from './core/ia-file-attente.js';
import * as AudioCapture from './core/audio-capture.js';
import * as EdlDictee from './core/edl-dictee.js';
import * as EdlVoixVues from './core/edl-voix-vues.js';
// EDL-VIDEO-IA — état des lieux filmé : choix des images, règles et données, vues, envoi reprenable (TUS).
import * as EdlVideoImages from './core/edl-video-images.js';
import * as EdlVideo from './core/edl-video.js';
import * as EdlVideoVues from './core/edl-video-vues.js';
import * as TusClient from './core/tus-client.js';

// EDL TERRAIN lot 2 — invitation a installer l'app (CDC §3 verrou 4 : sans
// installation, Safari purge photos et miroir a 7 jours).
import * as PwaInstall from './core/pwa-install.js';

// v15.80 EMAIL-SMTP-CONNECT - envoi direct via Gmail API
import {
  _base64UrlEncode, _emailEncodeMimeHeader, _emailMakeBoundary,
  _emailToMimeBase64Url, _emailSendViaGmail
} from './core/email-send.js';

// v15.87 EM-2b - PJ PDF auto-générée (quittance + IRL en V1.0)
import {
  _emailGenPdfAttachment, _emailPdfTypesSupportedV1, _blobToBase64, _docHtmlToNativeBlob
} from './core/email-pdf-attachment.js';

// v14.99 BUG-PJ-LOCALSTORAGE - helpers attachements (PJ unifiées Drive + IDB)
import {
  _attachmentBuildDoc, _attachmentValidateFile, _attachmentMatch,
  _attachmentResolve, _attachmentDriveName, _planLegacyPjMigration,
  _attachmentOrphans,
  ATTACHMENT_PARENT_TYPES, ATTACHMENT_CATEGORIES, ATTACHMENT_DEFAULT_MAX_SIZE
} from './core/attachments.js';

// IMPORT BANCAIRE - lecture OFX + Excel, dedup, compte, reprise.
// CDC docs/CDC-IMPORT.md : le lecteur CSV a ete retire (①.1).
// NB : js/helpers/bank-import.global.js (mirror genere) expose deja les memes
// symboles sur window pour le mode file:// ; meme source, aucune divergence possible.
import * as BankImport from './core/bank-import.js';

// CDC-QUITTANCES-IRL etape 1 - LE socle du verdict « ce mois est-il solde ? » (D6/D7).
// Consomme _loyerArrearsPass ; n'ecrit AUCUN rattachement paiement->mois (I6).
import {
  etatMoisLot, etatDepuisSuivi, peutQuittancer, moisProposables, moisAQuittancer,
  retardLot, lignesRelance, niveauRelance, datePaiementMois, mentionDateRecu,
  moisFrToYm, ymToMoisFr, ymRange
} from './core/loyers-mois.js';

// CDC-QUITTANCES-IRL etape 5 - LE calendrier des revisions (D12/D13/D15/D16/D17).
import * as IrlCalendrier from './core/irl-calendrier.js';
// CONTRAT-TYPE-2026-10 - mentions du contrat type (decret 2026-596) + version des clauses d'un bail.
import * as ContratType from './core/contrat-type.js';
// CDC-QUITTANCES-IRL D22/I15 - coeur de comptage de la pastille menu Loyers (pur, teste).
import { loyersBadgeCount, loyersBadgeBreakdown } from './core/loyers-badge.js';

// Groupage des lots par bailleur / immeuble — module transverse deja consomme par le socle
// Finances. L'onglet Loyers le CONSOMME aussi (jamais un groupement reinvente).
import * as GroupByImm from './core/group-by-imm.js';

// CDC-QUITTANCES-IRL etape 7 (D20) - lecture de la serie IRL sur l'API BDM de l'INSEE.
// Module PUR : le fetch est fait par index.html, le XML arrive ici en argument.
import * as IrlInsee from './core/irl-insee.js';

// CDC-QUITTANCES-IRL etape 8 - migration des preferences de menu (identifiants de page
// renommes : loyers->mouvements, quittances->loyers, irl retire).
import { migrerIdsMenuLoyers } from './core/nav-submenu.js';

// v15.12 GESTION DG & IMPAYÉS Sprint 12 - tracking DG + plan apurement + procédure judiciaire
import {
  _dgStatut, _calculerDelaiRestitution, _calculerSoldeDG, _dgRetenueLoyerDecidee, _dgSoldeToutCompteEnregistre, _penaliteRetardDG,
  _dgVerseMontant, _dgVerseCoche,
  _planApurementStatut, _procedureJudiciaireEtat,
  DG_STATUS, PROCEDURE_ETAT
} from './core/gestion-dg-impayes.js';

// Grille de vétusté (décret 2016-382 / barème OPAC) — chiffrage part locataire
import {
  VETUSTE_BAREME, VETUSTE_SOURCES,
  vetusteParams, vetusteAge, vetusteUsure, vetustePart,
  computeVetusteLigne, computeVetusteTotal
} from './core/vetuste-grille.js';

// LOG-CANDIDATS (Phase 2) - helpers purs candidature locataire
import {
  _candidatVersLocataire, _candidatVersGarant,
  _nouveauCandidat, _migrerDocsCandidatVersBail,
  buildComplementShareMessage, shouldAutoPull, countUnreadCandidats, nouveauDossierToast,
  majDossierToast, repullDecision, loyerAttenduForLog,
  PIECES_REQUISES, candHasGarantie, categoriesManquantes, libelleGarantie,
  candidatLinkExpire, partitionCandidatLinks
} from './core/candidature.js';
// CANDIDATURES-CONFORMITE (12/10/2026) — purge RGPD des candidats non retenus (date du refus, périmètre
// exact, chemins Storage contrôlés). Aucun score : _calculConfiance / piecesScoreFromCategories retirés.
import * as CandPurge from './core/candidature-purge.js';
// CANDIDATURES-CONFORMITE lot 2 — liste fermée des pièces (décret 2015-1437) + bouclier « pièce hors liste »,
// et employeur vérifié dans l'Annuaire des entreprises (constat daté, sans jugement).
import * as PiecesCand from './core/pieces-candidature.js';
import * as Employeur from './core/employeur.js';
// VERIF-DOCUMENTS — vérification des pièces des candidats : code 2D-Doc (signature de l'État, contrôlée sur
// l'appareil contre les autorités ancrées), indices techniques des PDF, lecture locale. Constats sans score.
import * as DeuxDDoc from './core/deux-d-doc.js';
import * as LecturePieces from './core/lecture-pieces.js';
// LECTURE-PHOTOS — lire le code 2D-Doc d'une PHOTO sur l'appareil (localisation, redressement, grille), dans un Worker.
import * as LecturePhoto from './core/lecture-photo.js';
import * as LecturePhotoClient from './core/lecture-photo-client.js';
import * as VerifPieces from './core/verif-pieces.js';
import * as ReglesBulletin from './core/regles-bulletin.js';
// AIDE-DECISION — comparer les dossiers d'un même logement : critères objectifs, sans note ni classement imposé.
import * as AideDecision from './core/aide-decision-candidats.js';

// LOG-CANDIDATS (lien en ligne) — client relais Cloudflare
import {
  normalizeBase, buildCandidatUrl, relayConfigured, buildInvitationPayload,
  _relayDossierVersCandidat, relayCreateInvitation, relayFetchResult,
  relayFetchPiece, relayReopen, relayRevoke, relayPurge, relayPing,
  classifyOwnerPollStatus, relayReclaimSession, applyReclaimedSession
} from './core/relay-client.js';

// SAUVEGARDE (Chantier 3 cloud-cutover) — cœur PUR de la sauvegarde de sécurité.
// Exposé sous window._bk.* ; l'orchestration IMPURE (File System Access, fetch
// Storage, UI Réglages, auto-check) vit inline dans index-test.html / index.html.
import {
  FREQ_MS, backupStamp, dueForBackup, collectBackupFiles, buildManifest, crc32, storedZip
} from './core/backup.js';

// STOCKAGE lot 1 (docs/CDC-STOCKAGE.md) — registre du stockage local : save sacré (éviction +
// nouvel essai sur quota), nettoyage de démarrage, purge des copies. Exposé sous window._stockage ;
// l'exécution sur le vrai localStorage vit inline (_miroirEcrire, _stockageNettoyer).
import * as Stockage from './core/stockage-local.js';
// STOCKAGE lot 4 (docs/CDC-STOCKAGE.md §3.8) — miroir cloud en IndexedDB + journal synchrone des EDL.
// MÊME module (même URL) que celui importé par supabase-entry.js → même instance `miroir()`.
import * as MiroirLocal from './core/miroir-local.js';
// STOCKAGE lot 2 (docs/CDC-STOCKAGE.md §3.4) — filets avant migration en IndexedDB `immotrack_backup`
// (rotation 1 par migration, 3 au plus, 30 jours ; purge au logout). Exposé sous window._filets.
import * as FiletsMigration from './core/filets-migration.js';

// RESET-CLOUD UX — cœur PUR du « ⚠️ Vider mon espace cloud » (gating UI, saisie du nom,
// messages d'erreur RPC). Exposé sous window._espacePurge ; l'orchestration IMPURE (modale,
// export JSON préalable, appel RPC via __immoPurgeEspace) vit inline dans index.html.
import { confirmNameMatches, purgeUiState, purgeErrorMessage } from './core/espace-purge.js';

// CDC-LOYERS-DESIGN §4 (surfaces 6/7/8) — les dates PROPOSÉES dans les documents viennent
// des faits (mouvement DG, EDL de sortie), jamais de « aujourd'hui ».
import { dateVersementDG, dateRestitutionDG, dateEDLSortie, dateLiberation } from './core/dates-defaut.js';

// CDC-LOYERS-DESIGN V6→V12 — l'éditeur de quittance, direction « Le document ».
// Le module ne dessine rien : il dit ce que le rail des mois doit afficher et ce que
// l'émission doit avertir. Aucun dû, aucun payé, aucune imputation n'y est recalculé.
import {
  MOIS_ETAT, moisRailLot, moisParDefaut, anneeParDefaut, anneesDisponibles,
  verdictEmission, etiquetteSansPaiement, validerSaisieLibre, cleMeta,
  metaApresEmission, metaApresSuppression, questionPaiementHorsReleve, mouvementHorsReleve
} from './core/quittance-editeur.js';
window.questionPaiementHorsReleve = questionPaiementHorsReleve;   // DOC-Q (décision Didier 17/10)
window.mouvementHorsReleve = mouvementHorsReleve;

// CDC-LOYERS-DESIGN V20/V21 — les garde-fous NON BLOQUANTS de la révision IRL.
// Les textes de loi et de conséquence vivent ici, pas dans l'écran.
import { GARDE, gardeFouRevision, revisionForcable, libelleForcage } from './core/irl-garde-fou.js';
window.GARDE_IRL = GARDE;
window.gardeFouRevision = gardeFouRevision;
window.revisionForcable = revisionForcable;
window.libelleForcage = libelleForcage;
window.MOIS_ETAT = MOIS_ETAT;
window.moisRailLot = moisRailLot;
window.moisParDefaut = moisParDefaut;
window.anneeParDefaut = anneeParDefaut;
window.anneesDisponibles = anneesDisponibles;
window.verdictEmission = verdictEmission;
window.etiquetteSansPaiement = etiquetteSansPaiement;
window.validerSaisieLibre = validerSaisieLibre;
window.cleMeta = cleMeta;
window.metaApresEmission = metaApresEmission;
window.metaApresSuppression = metaApresSuppression;
window.dateVersementDG = dateVersementDG;
window.dateRestitutionDG = dateRestitutionDG;
window.dateEDLSortie = dateEDLSortie;
window.dateLiberation = dateLiberation;

// Expose les helpers à window pour compatibilité onclick inline + ev handlers.
// Ces helpers sont aussi définis inline dans index-test.html actuellement.
window.escHtml = escHtml;
window._esc = _esc;
window._h = _h;
window._raw = _raw;
window._validateHC = _validateHC;
window._validateHCCH = _validateHCCH;
window._outlierVsMedian = _outlierVsMedian;
window._isDpeClassValide = _isDpeClassValide;
window._bailGelDpeFG = _bailGelDpeFG;
window._dpeExpire = _dpeExpire;
window._estRevisableIRL = _estRevisableIRL;
// v15.05 Sprint 7 V1.1 LEGAL-DPE-INTERDICTION-LOCATION
window._dpeInterditLocationAuDate = _dpeInterditLocationAuDate;
window._dpeInterdictionCalendrier = _dpeInterdictionCalendrier;
// R0-D (AUDIT-GLOBAL) — Les classifieurs de catégorie reçoivent le VRAI contexte de l'app.
// Avant : `window._isLoyerCategory = _isLoyerCategory` posait la version du module avec son
// référentiel par défaut (8 entrées codées en dur, AUCUNE résolution d'alias) PAR-DESSUS la
// version inline du monolithe, qui résolvait `DB.catAlias` et les mappings legacy. Résultat :
// un encaissement rangé dans une catégorie PERSO (règle M-1 : toute catégorie perso est un alias
// d'une mère) était compté par Finances et ignoré par Loyers, le suivi et la quittance.
// Maintenant : la logique vit dans le module (source unique), le contexte est INJECTÉ à l'appel
// — même patron que `_loyerHCAtDate` ci-dessous et que `_computeFinancesMonthly`.
// Le contexte est relu à CHAQUE appel : `DB` change (hydratation cloud, restauration, import).
// La construction du contexte vit dans le module testé (`catCtxFromDb`) : c'est le pont qui
// était cassé, il ne doit pas retourner vivre dans du câblage non couvert.
// Mémoïsé sur `_dbGen` : ces classifieurs tournent dans des boucles sur `DB.mouvements`
// (mesuré dans l'app : 52 ms par rendu sur un parc courant, 488 ms à 200 catégories, sans cache).
const _catCtxRead = makeCatCtxCache();
let _stdCatsWarned = false, _dbWarned = false;
const _catCtxApp = () => {
  const W = (typeof window !== 'undefined') ? window : {};
  // Repli SILENCIEUX interdit, des DEUX côtés : sans le référentiel, le module retombe sur sa
  // liste par défaut (8 entrées, aucun alias) ; sans le DB, il perd `catAlias` et les mappings.
  // Les deux produisent le MÊME état dégradé — l'état du bug R0-D. Donc les deux crient.
  // Drapeau testé EN PREMIER : ces gardes tournent à chaque classification, donc dans des boucles
  // sur `DB.mouvements`. Une fois le warn tiré, on ne doit plus rien évaluer.
  if (!_stdCatsWarned && !Array.isArray(W.STD_CATEGORIES)) {
    _stdCatsWarned = true;
    console.warn('[R0-D] window.STD_CATEGORIES absent : les catégories personnalisées ne seront pas reconnues (classement des loyers et des charges dégradé).');
  }
  // NB : en pratique ce warn est quasi inatteignable — `index.html:4570-4573` pose
  // `window.__immoGetDB = () => DB` juste après `let DB = {}`, donc le getter répond toujours un
  // objet truthy. Il ne tire que si le getter JETTE et que le miroir `window.DB` est absent. L'état
  // vraiment dégradé (« DB présent mais vide ») est indiscernable d'un compte neuf : rien de mieux
  // n'est détectable ici. On le garde comme filet, pas comme couverture.
  if (!_dbWarned && typeof W.__immoGetDB === 'function' && !appDbFrom(W)) {
    _dbWarned = true;
    console.warn('[R0-D] aucun DB vivant : les catégories personnalisées ne seront pas reconnues (classement des loyers et des charges dégradé).');
  }
  return _catCtxRead(W);
};
window._catLigne2044 = (cat) => _catLigne2044(cat, _catCtxApp());
window._isLoyerCategory = (cat) => _isLoyerCategory(cat, _catCtxApp());
window._isChargeRecupCategory = (cat) => _isChargeRecupCategory(cat, _catCtxApp());
window._bailEstActifAt = _bailEstActifAt;
// ⚠️ LE MIROIR N'EST PAS LE DB. `index.html:4570` déclare `let DB = {}` : une liaison LEXICALE,
// qui n'est PAS une propriété de `window`. `window.DB` n'est posé que par `__immoSetDB` (chemin
// cloud, APRÈS hydratation) et RIEN ne le rafraîchit quand `DB` est réassigné (`index.html:5821`
// remise à zéro, `59053` import/restauration, `60236` adoption cross-onglet).
// Lire `window.DB?.irlHistorique` rendait donc [] en session locale / sandbox, et un historique
// PÉRIMÉ après un import ou une adoption cross-onglet. Avec un historique vide, `_loyerHCAtDate`
// retombe sur `log.hc` — le loyer COURANT, déjà révisé — pour TOUS les mois antérieurs à la
// révision : le dû du passé est surévalué, l'app affiche un impayé fantôme. Et le garde-fou
// « IRL audit » (`index.html:60434`), qui compare `log.hc` à `_loyerHCAtDate(log, aujourd'hui)`,
// comparait deux fois la même valeur → il ne se déclenchait jamais.
// `appDbFrom(window)` lit le getter VIVANT (`index.html:4573 window.__immoGetDB = () => DB`)
// avant de se rabattre sur le miroir. C'est le même geste que R0-D, sur un autre domaine.
// _loyerHCAtDate : signature module = (log, dateRef, irlHistorique). On wrappe
// pour que window._loyerHCAtDate(log, dateRef) consomme l'historique IRL du DB vivant
// (compat avec le code inline qui appelle sans le 3e arg).
window._loyerHCAtDate = (log, dateRef) => _loyerHCAtDate(log, dateRef, appDbFrom(window)?.irlHistorique || []);
window._chargesAtDate = _chargesAtDate;
// v15.19 Phase A1 BUG-PRORATA-DASH : prorata jours intra-mois
window._loyerProrataMois = (log, yr, mi, bails) =>
  _loyerProrataMois(log, yr, mi, bails, appDbFrom(window)?.irlHistorique || []);
// Split {hc, ch} proraté (même signature, irlHistorique consommé) — source du dû pour la cascade d'imputation.
window._loyerProrataMoisSplit = (log, yr, mi, bails) =>
  _loyerProrataMoisSplit(log, yr, mi, bails, appDbFrom(window)?.irlHistorique || []);

// IndexedDB helpers (Phase 1b)
window._IDB_NAME = _IDB_NAME;
window._IDB_STORE = _IDB_STORE;
window._idbOpen = _idbOpen;
window._idbPut = _idbPut;
window._idbGet = _idbGet;
window._idbDel = _idbDel;
window._idbKey = _idbKey;

// Components UI (Phase 2)
window.showToast = showToast;
window.openM = openM;
window.closeM = closeM;
window.closeBg = closeBg;
window.confirm2 = confirm2;

// Audit Trail (Sprint 3A) - helpers purs réutilisables par UI Paramètres
window._auditEntry = _auditEntry;
window._auditDiffShallowPure = _diffShallow; // suffixé pour ne pas écraser l'inline _auditDiffShallow
window._auditFilter = _auditFilter;
window._auditToCsv = _auditToCsv;
window._auditClean = _auditClean;

// LEGAL-2044 (Sprint 3B) - calcul résultat foncier déclaration fiscale
window._compute2044 = _compute2044;
window._format2044Recap = _format2044Recap;
window._2044ToCsv = _2044ToCsv;

// FEAT-REGIMES (P0) - régime fiscal par lot : exclure le meublé (BIC) du 2044 foncier
window.lotRegimeForYear = lotRegimeForYear;
window.splitFonciereLots = splitFonciereLots;
window.MEUBLE_TYPES = MEUBLE_TYPES;

// RGPD (Sprint 3D) - droits accès / portabilité / effacement art. 15-22
window._findPersonalDataForRef = _findPersonalDataForRef;
window._generateGdprExport = _generateGdprExport;
window._planErasure = _planErasure;
window._isEraseEligible = _isEraseEligible;

// LEGAL-BILAN-ANNUEL (Sprint 3C) - bilan par entité
window._computeBilanAnnuel = _computeBilanAnnuel;
window._formatBilanTexte = _formatBilanTexte;
window._computeOccupationLots = _computeOccupationLots;   // R-4/K-2 — occupation sous le socle
// R0-H — LE loyer d'un lot à une date, même vide : les surfaces qui valorisent une vacance
// le LISENT au lieu d'aller chercher « le dernier bail » chacune à sa façon.
window.loyerDuLotA = loyerDuLotA;
window.computeEntretienStatut = computeEntretienStatut;   // KPI Lot 0 — statut d'entretien (12 obligations)
window.EntretienRegroupement = { regrouperEntretiens };   // migration de démarrage (_bootDataJobs)
window.RegleApplication = RegleApplication;   // saveMv (marqueur « classé à la main »)
window.BailPiecesExternes = BailPiecesExternes;   // pièces du bail hors Propryo, prédicat « caution détenue » (_bailCautionDetenue)
window.computePilotageFamilles = computePilotageFamilles; // KPI Lot 1 — agrégateur des 8 familles
window.pilotagePay = pilotagePay;                         // KPI audit §1 — pastille paiement == bulle Impayés
window._PIL_FAMILLES = _PIL_FAMILLES;
window._PIL_SI_NON_VIDES = _PIL_SI_NON_VIDES;   // TRAVAUX : QUI PAIE ? — bulle « Incidents » seulement si non vide
window._PIL_ZONES = _PIL_ZONES;
window.tauxPleinMois = tauxPleinMois;                     // P-4 — taux plein du mois (potentiel)
window.tauxPleinMoisFromRaw = tauxPleinMoisFromRaw;
window._finSciWeightMensuel = _finSciWeightMensuelM;      // P-4 — clé mensuelle au potentiel locatif
window._finPoidsMensuels = _finPoidsMensuelsM;

// B4 — sous-P&L mensuel (prêt entier en charge + base 2044 conditionnelle)
window._computeFinancesMonthly = _computeFinancesMonthly;
// R0-C lot 1 — dette d'UN bail lue dans le maître (restitution du dépôt, art. 22) : consommée
// au lot 2 par `_finDetteBail` (déclaration de fonction inline, jamais un const).
window._computeDetteBail = _computeDetteBail;
// FINANCES-SUIVI-V2 — le moteur unique du suivi des loyers (bail par bail) et sa position de fin de mois.
window._computeSuiviLot = _computeSuiviLot;
window._positionLot = _positionLot;
window._bailDuPaiement = _bailDuPaiement;
window._friseLot = _friseLot;
// R0-C C1 — encaissements d'avant une date d'achat « à rattacher » : lus par `_loyerEtatLot` (note de
// l'onglet Loyers et de la relance). La règle reste unique (finances-monthly.js).
window._avantBorne = _avantBorne;
// 15/10 — ce qui est déjà compté en ligne 250 (alerte de double compte intérêts / assurance emprunteur).
window._ligne250DejaComptee = _ligne250DejaComptee;
// R0-C · Q1 révisé : lu par _finLotSuivi (app-part2) et l'écran « Situation du locataire ».
window._anteriorite = Anteriorite;

// REFONTE FINANCES étape 2 — socle périmètre + fenêtres (jamais window.MOIS_FR : le
// `const MOIS_FR` lexical d'index.html masquerait la propriété — piège documenté).
window._finScopeResolve = _finScopeResolveM;
window._finScopeCatalog = _finScopeCatalogM;
window._finScopeWeightCore = _finScopeWeightCoreM;
window._finScopeLotIn = _finScopeLotInM;
window._finScopeLots = _finScopeLotsM;
window._finScopeLabel = _finScopeLabelM;
window._FIN_SANS_BAILLEUR = _FIN_SANS_BAILLEUR_M;
window._FIN_SANS_IMMEUBLE = _FIN_SANS_IMMEUBLE_M;
window._FIN_LBL_SANS_BAILLEUR = _FIN_LBL_SANS_BAILLEUR_M;
window._FIN_LBL_SANS_IMMEUBLE = _FIN_LBL_SANS_IMMEUBLE_M;
window._finWindowConstat = _finWindowConstatM;
window._finWindowExigibilite = _finWindowExigibiliteM;
window._finWindowAlignN1 = _finWindowAlignN1M;
window._finWindowIsFuture = _finWindowIsFutureM;
window._finWindowLabel = _finWindowLabelM;

// SUIVI-LOYERS-SOURCE-UNIQUE Phase A — moteur unique de statut de paiement
window._computeLoyerStatut = _computeLoyerStatut;
window._loyerChipVerdict = _loyerChipVerdict;
window._loyerToleranceActive = _loyerToleranceActive;
window._loyerTodayLocal = _loyerTodayLocal;
window._loyerSoldeAjuste = _loyerSoldeAjuste;
window._computeLoyerCumul = _computeLoyerCumul;
window._computeLoyerChargeAlloc = _computeLoyerChargeAlloc;
window._computeLoyerArrears = _computeLoyerArrears;
window._loyerSplitCascade = _loyerSplitCascade;
window._LOYER_TOLERANCE_JOUR = _LOYER_TOLERANCE_JOUR;

// AUDIT-SUIVI-LOYERS — résolveur unique du dû + noyau barème (étapes 1-2).
// duMois(ctx, ym) : ctx est construit par l'inline (bails du lot + DB.loyerBareme + quittances).
// Les surfaces basculeront dessus à l'étape 4 ; ici le barème est ALIMENTÉ par les writers.
window.duMois = duMois;
window.duMoisFromRaw = duMoisFromRaw;
// R0-C · Q1 — dû borné au début du suivi du lot (`_debutSuivi`) : LE dû lu par le maître Finances.
window.duMoisSuiviFromRaw = duMoisSuiviFromRaw;
window.bailsFromRaw = bailsFromRaw;
window.finOccupationBail = finOccupationBail;   // LA fin d'occupation d'un bail (lue par _bailFinOccupation, inline)
window.bailHistCle = bailHistCle;
window.nouvelIdArchive = nouvelIdArchive;   // identifiant unique posé dès l'archivage d'un bail (_archiverDansHistorique)   // identité d'un bail archivé (= id de sa ligne cloud) : restitution du dépôt sur le bail EXACT
window.bailLoueAu = bailLoueAu;   // LE statut loué / vacant d'un lot (décision Didier 06/10), lu par _bienIsBailActif
// Même piège que l'historique IRL ci-dessus (le miroir rendait []), mais AUCUN impact aujourd'hui :
// ce câblage n'a pas de consommateur. Le seul appelant de `_baremeOfLot` est `loyer-du-mois.js`
// (L78/151/210), qui passe son propre barème. On le corrige quand même — il est exposé, donc il
// sera appelé un jour, et il aurait menti en silence.
window._baremeOfLot = (ref) => _baremeOfLot(appDbFrom(window)?.loyerBareme || [], ref);
window._loyerPeriodeEnVigueurA = periodeEnVigueurA;
window._loyerProvisionPourRevision = provisionPourRevision;
window._loyerBaseRevisionHC = baseRevisionHC;   // O6 : la base d'une révision = le barème de la veille de l'effet
window._debutSuivi = _debutSuivi;
window._computeLoyerNetting = _computeLoyerNetting;
window._baremeComputeDateEffetIRL = computeDateEffetIRL;
window._baremeClampDateEffet = clampDateEffet;
window._baremePeriodeInitialeBail = periodeInitialeBail;
window._baremeAppliquerNouvellePeriode = appliquerNouvellePeriode;
window._baremeSynchroniserPeriodeBail = synchroniserPeriodeBail;
window._baremeReancrerBail = reancrerPeriodesDuBail;
window._montantSaisi = montantSaisi;
window._premierMontantSaisi = premierMontantSaisi;
window._baremeCloturer = cloturerBareme;
window._baremeCloturerParDebut = cloturerPeriodeParDebut;   // audit 17/07 : cloture ciblee (correction avec fin)
window._baremeGarantirCouverture = garantirCouvertureBail;
window._baremeChapitrePour = chapitrePour;   // audit 24/08 : le chapitre d'une ecriture datee, meme bail clos
window._baremeImpactCloture = impactCloture;   // audit 24/08 : dire ce qu'une cloture va faire au bareme AVANT de le faire
window._premierDuMois = _premierDuMois;
window._premierDuMoisSuivant = _premierDuMoisSuivant;
window.reconstruireBaremeLot = reconstruireBaremeLot;   // étape 3 — migration de l'existant
window._bailHistoConstruire = construireHistoriqueBail;   // HISTORIQUE-BAIL-ONGLET
window.BaremeEdition = BaremeEdition;   // BAIL-PERIODES : cleDePeriode / trouverPeriode / modifierPeriode / supprimerPeriode / ajouterPeriode / impactEdition / syntheseImpact / irlProgrammeeDuLot
// Modifications d'un bail signé hors avenant (journal DB.baux_evenements, migration 0054)
// BAIL-EN-COURS-SIGNE-HORS-PROPRYO : source unique js/core/bail-signature-etat.js ; le miroir IIFE (js/helpers/bail-signature-etat.global.js) pose déjà window.BailSignatureEtat avant les app-part.
window.BailSignatureEtat = Object.assign({}, window.BailSignatureEtat || {}, BailSignatureEtatMod);
window.BailModifs = { bailSigneComplet, diffModificationsBail, reappliquerJournalBaux, journalDuBail, modificationsDuBail, valeurLisible: bailModifValeur };
// Course possible (audit 28/09) : le chargement cloud (hors ligne notamment) peut injecter le DB AVANT que
// ce module soit exécuté → la réapplication de _applyDataDefaults n'a pas eu lieu. On la rejoue ici
// (idempotente ; la ligne d'un bail verrouillé n'est jamais renvoyée au cloud, donc aucun envoi parasite).
try { const _dbJ = appDbFrom(window); if (_dbJ && _dbJ.baux && Array.isArray(_dbJ.baux_evenements)) reappliquerJournalBaux(_dbJ.baux, _dbJ.baux_evenements); } catch (e) { console.warn('[BAIL-MODIFS] réapplication tardive', e); }
window._bailHistoEnVigueur = bailHistoEnVigueur;
window._bailModifDetecterChangements = detecterChangementsFinanciers;
window._bailModifDateEffetDefaut = dateEffetModifDefaut;
window._bailModifRedaterIRL = redaterRevisionIRL;
window.DocOuvrir = DocOuvrir;   // ouverture des pièces jointes (PDF / image) par URL blob:
window.lotQuittanceAOuvrir = lotQuittanceAOuvrir;   // « Faire une quittance » : le lot demandé, jamais le 1er du filtre
window.IrlRevision = IrlRevision;   // IRL-REVISION : entreeValideeDuCycle / revDepuisEntree / annulerRevisionProgrammee
window._bailModifBorneMinEffet = borneMinEffetBareme;

// EXPORT-COMPTABLE (Sprint 3E) - FEC + journal + grand livre
window._buildMvtRows = _buildMvtRows;
window._buildEcritures = _buildEcritures;
window._buildGrandLivre = _buildGrandLivre;
window._toFEC = _toFEC;
window._journalToCsv = _journalToCsv;
window._grandLivreToCsv = _grandLivreToCsv;
// Lot 6, A2 — mouvements NON exportés (aucun compte inventé) : listés, jamais tus.
window._listNonExportes = _listNonExportes;
window._nonExportesResume = _nonExportesResume;
window._nonExportesCsv = _nonExportesCsv;

// EXPORT-COMPTABLE-ZIP (Dossier comptable) — cœur pur exposé sous window._dc.*
window._dc = {
  zipName: _dcZipName, factureDir: _dcFactureDir, extFromMime: _dcExtFromMime,
  montantSlug: _dcMontantSlug, catSlug: _dcCatSlug, factureName: _dcFactureName,
  resolveDoc: _dcResolveDoc, buildPlan: _dcBuildPlan, indexCsv: _dcIndexCsv,
  applyFetchFailure: _dcApplyFetchFailure
};

// IMPORT-CONCURRENTS (Sprint 3G) - mappers Rentila + BailFacile
window._mapRentila = _mapRentila;
window._mapBailFacile = _mapBailFacile;
window._mergeImport = _mergeImport;

// MONITORING (Sprint 4C) - capture erreurs + events anonymes
window._logError = _logError;
window._logEvent = _logEvent;
window._exportMonitoringLogs = _exportMonitoringLogs;
window._clearMonitoringLogs = _clearMonitoringLogs;
// Install global capture si user opt-in (DB.params.monitoringEnabled)
// ⚠️ Ce test est évalué au CHARGEMENT du module, donc AVANT `initDB()` (appelé au
// DOMContentLoaded, `index.html:60501`) : à cet instant `DB` vaut encore `{}`. Lire le DB vivant
// corrige le mécanisme (plus de miroir), pas le moment : la capture ne s'installe que pour un DB
// déjà peuplé. Aucun écran ne permet aujourd'hui d'activer `monitoringEnabled` — déplacer ce
// gating après l'hydratation est un chantier à part (il changerait QUAND la capture démarre).
if (appDbFrom(window)?.params?.monitoringEnabled === true) {
  _installGlobalCapture();
}

// EMAIL-AUTO (v14.97) - proposition de mails sortants (10 types V1, mode mailto/clipboard)
window._emailCompose = _emailCompose;
window._emailTypesSupportes = _emailTypesSupportes;
window._interpolateEmail = _interpolateEmail;
window.phraseRelances = phraseRelances;
window._openEmailModal = openEmailModal;
window.openEmailModal = openEmailModal;
window._buildMailtoUrl = _buildMailtoUrl;
window._emHandleAction = _emHandleAction; // v15.82bis — onclick inline buttons
window._logEmailSent = _logEmailSent;
window._getEmailHistory = _getEmailHistory;

// v15.80 EMAIL-SMTP-CONNECT - envoi direct Gmail API
window._base64UrlEncode = _base64UrlEncode;
window._emailEncodeMimeHeader = _emailEncodeMimeHeader;
window._emailMakeBoundary = _emailMakeBoundary;
window._emailToMimeBase64Url = _emailToMimeBase64Url;
window._emailSendViaGmail = _emailSendViaGmail;

// v15.87 EM-2b - PJ PDF auto-générée
window._emailGenPdfAttachment = _emailGenPdfAttachment;
window._docHtmlToNativeBlob = _docHtmlToNativeBlob;
window._emailPdfTypesSupportedV1 = _emailPdfTypesSupportedV1;
window._blobToBase64 = _blobToBase64;

// ATTACHMENTS (v14.99 BUG-PJ-LOCALSTORAGE) - système unifié de PJ Drive + IDB
window._attachmentBuildDoc = _attachmentBuildDoc;
window._attachmentValidateFile = _attachmentValidateFile;
window._attachmentMatch = _attachmentMatch;
window._attachmentResolve = _attachmentResolve;
window._attachmentDriveName = _attachmentDriveName;
window._planLegacyPjMigration = _planLegacyPjMigration;
window._attachmentOrphans = _attachmentOrphans;
window.ATTACHMENT_PARENT_TYPES = ATTACHMENT_PARENT_TYPES;
window.ATTACHMENT_CATEGORIES = ATTACHMENT_CATEGORIES;
window.ATTACHMENT_DEFAULT_MAX_SIZE = ATTACHMENT_DEFAULT_MAX_SIZE;

// IMPORT BANCAIRE - un seul point d'exposition, derive des exports du module :
// plus de liste a maintenir a la main (une omission = un helper introuvable a chaud).
window.BankImport = BankImport;
for (const _bk of Object.keys(BankImport)) window[_bk] = BankImport[_bk];

// LOYERS - verdict « mois solde » (CDC-QUITTANCES-IRL etape 1). Source unique consommee
// par l'onglet Loyers ; index.html n'assemble que le contexte (du + encaisse).
window.etatMoisLot = etatMoisLot;
window.etatDepuisSuivi = etatDepuisSuivi;   // FINANCES-SUIVI-V2 : le verdict par mois lu dans le moteur unique
// FINANCES-SUIVI-V2 — l'entrée de journal « manque accepté » (validation, création, annulation ; pur).
window.ManqueAccepte = ManqueAccepte;
window.peutQuittancer = peutQuittancer;
window.moisProposables = moisProposables;
window.moisAQuittancer = moisAQuittancer;
window.retardLot = retardLot;
window.loyersBadgeCount = loyersBadgeCount;          // D22/I15 — coeur pur du compteur de pastille
window.loyersBadgeBreakdown = loyersBadgeBreakdown;
window.lignesRelance = lignesRelance;
window.niveauRelance = niveauRelance;
// I-DATE (CDC-LOYERS-DESIGN V5) — LA porte unique de la date de paiement d'un mois.
// Aucune surface ne recompose cette date ; null = on n'affiche RIEN.
window.datePaiementMois = datePaiementMois;
window.mentionDateRecu = mentionDateRecu;
window.moisFrToYm = moisFrToYm;
window.ymToMoisFr = ymToMoisFr;
window.ymRange = ymRange;

// IRL - LE calendrier des revisions : namespace expose (etatRevision, ganttRevisions, ETAT...).
window.IrlCalendrier = IrlCalendrier;
// Contrat type (decret 2026-596) : textes verbatim + versionClausesBail (lue par _bailClauseVersion).
window.ContratType = ContratType;
window.GroupByImm = GroupByImm;
window.IrlInsee = IrlInsee;
window.migrerIdsMenuLoyers = migrerIdsMenuLoyers;

// GESTION DG & IMPAYÉS (v15.12 Sprint 12) - tracking DG + plan apurement + procédure
window._dgStatut = _dgStatut;
window._dgVerseMontant = _dgVerseMontant;   // dépôt VERSÉ : définition unique (R-0, audit d'intégration 🟠3)
window._dgVerseCoche = _dgVerseCoche;
window._calculerDelaiRestitution = _calculerDelaiRestitution;
window._calculerSoldeDG = _calculerSoldeDG;
window._dgRetenueLoyerDecidee = _dgRetenueLoyerDecidee;
window._dgSoldeToutCompteEnregistre = _dgSoldeToutCompteEnregistre;
window._penaliteRetardDG = _penaliteRetardDG;
// Avenant au bail (loi 89-462) — articles + garde-fous loyer travaux
window.loyerTravauxGuard = loyerTravauxGuard;
window.avenantArticle = avenantArticle;
window.buildAvenantHtml = buildAvenantHtml;
window.avenantRomain = avenantRomain;
window.avenantChampsManquants = avenantChampsManquants;
window.avenantMontant = avenantMontant;
window.AvenantRegistre = AvenantRegistre;
window.avenantEntrant = avenantEntrant;
window.avenantPartiesSignature = avenantPartiesSignature;   // lot 3b : parties lues dans le document enregistré
window.avenantHtmlSigne = avenantHtmlSigne;
// « Lu et approuvé » obligatoire et imprimé (décision 30/09) : consigne papier + validation par partie.
window.avenantHtmlAImprimer = avenantHtmlAImprimer;
window.avenantSignatureManque = avenantSignatureManque;
// Forfait de charges (art. 25-10 / 8-1, V) : état forfait daté (registre des avenants), lu par computeRegul pour ne pas régulariser un forfait
window.bailForfaitActifLe = bailForfaitActifLe;
window.forfaitEffetAu = forfaitEffetAu;
window.forfaitPertinent = forfaitPertinent;
window.avenantApplique = avenantApplique;
window.regimeForfaitObjet = regimeForfaitObjet;
window.forfaitChargesPrevu = forfaitChargesPrevu;
window.avertissementForfaitCharges = avertissementForfaitCharges;
window.referenceForfaitCharges = referenceForfaitCharges;
window.forfaitAvenantsDuBail = forfaitAvenantsDuBail;
window.occNonForfaitJours = occNonForfaitJours;
window.forfaitIntervalles = forfaitIntervalles;
window.appliquerForfaitOccupation = appliquerForfaitOccupation;
window.periodeForfaitLibelle = periodeForfaitLibelle;
window.baseChargesLogement = baseChargesLogement;
window.avenantObjetApplique = avenantObjetApplique;
window.avenantApplicationAffichee = avenantApplicationAffichee;
// Congé & résiliation (loi 89-462)
window.CONGE_MOTIFS = CONGE_MOTIFS;
window.REPRISE_LIENS = REPRISE_LIENS;
window.CONGE_CAS_REDUITS = CONGE_CAS_REDUITS;
window.regimeBailleur = regimeBailleur;
window.dureeBailNuLabel = dureeBailNuLabel;
window.dureeBailNuPhrase = dureeBailNuPhrase;
window.sousTitreBailNu = sousTitreBailNu;
window.PREAVIS_REDUIT_CAS = PREAVIS_REDUIT_CAS;
window.preavisReduitClause = preavisReduitClause;
window.ART15_II_ALINEAS = ART15_II_ALINEAS;
window.letterToProDoc = letterToProDoc;
window.art15IIProDoc = art15IIProDoc;
window.noticeCongeRequise = noticeCongeRequise;   // F-4
window.noticeCongeProDoc = noticeCongeProDoc;
window.mentionsManquantes = mentionsManquantes;
window.emporteNullite = emporteNullite;
window.messageMentionsManquantes = messageMentionsManquantes;
window.sortieAutorisee = sortieAutorisee;
window.congeBailleurPreavisMois = congeBailleurPreavisMois;
window.decompteRestitution = decompteRestitution;             // F-26 : décompte de restitution du dépôt (lot C)
window.decompteRestitutionCorps = decompteRestitutionCorps;
window.congeMotifDetail = congeMotifDetail;
window.congeDateEffet = congeDateEffet;
window.congeMentionPreavis = congeMentionPreavis;
window.congeBailleurModele = congeBailleurModele;   // BAUX-ECHUS : la lettre de congé selon le type de bail
window.congePhraseTerme = congePhraseTerme;
window.congeLocatairePreavis = congeLocatairePreavis;
window.congeAddMois = congeAddMois;
window.locataireProtege = locataireProtege;
// Grille de vétusté (décret 2016-382 / OPAC)
window.VETUSTE_BAREME = VETUSTE_BAREME;
window.VETUSTE_SOURCES = VETUSTE_SOURCES;
window.vetusteParams = vetusteParams;
window.vetusteAge = vetusteAge;
window.vetusteUsure = vetusteUsure;
window.vetustePart = vetustePart;
window.computeVetusteLigne = computeVetusteLigne;
window.computeVetusteTotal = computeVetusteTotal;
window._planApurementStatut = _planApurementStatut;
window._procedureJudiciaireEtat = _procedureJudiciaireEtat;
window.DG_STATUS = DG_STATUS;
window.PROCEDURE_ETAT = PROCEDURE_ETAT;

// LOG-CANDIDATS (Phase 2) - helpers purs candidature locataire
window.PIECES_REQUISES = PIECES_REQUISES;
window.candHasGarantie = candHasGarantie;
window.categoriesManquantes = categoriesManquantes;
window.libelleGarantie = libelleGarantie;
window.CandPurge = CandPurge;
window.PiecesCand = PiecesCand;
window.Employeur = Employeur;
window.DeuxDDoc = DeuxDDoc;
window.LecturePieces = LecturePieces;
window.LecturePhoto = LecturePhoto;
window.LecturePhotoClient = LecturePhotoClient;
window.VerifPieces = VerifPieces;
window.ReglesBulletin = ReglesBulletin;
window.AideDecision = AideDecision;
window._candidatVersLocataire = _candidatVersLocataire;
window._candidatVersGarant = _candidatVersGarant;
window._nouveauCandidat = _nouveauCandidat;
window._migrerDocsCandidatVersBail = _migrerDocsCandidatVersBail;
window.buildComplementShareMessage = buildComplementShareMessage;
window.shouldAutoPull = shouldAutoPull;
window.countUnreadCandidats = countUnreadCandidats;
window.nouveauDossierToast = nouveauDossierToast;
window.majDossierToast = majDossierToast;
window.repullDecision = repullDecision;
window.loyerAttenduForLog = loyerAttenduForLog;
window.candidatLinkExpire = candidatLinkExpire;
window.partitionCandidatLinks = partitionCandidatLinks;

// LOG-CANDIDATS (lien en ligne) — client relais
window._relayNormalizeBase = normalizeBase;
window._buildCandidatUrl = buildCandidatUrl;
window._relayConfigured = relayConfigured;
window._buildInvitationPayload = buildInvitationPayload;
window._relayDossierVersCandidat = _relayDossierVersCandidat;
window._relayCreateInvitation = relayCreateInvitation;
window._relayFetchResult = relayFetchResult;
window._relayFetchPiece = relayFetchPiece;
window._relayReopen = relayReopen;
window._relayRevoke = relayRevoke;
window._relayPurge = relayPurge;
window._relayPing = relayPing;
// §6 signature à distance — récupération d'un ownerToken perdu (audit 2026-07-15).
window._relayReclaimSession = relayReclaimSession;
window._classifyOwnerPollStatus = classifyOwnerPollStatus;
window._applyReclaimedSession = applyReclaimedSession;

// SAUVEGARDE (Chantier 3) — cœur pur exposé en bloc sous window._bk pour le code inline.
window._bk = { FREQ_MS, backupStamp, dueForBackup, collectBackupFiles, buildManifest, crc32, storedZip };

// STOCKAGE lot 1 — registre du stockage local (voir import en tête).
window._stockage = Stockage;
// STOCKAGE lot 4 — miroir cloud (lu par _miroirEcrireCloud dans index.html).
window._miroirLocal = MiroirLocal;
// STOCKAGE lot 2 — filets avant migration (lus par _filetAvantMigration / _filetsExpirer dans app-part2.js).
window._filets = FiletsMigration;

// RESET-CLOUD UX — cœur pur du « Vider mon espace cloud » (voir import en tête).
window._espacePurge = { confirmNameMatches, purgeUiState, purgeErrorMessage };
// RENOMMER UN BIEN — cœur pur exposé pour le code inline (validation + garde-fou + report des 11 rattachements).
window._renameLogement = { validate: validateNewRef, canRename: canRenameLogement, rename: renameLogementRef };
// RENOMMER UN IMMEUBLE — propage le nouveau nom aux logements/mouvements/agenda/documents/regul (scopé
// par espace) : sans ça, renommer un immeuble orpheline ses logements (« Logements isolés »).
window._renameImmeuble = { validate: validateNewImmNom, propagate: renameImmeubleRefs };
// BIENS P0-1 — merge partiel par chemin pointé (shadow inline identique dans index.html).
window._logpApplyPartial = _logpApplyPartial;
window._logpPushLoyerRef = _logpPushLoyerRef;
window._preserverChampsExistants = _preserverChampsExistants;
window._preserverBailExistant = _preserverBailExistant;
window._preserverSaufChampsPilotes = _preserverSaufChampsPilotes;
window.choisirCouverture = choisirCouverture;
// BIENS — migrations douces (appelees par _bootDataJobs ; idempotentes).
window._biensMigration = { numLotVersLot: migrerNumLotVersLot };
// NORMALISATION-LOYERS — appelée par index.html (_normaliserLoyers) : initDB, restauration, import JSON,
// _bootDataJobs. Le module est différé mais s'exécute AVANT DOMContentLoaded, donc avant initDB.
window.NormalisationLoyers = { normaliser: normaliserDonneesLoyers, homonymePerso: loyersHomonymePerso, CATEGORIE_LOYERS, CATEGORIES_LOYERS_HERITEES };
// BIENS — liste des pieces + clauses generees (designation des pieces, parties communes).
window.BiensPieces = BiensPieces;
// ALERTE-REGUL — lu par l'alerte « Régularisation N-1 à émettre », l'onglet Charges (Valider), la migration
// douce de _bootDataJobs et l'espace locataire. Absent : l'alerte reste (prudence), la validation est refusée.
window.RegulValidation = RegulValidation;
// EDL TERRAIN lot 0 — collecte des photos d'un EDL + selection « a la demande ».
window.EdlPhotos = EdlPhotos;
// EDL TERRAIN lot 1 — minuteur d'autosave de l'etat des lieux.
window.EdlAutosave = EdlAutosave;
// EDL TERRAIN lot 4bis — doublon, verrou d'appareil, deux versions conservees.
window.EdlConflit = EdlConflit;
// EDL TERRAIN lots 5 et 7 — progression, ecarts, navigation, verdict DEDUIT.
window.EdlParcours = EdlParcours;
// EDL-TELEPHONE — la liste ordonnee des etapes de l'EDL entier (admin + pieces + fin).
window.EdlSteps = EdlSteps;
window.EdlGarageModel = EdlGarageModel;
// EDL-TELEPHONE — la relecture avant signature (bilan, lignes signalees, pop-up).
window.EdlRelecture = EdlRelecture;
// EDL-VOIX-IA — notice, mentions « Proposé par l'IA, à vérifier », mention du PDF, marquage.
window.IaTransparence = IaTransparence;
window.IaClient = IaClient;
window.IaFileAttente = IaFileAttente;
window.AudioCapture = AudioCapture;
window.EdlDictee = EdlDictee;
window.EdlVoixVues = EdlVoixVues;
window.EdlVideoImages = EdlVideoImages;
window.EdlVideo = EdlVideo;
window.EdlVideoVues = EdlVideoVues;
window.TusClient = TusClient;
// EDL TERRAIN lot 2 — qui inviter a installer, quand, et sous quelle forme.
window.PwaInstall = PwaInstall;
// VISALE-GMBI (docs/CDC-VISALE-GMBI.md)
window.Visale = Visale;
window.QuiPaie = QuiPaie;
window.MvCreate = MvCreate;
window.Incidents = Incidents;
window.IncidentCircuit = IncidentCircuit;
// Circuit d'un incident côté propriétaire (carte de la fiche, carnet, plafond, artisan, validation) : tous les modes.
try { import('./app/incident-circuit-app.js').then((m) => m.demarrer()).catch((e) => console.warn('[circuit]', e)) } catch (e) { /* jamais bloquant */ }
// Accueil d'un nouvel utilisateur (carte « Premiers pas » + visite guidée, docs/CDC-PREMIERS-PAS.md) : tous les modes.
try { import('./app/premiers-pas-app.js').then((m) => m.demarrer()).catch((e) => console.warn('[premiers-pas]', e)) } catch (e) { /* jamais bloquant */ }
// CONSO-IA : utilisation de l'IA du compte (Mon profil, pause au plafond dans l'EDL) et écran de l'administrateur.
try { import('./app/conso-ia-app.js').then((m) => m.demarrer()).catch((e) => console.warn('[conso-ia]', e)) } catch (e) { /* jamais bloquant */ }
// COMPTE DÉMO (?demo=1 seulement : window.__immoDemo est posé par le script du <head> d'index.html) — nuage fictif local,
// compléments calculés du jeu de données, espace locataire. Import dynamique : aucun poids pour les vrais comptes.
if (window.__immoDemo === true) { try { import('./app/demo-app.js').then((m) => m.demarrer()).catch((e) => console.warn('[demo]', e)) } catch (e) { /* jamais bloquant */ } }
window.DeclarationOccupation = DeclarationOccupation;

// Marqueur pour les tests d'intégration
window.__IMMOTRACK_MODULE_BOOTSTRAP__ = {
  phase: 5,
  version: '14.99',
  loadedAt: new Date().toISOString(),
  helpersExposed: [
    'escHtml', '_esc', '_h', '_raw',
    '_validateHC', '_validateHCCH', '_outlierVsMedian',
    '_isDpeClassValide', '_bailGelDpeFG', '_dpeExpire', '_estRevisableIRL',
    '_isLoyerCategory', '_isChargeRecupCategory',
    '_bailEstActifAt', '_loyerHCAtDate', '_chargesAtDate',
    '_idbOpen', '_idbPut', '_idbGet', '_idbDel', '_idbKey',
    'showToast', 'openM', 'closeM', 'closeBg', 'confirm2',
    '_auditEntry', '_auditDiffShallowPure', '_auditFilter', '_auditToCsv', '_auditClean',
    '_compute2044', '_format2044Recap', '_2044ToCsv',
    '_findPersonalDataForRef', '_generateGdprExport', '_planErasure', '_isEraseEligible',
    '_computeBilanAnnuel', '_formatBilanTexte'
  ]
};

console.info('[main.js] Sprint 3C chargé - 40 helpers (utils + idb + components + audit + legal-2044 + rgpd + bilan) exposés à window');
