// js/core/verif-pieces.js — VERIF-DOCUMENTS (v15.740 provisoire).
// Assemble les vérifications d'une pièce de candidature : code 2D-Doc (deux-d-doc.js), indices techniques
// (indices-pdf.js), et — lot 3 — lecture IA des bulletins (regles-bulletin.js). Produit :
//   • `verif` : l'objet stocké sur l'entrée DB.documents de la pièce (purgé avec elle par la purge v15.731) ;
//   • les CONSTATS de la carte « Points à vérifier » (format {code, icone, titre, detail, source, url, date}) ;
//   • l'ÉTAT de la pièce (VERIF-LISIBLE, etatPiece) : un mot (OK / À vérifier / Non vérifiable / Non lue / En attente) et des
//     lignes courtes au clic. Vert seulement pour une signature officielle vérifiée (fait cryptographique ; « de la DGFiP »
//     seulement pour un avis d'impôt signé par un certificat FPE* des autorités FR04 / FR06).
// Aucun score, aucun total, aucun classement ; vocabulaire factuel (jamais « faux », « fraude », « suspect »).
// Module pur. Testé par __tests__/helpers/verif-pieces.test.js.

import { ETAT, TYPES_DOCUMENT, TYPES_AVIS_IMPOT, SOURCE_2DDOC, champsConserves, comparerAvecTexte, identiteConcorde, familleDuType, referencesSvair, URL_SVAIR } from './deux-d-doc.js';
import { indicesTechniques, lireDatePdf } from './indices-pdf.js';
import { MENTION_PROPOSITION } from './ia-transparence.js';
import { TYPES_BULLETIN as TB, TYPES_CONTRAT as TC } from './regles-bulletin.js';

export const VERSION_VERIF = 1;
/** Types de pièces (liste fermée du décret, pieces-candidature.js) */
export const TYPES_AVIS = Object.freeze(['I.D.1', 'II.E.1']);
export const TYPES_BULLETIN = TB;
export const TYPES_CONTRAT = TC;
const REESSAI_MS = 60 * 60 * 1000;     // une vérification reportée est retentée au plus une fois par heure

export const SOURCE_AVIS_2DDOC = {
  libelle: 'economie.gouv.fr, authenticité des justificatifs de revenus (13/05/2026)',
  url: 'https://www.economie.gouv.fr/particuliers/gerer-mon-argent/investir-dans-limmobilier/proprietaires-comment-vous-assurer-de-lauthenticite-des-justificatifs-de-revenus'
};
export const SOURCE_DECRET = { libelle: 'décret n° 2015-1437, annexe I, D', url: 'https://www.legifrance.gouv.fr/loda/id/JORFTEXT000031444493' };
export { URL_SVAIR };

