// js/core/store-sync.js — Moteur de synchronisation arrière-plan (cœur de l'Option C).
//
// À chaque sauvegarde, l'app écrit instantanément son cache local (localStorage) PUIS appelle
// markDirty() : ce module repère, en différentiel vs un instantané « déjà synchronisé », ce qui a
// changé/disparu, et le pousse dans Supabase LIGNE PAR LIGNE via le Store (concurrence `version`,
// jamais de perte). Le diff est fail-safe vers le SUR-envoi : une fausse différence ne fait qu'un
// upsert idempotent (gardé version), jamais d'omission (même contenu ⟺ même signature JSON).
//
// Dépendances INJECTÉES (testable offline) :
//   store   = { upsert(coll, rec)→{status}, remove(coll, rec)→{status} }  (createSupabaseStore)
//   getDB   = () => DB en mémoire (lu à chaque flush → reflète l'état courant)
//   schedule(fn) = (option) planifie un flush debouncé (app : setTimeout 800ms ; test : capture)
//
// Identité de diff par collection = la clé legacy NATURELLE (celle dont dérive l'id déterministe du
// mapping) : entites/immeubles par nom, logements par ref, baux par clé de map, le reste par id.
import { TABLE_COLLECTIONS, LOCAL_USER_PARAM_KEYS } from './store-supabase.js'   // source unique des collections table-backées + params local-user
import { bailContentHash } from './bail-content-hash.js'  // empreinte légale canonique des baux signés (verrou)
import { bailHistCle, nouvelIdArchive } from './store-mapping.js'          // identité d'une archive (SOURCE UNIQUE avec l'id de ligne)
import { entreeJournalAuto } from './bail-modifications.js'   // journal automatique d'un bail signé verrouillé (B2)

const norm = s => String(s == null ? '' : s).trim().toLowerCase()

// PÉRIMÈTRE de ce moteur = les collections adossées à une TABLE métier (12, candidats inclus depuis
// le volet 2). Sont gérées AILLEURS, pas un oubli :
//   • config (params/categories/templates/irlTable/catConfig/piecesEDL/auditTrail/
//     compteursReleves) → espace_config.data (chemin de sync séparé, pièce 2).
//   • ⚠️ GAP SCHÉMA CONNU : `DB.assurances` = assurance BAILLEUR (PNO/GLI/lot copro, ≠ `mrh` =
//     MRH locataire). AUCUNE table Supabase aujourd'hui (la table `assurances` modélise `mrh`).
//     Vide dans les vraies données (0 ligne) → pas synchronisée ici À DESSEIN. À trancher en phase
//     schéma (table dédiée OU colonne discriminante) AVANT qu'un utilisateur saisisse une assurance
//     bailleur. NE PAS l'ajouter naïvement à COLLECTIONS (collision d'ids nid() avec `mrh` → même table).
//
// D1 — FUSION MULTI-ESPACES : suffixe la clé de DIFF par l'espace du record quand il est taggé
// (`_espaceId`, posé par le store multi-espace à l'hydrate pour CHAQUE collection adossée à une table).
// Deux espaces peuvent porter la MÊME clé (même SCI, mêmes refs — cas réel SMARTOSAURUS des deux côtés
// + refs FERRETTE proches ; ou, plus subtil, deux records d'espaces distincts portant le même `id` local
// verbatim après une copie/restauration) : sans ce suffixe, ils s'ÉCRASENT dans la Map baseline/snapshot
// du diff → la modif de l'un est perdue (l'autre le masque), et la suppression de l'un vise à tort la
// ligne de l'autre. Miroir du « ref@@espaceId » que store-multi pose déjà sur les clés d'OBJET de `baux`.
// Appliqué SYMÉTRIQUEMENT à TOUTES les collections — y compris celles keyées par un `id` local (audit
// D1 : ne PAS reposer sur l'unicité PROCÉDURALE de nid() inter-espaces, qui n'est pas une garantie du
// code mais un heureux hasard). INERTE à N=1 (mono-espace = aucun tag = clé nue = comportement mono
// strictement inchangé, cf. test « N=1 clé de diff NUE »). La clé de diff est PUREMENT INTERNE (baseline
// Map + _removeConflicts) : jamais transmise au store — l'écriture route par `rec._espaceId` (store-multi).
// Ne PAS la confondre avec l'id de ligne (dérivé du mapping, namespacé par owner).
const espTag = r => (r && r._espaceId != null) ? '@@' + r._espaceId : ''

