/**
 * core/pwa-install.js — « ajoute Propryo à ton écran d'accueil » (lot 2).
 *
 * CDC docs/CDC-EDL.md §3, verrou 4 :
 *   « Sur iPhone, un site NON installé voit Safari purger localStorage et
 *     IndexedDB après 7 jours sans visite — exactement là où vivent les photos
 *     et le miroir. Manifeste PWA + balises iOS + icônes, et une invitation à
 *     ajouter à l'écran d'accueil au premier lancement sur téléphone. »
 *
 * L'invitation n'est pas un gadget : sans installation, un état des lieux fait
 * en début de mois peut avoir disparu du téléphone à la fin du mois.
 *
 * Module pur : pas de DOM, pas de localStorage, pas de navigator. Tout entre
 * par arguments — c'est ce qui rend la règle testable.
 */

/** Délai avant de re-proposer après un refus (30 jours). */
export const REPROPOSER_APRES_MS = 30 * 24 * 60 * 60 * 1000;

/** Largeur au-dessus de laquelle on ne propose pas (l'enjeu est le téléphone). */
export const LARGEUR_TELEPHONE_MAX = 767;

/**
 * De quelle plateforme parle-t-on ? Détermine le MODE de l'invitation :
 * iOS n'expose aucune API d'installation, il faut décrire le geste.
 * @param {string} ua userAgent
 * @param {number} [maxTouchPoints] pour l'iPad qui se déclare « Macintosh »
 */
export function detectPlateforme(ua, maxTouchPoints = 0) {
  const s = String(ua || '');
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios';
  // iPadOS 13+ se présente comme un Mac : un Mac n'a pas d'écran tactile.
  if (/Macintosh/i.test(s) && maxTouchPoints > 1) return 'ios';
  if (/Android/i.test(s)) return 'android';
  return 'autre';
}

/**
 * L'app tourne-t-elle DÉJÀ installée ? (aucune invitation dans ce cas)
 * @param {{standaloneMedia?:boolean, navigatorStandalone?:boolean, referrer?:string}} ctx
 */
export function estInstalle({ standaloneMedia = false, navigatorStandalone = false, referrer = '' } = {}) {
  if (standaloneMedia) return true;             // display-mode: standalone (tous navigateurs)
  if (navigatorStandalone) return true;         // iOS Safari, écran d'accueil
  if (/^android-app:/.test(String(referrer))) return true;
  return false;
}

/**
 * Faut-il inviter, et sous quelle forme ?
 *
 * @param {object} ctx
 * @param {number}  ctx.largeur          largeur de la fenêtre
 * @param {boolean} ctx.installe
 * @param {string}  ctx.plateforme       'ios' | 'android' | 'autre'
 * @param {number}  [ctx.refuseA]        horodatage du dernier refus (0 = jamais)
 * @param {number}  ctx.maintenant
 * @param {boolean} [ctx.promptDisponible] un `beforeinstallprompt` a été capté
 * @returns {{afficher:boolean, mode:'ios'|'bouton'|null, motif:string}}
 */
export function decideInvitation({
  largeur = 0,
  installe = false,
  plateforme = 'autre',
  refuseA = 0,
  maintenant = 0,
  promptDisponible = false,
} = {}) {
  if (installe) return { afficher: false, mode: null, motif: 'deja-installe' };
  if (largeur > LARGEUR_TELEPHONE_MAX) return { afficher: false, mode: null, motif: 'pas-un-telephone' };
  if (refuseA && maintenant - refuseA < REPROPOSER_APRES_MS) {
    return { afficher: false, mode: null, motif: 'refus-recent' };
  }
  if (plateforme === 'ios') return { afficher: true, mode: 'ios', motif: 'ios-sans-api' };
  if (promptDisponible) return { afficher: true, mode: 'bouton', motif: 'prompt-natif' };
  // Android sans prompt (déjà consommé, critères non remplis) ou navigateur tiers :
  // on ne bricole pas d'instructions génériques qui seraient fausses.
  return { afficher: false, mode: null, motif: 'pas-de-chemin-d-installation' };
}

/** Le texte de l'invitation — un seul endroit, pour les deux modes. */
export function texteInvitation(mode) {
  if (mode === 'ios') {
    return {
      titre: 'Ajouter Propryo à l’écran d’accueil',
      corps: 'Sans ça, l’iPhone efface les photos d’état des lieux au bout de 7 jours sans ouvrir l’app. Appuyer sur Partager, puis « Sur l’écran d’accueil ».',
      action: null,
    };
  }
  return {
    titre: 'Installer Propryo sur le téléphone',
    corps: 'L’app s’ouvre plus vite, fonctionne hors ligne, et les photos d’état des lieux ne sont plus effacées par le navigateur.',
    action: 'Installer',
  };
}
