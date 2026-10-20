// js/core/store-mapping.js — Mapping LEGACY → ligne de table relationnelle (pur).
//
// Fondation partagée de la direction ÉCRITURE du Store Supabase (P3) ET de l'ETL d'import :
// transforme un enregistrement au format legacy (objet du DB en mémoire) en une ligne de la
// table cible (colonnes typées + jsonb + legacy_id + legacy_raw). Fonctions PURES.
//
// ctx (injecté) :
//   espaceId, ownerId : valeurs posées sur chaque ligne.
//   detUuid(...parts) : uuid déterministe (même (collection,clé) → même uuid → upsert idempotent).
//   entiteByNom / immeubleByNom / logementByRef : Map PLATE clé(legacy)→uuid (resolvers FK).
//     ⚠️ `.get(clé)` renvoie DIRECTEMENT l'uuid (PAS un objet {uuid,…}). Construites depuis le
//     DB en mémoire au runtime (ou depuis l'export à l'import).
//   documentByLegacy : Map (legacy doc id) → uuid (pour pj_document_id).
//
// Renvoie la ligne (objet col→valeur) ou `null` si une colonne NOT NULL ne peut être remplie
// (résolution FK manquante, champ requis absent) → l'appelant SKIP + journalise.

const norm = s => String(s == null ? '' : s).trim().toLowerCase()
const num = x => { if (x == null || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null }
// jsonb : passer la VALEUR telle quelle (objet/array/null). supabase-js (PostgREST) l'encode en jsonb ;
// pré-stringifier ici la doublerait (la colonne jsonb recevrait une string "{…}" au lieu d'un objet,
// → hydrate relirait une string). NB : l'ETL pg a son propre jb (stringify, correct pour node-postgres
// qui parse le texte en jsonb) ; ici c'est le chemin APP via supabase-js.
const jb = x => (x == null ? null : x)
function ts(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') { const ms = v > 1e11 ? v : v > 1e9 ? v * 1000 : null; return ms ? new Date(ms).toISOString() : null }
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) { const d = new Date(v); return isNaN(d) ? null : d.toISOString() }
    if (/^\d{9,13}$/.test(v)) { const n = +v, ms = n > 1e11 ? n : n * 1000; return new Date(ms).toISOString() }
    const d = new Date(v); return isNaN(d) ? null : d.toISOString()
  }
  return null
}
const dateOnly = v => { const i = ts(v); return i ? i.slice(0, 10) : (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null) }
// `_espaceId` = tag de provenance posé par le Store multi-espace (store-multi.js) sur les enregistrements
// vivants. Détail d'implémentation côté app : on le RETIRE de legacy_raw pour ne pas polluer la donnée
// persistée (et éviter qu'un tag périmé y subsiste si un enregistrement changeait d'espace). L'hydrate
// ne le lit jamais (le Store multi le re-pose). NB : `__key`/`__entiteNom`/`__immeubleNom` sont conservés
// (load-bearing : l'hydrate reconstruit la map baux et les FK depuis ces clés dans legacy_raw).
const stripTag = o => { if (!o || typeof o !== 'object' || o._espaceId == null) return o; const { _espaceId, ...rest } = o; return rest }
// BIENS étapes 5/6 — colonnes TYPÉES des deux clauses de bail générées depuis la fiche du bien
// (`edl_template` = la liste de pièces, `parties_communes` et `pieces_desc` = les surcharges).
// Elles arrivent avec la migration 0046_logements_clauses_bail.sql.
//
// INTERRUPTEUR VOLONTAIRE : PostgREST refuse une colonne inconnue (PGRST204) — émettre ces clés
// AVANT que 0046 soit appliquée à la base ferait ÉCHOUER TOUTE écriture de logement. Tant que le
// feu vert d'application n'est pas donné, on ne les émet pas. AUCUNE DONNÉE N'EST PERDUE pour
// autant : `legacy_raw` (juste en dessous) embarque l'enregistrement legacy ENTIER, edlTemplate et
// partiesCommunes compris, et l'hydrate reconstruit le DB depuis legacy_raw (js/core/store-supabase.js).
// Les colonnes typées servent l'ETL relationnel et les requêtes SQL, pas la fidélité de l'app.
//
// À BASCULER À `true` DANS LA MÊME PASSE QUE L'APPLICATION DE 0046 — pas avant, pas après.
const COLONNES_CLAUSES_BAIL_0046 = false
const clausesBail = o => (COLONNES_CLAUSES_BAIL_0046
  ? { pieces_desc: jb(o.piecesDesc ?? null), parties_communes: o.partiesCommunes ?? null, edl_template: jb(o.edlTemplate ?? null) }
  : {})

