// js/app/supabase-entry.js — Entrée du MODE CLOUD (Supabase) du monolithe.
//
// CLOUD-ONLY (cutover « Connexion B », 2026-06-23) : Supabase est la SEULE persistance. Toute page servie
// en http(s) boote ici (login → hydrate → app). Le module reste INERTE uniquement sur le harnais de test
// (index-test*.html / ?sandbox=1), qui garde son storage local isolé _test_*. Google Drive a été retiré.
//
// ÉTAPE 2a (ce fichier) : login email/mdp (Variante A) → résout l'espace → HYDRATE les vraies données
// depuis Supabase dans une variable LOCALE → affiche les compteurs (preuve bout-en-bout dans le navigateur).
// Ne touche PAS window.DB ni le rendu (ça vient à l'étape 2b). Donc zéro interférence avec l'app derrière.

import { BREADCRUMB_KEY, appendCrumb } from '../core/login-breadcrumb.js'
import { createAuthStorage, purgerJetonLocalLegacy } from '../core/auth-storage.js'   // « Rester connecté sur cet appareil »
// EDL TERRAIN lot 1, faille F5 (CDC docs/CDC-EDL.md §3ter, invariant 19j) :
// une modification fraîche ne réarme plus le backoff de réessai. Avec l'autosave
// de l'EDL (une écriture toutes les 2 s), l'ancien `schedule` replanifiait un
// flush à 800 ms en permanence → ~1 800 requêtes en échec sur une heure hors ligne.
import { planFlush, FLUSH_DEBOUNCE_MS } from '../core/sync-schedule.js'
// Clé PROD du miroir localStorage — SOURCE UNIQUE (l'entry ne tourne jamais en
// mode test). Elle était redéclarée ici ET dans le module ; deux définitions
// d'une même clé de stockage finissent toujours par diverger.
import { MIROIR_KEY as MIRROR_KEY } from '../core/offline-boot.js'
import { makeDetUuid } from '../core/det-uuid.js'   // P0-4 : id d'audit DÉTERMINISTE (anti-doublons, DRY)
// LE lecteur du DB vivant (getter d'abord, repli sur le miroir, try/catch). Ce fichier portait déjà
// le bon geste à la main ; on appelle le helper testé plutôt que d'en garder deux copies.
import { appDbFrom } from '../core/utils.js'
// MOT DE PASSE OUBLIÉ (v15.774) : règles pures de l'écran (validation, délai de renvoi, classement des erreurs).
import * as _mdpOublie from '../core/mot-de-passe-oublie.js'
// CANDIDATURES-CONFORMITE : garde de forme des chemins envoyés à la suppression Storage (testée).
import { cheminFichierCandidatValide, estCleNue } from '../core/candidature-purge.js'

const FLAG = (() => {
  try {
    const path = (location.pathname || '').toLowerCase()
    const inSandbox = /[?&](sandbox|demo)=1/.test(location.search || '')   // ?demo=1 : compte démo local (aucun cloud)
    const served = location.protocol === 'http:' || location.protocol === 'https:'
    // HARNAIS DE TEST — les pages index-test*.html / ?sandbox=1 restent en mode legacy/démo isolé
    // (storage local _test_*). Le module cloud y est INERTE : aucun login, aucun réseau. Même détection
    // que le boot-gate (head) et _isTestMode (index.html) → ne pas diverger.
    const isTestPage = path.endsWith('index-test.html') || path.endsWith('/test') || path.includes('-test.') || inSandbox
    if (isTestPage) return false
    // CLOUD-ONLY (cutover « Connexion B », 2026-06-23 — Google Drive PHYSIQUEMENT retiré) : toute page
    // servie en http(s) boote sur Supabase, sans échappatoire. Le bi-mode et le flag immo_use_supabase
    // sont supprimés (l'ancien `?supabase=0` / localStorage immo_use_supabase=0 n'a plus aucun effet).
    return served
  } catch { return false }
})()

// v15.437 FIX-CDN-VENDORED — client Supabase SELF-HOSTED (même origine github.io), plus de CDN runtime.
// Avant : import dynamique depuis esm.sh → sur un réseau d'entreprise qui bloque/filtre esm.sh (pare-feu,
// DNS, proxy), le boot échouait ou traînait pour TOUS les navigateurs → app cassée chez le client (démo).
// Désormais : fichier vendored `js/vendor/supabase-js-2.110.2.esm.js` (UMD officiel wrappé ESM, exposant
// { createClient }), servi par github.io comme le reste de l'app → aucune dépendance tierce au chargement.
// Régénérer : curl UMD `@supabase/supabase-js@<ver>/dist/umd/supabase.js` + wrapper ESM (voir en-tête du fichier).
const CDN = new URL('../vendor/supabase-js-2.110.2.esm.js', import.meta.url).href
const COUNTS = [
  ['entites', 'entités'], ['logements', 'logements'], ['baux', 'baux'], ['mouvements', 'mouvements'],
  ['quittances', 'quittances'], ['edl', 'états des lieux'], ['documents', 'documents'],
  ['mrh', 'assurances locataire'], ['agenda', 'agenda'], ['baux_historique', 'historique baux'],
]
const sizeOf = c => (Array.isArray(c) ? c.length : (c && typeof c === 'object' ? Object.keys(c).length : 0))

// ── P0-4 (audit sécurité) — synchro du journal d'audit vers la table SERVEUR append-only `audit_log`.
// Le journal local (DB.auditTrail, dans le blob espace_config_private) reste un CACHE ; l'AUTORITÉ
// inviolable est la table serveur : un membre ne peut plus effacer/altérer ses traces en réécrivant le
// blob. Purement ADDITIF. Idempotent (id client + ON CONFLICT DO NOTHING via upsert ignoreDuplicates →
// compatible append-only, aucun UPDATE requis). return=minimal (pas de .select()) → aucune lecture, donc
// indépendant de la policy SELECT is_full_member (F1). ETL AUTOMATIQUE : les entrées historiques (sans
// _syncedAt) sont backfillées au 1er flush (client_ts = ts d'origine). OFFLINE : elles restent non-synced
// et sont re-tentées au prochain flush cloud réussi et sur l'événement `online`.
let _auditCloudBusy = false
async function _auditCloudFlush() {
  if (_auditCloudBusy || !_supaClient || !_cloudEspaceId) return
  // DB VIVANT via getter (window.DB est un miroir qui peut être périmé après réassignation du let DB).
  const _db = appDbFrom(window)
  const trail = (_db && Array.isArray(_db.auditTrail)) ? _db.auditTrail : null
  if (!trail) return
  const pending = trail.filter(e => e && !e._syncedAt)
  if (!pending.length) return
  _auditCloudBusy = true
  try {
    // id DÉTERMINISTE dérivé du CONTENU (réutilise det-uuid.js — DRY) → la MÊME entrée donne le MÊME id
    // à chaque réessai/reload → ON CONFLICT DO NOTHING dédoublonne SANS dépendre d'une persistance de l'id
    // (fix F-A de l'audit : plus de doublons indélébiles si l'id n'a pas été sauvegardé avant un reload).
    const _det = makeDetUuid('immotrack-audit')
    for (const e of pending) {
      if (!e.id) e.id = _det(e.ts || '', e.action || '', e.entityType || '', e.entityId != null ? String(e.entityId) : '', e.userId || '')
    }
    const toRow = e => ({
      id: e.id,
      espace_id: _cloudEspaceId,
      action: String(e.action || 'update').slice(0, 40),
      entity_type: String(e.entityType || 'inconnu').slice(0, 60),
      entity_id: e.entityId != null ? String(e.entityId).slice(0, 200) : null,
      entity_ref: e.entityRef != null ? String(e.entityRef).slice(0, 200) : null,
      diff: e.diff || null,
      source: String(e.source || 'ui').slice(0, 20),
      user_name: e.userName != null ? String(e.userName).slice(0, 120) : null,
      client_ts: e.ts || null   // heure d'action (informative) ; `ts` serveur (trigger) fait foi
    })
    const now = new Date().toISOString()
    for (let i = 0; i < pending.length; i += 500) {   // chunké (backfill historique possiblement volumineux)
      const chunk = pending.slice(i, i + 500)
      const { error } = await _supaClient.from('audit_log')
        .upsert(chunk.map(toRow), { onConflict: 'id', ignoreDuplicates: true })
      if (error) { console.warn('[audit] cloud flush', error.message || error); break }
      for (const e of chunk) e._syncedAt = now   // marqué synchronisé → plus jamais renvoyé
    }
  } catch (e) { console.warn('[audit] cloud flush', e) }
  finally { _auditCloudBusy = false }
}
try { window.addEventListener('online', () => { try { _auditCloudFlush() } catch (e) {} }) } catch (e) {}
try { window.__immoAuditFlushCloud = _auditCloudFlush } catch (e) {}

// DÉCOUPLAGE cloud↔Drive — espace courant (posé au login) pour résoudre les chemins Supabase Storage des
// fichiers : `<espaceId>/files/<idbKey>`. Lu par le helper window.__immoCloudFileUrl (ouverture de documents).
let _cloudEspaceId = null
// L'espace « primaire » ci-dessus est-il VRAIMENT à l'utilisateur ? Un associé INVITÉ (sans espace à lui,
// full_espace=false) reçoit l'espace du PROPRIÉTAIRE en repli (`_espaces[0]`) : celui-ci n'est pas « propre ».
let _cloudEspaceMine = false
let _cloudOwnerId = null  // owner de l'espace (posé au login) = namespace du detUuid → résout l'entite_id d'une SCI (chemin Storage par-SCI)
let _supaClient = null   // client supabase (posé au boot) — pour le canal Realtime de synchro live
let _makeDetUuid = null  // fabrique d'uuid déterministe (importée au boot) — pour window.__immoEntiteUuid
let _espaceOwners = {}   // MULTI-ESPACE : espaceId → ownerId (tous les espaces vus). Une SCI TIERS vit sous
//   l'espaceId de SON propriétaire et son entite_id se dérive avec LE detUuid de ce propriétaire → résolution
//   par-entité (jamais l'owner propre figé). Vide / un seul espace à N=1 → tout retombe sur l'espace propre.
let _liveDBRef = null    // réf vers le DB fusionné vivant (= liveDB), pour résoudre l'espace/owner d'une SCI
let _resolveEntiteOwner = null, _resolveEspaceOfSeg = null   // résolveurs PURS (store-multi.js) — résolution par-SCI
let _espacesListe = null, _peutEcrireSci = null, _gereSciEnPlein = null   // liste de resolveEspaces (mine + peutEcrire par SCI) + règle PURE (store-multi.js) → window.__immoPeutEcrireSci

// ── P1.3 (audit sync cloud 2026-07-12) — purge cache RGPD + signal Realtime honnête ──────────────
// Le miroir localStorage (écrit par saveDB en mode cloud, filet de rollback) et l'IndexedDB photos ne
// doivent JAMAIS survivre à un changement d'utilisateur ni à un logout (cause C-C : un révoqué gardait
// une copie lisible à vie). Décisions PURES dans js/core/cache-purge.js (testé) ; exécution ici.
const MIRROR_TAG_KEY = 'immotrack_v4_tag'  // = cache-purge.MIRROR_TAG_KEY (contrat verrouillé par test)
// BUG-LOGIN-DOUBLE — storageKey EXPLICITE du token de session (persistSession:true). Clé DÉTERMINISTE
// (au lieu du défaut sb-<projectref>-auth-token, dérivé de l'URL) → purge FIABLE au logout / changement
// de compte (cf. cache-purge.authStorageKeys). __immoSupaToken (worker de signature) lit getSession qui
// relit ce storage → inchangé pour l'appelant.
// Constante LOCALE, volontairement : un import statique de cache-purge.js rendrait l'écran de
// connexion dépendant de ce module (s'il manque, l'entrée entière ne se charge pas et la page reste
// blanche — le mode dégradé M-b disparaît). Égalité avec cache-purge.AUTH_STORAGE_KEY (lue par le
// registre du stockage local) verrouillée par __tests__/helpers/stockage-purges-cablage.test.js.
const AUTH_STORAGE_KEY = 'immo-supabase-auth'
let _authStorage = null            // stockage du jeton (auth-storage.js), posé par boot() ; lu par wireLoginForm
let _cachePurge = null         // module cache-purge (importé au boot, best-effort)
// STOCKAGE lot 1 (docs/CDC-STOCKAGE.md) — registre du stockage local : écriture du miroir avec éviction
// sur quota (S-1) et purge des copies complètes de la base au logout / changement d'utilisateur (S-7).
// Import best-effort comme ses voisins : sans lui, comportement d'AVANT le lot (écriture directe).
let _stockageLocal = null
// STOCKAGE lot 4 (docs/CDC-STOCKAGE.md §3.8) — miroir cloud en IndexedDB + journal synchrone des EDL
// (js/core/miroir-local.js). Import best-effort : sans lui, le miroir reste en localStorage (lot 1).
let _miroirLocal = null
// STOCKAGE lot 2 (docs/CDC-STOCKAGE.md §3.4) — filets avant migration en IndexedDB `immotrack_backup`
// (js/core/filets-migration.js). Import best-effort : sans lui, pas de purge à la déconnexion — les
// filets expirent alors d'eux-mêmes après 30 jours (passe de démarrage, même module).
let _filetsMigration = null
let _teardownSession = null      // dépose de session ({flush}) — posée au boot, utilisée par logout + purge espace
let _hasCloudWrites = null       // summaryHasCloudWrites (store-sync) — M4 : émission Realtime honnête
// EDL TERRAIN lot 4bis — deux appareils, un état des lieux. Imports best-effort
// comme leurs voisins : sans eux le comportement d'AVANT le lot est conservé
// (le serveur gagne, à l'identique) — on ne casse rien, on ne protège juste plus.
let _edlConflit = null           // module edl-conflit (décisions pures, testées)
let _recordKey = null            // store-sync.recordKey — la clé d'identité du moteur
// EDL TERRAIN lot 4 — décisions PURES du mode hors ligne (js/core/offline-boot.js,
// testé). Import best-effort comme ses voisins : sans lui, aucun mode hors ligne
// n'est proposé et le comportement reste EXACTEMENT celui d'aujourd'hui.
let _offlineBoot = null
// Suppression de la base binaire locale. `onblocked` résolu quand même : la suppression reste PENDANTE
// tant qu'une connexion est ouverte et s'exécute dès leur fermeture (le reload qui suit les ferme).
function _deletePhotosDb() {
  return new Promise(res => {
    try { const r = indexedDB.deleteDatabase('immotrack_photos'); r.onsuccess = r.onerror = r.onblocked = () => res() } catch (e) { res() }
  })
}

// BUG-LOGIN-DOUBLE volet sécurité — purge des clés localStorage du token de session (persistSession:true).
// Appelé au logout ET au changement de compte via l'invitation (« Utiliser un autre compte ») : un token
// valide ne doit JAMAIS rester lisible sur la machine. signOut() le retire déjà ; ceci est la
// ceinture+bretelles (si signOut a throw avant d'écrire le storage — réseau). Mode dégradé sans
// cache-purge (import raté) : littéraux, même patron que les fallbacks voisins. Ne throw jamais.
function _purgeAuthTokenKeys() {
  try {
    const keys = _cachePurge ? _cachePurge.authStorageKeys(AUTH_STORAGE_KEY) : [AUTH_STORAGE_KEY, AUTH_STORAGE_KEY + '-code-verifier']
    // F14.2 : le token peut vivre en localStorage (PWA) OU sessionStorage (navigateur) → purge les DEUX.
    keys.forEach(k => { try { localStorage.removeItem(k) } catch (e) {}; try { sessionStorage.removeItem(k) } catch (e) {} })
  } catch (e) {}
}

// STOCKAGE lot 1 (S-7) — purge des copies complètes de la base (classe `copie` du registre,
// js/core/stockage-local.js). Appelée au logout et quand le miroir n'appartient pas à l'utilisateur
// qui se connecte. Ne touche QUE les clés reconnues par le registre. Module absent : rien (le
// nettoyage de démarrage, même registre, les retire aussi). Ne throw jamais.
function _purgerCopiesLocales(motif) {
  try {
    if (!_stockageLocal) return
    const parties = _stockageLocal.purgerCopies(localStorage)
    if (parties.length) console.info('[Supabase] purge (' + motif + ') : ' + parties.length + ' copie(s) locale(s) de la base retirée(s)')
  } catch (e) { console.warn('[Supabase] purge des copies locales', e) }
}

// STOCKAGE lot 2 (S-7) — purge des copies de la base rangées en IndexedDB `immotrack_backup` : filets
// avant migration (`filet:*`) et copie de la base illisible (`corrompu:*`). Jamais le reste du store
// (`dirhandle`, dossier de la sauvegarde de sécurité). Appelée au logout et quand le miroir n'appartient
// pas à l'utilisateur qui se connecte, ATTENDUE (avant le reload, avant la pose du nouveau tag).
// Chaque opération IndexedDB est bornée (3 s) et la purge entière l'est aussi (5 s) : un IndexedDB muet
// ou lent ne bloque pas la déconnexion. Ce qui resterait est repurgé au login suivant (verdict ≠ 'same')
// ou expire après 30 jours. Module absent : rien. Ne throw jamais.
const _PURGE_FILETS_MAX_MS = 5000
async function _purgerFiletsLocaux(motif) {
  let minuterie = null
  try {
    if (!_filetsMigration || typeof indexedDB === 'undefined') return
    const purge = _filetsMigration.purgerCopies(_filetsMigration.adaptateurIndexedDB(indexedDB))
    const borne = new Promise(res => { minuterie = setTimeout(() => res(null), _PURGE_FILETS_MAX_MS) })
    const parties = await Promise.race([purge, borne])
    if (parties === null) console.warn('[Supabase] purge (' + motif + ') des copies IndexedDB non terminée en ' + (_PURGE_FILETS_MAX_MS / 1000) + ' s — reprise au prochain login ou à l’expiration (30 jours)')
    else if (parties.length) console.info('[Supabase] purge (' + motif + ') : ' + parties.length + ' copie(s) de la base retirée(s) d’IndexedDB')
  } catch (e) { console.warn('[Supabase] purge des filets IndexedDB', e) }
  finally { if (minuterie) clearTimeout(minuterie) }
}

// P1.3 volet RGPD — purge du cache local au LOGIN, selon le propriétaire du miroir résiduel.
// Extraite telle quelle de `onLoggedIn` (STOCKAGE lot 1, audit point 3) pour être exécutable par un
// test : lit le verdict de l'ANCIEN tag ; tout sauf 'same' → miroir + horodatage + copies complètes
// de la base retirés. SYNCHRONE. Rend le verdict, que l'appelant retient pour F1 (EDL TERRAIN lot 4).
// N'ÉCRIT PAS le nouveau tag : l'ordre de l'appelant est le contrat —
//   1. _purgerCacheAuLogin  2. si 'other-user' : await _deletePhotosDb()  3. _ecrireTagEtEspacesLogin.
// Le nouveau tag n'est posé qu'APRÈS la suppression des photos d'autrui : si le processus meurt
// pendant la suppression, l'ancien tag est toujours là, le login suivant rend encore 'other-user' et
// la purge est rejouée (F14.1). Peut lever (l'appelant l'attrape, comme avant).
function _purgerCacheAuLogin({ user, esp }) {
  // (audit M-b) SANS le module (import raté) : verdict 'untagged' forcé → miroir purgé quand même
  // (fail-safe RGPD ; seule la purge IDB 'other-user', qui exige la PREUVE du tag, devient inerte).
  const cls = _cachePurge ? _cachePurge.classifyMirrorTag(localStorage.getItem(MIRROR_TAG_KEY), user.id, esp.espaceId) : 'untagged'
  if (cls !== 'same') {
    try { localStorage.removeItem(MIRROR_KEY) } catch (e) {}
    // STOCKAGE lot 1 (CDC §3.6) : l'horodatage part AVEC le miroir (même règle que le logout) —
    // orphelin, il ferait croire à F1 qu'il reste du travail hors ligne.
    try { if (_offlineBoot) localStorage.removeItem(_offlineBoot.MIROIR_ECRIT_KEY) } catch (e) {}
    // S-7 : les copies complètes de la base d'un autre utilisateur/espace ne survivent pas non plus.
    _purgerCopiesLocales('changement de propriétaire du miroir')
    // STOCKAGE lot 4 : le miroir IndexedDB et le journal des EDL suivent la même règle. `oublier` est
    // SYNCHRONE pour le journal ; l'effacement IndexedDB est mis en file AVANT le rebase du login
    // (même connexion, ordre des transactions). Module absent : rien à effacer (le miroir est local).
    try { if (typeof _miroirLocal !== 'undefined' && _miroirLocal) _miroirLocal.miroir().oublier() } catch (e) {}
  }
  return cls
}

// P1.3 volet RGPD — le tag du miroir et les espaces autorisés du login courant. Appelée par
// `onLoggedIn` APRÈS la purge IndexedDB éventuelle (voir `_purgerCacheAuLogin`, ci-dessus).
function _ecrireTagEtEspacesLogin({ user, esp }) {
  try { localStorage.setItem(MIRROR_TAG_KEY, _cachePurge ? _cachePurge.mirrorTag(user.id, esp.espaceId) : JSON.stringify({ userId: user.id, espaceId: esp.espaceId })) } catch (e) {}
  // EDL TERRAIN lot 4 — on MÉMORISE les espaces auxquels ce login donne accès.
  // Hors ligne on ne peut rien demander au serveur : sans cette liste, le
  // miroir serait affiché en entier, espaces révoqués compris (incident du
  // 12/07). Le tag ne suffit pas, il n'enregistre que l'espace PROPRE (F13).
  try { if (_offlineBoot) localStorage.setItem(_offlineBoot.ESPACES_KEY, JSON.stringify(Object.keys(_espaceOwners || {}))) } catch (e) {}
}

