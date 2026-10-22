// js/core/mot-de-passe-oublie.js — MOT DE PASSE OUBLIÉ (écran de connexion, v15.774) : règles PURES de l'écran,
// testées (__tests__/helpers/mot-de-passe-oublie.test.js). Le câblage (DOM, supabase-js) vit dans
// js/app/supabase-entry.js (ouvrirRecuperation) et js/app/supabase-boot.js (envoi, vérification, nouveau mot de passe).
//
// Parcours, PAR CODE (le hook « Send Email » du relais n'envoie jamais de lien) :
//   1. adresse → supabase.auth.resetPasswordForEmail(email) → message IDENTIQUE que le compte existe ou non ;
//   2. code à 6 chiffres + nouveau mot de passe (deux fois) → verifyOtp({ email, token, type: 'recovery' })
//      → updateUser({ password }) → connecté.
// Un compte LOCATAIRE SEUL (0065) ne reçoit pas de mot de passe par cet écran : il se connecte par code depuis l'espace
// locataire. Garde d'ERGONOMIE, pas une barrière de sécurité : le code reçu ne donne pas plus qu'une connexion par code,
// et la 0065 admet qu'un compte déjà prouvé ajoute un mot de passe.

// Longueur minimale : celle de l'inscription (minlength="6" de l'écran, minimum par défaut de Supabase Auth).
export const MDP_MIN = 6
// Délai avant de pouvoir redemander un code : Supabase Auth refuse un nouvel envoi au même compte avant
// « max_frequency » (60 s par défaut sur le projet hébergé ; 1 s dans supabase/config.toml, local seulement).
export const DELAI_RENVOI_S = 60
export const LONGUEUR_CODE = 6

const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/

export const MESSAGES = Object.freeze({
  // Étape 1 → 2 : le même texte, que le compte existe ou non (pas d'énumération d'adresses).
  envoye: 'Si un compte Propryo existe pour cette adresse, un code à 6 chiffres vient d\'y être envoyé. Il est valable 10 minutes.',
  renvoye: 'Nouveau code demandé. Seul le dernier code reçu est valable.',
  email: 'Saisir une adresse e-mail valide.',
  code: 'Saisir le code à 6 chiffres reçu par e-mail.',
  mdpCourt: `Le mot de passe doit contenir au moins ${MDP_MIN} caractères.`,
  mdpDifferents: 'Les deux mots de passe ne sont pas identiques.',
  codeFaux: 'Code incorrect ou expiré : vérifier les 6 chiffres, ou demander un nouveau code.',
  limite: 'Trop de tentatives : patienter quelques minutes avant de réessayer.',
  reseau: 'Connexion au serveur impossible : vérifier le réseau puis réessayer.',
  indispo: 'Envoi du code indisponible pour le moment : réessayer dans quelques minutes.',
  memeMdp: 'Ce mot de passe est celui déjà utilisé : en choisir un autre.',
  mdpFaible: `Mot de passe refusé : choisir au moins ${MDP_MIN} caractères, plus difficile à deviner.`,
  locataire: 'Ce compte est un compte locataire : il se connecte sans mot de passe, avec un code, depuis l\'espace locataire (lien reçu du propriétaire).',
  autre: 'La demande n\'a pas abouti : réessayer.',
  succes: 'Mot de passe modifié. Connexion en cours…',
  modifie: 'Mot de passe modifié.',
})

export const normaliserEmail = (v) => String(v == null ? '' : v).trim().toLowerCase()
export const emailValide = (v) => { const e = normaliserEmail(v); return e.length <= 254 && EMAIL_RE.test(e) }
// Code saisi ou collé (« 123 456 », « 123-456 ») : chiffres seulement, 6 au plus.
export const normaliserCode = (v) => String(v == null ? '' : v).replace(/\D+/g, '').slice(0, LONGUEUR_CODE)

/** Étape 1 → { ok, email } | { ok:false, erreur } */
export function validerEtapeEmail(email) {
  return emailValide(email) ? { ok: true, email: normaliserEmail(email) } : { ok: false, erreur: MESSAGES.email, champ: 'email' }
}

/** Étape 2 → { ok, code } | { ok:false, erreur, champ } — rien n'est envoyé tant que la saisie est incomplète. */
export function validerEtapeCode({ code, mdp, mdp2 } = {}) {
  const c = normaliserCode(code)
  if (c.length !== LONGUEUR_CODE) return { ok: false, erreur: MESSAGES.code, champ: 'code' }
  const p = String(mdp == null ? '' : mdp)
  if (p.length < MDP_MIN) return { ok: false, erreur: MESSAGES.mdpCourt, champ: 'mdp' }
  if (p !== String(mdp2 == null ? '' : mdp2)) return { ok: false, erreur: MESSAGES.mdpDifferents, champ: 'mdp2' }
  return { ok: true, code: c }
}

/** Secondes restantes avant de pouvoir redemander un code (0 = possible). */
export function secondesAvantRenvoi(dernierEnvoiMs, maintenant = Date.now()) {
  if (!dernierEnvoiMs) return 0
  return Math.max(0, Math.ceil((dernierEnvoiMs + DELAI_RENVOI_S * 1000 - maintenant) / 1000))
}

/**
 * Erreur de supabase-js (AuthError : status, code, message) ou erreur réseau → clé de MESSAGES.
 * `etape` : 'envoi' | 'code' | 'mdp'. À l'envoi, une limite atteinte vaut « envoyé » (même écran que pour une adresse
 * inconnue : Supabase répond 200 sans rien envoyer pour elle).
 */
export function classerErreur(err, etape) {
  if (!err) return null
  const status = Number(err.status) || 0
  const code = String(err.code || '')
  const msg = String(err.message || err.error_description || err || '')
  if (err.name === 'AuthRetryableFetchError' || /failed to fetch|networkerror|network request|load failed|fetch failed|timeout/i.test(msg) || (status === 0 && /fetch/i.test(msg))) return 'reseau'
  if (status === 429 || /rate.?limit|too many|security purposes|over_/i.test(code + ' ' + msg)) return etape === 'envoi' ? 'envoye' : 'limite'
  if (etape === 'code' && (code === 'otp_expired' || code === 'otp_disabled' || status === 403 || /expired|invalid|token/i.test(msg))) return 'codeFaux'
  if (etape === 'mdp') {
    if (code === 'same_password' || /different from the old|same password/i.test(msg)) return 'memeMdp'
    if (code === 'weak_password' || /at least|weak|should be|too short/i.test(msg)) return 'mdpFaible'
  }
  if (status >= 500 || /indisponible|unavailable|hook/i.test(msg)) return 'indispo'
  return 'autre'
}
export const messageErreur = (err, etape) => { const k = classerErreur(err, etape); return k ? (MESSAGES[k] || MESSAGES.autre) : '' }
