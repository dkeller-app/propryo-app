// js/core/store-multi.js — STORE MULTI-ESPACE (vue unifiée associé abonné).
//
// Agrège N stores par-espace (1 par espace : l'espace PROPRE de l'utilisateur + les espaces TIERS où il a
// des SCI octroyées). Chaque store par-espace garde SON adapter + SON detUuid(ownerId) + SA map de versions.
//
// - hydrate() : hydrate chaque espace, FUSIONNE dans un seul DB (chaque enregistrement taggé `_espaceId`),
//   la CONFIG (params/templates/catégories…) ne vient QUE de l'espace propre (jamais celle d'un autre owner).
// - upsert/remove(coll, rec) : ROUTE vers le store de `rec._espaceId` (sinon l'espace propre = défaut D2).
//   Avant de router, on RAFRAÎCHIT la vue (résolveurs) de ce store depuis le DB vivant filtré par espace →
//   les ids déterministes sont calculés avec le BON detUuid (celui du propriétaire de l'espace cible).
// - persistConfig(db) : écrit la config UNIQUEMENT dans l'espace propre (un scopé n'écrit pas la config d'un
//   autre — la RLS le refuse de toute façon).
//
// Cas dégénéré N=1 (un seul espace) : équivaut au mono-espace actuel (1 store, pas de collision, tag inerte).
//
// Interface IDENTIQUE à createSupabaseStore (hydrate/upsert/remove/persistConfig) → branchable sur store-sync
// sans le modifier. Le tag `_espaceId` est porté par les enregistrements legacy (non synchronisé : exclu par
// le mapping qui ne lit que les champs connus ; cf. mapToRow). Décisions D1/D2/D3 : cf. spec store-multi-espace.

import { TABLE_COLLECTIONS } from './store-supabase.js'