const fdate = (d) => { const x = d instanceof Date ? d : new Date(d); return isNaN(x) ? '' : `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${x.getUTCFullYear()}`; };
const fheure = (d) => { const x = d instanceof Date ? d : new Date(d); return isNaN(x) ? '' : `${fdate(x)} à ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };
const nombre = (v) => { const d = String(v || '').replace(/[^\d-]/g, ''); return d ? Number(d).toLocaleString('fr-FR').replace(/ /g, ' ') : String(v || ''); };

// LISTE BLANCHE des types lus (minimisation, registre RGPD : « pièce d'identité jamais lue ») : domicile, activité, ressources
// du candidat et de la caution — SAUF les pièces qui portent une photo ou l'identité d'une personne (cartes professionnelles,
// carte d'étudiant, identité du représentant d'une société caution). Pièce sans type : seulement dans les catégories
// domicile / situation / ressources du candidat (jamais dans « garant », où une pièce d'identité peut être déposée sans type).
const TYPES_EXCLUS = new Set(['I.C.5', 'I.C.7', 'II.B.2', 'II.D.5', 'VISALE']);
export function typeLu(pieceType, categorie) {
  const t = String(pieceType || '');
  if (!t) return ['domicile', 'situation', 'ressources'].includes(String(categorie || ''));
  if (TYPES_EXCLUS.has(t)) return false;
  return /^I\.(B|C|D)\.\d$/.test(t) || /^II\.(B|C|D|E)\.\d$/.test(t);
}
/** La pièce entre-t-elle dans les vérifications ? (liste blanche de types, PDF / JPEG / PNG seulement) */
export function pieceConcernee(doc) {
  if (!doc || doc._deleted || doc.parentType !== 'candidat') return false;
  if (doc.category === 'identite' || !typeLu(doc.pieceType, doc.category)) return false;
  return /^(application\/pdf|image\/jpeg|image\/png)$/i.test(String(doc.mime || ''));
}
/** LECTURE-PHOTOS (v15.751) : version du lecteur de photos. Une pièce lue AVANT, sans code trouvé, est relue une fois. */
export const LECTEUR_PHOTO = 1;
export const REPORTS_MAX = 3;
/** Faut-il (re)lancer l'analyse locale ? */
export function aAnalyser(doc, maintenant = Date.now()) {
  if (!pieceConcernee(doc)) return false;
  // LECTURE-PHOTOS : lecture pas finie (délai sur un appareil lent) → rien n'est conclu, nouvel essai au plus une fois par
  // heure, 3 fois au plus (ensuite, seul « Vérifier à nouveau » relance : pas de calcul sans fin sur un appareil trop lent)
  if (doc.verifReportee && ((doc.verifReports || 0) >= REPORTS_MAX || maintenant - Date.parse(doc.verifReportee) < REESSAI_MS)) return false;
  const v = doc.verif;
  if (!v || v.v !== VERSION_VERIF) return true;
  if (!v.illisible && !v.deuxDDoc && (v.lecteurPhoto || 0) < LECTEUR_PHOTO) return true;
  return !!v.reessayer && maintenant - Date.parse(v.le || 0) > REESSAI_MS;
}
/** Identité attendue sur la pièce : celle du garant pour les pièces du garant, sinon celle du candidat. */
export function identiteAttendue(doc, candidat) {
  const c = candidat || {};
  if (doc && (doc.category === 'garant' || /^II\./.test(String(doc.pieceType || '')))) {
    const g = c.garant || {}; return { nom: g.nom || '', prenom: g.prenom || '', qui: 'garant' };
  }
  return { nom: c.nom || '', prenom: c.prenom || '', qui: 'candidat' };
}
/** Années de revenus attendues pour « le dernier ou l'avant-dernier avis » à la date de réception. */
export function anneesAvisAttendues(recuLe) {
  const d = recuLe ? new Date(recuLe) : new Date(); const y = d.getUTCFullYear();
  // L'avis de l'année N (revenus N-1) est émis entre juillet et septembre : prudence, on l'attend à partir d'août.
  const dernier = d.getUTCMonth() >= 7 ? y - 1 : y - 2;
  return [dernier, dernier - 1, dernier + 1];   // +1 : avis émis tôt (dossier reçu en juillet)
}

const PRIO = { valide: 0, invalide: 1, non_verifiable: 2, illisible: 3 };
/** Le code DGFiP d'un avis d'impôt : certificat FPE* des autorités FR04 / FR06 (liste de confiance, 14/10/2026). */
export const estDgfip = (dd) => !!dd && ['FR04', 'FR06'].includes(dd.ac) && /^FPE\d$/.test(dd.certificat) && TYPES_AVIS_IMPOT.includes(dd.type);
const libelleMin = (t) => t.charAt(0).toLowerCase() + t.slice(1);
function nomsSignes(type, champs) {
  const v = (id) => ((champs || []).find((c) => c.id === id) || {}).valeur || '';
  const f = familleDuType(type);
  if (f === 'avis' || f === 'asdir') return [v('46'), v('48')].filter(Boolean);
  if (f === 'domicile') return [[v('12'), v('13')].join(' ').trim(), [v('16'), v('17')].join(' ').trim()].filter(Boolean);
  if (f === 'bulletin' || f === 'contrat') return [[v('12'), v('13')].join(' ').trim()].filter(Boolean);
  return [];
}

/**
 * Construit l'objet `verif` d'une pièce.
 * @param {object} p
 * @param {object} p.doc        entrée DB.documents
 * @param {object} p.candidat   entrée DB.candidats
 * @param {object} p.analyse    { illisible?, estPdf, codes:[string], texte, metadonnees, enregistrements, superpositions }
 * @param {Array}  p.resultats  sorties de verifier2DDoc, une par code lu (même ordre)
 * @param {Date|number} [p.maintenant]
 */
export function construireVerif({ doc, candidat, analyse, resultats, maintenant }) {
  const now = maintenant ? new Date(maintenant) : new Date();
  const a = analyse || {};
  const verif = { v: VERSION_VERIF, le: now.toISOString(), illisible: !!a.illisible, deuxDDoc: null, indices: null, constats: [], reessayer: false, lecteurPhoto: LECTEUR_PHOTO };
  if (a.illisible) return verif;
  if (a.codeParPhoto) verif.codeParPhoto = true;       // LECTURE-PHOTOS : code lu sur une photo ou une page scannée
  if (a.estPdf) verif.indices = { metadonnees: a.metadonnees || {}, enregistrements: a.enregistrements || 0, superpositions: a.superpositions || [] };

  // Un DataMatrix qui n'est pas un 2D-Doc (code d'archivage, de La Poste…) n'est pas un « code 2D-Doc présent » : écarté.
  const lus = (resultats || []).filter((x) => x && x.code !== 'entete');
  const tries = lus.slice().sort((x, y) => (PRIO[x.etat] ?? 9) - (PRIO[y.etat] ?? 9));
  const r = tries[0] || null;
  if (r) {
    const h = r.entete || {};
    const champs = r.etat === ETAT.VALIDE ? champsConserves(h.type, r.champs) : [];
    const dd = { etat: r.etat, code: r.code, motif: r.motif, reessayer: !!r.reessayer, type: h.type || '', typeLibelle: TYPES_DOCUMENT[h.type] || 'document',
      ac: h.ac || '', certificat: h.certificat || '', dateSignature: h.dateSignature ? new Date(h.dateSignature).toISOString().slice(0, 10) : '',
      certificatValidite: r.certificat ? { du: r.certificat.du, au: r.certificat.au } : null, revocation: r.revocation || null,
      champs, comparaisons: [], identite: null, annee: '',
      autresNonConformes: r.etat === ETAT.VALIDE ? tries.filter((x) => x.etat === ETAT.INVALIDE).length : 0 };
    if (r.etat === ETAT.VALIDE) {
      // code lu sur une photo / page scannée : le texte du PDF (autres pages, texte reconnu) n'est pas comparable → aucune comparaison
      dd.comparaisons = comparerAvecTexte(h.type, r.champs, a.codeParPhoto ? '' : a.texte);
      dd.nomsSignes = nomsSignes(h.type, r.champs);
      appliquerIdentite(doc, dd, candidat);
      if (TYPES_AVIS_IMPOT.includes(h.type)) dd.annee = ((r.champs || []).find((c) => c.id === '45') || {}).valeur || '';
      dd.svair = referencesSvair(h.type, r.champs);
    }
    verif.deuxDDoc = dd;
    verif.reessayer = dd.reessayer;
  }
  verif.constats = constatsDePiece(doc, verif, now);
  return verif;
}

/** Compare les noms signés à l'identité déclarée ACTUELLE (recalculé à l'affichage : un nom corrigé est pris en compte). */
function appliquerIdentite(doc, dd, candidat) {
  dd.identite = null; delete dd.identiteAttendue; delete dd.qui;
  const att = identiteAttendue(doc, candidat);
  const noms = dd.nomsSignes || [];
  if (!noms.length || !att.nom) return;
  const ok = noms.map((n) => identiteConcorde(n, att.nom, att.prenom));
  dd.identite = ok.some((x) => x === true) ? 'concorde' : ok.every((x) => x === null) ? null : 'differe';
  dd.identiteAttendue = [att.prenom, att.nom].filter(Boolean).join(' '); dd.qui = att.qui;
}
/**
 * Vérification à jour pour l'AFFICHAGE : identité comparée au dossier actuel et constats recalculés (type de pièce,
 * nom déclaré) à partir des seuls faits stockés — les textes et adresses des constats viennent toujours du code.
 */
export function actualiser(doc, verif, candidat, maintenant) {
  if (!verif) return verif;
  const v = Object.assign({}, verif);
  if (v.deuxDDoc) { v.deuxDDoc = Object.assign({}, v.deuxDDoc); if (v.deuxDDoc.etat === ETAT.VALIDE) appliquerIdentite(doc, v.deuxDDoc, candidat); }
  v.constats = pieceConcernee(doc) ? constatsDePiece(doc, v, maintenant) : [];
  return v;
}
const typeDiffere = (doc, dd) => !!dd && dd.etat === ETAT.VALIDE && TYPES_AVIS.includes(String(doc && doc.pieceType || '')) && !TYPES_AVIS_IMPOT.includes(dd.type);

const nomPiece = (doc) => `« ${(doc && (doc.originalName || doc.name)) || 'pièce'} »`;
const libelleTypePiece = (doc, dd) => TYPES_AVIS.includes(String(doc && doc.pieceType || '')) ? 'Avis d\'imposition' : (dd && dd.typeLibelle ? dd.typeLibelle.charAt(0).toUpperCase() + dd.typeLibelle.slice(1) : 'Pièce');

/** Constats d'une pièce, au format des « Points à vérifier ». */
export function constatsDePiece(doc, verif, maintenant) {
  const out = []; if (!verif || verif.illisible) return out;
  const dd = verif.deuxDDoc; const quand = 'le ' + fdate(verif.le);
  const estAvis = TYPES_AVIS.includes(String(doc && doc.pieceType || ''));
  const lib = libelleTypePiece(doc, dd);
  const src2d = { source: SOURCE_2DDOC.libelle + ' · contrôle sur l\'appareil', url: SOURCE_2DDOC.url, date: quand };
  if (dd && dd.etat === ETAT.INVALIDE) {
    out.push(Object.assign({ code: 'V2', icone: 'doc', titre: `${lib} ${nomPiece(doc)} : le code 2D-Doc ne correspond pas à sa signature.`,
      detail: `${dd.motif} La version PDF téléchargée depuis l'espace en ligne de l'administration porte un code lisible et signé.` }, src2d));
  } else if (dd && dd.etat !== ETAT.VALIDE && !dd.reessayer) {
    out.push(Object.assign({ code: 'V3', icone: 'minus', titre: `${lib} ${nomPiece(doc)} : code 2D-Doc présent, signature non vérifiable.`, detail: dd.motif }, src2d));
  } else if (!dd && estAvis) {
    out.push({ code: 'V4', icone: 'minus', titre: `Avis d'imposition ${nomPiece(doc)} : aucun code 2D-Doc lisible.`,
      detail: 'Depuis avril 2022, un code 2D-Doc est présent sur les avis d\'impôt sur le revenu (economie.gouv.fr) ; une photo floue, coupée ou une copie peut le rendre illisible. La version PDF téléchargée depuis l\'espace impots.gouv du titulaire porte le code. Une vérification manuelle reste possible sur le service de vérification des avis d\'impôt.',
      source: SOURCE_AVIS_2DDOC.libelle, url: SOURCE_AVIS_2DDOC.url, date: quand, svair: true });
  }
  if (dd && dd.etat === ETAT.VALIDE) {
    if (typeDiffere(doc, dd)) {
      out.push(Object.assign({ code: 'V8', icone: 'doc', titre: `Avis d'imposition ${nomPiece(doc)} : le code signé porte sur un autre type de document.`,
        detail: `Le code 2D-Doc de cette pièce est celui d'un document de type « ${libelleMin(dd.typeLibelle)} », alors que la pièce est classée « avis d'imposition ».` }, src2d));
    }
    if (dd.autresNonConformes) {
      out.push(Object.assign({ code: 'V2', icone: 'doc', titre: `${lib} ${nomPiece(doc)} : un autre code 2D-Doc de la pièce ne correspond pas à sa signature.`,
        detail: `${dd.autresNonConformes > 1 ? dd.autresNonConformes + ' autres codes lus' : 'Un autre code lu'} sur la pièce ne passe pas le contrôle de signature, alors qu'un code est valide.` }, src2d));
    }
    for (const c of dd.comparaisons || []) if (c.statut === 'absent') {
      out.push(Object.assign({ code: 'V5', icone: 'doc', titre: `${lib} ${nomPiece(doc)} : une donnée signée n'est pas retrouvée dans le texte du fichier.`,
        detail: `${c.libelle} inscrit dans le code signé : ${c.id === '41' ? nombre(c.signe) : c.signe}. Cette valeur n'apparaît pas dans le texte du fichier (couche texte du PDF).` }, src2d));
    }
    if (dd.identite === 'differe') {
      out.push(Object.assign({ code: 'V6', icone: 'doc', titre: `${lib} ${nomPiece(doc)} : le nom inscrit dans le code diffère de l'identité déclarée${dd.qui === 'garant' ? ' du garant' : ''}.`,
        detail: `Nom${dd.nomsSignes.length > 1 ? 's' : ''} dans le code signé : ${dd.nomsSignes.join(' · ')}. Identité déclarée : ${dd.identiteAttendue}. Un avis commun, un nom d'usage ou un changement d'état civil peut l'expliquer.` }, src2d));
    }
    if (TYPES_AVIS_IMPOT.includes(dd.type) && dd.annee && doc && doc.uploadedAt) {
      const attendues = anneesAvisAttendues(doc.uploadedAt);
      if (!attendues.includes(Number(dd.annee))) {
        out.push({ code: 'V7', icone: 'clock', titre: `Avis d'imposition ${nomPiece(doc)} : revenus de ${dd.annee}.`,
          detail: `Le décret n° 2015-1437 prévoit le dernier ou l'avant-dernier avis d'imposition. Pour une pièce reçue le ${fdate(doc.uploadedAt)}, il s'agit en principe des revenus ${attendues[0]} ou ${attendues[1]}.`,
          source: SOURCE_DECRET.libelle, url: SOURCE_DECRET.url, date: quand });
      }
    }
  }
  if (verif.indices) {
    for (const t of indicesTechniques(verif.indices)) out.push(Object.assign(t, { titre: `${nomPiece(doc)} : ${t.titre.charAt(0).toLowerCase()}${t.titre.slice(1)}`, date: quand }));
  }
  return out;
}

