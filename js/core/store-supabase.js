// js/core/store-supabase.js — Backend Supabase du `Store` (P3) : hydratation + écriture.
//
// HYDRATE : reconstruit l'objet `DB` LEGACY (forme exacte) depuis les tables (`legacy_raw`)
//   + `espace_config.data`. → l'app charge depuis Supabase sans réécrire ses lectures.
// ÉCRITURE : upsert(coll, rec) / remove(coll, rec) → mapping legacy→ligne (store-mapping) +
//   INSERT/UPDATE par ligne avec CONCURRENCE OPTIMISTE par `version` (jamais de perte
//   silencieuse — un UPDATE périmé renvoie `conflict`, à l'app de re-hydrater).
//
// Dépendances INJECTÉES → testable offline ET branchable sur pg/supabase-js :
//   fetchTable(name) → Promise<Array<{ legacy_raw, id?, version? }>>
//     ⚠️ DOIT exclure les soft-deleted (deleted_at IS NOT NULL) ET, pour `baux`, les ARCHIVÉS
//        (archived = true, migration 0055 : un bail signé clôturé / remplacé n'est plus le bail courant).
//   writer.archive(table,id,expVer)→newVer|null : UPDATE archived=true gardé par version (baux seulement).
//   fetchConfig()    → Promise<object>   (espace_config.data, ou {})
//   writer = { insert(table,row)→newVer|null, update(table,id,row,expVer)→newVer|null,
//              softDelete(table,id,expVer[,extra])→newVer|null }   (extra = colonnes réécrites avec
//              deleted_at : candidats et pièces de candidats seulement, cf. effacementLigneCloud)   (null = CONFLIT : id déjà présent
//              côté serveur OU version périmée).
//     ⚠️ SQL réel OBLIGATOIRE (anti-perte silencieuse, anti-résurrection, §7/D20) :
//       insert     = `INSERT … ON CONFLICT (id) DO NOTHING RETURNING version` (0 ligne→null=conflit,
//                    ne JAMAIS écraser une ligne existante → l'app re-hydrate puis UPDATE). null
//                    couvre AUSSI un conflit sur un autre index unique (ex. quittances (logement,mois)) :
//                    le binding mappe tout unique_violation 23505 → null (fail-closed, jamais un throw).
//       update     = `UPDATE … SET … WHERE id=? AND version=? AND deleted_at IS NULL RETURNING version`
//                    (0 ligne→null : version périmée OU tombstone → pas de résurrection).
//                    Ne réécrit jamais created_by / legacy_id (provenance immuable post-création).
//       softDelete = `UPDATE … SET deleted_at=now() WHERE id=? AND version=? AND deleted_at IS NULL RETURNING version`.
//     NB (audit Minor) : un insert→null peut signaler une ligne TOMBSTONE (soft-deleted, donc
//       exclue de fetchTable / absente de _versions) occupant déjà l'id déterministe (ex. ref
//       recréée) → conflit FAIL-CLOSED (jamais d'écrasement ni de résurrection). Le caller P3
//       résout (un-delete ou fetch version), ce n'est pas un défaut de sécurité de ce module.
//   detUuid(...parts), espaceId, ownerId : ctx du mapping (cf. store-mapping.js).
//
// ⚠️ Collections portées par la CONFIG (espace_config), pas par une table : en plus de la
//   vraie config (params/categories/irlTable/templates/nid/flags), `assurances` (≠ `mrh`),
//   `auditTrail`, `compteursReleves`. NE PAS les ajouter à ARRAY_TABLES.
//   (`candidats` = désormais une vraie TABLE par-SCI, cf migration 0034 — volet 2 anti-fuite.)
import { fusionnerConfig3, egalProfond } from './config-merge.js'
import { mapToRow } from './store-mapping.js'
// CANDIDATURES-CONFORMITE : colonnes réécrites au soft-delete d'un candidat / d'une pièce de candidat
// (aucune donnée personnelle ne reste dans la ligne supprimée). Toute autre ligne : soft-delete nu.
import { effacementLigneCloud } from './candidature-purge.js'