export function createMultiStore({ espaces, makeStore, getDB }) {
  if (!Array.isArray(espaces) || !espaces.length) throw new Error('createMultiStore: espaces requis')
  const stores = espaces.map(e => ({ espaceId: e.espaceId, ownerId: e.ownerId, mine: !!e.mine, peutEcrire: typeof e.peutEcrire === 'function' ? e.peutEcrire : null, store: makeStore(e.espaceId, e.ownerId) }))
  const own = stores.find(s => s.mine) || stores[0]
  // own ITÉRÉ EN PREMIER (défense en profondeur, ne dépend pas de l'ordre passé par l'appelant) : la dédup de
  // collision baux (hydrate) garde la clé NUE pour le 1er espace vu → ce doit être l'espace PROPRE, jamais un
  // tiers. tri stable : own d'abord, le reste dans l'ordre d'origine.
  stores.sort((a, b) => (a === own ? -1 : b === own ? 1 : 0))
  const byId = new Map(stores.map(s => [s.espaceId, s]))

  // Collections legacy keyées par OBJET (pas un tableau). `baux` = { logementRef: bail }.
  const tagArr = (arr, eid) => { if (Array.isArray(arr)) for (const it of arr) if (it && typeof it === 'object') it._espaceId = eid; return arr }

  async function hydrate() {
    const merged = {}
    const ownConfig = {}
    // PERF — les espaces sont INDÉPENDANTS (chacun son adapter, son detUuid, sa map de versions) : on les hydrate
    // TOUS ENSEMBLE (avant : l'un après l'autre → un associé abonné à N espaces payait N fois le temps de chargement,
    // mesuré : 2 espaces = chargement doublé). La FUSION ci-dessous reste SÉQUENTIELLE dans l'ordre de `stores`
    // (espace propre d'abord → dédup `baux`, tags, config propre : résultat strictement identique).
    // (Promise.resolve().then : un throw synchrone d'un hydrate devient un rejet, comme avant)
    const dbs = await Promise.all(stores.map(s => Promise.resolve().then(() => s.store.hydrate())))
    for (let i = 0; i < stores.length; i++) {
      const s = stores[i]
      const db = dbs[i] || {}
      for (const [k, v] of Object.entries(db)) {
        if (k === 'baux' && v && typeof v === 'object') {
          merged.baux = merged.baux || {}
          for (const [ref, bail] of Object.entries(v)) {
            if (bail && typeof bail === 'object') bail._espaceId = s.espaceId
            // D1 (collision de réf inter-espaces, rare) : on désambiguïse la clé du 2e espace.
            const key = (ref in merged.baux) ? ref + '@@' + s.espaceId : ref
            merged.baux[key] = bail
          }
        } else if (Array.isArray(v) && TABLE_COLLECTIONS.has(k)) {
          // collection adossée à une TABLE par-SCI (RLS-scopée) → fusionner + tagger de TOUS les espaces.
          if (k === 'entites') for (const e of v) { if (e && typeof e === 'object') { e._espaceId = s.espaceId; tagArr(e.immeubles, s.espaceId) } }
          else tagArr(v, s.espaceId)
          merged[k] = (merged[k] || []).concat(v)
        } else if (s.mine) {
          // CONFIG (params/categories/templates…) ET collections legacy portées par la config (assurances/
          // auditTrail…, des TABLEAUX mais PAS table-backées) : UNIQUEMENT l'espace propre — jamais la config
          // d'un autre owner (anti-fuite : la RLS expose espace_config à tout membre scopé, cf. volet 3).
          ownConfig[k] = v
        }
      }
    }
    Object.assign(merged, ownConfig)
    return merged
  }

  // Construit, depuis le DB vivant (fusionné), la VUE filtrée d'UN espace (records taggés cet espace) pour
  // que les résolveurs FK du store cible soient à jour (nouveaux enregistrements inclus) et corrects (bon
  // namespace). Seules les collections lues par buildResolvers comptent : entites (+ immeubles), logements,
  // documents — mais on filtre tout par sûreté.
  function _viewFor(espaceId, live) {
    const v = {}
    const L = live || {}
    const isOwn = espaceId === own.espaceId
    // Un enregistrement CRÉÉ par l'app n'a PAS encore de tag `_espaceId` (le tag n'est posé qu'à l'hydrate).
    // Par défaut (D2) il appartient à l'espace PROPRE → sa vue inclut les non-tagués, sinon la FK d'un enfant
    // dont le parent est neuf (ex. logement sous une SCI tout juste créée) ne résoudrait jamais → upsert
    // skippé en boucle = perte de sync SILENCIEUSE (régression vs mono, où les résolveurs voient le DB vivant
    // entier). Les espaces TIERS ne voient QUE leurs enregistrements explicitement tagués.
    const keep = it => it && (it._espaceId === espaceId || (isOwn && it._espaceId == null))
    for (const [k, val] of Object.entries(L)) {
      if (k === 'baux' && val && typeof val === 'object') {
        v.baux = {}
        for (const [ref, bail] of Object.entries(val)) if (keep(bail)) v.baux[ref.split('@@')[0]] = bail
      } else if (Array.isArray(val)) {
        v[k] = val.filter(keep)
      }
    }
    return v
  }

  function _route(rec) {
    const s = (rec && rec._espaceId && byId.get(rec._espaceId)) || own
    // rafraîchit les résolveurs du store cible depuis le DB vivant filtré (sinon un enregistrement créé
    // après l'hydrate ne serait pas résolu, ou le serait avec le mauvais detUuid).
    try { if (typeof getDB === 'function' && typeof s.store.attach === 'function') s.store.attach(_viewFor(s.espaceId, getDB())) } catch (e) {}
    return s.store
  }

  // À la collision (D1), la clé baux fusionnée est désambiguïsée « ref@@espaceId » → store-sync la passe en
  // __key. L'écriture doit porter la RÉF NUE : le store cible keye/résout le bail par réf logement
  // (logementByRef, detUuid('bail', ref), legacy_ref), jamais par la clé désambiguïsée. store-sync garde sa
  // propre identité de baseline suffixée (interne, inchangée). No-op à N=1 / hors collision (pas de « @@ »).
  // On ne strippe le suffixe QUE s'il correspond à un espaceId CONNU (byId) → une réf de logement contenant
  // littéralement « @@ » (saisie libre) n'est jamais corrompue. Le séparateur « ref@@espaceId » n'est posé
  // que par hydrate, donc le suffixe est toujours un espaceId réel hors faux positif.
  const _bareKey = rec => {
    if (rec && typeof rec.__key === 'string') {
      const i = rec.__key.indexOf('@@')
      if (i !== -1 && byId.has(rec.__key.slice(i + 2))) return { ...rec, __key: rec.__key.slice(0, i) }
    }
    return rec
  }
  async function upsert(coll, rec, opts) { const r = _bareKey(rec); return _route(r).upsert(coll, r, opts) }
  async function remove(coll, rec) { const r = _bareKey(rec); return _route(r).remove(coll, r) }
  // Archivage d'un bail (migration 0055) : routé comme remove → l'espace du PROPRIÉTAIRE du bail.
  async function archive(coll, rec) { const r = _bareKey(rec); return _route(r).archive(coll, r) }
  // config = espace propre uniquement ; aucun espace propre (associé invité sans espace à lui) → rien n'est écrit
  // (sa config n'a pas été chargée : l'écrire réinitialiserait celle du propriétaire, ou serait refusé sans fin).
  async function persistConfig(db) { return own.mine ? own.store.persistConfig(db) : { status: 'config-skipped' } }
  // Espace d'un enregistrement NEUF (non tagué), déduit de son rattachement (cf. inferRattachementOf). Ne
  // renvoie qu'un espace TIERS connu, et seulement si l'utilisateur peut y ÉCRIRE pour la SCI de rattachement
  // (`peutEcrire(nomSCI)`, posé par resolveEspaces depuis entite_membre role=gestionnaire) : un associé en
  // lecture seule garderait sinon un refus RLS 42501 retenté sans fin (ex. agenda automatique). Propre,
  // indécidable, SCI inconnue ou non inscriptible → null (défaut D2 inchangé). Appelé par store-sync
  // (_adoptTags) AVANT le diff, pour poser le tag sur la source vivante.
  function inferEspace(coll, rec, db) {
    const r = inferRattachementOf(coll, rec, db)
    if (!r || r.espace == null || r.espace === own.espaceId) return null
    const s = byId.get(r.espace); if (!s) return null
    if (s.peutEcrire && !(r.entite && s.peutEcrire(r.entite))) return null
    return r.espace
  }

  // Config gardée par version (lot B) : l'état lu à l'hydratation n'est adopté qu'avec le DB (store-sync.seed).
  function adopterConfigLue() { for (const s of stores) if (s.store && typeof s.store.adopterConfigLue === 'function') s.store.adopterConfigLue() }
  return { hydrate, upsert, remove, archive, persistConfig, inferEspace, stores, adopterConfigLue }
}

