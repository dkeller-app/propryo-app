/**
 * core/gestion-dg-impayes.js — GESTION DG & IMPAYÉS v15.12 Sprint 12 V1.1
 *
 * Helpers purs (sans DB / DOM) pour :
 *   1. Tracking du dépôt de garantie (DG) : versé/dû/délai légal restitution
 *   2. Plan d'apurement (saisie échéances + tracking paiement)
 *   3. Procédure judiciaire (commandement huissier → assignation → jugement)
 *
 * Cadre légal :
 *   - Délai restitution DG : 1 mois après la remise des clés si l'EDL de sortie est conforme à l'entrée,
 *     2 mois sinon — règle unique : js/core/dg-delai.js
 *     - Loi 89-462 art. 22 modifiée par loi ALUR 2014
 *     - Au-delà du délai : pénalité 10% du loyer/mois entamé à charge bailleur
 *   - Procédure impayés :
 *     - LRAR mise en demeure → 8 jours
 *     - Commandement de payer par huissier (art. 24 loi 1989) → 2 mois
 *     - Assignation tribunal → jugement → expulsion
 *
 * Tests Vitest miroir : __tests__/helpers/gestion-dg-impayes.test.js
 */

// P9 (§7bis EDL, §9 inv. 34h) — LE résolveur unique de « l'EDL de sortie qui fait foi ».
// On RÉUTILISE celui du module edl-parcours (jamais une seconde copie du choix) : le
// délai de restitution doit lire le plus récent de la fenêtre du bail, pas le premier.
import { edlSortieQuiFaitFoi } from './edl-parcours.js';
// Le lecteur du DB VIVANT (getter `window.__immoGetDB`, repli sur le miroir) — jamais `window.DB` nu.
import { appDbFrom } from './utils.js';
// LA règle du délai de restitution (art. 22) : remise des clés, conformité, échéances, majoration.
import { conformiteEdlSortie, echeancesRestitution, etatDelai, penaliteRetard } from './dg-delai.js';

// ────────────────────────────────────────────────────────────────────────────
// Bloc A — Gestion DG
// ────────────────────────────────────────────────────────────────────────────

const DG_STATUS = {
  MANQUANT: 'manquant',          // DG dû mais non versé
  PARTIEL:  'partiel',            // versé < dû
  COMPLET:  'complet',            // versé >= dû
  A_RESTITUER: 'a_restituer',     // bail clôturé, DG à restituer dans délai
  RESTITUE: 'restitue',           // DG restitué (intégral ou partiel)
  EN_RETARD: 'en_retard',         // bail clôturé, délai légal dépassé
  // Conformité de l'EDL de sortie INCONNUE, entre l'échéance d'un mois et celle de deux mois : en retard
  // SI l'EDL de sortie est conforme, dans les temps sinon (art. 22 — pilotage 06/10).
  DEPASSEMENT_POSSIBLE: 'depassement_possible'
};

const _isoDe = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
/** dateRef (Date | 'AAAA-MM-JJ' | rien = aujourd'hui, date LOCALE) → 'AAAA-MM-JJ'. */
function _isoRef(dateRef) {
  if (dateRef instanceof Date) return Number.isNaN(dateRef.getTime()) ? _isoDe(new Date()) : _isoDe(dateRef);
  const m = /^\d{4}-\d{2}-\d{2}/.exec(String(dateRef || ''));
  return m ? m[0] : _isoDe(new Date());
}

/**
 * L'EDL de sortie qui fait foi pour CE bail. `edls` fourni : le résolveur unique dessus (l'appelant les a
 * déjà bornés au bail). Sinon : `_edlSortieDuBail` de l'app (EDL d'avant le début du bail SUIVANT — après
 * une relocation, la sortie du nouveau locataire n'est pas celle de l'ancien), à défaut le DB vivant.
 */