const ARRAY_TABLES = {
  entites: 'entites', logements: 'logements', baux_historique: 'baux_historique',
  mouvements: 'mouvements', quittances: 'quittances', edl: 'edl', documents: 'documents',
  assurances: 'mrh', agenda: 'agenda', candidats: 'candidats',
  // Journal des baux SIGNÉS (migration 0054) : modifications hors avenant, à côté de la ligne
  // verrouillée du bail (js/core/bail-modifications.js). Même nom côté table et côté app.
  baux_evenements: 'baux_evenements',
  // TRAVAUX : QUI PAIE ? — registre des incidents (migration 0057, numéro provisoire), par SCI.
  incidents: 'incidents',
  // CIRCUIT D'UN INCIDENT — carnet d'artisans (migration 0060, numéro provisoire), par SCI.
  artisans: 'artisans',
}
const norm = s => String(s == null ? '' : s).trim().toLowerCase()
// collection legacy → table Supabase (mrh = la table assurances ; sinon identique).
const tableOf = coll => (coll === 'mrh' ? 'assurances' : coll)

// B-REBAIL-TOMBSTONE : collections dont l'id de ligne dérive d'une CLÉ NATURELLE ré-créable (nom
// d'entité, ref de logement, clé de bail). Reloger / recréer avec la même clé produit le MÊME id
// déterministe → collision avec le tombstone de l'ancien → conflit éternel. Ces collections seules
// autorisent le chemin « revive » (ré-ouverture délibérée du slot). Les collections keyées par un `id`
// local unique (mouvements/quittances/documents/edl/agenda/candidats) ne collisionnent JAMAIS à la
// re-création → exclues (un conflit y reste fail-closed, jamais de revive).
const REVIVABLE = new Set(['baux', 'logements', 'immeubles', 'entites'])

// collections legacy adossées à une TABLE (à NE PAS remettre dans le blob config espace_config).
// SOURCE UNIQUE : store-sync importe ce set pour son exclusion config (anti-drift, cf. test d'égalité).
export const TABLE_COLLECTIONS = new Set([...Object.values(ARRAY_TABLES), 'baux', 'immeubles'])
// + `_modifiedAt` (horodatage interne, changerait à chaque save → churn config inutile). Aligné ETL.
const CONFIG_EXCLUDED = new Set([...TABLE_COLLECTIONS, '_modifiedAt'])
// 🔐 Params LOCAL-USER : par-appareil, JAMAIS synchronisés dans espace_config (lue par tout membre via
// is_member → un membre scopé lirait le SECRET `bailSignAppKey`). Symétrique du strip Drive `_buildGlobalPayload`.
// Ces clés sont gardées en localStorage côté app et restaurées après hydrate (cf __immoSetDB).
export const LOCAL_USER_PARAM_KEYS = ['coGestionnaires', 'imRootFolderId', 'edlDriveFolderId', 'bailSignRelayUrl', 'bailSignAppKey']
const stripLocalUserParams = cfg => {
  if (cfg && cfg.params && typeof cfg.params === 'object') {
    const p = {}
    for (const [k, v] of Object.entries(cfg.params)) if (!LOCAL_USER_PARAM_KEYS.includes(k)) p[k] = v
    cfg.params = p   // nouvel objet : ne mute PAS le DB.params vivant
  }
  return cfg
}
// extrait le sous-ensemble CONFIG (complément des tables) → ce qui va dans espace_config.data.
const extractConfig = db => {
  const out = {}
  for (const [k, v] of Object.entries(db || {})) if (!CONFIG_EXCLUDED.has(k)) out[k] = v
  return stripLocalUserParams(out)
}