const base = (o, ctx) => ({ espace_id: ctx.espaceId, created_by: ctx.ownerId, legacy_raw: jb(stripTag(o)) })

// IDENTITÉ D'UNE LIGNE `baux` (chantier clôture/relocation, 28/09). Historiquement UNE ligne par
// logement (detUuid('bail', ref)) : un bail signé verrouillé occupait donc le logement pour toujours.
// Désormais un bail peut porter `_bailUid` (posé par store-sync au premier envoi d'un bail NEUF ou d'un
// SUCCESSEUR d'un bail signé) → sa propre ligne. Sans `_bailUid` (tous les baux existants) : l'id
// historique, inchangé → aucune migration des lignes en place. SOURCE UNIQUE : la ligne du bail, la
// clé de rattachement RLS d'un document « bail » et le bail_id d'une entrée de journal passent ici.
export const bailLigneCle = (ref, uid) => norm(ref) + (uid ? '|' + String(uid) : '')
// Idem pour une archive `baux_historique` : `_archiveId` n'est posé qu'en cas de COLLISION (deux
// archives du même logement le même jour — la clé historique `ref|_archivedAt` les confondait).
// Identifiant UNIQUE d'une archive de bail (`_archiveId`) — et générateur d'uid de la synchro (store-sync) : UNE source.
// Posé DÈS l'archivage par l'app (deux archives d'un lot le même jour ne partagent plus leur clé) ; store-sync
// (_identifierArchives) ne réécrit jamais un `_archiveId` déjà posé.
export const nouvelIdArchive = () => {
  try { if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID() } catch (_e) { /* repli */ }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
}
export const bailHistCle = o => String(o.ref ?? '') + '|' + (o._archivedAt ?? '') + (o._archiveId ? '|' + String(o._archiveId) : '')