function _edlSortieDe(bail, edls) {
  if (edls) return edlSortieQuiFaitFoi(bail, edls);
  const W = (typeof window !== 'undefined') ? window : null;
  if (W && typeof W._edlSortieDuBail === 'function') return W._edlSortieDuBail(bail);
  return edlSortieQuiFaitFoi(bail, (appDbFrom(W)?.edl) || []);
}

/** Échéances de restitution d'un bail (dg-delai.js) avec l'EDL de sortie de CE bail. */
export function _dgEcheances(bail, edls) {
  return bail ? echeancesRestitution(bail, _edlSortieDe(bail, edls)) : null;
}

/**
 * LE DÉPÔT DE GARANTIE VERSÉ d'un bail — définition UNIQUE (R-0, audit d'intégration v15.728 🟠3, décision du pilote 07/10).
 * Lue par tous les calculs du dépôt : statut (_dgStatut), dépôts détenus (_dgDetenuDuBail), solde de restitution
 * (_calculerSoldeDG), clôture / décompte (_rgClotureCompute), fenêtre de restitution, frise du bail.
 *   • case « Dépôt de garantie versé » DÉCOCHÉE (dgVerse === false) → 0 : rien n'a été versé, rien n'est détenu, rien
 *     n'est à restituer ni déduit au solde ;
 *   • cochée, ou ABSENTE (bail antérieur à la case : l'app a toujours présumé le dépôt versé) → le montant versé saisi
 *     (dgPaid), sinon le dépôt du bail (dg), sinon `dgRepli` (dépôt de la fiche du lot, pour le seul bail courant).
 * @param {object} bail
 * @param {number|string} [dgRepli]
 * @returns {number}
 */
export function _dgVerseMontant(bail, dgRepli) {
  if (!bail || bail.dgVerse === false) return 0;
  return Number(bail.dgPaid) || Number(bail.dg) || Number(dgRepli) || 0;
}
/** La case du formulaire : un bail EXISTANT sans réponse s'affiche cochée (présumé versé) ; seule une case décochée
 *  enregistrée s'affiche décochée. Un NOUVEAU bail (aucun bail) s'affiche décoché. */
export function _dgVerseCoche(bail) {
  return !!bail && bail.dgVerse !== false;
}

/**
 * Calcule le statut DG d'un bail.
 * Bail clôturé : délai de restitution (art. 22) lu dans LA règle (dg-delai.js) — point de départ = remise des
 * clés (déclarée, sinon date de l'EDL de sortie, fin effective, fin), conformité = l'EDL de sortie de CE bail.
 * @param {object} bail - { dg, dgPaid, dgRestitueAt, cloture, depart, finEffective, fin }
 * @param {Date|string} [dateRef=today]
 * @param {Array} [edls] - EDL du bail (sinon résolus : _edlSortieDuBail)
 * @returns {{ statut, dgDu, dgPaid, soldeRestant, joursRestants?, joursRetard?, delaiMois?, limite?,
 *             limiteSiConforme?, limiteSinon?, conforme?, remise? }}
 */