// STOCKAGE lot 1 (S-1) — écriture du miroir avec éviction sur quota. Même décision que l'écrivain
// inline `_miroirEcrire` d'index.html (même module) : un rebase au login ne peut plus échouer à cause
// d'une copie héritée. Rend true si écrit. Module absent : écriture directe (comportement d'avant).
// STOCKAGE lot 4 : miroir cloud prêt → IndexedDB (sans avancer `_ecrit_at` : l'état écrit EST celui
// du cloud). Accepte la base (objet) ou sa sérialisation (chaîne).
function _ecrireMiroir(base) {
  try {
    const M = (typeof _miroirLocal !== 'undefined' && _miroirLocal) ? _miroirLocal.miroir() : null
    if (M && M.pret()) return M.ecrire(typeof base === 'string' ? JSON.parse(base) : base, { horodater: false })
    const json = typeof base === 'string' ? base : JSON.stringify(base)
    if (!_stockageLocal) { localStorage.setItem(MIRROR_KEY, json); return true }
    const r = _stockageLocal.ecrireAvecLiberation(localStorage, [[MIRROR_KEY, json]])
    if (r.liberees.length) console.info('[Supabase] miroir : ' + r.liberees.length + ' clé(s) jetable(s) libérée(s) (' + r.caracteresLiberes + ' caractères)')
    if (!r.ok) console.warn('[Supabase] miroir non écrit', r.erreur)
    return r.ok
  } catch (e) { console.warn('[Supabase] miroir non écrit', e); return false }
}

// EDL TERRAIN lot 4, F2 — LE SEUL endroit qui annonce un refus de déconnexion.
// Trois chemins déconnectent (menu Compte, « utiliser un autre compte » d'une
// invitation, page de test) et deux d'entre eux AVALAIENT le refus : ils
// enchaînaient purge et rechargement comme si de rien n'était, ce qui est
// exactement l'échec muet que le CDC interdit. Le texte vient du module testé
// (js/core/offline-boot.js) : un message recopié trois fois dérive.
// Rend `true` si la personne a lu et choisit de perdre le travail quand même.
async function _accepteDePerdre(r) {
  let msg
  try {
    msg = _offlineBoot
      ? _offlineBoot.messageDeconnexionRefusee({ enAttente: r && r.enAttente, raison: r && r.raison, quoi: r && r.quoi }).question
      : 'Des modifications ne sont pas encore enregistrées dans le cloud. Se déconnecter les perdrait.\n\nSe déconnecter quand même ?'
  } catch (e) {
    msg = 'Des modifications ne sont pas encore enregistrées dans le cloud. Se déconnecter les perdrait.\n\nSe déconnecter quand même ?'
  }
  try { return !!window.confirm(msg) } catch (e) { return false }
}

// BOOT-GATE — le <head> d'index.html pose `html[data-lpboot]` qui masque tout le body SAUF #imsb-overlay
// (+ #toast) le temps que ce module injecte l'overlay de login. Une fois l'overlay en place (ou l'app
// cloud révélée à onLoggedIn), on lève le gate en retirant l'attribut. Le portail Drive #ov-drive-connect
// a été PHYSIQUEMENT retiré (cutover « Connexion B ») → plus rien à masquer côté legacy.
function _liftDriveGate() {
  try { document.documentElement.removeAttribute('data-lpboot') } catch (e) {}
}

// #2 (test partage) — nom d'affichage PAR-UTILISATEUR (auth), pour un invité qui n'est pas le
// propriétaire de l'espace : metadata du compte sinon partie locale de l'email « jolifiée ».
function _displayNameFromUser(user) {
  if (!user) return ''
  const m = user.user_metadata || {}
  const meta = String(m.name || m.full_name || m.display_name || '').trim()
  if (meta) return meta
  const local = String(user.email || '').split('@')[0].replace(/[._-]+/g, ' ').trim()
  if (!local) return ''
  return local.split(' ').map(s => s ? s[0].toUpperCase() + s.slice(1) : s).join(' ')
}

