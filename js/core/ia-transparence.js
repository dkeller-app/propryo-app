/**
 * js/core/ia-transparence.js — TRANSPARENCE ET RGPD du socle IA (chantier EDL-VOIX-IA, lot A2).
 *
 * Source UNIQUE des textes qui disent à l'utilisateur ce que fait l'IA :
 *   - la mention portée par chaque proposition (AI Act, art. 50 : en vigueur depuis le 2/08/2026) ;
 *   - la notice de première utilisation (finalité, fournisseur, sort de l'enregistrement) ;
 *   - la mention discrète du PDF signé (décision Didier 13/10, seulement si une proposition a été acceptée) ;
 *   - le marquage lisible par machine (`iaE` / `iaS` sur l'élément, `compteursIA` sur l'EDL).
 *
 * ┌─ RÉTENTION ZÉRO — CONSTANTE UNIQUE ────────────────────────────────────────────────────────────┐
 * │ RETENTION_ZERO = true : rétention zéro (Zero Data Retention) ACTIVÉE sur le compte Mistral le    │
 * │ 16/10/2026 (Admin › Confidentialité), entraînement sur les données désactivé. Elle couvre les     │
 * │ points d'accès SANS ÉTAT seulement : /v1/ocr, /v1/audio/transcriptions, /v1/chat/completions —   │
 * │ ceux qu'appelle le relais (relay/src/ai/provider.js) ; tout nouvel appel à un autre point d'accès │
 * │ (lots, fichiers, agents…) devra repasser cette constante à false. La notice dit alors « ne       │
 * │ conserve ni … ». À false, elle dit « 30 jours au plus pour la détection des abus ».              │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 * Ton neutre (charte M-13) : infinitif, générique, ni « tu » ni « vous ».
 */

// true depuis v15.761 (activation de la lecture des pièces) : rétention zéro activée par Mistral le 16/10/2026.
export const RETENTION_ZERO = true;

export const FOURNISSEUR = 'Mistral AI';

/** Sur chaque proposition (AI Act art. 50). */
export const MENTION_PROPOSITION = 'Proposé par l’IA, à vérifier';

/** Bandeau en tête de l'écran des propositions. */
export const BANDEAU_PROPOSITIONS = {
  titre: 'Proposé par l’IA, à vérifier.',
  texte: 'Rien n’est inscrit dans l’état des lieux sans validation, élément par élément.',
};

/** Pied du PDF signé, seulement si au moins une proposition a été acceptée (décision 13/10). */
export const MENTION_PDF = 'Observations préparées avec une aide à la dictée (IA), relues et validées par les parties.';

/** Ce que dit la notice du fournisseur, selon la rétention effectivement activée. */
export function phraseConservationFournisseur(retentionZero = RETENTION_ZERO) {
  return retentionZero
    ? `${FOURNISSEUR} ne conserve ni l’enregistrement ni le texte (rétention zéro) et ne s’en sert pas pour entraîner ses modèles.`
    : `${FOURNISSEUR} garde les échanges 30 jours au plus pour détecter les abus, puis les supprime, et ne s’en sert pas pour entraîner ses modèles.`;
}

/**
 * Notice de première utilisation (affichée une fois par compte, relisible ensuite).
 * Renvoie { titre, sousTitre, intro, sections:[{icone, titre, texte}] } — du texte brut, échappé à l'affichage.
 */
