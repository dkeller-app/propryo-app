// js/core/deux-d-doc.js — VERIF-DOCUMENTS lot 1 (v15.740 provisoire).
// Lecture et vérification d'un code 2D-Doc (cachet électronique visible de l'État) à partir du TEXTE déjà
// extrait du DataMatrix. Référence : « Spécifications techniques des codes à barres 2D-Doc », France Titres,
// v3.3.9 du 22/07/2026 — §3 (structure), §5.1 (procédure de vérification), §7 (identifiants de données).
//
// RÈGLE DE SÛRETÉ (non négociable) : l'état « valide » n'est rendu que si TOUTES les conditions sont réunies :
//   1. en-tête lisible (versions 02, 03, 04 en C40) ;
//   2. autorité (AC) présente parmi les ANCRES revues à la main (deux-d-doc-ancres.js), empreinte SHA-256 conforme ;
//   3. certificat de signature trouvé (CN = identifiant du certificat), émis par cette AC (signature vérifiée) ;
//   4. date de signature du code comprise dans la validité du certificat ET dans celle de l'AC, et pas dans le futur ;
//   5. liste de révocation de l'AC signée par l'AC, en cours de validité à l'instant du contrôle, et certificat absent ;
//   6. signature ECDSA (r‖s) vérifiée sur l'en-tête + le message, octet pour octet.
// Tout le reste est « invalide » (la signature ou le certificat ne tient pas), « non vérifiable » (il manque une
// pièce du contrôle) ou « illisible ». Un spécimen signé par l'AC de test FR00 n'est jamais « valide ».
// Le relais ne transporte que des données publiques (annuaires, listes de révocation) : il n'est jamais cru.
//
// Module pur : WebCrypto (globalThis.crypto.subtle — navigateur, Node 20+, Workers). Aucune E/S.
// Testé par __tests__/helpers/deux-d-doc.test.js (spécimens officiels §16 + infrastructure de test locale).

import { CHAMPS_2DDOC } from './deux-d-doc-champs.js';
import { ANCRES_2DDOC } from './deux-d-doc-ancres.js';
export { ANCRES_2DDOC };

export const SOURCE_2DDOC = {
  libelle: 'Spécifications techniques des codes à barres 2D-Doc, France Titres, v3.3.9 du 22/07/2026',
  url: 'https://ants.gouv.fr/nos-missions/les-solutions-numeriques/2d-doc'
};

export const ETAT = Object.freeze({ VALIDE: 'valide', INVALIDE: 'invalide', NON_VERIFIABLE: 'non_verifiable', ILLISIBLE: 'illisible' });

const GS = '\x1d', RS = '\x1e', US = '\x1f';
const JOUR = 86400000;
const D2000 = Date.UTC(2000, 0, 1);
const TOLERANCE_HORLOGE = JOUR; // date de signature au plus 1 jour dans le futur (fuseaux)

const DICO = new Map(CHAMPS_2DDOC.map(([id, min, max, lib]) => [id, { min, max, lib }]));

/** Types de documents utiles au dossier de candidature (spec §6.1). */
export const TYPES_DOCUMENT = Object.freeze({
  '00': 'Justificatif de domicile', '01': 'Facture (énergie, téléphonie, internet, eau)', '02': 'Avis de taxe d\'habitation',
  '04': 'Avis d\'impôt sur les revenus', '06': 'Bulletin de salaire', '10': 'Contrat de travail',
  '18': 'Avis de situation déclarative', '24': 'Avis de situation déclarative', '27': 'Avis de situation déclarative',
  '28': 'Avis d\'impôt sur les revenus'
});
export const TYPES_AVIS_IMPOT = Object.freeze(['04', '28']);

/** Champs conservés après lecture, par famille de document (minimisation : ni adresse ni données non utiles). */
const CHAMPS_CONSERVES = {
  avis: ['41', '43', '44', '45', '46', '47', '48', '49', '4A', '4B'],
  asdir: ['43', '44', '45', '46', '47', '48', '49', '4B'],
  bulletin: ['10', '11', '12', '13', '50', '53', '54', '55', '58', '59', '5A'],
  domicile: ['11', '12', '13', '15', '16', '17'],
  contrat: ['10', '11', '12', '13', '50', '55', '56', '57']
};
export function familleDuType(type) {
  if (type === '04' || type === '28') return 'avis';
  if (type === '18' || type === '24' || type === '27') return 'asdir';
  if (type === '06') return 'bulletin';
  if (type === '00' || type === '01' || type === '02') return 'domicile';
  if (type === '10') return 'contrat';
  return null;
}

