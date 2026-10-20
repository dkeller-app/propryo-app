// js/core/candidature.js
// Pure helpers candidature locataire (LOG-CANDIDATS). Aucun DOM, aucun effet de bord.
// Testés par __tests__/helpers/candidature.test.js. Exposés sur window via js/main.js.

/**
 * Message pré-rempli pour la demande de complément partagée (réutilisé par la popup
 * de partage). Rassure le candidat : son dépôt précédent est conservé.
 * @param {string} note - ce qui manque (peut être vide)
 * @param {string} bienLabel - libellé du bien (peut être vide)
 * @returns {string} message multi-lignes
 */
export function buildComplementShareMessage(note, bienLabel) {
  const bien = String(bienLabel || '').trim();
  const cible = bien ? ('votre dossier de location pour ' + bien) : 'votre dossier de location';
  const manque = String(note || '').trim();
  return 'Bonjour,\n\n'
    + 'Merci de compléter ' + cible + '.\n\n'
    + (manque ? ('Élément(s) à compléter : ' + manque + '\n\n') : '')
    + 'Votre dépôt précédent est conservé : reprenez simplement le dépôt via votre lien sécurisé ci-dessous.\n\n'
    + 'Conformément au RGPD, vos données ne sont utilisées que pour l\'étude de votre candidature, ne sont communiquées qu\'au propriétaire, et sont supprimées 30 jours après la décision si votre dossier n\'est pas retenu (droits d\'accès, de rectification et de suppression sur simple demande).\n\n'
    + 'Bien cordialement.';
}

/**
 * Pièces requises pour un dossier de location (décret n°2015-1437). Ce sont les
 * catégories des documents GED, alignées sur le formulaire de dépôt relais. Le garant
 * n'est PAS requis (le candidat peut n'en avoir aucun).
 */
export const PIECES_REQUISES = ['identite', 'domicile', 'situation', 'ressources'];

/**
 * Catégories requises ABSENTES du dossier (état factuel affiché à la place de l'ancien score),
 * dans l'ordre du décret. Pur — l'appelant rassemble les catégories depuis DB.documents.
 * @param {string[]} categoriesPresentes
 * @returns {string[]}
 */
export function categoriesManquantes(categoriesPresentes) {
  const set = new Set((Array.isArray(categoriesPresentes) ? categoriesPresentes : []).map(s => String(s || '')));
  return PIECES_REQUISES.filter(k => !set.has(k));
}

/**
 * Le candidat dispose-t-il d'une garantie ? Garant physique (nom renseigné) OU garantie Visale
 * (caution d'État Action Logement, n° de visa renseigné). Pur — réutilisé par la liste et la fiche.
 * @param {object} cand
 * @returns {boolean}
 */
export function candHasGarantie(cand) {
  if (!cand || typeof cand !== 'object') return false;
  const garant = !!(cand.garant && String(cand.garant.nom || '').trim());
  const visale = !!(cand.visale && String(cand.visale.visaId || '').trim());
  return garant || visale;
}

/** Libellé neutre de la garantie (liste des candidats) : Visale, Garant ou Aucune. */
export function libelleGarantie(cand) {
  if (!cand || typeof cand !== 'object') return 'Aucune';
  if (cand.visale && String(cand.visale.visaId || '').trim()) return 'Visale';
  if (cand.garant && String(cand.garant.nom || '').trim()) return 'Garant';
  return 'Aucune';
}

/** Mappe un candidat vers un objet locataire du bail (forme getBailLocs/renderBailLocs). */
export function _candidatVersLocataire(cand) {
  const empty = { civilite: '', nom: '', ddn: '', lieuNaiss: '', tel: '', email: '', adressePrecedente: '' };
  if (!cand || typeof cand !== 'object') return empty;
  const nomComplet = [cand.nom, cand.prenom].map(s => String(s || '').trim()).filter(Boolean).join(' ');
  return {
    civilite: cand.civilite || '',
    nom: nomComplet,
    ddn: cand.ddn || '',
    lieuNaiss: cand.lieuNaiss || '',
    tel: cand.tel || '',
    email: cand.email || '',
    adressePrecedente: cand.adressePrecedente || ''
  };
}

/** Mappe le garant d'un candidat vers la forme garant du bail, ou null si absent. */
export function _candidatVersGarant(cand) {
  const g = cand && cand.garant;
  if (!g || !String(g.nom || '').trim()) return null;
  return { nom: g.nom || '', adresse: g.adresse || '', ddn: g.ddn || '', lieu: g.lieu || '' };
}

