// js/core/version-app.js — Contrôle « onglet périmé » avant de signer ou de régénérer le PDF d'un
// bail signé (PARAPHE-UNIQUE, audit 01/10).
//
// POURQUOI : en cloud, l'app ne recharge jamais un onglet ouvert après un déploiement. Un onglet
// périmé qui signe ou régénère un PDF le fait avec l'ANCIEN code, qui peut ne pas savoir lire une
// forme de données plus récente (ex. paraphes compactés) et l'écraser. Avant ces gestes, on demande
// au serveur la version servie ; si elle est plus récente que celle de l'onglet, on n'ouvre pas et on
// demande de recharger. Échec réseau (hors ligne, délai) = on continue : jamais bloquer hors ligne.
//
// SOURCE de la version servie : `sw.js` (CACHE_VER = 'immotrack-vX.Y'), déjà bumpé à chaque
// livraison avec IMMOTRACK_VERSION (garde : __tests__/helpers/version-app.test.js) ; petit fichier,
// servi en réseau d'abord par le service worker (règle .js). Aucune nouvelle source à bumper.
//
// ⚠️ Sérialisé par toString() dans la popup de signature : aucune variable libre.

/** Version lue dans le texte de sw.js ('15.709'), ou null. */
export function versionDepuisSw(texte) {
  var m = /CACHE_VER\s*=\s*['"]immotrack-v(\d+(?:\.\d+)*)['"]/.exec(String(texte || ''));
  return m ? m[1] : null;
}

/** `servie` est-elle STRICTEMENT plus récente que `courante` ? Comparaison numérique par segment. */
export function versionPlusRecente(servie, courante) {
  if (!servie || !courante) return false;
  var a = String(servie).split('.'), b = String(courante).split('.');
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    var x = parseInt(a[i] || '0', 10), y = parseInt(b[i] || '0', 10);
    if (isNaN(x) || isNaN(y)) return false;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * La version SERVIE (lue dans sw.js à `url`, sans cache) est-elle plus récente que `courante` ?
 * Toute la lecture — réponse ET corps — est bornée à `delaiMs` (défaut 4 s) : un corps qui ne
 * finit jamais d'arriver ne doit pas figer la signature. Échec, délai, réponse illisible → false
 * (on continue : jamais bloquer hors ligne). Utilise `versionDepuisSw` et `versionPlusRecente`
 * (injectées sous ces noms dans la popup).
 */
export async function versionServieRecente(url, courante, delaiMs) {
  var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var to = null;
  var delai = new Promise(function (res) {
    to = setTimeout(function () { try { if (ctl) ctl.abort(); } catch (e) {} res(false); }, delaiMs || 4000);
  });
  var lecture = (async function () {
    try {
      var r = await fetch(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      if (!r || !r.ok) return false;
      var texte = await r.text();
      return versionPlusRecente(versionDepuisSw(texte), courante);
    } catch (e) { return false; }
  })();
  try { return await Promise.race([lecture, delai]); }
  finally { clearTimeout(to); }   // levé APRÈS la lecture du corps (ou l'expiration), jamais avant
}

export const MSG_VERSION_SIGNER = 'Une nouvelle version de l’app est disponible : recharger la page (Ctrl+F5) avant de signer.';
export const MSG_VERSION_PDF = 'Une nouvelle version de l’app est disponible : recharger la page (Ctrl+F5) avant de régénérer le PDF du bail signé.';
export const MSG_FORMAT_INCONNU = 'Ce bail a été signé avec une version plus récente de l’app : recharger la page (Ctrl+F5) pour l’ouvrir.';