async function boot() {
  // BUG-LOGIN-DOUBLE — fil d'Ariane de diagnostic posé AU PLUS TÔT (avant tout réseau/import). Écrit une
  // étape horodatée dans sessionStorage (SURVIT à location.reload() dans le même onglet → capture la
  // séquence d'un reload intempestif). Décision pure + testée (login-breadcrumb.js) ; exécution ici. Le
  // handler `controllerchange` d'index.html l'appelle aussi (le principal suspect du reload post-login).
  try {
    window.__immoCrumb = (event) => {
      try {
        const next = appendCrumb(sessionStorage.getItem(BREADCRUMB_KEY), event, Date.now())
        sessionStorage.setItem(BREADCRUMB_KEY, next)
        console.debug('[login-trace]', event)
      } catch (_e) {}
    }
    window.__immoCrumb('entry-boot')
  } catch (_e) {}
  try { sessionStorage.removeItem('imsb-part-reload') } catch (e) {}   // boot OK → réarme le reload auto de __immoPartFail
  injectStyles()
  const overlay = injectOverlay()
  _liftDriveGate()   // mode cloud : pas de gate Drive (sinon il masque l'overlay de login)
  // v15.422 BUG-LOGIN-PREMIERE-CONNEXION — l'import du client peut échouer (réseau, fichier absent) :
  // avant, boot() mourait en silence (console) et le formulaire restait câblé sur la soumission native
  // → chaque tentative rechargeait la page. Désormais : erreur VISIBLE + bouton « Réessayer » propre.
  // v15.437 — la source est désormais le fichier vendored MÊME ORIGINE (github.io), plus esm.sh : ce
  // catch ne se déclenche donc plus sur un blocage CDN d'entreprise, seulement sur un vrai 404/déploiement.
  let createClient, createBoot
  try {
    ;({ createClient } = await import(/* @vite-ignore */ CDN))
    ;({ createBoot } = await import('./supabase-boot.js'))
    _perfMark('imports')
  } catch (e) {
    console.error('[ImmoSupabase] import CDN/boot :', e)
    showError(overlay, 'Impossible de charger le service de connexion (réseau ?). Recharger la page pour réessayer.')
    const btn = overlay.querySelector('#imsb-submit')
    if (btn) { btn.disabled = false; btn.textContent = 'Recharger la page'; btn.type = 'button'; btn.onclick = () => location.reload() }
    return
  }
  // F14.2 (audit sécu) — « on ne reste pas connecté ». L'APP INSTALLÉE (PWA, display-mode standalone =
  // usage TERRAIN) garde la session sur le disque (localStorage) : indispensable à l'EDL hors-ligne
  // (rouvrir l'app SANS réseau sur site exige que la session ait survécu à la fermeture). Le NAVIGATEUR
  // (web/desktop) la met en sessionStorage → fermer l'onglet/le navigateur DÉCONNECTE : on se reconnecte
  // à chaque visite (identifiants retenus par le navigateur), rien ne reste lisible sur un poste partagé.
  const _standalone = (() => { try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true } catch (e) { return false } })();
  // « Rester connecté sur cet appareil » (case du formulaire) : le NAVIGATEUR garde le jeton en sessionStorage par
  // défaut (poste partagé : fermer l'onglet déconnecte) ; la case coche bascule en localStorage. L'app installée
  // reste persistante. Le choix est appliqué AVANT l'écriture du jeton (cf. wireLoginForm). Module testé : auth-storage.js.
  // Un jeton resté en localStorage par une ancienne version du site (avant le passage du navigateur en sessionStorage)
  // ne doit PAS connecter le premier venu sur ce poste : purge unique, jamais pour l'app installée ni pour un jeton
  // écrit ensuite avec la case cochée (cf. auth-storage.js).
  purgerJetonLocalLegacy({ local: window.localStorage, cles: [AUTH_STORAGE_KEY, AUTH_STORAGE_KEY + '-code-verifier'], standalone: _standalone });
  const _authStore = createAuthStorage({ local: window.localStorage, session: window.sessionStorage, standalone: _standalone });
  _authStorage = _authStore;
  _initRemember(overlay);   // l'overlay statique est déjà adopté : on règle la case maintenant que le stockage existe
  const client = createClient(window.IMMO_SUPABASE.url, window.IMMO_SUPABASE.anonKey, {
    // BUG-LOGIN-DOUBLE (P0 vente) — la session PERSISTE pendant la session de navigation : sessionStorage
    // (navigateur) comme localStorage (PWA) SURVIVENT au reload post-login (le SW `controllerchange` qui
    // rechargeait la page pendant la fenêtre post-login ne détruit plus la session — contrairement à
    // l'ancienne mémoire-seule qui causait « se connecter 2× »). currentUser() la retrouve au reload →
    // onLoggedIn direct ; autoRefreshToken la maintient vivante. storageKey EXPLICITE (AUTH_STORAGE_KEY)
    // → clé déterministe, purgée au logout / changement de compte.
    // detectSessionInUrl (défaut true) reste actif : SSO Google / reset mdp / invitation.
    // F4-auth : flowType PKCE → liens OTP/magic-link/reset/SSO via `code` usage-unique (pas de token dans
    // le fragment #access_token). Transparent pour le login mot-de-passe ; prépare le magic-link propryo.fr.
    auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_STORAGE_KEY, flowType: 'pkce', storage: _authStore },
  })
  _supaClient = client
  // Jeton de session Supabase (ES256) pour authentifier l'app auprès du worker de signature : le worker
  // le vérifie via JWKS (clé publique) → AUCUNE clé/secret dans le client. '' si pas de session.
  window.__immoSupaToken = async () => {
    try { const { data } = await client.auth.getSession(); return (data && data.session && data.session.access_token) || '' } catch (e) { return '' }
  }
  const api = createBoot(client)
  // Connexion D1 — hook de déconnexion global utilisé par le menu Compte de l'app (index.html).
  // FLUSH puis signOut (api.logout) → purge cache + token → recharge la page : la session persistée
  // (BUG-LOGIN-DOUBLE v15.473) ayant été effacée, on retombe sur le login. Repli sûr : si logout
  // échoue, on purge et recharge quand même (surtout : on ne laisse jamais un token valide derrière
  // soi — cf. _purgeAuthTokenKeys ci-dessous, appelé sur les DEUX chemins flush/purge).
  // RESET-CLOUD UX : la même dépose de session sert au logout (flush d'abord) ET à la purge
  // d'espace (flush SAUTÉ : l'espace n'existe plus — re-pousser le DB mémoire ne produirait que
  // des erreurs FK, ligne par ligne, vers un tenant supprimé ; keepPhotos : l'IndexedDB photos
  // est TOUJOURS conservée après une purge d'espace, car Storage devient inaccessible (espace
  // supprimé) → ces binaires locaux sont la seule copie restante, récupérable via restauration —
  // c'est la promesse affichée par la modale, audit #1). Var MODULE : onLoggedIn (autre portée)
  // la réutilise pour __immoPurgeEspace.
  _teardownSession = async ({ flush, keepPhotos, forcer }) => {
    // Document express en attente d'une inscription : retiré s'il a plus de 10 min (poste partagé : jamais livré à la personne suivante).
    try { const r = JSON.parse(localStorage.getItem('imsb-doc-express') || 'null'); if (r && !(Date.now() - r.t < 10 * 60 * 1000)) localStorage.removeItem('imsb-doc-express') } catch (e) {}
    window.__immoLoggingOut = true   // le SIGNED_OUT qui suit est VOULU → pas de bannière « session expirée »
    try { window.__immoCrumb && window.__immoCrumb('logout') } catch (e) {}
    if (flush) {
      // EDL TERRAIN lot 4, F2 (invariant 19g) : si des écritures ne sont PAS
      // parties au cloud, on ne purge rien et on rend la main. Sans ça, la
      // purge du miroir (juste dessous, inconditionnelle) emportait le travail
      // hors ligne, et laissait les photos orphelines en IndexedDB.
      //
      // ⚠️ GARDE HORS LIGNE — corrigée après audit ; elle manquait, et c'était le
      // trou le plus destructeur du lot. `api.logout` interroge le MOTEUR de
      // synchro ; or le moteur n'est câblé que par `onLoggedIn`. Sur le chemin
      // HORS LIGNE il vaut `null` : la garde de `logout` était donc fausse, la
      // déconnexion passait, et les deux `removeItem` juste en dessous
      // emportaient l'EDL de la visite. Le menu Compte est joignable depuis
      // n'importe quelle page — rien n'empêchait le geste. On pose donc la
      // question AVANT, sur les HORODATAGES : eux existent dans les deux modes,
      // contrairement au moteur. Le verdict vient du module testé.
      const _refus = _refusDeconnexionLocale({ api, forcer })
      if (_refus) {
        window.__immoLoggingOut = false
        try { window.__immoCrumb && window.__immoCrumb('logout-refuse:' + _refus.raison) } catch (e) {}
        return _refus
      }
      let r = null
      try { r = await api.logout({ forcer: !!forcer }) }
      catch (e) { console.warn('[Supabase] logout', e); r = { ok: false, raison: 'flush-impossible', enAttente: 1 } }
      if (r && r.ok === false) {
        window.__immoLoggingOut = false
        try { window.__immoCrumb && window.__immoCrumb('logout-refuse:' + r.raison) } catch (e) {}
        return r
      }
    }
    else { try { await _supaClient.auth.signOut() } catch (e) { console.warn('[Supabase] signOut', e) } }
    // P1.3 volet RGPD (audit C-C) : le miroir localStorage est TOUJOURS purgé au logout — sinon le
    // dernier saveDB laisse une copie intégrale du DB lisible à vie sur la machine (cas Marion).
    // F14.1 (audit sécu, poste partagé) : on purge le miroir de DONNÉES (RGPD) mais on GARDE le tag
    // quand IndexedDB est CONSERVÉE (binaires idb-only, ci-dessous). Sinon, tag effacé ⇒ au login suivant
    // classifyMirrorTag renvoie 'untagged' ⇒ les photos d'A restent en IndexedDB, lisibles en DevTools par
    // B sur le même poste. Tag gardé ⇒ login B → 'other-user' → purge des photos résiduelles (:1219).
    try { localStorage.removeItem(MIRROR_KEY) } catch (e) {}
    // Les horodatages partent AVEC le miroir : une clé résiduelle après une purge
    // RGPD n'a pas de raison d'exister, et un horodatage orphelin ferait croire à
    // F1, au prochain login, qu'il reste du travail hors ligne à rejouer.
    try { if (_offlineBoot) { localStorage.removeItem(_offlineBoot.MIROIR_ECRIT_KEY); localStorage.removeItem(_offlineBoot.FLUSH_OK_KEY); localStorage.removeItem(_offlineBoot.ESPACES_KEY) } } catch (e) {}
    // STOCKAGE lot 1 (S-7) : les COPIES COMPLÈTES de la base (anciennes sauvegardes avant migration,
    // ancien Drive, base illisible) sont des miroirs sous un autre nom — elles contournaient cette
    // purge et restaient lisibles après la déconnexion sur un poste partagé.
    _purgerCopiesLocales('logout')
    // STOCKAGE lot 4 (RGPD) : le miroir IndexedDB `immotrack_miroir` est SUPPRIMÉ, le journal des EDL
    // retiré, et plus aucune écriture n'est acceptée avant le rechargement. Attendu AVANT le reload.
    // La garde ci-dessus (refus tant que du travail n'est pas parti) s'applique AVANT ce point.
    // ⚠️ ORDRE (audit lots 2-3, 🟡3) : `vider()` ferme le miroir DÈS son premier pas, synchrone — aucun
    // `await` ne doit le précéder depuis le retrait des horodatages ci-dessus. Sinon un saveDB pendant
    // l'attente (la purge des filets peut durer 5 s) réécrit `immotrack_v4_ecrit_at`, qui survit à la
    // déconnexion : au login suivant, F1 croirait à du travail hors ligne non remonté.
    try { if (typeof _miroirLocal !== 'undefined' && _miroirLocal) await _miroirLocal.miroir().vider() } catch (e) { console.warn('[Supabase] purge du miroir IndexedDB', e) }
    // STOCKAGE lot 2 (S-7) : les filets avant migration et la base illisible, rangés en IndexedDB, aussi.
    // APRÈS la fermeture du miroir (ci-dessus) : plus rien ne peut réécrire un horodatage pendant l'attente.
    await _purgerFiletsLocaux('logout')
    // BUG-LOGIN-DOUBLE volet sécurité : le token de session (persistSession:true) DOIT partir aussi.
    _purgeAuthTokenKeys()
    // IndexedDB photos : purgée SEULEMENT si aucun binaire « idb-only » (sans copie Supabase Storage).
    // 20/35 documents vivants n'existent QUE là (forensique 12/07) : les détruire = perdre des preuves
    // légales (règle « pas d'auto-suppression »). Le rattrapage _drvUploadPendingAttachments (rebranché
    // post-hydratation, P1.3) fait fondre ce reliquat → la purge deviendra effective d'elle-même.
    try {
      // DEUX questions distinctes, longtemps confondues dans une seule lecture de `window.DB` :
      //  1. « L'hydratation a-t-elle eu lieu ? » — sinon on ne purge RIEN (les binaires de l'état
      //     pré-login ne prouvent rien). Le miroir répondait par accident, parce que seul
      //     `__immoSetDB` le pose. `_liveDBRef` répond exprès : il n'est affecté qu'après un
      //     `__immoSetDB` réussi (L1197 et L1372). `appDbFrom`, lui, répond TOUJOURS un objet
      //     (`index.html:4573` rend le `let DB`, au pire `{}`) : l'utiliser seul supprimerait la
      //     garde, et `listIdbOnlyBinaries({})` rendrait `[]` → on effacerait les photos.
      //  2. « Quel est l'état à inspecter ? » — le DB VIVANT, pas le miroir : `window.DB` n'est pas
      //     rafraîchi quand `DB` est réassigné (import, restauration, adoption cross-onglet), et
      //     compter les binaires « idb-only » sur un état périmé peut rendre 0 alors que le vivant
      //     en a → on détruirait la SEULE copie restante (preuves légales).
      const dbNow = _liveDBRef ? appDbFrom(window) : null
      if (keepPhotos) console.info('[Supabase] purge espace : IndexedDB photos CONSERVÉE (seule copie restante, Storage inaccessible)')
      else if (dbNow && _cachePurge) {
        const leftovers = _cachePurge.listIdbOnlyBinaries(dbNow)
        // IndexedDB réellement purgée → le tag n'a plus d'utilité (rien à re-détecter) : on le retire.
        // Sinon (leftovers conservés), le tag RESTE → le login suivant purge si 'other-user' (F14.1).
        if (leftovers.length === 0) { await _deletePhotosDb(); try { localStorage.removeItem(MIRROR_TAG_KEY) } catch (e) {} }
        else console.warn('[Supabase] logout : IndexedDB photos CONSERVÉE — ' + leftovers.length + ' binaire(s) sans copie Storage (preuves)')
      }
    } catch (e) { console.warn('[Supabase] logout purge IndexedDB', e) }
    try { location.reload() } catch (e) {}
  }
  // EDL TERRAIN lot 4, F2 — la déconnexion est REFUSÉE tant qu'il reste des
  // écritures non synchronisées, et le motif est affiché. Le passage en force
  // reste possible, mais il faut le vouloir : la confirmation dit ce qui sera
  // perdu (l'état des lieux d'une visite, ses photos deviendraient orphelines).
  window.__immoLogout = async () => {
    const r = await _teardownSession({ flush: true })
    if (r && r.ok === false) {
      if (await _accepteDePerdre(r)) return _teardownSession({ flush: true, forcer: true })
      return r
    }
    return r
  }
  // ESPACE PROPRE (getter — posé au login) : sert au code inline à distinguer un renommage d'un objet de
  // l'espace propre (config own-only re-keyable, records non tagués = propres) d'un objet d'une SCI TIERS.
  window.__immoOwnEspaceId = () => _cloudEspaceId
  // NORMALISATION-LOYERS (contre-audit 05/10) : l'espace primaire est-il À l'utilisateur (`mine`) ? Getter
  // DÉDIÉ — __immoOwnEspaceId garde son sens (renommages, app-part2). Faux pour un associé invité.
  window.__immoOwnEspaceMine = () => _cloudEspaceMine
  try { _makeDetUuid = (await import('../core/det-uuid.js')).makeDetUuid } catch (e) { console.warn('[Supabase] det-uuid', e) }
  try { const m = await import('../core/store-multi.js'); _resolveEntiteOwner = m.resolveEntiteOwner; _resolveEspaceOfSeg = m.resolveEspaceOfSeg; _peutEcrireSci = m.peutEcrireSci; _gereSciEnPlein = m.gereSciEnPlein } catch (e) { console.warn('[Supabase] store-multi resolvers', e) }
  // DROIT D'ÉCRITURE PAR SCI (Paramètres › Artisans et plafond, circuit d'un incident) : la SCI `nom` de l'espace
  // `espaceId` (tag `_espaceId`, null = créée ici) est-elle modifiable par ce compte ? Même règle que le routage des
  // écritures et la RLS (store-multi peutEcrireSci). Espaces pas encore résolus → seul le non tagué (défaut sûr).
  window.__immoPeutEcrireSci = (espaceId, nom) => {
    try { return _peutEcrireSci ? _peutEcrireSci(_espacesListe, espaceId == null ? null : espaceId, nom) : espaceId == null } catch (e) { return false }
  }
  // CHAMPS RÉSERVÉS d'un bailleur (migration 0064) : le compte gère-t-il en plein l'espace de cette SCI (propriétaire ou
  // membre plein gestionnaire) ? Non → identité légale, IBAN, BIC, signature, logo, e-mail d'envoi et suppression en
  // lecture seule (« réglé par le propriétaire de la SCI »). Espaces pas encore résolus → seul le non tagué.
  window.__immoGereSciEnPlein = (espaceId) => {
    try { return _gereSciEnPlein ? _gereSciEnPlein(_espacesListe, espaceId == null ? null : espaceId) : espaceId == null } catch (e) { return false }
  }
  // P1.3 — décisions de purge (pur, testé) + prédicat M4 (le flush a-t-il réellement écrit ?). Best-effort
  // comme les imports voisins. Mode dégradé SANS ces modules (audit M-b) : le miroir est quand même purgé
  // au login (verdict 'untagged' forcé) et au logout (littéraux) ; seules la purge IDB 'other-user' (exige
  // la preuve du tag) et la rétention IDB au logout (exige l'inventaire) deviennent inertes, et l'émission
  // Realtime retombe sur l'ancienne condition « flush 100 % propre ».
  try { _cachePurge = await import('../core/cache-purge.js') } catch (e) { console.warn('[Supabase] cache-purge', e) }
  try { _stockageLocal = await import('../core/stockage-local.js') } catch (e) { console.warn('[Supabase] stockage-local', e) }
  try { _filetsMigration = await import('../core/filets-migration.js') } catch (e) { console.warn('[Supabase] filets-migration', e) }
  try { _offlineBoot = await import('../core/offline-boot.js') } catch (e) { console.warn('[Supabase] offline-boot', e) }
  // STOCKAGE lot 4 — le miroir cloud passe en IndexedDB. Initialisé ICI, AVANT tout lecteur (démarrage
  // hors ligne, F1, garde de déconnexion) et avant toute écriture cloud : ouvre IndexedDB et TRANSFÈRE
  // un miroir localStorage existant (écrire, relire, comparer, puis seulement supprimer). Refus ou
  // échec → repli localStorage ANNONCÉ. Échec de l'import → comportement du lot 1, inchangé.
  try {
    _miroirLocal = await import('../core/miroir-local.js')
    const M = _miroirLocal.miroir()
    const _dejaDit = new Set()
    const TEXTES = {
      'repli': 'Copie hors ligne en mode réduit : ce navigateur refuse IndexedDB (navigation privée ?). Le travail hors ligne reste enregistré sur cet appareil, dans la limite d’environ 5 Mo.',
      'transfert-echec': 'Copie hors ligne en mode réduit : le transfert vers IndexedDB n’a pas abouti. Rien n’est perdu : la copie locale est conservée.',
      'echec-ecriture': 'Copie hors ligne : IndexedDB a refusé l’écriture, bascule sur le stockage local de cet appareil.',
      'echec-repli': 'Copie hors ligne non mise à jour : stockage de cet appareil plein.',
      // « plein » seulement si le navigateur a refusé faute de place (retour pilotage 17/10, même règle que la carte)
      'echec-repli-autre': 'Copie hors ligne non mise à jour : le stockage local de cet appareil a échoué.',
      'copie-incomplete': 'Copie hors ligne incomplète sur cet appareil : la base ne tient pas dans le stockage local. Les états des lieux saisis sont conservés.',
    }
    // Audit final 🟡3 — le signal PRÉCÉDENT : un `echec-repli` qui suit immédiatement un `echec-ecriture`
    // est une DOUBLE PANNE (IndexedDB a refusé, puis le stockage local aussi).
    let _signalPrecedent = null
    M.surSignal(s => {
      console.warn('[Supabase] miroir local :', s.type, s.erreur)
      const _doublePanne = s.type === 'echec-repli' && _signalPrecedent === 'echec-ecriture'
      _signalPrecedent = s.type
      // STOCKAGE lot 3 (D1 B) : en ligne, une copie complète non écrite n'est pas une perte (le cloud a
      // la modification, le journal garde les EDL) → état « pas à jour » + avis unique de saveDB, pas de
      // message d'erreur. Hors ligne, le texte ci-dessous reste.
      if (s.type === 'echec-repli') { try { if (typeof window.__immoMiroirPasAJour === 'function' && window.__immoMiroirPasAJour({ erreur: s.erreur })) return } catch (e) {} }
      // HORS LIGNE, double panne : saveDB a pu dire « enregistré » (écriture IndexedDB planifiée, audit 🟠1)
      // et la modification n'est plus sur aucun support de l'appareil. Le dire avec le texte de perte de
      // saveDB (« PAS enregistrée… »), pas avec le texte générique de copie non mise à jour.
      if (_doublePanne && window.__immoHorsLigne) {
        const perte = _stockageLocal && _stockageLocal.TEXTES_ECHEC_MIROIR && _stockageLocal.TEXTES_ECHEC_MIROIR.horsLigne
        if (perte) { try { if (typeof window.showToast === 'function') window.showToast(perte, 'err', 10000) } catch (e) {} return }
      }
      let _cleTexte = s.type
      if (s.type === 'echec-repli') {
        let _plein = false
        try { _plein = !!(_stockageLocal && typeof _stockageLocal.estQuotaDepasse === 'function' && _stockageLocal.estQuotaDepasse(s.erreur)) } catch (e) { _plein = false }
        if (!_plein) _cleTexte = 'echec-repli-autre'
      }
      const t = TEXTES[_cleTexte]
      if (!t || _dejaDit.has(_cleTexte)) return
      _dejaDit.add(_cleTexte)
      try { if (typeof window.showToast === 'function') window.showToast(t, s.type === 'echec-repli' ? 'err' : 'warn', 9000) } catch (e) {}
    })
    const r = await M.initialiser()
    _perfMark('miroir')
    console.info('[Supabase] miroir local :', r.backend, '— transfert :', r.transfert)
    try { window.__immoCrumb && window.__immoCrumb('miroir:' + r.backend + ':' + r.transfert) } catch (e) {}
    // Lu par la garde de déconnexion de supabase-boot.js (module séparé) : un miroir IndexedDB compte.
    window.__immoMiroirPresent = () => { try { return M.present() } catch (e) { return false } }
    // Idem pour le reste de ce que la garde doit savoir : miroir protégé (illisible avec du travail non
    // remonté) et heure du dernier travail local connu en IndexedDB (`travailA`, audit O4).
    window.__immoMiroirEtat = () => { try { return { present: M.present(), protege: M.protege(), travailA: M.travailA() } } catch (e) { return null } }
    // D7 B — stockage PERSISTANT demandé seulement par l'app INSTALLÉE (usage terrain, EDL hors ligne) :
    // accordé sans question par Chromium aux apps installées ; ailleurs, on ne sollicite personne.
    if (typeof _standalone !== 'undefined' && _standalone && navigator.storage && typeof navigator.storage.persist === 'function') {
      navigator.storage.persisted()
        .then(deja => deja || navigator.storage.persist())
        .then(ok => console.info('[Supabase] stockage persistant :', ok ? 'accordé' : 'refusé'))
        .catch(() => {})
    }
  } catch (e) { console.warn('[Supabase] miroir-local', e); _miroirLocal = null }
  try { const _ss = await import('../core/store-sync.js'); _hasCloudWrites = _ss.summaryHasCloudWrites; _recordKey = _ss.recordKey } catch (e) { console.warn('[Supabase] store-sync helpers', e) }
  try { _edlConflit = await import('../core/edl-conflit.js') } catch (e) { console.warn('[Supabase] edl-conflit', e) }

  const _normNom = s => String(s == null ? '' : s).trim().toLowerCase()
  // MULTI-ESPACE — délégation aux résolveurs PURS (store-multi.js, testés) : owner de l'espace où vit une SCI
  // (par nom) et espaceId d'un segment Storage. SCI TIERS → owner/espace tiers ; entité neuve / introuvable /
  // résolveur non chargé → propre (défaut sûr). À N=1, _espaceOwners n'a qu'un espace → toujours le propre.
  const _entiteOwner = nom => { try { return _resolveEntiteOwner ? _resolveEntiteOwner(_liveDBRef && _liveDBRef.entites, _espaceOwners, nom, _cloudOwnerId) : _cloudOwnerId } catch (_e) { return _cloudOwnerId } }
  const _espaceOfEntiteSeg = seg => { try { return _resolveEspaceOfSeg ? _resolveEspaceOfSeg(_liveDBRef && _liveDBRef.entites, _espaceOwners, _makeDetUuid, seg, _cloudOwnerId, _cloudEspaceId) : _cloudEspaceId } catch (_e) { return _cloudEspaceId } }

  // entite_id DÉTERMINISTE d'une SCI (par NOM), pour le chemin Storage par-SCI (<espace>/<entite_id>/files/<clé>).
  // MÊME dérivation que store-mapping (mapper entites) : detUuid(owner de LA SCI) + ('entite', nom normalisé).
  // null si owner/fabrique pas prêts → orphelin.
  window.__immoEntiteUuid = function (nom) {
    try {
      const ownerId = _entiteOwner(nom)
      if (!ownerId || !_makeDetUuid) return null
      return _makeDetUuid(ownerId)('entite', _normNom(nom))
    } catch (e) { return null }
  }

  // DÉCOUPLAGE cloud↔Drive — helper global d'URL signée Storage. En mode cloud, index.html ouvre un
  // document via son idbKey → URL signée courte (5 min) du fichier dans Supabase Storage, à la place du
  // lien Drive. Retourne null si pas d'espace résolu, pas d'idbKey, ou objet absent (ex. doc Drive-only
  // non migré → le caller affiche un message). Capture `client` (closure boot) ; lit _cloudEspaceId (login).
  window.__immoCloudFileUrl = async function (pathOrKey, expiresIn) {
    try {
      if (!_cloudEspaceId || !pathOrKey) return null
      // pathOrKey = chemin complet par-SCI (<espace>/<seg>/files/<clé>, contient '/files/') OU clé nue
      // LEGACY (uploads d'avant le par-SCI) → reconstruit l'ancien chemin <espace>/files/<clé>. Rétro-compat.
      const isFullPath = String(pathOrKey).indexOf('/files/') !== -1
      const objPath = isFullPath ? pathOrKey : (_cloudEspaceId + '/files/' + pathOrKey)
      const { data, error } = await client.storage.from('espace-files').createSignedUrl(objPath, expiresIn || 300)
      return error ? null : ((data && data.signedUrl) || null)
    } catch (e) { return null }
  }

  // DÉCOUPLAGE cloud↔Drive — upload d'un blob vers Supabase Storage (`<espaceId>/files/<idbKey>`, upsert).
  // Sert à ARCHIVER le PDF du bail signé au moment de la signature (le blob existe dans la fenêtre de
  // signature) → le bouton « PDF » et le partage le rouvrent via __immoCloudFileUrl. Retourne true/false.
  window.__immoCloudUpload = async function (idbKey, blob, contentType, entiteSeg) {
    try {
      if (!_cloudEspaceId || !idbKey || !blob) return null
      // Chemin PAR-SCI : <espace>/<entite_id>/files/<clé> (ou /_orphelin/ si SCI non résolue → membre plein
      // only côté RLS, cf migration 0031). entiteSeg = uuid d'entité via window.__immoEntiteUuid, ou falsy.
      // RETOURNE le chemin complet (string, à STOCKER pour la relecture) ou null si échec.
      // entiteSeg fourni (câblage par-SCI) → <espace>/<entiteSeg>/files/<clé> (uuid de SCI ou '_orphelin').
      // ABSENT (ancien appelant, ex. index.html pas encore rafraîchi via le SW) → chemin LEGACY
      // <espace>/files/<clé> : rétro-compat, l'ancien appelant stocke la clé nue et relit via le legacy.
      // → aucune fenêtre cassée pendant un déploiement (entry réseau-first vs index.html bumpé).
      // MULTI-ESPACE : un fichier de SCI TIERS vit sous l'espaceId de SON propriétaire (pas le nôtre). On
      // résout l'espace depuis le segment d'entité ; legacy (entiteSeg absent) → espace propre. N=1 → propre.
      const eid = (entiteSeg == null) ? _cloudEspaceId : _espaceOfEntiteSeg(entiteSeg)
      const path = (entiteSeg == null)
        ? (eid + '/files/' + idbKey)
        : (eid + '/' + entiteSeg + '/files/' + idbKey)
      const { error } = await client.storage.from('espace-files').upload(path, blob, { contentType: contentType || 'application/pdf', upsert: true })
      return error ? null : path
    } catch (e) { return null }
  }

  // RÉ-UPLOAD BINAIRES (restauration cas « cloud perdu ») : upload vers un CHEMIN EXACT (le cloudKey déjà
  // stocké dans le DB) → reproduit à l'identique le fichier là où l'app le cherche, quel que soit son
  // format (par-SCI `<espace>/<seg>/files/<clé>` ou legacy). Clé nue (sans '/files/') → chemin legacy propre.
  window.__immoCloudUploadPath = async function (cloudKey, blob, contentType) {
    try {
      if (!_cloudEspaceId || !cloudKey || !blob) return null
      const objPath = String(cloudKey).indexOf('/files/') !== -1 ? cloudKey : (_cloudEspaceId + '/files/' + cloudKey)
      const { error } = await client.storage.from('espace-files').upload(objPath, blob, { contentType: contentType || 'application/octet-stream', upsert: true })
      return error ? null : objPath
    } catch (e) { return null }
  }

  // EDL-VIDEO-IA (14/10/2026) — ENVOI REPRENABLE d'une vidéo d'état des lieux (protocole TUS, morceaux de 6 Mo,
  // js/core/tus-client.js). Chemin par-SCI <espace>/<seg>/files/<clé> comme les photos ; x-upsert false : une
  // vidéo n'écrase jamais un fichier existant (un fichier déjà présent = envoi déjà fait → succès). Retour
  // { ok, path, url, code } ; `url` = adresse d'envoi à mémoriser pour reprendre après une coupure (24 h).
  window.__immoCloudUploadResumable = async function (o) {
    try {
      if (!_cloudEspaceId || !o || !o.cle) return { ok: false, code: 'cloud' }
      const seg = o.entiteSeg || '_orphelin'
      const eid = _espaceOfEntiteSeg(seg)
      const path = eid + '/' + seg + '/files/' + o.cle
      const Tus = window.TusClient || (await import('../core/tus-client.js'))
      const getToken = async () => { try { const { data } = await client.auth.getSession(); return (data && data.session && data.session.access_token) || '' } catch (e) { return '' } }
      const envoi = Tus.creerEnvoiTus({
        endpoint: Tus.pointEntree(window.IMMO_SUPABASE.url), getToken, apikey: window.IMMO_SUPABASE.anonKey,
        bucket: 'espace-files', objet: path, type: o.type || 'video/webm', taille: o.taille, lire: o.lire,
        url: o.url || '', onUrl: o.onUrl, onProgres: o.onProgres,
      })
      const r = await envoi.demarrer()
      if (r.ok) return { ok: true, path, url: r.url || '' }
      // Fichier déjà présent : l'appelant vérifie sa taille avant de le tenir pour sa vidéo (jamais d'écrasement).
      if (r.code === 'existe') return { ok: true, path, url: '', existait: true }
      return { ok: false, code: r.code, url: r.url || '' }
    } catch (e) { return { ok: false, code: 'reseau' } }
  }

  // EDL-VIDEO-IA — chemin complet d'un fichier (même règle que l'envoi) : retrouver une vidéo envoyée dont le chemin
  // n'a pas pu être enregistré (application fermée juste après l'envoi).
  window.__immoCloudCheminFichier = function (cle, entiteSeg) {
    try { if (!_cloudEspaceId || !cle) return null; const seg = entiteSeg || '_orphelin'; return _espaceOfEntiteSeg(seg) + '/' + seg + '/files/' + cle } catch (e) { return null }
  }

  // EDL-VIDEO-IA — REGISTRE des médias d'EDL (migration 0058) : une ligne par vidéo à l'abri, rattachée à la
  // ligne `edl` (retrouvée par legacy_id dans l'espace du fichier) et à son logement. La base SCELLE la vidéo
  // à la signature de l'EDL (ni effaçable ni écrasable ensuite). TOLÉRANT : table absente (0058 pas encore
  // appliquée) ou EDL pas encore synchronisé → { ok:false } et l'app réessaie à l'ouverture suivante ; le
  // fichier, lui, est déjà dans le stockage. Jamais d'écrasement (ignoreDuplicates).
  window.__immoEdlMediaRegister = async function (o) {
    try {
      if (!_cloudEspaceId || !o || !o.path) return { ok: false, code: 'cloud' }
      const espace = String(o.path).split('/')[0]
      const { data: e, error: e1 } = await client.from('edl').select('id, logement_id')
        .eq('espace_id', espace).eq('legacy_id', String(o.edlLocalId)).is('deleted_at', null).limit(1).maybeSingle()
      if (e1 || !e) return { ok: false, code: 'edl_absent' }
      const ligne = {
        espace_id: espace, logement_id: e.logement_id, edl_id: e.id, edl_legacy_id: String(o.edlLocalId),
        storage_path: o.path, kind: 'video', mime: o.mime || null, octets: Number(o.octets) || null,
        duree_s: Number.isFinite(Number(o.duree)) ? Math.round(Number(o.duree)) : null,
        sha256: /^[0-9a-f]{64}$/.test(String(o.sha256 || '')) ? o.sha256 : null, piece: o.piece || null, prise: Number(o.prise) || null,
      }
      const { error } = await client.from('edl_medias').insert(ligne)
      if (error && String(error.code) === '23505') {
        // Chemin déjà inscrit : seulement « fait » s'il s'agit bien de CE même état des lieux (jamais d'écrasement).
        const { data: ex } = await client.from('edl_medias').select('edl_legacy_id').eq('storage_path', o.path).maybeSingle()
        return ex && String(ex.edl_legacy_id) === String(o.edlLocalId) ? { ok: true } : { ok: false, code: 'conflit' }
      }
      if (error) return { ok: false, code: /42P01|PGRST20|does not exist|schema cache/i.test(String(error.code) + ' ' + String(error.message)) ? 'table_absente' : 'refus' }
      return { ok: true }
    } catch (e) { return { ok: false, code: 'reseau' } }
  }

  // EDL-VIDEO-IA — ÉCHÉANCE de conservation des vidéos d'un EDL (restitution du DG + 3 ans) et gel pour litige.
  // La base garde la main : une échéance ne recule jamais, ne tombe jamais avant signature + 3 ans (0058).
  window.__immoEdlMediaEcheance = async function (o) {
    try {
      if (!_cloudEspaceId || !o || o.edlLocalId == null) return { ok: false, code: 'cloud' }
      const patch = {}
      if ('purgeApres' in o) patch.purge_apres = o.purgeApres || null
      if (o.gelJusquau) { patch.gel_jusquau = o.gelJusquau; patch.gel_motif = String(o.gelMotif || 'litige').slice(0, 300) }
      if (!Object.keys(patch).length) return { ok: true }
      if (!o.espace) return { ok: false, code: 'cloud' }
      const { error } = await client.from('edl_medias').update(patch).eq('espace_id', o.espace).eq('edl_legacy_id', String(o.edlLocalId))
      return error ? { ok: false, code: 'refus' } : { ok: true }
    } catch (e) { return { ok: false, code: 'reseau' } }
  }

  // CANDIDATURES-CONFORMITE (12/10/2026) — SUPPRESSION des fichiers de CANDIDATS dans Supabase Storage.
  // SEULE suppression Storage de l'app. Réservée aux pièces de candidats (purge RGPD des non retenus à
  // J+30, suppression manuelle d'un candidat ou d'une pièce hors liste) : l'appelant ne passe que des
  // cloudKey issus de CandPurge.planPurge / piecesDuCandidat (parentType 'candidat'). Ici, ceinture :
  // tout chemin qui n'a pas la forme <espace>/<entité|_orphelin>/files/<ph_|att_…> est ÉCARTÉ (jamais un
  // dossier, un joker, un PDF de bail nommé autrement), au plus 100 par appel. La RLS DELETE du bucket
  // (0031 : has_entite_write) s'applique en plus. Les autres pièces gardent leur fichier (preuve légale).
  // Retour { effaces:[chemins], echecs:[chemins] } : un chemin absent du bucket compte comme effacé
  // (idempotent) ; un refus RLS ou une erreur réseau compte comme échec (l'appelant le remet en attente).
  // Clé NUE legacy → <espace>/files/<clé>, exactement comme __immoCloudFileUrl la relit ; le chemin
  // renvoyé dans effaces/echecs reste celui reçu (l'appelant le reconnaît).
  // NB : une perte de droit de LECTURE fait répondre « introuvable » → compté effacé ; le fichier vit alors
  // sous l'espace de son propriétaire, dont l'appareil le purgera.
  window.__immoCloudRemoveCandidatFiles = async function (paths) {
    const liste = [...new Set((Array.isArray(paths) ? paths : []).filter(cheminFichierCandidatValide))].slice(0, 100)
    const res = { effaces: [], echecs: [] }
    if (!liste.length) return res
    if (!_cloudEspaceId) { res.echecs = liste; return res }
    const objet = p => (estCleNue(p) ? (_cloudEspaceId + '/files/' + p) : p)
    try {
      const { data, error } = await client.storage.from('espace-files').remove(liste.map(objet))
      if (error) { res.echecs = liste; return res }
      const retires = new Set((Array.isArray(data) ? data : []).map(o => o && o.name).filter(Boolean))
      for (const p of liste) {
        if (retires.has(objet(p))) { res.effaces.push(p); continue }
        // Absent de la réponse : déjà effacé (succès) OU suppression refusée en silence par la RLS (échec).
        // On tranche en relisant l'objet : « introuvable » = effacé ; lisible = toujours là = échec.
        try {
          const { error: e2 } = await client.storage.from('espace-files').createSignedUrl(objet(p), 10)
          if (e2 && /not.?found|does not exist/i.test(String(e2.message || e2.error || e2.statusCode || ''))) res.effaces.push(p)
          else res.echecs.push(p)
        } catch (e3) { res.echecs.push(p) }
      }
    } catch (e) { res.effaces = []; res.echecs = liste }
    return res
  }

  // ── PARTAGE PAR SCI (étapes 2-3) — helpers MANAGER de l'écran « Partage & accès ». TOUT passe par la
  // RLS (migrations 0029/0030/0032) : le client n'agit que dans son espace, en tant que manager plein.
  // Mapping : role entite_membre 'gestionnaire'→mode 'ecriture', 'lecture_seule'→mode 'lecture'.
  // Couleur d'entité : l'app ne stocke PAS de couleur en base → on dérive une teinte stable du nom
  // (hash → HSL), même esprit que _tenantColor côté index.html (mémoire visuelle inter-vues).
  const _partageColor = (nom) => {
    const s = String(nom == null ? '' : nom)
    if (!s) return 'hsl(220,12%,60%)'
    let h = 0
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h = h & h }
    return 'hsl(' + (Math.abs(h) % 320 + 20) + ',58%,52%)'   // évite le rouge (vacance) comme _tenantColor
  }
  // « Perso » = patrimoine personnel : entité dont le type évoque une personne physique (≠ SCI/société).
  // Aligné sur la détection d'index.html (`/personne physique|perso/i` sur le type d'entité). Non figé :
  // si l'utilisateur n'a pas d'entité « Perso », rien n'est forcé — on partage les entités telles quelles.
  const _isPerso = (ent) => /personne\s*physique|perso/i.test(String((ent && ent.type) || ''))
  const _curUid = async () => { try { const { data } = await client.auth.getUser(); return (data && data.user && data.user.id) || null } catch (e) { return null } }

  // Liste des entités de l'espace (pour le picker du popup d'invitation). [{id, nom, couleur, perso}]
  async function _listEntites () {
    if (!_cloudEspaceId) return { error: 'Espace non résolu — se reconnecter.' }
    const { data, error } = await client
      .from('entites').select('id, nom, type, archived')
      .eq('espace_id', _cloudEspaceId)
      .order('nom', { ascending: true })
    if (error) return { error: error.message }
    const list = (data || [])
      .filter(e => e && !e.archived)
      .map(e => ({ id: e.id, nom: e.nom, couleur: _partageColor(e.nom), perso: _isPerso(e) }))
    return { entites: list }
  }

  // Membres de l'espace + leurs octrois par-entité. [{ user_id, isOwner, label, grants:[{entite_id,entite_nom,couleur,mode}] }]
  async function _listMembers () {
    if (!_cloudEspaceId) return { error: 'Espace non résolu — se reconnecter.' }
    const meUid = await _curUid()
    // 3 lectures parallèles (toutes sous RLS, scopées à l'espace).
    const [mRes, gRes, eRes, iRes] = await Promise.all([
      client.from('espace_members').select('user_id, role, full_espace, invite_status, invite_email').eq('espace_id', _cloudEspaceId),
      client.from('entite_membre').select('entite_id, user_id, role').eq('espace_id', _cloudEspaceId),
      client.from('entites').select('id, nom').eq('espace_id', _cloudEspaceId),
      client.from('invitations').select('invite_email, accepted_by').eq('espace_id', _cloudEspaceId).not('accepted_by', 'is', null)
    ])
    const firstErr = (mRes.error || gRes.error || eRes.error || iRes.error)
    if (firstErr) return { error: firstErr.message }
    const entById = {}
    ;(eRes.data || []).forEach(e => { entById[e.id] = { nom: e.nom, couleur: _partageColor(e.nom) } })
    // email lisible d'un partenaire : via l'invitation qu'il a acceptée (accepted_by = user_id).
    const emailByUid = {}
    ;(iRes.data || []).forEach(inv => { if (inv.accepted_by && inv.invite_email) emailByUid[inv.accepted_by] = inv.invite_email })
    // octrois groupés par user
    const grantsByUid = {}
    ;(gRes.data || []).forEach(g => {
      const ent = entById[g.entite_id] || { nom: 'Périmètre', couleur: _partageColor(g.entite_id) }
      ;(grantsByUid[g.user_id] = grantsByUid[g.user_id] || []).push({
        entite_id: g.entite_id, entite_nom: ent.nom, couleur: ent.couleur,
        mode: g.role === 'gestionnaire' ? 'ecriture' : 'lecture'
      })
    })
    const members = (mRes.data || [])
      .filter(m => m && m.user_id && m.invite_status === 'active')
      .map(m => {
        const isOwner = m.full_espace === true
        const isMe = meUid && m.user_id === meUid
        const email = emailByUid[m.user_id] || m.invite_email || ''
        const label = isMe ? 'Moi' : (email || ('Membre ' + String(m.user_id).slice(0, 8)))
        return { user_id: m.user_id, isOwner, isMe: !!isMe, label, email: isMe ? '' : email, grants: grantsByUid[m.user_id] || [] }
      })
    // owner (moi) en premier, puis partenaires
    members.sort((a, b) => (b.isOwner - a.isOwner) || (b.isMe - a.isMe))
    return { members }
  }

  // Crée une invitation (RLS = manager). grants = [{entite_id, mode:'ecriture'|'lecture'}]. → { token, url }.
  async function _createInvite (grants, inviteEmail) {
    if (!_cloudEspaceId) return { error: 'Espace non résolu — se reconnecter.' }
    if (!Array.isArray(grants) || grants.length === 0) return { error: 'Choisir au moins un périmètre.' }
    const clean = grants
      .filter(g => g && g.entite_id && (g.mode === 'ecriture' || g.mode === 'lecture'))
      .map(g => ({ entite_id: g.entite_id, mode: g.mode }))
    if (clean.length === 0) return { error: 'Périmètres invalides.' }
    const em = String(inviteEmail || '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return { error: 'Email du partenaire requis (il sera autorisé à s\'inscrire).' }
    const row = { espace_id: _cloudEspaceId, grants: clean, invite_email: em }
    const { data, error } = await client.from('invitations').insert(row).select('token').single()
    if (error) return { error: error.message }
    const token = data && data.token
    if (!token) return { error: 'Token non renvoyé.' }
    const url = location.origin + location.pathname + '?invite=' + encodeURIComponent(token)
    return { token, url }
  }

  // Révoque l'accès d'un partenaire : octrois par-entité PUIS appartenance à l'espace (manager via RLS).
  async function _revokeMember (userId) {
    if (!_cloudEspaceId) return { error: 'Espace non résolu — se reconnecter.' }
    if (!userId) return { error: 'Membre invalide.' }
    const r1 = await client.from('entite_membre').delete().eq('espace_id', _cloudEspaceId).eq('user_id', userId)
    if (r1.error) return { error: r1.error.message }
    const r2 = await client.from('espace_members').delete().eq('espace_id', _cloudEspaceId).eq('user_id', userId)
    if (r2.error) return { error: r2.error.message }
    return { ok: true }
  }

  // ESPACE LOCATAIRE (migration 0059) — accès BORNÉS du client connecté (RLS par SCI) : tables locataire_* et
  // fonctions el_acces_* seulement. Toute la logique vit dans js/app/espace-locataire-app.js (+ module pur
  // js/core/espace-locataire.js). Le jeton du locataire n'arrive jamais ici : seule son empreinte (el_acces_*).
  const _EL_TABLES = ['locataire_acces', 'locataire_documents', 'locataire_messages', 'locataire_signalements']
  const _EL_RPC = ['el_acces_emettre', 'el_acces_renouveler', 'el_acces_revoquer', 'el_peut_publier']
  const _elT = t => { if (!_EL_TABLES.includes(t)) throw new Error('table hors espace locataire') ; return client.from(t) }
  window.__immoEspaceLoc = {
    pret: () => !!(_cloudEspaceId && _makeDetUuid),
    // Identifiant déterministe d'une ligne (même dérivation que store-mapping) dans l'espace du propriétaire de la SCI.
    uuid: (collection, cle, entiteNom) => { try { return _makeDetUuid(_entiteOwner(entiteNom))(collection, cle) } catch (e) { return null } },
    entiteUuid: nom => window.__immoEntiteUuid(nom),
    espaceDeSeg: seg => _espaceOfEntiteSeg(seg),
    espacePropre: () => _cloudEspaceId,
    select: async (t, filtres, colonnes) => {
      let q = _elT(t).select(colonnes || '*')
      for (const [k, v] of Object.entries(filtres || {})) q = Array.isArray(v) ? q.in(k, v) : (v === null ? q.is(k, null) : q.eq(k, v))
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return data || []
    },
    insert: async (t, row) => { const { data, error } = await _elT(t).insert(row).select().single(); if (error) throw Object.assign(new Error(error.message), { code: error.code }); return data },
    // garde : colonnes qui doivent encore être vides (mise à jour CONDITIONNELLE, ex. réservation d'un signalement).
    update: async (t, id, patch, garde) => {
      let q = _elT(t).update(patch).eq('id', id)
      for (const k of Object.keys(garde || {})) q = q.is(k, null)
      const { data, error } = await q.select(); if (error) throw new Error(error.message); return data || []
    },
    rpc: async (fn, args) => { if (!_EL_RPC.includes(fn)) throw new Error('fonction hors espace locataire'); const { data, error } = await client.rpc(fn, args); if (error) throw Object.assign(new Error(error.message), { code: error.code }); return data },
    // Fichier déposé PAR LE PROPRIÉTAIRE (pièce d'un message, PDF publié) : sans écrasement. Chemin complet imposé par l'appelant.
    upload: async (path, blob, mime) => { const { error } = await client.storage.from('espace-files').upload(path, blob, { contentType: mime || 'application/pdf', upsert: false }); if (error && !/exists|duplicate/i.test(error.message || '')) throw new Error(error.message); return path },
  }

  // CIRCUIT D'UN INCIDENT (migration 0060) — accès BORNÉS du client connecté (RLS par SCI) : liens et dépôts des
  // artisans (lecture), publication du résultat au locataire (colonnes resultat* seulement), fonctions ar_acces_* et
  // ar_devis_decider. Le jeton de l'artisan n'arrive jamais ici : seule son empreinte (ar_acces_emettre).
  const _IC_TABLES = ['artisan_acces', 'artisan_depots', 'locataire_signalements']
  const _IC_RPC = ['ar_acces_emettre', 'ar_acces_revoquer', 'ar_acces_valider', 'ar_devis_decider']
  const _icT = t => { if (!_IC_TABLES.includes(t)) throw new Error('table hors circuit incident'); return client.from(t) }
  window.__immoIncidentCircuit = {
    pret: () => !!_cloudEspaceId,
    espacePropre: () => _cloudEspaceId,
    espaceDeSeg: seg => _espaceOfEntiteSeg(seg),
    select: async (t, filtres, colonnes) => {
      let q = _icT(t).select(colonnes || '*')
      for (const [k, v] of Object.entries(filtres || {})) q = Array.isArray(v) ? q.in(k, v) : (v === null ? q.is(k, null) : q.eq(k, v))
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return data || []
    },
    publierResultat: async (signalementId, resultat) => {
      const { data, error } = await _icT('locataire_signalements').update({ resultat, resultat_publie_le: new Date().toISOString() }).eq('id', signalementId).select('id')
      if (error) throw new Error(error.message)
      return (data || []).length === 1
    },
    rpc: async (fn, args) => { if (!_IC_RPC.includes(fn)) throw new Error('fonction hors circuit incident'); const { data, error } = await client.rpc(fn, args); if (error) throw Object.assign(new Error(error.message), { code: error.code }); return data },
  }

  // PREMIERS-PAS (étape « Inviter un associé ») : nombre d'invitations déjà créées dans l'espace propre (RLS manager),
  // lu UNE fois après l'affichage, jamais dans le chemin de connexion. null si indisponible.
  async function _compterInvitations () {
    if (!_cloudEspaceId) return null
    const { count, error } = await client.from('invitations').select('token', { count: 'exact', head: true }).eq('espace_id', _cloudEspaceId)
    if (error) return null
    return count || 0
  }

  window.__immoPartage = {
    compterInvitations: _compterInvitations,
    listMembers: _listMembers,
    listEntites: _listEntites,
    createInvite: _createInvite,
    revokeMember: _revokeMember
  }

  // ── Admin bêta (super-admin global) : gestion de l'allowlist d'inscription ──
  async function _isAppAdmin () {
    const { data, error } = await client.rpc('is_app_admin')
    if (error) return false
    return data === true
  }
  async function _listAllowlist () {
    const { data, error } = await client.from('beta_allowlist')
      .select('email, source, invited_by_email, created_at, registered_at').order('created_at', { ascending: false })
    if (error) return { error: error.message }
    return { rows: data || [] }
  }
  async function _addAllowedEmail (email) {
    const e = String(email || '').trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { error: 'Email invalide.' }
    const { error } = await client.from('beta_allowlist').insert({ email: e, source: 'admin' })
    if (error) return { error: /duplicate|unique/i.test(error.message) ? 'Cet email est déjà autorisé.' : error.message }
    return { ok: true, email: e }
  }
  async function _removeAllowedEmail (email) {
    const { error } = await client.from('beta_allowlist').delete().eq('email', String(email || '').trim().toLowerCase())
    if (error) return { error: error.message }
    return { ok: true }
  }
  window.__immoAdmin = { isAppAdmin: _isAppAdmin, listAllowlist: _listAllowlist, addEmail: _addAllowedEmail, removeEmail: _removeAllowedEmail }

  // ── CONSO-IA (migration 0062) : utilisation de l'IA du compte, et écran admin (droits vérifiés en base). ──
  // Migration pas encore appliquée (fonction absente) → { absent: true } : l'app masque simplement l'indicateur.
  async function _iaRpc (fn, args) {
    const { data, error } = await client.rpc(fn, args || {})
    if (error) {
      const absent = error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message || '')
      return { error: absent ? 'absent' : (error.code === '42501' ? 'interdit' : 'base'), absent }
    }
    return { data }
  }
  window.__immoIaConso = {
    monUsage: () => _iaRpc('ia_mon_usage'),
    adminConso: (mois) => _iaRpc('ia_admin_conso', { p_mois: mois || null }),
    adminPlafonds: () => _iaRpc('ia_admin_plafonds'),
    adminPlafondsMaj: (planId, v) => _iaRpc('ia_admin_plafonds_maj', { p_plan: planId, p_dictee_min: v.dictee, p_pieces_pages: v.pieces, p_liens_demandes: v.liens, p_factures: v.factures, p_video_images: v.video }),
    adminSurchargeMaj: (userId, v) => _iaRpc('ia_admin_surcharge_maj', { p_user: userId, p_sans_plafond: !!v.sansPlafond, p_dictee_min: v.dictee, p_pieces_pages: v.pieces, p_liens_demandes: v.liens, p_factures: v.factures, p_video_images: v.video, p_motif: v.motif || null, p_jusqu_au: v.jusquAu || null }),
    adminSurchargeRetirer: (userId) => _iaRpc('ia_admin_surcharge_retirer', { p_user: userId })
  }

  // Lien d'INVITATION (?invite=<token>) : aperçu + acceptation (connexion OU création de compte) AVANT
  // le login normal. acceptInviteFlow enchaîne ensuite sur l'app (la RLS scope l'invité à ses SCIs).
  const _inviteTok = (new URLSearchParams(location.search)).get('invite')
  if (_inviteTok) return acceptInviteFlow(api, client, overlay, _inviteTok)

  // Arrivée depuis propryo.fr par « Connexion » (?connexion) ou « Créer mon compte » (?inscription) : on montre TOUJOURS
  // le formulaire. Si une session existe sur cet appareil (onglet resté ouvert, « rester connecté »), on la ferme
  // d'abord — par le MÊME chemin que le menu Compte, donc avec ses protections : si du travail n'est pas encore
  // synchronisé (EDL hors ligne…), la déconnexion est REFUSÉE et on reste connecté plutôt que de perdre des données.
  if (/[?&](connexion|inscription)(?![\w-])/.test(location.search || '')) {
    try {
      // Garde anti-boucle : si on a DÉJÀ tenté la fermeture dans cet onglet (drapeau posé avant le rechargement) et
      // qu'une session est quand même revenue (stockage bloqué…), on n'insiste pas. Le drapeau est lu ET effacé ici.
      const dejaTente = (() => { try { const v = sessionStorage.getItem('imsb-deja-deconnecte'); sessionStorage.removeItem('imsb-deja-deconnecte'); return !!v } catch (e) { return false } })()
      const sess = await api.localSession()   // lecture locale, sans réseau
      // HORS LIGNE : on ne ferme jamais la session (le formulaire de connexion exige le réseau → le technicien serait
      // enfermé dehors avec son EDL ; CDC verrou 2 « rester connecté hors ligne »). Le boot normal / hors ligne s'exécute.
      const horsLigne = (typeof navigator !== 'undefined' && navigator.onLine === false) || window.__immoHorsLigne === true
      if (sess && sess.user && !dejaTente && !horsLigne && typeof _teardownSession === 'function') {
        const r = await _teardownSession({ flush: true })
        if (!r || r.ok !== false) {
          try { sessionStorage.setItem('imsb-deja-deconnecte', '1') } catch (e) {}
          location.reload(); return        // déconnecté : on recharge → formulaire (mode inscription si ?inscription)
        }
        console.info('[auth] déconnexion refusée (travail non synchronisé) : session conservée')
        try { if (typeof window.showToast === 'function') window.showToast("Du travail n'est pas encore synchronisé : la session reste ouverte.", 'warn', 7000) } catch (e) {}
      }
    } catch (e) { console.warn('[auth] déconnexion depuis propryo.fr', e) }
  }

  // déjà connecté (session persistée) → enchaîner direct. C'EST le chemin qui tue le double-login :
  // après un reload, la session persistée est retrouvée ici → Accueil sans re-saisir le mot de passe.
  const { user, error: _errAuth } = await api.currentUserOrError()
  _perfMark('session')
  if (!user) { try { overlay.classList.remove('imsb-restoring') } catch (e) {} }   // pas de session valide → on montre le formulaire
  if (user) { try { window.__immoCrumb && window.__immoCrumb('already-connected') } catch (e) {} return onLoggedIn(api, overlay, user) }

  // ── EDL TERRAIN lot 4 — « on ne peut pas SE CONNECTER hors ligne, on peut
  // RESTER connecté hors ligne » (CDC §3, verrou 2). getUser() est un appel
  // RÉSEAU : sans réseau il échoue, et l'écran de connexion qui suit a besoin
  // du réseau lui aussi. Cul-de-sac — et l'état des lieux en cours avec.
  // Les verdicts sont pris par le module testé js/core/offline-boot.js ; ici on
  // ne fait qu'aller chercher les trois éléments dont il a besoin.
  if (_offlineBoot) {
    try {
      const sessionLocale = await api.localSession()
      const tagMiroir = _offlineBoot.classerMiroirHorsLigne(
        localStorage.getItem(MIRROR_TAG_KEY),
        sessionLocale && sessionLocale.user && sessionLocale.user.id
      )
      const d = _offlineBoot.decideDemarrage({ user: null, erreur: _errAuth, sessionLocale, tagMiroir })
      try { window.__immoCrumb && window.__immoCrumb('boot-' + d.mode + ':' + d.motif) } catch (e) {}
      if (d.mode === 'hors-ligne') return onHorsLigne(api, overlay, sessionLocale)
    } catch (e) { console.warn('[Supabase] décision hors ligne', e) }
  }

  try { window.__immoCrumb && window.__immoCrumb('login-form-shown') } catch (e) {}
  wireLoginForm(api, overlay)
}