/** Lignes de détail d'une vérification (pour la couche « Détail ») — données brutes, l'appelant échappe. */
export function detail(doc, verif) {
  const dd = verif && verif.deuxDDoc;
  return {
    piece: (doc && (doc.originalName || doc.name)) || '',
    le: verif ? fheure(verif.le) : '',
    deuxDDoc: dd ? {
      etat: dd.etat, motif: dd.motif, type: dd.typeLibelle, ac: dd.ac, certificat: dd.certificat, dateSignature: dd.dateSignature ? fdate(dd.dateSignature) : '',
      validite: dd.certificatValidite ? `du ${fdate(dd.certificatValidite.du)} au ${fdate(dd.certificatValidite.au)}` : '',
      revocation: dd.revocation ? `liste de révocation du ${fdate(dd.revocation.du)}, valable jusqu'au ${fdate(dd.revocation.au)}` : '',
      lignes: (dd.champs || []).map((c) => {
        const cmp = (dd.comparaisons || []).find((x) => x.id === c.id);
        return { libelle: c.libelle, valeur: c.id === '41' ? nombre(c.valeur) + ' €' : c.valeur, comparaison: cmp ? (cmp.statut === 'identique' ? 'Retrouvé dans le texte du fichier' : 'Non retrouvé dans le texte du fichier') : '' };
      }),
      identite: dd.identite === 'concorde' ? `Nom identique à l'identité déclarée${dd.qui === 'garant' ? ' du garant' : ''} (${dd.identiteAttendue}).` : dd.identite === 'differe' ? `Nom différent de l'identité déclarée (${dd.identiteAttendue}).` : '',
      svair: dd.svair || null, dgfip: estDgfip(dd)
    } : null,
    constats: (verif && verif.constats) || [],
    indices: verif && verif.indices ? verif.indices : null
  };
}