const MAPPERS = {
  entites(o, ctx) {
    if (!o.nom || !String(o.nom).trim()) return null
    return { id: ctx.detUuid('entite', norm(o.nom)), legacy_id: String(o.id ?? ''), nom: o.nom, type: o.type ?? null, siren: o.siren ?? null, rcs: o.rcs ?? null, gerant: o.gerant ?? null, gerants: jb(o.gerants ?? []), siege: o.siege ?? null, iban: o.iban ?? null, bic: o.bic ?? null, email_envoi: o.emailEnvoi ?? null, signature: jb(o.signature ?? null), logo: o.logo ?? null, drive_folder_id: o.driveFolderId ?? null, ...base(o, ctx) }
  },
  immeubles(o, ctx) {
    const ent = ctx.entiteByNom.get(norm(o.__entiteNom)); if (!ent) return null
    if (!o.nom || !String(o.nom).trim()) return null
    return { id: ctx.detUuid('immeuble', norm(o.nom)), entite_id: ent, legacy_id: String(o.id ?? ''), nom: o.nom, adresse: o.adr ?? null, ...base(o, ctx) }
  },
  logements(o, ctx) {
    const ent = ctx.entiteByNom.get(norm(o.entity)); if (!ent) return null
    if (!o.ref || !String(o.ref).trim()) return null
    const imm = o.imm ? ctx.immeubleByNom.get(norm(o.imm)) : null
    return { id: ctx.detUuid('logement', norm(o.ref)), entite_id: ent, immeuble_id: imm ?? null, legacy_id: String(o.id ?? ''), ref: o.ref, type: o.type ?? null, type_usage: o.typeUsage ?? null, surface: num(o.surf), etage: o.etage ?? null, num_apt: o.numApt ?? null, adresse: o.adr ?? null, npp: o.npp ?? null, ...clausesBail(o), tantiemes: o.tantiemes != null ? String(o.tantiemes) : null, lot: o.lot ?? null, num_fiscal: o.numFiscal ?? null, loyer_hc_ref: num(o.loyerHcRef), charges_ref: num(o.chargesRef), chauffage: jb(o.chauffage ?? null), ecs: jb(o.ecs ?? null), diagnostics: jb(o.diagnostics ?? null), equipements: jb(o.equipements ?? null), mobilier: jb(o.mobilier ?? null), presentation: jb(o.presentation ?? null), drive_folders: jb(o.driveFolders ?? null), legacy_bail: jb({ locataire: o.locataire ?? null, hc: o.hc ?? null, ch: o.ch ?? null, dg: o.dg ?? null, irl: o.irl ?? null, debut: o.debut ?? null, fin: o.fin ?? null }), ...base(o, ctx) }
  },
  documents(o, ctx) {
    let pid = null
    if (o.parentType === 'logement') pid = ctx.logementByRef.get(norm(o.parentRef)) || (o.logRef ? ctx.logementByRef.get(norm(o.logRef)) : null)
    else if (o.parentType === 'immeuble') pid = ctx.immeubleByNom.get(norm(o.parentRef)) || null
    else if (o.parentType === 'entite') pid = ctx.entiteByNom.get(norm(o.parentRef)) || null
    else if (o.parentType === 'mouvement') pid = o.parentId != null ? ctx.detUuid('mouvement', String(o.parentId)) : null
    // TRAVAUX : QUI PAIE ? — pièce du dossier de preuves d'un incident : parent_id = ligne incident ; le résolveur
    // RLS (entite_of_document, 0057) lit l'entité sur cette ligne (logement, sinon immeuble, sinon SCI).
    else if (o.parentType === 'incident') pid = o.parentId != null ? ctx.detUuid('incident', String(o.parentId)) : null
    // D3 — ÉCRITURE MEMBRE SCOPÉ : parent_id des types réellement émis par l'app mais laissés NULL avant
    // (→ entité NULL dans entite_of_document → has_entite_write faux → 42501 → sync du gestionnaire scopé
    // empoisonnée, réserve consignée de l'audit 0040). parent_id est PUREMENT une clé de résolution RLS :
    // l'hydrate reconstruit le document depuis legacy_raw, PAS depuis cette colonne → le fixer ne change
    // jamais le document rendu par l'app (aucun risque sur les lignes existantes ; c'est fail-closed →
    // ouvert, jamais l'inverse). Un membre PLEIN passait déjà (has_entite_write court-circuite is_full_*).
    // 'bail' : keyé par la ref logement (parentRef) → id de ligne bail → résolveur entite_of_bail EXISTANT.
    // (bail à `_bailUid` : le résolveur `bailUidByRef` donne la ligne du bail COURANT du logement ;
    // absent → id historique — même entité dans les deux cas, seule compte la résolution RLS.)
    else if (o.parentType === 'bail') pid = o.parentRef ? ctx.detUuid('bail', bailLigneCle(o.parentRef, ctx.bailUidByRef && ctx.bailUidByRef.get(norm(o.parentRef)))) : null
    // assurance/mrh/equipement/quittance/candidat : résolus VIA LE LOGEMENT (logRef) → parent_id = uuid de
    // ligne logement ; le résolveur RLS fait entite_of_logement(parent_id). logRef absent/inconnu (candidat
    // rattaché à une SCI sans bien précis, saisie libre) → null → fail-closed (owner-only), jamais un throw.
    else if (o.parentType === 'assurance' || o.parentType === 'mrh' || o.parentType === 'equipement' || o.parentType === 'quittance' || o.parentType === 'candidat')
      pid = o.logRef ? (ctx.logementByRef.get(norm(o.logRef)) || null) : null
    return { id: ctx.detUuid('document', String(o.id)), legacy_id: String(o.id ?? ''), name: o.name ?? null, mime: o.mime ?? null, size: num(o.size), idb_key: o.idbKey ?? null, drive_file_id: o.driveFileId ?? null, parent_type: o.parentType ?? null, parent_id: pid, ...base(o, ctx) }
  },
  mouvements(o, ctx) {
    const d = dateOnly(o.date); if (!d) return null
    let log = null, ent = null; const q = String(o.qui ?? '')
    if (q.startsWith('SCI:')) ent = ctx.entiteByNom.get(norm(q.slice(4))) || null
    else log = ctx.logementByRef.get(norm(q)) || null
    const imm = o.imm ? ctx.immeubleByNom.get(norm(o.imm)) || null : null
    const pj = o.pjId != null && ctx.documentByLegacy.has(String(o.pjId)) ? ctx.documentByLegacy.get(String(o.pjId)) : null
    return { id: ctx.detUuid('mouvement', String(o.id)), legacy_id: String(o.id ?? ''), date_mouvement: d, libelle: o.lib ?? null, immeuble_id: imm, categorie: o.cat ?? null, logement_id: log, entite_id: log ? null : ent, debit: num(o.db) ?? 0, credit: num(o.cr) ?? 0, facture: o.fac ?? null, compteur_cc_id: o.compteurCcId ?? null, pj_document_id: pj, ...base(o, ctx) }
  },
  quittances(o, ctx) {
    const log = ctx.logementByRef.get(norm(o.logement)); if (!log) return null
    if (!o.mois) return null
    return { id: ctx.detUuid('quittance', String(o.id)), legacy_id: String(o.id ?? ''), logement_id: log, entite_id: ctx.entiteByNom.get(norm(o.entity)) || null, locataire: o.locataire ?? null, mois: o.mois, hc: num(o.hc) ?? 0, ch: num(o.ch) ?? 0, date_paiement: dateOnly(o.datePaiement), date_quittance: dateOnly(o.date), ...base(o, ctx) }
  },
  baux(o, ctx) {
    const log = ctx.logementByRef.get(norm(o.__key)); if (!log) return null
    const sig = o.signatures && o.signatures.signedAt ? o.signatures : null
    // VERROU LÉGAL (P0-C1) : provenance + empreinte canonique + verrou, depuis bail.signatures.
    // `locked` n'est posé QUE si la contrainte CHECK est satisfiable (source présente ; immotrack⇒hash)
    // → robuste à l'ordre de déploiement : un signé dont le content_hash n'est pas encore calculé se
    //   synchronise NON verrouillé (pas de violation CHECK), puis se verrouille à la sync suivante.
    const sg = o.signatures || {}
    const hash = sg.contentHashTerms ?? null
    // src NORMALISÉ à la liste autorisée (CHECK baux_signature_source_chk) : une valeur inattendue
    // (corruption amont / mode futur) → null, plutôt que la propager et faire boucler le flush sur 23514.
    const rawSrc = (sg.signatureSource === 'immotrack' || sg.signatureSource === 'externe') ? sg.signatureSource : null
    // CHECK baux_immotrack_hash_chk (migration 0015) = INCONDITIONNEL : signature_source='immotrack' ⇒
    // content_hash NOT NULL (le `locked` n'entre PAS dans la contrainte). Un signé 'immotrack' dont
    // l'empreinte n'est pas encore calculée (sealSignedBaux pas passé) DÉGRADE donc source→null pour rester
    // CHECK-safe (sinon 23514 → ligne poison retentée en boucle, jamais poussée : bug D4 audit 2026-07-15).
    // Il se re-synchronisera 'immotrack'+hash+locked au flush suivant, une fois scellé. ('externe' n'exige
    // aucun hash : la contrainte ne vise que 'immotrack'.)
    const src = (rawSrc === 'immotrack' && hash == null) ? null : rawSrc
    const locked = !!sg.locked && src != null && (src !== 'immotrack' || hash != null)
    return { id: ctx.detUuid('bail', bailLigneCle(o.__key, o._bailUid)), legacy_ref: o.__key, logement_id: log, entite_id: ctx.entiteByNom.get(norm(o.entity)) || null, type_bail: null, hc: num(o.hc), ch: num(o.ch), dg: num(o.dg), jour_paiement: num(o.jpay), date_debut: dateOnly(o.debut), date_fin: dateOnly(o.fin), date_fin_effective: dateOnly(o.finEffective), locataires: jb(o.locataires ?? []), garants: jb(o.signataires ?? null), signatures: jb(o.signatures ?? null), signed_at: sig ? ts(sig.signedAt) : null, content_hash: hash, signature_source: src, locked, notes: o.notes ?? null, quitt_auto_gen: !!o.quittAutoGen, ...base(o, ctx) }
  },
  baux_historique(o, ctx) {
    // archived_at est NOT NULL ; fallback déterministe (jamais null, jamais clock-dépendant) —
    // identique à l'ETL import.mjs. La CLÉ d'id reste `ref|_archivedAt??''` (matche les rows importées).
    const archived_at = ts(o._archivedAt) || ts(o._modifiedAt) || '1970-01-01T00:00:00.000Z'
    return { id: ctx.detUuid('bailhist', bailHistCle(o)), legacy_ref: o.ref ?? null, logement_id: ctx.logementByRef.get(norm(o.ref)) || null, entite_id: ctx.entiteByNom.get(norm(o.entity)) || null, archived_at, bail_snapshot: jb(o), ...base(o, ctx) }
  },
  edl(o, ctx) {
    const log = ctx.logementByRef.get(norm(o.logement)); if (!log) return null
    let te = o.type ?? o.ltype ?? null; if (te && !['Entrée', 'Sortie'].includes(te)) te = null
    const sig = o.signatures && o.signatures.signedAt ? o.signatures : null
    return { id: ctx.detUuid('edl', String(o.id)), legacy_id: String(o.id ?? ''), logement_id: log, type_edl: te, date_edl: dateOnly(o.date), identite: jb({ locataire: o.locataire ?? null, bailleur: o.bailleurNom ?? null }), pieces: jb(o.pieces ?? []), compteurs: jb(o.compteurs ?? null), compteurs_sortie: jb(o.compteursSortie ?? null), compteurs_photos: jb(o.compteursPhotos ?? null), chauffage: jb(o.chauffage ?? null), technologies: jb(o.technologies ?? null), cles: jb(o.cles ?? null), daaf: jb(o.daaf ?? null), mobilier: jb(o.mobilier ?? null), signed_at: sig ? ts(sig.signedAt) : null, signatures: jb(o.signatures ?? null), ...base(o, ctx) }
  },
  assurances(o, ctx) {
    return { id: ctx.detUuid('assurance', String(o.id)), legacy_id: String(o.id ?? ''), logement_id: ctx.logementByRef.get(norm(o.logement)) || null, compagnie: o.compagnie ?? null, num_contrat: o.numContrat ?? null, echeance: o.echeance != null ? String(o.echeance) : null, prime: num(o.prime), locataire: o.locataire ?? null, notes: o.notes ?? null, ...base(o, ctx) }
  },
  agenda(o, ctx) {
    return { id: ctx.detUuid('agenda', String(o.id)), legacy_id: String(o.id ?? ''), entite_id: ctx.entiteByNom.get(norm(o.entite)) || null, immeuble_id: ctx.immeubleByNom.get(norm(o.immeuble)) || null, logement_id: ctx.logementByRef.get(norm(o.logement)) || null, titre: o.titre ?? null, date_evt: dateOnly(o.date), date_fin: dateOnly(o.dateFin), categorie: o.cat ?? null, couleur: o.couleur ?? null, done: !!o.done, rappels: jb(o.rappels ?? null), recurrence: jb(o.recurrence ?? null), notes: o.notes ?? null, ...base(o, ctx) }
  },
  // candidat (candidature locataire). Scope par-SCI : entite_id (candidat.entity) sinon logement_id
  // (candidat.logRef) ; sinon NULL → membres pleins seulement (RLS fail-closed). Garant dans legacy_raw.
  candidats(o, ctx) {
    return { id: ctx.detUuid('candidat', String(o.id)), legacy_id: String(o.id ?? ''), entite_id: ctx.entiteByNom.get(norm(o.entity)) || null, logement_id: ctx.logementByRef.get(norm(o.logRef)) || null, ...base(o, ctx) }
  },
  // TRAVAUX : QUI PAIE ? — incident (migration 0057). Rattachements : logement (logRef), immeuble (imm, partie
  // commune), SCI (entity). RLS 0052 : un droit sur CHAQUE rattachement renseigné ; aucun → membres pleins.
  // Statut et date de signalement en colonnes (requêtes futures) ; l'app relit legacy_raw seulement.
  incidents(o, ctx) {
    const st = ['signale', 'en_cours', 'resolu'].includes(o.statut) ? o.statut : null
    return { id: ctx.detUuid('incident', String(o.id)), legacy_id: String(o.id ?? ''), entite_id: ctx.entiteByNom.get(norm(o.entity)) || null, immeuble_id: o.imm ? (ctx.immeubleByNom.get(norm(o.imm)) || null) : null, logement_id: o.logRef ? (ctx.logementByRef.get(norm(o.logRef)) || null) : null, statut: st, date_signalement: dateOnly(o.creeLe), ...base(o, ctx) }
  },
  // CIRCUIT D'UN INCIDENT — carnet d'artisans (migration 0060). Scope par SCI (artisan.entity) ; sinon NULL → membres
  // pleins seulement (RLS fail-closed). La fiche complète (métiers, contact, note privée) vit dans legacy_raw.
  artisans(o, ctx) {
    return { id: ctx.detUuid('artisan', String(o.id)), legacy_id: String(o.id ?? ''), entite_id: ctx.entiteByNom.get(norm(o.entity)) || null, ...base(o, ctx) }
  },
  // Journal des baux signés (migration 0054, table baux_evenements de 0017). Rattaché au bail par la
  // ref du logement : bail_id = même id déterministe que la ligne `baux` (detUuid('bail', ref)) ;
  // bail_debut distingue les baux successifs d'un même logement. RLS par entité via entite_of_bail.
  // Logement inconnu → null (skippé, retenté) plutôt qu'une FK violée en boucle.
  baux_evenements(o, ctx) {
    const ref = String(o.ref ?? '').split('@@')[0]
    if (!ref || !ctx.logementByRef.get(norm(ref))) return null
    const d = dateOnly(o.date); if (!d) return null
    // 'manque_accepte' (FINANCES-SUIVI-V2) : autorisé par la migration 0056 — à APPLIQUER AVANT ce client (sinon le
    // CHECK refuse l'insertion, erreur par enregistrement retentée). Tout autre type inconnu reste rangé en 'autre' ;
    // l'objet entier voyage dans legacy_raw (rien n'est perdu).
    const type = ['resiliation', 'conge', 'renouvellement', 'revision_loyer', 'autre', 'modification', 'avenant', 'manque_accepte'].includes(o.type) ? o.type : 'autre'
    // bail_id : la ligne du bail CONCERNÉ — `bailUid` (posé à la création de l'entrée, ou par store-sync)
    // pour un bail à ligne propre ; absent → ligne historique du logement (toutes les entrées existantes).
    return { id: ctx.detUuid('bailevt', String(o.id)), legacy_id: String(o.id ?? ''), bail_id: ctx.detUuid('bail', bailLigneCle(ref, o.bailUid)), type_evenement: type, date_evenement: d, bail_debut: dateOnly(o.bailDebut), ...base(o, ctx) }
  },
}

export { COLONNES_CLAUSES_BAIL_0046 }

export function mapToRow(collection, rec, ctx) {
  const m = MAPPERS[collection]
  if (!m) throw new Error('mapToRow: collection inconnue ' + collection)
  return m(rec, ctx)
}

export const MAPPED_COLLECTIONS = Object.keys(MAPPERS)