export function _dgStatut(bail, dateRef, edls) {
  if (!bail) return { statut: DG_STATUS.MANQUANT, dgDu: 0, dgPaid: 0, soldeRestant: 0 };
  const dgDu = Number(bail.dg) || 0;
  const dgPaid = _dgVerseMontant(bail);   // définition unique du dépôt versé (case B4 comprise)
  const soldeRestant = dgDu - dgPaid;

  if (bail.dgRestitueAt) {
    return { statut: DG_STATUS.RESTITUE, dgDu, dgPaid, soldeRestant: 0 };
  }
  // Dépôt dû mais NON versé (case décochée) : rien à restituer, même bail clôturé.
  if (dgDu > 0 && dgPaid <= 0) return { statut: DG_STATUS.MANQUANT, dgDu, dgPaid, soldeRestant };

  // Bail clôturé → analyse du délai de restitution
  if (bail.cloture) {
    const ech = _dgEcheances(bail, edls);
    const et = etatDelai(ech, _isoRef(dateRef));
    if (ech && et) {
      // Mêmes clés que la copie inline (app-part2) — test de parité dg-statut-parite.test.js.
      const info = { dgDu, dgPaid, soldeRestant, delaiMois: ech.delaiMois, limite: ech.limite, limiteSiConforme: ech.limiteSiConforme, limiteSinon: ech.limiteSinon, conforme: ech.conforme, remise: ech.remise, joursSiConforme: et.joursSiConforme };
      if (et.etat === 'en_retard') return { statut: DG_STATUS.EN_RETARD, ...info, joursRetard: et.joursRetard };
      if (et.etat === 'depassement_possible') return { statut: DG_STATUS.DEPASSEMENT_POSSIBLE, ...info, joursRestants: et.jours };
      return { statut: DG_STATUS.A_RESTITUER, ...info, joursRestants: et.jours };
    }
  }

  // Bail actif
  if (dgPaid <= 0 && dgDu > 0) return { statut: DG_STATUS.MANQUANT, dgDu, dgPaid, soldeRestant };
  if (dgPaid < dgDu) return { statut: DG_STATUS.PARTIEL, dgDu, dgPaid, soldeRestant };
  return { statut: DG_STATUS.COMPLET, dgDu, dgPaid, soldeRestant: 0 };
}

/**
 * Délai APPLICABLE de restitution (art. 22) : 1 mois si l'EDL de sortie de CE bail est conforme à celui
 * d'entrée, 2 mois sinon — et 2 mois tant que la conformité est inconnue (pas d'EDL de sortie : 2 mois est
 * le seul maximum certain). Les retenues (`dgRetenu`) n'entrent plus en compte : une retenue pour loyer
 * impayé ne rend pas l'état des lieux non conforme (pilotage 06/10). Règle : dg-delai.js.
 * @param {object} bail
 * @param {Array} [edls] - EDL du bail (sinon résolus : _edlSortieDuBail)
 * @returns {1|2}
 */
export function _calculerDelaiRestitution(bail, edls) {
  if (!bail) return 2;
  return conformiteEdlSortie(_edlSortieDe(bail, edls)) === true ? 1 : 2;
}

/**
 * Calcule le solde de restitution DG = DG versé - retenues - loyers impayés.
 * @param {object} bail
 * @param {Array} mouvements
 * @returns {{ dgPaid, retenuesDG, loyerImpaye, soldeRestitue }}
 */