/** Construit un candidat avec valeurs par défaut. partial écrase les défauts. */
export function _nouveauCandidat(partial = {}) {
  const now = new Date().toISOString();
  const id = partial.id || ('cand_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  return {
    id, ref: partial.ref || id,
    logRef: partial.logRef || '',
    entity: partial.entity || '',
    source: partial.source || 'manuel',
    civilite: partial.civilite || '', nom: partial.nom || '', prenom: partial.prenom || '',
    ddn: partial.ddn || '', lieuNaiss: partial.lieuNaiss || '',
    tel: partial.tel || '', email: partial.email || '',
    adressePrecedente: partial.adressePrecedente || '',
    dateDebutSouhaitee: partial.dateDebutSouhaitee || '',
    revenus: Number(partial.revenus) || 0,
    employeur: partial.employeur || '',
    employeurSiren: partial.employeurSiren || '',   // CANDIDATURES-CONFORMITE : SIREN/SIRET facultatif
    contrat: partial.contrat || '',
    garant: partial.garant || null,
    visale: partial.visale || null,
    piecesCompletes: partial.piecesCompletes || false,
    statut: partial.statut || 'recu',
    piecesVerifiees: partial.piecesVerifiees || false,
    notes: partial.notes || '',
    bailRef: partial.bailRef || '',
    dateCreation: partial.dateCreation || now,
    _modifiedAt: now,
    _archived: partial._archived || false
  };
}

/**
 * Retourne une nouvelle liste de documents où ceux rattachés au candidat candId
 * sont re-pointés vers le bail (parentType 'bail', parentRef = bailRef, logRef).
 * Les autres documents sont renvoyés inchangés. Pur — l'appelant réaffecte DB.documents.
 */
export function _migrerDocsCandidatVersBail(documents, candId, bailRef, logRef) {
  if (!Array.isArray(documents)) return [];
  const now = new Date().toISOString();
  return documents.map(d => {
    if (d && d.parentType === 'candidat' && String(d.parentId) === String(candId)) {
      return { ...d, parentType: 'bail', parentRef: String(bailRef),
               logRef: logRef != null ? String(logRef) : d.logRef, _modifiedAt: now };
    }
    return d;
  });
}

/**
 * Décide si un pull automatique des candidatures doit partir maintenant.
 * @param {number|null} lastPullTs - timestamp (ms) du dernier pull, 0/null si jamais
 * @param {number} now - Date.now()
 * @param {number} intervalMs - délai mini entre 2 pulls (défaut 180000 = 3 min)
 * @param {boolean} hasActiveLinks - existe-t-il ≥1 lien à rapatrier
 * @returns {boolean}
 */
export function shouldAutoPull(lastPullTs, now, intervalMs = 180000, hasActiveLinks = false) {
  if (!hasActiveLinks) return false;
  if (!lastPullTs) return true;
  return (now - lastPullTs) >= intervalMs;
}

/**
 * Grâce de rapatriement après expiresAt, alignée sur le TTL de l'ownerToken côté
 * relais (CANDIDATURE_GRACE_SECONDS = 7 j) : un dossier déposé in extremis reste
 * rapatriable pendant cette fenêtre.
 */
export const CANDIDATURE_PULL_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * true si le lien candidat est définitivement mort côté relais : expiresAt + grâce
 * dépassés. Au-delà, l'ownerToken HMAC est échu et le relais répond 401 (jamais
 * 404/410) à vie → continuer à tirer ne fait que du bruit console + réseau.
 * Sans expiresAt lisible (lien legacy) → false, on continue de tirer comme avant.
 */
export function candidatLinkExpire(link, nowMs) {
  if (!link || !link.expiresAt) return false;
  const t = Date.parse(link.expiresAt);
  if (!Number.isFinite(t)) return false;
  return nowMs >= t + CANDIDATURE_PULL_GRACE_MS;
}

/**
 * Partition des liens candidats pour le pull relais.
 * - pullable      : à tirer sur le réseau ('active'/'collected', non archivés, non expirés)
 * - expiredActive : 'active' mais mort (candidatLinkExpire) → à clore localement SANS réseau,
 *                   comme le ferait la réponse 404/410 du relais.
 * Les 'collected' expirés ne sont ni tirés ni touchés (déjà clos). Pur — l'appelant
 * applique les effets (statut, _stamp, saveDB).
 */
export function partitionCandidatLinks(links, nowMs) {
  const pullable = [], expiredActive = [];
  for (const l of (Array.isArray(links) ? links : [])) {
    if (!l || l._archived) continue;
    if (l.status !== 'active' && l.status !== 'collected') continue;
    if (candidatLinkExpire(l, nowMs)) {
      if (l.status === 'active') expiredActive.push(l);
      continue;
    }
    pullable.push(l);
  }
  return { pullable, expiredActive };
}

/** Nombre de candidatures non lues (vu === false), hors supprimées/archivées. */
export function countUnreadCandidats(candidats) {
  if (!Array.isArray(candidats)) return 0;
  return candidats.filter(c => c && c.vu === false && !c._deleted && !c._archived).length;
}

