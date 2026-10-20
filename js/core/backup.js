// js/core/backup.js — Cœur PUR de la sauvegarde de sécurité (testable, zéro DOM/réseau).
export const FREQ_MS = { jour: 86400000, semaine: 604800000, mois: 2592000000 }   // mois ≈ 30 j

const p2 = n => String(n).padStart(2, '0')
// Horodatage LOCAL AAAA-MM-JJ_HHhMM (nomme zip + snapshots JSON).
export function backupStamp(date) {
  const d = date || new Date()
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '_' + p2(d.getHours()) + 'h' + p2(d.getMinutes())
}
// Période écoulée ? 'manuel' → jamais auto. lastAt null/0 → dû.
export function dueForBackup(lastAt, frequence, nowMs) {
  if (frequence === 'manuel') return false
  const span = FREQ_MS[frequence] || FREQ_MS.semaine
  if (!lastAt) return true
  return (nowMs - lastAt) >= span
}

const _safeName = s => String(s == null ? 'fichier' : s).replace(/[^a-zA-Z0-9._-]/g, '_')

// Sanitise un SEGMENT de chemin (nom de DOSSIER). Contrairement à _safeName (noms de fichiers,
// ASCII strict), on GARDE espaces/accents/parenthèses pour rester lisible ; on ne retire que les
// caractères interdits par les systèmes de fichiers (/ \ : * ? " < > |) et les points en
// tête/fin (interdits sous Windows). Borne à 80 car. Vide → '—'.
const _WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const _safeFolder = s => {
  let x = String(s == null ? '' : s).replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
  x = x.replace(/^\.+|\.+$/g, '').trim()
  x = x.slice(0, 80).replace(/[ .]+$/, '')          // re-trim : slice(0,80) peut ré-exposer un espace/point en fin (interdits Windows)
  if (_WIN_RESERVED.test(x)) x = x + '_'             // noms réservés Windows (CON, PRN, NUL, COM1…) → suffixe pour ne pas casser getDirectoryHandle
  return x || '—'
}

// Date seule AAAA-MM-JJ (préfixe LISIBLE des noms de photos → un même EDL se regroupe visuellement).
// ts invalide/absent → '' (pas de préfixe, l'uid garantit déjà l'unicité).
const _dateStamp = ts => {
  if (!ts) return ''
  const d = new Date(ts)
  return isNaN(d.getTime()) ? '' : d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
}

// category attachement → sous-dossier « type » lisible.
// ⚠️ Deux catégories « photo » DISTINCTES à ne pas mélanger :
//   'edl-photos' = photos de CONSTAT d'état des lieux (valeur légale) → sous-dossier dédié daté ;
//   'photos'     = galerie photo du logement (documents décoratifs) → dossier séparé « Photos ».
// Sinon des photos décoratives pollueraient le dossier juridique « État des lieux ».
const _CAT_FOLDER = { bail: 'Bail', edl: 'État des lieux', quittances: 'Quittances', 'edl-photos': 'État des lieux/Photos', photos: 'Photos' }
const _typeFolder = cat => _CAT_FOLDER[cat] || 'Documents'

// Index ref logement → { entity, imm, ref } pour ranger chaque fichier sous son bien.
// Un logement NON supprimé l'emporte sur un tombstone de même ref (ref réutilisée après suppression).
export function buildLogMap(db) {
  const m = new Map()
  for (const l of (db && db.logements) || []) {
    if (!l || l.ref == null) continue
    const k = String(l.ref)
    if (!m.has(k) || !l._deleted) m.set(k, { entity: l.entity, imm: l.imm, ref: l.ref })
  }
  return m
}

// Chemin relatif (dossiers seuls, SANS le nom de fichier) où ranger un fichier :
//   Bailleur — <entité> / Immeuble — <immeuble> / Appartement — <ref> / <Type>
// Bien sans immeuble → pas de niveau immeuble. Logement introuvable → « _Non rattachés / <Type> ».
export function backupFolderFor(logMap, logRef, category) {
  const type = _typeFolder(category)
  const log = logRef != null ? (logMap && logMap.get(String(logRef))) : null
  if (!log) return '_Non rattachés/' + type
  const seg = ['Bailleur — ' + _safeFolder(log.entity || 'Sans bailleur')]
  if (log.imm) seg.push('Immeuble — ' + _safeFolder(log.imm))
  seg.push('Appartement — ' + _safeFolder(log.ref))
  seg.push(type)
  return seg.join('/')
}