export function _calculerSoldeDG(bail, mouvements) {
  if (!bail) return { dgPaid: 0, retenuesDG: 0, loyerImpaye: 0, soldeRestitue: 0 };
  // `dgPaid` (versement effectif) n'est historiquement jamais renseigné → repli sur le DG dû
  // (`dg`) : au moment de la restitution, on rend le dépôt effectivement pris. Le repli vit ICI
  // (source unique) plutôt que recopié dans chaque surface (clôture, restitution). DRY.
  const dgPaid = _dgVerseMontant(bail);   // définition unique : case « versé » décochée → 0, sinon dgPaid, sinon dg
  const retenuesDG = Number(bail.dgRetenu) || 0;
  // MODÈLE DIDIER (anti double-compte, chantier Charges) : le dépôt couvre le LOYER impayé seul.
  // Les charges — même les provisions non versées — sont portées UNIQUEMENT par la régularisation
  // (via bail.dgRetenu), jamais re-comptées comme impayé. On prend donc resteLoyer (cascade
  // d'imputation loyer-d'abord, résolveur _loyerEtatLot), borné à la période réelle du bail
  // [debut, fin/sortie/aujourd'hui] — sinon la cascade génère du dû au-delà de la fin et gonfle
  // l'impayé. Fallback sur l'ancien cumul total (loyer+charges) si le résolveur n'est pas dispo.
  // _calculerLoyerImpayeCumule (total) reste utilisé pour les ALERTES impayés (où le total est juste).
  const W = (typeof window !== 'undefined') ? window : null;
  let loyerDu;
  if (W && typeof W._rgClotureImpayes === 'function' && typeof W._loyerEtatLot === 'function' && bail.ref) {
    const today = (typeof W.td === 'function') ? W.td() : new Date().toISOString().slice(0, 10);
    const finBail = bail.finEffective || bail.fin || (bail.depart && bail.depart.dateSortie) || today;
    loyerDu = W._rgClotureImpayes(bail.ref, bail.debut || null, finBail);
  } else {
    loyerDu = _calculerLoyerImpayeCumule(bail, mouvements);
  }
  // DÉPÔT DÉTENU (17/10) : la RETENUE POUR LOYER décidée à la restitution (`dgRetenueLoyer`, un règlement du loyer
  // par le dépôt) fait foi dès qu'elle est enregistrée, même à 0 (le bailleur ne retient rien) ; sinon les loyers
  // dus du bail lus dans le moteur unique (`loyerDu`, avant toute retenue — rendu pour être affiché à côté).
  const loyerImpaye = _dgRetenueLoyerDecidee(bail) ?? loyerDu;
  const soldeRestitue = Math.max(0, Math.round((dgPaid - retenuesDG - loyerImpaye) * 100) / 100);
  return { dgPaid, retenuesDG, loyerImpaye, loyerDu, soldeRestitue };
}

/** Le SOLDE DE TOUT COMPTE d'un bail est-il enregistré ? (décision pilotage 17/10, CDC Charges v15.574 « impayé = LOYER,
 *  charges = régul ») — restitution du dépôt datée (`dgRestitueAt`), ou solde enregistré sans date de virement
 *  (`dgRestitueMontant` posé par la confirmation), ou clôture ANCIENNE (sans `clotureV`) portant ses montants (même règle
 *  que les dépôts détenus). Alors les provisions de charges encore dues du bail sorti quittent l'arriéré affiché et passent
 *  à la régularisation de charges. */
export function _dgSoldeToutCompteEnregistre(bail) {
  if (!bail || bail._deleted) return false;
  if (bail.dgRestitueAt) return true;
  if (bail.dgRestitueMontant != null && bail.dgRestitueMontant !== '') return true;
  return !!bail.cloture && !bail.clotureV && (Number(bail.dgRestitue) > 0 || Number(bail.dgRetenu) > 0);
}

/** La retenue pour loyer sur le dépôt ENREGISTRÉE d'un bail (`dgRetenueLoyer`, ≥ 0, au centime), ou null si aucune
 *  n'a été décidée (champ absent ou vide). Lue par le solde de tout compte et par les dépôts détenus. */
export function _dgRetenueLoyerDecidee(bail) {
  if (!bail || bail.dgRetenueLoyer == null || bail.dgRetenueLoyer === '') return null;
  const v = Number(String(bail.dgRetenueLoyer).replace(',', '.'));
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
}

/**
 * Pénalité de retard de restitution du DG — article 22, loi 89-462 (mod. ALUR) : « le dépôt de garantie
 * restant dû au locataire est majoré d'une somme égale à 10 % du loyer mensuel en principal, pour chaque
 * période mensuelle commencée en retard », majoration non due si le locataire n'a pas transmis l'adresse de
 * son nouveau domicile (`bail.dgAdresseNonCommuniquee`). Calcul : dg-delai.js (`penaliteRetard`).
 *
 * Elle court depuis l'échéance APPLICABLE (2 mois si la conformité de l'EDL de sortie est inconnue). Celle
 * qui courrait depuis l'échéance d'un mois est rendue à part (`possible`) : elle se dit, elle ne
 * s'additionne JAMAIS au solde. La pénalité est au CRÉDIT du locataire (elle ne se retranche pas du dépôt).
 *
 * @param {object} bail - { hc, depart:{dateSortie}, finEffective, fin, dgRestitueAt, dgAdresseNonCommuniquee }
 * @param {Date|string} [dateRef=today] - date de restitution si dgRestitueAt absent (retard courant)
 * @param {Array} [edls] - EDL du bail (sinon résolus : _edlSortieDuBail)
 * @returns {{ moisRetard, penalite, base, dateLimite, exclue, enRetard, possible }}
 */
