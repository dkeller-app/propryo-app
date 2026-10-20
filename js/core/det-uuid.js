// js/core/det-uuid.js — UUID DÉTERMINISTE par owner, IDENTIQUE à l'ETL _import/import.mjs.
//
// id = uuid(sha1('immotrack-p0e|' + ownerNamespace + '|' + parts.join('|'))) — même (collection, clé)
// → même uuid → upsert idempotent + cohérence FK + AUCUN doublon des lignes déjà importées.
//
// SHA-1 SYNCHRONE pur-JS : l'API navigateur `crypto.subtle.digest` est ASYNCHRONE, incompatible avec
// `mapToRow` qui appelle `ctx.detUuid(...)` de façon synchrone. Digest byte-identique à Node `crypto`
// (vérifié par __tests__/helpers/det-uuid.test.js sur entrées UTF-8 + emoji). Encodage UTF-8 via
// TextEncoder (présent en navigateur ET en Node) → aucune gestion manuelle d'octets.

const rotl = (n, s) => (n << s) | (n >>> (32 - s))

function sha1Hex(bytes) {
  const len = bytes.length
  const total = (((len + 8) >> 6) + 1) * 64       // taille paddée (multiple de 64), + 0x80 + longueur 64 bits
  const padded = new Uint8Array(total)
  padded.set(bytes)
  padded[len] = 0x80
  const dv = new DataView(padded.buffer)
  const bitLen = len * 8
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000))   // longueur big-endian, 64 bits (hi|lo)
  dv.setUint32(total - 4, bitLen >>> 0)

  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0
  const w = new Array(80)
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4)
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let i = 0; i < 80; i++) {
      let f, k
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999 }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1 }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC }
      else { f = b ^ c ^ d; k = 0xCA62C1D6 }
      const tmp = (rotl(a, 5) + f + e + k + w[i]) | 0
      e = d; d = c; c = rotl(b, 30); b = a; a = tmp
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0
  }
  const hx = n => (n >>> 0).toString(16).padStart(8, '0')
  return hx(h0) + hx(h1) + hx(h2) + hx(h3) + hx(h4)
}

const ENC = new TextEncoder()
const DEFAULT_NS = '00000000-0000-4000-8000-000000000000'   // = OWNER_FOR_NS de l'ETL quand --owner absent

// makeDetUuid(ownerNamespace) → detUuid(...parts). ownerNamespace = id auth de l'utilisateur (espace).
export function makeDetUuid(ownerNamespace) {
  const ns = ownerNamespace || DEFAULT_NS
  return function detUuid(...parts) {
    const h = sha1Hex(ENC.encode('immotrack-p0e|' + ns + '|' + parts.join('|')))
    const y = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${y}${h.slice(17, 20)}-${h.slice(20, 32)}`
  }
}
