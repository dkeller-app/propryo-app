// js/core/login-breadcrumb.js — Fil d'Ariane de diagnostic du login (BUG-LOGIN-DOUBLE, P0 vente).
//
// Constat : « il faut se connecter 2× pour atteindre l'Accueil » est une COURSE (un reload survenu
// entre le login et le dévoilement de l'app détruit la session ; le principal déclencheur est le SW
// `controllerchange` qui tire un location.reload() pendant la fenêtre post-login) — donc difficile à
// reproduire à la demande. On pose une trace horodatée dans sessionStorage (qui SURVIT à
// location.reload() dans le MÊME onglet, contrairement aux variables mémoire) : au prochain incident,
// la séquence enregistrée prouve la cause sans nouvelle hypothèse. Exemple d'un double-login prouvé :
//   login-start → login-ok → sw-controllerchange → sw-reload → entry-boot → login-start (RE-login !)
// alors qu'un login sain donne : login-start → login-ok → accueil-revealed.
//
// Ce module ne touche AUCUNE API navigateur : il ne fait que la décision PURE (ring-buffer + parse
// fail-safe), testée unitairement. L'EXÉCUTION (sessionStorage.getItem/setItem + console) vit dans le
// wiring : window.__immoCrumb (posé au tout début de boot() dans supabase-entry.js) et le handler
// `controllerchange` d'index.html.

// Clé sessionStorage de la trace. Distincte des clés de données (immotrack_v4…) : purge indépendante,
// aucun risque de collision, et sans donnée personnelle (juste des libellés d'étape + timestamps).
export const BREADCRUMB_KEY = 'immo_login_trace'

// Plafond du ring-buffer : on ne garde que les N étapes les plus récentes (un onglet vivant longtemps
// ne fait pas croître la trace sans fin). Large assez pour couvrir plusieurs cycles login/reload.
const DEFAULT_CAP = 64

// Parse fail-safe : renvoie TOUJOURS un tableau des entrées bien formées {t:number, e:string}.
// Entrée absente / JSON invalide / non-tableau / entrées mal formées → filtrées, jamais de throw.
export function readCrumbs(raw) {
  if (!raw || typeof raw !== 'string') return []
  let arr
  try { arr = JSON.parse(raw) } catch (_e) { return [] }
  if (!Array.isArray(arr)) return []
  return arr.filter(c => c && typeof c === 'object' && typeof c.t === 'number' && typeof c.e === 'string')
}

// Ajoute une étape {t, e} au ring-buffer et renvoie le JSON à ré-écrire. `event` est coercé en chaîne
// (robuste aux valeurs absentes). `ts` = horodatage (Date.now() côté wiring — passé en argument pour
// rester pur et testable). Ne throw jamais : une trace de diagnostic ne doit RIEN casser du login.
export function appendCrumb(raw, event, ts, cap = DEFAULT_CAP) {
  const list = readCrumbs(raw)
  list.push({ t: ts, e: event == null ? '' : String(event) })
  const n = (typeof cap === 'number' && cap > 0) ? cap : DEFAULT_CAP
  const trimmed = list.length > n ? list.slice(list.length - n) : list
  try { return JSON.stringify(trimmed) } catch (_e) { return '[]' }
}