export function _penaliteRetardDG(bail, dateRef, edls) {
  const vide = { moisRetard: 0, penalite: 0, base: 0, dateLimite: null, exclue: false, enRetard: false, possible: null };
  if (!bail) return vide;
  // Art. 22 : la majoration porte sur « le dépôt de garantie restant dû au locataire ». Aucun dépôt VERSÉ (case décochée,
  // définition unique) → rien n'est dû, rien n'est majoré (relecture Fable 14/10 : sinon une pénalité était créditée
  // au locataire sur un dépôt jamais reçu).
  if (!_dgVerseCoche(bail)) return vide;   // case décochée (définition unique) ; un bail sans montant saisi garde le calcul d'avant
  const ech = _dgEcheances(bail, edls);
  if (!ech) return vide;
  const restitution = bail.dgRestitueAt ? String(bail.dgRestitueAt).slice(0, 10) : _isoRef(dateRef);
  return penaliteRetard(ech, { loyerPrincipal: Number(bail.hc) || 0, restitution, adresseNonCommuniquee: !!bail.dgAdresseNonCommuniquee });
}

/** Cumul des loyers impayés sur toute la durée du bail.
 *  @param dateRef optional — borne supérieure (= today si non fourni). Permet
 *  des tests déterministes. */
function _calculerLoyerImpayeCumule(bail, mouvements, dateRef) {
  if (!bail || !bail.debut) return 0;
  const debut = new Date(bail.debut + 'T00:00:00');
  const today = dateRef instanceof Date ? dateRef : new Date(String(dateRef||new Date().toISOString().slice(0,10)) + 'T00:00:00');
  const fin = bail.finEffective ? new Date(bail.finEffective + 'T23:59:59') :
              bail.fin ? new Date(bail.fin + 'T23:59:59') : today;
  if (Number.isNaN(debut.getTime())) return 0;
  const nbMois = Math.max(0, (fin.getFullYear()-debut.getFullYear())*12 + (fin.getMonth()-debut.getMonth()) + 1);
  const loyerMensuel = (Number(bail.hc)||0) + (Number(bail.ch)||0);
  const attendu = nbMois * loyerMensuel;
  const ref = bail.ref;
  const encaisse = (mouvements||[]).filter(m =>
    m && !m._deleted && m.qui === ref && (m.cr||0) > 0
  ).reduce((s,m) => s + (Number(m.cr)||0), 0);
  return Math.max(0, attendu - encaisse);
}

// ────────────────────────────────────────────────────────────────────────────
// Bloc B — Plan d'apurement
// ────────────────────────────────────────────────────────────────────────────

/**
 * Statut d'un plan d'apurement.
 * @param {object} plan - { dateDebut, montantTotal, echeances:[{date, montant, paye}] }
 * @param {Date|string} [dateRef]
 * @returns {{ statut: 'a_jour'|'retard'|'termine'|'aucun', montantPaye, montantDu, prochaineEcheance, retardJours }}
 */