export function notice({ retentionZero = RETENTION_ZERO } = {}) {
  return {
    titre: 'Dicter la pièce',
    sousTitre: 'Avant la première utilisation',
    intro: 'Commenter la pièce à voix haute : le texte est transcrit, puis une IA propose un état et une observation pour chaque élément cité. Rien n’est inscrit sans validation, élément par élément.',
    sections: [
      { icone: 'shield', titre: 'Qui traite la dictée', texte: `${FOURNISSEUR}, société française, serveurs dans l’Union européenne, sous-traitant de Propryo.` },
      { icone: 'trash', titre: 'Ce qui est conservé', texte: `L’enregistrement n’est pas conservé : il est envoyé, transcrit, puis supprimé de l’appareil et du serveur de Propryo. S’il ne peut pas partir (pas de réseau, service indisponible, rien entendu), il reste sur l’appareil jusqu’à l’envoi ou sa suppression, 30 jours au plus. La transcription reste sur l’appareil le temps de la relecture, puis est effacée. Seul le texte validé entre dans l’état des lieux. ${phraseConservationFournisseur(retentionZero)}` },
      { icone: 'info', titre: 'Prévenir les personnes présentes', texte: 'Avant de dicter, prévenir le locataire ou toute personne présente que la pièce est décrite à voix haute et analysée par une IA. Éviter de citer des informations personnelles (noms, santé, opinions).' },
      { icone: 'sparkle', titre: 'L’IA peut se tromper', texte: `Chaque proposition porte la mention « ${MENTION_PROPOSITION} ». L’état des lieux reste contradictoire et signé par les deux parties.` },
    ],
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ÉTAT DES LIEUX FILMÉ (EDL-VIDEO-IA, GO Didier 14/10/2026) — textes, source unique.
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** PDF signé quand au moins une PHOTO tirée d'une vidéo a été gardée (remplace MENTION_PDF). */
export const MENTION_PDF_VIDEO = 'Observations et photos préparées avec une aide à la dictée et à l’image (IA), relues et validées par les parties.';
/** Cadre « Vidéos » du PDF : la copie au locataire passera par l'espace locataire (chantier à venir). */
export const MENTION_COPIE_VIDEO = 'Vidéos conservées par le bailleur pendant le bail puis trois ans après la restitution du dépôt de garantie (art. 7-1 de la loi n° 89-462 du 6 juillet 1989), plus longtemps seulement en cas de litige en cours, puis supprimées ; copie remise au locataire sur demande. L’empreinte permet de vérifier qu’une vidéo n’a pas été modifiée.';
/** Sous la liste des accords dans le PDF : comment l'accord a été recueilli (ratifié par la signature). */
export const MENTION_ACCORD_VIDEO = 'Accord recueilli avant de filmer sur l’appareil utilisé pour l’état des lieux, chaque locataire présent cochant sa case ; confirmé par la signature du présent état des lieux.';

/**
 * Écran d'ACCORD avant de filmer (une fois par état des lieux). Le locataire présent lit et coche
 * LUI-MÊME sa case (jamais pré-cochée). Base retenue : intérêt légitime (preuve de l'état du logement)
 * avec accord préalable de chaque locataire présent — à faire valider par l'avocat dans l'AIPD.
 */
export function noticeVideo({ retentionZero = RETENTION_ZERO } = {}) {
  return {
    titre: 'Filmer l’état des lieux',
    sousTitre: 'Accord avant de filmer',
    intro: 'La visite est filmée pièce par pièce, avec le son, pour garder une preuve de l’état du logement, à l’appui de l’état des lieux. Des images tirées de la vidéo sont analysées par une IA pour proposer des photos et des observations. Rien n’est inscrit sans validation des deux parties.',
    sections: [
      { icone: 'shield', titre: 'Qui traite les images et le son', texte: `${FOURNISSEUR}, société française, serveurs dans l’Union européenne, sous-traitant de Propryo. Seules quelques images et le son partent à l’analyse, jamais la vidéo entière. ${phraseConservationFournisseur(retentionZero).replace('ni l’enregistrement ni le texte', 'ni les images ni le son')}` },
      { icone: 'folder', titre: 'Où la vidéo est gardée', texte: 'La vidéo entière est enregistrée dans l’espace Propryo du bailleur (stockage Supabase, serveurs dans l’Union européenne), accessible aux seules personnes autorisées pour ce logement. Elle n’est jamais modifiée ; une empreinte permet de le vérifier.' },
      { icone: 'clock', titre: 'Combien de temps la vidéo est gardée', texte: 'Pendant le bail, puis trois ans après la restitution du dépôt de garantie (prescription de l’article 7-1 de la loi du 6 juillet 1989) ; plus longtemps seulement en cas de litige en cours. Ensuite, elle est supprimée automatiquement.' },
      { icone: 'info', titre: 'Ce qui n’est pas filmé', texte: 'Éviter de filmer les personnes. Les objets personnels n’entrent pas dans l’état des lieux. Une copie de la vidéo est remise au locataire sur demande.' },
      { icone: 'check', titre: 'Refuser reste possible', texte: 'Sans accord, l’état des lieux se fait sans vidéo, à la voix ou à la main, exactement comme d’habitude.' },
    ],
    accord: 'J’accepte que cet état des lieux soit filmé.',
    // Statut juridique à valider par l'avocat dans l'AIPD : intérêt légitime (preuve) ; l'accord vaut information et
    // absence d'opposition préalable du locataire présent (« Continuer sans vidéo » = opposition, rien n'est filmé).
  };
}

/** Version de la notice d'accord = empreinte de son texte (FNV-1a) : un accord renvoie au texte EXACT lu. */
export function versionNoticeVideo(n = noticeVideo()) {
  const s = JSON.stringify(n);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'nv-' + h.toString(16).padStart(8, '0');
}

/** L'EDL porte-t-il au moins une photo tirée d'une vidéo (gardée) ? */
export function edlAPhotosVideo(edl) {
  if (!edl || typeof edl !== 'object') return false;
  for (const p of edl.pieces || []) {
    for (const x of (p && p.elements) || []) {
      for (const ph of [...((x && x.photosE) || []), ...((x && x.photosS) || [])]) if (ph && ph.video && ph.video.videoId) return true;
    }
  }
  return false;
}

/** Mention du PDF : vidéo si une photo tirée d'une vidéo a été gardée, sinon dictée (si aide IA), sinon rien. */
export function mentionPdf(edl) {
  if (edlAPhotosVideo(edl)) return MENTION_PDF_VIDEO;
  return edlAAideIA(edl) ? MENTION_PDF : '';
}

/** Marque lisible par machine posée sur un élément inscrit depuis une proposition. */
export function marqueIA({ etat, obs, modele, maintenant = new Date() }) {
  return { etat: !!etat, obs: !!obs, at: maintenant.toISOString(), modele: String(modele || '') };
}

/** L'EDL porte-t-il au moins une valeur inscrite depuis une proposition de l'IA ? (→ mention du PDF) */
export function edlAAideIA(edl) {
  if (!edl || typeof edl !== 'object') return false;
  const marque = (m) => !!(m && (m.etat || m.obs));
  for (const p of edl.pieces || []) {
    for (const x of (p && p.elements) || []) {
      if (marque(x && x.iaE) || marque(x && x.iaS)) return true;
    }
  }
  const c = edl.compteursIA;
  if (c && typeof c === 'object' && Object.keys(c).length) return true;
  return edlAPhotosVideo(edl);   // EDL-VIDEO-IA : une photo de la vidéo gardée = aide de l'IA
}

/**
 * VERIF-DOCUMENTS lot 3 — notice de la lecture des bulletins de salaire par l'IA (écran « Lire avec l'IA »).
 * Ce qui part, qui le traite, ce qui est gardé, ce que fait l'IA. Ton neutre.
 */
export function noticeBulletins({ retentionZero = RETENTION_ZERO } = {}) {
  return {
    titre: 'Lire les bulletins avec l’IA',
    intro: 'L’IA lit les montants ; des règles écrites vérifient les calculs. Aucun avis n’est donné sur la personne.',
    sections: [
      { icone: 'upload', titre: 'Ce qui part', texte: 'La première page de chaque bulletin de salaire et du contrat de travail, en image. Pièce d’identité, avis d’imposition et justificatif de domicile restent sur l’appareil.' },
      { icone: 'shield', titre: 'Qui la lit', texte: `${FOURNISSEUR}, société française, lecture effectuée dans l’Union européenne (point d’accès européen), sous-traitant de Propryo. ${phraseConservationFournisseur(retentionZero).replace('ni l’enregistrement ni le texte', 'ni les images ni le texte')}` },
      { icone: 'trash', titre: 'Ce qui est gardé', texte: 'Seules les valeurs lues (période, montants, employeur, dates) sont gardées avec le dossier ; elles sont supprimées avec lui. L’image envoyée n’est pas conservée par Propryo.' },
      { icone: 'check', titre: 'Ce que fait l’IA', texte: `${MENTION_PROPOSITION} : l’IA recopie les valeurs, chaque valeur se corrige, et les constats viennent de règles écrites (Code du travail, art. R3243-1 ; arrêté du 25/02/2016). Aucun score, aucun classement, aucune décision automatique.` },
    ],
  };
}