function wireLoginForm(api, overlay, prefillEmail) {
  // Bascule Connexion ↔ Inscription (self-service gardée par le hook allowlist côté serveur).
  // Réutilise les champs email/mdp du formulaire login (DRY) : seul le mode + le libellé changent.
  let mode = overlay._authMode || (/[?&]inscription/.test(location.search || '') ? 'signup' : 'login')  // 'login' | 'signup' (mémorisé : wireLoginForm peut être rappelé)
  const q = s => overlay.querySelector(s)
  const applyMode = () => {
    const lead = q('#imsb-form .imsb-lead')
    if (lead) lead.textContent = mode === 'signup' ? 'Tout Propryo à l\'essai pendant 30 jours, sans carte bancaire.' : 'Se connecter pour gérer ses locations.'
    const h2 = q('#imsb-form .imsb-h2'), sub = q('#imsb-submit'), lnk = q('#imsb-signup'), pw = q('#imsb-pass')
    if (mode === 'signup') {
      if (h2) h2.textContent = 'Créer un compte'
      if (sub) sub.textContent = 'Créer mon compte'
      if (lnk) lnk.textContent = '← J\'ai déjà un compte'
      if (pw) { pw.setAttribute('minlength', '6'); pw.setAttribute('autocomplete', 'new-password'); pw.placeholder = '6 caractères minimum' }
    } else {
      if (h2) h2.textContent = 'Connexion'
      if (sub) sub.textContent = 'Se connecter'
      if (lnk) lnk.textContent = 'Créer un compte · essai gratuit'
      if (pw) { pw.setAttribute('autocomplete', 'current-password'); pw.placeholder = '••••••••' }
    }
    overlay._authMode = mode
    showError(overlay, '')
  }
  applyMode()
  const sgn = q('#imsb-signup')
  if (sgn) sgn.onclick = (e) => { e.preventDefault(); mode = (mode === 'login' ? 'signup' : 'login'); applyMode() }

  q('#imsb-form').onsubmit = async (e) => {
    e.preventDefault()
    try { window.__immoCrumb && window.__immoCrumb('login-start') } catch (_e) {}
    const email = q('#imsb-email').value.trim()
    const pass = q('#imsb-pass').value
    // « Rester connecté sur cet appareil » : choisi AVANT que la session ne soit écrite (sinon le jeton partirait au
    // mauvais endroit). Sans case (application installée) ou sans stockage : rien à faire.
    try { const rem = q('#imsb-remember'); if (rem && _authStorage) _authStorage.setPersist(!!rem.checked) } catch (e) {}
    setBusy(overlay, true); showError(overlay, '')
    if (mode === 'signup') {
      const s = await api.signUpEmail(email, pass).catch(err => ({ ok: false, error: err.message }))
      _annulerChoixAuth()
      if (!s.ok) {
        setBusy(overlay, false)
        if (/already.*(regist|exist)|user already/i.test(s.error || '')) { showError(overlay, 'Ce compte existe déjà : se connecter.'); mode = 'login'; applyMode(); return }
        showError(overlay, traduireErreur(s.error)); return   // inclut le refus du hook (« pas encore autorisé »)
      }
      // Compte créé (confirmation email désactivée → session directe). On enchaîne sur la connexion.
      _rearmerChoixAuth()
      const r = await api.loginEmail(email, pass).catch(err => ({ ok: false, error: err.message }))
      _annulerChoixAuth()
      setBusy(overlay, false)
      if (!r.ok) { showError(overlay, 'Compte créé : se connecter avec le mot de passe choisi.'); mode = 'login'; applyMode(); return }
      onLoggedIn(api, overlay, r.user)
      return
    }
    const r = await api.loginEmail(email, pass).catch(err => ({ ok: false, error: err.message }))
    _annulerChoixAuth()
    setBusy(overlay, false)
    if (!r.ok) { showError(overlay, traduireErreur(r.error)); return }
    try { window.__immoCrumb && window.__immoCrumb('login-ok') } catch (_e) {}
    onLoggedIn(api, overlay, r.user)
  }
  // v15.774 MOT DE PASSE OUBLIÉ — par code à 6 chiffres, dans la même carte (ouvrirRecuperation).
  q('#imsb-forgot').onclick = (e) => {
    e.preventDefault()
    ouvrirRecuperation(api, overlay)
  }
  if (prefillEmail) q('#imsb-email').value = prefillEmail
  // v15.422 BUG-LOGIN-PREMIERE-CONNEXION — l'utilisateur a cliqué « Se connecter » PENDANT le
  // chargement (garde d'injectOverlay) : on remet le bouton en état et on REJOUE sa demande
  // maintenant que le vrai handler est câblé — il n'a pas à re-cliquer.
  setBusy(overlay, false)
  if (overlay._pendingSubmit) {
    overlay._pendingSubmit = false
    const f = q('#imsb-form')
    const email = (q('#imsb-email') || {}).value, pass = (q('#imsb-pass') || {}).value
    if (f && email && pass) {
      if (typeof f.requestSubmit === 'function') f.requestSubmit()
      else f.onsubmit(new Event('submit', { cancelable: true }))
    }
  }
}

