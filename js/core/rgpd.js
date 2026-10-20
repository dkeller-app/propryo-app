/**
 * core/rgpd.js — Helpers RGPD (Sprint 3D RGPD-COMPLIANCE).
 *
 * V1 commerciale impose les droits art. 15-22 RGPD :
 *   - Accès (15) : collecter toutes les données d'une personne concernée
 *   - Portabilité (20) : export structuré JSON
 *   - Effacement (17) : suppression complète avec traçabilité audit
 *
 * Pattern : un locataire est identifié par son bail (clé = ref logement) +
 * son nom dans bail.locataires[]. Ses données sont éparpillées dans :
 *   - DB.baux[ref] : bail + locataires[]
 *   - DB.baux_historique[] : baux clôturés (locataire historique)
 *   - DB.mouvements[] : opérations financières liées (qui = ref logement)
 *   - DB.quittances[] : quittances de loyer
 *   - DB.edl[] : EDL d'entrée/sortie
 *   - DB.assurances[] / DB.mrh[] : contrats assurance liés
 *   - DB.irlHistorique[] : révisions IRL
 *   - DB.baux_evenements[] : journal des modifications d'un bail signé (valeurs avant/après : tél., e-mail, naissance…)
 *     et registre des avenants (type 'avenant' : noms des parties, document de l'avenant)
 *
 * IMPORTANT : "effacement" RGPD ne signifie pas "delete physique immédiat".
 * Pour la cohérence Drive sync (multi-device), on utilise des tombstones
 * (_deleted=true) qui propagent la suppression à tous les devices puis
 * la mémoire de tombstone est purgée à la fin de la rétention légale.
 */

/**
 * Collecte toutes les données associées à un logement (= un locataire pour
 * la durée d'un bail). Retourne un objet structuré exportable JSON.
 *
 * @param {Object} db - L'objet DB global (snapshot, pas muté)
 * @param {string} logRef - Référence logement (ex 'F-001')
 * @returns {Object} - { logement, bailCourant, bauxHistoriques, mouvements, quittances, edls, assurances, mrh, irlHistorique }
 */
export function _findPersonalDataForRef(db, logRef) {
  if (!db || !logRef) return null;
  const isAlive = e => e && !e._deleted;

  const logement = (db.logements || []).find(l => isAlive(l) && l.ref === logRef);
  const bailCourant = (db.baux && db.baux[logRef] && isAlive(db.baux[logRef])) ? db.baux[logRef] : null;
  const bauxHistoriques = (db.baux_historique || []).filter(b => isAlive(b) && b.ref === logRef);
  const mouvements = (db.mouvements || []).filter(m => isAlive(m) && m.qui === logRef);
  const quittances = (db.quittances || []).filter(q => isAlive(q) && q.logement === logRef);
  const edls = (db.edl || []).filter(e => isAlive(e) && e.logement === logRef);
  const assurances = (db.assurances || []).filter(a => isAlive(a) && a.logement === logRef);
  const mrh = (db.mrh || []).filter(m => isAlive(m) && m.logement === logRef);
  const irlHistorique = (db.irlHistorique || []).filter(h => isAlive(h) && h.ref === logRef);
  const journalBail = (db.baux_evenements || []).filter(e => isAlive(e) && String(e.ref || '').split('@@')[0] === logRef);
  // Registre des incidents : historique du BIEN (conservé), mais il peut nommer le locataire.
  const incidents = (db.incidents || []).filter(i => isAlive(i) && i.logRef === logRef);

  // Compte total
  const totalRecords = (logement ? 1 : 0) + (bailCourant ? 1 : 0) +
                       bauxHistoriques.length + mouvements.length + quittances.length +
                       edls.length + assurances.length + mrh.length + irlHistorique.length + journalBail.length + incidents.length;

  return {
    logRef,
    logement,
    bailCourant,
    bauxHistoriques,
    mouvements,
    quittances,
    edls,
    assurances,
    mrh,
    irlHistorique,
    journalBail,
    incidents,
    totalRecords,
    collectedAt: new Date().toISOString()
  };
}

