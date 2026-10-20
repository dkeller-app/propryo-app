// js/core/auth-storage.js — stockage du jeton de session Supabase, avec le choix « Rester connecté sur cet appareil ».
//
// Règle de confidentialité (F14.2, poste partagé) :
//   - par défaut (case décochée) : le jeton vit en sessionStorage → fermer l'onglet / le navigateur DÉCONNECTE ;
//     rien ne reste lisible pour la personne suivante sur un poste partagé ;
//   - case « Rester connecté » cochée : le jeton vit en localStorage → la session survit à la fermeture du
//     navigateur (poste personnel) ;
//   - application INSTALLÉE (PWA, display-mode standalone) : toujours localStorage (usage terrain : l'EDL hors
//     ligne exige que la session survive à la fermeture) — la case n'y est pas proposée.
// Interface = celle qu'attend supabase-js (`storage` : getItem / setItem / removeItem).
//
// AUCUN drapeau « se souvenir » : un drapeau survivrait à la déconnexion et rendrait le poste persistant pour la
// PERSONNE SUIVANTE (audit). La persistance se déduit de l'endroit où le jeton EXISTE ; déconnecté (jetons effacés),
// tout redevient « session » et la case n'est jamais pré-cochée.
//   - choix de l'utilisateur : posé par setPersist() AU CLIC sur « Se connecter ». Il s'IMPOSE à la 1re écriture du
//     jeton (la connexion) : le jeton d'une AUTRE personne déjà présent dans l'autre stockage ne doit jamais attirer
//     le nouveau jeton chez lui (audit : sinon B hériterait d'un jeton local persistant sans l'avoir coché) ;
//   - ensuite (rafraîchissement du jeton, dans n'importe quel onglet), l'écriture suit l'emplacement existant :
//     jamais déplacé, sinon l'autre onglet serait déconnecté.

export function createAuthStorage({ local, session, standalone = false }) {
  const sur = (fn) => { try { return fn() } catch (e) { return null } }
  const connus = new Set()           // clés écrites par ce stockage (jeton, code-verifier PKCE…)
  let persist = !!standalone
  let impose = false                 // armé par setPersist (clic) ; consommé par la 1re écriture du JETON (pas du verifier)

  const ou = (k) => (sur(() => local.getItem(k)) != null ? 'local' : (sur(() => session.getItem(k)) != null ? 'session' : null))
  const magasin = (nom) => (nom === 'local' ? local : session)

  return {
    // lit d'abord en local (session persistante), sinon en sessionStorage
    getItem(k) { const a = sur(() => local.getItem(k)); return a != null ? a : sur(() => session.getItem(k)) },
    // écrit selon le choix (1re écriture après le clic) ou là où le jeton existe déjà (rafraîchissement) ; retire
    // toute copie de l'autre stockage (jamais 2 jetons, jamais le jeton d'une autre personne qui traîne)
    setItem(k, v) {
      connus.add(k)
      const voulu = persist ? 'local' : 'session'
      const cible = standalone ? 'local' : (impose ? voulu : (ou(k) || voulu))
      sur(() => magasin(cible).setItem(k, v))
      sur(() => magasin(cible === 'local' ? 'session' : 'local').removeItem(k))
      if (impose && !/-code-verifier$/.test(k)) impose = false
    },
    removeItem(k) { connus.delete(k); sur(() => local.removeItem(k)); sur(() => session.removeItem(k)) },
    // choix de l'utilisateur (case) ; déplace aussi un jeton déjà connu de ce stockage vers le mode voulu. Sans effet
    // en application installée (toujours persistante).
    setPersist(b) {
      if (standalone) return
      persist = !!b; impose = true
      for (const k of connus) {
        const ici = ou(k), voulu = persist ? 'local' : 'session'
        if (ici && ici !== voulu) {
          const v = sur(() => magasin(ici).getItem(k))
          if (v != null) { sur(() => magasin(voulu).setItem(k, v)); sur(() => magasin(ici).removeItem(k)) }
        }
      }
    },
    // un échec de connexion ne doit pas laisser l'obligation armée pour une écriture ultérieure sans rapport
    annulerChoix() { impose = false },
    isPersistent() { return persist },
    isStandalone() { return !!standalone },
  }
}

// Purge UNIQUE d'un jeton resté en localStorage par une ancienne version du site (avant que le navigateur ne passe en
// sessionStorage) : sans cela, quiconque ouvre le site sur ce poste serait connecté en tant que l'ancien utilisateur,
// indiscernable d'une persistance voulue (audit). Posée une fois ; les jetons persistants écrits ENSUITE (case cochée)
// ne sont jamais touchés. Ce marqueur ne mémorise AUCUN choix : il ne sert qu'à ne purger qu'une fois.
export const MIGRATION_KEY = 'immo-auth-stockage-v2'
export function purgerJetonLocalLegacy({ local, cles, standalone = false }) {
  try {
    if (standalone || local.getItem(MIGRATION_KEY) === '1') return false
    for (const k of cles) local.removeItem(k)
    local.setItem(MIGRATION_KEY, '1')
    return true
  } catch (e) { return false }
}
