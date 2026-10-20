/**
 * core/conge.js — CONGÉ & RÉSILIATION du bail (loi n° 89-462 du 6 juillet 1989)
 *
 * PUR (sans DB / DOM). Ce module NE RÉÉCRIT PAS le texte des lettres : le corps de chaque acte
 * vient des modèles Propryo existants (`js/core/email-compose.js` via `window._emailCompose`).
 * Ici : calcul des préavis, conversion du corps de lettre en HTML `.pro-doc` (trame Propryo),
 * et le VERBATIM de l'article 15-II (reproduit à peine de nullité dans le congé pour vente).
 *
 * Cadre légal : congé bailleur art. 15-I (motifs reprise/vente/motif légitime, préavis 6 mois nu /
 * 3 mois meublé), art. 15-II (vente : droit de préemption), art. 15-III (locataire protégé) ;
 * congé locataire art. 12/15 (préavis 3 mois nu, 1 mois meublé ou cas réduits) ; résiliation
 * impayés clause résolutoire art. 24 ; résiliation amiable art. 1193 C. civ.
 *
 * Tests Vitest miroir : __tests__/helpers/conge.test.js
 */
import { preavisBailleurMois } from './bail-echeance.js';

// Motifs du congé bailleur (art. 15-I).
export const CONGE_MOTIFS = [
  { k: 'reprise', label: 'Reprise pour habiter', motifConge: 'reprise' },
  { k: 'vente', label: 'Vente du logement', motifConge: 'vente' },
  { k: 'legitime', label: 'Motif légitime et sérieux', motifConge: 'motif légitime et sérieux' }
];
// Bénéficiaires possibles d'une reprise (art. 15-I).
export const REPRISE_LIENS = ['le bailleur lui-même', 'son conjoint', 'son partenaire de PACS', 'son concubin notoire (depuis au moins 1 an)', 'un ascendant', 'un descendant', 'un ascendant ou descendant du conjoint / partenaire / concubin'];
// Cas de préavis RÉDUIT à 1 mois pour le locataire d'un bail nu (art. 15-I).
// ⚠️ « État de santé » NE PORTE AUCUNE CONDITION D'ÂGE. L'entrée disait « Plus de 65 ans et état
// de santé » : les 65 ans sont le seuil de l'art. 15-III (protection du locataire âgé contre un
// congé du bailleur), qui n'a rien à voir avec le préavis réduit. Un bailleur qui lisait cette
// liste écartait le bon cas pour un locataire de 50 ans muni d'un certificat médical — et lui
// réclamait trois mois de préavis au lieu d'un.
export const CONGE_CAS_REDUITS = [
  'Aucun (préavis plein)', 'Zone tendue', 'Mutation professionnelle', 'Perte d\'emploi',
  'Premier emploi', 'Nouvel emploi consécutif à une perte', 'État de santé (certificat médical)',
  'Bénéficiaire du RSA', 'Bénéficiaire de l\'AAH', 'Attribution d\'un logement social', 'Victime de violences conjugales'
];

/**
 * Les SIX cas de préavis réduit à un mois, dans les termes de la loi.
 * Copiés depuis la version consolidée EN VIGUEUR (Légifrance, LEGIARTI000047900030, art. 15-I).
 *
 * Pourquoi ils vivent ICI et plus dans le corps du bail : la même phrase existait en TROIS
 * exemplaires (modèle Word éditable, générateur du PDF signé, copie en dur), tous les trois
 * périmés de la même façon — ils exigeaient d'avoir « plus de 60 ans » pour le cas de l'état de
 * santé, condition supprimée de la loi, omettaient le certificat médical qu'elle exige, et
 * ignoraient purement le cas des violences au sein du couple.
 *
 * Un bail qui énonce une condition que la loi n'impose pas n'est pas un détail de rédaction :
 * le locataire qui s'y fie donne trois mois de préavis au lieu d'un, et paie deux mois de loyer
 * qu'il ne devait pas.
 */