// ── VERIF-LISIBLE (v15.750) : un état par pièce, quelques lignes courtes au clic ───────────────────────────────────
// Décisions Didier 15-16/10 : « bon ou pas bon, pas de blabla ». Un mot par pièce (liste fermée) ; vert SEULEMENT pour
// une signature officielle vérifiée sans écart ; au clic, des lignes courtes (fait / écart / non contrôlé). Aucun mot
// « IA » tant qu'aucune lecture n'a eu lieu ; les règles de lecture sont consommées telles quelles ({code, ok, titre}),
// sans liste de codes en dur : ok true = respectée, ok false = écart, autre = non lue (abstention, jamais un écart).
export const ETATS_PIECE = Object.freeze({ ok: 'OK', averif: 'À vérifier', nonverif: 'Non vérifiable', nonlue: 'Non lue', attente: 'En attente' });
const RAISON_NON_VERIFIABLE = {
  ac_inconnue: 'émetteur absent de la liste de l\'État', certificat_introuvable: 'certificat introuvable', hors_validite: 'date de signature non valable',
  chaine: 'certificat non reconnu', revocation_inconnue: 'vérification reportée', version: 'format du code non pris en charge', caracteres: 'format du code non pris en charge', signature_absente: 'code sans signature'
};
const phraseCourte = (t) => { const s = String(t || '').trim().replace(/\.$/, ''); return s.charAt(0).toUpperCase() + s.slice(1); };
const sansPrefixe = (t) => phraseCourte(String(t || '').replace(/^[^:]*\s:\s/, ''));
// ── Raisons affichées sous le badge (décision de Didier, 16/10) : pour « À vérifier » et « Non vérifiable », UNE ligne
// visible sans clic : la CAUSE et QUOI VÉRIFIER, au ton neutre (infinitif). Données pures ; `rang` 1 = la plus importante.
const IMPOTS_GOUV = 'vérifier l\'avis sur impots.gouv avec le numéro fiscal et la référence de l\'avis';
export const RAISONS_PIECE = Object.freeze({
  illisible: ['Fichier illisible', 'demander le fichier d\'origine en PDF', 1],
  autreType: ['Le code officiel porte sur un autre type de document', 'vérifier que la pièce correspond à son intitulé', 1],
  autreCode: ['Un autre code officiel de la pièce n\'est pas conforme', 'vérifier la pièce d\'origine', 1],
  signeAbsent: ['Valeur signée absente du fichier', 'comparer la valeur signée et la valeur imprimée dans le détail', 1],
  nomDiffere: ['Nom différent de celui déclaré', 'un nom d\'usage peut l\'expliquer ; vérifier la pièce d\'identité', 1],
  avisAncien: ['Avis qui n\'est ni le dernier ni l\'avant-dernier', 'demander le dernier avis d\'imposition', 2],
  signatureInvalide: ['Code officiel non conforme', IMPOTS_GOUV, 1],
  signatureRevoquee: ['Signature révoquée par son émetteur', IMPOTS_GOUV, 1],
  signatureNonVerifiable: ['Signature officielle non vérifiable', 'comparer avec la pièce d\'origine', 2],
  signatureNonVerifiableAvis: ['Signature de l\'État non vérifiable', IMPOTS_GOUV, 2],
  codeIllisible: ['Code de l\'État illisible', IMPOTS_GOUV, 2],
  anneeNonComparee: ['Année des revenus non comparée', 'vérifier que l\'avis est le dernier ou l\'avant-dernier', 4],
  fichierModifie: ['Fichier modifié ou ré-enregistré après sa création', 'un ré-enregistrement peut l\'expliquer ; comparer avec la pièce d\'origine', 3],
  textesSuperposes: ['Deux textes superposés au même endroit', 'comparer les montants avec la pièce d\'origine', 2],
  datesAbsentes: ['Dates du fichier absentes', 'comparer les montants avec les autres pièces du dossier', 5],
  aucunCode: ['Aucun code officiel sur la pièce', 'comparer les montants avec les autres pièces du dossier', 6],
  pageIllisible: ['Page illisible pour la lecture des montants', 'lire les montants sur la pièce', 2],
  lectureReportee: ['Lecture des montants reportée', 'relancer la lecture plus tard', 4],
  montantsBulletin: ['Montants non lus avec certitude', 'comparer le net payé avec le virement du salaire sur le relevé bancaire', 3],
  montantsContrat: ['Contrat non comparé aux bulletins', 'vérifier la date d\'entrée et l\'employeur sur le contrat', 3],
  defaut: ['Aucun contrôle n\'a pu conclure', 'comparer la pièce aux autres pièces du dossier', 9],
});
const avec = (cle, ligne) => { const r = RAISONS_PIECE[cle]; return Object.assign(ligne, { cause: r[0], verifier: r[1], rang: r[2] }); };
/** Résumé d'une ligne pour un état « À vérifier » (écarts) ou « Non vérifiable » (contrôles non concluants) :
 *  la raison la plus importante, et le nombre d'autres raisons (consultables au clic). Null pour les autres états. */