// ───────────────────────────── En-tête et champs ─────────────────────────────

const hexDate = (h) => (/^[0-9A-F]{4}$/i.test(h) && h.toUpperCase() !== 'FFFF') ? new Date(D2000 + parseInt(h, 16) * JOUR) : null;

/**
 * En-tête C40 (§3.3.1-3.3.3). Versions 02 (22 car.), 03 (24), 04 (26). La version 01 (signature binaire) et
 * l'en-tête binaire v04 ne sont pas pris en charge : null.
 */
export function lireEntete(texte) {
  const s = String(texte == null ? '' : texte);
  if (s.slice(0, 2) !== 'DC') return null;
  const version = s.slice(2, 4);
  const longueur = { '02': 22, '03': 24, '04': 26 }[version];
  if (!longueur || s.length < longueur) return null;
  const ac = s.slice(4, 8), certificat = s.slice(8, 12), type = s.slice(20, 22);
  if (!/^[A-Z0-9]{4}$/.test(ac) || !/^[A-Z0-9]{4}$/.test(certificat) || !/^[A-Z0-9]{2}$/.test(type)) return null;
  const sigHex = s.slice(16, 20);
  if (!/^[0-9A-F]{4}$/i.test(s.slice(12, 16)) || !/^[0-9A-F]{4}$/i.test(sigHex)) return null;
  return {
    version, longueur, ac, certificat, type,
    dateEmission: hexDate(s.slice(12, 16)), dateSignature: hexDate(sigHex),
    perimetre: longueur >= 24 ? s.slice(22, 24) : '', pays: longueur === 26 ? s.slice(24, 26) : 'FR'
  };
}

/**
 * Découpe la zone message en champs (§3.4.1). Champ de longueur fixe : sans séparateur. Variable : terminé par GS,
 * par RS (tronqué), par la fin de zone, ou à sa longueur maximale. Identifiant inconnu → arrêt, `complet:false`.
 */
export function decouperChamps(message) {
  const m = String(message || '');
  const champs = []; let p = 0;
  while (p < m.length) {
    const id = m.slice(p, p + 2);
    const d = DICO.get(id);
    if (!d || id.length < 2) return { champs, complet: false, inconnu: id };
    p += 2;
    let valeur, tronque = false;
    if (d.max != null && d.min === d.max) {
      valeur = m.slice(p, p + d.max);
      if (valeur.length < d.max) return { champs, complet: false, inconnu: id };
      p += d.max;
    } else {
      let q = p; const lim = d.max == null ? m.length : Math.min(m.length, p + d.max);
      while (q < lim && m[q] !== GS && m[q] !== RS) q++;
      valeur = m.slice(p, q); p = q;
      if (m[p] === GS) p++; else if (m[p] === RS) { tronque = true; p++; }
    }
    champs.push({ id, libelle: d.lib, valeur, tronque });
  }
  return { champs, complet: true };
}