// MIME → extension (fallback quand le nom original n'en porte pas).
const MIME_EXT = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif', 'image/tiff': 'tiff', 'image/bmp': 'bmp',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt', 'text/csv': 'csv', 'application/zip': 'zip', 'application/json': 'json'
}

// Nom de fichier de sauvegarde d'un document uploadé.
// ⚠️ Le champ réel est `originalName || name` (PAS `nom` — bug du 1er jet : sans extension,
// Windows affichait « format non reconnu »). L'extension vient du nom original sinon du MIME
// (fallback 'bin'). On suffixe l'id (`nid()` unique) → 2 docs de même nom ne se collisionnent pas
// (getFileHandle create:true écraserait l'un d'eux), tout en gardant un nom LISIBLE.
export function backupDocName(d) {
  const id = (d && d.id != null) ? d.id : ''
  const orig = String((d && (d.originalName || d.name)) || '')   // coercion : un nom non-string ne doit JAMAIS faire throw collectBackupFiles (avorterait TOUTE la sauvegarde)
  const dot = orig.lastIndexOf('.')
  let base = dot > 0 ? orig.slice(0, dot) : orig
  let ext = dot > 0 ? orig.slice(dot + 1).toLowerCase() : ''
  if (!ext) ext = MIME_EXT[String((d && d.mime) || '').toLowerCase()] || 'bin'
  if (!base) base = 'doc-' + id
  return _safeName(base + '-' + id + '.' + ext)
}

// Fichiers Storage à sauvegarder = porteurs d'une clé cloud ET postérieurs à lastBackupAt.
// → [{ key, name, kind, ts }]. Sources : documents[].cloudKey, baux[ref].signatures.cloudPdfKey
// (+ .certRef.cloudPdfKey), edl[].cloudPdfKey, photos EDL (forme RÉELLE confirmée par grep —
// cf. _edlPreloadPhotos dans index.html : pieces[].elements[].photosE/photosS,
// cles[].photos/photosS, compteursPhotos[k][], mobilier.elements[].photosE/photosS ;
// chaque photo = { idbKey, cloudKey?, ts, synced, name } — l'horodatage est `ts`).
export function collectBackupFiles(db, lastBackupAt) {
  const out = []
  // Index ref logement → bien, construit UNE fois : chaque fichier reçoit son dossier logique
  // (arbre Bailleur / Immeuble / Appartement / Type) via backupFolderFor.
  const logMap = buildLogMap(db)
  // Sans lastBackupAt → tout. Un fichier porteur d'une clé MAIS sans horodatage (records legacy/importés)
  // est TOUJOURS inclus : mieux re-sauvegarder un doublon (le manifeste dédoublonne) que perdre une preuve légale.
  const after = ts => !lastBackupAt || !ts || new Date(ts).getTime() > lastBackupAt
  const push = (key, name, kind, ts, logRef, category) => {
    if (key && after(ts)) out.push({ key, name, kind, ts: ts || null, dir: backupFolderFor(logMap, logRef, category) })
  }
  // CANDIDATURES-CONFORMITE : une pièce de candidat supprimée (purge RGPD, suppression manuelle) n'est pas
  // sauvegardée — ses données doivent disparaître. Les autres pièces supprimées restent (preuve légale).
  for (const d of (db && db.documents) || []) if (!(d && d._deleted && d.parentType === 'candidat')) push(d.cloudKey, backupDocName(d), 'document', d._modifiedAt, d.logRef, d.category || 'documents')
  for (const [ref, b] of Object.entries((db && db.baux) || {})) {
    const s = b && b.signatures; if (!s) continue
    push(s.cloudPdfKey, _safeName('bail-' + ref + '.pdf'), 'document', s.signedAt || b._modifiedAt, ref, 'bail')
    if (s.certRef) push(s.certRef.cloudPdfKey, _safeName('certificat-' + ref + '.pdf'), 'document', s.signedAt || b._modifiedAt, ref, 'bail')
    if (s.pdfNuKey) push(s.pdfNuKey, _safeName('bail-signe-empreinte-' + ref + '.pdf'), 'document', s.signedAt || b._modifiedAt, ref, 'bail')   // SIG-3 : fichier que décrit contentHash
  }
  // AVENANT-REFONTE lot 3b : PDF signé d'un avenant (registre = journal du bail, type 'avenant').
  for (const e of (db && db.baux_evenements) || []) {
    if (!e || e._deleted || e.type !== 'avenant' || !e.pdfKey) continue
    const ref = String(e.ref || '').split('@@')[0]
    push(e.pdfKey, _safeName('avenant-' + (e.no || '') + '-' + ref + '.pdf'), 'document', e.statutLe || e._modifiedAt, ref, 'bail')
  }
  for (const e of (db && db.edl) || []) {
    push(e.cloudPdfKey, _safeName('edl-' + (e.id || '') + '.pdf'), 'document', e._modifiedAt, e.logement, 'edl')
    // Photos EDL — on parcourt EXACTEMENT les mêmes emplacements que _edlPreloadPhotos (index.html).
    const pushPhoto = ph => {
      if (!ph || !ph.cloudKey) return
      const stamp = ph.ts || e._modifiedAt
      // Audit M4 : unicité du nom de fichier. slice(-12) faisait collisionner 2 photos dont les
      // 12 derniers chars d'idbKey coïncident → getFileHandle(create:true) en écrasait une.
      // On sanitise l'idbKey COMPLET (fallback cloudKey) → nom déterministe et distinct.
      // Préfixe DATE (AAAA-MM-JJ) : les photos EDL doivent être datées et se regrouper par jour.
      const uid = _safeName(ph.idbKey || ph.cloudKey || 'photo')
      const dpfx = _dateStamp(stamp)
      // 'edl-photos' (PAS 'photos') → dossier légal « État des lieux/Photos », distinct de la galerie logement.
      push(ph.cloudKey, _safeName((dpfx ? dpfx + '_' : '') + 'photo-' + uid + '.jpg'), 'photo', stamp, e.logement, 'edl-photos')
    }
    for (const pc of (e.pieces || [])) for (const x of (pc.elements || [])) {
      for (const ph of (x.photosE || [])) pushPhoto(ph)
      for (const ph of (x.photosS || [])) pushPhoto(ph)
    }
    for (const c of (e.cles || [])) {
      for (const ph of (c.photos || [])) pushPhoto(ph)
      for (const ph of (c.photosS || [])) pushPhoto(ph)
    }
    const cp = e.compteursPhotos || {}
    for (const k of Object.keys(cp)) for (const ph of (cp[k] || [])) pushPhoto(ph)
    const mobEls = (e.mobilier && Array.isArray(e.mobilier.elements)) ? e.mobilier.elements : []
    for (const m of mobEls) {
      for (const ph of (m.photosE || [])) pushPhoto(ph)
      for (const ph of (m.photosS || [])) pushPhoto(ph)
    }
    // DAAF — 5e emplacement légal (détecteur de fumée, obligation R129-13). Forme confirmée par grep
    // (index.html L29168/29314/29339) : edl.daaf.photos[] = { name, idbKey, cloudKey?, ts }.
    for (const ph of ((e.daaf && e.daaf.photos) || [])) pushPhoto(ph)
  }
  return out
}

