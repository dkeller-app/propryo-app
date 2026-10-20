// js/core/bail-content-hash.js — Empreinte LÉGALE canonique d'un bail signé (`content_hash`).
//
// Prouve à jamais que les TERMES JURIDIQUES FIGÉS d'un bail signé n'ont pas été altérés. On hashe
// les TERMES (pas le PDF) : reproductible (un vérificateur recalcule le même hash depuis les données),
// uniforme (tous modes de signature), et possible même pour les baux legacy sans PDF archivé.
// Décision design 2026-06-16 (cf. docs/superpowers/specs/2026-06-16-verrou-legal-content-hash-design.md).
//
// L'empreinte du PDF final signé (`bail.signatures.contentHash`, SHA-256 du binaire) reste une PREUVE
// SECONDAIRE de l'artefact, distincte de CE content_hash (qui alimente `baux.content_hash` + le verrou).

const SENTINEL = 'itbailhashv1|'   // versionné : une v2 future ne cassera pas la vérification des v1.

const _num = x => { if (x == null || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null }
// dates : on n'accepte QUE le format figé YYYY-MM-DD (déterministe, aucun parsing dépendant du fuseau).
const _dateOnly = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) ? v.slice(0, 10) : null

// Sérialisation JSON CANONIQUE : clés triées récursivement, aucun espace, ordre des arrays préservé.
// `undefined` → 'null' (jamais omis → pas de divergence selon la présence d'une clé). C'est CE texte
// exact qui est hashé → il doit être identique partout et stable dans le temps.
export function canonicalStringify(v) {
  if (v === undefined) return 'null'
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonicalStringify).join(',') + ']'
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonicalStringify(v[k])).join(',') + '}'
}

// SHA-256 → hex 64. crypto.subtle existe en navigateur (contexte sécurisé) ET en Node 18+
// (globalThis.crypto.subtle) → byte-identique des deux côtés (SHA-256 est standard).
export async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str)
  const buf = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Construit l'objet des TERMES juridiques figés à hasher. Whitelist EXPLICITE (jamais {...bail}) →
// un champ volatil/interne ajouté au bail ne change PAS le hash. Absent → null (jamais omis).
export function bailLegalContent(bail) {
  const b = bail || {}
  const s = b.signatures || {}
  return {
    terms: {
      hc: _num(b.hc), ch: _num(b.ch), dg: _num(b.dg), jpay: _num(b.jpay),
      debut: _dateOnly(b.debut), fin: _dateOnly(b.fin), finEffective: _dateOnly(b.finEffective),
      typeContrat: b.typeContrat ?? null, type: b.type ?? null,
      locataires: b.locataires ?? null,
      // signataires = co-gérants côté BAILLEUR qui signent le bail (≠ garants ; corrigé suite audit 2026-06-16).
      signataires: b.signataires ?? null,
      // garants/cautions = champs plats legacy (ils NE signent PAS le bail mais sont contractuels) →
      // whitelistés EXPLICITEMENT, pour ne pas dépendre du snapshot (dont la forme n'est pas garantie).
      garant: b.garant ?? null, adrGarant: b.adrGarant ?? null, ddnGarant: b.ddnGarant ?? null, lieuGarant: b.lieuGarant ?? null,
      garant2: b.garant2 ?? null, adrGarant2: b.adrGarant2 ?? null, ddnGarant2: b.ddnGarant2 ?? null, lieuGarant2: b.lieuGarant2 ?? null,
      plafondCaution: _num(b.plafondCaution),
      mobilier: b.mobilier ?? null,
      irl: b.irl ?? null, irlHistorique: b.irlHistorique ?? null,
    },
    snapshot: s.bailSnapshot ?? null,   // photo légale figée du bien+immeuble (capturée à la signature)
    signedAt: s.signedAt ?? null,
  }
}

// Empreinte légale = SHA-256( SENTINEL + canonicalJSON(termes figés) ). Async (crypto.subtle).
export async function bailContentHash(bail) {
  return sha256Hex(SENTINEL + canonicalStringify(bailLegalContent(bail)))
}