// ── MOT DE PASSE OUBLIÉ (v15.774) ─────────────────────────────────────────────────────────────
// Panneau #imsb-recup posé DANS la carte de connexion (#imsb-left), à la place du formulaire #imsb-form (masqué, pas
// détruit : « Retour à la connexion » le rend tel quel). Règles et messages : js/core/mot-de-passe-oublie.js (testé).
// Étape 1 : adresse → code (message identique que le compte existe ou non). Étape 2 : code + nouveau mot de passe ×2
// → verifyOtp(recovery) → updateUser → onLoggedIn. Un compte LOCATAIRE SEUL n'obtient pas de mot de passe.
// Exportée pour la vérification visuelle (harnais local, api simulée) ; aucun autre appelant.
export function ouvrirRecuperation(api, overlay) {
  const left = overlay.querySelector('#imsb-left'), form = overlay.querySelector('#imsb-form')
  if (!left || !form) return
  const MP = _mdpOublie
  const ancien = left.querySelector('#imsb-recup'); if (ancien) ancien.remove()
  showError(overlay, '')
  overlay.classList.add('imv-auth-open')
  const p = document.createElement('form')
  p.id = 'imsb-recup'; p.className = 'imsb-mid'; p.setAttribute('autocomplete', 'on'); p.noValidate = true
  p.innerHTML = `
    <h2 class="imsb-h2">Mot de passe oublié</h2>
    <p class="imsb-lead" id="imsb-recup-lead">Recevoir un code par e-mail, puis choisir un nouveau mot de passe.</p>
    <div class="imsb-ok" id="imsb-recup-ok" role="status" hidden></div>
    <div class="imsb-err" id="imsb-recup-err" role="alert" hidden></div>
    <div class="imsb-recup-etape" id="imsb-recup-e1">
      <label class="imsb-flabel" for="imsb-recup-email">Email</label>
      <input class="imsb-input" id="imsb-recup-email" type="email" placeholder="nom@exemple.fr" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false">
      <button class="imsb-btn imsb-primary" id="imsb-recup-envoyer" type="submit">Recevoir un code</button>
    </div>
    <div class="imsb-recup-etape" id="imsb-recup-e2" hidden>
      <p class="imsb-recup-adr">Adresse : <b id="imsb-recup-adr"></b> <a href="#" id="imsb-recup-changer">Modifier</a></p>
      <input type="email" id="imsb-recup-user" autocomplete="username" tabindex="-1" aria-hidden="true" class="imsb-recup-user" readonly>
      <label class="imsb-flabel" for="imsb-recup-code">Code reçu par e-mail</label>
      <input class="imsb-input imsb-recup-code" id="imsb-recup-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="9" placeholder="6 chiffres" spellcheck="false">
      <label class="imsb-flabel" for="imsb-recup-mdp">Nouveau mot de passe</label>
      <input class="imsb-input" id="imsb-recup-mdp" type="password" autocomplete="new-password" minlength="${MP.MDP_MIN}" placeholder="${MP.MDP_MIN} caractères minimum">
      <label class="imsb-flabel" for="imsb-recup-mdp2">Confirmer le mot de passe</label>
      <input class="imsb-input" id="imsb-recup-mdp2" type="password" autocomplete="new-password" minlength="${MP.MDP_MIN}" placeholder="Le même, une seconde fois">
      <label class="imsb-remember" id="imsb-recup-remember-row"><input type="checkbox" id="imsb-recup-remember"><span>Rester connecté sur cet appareil<small>Ne pas cocher sur un ordinateur partagé ou public.</small></span></label>
      <button class="imsb-btn imsb-primary" id="imsb-recup-valider" type="submit">Enregistrer et se connecter</button>
      <button class="imsb-btn imsb-ghost" id="imsb-recup-renvoyer" type="button">Renvoyer le code</button>
    </div>
    <button class="imsb-btn imsb-ghost" id="imsb-recup-retour" type="button">← Retour à la connexion</button>`
  form.style.display = 'none'
  left.appendChild(p)
  const $ = (s) => p.querySelector(s)
  const e1 = $('#imsb-recup-e1'), e2 = $('#imsb-recup-e2'), ok = $('#imsb-recup-ok'), err = $('#imsb-recup-err')
  const btnEnv = $('#imsb-recup-envoyer'), btnVal = $('#imsb-recup-valider'), btnRenv = $('#imsb-recup-renvoyer')
  const st = { etape: 1, email: '', dernierEnvoi: 0, minuterie: null, sessionRecup: false, occupe: false }
  const dire = (msgOk, msgErr) => {
    ok.textContent = msgOk || ''; ok.hidden = !msgOk
    err.textContent = msgErr || ''; err.hidden = !msgErr
  }
  const occuper = (b, libelle) => {
    st.occupe = !!b
    const btn = st.etape === 1 ? btnEnv : btnVal
    btn.disabled = !!b
    btn.innerHTML = b ? `<span class="imsb-spin imsb-spin-sm"></span> ${escapeHtml(libelle)}` : (st.etape === 1 ? 'Recevoir un code' : 'Enregistrer et se connecter')
  }
  const majRenvoi = () => {
    const s = MP.secondesAvantRenvoi(st.dernierEnvoi)
    btnRenv.disabled = s > 0 || st.occupe
    btnRenv.textContent = s > 0 ? `Renvoyer le code (dans ${s} s)` : 'Renvoyer le code'
    if (s <= 0 && st.minuterie) { clearInterval(st.minuterie); st.minuterie = null }
  }
  const armerRenvoi = () => {
    st.dernierEnvoi = Date.now()
    if (st.minuterie) clearInterval(st.minuterie)
    st.minuterie = setInterval(() => { if (!p.isConnected) { clearInterval(st.minuterie); st.minuterie = null; return } majRenvoi() }, 1000)
    majRenvoi()
  }
  const allerEtape = (n) => {
    st.etape = n; e1.hidden = n !== 1; e2.hidden = n !== 2
    $('#imsb-recup-lead').textContent = n === 1 ? 'Recevoir un code par e-mail, puis choisir un nouveau mot de passe.' : 'Saisir le code reçu et choisir un nouveau mot de passe.'
    if (n === 2) {
      $('#imsb-recup-adr').textContent = st.email
      $('#imsb-recup-user').value = st.email
      setTimeout(() => { try { $('#imsb-recup-code').focus() } catch (_e) {} }, 0)
    } else setTimeout(() => { try { $('#imsb-recup-email').focus() } catch (_e) {} }, 0)
  }
  // Session de récupération ouverte mais abandonnée (retour, compte locataire) : fermée sur cet appareil.
  const abandonner = async () => { if (st.sessionRecup) { st.sessionRecup = false; await api.signOutLocal() } }
  const fermer = async (email) => {
    if (st.minuterie) clearInterval(st.minuterie)
    await abandonner()
    p.remove(); form.style.display = ''
    if (email) { const f = overlay.querySelector('#imsb-email'); if (f) f.value = email }
    showError(overlay, '')
  }
  const envoyer = async (renvoi) => {
    const v = MP.validerEtapeEmail(renvoi ? st.email : $('#imsb-recup-email').value)
    if (!v.ok) { dire('', v.erreur); return }
    if (renvoi && MP.secondesAvantRenvoi(st.dernierEnvoi) > 0) return
    dire('', '')
    // Pendant un renvoi, la validation est suspendue (le code saisi va être remplacé).
    if (renvoi) { st.occupe = true; btnVal.disabled = true; btnRenv.disabled = true; btnRenv.textContent = 'Envoi…' } else occuper(true, 'Envoi…')
    const r = await api.sendPasswordReset(v.email).catch((e) => ({ ok: false, err: e }))
    if (renvoi) { st.occupe = false; btnVal.disabled = false } else occuper(false)
    const k = r.ok ? 'envoye' : MP.classerErreur(r.err || r.error, 'envoi')
    if (k !== 'envoye') { majRenvoi(); dire('', MP.MESSAGES[k] || MP.MESSAGES.autre); return }
    st.email = v.email
    armerRenvoi()
    if (renvoi) { dire(MP.MESSAGES.renvoye, ''); $('#imsb-recup-code').value = '' } else { allerEtape(2); dire(MP.MESSAGES.envoye, '') }
  }
  const valider = async () => {
    const v = MP.validerEtapeCode({ code: $('#imsb-recup-code').value, mdp: $('#imsb-recup-mdp').value, mdp2: $('#imsb-recup-mdp2').value })
    if (!v.ok) {
      dire('', v.erreur)
      try { $({ code: '#imsb-recup-code', mdp: '#imsb-recup-mdp', mdp2: '#imsb-recup-mdp2' }[v.champ]).focus() } catch (_e) {}
      return
    }
    dire('', ''); occuper(true, 'Vérification…'); majRenvoi()
    // « Rester connecté » : choisi AVANT que la session ne soit écrite (même règle que la connexion).
    try { if (_authStorage) _authStorage.setPersist(!!$('#imsb-recup-remember').checked) } catch (_e) {}
    let user = null
    if (!st.sessionRecup) {
      const r = await api.verifyRecovery(st.email, v.code).catch((e) => ({ ok: false, err: e }))
      _annulerChoixAuth()
      if (!r.ok) { occuper(false); majRenvoi(); dire('', MP.messageErreur(r.err || r.error, 'code')); return }
      st.sessionRecup = true; user = r.user
      // Compte LOCATAIRE SEUL (0065) : connexion par code depuis l'espace locataire, jamais de mot de passe ici.
      if ((await api.estLocataireSeul()) === true) {
        await abandonner()
        occuper(false); e2.hidden = true; if (st.minuterie) { clearInterval(st.minuterie); st.minuterie = null }
        dire('', MP.MESSAGES.locataire); return
      }
    }
    const u = await api.updatePassword($('#imsb-recup-mdp').value).catch((e) => ({ ok: false, err: e }))
    if (!u.ok) {
      occuper(false); majRenvoi()
      // Le code a servi : la session de récupération reste ouverte, un nouvel essai ne redemande que le mot de passe.
      dire('', MP.messageErreur(u.err || u.error, 'mdp')); return
    }
    st.sessionRecup = false
    if (st.minuterie) { clearInterval(st.minuterie); st.minuterie = null }
    try { window.__immoCrumb && window.__immoCrumb('recup-ok') } catch (_e) {}
    dire(MP.MESSAGES.succes, '')
    try { if (typeof window.showToast === 'function') window.showToast(MP.MESSAGES.modifie, '', 5000) } catch (_e) {}
    onLoggedIn(api, overlay, u.user || user)
  }
  p.onsubmit = (ev) => { ev.preventDefault(); if (st.occupe) return; (st.etape === 1 ? envoyer(false) : valider()) }
  btnRenv.onclick = () => { if (!st.occupe) envoyer(true) }
  $('#imsb-recup-retour').onclick = () => fermer(st.email || normaliserSaisie($('#imsb-recup-email').value))
  $('#imsb-recup-changer').onclick = async (ev) => {
    ev.preventDefault(); await abandonner()
    $('#imsb-recup-email').value = st.email; allerEtape(1); dire('', '')
  }
  // Code collé (« 123 456 ») : chiffres seulement.
  $('#imsb-recup-code').addEventListener('input', (ev) => { const c = MP.normaliserCode(ev.target.value); if (c !== ev.target.value) ev.target.value = c })
  // « Rester connecté » : même règle que l'écran de connexion (masqué dans l'application installée, jamais hérité
  // d'une autre personne : on reprend seulement la case que la personne vient de cocher sur l'écran de connexion).
  try {
    const row = $('#imsb-recup-remember-row'), box = $('#imsb-recup-remember'), src = overlay.querySelector('#imsb-remember')
    if (!_authStorage || _authStorage.isStandalone()) row.hidden = true
    else box.checked = !!(src && src.checked)
  } catch (_e) {}
  $('#imsb-recup-email').value = normaliserSaisie((overlay.querySelector('#imsb-email') || {}).value)
  allerEtape(1)
}
const normaliserSaisie = (v) => String(v == null ? '' : v).trim()

// ── PARCOURS D'ACCEPTATION D'UNE INVITATION (?invite=<token>) ─────────────────────────────────
// Aperçu (invitation_preview) → connexion / création de compte → accept_invitation → on enchaîne sur
// l'app SANS recharger (garde la session en mémoire) ; la RLS scope l'invité à ses SCIs octroyées.
function _inviteErr(m) {
  if (/ALREADY_FULL_MEMBER/.test(m)) return 'Ce compte est déjà membre à part entière de cet espace.'
  if (/ALREADY_USED/.test(m)) return 'Cette invitation a déjà été utilisée.'
  if (/REVOKED/.test(m)) return 'Cette invitation a été annulée.'
  if (/EXPIRED/.test(m)) return 'Cette invitation a expiré.'
  if (/NOT_FOUND/.test(m)) return 'Invitation introuvable.'
  return m || 'Impossible de rejoindre ce partage.'
}
function renderInviteError(overlay, msg) {
  const left = overlay.querySelector('#imsb-left'); if (!left) return
  overlay.classList.add('imv-auth-open')  // erreur d'invitation → ouvrir la modale (sinon message invisible)
  left.innerHTML = `${brand()}<div class="imsb-mid">
    <h2 class="imsb-h2">Invitation</h2>
    <div class="imsb-err" style="display:block">${escapeHtml(msg)}</div>
    <a class="imsb-btn imsb-ghost" href="${escapeHtml(location.origin + location.pathname)}" style="text-decoration:none;margin-top:10px">Aller à l'application</a></div>`
}
async function acceptInviteFlow(api, client, overlay, token) {
  let preview = null
  try { const r = await client.rpc('invitation_preview', { p_token: token }); preview = r && r.data } catch (e) {}
  if (!preview) return renderInviteError(overlay, 'Cette invitation est introuvable. Un nouveau lien est à demander.')
  if (preview.status === 'revoked') return renderInviteError(overlay, 'Cette invitation a été annulée.')
  if (preview.expired) return renderInviteError(overlay, 'Cette invitation a expiré. Un nouveau lien est à demander.')

  const cleanUrl = location.origin + location.pathname
  const espace = escapeHtml(preview.espace_nom || 'un espace')
  const perim = (preview.grants || []).map(g =>
    `${escapeHtml(g.entite_nom || 'SCI')} <b>(${g.mode === 'ecriture' ? 'écriture' : 'lecture'})</b>`).join(' · ') || 'des biens partagés'

  // accepte puis enchaîne SANS recharger (garde la session ; URL nettoyée du ?invite)
  const accept = async () => {
    const { error } = await client.rpc('accept_invitation', { p_token: token })
    if (error) { showError(overlay, _inviteErr(error.message)); return false }
    try { history.replaceState(null, '', cleanUrl) } catch (e) {}
    const u = await api.currentUser()
    onLoggedIn(api, overlay, u)
    return true
  }

  const user = await api.currentUser()
  const left = overlay.querySelector('#imsb-left'); if (!left) return
  overlay.classList.add('imv-auth-open')  // invitation → ouvrir la modale de connexion/acceptation
  if (user) {
    left.innerHTML = `${brand()}<div class="imsb-mid">
      <h2 class="imsb-h2">Rejoindre un partage</h2>
      <p class="imsb-lead">Accès donné à : ${perim}<br>dans « ${espace} ».</p>
      <div class="imsb-err" id="imsb-error" style="display:none"></div>
      <button class="imsb-btn imsb-primary" id="imsb-join" type="button">Rejoindre en tant que ${escapeHtml(user.email)}</button>
      <a class="imsb-btn imsb-ghost" id="imsb-join-other" href="#" style="text-decoration:none;margin-top:6px">Utiliser un autre compte</a></div>`
    left.querySelector('#imsb-join').onclick = async (ev) => { ev.target.disabled = true; if (!(await accept())) ev.target.disabled = false }
    // EDL TERRAIN lot 4, F2 — changer de compte, c'est une déconnexion : la purge du
    // jeton juste dessous rend le travail non synchronisé irrécupérable. Le refus
    // était AVALÉ ici (`catch (e) {}` puis on purgeait quand même).
    left.querySelector('#imsb-join-other').onclick = async (ev) => {
      ev.preventDefault()
      let r = null
      try { r = await api.logout() } catch (e) { r = { ok: false, raison: 'flush-impossible', enAttente: 1 } }
      if (r && r.ok === false) {
        if (!(await _accepteDePerdre(r))) return          // on reste connecté : rien n'est purgé
        try { await api.logout({ forcer: true }) } catch (e) {}
      }
      _purgeAuthTokenKeys(); acceptInviteFlow(api, client, overlay, token)
    }
    return
  }
  left.innerHTML = `${brand()}<form id="imsb-iform" class="imsb-mid" autocomplete="on">
    <h2 class="imsb-h2">Rejoindre un partage</h2>
    <p class="imsb-lead">Accès donné à : ${perim}<br>dans « ${espace} ». Créer un compte (ou se connecter) pour rejoindre.</p>
    <div class="imsb-err" id="imsb-error" style="display:none"></div>
    <label class="imsb-flabel">Email</label>
    <input class="imsb-input" id="imsb-email" type="email" placeholder="nom@exemple.fr" required autocomplete="username">
    <label class="imsb-flabel">Mot de passe</label>
    <input class="imsb-input" id="imsb-pass" type="password" placeholder="6 caractères minimum" required autocomplete="current-password" minlength="6">
    <button class="imsb-btn imsb-primary" id="imsb-submit" type="submit">Créer mon compte et rejoindre</button>
    <p class="imsb-note" style="margin-top:12px">Déjà un compte ? Saisir les identifiants : la connexion se fait automatiquement.</p></form>`
  left.querySelector('#imsb-iform').onsubmit = async (e) => {
    e.preventDefault()
    const email = left.querySelector('#imsb-email').value.trim()
    const pass = left.querySelector('#imsb-pass').value
    const btn = left.querySelector('#imsb-submit')
    btn.disabled = true; showError(overlay, '')
    const fail = (msg) => { btn.disabled = false; showError(overlay, msg) }
    try { if (_authStorage) _authStorage.setPersist(false) } catch (e) {}   // invité : session de l'onglet (pas de case ici), AVANT d'écrire le jeton
    let r = await api.signUpEmail(email, pass).catch(err => ({ ok: false, error: err.message }))
    _annulerChoixAuth()
    if (!r.ok && /already.*(regist|exist)|user already/i.test(r.error || '')) {
      _rearmerChoixAuth()
      r = await api.loginEmail(email, pass).catch(err => ({ ok: false, error: err.message }))
      _annulerChoixAuth()
      if (!r.ok) return fail('Ce compte existe déjà, mais le mot de passe ne correspond pas.')
    } else if (!r.ok) {
      return fail(traduireErreur(r.error))
    } else if (r.ok && !r.session) {
      return fail('Compte créé : il reste à confirmer l\'email (l\'envoi d\'emails n\'est pas encore activé : prévenir la personne qui a envoyé l\'invitation).')
    }
    if (!(await accept())) btn.disabled = false
  }
}

/**
 * EDL TERRAIN lot 4 — DÉMARRAGE HORS LIGNE (CDC §3).
 *
 * On n'arrive ici que si les trois conditions du CDC sont réunies : `getUser()`
 * a échoué FAUTE DE RÉSEAU (et pas parce que le jeton est refusé), une session
 * persistée existe en local, et le miroir porte le tag de CET utilisateur.
 *
 * Rien de nouveau n'est divulgué : ces données sont DÉJÀ sur l'appareil, écrites
 * par saveDB. On autorise leur lecture, on ne les fait pas apparaître.
 */
async function onHorsLigne(api, overlay, session) {
  try {
    // STOCKAGE lot 4 : le miroir est lu là où il vit — IndexedDB + journal des EDL non engagés
    // (miroir prêt), sinon la clé locale (repli, module absent) comme avant.
    let db = null
    const _M = (typeof _miroirLocal !== 'undefined' && _miroirLocal) ? _miroirLocal.miroir() : null
    if (_M && _M.pret()) db = await _M.lire()
    else { const raw = localStorage.getItem(MIRROR_KEY); db = raw ? JSON.parse(raw) : null }
    // ⚠️ RGPD — le miroir est filtré AVANT d'être affiché. Il ne suffit pas de
    // protéger la remontée : Logements, Locataires et les fiches 360 sont
    // OUVERTS hors ligne, et le miroir peut contenir un espace dont on a été
    // retiré. Sans ce filtre, une associée révoquée revoit tout, sans réseau.
    if (db && _offlineBoot) {
      let permis = null
      try { permis = JSON.parse(localStorage.getItem(_offlineBoot.ESPACES_KEY) || 'null') } catch (e) { permis = null }
      db = _offlineBoot.filtrerMiroirParEspacesAutorises(db, permis || [])
    }
    if (!db || typeof window.__immoSetDB !== 'function' || typeof window.__immoRender !== 'function') {
      // Rien de lisible : on retombe sur le comportement d'aujourd'hui.
      try { window.__immoCrumb && window.__immoCrumb('hors-ligne-abandon:miroir-vide') } catch (e) {}
      return wireLoginForm(api, overlay)
    }
    // STOCKAGE lot 4 (contre-audit Q3) — copie hors ligne INCOMPLÈTE : seuls les états des lieux du
    // journal ont pu être gardés (base trop grande pour le stockage local pendant un repli protégé).
    // Pas de formulaire muet : on dit ce qui se passe et quoi faire. Les EDL restent sur l'appareil.
    if (Object.keys(db).every(k => k === 'edl')) {
      try { window.__immoCrumb && window.__immoCrumb('hors-ligne-abandon:copie-incomplete') } catch (e) {}
      const _r = wireLoginForm(api, overlay)
      try {
        if (typeof showError === 'function') showError(overlay, 'Copie hors ligne incomplète sur cet appareil : se connecter au réseau pour continuer ; les états des lieux saisis sont conservés.')
      } catch (e) {}
      return _r
    }
    // F3 (invariant 19h) — LE DRAPEAU D'ABORD. saveDB teste `__immoSupabaseMode`
    // avant `_CLOUD_BOOT` ; sans lui, la branche boot-cloud sort en n'écrivant
    // RIEN : chaque autosave serait un no-op et la visite disparaîtrait au
    // premier rechargement, sans un message.
    window.__immoSupabaseMode = true
    window.__immoHorsLigne = true
    window.__immoMarkDirty = () => {}   // pas de destination : le miroir suffit
    if (window.__immoSetDB(db) === false) {
      try { window.__immoCrumb && window.__immoCrumb('hors-ligne-abandon:db-invalide') } catch (e) {}
      window.__immoSupabaseMode = false
      window.__immoHorsLigne = false
      return wireLoginForm(api, overlay)
    }
    window.__immoRender()
    // F10 (invariant 19m) — sans ça, `data-lpboot` masque tout : app blanche.
    _liftDriveGate()
    overlay.remove()
    // Le bandeau permanent + le verrouillage des onglets vivent dans l'app
    // (index.html) : elle seule connaît sa navigation. On lui passe la date des
    // données affichées (invariant 19c).
    let ecritA = 0
    try { ecritA = parseInt(localStorage.getItem(_offlineBoot.MIROIR_ECRIT_KEY) || '0', 10) || 0 } catch (e) {}
    // STOCKAGE lot 4 (contre-audit) — la dernière copie complète n'a pas pu être écrite (grand compte,
    // repli protégé) : la base affichée est ANCIENNE, et `_ecrit_at` (récent) ferait croire le contraire.
    // Le bandeau le dit ; l'app reste ouverte (les EDL du journal sont superposés, la saisie continue).
    let _copieAncienne = false
    try { _copieAncienne = !!(_M && typeof _M.copieIncomplete === 'function' && _M.copieIncomplete()) } catch (e) {}
    try {
      if (typeof window.__immoEntrerHorsLigne === 'function') {
        // On passe les FONCTIONS du module, pas des listes recopiées : index.html
        // ne peut pas importer un module ES depuis son script inline, et une
        // seconde copie des règles dériverait de la première (règle DRY).
        window.__immoEntrerHorsLigne({
          donneesDu: ecritA || Date.now(),
          email: (session && session.user && session.user.email) || '',
          libelle: _copieAncienne
            ? 'Copie hors ligne ancienne sur cet appareil : se connecter au réseau pour la mettre à jour ; les états des lieux saisis sont conservés.'
            : _offlineBoot.libelleDonneesDu(ecritA || Date.now()),
          ongletDisponible: id => _offlineBoot.ongletDisponibleHorsLigne(id),
          motifOnglet: id => _offlineBoot.motifOnglet(id),
          motif: quoi => _offlineBoot.motifIndisponible(quoi),
          ecritureAutorisee: quoi => _offlineBoot.ecritureAutoriseeHorsLigne(quoi),
        })
      }
    } catch (e) { console.warn('[Supabase] bandeau hors ligne', e) }
    try { window.__immoCrumb && window.__immoCrumb('hors-ligne-ouvert') } catch (e) {}
  } catch (e) {
    console.warn('[Supabase] démarrage hors ligne', e)
    try { return wireLoginForm(api, overlay) } catch (_e) {}
  }
}