// ───────────────────────────── Base32 / DER / X.509 / CRL ─────────────────────────────

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Base32 RFC 4648, sans remplissage obligatoire. Lève une erreur sur caractère hors alphabet. */
export function base32Decode(txt) {
  const s = String(txt || '').replace(/=+$/, '');
  let bits = 0, val = 0; const out = [];
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('base32');
    val = ((val << 5) | i) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  if (bits >= 5 || (val & ((1 << bits) - 1)) !== 0) throw new Error('base32');   // forme non canonique
  return new Uint8Array(out);
}
export function base32Encode(u8) {
  let bits = 0, val = 0, out = '';
  for (const b of u8) { val = ((val << 8) | b) & 0xffff; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

function tlv(buf, off) {
  if (off + 2 > buf.length) throw new Error('der');
  const tag = buf[off]; let len = buf[off + 1], hdr = 2;
  if (len & 0x80) {
    const n = len & 0x7f; if (n < 1 || n > 4 || off + 2 + n > buf.length) throw new Error('der');
    len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + 2 + i];
    hdr = 2 + n;
  }
  const start = off + hdr, end = start + len;
  if (end > buf.length) throw new Error('der');
  return { tag, debut: off, start, end };
}
function enfants(buf, t) { const o = []; let p = t.start; while (p < t.end) { const c = tlv(buf, p); o.push(c); p = c.end; } return o; }
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const brut = (buf, t) => buf.subarray(t.debut, t.end);
const contenu = (buf, t) => buf.subarray(t.start, t.end);
function lireTemps(buf, t) {
  const s = new TextDecoder().decode(contenu(buf, t));
  let y, r;
  if (t.tag === 0x17) { y = +s.slice(0, 2); y += y < 50 ? 2000 : 1900; r = s.slice(2); }
  else if (t.tag === 0x18) { y = +s.slice(0, 4); r = s.slice(4); }
  else throw new Error('der');
  const d = new Date(Date.UTC(y, +r.slice(0, 2) - 1, +r.slice(2, 4), +r.slice(4, 6), +r.slice(6, 8), +r.slice(8, 10) || 0));
  if (isNaN(d)) throw new Error('der');
  return d;
}
const ALG = {
  '2a8648ce3d040302': ['EC', 'SHA-256'], '2a8648ce3d040303': ['EC', 'SHA-384'], '2a8648ce3d040304': ['EC', 'SHA-512'],
  '2a864886f70d01010b': ['RSA', 'SHA-256'], '2a864886f70d01010c': ['RSA', 'SHA-384'], '2a864886f70d01010d': ['RSA', 'SHA-512']
};
const COURBE = { '2a8648ce3d030107': 'P-256', '2b81040022': 'P-384', '2b81040023': 'P-521' };
const OCTETS_COURBE = { 'P-256': 32, 'P-384': 48, 'P-521': 66 };
const HASH_COURBE = { 'P-256': 'SHA-256', 'P-384': 'SHA-384', 'P-521': 'SHA-512' };
const normSerie = (h) => String(h).replace(/^(00)+(?=..)/, '').toLowerCase();

/** Certificat X.509 DER → champs utiles. Lève une erreur si le DER est mal formé. */
export function lireCertificat(der) {
  const buf = der instanceof Uint8Array ? der : new Uint8Array(der);
  const racine = tlv(buf, 0);
  if (racine.end !== buf.length) throw new Error('der');
  const [tbs, algSig, valSig] = enfants(buf, racine);
  const k = enfants(buf, tbs); let i = k[0].tag === 0xa0 ? 1 : 0;
  const serie = k[i], algTbs = k[i + 1], emetteur = k[i + 2], validite = k[i + 3], sujet = k[i + 4], spki = k[i + 5];
  const [nb, na] = enfants(buf, validite);
  const algOid = hex(contenu(buf, enfants(buf, algSig)[0]));
  const memeAlg = hex(contenu(buf, enfants(buf, algTbs)[0])) === algOid;
  const algCle = enfants(buf, enfants(buf, spki)[0]);
  const cleOid = hex(contenu(buf, algCle[0]));
  let cn = '';
  for (const rdn of enfants(buf, sujet)) for (const atv of enfants(buf, rdn)) {
    const [o, v] = enfants(buf, atv); if (hex(contenu(buf, o)) === '550403') cn = new TextDecoder().decode(contenu(buf, v));
  }
  return {
    tbs: brut(buf, tbs), emetteur: hex(brut(buf, emetteur)), sujet: hex(brut(buf, sujet)), cn,
    serie: normSerie(hex(contenu(buf, serie))), debut: lireTemps(buf, nb), fin: lireTemps(buf, na),
    spki: brut(buf, spki),
    typeCle: cleOid === '2a864886f70d010101' ? 'RSA' : cleOid === '2a8648ce3d0201' ? 'EC' : null,
    courbe: cleOid === '2a8648ce3d0201' && algCle[1] ? (COURBE[hex(contenu(buf, algCle[1]))] || null) : null,
    algSignature: memeAlg ? (ALG[algOid] || null) : null,
    signature: contenu(buf, valSig).subarray(1) // BIT STRING : 1er octet = bits inutilisés
  };
}

/** Liste de révocation (CRL) DER → émetteur, dates, numéros de série révoqués. */
export function lireCrl(der) {
  const buf = der instanceof Uint8Array ? der : new Uint8Array(der);
  const racine = tlv(buf, 0);
  if (racine.end !== buf.length) throw new Error('der');
  const [tbs, algSig, valSig] = enfants(buf, racine);
  const k = enfants(buf, tbs); let i = 0;
  if (k[0].tag === 0x02) i = 1; // version
  const emetteur = k[i + 1]; const ceJour = lireTemps(buf, k[i + 2]);
  let j = i + 3, prochaine = null;
  if (k[j] && (k[j].tag === 0x17 || k[j].tag === 0x18)) { prochaine = lireTemps(buf, k[j]); j++; }
  const revoques = new Set();
  if (k[j] && k[j].tag === 0x30) for (const e of enfants(buf, k[j])) revoques.add(normSerie(hex(contenu(buf, enfants(buf, e)[0]))));
  return {
    tbs: brut(buf, tbs), emetteur: hex(brut(buf, emetteur)), ceJour, prochaine, revoques,
    algSignature: ALG[hex(contenu(buf, enfants(buf, algSig)[0]))] || null,
    signature: contenu(buf, valSig).subarray(1)
  };
}

/** Signature ECDSA DER (SEQUENCE{r,s}) → r‖s brut attendu par WebCrypto. */
export function ecdsaDerVersBrut(sigDer, courbe) {
  const n = OCTETS_COURBE[courbe]; const seq = tlv(sigDer, 0);
  const [r, s] = enfants(sigDer, seq);
  const fixe = (t) => { let v = contenu(sigDer, t); while (v.length > n && v[0] === 0) v = v.subarray(1); if (v.length > n) throw new Error('der'); const o = new Uint8Array(n); o.set(v, n - v.length); return o; };
  const o = new Uint8Array(2 * n); o.set(fixe(r), 0); o.set(fixe(s), n); return o;
}

/** L'objet signé (certificat ou CRL, avec `tbs`, `algSignature`, `signature`) est-il signé par la clé de `ac` ? */
export async function signePar(objet, ac) {
  try {
    if (!objet || !ac || !objet.algSignature || objet.algSignature[0] !== ac.typeCle) return false;
    const hash = objet.algSignature[1];
    if (ac.typeCle === 'RSA') {
      const k = await crypto.subtle.importKey('spki', ac.spki, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify']);
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, objet.signature, objet.tbs);
    }
    if (ac.typeCle !== 'EC' || !ac.courbe) return false;
    const k = await crypto.subtle.importKey('spki', ac.spki, { name: 'ECDSA', namedCurve: ac.courbe }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash }, k, ecdsaDerVersBrut(objet.signature, ac.courbe), objet.tbs);
  } catch { return false; }
}