export function resumeRaisons(etat, lignes) {
  if (etat !== 'averif' && etat !== 'nonverif') return null;
  const c = (lignes || []).filter((l) => l && l.cause && (etat === 'averif' ? l.type === 'ecart' : l.type === 'non')).sort((a, b) => (a.rang || 9) - (b.rang || 9));
  const t = c[0] || { cause: RAISONS_PIECE.defaut[0], verifier: RAISONS_PIECE.defaut[1] };
  return { cause: t.cause, verifier: t.verifier, texte: `${t.cause} — ${t.verifier}.`, autres: Math.max(0, c.length - 1) };
}
/** Résumé des constats de DOSSIER (période absente…) : même forme que resumeRaisons. */
export function resumeConstats(constats) {
  const c = (constats || []).filter((x) => x && x.cause).sort((a, b) => (a.rang || 9) - (b.rang || 9));
  if (!c.length) return null;
  return { cause: c[0].cause, verifier: c[0].verifier, texte: c[0].cause + ' — ' + c[0].verifier + '.', autres: c.length - 1 };
}
function lignesIndices(verif) {
  const out = []; const ind = verif.indices; if (!ind) return out;
  for (const t of indicesTechniques(ind)) {
    if (t.code === 'T1') {
      const a = lireDatePdf(ind.metadonnees && ind.metadonnees.creeLe), b = lireDatePdf(ind.metadonnees && ind.metadonnees.modifieLe);
      const j = a && b ? Math.floor((b - a) / 86400000) : 0;
      out.push(avec('fichierModifie', { type: 'ecart', texte: j ? `Fichier modifié ${j} jour${j > 1 ? 's' : ''} après sa création` : 'Fichier modifié après sa création' }));
    } else if (t.code === 'T2') out.push(avec('fichierModifie', { type: 'ecart', texte: `Fichier enregistré ${ind.enregistrements} fois` }));
    else if (t.code === 'T3') out.push(avec('textesSuperposes', { type: 'ecart', texte: phraseCourte(t.titre) }));
  }
  if (!out.length) {
    const m = ind.metadonnees || {};
    out.push(lireDatePdf(m.creeLe) && lireDatePdf(m.modifieLe) ? { type: 'ok', texte: 'Rien relevé dans le fichier' } : avec('datesAbsentes', { type: 'non', texte: 'Dates du fichier absentes : modifications non contrôlées' }));
  }
  return out;
}
/**
 * État d'une pièce et lignes du détail.
 * @param {object} p
 * @param {object} p.doc     entrée DB.documents
 * @param {object} p.verif   vérification à jour (actualiser) ou null
 * @param {object} [p.ia]    résultat de lecture de la pièce ({etat, regles:[{code, ok, titre}], constats:[{code, titre}]})
 * @param {boolean} [p.iaLue] une lecture a eu lieu (sinon aucune ligne de lecture, aucun mot « IA »)
 * @param {boolean} [p.refuse] dossier non retenu : les pièces ne sont plus relues
 * @returns {{etat, mot, vert:boolean, lignes:Array<{type:'ok'|'ecart'|'non', texte, vert?, lu?}>, impots:object|null, note:string}}
 */