export const PREAVIS_REDUIT_CAS = [
  // « l'article 17 » NU serait une auto-référence fausse : le bail Propryo a son propre
  // article 17 (« Annexes obligatoires »). On nomme la loi, comme le fait le 6e cas pour le
  // code de la construction.
  'sur les territoires mentionnés au premier alinéa de l\'article 17 de la loi n° 89-462 du 6 juillet 1989 (zone tendue)',
  'en cas d\'obtention d\'un premier emploi, de mutation, de perte d\'emploi ou de nouvel emploi consécutif à une perte d\'emploi',
  'pour le locataire dont l\'état de santé, constaté par un certificat médical, justifie un changement de domicile',
  'pour le locataire bénéficiaire d\'une ordonnance de protection ou dont le conjoint, partenaire lié par un pacte civil de solidarité ou concubin fait l\'objet de poursuites, d\'une procédure alternative aux poursuites ou d\'une condamnation, même non définitive, en raison de violences exercées au sein du couple ou sur un enfant qui réside habituellement avec lui',
  'pour les bénéficiaires du revenu de solidarité active ou de l\'allocation adulte handicapé',
  'pour le locataire qui s\'est vu attribuer un logement défini à l\'article L. 831-1 du code de la construction et de l\'habitation'
];

/**
 * La clause du bail énonçant le préavis réduit. UNE source, trois consommateurs.
 * @param {boolean} [gras] true = le « un (1) mois » en <strong> (corps HTML du bail) ;
 *                         false = texte nu (générateur PDF, qui pose ses propres styles).
 */
export function preavisReduitClause(gras) {
  const mois = gras ? '<strong>un (1) mois</strong>' : 'un (1) mois';
  return 'Ce délai est réduit à ' + mois + ' : ' + PREAVIS_REDUIT_CAS.join(' ; ') + '.';
}

/**
 * Les CINQ alinéas de l'art. 15-II que la loi impose de reproduire « à peine de nullité dans chaque
 * notification » (dernière phrase du II : « Les termes des cinq alinéas précédents sont reproduits… »).
 * Copié VERBATIM depuis la version consolidée EN VIGUEUR (Légifrance, LEGIARTI000047900030).
 * Ne pas paraphraser : toute altération est une cause de nullité du congé pour vente.
 */
export const ART15_II_ALINEAS = [
  "Lorsqu'il est fondé sur la décision de vendre le logement, le congé doit, à peine de nullité, indiquer le prix et les conditions de la vente projetée. Le congé vaut offre de vente au profit du locataire : l'offre est valable pendant les deux premiers mois du délai de préavis. Les dispositions de l'article 46 de la loi n° 65-557 du 10 juillet 1965 fixant le statut de la copropriété des immeubles bâtis ne sont pas applicables au congé fondé sur la décision de vendre le logement.",
  "A l'expiration du délai de préavis, le locataire qui n'a pas accepté l'offre de vente est déchu de plein droit de tout titre d'occupation sur le local.",
  "Le locataire qui accepte l'offre dispose, à compter de la date d'envoi de sa réponse au bailleur, d'un délai de deux mois pour la réalisation de l'acte de vente. Si, dans sa réponse, il notifie son intention de recourir à un prêt, l'acceptation par le locataire de l'offre de vente est subordonnée à l'obtention du prêt et le délai de réalisation de la vente est porté à quatre mois. Le contrat de location est prorogé jusqu'à l'expiration du délai de réalisation de la vente. Si, à l'expiration de ce délai, la vente n'a pas été réalisée, l'acceptation de l'offre de vente est nulle de plein droit et le locataire est déchu de plein droit de tout titre d'occupation.",
  "Dans le cas où le propriétaire décide de vendre à des conditions ou à un prix plus avantageux pour l'acquéreur, le notaire doit, lorsque le bailleur n'y a pas préalablement procédé, notifier au locataire ces conditions et prix à peine de nullité de la vente. Cette notification est effectuée à l'adresse indiquée à cet effet par le locataire au bailleur ; si le locataire n'a pas fait connaître cette adresse au bailleur, la notification est effectuée à l'adresse des locaux dont la location avait été consentie. Elle vaut offre de vente au profit du locataire. Cette offre est valable pendant une durée d'un mois à compter de sa réception. L'offre qui n'a pas été acceptée dans le délai d'un mois est caduque.",
  "Le locataire qui accepte l'offre ainsi notifiée dispose, à compter de la date d'envoi de sa réponse au bailleur ou au notaire, d'un délai de deux mois pour la réalisation de l'acte de vente. Si, dans sa réponse, il notifie son intention de recourir à un prêt, l'acceptation par le locataire de l'offre de vente est subordonnée à l'obtention du prêt et le délai de réalisation de la vente est porté à quatre mois. Si, à l'expiration de ce délai, la vente n'a pas été réalisée, l'acceptation de l'offre de vente est nulle de plein droit."
];