/**
 * EDL TERRAIN lot 4, faille F2 (invariant 19g) — LA DÉCONNEXION EST-ELLE SÛRE ?
 *
 * ═══ LE TROU QUE L'AUDIT A TROUVÉ ═════════════════════════════════════════
 * `api.logout` interroge le MOTEUR de synchro pour savoir s'il reste des
 * écritures en attente. Or le moteur n'est câblé que par `onLoggedIn` : sur le
 * chemin HORS LIGNE il vaut `null`, la garde était donc fausse, la déconnexion
 * passait — et la purge du miroir qui suit emportait l'EDL de la visite. Les
 * photos survivaient en IndexedDB, mais ORPHELINES. C'est exactement la faille
 * F2 du CDC, reproduite là où elle fait le plus de dégâts : dans l'appartement.
 *
 * La bonne question n'est pas « y a-t-il un moteur ? » mais « le miroir
 * porte-t-il du travail qui n'est pas parti ? ». Elle se pose sur des
 * HORODATAGES, qui existent dans les deux modes.
 *
 * Fonction NOMMÉE, au niveau du module, pour être exécutable par un test : la
 * version précédente vivait dans une fonction fléchée du boot, inatteignable.
 *
 * @returns {null|{ok:false, raison:string, enAttente:number}} null = on peut partir
 */
function _refusDeconnexionLocale({ api, forcer }) {
  if (forcer || !_offlineBoot) return null
  try {
    // STOCKAGE lot 4 : un miroir IndexedDB (ou son journal d'EDL, ou un IndexedDB illisible) compte
    // comme un miroir présent ; l'heure du dernier travail est le MAX entre `_ecrit_at` et `travailA`
    // (IndexedDB), qui survit quand Chromium perd les écritures localStorage récentes (audit O4).
    const _M = (typeof _miroirLocal !== 'undefined' && _miroirLocal) ? _miroirLocal.miroir() : null
    // Miroir PROTÉGÉ (illisible alors que du travail n'est pas remonté, audit R1) : la déconnexion
    // l'effacerait. Refus, quel que soit l'état du réseau.
    if (_M && _M.protege()) return { ok: false, raison: 'miroir-illisible', enAttente: 1 }
    const miroir = !!localStorage.getItem(MIRROR_KEY) || !!(_M && _M.present())
    const v = _offlineBoot.verdictDeconnexion({
      forcer: false,
      moteurPresent: !!(api && api.sync),
      horsLigne: !!window.__immoHorsLigne,
      miroirPresent: !!miroir,
      miroirEcritA: Math.max(parseInt(localStorage.getItem(_offlineBoot.MIROIR_ECRIT_KEY) || '0', 10) || 0, (_M && _M.travailA()) || 0),
      dernierFlushA: parseInt(localStorage.getItem(_offlineBoot.FLUSH_OK_KEY) || '0', 10) || 0,
    })
    if (v.peut) return null
    return { ok: false, raison: v.raison, enAttente: v.enAttente }
  } catch (e) {
    console.warn('[Supabase] verdict de déconnexion', e)
    return null   // on ne bloque jamais sur une règle qu'on n'a pas pu évaluer
  }
}

/**
 * EDL TERRAIN lot 4, faille F1 (invariants 18, 19f) — LE TRAVAIL HORS LIGNE
 * REMONTE AVANT QUE LE CLOUD ÉCRASE LA MÉMOIRE.
 *
 * Le miroir localStorage est en ÉCRITURE SEULE en mode cloud : personne ne le
 * relit jamais. Séquence vécue : EDL saisi hors ligne → l'app est fermée →
 * retour à la maison AVEC réseau → hydratation → le DB cloud remplace la
 * mémoire. L'EDL hors ligne n'a jamais existé.
 *
 * On ne « charge pas le miroir puis on flushe » : le moteur diffe la baseline
 * contre le DB vivant, donc tout ce qui est au cloud et absent du miroir
 * partirait en SUPPRESSION — on effacerait le travail d'un associé. On part du
 * cloud et on n'y REVERSE que les états des lieux du miroir absents ou plus
 * récents, puis on pousse.
 *
 * ⚠️ L'ORDRE EST LE CONTRAT : baseline = SERVEUR, vivant = fusionné, ENVOI, et
 * seulement ensuite la ré-hydratation. Deux inversions de cet ordre ont déjà
 * détruit du travail réel — c'est pourquoi cette séquence est une fonction
 * nommée, testable, et non plus quarante lignes noyées dans le boot.
 *
 * @returns {{db:object, dbServeur:object|null, ajoutes:number, majs:number, envoiOk:boolean}}
 */
async function _remonterTravailHorsLigne({ api, db, setSync, tagMiroir, espacesAutorises }) {
  const rien = { db, dbServeur: null, ajoutes: 0, majs: 0, envoiOk: true }
  // Le miroir est résolu HORS du `try` : le `catch` en a besoin (contre-audit C1).
  const _M = (typeof _miroirLocal !== 'undefined' && _miroirLocal) ? _miroirLocal.miroir() : null
  try {
    if (!_offlineBoot) return rien
    // STOCKAGE lot 4 : un repli décidé au démarrage sur un IndexedDB MUET est RETENTÉ avant toute
    // lecture (audit R1) ; l'heure du dernier travail est le MAX entre `_ecrit_at` et `travailA`
    // (enregistrement IndexedDB) — Chromium peut perdre les écritures localStorage récentes (O4).
    if (_M && _M.pret()) await _M.retenterSiIncertain()
    // Contre-audit C2 : IndexedDB TOUJOURS illisible après la nouvelle tentative → son contenu est
    // INCONNU, donc `travailA` aussi (navigateur tué + IndexedDB muet : `_ecrit_at` perdu, travailA
    // illisible). Un contenu inconnu est traité comme du travail POSSIBLE : mode protégé AVANT toute
    // sortie anticipée (le rebase fusionnera, `_flush_at` reste figé, la déconnexion est refusée).
    if (_M && _M.pret() && _M.incertain()) {
      _M.proteger()
      console.warn('[Supabase] F1 — copie de l’appareil illisible : protégée jusqu’au prochain démarrage')
      try { window.__immoCrumb && window.__immoCrumb('f1-miroir-incertain') } catch (e) {}
    }
    const ecritA = Math.max(parseInt(localStorage.getItem(_offlineBoot.MIROIR_ECRIT_KEY) || '0', 10) || 0, (_M && _M.travailA()) || 0)
    const flushA = parseInt(localStorage.getItem(_offlineBoot.FLUSH_OK_KEY) || '0', 10) || 0
    // ⚠️ `tagMiroir` est le verdict d'AVANT le login : `onLoggedIn` réécrit le tag
    // du miroir avec l'utilisateur et l'espace courants. Le relire ici rendrait
    // forcément 'same' — une tautologie, pas une protection (constat d'audit).
    if (!_offlineBoot.doitPousserAvantHydratation({ tagMiroir, miroirEcritA: ecritA, dernierFlushA: flushA })) return rien
    // STOCKAGE lot 4 : IndexedDB + journal synchrone des EDL (un EDL enregistré hors ligne dont la
    // transaction IndexedDB n'a pas abouti — app tuée — est dans le journal : il remonte quand même).
    // Lecture TRI-VALUÉE : un IndexedDB ILLISIBLE n'est jamais « absent ». Il met le miroir en mode
    // PROTÉGÉ : on remonte ce qui est lisible, aucune écriture ne l'écrase sans relire et fusionner ses
    // EDL, le dernier envoi réussi n'avance plus (F1 réessaiera au démarrage suivant), et la
    // déconnexion est refusée.
    let miroir = null
    let _illisible = false
    if (_M && _M.pret()) {
      const _e = await _M.lireEtat()
      miroir = _e.db
      if (_e.etat === 'illisible') {
        _illisible = true
        _M.proteger()
        console.warn('[Supabase] F1 — copie de l’appareil illisible : protégée jusqu’au prochain démarrage')
        try { window.__immoCrumb && window.__immoCrumb('f1-miroir-illisible') } catch (e) {}
        try { setSync && setSync('warn', 'Copie de l’appareil illisible — recharger l’app') } catch (e) {}
      }
    }
    else { const raw = localStorage.getItem(MIRROR_KEY); miroir = raw ? JSON.parse(raw) : null }
    // RGPD — on ne reverse JAMAIS un EDL d'un espace qu'on n'a plus. Le tag du
    // miroir n'enregistre que l'espace PROPRE (faille F13 du CDC) : après
    // révocation d'un partage il rend 'same', le miroir n'est donc pas purgé, et
    // il contient encore les EDL de l'espace perdu. C'est l'incident du 12/07 ;
    // sans ce filtre, F1 les ré-affichait ET les remontait au cloud.
    const miroirFiltre = miroir
      ? Object.assign({}, miroir, { edl: _offlineBoot.filtrerEdlParEspacesAutorises(miroir.edl, espacesAutorises) })
      : null
    const f = _offlineBoot.fusionnerEdlHorsLigne(db, miroirFiltre, {
      cleDe: rec => (_recordKey ? _recordKey('edl', rec) : String(rec.id)),
      dernierFlushA: flushA,   // un EDL antérieur au dernier envoi et absent du cloud a été SUPPRIMÉ ailleurs
    })
    if (!f.ajoutes.length && !f.majs.length) return rien
    console.info('[Supabase] F1 — travail hors ligne à remonter :', f.ajoutes.length, 'EDL ajouté(s),', f.majs.length, 'mis à jour')
    try { window.__immoCrumb && window.__immoCrumb('f1-remontee:' + (f.ajoutes.length + f.majs.length)) } catch (e) {}
    const dbServeur = db          // on GARDE l'instantané serveur (il re-sèmera la baseline)
    api.seed(dbServeur)           // baseline = ce que le serveur a
    const vivant = f.db           // vivant = serveur + travail hors ligne
    const sF1 = await api.flush(vivant)   // la file locale part AVANT toute ré-hydratation
    // ⚠️ On LIT le résumé. `FLUSH_OK_KEY` était posée quoi qu'il arrive : un envoi
    // refusé (clé étrangère non résolue, conflit, erreur) devenait « déjà
    // synchronisé », et F1 ne réessayait JAMAIS au démarrage suivant. Un EDL de
    // terrain qui ne remonte pas ne doit pas être muet — c'était la faille F1 en
    // train de se reproduire elle-même.
    const badF1 = sF1 ? (((sF1.errors && sF1.errors.length) || 0) + ((sF1.conflicts && sF1.conflicts.length) || 0) + ((sF1.skipped && sF1.skipped.length) || 0)) : 0
    if (!badF1) {
      // Miroir protégé : une partie n'a pas pu être lue, donc pas envoyée — le dernier envoi « réussi »
      // n'avance pas, sinon F1 croirait tout remonté au démarrage suivant (audit R1).
      if (!_illisible) { try { localStorage.setItem(_offlineBoot.FLUSH_OK_KEY, String(Date.now())) } catch (e) {} }
    } else {
      console.warn('[Supabase] F1 — le travail hors ligne n’est PAS remonté', sF1)
      try { window.__immoCrumb && window.__immoCrumb('f1-echec:' + badF1) } catch (e) {}
      try { setSync && setSync('warn', badF1 + ' modification' + (badF1 > 1 ? 's' : '') + ' hors ligne pas encore enregistrée' + (badF1 > 1 ? 's' : '')) } catch (e) {}
    }
    return { db: vivant, dbServeur, ajoutes: f.ajoutes.length, majs: f.majs.length, envoiOk: !badF1 }
  } catch (e) {
    console.warn('[Supabase] F1 remontée hors ligne', e)
    // Contre-audit C1 : l'envoi (ou la lecture) de F1 a LEVÉ — p. ex. `sealSignedBaux`, non isolé par
    // enregistrement. On rend la base du cloud, mais le miroir peut porter un EDL jamais remonté :
    // mode PROTÉGÉ, sinon le rebase qui suit l'écraserait et `_flush_at` avancerait au premier flush.
    try { if (_M) _M.proteger() } catch (_e) {}
    try { window.__immoCrumb && window.__immoCrumb('f1-exception') } catch (_e) {}
    return rien
  }
}