export function etatPiece({ doc, verif, ia, iaLue, refuse }) {
  const fin = (etat, lignes, extra) => Object.assign({ etat, mot: ETATS_PIECE[etat], vert: false, lignes, impots: null, note: '' }, extra || {});
  if (!pieceConcernee(doc) && !iaLue) {
    const ident = doc && (doc.category === 'identite' || /^I(I)?\.A\./.test(String(doc.pieceType || '')));
    return fin('nonlue', [{ type: 'non', texte: ident ? 'Pièce d\'identité : jamais lue, à comparer à l\'œil' : 'Pas de contrôle automatique pour ce type de pièce' }]);
  }
  if (!verif && !iaLue) return refuse ? fin('nonlue', [{ type: 'non', texte: 'Non contrôlée : dossier non retenu' }]) : fin('attente', [{ type: 'non', texte: 'Contrôle fait à l\'ouverture de la fiche, sur l\'appareil' }]);
  const lignes = []; const v = verif || {};
  const estAvis = TYPES_AVIS.includes(String(doc.pieceType || ''));
  const estImage = /^image\//i.test(String(doc.mime || ''));
  const codes = new Set((v.constats || []).map((c) => c.code));
  const dd = v.deuxDDoc; let impots = null;
  if (v.illisible) lignes.push(avec('illisible', { type: 'non', texte: 'Fichier illisible' }));
  else if (verif) {
    if (dd && dd.etat === ETAT.VALIDE) {
      lignes.push({ type: 'ok', vert: true, texte: estDgfip(dd) ? 'Signature de la DGFiP vérifiée' : 'Signature officielle vérifiée' });
      if (codes.has('V8')) lignes.push(avec('autreType', { type: 'ecart', texte: 'Le code signé porte sur un autre type de document' }));
      if (dd.autresNonConformes) lignes.push(avec('autreCode', { type: 'ecart', texte: 'Un autre code de la pièce n\'est pas conforme' }));
      const cmp = dd.comparaisons || [];
      if (cmp.length) {
        const abs = cmp.filter((c) => c.statut === 'absent');
        if (abs.length) abs.forEach((c) => lignes.push(Object.assign(avec('signeAbsent', { type: 'ecart', texte: `${c.libelle} signé absent du fichier` }), { cause: `${c.libelle} signé absent du fichier` })));
        else lignes.push({ type: 'ok', texte: 'Données signées retrouvées dans le fichier' });
      } else if (TYPES_AVIS_IMPOT.includes(dd.type)) {
        const rfr = (dd.champs || []).find((c) => c.id === '41');
        lignes.push({ type: 'non', texte: 'Montants imprimés non comparés (image)' + (rfr && rfr.valeur ? ` : revenu fiscal de référence signé ${nombre(rfr.valeur)} €, à comparer avec la pièce` : '') });
      }
      const qui = dd.qui === 'garant' ? 'du garant' : 'du candidat';
      if (dd.identite === 'concorde') lignes.push({ type: 'ok', texte: `Nom identique au ${dd.qui === 'garant' ? 'garant' : 'candidat'}` });
      else if (dd.identite === 'differe') lignes.push(Object.assign(avec('nomDiffere', { type: 'ecart', texte: `Nom différent de celui ${qui} : ${(dd.nomsSignes || []).join(' · ')} (déclaré : ${dd.identiteAttendue || '—'})` }), { cause: `Nom différent de celui ${qui}` }));
      if (codes.has('V7')) lignes.push(Object.assign(avec('avisAncien', { type: 'ecart', texte: `Revenus ${dd.annee} : ni le dernier ni l'avant-dernier avis` }), { cause: `Avis des revenus ${dd.annee} : ni le dernier ni l'avant-dernier` }));
      else if (TYPES_AVIS_IMPOT.includes(dd.type) && dd.annee) lignes.push(doc.uploadedAt ? { type: 'ok', texte: 'Avis de l\'année attendue' } : avec('anneeNonComparee', { type: 'non', texte: `Revenus ${dd.annee} : année non comparée` }));
      if (dd.svair) impots = Object.assign({}, dd.svair);
    } else if (dd && dd.etat === ETAT.INVALIDE) {
      lignes.push(dd.code === 'revoque' ? avec('signatureRevoquee', { type: 'ecart', texte: 'Signature révoquée par son émetteur' }) : avec('signatureInvalide', { type: 'ecart', texte: 'Signature non conforme au code officiel' }));
    } else if (dd) {
      lignes.push(avec(estAvis ? 'signatureNonVerifiableAvis' : 'signatureNonVerifiable', { type: 'non', texte: 'Signature non vérifiable : ' + (RAISON_NON_VERIFIABLE[dd.code] || 'code non reconnu') }));
    } else if (estAvis) {
      lignes.push(avec('codeIllisible', { type: 'non', texte: estImage ? 'Code officiel illisible sur la photo' : 'Code officiel absent ou illisible' }));
    } else lignes.push(avec('aucunCode', { type: 'non', texte: 'Aucun code officiel lu' }));
    lignes.push(...lignesIndices(v));
  }
  // Lecture des montants (règles quelconques) : seulement si une lecture a eu lieu.
  let note = '';
  if (iaLue && ia) {
    if (ia.etat === 'illisible') { lignes.push(avec('pageIllisible', { type: 'non', texte: 'Non lu : page illisible', lu: true })); note = MENTION_PROPOSITION + '.'; }
    else if (ia.etat === 'ia_erreur') lignes.push(avec('lectureReportee', { type: 'non', texte: 'Lecture reportée', lu: true }));
    else {
      const regles = ia.regles || [];
      for (const r of regles) {
        if (r.ok === true) lignes.push({ type: 'ok', texte: phraseCourte(r.titre), lu: true });
        else if (r.ok === false) lignes.push(raisonRegle(r, { type: 'ecart', texte: phraseCourte(r.titre), lu: true }));
        else { const t = phraseCourte(r.titre); lignes.push(raisonRegle(r, { type: 'non', texte: 'Non lu : ' + t.charAt(0).toLowerCase() + t.slice(1), lu: true })); }
      }
      const dejaVues = new Set(regles.map((r) => r.code));   // une règle abstenue (ok null) ne devient jamais un écart par son constat
      for (const c of ia.constats || []) if (!dejaVues.has(c.code)) lignes.push(raisonRegle(c, { type: 'ecart', texte: sansPrefixe(c.titre), lu: true }));
      if (!regles.some((r) => r.ok === true || r.ok === false) && !(ia.constats || []).some((c) => !dejaVues.has(c.code))) lignes.push(avec(typeLectureIa(doc) === 'contrat' ? 'montantsContrat' : 'montantsBulletin', { type: 'non', texte: 'Montants non contrôlés', lu: true }));
      note = MENTION_PROPOSITION + '.';
    }
  } else if (typeLectureIa(doc)) lignes.push(avec(typeLectureIa(doc) === 'contrat' ? 'montantsContrat' : 'montantsBulletin', { type: 'non', texte: 'Montants non contrôlés' }));
  if (estAvis) {
    lignes.push({ type: 'non', texte: 'Dernier avis émis : à voir sur impots.gouv' });
    if (!impots) impots = {};
  }
  const ecart = lignes.some((l) => l.type === 'ecart');
  const signatureOk = !!(dd && dd.etat === ETAT.VALIDE);
  const controleFait = lignes.some((l) => l.type === 'ok');
  // REGLES-PAIE : bulletin lu par l'IA dont les montants n'ont pas tous conclu (règle à ok null hors B6, ou lecture sans
  // quorum) → jamais « OK », même si le contrôle local du fichier n'a rien relevé (net retapé dans un PDF aux dates cohérentes).
  const montantsNonConclus = !!(iaLue && ia && typeLectureIa(doc) && ia.etat !== 'illisible' && ia.etat !== 'ia_erreur'
    && ((typeLectureIa(doc) === 'bulletin' && ia.etat === 'lu') || (ia.regles || []).some((r) => r.ok !== true && r.ok !== false && r.code !== 'B6')));
  let etat = 'ok';
  if (ecart) etat = 'averif';
  else if (v.illisible || !controleFait || montantsNonConclus || (estAvis && !signatureOk) || (dd && dd.etat !== ETAT.VALIDE)) etat = 'nonverif';
  return fin(etat, lignes, { vert: etat === 'ok' && signatureOk, impots, note, resume: resumeRaisons(etat, lignes) });
}
/** Raison d'une règle de lecture (cause et quoi vérifier fournis par le module de règles), sinon raison générique. */
function raisonRegle(r, ligne) {
  if (r && r.cause && r.verifier) return Object.assign(ligne, { cause: String(r.cause), verifier: String(r.verifier), rang: Number(r.rang) || 5 });
  return avec('defaut', ligne);
}
/** Ligne de tête du dossier : compte des PIÈCES (jamais un avis sur la personne). Non lues et en attente hors du compte. */
export function resumePieces(etats) {
  const n = { ok: 0, averif: 0, nonverif: 0 };
  for (const e of etats || []) if (e && n[e.etat] != null) n[e.etat]++;
  const total = n.ok + n.averif + n.nonverif;
  const parts = total ? [`${n.ok} OK`] : [];
  if (n.averif) parts.push(`${n.averif} à vérifier`);
  if (n.nonverif) parts.push(`${n.nonverif} non vérifiable${n.nonverif > 1 ? 's' : ''}`);
  return Object.assign(n, { texte: parts.join(' · ') });
}

// ── Lot 3 : lecture IA des bulletins (règles dans regles-bulletin.js) ──
/** Pièce lue par l'IA : bulletin ou page 1 du contrat de travail (candidat ou garant), sinon null. */
export function typeLectureIa(doc) {
  const t = String((doc && doc.pieceType) || '');
  if (TYPES_BULLETIN.includes(t)) return 'bulletin';
  if (TYPES_CONTRAT.includes(t)) return 'contrat';
  return null;
}
