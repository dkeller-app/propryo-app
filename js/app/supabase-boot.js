// js/app/supabase-boot.js — Orchestration AUTH + ESPACE + Store/Sync au-dessus d'un client supabase-js
// INJECTÉ. L'app lui passe le client chargé depuis le CDN ; les tests lui passent le client node
// @supabase/supabase-js → AUCUNE dépendance CDN ici, donc testable en intégration contre le vrai
// Postgres. Le câblage CDN + l'exposition window.ImmoSupabase vivent dans l'entrée (étape 2, index.html).
import { createSupabaseStore } from '../core/store-supabase.js'
import { createSupabaseAdapter } from '../core/store-supabase-adapter.js'
import { createStoreSync } from '../core/store-sync.js'
import { makeDetUuid } from '../core/det-uuid.js'
import { createMultiStore } from '../core/store-multi.js'
// EDL TERRAIN lot 4 (F2, invariant 19g) — la règle « puis-je me déconnecter ? »
// vient du module testé. Elle était RÉÉCRITE À LA MAIN ici (un comptage
// errors+conflicts+skipped), donc non testée, pendant que la version testée du
// module ne servait à personne : deux expressions de la même règle, la vivante
// non vérifiée et la vérifiée morte. Une seule subsiste, celle qui est testée.
import { classerResumeFlush, verdictDeconnexion, MIROIR_KEY, MIROIR_ECRIT_KEY, FLUSH_OK_KEY } from '../core/offline-boot.js'