// 🔐 Volet 3 — clés PROPRIÉTAIRE-PRIVÉ : jamais dans le blob partagé `espace_config` (RLS is_member, lu
// par tout membre scopé) → vont dans `espace_config_private` (RLS is_full_member). Top-level en bloc +
// sous-clés de `params`. Un membre scopé ne les reçoit pas (fail-closed : RLS renvoie 0 ligne).
export const PRIVATE_CONFIG_KEYS = ['auditTrail', 'candidatLinks']
// premiersPas : progression de mise en route (docs/CDC-PREMIERS-PAS.md, D5) — mesure de la bêta, membres pleins seulement.
export const PRIVATE_PARAM_KEYS = ['bankAccounts', 'userProfile', 'premiersPas']
export const splitConfig = cfg => {
  const shared = {}, priv = {}
  for (const [k, v] of Object.entries(cfg || {})) {
    if (PRIVATE_CONFIG_KEYS.includes(k)) { priv[k] = v; continue }
    if (k === 'params' && v && typeof v === 'object') {
      const sp = {}, pp = {}
      for (const [pk, pv] of Object.entries(v)) (PRIVATE_PARAM_KEYS.includes(pk) ? pp : sp)[pk] = pv
      shared.params = sp
      if (Object.keys(pp).length) priv.params = pp
      continue
    }
    shared[k] = v
  }
  return { shared, priv }
}

// Identifiant applicatif sûr : nombre fini, ou jeton [A-Za-z0-9_.:@|-] de 1 à 200 caractères (toutes les
// formes générées par l'app). `legacy_raw.id` est réécrivable par tout membre en écriture via l'API, et l'app
// l'interpole dans des gestionnaires on… et des attributs : un identifiant d'une autre forme n'est pas chargé.
export const idEnregistrementSur = v => v == null
  || (typeof v === 'number' && Number.isFinite(v))
  || (typeof v === 'string' && /^[A-Za-z0-9_.:@|-]{1,200}$/.test(v))