async function onLoggedIn(api, overlay, user) {
  renderLoading(overlay, user)
  let esp, liveDB = null, flushTimer = null, _lastFlushFn = null, _liveChannel = null
  let _conflitsEdlEnAttente = []   // lot 4bis : clés `edl` conflictées au dernier flush
  let _tagMiroirAvantLogin = 'untagged'   // lot 4 (F1) : verdict du miroir AVANT réécriture du tag

  // ── P1.1 SYNC HONNÊTE (audit 2026-07-12, cause C-B) — pastille topbar RÉELLE. L'ancien #imsb-sync
  // vivait dans le bandeau bleu supprimé au cutover → setSync était un no-op = échecs 100 % invisibles
  // (le 12/07 : 0 écriture cloud sur une journée entière, sans un seul signal). La pastille est
  // (re)créée PARESSEUSEMENT à chaque setSync → elle survit aux re-rendus/re-injections de la topbar.
  const _syncEl = () => {
    let el = document.getElementById('imsb-sync')
    if (el && el.isConnected) return el
    const tb = document.querySelector('.tb')
    if (!tb) return null                          // app pas encore rendue → retenté au prochain setSync
    if (!document.getElementById('imsb-sync-style')) {
      // Style aligné sur la pastille de co-présence (.cop-pill) : mêmes tokens app (--bd/--sur2/--t2),
      // point d'état coloré (vert=sauvé · gris pulsé=en cours · orange=échec · gris=hors ligne).
      const st = document.createElement('style'); st.id = 'imsb-sync-style'
      st.textContent = '#imsb-sync{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;margin-left:8px;border:1px solid var(--bd,#e4e7ee);border-radius:999px;background:var(--sur2,#f7f8fb);font:600 12px/1.2 sans-serif;color:var(--t2,#3c4658);white-space:nowrap;user-select:none;flex:none}'
        + '#imsb-sync .is-dot{width:8px;height:8px;border-radius:50%;background:var(--grn,#16a34a);flex:none}'
        + '#imsb-sync[data-state=saving] .is-dot{background:#8a93a6;animation:imsb-sync-pulse 1s ease-in-out infinite}'
        + '#imsb-sync[data-state=warn] .is-dot,#imsb-sync[data-state=dead] .is-dot{background:var(--org,#f59e0b)}'
        + '#imsb-sync[data-state=warn]{cursor:pointer}'
        + '#imsb-sync[data-state=offline] .is-dot{background:#8a93a6}'
        + '@keyframes imsb-sync-pulse{50%{opacity:.35}}'
        + '@media(max-width:700px){#imsb-sync .is-txt{display:none}#imsb-sync{padding:4px 7px}}'
      document.head.appendChild(st)
    }
    el = document.createElement('div'); el.id = 'imsb-sync'
    el.setAttribute('role', 'status')
    el.innerHTML = '<span class="is-dot"></span><span class="is-txt"></span>'
    el.onclick = () => { if (el.dataset.state === 'warn' && _lastFlushFn) runFlush(_lastFlushFn) }   // clic sur ⚠ = réessayer MAINTENANT
    const anchor = document.getElementById('presence-pill')
    if (anchor && anchor.parentElement === tb) tb.insertBefore(el, anchor)
    else tb.appendChild(el)
    return el
  }
  // I1 : JAMAIS « Enregistré » si conflit/skipped/erreur (donc pas réellement dans le cloud) — honnête.
  const setSync = (state, detail) => {
    const el = _syncEl(); if (!el) return
    el.dataset.state = state
    const msg = state === 'saving' ? 'Enregistrement…'
      : state === 'warn' ? (detail || 'Non synchronisé — réessai auto')
      : state === 'dead' ? 'Session expirée'
      : state === 'offline' ? 'Hors ligne'
      : 'Enregistré'
    const txt = el.querySelector('.is-txt'); if (txt) txt.textContent = msg
    el.title = state === 'warn' ? (msg + ' — clic : réessayer maintenant') : msg
  }

  // ── P1.1 DÉTECTION SESSION MORTE — la session est désormais persistée + auto-rafraîchie (BUG-LOGIN-
  // DOUBLE), mais un refresh token expiré/révoqué finit par échouer → supabase-js émet SIGNED_OUT →
  // bannière (audit C-B : « fini les 401 silencieux »). UNE fois, non fermable autrement qu'en se
  // reconnectant (les modifs ne partent plus au cloud).
  let _deadShown = false
  const _sessionDead = () => {
    if (_deadShown) return
    _deadShown = true
    window.__immoSessionMorte = true   // STOCKAGE lot 3 : saveDB ne promet plus « enregistrée dans le cloud »
    try { window.__immoCrumb && window.__immoCrumb('session-dead') } catch (e) {}
    setSync('dead')
    if (document.getElementById('imsb-dead')) return
    const b = document.createElement('div'); b.id = 'imsb-dead'
    b.setAttribute('role', 'alert')
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;padding:10px 16px;background:#7a1f1f;color:#fff;font:600 13.5px/1.4 sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25)'
    b.innerHTML = '<span>⚠ Session expirée : les modifications ne sont <u>plus enregistrées</u> dans le cloud.</span>'
      + '<button id="imsb-dead-btn" style="border:none;border-radius:9px;padding:8px 16px;background:#fff;color:#7a1f1f;font:700 13px sans-serif;cursor:pointer">Se reconnecter</button>'
    document.body.appendChild(b)
    const btn = b.querySelector('#imsb-dead-btn')
    if (btn) btn.onclick = () => { try { location.reload() } catch (e) {} }
  }

  let _avisChampsReserves = false   // refus « champ réservé » (0064) déjà expliqué dans cette session
  const runFlush = async (fn) => {
    flushTimer = null; setSync('saving')
    try {
      const s = await fn()   // fn = () => sync.flush() ; flush est SÉRIALISÉ côté store-sync (anti-réentrance C2)
      // P1.2 : le résumé porte désormais les échecs PAR ENREGISTREMENT (summary.errors = throws isolés)
      // en plus des conflits/skipped. Le moteur re-programme lui-même un retry backoff (errors/skipped/
      // config) via schedule({retryDelayMs}) ; les conflits attendent le chantier « conflit → re-hydrate ».
      const bad = (s ? ((s.errors && s.errors.length) || 0) + ((s.conflicts && s.conflicts.length) || 0) + ((s.skipped && s.skipped.length) || 0) : 0) + (s && s.config === 'error' ? 1 : 0)
      if (bad) {
        console.warn('[Supabase] sync incomplète (des modifs ne sont PAS dans le cloud)', s)
        // Un token mort se manifeste en erreurs JWT/401 sur chaque appel → bannière re-login, pas une ⚠ générique.
        if (s.errors && s.errors.some(er => /jwt|401|token .*(expired|invalid)|expired.*token/i.test(String(er.message)))) _sessionDead()
        // CHAMPS RÉSERVÉS d'un bailleur (migration 0064) : la base refuse qu'un gestionnaire limité à une SCI partagée en
        // change l'identité, l'IBAN, la signature… L'app ne le propose pas ; si une modification passe quand même, on
        // dit pourquoi (une fois par session) au lieu d'un échec muet.
        if (!_avisChampsReserves && s.errors && s.errors.some(er => /entite:champ-reserve/.test(String(er.message)))) {
          _avisChampsReserves = true
          try { if (typeof window.showToast === 'function') window.showToast('Modification d\'un bailleur non enregistrée : réglé par le propriétaire de la SCI (identité, IBAN, signature, suppression). Recharger pour retrouver la fiche à jour.', 'warn', 9000) } catch (e) {}
        }
        if (!_deadShown) setSync('warn', bad + ' modif' + (bad > 1 ? 's' : '') + ' non synchronisée' + (bad > 1 ? 's' : '') + ' — réessai auto')
      } else if (!_deadShown) setSync('ok')
      // F5 : flush entièrement propre → le réseau est revenu, le plancher de
      // réessai tombe (sinon la modification suivante attendrait le backoff pour rien).
      if (!bad) backoffUntil = 0
      // F1 : horodate le dernier flush RÉUSSI. C'est lui qu'on comparera à la
      // dernière écriture du miroir, au prochain démarrage en ligne.
      // STOCKAGE lot 4 (R1) : miroir PROTÉGÉ (illisible, travail peut-être non remonté) → le dernier
      // envoi réussi n'avance pas : F1 doit encore le relire au prochain démarrage.
      const _Mp = (typeof _miroirLocal !== 'undefined' && _miroirLocal) ? _miroirLocal.miroir() : null
      if (!bad && _offlineBoot && !(_Mp && _Mp.protege())) { try { localStorage.setItem(_offlineBoot.FLUSH_OK_KEY, String(Date.now())) } catch (e) {} }
      // SYNCHRO LIVE (M4, audit v15.460) : signale aux AUTRES appareils dès que le flush a RÉELLEMENT
      // écrit quelque chose (upserts/removes/config) — un poison isolé (P1.2) n'étouffe plus le signal.
      // Repli sans le helper (import raté) : ancienne condition « flush 100 % propre ».
      if (_liveChannel && (_hasCloudWrites ? _hasCloudWrites(s) : !bad)) { try { _liveChannel.send({ type: 'broadcast', event: 'changed', payload: {} }) } catch (e) {} }
      // P0-4 : flush cloud RÉUSSI → enregistre les entrées d'audit restantes dans la table append-only
      // `audit_log` (autorité inviolable). Fire-and-forget : ne bloque pas le retour du flush au caller.
      // !bad → on n'enregistre jamais une entrée dont la sauvegarde data vient d'échouer (rollback amont).
      if (!bad) { _auditCloudFlush() }
      // P1.3 CONFLIT → RE-HYDRATE : le contrat écrit depuis toujours dans store-supabase.js (l.7,161)
      // est enfin honoré. Un conflit de version = notre baseline est PÉRIMÉE (autre appareil / associé) ;
      // retenter à l'identique est une impasse éternelle (audit C-A). On re-hydrate TOUT (serveur gagne),
      // on re-render, et la bannière avertit que la modif locale doit être revérifiée. Fire-and-forget :
      // le résumé est rendu au caller tout de suite, la ré-hydratation suit (gardée _repullBusy).
      // EDL TERRAIN lot 4bis — on RETIENT quelles clés `edl` ont conflicté AVANT
      // de re-hydrater : le résumé du flush est le seul endroit où l'information
      // existe, et la ré-hydratation qui suit efface la baseline (api.seed).
      if (s && s.conflicts && s.conflicts.length) {
        try { _conflitsEdlEnAttente = s.conflicts.filter(c => c && c.coll === 'edl').map(c => c.key) } catch (e) { _conflitsEdlEnAttente = [] }
        _repullCloud({ flushFirst: false, banner: true })
      }
      // Lot B : réglages fusionnés avec ceux d'un autre appareil (config gardée par version) — le DB vivant a
      // reçu le résultat ; la page courante est redessinée. Un même élément modifié des deux côtés garde la
      // version déjà enregistrée : on le dit, sans jargon.
      if (s && (s.config === 'merged' || s.config === 'merged-local')) {
        try { (typeof window.__immoRerenderCurrent === 'function' ? window.__immoRerenderCurrent : window.__immoRender)() } catch (e) { console.warn('[Supabase] re-render post-fusion', e) }
        const nc = (s.configConflits && s.configConflits.length) || 0
        if (nc && typeof window.showToast === 'function') {
          try { window.showToast('Réglage modifié aussi sur un autre appareil : la version déjà enregistrée est gardée (' + nc + ' élément' + (nc > 1 ? 's' : '') + ').', 'warn', 8000) } catch (e) {}
        }
      }
      return s
    } catch (e) {
      console.error('[Supabase] flush', e)
      if (!_deadShown) setSync(navigator.onLine === false ? 'offline' : 'warn', 'Erreur réseau — réessai à la prochaine modif')   // (audit M3) ne pas écraser l'état « session expirée »
    }
  }
  // Scheduler debouncé (800 ms, comme Drive) : saveDB → markDirty → ici → flush cloud (gardé par version).
  // P1.2 : honore les options du moteur — { immediate:true } (suppression en attente → bypass du debounce,
  // le remove part MAINTENANT) et { retryDelayMs } (retry backoff après échec). (Audit M1) un RETRY ne
  // REPOUSSE jamais un timer déjà plus proche : si une modif utilisateur attend son debounce 800 ms
  // pendant qu'un flush échoue, le retry (jusqu'à 60 s) ne doit pas la retarder — le timer court reste,
  // et son flush couvre TOUT le diff (y compris ce que le retry aurait retenté).
  // F5 : `backoffUntil` est le PLANCHER de réessai posé par le moteur après un
  // échec. Une modification locale fraîche est toujours honorée — mais jamais
  // AVANT ce plancher : le flush qui partira couvre tout le diff, elle comprise.
  // La décision est dans js/core/sync-schedule.js (fonction pure, testée).
  let flushDueAt = 0
  let backoffUntil = 0
  const schedule = (fn, opts) => {
    _lastFlushFn = fn
    const now = Date.now()
    const p = planFlush({
      now,
      // `delayMs` = flush PROGRAMMÉ plus tard, sans échec (ex. fin d'attente d'archive d'un bail signé) :
      // ce n'est PAS un réessai → aucun plancher de backoff posé (sinon les modifications fraîches de
      // l'utilisateur attendraient jusqu'à 15 min, audit N1 du 28/09).
      delay: (opts && (opts.retryDelayMs || opts.delayMs)) || FLUSH_DEBOUNCE_MS,
      isRetry: !!(opts && opts.retryDelayMs),
      immediate: !!(opts && opts.immediate),
      hasTimer: !!flushTimer,
      flushDueAt,
      backoffUntil,
    })
    backoffUntil = p.backoffUntil
    if (p.action === 'keep') return
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    if (p.action === 'run-now') { runFlush(fn); return }
    flushDueAt = p.at
    flushTimer = setTimeout(() => runFlush(fn), Math.max(0, p.at - Date.now()))
  }
  // ── P1.3 RE-PULL — la boucle de sync se FERME enfin (audit C-A : pull uniquement au login) ──────
  // Trois déclencheurs, une seule routine : (1) conflit de version (runFlush) ; (2) broadcast Realtime
  // `changed` d'un autre appareil (récepteur rebranché plus bas — l'émission n'avait PLUS de récepteur
  // depuis le cutover) ; (3) retour de visibilité si l'hydratation date de > 5 min (téléphone figé à J-3).
  const REPULL_STALE_MS = 5 * 60 * 1000
  let _lastHydrateAt = 0     // posé au login (hydratation initiale) puis à chaque re-pull réussi
  let _repullBusy = false    // anti-réentrance : conflits en cascade pendant une ré-hydratation = 1 seul pull
  let _repullTimer = null    // coalescence des `changed` rapprochés + report tant qu'une modale est ouverte
  let _dirtySeq = 0          // (audit I-1) compteur de mutations locales (incrémenté par __immoMarkDirty) —
  //   permet de détecter une saisie survenue PENDANT l'attente réseau d'un re-pull de confort et
  //   d'abandonner ce pull (sinon le snapshot serveur, antérieur à la saisie, l'écraserait en silence).
  let _pendingConflictBanner = false   // (audit I-2) un conflit signalé pendant qu'un pull tourne ne doit
  //   pas perdre sa bannière « revérifie ta modif » : elle est consommée à la fin du pull en cours.
  // Bannière « revérifie ta modif » (chemin conflit) : l'utilisateur DOIT savoir que sa modification
  // locale a été remplacée par l'état serveur (jamais de LWW silencieux). Fermable, auto-retirée à 15 s.
  const _showRefreshBanner = (msg) => {
    let b = document.getElementById('imsb-refresh')
    if (b) b.remove()
    b = document.createElement('div'); b.id = 'imsb-refresh'
    b.setAttribute('role', 'alert')
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147482900;display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;padding:10px 16px;background:#9a5b00;color:#fff;font:600 13.5px/1.4 sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25)'
    b.innerHTML = '<span>🔄 ' + msg + '</span>'
      + '<button id="imsb-refresh-x" style="border:none;border-radius:9px;padding:7px 14px;background:#fff;color:#9a5b00;font:700 13px sans-serif;cursor:pointer">OK</button>'
    document.body.appendChild(b)
    const x = b.querySelector('#imsb-refresh-x')
    if (x) x.onclick = () => { try { b.remove() } catch (e) {} }
    setTimeout(() => { try { b.remove() } catch (e) {} }, 15000)
  }
  // Ré-hydratation COMPLÈTE (pas par-table : volume faible, zéro état intermédiaire) + re-seed + re-render
  // de la page COURANTE (__immoRerenderCurrent — __immoRender renverrait à l'Accueil). Sémantique P1 :
  // le serveur gagne ; la résolution fine par ligne est P2.6.
  async function _repullCloud(opts) {
    const o = opts || {}
    if (_repullBusy || !liveDB) {                         // déjà en cours / pas encore hydraté
      if (o.banner) _pendingConflictBanner = true         // (I-2) conflit pendant un pull → bannière due à sa fin
      else if (liveDB) _repullSoon()                      // (M-a) signal reçu pendant un pull → re-programmé
      return
    }
    _repullBusy = true
    try {
      // Pousser d'abord le debounce en attente : sans ça, la ré-hydratation écraserait une modif locale
      // pas encore partie. Chemin CONFLIT (flushFirst:false) : on SORT d'un flush, re-flusher ne ferait
      // que reproduire le conflit — on hydrate directement.
      if (o.flushFirst !== false && flushTimer && _lastFlushFn) { clearTimeout(flushTimer); flushTimer = null; await runFlush(_lastFlushFn) }
      const seq0 = _dirtySeq
      const db = await api.hydrate()
      // (I-2) la bannière conflit due (posée pendant CE pull, par un runFlush concurrent) est consommée ici.
      const wantBanner = !!o.banner || _pendingConflictBanner
      // (I-1) une mutation locale est survenue PENDANT l'attente réseau : ce snapshot serveur lui est
      // ANTÉRIEUR — l'injecter l'écraserait en silence. Re-pull de CONFORT → on jette ce snapshot et on
      // re-programme (la modif sera flushée d'abord). Chemin CONFLIT → on continue (le serveur gagne,
      // c'est le contrat annoncé par la bannière — abandonner laisserait le conflit sans résolution).
      if (!wantBanner && _dirtySeq !== seq0) { _repullSoon(); return }
      // ── EDL TERRAIN lot 4bis — LES DEUX VERSIONS VIVENT (invariant 29) ────
      // C'est ICI que la saisie locale était écrasée : `__immoSetDB(db)` juste
      // en dessous remplace tout le DB par le snapshot serveur. Défendable pour
      // une modification de 30 secondes sur un loyer ; pour une heure de terrain
      // (110 éléments, 77 photos), non. On ne change RIEN pour les autres
      // collections (invariant 33) : le serveur gagne, à l'identique. Seuls les
      // `edl` en conflit voient leur version locale survivre à côté, nommée et
      // datée. Aucune fusion n'est tentée (invariant 32).
      let _conserves = []
      // ⚠️ L'INSTANTANÉ SERVEUR, gardé AVANT toute conservation. Même contrat que
      // la remontée F1, et pour la même raison : la baseline doit être semée
      // depuis ce que le SERVEUR a, jamais depuis ce qu'on vient d'y ajouter.
      let _edlServeur = null
      try {
        const conflitsEdl = (_conflitsEdlEnAttente || []).filter(Boolean)
        if (conflitsEdl.length && _edlConflit && _recordKey && liveDB && typeof window.__immoNouvelId === 'function') {
          const r = _edlConflit.conserverLesDeuxVersions({
            dbCloud: db,
            edlsLocaux: Array.isArray(liveDB.edl) ? liveDB.edl : [],
            clesEnConflit: conflitsEdl,
            cleDe: rec => _recordKey('edl', rec),
            nouvelId: () => window.__immoNouvelId(),
          })
          if (r.conserves.length) {
            _edlServeur = Array.isArray(db.edl) ? db.edl.slice() : []
            Object.assign(db, { edl: r.db.edl })
            _conserves = r.conserves
          }
        }
      } catch (e) { console.warn('[Supabase] conservation des versions EDL', e) }
      if (typeof window.__immoSetDB !== 'function' || window.__immoSetDB(db) === false) return
      _pendingConflictBanner = false
      liveDB = db
      _liveDBRef = db
      // ⚠️ BASELINE = LE SERVEUR, pas la mémoire. `db` porte désormais les versions
      // conservées ; les semer les déclarerait « déjà synchronisées », le diff du
      // flush suivant serait VIDE pour elles, et le prochain re-pull — un
      // rechargement suffit — les effacerait. La bannière aurait promis « ta
      // saisie n'a PAS été écrasée » quelques minutes avant qu'elle disparaisse.
      // C'est le défaut corrigé sur F1, qui vivait aussi ici.
      api.seed(_edlServeur ? Object.assign({}, db, { edl: _edlServeur }) : db)
      // …et on marque sale pour que l'envoi parte, sans attendre une saisie.
      if (_conserves.length) { try { api.markDirty(); _dirtySeq++ } catch (e) {} }
      _lastHydrateAt = Date.now()
      try { (typeof window.__immoRerenderCurrent === 'function' ? window.__immoRerenderCurrent : window.__immoRender)() } catch (e) { console.warn('[Supabase] re-render post-pull', e) }
      if (!_deadShown) setSync('ok')
      // Le message DIT ce qui vient de se passer. « Revérifie ta modif » était
      // le message d'un écrasement ; quand la version locale a été conservée,
      // c'est le contraire qu'il faut annoncer (lot 4bis).
      if (_conserves.length) _showRefreshBanner(_edlConflit.messageVersionsConservees(_conserves))
      else if (wantBanner) _showRefreshBanner('Données actualisées — modification à revérifier : une modification concurrente a été conservée à sa place.')
      else if (typeof window.showToast === 'function') { try { window.showToast('🔄 Données actualisées', 'ok', 3500) } catch (e) {} }
    } catch (e) {
      console.warn('[Supabase] re-hydratation échouée (retentée au prochain signal)', e)
    } finally {
      _repullBusy = false
      // Les clés conflictées sont consommées ICI, pas dans le corps : une sortie
      // anticipée (_repullBusy, saisie concurrente) ou un hydrate qui rejette
      // les laissait vivre et les faisait appliquer à un re-pull ultérieur, sans
      // rapport avec le conflit qui les avait produites.
      _conflitsEdlEnAttente = []
    }
  }
  // Re-pull de CONFORT (realtime / visibilité) : coalescé (1,2 s) et JAMAIS pendant une saisie — tant
  // qu'une modale .ov est ouverte, on re-vérifie toutes les 5 s (le flush de la modale partira d'abord,
  // et un conflit éventuel prendra le chemin immédiat). Le chemin CONFLIT, lui, n'attend pas.
  const _repullSoon = () => {
    if (_repullTimer) return
    const tick = () => {
      _repullTimer = null
      if (document.querySelector('.ov:not(.hidden)')) { _repullTimer = setTimeout(tick, 5000); return }
      _repullCloud({ flushFirst: true })
    }
    _repullTimer = setTimeout(tick, 1200)
  }
  // P1.1 — le réseau qui tombe/revient : pastille honnête + reprise immédiate au retour du réseau.
  addEventListener('offline', () => { if (!_deadShown) setSync('offline') })
  addEventListener('online', () => { if (_deadShown) return; if (_lastFlushFn) runFlush(_lastFlushFn); else setSync('ok') })
  // C1 : à la fermeture/masquage de l'onglet, flush IMMÉDIAT du debounce en attente — sinon la modif est
  // perdue (en mode cloud, le filet localStorage de beforeunload n'existe plus). visibilitychange:hidden +
  // pagehide = plus fiables que beforeunload pour l'async. Best-effort (réseau coupé sur close dur possible).
  // P1.3 : au RETOUR de visibilité, si l'hydratation date (> 5 min), re-pull — tue la vue figée
  // multi-appareils (le téléphone rouvert après 3 jours re-voit enfin l'état réel).
  const flushPendingNow = () => { if (flushTimer && _lastFlushFn) { clearTimeout(flushTimer); runFlush(_lastFlushFn) } }
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingNow()
    else if (document.visibilityState === 'visible' && liveDB && _lastHydrateAt && (Date.now() - _lastHydrateAt) > REPULL_STALE_MS) _repullSoon()
  })
  addEventListener('pagehide', flushPendingNow)
  // P1.1 — session expirée/révoquée pendant la vie de l'onglet : supabase-js émet SIGNED_OUT quand le
  // refresh du token échoue (autoRefreshToken:true, session persistée) → bannière re-login. Abonné UNE
  // SEULE fois pour la vie de la page (contrat onAuthChange). Un logout VOLONTAIRE (menu Compte) pose
  // window.__immoLoggingOut → pas de bannière pendant le signOut → reload ramène au login proprement.
  try {
    api.onAuthChange((session, evt) => {
      if (window.__immoLoggingOut) return
      // EDL TERRAIN lot 4, F4 (invariant 19i). Le verdict est pris par le module
      // testé js/core/offline-boot.js — ce chemin a déjà mordu deux fois en prod
      // (BUG-AUTH-BOUNCE v15.457, BUG-LOGIN-DOUBLE v15.470), il ne porte plus de
      // condition écrite à la main. Sans le module (import raté) : comportement
      // d'AVANT le lot, à l'identique.
      if (!_offlineBoot) { if (evt === 'SIGNED_OUT' || !session) _sessionDead(); return }
      const enLigne = !(typeof navigator !== 'undefined' && navigator.onLine === false)
      const v = _offlineBoot.verdictAuthChange({ evt, session, enLigne })
      // Convention du fichier (audit M3) : on n'écrase JAMAIS l'état « session
      // morte » — sinon la pastille dirait « hors ligne » pendant que la bannière
      // rouge « ta session a expiré » est toujours à l'écran.
      if (v === 'hors-ligne') { if (!_deadShown) setSync('offline'); return }
      if (v === 'morte') _sessionDead()
    })
  } catch (e) { console.warn('[Supabase] onAuthChange', e) }
  try {
    const _espaces = await api.resolveEspaces()
    _perfMark('espaces')
    esp = _espaces.find(e => e.mine) || _espaces[0]   // espace PROPRE = primaire (Storage/Realtime/affichage + __immoCloudInfo)
    _cloudEspaceId = esp.espaceId   // espace propre : chemins Storage par défaut (entités neuves) + canal Realtime
    _cloudEspaceMine = !!esp.mine   // faux pour un associé invité (repli sur l'espace du propriétaire)
    _cloudOwnerId = esp.ownerId     // namespace detUuid par défaut → window.__immoEntiteUuid (entités neuves)
    _espaceOwners = {}; _espaces.forEach(e => { _espaceOwners[e.espaceId] = e.ownerId })   // résolution par-SCI (Storage/uuid)
    _espacesListe = _espaces   // droit d'écriture par SCI (window.__immoPeutEcrireSci)
    // P1.3 volet RGPD — le miroir résiduel appartient-il à CE user/espace ? (tag posé au login précédent).
    // Tout sauf 'same' → miroir purgé (le cloud est la source, il est re-basé juste après l'hydratation).
    // 'other-user' (prouvé par le tag) → IndexedDB photos purgée aussi : ce sont les binaires d'AUTRUI —
    // la RGPD prime. 'untagged'/'other-espace' : IndexedDB ÉPARGNÉE (peut contenir les seuls exemplaires
    // de preuves du même user, cf. matrice §3b du design 2026-07-13). Best-effort, jamais bloquant.
    // STOCKAGE lot 1 (audit, point 3) : la séquence vit dans une FONCTION NOMMÉE au niveau du module
    // (`_purgerCacheAuLogin`, définie plus haut dans ce fichier) pour être EXÉCUTÉE par un test — même
    // raison que F1. Appel SYNCHRONE : son retour est le verdict de l'ANCIEN tag, retenu ici pour F1
    // (EDL TERRAIN lot 4). ORDRE CONTRACTUEL (F14.1) : purge des photos d'autrui TERMINÉE, puis
    // seulement le nouveau tag — un processus tué pendant la suppression laisse l'ancien tag, et la
    // purge est rejouée au login suivant.
    try {
      _tagMiroirAvantLogin = _purgerCacheAuLogin({ user, esp })
      if (_tagMiroirAvantLogin === 'other-user') await _deletePhotosDb()
      // STOCKAGE lot 2 (S-7) : les copies de la base en IndexedDB (filets, base illisible) d'un autre
      // propriétaire ne survivent pas non plus — TERMINÉ avant la pose du nouveau tag (ordre F14.1).
      if (_tagMiroirAvantLogin !== 'same') await _purgerFiletsLocaux('changement de propriétaire du miroir')
      // STOCKAGE lot 4 : l'effacement du miroir IndexedDB de l'ancien propriétaire (mis en file par
      // `_purgerCacheAuLogin`) est TERMINÉ avant la pose du nouveau tag — même ordre F14.1 que les photos.
      if (_tagMiroirAvantLogin !== 'same' && typeof _miroirLocal !== 'undefined' && _miroirLocal) await _miroirLocal.miroir().attendre()
      _ecrireTagEtEspacesLogin({ user, esp })
    } catch (e) { console.warn('[Supabase] purge cache au login', e) }
    api.wireStores({ espaces: _espaces, getDB: () => liveDB, schedule })   // MULTI-ESPACE : 1 store/espace agrégé (N=1 = mono)
    // SYNCHRO LIVE — canal Realtime PRIVÉ de l'espace (policies P0-D). Un autre appareil qui modifie des
    // données émet « changed » → on affiche une bannière « Actualiser » (rechargement MANUEL = zéro risque
    // d'écraser une modif locale en cours). self:false → on ne reçoit pas ses propres broadcasts.
    try {
      const _syncPresence = (meUid) => {
        const list = []
        try {
          const state = (_liveChannel && _liveChannel.presenceState) ? _liveChannel.presenceState() : {}
          for (const key of Object.keys(state || {})) {
            const meta = (state[key] && state[key][0]) || {}
            list.push({ name: meta.name || 'Membre', isOwner: !!meta.isOwner, isMe: key === meUid })
          }
        } catch (e) {}
        list.sort((a, b) => (b.isOwner - a.isOwner) || (b.isMe - a.isMe))
        window.__immoPresence = list
        try { if (typeof window.__immoRenderPresence === 'function') window.__immoRenderPresence() } catch (e) {}
      }
      _liveChannel = _supaClient.channel('espace:' + esp.espaceId, { config: { private: true, broadcast: { self: false }, presence: { key: user.id } } })
        // P1.3 RÉCEPTEUR REBRANCHÉ (audit C-A : l'émission `changed` n'avait PLUS de récepteur depuis le
        // cutover → vue figée multi-appareils). Un autre appareil qui vient de flusher → re-pull coalescé
        // (jamais pendant une saisie, cf. _repullSoon). self:false → on ne reçoit pas ses propres émissions.
        .on('broadcast', { event: 'changed' }, () => { try { _repullSoon() } catch (e) {} })
        .on('presence', { event: 'sync' }, () => { try { _syncPresence(user.id) } catch (e) {} })
        .subscribe(async (st) => {
          // CO-PRÉSENCE : on s'annonce dès la souscription (nom d'affichage + owner). Les autres reçoivent
          // un événement presence:sync → la pastille topbar se met à jour. Espace-level (v1).
          if (st === 'SUBSCRIBED') {
            try { await _liveChannel.track({ name: _displayNameFromUser(user), isOwner: !!(esp && esp.ownerId && user.id === esp.ownerId) }) } catch (e) {}
          }
          if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') console.warn('[Supabase] realtime', st)
        })
    } catch (e) { console.warn('[Supabase] realtime subscribe', e) }
    let db = await api.hydrate()
    _perfMark('donnees')
    // ── EDL TERRAIN lot 4, faille F1 (invariant 19f) ────────────────────────
    // Le miroir localStorage est en ÉCRITURE SEULE en mode cloud : personne ne
    // le relit jamais. Séquence vécue : EDL saisi hors ligne → l'app est fermée
    // → retour à la maison AVEC réseau → hydratation → le DB cloud remplace la
    // mémoire. L'EDL hors ligne n'a jamais existé.
    //
    // On ne « charge pas le miroir puis on flushe » : le moteur diffe la
    // baseline contre le DB vivant, donc tout ce qui est au cloud et absent du
    // miroir partirait en SUPPRESSION — on effacerait le travail d'un autre
    // appareil ou d'un associé. On part du cloud et on n'y REVERSE que les
    // états des lieux du miroir absents ou plus récents (js/core/offline-boot.js,
    // testé), puis on pousse. Aucune suppression n'est dérivée du miroir.
    // EDL TERRAIN lot 4 (F1) — la remontée vit dans une FONCTION NOMMÉE, au niveau
    // du module, et non plus en ligne au milieu de `onLoggedIn`. Raison : cette
    // séquence (baseline = serveur, vivant = fusionné, ENVOI, puis seulement
    // ré-hydratation) est un ORDRE D'EXÉCUTION dont deux inversions ont détruit
    // du travail réel. Inline, elle n'était atteignable par aucun test ; nommée,
    // elle s'exécute dans __tests__/helpers/offline-cablage.test.js.
    const _f1 = await _remonterTravailHorsLigne({
      api, db, setSync,
      tagMiroir: _tagMiroirAvantLogin,
      espacesAutorises: _espaceOwners,
    })
    db = _f1.db
    const _dbServeurF1 = _f1.dbServeur
    // Si on tourne DANS l'app complète (points d'injection exposés par index.html) → injecter le DB
    // cloud EN MÉMOIRE + re-render + brancher la SAUVEGARDE cloud (2c). Sinon (page de test dédiée
    // index-supabase.html) → écran de compteurs + bouton.
    if (typeof window.__immoSetDB === 'function' && typeof window.__immoRender === 'function') {
      window.__immoSupabaseMode = true            // saveDB/beforeunload/storage ne toucheront pas localStorage
      if (window.__immoSetDB(db) === false) { renderProof(overlay, api, user, esp, db); return }   // DB invalide → fallback
      // P0-4 : ETL + rattrapage — au login, backfille dans audit_log les entrées locales non encore
      // enregistrées (historiques d'avant la feature + accumulées hors-ligne). Fire-and-forget, idempotent.
      try { _auditCloudFlush() } catch (e) {}
      liveDB = db                                 // le sync lit CE DB (l'app le mute EN PLACE → diff = vraies modifs)
      _liveDBRef = db                             // réf pour résoudre l'espace/owner d'une SCI (Storage + uuid par-SCI)
      // ⚠️ Après une remontée F1, la baseline se re-sème depuis l'instantané
      // SERVEUR, pas depuis `db` — corrigé après audit. `db` contient désormais
      // le travail hors ligne : re-semer depuis lui le déclarait « déjà
      // synchronisé » et supprimait le filet du moteur (qui, lui, n'avance sa
      // baseline que sur succès). Un EDL jamais parti disparaissait alors à la
      // ré-hydratation suivante. Re-semer depuis le serveur peut provoquer un
      // upsert en trop : c'est idempotent, et c'est le sens fail-safe.
      api.seed(_dbServeurF1 || db)                // baseline = état hydraté (aucun diff au départ)
      _lastHydrateAt = Date.now()                 // P1.3 : référence de fraîcheur pour le re-pull visibilité
      // P1.3 volet RGPD : le miroir est RE-BASÉ immédiatement sur la vue AUTORISÉE courante (RLS) — l'ancien
      // contenu (potentiellement un périmètre révoqué depuis) ne survit jamais à un login, même sans saveDB.
      // STOCKAGE lot 3 (contre-audit I4) : un rebase raté n'est plus avalé — la carte « Stockage de cet
      // appareil » le dit (sans message : aucune modification de l'utilisateur n'est en jeu ici).
      try { if (_ecrireMiroir(db) === false && typeof window.__immoMiroirPasAJour === 'function') window.__immoMiroirPasAJour({ silencieux: true }) } catch (e) {}   // STOCKAGE lot 1 (éviction sur quota) + lot 4 (IndexedDB)
      window.__immoMarkDirty = () => { _dirtySeq++; api.markDirty() }   // 2c : le garde saveDB l'appelle → debounce → flush cloud (+_dirtySeq : détection de saisie pendant un re-pull, audit I-1)
      // RESTAURATION LOCALE : flush COMPLET synchrone + awaitable (renvoie le résumé {upserts,removes,conflicts,skipped}).
      // Utilisé par _backupRestoreRun (index.html) : après avoir muté DB EN PLACE = instantané, on pousse tout vers
      // Supabase et on ATTEND (le moteur diffe instantané-vs-cloud → upserts version-guardés + removes des extras +
      // saute les baux `locked`). Contrairement à markDirty (debouncé fire-and-forget), on a besoin du résultat.
      window.__immoFlush = () => api.flush()
      // 2.2 : panneau Mode cloud des Réglages. isOwner/displayName (#2) : un invité scopé ne doit pas
      // hériter du nom du PROPRIÉTAIRE (DB.params est partagé par-espace) → _appUserName lit son identité.
      window.__immoCloudInfo = {
        email: user && user.email,
        espaceNom: esp && esp.espaceNom,
        isOwner: !!(user && esp && esp.ownerId && user.id === esp.ownerId),
        displayName: _displayNameFromUser(user),
      }
      // RESET-CLOUD UX — « ⚠️ Vider mon espace cloud » (Réglages). La GARDE est côté serveur
      // (RPC purge_mon_espace, migration 0041 : owner actif + nom exact re-vérifiés en SECURITY
      // DEFINER) ; ici on ne fait qu'appeler avec l'espace PROPRE et déposer la session en cas de
      // succès SANS flush (l'espace n'existe plus). Au prochain login : resolveEspaces() recrée un
      // espace vierge et les défauts v15.461 s'appliquent. Renvoie { error } (jamais de throw).
      window.__immoPurgeEspace = async (confirmNom) => {
        try {
          // Audit #3 : annule le flush débouncé en vol — inutile qu'il tire pendant/après la purge
          // (les FK vers l'espace supprimé le feraient échouer ligne à ligne : bruit console).
          if (flushTimer) { try { clearTimeout(flushTimer) } catch (e) {} flushTimer = null }
          const { error } = await _supaClient.rpc('purge_mon_espace', { p_espace_id: esp.espaceId, p_confirm_nom: confirmNom })
          if (error) return { error }
          // Pas de flush (plus de destination) ; photos IDB conservées (seule copie restante, audit #1).
          await _teardownSession({ flush: false, keepPhotos: true })
          return { ok: true }
        } catch (e) { return { error: e } }
      }
      window.__immoRender()
      setSync('ok')      // P1.1 : pastille visible dès le dévoilement (état initial = hydraté ≙ enregistré)
      _liftDriveGate()   // revele l'app cloud (leve le gate Drive reste leve apres le boot legacy)
      try { localStorage.removeItem('immo_fullapp_once') } catch (e) {}   // consomme l'opt-in one-shot (M1)
      try { window.__immoCrumb && window.__immoCrumb('accueil-revealed') } catch (e) {}   // login abouti : Accueil affiché
      overlay.remove()                            // dévoile l'app complète sur les données cloud
      _perfMark('app')
      _prechargerLibsPdf()
      _docExpressApresConnexion()
      _espaceLocataireApresConnexion()
      return
    }
    renderProof(overlay, api, user, esp, db)
  } catch (e) {
    // Compte LOCATAIRE seul (migration 0065) : la base refuse de lui créer un espace propriétaire — message clair.
    renderProof(overlay, api, user, esp || {}, null, /el:compte-locataire/.test(String(e && e.message)) ? MSG_COMPTE_LOCATAIRE : e.message)
  }
}
const MSG_COMPTE_LOCATAIRE = 'Ce compte est un compte locataire : il ouvre l’espace locataire (lien reçu du propriétaire, puis connexion par code), pas l’application du propriétaire.'