// Collections poussées vers des TABLES, ORDONNÉES parent→enfant (la ligne parente doit exister
// côté Postgres avant l'insert d'un enfant : FK composite (parent_id, espace_id)).
const COLLECTIONS = [
  // SPREAD DÉFENSIF (comme immeubles/baux) : la clé d'identité (nom) dérive l'uuid de ligne. `saveEnt`
  // renomme aujourd'hui par REMPLACEMENT d'objet (DB.entites[i]=ent) → l'entité n'a jamais souffert du
  // doublon. Mais la copie fige l'identité au seed et immunise contre une future mutation en place (même
  // classe de bug que logements/baux_historique ci-dessous). Invariant homogène sur toutes les collections
  // à clé naturelle mutable. Voir le contrat verrouillé par store-sync.test.js (renommage entité).
  // `sources` (D1b) : accès aux records VIVANTS du DB (PAS les copies d'enumerate) → la réadoption
  // du tag d'espace s'y pose durablement (résolveurs FK, _viewFor et flushs suivants la revoient).
  { coll: 'entites',         enumerate: db => (db.entites || []).map(e => ({ ...e })),   key: r => norm(r.nom) + espTag(r), sources: db => db.entites || [] },
  // immeubles IMBRIQUÉS : héritent de la suppression du parent (nesting = appartenance structurelle).
  // delEnt tombstone l'entité mais préserve ses immeubles SANS `_deleted` → sans cette propagation,
  // l'immeuble partirait en upsert = ligne zombie vivante sous une entité supprimée. Robuste quel que
  // soit le chemin de suppression de l'app (défense en profondeur, indépendant de delEnt).
  { coll: 'immeubles',       enumerate: db => (db.entites || []).flatMap(e => (Array.isArray(e.immeubles) ? e.immeubles : []).map(im => ({ ...im, __entiteNom: e.nom, _deleted: !!(im && im._deleted) || !!(e && e._deleted) }))), key: r => norm(r.nom) + espTag(r), sources: db => (db.entites || []).flatMap(e => (Array.isArray(e.immeubles) ? e.immeubles : [])) },
  // ⚠️ SPREAD OBLIGATOIRE (idem entites) : la ref dérive l'uuid, et RENOMMER-BIEN mute logement.ref EN
  // PLACE. Sans copie → baseline rétro-corrompu → remove vise le nouvel uuid → ANCIEN bien cloud survit =
  // DOUBLON (bug observé v15.435). La copie au seed fige l'identité de suppression.
  { coll: 'logements',       enumerate: db => (db.logements || []).map(l => ({ ...l })), key: r => norm(r.ref) + espTag(r), sources: db => db.logements || [] },
  // VERROU LÉGAL : `immutable` = un bail signé verrouillé. S'il est DÉJÀ verrouillé au baseline (déjà
  // synchronisé locked), le moteur ne le ré-upserte/supprime JAMAIS (le trigger DB refuserait → conflit).
  // Depuis le chantier clôture/relocation (B2, migration 0055) : sa VIE est journalisée (baux_evenements),
  // et quand il cesse d'être le bail courant (clôture, suppression, réinitialisation, relocation) sa
  // ligne est ARCHIVÉE — seule écriture que le serveur accepte — cf. _doFlush phase 0.
  { coll: 'baux',            enumerate: db => Object.entries(db.baux || {}).map(([k, v]) => ({ __key: k, ...v })), key: r => norm(r.__key), immutable: r => !!(r && r.signatures && r.signatures.locked), sources: db => Object.entries(db.baux || {}).map(([k, v]) => ({ __key: k, __src: v, _espaceId: v && typeof v === 'object' ? v._espaceId : null })) },
  // ⚠️ clé = identité EXACTE du mapping (store-mapping bailHistCle : ref|_archivedAt[|_archiveId]).
  //    Keyer par `id` (non unique sur un log d'archive) regrouperait deux archives distinctes → perte silencieuse.
  //    `_archiveId` n'est posé QU'EN CAS DE COLLISION (2 archives du même logement le même jour, cf. _identifierArchives).
  // ⚠️ SPREAD OBLIGATOIRE (audit BUG-RENAME-CLOUD-DUP) : `ref` (mutée EN PLACE par renameLogementRef) dérive
  //    l'uuid. Sans copie → même doublon que logements, ici dans une table à valeur de PREUVE. Renommer un bien
  //    dont l'historique n'est pas signé (= la population renommable) dupliquerait la ligne d'archive. La copie fige.
  { coll: 'baux_historique', enumerate: db => (db.baux_historique || []).map(h => ({ ...h })), key: r => bailHistCle(r) + espTag(r), sources: db => db.baux_historique || [] },
  // Journal des baux signés (0054) : APRÈS baux (FK composite bail_id → baux). Clé = id local unique.
  { coll: 'baux_evenements', enumerate: db => db.baux_evenements || [],                 key: r => String(r.id) + espTag(r), sources: db => db.baux_evenements || [] },
  // documents AVANT mouvements : FK DURE mouvements_pj_fk (pj_document_id) → documents (la ligne
  // document doit exister avant l'insert d'un mouvement qui la référence). documents.parent_id est
  // polymorphe SANS FK dure → peut précéder ses parents sans violation. (Aligné sur l'ETL import.mjs.)
  // Incidents (0057) AVANT documents : le contrôle RLS d'une pièce du dossier de preuves (entite_of_document,
  // branche 'incident') lit la ligne incident — elle doit exister quand la pièce est insérée.
  { coll: 'incidents',       enumerate: db => db.incidents || [],                       key: r => String(r.id) + espTag(r), sources: db => db.incidents || [] },
  // Carnet d'artisans (0060) : aucune ligne n'en dépend ; rattaché à la SCI.
  { coll: 'artisans',        enumerate: db => db.artisans || [],                        key: r => String(r.id) + espTag(r), sources: db => db.artisans || [] },
  { coll: 'documents',       enumerate: db => db.documents || [],                       key: r => String(r.id) + espTag(r), sources: db => db.documents || [] },
  { coll: 'mouvements',      enumerate: db => db.mouvements || [],                       key: r => String(r.id) + espTag(r), sources: db => db.mouvements || [] },
  { coll: 'quittances',      enumerate: db => db.quittances || [],                      key: r => String(r.id) + espTag(r), sources: db => db.quittances || [] },
  // ⚠️ EDL : `immutable` est prêt, MAIS il n'y a PAS de `sealSignedEdl` (cf. sealSignedBaux) → un EDL
  //    signé partirait NON verrouillé en base. Scellement EDL DIFFÉRÉ (hors-scope spec : 0 EDL signé
  //    aujourd'hui ; concept de verrou EDL non câblé). À compléter avant la 1ʳᵉ signature d'EDL.
  { coll: 'edl',             enumerate: db => db.edl || [],                             key: r => String(r.id) + espTag(r), immutable: r => !!(r && r.signatures && r.signatures.locked), sources: db => db.edl || [] },
  { coll: 'mrh',             enumerate: db => db.mrh || [],                             key: r => String(r.id) + espTag(r), sources: db => db.mrh || [] },   // → table assurances
  { coll: 'agenda',          enumerate: db => db.agenda || [],                          key: r => String(r.id) + espTag(r), sources: db => db.agenda || [] },
  { coll: 'candidats',       enumerate: db => db.candidats || [],                       key: r => String(r.id) + espTag(r), sources: db => db.candidats || [] },
]

// 'revived' (B-REBAIL) = ré-ouverture délibérée d'un tombstone (relocation / clé naturelle recréée) :
// un SUCCÈS d'écriture au même titre qu'insert/update → le baseline avance (sinon retry éternel).
const OK_UPSERT = new Set(['inserted', 'updated', 'revived'])
const sig = rec => JSON.stringify(rec)   // signature de changement (sur-envoi sûr, jamais de sous-détection)
// L'app supprime par TOMBSTONE EN PLACE : le record RESTE dans la collection avec `_deleted:true`
// (jamais retiré de l'array). Même prédicat que l'ETL import.mjs (`isDel`). On EXCLUT les tombstones
// du « courant vivant » → un record passé live→tombstoné disparaît du courant → la branche removes
// (softDelete gardé par version) se déclenche. Sans ce filtre, le tombstone partirait en UPSERT et
// RESSUSCITERAIT la ligne côté Supabase (mapToRow ignore `_deleted`). Un record jamais synchronisé
// vivant puis tombstoné n'est ni au baseline ni au courant → ignoré (rien à supprimer côté serveur).
const isDeleted = rec => !!(rec && rec._deleted)

// ⚠️ VERROU AUTO gouverné par l'option `sealSigned` de createStoreSync (défaut true). L'app le met à FALSE
// en phase test/transition (décision user 2026-06-18 : « pas de documents légaux réels ») car il rendait un
// bail signé IMMUABLE → bloquait reset/re-signature/archivage PDF (le cloud refuse toute modif d'un bail
// locked). Le code reste intact ; l'app repassera `sealSigned: true` avant la prod avec de vrais baux légaux.