export async function sha256Hex(u8) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', u8))); }
export function b64VersOctets(b64) {
  const bin = atob(String(b64 || '').replace(/\s/g, '')); const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o;
}

/**
 * Annuaire de certificats d'une AC → liste de certificats DER. Les annuaires publiés (TSPInformationURI de la TSL)
 * répondent en « multipart/mixed; boundary=End » malgré leur extension « .der » ; un DER seul est aussi accepté.
 * La longueur de chaque certificat est lue dans son DER (pas de recherche de la frontière). Pur, borné à 1 000 entrées.
 */
export function extraireCertificatsAnnuaire(octets) {
  const b = octets instanceof Uint8Array ? octets : new Uint8Array(octets || []);
  const out = [];
  if (b[0] === 0x30) { try { const t = tlv(b, 0); out.push(b.slice(0, t.end)); } catch { /* ignoré */ } return out; }
  // Recherche par octets (pas de conversion en chaîne : borné en temps de calcul côté Worker).
  const cherche = (motif, depuis, insensible) => {
    outer: for (let i = depuis; i <= b.length - motif.length; i++) {
      for (let j = 0; j < motif.length; j++) { let x = b[i + j]; if (insensible && x >= 65 && x <= 90) x |= 0x20; if (x !== motif[j]) continue outer; }
      return i;
    }
    return -1;
  };
  const MARQUE = Array.from('application/pkix-cert', (c) => c.charCodeAt(0)), FIN = [13, 10, 13, 10];
  let p = 0;
  while (out.length < 1000 && (p = cherche(MARQUE, p, true)) >= 0) {
    const s = cherche(FIN, p, false); if (s < 0) break;
    try { const t = tlv(b, s + 4); out.push(b.slice(s + 4, t.end)); p = t.end; } catch { p = s + 4; }
  }
  return out;
}
export function octetsVersB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }

// ───────────────────────────── Liste de confiance ─────────────────────────────

/**
 * Construit le magasin de confiance à partir des ANCRES (revues) et des données publiques transportées par le relais
 * ou l'instantané : { genereLe, source, autorites: { FR06: { certificats:[b64…], crl:b64|null } } }.
 * Les certificats et CRL sont seulement LUS ici ; ils sont tous vérifiés contre l'ancre au moment du contrôle.
 * @param {object} donnees  réponse de GET /api/2ddoc/confiance (ou instantané)
 * @param {object} [ancres] par défaut ANCRES_2DDOC (les tests injectent une AC de test)
 */
export async function construireConfiance(donnees, ancres = ANCRES_2DDOC) {
  const magasin = { source: donnees && donnees.source || 'inconnue', genereLe: donnees && donnees.genereLe || null, autorites: {} };
  for (const [id, a] of Object.entries(ancres || {})) {
    let ac;
    try {
      const der = b64VersOctets(a.der);
      if (!a.sha256 || (await sha256Hex(der)) !== a.sha256) continue; // ancre sans empreinte ou altérée : ignorée
      ac = lireCertificat(der);
    } catch { continue; }
    const src = (donnees && donnees.autorites && donnees.autorites[id]) || {};
    const certificats = [];
    for (const b of Array.isArray(src.certificats) ? src.certificats : []) { try { certificats.push(lireCertificat(b64VersOctets(b))); } catch { /* ignoré */ } }
    let crl = null; try { if (src.crl) crl = lireCrl(b64VersOctets(src.crl)); } catch { crl = null; }
    magasin.autorites[id] = { ac, certificats, crl };
  }
  return magasin;
}

// ───────────────────────────── Vérification ─────────────────────────────

const res = (etat, code, motif, extra) => Object.assign({ etat, code, motif }, extra || {});

/**
 * Vérifie un 2D-Doc.
 * @param {string} texte    contenu du DataMatrix (caractères décodés)
 * @param {object} magasin  sortie de construireConfiance()
 * @param {{maintenant?:Date}} [opts]
 * @returns {Promise<{etat, code, motif, reessayer?, entete?, champs?, complet?, certificat?}>}
 *   code ∈ valide | entete | signature_absente | version | ac_inconnue | certificat_introuvable | chaine |
 *          hors_validite | revocation_inconnue | revoque | signature_format | signature
 */
