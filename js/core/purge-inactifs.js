// js/core/purge-inactifs.js — PURGE RGPD DES COMPTES PROPRIÉTAIRES INACTIFS ET VIDES (migration 0069, décision Didier
// 23/10/2026, phase 1 / option A). Fonction PURE, miroir EXACT du prédicat SQL _pci_compte_vide_inactif : aucune donnée,
// aucun effet de bord, testable isolément (__tests__/helpers/purge-inactifs.test.js). La BASE fait foi ; ce module sert les
// tests et, le cas échéant, un affichage côté app.
//
// On ne supprime AUTOMATIQUEMENT qu'un compte propriétaire SANS AUCUNE donnée métier, APRÈS deux e-mails d'avertissement.

const JOUR_MS = 86400000;

// Réglages (miroir des littéraux de 0069 ; la tâche du relais passe 60 à pci_echeances/pci_purger).
export const SEUIL_INACTIF_JOURS = 60;   // aucune connexion depuis ce délai
export const PREAVIS_JOURS = 30;         // délai annoncé dans l'annonce avant suppression
export const RAPPEL_AVANT_JOURS = 7;     // rappel envoyé ce nombre de jours avant la date annoncée

/**
 * Un compte propriétaire est-il VIDE et INACTIF (donc éligible à la purge automatique) ? Miroir de
 * _pci_compte_vide_inactif (0069).
 *
 * @param {object} compte
 * @param {boolean} compte.surAllowlist    — l'adresse est dans beta_allowlist (marqueur « compte propriétaire bêta »).
 * @param {boolean} compte.estAdmin        — super-admin (app_admins) → exclu.
 * @param {boolean} compte.estRelais       — identité technique du relais (el_relais) → exclu.
 * @param {number|null} compte.derniereConnexion — last_sign_in_at en ms (null = jamais connecté).
 * @param {number|null} compte.creeLe       — created_at en ms (repli d'inactivité quand jamais connecté).
 * @param {boolean} compte.membreDAutrui    — membre (espace_members) d'un espace qu'il n'a pas créé → exclu.
 * @param {boolean} compte.associeEntite     — associé (entite_membre) d'une entité → exclu.
 * @param {Array<{vide:boolean, partage:boolean, abonnementActif:boolean}>} compte.espacesPossedes — ses espaces (created_by).
 * @param {object} [opts]
 * @param {number} [opts.joursInactif=60]
 * @param {number} [opts.maintenant=Date.now()]
 * @returns {boolean}
 */
export function estProprietaireVideInactif(compte, opts = {}) {
  const c = compte || {};
  const jours = Math.max(Number.isFinite(opts.joursInactif) ? opts.joursInactif : SEUIL_INACTIF_JOURS, 1);
  const maintenant = Number.isFinite(opts.maintenant) ? opts.maintenant : Date.now();

  // 1. Compte propriétaire (bêta), ni admin, ni relais. Un compte locataire n'est jamais sur l'allowlist → exclu.
  if (!c.surAllowlist || c.estAdmin || c.estRelais) return false;

  // 2. Inactif : jamais connecté (repli sur la création) OU dernière connexion antérieure au seuil.
  const reference = Number.isFinite(c.derniereConnexion) ? c.derniereConnexion
    : (Number.isFinite(c.creeLe) ? c.creeLe : null);
  if (reference === null) return false;                 // date inconnue : jamais éligible (prudence)
  if (reference >= maintenant - jours * JOUR_MS) return false;

  // 3. Ne collabore à aucun espace d'autrui (membre ou associé).
  if (c.membreDAutrui || c.associeEntite) return false;

  // 4. TOUS ses espaces : vides, non partagés, sans abonnement actif.
  const espaces = Array.isArray(c.espacesPossedes) ? c.espacesPossedes : [];
  for (const e of espaces) {
    if (!e || !e.vide || e.partage || e.abonnementActif) return false;
  }
  return true;
}

/**
 * Date de suppression annoncée (miroir de pci_echeances) : au plus tard dans PREAVIS_JOURS, au plus tôt dans
 * RAPPEL_AVANT_JOURS (pour laisser le temps du rappel même si l'annonce part en retard).
 * @param {number} [maintenant=Date.now()]
 * @returns {number} ms
 */
export function dateSuppressionAnnoncee(maintenant = Date.now()) {
  return Math.max(maintenant + PREAVIS_JOURS * JOUR_MS, maintenant + RAPPEL_AVANT_JOURS * JOUR_MS);
}