const _norm = s => String(s == null ? '' : s).trim().toLowerCase()

// PUR (testable) — espace où doit vivre un enregistrement NEUF, d'après la fiche à laquelle il se
// rattache dans le DB vivant (taggé par l'hydrate) : logement (ref), immeuble (nom), SCI (nom),
// mouvement / candidat parent (id). Incident 05/10/2026 (fusion SCI SMARTOSAURUS) : un associé
// gestionnaire d'une SCI tierce créait mouvements / documents / agenda sur ses lots → tous partaient dans
// SON espace (D2), invisibles du propriétaire et rattachés à rien. Règles :
//   • seuls les records VIVANTS comptent (un tombstone homonyme ne décide jamais) ;
//   • un nom/ref présent dans UN SEUL espace tagué → cet espace ; présent aussi en non tagué (créé en
//     session = espace propre) ou dans plusieurs espaces → indécidable → null (D2, comme avant) ;
//   • le lien le plus précis gagne (logement > immeuble > SCI) ; s'il est indécidable on n'essaie pas
//     un lien moins précis (pas de devinette quand le lien précis est ambigu).
// Renvoie { espace, entite } (entite = NOM de la SCI de rattachement, ou null) ou null. Sans effet de bord.
export function inferRattachementOf(coll, rec, db) {
  if (!rec || typeof rec !== 'object' || !db) return null
  const vivant = x => x && typeof x === 'object' && !x._deleted
  const add = (map, k, esp, entNom) => {
    if (!k) return
    let a = map.get(k); if (!a) { a = []; map.set(k, a) }
    a.push({ espace: esp == null ? null : esp, entite: entNom == null ? null : String(entNom) })
  }
  const entites = Array.isArray(db.entites) ? db.entites : []
  const ent = new Map(), imm = new Map(), log = new Map()
  for (const e of entites) {
    if (!vivant(e)) continue
    add(ent, _norm(e.nom), e._espaceId, e.nom)
    for (const im of (Array.isArray(e.immeubles) ? e.immeubles : [])) if (vivant(im)) add(imm, _norm(im.nom), im._espaceId != null ? im._espaceId : e._espaceId, e.nom)
  }
  for (const l of (Array.isArray(db.logements) ? db.logements : [])) if (vivant(l)) add(log, _norm(l.ref), l._espaceId, l.entity)
  // undefined = lien absent (on essaie le suivant) ; null = lien présent mais indécidable (on s'arrête).
  const look = (map, k) => {
    const n = _norm(k); if (!n) return undefined
    const a = map.get(n); if (!a) return undefined
    const esps = new Set(a.map(x => x.espace))
    return (esps.size === 1 && !esps.has(null)) ? a[0] : null
  }
  const first = (...tries) => { for (const t of tries) { const r = t(); if (r !== undefined) return r } return null }
  const L = k => () => look(log, k), I = k => () => look(imm, k), E = k => () => look(ent, k)
  const ref = v => String(v == null ? '' : v).split('@@')[0]
  // Parent référencé par id (mouvement d'une PJ, candidat d'une pièce) : son tag s'il en a un, sinon
  // son propre rattachement (parent créé dans la même session).
  const parent = (collParent, id) => () => {
    if (id == null || id === '') return undefined
    const p = (Array.isArray(db[collParent]) ? db[collParent] : []).find(x => vivant(x) && String(x.id) === String(id))
    if (!p) return undefined
    const r = inferRattachementOf(collParent, p, db)
    if (p._espaceId != null) return { espace: p._espaceId, entite: r && r.espace === p._espaceId ? r.entite : null }
    return r
  }
  switch (coll) {
    case 'logements': return first(E(rec.entity))
    case 'immeubles': {
      const par = entites.find(e => e && Array.isArray(e.immeubles) && e.immeubles.includes(rec))
      return (par && vivant(par) && par._espaceId != null) ? { espace: par._espaceId, entite: par.nom } : first(E(rec.__entiteNom))
    }
    case 'baux': return first(L(ref(rec.__key)), E(rec.entity))
    case 'baux_historique': return first(L(rec.ref), E(rec.entity))
    case 'baux_evenements': return first(L(ref(rec.ref)))
    case 'quittances': return first(L(rec.logement), E(rec.entity))
    case 'edl': case 'mrh': return first(L(rec.logement))
    case 'candidats': return first(L(rec.logRef), E(rec.entity))
    case 'incidents': return first(L(rec.logRef), I(rec.imm), E(rec.entity))
    case 'artisans': return first(E(rec.entity))
    case 'agenda': return first(L(rec.logement), I(rec.immeuble), E(rec.entite))
    case 'mouvements': {
      const q = String(rec.qui == null ? '' : rec.qui)
      return first(q.startsWith('SCI:') ? E(q.slice(4)) : L(q), I(rec.imm))
    }
    case 'documents': {
      const t = rec.parentType
      if (t === 'mouvement') return first(parent('mouvements', rec.parentId))
      if (t === 'candidat') return first(parent('candidats', rec.parentId), L(rec.logRef))
      if (t === 'incident') return first(parent('incidents', rec.parentId), L(rec.logRef))
      if (t === 'immeuble') return first(I(rec.parentRef))
      if (t === 'entite') return first(E(rec.parentRef))
      if (t === 'logement' || t === 'bail') return first(L(ref(rec.parentRef)), L(rec.logRef))
      return first(L(rec.logRef))   // mrh / assurance / equipement / quittance : via le logement
    }
    default: return null   // entites (une SCI neuve vit dans l'espace propre) / collection inconnue
  }
}
// PUR (testable) — l'utilisateur peut-il MODIFIER ce qui est rattaché à la SCI `nom` de l'espace `espaceId` ?
// `espaces` = liste de resolveEspaces ({ espaceId, mine, peutEcrire? }). Même règle que le routage des écritures
// (inferEspace ci-dessus) et que la RLS (has_entite_write) :
//   • espace PROPRE (`mine`, créé par le compte : propriétaire) → oui, sauf rôle plein en lecture seule ;
//   • membre PLEIN owner/gestionnaire d'un espace (`pleinEcriture`) → oui pour toutes ses SCI ;
//   • espace TIERS → seulement les SCI octroyées en GESTIONNAIRE (`peutEcrire`, entite_membre) ; nom vide (pas de
//     SCI) → non : la RLS n'ouvre une ligne sans SCI qu'aux membres pleins ;
//   • enregistrement non tagué (créé dans la session) → espace propre (défaut D2) ;
//   • espace inconnu, liste absente ou sans `peutEcrire` → non (fail-closed : jamais une écriture que la RLS
//     refuserait en boucle), sauf l'enregistrement non tagué quand la liste est absente (mode sans espaces).
export function peutEcrireSci(espaces, espaceId, nom) {
  const list = Array.isArray(espaces) ? espaces.filter(e => e && e.espaceId) : []
  if (!list.length) return espaceId == null
  const own = list.find(e => e.mine) || list[0]
  const e = espaceId == null ? own : list.find(x => x.espaceId === espaceId)
  if (!e) return false
  // `pleinEcriture` (rôle de la ligne espace_members, posé par resolveEspaces) : membre plein owner/gestionnaire → tout
  // l'espace (is_full_manager) ; membre plein en lecture seule (repli d'avant 0063) → rien. null/absent = rôle non lu.
  if (e.pleinEcriture === true) return true
  if (e.mine) return e.pleinEcriture !== false
  return typeof e.peutEcrire === 'function' && !!String(nom == null ? '' : nom).trim() && e.peutEcrire(nom) === true
}