// ── UI ───────────────────────────────────────────────────────────────────────
function renderProof(overlay, api, user, esp, db, err) {
  overlay.classList.add('imv-auth-open')
  const left = overlay.querySelector('#imsb-left')
  if (err) {
    left.innerHTML = `${brand()}<div class="imsb-mid"><div class="imsb-err">${err === MSG_COMPTE_LOCATAIRE ? escapeHtml(err) : '⚠ Hydratation : ' + escapeHtml(err)}</div>
      <button class="imsb-btn imsb-ghost" id="imsb-logout">Se déconnecter</button></div>`
  } else {
    const rows = COUNTS.map(([k, lbl]) => `<tr><td>${escapeHtml(lbl)}</td><td class="imsb-num">${sizeOf(db[k])}</td></tr>`).join('')
    left.innerHTML = `${brand()}
      <div class="imsb-mid">
        <div class="imsb-ok">✓ Connecté · données chargées depuis Supabase</div>
        <p class="imsb-lead"><b>${escapeHtml(user.email)}</b> — espace « ${escapeHtml(esp.espaceNom || '?')} »</p>
        <table class="imsb-tbl">${rows}</table>
        <button class="imsb-btn imsb-primary" id="imsb-openapp">📂 Voir dans l'app complète →</button>
        <p class="imsb-note" id="imsb-note">Les données cloud sont prêtes. Ouvrir l'app complète (tableau de bord, fiches, listes…).</p>
        <button class="imsb-btn imsb-ghost" id="imsb-logout">Se déconnecter</button>
      </div>`
  }
  const oa = overlay.querySelector('#imsb-openapp')
  if (oa) oa.onclick = () => {
    // Pas d'écriture des données dans le cache (quota du localStorage github.io partagé). On pose juste
    // un opt-in (consommé UNIQUEMENT en sandbox) puis on ouvre l'app : elle charge le cloud EN MÉMOIRE.
    try { localStorage.setItem('immo_fullapp_once', '1') } catch (e) {}
    location.href = 'index.html?sandbox=1'
  }
  const lo = overlay.querySelector('#imsb-logout')
  // EDL TERRAIN lot 4, F2 — le refus était avalé : on rechargeait la page en
  // laissant croire à une déconnexion qui n'avait pas eu lieu.
  if (lo) lo.onclick = async () => {
    let r = null
    try { r = await api.logout() } catch (e) { r = { ok: false, raison: 'flush-impossible', enAttente: 1 } }
    if (r && r.ok === false) {
      if (!(await _accepteDePerdre(r))) return
      try { await api.logout({ forcer: true }) } catch (e) {}
    }
    location.reload()
  }
}

// Perf — les libs PDF (~3,4 Mo, js/vendor/pdf-libs.b64.js) ne sont plus inlinées : on les charge en tâche de fond
// dès que l'app est affichée, pour qu'elles soient prêtes (et en cache SW, donc dispo hors ligne) avant le premier
// export PDF / aperçu de bail (qui ouvre une popup : il doit rester dans le geste de l'utilisateur).
// Chronométrage du démarrage (lecture seule, aucun effet) : marques performance.mark, résumé dans la console
// à l'affichage de l'app → `[perf] …` (ms depuis le début du chargement de la page). Aide au diagnostic.
function _perfMark(nom) {
  try {
    performance.mark('immo:' + nom)
    if (nom !== 'app') return
    const t = n => { const ms = performance.getEntriesByName('immo:' + n, 'mark'); const m = ms[ms.length - 1]; return m ? Math.round(m.startTime) : '?' }
    const nav = performance.getEntriesByType('navigation')[0]
    console.info('[perf] page prête ' + (nav ? Math.round(nav.domContentLoadedEventEnd) : '?') + ' ms · modules ' + t('imports') + ' / miroir ' + t('miroir') + ' / session ' + t('session') + ' · espaces ' + t('espaces') + ' · données ' + t('donnees') + ' · app affichée ' + t('app') + ' ms')
  } catch (e) {}
}

// Document express venu de propryo.fr : généré et téléchargé une fois l'app affichée (jamais bloquant).
// ESPACE LOCATAIRE (0059) : bloc de la fiche, publication des documents, import des signalements — chargé après l'app.
function _espaceLocataireApresConnexion() {
  try { setTimeout(() => { import('./espace-locataire-app.js').then(m => m.demarrer()).catch(e => console.warn('[espace-locataire]', e)) }, 1500) } catch (e) {}
}

function _docExpressApresConnexion() {
  try {
    setTimeout(() => { import('./doc-express.js').then(m => m.consommerDocExpress()).catch(() => {}) }, 800)
  } catch (e) {}
}

function _prechargerLibsPdf() {
  try {
    const go = () => { try { window.ensurePdfLibs && window.ensurePdfLibs().catch(() => {}) } catch (e) {} }
    ;(window.requestIdleCallback || (f => setTimeout(f, 2500)))(go, { timeout: 8000 })
  } catch (e) {}
}

function renderLoading(overlay, user) {
  overlay.classList.add('imv-auth-open')
  overlay.querySelector('#imsb-left').innerHTML = `${brand()}<div class="imsb-mid">
    <div class="imsb-spin"></div><p class="imsb-lead">Chargement des données…</p></div>`
}

function brand() {
  // Logo validé (SVG vectorisé, brand-assets/) : deux variantes togglées par .mode-sombre —
  // mot encre sur clair, mot blanc sur sombre. La marque (carré+point) reste corail dans les deux.
  return `<div class="imsb-brand">
    <img class="imsb-logo imsb-logo-l" src="brand-assets/propryo-logo-light.svg" alt="Propryo">
    <img class="imsb-logo imsb-logo-d" src="brand-assets/propryo-logo-dark.svg" alt="Propryo">
  </div>`
}

// Bandeau bleu RETIRÉ (cutover) : `_showUpdateBanner` (« un autre appareil a modifié → Actualiser ») et
// `injectSyncBanner` (bandeau permanent « Mode cloud »/« Revenir en mode local ») supprimés. `setSync`
// pilote la PASTILLE topbar #imsb-sync (P1.1) ; depuis P1.3, le broadcast `changed` a de nouveau un
// RÉCEPTEUR (re-pull automatique coalescé, cf. _repullSoon) — plus de rechargement manuel demandé.

// Le SVG « check » réutilisé dans les listes des piliers.
function _imsbCheck() {
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 13 4 4L19 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

// Case « Rester connecté sur cet appareil » : cochée si l'utilisateur l'avait choisie (mémorisé), masquée dans
// l'application installée (session toujours persistante, usage terrain hors ligne). Sans effet si le stockage manque.
// Après une tentative de connexion (réussie ou non) : le choix du clic « rester connecté » a fait son œuvre à la
// 1re écriture du jeton ; en cas d'ÉCHEC il ne doit pas rester armé pour une écriture ultérieure sans rapport.
function _annulerChoixAuth() { try { if (_authStorage) _authStorage.annulerChoix() } catch (e) {} }
// Séquence « création de compte PUIS connexion » : _annulerChoixAuth() a désarmé le choix après l'étape 1 ; on le
// RÉ-ARME (même valeur que le clic) avant l'étape 2, sinon le jeton écrit par la connexion suivrait un jeton étranger
// resté dans l'autre stockage (3e audit).
function _rearmerChoixAuth() { try { if (_authStorage) _authStorage.setPersist(_authStorage.isPersistent()) } catch (e) {} }

function _initRemember(ov) {
  try {
    const row = ov.querySelector('.imsb-remember'), box = ov.querySelector('#imsb-remember')
    if (!row || !box || !_authStorage) return
    if (_authStorage.isStandalone()) { row.style.display = 'none'; return }
    box.checked = false   // JAMAIS pré-cochée : rien n'est hérité de la personne précédente (poste partagé)
  } catch (e) {}
}

function injectOverlay() {
  // Perf étape 3a — l'écran de connexion est du HTML STATIQUE dans index.html (<div id="imsb-overlay">), peint
  // avant les ~4 Mo de scripts de l'app. On l'ADOPTE (ce que l'utilisateur a déjà tapé est conservé) ; la
  // structure n'est plus dupliquée ici. Structure : #imsb-overlay > .imsb-page > header.imv-nav
  // + main.imv-login(#imsb-authwrap > #imsb-left) + footer.imv-footer.
  // ⚠️ #imsb-left contient le formulaire #imsb-form (#imsb-email/#imsb-pass/#imsb-submit/#imsb-error/#imsb-forgot) :
  //   renderLoading() et acceptInviteFlow() font `overlay.querySelector('#imsb-left').innerHTML = …`.
  const ov = document.getElementById('imsb-overlay')
  if (!ov) throw new Error("[ImmoSupabase] #imsb-overlay absent d'index.html (écran de connexion statique)")
  // Thème mémorisé (défaut clair) — déjà appliqué par le script inline d'index.html ; idempotent.
  let theme = 'clair'
  try { const t = localStorage.getItem('immo_theme'); if (t === 'sombre' || t === 'clair') theme = t } catch (e) {}
  if (theme === 'sombre') ov.classList.add('mode-sombre')
  _initRemember(ov)

  // v15.422 BUG-LOGIN-PREMIERE-CONNEXION — GARDE ANTI-SUBMIT-NATIF. Le formulaire est visible
  // AVANT que wireLoginForm ait câblé le vrai onsubmit : boot() attend l'import CDN de
  // supabase-js (plusieurs secondes au 1er chargement à froid). Sans garde, « Se connecter »
  // (ou Entrée) déclenchait la soumission NATIVE du <form> → rechargement de la page → les
  // identifiants tapés disparaissaient (« la première connexion échoue »). Ici : on neutralise
  // le submit, on mémorise l'intention (_pendingSubmit) et on passe le bouton en attente ;
  // wireLoginForm REJOUE la demande dès qu'il est prêt (l'utilisateur n'a rien à refaire).
  if (ov._pendingSubmit === undefined) {   // repli : le script inline d'index.html n'a pas tourné
    ov._pendingSubmit = false
    const _earlyForm = ov.querySelector('#imsb-form')
    if (_earlyForm) _earlyForm.onsubmit = (e) => {
      e.preventDefault()
      ov._pendingSubmit = true
      const btn = ov.querySelector('#imsb-submit')
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="imsb-spin imsb-spin-sm"></span> Chargement…' }
    }
  }

  // Toggle thème Clair/Sombre — bascule .mode-sombre sur #imsb-overlay, persisté (immo_theme).
  const toggle = ov.querySelector('#imsb-theme')
  if (toggle) toggle.onclick = () => {
    const dark = ov.classList.toggle('mode-sombre')
    try { localStorage.setItem('immo_theme', dark ? 'sombre' : 'clair') } catch (e) {}
  }

  // Le lien « Créer un compte » (#imsb-signup) est câblé par wireLoginForm (bascule Connexion↔Inscription),
  // qui seul dispose de `api` pour appeler signUpEmail. Inscription gardée côté serveur par le hook allowlist.

  return ov
}

function setBusy(overlay, busy) {
  const btn = overlay.querySelector('#imsb-submit')
  if (!btn) return
  btn.disabled = busy
  const su = overlay._authMode === 'signup'
  btn.innerHTML = busy ? '<span class="imsb-spin imsb-spin-sm"></span> ' + (su ? 'Création…' : 'Connexion…') : (su ? 'Créer mon compte' : 'Se connecter')
}
function showError(overlay, msg) {
  const e = overlay.querySelector('#imsb-error'); if (!e) return
  if (msg) overlay.classList.remove('imsb-restoring')
  if (msg) overlay.classList.add('imv-auth-open')  // rend l'erreur visible même si la modale était fermée
  e.textContent = msg; e.style.display = msg ? 'block' : 'none'
}
function traduireErreur(m) {
  if (/invalid login credentials/i.test(m)) return 'Email ou mot de passe incorrect.'
  if (/email not confirmed/i.test(m)) return 'Email non confirmé.'
  return m || 'Connexion impossible.'
}
const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function injectStyles() {
  // Le CSS de l'écran de connexion vit dans css/login.css, lié par <link id="imsb-style-link"> dans le <head>
  // d'index.html (perf étape 3a : il est peint avant les scripts). Repli : si le lien est absent (page servie
  // autrement), on l'ajoute ici. Aucun CDN au runtime (polices vendorisées dans css/main.css).
  if (document.getElementById('imsb-style-link') || document.getElementById('imsb-style')) return
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.id = 'imsb-style-link'; l.href = 'css/login.css'
  document.head.appendChild(l)
}

// ── Démarrage (en dernier : toutes les déclarations const/function sont initialisées) ───────────
if (FLAG) {
  if (!window.IMMO_SUPABASE || !window.IMMO_SUPABASE.url) {
    console.warn('[ImmoSupabase] flag actif mais config absente (js/app/supabase-config.js → window.IMMO_SUPABASE).')
  } else {
    boot().catch(e => console.error('[ImmoSupabase] échec init :', e))
  }
}