// Manifeste cumulatif (mode dossier) : dédoublonne les clés, historise les snapshots JSON.
export function buildManifest(prev, snapshotName, newKeys, iso, frequence) {
  const p = prev || {}
  const keys = Array.from(new Set([...(p.fichiersSauvegardes || []), ...(newKeys || [])]))
  const versions = Array.from(new Set([...(p.versionsJson || []), snapshotName]))
  return { format: 'propryo-backup-1', derniereSauvegarde: iso, frequence, fichiersSauvegardes: keys, versionsJson: versions }
}

// CRC-32 (pour le ZIP).
let _crcTable = null
function _crcInit() { _crcTable = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); _crcTable[n] = c >>> 0 } }
export function crc32(bytes) {
  if (!_crcTable) _crcInit()
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) c = _crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

// ZIP « stored » (méthode 0, sans compression — PDF/JPEG déjà compressés). entries=[{name,bytes:Uint8Array}] → Uint8Array.
export function storedZip(entries) {
  const enc = new TextEncoder()
  const locals = [], centrals = []; let offset = 0
  const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF]
  const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]
  for (const e of entries) {
    const nameB = enc.encode(e.name), data = e.bytes, crc = crc32(data), sz = data.length
    const lh = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(sz), u32(sz), u16(nameB.length), u16(0))
    locals.push(new Uint8Array(lh), nameB, data)
    const ch = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(sz), u32(sz), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))
    centrals.push(new Uint8Array(ch), nameB)
    offset += lh.length + nameB.length + data.length
  }
  const cdStart = offset
  let cdSize = 0; for (const c of centrals) cdSize += c.length
  const eocd = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cdSize), u32(cdStart), u16(0)))
  const parts = [...locals, ...centrals, eocd]
  let total = 0; for (const p of parts) total += p.length
  const out = new Uint8Array(total); let pos = 0; for (const p of parts) { out.set(p, pos); pos += p.length }
  return out
}