// PUR (testable) — le compte gère-t-il EN PLEIN l'espace `espaceId` (propriétaire ou membre plein gestionnaire,
// RLS is_full_manager) ? Seul ce compte modifie les CHAMPS RÉSERVÉS d'un bailleur (identité légale, IBAN, BIC,
// signature, logo, e-mail d'envoi, suppression : trigger de la migration 0064). Un gestionnaire limité à une SCI
// partagée les voit en lecture seule. Même lecture de la liste que peutEcrireSci ; fail-closed.
export function gereSciEnPlein(espaces, espaceId) {
  const list = Array.isArray(espaces) ? espaces.filter(e => e && e.espaceId) : []
  if (!list.length) return espaceId == null
  const own = list.find(e => e.mine) || list[0]
  const e = espaceId == null ? own : list.find(x => x.espaceId === espaceId)
  if (!e) return false
  if (e.pleinEcriture === true) return true
  return !!e.mine && e.pleinEcriture !== false
}

// Espace seul (cf. inferRattachementOf).
export function inferEspaceOf(coll, rec, db) {
  const r = inferRattachementOf(coll, rec, db)
  return r ? r.espace : null
}

// PUR (testable) — owner de l'espace où vit une SCI (par nom), dans un DB fusionné taggé. `entites` = tableau
// taggé `_espaceId` ; `espaceOwners` = map espaceId→ownerId ; `fallbackOwner` = owner propre (entité neuve /
// introuvable / non taggée). Sert au chemin Storage par-SCI : une SCI TIERS a son entite_id dérivé avec LE
// detUuid de SON propriétaire. ⚠️ collision de NOM inter-espaces : le premier par ordre du tableau gagne
// (own d'abord via le tri I4) → range dans l'espace propre, jamais chez un tiers (pas de fuite ; cf D1).
export function resolveEntiteOwner(entites, espaceOwners, nom, fallbackOwner) {
  const n = _norm(nom)
  if (Array.isArray(entites)) {
    const ent = entites.find(e => e && _norm(e.nom) === n)
    if (ent && ent._espaceId && espaceOwners && espaceOwners[ent._espaceId]) return espaceOwners[ent._espaceId]
  }
  return fallbackOwner
}

// PUR (testable) — espaceId où vit la SCI dont l'uuid de segment Storage = `seg`. Reconstruit l'uuid de chaque
// entité avec l'owner de SON espace et matche `seg`. `makeDetUuid` = fabrique ((...parts)→uuid). Aucun match
// (seg d'une entité absente / legacy) → `fallbackEspace`. À N=1, tout retombe sur fallbackOwner/fallbackEspace.
export function resolveEspaceOfSeg(entites, espaceOwners, makeDetUuid, seg, fallbackOwner, fallbackEspace) {
  if (seg && Array.isArray(entites) && typeof makeDetUuid === 'function') {
    for (const e of entites) {
      const oid = (e && e._espaceId && espaceOwners && espaceOwners[e._espaceId]) || fallbackOwner
      if (makeDetUuid(oid)('entite', _norm(e && e.nom)) === seg) return (e && e._espaceId) || fallbackEspace
    }
  }
  return fallbackEspace
}