export function createSupabaseStore({ fetchTable, fetchConfig, writer, writeConfig, fetchConfigPrivate, writeConfigPrivate, lireConfig, lireConfigPrivee, ecrireConfig, ecrireConfigPrivee, detUuid, espaceId, ownerId }) {
  if (typeof fetchTable !== 'function' || typeof fetchConfig !== 'function')
    throw new Error('createSupabaseStore: fetchTable et fetchConfig (fonctions) requis')

  let _db = null
  const _versions = new Map()   // uuid de ligne → version courante (concurrence optimiste)
  // Config gardée par version (lot B) : dernier état SYNCHRONISÉ de chaque blob (base de la fusion à trois
  // voies) + sa version. null tant que l'hydratation n'a pas lu les blobs par lireConfig / lireConfigPrivee.
  const _cfgOcc = typeof lireConfig === 'function' && typeof ecrireConfig === 'function'
  const _cfgPrivOcc = typeof lireConfigPrivee === 'function' && typeof ecrireConfigPrivee === 'function'
  const _cfgEtat = { partage: null, prive: null }
  // État lu par la DERNIÈRE hydratation, adopté seulement quand l'app adopte le DB correspondant (seed). Un
  // re-pull abandonné (saisie pendant la relecture) ne doit pas avancer la base de fusion : le DB vivant,
  // lui, n'a pas reçu ce contenu, et l'écriture suivante passerait sans fusion (relecture Fable R1).
  let _cfgEtatLu = null
  function adopterConfigLue() { if (_cfgEtatLu) { _cfgEtat.partage = _cfgEtatLu.partage; _cfgEtat.prive = _cfgEtatLu.prive; _cfgEtatLu = null } }
  const _copie = v => (v == null ? v : JSON.parse(JSON.stringify(v)))
  const captureVersions = rows => { for (const r of rows) if (r && r.id != null && r.version != null) _versions.set(r.id, r.version) }

  async function hydrate() {
    const db = {}
    // PERF — les ~14 lectures (tables, baux, immeubles, config, config privée) sont INDÉPENDANTES : on les lance
    // toutes ENSEMBLE (avant : l'une après l'autre, chaque aller-retour réseau attendait le précédent, ~1 à 2 s
    // de chargement après la connexion). On les ASSEMBLE ensuite dans le MÊME ordre qu'avant (clés de `db`,
    // captureVersions) : résultat identique. Un échec rejette toujours hydrate() (Promise.all), sauf le journal.
    const entries = Object.entries(ARRAY_TABLES)
    const lectures = entries.map(([table]) => {
      // Journal des baux signés : TOLÉRANT. Si le client est en ligne avant la migration 0054 (colonne
      // legacy_raw absente), une erreur ici ferait échouer TOUT le chargement cloud, pour tous les comptes.
      // On le dit en console et on continue sans journal (les baux s'affichent dans leur état signé).
      // Registre des incidents (0057) : même tolérance — le front peut précéder la migration.
      // Carnet d'artisans (0060) : même tolérance — le front peut précéder la migration (écritures différées).
      if (table === 'artisans') {
        return Promise.resolve().then(() => fetchTable(table)).then(rows => { _artisansIndispo = false; return rows })
          .catch(e => { _artisansIndispo = true; console.warn('[SupabaseStore] carnet des artisans indisponible (migration 0060 appliquée ?) — écritures différées :', e && e.message); return [] })
      }
      if (table === 'incidents') {
        return Promise.resolve().then(() => fetchTable(table)).then(rows => { _incidentsIndispo = false; return rows })
          .catch(e => { _incidentsIndispo = true; console.warn('[SupabaseStore] registre des incidents indisponible (migration 0057 appliquée ?) — écritures différées :', e && e.message); return [] })
      }
      if (table === 'baux_evenements') {
        return Promise.resolve().then(() => fetchTable(table)).catch(e => { console.warn('[SupabaseStore] journal des baux indisponible (migration 0054 appliquée ?) :', e && e.message); return [] })
      }
      return Promise.resolve().then(() => fetchTable(table))
    })
    const [tablesRows, bauxRows, immeublesRows, cfgBrut, cfgPrivBrut] = await Promise.all([
      Promise.all(lectures),
      Promise.resolve().then(() => fetchTable('baux')),
      Promise.resolve().then(() => fetchTable('immeubles')),
      Promise.resolve().then(() => (_cfgOcc ? lireConfig() : fetchConfig())),
      Promise.resolve().then(() => (_cfgPrivOcc ? lireConfigPrivee() : (typeof fetchConfigPrivate === 'function' ? fetchConfigPrivate() : null))),
    ])
    entries.forEach(([, coll], i) => {
      const rows = tablesRows[i]
      db[coll] = rows.map(r => r && r.legacy_raw).filter(lr => lr != null).filter(lr => {
        if (idEnregistrementSur(lr.id)) return true
        console.warn('[SupabaseStore] enregistrement écarté (identifiant de forme inattendue) dans « ' + coll + ' »')
        return false
      })
      captureVersions(rows)
    })
    db.baux = {}
    for (const r of bauxRows) { const lr = r && r.legacy_raw; if (!lr) continue; const { __key, ...rec } = lr; if (__key != null) db.baux[__key] = rec }
    captureVersions(bauxRows)
    captureVersions(immeublesRows)   // versions seules (collection re-imbriquée dans entites)

    // Config gardée par version : la lecture rend { data, version } ; la base de fusion = ce que le serveur a rendu.
    let cfgLu = cfgBrut, cfgPrivLu = cfgPrivBrut
    const lu = { partage: null, prive: null }
    if (_cfgOcc) { const r = cfgBrut || {}; cfgLu = r.data || {}; lu.partage = { base: _copie(cfgLu), version: r.version ?? null } }
    if (_cfgPrivOcc) { const r = cfgPrivBrut || {}; cfgPrivLu = r.data || {}; lu.prive = { base: _copie(cfgPrivLu), version: r.version ?? null } }
    if (_cfgOcc || _cfgPrivOcc) _cfgEtatLu = lu
    // config (+ collections non-tablées) ; GARDE : ne JAMAIS écraser une collection métier.
    const cfg = cfgLu || {}
    for (const [k, v] of Object.entries(cfg)) {
      if (TABLE_COLLECTIONS.has(k)) { console.warn('[SupabaseStore] clé config ignorée (collision collection métier) : ' + k); continue }
      db[k] = v
    }
    // Volet 3 : blob PRIVÉ (espace_config_private, is_full_member). Un membre PLEIN reçoit les clés
    // propriétaire-privé ; un membre SCOPÉ → {} (RLS) → rien (fail-closed). `params` : greffe SHALLOW
    // ({...partagé, ...privé}) — correcte car les sous-clés partagées/privées sont DISJOINTES par
    // construction (splitConfig répartit chaque sous-clé dans l'un OU l'autre, jamais les deux).
    const cfgPriv = cfgPrivLu || {}
    for (const [k, v] of Object.entries(cfgPriv)) {
      if (TABLE_COLLECTIONS.has(k)) continue
      if (k === 'params' && db.params && typeof db.params === 'object' && v && typeof v === 'object') db.params = { ...db.params, ...v }
      else db[k] = v
    }
    _db = db
    return db
  }

  function attach(db) { _db = db; return db }

  // resolvers FK construits depuis le DB EN MÉMOIRE courant (reflète les ajouts récents).
  // INCLUT les tombstones À DESSEIN : lors d'une suppression EN CASCADE (parent + enfants
  // tombstonés ensemble par l'app), le `remove` de l'enfant doit pouvoir résoudre le parent pour
  // que `mapToRow` calcule le `row.id` de l'enfant et émette le softDelete. Exclure les tombstones
  // ferait renvoyer null à mapToRow → remove `skipped` → SUPPRESSION PERDUE (enfant resté vivant
  // côté serveur). L'anti-résurrection à l'UPDATE est déjà garantie par le garde `deleted_at IS NULL`.
  function buildResolvers() {
    const db = _db || {}
    const entiteByNom = new Map(), immeubleByNom = new Map(), logementByRef = new Map(), documentByLegacy = new Map()
    for (const e of (db.entites || [])) {
      if (e && e.nom) entiteByNom.set(norm(e.nom), detUuid('entite', norm(e.nom)))
      for (const im of (Array.isArray(e && e.immeubles) ? e.immeubles : [])) if (im && im.nom) immeubleByNom.set(norm(im.nom), detUuid('immeuble', norm(im.nom)))
    }
    for (const l of (db.logements || [])) if (l && l.ref) logementByRef.set(norm(l.ref), detUuid('logement', norm(l.ref)))
    // documentByLegacy alimente mouvements.pj_document_id (FK DURE NON différée mouvements_pj_fk). On n'y
    // met QUE les documents dont la ligne est CONNUE du serveur (version trackée : hydratée ou insérée). Un
    // document neuf pas encore écrit — ou refusé ce flush (RLS : la PJ d'un mouvement d'une SCI tierce
    // n'est autorisée qu'une fois la ligne du mouvement présente, entite_of_document) — donnerait sinon
    // une violation 23503 sur le mouvement, et les deux se bloqueraient l'un l'autre à chaque flush
    // (contre-audit du 06/10/2026). Le mouvement part donc sans pj_document_id ; la PJ reste dans
    // legacy_raw (pjId) → l'app la retrouve à l'identique (hydrate = legacy_raw, cette colonne ne sert pas
    // à l'affichage) ; le document passe au flush suivant.
    for (const d of (db.documents || [])) {
      if (!d || d.id == null) continue
      const uid = detUuid('document', String(d.id))
      if (_versions.has(uid)) documentByLegacy.set(String(d.id), uid)
    }
    // ref logement → `_bailUid` du bail COURANT (vivant) : rattachement RLS d'un document « bail »
    // à la ligne propre du bail (store-mapping bailLigneCle). Absent → id historique du logement.
    const bailUidByRef = new Map()
    for (const [k, b] of Object.entries(db.baux || {})) if (b && !b._deleted && b._bailUid) bailUidByRef.set(norm(String(k).split('@@')[0]), b._bailUid)
    return { entiteByNom, immeubleByNom, logementByRef, documentByLegacy, bailUidByRef }
  }
  const ctx = () => ({ espaceId, ownerId, detUuid, ...buildResolvers() })

  // TRAVAUX : QUI PAIE ? — ORDRE DE DÉPLOIEMENT. Si le registre `incidents` (migration 0057) n'existe pas
  // encore au cloud (lecture échouée à l'hydratation), ses écritures — incidents ET pièces de type
  // 'incident' (contrainte documents_parent_type_check) — sont DIFFÉRÉES : statut 'deferred', baseline non
  // avancé, aucune erreur ni backoff (le reste de la synchro tourne normalement). Elles partent au premier
  // chargement qui trouve la table. Les dépenses (mouvements) ne dépendent pas de ces lignes.
  let _incidentsIndispo = false
  let _artisansIndispo = false
  const _differe = (legacyColl, rec) => (_incidentsIndispo && (legacyColl === 'incidents' || (legacyColl === 'documents' && rec && rec.parentType === 'incident')))
    || (_artisansIndispo && legacyColl === 'artisans')

  // upsert : INSERT si ligne inconnue, sinon UPDATE gardé par la version trackée.
  // Renvoie { status: 'inserted'|'updated'|'revived'|'conflict'|'skipped', id?, version? }.
  //
  // B-REBAIL-TOMBSTONE (chemin « revive ») : reloger un logement / recréer une clé naturelle produit un
  // id déterministe qui COLLISIONNE avec le tombstone de l'ancien → conflit éternel (INSERT ON CONFLICT
  // DO NOTHING → null ; ou UPDATE gardé deleted_at IS NULL → null). Sur INTENTION EXPLICITE — `opts.allowRevive`,
  // posé par store-sync UNIQUEMENT pour un AJOUT FRAIS (clé absente du baseline), jamais pour une édition —
  // on tente `reviveTombstone` : un UPDATE qui ré-ouvre le slot SEULEMENT s'il est TOMBSTONÉ (deleted_at
  // IS NOT NULL) et NON verrouillé. Une ligne vivante ou un signé locked → null → retombe en conflit
  // (fail-closed) : l'anti-résurrection reste entière hors du chemin d'ajout-frais, verrou légal intact.
  async function upsert(legacyColl, rec, opts = {}) {
    if (_differe(legacyColl, rec)) return { status: 'deferred' }
    const table = tableOf(legacyColl)
    const row = mapToRow(table, rec, ctx())
    if (!row) return { status: 'skipped' }
    const canRevive = !!(opts && opts.allowRevive) && REVIVABLE.has(legacyColl) && typeof writer.reviveTombstone === 'function'
    if (_versions.has(row.id)) {
      const nv = await writer.update(table, row.id, row, _versions.get(row.id))
      if (nv != null) { _versions.set(row.id, nv); return { status: 'updated', id: row.id, version: nv } }
      // UPDATE null = version périmée OU tombstone (relocation même session : la suppression a laissé la
      // version trackée). Si ajout-frais délibéré sur un tombstone → revive ; sinon conflit (re-hydrate).
      return _reviveOrConflict(canRevive, table, row)
    }
    // INSERT fail-closed : si l'id existe déjà côté serveur (ligne non trackée — mouvements
    // paginés, gap Realtime, autre onglet), writer.insert renvoie null → CONFLIT (jamais
    // d'écrasement silencieux ni de LWW). L'app re-hydrate → la ligne sera alors trackée → UPDATE.
    const nv = await writer.insert(table, row)
    if (nv != null) { _versions.set(row.id, nv); return { status: 'inserted', id: row.id, version: nv } }
    // INSERT null = id déjà pris. Session fraîche + relocation → l'id est un tombstone → revive.
    return _reviveOrConflict(canRevive, table, row)
  }
  // Tente la ré-ouverture d'un tombstone (ssi autorisée) ; retombe en conflit sinon (fail-closed).
  async function _reviveOrConflict(canRevive, table, row) {
    if (canRevive) {
      const rv = await writer.reviveTombstone(table, row.id, row)
      if (rv != null) { _versions.set(row.id, rv); return { status: 'revived', id: row.id, version: rv } }
    }
    return { status: 'conflict', id: row.id }
  }

  // remove : soft-delete gardé par version (jamais de DELETE physique). Opération DESTRUCTIVE
  // → on REFUSE si la version est inconnue (ligne non hydratée) plutôt que de deviner.
  async function remove(legacyColl, rec) {
    if (_differe(legacyColl, rec)) return { status: 'deferred' }
    const table = tableOf(legacyColl)
    const row = mapToRow(table, rec, ctx())
    if (!row) return { status: 'skipped' }
    if (!_versions.has(row.id)) return { status: 'conflict', id: row.id }   // version inconnue → re-hydrater d'abord
    const efface = effacementLigneCloud(table, rec)
    const nv = efface
      ? await writer.softDelete(table, row.id, _versions.get(row.id), efface)
      : await writer.softDelete(table, row.id, _versions.get(row.id))
    if (nv == null) return { status: 'conflict', id: row.id }
    _versions.set(row.id, nv)
    return { status: 'deleted', id: row.id, version: nv }
  }

  // archive : ARCHIVAGE d'un bail signé verrouillé (migration 0055 — seule écriture que le serveur
  // accepte sur une telle ligne : archived false→true, rien d'autre). Clôture, suppression, réinitialisation
  // des signatures ou relocation d'un bail signé : la ligne signée reste au cloud (preuve), elle cesse
  // simplement d'être le bail courant du logement → le logement accepte le bail suivant. Gardé par version,
  // comme remove : version inconnue ou périmée → conflit (re-hydratation), jamais une devinette.
  async function archive(legacyColl, rec) {
    if (legacyColl !== 'baux') return { status: 'skipped' }
    if (typeof writer.archive !== 'function') throw new Error('archive: writer.archive (binding) requis')
    const table = tableOf(legacyColl)
    const row = mapToRow(table, rec, ctx())
    if (!row) return { status: 'skipped' }
    if (!_versions.has(row.id)) return { status: 'conflict', id: row.id }
    const nv = await writer.archive(table, row.id, _versions.get(row.id))
    if (nv == null) return { status: 'conflict', id: row.id }
    _versions.set(row.id, nv)
    return { status: 'archived', id: row.id, version: nv }
  }

  // persistConfig : écrit le sous-ensemble CONFIG (complément des tables) dans espace_config.data.
  // Un seul blob jsonb par espace (pas de concurrence par ligne — l'espace_config a sa propre version
  // côté table mais le contenu est remplacé en entier). Faible volume, faible fréquence de conflit.
  // Écriture d'UN blob gardée par version. Inchangé depuis la base → rien. Conflit (version bougée) → on relit
  // le serveur, on fusionne à trois voies (base = dernier état synchronisé, local = cet appareil, distant =
  // serveur), et on réessaie avec la nouvelle version. Jamais de repli en « dernier écrit gagne » : après
  // 4 conflits d'affilée, erreur (le flush la réessaiera).
  async function ecrireBlobGarde(etat, local, lire, ecrire) {
    if (etat.base != null && egalProfond(local, etat.base)) return { ecrit: false, valeur: local, fusionne: false, conflits: [] }
    let aEcrire = local, base = etat.base || {}, version = etat.version, fusionne = false
    const conflits = []
    for (let essai = 0; essai < 4; essai++) {
      const nv = await ecrire(aEcrire, version)
      if (nv != null) { etat.base = _copie(aEcrire); etat.version = nv; return { ecrit: true, valeur: aEcrire, fusionne, conflits } }
      const srv = await lire()
      // Version inchangée et écriture quand même refusée : ce n'est pas un conflit, ce sont les DROITS (membre en
      // lecture seule, session sans droit d'écriture) → erreur claire, pas 4 relectures pour rien.
      if (srv.version === version) throw new Error('config : écriture refusée (droits insuffisants)')   // y compris sans ligne (null = null)
      const r = fusionnerConfig3({ base, local: aEcrire, distant: srv.data || {} })
      conflits.push(...r.conflits)
      aEcrire = r.fusion; base = _copie(srv.data || {}); version = srv.version ?? null; fusionne = true
      if (egalProfond(aEcrire, srv.data || {})) { etat.base = _copie(aEcrire); etat.version = version; return { ecrit: false, valeur: aEcrire, fusionne, conflits } }
    }
    throw new Error('config : conflit de version persistant (4 essais)')
  }

  // Réinjecte dans le DB vivant le résultat d'une fusion (sinon le flush suivant réécrirait les valeurs
  // locales périmées). Les params locaux à l'appareil (LOCAL_USER_PARAM_KEYS) ne sont jamais touchés.
  // `avant` = l'extrait de config pris AVANT les attentes réseau : une clé que l'utilisateur a modifiée pendant
  // ces attentes n'est pas écrasée (elle repartira au flush suivant, la signature n'étant pas avancée).
  function reinjecter(db, partage, prive, avant) {
    const combine = { ...partage }
    for (const [k, v] of Object.entries(prive || {})) {
      if (k === 'params' && v && typeof v === 'object') combine.params = { ...(combine.params || {}), ...v }
      else combine[k] = v
    }
    const courant = extractConfig(db)
    for (const k of new Set([...Object.keys(courant), ...Object.keys(combine)])) {
      let v = combine[k]
      // Clé modifiée PENDANT l'attente réseau : ni écrasée, ni gardée telle quelle — fusion à trois voies de la clé
      // (base = valeur d'avant l'écriture, local = saisie, distant = résultat fusionné), qui repartira au flush suivant.
      if (avant && !egalProfond(courant[k], avant[k])) v = fusionnerConfig3({ base: { k: avant[k] }, local: { k: courant[k] }, distant: { k: combine[k] } }).fusion.k
      if (k === 'params') {
        const locaux = {}
        for (const lk of LOCAL_USER_PARAM_KEYS) if (db.params && db.params[lk] !== undefined) locaux[lk] = db.params[lk]
        db.params = { ...(v || {}), ...locaux }
      } else if (v !== undefined) db[k] = v
      else delete db[k]
    }
  }

  async function persistConfig(db = _db) {
    if (_cfgOcc && _cfgEtat.partage) {
      const avant = _copie(extractConfig(db || {}))
      const { shared, priv } = splitConfig(_copie(avant))
      const rP = await ecrireBlobGarde(_cfgEtat.partage, shared, lireConfig, ecrireConfig)
      let rV = { ecrit: false, valeur: priv, fusionne: false, conflits: [] }
      // Le blob privé n'est écrit que s'il y a quelque chose (un membre scopé n'a aucune clé privée).
      try {
        if (_cfgPrivOcc && _cfgEtat.prive && priv && Object.keys(priv).length) rV = await ecrireBlobGarde(_cfgEtat.prive, priv, lireConfigPrivee, ecrireConfigPrivee)
      } catch (e) {
        // Fusion du partagé déjà ÉCRITE : réinjectée même si le privé échoue (sinon le flush suivant réécrirait le
        // DB périmé par-dessus — relecture Fable R2).
        if (rP.fusionne) reinjecter(db, rP.valeur, priv, avant)
        throw e
      }
      const conflits = [...rP.conflits, ...rV.conflits]
      // UNE seule réinjection, des deux blobs ensemble (deux réinjections successives faisaient prendre la 1re pour
      // une saisie et sautaient le privé fusionné — contre-relecture Fable 🟠1).
      if (rP.fusionne || rV.fusionne) { reinjecter(db, rP.valeur, rV.valeur, avant); return { status: 'config-merged', ecrit: rP.ecrit || rV.ecrit, conflits } }
      return { status: (rP.ecrit || rV.ecrit) ? 'config-written' : 'config-unchanged', conflits }
    }
    // Store capable d'écrire avec version mais jamais hydraté/adopté : on n'écrit RIEN (ni « dernier écrit gagne », ni erreur qui bloquerait une déconnexion).
    if (_cfgOcc) return { status: 'config-skipped' }   // jamais d'écriture non gardée ; la seed (adoption du DB) réarme
    if (typeof writeConfig !== 'function') throw new Error('persistConfig: writeConfig (binding) requis')
    const { shared, priv } = splitConfig(extractConfig(db || {}))
    await writeConfig(shared)
    // Le blob privé n'est écrit que s'il y a quelque chose (un membre scopé n'a aucune clé privée →
    // priv vide → pas d'UPSERT → pas de refus RLS is_full_manager). Seul un membre plein l'écrit.
    if (typeof writeConfigPrivate === 'function' && priv && Object.keys(priv).length) await writeConfigPrivate(priv)
    return { status: 'config-written' }
  }

  return { hydrate, attach, upsert, remove, archive, persistConfig, buildResolvers, adopterConfigLue }
}