export async function verifier2DDoc(texte, magasin, opts = {}) {
  const maintenant = opts.maintenant instanceof Date ? opts.maintenant : new Date();
  const s = String(texte == null ? '' : texte);
  if (s.slice(0, 2) === 'DC' && s.slice(2, 4) === '01') return res(ETAT.NON_VERIFIABLE, 'version', 'Code 2D-Doc de version 01 : format non pris en charge.');
  const h = lireEntete(s);
  if (!h) return res(ETAT.ILLISIBLE, 'entete', 'Le code lu n\'est pas un 2D-Doc lisible.');
  const iUS = s.indexOf(US, h.longueur);
  const base = { entete: h };
  if (iUS < 0) return res(ETAT.ILLISIBLE, 'signature_absente', 'Le code ne contient pas de signature.', base);
  const signe = s.slice(0, iUS);
  let sigTxt = s.slice(iUS + 1); const iAnnexe = sigTxt.indexOf(GS); if (iAnnexe >= 0) sigTxt = sigTxt.slice(0, iAnnexe);
  sigTxt = sigTxt.trim();
  // Le dictionnaire des champs est celui du périmètre 01 (France Titres) : un autre périmètre ou pays n'est pas interprété
  // (la signature reste vérifiée). Les versions 02 n'ont pas de périmètre : 01 implicite.
  const interpretable = (!h.perimetre || h.perimetre === '01') && h.pays === 'FR';
  const dec = interpretable ? decouperChamps(signe.slice(h.longueur)) : { champs: [], complet: false };
  Object.assign(base, { champs: dec.champs, complet: dec.complet });

  const aut = magasin && magasin.autorites && magasin.autorites[h.ac];
  if (!aut) return res(ETAT.NON_VERIFIABLE, 'ac_inconnue', `L'autorité « ${h.ac} » ne figure pas dans la liste de confiance de France Titres.`, base);
  const candidats = aut.certificats.filter((c) => c.cn === h.certificat);
  if (!candidats.length) return res(ETAT.NON_VERIFIABLE, 'certificat_introuvable', `Le certificat « ${h.certificat} » de l'autorité ${h.ac} est introuvable.`, Object.assign(base, { reessayer: true }));
  const dSig = h.dateSignature;
  if (!dSig) return res(ETAT.NON_VERIFIABLE, 'hors_validite', 'Le code ne porte pas de date de signature.', base);
  if (dSig.getTime() > maintenant.getTime() + TOLERANCE_HORLOGE) return res(ETAT.NON_VERIFIABLE, 'hors_validite', 'La date de signature du code est dans le futur.', base);

  // Chaîne + validité : on ne garde que les certificats émis par l'ancre et valides à la date de signature.
  const fiables = [];
  for (const c of candidats) {
    if (!(await signePar(c, aut.ac))) continue;
    const jourSig = dSig.getTime(), finJour = jourSig + JOUR - 1; // la date du code est un jour (sans heure)
    if (finJour < c.debut.getTime() || jourSig > c.fin.getTime()) continue;
    if (finJour < aut.ac.debut.getTime() || jourSig > aut.ac.fin.getTime()) continue;
    fiables.push(c);
  }
  if (!fiables.length) {
    const chaineOk = [];
    for (const c of candidats) if (await signePar(c, aut.ac)) chaineOk.push(c);
    return chaineOk.length
      ? res(ETAT.NON_VERIFIABLE, 'hors_validite', 'Le certificat de signature n\'était pas valide à la date de signature du code.', base)
      : res(ETAT.NON_VERIFIABLE, 'chaine', 'Le certificat de signature n\'est pas émis par l\'autorité de confiance.', base);
  }

  // Révocation (§5.1) : liste signée par l'AC, en cours de validité maintenant.
  const crl = aut.crl;
  const crlOk = crl && crl.emetteur === aut.ac.sujet && crl.prochaine && crl.ceJour.getTime() <= maintenant.getTime() + TOLERANCE_HORLOGE
    && maintenant.getTime() <= crl.prochaine.getTime() && (await signePar(crl, aut.ac));
  if (!crlOk) return res(ETAT.NON_VERIFIABLE, 'revocation_inconnue', 'La liste de révocation de l\'autorité n\'a pas pu être contrôlée : vérification reportée.', Object.assign(base, { reessayer: true }));

  // Signature ECDSA brute r‖s sur l'en-tête + le message (Base32, §3.5).
  let sig;
  try { sig = base32Decode(sigTxt); } catch { return res(ETAT.INVALIDE, 'signature_format', 'La signature du code est mal formée.', base); }
  const octets = new TextEncoder().encode(signe);
  if (!/^[\x00-\x7f]*$/.test(signe)) return res(ETAT.NON_VERIFIABLE, 'caracteres', 'Le code lu contient des caractères hors du jeu prévu par la spécification.', base);
  let revoque = null, okSig = null;
  for (const c of fiables) {
    if (c.typeCle !== 'EC' || !c.courbe) continue;
    if (sig.length !== 2 * OCTETS_COURBE[c.courbe]) continue;
    let ok = false;
    try {
      const k = await crypto.subtle.importKey('spki', c.spki, { name: 'ECDSA', namedCurve: c.courbe }, false, ['verify']);
      ok = await crypto.subtle.verify({ name: 'ECDSA', hash: HASH_COURBE[c.courbe] }, k, sig, octets);
    } catch { ok = false; }
    if (!ok) continue;
    if (crl.revoques.has(c.serie)) { revoque = c; continue; }
    okSig = c; break;
  }
  if (okSig) {
    return res(ETAT.VALIDE, 'valide', 'Signature valide, émise par une autorité de la liste de confiance de France Titres.',
      Object.assign(base, { certificat: { ac: h.ac, id: okSig.cn, du: okSig.debut.toISOString().slice(0, 10), au: okSig.fin.toISOString().slice(0, 10), serie: okSig.serie },
        revocation: { du: crl.ceJour.toISOString().slice(0, 10), au: crl.prochaine.toISOString().slice(0, 10) } }));
  }
  if (revoque) return res(ETAT.INVALIDE, 'revoque', 'Le certificat qui a signé ce code a été révoqué par son autorité : la signature n\'est pas reconnue.', base);
  return res(ETAT.INVALIDE, 'signature', 'La signature ne correspond pas aux données du code.', base);
}