function esc(x) {
  return String(x == null ? '' : x)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Convertit le corps d'un modèle de lettre (texte : paragraphes \n\n, sauts \n, gras **…**)
 * en HTML `.pro-doc`. Échappe TOUT le texte d'abord (anti-XSS : le corps contient des données
 * saisies — noms, montants), puis applique le formatage léger.
 */
export function letterToProDoc(body) {
  return String(body == null ? '' : body).trim().split(/\n\n+/)
    .filter(par => par.trim() !== '') // un token conditionnel vide (ex. clause préemption hors vente) ne laisse pas de <p> creux
    .map(par => {
      const h = esc(par).replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      return '<p>' + h + '</p>';
    }).join('');
}

/** Les 5 alinéas de l'art. 15-II en HTML `.pro-doc` (annexe du congé pour vente). */
export function art15IIProDoc() {
  return '<h3>Annexe — Article 15, II de la loi du 6 juillet 1989 (reproduction imposée à peine de nullité)</h3>' +
    ART15_II_ALINEAS.map(a => '<p style="font-size:9pt;color:#3c4658">' + esc(a) + '</p>').join('');
}

/**
 * Préavis du congé bailleur (mois) — LA règle de js/core/bail-echeance.js : 6 mois nu (art. 15-I),
 * 3 mois meublé (art. 25-8 I). null là où la loi de 1989 ne fait courir AUCUN préavis de congé
 * bailleur : étudiant (art. 25-7 al. 4) et mobilité (art. 25-14 al. 1) prennent fin à leur terme
 * sans congé ; garage et autre suivent leur contrat. (Avant : 3 mois pour étudiant / mobilité,
 * 6 mois pour garage / autre — aucune base légale.)
 */
export function congeBailleurPreavisMois(typeBail) {
  return preavisBailleurMois(String(typeBail || 'nu'));
}

/**
 * Préavis du congé locataire.
 * @param {{typeBail:string, casReduit:string}} o
 * @returns {{mois:number, reduit:boolean, sansJustif:boolean, label:string}}
 *   sansJustif=true pour la zone tendue (mention seule) ; sinon justificatif requis.
 */
export function congeLocatairePreavis(o) {
  o = o || {};
  const meuble = ['meuble', 'etudiant', 'mobilite'].indexOf(String(o.typeBail || '')) >= 0;
  const cas = String(o.casReduit || '');
  const casChoisi = cas && cas.indexOf('Aucun') !== 0;
  if (meuble) return { mois: 1, reduit: false, sansJustif: true, label: 'bail meublé (1 mois)' };
  if (casChoisi) return { mois: 1, reduit: true, sansJustif: cas === 'Zone tendue', label: cas };
  return { mois: 3, reduit: false, sansJustif: false, label: 'bail nu (3 mois)' };
}