// VERROU LÉGAL (pièce 2) — SCELLEMENT au point UNIQUE de la sync : tout bail SIGNÉ (`signatures.signedAt`)
// pas encore scellé reçoit ici son empreinte canonique + le verrou, quelle que soit la VOIE de signature
// (présentiel / distance / futur) → un seul chokepoint, impossible de rater un chemin (≠ câbler chaque flux
// de signature dans index.html). Idempotent : un bail déjà scellé (hash + locked) est ignoré ; un hash
// existant n'est JAMAIS recalculé (immutabilité). Async (crypto.subtle) ; appelé AVANT le snapshot du flush
// → le diff voit l'état scellé et POSE le verrou ; les flushs suivants l'excluent (déjà locked, pièce 4).
// ARCHIVE AVANT SCEAU (28/09, défaut mesuré en base) — signature EN PRÉSENCE complète : la fenêtre de
// signature persiste les signatures (→ flush 800 ms) PUIS génère le PDF, fusionne le certificat et
// l'envoie au stockage (plusieurs secondes), et n'écrit qu'ENSUITE cloudPdfKey / proof / contentHash /
// certRef sur `bail.signatures`. Scellé entre les deux, le bail était déjà verrouillé : ces références
// ne partaient jamais au cloud (PDF et certificat orphelins, introuvables au rechargement ou sur un
// autre appareil). On attend donc la fin de l'archive (`archiveTermine`, posé par __immoArchiveBailPdf,
// succès OU échec) ou une référence d'archive — avec un délai de garde, pour qu'une fenêtre fermée avant
// la génération du PDF ne laisse jamais un bail signé sans verrou. La signature à distance n'est pas
// concernée (`_completeRemoteSign` pose tout, verrou compris, en une fois : mode 'distance').
export const ARCHIVE_GARDE_MS = 15 * 60 * 1000
export function archiveEnAttente(sg, now) {
  if (!sg || sg.mode !== 'avec-locataire' || sg.archiveTermine) return false
  if (sg.cloudPdfKey || (sg.pdfRef && sg.pdfRef.cloudPdfKey) || sg.driveWebViewLink || sg.driveFileId) return false
  // Instant TECHNIQUE de l'enregistrement (`persistedAt`, posé par la fenêtre de signature) : `signedAt`
  // peut être une DATE SAISIE (midi UTC, voire passée ou future) → il ne mesure pas le temps écoulé.
  // Repli sur signedAt pour une signature enregistrée avant ce correctif.
  const t = Date.parse(sg.persistedAt || sg.signedAt)
  if (!isFinite(t)) return false
  const ecart = (now == null ? Date.now() : now) - t
  return ecart >= -ARCHIVE_GARDE_MS && ecart < ARCHIVE_GARDE_MS   // horodatage aberrant (futur lointain) → ne pas attendre
}

/** Délai restant avant la fin de l'attente d'archive le plus proche (ms), ou null s'il n'y en a pas. */
export function attenteArchiveRestante(db, now) {
  const t0 = now == null ? Date.now() : now
  let min = null
  for (const bail of Object.values((db && db.baux) || {})) {
    const sg = bail && bail.signatures
    if (!sg || (sg.contentHashTerms && sg.locked) || !archiveEnAttente(sg, t0)) continue
    const reste = Date.parse(sg.persistedAt || sg.signedAt) + ARCHIVE_GARDE_MS - t0
    if (min == null || reste < min) min = reste
  }
  return min == null ? null : Math.max(1000, min + 1000)
}

async function sealSignedBaux(db) {
  for (const bail of Object.values((db && db.baux) || {})) {
    const sg = bail && bail.signatures
    if (!sg || !sg.signedAt) continue                  // pas signé → rien à sceller
    // ⚠️ C1 (audit 2026-06-16) : `bailleur-seul` = bail PARTIELLEMENT signé (bailleur OK, LOCATAIRE PAS
    // ENCORE — la Phase 2 où il signe arrive APRÈS). Le verrouiller figerait un état juridiquement
    // INCOMPLET et bloquerait/perdrait la signature du locataire. On ne scelle QUE les modes complets
    // (avec-locataire, distance, et les baux legacy déjà bilatéraux). `signedAt` ≠ « signé par tous ».
    if (sg.mode === 'bailleur-seul') continue
    if (sg.contentHashTerms && sg.locked) continue      // déjà scellé → idempotent
    // Présentiel : archive du PDF en cours → le VERROU attend. L'EMPREINTE, elle, est figée dès maintenant
    // (audit O2) : calculée plus tard, elle intégrerait une modification faite pendant l'attente.
    if (archiveEnAttente(sg)) { if (!sg.contentHashTerms) sg.contentHashTerms = await bailContentHash(bail); continue }
    if (!sg.contentHashTerms) sg.contentHashTerms = await bailContentHash(bail)   // empreinte figée (jamais recalculée)
    if (!sg.signatureSource) sg.signatureSource = 'immotrack'
    sg.locked = true
  }
}
// CONFIG = complément des tables : les collections non-tablées (params/categories/templates/irlTable/
// catConfig/piecesEDL/auditTrail/candidats/compteursReleves/assurances bailleur…) → un seul blob
// espace_config.data (chemin distinct du sync de table). Exclus : les collections table-backées
// (SOURCE UNIQUE importée de store-supabase, anti-drift) + `_modifiedAt` (interne, churn inutile).
// Le test « garde anti-drift » asserte que SYNCED_COLLECTIONS ≡ TABLE_COLLECTIONS (sinon perte silencieuse).
const CONFIG_EXCLUDED = new Set([...TABLE_COLLECTIONS, '_modifiedAt'])
export const SYNCED_COLLECTIONS = COLLECTIONS.map(c => c.coll)

// EDL TERRAIN lot 4bis — la CLÉ D'IDENTITÉ d'un enregistrement dans sa collection,
// telle que la calcule le moteur : c'est elle qui apparaît dans `summary.conflicts`.
// Exportée parce que le lot 4bis doit retrouver QUEL enregistrement local a
// conflicté pour en conserver la version. Sans ça l'appelant devrait recopier la
// convention `String(id) + '@@' + espaceId` — et une copie dérive : deux EDL
// homonymes de deux espaces partagés seraient confondus. Rend null pour une
// collection inconnue, jamais une clé inventée.
export function recordKey(coll, rec) {
  const c = COLLECTIONS.find(x => x.coll === coll)
  if (!c || !rec) return null
  try { return c.key(rec) } catch (_e) { return null }
}

// M4 (audit v15.460, chantier P1.3) : « le flush a-t-il réellement écrit quelque chose au cloud ? »
// Sert au broadcast Realtime `changed` : un poison isolé (P1.2) ne doit PAS étouffer le signal quand des
// upserts/removes/config VIENNENT d'aboutir dans le même flush — sinon les autres appareils restent figés
// tant qu'un enregistrement toxique traîne. Pur (testable), tolérant à un résumé absent (flush qui throw).
export const summaryHasCloudWrites = s => !!(s && (
  (s.upserts && s.upserts.length) || (s.revives && s.revives.length) ||
  (s.removes && s.removes.length) || (s.archives && s.archives.length) || s.config === 'written' || s.config === 'merged'))
const configSig = db => {
  const o = {}
  for (const k of Object.keys(db || {}).sort()) if (!CONFIG_EXCLUDED.has(k)) o[k] = db[k]
  // 🔐 Exclure les params LOCAL-USER de la signature (ils ne sont jamais persistés dans espace_config —
  // cf strip extractConfig) : sinon changer la clé relais marquerait « dirty » → flush qui ne pousse rien.
  if (o.params && typeof o.params === 'object') {
    const p = {}
    for (const [k, v] of Object.entries(o.params)) if (!LOCAL_USER_PARAM_KEYS.includes(k)) p[k] = v
    o.params = p
  }
  return JSON.stringify(o)
}

// Identifiant opaque (ligne propre d'un bail, archive en collision, entrée de journal automatique).
// Jamais dérivé d'une donnée métier : seule son unicité compte (il est persisté dans legacy_raw).
const _uidDefaut = nouvelIdArchive   // même générateur que l'app (store-mapping) : un seul format d'identifiant