/**
 * Génère un package portable RGPD (art. 20) — format JSON structuré.
 *
 * @param {Object} db - DB global
 * @param {string} logRef - Référence logement à exporter
 * @returns {string} - JSON formaté (string)
 */
export function _generateGdprExport(db, logRef) {
  const data = _findPersonalDataForRef(db, logRef);
  if (!data) return JSON.stringify({ error: 'logRef invalide ou DB null' }, null, 2);
  const pkg = {
    _meta: {
      app: 'Propryo',
      generatedAt: new Date().toISOString(),
      logRef,
      rgpdArticle: 'Art. 20 RGPD - Droit à la portabilité',
      format: 'JSON structuré',
      version: '1.0'
    },
    data
  };
  return JSON.stringify(pkg, null, 2);
}

/**
 * Génère la liste des opérations qui seraient effectuées pour effacer
 * les données personnelles d'un locataire. Ne mute PAS la DB.
 *
 * Permet à l'utilisateur de vérifier avant validation.
 *
 * @param {Object} db
 * @param {string} logRef
 * @returns {{operations: Array, totalRecords: number}}
 */
export function _planErasure(db, logRef) {
  const data = _findPersonalDataForRef(db, logRef);
  if (!data) return { operations: [], totalRecords: 0 };
  const operations = [];

  // Le logement lui-même n'est PAS effacé : il reste comme bien physique du bailleur.
  // On efface uniquement les références au locataire (nom + contact) dans le logement.
  if (data.logement) {
    operations.push({
      type: 'anonymize',
      collection: 'logements',
      entityRef: data.logement.ref,
      fields: ['locataire', 'tel', 'mail', 'debut', 'fin'],
      reason: 'Conservation du logement (bien physique) mais suppression des refs locataire'
    });
  }

  // Bail courant : tombstone (le bail est une obligation contractuelle, mais
  // post-RGPD-erasure, on peut le clôturer/supprimer après prescription 3 ans).
  if (data.bailCourant) {
    operations.push({
      type: 'tombstone',
      collection: 'baux',
      entityRef: data.bailCourant.ref || logRef,
      reason: 'Bail courant : effacement complet (post-prescription)'
    });
  }

  // Baux historiques : tombstone
  data.bauxHistoriques.forEach(b => {
    operations.push({
      type: 'tombstone',
      collection: 'baux_historique',
      entityId: b.id,
      entityRef: b.ref,
      reason: 'Bail historique : effacement complet'
    });
  });

  // Mouvements financiers : anonymize (garder les montants pour comptabilité
  // mais retirer la ref locataire dans les libellés)
  // ⚠️ Si l'utilisateur est mandataire Hoguet, garder 6 ans (art. L102B LPF)
  data.mouvements.forEach(m => {
    operations.push({
      type: 'anonymize',
      collection: 'mouvements',
      entityId: m.id,
      fields: ['lib', 'qui'],
      reason: 'Anonymisation libellé + référence (conserver montant pour compta)'
    });
  });

  // Quittances : tombstone (objet juridique daté, peut être conservé par bailleur 3 ans)
  data.quittances.forEach(q => {
    operations.push({
      type: 'tombstone',
      collection: 'quittances',
      entityId: q.id,
      reason: 'Quittance : effacement post-prescription'
    });
  });

  // EDL : tombstone (photos en IndexedDB à effacer manuellement)
  data.edls.forEach(e => {
    operations.push({
      type: 'tombstone',
      collection: 'edl',
      entityId: e.id,
      reason: 'EDL : effacement + purge IndexedDB photos liées'
    });
  });

  // Assurances : conservation des contrats (lien bailleur, pas locataire)
  // sauf si MRH locataire qui est lié spécifiquement
  data.mrh.forEach(m => {
    operations.push({
      type: 'tombstone',
      collection: 'mrh',
      entityId: m.id,
      reason: 'MRH locataire : effacement (assurance habitation au nom du locataire)'
    });
  });

  // IRL historique : conservation pour cohérence historique du bail
  // mais on retire le nom locataire dans h.locataire
  data.irlHistorique.forEach(h => {
    operations.push({
      type: 'anonymize',
      collection: 'irlHistorique',
      entityId: h.date + '|' + h.ref,
      fields: ['locataire'],
      reason: 'IRL historique : conservation chronologie + anonymisation locataire'
    });
  });

  // Journal des modifications d'un bail signé : contient les valeurs avant/après (données personnelles)
  (data.journalBail || []).forEach(e => {
    operations.push({
      type: 'tombstone',
      collection: 'baux_evenements',
      entityId: e.id,
      entityRef: logRef,
      reason: 'Journal du bail : effacement (valeurs personnelles avant/après)'
    });
  });

  // Incidents : le registre reste (historique du bien, preuves des travaux), le nom et la description sont anonymisés.
  (data.incidents || []).forEach(i => {
    operations.push({
      type: 'anonymize',
      collection: 'incidents',
      entityId: i.id,
      entityRef: logRef,
      fields: ['signaleParNom', 'description', 'elementLibre'],
      reason: 'Incident : conservation du registre du bien + anonymisation du locataire'
    });
  });

  return { operations, totalRecords: operations.length };
}