export function createBoot(client) {
  if (!client || !client.auth || typeof client.from !== 'function') throw new Error('createBoot: client supabase-js requis')
  let _store = null, _sync = null, _ctx = null

  // ── AUTH (Variante A : email/mdp d'abord, Google ensuite) ────────────────────
  // Perf — utilisateur VALIDÉ côté serveur à l'instant (getUser = appel réseau ; signInWithPassword = identifiants
  // vérifiés). resolveEspaces() le relisait par un 2e getUser, une aller-retour réseau de plus au démarrage : il
  // réutilise ce résultat s'il a moins de 15 s. Mémoire seule, jamais persisté ; aucun autre appelant ne le lit.
  let _userRecent = null, _userRecentAt = 0
  const _memoUser = u => { if (u && u.id) { _userRecent = u; _userRecentAt = Date.now() } }
  const _userRecentOuNull = () => (_userRecent && Date.now() - _userRecentAt < 15000 ? _userRecent : null)
  // Garde-fou « mauvais compte » : le mémo ne sert que si la session LOCALE active (getSession, sans réseau) est
  // bien celle du même utilisateur — après une déconnexion / un changement de compte, il est ignoré.
  async function _userRecentValide() {
    const m = _userRecentOuNull()
    if (!m) return null
    try { const { data } = await client.auth.getSession(); return (data && data.session && data.session.user && data.session.user.id === m.id) ? m : null }
    catch (e) { return null }
  }
  async function loginEmail(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (error) return { ok: false, error: error.message }
    _memoUser(data && data.user)
    return { ok: true, user: data.user }
  }
  // Création de compte (invité qui rejoint un partage). Confirmation email DÉSACTIVÉE côté Supabase →
  // data.session présente = connecté direct. ACTIVE (sans SMTP) → session null = bloqué tant que l'email
  // n'est pas confirmé (le caller affiche un message). « already registered » → le caller bascule en login.
  async function signUpEmail(email, password) {
    const { data, error } = await client.auth.signUp({ email, password })
    if (error) return { ok: false, error: error.message }
    return { ok: true, user: data.user, session: data.session }
  }
  async function loginGoogle(redirectTo) {
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: redirectTo ? { redirectTo } : undefined })
    return error ? { ok: false, error: error.message } : { ok: true }   // déclenche une redirection
  }
  async function sendPasswordReset(email, redirectTo) {
    const { error } = await client.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined)
    return error ? { ok: false, error: error.message } : { ok: true }
  }
  // logout : FLUSH d'abord (pousse toute modif non encore synchronisée → pas de perte si l'utilisateur
  // se déconnecte juste après une modif), puis signOut + reset. L'app doit AUSSI annuler son timer de
  // debounce en attente (sinon un flush programmé tirerait après le reset). Best-effort (catch).
  async function logout(opts) {
    _userRecent = null   // defense en profondeur : plus de memo de l'utilisateur apres une deconnexion

    // EDL TERRAIN lot 4, faille F2 (CDC §3ter, invariant 19g) — la déconnexion
    // DÉTRUISAIT le travail hors ligne : le flush ci-dessous échoue toujours sans
    // réseau, le code se contentait d'un console.warn (« la modif restée à quai est
    // perdue à la fermeture »), puis _teardownSession purgeait le miroir sans
    // condition. Les photos survivaient en IndexedDB mais devenaient ORPHELINES.
    // On refuse désormais, en le disant. `opts.forcer` = l'utilisateur a lu le
    // message et choisit quand même — un acte explicite, jamais un défaut.
    try {
      if (!(opts && opts.forcer)) {
        // ⚠️ LE CAS SANS MOTEUR EST TRAITÉ ICI, pas seulement chez l'appelant.
        // `_sync` est nul sur le chemin HORS LIGNE : l'ancienne condition
        // `if (_sync && …)` sautait donc la garde et rendait { ok: true }. Deux
        // portes (« utiliser un autre compte » d'une invitation, page de test)
        // appellent `logout` sans passer par la garde de l'entrée : elles
        // n'étaient sauvées par rien. Le verdict est le même dans les deux
        // modes, et il vient du module testé.
        const s = _sync ? await _sync.flush() : null
        const c = classerResumeFlush(s)
        let miroirPresent = false, miroirEcritA = 0, dernierFlushA = 0, miroirProtege = false
        try {
          // STOCKAGE lot 4 : le miroir peut vivre en IndexedDB (exposé par supabase-entry, qui l'initialise).
          miroirPresent = !!localStorage.getItem(MIROIR_KEY)
            || !!(typeof window !== 'undefined' && typeof window.__immoMiroirPresent === 'function' && window.__immoMiroirPresent())
          // Heure du dernier travail : MAX entre `_ecrit_at` et `travailA` (IndexedDB, audit O4) ;
          // miroir protégé (illisible, travail peut-être non remonté, audit R1) → refus.
          const _mi = (typeof window !== 'undefined' && typeof window.__immoMiroirEtat === 'function') ? window.__immoMiroirEtat() : null
          miroirEcritA = Math.max(parseInt(localStorage.getItem(MIROIR_ECRIT_KEY) || '0', 10) || 0, (_mi && Number(_mi.travailA)) || 0)
          miroirProtege = !!(_mi && _mi.protege)
          dernierFlushA = parseInt(localStorage.getItem(FLUSH_OK_KEY) || '0', 10) || 0
        } catch (e) {}
        if (miroirProtege) return { ok: false, raison: 'miroir-illisible', enAttente: 1, quoi: c.quoi, resume: s }
        const v = verdictDeconnexion({
          forcer: false,
          moteurPresent: !!_sync,
          horsLigne: !!(typeof window !== 'undefined' && window.__immoHorsLigne),
          miroirPresent, miroirEcritA, dernierFlushA,
          ecrituresEnAttente: c.enAttente,
          seulementBloquees: c.seulementBloquees,
        })
        if (!v.peut) {
          return { ok: false, raison: v.raison, enAttente: v.enAttente || 1, quoi: c.quoi, resume: s }
        }
      }
    } catch (e) {
      if (!(opts && opts.forcer)) {
        console.warn('[Supabase] logout refusé : flush impossible', e)
        return { ok: false, raison: 'flush-impossible', enAttente: 1, erreur: e }
      }
    }
    try {
      if (_sync && (opts && opts.forcer)) {
        const s = await _sync.flush()
        // P1.1 (audit C-B : « logout avale le résumé ») : un flush final incomplet est au moins TRACÉ —
        // la modif restée à quai est perdue à la fermeture (pas de file persistée avant P2.3).
        const bad = s ? (((s.errors && s.errors.length) || 0) + ((s.conflicts && s.conflicts.length) || 0) + ((s.skipped && s.skipped.length) || 0)) : 0
        if (bad || (s && s.config === 'error')) console.warn('[Supabase] logout : flush final INCOMPLET (modifs pas dans le cloud)', s)
      }
    } catch (_e) { console.warn('[Supabase] logout : flush final en échec', _e) }
    await client.auth.signOut()
    _store = _sync = _ctx = null
    return { ok: true }
  }
  async function currentUser() { const { data } = await client.auth.getUser(); return (data && data.user) || null }
  // EDL TERRAIN lot 4 (CDC §3, verrou 2) — `getUser()` est un APPEL RÉSEAU, et c'est
  // lui qui décide au boot si on passe ou si on voit l'écran de connexion. Sans réseau
  // il échoue → null → formulaire de connexion → qui a besoin du réseau lui aussi :
  // cul-de-sac. `currentUser()` AVALE l'erreur, donc l'appelant ne peut pas distinguer
  // « pas de réseau » de « jeton refusé ». Cette variante la rend — c'est tout ce qui
  // change, le comportement en ligne est identique.
  async function currentUserOrError() {
    try {
      const { data, error } = await client.auth.getUser()
      _memoUser(data && data.user)
      return { user: (data && data.user) || null, error: error || null }
    } catch (e) { return { user: null, error: e } }
  }
  // La session lue EN LOCAL, sans réseau (prouvé : cf. __tests__/helpers/supabase-offline-auth.test.js).
  // Elle existait déjà dans le fichier, mais n'était utilisée que pour le jeton du worker de signature.
  async function localSession() {
    try { const { data } = await client.auth.getSession(); return (data && data.session) || null }
    catch (e) { return null }
  }
  // onAuthChange : renvoie l'ABONNEMENT directement (appeler .unsubscribe() pour résilier). À appeler UNE
  // SEULE FOIS au boot de l'app et garder pour toute sa vie (ne PAS ré-abonner à chaque login → fuite).
  // cb(session, evt) : evt = 'SIGNED_OUT' | 'TOKEN_REFRESHED' | … (session morte ⇒ SIGNED_OUT / session null).
  function onAuthChange(cb) {
    const { data } = client.auth.onAuthStateChange((evt, session) => cb(session, evt))
    return (data && data.subscription) || null
  }

  // ── ESPACE ───────────────────────────────────────────────────────────────────
  // Résout l'espace de l'utilisateur (1re appartenance visible par la RLS) ou en crée un.
  // ownerId (namespace detUuid + provenance) = OWNER de l'espace (`created_by`) = celui qui a établi
  // les ids (l'import P0-E) → les ids restent cohérents même si un gestionnaire (≠ owner) écrit.
  async function resolveEspace(defaultName = 'Mon patrimoine') {
    // .order déterministe (sans, limit(1) renvoie une ligne arbitraire si l'utilisateur a plusieurs
    // espaces → tenant chargé instable d'une session à l'autre). 1 espace aujourd'hui ; durcir
    // (sélecteur d'espace explicite) avant le vrai multi-espace.
    const { data, error } = await client.from('espaces').select('id, nom, created_by').order('created_at', { ascending: true }).limit(1)
    if (error) throw new Error('resolveEspace: ' + error.message)
    if (data && data.length) return { espaceId: data[0].id, ownerId: data[0].created_by, espaceNom: data[0].nom }
    const { data: created, error: e2 } = await client.rpc('create_espace', { p_nom: defaultName })
    if (e2) throw new Error('create_espace: ' + e2.message)
    return { espaceId: created.id, ownerId: created.created_by, espaceNom: created.nom }
  }

  // MULTI-ESPACE : tous les espaces de l'utilisateur — son espace PROPRE (full_espace=true) + les espaces
  // TIERS où il a des SCI octroyées (full_espace=false). → [{espaceId, ownerId(created_by), mine}]. Espace
  // propre d'abord. 0 membership → en créer un (resolveEspace). N=1 → comportement mono identique.
  async function resolveEspaces(defaultName = 'Mon patrimoine') {
    const u = (await _userRecentValide()) || await currentUser()   // 1 aller-retour réseau de moins si l'utilisateur vient d'être validé
    const uid = u && u.id
    const { data: mems, error } = await client.from('espace_members')
      .select('espace_id, full_espace, role').eq('user_id', uid).eq('invite_status', 'active')
      .order('created_at', { ascending: true })
    if (error) throw new Error('resolveEspaces: ' + error.message)
    if (!mems || !mems.length) {
      const one = await resolveEspace(defaultName)
      return [{ espaceId: one.espaceId, ownerId: one.ownerId, espaceNom: one.espaceNom, mine: true }]
    }
    const ids = [...new Set(mems.map(m => m.espace_id))]
    const { data: esps, error: e2 } = await client.from('espaces').select('id, created_by, nom, created_at').in('id', ids)
    if (e2) throw new Error('resolveEspaces espaces: ' + e2.message)
    const metaById = {}; (esps || []).forEach(e => { metaById[e.id] = e })
    // Espace PROPRE = celui que le compte a CRÉÉ (`created_by`, figé côté serveur) ET où il est membre plein.
    // Jamais `full_espace` seul : une ligne de membre plein posée par un tiers (avant 0063) ne doit pas faire
    // d'un espace étranger « le mien » (sa config et les nouveaux enregistrements y partiraient). Plusieurs
    // espaces créés : le plus ancien, choix stable quel que soit l'ordre rendu par le serveur.
    const candidats = mems
      .filter(m => metaById[m.espace_id] && m.full_espace === true && metaById[m.espace_id].created_by === uid)
      .map(m => metaById[m.espace_id])
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)))
    // Aucun espace créé par ce compte (co-gestionnaire PLEIN de l'espace d'un autre, posé avant le partage par
    // SCI) : la plus ancienne appartenance pleine reste « propre », comme avant — sinon sa config ne serait plus
    // chargée mais serait quand même écrite là (relecture adverse du lot A). Les lignes pleines ne naissent plus
    // que par create_espace (0063) : ce repli ne peut plus être provoqué par un tiers.
    const pleines = mems.filter(m => metaById[m.espace_id] && m.full_espace === true)   // ordre created_at (requête)
    const propreId = candidats.length ? candidats[0].id : (pleines.length ? pleines[0].espace_id : null)
    if (candidats.length > 1) console.warn('[resolveEspaces] plusieurs espaces créés par ce compte : le plus ancien est retenu', candidats.map(e => e.id))
    const list = mems
      .filter(m => metaById[m.espace_id])
      .map(m => ({ espaceId: m.espace_id, ownerId: metaById[m.espace_id].created_by, espaceNom: metaById[m.espace_id].nom, mine: m.espace_id === propreId,
        // Membre PLEIN qui écrit partout dans l'espace (RLS is_full_manager : owner ou gestionnaire). null = rôle non lu.
        pleinEcriture: m.role == null ? null : (m.full_espace === true && (m.role === 'owner' || m.role === 'gestionnaire')) }))
    list.sort((a, b) => (b.mine - a.mine))   // espace propre d'abord
    // Espaces TIERS : SCI où l'utilisateur est GESTIONNAIRE (entite_membre, RLS « ses propres octrois »).
    // Sert au routage des enregistrements NEUFS (store-multi inferEspace) : un mouvement, un document ou un
    // rappel créé sur un lot d'une SCI tierce part dans l'espace de cette SCI SEULEMENT si l'écriture y est
    // permise ; sinon défaut D2 (espace propre), comme avant. Lecture en échec → aucune SCI inscriptible
    // (fail-safe : jamais un routage que la RLS refuserait en boucle).
    const tiers = list.filter(e => !e.mine)
    if (tiers.length) {
      let gest = []
      try {
        const { data: grants, error: e3 } = await client.from('entite_membre')
          .select('espace_id, entite_id, role').eq('user_id', uid).in('espace_id', tiers.map(e => e.espaceId))
        if (e3) console.warn('[resolveEspaces] octrois SCI illisibles :', e3.message)
        else gest = (grants || []).filter(g => g && g.role === 'gestionnaire')
      } catch (e4) { console.warn('[resolveEspaces] octrois SCI :', e4 && e4.message) }
      const norm = s => String(s == null ? '' : s).trim().toLowerCase()
      for (const e of tiers) {
        const ids = new Set(gest.filter(g => g.espace_id === e.espaceId).map(g => g.entite_id))
        const det = makeDetUuid(e.ownerId)
        // Membre PLEIN gestionnaire d'un espace tiers (lignes d'avant 0063) : toutes ses SCI, comme la RLS.
        e.peutEcrire = e.pleinEcriture === true ? () => true : nom => ids.has(det('entite', norm(nom)))
      }
    }
    return list
  }

  // ── STORE + SYNC ───────────────────────────────────────────────────────────────
  // getDB = () => objet DB mémoire (window.DB) ; schedule(fn) = debounce app (setTimeout 800ms).
  function wireStore({ espaceId, ownerId, getDB, schedule, pageSize }) {
    if (!espaceId || !ownerId) throw new Error('wireStore: espaceId + ownerId requis')
    const adapter = createSupabaseAdapter(client, espaceId, pageSize ? { pageSize } : {})
    const detUuid = makeDetUuid(ownerId)
    _store = createSupabaseStore({ ...adapter, detUuid, espaceId, ownerId })
    _sync = createStoreSync({ store: _store, getDB, schedule, sealSigned: true })   // VERROU LÉGAL AUTO activé (§5 chantier SIGNATURE-DISTANCE 2026-07-15) : un bail signé (présentiel/distance) reçoit son empreinte canonique (contentHashTerms) + verrou AVANT le snapshot → content_hash NOT NULL → satisfait baux_immotrack_hash_chk (fin du poison 23514 qui bloquait la poussée cloud des baux signés à distance)
    _ctx = { espaceId, ownerId }
    return { store: _store, sync: _sync }
  }

  // MULTI-ESPACE : un store par-espace agrégé par createMultiStore (interface identique → sync inchangé).
  // N=1 → équivaut à wireStore (1 store, pas de fusion réelle). getDB sert au routage des écritures (vue
  // filtrée par espace pour les résolveurs FK).
  function wireStores({ espaces, getDB, schedule, pageSize }) {
    if (!Array.isArray(espaces) || !espaces.length) throw new Error('wireStores: espaces requis')
    const makeStore = (espaceId, ownerId) => {
      if (!espaceId || !ownerId) throw new Error('wireStores: espaceId + ownerId requis par espace')
      const adapter = createSupabaseAdapter(client, espaceId, pageSize ? { pageSize } : {})
      return createSupabaseStore({ ...adapter, detUuid: makeDetUuid(ownerId), espaceId, ownerId })
    }
    _store = createMultiStore({ espaces, makeStore, getDB })
    _sync = createStoreSync({ store: _store, getDB, schedule, sealSigned: true })   // VERROU LÉGAL AUTO activé (§5 chantier SIGNATURE-DISTANCE 2026-07-15) — cf. wireStore
    const own = espaces.find(e => e.mine) || espaces[0]
    _ctx = { espaces, espaceId: own.espaceId, ownerId: own.ownerId }
    return { store: _store, sync: _sync }
  }

  async function hydrate() { if (!_store) throw new Error('hydrate: wireStore() d\'abord'); return _store.hydrate() }
  function seed(db) { if (_sync) _sync.seed(db) }              // baseline « déjà synchronisé » après hydrate
  function markDirty() { if (_sync) _sync.markDirty() }         // à brancher dans saveDB()
  async function flush(db) { return _sync ? _sync.flush(db) : null }

  return {
    loginEmail, signUpEmail, loginGoogle, sendPasswordReset, logout, currentUser, onAuthChange,
    currentUserOrError, localSession,
    resolveEspace, resolveEspaces, wireStore, wireStores, hydrate, seed, markDirty, flush,
    get store() { return _store }, get sync() { return _sync }, get ctx() { return _ctx },
  }
}
