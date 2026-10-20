/**
 * RESET-CLOUD UX — cœur PUR du geste « ⚠️ Vider mon espace cloud » (Réglages, mode cloud).
 *
 * Sécurité : la GARDE réelle est côté serveur (RPC purge_mon_espace, migration 0041 —
 * owner actif + nom exact re-vérifiés en SECURITY DEFINER). Ce module ne porte que le
 * confort UX : activer/désactiver les gestes, valider la saisie avant d'appeler la RPC,
 * traduire les erreurs. Il ne doit JAMAIS être considéré comme une protection.
 *
 * Testé dans __tests__/helpers/espace-purge.test.js ; l'orchestration impure (modale,
 * export JSON préalable, appel RPC, logout) vit inline dans index.html + supabase-entry.js.
 */

/** Saisie de confirmation = nom exact de l'espace, sémantique btrim du serveur :
 *  trim des deux côtés, comparaison stricte (casse/accents), jamais de match sur vide. */
export function confirmNameMatches(input, expected) {
  const a = String(input == null ? '' : input).trim()
  const b = String(expected == null ? '' : expected).trim()
  return a !== '' && b !== '' && a === b
}

/** Quels gestes afficher dans la card « Import & restauration » :
 *  legacy/sandbox → bouton reset historique inchangé ; cloud → « Vider cet appareil »
 *  + « Vider mon espace cloud » (activé seulement pour le propriétaire de l'espace). */
export function purgeUiState(opts) {
  const o = opts || {}
  if (!o.cloudMode) return { variant: 'legacy' }
  return { variant: 'cloud', canPurgeEspace: o.isOwner === true }
}

/** Erreur RPC purge_mon_espace → message utilisateur (fr). Fail-safe : jamais de throw. */
export function purgeErrorMessage(error) {
  const msg = String((error && error.message) || '')
  if (/PURGE_NOT_OWNER/.test(msg)) return 'Seul le propriétaire de l\'espace peut vider l\'espace cloud.'
  if (/PURGE_CONFIRM_MISMATCH/.test(msg)) return 'Le nom saisi ne correspond pas au nom exact de l\'espace — rien n\'a été supprimé.'
  if (/permission denied|could not find the function|does not exist/i.test(msg)) {
    return 'Purge indisponible côté serveur (fonction purge_mon_espace absente ou non autorisée) — rien n\'a été supprimé.'
  }
  return 'Purge impossible — rien n\'a été supprimé.' + (msg ? ' Détail : ' + msg : '')
}