/**
 * Vérifie si un logRef est ÉLIGIBLE à l'effacement RGPD complet.
 * Critères :
 *   - Bail terminé depuis > 3 ans (prescription civile commune)
 *   - Ou utilisateur force avec consent
 *
 * @param {Object} db
 * @param {string} logRef
 * @returns {{eligible: boolean, reason: string, lastBailEnd: string}}
 */
export function _isEraseEligible(db, logRef) {
  const data = _findPersonalDataForRef(db, logRef);
  if (!data) return { eligible: false, reason: 'Données introuvables', lastBailEnd: '' };
  // Logement absent du DB → on ne sait pas, on bloque par défaut (safe)
  if (!data.logement) {
    return { eligible: false, reason: 'Logement introuvable dans la base', lastBailEnd: '' };
  }

  const allBails = [
    ...(data.bailCourant ? [data.bailCourant] : []),
    ...data.bauxHistoriques
  ];
  if (!allBails.length) {
    return { eligible: true, reason: 'Aucun bail trouvé pour ce logement — pas de contrat à protéger', lastBailEnd: '' };
  }

  // Un bail EN COURS non clôturé n'est jamais « terminé », quelle que soit sa date de fin
  // contractuelle : un bail nu/meublé se reconduit tacitement (R0-E). Avant, un bail nu signé en
  // 2019, échéance 2022, locataire toujours en place, devenait éligible à l'effacement complet.
  const cb = data.bailCourant;
  if (cb && !cb.cloture && !cb.finEffective) {
    return { eligible: false, reason: 'Bail en cours (non clôturé) — effacement impossible avant sa clôture', lastBailEnd: '' };
  }

  // Dernier bail terminé : on regarde le plus grand bail.fin
  const lastEnd = allBails
    .map(b => b.finEffective || b.fin || '')
    .filter(Boolean)
    .sort()
    .pop();

  if (!lastEnd) {
    return { eligible: false, reason: 'Bail toujours actif (pas de date fin) → impossible avant terme', lastBailEnd: '' };
  }

  const lastEndTs = new Date(lastEnd + 'T00:00:00').getTime();
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

  if (lastEndTs > threeYearsAgo.getTime()) {
    const remaining = Math.ceil((lastEndTs - threeYearsAgo.getTime()) / (365 * 86400000) * 12);
    return {
      eligible: false,
      reason: `Bail terminé le ${lastEnd} — prescription civile 3 ans non écoulée (encore ~${remaining} mois)`,
      lastBailEnd: lastEnd
    };
  }

  return { eligible: true, reason: `Bail terminé le ${lastEnd}, prescription dépassée`, lastBailEnd: lastEnd };
}