export function createStoreSync({ store, getDB, schedule, sealSigned = true, retryBaseMs = 2000, retryMaxMs = 60000, now = () => new Date(), newUid = _uidDefaut }) {
  if (!store || typeof store.upsert !== 'function' || typeof store.remove !== 'function')
    throw new Error('createStoreSync: store.upsert/remove requis')
  if (typeof getDB !== 'function') throw new Error('createStoreSync: getDB requis')

  // baseline = état « déjà synchronisé ». Map<coll, Map<key, { rec, sig }>>.
  const baseline = new Map()
  for (const { coll } of COLLECTIONS) baseline.set(coll, new Map())
  let _configSig = null   // signature du blob config déjà synchronisé (espace_config)
  // M2 (audit v15.460) : clés dont le DERNIER remove est parti en CONFLIT. Un remove en conflit reste
  // en attente (baseline non avancé → retenté à chaque flush) mais ne doit plus déclencher le flush
  // IMMÉDIAT de markDirty à chaque save — sinon le debounce est neutralisé tant que le conflit vit
  // (sa résolution est « conflit → re-hydrate », pas un martèlement). Clé = coll + ' ' + key
  // (injectif : aucun nom de collection ne contient d'espace).
  const _removeConflicts = new Set()
  const _rcKey = (coll, k) => coll + ' ' + k

  // D1b — RÉADOPTION du tag d'espace (BUG-PARTAGE-EDL-ESPACE-TIERS, incident du 18/07/2026).
  // Plusieurs flux de l'app éditent par REMPLACEMENT d'objet (saveEDL : `DB.edl[i] = record` ;
  // saveEnt : `DB.entites[i] = ent` ; `DB.baux[ref] = {…}`) → le tag `_espaceId` posé à l'hydrate
  // est PERDU. Sans réadoption, le diff voyait « clé@@espace disparue » (softDelete routé vers cet
  // espace — pour un membre scopé gestionnaire, la RLS l'AUTORISE) + « clé nue apparue » (upsert
  // routé espace PROPRE, FK souvent irrésoluble → skipped, ou conflit d'id éternel pour les
  // collections hors REVIVABLE) = DESTRUCTION silencieuse. Cas réel : l'EDL d'entrée FERRETTE 001
  // de l'espace Marion, détruit le 18/07 à 09:16 UTC. Touche AUSSI le mono-espace cloud (N=1) :
  // depuis v15.483 l'hydrate tague TOUT, donc toute réédition d'EDL déclenchait la même mécanique.
  // Règles :
  //   • un record VIVANT non tagué dont la clé NUE correspond à un UNIQUE espace tagué du baseline
  //     est LE MÊME record réédité → il ré-adopte ce tag (durablement, SUR LA SOURCE du DB vivant :
  //     le routage, les résolveurs FK et _viewFor de store-multi le revoient) AVANT le diff ;
  //   • un record déjà tagué n'est JAMAIS retagué ;
  //   • clé nue connue NON taguée au baseline → record propre (D2 inchangé ; mono-espace inerte) ;
  //   • AMBIGUÏTÉ (2+ espaces candidats — homonymie réelle, ex. SMARTOSAURUS des deux côtés) : pas
  //     de devinette de ROUTAGE (le record reste D2) MAIS les removes des clés taguées homonymes
  //     sont SUSPENDUS (audit réserve 1) : on ne détruit JAMAIS une ligne cloud dont un jumeau
  //     vivant non résolu existe localement — convergence à la prochaine re-hydrate (re-tag).
  const _bareKey = (keyFn, rec) => (rec && rec._espaceId != null) ? keyFn({ ...rec, _espaceId: null }) : keyFn(rec)
  // Réadoption d'UNE collection, sur ses records SOURCES (vivants). Renvoie l'ensemble des clés
  // nues restées AMBIGUËS (jumeau vivant non résolu) → sert à suspendre les removes correspondants.
  // Enregistrement NEUF (clé inconnue du baseline) : son espace est DÉDUIT de son rattachement par le
  // store multi-espace (store.inferEspace, cf. store-multi inferEspaceOf) — un mouvement, un document ou
  // un rappel créé par un associé sur un lot d'une SCI TIERCE part dans l'espace de cette SCI, plus dans
  // l'espace propre (incident 05/10/2026, SCI SMARTOSAURUS). Absent (store mono) ou indécidable → D2.
  const _infer = typeof store.inferEspace === 'function' ? store.inferEspace : null
  function _adoptTags(coll, keyFn, srcs, db) {
    const base = baseline.get(coll)
    let unresolved = null
    const hasBase = !!(base && base.size)
    if (!hasBase && !_infer) return unresolved
    let idx = null   // paresseux (uniquement si un record non tagué existe) : cléNue → { untagged, tags }
    for (const probe of srcs) {
      // baux : la clé (__key) vit dans le dict, pas dans la valeur → sources() fournit un wrapper
      // { __key, __src } ; le tag se pose sur __src (l'objet bail vivant). Ailleurs probe = source.
      const target = (probe && probe.__src !== undefined) ? probe.__src : probe
      if (!target || typeof target !== 'object' || target._espaceId != null || isDeleted(target)) continue
      if (hasBase) {
        if (idx === null) {
          idx = new Map()
          for (const v of base.values()) {
            const tag = v.rec && v.rec._espaceId
            const bare = _bareKey(keyFn, v.rec)
            let e = idx.get(bare); if (!e) { e = { untagged: false, tags: new Set() }; idx.set(bare, e) }
            if (tag == null) e.untagged = true; else e.tags.add(tag)
          }
        }
        const e = idx.get(keyFn(probe))   // probe non tagué → keyFn(probe) = clé nue
        if (e) {
          if (!e.untagged && e.tags.size === 1) target._espaceId = e.tags.values().next().value
          else if (e.tags.size) {           // ambigu (ou clé nue connue + homonymes tagués) → removes suspendus
            if (!unresolved) unresolved = new Set()
            unresolved.add(keyFn(probe))
          }
          continue
        }
      }
      // clé inconnue du baseline → vrai nouveau record : espace de son rattachement, sinon D2.
      if (_infer && db) {
        const vue = (probe && probe.__src !== undefined) ? { ...probe.__src, __key: probe.__key } : probe
        const t = _infer(coll, vue, db)
        if (t != null) target._espaceId = t
      }
    }
    return unresolved
  }
  // Réadoption de TOUTES les collections (appelée par le flush ET la détection de removes
  // pendables — JAMAIS au seed : post-hydrate tout est tagué, et le baseline consulté serait
  // celui d'avant, périmé). Renvoie Map<coll, Set<cléNue>> des jumeaux vivants non résolus.
  function _adoptAll(db) {
    const suspended = new Map()
    for (const { coll, sources, key } of COLLECTIONS) {
      const u = _adoptTags(coll, key, sources(db), db)
      if (u) suspended.set(coll, u)
    }
    return suspended
  }

  function snapshotOf(db) {
    const snap = new Map()
    for (const { coll, enumerate, key, immutable } of COLLECTIONS) {
      const m = new Map()
      // `locked` = état d'immutabilité CAPTURÉ ici (booléen STABLE), pas relu via la référence `rec` : le
      // rec partage `signatures` avec le bail vivant (spread shallow) ; muter `signatures.locked` en place
      // changerait rétroactivement le baseline → la 1ʳᵉ transition de verrouillage serait sautée à tort.
      // `sAt` (baux) = signature CAPTURÉE ici, même raison que `locked` : `signatures` est partagé avec le
      // bail vivant ; relire rec.signatures.signedAt plus tard verrait une mutation en place.
      for (const rec of enumerate(db)) { if (isDeleted(rec)) continue; m.set(key(rec), { rec, sig: sig(rec), locked: immutable ? !!immutable(rec) : false, sAt: (coll === 'baux' && rec.signatures && rec.signatures.signedAt) || null }) }
      snap.set(coll, m)
    }
    return snap
  }

  // seed : capture le baseline depuis le DB courant (après hydrate → aucun diff au prochain flush).
  function seed(db = getDB()) {
    // Lot B : le DB est adopté → la base de fusion de la config devient celle lue avec lui.
    if (typeof store.adopterConfigLue === 'function') store.adopterConfigLue()
    const snap = snapshotOf(db)
    for (const { coll } of COLLECTIONS) baseline.set(coll, snap.get(coll))
    _configSig = configSig(db)
    _removeConflicts.clear()   // M2 : baseline neuve (re-hydratation) → les conflits mémorisés sont périmés
  }

  // ── CHANTIER CLÔTURE / RELOCATION D'UN BAIL SIGNÉ (option B2, validée Didier 28/09) ─────────────
  // Défaut prouvé sur la base hébergée (supabase/tests/repro-bail-signe-cloture.test.mjs) : une fois
  // scellé, un bail signé n'était plus JAMAIS écrit (ni retiré, ni remplacé, ni complété) — clôture,
  // relocation, révision IRL, lien du PDF signé… perdus en silence au rechargement. Principe B2 : le
  // contrat signé ne bouge jamais ; sa VIE va dans le journal ; quand il cesse d'être le bail courant,
  // sa ligne est ARCHIVÉE (seule écriture acceptée par le serveur, migration 0055) et le bail suivant
  // reçoit SA PROPRE ligne (`_bailUid`, store-mapping bailLigneCle).
  const _bauxKey = k => norm(k)                                   // = clé de diff de COLLECTIONS.baux
  const _bauxKeyFn = COLLECTIONS.find(c => c.coll === 'baux').key
  const _uidDe = r => (r && r._bailUid) || null

  // IDENTITÉ des baux, AVANT le snapshot (posée sur les objets VIVANTS → legacy_raw la porte) :
  //  • absent du baseline (création, ou relocation vue d'un appareil frais) → `_bailUid` NEUF : sa propre
  //    ligne. Indispensable : l'id historique du logement peut être tenu au cloud par un bail signé
  //    ARCHIVÉ (immuable, jamais réanimable) → un insert sur cet id serait un conflit éternel ;
  //  • baseline VERROUILLÉ, même signature → c'est LE bail signé : identité rétablie telle qu'au baseline
  //    (un objet reconstruit ou restauré ne change jamais de ligne) ;
  //  • baseline VERROUILLÉ, autre signature ou plus de signature → SUCCESSEUR (relocation, réinitialisation
  //    des signatures) : `_bailUid` NEUF, l'ancienne ligne est archivée en phase 0 ;
  //  • baseline NON verrouillé → même ligne (réédition, ou relocation d'un bail non signé réécrite comme
  //    avant) ; un objet reconstruit sans `_bailUid` récupère celui du baseline.
  //  • AUDIT v15.690 (C2) — un bail SCELLÉ qui n'est PAS la ligne du baseline (restauré par « Annuler »
  //    après une suppression / une réinitialisation, ou par une restauration de sauvegarde) reçoit
  //    TOUJOURS une ligne NEUVE : sa ligne d'origine a pu être archivée entre-temps — immuable, jamais
  //    réécrite ni réanimée → un update/insert dessus échouait sans fin, et le bail disparaissait au
  //    rechargement. Une ligne neuve est toujours acceptée (l'INSERT d'un signé n'est pas intercepté) ;
  //    la ligne archivée reste la preuve. Un bail NON scellé garde son identité (sa ligne ne peut être
  //    que vivante ou supprimée — réanimable par le chemin B-REBAIL).
  // Contre-audit v15.690 (I-1) : un uid MIS ICI et pas encore confirmé par un insert réussi est STABLE
  // d'un flush à l'autre — sinon un insert en échec (réseau) re-tirait un uid à chaque flush, et une entrée
  // de journal (ou un document) rattachée entre-temps visait une ligne qui n'existerait jamais (FK
  // baux_evenements_bail_fk → erreur retentée sans fin). Seul un uid VENU D'AILLEURS (restauration,
  // « Annuler ») sur un bail scellé est remplacé. Retiré de l'ensemble dès que la ligne est écrite.
  const _uidsEnAttente = new Set()
  const _poserUid = b => { b._bailUid = newUid(); _uidsEnAttente.add(b._bailUid) }
  function _identifierBaux(db) {
    const base = baseline.get('baux')
    for (const [k, bail] of Object.entries((db && db.baux) || {})) {
      if (!bail || typeof bail !== 'object' || isDeleted(bail)) continue
      const prev = base && base.get(_bauxKey(k))
      const scelle = !!(bail.signatures && bail.signatures.locked)
      const etranger = scelle && !_uidsEnAttente.has(bail._bailUid)   // scellé portant un uid venu d'ailleurs
      if (!prev) { if (!bail._bailUid || etranger) _poserUid(bail); continue }
      const pUid = _uidDe(prev.rec)
      if (prev.locked) {
        const sAt = bail.signatures && bail.signatures.signedAt
        if (sAt && sAt === prev.sAt) { if (pUid) bail._bailUid = pUid; else delete bail._bailUid }
        else if (!bail._bailUid || bail._bailUid === pUid || etranger) _poserUid(bail)
      } else {
        if (!bail._bailUid && pUid) bail._bailUid = pUid
        if (etranger && _uidDe(bail) !== pUid) _poserUid(bail)   // scellé venu d'ailleurs : ligne neuve
      }
    }
  }

  // ARCHIVES DU MÊME JOUR : deux archives d'un logement datées du même jour partageaient la clé — donc la
  // LIGNE cloud — `ref|_archivedAt` : la seconde écrasait la première (prouvé sur la base hébergée le 28/09).
  // On départage avec `_archiveId`, UNIQUEMENT en collision : une archive seule garde son identité
  // historique ; celle déjà synchronisée (même contenu qu'au baseline) garde la sienne.
  function _identifierArchives(db) {
    const list = Array.isArray(db && db.baux_historique) ? db.baux_historique : []
    const base = baseline.get('baux_historique')
    const groupes = new Map()
    for (const h of list) {
      if (!h || typeof h !== 'object' || isDeleted(h) || h._archiveId) continue
      const k = bailHistCle(h) + espTag(h)
      let g = groupes.get(k); if (!g) { g = []; groupes.set(k, g) }
      g.push(h)
    }
    for (const [k, g] of groupes) {
      const prev = base && base.get(k)
      if (g.length < 2) continue                                  // seule sur sa clé → identité historique
      const ancre = (prev && g.find(h => sig({ ...h }) === prev.sig)) || g[0]
      // Une copie EXACTE (même contenu) est la MÊME archive (doublon local) : elle garde l'identité de son
      // original — jamais deux identifiants pour une seule archive (elle serait comptée deux fois).
      const sigAncre = sig({ ...ancre })
      const idParSig = new Map()
      for (const h of g) {
        if (h === ancre) continue
        const s = sig({ ...h })
        if (s === sigAncre) continue
        if (!idParSig.has(s)) idParSig.set(s, newUid())
        h._archiveId = idParSig.get(s)
      }
    }
  }

  // JOURNAL : une entrée écrite ailleurs (« Modifier le bail », avenant) ne connaît pas la ligne propre de
  // son bail. Avant son PREMIER envoi, on y reporte le `_bailUid` du bail concerné (même logement, même
  // signature, même espace) → bail_id vise la bonne ligne. Une entrée déjà synchronisée n'est jamais retouchée.
  function _rattacherJournal(db) {
    const j = Array.isArray(db && db.baux_evenements) ? db.baux_evenements : null
    if (!j || !j.length) return
    const base = baseline.get('baux_evenements')
    const baux = Object.entries((db && db.baux) || {})
    for (const e of j) {
      if (!e || typeof e !== 'object' || isDeleted(e)) continue
      // AVENANT (registre, lot 2) : il peut viser un bail NON signé, neuf ou successeur, dont la ligne propre
      // n'existe pas encore (uid posé par _identifierBaux dans ce même flush) ou dont l'uid recopié est celui
      // du bail précédent. Avant le 1er envoi, on recale TOUJOURS sur le bail vivant (même logement, même
      // début, même espace) : son uid, ou la ligne historique s'il n'en a pas (audit lot 2, I1).
      // MANQUE ACCEPTÉ (FINANCES-SUIVI-V2) : même chemin. Il vise un bail par son DÉBUT, sans signature (`signedAt`
      // absent : sinon le chemin « modification » le prendrait pour une modification du document signé). Bail courant
      // → sa ligne ; bail ARCHIVÉ (aucun bail vivant de ce début) → l'uid posé à la création est conservé.
      if (e.type === 'avenant' || e.type === 'manque_accepte') {
        if (base && base.has(String(e.id) + espTag(e))) continue
        // Bail réécrit juste avant (« Modifier le bail » : `DB.baux[ref] = {…}`) → il a perdu son tag d'espace
        // jusqu'à _adoptAll, et l'avenant créé entre-temps est parti SANS espace. Un seul bail candidat (même
        // logement, même début) et tagué : l'entrée prend son espace avant le 1er envoi (contre-audit lot 2, N1).
        if (e._espaceId == null) {
          const cands = baux.filter(([k, b]) => b && typeof b === 'object' && !isDeleted(b) && String(k).split('@@')[0] === String(e.ref || '').split('@@')[0]
            && String(b.debut || '').slice(0, 10) === String(e.bailDebut || '').slice(0, 10))
          if (cands.length === 1 && cands[0][1]._espaceId != null) e._espaceId = cands[0][1]._espaceId
        }
        const t = baux.find(([k, b]) => b && typeof b === 'object' && !isDeleted(b) && String(k).split('@@')[0] === String(e.ref || '').split('@@')[0]
          && String(b.debut || '').slice(0, 10) === String(e.bailDebut || '').slice(0, 10) && (b._espaceId || null) === (e._espaceId || null))
        if (t) { if (t[1]._bailUid) e.bailUid = t[1]._bailUid; else delete e.bailUid }
        continue
      }
      // Même réparation d'ESPACE pour une modification pas encore envoyée (« Modifier le bail », avenant signé —
      // audit lot 3a, M7) : bail réécrit juste avant, momentanément sans tag → l'entrée prend l'espace de
      // l'unique bail signé correspondant (même logement, même signature).
      if (e._espaceId == null && e.signedAt && !(base && base.has(String(e.id) + espTag(e)))) {
        const cands = baux.filter(([k, b]) => b && typeof b === 'object' && !isDeleted(b) && String(k).split('@@')[0] === String(e.ref || '').split('@@')[0]
          && b.signatures && b.signatures.signedAt === e.signedAt)
        if (cands.length === 1 && cands[0][1]._espaceId != null) e._espaceId = cands[0][1]._espaceId
      }
      if (e.bailUid || !e.signedAt) continue
      if (base && base.has(String(e.id) + espTag(e))) continue
      const t = baux.find(([k, b]) => b && typeof b === 'object' && !isDeleted(b) && b._bailUid && String(k).split('@@')[0] === e.ref
        && b.signatures && b.signatures.signedAt === e.signedAt && (b._espaceId || null) === (e._espaceId || null))
      if (t) { e.bailUid = t[1]._bailUid; continue }
      // Audit v15.690 (I2) : le bail a pu être clôturé / remplacé AVANT le 1er envoi de l'entrée → sa ligne
      // est celle du BASELINE (même logement, même signature, même espace). Sans uid nulle part → ligne historique.
      const bb = baseline.get('baux')
      if (bb) for (const [bk, v] of bb) {
        const r = v.rec
        if (r && r._bailUid && String(r.__key || bk).split('@@')[0] === e.ref && v.sAt === e.signedAt && (r._espaceId || null) === (e._espaceId || null)) { e.bailUid = r._bailUid; break }
      }
    }
  }

  // VIE D'UN BAIL SIGNÉ VERROUILLÉ → JOURNAL AUTOMATIQUE. La ligne signée n'est jamais réécrite : tout
  // écart entre l'état synchronisé (baseline + journal réappliqué) et l'état vivant — révision IRL, départ,
  // dépôt de garantie, pièces de signature posées après scellement… (liste fermée, bail-modifications.js)
  // — devient UNE entrée `baux_evenements` (source 'auto'), envoyée dans ce même flush et réappliquée au
  // chargement sur tous les appareils. Idempotent : l'entrée présente, l'écart disparaît.
  function _journaliserVerrouilles(db) {
    const base = baseline.get('baux')
    const faits = []
    if (!base || !base.size) return faits
    for (const [k, bail] of Object.entries((db && db.baux) || {})) {
      if (!bail || typeof bail !== 'object' || isDeleted(bail)) continue
      const dk = _bauxKey(k), prev = base.get(dk)
      if (!prev || !prev.locked) continue
      if (!bail.signatures || !prev.sAt || bail.signatures.signedAt !== prev.sAt) continue   // successeur : phase 0
      if (prev.sig === sig({ __key: k, ...bail })) continue                                   // rien n'a bougé
      const reference = JSON.parse(prev.sig); delete reference.__key                           // état synchronisé, copie PROFONDE
      const d = now(); const date = (d instanceof Date ? d : new Date(d)).toISOString()
      const e = entreeJournalAuto(k, bail, reference, db.baux_evenements || [], { date, id: 'bja_' + newUid() })
      if (!e) continue
      if (!Array.isArray(db.baux_evenements)) db.baux_evenements = []
      db.baux_evenements.push(e)
      faits.push({ coll: 'baux', key: dk, id: e.id })
    }
    return faits
  }

  // _doFlush : diffe le DB courant vs baseline, applique upserts (parent→enfant) puis removes
  // (enfant→parent), met à jour le baseline sur succès uniquement. Renvoie un résumé.
  // ⚠️ NE PAS appeler directement (réentrance) → passer par flush() qui SÉRIALISE.
  //
  // 🛡 FLUSH BLINDÉ (audit sync cloud 2026-07-12, cause C-A) : un throw du store (CHECK 23514, RLS
  // 42501, réseau…) est un ÉCHEC PAR ENREGISTREMENT (summary.errors, baseline non avancé → retenté),
  // JAMAIS un abort global. Bug réel : le 12/07, UN insert documents refusé a tué 100 % de la sync
  // une journée entière (removes + config jamais tentés), en silence. Seul sealSignedBaux reste
  // hors isolation À DESSEIN (fail-closed légal : ne jamais pousser un bail signé non scellé).
  const _errMsg = e => (e && e.message) || String(e)
  async function _doFlush(db) {
    const summary = { upserts: [], revives: [], removes: [], archives: [], journalises: [], conflicts: [], skipped: [], errors: [], deferred: [] }
    if (sealSigned) await sealSignedBaux(db)            // VERROU (pièce 2) — gouverné par l'option sealSigned (false en phase test)
    const suspended = _adoptAll(db)                     // D1b : réadoption des tags AVANT le snapshot (+ clés ambiguës → removes suspendus)
    // B2 : identités (baux, archives en collision), journal rattaché à sa ligne, vie des baux verrouillés
    // journalisée — TOUT avant le snapshot, qui voit ainsi l'état complet à envoyer.
    _identifierBaux(db)
    _identifierArchives(db)
    _rattacherJournal(db)
    summary.journalises = _journaliserVerrouilles(db)
    const current = snapshotOf(db)

    // 0) BAUX QUI CESSENT D'ÊTRE LE BAIL COURANT — AVANT les upserts : le serveur n'admet qu'un bail courant
    //    par logement (index baux_one_active_per_logement), l'ancienne ligne doit s'effacer d'abord.
    //    • ligne VERROUILLÉE (bail signé) : ARCHIVÉE (migration 0055) — clôture, suppression, relocation,
    //      réinitialisation des signatures. La ligne signée reste au cloud, intacte : c'est la preuve ;
    //    • ligne NON verrouillée remplacée par un bail d'une AUTRE identité : suppression logique. (Un simple
    //      retrait d'un bail non verrouillé reste en phase 2, inchangé.)
    //    Échec → le successeur n'est PAS envoyé dans ce flush (il heurterait l'index) : il repartira avec
    //    l'ancienne ligne. L'échec lui-même est déjà tracé (conflit / erreur / en attente).
    const bloques = new Set()
    {
      const cur = current.get('baux'), base = baseline.get('baux'), susp = suspended.get('baux')
      for (const [k, prev] of [...base]) {
        const c = cur.get(k)
        const successeur = !!c && _uidDe(c.rec) !== _uidDe(prev.rec)
        if (c && !successeur) { _removeConflicts.delete(_rcKey('baux', k)); continue }   // contre-audit m-3 : bail revenu → trace d'échec d'archivage effacée
        if (!c && !prev.locked) continue                  // retrait ordinaire non signé → phase 2
        if (susp && susp.has(_bareKey(_bauxKeyFn, prev.rec))) { if (c) bloques.add(k); continue }   // D1b : jamais sur devinette
        const archiver = prev.locked
        let res
        try {
          if (archiver && typeof store.archive !== 'function') res = { status: 'skipped' }
          else res = archiver ? await store.archive('baux', prev.rec) : await store.remove('baux', prev.rec)
        } catch (e) {
          summary.errors.push({ op: archiver ? 'archive' : 'remove', coll: 'baux', key: k, message: _errMsg(e) })
          _removeConflicts.add(_rcKey('baux', k))   // audit I3 : échec persistant → plus de flush IMMÉDIAT à chaque enregistrement (retry par backoff)
          if (c) bloques.add(k)
          continue
        }
        const st = res && res.status
        if (st === (archiver ? 'archived' : 'deleted')) {
          base.delete(k); _removeConflicts.delete(_rcKey('baux', k))
          ;(archiver ? summary.archives : summary.removes).push({ coll: 'baux', key: k })
        } else {
          if (c) bloques.add(k)
          if (st === 'conflict') { _removeConflicts.add(_rcKey('baux', k)); summary.conflicts.push({ coll: 'baux', key: k }) }
          else { _removeConflicts.add(_rcKey('baux', k)); summary.skipped.push({ coll: 'baux', key: k }) }   // audit I3 : idem
        }
      }
    }

    // 1) upserts (ajouts + modifs), dans l'ordre parent→enfant.
    for (const { coll } of COLLECTIONS) {
      const cur = current.get(coll), base = baseline.get(coll)
      for (const [k, { rec, sig: s, locked: curLocked, sAt: curSAt }] of cur) {
        const prev = base.get(k)
        if (prev && prev.sig === s) continue               // inchangé
        if (coll === 'baux' && bloques.has(k)) continue    // successeur en attente de l'archivage de l'ancienne ligne (phase 0)
        // VERROU : une ligne DÉJÀ verrouillée au baseline (`prev.locked`, figé au snapshot précédent) est
        // immuable → jamais ré-upsertée (le trigger refuserait → conflit). La 1ʳᵉ transition false→true
        // (baseline NON verrouillé) passe : c'est elle qui POSE le verrou. Ses modifications ultérieures
        // ne sont PAS perdues : _journaliserVerrouilles les a mises dans le journal (baux_evenements).
        if (prev && prev.locked) continue
        // B-REBAIL : `allowRevive` = INTENTION explicite de ré-ouvrir un tombstone. Vrai UNIQUEMENT pour un
        // AJOUT FRAIS (`!prev` — clé absente du baseline : relocation, ou record neuf), jamais pour une
        // ÉDITION (prev défini). Le store ne revive que sur ce signal → une édition périmée d'un record
        // supprimé ailleurs reste un conflit (anti-résurrection fail-closed, classe « Delle b »).
        let res
        try { res = await store.upsert(coll, rec, { allowRevive: !prev }) }
        catch (e) { summary.errors.push({ op: 'upsert', coll, key: k, message: _errMsg(e) }); continue }   // poison isolé → retry
        const st = res && res.status
        // 'revived' (B-REBAIL) = succès d'écriture MAIS tracé À PART (summary.revives) : un revive = une
        // ré-ouverture délibérée d'un slot (relocation / clé naturelle recréée), événement notable sur un
        // chemin juridiquement sensible → visible dans les logs/l'indicateur de sync, pas noyé dans les upserts.
        if (OK_UPSERT.has(st)) { base.set(k, { rec, sig: s, locked: curLocked, sAt: curSAt }); if (coll === 'baux' && rec._bailUid) _uidsEnAttente.delete(rec._bailUid);   // sAt : la signature suit le baseline (sinon un bail tout juste scellé passerait pour un successeur)
          (st === 'revived' ? summary.revives : summary.upserts).push({ coll, key: k }) }
        else if (st === 'conflict') summary.conflicts.push({ coll, key: k })   // baseline inchangé → retry
        else if (st === 'deferred') summary.deferred.push({ coll, key: k })    // table pas encore au cloud (0057) : baseline inchangé, SANS réessai
        else summary.skipped.push({ coll, key: k })                            // skipped (FK non résolue) → retry
      }
    }

    // 2) removes (présents au baseline, absents du courant), dans l'ordre enfant→parent.
    for (let i = COLLECTIONS.length - 1; i >= 0; i--) {
      const { coll, key } = COLLECTIONS[i]
      const cur = current.get(coll), base = baseline.get(coll)
      const susp = suspended.get(coll)
      for (const [k, { rec, locked }] of [...base]) {
        if (cur.has(k)) continue
        if (locked) continue                               // VERROU : un signé verrouillé ne se supprime JAMAIS — il s'archive (phase 0)
        // D1b (audit réserve 1) : un jumeau VIVANT non résolu (ambiguïté d'homonymie) porte cette
        // clé nue → remove SUSPENDU (fail-safe : jamais de destruction sur devinette ; converge à
        // la prochaine re-hydrate qui re-tague tout).
        if (susp && susp.has(_bareKey(key, rec))) continue
        let res
        try { res = await store.remove(coll, rec) }        // l'ANCIEN rec → résout l'id de ligne
        catch (e) { summary.errors.push({ op: 'remove', coll, key: k, message: _errMsg(e) }); continue }
        const st = res && res.status
        if (st === 'deleted') { base.delete(k); _removeConflicts.delete(_rcKey(coll, k)); summary.removes.push({ coll, key: k }) }
        else if (st === 'conflict') { _removeConflicts.add(_rcKey(coll, k)); summary.conflicts.push({ coll, key: k }) }   // M2 : mémorisé → plus de flush immédiat pour cette clé
        else if (st === 'deferred') summary.deferred.push({ coll, key: k })     // idem upsert : différé sans réessai
        else summary.skipped.push({ coll, key: k })
      }
    }

    // 3) config (collections non-tablées) → un seul blob espace_config, si changé. Une erreur est
    // ISOLÉE (config='error') et n'avance PAS _configSig → réessai au prochain flush. Le 12/07, la
    // config était en DERNIER derrière le throw global → jamais écrite de la journée ; plus maintenant.
    if (typeof store.persistConfig === 'function') {
      const cs = configSig(db)
      if (cs !== _configSig) {
        try {
          const r = await store.persistConfig(db)
          // Fusion à trois voies (lot B) : le DB vivant a pu recevoir le résultat fusionné → signature recalculée.
          // Après une fusion, la signature n'est PAS avancée : une saisie faite pendant l'attente réseau (laissée
          // intacte par la réinjection) repartira au flush suivant ; sans saisie, la config égale la base → rien n'est réécrit.
          _configSig = (r && r.status === 'config-merged') ? null : cs
          summary.config = !r || r.status === 'config-written' ? 'written'
            : r.status === 'config-merged' ? (r.ecrit === false ? 'merged-local' : 'merged') : 'unchanged'
          if (r && Array.isArray(r.conflits) && r.conflits.length) summary.configConflits = r.conflits.slice()
        }
        catch (e) { summary.config = 'error'; summary.errors.push({ op: 'config', coll: 'config', key: 'espace_config', message: _errMsg(e) }) }
      }
    }
    return summary
  }

  // 🔁 RETRY BACKOFF (P1.2) : un flush avec des échecs RETENTABLES (errors = throws isolés, skipped =
  // FK pas encore résolue, config en erreur) re-programme un flush via le scheduler injecté, avec un
  // délai qui DOUBLE à chaque échec consécutif (2 s → 60 s max), remis à zéro au premier flush propre.
  // Les CONFLITS de version sont EXCLUS à dessein : retenter à l'identique est une boucle éternelle
  // (audit C-A) — leur résolution est « conflit → re-hydrate » (P1 item 2, chantier séparé).
  // Le scheduler de l'app reçoit { retryDelayMs } et remplace son debounce ; sans scheduler (tests,
  // restauration __immoFlush), aucun retry automatique.
  const _hasRetryable = s => !!(s && ((s.errors && s.errors.length) || (s.skipped && s.skipped.length) || s.config === 'error'))
  let _failStreak = 0

  // flush : SÉRIALISE les flush (anti-réentrance, audit C2). Un flush en vol n'est jamais doublé ; un
  // flush demandé pendant un autre attend la fin du précédent → lit `_versions`/baseline À JOUR (pas
  // de conflit de concurrence interne, donc pas de perte de modif quand 2 saves se chevauchent). Le DB
  // est relu (getDB) au moment où le run démarre → état frais. db explicite (tests) respecté.
  let _chain = Promise.resolve()
  function flush(db) {
    const p = _chain
      .then(() => _doFlush(db !== undefined ? db : getDB()))
      .then(s => {   // retry AVANT de rendre la main (déterministe : `await flush()` ⇒ retry déjà programmé)
        if (_hasRetryable(s)) {
          _failStreak++
          if (typeof schedule === 'function') schedule(() => flush(), { retryDelayMs: Math.min(retryBaseMs * 2 ** (_failStreak - 1), retryMaxMs) })
        } else {
          _failStreak = 0
          // ARCHIVE AVANT SCEAU (audit O1) : un bail signé en présence attend la fin de l'archive pour être
          // scellé. Sans nouvel enregistrement, aucun flush ne reviendrait à l'expiration du délai de garde
          // → le verrou ne serait posé qu'au prochain enregistrement. On programme ce flush.
          const reste = attenteArchiveRestante(db !== undefined ? db : getDB())
          // `delayMs` (pas `retryDelayMs`) : ce n'est pas un réessai → pas de plancher de backoff côté app.
          if (reste != null && typeof schedule === 'function') schedule(() => flush(), { delayMs: reste })
        }
        return s
      })
    _chain = p.catch(() => {})   // la chaîne survit aux erreurs (un flush qui throw ne bloque pas les suivants)
    return p
  }

  // 🗑 SUPPRESSION = FLUSH IMMÉDIAT (P1.2) : une suppression en attente est le diff le plus fragile
  // (diff d'absence + debounce 800 ms + fermeture d'onglet = remove jamais parti, cf. « Delle b »).
  // markDirty détecte un remove pendable (clé au baseline, absente du courant vivant, hors baux
  // verrouillés — qui ne se suppriment jamais → anti-boucle) et demande au scheduler un flush
  // IMMÉDIAT ({ immediate: true }) au lieu du debounce.
  function _hasPendingRemoves(db) {
    // D1b : réadoption AVANT keying — sinon un record tiers reconstruit sans tag (clé nue ≠
    // clé@@tiers du baseline) serait vu comme un remove pendable → flush immédiat parasite ;
    // et les clés ambiguës (removes suspendus au flush) ne sont pas non plus pendables.
    const suspended = _adoptAll(db)
    for (const { coll, enumerate, key } of COLLECTIONS) {
      const base = baseline.get(coll)
      if (!base || base.size === 0) continue
      const susp = suspended.get(coll)
      let live = null   // Set des clés vivantes, construit PARESSEUSEMENT (uniquement si baseline non vide)
      for (const [k, v] of base) {
        // Bail signé verrouillé retiré (clôture, suppression) : son ARCHIVAGE est aussi fragile qu'une
        // suppression (onglet fermé = bail ressuscité ailleurs) → flush immédiat lui aussi (B2). Les autres
        // collections verrouillées (EDL) ne se retirent toujours pas → anti-boucle inchangé.
        if (v.locked && coll !== 'baux') continue
        if (_removeConflicts.has(_rcKey(coll, k))) continue   // M2 : dernier essai = conflit → debounce normal (anti-neutralisation)
        if (susp && susp.has(_bareKey(key, v.rec))) continue  // D1b : remove suspendu (jumeau vivant non résolu)
        if (live === null) { live = new Set(); for (const rec of enumerate(db)) { if (!isDeleted(rec)) live.add(key(rec)) } }
        if (!live.has(k)) return true
      }
    }
    return false
  }

  // markDirty : programme un flush debouncé (le scheduler injecté gère le délai côté app) ;
  // immédiat si une suppression est en attente (cf. _hasPendingRemoves).
  function markDirty() {
    if (typeof schedule !== 'function') return undefined
    let immediate = false
    try { immediate = _hasPendingRemoves(getDB()) } catch (_e) { /* détection best-effort : au pire, debounce normal */ }
    schedule(() => flush(), immediate ? { immediate: true } : undefined)
    return undefined
  }

  return { seed, flush, markDirty }
}