export function _planApurementStatut(plan, dateRef) {
  if (!plan || !Array.isArray(plan.echeances) || !plan.echeances.length) {
    return { statut: 'aucun', montantPaye: 0, montantDu: 0, prochaineEcheance: null, retardJours: 0 };
  }
  const today = dateRef instanceof Date ? dateRef : new Date(String(dateRef||new Date().toISOString().slice(0,10)) + 'T00:00:00');
  let montantPaye = 0, montantDu = 0;
  let prochaineEcheance = null, retardJours = 0;
  for (const ech of plan.echeances) {
    if (!ech) continue;
    montantDu += Number(ech.montant) || 0;
    if (ech.paye) {
      montantPaye += Number(ech.montant) || 0;
    } else {
      // Première échéance non payée → prochaine
      if (!prochaineEcheance) {
        prochaineEcheance = ech.date;
        const dEch = new Date(ech.date + 'T23:59:59');
        if (!Number.isNaN(dEch.getTime())) {
          const j = Math.floor((today.getTime() - dEch.getTime()) / 86400000);
          if (j > 0) retardJours = j;
        }
      }
    }
  }
  if (montantPaye >= montantDu && montantDu > 0) {
    return { statut: 'termine', montantPaye, montantDu, prochaineEcheance: null, retardJours: 0 };
  }
  if (retardJours > 0) {
    return { statut: 'retard', montantPaye, montantDu, prochaineEcheance, retardJours };
  }
  return { statut: 'a_jour', montantPaye, montantDu, prochaineEcheance, retardJours: 0 };
}

// ────────────────────────────────────────────────────────────────────────────
// Bloc B — Procédure judiciaire
// ────────────────────────────────────────────────────────────────────────────

const PROCEDURE_ETAT = {
  AUCUNE:              'aucune',
  MISE_EN_DEMEURE:     'mise_en_demeure',     // LRAR envoyée
  COMMANDEMENT_PAYER:  'commandement_payer',  // huissier (art. 24 loi 1989)
  ASSIGNATION:         'assignation',          // tribunal
  JUGEMENT:            'jugement',             // jugement rendu (résiliation + expulsion)
  CLOTUREE:            'cloturee'              // procédure terminée (paiement / expulsion effective)
};

/**
 * Détermine l'état actuel de la procédure judiciaire selon les dates renseignées.
 * @param {object} procedure - { miseEnDemeureDate, commandementDate, assignationDate, jugementDate, clotureDate }
 * @returns {{ etat: string, prochaineSemainesAttente?: number, nbJoursDernEtape?: number }}
 */
export function _procedureJudiciaireEtat(procedure, dateRef) {
  if (!procedure) return { etat: PROCEDURE_ETAT.AUCUNE };
  const today = dateRef instanceof Date ? dateRef : new Date(String(dateRef||new Date().toISOString().slice(0,10)) + 'T00:00:00');
  // État = dernière étape franchie
  let etat = PROCEDURE_ETAT.AUCUNE;
  let derniereDate = null;
  if (procedure.miseEnDemeureDate)    { etat = PROCEDURE_ETAT.MISE_EN_DEMEURE;     derniereDate = procedure.miseEnDemeureDate; }
  if (procedure.commandementDate)     { etat = PROCEDURE_ETAT.COMMANDEMENT_PAYER;  derniereDate = procedure.commandementDate; }
  if (procedure.assignationDate)      { etat = PROCEDURE_ETAT.ASSIGNATION;         derniereDate = procedure.assignationDate; }
  if (procedure.jugementDate)         { etat = PROCEDURE_ETAT.JUGEMENT;            derniereDate = procedure.jugementDate; }
  if (procedure.clotureDate)          { etat = PROCEDURE_ETAT.CLOTUREE;            derniereDate = procedure.clotureDate; }

  const out = { etat };
  if (derniereDate) {
    const dD = new Date(derniereDate + 'T00:00:00');
    if (!Number.isNaN(dD.getTime())) {
      out.nbJoursDernEtape = Math.floor((today.getTime() - dD.getTime()) / 86400000);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Bloc B — Vue agrégée impayés actifs
// ────────────────────────────────────────────────────────────────────────────

// Exports utilitaires
export { DG_STATUS, PROCEDURE_ETAT };
// (_penaliteRetardDG est exporté à sa définition, bloc A)