// ───────────────────────────── Exploitation des données signées ─────────────────────────────

/** Ne garde que les champs utiles à la famille du document (minimisation). */
export function champsConserves(type, champs) {
  const f = familleDuType(type); const garder = f ? CHAMPS_CONSERVES[f] : [];
  return (champs || []).filter((c) => garder.includes(c.id)).map((c) => ({ id: c.id, libelle: c.libelle, valeur: c.valeur }));
}

/** Nom normalisé pour comparaison : majuscules, sans accents, tirets/apostrophes → espace, mots triés. */
export function normaliserNom(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z ]+/g, ' ').split(/\s+/).filter((m) => m && !['M', 'MME', 'MLLE', 'MR', 'MONSIEUR', 'MADAME'].includes(m)).sort().join(' ');
}
/**
 * L'identité déclarée (nom + prénom) se retrouve-t-elle dans un nom signé ?
 * Vrai si tous les mots du nom déclaré ET au moins un mot du prénom figurent dans le nom signé.
 */
export function identiteConcorde(nomSigne, nom, prenom) {
  const sig = new Set(normaliserNom(nomSigne).split(' ').filter(Boolean));
  const n = normaliserNom(nom).split(' ').filter(Boolean), p = normaliserNom(prenom).split(' ').filter(Boolean);
  if (!sig.size || !n.length) return null;
  return n.every((m) => sig.has(m)) && (!p.length || p.some((m) => sig.has(m)));
}

const chiffres = (s) => String(s || '').replace(/\D/g, '');
/** La suite de chiffres `v` apparaît-elle dans le texte, éventuellement découpée par des espaces de milliers ou des
 *  points, et bornée par des non-chiffres (« 31 540 € » retrouve 31540 ; « 131 540 » ne le retrouve pas) ? */
export function chiffresPresents(texte, v) {
  const d = chiffres(v); if (!d) return false;
  const motif = d.split('').join('[ .\u00a0\u202f]?');
  return new RegExp('(^|[^0-9])' + motif + '(?![0-9])').test(String(texte || ''));
}
/**
 * Compare les valeurs signées d'un avis (types 04 / 28) avec le texte imprimé de la pièce (couche texte du PDF).
 * Constat par champ : 'identique' | 'absent' (valeur signée non retrouvée dans le texte imprimé). Sans texte
 * imprimé (photo, PDF image) : aucune comparaison.
 * @returns {Array<{id, libelle, signe, statut}>}
 */
export function comparerAvecTexte(type, champs, texteImprime) {
  if (!TYPES_AVIS_IMPOT.includes(type)) return [];
  const txt = String(texteImprime || '');
  if (!txt.trim()) return [];
  const motsTexte = new Set(normaliserNom(txt).split(' ').filter(Boolean));
  const out = [];
  for (const c of champs || []) {
    if (c.id === '41' || c.id === '44' || c.id === '47' || c.id === '49') {
      if (!chiffres(c.valeur)) continue;
      out.push({ id: c.id, libelle: c.libelle, signe: c.valeur, statut: chiffresPresents(txt, c.valeur) ? 'identique' : 'absent' });
    } else if (c.id === '46' || c.id === '48') {
      const mots = normaliserNom(c.valeur).split(' ').filter(Boolean);
      if (!mots.length) continue;
      out.push({ id: c.id, libelle: c.libelle, signe: c.valeur, statut: mots.every((m) => motsTexte.has(m)) ? 'identique' : 'absent' });
    }
  }
  return out;
}

/** Références à recopier dans le service de vérification d'impots.gouv (numéro fiscal, référence d'avis). */
export function referencesSvair(type, champs) {
  if (!TYPES_AVIS_IMPOT.includes(type)) return null;
  const v = (id) => ((champs || []).find((c) => c.id === id) || {}).valeur || '';
  const numero = v('47') || v('40'), reference = v('44');
  return numero || reference ? { numeroFiscal: numero, referenceAvis: reference } : null;
}

export const URL_SVAIR = 'https://www.impots.gouv.fr/verifavis2-api/front';