/** Texte du toast d'arrivée de nouveaux dossiers. */
export function nouveauDossierToast(newNames) {
  const names = (Array.isArray(newNames) ? newNames : []).map(s => String(s || '').trim()).filter(Boolean);
  const n = names.length;
  if (n === 0) return '📩 Nouveau dossier reçu';
  if (n === 1) return '📩 Nouveau dossier reçu : ' + names[0];
  return '📩 Nouveau dossier reçu : ' + names[0] + ' et ' + (n - 1) + ' autre' + (n - 1 > 1 ? 's' : '');
}

/** Texte du toast de mise à jour d'un dossier déjà déposé (ré-ouverture candidat / complément). */
export function majDossierToast(updatedNames) {
  const names = (Array.isArray(updatedNames) ? updatedNames : []).map(s => String(s || '').trim()).filter(Boolean);
  const n = names.length;
  if (n === 0) return '📝 Dossier mis à jour';
  if (n === 1) return '📝 Dossier mis à jour : ' + names[0];
  return '📝 Dossiers mis à jour : ' + names[0] + ' et ' + (n - 1) + ' autre' + (n - 1 > 1 ? 's' : '');
}

/**
 * Décide quoi faire d'une soumission relais lors du pull, vu l'état déjà connu du lien.
 * Gère la ré-ouverture candidat : un lien déjà 'collected' est re-tiré, mais on ne (re)importe
 * que si la soumission a changé (horodatage `submittedAt` différent), sinon on boucle.
 * Pur — testé. L'appelant gère les effets (import, persistance du baseline).
 *
 * @param {object} link - lien candidat ({ status, _lastSubmittedAt, candId })
 * @param {string} submittedAt - horodatage de soumission renvoyé par le relais
 * @param {string|null} candStatut - statut du candidat lié (pour stopper après décision)
 * @returns {'import'|'skip'|'baseline'}
 *   - 'import'   : (ré)importer + NOTIFIER le bailleur (nouvelle soumission ou maj détectée)
 *   - 'skip'     : ne rien faire (déjà importée, ou décision déjà prise)
 *   - 'baseline' : lien collecté hérité sans horodatage suivi (ex. importé avant le suivi) →
 *                  (ré)importer les données + pièces MAIS SANS notifier, et adopter `submittedAt`
 *                  comme référence. Évite une fausse notif rétroactive tout en ne perdant pas
 *                  une éventuelle ré-ouverture candidat survenue avant la 1re prise de référence.
 */
export function repullDecision(link, submittedAt, candStatut) {
  if (!link) return 'import';
  if (link.status !== 'collected') return 'import'; // 'active' → flux normal (1ère soumission / complément D13)
  if (candStatut === 'refuse' || candStatut === 'converti' || candStatut === 'valide') return 'skip'; // décision prise → fige (même un lien hérité, avant baseline)
  if (link._lastSubmittedAt == null) return 'baseline'; // hérité d'avant le suivi des ré-ouvertures
  if (submittedAt && submittedAt === link._lastSubmittedAt) return 'skip'; // même soumission, déjà importée
  return 'import';
}

/**
 * Loyer attendu d'un logement pour le taux d'effort d'un candidat (information), en cascade.
 * Pur — l'appelant rassemble les données depuis DB. Ordre validé : logement → ancien
 * locataire (dernier bail courant/historique avec un loyer) → loyer saisi à l'invitation.
 *
 * @param {object} src
 * @param {number} src.logHC      - loyer HC du logement (log.hc), source de vérité
 * @param {Array<{hc:number,fin?:string,locataire?:string}>} src.baux - baux courant + historiques du logement
 * @param {number} src.linkLoyer  - loyer saisi à l'invitation (link.loyer)
 * @returns {{loyer:number, source:'logement'|'ancien'|'invitation'|'manquant', locataire:(string|null)}}
 */
export function loyerAttenduForLog({ logHC = 0, baux = [], linkLoyer = 0 } = {}) {
  if (Number(logHC) > 0) return { loyer: Number(logHC), source: 'logement', locataire: null };
  const withHc = (Array.isArray(baux) ? baux : []).filter(b => b && Number(b.hc) > 0);
  if (withHc.length) {
    // Le plus récent fait foi : un bail en cours (sans 'fin') prime ; sinon tri par fin décroissante.
    withHc.sort((a, b) => String(b.fin || '9999').localeCompare(String(a.fin || '9999')));
    return { loyer: Number(withHc[0].hc), source: 'ancien', locataire: withHc[0].locataire || null };
  }
  if (Number(linkLoyer) > 0) return { loyer: Number(linkLoyer), source: 'invitation', locataire: null };
  return { loyer: 0, source: 'manquant', locataire: null };
}