/** Ajout de mois avec recadrage fin de mois (art. 641 CPC) — pour date de fin de préavis / d'effet. */
export function addMoisClamped(iso, m) {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getDate();
  d.setMonth(d.getMonth() + m);
  if (d.getDate() !== day) d.setDate(0);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Locataire protégé (art. 15-III) : > 65 ans à la date d'effet ET ressources sous plafond,
 *  sauf bailleur lui-même > 65 ans ou de ressources modestes. Renvoie l'alerte de nullité si protégé. */
export function locataireProtege(o) {
  o = o || {};
  const protege = !!o.plusDe65 && !!o.ressourcesFaibles;
  const exceptionBailleur = !!o.bailleurAgeOuModeste;
  const bloquant = protege && !exceptionBailleur;
  return { protege, exceptionBailleur, bloquant };
}

/**
 * ═══ LE MOTIF DU CONGÉ BAILLEUR, ET LES MARQUEURS QUAND IL MANQUE ═══
 *
 * UNE source pour les deux chemins de sortie du congé : la modale « Congé & résiliation » et le
 * Hub Communications. Le Hub réécrivait son propre motif — il ne demandait ni le prix ni les
 * conditions de la vente, tout en affirmant « aux prix et conditions indiqués ci-dessus », et en
 * reproduisant deux paragraphes plus bas l'alinéa qui les impose « à peine de nullité ».
 *
 * POURQUOI LE MARQUEUR EST POSÉ ICI, ET PAS PAR LE MOTEUR D'INTERPOLATION.
 * Le dépôt a deux conventions de trou, et ce n'est pas un accident à résorber :
 *   • « ‹prix› » est posé par un GÉNÉRATEUR qui connaît la sémantique de l'acte. Il NOMME la
 *     mention en français, et ce nom est la clé de la table `NULLITE` (actes-mentions.js).
 *   • « (inconnu) » est posé par `_interpolateEmail`, qui ne connaît qu'un chemin de jeton. Il
 *     ne peut pas savoir si un jeton vide est un défaut ou un cas normal (note de révision
 *     facultative, motif de préavis réduit sans objet…).
 * Unifier reviendrait à faire parler la couche aveugle à la place de la couche savante : elle
 * alerterait sur chaque jeton légitimement vide, et l'utilisateur apprendrait à passer outre —
 * exactement ce que le garde-fou cherche à éviter. Apprendre « (inconnu) » au garde-fou a le
 * défaut symétrique : il ne pourrait ni nommer la mention manquante, ni dire si elle emporte
 * nullité. La frontière reste donc où elle est ; ce qui change, c'est que le générateur est
 * désormais le MÊME sur tous les chemins.
 *
 * @param {object} o
 * @param {string} o.motif        'vente' | 'reprise' | 'legitime'
 * @param {string} [o.prix]       vente — art. 15-II, à peine de nullité
 * @param {string} [o.conditions] vente — art. 15-II, à peine de nullité
 * @param {string} [o.benef]      reprise — art. 15-I, à peine de nullité
 * @param {string} [o.benefAdr]   reprise — art. 15-I, à peine de nullité
 * @param {string} [o.lien]       reprise — nature du lien (défaut : le bailleur lui-même)
 * @param {string} [o.legitime]   motif légitime et sérieux — art. 15-I
 * @param {boolean} [o.meuble]   bail meublé (art. 25-8, I) : « vente » sans prix ni préemption 15-II
 * @param {boolean} [o.art15Inline] true = reproduire les cinq alinéas DANS le corps (courrier en
 *        texte seul : un email n'a pas d'annexe) ; false = renvoyer à l'annexe du document.
 * @returns {{motifConge:string, motifDetail:string}}
 */
export function congeMotifDetail(o) {
  o = o || {};
  /** La valeur saisie, ou le marqueur NOMMÉ que lira `mentionsManquantes`. */
  const ou = (v, nom) => {
    const s = String(v == null ? '' : v).trim();
    return s || ('\u2039' + nom + '\u203a');
  };
  const motif = String(o.motif || 'reprise');

  // Le symbole est posé par le modèle ; une saisie libre peut déjà le porter (« 250 000 € »).
  const prixNu = String(o.prix == null ? '' : o.prix).trim().replace(/\s*€\s*$/, '').trim();

  // BAUX-ECHUS — bail MEUBLÉ : l'art. 25-8, I impose de motiver le refus de renouvellement (reprise,
  // vente, motif légitime et sérieux) ; il ne prévoit ni offre de vente ni droit de préemption (ceux de
  // l'art. 15-II ne visent que le bail nu). Le motif « vente » n'emporte donc ni prix ni annexe 15-II.
  if (motif === 'vente' && o.meuble) {
    return { motifConge: 'vente', motifDetail: 'Vente du logement.' };
  }

  if (motif === 'vente') {
    // La phrase de préemption n'a de sens que si le prix et les conditions la PRÉCÈDENT
    // réellement : elle est donc indissociable de la ligne qui les porte, et ne peut plus
    // être ajoutée seule comme le faisait le Hub.
    const preemption = "Conformément à l'article 15-II de la loi précitée, ce congé vaut offre de vente à votre profit : vous bénéficiez d'un droit de préemption aux prix et conditions indiqués ci-dessus.";
    const alineas = o.art15Inline
      ? "\n\nReproduction de l'article 15, II de la loi du 6 juillet 1989 (à peine de nullité) :\n\n" + ART15_II_ALINEAS.join('\n\n')
      : " Les termes des cinq alinéas de l'article 15-II, dont la reproduction est imposée à peine de nullité, figurent en annexe du présent congé.";
    return {
      motifConge: 'vente',
      motifDetail: 'Vente du logement, au prix de ' + ou(prixNu, 'prix') + ' € — conditions : '
        + ou(o.conditions, 'conditions') + '.\n\n' + preemption + alineas
    };
  }

  if (motif === 'legitime') {
    return {
      motifConge: 'motif légitime et sérieux',
      motifDetail: ou(o.legitime, 'description du motif légitime et sérieux')
    };
  }

  return {
    motifConge: 'reprise',
    motifDetail: "Reprise du logement pour l'habiter, au bénéfice de " + ou(o.benef, 'bénéficiaire')
      + ', demeurant ' + ou(o.benefAdr, 'adresse du bénéficiaire')
      // Un lien vide donnait « (le bailleur lui-même) » : une affirmation de FAIT que
      // personne n'avait saisie, dans une mention imposée à peine de nullité (art. 15-I).
      + ' (' + ou(o.lien, 'nature du lien avec le bailleur') + ').'
  };
}

/**
 * La DATE D'EFFET du congé bailleur : un terme qui respecte RÉELLEMENT le préavis.
 *
 * Si l'échéance la plus proche est déjà trop tardive pour que le préavis y tienne, le congé
 * délivré pour cette échéance est nul. On reporte alors au terme suivant, autant de fois qu'il
 * le faut, plutôt que d'annoncer une date d'effet que la loi n'admet pas.
 *
 * Extrait de la modale (audit P0-1) pour que le Hub cesse d'annoncer, lui, l'échéance brute du
 * bail assortie d'un « le délai de préavis est de N mois » que rien ne vérifiait.
 *
 * @param {object} o
 * @param {string} o.finIso      échéance du bail (YYYY-MM-DD)
 * @param {number} o.preavisMois durée du préavis bailleur
 * @param {number} o.cycleMois   durée d'un cycle de reconduction (36 nu / 12 meublé…)
 * @param {string} o.todayIso    date du jour (YYYY-MM-DD) — injectée, jamais lue ici
 * @returns {{finIso:string, pushed:boolean}} finIso='' si l'échéance est inexploitable
 */
export function congeDateEffet(o) {
  o = o || {};
  const fin = String(o.finIso || '').slice(0, 10);
  const today = String(o.todayIso || '').slice(0, 10);
  if (!fin || !today) return { finIso: '', pushed: false };
  let cycle = Number(o.cycleMois);
  if (!(cycle > 0)) cycle = 36;
  const preavis = Number(o.preavisMois) > 0 ? Number(o.preavisMois) : 6;

  let courant = fin;
  let pushed = false;
  // Garde-fou de boucle : un cycle valide ne demande jamais 200 reports ; au-delà, la donnée
  // est absurde et boucler sans fin figerait l'onglet.
  for (let i = 0; i < 200; i++) {
    const limite = addMoisClamped(courant, -preavis);
    if (!limite || limite >= today) break;   // le préavis tient encore : ce terme est le bon
    const suivant = addMoisClamped(courant, cycle);
    if (!suivant || suivant <= courant) break;
    courant = suivant;
    pushed = true;
  }
  return { finIso: courant, pushed };
}

/**
 * La mention du préavis dans le corps du congé. Les deux chemins l'écrivaient séparément, et le
 * Hub écrivait la version courte — « de N mois avant le terme du bail » — alors qu'il n'avait
 * rien vérifié du tout. Une seule phrase, adossée à `congeDateEffet`, qui la rend vraie.
 */
export function congeMentionPreavis(mois, typeBail) {
  if (!(Number(mois) > 0)) return congeMentionSansPreavis(typeBail);
  return 'Le délai de préavis légal applicable à ce congé est de ' + mois
    + " mois ; il court à compter de la réception du présent congé et la date d'effet ci-dessus"
    + ' a été fixée pour le respecter.';
}

/**
 * BAUX-ECHUS — là où la loi de 1989 ne fait courir AUCUN préavis de congé bailleur, la lettre ne
 * peut pas annoncer « un délai de préavis légal de N mois » (avant : « de null mois », ou 3 et 6
 * mois inventés). Elle dit ce que dit la loi, et rien de plus.
 */
export function congeMentionSansPreavis(typeBail) {
  const t = String(typeBail || '');
  if (t === 'etudiant') return "Le bail ayant été conclu pour une durée de neuf mois avec un étudiant, la reconduction tacite est inapplicable (article 25-7 de la loi n° 89-462 du 6 juillet 1989) : il prend fin à son terme, sans qu'un congé soit nécessaire.";
  if (t === 'mobilite') return "Le bail mobilité est non renouvelable et non reconductible (article 25-14 de la loi n° 89-462 du 6 juillet 1989) : il prend fin à son terme, sans qu'un congé soit nécessaire.";
  return 'Le délai de préavis applicable à ce congé est celui prévu au contrat de location.';
}

/**
 * BAUX-ECHUS — LA lettre « congé du bailleur » selon le type de bail. Le corps ne cite l'art. 15
 * que pour le bail NU :
 *  · nu       → congé motivé, art. 15-I (annexe 15-II pour une vente) — inchangé ;
 *  · meublé   → refus de renouvellement motivé, art. 25-8, I (cité mot pour mot), sans annexe 15-II ;
 *  · étudiant → information de fin de bail : reconduction inapplicable (art. 25-7), sans congé ni motif ;
 *  · mobilité → information de fin de bail : non renouvelable ni reconductible (art. 25-14) ;
 *  · garage / autre → congé selon le contrat (préavis prévu au contrat), sans motif.
 * @returns {{tpl:string, titre:string, fondement:string, motif:boolean, annexe15II:boolean,
 *            protege:(string|null), dateLibre:boolean, fichier:string}}
 */
export function congeBailleurModele(typeBail) {
  const t = String(typeBail || 'nu');
  const loi = 'Loi n° 89-462 du 6 juillet 1989, article ';
  if (t === 'meuble') return { tpl: 'bail-conge-bailleur-meuble', titre: 'Congé donné au locataire', fondement: loi + '25-8, I', motif: true, annexe15II: false, protege: 'art. 25-8, II', dateLibre: false, fichier: 'Conge-bailleur' };
  if (t === 'etudiant' || t === 'mobilite') return { tpl: 'bail-fin-terme-information', titre: 'Information de fin de bail', fondement: loi + (t === 'etudiant' ? '25-7' : '25-14'), motif: false, annexe15II: false, protege: null, dateLibre: false, fichier: 'Information-fin-de-bail' };
  if (t === 'garage' || t === 'autre') return { tpl: 'bail-conge-bailleur-contrat', titre: 'Congé donné au locataire', fondement: 'Contrat de location', motif: false, annexe15II: false, protege: null, dateLibre: true, fichier: 'Conge-bailleur' };
  return { tpl: 'bail-conge-bailleur-6mois', titre: 'Congé donné au locataire', fondement: loi + '15', motif: true, annexe15II: true, protege: 'art. 15-III', dateLibre: false, fichier: 'Conge-bailleur' };
}

/**
 * La phrase de terme d'une lettre d'information de fin de bail : au futur si le terme est à venir,
 * au passé s'il est dépassé — jamais une « date d'effet » antérieure à la lettre.
 * @param {string} finFr  la date de fin, déjà mise en forme (JJ/MM/AAAA)
 * @param {string} finIso 'YYYY-MM-DD'
 * @param {string} todayIso 'YYYY-MM-DD'
 */
export function congePhraseTerme(finFr, finIso, todayIso) {
  if (!finIso) return 'prend fin à son terme, sans reconduction';
  return String(finIso).slice(0, 10) < String(todayIso || '').slice(0, 10)
    ? 'est arrivé à son terme le ' + finFr
    : 'prendra fin à son terme, le ' + finFr;
}
